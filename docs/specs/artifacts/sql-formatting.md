# SQL & SQLScript Formatting Specification (`sql-formatting.md`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md (Pages 19–87)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/009_7_Declarative_SQLScript_Logic.md (Pages 88–111)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/010_8_Imperative_SQLScript_Logic.md (Pages 112–219)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 265–290, 341)
> Source: `docs/specs/grammars/sql-sqlscript.md` §4.5 (hierarchy calls), §6 (formatting & HDI root semicolons)

Layout decisions (indent levels, line breaks, list breaking) are project conventions, not SAP syntax. SAP sources are cited only where syntax constrains the formatter (statement shapes, HDI headerless roots). Implementation: `src/formatter/formatter.ts` (layout + render), `src/formatter/tokenizer.ts`, `src/formatter/options.ts`, `src/formatter/dispatch.ts`. Word classes come from the catalog (`docs/specs/SPEC_RULES.md` §C.1) via the generated `src/formatter/keywords.ts`.

---

## 1. Metadata Table

| Item | Value |
| :--- | :--- |
| Language IDs | `SQL_LANGUAGES` in `src/formatter/dispatch.ts`: `hanasql` (`.sql`), `hdbprocedure`, `hdbfunction`, `hdbtablefunction`, `hdbtrigger`, `hdblibrary`, `hdbtabletype`, `hdbprojectionview`, `hdbindex`, `hdbvirtualtable`, ... (32 IDs) |
| Dual-mode IDs | `hdbtable`, `hdbstructure`, `hdbview`, `hdbsequence`: SQL formatter only when `isKeyValueArtifact()` is false. Otherwise `[XSC]` Classic KV (`classic-kv-formatting.md`) |
| Runtime | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` |
| Settings namespace | `hanasql.format.*` (keys 1:1 with `FormatterOptions`) |
| Entry point | `format(text, userOptions, editor, extra)`. `extra.fragment` (range formatting: no final newline, no semicolon add / remove), `extra.initialLevel` (start indent) |
| Dependencies | None (pure TypeScript, AGENTS.md §3.5) |

---

## 2. Pipeline

```text
text ──tokenize()──▶ Token[] ──Layout.run()──▶ Line[] ──render()──▶ string
```

1. **Tokenizer**: `word`, `number`, `string`, `qident`, `var` (`:name`), `sysvar` (`::NAME`), `param` (`?`), `op`, `punct`, `lineComment`, `blockComment`, `other`, `raw`. Each token records `nlBefore` (line breaks before it) and `wsBefore`. A `hanasql-format off` ... `on` region becomes one `raw` token (§9).
2. **Layout**: one pass over the tokens. Keeps a statement state, a stack of blocks (`BEGIN`, `IF`, `CASE`, ...) and a stack of frames (§4). Emits `Line { level, toks, blank, kind: code | comment | raw, hang }`.
3. **Render**: indent = `level × unit` (`unit` = one tab or `indentWidth` spaces), then the tokens with the spacing decided in layout, then wrapping at `maxLineLength` (§4.6). Lines are joined with the resolved EOL.

Source whitespace is discarded except for: `nlBefore` (blank lines, standalone vs trailing comments), `wsBefore` (spacing before `(` after an identifier, `other` tokens), and `raw` regions.

---

## 3. Option Schema

> Source: `src/formatter/options.ts`, `package.json` `contributes.configuration`

Invalid values are ignored and the default is used. Integers are truncated and clamped to their range. Unknown `oneItemPerLine` entries are dropped.

| Option | Type | Default | Allowed values | Effect |
| :--- | :--- | :--- | :--- | :--- |
| `enable` | Boolean | `true` | | `false`: the provider returns no edits. |
| `indentSize` | Integer | `0` | `0`–`16` | Spaces per level. `0` = editor `tabSize` (fallback `4`). |
| `indentStyle` | Enum | `auto` | `auto`, `spaces`, `tabs` | `auto` = editor `insertSpaces`. |
| `keywordCase` | Enum | `upper` | `upper`, `lower`, `preserve` | Words of class `keyword` (§7.1). |
| `functionCase` | Enum | `upper` | same | Built-in function names directly before `(`. |
| `dataTypeCase` | Enum | `upper` | same | Built-in data types. |
| `identifierCase` | Enum | `preserve` | same | Unquoted identifiers and `:var` names. Never quoted identifiers. |
| `maxLineLength` | Integer | `120` | `0`–`1000` | Wrap column (§4.6). `0` = never wrap. |
| `spacesAroundOperators` | Boolean | `true` | | Spaces around binary operators. |
| `spaceAfterComma` | Boolean | `true` | | Space after `,` on the same line. |
| `spacesInsideParentheses` | Boolean | `false` | | `( a )` instead of `(a)`. |
| `spaceBeforeListParenthesis` | Boolean | `true` | | Space before the `(` of a list context (§4.4). |
| `commaPosition` | Enum | `trailing` | `trailing`, `leading` | Comma placement in broken lists. |
| `oneItemPerLine` | Array | `["select", "set", "columnDefinitions", "parameters"]` | `select`, `from`, `groupBy`, `orderBy`, `set`, `columnDefinitions`, `parameters`, `insertColumns`, `values` | Lists broken one item per line (§4.4). |
| `embeddedQueryLayout` | Enum | `hanging` | `hanging`, `aligned`, `newLine` | Query after `<target> =` / `:=` / `RETURN` (§5.1). |
| `beginOnNewLine` | Boolean | `true` | | `BEGIN` on its own line. |
| `procedureHeaderOnSeparateLines` | Boolean | `true` | | One line per routine header clause (§6.1). |
| `joinOnNewLine` | Boolean | `true` | | Join `ON` on its own, indented line. |
| `breakLogicalOperators` | Boolean | `true` | | One line per top-level `AND` / `OR` in `WHERE`, `HAVING`, `ON`. |
| `logicalOperatorPosition` | Enum | `before` | `before`, `after` | `AND` / `OR` starts or ends the line. |
| `caseLayout` | Enum | `multiline` | `multiline`, `inline` | `CASE` expression layout (§6.4). |
| `trailingSemicolon` | Enum | `preserve` | `preserve`, `add`, `remove` | §8.3. |
| `maxConsecutiveBlankLines` | Integer | `1` | `0`–`20` | Cap on kept source blank lines. |
| `blankLinesBetweenTopLevelStatements` | Integer | `1` | `-1`–`20` | Exact blank lines after a top-level statement. `-1` = keep source (capped). |
| `blankLinesBetweenStatements` | Integer | `-1` | `-1`–`20` | Same, inside blocks. |
| `removeBlankLinesAtBlockEdges` | Boolean | `true` | | No blank line after a block opener or before `END`. |
| `insertFinalNewline` | Boolean | `true` | | Ends the document with one EOL (not for fragments). |
| `endOfLine` | Enum | `auto` | `auto`, `lf`, `crlf` | `auto` = editor EOL. |
| `identifierQuotes` | Enum | `preserve` | `preserve`, `removeUnnecessary` | §7.3. |
| `notEqualOperator` | Enum | `preserve` | `preserve`, `<>`, `!=` | Rewrites the other spelling. |
| `spaceAfterCommentMarker` | Boolean | `false` | | `--foo` → `-- foo` (letter or digit after `--`). |

### 3.1 Examples (defaults unless stated, 4-space indent)

#### Indentation and case

```sql
-- indentSize: 2
BEGIN
  x = 1;
END

-- keywordCase: lower                  -- functionCase: lower
select a                               SELECT coalesce(a, 0)
from t                                 FROM t

-- dataTypeCase: lower                 -- identifierCase: upper
SELECT CAST(a AS nvarchar(10))         SELECT COL_A, "MixedCase"
FROM t                                 FROM TAB
```

#### Spacing

```sql
-- spacesAroundOperators: false, spacesInsideParentheses: true, spaceAfterComma: false
SELECT a+b,f( x )
FROM t
WHERE ( a=1 )

-- spaceBeforeListParenthesis: false
CREATE COLUMN TABLE t(
    a INT,
    b INT
)
```

#### Lists (`select a, b from t1, t2 order by a, b`)

```sql
-- default                -- commaPosition: leading     -- oneItemPerLine: ["from", "orderBy"]
SELECT                    SELECT                        SELECT a, b
    a,                        a                         FROM
    b                       , b                             t1,
FROM t1, t2               FROM t1, t2                       t2
ORDER BY a, b             ORDER BY a, b                 ORDER BY
                                                            a,
                                                            b
```

`columnDefinitions` removed: `CREATE COLUMN TABLE t (a INT, b INT)`. `insertColumns` added: `INSERT INTO t (` ⏎ `a,` ⏎ `b` ⏎ `)`. `values` added: `VALUES (` ⏎ `1,` ⏎ `2` ⏎ `)`.

#### Layout

```sql
-- beginOnNewLine: false               -- procedureHeaderOnSeparateLines: false
CREATE PROCEDURE p                     CREATE PROCEDURE p (IN a INT) LANGUAGE SQLSCRIPT READS SQL DATA AS
AS BEGIN                               BEGIN
    x = 1;                                 x = 1;
END                                    END

-- joinOnNewLine: false                -- caseLayout: inline
SELECT a                               SELECT CASE WHEN a = 1 THEN 'x' ELSE 'y' END AS c
FROM t                                 FROM t
INNER JOIN u ON t.id = u.id

-- logicalOperatorPosition: after      -- breakLogicalOperators: false
SELECT a                               SELECT a
FROM t                                 FROM t
WHERE x = 1 OR                         WHERE x = 1 OR y = 2
    y = 2
```

#### Line length (`maxLineLength: 40`, `breakLogicalOperators: false`)

```sql
SELECT a
FROM t
WHERE customer_id = :iv_customer
    AND created_at > CURRENT_DATE
```

#### Semicolons and blank lines

```sql
-- trailingSemicolon: add (source "begin x = 1 end")     -- trailingSemicolon: remove (source "select 1 from dummy;")
BEGIN                                                    SELECT 1
    x = 1;                                               FROM dummy
END;

-- blankLinesBetweenTopLevelStatements: 0                -- removeBlankLinesAtBlockEdges: false
SELECT 1                                                 BEGIN
FROM dummy;
SELECT 2                                                     x = 1;
FROM dummy;
                                                         END
```

#### Misc

```sql
-- identifierQuotes: removeUnnecessary    -- notEqualOperator: "<>"    -- spaceAfterCommentMarker: true
SELECT COL_A, "col_b", "ORDER"            WHERE a <> 1                  -- foo
FROM "SCHEMA"."T"                             AND b <> 2
```

`embeddedQueryLayout` examples: §5.1.

---

## 4. Layout Model

> Source: `src/formatter/formatter.ts` (`Layout`, `Frame`, `clauseWord`, `render`)

### 4.1 Levels

- The **statement level** `L` is the number of open blocks (`BEGIN`, `IF`, `FOR`, ...) plus `extra.initialLevel`.
- Every line has an integer `level`. Render indent = `level × unit`. `aligned` lines also carry a space pad (§5.1).
- A line's **base** is the level that nested content on it is relative to. It equals `level`, except on the prefix line of a `hanging` embedded query (§5.1), where it is `level + 1`.

### 4.2 Frames

Each statement starts with one `stmt` frame. `(` pushes a frame and `)` pops it.

| Frame | Pushed by | Clause level | Lines inside | `)` |
| :--- | :--- | :--- | :--- | :--- |
| `stmt` | statement start | `L` | `L + 1` after a clause keyword | |
| `sub` | `(` followed by `SELECT` / `WITH` | `base + 1` | as `stmt` | own line at `base` |
| `list` | `(` of a list context in `oneItemPerLine` (§4.4) | parent | `base + 1` | own line at `base`, if the list broke |
| `hier` | `(` of `HIERARCHY*` functions (`sql-sqlscript.md` §4.5) | `base + 1` | one clause per line | own line at `base` |
| `plain` | any other `(` | parent | parent | inline |

`base` is the base of the line holding the `(`. Clause keywords (§4.3) are recognised in `stmt` and `sub` frames only. Words inside `plain` and `list` frames never start a clause.

### 4.3 Clause Keywords

A clause keyword starts a new line at the frame's clause level. The lines that follow, until the next clause keyword, are at clause level `+ 1`.

| Keyword | Condition | Notes |
| :--- | :--- | :--- |
| `SELECT` | always | Stays on the current line when the line is empty, after a set operator, or after an embedded-query prefix (§5.1). Otherwise starts a line. |
| `DISTINCT`, `ALL`, `TOP n` | directly after `SELECT` | Stay on the `SELECT` line. The select list starts after them. |
| `FROM` | the frame has a `SELECT` | `DELETE FROM` stays inline. |
| `WHERE`, `HAVING`, `LIMIT` | always | |
| `GROUP BY`, `ORDER BY` | next word is `BY` | Window `PARTITION BY` / `ORDER BY` inside `OVER (...)` are in a `plain` frame and stay inline. |
| `INTO` | after `SELECT`, not in `FROM` / `WHERE` | `SELECT ... INTO lv FROM ...` |
| `UNION`, `INTERSECT`, `EXCEPT`, `MINUS` | after a query | Own line. `ALL` / `DISTINCT` stay on it. The next `SELECT` starts a new line at the same level. |
| `INNER`, `LEFT`, `RIGHT`, `FULL`, `CROSS`, `NATURAL`, `JOIN` | in `FROM` / join / `ON` | Starts the join phrase. `LEFT(` / `RIGHT(` (functions) are not joins. |
| `ON` | after a join or `FROM` | `joinOnNewLine`: own line at clause level `+ 1`. |
| `WITH` | first word of a statement, or after an embedded-query prefix (§5.1) | CTE list: each `,` between CTEs breaks to the clause level. Not recognised as the first word inside `( ... )`. |
| `VALUES` | `INSERT` / `UPSERT` / `REPLACE`, statement frame | |
| `SET` | `UPDATE`, statement frame | |
| `USING`, `ON`, `WHEN` | `MERGE`, statement frame | `WHEN [NOT] MATCHED` lines at clause level. |

```sql
SELECT
    o.order_id,
    o.customer_id
FROM orders o
INNER JOIN order_items i
    ON o.order_id = i.order_id
WHERE o.customer_id = :iv_customer
    AND o.status = 'A'
GROUP BY o.order_id, o.customer_id
ORDER BY o.order_id DESC
```

### 4.4 Lists

A list is broken one item per line only when its context is in `oneItemPerLine` **and** it has a top-level comma. Single-item lists stay inline (`SELECT a`, `PROCEDURE p (IN a INT)`). When the first comma arrives, the items already emitted move to a new line at item level, and every line created since then is shifted by the same delta.

| Context | Container | Item level |
| :--- | :--- | :--- |
| `select` | after `SELECT [DISTINCT \| ALL] [TOP n]` | clause level `+ 1` |
| `from` | after `FROM` | clause level `+ 1` |
| `groupBy`, `orderBy` | after `GROUP BY` / `ORDER BY` | clause level `+ 1` |
| `set` | after `UPDATE ... SET` | clause level `+ 1` |
| `parameters` | first `(` after the routine name in `CREATE` / HDI `PROCEDURE` / `FUNCTION` | `base + 1` |
| `columnDefinitions` | first `(` after the table name in `CREATE TABLE`, `TABLE (` in `CREATE` / `DECLARE` (`RETURNS TABLE (...)`, `DECLARE lt TABLE (...)`) | `base + 1` |
| `insertColumns` | first `(` after the target name in `INSERT` / `CREATE VIEW` | `base + 1` |
| `values` | `(` after `VALUES` | `base + 1` |

`commaPosition: leading` puts `,` first on each item line and outdents it by 2 columns (space indentation, `indentWidth ≥ 2`, level `> 0`), so the item text stays aligned. A trailing comment of the previous item stays on the previous line.

### 4.5 Continuation Lines

- `AND` / `OR` at the top of a `WHERE`, `HAVING` or `ON` clause break to clause level `+ 1` (`breakLogicalOperators`, `logicalOperatorPosition`). They do not break inside a `CASE` expression of the same frame, or inside `plain` / `list` parentheses (a `sub` frame has its own clauses).
- `BETWEEN x AND y`: that `AND` never breaks (and is not a wrap candidate).
- `ON`: see §4.3.

### 4.6 Wrapping (`maxLineLength > 0`)

Applied per rendered line after layout. Wrap candidates, by priority:

1. after `,`
2. before `AND` / `OR` (not the `BETWEEN` one)
3. before binary `||`, `+`, `-`, `*`, `/`, `%`

The break is chosen at the lowest parenthesis depth, then the highest priority, then the rightmost position that fits. Continuation lines are at `base + 1` (`aligned` lines keep their pad). Never: before `)` or `;`, next to a comment, or after the leading comma of a `hang` line. A token longer than the limit stays on its line (the line may exceed `maxLineLength`).

---

## 5. Embedded Queries

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/009_7_Declarative_SQLScript_Logic.md (Pages 88–111): table variable assignment `<table_variable> = <select_statement>`, `<proc_table_default> ::= { DEFAULT | '=' } { <select_statement> | ... }`
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md (Pages 19–87): `<func_return_statement> ::= RETURN <function_return_expr>`, `<func_return_expr> ::= <table_variable> | <subquery>`

| Source shape | Layout |
| :--- | :--- |
| `lt = SELECT ...`, `lt := SELECT ...`, `lt = WITH ...` | `embeddedQueryLayout` (§5.1) |
| `RETURN SELECT ...`, `RETURN WITH ...` | `embeddedQueryLayout` (§5.1) |
| `lv := (SELECT ...)`, `lt = (SELECT ...)`, `IN (SELECT ...)`, `EXISTS (SELECT ...)`, `FROM (SELECT ...) x` | `sub` frame: body one level deeper, `)` back at the base (§4.2) |
| `CREATE VIEW v AS SELECT ...` | `AS` ends the line, `SELECT` starts a line flush with the statement |
| `DECLARE CURSOR c FOR SELECT ...` | `FOR` ends the line, `SELECT` flush |
| `DECLARE lt TABLE (...) = SELECT ...` / `DEFAULT SELECT` | `=` / `DEFAULT` ends the line, `SELECT` flush |
| `INSERT INTO t (...) SELECT ...` | `SELECT` flush on its own line |
| `WITH a AS (...), b AS (...) SELECT ...` | each CTE `sub` frame; `,` breaks to the clause level; main `SELECT` flush |
| `... UNION [ALL] SELECT ...` | set operator on its own line at the clause level; next `SELECT` at the same level |

```sql
CREATE VIEW v AS
SELECT
    a,
    b
FROM t
WHERE x = 1

SELECT a
FROM t
WHERE a IN (
    SELECT b
    FROM u
    WHERE c = 1
)
```

### 5.1 `embeddedQueryLayout` `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`

**Trigger.** In the statement frame (not inside parentheses), the next word is `SELECT` or `WITH`, and the statement so far is either

- at most three code tokens ending with `=` or `:=` (`lt =`, `:lt =`, `lt :=`), or
- exactly `RETURN`.

The tokens before `SELECT` / `WITH` are the **prefix**. Parenthesised queries (`lv := (SELECT ...)`) are not affected: they are `sub` frames.

**Values.** `L` = statement level, `w` = `indentWidth`.

| Value | Prefix line | Clauses | Lists, `ON`, `AND` / `OR` | Nested `(...)` on the prefix line |
| :--- | :--- | :--- | :--- | :--- |
| `hanging` (default) | `SELECT` / `WITH` stays on it | `L + 1` | `L + 2` | relative to `L + 1` (the prefix line's base) |
| `aligned` | `SELECT` / `WITH` stays on it | column of `SELECT` / `WITH` | that column `+ w` | relative to that column |
| `newLine` | ends after `=` / `:=` / `RETURN` | `L + 1` (`SELECT` starts the line) | `L + 2` | n/a |

The layout applies to every clause of the query: `WITH` CTEs and their `,`, the main `SELECT`, set operators and the `SELECT` after them, `INTO`, joins, `ON`, `AND` / `OR` continuations, `sub` frames (indented relative to the new base) and wrapped continuation lines. The terminating `;` stays on the last line.

```sql
-- hanging (default)
    lt = SELECT
            o.order_id,
            o.customer_id
        FROM orders o
        INNER JOIN order_items i
            ON o.order_id = i.order_id
        WHERE o.customer_id = :iv_customer
        ORDER BY amount DESC;

-- aligned
    lt = SELECT
             o.order_id,
             o.customer_id
         FROM orders o
         INNER JOIN order_items i
             ON o.order_id = i.order_id
         WHERE o.customer_id = :iv_customer
         ORDER BY amount DESC;

-- newLine
    lt =
        SELECT
            o.order_id,
            o.customer_id
        FROM orders o
        WHERE o.customer_id = :iv_customer;
```

`WITH`, set operators and nested queries:

```sql
-- hanging                          -- aligned                       -- newLine
    lt = WITH c AS (                    lt = WITH c AS (                 lt =
            SELECT a                             SELECT a                    WITH c AS (
            FROM t                               FROM t                          SELECT a
        )                                    )                                   FROM t
        SELECT a                             SELECT a                        )
        FROM c                               FROM c                          SELECT a
        UNION ALL                            UNION ALL                       FROM c
        SELECT b                             SELECT b                        UNION ALL
        FROM u;                              FROM u;                         SELECT b
                                                                             FROM u;

-- hanging: a sub-query in the prefix line is relative to L + 1
    RETURN SELECT a
        FROM (
            SELECT a
            FROM t
        ) s
        WHERE a > 0;
```

**Fallbacks.**

| Condition | Result |
| :--- | :--- |
| `aligned` and indentation resolves to tabs (`useTabs`) | `hanging`. A column cannot be reached with tabs. |
| `aligned`, `maxLineLength > 0`, and the 0-based column of `SELECT` / `WITH` is greater than `⌊maxLineLength / 2⌋` | `hanging`. A long prefix would push the query into the right half. |
| A line comment ends the prefix line (`lt = -- note` ⏎ `SELECT ...`) | `newLine`, for every value. |

**Out of scope.** `CREATE VIEW ... AS`, `DECLARE CURSOR ... FOR`, `DECLARE ... = / DEFAULT` and `INSERT ... SELECT` keep the flush layout of §5. Their `SELECT` is on its own line, so the clauses do not read as a new statement. The previous behaviour (`SELECT` inline, clauses at `L`) is not offered as a value: it made the clauses look like separate statements.

---

## 6. Statements & Blocks

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md (Pages 19–87)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/010_8_Imperative_SQLScript_Logic.md (Pages 112–219)

### 6.1 Routine Headers

`CREATE [OR REPLACE] PROCEDURE | FUNCTION | LIBRARY` and the headerless HDI forms `[HDI]` (`PROCEDURE "p" ...`, `FUNCTION "f" ...`).

- Parameters: `parameters` list (§4.4).
- `procedureHeaderOnSeparateLines`: `LANGUAGE`, `SQL SECURITY`, `DEFAULT SCHEMA`, `READS SQL DATA`, `MODIFIES SQL DATA`, `DETERMINISTIC`, `RETURNS`, `AS` each start a line at `L`. Not inside the parameter list. `DEFAULT` only before `SCHEMA`, `SQL` only before `SECURITY` and not after `READS` / `MODIFIES`.
- `RETURNS TABLE (...)`: `columnDefinitions` list.
- `USING <lib> AS <alias>;` between `AS` and `BEGIN` is its own statement at `L`.
- `beginOnNewLine`: `BEGIN` starts a line. `false`: it stays after `AS`. `DO BEGIN` always stays together.

```sql
CREATE PROCEDURE p (
    IN a INT,
    OUT b INT
)
LANGUAGE SQLSCRIPT
SQL SECURITY INVOKER
DEFAULT SCHEMA s
READS SQL DATA
AS
BEGIN
    b = :a;
END
```

### 6.2 Blocks

| Opener | Header ends at | Body level | Closer |
| :--- | :--- | :--- | :--- |
| `BEGIN [SEQUENTIAL EXECUTION \| PARALLEL EXECUTION \| AUTONOMOUS TRANSACTION \| ATOMIC]` | the modifiers | `L + 1` | `END` |
| `IF <cond> THEN` | `THEN` | `L + 1` | `ELSEIF <cond> THEN` / `ELSE` at `L`, `END IF` |
| `WHILE <cond> DO`, `FOR ... DO` | `DO` | `L + 1` | `END WHILE` / `END FOR` |
| `LOOP` | `LOOP` | `L + 1` | `END LOOP` |
| `CASE <expr>` (statement) | `CASE` line | `WHEN ... THEN` at `L + 1`, body at `L + 2` | `ELSE` at `L + 1`, `END CASE` at `L` |

`IF`, `WHILE`, `FOR`, `LOOP` and statement `CASE` are recognised only as the first word of a statement in the statement frame. `BEGIN` opens a block anywhere in the statement frame (`AS BEGIN`, `DO BEGIN`). A condition that contains a query (`IF EXISTS (SELECT ...) THEN`) uses a `sub` frame.

```sql
BEGIN
    IF :a = 1 THEN
        x = 1;
    ELSEIF :a = 2 THEN
        x = 2;
    ELSE
        x = 3;
    END IF;
    FOR i IN 1..10 DO
        x = :x + 1;
    END FOR;
    CASE :a
        WHEN 1 THEN
            x = 1;
        ELSE
            x = 3;
    END CASE;
END
```

### 6.3 Other Statements

`UPDATE ... SET ... WHERE`, `MERGE INTO ... USING ... ON ... WHEN [NOT] MATCHED THEN ...`, `INSERT ... VALUES` follow §4.3. DDL and administration statements (`CREATE TABLE`, `ALTER SYSTEM ...`, `GRANT`, ...) have no clause keywords: they stay on one line (wrapped at `maxLineLength`) except for their list contexts.

### 6.4 `CASE` Expressions

`CASE` that is not the first word of a statement is an expression. `caseLayout: multiline`: each `WHEN` and `ELSE` starts a line at `base + 1` of the line holding `CASE`, `END` returns to that base. `inline`: no breaks (only wrapping).

```sql
SELECT
    CASE
        WHEN a = 1 THEN 'x'
        ELSE 'y'
    END AS c,
    b
FROM t
```

---

## 7. Tokens: Case & Spacing

### 7.1 Word Classes

| Class | Rule | Option |
| :--- | :--- | :--- |
| `ident` | next to `.` (`t.select`, `s.f(`), or no other class applies | `identifierCase` |
| `function` | in catalog `FUNCTIONS` and followed by `(`. If the word is also a type, it is a type after an identifier, a quoted identifier or `AS` (`CAST(a AS DECIMAL(10))`) | `functionCase` |
| `type` | in catalog `TYPES` | `dataTypeCase` |
| `keyword` | catalog `KEYWORDS`; `YEAR` ... `SECOND` before `FROM` (`EXTRACT(YEAR FROM d)`); statement nouns in the first 6 tokens of a DDL verb statement or HDI root; `ALTER SYSTEM` words; `HIERARCHY*` clause / option words in their slot (`sql-sqlscript.md` §4.5) | `keywordCase` |

String prefixes are upper-cased (`n'abc'` → `N'abc'`). String bodies, quoted identifiers and comments are never changed. `::SYSVAR` names follow `keywordCase`.

### 7.2 Spacing

- No space before `,` `;` `.` `..` `)` `]` or after `(` `[` `.` (except `spacesInsideParentheses` for `(` `)`).
- `(`: no space after a function, a type, `HINT` or a unary operator; a space after a keyword; after an identifier or a quoted identifier, as in the source. List-context `(` follows `spaceBeforeListParenthesis`.
- `+` / `-` are unary when the previous token is not value-like. `*` after a non-value is a wildcard (`COUNT(*)`, `t.*`). With `spacesAroundOperators: false`, `- -` and `/ *` keep a space so they never form a comment.

### 7.3 Identifier Quotes

`removeUnnecessary` unquotes `"NAME"` when the name matches `^[A-Z_][A-Z0-9_]*$`, is not catalog `PROTECTED` (reserved words and quote-protected words), and is not next to `.` (qualified names keep their quotes).

---

## 8. Comments, Blank Lines & Semicolons

### 8.1 Comments

- **Standalone** (a line break before it, or first in the file): own line. Between statements at `L`. Inside a statement at the indent of the next line.
- **Trailing**: stays on the line of the previous token. A line comment ends the line.
- Multi-line block comments: if every inner line starts with `*`, the inner lines are re-indented to the comment's indent `+ 1` space; otherwise they are kept verbatim. Trailing whitespace is removed.

### 8.2 Blank Lines

Before each top-level statement: `blankLinesBetweenTopLevelStatements` (if `≥ 0`), inside blocks `blankLinesBetweenStatements` (if `≥ 0`). Otherwise the source count, capped at `maxConsecutiveBlankLines`. A standalone comment without a blank line before the next statement stays attached to it. `removeBlankLinesAtBlockEdges` drops blank lines after a block opener and before `END`.

### 8.3 Semicolons

- `;;` → `;`.
- `add` (not for fragments): terminates every statement before `END`, `ELSE`, `ELSEIF`, `WHEN` (statement `CASE`), and at end of input. Never after an `IF` / `WHILE` / `CASE` header, and never after the root statement of a headerless HDI artifact `[HDI]` (`PROCEDURE "p" ... END`, `TYPE "t" AS TABLE (...)`, `PROJECTION VIEW ...`, the roots in `sql-sqlscript.md` §6, `artifactRoots` in the catalog).
- `remove` (not for fragments): removes only the last `;` of the document, before a `raw` region stops the search.

---

## 9. Safety Invariants

| Invariant | Mechanism / test |
| :--- | :--- |
| Never corrupt valid code: the output has the same token sequence as the input, apart from documented rewrites (case, quotes, `<>` / `!=`, `;` add / remove / dedupe) | `test/conformance.test.ts`, `npm run conformance` (`word-sequence` check) |
| Never strip or reorder comments | §8.1 |
| No `;` appended to headerless HDI root statements `[HDI]` | §8.3, `test/format.test.ts` |
| `-- hanasql-format off` ... `-- hanasql-format on` (also `/* hanasql-format off */`, optional `:`) is copied verbatim, including its whitespace. An unterminated `off` runs to end of file | `tokenizer.ts` `collapseFormatOff` |
| Idempotent: `format(format(x)) === format(x)` for every option set | `test/format.test.ts`, conformance harness |
| `[XSC]` Classic KV content in dual-mode files is never given to the SQL formatter | `isKeyValueArtifact()` |

---

## 10. Platform Notes

| Platform | Note |
| :--- | :--- |
| `[XSC]` | `.hdbprocedure` bodies, `.hdbview` / `.hdbtable` SQL DDL variants. KV variants use `classic-kv-formatting.md`. |
| `[XSA]` `[HDI]` | Headerless roots without `CREATE` (`PROCEDURE "p" ...`, `FUNCTION`, `VIEW`, `COLUMN TABLE`, `TYPE`, `PROJECTION VIEW`, ...) are formatted like their `CREATE` forms and never get a root `;` (§8.3). `USING ... AS ...;` before `BEGIN` keeps the HDI root state. |
| `[CLOUD]` | No layout differences. Cloud-only words (`REAL_VECTOR`, ...) are cased through the catalog. |

---

## 11. Known Gaps & Non-Goals

- No AST: layout is a single token pass with frame and block heuristics. Invalid SQL is laid out on a best-effort basis but never loses tokens.
- A standalone comment between clauses is indented at the previous clause's continuation level (a `-- c` line after `FROM t` is indented one level deeper than the following `WHERE`).
- DDL statements (`CREATE TABLE ... PARTITION BY ...`, `ALTER TABLE ...`, `GRANT ...`) get no clause layout beyond list contexts and wrapping.
- `WINDOW` clauses and `OVER (...)` windows are not broken.
- `WITH` as the first word inside parentheses (`(WITH a AS (...) SELECT ...)`) is not a clause keyword, so its CTE commas do not break.
- `blankLinesBetweenTopLevelStatements` also applies between `USING ...;` and `BEGIN` of an HDI routine.
- No alignment of `AS` aliases or `=` signs, and no vertical alignment except `embeddedQueryLayout: aligned`.
- Embedded SQL in other hosts (`.hdbview` KV `query = "..."`, CDS, `.xsjs` strings) is not formatted.
