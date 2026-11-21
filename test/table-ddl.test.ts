/**
 * Table DDL in the consuming clause parser (#78, #101, `docs/specs/grammars/sql-sqlscript.md` §4.12): column
 * definitions, table constraints, index / statistics column lists, partition column lists, window specifications
 * and graph workspace column lists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeDocument } from '../src/analyzer/dispatch';
import { applyTextEdits, DEFAULT_ANALYZER_OPTIONS, type AnalyzerDiagnostic } from '../src/analyzer/types';

const REPO_ROOT = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');

function syntaxDiags(languageId: string, text: string): AnalyzerDiagnostic[] {
  return analyzeDocument({
    languageId,
    text,
    options: { ...DEFAULT_ANALYZER_OPTIONS, security: false, performance: false, migration: false, calculationView: false, syntax: true },
  }).filter((d) => d.category === 'syntax');
}

const blamed = (lang: string, src: string): string[] => syntaxDiags(lang, src).map((d) => `${d.ruleId}:${src.slice(d.start, d.end)}`);

/** Exactly one `HANA-SYN-023` at `at`, whose `Insert ','` QuickFix makes the text clean. */
function assertMissingComma(lang: string, src: string, at: string): void {
  const diags = syntaxDiags(lang, src);
  assert.deepEqual(
    diags.map((d) => `${d.ruleId}:${src.slice(d.start, d.end)}`),
    [`HANA-SYN-023:${at}`],
    `${lang}: ${src}`
  );
  const fix = diags[0].fixes.find((f) => f.title === "Insert ','");
  assert.ok(fix, `${src}: no Insert ',' QuickFix`);
  const fixed = applyTextEdits(src, fix.edits);
  assert.deepEqual(blamed(lang, fixed), [], `after the QuickFix: ${fixed}`);
}

/** Removes the `,` that ends line `line` (1-based) of `text`. */
const dropCommaAtLineEnd = (text: string, line: number): string =>
  text
    .split('\n')
    .map((l, k) => (k === line - 1 ? l.replace(/,(\s*)$/, '$1') : l))
    .join('\n');

test('#101: a missing comma after a column attribute is HANA-SYN-023 (samples/test.hdbtable)', () => {
  const sample = fs.readFileSync(path.join(REPO_ROOT, 'samples', 'test.hdbtable'), 'utf8').replace(/\r\n/g, '\n');
  assert.deepEqual(blamed('hdbtable', sample), []);
  // after `CS_INT NOT NULL`, `DEFAULT CURRENT_TIMESTAMP`, `DEFAULT TRUE` (before `PRIMARY KEY ("ID")`)
  assertMissingComma('hdbtable', dropCommaAtLineEnd(sample, 2), '"NAME"');
  assertMissingComma('hdbtable', dropCommaAtLineEnd(sample, 6), '"IS_ACTIVE"');
  assertMissingComma('hdbtable', dropCommaAtLineEnd(sample, 7), 'PRIMARY');
});

test('#101: missing commas in table types, ALTER TABLE and migration tables', () => {
  assertMissingComma('hdbtabletype', 'TYPE "TT" AS TABLE ("A" INTEGER "B" NVARCHAR(10))', '"B"');
  assertMissingComma('hdbstructure', 'TYPE "TT" AS TABLE ("A" INTEGER DEFAULT 0 "B" NVARCHAR(10))', '"B"');
  assertMissingComma('hanasql', 'CREATE TYPE tt AS TABLE (a INT, b NVARCHAR(10) c INT);', 'c');
  assertMissingComma('hanasql', 'ALTER TABLE t ADD (a INT DEFAULT 0 NOT NULL, b NVARCHAR(10) c INT);', 'c');
  assertMissingComma('hanasql', 'ALTER TABLE t ALTER (a NVARCHAR(20) COMMENT \'x\' b INT);', 'b');
  assertMissingComma('hanasql', 'ALTER TABLE t ALTER (c1 ALTER PAGE LOADABLE c2 ALTER COLUMN LOADABLE);', 'c2');
  assertMissingComma(
    'hdbmigrationtable',
    '== version=2\nCOLUMN TABLE "T" ("ID" INTEGER NOT NULL, "NAME" NVARCHAR(100) "EMAIL" NVARCHAR(120), PRIMARY KEY ("ID"))\n== migration=2\nALTER TABLE "T" ADD ("EMAIL" NVARCHAR(120));',
    '"EMAIL"'
  );
  assertMissingComma('hdbmigrationtable', '== version=2\nCOLUMN TABLE "T" ("ID" INTEGER NOT NULL PRIMARY KEY ("ID"))', 'PRIMARY');
  assertMissingComma('hanasql', 'CREATE LOCAL TEMPORARY TABLE #t (a, b) ADD (id INT x INT) AS (SELECT * FROM u);', 'x');
});

