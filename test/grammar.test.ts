import test from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { tokenize, has, TmToken } from './helpers/tm';

const rootDir = fs.existsSync(path.join(__dirname, '..', 'samples'))
  ? path.join(__dirname, '..')
  : path.join(__dirname, '..', '..');

const sample = (name: string): string =>
  fs.readFileSync(path.join(rootDir, 'samples', name.startsWith('hdi/') ? '' : 'xs-classic', name), 'utf8');

const check = (tokens: readonly TmToken[], text: string, scope: string): void =>
  assert.ok(has(tokens, text, scope), `expected "${text}" to have scope "${scope}"`);

const dump = (tokens: readonly TmToken[]): string =>
  tokens
    .filter((t) => t.text.trim())
    .map((t) => `${JSON.stringify(t.text)} ${t.scopes.slice(1).join(' ')}`)
    .join('\n');

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
  check(t, '\\"', 'variable.other.quoted-identifier');
  check(t, 'Column2', 'variable.other.quoted-identifier');
  check(t, '12', 'string.quoted.single');
});

test('hdbview extension also highlights HDI-style SQL', () => {
  const t = tokenize('source.hdbview', sample('hdi-style.hdbview'));
  check(t, 'SELECT', 'keyword.other.dml.hanasql');
  check(t, 'WHERE', 'keyword.other.dml.hanasql');
});

test('hdbsequence', () => {
  const t = tokenize('source.hdbsequence', sample('MYSEQ.hdbsequence'));
  for (const k of ['schema', 'start_with', 'maxvalue', 'nomaxvalue', 'minvalue', 'nominvalue', 'cycles', 'reset_by', 'depends_on']) {
    check(t, k, 'property-name.hdbsequence');
  }
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
  for (const k of ['table', 'schema', 'file', 'header', 'useHeaderNames', 'delimField', 'delimEnclosing', 'distinguishEmptyFromNull', 'keys']) {
    check(t, k, 'property-name.hdbti');
  }
  check(t, 'false', 'constant.language.boolean');
});

test('xshttpdest', () => {
  const t = tokenize('source.xshttpdest', sample('yahoo.xshttpdest'));
  for (const k of ['host', 'port', 'description', 'useSSL', 'pathPrefix', 'authType', 'useProxy', 'proxyHost', 'proxyPort', 'timeout']) {
    check(t, k, 'property-name.xshttpdest');
  }
  check(t, 'none', 'constant.other.enum');
});

test('xsaccess / xsapp / xssecurestore / xsprivileges', () => {
  let t = tokenize('source.xsaccess', sample('.xsaccess'));
  check(t, '"' + 'exposed' + '"', 'property-name.json.xsaccess');
  check(t, '"' + 'authentication' + '"', 'property-name.json.xsaccess');
  check(t, '"' + 'prevent_xsrf' + '"', 'property-name.json.xsaccess');
  check(t, 'true', 'constant.language');
  t = tokenize('source.xsapp', sample('.xsapp'));
  check(t, '{', 'punctuation.section.braces');
  t = tokenize('source.xssecurestore', sample('localStore.xssecurestore'));
  check(t, '}', 'punctuation.section.braces');
  t = tokenize('source.xsprivileges', sample('.xsprivileges'));
  check(t, '"' + 'privileges' + '"', 'property-name.json.xsprivileges');
  check(t, '"' + 'name' + '"', 'property-name.json.xsprivileges');
});

test('xsjob with xscron expression', () => {
  const t = tokenize('source.xsjob', sample('yahoo.xsjob'));
  for (const k of ['description', 'action', 'schedules', 'xscron', 'parameter', 'signature_version']) {
    check(t, `"${k}"`, 'property-name.json.xsjob');
  }
  check(t, '*', 'keyword.operator.wildcard');
  check(t, '*/5', 'keyword.operator.wildcard');
  check(t, '59', 'constant.numeric');
  check(t, '"' + 'stock' + '"', 'property-name.json'); // unknown key still highlighted
});

test('xssqlcc tolerates the missing comma used in the SAP documentation', () => {
  const t = tokenize('source.xssqlcc', sample('AdminConn.xssqlcc'));
  check(t, '"' + 'description' + '"', 'property-name.json.xssqlcc');
  check(t, '"' + 'role_for_auto_user' + '"', 'property-name.json.xssqlcc');
});

test('hdbsynonym', () => {
  const t = tokenize('source.hdbsynonym', sample('MySynonym1.hdbsynonym'));
  check(t, '"' + 'acme.com.app1::MySynonym1' + '"', 'entity.name.type.hdbsynonym');
  check(t, '"' + 'target' + '"', 'property-name.json.hdbsynonym');
  check(t, '"' + 'object' + '"', 'property-name.json.hdbsynonym');
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
  const lib = tokenize('source.hanasql', 'USING SQLSCRIPT_STRING AS lib;\nx = lib:split_to_table(:a, CHAR(10));');
  check(lib, 'SQLSCRIPT_STRING', 'support.class.library');
  check(lib, 'lib', 'variable.other.library');
  check(lib, 'split_to_table', 'support.function.library-member');
  check(lib, ':a', 'variable.other.readwrite');
});

test('xsjs: XS JavaScript API on top of the JavaScript grammar', () => {
  const t = tokenize('source.xsjs', sample('lib.xsjs'));
  check(t, '$', 'variable.language.xsjs');
  check(t, 'import', 'support.function.import');
  check(t, 'application', 'support.class.api.xsjs');
  check(t, 'hdb', 'support.class.api.xsjs');
  check(t, 'response', 'support.class.api.xsjs');
  check(t, 'session', 'support.class.api.xsjs');
  check(t, 'OK', 'support.constant.xsjs');
  check(t, 'TYPE_TEXT', 'support.constant.xsjs');
  check(t, 'var', 'keyword.control.js'); // falls through to the JavaScript grammar
  check(t, 'application/json', 'string.quoted.double.js');
  assert.ok(!has(t, 'application/json', 'support.class.api.xsjs'));

  const demoSrc = fs.readFileSync(path.join(rootDir, 'samples', 'format-demos', 'service.xsjs'), 'utf8');
  const demoToks = tokenize('source.xsjs', demoSrc);
  check(demoToks, 'hdb', 'support.class.api.xsjs');
  check(demoToks, 'getConnection', 'support.function.xsjs');
  check(demoToks, 'response', 'support.class.api.xsjs');
  check(demoToks, 'status', 'support.variable.property.xsjs');
  check(demoToks, 'net', 'support.class.api.xsjs');
  check(demoToks, 'http', 'support.variable.property.xsjs');
  check(demoToks, 'OK', 'support.constant.xsjs');
  check(demoToks, 'contentType', 'support.variable.property.xsjs');
  check(demoToks, 'setBody', 'support.function.xsjs');
  check(demoToks, 'stringify', 'support.function.js');

  const neg = tokenize(
    'source.xsjs',
    'function f(){\n  var s = "$.response.status";\n  /* $.response.contentType */\n  // $.response.setBody()\n  var x = $.unknown.prop;\n}'
  );
  assert.ok(!has(neg, 'unknown', 'support.class.api.xsjs'));
  assert.ok(!has(neg, 'prop', 'support.variable.property.xsjs'));
  assert.ok(!has(neg, 'status', 'support.variable.property.xsjs'));
  assert.ok(!has(neg, 'contentType', 'support.variable.property.xsjs'));
  assert.ok(!has(neg, 'setBody', 'support.function.xsjs'));
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
  for (const k of ['format_version', 'imports', 'target_table', 'source_data', 'has_header', 'import_settings', 'column_mappings']) {
    check(t, `"${k}"`, 'property-name.json.hdbtabledata');
  }
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
  for (const k of ['default_connection', 'cors', 'headers', 'customHeaders', 'enabled']) {
    check(t, `"${k}"`, 'property-name.json.xsaccess');
  }
});

