'use strict';
/**
 * The `source.hanasql` TextMate grammar. Every keyword / function alternation comes from the SQL catalog
 * (docs/specs/catalogs/, spec: docs/specs/SPEC_RULES.md §2.C); phrases, literals and punctuation are written here.
 * Built by scripts/build-grammars.js; never hand-edit syntaxes/hanasql.tmLanguage.json.
 */
const lib = require('./sql-catalog');

/**
 * Regex alternation of `words`. A word that extends another word comes first (`PROFILER` before `PROFILE`), so
 * the alternation is also correct where it is not followed by `\b`; otherwise alphabetical.
 */
function alternation(words) {
  if (words.length === 0) throw new lib.CatalogError('empty word alternation');
  const key = (w) => w + '\uffff';
  return [...new Set(words)].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).join('|');
}

/** `(?i)\b(?:<words>)\b`, optionally only before `(` (function call context). */
function wordMatch(words, { call = false } = {}) {
  return `(?i)\\b(?:${alternation(words)})\\b${call ? '(?=\\s*\\()' : ''}`;
}

/**
 * Leading word boundary that also holds right after a key-value string escape (`\n`, `\t`, `\r`). XS Classic
 * `.hdbview` / `.hdbsequence` embed SQL in `"..."` strings, where `SELECT \"A\"\nFROM T` must still highlight `FROM`:
 * a plain `\b` fails there because `n` and `F` are both word characters. Outside strings a backslash is never valid
 * SQL, so the extra alternative changes nothing for `.sql` files.
 */
const WORD_START = '(?:\\b|(?<=\\\\[nrt]))';

/** Rewrites every leading `(?i)\b` of `match` / `begin` into WORD_START (see above), in place. */
function allowAfterKvEscape(node) {
  if (Array.isArray(node)) node.forEach(allowAfterKvEscape);
  else if (node && typeof node === 'object') {
    for (const key of ['match', 'begin']) {
      if (typeof node[key] === 'string') node[key] = node[key].replace(/^\(\?i\)\\b/, `(?i)${WORD_START}`);
    }
    Object.values(node).forEach(allowAfterKvEscape);
  }
  return node;
}

/**
 * Clause phrases: non-reserved words that are keywords only next to a fixed neighbour (spec: sql-sqlscript.md §3.4).
 * A bare `range`, `data`, `first` or `matched` stays an identifier. Each entry is one `(?i)` regex; the whole match
 * gets the `clause-word` scope unless the entry gives `captures`. `NOT_AN_OPERAND` is filled in from the catalog.
 */
