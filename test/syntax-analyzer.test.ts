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

function lineOfOffset(src: string, offset: number): number {
  return src.slice(0, offset).split('\n').length;
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
  assert.deepEqual(syntaxDiags('hanasql', validProc), []);
  const validHdiProc = validProc.replace(/^CREATE /, '').replace(/END;$/, 'END');
  assert.deepEqual(syntaxDiags('hdbprocedure', validHdiProc), []);

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
  const badCreateFunc = 'CREATE FUNC "MY_FN"() RETURNS x INT AS BEGIN x = 1; END;';
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

test('HANA-SYN-024: SQL missing, dangling, duplicate operators, trailing commas & negative checks', () => {
  const baseFn = fs.readFileSync(path.join(ROOT, 'samples', 'test.hdbfunction'), 'utf8');
  assert.deepEqual(syntaxDiags('hdbfunction', baseFn), []);

  // 1. Removing `*` on line 18: `"PRICE" (1.0 + :im_tax_rate)`
  const missingMul = baseFn.replace('"PRICE" * (1.0 + :im_tax_rate)', '"PRICE" (1.0 + :im_tax_rate)');
  const mulDiags = syntaxDiags('hdbfunction', missingMul);
  assert.equal(mulDiags.filter((d) => d.ruleId === 'HANA-SYN-024').length, 1);
  assert.equal(lineOfOffset(missingMul, mulDiags[0].start), 18);

  // 2. Removing `+` inside `(1.0 + :im_tax_rate)` on line 18
  const missingPlus = baseFn.replace('(1.0 + :im_tax_rate)', '(1.0 :im_tax_rate)');
  const plusDiags = syntaxDiags('hdbfunction', missingPlus);
  assert.ok(plusDiags.some((d) => d.ruleId === 'HANA-SYN-024' && lineOfOffset(missingPlus, d.start) === 18));

  // 3. Removing `>=` on line 20: `WHERE "PRICE" :im_min_price`
  const missingGte = baseFn.replace('WHERE "PRICE" >= :im_min_price', 'WHERE "PRICE" :im_min_price');
  const gteDiags = syntaxDiags('hdbfunction', missingGte);
  assert.ok(gteDiags.some((d) => d.ruleId === 'HANA-SYN-024' && lineOfOffset(missingGte, d.start) === 20));

  // 4. Removing `=` on line 21: `AND "IS_ACTIVE" TRUE;`
  const missingEq = baseFn.replace('AND "IS_ACTIVE" = TRUE;', 'AND "IS_ACTIVE" TRUE;');
  const eqDiags = syntaxDiags('hdbfunction', missingEq);
  assert.ok(eqDiags.some((d) => d.ruleId === 'HANA-SYN-024' && lineOfOffset(missingEq, d.start) === 21));

  // 5. Removing `AND` between lines 20-21: `WHERE "PRICE" >= :im_min_price\n "IS_ACTIVE" = TRUE;`
  const missingAnd = baseFn.replace('AND "IS_ACTIVE" = TRUE;', '    "IS_ACTIVE" = TRUE;');
  const andDiags = syntaxDiags('hdbfunction', missingAnd);
  assert.ok(andDiags.some((d) => d.ruleId === 'HANA-SYN-024' && lineOfOffset(missingAnd, d.start) === 21));

  // 6. Dangling binary operators (`* AS`, `>= AND`, `>= =`, `(1.0 + )`)
  const danglingMul = baseFn.replace('"PRICE" * (1.0 + :im_tax_rate) AS', '"PRICE" * AS');
  assert.ok(syntaxDiags('hdbfunction', danglingMul).some((d) => d.ruleId === 'HANA-SYN-024'));

  const danglingGte = baseFn.replace('WHERE "PRICE" >= :im_min_price', 'WHERE "PRICE" >=');
  assert.ok(syntaxDiags('hdbfunction', danglingGte).some((d) => d.ruleId === 'HANA-SYN-024'));

  const dupOp = baseFn.replace('WHERE "PRICE" >= :im_min_price', 'WHERE "PRICE" >= = :im_min_price');
  assert.ok(syntaxDiags('hdbfunction', dupOp).some((d) => d.ruleId === 'HANA-SYN-024'));

  const trailingParenOp = 'SELECT (1.0 + ) FROM DUMMY;';
  assert.ok(syntaxDiags('hanasql', trailingParenOp).some((d) => d.ruleId === 'HANA-SYN-024'));

  // 7. Trailing commas + QuickFix removal
  const trailingDecimal = 'FUNCTION "f" (IN im_tax_rate DECIMAL(3, 2,)) RETURNS INT AS BEGIN RETURN 1; END;';
  const decDiags = syntaxDiags('hanasql', trailingDecimal).filter((d) => d.ruleId === 'HANA-SYN-024');
  assert.equal(decDiags.length, 1);
  assert.equal(applyTextEdits(trailingDecimal, decDiags[0].fixes[0].edits), 'FUNCTION "f" (IN im_tax_rate DECIMAL(3, 2)) RETURNS INT AS BEGIN RETURN 1; END;');

  const trailingSelect = 'SELECT "NAME", FROM "T";';
  const selCommaDiags = syntaxDiags('hanasql', trailingSelect).filter((d) => d.ruleId === 'HANA-SYN-024');
  assert.equal(selCommaDiags.length, 1);
  assert.equal(applyTextEdits(trailingSelect, selCommaDiags[0].fixes[0].edits), 'SELECT "NAME" FROM "T";');

  // 8. Negative tests: valid SQL expressions & multi-word predicates must produce ZERO errors
  const validComplexSql = [
    'SELECT',
    '  *,',
    '  COUNT(*),',
    '  "SCHEMA"."MY_UDF"(1.0 + :im_a),',
    '  "pkg::my_udf"(2, 3),',
    '  CASE WHEN "A" IS NOT NULL AND "B" NOT BETWEEN 1 AND 10 THEN DATE \'2025-01-01\' ELSE TIMESTAMP \'2025-01-01 00:00:00\' END AS "C",',
    '  INTERVAL \'5\' DAY,',
    '  CAST("A" AS NVARCHAR(50))',
    'FROM "T1" t1',
    'INNER JOIN "T2" t2 ON t1."ID" = t2."ID"',
    'WHERE t1."STATUS" NOT IN (\'X\', \'Y\')',
    '  AND t1."NAME" LIKE \'%foo%\' ESCAPE \'\\\'',
    '  AND t1."FLAG" IS NOT DISTINCT FROM t2."FLAG"',
    '  AND t1."NEG" = -1',
    '  AND ROUND((1.0 + :im_tax_rate), 2) > 0;',
  ].join('\n');
  assert.deepEqual(syntaxDiags('hanasql', validComplexSql), []);
});

test('HANA-SYN-021 & HANA-SYN-025: SQL signature/clause typos, incomplete clauses & missing semicolons', () => {
  // 1. Routine signature typos (`RETUNS`, `LANUAGE`, `SECURTY`, `INVOKR`)
  const badRetuns = 'FUNCTION "f" (IN a INT) RETUNS TABLE ("A" INT) LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS BEGIN RETURN SELECT 1 FROM DUMMY; END;';
  const dRet = syntaxDiags('hanasql', badRetuns).filter((d) => d.ruleId === 'HANA-SYN-021');
  assert.equal(dRet.length, 1);
  assert.ok(applyTextEdits(badRetuns, dRet[0].fixes[0].edits).includes('RETURNS TABLE'));

  const badHdr = 'FUNCTION "f" (IN a INT) RETURNS INT LANUAGE SQLSCRIPT SQL SECURTY INVOKR AS BEGIN RETURN 1; END;';
  const dHdr = syntaxDiags('hanasql', badHdr).filter((d) => d.ruleId === 'HANA-SYN-021');
  assert.equal(dHdr.length, 3);

  // 2. Query clause typos (`SELCT`, `WHRE`, `GROP BY`, `ORDR BY`, `LIMT`)
  const badSelct = 'SELCT "A" FROM "T";';
  const dSel = syntaxDiags('hanasql', badSelct).filter((d) => d.ruleId === 'HANA-SYN-021');
  assert.equal(dSel.length, 1);
  assert.equal(applyTextEdits(badSelct, dSel[0].fixes[0].edits), 'SELECT "A" FROM "T";');

  const badClauses = [
    'SELECT "A", COUNT(*) AS "CNT"',
    'FROM "T"',
    'WHRE "PRICE" >= 10',
    'GROP BY "A"',
    'ORDR BY "CNT" DESC',
    'LIMT 10;',
  ].join('\n');
  const dCls = syntaxDiags('hanasql', badClauses).filter((d) => d.ruleId === 'HANA-SYN-021');
  assert.equal(dCls.length, 4);

  // Guard: column names / variables / calls named like typos are NOT flagged
  assert.deepEqual(syntaxDiags('hanasql', 'SELECT whre, gropp, limt FROM "T" t WHERE t.whre = 1;'), []);

  // 3. Incomplete SQL clauses (`SELECT FROM`, `WHERE AND`)
  assert.ok(syntaxDiags('hanasql', 'SELECT FROM "T";').some((d) => d.ruleId === 'HANA-SYN-025'));
  assert.ok(syntaxDiags('hanasql', 'SELECT "A" FROM "T" WHERE AND "B" = 1;').some((d) => d.ruleId === 'HANA-SYN-025'));
  assert.ok(syntaxDiags('hanasql', 'SELECT "A" FROM WHERE "B" = 1;').some((d) => d.ruleId === 'HANA-SYN-025'));

  // 4. Missing `;` between SQLScript statements in `BEGIN ... END` + QuickFix
  const missingSemiBody = [
    'PROCEDURE "P" () LANGUAGE SQLSCRIPT AS',
    'BEGIN',
    '    DECLARE x INT := 1',
    '    x := :x + 1',
    '    RETURN;',
    'END;',
  ].join('\n');
  const semiDiags = syntaxDiags('hdbprocedure', missingSemiBody).filter((d) => d.ruleId === 'HANA-SYN-025');
  assert.equal(semiDiags.length, 2);
  assert.equal(semiDiags[0].fixes[0].title, "Insert ';'");

  // Missing `;` before `END;` inside `BEGIN ... END`
  const baseFn = fs.readFileSync(path.join(ROOT, 'samples', 'test.hdbfunction'), 'utf8');
  const missingEndSemi = baseFn.replace('AND "IS_ACTIVE" = TRUE;', 'AND "IS_ACTIVE" = TRUE');
  const endSemiDiags = syntaxDiags('hdbfunction', missingEndSemi).filter((d) => d.ruleId === 'HANA-SYN-025');
  assert.equal(endSemiDiags.length, 1);
  assert.equal(applyTextEdits(missingEndSemi, endSemiDiags[0].fixes[0].edits), baseFn);
});

test('HANA-SYN-026: CDS (.hdbdd / .hdbcds) missing colon, type, and semicolons', () => {
  // Missing `;` on `namespace` / `using`
  const cdsHeader = 'namespace demo.app\nusing demo.common::Types as T\nentity Order { key id : Integer; };';
  const hdrDiags = syntaxDiags('hdbdd', cdsHeader).filter((d) => d.ruleId === 'HANA-SYN-026');
  assert.equal(hdrDiags.length, 2);

  // Missing `:` and missing `;` and missing type in entity body
  const cdsEntity = [
    'namespace demo.app;',
    'entity Order {',
    '    key id Integer;',
    '    title : ;',
    '    price : Decimal(15, 2)',
    '    status : String(10);',
    '};',
  ].join('\n');
  const entDiags = syntaxDiags('hdbdd', cdsEntity).filter((d) => d.ruleId === 'HANA-SYN-026');
  assert.equal(entDiags.length, 3);
  assert.equal(lineOfOffset(cdsEntity, entDiags[0].start), 3);
  assert.equal(lineOfOffset(cdsEntity, entDiags[1].start), 4);
  assert.equal(lineOfOffset(cdsEntity, entDiags[2].start), 6);

  // Valid enum type, structured type, technical configuration & AccessPolicy pass cleanly
  const validCds = [
    'namespace demo.hdi;',
    'context M {',
    '  type ItemState : String(10) { draft = \'D\'; active = \'A\'; };',
    '  type Addr { street : String(80); zip : Integer; };',
    '  entity E {',
    '    @Comment: \'PK\'',
    '    key id : Integer;',
    '    addr : Addr;',
    '  } technical configuration {',
    '    column store;',
    '  };',
    '  AccessPolicy P { grant select on E where id > 0; };',
    '};',
  ].join('\n');
  assert.deepEqual(syntaxDiags('hdbcds', validCds), []);
});

test('HANA-SYN-034: XSJS missing, dangling, and consecutive operators & negative checks', () => {
  const xsMissingMul = 'var total = price tax;';
  assert.ok(syntaxDiags('xsjs', xsMissingMul).some((d) => d.ruleId === 'HANA-SYN-034'));

  const xsCondMissing = 'if (price minPrice) { $.response.status = $.net.http.OK; }';
  assert.ok(syntaxDiags('xsjs', xsCondMissing).some((d) => d.ruleId === 'HANA-SYN-034'));

  const xsDanglingOp = 'var total = price * ;\nif (price >= ) {}';
  assert.equal(syntaxDiags('xsjs', xsDanglingOp).filter((d) => d.ruleId === 'HANA-SYN-034').length, 2);

  const xsDupOp = 'if (price >= = minPrice) {}';
  assert.equal(syntaxDiags('xsjs', xsDupOp).filter((d) => d.ruleId === 'HANA-SYN-034').length, 1);

  // Negative checks: strict equality `===` / `!==`, regexes, methods, ASI across lines
  const validJs = [
    'function calc(price, tax) {',
    '  var ok = price === tax && price !== 0;',
    '  var matched = /abc/.test("abc");',
    '  var a = price',
    '  var b = tax;',
    '  return { get val() { return a + b; }, matched: matched, ok: ok };',
    '}',
  ].join('\n');
  assert.deepEqual(syntaxDiags('xsjs', validJs), []);
});

test('HANA-SYN-027: SELECT query clause ordering, duplicate clauses & negative checks', () => {
  const syn27 = (lang: string, code: string) =>
    syntaxDiags(lang, code).filter((d) => d.ruleId === 'HANA-SYN-027');

  // 1. Out-of-order clauses
  const whereBeforeFrom = syn27('hanasql', 'SELECT "A" WHERE "A" = 1 FROM "T";');
  assert.equal(whereBeforeFrom.length, 1);
  assert.match(whereBeforeFrom[0].message, /after 'FROM'/);

  assert.equal(syn27('hanasql', 'SELECT "A" FROM "T" ORDER BY "A" WHERE "B" = 1;').length, 1);
  assert.equal(syn27('hanasql', 'SELECT "A", COUNT(*) FROM "T" HAVING COUNT(*) > 1 GROUP BY "A";').length, 1);
  assert.equal(syn27('hanasql', 'SELECT "A" FROM "T" LIMIT 10 ORDER BY "A";').length, 1);
  assert.equal(syn27('hanasql', 'SELECT "A" FROM "T" OFFSET 5;').length, 1);
  assert.equal(syn27('hanasql', 'SELECT "A" FROM "T" INTO #TMP WHERE "A" = 1;').length, 1);

  // 2. Duplicate non-repeatable clauses
  assert.equal(syn27('hanasql', 'SELECT "A" FROM "T" WHERE "A" = 1 WHERE "B" = 2;').length, 1);
  assert.equal(syn27('hanasql', 'SELECT "A" FROM "T" ORDER BY "A" ORDER BY "B";').length, 1);
  assert.equal(syn27('hanasql', 'SELECT "A" INTO lv_a FROM "T" INTO lv_b;').length, 1);

  // 3. Unparenthesized ORDER BY before UNION & bad clause inside CTE
  assert.equal(syn27('hanasql', 'SELECT "A" FROM "T1" ORDER BY "A" UNION SELECT "A" FROM "T2";').length, 1);
  assert.equal(syn27('hanasql', 'WITH c AS (SELECT "A" WHERE "A" = 1 FROM "T") SELECT * FROM c;').length, 1);

  // 4. Negative tests: complex valid HANA queries must emit ZERO HANA-SYN-027 diagnostics
  const validQueries = [
    'WITH cte AS (SELECT "ID", "CAT", "VAL" FROM "BASE" WHERE "ACTIVE" = 1)',
    'SELECT "CAT", COUNT(*) AS "CNT", STRING_AGG("ID", \',\' ORDER BY "ID") AS "IDS",',
    '  ROW_NUMBER() OVER (PARTITION BY "CAT" ORDER BY "VAL" DESC) AS "RN",',
    '  CASE WHEN EXTRACT(YEAR FROM "CREATED_AT") >= 2024 THEN 1 ELSE 0 END AS "RECENT"',
    'FROM cte FOR SYSTEM_TIME AS OF UTCTIMESTAMP \'2025-01-01 00:00:00\'',
    'WHERE "FLAG" IS NOT DISTINCT FROM 1 AND EXISTS (SELECT 1 FROM "OTHER" o WHERE o."ID" = cte."ID")',
    'GROUP BY "CAT", "ID", "VAL", "CREATED_AT"',
    'HAVING COUNT(*) >= 1',
    'WINDOW w AS (PARTITION BY "CAT" ORDER BY "VAL")',
    'ORDER BY "CAT" ASC',
    'LIMIT 50 OFFSET 10;',
    'SELECT COUNT(*) INTO lv_cnt FROM "BASE" WHERE "ACTIVE" = 1;',
    'SELECT "A" FROM "T1" WHERE "X" = 1 UNION ALL SELECT "A" FROM "T2" WHERE "X" = 2 ORDER BY "A";',
    '(SELECT "A" FROM "T1" ORDER BY "A") UNION (SELECT "A" FROM "T2" ORDER BY "A");',
  ].join('\n');
  assert.deepEqual(syn27('hanasql', validQueries), []);
});

test('HANA-SYN-028: SQLScript routine header, USING, block declaration ordering, handler conflicts & unreachable statements', () => {
  const syn28 = (lang: string, code: string) =>
    syntaxDiags(lang, code).filter((d) => d.ruleId === 'HANA-SYN-028');

  // 1. Misplaced header clause after AS, duplicate header options, and RETURNS ordering
  assert.ok(
    syn28('hanasql', 'CREATE PROCEDURE p() AS READS SQL DATA BEGIN SELECT 1 FROM DUMMY; END;').some((d) =>
      /before 'AS'/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hanasql', 'CREATE PROCEDURE p() READS SQL DATA READS SQL DATA AS BEGIN SELECT 1 FROM DUMMY; END;').some((d) =>
      /Duplicate 'READS SQL DATA'/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hdbfunction', 'FUNCTION f(IN x INT) LANGUAGE SQLSCRIPT RETURNS INT AS BEGIN RETURN x; END;').some((d) =>
      /'RETURNS' clause must appear before/i.test(d.message)
    )
  );

  // 2. Parameter & routine header compatibility
  assert.ok(
    syn28('hdbfunction', 'FUNCTION f(OUT x INT) RETURNS INT AS BEGIN x = 1; END;').some((d) =>
      /'OUT' is not allowed in a FUNCTION header/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hanasql', 'CREATE FUNCTION f(INOUT x INT) RETURNS INT AS BEGIN RETURN; END;').some((d) =>
      /'INOUT' is not allowed in a FUNCTION header/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hanasql', 'CREATE FUNCTION f(IN x INT) AS BEGIN SELECT 1 FROM DUMMY; END;').some((d) =>
      /Missing 'RETURNS' clause/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() RETURNS INT AS BEGIN SELECT 1 FROM DUMMY; END;').some((d) =>
      /'RETURNS' clause is not allowed in a PROCEDURE header/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hdbfunction', 'FUNCTION f() RETURNS INT STRUCTURED FILTER CHECK AS BEGIN RETURN; END;').length === 0
  );
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() STRUCTURED FILTER CHECK AS BEGIN SELECT 1 FROM DUMMY; END;').some((d) =>
      /'STRUCTURED FILTER CHECK' is only supported in FUNCTION/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hdbfunction', 'FUNCTION f() RETURNS x INT LANGUAGE SQLSCRIPT READS SQL DATA AS BEGIN x = 1; END').length === 0
  );
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() READS SQL DATA AUTOCOMMIT DDL ON AS BEGIN SELECT 1 FROM DUMMY; END;').some((d) =>
      /'AUTOCOMMIT DDL' is not allowed in a 'READS SQL DATA' procedure/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() SEQUENTIAL EXECUTION AS BEGIN SELECT 1 FROM DUMMY; END;').some((d) =>
      /'SEQUENTIAL EXECUTION' must appear immediately after 'BEGIN'/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() AS BEGIN READS SQL DATA; SELECT 1 FROM DUMMY; END').some((d) =>
      /'READS SQL DATA' must appear before 'AS'/i.test(d.message)
    )
  );

  // 3. USING placement
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() USING SYS.SQLSCRIPT_STRING AS LIB; AS BEGIN SELECT 1 FROM DUMMY; END').some((d) =>
      /'USING' library declaration must appear after 'AS'/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() AS BEGIN DECLARE v INT; USING SYS.SQLSCRIPT_STRING AS LIB; v = 1; END').some((d) =>
      /'USING' declaration must appear before 'DECLARE'/i.test(d.message)
    )
  );
  assert.ok(
    syn28(
      'hdbprocedure',
      'PROCEDURE p() AS BEGIN IF 1 = 1 THEN USING SYS.SQLSCRIPT_STRING AS LIB; END IF; END'
    ).some((d) => /routine root level/i.test(d.message))
  );

  // 4. Compound block declaration / handler / modifier ordering
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() AS BEGIN SELECT 1 FROM DUMMY; DECLARE v INT; v = 1; END').some((d) =>
      /'DECLARE' must appear before executable statements/i.test(d.message)
    )
  );
  assert.ok(
    syn28(
      'hdbprocedure',
      'PROCEDURE p() AS BEGIN DECLARE EXIT HANDLER FOR SQLEXCEPTION RESIGNAL; DECLARE c CONDITION; SELECT 1 FROM DUMMY; END'
    ).some((d) => /must appear before 'DECLARE \.\.\. HANDLER'/i.test(d.message))
  );
  assert.ok(
    syn28(
      'hdbprocedure',
      'PROCEDURE p() AS BEGIN SELECT 1 FROM DUMMY; DECLARE EXIT HANDLER FOR SQLEXCEPTION RESIGNAL; END'
    ).some((d) => /'DECLARE \.\.\. HANDLER' must appear before executable statements/i.test(d.message))
  );
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() AS BEGIN DECLARE v INT; SEQUENTIAL EXECUTION; v = 1; END').some((d) =>
      /'SEQUENTIAL EXECUTION' must appear immediately after the block opener/i.test(d.message)
    )
  );
  assert.ok(
    syn28('hdbprocedure', 'PROCEDURE p() AS BEGIN IF 1 = 1 THEN PARALLEL EXECUTION SELECT 1 FROM DUMMY; END IF; END').some(
      (d) => /'PARALLEL EXECUTION' is only valid on a 'BEGIN' block/i.test(d.message)
    )
  );

  // 5. EXIT / CONTINUE handler conflicts and duplicates
  assert.ok(
    syn28(
      'hdbprocedure',
      `PROCEDURE p() AS BEGIN
         DECLARE EXIT HANDLER FOR SQL_ERROR_CODE 1299 RESIGNAL;
         DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
       END`
    ).some((d) => /cannot appear in the same scope/i.test(d.message))
  );
  assert.ok(
    syn28(
      'hdbprocedure',
      `PROCEDURE p() AS BEGIN
         DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SELECT 1 FROM DUMMY;
         IF 1 = 1 THEN
           DECLARE EXIT HANDLER FOR SQL_ERROR_CODE 1299 RESIGNAL;
           SELECT 1 FROM DUMMY;
         END IF;
       END`
    ).some((d) => /inside an enclosing 'CONTINUE HANDLER' scope/i.test(d.message))
  );
  assert.ok(
    syn28(
      'hdbprocedure',
      `PROCEDURE p() AS BEGIN
         DECLARE EXIT HANDLER FOR SQLEXCEPTION RESIGNAL;
         DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN END;
       END`
    ).some((d) => /Duplicate condition handler for 'SQLEXCEPTION'/i.test(d.message))
  );

  // 6. Unreachable statements (warning + unnecessary tag)
  const unreachDiags = syn28(
    'hdbprocedure',
    `PROCEDURE p(OUT o INT) AS
     BEGIN
       IF 1 = 1 THEN
         RETURN;
         o = 99;
       END IF;
       LOOP
         BREAK;
         o = 2;
       END LOOP;
     END`
  );
  assert.equal(unreachDiags.length, 2);
  assert.ok(unreachDiags.every((d) => d.severity === 'warning' && d.tags?.includes('unnecessary')));

  // 7. Negative checks: complex valid SAP HANA SQLScript must yield 0 diagnostics
  const validComplexProc = `
    CREATE PROCEDURE "demo::complex_proc" (IN iv_flag INT, OUT ov_res INT)
    LANGUAGE SQLSCRIPT
    SQL SECURITY INVOKER
    DEFAULT SCHEMA "DEMO"
    DETERMINISTIC
    WITH ENCRYPTION
    AUTOCOMMIT DDL OFF
    AS
    USING SYS.SQLSCRIPT_STRING AS STR_LIB;
    BEGIN SEQUENTIAL EXECUTION
      DECLARE c_custom CONDITION FOR SQL_ERROR_CODE 10001;
      DECLARE EXIT HANDLER FOR c_custom
      BEGIN
        DECLARE v_err NVARCHAR(100) := 'err';
        ov_res = 0;
      END;
      DECLARE EXIT HANDLER FOR SQLEXCEPTION RESIGNAL;

      IF CASE WHEN :iv_flag = 1 THEN 1 ELSE 0 END = 1 THEN
        DECLARE v_local INT DEFAULT 1;
        DECLARE CONTINUE HANDLER FOR SQLEXCEPTION ov_res = -1;
        IF :v_local = 1 THEN
          RETURN;
        ELSE
          ov_res = 2;
        END IF;
        ov_res = :ov_res + 1;
      ELSEIF :iv_flag = 2 THEN
        DECLARE v_loop INT DEFAULT 0;
        WHILE :v_loop < 3 DO SEQUENTIAL EXECUTION
          v_loop = :v_loop + 1;
        END WHILE;
      ELSE
        ov_res = -1;
      END IF;

      MERGE INTO tgt USING src ON tgt.id = src.id
      WHEN MATCHED THEN UPDATE SET tgt.val = src.val;
    END;
  `;
  assert.deepEqual(syn28('hanasql', validComplexProc), []);

  const validUsingAtRootBegin = `
    PROCEDURE "demo::using_in_begin" (OUT ov_len INT)
    LANGUAGE SQLSCRIPT SQL SECURITY INVOKER READS SQL DATA AS
    BEGIN
      USING SYS.SQLSCRIPT_STRING AS STR_LIB;
      DECLARE v_tmp INT := 0;
      ov_len = LENGTH('abc');
    END
  `;
  assert.deepEqual(syn28('hdbprocedure', validUsingAtRootBegin), []);

  const validAlterAndMisc = `
    ALTER FUNCTION "demo::fn_alter" () AS BEGIN x = 1; END;
    ALTER PROCEDURE "demo::p_recomp" RECOMPILE;
    DROP FUNCTION "demo::fn_old";
    FUNCTION "demo::fn_scalar" (IN a INT) RETURNS b INT DETERMINISTIC STRUCTURED FILTER CHECK AS BEGIN b = :a + 1; END
  `;
  assert.deepEqual(syn28('hanasql', validAlterAndMisc), []);
});

