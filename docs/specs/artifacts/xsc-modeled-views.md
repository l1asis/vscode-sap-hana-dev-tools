# XS Classic Attribute & Analytic Views (`.attributeview`, `.analyticview`) `[XSC]`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/008_6_Setting_Up_the_Analytic_Model.md (Pages 327–387)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/052_Migrated_XS_Database_Objects.md (Pages 65–67)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/061_Modeler_Artifacts_(Attribute,_Analytic,_Calcview_etc.).md (Pages 73–74)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en/004_2_Migrating_SAP_HANA_XS_Classic_Applications_to_the_XS_Advanced_Model.md (Pages 5–107)

Attribute and analytic views are the XS Classic information views that HDI no longer supports. The XS Advanced Migration Assistant replaces both with graphical calculation views. Grammar: `docs/specs/grammars/hana-xml.md`. Target format: `docs/specs/artifacts/calculationview-schema.md`. Migration rules: `docs/specs/diagnostics/migration-xsc-to-hdi.md` §2.6.

**Provenance.** The corpus describes the model (elements, properties, constraints) but never prints the XML. The XML element and attribute names in §2–§3 are the SAP HANA Studio export format (`BiModelDimension.ecore`, `BiModelCube.ecore`). They are tagged **Studio** and must be checked against a real export before a validator depends on anything below the root element. Rows tagged **Corpus** quote the reference.

---

## 1. Metadata

