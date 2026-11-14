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
| `.hdbtable` (HDI DDL), `.hdbmigrationtable`, `.hdbvirtualtable`, `.hdbvirtualtableconfig` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI headerless `COLUMN TABLE`, `ROW TABLE`, `MIGRATION TABLE`, `VIRTUAL TABLE` DDL |
| `.hdbview` (HDI DDL), `.hdbresultcache` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI headerless `VIEW` and `RESULT CACHE` DDL |
| `.hdbsequence` (HDI DDL), `.hdbindex`, `.hdbfulltextindex`, `.hdbconstraint`, `.hdbstatistics` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI headerless `SEQUENCE`, `INDEX`, `FULLTEXT INDEX`, `CONSTRAINT`, `STATISTICS` DDL |
| `.hdbtabletype`, `.hdbstructuredprivilege`, `.hdbgraphworkspace`, `.hdbcollection`, `.hdbschedulerjob` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI `TYPE`, `STRUCTURED PRIVILEGE`, `GRAPH WORKSPACE`, `COLLECTION`, `SCHEDULER JOB` DDL |
| `.hdbcollectionindex`, `.hdbcollectionadjindex` | `hdbcollectionindex`, `hdbcollectionadjindex` | `source.hanasql` | `[CLOUD]` | Headerless Document Store collection index and adjacency index DDL (`HASH INDEX` / `BLOCK RANGE INDEX` / `ADJACENCY INDEX`) |
| `.hdbfabricvirtualtable` | `hdbfabricvirtualtable` | `source.hanasql` | `[CLOUD]` | Headerless Fabric Virtual Table shared replica DDL (`SHARED [SNAPSHOT] REPLICA [PAGE\|COLUMN LOADABLE] ON`) |
| `.hdbafllangprocedure`, `.hdbvirtualfunction`, `.hdbvirtualprocedure`, `.hdbsearchruleset` | `hanasql` | `source.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | HDI AFL, Smart Data Integration, and Search Ruleset DDL |

---

## 2. Lexical Tokens

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/001_pages_1_30.md (Pages 20–30)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference/007_pages_181_210.md (Pages 181–204)

| Token Class | Pattern / Delimiters | TextMate Scope | Platform | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Line Comment | `--[^\r\n]*` or `//[^\r\n]*` | `comment.line.double-dash.hanasql`, `comment.line.double-slash.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | SQL `--` and C-style `//` single-line comments |
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
| Comparison & Arithmetic Operators | `<>`, `!=`, `~=`, `<=`, `>=`, `^=`, `=`, `<`, `>`, `\+`, `-`, `\*`, `/`, `%` | `keyword.operator.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Relational and arithmetic operators |
| Namespace / Library Member Accessor | `::`, `:` | `punctuation.separator.namespace.hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Repository/HDI object separator `::` and SQLScript library member separator `alias:member` |

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

---

## 4. Formal EBNF Grammar

### 4.1 SQLScript Procedures, Functions, Libraries & Imperative Constructs

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference/002_pages_31_60.md (Pages 31–270)

