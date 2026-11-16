# AGENTS.md — vscode-sap-hana-dev-tools

## 1. Project Overview

VS Code language support, formatters, static analyzers, and tooling for **SAP HANA XS Classic (`[XSC]`)**, **XS Advanced (`[XSA]`)**, **HDI (`[HDI]`)**, and **SAP HANA Cloud (`[CLOUD]`)**.

## 2. Repository Map

- `syntaxes/` — TextMate grammars (`*.tmLanguage.json`).
- `scripts/` — Code/grammar generators (`build-grammars.js`, `build-keywords.js`).
- `src/` — Extension source, AST formatters, offline analyzers, and DB connectivity.
- `test/` — Headless unit and integration tests (`*.test.ts`, run via `npm test`).
- `samples/` — Sample SAP HANA artifacts for manual and automated testing.
- `docs/specs/` — Distilled, version-controlled technical specifications, governed by `docs/specs/SPEC_RULES.md`.
- `docs/research/CHECKLIST.md` — Extraction tracking checklist for the reference corpus.
- `research/refs/extracted/` — **(Git-ignored local corpus)** Official SAP HANA reference guides split into chapter-level Markdown files.

## 3. Core Operating Rules

1. **Spec-First Development:** Before implementing or modifying a grammar (`syntaxes/`), formatter, linter rule, or API client (`src/`), read its spec in `docs/specs/`. If missing or incomplete, extract it from `research/refs/extracted/` first following `docs/specs/SPEC_RULES.md`.
2. **Search Before Reading:** Never read entire folders in `research/refs/extracted/` blindly. Use `ripgrep` (`rg -i "<keyword>" research/refs/extracted/`) to locate the exact chapter `.md` file first.
3. **Never Commit `research/`:** Everything under root `research/` is local scratchpad data and must remain untracked. Only commit distilled specs in `docs/specs/` and updates to `docs/research/CHECKLIST.md`.
4. **Platform Tagging:** Always distinguish between `[XSC]`, `[XSA]`, `[HDI]`, and `[CLOUD]` syntax variants in specs and code comments.
5. **Zero Runtime Dependencies for Parsers:** Keep lexers, formatters, and static analyzers dependency-free in pure TypeScript.

## 4. Coding & Build Conventions

- **Strict TypeScript:** `strict: true` in `tsconfig.json`. Avoid `any`; use discriminated unions for AST nodes and tokens.
- **Generated Artifacts Sync:**
  - Never hand-edit generated files in `syntaxes/`. Edit `scripts/build-grammars.js` and run `npm run build:grammars`.
  - After updating SQL keyword/function lists, run `npm run build:keywords`.
- **Formatting Safety:** Formatters must never corrupt valid code, strip comments, append semicolons to headerless HDI root statements, or break `-- hanasql-format off` pragmas.
- **Testing:** Every new grammar rule, formatter feature, or diagnostic rule must include positive and negative test cases in `test/` and pass `npm test`.

## 5. Git & Branching Workflow

1. **Feature Branches:** Never commit feature or fix work directly to `main`. Branch first using `feat/<slug>`, `fix/<slug>`, or `docs/<slug>`.
2. **Incremental Atomic Commits:** Commit logical units separately (e.g., 1st: spec in `docs/specs/`; 2nd: implementation + regenerated artifacts; 3rd: samples & tests).
3. **Conventional Commits with Emojis (Mandatory):**
   Format all commit messages and PR titles as:
   `<type>(<scope>): <emoji> <concise description in imperative mood>`

   | Type | Emoji | Usage |
   | :--- | :---: | :--- |
   | `feat` | ✨ | New grammar, formatter capability, LSP feature, or artifact support |
   | `fix` | 🐛 | Bug fix in highlighting, formatting, or parser edge cases |
   | `docs` | 📝 | Documentation (`README.md`, `ROADMAP.md`, `docs/specs/*`) |
   | `test` | ✅ | Adding or updating unit tests and sample fixtures |
   | `refactor` | ♻️ | Internal code restructuring without behavior change |
   | `perf` | ⚡ | Lexer, parser, or formatter performance optimization |
   | `build` | 📦 | Build scripts, dependencies, or VSIX packaging |
   | `ci` | 👷 | GitHub Actions workflows (`.github/workflows/*`) |
   | `chore` | 🔧 | Maintenance, label setup, config, or release preparation |

## 6. GitHub CLI (`gh`) Issue, Label & PR Management

1. **Labels:** Run `gh label list` before creating issues or PRs and assign accurate existing labels (`area:*`, `platform:*`, `phase:*`). Create missing category labels only when genuinely needed (`gh label create "<name>" --color "<hex>" --description "<desc>" --force`).
2. **Issues:** Check `gh issue list` to avoid duplicates, create structured issues (`gh issue create --title '...' --label '...'`) using plain, natural-language titles without Conventional Commit prefixes or emojis (e.g., `Add .hdbti formatter support`), and link them (`Closes #N` or `Refs #N`) in PR descriptions.
3. **Pull Requests:** Verify `npm test` passes and `git status` is clean (`research/` untracked), push (`git push -u origin <branch>`), and open the PR (`gh pr create --title '...' --label '...' --body-file ...`).
4. **Human-Only Merge Gate (STRICT):** **NEVER** run `gh pr merge` or merge feature branches into `main` locally. Leave all PRs open for human review.

## 7. Changelog & Versioning Policy

1. **Hands Off on Feature Branches:** Never modify `CHANGELOG.md` or bump `"version"` in `package.json` during feature, fix, or spec tasks.
2. **Release Prep Only:** Update `CHANGELOG.md` and `package.json` version exclusively when explicitly asked to prepare a release (synthesizing `git log <last-tag>..HEAD` into domain-grouped `Added` / `Changed` / `Fixed` sections).
