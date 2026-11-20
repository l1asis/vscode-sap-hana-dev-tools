/**
 * Conformance harness core (#76), shared by the committed fixture suite
 * (`test/conformance.test.ts`) and the local corpus sweep (`scripts/conformance.js`).
 *
 * Every check is pure and dependency-free. The checks run one SQL / SQLScript snippet through
 * the three shipped components and report where each falls short:
 *
 * - analyzer: `HANA-SYN-*` diagnostics on a snippet that is known to be valid
 * - formatter: no throw, idempotent, word / comment sequence preserved, format-off regions verbatim
 * - grammar: catalog keywords that the `source.hanasql` TextMate grammar leaves without a scope
 * - catalog: called names (`NAME(`) that neither the grammar nor `builtin-functions.json` knows
 *
 * Spec: docs/specs/diagnostics/conformance-harness.md
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeDocument } from '../../src/analyzer/dispatch';
import { DEFAULT_ANALYZER_OPTIONS, type AnalyzerDiagnostic } from '../../src/analyzer/types';
import { formatDocument } from '../../src/formatter/dispatch';
import { type PartialFormatterOptions } from '../../src/formatter/options';
import { tokenize, type TmToken } from './tm';

export const REPO_ROOT = fs.existsSync(path.join(__dirname, '..', '..', 'package.json'))
  ? path.join(__dirname, '..', '..')
  : path.join(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Corpus extraction
// ---------------------------------------------------------------------------

/** Bodies of the ```sql fenced blocks in a Markdown document, in document order. */
export function extractSqlBlocks(markdown: string): string[] {
  const out: string[] = [];
  const re = /^```sql[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const body = m[1].replace(/\r\n/g, '\n').trim();
    if (body) out.push(body);
  }
  return out;
}

/**
 * Syntax templates are not runnable SQL: they contain `<placeholder>` non-terminals or `...`
 * ellipses. Operators such as `<>`, `<=` and `a < b AND c > d` are not placeholders because a
 * placeholder is a single identifier-like run directly inside the angle brackets.
 */
export function isTemplate(block: string): boolean {
  return /<[A-Za-z_][A-Za-z0-9_ ]*>/.test(stripLiterals(block)) || /\.\.\.|…/.test(block);
}

/** Replace string literal and quoted identifier bodies with spaces (keeps offsets stable). */
function stripLiterals(text: string): string {
  return text.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, (s) => ' '.repeat(s.length));
}

/** Stable short hash of a block: SHA-256 over the LF-normalized, trimmed text. */
export function blockHash(block: string): string {
  return crypto.createHash('sha256').update(block.replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

/** `HANA-SYN-*` diagnostics only (security, performance and migration rules are not conformance). */
export function syntaxErrors(text: string, languageId = 'hanasql'): AnalyzerDiagnostic[] {
  return analyzeDocument({
    languageId,
    text,
    options: {
      ...DEFAULT_ANALYZER_OPTIONS,
      security: false,
      performance: false,
      migration: false,
      calculationView: false,
      syntax: true,
    },
  }).filter((d) => d.category === 'syntax');
}

// ---------------------------------------------------------------------------
// Formatter invariants
// ---------------------------------------------------------------------------

export type FormatterViolationKind = 'throw' | 'non-idempotent' | 'word-sequence' | 'comment-sequence' | 'format-off';

export interface FormatterViolation {
  readonly kind: FormatterViolationKind;
  readonly detail: string;
}

interface Lexeme {
  readonly kind: 'word' | 'comment' | 'other';
  readonly text: string;
}

const MULTI_CHAR_OPERATORS = ['..', '<=', '>=', '<>', '!=', '||', '=>', '::', ':=', '->'];

/**
 * Independent, deliberately simple SQL lexer used to compare formatter input and output. It does
 * not share code with the formatter tokenizer, so a tokenizer bug cannot hide itself.
 * Words are case-folded (the formatter re-cases keywords); everything else is compared verbatim.
 */
function lexemes(text: string): Lexeme[] {
  const out: Lexeme[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '-' && text[i + 1] === '-') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      out.push({ kind: 'comment', text: normalizeComment(text.slice(i + 2, j)) });
      i = j;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      let j = text.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      out.push({ kind: 'comment', text: normalizeComment(text.slice(i + 2, Math.max(i + 2, j - 2))) });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === c) {
          if (text[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out.push({ kind: 'other', text: text.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const word = /^[A-Za-z_\u00C0-\uFFFF][A-Za-z0-9_$#\u00C0-\uFFFF]*/u.exec(text.slice(i, i + 256));
    if (word) {
      out.push({ kind: 'word', text: word[0].toUpperCase() });
      i += word[0].length;
      continue;
    }
    const num = /^(?:0[xX][0-9A-Fa-f]+|[0-9]+(?:\.(?!\.)[0-9]*)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i, i + 256));
    if (num) {
      out.push({ kind: 'other', text: num[0].toUpperCase() });
      i += num[0].length;
      continue;
    }
    const op = MULTI_CHAR_OPERATORS.find((o) => text.startsWith(o, i));
    if (op) {
      out.push({ kind: 'other', text: op });
      i += op.length;
      continue;
    }
    out.push({ kind: 'other', text: c });
    i++;
  }
  return out;
}

/** Comment bodies compare with whitespace collapsed: re-indenting a block comment is allowed. */
function normalizeComment(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

function firstDifference(a: readonly string[], b: readonly string[]): string {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      return `#${i}: expected ${JSON.stringify(a[i] ?? '<end>')}, got ${JSON.stringify(b[i] ?? '<end>')}`;
    }
  }
  return 'sequences differ';
}

