#!/usr/bin/env node
/**
 * Local conformance sweep (#76). Runs every runnable ```sql block from the SAP reference corpus
 * through the analyzer, formatter and grammar, and writes a stable, diffable report.
 *
 * Never run in CI: the corpus under research/ is local and git-ignored.
 *
 *   npm run compile && node scripts/conformance.js [options]
 *
 * Options:
 *   --corpus <dir>     corpus folder (repeatable; default: the five SQL / SQLScript guides below)
 *   --out <dir>        report folder (default: research/conformance)
 *   --allowlist <file> noise allowlist (default: docs/research/conformance-allowlist.json)
 *   --no-allowlist     ignore the allowlist (to re-audit noise)
 *   --propose-allowlist
 *                      also write <out>/allowlist-candidates.json: flagged blocks that the noise
 *                      classifiers recognise as not valid SQL as extracted (review, then copy)
 *   --snippets <n>     example snippets per rule in the Markdown report (default: 5)
 *
 * Output: <out>/report.md, <out>/report.json, and the summary table on stdout (numbers only,
 * suitable for docs/research/CONFORMANCE.md).
 *
 * SQLScript body excerpts (a top-level DECLARE / IF / FOR without a routine or DO header) are
 * evaluated wrapped in `DO BEGIN ... END;`, the context the reference shows them in.
 *
 * Spec: docs/specs/diagnostics/conformance-harness.md
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'out', 'test', 'helpers', 'conformance.js');

const DEFAULT_CORPUS = [
  'SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_for_SAP_HANA_Platform',
  'hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide',
  'SAP_HANA_PLATFORM_SAP_HANA_SQLScript_Reference_for_SAP_HANA_Platform',
  'hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference',
  'hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide',
].map((d) => path.join(ROOT, 'research', 'refs', 'extracted', d));

function parseArgs(argv) {
  const opts = {
    corpus: [],
    out: path.join(ROOT, 'research', 'conformance'),
    allowlist: path.join(ROOT, 'docs', 'research', 'conformance-allowlist.json'),
    snippets: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--corpus') opts.corpus.push(path.resolve(next()));
    else if (a === '--out') opts.out = path.resolve(next());
    else if (a === '--allowlist') opts.allowlist = path.resolve(next());
    else if (a === '--no-allowlist') opts.allowlist = null;
    else if (a === '--propose-allowlist') opts.propose = true;
    else if (a === '--snippets') opts.snippets = Number(next());
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`unknown option ${a}`);
  }
  if (opts.corpus.length === 0) opts.corpus = DEFAULT_CORPUS;
  return opts;
}

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listMarkdown(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []))
    .sort();
}

function loadAllowlist(file) {
  if (!file || !fs.existsSync(file)) return new Map();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = new Map();
  for (const e of data.entries || []) {
    if (!e.hash || !e.reason) throw new Error(`allowlist entry without hash/reason: ${JSON.stringify(e)}`);
    map.set(e.hash, e);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Corpus noise
// ---------------------------------------------------------------------------

/** True when a line has an unclosed quote or unbalanced parentheses on its own. */
function unbalancedLine(line) {
  const bare = line.replace(/'(?:[^']|'')*'/g, '').replace(/"(?:[^"]|"")*"/g, '');
  return /['"]/.test(bare) || bare.split('(').length !== bare.split(')').length;
}

/** The full source line containing `offset`. */
function lineAt(text, offset) {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const end = text.indexOf('\n', offset);
  return text.slice(start, end < 0 ? text.length : end);
}

const TYPOGRAPHIC =/[‘’“”′´–—]/;

/**
 * Noise classifiers used only by --propose-allowlist. Each returns a short reason when the block
 * is not valid SQL as extracted, regardless of which diagnostics it triggers. Candidates are
 * written for human review and never applied automatically.
 */
