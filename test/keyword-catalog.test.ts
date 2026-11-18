/**
 * The unified SQL word catalog (#77): docs/specs/catalogs/sql-keywords.json + builtin-functions.json.
 *
 * - Generated files (grammar, formatter word sets, analyzer word sets, IntelliSense catalog) must match the catalog.
 * - No hand-maintained SQL keyword set may reappear in src/analyzer/ or the SQL formatter.
 * - The catalog validator rejects inconsistent catalogs.
 * - A word keeps distinct roles per context (`LEFT` join vs `LEFT(` call, `SOURCE` only inside hierarchy calls).
 *
 * Spec: docs/specs/SPEC_RULES.md §2.C.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './helpers/conformance';
import { findWordCollections, type WordCollection } from './helpers/word-collections';
import { tokenize, has } from './helpers/tm';
import { format } from '../src/formatter/formatter';
import { FUNCTIONS, KEYWORDS, RESERVED, SYSTEM_WORDS } from '../src/formatter/keywords';
import { CE_FUNCTIONS, EXPR_CLAUSE_TERMINATORS, HDI_ROOT_TARGETS, HIERARCHY_CLAUSE_TERMINATORS, JOIN_STARTERS, QUERY_CLAUSES } from '../src/analyzer/keyword-sets';
import { getSqlHover } from '../src/sql/intellisense-core';
import { analyzeDocument } from '../src/analyzer/dispatch';

type Outputs = Record<string, string>;
interface CatalogRaw {
  keywords: { roles: Record<string, Record<string, unknown>>; artifactRoots: Record<string, string[]>; words: Array<{ name: string; roles: string[]; platforms?: string[] }> };
  functions: { categories: Record<string, Record<string, unknown>>; functions: Array<{ name: string; library: string; category: string; signatures: string[] }> };
}

const script = <T>(rel: string): T => require(path.join(REPO_ROOT, 'scripts', rel)) as T;
const catalogLib = script<{ loadCatalog(raw?: CatalogRaw): unknown }>('lib/sql-catalog.js');
const readCatalog = (): CatalogRaw => ({
  keywords: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/specs/catalogs/sql-keywords.json'), 'utf8')) as CatalogRaw['keywords'],
  functions: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/specs/catalogs/builtin-functions.json'), 'utf8')) as CatalogRaw['functions'],
});
const catalogWords = (): ReadonlySet<string> => {
  const raw = readCatalog();
  return new Set([...raw.keywords.words.map((w) => w.name), ...raw.functions.functions.map((f) => f.name)]);
};

// ---------------------------------------------------------------------------
// generated files
// ---------------------------------------------------------------------------

test('catalog: generated files are in sync with docs/specs/catalogs (npm run build:keywords is clean)', () => {
  const outputs: Outputs = {
    ...script<{ buildKeywordOutputs(): Outputs }>('build-keywords.js').buildKeywordOutputs(),
    ...script<{ buildSqlCatalogOutputs(): Outputs }>('build-sql-catalog.js').buildSqlCatalogOutputs(),
    ...script<{ grammarOutputs: Outputs }>('build-grammars.js').grammarOutputs,
  };
  assert.ok(Object.keys(outputs).includes('syntaxes/hanasql.tmLanguage.json'));
  assert.ok(Object.keys(outputs).includes('src/analyzer/keyword-sets.ts'));
  const stale = Object.entries(outputs)
    .filter(([rel, content]) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n') !== content)
    .map(([rel]) => rel);
  assert.deepEqual(stale, [], 'stale generated files: run `npm run build:keywords`');
});

// ---------------------------------------------------------------------------
// no hand-maintained keyword sets
// ---------------------------------------------------------------------------

/**
 * Collections that are not keyword vocabularies. Each needs a reason; an entry that no longer matches fails the test.
 * - Privilege names of `.hdbrole` / `.hdbgrants` documents (security policy, not SQL words).
 * - Follow sets of consuming-parser productions, kept in code because their order is the order of the
 *   "expected ..." diagnostic message.
 */
