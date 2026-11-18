'use strict';
/**
 * The SAP HANA SQL / SQLScript word catalog: loader, validator, canonical serializer and code emitters.
 *
 * Sources of truth (spec: docs/specs/SPEC_RULES.md §2.C):
 *   - docs/specs/catalogs/sql-keywords.json     every non-function word, with its roles
 *   - docs/specs/catalogs/builtin-functions.json every built-in function, with its category
 *
 * Everything that knows SQL words is generated from these two files:
 *   - syntaxes/hanasql.tmLanguage.json (word alternations, via scripts/build-grammars.js)
 *   - src/formatter/keywords.ts          (scripts/build-keywords.js)
 *   - src/analyzer/keyword-sets.ts       (scripts/build-keywords.js)
 *   - src/sql/sql-catalog.ts             (scripts/build-sql-catalog.js)
 *
 * Dependency-free on purpose: the build scripts and the drift test both require this module.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const KEYWORDS_PATH = path.join(ROOT, 'docs', 'specs', 'catalogs', 'sql-keywords.json');
const FUNCTIONS_PATH = path.join(ROOT, 'docs', 'specs', 'catalogs', 'builtin-functions.json');

const PLATFORMS = ['XSC', 'XSA', 'HDI', 'CLOUD'];
const ROLE_GROUPS = ['lexical', 'context'];
const EMIT_MODULES = {
  analyzer: 'src/analyzer/keyword-sets.ts',
  formatter: 'src/formatter/keywords.ts',
};
const WORD_RE = /^[A-Z_][A-Z0-9_]*$/;
const ROLE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CONST_RE = /^[A-Z][A-Z0-9_]*$/;

class CatalogError extends Error {}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Loads and validates both catalogs. Throws a CatalogError listing every problem found. */
function loadCatalog(raw = { keywords: readJson(KEYWORDS_PATH), functions: readJson(FUNCTIONS_PATH) }) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  // ---- roles ----------------------------------------------------------------------------------------------
  const roles = new Map();
  for (const [id, role] of Object.entries(raw.keywords.roles || {})) {
    if (!ROLE_ID_RE.test(id)) fail(`role id '${id}' must be kebab-case`);
    if (!ROLE_GROUPS.includes(role.group)) fail(`role '${id}': group must be one of ${ROLE_GROUPS.join(', ')}`);
    if (!role.description) fail(`role '${id}': description is required`);
    if (role.const !== undefined && !CONST_RE.test(role.const)) fail(`role '${id}': const '${role.const}' must be UPPER_SNAKE`);
    if ((role.emit || []).length && !role.const) fail(`role '${id}': emit needs a const name`);
    for (const m of role.emit || []) if (!EMIT_MODULES[m]) fail(`role '${id}': unknown emit module '${m}'`);
    if (role.order && !role.const) fail(`role '${id}': order needs a const name`);
    roles.set(id, { id, ...role, members: [] });
  }
  const constOwners = new Map();
  for (const role of roles.values()) {
    for (const m of role.emit || []) {
      const key = `${m}:${role.const}`;
      if (constOwners.has(key)) fail(`roles '${constOwners.get(key)}' and '${role.id}' both emit ${role.const} into ${m}`);
      constOwners.set(key, role.id);
    }
  }
  const roleOrder = [...roles.keys()];

  // ---- words ----------------------------------------------------------------------------------------------
  const words = new Map();
  for (const w of raw.keywords.words || []) {
    if (!WORD_RE.test(w.name || '')) fail(`word '${w.name}': names are upper-case SQL identifiers`);
    if (words.has(w.name)) fail(`word '${w.name}' is listed twice`);
    if (!Array.isArray(w.roles) || w.roles.length === 0) fail(`word '${w.name}': needs at least one role`);
    const seen = new Set();
    for (const r of w.roles || []) {
      if (!roles.has(r)) fail(`word '${w.name}': unknown role '${r}'`);
      if (seen.has(r)) fail(`word '${w.name}': role '${r}' is listed twice`);
      seen.add(r);
    }
    if (w.platforms !== undefined) {
      if (!Array.isArray(w.platforms) || w.platforms.length === 0) fail(`word '${w.name}': platforms must be a non-empty array`);
      for (const p of w.platforms || []) if (!PLATFORMS.includes(p)) fail(`word '${w.name}': unknown platform '${p}'`);
    }
    words.set(w.name, {
      name: w.name,
      roles: [...(w.roles || [])].sort((a, b) => roleOrder.indexOf(a) - roleOrder.indexOf(b)),
      platforms: w.platforms ? PLATFORMS.filter((p) => w.platforms.includes(p)) : PLATFORMS,
      ...(w.source ? { source: w.source } : {}),
      ...(w.note ? { note: w.note } : {}),
    });
  }
  for (const w of words.values()) for (const r of w.roles) roles.get(r)?.members.push(w.name);
  for (const role of roles.values()) {
    role.members.sort();
    if (role.members.length === 0) fail(`role '${role.id}' has no words`);
    if (role.order) {
      const a = [...role.order].sort().join(' ');
      const b = role.members.join(' ');
      if (a !== b) fail(`role '${role.id}': order [${role.order.join(' ')}] must list exactly its words [${b}]`);
    }
  }

  // ---- artifact roots ---------------------------------------------------------------------------------------
  const artifactRoots = new Map();
  for (const [lang, list] of Object.entries(raw.keywords.artifactRoots || {})) {
    for (const w of list) if (!words.has(w)) fail(`artifactRoots.${lang}: '${w}' is not a catalog word`);
    artifactRoots.set(lang, [...list]);
  }

  // ---- functions --------------------------------------------------------------------------------------------
  const categories = new Map(Object.entries(raw.functions.categories || {}));
  for (const [id, c] of categories) {
    if (!ROLE_ID_RE.test(id)) fail(`function category '${id}' must be kebab-case`);
    if (!c.description) fail(`function category '${id}': description is required`);
  }
  const functions = [];
  const fnKeys = new Set();
  for (const f of raw.functions.functions || []) {
    const key = `${f.library}:${f.name}`;
    if (fnKeys.has(key)) fail(`function ${key} is listed twice`);
    fnKeys.add(key);
    if (!WORD_RE.test(f.name || '')) fail(`function '${f.name}': names are upper-case SQL identifiers`);
    if (!categories.has(f.category)) fail(`function ${key}: unknown category '${f.category}'`);
    if (!Array.isArray(f.signatures) || f.signatures.length === 0) fail(`function ${key}: needs at least one signature`);
    for (const p of f.platforms || []) if (!PLATFORMS.includes(p)) fail(`function ${key}: unknown platform '${p}'`);
    functions.push(f);
  }

  if (errors.length) throw new CatalogError(`SQL catalog is invalid:\n  - ${errors.join('\n  - ')}`);
  return { raw, roles, roleOrder, words, artifactRoots, categories, functions };
}

