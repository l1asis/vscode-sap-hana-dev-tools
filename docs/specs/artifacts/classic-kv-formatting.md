# Classic Key-Value Artifact AST & Canonical Formatting Specification (`classic-kv-formatting.md`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/004_2_Getting_Started_with_the_HDBTable_Syntax.md (Pages 4–17)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference_en/005_3_Creating_the_Persistence_Model_with_HDBTable.md (Pages 18–67)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference/016_Table_Configuration_Syntax.md (Pages 21–24)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference/021_Sequence_Configuration_Syntax.md (Pages 31–34)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference/024_SQL_View_Configuration_Syntax.md (Page 38)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_HDBTable_Syntax_Reference/031_Table-Import_Configuration-File_Syntax_(HDBtable).md (Pages 49–52)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/007_5_Setting_up_the_Data_Persistence_Model_in_SAP_HANA.md (Pages 204–205, 277–326)

---

## 1. Metadata Table

| Extension | Runtime | Repository / HDI Plugin | Minimum HANA Version | Dual-Mode Disambiguation |
| :--- | :--- | :--- | :--- | :--- |
| `.hdbtable` | `[XSC]` | `_SYS_REPO` HDBTable (`hdbtable`) | HANA 1.0 SPS 04+ | Classic KV when first non-comment tokens match `ident ('.' ident)* '='`; otherwise `[HDI]` SQL DDL (`com.sap.hana.di.table`). |
| `.hdbstructure` | `[XSC]` | `_SYS_REPO` HDBStructure | HANA 1.0 SPS 04+ | Classic KV (`table.*` subset); replaced by `.hdbtabletype` in `[HDI]`. |
| `.hdbview` | `[XSC]` | `_SYS_REPO` HDBView | HANA 1.0 SPS 04+ | Classic KV when first non-comment tokens match `ident ('.' ident)* '='`; otherwise `[HDI]` SQL DDL (`com.sap.hana.di.view`). |
| `.hdbsequence` | `[XSC]` | `_SYS_REPO` HDBSequence | HANA 1.0 SPS 04+ | Classic KV when first non-comment tokens match `ident ('.' ident)* '='`; otherwise `[HDI]` SQL DDL (`com.sap.hana.di.sequence`). |
| `.hdbschema` | `[XSC]` | `_SYS_REPO` HDBSchema | HANA 1.0 SPS 04+ | Always Classic KV (`schema_name = "...";`). |
| `.hdbti` | `[XSC]` | `_SYS_REPO` Table Import | HANA 1.0 SPS 05+ | Always Classic KV (`import = [ { ... } ];`); replaced by `.hdbtabledata` in `[HDI]`. |

---

## 2. Structural Format & AST Model

