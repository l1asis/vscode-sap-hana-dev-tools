import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeDocument } from '../src/analyzer/dispatch';
import { applyTextEdits, DEFAULT_ANALYZER_OPTIONS, type AnalyzerDiagnostic } from '../src/analyzer/types';
import { SQL_LANGUAGES } from '../src/formatter/dispatch';
import { sampleLanguageId, walkSamples } from './helpers/samples';

const ROOT = fs.existsSync(path.join(__dirname, '..', 'samples'))
  ? path.join(__dirname, '..')
  : path.resolve(__dirname, '../..');

function syntaxDiags(languageId: string, text: string): AnalyzerDiagnostic[] {
  return analyzeDocument({
    languageId,
    text,
    options: { ...DEFAULT_ANALYZER_OPTIONS, security: false, performance: false, migration: false, calculationView: false, syntax: true },
  });
}

function rule(diags: readonly AnalyzerDiagnostic[], ruleId: string): AnalyzerDiagnostic[] {
  return diags.filter((d) => d.ruleId === ruleId);
}

function spanText(src: string, d: AnalyzerDiagnostic): string {
  return src.slice(d.start, d.end);
}

test('samples: every SQL / SQLScript sample artifact analyzes with zero syntax diagnostics', () => {
  let checked = 0;
  // samples/broken/ is intentionally invalid and checked by test/broken-samples.test.ts instead.
  for (const file of walkSamples({ includeBroken: false })) {
    const languageId = sampleLanguageId(file);
    if (!languageId || (languageId !== 'hanasql' && !SQL_LANGUAGES.includes(languageId))) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.deepEqual(syntaxDiags(languageId, text), [], path.relative(ROOT, file));
    checked++;
  }
  assert.ok(checked >= 20, `expected to sweep the SQL samples, checked ${checked}`);
});

test('HANA-SYN-005: `//` is not a SQL comment; `--` and `/* */` are', () => {
  const src = 'SELECT 1 FROM DUMMY; // trailing note\n';
  const d = rule(syntaxDiags('hanasql', src), 'HANA-SYN-005');
  assert.equal(d.length, 1);
  assert.equal(spanText(src, d[0]), '// trailing note');
  assert.equal(applyTextEdits(src, d[0].fixes[0].edits), 'SELECT 1 FROM DUMMY; -- trailing note\n');
  assert.deepEqual(syntaxDiags('hanasql', applyTextEdits(src, d[0].fixes[0].edits)), []);

  // A quote inside the bogus comment must not swallow the following statements.
  const quoted = "SELECT 1 FROM DUMMY; // it's broken\nSELECT 2 FROM DUMMY;";
  const qd = syntaxDiags('hanasql', quoted);
  assert.equal(qd.length, 1, JSON.stringify(qd));
  assert.equal(qd[0].ruleId, 'HANA-SYN-005');

  // Negative: valid comments, `//` inside strings and quoted identifiers, division.
  assert.deepEqual(syntaxDiags('hanasql', '-- note\nSELECT 1 /* block // */ FROM DUMMY;'), []);
  assert.deepEqual(syntaxDiags('hanasql', "SELECT 'http://host/a' AS \"u//r\", 4 / 2 FROM DUMMY;"), []);
  assert.deepEqual(syntaxDiags('hanasql', 'SELECT 1 FROM DUMMY; /* a *//* b */'), []);
});

test('HANA-SYN-005: characters outside the SQL lexical grammar', () => {
  for (const ch of ['&', '|', '\\', '`', '!', '~', '^', '’', '→', '…']) {
    const src = `SELECT a ${ch} b FROM t;`;
    const d = rule(syntaxDiags('hanasql', src), 'HANA-SYN-005');
    assert.equal(d.length, 1, `${ch}: ${JSON.stringify(syntaxDiags('hanasql', src))}`);
    assert.equal(spanText(src, d[0]), ch);
  }
  const typo = rule(syntaxDiags('hanasql', 'SELECT ‘x’ FROM DUMMY;'), 'HANA-SYN-005');
  assert.ok(typo.length >= 1 && /Typographic quote/.test(typo[0].message));

  // Cascades from other rules are dropped in favour of the precise lexical diagnostic.
  const cascade = syntaxDiags('hanasql', 'SELECT a FROM t WHERE a & b;');
  assert.deepEqual(cascade.map((d) => d.ruleId), ['HANA-SYN-005']);

  // Negative: valid multi-character operators and characters inside literals / identifiers.
  assert.deepEqual(syntaxDiags('hanasql', 'SELECT * FROM t WHERE a != 1 AND b <> 2 AND c >= 3 AND d <= 4;'), []);
  // `~=` / `^=` are not SAP HANA comparison operators (SQL Reference: =, >, <, >=, <=, !=, <>).
  assert.deepEqual(rule(syntaxDiags('hanasql', 'SELECT * FROM t WHERE b ~= 2;'), 'HANA-SYN-005').length, 1);
  assert.deepEqual(syntaxDiags('hanasql', "SELECT 'a & b | c' || 'd' AS \"x&y\" FROM DUMMY;"), []);
  assert.deepEqual(syntaxDiags('hanasql', "SELECT * FROM t WHERE c LIKE '%\\_%' ESCAPE '\\';"), []);
});

