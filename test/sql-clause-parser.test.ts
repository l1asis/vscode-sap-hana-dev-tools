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

/** Returns `RULE:blamed-text` for every diagnostic. */
function blamed(lang: string, src: string): string[] {
  return syntaxDiags(lang, src).map((d) => `${d.ruleId}:${src.slice(d.start, d.end)}`);
}

const doBlock = (body: string): string => `DO BEGIN\n${body}\nEND;`;

test('HANA-SYN-042: double aliases, adjacent operands and trailing garbage in queries', () => {
  const cases: Array<[string, string]> = [
    ['SELECT * FROM tbl ddddddd eeeeee;', 'HANA-SYN-042:eeeeee'],
    ['SELECT * FROM "com.mycompany.apps::sample_table" ddddddd eeeeee;', 'HANA-SYN-042:eeeeee'],
    ['SELECT a FROM t ORDER BY x y;', 'HANA-SYN-042:y'],
    ['SELECT a FROM (SELECT b FROM u x y) q;', 'HANA-SYN-042:y'],
    ['SELECT a FROM t GROUP BY a b;', 'HANA-SYN-042:b'],
    ['SELECT a FROM t LIMIT 10 20;', 'HANA-SYN-042:20'],
  ];
  for (const [src, expected] of cases) assert.ok(blamed('hanasql', src).includes(expected), `${src}\n${blamed('hanasql', src).join('\n')}`);
  const msg = syntaxDiags('hanasql', 'SELECT * FROM tbl ddddddd eeeeee;')[0].message;
  assert.match(msg, /^Unexpected 'eeeeee' after FROM item; expected ',', 'JOIN'/);
});

test('HANA-SYN-042: statements inside SQLScript blocks and HDI DDL', () => {
  const cases: Array<[string, string, string]> = [
    ['hanasql', doBlock('  DECLARE v INT = 1 junk;'), 'HANA-SYN-042:junk'],
    ['hanasql', doBlock('  DECLARE v INT;\n  v = :v + 1 extra;'), 'HANA-SYN-042:extra'],
    ['hanasql', doBlock('  DECLARE t TABLE (a INT);\n  t = SELECT 1 AS a FROM DUMMY x y;'), 'HANA-SYN-042:y'],
    ['hanasql', doBlock("  DECLARE CURSOR c FOR SELECT a FROM t x y;"), 'HANA-SYN-042:y'],
    ['hdbfunction', 'FUNCTION f() RETURNS TABLE (a INT) AS BEGIN\n  RETURN SELECT 1 AS a FROM DUMMY d e;\nEND', 'HANA-SYN-042:e'],
    ['hdbprocedure', 'PROCEDURE p() AS BEGIN\n  SIGNAL SQL_ERROR_CODE 10001 SET MESSAGE_TEXT = :m zz;\nEND', 'HANA-SYN-042:zz'],
    ['hdbview', 'VIEW "v" AS SELECT a FROM t x y', 'HANA-SYN-042:y'],
    ['hdbsequence', 'SEQUENCE "s" START WITH 1 INCREMENT BY 1 foo', 'HANA-SYN-042:foo'],
  ];
  for (const [lang, src, expected] of cases) {
    // An existing rule (HANA-SYN-023 / 024) may claim the statement first; the blamed token must match.
    const token = expected.slice(expected.indexOf(':') + 1);
    assert.ok(blamed(lang, src).some((b) => b.endsWith(`:${token}`)), `${src}\n${blamed(lang, src).join('\n')}`);
  }
});

