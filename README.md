# Developer Tools for SAP HANA

Language support for **SAP HANA XS Classic (XSC)**, **XS Advanced (XSA) / HDI**, and **SAP HANA Cloud**, all in VS Code and without a database connection.

Open a `.hdbprocedure`, `.hdbtable`, `.hdbdd`, `.xsjs`, or `.hdbrole` file and you get highlighting, formatting, error checking, completion, and migration help right away. Nothing to set up and no server to run.

## What You Get

| Feature | What it does |
| :--- | :--- |
| **Highlighting** | 115 file extensions, from classic repository artifacts to HDI and HANA Cloud SQL. |
| **Formatting** | SQLScript, CDS, `.xsodata`, classic key-value files, JSON configs, and roles. It never breaks a design-time artifact. |
| **Error checking** | Finds syntax errors as you type, many with a QuickFix. Also flags security and performance problems in SQLScript and XSJS. |
| **IntelliSense** | Completion, hover docs, and signature help for 564 built-in SQL functions, `SQLSCRIPT_*` libraries, and the XSJS `$` API. |
| **Migration** | Converts classic `.hdbtable`, `.hdbview`, `.hdbsequence`, `.hdbstructure`, `.hdbrole`, and `.hdbdd` files to HDI syntax. Tables, views, and sequences also convert back. |
| **Snippets** | Starter templates for procedures, functions, tables, CDS entities, roles, and XSJS queries. |

## Highlighting

* **Classic and HDI in one place:** `.hdbtable`, `.hdbview`, and `.hdbsequence` can hold either classic key-value syntax (`table.columns = [...]`) or HDI SQL DDL. The extension detects which one you have.
* **SQL inside strings:** The SQL in a classic `.hdbview` `query = "..."` or a `.hdbsequence` `reset_by = "..."` is highlighted as SQL.
* **HANA-specific SQL:** `CE_*` functions, `MAP_MERGE`, `APPLY_FILTER`, `SQLSCRIPT_*` library calls (`USING SQLSCRIPT_STRING AS lib; lib:split_to_table(...)`), vector types (`REAL_VECTOR`, `HALF_VECTOR`), and system DDL such as `CREATE JWT PROVIDER`.
* **XS JavaScript:** `.xsjs` and `.xsjslib` highlight the HANA globals (`$.import`, `$.hdb`, `$.db`, `$.request`, `$.response`, `$.session`, `$.net.http.*`).

## Formatting

Press `Shift+Alt+F` to format the file, or select some lines and run **Format Selection**.

| Files | Formatted as |
| :--- | :--- |
| `.sql`, `.hdbprocedure`, `.hdbfunction`, and other SQL artifacts | HANA SQL & SQLScript, with configurable rules |
| `.hdbtable`, `.hdbview`, `.hdbsequence`, `.hdbschema`, `.hdbti`, ... (classic) | Classic key-value syntax |
| `.hdbdd`, `.hdbcds` | CDS |
| `.xsodata` | OData service definitions |
| `.hdbgrants`, `.hdiconfig`, `.xsaccess`, `.xsapp`, HDI `.hdbrole`, ... | JSON / JSONC, comments kept |
| Classic `.hdbrole`, `.hdbmigrationtable` | Their own formats |
| `.xsjs`, `.xsjslib` | VS Code's JavaScript formatter |

### Safe for HANA Artifacts

* **No stray semicolons:** HDI artifacts such as `.hdbprocedure` must not end in `;`. With `trailingSemicolon: "add"`, the formatter still adds none after the root statement.
* **Your names stay as written:** Case rules change keywords, functions, data types, and unquoted names only. Quoted identifiers (`"MyColumn"`), strings (`'text'`, `N'text'`, `X'00'`), and comments keep their exact text.
* **Opt out where you need to:** Wrap code in pragma comments to keep your own alignment:

```sql
-- hanasql-format off
SELECT   MANDT,   BUKRS,   BELNR   FROM "BSEG";
-- hanasql-format on
```

### Formatter Settings

Run **SAP HANA SQL: Open Formatter Settings** to see every option in the Settings UI, or add them to `settings.json`:

