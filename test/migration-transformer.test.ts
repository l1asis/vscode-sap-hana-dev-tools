import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyzer/dispatch';
import {
  convertArtifactDirection,
  convertClassicHdbroleToHdiJson,
  convertHdbddToHdbcds,
  convertHdbsequenceHdiToKv,
  convertHdbsequenceKvToHdi,
  convertHdbstructureKvToTableType,
  convertHdbtableHdiToKv,
  convertHdbtableKvToHdi,
  convertHdbviewHdiToKv,
  convertHdbviewKvToHdi,
} from '../src/analyzer/migrator';
import { applyTextEdits } from '../src/analyzer/types';

test('HANA-MIG-001: .hdbtable bidirectional Classic KV <-> HDI DDL conversion', () => {
  const classicTable = `table.schemaName = "APP_SCHEMA";
table.tableType = COLUMNSTORE;
table.description = "Sales orders";
table.columns = [
  {name = "ORDER_ID"; sqlType = BIGINT; nullable = false;},
  {name = "CUST_NAME"; sqlType = NVARCHAR; length = 120; nullable = true; defaultValue = "N/A"; comment = "Customer";},
  {name = "AMOUNT"; sqlType = DECIMAL; precision = 15; scale = 2; nullable = false;}
];
table.primaryKey.pkcolumns = ["ORDER_ID"];`;

  const hdiDdl = convertHdbtableKvToHdi(classicTable, 'app.data::ORDERS');
  assert.match(hdiDdl, /COLUMN TABLE "app\.data::ORDERS"/);
  assert.match(hdiDdl, /"ORDER_ID" BIGINT NOT NULL/);
  assert.match(hdiDdl, /"CUST_NAME" NVARCHAR\(120\) DEFAULT 'N\/A' COMMENT 'Customer'/);
  assert.match(hdiDdl, /"AMOUNT" DECIMAL\(15, 2\) NOT NULL/);
  assert.match(hdiDdl, /PRIMARY KEY \("ORDER_ID"\)/);
  assert.match(hdiDdl, /COMMENT 'Sales orders'/);

  // Reverse convert HDI DDL back to Classic KV
  const backToClassic = convertHdbtableHdiToKv(hdiDdl, 'APP_SCHEMA');
  assert.match(backToClassic, /table\.schemaName = "APP_SCHEMA";/);
  assert.match(backToClassic, /table\.tableType = COLUMNSTORE;/);
  assert.match(backToClassic, /name = "ORDER_ID"; sqlType = BIGINT; nullable = false;/);
  assert.match(backToClassic, /name = "AMOUNT"; sqlType = DECIMAL; nullable = false; precision = 15; scale = 2;/);
  assert.match(backToClassic, /table\.primaryKey\.pkcolumns = \["ORDER_ID"\];/);

  // Diagnostic + QuickFix offered when opening classic KV .hdbtable
  const diags = analyzeDocument({
    text: classicTable,
    languageId: 'hdbtable',
    filePath: '/repo/db/src/data/ORDERS.hdbtable',
  });
  const mig001 = diags.find((d) => d.ruleId === 'HANA-MIG-001');
  assert.ok(mig001);
  assert.match(applyTextEdits(classicTable, mig001.fixes[0].edits), /COLUMN TABLE "data::ORDERS"/);

  // Suppressed when targetPlatform is 'xsc'
  const xscMode = analyzeDocument({
    text: classicTable,
    languageId: 'hdbtable',
    options: { targetPlatform: 'xsc' },
  });
  assert.deepEqual(xscMode, []);
});

