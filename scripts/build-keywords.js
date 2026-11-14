const fs = require('fs');
// Regenerates src/formatter/keywords.js from syntaxes/hanasql.tmLanguage.json (+ SQL Reference additions).
const g = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'syntaxes', 'hanasql.tmLanguage.json'), 'utf8'));
const words = (re) => {
  const m = re.match(/\(\?:([^)]*)\)/);
  return m[1].split('|').map(s => s.trim()).filter(Boolean);
};
const R = g.repository;
const FUNCTIONS = new Set(), TYPES = new Set(), KEYWORDS = new Set();
for (const p of R.functions.patterns) words(p.match).forEach(w => FUNCTIONS.add(w));
words(R.types.match).forEach(w => TYPES.add(w));
for (const p of R.keywords.patterns) words(p.match).forEach(w => KEYWORDS.add(w));
words(R['logical-operators'].match).forEach(w => KEYWORDS.add(w));
words(R.constants.patterns[0].match).forEach(w => KEYWORDS.add(w));
// support.constant has nested (?:...) -> add manually below
const RESERVED = `ALL ALTER AS BEFORE BEGIN BOTH CASE CHAR CONDITION CONNECT CROSS CUBE CURRENT_CONNECTION CURRENT_DATE CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP CURRENT_TRANSACTION_ISOLATION_LEVEL CURRENT_USER CURRENT_UTCDATE CURRENT_UTCTIME CURRENT_UTCTIMESTAMP CURRVAL CURSOR DECLARE DISTINCT ELSE ELSEIF END EXCEPT EXCEPTION EXEC FALSE FOR FROM FULL GROUP HAVING IF IN INNER INOUT INTERSECT INTO IS JOIN LATERAL LEADING LEFT LIMIT LOOP MINUS NATURAL NCHAR NEXTVAL NULL ON ORDER OUT PRIOR RETURN RETURNS REVERSE RIGHT ROLLUP ROWID SELECT SESSION_USER SET SQL START SYSUUID TABLESAMPLE TOP TRAILING TRUE UNION UNKNOWN USING UTCTIMESTAMP VALUES WHEN WHERE WHILE WITH`.split(/\s+/);
const EXTRA_KW = `CURRENT_CONNECTION CURRENT_DATE CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP CURRENT_TRANSACTION_ISOLATION_LEVEL CURRENT_USER CURRENT_UTCDATE CURRENT_UTCTIME CURRENT_UTCTIMESTAMP SESSION_USER SYSUUID UTCTIMESTAMP SQLSCRIPT IMMEDIATE ROWS RANGE PRECEDING FOLLOWING UNBOUNDED NULLS FIRST LAST MATCHED ESCAPE ONLY SQLEXCEPTION SQLWARNING SQL_ERROR_CODE SQL_ERROR_MESSAGE SEQUENTIAL PARALLEL EXECUTION ATOMIC READ DATA CONSTANT OF AT TO NO NOT DETERMINISTIC ENCRYPTION HINT AFTER EACH STATEMENT OVERRIDING INSTEAD`.split(/\s+/);
['CE_COLUMN_TABLE','CE_JOIN_VIEW','CE_OLAP_VIEW','CE_CALC_VIEW','CE_JOIN','CE_LEFT_OUTER_JOIN','CE_RIGHT_OUTER_JOIN','CE_PROJECTION','CE_CALC','CE_AGGREGATION','CE_UNION_ALL','CE_VERTICAL_UNION','CE_CONVERSION','MAP_MERGE','MAP_REDUCE','APPLY_FILTER','BIND_AS_PARAMETER','BIND_AS_VALUE'].forEach(w => FUNCTIONS.add(w));
['REAL_VECTOR','HALF_VECTOR'].forEach(w => TYPES.add(w));
['SUBSTR_REGEXPR'].forEach(w => FUNCTIONS.add(w));
['OCCURRENCE'].forEach(w => KEYWORDS.add(w));
RESERVED.forEach(w => KEYWORDS.add(w));
['LIBRARY','SQLEXCEPTION','SQLWARNING'].forEach(w => KEYWORDS.add(w));
EXTRA_KW.forEach(w => KEYWORDS.add(w));
// words that must never lose their double quotes when "removeUnnecessary" is on
const PROTECT_EXTRA = `ARRAY AT BY CHECK COLLATE COMMIT CREATE CURRENT DEFAULT DELETE DESC DROP ESCAPE EXISTS FETCH FLOAT GRANT INSERT INTERVAL LIKE MERGE NO OF OFFSET ONLY OVER PARTITION PRIMARY RANGE REFERENCES REVOKE ROLLBACK ROW ROWS SESSION SOME SYSTEM THEN TO TRUNCATE UNIQUE UPDATE USER VALUE VIEW WINDOW WITHIN WITHOUT DATE TIME TIMESTAMP YEAR MONTH DAY HOUR MINUTE SECOND KEY INDEX TABLE COLUMN SCHEMA`.split(/\s+/);
const fmt = (name, arr) => {
  const a = [...new Set(arr)].sort();
  let lines = [], cur = '  ';
  for (const w of a) { const piece = `'${w}', `; if ((cur + piece).length > 100) { lines.push(cur.trimEnd()); cur = '  '; } cur += piece; }
  lines.push(cur.trimEnd());
  return `export const ${name}: ReadonlySet<string> = new Set([\n${lines.join('\n')}\n]);\n`;
};
let out = `// Generated from syntaxes/hanasql.tmLanguage.json and the SAP HANA SQL Reference
// (section "Reserved Words"). Keep in sync with the grammar when you add keywords.

`;
out += fmt('KEYWORDS', [...KEYWORDS]) + '\n';
out += fmt('FUNCTIONS', [...FUNCTIONS]) + '\n';
out += fmt('TYPES', [...TYPES]) + '\n';
out += fmt('RESERVED', RESERVED) + '\n';
out += fmt('PROTECTED', [...RESERVED, ...PROTECT_EXTRA, ...KEYWORDS, ...FUNCTIONS, ...TYPES]) + '\n';
out += fmt('SYSTEM_WORDS', ["ALTER", "ADD", "REMOVE", "ENABLE", "DISABLE", "CLEAR", "CREATE", "LOAD", "SAVE", "START", "STOP", "RECLAIM", "RECOMPILE", "RECONFIGURE", "REFRESH", "RESET", "APPLICATION", "ENCRYPTION", "AUDIT", "LOG", "CACHE", "COLUMN", "JOIN", "DATA", "STATISTICS", "INIFILE", "CONTENT", "HISTORY", "RESULT", "SQL", "PLAN", "TIMEZONE", "TRACES", "PERFTRACE", "LOB", "SPACE", "ENTRY", "SERVICE", "MONITORING", "VIEW", "SAVEPOINT", "TABLE", "PLACEMENT", "CONFIGURATION", "WAITGRAPH", "RUNTIMEDUMP", "KERNEL", "PROFILER", "ABSTRACT", "CAPTURE", "APPLY", "ASYNCHRONOUS", "CONSISTENCY", "CHECK", "ALL", "THREADS", "LOCATION", "FILE", "SECTIONS", "TRACEPROFILE", "PROFILE"]) + '\n';
out += fmt('STATEMENT_NOUNS', ["ANALYTIC", "AUDIT", "AUTOCOMMIT", "CERTIFICATE", "CLASS", "CREDENTIAL", "DATABASE", "DDL", "DELTA", "EXCHANGER", "FILTER", "FUNCTION", "FUZZY", "GRAPH", "GROUP", "INDEX", "JOB", "JWT", "KEY", "LDAP", "LIBRARY", "MAPPING", "MODEL", "POLICY", "PRIVILEGE", "PROCEDURE", "PROJECTION", "PROVIDER", "PSE", "PUBLIC", "REMOTE", "ROLEGROUP", "SAML", "SCHEDULER", "SCHEMA", "SEARCH", "SESSION", "SOURCE", "STATISTICS", "STRUCTURED", "SUBSCRIPTION", "SYNONYM", "TABLE", "TOKEN", "TRANSACTION", "USERGROUP", "VECTOR", "VIEW", "VIRTUAL", "WORKLOAD", "WORKSPACE", "X509"]);
fs.writeFileSync(require('path').join(__dirname, '..', 'src', 'formatter', 'keywords.ts'), out);
console.log(KEYWORDS.size, FUNCTIONS.size, TYPES.size);