test('HANA-SYN-029: context-sensitive SQLScript statement legality & DETERMINISTIC checks', () => {
  const syn29 = (lang: string, code: string) =>
    syntaxDiags(lang, code).filter((d) => d.ruleId === 'HANA-SYN-029');

  // 1. Read-only restrictions in FUNCTION & READS SQL DATA PROCEDURE
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() READS SQL DATA AS BEGIN INSERT INTO MY_TAB VALUES (1); END').some((d) =>
      /'INSERT' on persistent table 'MY_TAB' is not allowed/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbfunction', 'FUNCTION f() RETURNS r INT AS BEGIN UPDATE MY_TAB SET a = 1; r = 1; END').some((d) =>
      /'UPDATE' on persistent table 'MY_TAB' is not allowed/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() READS SQL DATA AS BEGIN DELETE FROM MY_TAB; END').some((d) =>
      /'DELETE' on persistent table/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() READS SQL DATA AS BEGIN CREATE TABLE T (A INT); END').some((d) =>
      /DDL statement 'CREATE' is not allowed/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() READS SQL DATA AS BEGIN COMMIT; END').some((d) =>
      /Transaction control statement 'COMMIT' is not allowed/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbprocedure', "PROCEDURE p() READS SQL DATA AS BEGIN EXECUTE IMMEDIATE 'DROP TABLE T'; END").some((d) =>
      /Dynamic SQL \('EXECUTE IMMEDIATE'\) is not allowed/i.test(d.message)
    )
  );
  assert.ok(
    syn29(
      'hdbprocedure',
      'PROCEDURE p() READS SQL DATA AS BEGIN BEGIN AUTONOMOUS TRANSACTION INSERT INTO LOG_TAB VALUES (1); END; END'
    ).some((d) => /'BEGIN AUTONOMOUS TRANSACTION' is not allowed/i.test(d.message))
  );
  assert.ok(
    syn29('hdbfunction', 'FUNCTION f() RETURNS r INT AS BEGIN CALL other_proc(); r = 1; END').some((d) =>
      /'CALL' procedure invocation is not allowed inside a FUNCTION/i.test(d.message)
    )
  );
  assert.ok(
    syn29(
      'hdbfunction',
      'FUNCTION f() RETURNS r INT AS BEGIN BEGIN PARALLEL EXECUTION SELECT 1 FROM DUMMY; END; r = 1; END'
    ).some((d) => /'BEGIN PARALLEL EXECUTION' is not allowed inside a FUNCTION/i.test(d.message))
  );

  // 2. DETERMINISTIC non-deterministic built-in & sequence warnings
  const detDiags = syn29(
    'hdbfunction',
    `FUNCTION f() RETURNS r NVARCHAR(64) DETERMINISTIC AS
     BEGIN
       DECLARE u INT;
       SELECT MY_SEQ.NEXTVAL INTO u FROM DUMMY;
       r = CAST(RAND() AS NVARCHAR(64)) || TO_NVARCHAR(CURRENT_TIMESTAMP) || SESSION_CONTEXT('XS_USER');
     END`
  );
  assert.equal(detDiags.length, 4);
  assert.ok(detDiags.every((d) => d.severity === 'warning'));

  // 3. RETURN rules by routine kind
  assert.ok(
    syn29('hdbtablefunction', 'FUNCTION f() RETURNS TABLE (A INT) AS BEGIN DECLARE x INT := 1; END').some((d) =>
      /Table UDF body is missing a 'RETURN/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbtablefunction', 'FUNCTION f() RETURNS TABLE (A INT) AS BEGIN RETURN; END').some((d) =>
      /Table UDF cannot use bare 'RETURN;'/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbfunction', 'FUNCTION f() RETURNS x INT AS BEGIN RETURN 1; END').some((d) =>
      /'RETURN <expr>' is only allowed in a Table UDF/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() AS BEGIN RETURN 1; END').some((d) =>
      /'RETURN <expr>' is only allowed in a Table UDF/i.test(d.message)
    )
  );

  // 4. BREAK / CONTINUE outside loop, RESIGNAL outside handler, SIGNAL code range
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() AS BEGIN BREAK; END').some((d) =>
      /'BREAK' is only allowed inside a 'LOOP', 'WHILE', or 'FOR'/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() AS BEGIN CONTINUE; END').some((d) =>
      /'CONTINUE' is only allowed inside a 'LOOP', 'WHILE', or 'FOR'/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() AS BEGIN RESIGNAL; END').some((d) =>
      /'RESIGNAL' is only allowed inside a 'DECLARE \.\.\. HANDLER'/i.test(d.message)
    )
  );
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() AS BEGIN SIGNAL SQL_ERROR_CODE 500; END').some((d) =>
      /between 10000 and 19999/i.test(d.message)
    )
  );

  // 5. Nested DO BEGIN, AUTONOMOUS TRANSACTION & PARALLEL EXECUTION restrictions
  assert.ok(
    syn29('hdbprocedure', 'PROCEDURE p() AS BEGIN DO BEGIN SELECT 1 FROM DUMMY; END; END').some((d) =>
      /Nested 'DO BEGIN \.\.\. END'/i.test(d.message)
    )
  );
  assert.ok(
    syn29(
      'hdbprocedure',
      `PROCEDURE p() AS BEGIN
         BEGIN AUTONOMOUS TRANSACTION
           DECLARE CURSOR c FOR SELECT 1 FROM DUMMY;
           CALL helper_proc();
           CREATE TABLE T_TMP (A INT);
           OPEN c;
         END;
       END`
    ).length === 4
  );
  assert.ok(
    syn29(
      'hdbprocedure',
      `PROCEDURE p() AS BEGIN
         BEGIN PARALLEL EXECUTION
           DECLARE EXIT HANDLER FOR SQLEXCEPTION RESIGNAL;
           CREATE TABLE T_PAR (A INT);
           COMMIT;
           EXEC 'SELECT 1 FROM DUMMY';
         END;
       END`
    ).length === 4
  );

  // 6. Top-level imperative statements outside routine / DO BEGIN
  assert.ok(
    syn29('hanasql', 'DECLARE v INT := 1;\nRETURN;').length === 2
  );
  assert.ok(
    syn29('hanasql', 'IF 1 = 1 THEN SELECT 1 FROM DUMMY; END IF;').some((d) =>
      /Imperative statement 'IF' is only allowed inside a routine/i.test(d.message)
    )
  );

  // 7. Negative checks: all valid SQLScript contexts must yield 0 HANA-SYN-029 diagnostics
  const validContextCases = `
    CREATE PROCEDURE "demo::ro_tablevar_proc" (OUT ot TABLE (ID INT))
    LANGUAGE SQLSCRIPT READS SQL DATA AS
    BEGIN
      DECLARE lt TABLE (ID INT);
      :lt.INSERT((1), 1);
      INSERT INTO :lt VALUES (2);
      UPDATE :lt SET ID = 3 WHERE ID = 2;
      DELETE FROM :lt WHERE ID = 1;
      SELECT 1 FROM DUMMY;
      ot = SELECT * FROM :lt;
      RETURN;
    END;

    CREATE PROCEDURE "demo::rw_full_proc" () LANGUAGE SQLSCRIPT AS
    BEGIN
      DECLARE c_dup CONDITION FOR SQL_ERROR_CODE 301;
      DECLARE c_user CONDITION FOR SQL_ERROR_CODE 10001;
      DECLARE EXIT HANDLER FOR SQLEXCEPTION RESIGNAL;
      DECLARE i INT := 0;

      WHILE :i < 5 DO
        i = :i + 1;
        IF :i = 2 THEN
          CONTINUE;
        ELSEIF :i = 4 THEN
          BREAK;
        END IF;
      END WHILE;

      BEGIN AUTONOMOUS TRANSACTION
        INSERT INTO "AUDIT_LOG" VALUES ('ok');
        COMMIT;
        BEGIN AUTONOMOUS TRANSACTION
          ROLLBACK;
        END;
      END;

      BEGIN PARALLEL EXECUTION
        UPDATE "CTAB1" SET A = 1;
        CALL "demo::sub_rw_1"();
      END;

      IF 1 = 0 THEN
        SIGNAL SQL_ERROR_CODE 10001 SET MESSAGE_TEXT = 'bad';
      END IF;
    END;

    CREATE FUNCTION "demo::det_scalar_fn" (IN a INT, IN b INT)
    RETURNS res INT DETERMINISTIC AS
    BEGIN
      IF :a < 0 THEN
        res = 0;
        RETURN;
      END IF;
      res = :a + :b;
    END;

    CREATE FUNCTION "demo::tudf_branch" (IN flag INT)
    RETURNS TABLE (A INT) AS
    BEGIN
      DECLARE buf TABLE (A INT);
      :buf.INSERT((1), 1);
      IF :flag > 0 THEN
        RETURN SELECT A FROM :buf;
      ELSE
        RETURN SELECT 0 AS A FROM DUMMY;
      END IF;
    END;

    DO BEGIN
      DECLARE v_x INT := 1;
      v_x = :v_x + 1;
    END;
  `;
  assert.deepEqual(syn29('hanasql', validContextCases), []);
});