const CLAUSE_PHRASES = [
  // partitioning `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`: PARTITION BY RANGE (a), SUBPARTITION BY HASH (b), ALTER PARTITION RANGE (c)
  String.raw`\b(?:SUB)?PARTITION\s+BY\s+(?:RANGE|HASH|ROUNDROBIN)\b`,
  String.raw`\b(?:RANGE|HASH|ROUNDROBIN)\b(?=\s*\()`,
  // window frames: ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW, RANGE 2 PRECEDING
  String.raw`\b(?:ROWS|RANGE)\b(?=\s+(?:BETWEEN|UNBOUNDED|CURRENT|\d))`,
  String.raw`\bUNBOUNDED\s+(?:PRECEDING|FOLLOWING)\b`,
  { match: String.raw`\b(\d+)\s+(PRECEDING|FOLLOWING)\b`, captures: { 1: 'constant.numeric.hanasql', 2: 'clause' } },
  String.raw`\bCURRENT\s+ROW\b`,
  // ORDER BY ... NULLS FIRST, FIRST_VALUE(x IGNORE NULLS)
  String.raw`\bNULLS\s+(?:FIRST|LAST)\b`,
  String.raw`\b(?:IGNORE|RESPECT)\s+NULLS\b`,
  // hints: WITH HINT (...), ALTER SYSTEM ADD STATEMENT HINT (...) FOR STATEMENT HASH '...'
  String.raw`\b(?:WITH|STATEMENT)\s+HINT\b`,
  String.raw`\bHINT\b(?=\s*\()`,
  String.raw`\bSTATEMENT\b(?=\s+(?:HINT|HASH)\b)`,
  // MERGE INTO ... WHEN [NOT] MATCHED
  String.raw`\bWHEN\s+(?:NOT\s+)?MATCHED\b`,
  // triggers: AFTER UPDATE OF c ON t, INSTEAD OF DELETE, FOR EACH ROW, REFERENCING NEW ROW AS n
  String.raw`\b(?:BEFORE|AFTER)\s+(?:INSERT|UPDATE|DELETE)\b`,
  String.raw`\bINSTEAD\s+OF\b`,
  String.raw`\bFOR\s+EACH\s+(?:ROW|STATEMENT)\b`,
  String.raw`\bREFERENCING\s+(?:NEW|OLD)\s+(?:ROW|TABLE)\b`,
  // dynamic SQL and ALTER ... IMMEDIATE
  String.raw`\bEXEC(?:UTE)?\s+IMMEDIATE\b`,
  String.raw`\bIMMEDIATE\b(?=\s*;)`,
  // transactions and routine characteristics: READ ONLY, READ COMMITTED, READS SQL DATA, HEADER ONLY, WITH DDL ONLY
  String.raw`\bISOLATION\s+LEVEL\b`,
  String.raw`\bREAD\s+(?:ONLY|WRITE|COMMITTED|UNCOMMITTED)\b`,
  String.raw`\b(?:READS|MODIFIES)\s+SQL\s+DATA\b`,
  String.raw`\b(?:HEADER|DDL)\s+ONLY\b`,
  // CREATE TABLE ... AS (...) WITH [NO] DATA, IMPORT DATA; never the CTE `WITH data AS (...)` / `WITH data (a) AS`
  String.raw`\bWITH\s+(?:NO\s+)?DATA\b(?!\s*\(|\s+AS\b)`,
  String.raw`\b(?:IMPORT|EXPORT)\s+DATA\b`,
  String.raw`\b(?:VALID\s+)?FOR\s+DATA\s+DEPENDENCY\b`,
  // temporary tables: ON COMMIT DELETE ROWS / PRESERVE ROWS
  String.raw`\b(?:DELETE|PRESERVE)\s+ROWS\b`,
  // LIKE ... ESCAPE '\'
  String.raw`\bESCAPE\b(?=\s*')`,
  // IMPORT FROM CSV FILE ... SKIP FIRST 1 ROW, COLUMN LIST IN FIRST ROW
  String.raw`\bSKIP\s+FIRST\b`,
  String.raw`\bFIRST\s+ROW\b`,
  // sequences: INCREMENT BY 1 NO CYCLE, MAXVALUE 100, RESET BY SELECT ...
  String.raw`\bINCREMENT\s+BY\b`,
  String.raw`\bRESET\s+BY\b`,
  String.raw`\bNO\s+(?:CYCLE|MINVALUE|MAXVALUE)\b`,
  String.raw`\b(?:MINVALUE|MAXVALUE)\b(?=\s*-?\d)`,
  // NO <option>: NO PRIMARY KEY, NO FORCE_FIRST_PASSWORD_CHANGE, NO DDL ONLY, but not a column `no` before FROM / AS / AND
  'NO_OPTION',
  // ALTER SYSTEM ALTER CONFIGURATION ... WITH RECONFIGURE, EXPLAIN PLAN, SERIES_GENERATE(SERIES TABLE t)
  String.raw`\bWITH\s+RECONFIGURE\b`,
  String.raw`\bEXPLAIN\s+PLAN\b`,
  String.raw`\bSERIES\s+TABLE\b`,
  // user groups: SET PARAMETER ... ENABLE PARAMETER SET, CONNECT RESTRICTION (r IP ('...') APPLICATION ('...'))
  String.raw`\b(?:ENABLE|DISABLE)\s+PARAMETER\s+SET\b`,
  String.raw`\b(?:IP|APPLICATION)\b(?=\s*\()`,
];

