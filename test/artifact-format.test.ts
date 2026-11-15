import test from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatClassicKv } from '../src/formatter/classic-kv';
import { formatCds } from '../src/formatter/cds';
import { formatXsodata } from '../src/formatter/xsodata';
import { formatDocument, supportsRangeFormatting } from '../src/formatter/dispatch';
import { format } from '../src/formatter/formatter';
import { EditorOptions, PartialFormatterOptions } from '../src/formatter/options';

const ROOT = path.resolve(__dirname, '..', '..');
const ED: EditorOptions = { tabSize: 4, insertSpaces: true, eol: '\n' };

const kv = (text: string, opts: PartialFormatterOptions = {}): string =>
  formatClassicKv(text, opts, ED);
const cds = (text: string, opts: PartialFormatterOptions = {}): string =>
  formatCds(text, opts, ED);
const odata = (text: string, opts: PartialFormatterOptions = {}): string =>
  formatXsodata(text, opts, ED);
const sql = (text: string, opts: PartialFormatterOptions = {}): string =>
  format(text, opts, ED);

// ===========================================================================
// 1. Classic KV Artifacts (.hdbtable, .hdbstructure, .hdbview, .hdbsequence, .hdbschema, .hdbti)
// ===========================================================================

test('classic-kv: .hdbtable & .hdbstructure formatting and case preservation', () => {
  const input =
    'table.schemaName="MYSCHEMA";table.tableType=COLUMNSTORE;' +
    'table.columns=[{name="ID";sqlType=INTEGER;nullable=false;},{name="NAME";sqlType=NVARCHAR;length=80;defaultValue="anon";}];' +
    'table.primaryKey.pkcolumns=["ID"];';

  const expected = [
    'table.schemaName = "MYSCHEMA";',
    'table.tableType = COLUMNSTORE;',
    'table.columns = [',
    '    { name = "ID"; sqlType = INTEGER; nullable = false; },',
    '    { name = "NAME"; sqlType = NVARCHAR; length = 80; defaultValue = "anon"; }',
    '];',
    'table.primaryKey.pkcolumns = ["ID"];',
    '',
  ].join('\n');

  const out = kv(input);
  assert.strictEqual(out, expected);
  assert.strictEqual(kv(out), out, 'idempotent');
});

test('classic-kv: .hdbview embedded SQL, unbracketed depends_on, missing semicolon recovery', () => {
  const input = [
    'schema="MYSCHEMA";',
    'query="select id,name from \\"MYSCHEMA\\".\\"MYTAB\\" where active=1;";',
    'depends_on="pkg::T1","pkg::V1";',
    'public=false',
  ].join('\n');

  const out = kv(input);
  assert.ok(out.includes('schema = "MYSCHEMA";'));
  assert.ok(out.includes('depends_on = ["pkg::T1", "pkg::V1"];'));
  assert.ok(out.includes('public = false;'));
  // Embedded SQL must NOT have a trailing semicolon inside the string literal
  assert.ok(!out.includes('active = 1;'));
  assert.ok(out.includes('\\"MYSCHEMA\\".\\"MYTAB\\"'), 'preserves escaped double quotes');
  assert.strictEqual(kv(out), out, 'idempotent');
});

test('classic-kv: .hdbview long query formats multi-line SQL inside string literal without trailing semicolon', () => {
  const input =
    'schema = "MYSCHEMA";\n' +
    'query = "select a.id, a.col1, b.col2, b.col3 from \\"MYSCHEMA\\".\\"TAB_A\\" a inner join \\"MYSCHEMA\\".\\"TAB_B\\" b on a.id = b.id where a.status = 1 order by a.id;";\n';

  const out = kv(input, { maxLineLength: 80 });
  assert.ok(out.includes('query = "\n'));
  assert.ok(out.includes('\n    SELECT\n'));
  assert.ok(!out.includes('ORDER BY a.id;'));
  assert.ok(out.includes('    ORDER BY a.id\n";'));
  assert.strictEqual(kv(out, { maxLineLength: 80 }), out, 'idempotent');
});