test('HANA-SYN-004: strict HDI artifact roots, invalid CREATE objects, and single-object trailing statements', () => {
  const syn04 = (lang: string, code: string) => syntaxDiags(lang, code).filter((d) => d.ruleId === 'HANA-SYN-004');

  // Wrong root keywords or mismatched CREATE object kinds in HDI artifacts
  assert.ok(syn04('hdbprocedure', 'SELECT 1 FROM DUMMY;').length >= 1);
  assert.ok(syn04('hdbprocedure', 'CREATE VIEW "V" AS SELECT 1 AS A FROM DUMMY;').length >= 1);
  assert.ok(syn04('hdbfunction', 'PROCEDURE "P"() AS BEGIN END').length >= 1);
  assert.ok(syn04('hdbview', 'COLUMN TABLE "T" ("ID" INT);').length >= 1);

  // Trailing statements after a single-object HDI declaration (with and without `;` after END)
  assert.ok(
    syn04('hdbprocedure', 'PROCEDURE "P"() AS BEGIN SELECT 1 FROM DUMMY; END; SELECT 2 FROM DUMMY;').length >= 1
  );
  assert.ok(
    syn04('hdbprocedure', 'PROCEDURE "P"() AS BEGIN SELECT 1 FROM DUMMY; END SELECT 2 FROM DUMMY;').length >= 1
  );
  assert.ok(
    syn04('hdbprocedure', 'PROCEDURE "P"() LANGUAGE SQLSCRIPT AS HEADER ONLY; SELECT 1 FROM DUMMY;').length >= 1
  );
  assert.ok(
    syn04(
      'hdbfunction',
      'FUNCTION "F1"() RETURNS r INT AS BEGIN r = 1; END; FUNCTION "F2"() RETURNS r INT AS BEGIN r = 2; END'
    ).length >= 1
  );
  assert.ok(
    syn04(
      'hdblibrary',
      'LIBRARY "L" AS BEGIN PUBLIC VARIABLE c CONSTANT INT := 1; END; SELECT 1 FROM DUMMY;'
    ).length >= 1
  );
  assert.ok(
    syn04(
      'hdbtrigger',
      'TRIGGER "TRG" AFTER INSERT ON "T" FOR EACH ROW BEGIN END; SELECT 1 FROM DUMMY;'
    ).length >= 1
  );
  assert.ok(syn04('hdbtable', 'COLUMN TABLE "T1" ("ID" INT); COLUMN TABLE "T2" ("ID" INT);').length >= 1);
  assert.ok(
    syn04('hdbview', 'VIEW "V1" AS SELECT 1 AS A FROM DUMMY; VIEW "V2" AS SELECT 2 AS B FROM DUMMY;').length >= 1
  );

  // Negative checks: keyword typos keep HANA-SYN-021 QuickFixes without spurious HANA-SYN-004
  const typoFn = syntaxDiags('hdbfunction', 'FUNC "my_fn"() RETURNS r INT AS BEGIN r = 1; END');
  assert.ok(typoFn.some((d) => d.ruleId === 'HANA-SYN-021' && d.fixes.length > 0));
  assert.deepEqual(
    typoFn.filter((d) => d.ruleId === 'HANA-SYN-004'),
    []
  );

  const typoCreateProc = syntaxDiags('hanasql', 'CREATE PROCEDUR "P"() AS BEGIN END;');
  assert.ok(typoCreateProc.some((d) => d.ruleId === 'HANA-SYN-021' && d.fixes.length > 0));
  assert.deepEqual(
    typoCreateProc.filter((d) => d.ruleId === 'HANA-SYN-004'),
    []
  );

  // Negative checks: valid single-object HDI constructs (USING before BEGIN, foreign bodies, Cloud variants)
  assert.deepEqual(
    syn04('hdbprocedure', 'PROCEDURE "P"() LANGUAGE SQLSCRIPT AS USING "LIB" AS L; BEGIN SELECT 1 FROM DUMMY; END'),
    []
  );
  assert.deepEqual(
    syn04(
      'hdbprocedure',
      `PROCEDURE "P"() LANGUAGE R AS
BEGIN
  result <- data.frame(A = 1);
END`
    ),
    []
  );
  assert.deepEqual(
    syn04(
      'hdbvirtualfunction',
      'VIRTUAL FUNCTION "VF"() RETURNS TABLE ("ID" INT) CONFIGURATION \'{"remote":true}\''
    ),
    []
  );
  assert.deepEqual(syn04('hdbcollectionindex', 'HASH INDEX "IDX1" ON "COL1"($."lastName")'), []);
  assert.deepEqual(syn04('hdbcollectionindex', 'BLOCK RANGE INDEX "IDX2" ON "COL1"($."ts")'), []);
  assert.deepEqual(syn04('hdbfabricvirtualtable', 'SHARED SNAPSHOT REPLICA PAGE LOADABLE ON "MY_VT"'), []);

  // Multi-statement contexts excluded from single-object HANA-SYN-004 restriction
  assert.deepEqual(syn04('hdbdropcreatetable', 'DROP TABLE "T"; COLUMN TABLE "T" ("ID" INT)'), []);
  assert.deepEqual(
    syn04('hanasql', 'SELECT 1 FROM DUMMY; SELECT 2 FROM DUMMY; CREATE PROCEDURE "P"() AS BEGIN END;'),
    []
  );
  assert.deepEqual(
    syn04('hdbmigrationtable', '== version=1\nDROP TABLE "T";\nCOLUMN TABLE "T" ("ID" INT);'),
    []
  );
});

