# Document Store Collection Indexes (`.hdbcollectionindex`, `.hdbcollectionadjindex`)

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/007_pages_211_245.md (Pages 222–225)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_JSON_Document_Store_Guide/030_CREATE_HASH_INDEX_Statement.md (Pages 33–33)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_JSON_Document_Store_Guide/031_CREATE_BLOCK_RANGE_INDEX_Statement.md (Pages 34–35)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_JSON_Document_Store_Guide/032_CREATE_ADJACENCY_INDEX_Statement.md (Pages 36–36)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Property_Graph_Engine_Refe/001_pages_1_35.md (Pages 12–14)

---

## Metadata

| Attribute | Value |
| :--- | :--- |
| **File Extensions** | `.hdbcollectionindex`, `.hdbcollectionadjindex` |
| **VS Code Language ID** | `hdbcollectionindex`, `hdbcollectionadjindex` |
| **TextMate `scopeName`** | `source.hanasql` |
| **Build Plug-ins** | `com.sap.hana.di.collection.index`, `com.sap.hana.di.collection.adjacency_index` |
| **Target Platforms** | `[CLOUD]` (SAP HDI Cloud feature version 1006+) |

---

## Structural Format (Headerless DDL)

- Both artifacts use **headerless SQL DDL** equivalent to `CREATE HASH INDEX`, `CREATE BLOCK RANGE INDEX`, or `CREATE ADJACENCY INDEX` without the leading `CREATE` keyword.

```ebnf
collection_index_artifact ::=
    ( "HASH" | "BLOCK" "RANGE" ) "INDEX" index_name
    "ON" collection_name "(" path_expression ")" ;

collection_adj_index_artifact ::=
    "ADJACENCY" "INDEX" index_name
    "ON" collection_name
    "(" "ID" adj_field "," "SOURCE" adj_field "," "TARGET" adj_field "," "TYPE" adj_field ")" ;

index_name      ::= [ schema_name "." ] identifier ;
collection_name ::= identifier ;
path_expression ::= [ "$" "." ] identifier { "." identifier } ;
adj_field       ::= [ "$" "." ] identifier { "." identifier } ;
```

---

## Rules & Constraints

- **Platform Availability `[CLOUD]`:** Both `com.sap.hana.di.collection.index` and `com.sap.hana.di.collection.adjacency_index` require SAP HANA Cloud with SAP HDI feature version `1006` or later.
- **Document Root Specifier:** `$` prefix (`$."name"`) is optional for `NVARCHAR`-returning collections and mandatory for `JSON`-returning collections in `CREATE HASH INDEX`.
- **No Schema Prefix on Container Objects:** Within HDI design-time artifacts, references to the target collection omit schema prefixes when targeting collections in the same HDI container.
- **Formatter Root Handling:** `HASH`, `BLOCK`, and `ADJACENCY` are root HDI headers (`hdiRoot`); the formatter must preserve headerless form without appending a trailing semicolon when `trailingSemicolon` is `'add'`.

---

## Valid Examples

### `.hdbcollectionindex`

```sql
HASH INDEX "myIndex" ON "myCollection"($."lastName")
```

### `.hdbcollectionadjindex`

```sql
ADJACENCY INDEX "myCollectionAdjacencyIndex" ON "myCollection" (
    ID "id",
    SOURCE "source",
    TARGET "target",
    TYPE "type"
)
```

---

## Invalid Example

```sql
-- Invalid in HDI artifact: leading CREATE keyword is prohibited in design-time HDI DDL
CREATE ADJACENCY INDEX "myCollectionAdjacencyIndex" ON "myCollection" (ID "id", SOURCE "source", TARGET "target", TYPE "type");
```
