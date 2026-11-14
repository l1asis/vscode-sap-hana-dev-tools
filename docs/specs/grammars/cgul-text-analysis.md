# Text Analysis & CGUL Grammar Specification (`cgul-text-analysis.md`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Sections 6.38–6.43, Pages 359–363)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(HDI)_Reference_for_SAP_HAN/009_pages_281_300.md (Pages 289–292)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/023_Migrate_Text_Analysis_and_Text_Mining_Objects.md (Pages 30–31)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/024_Resource_Types_for_Text_Analysis_and_Text_Mining.md (Page 32)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/025_Restrictions_When_Migrating_Text_Analysis_and_Text_Mining.md (Page 33)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en/004_2_Migrating_SAP_HANA_XS_Classic_Applications_to_the_XS_Advanced_Model.md (Pages 35–38, 82–86)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/017_15_SAP_Web_IDE_for_SAP_HANA_Reference.md (Pages 1126, 1148)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en/006_4_SQL_Reference.md (Page 767)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en/008_6_System_Views_Reference.md (Pages 1722, 2290)
> Source: research/refs/extracted/hana-cloud_SAP_HANA_Cloud_Migration_Guide/002_pages_31_60.md (Page 56)

---

## 1. File Extensions & Scope Name

| File Extension | TextMate `scopeName` | Grammar File | HDI Build Plug-in | Target Platforms |
| :--- | :--- | :--- | :--- | :--- |
| `.hdbtextrule` | `source.hdbtextrule` | `syntaxes/hdbtextrule.tmLanguage.json` | `com.sap.hana.di.textrule` | `[XSC]` `[XSA]` `[HDI]` (Deprecated/Removed in `[CLOUD]`) |
| `.hdbtextinclude` | `source.hdbtextinclude` | `syntaxes/hdbtextinclude.tmLanguage.json` | `com.sap.hana.di.textrule.include` | `[XSC]` `[XSA]` `[HDI]` (Deprecated/Removed in `[CLOUD]`) |
| `.hdbtextlexicon` | `source.hdbtextlexicon` | `syntaxes/hdbtextlexicon.tmLanguage.json` | `com.sap.hana.di.textrule.lexicon` | `[XSC]` `[XSA]` `[HDI]` (Deprecated/Removed in `[CLOUD]`) |
| `.hdbtextconfig` | `text.xml.hana` | `syntaxes/hanaxml.tmLanguage.json` | `com.sap.hana.di.textconfig` | `[XSC]` `[XSA]` `[HDI]` (Deprecated/Removed in `[CLOUD]`) |
| `.hdbtextdict` | `text.xml.hana` | `syntaxes/hanaxml.tmLanguage.json` | `com.sap.hana.di.textdictionary` | `[XSC]` `[XSA]` `[HDI]` (Deprecated/Removed in `[CLOUD]`) |
| `.hdbtextminingconfig` | `text.xml.hana` | `syntaxes/hanaxml.tmLanguage.json` | `com.sap.hana.di.textminingconfig` | `[XSC]` (`.textminingconfig`), `[XSA]` `[HDI]` (`.hdbtextminingconfig`) |

---

## 2. Lexical Tokens & Comments

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 359–363)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide/023_Migrate_Text_Analysis_and_Text_Mining_Objects.md (Pages 30–31)

| Token Class | Pattern / Delimiter | TextMate Scope | Platform | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Line Comment (`//`) | `//.*$` | `comment.line.double-slash.hdbtextrule` | `[XSC]` `[XSA]` `[HDI]` | Standard comment in `.hdbtextrule`, `.hdbtextinclude`, `.hdbtextlexicon` |
| Line Comment (`--`) | `--.*$` | `comment.line.double-dash.hdbtextrule` | `[XSC]` `[XSA]` `[HDI]` | SQL-style line comment |
| Block Comment | `/* ... */` | `comment.block.hdbtextrule` | `[XSC]` `[XSA]` `[HDI]` | Multi-line comment |
| XML Comment | `<!-- ... -->` | `comment.block.xml` | `[XSC]` `[XSA]` `[HDI]` | Used in `.hdbtextconfig` and `.hdbtextdict` |
| Double-Quoted String | `"..."` | `string.quoted.double.hdbtextrule` | `[XSC]` `[XSA]` `[HDI]` | Attribute values, token literals, include paths |
| Single-Quoted String | `'...'` | `string.quoted.single.hdbtextrule` | `[XSC]` `[XSA]` `[HDI]` | Alternative string literal |
| Angle-Bracket Include Path | `<path::file.hdbtextinclude>` | `string.unquoted.path.hdbtextrule` | `[XSC]` `[XSA]` `[HDI]` | Follows `#include` or `#lexicon` |
| Escape Sequence | `\\.` | `constant.character.escape.hdbtextrule` | `[XSC]` `[XSA]` `[HDI]` | Escapes meta-characters inside strings, character classes, and tokens |
| Numeric Literal | `(?<![\w.])-?\d+(?:\.\d+)?\b` | `constant.numeric.hdbtextrule` | `[XSC]` `[XSA]` `[HDI]` | Quantifier bounds and attribute numbers |