```jsonc
{
  "[hanasql]": {
    "editor.defaultFormatter": "l1asis.sap-hana-dev-tools",
    "editor.formatOnSave": true,
    "editor.tabSize": 2
  },
  "hanasql.format.keywordCase": "upper",         // "upper" | "lower" | "preserve"
  "hanasql.format.functionCase": "upper",        // "upper" | "lower" | "preserve"
  "hanasql.format.dataTypeCase": "lower",        // "upper" | "lower" | "preserve"
  "hanasql.format.identifierCase": "preserve",   // Applies to unquoted identifiers only
  "hanasql.format.maxLineLength": 100,           // 0 = disable line wrapping
  "hanasql.format.commaPosition": "leading",     // "trailing" | "leading"
  "hanasql.format.oneItemPerLine": ["select", "set", "groupBy", "columnDefinitions", "parameters"],
  "hanasql.format.embeddedQueryLayout": "hanging", // Queries after lt = ..., := or RETURN: "hanging" | "aligned" | "newLine"
  "hanasql.format.trailingSemicolon": "add",     // "preserve" | "add" | "remove"
  "hanasql.format.identifierQuotes": "removeUnnecessary",
  "hanasql.format.notEqualOperator": "<>"        // "<>" | "!="
}
```

## Error Checking & QuickFixes

The checks run offline as you type. Problems appear in the editor and the **Problems** panel. Each one carries a rule ID (such as `HANA-SEC-001`) that you can look up in the specs.

| Area | Examples | Setting |
| :--- | :--- | :--- |
| **Syntax** (`HANA-SYN-*`) | Unclosed strings, comments, and brackets. Unmatched `BEGIN`/`END` and `IF`/`END IF`. Misspelled keywords, with a typo fix. Clauses in the wrong order. Trailing commas in JSON. Broken XML tags. Covers SQL, SQLScript, CDS, classic files, JSON, XSJS, XML, and text-analysis rules. | `hanasql.analyze.syntax` |
| **Security** (`HANA-SEC-*`) | Dynamic SQL built by string concatenation instead of `USING` bind variables. `SQL SECURITY DEFINER` combined with dynamic SQL. Risky `$.db` and `$.response.setBody` use in XSJS. Overly broad `.xsaccess`, `.hdbrole`, `.hdbgrants`, and `.hdbrevokes` settings. | `hanasql.analyze.security` |
| **Performance** (`HANA-PERF-*`, `HANA-LINT-*`) | Legacy `CE_*` functions, cursor loops, `SELECT *`, DML inside loops, empty `EXIT HANDLER`s, and unreliable `::ROWCOUNT`. | `hanasql.analyze.performance` |
| **Calculation views** (`HANA-LINT-1xx`) | XML schema and graph errors in `.calculationview` and `.hdbcalculationview`. | `hanasql.analyze.calculationView` |
| **Migration** (`HANA-MIG-*`) | Classic-only code that will not deploy to HDI: `DEFAULT SCHEMA`, hardcoded `_SYS_BIC` schemas, `$.repo` calls, and file suffixes HDI renamed. | `hanasql.analyze.migration` |

Set `hanasql.analyze.targetPlatform` to `xsc`, `hdi`, or `cloud` to match your system. The default is `auto`. With `cloud`, `CE_*` functions become errors, and with `xsc`, the HDI migration hints are hidden.

## IntelliSense

**SQL & SQLScript:** completion for keywords, data types, and built-in functions. Hover and signature help for all 564 built-in functions. Members of `USING SQLSCRIPT_*` libraries (`lib:member`). Your own `DECLARE` variables and parameters after `:`. Keys and values in JSON and classic config files.

**XSJS:** completion, hover, and signature help for the `$` API, XSDS, and XSUnit (`jasmine`, Mockstar). Modules loaded with `$.import(...)` are resolved. If you want type checking too, run **SAP HANA XSJS: Configure Workspace xsjs.d.ts Type Definitions**. It copies the type definitions into your workspace.

## Migrating Between XS Classic and HDI

Place the cursor in a classic artifact and open the QuickFix menu (`Ctrl+.`), or run a command from the Command Palette:

* **SAP HANA: Convert Artifact from XSC to HDI / XSA Syntax**
* **SAP HANA: Convert Artifact from HDI to XSC Classic Syntax**

