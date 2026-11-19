# Classic Key-Value & Embedded SQL Grammar Specification (`hdb-classic-kv.md`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/004_2_Getting_Started_with_the_HDBTable_Syntax.md (Pages 4–17)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/005_3_Creating_the_Persistence_Model_with_HDBTable.md (Pages 18–67)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference/016_Table_Configuration_Syntax.md (Pages 21–24)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference/021_Sequence_Configuration_Syntax.md (Pages 31–34)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference/024_SQL_View_Configuration_Syntax.md (Page 38)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference/027_Synonym_Configuration_Syntax.md (Page 42)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference/031_Table-Import_Configuration-File_Syntax_(HDBtable).md (Pages 49–52)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/007_5_Setting_up_the_Data_Persistence_Model_in_SAP_HANA.md (Pages 204–205, 277–326)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Web_Workbench_en/006_4_Setting_up_the_Data_Persistence_Model_in_SAP_HANA.md (Pages 218–265)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 299–300, 316–357)

---

## 1. File Extensions & Scope Name

| File Extension | TextMate `scopeName` | Grammar File | Target Platforms |
| :--- | :--- | :--- | :--- |
| `.hdbtable` | `source.hdbtable` | `syntaxes/hdbtable.tmLanguage.json` | `[XSC]` (Key-Value), `[XSA]` `[HDI]` `[CLOUD]` (Headerless SQL DDL) |
| `.hdbstructure` | `source.hdbstructure` | `syntaxes/hdbstructure.tmLanguage.json` | `[XSC]` (Key-Value; replaced by `.hdbtabletype` in `[HDI]`) |
| `.hdbview` | `source.hdbview` | `syntaxes/hdbview.tmLanguage.json` | `[XSC]` (Key-Value + Embedded SQL), `[XSA]` `[HDI]` `[CLOUD]` (Headerless SQL DDL) |
| `.hdbsequence` | `source.hdbsequence` | `syntaxes/hdbsequence.tmLanguage.json` | `[XSC]` (Key-Value + Embedded SQL), `[XSA]` `[HDI]` `[CLOUD]` (Headerless SQL DDL) |
| `.hdbschema` | `source.hdbschema` | `syntaxes/hdbschema.tmLanguage.json` | `[XSC]` (Key-Value) |
| `.hdbti` | `source.hdbti` | `syntaxes/hdbti.tmLanguage.json` | `[XSC]` (Key-Value; replaced by `.hdbtabledata` in `[HDI]`) |
| `.hdbsynonym` | `source.hdbsynonym` | `syntaxes/hdbsynonym.tmLanguage.json` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` (JSON with comment extensions) |
| `.hdbsynonymconfig` | `source.hdbsynonymconfig` | `syntaxes/hdbsynonymconfig.tmLanguage.json` | `[XSA]` `[HDI]` `[CLOUD]` (JSON) |
| `.hdbpublicsynonym` | `source.hdbpublicsynonym` | `syntaxes/hdbpublicsynonym.tmLanguage.json` | `[XSA]` `[HDI]` `[CLOUD]` (JSON) |
| `.hdbsysbicsynonym` | `source.hdbsysbicsynonym` | `syntaxes/hdbsysbicsynonym.tmLanguage.json` | `[XSA]` `[HDI]` (JSON) |

---

## 2. Lexical Tokens & Comments

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/005_3_Creating_the_Persistence_Model_with_HDBTable.md (Pages 18–67)

| Token Class | Pattern / Delimiter | TextMate Scope | Platform | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Line Comment (KV/JSON) | `//.*$` | `comment.line.double-slash.<lang>` | `[XSC]` `[HDI]` | Supported in all classic KV and synonym JSON files |
| Line Comment (HDI SQL) | `--.*$` | `comment.line.double-dash.hanasql` | `[XSA]` `[HDI]` `[CLOUD]` | Supported via `source.hanasql` fallback in `.hdbtable`, `.hdbview`, `.hdbsequence` |
| Block Comment | `/* ... */` | `comment.block.<lang>` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Multi-line comments |
| String Literal | `"..."` | `string.quoted.double.<lang>` | `[XSC]` `[HDI]` | Used for schema names, column names, default values, CSV delimiters, and JSON strings |
| String Escape | `\\.` | `constant.character.escape.<lang>` | `[XSC]` `[HDI]` | Escapes `\"`, `\\`, `\n`, `\r`, `\t` inside double-quoted strings |
| Numeric Literal | `(?<![\w.])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b` | `constant.numeric.<lang>` | `[XSC]` `[HDI]` | Signed integers (`start_with = -1;`, `length = 20;`, `precision = 12;`, `scale = 3;`) |
| Boolean Literal | `\b(?:true|false)\b` | `constant.language.boolean.<lang>` | `[XSC]` `[HDI]` | Case-sensitive lowercase booleans |
| Assignment Operator | `=` | `keyword.operator.assignment.<lang>` | `[XSC]` | Key-value assignment separator |
| Key-Value Colon | `:` | `punctuation.separator.colon.<lang>` | `[XSC]` `[HDI]` | Used in `.hdbti` `keys = [ "COL" : "VAL" ];` and JSON `.hdbsynonym` |
| Statement Terminator | `;` | `punctuation.terminator.statement.<lang>` | `[XSC]` | Terminates each key-value assignment |
| Struct Braces | `{` / `}` | `punctuation.section.braces.(begin\|end).<lang>` | `[XSC]` `[HDI]` | Encloses column/index/import/synonym objects |
| List Brackets | `[` / `]` | `punctuation.section.brackets.<lang>` | `[XSC]` `[HDI]` | Encloses lists of strings or struct objects |