```ebnf
(* 1. Procedure Definition (Catalog DDL & HDI Headerless .hdbprocedure) *)
procedure_stmt ::=
    [ "CREATE" [ "OR" "REPLACE" ] ] "PROCEDURE" object_name
    [ "(" [ proc_param { "," proc_param } ] ")" ]
    [ "LANGUAGE" ( "SQLSCRIPT" | "GRAPH" | "R" | "AFLLANG" ) ]
    [ "SQL" "SECURITY" ( "DEFINER" | "INVOKER" ) ]
    [ "DEFAULT" "SCHEMA" schema_name ]
    [ "READS" "SQL" "DATA" [ "WITH" "RESULT" "VIEW" view_name ] ]
    [ "SEQUENTIAL" "EXECUTION" ]
    [ "AUTOCOMMIT" "DDL" ( "ON" | "OFF" ) ]
    "AS"
    { using_library_decl }
    proc_block ;

proc_param ::=
    [ "IN" | "OUT" | "INOUT" ] identifier ( param_type | "TABLE" "(" column_def_list ")" | " TABLE (...)" )
    [ "DEFAULT" ( expression | "EMPTY" ) ] ;

using_library_decl ::=
    "USING" [ "SYS" "." ] identifier "AS" identifier ";" ;

(* 2. User-Defined Function Definition (.hdbfunction, .hdbtablefunction, .hdbscalarfunction) *)
function_stmt ::=
    [ "CREATE" [ "OR" "REPLACE" ] ] "FUNCTION" object_name
    [ "(" [ func_param { "," func_param } ] ")" ]
    "RETURNS" ( return_table_spec | return_scalar_list )
    [ "LANGUAGE" ( "SQLSCRIPT" | "GRAPH" ) ]
    [ "SQL" "SECURITY" ( "DEFINER" | "INVOKER" ) ]
    [ "DEFAULT" "SCHEMA" schema_name ]
    [ "READS" "SQL" "DATA" ]
    [ "DETERMINISTIC" ]
    [ "CACHE" | "NO" "CACHE" ]
    "AS"
    { using_library_decl }
    proc_block ;

(* 3. SQLScript Shared & Test Library Definition (.hdblibrary) *)
library_stmt ::=
    [ "CREATE" [ "OR" "REPLACE" ] ] "LIBRARY" object_name
    [ "LANGUAGE" "SQLSCRIPT" ]
    [ "TEST" ]
    [ "DEFAULT" "SCHEMA" schema_name ]
    "AS" "BEGIN"
        { [ "PUBLIC" | "PRIVATE" ] ( variable_decl | procedure_member | function_member ) }
    "END" ;

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

### 4.5 Hierarchy Generator & Navigation Functions

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide/010_HIERARCHY_Generator_Function.md (Pages 8–57)

```ebnf
hierarchy_generator_call ::=
    ( "HIERARCHY" | "HIERARCHY_SPANTREE" | "HIERARCHY_TEMPORAL" | "HIERARCHY_LEVELED" ) "("
        "SOURCE" ( table_ref | "(" select_stmt ")" )
        [ "START" "WHERE" condition ]
        [ "LEVELS" "(" column_list ")" ]
        [ "SIBLING" "ORDER" "BY" order_by_list ]
        [ "VALID" ( "FROM" expression [ "EXCLUDED" ] "UNTIL" expression [ "EXCLUDED" ]
                  | "AT" expression [ "FROM" "EXCLUDED" ] [ "UNTIL" "EXCLUDED" ] ) ]
        [ "DEPTH" signed_integer ]
        [ "MULTIPARENT" [ "ERROR" | "LEAVES" ] ]
        [ "ORPHAN" ( "IGNORE" | "ERROR" | "ADOPT" | "ROOT" ) ]
        [ "CYCLE" ( "BREAKUP" | "ERROR" ) ]
        [ "CACHE" [ "FORCE" | string_literal ] | "NO" "CACHE" ]
        [ "LOAD" ( "BULK" | "INCREMENTAL" | string_literal ) ]
        [ "RETAIN" "NULLS" string_literal ]
    ")" ;

hierarchy_navigation_call ::=
    ( "HIERARCHY_DESCENDANTS" | "HIERARCHY_ANCESTORS" | "HIERARCHY_SIBLINGS"
    | "HIERARCHY_DESCENDANTS_AGGREGATE" | "HIERARCHY_ANCESTORS_AGGREGATE" ) "("
        "SOURCE" ( table_ref | "(" select_stmt ")" )
        [ "START" ( table_ref | "(" select_stmt ")" | "WHERE" condition ) ]
        [ "JOIN" table_ref "ON" condition ]
        [ "MEASURES" "(" measure_expr "AS" identifier { "," measure_expr "AS" identifier } ")" ]
        [ "DISTANCE" ( [ "FROM" expression ] [ "TO" expression ] | expression ) ]
        [ "WHERE" condition ]
        { "WITH" ( "SUBTOTAL" | "BALANCE" | "NOT" "MATCHED" | "TOTAL" ) [ expression ] }
    ")" ;
```

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

---

## 5. Embedded Language Injections

- `OPENCYPHER_TABLE(GRAPH WORKSPACE <ws> QUERY '<cypher>')` embeds an OpenCypher query inside the single-quoted string literal after `QUERY`.
- `SPARQL_TABLE('<sparql>')` and `CALL SPARQL_EXECUTE('<sparql>', ...)` embed a SPARQL 1.1 query/update inside the single-quoted string literal.
- `EXECUTE IMMEDIATE '<sql>'` and `EXEC '<sql>'` embed dynamic SAP HANA SQL inside the string expression.

---

## 6. Formatting & Indentation Rules

- **Keyword Casing:** Upper-case SQL and SQLScript keywords, built-in types, and built-in function names (`upper` default) while preserving exact casing inside single-quoted strings `'...'`, double-quoted delimited identifiers `"..."`, and comments.
- **Block Indentation:** Indent statements inside `BEGIN ... END`, `IF ... THEN ... ELSEIF ... ELSE ... END IF`, `CASE ... WHEN ... THEN ... ELSE ... END`, `WHILE ... DO ... END WHILE`, `LOOP ... END LOOP`, `FOR ... DO ... END FOR`, and `DO BEGIN ... END`.
- **Clause Alignment:** Place major query clauses (`SELECT`, `FROM`, `INNER/LEFT/RIGHT/FULL/CROSS JOIN`, `WHERE`, `GROUP BY`, `HAVING`, `WINDOW`, `ORDER BY`, `LIMIT`, `UNION [ALL]`, `INTERSECT`, `EXCEPT`) on their own lines with indented projection lists and predicates.
- **Safety Guarantees:** Never modify code between `-- hanasql-format off` and `-- hanasql-format on`, never strip comments, and support HDI headerless `.hdbprocedure` / `.hdbfunction` / `.hdbtable` / `.hdbview` bodies that omit `CREATE`.
