import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getXsjsCompletions,
  getXsjsHover,
  getXsjsSignatureHelp,
} from '../src/xsjs/intellisense-core';

const ROOT = path.resolve(__dirname, '..', '..');

test('xsjs.d.ts exists and exposes core SAP HANA XS namespaces', () => {
  const dtsPath = path.join(ROOT, 'resources', 'xsjs.d.ts');
  assert.ok(fs.existsSync(dtsPath), 'resources/xsjs.d.ts should be generated');
  const dts = fs.readFileSync(dtsPath, 'utf8');
  assert.match(dts, /declare namespace \$/);
  assert.match(dts, /export namespace hdb/);
  assert.match(dts, /export class Connection/);
  assert.match(dts, /export namespace http/);
  assert.match(dts, /export type http = number/);
  assert.match(dts, /export type types = number/);
});

test('xsjs IntelliSense: namespace, local variable, constructor, and inheritance completions', () => {
  const rootCode = 'var c = $';
  const rootItems = getXsjsCompletions(rootCode, rootCode.length);
  assert.equal(rootItems[0]?.label, '$');

  const hdbCode = 'var c = $.hdb.';
  const hdbItems = getXsjsCompletions(hdbCode, hdbCode.length);
  const hdbNames = hdbItems.map((i) => i.label);
  assert.ok(hdbNames.includes('getConnection'));
  assert.ok(hdbNames.includes('Connection'));
  assert.ok(hdbNames.includes('ResultSet'));

  // Merged $.net.http namespace exposes both HTTP constants and Client/Request/readDestination
  const httpCode = '$.net.http.';
  const httpItems = getXsjsCompletions(httpCode, httpCode.length);
  const httpNames = httpItems.map((i) => i.label);
  assert.ok(httpNames.includes('GET'));
  assert.ok(httpNames.includes('POST'));
  assert.ok(httpNames.includes('Client'));
  assert.ok(httpNames.includes('readDestination'));

  // Local variable type inference: conn -> $.hdb.Connection
  const connCode = 'var conn = $.hdb.getConnection();\nconn.exe';
  const connItems = getXsjsCompletions(connCode, connCode.length);
  const connNames = connItems.map((i) => i.label);
  assert.ok(connNames.includes('executeQuery'));
  assert.ok(connNames.includes('executeUpdate'));

  // Constructor type inference: new $.net.Mail() -> Mail instance members
  const mailCode = 'var mail = new $.net.Mail();\nmail.';
  const mailItems = getXsjsCompletions(mailCode, mailCode.length);
  assert.ok(mailItems.some((i) => i.label === 'send' && i.kind === 'method'));
  assert.ok(mailItems.some((i) => i.label === 'to' && i.kind === 'property'));

  // Class static side exposes Part child and no instance-only send()
  const staticMail = '$.net.Mail.';
  const staticMailItems = getXsjsCompletions(staticMail, staticMail.length);
  assert.ok(staticMailItems.some((i) => i.label === 'Part'));
  assert.ok(!staticMailItems.some((i) => i.label === 'send'));

  // Inheritance: $.request resolves $.web.WebRequest -> WebEntityRequest properties/methods
  const reqCode = '$.request.';
  const reqItems = getXsjsCompletions(reqCode, reqCode.length);
  const reqNames = reqItems.map((i) => i.label);
  assert.ok(reqNames.includes('parameters'));
  assert.ok(reqNames.includes('body'));
  assert.ok(reqNames.includes('method'));

  // Deprecation metadata surfaced on fully deprecated symbols and in overload docs
  const sessionItems = getXsjsCompletions('$.session.', 10);
  const samlInfo = sessionItems.find((i) => i.label === 'samlUserInfo');
  assert.ok(samlInfo?.deprecated);

  const dbItems = getXsjsCompletions('$.db.', 5);
  const dbGetConn = dbItems.find((i) => i.label === 'getConnection');
  assert.match(dbGetConn?.documentation ?? '', /@deprecated/);
});

test('xsjs IntelliSense: negative check ignores strings and comments', () => {
  const inStr = 'var s = "$.hdb.";';
  assert.deepEqual(getXsjsCompletions(inStr, inStr.indexOf('".') + 1), []);

  const inComment = '// $.hdb.\nvar x = 1;';
  assert.deepEqual(getXsjsCompletions(inComment, '// $.hdb.'.length), []);

  const inBlockComment = '/* $.hdb.getConnection() */';
  assert.equal(getXsjsHover(inBlockComment, 12), null);
});

test('xsjs IntelliSense: hover documentation and signature help overloads', () => {
  const code = [
    'var conn = $.hdb.getConnection();',
    'var rs = conn.executeQuery("SELECT * FROM T WHERE ID = ?", 42);',
    'var client = new $.net.http.Client();',
    'client.request(req, "https://example.org", "http://proxy:8080");',
  ].join('\n');

  const hoverGetConn = getXsjsHover(code, code.indexOf('getConnection') + 3);
  assert.ok(hoverGetConn);
  assert.match(hoverGetConn.markdown, /getConnection/);
  assert.match(hoverGetConn.markdown, /\$\.hdb\.Connection/);

  const hoverLocalVar = getXsjsHover(code, code.indexOf('conn.executeQuery') + 2);
  assert.ok(hoverLocalVar);
  assert.match(hoverLocalVar.markdown, /var conn: \$\.hdb\.Connection/);

  // Signature help on second argument of conn.executeQuery
  const sigOffset = code.indexOf('42)') + 1;
  const sig = getXsjsSignatureHelp(code, sigOffset);
  assert.ok(sig);
  assert.equal(sig.activeParameter, 1);
  assert.match(sig.signatures[0].label, /executeQuery\(query: string/);

  // Signature help with overload matching on client.request(arg0, arg1, arg2)
  const reqOffset = code.indexOf('http://proxy') + 2;
  const reqSig = getXsjsSignatureHelp(code, reqOffset);
  assert.ok(reqSig);
  assert.equal(reqSig.activeParameter, 2);
  assert.ok(reqSig.signatures.length >= 2);
});
