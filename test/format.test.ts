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

// ---------------------------------------------------------------------------
// embeddedQueryLayout (docs/specs/artifacts/sql-formatting.md §5.1, #64)
// ---------------------------------------------------------------------------

const EMBED_SRC =
  'begin lt = select o.order_id, o.customer_id from orders o inner join order_items i on o.order_id = i.order_id ' +
  'where o.customer_id = :iv_customer and o.status = 1 order by amount desc; end';
const LAYOUTS = ['hanging', 'aligned', 'newLine'] as const;
const lines = (...l: string[]): string => [...l, ''].join('\n');

test('embeddedQueryLayout: hanging (default) indents the clauses one level under the statement', () => {
  const expected = lines(
    'BEGIN',
    '    lt = SELECT',
    '            o.order_id,',
    '            o.customer_id',
    '        FROM orders o',
    '        INNER JOIN order_items i',
    '            ON o.order_id = i.order_id',
    '        WHERE o.customer_id = :iv_customer',
    '            AND o.status = 1',
    '        ORDER BY amount DESC;',
    'END'
  );
  assert.strictEqual(f(EMBED_SRC), expected);
  assert.strictEqual(f(EMBED_SRC, { embeddedQueryLayout: 'hanging' }), expected);
});

test('embeddedQueryLayout: aligned puts the clauses at the column of SELECT', () => {
  assert.strictEqual(
    f(EMBED_SRC, { embeddedQueryLayout: 'aligned' }),
    lines(
      'BEGIN',
      '    lt = SELECT',
      '             o.order_id,',
      '             o.customer_id',
      '         FROM orders o',
      '         INNER JOIN order_items i',
      '             ON o.order_id = i.order_id',
      '         WHERE o.customer_id = :iv_customer',
      '             AND o.status = 1',
      '         ORDER BY amount DESC;',
      'END'
    )
  );
});

test('embeddedQueryLayout: newLine breaks after = and moves the whole query one level deeper', () => {
  assert.strictEqual(
    f(EMBED_SRC, { embeddedQueryLayout: 'newLine' }),
    lines(
      'BEGIN',
      '    lt =',
      '        SELECT',
      '            o.order_id,',
      '            o.customer_id',
      '        FROM orders o',
      '        INNER JOIN order_items i',
      '            ON o.order_id = i.order_id',
      '        WHERE o.customer_id = :iv_customer',
      '            AND o.status = 1',
      '        ORDER BY amount DESC;',
      'END'
    )
  );
});

test('embeddedQueryLayout: WITH, set operators and := follow the layout', () => {
  const src = 'begin lt := with c as (select a from t) select a from c union all select b from u; end';
  assert.strictEqual(
    f(src),
    lines(
      'BEGIN',
      '    lt := WITH c AS (',
      '            SELECT a',
      '            FROM t',
      '        )',
      '        SELECT a',
      '        FROM c',
      '        UNION ALL',
      '        SELECT b',
      '        FROM u;',
      'END'
    )
  );
  assert.strictEqual(
    f(src, { embeddedQueryLayout: 'aligned' }),
    lines(
      'BEGIN',
      '    lt := WITH c AS (',
      '              SELECT a',
      '              FROM t',
      '          )',
      '          SELECT a',
      '          FROM c',
      '          UNION ALL',
      '          SELECT b',
      '          FROM u;',
      'END'
    )
  );
  assert.strictEqual(
    f(src, { embeddedQueryLayout: 'newLine' }),
    lines(
      'BEGIN',
      '    lt :=',
      '        WITH c AS (',
      '            SELECT a',
      '            FROM t',
      '        )',
      '        SELECT a',
      '        FROM c',
      '        UNION ALL',
      '        SELECT b',
      '        FROM u;',
      'END'
    )
  );
  // several CTEs: each comma breaks to the query's clause level
  assert.match(
    f('begin lt = with a as (select 1 x from dummy), b as (select 2 y from dummy) select * from a, b; end'),
    /\n {8}\),\n {8}b AS \(\n {12}SELECT 2 y\n/
  );
});

