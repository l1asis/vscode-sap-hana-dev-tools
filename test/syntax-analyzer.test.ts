import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ANALYZER_LANGUAGES, analyzeDocument } from '../src/analyzer/dispatch';
import { parseJsonAstWithErrors } from '../src/analyzer/json-parser';
import { applyTextEdits, DEFAULT_ANALYZER_OPTIONS } from '../src/analyzer/types';

const ROOT = fs.existsSync(path.join(__dirname, '..', 'samples'))
  ? path.join(__dirname, '..')
  : path.resolve(__dirname, '../..');

function syntaxDiags(languageId: string, text: string) {
  return analyzeDocument({
    languageId,
    text,
    options: { ...DEFAULT_ANALYZER_OPTIONS, security: false, performance: false, migration: false, calculationView: false, syntax: true },
  });
}

test('HANA-SYN-001..003: SQL, SQLScript, CDS & KV lexical and delimiter errors', () => {
  // Unterminated single-quoted SQL string (including trailing doubled escape '' without closing quote)
  const str1 = syntaxDiags('hanasql', "SELECT 'unclosed FROM DUMMY;");
  assert.ok(str1.some((d) => d.ruleId === 'HANA-SYN-001' && d.severity === 'error'));

  const strEsc = syntaxDiags('hanasql', "SELECT 'it'' FROM DUMMY;");
  assert.ok(strEsc.some((d) => d.ruleId === 'HANA-SYN-001'));

  // Valid multiline SQL string and escaped quotes pass cleanly
  assert.deepEqual(
    syntaxDiags('hanasql', "SELECT 'line 1\nit''s valid' AS \"MY\"\"COL\" FROM DUMMY;"),
    []
  );

  // Unterminated block comment
  const cmt = syntaxDiags('hanasql', 'SELECT 1 FROM DUMMY; /* never closed');
  assert.ok(cmt.some((d) => d.ruleId === 'HANA-SYN-002'));

  // Unterminated quoted identifier
  const qid = syntaxDiags('hanasql', 'SELECT "BROKEN FROM DUMMY;');
  assert.ok(qid.some((d) => d.ruleId === 'HANA-SYN-001'));

  // Unmatched & unclosed delimiters inside -- hanasql-format off regions MUST still be checked
  const formatOffErr = syntaxDiags(
    'hanasql',
    '-- hanasql-format off\nSELECT (1 + 2 FROM DUMMY;\n-- hanasql-format on\n'
  );
  assert.ok(formatOffErr.some((d) => d.ruleId === 'HANA-SYN-003'));

  const mismatch = syntaxDiags('hanasql', 'SELECT ([1] ) FROM DUMMY;');
  assert.deepEqual(mismatch, []);
  const badMatch = syntaxDiags('hanasql', 'SELECT ([1)] FROM DUMMY;');
  assert.ok(badMatch.some((d) => d.ruleId === 'HANA-SYN-003'));

  // CDS raw expression bracket `![...]`
  const cdsErr = syntaxDiags('hdbcds', "context M { entity E { x : Integer = ![1 + 2; }; };");
  assert.ok(cdsErr.some((d) => d.ruleId === 'HANA-SYN-001'));

  // `.hdbmigrationtable` isolates syntax errors per `== version` section
  const migValid = syntaxDiags(
    'hdbmigrationtable',
    '== version=1\nCOLUMN TABLE "T" ("ID" INTEGER)\n== migration=2\nALTER TABLE "T" ADD ("NAME" NVARCHAR(50));\n'
  );
  assert.deepEqual(migValid, []);

  const migErr = syntaxDiags(
    'hdbmigrationtable',
    '== version=1\nCOLUMN TABLE "T" ("ID" INTEGER)\n== migration=2\nALTER TABLE "T" ADD ("NAME" NVARCHAR(50);\n'
  );
  assert.ok(migErr.some((d) => d.ruleId === 'HANA-SYN-003'));
});

