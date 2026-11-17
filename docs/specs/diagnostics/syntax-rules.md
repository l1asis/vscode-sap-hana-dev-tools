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
| `HANA-SYN-004` | `error` / `warning` | `syntax` | Headerless HDI SQL DDL artifacts (`.hdbtable`, `.hdbview`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary`, `.hdbtrigger`, etc.) | `[XSA]` `[HDI]` `[CLOUD]` | Wrong root declaration keyword, redundant leading `CREATE`, invalid `CREATE` object kind, or extra trailing top-level statements in single-object artifact (with QuickFixes) |
| `HANA-SYN-005` | `error` | `syntax` | SQL, SQLScript, headerless HDI DDL, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Invalid SQL character, unsupported `//` comment, or unknown `@` pragma (with QuickFix) |
| `HANA-SYN-006` | `error` / `warning` | `syntax` | SQL, SQLScript, headerless HDI DDL, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Missing whitespace between adjacent tokens (`123abc`, `"T"alias`, `'s'AS`) or undelimited object name containing `::` (with QuickFix) |
| `HANA-SYN-010` | `error` | `syntax` | All 28 JSON / JSONC artifact languages + HDI JSON `.hdbrole` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | JSON / JSONC syntax error (missing colon, missing comma, unexpected token, unclosed string/comment/container) |
| `HANA-SYN-011` | `error` | `syntax` | All 28 JSON / JSONC artifact languages + HDI JSON `.hdbrole` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Trailing comma in JSON / JSONC object or array (with QuickFix) |
| `HANA-SYN-020` | `error` | `syntax` | SQL, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbtrigger`, `.hdbmigrationtable`, `.procedure`, `.sqlscript` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Unmatched, mismatched, or unclosed SQLScript compound block (`BEGIN..END`, `IF..END IF`, `FOR..END FOR`, `LOOP..END LOOP`, `WHILE..END WHILE`, `CASE..END`) |
| `HANA-SYN-021` | `error` | `syntax` | SQL, SQLScript, headerless HDI DDL (`hdbtable`, `hdbview`, `hdbfunction`, `hdbprocedure`, etc.), CDS (`hdbdd`, `hdbcds`) | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Misspelled declaration header or SQL clause keyword (e.g., `CREATE FUNC`, `RETUNS`, `LANUAGE`, `INVOKR`, `SELCT`, `WHRE`, `ENTIY`) with QuickFix |
| `HANA-SYN-022` | `error` | `syntax` | Classic KV (`.hdbtable`, `.hdbview`, `.hdbti`, `.hdbschema`, `.hdbsequence`, `.hdbstructure`, `.hdbprocedure` KV, etc.) | `[XSC]` | Malformed Classic Key-Value assignment (missing `=`, missing RHS value, or missing `,` in `[ ... ]` array) |
| `HANA-SYN-023` | `error` | `syntax` | SQL, SQLScript, HDI DDL, Classic KV (`[...]`), `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Missing `,` separator between parameters, table columns, `SELECT` list items, function arguments, or array elements (with QuickFix) |
| `HANA-SYN-024` | `error` | `syntax` | SQL, SQLScript, HDI DDL, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Missing, dangling, or consecutive operator in SQL expressions; consecutive / leading / trailing `,` (before `)`, `;`, or a clause keyword); stray `.` separators (with QuickFix) |
| `HANA-SYN-025` | `error` | `syntax` | SQL, SQLScript, HDI DDL, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Incomplete/empty SQL clause (`SELECT FROM`, `WHERE AND`) or missing `;` between SQLScript statements inside `BEGIN ... END` (with QuickFix) |
| `HANA-SYN-026` | `error` | `syntax` | CDS (`.hdbdd`, `.hdbcds`) | `[XSC]` `[XSA]` `[HDI]` | Missing `:`, missing type, or missing `;` in CDS `entity`/`type` members and top-level `namespace`/`using` headers |
| `HANA-SYN-027` | `error` | `syntax` | SQL, SQLScript, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbtrigger`, `.hdbview`, `.hdblibrary`, `.hdbprojectionview`, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Out-of-order or duplicate `SELECT` query clause (`FROM`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `OFFSET`, `INTO`, `WITH HINT`) |
| `HANA-SYN-028` | `error` / `warning` | `syntax` | SQL, SQLScript, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdblibrary`, `.hdbtrigger`, `.hdbvirtualprocedure`, `.hdbvirtualfunction`, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Routine header clause placement/compatibility, `USING` library placement, `DECLARE` / `HANDLER` / executable ordering in compound blocks, handler scope conflicts, or unreachable statements |
| `HANA-SYN-029` | `error` / `warning` | `syntax` | SQL, SQLScript, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdblibrary`, `.hdbtrigger`, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Context-sensitive SQL/SQLScript statement legality (`FUNCTION` / `READS SQL DATA` write/DDL/TCL restrictions, `DETERMINISTIC` builtins, `RETURN`, `BREAK`/`CONTINUE`, `RESIGNAL`, `SIGNAL` range, `AUTONOMOUS`/`PARALLEL`/`DO`, top-level imperatives) |
| `HANA-SYN-040` | `error` | `syntax` | SQL, SQLScript, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbscalarfunction`, `.hdblibrary`, `.hdbtrigger`, `.hdbvirtualprocedure`, `.hdbvirtualfunction`, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Unconsumed token, malformed clause argument, or missing `AS` in a routine / library / trigger / `DO` header (consuming header parser, with QuickFix) |
| `HANA-SYN-041` | `error` | `syntax` | SQL, SQLScript, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbscalarfunction`, `.hdblibrary`, `.hdbtrigger`, `.hdbvirtualprocedure`, `.hdbvirtualfunction`, `.hdbmigrationtable` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Invalid top-level or block-level statement start (not a SQL / SQLScript starter, imperative assignment target, or library member), with scope-aware typo QuickFix |
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

### `HANA-SYN-004` — Invalid HDI Artifact Root or Multiple Top-Level Statements

> Source: `docs/specs/grammars/sql-sqlscript.md` (§5 HDI Headerless Artifacts), `SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md`

- **Platform:** `[XSA]` `[HDI]` `[CLOUD]`
- **Applies To:** Headerless HDI DDL artifact languages in `HDI_ROOT_TARGETS` (`hdbprocedure`, `hdbfunction`, `hdbtablefunction`, `hdbscalarfunction`, `hdblibrary`, `hdbtrigger`, `hdbtable`, `hdbstructure`, `hdbtabletype`, `hdbview`, `hdbsequence`, `hdbindex`, `hdbfulltextindex`, `hdbconstraint`, `hdbvirtualtable`, `hdbprojectionview`, `hdbstructuredprivilege`, `hdbstructuredfilter`, `hdbresultcache`, `hdbstatistics`, `hdbsystemversioning`, `hdbapplicationtime`, `hdbschedulerjob`, `hdbremotetablereplica`, `hdbfabricvirtualtable`, `hdbdropcreatetable`, `hdbgraphworkspace`, `hdbvirtualprocedure`, `hdbvirtualfunction`).
- **Severity:** `error` (`warning` for redundant leading `CREATE` / `CREATE OR REPLACE`)
- **Category:** `syntax`
- **Conditions:**
  1. **Root Declaration Mismatch (`error`) & Redundant `CREATE` (`warning`):**
     - When an HDI SQL DDL artifact starts with a non-typo keyword that is not in `HDI_ROOT_TARGETS[languageId]` (e.g., `SELECT`, `DROP`, `INSERT`, or `VIEW` at root of `.hdbprocedure`; `PROCEDURE` at root of `.hdbfunction`), report an unexpected root declaration (`error`, no QuickFix) instead of falling back to generic SQL. (Keyword typos within Damerau-Levenshtein distance `<= 2` continue to report `HANA-SYN-021` with QuickFix.)
     - When `CREATE [OR REPLACE] <object>` is used in an HDI artifact, `<object>` must match `HDI_ROOT_TARGETS[languageId]` (excluding `'CREATE'`); wrong object kinds emit `error` without a QuickFix, whereas a redundant `CREATE` / `CREATE OR REPLACE` prefix in front of an allowed headerless root keyword emits a `warning` with a preferred QuickFix (`Remove leading 'CREATE'` / `Remove leading 'CREATE OR REPLACE'`).
     - Classic KV dual-mode artifacts (`table.schemaName = ...`), `.hdbmigrationtable`, `.sql`, and `.hanasql` are excluded.
  2. **Single-Object Artifact Enforcement (`error`):**
     - Every HDI DDL artifact except `.hdbdropcreatetable` defines a single design-time object. Top-level non-comment statements appearing after the root definition completes (after the root `BEGIN ... END` closes for procedural/library/trigger artifacts, or after the top-level `;` for DDL artifacts, excluding header `AS USING ...;` before `BEGIN`) emit one aggregated diagnostic spanning from the first trailing token through the last non-comment trailing token (reporting the count when multiple trailing statements are present), with a preferred QuickFix (`Remove trailing statement` / `Remove trailing statements`) that removes trailing content after the root declaration while preserving comments after the last trailing token.
- **Diagnostic Examples:**
  - `Unexpected 'SELECT' at root of '.hdbprocedure' artifact; expected PROCEDURE / CREATE.`
  - `Object type 'VIEW' is not valid at root of '.hdbprocedure' artifact; expected PROCEDURE.`
  - `Headerless '.hdbprocedure' artifact should omit leading 'CREATE'.`
  - `Only one top-level declaration is allowed in '.hdbprocedure'; unexpected trailing statement 'SELECT'.`
  - `Only one top-level declaration is allowed in '.hdbview'; found 3 unexpected trailing statements.`

---

### `HANA-SYN-005` — Invalid SQL Character, `//` Comment, or Unknown Pragma

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en/006_4_SQL_Reference.md (Comments, Identifiers)
> Source: `docs/specs/grammars/sql-sqlscript.md` §2 (Lexical Tokens, Character Set & Token Separation)

- **Severity:** `error`
- **Platform Scope:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
- **Target Extensions:** All SQL / SQLScript languages (`.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbscalarfunction`, `.hdblibrary`, `.hdbtrigger`, headerless HDI DDL, `.hdbmigrationtable` per section). Not applied inside `LANGUAGE R` / `RLANG` / `GRAPH` bodies.
- **Lexical Trigger** (outside string literals, quoted identifiers, and comments; `-- hanasql-format off` regions are still checked):
  1. **`//` line comment:** SQL and SQLScript only define `--` and `/* ... */` comments. The scanner still recognizes `//` up to end of line so that a stray quote inside it (`// it's`) cannot swallow the rest of the file, but every such comment is reported.
  2. **Character outside the SQL lexical grammar** (tokenizer `other` token): `&`, single `|`, `\`, `` ` ``, single `!`, `~`, `^` (SAP HANA has no `~=` / `^=` operators; the SQL Reference defines only `=`, `>`, `<`, `>=`, `<=`, `!=`, `<>`), typographic quotes (`‘ ’ “ ”`), dashes (`–`), arrows (`→`), ellipsis (`…`), and any other non-ASCII symbol. `!=` and `||` are valid operators.
  3. **Unknown `@` pragma:** `@<name>` where `<name>` is not a SQLScript compiler pragma or `SQLSCRIPT_TEST` annotation (`AnalyzerSuppress`, `pushscope`, `popscope`, `Test`, `TestSetUp`, `TestTearDown`, `TestSetUpTest`, `TestTearDownTest`, `TestSetUpConfig`, `TestTearDownConfig`, `TestSetUpLibrary`, `TestTearDownLibrary`, `TestClassification`; case-insensitive).
- **Cascade Suppression:** Diagnostics from later passes (`HANA-SYN-023`, `HANA-SYN-024`, ...) that start inside a `HANA-SYN-005` / `HANA-SYN-006` span are dropped.
- **Diagnostic Span & Message:**
  - `'//' is not a valid SQL comment; use '--' for line comments or '/* ... */' for block comments.` (spans the whole comment)
  - `Unexpected character '&' in SQL.` / `Typographic quote '’' (U+2019) is not valid in SQL; use ASCII ' for strings or " for identifiers.`
  - `Unknown SQLScript pragma '@someOtherPragma'.`
- **QuickFix:** `Replace '//' with '--'`; `Remove '<char>'`.
  - **Before:**

    ```sql
    SQL SECURITY INVOKER // caller rights
    ```

  - **After:**

    ```sql
    SQL SECURITY INVOKER -- caller rights
    ```

### `HANA-SYN-006` — Missing Token Separator or Undelimited `::` Object Name

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en/006_4_SQL_Reference.md (Identifiers)
> Source: `docs/specs/grammars/sql-sqlscript.md` §2 (Character Set & Token Separation)

- **Severity:** `error` (numeric literal / `::` name) or `warning` (string literal / quoted identifier)
- **Platform Scope:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
- **Target Extensions:** Same as `HANA-SYN-005`.
- **Lexical Trigger:** Two tokens with no whitespace and no comment between them (`!wsBefore && nlBefore === 0` on the right token):
  1. **Glued literal / quoted identifier:** left token is a quoted identifier, string literal, or numeric literal; right token is an identifier/keyword, quoted identifier, string literal, or numeric literal (`"T"ddddddd`, `'str'abc`, `123abc`, `1.5f`). `error` when the left token is a numeric literal (two regular tokens must be separated); `warning` otherwise, since a delimited token is self-terminating and HANA may accept it (`'a'AS x`), but the form is almost always a typo.
     - **Exclusions:** hexadecimal literals (`0x1F`); doubled-quote escapes (`'it''s'`, `"A""B"` are single tokens); `N'...'` / `X'...'` / `DATE'...'` prefixes (left token is a word); member access and operators (`:var`, `::`, `..`, `.`, `"S"."T"`, `$"a"."b"` JSON paths).
  2. **Undelimited name containing `::`:** an identifier chain `a.b.c` immediately followed by `::name` (`com.acme.app::tbl`). Undelimited identifiers may only contain letters, digits, `_`, `#`, and `$`, so repository/HDI names with `::` must be quoted. **Exclusion:** cursor attributes `<cursor>::ISCLOSED`, `::NOTFOUND`, `::ROWCOUNT`.
- **Diagnostic Span & Message:** spans both tokens (or the whole name):
  - `Missing whitespace between quoted identifier '"T"' and 'ddddddd'.`
  - `Object name 'com.acme.app::tbl' contains '::' and must be a quoted identifier.`
- **QuickFix:** `Insert space`; `Quote as "com.acme.app::tbl"`.
  - **Before:**

    ```sql
    SELECT * FROM com.acme.app::sample_table;
    ```

  - **After:**

    ```sql
    SELECT * FROM "com.acme.app::sample_table";
    ```

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
  3. Routine / library / trigger header keywords: every unconsumed word in a header is matched against the follow-set of its exact slot by the consuming header parser (see `HANA-SYN-040`), including short keywords — `RETURNS` (`RETUNS`, `RETURN`), `LANGUAGE` (`LANUAGE`, `LANGAUGE`), `SECURITY` (`SECURTY`), `INVOKER` (`INVOKR`), `DEFINER` (`DEFINR`), `AS` (`ASd`), `AFTER` (`AFTR`), `ON`, `EACH`, ...
  4. Top-level statement starts and unambiguous SQL query clause anchors:
     - Statement starts at top level, inside SQLScript blocks, and in library member scope: every invalid statement starter is matched against the valid starters of its scope (`RETURN` -> `RETERN`, `DECLARE` -> `DECLRE`, `SIGNAL` -> `SIGNL`, `SELECT` -> `SELECTT`, `PUBLIC` -> `PUBLC`) ONLY when it is structurally invalid (not an assignment such as `retern = 1;` or `col := ...`); see `HANA-SYN-041`.
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
  5. **`JSON_TABLE` Column Lists `[XSA]` `[HDI]` `[CLOUD]`:** Inside `JSON_TABLE(<ctx>, <path> COLUMNS ( ... ))` (and nested `NESTED [PATH] '<path>' COLUMNS ( ... )`), a new column entry following a complete entry without `,`. An entry is complete after `<col> FOR ORDINALITY`, after its `PATH '<path>'` literal, or after a nested `COLUMNS ( ... )`; only behavior/wrapper clauses may follow it (`ERROR | NULL | DEFAULT <value> | EMPTY ARRAY | EMPTY OBJECT` `ON EMPTY` / `ON ERROR`, `WITH [CONDITIONAL | UNCONDITIONAL] [ARRAY] WRAPPER`, `WITHOUT [ARRAY] WRAPPER`). Space-separated parts within an entry (`<type>`, `FORMAT JSON [ENCODING ...]`, `PATH`, path literals) are never flagged.
- **Clause-Syntax Function Exclusions (no top-level comma checking):**
  - **Hierarchy generators & navigators `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`** (`docs/specs/grammars/sql-sqlscript.md` §4.5): `HIERARCHY`, `HIERARCHY_LEVELED`, `HIERARCHY_SPANTREE`, `HIERARCHY_TEMPORAL`, `HIERARCHY_ANCESTORS`, `HIERARCHY_ANCESTORS_AGGREGATE`, `HIERARCHY_DESCENDANTS`, `HIERARCHY_DESCENDANTS_AGGREGATE`, `HIERARCHY_SIBLINGS`. Their clauses (`SOURCE`, `START [WHERE]`, `JOIN ... ON`, `MEASURES`, `DISTANCE`, `LEVELS`, `SIBLING ORDER BY`, `VALID`, `DEPTH`, `MULTIPARENT`, `ORPHAN`, `CYCLE`, `[NO] CACHE`, `LOAD`, `RETAIN NULLS`, `WITH SUBTOTAL | BALANCE | NOT MATCHED | TOTAL`) are space-separated. Nested `LEVELS ( ... )`, `MEASURES ( ... )`, `IN ( ... )`, function calls, and `SOURCE` / `START ( SELECT ... )` subqueries are still checked. `HIERARCHY_COMPOSITE_ID(a, b, ...)` is a plain comma-separated scalar call and stays checked.
  - **`OPENCYPHER_TABLE` `[HDI]` `[CLOUD]`** (§4.4): `GRAPH WORKSPACE <ws> QUERY '<cypher>' [PARAMETERS ( ... )]`; the nested `PARAMETERS ( ... )` list is still checked.
  - **`JSON_VALUE` / `JSON_QUERY` `[XSA]` `[HDI]` `[CLOUD]`:** `<ctx>, <path>` is checked as a normal argument list; checking stops at the first trailing clause keyword (`RETURNING`, `WITH`, `WITHOUT`, `ERROR`, `NULL`, `DEFAULT`, `EMPTY`, `ON`). Nested type arguments (`RETURNING DECIMAL(10, 2)`) are still checked.
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
  4. **Trailing Comma (`QuickFix: Remove trailing comma`):** Comma immediately before closing `)` in SQL lists (`DECIMAL(3, 2,)`, `RETURNS TABLE ("A" INT,)`), before `;`, or before major query clause keywords (`SELECT "A", FROM "T"`).
  5. **Consecutive / Leading Comma (`QuickFix: Remove extra ','` / `Remove leading ','`):** Two or more commas separated only by whitespace or comments (`a,,b`, `INVOKER,,,,`; one diagnostic per run spanning the extra commas), or a comma immediately after `(` (`INSERT INTO A (, ab)`).
  6. **Stray `.` Separator (`QuickFix: Remove '.'`):** A `.` must sit between two name parts: left operand is an identifier, quoted identifier, `:var`, `::sysvar`, `)` or `]`; right operand is an identifier, quoted identifier, or `*` (`t.*`). A run of glued dots other than a single `..` range separator (`...`, `a...b`, `.` glued to `..`) is reported once. `..` itself is valid only as the `FOR i IN a..b` range separator.
- **Hierarchy Function Clause Scoping `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`:** Inside the top level of a clause-syntax `HIERARCHY*` call (the 9 functions listed under `HANA-SYN-023`), a `START WHERE` / `WHERE` / `JOIN ... ON` condition ends at a hierarchy clause keyword (`SOURCE`, `START`, `JOIN`, `MEASURES`, `DISTANCE`, `LEVELS`, `SIBLING`, `VALID`, `DEPTH`, `MULTIPARENT`, `ORPHAN`, `CYCLE`, `CACHE`, `NO`, `LOAD`, `RETAIN`). This applies only after a complete operand, so the condition is still checked (`START WHERE node_id :id` → missing operator; `START WHERE node_id + DEPTH 2` → dangling operator). `UNTIL` in `VALID FROM <expr> [EXCLUDED] UNTIL <expr> [EXCLUDED]` does not open a loop condition. These keywords are non-reserved, so they are **not** global clause terminators: outside hierarchy calls, `WHERE depth = 1 AND valid = 'Y'` treats them as columns, and `WHERE a = 1 DEPTH 2` is still flagged.

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

### `HANA-SYN-028` — SQLScript Header & Block Declaration Ordering

> Source: `SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md`, `010_8_Imperative_SQLScript_Logic.md`, `014_12_Built-In_Libraries.md`

- **Platform:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
- **Applies To:** `sql`, `hanasql`, `sqlscript`, `procedure`, `hdbprocedure`, `hdbfunction`, `hdbtablefunction`, `hdbscalarfunction`, `hdblibrary`, `hdbtrigger`, `hdbvirtualprocedure`, `hdbvirtualfunction`, `hdbmigrationtable`
- **Severity:** `error` (`warning` + `unnecessary` tag for unreachable statements)
- **Category:** `syntax`
- **Grammar Reference:**

```ebnf
procedure_header ::= [ "CREATE" [ "OR" "REPLACE" ] | "ALTER" ] "PROCEDURE" <name>
                     [ "(" <param_list> ")" ]
                     [ "LANGUAGE" <lang> ] [ "SQL" "SECURITY" ( "DEFINER" | "INVOKER" ) ]
                     [ "DEFAULT" "SCHEMA" <schema> ] [ "READS" "SQL" "DATA" ]
                     [ <variable_cache_clause> ] [ "DETERMINISTIC" ] [ "WITH" "ENCRYPTION" ]
                     [ "AUTOCOMMIT" "DDL" ( "ON" | "OFF" ) ]
                     "AS" [ "USING" <lib> [ "AS" <alias> ] ";" ... ] ( "BEGIN" ... "END" | "HEADER" "ONLY" ) ;

function_header  ::= [ "CREATE" [ "OR" "REPLACE" ] | "ALTER" | "VIRTUAL" ] "FUNCTION" <name>
                     [ "(" <in_param_list> ")" ]
                     "RETURNS" ( <scalar_ret_list> | "TABLE" "(" ... ")" )
                     [ "LANGUAGE" <lang> ] [ "SQL" "SECURITY" ( "DEFINER" | "INVOKER" ) ]
                     [ "DEFAULT" "SCHEMA" <schema> ] [ "READS" "SQL" "DATA" ] [ <variable_cache_clause> ]
                     [ "DETERMINISTIC" ] [ "WITH" "ENCRYPTION" ]
                     [ [ "NO" ] "STRUCTURED" "FILTER" "CHECK" ]
                     "AS" [ "USING" <lib> [ "AS" <alias> ] ";" ... ] ( "BEGIN" ... "END" | "HEADER" "ONLY" ) ;

compound_scope   ::= [ "SEQUENTIAL" "EXECUTION" | "PARALLEL" "EXECUTION" | "AUTONOMOUS" "TRANSACTION" ]
                     [ <using_stmt>* ]        /* root BEGIN only */
                     [ <proc_decl>* ]         /* DECLARE var | table | array | cursor | condition */
                     [ <proc_handler>* ]      /* DECLARE (EXIT | CONTINUE) HANDLER FOR ... */
                     [ <proc_stmt>* ] ;       /* executable statements */
```

- **Conditions:**
  1. **Routine Header Placement & Duplicates (`error`):**
     - Header clauses (`RETURNS`, `LANGUAGE`, `SQL SECURITY`, `DEFAULT SCHEMA`, `READS SQL DATA`, `DETERMINISTIC`, `WITH ENCRYPTION`, `AUTOCOMMIT DDL`, `[NO] STRUCTURED FILTER CHECK`) MUST precede `AS` (and `BEGIN`) and MUST NOT repeat in the same routine header.
     - On `FUNCTION` headers, `RETURNS` MUST appear after parameters and before trailing options (`LANGUAGE`, `SQL SECURITY`, `DEFAULT SCHEMA`, `DETERMINISTIC`, `WITH ENCRYPTION`, `STRUCTURED FILTER CHECK`, `AS`). (`RETURNS` is optional on `ALTER FUNCTION`.)
     - Block modifiers (`SEQUENTIAL EXECUTION`, `PARALLEL EXECUTION`, `AUTONOMOUS TRANSACTION`) MUST NOT appear in the routine header before `AS`.
  2. **Header Clause & Parameter Compatibility (`error`):**
     - `OUT` and `INOUT` parameter modes are disallowed in `FUNCTION` parameter lists (only `IN` is permitted).
     - `RETURNS` and `[NO] STRUCTURED FILTER CHECK` are disallowed in `PROCEDURE` headers.
     - `AUTOCOMMIT DDL ON|OFF` is disallowed in `FUNCTION` headers and in `READS SQL DATA` `PROCEDURE` headers.
     - `CREATE FUNCTION` / HDI `FUNCTION` / `VIRTUAL FUNCTION` headers MUST declare `RETURNS`.
  3. **`USING` Library Placement (`error`):**
     - `USING <library_name> [AS <alias>];` MUST appear either between `AS` and the root `BEGIN`, or at the start of the root `BEGIN` block before any `DECLARE` or executable statement.
     - `USING` after declarations/statements or inside nested blocks (`IF`, `ELSEIF`, `ELSE`, `FOR`, `WHILE`, `LOOP`, nested `BEGIN`, handler body) is rejected.
  4. **Compound Block Declaration Order (`error`):**
     - Every compound scope (`BEGIN ... END`, `IF ... THEN`, `ELSEIF ... THEN`, `ELSE`, `FOR ... DO`, `WHILE ... DO`, `LOOP`, handler `BEGIN ... END`) enforces: block option (`SEQUENTIAL EXECUTION`, etc.) -> `<proc_decl_list>` (`DECLARE <var|table|array|cursor|condition>`) -> `<proc_handler_list>` (`DECLARE EXIT|CONTINUE HANDLER FOR ...`) -> `<proc_stmt_list>` (executables).
     - Single-statement handler bodies (`DECLARE EXIT HANDLER FOR ... <stmt>;`) remain scoped to `<proc_handler_list>` and do not advance the enclosing block to `<proc_stmt_list>`.
     - Compound handler bodies (`DECLARE ... HANDLER FOR ... BEGIN ... END;`) open an independent nested child scope allowing local declarations inside the handler.
  5. **Handler Scope Conflicts & Duplicates (`error`):**
     - `EXIT HANDLER` and `CONTINUE HANDLER` cannot appear in the same scope regardless of declaration order.
     - `EXIT HANDLER` cannot be declared in any nested scope inside an ancestor scope that declared a `CONTINUE HANDLER`. (A `CONTINUE HANDLER` nested inside an `EXIT HANDLER` scope is permitted.)
     - Duplicate condition specifications (e.g., two `SQLEXCEPTION`, two identical `SQL_ERROR_CODE <n>`, or two identical named conditions) within the same scope are rejected.
  6. **Unreachable Statements (`warning`, tag `unnecessary`):**
     - Sibling statements appearing after an unconditional control-flow terminator (`RETURN`, `SIGNAL`, `RESIGNAL`, `BREAK`, `CONTINUE`) within the same block/branch statement list (excluding single-statement handler bodies) are flagged as unreachable.
  7. **`.hdblibrary` Member Declaration Order (`error`):**
     - Inside `LIBRARY ... AS BEGIN ... END`, `PUBLIC` / `PRIVATE VARIABLE` declarations MUST precede any `PROCEDURE` or `FUNCTION` member declaration, and `DEFAULT` / `=` / `:=` initializers on library variables (including qualified/quoted variable names) require `CONSTANT`.
     - **QuickFix / Refactor:** Non-constant initializers offer preferred QuickFix `Add 'CONSTANT'` (inserting `CONSTANT` after the variable name); variables declared after member procedures/functions offer non-preferred `refactor` `Move declaration before first member`.
- **Diagnostic Examples:**
  - `Header clause 'READS SQL DATA' must appear before 'AS'.`
  - `Parameter mode 'OUT' is not allowed in a FUNCTION header; use PROCEDURE or RETURNS instead.`
  - `'AUTOCOMMIT DDL' is not allowed in a READS SQL DATA procedure or a function.`
  - `'USING' declaration must appear before 'DECLARE' and statements at routine root level.`
  - `'DECLARE' must appear before executable statements in this block.`
  - `'DECLARE' variable/cursor/condition must appear before 'DECLARE ... HANDLER' in this block.`
  - `'EXIT HANDLER' cannot be combined with 'CONTINUE HANDLER' in the same or enclosing scope.`
  - `Duplicate condition handler for 'SQLEXCEPTION' in this scope.`
  - `Library variable declarations must appear before member procedures and functions.`
  - `Unreachable statement after 'RETURN'.`

---

### `HANA-SYN-029` — SQLScript Context-Sensitive Statement Rules

> Source: `SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md`, `010_8_Imperative_SQLScript_Logic.md`, `006_4_SQL_Reference.md`

- **Platform:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
- **Applies To:** `sql`, `hanasql`, `sqlscript`, `procedure`, `hdbprocedure`, `hdbfunction`, `hdbtablefunction`, `hdbscalarfunction`, `hdblibrary`, `hdbtrigger`, `hdbmigrationtable`
- **Severity:** `error` (`warning` for `DETERMINISTIC` non-deterministic built-in usage)
- **Category:** `syntax`
- **Conditions:**
  1. **Read-Only Restrictions (`FUNCTION` & `READS SQL DATA` `PROCEDURE`) (`error`):**
     - Disallow DML modifying persistent catalog tables (`INSERT`, `UPDATE`, `DELETE`, `UPSERT`, `MERGE`, `REPLACE`) inside `FUNCTION` (scalar or table UDF) and `READS SQL DATA` `PROCEDURE` bodies. DML targeting local `:table_var` table variables (`:lt.INSERT(...)`, `INSERT INTO :lt ...`, `UPDATE :lt ...`, `DELETE FROM :lt ...`) IS permitted.
     - Disallow DDL (`CREATE`, `ALTER`, `DROP`, `RENAME`, `TRUNCATE`), transaction control (`COMMIT`, `ROLLBACK`, `SAVEPOINT`, `SET TRANSACTION`, `LOCK TABLE`), dynamic SQL (`EXEC`, `EXECUTE IMMEDIATE`), and `BEGIN AUTONOMOUS TRANSACTION`.
     - Inside `FUNCTION` bodies, additionally disallow `CALL <proc>` and `BEGIN PARALLEL EXECUTION`.
  2. **`DETERMINISTIC` Routine Side-Effect / Nondeterminism Check (`warning`):**
     - Inside `DETERMINISTIC` procedures or functions, warn on non-deterministic functions/values (`RAND`, `RAND_SECURE`, `SYSUUID`, `SESSION_CONTEXT`, `SESSION_USER`, `CURRENT_TIMESTAMP`, `CURRENT_UTCTIMESTAMP`, `CURRENT_DATE`, `CURRENT_TIME`, `CURRENT_UTCDATE`, `CURRENT_UTCTIME`, `CURRENT_MVCC_SNAPSHOT_TIMESTAMP`, `CURRENT_TRANSACTION_ISOLATION_LEVEL`, `NOW`) and sequence access (`.NEXTVAL`, `.CURRVAL`).
  3. **`RETURN` Statement Semantics by Routine Kind (`error`):**
     - **Table UDF (`RETURNS TABLE (...)`):** A concrete SQLScript `BEGIN ... END` body (excluding `VIRTUAL`, `HEADER ONLY`, foreign language, and `ALTER FUNCTION` without `RETURNS`) MUST execute at least one `RETURN <table_expr_or_select>;` and MUST NOT use bare `RETURN;`.
     - **Scalar UDF / `PROCEDURE` / `TRIGGER` / `DO`:** `RETURN <expr>;` returning an expression is rejected; Scalar UDFs assign return variables directly and optionally exit with bare `RETURN;`, and `PROCEDURE`/`TRIGGER`/`DO` only allow bare `RETURN;`.
  4. **Loop Control (`BREAK` / `CONTINUE`) (`error`):**
     - `BREAK` and `CONTINUE` are rejected outside `LOOP`, `WHILE`, and `FOR` loop bodies (and inside exception handlers unless nested inside a handler-local loop).
  5. **Exception Handling Statements (`RESIGNAL` / `SIGNAL`) (`error`):**
     - `RESIGNAL` is rejected outside an exception handler body (`DECLARE EXIT|CONTINUE HANDLER`).
     - `SIGNAL SQL_ERROR_CODE <n>` requires user-defined error code `<n>` in range `10000..19999`. (`DECLARE <cond> CONDITION FOR SQL_ERROR_CODE <n>` permits built-in SQL error codes.)
  6. **Nested Anonymous Blocks (`DO BEGIN`) (`error`):**
     - Anonymous `DO [(...)] BEGIN ... END` blocks cannot be nested inside `PROCEDURE`, `FUNCTION`, `TRIGGER`, or `DO` bodies.
  7. **`BEGIN AUTONOMOUS TRANSACTION` & `BEGIN PARALLEL EXECUTION` Restrictions (`error`):**
     - Inside `BEGIN PARALLEL EXECUTION`: disallowed in `FUNCTION` and `TRIGGER` bodies; disallow `EXEC` / `EXECUTE IMMEDIATE`, DDL, `COMMIT` / `ROLLBACK` / `SAVEPOINT`, `DECLARE ... HANDLER`, and `RETURN`.
     - Inside `BEGIN AUTONOMOUS TRANSACTION`: disallow `CALL`, DDL, dynamic SQL (`EXEC` / `EXECUTE IMMEDIATE`), and cursor operations (`DECLARE ... CURSOR`, `OPEN`, `FETCH`, `CLOSE`). Disallowed in `TRIGGER` bodies.
     - **Trigger Precedence:** When `BEGIN AUTONOMOUS TRANSACTION` or `BEGIN PARALLEL EXECUTION` is already rejected at the block header inside a `TRIGGER` body, secondary `autonomous`/`parallel` context restrictions are not additionally layered onto inner statements (direct `TRIGGER` restrictions such as DDL, transaction control, and dynamic SQL still apply).
  8. **Top-Level Imperative Statements (`error`):**
     - Imperative SQLScript statements (`DECLARE`, `IF ... THEN`, `LOOP`, `WHILE`, `FOR`, `BREAK`, `CONTINUE`, `SIGNAL`, `RESIGNAL`, `RETURN`) are rejected at top-level SQL script scope outside `PROCEDURE`, `FUNCTION`, `TRIGGER`, or `DO BEGIN ... END`.
  9. **`.hdblibrary` & `.hdbtrigger` Body Restrictions (`error`):**
     - Inside `LIBRARY ... AS BEGIN ... END`, only `[PUBLIC | PRIVATE] VARIABLE`, `PROCEDURE`, and `FUNCTION` members are permitted (`PUBLIC` or `PRIVATE` required on members; direct executable/declarative statements outside members are rejected). Missing visibility offers QuickFixes `Add 'PRIVATE'` (`isPreferred: true`) and `Add 'PUBLIC'` (`isPreferred: false`).
     - Inside `TRIGGER ... BEGIN ... END`, DDL (`CREATE`, `ALTER`, `DROP`, `RENAME`, `TRUNCATE`), transaction control (`COMMIT`, `ROLLBACK`, `SAVEPOINT`, `LOCK TABLE`, `SET TRANSACTION`), dynamic SQL (`EXEC`, `EXECUTE IMMEDIATE`), `BEGIN AUTONOMOUS TRANSACTION`, and `BEGIN PARALLEL EXECUTION` are rejected.
- **Diagnostic Examples:**
  - `'INSERT' on persistent table 'TAB' is not allowed inside a READS SQL DATA procedure or FUNCTION.`
  - `Dynamic SQL ('EXECUTE IMMEDIATE') is not allowed inside a FUNCTION or READS SQL DATA procedure.`
  - `Non-deterministic expression 'RAND' used inside a DETERMINISTIC routine.`
  - `Table UDF must return a table expression via 'RETURN <query_or_table_var>;'.`
  - `'RETURN <expr>' is only allowed in a Table UDF; use return parameter assignment or bare 'RETURN;' instead.`
  - `'BREAK' is only allowed inside a 'LOOP', 'WHILE', or 'FOR' statement.`
  - `'RESIGNAL' is only allowed inside a 'DECLARE ... HANDLER' exception handler.`
  - `'SIGNAL SQL_ERROR_CODE' code 500 must be a user-defined error code between 10000 and 19999.`
  - `Nested 'DO BEGIN ... END' anonymous blocks are not allowed inside a routine.`
  - `'CALL' is not allowed inside 'BEGIN AUTONOMOUS TRANSACTION'.`
  - `Imperative statement 'DECLARE' is only allowed inside a routine or 'DO BEGIN ... END' block.`
  - `Library member 'FUNCTION' must specify 'PUBLIC' or 'PRIVATE' visibility.`
  - `DDL statement 'CREATE' is not allowed inside a TRIGGER body.`

---

### `HANA-SYN-040` — Unconsumed Token or Missing `AS` in Routine / Library / Trigger Header

> Source: `docs/specs/grammars/sql-sqlscript.md` §4.1 (procedure, function, virtual routine, library, trigger, and `DO` headers)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md (CREATE / ALTER PROCEDURE, CREATE / ALTER FUNCTION, User-Defined Libraries)

- **Severity:** `error`
- **Platform Scope:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
- **Target Extensions:** `.sql`, `.hanasql`, `.sqlscript`, `.procedure`, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbscalarfunction`, `.hdblibrary` (library header and every `PUBLIC` / `PRIVATE` member header), `.hdbtrigger`, `.hdbvirtualprocedure`, `.hdbvirtualfunction`, `.hdbmigrationtable`.
- **AST / Token Trigger:** A deterministic consuming parser (`src/analyzer/sql-header.ts`) runs at every statement start that opens `[CREATE [OR REPLACE] | ALTER] [VIRTUAL] PROCEDURE | FUNCTION | LIBRARY`, `[CREATE [OR REPLACE]] TRIGGER`, `DO [(...)] BEGIN`, or a library member. Every token from the header start through `AS` -> `{ USING <lib> [AS <alias>]; }` -> `BEGIN` (or `HEADER ONLY [ON INVALID]` / `;`) must be consumed by a §4.1 production:
  1. **Unconsumed token:** any word, literal, operator, or punctuation that does not start or continue a header production (`INVOKER,`, `AWlpqwkr`, stray `+`). One diagnostic is reported per contiguous run of unexpected tokens; parsing resumes at the next recognized clause keyword.
  2. **Missing `AS`:** `BEGIN`, `HEADER ONLY`, or the terminating `;` reached before `AS` on a procedure, function, or library header (QuickFix `Insert 'AS'` before `BEGIN` / `HEADER ONLY`). Not applied to triggers / `DO` (no `AS`), option-only `ALTER` forms (`ALTER FUNCTION f STRUCTURED FILTER CHECK;`), management forms (`ALTER PROCEDURE p RECOMPILE`, `... ENCRYPTION ON`, `... ADD | DROP VARIABLE CACHE ...`), or virtual routines.
  3. **Malformed clause argument:** `SQL SECURITY` without `DEFINER` / `INVOKER`, `AUTOCOMMIT DDL` without `ON` / `OFF`, `LANGUAGE` / `DEFAULT SCHEMA` / `WITH RESULT VIEW` / `USING` without a name, `RETURNS` without a type or with `TABLE` but no column list, `HEADER ONLY` not followed by `;` or `ON INVALID BEGIN`, `AS` followed by anything other than `USING`, `BEGIN`, or `HEADER ONLY`.
  4. **Trigger header** (`BEFORE | AFTER | INSTEAD OF` -> `INSERT | DELETE | UPDATE [[EXCEPT] OF <cols>]` `{OR <event>}` -> `ON <table>` -> `[REFERENCING (OLD | NEW) (ROW | TABLE) [AS] <name>, ...]` -> `[FOR EACH ROW | STATEMENT]` -> `[FOLLOWS | PRECEDES <triggers>]` -> `[ONLINE]` -> `BEGIN`): a missing or misplaced element.
- **Slot-Aware Typo Recovery (`HANA-SYN-021`):** before reporting an unconsumed word, it is matched against the follow-set of its exact slot (including 2–3 letter keywords such as `AS`, `ON`, `OF`, `OR`), e.g. `ASd` -> `AS`, `LANUAGE` -> `LANGUAGE`, `SECURTY` -> `SECURITY`, `INVOKR` -> `INVOKER`, `RETURN` -> `RETURNS`, `AFTR` -> `AFTER`. A match is reported as `HANA-SYN-021` with a `Replace '<typo>' with '<KEYWORD>'` QuickFix, and parsing continues as if the keyword had been written (so no cascading `HANA-SYN-040`).
- **Cascade Suppression:** structural `HANA-SYN-040` issues are dropped for a header that contains an unclosed / unmatched delimiter (`HANA-SYN-003`); `HANA-SYN-005` / `HANA-SYN-006` lexical spans suppress diagnostics inside or directly after them.
- **Not Accepted (not in the SAP HANA references):** `MODIFIES SQL DATA`, `CALLED ON NULL INPUT`, `[NO] CACHE` in the header (the table-UDF result cache is `END WITH [STATIC] CACHE ...` after the body).
- **Diagnostic Examples:**
  - `Unexpected ',' in FUNCTION header; expected 'DEFAULT SCHEMA', 'READS SQL DATA', 'VARIABLE CACHE', 'DETERMINISTIC', 'WITH ENCRYPTION', 'STRUCTURED FILTER CHECK', 'AS'.`
  - `Unknown keyword 'ASd' in FUNCTION header. Did you mean 'AS'?` (`HANA-SYN-021`)
  - `Missing 'AS' before 'BEGIN' in PROCEDURE header.`
  - `Expected 'DEFINER' or 'INVOKER' after 'SECURITY'.`
  - `Expected 'ON' in TRIGGER header (before subject table), found 'FROM'.`
- **QuickFix:**
  - **Before:**

    ```sql
    PROCEDURE "p"() LANGUAGE SQLSCRIPT SQL SECURITY INVOKER
    BEGIN
      SELECT 1 FROM DUMMY;
    END
    ```

  - **After:**

    ```sql
    PROCEDURE "p"() LANGUAGE SQLSCRIPT SQL SECURITY INVOKER
    AS BEGIN
      SELECT 1 FROM DUMMY;
    END
    ```

### `HANA-SYN-041` — Invalid Statement Start

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en/006_4_SQL_Reference.md (SQL Statements: first keyword of every `<X> Statement`)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/010_8_Imperative_SQLScript_Logic.md (imperative statements, assignments, table-variable operators, multiple-output scalar UDF assignment)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference/008_pages_211_240.md (library member calls `LIB:PRINT_LINE(...)`)

- **Severity:** `error`
- **Platform Scope:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
- **Target Extensions:** `.sql`, `.hanasql`, `.sqlscript`, `.procedure`, `.hdbprocedure`, `.hdbfunction`, `.hdbtablefunction`, `.hdbscalarfunction`, `.hdblibrary`, `.hdbtrigger`, `.hdbvirtualprocedure`, `.hdbvirtualfunction`, `.hdbmigrationtable`.
- **Statement Walker:** `src/analyzer/sql-statements.ts` follows the compound structure of each SQL section: routine / library / trigger / `DO` headers (consuming header parser, `HANA-SYN-040`), `BEGIN [SEQUENTIAL EXECUTION | PARALLEL EXECUTION | AUTONOMOUS TRANSACTION] ... END`, `IF ... THEN ... {ELSEIF ... THEN ...} [ELSE ...] END IF`, `WHILE ... DO ... END WHILE`, `FOR ... DO ... END FOR`, `LOOP ... END LOOP`, statement-level `CASE [<expr>] WHEN ... THEN <stmts> ... [ELSE <stmts>] END CASE`, `DECLARE (EXIT | CONTINUE) HANDLER FOR <conditions> <stmt>`, and library member scope. Conditions (`IF` / `ELSEIF` / `WHILE` / `WHEN`) are scanned to their `THEN` / `DO` at parenthesis depth 0 outside `CASE ... END` **expressions**, so expression-level `CASE WHEN ... THEN <expr> ELSE <expr> END` never opens or closes a statement list. A `BEGIN ... END` nested inside a statement (anonymous `SQL FUNCTION ... BEGIN ... END` in a query) is walked as a block.
- **Statement Prefixes (skipped before validation):** `@<pragma>[(...)]` (see `HANA-SYN-005`), `#[INLINE]` / `#[NO_INLINE]` hints, and labels `<ident>:` before `FOR` / `WHILE` / `LOOP` / `BEGIN`.
- **Valid Starters by Scope:**

  ```text
  sql_statement_starter  ::= ALTER | ANNOTATE | BACKUP | CALL | CANCEL | COMMENT | COMMIT | CONNECT | CREATE | DELETE
                           | DO | DROP | EXPLAIN | EXPORT | GRANT | IMPORT | INSERT | LOAD | LOCK | MERGE | RECOVER
                           | REFRESH | RELEASE | RENAME | REPLACE | REVOKE | ROLLBACK | SAVEPOINT | SELECT | SET
                           | TRUNCATE | UNLOAD | UNSET | UPDATE | UPSERT | VALIDATE | VALUES | WITH
                           | "(" ( SELECT | WITH | "(" ) ...                     (* parenthesized query *)
  sqlscript_starter      ::= BEGIN | BREAK | CALL | CASE | CLOSE | CONTINUE | DECLARE | DO | EXEC | EXECUTE | FETCH
                           | FOR | IF | LOOP | OPEN | RESIGNAL | RETURN | SIGNAL | USING | WHILE | WITH
  imperative_target      ::= [ ":" ] <ident> { "." <ident> | "[" <expr> "]" } ( ":=" | "=" )
                           | [ ":" ] <ident> { "." <ident> } "." <method> "("    (* :tv.INSERT(...), tv.DELETE(...) *)
                           | "(" <ident> { "," <ident> } ")" ( "=" | ":=" )      (* multi-output scalar UDF *)
                           | <lib_alias> ":" <member> "("                       (* library procedure call *)
  library_member_starter ::= PUBLIC | PRIVATE | USING | VARIABLE | PROCEDURE | FUNCTION
  ```

  - **Top level** (`.sql`, `.hanasql`, `.sqlscript`, `.procedure`, `.hdbmigrationtable` sections): `sql_statement_starter`; SQLScript imperative starters are accepted here because `HANA-SYN-029` already reports them outside a routine; `.hdbmigrationtable` additionally accepts the headerless roots `COLUMN` / `ROW`. Headerless HDI artifacts skip top-level validation (their root is checked by `HANA-SYN-004`).
  - **Imperative block** (`BEGIN`, `IF` / `ELSEIF` / `ELSE`, loop, `CASE` branch, handler body): `sql_statement_starter`, `sqlscript_starter`, or `imperative_target`.
  - **Library member scope** (`.hdblibrary` / `CREATE LIBRARY` body): only `library_member_starter` typos are reported here (`HANA-SYN-021`, superseding the generic `HANA-SYN-029` report on the same token); other invalid members are reported by `HANA-SYN-029`.
- **AST / Token Trigger:** the first token of a statement (after prefixes) is not a valid starter for its scope, e.g. `foobar;`, `ASd;`, `'Active';`, `123;`, `+ 1;`, `SELECTT * FROM T;`.
- **Typo Suggestions (`HANA-SYN-021`):** an invalid word starter is matched against the valid starters of the enclosing scope (`SELECTT` -> `SELECT`, `DECLRE` -> `DECLARE`, `UPSRT` -> `UPSERT`, `PUBLC` -> `PUBLIC` in library scope) and reported with a `Replace '<typo>' with '<KEYWORD>'` QuickFix. A misspelled word that forms a valid assignment (`retrun = 5;`) is an assignment, not a typo.
- **Guards:** a section with a `HANA-SYN-003` (delimiter) or `HANA-SYN-020` (compound block) error is skipped, because its statement boundaries cannot be trusted; tokens on lines with a broken quoted identifier, and tokens already carrying a diagnostic, are not reported again.
- **Diagnostic Examples:**
  - `Invalid statement start: unexpected identifier 'foobar'; expected a SQL or SQLScript statement, or an assignment ('foobar = <expression>;').`
  - `Invalid statement start: unexpected string literal ''Active''; expected a SQL or SQLScript statement, or an assignment ('<variable> = <expression>;').`
  - `Unknown statement keyword 'DECLRE'. Did you mean 'DECLARE'?` (`HANA-SYN-021`)
- **QuickFix:**
  - **Before:**

    ```sql
    DO BEGIN
      DECLRE x INT;
    END;
    ```

  - **After:**

    ```sql
    DO BEGIN
      DECLARE x INT;
    END;
    ```

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
