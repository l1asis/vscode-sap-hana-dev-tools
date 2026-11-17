/**
 * SQL / SQLScript statement walker and statement-starter validation (`HANA-SYN-041`)
 * `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`.
 *
 * Follows the compound-statement structure of a SQL section (routine bodies via the consuming header parser,
 * `BEGIN ... END`, `IF / ELSEIF / ELSE`, `WHILE`, `FOR`, `LOOP`, statement-level `CASE`, `DECLARE ... HANDLER`,
 * library member scope) and validates that every statement starts with a valid starter for its scope:
 * a documented SQL statement verb, a SQLScript imperative keyword, a parenthesized query, or an imperative
 * assignment / method-call target (`[:]<ident>[[<expr>] | .<ident>]* (:= | = | .<method>(...))`).
 *
 * Grammar: `docs/specs/grammars/sql-sqlscript.md` §4.1, rules: `docs/specs/diagnostics/syntax-rules.md`.
 * Simple (non-compound) statements and compound-statement conditions are handed to
 * {@link StatementWalkerHooks} so clause-level parsers can validate their tokens.
 */
import { type Token } from '../formatter/tokenizer';
import { parseRoutineHeader } from './sql-header';
import { matchKeywordTypo } from './typo';
import { type AnalyzerDiagnostic, type CodeFixSuggestion } from './types';

/** Documented SAP HANA SQL statement verbs (first word of every `<X> Statement` in the SQL Reference). */
export const SQL_STATEMENT_STARTERS: ReadonlySet<string> = new Set<string>([
  'ALTER',
  'ANNOTATE',
  'BACKUP',
  'CALL',
  'CANCEL',
  'COMMENT',
  'COMMIT',
  'CONNECT',
  'CREATE',
  'DELETE',
  'DO',
  'DROP',
  'EXPLAIN',
  'EXPORT',
  'GRANT',
  'IMPORT',
  'INSERT',
  'LOAD',
  'LOCK',
  'MERGE',
  'RECOVER',
  'REFRESH',
  'RELEASE',
  'RENAME',
  'REPLACE',
  'REVOKE',
  'ROLLBACK',
  'SAVEPOINT',
  'SELECT',
  'SET',
  'TRUNCATE',
  'UNLOAD',
  'UNSET',
  'UPDATE',
  'UPSERT',
  'VALIDATE',
  'VALUES',
  'WITH',
]);

/** SQLScript imperative statement starters (SQLScript Reference, Imperative SQLScript Logic). */
export const SQLSCRIPT_STATEMENT_STARTERS: ReadonlySet<string> = new Set<string>([
  'BEGIN',
  'BREAK',
  'CALL',
  'CASE',
  'CLOSE',
  'CONTINUE',
  'DECLARE',
  'DO',
  'EXEC',
  'EXECUTE',
  'FETCH',
  'FOR',
  'IF',
  'LOOP',
  'OPEN',
  'RESIGNAL',
  'RETURN',
  'SIGNAL',
  'USING',
  'WHILE',
  'WITH',
]);

const LIBRARY_MEMBER_STARTERS: ReadonlySet<string> = new Set<string>(['PUBLIC', 'PRIVATE', 'USING', 'VARIABLE', 'PROCEDURE', 'FUNCTION']);

/** Routine / header-like words that open a construct parsed by `parseRoutineHeader`. */
const HEADER_WORDS: ReadonlySet<string> = new Set<string>(['CREATE', 'ALTER', 'VIRTUAL', 'PROCEDURE', 'FUNCTION', 'LIBRARY', 'TRIGGER', 'DO', 'PUBLIC', 'PRIVATE']);

const END_SUFFIXES: ReadonlySet<string> = new Set<string>(['IF', 'LOOP', 'WHILE', 'FOR', 'CASE']);
const BLOCK_MODIFIERS: ReadonlyArray<readonly [string, string]> = [
  ['SEQUENTIAL', 'EXECUTION'],
  ['PARALLEL', 'EXECUTION'],
  ['AUTONOMOUS', 'TRANSACTION'],
];

export type StatementScope = 'top' | 'block' | 'library';

