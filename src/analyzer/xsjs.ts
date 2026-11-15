import {
  filterSuppressedDiagnostics,
  type AnalyzerContext,
  type AnalyzerDiagnostic,
  type CodeFixSuggestion,
  type TextEditSpan,
} from './types';

interface JsSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: 'code' | 'string' | 'template' | 'lineComment' | 'blockComment';
}

/**
 * Scans JS/XSJS text into top-level spans separating code from strings, templates, and comments.
 */
function scanJsSpans(text: string): JsSpan[] {
  const spans: JsSpan[] = [];
  let i = 0;
  let codeStart = 0;
  const n = text.length;

  const flushCode = (end: number): void => {
    if (end > codeStart) spans.push({ start: codeStart, end, kind: 'code' });
  };

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1] ?? '';

    if (ch === '/' && next === '/') {
      flushCode(i);
      const start = i;
      i += 2;
      while (i < n && text[i] !== '\n') i++;
      spans.push({ start, end: i, kind: 'lineComment' });
      codeStart = i;
      continue;
    }

    if (ch === '/' && next === '*') {
      flushCode(i);
      const start = i;
      i += 2;
      while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      spans.push({ start, end: i, kind: 'blockComment' });
      codeStart = i;
      continue;
    }

    if (ch === '\'' || ch === '"') {
      flushCode(i);
      const start = i;
      const quote = ch;
      i++;
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        if (text[i] === '\n') break;
        i++;
      }
      spans.push({ start, end: i, kind: 'string' });
      codeStart = i;
      continue;
    }

    if (ch === '`') {
      flushCode(i);
      const start = i;
      i++;
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '`') {
          i++;
          break;
        }
        i++;
      }
      spans.push({ start, end: i, kind: 'template' });
      codeStart = i;
      continue;
    }

    i++;
  }

  flushCode(n);
  return spans;
}

/**
 * Produces a code-only string matching `text.length` where string contents & comments are spaces
 * (keeping string delimiters `'`/`"`/`` ` `` at their exact offsets).
 */
function buildMaskedJsCode(text: string): string {
  const spans = scanJsSpans(text);
  const out = text.split('');
  for (const s of spans) {
    if (s.kind === 'lineComment' || s.kind === 'blockComment') {
      for (let k = s.start; k < s.end; k++) {
        if (out[k] !== '\n') out[k] = ' ';
      }
    } else if (s.kind === 'string' || s.kind === 'template') {
      for (let k = s.start + 1; k < s.end - 1; k++) {
        if (out[k] !== '\n') out[k] = ' ';
      }
    }
  }
  return out.join('');
}

function findBalancedParenEnd(masked: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelJsArgs(masked: string, text: string, start: number, end: number): Array<{ start: number; end: number; raw: string }> {
  const args: Array<{ start: number; end: number; raw: string }> = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let argStart = start;

  for (let i = start; i < end; i++) {
    const ch = masked[i];
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === ',' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      args.push({ start: argStart, end: i, raw: text.slice(argStart, i).trim() });
      argStart = i + 1;
    }
  }

  const tail = text.slice(argStart, end).trim();
  if (tail || args.length > 0) {
    args.push({ start: argStart, end, raw: tail });
  }
  return args;
}

function splitTopLevelPlus(maskedSlice: string, rawSlice: string): Array<{ raw: string; isString: boolean; isTemplate: boolean }> | null {
  const parts: Array<{ raw: string; isString: boolean; isTemplate: boolean }> = [];
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let start = 0;

  for (let i = 0; i < maskedSlice.length; i++) {
    const ch = maskedSlice[i];
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === '+' && maskedSlice[i + 1] !== '+' && maskedSlice[i - 1] !== '+' &&
      depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      parts.push(classifyExprPart(rawSlice.slice(start, i)));
      start = i + 1;
    }
  }

  parts.push(classifyExprPart(rawSlice.slice(start)));
  return parts;
}

