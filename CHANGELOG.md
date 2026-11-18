# Changelog

All notable changes to the **Developer Tools for SAP HANA** extension will be documented in this file.

## [0.10.3] - 2026-11-18

### Added

- **SQL / SQLScript Conformance Harness (`test/conformance.test.ts`, `scripts/conformance.js`, `docs/specs/diagnostics/conformance-harness.md`):** A repeatable check of the analyzer, formatter, grammar, and function catalog against valid SQL. It reports false `HANA-SYN-*` diagnostics and formatter output that throws, is not idempotent, or changes the word or comment sequence. It also reports changed `-- hanasql-format off` regions, catalog keywords the grammar leaves unscoped, and unknown function calls. `npm test` runs 91 committed fixture cases in 7 statement families (`test/fixtures/conformance/*.sql`). Known failures carry a per-check `-- @todo` marker, and the suite fails once a marked check starts passing. `npm run conformance` sweeps the local reference corpus, which is not run in CI. The baseline and the corpus noise allowlist are recorded in `docs/research/CONFORMANCE.md` and `docs/research/conformance-allowlist.json` (#76).
- **Broken Samples Suite (`samples/broken/`, `test/broken-samples.test.ts`):** 34 intentionally invalid artifacts covering 69 rule IDs across the `SYN`, `SEC`, `PERF`, `LINT`, and `MIG` rule families. `samples/broken/README.md` lists each file's expected rule IDs, severities, and QuickFix titles, and the test checks that the reported diagnostics match that table exactly. All other samples must stay free of syntax diagnostics (#34).

### Changed

- **VSIX Packaging (`.vscodeignore`):** The packaged extension no longer ships the compiled test suite (`out/test/**`, ~300 KB) (#90).

### Fixed

- **Hexadecimal Numeric Literals (`src/formatter/tokenizer.ts`, `src/analyzer/sql-lexical.ts`):** `0x0abc` / `0X1F` now lex as one number token. The formatter no longer splits `SELECT 0x0abc "hex_value"` into `SELECT 0 x0abc "hex_value"`, which changed the query's meaning, and the analyzer no longer reports a false `HANA-SYN-023` there. A word glued to a hex literal (`0x1Fzz`) is still reported as `HANA-SYN-006` (#88).
- **Specs & Tests:** Added `docs/specs/diagnostics/conformance-harness.md` and positive and negative tests for the hex literal fix, bringing the test suite to `355` passing tests (`33` tracked `@todo` cases).

## [0.10.2] - 2026-11-18

### Fixed

- **`.hdbsequence` Migration QuickFix (`src/analyzer/migrator.ts`, `HANA-MIG-003`):** The Classic KV -> HDI DDL conversion now emits the valid `NO MAXVALUE` / `NO MINVALUE` form, and the reverse conversion reads it while still accepting the legacy single-word form. `RESET BY` now strips the `"<schema>".` prefix that matches `schema=`, as `.hdbview` already did (#70).
- **`.hdbdd` -> `.hdbcds` Migration QuickFix (`HANA-MIG-005`):** The `technical configuration` block is now placed after the entity's closing brace (`} technical configuration { ... };`). An existing block is merged into instead of duplicated, and store clauses or index names it already has are not added again. Indentation follows the entity's elements, CRLF / LF line endings are kept, and index clauses use the documented `[unique] index I on (a, b) asc;` form (#68).
- **Classic `.hdbrole` -> JSON Migration QuickFix (`HANA-MIG-004`):** The role header is split at each `extends` into `name`, `schema_roles`, and `global_roles`, including comma lists. A `sql object` list becomes one entry per object (`pkg::OBJ`, with its type taken from its own suffix). Content the QuickFix cannot carry over (`package` and `application privilege` lines, the `catalog sql object` synonym reminder, unknown object types, a system-privilege grant option) is listed in the diagnostic message under "Not carried over by the QuickFix" (#69).
- **Comments in Migration QuickFixes:** Classic KV -> SQL conversions (table, view, sequence, structure) move source comments into a SQL header block in source order, with `//` turned into `--`. Reverse conversions bring them back as `//` without duplicating comments inside copied SQL, `-- TODO(.hdbindex)` lines convert back into `table.indexes`, and `.hdbrole` -> JSON lists each dropped comment in the diagnostic message (#71).
- **Duplicated XSJS Hover Cards (`src/xsjs/intellisense-core.ts`):**
  - Inherited methods are deduplicated by overload signature, keeping the most-derived override. `$.response.setBody`, `$.request.setBody`, and `new $.net.http.Request(...).setBody` no longer show the same hover card 2–3 times, and signature help and completion `(+N overloads)` counts no longer include the duplicates.
  - An overloaded method now gets one hover card: its signatures stacked in one block (the overload matching the call-site argument count first), a description shared by all overloads shown once (`$.import`), per-overload deprecation notes (`$.db.getConnection`), and a merged parameter list, which hover previously left out.
  - Member hover now filters `static` vs. instance members the same way completions do, so `Order.$save` on an XSDS entity class and `item.$find` on an instance no longer show a card (#30).
- **Specs & Tests:** Updated `docs/specs/diagnostics/migration-xsc-to-hdi.md` and `docs/specs/diagnostics/sql-intellisense.md` (new §2.5). Added a sample-driven regression harness that applies every structural migration QuickFix to the files in `samples/`, plus positive and negative XSJS IntelliSense tests, bringing the test suite to `185/185` passing.

## [0.10.1] - 2026-11-18

### Added

- **Built-in Functions (`syntaxes/hanasql.tmLanguage.json`, `docs/specs/catalogs/builtin-functions.json`, `src/sql/sql-catalog.ts`):** Added `TO_CHAR` / `TO_NCHAR` (conversion), `CHR` (string), `GET_NUM_SERVERS` (misc), and the SQLScript table variable built-ins `RECORD_COUNT` / `IS_EMPTY`, which the SQL / SQLScript references use without giving them a chapter. They are now highlighted (only when followed by `(`) and have hover and completion with real signatures, e.g. `TO_CHAR(<value> [, <format>])` and `RECORD_COUNT(<table_variable>)` (#74).

### Fixed

- **`IF [NOT] EXISTS` / `IF NOT` Conditions (`src/analyzer/syntax.ts`, `HANA-SYN-020`):** An SQLScript `IF` whose condition starts with `EXISTS`, `NOT EXISTS`, or any `NOT` (`IF NOT :flag THEN`) now opens an `IF` block instead of reporting a false `Unexpected 'END IF'`. Errors inside such conditions and bodies (`AND AND`, a missing `;`) are now reported too. DDL `DROP ... IF EXISTS` is unaffected (#72).
- **`LEFT(` / `RIGHT(` in Conditions (`HANA-SYN-024`):** The `LEFT` / `RIGHT` string functions no longer end a `WHERE` / `ON` / `HAVING` condition, which caused false `Dangling operator 'AND' before 'LEFT'` errors. `LEFT [OUTER] JOIN` / `RIGHT [OUTER] JOIN` still end it (#73).
- **Missing-Operator and Missing-Comma False Positives (`HANA-SYN-023`, `HANA-SYN-024`):** `[NOT] LIKE_REGEXPR <pattern> [FLAG <flags>]`, `MERGE INTO ... WHEN MATCHED ... WHEN NOT MATCHED ...` branches, `ALTER SYSTEM ALTER CONFIGURATION ... SET (...) = <value> WITH RECONFIGURE`, and typed cursor parameters (`DECLARE CURSOR c (p NVARCHAR(10)) FOR ...`) no longer produce false diagnostics. Genuine errors in these constructs are still reported (#60).
- **Specs & Tests:** Updated `docs/specs/diagnostics/syntax-rules.md` and `docs/specs/grammars/sql-sqlscript.md` and added positive and negative tests for each fix, bringing the test suite to `161/161` passing.

## [0.10.0] - 2026-11-17

### Added

- **SQL & SQLScript Lexical Integrity (`src/analyzer/sql-lexical.ts`, `HANA-SYN-005`, `HANA-SYN-006`, `HANA-SYN-024`):**
  - **Invalid Characters, `//` Comments & Pragmas (`HANA-SYN-005`):** Reports `//` line comments (SQL / SQLScript only support `--` and `/* ... */`), characters outside the SQL lexical grammar (`&`, single `|`, `\`, backtick, single `!`, `~`, `^`, typographic quotes, dashes, arrows, ellipsis), and unknown `@` pragmas (anything other than `@AnalyzerSuppress`, `@pushscope` / `@popscope`, and the `SQLSCRIPT_TEST` annotations), with `Replace '//' with '--'` and `Remove '<char>'` QuickFixes. `//` is still scanned to end of line, so a stray quote inside it cannot swallow the rest of the file.
  - **Token Boundaries (`HANA-SYN-006`):** Reports glued tokens with an `Insert space` QuickFix: `error` for numeric literals (`123abc`), `warning` for string literals and quoted identifiers (`'s'abc`, `"T"alias`), with hexadecimal literals (`0x1F`) excluded. Also reports undelimited object names containing `::` (`com.acme::tbl`) with a `Quote as "..."` QuickFix, excluding cursor attributes (`c::ISCLOSED`, `::NOTFOUND`, `::ROWCOUNT`).
  - **Punctuation Hygiene (`HANA-SYN-024`):** Reports consecutive commas (`,,,,`, one diagnostic per run), leading commas after `(`, trailing commas before `;`, and stray or repeated `.` separators (`,.`, `...`, `t. FROM`). Follow-up diagnostics from other rules inside or directly after a lexical span are dropped to avoid cascades.
- **Consuming Routine Header Parser (`src/analyzer/sql-header.ts`, `HANA-SYN-040`, `HANA-SYN-021`):**
  - Parses `[CREATE [OR REPLACE] | ALTER] [VIRTUAL] PROCEDURE | FUNCTION | LIBRARY` headers, `.hdblibrary` member headers, `TRIGGER` headers (action time, event list, `ON`, `REFERENCING`, `FOR EACH`, `FOLLOWS` / `PRECEDES`, `ONLINE`), and `DO [(...)] BEGIN` blocks. Every token through `AS` -> `{ USING ...; }` -> `BEGIN` / `HEADER ONLY [ON INVALID]` must be consumed by a header production.
  - Reports unconsumed tokens (one per contiguous run), malformed clause arguments, and a missing mandatory `AS` before `BEGIN` / `HEADER ONLY` (`Insert 'AS'` QuickFix). Option-only and management `ALTER` forms, virtual-routine adapter options, and `AS BUILTIN` signatures are accepted.
  - Matches unconsumed words against the follow-set of their exact header slot, including 2–3 letter keywords (`ASd` -> `AS`, `LANUAGE` -> `LANGUAGE`, `INVOKR` -> `INVOKER`, `AFTR` -> `AFTER`, `OM` -> `ON`), with a `HANA-SYN-021` QuickFix; parsing then continues as if the keyword had been written.
- **Statement-Starter Validation (`src/analyzer/sql-statements.ts`, `HANA-SYN-041`, `HANA-SYN-021`):**
  - Adds a statement walker that follows routine, library, and trigger bodies, `BEGIN ... END`, `IF` / `ELSEIF` / `ELSE`, `WHILE`, `FOR`, `LOOP`, statement-level `CASE ... END CASE`, `DECLARE ... HANDLER`, and `BEGIN ... END` nested inside statements, keeping expression-level `CASE ... END` out of statement boundaries.
  - Rejects invalid statement starters (`foobar;`, `'Active';`, `123;`, stray operators) at top level and inside blocks. Valid starters are the documented SQL statement verbs, SQLScript imperative keywords, parenthesized queries, and imperative targets: `x = ..`, `x := ..`, `arr[i] = ..`, `tv.col[i] = ..`, `:tv.INSERT(..)`, `(i, j) = SUDF(..)`, and `LIB:member(..)`. `@pragma(...)`, `#[INLINE]`, and `label:` prefixes are skipped.
  - Suggests the intended starter for typos (`SELECTT`, `DECLRE`, `UPSRT`, `PUBLC` in library scope) with a `HANA-SYN-021` QuickFix.
- **Consuming Clause & Pratt Expression Parsers (`src/analyzer/sql-clauses.ts`, `HANA-SYN-042`, `HANA-SYN-021`):**
  - Adds a zero-dependency Pratt expression parser and consuming parsers for queries (`WITH`, set operations, select lists, `FROM` items with joins, join cardinality, and association navigation, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`), `INSERT`, `UPDATE`, `UPSERT` / `REPLACE`, `DELETE`, `DECLARE`, `RETURN`, assignments, `CALL`, `SIGNAL` / `RESIGNAL`, `IF` / `ELSEIF` / `WHILE` conditions, and `VIEW` / `COLUMN | ROW TABLE` / `SEQUENCE` DDL.
  - Reports tokens left over at a clause boundary (`FROM t a b`, `SELECT a b c`, `WHERE a = 1 foo`, `ORDER BY x y`, `DECLARE v INT = 1 junk;`) and clause-keyword typos (`WHEREE`, `GROUPP BY`, `ORDR`, `ANDD`, `DSC`) with a `HANA-SYN-021` QuickFix. Unmodelled keywords, special-syntax function arguments, and long-tail column attributes end validation silently, and existing rules keep precedence (one diagnostic per statement).
- **Specs & Tests:**
  - Documented `HANA-SYN-005`, `HANA-SYN-006`, and `HANA-SYN-040` – `HANA-SYN-042` in `docs/specs/diagnostics/syntax-rules.md`, and added the character set / token separation rules and the corrected header, trigger, and `DO` productions to `docs/specs/grammars/sql-sqlscript.md`.
  - Added `test/sql-lexical.test.ts`, `test/sql-header-parser.test.ts`, `test/sql-statement-starters.test.ts`, and `test/sql-clause-parser.test.ts` (positive, negative, and QuickFix round-trip coverage), plus a sweep asserting every SQL sample in `samples/` analyzes with zero syntax diagnostics, bringing the test suite to `156/156` passing.

### Changed

- **Routine Header Checks (`src/analyzer/sql-context.ts`, `src/analyzer/syntax.ts`, `HANA-SYN-021`, `HANA-SYN-028`):** Replaced the skip-loops in `tryParseRoutineHeader` and the `inRoutineHeader` typo scan with the consuming header parser; `HANA-SYN-028` placement and compatibility checks are now derived from the parsed clause list (messages unchanged). Skips virtual routines in the missing-`RETURNS` check.
- **Shared Typo Matching (`src/analyzer/typo.ts`):** Moved `damerauLevenshtein` and `matchKeywordTypo` into a shared module (still re-exported from `syntax.ts`) and added `suggestSlotKeyword` for follow-set matching of short keywords.
- **Grammar Spec Corrections (`docs/specs/grammars/sql-sqlscript.md`):** Removed `//` line comments and the unsupported `~=` / `^=` operators from the SQL / SQLScript lexical tokens (the SQL Reference defines only `--` / `/* */` comments and `=`, `>`, `<`, `>=`, `<=`, `!=`, `<>`). Moved block modifiers (`SEQUENTIAL EXECUTION`, ...) after `BEGIN` and the table-UDF result cache after `END`.
- **Repository Line Endings (`.gitattributes`, `.vscode/settings.json`):** Enforced LF line endings and renormalized existing CRLF files.

### Fixed

- **Silently Accepted Broken SQL / SQLScript (`src/analyzer/syntax.ts`):** Corrupted artifacts such as an `.hdbfunction` header ending in `SQL SECURITY INVOKER,,,,.//asd/.AWlpqwkr` followed by `ASd` previously produced zero diagnostics; stray punctuation, `//` text, misspelled header keywords, missing `AS`, bogus statements, and trailing garbage inside clauses are now reported.

## [0.9.0] - 2026-11-17

### Changed

- **Specs & Roadmap (`docs/specs/SPEC_RULES.md`, `docs/specs/diagnostics/syntax-rules.md`, `ROADMAP.md`):**
  - Documented `HANA-SYN-023` clause-syntax exclusions (`HIERARCHY*`, `OPENCYPHER_TABLE`, `JSON_VALUE` / `JSON_QUERY`), `JSON_TABLE` entry-level column list checking, and scoped `HANA-SYN-024` hierarchy clause terminators with platform tags in `docs/specs/diagnostics/syntax-rules.md`.
  - Upgraded `docs/specs/SPEC_RULES.md` with visual/diagram distillation rules (`images_catalog.md` / `./images/*.png` source references without copying binaries), Custom-PDF `<pre>` clipping cross-checks, `HANA-SYN-XXX` diagnostic template fields (`Platform Scope`, `Diagnostic Span & Message`, multi-language fences), and aligned `system-views.json` / `xsjs-api.json` schemas; synced `ROADMAP.md` with v0.8.0 support (95 extensions, `HANA-SYN-001` – `HANA-SYN-034`, remaining Phase 3 tasks, and Phase 4 spec foundations).
- **Contributor Rules & Packaging (`AGENTS.md`, `GEMINI.md`, `.vscodeignore`):**
  - Split OS-scoped Antigravity / Gemini terminal execution rules from `AGENTS.md` into `GEMINI.md` and excluded both `AGENTS.md` and `GEMINI.md` from `.vsix` packaging in `.vscodeignore`.

### Fixed

- **Clause-Syntax SQL Function False Positives (`src/analyzer/syntax.ts`, `HANA-SYN-023`, `HANA-SYN-024`):**
  - **`HIERARCHY*` Generators & Navigators & `OPENCYPHER_TABLE`:** Added the 9 clause-syntax `HIERARCHY*` functions (`HIERARCHY`, `HIERARCHY_LEVELED`, `HIERARCHY_SPANTREE`, `HIERARCHY_TEMPORAL`, `HIERARCHY_ANCESTORS`, `HIERARCHY_ANCESTORS_AGGREGATE`, `HIERARCHY_DESCENDANTS`, `HIERARCHY_DESCENDANTS_AGGREGATE`, `HIERARCHY_SIBLINGS`) and `OPENCYPHER_TABLE` to `SPECIAL_CALL_NAMES` while keeping `HIERARCHY_COMPOSITE_ID` comma-checked alongside nested `LEVELS (...)`, `MEASURES (...)`, `PARAMETERS (...)`, `IN (...)`, function calls, and `SOURCE` / `START` subqueries. Scoped `HIERARCHY_CLAUSE_TERMINATORS` (`SOURCE`, `START`, `JOIN`, `MEASURES`, `DISTANCE`, `LEVELS`, `SIBLING`, `VALID`, `DEPTH`, `MULTIPARENT`, `ORPHAN`, `CYCLE`, `CACHE`, `NO`, `LOAD`, `RETAIN`) to `START WHERE` / `WHERE` / `JOIN ... ON` conditions inside top-level `HIERARCHY*` call frames after complete operands, and prevented `UNTIL` inside `HIERARCHY_TEMPORAL` `VALID FROM ... UNTIL ...` from opening a loop condition while preserving `depth` / `valid` as plain SQL column names.
  - **`JSON_VALUE` & `JSON_QUERY`:** Stopped top-level argument comma checking at the first trailing clause keyword (`RETURNING`, `WITH`, `WITHOUT`, `ERROR`, `NULL`, `DEFAULT`, `EMPTY`, `ON`, `KEEP`, `OMIT`) while keeping `<ctx>, <path>` and nested type arguments (`RETURNING DECIMAL(10, 2)`) validated.
  - **`JSON_TABLE` `COLUMNS (...)` Lists:** Added entry-level `json_columns` paren-frame validation (including `NESTED [PATH] '...' COLUMNS (...)`) accepting space-separated clauses (`FOR ORDINALITY`, `FORMAT JSON`, `PATH '...'`, `ON EMPTY` / `ON ERROR`, wrapper clauses) while flagging missing commas between complete column entries with the `Insert ','` QuickFix.
  - **Tests (`test/syntax-analyzer.test.ts`):** Added positive, negative, and regression tests covering all 9 `HIERARCHY*` functions (across `.sql`, `.hdbprocedure`, `.hdbfunction`, and `.hdbview`), `HIERARCHY_COMPOSITE_ID`, `OPENCYPHER_TABLE`, `JSON_VALUE`, `JSON_QUERY`, and `JSON_TABLE`.

## [0.8.0] - 2026-11-15

### Added

- **Syntax QuickFixes & Refactors (`HANA-SYN-004`, `HANA-SYN-028`, `HANA-SYN-029`):**
  - **Redundant HDI `CREATE` Detection & QuickFix (`src/analyzer/syntax.ts`, `HANA-SYN-004`):** Emits a `warning` diagnostic when a headerless HDI DDL artifact begins with a redundant `CREATE` or `CREATE OR REPLACE` prefix in front of an expected root keyword, paired with a preferred `Remove leading 'CREATE'` / `Remove leading 'CREATE OR REPLACE'` QuickFix.
  - **`.hdblibrary` Visibility, `CONSTANT` & Relocation Actions (`src/analyzer/sql-context.ts`, `HANA-SYN-028`, `HANA-SYN-029`):** Adds preferred `Add 'PRIVATE'` and alternative `Add 'PUBLIC'` QuickFixes for library members missing visibility modifiers, a preferred `Add 'CONSTANT'` QuickFix for initialized non-constant `VARIABLE` declarations (supporting `DEFAULT`, `=`, and `:=` initializers), and a non-preferred `refactor` action (`Move declaration before first member`) that relocates out-of-order library variables ahead of the first member procedure or function.
- **Specs & Tests:**
  - Updated `docs/specs/diagnostics/syntax-rules.md` for `HANA-SYN-004`, `HANA-SYN-028`, and `HANA-SYN-029` QuickFixes and refactors, and expanded `test/syntax-analyzer.test.ts` with positive, negative, multi-edit replacement, and library variable coverage.

### Changed

- **Aggregated Single-Object HDI Trailing Diagnostics (`src/analyzer/syntax.ts`, `HANA-SYN-004`):** Aggregates multiple trailing top-level statements after the single root HDI object completes into one diagnostic spanning from the first trailing token through the last non-comment trailing token (reporting the trailing statement count when multiple trailing statements are present), paired with a preferred `Remove trailing statement` / `Remove trailing statements` QuickFix that preserves comments after the final trailing token.

### Fixed

- **`.hdblibrary` Variable Name Parsing & Trigger Block Precedence (`src/analyzer/sql-context.ts`, `HANA-SYN-028`, `HANA-SYN-029`):** Parsed qualified and quoted `.hdblibrary` `VARIABLE` identifiers accurately via `skipQualifiedName` before initializers so `Add 'CONSTANT'` offsets remain accurate, and suppressed secondary `autonomous` / `parallel` body diagnostics inside `TRIGGER` blocks where `BEGIN AUTONOMOUS TRANSACTION` or `BEGIN PARALLEL EXECUTION` is already rejected at the block header while preserving direct `TRIGGER` restrictions.

## [0.7.0] - 2026-11-15

### Added

- **SQL & SQLScript Order, Context & HDI Root Diagnostics (`HANA-SYN-004`, `HANA-SYN-027` – `HANA-SYN-029`):**
  - **`SELECT` Clause Ordering & Duplicates (`src/analyzer/sql-order.ts`, `HANA-SYN-027`):** Pure-TypeScript query analyzer tracking `(parenDepth, bracketDepth)` nesting levels to enforce canonical SAP HANA clause precedence (`SELECT` [pre-`FROM` `INTO`] -> `FROM` -> `WHERE` -> `GROUP BY` -> `HAVING` -> `WINDOW` -> `UNION`/`INTERSECT`/`EXCEPT`/`MINUS` -> `ORDER BY` -> `LIMIT` -> `OFFSET` -> `FOR UPDATE`/`FOR SHARE LOCK`/`FOR XML`/`FOR JSON` -> post-`FROM` `INTO` -> `WITH HINT`) and detect duplicate non-repeatable clauses, isolating subqueries, `CASE ... END`, `OVER`/`WITHIN GROUP`, temporal `FROM`, `IS DISTINCT FROM`, `FOR ... DO` cursor loops, and privilege/audit statements.
  - **SQLScript Routine Header, Block Declaration & `.hdblibrary` Ordering (`src/analyzer/sql-context.ts`, `HANA-SYN-028`):** Validates routine header clause placement before `AS` without duplicates (`RETURNS`, `LANGUAGE`, `SQL SECURITY`, `DEFAULT SCHEMA`, `READS SQL DATA` [permitted optionally in `FUNCTION` headers], `DETERMINISTIC`, `WITH ENCRYPTION`, `AUTOCOMMIT DDL`, `[NO] STRUCTURED FILTER CHECK`), rejects incompatible header options and `OUT`/`INOUT` modes on `FUNCTION`, restricts `USING` library imports to routine root level, enforces compound block declaration ordering (`BEGIN` modifier -> `DECLARE` variables/cursors/conditions -> `DECLARE EXIT|CONTINUE HANDLER` -> executable statements), detects `EXIT`/`CONTINUE` handler scope conflicts and duplicate condition handlers, flags unreachable statements after `RETURN`/`SIGNAL`/`RESIGNAL`/`BREAK`/`CONTINUE` (`warning` with `unnecessary` tag), and validates `.hdblibrary` member ordering (`USING` -> `VARIABLE` -> `PROCEDURE`/`FUNCTION`) and `CONSTANT` initializers.
  - **Context-Sensitive SQL & SQLScript Legality (`src/analyzer/sql-context.ts`, `HANA-SYN-029`):** Enforces read-only restrictions inside `FUNCTION` and `READS SQL DATA` `PROCEDURE` bodies (disallowing persistent DML writes while permitting `:table_var` mutations, DDL, transaction control, dynamic SQL, `BEGIN AUTONOMOUS TRANSACTION`, plus `CALL` and `BEGIN PARALLEL EXECUTION` inside `FUNCTION`), warns on non-deterministic built-ins and `.NEXTVAL`/`.CURRVAL` inside `DETERMINISTIC` routines, checks `RETURN` / `RETURN <expr>` semantics across Table UDFs vs Scalar UDFs / procedures / triggers / `DO`, validates `BREAK`/`CONTINUE` loop nesting, `RESIGNAL` handler scope, `SIGNAL SQL_ERROR_CODE` (`10000..19999`), nested `DO BEGIN`, `BEGIN PARALLEL EXECUTION` / `BEGIN AUTONOMOUS TRANSACTION` restrictions, top-level imperative statements, `.hdblibrary` `PUBLIC`/`PRIVATE` member visibility and direct-statement prohibitions, and `.hdbtrigger` body restrictions.
  - **Strict HDI Artifact Root & Single-Object Enforcement (`src/analyzer/syntax.ts`, `HANA-SYN-004`):** Flags unexpected non-typo root keywords and mismatched `CREATE [OR REPLACE] <object>` targets in headerless HDI SQL DDL artifacts (preserving `HANA-SYN-021` typo QuickFixes), and adds `checkSingleObjectHdiTrailing` to reject trailing top-level statements after the single object completes (allowing `USING ...;` headers before root `BEGIN` and excluding `.hdbdropcreatetable`, `.sql`/`.hanasql`, and `.hdbmigrationtable`).
- **Specs & Tests:**
  - Documented `HANA-SYN-004` and `HANA-SYN-027` – `HANA-SYN-029` in `docs/specs/diagnostics/syntax-rules.md` and expanded `test/syntax-analyzer.test.ts` (positive, negative, edge-case, multi-violation, and QuickFix coverage), bringing the test suite to `122/122` passing.

### Changed

- **HDI Syntax Analyzer Coverage (`src/analyzer/syntax.ts`):** Expanded `SQLSCRIPT_BLOCK_LANGUAGES` with `hdbscalarfunction`, `hdblibrary`, `hdbvirtualprocedure`, and `hdbvirtualfunction`, and updated `HDI_ROOT_TARGETS` (`hdbscalarfunction`, `HASH`/`BLOCK` for `hdbcollectionindex`, and `SHARED` for `hdbfabricvirtualtable`).

## [0.6.0] - 2026-11-15

### Added

- **Offline Lexical & Structural Syntax Error Diagnostics (`HANA-SYN-*`):**
  - **Shared Delimiter & Recovery Engine (`src/analyzer/delimiters.ts`):** Pure-TypeScript bracket matcher (`()`, `[]`, `{}`) with statement/type-dimension boundary fencing and indentation- and nesting-aware minimum-cost alignment to pinpoint inner unbalanced delimiters without cascading false positives (`HANA-SYN-003`, `HANA-SYN-010`, `HANA-SYN-031`).
  - **SQL, SQLScript, CDS, Classic KV, `.xsodata`, `.hdbrole` & `.hdbmigrationtable` (`src/analyzer/syntax.ts`, `HANA-SYN-001` – `HANA-SYN-003`, `HANA-SYN-020` – `HANA-SYN-026`):**
    - Lexical checks for unterminated strings (preserving valid multiline SQL `'...'` and `''` / backslash escapes), single-line quoted identifiers with same-line quote-chain localization, CDS `![...]` expressions, and unterminated `/* ... */` block comments (`HANA-SYN-001` – `HANA-SYN-002`), scanning `-- hanasql-format off` regions and isolating `.hdbmigrationtable` `== version` / `== dev-version` / `== migration` sections.
    - SQLScript compound block matching (`BEGIN..END`, `IF..END IF`, `FOR..END FOR`, `LOOP..END LOOP`, `WHILE..END WHILE`, `CASE..END`) skipping `LANGUAGE R` / `RLANG` / `GRAPH` bodies and DDL `IF EXISTS` (`HANA-SYN-020`).
    - Anchored header, signature, SQL clause, and CDS keyword typo detection with QuickFixes (`HANA-SYN-021`), Classic Key-Value validation preserving `.hdbview` and `.hdbti` tolerances (`HANA-SYN-022`), missing comma checks with QuickFixes (`HANA-SYN-023`), missing/dangling/consecutive SQL operators and trailing commas with QuickFixes (`HANA-SYN-024`), incomplete SQL clauses and missing `;` between statements inside `BEGIN..END` with QuickFixes (`HANA-SYN-025`), and CDS `.hdbdd` / `.hdbcds` missing `:`, type, and `;` checks (`HANA-SYN-026`).
  - **Strict JSON / JSONC Parser with Recovery AST (`src/analyzer/json-parser.ts`, `HANA-SYN-010` – `HANA-SYN-011`):** Added `parseJsonAstWithErrors` across JSON/JSONC artifacts and HDI JSON `.hdbrole` to preserve partial ASTs for downstream security checks (`HANA-SEC-*`) while diagnosing syntax errors (`HANA-SYN-010`, honoring `.xssqlcc` omitted commas and `.xsapp` empty marker files) and trailing commas with a 1-click QuickFix (`HANA-SYN-011`).
  - **XSJS / XSJSLIB Regex-Aware Syntax Diagnostics (`src/analyzer/xsjs.ts`, `HANA-SYN-030` – `HANA-SYN-034`):** Detects unterminated strings, regex literals (disambiguated from division `/`), template literals with nested `${...}` expressions, and block comments (`HANA-SYN-030`), unmatched/unclosed JS delimiters and `${...}` interpolations (`HANA-SYN-031`), anchored JS keyword typos with QuickFixes (`HANA-SYN-032`), missing commas in call/array lists with QuickFixes (`HANA-SYN-033`), and missing, dangling, or consecutive binary operators (`HANA-SYN-034`).
- **Analyzer Settings, Spec & Tests:**
  - Added `hanasql.analyze.syntax` setting (`package.json`, `src/analyzer/types.ts`, `src/analyzer/vscode-provider.ts`) and expanded `ANALYZER_LANGUAGES` in `src/analyzer/dispatch.ts` across all SQL, JSON, dedicated DDL/KV, and XSJS language IDs, honoring `@AnalyzerSuppress` / `hanasql-analyze-disable` pragmas.
  - Added `docs/specs/diagnostics/syntax-rules.md` and `test/syntax-analyzer.test.ts` (positive, negative, QuickFix, quote/delimiter localization, and zero-false-positive sample audit across `samples/`), bringing the test suite to `116/116` passing.

### Changed

- **SQL Tokenizer Options (`src/formatter/tokenizer.ts`):** Extended `tokenize` with `TokenizeOptions` (`collapseFormatOff`, `slashComments`, `singleLineQident`) so syntax analysis inspects `-- hanasql-format off` regions verbatim, recognizes `//` comments in Classic KV / CDS / `.xsodata` / `.hdbrole`, and stops runaway double-quoted identifiers at line breaks without changing formatter behavior.

## [0.5.0] - 2026-11-15

### Added

- **Phase 3 Offline Static Analyzers & QuickFixes (`src/analyzer/`):**
  - **Security Diagnostics (`HANA-SEC-001` – `HANA-SEC-042`):** Detects SQLScript dynamic SQL concatenation and unsanitized `EXEC` / `EXECUTE IMMEDIATE` / `APPLY_FILTER` inputs, `SQL SECURITY DEFINER` privilege risks, XSJS SQL injection, legacy `$.db` usage, reflected XSS (`$.response.setBody`), `.xsaccess` misconfigurations (`authentication`, `prevent_xsrf`, `anonymous_connection`, `cors`, `force_ssl`, `X-Frame-Options`), and `.hdbrole` / `.hdbgrants` / `.hdbrevokes` over-privileged grants (`WITH GRANT OPTION`, `#` role suffix rules, `ALL PRIVILEGES`, `application_user` DDL/write grants), with automated QuickFixes.
  - **SQLScript Performance & Lint Rules (`HANA-PERF-001` – `HANA-PERF-007`, `HANA-LINT-001` – `HANA-LINT-002`):** Flags legacy `CE_*` plan operators (escalated to `Error` when `hanasql.analyze.targetPlatform` is `cloud`), mixed `CE_*` and SQL blocks, imperative cursor loops, `SELECT *`, DML inside loops, dynamic SQL/DDL, `CARDINALITY` / `TRACE`, empty `DECLARE EXIT HANDLER` blocks, and unreliable `::ROWCOUNT` usage, with `CE_*` -> SQL and `EXIT HANDLER` QuickFixes plus `@AnalyzerSuppress(...)` and `-- hanasql-analyze-disable` suppression support.
  - **Calculation View XML Schema & Graph Validation (`HANA-LINT-101` – `HANA-LINT-107`):** Validates `.calculationview` and `.hdbcalculationview` XML structure, `<input node="#...">` resolution and cycle detection, node arity constraints, `<logicalModel>` and `CUBE`/`DIMENSION` measure rules, duplicate IDs, legacy `ANALYTIC_PRIVILEGE` / `NONE` privilege settings, and XSC-only constructs (`columnObject@schemaName`, `defaultSchema`, deprecated `Calculation:ScriptView`) with QuickFixes.
- **Bidirectional XSC <-> HDI / XSA Migration & Refactoring (`src/analyzer/migrator.ts`):**
  - **Rules & CodeActions (`HANA-MIG-001` – `HANA-MIG-020`):** Supports bidirectional AST conversion between Classic KV and HDI DDL for `.hdbtable`, `.hdbview`, and `.hdbsequence`, plus XSC -> HDI conversion for classic `.hdbrole`, `.hdbdd` (including inline `@Schema` and single-line entities) -> `.hdbcds`, and `.hdbstructure` -> `.hdbtabletype`, alongside cleanup diagnostics/QuickFixes for `DEFAULT SCHEMA`, `_SYS_BIC`, `.hdbschema` / `.hdbti` / `.xsodata`, and deprecated XSJS `$.repo` APIs.
  - **Commands & Settings (`package.json`, `src/analyzer/vscode-provider.ts`):** Added `hanasql.migrateArtifactToHdi`, `hanasql.convertArtifactToXsc`, and `hanasql.analyze.*` (`enable`, `security`, `performance`, `migration`, `calculationView`, `targetPlatform`) settings.
- **Zero-Config Offline IntelliSense & Code Snippets (`src/xsjs/`, `src/sql/`, `snippets/`):**
  - **XSJS, XSDS & XSUnit IntelliSense:** Added `resources/xsjs.d.ts` generator (`scripts/build-xsjs-dts.js`), `src/xsjs/xsjs-catalog.ts`, and Completion, Hover, and SignatureHelp providers covering `$.*`, `$.import(...)` package/library string completions, `sap.hana.xs.libs.dbutils` (`xsds`, `procedures`), `sap.hana.testtools` (`mockstar`, `unit.util`), and `jasmine` / XSUnit BDD globals, plus `hanasql.installXsjsTypes` and `hanasql.xsjs.enableIntelliSense`.
  - **SQL, SQLScript & Design-Time Artifact IntelliSense:** Added `src/sql/sql-catalog.ts` (`scripts/build-sql-catalog.js`, `scripts/build-catalogs.js`) and providers for case-adapted SQL keywords/types/functions, `::` SQLScript system variables, `USING [SYS.]SQLSCRIPT_*` library members (`alias:member`), local `:var` parameters/declarations, `.xsaccess` / `.hdiconfig` / `.hdbgrants` / `.hdbrevokes` / JSON `.hdbrole` properties, Classic KV artifact keys, and `hanasql.sql.enableIntelliSense`.
  - **VS Code Snippets (`snippets/`):** Contributed `sqlscript.code-snippets`, `artifacts.code-snippets`, and `xsjs.code-snippets`.
- **Phase 3 Specs, Catalogs, Samples & Tests:**
  - Added specs in `docs/specs/diagnostics/` (`security-rules.md`, `performance-rules.md`, `migration-xsc-to-hdi.md`, `sql-intellisense.md`) and `docs/specs/artifacts/calculationview-schema.md`, plus `docs/specs/catalogs/xsjs-api.json` and expanded `builtin-functions.json`.
  - Added sample `samples/hdi/CV_SALES_PROJECTION.hdbcalculationview` and 6 new test suites (`security-analyzer`, `performance-analyzer`, `calculationview-validator`, `migration-transformer`, `xsjs-intellisense`, `sql-intellisense`) bringing the test suite to `103/103` passing.

### Changed

- **Build Scripts & Roadmap (`package.json`, `ROADMAP.md`, `docs/research/CHECKLIST.md`):** Added `build:sql-catalog` and `build:xsjs-dts` scripts, chained `build:sql-catalog` into `build:keywords`, and marked Phase 3 complete in `ROADMAP.md`.

### Fixed

- **XSJS Nested Block Highlighting (`syntaxes/xsjs-injection.tmLanguage.json`, `syntaxes/xsjs.tmLanguage.json`, `scripts/build-grammars.js`, `package.json`):** Registered a `xsjs.injection` grammar targeting `source.xsjs` so `$.*` API property and method scopes highlight reliably inside nested JS blocks, verified with nested API highlighting assertions in `test/grammar.test.ts`.

## [0.4.1] - 2026-11-15

### Fixed

- **XSJS Grammar (`syntaxes/xsjs.tmLanguage.json`, `scripts/build-grammars.js`):** Added `$.application` (`$.Application`) to the highlighted XS JavaScript API root namespaces, alongside positive and negative grammar test coverage (`samples/xs-classic/lib.xsjs`, `test/grammar.test.ts`).

## [0.4.0] - 2026-11-15

### Added

- **Phase 2 AST Formatters Across Design-Time Artifacts:**
  - **Classic Key-Value (`src/formatter/classic-kv.ts`):** Pure-TypeScript AST formatter for `.hdbtable`, `.hdbstructure`, `.hdbview`, `.hdbsequence`, `.hdbschema`, `.hdbti`, `.xshttpdest`, `.hdbtid`, and `.hdbtim`, including comment preservation, `-- hanasql-format off` pragmas, semicolon recovery, and embedded SQL formatting inside `query` and `reset_by` string literals.
  - **CDS Models (`src/formatter/cds.ts`):** AST formatter for `.hdbdd` and `.hdbcds` (`namespace`, `using`, `@Annotation` placement, `context`, `entity`, `type`, `view`, `select from`, `mixin`/`into`, `where`/`group by`/`order by`, CAP identifiers, and `technical configuration`).
  - **XS OData (`src/formatter/xsodata.ts`):** AST formatter for `.xsodata` (`service`, short and multi-clause entity exposures, `association`, `navigates`, modification exits, `settings`, and annotations).
  - **Tolerant JSON / JSONC (`src/formatter/json.ts`):** AST formatter for 28 JSON-based SAP HANA design-time artifacts (`.hdiconfig`, `.hdbgrants`, `.hdbrevokes`, `.hdbtabledata`, `.hdbsynonym`, `.xsaccess`, `.xsapp`, `.xsjob`, `.xssqlcc`, etc.) plus HDI JSON `.hdbrole`, preserving comments, `hanasql-format off` pragmas, and tolerating malformed inputs (such as `.xssqlcc` missing commas).
  - **Classic & HDI Roles (`src/formatter/hdbrole.ts`):** Content sniffer (`isClassicHdbrole`) and AST formatter supporting both classic XSC `.hdbrole` DSL and HDI JSON `.hdbrole`.
  - **HDI Migration Tables (`src/formatter/migration-table.ts`):** Section-aware formatter for `== version`, `== dev-version`, and `== migration` blocks with SQL body formatting and `--` / `/* ... */` pragma preservation.
  - **XS JavaScript Delegation (`src/formatter/xsjs.ts`, `src/extension.ts`):** Formats `.xsjs` and `.xsjslib` via a virtual document (`hanasql-xsjs-format:/delegate.js`) delegated to VS Code's built-in JS/TS formatter while masking `hanasql-format off`/`on` pragma regions.
- **Formatting Specs, Demos & Tests:**
  - Added canonical formatting specifications in `docs/specs/artifacts/` (`classic-kv-formatting.md`, `hdbrole-formatting.md`, `json-formatting.md`, `xsjs-formatting.md`) and updated `docs/specs/grammars/` (`cds.md`, `sql-sqlscript.md`, `xsodata.md`), `docs/research/CHECKLIST.md`, and `ROADMAP.md`.
  - Added 16 unformatted demonstration fixtures under `samples/format-demos/` and comprehensive unit/integration tests in `test/artifact-format.test.ts` (`73/73` total tests passing).
- **CI/CD Workflows (`.github/workflows/`):**
  - Added `ci.yml` (Node `lts/*` and `current` build, generated grammar/keyword sync verification, unit tests, and VSIX dry-run packaging) and `release.yml` (automated VSIX GitHub Releases and VS Code Marketplace publishing via `--oidc`).

### Changed

- **Manifest Formatter Bindings (`package.json`, `src/formatter/dispatch.ts`):** Bound `editor.defaultFormatter` (`l1asis.sap-hana-dev-tools`) and `activationEvents` for all 72 registered formatter languages (`ALL_FORMATTER_LANGUAGES`), and routed dual-syntax XSC KV / HDI DDL extensions (`.hdbtable`, `.hdbstructure`, `.hdbview`, `.hdbsequence`) via content inspection.
- **HDI Headerless SQL Safety (`src/formatter/formatter.ts`):** Preserved omitted trailing semicolons on headerless HDI root statements including `.hdbprocedure` / `.hdbfunction` with `USING` library clauses, `.hdblibrary`, `.hdbtabletype`, and `.hdbprojectionview`.
- **Contributor Documentation (`AGENTS.md`):** Updated workflow, issue/PR automation, and Windows PowerShell rules.

## [0.3.0] - 2026-11-15

### Added

- **13 New Design-Time File Extensions (95 Total Supported Extensions):**
  - **HDI Headerless SQL DDL (`source.hanasql`):** `.hdbcollectionadjindex` (`ADJACENCY INDEX`) and `.hdbfabricvirtualtable` (`SHARED [SNAPSHOT] REPLICA [PAGE|COLUMN LOADABLE] ON`), alongside dedicated language registration for `.hdbcollectionindex`.
  - **HDI JSON / JSONC Configuration:** `.hdbfabricvirtualtableconfig`, `.hdbvirtualpackage`, `.hdbvirtualpackagehadoop`, `.hdbvirtualpackagesparksql`, and `.hdbmrjob`.
  - **XS Classic JSON & XML Models:** `.xsappsite` (tolerant JSON), `.hdbdecisiontable`, and `.xswidget` (SAP HANA XML).
  - **Classic Service & Table Import Definitions:** `.xsxmla` (`service { ... }` blocks and repository object refs), `.hdbtid`, and `.hdbtim`.
- **14 Custom File Icons (`images/icons/`):** Dedicated SVG icons bound for `.hdbcollectionindex`, `.hdbcollectionadjindex`, `.hdbfabricvirtualtable`, `.hdbfabricvirtualtableconfig`, `.hdbvirtualpackage`, `.hdbvirtualpackagehadoop`, `.hdbvirtualpackagesparksql`, `.hdbmrjob`, `.xsappsite`, `.hdbdecisiontable`, `.xswidget`, `.xsxmla`, `.hdbtid`, and `.hdbtim`.
- **Artifact Specifications (`docs/specs/artifacts/`):** Added distilled specs for `.hdiconfig`, `.hdbcollectionindex` / `.hdbcollectionadjindex`, `.hdbfabricvirtualtable` / `.hdbfabricvirtualtableconfig`, `.hdbvirtualpackage*` / `.hdbmrjob`, and legacy XS Classic artifacts, plus updated `sql-sqlscript.md` and `README.md`.
- **Samples & Tests:** Added HDI and XS Classic sample files in `samples/` and expanded `test/grammar.test.ts` and `test/format.test.ts` (`52/52` passing, including icon file existence validation).

### Changed

- **`.hdiconfig` Grammar:** Recognized `"properties"`, `"tags"`, `"csv"`, `"txt"`, and `"jar"` as valid `entity.name.type.hdiconfig` plug-in suffix keys without registering generic extensions globally.
- **SQL Grammar & Formatter (`hanasql`):** Added headerless `ADJACENCY INDEX`, `BLOCK RANGE INDEX`, and `SHARED [SNAPSHOT] REPLICA [PAGE|COLUMN LOADABLE] ON` rules, updated `HDI_FIRST` root detection and `STATEMENT_NOUNS` casing so headerless collection indexes and fabric virtual tables format cleanly without trailing semicolons, and wired `SQL_LANGUAGES` for the new SQL artifact IDs.

## [0.2.0] - 2026-11-14

### Added

- **Grammar Specifications & Lexical Catalogs (`docs/specs/`):**
  - Distilled compiler-grade grammar specs for CDS (`cds.md`), CGUL Text Analysis (`cgul-text-analysis.md`), Classic Key-Value & Embedded SQL (`hdb-classic-kv.md`), XS OData (`xsodata.md`), and SQL/SQLScript (`sql-sqlscript.md`).
  - Added machine-readable SQL keyword (`sql-keywords.json`, 471 entries) and built-in function/library (`builtin-functions.json`, 538 entries) catalogs covering HANA 2.0 SPS 08 and SAP HANA Cloud.
- **HANA Cloud & Multi-Engine SQL Highlighting:** Added `ST_*` spatial functions, `REAL_VECTOR`/`HALF_VECTOR` & `HNSW` vector index clauses, Property Graph / OpenCypher (`OPENCYPHER_TABLE`), Knowledge Graph (`SPARQL_TABLE`, `SPARQL_EXECUTE`), Hierarchy generators/navigators, JSON Document Store (`JSON_TABLE`, `PARSE_JSON`), and `SYS.SQLSCRIPT_*` library members/pragmas.
- **Unit Tests:** Added positive and negative TextMate grammar test suites for CGUL, XS OData, Classic Key-Value, CDS, and HANA Cloud SQL/SQLScript (`50/50` passing).

### Changed

- **Text Analysis (CGUL) Grammar:** Refined `.hdbtextrule`, `.hdbtextinclude`, and `.hdbtextlexicon` highlighting for `--` comments, `#include`/`#lexicon` quoted paths, all `#` directives, token specifiers (`STEM`, `POS`, `ORTH`, `REGEXP`, etc.), POS tags, slot bindings (`[label]:`), character classes, group references (`%(...)`), slot variables (`$slot`), and action blocks (`=>`, `->`).
- **XS OData Grammar:** Added `SUM`/`AVG`/`MIN`/`MAX` aggregate highlighting, multiplicity literals (`"1"`, `"0..1"`, `"1..*"`, `"*"`), `precommit`/`postcommit` exits, `storage`/`no storage`, and `OData4SAP` annotations.
- **Classic Key-Value & CDS Grammars:** Added `SchemaName`, struct-form `table.primaryKey`, `package` in `.hdbsynonym`, `table type`, `temporary entity`, `via entity`, `mixin`, `$projection`/`$parameters`, and `technical configuration` clauses.

## [0.1.1] - 2026-11-13

### Changed

- Renamed extension display name and documentation references from **SAP HANA Developer Tools** to **Developer Tools for SAP HANA**.
- Added legal disclaimer and trademark notice to `README.md`.

## [0.1.0] - 2026-11-13

### Added

- **Syntax Highlighting** for 60+ SAP HANA XS Classic (XSC), XS Advanced (XSA), and SAP HANA Cloud (HDI) file extensions.
- **Embedded SQL Highlighting** inside classic `.hdbview` (`query`) and `.hdbsequence` (`reset_by`) string literals.
- **XS JavaScript (`$`) Support** for `.xsjs` and `.xsjslib` files (`$.import`, `$.hdb`, `$.db`, `$.request`, `$.response`, `$.net`, `$.session`).
- **CDS Highlighting** for both XS Classic (`.hdbdd`) and XS Advanced (`.hdbcds`).
- **Configurable HANA SQL & SQLScript Formatter** (`hanasql.format.*`) supporting keyword/function/type casing, leading/trailing commas, line wrapping, and `-- hanasql-format off` regions.
- **HDI & Classic Formatter Safety:** Automatically skips `key = value;` classic configuration files and prevents unwanted trailing semicolons on root HDI design-time statements.