export interface StatementWalkerHooks {
  /**
   * Validates one simple statement. `start` is its first token (after prefixes, already validated as a
   * starter) and `end` the index of its terminating `;`, of the stop token that ends it, or EOF. The walker
   * owns statement extents; hooks only inspect `[start, end)`.
   */
  readonly checkStatement?: (start: number, end: number, scope: StatementScope) => void;
  /** Validates an `IF` / `ELSEIF` / `WHILE` condition spanning `[start, end)`; `tokens[end]` is `THEN` / `DO`. */
  readonly checkCondition?: (start: number, end: number, keyword: string) => void;
}

export interface SqlStatementOptions {
  readonly languageId: string;
  readonly codeTokens: readonly Token[];
  readonly baseOffset: number;
  /** Validate top-level starters (`false` for headerless HDI artifacts whose root is checked by HANA-SYN-004). */
  readonly validateTopLevel: boolean;
  /** Extra valid top-level starters (headerless roots in `.hdbmigrationtable`). */
  readonly extraTopStarters?: ReadonlySet<string>;
  /** Offsets (relative to the section) whose diagnostics must not be duplicated or that are already broken. */
  readonly isBlocked: (tok: Token) => boolean;
  readonly diagnostics: AnalyzerDiagnostic[];
  readonly hooks?: StatementWalkerHooks;
}

/** Returns `true` when `tokens[i]` starts an imperative assignment / method-call target. */
export function isImperativeTarget(tokens: readonly Token[], i: number): boolean {
  const t = tokens[i];
  if (!t) return false;
  // Multi-target assignment from a multi-output scalar UDF: `(i, j) = SUDF(...);`
  if (t.text === '(') {
    let j = i + 1;
    for (;;) {
      const v = tokens[j];
      if (!v || (v.type !== 'word' && v.type !== 'qident' && v.type !== 'var')) return false;
      j++;
      if (tokens[j]?.text === ',') {
        j++;
        continue;
      }
      return tokens[j]?.text === ')' && (tokens[j + 1]?.text === '=' || tokens[j + 1]?.text === ':=');
    }
  }
  // Library member procedure call: `lib:proc(...)` (tokenized as one word).
  if (t.type === 'word' && /^[^:]+:[^:]+$/.test(t.text) && tokens[i + 1]?.text === '(') return true;
  let j = i;
  if (t.type === 'var' || t.type === 'qident') {
    j++;
  } else if (t.type === 'word') {
    j++;
    if (tokens[j]?.type === 'var' && !tokens[j].wsBefore) j++; // `lib:member`
  } else {
    return false;
  }
  let lastWasMember = false;
  for (;;) {
    const n = tokens[j];
    if (n?.text === '.' && (tokens[j + 1]?.type === 'word' || tokens[j + 1]?.type === 'qident')) {
      j += 2;
      lastWasMember = true;
    } else if (n?.text === '[') {
      let depth = 0;
      for (; j < tokens.length; j++) {
        if (tokens[j].text === '[') depth++;
        else if (tokens[j].text === ']' && --depth === 0) break;
        else if (tokens[j].text === ';') return false;
      }
      j++;
      lastWasMember = false;
    } else {
      break;
    }
  }
  const op = tokens[j]?.text;
  return op === '=' || op === ':=' || (op === '(' && lastWasMember);
}

/**
 * Walks every statement of a SQL section and reports invalid statement starters (`HANA-SYN-041`, or
 * `HANA-SYN-021` with a QuickFix when the starter is a typo of a valid keyword for the scope).
 */
