# Virtual Packages (`.hdbvirtualpackage*`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 287, 370)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(HDI)_Reference_for_SAP_HAN/008_pages_211_240.md (Pages 211–240: _Hadoop Map Reduce Jobs (.hdbmrjob or .jar)_)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(HDI)_Reference_for_SAP_HAN/010_pages_271_300.md (Pages 271–300: _Virtual Packages (.hdbvirtualpackage)_)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/006_4_Maintaining_the_XS_Advanced_Application_Development_&_Deployment_Descriptors.md (Pages 231, 238–239)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/015_13_HDI_Artifact_and_Build_Plug-in_Configuration.md (Pages 812, 822)
> Source: research/refs/extracted/hana-cloud_SAP_HANA_Cloud_Migration_Guide/003_pages_71_105.md (Pages 90–91)
> Source: @sap/hdi-deploy@5.7.0 (npm, outside the corpus, #122): `lib/zdm/zdmUtils.js` § suffix map; `lib/zdm/generator/file-artifacts/FileArtifactsFactory.js` § `ARTIFACT_FILE_SUFFIX_TO_CONSTRUCTOR`

The deprecated Hadoop MapReduce job (`.hdbmrjob`, `.hdbhadoopmrjob`, `[XSC]` `.hdbrmjob`) is a binary JAR and is specified in `hdi-target-configs.md` §10.

---

## Metadata

| Extension | Language ID | Scope | Build Plug-in | `.hdiconfig` key | Target Platforms |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `.hdbvirtualpackagehadoop` | `hdbvirtualpackagehadoop` | — | `com.sap.hana.di.virtualpackage.hadoop` | `"hdbvirtualpackagehadoop"` | `[XSA]` `[HDI]` |
| `.hdbvirtualpackagesparksql` | `hdbvirtualpackagesparksql` | — | `com.sap.hana.di.virtualpackage.sparksql` | `"hdbvirtualpackagesparksql"` | `[XSA]` `[HDI]` |

Both suffixes deploy into the `access` target schema in zero-downtime mode (`AccessContainerDuplicate` in the HDI Deployer).

---

## Structural Format

The Virtual Package plug-in turns the design-time file into a `virtual-package` database object with adapter type `"hadoop"` or `"sparksql"`. The run-time object keeps the file as the `CONTENT` `BLOB` of the `VIRTUAL_PACKAGES` system view. There is no JSON, key-value or DDL wrapper, and no property schema.

| Suffix | Documented content |
| :--- | :--- |
| `.hdbvirtualpackagehadoop` | A plain Hadoop JAR file (binary ZIP archive). |
| `.hdbvirtualpackagesparksql` | "Plain SparkSQL files" (_Virtual Packages_, Pages 271–300). **Conflict:** the caution in _Hadoop Map Reduce Jobs_ (Pages 211–240) calls both plug-ins' inputs "design-time Hadoop and SparkSQL JAR files". The corpus prints no example of either form. |

**Negative result (#122):** no source shows the content of a `.hdbvirtualpackagesparksql` file. Searched: `@sap/hdi-deploy@5.7.0` (suffix tables only, no content handling); the SAP HANA 2.0 SPS 07 _Hadoop Integration_ guide (Hadoop virtual functions and `PACKAGE` archives only); the SAP HANA Spark Controller 2.0 Installation Guide search results (remote sources and virtual tables only); GitHub code search for files with the suffixes `.hdbvirtualpackage`, `.hdbvirtualpackagehadoop` and `.hdbvirtualpackagesparksql` (no hits); web searches for `hdbvirtualpackagesparksql`, `virtualpackage.sparksql` and `CREATE VIRTUAL PACKAGE` with `SPARKSQL` (only `.hdiconfig` plug-in lists).

---

## Extension Support

- `.hdbvirtualpackagehadoop` and `.hdbvirtualpackagesparksql` are registered as their own languages for the file icon only. Neither language has a grammar, a language configuration or a formatter. Neither is in `JSON_ARTIFACT_LANGUAGES` or `ANALYZER_LANGUAGES`, so no diagnostics (including the JSON syntax checks `HANA-SYN-010` / `-011`) run on them.
- `.hdbvirtualpackagesparksql` gets no SQL grammar: the corpus is split between SparkSQL text and a JAR archive, and a SQL grammar on a JAR would be as wrong as the former JSON grammar. Revisit once a source shows the content.
- The repository has no sample of either suffix. A real Hadoop file is a JAR archive, and no real SparkSQL file has been found.
- The extension does not inspect the content to choose a mode. VS Code asks before it opens a binary file in a text editor.

---

## Corpus Verification Notes

- `.hdbvirtualpackage` is **not a file suffix**. It names the artifact family in section titles (_Virtual Packages (.hdbvirtualpackage)_) and in the artifact-type overview tables, where the description points to `.hdbvirtualpackagehadoop` and `.hdbvirtualpackagesparksql`. No plug-in and no `.hdiconfig` key maps it. **Conflict:** the zero-downtime target-schema table of the XS Advanced Developer Guide (Pages 238–239) lists `.hdbvirtualpackage` next to the two real suffixes, but the HDI Deployer's implementation of that table (`lib/zdm/zdmUtils.js`) knows only `hdbvirtualpackagehadoop` and `hdbvirtualpackagesparksql`. The shipped tool wins (`SPEC_RULES.md` §1 rule 8): the bare suffix is not registered (`artifact-registry.md` §3).
- `.hdbmrjob` (`com.sap.hana.di.virtualfunctionpackage.hadoop`, `.hdiconfig` keys `"hdbhadoopmrjob"` / `"jar"`) is **deprecated** and superseded by `.hdbvirtualpackage*`. It is listed among the unsupported artifact types in the SAP HANA Cloud Migration Guide.
- Up to #122 the extension mapped all three suffixes to an invented JSONC grammar `source.hdbvirtualpackage` (keys `plugin_name`, `adapter_type`, `location`, `remote_source`, `schema`, `package`, `name`, `file`, `jar`, `class_name`), the JSON formatter and the JSON syntax checks, with invented JSON samples under `samples/hdi/`. None of those keys is documented.
