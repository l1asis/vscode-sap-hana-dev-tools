# XS OData Service Definition Grammar Specification (`xsodata.md`)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/010_8_Defining_Web-based_Data_Access_in_XS_Classic.md (Pages 474–515)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Web_Workbench_en/008_6_Defining_Web-based_Data_Access_in_XS_Classic.md (Pages 288–329)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/008_6_Defining_Web-based_Data_Access_in_XS_Advanced.md (Pages 522–577)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide/014_pages_391_420.md (Pages 394–420)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide/015_pages_421_450.md (Pages 421–435)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_XS_Advanced_Migration_Guide_en/004_2_Migrating_SAP_HANA_XS_Classic_Applications_to_the_XS_Advanced_Model.md (Pages 56, 96–97)

---

## 1. File Extensions & Scope Name

| File Extension | TextMate `scopeName` | Grammar File | Target Platforms |
| :--- | :--- | :--- | :--- |
| `.xsodata` | `source.xsodata` | `syntaxes/xsodata.tmLanguage.json` | `[XSC]` (XS Engine OData v2), `[XSA]` `[HDI]` (`@sap/xsjs` Node.js OData v2 compatibility layer; removed in `[CLOUD]`) |

---

## 2. Lexical Tokens & Comments

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/010_8_Defining_Web-based_Data_Access_in_XS_Classic.md (Pages 508–511)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/008_6_Defining_Web-based_Data_Access_in_XS_Advanced.md (Pages 571–573)

| Token Class | Pattern / Delimiter | TextMate Scope | Platform | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Line Comment | `//.*$` | `comment.line.double-slash.xsodata` | `[XSC]` `[XSA]` | Single-line comment |
| Block Comment | `/* ... */` | `comment.block.xsodata` | `[XSC]` `[XSA]` | Multi-line block comment |
| Double-Quoted Identifier / String | `"..."` | `variable.other.quoted-identifier.xsodata` | `[XSC]` `[XSA]` | Used for namespaces, repository/catalog object names, entity set aliases, column lists, association names, exit targets, and cache-control values |
| Single-Quoted String | `'...'` | `string.quoted.single.xsodata` | `[XSC]` `[XSA]` | Tolerated in non-strict files |
| Escape Sequence | `\\.` | `constant.character.escape.xsodata` | `[XSC]` `[XSA]` | Escape inside quoted strings |
| Multiplicity Literal | `"(?:1\|0\.\.1\|1\.\.\*\|\*)"` | `constant.other.multiplicity.xsodata` | `[XSC]` `[XSA]` | Follows `multiplicity` keyword |
| Exit / Repository Target | `"[^"\n]*(?:::|\.xsjslib)[^"\n]*"` | `entity.name.type.object.xsodata` | `[XSC]` `[XSA]` | Repository object (`pkg::obj`) or XSJS exit (`pkg:file.xsjslib::func`) |
| Integer Literal | `(?<![\w.])-?\d+\b` | `constant.numeric.xsodata` | `[XSC]` `[XSA]` | Used in `limits max_records = <int>, max_expanded_records = <int>` |
| Statement Terminator | `;` | `punctuation.terminator.statement.xsodata` | `[XSC]` `[XSA]` | Terminates `entity`, `association`, `annotations`, and `settings` entries |
| Comma Separator | `,` | `punctuation.separator.comma.xsodata` | `[XSC]` `[XSA]` | Separates columns, navigation entries, aggregates, events, hints, and limits |
| Schema Accessor | `.` | `punctuation.accessor.xsodata` | `[XSC]` | Separates `"SCHEMA"."OBJECT"` for catalog objects |
| Assignment Operator | `=` | `keyword.operator.assignment.xsodata` | `[XSC]` `[XSA]` | Used in `limits max_records = 1000` |
| Braces / Parentheses | `{` `}` / `(` `)` | `punctuation.section.(braces\|parens).xsodata` | `[XSC]` `[XSA]` | Block delimiters and column/event tuple delimiters |

---

