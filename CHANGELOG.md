# Changelog

All notable changes to the **Developer Tools for SAP HANA** extension will be documented in this file.

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
