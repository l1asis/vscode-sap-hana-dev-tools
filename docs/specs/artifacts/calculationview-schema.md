# SAP HANA Calculation View XML Schema & Validation Specification

> **Status:** Authoritative Specification (Phase 3)
> **Rule Namespace:** `HANA-LINT-101` – `HANA-LINT-107`
> **Target Extensions:** `.calculationview` `[XSC]`, `.hdbcalculationview` `[XSA]` `[HDI]` `[CLOUD]`
>
> **Sources:**
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md` (Pages 272–275)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Modeling_Guide_for_SAP_HANA_XS_Advanced_Model_en/005_3_Creating_Calculation_Views.md` (Pages 8–32, 167–172)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en/004_2_Migrating_SAP_HANA_XS_Classic_Applications_to_the_XS_Advanced_Model.md` (Pages 89–93)

---

## 1. Platform & Plug-in Overview

| Variant | Extension | HDI Plug-in | Data Source Reference Style | Privilege Property |
| :--- | :--- | :--- | :--- | :--- |
| `[XSC]` | `.calculationview` | Repository (`_SYS_BIC`) | `<columnObject schemaName="..." columnObjectName="..."/>` or `<resourceUri>` | `checkAnalyticPrivileges`, `ANALYTIC_PRIVILEGE` / `SQL_ANALYTIC_PRIVILEGE` |
| `[XSA]` `[HDI]` `[CLOUD]` | `.hdbcalculationview` | `com.sap.hana.di.calculationview` | `<resourceUri>pkg::OBJECT</resourceUri>` | `applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"` \| `"NONE"` |

---

## 2. Canonical XML Structural Schema

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Calculation:scenario
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:Calculation="http://www.sap.com/ndb/BiModelCalculation.ecore"
    schemaVersion="2.3"
    id="<package::ViewName>"
    outputViewType="Projection | Aggregation | Join | Union | StarJoin"
    dataCategory="CUBE | DIMENSION | DEFAULT | SQL_ACCESS_ONLY"
    applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE | ANALYTIC_PRIVILEGE | NONE"
    defaultClient="$$client$$ | <fixed_client>">

  <descriptions defaultDescription="..."/>
  <localVariables>
    <variable id="..." parameter="true | false">...</variable>
  </localVariables>

  <dataSources>
    <DataSource id="DS_1" type="DATA_BASE_TABLE | CALCULATION_VIEW | TABLE_FUNCTION">
      <!-- [HDI] -->
      <resourceUri>pkg::TABLE_OR_SYNONYM</resourceUri>
      <!-- [XSC legacy] -->
      <columnObject schemaName="SCHEMA" columnObjectName="TABLE"/>
    </DataSource>
  </dataSources>

  <calculationViews>
    <calculationView xsi:type="Calculation:ProjectionView" id="Projection_1">
      <viewAttributes>
        <viewAttribute id="COL1"/>
      </viewAttributes>
      <calculatedViewAttributes>
        <calculatedViewAttribute id="CALC_COL" datatype="INTEGER">
          <formula>...</formula>
        </calculatedViewAttribute>
      </calculatedViewAttributes>
      <input node="#DS_1">
        <mapping xsi:type="Calculation:AttributeMapping" target="COL1" source="COL1"/>
      </input>
    </calculationView>
  </calculationViews>

  <logicalModel id="Projection_1">
    <attributes>
      <attribute id="COL1">
        <keyMapping columnObjectName="Projection_1" columnName="COL1"/>
      </attribute>
    </attributes>
    <calculatedAttributes>...</calculatedAttributes>
    <baseMeasures> <!-- or <measures> -->
      <measure id="AMT" aggregationType="sum">
        <measureMapping columnObjectName="Projection_1" columnName="AMT"/>
      </measure>
    </baseMeasures>
  </logicalModel>

