# Project Roadmap

Our goal is to provide a complete, modern replacement for SAP HANA Studio (Eclipse) inside VS Code—supporting both **XS Classic (XSC)** and **XS Advanced / HDI (XSA)** workflows.

## Feature Progress Matrix

**Legend:**

* 🟢 **Complete** — Shipped and covered by unit tests
* 🟡 **In Progress / Partial** — Basic support shipped; expanding edge cases
* 🔵 **Planned (Next Up)** — Scheduled for upcoming milestones
* ⚪ **Backlog / N/A** — Future phase or not applicable to this artifact

| Artifact Family | Syntax Highlighting | AST Formatter | Offline LSP, Linter & Suggestions | XSC <-> XSA Migrator | Live DB Activate / Deploy |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **SQL & SQLScript** (`.sql`, `.hdbprocedure`, `.hdbfunction`) | 🟢 Complete | 🟢 Complete | 🟢 Complete | 🟡 QuickFixes | ⚪ Phase 4 |
| **HDI Headerless SQL** (`.hdbtabletype`, `.hdbprojectionview`, etc.) | 🟢 Complete | 🟢 Complete | 🟢 Complete | ⚪ N/A | ⚪ Phase 4 |
| **Classic & HDI Tables/Views** (`.hdbtable`, `.hdbview`, `.hdbsequence`) | 🟢 Complete | 🟢 Complete | 🟢 Complete | 🟢 Complete | ⚪ Phase 4 |
| **CDS Models** (`.hdbdd`, `.hdbcds`) | 🟢 Complete | 🟢 Complete | 🟡 Syntax & Hints | 🟢 Complete | ⚪ Phase 4 |
| **XS JavaScript** (`.xsjs`, `.xsjslib`) | 🟢 Complete | 🟢 Complete | 🟢 Complete | 🟡 `$.db`/`$.repo` | ⚪ Phase 4 |
| **XS OData** (`.xsodata`) | 🟢 Complete | 🟢 Complete | 🟡 Syntax & Hints | 🟡 Guidance | ⚪ Phase 4 |
| **Roles, Grants & JSON Configs** (`.hdbrole`, `.hdbgrants`, `.xsaccess`, `.hdiconfig`, etc.) | 🟢 Complete | 🟢 Complete | 🟢 Complete | 🟢 Complete | ⚪ Phase 4 |
| **Text Analysis (CGUL)** (`.hdbtextrule`, `.hdbtextlexicon`) | 🟢 Complete | ⚪ Backlog | ⚪ Backlog | ⚪ Backlog | ⚪ Phase 4 |
| **Calculation Views & XML** (`.calculationview`, `.hdbcalculationview`) | 🟢 Complete | ⚪ Backlog | 🟢 Schema & Graph | 🟡 QuickFixes | ⚪ Phase 4 |

---

## Engineering Phases

### Phase 1: Universal Syntax Highlighting (Completed)

* [x] TextMate grammars for 95 XS Classic, XS Advanced / HDI, and SAP HANA Cloud file extensions.
* [x] Embedded SQL highlighting inside classic `.hdbview` and `.hdbsequence` files.
* [x] HANA Cloud SQL keywords, vector types (`REAL_VECTOR`, `HALF_VECTOR`), and `SQLSCRIPT_*` libraries.
* [x] Refine edge-case grammar rules for CGUL rule bodies (`.hdbtextrule`) and complex `.xsodata` annotations.

### Phase 2: Formatters Across All Design-Time Artifacts (Completed)

* [x] Configurable HANA SQL & SQLScript formatter (`hanasql.format.*`) with HDI procedure semicolon safety and `-- hanasql-format off` pragmas.
* [x] Dedicated formatter for classic key-value artifacts (`.hdbtable`, `.hdbstructure`, `.hdbview`, `.hdbsequence`, `.hdbschema`, `.hdbti`, `.hdbtid`, `.hdbtim`, `.xshttpdest`).
* [x] AST formatter for `.hdbdd` / `.hdbcds` and `.xsodata` service definitions.
* [x] Tolerant JSON/JSONC formatter covering 28 JSON-based design-time artifacts (`.hdiconfig`, `.hdbgrants`, `.xsaccess`, `.xsapp`, `.hdbrole` HDI, etc.), classic `.hdbrole` DSL formatter, and `.hdbmigrationtable` section formatter.
* [x] XSJS / `.xsjslib` formatting via virtual-document delegation to VS Code's built-in JS/TS formatter with `hanasql-format off` pragma masking, plus `package.json` `defaultFormatter` bindings across all formatted languages.

### Phase 3: Offline Language Server (LSP), Static Analyzers & Migration Assistant (Core Shipped — Expanding Rules & Standalone LSP)

