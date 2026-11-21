'use strict';
/**
 * Generates every TextMate grammar in syntaxes/: `source.hanasql` (word lists from the SQL catalog in
 * docs/specs/catalogs/, see scripts/lib/hanasql-grammar.js) and the SAP HANA design-time artifact grammars.
 *   node scripts/build-grammars.js           write syntaxes/*.tmLanguage.json
 *   node scripts/build-grammars.js --check   exit 1 if any grammar is stale
 *
 * Regexes are written as JS literals (re.source) to avoid double-escaping in JSON.
 * Sources: SAP HANA HDBTable Syntax Reference, SAP HANA XS JavaScript Reference.
 * hdbdd / hdbrole / xsodata follow the XS Classic documentation from general knowledge.
 */
const fs = require('fs');
const path = require('path');
const { buildHanasqlGrammar } = require('./lib/hanasql-grammar');

const OUT = path.join(__dirname, '..', 'syntaxes');
const R = (re) => re.source;
// case-insensitive: TextMate wants an inline (?i) prefix, regex flags are lost by .source
const RI = (re) => '(?i)' + re.source;
/** Repo-relative path -> grammar JSON text; written (or checked) at the end. */
const outputs = {};
const write = (file, grammar) => {
  outputs[`syntaxes/${file}.tmLanguage.json`] = JSON.stringify(grammar, null, 2) + '\n';
};

const hanasqlGrammar = buildHanasqlGrammar();
write('hanasql', hanasqlGrammar);
const alt = (words) => words.join('|');

