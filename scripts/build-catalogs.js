'use strict';
/**
 * Generates docs/specs/catalogs/sql-keywords.json and docs/specs/catalogs/builtin-functions.json
 * from syntaxes/hanasql.tmLanguage.json and extracted SAP HANA 2.0 SPS 08 / HANA Cloud reference specs.
 *
 *   node scripts/build-catalogs.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GRAMMAR_PATH = path.join(ROOT, 'syntaxes', 'hanasql.tmLanguage.json');
const CATALOG_DIR = path.join(ROOT, 'docs', 'specs', 'catalogs');

fs.mkdirSync(CATALOG_DIR, { recursive: true });

const g = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
const R = g.repository;

const extractWords = (re) => {
  const m = re.match(/\(\?:([^)]*)\)/);
  if (!m) return [];
  return m[1]
    .split('|')
    .map((s) => s.trim())
    .filter((s) => Boolean(s) && /^[A-Z0-9_]+$/i.test(s))
    .map((s) => s.toUpperCase());
};

const RESERVED_SET = new Set(
  `ALL ALTER AS BEFORE BEGIN BOTH CASE CHAR CONDITION CONNECT CROSS CUBE CURRENT_CONNECTION CURRENT_DATE CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP CURRENT_TRANSACTION_ISOLATION_LEVEL CURRENT_USER CURRENT_UTCDATE CURRENT_UTCTIME CURRENT_UTCTIMESTAMP CURRVAL CURSOR DECLARE DISTINCT ELSE ELSEIF END EXCEPT EXCEPTION EXEC FALSE FOR FROM FULL GROUP HAVING IF IN INNER INOUT INTERSECT INTO IS JOIN LATERAL LEADING LEFT LIMIT LOOP MINUS NATURAL NCHAR NEXTVAL NULL ON ORDER OUT PRIOR RETURN RETURNS REVERSE RIGHT ROLLUP ROWID SELECT SESSION_USER SET SQL START SYSUUID TABLESAMPLE TOP TRAILING TRUE UNION UNKNOWN USING UTCTIMESTAMP VALUES WHEN WHERE WHILE WITH`.split(
    /\s+/
  )
);

const CLOUD_ONLY_KW = new Set([
  'REAL_VECTOR',
  'HALF_VECTOR',
  'JSON',
  'HNSW',
  'VECTOR_INDEX',
  'NO_VECTOR_INDEX',
  'ADJACENCY',
  'RDF',
  'ROLEGROUP',
  'USERGROUP',
  'MASK',
  'KEYPAIR',
  'CLIENTSIDE',
]);

const XSC_XSA_HDI_ONLY_KW = new Set(['ALPHANUM', 'SHORTTEXT', 'TEXT', 'BINTEXT', 'DAYDATE', 'LONGDATE']);

const XSA_HDI_CLOUD_ONLY_KW = new Set(['COLLECTION', 'UNSET', 'GRAPH', 'WORKSPACE', 'LIBRARY', 'TEST']);

function getPlatforms(word) {
  if (CLOUD_ONLY_KW.has(word)) return ['CLOUD'];
  if (XSC_XSA_HDI_ONLY_KW.has(word)) return ['XSC', 'XSA', 'HDI'];
  if (XSA_HDI_CLOUD_ONLY_KW.has(word)) return ['XSA', 'HDI', 'CLOUD'];
  return ['XSC', 'XSA', 'HDI', 'CLOUD'];
}

// ---------------------------------------------------------------------------
// 1. Build sql-keywords.json
// ---------------------------------------------------------------------------
const keywordMap = new Map();

function addKeyword(word, scope) {
  const w = word.toUpperCase();
  if (!keywordMap.has(w)) {
    keywordMap.set(w, {
      name: w,
      category: RESERVED_SET.has(w) ? 'reserved' : 'non-reserved',
      scope,
      platforms: getPlatforms(w),
    });
  }
}

for (const p of R.keywords.patterns) {
  for (const w of extractWords(p.match)) addKeyword(w, p.name);
}
for (const w of extractWords(R['logical-operators'].match)) {
  addKeyword(w, R['logical-operators'].name);
}
for (const w of extractWords(R.constants.patterns[0].match)) {
  addKeyword(w, R.constants.patterns[0].name);
}
for (const w of [
  'CURRENT_CONNECTION',
  'CURRENT_DATE',
  'CURRENT_SCHEMA',
  'CURRENT_TIME',
  'CURRENT_TIMESTAMP',
  'CURRENT_TRANSACTION_ISOLATION_LEVEL',
  'CURRENT_USER',
  'CURRENT_UTCDATE',
  'CURRENT_UTCTIME',
  'CURRENT_UTCTIMESTAMP',
  'SESSION_USER',
  'SYSUUID',
  'UTCTIMESTAMP',
  'SQLSCRIPT',
]) {
  addKeyword(w, 'support.constant.hanasql');
}
for (const w of extractWords(R.types.match)) {
  addKeyword(w, R.types.name);
}
for (const p of R['sqlscript-builtins'].patterns) {
  if (p.name && p.match && p.match.includes('(?:')) {
    for (const w of extractWords(p.match)) addKeyword(w, p.name);
  }
}
for (const w of RESERVED_SET) {
  addKeyword(w, 'keyword.other.sql.hanasql');
}

const SYSTEM_WORDS = [
  'ALTER', 'ADD', 'REMOVE', 'ENABLE', 'DISABLE', 'CLEAR', 'CREATE', 'LOAD', 'SAVE', 'START', 'STOP',
  'RECLAIM', 'RECOMPILE', 'RECONFIGURE', 'REFRESH', 'RESET', 'APPLICATION', 'ENCRYPTION', 'AUDIT',
  'LOG', 'CACHE', 'COLUMN', 'JOIN', 'DATA', 'STATISTICS', 'INIFILE', 'CONTENT', 'HISTORY', 'RESULT',
  'SQL', 'PLAN', 'TIMEZONE', 'TRACES', 'PERFTRACE', 'LOB', 'SPACE', 'ENTRY', 'SERVICE', 'MONITORING',
  'VIEW', 'SAVEPOINT', 'TABLE', 'PLACEMENT', 'CONFIGURATION', 'WAITGRAPH', 'RUNTIMEDUMP', 'KERNEL',
  'PROFILER', 'ABSTRACT', 'CAPTURE', 'APPLY', 'ASYNCHRONOUS', 'CONSISTENCY', 'CHECK', 'ALL', 'THREADS',
  'LOCATION', 'FILE', 'SECTIONS', 'TRACEPROFILE', 'PROFILE', 'SYSTEM',
];
for (const w of SYSTEM_WORDS) addKeyword(w, 'keyword.other.statement.hanasql');

const STATEMENT_NOUNS = [
  'ADAPTER', 'ADJACENCY', 'AGENT', 'ANALYTIC', 'AUDIT', 'AUTOCOMMIT', 'BLOCK', 'CERTIFICATE', 'CLASS',
  'CLIENTSIDE', 'COLLECTION', 'CREDENTIAL', 'DATABASE', 'DDL', 'DELTA', 'EXCHANGER', 'FILTER', 'FUNCTION',
  'FUZZY', 'GEOCODE', 'GRAPH', 'GROUP', 'HASH', 'HNSW', 'INDEX', 'JOB', 'JWT', 'KEY', 'KEYPAIR', 'LDAP',
  'LIBRARY', 'LOGIN', 'MAPPING', 'MASK', 'MATERIALIZED', 'MEASURE', 'MODEL', 'PACKAGE', 'POLICY',
  'PREDEFINED', 'PRIVILEGE', 'PROCEDURE', 'PROJECTION', 'PROVIDER', 'PSE', 'PUBLIC', 'PUBLICATION',
  'RANGE', 'RDF', 'REFERENCE', 'REMOTE', 'ROLEGROUP', 'SAML', 'SCHEDULER', 'SCHEMA', 'SEARCH', 'SESSION',
  'SOURCE', 'SPATIAL', 'STATISTICS', 'STRUCTURED', 'SUBSCRIPTION', 'SYNONYM', 'SYSTEMS', 'TABLE', 'TEXT',
  'TOKEN', 'TRANSACTION', 'UNIT', 'UNUSED', 'USERGROUP', 'VECTOR', 'VIEW', 'VIRTUAL', 'WORKLOAD',
  'WORKSPACE', 'X509',
];
for (const w of STATEMENT_NOUNS) addKeyword(w, 'keyword.other.statement.hanasql');

const EXTRA_CLAUSE_KW = [
  'IMMEDIATE', 'ROWS', 'RANGE', 'PRECEDING', 'FOLLOWING', 'UNBOUNDED', 'NULLS', 'FIRST', 'LAST',
  'MATCHED', 'ESCAPE', 'ONLY', 'ATOMIC', 'READ', 'OF', 'AT', 'TO', 'NO', 'HINT', 'AFTER', 'EACH',
  'STATEMENT', 'OVERRIDING', 'INSTEAD', 'SIMILARITY', 'ONLINE', 'RETENTION', 'DYNAMIC', 'STATIC',
  'SERIES', 'EQUIDISTANT', 'PIECEWISE', 'PERIOD', 'MINVALUE', 'MAXVALUE', 'CYCLE', 'INCREMENT',
  'FORCE', 'BULK', 'INCREMENTAL', 'LEVELS', 'RETAIN', 'VALID', 'UNTIL', 'EXCLUDED', 'CLUSTER',
  'KMEANS', 'CLUSTERS', 'DBSCAN', 'EPS', 'MINPTS', 'GRID', 'CELLS', 'HEXAGON', 'SIBLING', 'SIBLINGS',
  'MEASURES', 'SUBTOTAL', 'BALANCE', 'ORPHAN', 'MULTIPARENT', 'LEAVES', 'ADOPT', 'ROOT', 'BREAKUP',
  'SATISFIES', 'ORDINALITY', 'WRAPPER', 'PATH', 'VERTEX', 'EDGE', 'TARGET', 'LABEL',
];
for (const w of EXTRA_CLAUSE_KW) addKeyword(w, 'keyword.other.clause.hanasql');

const keywords = [...keywordMap.values()].sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(CATALOG_DIR, 'sql-keywords.json'), JSON.stringify({ keywords }, null, 2) + '\n');

// ---------------------------------------------------------------------------
// 2. Build builtin-functions.json
// ---------------------------------------------------------------------------
const DETAILED_FUNCTIONS = {
  // Vector Engine [CLOUD]
  CARDINALITY: {
    library: 'SYS',
    signatures: ['CARDINALITY(<array_or_vector>)'],
    returnType: 'INTEGER',
    description: 'Returns the number of elements in an ARRAY or dimension of a REAL_VECTOR / HALF_VECTOR ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  COSINE_SIMILARITY: {
    library: 'SYS',
    signatures: ['COSINE_SIMILARITY(<vector1>, <vector2>)'],
    returnType: 'DOUBLE',
    description: 'Computes the cosine similarity in [-1, 1] between two REAL_VECTOR or HALF_VECTOR values ([CLOUD]).',
  },
  CROSS_ENCODE: {
    library: 'SYS',
    signatures: ['CROSS_ENCODE(<text_a>, <text_b>, <model_and_version> [, <options>]) OVER (<window_spec>)'],
    returnType: 'DOUBLE',
    description: 'Window function that scores text pairs using a cross-encoder model ([CLOUD]).',
  },
  L2DISTANCE: {
    library: 'SYS',
    signatures: ['L2DISTANCE(<vector1>, <vector2>)'],
    returnType: 'DOUBLE',
    description: 'Computes the Euclidean (L2) distance between two REAL_VECTOR or HALF_VECTOR values ([CLOUD]).',
  },
  L2NORM: {
    library: 'SYS',
    signatures: ['L2NORM(<vector>)'],
    returnType: 'DOUBLE',
    description: 'Computes the Euclidean (L2) norm (length) of a vector ([CLOUD]).',
  },
  L2NORMALIZE: {
    library: 'SYS',
    signatures: ['L2NORMALIZE(<vector>)'],
    returnType: 'REAL_VECTOR | HALF_VECTOR',
    description: 'Normalizes a REAL_VECTOR or HALF_VECTOR to unit length under the L2 norm ([CLOUD]).',
  },
  MEMBER_AT: {
    library: 'SYS',
    signatures: ['MEMBER_AT(<array_or_vector>, <position> [, <default_value>])'],
    returnType: 'ANY | REAL',
    description: 'Returns the element at 1-based <position> from an ARRAY or REAL_VECTOR / HALF_VECTOR ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  SUBVECTOR: {
    library: 'SYS',
    signatures: ['SUBVECTOR(<vector>, <start_position>, <dimension>)'],
    returnType: 'REAL_VECTOR | HALF_VECTOR',
    description: 'Extracts a contiguous subvector starting at 1-based <start_position> with length <dimension> ([CLOUD]).',
  },
  TO_ARRAY: {
    library: 'SYS',
    signatures: ['TO_ARRAY(<vector>)'],
    returnType: 'REAL ARRAY',
    description: 'Converts a REAL_VECTOR or HALF_VECTOR into a SQLScript REAL ARRAY ([CLOUD]).',
  },
  TO_HALF_VECTOR: {
    library: 'SYS',
    signatures: ['TO_HALF_VECTOR(<vector_representation>)'],
    returnType: 'HALF_VECTOR',
    description: 'Constructs a 16-bit float HALF_VECTOR from a textual array, binary, or REAL_VECTOR value ([CLOUD]).',
  },
  TO_REAL_VECTOR: {
    library: 'SYS',
    signatures: ['TO_REAL_VECTOR(<vector_representation>)'],
    returnType: 'REAL_VECTOR',
    description: 'Constructs a 32-bit float REAL_VECTOR from a textual array, binary, or HALF_VECTOR value ([CLOUD]).',
  },
  VECTOR_EMBEDDING: {
    library: 'SYS',
    signatures: ["VECTOR_EMBEDDING(<text>, {'DOCUMENT' | 'QUERY'}, <model_and_version> [, <remote_source_schema>, <remote_source>] [, <options>])"],
    returnType: 'REAL_VECTOR',
    description: 'Generates a vector embedding for <text> using SAP HANA NLP or SAP AI Core ([CLOUD]).',
  },
  CREATE_VECTOR_EMBEDDINGS: {
    library: 'SYS',
    signatures: ['CREATE_VECTOR_EMBEDDINGS(<schema>, <table>, <text_col>, <embedding_col>, <text_type>, <model_and_version> [, <batch_size> [, <remote_schema>, <remote_source>]] [, <options>])'],
    returnType: 'VOID',
    description: 'Built-in procedure that batch-computes vector embeddings for a table column ([CLOUD]).',
  },
  GET_REMOTE_SOURCE_AI_MODELS: {
    library: 'SYS',
    signatures: ['GET_REMOTE_SOURCE_AI_MODELS(<remote_source_name>, OUT <models_table>)'],
    returnType: 'TABLE',
    description: 'Built-in procedure listing available AI models on a remote SAP AI Core source ([CLOUD]).',
  },

  // Graph & Knowledge Graph Engine
  OPENCYPHER_TABLE: {
    library: 'SYS',
    signatures: ['OPENCYPHER_TABLE(GRAPH WORKSPACE <workspace_name> QUERY <cypher_query_string> [PARAMETERS (<param_list>)])'],
    returnType: 'TABLE',
    description: 'Executes an OpenCypher pattern-matching query on a SAP HANA Property Graph workspace ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  SPARQL_TABLE: {
    library: 'SYS',
    signatures: ['SPARQL_TABLE(<sparql_select_query_string> [, <accept_header_string>])'],
    returnType: 'TABLE',
    description: 'Executes a SPARQL SELECT query on the SAP HANA Cloud Knowledge Graph Engine triple store and returns a relational table ([CLOUD]).',
  },
  SPARQL_EXECUTE: {
    library: 'SYS',
    signatures: ['SPARQL_EXECUTE(IN <request_string> NCLOB, IN <headers_string> NCLOB, OUT <response_body> NCLOB, OUT <response_headers> NCLOB)'],
    returnType: 'VOID',
    description: 'Built-in procedure executing SPARQL 1.1 Query/Update or RDF Turtle ingestion on the Knowledge Graph Engine ([CLOUD]).',
  },
  SQL_TABLE: {
    library: 'SYS',
    signatures: ['SQL_TABLE(<sql_query_string>)'],
    returnType: 'TABLE',
    description: 'Knowledge Graph Engine SPARQL function that embeds a relational SQL query result inside a SPARQL WHERE clause ([CLOUD]).',
  },
  RDF_GRAPH_FROM_GRAPH_WORKSPACE: {
    library: 'SYS',
    signatures: ['RDF_GRAPH_FROM_GRAPH_WORKSPACE(<workspace_schema>, <workspace_name>, <graph_uri>, <base_uri>, <vocabulary_uri>, <options>, OUT <result>)'],
    returnType: 'TABLE',
    description: 'Converts a Property Graph workspace into an RDF graph in the Knowledge Graph Engine ([CLOUD]).',
  },
  RDF_GRAPH_TO_GRAPH_WORKSPACE: {
    library: 'SYS',
    signatures: ['RDF_GRAPH_TO_GRAPH_WORKSPACE(<graph_uri>, <workspace_schema>, <workspace_name>, <tables_schema>, <options>, OUT <result>)'],
    returnType: 'TABLE',
    description: 'Converts an RDF graph into a Property Graph workspace and backing vertex/edge tables ([CLOUD]).',
  },

  // Hierarchy Functions
  HIERARCHY: {
    library: 'SYS',
    signatures: ['HIERARCHY(SOURCE <source> [START WHERE <cond>] [SIBLING ORDER BY <order>] [DEPTH <n>] [MULTIPARENT ...] [ORPHAN ...] [CYCLE ...] [CACHE ...] [LOAD ...])'],
    returnType: 'TABLE',
    description: 'Generates a parent-child hierarchy table with HIERARCHY_RANK, HIERARCHY_TREE_SIZE, HIERARCHY_PARENT_RANK, HIERARCHY_LEVEL ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  HIERARCHY_SPANTREE: {
    library: 'SYS',
    signatures: ['HIERARCHY_SPANTREE(SOURCE <source> [START WHERE <cond>] [SIBLING ORDER BY <order>] [DEPTH <n>] [CACHE ...] [LOAD ...])'],
    returnType: 'TABLE',
    description: 'Generates a minimum spanning-tree hierarchy from a parent-child adjacency source ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  HIERARCHY_TEMPORAL: {
    library: 'SYS',
    signatures: ['HIERARCHY_TEMPORAL(SOURCE <source> [START WHERE <cond>] [SIBLING ORDER BY <order>] VALID {FROM <t1> UNTIL <t2> | AT <t>} ...)'],
    returnType: 'TABLE',
    description: 'Generates a time-dependent hierarchy filtered by VALID_FROM / VALID_UNTIL intervals ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  HIERARCHY_LEVELED: {
    library: 'SYS',
    signatures: ['HIERARCHY_LEVELED(SOURCE <source> [LEVELS (<col_list>)] [SIBLING ORDER BY <order>] [CACHE ...] [RETAIN NULLS ...])'],
    returnType: 'TABLE',
    description: 'Generates a hierarchy from leveled (column-per-level) source data ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  HIERARCHY_COMPOSITE_ID: {
    library: 'SYS',
    signatures: ['HIERARCHY_COMPOSITE_ID(<expr1>, <expr2> [, ...])'],
    returnType: 'VARBINARY',
    description: 'Scalar function combining multiple key columns into a single composite hierarchy NODE_ID/PARENT_ID ([XSA]/[HDI]/[CLOUD]).',
  },
  HIERARCHY_DESCENDANTS: {
    library: 'SYS',
    signatures: ['HIERARCHY_DESCENDANTS(SOURCE <hierarchy> [START ...] [DISTANCE ...])'],
    returnType: 'TABLE',
    description: 'Navigates downward from start nodes in a generated hierarchy, adding HIERARCHY_DISTANCE and START_RANK ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  HIERARCHY_ANCESTORS: {
    library: 'SYS',
    signatures: ['HIERARCHY_ANCESTORS(SOURCE <hierarchy> [START ...] [DISTANCE ...])'],
    returnType: 'TABLE',
    description: 'Navigates upward to ancestors from start nodes in a generated hierarchy ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  HIERARCHY_SIBLINGS: {
    library: 'SYS',
    signatures: ['HIERARCHY_SIBLINGS(SOURCE <hierarchy> [START ...])'],
    returnType: 'TABLE',
    description: 'Returns sibling nodes sharing the same parent as the start nodes, adding HIERARCHY_SIBLING_DISTANCE ([XSC]/[XSA]/[HDI]/[CLOUD]).',
  },
  HIERARCHY_DESCENDANTS_AGGREGATE: {
    library: 'SYS',
    signatures: ['HIERARCHY_DESCENDANTS_AGGREGATE(SOURCE <hierarchy> [JOIN <table> ON <cond>] MEASURES (<agg> AS <alias> [, ...]) [WHERE ...] [WITH SUBTOTAL] [WITH BALANCE] [WITH NOT MATCHED] [WITH TOTAL])'],
    returnType: 'TABLE',
    description: 'Computes hierarchical rollups and subtotals over descendant subtrees ([XSA]/[HDI]/[CLOUD]).',
  },
  HIERARCHY_ANCESTORS_AGGREGATE: {
    library: 'SYS',
    signatures: ['HIERARCHY_ANCESTORS_AGGREGATE(SOURCE <hierarchy> [START ...] MEASURES (<agg> AS <alias> [, ...]) [WHERE ...])'],
    returnType: 'TABLE',
    description: 'Computes aggregations along ancestor paths in a generated hierarchy ([XSA]/[HDI]/[CLOUD]).',
  },

  // JSON Document Store
  JSON_VALUE: {
    library: 'SYS',
    signatures: ["JSON_VALUE(<json_doc>, '<json_path>' [RETURNING <data_type>] [{ERROR | NULL | DEFAULT <val>} ON EMPTY] [{ERROR | NULL | DEFAULT <val>} ON ERROR])"],
    returnType: 'NVARCHAR | <data_type>',
    description: 'Extracts a scalar SQL value from a JSON document at <json_path> ([XSA]/[HDI]/[CLOUD]).',
  },
  JSON_QUERY: {
    library: 'SYS',
    signatures: ["JSON_QUERY(<json_doc>, '<json_path>' [RETURNING {NVARCHAR(<n>) | JSON}] [WRAPPER] [ON EMPTY] [ON ERROR])"],
    returnType: 'NVARCHAR | JSON',
    description: 'Extracts a JSON object or JSON array fragment from a JSON document ([XSA]/[HDI]/[CLOUD]).',
  },
  JSON_TABLE: {
    library: 'SYS',
    signatures: ["JSON_TABLE(<json_doc>, '<json_path>' COLUMNS (<col_specs>) [{ERROR | EMPTY} ON ERROR])"],
    returnType: 'TABLE',
    description: 'Projects a JSON document into a relational table with support for NESTED PATH and FOR ORDINALITY ([XSA]/[HDI]/[CLOUD]).',
  },
  PARSE_JSON: {
    library: 'SYS',
    signatures: ['PARSE_JSON(<json_string>)'],
    returnType: 'JSON',
    description: 'Parses a string into a native SAP HANA Cloud JSON document value ([CLOUD]).',
  },
  TO_JSON_BOOLEAN: {
    library: 'SYS',
    signatures: ['TO_JSON_BOOLEAN(<value>)'],
    returnType: 'JSON',
    description: 'Converts a SQL boolean, numeric, or string value to a JSON boolean value ([XSA]/[HDI]/[CLOUD]).',
  },
};

const functionList = [];
const seenFunctions = new Set();

function addFuncEntry(name, library, signatures, returnType, description) {
  const key = `${library}:${name}`;
  if (seenFunctions.has(key)) return;
  seenFunctions.add(key);
  functionList.push({ name, library, signatures, returnType, description });
}

for (const p of R.functions.patterns) {
  const scope = p.name;
  for (const w of extractWords(p.match)) {
    if (DETAILED_FUNCTIONS[w]) {
      const d = DETAILED_FUNCTIONS[w];
      addFuncEntry(w, d.library, d.signatures, d.returnType, d.description);
      continue;
    }
    let returnType = 'ANY';
    let desc = 'Built-in SAP HANA SQL function ([XSC]/[XSA]/[HDI]/[CLOUD]).';
    if (scope.includes('.aggregate.')) {
      returnType = 'NUMERIC | ANY';
      desc = `Built-in SAP HANA SQL aggregate function ${w} ([XSC]/[XSA]/[HDI]/[CLOUD]).`;
    } else if (scope.includes('.window.')) {
      returnType = 'NUMERIC | ANY';
      desc = `Built-in SAP HANA SQL window function ${w} ([XSC]/[XSA]/[HDI]/[CLOUD]).`;
    } else if (scope.includes('.string.')) {
      returnType = 'NVARCHAR | INTEGER';
      desc = `Built-in SAP HANA SQL string function ${w} ([XSC]/[XSA]/[HDI]/[CLOUD]).`;
    } else if (scope.includes('.numeric.')) {
      returnType = 'NUMERIC';
      desc = `Built-in SAP HANA SQL numeric/math function ${w} ([XSC]/[XSA]/[HDI]/[CLOUD]).`;
    } else if (scope.includes('.datetime.')) {
      returnType = 'TIMESTAMP | DATE | TIME | INTEGER';
      desc = `Built-in SAP HANA SQL datetime function ${w} ([XSC]/[XSA]/[HDI]/[CLOUD]).`;
    } else if (scope.includes('.conversion.')) {
      returnType = w.startsWith('TO_') ? w.slice(3) : 'ANY';
      desc = `Built-in SAP HANA SQL data type conversion function ${w} ([XSC]/[XSA]/[HDI]/[CLOUD]).`;
    } else if (scope.includes('.spatial.')) {
      returnType = w.endsWith('AGGR') ? 'ST_GEOMETRY' : w.endsWith('GRID') || w.endsWith('BOUNDINGBOX') ? 'TABLE' : 'ST_GEOMETRY | DOUBLE | INTEGER';
      desc = `Built-in SAP HANA Spatial function/method ${w} ([XSC]/[XSA]/[HDI]/[CLOUD]).`;
    } else if (w.startsWith('SERIES_')) {
      returnType = w.startsWith('SERIES_GENERATE') || w.startsWith('SERIES_DISAGGREGATE') ? 'TABLE' : 'SCALAR';
      desc = `Built-in SAP HANA Series Data function ${w} ([XSC]/[XSA]/[HDI]).`;
    } else if (w.startsWith('TM_')) {
      returnType = 'TABLE';
      desc = `Built-in SAP HANA Text Mining function ${w} ([XSC]/[XSA]).`;
    }
    addFuncEntry(w, 'SYS', [`${w}(...)`], returnType, desc);
  }
}

// Calculation Engine (CE_*) & SQLScript built-in functions
const CE_AND_SQLSCRIPT_FUNCS = [
  ['CE_COLUMN_TABLE', 'SYS', ['CE_COLUMN_TABLE(<table_name> [, [<attr_list>]])'], 'TABLE', 'Calculation Engine plan operator binding a column table ([XSC]/[XSA]/[HDI]).'],
  ['CE_JOIN_VIEW', 'SYS', ['CE_JOIN_VIEW(<view_name> [, [<attr_list>]])'], 'TABLE', 'Calculation Engine plan operator binding an attribute/join view ([XSC]).'],
  ['CE_OLAP_VIEW', 'SYS', ['CE_OLAP_VIEW(<olap_view_name> [, [<dim_and_measures>]])'], 'TABLE', 'Calculation Engine plan operator binding an analytic/OLAP view ([XSC]).'],
  ['CE_CALC_VIEW', 'SYS', ['CE_CALC_VIEW(<calc_view_name> [, [<attr_list>]])'], 'TABLE', 'Calculation Engine plan operator binding a calculation view ([XSC]/[XSA]/[HDI]).'],
  ['CE_JOIN', 'SYS', ['CE_JOIN(<left_tab>, <right_tab>, [<join_attrs>] [, [<proj_list>]])'], 'TABLE', 'Calculation Engine inner join plan operator ([XSC]/[XSA]/[HDI]).'],
  ['CE_LEFT_OUTER_JOIN', 'SYS', ['CE_LEFT_OUTER_JOIN(<left_tab>, <right_tab>, [<join_attrs>] [, [<proj_list>]])'], 'TABLE', 'Calculation Engine left outer join plan operator ([XSC]/[XSA]/[HDI]).'],
  ['CE_RIGHT_OUTER_JOIN', 'SYS', ['CE_RIGHT_OUTER_JOIN(<left_tab>, <right_tab>, [<join_attrs>] [, [<proj_list>]])'], 'TABLE', 'Calculation Engine right outer join plan operator ([XSC]/[XSA]/[HDI]).'],
  ['CE_PROJECTION', 'SYS', ['CE_PROJECTION(<tab>, [<proj_list>] [, <filter_expr>])'], 'TABLE', 'Calculation Engine projection and filter plan operator ([XSC]/[XSA]/[HDI]).'],
  ['CE_CALC', 'SYS', ['CE_CALC(\'<expr>\', <data_type>)'], 'SCALAR', 'Calculation Engine computed column evaluator inside CE_PROJECTION / CE_AGGREGATION ([XSC]/[XSA]/[HDI]).'],
  ['CE_AGGREGATION', 'SYS', ['CE_AGGREGATION(<tab>, [<agg_list>] [, [<group_by_cols>]])'], 'TABLE', 'Calculation Engine aggregation plan operator ([XSC]/[XSA]/[HDI]).'],
  ['CE_UNION_ALL', 'SYS', ['CE_UNION_ALL(<tab1>, <tab2>)'], 'TABLE', 'Calculation Engine union all plan operator ([XSC]/[XSA]/[HDI]).'],
  ['CE_VERTICAL_UNION', 'SYS', ['CE_VERTICAL_UNION(<tab1>, [<cols1>], <tab2>, [<cols2>])'], 'TABLE', 'Calculation Engine vertical union plan operator ([XSC]/[XSA]/[HDI]).'],
  ['CE_CONVERSION', 'SYS', ['CE_CONVERSION(<tab>, [<conversion_params>] [, [<rename_list>]])'], 'TABLE', 'Calculation Engine currency/unit conversion plan operator ([XSC]/[XSA]/[HDI]).'],
  ['MAP_MERGE', 'SYS', ['MAP_MERGE(<input_table>, <mapper_func>(<input_table>.<col1>, ...))'], 'TABLE', 'SQLScript parallel map-merge operator executing a table function per row ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['MAP_REDUCE', 'SYS', ['MAP_REDUCE(<input_table>, <mapper_func>(...), <reducer_func>(...))'], 'TABLE', 'SQLScript parallel map-reduce operator ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['APPLY_FILTER', 'SYS', ['APPLY_FILTER(<table_or_view>, <dynamic_where_string>)'], 'TABLE', 'Applies a dynamic SQL WHERE filter string to a table or table variable ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['BIND_AS_PARAMETER', 'SYS', ['BIND_AS_PARAMETER(<scalar_expr>)'], 'ANY', 'Forces a scalar expression in SQLScript to be bound as a query parameter ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['BIND_AS_VALUE', 'SYS', ['BIND_AS_VALUE(<scalar_expr>)'], 'ANY', 'Forces a scalar expression in SQLScript to be inlined as a literal value ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
];
for (const [name, lib, sigs, ret, desc] of CE_AND_SQLSCRIPT_FUNCS) {
  addFuncEntry(name, lib, sigs, ret, desc);
}

// Built-in SYS.SQLSCRIPT_* Libraries (SQLScript Reference Section 12 & 14)
const SQLSCRIPT_LIBRARY_MEMBERS = [
  // SYS.SQLSCRIPT_SYNC
  ['SLEEP_SECONDS', 'SQLSCRIPT_SYNC', ['SLEEP_SECONDS(IN <sleep_time> DOUBLE)'], 'VOID', 'Suspends execution of the current SQLScript session for <sleep_time> seconds ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['WAKEUP_CONNECTION', 'SQLSCRIPT_SYNC', ['WAKEUP_CONNECTION(IN <connection_id> INTEGER)'], 'VOID', 'Wakes up a sleeping connection identified by <connection_id> ([XSC]/[XSA]/[HDI]/[CLOUD]).'],

  // SYS.SQLSCRIPT_STRING
  ['SPLIT', 'SQLSCRIPT_STRING', ["SPLIT(IN VALUE NVARCHAR(5000), IN SEPARATOR NVARCHAR(5000) DEFAULT ',', IN MAXSPLIT INT DEFAULT -1)"], 'TABLE (RESULT NVARCHAR(5000))', 'Splits a string by SEPARATOR into a table of substrings ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['SPLIT_TO_TABLE', 'SQLSCRIPT_STRING', ["SPLIT_TO_TABLE(IN VALUE NVARCHAR(5000), IN SEPARATOR NVARCHAR(5000) DEFAULT ',', IN MAXSPLIT INT DEFAULT -1)"], 'TABLE (RESULT NVARCHAR(5000))', 'Splits a string by SEPARATOR into a single-column table ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['SPLIT_TO_ARRAY', 'SQLSCRIPT_STRING', ["SPLIT_TO_ARRAY(IN VALUE NVARCHAR(5000), IN SEPARATOR NVARCHAR(5000) DEFAULT ',', IN MAXSPLIT INT DEFAULT -1)"], 'NVARCHAR(5000) ARRAY', 'Splits a string by SEPARATOR into an NVARCHAR ARRAY ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['SPLIT_REGEXPR', 'SQLSCRIPT_STRING', ['SPLIT_REGEXPR(IN VALUE NVARCHAR(5000), IN REGEXPR NVARCHAR(5000), IN MAXSPLIT INT DEFAULT -1)'], 'TABLE (RESULT NVARCHAR(5000))', 'Splits a string using a regular expression pattern ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['SPLIT_REGEXPR_TO_TABLE', 'SQLSCRIPT_STRING', ['SPLIT_REGEXPR_TO_TABLE(IN VALUE NVARCHAR(5000), IN REGEXPR NVARCHAR(5000), IN MAXSPLIT INT DEFAULT -1)'], 'TABLE (RESULT NVARCHAR(5000))', 'Splits a string using a regular expression into a single-column table ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['SPLIT_REGEXPR_TO_ARRAY', 'SQLSCRIPT_STRING', ['SPLIT_REGEXPR_TO_ARRAY(IN VALUE NVARCHAR(5000), IN REGEXPR NVARCHAR(5000), IN MAXSPLIT INT DEFAULT -1)'], 'NVARCHAR(5000) ARRAY', 'Splits a string using a regular expression into an NVARCHAR ARRAY ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['FORMAT', 'SQLSCRIPT_STRING', ['FORMAT(IN FORMAT NVARCHAR(5000), IN <arg1> <any>, ...)'], 'NVARCHAR(5000)', 'Formats a string using positional/printf placeholders ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['FORMAT_TO_TABLE', 'SQLSCRIPT_STRING', ['FORMAT_TO_TABLE(IN FORMAT NVARCHAR(5000), IN TAB TABLE(...))'], 'TABLE (RESULT NVARCHAR(5000))', 'Formats each row of a table variable using a format string into a table ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['FORMAT_TO_ARRAY', 'SQLSCRIPT_STRING', ['FORMAT_TO_ARRAY(IN FORMAT NVARCHAR(5000), IN TAB TABLE(...))'], 'NVARCHAR(5000) ARRAY', 'Formats each row of a table variable using a format string into an array ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['TABLE_SUMMARY', 'SQLSCRIPT_STRING', ['TABLE_SUMMARY(IN TAB TABLE(...), IN ROWS INT DEFAULT 100)'], 'NVARCHAR(5000)', 'Formats a tabular ASCII summary of a table variable ([XSC]/[XSA]/[HDI]/[CLOUD]).'],

  // SYS.SQLSCRIPT_PRINT
  ['PRINT_LINE', 'SQLSCRIPT_PRINT', ['PRINT_LINE(IN <input> NVARCHAR(8388607))'], 'VOID', 'Prints a line of text to the SQLScript client output buffer ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['PRINT_TABLE', 'SQLSCRIPT_PRINT', ['PRINT_TABLE(IN <tab> TABLE(...), IN <max_records> INT DEFAULT 100)'], 'VOID', 'Prints a formatted table variable to the SQLScript client output buffer ([XSC]/[XSA]/[HDI]/[CLOUD]).'],

  // SYS.SQLSCRIPT_LOGGING
  ['CREATE_CONFIGURATION', 'SQLSCRIPT_LOGGING', ['CREATE_CONFIGURATION(IN configuration_name NVARCHAR(256))'], 'VOID', 'Creates a named SQLScript logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['DROP_CONFIGURATION', 'SQLSCRIPT_LOGGING', ['DROP_CONFIGURATION(IN configuration_name NVARCHAR(256), IN drop_cascade BOOLEAN DEFAULT FALSE)'], 'VOID', 'Drops a SQLScript logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['SET_OUTPUT_TABLE', 'SQLSCRIPT_LOGGING', ['SET_OUTPUT_TABLE(IN configuration_name NVARCHAR(256), IN schema_name NVARCHAR(256), IN table_name NVARCHAR(256))'], 'VOID', 'Sets the target log table (of type SYS.SQLSCRIPT_LOGGING_TABLE_TYPE) for a logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['SET_LEVEL', 'SQLSCRIPT_LOGGING', ['SET_LEVEL(IN configuration_name NVARCHAR(256), IN level VARCHAR(7))'], 'VOID', 'Sets the log level (LEVEL_FATAL, LEVEL_ERROR, LEVEL_WARNING, LEVEL_INFO, LEVEL_DEBUG) for a logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['START_LOGGING', 'SQLSCRIPT_LOGGING', ['START_LOGGING(IN configuration_name NVARCHAR(256))'], 'VOID', 'Activates logging for a configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['STOP_LOGGING', 'SQLSCRIPT_LOGGING', ['STOP_LOGGING(IN configuration_name NVARCHAR(256))'], 'VOID', 'Deactivates logging for a configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['ADD_SQLSCRIPT_OBJECT', 'SQLSCRIPT_LOGGING', ['ADD_SQLSCRIPT_OBJECT(IN configuration_name NVARCHAR(256), IN schema_name NVARCHAR(256), IN object_name NVARCHAR(256), IN library_member_name NVARCHAR(256) DEFAULT NULL, IN level VARCHAR(7) DEFAULT NULL)'], 'VOID', 'Registers a procedure, function, or library member with a logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['REMOVE_SQLSCRIPT_OBJECT', 'SQLSCRIPT_LOGGING', ['REMOVE_SQLSCRIPT_OBJECT(IN configuration_name NVARCHAR(256), IN schema_name NVARCHAR(256), IN object_name NVARCHAR(256), IN library_member_name NVARCHAR(256) DEFAULT NULL)'], 'VOID', 'Unregisters a SQLScript object from a logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['SET_FILTER', 'SQLSCRIPT_LOGGING', ['SET_FILTER(IN configuration_name NVARCHAR(256), IN filter_values NVARCHAR(5000))'], 'VOID', 'Replaces the topic filter list for a logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['ADD_FILTER', 'SQLSCRIPT_LOGGING', ['ADD_FILTER(IN configuration_name NVARCHAR(256), IN filter_values NVARCHAR(5000))'], 'VOID', 'Adds topic filters to a logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['REMOVE_FILTER', 'SQLSCRIPT_LOGGING', ['REMOVE_FILTER(IN configuration_name NVARCHAR(256), IN filter_values NVARCHAR(5000))'], 'VOID', 'Removes topic filters from a logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['UNSET_FILTER', 'SQLSCRIPT_LOGGING', ['UNSET_FILTER(IN configuration_name NVARCHAR(256))'], 'VOID', 'Clears all topic filters for a logging configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['LOG', 'SQLSCRIPT_LOGGING', ['LOG(IN level VARCHAR(7), IN topic NVARCHAR(256), IN message NVARCHAR(5000) [, IN <arg1> <any>, ...])'], 'VOID', 'Writes a formatted log entry when logging is active for the current object and topic ([XSA]/[HDI]/[CLOUD]).'],

  // SYS.SQLSCRIPT_TEST
  ['LIST_TESTS', 'SQLSCRIPT_TEST', ['LIST_TESTS(IN config_json NCLOB, OUT tests TABLE(...))'], 'VOID', 'Lists all @Test procedures matching the JSON test configuration ([XSA]/[HDI]/[CLOUD]).'],
  ['LIST_CONFIGURATIONS', 'SQLSCRIPT_TEST', ['LIST_CONFIGURATIONS(IN config_json NCLOB, OUT configs TABLE(...))'], 'VOID', 'Lists all test configurations defined in SQLSCRIPT_TEST libraries ([XSA]/[HDI]/[CLOUD]).'],
  ['EXPECT_EQ', 'SQLSCRIPT_TEST', ['EXPECT_EQ(IN actual <any>, IN expected <any>)'], 'VOID', 'Asserts that actual == expected in a SQLScript unit test ([XSA]/[HDI]/[CLOUD]).'],
  ['EXPECT_NE', 'SQLSCRIPT_TEST', ['EXPECT_NE(IN actual <any>, IN expected <any>)'], 'VOID', 'Asserts that actual != expected in a SQLScript unit test ([XSA]/[HDI]/[CLOUD]).'],
  ['EXPECT_GE', 'SQLSCRIPT_TEST', ['EXPECT_GE(IN actual <any>, IN expected <any>)'], 'VOID', 'Asserts that actual >= expected in a SQLScript unit test ([XSA]/[HDI]/[CLOUD]).'],
  ['EXPECT_GT', 'SQLSCRIPT_TEST', ['EXPECT_GT(IN actual <any>, IN expected <any>)'], 'VOID', 'Asserts that actual > expected in a SQLScript unit test ([XSA]/[HDI]/[CLOUD]).'],
  ['EXPECT_LE', 'SQLSCRIPT_TEST', ['EXPECT_LE(IN actual <any>, IN expected <any>)'], 'VOID', 'Asserts that actual <= expected in a SQLScript unit test ([XSA]/[HDI]/[CLOUD]).'],
  ['EXPECT_LT', 'SQLSCRIPT_TEST', ['EXPECT_LT(IN actual <any>, IN expected <any>)'], 'VOID', 'Asserts that actual < expected in a SQLScript unit test ([XSA]/[HDI]/[CLOUD]).'],
  ['EXPECT_NULL', 'SQLSCRIPT_TEST', ['EXPECT_NULL(IN actual <any>)'], 'VOID', 'Asserts that actual IS NULL in a SQLScript unit test ([XSA]/[HDI]/[CLOUD]).'],
  ['EXPECT_TABLE_EQ', 'SQLSCRIPT_TEST', ['EXPECT_TABLE_EQ(IN actual TABLE(...), IN expected TABLE(...), IN ignore_order BOOLEAN DEFAULT FALSE)'], 'VOID', 'Asserts that two table variables contain identical rows in a SQLScript unit test ([XSA]/[HDI]/[CLOUD]).'],
  ['FAIL', 'SQLSCRIPT_TEST', ["FAIL(IN message NVARCHAR(5000) DEFAULT '')"], 'VOID', 'Unconditionally fails the current SQLScript unit test with <message> ([XSA]/[HDI]/[CLOUD]).'],

  // GraphScript Built-in Algorithms & Functions
  ['IS_REACHABLE', 'GRAPHSCRIPT', ['IS_REACHABLE(<graph>, <start_vertex>, <end_vertex> [, <direction>])'], 'BOOLEAN', 'Returns true if <end_vertex> is reachable from <start_vertex> in <graph> ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['NEIGHBORS', 'GRAPHSCRIPT', ['NEIGHBORS(<graph>, <start_vertices>, <lower_bound>, <upper_bound> [, <direction>])'], 'MULTISET<VERTEX>', 'Returns vertices within hop distance [<lower_bound>, <upper_bound>] from <start_vertices> ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['SHORTEST_PATH', 'GRAPHSCRIPT', ['SHORTEST_PATH(<graph>, <source_vertex>, <target_vertex> [, <weight_closure>] [, <direction>])'], 'WEIGHTEDPATH', 'Computes a shortest path from <source_vertex> to <target_vertex> in <graph> ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['SHORTEST_PATHS_ONE_TO_ALL', 'GRAPHSCRIPT', ['SHORTEST_PATHS_ONE_TO_ALL(<graph>, <source_vertex>, <weight_attribute> [, <weight_closure>] [, <direction>])'], 'GRAPH', 'Computes shortest paths from <source_vertex> to all reachable vertices in <graph> ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['K_SHORTEST_PATHS', 'GRAPHSCRIPT', ['K_SHORTEST_PATHS(<graph>, <source_vertex>, <target_vertex>, <k> [, <weight_closure>] [, <direction>])'], 'SEQUENCE<WEIGHTEDPATH>', 'Computes the top <k> shortest paths between <source_vertex> and <target_vertex> ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['STRONGLY_CONNECTED_COMPONENTS', 'GRAPHSCRIPT', ['STRONGLY_CONNECTED_COMPONENTS(<graph>)'], 'MULTISET<MULTISET<VERTEX>>', 'Partitions <graph> into strongly connected components ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['SUBGRAPH', 'GRAPHSCRIPT', ['SUBGRAPH(<graph>, <vertices>)'], 'GRAPH', 'Constructs a subgraph induced by <vertices> ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['INDUCED_SUBGRAPH', 'GRAPHSCRIPT', ['INDUCED_SUBGRAPH(<graph>, <vertices>)'], 'GRAPH', 'Constructs an induced subgraph from <vertices> ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
  ['INVERSE_GRAPH', 'GRAPHSCRIPT', ['INVERSE_GRAPH(<graph>)'], 'GRAPH', 'Constructs a graph with all edge directions reversed ([XSC]/[XSA]/[HDI]/[CLOUD]).'],
];

for (const [name, lib, sigs, ret, desc] of SQLSCRIPT_LIBRARY_MEMBERS) {
  addFuncEntry(name, lib, sigs, ret, desc);
}

functionList.sort((a, b) => a.library.localeCompare(b.library) || a.name.localeCompare(b.name));
fs.writeFileSync(path.join(CATALOG_DIR, 'builtin-functions.json'), JSON.stringify({ functions: functionList }, null, 2) + '\n');

console.log(`Catalogs written: ${keywords.length} keywords, ${functionList.length} functions.`);
