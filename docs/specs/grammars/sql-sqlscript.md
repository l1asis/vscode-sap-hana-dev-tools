# SAP HANA SQL, SQLScript, Vector, Spatial, Graph, Hierarchy, Series, JSON & Data Lake Grammar Specification (`sql-sqlscript.md`)

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/001_pages_1_30.md (Pages 1–1775)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_for_SAP_HANA_Platform/001_pages_1_30.md (Pages 1–1893)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference/001_pages_1_30.md (Pages 1–278)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQLScript_Reference_for_SAP_HANA_Platform/001_pages_1_30.md (Pages 1–287)

## 1. File Extensions & Scope Name

| File Extension | Language ID | TextMate Scope Name | Platform | Description |
| :--- | :--- | :--- | :--- | :--- |
| `.sql`, `.hanasql` | `hanasql` | `source.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | SAP HANA SQL, SQLScript, and Data Lake SQL scripts |
| `.hdbprocedure` | `hanasql` | `source.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Stored procedure (`PROCEDURE ...` or headerless HDI body) |
| `.hdbfunction`, `.hdbtablefunction`, `.hdbscalarfunction` | `hanasql` | `source.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Table or scalar User-Defined Function (`FUNCTION ...`) |
| `.hdbtrigger` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | Database trigger (`TRIGGER ...`) |
| `.hdblibrary` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | SQLScript shared or test library (`LIBRARY ...`) |
| `.hdbtable` (HDI DDL), `.hdbmigrationtable`, `.hdbvirtualtable` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI headerless `COLUMN TABLE`, `ROW TABLE`, `MIGRATION TABLE`, `VIRTUAL TABLE` DDL |
| `.hdbview` (HDI DDL), `.hdbresultcache` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI headerless `VIEW` and `RESULT CACHE` DDL |
| `.hdbsequence` (HDI DDL), `.hdbindex`, `.hdbfulltextindex`, `.hdbconstraint`, `.hdbstatistics` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI headerless `SEQUENCE`, `INDEX`, `FULLTEXT INDEX`, `CONSTRAINT`, `STATISTICS` DDL |
| `.hdbtabletype`, `.hdbstructuredprivilege`, `.hdbgraphworkspace`, `.hdbcollection`, `.hdbschedulerjob` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI `TYPE`, `STRUCTURED PRIVILEGE`, `GRAPH WORKSPACE`, `COLLECTION`, `SCHEDULER JOB` DDL |
| `.hdbcollectionindex`, `.hdbcollectionadjindex` | `hdbcollectionindex`, `hdbcollectionadjindex` | `source.hanasql` | `[CLOUD]` | Headerless Document Store collection index and adjacency index DDL (`HASH INDEX` / `BLOCK RANGE INDEX` / `ADJACENCY INDEX`) |
| `.hdbfabricvirtualtable` | `hdbfabricvirtualtable` | `source.hanasql` | `[CLOUD]` | Headerless Fabric Virtual Table shared replica DDL (`SHARED [SNAPSHOT] REPLICA [PAGE\|COLUMN LOADABLE] ON`) |
| `.hdbvirtualfunction`, `.hdbvirtualprocedure` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI Smart Data Integration virtual function and procedure DDL |
| `.hdbstructuredfilter` | `hdbstructuredfilter` | `source.hanasql` | `[HDI]` `[CLOUD]` | Headerless structured filter DDL (`STRUCTURED FILTER ... FOR SELECT ...`), plug-in `com.sap.hana.di.structuredfilter` (§4.11) |
| `.hdbremotetablereplica` | `hdbremotetablereplica` | `source.hanasql` | `[HDI]` `[CLOUD]` | Remote table replication, custom syntax `REMOTE TABLE REPLICA "<target>" ON "<virtual_table>"`, plug-in `com.sap.hana.di.remotetablereplica` (§4.11) |

Not SQL: `.hdbvirtualtableconfig` and `.hdbafllangprocedure` are JSON artifacts with their own grammars, and `.hdbsearchruleset` is XML (`docs/specs/grammars/hana-xml.md`).

---

## 2. Lexical Tokens

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/001_pages_1_30.md (Pages 20–30)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference/007_pages_181_210.md (Pages 181–204)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en/006_4_SQL_Reference.md (Comments, Identifiers)

| Token Class | Pattern / Delimiters | TextMate Scope | Platform | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Line Comment | `--[^\r\n]*` | `comment.line.double-dash.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | SQL `--` single-line comment. C-style `//` is **not** a SQL/SQLScript comment (the SQL Reference *Comments* section defines only `--` and `/* ... */`) and is reported as `HANA-SYN-005`. |
| Block Comment | `/\*[\s\S]*?\*/` | `comment.block.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Multi-line comment |
| Single-Quoted String | `[nN]?'(?:[^']\|'')*'` | `string.quoted.single.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | SQL string literal (`'...'` or Unicode `N'...'`) |
| Binary String Literal | `[xX]'[0-9A-Fa-f]*'` | `string.quoted.single.binary.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Hexadecimal binary literal (`X'01AF'`) |
| Typed Date/Time Literal | `(?i)\b(?:DATE\|TIME\|TIMESTAMP)\s*'(?:[^']\|'')*'` | `string.quoted.single.datetime.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | ANSI date/time/timestamp literal |
| Double-Quoted Identifier | `"(?:[^"]\|"")*"` | `variable.other.quoted-identifier.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Case-sensitive delimited identifier (`"ns::Table"`, `"Col"`) |
| JSON Root Path Identifier | `\$"(?:[^"]\|"")*"` or `\$(\.[A-Za-z_]\w*)+` | `variable.other.json-path.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | JSON Document Store root specifier (`$"address"."city"`) |
| SQLScript System Variable | `::(?i:ROWCOUNT\|SQL_ERROR_CODE\|SQL_ERROR_MESSAGE\|CURRENT_LINE_NUMBER\|CURRENT_OBJECT_NAME\|CURRENT_OBJECT_SCHEMA)\b` | `variable.language.system.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Built-in SQLScript `::` system variables |
| SQLScript Variable Reference | `:[A-Za-z_][A-Za-z0-9_$#]*` | `variable.other.sqlscript.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Bound scalar, table, or array variable (`:lt_data`, `:lv_id`) |
| SQLScript Inlining Hint | `#\[(?i:INLINE\|NO_INLINE)\]` | `keyword.control.directive.pragma.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Statement-level table variable inlining hint |
| SQLScript Pragma / Annotation | `@(?i:AnalyzerSuppress\|pushscope\|popscope\|Test\|TestSetUp\|TestTearDown\|TestSetUpTest\|TestTearDownTest\|TestSetUpConfig\|TestTearDownConfig\|TestSetUpLibrary\|TestTearDownLibrary\|TestClassification)\b` | `storage.type.annotation.pragma.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | SQLScript compiler pragmas and `SQLSCRIPT_TEST` annotations |
| Numeric Literal | `\b(?:0[xX][0-9A-Fa-f]+\|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b` | `constant.numeric.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Integer, decimal, float, or hex literal |
| Assignment & Named Parameter Operators | `:=`, `=>` | `keyword.operator.assignment.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | SQLScript assignment `:=` and named argument binding `=>` |
| Concatenation Operator | `\|\|` | `keyword.operator.concatenation.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | String or array concatenation |
| Comparison & Arithmetic Operators | `<>`, `!=`, `<=`, `>=`, `=`, `<`, `>`, `\+`, `-`, `\*`, `/`, `%` | `keyword.operator.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Relational and arithmetic operators (SQL Reference *Comparison Operators*: `=`, `>`, `<`, `>=`, `<=`, `!=`, `<>`; `~=` / `^=` are not supported) |
| Namespace / Library Member Accessor | `::`, `:` | `punctuation.separator.namespace.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Repository/HDI object separator `::` and SQLScript library member separator `alias:member` |
| Cursor Attribute | `<cursor>::(?i:ISCLOSED\|NOTFOUND\|ROWCOUNT)` | `variable.language.system.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Cursor state attributes (`c_cursor1::NOTFOUND`). Any other `<ident>::<ident>` name must be a delimited identifier (`"com.acme::tbl"`): undelimited identifiers contain only letters, digits, `_`, `#`, and `$`. |
| Punctuation | `(`, `)`, `[`, `]`, `{`, `}`, `,`, `;`, `.`, `..` | `punctuation.*.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.` separates name parts (`schema.table.column`, `:tv.col`, `t.*`); `..` separates `FOR i IN a..b` range bounds. |

**Character Set & Token Separation** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` (enforced by `HANA-SYN-005`, `HANA-SYN-006`, `HANA-SYN-024`):

```text
valid_char     ::= letter | digit | whitespace | "_" | "#" | "$" | "'" | '"' | "(" | ")" | "[" | "]" | "{" | "}"
                 | "," | ";" | "." | ":" | "?" | "+" | "-" | "*" | "/" | "%" | "=" | "<" | ">"
                 | "!=" | "||" | "@" sqlscript_pragma_name
                 (* any other character outside string literals, quoted identifiers and comments is invalid,
                    e.g. "&", "|", "\", "`", "!", "~", "^", typographic quotes, arrows, dashes *)
delimiter_tok  ::= string_literal | quoted_identifier | punctuation | operator
regular_tok    ::= identifier | keyword | numeric_literal
(* Adjacent regular_tok MUST be separated by whitespace or a comment: "123abc" is invalid, while "0x1F" is a
   hexadecimal literal. A delimiter_tok glued to a following identifier or literal ('s'AS, "T"alias) is
   lexically legal but almost always a typo, so it is reported as a warning. *)
```

---

## 3. Keywords & Built-ins

### 3.1 Official 88 SQL Reserved Words

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/001_pages_1_30.md (Pages 29–30)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en/006_4_SQL_Reference.md (Page 49)

```text
ALL, ALTER, AS, BEFORE, BEGIN, BOTH, CASE, CHAR, CONDITION, CONNECT, CROSS,
CUBE, CURRENT_CONNECTION, CURRENT_DATE, CURRENT_SCHEMA, CURRENT_TIME,
CURRENT_TIMESTAMP, CURRENT_TRANSACTION_ISOLATION_LEVEL, CURRENT_USER,
CURRENT_UTCDATE, CURRENT_UTCTIME, CURRENT_UTCTIMESTAMP, CURRVAL, CURSOR,
DECLARE, DISTINCT, ELSE, ELSEIF, END, EXCEPT, EXCEPTION, EXEC, FALSE, FOR,
FROM, FULL, GROUP, HAVING, IF, IN, INNER, INOUT, INTERSECT, INTO, IS, JOIN,
LATERAL, LEADING, LEFT, LIMIT, LOOP, MINUS, NATURAL, NCHAR, NEXTVAL, NULL,
ON, ORDER, OUT, PRIOR, RETURN, RETURNS, REVERSE, RIGHT, ROLLUP, ROWID,
SELECT, SESSION_USER, SET, SQL, START, SYSUUID, TABLESAMPLE, TOP, TRAILING,
TRUE, UNION, UNKNOWN, USING, UTCTIMESTAMP, VALUES, WHEN, WHERE, WHILE, WITH
```

*(Complete keyword catalog with categories, scopes, and platform tags is maintained in `docs/specs/catalogs/sql-keywords.json`. Complete built-in function and library catalog with signatures and return types is maintained in `docs/specs/catalogs/builtin-functions.json`.)*

**Functions without a reference chapter `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`:** The function groups also include functions that the references use or list without a chapter of their own. All are scoped only when followed by `(`:

- `support.function.conversion`: `TO_CHAR`, `TO_NCHAR` (SQL Reference, *Spatial Data Type Conversion*, explicit conversion list `TO_CHAR, TO_NCHAR, TO_VARCHAR, TO_NVARCHAR, TO_CLOB, TO_NCLOB, TO_BINARY, TO_VARBINARY`).
- `support.function.string`: `CHR` (`M_TOPOLOGY_TREE` example `'/index/' || CHR(1) || ...`).
- `support.function` (misc): `GET_NUM_SERVERS` (`PARTITION BY HASH (...) PARTITIONS { <num_partitions> | GET_NUM_SERVERS() }`).
- `support.function.sqlscript`: `RECORD_COUNT(<table_variable>)`, `IS_EMPTY(<table_variable>)` (SQLScript Reference, table variable operations).

### 3.2 Data Types Across Engines

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/002_pages_31_60.md (Pages 31–60)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Vector_Engine_Guide/006_REAL_VECTOR_and_HALF_VECTOR_Data_Types.md (Pages 5–6)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Spatial_Reference_en/005_3_Spatial_Data.md (Pages 18–47)

| Category | Types | Platform |
| :--- | :--- | :--- |
| Datetime | `DATE`, `TIME`, `SECONDDATE`, `TIMESTAMP`, `UTCTIMESTAMP`, `DATS`, `TIMS` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| Numeric | `TINYINT`, `SMALLINT`, `INTEGER`, `INT`, `BIGINT`, `SMALLDECIMAL`, `DECIMAL`, `DEC`, `REAL`, `DOUBLE`, `FLOAT`, `NUMERIC`, `NUMBER` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| Character String | `VARCHAR`, `NVARCHAR`, `ALPHANUM` (`[XSC]` `[XSA]` `[HDI]`), `SHORTTEXT` (`[XSC]` `[XSA]` `[HDI]`), `CHAR`, `NCHAR`, `CLOB`, `NCLOB`, `TEXT` (`[XSC]` `[XSA]` `[HDI]`), `BINTEXT` (`[XSC]` `[XSA]` `[HDI]`), `STRING` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| Binary | `BINARY`, `VARBINARY`, `BLOB`, `RAW` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| Boolean | `BOOLEAN`, `BOOL` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| Document Store | `JSON` | `[CLOUD]` |
| Vector Engine | `REAL_VECTOR` (`REAL_VECTOR[(<n>)]`, `1..65000`), `HALF_VECTOR` (`HALF_VECTOR[(<n>)]`, `1..65000`) | `[CLOUD]` |
| Spatial | `ST_GEOMETRY`, `ST_POINT`, `ST_CURVE`, `ST_LINESTRING`, `ST_CIRCULARSTRING`, `ST_SURFACE`, `ST_POLYGON`, `ST_GEOMETRYCOLLECTION`, `ST_MULTIPOINT`, `ST_MULTICURVE`, `ST_MULTILINESTRING`, `ST_MULTISURFACE`, `ST_MULTIPOLYGON`, `ST_POINTZ`, `ST_POINTM`, `ST_POINTZM` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| SQLScript / GraphScript | `TABLE (...)`, `ROW (...)`, `ROW LIKE <type>`, `<type> ARRAY`, `CURSOR`, `CONDITION`, `GRAPH`, `VERTEX`, `EDGE`, `WEIGHTEDPATH`, `MULTISET`, `SEQUENCE`, `SQLSCRIPT_STATEMENT_STATISTICS_TYPE`, `SQLSCRIPT_LOGGING_TABLE_TYPE` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |

### 3.3 Built-In `SYS.SQLSCRIPT_*` Libraries

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference/007_pages_181_210.md (Pages 205–270)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/014_12_Built-In_Libraries.md (Pages 247–316)

| Library (`SYS.<name>`) | Public Members (Procedures, Functions, Constants) | Platform |
| :--- | :--- | :--- |
| `SQLSCRIPT_SYNC` | `SLEEP_SECONDS`, `WAKEUP_CONNECTION` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `SQLSCRIPT_STRING` | `SPLIT`, `SPLIT_TO_TABLE`, `SPLIT_TO_ARRAY`, `SPLIT_REGEXPR`, `SPLIT_REGEXPR_TO_TABLE`, `SPLIT_REGEXPR_TO_ARRAY`, `FORMAT`, `FORMAT_TO_TABLE`, `FORMAT_TO_ARRAY`, `TABLE_SUMMARY` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `SQLSCRIPT_PRINT` | `PRINT_LINE`, `PRINT_TABLE` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `SQLSCRIPT_LOGGING` | Constants: `LEVEL_FATAL`, `LEVEL_ERROR`, `LEVEL_WARNING`, `LEVEL_INFO`, `LEVEL_DEBUG`; Procedures: `CREATE_CONFIGURATION`, `DROP_CONFIGURATION`, `SET_OUTPUT_TABLE`, `SET_LEVEL`, `START_LOGGING`, `STOP_LOGGING`, `ADD_SQLSCRIPT_OBJECT`, `REMOVE_SQLSCRIPT_OBJECT`, `SET_FILTER`, `ADD_FILTER`, `REMOVE_FILTER`, `UNSET_FILTER`, `LOG` | `[XSA]` `[HDI]` `[CLOUD]` |
| `SQLSCRIPT_TEST` | `LIST_TESTS`, `LIST_CONFIGURATIONS`, `EXPECT_EQ`, `EXPECT_NE`, `EXPECT_GE`, `EXPECT_GT`, `EXPECT_LE`, `EXPECT_LT`, `EXPECT_NULL`, `EXPECT_TABLE_EQ`, `FAIL` (plus runner `SYS.SQLSCRIPT_RUN_TESTS_ON_ORIGINAL_DATA`) | `[XSA]` `[HDI]` `[CLOUD]` |

### 3.4 Context-Aware Keyword Scopes `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_for_SAP_HANA_Platform/001_pages_1_30.md (Reserved Words)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide/010_HIERARCHY_Generator_Function.md (Pages 8–57)

Only the 88 reserved words (§3.1) are keywords in every position. Non-reserved words such as `RANGE`, `DATA`, `FIRST`, `SOURCE` or `MATCHED` are valid unquoted column and table names, so `source.hanasql` scopes them only where they act as keywords. The word lists come from the catalog (`docs/specs/catalogs/sql-keywords.json`, `SPEC_RULES.md` §C.1). The phrases are in `scripts/lib/hanasql-grammar.js` (`CLAUSE_PHRASES`).

| Mechanism | Repository item | Scope | Applies to |
| :--- | :--- | :--- | :--- |
| Everywhere | `#logical-operators` | `keyword.other.logical.hanasql` | Role `word-operator` (`AND`, `OR`, `NOT`, `IN`, `IS`, `LIKE`, `BETWEEN`, `EXISTS`, `CONTAINS`, ...) |
| Everywhere | `#keywords` | `keyword.other.preposition.hanasql` | Role `preposition`: `TO`, `AT`, `OF` (`GRANT ... TO`, `RENAME ... TO`, `FROM 1 TO 2`, `AT LOCATION`, `INSTEAD OF`, `WHERE CURRENT OF`) |
| Region | `#hierarchy-call` | `keyword.other.clause.hanasql` | Roles `hierarchy-clause` and `hierarchy-option` inside `HIERARCHY*( ... )` (names: role `hierarchy-clause-function`). `#parens` balances nested `(...)`, so the region ends at the call's own `)`. Words may sit on different lines (`SIBLING` / `ORDER BY`) |
| Phrase | `#clause-phrases` | `keyword.other.clause.hanasql` | A word next to a fixed neighbour, one regex on one line (table below) |

**Word operators** use `keyword.other.logical.hanasql`, not `keyword.operator.logical.hanasql`. The default VS Code themes give `keyword.operator.*` the plain operator colour (the same as `=`), so stacked `WHERE ... AND ... AND ...` conditions looked unhighlighted. `keyword.operator.wordlike` is coloured by Dark+ and Light+ but not by High Contrast Dark. `keyword.other.*` gets the keyword colour in all ten default themes (Dark / Light Modern, Dark+ / Light+, Dark / Light VS, High Contrast Dark / Light, 2026 Dark / Light).

**Clause phrases** (`(?i)`; the whole match is scoped unless noted):

| Context | Phrases |
| :--- | :--- |
| Partitioning | `[SUB]PARTITION BY RANGE\|HASH\|ROUNDROBIN`, `RANGE\|HASH\|ROUNDROBIN` before `(` |
| Window frame | `ROWS\|RANGE` before `BETWEEN\|UNBOUNDED\|CURRENT\|<digit>`, `UNBOUNDED PRECEDING\|FOLLOWING`, `<n> PRECEDING\|FOLLOWING` (`<n>` keeps `constant.numeric`), `CURRENT ROW` |
| Null ordering | `NULLS FIRST\|LAST`, `IGNORE\|RESPECT NULLS` |
| Hints | `WITH HINT`, `STATEMENT HINT`, `HINT` before `(`, `STATEMENT` before `HINT\|HASH` |
| `MERGE` | `WHEN [NOT] MATCHED` |
| Triggers | `BEFORE\|AFTER INSERT\|UPDATE\|DELETE`, `INSTEAD OF`, `FOR EACH ROW\|STATEMENT`, `REFERENCING NEW\|OLD ROW\|TABLE` |
| Dynamic SQL | `EXEC[UTE] IMMEDIATE`, `IMMEDIATE` before `;` |
| Transactions, routines | `ISOLATION LEVEL`, `READ ONLY\|WRITE\|COMMITTED\|UNCOMMITTED`, `READS\|MODIFIES SQL DATA`, `HEADER\|DDL ONLY` |
| Table data | `WITH [NO] DATA` (not before `(` or `AS`: a CTE named `data`), `IMPORT\|EXPORT DATA`, `[VALID] FOR DATA DEPENDENCY`, `DELETE\|PRESERVE ROWS` |
| Predicates | `ESCAPE` before `'` |
| Import | `SKIP FIRST`, `FIRST ROW` |
| Sequences | `INCREMENT BY`, `RESET BY`, `NO CYCLE\|MINVALUE\|MAXVALUE`, `MINVALUE\|MAXVALUE` before a number |
| `NO` option | `NO` before a word that is not a `non-alias` or `word-operator` word (`NO PRIMARY KEY`, `NO FORCE_FIRST_PASSWORD_CHANGE`, but not `no FROM`, `no IS NULL`) |
| Administration | `WITH RECONFIGURE`, `EXPLAIN PLAN`, `SERIES TABLE`, `ENABLE\|DISABLE PARAMETER SET`, `IP\|APPLICATION` before `(` (`CONNECT RESTRICTION`) |

**Limits:** a phrase does not match across a line break (`NULLS` at the end of one line, `LAST` on the next). Anywhere else, a bare `range`, `data`, `first`, `source` or `no` stays unscoped. Other non-reserved words that are keywords only in specific statements (`CACHE`, `CREDENTIAL`, `LOCATION`, ...) are not covered yet. The conformance sweep lists them (`docs/research/CONFORMANCE.md`).

---

## 4. Formal EBNF Grammar

### 4.1 SQLScript Procedures, Functions, Libraries & Imperative Constructs

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference/002_pages_31_60.md (Pages 31–270)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md (CREATE / ALTER PROCEDURE, CREATE / ALTER FUNCTION, User-Defined Libraries)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en/006_4_SQL_Reference.md (CREATE PROCEDURE Statement, `READS SQL DATA WITH RESULT VIEW`)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/026_pages_751_780.md (CREATE TRIGGER Statement)

Header clauses `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` are accepted in any order before `AS` by the consuming header parser (`src/analyzer/sql-header.ts`); the canonical order below is enforced only where `HANA-SYN-028` says so (`RETURNS` first on functions). Block modifiers (`SEQUENTIAL EXECUTION`, `PARALLEL EXECUTION`, `AUTONOMOUS TRANSACTION`) belong after `BEGIN`, never in the header. Every token from the header start through `AS` -> `{ using_library_decl }` -> `BEGIN` (or `HEADER ONLY`) must be consumed by these productions (`HANA-SYN-040`).

```ebnf
(* 1. Procedure Definition (Catalog DDL & HDI Headerless .hdbprocedure) *)
procedure_stmt ::=
    [ "CREATE" [ "OR" "REPLACE" ] | "ALTER" ] "PROCEDURE" object_name
    [ "(" [ proc_param { "," proc_param } ] ")" ]
    [ "LANGUAGE" ( "SQLSCRIPT" | "GRAPH" | "R" | "RLANG" | "AFLLANG" ) ]
    [ "SQL" "SECURITY" ( "DEFINER" | "INVOKER" ) ]
    [ "DEFAULT" "SCHEMA" schema_name ]
    [ "READS" "SQL" "DATA" [ "WITH" "RESULT" "VIEW" view_name ] ]
    [ variable_cache_clause ]
    [ "DETERMINISTIC" ]
    [ "WITH" "ENCRYPTION" ]
    [ "AUTOCOMMIT" "DDL" ( "ON" | "OFF" ) ]
    "AS"
    { using_library_decl }
    ( proc_block | "HEADER" "ONLY" ) ;

alter_routine_mgmt ::=                                   (* option-only / management forms, no body *)
    "ALTER" ( "PROCEDURE" | "FUNCTION" ) object_name
    ( "RECOMPILE" ... | "ENCRYPTION" "ON" | ( "ADD" | "DROP" ) variable_cache_clause
    | [ "NO" ] "STRUCTURED" "FILTER" "CHECK" ) ";" ;

proc_param ::=
    [ "IN" | "OUT" | "INOUT" ] identifier ( param_type | "TABLE" "(" column_def_list ")" | " TABLE (...)" )
    [ "DEFAULT" ( expression | "EMPTY" ) ] ;

variable_cache_clause ::=
    "VARIABLE" "CACHE" "ON" variable_entry [ ( "ENABLE" | "DISABLE" | "AUTOMATIC" ) ]
    { "," variable_entry [ ( "ENABLE" | "DISABLE" | "AUTOMATIC" ) ] } ;
variable_entry ::= identifier | "(" identifier { "," identifier } ")" ;

using_library_decl ::=
    "USING" [ "SYS" "." ] identifier "AS" identifier ";" ;

(* 2. User-Defined Function Definition (.hdbfunction, .hdbtablefunction, .hdbscalarfunction) *)
function_stmt ::=
    [ "CREATE" [ "OR" "REPLACE" ] | "ALTER" ] "FUNCTION" object_name
    [ "(" [ func_param { "," func_param } ] ")" ]
    "RETURNS" ( "TABLE" "(" column_def_list ")" | return_scalar_list )   (* optional on ALTER *)
    [ "LANGUAGE" ( "SQLSCRIPT" | "GRAPH" ) ]
    [ "SQL" "SECURITY" ( "DEFINER" | "INVOKER" ) ]
    [ "DEFAULT" "SCHEMA" schema_name ]
    [ "READS" "SQL" "DATA" ]
    [ variable_cache_clause ]
    [ "DETERMINISTIC" ]
    [ "WITH" "ENCRYPTION" ]
    [ [ "NO" ] "STRUCTURED" "FILTER" "CHECK" ]
    "AS"
    { using_library_decl }
    ( [ "HEADER" "ONLY" "ON" "INVALID" ] proc_block [ cache_clause ] | "HEADER" "ONLY" ) ;

return_scalar_list ::= [ identifier ] sql_type [ "ARRAY" ] { "," [ identifier ] sql_type [ "ARRAY" ] } ;
cache_clause ::= "WITH" [ "STATIC" ] "CACHE" [ "NAME" identifier ] [ "RETENTION" unsigned_integer ]
                 [ "OF" projection_list ] [ "FILTER" condition ] ;     (* after END, table UDFs only *)

(* 2b. Virtual routines [HDI] [CLOUD] (.hdbvirtualprocedure, .hdbvirtualfunction): remote adapter options
   such as "CONFIGURATION" string_literal and "AT" remote_location are accepted; other adapter-specific
   options are not validated. *)
virtual_routine ::=
    [ "CREATE" [ "OR" "REPLACE" ] ] "VIRTUAL" ( "PROCEDURE" | "FUNCTION" ) object_name
    [ "(" param_list ")" ] [ "RETURNS" ... ] { routine_option | "CONFIGURATION" string_literal | "AT" object_name }
    [ "AS" ( proc_block | "HEADER" "ONLY" ) ] ;

(* 3. SQLScript Shared & Test Library Definition (.hdblibrary) *)
library_stmt ::=
    [ "CREATE" [ "OR" "REPLACE" ] | "ALTER" ] "LIBRARY" object_name
    [ "LANGUAGE" "SQLSCRIPT" ]
    [ "TEST" ]
    [ "DEFAULT" "SCHEMA" schema_name ]
    "AS" "BEGIN"
        { [ "PUBLIC" | "PRIVATE" ] ( variable_decl | procedure_member | function_member ) }
    "END" ;
(* System documentation shows SYS.SQLSCRIPT_* signatures as "AS BUILTIN [BEGIN ... END]"; accepted, not user syntax. *)

(* 3b. Trigger Definition (.hdbtrigger) — no "AS" *)
trigger_stmt ::=
    [ "CREATE" [ "OR" "REPLACE" ] ] "TRIGGER" object_name
    ( "BEFORE" | "AFTER" | "INSTEAD" "OF" )
    trigger_event { "OR" trigger_event }
    "ON" object_name
    [ "REFERENCING" transition { "," transition } ]
    [ "FOR" "EACH" ( "ROW" | "STATEMENT" ) ]
    [ ( "FOLLOWS" | "PRECEDES" ) object_name { "," object_name } ]
    [ "ONLINE" ]
    proc_block ;
trigger_event ::= "INSERT" | "DELETE" | "UPDATE" [ [ "EXCEPT" ] "OF" identifier { "," identifier } ] ;
transition ::= ( "OLD" | "NEW" ) ( "ROW" | "TABLE" ) [ "AS" ] identifier ;

(* 3c. Anonymous Block *)
do_block ::= "DO" [ "(" param_list ")" ] proc_block ;

(* 4. SQLScript Block & Statements *)
proc_block ::=
    "BEGIN" [ "SEQUENTIAL" "EXECUTION" | "PARALLEL" "EXECUTION" | "AUTONOMOUS" "TRANSACTION" ]
        { declare_stmt }
        { sqlscript_stmt }
        [ exception_handler ]
    "END" [ ";" ] ;

declare_stmt ::=
    "DECLARE"
    ( identifier [ "," identifier ] [ "CONSTANT" ] data_type [ "NOT" "NULL" ] [ ( ":=" | "=" | "DEFAULT" ) expression ]
    | identifier "CURSOR" [ "FOR" select_stmt ]
    | identifier "CONDITION" [ "FOR" "SQL_ERROR_CODE" unsigned_integer ]
    | "EXIT" "HANDLER" "FOR" condition_value { "," condition_value } sqlscript_stmt
    | "CONTINUE" "HANDLER" "FOR" condition_value { "," condition_value } sqlscript_stmt
    ) ";" ;

sqlscript_stmt ::=
    [ "#[INLINE]" | "#[NO_INLINE]" ]
    ( assignment_stmt
    | select_into_stmt
    | if_stmt
    | case_stmt
    | while_stmt
    | loop_stmt
    | for_stmt
    | cursor_stmt
    | signal_resignal_stmt
    | dynamic_sql_stmt
    | sql_statistics_stmt
    | call_stmt
    | return_stmt
    | dml_or_ddl_stmt
    | proc_block
    ) ;

if_stmt ::=
    "IF" condition "THEN" { sqlscript_stmt }
    { "ELSEIF" condition "THEN" { sqlscript_stmt } }
    [ "ELSE" { sqlscript_stmt } ]
    "END" "IF" ";" ;

for_stmt ::=
    "FOR" identifier "IN" [ "REVERSE" ] expression ".." expression "DO"
        { sqlscript_stmt }
    "END" "FOR" ";"
    | "FOR" identifier "AS" identifier [ "(" param_list ")" ] "DO"
        { sqlscript_stmt }
    "END" "FOR" ";" ;

sql_statistics_stmt ::=
    "WITH" "SQL" "STATISTICS" "INTO" identifier "DO" sqlscript_stmt ;
```

### 4.2 Vector Engine DDL & Query Clauses `[CLOUD]`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Vector_Engine_Guide/019_CREATE_VECTOR_INDEX_Statement_(Data_Definition).md (Pages 12–49)

```ebnf
vector_type ::=
    ( "REAL_VECTOR" | "HALF_VECTOR" ) [ "(" unsigned_integer ")" ] ;

create_vector_index_stmt ::=
    "CREATE" "HNSW" "VECTOR" "INDEX" index_name "ON" table_name "(" column_name ")"
    "SIMILARITY" "FUNCTION" ( "COSINE_SIMILARITY" | "L2DISTANCE" )
    [ "BUILD" "CONFIGURATION" json_string ]
    [ "SEARCH" "CONFIGURATION" json_string ]
    [ "ONLINE" ] ;

alter_vector_index_stmt ::=
    "ALTER" "INDEX" index_name "SEARCH" "CONFIGURATION" json_string ;
```

### 4.3 Spatial Clustering & SRS DDL

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Spatial_Reference_en/007_5_Spatial_Clustering.md (Pages 287–335)

```ebnf
spatial_cluster_clause ::=
    [ "GROUP" ] "CLUSTER" "BY" column_name "USING" cluster_algorithm ;

cluster_algorithm ::=
    "KMEANS" "CLUSTERS" unsigned_integer [ "ITERATIONS" unsigned_integer ] [ "THRESHOLD" number ]
    | "DBSCAN" "EPS" number "MINPTS" unsigned_integer
    | "GRID" [ "X" "BETWEEN" number "AND" number ] "CELLS" unsigned_integer
             [ "Y" "BETWEEN" number "AND" number ] "CELLS" unsigned_integer
    | "HEXAGON" [ "X" "BETWEEN" number "AND" number ] [ "Y" "BETWEEN" number "AND" number ] "CELLS" unsigned_integer
    | "INTERSECTION" ;
```

### 4.4 Property Graph, OpenCypher & Knowledge Graph (`SPARQL_TABLE` / `SPARQL_EXECUTE`)

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Property_Graph_Engine_Refe/001_pages_1_30.md (Pages 3–40)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Knowledge_Graph_Engine_Gui/022_SQL_Interface.md (Pages 23–33)

```ebnf
create_graph_workspace_stmt ::=
    [ "CREATE" [ "OR" "REPLACE" ] ] "GRAPH" "WORKSPACE" workspace_name
    ( edge_and_vertex_tables_spec [ graph_cache_spec ]
    | "ADJACENCY" "INDEX" object_name
    | "COLLECTION" object_name graph_collection_fields_spec
    ) ;

edge_and_vertex_tables_spec ::=
    "EDGE" "TABLE" table_name
        "SOURCE" [ "COLUMN" ] column_list [ "REFERENCES" table_name ]
        "TARGET" [ "COLUMN" ] column_list [ "REFERENCES" table_name ]
        "KEY" [ "COLUMN" ] column_list [ "LABEL" string_literal ]
    "VERTEX" "TABLE" table_name
        "KEY" [ "COLUMN" ] column_list [ "LABEL" string_literal ] ;

graph_cache_spec ::=
    "WITH" "DYNAMIC" "CACHE"
    | "NO" "CACHE"
    | "WITH" "STATIC" "CACHE" "RETENTION" unsigned_integer ;

opencypher_table_call ::=
    "OPENCYPHER_TABLE" "("
        "GRAPH" "WORKSPACE" workspace_name
        "QUERY" string_literal
        [ "PARAMETERS" "(" named_param_list ")" ]
    ")" ;

sparql_table_call ::=
    "SPARQL_TABLE" "(" string_literal [ "," string_literal ] ")" ;
```

### 4.5 Hierarchy Generator & Navigation Functions `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide/010_HIERARCHY_Generator_Function.md
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide/011_HIERARCHY_SPANTREE_Generator_Function.md
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide/012_HIERARCHY_TEMPORAL_Generator_Function.md
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide/013_HIERARCHY_LEVELED_Generator_Function.md
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide/020_HIERARCHY_DESCENDANTS_Navigation_Function.md … 024_HIERARCHY_ANCESTORS_AGGREGATE_Navigation_Function.md

The nine clause-syntax functions are table functions: they appear where a `FROM` / `JOIN` table reference can, and as the `SOURCE` of another hierarchy function. Their clauses are separated by spaces, not commas. `HIERARCHY_COMPOSITE_ID(a, b, ...)` is an ordinary scalar function and is not covered here.

```ebnf
hierarchy_call     ::= hierarchy_function "(" source_spec { hierarchy_clause } ")" ;
hierarchy_function ::= "HIERARCHY" | "HIERARCHY_SPANTREE" | "HIERARCHY_TEMPORAL" | "HIERARCHY_LEVELED"
                     | "HIERARCHY_DESCENDANTS" | "HIERARCHY_ANCESTORS" | "HIERARCHY_SIBLINGS"
                     | "HIERARCHY_DESCENDANTS_AGGREGATE" | "HIERARCHY_ANCESTORS_AGGREGATE" ;

source_spec        ::= "SOURCE" table_valued_expr ;
table_valued_expr  ::= table_ref [ [ "AS" ] alias ]        (* name, "V"(params), :table_variable *)
                     | "(" query ")"
                     | hierarchy_call ;

hierarchy_clause   ::= "START" ( "WHERE" condition | table_valued_expr )
                     | "SIBLING" "ORDER" "BY" order_item { "," order_item }
                     | "LEVELS" "(" column_name { "," column_name } ")"
                     | "VALID" ( "FROM" expression [ "EXCLUDED" ] "UNTIL" expression [ "EXCLUDED" ]
                               | "AT" expression [ "FROM" "EXCLUDED" ] [ "UNTIL" "EXCLUDED" ] )
                     | "DEPTH" integer
                     | "MULTIPARENT" [ "ERROR" | "LEAVES" ]
                     | "ORPHAN" ( "IGNORE" | "ERROR" | "ADOPT" | "ROOT" )
                     | "CYCLE" ( "BREAKUP" | "ERROR" )
                     | "CACHE" [ "FORCE" | string_literal ]     (* 'on' | 'off' | 'force' *)
                     | "NO" "CACHE"
                     | "LOAD" ( "BULK" | "INCREMENTAL" | string_literal )   (* 'bulk' | 'incremental' *)
                     | "RETAIN" "NULLS" string_literal         (* 'none' | 'not trailing' | 'all' *)
                     | "DISTANCE" ( [ "FROM" expression ] [ "TO" expression ] | expression )
                     | "JOIN" table_valued_expr "ON" condition
                     | "MEASURES" "(" measure_item { "," measure_item } ")"
                     | "WHERE" condition
                     | "WITH" ( "SUBTOTAL" | "BALANCE" | "NOT" "MATCHED" | "TOTAL" ) [ expression ] ;
order_item         ::= expression [ "ASC" | "DESC" ] [ "NULLS" ( "FIRST" | "LAST" ) ] ;
measure_item       ::= aggregate_name "(" [ "DISTINCT" | "ALL" ] ( expression | "*" ) [ "," expression ] ")" [ "AS" alias ] ;
integer            ::= [ "+" | "-" ] unsigned_integer | "?" | ":" variable ;
```

Clauses per function (documented order; `*` = required by the reference):

| Function | Clauses after `SOURCE` |
| :--- | :--- |
| `HIERARCHY` | `START WHERE`, `SIBLING ORDER BY`\*, `DEPTH`, `MULTIPARENT`, `ORPHAN`, `CYCLE`, `CACHE`, `LOAD` |
| `HIERARCHY_SPANTREE` | `START WHERE`, `SIBLING ORDER BY`\*, `DEPTH`, `CACHE`, `LOAD` |
| `HIERARCHY_TEMPORAL` | `START WHERE`, `SIBLING ORDER BY`\*, `VALID`\*, `DEPTH`, `MULTIPARENT`, `CYCLE`, `CACHE`, `LOAD` |
| `HIERARCHY_LEVELED` | `LEVELS`, `SIBLING ORDER BY`\*, `CACHE`, `RETAIN NULLS` |
| `HIERARCHY_DESCENDANTS`, `HIERARCHY_ANCESTORS` | `START`, `DISTANCE` |
| `HIERARCHY_SIBLINGS` | `START` |
| `HIERARCHY_DESCENDANTS_AGGREGATE` | `JOIN ... ON`, `MEASURES`\* `[WHERE]`, `WITH SUBTOTAL`, `WITH BALANCE`, `WITH NOT MATCHED`, `WITH TOTAL` |
| `HIERARCHY_ANCESTORS_AGGREGATE` | `START`, `MEASURES`\* `[WHERE]` |

Not syntax, despite appearing in older examples: `DEPTH FIRST` (`DEPTH` takes an integer; traversal is always depth-first) and `LOAD BY <column>` (`LOAD` takes `BULK`, `INCREMENTAL` or a string).

**Analyzer** (`src/analyzer/sql-clauses.ts`, `HANA-SYN-021` / `HANA-SYN-042`): the consuming parser accepts the clauses above in any order and in any of the nine functions. SAP HANA itself rejects a clause the function does not take, or a missing required clause, with a precise run-time message, so the parser does not repeat the table check. It validates:

- every word in a clause-keyword slot (after `(`, after each complete clause, after an option word) against the clause keywords, and every option slot (`ORPHAN`, `CYCLE`, `MULTIPARENT`, `CACHE`, `LOAD`, `WITH`) against its options;
- the conditions after `START WHERE`, `WHERE` and `JOIN ... ON`, and the expressions of `DISTANCE`, `VALID` and `WITH ...`, with the Pratt expression parser. A condition ends at the next clause keyword, but only after a complete operand, so `START WHERE depth = 1` keeps `depth` as a column;
- `SOURCE` / `START` / `JOIN` subqueries with the query parser.

**Formatter** (`src/formatter/formatter.ts`): the call's `(` ends the line, each clause starts its own line one level deeper, and `)` returns to the call's level. Clause keywords and option words are cased as keywords only in clause / option position, so `START WHERE depth = 1` keeps `depth` as an identifier:

```sql
SELECT *
FROM HIERARCHY(
    SOURCE (
        SELECT node_id, parent_id
        FROM t
    )
    START WHERE parent_id IS NULL
    SIBLING ORDER BY node_id
    ORPHAN ROOT
    CYCLE BREAKUP
)
ORDER BY hierarchy_rank;
```

**Highlighting:** `SOURCE`, `DEPTH`, `CACHE`, `DISTANCE`, `ORPHAN ROOT`, ... are keywords only between the call's parentheses (`#hierarchy-call`, §3.4). The same words used as columns elsewhere stay unscoped.

### 4.6 JSON Document Store DDL, DML & Functions `[XSA]` `[HDI]` `[CLOUD]`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_JSON_Document_Store_Guide/023_CREATE_COLLECTION_Statement.md (Pages 26–68)

```ebnf
create_collection_stmt ::=
    [ "CREATE" ] "COLLECTION" [ "TABLE" ] collection_name
    [ "JSON" "SCHEMA" string_literal ]
    [ "RETURNING" ( "NVARCHAR" | "JSON" ) ] ;

alter_collection_stmt ::=
    "ALTER" "COLLECTION" [ "TABLE" ] collection_name
    ( "CHECKPOINT" [ "FULL" ]
    | "SET" "JSON" "SCHEMA" string_literal
    | "DROP" "JSON" "SCHEMA"
    | "RETURNING" ( "NVARCHAR" | "JSON" )
    ) ;

create_collection_index_stmt ::=
    "CREATE" ( [ "HASH" ] | "BLOCK" "RANGE" ) "INDEX" index_name "ON" collection_name "(" json_path ")"
    | "CREATE" "ADJACENCY" "INDEX" index_name "ON" collection_name
      "(" "ID" identifier "," "SOURCE" identifier "," "TARGET" identifier "," "TYPE" identifier ")" ;
```

### 4.7 Series Data Clauses & Functions `[XSC]` `[XSA]` `[HDI]`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Series_Data_Developer_Guide_en/005_3_Quick_Reference_Series_Data_SQL_Support_and_System_Views.md (Pages 6–26)

```ebnf
series_table_clause ::=
    "SERIES" "("
        [ "SERIES" "KEY" "(" column_list ")" ]
        [ "NOT" "EQUIDISTANT"
        | "EQUIDISTANT" [ "PIECEWISE" ]
          [ "INCREMENT" "BY" series_interval ]
          [ "MISSING" "ELEMENTS" [ "NOT" ] "ALLOWED" ]
        ]
        [ "MINVALUE" literal ]
        [ "MAXVALUE" literal ]
        "PERIOD" "FOR" "SERIES" "(" column_name [ "," column_name ] ")"
    ")" ;
```

### 4.10 Headerless Document Store Collection Indexes & Fabric Virtual Tables `[CLOUD]`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/007_pages_211_245.md (Pages 222–228)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_JSON_Document_Store_Guide/030_CREATE_HASH_INDEX_Statement.md (Pages 33–33)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_JSON_Document_Store_Guide/031_CREATE_BLOCK_RANGE_INDEX_Statement.md (Pages 34–35)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_JSON_Document_Store_Guide/032_CREATE_ADJACENCY_INDEX_Statement.md (Pages 36–36)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/020_pages_571_600.md (Pages 580–585)

```ebnf
collection_index_artifact ::=
    ( "HASH" | "BLOCK" "RANGE" ) "INDEX" identifier "ON" collection_name "(" path_expression ")" ;

collection_adj_index_artifact ::=
    "ADJACENCY" "INDEX" identifier "ON" collection_name
    "(" "ID" adj_field "," "SOURCE" adj_field "," "TARGET" adj_field "," "TYPE" adj_field ")" ;

fabric_virtual_table_artifact ::=
    "SHARED" [ "SNAPSHOT" ] "REPLICA" [ ( "PAGE" | "COLUMN" ) "LOADABLE" ] "ON" virtual_table_name ;
```

- Leading keywords `HASH`, `BLOCK`, `ADJACENCY`, and `SHARED` are root-level HDI artifact headers (no `CREATE` prefix and no root trailing semicolon appended).

### 4.11 Headerless Structured Filters & Remote Table Replications `[HDI]` `[CLOUD]`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/009_pages_241_270.md (Pages 241–270: *Remote Table Replications*, *Structured Filters*)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/024_pages_691_720.md (Pages 691–720: *CREATE STRUCTURED FILTER Statement*)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/015_pages_421_450.md (Pages 421–450: *ALTER STRUCTURED FILTER Statement*)

Neither artifact is in the on-premise HDI references (`SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_*`), and neither statement is in the on-premise SQL references: both are SAP HANA Cloud only.

**`.hdbstructuredfilter`**: the `CREATE STRUCTURED FILTER` statement without the leading `CREATE`, plus a wildcard object list that only the HDI plug-in accepts. The filtered views must be defined `WITH STRUCTURED FILTER CHECK`.

```ebnf
structured_filter_artifact ::=
    "STRUCTURED" "FILTER" filter_name
    "FOR" "SELECT"
    [ "ON" object_name { "," object_name } ]
    [ wildcard_objects ]                                  (* [HDI] plug-in only, not in CREATE STRUCTURED FILTER *)
    filter_condition ;

filter_name          ::= [ schema_name "." ] identifier ;
object_name          ::= [ schema_name "." ] identifier ;

wildcard_objects     ::= [ "ESCAPE" single_char_string ]
                         "LIKE" wildcard_object { "," wildcard_object }
                         [ "NOT" "LIKE" wildcard_object { "," wildcard_object } ] ;
wildcard_object      ::= quoted_identifier ;              (* schema-local, wildcards '%' and '_' *)

filter_condition     ::= static_filter_condition | dynamic_filter_condition ;
static_filter_condition  ::= "WHERE" condition ;
dynamic_filter_condition ::= "CONDITION" "PROVIDER" [ schema_name "." ] identifier ;   (* a procedure *)
```

- Without an `ON` list or `LIKE` list the filter has no effect. It can serve as a placeholder that is granted before the objects exist.
- `LIKE a, b` / `NOT LIKE c, d` select the views `(a OR b) AND NOT (c OR d)`. `NOT LIKE` requires a `LIKE` list.
- A `wildcard_object` is double-quoted and schema-local: `"someSchema"."V%1"` is not allowed.
- `ESCAPE '\'` makes `\_` and `\%` match a literal `_` and `%`.

```sql
STRUCTURED FILTER USER_DATA_VIEW_FILTER_WILDCARD
FOR SELECT ON USER_DATA_VIEW
ESCAPE '\'
LIKE "USER\_Data\_VIEW1%", "USER\_Data\_VIEW2%"
NOT LIKE "USER_Data_VIEW1\%"
WHERE USER_DATA_VIEW.USER_NAME = CURRENT_USER
```

**`.hdbremotetablereplica`**: a custom syntax, parsed by the `hdbremotetablereplica` build plug-in (it is not a catalog SQL statement).

```ebnf
remote_table_replica_artifact ::=
    "REMOTE" "TABLE" "REPLICA" target_table "ON" virtual_table ;
target_table   ::= identifier ;      (* created by the plug-in in the same container *)
virtual_table  ::= identifier ;      (* an existing virtual table in the same container *)
```

- Both objects are in the same HDI container. The plug-in creates the target table, and the virtual table must already exist (`.hdbvirtualtable`).
- Works only with the SAP HANA Smart Data Access adapter `hanaodbc`, not with the Smart Data Integration `HanaAdapter`.

```sql
REMOTE TABLE REPLICA "TARGET_TABLE" ON "VIRTUAL_TABLE"
```

**Known gaps** (follow-ups to #66):

- The analyzer reports `HANA-SYN-023` (*Expected ','*) twice on the valid `CONDITION PROVIDER` form, because `FOR SELECT ON ...` is scanned as a `SELECT` list.
- The formatter breaks the line between `FOR` and `SELECT` and folds `ESCAPE` / `LIKE` / `NOT LIKE` into the `SELECT` clause. The result is still valid, but the layout of §6 is not applied.
- Neither artifact is checked against its production: a missing `ON <virtual_table>` or `FOR SELECT` is not reported.

---

## 5. Embedded Language Injections

- `OPENCYPHER_TABLE(GRAPH WORKSPACE <ws> QUERY '<cypher>')` embeds an OpenCypher query inside the single-quoted string literal after `QUERY`.
- `SPARQL_TABLE('<sparql>')` and `CALL SPARQL_EXECUTE('<sparql>', ...)` embed a SPARQL 1.1 query/update inside the single-quoted string literal.
- `EXECUTE IMMEDIATE '<sql>'` and `EXEC '<sql>'` embed dynamic SAP HANA SQL inside the string expression. Statement grammar (`proc_exec`) and checks: `docs/specs/diagnostics/syntax-rules.md` `HANA-SYN-042` (*Dynamic SQL*) and `HANA-SYN-043`. The grammar does not highlight SQL inside the string literal (outer and inner quotes are both `'`, see #45).

---

## 6. Formatting & Indentation Rules

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 265–290, 341)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/007_pages_211_245.md (Pages 211–245)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/009_pages_281_291.md (Pages 281–291)

The complete formatter specification (options, layout model, embedded queries, safety invariants) is `docs/specs/artifacts/sql-formatting.md`. This section keeps the grammar-level rules.

- **Keyword Casing:** Upper-case SQL and SQLScript keywords, built-in types, and built-in function names (`upper` default) while preserving exact casing inside single-quoted strings `'...'`, double-quoted delimited identifiers `"..."`, and comments.
- **Block Indentation:** Indent statements inside `BEGIN ... END`, `IF ... THEN ... ELSEIF ... ELSE ... END IF`, `CASE ... WHEN ... THEN ... ELSE ... END`, `WHILE ... DO ... END WHILE`, `LOOP ... END LOOP`, `FOR ... DO ... END FOR`, and `DO BEGIN ... END`.
- **Clause Alignment:** Place major query clauses (`SELECT`, `FROM`, `INNER/LEFT/RIGHT/FULL/CROSS JOIN`, `WHERE`, `GROUP BY`, `HAVING`, `WINDOW`, `ORDER BY`, `LIMIT`, `UNION [ALL]`, `INTERSECT`, `EXCEPT`) on their own lines with indented projection lists and predicates.
- **Hierarchy Calls:** a `HIERARCHY*( ... )` call puts each clause on its own line, one level deeper than the call (§4.5).
- **HDI Headerless Root Semicolon Safety (`trailingSemicolon: 'add'`):**
  - HDI design-time DDL artifacts omit the leading `CREATE` command and do **not** carry a root trailing `;` (`com.sap.hana.di.*` build plug-ins treat the entire file as a single headerless object definition):
    - **`.hdbprocedure` (`PROCEDURE ... AS { USING ...; } BEGIN ... END`):** Inner statements inside `BEGIN ... END` (and optional `USING [SYS.]<lib> AS <alias>;` declarations between `AS` and `BEGIN`) are semicolon-terminated, while the root `END` must **not** receive an appended `;` under `trailingSemicolon: 'add'`.
    - **`.hdbfunction` / `.hdbtablefunction` (`FUNCTION ... RETURNS ... AS { USING ...; } BEGIN ... END`):** Same root `END` semicolon suppression across optional `USING ...;` declarations.
    - **`.hdbtabletype` (`TYPE "<name>" AS TABLE ( ... )`):** Root `TYPE` headerless table-type definition formats column definitions one per line and must **not** receive an appended `;`.
    - **`.hdbprojectionview` (`PROJECTION VIEW "<name>" AS SELECT ... FROM ...`):** Root `PROJECTION VIEW` headerless definition formats the `SELECT` query clauses and must **not** receive an appended `;`.
    - **Other HDI headerless root headers:** `COLUMN TABLE`, `ROW TABLE`, `VIEW`, `SEQUENCE`, `TRIGGER`, `LIBRARY`, `INDEX`, `FULLTEXT INDEX`, `FUZZY SEARCH INDEX`, `UNIQUE ... INDEX`, `HASH INDEX`, `BLOCK RANGE INDEX`, `ADJACENCY INDEX`, `SHARED ... REPLICA`, `GRAPH WORKSPACE`, `COLLECTION`, `SCHEDULER JOB`, `VIRTUAL TABLE`, `VIRTUAL PROCEDURE`, `VIRTUAL FUNCTION`, `STATISTICS`, `STRUCTURED PRIVILEGE`, `RESULT CACHE`, `APPLICATION TIME`, `SYSTEM VERSIONING`, `REMOTE TABLE REPLICA`, `STRUCTURED FILTER`.
    - **`.hdbstructuredfilter` (`STRUCTURED FILTER ... FOR SELECT ... { WHERE <condition> | CONDITION PROVIDER <proc> }`):** one headerless statement. Keep `FOR SELECT` on the header line; `ON`, `ESCAPE`, `LIKE`, `NOT LIKE`, `WHERE` and `CONDITION PROVIDER` each start a line at the header's indentation. No `;` is appended.
    - **`.hdbremotetablereplica` (`REMOTE TABLE REPLICA <target> ON <virtual_table>`):** one line, no `;` appended. The plug-in parses a custom syntax, not a SQL statement.
  - Contrast: Catalog DDL (`CREATE PROCEDURE ...;`, `CREATE TYPE ...;`) and standalone DML (`SELECT ...;`) are **not** headerless HDI root statements and **do** receive `;` under `trailingSemicolon: 'add'`.
- **Safety Guarantees:** Never modify code between `-- hanasql-format off` and `-- hanasql-format on`, never strip comments, and support HDI headerless `.hdbprocedure` / `.hdbfunction` / `.hdbtabletype` / `.hdbprojectionview` / `.hdbtable` / `.hdbview` bodies that omit `CREATE`.