const NOISE_CLASSIFIERS = [
  {
    reason: 'PDF right-margin clipping: a 95-103 character line is cut mid-token (SPEC_RULES.md rule 7)',
    test: (b) => b.text.split('\n').some((l) => l.length >= 95 && l.length <= 103 && unbalancedLine(l)),
  },
  {
    reason: 'SAP typo: typographic quote or dash where SQL needs ASCII punctuation',
    test: (b) => b.syntax.some((d) => TYPOGRAPHIC.test(d.span)),
  },
  {
    reason: 'SAP example uses // comments, which are not SQL comments',
    test: (b) => b.syntax.some((d) => d.ruleId === 'HANA-SYN-005' && d.span.startsWith('//')),
  },
  {
    reason: 'Result output or prose captured in the code block',
    test: (b) =>
      b.syntax.some((d) => {
        if (d.ruleId !== 'HANA-SYN-041') return false;
        const line = lineAt(b.text, d.start);
        return (
          /^\s*[\d'"<=[]/.test(line) ||
          /[:.]\s*$/.test(line) ||
          /^\s*(Error|Example|generated|Note)\b/.test(line)
        );
      }),
  },
];

/** SQLScript excerpts (`DECLARE ...; IF ... END IF;`) shown without their enclosing block. */
const ROUTINE_HEADER = /\b(CREATE\s+(OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|LIBRARY|TRIGGER)|DO\s*(\(|BEGIN))\b/i;
function isBodyExcerpt(text, diags) {
  return !ROUTINE_HEADER.test(text) && diags.some((d) => d.ruleId === 'HANA-SYN-029' && /only allowed inside a routine/.test(d.message));
}

const byCountThenName =(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const pct = (n, d) => (d === 0 ? '0.0' : ((100 * n) / d).toFixed(1));
const clip = (s, n = 400) => (s.length > n ? s.slice(0, n) + ' …' : s);

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(HELPER)) {
    console.error('conformance: compiled helper not found. Run `npm run compile` first.');
    process.exit(2);
  }
  const h = require(HELPER);

  const missing = opts.corpus.filter((d) => !fs.existsSync(d));
  if (missing.length === opts.corpus.length) {
    console.error('conformance: no corpus folder found (research/ is local-only):\n  ' + missing.join('\n  '));
    process.exit(2);
  }
  for (const d of missing) console.warn(`conformance: skipping missing corpus folder ${d}`);

  const allowlist = loadAllowlist(opts.allowlist);

  // 1. Extract, drop templates, dedupe by content hash (first source wins, in sorted order).
  const blocks = new Map(); // hash -> { hash, text, source }
  let fenced = 0;
  let templates = 0;
  for (const dir of opts.corpus.filter((d) => fs.existsSync(d))) {
    for (const file of listMarkdown(dir)) {
      for (const text of h.extractSqlBlocks(fs.readFileSync(file, 'utf8'))) {
        fenced++;
        if (h.isTemplate(text)) {
          templates++;
          continue;
        }
        const hash = h.blockHash(text);
        if (!blocks.has(hash)) blocks.set(hash, { hash, text, source: path.relative(ROOT, file).replace(/\\/g, '/') });
      }
    }
  }

  // 2. Evaluate.
  const results = [];
  const usedAllow = new Set();
  for (const b of [...blocks.values()].sort((x, y) => (x.hash < y.hash ? -1 : 1))) {
    const allow = allowlist.get(b.hash);
    if (allow) {
      usedAllow.add(b.hash);
      continue;
    }
    // A SQLScript excerpt is evaluated inside an anonymous block, the context SAP shows it in.
    let text = b.text;
    let diags = h.syntaxErrors(text);
    let wrapped = false;
    if (isBodyExcerpt(text, diags)) {
      text = `DO BEGIN\n${b.text}\nEND;`;
      diags = h.syntaxErrors(text);
      wrapped = true;
    }
    results.push({
      ...b,
      text,
      wrapped,
      syntax: diags.map((d) => ({ ruleId: d.ruleId, start: d.start, span: text.slice(d.start, d.end), message: d.message })),
      formatter: h.formatterViolations(b.text),
      unscoped: h.unscopedKeywords(b.text),
      calls: h.unknownCalls(b.text),
    });
  }

  if (opts.propose) {
    const candidates = [];
    for (const r of results) {
      if (r.syntax.length === 0 && r.formatter.length === 0) continue;
      const c = NOISE_CLASSIFIERS.find((x) => x.test(r));
      if (c) candidates.push({ hash: r.hash, reason: c.reason, source: path.basename(path.dirname(r.source)) + '/' + path.basename(r.source) });
    }
    fs.mkdirSync(opts.out, { recursive: true });
    const file = path.join(opts.out, 'allowlist-candidates.json');
    fs.writeFileSync(file, JSON.stringify({ entries: candidates.sort((a, b) => (a.hash < b.hash ? -1 : 1)) }, null, 2) + '\n');
    console.log(`conformance: ${candidates.length} allowlist candidates written to ${path.relative(ROOT, file)} (review before copying).`);
  }

  // 3. Aggregate.
  const ruleBlocks = new Map(); // ruleId -> Set(hash)
  const fmtBlocks = new Map(); // kind -> Set(hash)
  const unscopedBlocks = new Map(); // keyword -> count of blocks
  const callBlocks = new Map(); // name -> count of blocks
  let withSyntax = 0;
  let withFmt = 0;
  let withUnscoped = 0;
  for (const r of results) {
    if (r.syntax.length) withSyntax++;
    if (r.formatter.length) withFmt++;
    if (r.unscoped.length) withUnscoped++;
    for (const d of r.syntax) (ruleBlocks.get(d.ruleId) || ruleBlocks.set(d.ruleId, new Set()).get(d.ruleId)).add(r.hash);
    for (const v of r.formatter) (fmtBlocks.get(v.kind) || fmtBlocks.set(v.kind, new Set()).get(v.kind)).add(r.hash);
    for (const k of r.unscoped) unscopedBlocks.set(k, (unscopedBlocks.get(k) || 0) + 1);
    for (const c of r.calls) callBlocks.set(c, (callBlocks.get(c) || 0) + 1);
  }
  const rules = [...ruleBlocks].map(([k, v]) => [k, v.size]).sort(byCountThenName);
  const fmt = [...fmtBlocks].map(([k, v]) => [k, v.size]).sort(byCountThenName);
  const unscoped = [...unscopedBlocks].sort(byCountThenName);
  const calls = [...callBlocks].sort(byCountThenName);
  const staleAllow = [...allowlist.keys()].filter((k) => !usedAllow.has(k)).sort();

  const summary = {
    corpus: opts.corpus.filter((d) => fs.existsSync(d)).map((d) => path.basename(d)),
    fencedBlocks: fenced,
    templatesSkipped: templates,
    uniqueBlocks: blocks.size,
    allowlisted: usedAllow.size,
    evaluated: results.length,
    wrappedExcerpts: results.filter((r) => r.wrapped).length,
    analyzer: { blocksWithSyntaxErrors: withSyntax, percent: pct(withSyntax, results.length), rules: Object.fromEntries(rules) },
    formatter: { blocksWithViolations: withFmt, kinds: Object.fromEntries(fmt) },
    grammar: { blocksWithUnscopedKeywords: withUnscoped, unscopedKeywords: unscoped.length, keywords: Object.fromEntries(unscoped) },
    catalog: { unknownCalledNames: calls.length },
    staleAllowlistEntries: staleAllow.length,
  };

  // 4. Write reports.
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(
    path.join(opts.out, 'report.json'),
    JSON.stringify(
      {
        summary,
        catalog: Object.fromEntries(calls),
        staleAllowlist: staleAllow,
        blocks: results.filter((r) => r.syntax.length || r.formatter.length || r.unscoped.length),
      },
      null,
      2
    ) + '\n'
  );

  const md = [];
  md.push('# Conformance report', '');
  md.push('Generated by `node scripts/conformance.js`. Local only: contains corpus text, never commit.', '');
  md.push(summaryTable(summary), '');
  md.push('## Analyzer: blocks with syntax errors, per rule', '');
  for (const [rule, count] of rules) {
    md.push(`### ${rule} (${count})`, '');
    const examples = results.filter((r) => r.syntax.some((d) => d.ruleId === rule)).slice(0, opts.snippets);
    for (const r of examples) {
      const d = r.syntax.find((x) => x.ruleId === rule);
      md.push(`- \`${r.hash}\` ${r.source}: at \`${clip(d.span, 60).replace(/`/g, "'")}\`: ${d.message}`, '', '  ```sql', ...clip(r.text).split('\n').map((l) => '  ' + l), '  ```', '');
    }
  }
  md.push('## Formatter violations', '');
  if (fmt.length === 0) md.push('None.', '');
  for (const r of results.filter((x) => x.formatter.length).slice(0, 50)) {
    md.push(`- \`${r.hash}\` ${r.source}: ${r.formatter.map((v) => `${v.kind} (${v.detail})`).join('; ')}`);
  }
  md.push('', '## Grammar: unscoped catalog keywords (blocks)', '');
  md.push(unscoped.length ? unscoped.map(([k, n]) => `\`${k}\` ${n}`).join(', ') : 'None.', '');
  md.push('## Catalog: called names unknown to grammar and builtin-functions.json (blocks)', '');
  md.push(calls.length ? calls.slice(0, 200).map(([k, n]) => `\`${k}\` ${n}`).join(', ') : 'None.', '');
  if (staleAllow.length) md.push('## Stale allowlist entries (no longer in corpus)', '', ...staleAllow.map((s) => `- \`${s}\``), '');
  fs.writeFileSync(path.join(opts.out, 'report.md'), md.join('\n'));

  console.log(summaryTable(summary));
  console.log(`\nReports: ${path.relative(ROOT, path.join(opts.out, 'report.md'))}, ${path.relative(ROOT, path.join(opts.out, 'report.json'))}`);
}

