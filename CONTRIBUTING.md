# Contributing to Developer Tools for SAP HANA

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

We follow **Conventional Commits** (`<type>(<optional scope>): <description>`) for clean changelog generation. Emojis are completely optional, but welcome—if you use them, place them after the colon so automated changelog parsers can still read the commit type.

**Allowed Commit Types:**

* `feat`: ✨ A new feature
* `fix`: 🐛 A bug fix
* `docs`: 📝 Documentation-only changes
* `style`: 🎨 Formatting, missing semi-colons, whitespace, etc. (no code logic changes)
* `refactor`: ♻️ A code change that neither fixes a bug nor adds a feature
* `perf`: ⚡ A code change that improves performance
* `test`: ✅ Adding missing tests or correcting existing tests
* `build`: 📦 Changes that affect the build system or external dependencies
* `ci`: 👷 Changes to CI configuration files and scripts
* `chore`: 🔧 Other changes that don't modify `src` or `test` files
* `revert`: ⏪ Reverts a previous commit

**Examples:**

* `feat(grammar): ✨ add highlighting for ...`
* `feat(formatter): support ...`
* `fix(formatter): 🐛 preserve trailing semicolon behavior in ...`
* `docs(specs): 📝 distill ...`
* `test(formatter): ✅ add regression fixture for ...`
