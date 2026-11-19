# Broken SAP HANA Sample Fixtures

These files are **intentionally invalid**. Each one triggers specific analyzer diagnostics, so you can try the Problems panel and the QuickFix menu (`Ctrl+.`) in the Extension Development Host, and so `npm test` can check them in `test/broken-samples.test.ts`.

Every other folder under `samples/` holds valid artifacts and must stay free of syntax diagnostics. The clean-sample sweeps skip this folder.

## How the table is checked

`test/broken-samples.test.ts` parses the tables below. For every file it runs all analyzers (default options, all categories on) and checks that:

- The set of reported `(rule, severity)` pairs is **exactly** the set of rows listed for that file, so new false positives and lost diagnostics both fail.
- The QuickFixes column lists **exactly** the fix titles offered for that rule and severity. `—` means no QuickFix is offered.
- Analyzing, formatting (where a headless formatter exists), and analyzing again after applying each QuickFix never throws.
- Every file in this folder has at least one row, and every row points to an existing file.

When you change a rule's behavior, update the row in the same PR. Rows are grouped by domain folder and sorted by rule ID, then severity.

## Conventions

- One rule family per file where possible. An unterminated string or comment swallows the rest of a file, so `HANA-SYN-001`, `HANA-SYN-002` and `HANA-SYN-030` get files of their own.
- Some rows are cascades of the intended error, not separate mistakes. For example, `FUNC loadOrders(...)` also reports a missing operator before `loadOrders`. These rows document current behavior and are not extra mistakes in the sample.
- Object names are invented (`app.sales::...`, `orders`). No file is copied from SAP documentation.

## Expected diagnostics

### `calculationview/`

| File | Rule | Severity | QuickFixes |
| :--- | :--- | :--- | :--- |
| [`broken-graph.hdbcalculationview`](calculationview/broken-graph.hdbcalculationview) | `HANA-LINT-102` | error | — |
| [`broken-graph.hdbcalculationview`](calculationview/broken-graph.hdbcalculationview) | `HANA-LINT-103` | error | — |
| [`broken-graph.hdbcalculationview`](calculationview/broken-graph.hdbcalculationview) | `HANA-LINT-104` | error | — |
| [`broken-graph.hdbcalculationview`](calculationview/broken-graph.hdbcalculationview) | `HANA-LINT-104` | warning | — |
| [`broken-graph.hdbcalculationview`](calculationview/broken-graph.hdbcalculationview) | `HANA-LINT-105` | warning | — |
| [`legacy-settings.hdbcalculationview`](calculationview/legacy-settings.hdbcalculationview) | `HANA-LINT-106` | warning | `Set applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"` |
| [`legacy-settings.hdbcalculationview`](calculationview/legacy-settings.hdbcalculationview) | `HANA-LINT-107` | warning | `Remove 'schemaName' attribute from <columnObject>`<br>`Remove XSC-only 'defaultSchema' attribute` |
| [`malformed.hdbcalculationview`](calculationview/malformed.hdbcalculationview) | `HANA-LINT-101` | error | — |
| [`malformed.hdbcalculationview`](calculationview/malformed.hdbcalculationview) | `HANA-LINT-104` | error | — |

### `migration/`

| File | Rule | Severity | QuickFixes |
| :--- | :--- | :--- | :--- |
| [`default-schema.hdbprocedure`](migration/default-schema.hdbprocedure) | `HANA-MIG-010` | warning | `Remove DEFAULT SCHEMA clause for HDI compatibility` |
| [`default-schema.hdbprocedure`](migration/default-schema.hdbprocedure) | `HANA-MIG-011` | warning | `Replace '_SYS_BIC."app.sales/CV_ORDERS"' with '"app.sales::CV_ORDERS"'` |
| [`legacy-model.hdbdd`](migration/legacy-model.hdbdd) | `HANA-MIG-005` | warning | `Convert .hdbdd annotations to HDI .hdbcds syntax` |
| [`obsolete.hdbschema`](migration/obsolete.hdbschema) | `HANA-MIG-012` | information | — |

### `performance/`

| File | Rule | Severity | QuickFixes |
| :--- | :--- | :--- | :--- |
| [`set-based-violations.hdbprocedure`](performance/set-based-violations.hdbprocedure) | `HANA-LINT-001` | warning | `Add 'RESIGNAL;' to EXIT HANDLER so errors are not silently swallowed` |
| [`set-based-violations.hdbprocedure`](performance/set-based-violations.hdbprocedure) | `HANA-PERF-001` | warning | `Convert 'CE_PROJECTION' to standard SQL SELECT` |
| [`set-based-violations.hdbprocedure`](performance/set-based-violations.hdbprocedure) | `HANA-PERF-002` | warning | `Convert all supported CE_* operators in block to standard SQL` |
| [`set-based-violations.hdbprocedure`](performance/set-based-violations.hdbprocedure) | `HANA-PERF-003` | warning | — |
| [`set-based-violations.hdbprocedure`](performance/set-based-violations.hdbprocedure) | `HANA-PERF-004` | warning | — |
| [`set-based-violations.hdbprocedure`](performance/set-based-violations.hdbprocedure) | `HANA-PERF-005` | warning | — |
| [`set-based-violations.hdbprocedure`](performance/set-based-violations.hdbprocedure) | `HANA-PERF-006` | information | — |
| [`set-based-violations.hdbprocedure`](performance/set-based-violations.hdbprocedure) | `HANA-PERF-007` | information | — |

