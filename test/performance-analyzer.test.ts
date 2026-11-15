import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyzer/dispatch';
import { applyTextEdits } from '../src/analyzer/types';

test('HANA-PERF-001 / 002: CE_* operators, mixed SQL, Cloud escalation, and SQL QuickFix', () => {
  const ceProc = `CREATE PROCEDURE "CE_REPORT" (OUT et_res TABLE(ID INT, TOTAL DECIMAL(10, 2)))
  LANGUAGE SQLSCRIPT SQL SECURITY INVOKER READS SQL DATA AS
BEGIN
  lt_active = CE_COLUMN_TABLE("USERS", ["ID", "NAME", "STATUS"]);
  lt_proj = CE_PROJECTION(:lt_active, ["ID", CE_CALC('"PRICE" * "QTY"', DECIMAL(10, 2)) AS "TOTAL"], '"STATUS" = ''A''');
  lt_joined = CE_LEFT_OUTER_JOIN(:lt_proj, :lt_active, ["ID"], ["ID", "NAME", "TOTAL"]);
  lt_union = CE_UNION_ALL(:lt_joined, :lt_joined);
  et_res = SELECT "ID", "TOTAL" FROM :lt_union;
END;`;

  const diags = analyzeDocument({ text: ceProc, languageId: 'hdbprocedure' });
  const perf001 = diags.filter((d) => d.ruleId === 'HANA-PERF-001');
  const perf002 = diags.find((d) => d.ruleId === 'HANA-PERF-002');
  assert.equal(perf001.length, 4);
  assert.ok(perf001.every((d) => d.severity === 'warning'));
  assert.ok(perf002, 'Expected HANA-PERF-002 when mixing CE_* with plain SELECT');

  // Target platform = cloud upgrades HANA-PERF-001 to error
  const cloudDiags = analyzeDocument({
    text: ceProc,
    languageId: 'hdbprocedure',
    options: { targetPlatform: 'cloud' },
  });
  assert.ok(cloudDiags.some((d) => d.ruleId === 'HANA-PERF-001' && d.severity === 'error'));

  // Batch QuickFix converts all 4 supported CE_* statements into clean SQL
  const batchFix = perf002.fixes[0];
  assert.ok(batchFix);
  const convertedSql = applyTextEdits(ceProc, batchFix.edits);
  assert.match(convertedSql, /lt_active = SELECT "ID", "NAME", "STATUS" FROM "USERS";/);
  assert.match(
    convertedSql,
    /lt_proj = SELECT "ID", "PRICE" \* "QTY" AS "TOTAL" FROM :lt_active WHERE "STATUS" = 'A';/
  );
  assert.match(
    convertedSql,
    /lt_joined = SELECT "ID", "NAME", "TOTAL" FROM :lt_proj AS L LEFT OUTER JOIN :lt_active AS R ON L\."ID" = R\."ID";/
  );
  assert.match(convertedSql, /lt_union = SELECT \* FROM :lt_joined UNION ALL SELECT \* FROM :lt_joined;/);
  assert.equal(
    analyzeDocument({ text: convertedSql, languageId: 'hdbprocedure' }).some((d) => d.ruleId === 'HANA-PERF-001'),
    false
  );
});

