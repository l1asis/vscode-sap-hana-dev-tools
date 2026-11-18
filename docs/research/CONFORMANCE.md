# SQL / SQLScript Conformance Baselines

Numbers only, no corpus text. Method: [`docs/specs/diagnostics/conformance-harness.md`](../specs/diagnostics/conformance-harness.md). Re-run with `npm run conformance` (local corpus required) and append a new section, newest first, when a change under #81 moves a number.

## 2026-11-18: unified word catalog (#77), against `main` @ `9c0a9e2` (0.10.3)

| Metric | `main` | #77 |
| :--- | ---: | ---: |
| Analyzer: blocks with ≥1 syntax error | 474 | 474 |
| Formatter: blocks with violations | 1 | 1 |
| Grammar: unscoped catalog keywords | 109 (1036 blocks) | 111 (1046 blocks) |
| Catalog: unknown called names | 75 | 75 |
| `npm test`: tests / pass / todo | 388 / 355 / 33 | 398 / 365 / 33 |

The grammar count grew because the catalog grew, not because highlighting got worse. `REPLICA`, `LOADABLE` and `SNAPSHOT`, which the formatter already knew as statement nouns, are now catalog keywords and are measured too. Counted over `main`'s keyword list the figure is 108: `ALTER SYSTEM SAVEPOINT` no longer highlights only `SAVE`. The 23 SQLScript / GraphScript built-ins (`MAP_MERGE`, `VERTICES`, ...) left the keyword list for the function list. They are highlighted only before `(`, as before.

## Baseline: 2026-11-18, `main` @ `02c9439` (0.10.2)

Corpus: SAP HANA Platform SQL Reference, SAP HANA Cloud SQL Reference, both SQLScript References, SAP HANA Cloud Hierarchy Developer Guide (`sql` fences only).

| Metric | Value |
| :--- | :--- |
| `sql` fenced blocks | 5084 |
| Templates skipped (`<placeholder>`, `...`) | 657 |
| Unique runnable blocks | 3167 |
| Allowlisted as corpus noise | 310 (233 PDF clipping, 47 result output / prose, 25 typographic punctuation, 7 `//` comments) |
| Evaluated | 2857 |
| SQLScript excerpts evaluated inside `DO BEGIN ... END` | 62 |
| Analyzer: blocks with ≥1 syntax error | 475 (16.6%) |
| Formatter: blocks with violations | 2 (`word-sequence` 2: one real defect, #88; one prose block) |
| Formatter: throws / non-idempotent / comment loss / format-off changes | 0 / 0 / 0 / 0 |
| Grammar: unscoped catalog keywords | 109 distinct (in 1036 blocks) |
| Catalog: unknown called names | 75 |

### Analyzer: blocks per rule

| Rule | Blocks |
| :--- | ---: |
| `HANA-SYN-020` | 155 |
| `HANA-SYN-023` | 110 |
| `HANA-SYN-024` | 81 |
| `HANA-SYN-003` | 57 |
| `HANA-SYN-025` | 49 |
| `HANA-SYN-041` | 36 |
| `HANA-SYN-029` | 31 |
| `HANA-SYN-005` | 17 |
| `HANA-SYN-001` | 16 |
| `HANA-SYN-040` | 13 |
| `HANA-SYN-021` | 11 |
| `HANA-SYN-006` | 10 |
| `HANA-SYN-028` | 8 |
| `HANA-SYN-027` | 6 |
| `HANA-SYN-042` | 6 |

The remaining analyzer count still includes unclassified noise: SQLScript fragments that cannot be wrapped (`ELSE ... END IF;` without its `IF`), function bodies whose `CREATE` header was split off by extraction, and SAP typos. Confirmed false positives on valid SQL are tracked as `@todo syntax` fixture cases (see below).

### Grammar: most frequent unscoped keywords (blocks)

`RANGE` 100, `HINT` 80, `SOURCE` 66, `TO` 63, `DATA` 62, `AT` 56, `CREDENTIAL` 50, `RESULT` 46, `ENABLE` 43, `CACHE` 38, `FILE` 38, `HASH` 38, `CLASS` 37, `THREADS` 36, `TARGET` 35, `LOCATION` 32, `OF` 29, `PATH` 29, `INCREMENT` 28, `SYSTEM` 26.

The check covers every single-word catalog keyword and cannot tell keyword from identifier position, so words such as `RESULT`, `TARGET` and `CONTENT` include column and table names. This is a wider measurement than the 24 keywords of the manual sweep in #76.

### Committed fixture suite (`test/conformance.test.ts`)

| Metric | Value |
| :--- | :--- |
| Fixture files / cases | 7 / 91 |
| Cases passing every check | 61 |
| Cases with known failures | 30 |
| `@todo` markers | 35: `syntax` 10 (#78 ×9, #88 ×1), `formatter` 1 (#88), `grammar` 24 (#79 ×22, #75 ×2) |

Analyzer false positives on valid SQL, seeded as `@todo syntax`:

- From the #76 manual sweep: `0x` hex literal (#88), `SERIES_GENERATE(SERIES TABLE ...)`, `UNIQUE BTREE`, `TEXT FAST PREPROCESS OFF`, `CONNECT RESTRICTION (... IP (...) APPLICATION (...))`, `SET PARAMETER ... ENABLE PARAMETER SET`.
- New in this baseline: `ALTER TABLE ... ALTER (<column> <type>)`, parameterized `CREATE VIEW v (IN p ...)`, `EXPLAIN PLAN SET STATEMENT_NAME = ... FOR`, `BEGIN AUTONOMOUS TRANSACTION ... END`.
- Fixed since the manual sweep and now passing: `ALTER SYSTEM ALTER CONFIGURATION ... WITH RECONFIGURE` (#60, grammar gap remains), `AND LEFT(...)` / `RIGHT(...)` (#73).