test('HANA-SYN-010 & HANA-SYN-011: JSON/JSONC parser diagnostics, QuickFix & recovery AST', () => {
  // Missing colon
  const noColon = syntaxDiags('xsaccess', '{ "exposed" true }');
  assert.ok(noColon.some((d) => d.ruleId === 'HANA-SYN-010' && /colon|':'/i.test(d.message)));

  // Missing comma in standard JSON
  const noComma = syntaxDiags('xsaccess', '{\n  "exposed": true\n  "prevent_xsrf": true\n}');
  assert.ok(noComma.some((d) => d.ruleId === 'HANA-SYN-010' && /comma|','/i.test(d.message)));

  // Documented `.xssqlcc` missing comma tolerance + `.xsapp` empty marker tolerance
  assert.deepEqual(syntaxDiags('xssqlcc', '{\n  "description": "Admin"\n  "role_for_auto_user": "ADMIN"\n}'), []);
  assert.deepEqual(syntaxDiags('xsapp', ''), []);
  assert.deepEqual(syntaxDiags('xsapp', '   '), []);

  // JSONC comments allowed cleanly, unclosed `/*` flagged
  assert.deepEqual(syntaxDiags('hdiconfig', '{\n  // valid comment\n  "file_suffixes": { /* ok */ }\n}'), []);
  const jsonUnclosedCmt = syntaxDiags('hdiconfig', '{ "a": 1 /* oops }');
  assert.ok(jsonUnclosedCmt.some((d) => d.ruleId === 'HANA-SYN-010'));

  // Unquoted key, single quotes, unclosed string, trailing tokens, unclosed brace
  assert.ok(syntaxDiags('hdbgrants', '{ object_owner: {} }').some((d) => d.ruleId === 'HANA-SYN-010'));
  assert.ok(syntaxDiags('xsaccess', "{ 'exposed': true }").some((d) => d.ruleId === 'HANA-SYN-010'));
  assert.ok(syntaxDiags('xsaccess', '{ "exposed": "oops\n}').some((d) => d.ruleId === 'HANA-SYN-010'));
  assert.ok(syntaxDiags('xsaccess', '{ "exposed": true } garbage').some((d) => d.ruleId === 'HANA-SYN-010'));
  assert.ok(syntaxDiags('xsaccess', '{ "exposed": [1, 2 }').some((d) => d.ruleId === 'HANA-SYN-010'));

  // HANA-SYN-011 Trailing comma + QuickFix roundtrip + downstream security recovery on `.xsaccess`
  const badXsaccess = '{\n  "exposed": true,\n  "authentication": null,\n}';
  const allDiags = analyzeDocument({ languageId: 'xsaccess', text: badXsaccess });
  const trailing = allDiags.find((d) => d.ruleId === 'HANA-SYN-011');
  assert.ok(trailing, 'Expected HANA-SYN-011 for trailing comma');
  assert.equal(trailing.fixes.length, 1);
  // Downstream HANA-SEC-020 still fires via recovery AST!
  assert.ok(allDiags.some((d) => d.ruleId === 'HANA-SEC-020'), 'Recovery AST must preserve downstream security rules');

  const fixed = applyTextEdits(badXsaccess, trailing.fixes[0].edits);
  assert.deepEqual(syntaxDiags('xsaccess', fixed), []);

  // HDI JSON `.hdbrole` vs Classic `.hdbrole`
  const badHdiRole = '{ "role": { "name": "R", } }';
  assert.ok(syntaxDiags('hdbrole', badHdiRole).some((d) => d.ruleId === 'HANA-SYN-011'));
  const parsed = parseJsonAstWithErrors(badHdiRole);
  assert.ok(parsed.ast !== null && parsed.ast.kind === 'object');
});