const ALLOWED: ReadonlyArray<{ file: string; match: string; reason: string }> = [
  { file: 'roles-grants.ts', match: 'BROAD_WRITE_DDL_PRIVS', reason: 'privilege names in role documents' },
  { file: 'roles-grants.ts', match: 'APP_USER_ELEVATED_PRIVS', reason: 'privilege names in role documents' },
  { file: 'sql-clauses.ts', match: 'OPTIONS', reason: 'ordered follow set of the CREATE SEQUENCE option production' },
  { file: 'sql-clauses.ts', match: "', ON USING WHERE GROUP HAVING WINDOW", reason: 'ordered FROM-clause follow set (HANA-SYN-042 message order)' },
  { file: 'sql-header.ts', match: 'expectedPost', reason: 'ordered routine header follow set (HANA-SYN-040 message order)' },
];

/** Minimum catalog words in an anonymous inline list for it to count as a vocabulary rather than a production. */
const INLINE_VOCABULARY_MIN = 6;

function keywordSetViolations(source: string, words: ReadonlySet<string>): WordCollection[] {
  return findWordCollections(source).filter((c) => {
    const hits = c.items.filter((w) => words.has(w)).length;
    if (hits < 2 || hits * 2 < c.items.length) return false;
    if (c.isSet || (c.name && c.topLevel)) return true;
    if (c.name && c.items.length >= 2) return true;
    return hits >= INLINE_VOCABULARY_MIN;
  });
}

const collectionKey = (c: WordCollection): string => c.name ?? `'${c.items.join(' ')}`;