test('HANA-SYN-028 / HANA-SYN-029: .hdblibrary member ordering/visibility and .hdbtrigger body restrictions', () => {
  const synLibTrg = (lang: string, code: string) =>
    syntaxDiags(lang, code).filter((d) => d.ruleId === 'HANA-SYN-004' || d.ruleId === 'HANA-SYN-028' || d.ruleId === 'HANA-SYN-029');

  // .hdblibrary: VARIABLE after PROCEDURE (HANA-SYN-028)
  assert.ok(
    synLibTrg(
      'hdblibrary',
      `LIBRARY "pkg::lib" AS BEGIN
        PUBLIC PROCEDURE "P"() AS BEGIN SELECT 1 FROM DUMMY; END;
        PUBLIC VARIABLE "V_LATE" CONSTANT INT := 1;
      END`
    ).some((d) => d.ruleId === 'HANA-SYN-028' && /before member/i.test(d.message))
  );

  // .hdblibrary: USING after VARIABLE (HANA-SYN-028)
  assert.ok(
    synLibTrg(
      'hdblibrary',
      `LIBRARY "pkg::lib" AS BEGIN
        PUBLIC VARIABLE "V_C" CONSTANT INT := 1;
        USING "pkg::other" AS other;
      END`
    ).some((d) => d.ruleId === 'HANA-SYN-028' && /USING/i.test(d.message))
  );

  // .hdblibrary: DEFAULT / = / := initializer on non-CONSTANT library variable (HANA-SYN-028)
  for (const initClause of ['DEFAULT 1', '= 1', ':= 1']) {
    assert.ok(
      synLibTrg(
        'hdblibrary',
        `LIBRARY "pkg::lib" AS BEGIN
          PRIVATE VARIABLE "V_BAD" INT ${initClause};
        END`
      ).some((d) => d.ruleId === 'HANA-SYN-028' && /CONSTANT/i.test(d.message))
    );
  }

  // .hdblibrary: missing PUBLIC/PRIVATE visibility and direct statements outside members (HANA-SYN-029)
  assert.ok(
    synLibTrg(
      'hdblibrary',
      `LIBRARY "pkg::lib" AS BEGIN
        VARIABLE "V_NO_VIS" CONSTANT INT := 1;
        FUNCTION "F_NO_VIS"() RETURNS res INT AS BEGIN res = 1; END;
        SELECT 1 FROM DUMMY;
        DECLARE "V_LOCAL" INT;
      END`
    ).filter((d) => d.ruleId === 'HANA-SYN-029').length >= 4
  );

  // .hdblibrary: member bodies still get nested HANA-SYN-029 checks
  assert.ok(
    synLibTrg(
      'hdblibrary',
      `LIBRARY "pkg::lib" AS BEGIN
        PUBLIC FUNCTION "F_BAD"() RETURNS res INT AS BEGIN
          INSERT INTO "PERSISTENT_TAB" VALUES (1);
          res = 1;
        END;
      END`
    ).some((d) => d.ruleId === 'HANA-SYN-029' && /PERSISTENT_TAB/i.test(d.message))
  );

  // .hdblibrary valid complete artifact (mixed omitted/present `;` after member END)
  assert.deepEqual(
    synLibTrg(
      'hdblibrary',
      `LIBRARY "pkg::lib" LANGUAGE SQLSCRIPT AS BEGIN
        USING "pkg::other" AS other;
        PUBLIC VARIABLE "C_RATE" CONSTANT DECIMAL(10, 2) := 0.19;
        PRIVATE VARIABLE "V_CACHE" INT;
        PRIVATE FUNCTION "F_HELPER"(IN x INT) RETURNS res INT AS BEGIN
          res = :x + 1;
        END
        PUBLIC PROCEDURE "P_RUN"(IN x INT, OUT y INT) AS BEGIN
          DECLARE v_tmp INT := :x;
          y = :v_tmp;
        END;
      END`
    ),
    []
  );

  // .hdbtrigger: disallowed DDL, TCL, dynamic SQL, AUTONOMOUS, PARALLEL, RETURN <expr> (HANA-SYN-029)
  const triggerBodyBad = (stmt: string) =>
    `TRIGGER "pkg::trg" AFTER INSERT ON "TAB" FOR EACH ROW BEGIN ${stmt} END`;
  assert.ok(synLibTrg('hdbtrigger', triggerBodyBad('COMMIT;')).some((d) => d.ruleId === 'HANA-SYN-029'));
  assert.ok(synLibTrg('hdbtrigger', triggerBodyBad('ROLLBACK;')).some((d) => d.ruleId === 'HANA-SYN-029'));
  assert.ok(
    synLibTrg('hdbtrigger', triggerBodyBad('CREATE COLUMN TABLE "TMP" ("A" INT);')).some((d) => d.ruleId === 'HANA-SYN-029')
  );
  assert.ok(
    synLibTrg('hdbtrigger', triggerBodyBad("EXECUTE IMMEDIATE 'DROP TABLE \"X\"';")).some((d) => d.ruleId === 'HANA-SYN-029')
  );
  assert.ok(
    synLibTrg('hdbtrigger', triggerBodyBad('BEGIN AUTONOMOUS TRANSACTION INSERT INTO "LOG" VALUES (1); END;')).some(
      (d) => d.ruleId === 'HANA-SYN-029'
    )
  );
  assert.ok(
    synLibTrg('hdbtrigger', triggerBodyBad('BEGIN PARALLEL EXECUTION SELECT 1 FROM DUMMY; END;')).some(
      (d) => d.ruleId === 'HANA-SYN-029'
    )
  );
  assert.ok(synLibTrg('hdbtrigger', triggerBodyBad('RETURN 1;')).some((d) => d.ruleId === 'HANA-SYN-029'));

  // .hdbtrigger valid artifact allowing DML writes, CALL, and bare RETURN;
  assert.deepEqual(
    synLibTrg(
      'hdbtrigger',
      `TRIGGER "pkg::trg_audit" AFTER INSERT ON "ORDERS" REFERENCING NEW ROW mynew FOR EACH ROW BEGIN
        IF :mynew.ID IS NULL THEN
          RETURN;
        END IF;
        INSERT INTO "AUDIT_LOG" ("ORDER_ID") VALUES (:mynew.ID);
        CALL "pkg::notify_order"(:mynew.ID);
      END`
    ),
    []
  );
});

