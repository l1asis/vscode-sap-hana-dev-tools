# SAP HANA Artifact Suffix Registry (`artifact-registry.md`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/052_Migrated_XS_Database_Objects.md (Pages 65–67)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/053_hdbtable.md (Page 68)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Developer_Guide_for_Cloud_/009_pages_241_270.md (Pages 241–270)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md (Pages 144–146)

The registry has one row per file suffix or file name the extension recognizes, plus the HANA suffixes it deliberately leaves alone. `test/artifact-registry.test.ts` parses the tables of §2 and §3. It fails when any of these disagree with them:

- `package.json`
- `src/formatter/dispatch.ts`
- `src/analyzer/dispatch.ts`
- `src/analyzer/suffix-migration.ts`
- the `.hdiconfig` plug-in catalogue (`HDI_PLUGIN_VALUES` in `src/sql/artifact-intellisense.ts`)

A suffix can therefore not be added or dropped silently: change this file in the same commit.

---

## 1. Sources and Column Vocabulary

| Key | Source |
| :--- | :--- |
| S1 | `SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md` §4.8.1 _Design-Time Application Artifacts_ (Pages 144–146) |
| S2 | `SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/009_7_Developing_Procedures.md` §7.4 _Create Procedure Templates_ (Pages 410–413) |
| S3 | `SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/016_14_Migrating_XS_Classic_Applications_to_XS_Advanced.md` (Pages 766–774) |
| M1 | `SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/052_Migrated_XS_Database_Objects.md` and `053_hdbtable.md`: _Migrated Database & HDI-Related Design-Time Object Types_ (Pages 65–68) |
| M2 | `SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/068_Deprecated_Object_Types_in_XS_Advanced.md` (Page 84) |
| M3 | `SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/036_Programming_Models.md` (Page 44) |
| H1 | `SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(HDI)_Reference_for_SAP_HAN/008_pages_211_240.md` – `010_pages_271_300.md` (Pages 211–300) |
| H2 | `hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/008_pages_211_240.md` – `010_pages_271_291.md` (Pages 211–291) |
| H3 | `SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/007_5_Content_Development_in_SAP_HDI.md` (Pages 161–264) |
| C1 | `hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Developer_Guide_for_Cloud_/009_pages_241_270.md` _Mappings Default File-Suffix to HDI Build Plug-ins_ (Pages 241–270) |
| CM | `hana-cloud_SAP_HANA_Cloud_Migration_Guide/004_pages_91_120.md` (Pages 91–120) |
| X1 | `SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/007_5_Defining_the_Data_Model_in_XS_Advanced.md` §5.2.1 _HDI Deployer_ (Pages 251–275) |
| G-SQL, G-XSODATA | `docs/specs/grammars/sql-sqlscript.md`, `docs/specs/grammars/xsodata.md` |
| A-HDICONFIG, A-FABRIC, A-VPKG, A-LEGACY, A-VIEWS | `docs/specs/artifacts/hdiconfig.md`, `hdbfabricvirtualtable.md`, `hdbvirtualpackage.md`, `xsc-legacy-artifacts.md`, `xsc-modeled-views.md` |