function classifyExprPart(rawPart: string): { raw: string; isString: boolean; isTemplate: boolean } {
  const t = rawPart.trim();
  const isString =
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('\'') && t.endsWith('\'')));
  const isTemplate = t.length >= 2 && t.startsWith('`') && t.endsWith('`');
  return { raw: t, isString, isTemplate };
}

function unquoteJsString(s: string): string {
  if (s.length < 2) return s;
  const inner = s.slice(1, -1);
  return inner.replace(/\\(.)/g, '$1');
}

function buildParameterizedXsjsFix(
  text: string,
  masked: string,
  methodName: string,
  callStart: number,
  openParen: number,
  closeParen: number,
  stmtVarName: string | null,
  indent: string
): CodeFixSuggestion | null {
  const args = splitTopLevelJsArgs(masked, text, openParen + 1, closeParen);
  if (args.length === 0) return null;
  const firstArg = args[0];
  const rawArg = text.slice(firstArg.start, firstArg.end);
  const maskedArg = masked.slice(firstArg.start, firstArg.end);

  const bindArgs: string[] = [];
  let sqlResult = '';

  // Case A: Template literal with ${...}
  const trimmed = rawArg.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && /\$\{/.test(trimmed)) {
    const inner = trimmed.slice(1, -1);
    let idx = 0;
    while (idx < inner.length) {
      const exprStart = inner.indexOf('${', idx);
      if (exprStart === -1) {
        sqlResult += inner.slice(idx);
        break;
      }
      sqlResult += inner.slice(idx, exprStart);
      let d = 1;
      let k = exprStart + 2;
      while (k < inner.length && d > 0) {
        if (inner[k] === '{') d++;
        else if (inner[k] === '}') d--;
        k++;
      }
      if (d !== 0) return null;
      const expr = inner.slice(exprStart + 2, k - 1).trim();
      if (!expr) return null;
      if (sqlResult.endsWith('\'') && inner[k] === '\'') {
        sqlResult = sqlResult.slice(0, -1);
        k++;
      }
      sqlResult += '?';
      bindArgs.push(expr);
      idx = k;
    }
  } else {
    // Case B: String concatenation via `+`
    const parts = splitTopLevelPlus(maskedArg, rawArg);
    if (!parts || parts.length < 2) return null;

    let openSqlQuote = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part.raw) return null;
      if (part.isString) {
        let lit = unquoteJsString(part.raw);
        if (openSqlQuote) {
          if (!lit.startsWith('\'')) return null;
          lit = lit.slice(1);
          openSqlQuote = false;
        }
        sqlResult += lit;
        continue;
      }

      if (sqlResult.endsWith('\'') && parts[i + 1]?.isString && unquoteJsString(parts[i + 1].raw).startsWith('\'')) {
        sqlResult = sqlResult.slice(0, -1);
        openSqlQuote = true;
      } else if (sqlResult.endsWith('"')) {
        // Double-quoted identifier cannot safely be parameterized with `?`
        return null;
      }
      sqlResult += '?';
      bindArgs.push(part.raw);
    }
    if (openSqlQuote) return null;
  }

  if (bindArgs.length === 0) return null;
  const escapedSql = JSON.stringify(sqlResult);

  if (methodName === 'executeQuery' || methodName === 'executeUpdate') {
    const restArgs = args.slice(1).map((a) => a.raw).filter(Boolean);
    const allArgs = [escapedSql, ...bindArgs, ...restArgs].join(', ');
    return {
      title: `Parameterize ${methodName}() with '?' placeholders`,
      kind: 'quickfix',
      isPreferred: true,
      edits: [{ start: openParen + 1, end: closeParen, newText: allArgs }],
    };
  }

  // $.db conn.prepareStatement / prepareCall
  const edits: TextEditSpan[] = [{ start: firstArg.start, end: firstArg.end, newText: escapedSql }];
  if (stmtVarName) {
    // Find semicolon ending the prepareStatement line/statement
    let semiPos = closeParen + 1;
    while (semiPos < masked.length && /[ \t]/.test(masked[semiPos])) semiPos++;
    const insertAt = masked[semiPos] === ';' ? semiPos + 1 : closeParen + 1;
    const setterCalls = bindArgs
      .map((arg, i) => `\n${indent}${stmtVarName}.setString(${i + 1}, ${arg});`)
      .join('');
    edits.push({ start: insertAt, end: insertAt, newText: setterCalls });
  }

  void callStart;
  return {
    title: `Parameterize ${methodName}() with '?' placeholders and parameter binding`,
    kind: 'quickfix',
    isPreferred: true,
    edits,
  };
}