* [x] **XSJS, XSDS & XSUnit IntelliSense:** Inject generated `xsjs.d.ts` definitions (`$.*`, `sap.hana.xs.libs.dbutils.*`, `sap.hana.testtools.*`, `jasmine.*`, XSUnit BDD globals) and register zero-config Completion, Hover, and SignatureHelp plus `$.import(...)` module resolution for `.xsjs` and `.xsjslib`.
* [x] **SQL, SQLScript & Artifact Suggestions:** Keyword/type/function/system-variable completions, hover docs, signature help, `USING [SYS.]SQLSCRIPT_*` library member resolution (`alias:member`), local `DECLARE`/parameter `:var` completions, JSON/Classic KV property suggestions, and native SAP HANA code snippets.
* [x] **Offline Syntax Error Diagnostics & QuickFixes (`HANA-SYN-001` – `HANA-SYN-034`):**
  * Indentation- and nesting-aware delimiter recovery (`()`, `[]`, `{}`), lexical quote/comment validation (including same-line quote-chain localization), compound block matching (`BEGIN..END`, `IF..END IF`, `FOR..END FOR`), and anchored keyword typo QuickFixes across SQL, SQLScript, Classic KV, CDS, `.xsodata`, `.hdbrole`, and `.hdbmigrationtable`.
  * Strict `SELECT` clause ordering (`HANA-SYN-027`), routine header / compound block / `.hdblibrary` declaration ordering and QuickFixes (`HANA-SYN-028`), read-only `FUNCTION` / `READS SQL DATA` and `.hdbtrigger` legality (`HANA-SYN-029`), strict headerless HDI root & aggregated trailing-statement QuickFixes (`HANA-SYN-004`).
  * Recovery JSON/JSONC parser across 28 JSON artifacts with trailing-comma QuickFixes (`HANA-SYN-010` – `HANA-SYN-011`), plus regex- and template-aware `.xsjs`/`.xsjslib` syntax diagnostics (`HANA-SYN-030` – `HANA-SYN-034`).
* [x] **SQLScript Performance & Security Static Analyzers:**
  * Flag performance anti-patterns (`HANA-PERF-001` – `HANA-PERF-007`: legacy `CE_*` functions, mixing `CE_*` with SQL, cursor loops, `SELECT *`, DML in loops, dynamic SQL/DDL, `CARDINALITY`/`TRACE`) and error-handling gaps (`HANA-LINT-001` – `HANA-LINT-002`: empty `EXIT HANDLER`, unreliable `::ROWCOUNT`).
  * Flag security risks (`HANA-SEC-001` – `HANA-SEC-042`: dynamic SQL string concatenation without `USING` bind variables, `SQL SECURITY DEFINER` escalation, XSJS `$.db`/`$.response.setBody`, `.xsaccess`, `.hdbrole`, `.hdbgrants`, and `.hdbrevokes` least-privilege rules) and Calculation View XML schema/graph errors (`HANA-LINT-101` – `HANA-LINT-107`).
* [x] **Interactive XSC <-> XSA Migration CodeActions (`HANA-MIG-001` – `HANA-MIG-020`):**
  * Bidirectional AST conversion between classic `.hdbtable`/`.hdbview`/`.hdbsequence` and HDI DDL, plus `.hdbrole` / `.hdbdd` / `.hdbstructure` migration CodeActions and Command Palette commands.
  * Inline deprecation hints and AST QuickFixes for legacy `$.db` / `$.repo` calls and `CE_*` functions.
* [ ] **Consuming Parser & Catalog Hardening:** Replace remaining heuristic checks with consuming EBNF routine-header, Pratt expression, and statement-starter parsers, enrich `builtin-functions.json` parameter/return types, and add platform-aware rule filtering (`hanasql.analyze.targetPlatform`).
* [ ] **Visual Performance Rule Mining:** Distill PlanViz `Before` -> `After` optimizer and execution-engine diagrams from the extracted SAP HANA Performance & Troubleshooting guides into additional `HANA-PERF-*` diagnostics and QuickFixes.
* [ ] **Standalone Stdio/IPC LSP Package:** Extract the offline analyzer and IntelliSense engine into a standalone `vscode-languageserver` binary for external editors and CI validation.

### Phase 4: Workspace Schema Index, Live HANA Connectivity, `_SYS_REPO` & Git Integration

* [ ] **Connectivity & System View Specs:** Distill `_SYS_REPO` / `SYS.REPOSITORY_REST` (`SapBackPack`), `_SYS_DI`, and `@sap/hana-client` wire/SQL contracts into `docs/specs/connectivity/` and `docs/specs/catalogs/system-views.json`.
* [ ] **Offline Workspace Schema Index:** Incremental AST cache and cross-file table/view/CDS entity symbol indexing for table & column suggestions in SQL/SQLScript/XSDS.
* [ ] Secure connection manager powered by `@sap/hana-client` and VS Code `SecretStorage`.
* [ ] Live catalog explorer and schema-aware SQL autocomplete (`SYS.TABLES`, `SYS.VIEWS`, `SYS.PROCEDURES`).
* [ ] **XS Classic Repository Engine:** Check, Save Inactive, and Activate directly against `_SYS_REPO` / `SYS.REPOSITORY_REST` with line-level error diagnostics.
* [ ] **Git + HANA Sync Workflow:** Transactional "Activate-before-Commit" guard and branch-switch batch activation.
