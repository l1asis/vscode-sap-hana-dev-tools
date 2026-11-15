# SAP HANA SQL, SQLScript & Artifact Suggestions Specification (`sql-intellisense.md`)

> **Status:** Authoritative Specification (Phase 3)
> **Platforms:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
>
> **Sources:**
> - `docs/specs/catalogs/sql-keywords.json` (`sql-keywords`)
> - `docs/specs/catalogs/builtin-functions.json` (`builtin-functions`)
> - `docs/specs/catalogs/xsjs-api.json` (`xsjs`, `dbutils`, `test_tools`)
> - `docs/specs/grammars/sql-sqlscript.md` (`SQLScript EBNF`, `SYS.SQLSCRIPT_*`, `::` variables)
> - `docs/specs/artifacts/classic-kv-formatting.md` (`.hdbtable`, `.hdbview`, `.hdbsequence`, `.hdbti`, `.xshttpdest`)
> - `docs/specs/artifacts/hdiconfig.md` (`.hdiconfig` properties and plug-in suffixes)
> - `docs/specs/diagnostics/security-rules.md` (`.xsaccess`, `.hdbrole`, `.hdbgrants` keys & secure defaults)

---

## 1. Target Language Coverage

### 1.1 SQL & SQLScript IntelliSense (`hanasql.sql.enableIntelliSense`)

Triggered for:
- Core SQL / SQLScript: `hanasql`, `sql`, `hdbprocedure`, `hdbfunction`, `hdbtablefunction`, `hdbtrigger`, `hdblibrary`
- Headerless HDI DDL: `hdbindex`, `hdbfulltextindex`, `hdbconstraint`, `hdbvirtualtable`, `hdbtabletype`, `hdbprojectionview`, `hdbstructuredprivilege`, `hdbstructuredfilter`, `hdbresultcache`, `hdbstatistics`, `hdbsystemversioning`, `hdbschedulerjob`, `hdbremotetablereplica`, `hdbcollection`, `hdbcollectionindex`, `hdbcollectionadjindex`, `hdbfabricvirtualtable`, `hdbdropcreatetable`, `hdbapplicationtime`, `hdbgraphworkspace`, `hdbvirtualprocedure`, `hdbvirtualfunction`
- Dual-mode extensions when NOT Classic Key-Value (`!isKeyValueArtifact(text)`): `hdbtable`, `hdbstructure`, `hdbview`, `hdbsequence`

### 1.2 Design-Time Config & Classic KV IntelliSense (`hanasql.sql.enableIntelliSense`)

Triggered for:
- JSON Config / Security Artifacts: `xsaccess`, `hdiconfig`, `hdbgrants`, `hdbrevokes`, `hdbrole` (when JSON)
- Classic Key-Value Artifacts: `hdbtable`, `hdbstructure`, `hdbview`, `hdbsequence`, `hdbschema`, `hdbti`, `xshttpdest` (when `isKeyValueArtifact(text)` or dedicated KV language)

### 1.3 Extended XSJS / XSDS / XSUnit IntelliSense (`hanasql.xsjs.enableIntelliSense`)

Triggered for `xsjs`, `xsjslib`, covering:
- Global `$` namespaces (`$.db`, `$.hdb`, `$.net`, `$.session`, `$.security`, `$.text`, `$.trace`, `$.util`, `$.web`, `$.jobs`, `$.Application`, `$.Session`)
- `$.import(package, library)` module type resolution for:
  - `sap.hana.xs.libs.dbutils` -> `xsds` (`$importEntity`, `$defineEntity`, `$getEntity`, `Entity`, `Expr`, `Query`, `Rename`, `Transaction`), `procedures` (`allProcedures`, `procedure`, `procedureOfSchema`, `setTempSchema`, `configuration`, `notrace`, `simpletrace`)
  - `sap.hana.testtools.mockstar` -> `mockstar` / `apiFacade` (`TruncOptions`, `createTestModel`), `mockstarEnvironment` (`define`, `defineAndCreate`, `MockstarEnvironment`)
  - `sap.hana.testtools.unit.util` -> `sqlExecutor` (`SqlExecutor`), `tableDataSet` (`TableDataSet`, `createFromArray`, `createFromCSVList`, `createFromJSON`, `createFromResultSet`, `isTableDataSet`), `tableUtils` (`TableUtils`), `dateUtils` (`DateUtils`)
