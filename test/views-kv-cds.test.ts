/**
 * #42 + #47: embedded SQL, quotes and lists in views, Classic KV and CDS.
 *
 * Spec: docs/specs/diagnostics/syntax-rules.md (HANA-SYN-001, 003, 022, 023, 042),
 * docs/specs/grammars/hdb-classic-kv.md §4.3, docs/specs/grammars/cds.md §4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeDocument } from '../src/analyzer/dispatch';
import { applyTextEdits, DEFAULT_ANALYZER_OPTIONS } from '../src/analyzer/types';

const ROOT = fs.existsSync(path.join(__dirname, '..', 'samples')) ? path.join(__dirname, '..') : path.resolve(__dirname, '../..');

function syntaxDiags(languageId: string, text: string) {
  return analyzeDocument({
    languageId,
    text,
    options: { ...DEFAULT_ANALYZER_OPTIONS, security: false, performance: false, migration: false, calculationView: false, syntax: true },
  });
}

const spans = (languageId: string, text: string): string[][] =>
  syntaxDiags(languageId, text).map((d) => [d.ruleId, text.slice(d.start, d.end)]);

/** Applies the preferred fix of every diagnostic, last first. */
function applyAllFixes(languageId: string, text: string): string {
  let out = text;
  const ds = [...syntaxDiags(languageId, text)].sort((a, b) => b.start - a.start);
  for (const d of ds) if (d.fixes[0]) out = applyTextEdits(out, d.fixes[0].edits);
  return out;
}

const sample = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// Classic KV [XSC]
// ---------------------------------------------------------------------------

test('Classic KV: embedded SQL is checked with offsets mapped to the KV file (#42, #47)', () => {
  const view = [
    'schema = "DEMO_SCHEMA";',
    'query = "SELECT \\"A\\" AS \\"X\\" \\"B\\" FROM \\"T\\" WHERE \\"A\\" 1";',
    'depends_on = "pkg::T1" "pkg::T2";',
    'public = false;',
  ].join('\n');
  assert.deepEqual(spans('hdbview', view), [
    ['HANA-SYN-023', '"pkg::T2"'],
    ['HANA-SYN-023', '\\"B\\"'],
    ['HANA-SYN-024', '1'],
  ]);
  // The `Insert ','` fixes land in the KV text, outside the escapes
  const fixed = applyAllFixes('hdbview', view);
  assert.ok(fixed.includes('AS \\"X\\", \\"B\\" FROM'), fixed);
  assert.ok(fixed.includes('depends_on = "pkg::T1", "pkg::T2";'), fixed);

  const seq = 'schema = "S";\nstart_with = 1;\nreset_by = "SELECT COUNT(*) MAX(\\"ID\\") FROM \\"T\\"";';
  assert.deepEqual(spans('hdbsequence', seq), [['HANA-SYN-023', 'MAX']]);

  // #47: unclosed literals and brackets inside the SQL
  const unclosed = 'schema = "MYSCHEMA";\nquery = "SELECT COUNT(1 FROM \\"T\\" WHERE \\"A\\" = \'unclosed";';
  assert.deepEqual(spans('hdbview', unclosed), [
    ['HANA-SYN-001', "'unclosed"],
    ['HANA-SYN-003', '('],
  ]);
  const qid = spans('hdbview', 'schema = "S";\nquery = "SELECT \\"ID FROM DUMMY";');
  assert.ok(qid.some(([r]) => r === 'HANA-SYN-001'), JSON.stringify(qid));
  const brackets = spans('hdbview', 'schema = "S";\nquery = "SELECT ([1)] FROM \\"T\\"";');
  assert.ok(brackets.some(([r, s]) => r === 'HANA-SYN-003' && s === '('), JSON.stringify(brackets));

  // Escapes are SQL whitespace and characters; the SQL value may span lines
  assert.deepEqual(
    syntaxDiags('hdbview', 'schema = "S";\nquery = "SELECT \\"A\\"\\n\\tFROM \\"T\\"\nWHERE \\"B\\" = \'x\\\\y\'";\npublic = false;'),
    []
  );
  // The shipped Classic samples stay clean
  for (const f of ['samples/xs-classic/MYVIEW.hdbview', 'samples/format-demos/classic-view.hdbview']) {
    assert.deepEqual(syntaxDiags('hdbview', sample(f)), [], f);
  }
  assert.deepEqual(syntaxDiags('hdbsequence', sample('samples/xs-classic/MYSEQ.hdbsequence')), []);
});