test('HANA-SYN-021: misspelled clause keywords with QuickFix', () => {
  const cases: Array<[string, string, string]> = [
    ['SELECT a FROM t WHEREE a = 1;', 'WHEREE', 'WHERE'],
    ['SELECT a, COUNT(*) FROM t GROUPP BY a;', 'GROUPP', 'GROUP'],
    ['SELECT a FROM t ORDER BY a DSC;', 'DSC', 'DESC'],
    ['SELECT a FROM t1 INNER JOIN t2 ON t1.id = t2.id WHERE a = 1 ORDR BY a;', 'ORDR', 'ORDER'],
  ];
  for (const [src, typo, fix] of cases) {
    const d = syntaxDiags('hanasql', src).find((x) => x.ruleId === 'HANA-SYN-021' && src.slice(x.start, x.end) === typo);
    assert.ok(d, `${src}\n${blamed('hanasql', src).join('\n')}`);
    assert.ok(d.message.includes(`'${fix}'`), d.message);
    const fixed = applyTextEdits(src, d.fixes[0].edits);
    assert.deepEqual(syntaxDiags('hanasql', fixed), [], fixed);
  }
  // Mixed-case keywords are valid (SQL keywords are case-insensitive).
  assert.deepEqual(syntaxDiags('hanasql', 'SELECT a FROm t WHERe a = 1;'), []);
});

test('HANA-SYN-042: IF / ELSEIF / WHILE conditions', () => {
  const src = doBlock('  DECLARE v INT = 1;\n  IF :v = 1 bogus THEN\n    v = 2;\n  END IF;\n  WHILE :v < 3 zz DO\n    v = :v + 1;\n  END WHILE;');
  const b = blamed('hanasql', src);
  assert.ok(b.some((x) => x.endsWith(':bogus')), b.join('\n'));
  assert.ok(b.some((x) => x.endsWith(':zz')), b.join('\n'));
});

