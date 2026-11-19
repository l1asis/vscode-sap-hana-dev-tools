# SAP HANA Core Data Services (CDS) Grammar Specification (`cds.md`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference/009_Create_a_CDS_Document.md (Pages 12–240)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_CDS_Reference_en/005_3_Creating_Data_Persistence_Artifacts_with_CDS_in_XS_Classic.md (Pages 10–281)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/052_Migrated_XS_Database_Objects.md (Pages 65–122)

## 1. File Extensions & Scope Name

| File Extension | Language ID | TextMate Scope Name | Platform | Description |
| :--- | :--- | :--- | :--- | :--- |
| `.hdbdd` | `hdbdd` | `source.hdbdd` | `[XSC]` | SAP HANA XS Classic CDS Data Definition document (`_SYS_REPO`) |
| `.hdbcds` | `hdbcds` | `source.hdbcds` | `[XSA]` `[HDI]` | SAP HANA XS Advanced / HDI CDS document (`com.sap.hana.di.cds`) |
| `.package.hdbcds` | `hdbcds` | `source.hdbcds` | `[XSA]` `[HDI]` | SAP HANA CDS Extension Package descriptor |

---

## 2. Lexical Tokens

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference/012_CDS_Naming_Conventions.md (Pages 17–18, 30, 37, 90–92, 134, 148–149, 176–177, 234, 240)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/074_XS_Advanced_and_CAP_Migration_Artifact-Compatibility_List.md (Pages 91–96)

| Token Class | Pattern / Delimiters | TextMate Scope | Platform | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Line Comment | `//[^\r\n]*` | `comment.line.double-slash.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Single-line comment to end of line |
| Block Comment | `/\*[\s\S]*?\*/` | `comment.block.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Multi-line or inline comment |
| Doc Comment | `/\*\*[\s\S]*?\*/` | `comment.block.documentation.<ext>` | `[XSA]` `[HDI]` `[CLOUD]` | Replaces `@Comment` / `@Comments` in CAP `.cds` `[CLOUD]` |
| Single-Quoted String | `'([^'\\]\|\\.\|'')*'` | `string.quoted.single.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Standard CDS string literal |
| Binary Literal | `[xX]'[0-9A-Fa-f]*'` | `constant.other.binary.<ext>` | `[XSC]` `[XSA]` `[HDI]` | Hexadecimal binary literal (`x'01Cafe'`) |
| Date Literal | `(?i)\bdate'[0-9]{4}-[0-9]{2}-[0-9]{2}'` | `constant.other.date.<ext>` | `[XSC]` `[XSA]` `[HDI]` | Typed date literal (`date'2013-04-29'`) |
| Time Literal | `(?i)\btime'[0-9]{2}:[0-9]{2}(?::[0-9]{2})?'` | `constant.other.time.<ext>` | `[XSC]` `[XSA]` `[HDI]` | Typed time literal (`time'17:04:03'`) |
| Timestamp Literal | `(?i)\btimestamp'[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,7})?'` | `constant.other.timestamp.<ext>` | `[XSC]` `[XSA]` `[HDI]` | Typed UTC timestamp literal |
| Double-Quoted Identifier | `"(?:[^"]\|"")*"` | `string.quoted.double.identifier.<ext>` | `[XSC]` `[XSA]` `[HDI]` | Delimited identifier (`"Pack1"."pack2"`, `"Entity"`). Cannot contain `.` or `::` in namespace/artifact paths |
| Bracket-Delimited Identifier | `!\[[^\]]*\]` | `string.other.identifier.<ext>` | `[CLOUD]` | CAP CDS delimited identifier (`![PurchaseOrderId]`). An identifier, not SQL: the analyzer checks only that it is closed (`HANA-SYN-001`), never the quotes or parentheses inside it |
| Unquoted Identifier | `[A-Za-z_][A-Za-z0-9_]*` | `variable.other.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Case-preserving; cannot start with digit or consist only of digits. Max catalog name length: 127 chars (entity/view), 60 chars (structured table type) |
| Numeric Literal | `[+-]?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b` | `constant.numeric.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Integer, Decimal, BinaryFloat, DecimalFloat |
| Boolean / Null Literal | `(?i)\b(true\|false\|null)\b` | `constant.language.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Boolean and null constants |
| Enum Symbol | `#[A-Za-z_][A-Za-z0-9_]*` | `constant.other.enum.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Built-in or user-defined enum symbol (`#COLUMN`, `#ROW`, `#ASC`, `#DESC`, `#HIGH`, `#MEDIUM`, `#LOW`) |
| Annotation Token | `@[A-Za-z_][A-Za-z0-9_.]*` | `storage.type.annotation.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Built-in or user-defined annotation (`@Schema`, `@Catalog.tableType`, `@OData.publish`) |
| Session / Query Variable | `\$(?:user\|env\|parameters\|projection)\b` | `variable.language.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `$parameters` (`[XSC]` `[XSA]` `[HDI]`), `$projection` (`[XSC]` `[XSA]` `[HDI]` `[CLOUD]`), `$user` & `$env` (`[XSA]` `[HDI]` DCL) |
| Parameter / Constant Prefix | `:[A-Za-z_][A-Za-z0-9_.]*` | `variable.parameter.<ext>` | `[XSC]` `[XSA]` `[HDI]` | View parameter, constant reference (`:PAR1`, `:MyCtx.MyConst`), or DCL aspect reference (`:aspCountry`) |
| Namespace Separator | `::` | `punctuation.separator.namespace.<ext>` | `[XSC]` `[XSA]` `[HDI]` | Separates namespace/package from top-level artifact (`ns::Ctx.Entity`) |
| Range Operator | `\.\.` | `keyword.operator.range.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Association cardinality range (`[0..1]`, `[1..*]`) |
| Concatenation Operator | `\|\|` | `keyword.operator.concat.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | String concatenation in views and calculated fields |
| Comparison & Arithmetic Operators | `!=`, `<>`, `<=`, `>=`, `=`, `<`, `>`, `\+`, `-`, `\*`, `/` | `keyword.operator.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | View expressions, `on` conditions, calculated fields |
| Punctuation | `\{`, `\}`, `\[`, `\]`, `\(`, `\)`, `;`, `:`, `,`, `.` | `punctuation.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Structural delimiters |

