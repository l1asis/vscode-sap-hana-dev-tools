/**
 * Artifact suffix registry (#82): `docs/specs/artifacts/artifact-registry.md` must match what the extension
 * registers (`package.json`), formats (`src/formatter/dispatch.ts`), analyzes (`src/analyzer/dispatch.ts`),
 * migrates (`HANA-MIG-013`, `src/analyzer/suffix-migration.ts`) and completes (`.hdiconfig` plug-ins), so a
 * suffix cannot be added or dropped silently.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ANALYZER_LANGUAGES, analyzeDocument } from '../src/analyzer/dispatch';
import { fileSuffix, SUFFIX_MIGRATIONS, type SuffixMigration } from '../src/analyzer/suffix-migration';
import { ALL_FORMATTER_LANGUAGES, JSON_ARTIFACT_LANGUAGES, SQL_LANGUAGES } from '../src/formatter/dispatch';
import { ARTIFACT_INTELLISENSE_LANGUAGES, HDI_PLUGIN_VALUES } from '../src/sql/artifact-intellisense';
import { REPO_ROOT } from './helpers/samples';
import { tokenize, has } from './helpers/tm';

interface RegistryRow {
  readonly suffix: string;
  readonly languageId: string;
  readonly platform: string;
  readonly status: string;
  readonly plugin: string;
  readonly grammar: string;
  readonly formatter: string;
  readonly analyzer: string;
  readonly migrator: string;
  readonly intellisense: string;
}

interface UnregisteredRow {
  readonly suffixes: readonly string[];
  readonly platform: string;
  readonly plugin: string;
}

interface PackageJson {
  contributes: {
    languages: Array<{ id: string; extensions?: string[]; filenames?: string[] }>;
    grammars: Array<{ language?: string; scopeName: string; injectTo?: string[] }>;
    jsonValidation?: Array<{ fileMatch: string | string[]; url: string }>;
  };
}

/** Everything the registry is compared against; a parameter so the negative tests can corrupt one input. */
interface Implementation {
  readonly pkg: PackageJson;
  readonly formatterLanguages: readonly string[];
  readonly analyzerLanguages: readonly string[];
  readonly suffixMigrations: Readonly<Record<string, SuffixMigration>>;
  readonly plugins: readonly string[];
}

const REGISTRY = path.join(REPO_ROOT, 'docs', 'specs', 'artifacts', 'artifact-registry.md');
const unquote = (cell: string): string => cell.trim().replace(/^`|`$/g, '');
const cellsOf = (line: string): string[] => line.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim());

/** Rows of the markdown table under `heading` (header and separator rows skipped). */
function tableRows(markdown: string, heading: string): string[][] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(heading));
  assert.ok(start >= 0, `artifact-registry.md: heading "${heading}" not found`);
  const rows: string[][] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    rows.push(cellsOf(line));
  }
  return rows.slice(2);
}

function parseRegistry(markdown: string): { registered: RegistryRow[]; unregistered: UnregisteredRow[] } {
  const registered = tableRows(markdown, '## 2.').map((c) => {
    assert.equal(c.length, 11, `artifact-registry.md §2: expected 11 cells in ${c.join(' | ')}`);
    return {
      suffix: unquote(c[0]),
      languageId: unquote(c[1]),
      platform: c[2],
      status: c[3],
      plugin: unquote(c[4]),
      grammar: unquote(c[5]),
      formatter: c[6],
      analyzer: c[7],
      migrator: c[8],
      intellisense: c[9],
    };
  });
  const unregistered = tableRows(markdown, '## 3.').map((c) => {
    assert.equal(c.length, 5, `artifact-registry.md §3: expected 5 cells in ${c.join(' | ')}`);
    return { suffixes: c[0].split(',').map(unquote), platform: c[1], plugin: unquote(c[2]) };
  });
  return { registered, unregistered };
}

const TAG = /^(?:`\[(?:XSC|XSA|HDI|CLOUD)\]`)(?: `\[(?:XSC|XSA|HDI|CLOUD)\]`)*$/;
const STATUS = /^(?:current|deprecated|unsupported|(?:alias of|renamed →|replaced →) \.[a-z]+)$/;