---

## 3. Keywords by TextMate Scope

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/005_3_Creating_the_Persistence_Model_with_HDBTable.md (Pages 27–63)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 299–300, 321–326)

### 3.1 `keyword.control.<lang>` & `variable.language.<lang>`

- **`.hdbtable` / `.hdbstructure` `[XSC]`:**
  - `variable.language.hdbtable`: `table`
- **`.hdbti` `[XSC]`:**
  - `keyword.control.import.hdbti`: `import`

### 3.2 `support.type.property-name.<lang>` (Configuration Keys)

- **`.hdbtable` `[XSC]`:**
  - Top-level (`table.<key>`): `schemaName`, `SchemaName`, `temporary`, `tableType`, `public`, `loggingType`, `tableLoggingType`, `description`, `columns`, `indexes`, `primaryKey`
  - Primary key (`table.primaryKey.<key>` or inside `table.primaryKey = { ... }`): `pkcolumns`, `indexType`
  - Column & Index struct fields: `name`, `sqlType`, `nullable`, `unique`, `length`, `scale`, `precision`, `defaultValue`, `comment`, `order`, `indexType`, `indexColumns`
- **`.hdbstructure` `[XSC]`:**
  - Top-level (`table.<key>`): `schemaName`, `SchemaName`, `public`, `columns`, `primaryKey`
  - Primary key & Column struct fields: `pkcolumns`, `indexType`, `name`, `sqlType`, `nullable`, `unique`, `length`, `scale`, `precision`, `defaultValue`, `comment`
- **`.hdbview` `[XSC]`:**
  - `schema`, `query`, `public`, `depends_on`, `depends_on_table`, `depends_on_view`
- **`.hdbsequence` `[XSC]`:**
  - `schema`, `increment_by`, `start_with`, `maxvalue`, `nomaxvalue`, `minvalue`, `nominvalue`, `cycles`, `reset_by`, `public`, `depends_on`, `depends_on_table`, `depends_on_view`
- **`.hdbschema` `[XSC]`:**
  - `schema_name`
- **`.hdbti` `[XSC]`:**
  - `table`, `cdstable`, `hdbtable`, `schema`, `file`, `header`, `useHeaderNames`, `delimField`, `delimEnclosing`, `distinguishEmptyFromNull`, `keys`
- **`.hdbsynonym` / `.hdbsynonymconfig` / `.hdbpublicsynonym` / `.hdbsysbicsynonym` `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`:**
  - `support.type.property-name.json.<lang>`: `"target"`, `"schema"`, `"object"`, `"package"` `[XSC]`, `"revalidate"` `[HDI]`, `"logical_schema"` `[HDI]`, `"remote"` `[HDI]`, `"database"` `[HDI]`
  - `entity.name.type.hdbsynonym`: `"<namespace>::<SynonymName>"`

