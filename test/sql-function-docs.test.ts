/**
 * Built-in function documentation (#43): catalog completeness, hover cards and signature help.
 * Spec: docs/specs/diagnostics/sql-intellisense.md §6, docs/specs/SPEC_RULES.md §C.1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './helpers/conformance';
import { tokenize, has } from './helpers/tm';
import { getSqlCompletions, getSqlHover, getSqlSignatureHelp } from '../src/sql/intellisense-core';
import { SQL_FUNCTIONS, SQL_LIBRARY_MEMBERS } from '../src/sql/sql-catalog';

interface FnJson {
  name: string;
  library: string;
  category: string;
  kind?: string;
  platforms?: string[];
  signatures: string[];
  params?: Array<{ name: string; description: string; keyword?: string }>;
  returnType: string;
  description: string;
  source?: string;
}
const catalog = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/specs/catalogs/builtin-functions.json'), 'utf8')) as {
  functions: FnJson[];
};

const hoverAt = (code: string, word: string, nth = 0): string | null => {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = code.indexOf(word, at + 1);
  return getSqlHover(code, at + 1)?.markdown ?? null;
};

// ---------------------------------------------------------------------------
// catalog completeness
// ---------------------------------------------------------------------------

test('functions: no placeholder signatures, boilerplate descriptions or coarse union return types remain', () => {
  const placeholder = catalog.functions.filter((f) => f.signatures.some((s) => s === `${f.name}(...)`));
  assert.deepEqual(placeholder.map((f) => f.name), []);
  const boilerplate = catalog.functions.filter((f) => /^Built-in SAP HANA\b/.test(f.description) || !f.description);
  assert.deepEqual(boilerplate.map((f) => f.name), []);
  const coarse = /^(ANY|SCALAR|NUMERIC \| ANY|NVARCHAR \| INTEGER|TIMESTAMP \| DATE \| TIME \| INTEGER|ST_GEOMETRY \| DOUBLE \| INTEGER)$/;
  assert.deepEqual(catalog.functions.filter((f) => coarse.test(f.returnType)).map((f) => f.name), []);
  const noPlatforms = catalog.functions.filter((f) => !f.platforms?.length);
  assert.deepEqual(noPlatforms.map((f) => f.name), []);
});

test('functions: every signature has balanced brackets (no PDF-clipped syntax)', () => {
  const balanced = (sig: string): boolean => {
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const stack: string[] = [];
    for (const c of sig.replace(/'[^']*'/g, '')) {
      if ('([{'.includes(c)) stack.push(c);
      else if (pairs[c] && stack.pop() !== pairs[c]) return false;
    }
    return stack.length === 0;
  };
  assert.deepEqual(catalog.functions.filter((f) => !f.signatures.every(balanced)).map((f) => f.name), []);
});

test('functions: documented additions are present, undocumented names are gone', () => {
  const has = (n: string) => catalog.functions.some((f) => f.name === n);
  for (const n of ['SNIPPETS', 'HIGHLIGHTED', 'IS_EMPTY', 'RECORD_COUNT', 'TRACE', 'ENCRYPTION_ROOT_KEYS_EXTRACT_ALL_KEYS_FOR_DATABASE', 'VERTICES', 'IN_DEGREE', 'REACHABLE_VERTICES', 'MAX_FLOW', 'ST_POINT', 'ST_POLYGON', 'ST_3DLENGTH', 'ST_INVALIDREASON', 'ST_ADDMEASURE', 'ST_GEOMFROMGEOHASH', 'SERIES_GENERATE_INTEGER', 'SUBSTR_REGEXPR']) {
    assert.ok(has(n), `${n} is cataloged`);
  }
  // not documented in any SAP HANA reference (PostGIS-style names)
  for (const n of ['ST_SETSRID', 'ST_MAKEENVELOPE', 'ST_LINEMERGE', 'BITAT', 'TO_TIMS']) assert.ok(!has(n), `${n} is not cataloged`);
  // GraphScript accessors named like SQL clause words are not global functions
  for (const n of ['SOURCE', 'TARGET']) assert.ok(!catalog.functions.some((f) => f.name === n && f.category === 'graphscript'));
});

test('functions: platform tags follow the reference that documents the function', () => {
  const p = (n: string) => catalog.functions.find((f) => f.name === n && f.library === 'SYS')?.platforms;
  assert.deepEqual(p('AI_TEXT_COMPLETION'), ['CLOUD']);
  assert.deepEqual(p('GET_DELTA_LAKE_TABLE_CHANGES'), ['CLOUD']);
  assert.deepEqual(p('PLAINTEXT'), ['XSC', 'XSA', 'HDI']);
  assert.deepEqual(p('TO_ALPHANUM'), ['XSC', 'XSA', 'HDI']);
  assert.deepEqual(p('ADD_DAYS'), ['XSC', 'XSA', 'HDI', 'CLOUD']);
  assert.ok(p('SERIES_GENERATE')?.includes('CLOUD'));
});

test('functions: every entry cites a source or is a curated SQLScript library member', () => {
  const missing = catalog.functions.filter((f) => !f.source && f.category !== 'sqlscript-library' && f.category !== 'calculation-engine' && f.library === 'SYS');
  // the remaining ones were curated before #43 (TO_CHAR, RECORD_COUNT, MAP_MERGE, graph procedures); the count may only shrink
  assert.ok(missing.length <= 21, `uncited SYS functions: ${missing.map((f) => f.name).join(', ')}`);
});

// ---------------------------------------------------------------------------
// hover
// ---------------------------------------------------------------------------

test('hover: aggregate function shows signature, return mapping, category and parameters', () => {
  const md = hoverAt('SELECT SUM(price) FROM t', 'SUM')!;
  assert.match(md, /SUM\(\[ALL \| DISTINCT\] <expression>\) -> numeric \(by input type\)/);
  assert.match(md, /_Aggregate function_ · `\[XSC\]` `\[XSA\]` `\[HDI\]` `\[CLOUD\]`/);
  assert.match(md, /\*\*Parameters\*\*[\s\S]*`<expression>`/);
  assert.match(md, /\*\*Returns\*\* `numeric \(by input type\)`: By input type: TINYINT -> INTEGER/);
  assert.ok(!md.includes('SUM(...)'));
});

test('hover: niladic system values render without parentheses', () => {
  const md = hoverAt('SELECT CURRENT_DATE FROM DUMMY', 'CURRENT_DATE')!;
  assert.match(md, /```sql\nCURRENT_DATE -> DATE\n```/);
  assert.ok(!/CURRENT_DATE\(/.test(md));
  assert.match(hoverAt('SELECT CURRENT_TIMESTAMP FROM DUMMY', 'CURRENT_TIMESTAMP')!, /CURRENT_TIMESTAMP\[\(<precision>\)\] -> TIMESTAMP/);
});

test('hover: spatial methods after `.` and constructors after NEW', () => {
  const method = hoverAt('SELECT p1.ST_DISTANCE(p2) FROM t', 'ST_DISTANCE')!;
  assert.match(method, /<geometry>\.ST_Distance\(<geometry2>\[,<unit_name>\]\) -> DOUBLE/);
  assert.match(method, /_Spatial method_ of `ST_Geometry`/);
  assert.match(hoverAt('SELECT geom.ST_AREA() FROM t', 'ST_AREA')!, /Spatial method/);

  const ctor = hoverAt('SELECT NEW ST_POINT(1.0, 2.0) FROM DUMMY', 'ST_POINT')!;
  assert.match(ctor, /NEW ST_Point\(<x>, <y>\[, <srid>\]\) -> ST_Point/);
  assert.match(ctor, /_Spatial constructor_/);
  // the same word as a column type is the data type
  assert.match(hoverAt('CREATE TABLE t (g ST_POINT(4326))', 'ST_POINT')!, /SAP HANA data type/);
  // a qualified column name is still not a keyword
  assert.equal(getSqlHover('SELECT t.DATE FROM t', 'SELECT t.D'.length), null);
});

test('hover: the call context decides between keyword and function', () => {
  assert.match(hoverAt('SELECT * FROM a LEFT JOIN b ON 1 = 1', 'LEFT')!, /reserved keyword/);
  assert.match(hoverAt("SELECT LEFT('abc', 1) FROM DUMMY", 'LEFT')!, /LEFT\(<string>, <number>\) -> type of <string>/);
  assert.match(hoverAt('SELECT * FROM t WHERE x IN (SELECT REPLACE(a, b, c) FROM u)', 'REPLACE')!, /String function/);
  assert.match(hoverAt('REPLACE INTO t VALUES (1)', 'REPLACE')!, /keyword/);
});

test('hover: GraphScript, hierarchy, table and library functions', () => {
  assert.match(hoverAt('n = VERTICES(:g);', 'VERTICES')!, /VERTICES\(<graph>\) -> MULTISET<VERTEX>[\s\S]*_GraphScript built-in_/);
  const h = hoverAt('SELECT * FROM HIERARCHY(SOURCE t SIBLING ORDER BY id)', 'HIERARCHY')!;
  assert.ok(!h.includes('...)'), 'no abbreviated clauses');
  assert.match(h, /`START WHERE` _\(optional\)_: /);
  assert.match(h, /\*\*Returns\*\* `TABLE`: Source columns plus NODE_ID, PARENT_ID, HIERARCHY_RANK/);
  assert.match(hoverAt('SELECT * FROM SERIES_GENERATE_INTEGER(1, 0, 10)', 'SERIES_GENERATE_INTEGER')!, /Columns: GENERATED_PERIOD_START/);
  const lib = hoverAt('USING SQLSCRIPT_STRING AS S; x = S:SPLIT(:v);', 'SPLIT')!;
  assert.match(lib, /SQLScript library member/);
});

// ---------------------------------------------------------------------------
// signature help
// ---------------------------------------------------------------------------

const sigAt = (code: string) => {
  const s = getSqlSignatureHelp(code, code.length)!;
  const sig = s.signatures[s.activeSignature];
  return { label: sig.label, params: sig.parameters.map((p) => p.label), active: sig.parameters[s.activeParameter], index: s.activeParameter };
};

test('signature help: optional positional arguments are separate, documented parameters', () => {
  const r = sigAt('SELECT ROUND(1.5, ');
  assert.deepEqual(r.params, ['<number>', '<position>', '<rounding_mode>']);
  assert.equal(r.active.label, '<position>');
  assert.match(r.active.documentation, /places after the decimal point/);
  const m = sigAt('SELECT p1.ST_DISTANCE(p2, ');
  assert.deepEqual(m.params, ['<geometry2>', '<unit_name>']);
  assert.match(m.active.documentation, /^\(VARCHAR\(128\)\)/);
});

test('signature help: clause-syntax functions follow the clause keyword, not commas', () => {
  const start = sigAt('SELECT * FROM HIERARCHY(SOURCE (SELECT * FROM t) START WHERE ');
  assert.equal(start.active.label, 'START WHERE');
  const depth = sigAt('SELECT * FROM HIERARCHY(SOURCE (SELECT a, b FROM t) SIBLING ORDER BY a, b DEPTH ');
  assert.equal(depth.active.label, 'DEPTH');
  assert.equal(sigAt('SELECT CAST(x AS ').active.label, 'AS <data_type>');
  assert.equal(sigAt('SELECT CAST(x').active.label, '<expression>');
  assert.equal(sigAt("SELECT TRIM(LEADING 'a' FROM ").active.label, '<string>');
  assert.equal(sigAt('SELECT EXTRACT(YEAR FROM ').active.label, 'FROM <date>');
  // `ERROR ON EMPTY` is the ON EMPTY clause, not ON ERROR
  assert.equal(sigAt("SELECT JSON_VALUE(doc, '$.a' RETURNING INTEGER ERROR ON EMPTY ").active.label, 'ON EMPTY');
  assert.equal(sigAt("SELECT JSON_VALUE(doc, '$.a' RETURNING ").active.label, 'RETURNING');
  assert.equal(sigAt('SELECT JSON_VALUE(doc, ').active.label, '<json_path>');
  assert.equal(
    sigAt("SELECT * FROM OPENCYPHER_TABLE(GRAPH WORKSPACE ws QUERY ").active.label,
    'QUERY'
  );
});

test('signature help: variadic functions keep counting; niladic values have none', () => {
  const s = getSqlSignatureHelp('x = COALESCE(a, b, ', 'x = COALESCE(a, b, '.length)!;
  assert.equal(s.activeParameter, 2);
  assert.equal(getSqlSignatureHelp('SELECT CURRENT_DATE(', 'SELECT CURRENT_DATE('.length), null);
  assert.equal(getSqlSignatureHelp('SELECT NOT_A_FUNCTION(', 'SELECT NOT_A_FUNCTION('.length), null);
});

// ---------------------------------------------------------------------------
// completion, highlighting and generated entries
// ---------------------------------------------------------------------------

test('completion: niladic and optional-parenthesis functions insert the bare name', () => {
  const pick = (prefix: string, label: string) => getSqlCompletions(prefix, prefix.length).find((c) => c.label === label)!;
  assert.equal(pick('SELECT CURRENT_DA', 'CURRENT_DATE').insertText, 'CURRENT_DATE');
  assert.equal(pick('SELECT CURRENT_TIMES', 'CURRENT_TIMESTAMP').insertText, 'CURRENT_TIMESTAMP');
  const round = pick('SELECT ROUN', 'ROUND');
  assert.equal(round.insertText, 'ROUND($1)');
  assert.equal(round.detail, 'ROUND(<number> [, <position> [, <rounding_mode>]]) -> type of <number>');
});

test('grammar: spatial constructors keep their type scope in column definitions, ARRAY( stays a call', () => {
  const ddl = tokenize('source.hanasql', 'CREATE TABLE t (g ST_POINT(4326));');
  assert.ok(has(ddl, 'ST_POINT', 'storage.type.hanasql'));
  assert.ok(!has(ddl, 'ST_POINT', 'support.function.spatial.hanasql'));
  const arr = tokenize('source.hanasql', 'a = ARRAY(1, 2);');
  assert.ok(has(arr, 'ARRAY', 'support.function.hanasql'));
  assert.ok(has(tokenize('source.hanasql', 'SELECT SNIPPETS(txt) FROM t'), 'SNIPPETS', 'support.function.hanasql'));
  assert.ok(!has(tokenize('source.hanasql', 'SELECT ST_SETSRID(g, 4326) FROM t'), 'ST_SETSRID', 'support.function.spatial.hanasql'));
});

test('generated catalog: typed kinds, platforms and parameter docs reach sql-catalog.ts', () => {
  const round = SQL_FUNCTIONS.find((f) => f.name === 'ROUND')!;
  assert.equal(round.kind, 'function');
  assert.deepEqual(round.platforms, ['XSC', 'XSA', 'HDI', 'CLOUD']);
  assert.equal(round.params?.[0].name, 'number');
  assert.equal(SQL_FUNCTIONS.find((f) => f.name === 'CURRENT_DATE')!.kind, 'niladic');
  assert.equal(SQL_FUNCTIONS.find((f) => f.name === 'ST_DISTANCE')!.receiverType, 'ST_Geometry');
  assert.equal(SQL_FUNCTIONS.find((f) => f.name === 'HIERARCHY')!.params?.[0].keyword, 'SOURCE');
  assert.equal(SQL_LIBRARY_MEMBERS.SQLSCRIPT_LOGGING.find((f) => f.name === 'LEVEL_INFO')!.kind, 'constant');
});