test('classic-kv: .hdbsequence and .hdbschema formatting with reset_by SQL', () => {
  const seqIn =
    'schema="MYSCHEMA";increment_by=1;start_with=100;nomaxvalue=true;' +
    'reset_by="select coalesce(max(id), 0) + 1 from \\"MYSCHEMA\\".\\"MYTAB\\"";';
  const seqOut = kv(seqIn);
  assert.ok(seqOut.includes('schema = "MYSCHEMA";'));
  assert.ok(seqOut.includes('SELECT COALESCE(MAX(id), 0) + 1'));
  assert.ok(seqOut.includes('FROM \\"MYSCHEMA\\".\\"MYTAB\\"'));
  assert.ok(!seqOut.includes('\\"MYTAB\\";'), 'embedded SQL must not end with a semicolon');
  assert.strictEqual(kv(seqOut), seqOut);

  const schemaOut = kv('schema_name="APP_SCHEMA";');
  assert.strictEqual(schemaOut, 'schema_name = "APP_SCHEMA";\n');
});

test('classic-kv: .hdbti always expands import structs and formats colon pairs', () => {
  const input =
    'import=[{hdbtable="pkg::MyTab";file="pkg:data.csv";header=false;delimField=";";delimEnclosing="\\"";keys=["MANDT":"100","SPRAS":"E"];}];';

  const expected = [
    'import = [',
    '    {',
    '        hdbtable = "pkg::MyTab";',
    '        file = "pkg:data.csv";',
    '        header = false;',
    '        delimField = ";";',
    '        delimEnclosing = "\\"";',
    '        keys = [ "MANDT" : "100", "SPRAS" : "E" ];',
    '    }',
    '];',
    '',
  ].join('\n');

  const out = kv(input);
  assert.strictEqual(out, expected);
  assert.strictEqual(kv(out), out, 'idempotent');
});

test('classic-kv: comments, pragmas, blank lines, and malformed input recovery', () => {
  const input = [
    '// leading comment',
    '',
    '',
    '',
    'schema_name="S1"; // inline comment',
    '// hanasql-format off',
    'weird   =   [  1 ,   2  ];',
    '// hanasql-format on',
    '/* trailing comment */',
  ].join('\n');

  const out = kv(input, { maxConsecutiveBlankLines: 1 });
  assert.ok(out.includes('// leading comment\n\nschema_name = "S1"; // inline comment'));
  assert.ok(out.includes('weird   =   [  1 ,   2  ];'), 'pragma region preserved verbatim');
  assert.ok(out.includes('/* trailing comment */'));

  // Malformed recovery: unclosed struct / missing value must not throw or lose code
  const malformed = 'table.schemaName = "S1"; table.columns = [ { name = "A"; sqlType =';
  const rec = kv(malformed);
  assert.ok(rec.includes('table.schemaName = "S1";'));
  assert.ok(rec.includes('name = "A";'));
});

test('dispatch: routes KV vs HDI DDL dual extensions accurately', () => {
  const kvTable = 'table.schemaName = "S"; table.columns = [{name="ID";sqlType=INTEGER;}];';
  const hdiTable = 'column table "T" (id integer primary key)';

  const outKv = formatDocument('hdbtable', kvTable, {}, ED);
  const outHdi = formatDocument('hdbtable', hdiTable, { trailingSemicolon: 'add' }, ED);

  assert.ok(outKv.includes('table.schemaName = "S";'));
  assert.ok(outHdi.includes('COLUMN TABLE "T"'));
  assert.ok(!outHdi.trimEnd().endsWith(';'), 'HDI .hdbtable must not get trailing semicolon');

  assert.strictEqual(supportsRangeFormatting('hdbtable', kvTable), false);
  assert.strictEqual(supportsRangeFormatting('hdbtable', hdiTable), true);
  assert.strictEqual(supportsRangeFormatting('hdbti', 'import = [];'), false);
  assert.strictEqual(supportsRangeFormatting('hdbschema', 'schema_name = "S";'), false);
  assert.strictEqual(supportsRangeFormatting('hdbcds', 'entity E {};'), false);
  assert.strictEqual(supportsRangeFormatting('xsodata', 'service {}'), false);
});

// ===========================================================================
// 2. CDS Formatting (.hdbdd, .hdbcds)
// ===========================================================================

