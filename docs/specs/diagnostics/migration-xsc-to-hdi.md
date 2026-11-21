# SAP HANA XSC <-> XSA/HDI Migration & Refactoring Specification

> **Status:** Authoritative Specification (Phase 3)
> **Rule Namespace:** `HANA-MIG-001` – `HANA-MIG-020`
> **Platforms:** `[XSC]` <-> `[XSA]` `[HDI]` `[CLOUD]`
>
> **Sources:**
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en/004_2_Migrating_SAP_HANA_XS_Classic_Applications_to_the_XS_Advanced_Model.md` (Pages 60–98)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/005_3_Creating_the_Persistence_Model_with_HDBTable.md` (Pages 16–52)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md` (Pages 307–358)
> - `docs/specs/grammars/hdb-classic-kv.md`
> - `docs/specs/artifacts/hdbrole-formatting.md`
> - `docs/specs/grammars/cds.md`

---

## 1. Rule & Transformation Index

| Rule ID | Severity | Direction | Target Extensions | Auto-Convert / QuickFix | Summary |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `HANA-MIG-001` | `Information` | `[XSC]` <-> `[HDI]` | `.hdbtable` | Bidirectional | Classic KV `.hdbtable` (`table.columns = [...]`) <-> HDI DDL (`COLUMN TABLE ...`). |
| `HANA-MIG-002` | `Information` | `[XSC]` <-> `[HDI]` | `.hdbview` | Bidirectional | Classic KV `.hdbview` (`query = "..."`) <-> HDI DDL (`VIEW ... AS ...`). |
| `HANA-MIG-003` | `Information` | `[XSC]` <-> `[HDI]` | `.hdbsequence` | Bidirectional | Classic KV `.hdbsequence` <-> HDI DDL (`SEQUENCE ...`). |
| `HANA-MIG-004` | `Information` | `[XSC]` -> `[HDI]` | `.hdbrole` | Yes | Classic `.hdbrole` privilege DSL -> HDI JSON `.hdbrole` schema. |
| `HANA-MIG-005` | `Warning` | `[XSC]` -> `[HDI]` | `.hdbdd`, `.hdbcds` | Yes | `.hdbdd` `@Schema` and XSC `@Catalog.*` annotations -> HDI `.hdbcds`. |
| `HANA-MIG-006` | `Information` | `[XSC]` -> `[HDI]` | `.hdbstructure` | Yes | Classic KV `.hdbstructure` -> HDI DDL `.hdbtabletype` (`TYPE ... AS TABLE (...)`). |
| `HANA-MIG-010` | `Warning` | `[XSC]` -> `[HDI]` | `.hdbprocedure`, `.hdbfunction` | Yes | Remove `DEFAULT SCHEMA <schema>` clause disallowed in schema-agnostic HDI deployments. |
| `HANA-MIG-011` | `Warning` | `[XSC]` -> `[HDI]` | `.hdbprocedure`, `.hdbview`, `.xsjs`, `.xsodata` | Yes | Remove hardcoded `_SYS_BIC` or explicit schema prefixes (`"SCHEMA"."pkg::OBJ"`). |
| `HANA-MIG-012` | `Information` | `[XSC]` -> `[HDI]` | `.hdbschema`, `.hdbti`, `.xsodata` | Partial | Obsolete `.hdbschema` / `.hdbti` -> `.hdbtabledata` / `.xsodata` `"/" -> "::"` & schema cleanup. |
| `HANA-MIG-013` | `Information` | `[XSC]` -> `[HDI]` | renamed, replaced or unsupported suffixes (`docs/specs/artifacts/artifact-registry.md`) | Rename | The file suffix is renamed, replaced or not supported in HDI. A file-rename QuickFix where the content stays valid. |
| `HANA-MIG-020` | `Warning` | `[XSC]` -> `[XSA]` | `.xsjs`, `.xsjslib` | No | Deprecated/unsupported XS Classic APIs (`$.repo`, `$.config`, `assertSystemPrivilege`). |

*(Note: Structural conversion diagnostics `HANA-MIG-001`–`004` and `006` fire as low-noise `Information` hints on classic artifacts or when reverse-converting HDI artifacts via command palette `hanasql.migrate.*`, enabling single-click preview/apply CodeActions without spamming errors in pure XSC workspaces.)*

---

## 2. AST Mapping Contracts

### 2.1 `.hdbtable` (`HANA-MIG-001`: Classic KV <-> HDI DDL)

> Source: `004_2_Migrating_...md:3961-3994`, `005_3_Creating_the_Persistence_Model_with_HDBTable.md:245-451`, `008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md:3110-3144`

#### Classic KV Properties -> HDI DDL Clauses

| Classic KV Field | HDI DDL Equivalent | Notes |
| :--- | :--- | :--- |
| `table.schemaName = "S";` | *(Omitted in HDI)* | Container owns schema; stripped cleanly on XSC -> HDI. |
| `table.tableType = COLUMNSTORE \| ROWSTORE;` | `COLUMN TABLE` / `ROW TABLE` | Default to `COLUMN TABLE` if omitted. |
| `table.temporary = true;` | `GLOBAL TEMPORARY COLUMN TABLE` | Or `GLOBAL TEMPORARY ROW TABLE`. |
| `table.description = "...";` | `COMMENT '...'` (table-level) | Escapes single quotes (`''`). |
| `table.loggingType = NOLOGGING \| LOGGING;` | `NO LOGGING` (HDI `<table_option>`) | Appended after closing paren when `NOLOGGING`. |
| `table.columns = [{...}];` | `("<col>" <SQLTYPE> ...)` | Inside column list (see column field mapping below). |
| `table.primaryKey.pkcolumns = ["A", "B"];` | `, PRIMARY KEY ("A", "B")` | Appended inside column/constraint parenthesis list. |
| `table.indexes = [{...}];` | Extracted `.hdbindex` suggestion | HDI enforces one object per file; emits `-- TODO(.hdbindex): [UNIQUE] [BTREE\|CPBTREE] INDEX "<name>" ON "<tbl>" (...)` comment block below table DDL. |

#### Column Struct Mapping

| Classic Column Key | HDI Column Syntax | Notes |
| :--- | :--- | :--- |
| `name = "COL";` | `"COL"` | Preserves exact column identifier. |
| `sqlType = <TYPE>;` | `<TYPE>` | Base SQL type (`VARCHAR`, `NVARCHAR`, `INTEGER`, `BIGINT`, `DECIMAL`, `DAYDATE`, `SECONDDATE`, `TIMESTAMP`, `CLOB`, `NCLOB`, `BLOB`, `DOUBLE`, `REAL`, etc.). |
| `length = N;` | `(<N>)` | Applied to string/binary types (`VARCHAR`, `NVARCHAR`, `ALPHANUM`, `VARBINARY`, `SHORTTEXT`). |
| `precision = P; scale = S;` | `(<P>, <S>)` or `(<P>)` | Applied to `DECIMAL` / numeric precision types (`scale` defaults omitted if absent). |
| `nullable = false \| true;` | `NOT NULL` | Emitted only when `nullable = false`; `NULL` omitted or optional. |
| `defaultValue = <val>;` | `DEFAULT <literal>` | String literals `'...'`; unquoted keywords (`CURRENT_TIMESTAMP`, integers, booleans) kept unquoted unless string-typed. |
| `comment = "...";` | `COMMENT '...'` | Escapes internal `'`. |

