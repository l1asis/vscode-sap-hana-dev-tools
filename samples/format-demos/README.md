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
- `classic-role.hdbrole` — XS Classic role DSL (`extends role`, `catalog sql object`, privilege lists)
- `hdi-role.hdbrole` — HDI JSON role definition
- `container-config.hdiconfig` — HDI container build plug-in configuration (JSON / JSONC)
- `migration.hdbmigrationtable` — HDI migration table (`== version` / `== migration` headers + SQL DDL)
- `destination.xshttpdest` — XS Classic HTTP destination (`key = value;`)
- `service.xsjs` — XS JavaScript service endpoint (VS Code JS formatter delegation + `hanasql-format off`/`on` pragmas)