---

## 3. Keywords & Built-ins

### 3.1 Structural, DDL, Query, Technical Configuration & DCL Keywords

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference/020_CDS_Entities.md (Pages 34–95, 124–240)

| Category | Keywords (Case-Insensitive) | TextMate Scope | Platform |
| :--- | :--- | :--- | :--- |
| Header & Packaging | `namespace`, `using`, `as`, `package`, `depends`, `on`, `in` | `keyword.other.<ext>` | `namespace`, `using`, `as` (`[XSC]` `[XSA]` `[HDI]` `[CLOUD]`); `package`, `depends` (`[XSA]` `[HDI]`) |
| Artifact Declarations | `define`, `context`, `entity`, `temporary`, `type`, `table`, `view`, `annotation`, `association`, `composition`, `extend`, `service`, `accesspolicy`, `aspect`, `role`, `grant` | `keyword.other.<ext>` | `define`, `temporary`, `table type`, `extend`, `accesspolicy`, `aspect`, `role`, `grant` (`[XSA]` `[HDI]`); `service`, `composition` (`[CLOUD]`) |
| Element Modifiers | `element`, `key`, `virtual`, `const`, `null`, `not`, `default`, `of`, `enum`, `generated`, `always`, `by`, `identity`, `start`, `with`, `increment`, `maxvalue`, `minvalue`, `no`, `cycle`, `reset` | `keyword.other.<ext>` | `generated`, `always`, `identity`, `start`, `increment`, `maxvalue`, `minvalue`, `cycle`, `reset`, `enum` (`[XSA]` `[HDI]`) |
| Associations | `to`, `on`, `via`, `many`, `one`, `mixin`, `into` | `keyword.other.<ext>` | `via entity` (`[XSA]` `[HDI]`); `mixin ... into` (`[XSC]` `[XSA]` `[HDI]`) |
| Technical Configuration | `technical`, `configuration`, `store`, `column`, `row`, `migration`, `disabled`, `index`, `unique`, `asc`, `desc`, `fulltext`, `fuzzy`, `search`, `language`, `detection`, `mime`, `phrase`, `ratio`, `only`, `fast`, `preprocess`, `text`, `mining`, `overlay`, `analysis`, `token`, `separators`, `async`, `flush`, `queue`, `every`, `minutes`, `after`, `documents`, `sync`, `partition`, `hash`, `roundrobin`, `range`, `partitions`, `values`, `value`, `others`, `dynamic`, `threshold`, `group`, `subtype`, `name`, `unload`, `priority`, `auto`, `merge`, `storage`, `extended`, `get_num_servers` | `keyword.other.<ext>` | `migration disabled`, `using default/extended storage` (`[XSA]` `[HDI]`); all others (`[XSC]` `[XSA]` `[HDI]`) |
| Series Data | `series`, `period`, `for`, `equidistant`, `piecewise`, `missing`, `elements`, `allowed`, `interval`, `year`, `month`, `day`, `hour`, `minute`, `second` | `keyword.other.<ext>` | `[XSC]` `[XSA]` `[HDI]` (`equidistant piecewise` is `[XSA]` `[HDI]`) |
| View Queries & Expressions | `select`, `from`, `distinct`, `top`, `where`, `group`, `having`, `order`, `nulls`, `first`, `last`, `limit`, `offset`, `union`, `all`, `join`, `inner`, `left`, `right`, `full`, `outer`, `cross`, `and`, `or`, `between`, `in`, `like`, `escape`, `is`, `exists`, `any`, `some`, `case`, `when`, `then`, `else`, `end`, `cast`, `new`, `parameters`, `structured`, `privilege`, `check`, `extends` | `keyword.other.<ext>` | `limit`, `offset`, `exists`, `with structured privilege check`, `extends` (`[XSA]` `[HDI]`) |

