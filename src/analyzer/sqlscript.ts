import { tokenize, type Token } from '../formatter/tokenizer';
import {
  filterSuppressedDiagnostics,
  type AnalyzerContext,
  type AnalyzerDiagnostic,
  type CodeFixSuggestion,
  type DiagnosticSeverityLevel,
  type TextEditSpan,
} from './types';

interface IndexedStatement {
  readonly tokens: readonly Token[];
  readonly start: number;
  readonly end: number;
  readonly inProcedureBody: boolean;
  readonly loopDepth: number;
}

const CE_FUNCTIONS = new Set([
  'CE_COLUMN_TABLE',
  'CE_JOIN_VIEW',
  'CE_OLAP_VIEW',
  'CE_CALC_VIEW',
  'CE_JOIN',
  'CE_LEFT_OUTER_JOIN',
  'CE_RIGHT_OUTER_JOIN',
  'CE_PROJECTION',
  'CE_CALC',
  'CE_AGGREGATION',
  'CE_UNION_ALL',
  'CE_VERTICAL_UNION',
  'CE_CONVERSION',
]);

const DML_KEYWORDS = new Set(['INSERT', 'UPDATE', 'UPSERT', 'DELETE', 'MERGE']);
const DDL_KEYWORDS = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE']);
const IDENT_CONTEXT_KEYWORDS = new Set([
  'FROM',
  'JOIN',
  'INTO',
  'TABLE',
  'UPDATE',
  'CALL',
  'VIEW',
  'PROCEDURE',
  'FUNCTION',
  'ON',
]);

function upper(tok: Token | undefined): string {
  return tok ? tok.text.toUpperCase() : '';
}

function isWord(tok: Token | undefined, kw?: string): boolean {
  if (!tok || tok.type !== 'word') return false;
  return kw === undefined || tok.text.toUpperCase() === kw;
}

function unescapeSingleQuotedSql(rawLiteral: string): string {
  if (rawLiteral.length >= 2 && rawLiteral.startsWith('\'') && rawLiteral.endsWith('\'')) {
    return rawLiteral.slice(1, -1).replace(/''/g, '\'');
  }
  return rawLiteral;
}

function escapeSingleQuotedSql(content: string): string {
  return `'${content.replace(/'/g, '\'\'')}'`;
}

function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  let i = lineStart;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return text.slice(lineStart, i);
}

/**
 * Finds the matching closing `)` or `]` starting from `openIndex`.
 */