test('hanasql: ALTER SYSTEM and object DDL statement phrases, vector types, new functions', () => {
  let t = tokenize('source.hanasql', "ALTER SYSTEM START KERNEL PROFILER AT 'h:30003' TRACEPROFILE 'P';");
  check(t, 'ALTER SYSTEM START KERNEL PROFILER', 'keyword.other.statement');
  t = tokenize('source.hanasql', 'ALTER SYSTEM CLEAR TRACES;\nCREATE JWT PROVIDER p;\nCREATE TABLE t (v REAL_VECTOR(3));\nSELECT COSINE_SIMILARITY(a, b), SUBSTR_REGEXPR(x IN y OCCURRENCE 1) FROM t;');
  check(t, 'ALTER SYSTEM CLEAR TRACES', 'keyword.other.statement');
  check(t, 'CREATE JWT PROVIDER', 'keyword.other.statement');
  check(t, 'REAL_VECTOR', 'storage.type.hanasql');
  check(t, 'COSINE_SIMILARITY', 'support.function');
  check(t, 'SUBSTR_REGEXPR', 'support.function');
  check(t, 'OCCURRENCE', 'keyword.other.dml');
  t = tokenize('source.hanasql', 'APPLICATION TIME "CUSTOMERS"(validfrom, validto)\nGRAPH WORKSPACE G SOURCE COLUMN S\nVIRTUAL PROCEDURE "p" ()');
  check(t, 'APPLICATION TIME', 'keyword.control.ddl');
  check(t, 'GRAPH WORKSPACE', 'keyword.control.ddl');
  check(t, 'VIRTUAL PROCEDURE', 'keyword.control.ddl');
});

test('HDI: more JSON artifacts', () => {
  let t = tokenize('source.hdbafllangprocedure', sample('hdi/qa1_f3.hdbafllangprocedure'));
  for (const k of ['procedure', 'area', 'function', 'parameters', 'type', 'direction']) {
    check(t, `"${k}"`, 'property-name.json.hdbafllangprocedure');
  }
  t = tokenize('source.hdblogicalschema', sample('hdi/logicalschemas.hdblogicalschema'));
  for (const k of ['target', 'remote', 'database', 'schema']) {
    check(t, `"${k}"`, 'property-name.json.hdblogicalschema');
  }
  t = tokenize('source.hdbsysbicsynonym', sample('hdi/a.hdbsysbicsynonym'));
  check(t, '"object"', 'property-name.json.hdbsysbicsynonym');
  t = tokenize('source.hdbvirtualprocedureconfig', sample('hdi/remote_procedure.hdbvirtualprocedureconfig'));
  check(t, '"remote"', 'property-name.json.hdbvirtualprocedureconfig');
});

test('HDI: text analysis rules (CGUL), include and lexicon', () => {
  const t = tokenize('source.hdbtextrule', sample('hdi/rules.hdbtextrule'));
  check(t, '#include', 'keyword.control.import');
  check(t, '#lexicon', 'keyword.control.import');
  check(t, 'my.ta.rules::common-rules.hdbtextinclude', 'string.unquoted.path');
  check(t, '#define', 'keyword.control.directive');
  check(t, '#group', 'keyword.control.directive');
  check(t, 'PHONE', 'entity.name.type.hdbtextrule');
  check(t, 'scope', 'variable.parameter.attribute');
  check(t, '// phone numbers', 'comment.line.double-slash');
  check(t, 'STEM', 'support.type.property-name');
  check(t, 'Digit', 'variable.other.group');
  const inc = tokenize('source.hdbtextinclude', '#define A: [0-9]');
  check(inc, '#define', 'keyword.control.directive');
  const lex = tokenize('source.hdbtextlexicon', '#lexicon X <a::b.hdbtextlexicon>');
  check(lex, '#lexicon', 'keyword.control.import');
});

test('HDI: SQL-style artifacts (application time, graph workspace, virtual function)', () => {
  let t = tokenize('source.hanasql', sample('hdi/CUSTOMERS.hdbapplicationtime'));
  check(t, 'APPLICATION TIME', 'keyword.control.ddl');
  check(t, '"CUSTOMERS"', 'entity.name.type.hanasql');
  t = tokenize('source.hanasql', sample('hdi/my_graph.hdbgraphworkspace'));
  check(t, 'GRAPH WORKSPACE', 'keyword.control.ddl');
  t = tokenize('source.hanasql', sample('hdi/remote_function.hdbvirtualfunction'));
  check(t, 'VIRTUAL FUNCTION', 'keyword.control.ddl');
});

test('every grammar tokenizes its sample without throwing', () => {
  const syntaxesDir = path.join(rootDir, 'syntaxes');
  for (const f of fs.readdirSync(syntaxesDir)) {
    const raw = JSON.parse(fs.readFileSync(path.join(syntaxesDir, f), 'utf8')) as { scopeName?: string };
    const scope = raw.scopeName || 'source.' + f.replace('.tmLanguage.json', '');
    tokenize(scope, 'x = "a\\"b" ; { [ ( \n -- c\n // c\n /* c */');
  }
});

