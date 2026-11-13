# SAP HANA Developer Tools for VS Code

Rich language support for **SAP HANA XS Classic (XSC)**, **XS Advanced (XSA)**, and **SAP HANA Cloud (HDI)**. 

Whether you are maintaining legacy XS Classic repository packages (`.hdbtable`, `.hdbdd`, `.xsjs`, `.xsodata`) or building modern HDI containers (`.hdbcds`, `.hdbprocedure`, `.hdbgrants`), this extension brings syntax highlighting and HANA-aware SQLScript formatting into a single lightweight toolkit.

## Highlights

* **Unified XS Classic & HDI Support:** Automatically distinguishes between classic key-value design-time artifacts (`table.columns = [...]`) and modern HDI SQL-DDL artifacts—even when they share the same file extension (`.hdbtable`, `.hdbview`, `.hdbsequence`).
* **Embedded SQL Highlighting:** Highlights SQL queries embedded inside classic `.hdbview` (`query = "..."`) and `.hdbsequence` (`reset_by = "..."`) string literals, including escaped quotes (`\"`).
* **Modern HANA SQL & SQLScript Grammar:** Covers HANA-specific syntax including Calculation Engine functions (`CE_*`), `MAP_MERGE` / `MAP_REDUCE`, `APPLY_FILTER`, built-in `SQLSCRIPT_*` libraries (`USING SQLSCRIPT_STRING AS lib; lib:split_to_table(...)`), vector data types (`REAL_VECTOR`, `HALF_VECTOR`), and system DDL (`CREATE JWT PROVIDER`, `ALTER SYSTEM ...`).
* **XS JavaScript (`$`) Recognition:** Extends VS Code's JavaScript grammar for `.xsjs` and `.xsjslib` with first-class highlighting for HANA globals (`$.import`, `$.hdb`, `$.db`, `$.request`, `$.response`, `$.session`, `$.net.http.*`).
* **HANA-Safe SQL Formatter:** Built specifically for HANA SQL and SQLScript so design-time artifacts and quoted identifiers are never corrupted on save.

## SQL & SQLScript Formatter

Press `Shift+Alt+F` to format the active document, or use **Format Selection** to format specific lines.

### Why It's Safe for HANA Artifacts

* **Design-Time Aware:** Setting `trailingSemicolon: "add"` will **never** append a trailing `;` to the root statement of HDI design-time artifacts (`PROCEDURE "..." ... END`), where a trailing semicolon causes HDI deployment errors.
* **Classic Config Protection:** Key-value artifacts (such as classic `.hdbtable` or `.hdbview` files) are automatically detected and left untouched by the SQL formatter.
* **Identifier & Literal Integrity:** Case rules only modify SQL keywords, built-in functions, data types, and **unquoted** identifiers. Double-quoted identifiers (`"MyColumn"`), string literals (`'text'`, `N'text'`, `X'00'`), and comments are strictly preserved.
* **Format Ignore Directives:** Keep manual alignment intact on specific queries using pragma comments:

```sql
-- hanasql-format off
SELECT   MANDT,   BUKRS,   BELNR   FROM "BSEG";
-- hanasql-format on
```

### Recommended Configuration (`settings.json`)