test('cds: namespace, using, annotations, entity, context, technical configuration', () => {
  const input = [
    'namespace pkg.model;',
    'using pkg.base::Types as T;',
    '@Schema : "MY_SCHEMA"',
    'context MyCtx {',
    '@Catalog.tableType : #COLUMN',
    '@nokey',
    'entity Order { key id : Integer; items : Association[*] to Item on items.orderId = id; addr : { street : String(60); zip : String(10); }; } technical configuration { column store; partition by hash (id) partitions 4; };',
    'type MyEnum : String(10) { open = \'O\'; closed = \'C\'; };',
    'context Empty {};',
    '};',
  ].join('\n');

  const out = cds(input);
  assert.ok(out.startsWith('namespace pkg.model;\nusing pkg.base::Types as T;\n\n@Schema: "MY_SCHEMA"\ncontext MyCtx {\n'));
  assert.ok(out.includes('    @Catalog.tableType: #COLUMN\n    @nokey\n    entity Order {\n'));
  assert.ok(out.includes('        key id : Integer;\n'));
  assert.ok(out.includes('        addr : {\n            street : String(60);\n            zip : String(10);\n        };\n'));
  assert.ok(out.includes('    } technical configuration {\n        column store;\n'));
  assert.ok(out.includes('    };\n'));
  assert.ok(out.includes('    type MyEnum : String(10) {\n'));
  assert.ok(out.includes('    context Empty {};'));
  assert.strictEqual(cds(out), out, 'idempotent');
});

test('cds: views with parameters, select from, mixin/into, where/group by/order by, and CAP identifiers', () => {
  const input =
    'view OrderSummary with parameters p_status : String(10) as select from Order ' +
    'mixin { cust : Association[1] to Customer on cust.id = customerId; } ' +
    'into { id, ![order-total] as total, cust.name } ' +
    'where status = :p_status and amount >= 10 ' +
    'group by id, ![order-total], cust.name ' +
    'having count(*) > 0 order by id asc;';

  const out = cds(input);
  assert.ok(out.includes('view OrderSummary with parameters p_status : String(10) as select from Order'));
  assert.ok(out.includes('mixin {\n'));
  assert.ok(out.includes('into {\n'));
  assert.ok(out.includes('![order-total] as total'));
  assert.ok(out.includes('status = :p_status'), 'no space after parameter colon');
  assert.ok(out.includes('\nwhere status = :p_status'));
  assert.ok(out.includes('\ngroup by id'));
  assert.ok(out.includes('\nhaving count(*) > 0'));
  assert.ok(out.includes('\norder by id asc;'));
  assert.strictEqual(cds(out), out, 'idempotent');

  // Projection syntax `.{ ... }`
  const projOut = cds('view V as select from Header { orders[status = \'open\'].{ id as orderId, total } };');
  assert.ok(projOut.includes('.{\n'));
  assert.strictEqual(cds(projOut), projOut, 'projection idempotent');
});

test('cds: comments, hanasql-format off pragma, and malformed recovery', () => {
  const input = [
    '//header',
    'namespace a.b;',
    '/**doc*/',
    '// hanasql-format off',
    'entity   Weird   {  x:Integer;  };',
    '// hanasql-format on',
    'entity Good{y:String(20);};',
  ].join('\n');

  const out = cds(input, { spaceAfterCommentMarker: true });
  assert.ok(out.includes('// header'));
  assert.ok(out.includes('/**doc*/') || out.includes('/** doc*/'));
  assert.ok(out.includes('entity   Weird   {  x:Integer;  };'), 'pragma region untouched');
  assert.ok(out.includes('entity Good {\n    y : String(20);\n};'));

  // Malformed unclosed brace/paren does not crash
  const broken = 'context C { entity E { a : String(10';
  const broOut = cds(broken);
  assert.ok(broOut.includes('context C {'));
  assert.ok(broOut.includes('entity E {'));
});

// ===========================================================================
// 3. XSODATA Formatting (.xsodata)
// ===========================================================================