/**
 * Checks if `$.db.getConnection()` has a simple single-statement `prepareStatement` + sequential
 * `set*` + `executeUpdate()`/`executeQuery()` sequence that can cleanly convert to `$.hdb`.
 */
function buildDbToHdbFix(
  text: string,
  masked: string,
  connVar: string | null,
  getConnCallStart: number,
  getConnCallEnd: number
): CodeFixSuggestion {
  const simpleEdit: TextEditSpan = {
    start: getConnCallStart,
    end: getConnCallEnd,
    newText: '$.hdb.getConnection',
  };

  if (!connVar) {
    return {
      title: 'Migrate $.db.getConnection() to $.hdb.getConnection()',
      kind: 'quickfix',
      isPreferred: true,
      edits: [simpleEdit],
    };
  }

  // Look ahead within the same function/scope for simple:
  // [var] pstmt = conn.prepareStatement(sql); (pstmt.set*(i, val);)* ([var rs = ] pstmt.executeUpdate|Query();)
  const afterPos = getConnCallEnd;
  const windowSlice = text.slice(afterPos, Math.min(text.length, afterPos + 900));
  const seqRe = new RegExp(
    `^\\(\\s*\\)\\s*;\\s*\\r?\\n([ \\t]*)(?:(?:var|let|const)\\s+)?([a-zA-Z_$][\\w$]*)\\s*=\\s*${connVar}\\.prepareStatement\\s*\\(([^;]+)\\)\\s*;([\\s\\S]*?)\\r?\\n[ \\t]*((?:(?:var|let|const)\\s+[a-zA-Z_$][\\w$]*\\s*=\\s*)?)${connVar ? '\\2' : ''}\\.(executeUpdate|executeQuery)\\(\\s*\\)\\s*;`
  );
  const m = seqRe.exec(windowSlice);
  if (m && !/\.next\s*\(/.test(text.slice(afterPos, Math.min(text.length, afterPos + 1200)))) {
    const indent = m[1];
    const stmtVar = m[2];
    const sqlExpr = m[3].trim();
    const settersBlock = m[4];
    const lhsResultPrefix = m[5];
    const execMethod = m[6];

    const setterRe = new RegExp(
      `\\b${stmtVar}\\.set(?:String|Int|Integer|BigInt|Double|Float|Decimal|Date|Time|Timestamp|Boolean|Clob|Blob)\\s*\\(\\s*(\\d+)\\s*,\\s*([^)]+)\\)\\s*;`,
      'g'
    );
    const paramPairs: Array<{ index: number; expr: string }> = [];
    let sm: RegExpExecArray | null;
    while ((sm = setterRe.exec(settersBlock)) !== null) {
      paramPairs.push({ index: Number(sm[1]), expr: sm[2].trim() });
    }
    const leftovers = settersBlock.replace(setterRe, '').trim();
    if (leftovers === '') {
      paramPairs.sort((a, b) => a.index - b.index);
      const argsList = [sqlExpr, ...paramPairs.map((p) => p.expr)].join(', ');
      const fullEnd = afterPos + m[0].length;
      const replacement = `();\n${indent}${lhsResultPrefix}${connVar}.${execMethod}(${argsList});`;
      return {
        title: `Refactor $.db transaction sequence to $.hdb.${execMethod}()`,
        kind: 'quickfix',
        isPreferred: true,
        edits: [
          simpleEdit,
          { start: getConnCallEnd, end: fullEnd, newText: replacement },
        ],
      };
    }
  }

  void masked;
  return {
    title: 'Migrate $.db.getConnection() to $.hdb.getConnection()',
    kind: 'quickfix',
    isPreferred: true,
    edits: [simpleEdit],
  };
}

/**
 * Analyzes XSJS / XSJSLIB documents for security vulnerabilities and XSC->XSA API issues.
 */
export function analyzeXsjs(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { text } = ctx;
  const opts = ctx.options ?? {};
  const checkSec = opts.security ?? true;
  const checkMig = opts.migration ?? true;

  const masked = buildMaskedJsCode(text);
  const diagnostics: AnalyzerDiagnostic[] = [];

  // 1. Track DB calls & SQL injection sinks (HANA-SEC-010, HANA-SEC-011)
  const dbConnMatches: Array<{ start: number; end: number; connVar: string | null }> = [];
  let hasHdbConnection = false;

  if (checkSec) {
    const hdbRe = /\$\.hdb\.getConnection\b/g;
    if (hdbRe.test(masked)) hasHdbConnection = true;

    const dbRe = /\$\.db\.getConnection\b/g;
    let dbm: RegExpExecArray | null;
    while ((dbm = dbRe.exec(masked)) !== null) {
      const before = masked.slice(Math.max(0, dbm.index - 80), dbm.index);
      const assignM = /(?:var|let|const)?\s*([a-zA-Z_$][\w$]*)\s*=\s*$/.exec(before);
      dbConnMatches.push({
        start: dbm.index,
        end: dbm.index + dbm[0].length,
        connVar: assignM ? assignM[1] : null,
      });
    }

    for (const dbCall of dbConnMatches) {
      const fix = buildDbToHdbFix(text, masked, dbCall.connVar, dbCall.start, dbCall.end);
      diagnostics.push({
        ruleId: 'HANA-SEC-011',
        category: 'security',
        severity: 'warning',
        tags: ['deprecated'],
        message: hasHdbConnection
          ? "Mixing '$.db' and '$.hdb' connections in the same request uses separate database sessions and can cause deadlocks."
          : "'$.db.getConnection()' is deprecated in favor of '$.hdb.getConnection()', which binds parameters inline and avoids positional index mismatches.",
        start: dbCall.start,
        end: dbCall.end,
        fixes: [fix],
      });
    }

    // 2. Dynamic SQL in prepareStatement / prepareCall / executeQuery / executeUpdate (HANA-SEC-010)
    const sqlMethodRe = /\.\s*(prepareStatement|prepareCall|executeQuery|executeUpdate)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = sqlMethodRe.exec(masked)) !== null) {
      const methodName = m[1];
      const openParen = m.index + m[0].length - 1;
      const closeParen = findBalancedParenEnd(masked, openParen);
      if (closeParen === -1) continue;

      const args = splitTopLevelJsArgs(masked, text, openParen + 1, closeParen);
      if (args.length === 0 || !args[0].raw) continue;

      const firstArgText = args[0].raw;
      const firstArgMasked = masked.slice(args[0].start, args[0].end);
      const hasConcat = /(?:^|[^+])\+(?:[^+]|$)/.test(firstArgMasked);
      const hasTemplateInterp =
        firstArgText.startsWith('`') && firstArgText.endsWith('`') && /\$\{/.test(firstArgText);

      // Also detect variable passed directly if declared via `+` concatenation? Basic heuristic covers direct concat & templates.
      if (hasConcat || hasTemplateInterp) {
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        const linePrefix = text.slice(lineStart, m.index);
        const indentMatch = /^([ \t]*)/.exec(linePrefix);
        const indent = indentMatch ? indentMatch[1] : '';
        const assignMatch = /(?:var|let|const)?\s*([a-zA-Z_$][\w$]*)\s*=\s*[^=]+$/.exec(linePrefix);
        const stmtVarName = assignMatch ? assignMatch[1] : null;

        const fix = buildParameterizedXsjsFix(
          text,
          masked,
          methodName,
          m.index,
          openParen,
          closeParen,
          stmtVarName,
          indent
        );
        diagnostics.push({
          ruleId: 'HANA-SEC-010',
          category: 'security',
          severity: 'error',
          message:
            "SQL string concatenation in XSJS enables SQL injection. Use '?' placeholders with bound parameters.",
          start: args[0].start,
          end: args[0].end,
          fixes: fix ? [fix] : [],
        });
      }
    }

    // 3. Reflected XSS: $.response.setBody($.request...) (HANA-SEC-012)
    // Track variables assigned directly from $.request.parameters / body / headers
    const taintedRequestVars = new Set<string>();
    const reqVarRe = /(?:var|let|const)\s+([a-zA-Z_$][\w$]*)\s*=\s*([^;\n]+)/g;
    let rv: RegExpExecArray | null;
    while ((rv = reqVarRe.exec(masked)) !== null) {
      if (/\$\.request\.(?:parameters|body|headers)\b/.test(rv[2]) && !/\bJSON\.stringify\b/.test(rv[2])) {
        taintedRequestVars.add(rv[1]);
      }
    }

    const setBodyRe = /\$\.response\.setBody\s*\(/g;
    let sb: RegExpExecArray | null;
    while ((sb = setBodyRe.exec(masked)) !== null) {
      const openParen = sb.index + sb[0].length - 1;
      const closeParen = findBalancedParenEnd(masked, openParen);
      if (closeParen === -1) continue;
      const argMasked = masked.slice(openParen + 1, closeParen);

      if (/\bJSON\.stringify\b|\bencodeURI|\bencodeURIComponent/.test(argMasked)) continue;
      const directReq = /\$\.request\.(?:parameters|body|headers)\b/.test(argMasked);
      const usesTaintedVar = [...taintedRequestVars].some((v) =>
        new RegExp(`\\b${v}\\b`).test(argMasked)
      );
      if (directReq || usesTaintedVar) {
        diagnostics.push({
          ruleId: 'HANA-SEC-012',
          category: 'security',
          severity: 'warning',
          message:
            'Passing request input directly to $.response.setBody() without encoding or JSON serialization risks reflected XSS.',
          start: sb.index,
          end: closeParen + 1,
          fixes: [],
        });
      }
    }
  }

  // 4. Unsupported XSA migration APIs (HANA-MIG-020)
  if (checkMig) {
    const legacyApiRe = /\$\.(?:repo|config|session\.(?:hasSystemPrivilege|assertSystemPrivilege|hasAppPrivilege|assertAppPrivilege))\b/g;
    let lm: RegExpExecArray | null;
    while ((lm = legacyApiRe.exec(masked)) !== null) {
      const apiName = lm[0];
      diagnostics.push({
        ruleId: 'HANA-MIG-020',
        category: 'migration',
        severity: 'warning',
        message:
          `'${apiName}' is unsupported or semantics changed in XS Advanced (@sap/xsjs). Replace $.session app privileges with XSUAA scopes and remove $.repo / $.config.`,
        start: lm.index,
        end: lm.index + apiName.length,
        fixes: [],
      });
    }

    // Also flag hardcoded `_SYS_BIC` inside XSJS SQL strings when migration checks are enabled
    const spans = scanJsSpans(text);
    for (const s of spans) {
      if (s.kind !== 'string' && s.kind !== 'template') continue;
      const raw = text.slice(s.start, s.end);
      const sysBicM = /(["']?)_SYS_BIC\1\."([^"]+)"/i.exec(raw);
      if (sysBicM) {
        const hitStart = s.start + sysBicM.index;
        const hitEnd = hitStart + sysBicM[0].length;
        const hdiRef = `"${sysBicM[2].replace(/\//g, '::')}"`;
        diagnostics.push({
          ruleId: 'HANA-MIG-011',
          category: 'migration',
          severity: 'warning',
          message: `Hardcoded _SYS_BIC reference '${sysBicM[0]}' in XSJS query. Replace with container object '${hdiRef}'.`,
          start: hitStart,
          end: hitEnd,
          fixes: [
            {
              title: `Replace '${sysBicM[0]}' with '${hdiRef}'`,
              kind: 'quickfix',
              isPreferred: true,
              edits: [{ start: hitStart, end: hitEnd, newText: hdiRef }],
            },
          ],
        });
      }
    }
  }

  return filterSuppressedDiagnostics(text, diagnostics);
}