### `security/`

| File | Rule | Severity | QuickFixes |
| :--- | :--- | :--- | :--- |
| [`broad-grants.hdbrole`](security/broad-grants.hdbrole) | `HANA-SEC-030` | warning | `Convert 'privileges_with_grant_option' to standard 'privileges'` |
| [`broad-grants.hdbrole`](security/broad-grants.hdbrole) | `HANA-SEC-031` | warning | — |
| [`broad-grants.hdbrole`](security/broad-grants.hdbrole) | `HANA-SEC-032` | warning | — |
| [`broad-grants.hdbrole`](security/broad-grants.hdbrole) | `HANA-SEC-033` | error | `Append '#' suffix to role name ('app.sales::Reporting#')`<br>`Convert 'privileges_with_grant_option' to standard 'privileges'` |
| [`dynamic-sql.hdbprocedure`](security/dynamic-sql.hdbprocedure) | `HANA-SEC-001` | error | `Refactor dynamic SQL to parameterized 'EXECUTE IMMEDIATE ... USING ...'` |
| [`dynamic-sql.hdbprocedure`](security/dynamic-sql.hdbprocedure) | `HANA-SEC-002` | warning | — |
| [`dynamic-sql.hdbprocedure`](security/dynamic-sql.hdbprocedure) | `HANA-SEC-003` | warning | `Switch to SQL SECURITY INVOKER` |
| [`dynamic-sql.hdbprocedure`](security/dynamic-sql.hdbprocedure) | `HANA-SEC-005` | warning | — |
| [`exposed-package.xsaccess`](security/exposed-package.xsaccess) | `HANA-SEC-020` | error | `Enable Form authentication in .xsaccess` |
| [`exposed-package.xsaccess`](security/exposed-package.xsaccess) | `HANA-SEC-021` | warning | `Set "prevent_xsrf": true` |
| [`exposed-package.xsaccess`](security/exposed-package.xsaccess) | `HANA-SEC-022` | warning | — |
| [`exposed-package.xsaccess`](security/exposed-package.xsaccess) | `HANA-SEC-023` | warning | `Replace wildcard "*" allowOrigin with explicit trusted origin` |
| [`exposed-package.xsaccess`](security/exposed-package.xsaccess) | `HANA-SEC-024` | warning | `Set "force_ssl": true` |
| [`exposed-package.xsaccess`](security/exposed-package.xsaccess) | `HANA-SEC-025` | information | `Add X-Frame-Options: SAMEORIGIN clickjacking header` |
| [`over-privileged.hdbgrants`](security/over-privileged.hdbgrants) | `HANA-SEC-040` | warning | `Convert 'privileges_with_grant_option' to standard 'privileges'` |
| [`over-privileged.hdbgrants`](security/over-privileged.hdbgrants) | `HANA-SEC-041` | warning | — |
| [`over-privileged.hdbgrants`](security/over-privileged.hdbgrants) | `HANA-SEC-042` | warning | — |
| [`over-privileged.hdbgrants`](security/over-privileged.hdbgrants) | `HANA-SEC-042` | information | — |

### `syntax/`

