import { isKeyValueArtifact } from '../formatter/detect';
import { isClassicHdbrole } from '../formatter/hdbrole';
import type { SqlCompletionCandidate, SqlHoverResult } from './intellisense-core';

interface ArtifactFieldSpec {
  readonly name: string;
  readonly detail: string;
  readonly description: string;
  readonly defaultSnippet?: string;
  readonly enumValues?: readonly { readonly value: string; readonly description: string; readonly deprecated?: string }[];
  readonly deprecated?: string;
}

/** Design-time artifact languages with JSON / KV key completion and hover (`artifact-registry.md` IntelliSense column). */
export const ARTIFACT_INTELLISENSE_LANGUAGES: readonly string[] = [
  'xsaccess',
  'hdiconfig',
  'hdbgrants',
  'hdbrevokes',
  'hdbrole',
  'hdbschema',
  'hdbti',
  'xshttpdest',
];

/** Every `com.sap.hana.di.*` build plug-in in `docs/specs/artifacts/artifact-registry.md` (checked by `test/artifact-registry.test.ts`). */
export const HDI_PLUGIN_VALUES: readonly { readonly value: string; readonly description: string }[] = [
  { value: 'com.sap.hana.di.afllangprocedure', description: 'AFL language procedure plug-in (.hdbafllangprocedure)' },
  { value: 'com.sap.hana.di.analyticprivilege', description: 'XML analytic privilege plug-in (.hdbanalyticprivilege)' },
  { value: 'com.sap.hana.di.applicationtime', description: 'Application-time period table plug-in (.hdbapplicationtime)' },
  { value: 'com.sap.hana.di.calculationview', description: 'Calculation view plug-in (.hdbcalculationview)' },
  { value: 'com.sap.hana.di.cds', description: 'CDS artifact plug-in (.hdbcds)' },
  { value: 'com.sap.hana.di.collection', description: 'JSON document collection plug-in (.hdbcollection)' },
  { value: 'com.sap.hana.di.collection.adjacency_index', description: 'Document collection adjacency index plug-in (.hdbcollectionadjindex) [CLOUD]' },
  { value: 'com.sap.hana.di.collection.index', description: 'Document collection index plug-in (.hdbcollectionindex) [CLOUD]' },
  { value: 'com.sap.hana.di.constraint', description: 'Constraint plug-in (.hdbconstraint)' },
  { value: 'com.sap.hana.di.copyonly', description: 'Copy-only plug-in: deploys an arbitrary design-time resource (for example .txt) without a database object' },
  { value: 'com.sap.hana.di.dropcreatetable', description: 'Drop-and-create table plug-in (.hdbdropcreatetable)' },
  { value: 'com.sap.hana.di.eshconfig', description: 'Enterprise search configuration plug-in (.hdbeshconfig)' },
  { value: 'com.sap.hana.di.flowgraph', description: 'Flowgraph plug-in (.hdbflowgraph)' },
  { value: 'com.sap.hana.di.fulltextindex', description: 'Full-text index plug-in (.hdbfulltextindex)' },
  { value: 'com.sap.hana.di.function', description: 'SQLScript function plug-in (.hdbfunction)' },
  { value: 'com.sap.hana.di.graphworkspace', description: 'Graph workspace plug-in (.hdbgraphworkspace)' },
  { value: 'com.sap.hana.di.index', description: 'Index plug-in (.hdbindex)' },
  { value: 'com.sap.hana.di.library', description: 'SQLScript library plug-in (.hdblibrary)' },
  { value: 'com.sap.hana.di.logicalschema', description: 'Logical schema plug-in (.hdblogicalschema)' },
  { value: 'com.sap.hana.di.logicalschema.config', description: 'Logical schema configuration plug-in (.hdblogicalschemaconfig)' },
  { value: 'com.sap.hana.di.procedure', description: 'SQLScript procedure plug-in (.hdbprocedure)' },
  { value: 'com.sap.hana.di.projectionview', description: 'Projection view plug-in (.hdbprojectionview)' },
  { value: 'com.sap.hana.di.projectionview.config', description: 'Projection view configuration plug-in (.hdbprojectionviewconfig)' },
  { value: 'com.sap.hana.di.publicsynonym', description: 'Public synonym plug-in (.hdbpublicsynonym)' },
  { value: 'com.sap.hana.di.remotetablereplica', description: 'Remote table replication plug-in (.hdbremotetablereplica) [CLOUD]' },
  { value: 'com.sap.hana.di.reptask', description: 'Replication task plug-in (.hdbreptask)' },
  { value: 'com.sap.hana.di.resultcache', description: 'Result cache plug-in (.hdbresultcache)' },
  { value: 'com.sap.hana.di.role', description: 'Role plug-in (.hdbrole)' },
  { value: 'com.sap.hana.di.role.config', description: 'Role configuration plug-in (.hdbroleconfig)' },
  { value: 'com.sap.hana.di.schedulerjob', description: 'Scheduler job plug-in (.hdbschedulerjob)' },
  { value: 'com.sap.hana.di.searchruleset', description: 'Search rule set plug-in (.hdbsearchruleset)' },
  { value: 'com.sap.hana.di.sequence', description: 'Sequence plug-in (.hdbsequence)' },
  { value: 'com.sap.hana.di.sharedreplica', description: 'Fabric virtual table shared replica plug-in (.hdbfabricvirtualtable) [CLOUD]' },
  { value: 'com.sap.hana.di.statistics', description: 'Statistics plug-in (.hdbstatistics)' },
  { value: 'com.sap.hana.di.structuredfilter', description: 'Structured filter plug-in (.hdbstructuredfilter) [CLOUD]' },
  { value: 'com.sap.hana.di.structuredprivilege', description: 'Structured privilege plug-in (.hdbstructuredprivilege)' },
  { value: 'com.sap.hana.di.synonym', description: 'Synonym plug-in (.hdbsynonym)' },
  { value: 'com.sap.hana.di.synonym.config', description: 'Synonym configuration plug-in (.hdbsynonymconfig)' },
  { value: 'com.sap.hana.di.sysbicsynonym', description: '_SYS_BIC synonym plug-in (.hdbsysbicsynonym)' },
  { value: 'com.sap.hana.di.systemversioning', description: 'System-versioned table plug-in (.hdbsystemversioning)' },
  { value: 'com.sap.hana.di.table', description: 'Table plug-in (.hdbtable)' },
  { value: 'com.sap.hana.di.table.migration', description: 'Migration table plug-in (.hdbmigrationtable)' },
  { value: 'com.sap.hana.di.tabledata', description: 'Table data import plug-in (.hdbtabledata)' },
  { value: 'com.sap.hana.di.tabledata.properties', description: 'Table data properties plug-in (.properties, .tags)' },
  { value: 'com.sap.hana.di.tabledata.source', description: 'Table data source plug-in (.csv)' },
  { value: 'com.sap.hana.di.tabletype', description: 'Table type plug-in (.hdbtabletype)' },
  { value: 'com.sap.hana.di.textconfig', description: 'Text analysis configuration plug-in (.hdbtextconfig)' },
  { value: 'com.sap.hana.di.textdictionary', description: 'Text analysis dictionary plug-in (.hdbtextdict)' },
  { value: 'com.sap.hana.di.textminingconfig', description: 'Text mining configuration plug-in (.hdbtextminingconfig)' },
  { value: 'com.sap.hana.di.textrule', description: 'CGUL text analysis rule plug-in (.hdbtextrule)' },
  { value: 'com.sap.hana.di.textrule.include', description: 'CGUL text analysis rule include plug-in (.hdbtextinclude)' },
  { value: 'com.sap.hana.di.textrule.lexicon', description: 'CGUL text analysis rule lexicon plug-in (.hdbtextlexicon)' },
  { value: 'com.sap.hana.di.trigger', description: 'Trigger plug-in (.hdbtrigger)' },
  { value: 'com.sap.hana.di.view', description: 'SQL view plug-in (.hdbview)' },
  { value: 'com.sap.hana.di.virtualfunction', description: 'Virtual function plug-in (.hdbvirtualfunction)' },
  { value: 'com.sap.hana.di.virtualfunction.config', description: 'Virtual function configuration plug-in (.hdbvirtualfunctionconfig)' },
  { value: 'com.sap.hana.di.virtualfunctionpackage.hadoop', description: 'Deprecated Hadoop plug-in (.hdbmrjob, .hdbhadoopmrjob, .jar). Use com.sap.hana.di.virtualpackage.hadoop' },
  { value: 'com.sap.hana.di.virtualpackage.hadoop', description: 'Virtual package Hadoop plug-in (.hdbvirtualpackagehadoop)' },
  { value: 'com.sap.hana.di.virtualpackage.sparksql', description: 'Virtual package SparkSQL plug-in (.hdbvirtualpackagesparksql)' },
  { value: 'com.sap.hana.di.virtualprocedure', description: 'Virtual procedure plug-in (.hdbvirtualprocedure)' },
  { value: 'com.sap.hana.di.virtualprocedure.config', description: 'Virtual procedure configuration plug-in (.hdbvirtualprocedureconfig)' },
  { value: 'com.sap.hana.di.virtualtable', description: 'Virtual table plug-in (.hdbvirtualtable)' },
  { value: 'com.sap.hana.di.virtualtable.config', description: 'Virtual table configuration plug-in (.hdbvirtualtableconfig)' },
];