test('HANA-SYN-020: SQLScript compound blocks, CASE..END, IF EXISTS & loops', () => {
  // Valid complex procedure with CASE..END, DECLARE EXIT HANDLER FOR, FOR IN DO..END FOR, IF EXISTS
  const validProc = [
    'CREATE PROCEDURE "DEMO_PROC" (IN p_id INT) AS',
    'BEGIN',
    '  DECLARE EXIT HANDLER FOR SQLEXCEPTION SELECT ::SQL_ERROR_CODE FROM DUMMY;',
    '  DROP TABLE IF EXISTS #TMP;',
    '  IF :p_id > 0 THEN',
    '    SELECT SUM(CASE WHEN A = 1 THEN 1 ELSE 0 END) FROM DUMMY;',
    '  ELSEIF :p_id = 0 THEN',
    '    SELECT CASE WHEN A = 1 THEN \'x\' ELSE \'y\' END FROM DUMMY;',
    '  ELSE',
    '    FOR i IN 1 .. 3 DO',
    '      WHILE :i < 2 DO',
    '        SELECT :i FROM DUMMY;',
    '      END WHILE;',
    '    END FOR;',
    '  END IF;',
    'END;',
  ].join('\n');
  assert.deepEqual(syntaxDiags('hdbprocedure', validProc), []);

  // Valid LANGUAGE R procedure body skipped safely
  assert.deepEqual(
    syntaxDiags('hdbprocedure', 'PROCEDURE "R_PROC" (OUT res "T") LANGUAGE R READS SQL DATA AS\nBEGIN\n  res <- data.frame(x = \'a)\')\nEND'),
    []
  );

  // Unclosed BEGIN
  const unclosedBegin = syntaxDiags('hanasql', 'CREATE PROCEDURE P() AS BEGIN SELECT 1 FROM DUMMY;');
  assert.ok(unclosedBegin.some((d) => d.ruleId === 'HANA-SYN-020'));

  // Missing END IF before END
  const unclosedIf = syntaxDiags('hanasql', 'CREATE PROCEDURE P() AS BEGIN\n  IF 1 = 1 THEN SELECT 1 FROM DUMMY;\nEND;');
  assert.ok(unclosedIf.some((d) => d.ruleId === 'HANA-SYN-020' && d.message.includes('END IF')));

  // Stray END
  const strayEnd = syntaxDiags('hanasql', 'SELECT 1 FROM DUMMY; END;');
  assert.ok(strayEnd.some((d) => d.ruleId === 'HANA-SYN-020'));

  // Mismatched END FOR vs END WHILE
  const mismatchLoop = syntaxDiags('hdbprocedure', 'PROCEDURE P() AS BEGIN\n  FOR i IN 1..3 DO\n    SELECT :i FROM DUMMY;\n  END WHILE;\nEND');
  assert.ok(mismatchLoop.some((d) => d.ruleId === 'HANA-SYN-020'));
});

test('HANA-SYN-021 & HANA-SYN-022: anchored header keyword typos, QuickFixes & Classic KV', () => {
  // User's exact scenario: `CREATE FUNC` / root `FUNC` in `.hdbfunction`
  const badCreateFunc = 'CREATE FUNC "MY_FN"() RETURNS INT AS BEGIN RETURN 1; END;';
  const diags1 = syntaxDiags('hanasql', badCreateFunc);
  const f1 = diags1.find((d) => d.ruleId === 'HANA-SYN-021');
  assert.ok(f1);
  assert.equal(f1.fixes[0]?.edits[0]?.newText, 'FUNCTION');
  assert.deepEqual(syntaxDiags('hanasql', applyTextEdits(badCreateFunc, f1.fixes[0].edits)), []);

  // Headerless HDI root typo
  const badHdiFn = 'FUNC "MY_FN"() RETURNS INT AS BEGIN RETURN 1; END';
  const diags2 = syntaxDiags('hdbfunction', badHdiFn);
  const f2 = diags2.find((d) => d.ruleId === 'HANA-SYN-021');
  assert.ok(f2 && f2.fixes[0]?.edits[0]?.newText === 'FUNCTION');

  // Column typo under CREATE / HDI table
  assert.ok(syntaxDiags('hdbtable', 'COLUM TABLE "T" ("ID" INT)').some((d) => d.ruleId === 'HANA-SYN-021'));
  assert.ok(syntaxDiags('hanasql', 'CREATE OR REPLACE PROCEDUR P() AS BEGIN SELECT 1 FROM DUMMY; END;').some((d) => d.ruleId === 'HANA-SYN-021'));

  // CDS anchored declaration typo + QuickFix
  const badCds = 'namespace demo;\nentiy Customer {\n  key ID : Integer;\n};';
  const cdsDiags = syntaxDiags('hdbdd', badCds);
  const fCds = cdsDiags.find((d) => d.ruleId === 'HANA-SYN-021');
  assert.ok(fCds && fCds.fixes[0]?.edits[0]?.newText === 'entity');
  assert.deepEqual(syntaxDiags('hdbdd', applyTextEdits(badCds, fCds.fixes[0].edits)), []);

  // Classic `.hdbrole` typo
  assert.ok(syntaxDiags('hdbrole', 'rol demo::MyRole { }').some((d) => d.ruleId === 'HANA-SYN-021'));

  // NEGATIVE GUARDS: domain column/field/var names NEVER false-positive!
  assert.deepEqual(syntaxDiags('hanasql', 'SELECT FUNC, PROC, TABEL, ENTIY FROM MY_TABLE;'), []);
  assert.deepEqual(
    syntaxDiags('hanasql', 'CREATE PROCEDURE P() AS BEGIN DECLARE retern INT := 1; retern := :retern + 1; END;'),
    []
  );
  assert.deepEqual(syntaxDiags('hdbdd', 'namespace demo;\nentity E {\n  key entiy : String(10);\n};'), []);

  // Classic KV missing `=` and missing RHS value (`HANA-SYN-022`)
  assert.ok(
    syntaxDiags('hdbtable', 'table.schemaName = "S";\ntable.columns = [{ name = "ID"; sqlType INTEGER; }];').some(
      (d) => d.ruleId === 'HANA-SYN-022'
    )
  );
  assert.ok(
    syntaxDiags('hdbtable', 'table.schemaName "S";\ntable.tableType = COLUMNSTORE;').some((d) => d.ruleId === 'HANA-SYN-022')
  );
  assert.ok(syntaxDiags('hdbview', 'schema = ;\nquery = "SELECT 1 FROM DUMMY";').some((d) => d.ruleId === 'HANA-SYN-022'));

  // Valid Classic KV tolerances: missing final `;` in `.hdbview`, `.hdbti` colon keys, comma lists
  assert.deepEqual(
    syntaxDiags('hdbview', 'schema="S";\ndepends_on="S.A","S.B";\nquery="SELECT 1 FROM DUMMY";\npublic=false'),
    []
  );
  assert.deepEqual(
    syntaxDiags('hdbti', 'import = [{ table = "T"; schema = "S"; file = "p:f.csv"; keys = ["K":"V"]; }];'),
    []
  );
});

