# Changelog

All notable changes to the **Developer Tools for SAP HANA** extension will be documented in this file.

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