const PRIVILEGE_ENUM_VALUES: readonly { readonly value: string; readonly description: string; readonly deprecated?: string }[] = [
  { value: 'SELECT', description: 'Read rows from tables, views, or calculation views.' },
  { value: 'INSERT', description: 'Insert rows into target tables.' },
  { value: 'UPDATE', description: 'Update rows in target tables.' },
  { value: 'DELETE', description: 'Delete rows from target tables.' },
  { value: 'EXECUTE', description: 'Execute stored procedures or functions.' },
  { value: 'SELECT METADATA', description: 'Read catalog metadata definitions.' },
  { value: 'REFERENCES', description: 'Create foreign key references to target tables.' },
  { value: 'TRIGGER', description: 'Define triggers on target tables.' },
  { value: 'CREATE ANY', description: 'High-privilege schema object creation right; apply least privilege.' },
  { value: 'ALL PRIVILEGES', description: 'Overly broad privilege bundle (flagged by HANA-SEC-031/041).', deprecated: 'Avoid ALL PRIVILEGES; enumerate only required permissions.' },
];

const XSACCESS_ROOT_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'exposed', detail: 'boolean', description: 'Exposes the package content over HTTP(S). Default `false`.', defaultSnippet: 'true' },
  {
    name: 'authentication',
    detail: 'object | null',
    description: 'Required. `{ "method": "Form" }`; other methods are configured in the XS Administration Tool. `null` allows unauthenticated access (HANA-SEC-020).',
    defaultSnippet: '{ "method": "Form" }',
  },
  { name: 'authorization', detail: 'string[] | null', description: 'Application privileges from `.xsprivileges` required for access. `null` disables inherited authorization.', defaultSnippet: '["$1"]' },
  { name: 'anonymous_connection', detail: 'string | null', description: '`.xssqlcc` used when no credentials are provided. Default `null`; not recommended (HANA-SEC-022).', defaultSnippet: 'null' },
  { name: 'default_connection', detail: 'string', description: '`.xssqlcc` used for every SQL execution in the package (HANA-SEC-022).', defaultSnippet: '"$1"' },
  { name: 'cache_control', detail: 'string | null', description: 'HTTP `Cache-Control` directives. Default `null`; `"no-cache, no-store"` recommended.', defaultSnippet: '"no-cache, no-store"' },
  { name: 'cors', detail: 'object', description: 'Cross-origin resource sharing (`enabled`, `allowMethods`, `allowOrigin`, `maxAge`, `allowHeaders`, `exposeHeaders`). Disabled by default.', defaultSnippet: '{ "enabled": true, "allowOrigin": ["https://$1"] }' },
  { name: 'default_file', detail: 'string', description: 'File served for the package URL. Default `"index.html"`.', defaultSnippet: '"index.html"' },
  { name: 'enable_etags', detail: 'boolean', description: 'Generates ETags. Default `true`.', defaultSnippet: 'true' },
  { name: 'force_ssl', detail: 'boolean', description: 'Requires HTTPS. Default `false` (HANA-SEC-024).', defaultSnippet: 'true' },
  { name: 'mime_mapping', detail: 'object[]', description: 'MIME type overrides `{ "extension", "mimetype" }`; the server defaults stay valid for other extensions.', defaultSnippet: '[{ "extension": "$1", "mimetype": "$2" }]' },
  { name: 'prevent_xsrf', detail: 'boolean', description: 'Enforces the `X-CSRF-Token` check. Default `false` (HANA-SEC-021).', defaultSnippet: 'true' },
  { name: 'rewrite_rules', detail: 'object[]', description: 'URL rewrite rules `{ "source": "<regex>", "target": "<path>" }`.', defaultSnippet: '[{ "source": "$1", "target": "$2" }]' },
  { name: 'headers', detail: 'object', description: 'Custom response headers (`enabled`, `customHeaders`), e.g. X-Frame-Options (HANA-SEC-025).', defaultSnippet: '{ "enabled": true, "customHeaders": [{ "name": "X-Frame-Options", "value": "SAMEORIGIN" }] }' },
];

