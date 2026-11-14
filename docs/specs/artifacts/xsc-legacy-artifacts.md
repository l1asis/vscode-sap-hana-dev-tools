# Legacy & UI Integration XS Classic Artifacts (`.xsappsite`, `.xswidget`, `.hdbdecisiontable`, `.xsxmla`, `.hdbtid`, `.hdbtim`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/012_10_Building_UIs.md (Pages 671, 684–687)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide/011_pages_301_330.md (Pages 321–323)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/036_Programming_Models.md (Page 1)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/053_hdbtable.md (Page 68)
> Source: research/refs/extracted/hana-cloud_SAP_HANA_Cloud_Migration_Guide/001_pages_1_30.md (Page 12)

---

## Artifact Overview `[XSC]`

| Extension | Language ID | TextMate Scope | Format Category | Status & Corpus Notes |
| :--- | :--- | :--- | :--- | :--- |
| `.xsappsite` | `xsappsite` | `source.xsappsite` | XS Classic JSON | `[XSC]` Fiori Launchpad Application Site. Edited visually in SAP HANA Studio embedded browser editor (`Runtime Version` JSON). Raw JSON key schema is not printed in the extracted corpus. |
| `.xswidget` | `xswidget` | `text.xml.hana` | XML Model | `[XSC]` UI Integration Services Tile Catalog / Widget. Edited visually in SAP HANA Studio embedded browser editor. Raw XML schema is not printed in the extracted corpus. |
| `.hdbdecisiontable` | `hdbdecisiontable` | `text.xml.hana` | XML Model | `[XSC]` Tabular Business Rule Decision Table (`SAP_HANA_Developer_Guide` describes Studio graphical editor; XSA migration guide cites `*.hdbruldec` / `*.decrule` equivalents). Exact `.hdbdecisiontable` extension is not printed in `research/refs/extracted/`. |
| `.xsxmla` | `xsxmla` | `source.xsxmla` | Service Definition / KV | `[XSC]` XS Classic XML for Analysis (XMLA) service definition. Unsupported in XSA (`Migration_Guide/036_Programming_Models.md`). Exact `.xsxmla` syntax listing is not printed in `research/refs/extracted/`. |
| `.hdbtid` | `hdbtid` | `source.hdbtid` | Classic KV | `[XSC]` Deprecated Table Import Data definition (`Migration_Guide/053_hdbtable.md`), superseded by `.hdbti` (`[XSC]`) and `.hdbtabledata` (`[HDI]`). Raw `.hdbtid` syntax is not printed in `research/refs/extracted/`. |
| `.hdbtim` | `hdbtim` | `source.hdbtim` | Classic KV | `[XSC]` Deprecated Table Import Schema definition (`Migration_Guide/053_hdbtable.md`), superseded by `.hdbti` (`[XSC]`) and `.hdbtabledata` (`[HDI]`). Raw `.hdbtim` syntax is not printed in `research/refs/extracted/`. |

---

## Grammar Conventions

- **`.xsappsite` (`source.xsappsite`):** Tolerant JSON (`comments`, double-quoted keys/strings, numbers, booleans/null, structural punctuation) highlighting common Fiori launchpad site properties (`id`, `title`, `description`, `theme`, `catalogs`, `groups`, `tiles`, `personalization`).
- **`.xswidget`, `.hdbdecisiontable` (`text.xml.hana`):** Delegates to SAP HANA XML (`syntaxes/hanaxml.tmLanguage.json`).
- **`.xsxmla` (`source.xsxmla`):** Highlights XS Classic service block structure (`service { ... }`, `namespace`), repository object references (`"pkg::VIEW"`), XMLA terms (`analytic`, `calculation`, `cube`, `dimension`, `measure`, `metadata`), classic `key = value;` assignments, `//` / `/* */` comments, and strings.
- **`.hdbtid`, `.hdbtim` (`source.hdbtid`, `source.hdbtim`):** Classic XS key-value syntax (`key = value;`, `//` / `/* */` comments, double-quoted strings, numbers, booleans, braces/brackets, semicolons).