| From | To | Direction |
| :--- | :--- | :---: |
| Classic `.hdbtable`, `.hdbview`, `.hdbsequence` | HDI SQL DDL | ⇄ |
| Classic `.hdbstructure` | HDI `.hdbtabletype` | → |
| Classic `.hdbrole` DSL | HDI JSON role | → |
| `.hdbdd` | `.hdbcds` | → |
| Renamed suffixes (`.calculationview`, ...) | HDI suffix (`.hdbcalculationview`, ...), when the content can stay as it is | → |

Comments are kept: they move into a header block when a file becomes SQL, and come back when you convert it back.

## Snippets

Type a prefix and pick the snippet: `hana-proc`, `hana-tfunc`, `hana-exit-handler`, `hdi-table`, `hdi-view`, `xsc-table`, `cds-entity`, `hdi-role`, `xsodata-service`, `xsjs-hdb-query`, `xsunit-suite`, and more.

## Supported File Types

The extension recognizes 115 file extensions across XS Classic, HDI, and SAP HANA Cloud.

<details>
<summary><strong>Show every file type and what it gets</strong></summary>

### 1. SQL, SQLScript & Procedural Artifacts

| Extensions | Support Details |
| :--- | :--- |
| `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbscalarfunction`, `.hdbtrigger` | Full HANA SQL & SQLScript grammar, procedural blocks, `CE_*` functions, and `SQLSCRIPT_*` library calls |
| `.hdbindex`, `.hdbfulltextindex`, `.hdbconstraint`, `.hdbvirtualtable`, `.hdbtabletype` | DDL highlighting and SQL formatting |
| `.hdbmigrationtable` | HDI migration table SQL plus `== version = N` / `== migration = N` header markers |
| `.hdbstructuredprivilege`, `.hdbstructuredfilter`, `.hdbresultcache`, `.hdbstatistics`, `.hdbsystemversioning`, `.hdbschedulerjob`, `.hdbremotetablereplica`, `.hdbcollection`, `.hdbcollectionindex`, `.hdbcollectionadjindex`, `.hdbfabricvirtualtable`, `.hdblibrary`, `.hdbprojectionview` | HDI headerless SQL artifacts (highlighted and formatted without requiring `CREATE`) |
| `.hdbapplicationtime`, `.hdbgraphworkspace`, `.hdbdropcreatetable`, `.hdbvirtualprocedure`, `.hdbvirtualfunction` | Specialized HDI SQL artifacts |

### 2. Data Modeling & CDS (Classic & XS Advanced)

| Extensions | Support Details |
| :--- | :--- |
| `.hdbtable`, `.hdbstructure` | Classic `table.columns = [...]` configuration syntax **and** HDI-style SQL DDL |
| `.hdbview`, `.hdbsequence` | Classic config syntax (with embedded SQL highlighting inside `query` and `reset_by` strings) **and** HDI SQL DDL |
| `.hdbdd` | XS Classic CDS (`namespace`, `context`, `entity`, `type`, `view`, associations, annotations, technical configuration) |
| `.hdbcds` | XS Advanced CDS (extends `.hdbdd` with `AccessPolicy`, `role`, `aspect`, `grant`, `extend`, `package ... depends on`, `$user`) |
| `.hdbschema`, `.hdbti`, `.hdbtid`, `.hdbtim` | Classic schema declarations (`schema_name = ...;`), Table Import (`import = [{ ... }];`), and legacy `.hdbtid` / `.hdbtim` definitions |

### 3. XS Classic Application Layer

| Extensions | Support Details |
| :--- | :--- |
| `.xsjs`, `.xsjslib` | Server-side JavaScript plus HANA `$` API globals (`$.import`, `$.db`, `$.hdb`, `$.request`, `$.response`, `$.net`, `$.session`) |
| `.xsodata`, `.xsxmla` | OData v2 (`service`, `navigates`, `aggregates always`, `concurrencytoken`, `cache-control`, exits) and XMLA service definitions |
| `.xsaccess`, `.xsapp`, `.xsappsite`, `.xsjob`, `.xssqlcc`, `.xsprivileges`, `.xssecurestore`, `.hdbsynonym` | Fault-tolerant XS JSON configuration (including `xscron` schedule expressions in `.xsjob` and Fiori launchpad `.xsappsite`) |
| `.xshttpdest`, `.xsoauthappconfig`, `.xsoauthclientconfig`, `.xsoauthclientflavor` | Outbound HTTP destination and OAuth configurations |

### 4. Security, Text Analysis & XML Models