const XSACCESS_AUTH_FIELDS: readonly ArtifactFieldSpec[] = [
  {
    name: 'method',
    detail: 'string',
    description: 'Authentication method. Only `Form` is evaluated from `.xsaccess`; configure other methods in the SAP HANA XS Administration Tool.',
    defaultSnippet: '"Form"',
    enumValues: [
      { value: 'Form', description: 'Form-based logon (the only method evaluated from `.xsaccess`).' },
      { value: 'Basic', description: 'HTTP Basic authentication.', deprecated: 'Configure Basic authentication in the SAP HANA XS Administration Tool.' },
      { value: 'SAML', description: 'SAML 2.0 single sign-on.', deprecated: 'Configure SAML in the SAP HANA XS Administration Tool.' },
      { value: 'LogonTicket', description: 'SAP logon ticket.', deprecated: 'Configure logon tickets in the SAP HANA XS Administration Tool.' },
      { value: 'X509', description: 'X.509 client certificate.', deprecated: 'Configure X.509 in the SAP HANA XS Administration Tool.' },
      { value: 'SPNEGO', description: 'Kerberos / SPNEGO single sign-on.', deprecated: 'Configure SPNEGO in the SAP HANA XS Administration Tool.' },
    ],
  },
];

const XSACCESS_CORS_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'enabled', detail: 'boolean', description: 'Enables CORS. Default `false`: no preflight answers and no CORS headers.', defaultSnippet: 'true' },
  { name: 'allowMethods', detail: 'string[]', description: 'Allowed methods. Default `["GET", "POST", "HEAD", "OPTIONS"]`.', defaultSnippet: '["GET", "POST"]' },
  { name: 'allowOrigin', detail: 'string[]', description: 'Allowed origins (`*.sap.com` wildcards). Default `["*"]` (HANA-SEC-023).', defaultSnippet: '["https://$1"]' },
  { name: 'maxAge', detail: 'string', description: 'Preflight cache time in seconds. Default `"3600"`.', defaultSnippet: '"3600"' },
  { name: 'allowHeaders', detail: 'string[]', description: 'Allowed request headers. No default.', defaultSnippet: '["X-CSRF-Token", "Content-Type"]' },
  { name: 'exposeHeaders', detail: 'string[]', description: 'Response headers exposed to the client. No default.' },
];

const XSACCESS_HEADERS_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'enabled', detail: 'boolean', description: 'Must be `true` for custom headers to apply. Runtime settings override design-time settings.', defaultSnippet: 'true' },
  {
    name: 'customHeaders',
    detail: 'object[]',
    description: '`{ "name", "value" }` headers, e.g. X-Frame-Options `DENY`, `SAMEORIGIN` or `ALLOW-FROM <URL>`.',
    defaultSnippet: '[{ "name": "X-Frame-Options", "value": "SAMEORIGIN" }]',
  },
];

const HDICONFIG_ROOT_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'plugin_version', detail: 'string', description: 'Default HDI container plug-in API version (e.g. `"2.0.40.0"`).', defaultSnippet: '"2.0.40.0"' },
  { name: 'minimum_feature_version', detail: 'string', description: 'Minimum HDI server feature version (e.g. `"1000"`).', defaultSnippet: '"1000"' },
  { name: 'file_suffixes', detail: 'object', description: 'Map of artifact file suffixes (`hdbtable`, `hdbprocedure`, ...) to HDI plug-in bindings.', defaultSnippet: '{\n  "$1": { "plugin_name": "com.sap.hana.di.$2" }\n}' },
];

const HDICONFIG_SUFFIX_FIELDS: readonly ArtifactFieldSpec[] = [
  {
    name: 'plugin_name',
    detail: 'string',
    description: 'Fully qualified `com.sap.hana.di.*` HDI build plug-in handling this file extension.',
    defaultSnippet: '"com.sap.hana.di.$1"',
    enumValues: HDI_PLUGIN_VALUES,
  },
];

const GRANTOR_OWNER_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'system_privileges', detail: 'object[]', description: 'System privileges: `{ "privileges", "privileges_with_admin_option" }`.' },
  { name: 'global_roles', detail: 'object[]', description: 'Roles without a schema: `{ "roles", "roles_with_admin_option" }`. Not supported with an HDI container grantor.' },
  { name: 'schema_privileges', detail: 'object[]', description: 'Schema privileges: `{ "schema"?, "privileges", "privileges_with_grant_option" }`.' },
  { name: 'schema_roles', detail: 'object[]', description: 'Schema-local roles: `{ "schema"?, "roles", "roles_with_admin_option" }`.' },
  { name: 'object_privileges', detail: 'object[]', description: 'Object privileges: `{ "schema"?, "name", "privileges", "privileges_with_grant_option" }`.' },
  { name: 'global_object_privileges', detail: 'object[]', description: 'Objects without a schema: `{ "name", "type", "privileges", "privileges_with_grant_option" }`.' },
  { name: 'roles', detail: 'string[]', description: 'Global roles (older form).', deprecated: 'Superseded by `global_roles`; still accepted for backward compatibility.' },
  { name: 'container_roles', detail: 'string[]', description: 'Container roles (older form).', deprecated: 'Superseded by `schema_roles`; still accepted for backward compatibility.' },
];

const HDBGRANTS_ROOT_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'object_owner', detail: 'object', description: 'Privileges granted to the container object owner `<container>#OO`.' },
  { name: 'application_user', detail: 'object', description: 'Privileges granted to the application users bound to the modules (least privilege; HANA-SEC-040).' },
];

/** Items of `.hdbgrants` / `.hdbrevokes` privilege sets (`hdi-grants-roles.md` §2.3). */
const GRANTS_PRIVILEGE_ITEM_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'schema', detail: 'string', description: 'Fixed schema; overrides the schema of the grantor service.' },
  { name: 'name', detail: 'string', description: 'Object name (`object_privileges`, `global_object_privileges`).' },
  { name: 'type', detail: 'string', description: 'Object type for `global_object_privileges` (`REMOTE SOURCE`, `USERGROUP`, ...).' },
  { name: 'privileges', detail: 'string[]', description: 'Privileges granted without grant or admin option.', defaultSnippet: '["SELECT"]', enumValues: PRIVILEGE_ENUM_VALUES },
  {
    name: 'privileges_with_grant_option',
    detail: 'string[]',
    description: 'Privileges granted `WITH GRANT OPTION` (needed by the object owner for exposed definer-mode objects; HANA-SEC-040 on `application_user`).',
    defaultSnippet: '["SELECT"]',
    enumValues: PRIVILEGE_ENUM_VALUES,
  },
  { name: 'privileges_with_admin_option', detail: 'string[]', description: 'System privileges granted `WITH ADMIN OPTION` (`system_privileges` only).' },
  { name: 'roles', detail: 'string[]', description: 'Role names (`global_roles`, `schema_roles`). A name ending in `#` is for the object owner only.' },
  { name: 'roles_with_admin_option', detail: 'string[]', description: 'Roles granted `WITH ADMIN OPTION` (not with an HDI container grantor).' },
];

const HDBROLE_JSON_ROOT_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'role', detail: 'object', description: 'Root: an object with the single key `role`.' },
];

