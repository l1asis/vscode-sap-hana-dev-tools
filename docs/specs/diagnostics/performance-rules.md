# SAP HANA SQLScript Performance & Lint Diagnostics Specification

> **Status:** Authoritative Specification (Phase 3)
> **Rule Namespaces:** `HANA-PERF-001` – `HANA-PERF-007`, `HANA-LINT-001` – `HANA-LINT-002`
> **Platforms:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
>
> **Sources:**
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/010_8_Imperative_SQLScript_Logic.md` (Pages 200–255)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/011_9_Calculation_Engine_Plan_Operators.md` (Pages 220–238)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/016_14_Supportability.md` (Pages 445–470)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/017_15_Best_Practices_for_Using_SQLScript.md` (Pages 471–482)
> - `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Performance_Guide_for_Deve/003_pages_61_90.md` (Pages 70–85)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en/005_3_Migrating_SAP_HANA_XS_Advanced_Applications_to_the_SAP_Cloud_Application_Progr.md` (Pages 156–158)

---

## 1. Rule Index

| Rule ID | Severity | Official SAP Rule ID | Platforms | Target Extensions | QuickFix | Summary |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| `HANA-PERF-001` | `Warning` | `USE_OF_CE_FUNCTIONS` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary` | Yes | Deprecated `CE_*` calculation engine plan operators instead of standard SQL. |
| `HANA-PERF-002` | `Warning` | `USE_OF_CE_FUNCTIONS` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction` | Yes | Mixing `CE_*` operators and plain SQL queries in the same procedure/block. |
| `HANA-PERF-003` | `Warning` | — | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary` | No | Imperative cursor iteration (`FOR ... AS <cursor>` / `OPEN` / `FETCH`) instead of set-based SQL. |
| `HANA-PERF-004` | `Warning` | — | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdbview` | No | `SELECT *` inside stored logic disables column-store projection pushdown and risks schema drift. |
| `HANA-PERF-005` | `Warning` | `DML_STATEMENTS_IN_LOOPS` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdblibrary` | No | DML (`INSERT`/`UPDATE`/`UPSERT`/`DELETE`/`MERGE`) inside `FOR` or `WHILE` loop. |
| `HANA-PERF-006` | `Information` | `USE_OF_DYNAMIC_SQL` / `USE_OF_DDL_STATEMENT` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary` | No | Dynamic SQL or DDL statement disables static plan compilation and parallel optimization. |
| `HANA-PERF-007` | `Information` | — | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction` | Yes | Inefficient `SELECT COUNT(*)` / `CARDINALITY(:tab)` or debug `TRACE(:tab)` in production logic. |
| `HANA-LINT-001` | `Warning` | — | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdblibrary` | Yes | Empty or non-rethrowing `DECLARE EXIT HANDLER FOR SQLEXCEPTION` silently swallows database errors. |
| `HANA-LINT-002` | `Information` | `ROW_COUNT_AFTER_SELECT` / `ROW_COUNT_AFTER_DYNAMIC_SQL` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure` | No | Unhandled DML error path (`DECLARE EXIT HANDLER` missing) or unreliable `::ROWCOUNT` usage. |

---

## 2. Suppression Pragma Compatibility

> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/016_14_Supportability.md` (Pages 451–454)

Diagnostics honor SAP SQLScript Code Analyzer suppression comments and custom extension suppressions:

```sql
-- SAP native syntax:
-- @AnalyzerSuppress('SAP.<RULE_NAME>.<CATEGORY>')
/* @AnalyzerSuppress('SAP.USE_OF_CE_FUNCTIONS.PERFORMANCE') */

