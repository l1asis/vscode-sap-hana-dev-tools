# SAP HANA Specification Extraction Rules (`SPEC_RULES.md`)

You are extracting compiler-grade, machine-actionable technical specifications from `research/refs/extracted/` into `docs/specs/` for the `vscode-sap-hana-dev-tools` extension.

## 1. Global Extraction Rules

1. **Zero Prose Fluff:** Do not write high-level marketing summaries or conceptual introductions. Emit only EBNF/BNF grammars, lexical token tables, keyword lists, JSON/XML schemas, API signatures, and AST transformation rules.
2. **Protect BNF & Code Blocks:** Always wrap BNF/EBNF syntax definitions inside ` ```ebnf ` or ` ```text ` code fences so `<non_terminal>` angle brackets and `|` pipes are never stripped as HTML.
3. **Target Platform Tagging:** Explicitly tag every syntax rule, keyword, or artifact property with its supported platform:
   - `[XSC]` — SAP HANA XS Classic (HANA 1.0 / 2.0 `_SYS_REPO`)
   - `[XSA]` — SAP HANA XS Advanced (HANA 2.0 On-Premise)
   - `[HDI]` — SAP HANA Deployment Infrastructure (XSA & HANA Cloud)
   - `[CLOUD]` — SAP HANA Cloud specific (e.g., `REAL_VECTOR`, `HALF_VECTOR`, Data Lake Relational Engine)
4. **Source Traceability:** At the top of every section, include a blockquote citing the exact extracted source file and page range (and extracted diagram PNG when distilling visual rules):
   `> Source: research/refs/extracted/<guide_folder>/<chapter_file>.md (Pages X–Y)`
   `> Source: research/refs/extracted/<guide_folder>/images/<image_file>.png (Page X)`
5. **Incremental Merging:** Never overwrite existing rules in a `docs/specs/` file when processing a new guide. Merge new keywords, edge cases, or version differences into the existing specification.
6. **Visual & Diagram Distillation:** When an extracted chapter contains `![Figure ...](./images/...)` links or `images_catalog.md` entries (such as PlanViz `Before` / `After` query plans, execution engine stacks, Calculation View node mappings, or architecture flows), inspect the referenced PNG and distill its rules, transformations, or AST constraints into structured prose, tables, or code fences inside `docs/specs/`. Never copy or embed raw PNGs from `research/` into `docs/specs/`.
7. **Custom-PDF Clipping Verification:** SAP Dynamic Custom PDFs occasionally clip wide `<pre>` code lines at the right page margin. Whenever a syntax rule or code example appears truncated mid-token in a Custom PDF chapter, cross-check the corresponding prebuilt `_en.pdf` guide (if available) or live SAP Help Portal topic before encoding the spec.

---

## 2. Folder-Specific Schema Contracts

### A. `docs/specs/grammars/<language>.md` (For Highlighters & Formatters)

Every grammar specification MUST contain these exact sections:

1. **File Extensions & Scope Name:** List all associated file extensions (e.g., `.xsodata`, `.hdbtextrule`) and the target TextMate `scopeName`.
2. **Lexical Tokens & Comments:** Line comments, block comments, string literals, escape sequences, numeric literals, and identifier quoting rules (`"..."` vs unquoted).
3. **Keywords by TextMate Scope:**
   - `keyword.control.<lang>` (clauses, control flow, directives)
   - `storage.type.<lang>` (data types, artifact declarations)
   - `storage.modifier.<lang>` (modifiers like `NULL`, `NOT NULL`, `PRIMARY KEY`, `INVOKER`, `DEFINER`)
   - `constant.language.<lang>` (booleans, system constants, pragmas)
   - `support.function.<lang>` (built-in functions, `CE_*`, `SQLSCRIPT_*`)
4. **Embedded Language Injections:** Exact start/end delimiters where another language is embedded (e.g., SQL expressions inside classic `.hdbview` `query = "..."`, or SQL inside `.hdbtable` / `.xsodata`).
5. **Complete EBNF / BNF Productions:** Every production rule from the reference guide.
6. **Canonical Formatting Rules (Phase 2):**
   - Block openers/closers that trigger indentation (`+1` / `-1` indent).
   - Mandatory line-break tokens and list-separator alignment rules.
   - Statement termination & semicolon safety rules (e.g., HDI headerless files vs `CREATE PROCEDURE` blocks).

### B. `docs/specs/artifacts/<artifact-family>.md` (For Design-Time Artifacts)