| Column | Values |
| :--- | :--- |
| **Platform** | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` (`SPEC_RULES.md` §1.3) |
| **Status** | `current`; `alias of <suffix>` (still accepted, same content); `renamed → <suffix>` (`HANA-MIG-013` offers a file-rename QuickFix); `replaced → <suffix>` (the content must change); `unsupported` (no HDI equivalent); `deprecated` (still works, not migrated) |
| **HDI plug-in** | `com.sap.hana.di.*` id; `Repository` (XS Classic activation); `HDI Deployer` (read by `@sap/hdi-deploy`, no build plug-in); `—` (no plug-in in the corpus) |
| **Grammar** | TextMate `scopeName` of `package.json` `contributes.grammars`, or `built-in` (a VS Code language this extension only adds file names to) |
| **Formatter** | `sql`, `kv`, `kv / sql` (content-sniffed), `cds`, `role / json`, `xsodata`, `migration table`, `json`, `xsjs` (delegated), `—` (`src/formatter/dispatch.ts`) |
| **Analyzer** | Checks that run (`src/analyzer/dispatch.ts`): `syntax`, `security`, `performance`, `calcview`, `xsjs`, `migration only` (`HANA-MIG-013` only), `—` (not in `ANALYZER_LANGUAGES`) |
| **Migrator** | `HANA-MIG-*` rules that can fire (`docs/specs/diagnostics/migration-xsc-to-hdi.md`), `—` |
| **IntelliSense** | `sql` (SQL completion, hover, signature help), `artifact` (JSON / KV key completion and hover), `xsjs`, `schema` (JSON schema via `contributes.jsonValidation`), `—` |

---

## 2. Registered Suffixes and File Names

| Suffix | Language ID | Platform | Status | HDI plug-in | Grammar | Formatter | Analyzer | Migrator | IntelliSense | Source |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `.sql` | `hanasql` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | — | `source.hanasql` | sql | syntax, security, performance | `HANA-MIG-010`, `HANA-MIG-011` | sql | G-SQL |
| `.hdbprocedure` | `hdbprocedure` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.procedure` | `source.hanasql` | sql | syntax, security, performance | `HANA-MIG-010`, `HANA-MIG-011` | sql | S1, C1 |
| `.hdbfunction` | `hdbfunction` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.function` | `source.hanasql` | sql | syntax, security, performance | `HANA-MIG-010`, `HANA-MIG-011` | sql | C1 |
| `.hdbtablefunction` | `hdbtablefunction` | `[XSC]` | renamed → .hdbfunction | Repository | `source.hanasql` | sql | syntax, security, performance | `HANA-MIG-013`, `HANA-MIG-010`, `HANA-MIG-011` | sql | S1, M1 |
| `.hdbscalarfunction` | `hdbscalarfunction` | `[XSC]` | renamed → .hdbfunction | Repository | `source.hanasql` | sql | syntax, security, performance | `HANA-MIG-013`, `HANA-MIG-010`, `HANA-MIG-011` | sql | S1, M1 |
| `.hdbtrigger` | `hdbtrigger` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.trigger` | `source.hanasql` | sql | syntax, security, performance | `HANA-MIG-011` | sql | C1 |
| `.hdbindex` | `hdbindex` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.index` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbfulltextindex` | `hdbfulltextindex` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.fulltextindex` | `source.hanasql` | sql | syntax | — | sql | H1 |
| `.hdbconstraint` | `hdbconstraint` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.constraint` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbvirtualtable` | `hdbvirtualtable` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.virtualtable` | `source.hanasql` | sql | syntax | — | sql | H2 |
| `.hdbtabletype` | `hdbtabletype` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.tabletype` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbprojectionview` | `hdbprojectionview` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.projectionview` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbstructuredprivilege` | `hdbstructuredprivilege` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.structuredprivilege` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbstructuredfilter` | `hdbstructuredfilter` | `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.structuredfilter` | `source.hanasql` | sql | syntax | — | sql | H2, G-SQL |
| `.hdbresultcache` | `hdbresultcache` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.resultcache` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbstatistics` | `hdbstatistics` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.statistics` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbsystemversioning` | `hdbsystemversioning` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.systemversioning` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbschedulerjob` | `hdbschedulerjob` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.schedulerjob` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbremotetablereplica` | `hdbremotetablereplica` | `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.remotetablereplica` | `source.hanasql` | sql | syntax | — | sql | H2, G-SQL |
| `.hdbcollection` | `hdbcollection` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.collection` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbcollectionindex` | `hdbcollectionindex` | `[CLOUD]` | current | `com.sap.hana.di.collection.index` | `source.hanasql` | sql | syntax | — | sql | C1, A-HDICONFIG |
| `.hdbcollectionadjindex` | `hdbcollectionadjindex` | `[CLOUD]` | current | `com.sap.hana.di.collection.adjacency_index` | `source.hanasql` | sql | syntax | — | sql | H2, A-HDICONFIG |
| `.hdbfabricvirtualtable` | `hdbfabricvirtualtable` | `[CLOUD]` | current | `com.sap.hana.di.sharedreplica` | `source.hanasql` | sql | syntax | — | sql | A-FABRIC |
| `.hdblibrary` | `hdblibrary` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.library` | `source.hanasql` | sql | syntax, security, performance | `HANA-MIG-011` | sql | C1 |
| `.hdbdropcreatetable` | `hdbdropcreatetable` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.dropcreatetable` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbapplicationtime` | `hdbapplicationtime` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.applicationtime` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbgraphworkspace` | `hdbgraphworkspace` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.graphworkspace` | `source.hanasql` | sql | syntax | — | sql | C1 |
| `.hdbvirtualprocedure` | `hdbvirtualprocedure` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.virtualprocedure` | `source.hanasql` | sql | syntax | — | sql | H1 |
| `.hdbvirtualfunction` | `hdbvirtualfunction` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.virtualfunction` | `source.hanasql` | sql | syntax | — | sql | H1, M1 |
| `.proceduretemplate` | `proceduretemplate` | `[XSC]` | current | Repository | `source.proceduretemplate` | — | — | — | — | S1, S2 |
| `.hdbtable` | `hdbtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.table` | `source.hdbtable` | kv / sql | syntax | `HANA-MIG-001` | sql | S1, C1, M1 |
| `.hdbstructure` | `hdbstructure` | `[XSC]` | replaced → .hdbtabletype | Repository | `source.hdbstructure` | kv / sql | syntax | `HANA-MIG-006` | sql | S1, M1 |
| `.hdbview` | `hdbview` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.view` | `source.hdbview` | kv / sql | syntax, security, performance | `HANA-MIG-002`, `HANA-MIG-011` | sql | S1, C1, M1 |
| `.hdbsequence` | `hdbsequence` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.sequence` | `source.hdbsequence` | kv / sql | syntax | `HANA-MIG-003` | sql | S1, C1, M1 |
| `.hdbschema` | `hdbschema` | `[XSC]` | unsupported | Repository | `source.hdbschema` | kv | syntax | `HANA-MIG-012` | artifact | S1, M1 |
| `.hdbti` | `hdbti` | `[XSC]` | replaced → .hdbtabledata | Repository | `source.hdbti` | kv | syntax | `HANA-MIG-012` | artifact | S1, M1 |
| `.hdbtid` | `hdbtid` | `[XSC]` | replaced → .hdbtabledata | Repository | `source.hdbtid` | kv | syntax | `HANA-MIG-013` | — | M1 |
| `.hdbtim` | `hdbtim` | `[XSC]` | replaced → .hdbtabledata | Repository | `source.hdbtim` | kv | syntax | `HANA-MIG-013` | — | M1 |
| `.xshttpdest` | `xshttpdest` | `[XSC]` | current | Repository | `source.xshttpdest` | kv | syntax | — | artifact | S1 |
| `.hdbdd` | `hdbdd` | `[XSC]` | replaced → .hdbcds | Repository | `source.hdbdd` | cds | syntax | `HANA-MIG-005` | — | S1, M1 |
| `.hdbcds` | `hdbcds` | `[XSA]` `[HDI]` | current | `com.sap.hana.di.cds` | `source.hdbcds` | cds | syntax | `HANA-MIG-005` | — | H1 |
| `.hdbrole` | `hdbrole` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.role` | `source.hdbrole` | role / json | syntax, security | `HANA-MIG-004` | artifact | S1, C1 |
| `.hdbroleconfig` | `hdbroleconfig` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.role.config` | `source.hdbroleconfig` | json | syntax | — | — | H1, C1 |
| `.hdbsynonym` | `hdbsynonym` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.synonym` | `source.hdbsynonym` | json | syntax | — | — | S1, C1, M1 |
| `.hdbsynonymconfig` | `hdbsynonymconfig` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.synonym.config` | `source.hdbsynonymconfig` | json | syntax | — | — | C1 |
| `.hdbsynonymtemplate` | `hdbsynonymconfig` | `[XSA]` `[HDI]` | alias of .hdbsynonymconfig | HDI Deployer | `source.hdbsynonymconfig` | json | syntax | — | — | X1 |
| `.hdbpublicsynonym` | `hdbpublicsynonym` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.publicsynonym` | `source.hdbpublicsynonym` | json | syntax | — | — | C1 |
| `.hdbsysbicsynonym` | `hdbsysbicsynonym` | `[XSA]` `[HDI]` | current | `com.sap.hana.di.sysbicsynonym` | `source.hdbsysbicsynonym` | — | — | — | — | H1 |
| `.hdbgrants` | `hdbgrants` | `[XSA]` `[HDI]` `[CLOUD]` | current | HDI Deployer | `source.hdbgrants` | json | syntax, security | — | artifact | X1 |
| `.hdbsynonymgrantor` | `hdbgrants` | `[XSA]` `[HDI]` | renamed → .hdbgrants | HDI Deployer | `source.hdbgrants` | json | syntax, security | `HANA-MIG-013` | artifact | X1 |
| `.hdbrevokes` | `hdbrevokes` | `[XSA]` `[HDI]` `[CLOUD]` | current | HDI Deployer | `source.hdbrevokes` | json | syntax, security | — | artifact | X1 |
| `.hdbvirtualtableconfig` | `hdbvirtualtableconfig` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.virtualtable.config` | `source.hdbvirtualtableconfig` | json | syntax | — | — | H2 |
| `.hdbvirtualprocedureconfig` | `hdbvirtualprocedureconfig` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.virtualprocedure.config` | `source.hdbvirtualprocedureconfig` | — | — | — | — | H1 |
| `.hdbvirtualfunctionconfig` | `hdbvirtualfunctionconfig` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.virtualfunction.config` | `source.hdbvirtualfunctionconfig` | — | — | — | — | H1 |
| `.hdblogicalschema` | `hdblogicalschema` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.logicalschema` | `source.hdblogicalschema` | — | — | — | — | C1 |
| `.hdblogicalschemaconfig` | `hdblogicalschemaconfig` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.logicalschema.config` | `source.hdblogicalschemaconfig` | json | syntax | — | — | H1 |
| `.hdbprojectionviewconfig` | `hdbprojectionviewconfig` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.projectionview.config` | `source.hdbprojectionviewconfig` | json | syntax | — | — | C1 |
| `.hdbfabricvirtualtableconfig` | `hdbfabricvirtualtableconfig` | `[CLOUD]` | current | — | `source.hdbfabricvirtualtableconfig` | json | syntax | — | — | A-FABRIC |
| `.hdbtabledata` | `hdbtabledata` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.tabledata` | `source.hdbtabledata` | json | syntax | — | — | C1 |
| `.hdbeshconfig` | `hdbeshconfig` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.eshconfig` | `source.hdbeshconfig` | json | syntax | — | — | C1 |
| `.hdbafllangprocedure` | `hdbafllangprocedure` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.afllangprocedure` | `source.hdbafllangprocedure` | — | — | — | — | H1, M1 |
| `.hdbvirtualpackage` | `hdbvirtualpackage` | `[XSA]` `[HDI]` | current | — | `source.hdbvirtualpackage` | json | syntax | — | — | A-VPKG |
| `.hdbvirtualpackagehadoop` | `hdbvirtualpackagehadoop` | `[XSA]` `[HDI]` | current | `com.sap.hana.di.virtualpackage.hadoop` | `source.hdbvirtualpackage` | json | syntax | — | — | H1, A-VPKG |
| `.hdbvirtualpackagesparksql` | `hdbvirtualpackagesparksql` | `[XSA]` `[HDI]` | current | `com.sap.hana.di.virtualpackage.sparksql` | `source.hdbvirtualpackage` | json | syntax | — | — | H1, A-VPKG |
| `.hdbmrjob` | `hdbmrjob` | `[XSA]` `[HDI]` | deprecated | `com.sap.hana.di.virtualfunctionpackage.hadoop` | `source.hdbmrjob` | json | syntax | — | — | H1, A-VPKG |
| `.hdbhadoopmrjob` | `hdbmrjob` | `[XSA]` `[HDI]` | replaced → .hdbvirtualpackagehadoop | `com.sap.hana.di.virtualfunctionpackage.hadoop` | `source.hdbmrjob` | json | syntax | `HANA-MIG-013` | — | H1 |
| `.hdbrmjob` | `hdbmrjob` | `[XSC]` | alias of .hdbmrjob | Repository | `source.hdbmrjob` | json | syntax | — | — | M1 |
| `.hdiconfig` | `hdiconfig` | `[XSA]` `[HDI]` `[CLOUD]` | current | — | `source.hdiconfig` | json | syntax | — | artifact | A-HDICONFIG |
| `.hdinamespace` | `hdinamespace` | `[XSA]` `[HDI]` `[CLOUD]` | current | — | `source.hdinamespace` | json | syntax | — | — | H1 |
| `.xsaccess` | `xsaccess` | `[XSC]` | current | Repository | `source.xsaccess` | json | syntax, security | — | artifact | S1 |
| `.xsapp` | `xsapp` | `[XSC]` | current | Repository | `source.xsapp` | json | syntax | — | — | S1, M2 |
| `.xsjob` | `xsjob` | `[XSC]` | current | Repository | `source.xsjob` | json | syntax | — | — | S1 |
| `.xssqlcc` | `xssqlcc` | `[XSC]` | current | Repository | `source.xssqlcc` | json | syntax | — | — | S1 |
| `.xsprivileges` | `xsprivileges` | `[XSC]` | current | Repository | `source.xsprivileges` | json | syntax | — | — | S1 |
| `.xssecurestore` | `xssecurestore` | `[XSC]` | current | Repository | `source.xssecurestore` | json | syntax | — | — | S1 |
| `.xsoauthappconfig` | `xsoauthappconfig` | `[XSC]` | current | Repository | `source.xsoauthappconfig` | json | syntax | — | — | S1 |
| `.xsoauthclientconfig` | `xsoauthclientconfig` | `[XSC]` | current | Repository | `source.xsoauthclientconfig` | json | syntax | — | — | S1 |
| `.xsoauthclientflavor` | `xsoauthclientflavor` | `[XSC]` | current | Repository | `source.xsoauthclientflavor` | json | syntax | — | — | S1 |
| `.xsappsite` | `xsappsite` | `[XSC]` | current | Repository | `source.xsappsite` | json | syntax | — | — | S1, A-LEGACY |
| `.xsodata` | `xsodata` | `[XSC]` `[XSA]` | current | Repository | `source.xsodata` | xsodata | syntax, security | `HANA-MIG-011` | — | S1, G-XSODATA |
| `.xsjs` | `xsjs` | `[XSC]` `[XSA]` | current | Repository | `source.xsjs` | xsjs | xsjs | `HANA-MIG-011`, `HANA-MIG-020` | xsjs | S1 |
| `.xsjslib` | `xsjslib` | `[XSC]` `[XSA]` | current | Repository | `source.xsjs` | xsjs | xsjs | `HANA-MIG-011`, `HANA-MIG-020` | xsjs | S1 |
| `.xsxmla` | `xsxmla` | `[XSC]` | unsupported | Repository | `source.xsxmla` | — | — | — | — | M3, A-LEGACY |
| `.hdbtextrule` | `hdbtextrule` | `[XSC]` `[XSA]` `[HDI]` | current | `com.sap.hana.di.textrule` | `source.hdbtextrule` | — | — | — | — | H1, M1 |
| `.hdbtextinclude` | `hdbtextinclude` | `[XSC]` `[XSA]` `[HDI]` | current | `com.sap.hana.di.textrule.include` | `source.hdbtextinclude` | — | — | — | — | H1, M1 |
| `.hdbtextlexicon` | `hdbtextlexicon` | `[XSC]` `[XSA]` `[HDI]` | current | `com.sap.hana.di.textrule.lexicon` | `source.hdbtextlexicon` | — | — | — | — | H1, M1 |
| `.calculationview` | `calculationview` | `[XSC]` | renamed → .hdbcalculationview | Repository | `text.xml.hana` | — | calcview | `HANA-MIG-013` | — | S1, M1 |
| `.hdbcalculationview` | `hdbcalculationview` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.calculationview` | `text.xml.hana` | — | calcview | — | — | C1 |
| `.attributeview` | `attributeview` | `[XSC]` | replaced → .hdbcalculationview | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | S1, M1, A-VIEWS |
| `.analyticview` | `analyticview` | `[XSC]` | replaced → .hdbcalculationview | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | S1, M1, A-VIEWS |
| `.analyticprivilege` | `analyticprivilege` | `[XSC]` | replaced → .hdbanalyticprivilege | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | M1 |
| `.hdbanalyticprivilege` | `hdbanalyticprivilege` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.analyticprivilege` | `text.xml.hana` | — | — | — | — | C1 |
| `.hdbflowgraph` | `hdbflowgraph` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.flowgraph` | `text.xml.hana` | — | — | — | — | C1, M1 |
| `.hdbreptask` | `hdbreptask` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.reptask` | `text.xml.hana` | — | — | — | — | C1, M1 |
| `.hdbsearchruleset` | `hdbsearchruleset` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.searchruleset` | `text.xml.hana` | — | migration only | — | — | C1 |
| `.searchruleset` | `hdbsearchruleset` | `[XSC]` | renamed → .hdbsearchruleset | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | S1, M1 |
| `.hdbtextconfig` | `hdbtextconfig` | `[XSC]` `[XSA]` `[HDI]` | current | `com.sap.hana.di.textconfig` | `text.xml.hana` | — | — | — | — | H1, M1 |
| `.hdbtextdict` | `hdbtextdict` | `[XSC]` `[XSA]` `[HDI]` | current | `com.sap.hana.di.textdictionary` | `text.xml.hana` | — | — | — | — | H1, M1 |
| `.hdbtextminingconfig` | `hdbtextminingconfig` | `[XSA]` `[HDI]` | current | `com.sap.hana.di.textminingconfig` | `text.xml.hana` | — | migration only | — | — | H1 |
| `.textminingconfig` | `hdbtextminingconfig` | `[XSC]` | renamed → .hdbtextminingconfig | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | M1 |
| `.hdbdecisiontable` | `hdbdecisiontable` | `[XSC]` | unsupported | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | A-LEGACY |
| `.hdbruldec` | `hdbdecisiontable` | `[XSC]` | unsupported | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | M1 |
| `.decrule` | `hdbdecisiontable` | `[XSC]` | unsupported | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | S3 |
| `.xswidget` | `xswidget` | `[XSC]` | current | Repository | `text.xml.hana` | — | — | — | — | S1, A-LEGACY |
| `.procedure` | `xscprocedure` | `[XSC]` | replaced → .hdbprocedure | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | S1, S2, M1 |
| `.hdbflowgraphtemplate` | `xscxmlmodel` | `[XSC]` | unsupported | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | M1 |
| `.aflpmml` | `xscxmlmodel` | `[XSC]` | unsupported | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | S1, M1 |
| `.dqconfig` | `xscxmlmodel` | `[XSC]` | replaced → .hdbflowgraph | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | M1 |
| `.dataflow` | `xscxmlmodel` | `[XSC]` | unsupported | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | M1 |
| `.epmmodel` | `xscxmlmodel` | `[XSC]` | current | Repository | `text.xml.hana` | — | migration only | — | — | M1 |
| `.epmquerysource` | `xscxmlmodel` | `[XSC]` | current | Repository | `text.xml.hana` | — | migration only | — | — | M1 |
| `.halmscenario` | `xscxmlmodel` | `[XSC]` | unsupported | Repository | `text.xml.hana` | — | migration only | `HANA-MIG-013` | — | M1 |
| `.pvsscenario` | `xscxmlmodel` | `[XSC]` | current | Repository | `text.xml.hana` | — | migration only | — | — | M1 |
| `.hdbtextbundle` | `hdbtextbundle` | `[XSC]` | unsupported | Repository | `source.hdbtextbundle` | — | migration only | `HANA-MIG-013` | — | S1, M1 |
| `.hdbmigrationtable` | `hdbmigrationtable` | `[XSA]` `[HDI]` `[CLOUD]` | current | `com.sap.hana.di.table.migration` | `source.hdbmigrationtable` | migration table | syntax | — | — | C1 |
| `.hdiignore` | `ignore` | `[XSA]` `[HDI]` `[CLOUD]` | current | HDI Deployer | built-in | — | — | — | — | X1 |
| `undeploy.json` | `json` | `[XSA]` `[HDI]` `[CLOUD]` | current | HDI Deployer | built-in | — | — | — | schema | X1 |

**Notes:**

- C1 lists `com.sap.hana.di.roleconfig` for `.hdbroleconfig`, but every plug-in configuration example in H1 and C1 uses `com.sap.hana.di.role.config`. The registry and the `.hdiconfig` completion use `role.config`.
- `.hdbdecisiontable` is not in the corpus. The corpus names decision tables `*.hdbruldec` (M1, CM) and `*.decrule` (S3). The suffix stays registered for existing files and shares the language of the two documented suffixes.
- `.xsxmla` is confirmed by M3 ("DXC (Direct Extractor Connection) and xsxmla are not supported" in XS Advanced). Its syntax is not printed (`xsc-legacy-artifacts.md`).
- `.hdiignore` is added as a file name to VS Code's built-in `ignore` language instead of a new language, so Git tooling keeps working on it.
- `undeploy.json` keeps VS Code's `json` language and gets `resources/schemas/undeploy.schema.json` (§4.3).
- `.dataflow`, `.epmmodel`, `.epmquerysource`, `.halmscenario`, `.pvsscenario`, `.aflpmml`, `.dqconfig` and `.hdbflowgraphtemplate` share the `xscxmlmodel` language. Their formats are not printed in the corpus. They are model files of SAP HANA Studio editors and get XML highlighting only.

---

## 3. Known Suffixes That Are Not Registered

| Suffix | Platform | HDI plug-in | Reason | Source |
| :--- | :--- | :--- | :--- | :--- |
| `.csv` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.tabledata.source` | Generic format, left to VS Code and CSV extensions. Read by `.hdbti` / `.hdbtabledata`. | C1 |
| `.properties` | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.tabledata.properties` | Generic format (VS Code `properties`). Also the XS Advanced translation files. | A-HDICONFIG, M1 |
| `.tags` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.tabledata.properties` | Generic tag-style properties. | M1, A-HDICONFIG |
| `.txt` | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.copyonly` | Any suffix mapped to the copy-only plug-in is deployed as a plain file. | C1 |
| `.jar` | `[XSA]` `[HDI]` | `com.sap.hana.di.virtualfunctionpackage.hadoop` | Binary Hadoop archive (deprecated plug-in). | C1 |
| `.hdbconfig` | — | — | Documentation typo of `.hdiconfig`: H3 introduces "the container-configuration file `.hdbconfig`" right after naming the mandatory suffix `.hdiconfig`. | H3 |
| `.hdbnamespace` | — | — | Documentation spelling of `.hdinamespace` (same description, same naming rules). | H3, X1 |
| `.hdbroles` | — | — | Plural of `.hdbrole` in running text. | M1 |
| `.hdbviewcache` | `[XSC]` `[HDI]` | — | View cache. The corpus has only the migration-table row: no syntax, no plug-in. | M1 |
| `.hdbremotesource` | `[XSC]` | — | Remote source for Hadoop. No syntax in the corpus. In HDI an administrator creates remote sources. | M1 |
| `.hdbdcs` | `[XSA]` `[HDI]` | — | Must be undeployed before migrating to SAP HANA Cloud. No syntax in the corpus. | CM |
| `.project`, `.jsdtscope` | `[XSC]` | — | Eclipse / SAP HANA Studio project descriptors (`.project`, `.settings/.jsdtscope`; M2 spells it `*.jdtscope`). No function in VS Code (#119). | S1, M2 |
| `.regiignore` | `[XSC]` | — | Ignore list of the SAP HANA Studio Repository Team Provider. No function in VS Code (#119). | M2 |
| `.classpath`, `.pyc`, `.bat`, `.DS_Store` | `[XSC]` | — | Generic files listed as not migrated. | M2 |

---

## 4. Grammars Added for the Registry

### 4.1 `.hdbtextbundle` (`source.hdbtextbundle`) `[XSC]`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/012_10_Building_UIs.md (Pages 638–691)

Java-properties-style UI texts for SAP UI5 (`messagebundle.hdbtextbundle`, loaded with `jQuery.sap.resources`).

- Line comments start with `#` or `!`.
- `# TRANSLATE` marks a bundle as translatable.
- Text-type comments (`#XTIT`, `#XFLD`, `#YMSG`, ...) can carry a maximum length: `#XFLD,20: label`.