test('Phase 1 CGUL: complete directives, token specifiers, POS tags, slots, character classes, and negative cases', () => {
  const cgul = [
    '-- dash comment',
    '#include "my.ta::common.hdbtextinclude"',
    '#lexicon CompanyLex <my.ta::companies.hdbtextlexicon> (type="COMPANY")',
    '#category "ENTITY"',
    '#priority "HIGH"',
    '#define Digit: [0-9]',
    '#group ORG (scope="sentence", type="ORGANIZATION"):',
    '  [org]:(<STEM:"work", POS:VB|VBD, ORTH != "upper", !POS:NNP, REGEXP:".*Corp">+ %(my.ta::Suffix)? [A-Za-z]{1,3}) => { norm = $org, first = ${org}, idx = $1 };',
  ].join('\n');
  const t = tokenize('source.hdbtextrule', cgul);
  check(t, '-- dash comment', 'comment.line.double-dash.hdbtextrule');
  check(t, '#include', 'keyword.control.import.hdbtextrule');
  check(t, 'my.ta::common.hdbtextinclude', 'string.quoted.double.path.hdbtextrule');
  check(t, '#lexicon', 'keyword.control.import.hdbtextrule');
  check(t, 'CompanyLex', 'entity.name.type.hdbtextrule');
  check(t, '#category', 'keyword.control.directive.hdbtextrule');
  check(t, '#priority', 'keyword.control.directive.hdbtextrule');
  check(t, '0-9', 'constant.character.set.hdbtextrule');
  check(t, 'A-Z', 'constant.character.set.hdbtextrule');
  check(t, 'org', 'entity.name.tag.label.hdbtextrule');
  check(t, 'STEM', 'support.type.property-name.hdbtextrule');
  check(t, 'POS', 'support.type.property-name.hdbtextrule');
  check(t, 'ORTH', 'support.type.property-name.hdbtextrule');
  check(t, 'REGEXP', 'support.type.property-name.hdbtextrule');
  check(t, 'VB', 'constant.language.pos-tag.hdbtextrule');
  check(t, 'VBD', 'constant.language.pos-tag.hdbtextrule');
  check(t, 'NNP', 'constant.language.pos-tag.hdbtextrule');
  check(t, '!=', 'keyword.operator.comparison.hdbtextrule');
  check(t, '!', 'keyword.operator.negation.hdbtextrule');
  check(t, 'my.ta::Suffix', 'variable.other.group.hdbtextrule');
  check(t, '{1,3}', 'keyword.operator.hdbtextrule');
  check(t, '=>', 'keyword.operator.action.hdbtextrule');
  check(t, '$org', 'variable.other.slot.hdbtextrule');
  check(t, '${org}', 'variable.other.slot.hdbtextrule');
  check(t, '$1', 'variable.other.slot.hdbtextrule');
  // Negative case: POS tag outside <...> token specifier must not be scoped as pos-tag
  const outside = tokenize('source.hdbtextrule', '#group NN:\n  <TOKEN:"test">');
  assert.ok(!has(outside, 'NN', 'constant.language.pos-tag.hdbtextrule'));
});

test('Phase 1 XS OData: aggregates, multiplicity literals, storage, precommit/postcommit exits, and negative cases', () => {
  const odata = [
    'service namespace "my.srv" {',
    '  "my.pkg::SalesView" as "Sales"',
    '    keys generate local "ID"',
    '    aggregates always (SUM of "Amount", AVG of "Price", MIN of "Low", MAX of "High")',
    '    navigates ("Sales_Items" as "Items" from principal)',
    '    parameters via key and entity "SalesParams" results property "Execute"',
    '    create events (before "my.pkg:exit.xsjslib::beforeCreate", precommit "my.pkg:exit.xsjslib::preCommit", postcommit "my.pkg:exit.xsjslib::postCommit" for "Sales")',
    '    delete forbidden;',
    '  association "Sales_Items"',
    '    principal "Sales"("ID") multiplicity "1"',
    '    dependent "Items"("SalesID") multiplicity "1..*"',
    '    over "my.pkg::LinkTable" principal ("SID") dependent ("IID")',
    '    storage on principal;',
    '  association "Unstored_Assoc" principal "Sales"("ID") multiplicity "0..1" dependent "Items"("SalesID") multiplicity "*" no storage;',
    '}',
    'annotations { enable OData4SAP; }',
    'settings { support null; content cache-control "no-store"; metadata cache-control "max-age=3600"; limits { max_records = 5000; max_expanded_records = 10000; } }',
  ].join('\n');
  const t = tokenize('source.xsodata', odata);
  for (const fn of ['SUM', 'AVG', 'MIN', 'MAX']) {
    check(t, fn, 'support.function.aggregate.xsodata');
  }
  for (const mult of ['"1"', '"1..*"', '"0..1"', '"*"']) {
    check(t, mult, 'constant.other.multiplicity.xsodata');
  }
  for (const kw of ['from', 'precommit', 'postcommit', 'for', 'storage', 'no', 'aggregates', 'always', 'forbidden', 'OData4SAP']) {
    check(t, kw, kw === 'OData4SAP' ? 'support.constant.odata4sap.xsodata' : 'keyword.control.xsodata');
  }
  // Negative case: normal entity alias string must not be scoped as multiplicity, and SUM without 'of' is not an aggregate
  assert.ok(!has(t, '"Sales"', 'constant.other.multiplicity.xsodata'));
  const neg = tokenize('source.xsodata', '"my.pkg::SUM" as "SUM";');
  assert.ok(!has(neg, 'SUM', 'support.function.aggregate.xsodata'));
});

