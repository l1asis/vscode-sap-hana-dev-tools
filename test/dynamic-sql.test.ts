/**
 * #45: EXEC / EXECUTE IMMEDIATE clauses, bindings and static SQL literals.
 *
 * Spec: docs/specs/diagnostics/syntax-rules.md (HANA-SYN-029, HANA-SYN-042 "Dynamic SQL", HANA-SYN-043).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyzer/dispatch';
import { applyTextEdits, DEFAULT_ANALYZER_OPTIONS } from '../src/analyzer/types';
import { tokenize as tmTokenize } from './helpers/tm';

function syntaxDiags(languageId: string, text: string) {
  return analyzeDocument({
    languageId,
    text,
    options: { ...DEFAULT_ANALYZER_OPTIONS, security: false, performance: false, migration: false, calculationView: false, syntax: true },
  });
}

/** Wraps `body` in a procedure with scalar variables `x`, `y`, inputs `a`, `b` and a table variable `tv`. */
const proc = (body: string): string =>
  `PROCEDURE "P" (IN a INT, IN b INT) AS BEGIN DECLARE x INT; DECLARE y INT; DECLARE tv TABLE (c INT); DECLARE tv2 TABLE (c INT);\n${body}\nEND`;

const spans = (body: string): string[][] => {
  const text = proc(body);
  return syntaxDiags('hdbprocedure', text).map((d) => [d.ruleId, text.slice(d.start, d.end)]);
};
const messages = (body: string): string[] => syntaxDiags('hdbprocedure', proc(body)).map((d) => `${d.ruleId} ${d.message}`);

