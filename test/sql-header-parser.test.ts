import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyzer/dispatch';
import { applyTextEdits, DEFAULT_ANALYZER_OPTIONS, type AnalyzerDiagnostic } from '../src/analyzer/types';

function syntaxDiags(languageId: string, text: string): AnalyzerDiagnostic[] {
  return analyzeDocument({
    languageId,
    text,
    options: { ...DEFAULT_ANALYZER_OPTIONS, security: false, performance: false, migration: false, calculationView: false, syntax: true },
  });
}

/** Header-parser diagnostics only (`HANA-SYN-040` structure + `HANA-SYN-021` typos). */
function headerDiags(languageId: string, text: string): AnalyzerDiagnostic[] {
  return syntaxDiags(languageId, text).filter((d) => d.ruleId === 'HANA-SYN-040' || d.ruleId === 'HANA-SYN-021');
}

function spans(src: string, diags: readonly AnalyzerDiagnostic[]): string[] {
  return diags.map((d) => `${d.ruleId}:${src.slice(d.start, d.end)}`);
}

test('HANA-SYN-040: valid routine, library, trigger and DO headers are fully consumed', () => {
  const valid: Array<[string, string]> = [
    ['hdbprocedure', 'PROCEDURE "p"(IN a INT, OUT b TABLE(x INT)) LANGUAGE SQLSCRIPT SQL SECURITY INVOKER DEFAULT SCHEMA "S" READS SQL DATA AS BEGIN b = SELECT 1 AS x FROM DUMMY; END'],
    ['hanasql', 'CREATE OR REPLACE PROCEDURE s.p() LANGUAGE SQLSCRIPT SQL SECURITY DEFINER AUTOCOMMIT DDL ON WITH ENCRYPTION AS BEGIN SELECT 1 FROM DUMMY; END;'],
    ['hanasql', 'CREATE PROCEDURE p(OUT o TABLE(a INT)) READS SQL DATA WITH RESULT VIEW pv AS BEGIN o = SELECT 1 AS a FROM DUMMY; END;'],
    ['hanasql', 'CREATE PROCEDURE p(IN a INT) VARIABLE CACHE ON a ENABLE, (b, c) DISABLE DETERMINISTIC AS BEGIN SELECT :a FROM DUMMY; END;'],
    ['hdbprocedure', 'PROCEDURE "p"() AS USING SYS.SQLSCRIPT_STRING AS LIB; BEGIN SELECT 1 FROM DUMMY; END'],
    ['hdbprocedure', 'PROCEDURE "P"() LANGUAGE SQLSCRIPT AS HEADER ONLY;'],
    ['hdbfunction', 'FUNCTION "f"(IN x INT) RETURNS TABLE (a INT) LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS BEGIN RETURN SELECT :x AS a FROM DUMMY; END'],
    ['hdbfunction', 'FUNCTION f(IN x INT) RETURNS r INT, s NVARCHAR(10) ARRAY DETERMINISTIC NO STRUCTURED FILTER CHECK AS BEGIN r = :x; END'],
    ['hdbfunction', 'FUNCTION f() RETURNS DECIMAL(10, 2) AS BEGIN END'],
    ['hanasql', 'CREATE FUNCTION f() RETURNS TABLE (i INT) AS HEADER ONLY ON INVALID BEGIN RETURN SELECT 1 AS i FROM DUMMY; END;'],
    ['hanasql', 'ALTER FUNCTION f STRUCTURED FILTER CHECK;\nALTER PROCEDURE p RECOMPILE;\nALTER PROCEDURE p ENCRYPTION ON;\nALTER PROCEDURE p ADD VARIABLE CACHE ON a ENABLE;'],
    ['hdblibrary', 'LIBRARY "L" LANGUAGE SQLSCRIPT TEST DEFAULT SCHEMA "S" AS BEGIN\n  PUBLIC PROCEDURE p() SQL SECURITY INVOKER AS BEGIN END;\n  PRIVATE FUNCTION f() RETURNS r INT AS BEGIN r = 1; END;\nEND'],
    ['hdbtrigger', 'TRIGGER "T" AFTER INSERT OR UPDATE OF a, b OR DELETE ON "TAB" REFERENCING NEW ROW AS n, OLD ROW o FOR EACH ROW FOLLOWS "T0" ONLINE BEGIN END'],
    ['hdbtrigger', 'TRIGGER "T" INSTEAD OF UPDATE EXCEPT OF c ON "V" REFERENCING NEW TABLE nt FOR EACH STATEMENT BEGIN END'],
    ['hanasql', 'DO (IN p INT => 5) BEGIN SELECT :p FROM DUMMY; END;'],
    ['hdbvirtualfunction', 'VIRTUAL FUNCTION "f"() RETURNS TABLE (A INT) CONFIGURATION \'x\' AT "REMOTE_A"'],
    ['hanasql', 'CREATE VIRTUAL FUNCTION s.vf AT "HANA1"."DB1"."S2"."TUDF1";'],
  ];
  for (const [lang, src] of valid) assert.deepEqual(syntaxDiags(lang, src), [], `${lang}: ${src}`);
});

