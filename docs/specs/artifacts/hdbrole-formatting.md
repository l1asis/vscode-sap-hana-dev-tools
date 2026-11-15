# Classic `.hdbrole` & HDI `.hdbmigrationtable` Formatting Specification (`hdbrole-formatting.md`)

> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/013_11_Setting_Up_Roles_and_Privileges.md` (Pages 700–732)
> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md` (`hdbmigrationtable`)

---

## 1. Classic `.hdbrole` DSL `[XSC]`

### Dual-Mode Disambiguation (`hdbrole`)
- When first non-trivia token is `{`, route `.hdbrole` to the JSON/JSONC formatter (`[HDI]` / `[XSA]` / `[CLOUD]`).
- Otherwise (starts with `role` or anonymous classic block `{ ... }` containing `:` privilege statements), use the Classic `.hdbrole` DSL formatter (`[XSC]`).
- Note: Minimal `{ application privilege: ...; }` without a leading `role` keyword still contains privilege keywords + `;` instead of JSON `"key":`, so sniffing `role` OR top-level `{` followed by quoted string key cleanly disambiguates both SAP docs forms.

### Grammar & Tokens
- **Comments:** `// ...` and `-- ...` line comments, plus `/* ... */` block comments; pragmas via `hanasql-format off` / `hanasql-format on`.
- **Header:**
  ```text
  role <package>::<role_name>
  [extends role <package>::<role_name> { , <package>::<role_name> }]
  [extends catalog role "<role>" { , "<role>" }]
  {
      ...
  }
  ```
- **Statements inside `{ ... }`:**
  Each terminated by `;`:
  - `system privilege: BACKUP ADMIN, USER ADMIN;`
  - `catalog schema "MYSCHEMA": SELECT, INSERT;`
  - `schema pkg:app1.hdbschema: INSERT, UPDATE, DELETE;`
  - `catalog sql object "MYSCHEMA"."MYTABLE": SELECT WITH GRANT OPTION;`
  - `sql object pkg:VIEW1.attributeview, pkg:PROC1.hdbprocedure: SELECT, DROP;`
  - `analytic privilege: pkg:AP1.analyticprivilege, pkg:AP2.analyticprivilege;`
  - `catalog analytic privilege: "sp3";`
  - `package pkg1, pkg2: REPO.READ;`
  - `application privilege: pkg::Execute, pkg::Save;`

### Canonical Layout Rules
1. **Header Alignment:** Keep `role <name>` at indent `0`; place each `extends role ...` / `extends catalog role ...` clause on its own line at indent `0`; place `{` at end of the last header line after a single space (matching VS Code/CDS conventions), or at indent `0` for anonymous `{ ... }` blocks. Close `}` at indent `0` without trailing `;`.
2. **Privilege Entries (`+1` indent):**
   - Preserve exact separator spacing inside qualified targets (`acme.com.roles::JobAdministrator`, `sap.example:VIEW1.attributeview`, `"SYSTEM"."TABLE2"` — **no** spaces around `.`, `::`, or target `:`).
   - Emit `: ` (no space before `:`, one space after `:`) before the privilege list, separating comma-delimited targets and privileges with `, `.
   - Wrap long privilege lines cleanly at indent `+2` after `,` when exceeding `maxLineLength`.
   - End each privilege statement with `;` (attaching any same-line trailing comment cleanly).
3. **Identifier & Keyword Case Safety:** Never alter case of package paths, object names, privilege constants, `role`, `extends`, or `WITH GRANT OPTION`.

---

## 2. HDI `.hdbmigrationtable` `[HDI]` `[CLOUD]`

### Section Marker Grammar
```text
== version = <int>
<HDI table DDL: COLUMN TABLE | ROW TABLE ... (no trailing semicolon)>
== migration = <int>
<Standard SQL DDL statements: ALTER TABLE ...; RENAME COLUMN ...;>
```
Markers matching `/^\s*==\s*(version|dev-version|migration)\s*=\s*(\d+)\s*$/i` partition the file into independent SQL/DDL sections (including `== version=28` without spaces).

### Canonical Layout Rules
1. **Marker Header Line:** Normalize header lines to `== <lowercase-kind> = <number>` at indent `0` (`== version = 2`, `== dev-version = 28`, `== migration = 2`). Separate consecutive sections with 1 blank line (respecting `maxConsecutiveBlankLines` / header spacing).
2. **Section Bodies:**
   - Format each section's body using the core SQL formatter (`format()`).
   - `== version` / `== dev-version` bodies contain headerless HDI table definitions (`COLUMN TABLE ...`, `ROW TABLE ...`), which `HDI_FIRST` automatically keeps free of a trailing `;` even when `trailingSemicolon` is `'add'`.
   - `== migration` bodies contain migration DDL statements (`ALTER TABLE ...;`, `RENAME COLUMN ...;`), formatted under the user's configured SQL formatting options.
3. **Pragma & Recovery:** Handle `hanasql-format off`/`on` safely and never corrupt marker lines even if immediately adjacent to statements or comments.
