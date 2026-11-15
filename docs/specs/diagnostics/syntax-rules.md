# Offline Syntax Error Diagnostics Specification (`HANA-SYN-*`)

**Status:** Draft (Pass 3 — Syntax Diagnostics)
**Target Platforms:** `[XSC]`, `[XSA]`, `[HDI]`, `[CLOUD]`
**Master Switch:** `hanasql.analyze.syntax` (boolean, default `true`)
**Suppression Support:** Inline `-- hanasql-analyze-disable [RULE_ID]` / `// hanasql-analyze-disable` / `/* hanasql-analyze-disable */`, `@AnalyzerSuppress(...)`, and `hanasql-analyze-disable-file`

---

## 1. Design Principles

1. **Zero False Positives Across Valid HANA Dialects:** Rules honor platform-specific syntax rules documented across the repository specs (`sql-sqlscript.md`, `json-formatting.md`, `hdb-classic-kv.md`, `cds.md`), including multiline SQL single-quoted strings `'...'`, JSONC comments (`//`, `/* */`), headerless HDI DDL root objects, SQL `CASE ... END` inside procedures, `.xssqlcc` omitted commas, `.hdbview` trailing statements without `;`, and `.hdbmigrationtable` `== version=...` section markers.
2. **Never Mask Format-Off Regions:** Formatting pragmas (`-- hanasql-format off` ... `-- hanasql-format on`) disable **formatting only**, not syntax checking. Lexers scan inside format-off regions identically to active regions.
3. **Resilient Recovery:** Syntax errors must never abort downstream semantic rules (security, performance, migration) when partial ASTs can still be recovered (especially in `json-parser.ts`).
4. **Anchored Keyword Spellchecks:** Typo diagnostics trigger **only** at unambiguous declaration/statement anchor positions (never inside identifier positions such as `SELECT FUNC FROM MY_TABLE`), eliminating false positives on domain column/table names.

---

## 2. Rule Index

