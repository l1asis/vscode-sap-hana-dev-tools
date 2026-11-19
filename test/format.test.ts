import test from 'node:test';
import * as assert from 'node:assert';
import { format } from '../src/formatter/formatter';
import { tokenize } from '../src/formatter/tokenizer';
import { EditorOptions, PartialFormatterOptions } from '../src/formatter/options';
import { isKeyValueArtifact } from '../src/formatter/detect';

const ED: EditorOptions = { tabSize: 4, insertSpaces: true, eol: '\n' };
const f = (sql: string, opts: PartialFormatterOptions = {}): string => format(sql, opts, ED);

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
  const out = f('select Coalesce(a,1), cast(b as nvarchar(5)) from MyTab', {
    keywordCase: 'lower',
    functionCase: 'upper',
    dataTypeCase: 'lower',
    identifierCase: 'upper',
  });
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
  const out = f('select "ABC", "abc", "SELECT" from "TAB" where a != b', {
    identifierQuotes: 'removeUnnecessary',
    notEqualOperator: '<>',
    oneItemPerLine: [],
  });
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
  assert.strictEqual(
    out,
    ['BEGIN', '    IF :a = 1 THEN', '        x = 1;', '    ELSEIF :a = 2 THEN', '        x = 2;', '    ELSE', '        x = 3;', '    END IF;', 'END', ''].join('\n')
  );
});

test('empty input', () => assert.strictEqual(f(''), ''));

test('XS Classic key=value artifacts are detected (formatter must skip them)', () => {
  assert.ok(isKeyValueArtifact('table.schemaName = "S";\ntable.tableType = COLUMNSTORE;'));
  assert.ok(isKeyValueArtifact('// comment\nschema="MYSCHEMA";\nquery="SELECT 1";'));
  assert.ok(isKeyValueArtifact('schema_name="X";'));
  assert.ok(!isKeyValueArtifact('COLUMN TABLE "T" ("A" INT)'));
  assert.ok(!isKeyValueArtifact('-- c\nVIEW "V" AS SELECT 1 FROM DUMMY'));
  assert.ok(!isKeyValueArtifact('PROCEDURE "P" () AS BEGIN END'));
  assert.ok(!isKeyValueArtifact(''));
});

test('SQLScript library calls and ALTER SYSTEM statements (Administration Guide samples)', () => {
  assert.match(f('begin using sqlscript_string as lib; x = lib:split_to_table(:a, char(10)); end'), /x = lib:split_to_table\(:a, CHAR\(10\)\);/);
  assert.strictEqual(f("alter system create waitgraph at location 'h:30003' into file 'w.trc'"), "ALTER SYSTEM CREATE WAITGRAPH AT LOCATION 'h:30003' INTO FILE 'w.trc'\n");
  assert.match(f('alter system clear traces;'), /^ALTER SYSTEM CLEAR TRACES;/);
  assert.match(f('select source, service from t'), /source,\n {4}service/); // identifiers keep their case
});

test('headerless HDI collection indexes and fabric virtual tables format safely', () => {
  const hIdx = f('hash index "CUSTOMERS_LASTNAME" on "CUSTOMERS"($."lastName")', { trailingSemicolon: 'add' });
  assert.strictEqual(hIdx, 'HASH INDEX "CUSTOMERS_LASTNAME" ON "CUSTOMERS"($."lastName")\n');

  const adjIdx = f('adjacency index "GRAPH_ADJ" on "GRAPH_COL" (ID "id", SOURCE "source", TARGET "target", TYPE "type")', { trailingSemicolon: 'add' });
  assert.ok(adjIdx.startsWith('ADJACENCY INDEX "GRAPH_ADJ" ON "GRAPH_COL"'));
  assert.ok(!adjIdx.trimEnd().endsWith(';'));

  const fvt = f('shared snapshot replica page loadable on "MY_VIRTUAL_TABLE"', { trailingSemicolon: 'add' });
  assert.strictEqual(fvt, 'SHARED SNAPSHOT REPLICA PAGE LOADABLE ON "MY_VIRTUAL_TABLE"\n');

  // Negative check: non-HDI root statements still receive semicolons under trailingSemicolon: "add"
  const regularSql = f('select "source" from "MY_TABLE"', { trailingSemicolon: 'add' });
  assert.ok(regularSql.trimEnd().endsWith(';'));
});

test('hexadecimal numeric literal stays one token (#88)', () => {
  assert.strictEqual(
    f('SELECT 0x0abc "hex_value" FROM DUMMY;'),
    ['SELECT 0x0abc "hex_value"', 'FROM DUMMY;', ''].join('\n')
  );
  assert.strictEqual(f('select 0X1F, 0xff from dummy'), ['SELECT', '    0X1F,', '    0xff', 'FROM dummy', ''].join('\n'));
});

