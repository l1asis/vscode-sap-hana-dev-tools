'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { format } = require('../src/formatter/formatter');

const ED = { tabSize: 4, insertSpaces: true, eol: '\n' };
const f = (sql, opts = {}) => format(sql, opts, ED);

test('basic SELECT layout, keyword case, one item per line', () => {
  assert.strictEqual(
    f('select a,b from t where x=1 and y=2 order by a'),
    ['SELECT', '    a,', '    b', 'FROM t', 'WHERE x = 1', '    AND y = 2', 'ORDER BY a', ''].join('\n')
  );
});

test('leading commas', () => {
  const out = f('select a,b,c from t', { commaPosition: 'leading' });
  assert.match(out, /^SELECT\n {4}a\n {2}, b\n {2}, c\nFROM t\n$/);
});

test('idempotent', () => {
  const once = f('create procedure p(in a int) as begin if :a=1 then select 1 from dummy; end if; end');
  assert.strictEqual(f(once), once);
});

test('keyword / function / type / identifier case', () => {
  const out = f('select Coalesce(a,1), cast(b as nvarchar(5)) from MyTab', { keywordCase: 'lower', functionCase: 'upper', dataTypeCase: 'lower', identifierCase: 'upper' });
  assert.match(out, /select/);
  assert.match(out, /COALESCE\(/);
  assert.match(out, /nvarchar\(5\)/);
  assert.match(out, /from MYTAB/);
});

test('strings and quoted identifiers are never modified', () => {
  const out = f(`select 'select  FROM''x', "Mixed Case" from t`, { keywordCase: 'lower', identifierCase: 'lower' });
  assert.ok(out.includes(`'select  FROM''x'`));
  assert.ok(out.includes('"Mixed Case"'));
});

test('operator spacing, unary minus and wildcards', () => {
  assert.match(f('select a+b, -1, count(*), t.* from t', { oneItemPerLine: [] }), /a \+ b, -1, COUNT\(\*\), t\.\*/);
  assert.match(f('select a+b from t', { spacesAroundOperators: false }), /a\+b/);
});

test('max line length wraps after commas', () => {
  const out = f('select fn(argument_number_one, argument_number_two, argument_number_three) from t', { maxLineLength: 50 });
  assert.ok(out.split('\n').every((l) => l.length <= 50));
});

test('BETWEEN ... AND is not a logical break', () => {
  assert.match(f('select 1 from t where a between 1 and 2 and b = 3'), /WHERE a BETWEEN 1 AND 2\n {4}AND b = 3/);
});

test('trailingSemicolon add / remove, HDI root is left alone', () => {
  assert.match(f('begin\n x = 1\nend', { trailingSemicolon: 'add' }), /x = 1;\nEND;\n$/);
  assert.strictEqual(f('select 1 from dummy;', { trailingSemicolon: 'remove' }), 'SELECT 1\nFROM dummy\n');
  assert.doesNotMatch(f('procedure "p" () as begin select 1 from dummy; end', { trailingSemicolon: 'add' }), /END;/);
});

test('blank line handling', () => {
  const src = 'select 1 from dummy;\n\n\n\nselect 2 from dummy;';
  assert.match(f(src, { blankLinesBetweenTopLevelStatements: 1 }), /;\n\nSELECT 2/);
  assert.match(f(src, { blankLinesBetweenTopLevelStatements: 0 }), /;\nSELECT 2/);
  assert.match(f('begin\n\n a=1;\n\nend;'), /BEGIN\n {4}a = 1;\nEND;/);
});

test('format off region is kept verbatim', () => {
  const out = f('-- hanasql-format off\nselect   a,b   from t;\n-- hanasql-format on\nselect 1 from dummy;');
  assert.ok(out.includes('select   a,b   from t;'));
});

test('unnecessary quotes and != normalization', () => {
  const out = f('select "ABC", "abc", "SELECT" from "TAB" where a != b', { identifierQuotes: 'removeUnnecessary', notEqualOperator: '<>', oneItemPerLine: [] });
  assert.ok(out.includes('ABC, "abc", "SELECT"'));
  assert.ok(out.includes('FROM TAB'));
  assert.ok(out.includes('a <> b'));
});

test('tabs and CRLF', () => {
  const out = format('select a,b from t', { indentStyle: 'tabs' }, { tabSize: 4, insertSpaces: true, eol: '\r\n' });
  assert.ok(out.includes('\r\n\ta,\r\n\tb\r\n'));
});

test('control flow indentation', () => {
  const out = f('begin if :a=1 then x=1; elseif :a=2 then x=2; else x=3; end if; end');
  assert.strictEqual(out, ['BEGIN', '    IF :a = 1 THEN', '        x = 1;', '    ELSEIF :a = 2 THEN', '        x = 2;', '    ELSE', '        x = 3;', '    END IF;', 'END', ''].join('\n'));
});

test('empty input', () => assert.strictEqual(f(''), ''));