const HDBROLE_JSON_BODY_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'name', detail: 'string', description: 'Run-time role name. A name ending in `#` may hold grant-option privileges (HANA-SEC-033).' },
  { name: 'pattern_escape_character', detail: 'string', description: 'Escape character for `%` / `_` in wildcard object names. Default `\\`.' },
  { name: 'global_roles', detail: 'string[]', description: 'Roles without a schema.' },
  { name: 'schema_roles', detail: 'object[]', description: 'Schema-local roles: `{ "schema_reference"?, "names" }`.' },
  { name: 'system_privileges', detail: 'string[]', description: 'System privileges (HANA-SEC-031 / -032 on administrative or broad privileges).' },
  { name: 'schema_privileges', detail: 'object[]', description: 'Schema privileges: `{ "reference"?, "privileges", "privileges_with_grant_option"? }`.' },
  { name: 'object_privileges', detail: 'object[]', description: 'Object privileges: `{ "name", "type", "privileges", "privileges_with_grant_option"?, "pattern_mode"? }`.' },
  { name: 'global_object_privileges', detail: 'object[]', description: 'Objects without a schema: `{ "name", "type", "privileges", "schema_reference"? }`.' },
  { name: 'schema_analytic_privileges', detail: 'object[]', description: 'Analytic privileges: `{ "schema_reference"?, "privileges", "privileges_with_grant_option"? }`.' },
];

/** Entries of `.hdbrole` privilege and role lists (`hdi-grants-roles.md` §3.2). */
const ROLE_PRIVILEGE_ITEM_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'name', detail: 'string', description: 'Object name or synonym, or a wildcard pattern (`TABLE%`) with `pattern_mode`.' },
  { name: 'type', detail: 'string', description: 'Object type (`TABLE`, `VIEW`, `PROCEDURE`, `FUNCTION`, `SEQUENCE`, `SYNONYM`, `INDEX`, `TRIGGER`, ...).' },
  { name: 'privileges', detail: 'string[]', description: 'Privileges without grant option (non-empty).', defaultSnippet: '["SELECT"]', enumValues: PRIVILEGE_ENUM_VALUES },
  {
    name: 'privileges_with_grant_option',
    detail: 'string[]',
    description: 'Privileges with grant option; only in roles whose name ends with `#` (HANA-SEC-030 / -033).',
    defaultSnippet: '["SELECT"]',
    enumValues: PRIVILEGE_ENUM_VALUES,
  },
  {
    name: 'pattern_mode',
    detail: 'string',
    description: 'Required with a wildcard `name`: `include` grants to matching objects, `exclude` revokes from them.',
    defaultSnippet: '"include"',
    enumValues: [
      { value: 'include', description: 'Grant the privileges to every matching object at deployment.' },
      { value: 'exclude', description: 'Revoke the privileges from every matching object at deployment.' },
    ],
  },
  { name: 'reference', detail: 'string', description: 'Schema reference of a `schema_privileges` entry, resolved by `.hdbroleconfig`.' },
  { name: 'schema_reference', detail: 'string', description: 'Schema reference resolved by `.hdbroleconfig`; omitted = the container schema.' },
  { name: 'names', detail: 'string[]', description: 'Role or analytic privilege names (`schema_roles`, `schema_analytic_privileges`).' },
];

// Classic KV schemas
const KV_HDBTABLE_TOP: readonly ArtifactFieldSpec[] = [
  { name: 'table.schemaName', detail: 'string', description: 'Target SAP HANA database schema owning the table ([XSC]).', defaultSnippet: '"$1";' },
  {
    name: 'table.tableType',
    detail: 'COLUMNSTORE | ROWSTORE',
    description: 'Physical storage layout of the table (`COLUMNSTORE` or `ROWSTORE`).',
    defaultSnippet: 'COLUMNSTORE;',
    enumValues: [
      { value: 'COLUMNSTORE', description: 'In-memory column-oriented storage (default for analytical & transactional HANA tables).' },
      { value: 'ROWSTORE', description: 'In-memory row-oriented storage.' },
    ],
  },
  { name: 'table.temporary', detail: 'boolean', description: 'Defines whether the table is temporary.', defaultSnippet: 'false;' },
  { name: 'table.loggingType', detail: 'LOGGING | NOLOGGING', description: 'Redo logging mode for the table (`LOGGING` or `NOLOGGING`).', defaultSnippet: 'LOGGING;' },
  { name: 'table.columns', detail: 'object[]', description: 'Array of column definitions (`{ name = ...; sqlType = ...; }`).', defaultSnippet: '[\n  { name = "$1"; sqlType = NVARCHAR; length = 64; nullable = false; }\n];' },
  { name: 'table.indexes', detail: 'object[]', description: 'Array of secondary index definitions.', defaultSnippet: '[\n  { name = "$1"; unique = false; indexColumns = ["$2"]; }\n];' },
  { name: 'table.primaryKey.pkcolumns', detail: 'string[]', description: 'List of primary key column names.', defaultSnippet: '["$1"];' },
];

const KV_COLUMN_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'name', detail: 'string', description: 'Column identifier.', defaultSnippet: '"$1";' },
  {
    name: 'sqlType',
    detail: 'SQL data type',
    description: 'HANA column data type (`NVARCHAR`, `INTEGER`, `DECIMAL`, `TIMESTAMP`, etc.).',
    defaultSnippet: 'NVARCHAR;',
    enumValues: [
      'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'DOUBLE', 'REAL',
      'BOOLEAN', 'VARCHAR', 'NVARCHAR', 'ALPHANUM', 'SHORTTEXT', 'CLOB', 'NCLOB',
      'BLOB', 'DATE', 'TIME', 'TIMESTAMP', 'SECONDDATE', 'VARBINARY',
    ].map((t) => ({ value: t, description: `SAP HANA column SQL type ${t}.` })),
  },
  { name: 'length', detail: 'number', description: 'Maximum length for character/binary types (`VARCHAR`, `NVARCHAR`, `VARBINARY`).', defaultSnippet: '64;' },
  { name: 'precision', detail: 'number', description: 'Total number of significant digits for `DECIMAL`.', defaultSnippet: '15;' },
  { name: 'scale', detail: 'number', description: 'Scale digits after decimal point for `DECIMAL`.', defaultSnippet: '2;' },
  { name: 'nullable', detail: 'boolean', description: 'Whether NULL values are permitted in this column.', defaultSnippet: 'true;' },
  { name: 'defaultValue', detail: 'literal', description: 'Default literal value assigned when omitted in INSERT.', defaultSnippet: '"$1";' },
  { name: 'comment', detail: 'string', description: 'Column description metadata comment.', defaultSnippet: '"$1";' },
];

const KV_INDEX_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'name', detail: 'string', description: 'Index identifier.', defaultSnippet: '"$1";' },
  { name: 'unique', detail: 'boolean', description: 'Creates a UNIQUE secondary index when `true`.', defaultSnippet: 'false;' },
  {
    name: 'indexType',
    detail: 'B_TREE | CPB_TREE',
    description: 'Index algorithm (`B_TREE` or `CPB_TREE`).',
    defaultSnippet: 'B_TREE;',
    enumValues: [
      { value: 'B_TREE', description: 'Standard B-tree index.' },
      { value: 'CPB_TREE', description: 'Compressed prefix B-tree index for string columns.' },
    ],
  },
  {
    name: 'order',
    detail: 'ASC | DESC',
    description: 'Sort order for index keys.',
    defaultSnippet: 'ASC;',
    enumValues: [
      { value: 'ASC', description: 'Ascending sort order.' },
      { value: 'DESC', description: 'Descending sort order.' },
    ],
  },
  { name: 'indexColumns', detail: 'string[]', description: 'Ordered list of indexed column names.', defaultSnippet: '["$1"];' },
];