test('HANA-PERF-003 .. 007: cursor loops, SELECT *, DML in loop, DDL/HINT, CARDINALITY/TRACE', () => {
  const perfProc = `CREATE PROCEDURE "PERF_PROBLEMS" ()
  LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS
BEGIN
  DECLARE CURSOR c_ord FOR SELECT * FROM "ORDERS";
  FOR r AS c_ord DO
    UPDATE "ORDERS" SET STATUS = 'DONE' WHERE ID = r.ID;
  END FOR;
  DROP TABLE "TEMP_STAGE";
  lv_cnt = CARDINALITY(:lt_items);
  lt_dbg = TRACE(:lt_items);
  lt_filtered = SELECT "ID" FROM "ORDERS" WITH HINT(NO_INLINE);
END;`;

  const diags = analyzeDocument({ text: perfProc, languageId: 'hdbprocedure' });
  const ids = new Set(diags.map((d) => d.ruleId));
  for (const expected of ['HANA-PERF-003', 'HANA-PERF-004', 'HANA-PERF-005', 'HANA-PERF-006', 'HANA-PERF-007', 'HANA-LINT-002']) {
    assert.ok(ids.has(expected), `Expected ${expected}`);
  }

  // CARDINALITY -> RECORD_COUNT QuickFix
  const cardDiag = diags.find((d) => d.ruleId === 'HANA-PERF-007' && d.fixes[0]?.title.includes('RECORD_COUNT'));
  assert.ok(cardDiag);
  assert.match(applyTextEdits(perfProc, cardDiag.fixes[0].edits), /lv_cnt = RECORD_COUNT\(:lt_items\);/);

  // TRACE -> SELECT * FROM :lt_items QuickFix
  const traceDiag = diags.find((d) => d.ruleId === 'HANA-PERF-007' && d.fixes[0]?.title.includes('TRACE'));
  assert.ok(traceDiag);
  assert.match(applyTextEdits(perfProc, traceDiag.fixes[0].edits), /lt_dbg = SELECT \* FROM :lt_items;/);

  // Negative check: EXISTS (SELECT * ...) should NOT trigger HANA-PERF-004
  const cleanExists = `CREATE PROCEDURE "CLEAN_EXISTS" ()
  LANGUAGE SQLSCRIPT SQL SECURITY INVOKER READS SQL DATA AS
BEGIN
  SELECT "ID" FROM "ORDERS" o WHERE EXISTS (SELECT * FROM "ITEMS" i WHERE i."OID" = o."ID");
END;`;
  assert.equal(
    analyzeDocument({ text: cleanExists, languageId: 'hdbprocedure' }).some((d) => d.ruleId === 'HANA-PERF-004'),
    false
  );
});

test('HANA-LINT-001 / 002: swallowed EXIT HANDLER QuickFix and unreliable ::ROWCOUNT', () => {
  const badHandlerProc = `CREATE PROCEDURE "SWALLOW_ERR" ()
  LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    INSERT INTO "ERR_LOG" VALUES (::SQL_ERROR_CODE, ::SQL_ERROR_MESSAGE);
  END;
  SELECT "ID" FROM "ORDERS";
  lv_rc = ::ROWCOUNT;
END;`;

  const diags = analyzeDocument({ text: badHandlerProc, languageId: 'hdbprocedure' });
  const lint001 = diags.find((d) => d.ruleId === 'HANA-LINT-001');
  const lint002 = diags.find((d) => d.ruleId === 'HANA-LINT-002');
  assert.ok(lint001);
  assert.ok(lint002);

  const fixedHandler = applyTextEdits(badHandlerProc, lint001.fixes[0].edits);
  assert.match(fixedHandler, /RESIGNAL;/);
  assert.equal(
    analyzeDocument({ text: fixedHandler, languageId: 'hdbprocedure' }).some((d) => d.ruleId === 'HANA-LINT-001'),
    false
  );
});

test('Suppressions: @AnalyzerSuppress and hanasql-analyze-disable honor comment pragmas', () => {
  const suppressedProc = `CREATE PROCEDURE "SUPPRESSED" ()
  LANGUAGE SQLSCRIPT SQL SECURITY INVOKER READS SQL DATA AS
BEGIN
  -- @AnalyzerSuppress('SAP.USE_OF_CE_FUNCTIONS.PERFORMANCE')
  lt_a = CE_COLUMN_TABLE("USERS", ["ID"]);
  -- hanasql-analyze-disable HANA-PERF-004
  SELECT * FROM :lt_a;
  SELECT * FROM "UNSUPPRESSED_TABLE";
END;`;

  const diags = analyzeDocument({ text: suppressedProc, languageId: 'hdbprocedure' });
  assert.equal(diags.some((d) => d.ruleId === 'HANA-PERF-001'), false);
  // First SELECT * suppressed, second SELECT * NOT suppressed
  const perf004 = diags.filter((d) => d.ruleId === 'HANA-PERF-004');
  assert.equal(perf004.length, 1);
  assert.ok(perf004[0].start > suppressedProc.indexOf('UNSUPPRESSED_TABLE') - 30);
});