### 3.2 Built-In CDS Primitive Data Types (`sap.cds::`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference/030_CDS_Primitive_Data_Types.md (Pages 60–62, 168, 182–184)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/077_Create_and_Initialize_the_Target_SAP_CAP_Application.md (Pages 95–96)

| CDS Primitive Type | Parameters & Range | Mapped HANA SQL Type | OData EDM Type | TextMate Scope | Platform |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `String(n)` | `n`: `1..5000` | `NVARCHAR(n)` | `Edm.String` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `LargeString` | Up to 2 GB | `NCLOB` | `Edm.String` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `Binary(n)` | `n`: `1..5000` | `VARBINARY(n)` | `Edm.Binary` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `LargeBinary` | Up to 2 GB | `BLOB` | `Edm.Binary` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `Integer` | Signed 32-bit integer | `INTEGER` | `Edm.Int32` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `Integer32` | Signed 32-bit integer | `INTEGER` | `Edm.Int32` | `support.type.cds.<ext>` | `[XSA]` `[HDI]` |
| `Integer64` | Signed 64-bit integer | `BIGINT` | `Edm.Int64` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `Decimal(p, s)` | `p`: `1..34`, `s`: `0..p` | `DECIMAL(p, s)` | `Edm.Decimal` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `DecimalFloat` | 34-digit IEEE 754 decimal float | `DECIMAL` | `Edm.Decimal` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `BinaryFloat` | 8-byte IEEE 754 float | `DOUBLE` | `Edm.Double` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` (Use `Double` in `[CLOUD]`) |
| `Double` | 8-byte IEEE 754 float | `DOUBLE` | `Edm.Double` | `support.type.cds.<ext>` | `[CLOUD]` |
| `LocalDate` | `0001-01-01` .. `9999-12-31` | `DATE` | `Edm.Date` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` (Use `Date` in `[CLOUD]`) |
| `Date` | `0001-01-01` .. `9999-12-31` | `DATE` | `Edm.Date` | `support.type.cds.<ext>` | `[CLOUD]` |
| `LocalTime` | `00:00:00` .. `24:00:00` | `TIME` | `Edm.TimeOfDay` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` (Use `Time` in `[CLOUD]`) |
| `Time` | `00:00:00` .. `24:00:00` | `TIME` | `Edm.TimeOfDay` | `support.type.cds.<ext>` | `[CLOUD]` |
| `UTCDateTime` | `0001-01-01 00:00:00` .. `9999-12-31 23:59:59` | `SECONDDATE` | `Edm.DateTimeOffset` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` (Use `DateTime` in `[CLOUD]`) |
| `DateTime` | `0001-01-01 00:00:00` .. `9999-12-31 23:59:59` | `SECONDDATE` | `Edm.DateTimeOffset` | `support.type.cds.<ext>` | `[CLOUD]` |
| `UTCTimestamp` | 0.1 microsecond precision | `TIMESTAMP` | `Edm.DateTimeOffset` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` (Use `Timestamp` in `[CLOUD]`) |
| `Timestamp` | 0.1 microsecond precision | `TIMESTAMP` | `Edm.DateTimeOffset` | `support.type.cds.<ext>` | `[CLOUD]` |
| `Boolean` | `true`, `false`, `null` | `BOOLEAN` | `Edm.Boolean` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `UUID` | 36-char UUID string | `NVARCHAR(36)` | `Edm.Guid` | `support.type.cds.<ext>` | `[CLOUD]` |

### 3.3 Built-In Native SAP HANA Data Types (`hana.*`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference/030_CDS_Primitive_Data_Types.md (Pages 61–62, 95, 168, 183–184, 217)

| CDS `hana.*` Type | Parameters | Mapped HANA SQL Type | TextMate Scope | Platform |
| :--- | :--- | :--- | :--- | :--- |
| `hana.ALPHANUM(n)` | `n`: `1..127` | `ALPHANUM(n)` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` |
| `hana.SMALLINT` | None | `SMALLINT` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.TINYINT` | None | `TINYINT` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.SMALLDECIMAL` | None | `SMALLDECIMAL` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.REAL` | None | `REAL` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.CHAR(n)` | `n`: `1..5000` | `CHAR(n)` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.NCHAR(n)` | `n`: `1..5000` | `NCHAR(n)` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.VARCHAR(n)` | `n`: `1..5000` | `VARCHAR(n)` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.CLOB` | None | `CLOB` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.BINARY(n)` | `n`: `1..5000` | `BINARY(n)` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.SHORTTEXT(n)` | `n`: length | `SHORTTEXT(n)` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` |
| `hana.TEXT` | None | `TEXT` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` |
| `hana.BINTEXT` | None | `BINTEXT` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` |
| `hana.ST_POINT` / `hana.ST_POINT(srid)` | Optional `srid` in `[XSA]` `[HDI]` `[CLOUD]` | `ST_POINT` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| `hana.ST_GEOMETRY` / `hana.ST_GEOMETRY(srid)` | Optional `srid` in `[XSA]` `[HDI]` `[CLOUD]` | `ST_GEOMETRY` | `support.type.cds.<ext>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |

### 3.4 Built-In CDS Annotations

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference/015_CDS_Annotations.md (Pages 22–29, 39–41, 55, 93, 127–132, 147)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/052_Migrated_XS_Database_Objects.md (Pages 65–66, 91–116)

| Annotation | Target Scope | Value Syntax | Platform | Semantics & Migration Notes |
| :--- | :--- | :--- | :--- | :--- |
| `@Schema` | Top-level `context`, `entity`, `type`, `view` | `'SCHEMANAME'` | `[XSC]` | Mandatory at top-level in `.hdbdd`; forbidden in `.hdbcds` (`[XSA]` `[HDI]`) |
| `@Catalog` | `entity` | `{ tableType: ..., index: [...] }` | `[XSC]` | Grouped catalog configuration; forbidden in `.hdbcds` (replaced by `technical configuration`) |
| `@Catalog.tableType` | `entity` | `#COLUMN` \| `#ROW` \| `#GLOBAL_TEMPORARY` \| `#GLOBAL_TEMPORARY_COLUMN` | `[XSC]` | Table store type (default `#COLUMN`); replaced by `technical configuration { column/row store; }` and `temporary entity` in `[XSA]` `[HDI]` |
| `@Catalog.index` | `entity` | `[ { name: '<id>', unique: true\|false, order: #ASC\|#DESC, elementNames: ['<el>'] } ]` | `[XSC]` | Defines indexes; replaced by `technical configuration { [unique] index ... }` in `[XSA]` `[HDI]` |
| `@nokey` | `entity` | Marker (or `: true`) | `[XSC]` | Permits keyless entities in `.hdbdd`; forbidden/unnecessary in `.hdbcds` (`[XSA]` `[HDI]`) |
| `@GenerateTableType` | Structured `type` | `true` \| `false` (default `true`) | `[XSC]` | Controls SQL Table Type creation in `_SYS_BIC`; replaced by `table type` keyword in `[XSA]` `[HDI]` |
| `@SearchIndex` / `@SearchIndex.text` / `@SearchIndex.fuzzy` | Entity element | `{ enabled: true\|false }` | `[XSC]` | Creates fulltext / fuzzy search index; replaced by `technical configuration` in `[XSA]` `[HDI]` |
| `@WithStructuredPrivilegeCheck` | `view` | Marker | `[XSC]` | Enables structured privilege check on view; replaced by trailing `with structured privilege check` clause in `[XSA]` `[HDI]` |
| `@OData.publish` | `context` | `true` \| `false` | `[XSC]` `[XSA]` `[HDI]` | Generates OData service exposure for context; replaced by `@cds.autoexpose` in `[CLOUD]` |
| `@Comment` / `@Comments` | Any artifact or element | `'<text>'` | `[XSC]` `[XSA]` `[HDI]` | Metadata comment; replaced by `/** ... */` doc comments in `[CLOUD]` |
| `@Search.searchable` | `entity`, `view` | `true` \| `false` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Marks artifact as searchable in Enterprise Search |
| `@Search.defaultSearchElement` | Element | `true` \| `false` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Includes element in default search scope |
| `@Search.ranking` | Element | `#HIGH` \| `#MEDIUM` \| `#LOW` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Search relevance ranking weight |
| `@Search.fuzzinessThreshold` | Element | `0.0` .. `1.0` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Default fuzzy matching threshold |
| `@EnterpriseSearch.enabled` | `entity`, `view` | `true` \| `false` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Enables Enterprise Search model generation |
| `@EnterpriseSearch.key` | Element | `true` \| `false` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Marks key element for Enterprise Search |
| `@EnterpriseSearch.usageMode` | Element | Enum / String | `[XSC]` `[XSA]` `[HDI]` | Enterprise Search usage mode |
| `@EnterpriseSearch.presentationMode` | Element | Enum / Array | `[XSC]` `[XSA]` `[HDI]` | Enterprise Search presentation mode |
| `@EnterpriseSearch.filteringFacet` | Element | `{ ... }` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Configures faceted search filtering |
| `@EnterpriseSearch.defaultValueSuggestElement` | Element | `true` \| `false` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Enables value suggestion on element |
| `@EnterpriseSearch.displayOrder` | Element | Integer | `[XSC]` `[XSA]` `[HDI]` | Display position in search results |
| `@Scope` | `annotation` definition | `[ #ENTITY, #VIEW, #ELEMENT, ... ]` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Annotation target scope metadata |
| `@sql.append` | `entity`, `view`, element | `'<SQL DDL clause>'` | `[CLOUD]` | Appends native HANA SQL DDL (`PARTITION BY`, `FUZZY SEARCH INDEX`, `generated always as`, `with structured privilege check`) |
| `@cds.persistence.exists` | `entity` | Marker / `true` | `[CLOUD]` | Declares facade entity for existing DB object |
| `@cds.persistence.udf` | `entity` | Marker / `true` | `[CLOUD]` | Marks facade entity as Table UDF |
| `@cds.persistence.calcview` | `entity` | Marker / `true` | `[CLOUD]` | Marks facade entity as Calculation View |
| `@cds.autoexpose` | `entity` | Marker / `true` | `[CLOUD]` | Auto-exposes entity in CAP services |