test('embeddedQueryLayout: RETURN SELECT and sub-queries are relative to the new base', () => {
  const src = 'create function f() returns table(a int) as begin return select a from (select a from t) s where a > 0; end';
  assert.match(f(src), /\n {4}RETURN SELECT a\n {8}FROM \(\n {12}SELECT a\n {12}FROM t\n {8}\) s\n {8}WHERE a > 0;\nEND\n$/);
  assert.match(
    f(src, { embeddedQueryLayout: 'aligned' }),
    /\n {4}RETURN SELECT a\n {11}FROM \(\n {15}SELECT a\n {15}FROM t\n {11}\) s\n {11}WHERE a > 0;\nEND\n$/
  );
  // a sub-query on the prefix line, without and with a broken select list
  assert.match(
    f('begin lt = select (select max(x) from u) as m from t; end'),
    /lt = SELECT \(\n {12}SELECT MAX\(x\)\n {12}FROM u\n {8}\) AS m\n {8}FROM t;/
  );
  assert.match(
    f('begin lt = select (select max(x) from u) as m, b from t; end'),
    /lt = SELECT\n {12}\(\n {16}SELECT MAX\(x\)\n {16}FROM u\n {12}\) AS m,\n {12}b\n {8}FROM t;/
  );
  // CASE expressions in the select list
  assert.match(
    f("begin lt = select case when a = 1 then 'x' else 'y' end as c, b from t; end", { embeddedQueryLayout: 'aligned' }),
    /\n {13}CASE\n {17}WHEN a = 1 THEN 'x'\n {17}ELSE 'y'\n {13}END AS c,\n {13}b\n {9}FROM t;/
  );
});

test('embeddedQueryLayout: aligned falls back to hanging for tabs and long prefixes', () => {
  assert.strictEqual(
    f('begin lt = select a, b from t; end', { embeddedQueryLayout: 'aligned', indentStyle: 'tabs' }),
    lines('BEGIN', '\tlt = SELECT', '\t\t\ta,', '\t\t\tb', '\t\tFROM t;', 'END')
  );
  // SELECT starts at column 42 > 40 / 2
  const long = 'begin lt_a_very_long_result_variable_name = select a, b from t; end';
  assert.match(f(long, { embeddedQueryLayout: 'aligned', maxLineLength: 40 }), /= SELECT\n {12}a,\n {12}b\n {8}FROM t;/);
  // without a line limit it aligns
  assert.match(f(long, { embeddedQueryLayout: 'aligned', maxLineLength: 0 }), /= SELECT\n {46}a,\n {46}b\n {42}FROM t;/);
});

test('embeddedQueryLayout: a line comment after the prefix gives the newLine layout for every value', () => {
  for (const embeddedQueryLayout of LAYOUTS) {
    assert.strictEqual(
      f('begin lt = -- note\n select a, b from t; end', { embeddedQueryLayout }),
      lines('BEGIN', '    lt = -- note', '        SELECT', '            a,', '            b', '        FROM t;', 'END'),
      embeddedQueryLayout
    );
  }
  // a block comment stays in the prefix and counts for the aligned column
  assert.match(
    f('begin lt /* c */ = select a, b from t; end', { embeddedQueryLayout: 'aligned' }),
    /lt \/\* c \*\/ = SELECT\n {21}a,\n {21}b\n {17}FROM t;/
  );
});