-- Extension pragma:
-- hanasql-analyze-disable HANA-PERF-004
```

Suppressions placed directly above a statement (consecutive comment lines) or at procedure header level silence matching rules.

---

## 3. Performance Rules (`HANA-PERF-001` – `HANA-PERF-007`)

### `HANA-PERF-001` Legacy Calculation Engine (`CE_*`) Plan Operators
- **Severity:** `Warning` (`Error` when `[CLOUD]` compatibility mode is active, as `CE_*` functions are removed in SAP HANA Cloud SQLScript)
- **SAP Code Analyzer ID:** `SAP.USE_OF_CE_FUNCTIONS.PERFORMANCE`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary`
- **AST / Lexical Trigger:**
  Invocation of any Calculation Engine plan operator:
  `CE_COLUMN_TABLE`, `CE_JOIN_VIEW`, `CE_OLAP_VIEW`, `CE_CALC_VIEW`, `CE_JOIN`, `CE_LEFT_OUTER_JOIN`, `CE_RIGHT_OUTER_JOIN`, `CE_PROJECTION`, `CE_CALC`, `CE_AGGREGATION`, `CE_UNION_ALL`, `CE_VERTICAL_UNION`, `CE_CONVERSION`.
- **Diagnostic Message:** `Calculation Engine operator '<CE_FUNC>' prevents SQL Optimizer / L-native optimizations and is removed in SAP HANA Cloud. Rewrite using standard SQL.`
- **Auto-Fix / QuickFix Translation Matrix:**

| CE Operator | AST Signature | Standard SQL Conversion |
| :--- | :--- | :--- |
| `CE_COLUMN_TABLE` | `<out> = CE_COLUMN_TABLE(<table> [, [<cols>]])` | `<out> = SELECT <cols \| *> FROM <table>;` |
| `CE_JOIN_VIEW` | `<out> = CE_JOIN_VIEW(<view> [, [<cols>]])` | `<out> = SELECT <cols \| *> FROM <view>;` |
| `CE_CALC_VIEW` | `<out> = CE_CALC_VIEW(<view> [, [<cols>]])` | `<out> = SELECT <cols \| *> FROM <view>;` |
| `CE_OLAP_VIEW` | `<out> = CE_OLAP_VIEW(<view>, [<dims_and_aggs>])` | `<out> = SELECT <dims_and_aggs> FROM <view> [GROUP BY <non_agg_cols>];` |
| `CE_PROJECTION` | `<out> = CE_PROJECTION(:<var>, [<proj_list>], ['<filter>'])` | `<out> = SELECT <mapped_proj_list> FROM :<var> [WHERE <unescaped_filter>];` |
| `CE_JOIN` | `<out> = CE_JOIN(:<l>, :<r>, [<join_cols>] [, [<proj_list>]])` | `<out> = SELECT <cols \| *> FROM :<l> AS L INNER JOIN :<r> AS R ON <L.k = R.k ...>;` |
| `CE_LEFT_OUTER_JOIN` | `<out> = CE_LEFT_OUTER_JOIN(:<l>, :<r>, [<join_cols>] [, [<proj_list>]])` | `<out> = SELECT <cols \| *> FROM :<l> AS L LEFT OUTER JOIN :<r> AS R ON <L.k = R.k ...>;` |
| `CE_RIGHT_OUTER_JOIN` | `<out> = CE_RIGHT_OUTER_JOIN(:<l>, :<r>, [<join_cols>] [, [<proj_list>]])` | `<out> = SELECT <cols \| *> FROM :<l> AS L RIGHT OUTER JOIN :<r> AS R ON <L.k = R.k ...>;` |
| `CE_AGGREGATION` | `<out> = CE_AGGREGATION(:<var>, [<aggs>] [, [<groups>]])` | `<out> = SELECT <groups>, <aggs> FROM :<var> [GROUP BY <groups>];` |
| `CE_UNION_ALL` | `<out> = CE_UNION_ALL(:<v1>, :<v2>)` | `<out> = SELECT * FROM :<v1> UNION ALL SELECT * FROM :<v2>;` |

  *(Notes: In projection lists, `"COL" AS "ALIAS"` or `CE_CALC('<expr>', <type>) AS "ALIAS"` removes enclosing quotes on the `CE_CALC` formula string, converts `'<expr>' AS <col>` to `<expr> AS <col>`, unescapes doubled `''` in `CE_PROJECTION` filter strings into SQL `'...'` literals, and replaces `"COL"` in bracket lists with valid SQL column expressions. `CE_VERTICAL_UNION` and `CE_CONVERSION` have no 1:1 pure-SQL counterpart and emit a diagnostic without QuickFix.)*
