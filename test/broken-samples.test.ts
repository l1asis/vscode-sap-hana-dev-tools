/**
 * `samples/broken/` suite (#34): every intentionally invalid sample triggers exactly the rule IDs,
 * severities and QuickFixes documented in `samples/broken/README.md`, and no analyzer or formatter
 * throws on it, including after a QuickFix is applied.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeDocument } from '../src/analyzer/dispatch';
import { applyTextEdits, type AnalyzerDiagnostic } from '../src/analyzer/types';
import { ARTIFACT_FORMATTER_LANGUAGES, formatDocument } from '../src/formatter/dispatch';
import { BROKEN_SAMPLES_DIR, relativeToRepo, sampleLanguageId, walkSamples } from './helpers/samples';

interface ExpectedRow {
  readonly file: string;
  readonly ruleId: string;
  readonly severity: string;
  readonly fixes: readonly string[];
}

const README = path.join(BROKEN_SAMPLES_DIR, 'README.md');

/** Rows of the `| File | Rule | Severity | QuickFixes |` tables in the README. */
function parseReadme(markdown: string): ExpectedRow[] {
  const rows: ExpectedRow[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\| \[`[^`]+`\]\(([^)]+)\) \| `(HANA-[A-Z]+-\d+)` \| (\w+) \| (.*) \|$/.exec(line);
    if (!m) continue;
    const fixes =
      m[4].trim() === '—'
        ? []
        : m[4].split('<br>').map((t) => {
            const fix = /^`(.*)`$/.exec(t.trim());
            assert.ok(fix, `README: QuickFix title must be wrapped in backticks: ${t}`);
            return fix[1].replace(/\\\|/g, '|');
          });
    rows.push({ file: m[1], ruleId: m[2], severity: m[3], fixes: fixes.sort() });
  }
  return rows;
}

const key = (ruleId: string, severity: string): string => `${ruleId} (${severity})`;

/** `(rule, severity)` -> sorted, de-duplicated fix titles. */
function summarize(diags: readonly AnalyzerDiagnostic[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const d of diags) {
    const k = key(d.ruleId, d.severity);
    if (!out.has(k)) out.set(k, new Set());
    for (const f of d.fixes) out.get(k)!.add(f.title);
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}

const rows = parseReadme(fs.readFileSync(README, 'utf8'));
const files = walkSamples({ includeBroken: true }, BROKEN_SAMPLES_DIR).filter((f) => sampleLanguageId(f) !== undefined);
const rel = (file: string): string => path.relative(BROKEN_SAMPLES_DIR, file).split(path.sep).join('/');

test('samples/broken/: README documents every fixture and only existing fixtures', () => {
  assert.ok(files.length >= 30, `expected >= 30 broken samples, found ${files.length}`);
  const documented = new Set(rows.map((r) => r.file));
  for (const f of files) assert.ok(documented.has(rel(f)), `samples/broken/README.md has no row for ${rel(f)}`);
  for (const f of documented) assert.ok(fs.existsSync(path.join(BROKEN_SAMPLES_DIR, f)), `README row points to missing file ${f}`);
  const domains = new Set(files.map((f) => rel(f).split('/')[0]));
  for (const d of ['syntax', 'security', 'performance', 'calculationview', 'migration', 'xsjs']) {
    assert.ok(domains.has(d), `samples/broken/${d}/ is missing`);
  }
});

test('samples/broken/: every rule family is exercised by at least one fixture', () => {
  const ids = new Set(rows.map((r) => r.ruleId));
  for (const prefix of ['HANA-SYN-', 'HANA-SEC-', 'HANA-PERF-', 'HANA-LINT-', 'HANA-MIG-']) {
    assert.ok([...ids].some((id) => id.startsWith(prefix)), `no broken sample triggers a ${prefix}* rule`);
  }
});

for (const file of files) {
  const name = rel(file);
  const languageId = sampleLanguageId(file)!;

  test(`samples/broken/${name}: reports exactly the documented rules, severities and QuickFixes`, () => {
    const text = fs.readFileSync(file, 'utf8');
    const actual = summarize(analyzeDocument({ languageId, text, filePath: file }));
    const expected = new Map(rows.filter((r) => r.file === name).map((r) => [key(r.ruleId, r.severity), [...r.fixes]]));
    assert.ok(expected.size > 0, `no README rows for ${name}`);
    assert.deepEqual(
      [...actual.keys()].sort(),
      [...expected.keys()].sort(),
      `${relativeToRepo(file)}: rule/severity set differs from samples/broken/README.md`
    );
    for (const [k, fixes] of expected) {
      assert.deepEqual(actual.get(k), fixes, `${relativeToRepo(file)}: QuickFixes for ${k} differ from samples/broken/README.md`);
    }
  });

  test(`samples/broken/${name}: analyzers, formatter and QuickFixes never throw`, () => {
    const text = fs.readFileSync(file, 'utf8');
    const diags = analyzeDocument({ languageId, text, filePath: file });
    if (ARTIFACT_FORMATTER_LANGUAGES.includes(languageId)) {
      const formatted = formatDocument(languageId, text);
      assert.equal(typeof formatted, 'string');
      analyzeDocument({ languageId, text: formatted, filePath: file });
    }
    for (const d of diags) {
      for (const fix of d.fixes) {
        const fixed = applyTextEdits(text, fix.edits);
        assert.notEqual(fixed, text, `${d.ruleId} QuickFix "${fix.title}" changes nothing`);
        analyzeDocument({ languageId, text: fixed, filePath: file });
        if (ARTIFACT_FORMATTER_LANGUAGES.includes(languageId)) formatDocument(languageId, fixed);
      }
    }
  });
}
