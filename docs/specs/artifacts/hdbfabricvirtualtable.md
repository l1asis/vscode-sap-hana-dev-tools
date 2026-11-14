# Fabric Virtual Tables (`.hdbfabricvirtualtable`, `.hdbfabricvirtualtableconfig`)

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/007_pages_211_245.md (Pages 226–228)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/020_pages_571_600.md (Pages 580–585)
> Note: `.hdbfabricvirtualtableconfig` has 0 occurrences in `research/refs/extracted/`; its JSON config schema below follows the verified `.hdbvirtualtableconfig` / `TARGET_KEYS` HDI configuration pattern (`syntax: inferred`).

---

## Metadata

| Extension | Language ID | Scope | Build Plug-in | Target Platforms |
| :--- | :--- | :--- | :--- | :--- |
| `.hdbfabricvirtualtable` | `hdbfabricvirtualtable` | `source.hanasql` | `com.sap.hana.di.sharedreplica` (`plugin_version`: `"4.0.0.0"`) | `[CLOUD]` |
| `.hdbfabricvirtualtableconfig` | `hdbfabricvirtualtableconfig` | `source.hdbfabricvirtualtableconfig` | *(companion JSON config, inferred)* | `[CLOUD]` |

---

## 1. `.hdbfabricvirtualtable` Headerless DDL `[CLOUD]`

Adds a system-owned shared replica to an existing virtual table inside the HDI container (or exposed via `.hdbsynonym`).

```ebnf
fabric_virtual_table_artifact ::=
    "SHARED" [ "SNAPSHOT" ] "REPLICA"
    [ ( "PAGE" | "COLUMN" ) "LOADABLE" ]
    "ON" virtual_table_name ;
```

### Syntax Elements

| Clause / Token | Description |
| :--- | :--- |
| `SHARED [SNAPSHOT] REPLICA` | Creates a shared real-time CDC replica or point-in-time `SNAPSHOT` replica pointing to the target virtual table. |
| `PAGE LOADABLE` | In-buffer cache (NSE) page-loadable storage (default for replica tables). |
| `COLUMN LOADABLE` | Full in-memory column load unit for replica tables. |
| `ON <virtual_table_name>` | Target virtual table name (must exist in container or synonym). |

### Valid Example (`.hdbfabricvirtualtable`)

```sql
SHARED SNAPSHOT REPLICA COLUMN LOADABLE ON "MY_VIRTUAL_TABLE"
```

### Invalid Example

```sql
-- Invalid in HDI artifact: design-time .hdbfabricvirtualtable uses headerless syntax (no ALTER VIRTUAL TABLE)
ALTER VIRTUAL TABLE "MY_VIRTUAL_TABLE" ADD SHARED REPLICA;
```

---

## 2. `.hdbfabricvirtualtableconfig` HDI JSON `[CLOUD]` *(Inferred Companion Schema)*

Follows the standard HDI `*config` tolerant JSON (`jsonc`) structure (matching `.hdbvirtualtableconfig`):

```jsonc
{
  "MY_FABRIC_VT": {
    "target": {
      "remote": "MY_REMOTE_SOURCE",
      "database": "REMOTE_DB",
      "schema": "REMOTE_SCHEMA",
      "object": "REMOTE_TABLE"
    }
  }
}
```