test('xsodata: service, short vs multi-clause entity, association, settings, annotations', () => {
  const input = [
    'service namespace "acme.app" {',
    '"acme.app::Simple" as "Simple";',
    '"MYSCHEMA"."MY_TABLE" as "Orders" with ("ID", "AMOUNT") keys ("ID") concurrencytoken navigates ("OrderItems" as "Items") create using "acme.app:exit.xsjslib::create" update events (before "acme.app:exit.xsjslib::beforeUpd") delete forbidden;',
    'association "OrderItems" principal "Orders"("ID") multiplicity "1" dependent "Items"("ORDER_ID") multiplicity "*";',
    'settings { support null; content cache-control "max-age=60"; limits max_records = 500, max_expanded_records = 1000; }',
    '}',
    'annotations { enable OData4SAP; }',
  ].join('\n');

  const out = odata(input, { maxLineLength: 100 });
  // Short single exposure stays one line
  assert.ok(out.includes('    "acme.app::Simple" as "Simple";\n'));
  // Catalog dot keeps no spaces, multi-clause entity wraps at +2
  assert.ok(out.includes('    "MYSCHEMA"."MY_TABLE" as "Orders"\n'));
  assert.ok(out.includes('        with ("ID", "AMOUNT")\n'));
  assert.ok(out.includes('        keys ("ID")\n'));
  assert.ok(out.includes('        concurrencytoken\n'));
  assert.ok(out.includes('        navigates ("OrderItems" as "Items")\n'));
  assert.ok(out.includes('        create using "acme.app:exit.xsjslib::create"\n'));
  assert.ok(out.includes('        update events (before "acme.app:exit.xsjslib::beforeUpd")\n'));
  assert.ok(out.includes('        delete forbidden;\n'));
  // Association wraps principal / dependent, join paren attached without space
  assert.ok(out.includes('    association "OrderItems"\n'));
  assert.ok(out.includes('        principal "Orders"("ID") multiplicity "1"\n'));
  assert.ok(out.includes('        dependent "Items"("ORDER_ID") multiplicity "*";\n'));
  // Settings inside service expands cleanly; cache-control intact; top-level blocks separated by blank line
  assert.ok(out.includes('    settings {\n        support null;\n        content cache-control "max-age=60";'));
  assert.ok(out.includes('\n}\n\nannotations {\n    enable OData4SAP;\n}\n'));
  assert.strictEqual(odata(out, { maxLineLength: 100 }), out, 'idempotent');
});

test('xsodata: long navigates & events wrapping, empty service, comments, pragmas, malformed recovery', () => {
  const input = [
    'service {}',
    'service namespace "pkg.nav" {',
    '// entity comment',
    '"pkg.nav::Main" as "Main" navigates ("NavAssocOne" as "FirstNavigation", "NavAssocTwo" as "SecondNavigation", "NavAssocThree" as "ThirdNavigation");',
    '// hanasql-format off',
    '"pkg.nav::Raw"    as   "Raw" ;',
    '// hanasql-format on',
    '}',
  ].join('\n');

  const out = odata(input, { maxLineLength: 80 });
  assert.ok(out.startsWith('service {}\n\nservice namespace "pkg.nav" {\n'));
  assert.ok(out.includes('    // entity comment\n'));
  assert.ok(
    out.includes(
      [
        '        navigates (',
        '            "NavAssocOne" as "FirstNavigation",',
        '            "NavAssocTwo" as "SecondNavigation",',
        '            "NavAssocThree" as "ThirdNavigation"',
        '        );',
      ].join('\n')
    )
  );
  assert.ok(out.includes('"pkg.nav::Raw"    as   "Raw" ;'), 'pragma region preserved verbatim');
  assert.strictEqual(odata(out, { maxLineLength: 80 }), out, 'idempotent');

  // Missing semicolon & unclosed brace recovery
  const malformed = 'service { "pkg::A" as "A"\nannotations { enable OData4SAP;';
  const rec = odata(malformed);
  assert.ok(rec.includes('"pkg::A" as "A"'));
  assert.ok(rec.includes('enable OData4SAP;'));
});

// ===========================================================================
// 4. HDI Headerless & SQLScript Edge Cases
// ===========================================================================

