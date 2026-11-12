'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tokenize, has } = require('./helpers/tm');

const sample = (name) => fs.readFileSync(path.join(__dirname, '..', 'samples', name.startsWith('hdi/') ? '' : 'xs-classic', name), 'utf8');
const check = (tokens, text, scope) => assert.ok(has(tokens, text, scope), `expected "${text}" to have scope "${scope}"`);
const dump = (tokens) => tokens.filter((t) => t.text.trim()).map((t) => `${JSON.stringify(t.text)} ${t.scopes.slice(1).join(' ')}`).join('\n');

test('hdbtable (XS Classic)', () => {
  const t = tokenize('source.hdbtable', sample('MYTABLE.hdbtable'));
  check(t, 'table', 'variable.language.hdbtable');
  check(t, 'schemaName', 'property-name.hdbtable');
  check(t, 'COLUMNSTORE', 'constant.other.enum');
  check(t, 'NOLOGGING', 'constant.other.enum');
  check(t, 'VARCHAR', 'storage.type.hdbtable');
  check(t, 'DECIMAL', 'storage.type.hdbtable');
  check(t, 'sqlType', 'property-name.hdbtable');
  check(t, 'pkcolumns', 'property-name.hdbtable');
  check(t, 'B_TREE', 'constant.other.enum');
  check(t, 'true', 'constant.language.boolean');
  check(t, '20', 'constant.numeric');
});

test('hdbtable extension also highlights HDI-style SQL', () => {
  const t = tokenize('source.hdbtable', sample('hdi-style.hdbtable'));
  check(t, 'NVARCHAR', 'storage.type.hanasql');
  check(t, 'PRIMARY', 'keyword.other.ddl.hanasql');
  check(t, '-- HDI flavour of the same extension: plain SQL DDL', 'comment.line.double-dash');
});

test('hdbstructure reuses the table grammar', () => {
  const t = tokenize('source.hdbstructure', sample('TableStructure.hdbstructure'));
  check(t, 'pkcolumns', 'property-name.hdbtable');
});

test('hdbview: embedded SQL in query string, missing semicolon tolerated', () => {
  const t = tokenize('source.hdbview', sample('MYVIEW.hdbview'));
  check(t, 'schema', 'property-name.hdbview');
  check(t, 'public', 'property-name.hdbview');
  check(t, 'query', 'property-name.hdbview'); // follows "public=false" without ';'
  check(t, 'depends_on', 'property-name.hdbview');
  check(t, 'SELECT', 'keyword.other.dml.hanasql');
  check(t, 'LEFT', 'keyword.other.dml.hanasql');
  check(t, 'WITH', 'meta.embedded.block.sql');
  check(t, '\\"Column2\\"', 'variable.other.quoted-identifier');
  check(t, '12', 'string.quoted.single');
});

test('hdbview extension also highlights HDI-style SQL', () => {
  const t = tokenize('source.hdbview', sample('hdi-style.hdbview'));
  check(t, 'SELECT', 'keyword.other.dml.hanasql');
  check(t, 'WHERE', 'keyword.other.dml.hanasql');
});

test('hdbsequence', () => {
  const t = tokenize('source.hdbsequence', sample('MYSEQ.hdbsequence'));
  for (const k of ['schema', 'start_with', 'maxvalue', 'nomaxvalue', 'minvalue', 'nominvalue', 'cycles', 'reset_by', 'depends_on']) check(t, k, 'property-name.hdbsequence');
  check(t, 'SELECT', 'keyword.other.dml.hanasql');
  check(t, '10', 'constant.numeric');
});

test('hdbschema', () => {
  const t = tokenize('source.hdbschema', sample('MYSCHEMA.hdbschema'));
  check(t, 'schema_name', 'property-name.hdbschema');
});

test('hdbti', () => {
  const t = tokenize('source.hdbti', sample('myTableImportCfg.hdbti'));
  check(t, 'import', 'keyword.control.import');
  for (const k of ['table', 'schema', 'file', 'header', 'useHeaderNames', 'delimField', 'delimEnclosing', 'distinguishEmptyFromNull', 'keys']) check(t, k, 'property-name.hdbti');
  check(t, 'false', 'constant.language.boolean');
});

test('xshttpdest', () => {
  const t = tokenize('source.xshttpdest', sample('yahoo.xshttpdest'));
  for (const k of ['host', 'port', 'description', 'useSSL', 'pathPrefix', 'authType', 'useProxy', 'proxyHost', 'proxyPort', 'timeout']) check(t, k, 'property-name.xshttpdest');
  check(t, 'none', 'constant.other.enum');
});

test('xsaccess / xsapp / xssecurestore / xsprivileges', () => {
  let t = tokenize('source.xsaccess', sample('.xsaccess'));
  check(t, '"'+'exposed'+'"', 'property-name.json.xsaccess');
  check(t, '"'+'authentication'+'"', 'property-name.json.xsaccess');
  check(t, '"'+'prevent_xsrf'+'"', 'property-name.json.xsaccess');
  check(t, 'true', 'constant.language');
  t = tokenize('source.xsapp', sample('.xsapp'));
  check(t, '{', 'punctuation.section.braces');
  t = tokenize('source.xssecurestore', sample('localStore.xssecurestore'));
  check(t, '}', 'punctuation.section.braces');
  t = tokenize('source.xsprivileges', sample('.xsprivileges'));
  check(t, '"'+'privileges'+'"', 'property-name.json.xsprivileges');
  check(t, '"'+'name'+'"', 'property-name.json.xsprivileges');
});