test('issue #26 reproduction: stray punctuation and ASd in a corrupted FUNCTION header', () => {
  const src = [
    'FUNCTION "com.mycompany.apps::get_total_price" (IN im_tax_rate DECIMAL(3, 2))',
    'RETURNS TABLE (ITEM_NAME NVARCHAR(100))',
    'LANGUAGE SQLSCRIPT',
    'SQL SECURITY INVOKER,,,,.//asd/.AWlpqwkr',
    'ASd',
    'BEGIN',
    '    RETURN SELECT NAME AS ITEM_NAME FROM "T";',
    'END;',
  ].join('\n');
  const diags = syntaxDiags('hdbfunction', src);
  const s = spans(src, diags);
  assert.ok(s.includes('HANA-SYN-040:,'), s.join('\n'));
  const asd = diags.find((d) => d.ruleId === 'HANA-SYN-021' && src.slice(d.start, d.end) === 'ASd');
  assert.ok(asd, s.join('\n'));
  assert.match(asd.message, /Did you mean 'AS'\?/);
  assert.ok(applyTextEdits(src, asd.fixes[0].edits).includes('\nAS\nBEGIN'));
  // `ASd` is recovered as `AS`: no "missing AS" cascade.
  assert.ok(!diags.some((d) => /Missing 'AS'/.test(d.message)), s.join('\n'));
});

test('HANA-SYN-040: unconsumed words, operators and punctuation in headers', () => {
  const word = 'PROCEDURE "p"() LANGUAGE SQLSCRIPT AWlpqwkr AS BEGIN END';
  const w = headerDiags('hdbprocedure', word);
  assert.deepEqual(spans(word, w), ['HANA-SYN-040:AWlpqwkr']);
  assert.match(w[0].message, /Unexpected 'AWlpqwkr' in PROCEDURE header; expected .*'AS'/);

  // One diagnostic per contiguous junk run.
  const run = 'PROCEDURE "p"() SQL SECURITY INVOKER foo + bar AS BEGIN END';
  assert.deepEqual(spans(run, headerDiags('hdbprocedure', run)), ['HANA-SYN-040:foo']);

  const afterAs = 'PROCEDURE "p"() AS junk BEGIN END';
  assert.deepEqual(spans(afterAs, headerDiags('hdbprocedure', afterAs)), ['HANA-SYN-040:junk']);

  const badSec = 'PROCEDURE "p"() SQL SECURITY NOBODY AS BEGIN END';
  const sec = headerDiags('hdbprocedure', badSec);
  assert.equal(sec.length, 1);
  assert.match(sec[0].message, /Expected 'DEFINER' or 'INVOKER' after 'SECURITY'/);

  const badAuto = headerDiags('hdbprocedure', 'PROCEDURE "p"() AUTOCOMMIT DDL MAYBE AS BEGIN END');
  assert.ok(badAuto.some((d) => /Expected 'ON' or 'OFF' after 'AUTOCOMMIT DDL'/.test(d.message)), JSON.stringify(badAuto));

  const libJunk = 'LIBRARY "L" LANGUAGE SQLSCRIPT READS SQL DATA AS BEGIN END';
  assert.ok(headerDiags('hdblibrary', libJunk).some((d) => /Unexpected 'READS' in LIBRARY header/.test(d.message)));

  // Unsupported clauses that are not in the SAP HANA references.
  assert.ok(headerDiags('hdbprocedure', 'PROCEDURE "p"() MODIFIES SQL DATA AS BEGIN END').length >= 1);
});

test('HANA-SYN-040: mandatory AS before BEGIN / HEADER ONLY', () => {
  const src = 'PROCEDURE "p"() LANGUAGE SQLSCRIPT SQL SECURITY INVOKER\nBEGIN\n  SELECT 1 FROM DUMMY;\nEND';
  const d = headerDiags('hdbprocedure', src);
  assert.equal(d.length, 1);
  assert.match(d[0].message, /Missing 'AS' before 'BEGIN' in PROCEDURE header/);
  const fixed = applyTextEdits(src, d[0].fixes[0].edits);
  assert.ok(fixed.includes('INVOKER\nAS BEGIN'));
  assert.deepEqual(syntaxDiags('hdbprocedure', fixed), []);

  assert.ok(headerDiags('hdbfunction', 'FUNCTION f() RETURNS r INT BEGIN r = 1; END').some((x) => /Missing 'AS'/.test(x.message)));
  assert.ok(headerDiags('hdblibrary', 'LIBRARY "L" BEGIN END').some((x) => /Missing 'AS'/.test(x.message)));
  assert.ok(headerDiags('hdbprocedure', 'PROCEDURE "p"() HEADER ONLY;').some((x) => /'HEADER ONLY' must follow 'AS'/.test(x.message)));
  assert.ok(headerDiags('hanasql', 'CREATE PROCEDURE p() LANGUAGE SQLSCRIPT;').some((x) => /Incomplete PROCEDURE header/.test(x.message)));

  // Negative: triggers and DO blocks take no AS.
  assert.deepEqual(syntaxDiags('hdbtrigger', 'TRIGGER "T" AFTER INSERT ON "TAB" FOR EACH ROW BEGIN END'), []);
  assert.deepEqual(syntaxDiags('hanasql', 'DO BEGIN SELECT 1 FROM DUMMY; END;'), []);
});

