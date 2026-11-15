# SAP HANA Formatter Demo Fixtures

These intentionally compact / inconsistently formatted files let you preview **Format Document** (`Shift+Alt+F`) across every artifact type supported by the extension:

- `query-and-proc.sql` — SQL & SQLScript formatting + `hanasql-format off`/`on` pragma
- `hdi-procedure.hdbprocedure` — HDI headerless procedure with `USING` library declaration (no trailing `;`)
- `hdi-tabletype.hdbtabletype` — HDI headerless table type (no trailing `;`)
- `classic-table.hdbtable` — XS Classic key-value table definition
- `classic-view.hdbview` — XS Classic view with embedded SQL in `query = "..."`
- `classic-sequence.hdbsequence` — XS Classic sequence with `reset_by` SQL
- `classic-schema.hdbschema` — XS Classic schema definition
- `table-import.hdbti` — XS Classic `.hdbti` import config with `keys` pairs
- `classic-model.hdbdd` — XS Classic CDS model
- `hdi-model.hdbcds` — HDI / XSA CDS model (`technical configuration`, `mixin`/`into`, view parameters)
- `service.xsodata` — OData v2 service definition (`entity`, `association`, `navigates`, `modification` exits, `settings`, `annotations`)
