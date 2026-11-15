# SAP HANA Research & Spec Extraction Checklist

## Antigravity Extraction Protocol
1. Work on **one target `docs/specs/<folder>` domain at a time** matching `ROADMAP.md` priorities.
2. Before reading full chapter files, run ripgrep (`rg`) on `research/refs/extracted/<guide>/` to locate relevant chapters.
3. Update or create the corresponding specification in `docs/specs/<folder>/<topic>.md` (or `.json` for catalogs).
4. Preserve exact BNF `<non_terminal>` brackets, `.hdiconfig` plugin versions, and SQLScript security/linter examples.
5. Mark the guide `[x]` in this checklist once its rules are merged into `docs/specs/`.

## Phase 1 & 2: Grammars & Formatters (SQL, SQLScript, CDS, XSODATA, CGUL) (23 unique guides)

- [x] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake SQL Reference for Data Lake Relational Engine (SAP HANA DB-Managed)** (796p, 27 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_SQL_Reference_for_Data_Lake_Relat`
- [x] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake SQL Reference for Data Lake Relational Engine** (1601p, 54 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_SQL_Reference_for_Data_Lake_Relat`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Hierarchy Developer Guide** (91p, 50 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database JSON Document Store Guide** (84p, 64 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_JSON_Document_Store_Guide`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Knowledge Graph Engine Guide** (37p, 35 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Knowledge_Graph_Engine_Gui`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Property Graph Engine Reference** (180p, 6 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Property_Graph_Engine_Refe`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Spatial Reference** (222p, 8 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Spatial_Reference`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database SQL Reference Guide** (1775p, 60 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Vector Engine Guide** (55p, 53 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Vector_Engine_Guide`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA SQLScript Reference** (278p, 10 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference`
- [x] **HANA_SMART_DATA_INTEGRATION_SAP HANA Cloud, SAP HANA Database SQL Reference Guide** (1772p, 60 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guid`
- [x] **SAP_HANA_PLATFORM_SAP HANA Graph Reference** (74p, 57 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Graph_Reference`
- [x] **SAP_HANA_PLATFORM_SAP HANA JSON Document Store Guide** (33p, 38 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_JSON_Document_Store_Guide`
- [x] **SAP_HANA_PLATFORM_SAP HANA Series Data Developer Guide** (18p, 14 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Series_Data_Developer_Guide`
- [x] **SAP_HANA_PLATFORM_SAP HANA Spatial Reference** (202p, 7 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Spatial_Reference`
- [x] **SAP_HANA_PLATFORM_SAP HANA SQL Reference Guide for SAP HANA Platform** (1893p, 64 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_for_SAP_HANA_Platform`
- [x] **SAP_HANA_PLATFORM_SAP HANA SQLScript Reference for SAP HANA Platform** (287p, 10 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQLScript_Reference_for_SAP_HANA_Platform`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_Graph_Reference_en** (94p, 14 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Graph_Reference_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_JSON_Document_Store_Guide_en** (48p, 14 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_JSON_Document_Store_Guide_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_Series_Data_Developer_Guide_en** (30p, 14 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Series_Data_Developer_Guide_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_Spatial_Reference_en** (338p, 11 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Spatial_Reference_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en** (2388p, 13 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en** (332p, 22 chapters) $\rightarrow$ `docs/specs/grammars/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en`

## Phase 2 & 3: Design-Time Artifacts (.hdb*, .xs*, Calculation Views, HDI) (31 unique guides)

- [ ] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Developer Guide for Data Lake Relational Engine** (619p, 21 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_Developer_Guide_for_Data_Lake_Rel`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Deployment Infrastructure (HDI) Reference** (291p, 10 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Developer Guide for Cloud Foundry Multitarget Applications (SAP Bu** (395p, 14 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Developer_Guide_for_Cloud_`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Developer Guide for Cloud Foundry Multitarget Applications (SAP We** (547p, 19 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Developer_Guide_for_Cloud_`
- [ ] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Modeling Guide for SAP Business Application Studio** (226p, 8 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Modeling_Guide_for_SAP_Bus`
- [ ] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Modeling Guide for SAP Web IDE Full-Stack** (175p, 6 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Modeling_Guide_for_SAP_Web`
- [x] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Search Developer Guide** (438p, 15 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Search_Developer_Guide`
- [ ] **HANA_SMART_DATA_INTEGRATION_Modeling Guide for SAP HANA Web-based Development Workbench** (262p, 9 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Modeling_Guide_for_SAP_HANA_Web-based_Development_Wo`
- [ ] **HANA_SMART_DATA_INTEGRATION_Modeling Guide for SAP Web IDE and SAP Business Application Studio** (282p, 10 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Modeling_Guide_for_SAP_Web_IDE_and_SAP_Business_Appl`
- [ ] **HANA_SMART_DATA_INTEGRATION_REST API Developer Guide** (7p, 8 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_REST_API_Developer_Guide`
- [ ] **SAP_HANA_COCKPIT_SAP HANA Cloud Developer Guide for Cloud Foundry Multitarget Applications (SAP Business App Studio)** (396p, 14 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_COCKPIT_SAP_HANA_Cloud_Developer_Guide_for_Cloud_Foundry_Multitarget_Ap`
- [x] **SAP_HANA_PLATFORM_SAP HANA Core Data Services (CDS) Reference** (273p, 117 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference`
- [x] **SAP_HANA_PLATFORM_SAP HANA Deployment Infrastructure (HDI) Reference for SAP HANA Platform** (300p, 10 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(HDI)_Reference_for_SAP_HAN`
- [x] **SAP_HANA_PLATFORM_SAP HANA Developer Guide for SAP HANA XS Advanced Model (SAP Business App Studio)** (999p, 34 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_(SAP_B`
- [x] **SAP_HANA_PLATFORM_SAP HANA Developer Guide for SAP HANA XS Advanced Model (SAP Web IDE)** (1140p, 38 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_(SAP_W`
- [x] **SAP_HANA_PLATFORM_SAP HANA Developer Guide** (639p, 22 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide`
- [x] **SAP_HANA_PLATFORM_SAP HANA Developer Guide_52715f71** (642p, 22 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_52715f71`
- [x] **SAP_HANA_PLATFORM_SAP HANA HDBTable Syntax Reference** (55p, 33 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Modeling Guide for SAP HANA Web Workbench** (99p, 113 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Modeling_Guide_for_SAP_HANA_Web_Workbench`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Modeling Guide for SAP Web IDE for SAP HANA** (190p, 7 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Modeling_Guide_for_SAP_Web_IDE_for_SAP_HANA`
- [x] **SAP_HANA_PLATFORM_SAP HANA XS Advanced Migration Guide** (134p, 109 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_CDS_Reference_en** (326p, 10 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_CDS_Reference_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en** (374p, 11 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en** (778p, 19 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Web_Workbench_en** (540p, 14 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Web_Workbench_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_BAS_en** (1168p, 19 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_BAS_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en** (1312p, 20 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en`
- [x] **SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en** (70p, 8 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Modeling_Guide_for_SAP_HANA_Web_Workbench_en** (132p, 12 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Modeling_Guide_for_SAP_HANA_Web_Workbench_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Modeling_Guide_for_SAP_HANA_XS_Advanced_Model_en** (242p, 9 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Modeling_Guide_for_SAP_HANA_XS_Advanced_Model_en`
- [~] **SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en** (170p, 8 chapters) $\rightarrow$ `docs/specs/artifacts/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en`

## Phase 3 & 4: API & System View Catalogs (xsjs.d.ts, SYS.*, BIMC, PAL/APL) (12 unique guides)

- [ ] **hana-cloud-database_SAP HANA Cloud, SAP HANA Analytics Catalog (BIMC Views) Reference** (43p, 42 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Analytics_Catalog_(BIMC_Views)_Refe`
- [ ] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Predictive Analysis Library (PAL)** (2620p, 88 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Predictive_Analysis_Librar`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Analytics Catalog (BIMC Views) Reference** (41p, 42 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Analytics_Catalog_(BIMC_Views)_Reference`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Business Function Library (BFL)** (137p, 71 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Business_Function_Library_(BFL)`
- [ ] **SAP_HANA_PLATFORM_SAP HANA External Machine Learning Library** (25p, 28 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_External_Machine_Learning_Library`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Machine Learning Overview** (6p, 7 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Machine_Learning_Overview`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Predictive Analysis Library (PAL)** (2019p, 68 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Predictive_Analysis_Library_(PAL)`
- [ ] **SAP_HANA_PLATFORM_SAP HANA R Integration Guide** (25p, 29 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_R_Integration_Guide`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Analytics_Catalog_BIMC_Views_Reference_en** (58p, 8 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Analytics_Catalog_BIMC_Views_Reference_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_External_Machine_Learning_Library_Guide_en** (34p, 10 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_External_Machine_Learning_Library_Guide_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Machine_Learning_Overview_Guide_en** (16p, 10 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Machine_Learning_Overview_Guide_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_R_Integration_Guide_en** (38p, 12 chapters) $\rightarrow$ `docs/specs/catalogs/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_R_Integration_Guide_en`

## Phase 3: Security Refactoring, Static Analysis & XSC->XSA Migration (21 unique guides)

- [ ] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Files Security Guide** (7p, 10 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_Files_Security_Guide`
- [ ] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Migration Guide** (68p, 57 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_Migration_Guide`
- [ ] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Performance and Tuning for Data Lake Relational Engine (Basics)** (38p, 67 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_Performance_and_Tuning_for_Data_L`
- [ ] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Performance and Tuning for Data Lake Relational Engine (Monitoring Views)** (13p, 23 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_Performance_and_Tuning_for_Data_L`
- [ ] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Security for Data Lake Relational Engine** (192p, 7 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_Security_for_Data_Lake_Relational`
- [ ] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Data Anonymization Guide** (68p, 40 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Data_Anonymization_Guide`
- [ ] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Performance Guide for Developers** (238p, 8 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Performance_Guide_for_Deve`
- [ ] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Security Guide** (191p, 7 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Security_Guide`
- [ ] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Troubleshooting Guide** (99p, 4 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Troubleshooting_Guide`
- [ ] **hana-cloud_SAP HANA Cloud Migration Guide** (158p, 6 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud_SAP_HANA_Cloud_Migration_Guide`
- [ ] **hana-cloud_Security in SAP HANA Cloud** (49p, 48 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/hana-cloud_Security_in_SAP_HANA_Cloud`
- [ ] **SAP_HANA_DYNAMIC_TIERING_SAP HANA Dynamic Tiering_ Migration (PDF)** (20p, 9 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_DYNAMIC_TIERING_SAP_HANA_Dynamic_Tiering__Migration_(PDF)`
- [ ] **SAP_HANA_DYNAMIC_TIERING_SAP HANA Dynamic Tiering_ Migration** (13p, 14 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_DYNAMIC_TIERING_SAP_HANA_Dynamic_Tiering__Migration`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Client-Side Data Encryption Guide** (38p, 49 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Client-Side_Data_Encryption_Guide`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Security Checklists and Recommendations** (25p, 17 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Security_Checklists_and_Recommendations`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Security Guide for SAP HANA Platform** (367p, 13 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Security_Guide_for_SAP_HANA_Platform`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Troubleshooting and Performance Analysis Guide** (291p, 10 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Troubleshooting_and_Performance_Analysis_Guide`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Client-Side_Data_Encryption_Guide_en** (58p, 15 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Client-Side_Data_Encryption_Guide_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Security_Checklists_and_Recommendations_en** (38p, 8 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Security_Checklists_and_Recommendations_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Security_Guide_en** (442p, 24 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Security_Guide_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Troubleshooting_and_Performance_Analysis_Guide_en** (360p, 12 chapters) $\rightarrow$ `docs/specs/diagnostics/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Troubleshooting_and_Performance_Analysis_Guide_en`

## Phase 4: Live DB Connectivity, _SYS_REPO, _SYS_DI & Client Drivers (37 unique guides)

- [ ] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Administration Guide for Data Lake Relational Engine (SAP HANA DB-Managed** (359p, 12 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_Administration_Guide_for_Data_Lak`
- [ ] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Administration Guide for Data Lake Relational Engine** (429p, 15 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_Administration_Guide_for_Data_Lak`
- [ ] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Client Interfaces** (82p, 19 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Cloud,_Data_Lake_Client_Interfaces`
- [ ] **hana-cloud-data-lake_SAP HANA Database Explorer** (89p, 82 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/hana-cloud-data-lake_SAP_HANA_Database_Explorer`
- [ ] **hana-cloud-database_SAP HANA Cloud Administration Guide** (384p, 13 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud_Administration_Guide`
- [ ] **hana-cloud-database_SAP HANA Cloud Database Administration with SAP HANA Cockpit** (259p, 9 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud_Database_Administration_with_SAP_HANA_Cockpit`
- [ ] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Administration Guide** (527p, 18 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Administration_Guide`
- [ ] **HANA_SMART_DATA_INTEGRATION_Administration Guide** (173p, 97 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Administration_Guide`
- [ ] **HANA_SMART_DATA_INTEGRATION_Best Practices and Sizing Guide** (21p, 31 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Best_Practices_and_Sizing_Guide`
- [ ] **HANA_SMART_DATA_INTEGRATION_Configuration Guide for Other SAP HANA Scenarios** (544p, 19 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Configuration_Guide_for_Other_SAP_HANA_Scenarios`
- [ ] **HANA_SMART_DATA_INTEGRATION_Configuration Guide for SAP HANA Cloud** (393p, 14 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Configuration_Guide_for_SAP_HANA_Cloud`
- [ ] **HANA_SMART_DATA_INTEGRATION_Data Provisioning Adapter SDK Guide** (52p, 71 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Data_Provisioning_Adapter_SDK_Guide`
- [ ] **HANA_SMART_DATA_INTEGRATION_Data Provisioning Agent Installation and Update Guide** (24p, 25 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Data_Provisioning_Agent_Installation_and_Update_Guid`
- [ ] **HANA_SMART_DATA_INTEGRATION_Match Tuning Guide** (151p, 57 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Match_Tuning_Guide`
- [ ] **HANA_SMART_DATA_INTEGRATION_Replication Agent for SDI DB2 LTL Mainframe Adapter Guide** (115p, 4 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Replication_Agent_for_SDI_DB2_LTL_Mainframe_Adapter_`
- [ ] **HANA_SMART_DATA_INTEGRATION_SAP HANA Administration Guide for SAP HANA Platform** (1387p, 47 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_SAP_HANA_Administration_Guide_for_SAP_HANA_Platform`
- [ ] **HANA_SMART_DATA_INTEGRATION_SAP HANA Cloud, SAP HANA Database Administration Guide** (517p, 18 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_SAP_HANA_Cloud,_SAP_HANA_Database_Administration_Gui`
- [ ] **HANA_SMART_DATA_INTEGRATION_Side Effect Data Guide** (85p, 72 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/HANA_SMART_DATA_INTEGRATION_Side_Effect_Data_Guide`
- [ ] **SAP_HANA_CLIENT_SAP HANA Client Installation and Update Guide** (12p, 28 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_CLIENT_SAP_HANA_Client_Installation_and_Update_Guide`
- [ ] **SAP_HANA_CLIENT_SAP HANA Client Interface Programming Reference** (760p, 26 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_CLIENT_SAP_HANA_Client_Interface_Programming_Reference`
- [ ] **SAP_HANA_CLIENT_SAP_HANA_Client_Installation_Update_Guide_en** (22p, 11 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_CLIENT_SAP_HANA_Client_Installation_Update_Guide_en`
- [ ] **SAP_HANA_CLIENT_SAP_HANA_Client_Interface_Programming_Reference_en** (1016p, 17 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_CLIENT_SAP_HANA_Client_Interface_Programming_Reference_en`
- [ ] **SAP_HANA_CLIENT_SAP_HANA_Client_Whats_New_Guide_en** (70p, 5 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_CLIENT_SAP_HANA_Client_Whats_New_Guide_en`
- [ ] **SAP_HANA_CLIENT_What's New in the SAP HANA Client** (26p, 2 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_CLIENT_What's_New_in_the_SAP_HANA_Client`
- [ ] **SAP_HANA_COCKPIT_SAP HANA Administration with SAP HANA Cockpit** (520p, 18 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_COCKPIT_SAP_HANA_Administration_with_SAP_HANA_Cockpit`
- [ ] **SAP_HANA_COCKPIT_SAP HANA Cockpit Installation and Update Guide** (35p, 33 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_COCKPIT_SAP_HANA_Cockpit_Installation_and_Update_Guide`
- [ ] **SAP_HANA_COCKPIT_SAP HANA Database Explorer** (56p, 65 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_COCKPIT_SAP_HANA_Database_Explorer`
- [ ] **SAP_HANA_COCKPIT_What's New in the SAP HANA Cockpit 2.0** (70p, 32 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_COCKPIT_What's_New_in_the_SAP_HANA_Cockpit_2.0`
- [ ] **SAP_HANA_DYNAMIC_TIERING_Dynamic_Tiering_Option_Administration_Guide_en** (294p, 11 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_DYNAMIC_TIERING_Dynamic_Tiering_Option_Administration_Guide_en`
- [ ] **SAP_HANA_DYNAMIC_TIERING_SAP HANA Dynamic Tiering_ Administration Guide** (175p, 6 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_DYNAMIC_TIERING_SAP_HANA_Dynamic_Tiering__Administration_Guide`
- [ ] **SAP_HANA_PLATFORM_File Loader Guide for SAP HANA** (22p, 31 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_File_Loader_Guide_for_SAP_HANA`
- [ ] **SAP_HANA_PLATFORM_File_Loader_Guide_for_SAP_HANA_en** (34p, 17 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_File_Loader_Guide_for_SAP_HANA_en`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Administration with SAP HANA Studio** (154p, 6 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Administration_with_SAP_HANA_Studio`
- [ ] **SAP_HANA_PLATFORM_SAP HANA Application Lifecycle Management** (134p, 118 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Application_Lifecycle_Management`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Administration_Guide_en** (1682p, 20 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Administration_Guide_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Administration_with_SAP_HANA_Studio_en** (206p, 17 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Administration_with_SAP_HANA_Studio_en`
- [ ] **SAP_HANA_PLATFORM_SAP_HANA_Application_Lifecycle_Management_en** (178p, 20 chapters) $\rightarrow$ `docs/specs/connectivity/`  
  Extracted: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Application_Lifecycle_Management_en`

## Backlog / Low-Priority Guides (Skip unless needed) (64 unique guides)

- [-] **hana-cloud-data-lake_API Policy** (2p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_End-to-End Resources for SAP HANA Cloud, SAP HANA Data Lake** (24p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_Feature Scope Description for SAP HANA Cloud** (24p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_hdlfscli Data Lake Files Utility** (38p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_Interactive SQL (dbisql) for Data Lake Relational Engine** (93p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_Provisioning Data Lake Using SAP Business Data Cloud Credits** (186p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_Quick Start Tutorial for a Standalone Data Lake** (16p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_Quick Start Tutorial for Data Lake (SAP HANA DB-Managed)** (17p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Relational Engine Backup, Restore, and Data Recovery** (22p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake User Guide for Data Lake Files** (38p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_SAP HANA Cloud, Data Lake Welcome Guide** (16p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-data-lake_What is a Relational Container in Data Lake Relational Engine_ (SAP HANA DB-Managed)** (359p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database AI Development Guide** (60p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Configuration Parameter Reference** (17p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Data Access Guide** (284p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database Embedded Statistics Service Catalog (_SYS_STATISTICS) Reference** (107p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database SPARQL Reference Guide** (323p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud-database_SAP HANA Cloud, SAP HANA Database SQL on Files Guide** (65p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud_End-to-End Resources for SAP HANA Cloud, SAP HANA Database** (24p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud_Feature Scope Description for SAP HANA Cloud** (16p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud_Getting Started with SAP HANA Cloud Free Tier** (11p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud_SAP Agent Memory Service** (41p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud_SAP HANA Cloud Getting Started Guide** (24p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **hana-cloud_SAP HANA Cloud Multitenancy Guide** (83p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_API Policy** (2p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_DYNAMIC_TIERING_Dynamic_Tiering_Option_Installation_Guide_en** (146p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_DYNAMIC_TIERING_Dynamic_Tiering_Option_Master_Guide_en** (38p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_DYNAMIC_TIERING_Dynamic_Tiering_Option_Release_Notes_en** (68p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_DYNAMIC_TIERING_SAP HANA Dynamic Tiering _How To_ Videos** (9p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_DYNAMIC_TIERING_SAP HANA Dynamic Tiering Best Practices Guide** (26p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_DYNAMIC_TIERING_SAP HANA Dynamic Tiering_ Installation and Update Guide** (81p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_DYNAMIC_TIERING_SAP HANA Dynamic Tiering_ Master Guide** (18p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_DYNAMIC_TIERING_SAP HANA Native Storage Extension (NSE)** (1387p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_DYNAMIC_TIERING_What's New in SAP HANA Dynamic Tiering 2.0 (SP 00 to SP 04)** (34p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_Feature Scope Description for SAP HANA** (32p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP HANA Configuration Parameter Reference** (86p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP HANA Developer Quick Start Guide** (195p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP HANA Developer's Information Atlas** (31p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP HANA Development Metro Map** (26p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP HANA Master Guide** (62p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP HANA Server Installation and Update Guide** (247p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP HANA System Replication** (229p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP HANA Tenant Databases** (122p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP_HANA_Business_Function_Library_BFL_en** (158p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP_HANA_Developer_Information_Map_en** (50p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP_HANA_Developer_Quick_Start_Guide_en** (234p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP_HANA_Master_Guide_en** (78p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP_HANA_Server_Installation_Guide_en** (308p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP_HANA_System_Replication_Guide_en** (282p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP_HANA_Tenant_Databases_en** (154p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_SAP_HANA_XS_Command-Line_Interface_Reference_en** (158p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_The SAP HANA XS Command-Line Interface Reference** (138p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_Updates and Additions to SAP HANA Platform 2.0 SPS 08 Documentation** (62p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_What's New in SAP HANA Platform 2.0** (62p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_PLATFORM_Whats_New_SAP_HANA_Platform_Release_Notes_en** (76p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_SPARK_CONTROLLER_API Policy** (2p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_SPARK_CONTROLLER_Hadoop_Integration** (14p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_SPARK_CONTROLLER_SAP HANA Hadoop Integration** (8p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_SPARK_CONTROLLER_SAP HANA Spark Controller Compatibility Matrix** (6p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_SPARK_CONTROLLER_SAP HANA Spark Controller Installation Guide** (83p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_SPARK_CONTROLLER_SAP HANA Spark Controller Videos** (5p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_SPARK_CONTROLLER_Spark_Controller_install** (142p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_SPARK_CONTROLLER_SparkController_whats_new_en** (28p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
- [-] **SAP_HANA_SPARK_CONTROLLER_What's New for Hadoop Integration** (18p, 0 chapters) $\rightarrow$ `docs/specs/miscellaneous/`  
  Extracted: `Not extracted (backlog)`