### 3.3 `storage.type.hdbtable` (`sqlType` Values in `.hdbtable` & `.hdbstructure`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/005_3_Creating_the_Persistence_Model_with_HDBTable.md (Page 29)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/007_5_Setting_up_the_Data_Persistence_Model_in_SAP_HANA.md (Page 204)

- **Core `SqlDataType` Enum `[XSC]`:**
  `DATE`, `TIME`, `TIMESTAMP`, `SECONDDATE`, `INTEGER`, `TINYINT`, `SMALLINT`, `BIGINT`, `REAL`, `DOUBLE`, `FLOAT`, `SMALLDECIMAL`, `DECIMAL`, `VARCHAR`, `NVARCHAR`, `CLOB`, `NCLOB`, `ALPHANUM`, `TEXT`, `SHORTTEXT`, `BLOB`, `VARBINARY`
- **Extended SQL Types Mapped in HDBTable/CDS Reference `[XSC]`:**
  `INT`, `DAYDATE`, `SECONDTIME`, `LONGDATE`, `BINARY`, `ST_POINT`, `ST_GEOMETRY`, `BINTEXT`, `CHAR`, `NCHAR`, `BOOLEAN`

### 3.4 `constant.language.<lang>` & `constant.other.enum.<lang>`

- **`constant.language.boolean.<lang>` `[XSC]` `[HDI]`:** `true`, `false`
- **`constant.language.json.<lang>` `[XSC]` `[HDI]`:** `true`, `false`, `null`
- **`constant.other.enum.hdbtable` `[XSC]`:**
  - `TableType`: `COLUMNSTORE`, `ROWSTORE`
  - `TableLoggingType`: `LOGGING`, `NOLOGGING`
  - `IndexType`: `B_TREE`, `CPB_TREE`, `CPBTREE`
  - `Order`: `ASC`, `DSC`, `DESC`

---

## 4. Embedded Language Injections

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/005_3_Creating_the_Persistence_Model_with_HDBTable.md (Pages 37–41, 45–48)

### 4.1 Embedded SQL inside `.hdbview` (`query = "..."`) and `.hdbsequence` (`reset_by = "..."`) `[XSC]`

| Host Scope | Injection Trigger (Begin) | Injection End | Content Name | Escaped Identifiers Inside Injection |
| :--- | :--- | :--- | :--- | :--- |
| `source.hdbview` | `\b(query)\b\s*(=)\s*(")` | `(")` | `meta.embedded.block.sql.hdbview` | `\"...\"` $\rightarrow$ `variable.other.quoted-identifier.hanasql` |
| `source.hdbsequence` | `\b(reset_by)\b\s*(=)\s*(")` | `(")` | `meta.embedded.block.sql.hdbsequence` | `\"...\"` $\rightarrow$ `variable.other.quoted-identifier.hanasql` |

- The KV string ends at the first unescaped `"`. That quote also ends every multi-line SQL region opened inside it (escaped identifier, block comment, `HIERARCHY*( ... )` call, parentheses). Each such region has `(?="|...)` in its `end`, so an unclosed `(` or `/*` cannot run past the string into the next `key = value;` line.
- Inside `meta.embedded.block.sql.<lang>` (repository item `#embedded-sql`), in this order:

| # | Pattern | Scope / Include | Notes |
| :--- | :--- | :--- | :--- |
| 1 | `--(?:[^"\\]\|\\.)*` | `comment.line.double-dash.hanasql` | SQL line comment. Ends at the end of the line or before the closing `"` |
| 2 | begin `/\*`, end `\*/` or `(?=")` | `comment.block.hanasql` | SQL block comment, may span lines |
| 3 | begin `\\"`, end `\\"` or `(?=")` | `variable.other.quoted-identifier.hanasql` | Escaped delimited identifier (`\"MY_TABLE\"`), may span lines |
| 4 | `\\.` | `constant.character.escape.<lang>` | KV escapes `\n`, `\t`, `\r`, `\\` |
| 5 | `source.hanasql#strings`, `#statements`, `#clause-phrases` | (included) | Statement heads, hierarchy clause phrases (`SIBLING ORDER BY`, `START WHERE`), and the context phrases of `sql-sqlscript.md` §3.4 |
| 6 | begin `HIERARCHY*\s*(`, end `\)` or `(?=")` | function scope on the name | Same words as `source.hanasql#hierarchy-call` (`sql-sqlscript.md` §3.4), with balanced `(...)` inside |
| 7 | `source.hanasql#numbers`, `#sqlscript-variables`, `#functions`, `#sqlscript-builtins`, `#types`, `#constants`, `#logical-operators`, `#keywords`, `#operators` | (included) | |