- **Before:**
  ```sql
  lt_active = CE_COLUMN_TABLE("USERS", ["ID", "NAME", "STATUS"]);
  lt_out = CE_PROJECTION(:lt_active, ["ID", "NAME"], '"STATUS" = ''A''');
  ```
- **After:**
  ```sql
  lt_active = SELECT "ID", "NAME", "STATUS" FROM "USERS";
  lt_out = SELECT "ID", "NAME" FROM :lt_active WHERE "STATUS" = 'A';
  ```

---

### `HANA-PERF-002` Mixing `CE_*` Functions with Plain SQL
- **Severity:** `Warning`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`
- **AST / Lexical Trigger:**
  - A single `CREATE PROCEDURE` / `CREATE FUNCTION` / `DO BEGIN ... END` block contains **both** at least one `CE_*` call AND at least one plain SQL query (`SELECT`, `INSERT`, `UPDATE`, `UPSERT`, `DELETE`, `MERGE INTO`) on table variables or catalog objects.
- **Diagnostic Message:** `Procedure mixes Calculation Engine (CE_*) operators with standard SQL. This forces intermediate materialization across engines and blocks query inlining.`
- **Auto-Fix / QuickFix:** Triggers `HANA-PERF-001` QuickFixes to convert `CE_*` statements in the block to plain SQL (plus batch QuickFix `"Convert all supported CE_* operators in block to SQL"`).

---

### `HANA-PERF-003` Imperative Cursor Loops Over Result Sets
- **Severity:** `Warning`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary`
- **AST / Lexical Trigger:**
  - `DECLARE CURSOR <name> [ ( ... ) ] FOR <select_stmt>` followed by `FOR <row> AS <name> DO ... END FOR;` OR `OPEN <name>; ... FETCH <name> INTO ...`.
- **Diagnostic Message:** `Cursor iteration processes rows sequentially on the SQLScript engine instead of using parallel set-based SQL operators.`
- **Auto-Fix / QuickFix:** None (semantic aggregation/update/insert rewrites depend on control flow; diagnostic message provides canonical set-based pattern hint).

---

### `HANA-PERF-004` `SELECT *` Inside Procedures, Functions, and Views
- **Severity:** `Warning`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdbview`
- **AST / Lexical Trigger:**
  - `SELECT` projection list contains `*` or `<alias>.*` at top level of a `SELECT` statement outside `COUNT(*)`, scalar `EXISTS (SELECT * ...)`, or generated `CE_UNION_ALL` / internal subqueries where `SELECT *` is exempted when matching `EXISTS`.
- **Diagnostic Message:** `Avoid 'SELECT *' in stored procedures and views. Enumerate explicit columns to reduce column-store materialization and prevent schema-evolution breaks.`
- **Auto-Fix / QuickFix:** None (catalog column schema unavailable in offline analyzer).

---

### `HANA-PERF-005` DML Statements Inside Loops
- **Severity:** `Warning`
- **SAP Code Analyzer ID:** `SAP.DML_STATEMENTS_IN_LOOPS.PERFORMANCE`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdblibrary`
- **AST / Lexical Trigger:**
  - Any `INSERT`, `UPDATE`, `UPSERT`, `DELETE`, or `MERGE INTO` statement nested inside `FOR ... DO ... END FOR` or `WHILE ... DO ... END WHILE`.
- **Diagnostic Message:** `DML statement inside loop (SAP.DML_STATEMENTS_IN_LOOPS.PERFORMANCE) incurs per-iteration runtime stack transitions. Rewrite as bulk set-based DML.`
- **Auto-Fix / QuickFix:** None.

---