const KV_HDBVIEW_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'schema', detail: 'string', description: 'Target catalog schema owning the Classic view ([XSC]).', defaultSnippet: '"$1";' },
  { name: 'query', detail: 'string', description: 'Embedded SELECT query defining the view projection.', defaultSnippet: '"SELECT $1 FROM \\"$2\\"";' },
  { name: 'depends_on', detail: 'string[]', description: 'Repository object dependencies (`"pkg::Object"`).' },
  { name: 'depends_on_table', detail: 'string[]', description: 'Referenced repository `.hdbtable` artifacts.' },
  { name: 'depends_on_view', detail: 'string[]', description: 'Referenced repository `.hdbview` artifacts.' },
  { name: 'public', detail: 'boolean', description: 'Deprecated repository visibility setting (`true`/`false`).', defaultSnippet: 'false;' },
];

const KV_HDBSEQUENCE_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'schema', detail: 'string', description: 'Target catalog schema owning the sequence ([XSC]).', defaultSnippet: '"$1";' },
  { name: 'increment_by', detail: 'number', description: 'Step increment added on each `NEXTVAL`.', defaultSnippet: '1;' },
  { name: 'start_with', detail: 'number', description: 'Initial starting value of the sequence.', defaultSnippet: '1;' },
  { name: 'minvalue', detail: 'number', description: 'Minimum sequence boundary value.' },
  { name: 'maxvalue', detail: 'number', description: 'Maximum sequence boundary value.' },
  { name: 'nomaxvalue', detail: 'boolean', description: 'Disables upper bound checking when `true`.' },
  { name: 'nominvalue', detail: 'boolean', description: 'Disables lower bound checking when `true`.' },
  { name: 'cycles', detail: 'boolean', description: 'Restarts sequence when reaching min/max boundary.' },
  { name: 'reset_by', detail: 'string', description: 'SQL SELECT query executed to reset sequence values on restart.' },
  { name: 'depends_on', detail: 'string[]', description: 'Repository dependencies referenced by `reset_by`.' },
  { name: 'depends_on_table', detail: 'string[]', description: 'Referenced repository `.hdbtable` dependencies.' },
  { name: 'depends_on_view', detail: 'string[]', description: 'Referenced repository `.hdbview` dependencies.' },
  { name: 'public', detail: 'boolean', description: 'Exposes sequence visibility to external roles.' },
];

const KV_HDBSCHEMA_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'schema_name', detail: 'string', description: 'Catalog schema name created on repository activation ([XSC]).', defaultSnippet: '"$1";' },
];

const KV_HDBTI_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'import', detail: 'object[]', description: 'Array of CSV-to-table import configuration entries.', defaultSnippet: '[\n  {\n    table = "$1";\n    file = "$2";\n    header = true;\n    delimField = ",";\n  }\n];' },
  { name: 'table', detail: 'string', description: 'Target `.hdbtable` repository object (`"pkg::Table"`).', defaultSnippet: '"$1";' },
  { name: 'schema', detail: 'string', description: 'Catalog schema owning the target table.', defaultSnippet: '"$1";' },
  { name: 'cdstable', detail: 'string', description: 'Target CDS `.hdbdd` entity (`"pkg::Context.Entity"`).', defaultSnippet: '"$1";' },
  { name: 'file', detail: 'string', description: 'Source `.csv` repository artifact (`"pkg:data.csv"`).', defaultSnippet: '"$1";' },
  { name: 'header', detail: 'boolean', description: 'Indicates whether the CSV first line is a column header.', defaultSnippet: 'true;' },
  { name: 'delimField', detail: 'string', description: 'CSV column delimiter character (e.g. `","`, `";"`).', defaultSnippet: '",";' },
  { name: 'delimEnclosing', detail: 'string', description: 'Quote character enclosing CSV field values.', defaultSnippet: '"\\"";' },
  { name: 'distinguishEmptyFromNull', detail: 'boolean', description: 'Distinguishes empty strings `""` from SQL NULL.' },
  { name: 'useHeaderNames', detail: 'boolean', description: 'Maps CSV header column names directly to target table columns.', defaultSnippet: 'true;' },
  { name: 'keys', detail: 'string[]', description: 'Key filters limiting rows deleted/reloaded on `.hdbti` reactivation.' },
];

const KV_XSHTTPDEST_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'host', detail: 'string', description: 'Required. Host name of the HTTP destination ([XSC]).', defaultSnippet: '"$1";' },
  { name: 'port', detail: 'number', description: 'Required. Port of the HTTP destination.', defaultSnippet: '443;' },
  { name: 'description', detail: 'string', description: 'Short description. Default `""`.', defaultSnippet: '"$1";' },
  { name: 'useSSL', detail: 'boolean', description: 'Secures outbound connections with SSL (HTTPS). Default `false`.', defaultSnippet: 'true;' },
  {
    name: 'sslAuth',
    detail: 'client | anonymous',
    description: 'SSL authentication with `useSSL = true`. Default `client`.',
    defaultSnippet: 'client;',
    enumValues: [
      { value: 'client', description: 'Trust-store entry required (default).' },
      { value: 'anonymous', description: 'Built-in key; no trust store, no SSL authentication.' },
    ],
  },
  { name: 'sslHostCheck', detail: 'boolean', description: 'Certificate subject must match `host`. Default `true`.', defaultSnippet: 'true;' },
  { name: 'pathPrefix', detail: 'string', description: 'Prefix added to the request path. Default `""`.', defaultSnippet: '"/";' },
  {
    name: 'authType',
    detail: 'string',
    description: 'Outbound authentication. Default `none`.',
    defaultSnippet: 'none;',
    enumValues: [
      { value: 'none', description: 'No authentication (default).' },
      { value: 'basic', description: 'User name and password.' },
      { value: 'AssertionTicket', description: 'SAP assertion ticket SSO to a remote ABAP system (`remoteSID`, `remoteClient`).' },
      { value: 'SamlAssertion', description: 'SAML assertion (`samlProvider`, `samlACS`, `samlAttributes`, `samlNameId`).' },
      { value: 'SamlAssertionPropagation', description: 'Propagates the SAML assertion of the logged-on user.' },
    ],
  },
  { name: 'samlProvider', detail: 'string', description: 'SAML identity provider (`authType = SamlAssertion`).' },
  { name: 'samlACS', detail: 'string', description: 'How the SAML response is sent: `""` (POST parameter), a URL path, `"header"`, `"parameter:assertion"`.' },
  { name: 'samlAttributes', detail: 'string', description: 'Additional SAML attributes: `"name1=<property>&name2=<property>"`.' },
  { name: 'samlNameId', detail: 'string[]', description: 'Name-ID mappings: `"email"`, `"unspecified"`.' },
  {
    name: 'proxyType',
    detail: 'none | http | socks',
    description: 'Proxy used to resolve the host. Default `none`.',
    defaultSnippet: 'none;',
    enumValues: [
      { value: 'none', description: 'No proxy (default).' },
      { value: 'http', description: 'HTTP proxy (`proxyHost`, `proxyPort`).' },
      { value: 'socks', description: 'SOCKS proxy (`proxyHost`, `proxyPort`).' },
    ],
  },
  { name: 'proxyHost', detail: 'string', description: 'Proxy host name. Default `""`.' },
  { name: 'proxyPort', detail: 'number', description: 'Proxy port. Default `0`.' },
  { name: 'useProxy', detail: 'boolean', description: 'Older proxy switch.', deprecated: 'Use `proxyType`.' },
  { name: 'timeout', detail: 'number', description: 'Connect timeout in milliseconds. Default `-1` (no limit; the 300 s request-session timeout still applies).', defaultSnippet: '5000;' },
  { name: 'remoteSID', detail: 'string', description: 'SID of the remote ABAP system (`authType = AssertionTicket`).' },
  { name: 'remoteClient', detail: 'string', description: 'Client of the remote ABAP system (`authType = AssertionTicket`).' },
  { name: 'oAuthAppConfigPackage', detail: 'string', description: 'Package of the `.xsoauthappconfig`.' },
  { name: 'oAuthAppConfig', detail: 'string', description: 'Name of the `.xsoauthappconfig` used by this destination.' },
  { name: 'modifies', detail: 'path', description: 'Extension files only: `modifies pkg.path:dest.xshttpdest;` names the destination to extend.' },
];

