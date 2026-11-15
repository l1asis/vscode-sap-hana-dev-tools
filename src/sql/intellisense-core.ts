import {
  SQL_BUILT_IN_LIBRARIES,
  SQL_FUNCTIONS,
  SQL_KEYWORD_ENTRIES,
  SQL_KEYWORDS_MAP,
  SQL_LIBRARY_MEMBERS,
  SQL_SYSTEM_VARIABLES,
  type SqlFunctionEntry,
  type SqlKeywordEntry,
} from './sql-catalog';
import { type CaseMode } from '../formatter/options';

export type TargetPlatform = 'auto' | 'xsc' | 'hdi' | 'cloud';

export interface SqlIntelliSenseOptions {
  readonly keywordCase?: CaseMode;
  readonly functionCase?: CaseMode;
  readonly dataTypeCase?: CaseMode;
  readonly targetPlatform?: TargetPlatform;
}

export type SqlCompletionKind =
  | 'keyword'
  | 'type'
  | 'constant'
  | 'function'
  | 'variable'
  | 'module';

export interface SqlCompletionCandidate {
  readonly label: string;
  readonly insertText: string;
  readonly isSnippet?: boolean;
  readonly filterText?: string;
  readonly kind: SqlCompletionKind;
  readonly detail: string;
  readonly documentation: string;
  readonly deprecated?: string;
  readonly sortPrefix: string;
  readonly replaceStart?: number;
  readonly replaceEnd?: number;
}

export interface SqlHoverResult {
  readonly markdown: string;
  readonly start: number;
  readonly end: number;
}

export interface SqlSignatureParamInfo {
  readonly label: string;
  readonly documentation: string;
}

export interface SqlSignatureInfo {
  readonly label: string;
  readonly documentation: string;
  readonly deprecated?: string;
  readonly parameters: readonly SqlSignatureParamInfo[];
}

export interface SqlSignatureHelpResult {
  readonly signatures: readonly SqlSignatureInfo[];
  readonly activeSignature: number;
  readonly activeParameter: number;
}

export interface SqlLocalVariable {
  readonly name: string;
  readonly declarationKind: 'IN' | 'OUT' | 'INOUT' | 'DECLARE' | 'FOR';
  readonly dataType: string;
}

