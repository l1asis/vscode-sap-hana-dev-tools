# Project Roadmap

Our goal is to provide a complete, modern replacement for SAP HANA Studio (Eclipse) inside VS Code—supporting both **XS Classic (XSC)** and **XS Advanced / HDI (XSA)** workflows.

## Feature Progress Matrix

**Legend:**

* 🟢 **Complete** — Shipped and covered by unit tests
* 🟡 **In Progress / Partial** — Basic support shipped; expanding edge cases
* 🔵 **Planned (Next Up)** — Scheduled for upcoming milestones
* ⚪ **Backlog / N/A** — Future phase or not applicable to this artifact

| Artifact Family | Syntax Highlighting | AST Formatter | Offline LSP & Linter | XSC <-> XSA Migrator | Live DB Activate / Deploy |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **SQL & SQLScript** (`.sql`, `.hdbprocedure`, `.hdbfunction`) | 🟢 Complete | 🟢 Complete | 🔵 Planned | 🔵 Planned | ⚪ Phase 4 |
| **HDI Headerless SQL** (`.hdbtabletype`, `.hdbprojectionview`, etc.) | 🟢 Complete | 🟢 Complete | 🔵 Planned | ⚪ N/A | ⚪ Phase 4 |
| **Classic & HDI Tables/Views** (`.hdbtable`, `.hdbview`, `.hdbsequence`) | 🟢 Complete | 🟢 Complete | 🔵 Planned | 🔵 Planned | ⚪ Phase 4 |
| **CDS Models** (`.hdbdd`, `.hdbcds`) | 🟢 Complete | 🟢 Complete | 🔵 Planned | 🔵 Planned | ⚪ Phase 4 |
| **XS JavaScript** (`.xsjs`, `.xsjslib`) | 🟢 Complete | 🟢 Complete | 🔵 Planned (`.d.ts`) | 🔵 Planned | ⚪ Phase 4 |
| **XS OData** (`.xsodata`) | 🟢 Complete | 🟢 Complete | 🔵 Planned | 🔵 Planned | ⚪ Phase 4 |
| **Roles & Grants** (`.hdbrole`, `.hdbgrants`, `.xsaccess`) | 🟢 Complete | 🟢 Complete | 🔵 Planned | 🔵 Planned | ⚪ Phase 4 |
| **Text Analysis (CGUL)** (`.hdbtextrule`, `.hdbtextlexicon`) | 🟢 Complete | ⚪ Backlog | ⚪ Backlog | ⚪ Backlog | ⚪ Phase 4 |
| **Calculation Views & XML** (`.calculationview`, `.hdbcalculationview`) | 🟢 Complete | ⚪ Backlog | 🔵 Schema XSD | 🔵 Planned | ⚪ Phase 4 |

---

## Engineering Phases

### Phase 1: Universal Syntax Highlighting (Completed)

* [x] TextMate grammars for 60+ XS Classic and XS Advanced / HDI file extensions.
* [x] Embedded SQL highlighting inside classic `.hdbview` and `.hdbsequence` files.
* [x] HANA Cloud SQL keywords, vector types (`REAL_VECTOR`, `HALF_VECTOR`), and `SQLSCRIPT_*` libraries.
* [x] Refine edge-case grammar rules for CGUL rule bodies (`.hdbtextrule`) and complex `.xsodata` annotations.

### Phase 2: Formatters Across All Design-Time Artifacts (Completed)

* [x] Configurable HANA SQL & SQLScript formatter (`hanasql.format.*`) with HDI procedure semicolon safety and `-- hanasql-format off` pragmas.
* [x] Dedicated formatter for classic key-value artifacts (`.hdbtable`, `.hdbstructure`, `.hdbview`, `.hdbsequence`, `.hdbschema`, `.hdbti`, `.hdbtid`, `.hdbtim`, `.xshttpdest`).
* [x] AST formatter for `.hdbdd` / `.hdbcds` and `.xsodata` service definitions.
* [x] Tolerant JSON/JSONC formatter covering 28 JSON-based design-time artifacts (`.hdiconfig`, `.hdbgrants`, `.xsaccess`, `.xsapp`, `.hdbrole` HDI, etc.), classic `.hdbrole` DSL formatter, and `.hdbmigrationtable` section formatter.
* [x] XSJS / `.xsjslib` formatting via virtual-document delegation to VS Code's built-in JS/TS formatter with `hanasql-format off` pragma masking, plus `package.json` `defaultFormatter` bindings across all formatted languages.

### Phase 3: Offline Language Server (LSP), Static Analyzers & Migration Assistant

* [ ] **XSJS IntelliSense:** Inject generated `xsjs.d.ts` definitions (`$.db`, `$.hdb`, `$.net`, `$.session`) into VS Code's JavaScript language service for zero-config autocomplete.
* [ ] **SQLScript Static Analyzer:**
  * Flag performance anti-patterns (mixing `CE_*` functions with SQL, cursor loops, `SELECT *` in procedures).
  * Flag security risks (dynamic SQL string concatenation without `USING` bind variables).
* [ ] **Interactive XSC -> XSA CodeActions:**
  * Quick-fix conversion from classic `.hdbtable` (`table.columns = [...]`) to HDI `.hdbtable` (`COLUMN TABLE ...`).
  * Inline deprecation hints for legacy `$.db` calls and `CE_*` functions.

### Phase 4: Live HANA Connectivity, `_SYS_REPO` & Git Integration

* [ ] Secure connection manager powered by `@sap/hana-client` and VS Code `SecretStorage`.
* [ ] Live catalog explorer and schema-aware SQL autocomplete (`SYS.TABLES`, `SYS.VIEWS`, `SYS.PROCEDURES`).
* [ ] **XS Classic Repository Engine:** Check, Save Inactive, and Activate directly against `_SYS_REPO` / `SYS.REPOSITORY_REST` with line-level error diagnostics.
* [ ] **Git + HANA Sync Workflow:** Transactional "Activate-before-Commit" guard and branch-switch batch activation.