- XSUnit global BDD functions & namespace: `jasmine.*` (`CallTracker`, `Expectation`, `Spec`, `Spy`, `SpyStrategy`, `Suite`, `createSpy`, `createSpyObj`, `callHTTPService`, `dbConnection`, `hdbConnection`, `tags`, `addProfile`, `any`, `isSpy`, `log`, `objectContaining`), plus `describe`, `xdescribe`, `describeDb`, `xdescribeDb`, `it`, `xit`, `expect`, `spyOn`, `beforeEach`, `afterEach`, `beforeOnce`, `afterOnce`

---

## 2. Offline Suggestion, Hover & Signature Rules

### 2.1 Comment & String Suppression

- Line comments (`--`, `//`), block comments (`/* ... */`), and string literals MUST suppress SQL/XSJS identifier completions and hover popups.
- **Exception (XSJS `$.import`):** String literal completion is enabled inside the 1st and 2nd string arguments of `$.import("...", "...")` to suggest known SAP XS package and library names (`sap.hana.xs.libs.dbutils`, `sap.hana.testtools.mockstar`, `sap.hana.testtools.unit.util`, etc.).

### 2.2 SQLScript Context Triggers

| Trigger Context | Suggested Items | Example |
| :--- | :--- | :--- |
| `::` prefix | Built-in SQLScript system variables | `::ROWCOUNT`, `::SQL_ERROR_CODE`, `::SQL_ERROR_MESSAGE`, `::CURRENT_LINE_NUMBER`, `::CURRENT_OBJECT_NAME`, `::CURRENT_OBJECT_SCHEMA` |
| `USING [SYS.]` or `SYS.` | Built-in `SYS.SQLSCRIPT_*` libraries | `SQLSCRIPT_SYNC`, `SQLSCRIPT_STRING`, `SQLSCRIPT_PRINT`, `SQLSCRIPT_LOGGING`, `SQLSCRIPT_TEST` |
| `<libAlias>:` or `<LIB_NAME>:` | Members and constants of resolved library (from `USING [SYS.]<LIB> AS <alias>;` or direct `SQLSCRIPT_*`) | `STR_LIB:SPLIT`, `LOG_LIB:LEVEL_ERROR` |
| `:` variable prefix (not `::` and not preceded by identifier) | Declared parameters (`IN`/`OUT`/`INOUT`) and `DECLARE` local variables/cursors/conditions in file | `:iv_id`, `:lt_items`, `:lv_total` |
| General identifier context | Cased SQL keywords (`KEYWORDS`), data types (`TYPES`), system constants, and built-in functions (`SYS`, `GRAPHSCRIPT`) | `SELECT`, `NVARCHAR`, `CURRENT_TIMESTAMP`, `L2DISTANCE(...)`, `COALESCE(...)` |

### 2.3 Case Adaptation & Platform Hints

- Keyword, function, and data-type completion insert text respects `hanasql.format.keywordCase`, `hanasql.format.functionCase`, and `hanasql.format.dataTypeCase` (defaulting `'preserve'` to uppercase canonical form).
- Built-in function completions insert call snippet `<FUNC>($1)` / `<FUNC>()` when not immediately followed by `(`.
- Legacy `CE_*` operators carry platform notes (`[XSC]/[XSA]/[HDI]`) and are tagged `Deprecated` when `hanasql.analyze.targetPlatform === 'cloud'`.

### 2.4 Design-Time JSON & Classic KV Suggestions

- `.xsaccess`: Root keys (`exposed`, `authentication`, `authorization`, `prevent_xsrf`, `force_ssl`, `anonymous_connection`, `default_connection`, `cors`, `headers`, `cache_control`, `mime_types`, `rewrite_rules`, `default_file`, `max_request_runtime`) plus authentication `"method"` enums (`"Form"`, `"Basic"`, `"SAML"`, `"LogonTicket"`, `"X509"`, `"SPNEGO"`).
- `.hdiconfig`: `plugin_version`, `minimum_feature_version`, `file_suffixes`, `plugin_name`, and documented `com.sap.hana.di.*` plug-in identifiers.
- `.hdbgrants` / `.hdbrevokes`: Grantor object-level blocks (`object_owner`, `application_user`), privilege containers (`schema_privileges`, `object_privileges`, `global_object_privileges`, `roles`, `schema_roles`), and object privilege properties (`reference`, `privileges`, `privileges_with_grant_option`, `include_filter`).
- Classic KV (`hdbtable`, `hdbview`, `hdbsequence`, `hdbti`, `xshttpdest`): Property keys matching [classic-kv-formatting.md](file:///e:/Code/js/vscode-sap-hana-dev-tools/docs/specs/artifacts/classic-kv-formatting.md) (`table.schemaName`, `table.tableType`, `table.columns`, `sqlType`, `reset_by`, `delimField`, `authType`, etc.).