test('tokenizer: 0x prefix without hex digits is not a hex literal (#88)', () => {
  const pieces = (s: string): string[] => tokenize(s).map((t) => `${t.type}:${t.text}`);
  assert.deepStrictEqual(pieces('0x1F'), ['number:0x1F']);
  assert.deepStrictEqual(pieces('0xg'), ['number:0', 'word:xg']);
  assert.deepStrictEqual(pieces('0x'), ['number:0', 'word:x']);
  assert.deepStrictEqual(pieces('10x1'), ['number:10', 'word:x1']);
});

test('HIERARCHY* calls put one clause per line and case clause keywords only in clause position (#75)', () => {
  const src =
    'select * from hierarchy (source (select "ID" as node_id, "PARENT" as parent_id from "T" order by "ID") ' +
    'sibling order by "ID" depth 3 start where "PARENT" is null and depth = 1 cache force multiparent load bulk orphan root cycle breakup) ' +
    'order by hierarchy_rank;';
  const out = f(src);
  assert.strictEqual(
    out,
    [
      'SELECT *',
      'FROM HIERARCHY(',
      '    SOURCE (',
      '        SELECT',
      '            "ID" AS node_id,',
      '            "PARENT" AS parent_id',
      '        FROM "T"',
      '        ORDER BY "ID"',
      '    )',
      '    SIBLING ORDER BY "ID"',
      '    DEPTH 3',
      '    START WHERE "PARENT" IS NULL AND depth = 1',
      '    CACHE FORCE',
      '    MULTIPARENT',
      '    LOAD BULK',
      '    ORPHAN ROOT',
      '    CYCLE BREAKUP',
      ')',
      'ORDER BY hierarchy_rank;',
      '',
    ].join('\n')
  );
  assert.strictEqual(f(out), out, 'idempotent');

  // nested generator, navigation and aggregate clauses, two-word clause keywords
  assert.strictEqual(
    f("select n from hierarchy_descendants(source hierarchy(source t) start where n = 'R' distance from 1 to 2) h"),
    ['SELECT n', 'FROM HIERARCHY_DESCENDANTS(', '    SOURCE HIERARCHY(', '        SOURCE t', '    )', "    START WHERE n = 'R'", '    DISTANCE FROM 1 TO 2', ') h', ''].join('\n')
  );
  assert.strictEqual(
    f("select * from hierarchy_descendants_aggregate(source h join f on f.n = h.n measures (sum(f.v) as total) with subtotal 'x' with not matched)"),
    [
      'SELECT *',
      'FROM HIERARCHY_DESCENDANTS_AGGREGATE(',
      '    SOURCE h',
      '    JOIN f ON f.n = h.n',
      '    MEASURES (SUM(f.v) AS total)',
      "    WITH SUBTOTAL 'x'",
      '    WITH NOT MATCHED',
      ')',
      '',
    ].join('\n')
  );
  assert.strictEqual(
    f('select * from hierarchy_temporal(source t sibling order by a valid from :d1 excluded until :d2 excluded no cache)'),
    ['SELECT *', 'FROM HIERARCHY_TEMPORAL(', '    SOURCE t', '    SIBLING ORDER BY a', '    VALID FROM :d1 EXCLUDED UNTIL :d2 EXCLUDED', '    NO CACHE', ')', ''].join('\n')
  );

  // negative: outside a hierarchy call the same words are identifiers, and an ordinary call stays on one line
  assert.strictEqual(f('select source, depth from t where cache = 1'), ['SELECT', '    source,', '    depth', 'FROM t', 'WHERE cache = 1', ''].join('\n'));
  assert.strictEqual(f('select hierarchy_composite_id(a, b) from t'), ['SELECT HIERARCHY_COMPOSITE_ID(a, b)', 'FROM t', ''].join('\n'));
});

test('HIERARCHY* layout keeps comments and -- hanasql-format off regions (#75)', () => {
  const src = [
    'select * from hierarchy ( -- generator',
    '  source t /* src */ sibling order by a',
    '  -- hanasql-format off',
    '  ORPHAN   root',
    '  -- hanasql-format on',
    '  cycle breakup);',
  ].join('\n');
  const out = f(src);
  assert.strictEqual(
    out,
    [
      'SELECT *',
      'FROM HIERARCHY( -- generator',
      '    SOURCE t /* src */',
      '    SIBLING ORDER BY a',
      '-- hanasql-format off',
      '  ORPHAN   root',
      '  -- hanasql-format on',
      '    CYCLE BREAKUP',
      ');',
      '',
    ].join('\n')
  );
  assert.strictEqual(f(out), out, 'idempotent');
});
