# Virtual Packages (`.hdbvirtualpackage*`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 287, 370)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(HDI)_Reference_for_SAP_HAN/010_pages_271_300.md (Pages 271–300: _Virtual Packages (.hdbvirtualpackage)_)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/006_4_Maintaining_the_XS_Advanced_Application_Development_&_Deployment_Descriptors.md (Pages 231, 238–239)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/015_13_HDI_Artifact_and_Build_Plug-in_Configuration.md (Pages 812, 822)
> Source: research/refs/extracted/hana-cloud_SAP_HANA_Cloud_Migration_Guide/003_pages_71_105.md (Pages 90–91)

The deprecated Hadoop MapReduce job (`.hdbmrjob`, `.hdbhadoopmrjob`, `[XSC]` `.hdbrmjob`) is a binary JAR and is specified in `hdi-target-configs.md` §10.

---

## Metadata

| Extension | Language ID | Scope | Build Plug-in | Target Platforms |
| :--- | :--- | :--- | :--- | :--- |
| `.hdbvirtualpackage` | `hdbvirtualpackage` | `source.hdbvirtualpackage` | Virtual Package family (`access` target schema) | `[XSA]` `[HDI]` |
| `.hdbvirtualpackagehadoop` | `hdbvirtualpackagehadoop` | `source.hdbvirtualpackage` | `com.sap.hana.di.virtualpackage.hadoop` | `[XSA]` `[HDI]` |
| `.hdbvirtualpackagesparksql` | `hdbvirtualpackagesparksql` | `source.hdbvirtualpackage` | `com.sap.hana.di.virtualpackage.sparksql` | `[XSA]` `[HDI]` |

---

## Corpus Verification Notes

- The Virtual Package plug-in turns a design-time Hadoop MapReduce job or SparkSQL resource into a `virtual-package` database object with adapter type `"hadoop"` or `"sparksql"`. It supports two formats: plain Hadoop JAR files (plug-in `hdbvirtualpackagehadoop`) and plain SparkSQL files (plug-in `hdbvirtualpackagesparksql`).
- `.hdbmrjob` (`com.sap.hana.di.virtualfunctionpackage.hadoop`, `.hdiconfig` keys `"hdbhadoopmrjob"` / `"jar"`) is **deprecated** and superseded by `.hdbvirtualpackage*`. It is listed among the unsupported artifact types in the SAP HANA Cloud Migration Guide.
- **Known gap (#122):** neither format is JSON, but the extension maps all three suffixes to the tolerant JSONC grammar `source.hdbvirtualpackage` (keys `plugin_name`, `adapter_type`, `location`, `remote_source`, `schema`, `package`, `name`, `file`, `jar`, `class_name`), the JSON formatter and the JSON syntax checks. A real `.hdbvirtualpackagehadoop` is binary and a real `.hdbvirtualpackagesparksql` is SparkSQL text. The samples under `samples/hdi/` are invented JSON.
