# Contributing to SAP HANA Developer Tools

Thank you for helping improve SAP HANA language support in VS Code! This document covers how to build grammars, update keyword dictionaries, run tests, and debug the extension locally.

## Prerequisites

* **Node.js** (LTS recommended)
* **VS Code** (for launching the Extension Development Host)

> **Note:** All syntax highlighting, formatting, and future offline LSP unit tests run completely offline—no live SAP HANA instance is required for Phase 1–3 development.

## Local Development Workflow

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Generate XS grammars & keyword tables:**
   * Grammars for the XS artifacts are generated from `scripts/build-grammars.js`. After editing grammar rules, run:

     ```bash
     npm run build:grammars
     ```

   * The SQL formatter's built-in keyword, function, and data type tables are generated via:

     ```bash
     npm run build:keywords
     ```

3. **Run unit tests (headless, no VS Code instance needed):**

   ```bash
   npm test
   ```

4. **Launch the Extension Development Host:**
   * Open this repository in VS Code and press `F5` to launch a new Extension Development Host window with the extension loaded.

## Packaging & `.vscodeignore` Gotchas

* Before running `vsce package`, verify that `.vscodeignore` does **not** exclude `src/**` (or whichever runtime entry points your `package.json` references), while excluding `/docs/specs/`, test fixtures, and research scripts so the `.vsix` bundle stays small.

## Commit Message Convention

We follow **Conventional Commits** for clean changelog generation:

* `feat(grammar): add highlighting for ...`
* `feat(formatter): support ...`
* `fix(formatter): preserve trailing semicolon behavior in ...`
* `docs(specs): distill ...`
* `test(formatter): add regression fixture for ...`