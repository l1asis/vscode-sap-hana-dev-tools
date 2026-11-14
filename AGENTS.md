# AGENTS.md — vscode-sap-hana-dev-tools

## 1. Project Overview

A complete, modern VS Code replacement for SAP HANA Studio (Eclipse), supporting **SAP HANA XS Classic (XSC)**, **XS Advanced (XSA)**, **HDI**, and **SAP HANA Cloud**.

## 2. Repository Architecture

- `syntaxes/` — TextMate grammars (`.tmLanguage.json`) for 60+ SAP HANA design-time artifacts.
- `src/` — Extension source code, AST formatters, offline LSP analyzers, and live DB connectivity.
- `test/` — Unit and integration test suites.
- `samples/` — Sample SAP HANA artifacts for manual and automated testing.
- `docs/ROADMAP.md` — Master engineering roadmap and phase status matrix.
- `docs/specs/` — Distilled, version-controlled technical specifications (`artifacts/`, `catalogs/`, `connectivity/`, `diagnostics/`, `grammars/`).
- `docs/specs/SPEC_RULES.md` — Mandatory formatting and schema rules for creating/updating files in `docs/specs/`.
- `docs/research/CHECKLIST.md` — Tracking checklist for extracting specs from the local reference corpus.
- `research/refs/extracted/` — **(Git-ignored local corpus)** 200+ official SAP HANA reference guides split into chapter-level Markdown files with fenced BNF/code blocks.

## 3. Core Agent Operating Rules

1. **Spec-First Development:** Before implementing or modifying any grammar (`syntaxes/`), formatter, linter rule, or API client (`src/`), read the corresponding spec in `docs/specs/`. If the spec is missing or incomplete, extract it from `research/refs/extracted/` first following `docs/specs/SPEC_RULES.md`.
2. **Search Before Reading:** Never read entire guide folders in `research/refs/extracted/` blindly. Use `ripgrep` (`rg -i "<keyword>" research/refs/extracted/`) to pinpoint the exact chapter `.md` file first.
3. **Never Commit `research/`:** Everything under root `research/` is local scratchpad data and must remain untracked by Git. Only commit distilled specs under `docs/specs/` and checklist updates in `docs/research/CHECKLIST.md`.
4. **Platform Tagging:** Always distinguish between `[XSC]`, `[XSA]`, `[HDI]`, and `[CLOUD]` syntax variants in both specs and code comments.
5. **Zero External Runtime Bloat for Parsers:** Keep lexers, formatters, and static analyzers dependency-free in pure TypeScript so the extension stays fast and lightweight.

## 4. Coding & TypeScript Conventions

- **Strict TypeScript:** Use `strict: true` in `tsconfig.json`. Avoid `any`; use discriminated unions for AST nodes and token types.
- **Formatting Safety:** Formatters must never corrupt valid code, strip comments, or break `-- hanasql-format off` pragmas or HDI headerless procedure bodies.
- **Testing:** Every new grammar rule, formatter, or diagnostic rule must include positive and negative test cases in `test/`.