test('HANA-SYN-021: slot-aware header typos with QuickFix and recovery', () => {
  const cases: Array<[string, string, string, string]> = [
    ['hdbprocedure', 'PROCEDURE "p"() LANUAGE SQLSCRIPT AS BEGIN END', 'LANUAGE', 'LANGUAGE'],
    ['hdbprocedure', 'PROCEDURE "p"() SQL SECURTY INVOKER AS BEGIN END', 'SECURTY', 'SECURITY'],
    ['hdbprocedure', 'PROCEDURE "p"() SQL SECURITY INVOKR AS BEGIN END', 'INVOKR', 'INVOKER'],
    ['hdbprocedure', 'PROCEDURE "p"() LANGUAGE SQLSCRPT AS BEGIN END', 'SQLSCRPT', 'SQLSCRIPT'],
    ['hdbprocedure', 'PROCEDURE "p"() DETERMINSTIC AS BEGIN END', 'DETERMINSTIC', 'DETERMINISTIC'],
    ['hdbprocedure', 'PROCEDURE "p"() ASS BEGIN END', 'ASS', 'AS'],
    ['hdbfunction', 'FUNCTION f() RETUNS r INT AS BEGIN r = 1; END', 'RETUNS', 'RETURNS'],
    ['hdbfunction', 'FUNCTION f() RETURN TABLE (a INT) AS BEGIN RETURN SELECT 1 AS a FROM DUMMY; END', 'RETURN', 'RETURNS'],
    ['hdbtrigger', 'TRIGGER "T" AFTR INSERT ON "TAB" BEGIN END', 'AFTR', 'AFTER'],
    ['hdbtrigger', 'TRIGGER "T" AFTER INSERT OM "TAB" BEGIN END', 'OM', 'ON'],
    ['hdbtrigger', 'TRIGGER "T" AFTER INSERT ON "TAB" FOR EAHC ROW BEGIN END', 'EAHC', 'EACH'],
  ];
  for (const [lang, src, typo, fix] of cases) {
    const d = syntaxDiags(lang, src);
    const hit = d.find((x) => x.ruleId === 'HANA-SYN-021' && src.slice(x.start, x.end) === typo);
    assert.ok(hit, `${src}\n${JSON.stringify(d)}`);
    assert.ok(hit.message.includes(`'${fix}'`), hit.message);
    const fixed = applyTextEdits(src, hit.fixes[0].edits);
    assert.deepEqual(syntaxDiags(lang, fixed), [], fixed);
    // Recovery: the typo is the only header diagnostic.
    assert.equal(d.filter((x) => x.ruleId === 'HANA-SYN-040' || x.ruleId === 'HANA-SYN-021').length, 1, `${src}\n${JSON.stringify(d)}`);
  }
});

test('HANA-SYN-040: trigger header structure', () => {
  const noOn = headerDiags('hdbtrigger', 'TRIGGER "T" AFTER INSERT FROM "TAB" BEGIN END');
  assert.ok(noOn.some((d) => /Expected 'ON' in TRIGGER header/.test(d.message)), JSON.stringify(noOn));
  const noTime = headerDiags('hdbtrigger', 'TRIGGER "T" INSERT ON "TAB" BEGIN END');
  assert.ok(noTime.some((d) => /action time/.test(d.message)), JSON.stringify(noTime));
  const badOrder = headerDiags('hdbtrigger', 'TRIGGER "T" AFTER INSERT ON "TAB" FOR EACH ROW REFERENCING NEW ROW n BEGIN END');
  assert.ok(badOrder.some((d) => /must follow the order/.test(d.message)), JSON.stringify(badOrder));
});

test('HANA-SYN-040: header parser stays quiet when a bracket error already desynchronizes it', () => {
  const src = 'FUNCTION "f" (IN a DECIMAL(3, 2) RETURNS TABLE ("A" NVARCHAR(100) LANGUAGE SQLSCRIPT AS BEGIN RETURN SELECT 1 AS "A" FROM DUMMY; END';
  const d = syntaxDiags('hdbfunction', src);
  assert.ok(d.some((x) => x.ruleId === 'HANA-SYN-003'), JSON.stringify(d));
  assert.ok(!d.some((x) => x.ruleId === 'HANA-SYN-040'), JSON.stringify(d));
});