test('Classic KV: an unescaped quote ends the SQL value early, with an escape QuickFix (#47)', () => {
  const text = 'schema = "MYSCHEMA";\nquery = "SELECT "ID" FROM "MYSCHEMA"."MY_TABLE"";\npublic = false;';
  const ds = syntaxDiags('hdbview', text);
  assert.deepEqual(
    ds.map((d) => [d.ruleId, d.start]),
    [['HANA-SYN-001', text.indexOf('"ID')]]
  );
  assert.match(ds[0].message, /Unescaped '"' ends the value of 'query' early/);
  const fixed = applyTextEdits(text, ds[0].fixes[0].edits);
  assert.equal(fixed, 'schema = "MYSCHEMA";\nquery = "SELECT \\"ID\\" FROM \\"MYSCHEMA\\".\\"MY_TABLE\\"";\npublic = false;');
  assert.deepEqual(syntaxDiags('hdbview', fixed), []);
});

test('Classic KV: value strings, quotes, parentheses and arrays (#47)', () => {
  // A value that runs into the next key line is cut at its line; the next entry is checked normally
  assert.deepEqual(spans('hdbview', 'schema = "MYSCHEMA;\nquery = "SELECT * FROM \\"T\\"";'), [['HANA-SYN-001', '"MYSCHEMA;']]);
  assert.match(syntaxDiags('hdbview', 'schema = "MYSCHEMA;\nquery = "SELECT 1 FROM DUMMY";')[0].message, /value of 'schema' runs into the next line/);

  // Single quotes, with a QuickFix
  const quoted: Array<[string, string]> = [
    ['hdbview', "schema = 'MYSCHEMA';\nquery = \"SELECT 1 FROM DUMMY\";"],
    ['hdbschema', "schema_name = 'S';"],
    ['xshttpdest', "host = 'example.com';\nport = 443;"],
  ];
  for (const [lang, text] of quoted) {
    const ds = syntaxDiags(lang, text);
    assert.deepEqual(ds.map((d) => d.ruleId), ['HANA-SYN-022'], `${lang}: ${JSON.stringify(ds)}`);
    assert.deepEqual(syntaxDiags(lang, applyTextEdits(text, ds[0].fixes[0].edits)), [], lang);
  }

  // An unclosed `[` is fenced by its `;`: no cascade into the next entry
  assert.deepEqual(spans('hdbview', 'schema = "S";\ndepends_on = ["T1";\ndepends_on_table = ["T2"];'), [['HANA-SYN-003', '[']]);
  // Parenthesized values
  assert.deepEqual(spans('hdbview', 'schema = "S";\nquery = ("SELECT 1");'), [['HANA-SYN-022', '(']]);
  // Numbers are single tokens
  assert.deepEqual(spans('hdbtable', 'table.schemaName = "S";\nx = [1 2];'), [['HANA-SYN-023', '2']]);
  assert.deepEqual(
    syntaxDiags('hdbtable', 'table.schemaName = "S";\nx = [1, -2, 3.5];\ntable.columns = [{name = "A"; sqlType = INTEGER; length = 10;}];'),
    []
  );
  assert.deepEqual(syntaxDiags('hdbview', 'schema = "S";\ndepends_on = "a::T1", "a::T2";\nquery = "SELECT 1 FROM DUMMY"'), []);
  // A broken HDI view that mentions a KV key name is not Classic KV
  assert.deepEqual(syntaxDiags('hdbview', 'VIE "V" AS SELECT public FROM "T"').map((d) => d.ruleId), ['HANA-SYN-004']);
});

test('Classic KV: security and performance rules run on the embedded SQL with mapped spans (#42)', () => {
  const text = 'schema = "S";\nquery = "SELECT * FROM \\"T\\"";\npublic = false;';
  const perf = analyzeDocument({ languageId: 'hdbview', text, options: DEFAULT_ANALYZER_OPTIONS }).filter((d) => d.ruleId === 'HANA-PERF-004');
  assert.deepEqual(perf.map((d) => text.slice(d.start, d.end)), ['SELECT *']);
});

