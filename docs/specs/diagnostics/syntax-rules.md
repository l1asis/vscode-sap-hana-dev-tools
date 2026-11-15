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
| `HANA-SYN-021` | `error` | `syntax` | SQL, SQLScript, headerless HDI DDL (`hdbtable`, `hdbview`, `hdbfunction`, `hdbprocedure`, etc.), CDS (`hdbdd`, `hdbcds`) | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | Misspelled declaration header keyword (e.g., `CREATE FUNC`, root `FUNC`, `PROC`, `ENTIY`) with QuickFix |
| `HANA-SYN-022` | `error` | `syntax` | Classic KV (`.hdbtable`, `.hdbview`, `.hdbti`, `.hdbschema`, `.hdbsequence`, `.hdbstructure`, `.hdbprocedure` KV, etc.) | `[XSC]` | Malformed Classic Key-Value assignment (missing `=`, missing RHS value, or dangling key at top/block level) |
| `HANA-SYN-030` | `error` | `syntax` | `.xsjs`, `.xsjslib` | `[XSC]` `[XSA]` | Unterminated JS string literal (`'...'`, `"..."`), template literal (`` `...` ``), line regex literal, or block comment (`/* ... */`) |
| `HANA-SYN-031` | `error` | `syntax` | `.xsjs`, `.xsjslib` | `[XSC]` `[XSA]` | Unmatched or unclosed JS delimiter (`( )`, `[ ]`, `{ }`, template `${ }`) |
| `HANA-SYN-032` | `error` | `syntax` | `.xsjs`, `.xsjslib` | `[XSC]` `[XSA]` | Misspelled JS statement or declaration keyword at anchored token boundary (e.g., `FUNC foo()`) with QuickFix |

---

## 3. Detailed Rule Specifications

### `HANA-SYN-001` — Unterminated String, Quoted Identifier, or CDS Expression
- **Severity:** `error`
- **Target Extensions:** All SQL / SQLScript languages, CDS (`.hdbdd`, `.hdbcds`), Classic KV (`.hdbtable`, `.hdbview`, `.hdbti`, `.hdbschema`, `.hdbsequence`, `.hdbstructure`, `.hdbtid`, `.hdbtim`, `.xshttpdest`), `.xsodata`, Classic `.hdbrole`, `.hdbmigrationtable`.
- **Lexical Trigger:**
  - Single-quoted string `'...'` reaching EOF without a closing unescaped `'`.
    - Escaping rule: in SQL/SQLScript/CDS/XSODATA, `''` (and `\'` when applicable in KV/CDS) escapes an interior quote; multiline `'...'` strings are valid in SQL/SQLScript/HDI DDL. In Classic KV strings inside `schemaName = "..."`, `\"` and `\\` are backslash escapes.
  - Double-quoted identifier or KV string `"..."` reaching EOF without a closing unescaped `"` (or newline inside single-line quoted identifiers unless escaped; NOTE: SQLScript/SQL supports `"..."` with `""` escape, flagged at EOF if unclosed).
  - CDS raw SQL expression bracket `![...]` reaching EOF without matching `]`.
- **Diagnostic Span & Message:** Spans the opening token / unclosed literal head; message: `"Unterminated string literal."`, `"Unterminated quoted identifier."`, or `"Unterminated CDS expression literal '![...]'."`
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
  - Encountering a closing `)`, `]`, or `}` when the delimiter stack is empty or its top has a mismatched opener type.
    - Exception: Wait-free tolerance for `#[...]` attribute annotations in SQLScript (`#[INLINE]`, `[0..*]`, `[1..1]` in CDS) — all use balanced `[` and `]`, so standard stack matching handles them cleanly without special cases.
  - Reaching EOF (or `.hdbmigrationtable` section boundary) with unclosed `(`, `[`, or `{` remaining on the stack.
- **Diagnostic Span & Message:**
  - Stray/mismatched closer: `"Unexpected closing delimiter ')'. Expected ']'."` or `"Unmatched closing delimiter ')'."`
  - Unclosed opener: `"Unclosed delimiter '('."`

---

