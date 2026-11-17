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

const proc = (body: string): string => `PROCEDURE "p"(IN x INT) AS BEGIN\n${body}\nEND`;

function starterDiags(languageId: string, text: string): AnalyzerDiagnostic[] {
  return syntaxDiags(languageId, text).filter((d) => d.ruleId === 'HANA-SYN-041' || d.ruleId === 'HANA-SYN-021');
}

function blamed(src: string, diags: readonly AnalyzerDiagnostic[]): string[] {
  return diags.map((d) => src.slice(d.start, d.end));
}

test('HANA-SYN-041: bogus statements inside SQLScript blocks', () => {
  const cases: Array<[string, string]> = [
    ['  foobar;', 'foobar'],
    ['  ASd;', 'ASd'],
    ["  'Active';", "'Active'"],
    ['  123;', '123'],
    ['  + 1;', '+'],
    ['  SELECT 1 FROM DUMMY;\n  junk junk;', 'junk'],
    ['  IF :x > 1 THEN\n    bogus;\n  END IF;', 'bogus'],
    ['  IF :x > 1 THEN\n    SELECT 1 FROM DUMMY;\n  ELSEIF :x > 0 THEN\n    nope;\n  ELSE\n    huh;\n  END IF;', 'nope'],
    ['  WHILE :x > 0 DO\n    bad;\n  END WHILE;', 'bad'],
    ['  FOR i IN 1..3 DO\n    bad;\n  END FOR;', 'bad'],
    ['  LOOP\n    bad;\n    BREAK;\n  END LOOP;', 'bad'],
    ['  BEGIN\n    bad;\n  END;', 'bad'],
    ['  DECLARE EXIT HANDLER FOR SQLEXCEPTION bad;\n  SELECT 1 FROM DUMMY;', 'bad'],
  ];
  for (const [body, token] of cases) {
    const src = proc(body);
    const d = syntaxDiags('hdbprocedure', src).filter((x) => x.ruleId === 'HANA-SYN-041');
    assert.ok(blamed(src, d).includes(token), `${body}\n${JSON.stringify(syntaxDiags('hdbprocedure', src))}`);
  }
  const msg = starterDiags('hdbprocedure', proc('  foobar;'))[0].message;
  assert.match(msg, /Invalid statement start: unexpected identifier 'foobar'; expected a SQL or SQLScript statement, or an assignment/);
});

test('HANA-SYN-021: misspelled statement verbs with scope-aware QuickFix', () => {
  const cases: Array<[string, string, string, string]> = [
    ['hdbprocedure', proc('  DECLRE v INT;\n  v = 1;'), 'DECLRE', 'DECLARE'],
    ['hdbprocedure', proc('  SELECTT * FROM "T";'), 'SELECTT', 'SELECT'],
    ['hdbprocedure', proc('  UPSRT "T" VALUES (1) WITH PRIMARY KEY;'), 'UPSRT', 'UPSERT'],
    ['hanasql', 'INSRT INTO "T" VALUES (1);', 'INSRT', 'INSERT'],
    ['hdblibrary', 'LIBRARY "L" AS BEGIN\n  PUBLC PROCEDURE p() AS BEGIN END;\nEND', 'PUBLC', 'PUBLIC'],
  ];
  for (const [lang, src, typo, fix] of cases) {
    const d = syntaxDiags(lang, src).find((x) => x.ruleId === 'HANA-SYN-021' && src.slice(x.start, x.end) === typo);
    assert.ok(d, `${src}\n${JSON.stringify(syntaxDiags(lang, src))}`);
    assert.ok(d.message.includes(`'${fix}'`), d.message);
    const fixed = applyTextEdits(src, d.fixes[0].edits);
    assert.deepEqual(starterDiags(lang, fixed), [], fixed);
  }
  // A typo-looking name that forms a valid assignment is an assignment.
  assert.deepEqual(starterDiags('hdbprocedure', proc('  DECLARE retrun INT;\n  retrun = 5;')), []);
});

test('HANA-SYN-041: top-level SQL scripts', () => {
  const bad = "SELECT 1 FROM DUMMY;\nfoobar;\n'lit';\n42;";
  assert.deepEqual(blamed(bad, starterDiags('hanasql', bad)), ['foobar', "'lit'", '42']);
  assert.match(starterDiags('hanasql', 'foobar;')[0].message, /expected a SQL statement\./);

  // Top-level assignments are only valid inside routines.
  assert.deepEqual(blamed('x = 1;', starterDiags('hanasql', 'x = 1;')), ['x']);

  const valid = [
    'SELECT 1 FROM DUMMY;',
    '(SELECT 1 FROM DUMMY) UNION (SELECT 2 FROM DUMMY);',
    'WITH c AS (SELECT 1 AS a FROM DUMMY) SELECT * FROM c;',
    "INSERT INTO t VALUES (1); UPDATE t SET a = 2; UPSERT t VALUES (3) WITH PRIMARY KEY; DELETE FROM t; MERGE INTO t USING s ON t.a = s.a WHEN MATCHED THEN UPDATE SET t.a = s.a;",
    'CREATE COLUMN TABLE t (a INT); ALTER TABLE t ADD (b INT); RENAME TABLE t TO u; TRUNCATE TABLE u; DROP TABLE u;',
    "GRANT SELECT ON t TO u; REVOKE SELECT ON t FROM u; COMMIT; ROLLBACK; SET SCHEMA s; LOCK TABLE t IN EXCLUSIVE MODE; COMMENT ON TABLE t IS 'x';",
    'CALL p(1); EXPLAIN PLAN FOR SELECT 1 FROM DUMMY; DO BEGIN SELECT 1 FROM DUMMY; END;',
  ];
  for (const v of valid) assert.deepEqual(starterDiags('hanasql', v), [], v);

  // Headerless HDI roots are validated by HANA-SYN-004 instead; .hdbmigrationtable accepts COLUMN / ROW.
  assert.deepEqual(syntaxDiags('hdbmigrationtable', '== version=1\nCOLUMN TABLE "T" ("ID" INTEGER)\n'), []);
});