// ---------------------------------------------------------------------------
// shared building blocks
// ---------------------------------------------------------------------------
const comments = (ns) => ({
  patterns: [
    { name: `comment.line.double-slash.${ns}`, match: R(/\/\/.*$/) },
    { name: `comment.block.${ns}`, begin: R(/\/\*/), end: R(/\*\//) },
  ],
});

const dqString = (ns) => ({
  name: `string.quoted.double.${ns}`,
  begin: '"',
  end: '"',
  patterns: [{ name: `constant.character.escape.${ns}`, match: R(/\\./) }],
});

const sqString = (ns) => ({
  name: `string.quoted.single.${ns}`,
  begin: "'",
  end: "'",
  patterns: [{ name: `constant.character.escape.${ns}`, match: R(/\\.|''/) }],
});

const number = (ns) => ({ name: `constant.numeric.${ns}`, match: R(/(?<![\w.])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/) });
const bool = (ns) => ({ name: `constant.language.boolean.${ns}`, match: R(/\b(?:true|false)\b/) });

/** values on the right-hand side of `key = value;` */
const values = (ns, extra = []) => ({
  patterns: [
    { include: '#comments' },
    { include: '#string' },
    { include: '#number' },
    { include: '#boolean' },
    ...extra,
    { name: `constant.other.enum.${ns}`, match: R(/\b[A-Za-z_][\w]*\b/) },
    { name: `punctuation.separator.comma.${ns}`, match: ',' },
    { name: `punctuation.separator.colon.${ns}`, match: ':' },
    { name: `punctuation.section.brackets.${ns}`, match: R(/[\[\]]/) },
  ],
});

/** `key = value;` where key is one of `keys` */
function assign(ns, keys, patterns, extraEnd) {
  return {
    begin: `\\b(${alt(keys)})\\b\\s*(=)`,
    beginCaptures: {
      1: { name: `support.type.property-name.${ns}` },
      2: { name: `keyword.operator.assignment.${ns}` },
    },
    end: extraEnd ? `(;)|${extraEnd}` : '(;)',
    endCaptures: { 1: { name: `punctuation.terminator.statement.${ns}` } },
    patterns: patterns || [{ include: '#values' }],
  };
}

const baseRepo = (ns, valueExtra) => ({
  comments: comments(ns),
  string: dqString(ns),
  number: number(ns),
  boolean: bool(ns),
  values: values(ns, valueExtra),
});

// SQL embedded in a string (query = "SELECT \"A\" FROM ..."; reset_by = "..."). Spec: hdb-classic-kv.md §4.
// The string ends at the first unescaped `"`, so every multi-line SQL region in here (escaped identifiers, block
// comments, HIERARCHY*( ... ) calls, parentheses) also stops in front of it instead of running past the string.
function embeddedSqlString(ns, keys) {
  return {
    begin: `\\b(${alt(keys)})\\b\\s*(=)\\s*(")`,
    beginCaptures: {
      1: { name: `support.type.property-name.${ns}` },
      2: { name: `keyword.operator.assignment.${ns}` },
      3: { name: `punctuation.definition.string.begin.${ns}` },
    },
    end: '(")',
    endCaptures: { 1: { name: `punctuation.definition.string.end.${ns}` } },
    contentName: `meta.embedded.block.sql.${ns}`,
    patterns: [{ include: '#embedded-sql' }],
  };
}

const STRING_END = '(?=")';
/** Repository entries behind `#embedded-sql` (used by embeddedSqlString). */
function embeddedSqlRepo(ns) {
  const sql = (name) => ({ include: `source.hanasql#${name}` });
  return {
    'embedded-sql': {
      patterns: [
        { include: '#embedded-sql-comments' },
        { include: '#embedded-sql-quoted-identifier' },
        { name: `constant.character.escape.${ns}`, match: R(/\\./) },
        sql('strings'),
        sql('statements'),
        sql('clause-phrases'),
        { include: '#embedded-sql-hierarchy-call' },
        sql('numbers'),
        sql('sqlscript-variables'),
        sql('functions'),
        sql('sqlscript-builtins'),
        sql('types'),
        sql('constants'),
        sql('logical-operators'),
        sql('keywords'),
        sql('operators'),
      ],
    },
    // `--` runs to the end of the line or the closing quote; `\"` inside the comment is part of it
    'embedded-sql-comments': {
      patterns: [
        { name: 'comment.line.double-dash.hanasql', match: R(/--(?:[^"\\]|\\.)*/) },
        { name: 'comment.block.hanasql', begin: R(/\/\*/), end: `\\*/|${STRING_END}` },
      ],
    },
    // \"MY_TABLE\", also across lines
    'embedded-sql-quoted-identifier': {
      name: 'variable.other.quoted-identifier.hanasql',
      begin: R(/\\"/),
      end: `\\\\"|${STRING_END}`,
    },
    'embedded-sql-hierarchy-call': {
      ...hanasqlGrammar.repository['hierarchy-call'],
      end: `\\)|${STRING_END}`,
      patterns: [
        { include: '#embedded-sql-parens' },
        { include: '#embedded-sql-comments' },
        { include: '#embedded-sql-quoted-identifier' },
        sql('statements'),
        sql('clause-phrases'),
        sql('hierarchy-keywords'),
        { include: '#embedded-sql' },
      ],
    },
    'embedded-sql-parens': {
      begin: R(/\(/),
      end: `\\)|${STRING_END}`,
      patterns: [{ include: '#embedded-sql-parens' }, { include: '#embedded-sql' }],
    },
  };
}

// ---------------------------------------------------------------------------
// .hdbtable / .hdbstructure  (falls back to SQL for HDI-style files)
// ---------------------------------------------------------------------------
{
  const ns = 'hdbtable';
  const fields = ['name', 'sqlType', 'nullable', 'unique', 'length', 'scale', 'precision', 'defaultValue', 'comment', 'order', 'indexType', 'indexColumns', 'pkcolumns'];
  write('hdbtable', {
    name: 'SAP HANA HDBTable (XS Classic)',
    scopeName: 'source.hdbtable',
    patterns: [{ include: '#comments' }, { include: '#table-key' }, { include: '#primary-key' }, { include: '#list-key' }, { include: 'source.hanasql' }],
    repository: {
      ...baseRepo(ns),
      'table-key': {
        begin: R(/\b(table)(\.)(schemaName|SchemaName|temporary|tableType|public|loggingType|tableLoggingType|description)\b\s*(=)/),
        beginCaptures: {
          1: { name: `variable.language.${ns}` },
          2: { name: `punctuation.accessor.${ns}` },
          3: { name: `support.type.property-name.${ns}` },
          4: { name: `keyword.operator.assignment.${ns}` },
        },
        end: '(;)',
        endCaptures: { 1: { name: `punctuation.terminator.statement.${ns}` } },
        patterns: [{ include: '#values' }],
      },
      'primary-key': {
        begin: R(/\b(table)(\.)(primaryKey)(\.)(pkcolumns|indexType)\b\s*(=)/),
        beginCaptures: {
          1: { name: `variable.language.${ns}` },
          2: { name: `punctuation.accessor.${ns}` },
          3: { name: `support.type.property-name.${ns}` },
          4: { name: `punctuation.accessor.${ns}` },
          5: { name: `support.type.property-name.${ns}` },
          6: { name: `keyword.operator.assignment.${ns}` },
        },
        end: '(;)',
        endCaptures: { 1: { name: `punctuation.terminator.statement.${ns}` } },
        patterns: [{ include: '#values' }],
      },
      'list-key': {
        begin: R(/\b(table)(\.)(columns|indexes|primaryKey)\b\s*(=)/),
        beginCaptures: {
          1: { name: `variable.language.${ns}` },
          2: { name: `punctuation.accessor.${ns}` },
          3: { name: `support.type.property-name.${ns}` },
          4: { name: `keyword.operator.assignment.${ns}` },
        },
        end: '(;)',
        endCaptures: { 1: { name: `punctuation.terminator.statement.${ns}` } },
        patterns: [{ include: '#struct' }, { include: '#values' }],
      },
      struct: {
        begin: R(/\{/),
        beginCaptures: { 0: { name: `punctuation.section.braces.begin.${ns}` } },
        end: R(/\}/),
        endCaptures: { 0: { name: `punctuation.section.braces.end.${ns}` } },
        patterns: [
          { include: '#comments' },
          {
            match: R(/\b(sqlType)\b\s*(=)\s*([A-Za-z_]\w*)/),
            captures: {
              1: { name: `support.type.property-name.${ns}` },
              2: { name: `keyword.operator.assignment.${ns}` },
              3: { name: `storage.type.${ns}` },
            },
          },
          { name: `support.type.property-name.${ns}`, match: `\\b(?:${alt(fields)})\\b(?=\\s*=)` },
          { name: `keyword.operator.assignment.${ns}`, match: '=' },
          { name: `punctuation.terminator.statement.${ns}`, match: ';' },
          { include: '#values' },
        ],
      },
    },
  });
  write('hdbstructure', { name: 'SAP HANA HDBStructure (XS Classic)', scopeName: 'source.hdbstructure', patterns: [{ include: 'source.hdbtable' }] });
}

// ---------------------------------------------------------------------------
// .hdbview
// ---------------------------------------------------------------------------
{
  const ns = 'hdbview';
  const keys = ['schema', 'public', 'depends_on', 'depends_on_table', 'depends_on_view'];
  write('hdbview', {
    name: 'SAP HANA HDBView (XS Classic)',
    scopeName: 'source.hdbview',
    patterns: [{ include: '#comments' }, { include: '#query' }, { include: '#assignment' }, { include: 'source.hanasql' }],
    repository: {
      ...baseRepo(ns),
      ...embeddedSqlRepo(ns),
      query: embeddedSqlString(ns, ['query']),
      // `public=false` may lack its semicolon in real files: also stop before the next `key =` line
      assignment: assign(ns, keys, null, R(/(?=^\s*[A-Za-z_]\w*\s*=)/)),
    },
  });
}

// ---------------------------------------------------------------------------
// .hdbsequence
// ---------------------------------------------------------------------------
{
  const ns = 'hdbsequence';
  const keys = ['schema', 'increment_by', 'start_with', 'maxvalue', 'nomaxvalue', 'minvalue', 'nominvalue', 'cycles', 'public', 'depends_on', 'depends_on_table', 'depends_on_view'];
  write('hdbsequence', {
    name: 'SAP HANA HDBSequence (XS Classic)',
    scopeName: 'source.hdbsequence',
    patterns: [{ include: '#comments' }, { include: '#reset-by' }, { include: '#assignment' }, { include: 'source.hanasql' }],
    repository: {
      ...baseRepo(ns),
      ...embeddedSqlRepo(ns),
      'reset-by': embeddedSqlString(ns, ['reset_by']),
      assignment: assign(ns, keys, null, R(/(?=^\s*[A-Za-z_]\w*\s*=)/)),
    },
  });
}

// ---------------------------------------------------------------------------
// .hdbschema
// ---------------------------------------------------------------------------
write('hdbschema', {
  name: 'SAP HANA HDBSchema (XS Classic)',
  scopeName: 'source.hdbschema',
  patterns: [{ include: '#comments' }, { include: '#assignment' }],
  repository: { ...baseRepo('hdbschema'), assignment: assign('hdbschema', ['schema_name']) },
});

// ---------------------------------------------------------------------------
// .hdbti  (table import)
// ---------------------------------------------------------------------------
{
  const ns = 'hdbti';
  const keys = ['table', 'cdstable', 'hdbtable', 'schema', 'file', 'header', 'useHeaderNames', 'delimField', 'delimEnclosing', 'distinguishEmptyFromNull', 'keys'];
  write('hdbti', {
    name: 'SAP HANA Table Import (XS Classic)',
    scopeName: 'source.hdbti',
    patterns: [{ include: '#comments' }, { include: '#import' }],
    repository: {
      ...baseRepo(ns),
      import: {
        begin: R(/\b(import)\b\s*(=)/),
        beginCaptures: { 1: { name: `keyword.control.import.${ns}` }, 2: { name: `keyword.operator.assignment.${ns}` } },
        end: '(;)',
        endCaptures: { 1: { name: `punctuation.terminator.statement.${ns}` } },
        patterns: [{ include: '#comments' }, { include: '#struct' }, { name: `punctuation.section.brackets.${ns}`, match: R(/[\[\],]/) }],
      },
      struct: {
        begin: R(/\{/),
        beginCaptures: { 0: { name: `punctuation.section.braces.begin.${ns}` } },
        end: R(/\}/),
        endCaptures: { 0: { name: `punctuation.section.braces.end.${ns}` } },
        patterns: [{ include: '#comments' }, assign(ns, keys)],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// .xshttpdest
// ---------------------------------------------------------------------------
write('xshttpdest', {
  name: 'SAP HANA XS HTTP Destination',
  scopeName: 'source.xshttpdest',
  patterns: [{ include: '#comments' }, { include: '#assignment' }],
  repository: {
    ...baseRepo('xshttpdest'),
    assignment: assign('xshttpdest', ['host', 'port', 'description', 'useSSL', 'pathPrefix', 'authType', 'useProxy', 'proxyHost', 'proxyPort', 'proxyType', 'timeout', 'sslAuth', 'sslHostCheck']),
  },
});

// ---------------------------------------------------------------------------
// JSON-like XS artifacts (tolerant: real files are often not strict JSON)
// ---------------------------------------------------------------------------
function jsonPatterns(ns, keys, extraRules = []) {
  const patterns = [{ include: '#comments' }, ...extraRules];
  if (keys.length) {
    patterns.push({ name: `support.type.property-name.json.${ns}`, match: `"(?:${alt(keys)})"(?=\\s*:)` });
  }
  patterns.push(
    { name: `support.type.property-name.json`, match: R(/"(?:[^"\\]|\\.)*"(?=\s*:)/) },
    { include: '#string' },
    { include: '#number' },
    { name: `constant.language.json.${ns}`, match: R(/\b(?:true|false|null)\b/) },
    { name: `punctuation.separator.key-value.${ns}`, match: ':' },
    { name: `punctuation.separator.comma.${ns}`, match: ',' },
    { name: `punctuation.section.braces.${ns}`, match: R(/[{}]/) },
    { name: `punctuation.section.brackets.${ns}`, match: R(/[\[\]]/) }
  );
  return patterns;
}

function jsonGrammar(file, title, keys, extra = {}) {
  write(file, {
    name: title,
    scopeName: `source.${file}`,
    patterns: jsonPatterns(file, keys, extra.rules),
    repository: { comments: comments(file), string: dqString(file), number: number(file), ...(extra.repository || {}) },
  });
}

jsonGrammar('xsaccess', 'SAP HANA XS Access (.xsaccess)', [
  'exposed', 'authentication', 'method', 'authorization', 'anonymous_connection', 'default_connection', 'cache_control',
  'cors', 'enabled', 'allowMethods', 'allowOrigin', 'allowHeaders', 'exposeHeaders', 'maxAge', 'default_file',
  'enable_etags', 'force_ssl', 'mime_mapping', 'extension', 'mimetype', 'prevent_xsrf', 'rewrite_rules', 'source',
  'target', 'headers', 'customHeaders', 'name', 'value',
]);
jsonGrammar('xsapp', 'SAP HANA XS Application Descriptor (.xsapp)', []);
jsonGrammar('xssecurestore', 'SAP HANA XS Secure Store (.xssecurestore)', []);
jsonGrammar('xsprivileges', 'SAP HANA XS Privileges (.xsprivileges)', ['privileges', 'name', 'description']);
jsonGrammar('xssqlcc', 'SAP HANA XS SQL Connection (.xssqlcc)', ['description', 'role_for_auto_user']);
jsonGrammar('hdbsynonym', 'SAP HANA Synonym (.hdbsynonym)', ['target', 'schema', 'object', 'package', 'revalidate', 'logical_schema', 'remote', 'database'], {
  rules: [{ name: `entity.name.type.hdbsynonym`, match: R(/"[^"\\\n]*::[^"\\\n]*"(?=\s*:)/) }],
});
jsonGrammar('xsjob', 'SAP HANA XS Job (.xsjob)', ['description', 'action', 'schedules', 'xscron', 'parameter', 'signature_version'], {
  rules: [
    {
      // "xscron": "<year> <month> <day> <weekday> <hour> <minute> <second>"
      begin: R(/("xscron")(\s*:\s*)(")/),
      beginCaptures: {
        1: { name: 'support.type.property-name.json.xsjob' },
        2: { name: 'punctuation.separator.key-value.xsjob' },
        3: { name: 'punctuation.definition.string.begin.xsjob' },
      },
      end: R(/"/),
      endCaptures: { 0: { name: 'punctuation.definition.string.end.xsjob' } },
      contentName: 'string.quoted.double.xscron.xsjob',
      patterns: [
        { name: 'keyword.operator.wildcard.xsjob', match: R(/\*(?:\/\d+)?/) },
        { name: 'constant.language.weekday.xsjob', match: R(/(?:-?\d\.)?\b(?:mon|tue|wed|thu|fri|sat|sun)\b/) },
        { name: 'constant.numeric.xsjob', match: R(/-?\d+(?::-?\d+)?(?:\/\d+)?/) },
        { name: 'punctuation.separator.comma.xsjob', match: ',' },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// .hdbdd  (CDS, XS Classic)
// ---------------------------------------------------------------------------
{
  const ns = 'hdbdd';
  const cdsTypes = ['String', 'LargeString', 'Binary', 'LargeBinary', 'Integer', 'Integer32', 'Integer64', 'Decimal', 'DecimalFloat', 'BinaryFloat', 'Double', 'LocalDate', 'Date', 'LocalTime', 'Time', 'UTCDateTime', 'DateTime', 'UTCTimestamp', 'Timestamp', 'Boolean', 'UUID'];
  write('hdbdd', {
    name: 'SAP HANA CDS (.hdbdd, XS Classic)',
    scopeName: 'source.hdbdd',
    patterns: [
      { include: '#comments' },
      { include: '#annotation' },
      { include: '#namespace' },
      { include: '#using' },
      { include: '#definition' },
      { include: '#technical-configuration' },
      { include: '#generated' },
      { include: '#association' },
      { include: '#string' },
      { include: '#delimited-identifier' },
      { include: '#number' },
      { include: '#enum-symbol' },
      { include: '#session-variable' },
      { include: '#types' },
      { include: '#constants' },
      { include: '#keywords' },
      { include: 'source.hanasql#functions' },
      { include: '#operators' },
    ],
    repository: {
      comments: comments(ns),
      string: sqString(ns),
      number: number(ns),
      'delimited-identifier': { name: `variable.other.quoted-identifier.${ns}`, match: R(/!\[[^\]]*\]|"(?:[^"]|"")*"/) },
      annotation: {
        match: R(/(@)([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)/),
        captures: { 1: { name: `punctuation.definition.annotation.${ns}` }, 2: { name: `storage.type.annotation.${ns}` } },
      },
      'enum-symbol': { name: `constant.other.enum-symbol.${ns}`, match: R(/#[A-Za-z_]\w*/) },
      'session-variable': { name: `variable.language.cds.${ns}`, match: R(/\$(?:parameters|projection|user|env)\b/) },
      namespace: {
        match: R(/\b(namespace)\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)/),
        captures: { 1: { name: `keyword.other.namespace.${ns}` }, 2: { name: `entity.name.namespace.${ns}` } },
      },
      using: {
        match: R(/\b(using)(?!\s+(?:default|extended)\s+storage\b)\s+([\w.:*]+)(?:\s+(as)\s+([A-Za-z_]\w*))?/),
        captures: {
          1: { name: `keyword.control.import.${ns}` },
          2: { name: `entity.name.namespace.${ns}` },
          3: { name: `keyword.control.import.${ns}` },
          4: { name: `entity.name.type.alias.${ns}` },
        },
      },
      definition: {
        match: RI(/\b(?:(define|abstract|temporary)\s+)*(context|entity|table\s+type|type|view|aspect|annotation|enum|service)\s+([A-Za-z_]\w*)/),
        captures: {
          1: { name: `storage.modifier.${ns}` },
          2: { name: `storage.type.class.${ns}` },
          3: { name: `entity.name.type.${ns}` },
        },
      },
      'technical-configuration': {
        name: `keyword.other.technical-configuration.${ns}`,
        match: RI(/\b(?:technical\s+configuration|column\s+store|row\s+store|migration\s+disabled|using\s+(?:default|extended)\s+storage|partition\s+by\s+(?:hash|range|roundrobin)|partitions|fuzzy\s+search\s+index|fulltext\s+index|language\s+column|language\s+detection|mime\s+type(?:\s+column)?|phrase\s+index\s+ratio|search\s+only|fast\s+preprocess|text\s+mining(?:\s+configuration(?:\s+overlay)?)?|text\s+analysis|token\s+separators|async|flush(?:\s+queue)?|sync|group\s+type|group\s+subtype|group\s+name|group\s+set|no\s+group|unload\s+priority|(?:no\s+)?auto\s+merge|inverted\s+(?:hash|value)\s+index|unique\s+index|index|unique|get_num_servers)\b/),
      },
      generated: {
        name: `keyword.other.generated.${ns}`,
        match: RI(/\bgenerated\s+(?:always|by\s+default)\s+as(?:\s+identity)?\b|\bwith\s+structured\s+privilege\s+check\b|\btype\s+of\b|\bseries\s+key\b|\bperiod\s+for\s+series\b|\b(?:not\s+)?equidistant(?:\s+piecewise)?\b|\bmissing\s+elements\s+(?:not\s+)?allowed\b|\bincrement\s+by\b|\bstart\s+with\b|\b(?:no\s+)?(?:cycle|maxvalue|minvalue)\b|\breset\s+by\b|\bseries\b|\binterval\b/),
      },
      association: {
        match: RI(/\b(association|composition)\b(\s*\[[^\]]*\])?(?:\s+(to)\s+([\w.:]+))?/),
        captures: {
          1: { name: `keyword.other.association.${ns}` },
          2: { name: `constant.other.cardinality.${ns}` },
          3: { name: `keyword.other.association.${ns}` },
          4: { name: `entity.name.type.${ns}` },
        },
      },
      types: {
        patterns: [
          { name: `storage.type.${ns}`, match: R(/\bhana\.[A-Za-z_][\w]*/) },
          { name: `storage.type.${ns}`, match: `\\b(?:${alt(cdsTypes)})\\b` },
        ],
      },
      constants: { name: `constant.language.${ns}`, match: RI(/\b(?:true|false|null)\b/) },
      keywords: {
        patterns: [
          {
            name: `keyword.control.${ns}`,
            match: RI(/\b(?:select|from|where|group\s+by|having|order\s+by|union(?:\s+all)?|distinct|top|as|on|via\s+entity|mixin|into|limit|offset|with\s+parameters|excluding|extend|projection|cast|case|when|then|else|end|and|or|not|like|escape|in|is|between|exists|any|some|asc|desc|nulls|first|last|inner|left|right|full|outer|cross|join|many|one|of|to|using|new)\b/),
          },
          { name: `storage.modifier.${ns}`, match: RI(/\b(?:key|virtual|const|element|default|not\s+null|null)\b/) },
        ],
      },
      operators: { name: `keyword.operator.${ns}`, match: R(/::|\.\.|:|\|\||<>|!=|<=|>=|[-+*\/%=<>]/) },
    },
  });
}

// ---------------------------------------------------------------------------
// .hdbrole  (XS Classic role syntax; HDI roles are JSON -> falls back to JSON)
// ---------------------------------------------------------------------------
{
  const ns = 'hdbrole';
  write('hdbrole', {
    name: 'SAP HANA Role (.hdbrole)',
    scopeName: 'source.hdbrole',
    patterns: [{ include: '#comments' }, { include: '#role' }, { include: '#extends' }, { include: '#privilege' }, { include: '#hdi-json' }],
    repository: {
      comments: comments(ns),
      string: dqString(ns),
      number: number(ns),
      // HDI roles are JSON
      'hdi-json': { patterns: jsonPatterns(ns, ['role', 'name', 'privileges', 'privileges_with_grant_option', 'schema_reference', 'type', 'names', 'object_privileges', 'pattern_mode', 'schema', 'pattern_escape_character', 'global_roles', 'schema_roles', 'system_privileges', 'schema_privileges', 'reference', 'global_object_privileges', 'schema_analytic_privileges', 'logical_schema']) },
      role: {
        match: R(/^\s*(role)\s+([\w.:]+)/),
        captures: { 1: { name: `storage.type.role.${ns}` }, 2: { name: `entity.name.type.role.${ns}` } },
      },
      extends: {
        match: R(/\b(extends)\s+(catalog\s+role|role)\b/),
        captures: { 1: { name: `keyword.other.extends.${ns}` }, 2: { name: `keyword.other.${ns}` } },
      },
      privilege: {
        begin: R(/^\s*((?:catalog\s+)?(?:schema|sql\s+object|analytic\s+privilege|package)|application\s+privilege|system\s+privilege|analytic\s+privilege)\b/),
        beginCaptures: { 1: { name: `keyword.control.privilege.${ns}` } },
        end: R(/(;)/),
        endCaptures: { 1: { name: `punctuation.terminator.statement.${ns}` } },
        patterns: [
          { include: '#comments' },
          { name: `variable.other.quoted-identifier.${ns}`, match: R(/"(?:[^"]|"")*"/) },
          { name: `entity.name.type.${ns}`, match: R(/[A-Za-z_][\w.]*::[\w.]+/) },
          { name: `punctuation.separator.colon.${ns}`, match: ':' },
          { name: `punctuation.separator.comma.${ns}`, match: ',' },
          { name: `keyword.other.grant-option.${ns}`, match: RI(/\bWITH\s+GRANT\s+OPTION\b/) },
          { name: `constant.other.privilege.${ns}`, match: R(/\b[A-Z][A-Z_]*(?:\.[A-Z_]+)*\b/) },
          { name: `entity.name.package.${ns}`, match: R(/[A-Za-z_][\w.]*/) },
        ],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// .xsodata
// ---------------------------------------------------------------------------
{
  const ns = 'xsodata';
  const words = [
    'service', 'namespace', 'as', 'keys', 'key', 'generate', 'local', 'navigates', 'from', 'create', 'update', 'delete', 'read', 'link',
    'events', 'before', 'after', 'precommit', 'postcommit', 'for', 'using', 'with', 'without', 'forbidden', 'parameters', 'via', 'entity',
    'results', 'property', 'aggregates', 'always', 'of', 'association', 'principal', 'dependent', 'multiplicity', 'over', 'referential',
    'constraint', 'storage', 'no', 'annotations', 'enable', 'disable', 'settings', 'support', 'null', 'limits', 'max_records',
    'max_expanded_records', 'omitting', 'omit', 'hints', 'etag', 'concurrencytoken', 'metadata', 'content', 'cache-control', 'use', 'and',
    'join', 'on', 'default',
  ];
  write('xsodata', {
    name: 'SAP HANA OData Service (.xsodata)',
    scopeName: 'source.xsodata',
    patterns: [
      { include: '#comments' },
      { include: '#string' },
      { include: '#number' },
      { include: '#service' },
      { include: '#keywords' },
      { include: '#punctuation' },
    ],
    repository: {
      comments: comments(ns),
      string: {
        patterns: [
          { name: `constant.other.multiplicity.${ns}`, match: R(/"(?:1|0\.\.1|1\.\.\*|\*)"/) },
          { ...dqString(ns), name: `variable.other.quoted-identifier.${ns}` },
          sqString(ns),
        ],
      },
      number: number(ns),
      service: {
        match: R(/\b(service)\s+(namespace)\b/),
        captures: { 1: { name: `storage.type.service.${ns}` }, 2: { name: `keyword.other.${ns}` } },
      },
      keywords: {
        patterns: [
          { name: `constant.language.${ns}`, match: R(/\b(?:true|false|null)\b/) },
          { name: `support.function.aggregate.${ns}`, match: RI(/\b(?:SUM|AVG|MIN|MAX)\b(?=\s+of\b)/) },
          { name: `keyword.control.${ns}`, match: `(?i)\\b(?:${alt(words)})\\b` },
          { name: `support.constant.odata4sap.${ns}`, match: RI(/\bOData4SAP\b/) },
        ],
      },
      punctuation: {
        patterns: [
          { name: `punctuation.terminator.statement.${ns}`, match: ';' },
          { name: `punctuation.separator.comma.${ns}`, match: ',' },
          { name: `punctuation.separator.colon.${ns}`, match: ':' },
          { name: `punctuation.section.braces.${ns}`, match: R(/[{}]/) },
          { name: `punctuation.section.parens.${ns}`, match: R(/[()]/) },
          { name: `punctuation.accessor.${ns}`, match: R(/\./) },
          { name: `keyword.operator.assignment.${ns}`, match: '=' },
        ],
      },
    },
  });
}


// ---------------------------------------------------------------------------
// .xsxmla  (XS Classic XMLA service definition)
// ---------------------------------------------------------------------------
{
  const ns = 'xsxmla';
  const words = [
    'namespace', 'as', 'analytic', 'calculation', 'cube', 'dimension', 'measure',
    'metadata', 'with', 'without', 'enable', 'disable', 'default', 'null',
  ];
  write('xsxmla', {
    name: 'SAP HANA XMLA Service (.xsxmla)',
    scopeName: 'source.xsxmla',
    patterns: [
      { include: '#comments' },
      { include: '#string' },
      { include: '#number' },
      { include: '#service' },
      { include: '#keywords' },
      { include: '#assignment' },
      { include: '#punctuation' },
    ],
    repository: {
      comments: comments(ns),
      string: {
        patterns: [
          { name: `entity.name.type.object.${ns}`, match: R(/"[^"\n]*::[^"\n]*"/) },
          dqString(ns),
          sqString(ns),
        ],
      },
      number: number(ns),
      service: {
        patterns: [
          {
            match: RI(/\b(service)\s+(namespace)\b/),
            captures: { 1: { name: `storage.type.service.${ns}` }, 2: { name: `keyword.other.${ns}` } },
          },
          { name: `storage.type.service.${ns}`, match: RI(/\bservice\b/) },
        ],
      },
      keywords: {
        patterns: [
          { name: `constant.language.${ns}`, match: R(/\b(?:true|false|null)\b/) },
          { name: `keyword.control.${ns}`, match: `(?i)\\b(?:${alt(words)})\\b` },
        ],
      },
      assignment: {
        match: R(/\b([A-Za-z_]\w*)\b(?=\s*=)/),
        name: `support.type.property-name.${ns}`,
      },
      punctuation: {
        patterns: [
          { name: `punctuation.terminator.statement.${ns}`, match: ';' },
          { name: `punctuation.separator.comma.${ns}`, match: ',' },
          { name: `punctuation.separator.colon.${ns}`, match: ':' },
          { name: `punctuation.section.braces.${ns}`, match: R(/[{}]/) },
          { name: `punctuation.section.parens.${ns}`, match: R(/[()]/) },
          { name: `punctuation.accessor.${ns}`, match: R(/\./) },
          { name: `keyword.operator.assignment.${ns}`, match: '=' },
        ],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// .hdbtid / .hdbtim  (deprecated XS Classic table import data / schema)
// ---------------------------------------------------------------------------
function kvGenericGrammar(file, title, keys) {
  const ns = file;
  write(file, {
    name: title,
    scopeName: `source.${file}`,
    patterns: [
      { include: '#comments' },
      { include: '#assignment' },
      { include: '#generic-key' },
      { include: '#struct' },
      { include: '#values' },
      { name: `punctuation.terminator.statement.${ns}`, match: ';' },
    ],
    repository: {
      ...baseRepo(ns),
      assignment: assign(ns, keys, [{ include: '#comments' }, { include: '#struct' }, { include: '#values' }]),
      'generic-key': {
        match: R(/\b([A-Za-z_]\w*)\b\s*(=)/),
        captures: { 1: { name: `support.type.property-name.${ns}` }, 2: { name: `keyword.operator.assignment.${ns}` } },
      },
      struct: {
        begin: R(/\{/),
        beginCaptures: { 0: { name: `punctuation.section.braces.begin.${ns}` } },
        end: R(/\}/),
        endCaptures: { 0: { name: `punctuation.section.braces.end.${ns}` } },
        patterns: [{ include: '#comments' }, { include: '#assignment' }, { include: '#generic-key' }, { include: '#values' }, { name: `punctuation.terminator.statement.${ns}`, match: ';' }],
      },
    },
  });
}

kvGenericGrammar('hdbtid', 'SAP HANA Table Import Data (.hdbtid, XS Classic)', [
  'import', 'table', 'cdstable', 'hdbtable', 'schema', 'file', 'columns', 'keys', 'header', 'useHeaderNames', 'delimField', 'delimEnclosing', 'distinguishEmptyFromNull',
]);
kvGenericGrammar('hdbtim', 'SAP HANA Table Import Schema (.hdbtim, XS Classic)', [
  'import', 'table', 'cdstable', 'hdbtable', 'schema', 'file', 'columns', 'keys',
]);


// ---------------------------------------------------------------------------
// HDI (XS Advanced / HANA 2 containers) JSON artifacts
// ---------------------------------------------------------------------------
const ROLE_KEYS = ['role', 'name', 'privileges', 'privileges_with_grant_option', 'schema_reference', 'type', 'names', 'object_privileges', 'pattern_mode', 'schema', 'pattern_escape_character', 'global_roles', 'schema_roles', 'system_privileges', 'schema_privileges', 'reference', 'global_object_privileges', 'schema_analytic_privileges', 'logical_schema'];
const GRANT_KEYS = ['object_owner', 'application_user', 'object_privileges', 'schema_privileges', 'system_privileges', 'global_roles', 'schema_roles', 'schema', 'name', 'privileges', 'privileges_with_grant_option', 'global_object_privileges', 'schema_analytic_privileges'];
const TARGET_KEYS = ['target', 'schema', 'object', 'package', 'remote', 'database', 'revalidate', 'logical_schema'];

jsonGrammar('hdbgrants', 'SAP HANA HDI Grants (.hdbgrants)', GRANT_KEYS);
jsonGrammar('hdbrevokes', 'SAP HANA HDI Revokes (.hdbrevokes)', GRANT_KEYS);
jsonGrammar('hdbroleconfig', 'SAP HANA HDI Role Configuration (.hdbroleconfig)', ROLE_KEYS);
jsonGrammar('hdbsynonymconfig', 'SAP HANA HDI Synonym Configuration (.hdbsynonymconfig)', TARGET_KEYS);
jsonGrammar('hdbpublicsynonym', 'SAP HANA HDI Public Synonym (.hdbpublicsynonym)', TARGET_KEYS);
jsonGrammar('hdbvirtualtableconfig', 'SAP HANA HDI Virtual Table Configuration (.hdbvirtualtableconfig)', TARGET_KEYS);
jsonGrammar('hdblogicalschemaconfig', 'SAP HANA HDI Logical Schema Configuration (.hdblogicalschemaconfig)', TARGET_KEYS);
jsonGrammar('hdbprojectionviewconfig', 'SAP HANA HDI Projection View Configuration (.hdbprojectionviewconfig)', TARGET_KEYS);
jsonGrammar('hdbtabledata', 'SAP HANA HDI Table Data (.hdbtabledata)', [
  'format_version', 'imports', 'target_table', 'source_data', 'data_type', 'file_name', 'has_header', 'delimiter', 'dialect',
  'no_data_import', 'import_settings', 'import_columns', 'include_filter', 'exclude_filter', 'column_mappings', 'type_config',
  'multi_key_separator', 'delete_existing_foreign_data', 'is_collection_table', 'column_name', 'name', 'type', 'parameters',
  'value', 'plugin_name', 'increment_by', 'start_with',
]);
jsonGrammar('hdbeshconfig', 'SAP HANA HDI Enterprise Search Configuration (.hdbeshconfig)', ['Fullname', 'EntityType', 'Properties', 'Name', 'position'], {
  rules: [{ name: 'entity.name.tag.annotation.hdbeshconfig', match: R(/"@[A-Za-z][\w.]*"(?=\s*:)/) }],
});
jsonGrammar('hdiconfig', 'SAP HANA HDI Container Configuration (.hdiconfig)', ['plugin_name', 'plugin_version', 'minimum_feature_version', 'file_suffixes'], {
  rules: [{ name: 'entity.name.type.hdiconfig', match: R(/"(?:hdb[a-z]+|properties|tags|csv|txt|jar)"(?=\s*:)/) }],
});
jsonGrammar('hdinamespace', 'SAP HANA HDI Namespace Rules (.hdinamespace)', ['name', 'subfolder']);
jsonGrammar('xsoauthappconfig', 'SAP HANA XS OAuth Application Configuration', ['clientConfig', 'mandatoryScopes', 'optionalScopes', 'description']);
jsonGrammar('xsoauthclientconfig', 'SAP HANA XS OAuth Client Configuration', ['clientFlavor', 'clientID', 'clientAuthType', 'authorizationEndpointURL', 'tokenEndpointURL', 'revocationEndpointURL', 'redirectURL', 'description']);
jsonGrammar('xsoauthclientflavor', 'SAP HANA XS OAuth Client Flavor', ['description', 'flavorStep', 'paramLocation', 'paramName', 'paramValue', 'valueType', 'paramMandatory', 'modifies', 'parameters']);
jsonGrammar('xsappsite', 'SAP HANA XS Application Site (.xsappsite)', ['id', 'title', 'description', 'theme', 'catalogs', 'groups', 'tiles', 'personalization']);
jsonGrammar('hdbfabricvirtualtableconfig', 'SAP HANA HDI Fabric Virtual Table Configuration (.hdbfabricvirtualtableconfig)', TARGET_KEYS);
jsonGrammar('hdbvirtualpackage', 'SAP HANA HDI Virtual Package (.hdbvirtualpackage, .hdbvirtualpackagehadoop, .hdbvirtualpackagesparksql)', [
  'plugin_name', 'plugin_version', 'adapter_type', 'location', 'remote_source', 'schema', 'package', 'name', 'file', 'jar', 'class_name',
]);

// ---------------------------------------------------------------------------
// .hdbmigrationtable  (SQL DDL plus "== version = N" / "== migration = N" markers)
// ---------------------------------------------------------------------------
write('hdbmigrationtable', {
  name: 'SAP HANA HDI Migration Table (.hdbmigrationtable)',
  scopeName: 'source.hdbmigrationtable',
  patterns: [{ include: '#marker' }, { include: 'source.hanasql' }],
  repository: {
    marker: {
      match: R(/^\s*(==)\s*(version|dev-version|migration)\s*(=)\s*(\d+)/),
      captures: {
        1: { name: 'punctuation.definition.marker.hdbmigrationtable' },
        2: { name: 'keyword.control.migration.hdbmigrationtable' },
        3: { name: 'keyword.operator.assignment.hdbmigrationtable' },
        4: { name: 'constant.numeric.hdbmigrationtable' },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// .hdbcds  (CDS for XS Advanced / HDI): the .hdbdd grammar plus the XSA-only constructs
// ---------------------------------------------------------------------------
write('hdbcds', {
  name: 'SAP HANA CDS (.hdbcds, XS Advanced)',
  scopeName: 'source.hdbcds',
  patterns: [{ include: '#xsa' }, { include: 'source.hdbdd' }],
  repository: {
    xsa: {
      patterns: [
        { name: 'variable.language.session.hdbcds', match: R(/\$(?:user|env)\b/) },
        {
          match: RI(/\b(accesspolicy|role|aspect)\s+([A-Za-z_][\w.]*)/),
          captures: { 1: { name: 'storage.type.class.hdbcds' }, 2: { name: 'entity.name.type.hdbcds' } },
        },
        {
          match: RI(/\b(package)\s+([\w.:]+)(?:\s+(depends)\s+(on)\s+([\w.:]+(?:\s*,\s*[\w.:]+)*))?/),
          captures: {
            1: { name: 'keyword.other.package.hdbcds' },
            2: { name: 'entity.name.namespace.hdbcds' },
            3: { name: 'keyword.other.package.hdbcds' },
            4: { name: 'keyword.other.package.hdbcds' },
            5: { name: 'entity.name.namespace.hdbcds' },
          },
        },
        { name: 'keyword.control.hdbcds', match: RI(/\b(?:extend|grant|in\s+package|with\s+structured\s+privilege\s+check|from)\b/) },
      ],
    },
  },
});

// ---------------------------------------------------------------------------
// .xsjs / .xsjslib : JavaScript plus the XS JavaScript API ($.request, $.db, $.net, ...)
// ---------------------------------------------------------------------------
{
  const ns = 'xsjs';
  const apis = ['application', 'request', 'response', 'db', 'hdb', 'net', 'util', 'web', 'session', 'security', 'jobs', 'trace', 'text', 'repo', 'config', 'process'];
  write('xsjs', {
    name: 'SAP HANA XS JavaScript (.xsjs, .xsjslib)',
    scopeName: 'source.xsjs',
    patterns: [{ include: '#xs-api' }, { include: 'source.js' }],
    repository: {
      'xs-api': {
        patterns: [
          {
            // $.import("package.path", "library")  /  $.require("module")
            match: R(/(?<![A-Za-z0-9_$])(\$)(\.)(import|require)\b/),
            captures: {
              1: { name: `variable.language.${ns}` },
              2: { name: `punctuation.accessor.${ns}` },
              3: { name: `support.function.import.${ns}` },
            },
          },
          {
            // $.<api>[.sub...][.member] — matched both at top level and injected inside nested JS scopes
            begin: `(?<![A-Za-z0-9_$])(\\$)(\\.)(${alt(apis)})\\b`,
            beginCaptures: {
              1: { name: `variable.language.${ns}` },
              2: { name: `punctuation.accessor.${ns}` },
              3: { name: `support.class.api.${ns}` },
            },
            end: `(?!\\s*\\.[A-Za-z_])`,
            patterns: [
              {
                // constants such as $.net.http.OK, $.net.Mail.Part.TYPE_TEXT, $.hdb.types.NVARCHAR
                match: `(\\.)([A-Z][A-Z0-9_]+)\\b(?!\\s*\\()`,
                captures: {
                  1: { name: `punctuation.accessor.${ns}` },
                  2: { name: `support.constant.${ns}` },
                },
              },
              {
                // PascalCase classes/constructors such as $.net.Mail.Part, $.util.Zip
                match: `(\\.)([A-Z][A-Za-z0-9_]*)\\b`,
                captures: {
                  1: { name: `punctuation.accessor.${ns}` },
                  2: { name: `support.class.${ns}` },
                },
              },
              {
                // method calls such as $.response.setBody(...), $.hdb.getConnection()
                match: `(\\.)([A-Za-z_]\\w*)(?=\\s*\\()`,
                captures: {
                  1: { name: `punctuation.accessor.${ns}` },
                  2: { name: `support.function.${ns}` },
                },
              },
              {
                // properties and sub-namespaces such as $.response.status, $.response.contentType, $.net.http
                match: `(\\.)([A-Za-z_]\\w*)\\b`,
                captures: {
                  1: { name: `punctuation.accessor.${ns}` },
                  2: { name: `support.variable.property.${ns}` },
                },
              },
            ],
          },
        ],
      },
    },
  });
  write('xsjs-injection', {
    name: 'SAP HANA XS JavaScript API Injection',
    scopeName: 'xsjs.injection',
    injectionSelector: 'L:source.xsjs -comment -string -regexp',
    patterns: [{ include: 'source.xsjs#xs-api' }],
  });
}


// ---------------------------------------------------------------------------
// More HDI JSON artifacts (HDI Reference)
// ---------------------------------------------------------------------------
jsonGrammar('hdblogicalschema', 'SAP HANA HDI Logical Schema (.hdblogicalschema)', TARGET_KEYS);
jsonGrammar('hdbsysbicsynonym', 'SAP HANA HDI _SYS_BIC Synonym (.hdbsysbicsynonym)', ['target', 'object']);
jsonGrammar('hdbvirtualprocedureconfig', 'SAP HANA HDI Virtual Procedure Configuration (.hdbvirtualprocedureconfig)', TARGET_KEYS);
jsonGrammar('hdbvirtualfunctionconfig', 'SAP HANA HDI Virtual Function Configuration (.hdbvirtualfunctionconfig)', TARGET_KEYS);
jsonGrammar('hdbafllangprocedure', 'SAP HANA HDI AFL Language Procedure (.hdbafllangprocedure)', ['procedure', 'area', 'function', 'parameters', 'type', 'direction']);

// ---------------------------------------------------------------------------
// Text analysis extraction rules (CGUL): .hdbtextrule / .hdbtextinclude / .hdbtextlexicon
// ---------------------------------------------------------------------------
{
  const ns = 'hdbtextrule';
  const posTags = [
    'NN', 'NNS', 'NNP', 'NNPS', 'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ', 'JJ', 'JJR', 'JJS', 'RB', 'RBR', 'RBS',
    'IN', 'DT', 'CC', 'CD', 'PRP', 'PRP\\$', 'WP', 'WP\\$', 'WDT', 'WRB', 'MD', 'TO', 'RP', 'UH', 'FW', 'SYM',
    'POS', 'EX', 'LS', 'PDT', 'Noun', 'ProperNoun', 'Verb', 'Adjective', 'Adverb', 'Preposition', 'Conjunction',
    'Determiner', 'Pronoun', 'Numeral', 'Interjection', 'Punctuation', 'Particle',
  ];
  write('hdbtextrule', {
    name: 'SAP HANA Text Analysis Rules (CGUL)',
    scopeName: 'source.hdbtextrule',
    patterns: [
      { include: '#comments' },
      { include: '#import' },
      { include: '#definition' },
      { include: '#string' },
      { include: '#slot-label' },
      { include: '#character-class' },
      { include: '#token' },
      { include: '#group-reference' },
      { include: '#slot-variable' },
      { include: '#attribute' },
      { include: '#number' },
      { include: '#operators' },
    ],
    repository: {
      comments: {
        patterns: [
          { name: `comment.line.double-slash.${ns}`, match: R(/\/\/.*$/) },
          { name: `comment.line.double-dash.${ns}`, match: R(/--.*$/) },
          { name: `comment.block.${ns}`, begin: R(/\/\*/), end: R(/\*\//) },
        ],
      },
      string: { patterns: [dqString(ns), sqString(ns)] },
      number: number(ns),
      import: {
        patterns: [
          {
            match: R(/^\s*(#(?:include|lexicon))\s+(?:([A-Za-z_]\w*)\s+)?(<)([^>\n]*)(>)/),
            captures: {
              1: { name: `keyword.control.import.${ns}` },
              2: { name: `entity.name.type.${ns}` },
              3: { name: `punctuation.definition.string.begin.${ns}` },
              4: { name: `string.unquoted.path.${ns}` },
              5: { name: `punctuation.definition.string.end.${ns}` },
            },
          },
          {
            match: R(/^\s*(#(?:include|lexicon))\s+(?:([A-Za-z_]\w*)\s+)?(")([^"\n]*)(")/),
            captures: {
              1: { name: `keyword.control.import.${ns}` },
              2: { name: `entity.name.type.${ns}` },
              3: { name: `punctuation.definition.string.begin.${ns}` },
              4: { name: `string.quoted.double.path.${ns}` },
              5: { name: `punctuation.definition.string.end.${ns}` },
            },
          },
        ],
      },
      definition: {
        match: R(/^\s*(#(?:define|subgroup|group|index|feature|category|priority|language|encoding|version))\b(?:\s+([A-Za-z_][\w]*))?/),
        captures: { 1: { name: `keyword.control.directive.${ns}` }, 2: { name: `entity.name.type.${ns}` } },
      },
      'slot-label': {
        match: R(/(\[)([A-Za-z_]\w*)(\])(:)/),
        captures: {
          1: { name: `punctuation.section.brackets.begin.${ns}` },
          2: { name: `entity.name.tag.label.${ns}` },
          3: { name: `punctuation.section.brackets.end.${ns}` },
          4: { name: `punctuation.separator.colon.${ns}` },
        },
      },
      'character-class': {
        begin: R(/\[\^?/),
        beginCaptures: { 0: { name: `punctuation.definition.character-class.begin.${ns}` } },
        end: R(/\]/),
        endCaptures: { 0: { name: `punctuation.definition.character-class.end.${ns}` } },
        name: `meta.character-class.${ns}`,
        patterns: [
          { name: `constant.character.escape.${ns}`, match: R(/\\./) },
          { name: `constant.character.set.${ns}`, match: R(/[A-Za-z0-9]-[A-Za-z0-9]/) },
        ],
      },
      'slot-variable': {
        name: `variable.other.slot.${ns}`,
        match: R(/\$(?:\{[A-Za-z_]\w*\}|[A-Za-z_]\w*|\d+)/),
      },
      attribute: { match: R(/\b([A-Za-z_][\w.]*)(?=\s*=\s*["'])/), name: `variable.parameter.attribute.${ns}` },
      token: {
        begin: R(/</),
        end: R(/>/),
        beginCaptures: { 0: { name: `punctuation.definition.token.begin.${ns}` } },
        endCaptures: { 0: { name: `punctuation.definition.token.end.${ns}` } },
        contentName: `meta.token.${ns}`,
        patterns: [
          { include: '#string' },
          { name: `support.type.property-name.${ns}`, match: R(/\b(?:STEM|POS|ORTH|TOKEN|TYPE|SUBTYPE|LEMMA|NORM|TAG|FEAT|LANG|REGEXP|LEXICON|[A-Z][A-Z_]+)(?=\s*[:=!~])/) },
          { name: `constant.language.pos-tag.${ns}`, match: `\\b(?:${alt(posTags)})\\b` },
          { name: `keyword.operator.comparison.${ns}`, match: R(/!=|~=|=/) },
          { name: `keyword.operator.negation.${ns}`, match: R(/[!~]/) },
          { name: `constant.character.wildcard.${ns}`, match: R(/\.\*|\.\+/) },
          { name: `punctuation.separator.${ns}`, match: R(/[:,]/) },
          { name: `keyword.operator.${ns}`, match: R(/[|+*?]/) },
        ],
      },
      'group-reference': {
        match: R(/(%)(\()([A-Za-z_][\w.]*(?:::[A-Za-z_][\w.]*)?)(\))/),
        captures: {
          1: { name: `keyword.operator.${ns}` },
          2: { name: `punctuation.section.parens.${ns}` },
          3: { name: `variable.other.group.${ns}` },
          4: { name: `punctuation.section.parens.${ns}` },
        },
      },
      operators: {
        patterns: [
          { name: `keyword.operator.action.${ns}`, match: R(/=>|->/) },
          { name: `keyword.operator.${ns}`, match: R(/[|+*?^$:]|\{\d+(?:,\d*)?\}/) },
          { name: `punctuation.terminator.statement.${ns}`, match: ';' },
          { name: `punctuation.section.parens.${ns}`, match: R(/[()]/) },
          { name: `punctuation.section.braces.${ns}`, match: R(/[{}]/) },
        ],
      },
    },
  });
  write('hdbtextinclude', { name: 'SAP HANA Text Analysis Rules Include', scopeName: 'source.hdbtextinclude', patterns: [{ include: 'source.hdbtextrule' }] });
  write('hdbtextlexicon', { name: 'SAP HANA Text Analysis Lexicon', scopeName: 'source.hdbtextlexicon', patterns: [{ include: 'source.hdbtextrule' }] });
}

// ---------------------------------------------------------------------------
// XS Classic text bundle (.hdbtextbundle): Java-properties-style translation texts
// docs/specs/artifacts/artifact-registry.md §3.1
// ---------------------------------------------------------------------------
{
  const ns = 'hdbtextbundle';
  write('hdbtextbundle', {
    name: 'SAP HANA Text Bundle (XS Classic)',
    scopeName: 'source.hdbtextbundle',
    patterns: [{ include: '#comment' }, { include: '#property' }],
    repository: {
      comment: {
        name: `comment.line.number-sign.${ns}`,
        begin: R(/^\s*[#!]/),
        end: '$',
        patterns: [
          { name: `keyword.other.directive.${ns}`, match: R(/\b(?:TRANSLATE|NOTRANSLATE)\b/) },
          {
            match: R(/\b([XY][A-Z]{3})(?:(,)\s*(\d+))?(?=\s*:)/),
            captures: {
              1: { name: `storage.type.text-type.${ns}` },
              2: { name: `punctuation.separator.${ns}` },
              3: { name: `constant.numeric.max-length.${ns}` },
            },
          },
        ],
      },
      property: {
        begin: R(/^\s*((?:\\.|[^\s:=\\])+)\s*([:=]|(?=\s))/),
        beginCaptures: {
          1: { name: `support.type.property-name.${ns}` },
          2: { name: `punctuation.separator.key-value.${ns}` },
        },
        end: R(/(?<!\\)$/),
        contentName: `string.unquoted.value.${ns}`,
        patterns: [
          { name: `constant.character.escape.${ns}`, match: R(/\\u[0-9A-Fa-f]{4}|\\./) },
          { name: `constant.character.escape.line-continuation.${ns}`, match: R(/\\$/) },
          { name: `variable.parameter.placeholder.${ns}`, match: R(/\{\d+\}/) },
        ],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// XS Classic procedure template (.proceduretemplate): SQLScript with `<Parameter>` placeholders
// docs/specs/artifacts/artifact-registry.md §3.2
// ---------------------------------------------------------------------------
write('proceduretemplate', {
  name: 'SAP HANA Procedure Template (XS Classic)',
  scopeName: 'source.proceduretemplate',
  patterns: [{ include: 'source.hanasql' }],
});
write('proceduretemplate-injection', {
  name: 'SAP HANA Procedure Template Placeholders',
  scopeName: 'proceduretemplate.injection',
  injectionSelector: 'L:source.proceduretemplate -comment -string',
  patterns: [{ name: 'variable.parameter.placeholder.proceduretemplate', match: R(/<[A-Za-z_][A-Za-z0-9_]*>/) }],
});

if (require.main === module) {
  const { syncOutputs } = require('./build-keywords');
  const check = process.argv.includes('--check');
  const stale = syncOutputs(outputs, check);
  if (check && stale.length) {
    console.error(`Stale grammars (run npm run build:grammars):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`${Object.keys(outputs).length} grammars in ${OUT}${stale.length ? `; wrote ${stale.length}` : '; up to date'}`);
}

module.exports = { grammarOutputs: outputs };