test('HANA-SYN-004 / 027 / 028 / 029: edge cases, multiple violations, and QuickFix replacements', () => {
  const byRule = (lang: string, code: string, rule: string) => syntaxDiags(lang, code).filter((d) => d.ruleId === rule);

  // --- Multiple violations in one document are each reported, at distinct offsets ---
  const multiTrigger = `TRIGGER "T1" AFTER INSERT ON "TAB" FOR EACH ROW BEGIN
    COMMIT;
    ROLLBACK;
    CREATE COLUMN TABLE "X" ("A" INT);
    EXEC 'SELECT 1 FROM DUMMY';
  END`;
  const trg29 = byRule('hdbtrigger', multiTrigger, 'HANA-SYN-029');
  assert.equal(trg29.length, 4);
  assert.equal(new Set(trg29.map((d) => d.start)).size, 4);
  for (const d of trg29) {
    assert.ok(/TRIGGER/.test(d.message));
    assert.ok(['COMMIT', 'ROLLBACK', 'CREATE', 'EXEC'].includes(multiTrigger.slice(d.start, d.end).toUpperCase()));
  }

  const multiLib = `LIBRARY "L" AS BEGIN
    PRIVATE VARIABLE "A" INT DEFAULT 1;
    PRIVATE VARIABLE "B" INT := 2;
    PUBLIC PROCEDURE "P"() AS BEGIN END;
    PUBLIC VARIABLE "C" CONSTANT INT := 3;
  END`;
  const lib28 = byRule('hdblibrary', multiLib, 'HANA-SYN-028');
  assert.equal(lib28.filter((d) => /CONSTANT/.test(d.message)).length, 2);
  assert.equal(lib28.filter((d) => /before member/.test(d.message)).length, 1);

  // Duplicate SELECT clauses in separate statements each flagged (HANA-SYN-027)
  const dupClauses = 'SELECT A FROM T WHERE A = 1 WHERE A = 2;\nSELECT B FROM T ORDER BY B ORDER BY B;';
  assert.ok(byRule('hanasql', dupClauses, 'HANA-SYN-027').length >= 2);

  // Several trailing statements in a single-object artifact: at least one HANA-SYN-004, never on root
  const trailing = 'VIEW "V" AS SELECT 1 AS A FROM DUMMY; SELECT 2 FROM DUMMY; SELECT 3 FROM DUMMY;';
  const t04 = byRule('hdbview', trailing, 'HANA-SYN-004');
  assert.ok(t04.length >= 1);
  assert.ok(t04.every((d) => d.start > trailing.indexOf(';')));

  // --- Boundary / negative edge cases ---
  // CONSTANT with initializer inside parentheses / CASE expression in a library variable
  assert.deepEqual(
    byRule(
      'hdblibrary',
      `LIBRARY "L" AS BEGIN
        PUBLIC VARIABLE "D" CONSTANT DECIMAL(10, 2) := (CASE WHEN 1 = 1 THEN 1.5 ELSE 2 END);
        PUBLIC VARIABLE "E" INT;
      END`,
      'HANA-SYN-028'
    ),
    []
  );
  // '=' inside a nested routine body must not be mistaken for a library variable initializer
  assert.deepEqual(
    byRule(
      'hdblibrary',
      `LIBRARY "L" AS BEGIN
        PUBLIC FUNCTION "F"(IN x INT) RETURNS r INT AS BEGIN
          r = CASE WHEN :x = 1 THEN 1 ELSE 0 END;
        END;
      END`,
      'HANA-SYN-028'
    ),
    []
  );
  // Lowercase keywords and comments between visibility and member keyword
  assert.deepEqual(
    byRule(
      'hdblibrary',
      `library "L" as begin
        public /* doc */ variable "c" constant int := 1;
        private -- helper
        procedure "p"() as begin end
      end`,
      'HANA-SYN-029'
    ),
    []
  );
  // Nested BEGIN inside trigger keeps trigger restrictions
  assert.ok(
    byRule(
      'hdbtrigger',
      'TRIGGER "T" AFTER UPDATE ON "TAB" FOR EACH ROW BEGIN IF 1 = 1 THEN BEGIN COMMIT; END; END IF; END',
      'HANA-SYN-029'
    ).length === 1
  );
  // COMMIT outside a trigger (plain procedure) is allowed
  assert.deepEqual(byRule('hdbprocedure', 'PROCEDURE "P"() AS BEGIN COMMIT; END', 'HANA-SYN-029'), []);
  // Strings / comments containing trigger-forbidden words are ignored
  assert.deepEqual(
    byRule(
      'hdbtrigger',
      `TRIGGER "T" AFTER INSERT ON "TAB" FOR EACH ROW BEGIN
        -- COMMIT; ROLLBACK;
        INSERT INTO "LOG" VALUES ('CREATE TABLE x; COMMIT;');
      END`,
      'HANA-SYN-029'
    ),
    []
  );
  // Comments / blank lines after the root END are not trailing statements
  assert.deepEqual(
    byRule('hdbprocedure', 'PROCEDURE "P"() AS BEGIN END;\n\n-- trailing comment\n/* block */\n', 'HANA-SYN-004'),
    []
  );
  // CASE ... END and END IF / END LOOP inside body do not prematurely close the root
  assert.deepEqual(
    byRule(
      'hdbprocedure',
      `PROCEDURE "P"(IN x INT) AS BEGIN
        DECLARE v INT := CASE WHEN :x > 0 THEN 1 ELSE 0 END;
        IF :v = 1 THEN v = 2; END IF;
        WHILE :v < 10 DO v = :v + 1; END WHILE;
        BEGIN v = 0; END;
      END`,
      'HANA-SYN-004'
    ),
    []
  );
  // Leading comment and annotations before root keyword
  assert.deepEqual(byRule('hdbview', '-- header\n/* doc */\nVIEW "V" AS SELECT 1 AS A FROM DUMMY', 'HANA-SYN-004'), []);
  // Empty artifact produces no HANA-SYN-004
  assert.deepEqual(byRule('hdbprocedure', '', 'HANA-SYN-004'), []);
  assert.deepEqual(byRule('hdbprocedure', '   \n-- only a comment\n', 'HANA-SYN-004'), []);

  // --- QuickFix replacements: multiple independent typo fixes applied together ---
  const multiTypo = 'SELCT "A" FROM "T";\nSELCT "B" FROM "T";';
  const typoDiags = byRule('hanasql', multiTypo, 'HANA-SYN-021');
  assert.equal(typoDiags.length, 2);
  const allEdits = typoDiags.flatMap((d) => d.fixes[0].edits);
  const fixedMulti = applyTextEdits(multiTypo, allEdits);
  assert.equal(fixedMulti, 'SELECT "A" FROM "T";\nSELECT "B" FROM "T";');
  assert.deepEqual(syntaxDiags('hanasql', fixedMulti), []);

  // HDI root typo fix yields a valid artifact with no HANA-SYN-004 / 021 remaining
  const hdiTypo = 'PROCEDUR "P"() AS BEGIN SELECT 1 FROM DUMMY; END';
  const hdiTypoDiag = byRule('hdbprocedure', hdiTypo, 'HANA-SYN-021');
  assert.ok(hdiTypoDiag.length === 1 && hdiTypoDiag[0].fixes.length > 0);
  const hdiFixed = applyTextEdits(hdiTypo, hdiTypoDiag[0].fixes[0].edits);
  assert.ok(hdiFixed.startsWith('PROCEDURE '));
  assert.deepEqual(
    syntaxDiags('hdbprocedure', hdiFixed).filter((d) => d.ruleId === 'HANA-SYN-004' || d.ruleId === 'HANA-SYN-021'),
    []
  );

  // Valid-but-wrong root (e.g. GRANT in .hdbtable) must not offer a bogus typo fix
  const wrongRoot = syntaxDiags('hdbtable', 'GRANT SELECT ON "T" TO "U"');
  assert.ok(wrongRoot.some((d) => d.ruleId === 'HANA-SYN-004' && d.fixes.length === 0));
  assert.ok(!wrongRoot.some((d) => d.ruleId === 'HANA-SYN-021'));
});