| Rule ID | Severity | Category | Target Languages / Extensions | Platform Scope | Summary |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `HANA-SYN-001` | `error` | `syntax` | SQL, SQLScript, CDS, Classic KV, `.xsodata`, Classic `.hdbrole`, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Unterminated string literal, quoted identifier, or CDS expression bracket (`![...]`) |
| `HANA-SYN-002` | `error` | `syntax` | SQL, SQLScript, CDS, Classic KV, `.xsodata`, Classic `.hdbrole`, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Unterminated block comment (`/* ... */`) |
| `HANA-SYN-003` | `error` | `syntax` | SQL, SQLScript, CDS, Classic KV, `.xsodata`, Classic `.hdbrole`, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Unmatched or unclosed delimiter (`( )`, `[ ]`, `{ }`) |
| `HANA-SYN-010` | `error` | `syntax` | All 28 JSON / JSONC artifact languages + HDI JSON `.hdbrole` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | JSON / JSONC syntax error (missing colon, missing comma, unexpected token, unclosed string/comment/container) |
| `HANA-SYN-011` | `error` | `syntax` | All 28 JSON / JSONC artifact languages + HDI JSON `.hdbrole` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Trailing comma in JSON / JSONC object or array (with QuickFix) |
| `HANA-SYN-020` | `error` | `syntax` | SQL, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbtrigger`, `.hdbmigrationtable`, `.procedure`, `.sqlscript` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Unmatched, mismatched, or unclosed SQLScript compound block (`BEGIN..END`, `IF..END IF`, `FOR..END FOR`, `LOOP..END LOOP`, `WHILE..END WHILE`, `CASE..END`) |
| `HANA-SYN-021` | `error` | `syntax` | SQL, SQLScript, headerless HDI DDL (`hdbtable`, `hdbview`, `hdbfunction`, `hdbprocedure`, etc.), CDS (`hdbdd`, `hdbcds`) | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Misspelled declaration header or SQL clause keyword (e.g., `CREATE FUNC`, `RETUNS`, `LANUAGE`, `INVOKR`, `SELCT`, `WHRE`, `ENTIY`) with QuickFix |
| `HANA-SYN-022` | `error` | `syntax` | Classic KV (`.hdbtable`, `.hdbview`, `.hdbti`, `.hdbschema`, `.hdbsequence`, `.hdbstructure`, `.hdbprocedure` KV, etc.) | `[XSC]` | Malformed Classic Key-Value assignment (missing `=`, missing RHS value, or missing `,` in `[ ... ]` array) |
| `HANA-SYN-023` | `error` | `syntax` | SQL, SQLScript, HDI DDL, Classic KV (`[...]`), `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Missing `,` separator between parameters, table columns, `SELECT` list items, function arguments, or array elements (with QuickFix) |
| `HANA-SYN-024` | `error` | `syntax` | SQL, SQLScript, HDI DDL, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Missing, dangling, or consecutive operator in SQL expressions, or trailing `,` before `)` / clause keyword (with QuickFix) |
| `HANA-SYN-025` | `error` | `syntax` | SQL, SQLScript, HDI DDL, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Incomplete/empty SQL clause (`SELECT FROM`, `WHERE AND`) or missing `;` between SQLScript statements inside `BEGIN ... END` (with QuickFix) |
| `HANA-SYN-026` | `error` | `syntax` | CDS (`.hdbdd`, `.hdbcds`) | `[XSC]` `[XSA]` `[HDI]` | Missing `:`, missing type, or missing `;` in CDS `entity`/`type` members and top-level `namespace`/`using` headers |
| `HANA-SYN-027` | `error` | `syntax` | SQL, SQLScript, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbtrigger`, `.hdbview`, `.hdblibrary`, `.hdbprojectionview`, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Out-of-order or duplicate `SELECT` query clause (`FROM`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `OFFSET`, `INTO`, `WITH HINT`) |
| `HANA-SYN-030` | `error` | `syntax` | `.xsjs`, `.xsjslib` | `[XSC]` `[XSA]` | Unterminated JS string literal (`'...'`, `"..."`), template literal (`` `...` ``), line regex literal, or block comment (`/* ... */`) |
| `HANA-SYN-031` | `error` | `syntax` | `.xsjs`, `.xsjslib` | `[XSC]` `[XSA]` | Unmatched or unclosed JS delimiter (`( )`, `[ ]`, `{ }`, template `${ }`) |
| `HANA-SYN-032` | `error` | `syntax` | `.xsjs`, `.xsjslib` | `[XSC]` `[XSA]` | Misspelled JS statement or declaration keyword at anchored token boundary (e.g., `FUNC foo()`) with QuickFix |
| `HANA-SYN-033` | `error` | `syntax` | `.xsjs`, `.xsjslib` | `[XSC]` `[XSA]` | Missing `,` separator in JS `[...]` array literal or call argument list `(a b)` (with QuickFix) |
| `HANA-SYN-034` | `error` | `syntax` | `.xsjs`, `.xsjslib` | `[XSC]` `[XSA]` | Missing, dangling, or consecutive binary operator in JS expressions |

---

## 3. Detailed Rule Specifications

### `HANA-SYN-001` — Unterminated String, Quoted Identifier, or CDS Expression
- **Severity:** `error`
- **Target Extensions:** All SQL / SQLScript languages, CDS (`.hdbdd`, `.hdbcds`), Classic KV (`.hdbtable`, `.hdbview`, `.hdbti`, `.hdbschema`, `.hdbsequence`, `.hdbstructure`, `.hdbtid`, `.hdbtim`, `.xshttpdest`), `.xsodata`, Classic `.hdbrole`, `.hdbmigrationtable`.
- **Lexical Trigger:**
  - Single-quoted string `'...'` reaching EOF without a closing unescaped `'`.
    - Escaping rule: in SQL/SQLScript/CDS/XSODATA, `''` (and `\'` when applicable in KV/CDS) escapes an interior quote; multiline `'...'` strings are valid in SQL/SQLScript/HDI DDL. In Classic KV strings inside `schemaName = "..."`, `\"` and `\\` are backslash escapes.
  - Double-quoted identifier `"..."` reaching unescaped newline (`\r`/`\n`) or EOF without a closing `"` in SQL/SQLScript, CDS, `.xsodata`, and Classic `.hdbrole` (Classic KV `"..."` retains multiline allowance for embedded `query`/`sql` SQL blocks).
    - **Same-Line Quote-Chain Localization:** When a missing opening or closing `"` causes parity inversion with a sibling quoted identifier on the same line (e.g., `"NAME AS "ITEM_NAME",` or `NAME" AS "ITEM_NAME",`), the tokenizer stops at EOL so downstream lines stay intact, and diagnostic span resolution walks backward across the zero-whitespace word/identifier chain (`wsBefore === false`) on that line to highlight the exact broken identifier token instead of blaming a distant identifier lines below.
  - CDS raw SQL expression bracket `![...]` reaching EOF without matching `]`.