// ---------------------------------------------------------------------------
// Views [HDI] [CLOUD]
// ---------------------------------------------------------------------------

test('views: parameters and WITH ASSOCIATIONS are parsed without false positives (#42, #78)', () => {
  const assoc =
    'WITH ASSOCIATIONS (JOIN "T2" AS "toT2" ON "toT2"."ID" = "T2_ID", MANY TO ONE JOIN "T3" "b" ON "b"."ID" = "ID" WITH DEFAULT FILTER "b"."X" > 1, "S"."T"."A" AS "a")';
  const valid: Array<[string, string]> = [
    ['hdbview', `VIEW "V" AS SELECT "ID", "T2_ID" FROM "T" ${assoc}`],
    ['hdbprojectionview', `PROJECTION VIEW "PV" AS SELECT "ID", "T2_ID" FROM "T" ${assoc}`],
    ['hdbtable', `COLUMN TABLE "T" ("ID" INT, "T2_ID" INT) ${assoc}`],
    ['hanasql', `CREATE VIEW "V" AS SELECT "ID", "T2_ID" FROM "T" ${assoc};`],
    ['hanasql', `CREATE PROJECTION VIEW "PV" AS SELECT "ID" FROM "T" ${assoc};`],
    ['hdbview', `VIEW "V" (IN p1 INT, IN p2 NVARCHAR(10) DEFAULT 'x') AS SELECT "A" FROM "T" WHERE "A" = :p1`],
    ['hanasql', 'CREATE VIEW v2 (c1, c2) (IN p1 INT, IN p2 NVARCHAR(10)) AS SELECT col1, col2 FROM t WHERE col1 = :p1 AND col2 = :p2;'],
  ];
  for (const [lang, text] of valid) assert.deepEqual(syntaxDiags(lang, text), [], `${lang}: ${text}`);
});

test('views: missing commas and typos in associations and parameters (#42, #78)', () => {
  const missing = 'CREATE VIEW "V" AS SELECT "ID" FROM "T" WITH ASSOCIATIONS (JOIN "T2" AS "a" ON "a"."ID" = "ID" JOIN "T3" AS "b" ON "b"."ID" = "ID");';
  assert.deepEqual(spans('hanasql', missing), [['HANA-SYN-023', 'JOIN']]);
  assert.ok(applyAllFixes('hanasql', missing).includes('= "ID", JOIN "T3"'));
  assert.deepEqual(spans('hanasql', 'CREATE VIEW "V" AS SELECT "ID" FROM "T" WITH ASSOCIATIONS (JOIN "T2" AS "a" ONN "a"."ID" = "ID");'), [['HANA-SYN-021', 'ONN']]);
  assert.deepEqual(spans('hdbview', 'VIEW "V" (IN p1 INT IN p2 INT) AS SELECT "A" FROM "T"'), [['HANA-SYN-023', 'IN']]);
  // One missing comma is one diagnostic (no HANA-SYN-024 duplicate)
  assert.deepEqual(spans('hdbview', 'VIEW "V" AS SELECT "ID" FROM "T" WHERE "A" IN (1 2)'), [['HANA-SYN-023', '2']]);
});

test('views: a bare column whose alias sits on its own line is a warning with two fixes (#42)', () => {
  const text = 'VIEW "V" AS SELECT\n  "ID"\n  "NAME",\n  "PRICE"\nFROM "T"';
  const ds = syntaxDiags('hdbview', text);
  assert.deepEqual(
    ds.map((d) => [d.ruleId, d.severity, text.slice(d.start, d.end)]),
    [['HANA-SYN-023', 'warning', '"NAME"']]
  );
  assert.deepEqual(
    ds[0].fixes.map((f) => [f.title, f.isPreferred]),
    [
      ["Insert ','", true],
      ["Insert 'AS'", false],
    ]
  );
  assert.deepEqual(syntaxDiags('hdbview', applyTextEdits(text, ds[0].fixes[0].edits)), []);
  assert.deepEqual(syntaxDiags('hdbview', applyTextEdits(text, ds[0].fixes[1].edits)), []);
  assert.match(syntaxDiags('hanasql', 'SELECT t.a\n x FROM t;')[0].message, /alias of 't\.a'/);
  // samples/test.hdbview with its first comma removed (#42)
  const broken = sample('samples/test.hdbview').replace('"ID",', '"ID"');
  assert.deepEqual(spans('hdbview', broken), [['HANA-SYN-023', '"NAME"']]);
  // Negative: same-line aliases, AS aliases, and wrapped long items stay silent
  for (const valid of [
    'SELECT "ID" "NAME", "PRICE" "P" FROM "T";',
    'SELECT "ID"\n  AS "NAME" FROM "T";',
    'SELECT WIDTH_BUCKET(salary, 1, 2, 4)\n "Wages" FROM t;',
    "SELECT 'abc'\n\"label\" FROM DUMMY;",
  ]) {
    assert.deepEqual(syntaxDiags('hanasql', valid), [], valid);
  }
});