/** Every disagreement between the registry and the implementation (empty = in sync). */
function checkRegistry(markdown: string, impl: Implementation): string[] {
  const errors: string[] = [];
  const { registered, unregistered } = parseRegistry(markdown);
  const fmt = new Set(impl.formatterLanguages);
  const ana = new Set(impl.analyzerLanguages);
  const grammarOf = new Map(impl.pkg.contributes.grammars.filter((g) => g.language).map((g) => [g.language!, g.scopeName]));
  const languageOf = new Map<string, string>();
  for (const l of impl.pkg.contributes.languages) {
    for (const key of [...(l.extensions ?? []), ...(l.filenames ?? [])]) {
      if (languageOf.has(key) && languageOf.get(key) !== l.id) errors.push(`package.json registers ${key} for two languages`);
      languageOf.set(key, l.id);
    }
  }
  const schemaFiles = new Set(
    (impl.pkg.contributes.jsonValidation ?? []).flatMap((v) => (Array.isArray(v.fileMatch) ? v.fileMatch : [v.fileMatch]))
  );

  const rows = new Map<string, RegistryRow>();
  for (const r of registered) {
    if (rows.has(r.suffix)) errors.push(`registry lists ${r.suffix} twice`);
    rows.set(r.suffix, r);
  }
  for (const key of languageOf.keys()) if (!rows.has(key)) errors.push(`${key} is registered in package.json but missing from the registry`);
  for (const key of schemaFiles) if (!rows.has(key)) errors.push(`${key} has a JSON schema but is missing from the registry`);

  for (const r of registered) {
    const where = `registry row ${r.suffix}`;
    if (!TAG.test(r.platform)) errors.push(`${where}: invalid platform cell "${r.platform}"`);
    if (!STATUS.test(r.status)) errors.push(`${where}: invalid status "${r.status}"`);
    const schema = r.intellisense === 'schema';
    if (schema !== schemaFiles.has(r.suffix)) errors.push(`${where}: IntelliSense "schema" must match contributes.jsonValidation`);
    const registeredAs = schema ? 'json' : languageOf.get(r.suffix);
    if (registeredAs === undefined) {
      errors.push(`${where}: not registered in package.json`);
      continue;
    }
    if (registeredAs !== r.languageId) errors.push(`${where}: language ${r.languageId}, package.json says ${registeredAs}`);
    const grammar = grammarOf.get(r.languageId) ?? 'built-in';
    if (grammar !== r.grammar) errors.push(`${where}: grammar ${r.grammar}, package.json says ${grammar}`);

    if ((r.formatter !== '—') !== fmt.has(r.languageId)) errors.push(`${where}: formatter "${r.formatter}" disagrees with ALL_FORMATTER_LANGUAGES`);
    if ((r.formatter === 'json') !== JSON_ARTIFACT_LANGUAGES.includes(r.languageId)) errors.push(`${where}: formatter "json" disagrees with JSON_ARTIFACT_LANGUAGES`);
    if (/\bsql\b/.test(r.formatter) !== SQL_LANGUAGES.includes(r.languageId)) errors.push(`${where}: formatter "sql" disagrees with SQL_LANGUAGES`);
    if ((r.analyzer !== '—') !== ana.has(r.languageId)) errors.push(`${where}: analyzer "${r.analyzer}" disagrees with ANALYZER_LANGUAGES`);
    const sqlIntel = r.languageId === 'hanasql' || SQL_LANGUAGES.includes(r.languageId);
    if ((r.intellisense === 'sql') !== sqlIntel) errors.push(`${where}: IntelliSense "sql" disagrees with SQL_LANGUAGES`);
    if ((r.intellisense === 'artifact') !== ARTIFACT_INTELLISENSE_LANGUAGES.includes(r.languageId)) {
      errors.push(`${where}: IntelliSense "artifact" disagrees with ARTIFACT_INTELLISENSE_LANGUAGES`);
    }

    const mig = impl.suffixMigrations[r.suffix];
    if (r.migrator.includes('`HANA-MIG-013`') !== Boolean(mig)) errors.push(`${where}: HANA-MIG-013 disagrees with SUFFIX_MIGRATIONS`);
    if (mig) {
      const expected = mig.rename && mig.target ? `renamed → ${mig.target}` : mig.target ? `replaced → ${mig.target}` : undefined;
      if (expected ? r.status !== expected : !/^(?:unsupported|deprecated)$/.test(r.status)) {
        errors.push(`${where}: status "${r.status}" disagrees with SUFFIX_MIGRATIONS (${expected ?? 'unsupported'})`);
      }
      if (mig.languageId !== r.languageId) errors.push(`${where}: SUFFIX_MIGRATIONS language ${mig.languageId}`);
    } else if (r.status.startsWith('renamed →')) {
      errors.push(`${where}: "renamed" needs a HANA-MIG-013 rename QuickFix`);
    }
  }
  for (const suffix of Object.keys(impl.suffixMigrations)) {
    if (!rows.has(suffix)) errors.push(`SUFFIX_MIGRATIONS has ${suffix}, the registry does not`);
  }

  for (const u of unregistered) {
    for (const s of u.suffixes) {
      if (languageOf.has(s) || rows.has(s)) errors.push(`${s} is listed as not registered but is registered`);
    }
    if (u.platform !== '—' && !TAG.test(u.platform)) errors.push(`registry §3 ${u.suffixes.join(', ')}: invalid platform`);
  }

  const registryPlugins = new Set(
    [...registered.map((r) => r.plugin), ...unregistered.map((u) => u.plugin)].filter((p) => p.startsWith('com.sap.hana.di.'))
  );
  const catalogue = new Set(impl.plugins);
  for (const p of registryPlugins) if (!catalogue.has(p)) errors.push(`plug-in ${p} is missing from HDI_PLUGIN_VALUES`);
  for (const p of catalogue) if (!registryPlugins.has(p)) errors.push(`HDI_PLUGIN_VALUES has ${p}, the registry does not`);
  return errors;
}