test('HANA-SYN-004 / 028 / 029 QuickFixes & #22/#23 improvements', () => {
  const byRule = (lang: string, code: string, rule: string) => syntaxDiags(lang, code).filter((d) => d.ruleId === rule);

  // --- #22: Aggregated trailing statement diagnostic + preferred remove QuickFix ---
  const viewWith3Extra =
    'VIEW "V" AS SELECT 1 AS A FROM DUMMY; SELECT 2 FROM DUMMY; SELECT 3 FROM DUMMY; SELECT 4 FROM DUMMY; -- trailing comment';
  const trailingViewDiags = byRule('hdbview', viewWith3Extra, 'HANA-SYN-004');
  assert.equal(trailingViewDiags.length, 1);
  assert.ok(/found 3 unexpected trailing statements/i.test(trailingViewDiags[0].message));
  assert.equal(trailingViewDiags[0].fixes.length, 1);
  assert.equal(trailingViewDiags[0].fixes[0].isPreferred, true);
  const fixedView = applyTextEdits(viewWith3Extra, trailingViewDiags[0].fixes[0].edits);
  assert.equal(fixedView, 'VIEW "V" AS SELECT 1 AS A FROM DUMMY; -- trailing comment');
  assert.deepEqual(byRule('hdbview', fixedView, 'HANA-SYN-004'), []);

  const procWith2Extra =
    'PROCEDURE "P"() AS BEGIN SELECT 1 FROM DUMMY; END; SELECT 2 FROM DUMMY; SELECT 3 FROM DUMMY;\n-- keep';
  const trailingProcDiags = byRule('hdbprocedure', procWith2Extra, 'HANA-SYN-004');
  assert.equal(trailingProcDiags.length, 1);
  assert.ok(/found 2 unexpected trailing statements/i.test(trailingProcDiags[0].message));
  const fixedProc = applyTextEdits(procWith2Extra, trailingProcDiags[0].fixes[0].edits);
  assert.equal(fixedProc, 'PROCEDURE "P"() AS BEGIN SELECT 1 FROM DUMMY; END\n-- keep');
  assert.deepEqual(syntaxDiags('hdbprocedure', fixedProc), []);

  // Nested BEGIN ... END in trailing statement still counts as 1 statement per block
  const procWithNestedTrailing =
    'PROCEDURE "P"() AS BEGIN END; DO BEGIN SELECT 1 FROM DUMMY; END; SELECT 2 FROM DUMMY;';
  const nestedTrail = byRule('hdbprocedure', procWithNestedTrailing, 'HANA-SYN-004');
  assert.equal(nestedTrail.length, 1);
  assert.ok(/found 2 unexpected trailing statements/i.test(nestedTrail[0].message));

  // --- #22: Redundant leading CREATE [OR REPLACE] warning & strip QuickFix ---
  const createProc = 'CREATE PROCEDURE "P"() AS BEGIN SELECT 1 FROM DUMMY; END';
  const createProcDiags = byRule('hdbprocedure', createProc, 'HANA-SYN-004');
  assert.equal(createProcDiags.length, 1);
  assert.equal(createProcDiags[0].severity, 'warning');
  assert.equal(createProcDiags[0].fixes[0].isPreferred, true);
  const strippedProc = applyTextEdits(createProc, createProcDiags[0].fixes[0].edits);
  assert.equal(strippedProc, 'PROCEDURE "P"() AS BEGIN SELECT 1 FROM DUMMY; END');
  assert.deepEqual(syntaxDiags('hdbprocedure', strippedProc), []);

  const createOrReplaceFn = 'CREATE OR REPLACE FUNCTION "F"() RETURNS r INT AS BEGIN r = 1; END';
  const corDiags = byRule('hdbfunction', createOrReplaceFn, 'HANA-SYN-004');
  assert.equal(corDiags.length, 1);
  assert.equal(corDiags[0].severity, 'warning');
  const strippedFn = applyTextEdits(createOrReplaceFn, corDiags[0].fixes[0].edits);
  assert.equal(strippedFn, 'FUNCTION "F"() RETURNS r INT AS BEGIN r = 1; END');
  assert.deepEqual(syntaxDiags('hdbfunction', strippedFn), []);

  // Leading comment after CREATE is preserved
  const createWithComment = 'CREATE /* keep */ PROCEDURE "P"() AS BEGIN SELECT 1 FROM DUMMY; END';
  const cwcDiags = byRule('hdbprocedure', createWithComment, 'HANA-SYN-004');
  assert.equal(cwcDiags.length, 1);
  const fixedCwc = applyTextEdits(createWithComment, cwcDiags[0].fixes[0].edits);
  assert.ok(fixedCwc.includes('/* keep */'));
  assert.ok(!fixedCwc.startsWith('CREATE'));

  // Wrong CREATE object kind stays error with NO fix
  const wrongObj = byRule('hdbprocedure', 'CREATE VIEW "V" AS SELECT 1 AS A FROM DUMMY;', 'HANA-SYN-004');
  assert.equal(wrongObj[0].severity, 'error');
  assert.deepEqual(wrongObj[0].fixes, []);

  // CREATE PROCEDURE in .hanasql script file is valid (no warning)
  assert.deepEqual(byRule('hanasql', 'CREATE PROCEDURE "P"() AS BEGIN END;', 'HANA-SYN-004'), []);

  // --- #23: Library member visibility QuickFixes (PRIVATE preferred, PUBLIC secondary) ---
  const noVisLib = `LIBRARY "L" AS BEGIN
  VARIABLE "V" CONSTANT INT := 1;
  PROCEDURE "P"() AS BEGIN END;
  FUNCTION "F"() RETURNS r INT AS BEGIN r = 1; END
END`;
  const visDiags = byRule('hdblibrary', noVisLib, 'HANA-SYN-029');
  assert.equal(visDiags.length, 3);
  for (const d of visDiags) {
    assert.equal(d.fixes.length, 2);
    assert.equal(d.fixes[0].title, "Add 'PRIVATE'");
    assert.equal(d.fixes[0].isPreferred, true);
    assert.equal(d.fixes[1].title, "Add 'PUBLIC'");
    assert.equal(d.fixes[1].isPreferred, false);
  }
  const fixedAllPrivate = applyTextEdits(
    noVisLib,
    visDiags.flatMap((d) => d.fixes[0].edits)
  );
  assert.ok(fixedAllPrivate.includes('PRIVATE VARIABLE "V"'));
  assert.ok(fixedAllPrivate.includes('PRIVATE PROCEDURE "P"'));
  assert.ok(fixedAllPrivate.includes('PRIVATE FUNCTION "F"'));
  assert.deepEqual(syntaxDiags('hdblibrary', fixedAllPrivate), []);

  // Secondary PUBLIC fix also produces clean artifact
  const singlePublic = applyTextEdits(
    'LIBRARY "L" AS BEGIN VARIABLE "V" CONSTANT INT := 1; END',
    byRule('hdblibrary', 'LIBRARY "L" AS BEGIN VARIABLE "V" CONSTANT INT := 1; END', 'HANA-SYN-029')[0].fixes[1].edits
  );
  assert.equal(singlePublic, 'LIBRARY "L" AS BEGIN PUBLIC VARIABLE "V" CONSTANT INT := 1; END');
  assert.deepEqual(syntaxDiags('hdblibrary', singlePublic), []);

  // --- #23: Qualified variable name + Add CONSTANT QuickFix ---
  const qualVarLib = 'LIBRARY "L" AS BEGIN PUBLIC VARIABLE "my_schema"."v_rate" INT := 1; END';
  const qualDiags = byRule('hdblibrary', qualVarLib, 'HANA-SYN-028');
  assert.equal(qualDiags.length, 1);
  assert.equal(qualDiags[0].fixes[0].title, "Add 'CONSTANT'");
  assert.equal(qualDiags[0].fixes[0].isPreferred, true);
  const fixedQual = applyTextEdits(qualVarLib, qualDiags[0].fixes[0].edits);
  assert.equal(fixedQual, 'LIBRARY "L" AS BEGIN PUBLIC VARIABLE "my_schema"."v_rate" CONSTANT INT := 1; END');
  assert.deepEqual(syntaxDiags('hdblibrary', fixedQual), []);

  // --- #23: Combined QuickFixes (visibility + CONSTANT in the same variable declaration) ---
  const comboLib = `LIBRARY "L" AS BEGIN
  VARIABLE "V1" INT DEFAULT 1;
  PROCEDURE "P1"() AS BEGIN END;
END`;
  const comboDiags = syntaxDiags('hdblibrary', comboLib);
  const comboPreferredEdits = comboDiags
    .flatMap((d) => d.fixes.filter((f) => f.kind === 'quickfix' && f.isPreferred))
    .flatMap((f) => f.edits);
  const fixedCombo = applyTextEdits(comboLib, comboPreferredEdits);
  assert.ok(fixedCombo.includes('PRIVATE VARIABLE "V1" CONSTANT INT DEFAULT 1;'));
  assert.deepEqual(syntaxDiags('hdblibrary', fixedCombo), []);

  // --- #23: Move declaration before first member (non-preferred refactor, multi-line & inline) ---
  const lateVarMulti = `LIBRARY "L" AS BEGIN\n  PUBLIC PROCEDURE "P"() AS BEGIN END;\n  PUBLIC VARIABLE "C" CONSTANT INT := 3;\nEND`;
  const lateDiagsMulti = byRule('hdblibrary', lateVarMulti, 'HANA-SYN-028');
  assert.equal(lateDiagsMulti.length, 1);
  assert.equal(lateDiagsMulti[0].fixes.length, 1);
  assert.equal(lateDiagsMulti[0].fixes[0].kind, 'refactor');
  assert.equal(lateDiagsMulti[0].fixes[0].isPreferred, false);
  const movedMulti = applyTextEdits(lateVarMulti, lateDiagsMulti[0].fixes[0].edits);
  assert.equal(
    movedMulti,
    `LIBRARY "L" AS BEGIN\n  PUBLIC VARIABLE "C" CONSTANT INT := 3;\n  PUBLIC PROCEDURE "P"() AS BEGIN END;\nEND`
  );
  assert.deepEqual(syntaxDiags('hdblibrary', movedMulti), []);

  // CRLF multi-line preservation
  const lateVarCrlf = lateVarMulti.replace(/\n/g, '\r\n');
  const movedCrlf = applyTextEdits(lateVarCrlf, byRule('hdblibrary', lateVarCrlf, 'HANA-SYN-028')[0].fixes[0].edits);
  assert.equal(movedCrlf, movedMulti.replace(/\n/g, '\r\n'));

  // Inline / single-line move refactor
  const lateVarInline = 'LIBRARY "L" AS BEGIN PUBLIC PROCEDURE "P"() AS BEGIN END; PUBLIC VARIABLE "C" CONSTANT INT := 3; END';
  const movedInline = applyTextEdits(
    lateVarInline,
    byRule('hdblibrary', lateVarInline, 'HANA-SYN-028')[0].fixes[0].edits
  );
  assert.equal(
    movedInline,
    'LIBRARY "L" AS BEGIN PUBLIC VARIABLE "C" CONSTANT INT := 3; PUBLIC PROCEDURE "P"() AS BEGIN END; END'
  );
  assert.deepEqual(syntaxDiags('hdblibrary', movedInline), []);

  // --- #23: Trigger precedence avoids secondary AUTONOMOUS/PARALLEL noise ---
  const trgAutonomous = `TRIGGER "T" AFTER INSERT ON "TAB" FOR EACH ROW BEGIN
    BEGIN AUTONOMOUS TRANSACTION
      CALL "pkg::helper"();
      CREATE COLUMN TABLE "TMP" ("A" INT);
    END;
  END`;
  const trgPrecDiags = byRule('hdbtrigger', trgAutonomous, 'HANA-SYN-029');
  assert.equal(trgPrecDiags.length, 2);
  assert.ok(trgPrecDiags.every((d) => /TRIGGER/.test(d.message)));
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

function clauseSyntaxDiags(languageId: string, text: string) {
  return syntaxDiags(languageId, text).filter((d) => d.ruleId === 'HANA-SYN-023' || d.ruleId === 'HANA-SYN-024');
}

function wrapForLanguage(languageId: string, query: string): string {
  switch (languageId) {
    case 'hdbprocedure':
      return `PROCEDURE "P" (IN iv_id INT, IN iv_from DATE, IN iv_to DATE, IN iv_param INT)\nAS\nBEGIN\n  lt_res = ${query};\nEND`;
    case 'hdbfunction':
      return `FUNCTION "F" (iv_id INT, iv_from DATE, iv_to DATE, iv_param INT)\nRETURNS TABLE (node_id NVARCHAR(10))\nAS\nBEGIN\n  RETURN ${query};\nEND`;
    case 'hdbview':
      return `VIEW "V" AS ${query.replace(/:iv_\w+/g, '1')}`;
    default:
      return `${query};`;
  }
}

const HIERARCHY_CLAUSE_QUERIES: ReadonlyArray<readonly [string, string]> = [
  [
    'HIERARCHY_DESCENDANTS (issue #36 repro)',
    'SELECT node_id FROM HIERARCHY_DESCENDANTS(\n    SOURCE "<SCHEMA>"."..."\n    START WHERE node_id = :iv_id\n)',
  ],
  [
    'HIERARCHY_DESCENDANTS + DISTANCE',
    'SELECT node_id FROM HIERARCHY_DESCENDANTS(\n    SOURCE "<SCHEMA>"."..."\n    START WHERE node_id = :iv_id\n    DISTANCE FROM 1 TO 2\n)',
  ],
  [
    'HIERARCHY',
    'SELECT * FROM HIERARCHY(SOURCE (SELECT id AS node_id, pid AS parent_id FROM "H") START WHERE parent_id IS NULL SIBLING ORDER BY node_id DESC DEPTH 3 MULTIPARENT ERROR ORPHAN ROOT CYCLE BREAKUP NO CACHE LOAD BULK)',
  ],
  [
    'HIERARCHY_LEVELED',
    "SELECT * FROM HIERARCHY_LEVELED(SOURCE \"LVL\" LEVELS (lvl1, lvl2, lvl3) START WHERE lvl1 = 'A' RETAIN NULLS 'X' CACHE FORCE)",
  ],
  [
    'HIERARCHY_SPANTREE',
    'SELECT * FROM HIERARCHY_SPANTREE(SOURCE "H" START WHERE parent_id IS NULL ORPHAN ADOPT CYCLE ERROR)',
  ],
  [
    'HIERARCHY_TEMPORAL',
    'SELECT * FROM HIERARCHY_TEMPORAL(SOURCE "H" VALID FROM :iv_from EXCLUDED UNTIL :iv_to EXCLUDED START WHERE parent_id IS NULL DEPTH 2)',
  ],
  [
    'HIERARCHY_ANCESTORS',
    'SELECT * FROM HIERARCHY_ANCESTORS(SOURCE "H" START WHERE node_id = :iv_id DISTANCE -2)',
  ],
  [
    'HIERARCHY_ANCESTORS_AGGREGATE',
    'SELECT * FROM HIERARCHY_ANCESTORS_AGGREGATE(SOURCE "H" START WHERE node_id = :iv_id MEASURES (SUM(amount) AS total, COUNT(*) AS cnt) WHERE hierarchy_level > 1 WITH TOTAL)',
  ],
  [
    'HIERARCHY_DESCENDANTS_AGGREGATE',
    'SELECT * FROM HIERARCHY_DESCENDANTS_AGGREGATE(SOURCE "H" JOIN "FACTS" ON node_id = fact_node MEASURES (SUM(v) AS s) WITH SUBTOTAL WITH BALANCE WITH NOT MATCHED)',
  ],
  [
    'HIERARCHY_SIBLINGS',
    'SELECT * FROM HIERARCHY_SIBLINGS(SOURCE "H" START (SELECT node_id FROM "H" WHERE node_id = :iv_id))',
  ],
];

test('HANA-SYN-023/024: clause-syntax HIERARCHY* functions emit no false positives (issue #36)', () => {
  for (const lang of ['hanasql', 'hdbprocedure', 'hdbfunction', 'hdbview']) {
    for (const [label, query] of HIERARCHY_CLAUSE_QUERIES) {
      const text = wrapForLanguage(lang, query);
      assert.deepEqual(clauseSyntaxDiags(lang, text), [], `${label} in ${lang}:\n${text}`);
    }
  }

  // HIERARCHY_COMPOSITE_ID stays a comma-separated scalar call
  assert.deepEqual(clauseSyntaxDiags('hanasql', 'SELECT HIERARCHY_COMPOSITE_ID(a, b) FROM "T";'), []);
  const compositeErr = clauseSyntaxDiags('hanasql', 'SELECT HIERARCHY_COMPOSITE_ID(a b) FROM "T";');
  assert.ok(compositeErr.some((d) => d.ruleId === 'HANA-SYN-023' && d.message.includes("'b'")));
});

test('HANA-SYN-023/024: HIERARCHY* nested lists, conditions and plain SQL still validated (issue #36)', () => {
  // Missing comma inside nested LEVELS (...) / MEASURES (...)
  const levels = clauseSyntaxDiags('hanasql', 'SELECT * FROM HIERARCHY_LEVELED(SOURCE "LVL" LEVELS (lvl1 lvl2));');
  assert.ok(levels.some((d) => d.ruleId === 'HANA-SYN-023' && d.message.includes("'lvl2'")));
  const measures = clauseSyntaxDiags(
    'hanasql',
    'SELECT * FROM HIERARCHY_DESCENDANTS_AGGREGATE(SOURCE "H" MEASURES (SUM(a) AS s1 SUM(b) AS s2));'
  );
  assert.ok(measures.some((d) => d.ruleId === 'HANA-SYN-023'));

  // Missing comma inside SOURCE (SELECT ...) subquery projection
  const sub = clauseSyntaxDiags('hanasql', 'SELECT * FROM HIERARCHY(SOURCE (SELECT id AS node_id pid AS parent_id FROM "H"));');
  assert.ok(sub.some((d) => d.ruleId === 'HANA-SYN-023' && d.message.includes("'pid'")));

  // Missing operator inside START WHERE condition is still reported
  const cond = clauseSyntaxDiags('hanasql', 'SELECT * FROM HIERARCHY_DESCENDANTS(SOURCE "H" START WHERE node_id :iv_id DEPTH 2);');
  assert.ok(cond.some((d) => d.ruleId === 'HANA-SYN-024' && d.message.includes(':iv_id')));

  // Dangling operator before a hierarchy clause keyword is reported
  const dangling = clauseSyntaxDiags('hanasql', 'SELECT * FROM HIERARCHY_DESCENDANTS(SOURCE "H" START WHERE node_id + DEPTH 2);');
  assert.ok(dangling.some((d) => d.ruleId === 'HANA-SYN-024'));

  // Hierarchy keywords used as column names inside hierarchy conditions keep working
  assert.deepEqual(
    clauseSyntaxDiags('hanasql', "SELECT * FROM HIERARCHY_DESCENDANTS(SOURCE \"H\" START WHERE depth = 1 AND valid = 'Y' DISTANCE 1);"),
    []
  );

  // Hierarchy clause keywords are NOT global terminators in plain SQL
  assert.deepEqual(clauseSyntaxDiags('hanasql', "SELECT * FROM T WHERE depth = 1 AND valid = 'Y';"), []);
  const plain = clauseSyntaxDiags('hanasql', 'SELECT * FROM T WHERE a = 1 DEPTH 2;');
  assert.ok(plain.some((d) => d.ruleId === 'HANA-SYN-024' && d.message.includes('DEPTH')));
});

test('HANA-SYN-023: OPENCYPHER_TABLE, JSON_VALUE, JSON_QUERY and JSON_TABLE clause syntax (issue #37)', () => {
  const valid = [
    "SELECT name FROM OPENCYPHER_TABLE(\n    GRAPH WORKSPACE \"MY_SCHEMA\".\"MY_GRAPH\"\n    QUERY 'MATCH (n) RETURN n.name AS name'\n    PARAMETERS (p1 => :iv_param)\n)",
    "SELECT JSON_VALUE(doc, '$.a' RETURNING NVARCHAR(100) DEFAULT 'x' ON EMPTY ERROR ON ERROR) FROM t",
    "SELECT JSON_VALUE(doc, '$.a' DEFAULT -1 ON EMPTY NULL ON ERROR) FROM t",
    "SELECT JSON_QUERY(doc, '$.items' RETURNING JSON WITH WRAPPER EMPTY ON EMPTY ERROR ON ERROR) FROM t",
    "SELECT JSON_QUERY(doc, '$.items' WITHOUT ARRAY WRAPPER EMPTY OBJECT ON ERROR) FROM t",
    "SELECT JSON_QUERY(doc, '$.items' WITH CONDITIONAL ARRAY WRAPPER) FROM t",
    "SELECT * FROM JSON_TABLE(\n    doc,\n    '$'\n    COLUMNS (\n        id INT PATH '$.id',\n        NESTED PATH '$.items[*]' COLUMNS (sku NVARCHAR(20) PATH '$.sku')\n    )\n)",
    "SELECT * FROM JSON_TABLE(doc, '$' COLUMNS (rn FOR ORDINALITY, id INT PATH '$.id' DEFAULT 0 ON EMPTY ERROR ON ERROR, raw NVARCHAR(200) FORMAT JSON PATH '$.raw' WITH UNCONDITIONAL ARRAY WRAPPER EMPTY ARRAY ON EMPTY, NESTED '$.tags[*]' COLUMNS (tag NVARCHAR(20) PATH '$')) ERROR ON ERROR)",
  ];
  for (const lang of ['hanasql', 'hdbprocedure', 'hdbfunction', 'hdbview']) {
    for (const query of valid) {
      const text = wrapForLanguage(lang, query);
      assert.deepEqual(clauseSyntaxDiags(lang, text), [], `${lang}:\n${text}`);
    }
  }
});

test('HANA-SYN-023: OPENCYPHER_TABLE / JSON_* genuine missing commas still reported (issue #37)', () => {
  const params = clauseSyntaxDiags(
    'hanasql',
    "SELECT * FROM OPENCYPHER_TABLE(GRAPH WORKSPACE ws QUERY 'MATCH (n) RETURN n' PARAMETERS (p1 => :a p2 => :b));"
  );
  assert.ok(params.some((d) => d.ruleId === 'HANA-SYN-023' && d.message.includes("'p2'")));

  const jv = clauseSyntaxDiags('hanasql', "SELECT JSON_VALUE(doc '$.a') FROM t;");
  assert.ok(jv.some((d) => d.ruleId === 'HANA-SYN-023' && d.message.includes("'$.a'")));

  const jvType = clauseSyntaxDiags('hanasql', "SELECT JSON_VALUE(doc, '$.a' RETURNING DECIMAL(10 2)) FROM t;");
  assert.ok(jvType.some((d) => d.ruleId === 'HANA-SYN-023'));

  const jtCols = clauseSyntaxDiags(
    'hanasql',
    "SELECT * FROM JSON_TABLE(doc, '$' COLUMNS (id INT PATH '$.id' name NVARCHAR(10) PATH '$.name'));"
  );
  const colDiag = jtCols.find((d) => d.ruleId === 'HANA-SYN-023' && d.message.includes("'name'"));
  assert.ok(colDiag, JSON.stringify(jtCols));
  assert.equal(colDiag.fixes[0].title, "Insert ','");

  const jtOrd = clauseSyntaxDiags('hanasql', "SELECT * FROM JSON_TABLE(doc, '$' COLUMNS (rn FOR ORDINALITY id INT PATH '$.id'));");
  assert.ok(jtOrd.some((d) => d.ruleId === 'HANA-SYN-023' && d.message.includes("'id'")));

  const jtNested = clauseSyntaxDiags(
    'hanasql',
    "SELECT * FROM JSON_TABLE(doc, '$' COLUMNS (NESTED PATH '$.a[*]' COLUMNS (x INT PATH '$.x') id INT PATH '$.id'));"
  );
  assert.ok(jtNested.some((d) => d.ruleId === 'HANA-SYN-023' && d.message.includes("'id'")));

  const jtInner = clauseSyntaxDiags(
    'hanasql',
    "SELECT * FROM JSON_TABLE(doc, '$' COLUMNS (NESTED PATH '$.a[*]' COLUMNS (x INT PATH '$.x' y INT PATH '$.y')));"
  );
  assert.ok(jtInner.some((d) => d.ruleId === 'HANA-SYN-023' && d.message.includes("'y'")));
});

test('HANA-SYN-020/024: IF [NOT] EXISTS and IF NOT <expr> conditions open an IF block (issue #72)', () => {
  const body = (s: string) => `DO BEGIN\n  DECLARE x INT = 0;\n  DECLARE f BOOLEAN = TRUE;\n${s}\nEND;`;
  for (const cond of [
    'EXISTS (SELECT 1 FROM DUMMY)',
    'EXISTS(SELECT 1 FROM DUMMY)',
    'NOT EXISTS (SELECT 1 FROM DUMMY)',
    'EXISTS (SELECT 1 FROM DUMMY) AND x > 0',
    'NOT x > 0',
    'NOT (x > 0)',
    'NOT :f',
    'NOT x IN (SELECT 1 FROM DUMMY)',
  ]) {
    assert.deepEqual(syntaxDiags('hanasql', body(`  IF ${cond} THEN\n    x = 1;\n  ELSE\n    x = 2;\n  END IF;`)), [], cond);
  }
  assert.deepEqual(syntaxDiags('hanasql', body('  IF EXISTS (SELECT 1 FROM DUMMY) THEN x = 1; END IF;')), []);
  assert.deepEqual(
    syntaxDiags('hanasql', body('  FOR i IN 1..2 DO\n    IF EXISTS (SELECT 1 FROM DUMMY) THEN\n      x = 1;\n    END IF;\n  END FOR;')),
    []
  );
  assert.deepEqual(
    syntaxDiags('hdbprocedure', 'PROCEDURE P() AS\nBEGIN\n  DECLARE x INT = 0;\n  IF EXISTS (SELECT 1 FROM DUMMY) THEN\n    x = 1;\n  END IF;\nEND'),
    []
  );

  // Errors inside the condition / body are reported instead of a misleading SYN-020
  const dangling = syntaxDiags('hanasql', body('  IF EXISTS (SELECT 1 FROM DUMMY) AND AND x > 0 THEN\n    x = 1;\n  END IF;'));
  assert.deepEqual(dangling.map((d) => d.ruleId), ['HANA-SYN-024']);
  const missingSemi = syntaxDiags('hanasql', body('  IF EXISTS (SELECT 1 FROM DUMMY) THEN\n    SELECT 1 INTO x FROM DUMMY\n    x = 2;\n  END IF;'));
  assert.deepEqual(missingSemi.map((d) => d.ruleId), ['HANA-SYN-042']);

  // DDL `IF EXISTS` is not an IF block
  assert.deepEqual(syntaxDiags('hanasql', 'DROP TABLE T IF EXISTS;'), []);
  assert.deepEqual(syntaxDiags('hanasql', "DO BEGIN\n  EXEC 'DROP TABLE T IF EXISTS';\n  DROP TABLE T2 IF EXISTS;\nEND;"), []);
});

test('HANA-SYN-024: LEFT( / RIGHT( string functions do not end a condition (issue #73)', () => {
  for (const sql of [
    'SELECT * FROM T WHERE CURRENT_DATE BETWEEN A AND B AND LEFT("COL", 6) = :VAR;',
    'SELECT A FROM T WHERE X = 1 AND LEFT("COL", 6) = 1;',
    "SELECT A FROM T WHERE X = 1 OR LEFT(\"COL\", 6) = 'a';",
    'SELECT A FROM T WHERE X = LEFT("COL", 6);',
    "SELECT A FROM T WHERE X = 1 AND RIGHT (\"COL\", 6) = 'a';",
    'SELECT A FROM T JOIN U ON T.X = U.X AND LEFT(T.C, 2) = U.P;',
    "SELECT A FROM T GROUP BY A HAVING COUNT(*) > 1 AND RIGHT(MAX(A), 1) = 'x';",
    'SELECT A FROM T WHERE X = 1 LEFT JOIN U ON T.A = U.A;',
    'SELECT A FROM T WHERE X = 1 RIGHT OUTER JOIN U ON T.A = U.A;',
  ]) {
    assert.deepEqual(syntaxDiags('hanasql', sql), [], sql);
  }
  const join = syntaxDiags('hanasql', 'SELECT A FROM T WHERE X = 1 AND LEFT JOIN U ON T.A = U.A;');
  assert.ok(join.some((d) => d.ruleId === 'HANA-SYN-024' && /Dangling operator 'AND' before 'LEFT'/.test(d.message)));
});

test('HANA-SYN-023/024: LIKE_REGEXPR FLAG, MERGE branches, WITH RECONFIGURE and cursor parameters (issue #60)', () => {
  for (const sql of [
    "SELECT * FROM t WHERE d NOT LIKE_REGEXPR 'x' FLAG 'i';",
    "SELECT * FROM t WHERE d LIKE_REGEXPR 'x' AND flag = 1;",
    'MERGE INTO t USING s ON t.a = s.a\n  WHEN MATCHED THEN UPDATE SET t.b = s.b\n  WHEN NOT MATCHED THEN INSERT VALUES (s.a, s.b);',
    "ALTER SYSTEM ALTER CONFIGURATION ('indexserver.ini', 'SYSTEM') SET ('a', 'b') = 'c' WITH RECONFIGURE;",
    'DO BEGIN\n  DECLARE CURSOR cur (p INT) FOR SELECT a FROM t WHERE a = :p;\nEND;',
    'DO BEGIN\n  DECLARE CURSOR c_x (lv_var NVARCHAR(10), d DECIMAL(3, 2)) FOR SELECT * FROM T WHERE C = :lv_var;\nEND;',
  ]) {
    assert.deepEqual(syntaxDiags('hanasql', sql), [], sql);
  }

  // Genuine errors in the same constructs are still reported
  const noFlag = syntaxDiags('hanasql', "SELECT * FROM t WHERE d LIKE_REGEXPR 'x' 'i';");
  assert.deepEqual(noFlag.map((d) => d.ruleId), ['HANA-SYN-024']);
  const mergeDangling = syntaxDiags(
    'hanasql',
    'MERGE INTO t USING s ON t.a = s.a\n  WHEN MATCHED THEN UPDATE SET t.b = s.b +\n  WHEN NOT MATCHED THEN INSERT VALUES (s.a, s.b);'
  );
  assert.ok(mergeDangling.some((d) => d.ruleId === 'HANA-SYN-024' && d.message.includes("'+'")));
  const cursor = syntaxDiags('hanasql', 'DO BEGIN\n  DECLARE CURSOR cur (p INT q INT) FOR SELECT a FROM t WHERE a = :p;\nEND;');
  assert.deepEqual(cursor.map((d) => d.ruleId), ['HANA-SYN-023']);
});