// ---------------------------------------------------------------------------
// CDS
// ---------------------------------------------------------------------------

test('CDS: select, group by / order by, parameter and index lists need commas (#42)', () => {
  const view = 'namespace a;\ncontext C {\nview V as select from T { id\n name } group by id name order by id name;\n};';
  assert.deepEqual(spans('hdbcds', view), [
    ['HANA-SYN-023', 'name'],
    ['HANA-SYN-023', 'name'],
    ['HANA-SYN-023', 'name'],
  ]);
  const fixed = applyAllFixes('hdbcds', view);
  assert.equal(fixed, 'namespace a;\ncontext C {\nview V as select from T { id,\n name } group by id, name order by id, name;\n};');
  assert.deepEqual(syntaxDiags('hdbcds', fixed), []);
  assert.deepEqual(
    spans('hdbdd', 'namespace a;\ncontext C {\n  entity E { key id : Integer; name : String(10); } technical configuration { index idx on (id name); };\n};'),
    [['HANA-SYN-023', 'name']]
  );
  assert.deepEqual(
    spans('hdbcds', 'namespace a;\ncontext C {\n  view V with parameters p1 : Integer p2 : String(10) as select from T { id };\n};'),
    [['HANA-SYN-023', 'p2']]
  );
});

test('CDS: keywords, aliases, annotations, literals, mixins and unions are not adjacent items (#42)', () => {
  const valid = [
    'namespace a;',
    'context C {',
    '  entity E { key id : Integer; x : String(10); toE : Association[0..1] to E on toE.id = id; };',
    "  view V with parameters p1 : Integer, p2 : String(10) as select from E { key id, x as n, upper(x) as u, date'2024-01-01' as d,",
    "    @EndUserText.label: 'X' x as y, case when id = 1 then x else 'z' end as q, :p1 as p, $projection.x as px }",
    '    where id = :p1 group by id, x order by id desc, x;',
    '  view W as select from E mixin { m : association to E on m.id = $projection.id; } into { id, m } union all select from E { id, toE.x as t };',
    '};',
  ].join('\n');
  assert.deepEqual(syntaxDiags('hdbcds', valid), []);
  for (const f of ['samples/xs-classic/model.hdbdd', 'samples/format-demos/classic-model.hdbdd']) assert.deepEqual(syntaxDiags('hdbdd', sample(f)), [], f);
  for (const f of ['samples/hdi/model.hdbcds', 'samples/format-demos/hdi-model.hdbcds']) assert.deepEqual(syntaxDiags('hdbcds', sample(f)), [], f);
  // `![...]` is a delimited identifier: quotes and parentheses inside it are not SQL
  assert.deepEqual(syntaxDiags('hdbcds', 'namespace my.ns;\ncontext C { entity E { x : String(10) = ![UPPER("COL]; }; };'), []);
});

test('CDS / .xsodata: an unclosed string does not cascade to the enclosing braces (#47)', () => {
  assert.deepEqual(
    spans('hdbcds', "namespace my.ns;\ncontext C { entity E { x : String(10) default 'abc; y : Integer; }; };").map(([r]) => r),
    ['HANA-SYN-001']
  );
  assert.deepEqual(spans('xsodata', 'service { "S"."T" as "E" key (\'ID); }').map(([r]) => r), ['HANA-SYN-001']);
  // A string cut at its line keeps the rest of the file in view
  const multi = spans('hdbcds', "namespace my.ns;\ncontext C { entity E { x : String(10) default 'abc;\n  y : Integer; }; };");
  assert.ok(!multi.some(([r]) => r === 'HANA-SYN-003'), JSON.stringify(multi));
});
