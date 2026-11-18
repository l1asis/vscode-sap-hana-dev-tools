/**
 * Committed conformance fixture suite (#76).
 *
 * Every case in `test/fixtures/conformance/*.sql` is valid SQL / SQLScript and must produce zero
 * `HANA-SYN-*` diagnostics, satisfy the formatter invariants, and leave no catalog keyword
 * unscoped by the grammar. A case marked `-- @todo #N <reason>` is a known failure: it is reported
 * as a TODO while it still fails, and fails the suite as soon as it passes, so the marker is removed
 * in the same PR that fixes it.
 *
 * Fixture format and invariants: docs/specs/diagnostics/conformance-harness.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CONFORMANCE_CHECKS,
  REPO_ROOT,
  blockHash,
  evaluate,
  extractSqlBlocks,
  formatOffRegions,
  formatterViolations,
  isTemplate,
  problems,
  unknownCalls,
  unscopedKeywords,
  type ConformanceCheck,
} from './helpers/conformance';

const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'conformance');

interface FixtureCase {
  readonly file: string;
  readonly title: string;
  readonly line: number;
  readonly text: string;
  readonly languageId: string;
  /** Known failures, per check: `-- @todo <syntax|formatter|grammar> #N <reason>`. */
  readonly todo: ReadonlyMap<ConformanceCheck, string>;
}