| File | Rule | Severity | QuickFixes |
| :--- | :--- | :--- | :--- |
| [`cds-lists.hdbcds`](syntax/cds-lists.hdbcds) | `HANA-SYN-023` | error | `Insert ','` |
| [`cds-members.hdbcds`](syntax/cds-members.hdbcds) | `HANA-SYN-026` | error | `Insert ':'`<br>`Insert ';'` |
| [`classic-kv.hdbtable`](syntax/classic-kv.hdbtable) | `HANA-MIG-001` | information | `Convert Classic .hdbtable to HDI DDL syntax` |
| [`classic-kv.hdbtable`](syntax/classic-kv.hdbtable) | `HANA-SYN-022` | error | — |
| [`classic-view-sql.hdbview`](syntax/classic-view-sql.hdbview) | `HANA-MIG-002` | information | `Convert Classic .hdbview to HDI DDL syntax` |
| [`classic-view-sql.hdbview`](syntax/classic-view-sql.hdbview) | `HANA-SYN-022` | error | `Use double quotes` |
| [`classic-view-sql.hdbview`](syntax/classic-view-sql.hdbview) | `HANA-SYN-023` | error | `Insert ','` |
| [`classic-view-sql.hdbview`](syntax/classic-view-sql.hdbview) | `HANA-SYN-024` | error | — |
| [`clause-order.sql`](syntax/clause-order.sql) | `HANA-SYN-027` | error | — |
| [`exec-clauses.hdbprocedure`](syntax/exec-clauses.hdbprocedure) | `HANA-PERF-006` | information | — |
| [`exec-clauses.hdbprocedure`](syntax/exec-clauses.hdbprocedure) | `HANA-SEC-003` | warning | `Switch to SQL SECURITY INVOKER` |
| [`exec-clauses.hdbprocedure`](syntax/exec-clauses.hdbprocedure) | `HANA-SYN-021` | error | `Replace 'SELCT' with 'SELECT'` |
| [`exec-clauses.hdbprocedure`](syntax/exec-clauses.hdbprocedure) | `HANA-SYN-042` | error | `Insert 'IMMEDIATE'` |
| [`exec-clauses.hdbprocedure`](syntax/exec-clauses.hdbprocedure) | `HANA-SYN-043` | error | — |
| [`incomplete-clauses.sql`](syntax/incomplete-clauses.sql) | `HANA-SYN-025` | error | — |
| [`invalid-characters.sql`](syntax/invalid-characters.sql) | `HANA-SYN-005` | error | `Replace '//' with '--'` |
| [`json-errors.hdiconfig`](syntax/json-errors.hdiconfig) | `HANA-SYN-010` | error | — |
| [`json-errors.hdiconfig`](syntax/json-errors.hdiconfig) | `HANA-SYN-011` | error | `Remove trailing comma` |
| [`keyword-typos.sql`](syntax/keyword-typos.sql) | `HANA-SYN-021` | error | `Replace 'WHRE' with 'WHERE'` |
| [`missing-whitespace.sql`](syntax/missing-whitespace.sql) | `HANA-SYN-006` | warning | `Insert space` |
| [`routine-header.sql`](syntax/routine-header.sql) | `HANA-LINT-002` | information | — |
| [`routine-header.sql`](syntax/routine-header.sql) | `HANA-SEC-004` | information | `Add SQL SECURITY DEFINER`<br>`Add SQL SECURITY INVOKER` |
| [`routine-header.sql`](syntax/routine-header.sql) | `HANA-SYN-040` | error | `Insert 'AS'` |
| [`routine-structure.sql`](syntax/routine-structure.sql) | `HANA-SEC-004` | information | `Add SQL SECURITY DEFINER`<br>`Add SQL SECURITY INVOKER` |
| [`routine-structure.sql`](syntax/routine-structure.sql) | `HANA-SYN-028` | error | — |
| [`separators.sql`](syntax/separators.sql) | `HANA-SYN-023` | error | `Insert ','` |
| [`separators.sql`](syntax/separators.sql) | `HANA-SYN-024` | error | `Remove trailing ','` |
| [`statement-context.sql`](syntax/statement-context.sql) | `HANA-SYN-029` | error | — |
| [`statement-start.sql`](syntax/statement-start.sql) | `HANA-SYN-041` | error | — |
| [`unbalanced-delimiters.sql`](syntax/unbalanced-delimiters.sql) | `HANA-SYN-003` | error | — |
| [`unclosed-blocks.sql`](syntax/unclosed-blocks.sql) | `HANA-SYN-020` | error | — |
| [`unconsumed-tokens.sql`](syntax/unconsumed-tokens.sql) | `HANA-SYN-042` | error | — |
| [`unterminated-comment.sql`](syntax/unterminated-comment.sql) | `HANA-SYN-002` | error | — |
| [`unterminated-string.sql`](syntax/unterminated-string.sql) | `HANA-SYN-001` | error | — |
| [`view-lists.hdbview`](syntax/view-lists.hdbview) | `HANA-SYN-023` | error | `Insert ','` |
| [`view-lists.hdbview`](syntax/view-lists.hdbview) | `HANA-SYN-023` | warning | `Insert ','`<br>`Insert 'AS'` |
| [`wrong-root.hdbprocedure`](syntax/wrong-root.hdbprocedure) | `HANA-SYN-004` | error | — |

### `xsjs/`

| File | Rule | Severity | QuickFixes |
| :--- | :--- | :--- | :--- |
| [`deprecated-api.xsjslib`](xsjs/deprecated-api.xsjslib) | `HANA-MIG-020` | warning | — |
| [`injection.xsjs`](xsjs/injection.xsjs) | `HANA-SEC-010` | error | `Parameterize executeQuery() with '?' placeholders` |
| [`injection.xsjs`](xsjs/injection.xsjs) | `HANA-SEC-011` | warning | `Migrate $.db.getConnection() to $.hdb.getConnection()` |
| [`injection.xsjs`](xsjs/injection.xsjs) | `HANA-SEC-012` | warning | — |
| [`syntax-errors.xsjs`](xsjs/syntax-errors.xsjs) | `HANA-SYN-031` | error | — |
| [`syntax-errors.xsjs`](xsjs/syntax-errors.xsjs) | `HANA-SYN-032` | error | `Replace 'FUNC' with 'function'` |
| [`syntax-errors.xsjs`](xsjs/syntax-errors.xsjs) | `HANA-SYN-033` | error | `Insert ','` |
| [`syntax-errors.xsjs`](xsjs/syntax-errors.xsjs) | `HANA-SYN-034` | error | — |
| [`unterminated-string.xsjs`](xsjs/unterminated-string.xsjs) | `HANA-SYN-030` | error | — |