- **KV escapes before keywords:** every `source.hanasql` word rule starts with `(?:\b|(?<=\\[nrt]))` instead of `\b`, so `SELECT \"A\"\nFROM T` still highlights `FROM` after the `\n` escape. Outside strings a backslash is never valid SQL, so this boundary does not change `.sql` highlighting.

### 4.3 Embedded SQL & Value Diagnostics `[XSC]`

> Source: `docs/specs/diagnostics/syntax-rules.md` (`HANA-SYN-001`, `HANA-SYN-003`, `HANA-SYN-022`, `HANA-SYN-023`)

- **Unescaping:** the value of `query = "..."` (`.hdbview`) and `reset_by = "..."` (`.hdbsequence`) is unescaped with the `EscapedChar` rules of §5 (`\"` -> `"`, `\\` -> `\`, `\/` -> `/`, `\n` / `\r` / `\t` / `\b` / `\f`). An unknown escape (`\x`) is kept as written. Every SQL character keeps the document offset it came from (`src/analyzer/kv-embedded-sql.ts`).
- **Checks:** the SQL is analyzed like a `.sql` document (lexical, delimiter, clause and consuming-parser rules; security and performance rules in `analyzeDocument`). Spans and QuickFix edits map back to the KV document; replacement text is re-escaped (`"` -> `\"`, `\` -> `\\`).
- **Line rule:** only these SQL values may span lines. Any other `"..."` value that runs into a following `<key> =` line has lost its closing quote and is cut at its line.
- **Unescaped quote:** a SQL value whose closing quote is followed on the same line by anything but `;` or a `<key> =` contains an unescaped `"` (`query = "SELECT "ID" FROM T";`). It is reported and not analyzed as SQL.
- **Values:** strings are double-quoted (`'...'` is an error with a QuickFix); values are never parenthesized; adjacent strings or numbers of one value list need a `,` (`depends_on = "a", "b";`); numbers are single tokens (`[1, 2]`, `-1.5`); a `;` directly inside `[ ... ]` ends the entry, so an unclosed `[` does not swallow the next keys.

### 4.2 Full-File Fallback Injection (`source.hanasql`) for Dual-Mode Extensions `[XSA]` `[HDI]` `[CLOUD]`

- `.hdbtable`, `.hdbview`, and `.hdbsequence` include `{ "include": "source.hanasql" }` as the final top-level pattern so HDI headerless DDL (`COLUMN TABLE "..."`, `ROW TABLE "..."`, `VIEW "..." AS SELECT ...`, `SEQUENCE "..."`) is highlighted with full SAP HANA SQL grammar rules.

---

## 5. Complete EBNF / BNF Productions

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/005_3_Creating_the_Persistence_Model_with_HDBTable.md (Pages 19–63)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 299–341)

