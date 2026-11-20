/**
 * Syntax checks for the artifact languages that had none (#102): the 5 JSON languages, XML well-formedness
 * (`hana-xml.md` §5), CGUL text analysis rules, `.xsxmla`, and the Classic `.hdbrole` `""` escape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, ANALYZER_LANGUAGES } from '../src/analyzer/dispatch';
import { CGUL_SYNTAX_LANGUAGES, XML_SYNTAX_LANGUAGES } from '../src/analyzer/artifact-syntax';
import { parseXmlTree } from '../src/analyzer/xml-parser';
import { applyTextEdits } from '../src/analyzer/types';
import { JSON_ARTIFACT_LANGUAGES } from '../src/formatter/dispatch';

interface Hit {
  readonly rule: string;
  readonly text: string;
}

/** Syntax diagnostics as `{ rule, spanned text }`. */
function syntax(languageId: string, text: string): Hit[] {
  return analyzeDocument({ languageId, text })
    .filter((d) => d.category === 'syntax')
    .map((d) => ({ rule: d.ruleId, text: text.slice(d.start, d.end) }));
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

test('#102: every previously unchecked language is analyzed', () => {
  const unchecked = [
    'hdblogicalschema', 'hdbsysbicsynonym', 'hdbvirtualprocedureconfig', 'hdbvirtualfunctionconfig', 'hdbafllangprocedure',
    'analyticprivilege', 'analyticview', 'attributeview', 'hdbanalyticprivilege', 'hdbflowgraph', 'hdbreptask',
    'hdbsearchruleset', 'hdbtextconfig', 'hdbtextdict', 'hdbtextminingconfig', 'hdbdecisiontable', 'xswidget',
    'hdbtextrule', 'hdbtextinclude', 'hdbtextlexicon', 'xsxmla',
  ];
  for (const lang of unchecked) assert.ok(ANALYZER_LANGUAGES.includes(lang), `${lang} is not in ANALYZER_LANGUAGES`);
  for (const lang of unchecked.slice(0, 5)) assert.ok(JSON_ARTIFACT_LANGUAGES.includes(lang), `${lang} is not a JSON artifact language`);
  for (const lang of ['xscprocedure', 'xscxmlmodel']) assert.ok(XML_SYNTAX_LANGUAGES.includes(lang), `#82 suffix language ${lang} is not checked`);
  assert.deepEqual([...CGUL_SYNTAX_LANGUAGES].sort(), ['hdbtextinclude', 'hdbtextlexicon', 'hdbtextrule']);
});

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------
test('JSON: the 5 newly routed languages report HANA-SYN-010 / -011 and accept valid JSONC', () => {
  const valid = '{\n  // logical schema\n  "LS": { "target": { "schema": "S", "object": "T" } }\n}\n';
  for (const lang of ['hdblogicalschema', 'hdbsysbicsynonym', 'hdbvirtualprocedureconfig', 'hdbvirtualfunctionconfig']) {
    assert.deepEqual(syntax(lang, valid), [], lang);
    assert.deepEqual(syntax(lang, '{ "a": 1 "b": 2 }').map((h) => h.rule), ['HANA-SYN-010'], lang);
    assert.deepEqual(syntax(lang, '{ "a": 1, }').map((h) => h.rule), ['HANA-SYN-011'], lang);
  }
  assert.deepEqual(syntax('hdbafllangprocedure', '{ "procedure": "p", "parameters": [ { "direction": "IN" } }'), [
    { rule: 'HANA-SYN-010', text: '}' },
  ]);
});

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------
test('XML: well-formed documents with declaration, DOCTYPE, comments, CDATA, PIs and entities are clean', () => {
  const doc =
    XML_DECL +
    '<!DOCTYPE widget [ <!ENTITY x "y"> ]>\n' +
    '<widget id="a" title=\'&quot;Orders&quot; &amp; more\'>\n' +
    '  <!-- a comment with <tags> inside -->\n' +
    '  <script><![CDATA[ if (a < b && c > d) {} ]]></script>\n' +
    '  <?render mode="fast"?>\n' +
    '  <tile id="t1"\n        type="static"/>\n' +
    '  <empty></empty>\n' +
    '</widget>\n';
  for (const lang of XML_SYNTAX_LANGUAGES) assert.deepEqual(syntax(lang, doc), [], lang);
  assert.deepEqual(syntax('xswidget', ''), [], 'an empty file is a valid placeholder');
});

test('XML: unterminated attribute value, CDATA and comment (HANA-SYN-001 / -002)', () => {
  assert.deepEqual(syntax('hdbreptask', XML_DECL + '<RepTask>\n  <Target Schema="SALES>\n    <T a="1"/>\n  </Target>\n</RepTask>\n'), [
    { rule: 'HANA-SYN-001', text: '"SALES>' },
  ]);
  assert.deepEqual(syntax('xswidget', '<a><![CDATA[ x\n</a>\n'), [{ rule: 'HANA-SYN-001', text: '<![CDATA[' }]);
  assert.deepEqual(syntax('xswidget', '<a>\n  <!-- open\n  <b/>\n</a>\n'), [{ rule: 'HANA-SYN-002', text: '<!--' }]);
  // An unterminated quote at the end of the file is reported on its own line only.
  assert.deepEqual(syntax('xswidget', '<a>\n<b c="x\n'), [{ rule: 'HANA-SYN-001', text: '"x' }]);
});

test('XML: tags and elements (HANA-SYN-003) with recovery', () => {
  assert.deepEqual(syntax('hdbflowgraph', '<a>\n  <b>\n</a>\n'), [{ rule: 'HANA-SYN-003', text: '</a>' }]);
  assert.deepEqual(syntax('hdbflowgraph', '<a/>\n</b>\n'), [{ rule: 'HANA-SYN-003', text: '</b>' }]);
  assert.deepEqual(syntax('hdbflowgraph', '<a>\n  <b/>\n'), [{ rule: 'HANA-SYN-003', text: '<a>' }]);
  // A start tag without `>` that runs into the next tag is reported by name, and the next tag is still parsed.
  assert.deepEqual(syntax('hdbflowgraph', '<a>\n  <b x="1"\n  <c/>\n</a>\n'), [{ rule: 'HANA-SYN-003', text: '<b' }]);
  assert.deepEqual(syntax('hdbflowgraph', '<a>\n</a\n'), [{ rule: 'HANA-SYN-003', text: '</a' }]);
  assert.deepEqual(syntax('hdbflowgraph', '<?xml version="1.0"\n<a/>\n'), [{ rule: 'HANA-SYN-003', text: '<?' }]);
});

test('XML: malformed attributes (HANA-SYN-012)', () => {
  assert.deepEqual(syntax('hdbdecisiontable', '<a b=c/>'), [{ rule: 'HANA-SYN-012', text: 'b' }]);
  assert.deepEqual(syntax('hdbdecisiontable', '<a b/>'), [{ rule: 'HANA-SYN-012', text: 'b' }]);
  assert.deepEqual(syntax('hdbdecisiontable', '<a b="1" %/>'), [{ rule: 'HANA-SYN-012', text: '%' }]);
});

test('XML: calculation views keep HANA-LINT-101 and get no HANA-SYN rules', () => {
  const broken = XML_DECL + '<Calculation:scenario id="cv">\n  <dataSources>\n</Calculation:scenario>\n';
  const diags = analyzeDocument({ languageId: 'hdbcalculationview', text: broken });
  assert.ok(diags.some((d) => d.ruleId === 'HANA-LINT-101'));
  assert.ok(!diags.some((d) => d.ruleId.startsWith('HANA-SYN-')));
});

test('XML parser: element tree survives recovery', () => {
  const { roots, errors } = parseXmlTree('<a>\n  <b c="x>\n    <d/>\n  </b>\n  <e/>\n</a>\n');
  assert.deepEqual(errors.map((e) => e.kind), ['unterminated-value']);
  assert.equal(roots.length, 1);
  assert.deepEqual(roots[0].children.map((c) => c.tagName), ['b', 'e']);
  assert.deepEqual(roots[0].children[0].children.map((c) => c.tagName), ['d']);
});

// ---------------------------------------------------------------------------
// CGUL
// ---------------------------------------------------------------------------
const CGUL_VALID = [
  '#include <my.ta.rules::common-rules.hdbtextinclude>',
  '#lexicon CITIES <my.ta.rules::common-words.hdbtextlexicon>',
  '// phone numbers',
  '-- also a comment',
  '/* block',
  '   comment <not a token */',
  '#define Digit: [0-9]',
  '#define Name = [A-Z\\]]',
  "#group PHONE (scope=\"sentence\"): <STEM:call> <.*>{0,3} %(Digit)+ => { $number = \"x\"; }",
  "#group POSS: <!POS:Punct> <\"'s\"> [OD Owner]<POS:Prop>[/OD] -> { $1 = 'owner'; }",
].join('\n');

test('CGUL: valid rule files are clean in all three languages', () => {
  for (const lang of CGUL_SYNTAX_LANGUAGES) assert.deepEqual(syntax(lang, CGUL_VALID), [], lang);
});

test('CGUL: unterminated strings and block comments (HANA-SYN-001 / -002)', () => {
  assert.deepEqual(syntax('hdbtextrule', '#group G (scope="sentence): <STEM:call>\n#define D: [0-9]\n'), [
    { rule: 'HANA-SYN-001', text: '"sentence): <STEM:call>' },
  ]);
  assert.deepEqual(syntax('hdbtextinclude', '#define D: [0-9]\n/* open\n<STEM:x>\n'), [{ rule: 'HANA-SYN-002', text: '/*' }]);
});

test('CGUL: unbalanced tokens, classes, groups and blocks (HANA-SYN-003)', () => {
  assert.deepEqual(syntax('hdbtextrule', '#group G: <STEM:call <.*>\n'), [{ rule: 'HANA-SYN-003', text: '<' }]);
  assert.deepEqual(syntax('hdbtextrule', '#group G: <STEM:call\n'), [{ rule: 'HANA-SYN-003', text: '<' }]);
  assert.deepEqual(syntax('hdbtextrule', '#group G: <a> > <b>\n'), [{ rule: 'HANA-SYN-003', text: '>' }]);
  assert.deepEqual(syntax('hdbtextrule', '#define D: [0-9\n'), [{ rule: 'HANA-SYN-003', text: '[' }]);
  assert.deepEqual(syntax('hdbtextrule', '#define D: 0-9]\n'), [{ rule: 'HANA-SYN-003', text: ']' }]);
  assert.deepEqual(syntax('hdbtextlexicon', '#group G: %(Digit+\n'), [{ rule: 'HANA-SYN-003', text: '(' }]);
  assert.deepEqual(syntax('hdbtextrule', '#group G: <a> => { $x = "y";\n'), [{ rule: 'HANA-SYN-003', text: '{' }]);
  // negative: `=>` / `->` are not closers, `[...]` content is literal, `<` inside a comment or string is ignored
  assert.deepEqual(syntax('hdbtextrule', '#group G: <a> -> { } [(<{] "<" // <\n'), []);
});

test('CGUL: misspelled directives get a typo QuickFix; unknown words stay silent (HANA-SYN-021)', () => {
  const src = '#inclde <a::b.hdbtextinclude>\n#grop G: <a>\n#customthing yes\n  #defne D: [0-9]\nx #inclde\n';
  const diags = analyzeDocument({ languageId: 'hdbtextrule', text: src }).filter((d) => d.ruleId === 'HANA-SYN-021');
  assert.deepEqual(diags.map((d) => src.slice(d.start, d.end)), ['#inclde', '#grop', '#defne']);
  assert.equal(applyTextEdits(src, diags[0].fixes[0].edits).split('\n')[0], '#include <a::b.hdbtextinclude>');
  assert.deepEqual(diags.map((d) => d.fixes[0].title), ["Replace with '#include'", "Replace with '#group'", "Replace with '#define'"]);
});

// ---------------------------------------------------------------------------
// .xsxmla and Classic .hdbrole
// ---------------------------------------------------------------------------
test('.xsxmla: comments, names and service blocks', () => {
  const valid = '// XMLA service\nservice namespace "app.sales" {\n  "app.sales::CA_ORDERS" as "OrdersCube"; /* cube */\n}\n';
  assert.deepEqual(syntax('xsxmla', valid), []);
  assert.deepEqual(syntax('xsxmla', 'service {\n  "app.sales::CA_ORDERS as "OrdersCube";\n}\n').map((h) => h.rule), ['HANA-SYN-001']);
  assert.deepEqual(syntax('xsxmla', 'service {\n  "app.sales::CA_ORDERS" as "OrdersCube";\n'), [{ rule: 'HANA-SYN-003', text: '{' }]);
});

test('Classic .hdbrole: "" is an escaped quote and a backslash does not escape', () => {
  const role = (obj: string): string => `role app.sales::Reader {\n  catalog sql object ${obj}: SELECT;\n}\n`;
  assert.deepEqual(syntax('hdbrole', role('"SALES"."ORD""ERS"')), []);
  assert.deepEqual(syntax('hdbrole', role('"SALES"."C:\\TEMP\\"')), [], 'a trailing backslash does not swallow the closing quote');
  assert.deepEqual(syntax('hdbrole', role('"SALES"."ORDERS')).map((h) => h.rule), ['HANA-SYN-001']);
  assert.deepEqual(syntax('hdbrole', role('"SALES"."ORD""ERS')).map((h) => h.rule), ['HANA-SYN-001'], '"" does not close the name');
});