test('hdi: headerless .hdbprocedure and .hdbfunction with USING library preserve no trailing semicolon', () => {
  const hdbproc = [
    'PROCEDURE "pkg::proc_with_lib" ( IN iv_in NVARCHAR(50), OUT ov_out NVARCHAR(50) )',
    'LANGUAGE SQLSCRIPT',
    'SQL SECURITY INVOKER',
    'READS SQL DATA',
    'AS',
    'USING SYS.SQLSCRIPT_STRING AS STR_LIB;',
    'BEGIN',
    '    ov_out = STR_LIB:TRIM(:iv_in);',
    'END',
  ].join('\n');

  const outProc = sql(hdbproc, { trailingSemicolon: 'add' });
  assert.ok(!outProc.trimEnd().endsWith(';'), 'HDI .hdbprocedure with USING must not end with ;');
  assert.ok(outProc.includes('USING SYS.SQLSCRIPT_STRING AS STR_LIB;'));
  assert.strictEqual(sql(outProc, { trailingSemicolon: 'add' }), outProc, 'idempotent');

  const hdbfunc = [
    'FUNCTION "pkg::fn_with_lib" ( IN iv_in NVARCHAR(50) )',
    'RETURNS ov_out NVARCHAR(50)',
    'LANGUAGE SQLSCRIPT',
    'SQL SECURITY INVOKER AS',
    'USING SYS.SQLSCRIPT_STRING AS STR_LIB;',
    'BEGIN',
    '    RETURN STR_LIB:TRIM(:iv_in);',
    'END',
  ].join('\n');

  const outFunc = sql(hdbfunc, { trailingSemicolon: 'add' });
  assert.ok(!outFunc.trimEnd().endsWith(';'), 'HDI .hdbfunction with USING must not end with ;');
});

test('hdi: .hdblibrary, .hdbtabletype, and .hdbprojectionview omit trailing semicolon under add mode', () => {
  const lib = 'LIBRARY "pkg::my_lib" LANGUAGE SQLSCRIPT AS BEGIN PUBLIC FUNCTION f(x INT) RETURNS INT AS BEGIN RETURN :x + 1; END; END';
  const outLib = sql(lib, { trailingSemicolon: 'add' });
  assert.ok(!outLib.trimEnd().endsWith(';'), 'HDI .hdblibrary must not end with ;');

  const tableType = 'TYPE "pkg::T_ITEM" AS TABLE ( ID INTEGER, NAME NVARCHAR(100) )';
  const outType = sql(tableType, { trailingSemicolon: 'add' });
  assert.ok(!outType.trimEnd().endsWith(';'), 'HDI .hdbtabletype must not end with ;');

  const projView = 'PROJECTION VIEW "pkg::V_PROJ" AS SELECT id, name FROM "pkg::T"';
  const outProj = sql(projView, { trailingSemicolon: 'add' });
  assert.ok(!outProj.trimEnd().endsWith(';'), 'HDI .hdbprojectionview must not end with ;');

  // Negative check: regular DDL CREATE PROCEDURE & standalone SELECT DO receive trailing semicolon
  const ddlProc = 'CREATE PROCEDURE "MY_PROC" () AS USING SYS.SQLSCRIPT_STRING AS L; BEGIN SELECT 1 FROM DUMMY; END';
  const outDdl = sql(ddlProc, { trailingSemicolon: 'add' });
  assert.ok(outDdl.trimEnd().endsWith('END;'), 'regular CREATE PROCEDURE gets trailing ; under add mode');
});

// ===========================================================================
// 5. Real Sample Fixtures Regression & Idempotency
// ===========================================================================

test('samples: formatting sample artifacts produces valid, idempotent output without errors', () => {
  const cases: Array<[string, string]> = [
    ['hdbtable', 'samples/xs-classic/MYTABLE.hdbtable'],
    ['hdbstructure', 'samples/xs-classic/TableStructure.hdbstructure'],
    ['hdbview', 'samples/xs-classic/MYVIEW.hdbview'],
    ['hdbsequence', 'samples/xs-classic/MYSEQ.hdbsequence'],
    ['hdbschema', 'samples/xs-classic/MYSCHEMA.hdbschema'],
    ['hdbti', 'samples/xs-classic/myTableImportCfg.hdbti'],
    ['hdbdd', 'samples/xs-classic/model.hdbdd'],
    ['xsodata', 'samples/xs-classic/service.xsodata'],
    ['hdbcds', 'samples/hdi/model.hdbcds'],
  ];

  for (const [lang, rel] of cases) {
    const abs = path.join(ROOT, rel);
    const src = fs.readFileSync(abs, 'utf8');
    const first = formatDocument(lang, src, {}, ED);
    assert.ok(first.trim().length > 0, `${rel}: formatted output should be non-empty`);
    const second = formatDocument(lang, first, {}, ED);
    assert.strictEqual(second, first, `${rel}: second format pass must be idempotent`);
  }
});