test('embeddedQueryLayout: interacts with leading commas, inline lists, joins, logical operators and wrapping', () => {
  const src = 'begin lt = select a, b from t where x = 1; end';
  assert.match(f(src, { commaPosition: 'leading' }), /lt = SELECT\n {12}a\n {10}, b\n {8}FROM t\n/);
  assert.match(f(src, { commaPosition: 'leading', embeddedQueryLayout: 'aligned' }), /lt = SELECT\n {13}a\n {11}, b\n {9}FROM t\n/);
  assert.match(f(src, { oneItemPerLine: [] }), /lt = SELECT a, b\n {8}FROM t\n {8}WHERE x = 1;/);
  assert.match(
    f('begin lt = select a from t inner join u on t.id = u.id; end', { joinOnNewLine: false, embeddedQueryLayout: 'aligned' }),
    /lt = SELECT a\n {9}FROM t\n {9}INNER JOIN u ON t.id = u.id;/
  );
  assert.match(f('begin lt = select a from t where x = 1 or y = 2; end', { logicalOperatorPosition: 'after' }), /\n {8}WHERE x = 1 OR\n {12}y = 2;/);
  assert.match(f('begin lt = select a from t where x = 1 or y = 2; end', { breakLogicalOperators: false }), /\n {8}WHERE x = 1 OR y = 2;/);
  // a wrapped prefix line continues under the select list, not at the clause level
  const wide = 'begin lt = select aaaaaaaaaa, bbbbbbbbbbbb, cccccccccccc, dddddddddd from t; end';
  assert.match(
    f(wide, { oneItemPerLine: [], maxLineLength: 40 }),
    /lt = SELECT aaaaaaaaaa,\n {12}bbbbbbbbbbbb, cccccccccccc,\n {12}dddddddddd\n {8}FROM t;/
  );
  assert.match(
    f(wide, { oneItemPerLine: [], maxLineLength: 40, embeddedQueryLayout: 'aligned' }),
    /lt = SELECT aaaaaaaaaa,\n {13}bbbbbbbbbbbb, cccccccccccc,\n {13}dddddddddd\n {9}FROM t;/
  );
});

test('embeddedQueryLayout: an unterminated query does not leak its layout into END / ELSE', () => {
  assert.strictEqual(
    f('begin if :a = 1 then lt = select a from t where x = 1 else lt = select b from u; end if; end', { embeddedQueryLayout: 'aligned' }),
    lines(
      'BEGIN',
      '    IF :a = 1 THEN',
      '        lt = SELECT a',
      '             FROM t',
      '             WHERE x = 1',
      '    ELSE',
      '        lt = SELECT b',
      '             FROM u;',
      '    END IF;',
      'END'
    )
  );
  assert.match(f('begin lt = select a from t\nend', { embeddedQueryLayout: 'aligned', trailingSemicolon: 'add' }), /\n {9}FROM t;\nEND;\n$/);
});

test('embeddedQueryLayout: other embedded queries keep their layout under every value', () => {
  const unaffected: Array<[string, string]> = [
    ['begin lv := (select max(a) from t where b = 1); end', lines('BEGIN', '    lv := (', '        SELECT MAX(a)', '        FROM t', '        WHERE b = 1', '    );', 'END')],
    ['create view v as select a, b from t where x = 1', lines('CREATE VIEW v AS', 'SELECT', '    a,', '    b', 'FROM t', 'WHERE x = 1')],
    ['begin declare cursor c for select a from t; end', lines('BEGIN', '    DECLARE CURSOR c FOR', '    SELECT a', '    FROM t;', 'END')],
    ['begin declare tv table (col1 int) = select * from mytab; end', lines('BEGIN', '    DECLARE tv TABLE (col1 INT) =', '    SELECT *', '    FROM mytab;', 'END')],
    ['insert into t (a, b) select a, b from u', lines('INSERT INTO t (a, b)', 'SELECT', '    a,', '    b', 'FROM u')],
    ['begin select count(*) into ev_count from :lt; end', lines('BEGIN', '    SELECT COUNT(*)', '    INTO ev_count', '    FROM :lt;', 'END')],
    [
      'begin lt = unnest(:arr) as (a); x = 1 + (select 1 from dummy); end',
      lines('BEGIN', '    lt = UNNEST(:arr) AS (a);', '    x = 1 + (', '        SELECT 1', '        FROM dummy', '    );', 'END'),
    ],
    ['select a from t where a in (select b from u)', lines('SELECT a', 'FROM t', 'WHERE a IN (', '    SELECT b', '    FROM u', ')')],
  ];
  for (const embeddedQueryLayout of LAYOUTS) {
    for (const [src, expected] of unaffected) assert.strictEqual(f(src, { embeddedQueryLayout }), expected, `${embeddedQueryLayout}: ${src}`);
  }
});

