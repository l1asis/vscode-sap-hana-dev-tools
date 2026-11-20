# Conformance Harness Specification (SQL / SQLScript)

**Status:** Active (#76, epic #81)
**Target Platforms:** `[XSC]`, `[XSA]`, `[HDI]`, `[CLOUD]`
**Components under test:** `source.hanasql` TextMate grammar, SQL formatter (`formatDocument`), syntax analyzer (`HANA-SYN-*`)
**Implementation:** `test/helpers/conformance.ts` (checks), `test/conformance.test.ts` (fixture suite), `scripts/conformance.js` (local corpus sweep)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_for_SAP_HANA_Platform/*.md, research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide/*.md, research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQLScript_Reference_for_SAP_HANA_Platform/*.md, research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference/*.md, research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Hierarchy_Developer_Guide/*.md (all pages; ```` ```sql ```` fences only)

---

## 1. Checks

Every check takes one snippet `S` (language `hanasql` unless stated) and returns a list of problems. An empty list means the check passes.

| Check | Name in fixtures | Passes when |
| :--- | :--- | :--- |
| Analyzer | `syntax` | `analyzeDocument(S)` with only `syntax: true` yields zero diagnostics of category `syntax` |
| Formatter | `formatter` | All invariants F1–F5 hold for `F = formatDocument(S, P)` under every profile `P` of §1.1 |
| Grammar | `grammar` | No word of `S` that is a catalog keyword (a `sql-keywords.json` word with at least one role that has a `scope`, see `SPEC_RULES.md` §C.1) is left without a significant scope by `source.hanasql` |
| Catalog | *(report only)* | No `NAME(` call is unknown to both the grammar and `builtin-functions.json` |

### 1.1 Formatter invariants

Every invariant is checked once per option profile (`FORMATTER_PROFILES` in `test/helpers/conformance.ts`). Options a profile does not list keep their defaults.

| Profile | Options | Why |
| :--- | :--- | :--- |
| `default` | none | The shipped settings |
| `narrow` | `maxLineLength: 40` | Forces wrapping, where layout bugs show up that never trigger at 120 columns (#107) |

A violation under a non-default profile has its detail prefixed with `[<profile>]`.

| ID | Kind | Invariant |
| :--- | :--- | :--- |
| F1 | `throw` | `formatDocument` returns for `S` and for `F` |
| F2 | `non-idempotent` | `formatDocument(F, P) === F` |
| F3 | `word-sequence` | `lex(S) === lex(F)` over code lexemes, words case-folded |
| F4 | `comment-sequence` | Comment bodies in order are equal, internal whitespace collapsed |
| F5 | `format-off` | Every `-- hanasql-format off` … `-- hanasql-format on` region (or `off` to end of text) of `S` occurs verbatim in `F` |

`lex` is an independent lexer (no code shared with `src/formatter/tokenizer.ts`):

```text
skip        ::= whitespace
comment     ::= "--" <to end of line> | "/*" <to "*/" or end>
literal     ::= "'" ( <char> | "''" )* "'" | '"' ( <char> | '""' )* '"'     (verbatim)
word        ::= [A-Za-z_ U+00C0-U+FFFF] [A-Za-z0-9_$# U+00C0-U+FFFF]*   (upper-cased)
number      ::= "0" [xX] [0-9A-Fa-f]+ | [0-9]+ ( "." (?!".") [0-9]* )? ( [eE] [+-]? [0-9]+ )?
operator    ::= ".." | "<=" | ">=" | "<>" | "!=" | "||" | "=>" | "::" | ":=" | "->" | <any other char>
```

Trailing whitespace of `S` and `F` is layout and is ignored, also when an unterminated literal runs to the end of the text.

### 1.2 Grammar scope rule

- Tokenize `S` with `source.hanasql`. A word's significant scopes are its scopes minus the grammar root and every `meta.*` scope.
- A word is **unscoped** when it has no significant scope.
- Words inside strings, comments and quoted identifiers carry their own scope and are never unscoped.
- Words directly preceded by `[A-Za-z0-9_$#".:]` (tails of qualified names, variables, `::` system variables) are skipped.
- The check cannot tell keyword position from identifier position. Fixtures must not use catalog keywords as bare identifiers (`content`, `result`, `data`).

### 1.3 Catalog call rule (report only)

A word immediately followed by `(` is an unknown call when it is unscoped, is not in `builtin-functions.json` or `sql-keywords.json`, and is not preceded by a declaring word (`TABLE`, `INTO`, `VIEW`, `FUNCTION`, `PROCEDURE`, `TYPE`, `INDEX`, `ON`, `REFERENCES`, `CALL`, `TRIGGER`, `EXISTS`, `AS`, `UPDATE`, `KEY`, `SEQUENCE`, `SYNONYM`, `LIBRARY`, `WORKSPACE`, `HIERARCHY`, `PARTITION`, `OF`, `FROM`, `JOIN`, `USING`, `DECLARE`, `RETURNS`, `COLUMN`).

---

## 2. Committed fixture suite

Location: `test/fixtures/conformance/<family>.sql`, run by `npm test`.

### 2.1 Fixture format

```text
fixture     ::= header_comment* case+
case        ::= "-- @case " <title> NL directive* <snippet>
directive   ::= "-- @lang " <languageId> NL
              | "-- @todo " ( "syntax" | "formatter" | "grammar" ) " #" <issue> " " <reason> NL
```

- Directives must directly follow the `-- @case` line. The snippet runs to the next `-- @case` or end of file, trimmed.
- Titles are unique per file.
- Snippets are re-authored minimal examples, never copied from the SAP references.
- Every snippet is valid SQL / SQLScript on its tagged platforms.

### 2.2 Pass / known-failure semantics

| Check state | Test result |
| :--- | :--- |
| No `@todo` for the check, passes | pass |
| No `@todo` for the check, fails | **fail** |
| `@todo` for the check, fails | `TODO` (reported, not failing) |
| `@todo` for the check, passes | **fail**: remove the marker in the PR that fixed it |

`@todo` is per check, so a grammar gap never disables the analyzer and formatter checks of the same case. Every false positive fixed under #81 adds or un-marks a fixture case.

---

## 3. Local corpus sweep

`npm run conformance` (= `npm run compile && node scripts/conformance.js`). Never run in CI: `research/` is git-ignored.

1. Extract every ```` ```sql ```` fence of the configured guides (`--corpus <dir>`, repeatable; default: the five guides in the Source line above).
2. Drop templates: a block containing `<identifier>` outside literals, `...` or `…`.
3. Deduplicate by `blockHash` = first 16 hex of SHA-256 over the LF-normalized, trimmed block. The first source in sorted path order wins.
4. Skip blocks listed in `docs/research/conformance-allowlist.json` (`--no-allowlist` to re-audit).
5. A **body excerpt** (no `CREATE [OR REPLACE] PROCEDURE|FUNCTION|LIBRARY|TRIGGER` or `DO` header, and a `HANA-SYN-029` "only allowed inside a routine" diagnostic) is analyzed as `DO BEGIN\n<block>\nEND;`.
6. Run all four checks. Write `research/conformance/report.md` and `report.json`, sorted by count descending, then name or hash ascending, so two runs on the same corpus are byte-identical.

### 3.1 Allowlist

```jsonc
{
  "description": "...",
  "entries": [
    { "hash": "<blockHash>", "reason": "<short justification>", "source": "<guide folder>/<chapter file>" }
  ]
}
```

- An entry means the block is **not valid SQL as extracted**, whatever diagnostics it triggers. A valid block that triggers a false positive is never allowlisted. It stays in the report, and its minimal form becomes a fixture case.
- No corpus text in the file.
- `--propose-allowlist` writes `research/conformance/allowlist-candidates.json` from these classifiers. Candidates are reviewed by hand before they are copied.

| Classifier | Reason |
| :--- | :--- |
| A 95–103 character line with an unclosed quote or unbalanced parentheses | PDF right-margin clipping (`SPEC_RULES.md` rule 7) |
| A syntax diagnostic span contains `‘ ’ “ ” ′ ´ – —` | SAP typo: typographic punctuation |
| `HANA-SYN-005` span starts with `//` | SAP example uses `//` comments |
| `HANA-SYN-041` on a line starting with a digit, quote, `<`, `=`, `[`, starting with `Error`/`Example`/`generated`/`Note`, or ending in `:` / `.` | Result output or prose in the code block |

- Allowlisted hashes no longer present in the corpus are reported as stale.
- Baselines are recorded in `docs/research/CONFORMANCE.md` (numbers only).