// ---- queries --------------------------------------------------------------------------------------------------

/** Words having `roleId`, sorted. */
function wordsWithRole(model, roleId) {
  const role = model.roles.get(roleId);
  if (!role) throw new CatalogError(`unknown role '${roleId}'`);
  return role.members;
}

/** Global (non-library-member) function names of the given categories, sorted. */
function functionsInCategories(model, categoryIds) {
  const set = new Set(categoryIds);
  return [...new Set(model.functions.filter((f) => set.has(f.category)).map((f) => f.name))].sort();
}

/** Categories whose functions are highlighted as global calls (have a grammar scope). */
function globalFunctionNames(model) {
  const cats = [...model.categories].filter(([, c]) => c.scope).map(([id]) => id);
  return functionsInCategories(model, cats);
}

/** A library constant (`LEVEL_INFO CONSTANT VARCHAR(7)`) or other name used without a call. */
function isConstantFunction(f) {
  const sig = f.signatures[0] || '';
  return /CONSTANT\b/i.test(sig) || !sig.includes('(');
}

/** The first role (registry order) of a word that carries a TextMate scope: its hover / completion class. */
function primaryScopedRole(model, word) {
  for (const r of word.roles) if (model.roles.get(r).scope) return model.roles.get(r);
  return null;
}