```ebnf
(* ====================================================================== *)
(* 1. Common Lexical Elements [XSC, HDI]                                  *)
(* ====================================================================== *)
Comment            ::= LineComment | BlockComment ;
LineComment        ::= "//" { ? any character except newline ? } ( "\n" | "\r\n" ) ;
BlockComment       ::= "/*" { ? any character ? } "*/" ;

Identifier         ::= ( Letter | "_" ) { Letter | Digit | "_" } ;
StringLiteral      ::= '"' { EscapedChar | ? any char except '"' ? } '"' ;
EscapedChar        ::= "\" ( '"' | "\" | "/" | "b" | "f" | "n" | "r" | "t" ) ;
IntegerLiteral     ::= [ "+" | "-" ] Digit { Digit } ;
BooleanLiteral     ::= "true" | "false" ;
StringList         ::= "[" [ StringLiteral { "," StringLiteral } ] "]" ;

(* ====================================================================== *)
(* 2. .hdbtable & .hdbstructure [XSC]                                     *)
(* ====================================================================== *)
HdbTableFile       ::= { TableStatement } ;
TableStatement     ::= "table" "." TableProperty "=" PropertyValue ";" ;

TableProperty      ::= "schemaName" | "SchemaName"
                     | "tableType"                  (* [XSC] .hdbtable only *)
                     | "temporary"                  (* [XSC] .hdbtable only *)
                     | "public"
                     | "loggingType"                (* [XSC] .hdbtable only *)
                     | "tableLoggingType"           (* [XSC] .hdbtable only *)
                     | "description"                (* [XSC] .hdbtable only *)
                     | "columns"
                     | "indexes"                    (* [XSC] .hdbtable only *)
                     | "primaryKey" [ "." ( "pkcolumns" | "indexType" ) ] ;

PropertyValue      ::= StringLiteral
                     | BooleanLiteral
                     | IntegerLiteral
                     | EnumConstant
                     | ColumnList
                     | IndexList
                     | PrimaryKeyObject
                     | StringList ;

ColumnList         ::= "[" [ ColumnDef { "," ColumnDef } ] "]" ;
ColumnDef          ::= "{" { ColumnAssignment } "}" ;
ColumnAssignment   ::= ColumnKey "=" ( StringLiteral | BooleanLiteral | IntegerLiteral | SqlDataType ) ";" ;
ColumnKey          ::= "name" | "sqlType" | "nullable" | "unique"
                     | "length" | "precision" | "scale" | "defaultValue" | "comment" ;

IndexList          ::= "[" [ IndexDef { "," IndexDef } ] "]" ;
IndexDef           ::= "{" { IndexAssignment } "}" ;
IndexAssignment    ::= IndexKey "=" ( StringLiteral | BooleanLiteral | OrderEnum | IndexTypeEnum | StringList ) ";" ;
IndexKey           ::= "name" | "unique" | "order" | "indexType" | "indexColumns" ;

PrimaryKeyObject   ::= "{" { PrimaryKeyField } "}" ;
PrimaryKeyField    ::= ( "pkcolumns" "=" StringList ";" )
                     | ( "indexType" "=" IndexTypeEnum ";" ) ;

EnumConstant       ::= TableTypeEnum | LoggingTypeEnum | SqlDataType | IndexTypeEnum | OrderEnum ;
TableTypeEnum      ::= "COLUMNSTORE" | "ROWSTORE" ;
LoggingTypeEnum    ::= "LOGGING" | "NOLOGGING" ;
IndexTypeEnum      ::= "B_TREE" | "CPB_TREE" | "CPBTREE" ;
OrderEnum          ::= "ASC" | "DSC" | "DESC" ;

SqlDataType        ::= "VARCHAR" | "NVARCHAR" | "ALPHANUM" | "SHORTTEXT"
                     | "INT" | "INTEGER" | "TINYINT" | "SMALLINT" | "BIGINT"
                     | "DECIMAL" | "SMALLDECIMAL" | "REAL" | "DOUBLE" | "FLOAT"
                     | "DATE" | "TIME" | "SECONDDATE" | "TIMESTAMP"
                     | "DAYDATE" | "SECONDTIME" | "LONGDATE"
                     | "BLOB" | "CLOB" | "NCLOB" | "TEXT" | "BINTEXT"
                     | "VARBINARY" | "BINARY" | "CHAR" | "NCHAR" | "BOOLEAN"
                     | "ST_POINT" | "ST_GEOMETRY" ;

(* ====================================================================== *)
(* 3. .hdbview [XSC]                                                      *)
(* ====================================================================== *)
HdbViewFile        ::= { ViewStatement } ;
ViewStatement      ::= ( "schema" "=" StringLiteral [ ";" ] )
                     | ( "query" "=" EmbeddedSqlString [ ";" ] )
                     | ( "public" "=" BooleanLiteral [ ";" ] )
                     | ( ( "depends_on" | "depends_on_table" | "depends_on_view" ) "=" ( StringList | StringLiteral ) [ ";" ] ) ;

EmbeddedSqlString  ::= '"' (* Injected source.hanasql (§4.1) with \" escaped identifiers and \n \t \r escapes *) '"' ;

(* ====================================================================== *)
(* 4. .hdbsequence [XSC]                                                  *)
(* ====================================================================== *)
HdbSequenceFile    ::= { SequenceStatement } ;
SequenceStatement  ::= ( "schema" "=" StringLiteral [ ";" ] )
                     | ( ( "increment_by" | "start_with" | "maxvalue" | "minvalue" ) "=" IntegerLiteral [ ";" ] )
                     | ( ( "nomaxvalue" | "nominvalue" | "cycles" | "public" ) "=" BooleanLiteral [ ";" ] )
                     | ( "reset_by" "=" EmbeddedSqlString [ ";" ] )
                     | ( ( "depends_on" | "depends_on_table" | "depends_on_view" ) "=" ( StringList | StringLiteral ) [ ";" ] ) ;

(* ====================================================================== *)
(* 5. .hdbschema [XSC]                                                    *)
(* ====================================================================== *)
HdbSchemaFile      ::= "schema_name" "=" StringLiteral ";" ;

(* ====================================================================== *)
(* 6. .hdbti [XSC]                                                        *)
(* ====================================================================== *)
HdbTiFile          ::= "import" "=" "[" [ ImportBlock { "," ImportBlock } ] "]" ";" ;
ImportBlock        ::= "{" { ImportProperty } "}" ;
ImportProperty     ::= ( ( "table" | "hdbtable" | "cdstable" | "schema" | "file" | "delimField" | "delimEnclosing" ) "=" StringLiteral ";" )
                     | ( ( "header" | "useHeaderNames" | "distinguishEmptyFromNull" ) "=" BooleanLiteral ";" )
                     | ( "keys" "=" "[" [ KeyValueFilter { "," KeyValueFilter } ] "]" ";" ) ;
KeyValueFilter     ::= StringLiteral ":" StringLiteral ;

(* ====================================================================== *)
(* 7. .hdbsynonym / .hdbsynonymconfig / .hdbpublicsynonym /               *)
(*    .hdbsysbicsynonym [XSC, XSA, HDI, CLOUD]                            *)
(* ====================================================================== *)
HdbSynonymFile     ::= "{" [ SynonymEntry { "," SynonymEntry } ] "}" ;
SynonymEntry       ::= StringLiteral ":" "{" [ SynonymBody ] "}" ;
SynonymBody        ::= SynonymProp { "," SynonymProp } ;
SynonymProp        ::= ( '"target"' ":" "{" TargetProps "}" )
                     | ( '"schema"' ":" StringLiteral ) ;          (* [XSC] only *)
TargetProps        ::= TargetProp { "," TargetProp } ;
TargetProp         ::= ( '"object"' ":" StringLiteral )
                     | ( '"schema"' ":" StringLiteral )
                     | ( '"package"' ":" StringLiteral )           (* [XSC] legacy *)
                     | ( '"database"' ":" StringLiteral )          (* [HDI] only *)
                     | ( '"remote"' ":" StringLiteral )            (* [HDI] only *)
                     | ( '"logical_schema"' ":" StringLiteral )    (* [HDI] only *)
                     | ( '"revalidate"' ":" BooleanLiteral ) ;     (* [HDI] only *)
```