### `HANA-SYN-010` — JSON / JSONC Syntax Error
- **Severity:** `error`
- **Target Extensions:** `.xsaccess`, `.xsapp`, `.xsprivileges`, `.xssqlcc`, `.xsjsjob`, `.hdbgrants`, `.hdbsynonym`, `.hdbsynonymconfig`, `.hdblogicalschema`, `.hdbanalyticprivilege`, `.hdbconfig`, `.hdbhadoopmrjob`, `.hdbflowgraph`, `.hdbreptask`, `.hdbtask`, `.hdbtaskplan`, `.hdbsysauth`, `.hdbroleconfig`, `.hdbsearchruleset`, `.hdbcollection`, `.hdbcollectionindex`, `.hdbstatistics`, `.hdbresultcache`, `.hdbgraphworkspace`, `.hdbremote`, `.hdbvirtualtableconfig`, `.hdbtabledata`, `.hdblogicalschema`, `.hdbmigrationconfig`, `.hdbapplicationtime`, `.hdbsystemversioning`, `.hdbvirtualprocedureconfig`, `.hdbvirtualfunctionconfig`, `.hdbschedulerjob`, `.hdbprojectionviewconfig`, and HDI JSON `.hdbrole` (detected via leading `{`).
- **AST / Parser Trigger:** `parseJsonAstWithErrors(text, options)` records structured recovery errors without aborting the partial AST needed for `HANA-SEC-*`:
  - Empty / comment-only document (no root JSON value) — wait: `.xsapp` MUST allow `{}` (empty object) and optionally empty files? Note: standard valid `.xsapp` is `{}`; flag empty non-whitespace-only or completely empty JSON artifacts ONLY if invalid tokens exist? Wait: an empty `.xsapp` (`""` or whitespace-only `.xsapp`) IS valid in SAP HANA XSC (`samples/` and official XSC docs note empty `.xsapp` is a valid marker file!). Therefore `.xsapp` allows empty/whitespace-only content without emitting `HANA-SYN-010`.
  - Unterminated string `"..."` (reaches EOF or unescaped newline before closing `"`).
  - Unterminated `/* ... */` block comment.
  - Missing `:` after object property key.
  - Missing `,` between object properties or array elements (**disabled when `languageId === 'xssqlcc'`** per documented `.xssqlcc` tolerance in `docs/specs/artifacts/json-formatting.md`).
  - Unmatched or unclosed `{` / `}` / `[` / `]`.
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
    - `BEGIN` (not preceded by `ATOMIC`? Note `BEGIN [SEQUENTIAL EXECUTION | PARALLEL EXECUTION | AUTONOMOUS TRANSACTION]`, all closed by `END`) — pushes `{ kind: 'BEGIN', start, end }`. Note: `EXEC 'BEGIN ... END'` is inside a string literal and automatically ignored; `ALTER SYSTEM ...` has no bare `BEGIN`.
    - `IF` (only when inside a SQLScript body / block stack non-empty, or at statement start in procedure/function/trigger; avoid pushing `IF` inside expressions or DDL phrases like `IF EXISTS` / `IF NOT EXISTS`! Specifically: do NOT treat `DROP ... IF EXISTS`, `CREATE ... IF NOT EXISTS`, `EXISTS`, `NULLIF`, or `IF` immediately preceded by `END` (`END IF`) as block openers! Require `IF` inside a `BEGIN` block OR not preceded by `END` / DDL `CREATE`/`DROP`/`ALTER`/`TRUNCATE` and not followed by `EXISTS` or `(` — note HANA SQLScript `IF <cond> THEN` has `THEN` before next `;` or `END`!) — **Critical Guard:** SQL uses `IF EXISTS` / `IF NOT EXISTS` and scalar function `IF(cond, a, b)` (wait: scalar `IF(...)` does not have `END IF`! Wait: let's verify! In SAP HANA SQL, does `IF` function exist or only `CASE` / `IIF`? Even if someone writes `IF(...)`, `IF` followed immediately by `(` with no `THEN` is NOT a SQLScript `IF ... THEN ... END IF` block unless `THEN` appears at paren-depth 0!). Checking that a block-opening `IF` has a matching `THEN` before `;` (at paren depth 0) guarantees **zero false positives** on `IF EXISTS`, `DROP IF EXISTS`, or hypothetical `IF(...)` calls!
    - `FOR` (statement start when followed by `<ident> IN` or `DECLARE` cursor; NOT `CREATE ... FOR`, `SELECT ... FOR UPDATE`, `LOCK TABLE ... IN ... MODE`, `WAIT FOR`, `END FOR`, `HANDLER FOR`, `TRIGGER ... FOR EACH ROW`! Specifically: push `FOR` ONLY when inside a compound body / statement start, NOT preceded by `END` / `HANDLER` / `LOCK` / `WAIT` / `SELECT` clause / `TRIGGER`, and preceded by `;` / `BEGIN` / `THEN` / `ELSE` / `ELSEIF` / `DO` / comment or start-of-body, AND followed before `;` by `DO` at paren depth 0!). Checking `DO` before `;` and proper preceding delimiter (`;`, `BEGIN`, `THEN`, `ELSE`, `DO`, `:`, statement start) guarantees 100% precision on `FOR ... DO ... END FOR` loops vs `SELECT ... FOR UPDATE` or `HANDLER FOR SQLEXCEPTION` or `GRANT ... ON ... FOR`!
    - `WHILE` (statement start inside body, preceded by statement boundary / `BEGIN` / `THEN` / `ELSE` / `DO` and not `END`, and followed by `DO` before `;`) -> closed by `END WHILE`.
    - `LOOP` (statement start inside body, not preceded by `END`) -> closed by `END LOOP`.
    - `CASE` (expression or statement: whenever keyword `CASE` is encountered not immediately preceded by `END`) -> pushes `{ kind: 'CASE' }` closed by bare `END` (or `END CASE` in SQLScript statement form; note SQL expression `CASE ... END` closes with bare `END`, while statement `CASE ... END CASE` closes with `END CASE`). Wait: handle both cleanly! If `END` is followed by `CASE`, pop `'CASE'`; if `END` is NOT followed by `IF`/`FOR`/`LOOP`/`WHILE`/`CASE`, pop either `'CASE'` or `'BEGIN'` (whichever is on top!).
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

### `HANA-SYN-021` — Misspelled Declaration Header Keyword
- **Severity:** `error`
- **Target Extensions:** All SQL / SQLScript languages, headerless HDI DDL artifacts, and CDS (`.hdbdd`, `.hdbcds`).
- **AST / Token Trigger:** Checked strictly at **anchored keyword positions** (Damerau-Levenshtein edit distance `<= 2`, same leading character or clear prefix truncation `len >= 4`, non-keyword unknown word, never matching a known SAP HANA keyword or column/table identifier position):
  1. Immediately following `CREATE`, `CREATE OR REPLACE`, `ALTER`, or `DROP` in SQL / SQLScript: expected object kind (`PROCEDURE`, `FUNCTION`, `TABLE`, `COLUMN`, `ROW`, `VIEW`, `TRIGGER`, `LIBRARY`, `SEQUENCE`, `INDEX`, `SCHEMA`, `SYNONYM`, `ROLE`, `USER`, `TYPE`, `COLLECTION`, `PROJECTION`, `STATISTICS`, `STRUCTURED`, `VIRTUAL`). E.g. `CREATE FUNC`, `CREATE OR REPLACE PROCEDUR`, `CREATE TABEL`.
  2. Document root / first statement token in headerless HDI artifacts (`.hdbtable`, `.hdbview`, `.hdbfunction`, `.hdbtablefunction`, `.hdbprocedure`, `.hdbtrigger`, `.hdblibrary`, `.hdbsequence`, `.hdbindex`, `.hdbconstraint`, `.hdbprojectionview`, `.hdbstructuredprivilege`, `.hdbvirtualtable`, etc.): checks leading token against expected HDI root keyword (`COLUMN`, `ROW`, `VIEW`, `FUNCTION`, `PROCEDURE`, `TRIGGER`, `LIBRARY`, `SEQUENCE`, `INDEX`, `CONSTRAINT`, `PROJECTION`, `STRUCTURED`, `VIRTUAL`, `TYPE`, etc.) — e.g. `FUNC "my_fn"()` -> QuickFix `FUNCTION`. Also skips if token is `@` annotation, comment, or valid KV syntax in dual-mode `.hdbview`/`.hdbtable`.
  3. Top-level statement starts inside SQLScript body (`RETURN` -> `RETERN`, `DECLARE` -> `DECLRE`, `SIGNAL` -> `SIGNL`, `RESIGNAL`) ONLY when immediately at statement start and structurally invalid (not followed by `=` or identifier assignments like `col := ...`).
  4. Top-level CDS declarations (`.hdbdd`, `.hdbcds`): anchored after optional `@Annotations` / `namespace ...;` / `using ...;` / statement start (`namespace`, `using`, `context`, `entity`, `type`, `view`, `annotate`, `extend`, `define`, `aspect`, `service`) — e.g. `entiy Customer {` -> QuickFix `entity`.
- **QuickFix (`Replace with '<KEYWORD>'`):** Single text replacement preserving capitalization convention (`UPPERCASE` for SQL/HDI DDL, `lowercase` for CDS keywords).
  - **Before:** `CREATE FUNC "MY_FN"() RETURNS INT AS BEGIN RETURN 1; END;`
  - **After:** `CREATE FUNCTION "MY_FN"() RETURNS INT AS BEGIN RETURN 1; END;`

### `HANA-SYN-022` — Malformed Classic Key-Value Artifact
- **Severity:** `error`
- **Target Extensions:** Classic XSC KV formats (`hdbtable`, `hdbview`, `hdbschema`, `hdbsequence`, `hdbstructure`, `hdbti`, `hdbtid`, `hdbtim`, `xshttpdest`, Classic KV `hdbprocedure`).
- **Lexical / Structural Trigger:** At top-level and inside `{ ... }` / `[ ... ]` KV blocks (excluding SQL body inside `/* ... */` or quoted SQL string of `.hdbprocedure`? Wait — Classic KV `.hdbprocedure` assigns `sql = "..."` so keys are still KV!):
  - Statement/entry inside `{ ... }` or top-level (for files using KV syntax, detected by presence of `=` KV pairs or extension unconditionally KV like `.hdbti`, `.hdbschema`, `.hdbsequence`, `.hdbstructure`, `.xshttpdest`) containing a key identifier followed directly by end-of-line/EOF/`}` without `=` or `:` (in `.hdbti` `keys = ["COL": "VAL"]` colons are valid KV element separators inside `[...]`, whereas top-level entries use `=`!).
  - Assignment key `foo =` immediately followed by `;`, `}`, `]`, or EOF without a RHS value.
- **Tolerances (`[XSC]`):**
  - `.hdbview` explicitly permits omitting trailing `;` after the final `public = false` property (`samples/xs-classic/MYVIEW.hdbview`, `samples/format-demos/classic-view.hdbview`) and comma-separated quoted lists after `=`. Never flag missing `;` in KV files!

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
- **Lexical Trigger:** Matches `( )`, `[ ]`, `{ }`, and `${ ... }` pairs outside strings, regex literals, and comments:
  - Unexpected closing delimiter when stack empty or top mismatches (`HANA-SYN-031`).
  - Unclosed opener remaining at EOF (`HANA-SYN-031`).

### `HANA-SYN-032` — Misspelled JS Statement / Declaration Keyword (`.xsjs` / `.xsjslib`)
- **Severity:** `error`
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **Platform Scope:** `[XSC]` `[XSA]`
- **AST / Token Trigger:** Strictly anchored JS token patterns (so normal variable/function names like `var func = 1;` never trigger!):
  - At statement start (after `;`, `{`, `}`, `(optional line start)`), an unknown identifier `W` directly followed by:
    - an identifier + `(` (without `.` / `=` / `:` in between), where `W` is within edit distance `<= 2` of `function` (e.g., `FUNC handleRequest()`, `functon process()`, `funtion helper()`), **OR**
    - `(` when `W` matches a common typo of `if`, `for`, `while`, `switch`, `catch` (only clear edit-distance-1/2 typos like `whlie`, `swich`, `ctach`, NEVER short valid 2-3 letter names that aren't control-flow keywords! Require minimum token length `>= 4` for edit distance matching, plus exact known shorthand typo `FUNC` / `func` before `<ident>(` -> `function`!), **OR**
    - a `{` block immediately after `W` where `W` is a typo of `else` (`esle {`, `els {`), `try` (`tyr {`), `finally` (`finaly {`, `finallly {`), **OR**
    - statement-start typo `retern`, `retrun`, `thrw`, `thro`, `var`? No, avoid 3-letter words like `var`/`try`/`new` unless specifically unambiguous like `tyr {` or `retern <expr>;` (`retern`, `retrun` -> `return`).
- **QuickFix (`Replace with '<keyword>'`):** Replaces the misspelled token with the corrected lowercase JS keyword.
  - **Before:** `FUNC handleGet(req) { return $.net.http.OK; }`
  - **After:** `function handleGet(req) { return $.net.http.OK; }`