test('HANA-SYN-030..032: XSJS / XSJSLIB regex-aware lexical, delimiter & keyword typo rules', () => {
  // Unterminated string / template / interpolation / block comment / regex literal
  assert.ok(syntaxDiags('xsjs', 'var s = "hello\n$.response.setBody(s);').some((d) => d.ruleId === 'HANA-SYN-030'));
  assert.ok(syntaxDiags('xsjs', 'var t = `unclosed ${1 + 2};').some((d) => d.ruleId === 'HANA-SYN-030'));
  assert.ok(syntaxDiags('xsjs', 'var r = /[a-z\n;').some((d) => d.ruleId === 'HANA-SYN-030'));
  assert.ok(syntaxDiags('xsjslib', '/* unclosed').some((d) => d.ruleId === 'HANA-SYN-030'));

  // Unmatched & unclosed delimiters + `${...`
  assert.ok(syntaxDiags('xsjs', 'function f() { return [1, 2); }').some((d) => d.ruleId === 'HANA-SYN-031'));
  assert.ok(syntaxDiags('xsjs', 'function f() { return 1;').some((d) => d.ruleId === 'HANA-SYN-031'));
  assert.ok(syntaxDiags('xsjs', 'var t = `x ${a + (1}`;').some((d) => d.ruleId === 'HANA-SYN-031'));

  // Anchored JS keyword typos + QuickFix roundtrip
  const badXsjs = 'FUNC handleRequest(req) {\n  whlie (req.x) {\n    retern $.net.http.OK;\n  }\n}';
  const xsjsDiags = syntaxDiags('xsjs', badXsjs);
  const funcErr = xsjsDiags.find((d) => d.ruleId === 'HANA-SYN-032' && d.message.includes('FUNC'));
  assert.ok(funcErr && funcErr.fixes[0]?.edits[0]?.newText === 'function');
  assert.ok(xsjsDiags.some((d) => d.ruleId === 'HANA-SYN-032' && d.message.includes('whlie')));
  assert.ok(xsjsDiags.some((d) => d.ruleId === 'HANA-SYN-032' && d.message.includes('retern')));

  // Negative checks: regex char classes containing `'"{}[]/`, division, nested templates, `var func`, postfix ops
  const cleanXsjs = [
    'var func = 1;',
    'var ratio = (a + b) / 2;',
    'var clean = text.replace(/["\'{}\\[\\]/]/g, "");',
    'var nested = `outer ${`inner ${ratio}`}`;',
    'if (ratio > 0) /ok/.test(clean);',
    'function whlie(x) { return x; }',
    'whlie(ratio);',
    'var retern = [1, 2];',
    'retern[0]++;',
    'for (var i = 0; i < retern.length; i++) { ratio += retern[i]; }',
  ].join('\n');
  assert.deepEqual(syntaxDiags('xsjs', cleanXsjs), []);

  // HANA-SYN-033: XSJS missing comma in array & argument list + QuickFix roundtrip
  const badXsjsComma = 'var x = [1 2];\nvar y = JSON.stringify(a b);';
  const xsjsCommaDiags = syntaxDiags('xsjs', badXsjsComma).filter((d) => d.ruleId === 'HANA-SYN-033');
  assert.equal(xsjsCommaDiags.length, 2);
  const fixedXsjsComma = applyTextEdits(
    badXsjsComma,
    xsjsCommaDiags.flatMap((d) => d.fixes[0].edits)
  );
  assert.deepEqual(syntaxDiags('xsjs', fixedXsjsComma), []);
});