test('#101: missing commas in index, statistics, partition, window and graph workspace column lists', () => {
  assertMissingComma('hdbindex', 'INDEX "IDX" ON "T" ("A" "B")', '"B"');
  assertMissingComma('hdbindex', 'UNIQUE INVERTED VALUE INDEX "IDX" ON "T" ("A" ASC "B" DESC)', '"B"');
  assertMissingComma('hanasql', 'CREATE INDEX idx ON t (a b);', 'b');
  assertMissingComma('hdbstatistics', 'STATISTICS "ST" ON "T" ("A" "B")', '"B"');
  assertMissingComma('hanasql', 'CREATE STATISTICS ON t (a b) TYPE HISTOGRAM;', 'b');
  assertMissingComma('hdbcollectionindex', 'HASH INDEX "IDX" ON "C" ($."a" $."b")', '$');
  assertMissingComma('hanasql', 'CREATE COLUMN TABLE e (a INT, b INT) PARTITION BY HASH (a b) PARTITIONS 4;', 'b');
  assertMissingComma('hdbtable', 'COLUMN TABLE "E" ("A" INT, "B" INT) PARTITION BY HASH ("A") PARTITIONS 2, RANGE ("A" "B") (PARTITION OTHERS)', '"B"');
  assertMissingComma('hanasql', 'SELECT ROW_NUMBER() OVER (PARTITION BY a b ORDER BY c) FROM t;', 'b');
  assertMissingComma('hanasql', 'SELECT RANK() OVER (ORDER BY a DESC b) FROM t;', 'b');
  assertMissingComma(
    'hdbgraphworkspace',
    'GRAPH WORKSPACE "G" EDGE TABLE "E" SOURCE COLUMN "A" "B" TARGET COLUMN "T" KEY COLUMN "K" VERTEX TABLE "V" KEY COLUMN "VK"',
    '"B"'
  );
  const msg = syntaxDiags('hdbcollectionindex', 'HASH INDEX "IDX" ON "C" ($."a" $."b")')[0].message;
  assert.equal(msg, `Expected ',' before index column '$."b"'.`);
});

