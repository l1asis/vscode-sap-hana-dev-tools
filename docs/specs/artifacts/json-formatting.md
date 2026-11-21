# JSON & Tolerant JSONC Artifact Formatting Specification (`json-formatting.md`)

> Source: `scripts/build-grammars.js` (`jsonGrammar` registry), `docs/specs/artifacts/hdiconfig.md`, `samples/hdi/*`, `samples/xs-classic/*`

---

## 1. Covered Artifacts

| Runtime | Language IDs | Notes |
| :--- | :--- | :--- |
| `[XSC]` | `xsaccess`, `xsapp`, `xsprivileges`, `xssecurestore`, `xssqlcc`, `xsjob`, `hdbsynonym`, `xsappsite`, `xsoauthappconfig`, `xsoauthclientconfig`, `xsoauthclientflavor` | Several XS Classic SAP documentation examples contain comments or omitted commas (notably `.xssqlcc` and `.xsaccess` variants). |
| `[HDI]` `[XSA]` `[CLOUD]` | `hdbrole` (when root begins with `{`), `hdbgrants`, `hdbrevokes`, `hdbroleconfig`, `hdbsynonymconfig`, `hdbpublicsynonym`, `hdbvirtualtableconfig`, `hdblogicalschemaconfig`, `hdbprojectionviewconfig`, `hdbfabricvirtualtableconfig`, `hdbtabledata`, `hdbeshconfig`, `hdiconfig`, `hdinamespace` | `.hdbrole` disambiguates dynamically: `{` selects this formatter; `role` or non-JSON privilege DSL selects `hdbrole-formatting.md`. |

---

## 2. Structural Grammar & AST Model

```ebnf
JsonDocument ::= { Trivia } [ Value ] { Trivia } ;
Value        ::= Object | Array | String | Number | "true" | "false" | "null" | MalformedSpan ;
Object       ::= "{" { Member } "}" ;
Member       ::= { Trivia } Key [ ":" Value ] [ "," ] [ InlineComment ] ;
Key          ::= String | BareWord ;
Array        ::= "[" { Element } "]" ;
Element      ::= { Trivia } Value [ "," ] [ InlineComment ] ;
Trivia       ::= LineComment | BlockComment | RawPragmaRegion ;
```

### Tolerance Rules (Non-Destructive Recovery)
- **Omitted Commas:** Parser must NOT fail or drop members when a comma between properties or elements is missing (e.g., SAP `.xssqlcc` documentation). Preserve presence/absence of each `,` faithfully (`member.hasComma`) rather than failing or corrupting partial edits.
- **Comments & Pragmas:** Preserve `//` line comments, `/* ... */` block comments, and `hanasql-format off` / `hanasql-format on` regions verbatim.
- **Unclosed Structures:** Recover gracefully on unclosed `{`, `[`, or strings without dropping tokens.

---

## 3. Canonical Formatting Rules

1. **Indentation & Line Endings:** Respect `ResolvedFormatterOptions` (`indentWidth`, `useTabs`, `eol`, `insertFinalNewline`, `maxConsecutiveBlankLines`).
2. **Root Containers:**
   - Top-level objects and arrays expand multi-line (with empty `{}` / `[]` remaining on one line when comment-free).
3. **Nested Objects:**
   - Empty object: `{}`.
   - Single-property flat object with scalar value and no internal comments that fits within `maxLineLength`: allow compact inline `{ "plugin_name": "com.sap.hana.di.collection" }` (matching [hdiconfig.md](file:///e:/Code/js/vscode-sap-hana-dev-tools/docs/specs/artifacts/hdiconfig.md)) **or** keep multi-line if the source had internal line breaks / multiple properties.
   - Multi-property objects or objects containing nested containers/comments: open `{`, indent members by `+1` level one per line, close `}` at outer indent level.
4. **Arrays:**
   - Empty array: `[]`.
   - Flat scalar-only array (`string`, `number`, `true`, `false`, `null`) without internal comments that fits within `maxLineLength`: render inline `["SELECT", "INSERT"]`.
   - Object arrays, nested arrays, comment-containing arrays, or arrays exceeding `maxLineLength`: expand one element per line at `+1` indent level.
5. **Key-Value Spacing & Preservation:**
   - Format `key: value` with zero space before `:` and single space after `:`.
   - Never modify key names, string literal contents, escape sequences, boolean/null casing, or numeric lexemes (`1e-5`, `1.00`).
6. **Commas:**
   - Keep `,` immediately after the property value or element (before any trailing inline comment), never at the start of the next line.
