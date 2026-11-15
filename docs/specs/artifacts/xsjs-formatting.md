# XS JavaScript (`.xsjs`, `.xsjslib`) Formatting Specification (`xsjs-formatting.md`)

> Target Platforms: `[XSC]` `[XSA (XSJS Compatibility Layer)]`
> Extensions / Language IDs: `.xsjs` (`xsjs`), `.xsjslib` (`xsjslib`)

---

## 1. Strategy & Rationale

- `.xsjs` and `.xsjslib` files are standard ECMAScript (ES5/ES6) executed by SAP HANA XS Engine with runtime global namespace `$` (`$.db`, `$.hdb`, `$.net`, `$.session`, `$.request`, `$.response`, `$.import`, `$.trace`, etc.).
- Per project architectural guidelines (`AGENTS.md` Rule 5: zero runtime npm dependencies for parsers), the extension avoids shipping third-party JS AST parsers or bundlers in the VSIX.
- Instead, VS Code ships a built-in JavaScript/TypeScript language service (`vscode.typescript-language-features`) capable of full AST formatting and range formatting.

---

## 2. Formatting Architecture

1. **Extension Virtual-Document Delegation (`xsjs` / `xsjslib`):**
   - Register a lightweight read-only `TextDocumentContentProvider` with a custom scheme (`hanasql-xsjs-format`) serving virtual `.js` URIs (e.g. `hanasql-xsjs-format:/delegate.js`), so VS Code assigns language ID `javascript` without opening editor tabs or leaking untitled buffers.
   - Update the virtual document buffer, fire `onDidChange`, obtain the virtual `TextDocument`, and invoke:
     - `vscode.executeFormatDocumentProvider` (full document formatting)
     - `vscode.executeFormatRangeProvider` (range formatting)
   - Remap returned `vscode.TextEdit[]` cleanly onto the caller's `.xsjs` / `.xsjslib` document.
2. **`hanasql-format off` / `hanasql-format on` Pragma Support (`src/formatter/xsjs.ts`):**
   - Pure-TypeScript helper scans `.xsjs`/`.xsjslib` text for line/block `hanasql-format off` ... `hanasql-format on` regions before delegation.
   - Off-regions are replaced with unique comment sentinel markers before invoking JS formatting and restored verbatim after applying JS `TextEdit[]`, guaranteeing pragma blocks remain untouched.
3. **Settings & Manifest Bindings:**
   - Honor `hanasql.format.enable === false` (no-op return `[]`).
   - Bind `[xsjs]` and `[xsjslib]` in `package.json` `contributes.configurationDefaults` (`"editor.defaultFormatter": "l1asis.sap-hana-dev-tools"`).