test('HANA-SYN-042: zero false positives on valid queries and expressions', () => {
  const valid = [
    'SELECT DISTINCT TOP 10 a, b AS "B", c alias_c, t.*, COUNT(*) AS n FROM s.t AS t WHERE a = 1 AND (b > 2 OR c IS NOT NULL) GROUP BY a, b, c HAVING COUNT(*) > 1 ORDER BY a DESC NULLS LAST, 2 LIMIT 10 OFFSET 5;',
    "SELECT CAST(a AS INT), EXTRACT(YEAR FROM d), TRIM(BOTH ' ' FROM s), SUBSTRING(s, 1, 2), STRING_AGG(s, ',' ORDER BY s) FROM t;",
    'SELECT ROW_NUMBER() OVER (PARTITION BY a ORDER BY b) AS rn, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY b) FROM t;',
    "SELECT CASE WHEN a = 1 THEN 'x' WHEN a = 2 THEN 'y' ELSE 'z' END, CASE a WHEN 1 THEN 2 END FROM t;",
    "SELECT * FROM t WHERE a BETWEEN 1 AND 10 AND b NOT IN (1, 2) AND c LIKE 'a%' ESCAPE '\\' AND EXISTS (SELECT 1 FROM u WHERE u.a = t.a) AND e > ANY (SELECT f FROM v) AND g IS DISTINCT FROM h;",
    "SELECT DATE '2024-01-01', TIMESTAMP '2024-01-01 00:00:00', :v, ?, ::ROWCOUNT, -a, +b, a || 'x', a * b / c % d, NEW ST_Point(1, 2).ST_X() FROM t;",
    'SELECT a FROM t1 LEFT OUTER JOIN t2 ON t1.id = t2.id INNER JOIN t3 USING (id) CROSS JOIN t4 LEFT OUTER MANY TO ONE JOIN t5 ON t5.id = t1.id;',
    'WITH c (x) AS (SELECT 1 FROM DUMMY), d AS (SELECT 2 AS y FROM DUMMY) SELECT * FROM c, d;',
    '(SELECT a FROM t) UNION ALL (SELECT a FROM u) ORDER BY a;',
    'SELECT a FROM t UNION SELECT a FROM u INTERSECT SELECT a FROM v EXCEPT SELECT a FROM w MINUS SELECT a FROM x;',
    'SELECT a FROM t FOR UPDATE;',
    'SELECT a FROM t WITH HINT (NO_CS_JOIN);',
    'SELECT * FROM t TABLESAMPLE SYSTEM (10);',
    'SELECT * FROM "V"(5):"ASSOC"(\'EN\'), t2:a[y1 > 1], "MyView"[ID < 6];',
    'SELECT * FROM my_tudf(1, 2) f, :tv AS x, (SELECT 1 AS a FROM DUMMY) s;',
    'SELECT * FROM t3 ORDER BY a COLLATE ENGLISH, b;',
    'SELECT a FROM t GROUP BY GROUPING SETS ((a), (b));',
    'SELECT a FROM t GROUP BY ROLLUP (a, b), CUBE (c);',
    "SELECT a FROM t WHERE c = INTERVAL '5' DAY;",
    'SELECT a whre, b FROM t;',
    'SELECT * FROM t1 t, t2 WHERE t.a = t2.a;',
    "INSERT INTO t (a, b) VALUES (1, 'x'); INSERT INTO t SELECT * FROM u; UPSERT t VALUES (1) WITH PRIMARY KEY; REPLACE t VALUES (1) WHERE a = 1;",
    'UPDATE t x SET a = 1, b = b + 1 WHERE c = 2; DELETE FROM t WHERE a = 1; DELETE t;',
    'CALL p(1, :v, a => 2);',
  ];
  for (const v of valid) assert.deepEqual(syntaxDiags('hanasql', v), [], v);

  const body = [
    '  DECLARE i INT DEFAULT 0;',
    "  DECLARE s NVARCHAR(10) := 'x';",
    '  DECLARE arr INT ARRAY = ARRAY(1, 2, 3);',
    '  DECLARE tv TABLE (a INT) = SELECT 1 AS a FROM DUMMY;',
    '  DECLARE c CONSTANT INT NOT NULL = 5;',
    '  DECLARE CURSOR cur FOR SELECT a FROM t WHERE a = :i;',
    '  DECLARE cond CONDITION FOR SQL_ERROR_CODE 10001;',
    '  i = :i + CARDINALITY(:arr);',
    '  tv = SELECT * FROM :tv WHERE a > :i;',
    '  i = (SELECT COUNT(*) FROM :tv);',
    "  s = SQLSCRIPT_STRING:FORMAT('{}', :i);",
    '  IF :i > 0 AND NOT IS_EMPTY(:tv) THEN',
    '    i = 1;',
    '  ELSEIF :i BETWEEN 1 AND 2 THEN',
    '    i = 2;',
    '  END IF;',
    '  WHILE :i < 10 DO',
    '    i := :i + 1;',
    '  END WHILE;',
    '  SIGNAL cond SET MESSAGE_TEXT = \'boom\';',
  ].join('\n');
  assert.deepEqual(syntaxDiags('hanasql', doBlock(body)), [], JSON.stringify(syntaxDiags('hanasql', doBlock(body))));
});

test('HANA-SYN-042: zero false positives on HDI DDL and long-tail statements', () => {
  const ddl: Array<[string, string]> = [
    ['hdbview', 'VIEW "v" (a, b) COMMENT \'x\' AS SELECT a, b FROM t WITH READ ONLY'],
    ['hdbtable', 'COLUMN TABLE "t" ("A" INTEGER CS_INT NOT NULL PRIMARY KEY, "B" NVARCHAR(10) DEFAULT \'x\' FUZZY SEARCH INDEX ON, "C" INT ARRAY, "D" INT GENERATED BY DEFAULT AS IDENTITY, PRIMARY KEY ("A")) UNLOAD PRIORITY 5'],
    ['hdbsequence', 'SEQUENCE "s" START WITH 1 INCREMENT BY 1 MAXVALUE 100 NO CYCLE RESET BY SELECT MAX("A") + 1 FROM "t"'],
    ['hanasql', 'CREATE OR REPLACE VIEW v AS SELECT 1 AS a FROM DUMMY;'],
    ['hanasql', 'ALTER SYSTEM CLEAR SQL PLAN CACHE;'],
    ['hanasql', 'MERGE INTO t USING s ON t.a = s.a WHEN MATCHED THEN UPDATE SET t.b = s.b;'],
    ['hanasql', 'SELECT * FROM\n##ifdef HANA_CLOUD\ncloudTable\n##else\notherTable\n##endif\n;'],
  ];
  for (const [lang, src] of ddl) assert.deepEqual(syntaxDiags(lang, src), [], `${lang}: ${src}`);
});