---

## 6. Canonical Formatting Rules (Phase 2)

1. **Key-Value vs. HDI Headerless DDL Disambiguation:**
   - If the first non-comment token sequence matches `Identifier { "." Identifier } "="` (`table.schemaName =`, `schema =`, `import =`, `schema_name =`), the document is parsed as an `[XSC]` Key-Value artifact.
   - Otherwise, if the document starts with DDL keywords (`COLUMN TABLE`, `ROW TABLE`, `VIEW`, `SEQUENCE`), it is parsed and formatted as `[HDI]` Headerless SQL DDL.
2. **Block Openers & Closers:**
   - `[` and `{` increase indentation by `+1` level when multi-line.
   - `]` and `}` decrease indentation by `-1` level.
3. **Mandatory Line-Break & Alignment Rules:**
   - Top-level `key = value;` statements appear one per line at indent level `0`.
   - Each struct object `{ ... }` in `table.columns`, `table.indexes`, or `import` starts on a new line at indent level `+1`, with its inner `field = value;` properties either aligned on single lines or indented at level `+2`.
4. **Statement Termination & Semicolon Safety:**
   - Every `[XSC]` key-value assignment (including `table.columns = [...];` and inner struct fields `name = "Col1";`) ends with `;`.
   - Struct items inside `[ ... ]` are separated by `,` (not `;`).
   - Embedded SQL strings inside `query = "..."` and `reset_by = "..."` must preserve `\"` escaping on double-quoted SQL identifiers.