test('#101: valid table DDL stays free of syntax diagnostics', () => {
  const valid: Array<[string, string]> = [
    ['hanasql', 'CREATE COLUMN TABLE codes (code_id INT PRIMARY KEY, code_key INT UNIQUE BTREE);'],
    ['hanasql', 'CREATE ROW TABLE r (a INT PRIMARY KEY CPBTREE, b INT UNIQUE INVERTED HASH, c INT NOT NULL UNIQUE);'],
    ['hanasql', 'CREATE COLUMN TABLE documents (doc_id INT, body TEXT FAST PREPROCESS OFF LANGUAGE DETECTION (\'EN\', \'DE\'));'],
    [
      'hanasql',
      "CREATE COLUMN TABLE d (c TEXT ASYNC FLUSH QUEUE EVERY 5 MINUTES OR AFTER 10 DOCUMENTS MIME TYPE COLUMN m LANGUAGE COLUMN l PHRASE INDEX RATIO 0.5 SEARCH ONLY OFF TEXT ANALYSIS ON TOKEN SEPARATORS '.' CONFIGURATION 'x', m NVARCHAR(20), l NVARCHAR(2));",
    ],
    [
      'hanasql',
      "CREATE COLUMN TABLE t (a INT, b INT CONSTRAINT fk REFERENCES u (x) ON UPDATE SET NULL ON DELETE CASCADE, c INT GENERATED ALWAYS AS a + b, d NVARCHAR(10) FUZZY SEARCH INDEX ON FUZZY SEARCH MODE 'alphanum', e INT PAGE LOADABLE, f INT NUMA NODE ('1') IMMEDIATE, g CLOB MEMORY THRESHOLD 1000, h INT HIDDEN, i INT DEFAULT 1 NOT NULL COMMENT 'i', j INT AUDIT READ, k NVARCHAR(10) CS_STRING DDIC_CHAR);",
    ],
    ['hanasql', 'CREATE COLUMN TABLE t (id BIGINT GENERATED BY DEFAULT AS IDENTITY (START WITH 1 INCREMENT BY 1), v TIMESTAMP NOT NULL GENERATED ALWAYS AS ROW START COMMIT);'],
    ['hanasql', 'CREATE COLUMN TABLE t (a INT, b INT, CONSTRAINT pk PRIMARY KEY (a, b), FOREIGN KEY (b) REFERENCES u (x) NOT ENFORCED INITIALLY DEFERRED, CHECK (a > 0), UNIQUE BTREE (b));'],
    ['hanasql', 'CREATE COLUMN TABLE t (a INT, text NVARCHAR(10), language NVARCHAR(2), comment NVARCHAR(10), hidden BOOLEAN, page INT);'],
    ['hanasql', 'CREATE COLUMN TABLE t ("A" INT CONSTRAINT "PK" PRIMARY KEY, "B" INT REFERENCES "U" ("X"), "C" TEXT LANGUAGE COLUMN "L", "L" NVARCHAR(2));'],
    ['hanasql', 'CREATE ROW TABLE t7 (id INT PRIMARY KEY, name NVARCHAR(32) CLIENTSIDE ENCRYPTION ON WITH my_cek RANDOM);'],
    ['hanasql', 'CREATE GLOBAL TEMPORARY COLUMN TABLE g (a INT); CREATE LOCAL TEMPORARY TABLE #l (a INT, b NVARCHAR(10)); CREATE HISTORY COLUMN TABLE h (a INT);'],
    ['hanasql', "CREATE COLUMN TABLE p (a INT, y DATE) PARTITION BY HASH (a) PARTITIONS 4, RANGE (YEAR(y)) (PARTITION '2020' <= VALUES < '2025', PARTITION OTHERS);"],
    ['hanasql', 'CREATE COLUMN TABLE p (a INT) PARTITION BY RANGE (a AS INT) (PARTITION 1 <= VALUES < 10, PARTITION OTHERS DYNAMIC THRESHOLD 3);'],
    ['hdbtable', 'COLUMN TABLE "T" ("ID" INTEGER, "N" NVARCHAR(10)) PARTITION BY HASH ("ID") PARTITIONS GET_NUM_SERVERS() UNLOAD PRIORITY 5 AUTO MERGE'],
    ['hanasql', 'CREATE COLUMN TABLE c AS (SELECT * FROM d) WITH NO DATA;'],
    ['hanasql', 'CREATE TABLE c (a, b) AS (SELECT x, y FROM d);'],
    ['hanasql', 'CREATE LOCAL TEMPORARY TABLE #t (a, b) ADD (id INT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1)) AS (SELECT * FROM u);'],
    ['hanasql', 'CREATE TABLE c LIKE d WITH NO DATA;'],
    ['hanasql', 'ALTER TABLE t ADD (a INT DEFAULT 0 NOT NULL, b NVARCHAR(10));'],
    ['hanasql', 'ALTER TABLE t ALTER (c1 INT DEFAULT LOADABLE, c2 INT AUDIT READ, c3 ALTER CLIENTSIDE ENCRYPTION OFF);'],
    ['hanasql', 'ALTER TABLE t DROP (a, b);'],
    ['hanasql', 'ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (a, b);'],
    ['hanasql', 'ALTER TABLE t PARTITION BY HASH (a) PARTITIONS 3;'],
    ['hanasql', 'CREATE UNIQUE INDEX i ON t (a ASC, b DESC) ONLINE;'],
    ['hanasql', 'CREATE FULLTEXT INDEX i ON t (content) ASYNC FAST PREPROCESS OFF;'],
    ['hanasql', 'CREATE STATISTICS ON t (a, b) TYPE HISTOGRAM;'],
    ['hdbstatistics', 'STATISTICS "ST" ON "T" ("A", "B") TYPE HISTOGRAM'],
    ['hdbindex', 'UNIQUE INVERTED VALUE INDEX "IDX" ON "T" ("A" ASC, "B")'],
    ['hdbcollectionindex', 'HASH INDEX "IDX" ON "C" ($."a", $."b".c)'],
    ['hdbfulltextindex', 'FULLTEXT INDEX "I" ON "T" ("C") FAST PREPROCESS OFF'],
    ['hdbtabletype', 'TYPE "TT" AS TABLE ("A" INTEGER, "B" NVARCHAR(10))'],
    [
      'hdbgraphworkspace',
      'GRAPH WORKSPACE "G" EDGE TABLE "E" SOURCE COLUMN "A", "B" REFERENCES "V" TARGET "T" KEY "K" LABEL \'e\' VERTEX TABLE "V" KEY COLUMN "VK" WITH DYNAMIC CACHE',
    ],
    ['hanasql', 'SELECT SUM(x) OVER (PARTITION BY a, b ORDER BY c DESC NULLS LAST ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM t;'],
    ['hanasql', 'SELECT RANK() OVER (ORDER BY a) r, ROW_NUMBER() OVER (PARTITION BY "A" ORDER BY "B" ASC) FROM t;'],
    ['hanasql', 'DO BEGIN DECLARE lt TABLE (a INT, b INT); CREATE LOCAL TEMPORARY TABLE #x (a INT, b INT); END;'],
  ];
  for (const [lang, src] of valid) assert.deepEqual(blamed(lang, src), [], `${lang}: ${src}`);
});