test('HANA-SYN-042: no duplicate when an existing rule already reports the statement', () => {
  const src = 'SELECT a b c FROM t;';
  const d = syntaxDiags('hanasql', src);
  assert.equal(d.length, 1, JSON.stringify(d));
});

// ---------------------------------------------------------------------------
// Headerless structured filters and remote table replicas [HDI] [CLOUD] (#109, sql-sqlscript.md §4.11)
// ---------------------------------------------------------------------------
const FILTER_WILDCARD = [
  'STRUCTURED FILTER USER_DATA_VIEW_FILTER_WILDCARD',
  'FOR SELECT ON USER_DATA_VIEW',
  "ESCAPE '\'",
  'LIKE "USER\_Data\_VIEW1%", "USER\_Data\_VIEW2%"',
  'NOT LIKE "USER_Data_VIEW1\%"',
  'WHERE USER_DATA_VIEW.USER_NAME = CURRENT_USER',
].join('\n');

test('structured filter: the documented forms, CREATE STRUCTURED FILTER and a cursor FOR SELECT stay valid', () => {
  const valid: Array<[string, string]> = [
    ['hdbstructuredfilter', 'STRUCTURED FILTER SF_T2_VIEW FOR SELECT ON DYNAMIC_T1_VIEW CONDITION PROVIDER PROC_DYNAMIC_T2_VIEW'],
    ['hdbstructuredfilter', 'STRUCTURED FILTER F FOR SELECT ON V WHERE V.USER_NAME = CURRENT_USER'],
    ['hdbstructuredfilter', 'STRUCTURED FILTER "S"."F" FOR SELECT ON "S"."V", "S"."W" WHERE A = 1 AND B IN (1, 2)'],
    ['hdbstructuredfilter', 'STRUCTURED FILTER F FOR SELECT WHERE A = 1'],
    ['hdbstructuredfilter', 'STRUCTURED FILTER F FOR SELECT LIKE "V%" NOT LIKE "V1%" CONDITION PROVIDER S.P'],
    ['hdbstructuredfilter', FILTER_WILDCARD],
    ['hdbstructuredfilter', 'structured filter f for select on v condition provider p'],
    ['hdbremotetablereplica', 'REMOTE TABLE REPLICA "TARGET_TABLE" ON "VIRTUAL_TABLE"'],
    ['hanasql', 'CREATE STRUCTURED FILTER F FOR SELECT ON V CONDITION PROVIDER P;'],
    ['hanasql', 'ALTER STRUCTURED FILTER F FOR SELECT ON V, W CONDITION PROVIDER P;'],
  ];
  for (const [lang, src] of valid) assert.deepEqual(blamed(lang, src), [], src);
  // The header skip is limited to STRUCTURED FILTER: a cursor query is still a SELECT list.
  assert.ok(blamed('hanasql', doBlock('  DECLARE CURSOR c FOR SELECT a b c FROM t;')).includes('HANA-SYN-023:c'));
});