#### HDI DDL -> Classic KV Reverse Mapping
- Object name extracted from `<COLUMN|ROW> TABLE ["schema".]"name"` -> derives fallback identifier for `table.schemaName = "<TARGET_SCHEMA>";` (default `"MYSCHEMA"` unless workspace/file annotation provides it) and `table.tableType = COLUMNSTORE | ROWSTORE;`.
- Column definitions (`"COL" TYPE[(len|p,s)] [DEFAULT ...] [NOT NULL] [COMMENT '...']`) map back to `{name = "..."; sqlType = ...; nullable = true|false; length/precision/scale; defaultValue; comment;}`.
- `PRIMARY KEY ("A", "B")` maps to `table.primaryKey.pkcolumns = ["A", "B"];`.
- Table-level `COMMENT '...'` maps to `table.description = "...";`.

**Example (`HANA-MIG-001`):**
```text
// Before (XSC Classic .hdbtable)
table.schemaName = "APP_SCHEMA";
table.tableType = COLUMNSTORE;
table.description = "Sales orders";
table.columns = [
  {name = "ORDER_ID"; sqlType = BIGINT; nullable = false;},
  {name = "CUST_NAME"; sqlType = NVARCHAR; length = 120; nullable = true; defaultValue = "N/A"; comment = "Customer";},
  {name = "AMOUNT"; sqlType = DECIMAL; precision = 15; scale = 2; nullable = false;}
];
table.primaryKey.pkcolumns = ["ORDER_ID"];
```
```sql
-- After (HDI .hdbtable)
COLUMN TABLE "app.data::ORDERS" (
  "ORDER_ID" BIGINT NOT NULL,
  "CUST_NAME" NVARCHAR(120) DEFAULT 'N/A' COMMENT 'Customer',
  "AMOUNT" DECIMAL(15, 2) NOT NULL,
  PRIMARY KEY ("ORDER_ID")
) COMMENT 'Sales orders'
```