| Token | Pattern | Scope |
| :--- | :--- | :--- |
| Comment | `^\s*[#!]` to end of line | `comment.line.number-sign.hdbtextbundle` |
| Directive | `TRANSLATE`, `NOTRANSLATE` inside a comment | `keyword.other.directive.hdbtextbundle` |
| Text type / length | `[XY][A-Z]{3}` [`,` digits] before `:` inside a comment | `storage.type.text-type.hdbtextbundle`, `constant.numeric.max-length.hdbtextbundle` |
| Key | `^\s*((?:\\.\|[^\s:=\\])+)` | `support.type.property-name.hdbtextbundle` |
| Separator | `=`, `:` or whitespace | `punctuation.separator.key-value.hdbtextbundle` |
| Value | rest of the line; a trailing `\` continues it | `string.unquoted.value.hdbtextbundle` |
| Escape | `\uXXXX`, `\<char>` | `constant.character.escape.hdbtextbundle` |
| Placeholder | `{0}`, `{1}`, ... | `variable.parameter.placeholder.hdbtextbundle` |

Not formatted, no syntax check. `HANA-MIG-013` notes that HDI replaces text bundles with `.properties` files.

### 4.2 `.proceduretemplate` (`source.proceduretemplate`) `[XSC]`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/009_7_Developing_Procedures.md (Pages 410–413)

A SQLScript procedure body whose template parameters stand in for schema, table, column, view and procedure names. Parameters follow SQL identifier rules, are wrapped in `<` `>`, and are allowed only between `BEGIN` and `END`: `SELECT <My_Column> FROM <My_Table>;`.

- `source.proceduretemplate` includes `source.hanasql`.
- The injection grammar `proceduretemplate.injection` (`L:source.proceduretemplate -comment -string`) scopes `<[A-Za-z_][A-Za-z0-9_]*>` as `variable.parameter.placeholder.proceduretemplate` in every nested SQL region.
- Not formatted and not analyzed: placeholders are not valid SQL, so the SQL checks would report them.

### 4.3 `undeploy.json` (JSON schema) `[XSA]` `[HDI]` `[CLOUD]`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/007_5_Defining_the_Data_Model_in_XS_Advanced.md (Pages 265–266)

The HDI Deployer undeploy allowlist lives in the root of the `db/` module. It is a top-level array of design-time file paths, relative to the module root, with `/` delimiters. The extension validates it with `resources/schemas/undeploy.schema.json` (`contributes.jsonValidation`, `fileMatch: "undeploy.json"`):

```jsonc
{ "type": "array", "uniqueItems": true,
  "items": { "type": "string", "minLength": 1, "pattern": "^(?!/)[^\\\\]+$" } }
```

```json
[
  "src/Table.hdbcds",
  "src/Procedure.hdbprocedure"
]
```

Invalid: an object instead of an array; `"/src/Table.hdbcds"` (absolute path); `"src\\Table.hdbcds"` (backslash delimiter); the same path twice.

### 4.4 `.hdiignore` (VS Code `ignore`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/007_5_Defining_the_Data_Model_in_XS_Advanced.md (Pages 264–265)

- `.hdiignore` sits in the root of the application project, next to `undeploy.json`. It lists real paths or path patterns as in `.gitignore` (`src/table_1.hdbtable`, `src/*_2.hdbtable`) and works like the HDI Deployer's `--exclude-filter`.
- It reuses the built-in `ignore` grammar.