test('structured filter: missing clauses and misplaced wildcard lists are reported with exact spans', () => {
  const cases: Array<[string, string]> = [
    ['STRUCTURED FILTER F ON V WHERE A = 1', "HANA-SYN-025:F|Incomplete structured filter: missing 'FOR SELECT' after 'F'."],
    ['STRUCTURED FILTER F WHERE A = 1', 'HANA-SYN-025:F'],
    ['STRUCTURED FILTER F', 'HANA-SYN-025:F'],
    ['STRUCTURED FILTER F FOR ON V WHERE A = 1', "HANA-SYN-025:FOR|Incomplete structured filter: missing 'SELECT' after 'FOR'."],
    [
      'STRUCTURED FILTER F FOR SELECT ON V',
      "HANA-SYN-025:V|Incomplete structured filter: missing 'WHERE <condition>' or 'CONDITION PROVIDER <procedure>' after 'V'.",
    ],
    ['STRUCTURED FILTER F FOR SELECT ON V, W', 'HANA-SYN-025:W'],
    ['STRUCTURED FILTER F FOR SELECT ON', 'HANA-SYN-025:ON'],
    ['STRUCTURED FILTER F FOR SELECT ON V WHERE', 'HANA-SYN-025:WHERE'],
    ['STRUCTURED FILTER F FOR SELECT ON V CONDITION PROVIDER', 'HANA-SYN-025:PROVIDER'],
    ["STRUCTURED FILTER F FOR SELECT ESCAPE '\' WHERE A = 1", "HANA-SYN-025:'\'"],
    ['STRUCTURED FILTER F FOR SELECT ON V NOT LIKE "V%" WHERE A = 1', "HANA-SYN-042:NOT LIKE|'NOT LIKE' requires a preceding 'LIKE' list in a structured filter."],
    ['STRUCTURED FILTER F FOR SELECT NOT  LIKE "V%" WHERE A = 1', 'HANA-SYN-042:NOT  LIKE'],
    ["STRUCTURED FILTER F FOR SELECT LIKE 'V%' WHERE A = 1", "HANA-SYN-042:'V%'"],
    ['STRUCTURED FILTER F FOR SELECT LIKE "S"."V%" WHERE A = 1', 'HANA-SYN-042:.'],
    ['STRUCTURED FILTER F FOR SELECT ON V CONDITION P', 'HANA-SYN-042:P'],
    ['STRUCTURED FILTER F FOR SELCT ON V WHERE A = 1', 'HANA-SYN-021:SELCT'],
    ['STRUCTURED FILTER F FOR SELECT ON V WHER A = 1', 'HANA-SYN-021:WHER'],
  ];
  for (const [src, expected] of cases) {
    const [want, message] = expected.split('|');
    const diags = syntaxDiags('hdbstructuredfilter', src);
    assert.deepEqual(diags.map((d) => `${d.ruleId}:${src.slice(d.start, d.end)}`), [want], src);
    if (message) assert.equal(diags[0].message, message, src);
  }
  const typo = syntaxDiags('hdbstructuredfilter', 'STRUCTURED FILTER F FOR SELCT ON V WHERE A = 1')[0];
  assert.equal(applyTextEdits('STRUCTURED FILTER F FOR SELCT ON V WHERE A = 1', typo.fixes[0].edits), 'STRUCTURED FILTER F FOR SELECT ON V WHERE A = 1');
  assert.deepEqual(blamed('hanasql', 'CREATE STRUCTURED FILTER F FOR SELECT ON V;'), ['HANA-SYN-025:V']);
});

test('remote table replica: a missing target, ON clause or virtual table is reported', () => {
  const cases: Array<[string, string]> = [
    ['REMOTE TABLE REPLICA "TARGET_TABLE"', `HANA-SYN-025:"TARGET_TABLE"|Incomplete remote table replica: missing 'ON <virtual_table>' after '"TARGET_TABLE"'.`],
    ['REMOTE TABLE REPLICA ON "V"', 'HANA-SYN-025:REPLICA'],
    ['REMOTE TABLE REPLICA "T" ON', 'HANA-SYN-025:ON'],
    ['REMOTE TABLE REPLICA "T" "V"', `HANA-SYN-042:"V"|Unexpected '"V"' after remote table replica target; expected 'ON'.`],
    ['REMOTE TABLE REPLICA "T" ON "V" X', 'HANA-SYN-042:X'],
  ];
  for (const [src, expected] of cases) {
    const [want, message] = expected.split('|');
    const diags = syntaxDiags('hdbremotetablereplica', src);
    assert.deepEqual(diags.map((d) => `${d.ruleId}:${src.slice(d.start, d.end)}`), [want], src);
    if (message) assert.equal(diags[0].message, message, src);
  }
});