Every artifact specification MUST contain:

1. **Metadata Table:** File extension(s), Runtime (`XSC` | `XSA` | `HDI`), `.hdiconfig` plugin name, and minimum HANA version.
2. **Structural Format:** Key-Value AST (Classic `.hdbtable`, `.hdbview`, `.hdbschema`, `.hdbti`), DDL-style (HDI `.hdbtable`, `.hdbrole`), JSON (`.xsaccess`, `.hdbgrants`, `.hdbrole`), YAML (`mta.yaml`), or XML/XSD (`.calculationview`, `.hdbcalculationview`).
3. **Property & Key Schema:** Exhaustive table of all valid keys/properties, their types (`String`, `Boolean`, `Enum`, `Array`, `Object`), default values, and validation constraints.
4. **Valid & Invalid Examples:** Minimal, edge-case, and complex valid examples from SAP docs.

### C. `docs/specs/catalogs/<catalog>.json` (Machine-Readable JSON)

Catalogs MUST be valid, minifiable JSON arrays/objects so build scripts in `scripts/` can generate TextMate regexes, hover docs, and `.d.ts` files:

- `sql-keywords.json`: `{"keywords": [{"name": "...", "category": "reserved|non-reserved", "scope": "...", "platforms": ["XSC","HDI","CLOUD"]}]}`
- `builtin-functions.json`: `{"functions": [{"name": "...", "library": "SYS|SQLSCRIPT_STRING|...", "signatures": ["..."], "returnType": "...", "description": "..."}]}`
- `system-views.json`: `{"views": [{"schema": "SYS|_SYS_BIC|_SYS_REPO|_SYS_DI", "name": "...", "columns": [{"name": "...", "type": "...", "description": "..."}]}]}` *(Phase 4 live-catalog prerequisite)*
- `xsjs-api.json`: Structured namespace tree (`$.db`, `$.hdb`, `$.net`, `$.session`, `$.security`, `$.util`, `$.jobs`, plus `sap.hana.xs.libs.dbutils.*`, `sap.hana.testtools.*`, and `jasmine.*` / XSUnit globals) with methods, parameter types, return types, and JSDoc descriptions for generating `resources/xsjs.d.ts`.

### D. `docs/specs/diagnostics/<domain>-rules.md` (Linter, Syntax, Security, Migrator & IntelliSense)

Every diagnostic, syntax, security, performance, or migration rule MUST follow this template:

- **Rule ID:** `HANA-SYN-XXX` (Syntax/Structural), `HANA-SEC-XXX` (Security), `HANA-PERF-XXX` (Performance), `HANA-LINT-XXX` (Semantic/XML Lint), or `HANA-MIG-XXX` (XSC $\rightarrow$ XSA/HDI Migration)
- **Severity:** `Error` | `Warning` | `Information` | `Hint` (plus `hanasql.analyze.*` setting and `@AnalyzerSuppress` / `hanasql-analyze-disable` suppression behavior where applicable)
- **Platform Scope:** `[XSC]` | `[XSA]` | `[HDI]` | `[CLOUD]`
- **Target Extensions:** e.g., `.sql`, `.hdbprocedure`, `.hdbfunction`, `.xsjs`, `.hdbrole`, `.xsaccess`, `.hdiconfig`
- **AST / Lexical Trigger:** Exact condition to match in the parser/analyzer.
- **Diagnostic Span & Message:** Exact span targeting rules and clear diagnostic message shown in VS Code Problems panel.
- **QuickFix / Refactoring Transformation:** (use the matching language fence: `sql`, `jsonc`, `javascript`, `xml`, etc.)
  - **Vulnerable / Invalid / Legacy Code (`Before`):**

    ```sql
    -- Example before
    ```

  - **Refactored / Fixed / Migrated Code (`After`):**

    ```sql
    -- Example after
    ```

*(Note: Pure IntelliSense capability specs such as `docs/specs/diagnostics/sql-intellisense.md` may instead document target languages, comment/string suppression rules, trigger tables, and catalog mappings.)*

### E. `docs/specs/connectivity/<protocol>.md` (Live DB Management & Activation)

Must document exact wire-level and SQL-level contracts:

- Stored procedure signatures, input/output table types, and parameter schemas (`_SYS_REPO`, `SYS.REPOSITORY_REST`, `_SYS_DI`).
- JSON request/response payloads and status/error code tables.
- `@sap/hana-client` connection parameters, SSL/TLS options, and catalog introspection SQL queries.