test('HANA-SYN-005: SQLScript pragmas and SQLSCRIPT_TEST annotations', () => {
  const ok = [
    'DO BEGIN',
    "  @AnalyzerSuppress('SAP.UNNECESSARY_VARIABLE.CONSISTENCY')",
    "  @pushScope(@AnalyzerSuppress('SAP.UNUSED_VARIABLE_VALUE.CONSISTENCY'))",
    '  DECLARE a INT = 5;',
    '  @popscope()',
    'END;',
  ].join('\n');
  assert.deepEqual(rule(syntaxDiags('hanasql', ok), 'HANA-SYN-005'), []);

  const lib = 'LIBRARY "T" LANGUAGE SQLSCRIPT TEST AS BEGIN\n  @Test()\n  PUBLIC PROCEDURE t1() AS BEGIN END;\nEND';
  assert.deepEqual(rule(syntaxDiags('hdblibrary', lib), 'HANA-SYN-005'), []);

  const bad = ok.replace('@popscope()', '@someOtherPragma()');
  const d = rule(syntaxDiags('hanasql', bad), 'HANA-SYN-005');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /Unknown SQLScript pragma '@someOtherPragma'/);
});

test('HANA-SYN-006: glued literals and quoted identifiers', () => {
  const qident = 'SELECT * FROM "com.acme::sample_table"ddddddd;';
  const q = rule(syntaxDiags('hanasql', qident), 'HANA-SYN-006');
  assert.equal(q.length, 1);
  assert.equal(q[0].severity, 'warning');
  assert.equal(spanText(qident, q[0]), '"com.acme::sample_table"ddddddd');
  assert.equal(applyTextEdits(qident, q[0].fixes[0].edits), 'SELECT * FROM "com.acme::sample_table" ddddddd;');

  const str = rule(syntaxDiags('hanasql', "SELECT 'str'abc FROM DUMMY;"), 'HANA-SYN-006');
  assert.equal(str.length, 1);
  assert.equal(str[0].severity, 'warning');

  const num = rule(syntaxDiags('hanasql', 'SELECT 123abc FROM DUMMY;'), 'HANA-SYN-006');
  assert.equal(num.length, 1);
  assert.equal(num[0].severity, 'error');

  // #88: a hex literal is one number token, so a word glued after it is still reported.
  const hexGlued = 'SELECT 0x1Fzz FROM DUMMY;';
  const hex = rule(syntaxDiags('hanasql', hexGlued), 'HANA-SYN-006');
  assert.equal(hex.length, 1);
  assert.equal(spanText(hexGlued, hex[0]), '0x1Fzz');
  assert.deepEqual(syntaxDiags('hanasql', 'SELECT 0x0abc "hex_value" FROM DUMMY;'), []);

  assert.equal(rule(syntaxDiags('hanasql', "SELECT 'a''b' 'c'X FROM DUMMY;"), 'HANA-SYN-006').length, 1);
  assert.equal(rule(syntaxDiags('hanasql', 'SELECT "A""B"C FROM DUMMY;'), 'HANA-SYN-006').length, 1);

  // Negative: escapes, typed / prefixed literals, hex, decimals, exponents, member access, ranges, JSON paths.
  const valid = [
    "SELECT 'it''s', N'x', X'01AF', DATE'2024-01-01', \"A\"\"B\" FROM DUMMY;",
    'SELECT 0x1F, 1.5, .5, 1e10, 2.5E-3 FROM DUMMY;',
    'SELECT "S"."T"."C", t.*, :lt.col FROM "S"."T" t;',
    'SELECT a /*c*/"B" FROM t;',
    'SELECT seq.NEXTVAL, seq.CURRVAL, t.ROWID FROM t;',
  ];
  for (const v of valid) assert.deepEqual(syntaxDiags('hanasql', v), [], v);
  assert.deepEqual(
    syntaxDiags('hdbprocedure', 'PROCEDURE p() AS BEGIN\n  DECLARE i INT;\n  FOR i IN 1..10 DO\n    SELECT :i FROM DUMMY;\n  END FOR;\nEND'),
    []
  );
});