test('HANA-SYN-001 & HANA-SYN-023: real test.hdbfunction quote localization, missing commas & SQL edge cases', () => {
  const fnSample = fs.readFileSync(path.join(ROOT, 'samples', 'test.hdbfunction'), 'utf8');
  assert.deepEqual(syntaxDiags('hdbfunction', fnSample), []);

  const lineOfOffset = (src: string, offset: number): number =>
    src.slice(0, offset).split('\n').length;
  const lineOfSnippet = (src: string, snippet: string): number => {
    const idx = src.indexOf(snippet);
    assert.ok(idx >= 0, `Snippet not found in fixture: ${snippet}`);
    return lineOfOffset(src, idx);
  };

  // Missing closing quote on `"NAME"` highlights `"NAME` on its own line, NOT downstream `"IS_ACTIVE"`
  const missingClose = fnSample.replace('"NAME" AS "ITEM_NAME"', '"NAME AS "ITEM_NAME"');
  const closeDiags = syntaxDiags('hdbfunction', missingClose).filter((d) => d.ruleId === 'HANA-SYN-001');
  assert.equal(closeDiags.length, 1);
  assert.equal(lineOfOffset(missingClose, closeDiags[0].start), lineOfSnippet(missingClose, '"NAME AS'));
  assert.ok(closeDiags[0].start < missingClose.indexOf('"IS_ACTIVE"'));

  // Missing opening quote on `"NAME"` highlights `NAME"` on its own line, NOT `"IS_ACTIVE"`
  const missingOpen = fnSample.replace('"NAME" AS "ITEM_NAME"', 'NAME" AS "ITEM_NAME"');
  const openDiags = syntaxDiags('hdbfunction', missingOpen).filter((d) => d.ruleId === 'HANA-SYN-001');
  assert.equal(openDiags.length, 1);
  assert.equal(lineOfOffset(missingOpen, openDiags[0].start), lineOfSnippet(missingOpen, 'NAME" AS'));
  assert.equal(missingOpen.slice(openDiags[0].start, openDiags[0].end), 'NAME"');
  assert.match(openDiags[0].message, /missing opening/i);

  // Missing opening/closing quote in WHERE stays on WHERE line without swallowing `"IS_ACTIVE"`
  const brokenWhere = fnSample.replace('WHERE "PRICE"', 'WHERE "PRICE');
  const whereDiags = syntaxDiags('hdbfunction', brokenWhere).filter((d) => d.ruleId === 'HANA-SYN-001');
  assert.equal(whereDiags.length, 1);
  assert.equal(lineOfOffset(brokenWhere, whereDiags[0].start), lineOfSnippet(brokenWhere, 'WHERE "PRICE'));

  // Missing commas across parameters, DECIMAL args, RETURNS TABLE columns, and SELECT list + QuickFix roundtrip
  const commaMutations = [
    fnSample.replace('DECIMAL(3, 2),', 'DECIMAL(3, 2)'),
    fnSample.replace('DECIMAL(3, 2)', 'DECIMAL(3 2)'),
    fnSample.replace('"ITEM_NAME" NVARCHAR(100),', '"ITEM_NAME" NVARCHAR(100)'),
    fnSample.replace('"NAME" AS "ITEM_NAME",', '"NAME" AS "ITEM_NAME"'),
  ];
  for (const mutated of commaMutations) {
    const diags = syntaxDiags('hdbfunction', mutated);
    const commaErr = diags.find((d) => d.ruleId === 'HANA-SYN-023');
    assert.ok(commaErr, `Expected HANA-SYN-023 for mutation:\n${mutated}`);
    assert.equal(commaErr.fixes[0]?.title, "Insert ','");
    const fixed = applyTextEdits(mutated, commaErr.fixes[0].edits);
    assert.deepEqual(syntaxDiags('hdbfunction', fixed), []);
  }

  // Positive missing commas in SELECT, VALUES, INSERT, and Classic KV arrays
  assert.ok(syntaxDiags('hanasql', 'SELECT "NAME"\n "PRICE" * 1.1 FROM T;').some((d) => d.ruleId === 'HANA-SYN-023'));
  assert.ok(syntaxDiags('hanasql', 'SELECT "NAME" "A" "PRICE" FROM T;').some((d) => d.ruleId === 'HANA-SYN-023'));
  assert.ok(syntaxDiags('hanasql', 'INSERT INTO T ("A" "B") VALUES (1 2);').some((d) => d.ruleId === 'HANA-SYN-023'));
  const kvBadArr = 'table.schemaName = "S";\ntable.columns = [{ name = "A"; sqlType = INTEGER; }];\ntable.primaryKey.pkcolumns = ["A" "B"];';
  const kvComma = syntaxDiags('hdbtable', kvBadArr).find((d) => d.ruleId === 'HANA-SYN-023');
  assert.ok(kvComma);
  assert.deepEqual(syntaxDiags('hdbtable', applyTextEdits(kvBadArr, kvComma.fixes[0].edits)), []);

  // Negative SQL guards: implicit alias, typed literals, window functions, WITHIN GROUP, ARRAY subscripts
  const validComplexSql = [
    'SELECT "NAME" "ITEM_ALIAS", DATE \'2025-01-01\',',
    '  SUM("AMOUNT") OVER (PARTITION BY "DEPT" ORDER BY "ID" DESC),',
    '  STRING_AGG("NAME", \',\' ORDER BY "NAME") WITHIN GROUP (ORDER BY "NAME")',
    'FROM "T" WHERE "ARR"[1] = 1;',
  ].join('\n');
  assert.deepEqual(syntaxDiags('hanasql', validComplexSql), []);

  // Review fixes: JSON missing value before next property + CDS typo after `@Catalog.index: [...]`
  const missingJsonVal = '{\n  "exposed":\n  "authentication": []\n}';
  assert.ok(
    syntaxDiags('xsaccess', missingJsonVal).some(
      (d) => d.ruleId === 'HANA-SYN-010' && /expected property value/i.test(d.message)
    )
  );
  const jsonRecovery = parseJsonAstWithErrors(missingJsonVal);
  assert.ok(
    jsonRecovery.ast?.kind === 'object' &&
      jsonRecovery.ast.properties.some((p) => p.key === 'authentication')
  );

  const cdsAfterBracketAnnot = 'namespace demo;\n@Catalog.index: [{ name: \'I\', unique: true }]\nentiy Orders { key ID : Integer; };';
  const cdsTypos = syntaxDiags('hdbdd', cdsAfterBracketAnnot).filter((d) => d.ruleId === 'HANA-SYN-021');
  assert.equal(cdsTypos.length, 1);
  assert.equal(cdsTypos[0].fixes[0]?.edits[0]?.newText, 'entity');
  assert.deepEqual(syntaxDiags('hdbdd', applyTextEdits(cdsAfterBracketAnnot, cdsTypos[0].fixes[0].edits)), []);
});