</Calculation:scenario>
```

---

## 3. Supported View Node Types & Cardinality Constraints

| `xsi:type` Value | Required `<input>` Count | Notes / Constraints |
| :--- | :---: | :--- |
| `Calculation:ProjectionView` | `= 1` | Default leaf/output node for `DIMENSION` and `SQL Access Only`. |
| `Calculation:AggregationView` | `= 1` | Default output node for `CUBE`; measures use `SUM`, `MIN`, `MAX`, `COUNT`, `AVG`, `VAR`, `STDDEV`, `MEDIAN`. |
| `Calculation:RankView` | `= 1` | Partitions and ranks rows (`partitionAttributes`, `orderByElements`). |
| `Calculation:JoinView` | `>= 2` | Equi-join / temporal join across 2+ inputs; defines `<joinAttribute>` keys. |
| `Calculation:NonEquiJoinView` | `>= 2` | Non-equi comparisons (`<`, `>=`, `!=`). |
| `Calculation:StarJoinView` | `>= 1` (1 fact + dims) | Valid only when `dataCategory` is `CUBE` or SQL Access Only (`DIMENSION` view/fact constraints apply). |
| `Calculation:UnionView` | `>= 2` | Combines result sets via column mappings. |
| `Calculation:IntersectView` | `= 2` | Set intersection across two sources. |
| `Calculation:MinusView` | `= 2` | Set difference across two sources. |
| `Calculation:HierarchyView` | `>= 1` | SAP HANA hierarchy functions node. |
| `Calculation:TableFunctionView` | `0..N` | Invokes tabular/scalar `.hdbfunction` as source node. |
| `Calculation:GraphView` | `0..1` | Leaf node referencing graph workspace. |
| `Calculation:AnonymizationView` | `= 1` | Leaf anonymization node (k-anonymity / differential privacy). |
| `Calculation:ScriptView` *(Legacy)* | `0` | **Deprecated in HDI / unsupported in HANA Cloud**; convert to Table Function (`.hdbfunction`). |

---

## 4. Semantic & Security Properties

- **Data Category Constraints (`dataCategory`):**
  - `CUBE`: Must define at least one measure under `<baseMeasures>` / `<measures>` for multidimensional reporting (`005_3_Creating_Calculation_Views.md:289`). Supports Star Join.
  - `DIMENSION`: Outputs attributes only; cannot define measures or Star Join root (`005_3_Creating_Calculation_Views.md:125, 458`).
  - `SQL_ACCESS_ONLY` / blank: Not exposed to BI reporting tools; discouraged in SAP HANA Cloud (prefer `DIMENSION`/`CUBE` without MDX technical hierarchies: `005_3_Creating_Calculation_Views.md:145`).
- **Privilege Mode (`applyPrivilegeType`):**
  - `SQL_ANALYTIC_PRIVILEGE`: Recommended for HDI and SAP HANA Cloud (`004_2_Migrating_...md:4248`).
  - `ANALYTIC_PRIVILEGE`: Classical XML analytic privilege (`[XSC]` only; convert to `.hdbanalyticprivilege` SQL privileges).
  - `NONE`: Unprotected analytical view output (no row-level analytic privilege filtering).
  - `checkAnalyticPrivileges`: Legacy XSC boolean attribute ignored in HDI (`004_2_Migrating_...md:4267`).

---

## 5. Static Validation Rules (`HANA-LINT-101` – `HANA-LINT-107`)

| Rule ID | Severity | QuickFix | Trigger Condition | Message |
| :--- | :--- | :---: | :--- | :--- |
| `HANA-LINT-101` | `Error` | No | XML syntax error (unclosed/mismatched tag), missing `<Calculation:scenario>` root, or missing root `id` attribute. | `Malformed calculation view XML: <detail>.` |
| `HANA-LINT-102` | `Error` | No | `<input node="#X">` points to undefined DataSource/calculationView ID, missing `node` attribute, or cyclic/self input reference. | `Unresolved or cyclic node input '#<X>' in calculationView '<id>'.` |
| `HANA-LINT-103` | `Error` | No | Node `<input>` count violates arity rules (e.g., `ProjectionView`/`AggregationView`/`RankView` != 1 input; `JoinView`/`UnionView`/`IntersectView`/`MinusView` < 2 inputs). | `Node '<id>' of type '<xsi:type>' requires <expected> <input> elements (found <actual>).` |
| `HANA-LINT-104` | `Error` / `Warning` | No | Missing `<logicalModel>` or `logicalModel@id` does not match any `<calculationView id>`; OR `dataCategory="CUBE"` defines 0 measures; OR `dataCategory="DIMENSION"` defines measures. | `LogicalModel validation error: <detail>.` |
| `HANA-LINT-105` | `Warning` | No | Duplicate `id` across `<DataSource>`/`<calculationView>`/`<attribute>`/`<measure>`, OR `<keyMapping>`/`<measureMapping>` `columnObjectName` does not match any view node or DataSource ID. | `Duplicate ID '<id>' or unknown columnObjectName '<name>' in mapping.` |
| `HANA-LINT-106` | `Warning` | Yes | `applyPrivilegeType="ANALYTIC_PRIVILEGE"`, `checkAnalyticPrivileges="true"`, or `applyPrivilegeType="NONE"` on `CUBE`/`DIMENSION` view. QuickFix updates to `applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"`. | `Calculation view uses legacy/missing analytic privilege setting ('<val>'). Prefer 'applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"'.` |
| `HANA-LINT-107` | `Warning` | Yes | `.hdbcalculationview` contains XSC `<columnObject schemaName="..."/>`, `defaultSchema="..."`, or deprecated `Calculation:ScriptView`. QuickFix strips `schemaName`/`defaultSchema` where applicable. | `XSC-only construct ('<attr>') found in HDI .hdbcalculationview. Use schema-agnostic <resourceUri> and Table Functions.` |