---

### 2.2 `.hdbview` (`HANA-MIG-002`: Classic KV <-> HDI DDL)

> Source: `004_2_Migrating_...md:4026-4037`, `005_3_Creating_the_Persistence_Model_with_HDBTable.md:1308-1340`, `008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md:2540-2610`

#### Classic KV -> HDI DDL Mapping
1. Parse `schema = "<S>";`, `query = "<Q>";`, optional `public = ...;`, `depends_on_table`, `depends_on_view`, `depends_on`.
2. Unescape JavaScript/KV string escapes inside `query` (`\"` -> `"`, `\n` -> newline, `\t` -> tab, `\\` -> `\`).
3. Strip `"<S>".` (exact matching `schema` prefix and optional `_SYS_BIC.`) from table/view references inside `<Q>` so container-local objects resolve cleanly (cross-schema objects still emit `.hdbsynonym` reminder comment if another schema prefix remains).
4. Determine HDI view artifact name from active file URI path / basename (e.g., `my.pkg::MY_VIEW` or `"MY_VIEW"`).
5. Emit:
   ```sql
   VIEW "<OBJECT_NAME>"
   AS <unescaped_query>
   ```
   *(Omitting trailing semicolon unless project/dialect requires it; pure HDI `.hdbview` examples omit `;` or allow without `CREATE`.)*

#### HDI DDL -> Classic KV Reverse Mapping
1. Parse `[PUBLIC] VIEW ["schema".]"name" AS <SELECT ...>` (excluding trailing `WITH ASSOCIATIONS` or noting unsupported HDI associations in comment).
2. Escape `"` as `\"` inside `<SELECT ...>` and strip trailing `;`.
3. Extract `FROM` / `JOIN` table/view identifiers into `depends_on = [...];` (if resolvable), emit `schema = "MYSCHEMA";` + `query = "...";`.

---

### 2.3 `.hdbsequence` (`HANA-MIG-003`: Classic KV <-> HDI DDL)

> Source: `004_2_Migrating_...md:4010-4020`, `005_3_Creating_the_Persistence_Model_with_HDBTable.md:1005-1080`, `008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md:2508-2538`

| Classic KV Field | HDI DDL Clause | Notes |
| :--- | :--- | :--- |
| `schema = "...";` | *(Removed in HDI)* | |
| `increment_by = N;` | `INCREMENT BY N` | |
| `start_with = N;` | `START WITH N` | |
| `maxvalue = N;` | `MAXVALUE N` | |
| `nomaxvalue = true \| false;` | `NO MAXVALUE` (if `true`) | |
| `minvalue = N;` | `MINVALUE N` | |
| `nominvalue = true \| false;` | `NO MINVALUE` (if `true`) | |
| `cycles = true \| false;` | `CYCLE` (if `true`) / `NO CYCLE` (if `false`) | |
| `reset_by = "<query>";` | `RESET BY <unescaped query>` | Strips the `"<schema>".` prefix matching `schema=` (same rule as `.hdbview`, §2.2 step 3). |
| `public`, `depends_on*` | *(Removed in HDI)* | |

> `NO MAXVALUE` / `NO MINVALUE` are two words in the HANA SQL `<sequence_parameter>` grammar
> (`hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/024_pages_691_720.md:151-190`).
> The single-word `NOMAXVALUE` / `NOMINVALUE` is invalid and must never be emitted; the reverse converter
> still accepts it so files written by converter versions <= 0.10.1 convert back.

```sql
-- Example HDI .hdbsequence output
SEQUENCE "my.pkg::SEQ_ORDER_ID"
  INCREMENT BY 1
  START WITH 1000
  NO MAXVALUE
  RESET BY SELECT IFNULL(MAX("ORDER_ID"), 0) + 1 FROM "my.pkg::ORDERS"
```

---

### 2.4 `.hdbrole` (`HANA-MIG-004`: Classic DSL -> HDI JSON)

> Source: `004_2_Migrating_...md:4092-4157`, `docs/specs/artifacts/hdbrole-formatting.md`, `008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md:1865-1945`

| Classic `.hdbrole` Statement | HDI JSON `.hdbrole` Property | Notes |
| :--- | :--- | :--- |
| `role pkg::RoleName [extends ...]` | `"role": { "name": "pkg::RoleName", ... }` | The header is split at each `extends`: only the tokens before the first one form the name. Append `#` only when an object or schema privilege carries `WITH GRANT OPTION`. |
| `extends role pkg::A, pkg::B` | `"schema_roles": [{ "names": ["pkg::A", "pkg::B"] }]` | Container-local schema role reference. Allowed in the header or as a body statement, and may list several roles. |
| `extends catalog role "R1", "R2"` | `"global_roles": ["R1", "R2"]` | External catalog role. |
| `system privilege: P1, P2;` | `"system_privileges": ["P1", "P2"]` | Direct array. HDI has no grant-option form, so `WITH GRANT OPTION` is dropped and reported. |
| `schema x.hdbschema: P;` | `"schema_privileges": [{ "privileges": ["P"] }]` | Local container schema omits `"reference"`. |
| `catalog schema "S": P;` | `"schema_privileges": [{ "reference": "S_REF", "privileges": ["P"] }]` | Requires `.hdbroleconfig` / `.hdbgrants` mapping external schema `"S"`. |
| `sql object pkg:A.hdbtable, pkg:B.hdbprocedure: P;` | `"object_privileges": [{ "name": "pkg::A", "type": "TABLE", ... }, { "name": "pkg::B", "type": "PROCEDURE", ... }]` | One entry per comma-separated object, each sharing the privilege list. The name converts `pkg:OBJ.suffix` to `pkg::OBJ`, and the type comes from the object's own suffix (see the suffix table below). An unknown suffix is kept in the name, gets the `"TABLE"` placeholder, and is reported. |
| `catalog sql object "S"."O": P;` | `"object_privileges": [{ "name": "O", "type": "TABLE", "privileges": ["P"] }]` | Reports a `.hdbsynonym` reminder for the external object `S.O` and asks the user to confirm the assumed type. |
| `analytic privilege: ...;` | `"schema_analytic_privileges": [{ "privileges": [...] }]` | Must migrate classic XML analytic privilege to SQL analytic privilege. |
| `catalog analytic privilege: ...;` | `"schema_analytic_privileges": [...]` | Same. |
| `... WITH GRANT OPTION;` | `"privileges_with_grant_option": [...]` | Moves grantable privileges into `privileges_with_grant_option` (requires `#` on role name). |
| `package <pkg>: ...;` | *(Dropped — deprecated in HDI)* | Repository packages do not exist in HDI. Reported. |
| `application privilege: <p>;` | *(Dropped from `.hdbrole` — move to `xs-security.json`)* | Reported, with a pointer to XSUAA scope migration. |

**Object suffix -> `type`:** `hdbtable`, `table` -> `TABLE`; `hdbview`, `view`, `attributeview`, `analyticview`, `calculationview`, `hdbcalculationview` -> `VIEW`; `hdbprocedure`, `procedure` -> `PROCEDURE`; `hdbfunction`, `hdbtablefunction`, `hdbscalarfunction` -> `FUNCTION`; `hdbsequence`, `sequence` -> `SEQUENCE`; `hdbsynonym` -> `SYNONYM`.

**Reporting dropped content:** JSON cannot hold comments or notes. Everything the QuickFix cannot carry over is listed in the `HANA-MIG-004` diagnostic message under `Not carried over by the QuickFix:`, one `<statement> — <reason>` line per item. That covers source comments (§4), `package` and `application privilege` statements, the `catalog sql object` synonym reminder, unknown object types, and a system-privilege grant option.

---

### 2.5 `.hdbdd` -> `.hdbcds` (`HANA-MIG-005`)

> Source: `004_2_Migrating_...md:3703-3711`, `docs/specs/grammars/cds.md`

| Classic `.hdbdd` Construct | HDI `.hdbcds` Conversion |
| :--- | :--- |
| `@Schema : 'MY_SCHEMA'` (or `@Schema: '...'`) | **Remove** completely (HDI assigns container schema automatically). |
| `@Catalog.tableType : #COLUMN` | Remove the annotation and add `column store;` to the entity's technical configuration, which follows the entity's closing brace: `entity E { ... } technical configuration { column store; };`. |
| `@Catalog.tableType : #ROW` | Same, with `row store;`. |
| `@Catalog.index : [ { name : 'IDX', unique : true, order : #ASC, elementNames : ['A', 'B'] } ]` | One clause per index, ordered as a whole: `[unique] index IDX on (A, B) asc;` (`#DESC` -> `desc`). |
| `@WithStructuredPrivilegeCheck` | Replace with `with structured privilege check` clause on `view` / `entity` (or note HDI compatibility). |
| `using "SCHEMA"::Obj;` | Strip explicit external schema where local container object applies. |

**Technical configuration placement** (`SAP_HANA_Core_Data_Services_CDS_Reference_en/006_4_Creating_Data_Persistence_Artifacts_with_CDS_in_XS_Advanced.md:630-660,780-830`; `docs/specs/grammars/cds.md`):

1. The block always goes **after** the entity's closing brace, never inside the element list: `} technical configuration { ... };`. XS advanced does not support `@Catalog.tableType` or `@Catalog.index`.
2. **No block yet:** insert `technical configuration { ... }` right after the entity's `}`, before its `;` (add the `;` when it is missing). For a multi-line entity, put each clause on its own line at the element indentation, with the closing `}` at the entity brace's indentation. For a single-line entity, keep it on one line.
3. **Block already present:** merge the clauses into it before its closing `}`. Skip the store clause when the block already has `column store;` or `row store;`, and skip any index whose name is already declared. SAP forbids the annotation and the matching clause together, so the existing clause wins and nothing is duplicated.
4. Store clauses come before index clauses. Running the fix again on its own output changes nothing.

### 2.6 `.attributeview` / `.analyticview` -> `.hdbcalculationview` (no rule yet)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/061_Modeler_Artifacts_(Attribute,_Analytic,_Calcview_etc.).md (Pages 73–74)

XS Classic attribute views become calculation views with `dataCategory="DIMENSION"` and analytic views become calculation views with `dataCategory="CUBE"`. The migrator has no conversion or diagnostic for them yet. The structure mapping and the list of features removed during migration are in `docs/specs/artifacts/xsc-modeled-views.md` §5. SQL references to the activated views (`"_SYS_BIC"."pkg/AT_X"` -> `"pkg::AT_X"`) are already rewritten by `HANA-MIG-011`.

---

## 3. Code-Level Migration Rules (`HANA-MIG-010` – `HANA-MIG-020`)

### `HANA-MIG-010` `DEFAULT SCHEMA` in Stored Procedures/Functions
- **Severity:** `Warning`
- **Target Extensions:** `.hdbprocedure`, `.hdbfunction`, `.sql`
- **AST / Lexical Trigger:** `DEFAULT SCHEMA <ident>` inside `CREATE PROCEDURE` / `PROCEDURE` / `FUNCTION` header in HDI-oriented code (also catches XSC KV artifact properties `default_schema` in headers).
- **QuickFix:** Remove `DEFAULT SCHEMA <ident>` from the procedure/function header (`004_2_Migrating_...md:4074`).

### `HANA-MIG-011` Hardcoded Schema or `_SYS_BIC` Qualifiers
- **Severity:** `Warning`
- **Target Extensions:** `.hdbprocedure`, `.hdbfunction`, `.hdbview`, `.xsjs`, `.xsjslib`, `.xsodata`
- **AST / Lexical Trigger:**
  - Object reference matching `"_SYS_BIC"."pkg/name"` or `_SYS_BIC."pkg/name"` or `"_SYS_BIC"."pkg::name"`, OR explicit `"_SYS_REPO".*` usage.
  - `.xsodata` exposed service paths using slash separator `"pkg/VIEW.calculationview"` (`004_2_Migrating_...md:4460-4476`).
- **QuickFix:**
  - Replace `"_SYS_BIC"."pkg/name"` -> `"pkg::name"` (add suggestion for `.hdbsysbicsynonym` / `.hdbsynonym` if cross-container).
  - Replace `.xsodata` `"pkg/NAME.calculationview"` -> `"pkg::NAME"`.

### `HANA-MIG-012` Obsolete XSC Metadata Artifacts
- **Severity:** `Information`
- **Target Extensions:** `.hdbschema`, `.hdbti`, `.hdbstructure`
- **Trigger:**
  - `.hdbschema`: In HDI, database schemas are managed by the container (`#OO` / RT schema); `.hdbschema` files are obsolete (`004_2_Migrating_...md:3998-4008`).
  - `.hdbti`: Replaced by HDI JSON `.hdbtabledata` (`004_2_Migrating_...md:3837-3846`).
  - `.hdbstructure`: Replaced by HDI DDL `.hdbtabletype` (`HANA-MIG-006` QuickFix converts structure columns -> `TYPE "<name>" AS TABLE (...)`).

### `HANA-MIG-013` Renamed, Replaced or Unsupported Design-Time Suffix

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/052_Migrated_XS_Database_Objects.md (Pages 65–67)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/053_hdbtable.md (Page 68)

- **Severity:** `Information`
- **Platform Scope:** `[XSC]` -> `[HDI]`. Off when `hanasql.analyze.migration` is `false` or `hanasql.analyze.targetPlatform` is `xsc`. Suppressible with `hanasql-analyze-disable`.
- **Scope (#120):** the rule covers every suffix the migration guide marks as renamed, replaced or unsupported in HDI, including suffixes registered before #82 (`.calculationview`, `.hdbtablefunction`, `.analyticprivilege`, `.attributeview`, `.analyticview`, `.hdbtid`, `.hdbtim`, `.hdbdecisiontable`). This matches `HANA-MIG-001` .. `-006` and `-012`, which also report XS Classic files under `targetPlatform: "auto"`. XS Classic-only workspaces set `hanasql.analyze.targetPlatform` to `xsc`.
- **Target Extensions:** every suffix whose `artifact-registry.md` §2 Migrator column lists `HANA-MIG-013` (`SUFFIX_MIGRATIONS` in `src/analyzer/suffix-migration.ts`). Suffixes handled by `HANA-MIG-005`, `-006` and `-012` (`.hdbdd`, `.hdbstructure`, `.hdbschema`, `.hdbti`) are not repeated.
- **AST / Lexical Trigger:** the last suffix of the document's file path (case-insensitive). The content is not inspected, so the rule needs a file path and fires on untitled documents never.
- **Diagnostic Span & Message:** the first line. `'<suffix>' <reason>`, e.g. `'.searchruleset' is the XS Classic suffix of search rule sets. HDI uses '.hdbsearchruleset' with the same syntax.`
- **QuickFix:** `Rename to <suffix>`, a file rename without text edits (`CodeFixSuggestion.rename`), offered only when the registry status is `renamed → <suffix>`:

| Suffix | Status | QuickFix |
| :--- | :--- | :--- |
| `.calculationview` | `renamed → .hdbcalculationview` (same syntax) | `Rename to .hdbcalculationview` |
| `.searchruleset` | `renamed → .hdbsearchruleset` (same syntax) | `Rename to .hdbsearchruleset` |
| `.textminingconfig` | `renamed → .hdbtextminingconfig` (same syntax) | `Rename to .hdbtextminingconfig` |
| `.hdbsynonymgrantor` | `renamed → .hdbgrants` (backwards-compatible alias) | `Rename to .hdbgrants` |
| `.hdbscalarfunction`, `.hdbtablefunction` | `renamed → .hdbfunction` | `Rename to .hdbfunction` |
| `.analyticprivilege` | `replaced → .hdbanalyticprivilege` (classical XML privilege must become an SQL analytic privilege) | — |
| `.attributeview`, `.analyticview` | `replaced → .hdbcalculationview` (`artifacts/xsc-modeled-views.md` §5) | — |
| `.procedure` | `replaced → .hdbprocedure` (XML format) | — |
| `.hdbtid`, `.hdbtim` | `replaced → .hdbtabledata` | — |
| `.dqconfig` | `replaced → .hdbflowgraph` | — |
| `.hdbhadoopmrjob` | `replaced → .hdbvirtualpackagehadoop` (deprecated plug-in) | — |
| `.hdbtextbundle`, `.hdbruldec`, `.decrule`, `.hdbdecisiontable`, `.aflpmml`, `.hdbflowgraphtemplate`, `.dataflow`, `.halmscenario` | `unsupported` | — |

  - **Legacy Code (`Before`):** `models/Search.searchruleset`

    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <SearchRuleSet:ruleSet xmlns:SearchRuleSet="http://www.sap.com/ndb/SearchRuleSet.ecore">
    ```

  - **Migrated Code (`After`):** the same content in `models/Search.hdbsearchruleset`.

### `HANA-MIG-020` Unsupported XS Classic Runtime APIs in XSA (`$.repo`, `$.config`, `hasSystemPrivilege`)
- **Severity:** `Warning`
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **Trigger:** Calls or property accesses on `$.repo.*`, `$.config.*`, `$.session.hasSystemPrivilege(...)`, `$.session.assertSystemPrivilege(...)`, or `$.session.hasAppPrivilege(...)` / `$.session.assertAppPrivilege(...)` (`004_2_Migrating_...md:4345-4363`).
- **Diagnostic Message:** `'<api>' is unsupported or semantics changed in XS Advanced (@sap/xsjs). Replace $.session app privileges with XSUAA scopes ('$.session.hasAppPrivilege' -> XSUAA scope name) and remove $.repo / $.config.`

---

## 4. Comment Preservation & Regression Harness

AGENTS.md says tooling must never strip comments. Every structural migration QuickFix either keeps each source comment or reports it as dropped.

| QuickFix | Comment handling |
| :--- | :--- |
| `HANA-MIG-001`, `002`, `003`, `006` (classic KV -> SQL DDL) | All comments outside string values move to a SQL header block before the DDL, in source order. `//` becomes `--`; `--` and `/* */` are kept. Comments inside a value (such as `query = "..."`) stay inside it. |
| Reverse `001`, `002`, `003` (SQL DDL -> classic KV) | Comments come back as a KV header block, with `--` turned into `//`. Comments inside verbatim-copied SQL (the `.hdbview` query, the `RESET BY` subquery) stay inside it and are not duplicated. `-- TODO(.hdbindex): ...` lines written by `HANA-MIG-001` are parsed back into `table.indexes`, not kept as comments. |
| `HANA-MIG-004` (`.hdbrole` -> JSON) | JSON cannot hold comments, so each comment is listed in the diagnostic message as `<comment> — comment dropped: JSON .hdbrole cannot hold comments` (see §2.4). |
| `HANA-MIG-005` (`.hdbdd` -> `.hdbcds`) | Edits in place. Comments are never touched, including a comment that shares a line with a removed annotation. |

**Regression harness** (`test/migration-transformer.test.ts`) applies every structural QuickFix to every file in `samples/xs-classic/` and `samples/format-demos/` and asserts:

1. The output is non-empty.
2. The output has no `syntax` diagnostics of severity `error` in its target language (`.hdbstructure` -> `hdbtabletype`, `.hdbdd` -> `hdbcds`).
3. Running the analyzer on the output finds nothing left to migrate (idempotency).
4. Each source comment appears in the output or in the diagnostic message.
5. For bidirectional rules, forward -> reverse -> forward reproduces the first forward output exactly.

A new classic sample is covered automatically. Add it to `EXPECTED_MIGRATABLE_SAMPLES` so the harness fails if the QuickFix stops being offered.