function top(obj, n) {
  return Object.entries(obj)
    .slice(0, n)
    .map(([k, v]) => `\`${k}\` ${v}`)
    .join(', ');
}

function summaryTable(s) {
  return [
    '| Metric | Value |',
    '| :--- | :--- |',
    `| \`sql\` fenced blocks | ${s.fencedBlocks} |`,
    `| Templates skipped (\`<placeholder>\`, \`...\`) | ${s.templatesSkipped} |`,
    `| Unique runnable blocks | ${s.uniqueBlocks} |`,
    `| Allowlisted as corpus noise | ${s.allowlisted} |`,
    `| Evaluated | ${s.evaluated} |`,
    `| SQLScript excerpts evaluated inside \`DO BEGIN ... END\` | ${s.wrappedExcerpts} |`,
    `| Analyzer: blocks with ≥1 syntax error | ${s.analyzer.blocksWithSyntaxErrors} (${s.analyzer.percent}%) |`,
    `| Analyzer: top rules (blocks) | ${top(s.analyzer.rules, 8) || '—'} |`,
    `| Formatter: blocks with violations | ${s.formatter.blocksWithViolations}${Object.keys(s.formatter.kinds).length ? ' (' + top(s.formatter.kinds, 5) + ')' : ''} |`,
    `| Grammar: unscoped catalog keywords | ${s.grammar.unscopedKeywords} (in ${s.grammar.blocksWithUnscopedKeywords} blocks) |`,
    `| Catalog: unknown called names | ${s.catalog.unknownCalledNames} |`,
    `| Stale allowlist entries | ${s.staleAllowlistEntries} |`,
  ].join('\n');
}

main();