test('Phase 1 Classic Key-Value & CDS: SchemaName, struct primaryKey, synonym package, CDS types/clauses, and negative cases', () => {
  const tbl = 'table.SchemaName = "MYSCHEMA";\ntable.primaryKey = { pkcolumns = ["ID"]; indexType = B_TREE; };\ntable.unknownProp = "X";';
  const tTbl = tokenize('source.hdbtable', tbl);
  check(tTbl, 'SchemaName', 'support.type.property-name.hdbtable');
  check(tTbl, 'primaryKey', 'support.type.property-name.hdbtable');
  check(tTbl, 'pkcolumns', 'support.type.property-name.hdbtable');
  check(tTbl, 'B_TREE', 'constant.other.enum.hdbtable');
  assert.ok(!has(tTbl, 'unknownProp', 'support.type.property-name.hdbtable'));

  const syn = '{ "ns::Syn": { "target": { "object": "T", "schema": "S", "package": "my.pkg" } } }';
  const tSyn = tokenize('source.hdbsynonym', syn);
  check(tSyn, '"package"', 'property-name.json.hdbsynonym');

  const cds = [
    'namespace my.cds;',
    'using my.common::Types.* ;',
    'context Model {',
    '  table type TT_Out { id : Integer32; amount : Double; dt : Date; ts : Timestamp; };',
    '  temporary entity TempItem { key id : UUID; link : Association[*] to Target via entity LinkTab; }',
    '    technical configuration { row store migration disabled; using extended storage; no group; };',
    '  view V with parameters p1 : String(10) as select from TempItem mixin { toT : Association[1] to Target on $projection.id = $parameters.p1; } into { id };',
    '}',
  ].join('\n');
  const tCds = tokenize('source.hdbcds', cds);
  check(tCds, 'table type', 'storage.type.class.hdbdd');
  check(tCds, 'TT_Out', 'entity.name.type.hdbdd');
  check(tCds, 'temporary', 'storage.modifier.hdbdd');
  check(tCds, 'Integer32', 'storage.type.hdbdd');
  check(tCds, 'Double', 'storage.type.hdbdd');
  check(tCds, 'UUID', 'storage.type.hdbdd');
  check(tCds, 'via entity', 'keyword.control.hdbdd');
  check(tCds, 'mixin', 'keyword.control.hdbdd');
  check(tCds, '$projection', 'variable.language.cds.hdbdd');
  check(tCds, '$parameters', 'variable.language.cds.hdbdd');
  check(tCds, 'migration disabled', 'keyword.other.technical-configuration.hdbdd');
  check(tCds, 'using extended storage', 'keyword.other.technical-configuration.hdbdd');
  check(tCds, 'no group', 'keyword.other.technical-configuration.hdbdd');
});

test('Phase 1 SQL, SQLScript, Vector, Spatial, Graph, Hierarchy, JSON & Catalogs verification', () => {
  const sql = [
    'CREATE HNSW VECTOR INDEX idx_vec ON docs (embedding) SIMILARITY FUNCTION COSINE_SIMILARITY BUILD CONFIGURATION \'{"M": 64}\' ONLINE;',
    'CREATE ADJACENCY INDEX idx_adj ON graph_col (ID id, SOURCE src, TARGET tgt, TYPE type);',
    'CREATE STRUCTURED COLUMN MASK m_mask;',
    'EXPORT INTO RDF FILE \'out.ttl\';',
    '#[NO_INLINE]',
    '@AnalyzerSuppress(\'Rule1\')',
    '@Test()',
    'SELECT CROSS_ENCODE(a, b, \'model\') OVER (ORDER BY id), ST_AsGeoJSON(geom), ST_Distance(p1, p2), log:LEVEL_INFO',
    'FROM OPENCYPHER_TABLE(GRAPH WORKSPACE ws QUERY \'MATCH (n) RETURN n\'), SPARQL_TABLE(\'SELECT * WHERE { ?s ?p ?o }\')',
    'WHERE a MEMBER OF arr AND CONTAINS(txt, \'hana\');',
    'WITH SQL STATISTICS INTO lv_stats DO SELECT * FROM HIERARCHY_DESCENDANTS_AGGREGATE(SOURCE h MEASURES (SUM(v) AS s) WITH SUBTOTAL WITH BALANCE);',
  ].join('\n');
  const t = tokenize('source.hanasql', sql);
  check(t, 'CREATE HNSW VECTOR INDEX', 'keyword.other.statement.hanasql');
  check(t, 'SIMILARITY FUNCTION', 'keyword.other.clause.hanasql');
  check(t, 'BUILD CONFIGURATION', 'keyword.other.clause.hanasql');
  check(t, 'CREATE ADJACENCY INDEX', 'keyword.other.statement.hanasql');
  check(t, 'CREATE STRUCTURED COLUMN MASK', 'keyword.other.statement.hanasql');
  check(t, 'EXPORT INTO RDF FILE', 'keyword.other.clause.hanasql');
  check(t, '#[NO_INLINE]', 'keyword.control.directive.pragma.hanasql');
  check(t, '@AnalyzerSuppress', 'storage.type.annotation.pragma.hanasql');
  check(t, '@Test', 'storage.type.annotation.pragma.hanasql');
  check(t, 'CROSS_ENCODE', 'support.function.window.hanasql');
  check(t, 'ST_AsGeoJSON', 'support.function.spatial.hanasql');
  check(t, 'ST_Distance', 'support.function.spatial.hanasql');
  check(t, 'LEVEL_INFO', 'support.constant.library-member.hanasql');
  check(t, 'OPENCYPHER_TABLE', 'support.function.hanasql');
  check(t, 'SPARQL_TABLE', 'support.function.hanasql');
  check(t, 'MEMBER OF', 'keyword.other.clause.hanasql');
  check(t, 'CONTAINS', 'keyword.other.logical.hanasql');
  check(t, 'WITH SQL STATISTICS INTO', 'keyword.other.clause.hanasql');
  check(t, 'HIERARCHY_DESCENDANTS_AGGREGATE', 'support.function.hanasql');
  check(t, 'WITH SUBTOTAL', 'keyword.other.clause.hanasql');
  check(t, 'WITH BALANCE', 'keyword.other.clause.hanasql');

  // Verify catalog JSON schemas
  const kwCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'specs', 'catalogs', 'sql-keywords.json'), 'utf8')) as {
    roles: Record<string, { group: string; scope?: string }>;
    words: Array<{ name: string; roles: string[]; platforms?: string[] }>;
  };
  assert.ok(Array.isArray(kwCatalog.words) && kwCatalog.words.length >= 400);
  assert.ok(kwCatalog.words.some((k) => k.name === 'SELECT' && k.roles.includes('reserved')));
  assert.ok(kwCatalog.words.some((k) => k.name === 'REAL_VECTOR' && k.platforms?.length === 1 && k.platforms[0] === 'CLOUD'));
  assert.equal(kwCatalog.roles.reserved.group, 'lexical');

  const fnCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'specs', 'catalogs', 'builtin-functions.json'), 'utf8')) as {
    functions: Array<{ name: string; library: string; category: string; signatures: string[]; returnType: string; description: string }>;
  };
  assert.ok(Array.isArray(fnCatalog.functions) && fnCatalog.functions.length >= 500);
  for (const lib of ['SYS', 'SQLSCRIPT_SYNC', 'SQLSCRIPT_STRING', 'SQLSCRIPT_PRINT', 'SQLSCRIPT_LOGGING', 'SQLSCRIPT_TEST']) {
    assert.ok(fnCatalog.functions.some((f) => f.library === lib), `Missing library ${lib} in builtin-functions.json`);
  }
});