## 3. Keywords by TextMate Scope

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/010_8_Defining_Web-based_Data_Access_in_XS_Classic.md (Pages 485–511)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/008_6_Defining_Web-based_Data_Access_in_XS_Advanced.md (Pages 541–573)

### 3.1 `storage.type.service.xsodata`
- `service` `[XSC]` `[XSA]` (in `service namespace "..." { ... }` or `service { ... }`)

### 3.2 `keyword.control.xsodata` (Case-Insensitive Clauses & Directives)
- **Service & Entity Declaration `[XSC]` `[XSA]`:**
  `service`, `namespace`, `entity`, `as`
- **Projection & Key Clauses `[XSC]` `[XSA]`:**
  `with`, `without`, `omitting`, `omit`, `key`, `keys`, `generate`, `local`
- **Concurrency & ETag `[XSC]` `[XSA]`:**
  `concurrencytoken`, `etag`
- **Navigation & Association Clauses `[XSC]` `[XSA]`:**
  `navigates`, `from`, `association`, `principal`, `dependent`, `multiplicity`, `over`, `referential`, `constraint`, `storage`, `no`, `on`, `join`
- **Aggregation Clauses `[XSC]` `[XSA]`:**
  `aggregates`, `always`, `of`
- **Input Parameters Clauses `[XSC]` `[XSA]`:**
  `parameters`, `via`, `and`, `results`, `property`
- **Modification & Custom Exits `[XSC]` `[XSA]`:**
  `create`, `update`, `delete`, `read`, `link`, `using`, `events`, `before`, `after`, `precommit`, `postcommit`, `for`, `forbidden`
- **Annotations & Settings Clauses `[XSC]` `[XSA]`:**
  `annotations`, `enable`, `disable`, `settings`, `support`, `content`, `metadata`, `cache-control`, `hints`, `limits`, `max_records`, `max_expanded_records`, `use`, `default`

### 3.3 `support.function.aggregate.xsodata`
- `SUM`, `AVG`, `MIN`, `MAX` `[XSC]` `[XSA]` (when followed by `\s+of\b` inside `aggregates always (...)`)

### 3.4 `constant.language.xsodata` & `support.constant.odata4sap.xsodata`
- **`constant.language.xsodata` `[XSC]` `[XSA]`:** `true`, `false`, `null` (`support null;`, `hints null;`)
- **`support.constant.odata4sap.xsodata` `[XSC]` `[XSA]`:** `OData4SAP` (`annotations { enable OData4SAP; }`)
- **`constant.other.multiplicity.xsodata` `[XSC]` `[XSA]`:** `"1"`, `"0..1"`, `"1..*"`, `"*"` (after `multiplicity`)

---

## 4. Embedded Language Injections

- `.xsodata` does not embed raw SQL blocks; SQLScript procedures (`"pkg.path::proc_name"`) and XSJS library functions (`"pkg.path:file.xsjslib::func_name"`) are referenced by qualified string literals after `using` or `before` / `after` / `precommit` / `postcommit` / `for`.

---

## 5. Complete EBNF / BNF Productions

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/010_8_Defining_Web-based_Data_Access_in_XS_Classic.md (Section 8.1.7, Pages 508–511)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/008_6_Defining_Web-based_Data_Access_in_XS_Advanced.md (Section 6.1.1.5, Pages 571–573)