test('xsjob with xscron expression', () => {
  const t = tokenize('source.xsjob', sample('yahoo.xsjob'));
  for (const k of ['description', 'action', 'schedules', 'xscron', 'parameter', 'signature_version']) check(t, `"${k}"`, 'property-name.json.xsjob');
  check(t, '*', 'keyword.operator.wildcard');
  check(t, '*/5', 'keyword.operator.wildcard');
  check(t, '59', 'constant.numeric');
  check(t, '"'+'stock'+'"', 'property-name.json'); // unknown key still highlighted
});

test('xssqlcc tolerates the missing comma used in the SAP documentation', () => {
  const t = tokenize('source.xssqlcc', sample('AdminConn.xssqlcc'));
  check(t, '"'+'description'+'"', 'property-name.json.xssqlcc');
  check(t, '"'+'role_for_auto_user'+'"', 'property-name.json.xssqlcc');
});

test('hdbsynonym', () => {
  const t = tokenize('source.hdbsynonym', sample('MySynonym1.hdbsynonym'));
  check(t, '"'+'acme.com.app1::MySynonym1'+'"', 'entity.name.type.hdbsynonym');
  check(t, '"'+'target'+'"', 'property-name.json.hdbsynonym');
  check(t, '"'+'object'+'"', 'property-name.json.hdbsynonym');
});

test('hdbdd (CDS)', () => {
  const t = tokenize('source.hdbdd', sample('model.hdbdd'));
  check(t, 'namespace', 'keyword.other.namespace');
  check(t, 'acme.com.app1', 'entity.name.namespace');
  check(t, 'using', 'keyword.control.import');
  check(t, 'context', 'storage.type.class');
  check(t, 'Model', 'entity.name.type');
  check(t, 'entity', 'storage.type.class');
  check(t, 'Employee', 'entity.name.type');
  check(t, 'Schema', 'storage.type.annotation');
  check(t, '#COLUMN', 'constant.other.enum-symbol');
  check(t, 'String', 'storage.type.hdbdd');
  check(t, 'Integer', 'storage.type.hdbdd');
  check(t, 'Decimal', 'storage.type.hdbdd');
  check(t, 'key', 'storage.modifier');
  check(t, 'virtual', 'storage.modifier');
  check(t, 'Association', 'keyword.other.association');
  check(t, '[0..1]', 'constant.other.cardinality');
  check(t, 'select', 'keyword.control.hdbdd');
  check(t, 'upper', 'support.function');
  check(t, 'technical configuration', 'keyword.other.technical-configuration');
  check(t, 'column store', 'keyword.other.technical-configuration');
});

test('hdbrole (classic) and JSON fallback', () => {
  const t = tokenize('source.hdbrole', sample('MyRole.hdbrole'));
  check(t, 'role', 'storage.type.role');
  check(t, 'acme.com.roles::JobAdministrator', 'entity.name.type.role');
  check(t, 'extends', 'keyword.other.extends');
  check(t, 'application privilege', 'keyword.control.privilege');
  check(t, 'catalog schema', 'keyword.control.privilege');
  check(t, 'catalog sql object', 'keyword.control.privilege');
  check(t, 'SELECT', 'constant.other.privilege');
  check(t, 'REPO.READ', 'constant.other.privilege');
  const j = tokenize('source.hdbrole', '{ "role": { "name": "x::r" } }');
  assert.ok(!has(j, 'role', 'storage.type.role'), 'HDI JSON roles must not be treated as classic');
});

test('xsodata', () => {
  const t = tokenize('source.xsodata', sample('service.xsodata'));
  check(t, 'service', 'storage.type.service');
  check(t, 'navigates', 'keyword.control');
  check(t, 'association', 'keyword.control');
  check(t, 'principal', 'keyword.control');
  check(t, 'dependent', 'keyword.control');
  check(t, 'multiplicity', 'keyword.control');
  check(t, 'settings', 'keyword.control');
});

test('hanasql: SQLScript additions from the SQLScript reference', () => {
  const t = tokenize('source.hanasql', sample('procedure.hdbprocedure'));
  check(t, 'CE_PROJECTION', 'support.function.sqlscript');
  check(t, 'MAP_MERGE', 'support.function.sqlscript');
  check(t, 'SQLEXCEPTION', 'keyword.control.sqlscript');
  check(t, '::SQL_ERROR_CODE', 'support.variable.system');
  check(t, 'PROCEDURE', 'keyword.control.ddl');
  const lib = tokenize('source.hanasql', 'SELECT SQLSCRIPT_STRING:SPLIT(a) FROM t');
  check(lib, 'SQLSCRIPT_STRING', 'support.class.library');
});