test('Newly added HDI DDL, HDI JSON, XS Classic JSON, XML & Config artifacts', () => {
  // 1. Headerless HDI DDL (.hdbcollectionindex, .hdbcollectionadjindex, .hdbfabricvirtualtable)
  const hdiHash = tokenize('source.hanasql', sample('hdi/CUSTOMERS_LASTNAME.hdbcollectionindex'));
  check(hdiHash, 'HASH INDEX', 'keyword.control.ddl.hanasql');
  check(hdiHash, '"CUSTOMERS_LASTNAME"', 'entity.name.type.hanasql');
  check(hdiHash, 'ON', 'keyword.other.dml.hanasql');

  const hdiBlock = tokenize('source.hanasql', 'BLOCK RANGE INDEX "ORDERS_DT_IDX" ON "ORDERS"($."date_of_purchase")');
  check(hdiBlock, 'BLOCK RANGE INDEX', 'keyword.control.ddl.hanasql');
  check(hdiBlock, '"ORDERS_DT_IDX"', 'entity.name.type.hanasql');

  const hdiAdj = tokenize('source.hanasql', sample('hdi/GRAPH_COLLECTION_ADJ.hdbcollectionadjindex'));
  check(hdiAdj, 'ADJACENCY INDEX', 'keyword.control.ddl.hanasql');
  check(hdiAdj, '"GRAPH_COLLECTION_ADJ"', 'entity.name.type.hanasql');
  check(hdiAdj, 'ON', 'keyword.other.dml.hanasql');
  assert.ok(!has(hdiAdj, '"GRAPH_COLLECTION"', 'keyword.control.ddl.hanasql'));

  const hdiFabric = tokenize('source.hanasql', sample('hdi/MY_FABRIC_VT.hdbfabricvirtualtable'));
  check(hdiFabric, 'SHARED SNAPSHOT REPLICA PAGE LOADABLE ON', 'keyword.control.ddl.hanasql');
  check(hdiFabric, '"MY_VIRTUAL_TABLE"', 'entity.name.type.hanasql');
  assert.ok(!has(hdiFabric, '"MY_VIRTUAL_TABLE"', 'keyword.control.ddl.hanasql'));

  // 2. .hdiconfig recognizes "properties" and "tags" as valid plugin keys
  const tHdiCfg = tokenize('source.hdiconfig', sample('hdi/.hdiconfig'));
  check(tHdiCfg, '"properties"', 'entity.name.type.hdiconfig');
  check(tHdiCfg, '"tags"', 'entity.name.type.hdiconfig');
  check(tHdiCfg, '"hdbcollectionadjindex"', 'entity.name.type.hdiconfig');
  check(tHdiCfg, '"hdbfabricvirtualtable"', 'entity.name.type.hdiconfig');
  check(tHdiCfg, '"plugin_name"', 'support.type.property-name.json.hdiconfig');
  assert.ok(!has(tHdiCfg, '"plugin_name"', 'entity.name.type.hdiconfig'));

  // 3. HDI JSON (jsonc) artifacts
  const tFvtCfg = tokenize('source.hdbfabricvirtualtableconfig', sample('hdi/MY_FABRIC_VT.hdbfabricvirtualtableconfig'));
  check(tFvtCfg, '"target"', 'support.type.property-name.json.hdbfabricvirtualtableconfig');
  check(tFvtCfg, '"remote"', 'support.type.property-name.json.hdbfabricvirtualtableconfig');
  assert.ok(!has(tFvtCfg, '"MY_VIRTUAL_TABLE"', 'support.type.property-name.json.hdbfabricvirtualtableconfig'));

  const tVpHadoop = tokenize('source.hdbvirtualpackage', sample('hdi/hadoop_analytics.hdbvirtualpackagehadoop'));
  check(tVpHadoop, '// Hadoop Virtual Package configuration', 'comment.line.double-slash.hdbvirtualpackage');
  check(tVpHadoop, '"adapter_type"', 'support.type.property-name.json.hdbvirtualpackage');
  check(tVpHadoop, '"location"', 'support.type.property-name.json.hdbvirtualpackage');

  const tVpSpark = tokenize('source.hdbvirtualpackage', sample('hdi/sparksql_analytics.hdbvirtualpackagesparksql'));
  check(tVpSpark, '// SparkSQL Virtual Package configuration', 'comment.line.double-slash.hdbvirtualpackage');
  check(tVpSpark, '"remote_source"', 'support.type.property-name.json.hdbvirtualpackage');

  const tVpBase = tokenize('source.hdbvirtualpackage', sample('hdi/custom_pkg.hdbvirtualpackage'));
  check(tVpBase, '"schema"', 'support.type.property-name.json.hdbvirtualpackage');

  // 4. XS Classic JSON (.xsappsite)
  const tSite = tokenize('source.xsappsite', sample('launchpad.xsappsite'));
  check(tSite, '"theme"', 'support.type.property-name.json.xsappsite');
  check(tSite, '"personalization"', 'support.type.property-name.json.xsappsite');
  check(tSite, 'true', 'constant.language.json.xsappsite');

  // 5. Classic Config / Service Definitions (.xsxmla, .hdbtid, .hdbtim)
  const tXmla = tokenize('source.xsxmla', sample('sales.xsxmla'));
  check(tXmla, 'service', 'storage.type.service.xsxmla');
  check(tXmla, 'namespace', 'keyword.other.xsxmla');
  check(tXmla, '"sap.hana.example::CA_SALES"', 'entity.name.type.object.xsxmla');
  check(tXmla, 'as', 'keyword.control.xsxmla');
  assert.ok(!has(tXmla, '"SalesCube"', 'entity.name.type.object.xsxmla'));

  const tTid = tokenize('source.hdbtid', sample('legacy_data.hdbtid'));
  check(tTid, 'import', 'support.type.property-name.hdbtid');
  check(tTid, 'table', 'support.type.property-name.hdbtid');
  check(tTid, 'file', 'support.type.property-name.hdbtid');

  const tTim = tokenize('source.hdbtim', sample('legacy_schema.hdbtim'));
  check(tTim, 'import', 'support.type.property-name.hdbtim');
  check(tTim, 'columns', 'support.type.property-name.hdbtim');

  // 6. package.json registration checks (and explicit exclusions)
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as {
    contributes: {
      languages: Array<{ id: string; extensions: string[]; icon?: { light: string; dark: string } }>;
      grammars: Array<{ language?: string; scopeName: string; injectTo?: string[] }>;
    };
  };
  for (const lang of pkg.contributes.languages) {
    if (lang.icon) {
      assert.ok(fs.existsSync(path.join(rootDir, lang.icon.light)), `Missing light icon for ${lang.id}: ${lang.icon.light}`);
      assert.ok(fs.existsSync(path.join(rootDir, lang.icon.dark)), `Missing dark icon for ${lang.id}: ${lang.icon.dark}`);
    }
  }
  const allExt = new Set(pkg.contributes.languages.flatMap((l) => l.extensions));
  for (const expected of [
    '.hdbcollectionindex', '.hdbcollectionadjindex', '.hdbfabricvirtualtable',
    '.hdbvirtualpackagehadoop', '.hdbvirtualpackagesparksql', '.hdbvirtualpackage',
    '.hdbmrjob', '.hdbfabricvirtualtableconfig', '.xsappsite',
    '.hdbdecisiontable', '.xswidget', '.xsxmla', '.hdbtid', '.hdbtim',
  ]) {
    assert.ok(allExt.has(expected), `Missing extension ${expected} in package.json`);
  }
  for (const excluded of ['.properties', '.csv', '.txt', '.jar', '.hdbtabledataprops', '.hdbtabledatatags']) {
    assert.ok(!allExt.has(excluded), `Excluded extension ${excluded} must NOT be registered in package.json`);
  }
  const grammarMap = new Map(
    pkg.contributes.grammars.filter((g) => g.language).map((g) => [g.language!, g.scopeName])
  );
  assert.strictEqual(grammarMap.get('hdbdecisiontable'), 'text.xml.hana');
  assert.strictEqual(grammarMap.get('xswidget'), 'text.xml.hana');
  assert.strictEqual(grammarMap.get('hdbfabricvirtualtable'), 'source.hanasql');
  const xsjsInj = pkg.contributes.grammars.find((g) => g.scopeName === 'xsjs.injection');
  assert.ok(xsjsInj?.injectTo?.includes('source.xsjs'), 'xsjs.injection must inject into source.xsjs');
});