export function checkSqlStatements(opts: SqlStatementOptions): void {
  const { codeTokens: T, baseOffset, diagnostics, isBlocked, hooks } = opts;
  const n = T.length;
  const up = (i: number): string => (T[i]?.type === 'word' ? T[i].text.toUpperCase() : '');
  const text = (i: number): string => T[i]?.text ?? '';
  const existingStarts = new Set(diagnostics.map((d) => d.start));

  const report = (
    i: number,
    ruleId: string,
    message: string,
    fixes: readonly CodeFixSuggestion[] = [],
    supersedes?: string
  ): void => {
    const tok = T[i];
    if (!tok || isBlocked(tok)) return;
    const start = baseOffset + tok.start;
    if (supersedes) {
      const k = diagnostics.findIndex((d) => d.start === start && d.ruleId === supersedes);
      if (k >= 0) {
        diagnostics.splice(k, 1);
        existingStarts.delete(start);
      }
    }
    if (existingStarts.has(start)) return;
    existingStarts.add(start);
    diagnostics.push({ ruleId, category: 'syntax', severity: 'error', message, start, end: baseOffset + tok.end, fixes });
  };

  /** Skips `@pragma(...)`, `#[INLINE]`-style hints, and `label:` prefixes. */
  const skipPrefixes = (i: number): number => {
    for (;;) {
      if (text(i) === '@' && T[i]?.type === 'other' && T[i + 1]?.type === 'word') {
        i += 2;
        if (text(i) === '(') i = matchClose(i, '(', ')') + 1;
        continue;
      }
      if (text(i) === '#' && text(i + 1) === '[') {
        i = matchClose(i + 1, '[', ']') + 1;
        continue;
      }
      if (T[i]?.type === 'word' && text(i + 1) === ':' && T[i + 1]?.type === 'punct') {
        i += 2; // `label:`
        continue;
      }
      if (T[i]?.type === 'word' && T[i + 1]?.type === 'var' && !T[i + 1].wsBefore) {
        const lbl = T[i + 1].text.slice(1).toUpperCase(); // `label:FOR` tokenized as word + var
        if (lbl === 'FOR' || lbl === 'WHILE' || lbl === 'LOOP' || lbl === 'BEGIN') return i + 1;
      }
      return i;
    }
  };

  const matchClose = (i: number, open: string, close: string): number => {
    let depth = 0;
    for (let k = i; k < n; k++) {
      if (T[k].text === open) depth++;
      else if (T[k].text === close && --depth === 0) return k;
      else if (T[k].text === ';' && open !== '(') return k - 1;
    }
    return n - 1;
  };

  /**
   * Scans from `i` to the end of a simple statement: the `;` (returned index) or a stop word / `BEGIN`
   * (returned index, not consumed) at parenthesis depth 0 outside `CASE ... END` expressions.
   */
  const scanToEnd = (i: number, stops: ReadonlySet<string>): number => {
    let depth = 0;
    let caseDepth = 0;
    for (let k = i; k < n; k++) {
      const t = T[k];
      if (t.text === '(' || t.text === '[') depth++;
      else if (t.text === ')' || t.text === ']') depth = Math.max(0, depth - 1);
      else if (up(k) === 'BEGIN' && k > i) {
        // Nested block inside a statement (anonymous `SQL FUNCTION ... BEGIN ... END` in a query, or a
        // block that follows a statement missing its `;`): walk it, then keep scanning.
        const after = parseBeginBlock(k + 1);
        if (text(after - 1) === ';' && depth === 0) return after - 1; // `... END;` also ends this statement
        k = after - 1;
      } else if (depth === 0) {
        if (t.text === ';') return k;
        const w = up(k);
        if (w === 'CASE') caseDepth++;
        else if (w === 'END' && caseDepth > 0 && !END_SUFFIXES.has(up(k + 1))) caseDepth--;
        else if (caseDepth === 0 && k > i && stops.has(w)) return k;
      }
    }
    return n;
  };

  /** Scans to `kw` (`THEN` / `DO`) at depth 0 outside CASE expressions; returns its index or a fallback. */
  const scanToKeyword = (i: number, kw: string): number => {
    let depth = 0;
    let caseDepth = 0;
    for (let k = i; k < n; k++) {
      const t = T[k];
      if (t.text === '(' || t.text === '[') depth++;
      else if (t.text === ')' || t.text === ']') depth = Math.max(0, depth - 1);
      else if (depth === 0) {
        const w = up(k);
        if (w === 'CASE') caseDepth++;
        else if (w === 'END' && caseDepth > 0) caseDepth--;
        else if (caseDepth === 0 && w === kw) return k;
        else if (caseDepth === 0 && (t.text === ';' || w === 'BEGIN' || w === 'END')) return k - 1;
      }
    }
    return n - 1;
  };

  /** Scans an `IF` / `ELSEIF` / `WHILE` condition to `kw`, hands it to the condition hook, returns `kw`'s index. */
  const condition = (i: number, kw: string): number => {
    const k = scanToKeyword(i, kw);
    if (up(k) === kw && k > i) hooks?.checkCondition?.(i, k, kw);
    return k;
  };

  /** Consumes `END [<suffix>] [;]` at `i` (if present) and returns the following index. */
  const consumeEnd = (i: number, suffix: string | null): number => {
    if (up(i) !== 'END') return i;
    i++;
    if (suffix && up(i) === suffix) i++;
    else if (!suffix && END_SUFFIXES.has(up(i)) && up(i) !== 'CASE') return i - 1; // belongs to an outer block
    if (T[i]?.type === 'word' && !suffix && !SQLSCRIPT_STATEMENT_STARTERS.has(up(i)) && text(i + 1) === ';') i++; // `END label;`
    if (text(i) === ';') i++;
    return i;
  };

  const BODY_STOPS = new Set(['END']);
  const IF_STOPS = new Set(['END', 'ELSE', 'ELSEIF']);
  const CASE_STOPS = new Set(['END', 'ELSE', 'WHEN']);
  const NO_STOPS: ReadonlySet<string> = new Set();

  /** Parses statements until a stop word at statement start; returns that index (or EOF). */
  const parseList = (i: number, scope: StatementScope, stops: ReadonlySet<string>): number => {
    while (i < n) {
      if (text(i) === ';') {
        i++;
        continue;
      }
      if (stops.has(up(i))) return i;
      const before = i;
      i = parseStatement(i, scope, stops);
      if (i <= before) i = before + 1; // always make progress
    }
    return n;
  };

  const parseBeginBlock = (i: number): number => {
    // i points right after BEGIN
    for (const [a, b] of BLOCK_MODIFIERS) {
      if (up(i) === a && up(i + 1) === b) {
        i += 2;
        break;
      }
    }
    i = parseList(i, 'block', BODY_STOPS);
    return consumeEnd(i, null);
  };

  const parseStatement = (start: number, scope: StatementScope, stops: ReadonlySet<string>): number => {
    const i = skipPrefixes(start);
    if (i >= n) return n;
    const w = up(i);

    // Routine / library / trigger / DO headers and their bodies.
    if (HEADER_WORDS.has(w)) {
      const hdr = parseRoutineHeader(T, i, { inLibrary: scope === 'library' });
      if (hdr) {
        if (hdr.beginIdx < 0) return hdr.nextIdx;
        if (hdr.language !== null && hdr.language !== 'SQLSCRIPT') return n; // foreign body (already cut off)
        if (hdr.kind === 'library') {
          const j = parseList(hdr.nextIdx, 'library', BODY_STOPS);
          return consumeEnd(j, null);
        }
        return parseBeginBlock(hdr.nextIdx);
      }
    }

    if (scope !== 'library') {
      switch (w) {
        case 'BEGIN':
          return parseBeginBlock(i + 1);
        case 'IF': {
          let j = condition(i + 1, 'THEN') + 1;
          for (;;) {
            j = parseList(j, 'block', IF_STOPS);
            if (up(j) === 'ELSEIF') {
              j = condition(j + 1, 'THEN') + 1;
              continue;
            }
            if (up(j) === 'ELSE') {
              j++;
              continue;
            }
            return consumeEnd(j, 'IF');
          }
        }
        case 'WHILE':
        case 'FOR': {
          const doIdx = w === 'WHILE' ? condition(i + 1, 'DO') : scanToKeyword(i + 1, 'DO');
          const j = parseList(doIdx + 1, 'block', BODY_STOPS);
          return consumeEnd(j, w);
        }
        case 'LOOP':
          return consumeEnd(parseList(i + 1, 'block', BODY_STOPS), 'LOOP');
        case 'CASE': {
          let j = scanToKeyword(i + 1, 'WHEN');
          while (up(j) === 'WHEN') {
            j = parseList(scanToKeyword(j + 1, 'THEN') + 1, 'block', CASE_STOPS);
          }
          if (up(j) === 'ELSE') j = parseList(j + 1, 'block', BODY_STOPS);
          return consumeEnd(j, 'CASE');
        }
        case 'DECLARE':
          if ((up(i + 1) === 'EXIT' || up(i + 1) === 'CONTINUE') && up(i + 2) === 'HANDLER') {
            let j = i + 3;
            if (up(j) === 'FOR') j++;
            for (;;) {
              if (up(j) === 'SQL_ERROR_CODE') j += 2;
              else if (T[j]?.type === 'word' || T[j]?.type === 'qident') j++;
              if (text(j) !== ',') break;
              j++;
            }
            return parseStatement(j, 'block', stops);
          }
          break;
        default:
          break;
      }
    }

    validateStarter(i, scope);
    const end = scanToEnd(i, scope === 'top' ? NO_STOPS : stops);
    hooks?.checkStatement?.(i, end, scope);
    return text(end) === ';' ? end + 1 : Math.max(end, i + 1);
  };

  const validateStarter = (i: number, scope: StatementScope): void => {
    const tok = T[i];
    const w = up(i);
    if (scope === 'top') {
      if (!opts.validateTopLevel) return;
      if (SQL_STATEMENT_STARTERS.has(w) || SQLSCRIPT_STATEMENT_STARTERS.has(w) || opts.extraTopStarters?.has(w)) return;
      if (w === 'END') return; // stray END reported by HANA-SYN-020
    } else if (scope === 'library') {
      if (LIBRARY_MEMBER_STARTERS.has(w)) return;
      const fix = tok.type === 'word' ? matchKeywordTypo(tok.text, [...LIBRARY_MEMBER_STARTERS]) : null;
      if (fix) {
        // Supersedes the generic HANA-SYN-029 "not allowed directly inside a LIBRARY body" report.
        report(i, 'HANA-SYN-021', `Unknown library member keyword '${tok.text}'. Did you mean '${fix}'?`, [replaceFix(tok, fix)], 'HANA-SYN-029');
      }
      return; // other invalid library statements are reported by HANA-SYN-029
    } else {
      if (SQL_STATEMENT_STARTERS.has(w) || SQLSCRIPT_STATEMENT_STARTERS.has(w)) return;
      if (isImperativeTarget(T, i)) return;
      if (w === 'END' || w === 'ELSE' || w === 'ELSEIF' || w === 'WHEN') return; // block structure (HANA-SYN-020)
    }
    if (tok.text === '(' && (up(i + 1) === 'SELECT' || up(i + 1) === 'WITH' || text(i + 1) === '(')) return;

    const candidates = scope === 'top' ? [...SQL_STATEMENT_STARTERS, ...(opts.extraTopStarters ?? [])] : [...SQL_STATEMENT_STARTERS, ...SQLSCRIPT_STATEMENT_STARTERS];
    const fix = tok.type === 'word' ? matchKeywordTypo(tok.text, candidates) : null;
    if (fix) {
      report(i, 'HANA-SYN-021', `Unknown statement keyword '${tok.text}'. Did you mean '${fix}'?`, [replaceFix(tok, fix)]);
      return;
    }
    const what =
      tok.type === 'string' ? 'string literal' : tok.type === 'number' ? 'numeric literal' : tok.type === 'word' ? 'identifier' : 'token';
    const expected =
      scope === 'top'
        ? 'a SQL statement'
        : `a SQL or SQLScript statement, or an assignment ('${tok.type === 'word' || tok.type === 'qident' ? tok.text : '<variable>'} = <expression>;')`;
    report(i, 'HANA-SYN-041', `Invalid statement start: unexpected ${what} '${tok.text}'; expected ${expected}.`);
  };

  const replaceFix = (tok: Token, kw: string): CodeFixSuggestion => ({
    title: `Replace '${tok.text}' with '${kw}'`,
    kind: 'quickfix',
    isPreferred: true,
    edits: [{ start: baseOffset + tok.start, end: baseOffset + tok.end, newText: kw }],
  });

  parseList(0, 'top', NO_STOPS);
}