- **Diagnostic Span & Message:** Spans the broken identifier / unclosed token head on the offending line; message: `"Unterminated string literal."`, `"Unterminated quoted identifier."`, or `"Unterminated CDS expression literal '![...]'."`
- **Platform Notes:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` Apply identically; `.hdbmigrationtable` splits sections at `^\s*==\s*(?:version|dev-version|migration)\s*=` before scanning each SQL section independently.

### `HANA-SYN-002` — Unterminated Block Comment
- **Severity:** `error`
- **Target Extensions:** Same as `HANA-SYN-001`.
- **Lexical Trigger:** An opening `/*` token not inside a string literal or line comment (`--` / `//`) reaches EOF before encountering `*/`.
- **Diagnostic Span & Message:** Spans the opening `/*` (`2` chars); message: `"Unterminated block comment '/*'."`

### `HANA-SYN-003` — Unmatched or Unclosed Delimiter
- **Severity:** `error`
- **Target Extensions:** Same as `HANA-SYN-001`.
- **Lexical Trigger:** While scanning non-comment, non-string tokens in order:
  - Fast path validates `( )`, `[ ]`, and `{ }` strictly in O(N). When an imbalance or mismatch occurs:
    - **Statement & Boundary Fencing:** SQL/SQLScript treats statement `;` as a hard delimiter fence so an unclosed `(` or `[` in one statement never pairs with a `)` or `]` in a later statement. Inline SQL data-type dimension openers (`DECIMAL(`, `NVARCHAR(`, etc.) also penalize pairing across incompatible parameter/clause boundaries (`IN`/`OUT`/`INOUT`/`RETURNS`).
    - **Indentation- & Nesting-Aware Blame Localization:** Collapses same-line tight pairs first, then runs minimum-cost non-crossing bracket alignment across the unbalanced region using line indentation and opener/closer line-boundary symmetry (`O.isLineEnd` / `C.isLineStart`). Removing an inner `)` or `(` inside an outer pair (e.g. `DECIMAL(3, 2` or `DECIMAL3, 2)` inside `FUNCTION ... (\n    ...\n)`) pairs the outer `(`..`)` at matching indent `0` and pinpoints the exact inner missing bracket instead of falsely blaming the outer declaration line `1` or closing line `4`.
    - **Resilient Recovery:** Resolved unclosed/unmatched delimiter offsets are excluded from downstream paren depth tracking (`HANA-SYN-023`) so one missing bracket does not cascade bogus missing-comma diagnostics across subsequent declarations.
    - Exception: `#[...]` attribute annotations in SQLScript and `[0..*]`/`[1..1]` multiplicity in CDS use balanced `[` and `]` and pass cleanly.
- **Diagnostic Span & Message:**
  - Stray/mismatched closer: `"Unexpected closing delimiter ')'. Expected ']'."` or `"Unmatched closing delimiter ')'."`
  - Unclosed opener: `"Unclosed delimiter '('."`

---

### `HANA-SYN-010` — JSON / JSONC Syntax Error
- **Severity:** `error`
- **Target Extensions:** `.xsaccess`, `.xsapp`, `.xsprivileges`, `.xssqlcc`, `.xsjsjob`, `.hdbgrants`, `.hdbsynonym`, `.hdbsynonymconfig`, `.hdblogicalschema`, `.hdbanalyticprivilege`, `.hdbconfig`, `.hdbhadoopmrjob`, `.hdbflowgraph`, `.hdbreptask`, `.hdbtask`, `.hdbtaskplan`, `.hdbsysauth`, `.hdbroleconfig`, `.hdbsearchruleset`, `.hdbcollection`, `.hdbcollectionindex`, `.hdbstatistics`, `.hdbresultcache`, `.hdbgraphworkspace`, `.hdbremote`, `.hdbvirtualtableconfig`, `.hdbtabledata`, `.hdblogicalschema`, `.hdbmigrationconfig`, `.hdbapplicationtime`, `.hdbsystemversioning`, `.hdbvirtualprocedureconfig`, `.hdbvirtualfunctionconfig`, `.hdbschedulerjob`, `.hdbprojectionviewconfig`, and HDI JSON `.hdbrole` (detected via leading `{`).
- **AST / Parser Trigger:** `parseJsonAstWithErrors(text, options)` records structured recovery errors without aborting the partial AST needed for `HANA-SEC-*`:
  - Empty / comment-only document (no root JSON value). Note: `.xsapp` marker files permit empty or whitespace-only content without emitting `HANA-SYN-010`.
  - Unterminated string `"..."` (reaches EOF or unescaped newline before closing `"`).
  - Unterminated `/* ... */` block comment.
  - Missing `:` after object property key.
  - Missing `,` between object properties or array elements (**disabled when `languageId === 'xssqlcc'`** per documented `.xssqlcc` tolerance in `docs/specs/artifacts/json-formatting.md`).
  - Unmatched or unclosed `{` / `}` / `[` / `]` (using indentation/nesting recovery when containers are unbalanced so a missing inner `}` or `]` inside nested JSON objects/arrays blames the inner unclosed container rather than the root `{`).
  - Single-quoted strings `'...'`, unquoted object keys, or invalid literal identifiers (`undefined`, `NaN`, etc.).
  - Trailing non-comment tokens after the root JSON value closes.

### `HANA-SYN-011` — Trailing Comma in JSON / JSONC
- **Severity:** `error`
- **Target Extensions:** Same as `HANA-SYN-010`.
- **AST / Parser Trigger:** A `,` immediately followed (skipping JSONC whitespace/comments) by `}` or `]`.
- **Diagnostic Message:** `"Trailing comma is not allowed in JSON artifacts."`
- **QuickFix (`Remove trailing comma`):** Deletes the comma character `,`.
  - **Before:** `{ "exposed": true, }`
  - **After:** `{ "exposed": true }`

---

### `HANA-SYN-020` — SQLScript Compound Block Mismatch
- **Severity:** `error`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbtrigger`, `.hdbmigrationtable` (per SQL section), `.procedure`, `.sqlscript`, `.hdbscalarfunction`.
- **AST / Token Trigger:** Tracks SQLScript compound control blocks across uncollapsed SQL tokens (ignoring string/quoted-ident/comment tokens and skipping non-SQL bodies declared with `LANGUAGE R`, `LANGUAGE RLANG`, or `LANGUAGE GRAPH`):
  - **Push:**
    - `BEGIN` (`BEGIN [SEQUENTIAL EXECUTION | PARALLEL EXECUTION | AUTONOMOUS TRANSACTION]`, all closed by `END`) — pushes `{ kind: 'BEGIN', start, end }`. Note: dynamic SQL `EXEC 'BEGIN ... END'` sits inside a string literal and is ignored.
    - `IF` (inside a compound body or at statement start, not preceded by `END` and not followed by `EXISTS`/`NOT EXISTS`, and containing `THEN` at `parenDepth === 0` before `;`/`BEGIN`/`END`) — pushes `{ kind: 'IF' }`. Guarantees zero false positives on `DROP TABLE IF EXISTS`, `CREATE TABLE IF NOT EXISTS`, or `ELSEIF` clauses.
    - `FOR` (statement start preceded by `;`/`BEGIN`/`THEN`/`ELSE`/`ELSEIF`/`DO`/`LOOP`/`:` and not `HANDLER` or `END`, containing `DO` at `parenDepth === 0` before `;`/`BEGIN`/`END`) — pushes `{ kind: 'FOR' }`. Excludes `DECLARE EXIT HANDLER FOR SQLEXCEPTION`, `SELECT ... FOR UPDATE`, `DECLARE CURSOR ... FOR SELECT`, and `TRIGGER ... FOR EACH ROW`.
    - `WHILE` (statement start with `DO` before `;`) -> closed by `END WHILE`.
    - `LOOP` (statement start inside compound body, not preceded by `END`) -> closed by `END LOOP`.
    - `CASE` (expression or statement not preceded by `END`) -> pushes `{ kind: 'CASE' }`, closed cleanly by either `END CASE` or bare `END`.
  - **Pop:**
    - `END IF` pops top `'IF'` (error if top is not `'IF'`).
    - `END FOR` pops top `'FOR'` (error if top is not `'FOR'`).
    - `END LOOP` pops top `'LOOP'` (error if top is not `'LOOP'`).
    - `END WHILE` pops top `'WHILE'` (error if top is not `'WHILE'`).
    - `END CASE` pops top `'CASE'` (error if top is not `'CASE'`).
    - Bare `END` pops top `'BEGIN'` or `'CASE'` (error if stack empty or top is `'IF'`/`'FOR'`/`'LOOP'`/`'WHILE'`).
  - **EOF Check:** Any unclosed entries remaining on the block stack emit `HANA-SYN-020`.
