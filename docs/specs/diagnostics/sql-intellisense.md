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

### 2.5 XSJS Inheritance, Overloads & Hover Cards `[XSC]` `[XSA]`

Applies to `xsjs` / `xsjslib` completions, hover, and signature help driven by `docs/specs/catalogs/xsjs-api.json`.

- **Inherited member resolution:** Members and methods are collected from the resolved type and its `extends` ancestors in breadth-first order (most-derived first).
  - Properties are deduplicated by name; the most-derived declaration wins.
  - Methods are deduplicated by **overload signature** — `name`, `static` flag, and the ordered list of parameter `type` + `optional` flags (parameter names are ignored). The most-derived declaration wins; ancestor overloads with a distinct signature are still inherited.
  - Example: `$.net.http.Request` → `$.web.WebRequest` → `$.web.WebEntityRequest` all declare `setBody(body: any | ArrayBuffer, index?: number)`; exactly one `setBody` overload is exposed, so completions show no `(+N overloads)` suffix and signature help lists one signature.
- **Static vs. instance filtering:** For `class` entries, hover applies the same rule as completions — a class reference (`$.net.http.Request.x`) only matches `static` members/methods, an instance (`new $.net.http.Request(...).x`, `$.request.x`) only matches non-static ones. Namespaces are not filtered.
- **Consolidated overload card:** Hover over an overloaded method (and method completion documentation) renders **one** card, never one card per overload:
  1. One `ts` code block stacking every overload signature. When the hovered identifier is directly followed by a call `(...)`, the overload whose arity accepts the call-site argument count is listed first.
  2. `**@deprecated**` notes: when every overload shares the same deprecation message it is shown once; otherwise each note is prefixed with the deprecated overload's signature (e.g. `$.db.getConnection(sqlcc, isolationLevel)`).
  3. Description: shown once when all overloads share identical prose (`$.import`, `$.db.getConnection`); otherwise listed per overload as `` `name(p1, p2)` — description `` (`$.net.http.Client.request`).
  4. `**Parameters**`: the union of all overload parameters, deduplicated by name + type + description, rendered as `` - `name` (`type`): description ``.