### `HANA-PERF-006` Optimization-Blocking Statements (`USE_OF_DYNAMIC_SQL`, `USE_OF_DDL_STATEMENT`, `USE_OF_WITH_HINT_CLAUSE`)
- **Severity:** `Information`
- **SAP Code Analyzer ID:** `SAP.USE_OF_DYNAMIC_SQL.SECURITY`, `SAP.USE_OF_DDL_STATEMENT.CONSISTENCY`, `SAP.USE_OF_WITH_HINT_CLAUSE.PERFORMANCE`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary`
- **AST / Lexical Trigger:**
  - Presence of DDL statements (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`) inside a stored procedure body (forces sequential execution & invalidates plan caches), OR `WITH HINT(...)` clauses (blocks automatic query optimization). *(Note: `EXEC`/`EXECUTE IMMEDIATE` already emits `HANA-SEC-001`/`002` when dynamic/unparameterized, or `Information` plan-cache note when parameterized.)*
- **Diagnostic Message:**
  - DDL in procedure: `DDL inside SQLScript procedure (SAP.USE_OF_DDL_STATEMENT.CONSISTENCY) blocks parallel statement scheduling and plan caching.`
  - Dynamic SQL: `Dynamic SQL (SAP.USE_OF_DYNAMIC_SQL) prevents static dependency analysis and statement inlining.`

---

### `HANA-PERF-007` Suboptimal Table Variable Checks & Leftover `TRACE()`
- **Severity:** `Information`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`
- **AST / Lexical Trigger:**
  1. `SELECT COUNT(*) INTO <var> FROM :<tabvar>;` or `<var> = CARDINALITY(:<tabvar>);` -> recommend `RECORD_COUNT(:<tabvar>)` / `IS_EMPTY(:<tabvar>)`.
  2. `<out> = TRACE(:<tabvar>);` -> temporary trace operator has significant runtime overhead (`011_9_Calculation_Engine_Plan_Operators.md:1200`).
- **Diagnostic Message:**
  - `COUNT(*)`/`CARDINALITY(:var)`: `Prefer IS_EMPTY(:var) for emptiness checks or RECORD_COUNT(:var) for row counts over COUNT(*)/CARDINALITY(:var).`
  - `TRACE(:var)`: `Remove debug TRACE() operator before production deployment (materializes rows to a temporary trace table).`
- **Auto-Fix / QuickFix:**
  - `CARDINALITY(:tab)` -> `RECORD_COUNT(:tab)`
  - `lt_out = TRACE(:lt_in);` -> `lt_out = SELECT * FROM :lt_in;` or remove trace assignment.

---

## 4. SQLScript Error-Handling & Reliability Rules (`HANA-LINT-001` – `HANA-LINT-002`)

### `HANA-LINT-001` Swallowed Exception in `DECLARE EXIT HANDLER`
- **Severity:** `Warning`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdblibrary`
- **AST / Lexical Trigger:**
  - `DECLARE EXIT HANDLER FOR { SQLEXCEPTION | SQL_ERROR_CODE <n> | <cond> }` whose handler body is:
    - An empty `BEGIN END;` block (optionally containing only comments), OR
    - A single `BEGIN ... END;` (or single statement) that performs logging/assignment (`::SQL_ERROR_CODE`, `::SQL_ERROR_MESSAGE`, `INSERT`) without containing `RESIGNAL;` or `SIGNAL ...;`.
- **Diagnostic Message:** `'DECLARE EXIT HANDLER' catches SQL exceptions without propagating them via RESIGNAL/SIGNAL, silently masking failures and partial commits.`
- **Auto-Fix / QuickFix:**
  Insert `RESIGNAL;` before `END;` inside `BEGIN ... END;` (or wrap single non-`SIGNAL`/`RESIGNAL` statement in `BEGIN ... RESIGNAL; END;` if missing).
  - **Before:**
    ```sql
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
      INSERT INTO "ERR_LOG" VALUES (::SQL_ERROR_CODE, ::SQL_ERROR_MESSAGE);
    END;
    ```
  - **After:**
    ```sql
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
      INSERT INTO "ERR_LOG" VALUES (::SQL_ERROR_CODE, ::SQL_ERROR_MESSAGE);
      RESIGNAL;
    END;
    ```