test('HANA-SYN-041: valid imperative statements, assignments, labels and pragmas', () => {
  const body = [
    '  DECLARE i INT = 0;',
    '  DECLARE arr INT ARRAY;',
    '  DECLARE tv TABLE (a INT, b INT);',
    '  DECLARE a INT; DECLARE b INT;',
    '  DECLARE CURSOR c1 FOR SELECT 1 AS a FROM DUMMY;',
    '  DECLARE CONTINUE HANDLER FOR SQL_ERROR_CODE 301, SQLEXCEPTION BEGIN SELECT ::SQL_ERROR_CODE FROM DUMMY; END;',
    '  i = 1;',
    '  i := :i + 1;',
    '  arr[1] = 5;',
    '  arr[:i + 1] = 6;',
    '  tv.a[1] = 7;',
    '  :tv.INSERT((1, 2));',
    '  tv.DELETE(1);',
    '  (a, b) = SUDF_EXPR(:i);',
    '  "Quoted" = 1;',
    '  tv = SELECT * FROM :tv WHERE a = CASE WHEN :i > 0 THEN 1 ELSE 0 END;',
    '  IF CASE WHEN :i > 0 THEN 1 ELSE 0 END = 1 THEN',
    '    i = CASE :i WHEN 1 THEN 10 ELSE 20 END;',
    '  END IF;',
    '  CASE :i',
    '    WHEN 1 THEN SELECT 1 FROM DUMMY;',
    '    WHEN 2 THEN i = 3;',
    '    ELSE i = 4;',
    '  END CASE;',
    '  lbl: FOR j IN 1..3 DO',
    '    CONTINUE;',
    '  END FOR;',
    '  FOR r AS c1 DO',
    '    i = r.a;',
    '  END FOR;',
    '  outer:WHILE :i < 10 DO',
    '    i = :i + 1;',
    '  END WHILE;',
    '  #[INLINE]',
    '  tv = SELECT 1 AS a, 2 AS b FROM DUMMY;',
    "  @AnalyzerSuppress('SAP.UNUSED_VARIABLE_VALUE.CONSISTENCY')",
    '  i = 2;',
    '  OPEN c1; FETCH c1 INTO i; CLOSE c1;',
    "  EXEC 'SELECT 1 FROM DUMMY';",
    "  EXECUTE IMMEDIATE 'SELECT 1 FROM DUMMY';",
    '  SIGNAL SQL_ERROR_CODE 10001;',
  ].join('\n');
  assert.deepEqual(starterDiags('hdbprocedure', proc(body)), [], JSON.stringify(syntaxDiags('hdbprocedure', proc(body))));

  const lib = [
    'DO BEGIN',
    '  USING SQLSCRIPT_PRINT AS LIB;',
    "  LIB:PRINT_LINE('HELLO WORLD');",
    'END;',
  ].join('\n');
  assert.deepEqual(starterDiags('hanasql', lib), []);
});

test('HANA-SYN-041: blocks nested inside statements and trigger / library bodies', () => {
  const sqlFunction = [
    'SELECT SUM(a) FROM SQL FUNCTION RETURNS TABLE (a INT)',
    'BEGIN',
    '  DECLARE t TABLE (a INT);',
    '  :t.INSERT((1));',
    '  RETURN :t;',
    'END;',
    'SELECT 1 FROM DUMMY;',
  ].join('\n');
  assert.deepEqual(starterDiags('hanasql', sqlFunction), []);

  const trigger = 'TRIGGER "T" AFTER UPDATE ON "TAB" REFERENCING NEW ROW n FOR EACH ROW BEGIN\n  INSERT INTO "LOG" VALUES (:n.a);\n  bogus;\nEND';
  assert.deepEqual(blamed(trigger, starterDiags('hdbtrigger', trigger)), ['bogus']);

  const library = 'LIBRARY "L" AS BEGIN\n  PUBLIC PROCEDURE p() AS BEGIN\n    bogus;\n  END;\nEND';
  assert.deepEqual(blamed(library, starterDiags('hdblibrary', library)), ['bogus']);
});

test('HANA-SYN-041: skipped when block or delimiter structure is already broken', () => {
  const src = proc('  IF :x > 1 THEN\n    bogus;\n  END;');
  const d = syntaxDiags('hdbprocedure', src);
  assert.ok(d.some((x) => x.ruleId === 'HANA-SYN-020'), JSON.stringify(d));
  assert.ok(!d.some((x) => x.ruleId === 'HANA-SYN-041'), JSON.stringify(d));
});