test('xsjs: XS JavaScript API on top of the JavaScript grammar', () => {
  const t = tokenize('source.xsjs', sample('lib.xsjs'));
  check(t, '$', 'variable.language.xsjs');
  check(t, 'import', 'support.function.import');
  check(t, 'hdb', 'support.class.api.xsjs');
  check(t, 'response', 'support.class.api.xsjs');
  check(t, 'session', 'support.class.api.xsjs');
  check(t, 'OK', 'support.constant.xsjs');
  check(t, 'TYPE_TEXT', 'support.constant.xsjs');
  check(t, 'var', 'keyword.control.js'); // falls through to the JavaScript grammar
  check(t, 'application/json', 'string.quoted.double.js');
});

test('HDI: .hdiconfig / .hdinamespace', () => {
  let t = tokenize('source.hdiconfig', sample('hdi/.hdiconfig'));
  check(t, '"plugin_version"', 'property-name.json.hdiconfig');
  check(t, '"file_suffixes"', 'property-name.json.hdiconfig');
  check(t, '"hdbsynonym"', 'entity.name.type.hdiconfig');
  check(t, '"plugin_name"', 'property-name.json.hdiconfig');
  t = tokenize('source.hdinamespace', sample('hdi/.hdinamespace'));
  check(t, '"subfolder"', 'property-name.json.hdinamespace');
});

test('HDI: hdbrole (JSON), hdbgrants, hdbtabledata, hdbsynonym', () => {
  let t = tokenize('source.hdbrole', sample('hdi/MyRole.hdbrole'));
  check(t, '"schema_privileges"', 'property-name.json.hdbrole');
  check(t, '"privileges_with_grant_option"', 'property-name.json.hdbrole');
  check(t, '"global_roles"', 'property-name.json.hdbrole');
  assert.ok(!has(t, 'role', 'storage.type.role'));
  t = tokenize('source.hdbgrants', sample('hdi/cross.hdbgrants'));
  check(t, '"ext-service"', 'property-name.json');
  check(t, '"object_owner"', 'property-name.json.hdbgrants');
  check(t, '"application_user"', 'property-name.json.hdbgrants');
  t = tokenize('source.hdbtabledata', sample('hdi/data.hdbtabledata'));
  for (const k of ['format_version', 'imports', 'target_table', 'source_data', 'has_header', 'import_settings', 'column_mappings']) check(t, `"${k}"`, 'property-name.json.hdbtabledata');
  t = tokenize('source.hdbsynonym', sample('hdi/syn.hdbsynonym'));
  check(t, '"acme.com.app1::MySynonym"', 'entity.name.type.hdbsynonym');
  check(t, '// optional configuration', 'comment.line.double-slash');
});

test('HDI: hdbmigrationtable markers and SQL', () => {
  const t = tokenize('source.hdbmigrationtable', sample('hdi/MYTABLE.hdbmigrationtable'));
  check(t, 'version', 'keyword.control.migration');
  check(t, 'migration', 'keyword.control.migration');
  check(t, '==', 'punctuation.definition.marker');
  check(t, 'NVARCHAR', 'storage.type.hanasql');
  check(t, 'ALTER', 'keyword.other.ddl.hanasql');
});

test('HDI: SQL-style artifacts without CREATE', () => {
  const t = tokenize('source.hanasql', sample('hdi/priv.hdbstructuredprivilege'));
  check(t, 'STRUCTURED PRIVILEGE', 'keyword.control.ddl.hanasql');
  check(t, '"acme.com.app1::SalesFilter"', 'entity.name.type.hanasql');
});

test('hdbcds (XS Advanced)', () => {
  const t = tokenize('source.hdbcds', sample('hdi/model.hdbcds'));
  check(t, 'namespace', 'keyword.other.namespace');
  check(t, 'AccessPolicy', 'storage.type.class.hdbcds');
  check(t, 'AllEmployees', 'entity.name.type.hdbcds');
  check(t, '$user', 'variable.language.session');
  check(t, 'grant', 'keyword.control.hdbcds');
  check(t, 'generated always as identity', 'keyword.other.generated');
  check(t, 'fulltext index', 'keyword.other.technical-configuration');
  check(t, 'column store', 'keyword.other.technical-configuration');
  check(t, '#COLUMN', 'constant.other.enum-symbol');
});

test('xsaccess keys from the Developer Guide', () => {
  const t = tokenize('source.xsaccess', '{ "default_connection": "x", "cors": { "enabled": true }, "headers": { "customHeaders": [{ "name": "a", "value": "b" }] } }');
  for (const k of ['default_connection', 'cors', 'headers', 'customHeaders', 'enabled']) check(t, `"${k}"`, 'property-name.json.xsaccess');
});

test('every grammar tokenizes its sample without throwing', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'syntaxes'))) {
    const scope = 'source.' + f.replace('.tmLanguage.json', '');
    tokenize(scope, 'x = "a\\"b" ; { [ ( \n -- c\n // c\n /* c */');
  }
});

if (process.env.DUMP) {
  test('dump', () => console.log(dump(tokenize(process.env.DUMP, sample(process.env.FILE)))));
}
