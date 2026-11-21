import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  extractSqlLocalVariables,
  getSqlCompletions,
  getSqlHover,
  getSqlSignatureHelp,
} from '../src/sql/intellisense-core';
import {
  getArtifactCompletions,
  getArtifactHover,
  isDesignTimeConfigOrKvMode,
} from '../src/sql/artifact-intellisense';

const ROOT = path.resolve(__dirname, '..', '..');

test('SQL IntelliSense: keywords, data types, functions, case adaptation, and Cloud CE_* deprecation', () => {
  const upperSel = getSqlCompletions('SEL', 3, { keywordCase: 'upper' });
  assert.ok(upperSel.some((c) => c.label === 'SELECT' && c.insertText === 'SELECT'));

  const lowerSel = getSqlCompletions('sel', 3, { keywordCase: 'lower' });
  assert.ok(lowerSel.some((c) => c.label === 'select' && c.insertText === 'select'));

  const lowerType = getSqlCompletions('x nva', 5, { dataTypeCase: 'lower' });
  assert.ok(lowerType.some((c) => c.label === 'nvarchar' && c.kind === 'type'));

  // Built-in functions insert call snippet unless '(' already follows
  const fnNoParen = getSqlCompletions('SELECT coal', 'SELECT coal'.length);
  const coalesceItem = fnNoParen.find((c) => c.label === 'COALESCE');
  assert.ok(coalesceItem);
  assert.equal(coalesceItem.insertText, 'COALESCE($1)');
  assert.equal(coalesceItem.isSnippet, true);

  const fnWithParen = getSqlCompletions('SELECT COAL()', 'SELECT COAL'.length);
  const coalesceExisting = fnWithParen.find((c) => c.label === 'COALESCE');
  assert.ok(coalesceExisting);
  assert.equal(coalesceExisting.insertText, 'COALESCE');

  // Vector & GraphScript functions are surfaced
  const vecItems = getSqlCompletions('SELECT L2D', 'SELECT L2D'.length);
  assert.ok(vecItems.some((c) => c.label === 'L2DISTANCE' && c.kind === 'function'));

  const graphItems = getSqlCompletions('RETURN SHORTEST_', 'RETURN SHORTEST_'.length);
  assert.ok(graphItems.some((c) => c.label === 'SHORTEST_PATH' && c.kind === 'function'));

  // CE_* deprecated ONLY on Cloud target platform
  const ceAuto = getSqlCompletions('lt = CE_PROJ', 'lt = CE_PROJ'.length, { targetPlatform: 'auto' });
  assert.equal(ceAuto.find((c) => c.label === 'CE_PROJECTION')?.deprecated, undefined);

  const ceCloud = getSqlCompletions('lt = CE_PROJ', 'lt = CE_PROJ'.length, { targetPlatform: 'cloud' });
  assert.ok(ceCloud.find((c) => c.label === 'CE_PROJECTION')?.deprecated);
});

