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

- `sql-keywords.json` + `builtin-functions.json`: the **SQL word catalog** (schema below). The single source of every SQL / SQLScript word list.
- `system-views.json`: `{"views": [{"schema": "SYS|_SYS_BIC|_SYS_REPO|_SYS_DI", "name": "...", "columns": [{"name": "...", "type": "...", "description": "..."}]}]}` *(Phase 4 live-catalog prerequisite)*
- `xsjs-api.json`: Structured namespace tree (`$.db`, `$.hdb`, `$.net`, `$.session`, `$.security`, `$.util`, `$.jobs`, plus `sap.hana.xs.libs.dbutils.*`, `sap.hana.testtools.*`, and `jasmine.*` / XSUnit globals) with methods, parameter types, return types, and JSDoc descriptions for generating `resources/xsjs.d.ts`.

#### C.1 SQL word catalog

A word can mean different things in different places: `LEFT` starts a join, but `LEFT(` is a string function. `SOURCE` is a clause keyword inside `HIERARCHY(...)` and an ordinary column name elsewhere. The catalog therefore records **roles** per word, and every role says where it applies. Nothing else in the repository may keep its own list of SQL words.

**`sql-keywords.json`**: every word that is not only a function name.

```jsonc
{
  "roles": {
    "<role-id>": {                       // kebab-case; registry order = hover precedence for lexical roles
      "group": "lexical" | "context",    // lexical: what the word is; context: where a heuristic expects it
      "const": "UPPER_SNAKE",            // generated constant name (required with emit / order)
      "emit": ["analyzer", "formatter"], // src/analyzer/keyword-sets.ts, src/formatter/keywords.ts
      "scope": "keyword.other.dml.hanasql", // lexical only: TextMate scope = highlighting and hover class
      "format": "keyword" | "type",      // lexical only: formatter word class (keywordCase / dataTypeCase)
      "description": "...",              // required: what the role means
      "context": "...",                  // where the role applies, e.g. "Only inside HIERARCHY*( ... )"
      "source": "<guide>/<chapter>.md § <heading>", // corpus path relative to research/refs/extracted/, or a spec section
      "order": ["FROM", "INTO", ...]     // only for order-sensitive roles: exact member list, in display order
    }
  },
  "artifactRoots": { "<languageId>": ["PROCEDURE", "CREATE"] }, // headerless HDI artifact roots [HDI]
  "words": [
    { "name": "LEFT", "roles": ["dml", "reserved", "join-starter", "expr-clause-terminator", ...],
      "platforms": ["CLOUD"],            // omitted = [XSC] [XSA] [HDI] [CLOUD]
      "source": "...", "note": "..." }   // optional per-word traceability
  ]
}
```

**`builtin-functions.json`**: every built-in function and SQLScript library member.

```jsonc
{
  "categories": {
    "<category-id>": { "scope": "support.function.string.hanasql", "description": "...", "source": "..." }
    // a category without scope (sqlscript-library) is not highlighted as a global call
  },
  "functions": [
    { "name": "LEFT", "library": "SYS", "category": "string",
      "signatures": ["LEFT(<str>, <n>)"], "returnType": "NVARCHAR", "description": "...", "source": "..." }
  ]
}
```

Function-specific fields beyond these (`kind`, `receiverType`, `platforms`, `params`, `returnDescription`) and the hover / signature help rules built on them are specified in `docs/specs/diagnostics/sql-intellisense.md` §6. Function entries are distilled with `scripts/extract-function-docs.js` (local corpus). It fills placeholder entries and never overwrites curated ones.

**Lexical roles** (registry order): `control-flow`, `dml`, `ddl`, `word-operator`, `literal`, `system-value`, `type`, `pragma`, `annotation`, `system-variable`, `hint`, `sqlscript-keyword`, `reserved`, `alter-system-word`, `statement-noun`, `clause-word`, `keyword` (non-reserved, cased by the formatter everywhere), `quote-protected` (must keep its quotes under `identifierQuotes: "removeUnnecessary"`). Function roles are not repeated in `sql-keywords.json`: a function's category is its role.

**Context roles** replace the hand-written word sets of the analyzers and the SQL formatter, one role per set (`expr-clause-terminator`, `join-starter`, `hierarchy-clause`, `column-clause-modifier`, ...). Their `context` and `source` fields name the rule (`HANA-SYN-0xx`) or production they serve.

**Generated from the catalog** (`npm run build:keywords`; never hand-edit):

| Output | Content |
| :--- | :--- |
| `syntaxes/hanasql.tmLanguage.json` | Word alternations of every lexical role and function category with a `scope` (via `scripts/lib/hanasql-grammar.js`). Function categories match only before `(`. Phrases and punctuation stay in the grammar script. |
| `src/formatter/keywords.ts` | `KEYWORDS` (roles with `format: "keyword"`), `TYPES`, `FUNCTIONS` (functions of scoped categories), `RESERVED`, `PROTECTED`, `SYSTEM_WORDS`, `STATEMENT_NOUNS`, and roles emitted to `formatter`. |
| `src/analyzer/keyword-sets.ts` | Roles emitted to `analyzer`, `CE_FUNCTIONS` (category `calculation-engine`), `HDI_ROOT_TARGETS` (`artifactRoots`). |
| `src/sql/sql-catalog.ts` | Hover / completion entries: words with a scoped role (kind and scope from the first scoped role), functions and library members. |

**Validation** (build fails): role ids kebab-case with a description; every word role exists; no word listed twice; names match `^[A-Z_][A-Z0-9_]*$`; platforms from the four tags; every role has at least one word; an `order` lists exactly the role's words; two roles never emit the same constant into the same module; `artifactRoots` use catalog words; every function has a known category and at least one signature; `library:name` is unique.

**Ordering**: generated sets are alphabetical. Grammar alternations put a word before any word it is a prefix of (`PROFILER` before `PROFILE`), so an alternation is correct even without a trailing `\b`.

**Guard** (`test/keyword-catalog.test.ts`): `src/analyzer/*.ts` and `src/formatter/formatter.ts` must not declare a `new Set([...])` or named list of two or more catalog words, nor an inline list of six or more. Short inline lists are production alternatives (`expectAt(j, ['BEFORE', 'AFTER', 'INSTEAD'])`) and stay in code. The test keeps a small allowlist, with a reason for each entry, for ordered parser follow sets and `.hdbrole` privilege names. The same test fails when a generated file is stale.

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