test('hanasql: TO_CHAR, TO_NCHAR, CHR, GET_NUM_SERVERS, RECORD_COUNT and IS_EMPTY are built-in functions (issue #74)', () => {
  const t = tokenize(
    'source.hanasql',
    'SELECT TO_CHAR(a), to_nchar(a), CHR(65), GET_NUM_SERVERS() FROM DUMMY;\nn = RECORD_COUNT(:t);\nIF IS_EMPTY(:t) THEN n = 0; END IF;'
  );
  check(t, 'TO_CHAR', 'support.function.conversion');
  check(t, 'to_nchar', 'support.function.conversion');
  check(t, 'CHR', 'support.function.string');
  check(t, 'GET_NUM_SERVERS', 'support.function');
  check(t, 'RECORD_COUNT', 'support.function.sqlscript');
  check(t, 'IS_EMPTY', 'support.function.sqlscript');

  // Without `(` the same names are plain columns
  const cols = tokenize('source.hanasql', 'SELECT chr, is_empty FROM T;');
  for (const name of ['chr', 'is_empty']) {
    assert.ok(
      !cols.some((tok) => tok.text === name && tok.scopes.some((s) => s.includes('support.function'))),
      `${name} must stay unscoped`
    );
  }

  // Regression guard: the SQL Reference's explicit conversion function list
  const conv = ['TO_CHAR', 'TO_NCHAR', 'TO_VARCHAR', 'TO_NVARCHAR', 'TO_CLOB', 'TO_NCLOB', 'TO_BINARY', 'TO_VARBINARY'];
  const ct = tokenize('source.hanasql', `SELECT ${conv.map((f) => `${f}(a)`).join(', ')} FROM DUMMY;`);
  for (const f of conv) check(ct, f, 'support.function');
});

// ---------------------------------------------------------------------------
// Context-aware keyword scopes (#79) and embedded SQL in XS Classic strings (#41)
// ---------------------------------------------------------------------------

/** Significant scopes (no root, no meta.*) of the token holding the `nth` whole-word, case-sensitive `word`. */
const scopesOf = (tokens: readonly TmToken[], word: string, nth = 0): string[] => {
  const re = new RegExp(`(?<![\\w$#])${word.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}(?![\\w$#])`, 'g');
  let seen = 0;
  for (const t of tokens) {
    for (const _ of t.text.matchAll(re)) {
      if (seen++ === nth) return t.scopes.slice(1).filter((s) => !s.startsWith('meta.'));
    }
  }
  throw new Error(`word ${word} #${nth} not found`);
};
const CLAUSE = 'keyword.other.clause.hanasql';
const keywordIn = (scope: string, src: string, words: readonly string[]): void => {
  const t = tokenize(scope, src);
  for (const w of words) {
    assert.ok(scopesOf(t, w).includes(CLAUSE), `${w} in ${JSON.stringify(src)}: ${scopesOf(t, w).join(' ') || '(none)'}`);
  }
};
const bareIn = (scope: string, src: string, words: readonly string[]): void => {
  const t = tokenize(scope, src);
  for (const w of words) assert.deepEqual(scopesOf(t, w), [], `${w} must stay an identifier in ${JSON.stringify(src)}`);
};