/**
 * Lexeme texts of one kind (`code` = everything but comments). No profile changes the default
 * `trailingSemicolon: preserve`, so `;` is part of the compared code sequence.
 */
function sequence(lx: readonly Lexeme[], kind: Lexeme['kind'] | 'code'): string[] {
  return lx.filter((l) => (kind === 'code' ? l.kind !== 'comment' : l.kind === kind)).map((l) => l.text);
}

/** `-- hanasql-format off` ... `-- hanasql-format on` (or end of text) regions, verbatim. */
export function formatOffRegions(text: string): string[] {
  const out: string[] = [];
  const re = /--[ \t]*hanasql-format[ \t]+off\b[\s\S]*?(?:--[ \t]*hanasql-format[ \t]+on\b[^\n]*|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

/**
 * Option profiles every formatter check runs under. The default profile covers the shipped
 * settings. `narrow` forces wrapping, where layout bugs such as #107 show up that never trigger
 * at the default `maxLineLength: 120`. Every option not listed keeps its default.
 */
export const FORMATTER_PROFILES: readonly { readonly name: string; readonly options: PartialFormatterOptions }[] = [
  { name: 'default', options: {} },
  { name: 'narrow', options: { maxLineLength: 40 } },
];

/**
 * Format under every profile in `FORMATTER_PROFILES` and check the invariants. Returns an empty
 * array when the formatter is safe on `text`. Details of a non-default profile start with
 * `[<profile>]`.
 */
export function formatterViolations(text: string, languageId = 'hanasql'): FormatterViolation[] {
  return FORMATTER_PROFILES.flatMap(({ name, options }) =>
    profileViolations(text, languageId, options).map((v) =>
      name === 'default' ? v : { kind: v.kind, detail: `[${name}] ${v.detail}` }
    )
  );
}

function profileViolations(text: string, languageId: string, options: PartialFormatterOptions): FormatterViolation[] {
  const out: FormatterViolation[] = [];
  let once: string;
  let twice: string;
  try {
    once = formatDocument(languageId, text, options);
    twice = formatDocument(languageId, once, options);
  } catch (e) {
    return [{ kind: 'throw', detail: e instanceof Error ? e.message : String(e) }];
  }
  if (once !== twice) {
    const a = once.split('\n');
    const b = twice.split('\n');
    const line = a.findIndex((l, i) => l !== b[i]);
    out.push({ kind: 'non-idempotent', detail: `line ${line + 1}: ${JSON.stringify(a[line])} -> ${JSON.stringify(b[line])}` });
  }
  // Trailing whitespace is layout, even when an unterminated literal runs to the end of the text.
  const before = lexemes(text.trimEnd());
  const after = lexemes(once.trimEnd());
  const codeA = sequence(before, 'code');
  const codeB = sequence(after, 'code');
  if (codeA.join('\u0000') !== codeB.join('\u0000')) {
    out.push({ kind: 'word-sequence', detail: firstDifference(codeA, codeB) });
  }
  const comA = sequence(before, 'comment');
  const comB = sequence(after, 'comment');
  if (comA.join('\u0000') !== comB.join('\u0000')) {
    out.push({ kind: 'comment-sequence', detail: firstDifference(comA, comB) });
  }
  for (const region of formatOffRegions(text)) {
    if (!once.includes(region.replace(/\s+$/, ''))) {
      out.push({ kind: 'format-off', detail: `region not preserved verbatim: ${JSON.stringify(region.slice(0, 60))}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grammar & catalog
// ---------------------------------------------------------------------------

interface KeywordCatalog {
  roles: Record<string, { scope?: string }>;
  words: Array<{ name: string; roles: string[] }>;
}

interface FunctionCatalog {
  functions: Array<{ name: string }>;
}

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')) as T;
}

let keywordSet: ReadonlySet<string> | undefined;
let functionSet: ReadonlySet<string> | undefined;

/**
 * Catalog keywords (`docs/specs/catalogs/sql-keywords.json`), upper case: words with at least one role that
 * carries a TextMate scope. Words known only to analyzer heuristics (context roles) are not counted.
 */
export function catalogKeywords(): ReadonlySet<string> {
  if (!keywordSet) {
    const cat = readJson<KeywordCatalog>('docs/specs/catalogs/sql-keywords.json');
    const scoped = new Set(Object.entries(cat.roles).filter(([, r]) => r.scope).map(([id]) => id));
    keywordSet = new Set(cat.words.filter((w) => w.roles.some((r) => scoped.has(r))).map((w) => w.name.toUpperCase()));
  }
  return keywordSet;
}

/** Built-in function names (`docs/specs/catalogs/builtin-functions.json`), upper case. */
export function catalogFunctions(): ReadonlySet<string> {
  functionSet ??= new Set(
    readJson<FunctionCatalog>('docs/specs/catalogs/builtin-functions.json').functions.map((f) => f.name.toUpperCase())
  );
  return functionSet;
}

/** A word in the source together with the grammar scopes covering it. */
interface ScopedWord {
  readonly word: string;
  readonly start: number;
  /** Scopes other than the grammar root and `meta.*` wrappers. */
  readonly scopes: readonly string[];
  /** The next non-blank character after the word. */
  readonly next: string;
  /** The previous word (upper case), if any, on the same logical statement. */
  readonly prev: string;
}

function significantScopes(t: TmToken, root: string): string[] {
  return t.scopes.filter((s) => s !== root && !s.startsWith('meta.'));
}

/** Tokenize with the grammar and attach the covering scopes to every identifier-like word. */
function scopedWords(text: string, scopeName: string): ScopedWord[] {
  const tokens = tokenize(scopeName, text.replace(/\r\n/g, '\n'));
  const flat = tokens.map((t) => t.text).join('');
  const scopeAt: string[][] = new Array(flat.length);
  let pos = 0;
  for (const t of tokens) {
    const s = significantScopes(t, scopeName);
    for (let k = 0; k < t.text.length; k++) scopeAt[pos + k] = s;
    pos += t.text.length;
  }
  const out: ScopedWord[] = [];
  const re = /[A-Za-z_][A-Za-z0-9_$#]*/g;
  let m: RegExpExecArray | null;
  let prev = '';
  while ((m = re.exec(flat)) !== null) {
    const before = flat[m.index - 1];
    // Skip tails of quoted / dotted / variable-prefixed names: they are not keyword positions.
    if (before !== undefined && /[A-Za-z0-9_$#".:]/.test(before)) {
      prev = m[0].toUpperCase();
      continue;
    }
    const scopes = new Set<string>();
    for (let k = m.index; k < m.index + m[0].length; k++) for (const s of scopeAt[k] ?? []) scopes.add(s);
    const rest = flat.slice(m.index + m[0].length);
    const next = /^\s*(\S?)/.exec(rest)?.[1] ?? '';
    out.push({ word: m[0].toUpperCase(), start: m.index, scopes: [...scopes], next, prev });
    prev = m[0].toUpperCase();
  }
  return out;
}

/**
 * Catalog keywords that appear as bare words but receive no scope from the grammar. Words inside
 * strings, comments and quoted identifiers carry their own scope and are therefore never reported.
 */
export function unscopedKeywords(text: string, scopeName = 'source.hanasql'): string[] {
  const kw = catalogKeywords();
  const out = new Set<string>();
  for (const w of scopedWords(text, scopeName)) {
    if (w.scopes.length === 0 && kw.has(w.word)) out.add(w.word);
  }
  return [...out].sort();
}

/** Words that declare an object name rather than call a function when followed by `(`. */
const DECLARING_WORDS = new Set([
  'TABLE', 'INTO', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TYPE', 'INDEX', 'ON', 'REFERENCES', 'CALL',
  'TRIGGER', 'EXISTS', 'AS', 'UPDATE', 'KEY', 'SEQUENCE', 'SYNONYM', 'LIBRARY', 'WORKSPACE',
  'HIERARCHY', 'PARTITION', 'OF', 'FROM', 'JOIN', 'USING', 'DECLARE', 'RETURNS', 'COLUMN',
]);

/**
 * Names called as `NAME(` that neither the grammar scopes nor `builtin-functions.json` lists.
 * Names after a declaring keyword (`CREATE TABLE T (`, `INSERT INTO T (`, `CALL P (`) are objects,
 * not functions, and are skipped. The result is a discovery aid for the local corpus sweep.
 */
export function unknownCalls(text: string, scopeName = 'source.hanasql'): string[] {
  const fns = catalogFunctions();
  const kw = catalogKeywords();
  const out = new Set<string>();
  for (const w of scopedWords(text, scopeName)) {
    if (w.next !== '(' || w.scopes.length > 0) continue;
    if (fns.has(w.word) || kw.has(w.word) || DECLARING_WORDS.has(w.prev)) continue;
    out.add(w.word);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// One-shot evaluation
// ---------------------------------------------------------------------------

export interface ConformanceResult {
  readonly syntax: readonly AnalyzerDiagnostic[];
  readonly formatter: readonly FormatterViolation[];
  readonly unscoped: readonly string[];
}

export function evaluate(text: string, languageId = 'hanasql'): ConformanceResult {
  return {
    syntax: syntaxErrors(text, languageId),
    formatter: formatterViolations(text, languageId),
    unscoped: unscopedKeywords(text),
  };
}

export type ConformanceCheck = 'syntax' | 'formatter' | 'grammar';

export const CONFORMANCE_CHECKS: readonly ConformanceCheck[] = ['syntax', 'formatter', 'grammar'];

/** Problems found by one check, one human-readable line each (empty when the check passes). */
export function problems(r: ConformanceResult, check: ConformanceCheck, text: string): string[] {
  switch (check) {
    case 'syntax':
      return r.syntax.map((d) => `${d.ruleId} at ${JSON.stringify(text.slice(d.start, d.end))}: ${d.message}`);
    case 'formatter':
      return r.formatter.map((v) => `formatter ${v.kind}: ${v.detail}`);
    case 'grammar':
      return r.unscoped.length ? [`grammar: unscoped keywords ${r.unscoped.join(', ')}`] : [];
  }
}
