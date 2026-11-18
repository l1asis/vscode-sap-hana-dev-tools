/**
 * SQL / SQLScript lexical integrity checks (`HANA-SYN-005`, `HANA-SYN-006`, `HANA-SYN-024` punctuation).
 *
 * Runs on the uncollapsed token stream of one SQL section, after the delimiter pass. Platform scope:
 * `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` — SAP HANA SQL / SQLScript share one lexical grammar
 * (see `docs/specs/grammars/sql-sqlscript.md` §2).
 */
import { RESERVED } from '../formatter/keywords';
import { type Token } from '../formatter/tokenizer';
import { type AnalyzerDiagnostic, type CodeFixSuggestion } from './types';

export interface SqlLexicalOptions {
  /** All tokens of the section, comments included (`collapseFormatOff: false`). */
  readonly tokens: readonly Token[];
  readonly text: string;
  readonly baseOffset: number;
  /** Token start offsets already blamed by `HANA-SYN-003` (unclosed / unmatched delimiters). */
  readonly skipStarts: ReadonlySet<number>;
  /** Lines (relative to the section) holding a broken quoted identifier (`HANA-SYN-001`). */
  readonly brokenLines: ReadonlySet<number>;
  readonly lineOf: (offset: number) => number;
  readonly diagnostics: AnalyzerDiagnostic[];
}

/**
 * SQLScript compiler pragmas and `SQLSCRIPT_TEST` annotations that may follow `@` `[XSA]` `[HDI]` `[CLOUD]`.
 * Source: `docs/specs/grammars/sql-sqlscript.md` §2 (SQLScript Pragma / Annotation).
 */
const SQLSCRIPT_PRAGMAS = new Set<string>([
  'ANALYZERSUPPRESS',
  'PUSHSCOPE',
  'POPSCOPE',
  'TEST',
  'TESTSETUP',
  'TESTTEARDOWN',
  'TESTSETUPTEST',
  'TESTTEARDOWNTEST',
  'TESTSETUPCONFIG',
  'TESTTEARDOWNCONFIG',
  'TESTSETUPLIBRARY',
  'TESTTEARDOWNLIBRARY',
  'TESTCLASSIFICATION',
]);

/** SQLScript cursor attributes (`c_cursor::ISCLOSED`, `::NOTFOUND`, `::ROWCOUNT`) `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`. */
const CURSOR_ATTRIBUTES = new Set<string>(['ISCLOSED', 'NOTFOUND', 'ROWCOUNT']);

function isComment(t: Token | undefined): boolean {
  return t !== undefined && (t.type === 'lineComment' || t.type === 'blockComment');
}

function describe(tok: Token): string {
  const text = tok.text.length > 24 ? `${tok.text.slice(0, 21)}...` : tok.text;
  return `'${text}'`;
}

function charName(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x20 || code > 0x7e) {
    return `'${ch}' (U+${code.toString(16).toUpperCase().padStart(4, '0')})`;
  }
  return `'${ch}'`;
}

function removeFix(title: string, start: number, end: number): CodeFixSuggestion {
  return { title, kind: 'quickfix', isPreferred: true, edits: [{ start, end, newText: '' }] };
}

function replaceFix(title: string, start: number, end: number, newText: string): CodeFixSuggestion {
  return { title, kind: 'quickfix', isPreferred: true, edits: [{ start, end, newText }] };
}

/** Returns `true` for tokens that may legally appear on the left of a member-access `.`. */
function isDotOperandLeft(t: Token | undefined): boolean {
  if (!t) return false;
  if (t.type === 'word' || t.type === 'qident' || t.type === 'var' || t.type === 'sysvar') return true;
  return t.text === ')' || t.text === ']';
}

/** Reserved words that are valid after `.` (sequence pseudo-columns and `ROWID`). */
const RESERVED_AFTER_DOT = new Set<string>(['NEXTVAL', 'CURRVAL', 'ROWID']);

/** Returns `true` for tokens that may legally appear on the right of a member-access `.`. */
function isDotOperandRight(t: Token | undefined): boolean {
  if (!t) return false;
  if (t.type === 'word') {
    const up = t.text.toUpperCase();
    return !RESERVED.has(up) || RESERVED_AFTER_DOT.has(up);
  }
  if (t.type === 'qident') return true;
  return t.text === '*';
}

