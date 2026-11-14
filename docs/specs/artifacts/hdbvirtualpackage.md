# Virtual Packages & Hadoop MapReduce Jobs (`.hdbvirtualpackage*`, `.hdbmrjob`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 287, 370)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/006_4_Maintaining_the_XS_Advanced_Application_Development_&_Deployment_Descriptors.md (Pages 231, 238–239)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/015_13_HDI_Artifact_and_Build_Plug-in_Configuration.md (Pages 812, 822)
> Source: research/refs/extracted/hana-cloud_SAP_HANA_Cloud_Migration_Guide/003_pages_71_105.md (Pages 90–91)

---

## Metadata

| Extension | Language ID | Scope | Build Plug-in | Target Platforms |
| :--- | :--- | :--- | :--- | :--- |
| `.hdbvirtualpackage` | `hdbvirtualpackage` | `source.hdbvirtualpackage` | Virtual Package family (`access` target schema) | `[XSA]` `[HDI]` |
| `.hdbvirtualpackagehadoop` | `hdbvirtualpackage` | `source.hdbvirtualpackage` | `com.sap.hana.di.virtualpackage.hadoop` | `[XSA]` `[HDI]` |
| `.hdbvirtualpackagesparksql` | `hdbvirtualpackage` | `source.hdbvirtualpackage` | `com.sap.hana.di.virtualpackage.sparksql` | `[XSA]` `[HDI]` |
| `.hdbmrjob` | `hdbmrjob` | `source.hdbmrjob` | `com.sap.hana.di.virtualfunctionpackage.hadoop` *(deprecated)* | `[XSA]` `[HDI]` |

---

## Corpus Verification Notes

- In SAP HDI Reference §6.48, `com.sap.hana.di.virtualpackage.hadoop` and `com.sap.hana.di.virtualpackage.sparksql` document transforming Hadoop JAR resources (`.hdbvirtualpackagehadoop`) or SparkSQL resources (`.hdbvirtualpackagesparksql`) into `virtual-package` database objects (adapter types `"hadoop"` and `"sparksql"`).
- In SAP HDI Reference §6.14, `.hdbmrjob` (`com.sap.hana.di.virtualfunctionpackage.hadoop`, `.hdiconfig` keys `"hdbhadoopmrjob"` / `"hdbmrjob"` / `"jar"`) is **deprecated** and superseded by `.hdbvirtualpackage*`; the guide notes binary JAR + metadata header or plain Hadoop JAR payloads, and **is listed under unsupported artifact types in SAP HANA Cloud Migration Guide**.
- **Corpus Schema Gap:** Neither the HDI Reference nor the XSA Developer Guide contains a JSON key/property listing for `.hdbvirtualpackage*` or `.hdbmrjob`. Because HDI metadata descriptors commonly use JSONC (`//` and `/* */` comments), this extension maps these extensions to tolerant JSONC grammars (`source.hdbvirtualpackage`, `source.hdbmrjob`) recognizing JSON primitives and common metadata keys (`plugin_name`, `adapter_type`, `location`, `remote_source`, `schema`, `package`, `name`, `file`, `jar`, `class_name`, `parameters`).

---

## Example (`.hdbvirtualpackage` JSONC Descriptor)

```jsonc
{
  "name": "hadoop_analytics_pkg",
  "adapter_type": "hadoop",
  "location": "hdfs://namenode:8020/user/hana/lib/analytics.jar"
}
```