test('HANA-MIG-002 / 003: .hdbview and .hdbsequence bidirectional conversions', () => {
  const classicView = `schema = "APP_SCHEMA";
query = "SELECT A.\\"ID\\", A.\\"NAME\\" FROM \\"APP_SCHEMA\\".\\"ORDERS\\" A JOIN \\"_SYS_BIC\\".\\"pkg/CV_DIM\\" B ON A.ID = B.ID";`;
  const hdiView = convertHdbviewKvToHdi(classicView, 'app.views::V_ORDERS');
  assert.match(hdiView, /^VIEW "app\.views::V_ORDERS"\nAS SELECT A\."ID", A\."NAME" FROM "ORDERS" A JOIN "pkg::CV_DIM" B/);

  const backView = convertHdbviewHdiToKv(hdiView, 'APP_SCHEMA');
  assert.match(backView, /schema = "APP_SCHEMA";/);
  assert.match(backView, /query = "/);

  const classicSeq = `schema = "APP_SCHEMA";
increment_by = 1;
start_with = 1000;
nomaxvalue = true;
cycles = false;
reset_by = "SELECT IFNULL(MAX(\\"ORDER_ID\\"), 0) + 1 FROM \\"ORDERS\\"";`;
  const hdiSeq = convertHdbsequenceKvToHdi(classicSeq, 'app.data::SEQ_ID');
  assert.match(hdiSeq, /SEQUENCE "app\.data::SEQ_ID"/);
  assert.match(hdiSeq, /INCREMENT BY 1/);
  assert.match(hdiSeq, /START WITH 1000/);
  assert.match(hdiSeq, /NOMAXVALUE/);
  assert.match(hdiSeq, /NO CYCLE/);
  assert.match(hdiSeq, /RESET BY SELECT IFNULL\(MAX\("ORDER_ID"\), 0\) \+ 1 FROM "ORDERS"/);

  const backSeq = convertHdbsequenceHdiToKv(hdiSeq, 'APP_SCHEMA');
  assert.match(backSeq, /increment_by = 1;/);
  assert.match(backSeq, /start_with = 1000;/);
  assert.match(backSeq, /nomaxvalue = true;/);
  assert.match(backSeq, /cycles = false;/);
});

test('HANA-MIG-004 / 005 / 006: Classic .hdbrole, .hdbdd, and .hdbstructure conversions', () => {
  const classicRole = `role app.sec::AdminRole {
  extends role app.sec::BaseRole;
  system privilege: MONITOR ADMIN;
  catalog schema "LEGACY": SELECT;
  sql object app.data:ORDERS.hdbtable: SELECT, INSERT WITH GRANT OPTION;
}`;
  const hdiRoleJson = convertClassicHdbroleToHdiJson(classicRole);
  const parsed = JSON.parse(hdiRoleJson);
  assert.equal(parsed.role.name, 'app.sec::AdminRole#');
  assert.deepEqual(parsed.role.schema_roles, [{ names: ['app.sec::BaseRole'] }]);
  assert.deepEqual(parsed.role.system_privileges, ['MONITOR ADMIN']);
  assert.equal(parsed.role.object_privileges[0].type, 'TABLE');
  assert.deepEqual(parsed.role.object_privileges[0].privileges_with_grant_option, ['SELECT', 'INSERT']);

  const classicCds = `namespace app.data;
@Schema : 'APP_SCHEMA'
context Sales {
  @Catalog.tableType : #COLUMN
  entity Orders {
    key ID : Integer;
  };
};`;
  const hdbcds = convertHdbddToHdbcds(classicCds);
  assert.equal(/@Schema/.test(hdbcds), false);
  assert.match(hdbcds, /technical configuration \{\s*column store;\s*\};/);

  const classicStruct = `table.schemaName = "S";
table.columns = [
  {name = "KEY_ID"; sqlType = INTEGER; nullable = false;}
];`;
  const tableType = convertHdbstructureKvToTableType(classicStruct, 'app::TT_KEY');
  assert.match(tableType, /TYPE "app::TT_KEY" AS TABLE/);
  assert.match(tableType, /"KEY_ID" INTEGER NOT NULL/);
  assert.ok(convertArtifactDirection(classicStruct, 'hdbstructure', 'toHdi', 'app/src/TT_KEY.hdbstructure'));
});

test('HANA-MIG-010 / 011 / 012 / 020: DEFAULT SCHEMA, _SYS_BIC, .xsodata, .hdbschema, and XSJS $.repo', () => {
  const procWithDefSchema = `CREATE PROCEDURE "MY_PROC" ()
  LANGUAGE SQLSCRIPT
  SQL SECURITY INVOKER
  DEFAULT SCHEMA "APP_SCHEMA"
AS
BEGIN
  SELECT "ID" FROM "_SYS_BIC"."pkg.sub/CV_SALES";
END;`;
  const procDiags = analyzeDocument({ text: procWithDefSchema, languageId: 'hdbprocedure' });
  const mig010 = procDiags.find((d) => d.ruleId === 'HANA-MIG-010');
  const mig011 = procDiags.find((d) => d.ruleId === 'HANA-MIG-011');
  assert.ok(mig010);
  assert.ok(mig011);

  assert.equal(/DEFAULT SCHEMA/.test(applyTextEdits(procWithDefSchema, mig010.fixes[0].edits)), false);
  assert.match(applyTextEdits(procWithDefSchema, mig011.fixes[0].edits), /FROM "pkg\.sub::CV_SALES";/);

  const xsodata = `service {
  "app.views/CV_ORDERS.calculationview" as "Orders" keys ("ID");
}`;
  const odataDiags = analyzeDocument({ text: xsodata, languageId: 'xsodata' });
  assert.equal(odataDiags.length, 1);
  assert.equal(odataDiags[0].ruleId, 'HANA-MIG-011');
  assert.match(applyTextEdits(xsodata, odataDiags[0].fixes[0].edits), /"app\.views::CV_ORDERS"/);

  const schemaDiags = analyzeDocument({ text: 'schema_name = "MYSCHEMA";', languageId: 'hdbschema' });
  assert.equal(schemaDiags[0]?.ruleId, 'HANA-MIG-012');

  const xsjsLegacy = `$.repo.createActiveSession();
if ($.session.hasSystemPrivilege("USER ADMIN")) {}`;
  const xsjsDiags = analyzeDocument({ text: xsjsLegacy, languageId: 'xsjs' });
  assert.equal(xsjsDiags.filter((d) => d.ruleId === 'HANA-MIG-020').length, 2);
});