test('EXEC: clause order, duplicates and missing parts are HANA-SYN-042 (#45)', () => {
  assert.deepEqual(messages("EXEC 'SELECT c FROM t WHERE c = ?' USING :a INTO x;"), ["HANA-SYN-042 'INTO' must come before 'USING' in EXEC statement."]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM t' READS SQL DATA INTO x;"), ["HANA-SYN-042 'INTO' must come before 'READS SQL DATA' in EXEC statement."]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM t WHERE c = ?' READS SQL DATA USING :a;"), ["HANA-SYN-042 'USING' must come before 'READS SQL DATA' in EXEC statement."]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM t' INTO x INTO y;"), ["HANA-SYN-042 Duplicate 'INTO' clause in EXEC statement."]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM t' DEFAULT 1;"), ["HANA-SYN-042 'DEFAULT' needs a preceding 'INTO' variable list in EXEC statement."]);
  assert.deepEqual(messages("EXEC 'SELECT c, c FROM t' INTO x, y DEFAULT 1;"), ["HANA-SYN-042 'DEFAULT' lists 1 value for 2 'INTO' variables."]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM t' INTO;"), ["HANA-SYN-042 Missing variable after 'INTO'."]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM t WHERE c = ?' USING;"), ["HANA-SYN-042 Missing expression after 'USING'."]);
  assert.deepEqual(spans('EXEC;'), [['HANA-SYN-042', 'EXEC']]);
  assert.deepEqual(spans('EXECUTE IMMEDIATE;'), [['HANA-SYN-042', 'IMMEDIATE']]);
});

test('EXEC: EXECUTE without IMMEDIATE and keyword typos come with QuickFixes (#45)', () => {
  const cases: Array<[string, string, string]> = [
    ["EXECUTE 'SELECT 1 FROM DUMMY';", 'HANA-SYN-042', "EXECUTE IMMEDIATE 'SELECT 1 FROM DUMMY';"],
    ["EXECUTE IMMEDATE 'SELECT 1 FROM DUMMY';", 'HANA-SYN-021', "EXECUTE IMMEDIATE 'SELECT 1 FROM DUMMY';"],
    ["EXEC 'SELECT c FROM t' READ SQL DATA;", 'HANA-SYN-021', "EXEC 'SELECT c FROM t' READS SQL DATA;"],
    ["EXEC 'SELECT c FROM t' READS SQL DAT;", 'HANA-SYN-021', "EXEC 'SELECT c FROM t' READS SQL DATA;"],
    ["EXEC 'SELECT c FROM t' INTOO x;", 'HANA-SYN-021', "EXEC 'SELECT c FROM t' INTO x;"],
  ];
  for (const [body, rule, fixed] of cases) {
    const text = proc(body);
    const ds = syntaxDiags('hdbprocedure', text);
    assert.deepEqual(ds.map((d) => d.ruleId), [rule], `${body}: ${JSON.stringify(ds)}`);
    assert.equal(applyTextEdits(text, ds[0].fixes[0].edits), proc(fixed), body);
    assert.deepEqual(syntaxDiags('hdbprocedure', proc(fixed)), [], fixed);
  }
});

test('HANA-SYN-043: parameter binding rules of static dynamic SQL (#45)', () => {
  assert.deepEqual(spans("EXEC 'SELECT c FROM t WHERE c = ? AND d = :b' USING :a;"), [['HANA-SYN-043', ':b']]);
  assert.deepEqual(spans("EXEC 'SELECT c FROM t WHERE c = ? AND d = ?' USING :a;"), [['HANA-SYN-043', 'USING']]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM t WHERE c = ? AND d = ?' USING :a;"), ["HANA-SYN-043 The SQL has 2 '?' parameters, but 'USING' binds 1 value."]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM t WHERE c = ?';"), ["HANA-SYN-043 The SQL has 1 '?' parameter, but there is no 'USING' clause."]);
  assert.deepEqual(spans("EXEC 'SELECT c FROM t WHERE c = :a AND d = :b' USING :a;"), [['HANA-SYN-043', ':b']]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM t WHERE c = :a' USING :a + 1;"), ["HANA-SYN-043 With ':<variable>' parameters, 'USING' takes variable references only."]);
  assert.deepEqual(messages("EXEC 'SELECT c FROM :tv' INTO tv USING :tv;"), ["HANA-SYN-043 Table variable ':tv' cannot be used in both 'INTO' and 'USING'."]);
});

test('HANA-SYN-*: the SQL of a static literal is checked, mapped through the quote escapes (#45)', () => {
  const body = "EXEC 'SELCT c FROM t WHERE x = ''it''''s''';";
  const text = proc(body);
  const ds = syntaxDiags('hdbprocedure', text);
  assert.deepEqual(ds.map((d) => [d.ruleId, text.slice(d.start, d.end)]), [['HANA-SYN-021', 'SELCT']]);
  assert.equal(applyTextEdits(text, ds[0].fixes[0].edits), proc("EXEC 'SELECT c FROM t WHERE x = ''it''''s''';"));
  // A span after an escaped quote lands on the right characters
  assert.deepEqual(spans("EXEC 'SELECT c FROM t WHERE x = ''a'' AND y 1';"), [['HANA-SYN-024', '1']]);
  assert.deepEqual(spans("EXEC 'SELECT c FROM t WHERE c IN (1 2)';"), [['HANA-SYN-023', '2']]);
});

test('EXEC: valid dynamic SQL stays clean, concatenated and variable SQL is never inspected (#45)', () => {
  for (const body of [
    "EXEC 'SELECT c FROM t WHERE c = ? AND d = ?' INTO x USING :a, :b + 1 READS SQL DATA;",
    "EXECUTE IMMEDIATE 'SELECT c FROM t' INTO x DEFAULT 0;",
    "EXEC 'SELECT c, c FROM t' INTO x, y DEFAULT -2 + 1, NULL;",
    "EXEC 'SELECT * FROM ' || :a || ' WHERE x = ''' || :b || '''';",
    "EXEC 'select c + :a as c from :tv' INTO tv2 USING :a, :tv;",
    "WITH SQL STATISTICS INTO x DO EXEC 'CREATE SYNONYM s FOR t';",
    "EXEC 'SELECT ''?'' AS q, c FROM t WHERE c = ? -- ? in a comment' USING :a;",
    'EXECUTE IMMEDIATE :a;',
    "EXEC 'SELEC WHATEVER' || :a;",
  ]) {
    assert.deepEqual(syntaxDiags('hdbprocedure', proc(body)), [], body);
  }
});

test('HANA-SYN-029: dynamic SQL runs read-only in table UDFs and READS SQL DATA procedures (#45)', () => {
  const syn29 = (lang: string, text: string) => syntaxDiags(lang, text).filter((d) => d.ruleId === 'HANA-SYN-029').map((d) => d.message);
  // allowed: read-only dynamic SQL (SQLScript Reference 8.10)
  assert.deepEqual(syn29('hdbprocedure', "PROCEDURE p(IN a NVARCHAR(12)) READS SQL DATA AS BEGIN EXEC 'SELECT * FROM ' || :a; END"), []);
  assert.deepEqual(syn29('hdbprocedure', "PROCEDURE p() READS SQL DATA AS BEGIN EXEC 'SELECT 1 FROM DUMMY'; END"), []);
  assert.deepEqual(
    syn29('hdbtablefunction', "FUNCTION f() RETURNS TABLE (a INT) LANGUAGE SQLSCRIPT AS BEGIN DECLARE lt TABLE (a INT); EXEC 'SELECT 1 AS a FROM DUMMY' INTO lt; RETURN :lt; END"),
    []
  );
  // a static write statement in a read-only context
  assert.deepEqual(syn29('hdbprocedure', "PROCEDURE p() READS SQL DATA AS BEGIN EXEC 'DELETE FROM t'; END"), [
    "Dynamic SQL in a READS SQL DATA procedure runs read-only; 'DELETE' is not a read-only statement.",
  ]);
  assert.deepEqual(syn29('hdbprocedure', "PROCEDURE p() AS BEGIN EXEC 'DROP TABLE t' READS SQL DATA; END"), [
    "Dynamic SQL in a 'READS SQL DATA' statement runs read-only; 'DROP' is not a read-only statement.",
  ]);
  // scalar UDFs still reject dynamic SQL
  assert.deepEqual(syn29('hdbfunction', "FUNCTION f() RETURNS r INT LANGUAGE SQLSCRIPT AS BEGIN EXEC 'SELECT 1 FROM DUMMY' INTO r; END"), [
    "Dynamic SQL ('EXEC') is not allowed inside a scalar FUNCTION.",
  ]);
  // a normal procedure may write
  assert.deepEqual(syn29('hdbprocedure', "PROCEDURE p() AS BEGIN EXEC 'DROP TABLE t'; END"), []);
});

test('hanasql grammar: EXECUTE IMMEDIATE and READS / MODIFIES SQL DATA are keywords, bare words are not (#45)', () => {
  const scopeOf = (src: string, text: string): string[] => {
    const toks = tmTokenize('source.hanasql', src);
    const flat = (Array.isArray(toks[0]) ? (toks as unknown as Array<Array<{ text: string; scopes: string[] }>>).flat() : toks) as Array<{ text: string; scopes: string[] }>;
    const t = flat.find((x) => x.text === text);
    return t ? t.scopes.filter((s) => !s.startsWith('source.') && !s.startsWith('meta.')) : [];
  };
  const src = "DO BEGIN EXECUTE IMMEDIATE 'SELECT 1 FROM DUMMY' READS SQL DATA; EXEC :s; END; CREATE PROCEDURE p MODIFIES SQL DATA AS BEGIN END;";
  assert.ok(scopeOf(src, 'EXECUTE IMMEDIATE').includes('keyword.other.clause.hanasql'));
  assert.ok(scopeOf(src, 'READS SQL DATA').includes('keyword.other.clause.hanasql'));
  assert.ok(scopeOf(src, 'MODIFIES SQL DATA').includes('keyword.other.clause.hanasql'));
  assert.ok(scopeOf(src, 'EXEC').length > 0);
  assert.deepEqual(scopeOf('SELECT immediate, data FROM t;', 'immediate'), []);
  assert.deepEqual(scopeOf('SELECT immediate, data FROM t;', 'data'), []);
});