```ebnf
(* ====================================================================== *)
(* OData Service Definition Language (OSDL) Complete EBNF [XSC, XSA]      *)
(* ====================================================================== *)
definition             := service [annotations] [settings] ;
service                := 'service' [namespace] body ;
namespace              := 'namespace' quotedstring ;
quotedstring           := quote string quote ;
string                 := UTF8 ;
quote                  := '"' ;

body                   := '{' content '}' ;
content                := entry [content] ;
entry                  := ( entity | association | settings ) ';' ;

(* Entity Set Definition *)
entity                 := object [entityset] [with] [keys] [concurrencytoken]
                          [navigates] [aggregates] [parameters] [modification] ;
object                 := ['entity'] ( repoobject | catalogobject ) ;
repoobject             := quote repopackage ( '/' reponame '.' repoextension | '::' reponame ) quote ;
repopackage            := string ;
reponame               := string ;
repoextension          := string ;
catalogobject          := [catalogobjectschema '.'] catalogobjectname ; (* [XSC] schema prefix; omitted in [XSA] *)
catalogobjectschema    := quotedstring ;
catalogobjectname      := quotedstring ;
entityset              := 'as' entitysetname ;
entitysetname          := quotedstring ;

(* Property Projection *)
with                   := ( 'with' | 'without' ) propertylist ;
propertylist           := '(' columnlist ')' ;
columnlist             := columnname [',' columnlist] ;
columnname             := quotedstring ;

(* Keys & Surrogate Key Generation *)
keys                   := ( 'key' | 'keys' ) ( keylist | keygenerated ) ;
keylist                := propertylist ;
keygenerated           := 'generate' keygenlocal ;
keygenlocal            := 'local' columnname ;

(* Optimistic Concurrency Control / ETag *)
concurrencytoken       := ( 'concurrencytoken' | 'etag' ) [propertylist] ;

(* Navigation Properties *)
navigates              := 'navigates' '(' navlist ')' ;
navlist                := naventry [',' navlist] ;
naventry               := assocname 'as' navpropname [fromend] ;
assocname              := quotedstring ;
navpropname            := quotedstring ;
fromend                := 'from' ( 'principal' | 'dependent' ) ;

(* Aggregation *)
aggregates             := 'aggregates' 'always' [aggregatestuple] ;
aggregatestuple        := '(' aggregateslist ')' ;
aggregateslist         := aggregate [',' aggregateslist] ;
aggregate              := aggregatefunction 'of' columnname ;
aggregatefunction      := ( 'SUM' | 'AVG' | 'MIN' | 'MAX' ) ;

(* Calculation / Analytic View Input Parameters *)
parameters             := 'parameters' 'via' [parameterskeyand] 'entity'
                          [parameterentitysetname] [parametersresultsprop] ;
parameterskeyand       := 'key' 'and' ;
parameterentitysetname := quotedstring ;
parametersresultsprop  := 'results' 'property' quotedstring ;

(* Modification Exits & Restrictions *)
modification           := [create] [update] [delete] ;
create                 := 'create' modificationspec ;
update                 := 'update' modificationspec ;
delete                 := 'delete' modificationspec ;
modificationspec       := ( modificationaction [events] | events | 'forbidden' ) ;
modificationaction     := 'using' action ;
action                 := quotedstring ; (* "pkg::proc" or "pkg:file.xsjslib::func" *)
events                 := 'events' '(' eventlist ')' ;
eventlist              := eventtype action [',' eventlist] ;
eventtype              := ( 'before' | 'after' | 'precommit' | 'postcommit' | 'for' ) ;

(* Associations *)
association            := associationdef [assocrefconstraint] principalend dependentend
                          [( assoctable | storage | modification )] ;
associationdef         := 'association' ['via' 'parameters'] assocname ;
assocrefconstraint     := 'with' 'referential' 'constraint' ;
principalend           := 'principal' end ;
dependentend           := 'dependent' end ;
end                    := endref multiplicity ;
endref                 := endtype [joinpropertieslist] ;
endtype                := entitysetname ;
joinpropertieslist     := '(' joinproperties ')' ;
joinproperties         := columnlist ;
multiplicity           := 'multiplicity' quote multiplicityvalue quote ;
multiplicityvalue      := ( '1' | '0..1' | '1..*' | '*' ) ;

(* M:N Link Table & Association Storage *)
assoctable             := 'over' repoobject overprincipalend overdependentend [modification] ;
overprincipalend       := 'principal' overend ;
overdependentend       := 'dependent' overend ;
overend                := propertylist ;
storage                := ( nostorage | storageend [modification] ) ;
nostorage              := 'no' 'storage' ;
storageend             := 'storage' 'on' ( 'principal' | 'dependent' ) ;

(* SAP OData Annotations *)
annotations            := 'annotations' annotationsbody ;
annotationsbody        := '{' annotationscontent '}' ;
annotationscontent     := annotationconfig [annotationscontent] ;
annotationconfig       := ( 'enable' | 'disable' ) annotation ';' ;
annotation             := 'OData4SAP' ;

(* Service Settings *)
settings               := 'settings' settingsbody ;
settingsbody           := '{' settingscontent '}' ;
settingscontent        := settingentry [settingscontent] ;
settingentry           := ( supportnull | cachecontrol | hints | limits ) ';' ;
supportnull            := 'support' 'null' ;
cachecontrol           := ( 'content' | 'metadata' ) 'cache-control' quotedstring ;
hints                  := 'hints' ( hintlist | 'null' ) ;
hintlist               := quotedstring [',' hintlist] ;
limits                 := 'limits' limitlist ;
limitlist              := limitassignment [',' limitlist] ;
limitassignment        := ( 'max_records' | 'max_expanded_records' ) '=' integer_literal ;
integer_literal        := digit { digit } ;
```