---

## 3. Keywords by TextMate Scope

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 361–362)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en/004_2_Migrating_SAP_HANA_XS_Classic_Applications_to_the_XS_Advanced_Model.md (Pages 35–38)

### 3.1 Directives (`keyword.control.import.hdbtextrule` & `keyword.control.directive.hdbtextrule`)
- **Import Directives (`keyword.control.import.hdbtextrule`) `[XSC]` `[XSA]` `[HDI]`:**
  `#include`, `#lexicon`
  - Path format in `[XSC]`: `<pkg.path:file.hdbtextinclude>` or `<pkg/path/file.hdbtextinclude>` or `"..."`
  - Path format in `[XSA]` `[HDI]`: `<namespace::file.hdbtextinclude>`, `<namespace::file.hdbtextlexicon>`, or `"..."`
- **Definition & Compiler Directives (`keyword.control.directive.hdbtextrule`) `[XSC]` `[XSA]` `[HDI]`:**
  `#define`, `#group`, `#subgroup`, `#index`, `#feature`, `#category`, `#priority`, `#language`, `#encoding`, `#version`

### 3.2 Group & Lexicon Attribute Tags (`variable.parameter.attribute.hdbtextrule`)
- `scope` (`"sentence"`, `"paragraph"`, `"document"`, `"clause"`, `"phrase"`)
- `type`, `subtype`, `lang`, `language`, `filter`, `case` (`"sensitive"`, `"insensitive"`), `stemming`, `output`, `action`, `priority`, `weight`, `name`, `category`, `value`, `role`, `mode`, `format`

### 3.3 Token Classes & Specifiers Inside `<...>` (`meta.token.hdbtextrule`)
- **Token Class Prefixes (`support.type.property-name.hdbtextrule`) `[XSC]` `[XSA]` `[HDI]`:**
  `STEM`, `POS`, `ORTH`, `TOKEN`, `TYPE`, `SUBTYPE`, `LEMMA`, `NORM`, `TAG`, `FEAT`, `LANG`, `REGEXP`, `LEXICON` (followed by `:`)
- **Part-of-Speech (POS) Tags (`constant.language.pos-tag.hdbtextrule`) `[XSC]` `[XSA]` `[HDI]`:**
  `NN`, `NNS`, `NNP`, `NNPS`, `NP`, `NPS`, `VB`, `VBD`, `VBG`, `VBN`, `VBP`, `VBZ`, `JJ`, `JJR`, `JJS`, `RB`, `RBR`, `RBS`, `IN`, `DT`, `CC`, `CD`, `PRP`, `PRP$`, `WP`, `WP$`, `WRB`, `WDT`, `MD`, `TO`, `RP`, `UH`, `FW`, `SYM`, `POS`, `Noun`, `Verb`, `Adj`, `Adv`, `Prep`, `Det`, `Conj`, `Num`, `Pron`, `Punct`, `Prop`
- **Token Predicates & Negation inside `<...>`:**
  - `!` / `~`: Negation operator (`keyword.operator.negation.hdbtextrule`), e.g. `<!POS:Punct>`, `<STEM:call, !POS:NN>`
  - `=`, `!=`, `~=`: Attribute comparison operators inside `<...>`

### 3.4 Rule Body Constructs (`<>`, `()`, `[]`, `%(...)`, Quantifiers, Action Blocks)
- **Token Delimiters `<` `>`:** `punctuation.definition.token.begin.hdbtextrule` / `punctuation.definition.token.end.hdbtextrule`
- **Group Reference `%(Name)` / `%(ns::Name)`:**
  - `%`: `keyword.operator.hdbtextrule`
  - `(` `)`: `punctuation.section.parens.hdbtextrule`
  - `Name`: `variable.other.group.hdbtextrule`
- **Slot / Capture Binding `[label]:`:**
  - `label`: `entity.name.tag.label.hdbtextrule`
- **Character Class `[...]` (when not followed by `:`):**
  - `[` `]`: `punctuation.definition.character-class.hdbtextrule`
  - Character range `a-z`, `0-9`: `constant.character.set.hdbtextrule`
- **Capturing / Grouping Parentheses `(...)`:** `punctuation.section.parens.hdbtextrule`
- **Quantifiers (`keyword.operator.quantifier.hdbtextrule`):**
  `+`, `*`, `?`, `{m}`, `{m,}`, `{m,n}` (e.g., `<.*>{0,3}`, `%(Digit)+`)