test('HANA-SYN-003 / 010 / 031: nested delimiter blame localization & non-cascading recovery', () => {
  const fnSample = fs.readFileSync(path.join(ROOT, 'samples', 'test.hdbfunction'), 'utf8');
  const lineOfOffset = (src: string, offset: number): number => src.slice(0, offset).split('\n').length;
  const lineOfSnippet = (src: string, snippet: string): number => {
    const idx = src.indexOf(snippet);
    assert.ok(idx >= 0, `Snippet missing: ${snippet}`);
    return lineOfOffset(src, idx);
  };

  // 1. User's exact example: missing closing ')' in DECIMAL(3, 2 inside parameter list (...)
  const missingInnerClose = fnSample.replace('DECIMAL(3, 2)', 'DECIMAL(3, 2');
  const diags1 = syntaxDiags('hdbfunction', missingInnerClose);
  assert.equal(diags1.filter((d) => d.ruleId === 'HANA-SYN-023').length, 0, 'No cascading comma errors');
  const syn3a = diags1.filter((d) => d.ruleId === 'HANA-SYN-003');
  assert.equal(syn3a.length, 1);
  assert.equal(lineOfOffset(missingInnerClose, syn3a[0].start), lineOfSnippet(missingInnerClose, 'DECIMAL(3, 2'));

  // 2. Missing opening '(' in DECIMAL3, 2) inside parameter list (...)
  const missingInnerOpen = fnSample.replace('DECIMAL(3, 2)', 'DECIMAL3, 2)');
  const diags2 = syntaxDiags('hdbfunction', missingInnerOpen);
  assert.equal(diags2.filter((d) => d.ruleId === 'HANA-SYN-023').length, 0, 'No cascading comma errors');
  const syn3b = diags2.filter((d) => d.ruleId === 'HANA-SYN-003');
  assert.equal(syn3b.length, 1);
  assert.equal(lineOfOffset(missingInnerOpen, syn3b[0].start), lineOfSnippet(missingInnerOpen, 'DECIMAL3, 2)'));

  // 3. Same inside RETURNS TABLE (...) (`NVARCHAR(100,` and `NVARCHAR100),`)
  const missingTblClose = fnSample.replace('NVARCHAR(100)', 'NVARCHAR(100');
  const syn3c = syntaxDiags('hdbfunction', missingTblClose);
  assert.equal(syn3c.length, 1);
  assert.equal(syn3c[0].ruleId, 'HANA-SYN-003');
  assert.equal(lineOfOffset(missingTblClose, syn3c[0].start), lineOfSnippet(missingTblClose, 'NVARCHAR(100'));

  const missingTblOpen = fnSample.replace('NVARCHAR(100)', 'NVARCHAR100)');
  const syn3d = syntaxDiags('hdbfunction', missingTblOpen);
  assert.equal(syn3d.length, 1);
  assert.equal(syn3d[0].ruleId, 'HANA-SYN-003');
  assert.equal(lineOfOffset(missingTblOpen, syn3d[0].start), lineOfSnippet(missingTblOpen, 'NVARCHAR100)'));

  // 4. Single-line type precision opener (`DECIMAL(3, 2, IN b`) does not blame outer signature '('
  const singleLineTypeErr = 'FUNCTION "f" (IN a DECIMAL(3, 2, IN b DECIMAL(15, 2)) RETURNS INT AS BEGIN RETURN 1; END';
  const syn3e = syntaxDiags('hdbfunction', singleLineTypeErr).filter((d) => d.ruleId === 'HANA-SYN-003');
  assert.equal(syn3e.length, 1);
  assert.equal(syn3e[0].start, singleLineTypeErr.indexOf('DECIMAL(3') + 'DECIMAL'.length);

  // 5. SQL semicolon fences unclosed '(' in stmt 1 from unmatched ')' in stmt 2
  const fencedSql = syntaxDiags('hanasql', 'SELECT (1 + 2 FROM DUMMY;\nSELECT 3 + 4) FROM DUMMY;').filter(
    (d) => d.ruleId === 'HANA-SYN-003'
  );
  assert.equal(fencedSql.length, 2);

  // 6. Mixed bracket types: `([1, 2)` reports unclosed `'['`, while `[1, 2)` reports unexpected `')'`
  const mixedInner = syntaxDiags('hanasql', 'SELECT ([1, 2) FROM DUMMY;').filter((d) => d.ruleId === 'HANA-SYN-003');
  assert.equal(mixedInner.length, 1);
  assert.match(mixedInner[0].message, /Unclosed delimiter '\['\./);
  const directMismatch = syntaxDiags('hanasql', 'SELECT [1, 2) FROM DUMMY;').filter((d) => d.ruleId === 'HANA-SYN-003');
  assert.equal(directMismatch.length, 1);
  assert.match(directMismatch[0].message, /Expected '\]'/);

  // 7. XSJS nested braces, unmatched inner brace, and semicolon-fenced paren call
  const jsMissingInnerBrace = 'function f() {\n  if (x) {\n    return 1;\n}';
  const jsBraceDiags = syntaxDiags('xsjs', jsMissingInnerBrace).filter((d) => d.ruleId === 'HANA-SYN-031');
  assert.equal(jsBraceDiags.length, 1);
  assert.equal(lineOfOffset(jsMissingInnerBrace, jsBraceDiags[0].start), 2);

  const jsExtraInnerBrace = 'function f() {\n  if (x)\n    return 1;\n  }\n}';
  const jsExtraDiags = syntaxDiags('xsjs', jsExtraInnerBrace).filter((d) => d.ruleId === 'HANA-SYN-031');
  assert.equal(jsExtraDiags.length, 1);
  assert.equal(lineOfOffset(jsExtraInnerBrace, jsExtraDiags[0].start), 4);

  const jsCallSemi = 'function f() {\n  foo(1, 2;\n  return bar(3);\n}';
  const jsCallDiags = syntaxDiags('xsjs', jsCallSemi);
  assert.equal(jsCallDiags.filter((d) => d.ruleId === 'HANA-SYN-033').length, 0);
  const jsCallSyn = jsCallDiags.filter((d) => d.ruleId === 'HANA-SYN-031');
  assert.equal(jsCallSyn.length, 1);
  assert.equal(lineOfOffset(jsCallSemi, jsCallSyn[0].start), 2);

  // 8. JSON nested object/array missing closer or opener localizes to inner container
  const jsonInnerObj = '{\n  "object_owner": {\n    "roles": ["R1"],\n  "application_user": {\n    "roles": ["R2"]\n  }\n}';
  const jsonObjErr = syntaxDiags('hdbgrants', jsonInnerObj).filter((d) => d.ruleId === 'HANA-SYN-010');
  assert.equal(jsonObjErr.length, 1);
  assert.equal(lineOfOffset(jsonInnerObj, jsonObjErr[0].start), 2);

  const jsonInnerArr = '{\n  "m": [\n    [1, 2,\n    [3, 4]\n  ]\n}';
  const jsonArrErr = syntaxDiags('hdiconfig', jsonInnerArr).filter((d) => d.ruleId === 'HANA-SYN-010');
  assert.equal(jsonArrErr.length, 1);
  assert.equal(lineOfOffset(jsonInnerArr, jsonArrErr[0].start), 3);

  const jsonExtraArrClose = '{\n  "m": [\n    1, 2],\n    [3, 4]\n  ]\n}';
  const jsonArrExtra = syntaxDiags('hdiconfig', jsonExtraArrClose).filter((d) => d.ruleId === 'HANA-SYN-010');
  assert.equal(jsonArrExtra.length, 1);
  assert.equal(lineOfOffset(jsonExtraArrClose, jsonArrExtra[0].start), 3);
});