test('hanasql: clause phrases scope context-only keywords (#79)', () => {
  const cases: Array<[string, string[]]> = [
    ['SELECT SUM(x) OVER (ORDER BY b ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM t;', ['ROWS', 'UNBOUNDED PRECEDING', 'CURRENT ROW']],
    ['SELECT SUM(x) OVER (ORDER BY b RANGE BETWEEN 2 PRECEDING AND 3 FOLLOWING) FROM t;', ['RANGE', 'PRECEDING', 'FOLLOWING']],
    ['SELECT a FROM t ORDER BY b DESC NULLS LAST, c NULLS FIRST;', ['NULLS LAST', 'NULLS FIRST']],
    ['SELECT a FROM t WITH HINT (NO_INLINE);', ['WITH HINT']],
    ["ALTER SYSTEM ADD STATEMENT HINT (NO_CS_JOIN) FOR STATEMENT HASH 'x';", ['STATEMENT HINT', 'STATEMENT']],
    ['MERGE INTO t USING s ON t.a = s.a WHEN MATCHED THEN DELETE WHEN NOT MATCHED THEN INSERT VALUES (s.a);', ['WHEN MATCHED', 'WHEN NOT MATCHED']],
    ['CREATE TRIGGER tr AFTER UPDATE ON t REFERENCING NEW ROW nr FOR EACH ROW BEGIN END;', ['AFTER UPDATE', 'REFERENCING NEW ROW', 'FOR EACH ROW']],
    ['CREATE TRIGGER tr INSTEAD OF DELETE ON v FOR EACH STATEMENT BEGIN END;', ['INSTEAD OF', 'FOR EACH STATEMENT']],
    ["DO BEGIN EXECUTE IMMEDIATE 'TRUNCATE TABLE t'; END;", ['EXECUTE IMMEDIATE']],
    ['SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET TRANSACTION READ ONLY;', ['READ COMMITTED', 'READ ONLY']],
    ['CREATE PROCEDURE p () READS SQL DATA AS BEGIN END;', ['READS SQL DATA']],
    ['CREATE COLUMN TABLE c AS (SELECT * FROM d) WITH NO DATA; CREATE COLUMN TABLE e LIKE d WITH DATA;', ['WITH NO DATA', 'WITH DATA']],
    ['CREATE COLUMN TABLE r (a INT) PARTITION BY RANGE (a) (PARTITION 1 <= VALUES < 5, PARTITION OTHERS);', ['PARTITION BY RANGE']],
    ['CREATE COLUMN TABLE h (a INT, b INT) PARTITION BY HASH (a) PARTITIONS 4, RANGE (b) (PARTITION OTHERS);', ['PARTITION BY HASH', 'RANGE']],
    ['CREATE SEQUENCE s INCREMENT BY 1 MAXVALUE 100 NO CYCLE;', ['INCREMENT BY', 'MAXVALUE', 'NO CYCLE']],
    ['CREATE USER u PASSWORD Initial1 NO FORCE_FIRST_PASSWORD_CHANGE;', ['NO']],
    ["SELECT a FROM t WHERE b LIKE 'x!%' ESCAPE '!';", ['ESCAPE']],
    ['CREATE GLOBAL TEMPORARY TABLE g (a INT) ON COMMIT PRESERVE ROWS;', ['PRESERVE ROWS']],
  ];
  for (const [src, words] of cases) keywordIn('source.hanasql', src, words);
});

test('hanasql: context-only keywords stay identifiers outside their clause (#79)', () => {
  bareIn('source.hanasql', 'SELECT range, data, first, last, source, matched, hint, rows, depth FROM t;', [
    'range', 'data', 'first', 'last', 'source', 'matched', 'hint', 'rows', 'depth',
  ]);
  bareIn('source.hanasql', 'SELECT no FROM t WHERE no IS NULL AND no IN (1, 2);', ['no']);
  bareIn('source.hanasql', 'SELECT a FROM t WHERE no = 1;', ['no']);
  // a CTE named `data` is not `WITH DATA`
  bareIn('source.hanasql', 'WITH data AS (SELECT 1 AS a FROM DUMMY) SELECT a FROM data;', ['data']);
  bareIn('source.hanasql', 'WITH data (a) AS (SELECT 1 FROM DUMMY) SELECT a FROM data;', ['data']);
  bareIn('source.hanasql', 'SELECT FIRST_VALUE(a ORDER BY b) AS first FROM t;', ['first']);
});

test('hanasql: prepositions TO, AT and OF are keywords everywhere (#79)', () => {
  const t = tokenize('source.hanasql', 'GRANT SELECT ON t TO u; RENAME TABLE a TO b; SELECT * FROM c FOR UPDATE OF c.x;');
  for (const [w, n] of [['TO', 0], ['TO', 1], ['OF', 0]] as const) {
    assert.ok(scopesOf(t, w, n).includes('keyword.other.preposition.hanasql'), `${w} #${n}`);
  }
});

test('hanasql: hierarchy clause words are keywords only inside HIERARCHY*() calls (#79, #75)', () => {
  const src = [
    'SELECT node_id FROM HIERARCHY_DESCENDANTS (',
    '  SOURCE HIERARCHY (SOURCE (SELECT node_id, parent_id FROM t WHERE x IN (1, 2)) SIBLING',
    '    ORDER BY ord ORPHAN ROOT CYCLE BREAKUP DEPTH 3 CACHE FORCE)',
    "  START WHERE node_id = 'R' DISTANCE FROM 1 TO 2",
    ') WHERE depth = 1 AND source = 2;',
  ].join('\n');
  const t = tokenize('source.hanasql', src);
  const inside = [['SOURCE', 0], ['SOURCE', 1], ['SIBLING', 0], ['ORPHAN', 0], ['ROOT', 0], ['CYCLE', 0], ['BREAKUP', 0], ['DEPTH', 0], ['CACHE', 0], ['FORCE', 0], ['DISTANCE', 0]] as const;
  for (const [w, n] of inside) assert.ok(scopesOf(t, w, n).includes(CLAUSE), `${w} #${n}: ${scopesOf(t, w, n).join(' ')}`);
  check(t, 'HIERARCHY_DESCENDANTS', 'support.function.hanasql');
  check(t, 'HIERARCHY', 'support.function.hanasql');
  // the region ends at the call's own `)`: the nested `IN (1, 2)` and the inner call do not close it early
  assert.deepEqual(scopesOf(t, 'depth'), [], 'depth after the call is a column');
  assert.deepEqual(scopesOf(t, 'source'), [], 'source after the call is a column');
  keywordIn('source.hanasql', 'SELECT * FROM HIERARCHY_LEVELED (SOURCE t LEVELS (l1, l2) ORDER BY l1 NULLS LAST RETAIN NULLS);', [
    'LEVELS', 'NULLS LAST', 'RETAIN NULLS',
  ]);
  keywordIn('source.hanasql', 'SELECT * FROM HIERARCHY_DESCENDANTS_AGGREGATE (SOURCE h MEASURES (SUM(v) AS s) WITH SUBTOTAL);', ['MEASURES']);
});