test('embeddedQueryLayout: idempotent, keeps comments and format-off regions', () => {
  const srcs = [
    EMBED_SRC,
    'begin lt = with a as (select 1 x from dummy), b as (select 2 y from dummy) select * from a, b; end',
    'begin return select a from (select a from t) s where a > 0 union select b from u; end',
    'begin lt = select a, -- first\n b /* second */ from t -- trail\nwhere x = 1; end',
    'begin lt = -- note\n select a from t; end',
    'begin\n-- hanasql-format off\nlt = select   a\nfrom t;\n-- hanasql-format on\nlt2 = select a, b from t; end',
  ];
  const extras: PartialFormatterOptions[] = [{}, { commaPosition: 'leading' }, { indentStyle: 'tabs' }, { maxLineLength: 30, oneItemPerLine: [] }];
  for (const embeddedQueryLayout of LAYOUTS) {
    for (const extra of extras) {
      for (const src of srcs) {
        const opts: PartialFormatterOptions = { ...extra, embeddedQueryLayout };
        const once = f(src, opts);
        assert.strictEqual(f(once, opts), once, `${JSON.stringify(opts)}: ${src}`);
        for (const c of ['-- first', '/* second */', '-- trail', '-- note']) if (src.includes(c)) assert.ok(once.includes(c), c);
        if (src.includes('format off')) assert.ok(once.includes('lt = select   a\nfrom t;'), 'format-off region');
      }
    }
  }
});

test('embeddedQueryLayout: invalid values fall back to hanging', () => {
  assert.strictEqual(f(EMBED_SRC, { embeddedQueryLayout: 'flush' as never }), f(EMBED_SRC));
});

// #107: an unterminated literal runs to the end of the text, but trailing whitespace there is
// layout. Pass 2 sees pass 1's final newline, which must not widen the token and change wrapping.
test('unterminated string / quoted identifier at maxLineLength: idempotent (#107)', () => {
  const o: PartialFormatterOptions = { maxLineLength: 17, oneItemPerLine: [] };
  for (const src of ["SELECT aaaa, 'bbb", 'SELECT aaaa, "bbb']) {
    const once = f(src, o);
    assert.strictEqual(once, src + '\n');
    assert.strictEqual(f(once, o), once, `idempotent: ${src}`);
  }
  // Trailing whitespace in the input is layout too: the line still fits.
  assert.strictEqual(f("SELECT aaaa, 'bbb  \n\n", o), "SELECT aaaa, 'bbb\n");
});

test('unterminated literal keeps its content verbatim, only trailing whitespace is dropped (#107)', () => {
  const pieces = (s: string): string[] => tokenize(s).map((t) => `${t.type}:${t.text}`);
  assert.deepEqual(pieces("x 'a  b\n  c \n"), ['word:x', "string:'a  b\n  c"]);
  assert.deepEqual(pieces('x "a  b \t'), ['word:x', 'qident:"a  b']);
  assert.deepEqual(pieces("x N'ab \n"), ['word:x', "string:N'ab"]);
  assert.deepEqual(pieces("x '  \n"), ['word:x', "string:'"]);
  // Negative: terminated literals keep whitespace inside the quotes.
  assert.deepEqual(pieces("x 'ab  ' \n"), ['word:x', "string:'ab  '"]);
  assert.deepEqual(pieces('x "ab  " \n'), ['word:x', 'qident:"ab  "']);
  // Negative: an unterminated block comment was never affected and still runs to the end.
  const comment = f('SELECT aaaa, /*bb', { maxLineLength: 17, oneItemPerLine: [] });
  assert.strictEqual(comment, 'SELECT aaaa, /*bb\n');
  assert.strictEqual(f(comment, { maxLineLength: 17, oneItemPerLine: [] }), comment);
});