---

## 6. Canonical Formatting Rules (Phase 2)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/008_6_Defining_Web-based_Data_Access_in_XS_Advanced.md (Pages 541–573)

1. **Block Openers & Closers:**
   - `service [namespace "..."] {`, `annotations {`, and `settings {` open an indentation block (`+1` indent) with `{` on the header line after a single space.
   - `}` closes the block (`-1` indent) on its own line without a trailing `;`. Empty blocks format as `{}` (`service {}`).
   - Separate consecutive top-level blocks (`service`, `annotations`, `settings`) with a blank line.
2. **`entity` Exposures & Line Wrapping:**
   - Each `entity` entry inside `service { ... }` starts at indent level `+1` and ends with `;`.
   - Catalog object qualifiers keep no spaces around `.` (`"MYSCHEMA"."MY_TABLE"`).
   - Short single-clause entries that fit within `maxLineLength` and contain no modification clauses or embedded comments stay on one line (`"sample.odata::order" as "Orders";`).
   - Multi-clause or long `entity` entries wrap major sub-clauses (`with (...)`, `without (...)`, `omitting (...)`, `key (...)` / `keys generate local "..."`, `concurrencytoken` / `etag`, `navigates (...)`, `aggregates always (...)`, `parameters via ...`, `create ...`, `update ...`, `delete ...`) onto continuation lines at indent level `+2`.
3. **`association` Blocks:**
   - Each `association [via parameters] "<Name>" [with referential constraint]` entry starts at indent level `+1` and ends with `;`.
   - Wrap `principal ... multiplicity "..."`, `dependent ... multiplicity "..."`, `over ...`, `principal (...)`, `dependent (...)`, `no storage` / `storage on ...`, and optional modification clauses onto continuation lines at indent level `+2` when multi-line or exceeding `maxLineLength`.
   - Keep entity-set join column parentheses attached without space (`"Customers"("ID")`), and space keyword-led lists (`navigates (...)`, `with (...)`, `events (...)`).
4. **`navigates` & `modification` Exit Specifications:**
   - `navigates (...)` stays single-line when fitting within `maxLineLength`; when exceeding `maxLineLength`, wrap comma-separated navigation entries onto `+1` indent lines (`+3` inside `service`) with closing `)` at `+2`.
   - Each `create` / `update` / `delete` modification clause (`using "..."`, `events (...)`, `forbidden`) starts on its own continuation line at indent level `+2` when multiple modification clauses or long exit paths are present; `events (...)` wraps comma-separated event handlers when exceeding `maxLineLength`.
5. **`annotations` & `settings` Entries:**
   - Place each entry (`enable OData4SAP;`, `support null;`, `content cache-control "...";`, `metadata cache-control "...";`, `hints ...;`, `limits max_records = ..., max_expanded_records = ...;`) at indent level `+1`, terminated with `;`.
   - Keep hyphenated `cache-control` intact without spaces around `-`, and use single spaces around `=` in `limits`.
6. **Comment Preservation, Pragmas & Recovery:**
   - Preserve `//` and `/* ... */` comments in relative position and emit `hanasql-format off ... on` regions verbatim.
   - Recover gracefully from missing `;` or unclosed parentheses/braces without dropping tokens.