### 3.5 Built-In SQL Functions Allowed in CDS Views & Calculated Fields

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference/036_CDS_View_Syntax_Options.md (Pages 84–90, 166–168, 207–211)

- **Aggregate Functions (Views only):** `avg`, `count`, `min`, `max`, `sum`, `stddev`, `var`
- **String Functions:** `ascii`, `char`, `concat`, `lcase`, `left`, `length`, `locate`, `lower`, `lpad`, `ltrim`, `nchar`, `replace`, `right`, `rpad`, `rtrim`, `soundex` (`[XSA]` `[HDI]`), `strtobin`, `substr_after`, `substr_before`, `substring`, `trim`, `ucase`, `unicode`, `upper`
- **Numeric / Math Functions:** `abs`, `acos`, `asin`, `atan`, `atan2`, `bitand`, `bitat` (`[XSA]` `[HDI]`), `bitcount`, `bitnot` (`[XSA]` `[HDI]`), `bitor` (`[XSA]` `[HDI]`), `bitset` (`[XSA]` `[HDI]`), `bitunset` (`[XSA]` `[HDI]`), `bitxor` (`[XSA]` `[HDI]`), `ceil`, `cos`, `cosh`, `cot`, `exp`, `floor`, `ln`, `log`, `mod`, `power`, `rand` (`[XSA]` `[HDI]`), `round`, `sign`, `sin`, `sinh`, `sqrt`, `tan`, `tanh`, `uminus`
- **Date / Time Functions:** `add_days`, `add_months`, `add_months_last` (`[XSA]` `[HDI]`), `add_nano100` (`[XSA]` `[HDI]`), `add_seconds`, `add_workdays` (`[XSA]` `[HDI]`), `add_years`, `current_date`, `current_time`, `current_timestamp`, `current_utcdate`, `current_utctime`, `current_utctimestamp`, `dayname`, `dayofmonth`, `dayofyear`, `days_between`, `extract`, `hour`, `isoweek`, `last_day`, `localtoutc`, `minute`, `month`, `monthname`, `nano100_between`, `next_day`, `now`, `quarter`, `second`, `seconds_between`, `utctolocal`, `week`, `weekday`, `workdays_between` (`[XSA]` `[HDI]`), `year`, `years_between`
- **Conversion Functions:** `bintohex`, `bintostr`, `cast`, `hextobin`, `to_alphanum`, `to_bigint`, `to_binary`, `to_blob`, `to_clob`, `to_date`, `to_dats`, `to_decimal`, `to_double`, `to_fixedchar`, `to_int`, `to_integer`, `to_nclob`, `to_nvarchar`, `to_real`, `to_seconddate`, `to_smalldecimal`, `to_smallint`, `to_time`, `to_timestamp`, `to_tims`, `to_tinyint`, `to_varchar`
- **Null-Handling & Session Functions:** `coalesce`, `current_schema`, `current_user`, `greatest`, `ifnull`, `least`, `map`, `nullif`, `session_context`, `session_user`, `sysuuid`