- **Diagnostic Examples:**
  - `Unexpected 'END' without matching 'BEGIN' or 'CASE'.`
  - `Expected 'END IF' before 'END' (unclosed 'IF' at line 4).`
  - `Unclosed 'BEGIN' block; missing 'END'.`

### `HANA-SYN-021` — Misspelled Declaration Header or SQL Clause Keyword
- **Severity:** `error`
- **Target Extensions:** All SQL / SQLScript languages, headerless HDI DDL artifacts, and CDS (`.hdbdd`, `.hdbcds`).
- **AST / Token Trigger:** Checked strictly at **anchored keyword positions** (Damerau-Levenshtein edit distance `<= 2`, same leading character or clear prefix truncation `len >= 4`, non-keyword unknown word, never matching a known SAP HANA keyword or column/table identifier position):
  1. Immediately following `CREATE`, `CREATE OR REPLACE`, `ALTER`, or `DROP` in SQL / SQLScript: expected object kind (`PROCEDURE`, `FUNCTION`, `TABLE`, `COLUMN`, `ROW`, `VIEW`, `TRIGGER`, `LIBRARY`, `SEQUENCE`, `INDEX`, `SCHEMA`, `SYNONYM`, `ROLE`, `USER`, `TYPE`, `COLLECTION`, `PROJECTION`, `STATISTICS`, `STRUCTURED`, `VIRTUAL`). E.g. `CREATE FUNC`, `CREATE OR REPLACE PROCEDUR`, `CREATE TABEL`.
  2. Document root / first statement token in headerless HDI artifacts (`.hdbtable`, `.hdbview`, `.hdbfunction`, `.hdbtablefunction`, `.hdbprocedure`, `.hdbtrigger`, `.hdblibrary`, `.hdbsequence`, `.hdbindex`, `.hdbconstraint`, `.hdbprojectionview`, `.hdbstructuredprivilege`, `.hdbvirtualtable`, etc.): checks leading token against expected HDI root keyword (`COLUMN`, `ROW`, `VIEW`, `FUNCTION`, `PROCEDURE`, `TRIGGER`, `LIBRARY`, `SEQUENCE`, `INDEX`, `CONSTRAINT`, `PROJECTION`, `STRUCTURED`, `VIRTUAL`, `TYPE`, etc.) — e.g. `FUNC "my_fn"()` -> QuickFix `FUNCTION`. Also skips if token is `@` annotation, comment, or valid KV syntax in dual-mode `.hdbview`/`.hdbtable`.
  3. Routine signature header keywords between parameter `)` and `AS`/`BEGIN`: `RETURNS` (`RETUNS`, or `RETURN` followed by `TABLE` in a `FUNCTION` header), `LANGUAGE` (`LANUAGE`, `LANGAUGE`), `SECURITY` (`SECURTY`), `INVOKER` (`INVOKR`), `DEFINER` (`DEFINR`).
  4. Top-level statement starts and unambiguous SQL query clause anchors:
     - Statement starts inside SQLScript body (`RETURN` -> `RETERN`, `DECLARE` -> `DECLRE`, `SIGNAL` -> `SIGNL`, `RESIGNAL`) ONLY when immediately at statement start and structurally invalid (not followed by `=` or identifier assignments like `col := ...`).
     - Query clause typos at structural boundaries (`SELECT` -> `SELCT`/`SELET`/`SLECT` at statement start or after `RETURN`/`UNION`/`(`; `WHERE` -> `WHRE`/`WHER` at line start or after `FROM <table_ref>`; `GROUP` -> `GROP` before `BY`; `ORDER` -> `ORDR` before `BY`; `HAVING` -> `HAVNG`; `LIMIT` -> `LIMT`).
  5. Top-level CDS declarations (`.hdbdd`, `.hdbcds`): anchored after optional `@Annotations` / `namespace ...;` / `using ...;` / statement start (`namespace`, `using`, `context`, `entity`, `type`, `view`, `annotate`, `extend`, `define`, `aspect`, `service`) — e.g. `entiy Customer {` -> QuickFix `entity`.