interface JsonFrame {
  readonly type: 'object' | 'array';
  activeKey: string | null;
  expectingValue: boolean;
}

interface JsonCursorContext {
  readonly inComment: boolean;
  readonly inString: boolean;
  readonly quoteStart: number;
  readonly typedPrefix: string;
  readonly parentContainerKey: string | null;
  readonly currentPropertyKey: string | null;
  readonly isValuePosition: boolean;
  readonly inArray: boolean;
  readonly ancestorKeys: readonly string[];
}

function getJsonCursorContext(text: string, offset: number): JsonCursorContext {
  const stack: JsonFrame[] = [];
  let i = 0;
  let inComment = false;
  let inString = false;
  let quoteStart = -1;
  let lastParsedString: string | null = null;

  while (i < offset) {
    const c = text[i];
    const next = text[i + 1] ?? '';

    if (c === '/' && next === '/') {
      i += 2;
      while (i < offset && text[i] !== '\n') i++;
      if (i >= offset && text[i - 1] !== '\n') inComment = true;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      let closed = false;
      while (i < offset) {
        if (text[i] === '*' && text[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) inComment = true;
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      let closed = false;
      while (i < offset) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          closed = true;
          lastParsedString = text.slice(start + 1, i);
          i++;
          break;
        }
        i++;
      }
      if (!closed) {
        inString = true;
        quoteStart = start;
      } else {
        const top = stack[stack.length - 1];
        if (top && top.type === 'object' && !top.expectingValue) {
          top.activeKey = lastParsedString;
        }
      }
      continue;
    }

    if (c === '{') {
      stack.push({ type: 'object', activeKey: null, expectingValue: false });
    } else if (c === '[') {
      stack.push({ type: 'array', activeKey: null, expectingValue: true });
    } else if (c === '}' || c === ']') {
      stack.pop();
    } else if (c === ':') {
      const top = stack[stack.length - 1];
      if (top && top.type === 'object') {
        top.expectingValue = true;
      }
    } else if (c === ',') {
      const top = stack[stack.length - 1];
      if (top && top.type === 'object') {
        top.activeKey = null;
        top.expectingValue = false;
      }
    }
    i++;
  }

  const typedPrefix = inString
    ? text.slice(quoteStart + 1, offset)
    : /([a-zA-Z0-9_.$]*)$/.exec(text.slice(0, offset))?.[1] ?? '';

  const ancestorKeys = stack.map((f) => f.activeKey).filter((k): k is string => Boolean(k));
  const top = stack[stack.length - 1];
  const prev = stack.length >= 2 ? stack[stack.length - 2] : undefined;

  let parentContainerKey: string | null = null;
  for (let idx = stack.length - 2; idx >= 0; idx--) {
    if (stack[idx].type === 'object') {
      parentContainerKey = stack[idx].activeKey;
      break;
    }
  }

  return {
    inComment,
    inString,
    quoteStart,
    typedPrefix,
    parentContainerKey,
    currentPropertyKey: top?.type === 'object' && top.expectingValue ? top.activeKey : top?.type === 'array' ? prev?.activeKey ?? null : null,
    isValuePosition: Boolean((top?.type === 'object' && top.expectingValue) || top?.type === 'array'),
    inArray: top?.type === 'array',
    ancestorKeys,
  };
}

function toJsonFieldCompletions(
  fields: readonly ArtifactFieldSpec[],
  ctx: JsonCursorContext,
  offset: number
): readonly SqlCompletionCandidate[] {
  const lower = ctx.typedPrefix.toLowerCase();
  const candidates: SqlCompletionCandidate[] = [];

  for (const f of fields) {
    if (lower && !f.name.toLowerCase().startsWith(lower)) continue;
    const insertText = ctx.inString
      ? f.name
      : `"${f.name}": ${f.defaultSnippet ?? '"$1"'}`;
    const isSnippet = !ctx.inString && Boolean((f.defaultSnippet ?? '"$1"').includes('$1'));
    candidates.push({
      label: f.name,
      insertText,
      ...(isSnippet ? { isSnippet: true } : {}),
      kind: 'keyword',
      detail: f.detail,
      documentation: f.deprecated ? `**@deprecated** ${f.deprecated}\n\n${f.description}` : f.description,
      ...(f.deprecated ? { deprecated: f.deprecated } : {}),
      sortPrefix: '0',
      ...(ctx.inString ? { replaceStart: ctx.quoteStart + 1, replaceEnd: offset } : {}),
    });
  }
  return candidates;
}

function toEnumValueCompletions(
  values: readonly { readonly value: string; readonly description: string; readonly deprecated?: string }[],
  typedPrefix: string,
  quoteStart: number,
  inString: boolean,
  offset: number,
  wrapQuotes = true
): readonly SqlCompletionCandidate[] {
  const lower = typedPrefix.toLowerCase();
  return values
    .filter((v) => !lower || v.value.toLowerCase().startsWith(lower))
    .map((v) => ({
      label: v.value,
      insertText: inString || !wrapQuotes ? v.value : `"${v.value}"`,
      kind: 'constant' as const,
      detail: 'allowed value',
      documentation: v.deprecated ? `**@deprecated** ${v.deprecated}\n\n${v.description}` : v.description,
      ...(v.deprecated ? { deprecated: v.deprecated } : {}),
      sortPrefix: '0',
      ...(inString ? { replaceStart: quoteStart + 1, replaceEnd: offset } : {}),
    }));
}