// ---- canonical serialization ------------------------------------------------------------------------------------

const ROLE_KEY_ORDER = ['group', 'const', 'emit', 'scope', 'format', 'description', 'context', 'source', 'order'];
const WORD_KEY_ORDER = ['name', 'roles', 'platforms', 'source', 'note'];

function orderKeys(obj, order) {
  const out = {};
  for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
  return out;
}

/** The canonical text of sql-keywords.json: roles pretty-printed, one line per artifact and per word. */
function formatKeywordCatalog(model) {
  const lines = ['{'];
  if (model.raw.keywords.$comment) lines.push(`  "$comment": ${JSON.stringify(model.raw.keywords.$comment)},`);
  lines.push('  "roles": {');
  const roleIds = model.roleOrder;
  roleIds.forEach((id, i) => {
    const { members, id: _id, ...rest } = model.roles.get(id);
    const body = JSON.stringify(orderKeys(rest, ROLE_KEY_ORDER), null, 2).replace(/\n/g, '\n    ');
    lines.push(`    ${JSON.stringify(id)}: ${body}${i < roleIds.length - 1 ? ',' : ''}`);
  });
  lines.push('  },');
  lines.push('  "artifactRoots": {');
  const langs = [...model.artifactRoots.keys()];
  langs.forEach((lang, i) => {
    lines.push(`    ${JSON.stringify(lang)}: ${JSON.stringify(model.artifactRoots.get(lang))}${i < langs.length - 1 ? ',' : ''}`);
  });
  lines.push('  },');
  lines.push('  "words": [');
  const names = [...model.words.keys()].sort();
  names.forEach((name, i) => {
    const w = model.words.get(name);
    const out = orderKeys(
      {
        name: w.name,
        roles: w.roles,
        ...(w.platforms.length === PLATFORMS.length ? {} : { platforms: w.platforms }),
        ...(w.source ? { source: w.source } : {}),
        ...(w.note ? { note: w.note } : {}),
      },
      WORD_KEY_ORDER
    );
    lines.push(`    ${JSON.stringify(out).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,"/g, ', "')}${i < names.length - 1 ? ',' : ''}`);
  });
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n') + '\n';
}

const FUNCTION_KEY_ORDER = [
  'name',
  'library',
  'category',
  'kind',
  'receiverType',
  'platforms',
  'signatures',
  'params',
  'returnType',
  'returnDescription',
  'description',
  'deterministic',
  'source',
];

/** The canonical text of builtin-functions.json: categories first, functions sorted by library then name. */
function formatFunctionCatalog(model) {
  const fns = [...model.functions]
    .sort((a, b) => a.library.localeCompare(b.library) || a.name.localeCompare(b.name))
    .map((f) => orderKeys(f, FUNCTION_KEY_ORDER));
  const out = {
    ...(model.raw.functions.$comment ? { $comment: model.raw.functions.$comment } : {}),
    categories: Object.fromEntries(model.categories),
    functions: fns,
  };
  return JSON.stringify(out, null, 2) + '\n';
}

// ---- TypeScript emitters ------------------------------------------------------------------------------------------