- **QuickFix (`Replace with '<KEYWORD>'`):** Single text replacement preserving capitalization convention (`UPPERCASE` for SQL/HDI DDL, `lowercase` for CDS keywords).
  - **Before:** `CREATE FUNC "MY_FN"() RETURNS INT AS BEGIN RETURN 1; END;`
  - **After:** `CREATE FUNCTION "MY_FN"() RETURNS INT AS BEGIN RETURN 1; END;`

### `HANA-SYN-022` — Malformed Classic Key-Value Artifact
- **Severity:** `error`
- **Target Extensions:** Classic XSC KV formats (`hdbtable`, `hdbview`, `hdbschema`, `hdbsequence`, `hdbstructure`, `hdbti`, `hdbtid`, `hdbtim`, `xshttpdest`, Classic KV `hdbprocedure`).
- **Lexical / Structural Trigger:** At top-level and inside `{ ... }` / `[ ... ]` KV blocks (excluding Classic KV string/comment payloads):
  - Statement/entry inside `{ ... }` or top-level (for Classic KV files) containing a key identifier not followed by `=` (note `.hdbti` `keys = ["COL": "VAL"]` uses `:` inside `[...]`, whereas object entries use `=`).
  - Assignment key `foo =` immediately followed by `;`, `}`, `]`, another `<key> =` assignment, or EOF without a RHS value.
  - Adjacent `[ ... ]` array elements without a separating `,` (also emitted as `HANA-SYN-023` when applicable).
- **Tolerances (`[XSC]`):**
  - `.hdbview` explicitly permits omitting trailing `;` after the final `public = false` property (`samples/xs-classic/MYVIEW.hdbview`, `samples/format-demos/classic-view.hdbview`) and comma-separated quoted lists after `=`. Never flag missing `;` in KV files!

### `HANA-SYN-023` — Missing Comma Separator (SQL / SQLScript / DDL / KV Arrays)
- **Severity:** `error`
- **Target Extensions:** SQL, SQLScript, HDI DDL (`.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbtable`, `.hdbview`, `.hdbtabletype`, `.hdbindex`, etc.), `.hdbmigrationtable`, Classic KV `[ ... ]` arrays.
- **AST / Token Trigger:** Emitted cleanly inside unambiguous comma-separated lists (when not already corrupted by an unclosed quote/comment on the same region):
  1. **Procedure / Function Parameters & Table Columns:** Inside `( ... )` parameter signatures (`PROCEDURE`, `FUNCTION`, `DO`), `RETURNS TABLE (...)`, `CREATE ... TABLE (...)`, `COLUMN TABLE (...)`, `ROW TABLE (...)`, and `CREATE TYPE ... AS TABLE (...)` when a subsequent `IN`/`OUT`/`INOUT` mode or `<columnName> <type>` follows without `,`.
  2. **`SELECT` Projection Lists:** Between `SELECT` and its clause terminator (`FROM`, `INTO`, `BULK`, `WHERE`, `GROUP`, `HAVING`, `ORDER`, `UNION`, `INTERSECT`, `EXCEPT`, `MINUS`, `WINDOW`, `LIMIT`, `OFFSET`, `FOR`, `WITH`, `OPTION`, `;`, `)`):
     - After explicit `AS <alias>` when the next token is neither `,` nor a clause terminator.
     - After `<expr> <implicitAlias>` when a 3rd adjacent item follows, or when `<implicitAlias>` is immediately followed by an expression continuation operator (`*`, `+`, `-`, `/`, `||`, `.`, `(`, `=`), or when a 2nd adjacent token is a non-alias expression start (`literal`, `:var`, `::sysvar`, `(`, `?`). Preserves valid SQL implicit column aliases (`SELECT col alias FROM t`), typed literals (`DATE '...'`, `INTERVAL '1' DAY`), `OVER (...)`, `FILTER (...)`, and `WITHIN GROUP (...)`.
  3. **Function Call Arguments, `VALUES`, `IN`, and `INSERT` Column Lists:** Adjacent operands without operators or `,` inside standard function calls `fn(a b)`, `VALUES (1 2)`, `IN (1 2)`, and `INSERT INTO tbl (a b)` (excluding special-syntax calls such as `CAST`, `EXTRACT`, `SUBSTRING`, `TRIM`, `OVER`, type dimensions except adjacent literals like `DECIMAL(3 2)`).
  4. **Classic KV Array Lists:** Adjacent elements inside `[ ... ]` (`.hdbtable`, `.hdbti`, etc.) lacking `,` (respecting `.hdbti` `["K":"V"]` colon pairs).