test('SQLScript IntelliSense: :: sysvars, USING SYS.SQLSCRIPT_*, alias:member, and :localVar', () => {
  // 1. :: system variables
  const sysvarAll = getSqlCompletions('lv_cnt = ::', 'lv_cnt = ::'.length);
  const sysvarNames = sysvarAll.map((c) => c.label);
  assert.ok(sysvarNames.includes('::ROWCOUNT'));
  assert.ok(sysvarNames.includes('::SQL_ERROR_CODE'));
  assert.ok(sysvarNames.includes('::SQL_ERROR_MESSAGE'));
  assert.ok(sysvarNames.includes('::CURRENT_LINE_NUMBER'));

  const sysvarFiltered = getSqlCompletions('lv_err = ::SQL_ERR', 'lv_err = ::SQL_ERR'.length);
  assert.ok(sysvarFiltered.some((c) => c.label === '::SQL_ERROR_CODE'));
  assert.ok(!sysvarFiltered.some((c) => c.label === '::ROWCOUNT'));

  // Must NOT trigger :: sysvars after repository package prefix (`pkg::`)
  assert.deepEqual(getSqlCompletions('SELECT * FROM my.pkg::', 'SELECT * FROM my.pkg::'.length), []);

  // 2. USING / SYS. built-in library names
  const usingItems = getSqlCompletions('USING ', 'USING '.length);
  assert.ok(usingItems.some((c) => c.label === 'SQLSCRIPT_STRING' && c.kind === 'module'));
  assert.ok(usingItems.some((c) => c.label === 'SQLSCRIPT_LOGGING' && c.kind === 'module'));

  const sysDotItems = getSqlCompletions('USING SYS.', 'USING SYS.'.length);
  assert.ok(sysDotItems.some((c) => c.label === 'SQLSCRIPT_TEST' && c.kind === 'module'));

  // 3. Library alias:member and constants (STR_LIB:, LOG_LIB:LEVEL_)
  const proc = [
    'PROCEDURE "PR_DEMO" (IN iv_id NVARCHAR(36), OUT et_out TABLE (A NVARCHAR(10)))',
    'LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS',
    'USING SYS.SQLSCRIPT_STRING AS STR_LIB;',
    'USING SYS.SQLSCRIPT_LOGGING AS LOG_LIB;',
    'BEGIN',
    '  DECLARE lv_total DECIMAL(15, 2) := 0;',
    '  DECLARE EXIT HANDLER FOR SQLEXCEPTION RESIGNAL;',
    '  LOG_LIB:LOG(LOG_LIB:LEVEL_',
    '  STR_LIB:',
    '  SELECT * FROM T WHERE ID = :iv_',
    '  lv_x = :',
    'END',
  ].join('\n');

  const logConsts = getSqlCompletions(proc, proc.indexOf('LOG_LIB:LEVEL_') + 'LOG_LIB:LEVEL_'.length);
  const errConst = logConsts.find((c) => c.label === 'LEVEL_ERROR');
  assert.ok(errConst);
  assert.equal(errConst.kind, 'constant');
  assert.equal(errConst.insertText, 'LEVEL_ERROR');

  const strMembers = getSqlCompletions(proc, proc.indexOf('STR_LIB:') + 'STR_LIB:'.length);
  assert.ok(strMembers.some((c) => c.label === 'SPLIT' && c.kind === 'function'));
  assert.ok(strMembers.some((c) => c.label === 'FORMAT'));

  // 4. Local :param / DECLARE variable inference (ignoring DECLARE EXIT HANDLER)
  const locals = extractSqlLocalVariables(proc, proc.length);
  const localNames = locals.map((v) => v.name);
  assert.ok(localNames.includes('iv_id'));
  assert.ok(localNames.includes('et_out'));
  assert.ok(localNames.includes('lv_total'));
  assert.ok(!localNames.includes('EXIT'));
  assert.ok(!localNames.includes('HANDLER'));

  const ivCompletions = getSqlCompletions(proc, proc.indexOf(':iv_') + ':iv_'.length);
  assert.equal(ivCompletions.length, 1);
  assert.equal(ivCompletions[0].label, ':iv_id');
  assert.equal(ivCompletions[0].insertText, 'iv_id');

  const allLocalCompletions = getSqlCompletions(proc, proc.indexOf('lv_x = :') + 'lv_x = :'.length);
  assert.ok(allLocalCompletions.some((c) => c.label === ':lv_total'));
  assert.ok(allLocalCompletions.some((c) => c.label === ':et_out'));
});