/**
 * Lexical integrity checks:
 * - `HANA-SYN-005`: `//` line comments (SQL only supports `--` and `/* ... *\/`) and characters outside the
 *   SQL lexical grammar (`&`, `|`, `\`, `~`, `^`, `!`, `` ` ``, typographic quotes, unknown `@` pragmas, ...).
 *   The SQL Reference defines only `=`, `>`, `<`, `>=`, `<=`, `!=`, `<>` comparisons, so `~=` / `^=` are invalid too.
 * - `HANA-SYN-006`: missing whitespace between adjacent tokens (`"T"alias`, `'s'AS`, `123abc`) and unquoted
 *   object names containing `::` (`com.acme::tbl`).
 * - `HANA-SYN-024`: consecutive commas (`,,`), leading commas after `(`, trailing commas before `;`, and stray
 *   `.` separators (`,.`, `...`, `a..` outside `FOR i IN a..b` ranges).
 */
export function checkSqlLexicalIntegrity(opts: SqlLexicalOptions): void {
  const { tokens, text, baseOffset, skipStarts, brokenLines, lineOf, diagnostics } = opts;

  const blocked = (tok: Token): boolean => skipStarts.has(tok.start) || brokenLines.has(lineOf(tok.start));

  const push = (
    ruleId: string,
    severity: 'error' | 'warning',
    message: string,
    start: number,
    end: number,
    fixes: readonly CodeFixSuggestion[] = []
  ): void => {
    diagnostics.push({
      ruleId,
      category: 'syntax',
      severity,
      message,
      start: baseOffset + start,
      end: baseOffset + end,
      fixes,
    });
  };

  // Code-only view (comments removed) for neighbour lookups that must skip comments.
  const code: Token[] = [];
  const codeIndexOf = new Map<Token, number>();
  for (const t of tokens) {
    if (isComment(t)) continue;
    codeIndexOf.set(t, code.length);
    code.push(t);
  }

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // 1. `//` line comments are not SQL comments.
    if (tok.type === 'lineComment' && tok.text.startsWith('//')) {
      if (brokenLines.has(lineOf(tok.start))) continue;
      push(
        'HANA-SYN-005',
        'error',
        "'//' is not a valid SQL comment; use '--' for line comments or '/* ... */' for block comments.",
        tok.start,
        tok.end,
        [replaceFix("Replace '//' with '--'", baseOffset + tok.start, baseOffset + tok.start + 2, '--')]
      );
      continue;
    }
    if (isComment(tok) || blocked(tok)) continue;

    const next = tokens[i + 1];

    // 2. Characters outside the SQL lexical grammar.
    if (tok.type === 'other') {
      const ch = tok.text;
      if (ch === '@' && next?.type === 'word' && !next.wsBefore) {
        if (SQLSCRIPT_PRAGMAS.has(next.text.toUpperCase())) {
          i++;
          continue;
        }
        push(
          'HANA-SYN-005',
          'error',
          `Unknown SQLScript pragma '@${next.text}'.`,
          tok.start,
          next.end
        );
        i++;
        continue;
      }
      const message =
        ch === '“' || ch === '”' || ch === '‘' || ch === '’'
          ? `Typographic quote ${charName(ch)} is not valid in SQL; use ASCII ' for strings or " for identifiers.`
          : `Unexpected character ${charName(ch)} in SQL.`;
      push('HANA-SYN-005', 'error', message, tok.start, tok.end, [
        removeFix(`Remove ${charName(ch)}`, baseOffset + tok.start, baseOffset + tok.end),
      ]);
      continue;
    }

    // 3. Glued tokens (no whitespace or comment between them).
    if (next && !next.wsBefore && !isComment(next) && !blocked(next)) {
      const leftDelimited = tok.type === 'qident' || tok.type === 'string';
      const rightOperand =
        next.type === 'word' || next.type === 'qident' || next.type === 'string' || next.type === 'number';
      if ((leftDelimited || tok.type === 'number') && rightOperand) {
        const leftKind = tok.type === 'qident' ? 'quoted identifier' : tok.type === 'string' ? 'string literal' : 'numeric literal';
        push(
          'HANA-SYN-006',
          tok.type === 'number' ? 'error' : 'warning',
          `Missing whitespace between ${leftKind} ${describe(tok)} and ${describe(next)}.`,
          tok.start,
          next.end,
          [replaceFix('Insert space', baseOffset + tok.end, baseOffset + tok.end, ' ')]
        );
        i++;
        continue;
      }

      // Unquoted object name containing `::` (`com.acme.app::tbl` → `"com.acme.app::tbl"`).
      if (tok.type === 'word' && next.type === 'sysvar' && !CURSOR_ATTRIBUTES.has(next.text.slice(2).toUpperCase())) {
        let first = i;
        while (
          first >= 2 &&
          tokens[first - 1].text === '.' &&
          !tokens[first].wsBefore &&
          !tokens[first - 1].wsBefore &&
          tokens[first - 2].type === 'word'
        ) {
          first -= 2;
        }
        const start = tokens[first].start;
        const name = text.slice(start, next.end);
        push(
          'HANA-SYN-006',
          'error',
          `Object name '${name}' contains '::' and must be a quoted identifier.`,
          start,
          next.end,
          [replaceFix(`Quote as "${name}"`, baseOffset + start, baseOffset + next.end, `"${name}"`)]
        );
        i++;
        continue;
      }
    }

    // 4. Comma hygiene.
    if (tok.text === ',' && tok.type === 'punct') {
      const ci = codeIndexOf.get(tok) ?? -1;
      const prevCode = ci > 0 ? code[ci - 1] : undefined;
      const nextCode = code[ci + 1];
      if (prevCode?.text === ',' && prevCode.type === 'punct') continue; // reported with the run start
      if (nextCode?.text === ',' && nextCode.type === 'punct') {
        let last = ci + 1;
        while (code[last + 1]?.text === ',' && code[last + 1].type === 'punct') last++;
        const runStart = code[ci + 1];
        const runEnd = code[last];
        if (blocked(runStart)) continue;
        push(
          'HANA-SYN-024',
          'error',
          last === ci + 1 ? "Consecutive ',' separators; missing list element." : `${last - ci + 1} consecutive ',' separators; missing list elements.`,
          runStart.start,
          runEnd.end,
          [removeFix("Remove extra ','", baseOffset + tok.end, baseOffset + runEnd.end)]
        );
        continue;
      }
      if (prevCode?.text === '(') {
        push('HANA-SYN-024', 'error', "Leading ',' after '('; missing list element.", tok.start, tok.end, [
          removeFix("Remove leading ','", baseOffset + tok.start, baseOffset + tok.end),
        ]);
        continue;
      }
      if (nextCode?.text === ';') {
        push('HANA-SYN-024', 'error', "Trailing ',' before ';'.", tok.start, tok.end, [
          removeFix("Remove trailing comma", baseOffset + tok.start, baseOffset + tok.end),
        ]);
      }
      continue;
    }

    // 5. Stray `.` separators.
    if (tok.type === 'punct' && (tok.text === '.' || tok.text === '..')) {
      const ci = codeIndexOf.get(tok) ?? -1;
      const prevCode = ci > 0 ? code[ci - 1] : undefined;
      const nextCode = code[ci + 1];
      const prevIsDot = prevCode?.type === 'punct' && (prevCode.text === '.' || prevCode.text === '..');
      if (prevIsDot && !tok.wsBefore) continue; // reported with the run start
      const nextIsDot = nextCode?.type === 'punct' && (nextCode.text === '.' || nextCode.text === '..') && !nextCode.wsBefore;
      if (nextIsDot) {
        let last = ci + 1;
        while (code[last + 1]?.type === 'punct' && (code[last + 1].text === '.' || code[last + 1].text === '..') && !code[last + 1].wsBefore) {
          last++;
        }
        const runText = text.slice(tok.start, code[last].end);
        push('HANA-SYN-024', 'error', `Unexpected '${runText}'; only a single '.' separates name parts and '..' separates range bounds.`, tok.start, code[last].end);
        continue;
      }
      if (tok.text === '.') {
        if (!isDotOperandLeft(prevCode) || !isDotOperandRight(nextCode)) {
          const side = !isDotOperandLeft(prevCode) ? 'before' : 'after';
          push('HANA-SYN-024', 'error', `Stray '.' separator; missing name part ${side} '.'.`, tok.start, tok.end, [
            removeFix("Remove '.'", baseOffset + tok.start, baseOffset + tok.end),
          ]);
        }
      }
    }
  }
}

/**
 * Drops follow-up diagnostics from other rules that start inside a span already blamed by a lexical
 * diagnostic, or that blame the token right after it on the same line (`a & b` must not also report a
 * missing operator before `b`), so one corrupted token does not cascade into several reports.
 */
export function dedupeLexicalCascade(diagnostics: AnalyzerDiagnostic[], fromIndex: number, text: string, baseOffset: number): void {
  const LEXICAL = new Set(['HANA-SYN-005', 'HANA-SYN-006']);
  const spans = diagnostics.filter((d) => LEXICAL.has(d.ruleId)).map((d) => [d.start, d.end] as const);
  if (spans.length === 0) return;
  const adjacent = (end: number, start: number): boolean =>
    start >= end && /^[ 	]*$/.test(text.slice(end - baseOffset, start - baseOffset));
  for (let k = diagnostics.length - 1; k >= fromIndex; k--) {
    const d = diagnostics[k];
    if (LEXICAL.has(d.ruleId)) continue;
    if (spans.some(([s, e]) => (d.start >= s && d.start < e) || adjacent(e, d.start))) diagnostics.splice(k, 1);
  }
}