---

## 4. Formal EBNF Grammar

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference/009_Create_a_CDS_Document.md (Pages 12–240)

```ebnf
(* 1. Document Structure *)
cds_document ::=
    [ namespace_decl ]
    [ in_package_decl ]               (* [XSA] [HDI] extension descriptor only *)
    { using_decl }
    { top_level_artifact } ;          (* [XSC]: 1 top_level_artifact; [XSA]/[HDI]/[CLOUD]: 1 or more *)

extension_package_document ::=        (* .package.hdbcds [XSA] [HDI] *)
    package_decl
    { using_decl }
    { annotation_def } ;

namespace_decl ::=
    "namespace" namespace_path ";" ;

namespace_path ::=
    identifier { "." identifier } ;

using_decl ::=
    "using" [ "::" ] namespace_path "::" ( artifact_subpath [ "as" identifier ] | "*" ) ";" ;

artifact_subpath ::=
    identifier { "." identifier } ;

package_decl ::=
    "package" namespace_path [ "depends" "on" namespace_path { "," namespace_path } ] ";" ;

in_package_decl ::=
    "in" "package" namespace_path ";" ;

(* 2. Top-Level & Context-Level Artifacts *)
top_level_artifact ::=
    { annotation_assign }
    ( context_def
    | entity_def
    | type_def
    | view_def
    | annotation_def
    | extend_def                      (* [XSA] [HDI] [CLOUD] *)
    | accesspolicy_def                (* [XSA] [HDI] *)
    | aspect_def                      (* [XSA] [HDI] [CLOUD] *)
    | role_def                        (* [XSA] [HDI] *)
    | service_def                     (* [CLOUD] *)
    ) ;

context_def ::=
    [ "define" ] "context" identifier "{"
        { context_member }
    "}" [ ";" ] ;

context_member ::=
    { annotation_assign }
    ( context_def
    | entity_def
    | type_def
    | view_def
    | annotation_def
    | assoc_def
    | const_decl
    ) ;

(* 3. Annotations *)
annotation_def ::=
    [ "define" ] "annotation" identifier
    ( ":" type_spec ";"
    | "{" { { annotation_assign } identifier ":" type_spec ";" } "}" [ ";" ]
    ) ;

annotation_assign ::=
    "@" annotation_path [ ":" annotation_value ] ;

annotation_path ::=
    identifier [ "[" unsigned_integer "]" ] { "." identifier [ "[" unsigned_integer "]" ] } ;

annotation_value ::=
    literal
    | enum_value
    | "{" [ annotation_kv { "," annotation_kv } ] "}"
    | "[" [ annotation_value { "," annotation_value } ] "]" ;

annotation_kv ::=
    annotation_path ":" annotation_value ;

(* 4. User-Defined Types, Table Types & Enums *)
type_def ::=
    [ "define" ] "type" identifier
    ( ":" type_spec ";"
    | "{" { type_element } "}" [ ";" ]
    )
    | [ "define" ] "table" "type" identifier "{" { type_element } "}" [ ";" ] ;

type_spec ::=
    primitive_type
    | hana_type
    | qualified_type_ref
    | "type" "of" element_path
    | assoc_spec
    | primitive_type "enum" "{" { enum_element } "}" ;

enum_element ::=
    identifier [ "=" literal ] ";" ;

enum_value ::=
    "#" identifier
    | qualified_type_ref "." identifier ;

type_element ::=
    { annotation_assign }
    identifier ":" type_spec [ nullability_modifier ] [ default_modifier ] ";" ;

(* 5. Entities, Elements, Calculated Fields & Identity Columns *)
entity_def ::=
    [ "define" ] [ "temporary" ] "entity" identifier [ "{"
        { entity_member }
    "}" ]
    [ series_clause ]
    [ technical_configuration_clause ]
    [ ";" ] ;

entity_member ::=
    { annotation_assign }
    ( entity_element
    | const_decl
    ) ;

const_decl ::=
    "const" identifier ":" primitive_type "=" literal ";" ;

entity_element ::=
    [ "element" ] [ "key" ] [ "virtual" ] identifier
    [ ":" type_spec ]
    ( calculated_field_clause
    | identity_column_clause
    | { element_modifier }
    ) ";" ;

element_modifier ::=
    nullability_modifier
    | default_modifier ;

nullability_modifier ::=
    "null" | "not" "null" ;

default_modifier ::=
    "default" ( literal | enum_value ) ;

calculated_field_clause ::=
    ( "=" | "as" | "generated" "always" "as" ) expression ;

identity_column_clause ::=
    "generated" ( "always" | "by" "default" ) "as" "identity"
    [ "(" { identity_option } ")" ] ;

identity_option ::=
    "start" "with" signed_integer
    | "increment" "by" signed_integer
    | "maxvalue" signed_integer
    | "no" "maxvalue"
    | "minvalue" signed_integer
    | "no" "minvalue"
    | "cycle"
    | "no" "cycle"
    | "reset" "by" "(" select_stmt ")" ;

(* 6. Associations *)
assoc_def ::=
    [ "define" ] "association" identifier [ cardinality ] "to" qualified_type_ref
    [ assoc_binding ] ";" ;

assoc_spec ::=
    ( "association" | "composition" ) [ cardinality ] "to" qualified_type_ref
    [ assoc_binding ] ;

cardinality ::=
    "[" ( unsigned_integer ".." ( unsigned_integer | "*" ) | unsigned_integer | "*" ) "]" ;

assoc_binding ::=
    managed_foreign_keys
    | "on" condition
    | "via" "entity" qualified_type_ref ;

managed_foreign_keys ::=
    "{" foreign_key_item { "," foreign_key_item } "}"
    [ nullability_modifier ] [ default_modifier ] ;

foreign_key_item ::=
    element_path [ "as" identifier ] [ default_modifier ] ;

(* 7. Technical Configuration & Series *)
technical_configuration_clause ::=
    "technical" "configuration" "{"
        { tech_config_statement }
    "}" ;

tech_config_statement ::=
    ( "column" "store" | "row" "store" ) [ "migration" "disabled" ] ";"
    | [ "unique" ] "index" identifier "on" "(" element_path { "," element_path } ")" [ "asc" | "desc" ] ";"
    | "fulltext" "index" identifier "on" "(" element_path ")" { fulltext_parameter } ";"
    | "fuzzy" "search" "index" "on" "(" element_path { "," element_path } ")" ";"
    | "partition" "by" partition_spec ";"
    | ( "group" { ( "type" | "subtype" | "name" ) identifier } | "no" "group" ) ";"
    | "unload" "priority" unsigned_integer ";"
    | [ "no" ] "auto" "merge" ";"
    | "using" ( "default" | "extended" ) "storage" ";" ;

series_clause ::=
    "series" "("
        "series" "key" "(" element_path { "," element_path } ")"
        "period" "for" "series" "(" element_path ")"
        [ "not" "equidistant"
        | "equidistant" "piecewise"
        | [ "equidistant" ] "increment" "by" series_interval [ "missing" "elements" [ "not" ] "allowed" ]
        ]
        [ "minvalue" literal | "no" "minvalue" ]
        [ "maxvalue" literal | "no" "maxvalue" ]
    ")" ;

series_interval ::=
    number_literal
    | "interval" number_literal ( "year" | "month" | "day" | "hour" | "minute" | "second" ) ;

(* 8. Views. Lists are comma-separated and there are no implicit aliases: two adjacent items in a select list,
      group by / order by list, parameter list or index element list miss a ',' (HANA-SYN-023, syntax-rules.md). *)
view_def ::=
    [ "define" ] "view" identifier
    [ "with" "parameters" parameter_decl { "," parameter_decl } ]
    "as" select_stmt
    [ "with" "structured" "privilege" "check" ] ";" ;

parameter_decl ::=
    identifier ":" ( primitive_type | hana_type | qualified_type_ref ) ;

select_stmt ::=
    select_query { "union" [ "all" ] select_query } ;

select_query ::=
    "select" "from" data_source
    [ "mixin" "{" { identifier ":" assoc_spec ";" } "}" "into" ]
    "{" [ "distinct" ] [ "top" unsigned_integer ] select_list "}"
    [ "where" condition ]
    [ "group" "by" expression { "," expression } ]
    [ "having" condition ]
    [ "order" "by" order_by_item { "," order_by_item } ]
    [ "limit" unsigned_integer [ "offset" unsigned_integer ] ] ;

(* 9. Extensions & DCL [XSA] [HDI] *)
extend_def ::=
    { annotation_assign }
    "extend" ( "context" | "entity" | "view" ) qualified_type_ref
    [ "{" { extend_member } "}" ]
    [ technical_configuration_clause ]
    [ "where" condition ]
    [ "group" "by" expression { "," expression } ]
    [ "order" "by" order_by_item { "," order_by_item } ]
    [ "union" [ "all" ] select_query ]
    [ ";" ] ;

accesspolicy_def ::=
    [ "define" ] "accesspolicy" identifier "{"
        { accesspolicy_def | aspect_def | role_def }
    "}" [ ";" ] ;

aspect_def ::=
    [ "define" ] "aspect" identifier
    "as" "select" "from" qualified_type_ref
    "{" element_path { "," element_path } "}"
    [ "where" "$user" "in" element_path ] ";" ;

role_def ::=
    [ "define" ] "role" identifier [ "extends" "role" qualified_type_ref ] "{"
        { "grant" "select" "on" qualified_type_ref [ "where" dcl_condition ] ";" }
    "}" [ ";" ] ;
```