test('#101: misspelled column attribute keywords are HANA-SYN-021 with a QuickFix', () => {
  const cases: Array<[string, string, string]> = [
    ['CREATE COLUMN TABLE t (a INT NOT NULL DEFALT 1);', 'DEFALT', 'DEFAULT'],
    ['CREATE TABLE mytab (i INTEGER PRIMARYKEY);', 'PRIMARYKEY', 'PRIMARY KEY'],
    ['CREATE TABLE mytab (i INTEGER NOTNULL);', 'NOTNULL', 'NOT NULL'],
  ];
  for (const [src, typo, fix] of cases) {
    const d = syntaxDiags('hanasql', src);
    assert.deepEqual(d.map((x) => `${x.ruleId}:${src.slice(x.start, x.end)}`), [`HANA-SYN-021:${typo}`], src);
    assert.equal(d[0].message, `Unknown keyword '${typo}' in column definition. Did you mean '${fix}'?`);
    assert.deepEqual(blamed('hanasql', applyTextEdits(src, d[0].fixes[0].edits)), []);
  }
});

test('#101: statements before a LANGUAGE RLANG / GRAPH routine are still checked', () => {
  const src = 'CREATE COLUMN TABLE t (a INT b INT);\nCREATE PROCEDURE p () LANGUAGE RLANG AS\nBEGIN\n  x <- 1\nEND;';
  assertMissingComma('hanasql', src, 'b');
  // The routine's own parameter list stays with the heuristic, which still reports it.
  assert.ok(blamed('hanasql', 'CREATE PROCEDURE p (IN a INT b INT) LANGUAGE RLANG AS\nBEGIN\n  x <- 1\nEND;').includes('HANA-SYN-023:b'));
});