---

### `HANA-LINT-002` Missing Exception Handler for DML or Unreliable `::ROWCOUNT`
- **Severity:** `Information`
- **SAP Code Analyzer ID:** `SAP.ROW_COUNT_AFTER_SELECT.CONSISTENCY`, `SAP.ROW_COUNT_AFTER_DYNAMIC_SQL.CONSISTENCY`
- **Target Extensions:** `.sql`, `.hdbprocedure`
- **AST / Lexical Trigger:**
  1. `CREATE PROCEDURE` contains top-level DML (`INSERT`, `UPDATE`, `UPSERT`, `DELETE`, `MERGE INTO`) and does not declare any `EXIT HANDLER` or `CONTINUE HANDLER`.
  2. `::ROWCOUNT` system variable read directly after a `SELECT` or `EXEC` / `EXECUTE IMMEDIATE` statement (SAP Code Analyzer notes `::ROWCOUNT` after `SELECT` or dynamic SQL returns unreliable row counts across plans).
- **Diagnostic Message:**
  - Missing handler: `Procedure performs DML without a 'DECLARE EXIT HANDLER FOR SQLEXCEPTION'. Add error handling or ensure callers handle exceptions.`
  - `::ROWCOUNT`: `Use of ::ROWCOUNT after SELECT or dynamic SQL (SAP.ROW_COUNT_AFTER_SELECT / SAP.ROW_COUNT_AFTER_DYNAMIC_SQL) may yield unreliable counts.`

---

## 5. Official SAP SQLScript Code Analyzer Reference Mapping

> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/016_14_Supportability.md` (Pages 453–462)

| Official SAP Rule Name | Category | Coverage Status in Phase 3 |
| :--- | :--- | :--- |
| `UNCHECKED_SQL_INJECTION_SAFETY` | `SECURITY` | `HANA-SEC-001`, `HANA-SEC-002`, `HANA-SEC-005` |
| `USE_OF_DYNAMIC_SQL` | `SECURITY` / `PERFORMANCE` | `HANA-SEC-001`, `HANA-SEC-003`, `HANA-PERF-006` |
| `USE_OF_CE_FUNCTIONS` | `PERFORMANCE` | `HANA-PERF-001`, `HANA-PERF-002` (with QuickFix) |
| `DML_STATEMENTS_IN_LOOPS` | `PERFORMANCE` | `HANA-PERF-005` |
| `USE_OF_DDL_STATEMENT` | `CONSISTENCY` | `HANA-PERF-006` |
| `USE_OF_WITH_HINT_CLAUSE` | `PERFORMANCE` | `HANA-PERF-006` |
| `ROW_COUNT_AFTER_SELECT` | `CONSISTENCY` | `HANA-LINT-002` |
| `ROW_COUNT_AFTER_DYNAMIC_SQL` | `CONSISTENCY` | `HANA-LINT-002` |
| `USE_OF_SELECT_IN_SCALAR_UDF` | `CONSISTENCY` | Out of scope (scalar UDF semantic rule) |
| `COMMIT_OR_ROLLBACK_IN_DYNAMIC_SQL` | `CONSISTENCY` | Covered if dynamic string matches `COMMIT`/`ROLLBACK` |
| `UNNECESSARY_VARIABLE` | `PERFORMANCE` | Deferred to Phase 3.2 dataflow analyzer |
| `UNUSED_VARIABLE_VALUE` | `CONSISTENCY` | Deferred to Phase 3.2 dataflow analyzer |
| `USE_OF_UNASSIGNED_SCALAR_VARIABLE` | `CONSISTENCY` | Deferred to Phase 3.2 dataflow analyzer |
| `SINGLE_SPACE_LITERAL` | `CONSISTENCY` | Covered by SQL literal checks |
| `USE_OF_SET_SESSION_VARIABLE` | `SECURITY` | Deferred |
| `OUTPUT_LENGTH_VIOLATION` | `CONSISTENCY` | Deferred |