test('HANA-SYN-006: undelimited object names containing `::`', () => {
  const src = 'SELECT * FROM com.mycompany.apps::sample_table;';
  const d = rule(syntaxDiags('hanasql', src), 'HANA-SYN-006');
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, 'error');
  assert.equal(spanText(src, d[0]), 'com.mycompany.apps::sample_table');
  const fixed = applyTextEdits(src, d[0].fixes[0].edits);
  assert.equal(fixed, 'SELECT * FROM "com.mycompany.apps::sample_table";');
  assert.deepEqual(syntaxDiags('hanasql', fixed), []);

  // Negative: cursor attributes and system variables.
  const cursor = [
    'PROCEDURE p() AS BEGIN',
    '  DECLARE CURSOR c_cursor1 FOR SELECT 1 AS x FROM DUMMY;',
    '  DECLARE n INT;',
    '  OPEN c_cursor1;',
    '  IF c_cursor1::ISCLOSED THEN RETURN; END IF;',
    '  IF c_cursor1::NOTFOUND THEN n = c_cursor1::ROWCOUNT; END IF;',
    '  CLOSE c_cursor1;',
    '  n = ::ROWCOUNT;',
    'END',
  ].join('\n');
  assert.deepEqual(rule(syntaxDiags('hdbprocedure', cursor), 'HANA-SYN-006'), []);
});

test('HANA-SYN-024: consecutive, leading and trailing commas', () => {
  const run = 'SELECT a,,,, b FROM t;';
  const d = rule(syntaxDiags('hanasql', run), 'HANA-SYN-024');
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.equal(spanText(run, d[0]), ',,,');
  assert.equal(applyTextEdits(run, d[0].fixes[0].edits), 'SELECT a, b FROM t;');

  const spaced = rule(syntaxDiags('hanasql', 'SELECT f(a, /* x */ , b) FROM t;'), 'HANA-SYN-024');
  assert.equal(spaced.length, 1);

  const lead = 'INSERT INTO A (, ab) VALUES (1, 2);';
  const ld = rule(syntaxDiags('hanasql', lead), 'HANA-SYN-024');
  assert.equal(ld.length, 1);
  assert.equal(applyTextEdits(lead, ld[0].fixes[0].edits), 'INSERT INTO A ( ab) VALUES (1, 2);');

  const trail = rule(syntaxDiags('hanasql', 'SELECT a FROM t ORDER BY a,;'), 'HANA-SYN-024');
  assert.ok(trail.some((x) => /Trailing ','/.test(x.message)), JSON.stringify(trail));

  assert.deepEqual(syntaxDiags('hanasql', 'SELECT a, b, f(c, d) FROM t;'), []);
});

test('HANA-SYN-024: stray and repeated dot separators', () => {
  const stray = 'SELECT a FROM t,.u;';
  const s = rule(syntaxDiags('hanasql', stray), 'HANA-SYN-024');
  assert.ok(s.some((x) => spanText(stray, x) === '.' && /Stray '\.'/.test(x.message)), JSON.stringify(s));

  const dangling = rule(syntaxDiags('hanasql', 'SELECT t. FROM t;'), 'HANA-SYN-024');
  assert.ok(dangling.some((x) => /missing name part after/.test(x.message)), JSON.stringify(dangling));

  const triple = 'SELECT a...b FROM t;';
  const tr = rule(syntaxDiags('hanasql', triple), 'HANA-SYN-024');
  assert.equal(tr.length, 1);
  assert.equal(spanText(triple, tr[0]), '...');

  assert.deepEqual(syntaxDiags('hanasql', 'SELECT s.t.c, "S".t.*, :tv.c, f(x).y FROM s.t;'), []);
});

test('issue #25 reproduction: corrupted routine header and FROM clause emit lexical diagnostics', () => {
  const src = [
    'FUNCTION com.mycompany.apps::get_total_price (',
    '    IN im_tax_rate DECIMAL(3, 2)',
    ')',
    'RETURNS TABLE (ITEM_NAME NVARCHAR(100))',
    'LANGUAGE SQLSCRIPT',
    'SQL SECURITY INVOKER,,,,.//asd/.AWlpqwkr',
    'AS',
    'BEGIN',
    '    RETURN SELECT NAME AS ITEM_NAME',
    '    FROM com.mycompany.apps::sample_tableddddddd;',
    'END;',
  ].join('\n');
  const diags = syntaxDiags('hdbfunction', src);
  const texts = diags.map((d) => `${d.ruleId}:${spanText(src, d)}`);
  assert.ok(texts.includes('HANA-SYN-006:com.mycompany.apps::get_total_price'), texts.join('\n'));
  assert.ok(texts.includes('HANA-SYN-024:,,,'), texts.join('\n'));
  assert.ok(texts.includes('HANA-SYN-024:.'), texts.join('\n'));
  assert.ok(texts.includes('HANA-SYN-005://asd/.AWlpqwkr'), texts.join('\n'));
  assert.ok(texts.includes('HANA-SYN-006:com.mycompany.apps::sample_tableddddddd'), texts.join('\n'));
});