function fmtWords(words, indent = '  ', width = 110) {
  const lines = [];
  let cur = indent;
  for (const w of words) {
    const piece = `'${w}', `;
    if (cur.length + piece.length > width && cur.trim()) {
      lines.push(cur.trimEnd());
      cur = indent;
    }
    cur += piece;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.join('\n');
}

function setDecl(name, words, doc) {
  const comment = doc ? `/** ${doc} */\n` : '';
  return `${comment}export const ${name}: ReadonlySet<string> = new Set<string>([\n${fmtWords(words)}\n]);\n`;
}

function listDecl(name, words, doc) {
  const comment = doc ? `/** ${doc} */\n` : '';
  return `${comment}export const ${name}: readonly string[] = [\n${fmtWords(words)}\n];\n`;
}

function roleDoc(role) {
  const parts = [role.description];
  if (role.context) parts.push(`Context: ${role.context}`);
  parts.push(`Catalog role \`${role.id}\`.`);
  return parts.join(' ').replace(/\*\//g, '*\\/');
}

function emitRoleDecls(model, moduleId) {
  const out = [];
  for (const id of model.roleOrder) {
    const role = model.roles.get(id);
    if (!(role.emit || []).includes(moduleId)) continue;
    out.push(role.order ? listDecl(role.const, role.order, roleDoc(role)) : setDecl(role.const, role.members, roleDoc(role)));
  }
  return out;
}

const GENERATED_HEADER = (what) =>
  `// Generated by ${what} from docs/specs/catalogs/ (sql-keywords.json + builtin-functions.json).\n` +
  '// Do not hand-edit: change the catalog and run `npm run build:keywords`. Spec: docs/specs/SPEC_RULES.md §2.C.\n';

/** Formatter word classes + formatter context roles (src/formatter/keywords.ts). */
function emitFormatterKeywords(model) {
  const withFormat = (fmt) =>
    [...model.words.values()].filter((w) => w.roles.some((r) => model.roles.get(r).format === fmt)).map((w) => w.name);
  const KEYWORDS = withFormat('keyword');
  const TYPES = withFormat('type');
  const FUNCTIONS = globalFunctionNames(model);
  const RESERVED = wordsWithRole(model, 'reserved');
  const PROTECTED = [...new Set([...KEYWORDS, ...TYPES, ...FUNCTIONS, ...RESERVED, ...wordsWithRole(model, 'quote-protected')])].sort();
  const parts = [
    GENERATED_HEADER('scripts/build-keywords.js'),
    setDecl('KEYWORDS', KEYWORDS, 'Words the formatter cases as keywords in any position (roles with `format: "keyword"`).'),
    setDecl('FUNCTIONS', FUNCTIONS, 'Built-in function names the formatter cases as functions when followed by `(`.'),
    setDecl('TYPES', TYPES, 'Data type names (role `type`).'),
    setDecl('RESERVED', RESERVED, 'SAP HANA reserved words (role `reserved`).'),
    setDecl('PROTECTED', PROTECTED, 'Words whose double quotes `identifierQuotes: "removeUnnecessary"` must keep.'),
    setDecl('SYSTEM_WORDS', wordsWithRole(model, 'alter-system-word'), 'Words cased as keywords inside `ALTER SYSTEM` statements (role `alter-system-word`).'),
    setDecl('STATEMENT_NOUNS', wordsWithRole(model, 'statement-noun'), 'Object nouns cased as keywords near the start of a DDL statement (role `statement-noun`).'),
    ...emitRoleDecls(model, 'formatter'),
  ];
  return parts.join('\n');
}

/** Analyzer context roles + artifact roots + function-derived sets (src/analyzer/keyword-sets.ts). */
function emitAnalyzerKeywordSets(model) {
  const roots = [...model.artifactRoots]
    .map(([lang, list]) => `  ${lang}: [${list.map((w) => `'${w}'`).join(', ')}],`)
    .join('\n');
  const parts = [
    GENERATED_HEADER('scripts/build-keywords.js'),
    ...emitRoleDecls(model, 'analyzer'),
    setDecl(
      'CE_FUNCTIONS',
      functionsInCategories(model, ['calculation-engine']),
      'Calculation Engine plan operators (`builtin-functions.json` category `calculation-engine`) `[XSC]` `[XSA]` `[HDI]`.'
    ),
    '/** Keywords that may start a headerless HDI design-time artifact, per language id (`artifactRoots`) `[HDI]`. */\n' +
      `export const HDI_ROOT_TARGETS: Readonly<Record<string, readonly string[]>> = {\n${roots}\n};\n`,
  ];
  return parts.join('\n');
}

module.exports = {
  ROOT,
  KEYWORDS_PATH,
  FUNCTIONS_PATH,
  PLATFORMS,
  EMIT_MODULES,
  CatalogError,
  loadCatalog,
  wordsWithRole,
  functionsInCategories,
  globalFunctionNames,
  isConstantFunction,
  primaryScopedRole,
  formatKeywordCatalog,
  formatFunctionCatalog,
  emitFormatterKeywords,
  emitAnalyzerKeywordSets,
};