- **QuickFix (`Insert ','`):** Inserts `,` immediately after the preceding element token.

### `HANA-SYN-024` — Missing, Dangling, or Consecutive SQL Operator & Trailing Comma
- **Severity:** `error`
- **Target Extensions:** SQL, SQLScript, HDI DDL (`.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbtable`, `.hdbview`, `.hdbtabletype`, `.hdbindex`, etc.), `.hdbmigrationtable`.
- **Platform Scope:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
- **AST / Token Trigger:** Emitted inside SQL expression contexts (`SELECT` items, `WHERE`, `ON`, `HAVING`, `WHEN`, `THEN`, `ELSE`, `SET`, `VALUES`, `RETURN`, `:=`, and parenthesized scalar expressions `(...)`):
  1. **Missing Binary / Comparison / Logical Operator:**
     - Adjacent value operands without an operator inside `WHERE`, `ON`, `HAVING`, `WHEN`, `THEN`, `ELSE`, `SET`, `RETURN`, `:=`, or parenthesized scalar expressions `(...)` (e.g., `WHERE "PRICE" :im_min_price`, `AND "IS_ACTIVE" TRUE`, `(1.0 :im_tax_rate)`, `WHERE "PRICE" >= :im_min_price "IS_ACTIVE" = TRUE`).
     - Unqualified double-quoted column identifier `"COL"` (not schema/object-qualified via `.`, not containing `::`, and not preceded by DDL/DML target keywords) followed immediately by `(` inside an expression (e.g., `"PRICE" (1.0 + :im_tax_rate)`).
     - Preserves valid SQL predicates and multi-token constructs: `IS [NOT] NULL|TRUE|FALSE|UNKNOWN`, `[NOT] BETWEEN ... AND ...`, `[NOT] IN (...)`, `[NOT] LIKE ... [ESCAPE ...]`, `CASE ... WHEN ... THEN ... ELSE ... END`, typed literals (`DATE '...'`, `TIMESTAMP '...'`, `INTERVAL '...' UNIT`), `CAST(... AS ...)`, `EXTRACT(... FROM ...)`, `TRIM(... FROM ...)`, `SUBSTRING(... FROM ... FOR ...)`, `ANY`/`ALL`/`SOME`/`EXISTS`, `OVER (...)`, `WITHIN GROUP (...)`, `FILTER (...)`, `AT TIME ZONE ...`, `COLLATE ...`, `ASC`/`DESC`/`NULLS FIRST|LAST`.
  2. **Dangling / Leading Binary Operator:** Binary operator (`*`, `/`, `+`, `-`, `||`, `=`, `!=`, `<>`, `<`, `>`, `<=`, `>=`) at the end of an expression before `AS`, `,`, `;`, `)`, `END`, or a clause boundary (`FROM`, `WHERE`, `GROUP`, `ORDER`, `HAVING`, `LIMIT`, `UNION`, `AND`, `OR`, `WHEN`, `THEN`, `ELSE`), or non-unary operator (`*`, `/`, `||`, `=`, `!=`, `<>`, `<`, `>`, `<=`, `>=`) at expression start.
  3. **Consecutive Binary Operators:** Two incompatible binary operators side-by-side (`a * / b`, `a >= = b`, `a = = b`), excluding unary `+`, `-`, `NOT`, `PRIOR`, `NEW`, `BINARY`.
  4. **Trailing Comma (`QuickFix: Remove trailing comma`):** Comma immediately before closing `)` in SQL lists (`DECIMAL(3, 2,)`, `RETURNS TABLE ("A" INT,)`) or before major query clause keywords (`SELECT "A", FROM "T"`).

### `HANA-SYN-025` — Incomplete SQL Clause or Missing Statement Semicolon
- **Severity:** `error`
- **Target Extensions:** SQL, SQLScript, HDI DDL, `.hdbmigrationtable`.
- **Platform Scope:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
- **AST / Token Trigger:**
  1. **Incomplete / Empty SQL Clauses:** `SELECT` immediately followed by `FROM`/`WHERE`/`;` without a projection list (`SELECT FROM "T"`), `FROM` immediately followed by `WHERE`/`GROUP`/`HAVING`/`ORDER`/`;` without a table reference, or `WHERE` immediately followed by `AND`/`OR`/`GROUP`/`HAVING`/`ORDER`/`;`/`END` without a condition predicate.
  2. **Missing `;` Between Statements in `BEGIN ... END` (`QuickFix: Insert ';'`):** Inside `BEGIN ... END` compound blocks at `parenDepth === 0`, a complete SQL/SQLScript statement (`SELECT`, `RETURN`, `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, `MERGE`, `CALL`, `SET`, `OPEN`, `FETCH`, `CLOSE`, or `:=` assignment) followed on a subsequent line by a new statement starter (`RETURN`, `DECLARE`, `IF`, `WHILE`, `FOR`, `LOOP`, `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, `MERGE`, `CALL`, `EXEC`, `EXECUTE`, `SIGNAL`, `RESIGNAL`, `OPEN`, `FETCH`, `CLOSE`, `COMMIT`, `ROLLBACK`, or `<ident> :=`) without an intervening `;` or block-flow keyword (`BEGIN`, `THEN`, `ELSE`, `ELSEIF`, `DO`, `LOOP`, `WHEN`, `UNION`, `INTERSECT`, `EXCEPT`, `MINUS`).