const markdown = fs.readFileSync(REGISTRY, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as PackageJson;
const IMPL: Implementation = {
  pkg,
  formatterLanguages: ALL_FORMATTER_LANGUAGES,
  analyzerLanguages: ANALYZER_LANGUAGES,
  suffixMigrations: SUFFIX_MIGRATIONS,
  plugins: HDI_PLUGIN_VALUES.map((p) => p.value),
};
const clonePkg = (): PackageJson => JSON.parse(JSON.stringify(pkg)) as PackageJson;

test('artifact registry: matches package.json, dispatch, HANA-MIG-013 and the .hdiconfig plug-in catalogue', () => {
  assert.deepEqual(checkRegistry(markdown, IMPL), []);
  assert.ok(parseRegistry(markdown).registered.length >= 115, 'registry lost rows');
});

test('artifact registry: a suffix registered only in package.json is reported', () => {
  const corrupted = clonePkg();
  corrupted.contributes.languages.find((l) => l.id === 'hdbtable')!.extensions!.push('.hdbnewthing');
  assert.deepEqual(checkRegistry(markdown, { ...IMPL, pkg: corrupted }), [
    '.hdbnewthing is registered in package.json but missing from the registry',
  ]);
});

test('artifact registry: a suffix dropped from package.json is reported', () => {
  const corrupted = clonePkg();
  const lang = corrupted.contributes.languages.find((l) => l.id === 'hdbsearchruleset')!;
  lang.extensions = lang.extensions!.filter((e) => e !== '.searchruleset');
  assert.deepEqual(checkRegistry(markdown, { ...IMPL, pkg: corrupted }), ['registry row .searchruleset: not registered in package.json']);
});

test('artifact registry: dispatch, migration and plug-in drift is reported', () => {
  const noFormatter = ALL_FORMATTER_LANGUAGES.filter((l) => l !== 'hdbscalarfunction');
  assert.ok(
    checkRegistry(markdown, { ...IMPL, formatterLanguages: noFormatter }).some((e) => e.startsWith('registry row .hdbscalarfunction: formatter'))
  );
  const noAnalyzer = ANALYZER_LANGUAGES.filter((l) => l !== 'xscxmlmodel');
  assert.ok(checkRegistry(markdown, { ...IMPL, analyzerLanguages: noAnalyzer }).some((e) => e.startsWith('registry row .aflpmml: analyzer')));
  const { ['.searchruleset']: _dropped, ...fewer } = SUFFIX_MIGRATIONS;
  assert.ok(checkRegistry(markdown, { ...IMPL, suffixMigrations: fewer }).some((e) => e.includes('.searchruleset: HANA-MIG-013')));
  assert.deepEqual(checkRegistry(markdown, { ...IMPL, plugins: [...IMPL.plugins, 'com.sap.hana.di.made.up'] }), [
    'HDI_PLUGIN_VALUES has com.sap.hana.di.made.up, the registry does not',
  ]);
});

test('artifact registry: .hdiconfig completion offers the corrected migration-table and copy-only plug-ins', () => {
  const values = HDI_PLUGIN_VALUES.map((p) => p.value);
  assert.ok(values.includes('com.sap.hana.di.table.migration'));
  assert.ok(values.includes('com.sap.hana.di.copyonly'));
  assert.ok(!values.includes('com.sap.hana.di.migrationtable'), 'com.sap.hana.di.migrationtable is not an HDI plug-in');
});

// ---------------------------------------------------------------------------
// HANA-MIG-013
// ---------------------------------------------------------------------------
const mig013 = (filePath: string, languageId: string, text = '<?xml version="1.0"?>\n<a/>\n', options = {}) =>
  analyzeDocument({ languageId, text, filePath, options }).filter((d) => d.ruleId === 'HANA-MIG-013');

test('HANA-MIG-013: a renamed suffix gets a file-rename QuickFix on the first line', () => {
  const text = '<?xml version="1.0"?>\r\n<SearchRuleSet:ruleSet/>\r\n';
  const [d] = mig013('/repo/models/Customer.SearchRuleSet', 'hdbsearchruleset', text);
  assert.equal(d.severity, 'information');
  assert.equal(text.slice(d.start, d.end), '<?xml version="1.0"?>');
  assert.match(d.message, /^'\.searchruleset' is the XS Classic suffix/);
  assert.deepEqual(d.fixes.map((f) => [f.title, f.edits.length, f.rename?.toExtension]), [['Rename to .hdbsearchruleset', 0, '.hdbsearchruleset']]);
  const [fn] = mig013('C:\\repo\\DISCOUNT.hdbscalarfunction', 'hdbscalarfunction', 'FUNCTION f () RETURNS r INT AS BEGIN r := 1; END;');
  assert.equal(fn.fixes[0].rename?.toExtension, '.hdbfunction');
});

test('HANA-MIG-013: replaced and unsupported suffixes are reported without a QuickFix', () => {
  for (const [file, lang] of [['a.analyticview', 'analyticview'], ['b.procedure', 'xscprocedure'], ['c.hdbruldec', 'hdbdecisiontable'], ['d.dqconfig', 'xscxmlmodel']]) {
    const d = mig013(file, lang);
    assert.equal(d.length, 1, file);
    assert.deepEqual(d[0].fixes, [], file);
  }
});

test('HANA-MIG-013: current suffixes, missing paths, targetPlatform xsc and migration off stay silent', () => {
  assert.deepEqual(mig013('x.hdbsearchruleset', 'hdbsearchruleset'), []);
  assert.deepEqual(mig013('x.hdbcalculationview', 'hdbcalculationview'), []);
  assert.deepEqual(analyzeDocument({ languageId: 'hdbsearchruleset', text: '<a/>' }).filter((d) => d.ruleId === 'HANA-MIG-013'), []);
  assert.deepEqual(mig013('x.searchruleset', 'hdbsearchruleset', '<a/>', { targetPlatform: 'xsc' }), []);
  assert.deepEqual(mig013('x.searchruleset', 'hdbsearchruleset', '<a/>', { migration: false }), []);
  assert.deepEqual(mig013('x.searchruleset', 'hdbsearchruleset', '<!-- hanasql-analyze-disable HANA-MIG-013 -->\n<a/>'), []);
});

test('HANA-MIG-013: fileSuffix takes the last suffix, case-insensitively, on both path styles', () => {
  assert.equal(fileSuffix('/a/b.c/Name.SearchRuleSet'), '.searchruleset');
  assert.equal(fileSuffix('C:\\a\\x.hdbsynonymgrantor'), '.hdbsynonymgrantor');
  assert.equal(fileSuffix('/a/b.c/noext'), undefined);
  assert.equal(fileSuffix(undefined), undefined);
});

// ---------------------------------------------------------------------------
// Grammars of the newly registered artifacts
// ---------------------------------------------------------------------------
test('grammar: .hdbtextbundle keys, values, directives, text types, escapes and placeholders', () => {
  const t = tokenize(
    'source.hdbtextbundle',
    '# TRANSLATE\n# XTIT,40: Title\nhello=Hello {0}\\u00e4\ngreeting : Hi \\\n  there\n! note\n'
  );
  const ok = (text: string, scope: string): void => assert.ok(has(t, text, scope), `"${text}" should have ${scope}`);
  ok('TRANSLATE', 'keyword.other.directive.hdbtextbundle');
  ok('XTIT', 'storage.type.text-type.hdbtextbundle');
  ok('40', 'constant.numeric.max-length.hdbtextbundle');
  ok('hello', 'support.type.property-name.hdbtextbundle');
  ok('=', 'punctuation.separator.key-value.hdbtextbundle');
  ok('{0}', 'variable.parameter.placeholder.hdbtextbundle');
  ok('\\u00e4', 'constant.character.escape.hdbtextbundle');
  ok('greeting', 'support.type.property-name.hdbtextbundle');
  ok('  there', 'string.unquoted.value.hdbtextbundle');
  ok(' note', 'comment.line.number-sign.hdbtextbundle');
  // negative: a continued value line is not a key, a key is not a value, `#` inside a value is no comment
  assert.ok(!has(t, '  there', 'support.type.property-name.hdbtextbundle'));
  const v = tokenize('source.hdbtextbundle', 'url=http://host/#anchor\n');
  assert.ok(!v.some((x) => x.scopes.some((s) => s.startsWith('comment.'))), 'a # inside a value is not a comment');
  assert.ok(!has(v, 'url', 'string.unquoted.value.hdbtextbundle'));
});

test('grammar: .proceduretemplate placeholders inside SQL, but not in comments, strings or comparisons', () => {
  const t = tokenize(
    'source.proceduretemplate',
    "PROCEDURE p () AS\nBEGIN\n  SELECT <My_Column> FROM (SELECT * FROM <My_Table>) WHERE a < b AND c > d;\n  -- <Not_A_Param>\n  x = '<Text>';\nEND;\n"
  );
  assert.ok(has(t, '<My_Column>', 'variable.parameter.placeholder.proceduretemplate'));
  assert.ok(has(t, '<My_Table>', 'variable.parameter.placeholder.proceduretemplate'));
  assert.ok(has(t, 'SELECT', 'keyword.other.dml.hanasql'), 'SQL is still highlighted');
  const placeholders = t.filter((x) => x.scopes.includes('variable.parameter.placeholder.proceduretemplate')).map((x) => x.text);
  assert.deepEqual(placeholders, ['<My_Column>', '<My_Table>']);
});

test('grammar: new suffixes map to the expected grammars and injections', () => {
  const grammarOf = new Map(pkg.contributes.grammars.filter((g) => g.language).map((g) => [g.language!, g.scopeName]));
  assert.equal(grammarOf.get('hdbscalarfunction'), 'source.hanasql');
  assert.equal(grammarOf.get('xscprocedure'), 'text.xml.hana');
  assert.equal(grammarOf.get('xscxmlmodel'), 'text.xml.hana');
  assert.equal(grammarOf.get('proceduretemplate'), 'source.proceduretemplate');
  assert.equal(grammarOf.get('hdbtextbundle'), 'source.hdbtextbundle');
  assert.ok(pkg.contributes.grammars.find((g) => g.scopeName === 'proceduretemplate.injection')?.injectTo?.includes('source.proceduretemplate'));
  const byId = new Map(pkg.contributes.languages.map((l) => [l.id, l]));
  assert.ok(byId.get('ignore')?.filenames?.includes('.hdiignore'));
  // negative: SAP HANA Studio files are not associated (#119), and no HANA language claims .hdiignore
  for (const l of pkg.contributes.languages) {
    for (const f of ['.project', '.jsdtscope', '.regiignore']) assert.ok(!l.filenames?.includes(f), `${l.id} claims ${f}`);
    if (l.id !== 'ignore') assert.ok(!l.filenames?.includes('.hdiignore'), `${l.id} claims .hdiignore`);
  }
});

test('undeploy.json schema: accepts the HDI Deployer example and rejects absolute or backslash paths', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'resources', 'schemas', 'undeploy.schema.json'), 'utf8')) as {
    type: string;
    uniqueItems: boolean;
    items: { type: string; pattern: string };
  };
  assert.equal(schema.type, 'array');
  assert.equal(schema.uniqueItems, true);
  const re = new RegExp(schema.items.pattern);
  const sample = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'samples', 'hdi', 'undeploy.json'), 'utf8')) as string[];
  for (const p of sample) assert.ok(re.test(p), p);
  for (const bad of ['/src/Table.hdbcds', 'src\\Table.hdbcds']) assert.ok(!re.test(bad), bad);
  const entry = pkg.contributes.jsonValidation?.find((v) => v.fileMatch === 'undeploy.json');
  assert.equal(entry?.url, './resources/schemas/undeploy.schema.json');
});