- **Action / Output Block (`=> { ... }`):**
  - `=>` / `->`: `keyword.operator.action.hdbtextrule`
  - `$slot` / `${slot}` / `$1`: `variable.other.slot.hdbtextrule`

---

## 4. Embedded Language Injections

- `.hdbtextconfig`, `.hdbtextdict`, and `.hdbtextminingconfig` delegate to `text.xml` via `syntaxes/hanaxml.tmLanguage.json`.
- `.hdbtextinclude` and `.hdbtextlexicon` include `source.hdbtextrule`.

---

## 5. Complete EBNF / BNF Productions

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md (Pages 359–363)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en/004_2_Migrating_SAP_HANA_XS_Classic_Applications_to_the_XS_Advanced_Model.md (Pages 35–38)

### 5.1 CGUL Grammar (`.hdbtextrule`, `.hdbtextinclude`, `.hdbtextlexicon`) `[XSC, XSA, HDI]`

```ebnf
cgul_file              := { directive | rule_statement | comment } ;

(* 1. Comments *)
comment                := line_comment | block_comment ;
line_comment           := ( '//' | '--' ) { any_char_except_newline } newline ;
block_comment          := '/*' { any_char } '*/' ;

(* 2. Directives *)
directive              := include_directive
                        | lexicon_directive
                        | define_directive
                        | group_directive
                        | subgroup_directive
                        | metadata_directive ;

include_directive      := '#include' ( angle_path | string_literal ) [';'] ;
lexicon_directive      := '#lexicon' [ '(' attribute_list ')' ] [ identifier ] ( angle_path | string_literal ) [';'] ;
angle_path             := '<' [ namespace '::' | package_path ':' ] filename '>' ;
define_directive       := '#define' identifier ( ':' | '=' ) pattern_expr [';'] ;
group_directive        := '#group' identifier [ '(' attribute_list ')' ] ':'
                          [ '{' { rule_statement | subgroup_directive } '}' ] ;
subgroup_directive     := '#subgroup' identifier [ '(' attribute_list ')' ] ':' ;
metadata_directive     := ( '#index' | '#feature' | '#category' | '#priority' | '#language' | '#encoding' | '#version' )
                          { any_char_except_newline } ;

(* 3. Attributes *)
attribute_list         := attribute { ',' attribute } ;
attribute              := attribute_name '=' ( string_literal | identifier | number ) ;
attribute_name         := 'scope' | 'type' | 'subtype' | 'lang' | 'language' | 'filter'
                        | 'case' | 'stemming' | 'output' | 'action' | 'priority' | 'weight'
                        | 'name' | 'category' | 'value' | 'role' | 'mode' | 'format' ;

(* 4. Rules & Output Actions *)
rule_statement         := [ label_assignment ] pattern_expr [ action_block ] [';'] ;
label_assignment       := identifier ':' ;
action_block           := [ '=>' | '->' ] '{' { action_assignment } '}' ;
action_assignment      := [ '$' ] identifier ( ':' | '=' ) ( string_literal | slot_reference | identifier ) ';' ;

(* 5. Pattern Expressions *)
pattern_expr           := pattern_sequence { '|' pattern_sequence } ;
pattern_sequence       := { pattern_term }+ ;
pattern_term           := [ slot_binding ] pattern_atom [ quantifier ] ;
slot_binding           := '[' identifier ']' ':'
                        | identifier '=' ;

pattern_atom           := token_spec
                        | group_reference
                        | slot_reference
                        | char_class
                        | '(' pattern_expr ')'
                        | string_literal
                        | anchor_or_wildcard
                        | identifier ;

(* 6. Token Specifications <...> *)
token_spec             := '<' [ '!' | '~' ] token_body '>' ;
token_body             := token_clause { ( ',' | '&' | '|' | whitespace ) token_clause } ;
token_clause           := [ '!' | '~' ] ( token_prefix_spec | pos_tag | token_predicate | string_literal | wildcard_pattern | identifier ) ;
token_prefix_spec      := token_prefix ':' ( string_literal | pos_tag | wildcard_pattern | identifier ) ;
token_prefix           := 'STEM' | 'POS' | 'ORTH' | 'TOKEN' | 'TYPE' | 'SUBTYPE'
                        | 'LEMMA' | 'NORM' | 'TAG' | 'FEAT' | 'LANG' | 'REGEXP' | 'LEXICON' ;
pos_tag                := 'NN' | 'NNS' | 'NNP' | 'NNPS' | 'NP' | 'NPS'
                        | 'VB' | 'VBD' | 'VBG' | 'VBN' | 'VBP' | 'VBZ'
                        | 'JJ' | 'JJR' | 'JJS' | 'RB' | 'RBR' | 'RBS'
                        | 'IN' | 'DT' | 'CC' | 'CD' | 'PRP' | 'PRP$'
                        | 'WP' | 'WP$' | 'WRB' | 'WDT' | 'MD' | 'TO'
                        | 'RP' | 'UH' | 'FW' | 'SYM' | 'POS'
                        | 'Noun' | 'Verb' | 'Adj' | 'Adv' | 'Prep' | 'Det' | 'Conj' | 'Num' | 'Pron' | 'Punct' | 'Prop' ;
token_predicate        := identifier ( '=' | '!=' | '~=' ) ( string_literal | identifier | number ) ;
wildcard_pattern       := '.*' | '.+' | char_class ;

(* 7. References, Character Classes & Quantifiers *)
group_reference        := '%(' [ namespace '::' ] identifier ')' ;
slot_reference         := '$' ( '{' identifier '}' | identifier | digit+ ) ;
char_class             := '[' [ '^' ] { char_range | escaped_char | any_char_except_rbracket } ']' ;
char_range             := char '-' char ;
quantifier             := '*' | '+' | '?' | '{' digit+ [ ',' [ digit* ] ] '}' ;
anchor_or_wildcard     := '^' | '$' | '.' | '~' | '!' ;
```