### `HANA-SYN-026` — CDS Member & Header Structural Syntax (`.hdbdd` / `.hdbcds`)
- **Severity:** `error`
- **Target Extensions:** `.hdbdd`, `.hdbcds`
- **Platform Scope:** `[XSC]` `[XSA]` `[HDI]`
- **AST / Token Trigger:**
  1. **Header `;` Check:** Top-level `namespace ...` or `using ...` declaration missing terminating `;` before the next top-level keyword (`namespace`, `using`, `context`, `entity`, `type`, `view`, `annotate`, `extend`, `define`, `@Annotation`).
  2. **Entity / Type Field Declarations:** Inside `entity { ... }` or `type { ... }` (at member brace depth, excluding `view ... as select ...` and `technical configuration { ... }` blocks): field missing `:` before its type (`key ID Integer;`), `:` followed immediately by `;` / `}` (missing type), or missing `;` before the next field declaration on a following line.

### `HANA-SYN-027` — Out-of-Order or Duplicate `SELECT` Query Clause
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en/006_4_SQL_Reference.md (Pages 1130–1160)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md (Pages 44–50)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/033_pages_961_990.md (Pages 961–990)

- **Severity:** `error`
- **Target Extensions:** `.sql`, `.hanasql`, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbtrigger`, `.hdbview`, `.hdblibrary`, `.hdbprojectionview`, `.hdbmigrationtable`
- **Platform Scope:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
- **AST / Token Trigger:** Tracks active `SELECT` queries per `(parenDepth, bracketDepth)` nesting level against canonical SAP HANA query clause precedence:
  ```ebnf
  subquery_clause_order ::=
      "SELECT" [ pre_from_into ]
      "FROM"
      [ "WHERE" ]
      [ "GROUP BY" ]
      [ "HAVING" ]
      [ "WINDOW" ]
      [ ( "UNION" | "INTERSECT" | "EXCEPT" | "MINUS" ) ... ]
      [ "ORDER BY" ]
      [ "LIMIT" [ "OFFSET" ] ]
      [ "FOR UPDATE" | "FOR SHARE LOCK" | "FOR XML" | "FOR JSON" | post_subquery_into ]
      [ "WITH HINT" ] ;
  ```
  1. **Out-of-Order Clause:**
     - `WHERE`, `GROUP BY`, `HAVING`, `WINDOW`, `ORDER BY`, `LIMIT`, `OFFSET`, `FOR UPDATE`/`SHARE LOCK`/`XML`/`JSON`, or `WITH HINT` appearing before `FROM`.
     - `FROM` appearing after `WHERE`, `GROUP BY`, `HAVING`, `WINDOW`, `ORDER BY`, `LIMIT`, `OFFSET`, `FOR UPDATE`/`SHARE LOCK`/`XML`/`JSON`, or `WITH HINT`.
     - Any query-body clause (`WHERE`, `GROUP BY`, `HAVING`, `WINDOW`, `ORDER BY`, `LIMIT`) appearing out of canonical sequence (e.g., `ORDER BY` before `WHERE`, `GROUP BY` after `HAVING`, `ORDER BY` after `LIMIT`, `OFFSET` before `LIMIT`, or any query clause after post-`FROM` `INTO` / `FOR UPDATE` / `WITH HINT`).
     - `ORDER BY`, `LIMIT`, `FOR UPDATE`/`SHARE LOCK`/`XML`/`JSON`, or `WITH HINT` appearing directly before an unparenthesized set operator (`UNION`, `INTERSECT`, `EXCEPT`, `MINUS`).
  2. **Duplicate Non-Repeatable Clause:** Duplicate `INTO`, `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `WINDOW`, `ORDER BY` (SAP HANA SQL Error `398: ERR_SQL_MANY_ORDER_BY`), `LIMIT`, `OFFSET`, `FOR UPDATE`/`SHARE LOCK`/`XML`/`JSON`, or `WITH HINT` within the same query level and set-operator branch. (Set operators reset branch-local state `FROM`..`WINDOW` for the next branch's `SELECT`.)
  3. **False-Positive Exclusions:** Nested parenthesized subqueries `(SELECT ...)`, CTE headers `WITH cte AS (...)`, `OVER (... ORDER BY ...)`, `WITHIN GROUP (ORDER BY ...)`, `STRING_AGG`/`ARRAY_AGG` argument `ORDER BY`, `FILTER (WHERE ...)`, `EXTRACT`/`TRIM`/`SUBSTRING(... FROM ...)`, `IS [NOT] DISTINCT FROM`, temporal `FOR SYSTEM_TIME FROM ... TO ...`, `CASE ... WHEN ... THEN ... ELSE ... END`, and DDL `TRIGGER ... FOR EACH ROW` are isolated cleanly by paren depth and syntactic context.
- **Diagnostic Examples:**
  - `'WHERE' clause must appear after 'FROM' clause in SELECT query.`
  - `Unexpected 'WHERE' clause after 'ORDER BY' clause in SELECT query.`
  - `Duplicate 'WHERE' clause in SELECT query.`

---

### `HANA-SYN-030` — Unterminated JS Literal or Comment (`.xsjs` / `.xsjslib`)
- **Severity:** `error`
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **Platform Scope:** `[XSC]` `[XSA]`
- **Lexical Trigger:** Regex-aware JavaScript scanner tracks code state (preceding token context to distinguish regex `/pattern/flags` from division `/`):
  - Single-quoted `'...'` or double-quoted `"..."` string hitting an unescaped newline or EOF before matching closing quote.
  - Template literal `` `...` `` reaching EOF without closing backtick `` ` `` (correctly pushing/popping nested `${ ... }` brace expressions so braces, strings, and comments inside `${ ... }` do not falsely terminate the template!).
  - Regex literal `/.../` hitting an unescaped newline or EOF without closing `/`.
  - Block comment `/* ... */` reaching EOF without closing `*/`.

### `HANA-SYN-031` — Unmatched or Unclosed JS Delimiter (`.xsjs` / `.xsjslib`)
- **Severity:** `error`
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **Platform Scope:** `[XSC]` `[XSA]`
- **Lexical Trigger:** Matches `( )`, `[ ]`, `{ }`, and `${ ... }` pairs outside strings, regex literals, and comments using the same fencing and indentation-aware alignment recovery when unbalanced (treating `;` inside `[...]` or non-`for` `(...)` without an intervening `{` as a hard fence so unclosed `foo(1, 2;` does not steal outer closers, and ignoring resolved bad delimiters in `HANA-SYN-033`):
  - Unexpected/unmatched closing delimiter (`HANA-SYN-031`).
  - Unclosed opener or unclosed template interpolation `'${'` (`HANA-SYN-031`).

### `HANA-SYN-032` — Misspelled JS Statement / Declaration Keyword (`.xsjs` / `.xsjslib`)
- **Severity:** `error`
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **Platform Scope:** `[XSC]` `[XSA]`
- **AST / Token Trigger:** Strictly anchored JS token patterns (so normal variable/function names like `var func = 1;` never trigger!):
  - At statement start (after `;`, `{`, `}`, `(optional line start)`), an unknown identifier `W` directly followed by:
    - an identifier + `(` (without `.` / `=` / `:` in between), where `W` is within edit distance `<= 2` of `function` (e.g., `FUNC handleRequest()`, `functon process()`, `funtion helper()`), **OR**
    - `(` when `W` matches a common typo of `if`, `for`, `while`, `switch`, `catch` (only clear edit-distance-1/2 typos like `whlie`, `swich`, `ctach`, NEVER short valid 2-3 letter names that aren't control-flow keywords! Require minimum token length `>= 4` for edit distance matching, plus exact known shorthand typo `FUNC` / `func` before `<ident>(` -> `function`!), **OR**
    - a `{` block immediately after `W` where `W` is a typo of `else` (`esle {`, `els {`), `try` (`tyr {`), `finally` (`finaly {`, `finallly {`), **OR**
    - statement-start typo of `return` or `throw` (`retern`, `retrun`, `thrw`, `thro`) when followed by a return/throw operand or `;` (never when followed by assignment, postfix `++`/`--`, or indexing `[`).
- **QuickFix (`Replace with '<keyword>'`):** Replaces the misspelled token with the corrected lowercase JS keyword.
  - **Before:** `FUNC handleGet(req) { return $.net.http.OK; }`
  - **After:** `function handleGet(req) { return $.net.http.OK; }`

### `HANA-SYN-033` — Missing Comma Separator in JS Lists (`.xsjs` / `.xsjslib`)
- **Severity:** `error`
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **Platform Scope:** `[XSC]` `[XSA]`
- **AST / Token Trigger:** Adjacent value operands without a separating operator, `;`, or `,` inside `[ ... ]` array literals or non-`for` call/grouping parentheses `( ... )` (e.g. `JSON.stringify(a b)`, `[1 2]`).
- **QuickFix (`Insert ','`):** Inserts `,` after the preceding operand token.

### `HANA-SYN-034` — Missing, Dangling, or Consecutive JS Operator (`.xsjs` / `.xsjslib`)
- **Severity:** `error`
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **Platform Scope:** `[XSC]` `[XSA]`
- **AST / Token Trigger:**
  1. **Missing Binary Operator:** Adjacent value operands (`ident`, `number`, `string`, `template`) on the same line inside an expression (including `if (...)`, `while (...)`, `var x = ...`, `return ...`, not preceded by declaration/prefix keywords `function`, `var`, `let`, `const`, `new`, `typeof`, `delete`, `void`, `in`, `instanceof`, `return`, `case`, `throw`, `else`, `of`) without an intervening operator, `,`, `;`, or ternary `?`/`:`.
  2. **Dangling Binary Operator:** Binary operator (`*`, `/`, `%`, `===`, `!==`, `==`, `!=`, `<=`, `>=`, `<`, `>`, `&&`, `||`, `=`, `+=`, `-=`, `*=`, `/=`) immediately preceding `;`, `)`, `]`, `}`, or `,`.
  3. **Consecutive Binary Operators:** Two binary-only operators (`*`, `/`, `%`, `===`, `!==`, `==`, `!=`, `<=`, `>=`, `&&`, `||`, `=`) appearing consecutively (e.g. `a * / b`, `a >= = b`).