test('SQL IntelliSense: hover and signature help', () => {
  const code = [
    'PROCEDURE "PR_CALC" (IN iv_rate DECIMAL(5, 2)) AS',
    'USING SYS.SQLSCRIPT_STRING AS STR_LIB;',
    'BEGIN',
    '  DECLARE lv_code INTEGER := ::SQL_ERROR_CODE;',
    '  lt = STR_LIB:SPLIT(:iv_rate, \',\');',
    '  lv_n = COALESCE(NULL, :iv_rate, 0);',
    'END',
  ].join('\n');

  const hoverSys = getSqlHover(code, code.indexOf('SQL_ERROR_CODE') + 3);
  assert.ok(hoverSys);
  assert.match(hoverSys.markdown, /::SQL_ERROR_CODE/);

  const hoverLib = getSqlHover(code, code.indexOf('SPLIT') + 2);
  assert.ok(hoverLib);
  assert.match(hoverLib.markdown, /SPLIT\(/);

  const hoverLocal = getSqlHover(code, code.indexOf(':iv_rate,') + 3);
  assert.ok(hoverLocal);
  assert.match(hoverLocal.markdown, /\(IN\) :iv_rate DECIMAL\(5, 2\)/);

  const sigLib = getSqlSignatureHelp(code, code.indexOf("',');") + 1);
  assert.ok(sigLib);
  assert.equal(sigLib.activeParameter, 1);
  assert.match(sigLib.signatures[0].label, /SPLIT\(/);

  const sigCoalesce = getSqlSignatureHelp(code, code.indexOf('0);') + 1);
  assert.ok(sigCoalesce);
  assert.equal(sigCoalesce.activeParameter, 2);
  assert.match(sigCoalesce.signatures[0].label, /COALESCE/);
});

test('SQL IntelliSense: hover for TO_CHAR, RECORD_COUNT and IS_EMPTY (issue #74)', () => {
  const code = "DO BEGIN\n  n = RECORD_COUNT(:t);\n  IF IS_EMPTY(:t) THEN s = TO_CHAR(CURRENT_DATE, 'YYYY'); END IF;\nEND;";
  const cases: ReadonlyArray<readonly [string, RegExp]> = [
    ['RECORD_COUNT', /RECORD_COUNT\(<table_variable>\)/],
    ['IS_EMPTY', /IS_EMPTY\(<table_variable>\)/],
    ['TO_CHAR', /TO_CHAR\(<value> \[, <format>\]\)/],
  ];
  for (const [name, sig] of cases) {
    const hover = getSqlHover(code, code.indexOf(name) + 2);
    assert.ok(hover, `hover for ${name}`);
    assert.match(hover.markdown, sig);
  }
});

test('SQL IntelliSense: negative check suppresses strings, comments, and unknown table alias dots', () => {
  assert.deepEqual(getSqlCompletions("SELECT '::ROW", "SELECT '::ROW".length), []);
  assert.deepEqual(getSqlCompletions('SELECT "pkg::', 'SELECT "pkg::'.length), []);
  assert.deepEqual(getSqlCompletions('-- SELECT :iv', '-- SELECT :iv'.length), []);
  assert.deepEqual(getSqlCompletions('/* COALESCE(', '/* COALESCE('.length), []);
  assert.deepEqual(getSqlCompletions('SELECT t.US', 'SELECT t.US'.length), []);

  assert.equal(getSqlHover('-- SELECT COALESCE', '-- SELECT COALES'.length), null);
  assert.equal(getSqlHover("SELECT 'SELECT'", "SELECT 'SEL".length), null);
  assert.equal(getSqlHover('SELECT t.USER FROM DUMMY', 'SELECT t.US'.length + 1), null);
  assert.equal(getSqlSignatureHelp('-- COALESCE(a', '-- COALESCE(a'.length), null);
});

test('Design-Time Config & Classic KV IntelliSense: .xsaccess, .hdiconfig, .hdbgrants, .hdbrole, and Classic KV', () => {
  // .xsaccess root & auth method & cors
  const xsRoot = '{\n  "exposed": true,\n  "prev';
  const xsRootItems = getArtifactCompletions('xsaccess', xsRoot, xsRoot.length);
  assert.ok(xsRootItems.some((i) => i.label === 'prevent_xsrf'));

  const xsAuth = '{\n  "authentication": {\n    "method": "';
  const xsAuthItems = getArtifactCompletions('xsaccess', xsAuth, xsAuth.length);
  assert.ok(xsAuthItems.some((i) => i.label === 'Form'));
  assert.ok(xsAuthItems.some((i) => i.label === 'SAML'));

  const xsHover = getArtifactHover('xsaccess', '{\n  "prevent_xsrf": true\n}', 8);
  assert.ok(xsHover);
  assert.match(xsHover.markdown, /CSRF/);

  // .hdiconfig plugin_name enums
  const hdiCfg = '{\n  "file_suffixes": {\n    "hdbtable": {\n      "plugin_name": "com.sap.hana.di.';
  const pluginItems = getArtifactCompletions('hdiconfig', hdiCfg, hdiCfg.length);
  assert.ok(pluginItems.some((i) => i.label === 'com.sap.hana.di.table'));
  assert.ok(pluginItems.some((i) => i.label === 'com.sap.hana.di.procedure'));

  // .hdbgrants privileges & deprecation hint for ALL PRIVILEGES
  const grants = '{\n  "svc": {\n    "application_user": {\n      "object_privileges": [{\n        "privileges": ["';
  const privItems = getArtifactCompletions('hdbgrants', grants, grants.length);
  assert.ok(privItems.some((i) => i.label === 'SELECT'));
  assert.ok(privItems.find((i) => i.label === 'ALL PRIVILEGES')?.deprecated);

  // .hdbrole JSON vs Classic DSL disambiguation
  assert.equal(isDesignTimeConfigOrKvMode('hdbrole', '{\n  "role": {}\n}'), true);
  assert.equal(isDesignTimeConfigOrKvMode('hdbrole', 'role my.ns::R {\n  catalog sql object "S"."T": SELECT;\n}'), false);
  const roleJson = '{\n  "role": {\n    "object_privileges": [{\n      "';
  assert.ok(getArtifactCompletions('hdbrole', roleJson, roleJson.length).some((i) => i.label === 'privileges'));
  assert.deepEqual(getArtifactCompletions('hdbrole', 'role my.ns::R { ', 16), []);

  // Classic KV vs HDI DDL for .hdbtable
  const kvTable = 'table.schemaName = "S";\ntable.tableType = ';
  assert.equal(isDesignTimeConfigOrKvMode('hdbtable', kvTable), true);
  assert.ok(getArtifactCompletions('hdbtable', kvTable, kvTable.length).some((i) => i.label === 'COLUMNSTORE'));

  const kvCol = 'table.columns = [\n  { name = "ID"; sqlType = ';
  assert.ok(getArtifactCompletions('hdbtable', kvCol, kvCol.length).some((i) => i.label === 'NVARCHAR'));

  const kvColHover = getArtifactHover('hdbtable', 'table.columns = [{ sqlType = NVARCHAR; }];', 22);
  assert.ok(kvColHover);
  assert.match(kvColHover.markdown, /sqlType/);

  const hdiTable = 'COLUMN TABLE "T" (\n  "ID" NVARCHAR(36)\n)';
  assert.equal(isDesignTimeConfigOrKvMode('hdbtable', hdiTable), false);

  // Classic .xshttpdest & comment/string suppression
  const dest = 'authType = ';
  const destAuth = getArtifactCompletions('xshttpdest', dest, dest.length).map((i) => i.label);
  assert.ok(destAuth.includes('AssertionTicket') && destAuth.includes('SamlAssertion'));
  assert.ok(!destAuth.includes('clientCertificate'), 'clientCertificate is not a documented authType (#65)');
  const destProxy = 'proxyType = ';
  assert.deepEqual(getArtifactCompletions('xshttpdest', destProxy, destProxy.length).map((i) => i.label).sort(), ['http', 'none', 'socks']);
  assert.deepEqual(getArtifactCompletions('xsaccess', '// "prevent_xsrf', '// "prevent_xsrf'.length), []);
  assert.deepEqual(getArtifactCompletions('hdbview', 'query = "SELECT *', 'query = "SELECT *'.length), []);
});

test('package.json snippets: all snippet files exist, parse as JSON, and contain valid scoped templates', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const snippetRefs = pkg.contributes?.snippets as Array<{ path: string }>;
  assert.ok(Array.isArray(snippetRefs) && snippetRefs.length >= 3);

  const seenPrefixes = new Set<string>();
  for (const ref of snippetRefs) {
    const abs = path.join(ROOT, ref.path);
    assert.ok(fs.existsSync(abs), `Missing snippet file: ${ref.path}`);
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8')) as Record<
      string,
      { scope?: string; prefix?: string; body?: string[]; description?: string }
    >;
    const entries = Object.entries(parsed);
    assert.ok(entries.length >= 5, `${ref.path} should define multiple snippets`);
    for (const [title, snip] of entries) {
      assert.ok(typeof snip.scope === 'string' && snip.scope.length > 0, `${title} missing scope`);
      assert.ok(typeof snip.prefix === 'string' && snip.prefix.length > 0, `${title} missing prefix`);
      assert.ok(!seenPrefixes.has(snip.prefix), `Duplicate snippet prefix: ${snip.prefix}`);
      seenPrefixes.add(snip.prefix);
      assert.ok(Array.isArray(snip.body) && snip.body.length > 0, `${title} missing body`);
    }
  }
});

test('#65: artifact key completion matches the property-schema specs', () => {
  const labels = (lang: string, src: string): string[] => getArtifactCompletions(lang, src, src.length).map((i) => i.label);

  // .xsaccess (xsc-application-artifacts.md §3)
  const root = labels('xsaccess', '{\n  "');
  for (const k of ['exposed', 'authentication', 'mime_mapping', 'headers', 'enable_etags']) assert.ok(root.includes(k), k);
  for (const k of ['mime_types', 'max_request_runtime']) assert.ok(!root.includes(k), `${k} is not documented`);
  assert.deepEqual(labels('xsaccess', '{\n  "headers": {\n    "').sort(), ['customHeaders', 'enabled']);
  const cors = labels('xsaccess', '{\n  "cors": {\n    "');
  assert.ok(cors.includes('exposeHeaders') && !cors.includes('allowCredential'));
  assert.ok(!labels('xsaccess', '{\n  "authentication": {\n    "').includes('realm'));
  const methodSrc = '{\n  "authentication": {\n    "method": "';
  const method = getArtifactCompletions('xsaccess', methodSrc, methodSrc.length);
  assert.equal(method.find((i) => i.label === 'Form')?.deprecated, undefined);
  assert.ok(method.find((i) => i.label === 'Basic')?.deprecated, 'non-Form methods are configured in the XS Administration Tool');

  // .hdbgrants (hdi-grants-roles.md §2)
  const grantee = labels('hdbgrants', '{\n  "svc": {\n    "object_owner": {\n      "');
  for (const k of ['system_privileges', 'global_roles', 'schema_roles', 'global_object_privileges']) assert.ok(grantee.includes(k), k);
  const granteeSrc = '{\n  "svc": {\n    "object_owner": {\n      "';
  assert.ok(getArtifactCompletions('hdbgrants', granteeSrc, granteeSrc.length).find((i) => i.label === 'roles')?.deprecated);
  const item = labels('hdbgrants', '{\n  "svc": {\n    "object_owner": {\n      "object_privileges": [{\n        "');
  for (const k of ['schema', 'name', 'privileges', 'privileges_with_grant_option']) assert.ok(item.includes(k), k);
  for (const k of ['reference', 'names', 'include_filter']) assert.ok(!item.includes(k), `${k} is not an object_privileges key`);
  // #121: @sap/hdi-deploy reads `reference` in schema_privileges only, and accepts `names` in global_roles
  const schemaItem = labels('hdbgrants', '{\n  "svc": {\n    "application_user": {\n      "schema_privileges": [{\n        "');
  assert.ok(schemaItem.includes('reference') && schemaItem.includes('schema'));
  assert.ok(!schemaItem.includes('include_filter') && !schemaItem.includes('names'));
  const roleSrc = '{\n  "svc": {\n    "object_owner": {\n      "global_roles": [{\n        "';
  const roleItem = getArtifactCompletions('hdbgrants', roleSrc, roleSrc.length);
  assert.ok(roleItem.find((i) => i.label === 'names')?.deprecated, 'names is offered as a superseded synonym of roles');
  assert.ok(!roleItem.some((i) => i.label === 'reference'));
  assert.ok(labels('hdbgrants', '{\n  "svc": {\n    "object_owner": {\n      "system_privileges": [{\n        "').includes('privileges_with_admin_option'));

  // .hdbrole (hdi-grants-roles.md §3)
  const body = labels('hdbrole', '{\n  "role": {\n    "');
  for (const k of ['name', 'global_roles', 'pattern_escape_character', 'schema_analytic_privileges']) assert.ok(body.includes(k), k);
  assert.ok(!body.includes('application_privileges'));
  const entry = labels('hdbrole', '{\n  "role": {\n    "object_privileges": [{\n      "');
  for (const k of ['name', 'type', 'pattern_mode']) assert.ok(entry.includes(k), k);
  assert.deepEqual(labels('hdbrole', '{\n  "role": {\n    "object_privileges": [{\n      "pattern_mode": "').sort(), ['exclude', 'include']);

  // .xshttpdest (xsc-application-artifacts.md §8)
  const dest = labels('xshttpdest', 'host = "h";\nport = 443;\n');
  for (const k of ['samlACS', 'proxyType', 'remoteSID', 'oAuthAppConfig', 'modifies']) assert.ok(dest.includes(k), k);
  assert.deepEqual(labels('xshttpdest', 'sslAuth = ').sort(), ['anonymous', 'client']);
});