test('hanasql: every hierarchy clause and option word of the nine HIERARCHY* functions is scoped inside the call (#75)', () => {
  const calls: Array<[string, string[]]> = [
    [
      "HIERARCHY (SOURCE t START WHERE p IS NULL SIBLING ORDER BY n DEPTH 3 MULTIPARENT LEAVES ORPHAN ADOPT CYCLE ERROR CACHE FORCE LOAD BULK)",
      ['SOURCE', 'START', 'SIBLING', 'DEPTH', 'MULTIPARENT', 'LEAVES', 'ORPHAN', 'ADOPT', 'CYCLE', 'ERROR', 'CACHE', 'FORCE', 'LOAD', 'BULK'],
    ],
    ['HIERARCHY_SPANTREE (SOURCE t SIBLING ORDER BY n NO CACHE LOAD INCREMENTAL)', ['SOURCE', 'SIBLING', 'NO', 'CACHE', 'LOAD', 'INCREMENTAL']],
    [
      'HIERARCHY_TEMPORAL (SOURCE t SIBLING ORDER BY n VALID FROM :a EXCLUDED UNTIL :b EXCLUDED ORPHAN IGNORE CYCLE BREAKUP)',
      ['VALID', 'EXCLUDED', 'UNTIL', 'ORPHAN', 'IGNORE', 'BREAKUP'],
    ],
    ["HIERARCHY_LEVELED (SOURCE t LEVELS (a, b) SIBLING ORDER BY a RETAIN NULLS 'all')", ['LEVELS', 'RETAIN', 'NULLS']],
    ['HIERARCHY_DESCENDANTS (SOURCE h START WHERE n = 1 DISTANCE FROM 1 TO 2)', ['SOURCE', 'START', 'DISTANCE']],
    ['HIERARCHY_ANCESTORS (SOURCE h START (SELECT 1 AS start_rank FROM DUMMY) DISTANCE 2)', ['SOURCE', 'START', 'DISTANCE']],
    ["HIERARCHY_SIBLINGS (SOURCE h START WHERE n = 'A')", ['SOURCE', 'START']],
    [
      "HIERARCHY_DESCENDANTS_AGGREGATE (SOURCE h JOIN f ON f.n = h.n MEASURES (SUM(f.v) AS s) WITH SUBTOTAL 'x' WITH BALANCE WITH NOT MATCHED WITH TOTAL)",
      ['SOURCE', 'MEASURES', 'SUBTOTAL', 'BALANCE', 'MATCHED', 'TOTAL'],
    ],
    ['HIERARCHY_ANCESTORS_AGGREGATE (SOURCE h START WHERE n = 1 MEASURES (MAX(v) AS m) WHERE hierarchy_level > 1)', ['SOURCE', 'START', 'MEASURES']],
  ];
  for (const [call, words] of calls) keywordIn('source.hanasql', `SELECT * FROM ${call};`, words);
  // negative: the same words as plain columns outside a hierarchy call
  bareIn('source.hanasql', 'SELECT source, depth, leaves, adopt, breakup, bulk, levels, excluded, measures, subtotal, balance FROM t WHERE cache = 1;', [
    'source', 'depth', 'leaves', 'adopt', 'breakup', 'bulk', 'levels', 'excluded', 'measures', 'subtotal', 'balance', 'cache',
  ]);
});

test('hanasql: word operators use a keyword scope that default themes colour (#79)', () => {
  const t = tokenize('source.hanasql', "SELECT a FROM t WHERE b = 1 AND c IN (1) OR NOT EXISTS (SELECT 1 FROM DUMMY) AND d LIKE 'x' AND e IS NULL;");
  for (const w of ['AND', 'OR', 'NOT', 'IN', 'EXISTS', 'LIKE', 'IS']) {
    assert.deepEqual(scopesOf(t, w), ['keyword.other.logical.hanasql'], w);
  }
});

test('hdbview / hdbsequence: embedded SQL keeps comments, clauses and hierarchy keywords with \\" escapes (#41)', () => {
  const view = [
    'schema = "MYSCHEMA";',
    'query = "',
    '  SELECT node_id FROM HIERARCHY ( -- generator',
    '    SOURCE \\"MYSCHEMA\\".\\"MY_TABLE\\"',
    '    START WHERE parent_id IS NULL',
    '    SIBLING',
    '    ORDER BY \\"ORD\\" /* order */',
    '    ORPHAN ROOT',
    '    CYCLE BREAKUP',
    '  ) WHERE \\"MULTI',
    'LINE\\" = 1\\nAND source = 2',
    '";',
    'public = false;',
  ].join('\n');
  const t = tokenize('source.hdbview', view);
  for (const w of ['SOURCE', 'START', 'SIBLING', 'ORPHAN', 'ROOT', 'CYCLE', 'BREAKUP']) {
    assert.ok(scopesOf(t, w).includes(CLAUSE), `${w}: ${scopesOf(t, w).join(' ')}`);
  }
  check(t, '-- generator', 'comment.line.double-dash.hanasql');
  check(t, ' order ', 'comment.block.hanasql');
  check(t, 'MY_TABLE', 'variable.other.quoted-identifier.hanasql');
  check(t, 'LINE', 'variable.other.quoted-identifier.hanasql'); // an escaped identifier spanning two lines
  check(t, '\\n', 'constant.character.escape.hdbview');
  check(t, 'AND', 'keyword.other.logical.hanasql'); // right after the `\n` escape
  assert.deepEqual(scopesOf(t, 'source'), [], 'source outside the hierarchy call');
  check(t, 'public', 'property-name.hdbview'); // the string closed where it should

  // `--` ends at the closing quote, `/*` does not run past it
  const comments = tokenize('source.hdbview', 'query = "SELECT a FROM t -- note";\npublic = false;\nquery = "SELECT /* x";\nschema = "S";');
  check(comments, '-- note', 'comment.line.double-dash.hanasql');
  check(comments, 'public', 'property-name.hdbview');
  check(comments, 'schema', 'property-name.hdbview');

  const seq = tokenize(
    'source.hdbsequence',
    'schema = "S";\nreset_by = "SELECT MAX(\\"ID\\") + 1 FROM \\"S\\".\\"T\\"\\nWHERE a IS NOT NULL -- max\n";\nstart_with = 1;'
  );
  check(seq, 'SELECT', 'keyword.other.dml.hanasql');
  check(seq, 'WHERE', 'keyword.other.dml.hanasql'); // right after the `\n` escape
  check(seq, 'ID', 'variable.other.quoted-identifier.hanasql');
  check(seq, '-- max', 'comment.line.double-dash.hanasql');
  check(seq, 'start_with', 'property-name.hdbsequence');

  // negative: an unclosed HIERARCHY( stops at the closing quote instead of swallowing the next keys
  const open = tokenize('source.hdbview', 'query = "SELECT * FROM HIERARCHY (SOURCE t";\npublic = false;');
  check(open, 'public', 'property-name.hdbview');
});

if (process.env.DUMP && process.env.FILE) {
  const dumpScope = process.env.DUMP;
  const dumpFile = process.env.FILE;
  test('dump', () => console.log(dump(tokenize(dumpScope, sample(dumpFile)))));
}