function resolveJsonFieldsForContext(languageId: string, ctx: JsonCursorContext): readonly ArtifactFieldSpec[] {
  if (languageId === 'xsaccess') {
    if (ctx.parentContainerKey === 'authentication') return XSACCESS_AUTH_FIELDS;
    if (ctx.parentContainerKey === 'cors') return XSACCESS_CORS_FIELDS;
    if (ctx.parentContainerKey === 'headers') return XSACCESS_HEADERS_FIELDS;
    return XSACCESS_ROOT_FIELDS;
  }
  if (languageId === 'hdiconfig') {
    if (ctx.ancestorKeys.includes('file_suffixes') && ctx.ancestorKeys.length >= 2) {
      return HDICONFIG_SUFFIX_FIELDS;
    }
    return HDICONFIG_ROOT_FIELDS;
  }
  if (languageId === 'hdbgrants' || languageId === 'hdbrevokes') {
    if (
      ctx.parentContainerKey === 'system_privileges' ||
      ctx.parentContainerKey === 'global_roles' ||
      ctx.parentContainerKey === 'schema_privileges' ||
      ctx.parentContainerKey === 'schema_roles' ||
      ctx.parentContainerKey === 'object_privileges' ||
      ctx.parentContainerKey === 'global_object_privileges'
    ) {
      return GRANTS_PRIVILEGE_ITEM_FIELDS;
    }
    if (ctx.parentContainerKey === 'object_owner' || ctx.parentContainerKey === 'application_user') {
      return GRANTOR_OWNER_FIELDS;
    }
    return HDBGRANTS_ROOT_FIELDS;
  }
  if (languageId === 'hdbrole') {
    if (
      ctx.parentContainerKey === 'schema_privileges' ||
      ctx.parentContainerKey === 'object_privileges' ||
      ctx.parentContainerKey === 'global_object_privileges' ||
      ctx.parentContainerKey === 'schema_analytic_privileges' ||
      ctx.parentContainerKey === 'schema_roles'
    ) {
      return ROLE_PRIVILEGE_ITEM_FIELDS;
    }
    if (ctx.parentContainerKey === 'role' || ctx.ancestorKeys[0] === 'role') {
      return HDBROLE_JSON_BODY_FIELDS;
    }
    return HDBROLE_JSON_ROOT_FIELDS;
  }
  return [];
}

function allJsonFieldsForLanguage(languageId: string): readonly ArtifactFieldSpec[] {
  switch (languageId) {
    case 'xsaccess':
      return [...XSACCESS_ROOT_FIELDS, ...XSACCESS_AUTH_FIELDS, ...XSACCESS_CORS_FIELDS, ...XSACCESS_HEADERS_FIELDS];
    case 'hdiconfig':
      return [...HDICONFIG_ROOT_FIELDS, ...HDICONFIG_SUFFIX_FIELDS];
    case 'hdbgrants':
    case 'hdbrevokes':
      return [...HDBGRANTS_ROOT_FIELDS, ...GRANTOR_OWNER_FIELDS, ...GRANTS_PRIVILEGE_ITEM_FIELDS];
    case 'hdbrole':
      return [...HDBROLE_JSON_ROOT_FIELDS, ...HDBROLE_JSON_BODY_FIELDS, ...ROLE_PRIVILEGE_ITEM_FIELDS];
    default:
      return [];
  }
}

function getJsonArtifactCompletions(
  languageId: string,
  text: string,
  offset: number
): readonly SqlCompletionCandidate[] {
  const ctx = getJsonCursorContext(text, offset);
  if (ctx.inComment) return [];

  const scopeFields = resolveJsonFieldsForContext(languageId, ctx);

  if (ctx.isValuePosition && ctx.currentPropertyKey) {
    const matchedField =
      scopeFields.find((f) => f.name === ctx.currentPropertyKey) ??
      allJsonFieldsForLanguage(languageId).find((f) => f.name === ctx.currentPropertyKey);
    if (matchedField?.enumValues) {
      return toEnumValueCompletions(
        matchedField.enumValues,
        ctx.typedPrefix,
        ctx.quoteStart,
        ctx.inString,
        offset,
        true
      );
    }
    return [];
  }

  return toJsonFieldCompletions(scopeFields, ctx, offset);
}

function extractStringAtOffset(text: string, offset: number): { value: string; start: number; end: number } | null {
  let i = offset;
  while (i > 0 && text[i - 1] !== '"' && text[i - 1] !== '\n') i--;
  if (i === 0 || text[i - 1] !== '"') return null;
  const start = i - 1;
  let j = offset;
  while (j < text.length && text[j] !== '"' && text[j] !== '\n') j++;
  if (j >= text.length || text[j] !== '"') return null;
  return { value: text.slice(start + 1, j), start, end: j + 1 };
}

function getJsonArtifactHover(languageId: string, text: string, offset: number): SqlHoverResult | null {
  const ctx = getJsonCursorContext(text, offset);
  if (ctx.inComment) return null;
  const span = extractStringAtOffset(text, offset);
  if (!span) return null;

  const allFields = allJsonFieldsForLanguage(languageId);
  const field = allFields.find((f) => f.name === span.value);
  if (field) {
    const dep = field.deprecated ? `\n\n**@deprecated** ${field.deprecated}` : '';
    return {
      markdown: `\`\`\`json\n"${field.name}": ${field.detail}\n\`\`\`${dep}\n\n${field.description}`,
      start: span.start,
      end: span.end,
    };
  }

  for (const f of allFields) {
    const enumItem = f.enumValues?.find((v) => v.value === span.value);
    if (enumItem) {
      const dep = enumItem.deprecated ? `\n\n**@deprecated** ${enumItem.deprecated}` : '';
      return {
        markdown: `\`\`\`json\n"${enumItem.value}"\n\`\`\`${dep}\n\n${enumItem.description}`,
        start: span.start,
        end: span.end,
      };
    }
  }

  return null;
}

const KV_SQL_ASSIGN_ENUMS: ReadonlyMap<string, readonly { readonly value: string; readonly description: string }[]> = new Map([
  ['tableType', KV_HDBTABLE_TOP.find((f) => f.name === 'table.tableType')!.enumValues!],
  ['table.tableType', KV_HDBTABLE_TOP.find((f) => f.name === 'table.tableType')!.enumValues!],
  ['sqlType', KV_COLUMN_FIELDS.find((f) => f.name === 'sqlType')!.enumValues!],
  ['indexType', KV_INDEX_FIELDS.find((f) => f.name === 'indexType')!.enumValues!],
  ['order', KV_INDEX_FIELDS.find((f) => f.name === 'order')!.enumValues!],
  ['authType', KV_XSHTTPDEST_FIELDS.find((f) => f.name === 'authType')!.enumValues!],
  ['sslAuth', KV_XSHTTPDEST_FIELDS.find((f) => f.name === 'sslAuth')!.enumValues!],
  ['proxyType', KV_XSHTTPDEST_FIELDS.find((f) => f.name === 'proxyType')!.enumValues!],
]);