const SQL_IDENT_RE = /[a-zA-Z0-9_$#]/;

interface SqlScanState {
  readonly masked: string;
  readonly inComment: boolean;
  readonly inString: boolean;
  readonly inDoubleQuote: boolean;
}

/**
 * Masks SQL comments (`--`, `//`, `/* *\/`), single-quoted strings (`'...'`),
 * and double-quoted identifiers (`"..."`) while preserving character offsets.
 */
function scanSqlToMask(text: string, cursorOffset?: number): SqlScanState {
  const chars = text.split('');
  const limit = cursorOffset !== undefined ? cursorOffset : text.length;
  let i = 0;
  let inComment = false;
  let inString = false;
  let inDoubleQuote = false;

  while (i < chars.length) {
    const c = chars[i];
    const next = chars[i + 1] ?? '';

    if ((c === '-' && next === '-') || (c === '/' && next === '/')) {
      const start = i;
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < chars.length && chars[i] !== '\n') {
        chars[i] = ' ';
        i++;
      }
      if (cursorOffset !== undefined && limit > start && limit <= i) {
        inComment = true;
      }
      continue;
    }

    if (c === '/' && next === '*') {
      const start = i;
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') chars[i] = ' ';
        i++;
      }
      if (i + 1 < chars.length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
        if (cursorOffset !== undefined && limit > start && limit <= i) {
          inComment = true;
        }
      } else if (cursorOffset !== undefined && limit > start) {
        inComment = true;
      }
      continue;
    }

    if (c === '\'' || c === '"') {
      const quote = c;
      const start = i;
      i++;
      while (i < chars.length) {
        if (chars[i] === quote) {
          if (chars[i + 1] === quote) {
            chars[i] = ' ';
            chars[i + 1] = ' ';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (chars[i] !== '\n') chars[i] = ' ';
        i++;
      }
      // If string is unclosed, mask runs to EOF so cursor past start is inside string
      const closed = i > start + 1 && text[i - 1] === quote;
      const effectiveEnd = closed ? i : chars.length + 1;
      if (cursorOffset !== undefined && limit > start && limit < effectiveEnd) {
        if (quote === '\'') inString = true;
        else inDoubleQuote = true;
      }
      continue;
    }

    i++;
  }

  return { masked: chars.join(''), inComment, inString, inDoubleQuote };
}

function applyCase(canonicalUpper: string, mode: CaseMode | undefined): string {
  return mode === 'lower' ? canonicalUpper.toLowerCase() : canonicalUpper;
}

const FUNCTIONS_BY_NAME: ReadonlyMap<string, SqlFunctionEntry> = new Map(
  SQL_FUNCTIONS.map((f) => [f.name.toUpperCase(), f])
);

const LIBRARIES_BY_NAME = new Map(
  SQL_BUILT_IN_LIBRARIES.map((l) => [l.name.toUpperCase(), l])
);

function parseUsingLibraries(masked: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const re = /\bUSING\s+(?:SYS\s*\.\s*)?(SQLSCRIPT_[A-Z0-9_]+)(?:\s+AS\s+([a-zA-Z_][a-zA-Z0-9_$#]*))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const libName = m[1].toUpperCase();
    const aliasName = (m[2] ?? libName).toUpperCase();
    aliases.set(aliasName, libName);
  }
  return aliases;
}

export function extractSqlLocalVariables(masked: string, limitOffset: number): readonly SqlLocalVariable[] {
  const slice = masked.slice(0, limitOffset);
  const vars = new Map<string, SqlLocalVariable>();

  // 1. Procedure / Function parameters: IN|OUT|INOUT <name> <type>
  const paramRe = /(?:^|[(,\s])(IN|OUT|INOUT)\s+([a-zA-Z_][a-zA-Z0-9_$#]*)\s+(TABLE\s*\([^)]*\)|[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\([^)]*\))?(?:\s+ARRAY)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(slice)) !== null) {
    const dir = m[1].toUpperCase() as 'IN' | 'OUT' | 'INOUT';
    const name = m[2];
    const dataType = m[3].replace(/\s+/g, ' ').trim();
    if (/^(CONDITION|CURSOR|HANDLER|EXIT|CONTINUE|UNDO)$/i.test(dataType)) continue;
    vars.set(name.toUpperCase(), { name, declarationKind: dir, dataType });
  }

  // 2. DECLARE <var1> [, <var2>...] [CONSTANT] <type|TABLE|CURSOR|CONDITION>
  const declRe = /\bDECLARE\s+([a-zA-Z_][a-zA-Z0-9_$#]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_$#]*)*)\s+(?:CONSTANT\s+)?(TABLE\s*\(|CURSOR\s+FOR|CONDITION\b|[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\([^)]*\))?(?:\s+ARRAY)?)/gi;
  while ((m = declRe.exec(slice)) !== null) {
    const namesPart = m[1];
    const typeRaw = m[2].replace(/\s+/g, ' ').trim();
    if (/^(EXIT|CONTINUE|UNDO)$/i.test(namesPart.trim())) continue;
    if (/^HANDLER$/i.test(typeRaw)) continue;
    const dataType = typeRaw.endsWith('(') ? `${typeRaw}...)` : typeRaw;
    for (const part of namesPart.split(',')) {
      const name = part.trim();
      if (!name) continue;
      vars.set(name.toUpperCase(), { name, declarationKind: 'DECLARE', dataType });
    }
  }

  // 3. FOR <iterVar> IN ... numeric range loop variable
  const forRe = /\bFOR\s+([a-zA-Z_][a-zA-Z0-9_$#]*)\s+IN\b/gi;
  while ((m = forRe.exec(slice)) !== null) {
    const name = m[1];
    vars.set(name.toUpperCase(), { name, declarationKind: 'FOR', dataType: 'INTEGER' });
  }

  return [...vars.values()];
}

function getWordSpanBefore(masked: string, offset: number): { start: number; prefix: string } {
  let start = offset;
  while (start > 0 && SQL_IDENT_RE.test(masked[start - 1])) {
    start--;
  }
  return { start, prefix: masked.slice(start, offset) };
}

function nextCharIsOpenParen(text: string, offset: number): boolean {
  let i = offset;
  while (i < text.length && /\s/.test(text[i])) i++;
  return text[i] === '(';
}

function buildFunctionInsertText(casedName: string, fn: SqlFunctionEntry, text: string, offset: number): {
  insertText: string;
  isSnippet: boolean;
} {
  if (fn.isConstant || nextCharIsOpenParen(text, offset)) {
    return { insertText: casedName, isSnippet: false };
  }
  const alwaysZeroArg =
    fn.signatures.length > 0 && fn.signatures.every((s) => /\(\s*\)$/.test(s.trim()));
  if (alwaysZeroArg) {
    return { insertText: `${casedName}()`, isSnippet: false };
  }
  return { insertText: `${casedName}($1)`, isSnippet: true };
}

function formatFunctionMarkdown(fn: SqlFunctionEntry, options?: SqlIntelliSenseOptions): string {
  const sigLines = fn.signatures.map((s) => `${s} -> ${fn.returnType}`).join('\n');
  const lines = [`\`\`\`sql\n${sigLines}\n\`\`\``];
  if (fn.deprecatedInCloud && options?.targetPlatform === 'cloud') {
    lines.push('**@deprecated** `CE_*` calculation engine operators are not supported in SAP HANA Cloud; rewrite using standard SQL.');
  }
  if (fn.description) {
    lines.push(fn.description);
  }
  return lines.join('\n\n');
}

function formatKeywordMarkdown(entry: SqlKeywordEntry): string {
  const platforms = entry.platforms.map((p) => `\`[${p}]\``).join(' ');
  const label =
    entry.kind === 'type'
      ? 'data type'
      : entry.kind === 'sysvar'
        ? 'system variable'
        : entry.kind === 'constant'
          ? 'constant'
          : entry.kind === 'pragma'
            ? 'pragma'
            : `${entry.category} keyword`;
  const displayName = entry.kind === 'sysvar' ? `::${entry.name}` : entry.name;
  return `\`\`\`sql\n${displayName}\n\`\`\`\n\nSAP HANA ${label} (${platforms}).`;
}

function toFunctionCompletion(
  fn: SqlFunctionEntry,
  text: string,
  offset: number,
  options?: SqlIntelliSenseOptions,
  sortPrefix = '2'
): SqlCompletionCandidate {
  const fnCase = options?.functionCase ?? 'upper';
  const casedName = applyCase(fn.name, fnCase);
  const { insertText, isSnippet } = buildFunctionInsertText(casedName, fn, text, offset);
  const dep =
    fn.deprecatedInCloud && options?.targetPlatform === 'cloud'
      ? 'Deprecated in SAP HANA Cloud; prefer standard SQL.'
      : undefined;

  return {
    label: casedName,
    insertText,
    ...(isSnippet ? { isSnippet: true } : {}),
    kind: fn.isConstant ? 'constant' : 'function',
    detail: fn.isConstant ? `${fn.returnType} (${fn.library})` : `${fn.signatures[0] ?? fn.name} -> ${fn.returnType}`,
    documentation: formatFunctionMarkdown(fn, options),
    ...(dep ? { deprecated: dep } : {}),
    sortPrefix,
  };
}

function mapKeywordKind(entry: SqlKeywordEntry): SqlCompletionKind {
  switch (entry.kind) {
    case 'type':
      return 'type';
    case 'constant':
      return 'constant';
    case 'sysvar':
    case 'pragma':
      return 'variable';
    case 'function':
      return 'function';
    default:
      return 'keyword';
  }
}

/**
 * Computes offline SAP HANA SQL / SQLScript completions at `offset`.
 */
export function getSqlCompletions(
  text: string,
  offset: number,
  options: SqlIntelliSenseOptions = {}
): readonly SqlCompletionCandidate[] {
  const state = scanSqlToMask(text, offset);
  if (state.inComment || state.inString || state.inDoubleQuote) return [];

  const { masked } = state;
  const { start: wordStart, prefix } = getWordSpanBefore(masked, offset);
  const lowerPrefix = prefix.toLowerCase();
  const keywordCase = options.keywordCase ?? 'upper';
  const dataTypeCase = options.dataTypeCase ?? 'upper';

  // 1. SQLScript `::` system variables (when not preceded by identifier char, so ignores `pkg::Table`)
  if (wordStart >= 2 && masked.slice(wordStart - 2, wordStart) === '::') {
    const beforeColons = wordStart >= 3 ? masked[wordStart - 3] : '';
    if (!beforeColons || !SQL_IDENT_RE.test(beforeColons)) {
      return SQL_SYSTEM_VARIABLES
        .filter((v) => !lowerPrefix || v.name.toLowerCase().startsWith(lowerPrefix))
        .map((v) => {
          const cased = applyCase(v.name, keywordCase);
          return {
            label: `::${cased}`,
            insertText: `::${cased}`,
            filterText: `::${cased}`,
            kind: 'variable' as const,
            detail: 'SQLScript system variable',
            documentation: formatKeywordMarkdown(v),
            sortPrefix: '0',
            replaceStart: wordStart - 2,
            replaceEnd: offset,
          };
        });
    }
    return [];
  }

  // 2. Colon context: `<libAlias>:<member>` OR `:<localVar>`
  if (wordStart >= 1 && masked[wordStart - 1] === ':') {
    const colonPos = wordStart - 1;
    const isLibMember = colonPos > 0 && SQL_IDENT_RE.test(masked[colonPos - 1]);
    if (isLibMember) {
      let aliasStart = colonPos;
      while (aliasStart > 0 && SQL_IDENT_RE.test(masked[aliasStart - 1])) aliasStart--;
      const aliasUpper = masked.slice(aliasStart, colonPos).toUpperCase();
      const aliasMap = parseUsingLibraries(masked);
      const resolvedLib = aliasMap.get(aliasUpper) ?? (SQL_LIBRARY_MEMBERS[aliasUpper] ? aliasUpper : undefined);
      if (!resolvedLib) return [];
      const members = SQL_LIBRARY_MEMBERS[resolvedLib] ?? [];
      return members
        .filter((m) => !lowerPrefix || m.name.toLowerCase().startsWith(lowerPrefix))
        .map((m) => toFunctionCompletion(m, text, offset, options, '0'));
    }

    // Local parameter / declared variable reference `:<var>`
    const locals = extractSqlLocalVariables(masked, wordStart);
    return locals
      .filter((v) => !lowerPrefix || v.name.toLowerCase().startsWith(lowerPrefix))
      .map((v) => ({
        label: `:${v.name}`,
        insertText: v.name,
        filterText: v.name,
        kind: 'variable' as const,
        detail: `${v.declarationKind} ${v.dataType}`,
        documentation: `\`\`\`sql\n(${v.declarationKind}) :${v.name} ${v.dataType}\n\`\`\``,
        sortPrefix: '0',
        replaceStart: wordStart,
        replaceEnd: offset,
      }));
  }

  // 3. `USING [SYS.]` or `SYS.` built-in SQLScript libraries
  const beforeWord = masked.slice(0, wordStart);
  const isUsingContext = /(?:^|[\s;])USING\s+(?:SYS\s*\.\s*)?$/i.test(beforeWord);
  const isSysDotContext = /(?:^|[^a-zA-Z0-9_$#])SYS\s*\.\s*$/i.test(beforeWord);

  if (isUsingContext || isSysDotContext) {
    const libCandidates: SqlCompletionCandidate[] = SQL_BUILT_IN_LIBRARIES
      .filter((lib) => !lowerPrefix || lib.name.toLowerCase().startsWith(lowerPrefix))
      .map((lib) => {
        const cased = applyCase(lib.name, keywordCase);
        return {
          label: cased,
          insertText: cased,
          kind: 'module' as const,
          detail: lib.fullName,
          documentation: `\`\`\`sql\nUSING ${lib.fullName} AS <alias>;\n\`\`\`\n\n${lib.description}`,
          sortPrefix: '0',
        };
      });

    if (isSysDotContext) {
      for (const fn of SQL_FUNCTIONS) {
        if (fn.library !== 'SYS') continue;
        if (lowerPrefix && !fn.name.toLowerCase().startsWith(lowerPrefix)) continue;
        libCandidates.push(toFunctionCompletion(fn, text, offset, options, '2'));
      }
    }
    return libCandidates;
  }

  // Suppress SQL keyword noise after arbitrary `<table_or_alias>.`
  if (wordStart >= 1 && masked[wordStart - 1] === '.') {
    return [];
  }

  // 4. General identifier context: keywords, types, constants, and built-in functions
  const candidates: SqlCompletionCandidate[] = [];
  const emittedUpper = new Set<string>();

  for (const fn of SQL_FUNCTIONS) {
    if (lowerPrefix && !fn.name.toLowerCase().startsWith(lowerPrefix)) continue;
    emittedUpper.add(fn.name.toUpperCase());
    candidates.push(toFunctionCompletion(fn, text, offset, options, fn.deprecatedInCloud ? '3' : '2'));
  }

  for (const kw of SQL_KEYWORD_ENTRIES) {
    if (kw.kind === 'sysvar' || kw.kind === 'pragma') continue;
    const upper = kw.name.toUpperCase();
    if (emittedUpper.has(upper)) continue;
    if (lowerPrefix && !kw.name.toLowerCase().startsWith(lowerPrefix)) continue;
    const cased =
      kw.kind === 'type'
        ? applyCase(kw.name, dataTypeCase)
        : kw.kind === 'function'
          ? applyCase(kw.name, options.functionCase ?? 'upper')
          : applyCase(kw.name, keywordCase);
    candidates.push({
      label: cased,
      insertText: cased,
      kind: mapKeywordKind(kw),
      detail: kw.kind === 'type' ? 'SAP HANA data type' : `SQL ${kw.kind}`,
      documentation: formatKeywordMarkdown(kw),
      sortPrefix: kw.kind === 'type' ? '2' : '1',
    });
  }

  return candidates;
}

/**
 * Computes offline SAP HANA SQL / SQLScript hover documentation at `offset`.
 */
export function getSqlHover(
  text: string,
  offset: number,
  options: SqlIntelliSenseOptions = {}
): SqlHoverResult | null {
  const state = scanSqlToMask(text, offset);
  if (state.inComment || state.inString || state.inDoubleQuote) return null;

  const { masked } = state;
  let start = offset;
  let end = offset;
  while (start > 0 && SQL_IDENT_RE.test(masked[start - 1])) start--;
  while (end < masked.length && SQL_IDENT_RE.test(masked[end])) end++;
  if (start === end) return null;

  const ident = masked.slice(start, end);
  const identUpper = ident.toUpperCase();

  // 1. `::SYSTEM_VAR`
  if (start >= 2 && masked.slice(start - 2, start) === '::') {
    const beforeColons = start >= 3 ? masked[start - 3] : '';
    if (!beforeColons || !SQL_IDENT_RE.test(beforeColons)) {
      const sysvar = SQL_SYSTEM_VARIABLES.find((v) => v.name.toUpperCase() === identUpper);
      if (sysvar) {
        return {
          markdown: formatKeywordMarkdown(sysvar),
          start: start - 2,
          end,
        };
      }
    }
    return null;
  }

  // 2. Colon context: `<libAlias>:<member>` or `:<localVar>`
  if (start >= 1 && masked[start - 1] === ':') {
    const colonPos = start - 1;
    if (colonPos > 0 && SQL_IDENT_RE.test(masked[colonPos - 1])) {
      let aliasStart = colonPos;
      while (aliasStart > 0 && SQL_IDENT_RE.test(masked[aliasStart - 1])) aliasStart--;
      const aliasUpper = masked.slice(aliasStart, colonPos).toUpperCase();
      const aliasMap = parseUsingLibraries(masked);
      const resolvedLib = aliasMap.get(aliasUpper) ?? (SQL_LIBRARY_MEMBERS[aliasUpper] ? aliasUpper : undefined);
      if (!resolvedLib) return null;
      const member = (SQL_LIBRARY_MEMBERS[resolvedLib] ?? []).find(
        (m) => m.name.toUpperCase() === identUpper
      );
      if (!member) return null;
      return {
        markdown: formatFunctionMarkdown(member, options),
        start,
        end,
      };
    }

    const locals = extractSqlLocalVariables(masked, start);
    const localVar = locals.find((v) => v.name.toUpperCase() === identUpper);
    if (!localVar) return null;
    return {
      markdown: `\`\`\`sql\n(${localVar.declarationKind}) :${localVar.name} ${localVar.dataType}\n\`\`\``,
      start: colonPos,
      end,
    };
  }

  // Suppress false keyword hits on qualified column names (`t.DATE`, `t.USER`), except `SYS.<member>`
  if (start >= 1 && masked[start - 1] === '.') {
    const beforeDot = masked.slice(0, start - 1);
    if (!/(?:^|[^a-zA-Z0-9_$#])SYS\s*$/i.test(beforeDot)) {
      return null;
    }
  }

  // 3. Built-in SQLScript library name (`SQLSCRIPT_STRING`, ...)
  const libInfo = LIBRARIES_BY_NAME.get(identUpper);
  if (libInfo) {
    return {
      markdown: `\`\`\`sql\nUSING ${libInfo.fullName} AS <alias>;\n\`\`\`\n\n${libInfo.description}`,
      start,
      end,
    };
  }

  // 4. Built-in SQL/GraphScript/CE function
  const fn = FUNCTIONS_BY_NAME.get(identUpper);
  if (fn) {
    return {
      markdown: formatFunctionMarkdown(fn, options),
      start,
      end,
    };
  }

  // 5. SQL keyword / type / constant
  const kw = SQL_KEYWORDS_MAP[identUpper];
  if (kw) {
    return {
      markdown: formatKeywordMarkdown(kw),
      start,
      end,
    };
  }

  return null;
}

function parseSignatureParams(signature: string): readonly SqlSignatureParamInfo[] {
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  if (open < 0 || close <= open) return [];
  const inner = signature.slice(open + 1, close).trim();
  if (!inner) return [];

  // Split top-level parameters on commas outside nested parens/brackets
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(' || c === '[' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '>') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());

  return parts.map((p) => ({ label: p, documentation: '' }));
}

function selectActiveSignature(signatures: readonly SqlSignatureInfo[], paramIndex: number): number {
  for (let i = 0; i < signatures.length; i++) {
    const params = signatures[i].parameters;
    if (params.some((p) => p.label.includes('...')) || paramIndex < params.length) {
      return i;
    }
  }
  return 0;
}

/**
 * Computes active function / SQLScript library call signature help inside `(...)`.
 */
export function getSqlSignatureHelp(
  text: string,
  offset: number,
  options: SqlIntelliSenseOptions = {}
): SqlSignatureHelpResult | null {
  const state = scanSqlToMask(text, offset);
  if (state.inComment) return null;

  const { masked } = state;
  let depth = 0;
  let commaCount = 0;
  let openParen = -1;
  for (let i = offset - 1; i >= 0; i--) {
    const c = masked[i];
    if (c === ')') {
      depth++;
    } else if (c === '(') {
      if (depth === 0) {
        openParen = i;
        break;
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      commaCount++;
    } else if (c === ';' && depth === 0) {
      return null;
    }
  }
  if (openParen < 0) return null;

  let end = openParen;
  while (end > 0 && /\s/.test(masked[end - 1])) end--;
  let start = end;
  while (start > 0 && SQL_IDENT_RE.test(masked[start - 1])) start--;
  if (start === end) return null;

  const fnName = masked.slice(start, end);
  const fnUpper = fnName.toUpperCase();
  let fnEntry: SqlFunctionEntry | undefined;

  if (start >= 1 && masked[start - 1] === ':') {
    const colonPos = start - 1;
    if (colonPos > 0 && SQL_IDENT_RE.test(masked[colonPos - 1])) {
      let aliasStart = colonPos;
      while (aliasStart > 0 && SQL_IDENT_RE.test(masked[aliasStart - 1])) aliasStart--;
      const aliasUpper = masked.slice(aliasStart, colonPos).toUpperCase();
      const aliasMap = parseUsingLibraries(masked);
      const resolvedLib = aliasMap.get(aliasUpper) ?? (SQL_LIBRARY_MEMBERS[aliasUpper] ? aliasUpper : undefined);
      if (resolvedLib) {
        fnEntry = (SQL_LIBRARY_MEMBERS[resolvedLib] ?? []).find(
          (m) => m.name.toUpperCase() === fnUpper
        );
      }
    }
  } else {
    fnEntry = FUNCTIONS_BY_NAME.get(fnUpper);
  }

  if (!fnEntry || fnEntry.isConstant) return null;

  const deprecated =
    fnEntry.deprecatedInCloud && options.targetPlatform === 'cloud'
      ? 'CE_* operators are deprecated in SAP HANA Cloud; rewrite using standard SQL.'
      : undefined;

  const signatures: SqlSignatureInfo[] = fnEntry.signatures.map((sig) => ({
    label: `${sig} -> ${fnEntry!.returnType}`,
    documentation: fnEntry!.description,
    ...(deprecated ? { deprecated } : {}),
    parameters: parseSignatureParams(sig),
  }));

  return {
    signatures,
    activeSignature: selectActiveSignature(signatures, commaCount),
    activeParameter: commaCount,
  };
}
