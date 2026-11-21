# HDI Synonyms, Logical Schemas, Configurations, Table Data and Name Spaces: Property Schemas `[XSA]` `[HDI]` `[CLOUD]`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/008_pages_211_240.md (Pages 211–240: _Enterprise Search Configurations_, _Logical Schemas_, _Projection Views_)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/009_pages_241_270.md (Pages 241–270: _Public Synonyms_, _Synonyms_)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/010_pages_271_291.md (Pages 271–291: _Table Data_, _Virtual Tables_)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/007_5_Defining_the_Data_Model_in_XS_Advanced.md (Pages 237–275)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(HDI)_Reference_for_SAP_HAN/008_pages_211_240.md (Pages 211–240: _Hadoop Map Reduce Jobs_)

Layout rules: `json-formatting.md`. The XS Classic `.hdbsynonym` is in `xsc-application-artifacts.md` §11. None of these artifacts has key completion yet; they get highlighting, formatting and the JSON syntax checks (`HANA-SYN-010` / `-011`).

---

## 1. Metadata

| Extension | Language ID | Format | Runtime | `.hdiconfig` plug-in | Section |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `.hdbsynonym` | `hdbsynonym` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.synonym` | §2 |
| `.hdbsynonymconfig` | `hdbsynonymconfig` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.synonym.config` | §2 |
| `.hdbsynonymtemplate` | `hdbsynonymconfig` | JSON (old-style template) | `[XSA]` `[HDI]` | none (HDI Deployer turns it into `.hdbsynonymconfig`) | §2.4 |
| `.hdbpublicsynonym` | `hdbpublicsynonym` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.publicsynonym` (not a default library; an administrator enables it) | §3 |
| `.hdblogicalschema` | `hdblogicalschema` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.logicalschema` | §4 |
| `.hdblogicalschemaconfig` | `hdblogicalschemaconfig` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.logicalschema.config` | §4 |
| `.hdbvirtualtableconfig` | `hdbvirtualtableconfig` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.virtualtable.config` | §5 |
| `.hdbprojectionviewconfig` | `hdbprojectionviewconfig` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.projectionview.config` | §6 |
| `.hdbtabledata` | `hdbtabledata` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.tabledata` | §7 |
| `.hdinamespace` | `hdinamespace` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | none (always deployable, like `.hdiconfig`) | §8 |
| `.hdbeshconfig` | `hdbeshconfig` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.eshconfig` | §9 |
| `.hdbmrjob` | `hdbmrjob` | binary (Hadoop JAR, optionally with a metadata header) | `[XSA]` `[HDI]` | `com.sap.hana.di.virtualfunctionpackage.hadoop` (deprecated) | §10 |

---

## 2. Synonyms (`.hdbsynonym`, `.hdbsynonymconfig`, `.hdbsynonymtemplate`)

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/009_pages_241_270.md (Pages 241–270)

A synonym is a declaration (`.hdbsynonym`, optional default configuration) plus an optional explicit configuration (`.hdbsynonymconfig`). The configuration can be supplied as late as deployment time, and it overrides the default. Both files can hold several synonyms.

### 2.1 Structure

| Key | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `"<namespace>::<synonym>"` | `Object` | Yes | Root keys, one per synonym. Name-space rules: §8. |
| `.target` | `Object` | `.hdbsynonymconfig`: Yes; `.hdbsynonym`: No | Default configuration in `.hdbsynonym`; an empty object `{}` declares the synonym only. |

### 2.2 Target object (`target`)

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `object` | `String` | Yes | — | Target object name. |
| `schema` | `String` | No | container schema | Defined: the target is a run-time object outside HDI dependency management. |
| `revalidate` | `Boolean` | No | `true` | Only without `schema`. `false`: the container-local target is not a deployment dependency. |
| `logical_schema` | `String` | No | — | Deployment dependency on a `.hdblogicalschema` (§4). Not combined with `schema` or `revalidate`. |
| `remote` | `String` | No | — | Remote source. The object is not HDI-managed. Not combined with `database` (a logical schema used by synonyms must choose one of the two). |
| `database` | `String` | No | — | Remote database (cross-database access). Not combined with `remote`. |

Constraint summary: `logical_schema` ⟂ (`schema`, `revalidate`); `schema` ⟂ `revalidate`; `remote` ⟂ `database`.

### 2.3 Configuration templates (HDI Deployer)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/007_5_Defining_the_Data_Model_in_XS_Advanced.md (Pages 251–275, §5.2.1 _HDI Deployer_)

Configuration files in `cfg/` (synonym, projection-view, logical-schema, virtual-table configurations) may use template fields that the HDI Deployer resolves from a bound service:

| Template key | Type | Resolves to |
| :--- | :--- | :--- |
| `"<field>.configure"` | `String` (`"<service>/<field>"`) | The field of the bound service (`"schema.configure": "logical-external-service/schema"` → `"schema": "THE_SCHEMA"`). A field that the service lacks is removed. |
| `"*.configure"` | `String` (`"<service>"`) | Every well-known field the service has: `remote`, `database`, `schema`. |

Service names are subject to service replacement.

### 2.4 `.hdbsynonymtemplate` (old style)

The HDI Deployer processes a `.hdbsynonymtemplate` in `cfg/` or `src/` as a configuration template and writes a transient `.hdbsynonymconfig`. Its `grantor` field is replaced by the schema of the referenced service (`"grantor"` ≡ `"schema.configure": "<service>/schema"`).

### 2.5 Examples

```json
{
  "com.sap.hana.example::DUMMY": {
    "target": { "schema": "SYS", "object": "DUMMY" }
  },
  "com.sap.hana.example::CUSTOMERS": {
    "target": { "logical_schema": "com.sap.hana.example::ERP", "object": "KNA1" }
  },
  "com.sap.hana.example::REMOTE_T": {
    "target": { "remote": "REMOTE_A", "schema": "APP", "object": "T" }
  }
}
```

Invalid:

| Fragment | Problem |
| :--- | :--- |
| `"target": { "schema": "S", "object": "T", "revalidate": false }` | `revalidate` is not allowed with `schema` |
| `"target": { "logical_schema": "L", "schema": "S", "object": "T" }` | `logical_schema` excludes `schema` |
| `"target": { "remote": "R", "database": "D", "object": "T" }` | a synonym accepts `remote` or `database`, not both |
| `"target": { "schema": "SYS" }` | `object` is required |
| a synonym named `DUMMY` for `SYS.DUMMY` | shadows a public synonym and can lock system objects (SAP Note 3239397) |

---

## 3. `.hdbpublicsynonym`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/009_pages_241_270.md (Pages 241–270)

Intended for migration scenarios. Creates synonyms in `PUBLIC` that point to objects in the container schema. A public synonym name can be created from one container only.

| Key | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `"<public synonym name>"` | `Object` | Yes | Root keys; normal name-space rules. |
| `.target.object` | `String` | Yes | Container object. No `schema`, `logical_schema` or `remote`. |

```json
{ "com.sap.hana.example::A_Public_Synonym": { "target": { "object": "com.sap.hana.example::A_TABLE" } } }
```

Invalid: `"target": { "schema": "OTHER", "object": "T" }` (only container objects).

---

## 4. Logical Schemas (`.hdblogicalschema`, `.hdblogicalschemaconfig`)

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/008_pages_211_240.md (Pages 211–240)

A logical schema maps a name to a real schema (and optionally a remote source or database). Synonyms, projection views, virtual tables and role configurations refer to it with `logical_schema`. The target schema must already exist.

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `"<namespace>::<logical schema>"` | `Object` | Yes | — | Root keys; `{}` in `.hdblogicalschema` declares without a default. |
| `.target.schema` | `String` | Yes | — | Non-empty; must differ from the container schema. |
| `.target.remote` | `String` | No | — | Not supported by projection views. |
| `.target.database` | `String` | No | — | Not combinable with `remote` when the logical schema is used by synonyms. |

```json
{ "com.sap.hana.example::ERP": { "target": { "schema": "SAPERP" } } }
```

Invalid: `"target": {}` (schema mandatory); `"target": { "schema": "" }`; the container's own schema as target.

---

## 5. `.hdbvirtualtableconfig`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/010_pages_271_291.md (Pages 271–291)

Overrides the `AT <remote>.<object>` default of a `.hdbvirtualtable` (`VIRTUAL TABLE ... AT ...`; `WITH REMOTE` is not supported). The object owner needs `CREATE VIRTUAL TABLE` on the remote source.

| Key | Type | Required | Allowed values / constraints |
| :--- | :--- | :---: | :--- |
| `"<virtual table name>"` | `Object` | Yes | Root keys. |
| `.target.remote` | `String` | Yes, unless `logical_schema` | Remote source; overrides the one in the `.hdbvirtualtable`. |
| `.target.database` | `String` | No | Remote database. |
| `.target.schema` | `String` | No | Remote schema. |
| `.target.object` | `String` | Yes | Remote object. |
| `.target.logical_schema` | `String` | No | Excludes `remote`, `database` and `schema`. |

```json
{ "com.sap.hana.example::REMOTE_CUSTOMERS": { "target": { "remote": "REMOTE_SYSTEM_A", "database": "DATABASE_B", "schema": "APP_C", "object": "CUSTOMERS" } } }
```

Invalid: `"target": { "logical_schema": "L", "remote": "R", "object": "T" }`.

---

## 6. `.hdbprojectionviewconfig`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/008_pages_211_240.md (Pages 211–240)

Binds the `FROM` object of a `.hdbprojectionview`. The object owner needs the required privileges (with grant option when the view is exposed).

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `"<projection view name>"` | `Object` | Yes | — | Root keys; several per file. |
| `.target.object` | `String` | Yes | — | |
| `.target.schema` | `String` | No | container schema | |
| `.target.logical_schema` | `String` | No | — | Excludes `schema`. `remote` is not supported. |
| `.target.revalidate` | `Boolean` | No | `true` | Only for container-local targets. |

```json
{ "com.sap.hana.example::CUSTOMERS_VIEW": { "target": { "schema": "APPLICATION_B", "object": "CUSTOMERS" } } }
```

Invalid: `"target": { "remote": "R", "object": "T" }` (projection views do not support `remote`).

---

## 7. `.hdbtabledata`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/010_pages_271_291.md (Pages 271–291)

### 7.1 Root and import keys

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `format_version` | `Integer` | Yes ¹ | — | `1`. |
| `imports` | `Array<Object>` | Yes | — | One entry per import. |
| `imports[].target_table` | `String` | Yes | — | Table in the container. |
| `imports[].source_data` | `Object` | Yes | — | §7.2. |
| `imports[].import_settings` | `Object` | No (Yes for the import-column scenario) | — | §7.4. |
| `imports[].column_mappings` | `Object` | No (Yes unless the CSV header matches the table) | — | §7.5. |
| `imports[].is_collection_table` | `Boolean` | No | `false` | Target is a JSON Document Store collection (`dialect` `HANA-JSON`, no header). |

¹ Present in every reference example; the reference does not say whether it may be omitted.

### 7.2 `source_data`

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `data_type` | `Enum` | Yes | — | `"CSV"`, `"PROPERTIES"` (`.properties` translation files). |
| `file_name` | `String` | Yes | — | Deployed source file (`"com.sap.hana.example.data::data.csv"`), deployed by `com.sap.hana.di.tabledata.source`. |
| `has_header` | `Boolean` | No | `false` | |
| `no_data_import` | `Boolean` | No | `false` | Key-reservation scenario: reserve keys without importing. |
| `delete_existing_foreign_data` | `Boolean` | No | `false` | Deletes existing rows matching the key specification at deploy time. |
| `dialect` | `String` | No | `HANA` | `HANA`, `HANA-JSON` (collections; the prose once spells it `HANA_JSON`, the example uses `HANA-JSON`). |
| `type_config` | `Object` | No | — | §7.3 (CSV only). |

### 7.3 `type_config` (CSV)

| Key | Type | Default | Notes |
| :--- | :--- | :--- | :--- |
| `line_terminator` | `String` | auto-detect (`\n`, `\r`, `\r\n`) | |
| `delimiter` | `String` | `,` | `,,` is `NULL`; `,"",` is an empty value. |
| `do_quote` | `Boolean` | `true` | |
| `quote_character` | `String` | `"` | |
| `do_escape` | `Boolean` | `false` | |
| `escape_character` | `String` | `\` | |
| `do_weak_escape` | `Boolean` | `true` | Only delimiter, quote and escape character are escaped. |
| `use_escape_sequences` | `Boolean` | `true` | `\n`, `\r`, `\t`. |

### 7.4 `import_settings`

| Key | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `import_columns` | `Array<String>` | Yes | Target columns relevant for the import. |
| `include_filter` | `Array<Object>` | No | OR of objects, AND inside an object (`[{ "LANG": "de", "FLAG": "X" }, { "LANG": "en", "FLAG": "X" }]`). |
| `exclude_filter` | `Array<Object>` | No | Same form; rows matching are excluded. |

### 7.5 `column_mappings`

`"<target column>": <mapping>`, where the mapping is one of:

| Mapping | Form | Meaning |
| :--- | :--- | :--- |
| Column number | `1` | CSV column 1. |
| Header name | `"csvCol"` | CSV column with this header (`has_header: true`). |
| Function | `{ "type": "function", "name": "<f>", "parameters": { ... } }` | `range` (`start_with`, `increment_by`), `decodeBase16` / `decodeBase64` (`column_name` or `column_number`; base64 also `char62`, `char63`), `getCurrentSchemaName`, `extractLanguageCodeFromFileName` (`file_name`). |
| Constant | `{ "type": "constant", "value": "<v>" }` | |

For `.properties` / `.tags` sources, a `multi_key_separator` splits compound keys.

### 7.6 Examples

```json
{
  "format_version": 1,
  "imports": [{
    "target_table": "com.sap.hana.example::TABLE",
    "source_data": { "data_type": "CSV", "file_name": "com.sap.hana.example.data::data.csv", "has_header": true, "type_config": { "delimiter": ";" } },
    "import_settings": { "import_columns": ["A", "B", "IMPORTED"] },
    "column_mappings": { "A": 1, "B": "csvB", "IMPORTED": { "type": "constant", "value": "Y" } }
  }]
}
```

Invalid: no `format_version`; `"data_type": "XLSX"`; `"import_settings": { "include_filter": [...] }` without `import_columns`; `{ "type": "function", "name": "uuid" }` (unknown function).

---

## 8. `.hdinamespace`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/007_5_Defining_the_Data_Model_in_XS_Advanced.md (Pages 237–239)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/007_5_Content_Development_in_SAP_HDI.md (Pages 161–264, §5.1.2 _Naming Conventions_)

Applies to its folder and every sub-folder until another `.hdinamespace` takes over.

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `name` | `String` | Yes | — | Name-space prefix (`"com.sap.hana.example"`). May be `""` (no prefix, no separator). No `/` or `:`; a `\` must be doubled. The full object name, with name space, is at most 127 characters. |
| `subfolder` | `Enum` | Yes ¹ | — | `"append"` (add the sub-folder name to the name space), `"ignore"`. |

¹ Present in every reference example; the reference does not say whether it may be omitted.

```json
{ "name": "com.sap.hana.example", "subfolder": "append" }
```

Invalid: `{ "name": "com/sap/example", "subfolder": "append" }` (`/`); `"subfolder": "prefix"`.

---

## 9. `.hdbeshconfig`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/008_pages_211_240.md (Pages 211–240)

The content part of a `SYS.ESH_CONFIG()` configuration, without the envelope. One search configuration per file, and one per view. References carry no schema prefix, so external objects need synonyms.

| Key | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `Fullname` | `String` | Yes | View name, optionally with name space (`"com.sap.search.example::awards"`). |
| `EntityType` | `Object` | Yes | Entity annotations (`@Search.searchable`, `@EnterpriseSearch.enabled`, ...) and `Properties`. |
| `EntityType.Properties` | `Array<Object>` | Yes | `{ "Name": "<column>", "@EnterpriseSearch.key"?, "@UI.identification"?, "@Search.defaultSearchElement"?, ... }`. |

The annotation vocabulary is that of `SYS.ESH_CONFIG()`, documented in the SAP HANA Search Developer Guide (not repeated here).

```json
{
  "Fullname": "awards",
  "EntityType": {
    "@Search.searchable": true,
    "@EnterpriseSearch.enabled": true,
    "Properties": [{ "@EnterpriseSearch.key": true, "Name": "id" }, { "@Search.defaultSearchElement": true, "Name": "title" }]
  }
}
```

Invalid: two configurations in one file; the `esh_config()` envelope around the content.

---

## 10. `.hdbmrjob`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(HDI)_Reference_for_SAP_HAN/008_pages_211_240.md (Pages 211–240)

Deprecated: use `.hdbvirtualpackagehadoop` (`hdbvirtualpackage.md`). The plug-in reads a binary file, either a Hadoop JAR packaged with a metadata header or a plain Hadoop JAR, and creates a virtual-function package with adapter type `HADOOP`. There is no JSON property schema.

**Known gap:** the extension registers `.hdbmrjob`, `.hdbhadoopmrjob` and `.hdbrmjob` as JSONC (`source.hdbmrjob`, JSON formatter, `HANA-SYN-010`), following `hdbvirtualpackage.md`. A real binary file would show syntax errors, and the JSON formatter must not touch it. Follow-up: #114.