You can configure all rules via the Settings UI (**SAP HANA SQL: Open Formatter Settings**) or directly in `settings.json`:

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
  "hanasql.format.oneItemPerLine": [
    "select",
    "set",
    "groupBy",
    "columnDefinitions",
    "parameters"
  ],
  "hanasql.format.logicalOperatorPosition": "after",
  "hanasql.format.trailingSemicolon": "add",     // "preserve" | "add" | "remove"
  "hanasql.format.blankLinesBetweenTopLevelStatements": 2,
  "hanasql.format.identifierQuotes": "removeUnnecessary",
  "hanasql.format.notEqualOperator": "<>"        // "<>" | "!="
}
```

## Supported File Types (60+ Extensions)

### 1. SQL, SQLScript & Procedural Artifacts

| Extensions | Support Details |
| :--- | :--- |
| `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbtrigger` | Full HANA SQL & SQLScript grammar, procedural blocks, `CE_*` functions, and `SQLSCRIPT_*` library calls |
| `.hdbindex`, `.hdbfulltextindex`, `.hdbconstraint`, `.hdbvirtualtable`, `.hdbtabletype` | DDL highlighting and SQL formatting |
| `.hdbmigrationtable` | HDI migration table SQL plus `== version = N` / `== migration = N` header markers |
| `.hdbstructuredprivilege`, `.hdbstructuredfilter`, `.hdbresultcache`, `.hdbstatistics`, `.hdbsystemversioning`, `.hdbschedulerjob`, `.hdbremotetablereplica`, `.hdbcollection`, `.hdblibrary`, `.hdbprojectionview` | HDI headerless SQL artifacts (highlighted without requiring `CREATE`) |
| `.hdbapplicationtime`, `.hdbgraphworkspace`, `.hdbdropcreatetable`, `.hdbvirtualprocedure`, `.hdbvirtualfunction` | Specialized HDI SQL artifacts |

### 2. Data Modeling & CDS (Classic & XS Advanced)

| Extensions | Support Details |
| :--- | :--- |
| `.hdbtable`, `.hdbstructure` | Classic `table.columns = [...]` configuration syntax **and** HDI-style SQL DDL |
| `.hdbview`, `.hdbsequence` | Classic config syntax (with embedded SQL highlighting inside `query` and `reset_by` strings) **and** HDI SQL DDL |
| `.hdbdd` | XS Classic CDS (`namespace`, `context`, `entity`, `type`, `view`, associations, annotations, technical configuration) |
| `.hdbcds` | XS Advanced CDS (extends `.hdbdd` with `AccessPolicy`, `role`, `aspect`, `grant`, `extend`, `package ... depends on`, `$user`) |
| `.hdbschema`, `.hdbti` | Classic schema declarations (`schema_name = ...;`) and Table Import (`import = [{ ... }];`) definitions |

### 3. XS Classic Application Layer

| Extensions | Support Details |
| :--- | :--- |
| `.xsjs`, `.xsjslib` | Server-side JavaScript plus HANA `$` API globals (`$.import`, `$.db`, `$.hdb`, `$.request`, `$.response`, `$.net`, `$.session`) |
| `.xsodata` | OData v2 service definitions (`service`, `navigates`, `aggregates always`, `concurrencytoken`, `cache-control`, exits) |
| `.xsaccess`, `.xsapp`, `.xsjob`, `.xssqlcc`, `.xsprivileges`, `.xssecurestore`, `.hdbsynonym` | Fault-tolerant XS JSON configuration (including `xscron` schedule expressions in `.xsjob`) |
| `.xshttpdest`, `.xsoauthappconfig`, `.xsoauthclientconfig`, `.xsoauthclientflavor` | Outbound HTTP destination and OAuth configurations |

### 4. Security, Text Analysis & XML Models

| Extensions | Support Details |
| :--- | :--- |
| `.hdbrole` | Both XS Classic `role x::y { ... }` syntax and HDI JSON role definitions |
| `.hdbgrants`, `.hdbrevokes`, `.hdbroleconfig`, `.hdbsynonymconfig`, `.hdbpublicsynonym`, `.hdbvirtualtableconfig`, `.hdblogicalschemaconfig`, `.hdbprojectionviewconfig`, `.hdbtabledata`, `.hdbeshconfig`, `.hdiconfig`, `.hdinamespace` | Schema-aware HDI JSON configuration keys (with `//` comment support) |
| `.hdbafllangprocedure`, `.hdblogicalschema`, `.hdbsysbicsynonym`, `.hdbvirtualprocedureconfig`, `.hdbvirtualfunctionconfig` | Specialized HDI JSON configuration artifacts |
| `.hdbtextrule`, `.hdbtextinclude`, `.hdbtextlexicon` | Text analysis extraction rules (CGUL directives `#include`, `#lexicon`, `#define`, `#group`, `<STEM:x>`, `%(name)`) |
| `.calculationview`, `.hdbcalculationview`, `.attributeview`, `.analyticview`, `.analyticprivilege`, `.hdbanalyticprivilege`, `.hdbtextconfig`, `.hdbtextdict`, `.hdbtextminingconfig`, `.hdbsearchruleset`, `.hdbreptask`, `.hdbflowgraph` | Automatically associated with VS Code's XML grammar |

## Roadmap & Feedback

We are actively expanding this extension with a full **Language Server (LSP)**, static performance/security analyzers, **XS Classic to XS Advanced migration quick-fixes**, and live **`_SYS_REPO` / HDI database activation**. See [ROADMAP.md](./ROADMAP.md) for details.

Spot an edge case in a classic `.hdbrole`, `.xsodata`, or `.hdbdd` file that isn't highlighted as expected? Please open an issue with a minimal snippet!

## License & Legal Notice

Distributed under the MIT License. See [LICENSE](./LICENSE) for more information.

### Disclaimer & Trademark Notice

This extension is an independent, community-driven open-source project and is **not affiliated with, endorsed by, sponsored by, or supported by SAP SE** or any of its affiliates. 

**SAP**, **SAP HANA**, **SAP HANA Cloud**, **XS Classic**, **XS Advanced**, and **SQLScript** are the trademarks or registered trademarks of **SAP SE** or its affiliates in Germany and in several other countries. All other product and service names mentioned are the trademarks of their respective companies. They are used in this project strictly for descriptive and nominative purposes to indicate compatibility and interoperability.
