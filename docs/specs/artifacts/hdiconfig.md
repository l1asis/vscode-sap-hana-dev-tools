# `.hdiconfig` HDI Container Configuration Specification

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 355–357, 370)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/007_pages_211_245.md (Pages 222–228)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/010_pages_271_291.md (Pages 271–291)
> Source: research/refs/extracted/hana-cloud_SAP_HANA_Cloud_Migration_Guide/003_pages_71_105.md (Pages 90–92)

---

## Metadata

| Attribute | Value |
| :--- | :--- |
| **File Extension / Name** | `.hdiconfig` |
| **TextMate `scopeName`** | `source.hdiconfig` |
| **Grammar File** | `syntaxes/hdiconfig.tmLanguage.json` |
| **Target Platforms** | `[XSA]` `[HDI]` `[CLOUD]` |

---

## Structural Format

- **JSON / JSONC object** containing container-wide HDI build plug-in mappings (`file_suffixes`) keyed by design-time file suffix (without leading `.`).

```ebnf
hdiconfig       ::= "{" [ ConfigProps ] "}" ;
ConfigProps     ::= ConfigProp { "," ConfigProp } ;
ConfigProp      ::= ( '"plugin_version"' ":" StringLiteral )
                  | ( '"minimum_feature_version"' ":" StringLiteral )
                  | ( '"file_suffixes"' ":" "{" [ SuffixEntries ] "}" ) ;
SuffixEntries   ::= SuffixEntry { "," SuffixEntry } ;
SuffixEntry     ::= StringLiteral ":" "{"
                      '"plugin_name"' ":" StringLiteral
                      { "," ( '"plugin_version"' ":" StringLiteral ) }
                    "}" ;
```

---

## Property & Suffix Key Schema

### Container Properties (`support.type.property-name.json.hdiconfig`)

| Key | Type | Platform | Description |
| :--- | :--- | :--- | :--- |
| `plugin_version` | `string` | `[XSA]` `[HDI]` `[CLOUD]` | Global HDI plug-in version for the container (e.g. `"2.0.30.0"`, `"4.0.0.0"`). |
| `minimum_feature_version` | `string` | `[CLOUD]` | Minimum SAP HDI feature version required for build plug-ins. |
| `file_suffixes` | `object` | `[XSA]` `[HDI]` `[CLOUD]` | Map of file extension suffix (without `.`) to `{ "plugin_name": ... }`. |
| `plugin_name` | `string` | `[XSA]` `[HDI]` `[CLOUD]` | Fully-qualified HDI build plug-in identifier (e.g. `"com.sap.hana.di.table"`). |

### Non-`hdb*` Suffix Keys in `file_suffixes` (`entity.name.type.hdiconfig`)

> Note: Generic extensions `.properties`, `.csv`, `.txt`, `.jar`, `.hdbtabledataprops`, and `.hdbtabledatatags` are **not** registered as global VS Code file associations to avoid hijacking standard non-HANA files; inside `.hdiconfig`, `"properties"` and `"tags"` (along with `"csv"`, `"txt"`, `"jar"`, and `"hdb[a-z]+"`) are highlighted as valid HDI plug-in suffix keys (`entity.name.type.hdiconfig`).

| Suffix Key | Build Plug-in (`plugin_name`) | Platform | Notes |
| :--- | :--- | :--- | :--- |
| `"properties"` | `com.sap.hana.di.tabledata.properties` | `[XSA]` `[HDI]` `[CLOUD]` | Key-value language/translatable properties companion to `.hdbtabledata` |
| `"tags"` | `com.sap.hana.di.tabledata.properties` | `[XSA]` `[HDI]` `[CLOUD]` | Tag-style metadata companion to `.hdbtabledata` |
| `"csv"` | `com.sap.hana.di.tabledata.source` | `[XSA]` `[HDI]` `[CLOUD]` | CSV source payload imported by `.hdbtabledata` |
| `"txt"` | `com.sap.hana.di.copyonly` | `[XSA]` `[HDI]` `[CLOUD]` | Arbitrary design-time resource, deployed as a plain file without a database object (C1 in `artifact-registry.md`) |
| `"jar"` | `com.sap.hana.di.virtualfunctionpackage.hadoop` | `[XSA]` | Deprecated Hadoop JAR plug-in suffix |
| `"hdbcollectionindex"` | `com.sap.hana.di.collection.index` | `[CLOUD]` | Document Store collection hash index (HDI Cloud 1006+) |
| `"hdbcollectionadjindex"` | `com.sap.hana.di.collection.adjacency_index` | `[CLOUD]` | Document Store collection adjacency index (HDI Cloud 1006+) |
| `"hdbfabricvirtualtable"` | `com.sap.hana.di.sharedreplica` | `[CLOUD]` | Fabric virtual table shared replica (`plugin_version`: `"4.0.0.0"`) |
| `"hdbvirtualpackagehadoop"` | `com.sap.hana.di.virtualpackage.hadoop` | `[XSA]` | Virtual package Hadoop JAR resource |
| `"hdbvirtualpackagesparksql"` | `com.sap.hana.di.virtualpackage.sparksql` | `[XSA]` | Virtual package SparkSQL resource |
| `"hdbmrjob"` | `com.sap.hana.di.virtualfunctionpackage.hadoop` | `[XSA]` | Deprecated Hadoop MapReduce job (also `"hdbhadoopmrjob"`) |
| `"hdbmigrationtable"` | `com.sap.hana.di.table.migration` | `[XSA]` `[HDI]` `[CLOUD]` | Migration table (`.hdbmigrationtable`). Not `com.sap.hana.di.migrationtable`. |

The complete suffix → plug-in list, including every `hdb*` suffix, is `docs/specs/artifacts/artifact-registry.md` §2 and §3. `.hdiconfig` completion offers exactly the plug-ins listed there (`HDI_PLUGIN_VALUES`).

---

## Valid Example

```jsonc
{
  "plugin_version": "4.0.0.0",
  "file_suffixes": {
    "hdbcollection": { "plugin_name": "com.sap.hana.di.collection" },
    "hdbcollectionindex": { "plugin_name": "com.sap.hana.di.collection.index" },
    "hdbcollectionadjindex": { "plugin_name": "com.sap.hana.di.collection.adjacency_index" },
    "hdbfabricvirtualtable": {
      "plugin_name": "com.sap.hana.di.sharedreplica",
      "plugin_version": "4.0.0.0"
    },
    "properties": { "plugin_name": "com.sap.hana.di.tabledata.properties" },
    "tags": { "plugin_name": "com.sap.hana.di.tabledata.properties" }
  }
}
```