Classic XS repository persistence and import artifacts use a semicolon-terminated `key = value;` configuration syntax with C-style comments (`//`, `/* ... */`), double-quoted strings (`"..."` with `\` escapes and multi-line support), signed integers, lowercase booleans, uppercase enum identifiers, `[ ... ]` lists, `{ ... }` structs, and `"COL" : "VAL"` key-filter pairs (`.hdbti`).

### 2.1 AST Node Schema

```typescript
type KvTrivia = KvComment | KvRaw;

interface KvDocument {
  kind: 'document';
  items: KvTopItem[];
}

type KvTopItem = KvAssignment | KvComment | KvRaw | KvMalformed;

interface KvAssignment {
  kind: 'assignment';
  keyPath: string[];            // e.g. ['table', 'columns'] or ['schema']
  value: KvValue;
  hasSemi: boolean;             // tolerated if omitted on input, normalized to ';'
  leadingComments: KvTrivia[];
  trailingComment?: KvComment;
}

type KvValue =
  | { kind: 'string'; raw: string; inner: string }
  | { kind: 'number'; raw: string }
  | { kind: 'ident'; text: string }   // boolean (true|false) or enum (COLUMNSTORE, VARCHAR, ...)
  | { kind: 'array'; items: KvArrayItem[]; unclosed: boolean }
  | { kind: 'struct'; fields: KvStructMember[]; unclosed: boolean }
  | { kind: 'pair'; key: KvValue; value: KvValue } // .hdbti keys: "COL" : "VAL"
  | { kind: 'rawExpr'; text: string };             // malformed fallback
```

### 2.2 Complete Classic KV EBNF

```ebnf
KvDocument       ::= { TopLevelStmt } ;
TopLevelStmt     ::= KeyPath "=" PropertyValue [ ";" ] ;
KeyPath          ::= Identifier { "." Identifier } ;

PropertyValue    ::= StringLiteral
                   | NumberLiteral
                   | BooleanLiteral
                   | EnumIdentifier
                   | ArrayValue
                   | StructValue ;

ArrayValue       ::= "[" [ ArrayElement { "," ArrayElement } [ "," ] ] "]" ;
ArrayElement     ::= PairValue | PropertyValue ;
PairValue        ::= StringLiteral ":" StringLiteral ;

StructValue      ::= "{" { StructField } "}" ;
StructField      ::= KeyPath "=" PropertyValue [ ";" ] ;

(* Parser recovery tolerance for official SAP doc variants: *)
(* 1. Missing ';' on scalar assignments in .hdbview/.hdbsequence (e.g. public=false) *)
(* 2. Unbracketed comma-separated string list in .hdbview (depends_on = "a", "b";)  *)
```

---

## 3. Property & Key Schema

### 3.1 `.hdbtable` & `.hdbstructure` `[XSC]`

| Key Path | Value Type | Default | Applies To | Constraints & Notes |
| :--- | :--- | :--- | :--- | :--- |
| `table.schemaName` / `table.SchemaName` | `String` | Required | `.hdbtable`, `.hdbstructure` | Target catalog schema name (case-sensitive key). |
| `table.temporary` | `Boolean` | `false` | `.hdbtable` | Session-local temporary table. |
| `table.tableType` | `Enum` | `COLUMNSTORE` | `.hdbtable` | `COLUMNSTORE` \| `ROWSTORE`. |
| `table.public` | `Boolean` | `true` | `.hdbtable`, `.hdbstructure` | Public visibility. |
| `table.loggingType` / `table.tableLoggingType` | `Enum` | `LOGGING` | `.hdbtable` | `LOGGING` \| `NOLOGGING`. |
| `table.description` | `String` | — | `.hdbtable` | Optional table description. |
| `table.columns` | `Array<ColumnStruct>` | Required | `.hdbtable`, `.hdbstructure` | Fields: `name` (`String`), `sqlType` (`SqlDataType`), `nullable` (`Boolean`), `unique` (`Boolean`), `length` (`Integer`), `precision` (`Integer`), `scale` (`Integer`), `defaultValue` (`String`), `comment` (`String`). |
| `table.indexes` | `Array<IndexStruct>` | `[]` | `.hdbtable` | Fields: `name` (`String`), `unique` (`Boolean`), `order` (`ASC` \| `DSC` \| `DESC`), `indexType` (`B_TREE` \| `CPB_TREE` \| `CPBTREE`), `indexColumns` (`Array<String>`). |
| `table.primaryKey.pkcolumns` | `Array<String>` | `[]` | `.hdbtable`, `.hdbstructure` | Primary key column list (also valid via `table.primaryKey = { pkcolumns = [...]; indexType = ...; };`). |
| `table.primaryKey.indexType` | `Enum` | Auto | `.hdbtable`, `.hdbstructure` | `B_TREE` \| `CPB_TREE` \| `CPBTREE`. |

### 3.2 `.hdbview` `[XSC]`

| Key | Value Type | Default | Constraints & Notes |
| :--- | :--- | :--- | :--- |
| `schema` | `String` | Required | Target catalog schema. |
| `query` | `String` (Embedded SQL) | Required | SQL `SELECT` statement; double-quoted SQL identifiers escaped as `\"...\"`; must NOT carry a trailing `;`. |
| `public` | `Boolean` | `true` | Public visibility. |
| `depends_on` | `Array<String>` (or comma-separated `String`s) | `[]` | Repository object dependencies (`"pkg::obj"`). Replaces `depends_on_table` / `depends_on_view`. |
| `depends_on_table` | `Array<String>` \| `String` | `[]` | Legacy table dependency key. |
| `depends_on_view` | `Array<String>` \| `String` | `[]` | Legacy view dependency key. |

### 3.3 `.hdbsequence` `[XSC]`

| Key | Value Type | Default | Constraints & Notes |
| :--- | :--- | :--- | :--- |
| `schema` | `String` | Required | Target catalog schema. |
| `increment_by` | `Integer` | `1` | Non-zero signed integer. |
| `start_with` | `Integer` | `-1` | Initial sequence value. |
| `maxvalue` | `Integer` | — | Range `-4611686018427387903` .. `4611686018427387902`. |
| `nomaxvalue` | `Boolean` | `false` | Disables explicit upper bound. |
| `minvalue` | `Integer` | — | Range `-4611686018427387903` .. `4611686018427387902`. |
| `nominvalue` | `Boolean` | `false` | Disables explicit lower bound. |
| `cycles` | `Boolean` | `false` | Restarts sequence when bound reached. |
| `reset_by` | `String` (Embedded SQL) | — | SQL `SELECT` query executed on DB restart; `\"...\"` escaping; no trailing `;`. |
| `public` | `Boolean` | `false` | Public visibility. |
| `depends_on` / `depends_on_table` / `depends_on_view` | `Array<String>` \| `String` | `[]` | Target tables/views referenced by `reset_by`. |

### 3.4 `.hdbschema` & `.hdbti` `[XSC]`

| Artifact | Key | Value Type | Default | Constraints & Notes |
| :--- | :--- | :--- | :--- | :--- |
| `.hdbschema` | `schema_name` | `String` | Required | Must match `.hdbschema` file basename. |
| `.hdbti` | `import` | `Array<ImportStruct>` | Required | Top-level array of `{ ... }` import configuration blocks. |
| `.hdbti` (block) | `table` \| `cdstable` \| `hdbtable` | `String` | Required (one of) | Mutually exclusive target table reference (`table` requires `schema`). |
| `.hdbti` (block) | `schema` | `String` | — | Required when `table` is used; omitted for `hdbtable` / `cdstable`. |
| `.hdbti` (block) | `file` | `String` | Required | Repository CSV path (`"pkg.path:file.csv"`). |
| `.hdbti` (block) | `header` | `Boolean` | `false` | CSV contains a header row. |
| `.hdbti` (block) | `useHeaderNames` | `Boolean` | `false` | Match CSV header names to table columns (requires `header = true`). |
| `.hdbti` (block) | `delimField` | `String` | `","` | Field separator (`","` or `";"`). |
| `.hdbti` (block) | `delimEnclosing` | `String` | — | Single enclosing quote/delimiter char (e.g. `"\""` or `"#"`). |
| `.hdbti` (block) | `distinguishEmptyFromNull` | `Boolean` | `false` | Preserve empty enclosed strings instead of `NULL`. |
| `.hdbti` (block) | `keys` | `Array<Pair>` | `[]` | Filter pairs `[ "COL" : "VAL", ... ]`. |

---

## 4. Canonical Formatting Layout Rules

1. **Case Preservation:**
   - All Classic KV keys (`table.schemaName`, `sqlType`, `delimEnclosing`, `schema_name`), boolean literals (`true`, `false`), and enum values (`COLUMNSTORE`, `VARCHAR`, `B_TREE`, `DSC`) are case-sensitive in SAP HANA XS Classic and MUST preserve exact original casing.
2. **Key-Value Assignment Spacing:**
   - Normalize `keyPath = value;` with a single space before and after `=`, no spaces around `.` in `keyPath`, and no space before `;`.
   - Top-level assignments start at indent level `0`.
3. **Semicolon Placement & Tolerance:**
   - Every assignment (top-level and inside `{ ... }` structs) terminates with `;`.
   - On parse, tolerate missing `;` (such as `public=false` in SAP `.hdbview` examples) and recover at the next `key =` assignment or EOF, emitting the canonical `;` in formatted output.
   - Items inside `[ ... ]` arrays are separated by `,` (never `;`); trailing `,` before `]` is stripped.
4. **Array & Struct Indentation:**
   - **Scalar string arrays** (`["Col1", "Col2"]`): stay single-line without inner padding spaces (`["Col1", "Col2"]`) when fitting within `maxLineLength` and free of internal comments; wrap one item per line at `+1` indent with `[` on the opening line and `]` at parent indent when exceeding `maxLineLength` or containing comments.
   - **Key-value filter arrays** (`.hdbti` `keys = [ "GROUP_TYPE" : "BW_CUBE", ... ];`): format pairs as `"KEY" : "VAL"` with single space around `:`, single-line when fitting within `maxLineLength`, or wrapped one pair per line at `+1` indent.
   - **Struct arrays** (`table.columns`, `table.indexes`, `.hdbti` `import`):
     - Opening `[` stays on the `key = [` line; each `{ ... }` element starts on a new line at `+1` indent; closing `];` sits on its own line at the parent indent level.
     - Inside `table.columns` / `table.indexes`, a struct `{ name = "Col1"; sqlType = VARCHAR; ... }` stays single-line when free of internal comments, free of nested multi-line arrays, and fitting within `maxLineLength`; otherwise it expands with `{` on the opening line, each `field = value;` at `+2` indent (relative to top-level), and `}` at `+1` indent.
     - `.hdbti` `import` struct blocks always expand multi-line (fields at `+2` indent) for readability.
5. **Comment Preservation & Pragmas:**
   - Preserve `//` line comments and `/* ... */` block comments in their relative positions (leading comments before assignments/array items/struct fields, inline trailing comments on the same line).
   - Regions enclosed by `// hanasql-format off`, `-- hanasql-format off`, or `/* hanasql-format off` through the matching `hanasql-format on` pragma are emitted verbatim.
6. **Embedded SQL Formatting (`query = "..."` and `reset_by = "..."`):**
   - Unescape the string literal (`\"` $\rightarrow$ `"`, `\\` $\rightarrow$ `\`, `\n` $\rightarrow$ newline, `\r` $\rightarrow$ CR, `\t` $\rightarrow$ tab).
   - Format the inner SQL using the HANA SQL formatter with `trailingSemicolon: 'remove'` and `insertFinalNewline: false` (never append `;` inside `query` or `reset_by`).
   - Re-escape `\` $\rightarrow$ `\\` and `"` $\rightarrow$ `\"`.
   - If the formatted SQL is single-line and `key = "<sql>";` fits within `maxLineLength`, emit on a single line (`reset_by = "SELECT MAX(\"ID\") FROM \"T\"";`).
   - If the formatted SQL spans multiple lines, format with `initialLevel: 1` and wrap with newline delimiters inside the string literal so quotes, indentation, and trailing `--` comments remain 100% valid and idempotent:
     ```text
     query = "
         SELECT
             T1.\"Column2\"
         FROM \"MYSCHEMA\".\"acme.com.test.tables::MY_TABLE1\" AS T1
         WHERE T1.\"Col\" = '12'
         WITH READ ONLY
     ";
     ```

---

## 5. Valid & Malformed Recovery Examples

### Valid `.hdbtable` (Formatted)

```text
table.schemaName = "MYSCHEMA";
table.temporary = true;
table.tableType = COLUMNSTORE;
table.loggingType = NOLOGGING;
table.columns = [
    { name = "Col1"; sqlType = VARCHAR; nullable = false; length = 20; comment = "dummy comment"; },
    { name = "Col2"; sqlType = INTEGER; nullable = false; }
];
table.indexes = [
    { name = "MYINDEX1"; unique = true; order = DSC; indexColumns = ["Col2"]; }
];
table.primaryKey.pkcolumns = ["Col1", "Col2"];
```

### Tolerated `.hdbview` Input $\rightarrow$ Canonical Output

Input (SAP docs unbracketed list + missing semicolon):
```text
schema="MYSCHEMA";
public=false
query="select T1.\"Column2\" from \"MYSCHEMA\".\"T1\" as T1";
depends_on= "pkg::T1","pkg::V1";
```

Canonical Output:
```text
schema = "MYSCHEMA";
public = false;
query = "
    SELECT
        T1.\"Column2\"
    FROM \"MYSCHEMA\".\"T1\" AS T1
";
depends_on = ["pkg::T1", "pkg::V1"];
```