| Extensions | Support Details |
| :--- | :--- |
| `.hdbrole` | Both XS Classic `role x::y { ... }` syntax and HDI JSON role definitions |
| `.hdbgrants` (also `.hdbsynonymgrantor`), `.hdbrevokes`, `.hdbroleconfig`, `.hdbsynonymconfig` (also `.hdbsynonymtemplate`), `.hdbpublicsynonym`, `.hdbvirtualtableconfig`, `.hdbfabricvirtualtableconfig`, `.hdblogicalschemaconfig`, `.hdbprojectionviewconfig`, `.hdbtabledata`, `.hdbeshconfig`, `.hdiconfig`, `.hdinamespace` | Schema-aware HDI JSON / JSONC configuration keys (with `//` comment support; `.hdiconfig` also highlights `"properties"` and `"tags"` plug-in keys) |
| `.hdbafllangprocedure`, `.hdblogicalschema`, `.hdbsysbicsynonym`, `.hdbvirtualprocedureconfig`, `.hdbvirtualfunctionconfig` | Specialized HDI JSON / JSONC configuration artifacts |
| `.hdbvirtualpackagehadoop`, `.hdbvirtualpackagesparksql`, `.hdbmrjob` (also `.hdbhadoopmrjob`, `.hdbrmjob`) | File icon only: Hadoop JARs and SparkSQL resources get no highlighting, formatting or syntax checks |
| `.hdbtextrule`, `.hdbtextinclude`, `.hdbtextlexicon` | Text analysis extraction rules (CGUL directives `#include`, `#lexicon`, `#define`, `#group`, `<STEM:x>`, `%(name)`) |
| `.calculationview`, `.hdbcalculationview`, `.attributeview`, `.analyticview`, `.analyticprivilege`, `.hdbanalyticprivilege`, `.hdbdecisiontable` (also `.hdbruldec`, `.decrule`), `.xswidget`, `.hdbtextconfig`, `.hdbtextdict`, `.hdbtextminingconfig` (also `.textminingconfig`), `.hdbsearchruleset` (also `.searchruleset`), `.hdbreptask`, `.hdbflowgraph` | Automatically associated with VS Code's XML grammar |
| `.procedure`, `.hdbflowgraphtemplate`, `.aflpmml`, `.dqconfig`, `.dataflow`, `.epmmodel`, `.epmquerysource`, `.halmscenario`, `.pvsscenario` | Older XS Classic XML models (XML highlighting) |
| `.proceduretemplate`, `.hdbtextbundle` | XS Classic procedure templates (SQLScript with `<Parameter>` placeholders) and UI text bundles |

### 5. Project Files

| Files | What You Get |
| :--- | :--- |
| `.hdiignore` | HDI Deployer ignore list opens as an ignore file |
| `undeploy.json` | HDI Deployer undeploy allowlist, validated against a JSON schema |

</details>

Renamed or HDI-unsupported XS Classic suffixes (`.searchruleset`, `.hdbtablefunction`, `.attributeview`, ...) show a `HANA-MIG-013` hint, with a QuickFix that renames the file where the content can stay as it is. The full list of suffixes and what each one gets is in [`docs/specs/artifacts/artifact-registry.md`](docs/specs/artifacts/artifact-registry.md).

## Roadmap & Feedback

Coming next: a workspace-wide schema index for table and column completion, live connections to SAP HANA, `_SYS_REPO` / HDI activation from the editor, and a standalone language server you can use in other editors and in CI. See [ROADMAP.md](./ROADMAP.md) for the full plan.

Found a file that isn't highlighted, formatted, or checked correctly? Please [open an issue](https://github.com/l1asis/vscode-sap-hana-dev-tools/issues) and include a short snippet that shows the problem.

## License & Legal Notice

Distributed under the MIT License. See [LICENSE](./LICENSE) for more information.

### Disclaimer & Trademark Notice

This extension is an independent, community-driven open-source project and is **not affiliated with, endorsed by, sponsored by, or supported by SAP SE** or any of its affiliates.

**SAP**, **SAP HANA**, **SAP HANA Cloud**, **XS Classic**, **XS Advanced**, and **SQLScript** are the trademarks or registered trademarks of **SAP SE** or its affiliates in Germany and in several other countries. All other product and service names mentioned are the trademarks of their respective companies. They are used in this project strictly for descriptive and nominative purposes to indicate compatibility and interoperability.