| Attribute | `.attributeview` | `.analyticview` |
| :--- | :--- | :--- |
| **Language ID** | `attributeview` | `analyticview` |
| **TextMate `scopeName`** | `text.xml.hana` | `text.xml.hana` |
| **Runtime** | `[XSC]` repository (`_SYS_REPO` activation into a `_SYS_BIC` column view) | `[XSC]` repository (`_SYS_REPO` activation into a `_SYS_BIC` column view) |
| **`.hdiconfig` plug-in** | none: not supported in HDI | none: not supported in HDI |
| **Minimum version** | SAP HANA 1.0 (XS Classic) | SAP HANA 1.0 (XS Classic) |
| **Status** | Deprecated with XS Classic (SAP Note 2465027). Replaced by `.calculationview` / `.hdbcalculationview` with `dataCategory="DIMENSION"` | Deprecated with XS Classic. Replaced by `.calculationview` / `.hdbcalculationview` with `dataCategory="CUBE"` |
| **Migration table** (Corpus) | Repository Yes, HDI No, Same syntax No, Migratable Yes | Repository Yes, HDI No, Same syntax No, Migratable Yes |
| **Formatter / analyzer** | not formatted; no checks yet (#102 adds XML well-formedness) | not formatted; no checks yet (#102) |

> **Corpus** (Studio guide §6.2.4): "These models supersede older artifacts like Analytic and Attribute Views; these views should now be replaced by graphical Calculation Views."

---

## 2. Structural Format (XML)

### 2.1 Attribute view (`Dimension:dimension`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Dimension:dimension
    xmlns:Dimension="http://www.sap.com/ndb/BiModelDimension.ecore"
    schemaVersion="1.2"
    id="AT_PRODUCT"
    applyPrivilegeType="ANALYTIC_PRIVILEGE | SQL_ANALYTIC_PRIVILEGE | NONE"
    checkAnalyticPrivileges="true | false"
    defaultClient="$$client$$ | <client>"
    defaultLanguage="$$language$$"
    visibility="internal | reportingEnabled"
    dimensionType="STANDARD | TIME">
  <descriptions defaultDescription="..."/>
  <attributes>
    <attribute id="PRODUCT_ID" key="true" order="1" hidden="false">
      <descriptions defaultDescription="..."/>
      <keyMapping schemaName="SALES" columnObjectName="PRODUCTS" columnName="PRODUCT_ID"/>
    </attribute>
  </attributes>
  <calculatedAttributes>
    <calculatedAttribute id="LABEL" order="2">
      <keyCalculation datatype="NVARCHAR" length="100">
        <formula>"PRODUCT_ID" + ' ' + "NAME"</formula>
      </keyCalculation>
    </calculatedAttribute>
  </calculatedAttributes>
  <privateDataFoundation>
    <tableProxies>
      <tableProxy centralTable="true">
        <table schemaName="SALES" columnObjectName="PRODUCTS"/>
      </tableProxy>
    </tableProxies>
    <joins>
      <join>
        <leftTable schemaName="SALES" columnObjectName="PRODUCTS"/>
        <rightTable schemaName="SALES" columnObjectName="CATEGORIES"/>
        <leftColumns><columnName>CATEGORY_ID</columnName></leftColumns>
        <rightColumns><columnName>CATEGORY_ID</columnName></rightColumns>
        <properties joinOperator="Equal" joinType="leftOuter | inner | referential | rightOuter | textTable"/>
      </join>
    </joins>
    <layout>...</layout>
  </privateDataFoundation>
  <hierarchies>...</hierarchies>
</Dimension:dimension>
```

### 2.2 Analytic view (`Cube:cube`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Cube:cube
    xmlns:Cube="http://www.sap.com/ndb/BiModelCube.ecore"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    schemaVersion="1.5"
    id="AN_SALES"
    applyPrivilegeType="ANALYTIC_PRIVILEGE | SQL_ANALYTIC_PRIVILEGE | NONE"
    defaultClient="$$client$$"
    visibility="reportingEnabled">
  <descriptions defaultDescription="..."/>
  <localVariables>
    <variable id="IP_YEAR" parameter="true">...</variable>
  </localVariables>
  <privateMeasureGroup id="MeasureGroup">
    <attributes>
      <attribute id="ORDER_ID" order="1">
        <keyMapping schemaName="SALES" columnObjectName="ORDERS" columnName="ORDER_ID"/>
      </attribute>
    </attributes>
    <calculatedAttributes/>
    <privateDataFoundation>
      <tableProxies>
        <tableProxy><table schemaName="SALES" columnObjectName="ORDERS"/></tableProxy>
      </tableProxies>
      <joins/>
      <layout>...</layout>
    </privateDataFoundation>
    <baseMeasures>
      <measure id="AMOUNT" order="2" aggregationType="sum" measureType="simple">
        <measureMapping schemaName="SALES" columnObjectName="ORDERS" columnName="AMOUNT"/>
      </measure>
    </baseMeasures>
    <calculatedMeasures>
      <measure id="NET" order="3" aggregationType="sum" measureType="simple" datatype="DECIMAL">
        <formula>"AMOUNT" - "DISCOUNT"</formula>
      </measure>
    </calculatedMeasures>
    <restrictedMeasures>
      <measure id="AMOUNT_APJ" baseMeasure="AMOUNT" aggregationType="sum">
        <restriction logicalOperator="AND">...</restriction>
      </measure>
    </restrictedMeasures>
    <sharedDimensions>
      <logicalJoin associatedObjectUri="/sales.models/attributeviews/AT_PRODUCT">
        <attributes><attributeRef>#PRODUCT_ID</attributeRef></attributes>
        <associatedAttributeNames><attributeName>PRODUCT_ID</attributeName></associatedAttributeNames>
        <properties joinOperator="Equal" joinType="referential | inner | leftOuter"/>
      </logicalJoin>
    </sharedDimensions>
    <layout>...</layout>
  </privateMeasureGroup>
</Cube:cube>
```

---

## 3. Property & Key Schema

### 3.1 Root attributes

| Attribute | Type | Default | Allowed values / constraint | Applies to | Provenance |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | required | View name, unique in the package. The runtime object is `"_SYS_BIC"."<package>/<id>"`. | both | Studio |
| `schemaVersion` | `String` | written by Studio | `1.x` | both | Studio |
| `applyPrivilegeType` | `Enum` | `ANALYTIC_PRIVILEGE` | `ANALYTIC_PRIVILEGE` (Classical Analytic Privileges), `SQL_ANALYTIC_PRIVILEGE`, `NONE` | both | Corpus (Studio guide §11, *Apply Privileges* property); attribute name Studio |
| `checkAnalyticPrivileges` | `Boolean` | `true` | Older switch for the privilege check. Ignored by the migration | both | Corpus (Migration Guide pp. 73–74) |
| `defaultClient` | `String` | `$$client$$` | `$$client$$` (session client) or a fixed client | both | Corpus (*Filter Data for Specific Clients*); attribute name Studio |
| `defaultSchema` | `String` | none | Default schema for unqualified tables. Removed on migration | both | Corpus (Migration Guide pp. 73–74) |
| `dimensionType` | `Enum` | `STANDARD` | `STANDARD`, `TIME`. Derived views reference a base attribute view and cannot be edited | attribute view | Corpus (Sub Type *Standard*, *Time*, *Derived*); attribute name Studio |
| `visibility` | `Enum` | `internal` (attribute view), `reportingEnabled` (analytic view) | *MultiDimensional Reporting* property: `false` hides the view from multidimensional reporting | both | Corpus (§6.2.4.1); attribute name Studio |
| `translationRelevant` | `Boolean` | `true` | Removed on migration. Texts move to `.properties` | both | Corpus (Migration Guide pp. 73–74) |
| Relational optimization flag | `Boolean` | `false` | *Allow Relational Optimization*: effective only when the view generates a catalog calculation view on top of the OLAP view. Removed on migration | analytic view | Corpus (§6.2.4.1, Migration Guide p. 73) |
| Execution semantic | `Enum` | none | Not supported since SP06. Removed on migration | both | Corpus (Migration Guide pp. 73–74) |
| Generate concat attributes | `Boolean` | `false` | Removed on migration | both | Corpus (Migration Guide pp. 73–74) |

### 3.2 Key nodes

| Element | Parent | Cardinality | Content | Applies to | Provenance |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `descriptions` | root, any column | `0..1` | `defaultDescription` label | both | Studio |
| `attributes` / `attribute` | root (attribute view), `privateMeasureGroup` (analytic view) | `0..N` | Simple attributes. `key="true"` marks a key attribute, `hidden="true"` hides it from reporting tools | both | Corpus (Attributes table); element names Studio |
| `keyMapping` | `attribute` | `1` | `schemaName`, `columnObjectName`, `columnName` of the data-foundation column | both | Studio |
| `calculatedAttributes` / `calculatedAttribute` | as `attributes` | `0..N` | Calculated columns of attribute type, with a `<formula>` expression | both | Corpus (Calculated Attributes); element names Studio |
| `privateDataFoundation` | root (attribute view), `privateMeasureGroup` (analytic view) | `1` | `tableProxies` (data sources), `joins`, `layout` | both | Corpus (*data foundation node*); element names Studio |
| `tableProxy` / `table` | `tableProxies` | `1..N` | One catalog table or alias. `centralTable="true"` marks the table that key attributes point to | both | Corpus (central table); element names Studio |
| `join` | `joins` | `0..N` | `leftTable`, `rightTable`, column lists, `properties joinType` / `joinOperator` | both | Studio |
| `hierarchies` | root | `0..N` | Level and parent-child hierarchies | attribute view | Corpus (§6.3.1, §6.3.2); element name Studio |
| `privateMeasureGroup` | root | `1` | Star schema: attributes, data foundation, measures, shared dimensions | analytic view | Studio |
| `baseMeasures` / `measure` | `privateMeasureGroup` | `1..N` | Simple measures with `aggregationType` (`sum`, `min`, `max`, `count`) and `measureMapping` | analytic view | Corpus (Measures table); element names Studio |
| `calculatedMeasures` | `privateMeasureGroup` | `0..N` | Measures from a `<formula>` over other measures, attributes, constants and functions | analytic view | Corpus (Calculated Measures); element name Studio |
| `restrictedMeasures` | `privateMeasureGroup` | `0..N` | A base measure filtered by attribute values (`REGION = APJ`) | analytic view | Corpus (Restricted Measures); element name Studio |
| `sharedDimensions` / `logicalJoin` | `privateMeasureGroup` | `0..N` | Attribute views joined to the fact table (star join). `associatedObjectUri` is the repository path `/<package>/attributeviews/<id>`. Attributes inherited this way are *shared* attributes | analytic view | Corpus (*Shared attributes*, temporal joins: inner or referential only); element names Studio |
| `localVariables` / `variable` | root | `0..N` | Variables and input parameters (`parameter="true"`) | analytic view | Corpus (Variables, Input parameters); element names Studio |

### 3.3 Constraints (Corpus)

| ID | Constraint | Applies to | Source |
| :--- | :--- | :--- | :--- |
| C1 | At least one attribute is a key attribute. All key attributes point to the same (central) table of the data foundation. | attribute view | Studio guide §6.2.3 step 11 |
| C2 | Column views cannot be added to the data foundation. | attribute view | Studio guide §6.2.3 step 8 |
| C3 | Measures come from only one data-foundation table. Measures from several tables need a calculation view. | analytic view | Studio guide §6.2.4.1 |
| C4 | Names must be unique across local and shared attributes, calculated columns, restricted columns and measures; otherwise activation fails. Aliases resolve conflicts and must be unique too. | analytic view | Studio guide §6.2.4.1 |
| C5 | Hidden attributes and measures cannot be used by input parameters, variables, consumers or views built on top. | analytic view | Studio guide §6.2.4.1 |
| C6 | Temporal joins in the star join use join type inner or referential only. | analytic view | Studio guide §6.2.4.2 |

---

## 4. Valid & Invalid Examples

### 4.1 Valid: minimal attribute view (Studio format)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Dimension:dimension xmlns:Dimension="http://www.sap.com/ndb/BiModelDimension.ecore"
    schemaVersion="1.2" id="AT_PRODUCT" applyPrivilegeType="NONE" dimensionType="STANDARD">
  <attributes>
    <attribute id="PRODUCT_ID" key="true" order="1">
      <keyMapping schemaName="SALES" columnObjectName="PRODUCTS" columnName="PRODUCT_ID"/>
    </attribute>
  </attributes>
  <privateDataFoundation>
    <tableProxies>
      <tableProxy centralTable="true"><table schemaName="SALES" columnObjectName="PRODUCTS"/></tableProxy>
    </tableProxies>
    <joins/>
  </privateDataFoundation>
</Dimension:dimension>
```

### 4.2 Valid: analytic view with a shared dimension (Studio format)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Cube:cube xmlns:Cube="http://www.sap.com/ndb/BiModelCube.ecore"
    schemaVersion="1.5" id="AN_SALES" applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE">
  <privateMeasureGroup id="MeasureGroup">
    <attributes>
      <attribute id="PRODUCT_ID" order="1">
        <keyMapping schemaName="SALES" columnObjectName="ORDERS" columnName="PRODUCT_ID"/>
      </attribute>
    </attributes>
    <privateDataFoundation>
      <tableProxies><tableProxy><table schemaName="SALES" columnObjectName="ORDERS"/></tableProxy></tableProxies>
      <joins/>
    </privateDataFoundation>
    <baseMeasures>
      <measure id="AMOUNT" order="2" aggregationType="sum">
        <measureMapping schemaName="SALES" columnObjectName="ORDERS" columnName="AMOUNT"/>
      </measure>
    </baseMeasures>
    <sharedDimensions>
      <logicalJoin associatedObjectUri="/sales.models/attributeviews/AT_PRODUCT">
        <attributes><attributeRef>#PRODUCT_ID</attributeRef></attributes>
        <associatedAttributeNames><attributeName>PRODUCT_ID</attributeName></associatedAttributeNames>
        <properties joinOperator="Equal" joinType="referential"/>
      </logicalJoin>
    </sharedDimensions>
  </privateMeasureGroup>
</Cube:cube>
```

### 4.3 Invalid

| Case | Violation | Detected by |
| :--- | :--- | :--- |
| `<attribute id="PRODUCT_ID">` (no `</attribute>`) | XML well-formedness (`hana-xml.md` §5) | #102 |
| Attribute view whose attributes all have `key="false"` | C1 | activation (no offline rule yet) |
| Two key attributes mapped to `PRODUCTS` and `CATEGORIES` | C1 (key attributes on different tables) | activation (no offline rule yet) |
| `baseMeasures` mapped to columns of `ORDERS` and `RETURNS` | C3 | activation (no offline rule yet) |
| Calculated measure `AMOUNT` next to base measure `AMOUNT` | C4 (name conflict) | activation (no offline rule yet) |
| Root `<Calculation:scenario>` in a `.analyticview` file | wrong root for the suffix | no offline rule yet |

---

## 5. Mapping to `.hdbcalculationview` (Migrator Contract)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/061_Modeler_Artifacts_(Attribute,_Analytic,_Calcview_etc.).md (Pages 73–74)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en/004_2_Migrating_SAP_HANA_XS_Classic_Applications_to_the_XS_Advanced_Model.md (Pages 5–107)

The migration runs in two steps (Corpus): (1) convert to the "OneView" model, i.e. attribute and analytic views become graphical calculation views (Studio *Migrate* tool, or built into the XS Advanced Migration Assistant); (2) make the converted views HDI-compatible. The extension's migrator does not convert these views yet. This table is the contract for a future converter.

### 5.1 Structure

| XSC source | `.hdbcalculationview` target | Provenance |
| :--- | :--- | :--- |
| `.attributeview` root `Dimension:dimension` | `Calculation:scenario dataCategory="DIMENSION"` | Corpus (view type); element names Studio |
| `.analyticview` root `Cube:cube` | `Calculation:scenario dataCategory="CUBE"` with a star join output node | Corpus (view type); element names Studio |
| `dimensionType="TIME"` | `DIMENSION` view of type time | Studio |
| `privateDataFoundation` tables and joins | `DataSource` entries plus `JoinView` / `ProjectionView` nodes | Studio |
| `<table schemaName="S" columnObjectName="T"/>` | `<resourceUri>T</resourceUri>` via a synonym (schema-agnostic, `HANA-LINT-107`) | Corpus (Default Schema removed); Studio |
| `sharedDimensions/logicalJoin associatedObjectUri="/pkg/attributeviews/AT_X"` | `DataSource type="CALCULATION_VIEW"` with `<resourceUri>pkg::AT_X</resourceUri>` (the migrated dimension view) joined in the star join | Studio |
| `attribute` / `keyMapping` | `logicalModel/attributes/attribute` / `keyMapping` | Studio |
| `baseMeasures`, `calculatedMeasures`, `restrictedMeasures` | `logicalModel/baseMeasures`, `calculatedMeasures`, `restrictedMeasures` | Studio |
| `localVariables` | `localVariables` | Studio |
| `hierarchies` | `logicalModel` hierarchies | Studio |

### 5.2 Removed and adjusted features (Corpus, Migration Guide pp. 73–74)

| Feature | Migration result |
| :--- | :--- |
| Translation relevance | Removed. `.properties` files are generated for configured translations |
| Relational optimization (analytic views) | Removed. Not supported by calculation views in HDI |
| Execution semantic | Removed (not supported since SP06) |
| Generate concat attributes | Removed |
| Default schema | Removed |
| `checkAnalyticPrivileges` | Ignored |
| Classical analytic privilege check | Becomes `applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"` if a classic analytic privilege lists the view; otherwise no privilege check. `/src/migration_all_priv.hdbanalyticprivilege` grants access to all migrated views (development only) |
| Currency column `<base>.currency` | Name kept for migrated models |
| Currency conversion schema (`TCUR`, `T006`) | Explicit references to conversion tables, filled with synonym names |
| Pruning tables | Design-time links to tables that must exist |
| Repository references `"_SYS_BIC"."pkg/AT_X"` in SQL | `"pkg::AT_X"` (`HANA-MIG-011`) |
