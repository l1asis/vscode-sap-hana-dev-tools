import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeDocument } from '../src/analyzer/dispatch';
import {
  convertArtifactDirection,
  convertClassicHdbroleToHdiJson,
  convertClassicHdbroleToHdiJsonWithNotes,
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
  assert.match(hdiSeq, /^  NO MAXVALUE$/m);
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

test('HANA-MIG-005: inline @Schema, single-line entity @Catalog.tableType / @Catalog.index, and comment safety', () => {
  const rootDir = fs.existsSync(path.join(__dirname, '..', 'samples'))
    ? path.join(__dirname, '..')
    : path.join(__dirname, '..', '..');
  const demoClassic = fs.readFileSync(
    path.join(rootDir, 'samples', 'format-demos', 'classic-model.hdbdd'),
    'utf8'
  );

  const diags = analyzeDocument({ text: demoClassic, languageId: 'hdbdd' });
  const mig005 = diags.filter((d) => d.ruleId === 'HANA-MIG-005');
  assert.equal(mig005.length, 2, 'should flag both @Schema and @Catalog.tableType in classic-model.hdbdd');
  assert.ok(mig005[0].fixes[0], 'should provide QuickFix on inline @Schema');

  const applied = applyTextEdits(demoClassic, mig005[0].fixes[0].edits);
  assert.equal(/@Schema/.test(applied), false, 'inline @Schema should be removed');
  assert.equal(/@Catalog\.tableType/.test(applied), false, '@Catalog.tableType should be removed');
  assert.match(applied, /^namespace demo\.classic;using demo\.common::Types as T;/);
  assert.match(applied, /entity Order\{[\s\S]*technical configuration \{ column store; \};/);
  assert.equal(analyzeDocument({ text: applied, languageId: 'hdbcds' }).filter((d) => d.ruleId === 'HANA-MIG-005').length, 0);

  // @Schema inline before code, plus @Catalog.index + @Catalog.tableType:#ROW + @WithStructuredPrivilegeCheck
  const inlineBefore = `namespace demo.app; @Schema:'DEMO' context C { @Catalog.tableType:#ROW @Catalog.index:[{name:'IDX_A',unique:true,elementNames:['a']}] entity E { key a : Integer; }; @WithStructuredPrivilegeCheck view V as select from E { a }; };`;
  const convertedInline = convertHdbddToHdbcds(inlineBefore);
  assert.equal(/@Schema|@Catalog|@WithStructuredPrivilegeCheck/.test(convertedInline), false);
  assert.match(convertedInline, /^namespace demo\.app; context C \{/);
  assert.match(convertedInline, /entity E \{ key a : Integer; \} technical configuration \{ row store; unique index IDX_A on \(a\) asc; \};/);

  // Negative case: commented / quoted annotations must NOT trigger HANA-MIG-005 or get mutated
  const commentedOnly = `namespace demo.hdi;
// @Schema : 'IGNORED'
/* @Catalog.tableType : #COLUMN */
context C {
  entity E { key note : String(40) default '@Schema'; };
};`;
  assert.equal(analyzeDocument({ text: commentedOnly, languageId: 'hdbdd' }).length, 0);
  assert.equal(convertHdbddToHdbcds(commentedOnly), commentedOnly);
});

// ---------------------------------------------------------------------------
// #71: Sample-driven regression harness. Applies every migration QuickFix
// (HANA-MIG-001 … 006) to every classic sample and checks the output.
// ---------------------------------------------------------------------------

const STRUCTURAL_MIGRATION_RULES = new Set([
  'HANA-MIG-001',
  'HANA-MIG-002',
  'HANA-MIG-003',
  'HANA-MIG-004',
  'HANA-MIG-005',
  'HANA-MIG-006',
]);

/** Language of the converted artifact (some migrations change the extension). */
const MIGRATED_LANGUAGE: Record<string, string> = {
  hdbstructure: 'hdbtabletype',
  hdbdd: 'hdbcds',
};

/** Samples that must be offered a structural migration QuickFix (guards against a vacuous loop). */
const EXPECTED_MIGRATABLE_SAMPLES = [
  'format-demos/classic-model.hdbdd',
  'format-demos/classic-role.hdbrole',
  'format-demos/classic-sequence.hdbsequence',
  'format-demos/classic-table.hdbtable',
  'format-demos/classic-view.hdbview',
  'format-demos/hdi-model.hdbcds',
  'xs-classic/MYSEQ.hdbsequence',
  'xs-classic/MYTABLE.hdbtable',
  'xs-classic/MYVIEW.hdbview',
  'xs-classic/MyRole.hdbrole',
  'xs-classic/TableStructure.hdbstructure',
  'xs-classic/model.hdbdd',
];

function repoRoot(): string {
  return fs.existsSync(path.join(__dirname, '..', 'samples')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
}

interface MigrationCase {
  readonly rel: string;
  readonly languageId: string;
  readonly text: string;
  readonly ruleId: string;
  readonly message: string;
  readonly output: string;
}

function collectMigrationCases(): MigrationCase[] {
  const cases: MigrationCase[] = [];
  for (const dir of ['xs-classic', 'format-demos']) {
    const abs = path.join(repoRoot(), 'samples', dir);
    for (const name of fs.readdirSync(abs).sort()) {
      const ext = path.extname(name).slice(1);
      if (!ext) continue;
      const rel = `${dir}/${name}`;
      const text = fs.readFileSync(path.join(abs, name), 'utf8');
      const diags = analyzeDocument({ text, languageId: ext, filePath: `/repo/db/src/${rel}` });
      const mig = diags.find((d) => STRUCTURAL_MIGRATION_RULES.has(d.ruleId) && d.fixes.length > 0);
      if (!mig) continue;
      cases.push({
        rel,
        languageId: ext,
        text,
        ruleId: mig.ruleId,
        message: mig.message,
        output: applyTextEdits(text, mig.fixes[0].edits),
      });
    }
  }
  return cases;
}

/** Comment bodies in a sample (line and block comments), outside string literals. */
function extractComments(text: string): string[] {
  const out: string[] = [];
  const re = /"(?:[^"\]|\.)*"|'(?:[^']|'')*'|(--|\/\/)([^\n]*)|\/\*([\s\S]*?)\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = (m[2] ?? m[3])?.trim();
    if (body) out.push(body);
  }
  return out;
}

test('#71: every classic sample is offered a structural migration QuickFix', () => {
  const covered = collectMigrationCases().map((c) => c.rel);
  for (const rel of EXPECTED_MIGRATABLE_SAMPLES) {
    assert.ok(covered.includes(rel), `${rel} should be offered a migration QuickFix`);
  }
});

for (const c of collectMigrationCases()) {
  test(`#71 ${c.ruleId} ${c.rel}: QuickFix output is valid, idempotent and keeps comments`, () => {
    assert.ok(c.output.trim().length > 0, 'output must be non-empty');

    const targetLang = MIGRATED_LANGUAGE[c.languageId] ?? c.languageId;
    const after = analyzeDocument({ text: c.output, languageId: targetLang, filePath: `/repo/db/src/${c.rel}` });

    const syntaxErrors = after.filter((d) => d.category === 'syntax' && d.severity === 'error');
    assert.deepEqual(
      syntaxErrors.map((d) => `${d.ruleId}: ${d.message}`),
      [],
      `output must have no syntax errors:\n${c.output}`
    );

    const remaining = after.filter((d) => STRUCTURAL_MIGRATION_RULES.has(d.ruleId));
    assert.deepEqual(
      remaining.map((d) => d.ruleId),
      [],
      `applying the fix again must not find more to migrate:\n${c.output}`
    );

    for (const comment of extractComments(c.text)) {
      assert.ok(
        c.output.includes(comment) || c.message.includes(comment),
        `comment "${comment}" must be preserved or reported as dropped:\n${c.output}`
      );
    }
  });
}

test('#71: forward -> reverse -> forward round trip is stable for every bidirectional sample', () => {
  const pairs: Record<string, (s: string) => string> = {
    hdbtable: (s) => convertHdbtableHdiToKv(s),
    hdbview: (s) => convertHdbviewHdiToKv(s),
    hdbsequence: (s) => convertHdbsequenceHdiToKv(s),
  };
  for (const c of collectMigrationCases()) {
    const reverse = pairs[c.languageId];
    if (!reverse) continue;
    const back = reverse(c.output);
    const again = analyzeDocument({ text: back, languageId: c.languageId, filePath: `/repo/db/src/${c.rel}` }).find(
      (d) => d.ruleId === c.ruleId
    );
    assert.ok(again, `${c.rel}: reverse output should be classic again`);
    assert.equal(applyTextEdits(back, again.fixes[0].edits), c.output, `${c.rel}: round trip must be stable`);
  }
});

test('#70 HANA-MIG-003: NO MAXVALUE / NO MINVALUE two-word form and RESET BY schema stripping', () => {
  const classic = `schema = "MYSCHEMA";
start_with = 10;
nomaxvalue = true;
nominvalue = true;
reset_by = "SELECT MAX(\\"ID\\") + 1 FROM \\"MYSCHEMA\\".\\"pkg::T\\" JOIN \\"OTHER\\".\\"X\\" ON 1 = 1";`;
  const hdi = convertHdbsequenceKvToHdi(classic, 'pkg::SEQ');
  assert.match(hdi, /^  NO MAXVALUE$/m);
  assert.match(hdi, /^  NO MINVALUE$/m);
  // Negative: the invalid single-word form must never be produced.
  assert.equal(/NOMAXVALUE|NOMINVALUE/.test(hdi), false);
  // The schema prefix matching `schema=` is stripped; other schemas are kept.
  assert.match(hdi, /RESET BY SELECT MAX\("ID"\) \+ 1 FROM "pkg::T" JOIN "OTHER"\."X" ON 1 = 1$/m);
  assert.equal(/"MYSCHEMA"/.test(hdi), false);

  const back = convertHdbsequenceHdiToKv(hdi, 'MYSCHEMA');
  assert.match(back, /^nomaxvalue = true;$/m);
  assert.match(back, /^nominvalue = true;$/m);
  assert.equal(/^(?:max|min)value = /m.test(back), false, 'NO MAXVALUE must not be read as MAXVALUE <n>');

  // Legacy single-word input (written by <= 0.10.1) still converts back.
  const legacy = convertHdbsequenceHdiToKv('SEQUENCE "S"\n  NOMAXVALUE\n  NOMINVALUE\n');
  assert.match(legacy, /^nomaxvalue = true;$/m);
  assert.match(legacy, /^nominvalue = true;$/m);
});

test('#68 HANA-MIG-005: technical configuration goes after the entity brace, merged, never duplicated', () => {
  const countTc = (s: string): number => (s.match(/technical configuration/g) ?? []).length;
  const idempotent = (out: string): void => assert.equal(convertHdbddToHdbcds(out), out, 'fix on its own output must be a no-op');

  // Multi-line entity without a technical configuration: new block after `}` with element indentation.
  const plain = `context C {
    @Catalog.tableType: #COLUMN
    entity E {
        key id : Integer;
    };
};`;
  const plainOut = convertHdbddToHdbcds(plain);
  assert.equal(
    plainOut,
    `context C {
    entity E {
        key id : Integer;
    } technical configuration {
        column store;
    };
};`
  );
  idempotent(plainOut);

  // Existing post-brace block with a store clause: annotation removed, nothing added (the issue's repro).
  const withTc = `@Catalog.tableType: #COLUMN
entity Item {
    key id : Integer;
    price : Decimal(15, 2);
} technical configuration {
    column store;
    partition by hash(id) partitions 4;
};`;
  const withTcOut = convertHdbddToHdbcds(withTc);
  assert.equal(withTcOut, withTc.replace('@Catalog.tableType: #COLUMN\n', ''));
  assert.equal(countTc(withTcOut), 1);
  idempotent(withTcOut);

  // Existing block without a store clause: store + index merged into it.
  const merge = `@Catalog.tableType: #ROW
@Catalog.index: [ { name: 'IDX_AB', unique: false, order: #DESC, elementNames: ['a', 'b'] } ]
entity M {
  key a : Integer;
  b : Integer;
} technical configuration {
  partition by hash(a) partitions 2;
};`;
  const mergeOut = convertHdbddToHdbcds(merge);
  assert.equal(
    mergeOut,
    `entity M {
  key a : Integer;
  b : Integer;
} technical configuration {
  partition by hash(a) partitions 2;
  row store;
  index IDX_AB on (a, b) desc;
};`
  );
  idempotent(mergeOut);

  // Index already declared in the block: not duplicated.
  const dupIdx = `@Catalog.index: [ { name: 'IDX_A', elementNames: ['a'] } ]
entity D { key a : Integer; } technical configuration { index IDX_A on (a) asc; };`;
  const dupOut = convertHdbddToHdbcds(dupIdx);
  assert.equal(dupOut, `entity D { key a : Integer; } technical configuration { index IDX_A on (a) asc; };`);

  // Single-line entity without `;` after the brace gets one.
  const noSemi = `@Catalog.tableType: #ROW
entity S { key a : Integer; }`;
  assert.equal(convertHdbddToHdbcds(noSemi), `entity S { key a : Integer; } technical configuration { row store; };`);

  // CRLF files keep CRLF line endings.
  const crlfOut = convertHdbddToHdbcds(plain.replace(/\n/g, '\r\n'));
  assert.equal(crlfOut, plainOut.replace(/\n/g, '\r\n'));

  // Negative: the block is never placed inside the element list.
  for (const out of [plainOut, withTcOut, mergeOut]) {
    assert.equal(/;\s*technical configuration/.test(out), false, `technical configuration inside entity braces:\n${out}`);
  }
});

test('#69 HANA-MIG-004: role header, extends lists, sql object lists and dropped-content notes', () => {
  const root = repoRoot();
  const demo = fs.readFileSync(path.join(root, 'samples', 'format-demos', 'classic-role.hdbrole'), 'utf8');
  const demoRole = JSON.parse(convertClassicHdbroleToHdiJson(demo)).role;
  assert.equal(demoRole.name, 'demo.roles::SalesViewer#');
  assert.deepEqual(demoRole.schema_roles, [{ names: ['demo.roles::BaseViewer'] }]);
  assert.deepEqual(demoRole.global_roles, ['PUBLIC_VIEWER']);
  assert.deepEqual(demoRole.object_privileges, [
    { name: 'ORDERS', type: 'TABLE', privileges_with_grant_option: ['SELECT'] },
    { name: 'demo.app::V_ORDERS', type: 'VIEW', privileges: ['SELECT', 'EXECUTE'] },
    { name: 'demo.app::P_INIT', type: 'PROCEDURE', privileges: ['SELECT', 'EXECUTE'] },
  ]);

  const job = fs.readFileSync(path.join(root, 'samples', 'xs-classic', 'MyRole.hdbrole'), 'utf8');
  const jobRole = JSON.parse(convertClassicHdbroleToHdiJson(job)).role;
  assert.equal(jobRole.name, 'acme.com.roles::JobAdministrator#');
  assert.deepEqual(jobRole.schema_roles, [{ names: ['acme.com.roles::Base'] }]);
  assert.deepEqual(jobRole.system_privileges, ['DATA ADMIN']);

  // Dropped constructs are reported in the HANA-MIG-004 message.
  const mig = analyzeDocument({ text: job, languageId: 'hdbrole' }).find((d) => d.ruleId === 'HANA-MIG-004');
  assert.ok(mig);
  assert.match(mig.message, /application privilege: acme\.com\.app1::Execute — dropped: .*xs-security\.json/);
  assert.match(mig.message, /package acme\.com\.app1: REPO\.READ — dropped/);
  assert.match(mig.message, /\.hdbsynonym for the external object MYSCHEMA\.MYTABLE/);

  // Multiple extends clauses with comma lists, and a multi-object sql object list.
  const multi = `role p::R extends role p::A, p::B extends catalog role "G1", "G2" {
  sql object p:T1.hdbtable, p:V1.calculationview, p::S1.hdbsequence, p:F1.hdbtablefunction: SELECT;
  sql object p:X1.weird: SELECT;
}`;
  const multiOut = convertClassicHdbroleToHdiJsonWithNotes(multi);
  const multiRole = JSON.parse(multiOut.content).role;
  assert.equal(multiRole.name, 'p::R', 'no # without grant options');
  assert.deepEqual(multiRole.schema_roles, [{ names: ['p::A', 'p::B'] }]);
  assert.deepEqual(multiRole.global_roles, ['G1', 'G2']);
  assert.deepEqual(
    multiRole.object_privileges.map((o: { name: string; type: string }) => `${o.type} ${o.name}`),
    ['TABLE p::T1', 'VIEW p::V1', 'SEQUENCE p::S1', 'FUNCTION p::F1', 'TABLE p::X1.weird']
  );
  assert.deepEqual(multiOut.notes, ['sql object p:X1.weird — unknown object type, TABLE assumed']);

  // Negative: header keywords never leak into the role name; a role with no grant option and nothing dropped has no notes.
  assert.equal(/extends|catalog/i.test(demoRole.name), false);
  const clean = convertClassicHdbroleToHdiJsonWithNotes('role p::C { sql object p:T.hdbtable: SELECT; }');
  assert.deepEqual(clean.notes, []);
  assert.equal(JSON.parse(clean.content).role.name, 'p::C');
});