function buildHanasqlGrammar(model = lib.loadCatalog()) {
  const role = (id) => model.roles.get(id);
  const words = (id) => lib.wordsWithRole(model, id);
  const scope = (id) => role(id).scope;
  const roleRule = (id) => ({ name: scope(id), match: wordMatch(words(id)) });
  // One call-context pattern per function scope (several categories can share `support.function.hanasql`), in
  // registry order. SQLScript-scoped categories are matched in `sqlscript-builtins` below.
  const sqlscriptScope = model.categories.get('sqlscript').scope;
  const byScope = new Map();
  for (const [id, c] of model.categories) {
    if (!c.scope || c.scope === sqlscriptScope) continue;
    if (!byScope.has(c.scope)) byScope.set(c.scope, []);
    byScope.get(c.scope).push(id);
  }
  // Constructors that are also data types (`ST_POINT`) keep their type scope: `geom ST_POINT(4326)` is a column type,
  // `NEW ST_POINT(1, 2)` a constructor call, and only the `NEW` context tells them apart.
  const typeConstructors = new Set(
    model.functions
      .filter((f) => f.kind === 'constructor' && f.signatures.every((sig) => /^NEW\s/i.test(sig)) && model.words.get(f.name)?.roles.includes('type'))
      .map((f) => f.name)
  );
  const functionRules = [...byScope].map(([name, cats]) => ({
    name,
    match: wordMatch(lib.functionsInCategories(model, cats).filter((n) => !typeConstructors.has(n)), { call: true }),
  }));
  const libraryConstants = model.functions
    .filter((f) => f.category === 'sqlscript-library' && lib.isConstantFunction(f))
    .map((f) => f.name);
  const sqlscriptCalls = lib.functionsInCategories(model, ['sqlscript', 'graphscript']);
  const clauseScope = scope('clause-word');
  // `NO` is an option prefix unless an operand-ending word follows it (`SELECT no FROM t`, `no AS n`, `no IS NULL`)
  const notAnOperand = alternation([...words('non-alias'), ...words('word-operator')]);
  const clausePhrases = CLAUSE_PHRASES.map((p) => {
    if (p === 'NO_OPTION') return { name: clauseScope, match: `(?i)\\bNO\\b(?=[ \\t]+[A-Za-z_])(?![ \\t]+(?:${notAnOperand})\\b)` };
    if (typeof p === 'string') return { name: clauseScope, match: `(?i)${p}` };
    const captures = {};
    for (const [i, s] of Object.entries(p.captures)) captures[i] = { name: s === 'clause' ? clauseScope : s };
    return { match: `(?i)${p.match}`, captures };
  });
  const hierarchyFunctions = words('hierarchy-clause-function');
  const hierarchyScope = byScopeOf(model, hierarchyFunctions);

  return allowAfterKvEscape({
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'SAP HANA SQL',
    scopeName: 'source.hanasql',
    patterns: [
      {
        "include": "#comments"
      },
      {
        "include": "#strings"
      },
      {
        "include": "#quoted-identifiers"
      },
      {
        "include": "#entity-definitions"
      },
      {
        "include": "#statements"
      },
      {
        "include": "#clause-phrases"
      },
      {
        "include": "#hierarchy-call"
      },
      {
        "include": "#numbers"
      },
      {
        "include": "#sqlscript-variables"
      },
      {
        "include": "#functions"
      },
      {
        "include": "#sqlscript-builtins"
      },
      {
        "include": "#types"
      },
      {
        "include": "#constants"
      },
      {
        "include": "#logical-operators"
      },
      {
        "include": "#keywords"
      },
      {
        "include": "#operators"
      }
    ],
    repository: {
      comments: {
        "patterns": [
          {
            "name": "comment.line.double-dash.hanasql",
            "match": "--.*$"
          },
          {
            "name": "comment.block.hanasql",
            "begin": "/\\*",
            "end": "\\*/"
          }
        ]
      },
      strings: {
        "name": "string.quoted.single.hanasql",
        "begin": "(?i)(?:\\b[NX])?'",
        "end": "'(?!')",
        "patterns": [
          {
            "name": "constant.character.escape.hanasql",
            "match": "''"
          }
        ]
      },
      'quoted-identifiers': {
        "name": "variable.other.quoted-identifier.hanasql",
        "match": "\"(?:[^\"]|\"\")*\""
      },
      'entity-definitions': {
        "patterns": [
          {
            "comment": "CREATE [OR REPLACE] <object> <name>",
            "match": "(?i)\\b(CREATE(?:\\s+OR\\s+REPLACE)?)\\s+((?:(?:COLUMN|ROW|GLOBAL\\s+TEMPORARY|LOCAL\\s+TEMPORARY|TEMPORARY|VIRTUAL|PUBLIC|UNIQUE|HISTORY|COLLECTION)\\s+)*(?:TABLE|VIEW|PROCEDURE|FUNCTION|SCHEMA|SEQUENCE|SYNONYM|TRIGGER|TYPE|INDEX|ROLE|USER|PROJECTION\\s+VIEW|FULLTEXT\\s+INDEX))\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(\"(?:[^\"]|\"\")+\"(?:\\.\"(?:[^\"]|\"\")+\")?|[A-Za-z_#$][\\w#$]*(?:\\.[A-Za-z_#$][\\w#$]*)?)",
            "captures": {
              "1": {
                "name": "keyword.control.ddl.hanasql"
              },
              "2": {
                "name": "keyword.control.ddl.hanasql"
              },
              "3": {
                "name": "entity.name.type.hanasql"
              }
            }
          },
          {
            "comment": "HDI design-time artifacts (no CREATE): PROCEDURE \"name\", COLUMN TABLE \"name\", STRUCTURED PRIVILEGE \"name\", RESULT CACHE \"name\", ...",
            "match": "(?i)^\\s*((?:COLUMN|ROW)\\s+TABLE|TABLE\\s+TYPE|VIRTUAL\\s+(?:TABLE|FUNCTION|PROCEDURE)|APPLICATION\\s+TIME|GRAPH\\s+WORKSPACE|PROJECTION\\s+VIEW|STRUCTURED\\s+(?:PRIVILEGE|FILTER)|RESULT\\s+CACHE|SYSTEM\\s+VERSIONING|SCHEDULER\\s+JOB|REMOTE\\s+TABLE\\s+REPLICA|(?:FUZZY\\s+SEARCH|FULLTEXT|UNIQUE|HASH|BLOCK\\s+RANGE|ADJACENCY|INVERTED\\s+(?:HASH|VALUE))\\s+INDEX|INDEX|COLLECTION|LIBRARY|STATISTICS|SEQUENCE|TRIGGER|PROCEDURE|FUNCTION|VIEW|TABLE)\\s+(\\\"(?:[^\\\"]|\\\"\\\")+\\\"(?:\\.\\\"(?:[^\\\"]|\\\"\\\")+\\\")?|[A-Za-z_#$][\\w#$]*(?:\\.[A-Za-z_#$][\\w#$]*)?)",
            "captures": {
              "1": {
                "name": "keyword.control.ddl.hanasql"
              },
              "2": {
                "name": "entity.name.type.hanasql"
              }
            }
          },
          {
            "comment": "HDI headerless Fabric Virtual Table: SHARED [SNAPSHOT] REPLICA [PAGE|COLUMN LOADABLE] ON \"VT\"",
            "match": "(?i)^\\s*(SHARED(?:\\s+SNAPSHOT)?\\s+REPLICA(?:\\s+(?:PAGE|COLUMN)\\s+LOADABLE)?\\s+ON)\\s+(\"(?:[^\"]|\"\")+\"(?:\\.\"(?:[^\"]|\"\")+\")?|[A-Za-z_#$][\\w#$]*(?:\\.[A-Za-z_#$][\\w#$]*)?)",
            "captures": {
              "1": {
                "name": "keyword.control.ddl.hanasql"
              },
              "2": {
                "name": "entity.name.type.hanasql"
              }
            }
          }
        ]
      },
      numbers: {
        "name": "constant.numeric.hanasql",
        "match": "\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\.\\d+(?:[eE][+-]?\\d+)?\\b"
      },
      'sqlscript-variables': {
        "patterns": [
          {
            "name": "support.variable.system.hanasql",
            "match": "(?i)::[A-Za-z_][A-Za-z0-9_]*"
          },
          {
            "name": "variable.other.readwrite.hanasql",
            "match": "(?<![:\\w]):[A-Za-z_#$][\\w#$]*"
          }
        ]
      },
      functions: {
        patterns: functionRules,
      },
      types: roleRule('type'),
      constants: {
        patterns: [roleRule('literal'), roleRule('system-value')],
      },
      'logical-operators': roleRule('word-operator'),
      keywords: {
        patterns: [roleRule('control-flow'), roleRule('dml'), roleRule('ddl'), roleRule('preposition')],
      },
      'clause-phrases': { patterns: clausePhrases },
      // HIERARCHY*( SOURCE ... START WHERE ... SIBLING ORDER BY ... DEPTH n ... ): clause words only inside the call.
      // Nested parentheses are balanced by #parens so the region ends at the call's own `)`.
      'hierarchy-call': {
        begin: `(?i)\\b(${alternation(hierarchyFunctions)})\\s*(\\()`,
        beginCaptures: { 1: { name: hierarchyScope } },
        end: '\\)',
        // phrases first, so `NULLS LAST` and `RETAIN NULLS` stay one keyword rather than a lone hierarchy word
        patterns: [
          { include: '#parens' },
          { include: '#statements' },
          { include: '#clause-phrases' },
          { include: '#hierarchy-keywords' },
          { include: '$self' },
        ],
      },
      'hierarchy-keywords': {
        name: clauseScope,
        match: wordMatch([...words('hierarchy-clause'), ...words('hierarchy-option')]),
      },
      parens: {
        begin: '\\(',
        end: '\\)',
        patterns: [{ include: '#parens' }, { include: '$self' }],
      },
      operators: {
        "name": "keyword.operator.hanasql",
        "match": "\\|\\||:=|=>|<>|!=|<=|>=|[-+*/%=<>]"
      },
      'sqlscript-builtins': {
        patterns: [
          { name: scope('pragma'), match: `(?i)#\\[(?:${alternation(words('pragma'))})\\]` },
          { name: scope('annotation'), match: `(?i)@(?:${alternation(words('annotation'))})\\b` },
          {
            "match": "\\b([A-Za-z_][\\w]*)(:)([A-Za-z_][\\w]*)(?=\\s*\\()",
            "captures": {
              "1": {
                "name": "variable.other.library.hanasql"
              },
              "2": {
                "name": "punctuation.accessor.hanasql"
              },
              "3": {
                "name": "support.function.library-member.hanasql"
              }
            }
          },
          {
            match: `\\b([A-Za-z_][\\w]*)(:)(${alternation(libraryConstants)})\\b`,
            captures: {
              1: { name: 'variable.other.library.hanasql' },
              2: { name: 'punctuation.accessor.hanasql' },
              3: { name: 'support.constant.library-member.hanasql' },
            },
          },
          {
            name: model.categories.get('sqlscript').scope,
            match: `(?i)\\b(?:CE_[A-Z_]+|${alternation(sqlscriptCalls)})\\b(?=\\s*\\()`,
          },
          {
            "name": "support.class.library.hanasql",
            "match": "(?i)\\bSQLSCRIPT_[A-Z_]+\\b"
          },
          roleRule('system-variable'),
          roleRule('hint'),
          roleRule('sqlscript-keyword'),
        ],
      },
      statements: {
        patterns: [
          {
            name: scope('alter-system-word'),
            match: `(?i)\\bALTER\\s+SYSTEM\\b(?:\\s+(?:${alternation(words('alter-system-word'))}))*`,
          },
          {
            "name": "keyword.other.statement.hanasql",
            "match": "(?i)\\b(?:CREATE|ALTER|DROP|SET|UNSET|REFRESH|VALIDATE|RENAME|MERGE|IMPORT|EXPORT|LOCK|RELEASE|BACKUP|RECOVER|TRUNCATE)\\s+(?:(?:OR\\s+REPLACE|PUBLIC|UNIQUE|INVERTED\\s+VALUE|INVERTED\\s+HASH|HNSW|HASH|BLOCK\\s+RANGE|ADJACENCY|PREDEFINED|UNUSED)\\s+)*(?:ANALYTIC\\s+MODEL|AUDIT\\s+POLICY|CERTIFICATE|CREDENTIAL|JWT\\s+PROVIDER|LDAP\\s+PROVIDER|SAML\\s+PROVIDER|X509\\s+PROVIDER|X509|PSE|PUBLIC\\s+KEY|REMOTE\\s+SOURCE|REMOTE\\s+SUBSCRIPTION|REMOTE\\s+PUBLICATION|ROLEGROUP|USERGROUP|SCHEDULER\\s+JOB|SCHEMA\\s+SYNONYM|STATISTICS|STRUCTURED\\s+COLUMN\\s+MASK|STRUCTURED\\s+FILTER|STRUCTURED\\s+PRIVILEGE|TOKEN\\s+EXCHANGER|VECTOR\\s+INDEX|FUZZY\\s+SEARCH\\s+INDEX|ADJACENCY\\s+INDEX|BLOCK\\s+RANGE\\s+INDEX|HASH\\s+INDEX|GEOCODE\\s+INDEX|TEXT\\s+INDEX|TEXT\\s+CONFIGURATION|WORKLOAD\\s+CLASS|WORKLOAD\\s+MAPPING|TABLE\\s+GROUP|GRAPH\\s+WORKSPACE|COLLECTION(?:\\s+TABLE)?|PROJECTION\\s+VIEW|MATERIALIZED\\s+VIEW|VIRTUAL\\s+(?:TABLE|FUNCTION|PROCEDURE|PACKAGE)|SPATIAL\\s+REFERENCE\\s+SYSTEMS?|SPATIAL\\s+UNIT\\s+OF\\s+MEASURE|CLIENTSIDE\\s+ENCRYPTION\\s+(?:COLUMN\\s+KEY|KEYPAIR)|ADAPTER|AGENT(?:\\s+GROUP)?|LOGIN\\s+POLICY|LIBRARY|TRANSACTION\\s+AUTOCOMMIT\\s+DDL|DELTA(?:\\s+OF)?|DATABASE|SESSION\\s+CREDENTIAL)\\b"
          },
          {
            "name": "keyword.other.clause.hanasql",
            "match": "(?i)\\b(?:SIMILARITY\\s+FUNCTION|BUILD\\s+CONFIGURATION|SEARCH\\s+CONFIGURATION|JSON\\s+SCHEMA|VERTEX\\s+TABLE|EDGE\\s+TABLE|WITH\\s+(?:DYNAMIC|STATIC)\\s+CACHE|NO\\s+CACHE|SIBLINGS?\\s+ORDER\\s+BY|START\\s+WHERE|MULTIPARENT(?:\\s+(?:ERROR|LEAVES))?|ORPHAN\\s+(?:IGNORE|ERROR|ADOPT|ROOT)|CYCLE\\s+(?:BREAKUP|ERROR)|LOAD\\s+(?:BULK|INCREMENTAL)|RETAIN\\s+NULLS|WITH\\s+SUBTOTAL|WITH\\s+BALANCE|WITH\\s+NOT\\s+MATCHED|WITH\\s+TOTAL|SHARED\\s+(?:SNAPSHOT\\s+)?REPLICA|SNAPSHOT\\s+REPLICA|NOT\\s+SHARED|(?:PAGE|COLUMN)\\s+LOADABLE|SERIES\\s+KEY|PERIOD\\s+FOR\\s+SERIES|EQUIDISTANT(?:\\s+PIECEWISE)?|NOT\\s+EQUIDISTANT|MISSING\\s+ELEMENTS\\s+(?:NOT\\s+)?ALLOWED|SERIES\\s+REORGANIZE|CLUSTER\\s+BY|WITH\\s+SQL\\s+STATISTICS\\s+INTO|EXPORT\\s+INTO\\s+RDF\\s+FILE|IMPORT\\s+FROM\\s+RDF\\s+FILE|CANCEL\\s+ASYNC\\s+CALL|MEMBER\\s+OF)\\b"
          },
        ],
      },
    },
  });
}

/** The one scope shared by the function categories of `names` (a build error if they differ). */
function byScopeOf(model, names) {
  const scopes = new Set(
    names.map((n) => {
      const f = model.functions.find((fn) => fn.name === n);
      if (!f) throw new lib.CatalogError(`'${n}' is not a catalog function`);
      return model.categories.get(f.category).scope;
    })
  );
  if (scopes.size !== 1) throw new lib.CatalogError(`functions ${names.join(', ')} do not share one scope`);
  return [...scopes][0];
}

module.exports = { buildHanasqlGrammar, alternation, wordMatch, WORD_START };