function scanKvCommentAndString(text: string, offset: number): boolean {
  let i = 0;
  while (i < offset) {
    const c = text[i];
    const next = text[i + 1] ?? '';
    if (c === '/' && next === '/') {
      i += 2;
      while (i < offset && text[i] !== '\n') i++;
      if (i >= offset && text[i - 1] !== '\n') return true;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      let closed = false;
      while (i < offset) {
        if (text[i] === '*' && text[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) return true;
      continue;
    }
    if (c === '"') {
      i++;
      let closed = false;
      while (i < offset) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) return true;
      continue;
    }
    i++;
  }
  return false;
}

function resolveKvFieldsForContext(languageId: string, textBefore: string): readonly ArtifactFieldSpec[] {
  if (languageId === 'hdbtable' || languageId === 'hdbstructure') {
    const openBraces = (textBefore.match(/\{/g) || []).length - (textBefore.match(/\}/g) || []).length;
    if (openBraces > 0) {
      const lastCols = textBefore.lastIndexOf('columns');
      const lastIdx = textBefore.lastIndexOf('indexes');
      if (lastIdx > lastCols) return KV_INDEX_FIELDS;
      return KV_COLUMN_FIELDS;
    }
    return KV_HDBTABLE_TOP;
  }
  if (languageId === 'hdbview') return KV_HDBVIEW_FIELDS;
  if (languageId === 'hdbsequence') return KV_HDBSEQUENCE_FIELDS;
  if (languageId === 'hdbschema') return KV_HDBSCHEMA_FIELDS;
  if (languageId === 'hdbti') return KV_HDBTI_FIELDS;
  if (languageId === 'xshttpdest') return KV_XSHTTPDEST_FIELDS;
  return [];
}

function allKvFieldsForLanguage(languageId: string): readonly ArtifactFieldSpec[] {
  if (languageId === 'hdbtable' || languageId === 'hdbstructure') {
    return [...KV_HDBTABLE_TOP, ...KV_COLUMN_FIELDS, ...KV_INDEX_FIELDS];
  }
  return resolveKvFieldsForContext(languageId, '');
}

function getKvArtifactCompletions(
  languageId: string,
  text: string,
  offset: number
): readonly SqlCompletionCandidate[] {
  if (scanKvCommentAndString(text, offset)) return [];

  const before = text.slice(0, offset);
  const assignMatch = /([a-zA-Z_][a-zA-Z0-9_.]*)\s*=\s*([a-zA-Z0-9_]*)$/.exec(before);
  if (assignMatch) {
    const key = assignMatch[1];
    const valuePrefix = assignMatch[2] ?? '';
    const enums = KV_SQL_ASSIGN_ENUMS.get(key);
    if (enums) {
      return toEnumValueCompletions(enums, valuePrefix, offset - valuePrefix.length, false, offset, false);
    }
    return [];
  }

  const keyPrefixMatch = /([a-zA-Z_][a-zA-Z0-9_.]*)$/.exec(before);
  const prefix = keyPrefixMatch ? keyPrefixMatch[1] : '';
  const replaceStart = offset - prefix.length;
  const lower = prefix.toLowerCase();
  const fields = resolveKvFieldsForContext(languageId, before);

  return fields
    .filter((f) => !lower || f.name.toLowerCase().startsWith(lower))
    .map((f) => ({
      label: f.name,
      insertText: f.defaultSnippet ? `${f.name} = ${f.defaultSnippet}` : `${f.name} = $1;`,
      isSnippet: Boolean((f.defaultSnippet ?? '$1').includes('$1')),
      kind: 'keyword' as const,
      detail: f.detail,
      documentation: f.description,
      sortPrefix: '0',
      replaceStart,
      replaceEnd: offset,
    }));
}

function getKvArtifactHover(languageId: string, text: string, offset: number): SqlHoverResult | null {
  if (scanKvCommentAndString(text, offset)) return null;
  const keyRe = /[a-zA-Z0-9_.]/;
  let start = offset;
  let end = offset;
  while (start > 0 && keyRe.test(text[start - 1])) start--;
  while (end < text.length && keyRe.test(text[end])) end++;
  if (start === end) return null;

  const ident = text.slice(start, end);
  const allFields = allKvFieldsForLanguage(languageId);
  const matched = allFields.find((f) => f.name === ident);
  if (matched) {
    return {
      markdown: `\`\`\`ini\n${matched.name}: ${matched.detail}\n\`\`\`\n\n${matched.description}`,
      start,
      end,
    };
  }

  for (const enums of KV_SQL_ASSIGN_ENUMS.values()) {
    const val = enums.find((v) => v.value === ident);
    if (val) {
      return {
        markdown: `\`\`\`ini\n${val.value}\n\`\`\`\n\n${val.description}`,
        start,
        end,
      };
    }
  }
  return null;
}

const JSON_CONFIG_LANGUAGES = new Set(['xsaccess', 'hdiconfig', 'hdbgrants', 'hdbrevokes']);
const KV_ONLY_LANGUAGES = new Set(['hdbschema', 'hdbti', 'xshttpdest']);
const DUAL_SQL_OR_KV_LANGUAGES = new Set(['hdbtable', 'hdbstructure', 'hdbview', 'hdbsequence']);

export function isDesignTimeConfigOrKvMode(languageId: string, text: string): boolean {
  if (JSON_CONFIG_LANGUAGES.has(languageId) || KV_ONLY_LANGUAGES.has(languageId)) {
    return true;
  }
  if (languageId === 'hdbrole') {
    return !isClassicHdbrole(text);
  }
  if (DUAL_SQL_OR_KV_LANGUAGES.has(languageId)) {
    return isKeyValueArtifact(text);
  }
  return false;
}

export function getArtifactCompletions(
  languageId: string,
  text: string,
  offset: number
): readonly SqlCompletionCandidate[] {
  if (JSON_CONFIG_LANGUAGES.has(languageId) || (languageId === 'hdbrole' && !isClassicHdbrole(text))) {
    return getJsonArtifactCompletions(languageId, text, offset);
  }
  if (
    KV_ONLY_LANGUAGES.has(languageId) ||
    (DUAL_SQL_OR_KV_LANGUAGES.has(languageId) && isKeyValueArtifact(text))
  ) {
    return getKvArtifactCompletions(languageId, text, offset);
  }
  return [];
}

export function getArtifactHover(
  languageId: string,
  text: string,
  offset: number
): SqlHoverResult | null {
  if (JSON_CONFIG_LANGUAGES.has(languageId) || (languageId === 'hdbrole' && !isClassicHdbrole(text))) {
    return getJsonArtifactHover(languageId, text, offset);
  }
  if (
    KV_ONLY_LANGUAGES.has(languageId) ||
    (DUAL_SQL_OR_KV_LANGUAGES.has(languageId) && isKeyValueArtifact(text))
  ) {
    return getKvArtifactHover(languageId, text, offset);
  }
  return null;
}