test('Options & suppressions control HANA-SYN-* independently of semantics', () => {
  const brokenProc = 'CREATE FUNC "P"() AS BEGIN SELECT 1 FROM DUMMY; END;';
  // syntax: false disables HANA-SYN-* while leaving semantic diagnostics intact
  const off = analyzeDocument({
    languageId: 'hanasql',
    text: brokenProc,
    options: { ...DEFAULT_ANALYZER_OPTIONS, syntax: false },
  });
  assert.equal(
    off.filter((d) => d.category === 'syntax').length,
    0
  );

  // hanasql-analyze-disable suppresses targeted rule
  const suppressed = syntaxDiags('hanasql', '-- hanasql-analyze-disable-file HANA-SYN-021\n' + brokenProc);
  assert.deepEqual(suppressed, []);
});

test('samples/: zero syntax false positives across all repository SAP HANA artifacts', () => {
  const extToLang: Record<string, string> = {
    '.sql': 'hanasql',
    '.calculationview': 'calculationview',
  };
  const analyzerLangSet = new Set(ANALYZER_LANGUAGES);

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  };

  const sampleFiles = walk(path.join(ROOT, 'samples'));
  let checkedCount = 0;

  for (const file of sampleFiles) {
    const base = path.basename(file);
    const ext = path.extname(base).toLowerCase() || (base.startsWith('.') ? base.toLowerCase() : '');
    // Skip non-language docs/data or CGUL rule files
    if (!ext || ext === '.md' || ext === '.csv' || ext.startsWith('.hdbtext')) continue;
    const rawLang = extToLang[ext] ?? ext.slice(1);
    if (!analyzerLangSet.has(rawLang)) continue;
    // Skip intentional format-demo files only if they have intentional syntax bugs? No, all samples should be syntactically valid!
    const text = fs.readFileSync(file, 'utf8');
    const diags = syntaxDiags(rawLang, text).filter((d) => d.category === 'syntax');
    assert.deepEqual(
      diags,
      [],
      `Expected zero syntax errors in sample ${path.relative(ROOT, file)} (${rawLang}), got: ${JSON.stringify(diags)}`
    );
    checkedCount++;
  }

  assert.ok(checkedCount >= 20, `Expected to scan >= 20 sample files, scanned ${checkedCount}`);
});