---

## 5. Embedded Language Injections

- None for `.hdbdd` (`[XSC]`) and `.hdbcds` (`[XSA]`/`[HDI]`); view queries and expressions are native CDS query syntax highlighted directly by `source.hdbdd` and `source.hdbcds`.
- In CAP `.cds` (`[CLOUD]`), `@sql.append: '...'` or `` @sql.append: `...` `` contains embedded SAP HANA SQL DDL clauses (`source.hanasql`).

---

## 6. Canonical Formatting Rules (Phase 2)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_CDS_Reference_en/006_4_Creating_Data_Persistence_Artifacts_with_CDS_in_XS_Advanced.md (Pages 147–215)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Core_Data_Services_(CDS)_Reference/036_CDS_View_Syntax_Options.md (Pages 80–94)

1. **Header & Packaging (`namespace`, `using`, `package`, `in package`):**
   - Emit at indent level `0` with no spaces around `.` or `::` and no space before `;` (`namespace acme.com.app1;`, `using acme.com.common::Types.Money as Money;`).
   - Group consecutive `using` declarations and separate header declarations from top-level artifacts with a blank line.
2. **`@Annotation` Placement:**
   - Place each `@Annotation` on its own line immediately preceding its target (`context`, `entity`, `type`, `view`, `annotation`, `extend`, element, or parameter) at the target's indent level.
   - Format annotation assignments as `@Path: value` (no space before `:`, single space after `:`); preserve marker annotations (`@nokey`, `@WithStructuredPrivilegeCheck`, `@cds.persistence.exists`) without synthesizing `: true`.
   - Keep short single-line `@Annotation: { ... }` / `[ ... ]` inline when fitting within `maxLineLength` and free of internal comments; otherwise expand multi-line at `+1` indent.
