'use strict';
/**
 * Generates the SQL word sets from the catalog (docs/specs/catalogs/sql-keywords.json + builtin-functions.json):
 *   - src/formatter/keywords.ts     formatter word classes and formatter context roles
 *   - src/analyzer/keyword-sets.ts  analyzer context roles, CE_FUNCTIONS, HDI_ROOT_TARGETS
 * and rewrites both catalog files in canonical form (sorted, one line per word).
 *
 *   node scripts/build-keywords.js           write everything
 *   node scripts/build-keywords.js --check   exit 1 if any output is stale (CI / drift test)
 *
 * Spec: docs/specs/SPEC_RULES.md §2.C. `npm run build:keywords` also regenerates sql-catalog.ts and the grammars.
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib/sql-catalog');

/** Map of repo-relative path -> generated content. */
function buildKeywordOutputs(model = lib.loadCatalog()) {
  return {
    'docs/specs/catalogs/sql-keywords.json': lib.formatKeywordCatalog(model),
    'docs/specs/catalogs/builtin-functions.json': lib.formatFunctionCatalog(model),
    [lib.EMIT_MODULES.formatter]: lib.emitFormatterKeywords(model),
    [lib.EMIT_MODULES.analyzer]: lib.emitAnalyzerKeywordSets(model),
  };
}

/** Writes (or, with `check`, compares) outputs. Returns the stale paths. */
function syncOutputs(outputs, check) {
  const stale = [];
  for (const [rel, content] of Object.entries(outputs)) {
    const file = path.join(lib.ROOT, rel);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current === content) continue;
    stale.push(rel);
    if (!check) fs.writeFileSync(file, content, 'utf8');
  }
  return stale;
}

function main() {
  const check = process.argv.includes('--check');
  const model = lib.loadCatalog();
  const stale = syncOutputs(buildKeywordOutputs(model), check);
  if (check && stale.length) {
    console.error(`Stale generated files (run npm run build:keywords):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`${model.words.size} words, ${model.roles.size} roles, ${model.functions.length} functions${stale.length ? `; wrote ${stale.join(', ')}` : '; up to date'}`);
}

if (require.main === module) main();

module.exports = { buildKeywordOutputs, syncOutputs };