function parseFixture(file: string, source: string): FixtureCase[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const cases: FixtureCase[] = [];
  let current: { title: string; line: number; body: string[]; languageId: string; todo: Map<ConformanceCheck, string> } | null = null;
  const flush = (): void => {
    if (!current) return;
    const text = current.body.join('\n').trim();
    assert.ok(text, `${file}:${current.line}: case "${current.title}" is empty`);
    cases.push({ file, title: current.title, line: current.line, text, languageId: current.languageId, todo: current.todo });
  };
  lines.forEach((raw, i) => {
    const caseMatch = /^-- @case\s+(.+)$/.exec(raw);
    if (caseMatch) {
      flush();
      current = { title: caseMatch[1].trim(), line: i + 1, body: [], languageId: 'hanasql', todo: new Map() };
      return;
    }
    if (!current) {
      assert.ok(raw.trim() === '' || raw.startsWith('--'), `${file}:${i + 1}: content before the first "-- @case"`);
      return;
    }
    const directive = /^-- @(todo|lang)\s+(.+)$/.exec(raw);
    if (directive && current.body.length === 0) {
      if (directive[1] === 'lang') {
        current.languageId = directive[2].trim();
        return;
      }
      const todo = /^(\w+)\s+(#\d+\b.*)$/.exec(directive[2].trim());
      assert.ok(
        todo && (CONFORMANCE_CHECKS as readonly string[]).includes(todo[1]),
        `${file}:${i + 1}: expected "-- @todo <${CONFORMANCE_CHECKS.join('|')}> #N <reason>"`
      );
      const check = todo[1] as ConformanceCheck;
      assert.ok(!current.todo.has(check), `${file}:${i + 1}: duplicate @todo ${check}`);
      current.todo.set(check, todo[2]);
      return;
    }
    current.body.push(raw);
  });
  flush();
  return cases;
}

const fixtureFiles = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.sql')).sort();
const allCases = fixtureFiles.flatMap((f) => parseFixture(f, fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')));

test('conformance fixtures: suite is seeded and well-formed', () => {
  assert.ok(fixtureFiles.length >= 6, `expected one fixture file per statement family, found ${fixtureFiles.length}`);
  assert.ok(allCases.length >= 60, `expected >= 60 conformance cases, found ${allCases.length}`);
  const seen = new Map<string, string>();
  for (const c of allCases) {
    const key = `${c.file}::${c.title}`;
    assert.ok(!seen.has(key), `duplicate case title "${c.title}" in ${c.file}`);
    seen.set(key, key);
  }
  assert.ok(
    allCases.some((c) => c.todo.get('syntax')),
    'the confirmed analyzer false positives from #76 are seeded as "@todo syntax" cases'
  );
});

for (const c of allCases) {
  const name = `conformance ${c.file}:${c.line} ${c.title}`;
  const result = evaluate(c.text, c.languageId);
  const enforced = CONFORMANCE_CHECKS.filter((check) => !c.todo.has(check));
  // Every check without a known-failure marker must pass.
  test(name, () => {
    assert.deepEqual(
      enforced.flatMap((check) => problems(result, check, c.text)),
      [],
      `\n${c.text}\n`
    );
  });
  // A known failure is reported as TODO while it fails, and fails the suite once it passes.
  for (const [check, reason] of c.todo) {
    const found = problems(result, check, c.text);
    if (found.length === 0) {
      test(`${name} [${check} todo]`, () => {
        assert.fail(`known ${check} failure (${reason}) now passes: remove its "-- @todo ${check}" marker from ${c.file}:${c.line}`);
      });
    } else {
      test(`${name} [${check} todo]`, { todo: `${reason} | ${found.join(' | ')}` }, () => {
        assert.deepEqual(found, []);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The harness checks themselves (positive and negative cases)
// ---------------------------------------------------------------------------

test('harness: extractSqlBlocks takes only ```sql fences, trimmed, CRLF-normalized', () => {
  const md = '# T\n```sql\r\nSELECT 1 FROM DUMMY;\r\n```\n```ebnf\n<a> ::= b\n```\n```sql\n\n```\n```sql\nSELECT 2 FROM DUMMY;\n```\n';
  assert.deepEqual(extractSqlBlocks(md), ['SELECT 1 FROM DUMMY;', 'SELECT 2 FROM DUMMY;']);
});

test('harness: isTemplate flags placeholders and ellipses, not comparison operators', () => {
  assert.equal(isTemplate('CREATE TABLE <table_name> (<column_list>);'), true);
  assert.equal(isTemplate('SELECT a, b, ... FROM t;'), true);
  assert.equal(isTemplate('SELECT * FROM t WHERE a <> b AND c <= d AND e < f AND g > h;'), false);
  assert.equal(isTemplate("SELECT '<not a placeholder>' FROM DUMMY;"), false);
  assert.equal(isTemplate('FOR i IN 1..10 DO x = :i; END FOR;'), false);
});

test('harness: blockHash is stable across line endings and surrounding whitespace', () => {
  assert.equal(blockHash('SELECT 1\r\nFROM DUMMY;'), blockHash('  SELECT 1\nFROM DUMMY;\n'));
  assert.notEqual(blockHash('SELECT 1 FROM DUMMY;'), blockHash('SELECT 2 FROM DUMMY;'));
  assert.match(blockHash('x'), /^[0-9a-f]{16}$/);
});

test('harness: formatter invariants pass on clean input and detect format-off regions', () => {
  assert.deepEqual(formatterViolations('select a,b from t where x=1;'), []);
  assert.deepEqual(formatterViolations('-- lead\nselect a /* mid */ from t; -- tail'), []);
  const off = '-- hanasql-format off\nselect   a,b   from t;\n-- hanasql-format on\nselect 1 from dummy;';
  assert.deepEqual(formatOffRegions(off), ['-- hanasql-format off\nselect   a,b   from t;\n-- hanasql-format on']);
  assert.deepEqual(formatterViolations(off), []);
  // Negative: an unterminated off region runs to the end of the text.
  assert.equal(formatOffRegions('select 1 from dummy;\n-- hanasql-format off\nselect  2;').length, 1);
});

test('harness: unscopedKeywords ignores strings, comments, quoted and dotted names', () => {
  assert.deepEqual(unscopedKeywords("SELECT 'RANGE' AS \"RANGE\", t.RANGE FROM t; -- RANGE"), []);
  // Positive: a catalog keyword that the grammar does not scope today (tracked in #79).
  assert.deepEqual(unscopedKeywords('SELECT a FROM t WITH HINT (NO_INLINE);').includes('HINT'), true);
});

test('harness: unknownCalls skips catalog functions and declared object names', () => {
  assert.deepEqual(unknownCalls('SELECT UPPER(a), COUNT(*) FROM t;'), []);
  assert.deepEqual(unknownCalls('CREATE TABLE my_tab (a INT); INSERT INTO my_tab (a) VALUES (1);'), []);
  assert.deepEqual(unknownCalls('SELECT my_udf(a) FROM t;'), ['MY_UDF']);
});