test('catalog: no hand-maintained SQL keyword sets in src/analyzer/ or the SQL formatter', () => {
  const words = catalogWords();
  const analyzerDir = path.join(REPO_ROOT, 'src', 'analyzer');
  const files = fs
    .readdirSync(analyzerDir)
    .filter((f) => f.endsWith('.ts') && f !== 'keyword-sets.ts')
    .map((f) => path.join(analyzerDir, f));
  files.push(path.join(REPO_ROOT, 'src', 'formatter', 'formatter.ts'));

  const used = new Set<string>();
  const violations: string[] = [];
  for (const file of files) {
    const base = path.basename(file);
    for (const c of keywordSetViolations(fs.readFileSync(file, 'utf8'), words)) {
      const allow = ALLOWED.find((a) => a.file === base && collectionKey(c).includes(a.match));
      if (allow) used.add(`${allow.file}:${allow.match}`);
      else violations.push(`${base}:${c.line} ${c.name ?? '(inline)'} [${c.items.join(', ')}]`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    'keyword sets belong in docs/specs/catalogs/sql-keywords.json (add a role, run npm run build:keywords, import from keyword-sets.ts)'
  );
  assert.deepEqual(
    ALLOWED.filter((a) => !used.has(`${a.file}:${a.match}`)).map((a) => `${a.file}:${a.match}`),
    [],
    'stale ALLOWED entries'
  );
});

test('catalog guard: flags keyword vocabularies, ignores productions, punctuation and identifiers', () => {
  const words = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'AND', 'OR']);
  const src = [
    "const STOPS = new Set<string>(['SELECT', 'FROM']);",
    "const ORDERED = ['WHERE', 'GROUP'];",
    'function f(w: string): boolean {',
    "  const local = new Set(['AND', 'OR']);",
    "  if (['SELECT', 'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER'].includes(w)) return true;",
    "  if (['AND', 'OR', 'LIMIT'].includes(w)) return local.has(w);", // production alternatives: allowed
    "  const ops = new Set(['=', '<>', '(']);", // punctuation: allowed
    "  const names = new Set(['MODELING', 'CONTENT_ADMIN']);", // not catalog words: allowed
    "  // const COMMENTED = new Set(['SELECT', 'FROM']);",
    "  return /['SELECT', 'FROM']/.test(w);",
    '}',
  ].join('\n');
  assert.deepEqual(
    keywordSetViolations(src, words).map((c) => c.name ?? `inline@${c.line}`),
    ['STOPS', 'ORDERED', 'local', 'inline@5']
  );
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test('catalog: the validator accepts the shipped catalog and rejects inconsistent ones', () => {
  assert.doesNotThrow(() => catalogLib.loadCatalog(readCatalog()));

  const broken = (mutate: (raw: CatalogRaw) => void): string => {
    const raw = readCatalog();
    mutate(raw);
    try {
      catalogLib.loadCatalog(raw);
    } catch (e) {
      return (e as Error).message;
    }
    return '(accepted)';
  };
  const word = (raw: CatalogRaw, name: string) => raw.keywords.words.find((w) => w.name === name)!;

  assert.match(broken((r) => word(r, 'SELECT').roles.push('no-such-role')), /word 'SELECT': unknown role 'no-such-role'/);
  assert.match(broken((r) => r.keywords.words.push({ name: 'SELECT', roles: ['dml'] })), /word 'SELECT' is listed twice/);
  assert.match(broken((r) => r.keywords.words.push({ name: 'lower_case', roles: ['dml'] })), /upper-case SQL identifiers/);
  assert.match(broken((r) => (word(r, 'LEFT').platforms = ['XSC', 'MAINFRAME'])), /unknown platform 'MAINFRAME'/);
  assert.match(broken((r) => (word(r, 'EXACT').roles = word(r, 'EXACT').roles.filter((x) => x !== 'join-starter'))), /role 'join-starter': order .* must list exactly its words/);
  assert.match(broken((r) => (r.keywords.roles['empty-role'] = { group: 'context', description: 'x' })), /role 'empty-role' has no words/);
  assert.match(broken((r) => r.keywords.artifactRoots.hdbprocedure.push('NOT_A_WORD')), /artifactRoots.hdbprocedure: 'NOT_A_WORD' is not a catalog word/);
  assert.match(broken((r) => (r.functions.functions[0].category = 'astrology')), /unknown category 'astrology'/);
  assert.match(broken((r) => r.functions.functions.push({ ...r.functions.functions[0] })), /is listed twice/);
  assert.match(
    broken((r) => (r.keywords.roles['expr-prefix-word'].const = 'EXPR_CLAUSE_TERMINATORS')),
    /both emit EXPR_CLAUSE_TERMINATORS into analyzer/
  );
});

// ---------------------------------------------------------------------------
// context-aware roles
// ---------------------------------------------------------------------------

test('catalog: LEFT / RIGHT are join starters, expression terminators and string functions, by context', () => {
  const raw = readCatalog();
  const left = raw.keywords.words.find((w) => w.name === 'LEFT')!;
  for (const r of ['reserved', 'join-starter', 'expr-clause-terminator']) assert.ok(left.roles.includes(r), `LEFT has role ${r}`);
  assert.equal(raw.functions.functions.find((f) => f.name === 'LEFT' && f.library === 'SYS')?.category, 'string');
  assert.ok(JOIN_STARTERS.includes('LEFT') && EXPR_CLAUSE_TERMINATORS.has('RIGHT') && FUNCTIONS.has('LEFT') && RESERVED.has('LEFT'));

  const call = tokenize('source.hanasql', "SELECT LEFT(name, 2) FROM t");
  assert.ok(has(call, 'LEFT', 'support.function.string.hanasql'), 'LEFT( is a function call');
  const join = tokenize('source.hanasql', 'SELECT * FROM a LEFT OUTER JOIN b ON a.id = b.id');
  assert.ok(has(join, 'LEFT', 'keyword.other.dml.hanasql'), 'LEFT JOIN is a keyword');
  assert.ok(!has(join, 'LEFT', 'support.function.string.hanasql'));

  const diags = (sql: string) => analyzeDocument({ languageId: 'sql', text: sql }).filter((d) => d.ruleId.startsWith('HANA-SYN')).map((d) => d.ruleId);
  assert.deepEqual(diags('SELECT A FROM T WHERE X = 1 AND LEFT("COL", 6) = 1;'), [], 'AND before LEFT( is not dangling (#73)');
  assert.deepEqual(diags('SELECT A FROM T LEFT JOIN U ON T.ID = U.ID;'), [], 'LEFT JOIN');
  assert.ok(diags('SELECT A FROM T WHERE X = 1 AND LEFT JOIN U ON 1 = 1;').includes('HANA-SYN-024'), 'AND before LEFT JOIN is dangling');
});

test('catalog: hierarchy clause words are keywords only inside hierarchy calls', () => {
  const raw = readCatalog();
  const roles = (n: string) => raw.keywords.words.find((w) => w.name === n)?.roles ?? [];
  for (const w of ['SOURCE', 'DISTANCE', 'CACHE']) {
    assert.ok(roles(w).includes('hierarchy-clause'), `${w} is a hierarchy clause word`);
    assert.ok(!roles(w).includes('reserved'), `${w} is not reserved`);
    assert.ok(HIERARCHY_CLAUSE_TERMINATORS.has(w));
    assert.ok(!KEYWORDS.has(w), `${w} keeps identifier case outside its clause`);
  }
  const out = format('select source, distance from t');
  assert.match(out, /^SELECT\b/);
  assert.ok(out.includes('source') && out.includes('distance'), out);
});

test('catalog: ordered follow sets keep clause order; derived sets come from function categories', () => {
  assert.deepEqual(QUERY_CLAUSES.slice(0, 4), ['FROM', 'INTO', 'WHERE', 'GROUP']);
  assert.ok(CE_FUNCTIONS.has('CE_PROJECTION') && !CE_FUNCTIONS.has('MAP_MERGE'));
  assert.deepEqual([...HDI_ROOT_TARGETS.hdbprocedure], ['PROCEDURE', 'CREATE']);
  assert.ok(SYSTEM_WORDS.has('SAVEPOINT') && SYSTEM_WORDS.has('PROFILER'));
});

test('catalog: every highlighted built-in function has function hover, not keyword hover', () => {
  const raw = readCatalog();
  const scoped = new Set(Object.entries(raw.functions.categories).filter(([, c]) => c.scope).map(([id]) => id));
  const missing: string[] = [];
  for (const f of raw.functions.functions.filter((x) => scoped.has(x.category))) {
    const code = `x = ${f.name}(1)`;
    const hover = getSqlHover(code, code.indexOf(f.name) + 1);
    if (!hover || !hover.markdown.includes(f.signatures[0])) missing.push(f.name);
  }
  assert.deepEqual(missing, []);
  const vertices = getSqlHover('n = VERTICES(:g)', 6);
  assert.ok(vertices?.markdown.includes('VERTICES(<graph>) -> MULTISET<VERTEX>'), 'GraphScript VERTICES is a function');
  assert.equal(getSqlHover('x = NOT_A_FUNCTION(1)', 6), null);
});

test('catalog: grammar alternations put longer words first (ALTER SYSTEM SAVEPOINT, PROFILER)', () => {
  const t = tokenize('source.hanasql', 'ALTER SYSTEM SAVEPOINT;\nALTER SYSTEM START KERNEL PROFILER;');
  assert.ok(has(t, 'ALTER SYSTEM SAVEPOINT', 'keyword.other.statement.hanasql'));
  assert.ok(!t.some((x) => x.text.trim() === 'POINT'), 'SAVEPOINT is one token, not SAVE + POINT');
  assert.ok(t.some((x) => x.text.includes('PROFILER') && x.scopes.includes('keyword.other.statement.hanasql')));
});

test('catalog: formatter cases every highlighted SQLScript / GraphScript built-in as a function', () => {
  for (const name of ['RECORD_COUNT', 'IS_EMPTY', 'VERTICES', 'IN_DEGREE']) assert.ok(FUNCTIONS.has(name), name);
  const calls = format('select record_count(:it), is_empty(:it) from dummy');
  assert.ok(calls.includes('RECORD_COUNT(:it)') && calls.includes('IS_EMPTY(:it)'), calls);
  assert.ok(format('select record_count from t').includes('record_count'), 'no call, no function case');
});