function findMatchingClose(tokens: readonly Token[], openIndex: number): number {
  const open = tokens[openIndex]?.text;
  const close = open === '(' ? ')' : open === '[' ? ']' : '';
  if (!close) return -1;
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (tokens[i].text === open) depth++;
    else if (tokens[i].text === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Splits a token slice at top-level commas (outside nested `()` and `[]`).
 */
function splitTopLevelCommas(tokens: readonly Token[]): Token[][] {
  const parts: Token[][] = [];
  let current: Token[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  for (const tok of tokens) {
    if (tok.text === '(') parenDepth++;
    else if (tok.text === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (tok.text === '[') bracketDepth++;
    else if (tok.text === ']') bracketDepth = Math.max(0, bracketDepth - 1);

    if (tok.text === ',' && parenDepth === 0 && bracketDepth === 0) {
      parts.push(current);
      current = [];
      continue;
    }
    current.push(tok);
  }
  if (current.length > 0 || parts.length > 0) parts.push(current);
  return parts;
}

/**
 * Joins tokens back into readable SQL preserving original spacing between adjacent tokens.
 */
function renderTokenRange(text: string, tokens: readonly Token[]): string {
  if (tokens.length === 0) return '';
  return text.slice(tokens[0].start, tokens[tokens.length - 1].end);
}

/**
 * Splits code tokens into top-level statements separated by `;` while tracking
 * procedure body boundaries and loop nesting depth.
 */
function extractStatements(codeTokens: readonly Token[]): IndexedStatement[] {
  const statements: IndexedStatement[] = [];
  let cur: Token[] = [];
  let inProcedureHeader = false;
  let bodyBeginDepth = 0;
  let caseDepth = 0;
  let loopDepth = 0;
  let parenDepth = 0;

  const flush = (): void => {
    if (cur.length === 0) return;
    statements.push({
      tokens: cur,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      inProcedureBody: bodyBeginDepth > 0,
      loopDepth,
    });
    cur = [];
  };

  for (let i = 0; i < codeTokens.length; i++) {
    const tok = codeTokens[i];
    const prev = codeTokens[i - 1];
    const next = codeTokens[i + 1];
    const w = tok.type === 'word' ? tok.text.toUpperCase() : '';

    if (tok.text === '(') parenDepth++;
    else if (tok.text === ')') parenDepth = Math.max(0, parenDepth - 1);

    if (parenDepth === 0) {
      if (w === 'PROCEDURE' || w === 'FUNCTION') {
        if (!prev || isWord(prev, 'CREATE') || isWord(prev, 'REPLACE') || prev.text === ';') {
          inProcedureHeader = true;
        }
      }

      if (w === 'CASE') {
        caseDepth++;
      } else if (w === 'BEGIN') {
        if (inProcedureHeader && bodyBeginDepth === 0) {
          inProcedureHeader = false;
        }
        // Statement immediately before BEGIN (e.g. header AS / CREATE PROCEDURE ... BEGIN) is header.
        if (cur.length > 0) {
          flush();
        }
        bodyBeginDepth++;
        cur.push(tok);
        flush();
        continue;
      } else if (w === 'FOR' || w === 'WHILE') {
        // Loop start ONLY if statement contains DO or header starts with FOR/WHILE
        if (cur.length === 0 || isWord(cur[0], 'FOR') || isWord(cur[0], 'WHILE')) {
          // Will increment when DO is seen
        }
      } else if (w === 'DO' && (isWord(cur[0], 'FOR') || isWord(cur[0], 'WHILE'))) {
        cur.push(tok);
        flush();
        loopDepth++;
        continue;
      } else if (w === 'END') {
        if (isWord(next, 'FOR') || isWord(next, 'WHILE')) {
          loopDepth = Math.max(0, loopDepth - 1);
        } else if (isWord(next, 'IF')) {
          // END IF does not close BEGIN
        } else if (caseDepth > 0 && !next?.text.startsWith(';')) {
          caseDepth--;
        } else if (next?.text === ';' || !next || isWord(next, 'PARALLEL') || isWord(next, 'USING')) {
          bodyBeginDepth = Math.max(0, bodyBeginDepth - 1);
        }
      }
    }

    if (tok.text === ';' && parenDepth === 0) {
      cur.push(tok);
      flush();
      continue;
    }

    cur.push(tok);
  }
  flush();
  return statements;
}

interface ProcedureHeaderInfo {
  readonly kind: 'PROCEDURE' | 'FUNCTION';
  readonly nameStart: number;
  readonly nameEnd: number;
  readonly isTableUdf: boolean;
  readonly securityClause?: {
    readonly mode: 'DEFINER' | 'INVOKER';
    readonly modeStart: number;
    readonly modeEnd: number;
  };
  readonly insertSecurityAt?: number;
  readonly defaultSchemaSpan?: { readonly start: number; readonly end: number };
  readonly bodyStartTokenIdx: number;
  readonly bodyEndTokenIdx: number;
}

/**
 * Scans top-level CREATE/headerless PROCEDURE or FUNCTION declarations.
 */
function findProcedureHeaders(codeTokens: readonly Token[], text: string): ProcedureHeaderInfo[] {
  const headers: ProcedureHeaderInfo[] = [];

  for (let i = 0; i < codeTokens.length; i++) {
    const t = codeTokens[i];
    if (t.type !== 'word') continue;
    const kw = t.text.toUpperCase();
    if (kw !== 'PROCEDURE' && kw !== 'FUNCTION') continue;

    // Must be start of input, after `;`, or preceded by CREATE [OR REPLACE]
    const prev = codeTokens[i - 1];
    const isDecl =
      !prev ||
      prev.text === ';' ||
      isWord(prev, 'CREATE') ||
      isWord(prev, 'REPLACE');
    if (!isDecl) continue;

    // Locate name token
    let p = i + 1;
    while (p < codeTokens.length && codeTokens[p].text !== '(' && codeTokens[p].type === 'word' &&
      (codeTokens[p + 1]?.text === '.')) {
      p += 2;
    }
    const nameTok = codeTokens[p];
    if (!nameTok) continue;

    // Find header terminator (`AS` or `BEGIN`) outside parameter parens
    let depth = 0;
    let headerEnd = -1;
    let bodyBeginIdx = -1;
    let isTableUdf = false;
    let securityClause: ProcedureHeaderInfo['securityClause'];
    let insertSecurityAt: number | undefined;
    let defaultSchemaSpan: ProcedureHeaderInfo['defaultSchemaSpan'];

    for (let j = i + 1; j < codeTokens.length; j++) {
      const cur = codeTokens[j];
      if (cur.text === '(') {
        depth++;
        continue;
      }
      if (cur.text === ')') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth > 0) continue;

      const u = upper(cur);
      if (u === 'RETURNS' && isWord(codeTokens[j + 1], 'TABLE')) {
        isTableUdf = true;
      } else if (
        u === 'SQL' &&
        isWord(codeTokens[j + 1], 'SECURITY') &&
        (isWord(codeTokens[j + 2], 'DEFINER') || isWord(codeTokens[j + 2], 'INVOKER'))
      ) {
        const modeTok = codeTokens[j + 2];
        securityClause = {
          mode: upper(modeTok) as 'DEFINER' | 'INVOKER',
          modeStart: modeTok.start,
          modeEnd: modeTok.end,
        };
      } else if (
        u === 'DEFAULT' &&
        isWord(codeTokens[j + 1], 'SCHEMA') &&
        codeTokens[j + 2]
      ) {
        const schemaTok = codeTokens[j + 2];
        // Extend backward over preceding horizontal whitespace so removal stays clean
        let delStart = cur.start;
        while (delStart > 0 && (text[delStart - 1] === ' ' || text[delStart - 1] === '\t')) {
          delStart--;
        }
        defaultSchemaSpan = { start: delStart, end: schemaTok.end };
        if (insertSecurityAt === undefined) insertSecurityAt = cur.start;
      } else if (u === 'READS' && isWord(codeTokens[j + 1], 'SQL')) {
        if (insertSecurityAt === undefined) insertSecurityAt = cur.start;
      } else if (u === 'AS') {
        if (insertSecurityAt === undefined) insertSecurityAt = cur.start;
        headerEnd = j;
        if (isWord(codeTokens[j + 1], 'BEGIN')) {
          bodyBeginIdx = j + 1;
        }
        break;
      } else if (u === 'BEGIN') {
        if (insertSecurityAt === undefined) insertSecurityAt = cur.start;
        headerEnd = j;
        bodyBeginIdx = j;
        break;
      } else if (cur.text === ';') {
        break;
      }
    }

    if (headerEnd === -1) continue;
    if (bodyBeginIdx === -1) {
      // AS ... might have BEGIN slightly later or single SQL query
      for (let j = headerEnd + 1; j < Math.min(codeTokens.length, headerEnd + 6); j++) {
        if (isWord(codeTokens[j], 'BEGIN')) {
          bodyBeginIdx = j;
          break;
        }
      }
    }

    let bodyEndIdx = codeTokens.length - 1;
    if (bodyBeginIdx >= 0) {
      let nest = 0;
      let caseNest = 0;
      for (let j = bodyBeginIdx; j < codeTokens.length; j++) {
        const uw = upper(codeTokens[j]);
        const nxt = codeTokens[j + 1];
        if (uw === 'CASE') {
          caseNest++;
        } else if (uw === 'BEGIN') {
          nest++;
        } else if (uw === 'END') {
          if (isWord(nxt, 'IF') || isWord(nxt, 'FOR') || isWord(nxt, 'WHILE')) {
            continue;
          }
          if (caseNest > 0 && (!nxt || (nxt.text !== ';' && nxt.start !== codeTokens[j + 1]?.start))) {
            // Heuristic: CASE ... END rarely has `;` immediately after unless last expression in assignment
            if (!isWord(nxt, 'PROCEDURE') && !isWord(nxt, 'FUNCTION')) {
              caseNest--;
              continue;
            }
          }
          nest--;
          if (nest === 0) {
            bodyEndIdx = j;
            break;
          }
        }
      }
    } else {
      bodyBeginIdx = headerEnd + 1;
      for (let j = bodyBeginIdx; j < codeTokens.length; j++) {
        if (codeTokens[j].text === ';') {
          bodyEndIdx = j;
          break;
        }
      }
    }

    headers.push({
      kind: kw,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
      isTableUdf,
      securityClause,
      insertSecurityAt,
      defaultSchemaSpan,
      bodyStartTokenIdx: bodyBeginIdx,
      bodyEndTokenIdx: bodyEndIdx,
    });
  }

  return headers;
}

/**
 * Analyzes an `EXEC` / `EXECUTE IMMEDIATE` statement for SQL injection and generates
 * an AST QuickFix rewriting `'...' || :v1 || '...'` into `EXECUTE IMMEDIATE '...' USING :v1`.
 */
function analyzeDynamicSqlStatement(
  stmt: IndexedStatement,
  text: string,
  safeVars: ReadonlySet<string>,
  taintedVars: ReadonlySet<string>,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const toks = stmt.tokens;
  let exprStartIdx = -1;
  if (isWord(toks[0], 'EXEC')) {
    exprStartIdx = 1;
  } else if (isWord(toks[0], 'EXECUTE') && isWord(toks[1], 'IMMEDIATE')) {
    exprStartIdx = 2;
  }
  if (exprStartIdx === -1 || exprStartIdx >= toks.length) return;

  // Locate optional INTO / USING clauses outside parens
  let depth = 0;
  let exprEndIdx = toks.length;
  let intoIdx = -1;
  let usingIdx = -1;
  for (let i = exprStartIdx; i < toks.length; i++) {
    const t = toks[i];
    if (t.text === '(') depth++;
    else if (t.text === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (isWord(t, 'INTO') && intoIdx === -1 && usingIdx === -1) {
        intoIdx = i;
        if (exprEndIdx === toks.length) exprEndIdx = i;
      } else if (isWord(t, 'USING') && usingIdx === -1) {
        usingIdx = i;
        if (exprEndIdx === toks.length) exprEndIdx = i;
      } else if (t.text === ';') {
        if (exprEndIdx === toks.length) exprEndIdx = i;
      }
    }
  }

  const exprTokens = toks.slice(exprStartIdx, exprEndIdx);
  if (exprTokens.length === 0) return;

  // Split expression on top-level `||`
  const concatParts: Token[][] = [];
  let currentPart: Token[] = [];
  let pDepth = 0;
  for (const t of exprTokens) {
    if (t.text === '(') pDepth++;
    else if (t.text === ')') pDepth = Math.max(0, pDepth - 1);
    if (t.text === '||' && pDepth === 0) {
      concatParts.push(currentPart);
      currentPart = [];
      continue;
    }
    currentPart.push(t);
  }
  concatParts.push(currentPart);

  const hasConcat = concatParts.length > 1;
  const singleVar =
    !hasConcat && exprTokens.length === 1 && (exprTokens[0].type === 'var' || exprTokens[0].type === 'word')
      ? exprTokens[0].text.toUpperCase()
      : null;
  const isTaintedSingleVar = singleVar !== null && taintedVars.has(singleVar);

  if (hasConcat || isTaintedSingleVar) {
    const fixes: CodeFixSuggestion[] = [];
    if (hasConcat) {
      const paramFix = buildParameterizedExecFix(toks, stmt, concatParts, exprEndIdx, usingIdx, text);
      if (paramFix) fixes.push(paramFix);

      const escapeFix = buildEscapeDoubleQuotesFix(concatParts, text);
      if (escapeFix) fixes.push(escapeFix);
    }

    diagnostics.push({
      ruleId: 'HANA-SEC-001',
      sapCode: 'SAP.USE_OF_DYNAMIC_SQL.SECURITY',
      category: 'security',
      severity: 'error',
      message:
        "Dynamic SQL concatenation risks SQL injection. Use 'EXECUTE IMMEDIATE ... USING ...' with '?' placeholders for value arguments.",
      start: stmt.start,
      end: exprTokens[exprTokens.length - 1].end,
      fixes,
    });
    return;
  }

  // Case 2: Unconcatenated variable without USING and without prior IS_SQL_INJECTION_SAFE / ESCAPE_* check
  if (
    singleVar !== null &&
    usingIdx === -1 &&
    !safeVars.has(singleVar)
  ) {
    diagnostics.push({
      ruleId: 'HANA-SEC-002',
      sapCode: 'SAP.UNCHECKED_SQL_INJECTION_SAFETY.SECURITY',
      category: 'security',
      severity: 'warning',
      message:
        'Unchecked dynamic SQL input (SAP.UNCHECKED_SQL_INJECTION_SAFETY.SECURITY). Validate identifiers with IS_SQL_INJECTION_SAFE() or bind values with USING.',
      start: stmt.start,
      end: exprTokens[exprTokens.length - 1].end,
      fixes: [],
    });
    return;
  }

  // Case 3: Safe or literal EXEC/EXECUTE IMMEDIATE -> still flag dynamic SQL as Info for optimizer visibility
  const sqlText =
    exprTokens.length === 1 && exprTokens[0].type === 'string'
      ? unescapeSingleQuotedSql(exprTokens[0].text).toUpperCase()
      : '';
  const isCommitOrRollback = /\b(?:COMMIT|ROLLBACK)\b/.test(sqlText);
  diagnostics.push({
    ruleId: 'HANA-PERF-006',
    sapCode: isCommitOrRollback
      ? 'SAP.COMMIT_OR_ROLLBACK_IN_DYNAMIC_SQL.CONSISTENCY'
      : 'SAP.USE_OF_DYNAMIC_SQL.SECURITY',
    category: 'performance',
    severity: 'information',
    message: isCommitOrRollback
      ? 'Transaction control (COMMIT/ROLLBACK) inside dynamic SQL breaks SQLScript transaction boundaries.'
      : 'Dynamic SQL (SAP.USE_OF_DYNAMIC_SQL) prevents static dependency analysis and statement inlining.',
    start: stmt.start,
    end: exprTokens[exprTokens.length - 1].end,
    fixes: [],
  });
}

function endsWithIdentifierKeyword(sqlSoFar: string): boolean {
  const words = sqlSoFar.trimEnd().toUpperCase().match(/[A-Z_]+$/);
  return words ? IDENT_CONTEXT_KEYWORDS.has(words[0]) : false;
}

/**
 * Converts `'SQL ' || :v1 || ...` into `EXECUTE IMMEDIATE 'SQL ?' USING :v1, ...`
 * when concatenated parts are scalar value arguments rather than table/column identifiers.
 */
function buildParameterizedExecFix(
  toks: readonly Token[],
  stmt: IndexedStatement,
  concatParts: readonly Token[][],
  exprEndIdx: number,
  usingIdx: number,
  text: string
): CodeFixSuggestion | null {
  const sqlFragments: string[] = [];
  const bindExprs: string[] = [];
  let hasBind = false;
  let openSingleQuote = false;

  for (let i = 0; i < concatParts.length; i++) {
    const part = concatParts[i];
    if (part.length === 0) return null;

    if (part.length === 1 && part[0].type === 'string') {
      let unescaped = unescapeSingleQuotedSql(part[0].text);
      if (openSingleQuote) {
        if (!unescaped.startsWith('\'')) return null;
        unescaped = unescaped.slice(1);
        openSingleQuote = false;
      }
      sqlFragments.push(unescaped);
      continue;
    }

    // Dynamic expression part (variable or scalar expression)
    const rawPart = renderTokenRange(text, part).trim();
    if (!rawPart) return null;

    // Already sanitized with ESCAPE_* -> cannot safely rewrite single piece into ?
    if (/^(?:ESCAPE_DOUBLE_QUOTES|ESCAPE_SINGLE_QUOTES)\s*\(/i.test(rawPart)) {
      return null;
    }

    const lastFrag = sqlFragments[sqlFragments.length - 1] ?? '';
    const trimmedFrag = lastFrag.trimEnd();
    const wrappedInQuotes = trimmedFrag.endsWith('\'');
    const wrappedInDoubleQuotes = trimmedFrag.endsWith('"');

    if (wrappedInDoubleQuotes || (!wrappedInQuotes && endsWithIdentifierKeyword(lastFrag))) {
      // Dynamic identifier (table/column name) cannot become a `?` placeholder in SAP HANA
      return null;
    }

    if (wrappedInQuotes) {
      // Strip the dangling opening `'` from previous fragment and expect closing `'` on next literal
      const nextPart = concatParts[i + 1];
      if (
        !nextPart ||
        nextPart.length !== 1 ||
        nextPart[0].type !== 'string' ||
        !unescapeSingleQuotedSql(nextPart[0].text).startsWith('\'')
      ) {
        return null;
      }
      const quotePos = lastFrag.lastIndexOf('\'');
      sqlFragments[sqlFragments.length - 1] = lastFrag.slice(0, quotePos);
      openSingleQuote = true;
    }

    sqlFragments.push('?');
    bindExprs.push(rawPart);
    hasBind = true;
  }

  if (!hasBind || openSingleQuote) return null;

  const combinedSql = escapeSingleQuotedSql(sqlFragments.join(''));
  const hasSemi = toks[toks.length - 1]?.text === ';';
  let tail = '';
  if (exprEndIdx < toks.length) {
    const tailEndTok = hasSemi ? toks[toks.length - 2] : toks[toks.length - 1];
    if (exprEndIdx <= (hasSemi ? toks.length - 2 : toks.length - 1)) {
      tail = ` ${text.slice(toks[exprEndIdx].start, tailEndTok.end).trim()}`;
    }
  }

  let newStatement: string;
  if (usingIdx !== -1 && tail) {
    newStatement = `EXECUTE IMMEDIATE ${combinedSql}${tail}, ${bindExprs.join(', ')}${hasSemi ? ';' : ''}`;
  } else {
    newStatement = `EXECUTE IMMEDIATE ${combinedSql}${tail} USING ${bindExprs.join(', ')}${hasSemi ? ';' : ''}`;
  }

  return {
    title: "Refactor dynamic SQL to parameterized 'EXECUTE IMMEDIATE ... USING ...'",
    kind: 'quickfix',
    isPreferred: true,
    edits: [{ start: stmt.start, end: stmt.end, newText: newStatement }],
  };
}

/**
 * Offers `ESCAPE_DOUBLE_QUOTES(:ident)` QuickFix when an identifier parameter is wrapped in `"..."`.
 */
function buildEscapeDoubleQuotesFix(concatParts: readonly Token[][], text: string): CodeFixSuggestion | null {
  const edits: TextEditSpan[] = [];
  for (let i = 1; i < concatParts.length; i++) {
    const prev = concatParts[i - 1];
    const cur = concatParts[i];
    if (prev.length === 1 && prev[0].type === 'string' && cur.length === 1 && cur[0].type === 'var') {
      const prevContent = unescapeSingleQuotedSql(prev[0].text).trimEnd();
      if (prevContent.endsWith('"') || endsWithIdentifierKeyword(prevContent)) {
        const exprText = renderTokenRange(text, cur);
        edits.push({
          start: cur[0].start,
          end: cur[cur.length - 1].end,
          newText: `ESCAPE_DOUBLE_QUOTES(${exprText})`,
        });
      }
    }
  }
  if (edits.length === 0) return null;
  return {
    title: 'Wrap concatenated SQL identifier in ESCAPE_DOUBLE_QUOTES(...)',
    kind: 'quickfix',
    edits,
  };
}

function formatCeColumnList(colTokens: readonly Token[], text: string): string {
  if (colTokens.length === 0) return '*';
  const items = splitTopLevelCommas(colTokens).filter((p) => p.length > 0);
  if (items.length === 0) return '*';

  const rendered: string[] = [];
  for (const item of items) {
    // Check CE_CALC('<expr>', <type>) AS <alias>
    const ceCalcIdx = item.findIndex((t) => isWord(t, 'CE_CALC'));
    if (ceCalcIdx !== -1 && item[ceCalcIdx + 1]?.text === '(') {
      const closeIdx = findMatchingClose(item, ceCalcIdx + 1);
      if (closeIdx !== -1) {
        const innerArgs = splitTopLevelCommas(item.slice(ceCalcIdx + 2, closeIdx));
        let formula = innerArgs[0]?.length === 1 && innerArgs[0][0].type === 'string'
          ? unescapeSingleQuotedSql(innerArgs[0][0].text)
          : renderTokenRange(text, innerArgs[0] ?? []);
        formula = formula.trim();
        const suffix = closeIdx + 1 < item.length ? ` ${renderTokenRange(text, item.slice(closeIdx + 1)).trim()}` : '';
        rendered.push(`${formula}${suffix}`);
        continue;
      }
    }
    rendered.push(renderTokenRange(text, item).trim());
  }
  return rendered.join(', ');
}

function unwrapBrackets(argTokens: readonly Token[]): readonly Token[] {
  if (
    argTokens.length >= 2 &&
    argTokens[0].text === '[' &&
    argTokens[argTokens.length - 1].text === ']'
  ) {
    return argTokens.slice(1, -1);
  }
  return argTokens;
}

/**
 * Converts supported `<lhs> = CE_*(...);` statements into pure standard SQL `SELECT`.
 */
function buildCeToSqlEdit(
  stmt: IndexedStatement,
  ceName: string,
  callOpenParenIdx: number,
  text: string
): TextEditSpan | null {
  const toks = stmt.tokens;
  const closeIdx = findMatchingClose(toks, callOpenParenIdx);
  if (closeIdx === -1) return null;

  // Locate target assignment `<var> = CE_*(...)`
  const eqIdx = toks.findIndex((t, idx) => idx < callOpenParenIdx && t.text === '=');
  if (eqIdx < 1) return null;
  const lhs = text.slice(toks[0].start, toks[eqIdx - 1].end).trim();
  const hasSemi = toks[toks.length - 1]?.text === ';';

  const args = splitTopLevelCommas(toks.slice(callOpenParenIdx + 1, closeIdx));
  if (args.length === 0) return null;

  let sqlExpr: string | null = null;
  const semi = hasSemi ? ';' : '';

  switch (ceName) {
    case 'CE_COLUMN_TABLE':
    case 'CE_JOIN_VIEW':
    case 'CE_CALC_VIEW': {
      const source = renderTokenRange(text, args[0]).trim();
      const cols = args[1] ? formatCeColumnList(unwrapBrackets(args[1]), text) : '*';
      sqlExpr = `SELECT ${cols} FROM ${source}`;
      break;
    }
    case 'CE_OLAP_VIEW': {
      const source = renderTokenRange(text, args[0]).trim();
      const proj = args[1] ? formatCeColumnList(unwrapBrackets(args[1]), text) : '*';
      const items = args[1] ? splitTopLevelCommas(unwrapBrackets(args[1])) : [];
      const groupCols = items
        .map((it) => renderTokenRange(text, it).trim())
        .filter((s) => s && !/^(?:SUM|MIN|MAX|COUNT|AVG)\s*\(/i.test(s));
      const groupClause = groupCols.length > 0 && groupCols.length < items.length
        ? ` GROUP BY ${groupCols.join(', ')}`
        : '';
      sqlExpr = `SELECT ${proj} FROM ${source}${groupClause}`;
      break;
    }
    case 'CE_PROJECTION': {
      const source = renderTokenRange(text, args[0]).trim();
      const proj = args[1] ? formatCeColumnList(unwrapBrackets(args[1]), text) : '*';
      let whereClause = '';
      if (args[2] && args[2].length === 1 && args[2][0].type === 'string') {
        const filterStr = unescapeSingleQuotedSql(args[2][0].text).trim();
        if (filterStr) whereClause = ` WHERE ${filterStr}`;
      }
      sqlExpr = `SELECT ${proj} FROM ${source}${whereClause}`;
      break;
    }
    case 'CE_JOIN':
    case 'CE_LEFT_OUTER_JOIN':
    case 'CE_RIGHT_OUTER_JOIN': {
      if (args.length < 3) break;
      const leftSrc = renderTokenRange(text, args[0]).trim();
      const rightSrc = renderTokenRange(text, args[1]).trim();
      const joinCols = splitTopLevelCommas(unwrapBrackets(args[2]))
        .map((c) => renderTokenRange(text, c).trim())
        .filter(Boolean);
      if (joinCols.length === 0) break;
      const joinType =
        ceName === 'CE_LEFT_OUTER_JOIN'
          ? 'LEFT OUTER JOIN'
          : ceName === 'CE_RIGHT_OUTER_JOIN'
            ? 'RIGHT OUTER JOIN'
            : 'INNER JOIN';
      const onClause = joinCols.map((c) => `L.${c} = R.${c}`).join(' AND ');
      const proj = args[3] ? formatCeColumnList(unwrapBrackets(args[3]), text) : '*';
      sqlExpr = `SELECT ${proj} FROM ${leftSrc} AS L ${joinType} ${rightSrc} AS R ON ${onClause}`;
      break;
    }
    case 'CE_AGGREGATION': {
      if (args.length < 2) break;
      const source = renderTokenRange(text, args[0]).trim();
      const aggs = formatCeColumnList(unwrapBrackets(args[1]), text);
      const groups = args[2]
        ? splitTopLevelCommas(unwrapBrackets(args[2]))
            .map((g) => renderTokenRange(text, g).trim())
            .filter(Boolean)
        : [];
      const selectCols = groups.length > 0 ? `${groups.join(', ')}, ${aggs}` : aggs;
      const groupBy = groups.length > 0 ? ` GROUP BY ${groups.join(', ')}` : '';
      sqlExpr = `SELECT ${selectCols} FROM ${source}${groupBy}`;
      break;
    }
    case 'CE_UNION_ALL': {
      if (args.length < 2) break;
      const v1 = renderTokenRange(text, args[0]).trim();
      const v2 = renderTokenRange(text, args[1]).trim();
      sqlExpr = `SELECT * FROM ${v1} UNION ALL SELECT * FROM ${v2}`;
      break;
    }
    default:
      break;
  }

  if (!sqlExpr) return null;
  return {
    start: stmt.start,
    end: stmt.end,
    newText: `${lhs} = ${sqlExpr}${semi}`,
  };
}

function analyzeHandlerStatement(
  statements: readonly IndexedStatement[],
  stmtIdx: number,
  text: string,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const stmt = statements[stmtIdx];
  const toks = stmt.tokens;
  if (
    !isWord(toks[0], 'DECLARE') ||
    !isWord(toks[1], 'EXIT') ||
    !isWord(toks[2], 'HANDLER')
  ) {
    return;
  }

  // Locate FOR <condition>
  const forIdx = toks.findIndex((t, idx) => idx >= 3 && isWord(t, 'FOR'));
  if (forIdx === -1) return;

  let bodyStartIdx = forIdx + 2;
  if (isWord(toks[forIdx + 1], 'SQL_ERROR_CODE')) {
    bodyStartIdx = forIdx + 3;
  }

  const indent = lineIndentAt(text, stmt.start);
  const fixes: CodeFixSuggestion[] = [];

  // Case A: Handler header ends before BEGIN statement in next IndexedStatement
  if (bodyStartIdx >= toks.length) {
    const nextStmt = statements[stmtIdx + 1];
    if (!nextStmt) return;
    if (isWord(nextStmt.tokens[0], 'BEGIN')) {
      let depth = 0;
      let matchingEndTok: Token | null = null;
      let hasSignal = false;
      for (let k = stmtIdx + 1; k < statements.length; k++) {
        for (const t of statements[k].tokens) {
          if (isWord(t, 'RESIGNAL') || isWord(t, 'SIGNAL')) hasSignal = true;
          if (isWord(t, 'BEGIN')) depth++;
          else if (isWord(t, 'END')) {
            depth--;
            if (depth === 0) {
              matchingEndTok = t;
              break;
            }
          }
        }
        if (matchingEndTok) break;
      }
      if (hasSignal) return;
      if (matchingEndTok) {
        const beforeEnd = text.slice(0, matchingEndTok.start);
        const needsNewline = !/\n[ \t]*$/.test(beforeEnd);
        const newText = needsNewline
          ? `\n${indent}  RESIGNAL;\n${indent}`
          : `  RESIGNAL;\n${indent}`;
        fixes.push({
          title: "Add 'RESIGNAL;' to EXIT HANDLER so errors are not silently swallowed",
          kind: 'quickfix',
          isPreferred: true,
          edits: [{ start: matchingEndTok.start, end: matchingEndTok.start, newText }],
        });
      }
    } else {
      // Single-statement handler body sits in nextStmt
      const hasSignal = nextStmt.tokens.some((t) => isWord(t, 'RESIGNAL') || isWord(t, 'SIGNAL'));
      if (hasSignal) return;
      const bodyRaw = text.slice(nextStmt.start, nextStmt.end).trim();
      const stmtBody = bodyRaw.endsWith(';') ? bodyRaw : `${bodyRaw};`;
      fixes.push({
        title: "Wrap EXIT HANDLER body in 'BEGIN ... RESIGNAL; END;'",
        kind: 'quickfix',
        isPreferred: true,
        edits: [
          {
            start: nextStmt.start,
            end: nextStmt.end,
            newText: `BEGIN\n${indent}  ${stmtBody}\n${indent}  RESIGNAL;\n${indent}END;`,
          },
        ],
      });
    }

    diagnostics.push({
      ruleId: 'HANA-LINT-001',
      category: 'lint',
      severity: 'warning',
      message:
        "'DECLARE EXIT HANDLER' catches SQL exceptions without propagating them via RESIGNAL/SIGNAL, silently masking failures and partial commits.",
      start: stmt.start,
      end: toks[Math.min(3, toks.length - 1)].end,
      fixes,
    });
    return;
  }

  // Case B: Inline BEGIN ... END or single statement in same token list
  const hasSignal = toks.some((t) => isWord(t, 'RESIGNAL') || isWord(t, 'SIGNAL'));
  if (hasSignal) return;

  const beginIdx = toks.findIndex((t, idx) => idx >= bodyStartIdx && isWord(t, 'BEGIN'));
  if (beginIdx !== -1) {
    let endIdx = -1;
    for (let i = toks.length - 1; i > beginIdx; i--) {
      if (isWord(toks[i], 'END')) {
        endIdx = i;
        break;
      }
    }
    if (endIdx !== -1) {
      const endTok = toks[endIdx];
      const beforeEnd = text.slice(0, endTok.start);
      const needsNewline = !/\n[ \t]*$/.test(beforeEnd);
      const insertPos = endTok.start;
      const newText = needsNewline
        ? `\n${indent}  RESIGNAL;\n${indent}`
        : `  RESIGNAL;\n${indent}`;
      fixes.push({
        title: "Add 'RESIGNAL;' to EXIT HANDLER so errors are not silently swallowed",
        kind: 'quickfix',
        isPreferred: true,
        edits: [{ start: insertPos, end: insertPos, newText }],
      });
    }
  } else {
    const bodyStartTok = toks[bodyStartIdx];
    const hasSemi = toks[toks.length - 1]?.text === ';';
    const bodyEndOffset = hasSemi ? toks[toks.length - 2].end : toks[toks.length - 1].end;
    const bodyRaw = text.slice(bodyStartTok.start, bodyEndOffset).trim();
    const stmtBody = bodyRaw.endsWith(';') ? bodyRaw : `${bodyRaw};`;
    fixes.push({
      title: "Wrap EXIT HANDLER body in 'BEGIN ... RESIGNAL; END;'",
      kind: 'quickfix',
      isPreferred: true,
      edits: [
        {
          start: bodyStartTok.start,
          end: toks[toks.length - 1].end,
          newText: `BEGIN\n${indent}  ${stmtBody}\n${indent}  RESIGNAL;\n${indent}END;`,
        },
      ],
    });
  }

  diagnostics.push({
    ruleId: 'HANA-LINT-001',
    category: 'lint',
    severity: 'warning',
    message:
      "'DECLARE EXIT HANDLER' catches SQL exceptions without propagating them via RESIGNAL/SIGNAL, silently masking failures and partial commits.",
    start: stmt.start,
    end: toks[Math.min(3, toks.length - 1)].end,
    fixes,
  });
}

function checkSelectStar(
  stmt: IndexedStatement,
  text: string,
  ceConvertedRanges: ReadonlyArray<{ start: number; end: number }>,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const toks = stmt.tokens;
  if (ceConvertedRanges.some((r) => stmt.start >= r.start && stmt.end <= r.end)) {
    return;
  }

  for (let i = 0; i < toks.length; i++) {
    if (!isWord(toks[i], 'SELECT')) continue;

    // Skip EXISTS (SELECT * ...)
    if (i >= 2 && isWord(toks[i - 2], 'EXISTS') && toks[i - 1].text === '(') {
      continue;
    }

    // Track subquery depth starting at this SELECT until FROM at the same depth
    let depth = 0;
    for (let j = i + 1; j < toks.length; j++) {
      const t = toks[j];
      if (t.text === '(') {
        depth++;
        continue;
      }
      if (t.text === ')') {
        if (depth === 0) break;
        depth--;
        continue;
      }
      if (depth > 0) continue;

      if (isWord(t, 'FROM') || isWord(t, 'INTO') || t.text === ';') break;

      if (t.text === '*') {
        // Make sure it's not multiplication like `a * b` or `COUNT(*)` (`depth > 0` already skipped COUNT(*))
        const prev = toks[j - 1];
        const isProjectionWildcard =
          prev === toks[i] ||
          prev?.text === ',' ||
          prev?.text === '.' ||
          isWord(prev, 'DISTINCT') ||
          isWord(prev, 'ALL');
        if (isProjectionWildcard) {
          diagnostics.push({
            ruleId: 'HANA-PERF-004',
            category: 'performance',
            severity: 'warning',
            message:
              "Avoid 'SELECT *' in stored procedures and views. Enumerate explicit columns to reduce column-store materialization and prevent schema-evolution breaks.",
            start: toks[i].start,
            end: t.end,
            fixes: [],
          });
          break;
        }
      }
    }
  }

  // Also check `WITH HINT (...)`
  for (let i = 0; i + 2 < toks.length; i++) {
    if (isWord(toks[i], 'WITH') && isWord(toks[i + 1], 'HINT') && toks[i + 2].text === '(') {
      diagnostics.push({
        ruleId: 'HANA-PERF-006',
        sapCode: 'SAP.USE_OF_WITH_HINT_CLAUSE.PERFORMANCE',
        category: 'performance',
        severity: 'information',
        message:
          'WITH HINT clause (SAP.USE_OF_WITH_HINT_CLAUSE.PERFORMANCE) overrides the SQL optimizer plan selection; verify necessity across HANA upgrades.',
        start: toks[i].start,
        end: toks[i + 2].end,
        fixes: [],
      });
    }
  }

  void text;
}

function checkApplyFilterCalls(
  stmt: IndexedStatement,
  safeVars: ReadonlySet<string>,
  taintedVars: ReadonlySet<string>,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const toks = stmt.tokens;
  for (let i = 0; i + 1 < toks.length; i++) {
    if (!isWord(toks[i], 'APPLY_FILTER') || toks[i + 1].text !== '(') continue;
    const closeIdx = findMatchingClose(toks, i + 1);
    if (closeIdx === -1) continue;
    const args = splitTopLevelCommas(toks.slice(i + 2, closeIdx));
    if (args.length < 2) continue;

    const filterArg = args[1];
    const hasConcat = filterArg.some((t) => t.text === '||');
    const singleVar =
      filterArg.length === 1 && (filterArg[0].type === 'var' || filterArg[0].type === 'word')
        ? filterArg[0].text.toUpperCase()
        : null;
    const isUnvalidatedVar =
      singleVar !== null && (!safeVars.has(singleVar) || taintedVars.has(singleVar));

    if (hasConcat || isUnvalidatedVar) {
      diagnostics.push({
        ruleId: 'HANA-SEC-005',
        sapCode: 'SAP.UNCHECKED_SQL_INJECTION_SAFETY.SECURITY',
        category: 'security',
        severity: 'warning',
        message:
          'Dynamic filter expression in APPLY_FILTER is not checked with IS_SQL_INJECTION_SAFE() or ESCAPE_SINGLE_QUOTES().',
        start: toks[i].start,
        end: toks[closeIdx].end,
        fixes: [],
      });
    }
  }
}

function checkSysBicAndSchemaPrefixes(
  codeTokens: readonly Token[],
  languageId: string,
  targetPlatform: string,
  diagnostics: AnalyzerDiagnostic[]
): void {
  if (targetPlatform === 'xsc') return;

  for (let i = 0; i < codeTokens.length; i++) {
    const t = codeTokens[i];
    const unquoted = t.text.replace(/^"|"$/g, '').toUpperCase();

    if (unquoted === '_SYS_BIC' && codeTokens[i + 1]?.text === '.' && codeTokens[i + 2]) {
      const targetTok = codeTokens[i + 2];
      const rawTarget = targetTok.text.replace(/^"|"$/g, '');
      const hdiName = `"${rawTarget.replace(/\//g, '::')}"`;
      const isMixedOrQuoted = t.type === 'qident' || t.type === 'word';
      if (isMixedOrQuoted) {
        diagnostics.push({
          ruleId: 'HANA-MIG-011',
          category: 'migration',
          severity: 'warning',
          message:
            `Hardcoded _SYS_BIC reference '${t.text}.${targetTok.text}' is not schema-agnostic in HDI. Replace with local '${hdiName}' or a synonym.`,
          start: t.start,
          end: targetTok.end,
          fixes: [
            {
              title: `Replace '_SYS_BIC.${targetTok.text}' with '${hdiName}'`,
              kind: 'quickfix',
              isPreferred: true,
              edits: [{ start: t.start, end: targetTok.end, newText: hdiName }],
            },
          ],
        });
      }
      i += 2;
      continue;
    }

    if (
      unquoted === '_SYS_REPO' &&
      (languageId === 'hdbprocedure' || languageId === 'hdbfunction' || languageId === 'hdbview')
    ) {
      diagnostics.push({
        ruleId: 'HANA-MIG-011',
        category: 'migration',
        severity: 'warning',
        message:
          "Reference to '_SYS_REPO' is XS Classic repository-specific and unavailable in HDI containers.",
        start: t.start,
        end: t.end,
        fixes: [],
      });
    }
  }
}

/**
 * Analyzes SQL / SQLScript files (`.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdblibrary`, `.hdbview`).
 */
export function analyzeSqlScript(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { text, languageId } = ctx;
  const opts = ctx.options ?? {};
  const checkSec = opts.security ?? true;
  const checkPerf = opts.performance ?? true;
  const checkMig = opts.migration ?? true;
  const targetPlatform = opts.targetPlatform ?? 'auto';

  const allTokens = tokenize(text);
  const codeTokens = allTokens.filter(
    (t) => t.type !== 'lineComment' && t.type !== 'blockComment' && t.type !== 'raw'
  );
  if (codeTokens.length === 0) return [];

  const diagnostics: AnalyzerDiagnostic[] = [];
  const headers = findProcedureHeaders(codeTokens, text);
  const statements = extractStatements(codeTokens);

  // Track sanitized & tainted variables sequentially
  const safeVars = new Set<string>();
  const taintedVars = new Set<string>();
  const ceEntries: Array<{ stmt: IndexedStatement; ceName: string; start: number; end: number; edit: TextEditSpan | null }> = [];
  let hasPlainSqlInFile = false;
  let hasDmlInFile = false;
  let hasHandlerInFile = false;
  let lastExecKind: 'select' | 'exec' | 'other' | null = null;

  for (let stmtIdx = 0; stmtIdx < statements.length; stmtIdx++) {
    const stmt = statements[stmtIdx];
    const toks = stmt.tokens;

    // 1. Track sanitization calls & variable taint
    for (let i = 0; i + 2 < toks.length; i++) {
      if (
        (isWord(toks[i], 'IS_SQL_INJECTION_SAFE') ||
          isWord(toks[i], 'ESCAPE_SINGLE_QUOTES') ||
          isWord(toks[i], 'ESCAPE_DOUBLE_QUOTES')) &&
        toks[i + 1].text === '(' &&
        (toks[i + 2].type === 'var' || toks[i + 2].type === 'word')
      ) {
        safeVars.add(toks[i + 2].text.toUpperCase());
      }
    }
    if (toks.length >= 4 && toks[1].text === '=' && (toks[0].type === 'var' || toks[0].type === 'word')) {
      const lhsName = toks[0].text.toUpperCase();
      const rhsConcat = toks.slice(2).some((t) => t.text === '||');
      if (rhsConcat) taintedVars.add(lhsName);
    }

    // 2. Dynamic SQL & APPLY_FILTER
    const isDynamicExec = isWord(toks[0], 'EXEC') || (isWord(toks[0], 'EXECUTE') && isWord(toks[1], 'IMMEDIATE'));
    if (checkSec && isDynamicExec) {
      analyzeDynamicSqlStatement(stmt, text, safeVars, taintedVars, diagnostics);
    } else if (checkPerf && isDynamicExec) {
      // Performance note covered inside analyzeDynamicSqlStatement when security enabled
      diagnostics.push({
        ruleId: 'HANA-PERF-006',
        sapCode: 'SAP.USE_OF_DYNAMIC_SQL.SECURITY',
        category: 'performance',
        severity: 'information',
        message: 'Dynamic SQL (SAP.USE_OF_DYNAMIC_SQL) prevents static dependency analysis and statement inlining.',
        start: stmt.start,
        end: stmt.end,
        fixes: [],
      });
    }

    if (checkSec) {
      checkApplyFilterCalls(stmt, safeVars, taintedVars, diagnostics);
    }

    // 3. Handler rules (HANA-LINT-001)
    if (isWord(toks[0], 'DECLARE') && (isWord(toks[1], 'EXIT') || isWord(toks[1], 'CONTINUE')) && isWord(toks[2], 'HANDLER')) {
      hasHandlerInFile = true;
      if (checkPerf && isWord(toks[1], 'EXIT')) {
        analyzeHandlerStatement(statements, stmtIdx, text, diagnostics);
      }
    }

    // 4. CE_* operators detection
    let stmtHadCe = false;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'word') continue;
      const fnName = toks[i].text.toUpperCase();
      if (CE_FUNCTIONS.has(fnName) && toks[i + 1]?.text === '(') {
        if (fnName === 'CE_CALC') continue; // CE_CALC lives inside CE_PROJECTION list; handled by parent
        stmtHadCe = true;
        const closeParen = findMatchingClose(toks, i + 1);
        const ceEnd = closeParen !== -1 ? toks[closeParen].end : toks[i].end;
        const edit = buildCeToSqlEdit(stmt, fnName, i + 1, text);
        ceEntries.push({ stmt, ceName: fnName, start: toks[i].start, end: ceEnd, edit });
      }
    }

    // 5. Plain SQL / DML / DDL tracking
    const firstKw = upper(toks[0]);
    const isAssignSql = toks.length >= 3 && toks[1].text === '=' && isWord(toks[2], 'SELECT');
    const isSelect = !stmtHadCe && (firstKw === 'SELECT' || isAssignSql || firstKw === 'WITH');
    const isDml = DML_KEYWORDS.has(firstKw);
    const isDdl = stmt.inProcedureBody && DDL_KEYWORDS.has(firstKw);

    if (isSelect || isDml) {
      hasPlainSqlInFile = true;
    }
    if (isDml) {
      hasDmlInFile = true;
      if (checkPerf && stmt.loopDepth > 0) {
        diagnostics.push({
          ruleId: 'HANA-PERF-005',
          sapCode: 'SAP.DML_STATEMENTS_IN_LOOPS.PERFORMANCE',
          category: 'performance',
          severity: 'warning',
          message:
            'DML statement inside loop (SAP.DML_STATEMENTS_IN_LOOPS.PERFORMANCE) incurs per-iteration runtime stack transitions. Rewrite as bulk set-based DML.',
          start: stmt.start,
          end: toks[0].end,
          fixes: [],
        });
      }
    }

    if (checkPerf && isDdl) {
      diagnostics.push({
        ruleId: 'HANA-PERF-006',
        sapCode: 'SAP.USE_OF_DDL_STATEMENT.CONSISTENCY',
        category: 'performance',
        severity: 'information',
        message:
          'DDL inside SQLScript procedure (SAP.USE_OF_DDL_STATEMENT.CONSISTENCY) blocks parallel statement scheduling and plan caching.',
        start: stmt.start,
        end: toks[0].end,
        fixes: [],
      });
    }

    // 6. Cursor rules (HANA-PERF-003)
    if (checkPerf) {
      if (
        (isWord(toks[0], 'DECLARE') && isWord(toks[1], 'CURSOR')) ||
        (isWord(toks[0], 'FOR') && toks.some((t) => isWord(t, 'AS'))) ||
        isWord(toks[0], 'OPEN') ||
        isWord(toks[0], 'FETCH')
      ) {
        diagnostics.push({
          ruleId: 'HANA-PERF-003',
          category: 'performance',
          severity: 'warning',
          message:
            'Cursor iteration processes rows sequentially on the SQLScript engine instead of using parallel set-based SQL operators.',
          start: stmt.start,
          end: toks[Math.min(2, toks.length - 1)].end,
          fixes: [],
        });
      }

      // 7. SELECT * and WITH HINT (HANA-PERF-004 / HANA-PERF-006)
      checkSelectStar(stmt, text, [], diagnostics);

      // 8. Suboptimal table var checks: CARDINALITY(:v), SELECT COUNT(*) FROM :v, TRACE(:v) (HANA-PERF-007)
      for (let i = 0; i + 3 < toks.length; i++) {
        if (isWord(toks[i], 'CARDINALITY') && toks[i + 1].text === '(' && toks[i + 2].type === 'var') {
          diagnostics.push({
            ruleId: 'HANA-PERF-007',
            category: 'performance',
            severity: 'information',
            message:
              'Prefer IS_EMPTY(:var) for emptiness checks or RECORD_COUNT(:var) for row counts over COUNT(*)/CARDINALITY(:var).',
            start: toks[i].start,
            end: toks[i + 3].end,
            fixes: [
              {
                title: "Replace 'CARDINALITY' with 'RECORD_COUNT'",
                kind: 'quickfix',
                isPreferred: true,
                edits: [{ start: toks[i].start, end: toks[i].end, newText: 'RECORD_COUNT' }],
              },
            ],
          });
        }
        if (isWord(toks[i], 'TRACE') && toks[i + 1].text === '(' && toks[i + 2].type === 'var') {
          const closeIdx = findMatchingClose(toks, i + 1);
          const varName = toks[i + 2].text;
          const edits: TextEditSpan[] = closeIdx !== -1
            ? [{ start: toks[i].start, end: toks[closeIdx].end, newText: `SELECT * FROM ${varName}` }]
            : [];
          diagnostics.push({
            ruleId: 'HANA-PERF-007',
            category: 'performance',
            severity: 'information',
            message:
              'Remove debug TRACE() operator before production deployment (materializes rows to a temporary trace table).',
            start: toks[i].start,
            end: closeIdx !== -1 ? toks[closeIdx].end : toks[i + 3].end,
            fixes: edits.length > 0
              ? [{ title: `Replace 'TRACE(${varName})' with 'SELECT * FROM ${varName}'`, kind: 'quickfix', edits }]
              : [],
          });
        }
      }

      if (isSelect) {
        const hasCountStar = toks.some(
          (t, idx) =>
            isWord(t, 'COUNT') &&
            toks[idx + 1]?.text === '(' &&
            toks[idx + 2]?.text === '*'
        );
        const fromIdx = toks.findIndex((t) => isWord(t, 'FROM'));
        if (hasCountStar && fromIdx !== -1 && toks[fromIdx + 1]?.type === 'var') {
          diagnostics.push({
            ruleId: 'HANA-PERF-007',
            category: 'performance',
            severity: 'information',
            message:
              'Prefer IS_EMPTY(:var) for emptiness checks or RECORD_COUNT(:var) for row counts over COUNT(*)/CARDINALITY(:var).',
            start: stmt.start,
            end: toks[fromIdx + 1].end,
            fixes: [],
          });
        }
      }

      // 9. ::ROWCOUNT after SELECT or dynamic SQL (HANA-LINT-002)
      for (const tok of toks) {
        if (tok.type === 'sysvar' && tok.text.toUpperCase() === '::ROWCOUNT') {
          if (lastExecKind === 'select' || lastExecKind === 'exec') {
            diagnostics.push({
              ruleId: 'HANA-LINT-002',
              sapCode: lastExecKind === 'exec'
                ? 'SAP.ROW_COUNT_AFTER_DYNAMIC_SQL.CONSISTENCY'
                : 'SAP.ROW_COUNT_AFTER_SELECT.CONSISTENCY',
              category: 'lint',
              severity: 'information',
              message:
                'Use of ::ROWCOUNT after SELECT or dynamic SQL (SAP.ROW_COUNT_AFTER_SELECT / SAP.ROW_COUNT_AFTER_DYNAMIC_SQL) may yield unreliable counts.',
              start: tok.start,
              end: tok.end,
              fixes: [],
            });
          }
        }
      }
    }

    if (isDynamicExec) lastExecKind = 'exec';
    else if (isSelect) lastExecKind = 'select';
    else if (isDml) lastExecKind = 'other';
  }

  // Emit HANA-PERF-001 and HANA-PERF-002 for CE_* calls
  if (checkPerf && ceEntries.length > 0) {
    const ceSeverity: DiagnosticSeverityLevel = targetPlatform === 'cloud' ? 'error' : 'warning';
    const allFixes = ceEntries.map((c) => c.edit).filter((e): e is TextEditSpan => e !== null);

    for (const ce of ceEntries) {
      const fixes: CodeFixSuggestion[] = [];
      if (ce.edit) {
        fixes.push({
          title: `Convert '${ce.ceName}' to standard SQL SELECT`,
          kind: 'quickfix',
          isPreferred: true,
          edits: [ce.edit],
        });
      }
      if (allFixes.length > 1) {
        fixes.push({
          title: `Convert all ${allFixes.length} supported CE_* operators to SQL`,
          kind: 'quickfix',
          edits: allFixes,
        });
      }
      diagnostics.push({
        ruleId: 'HANA-PERF-001',
        sapCode: 'SAP.USE_OF_CE_FUNCTIONS.PERFORMANCE',
        category: 'performance',
        severity: ceSeverity,
        tags: ['deprecated'],
        message: `Calculation Engine operator '${ce.ceName}' prevents SQL Optimizer / L-native optimizations and is removed in SAP HANA Cloud. Rewrite using standard SQL.`,
        start: ce.start,
        end: ce.end,
        fixes,
      });
    }

    if (hasPlainSqlInFile) {
      diagnostics.push({
        ruleId: 'HANA-PERF-002',
        sapCode: 'SAP.USE_OF_CE_FUNCTIONS.PERFORMANCE',
        category: 'performance',
        severity: 'warning',
        message:
          'Procedure mixes Calculation Engine (CE_*) operators with standard SQL. This forces intermediate materialization across engines and blocks query inlining.',
        start: ceEntries[0].start,
        end: ceEntries[0].end,
        fixes: allFixes.length > 0
          ? [{
              title: 'Convert all supported CE_* operators in block to standard SQL',
              kind: 'quickfix',
              isPreferred: true,
              edits: allFixes,
            }]
          : [],
      });
    }
  }

  // Procedure / Function header rules (HANA-SEC-003, HANA-SEC-004, HANA-MIG-010, HANA-LINT-002)
  for (const h of headers) {
    const bodyToks = codeTokens.slice(h.bodyStartTokenIdx, h.bodyEndTokenIdx + 1);
    const hasDynSql = bodyToks.some(
      (t, idx) =>
        isWord(t, 'EXEC') ||
        (isWord(t, 'EXECUTE') && isWord(bodyToks[idx + 1], 'IMMEDIATE')) ||
        isWord(t, 'APPLY_FILTER')
    );

    let firedSec003OnOmitted = false;
    if (checkSec && !h.isTableUdf && hasDynSql) {
      if (!h.securityClause || h.securityClause.mode === 'DEFINER') {
        const edits: TextEditSpan[] = h.securityClause
          ? [{ start: h.securityClause.modeStart, end: h.securityClause.modeEnd, newText: 'INVOKER' }]
          : h.insertSecurityAt !== undefined
            ? [{ start: h.insertSecurityAt, end: h.insertSecurityAt, newText: 'SQL SECURITY INVOKER ' }]
            : [];
        if (!h.securityClause) firedSec003OnOmitted = true;
        diagnostics.push({
          ruleId: 'HANA-SEC-003',
          category: 'security',
          severity: 'warning',
          message:
            'Procedure runs with SQL SECURITY DEFINER privileges while executing dynamic SQL. Switch to SQL SECURITY INVOKER to enforce caller authorizations.',
          start: h.securityClause ? h.securityClause.modeStart : h.nameStart,
          end: h.securityClause ? h.securityClause.modeEnd : h.nameEnd,
          fixes: edits.length > 0
            ? [{ title: 'Switch to SQL SECURITY INVOKER', kind: 'quickfix', isPreferred: true, edits }]
            : [],
        });
      }
    }

    if (checkSec && !h.securityClause && !firedSec003OnOmitted) {
      const editsInvoker: TextEditSpan[] = h.insertSecurityAt !== undefined
        ? [{ start: h.insertSecurityAt, end: h.insertSecurityAt, newText: 'SQL SECURITY INVOKER ' }]
        : [];
      const editsDefiner: TextEditSpan[] = h.insertSecurityAt !== undefined
        ? [{ start: h.insertSecurityAt, end: h.insertSecurityAt, newText: 'SQL SECURITY DEFINER ' }]
        : [];
      const fixes: CodeFixSuggestion[] = [];
      if (editsInvoker.length > 0 && !h.isTableUdf) {
        fixes.push({
          title: 'Add SQL SECURITY INVOKER',
          kind: 'quickfix',
          isPreferred: true,
          edits: editsInvoker,
        });
      }
      if (editsDefiner.length > 0) {
        fixes.push({
          title: 'Add SQL SECURITY DEFINER',
          kind: 'quickfix',
          isPreferred: h.isTableUdf,
          edits: editsDefiner,
        });
      }
      diagnostics.push({
        ruleId: 'HANA-SEC-004',
        category: 'security',
        severity: 'information',
        message:
          'SQL SECURITY mode is omitted; SAP HANA defaults to DEFINER. Declare SQL SECURITY INVOKER or SQL SECURITY DEFINER explicitly.',
        start: h.nameStart,
        end: h.nameEnd,
        fixes,
      });
    }

    if (
      checkMig &&
      h.defaultSchemaSpan &&
      (languageId === 'hdbprocedure' ||
        languageId === 'hdbfunction' ||
        languageId === 'hdbtablefunction' ||
        targetPlatform === 'hdi' ||
        targetPlatform === 'cloud')
    ) {
      diagnostics.push({
        ruleId: 'HANA-MIG-010',
        category: 'migration',
        severity: 'warning',
        message:
          "'DEFAULT SCHEMA' is disallowed in schema-agnostic HDI deployments. Remove DEFAULT SCHEMA and rely on the HDI container schema.",
        start: h.defaultSchemaSpan.start,
        end: h.defaultSchemaSpan.end,
        fixes: [
          {
            title: 'Remove DEFAULT SCHEMA clause for HDI compatibility',
            kind: 'quickfix',
            isPreferred: true,
            edits: [{ start: h.defaultSchemaSpan.start, end: h.defaultSchemaSpan.end, newText: '' }],
          },
        ],
      });
    }

    if (checkPerf && h.kind === 'PROCEDURE' && hasDmlInFile && !hasHandlerInFile) {
      diagnostics.push({
        ruleId: 'HANA-LINT-002',
        category: 'lint',
        severity: 'information',
        message:
          "Procedure performs DML without a 'DECLARE EXIT HANDLER FOR SQLEXCEPTION'. Add error handling or ensure callers handle exceptions.",
        start: h.nameStart,
        end: h.nameEnd,
        fixes: [],
      });
    }
  }

  // Missing handler check even on headerless single-block procedures already caught in headers!

  if (checkMig) {
    checkSysBicAndSchemaPrefixes(codeTokens, languageId, targetPlatform, diagnostics);
  }

  return filterSuppressedDiagnostics(text, diagnostics);
}