### 5.2 `.hdbtextdict` XML Schema Grammar `[XSC, XSA, HDI]`

```ebnf
dictionary_doc         := [ xml_decl ] '<dictionary' [ dict_attrs ] '>'
                          [ variant_gen_elem ]
                          { entity_category_elem }
                          '</dictionary>' ;
dict_attrs             := { 'case_sensitive=' bool_str | 'default_language=' lang_str } ;
entity_category_elem   := '<entity_category' 'name=' quoted_str [ category_attrs ] '>'
                          [ variant_gen_elem ]
                          { entity_name_elem }
                          '</entity_category>' ;
category_attrs         := { 'case_sensitive=' bool_str | 'variant_generation=' bool_str } ;
variant_gen_elem       := '<variant_generation' 'type=' ( '"standard"' | '"full"' | '"none"' ) [ 'language=' lang_str ] '/>' ;
entity_name_elem       := '<entity_name' 'standard_form=' quoted_str [ entity_attrs ] ( '/>' | '>' { variant_elem } '</entity_name>' ) ;
entity_attrs           := { 'language=' lang_str | 'case_sensitive=' bool_str | 'variant_generation=' bool_str } ;
variant_elem           := '<variant' 'name=' quoted_str [ variant_attrs ] '/>' ;
variant_attrs          := { 'type=' quoted_str | 'language=' lang_str | 'case_sensitive=' bool_str } ;
```

### 5.3 `.hdbtextconfig` XML Schema Grammar `[XSC, XSA, HDI]`

```ebnf
config_doc             := [ xml_decl ] '<configuration>'
                          { comment_elem | property_elem | nested_config_elem }
                          '</configuration>' ;
comment_elem           := '<comment>' text '</comment>' ;
nested_config_elem     := '<configuration' 'name=' config_section_name '>'
                          { comment_elem | property_elem | nested_config_elem }
                          '</configuration>' ;
config_section_name    := '"FormatConversion"' | '"StructureAnalysis"' | '"LanguageDetection"'
                        | '"LinguisticAnalysis"' | '"System.Tagger"' | '"System.DataDirectory"' | '"Extraction"' ;
property_elem          := '<property' 'name=' prop_name 'type=' prop_type '>'
                          ( scalar_value | list_elem )
                          '</property>' ;
prop_type              := '"string"' | '"boolean"' | '"integer"' | '"double"' | '"string-list"' ;
list_elem              := '<list' 'name="Values"' '>' { '<value>' text '</value>' } '</list>' ;
```

---

## 6. Canonical Formatting Rules (Phase 2)

1. **Directives:**
   - `#include` and `#lexicon` directives are placed at the top of the file, one per line, at indent level `0`.
   - `#define` macros follow imports, with a single space after `:` or around `=`.
   - `#group` declarations start at column `0`, preceded by a blank line.
2. **Rule Bodies & Indentation:**
   - Multi-line rules inside a `#group` are indented by `+1` level (4 spaces or 1 tab).
   - Action blocks `{ ... }` open with `=> {` and indent inner slot assignments by `+1` level.
3. **Token Spacing:**
   - Adjacent `<...>` tokens, `%(Group)` references, and `[slot]:` bindings are separated by a single space; quantifiers (`+`, `*`, `?`, `{m,n}`) attach directly to their preceding atom without whitespace.