3. **Block Openers, Closers & Indentation (`context`, `entity`, `type`, `table type`, `enum`, `accesspolicy`, `role`, `extend`):**
   - Place opening `{` on the declaration header line after a single space (`context Model {`, `entity Employee {`).
   - Indent all block members by `+1` indent unit; place closing `}` at the block's opening indent level followed immediately by `;` (`};`), or `}` followed by `technical configuration {` on the same line (`} technical configuration { ... };`).
   - Format empty blocks as `{}` / `{};`.
   - Format `series ( ... )` clauses with `+1` indent inside parentheses.
4. **Element & Type Declarations:**
   - Separate element/type names and type specs with ` : ` (`key id : Integer;`, `name : String(100) not null default 'n/a';`).
   - Keep type arguments (`String(100)`, `Decimal(15, 2)`, `hana.ST_POINT(4326)`), association cardinalities (`Association[0..1]`), and range operators (`0..1`, `1..*`) free of extraneous inner spaces before `(` / `[` or around `..`.
   - Keep parameter/constant prefixes (`:PAR1`) attached to their identifier when used in expressions (`= :PAR1`), while still spacing declaration colons (`id:Integer` $\rightarrow$ `id : Integer`).
5. **Views & `select from` Clauses (`.hdbdd`, `.hdbcds`):**
   - Format header as `[define] view <Name> [with parameters ...] as select from <DataSource>` (wrapping `select from` when `with parameters` or `union` is present).
   - Format `mixin { ... } into { ... }` with `+1` indent for mixin association bindings.
   - Format projection `{ ... }`: keep single-item short projections inline when fitting within `maxLineLength` and free of comments; expand multi-item or long projections one item per line at `+1` indent with closing `}` at view indent level. Preserve `.{` without space around `.` for nested path projections (`orders[status = 'open'].{ id as orderId }`).
   - Align trailing query clauses (`where`, `group by`, `having`, `order by`, `limit ... offset ...`, `union [all]`, `with structured privilege check`) at view indent level and terminate the view with `;`.
6. **Identifier, Comment, Pragma & Recovery Guarantees:**
   - Never alter case of identifiers, namespace paths, annotations, or string/delimited identifier literals (`'...'`, `"..."`, `![...]`).
   - Preserve `//`, `/* ... */`, and `/** ... */` comments in relative position, and emit regions inside `hanasql-format off ... on` pragmas verbatim.
   - Recover gracefully from missing `;` or unmatched `{` / `(` without throwing or dropping tokens.
