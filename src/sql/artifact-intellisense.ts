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
  { name: 'exposed', detail: 'boolean', description: 'Controls whether package HTTP content is accessible over HTTP(S).', defaultSnippet: 'true' },
  {
    name: 'authentication',
    detail: 'object | object[] | null',
    description: 'Specifies HTTP authentication mechanism(s). Setting `null` exposes unauthenticated public endpoints (HANA-SEC-020).',
    defaultSnippet: '{ "method": "$1" }',
  },
  { name: 'authorization', detail: 'string[]', description: 'List of application privileges required to access package resources.', defaultSnippet: '["$1"]' },
  { name: 'prevent_xsrf', detail: 'boolean', description: 'Enables CSRF token enforcement on state-changing requests (recommended `true`).', defaultSnippet: 'true' },
  { name: 'force_ssl', detail: 'boolean', description: 'Requires encrypted HTTPS connections (recommended `true`).', defaultSnippet: 'true' },
  { name: 'anonymous_connection', detail: 'string | null', description: 'Anonymous `.xssqlcc` SQL connection configuration (high-risk public execution; HANA-SEC-022).', defaultSnippet: 'null' },
  { name: 'default_connection', detail: 'string', description: 'Package default `.xssqlcc` configuration.', defaultSnippet: '"$1"' },
  { name: 'cors', detail: 'object', description: 'Cross-Origin Resource Sharing configuration (`enabled`, `allowOrigin`, `allowMethods`, `allowCredential`).', defaultSnippet: '{ "enabled": true, "allowOrigin": ["$1"] }' },
  { name: 'headers', detail: 'object', description: 'Custom HTTP response headers and `x_frame_options` clickjacking protection.', defaultSnippet: '{ "x_frame_options": "SAMEORIGIN" }' },
  { name: 'cache_control', detail: 'string', description: 'Cache-Control HTTP response directive (`no-cache`, `max-age=...`).', defaultSnippet: '"no-cache, no-store"' },
  { name: 'mime_types', detail: 'object[]', description: 'Custom MIME type overrides for served static assets.', defaultSnippet: '[{ "extension": "$1", "mimetype": "$2" }]' },
  { name: 'rewrite_rules', detail: 'object[]', description: 'URL rewrite rules mapping source patterns to target paths.', defaultSnippet: '[{ "source": "$1", "target": "$2" }]' },
  { name: 'default_file', detail: 'string', description: 'Default entry file served when requesting the package root.', defaultSnippet: '"index.html"' },
  { name: 'max_request_runtime', detail: 'number', description: 'Maximum allowed XSJS request execution time in seconds.', defaultSnippet: '300' },
  { name: 'enable_etags', detail: 'boolean', description: 'Enables HTTP ETag headers for conditional caching.', defaultSnippet: 'true' },
];

const XSACCESS_AUTH_FIELDS: readonly ArtifactFieldSpec[] = [
  {
    name: 'method',
    detail: 'string',
    description: 'Authentication scheme (`Form`, `Basic`, `SAML`, `LogonTicket`, `X509`, `SPNEGO`).',
    defaultSnippet: '"Form"',
    enumValues: [
      { value: 'Form', description: 'Form-based HTML login redirect authentication.' },
      { value: 'Basic', description: 'HTTP Basic authentication over HTTPS.' },
      { value: 'SAML', description: 'SAML 2.0 Single Sign-On identity provider assertion.' },
      { value: 'LogonTicket', description: 'SAP Logon Ticket authentication.' },
      { value: 'X509', description: 'Mutual TLS X.509 client certificate authentication.' },
      { value: 'SPNEGO', description: 'Kerberos / SPNEGO browser SSO.' },
    ],
  },
  { name: 'realm', detail: 'string', description: 'HTTP authentication realm identifier.' },
];

const XSACCESS_CORS_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'enabled', detail: 'boolean', description: 'Enables CORS headers for cross-origin requests.', defaultSnippet: 'true' },
  { name: 'allowOrigin', detail: 'string[]', description: 'Allowed Origin URLs. Avoid `"*"` wildcard (HANA-SEC-023).', defaultSnippet: '["https://$1"]' },
  { name: 'allowMethods', detail: 'string[]', description: 'Permitted HTTP verbs (`GET`, `POST`, `PUT`, `DELETE`).', defaultSnippet: '["GET", "POST"]' },
  { name: 'allowHeaders', detail: 'string[]', description: 'Permitted custom request headers.', defaultSnippet: '["X-CSRF-Token", "Content-Type"]' },
  { name: 'exposeHeaders', detail: 'string[]', description: 'Response headers exposed to browser XHR/fetch clients.' },
  { name: 'maxAge', detail: 'string | number', description: 'Preflight OPTIONS cache duration in seconds.' },
  { name: 'allowCredential', detail: 'boolean', description: 'Allows cookies/credentials on cross-origin requests (never combine with `"*"` origin; HANA-SEC-024).', defaultSnippet: 'false' },
];

const XSACCESS_HEADERS_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'custom', detail: 'object[]', description: 'Array of `{ name, value }` custom HTTP response headers.' },
  { name: 'x_frame_options', detail: 'string', description: 'Clickjacking protection (`DENY`, `SAMEORIGIN`, or `ALLOW-FROM <uri>`).' },
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
  { name: 'schema_privileges', detail: 'object[]', description: 'Schema-level privileges granted by the grantor service.' },
  { name: 'object_privileges', detail: 'object[]', description: 'Object-level privileges (`reference`, `privileges`) granted by the grantor service.' },
  { name: 'global_object_privileges', detail: 'object[]', description: 'External/catalog object privileges with explicit `schema`.' },
  { name: 'roles', detail: 'string[]', description: 'Database roles granted to the HDI container technical user.' },
  { name: 'schema_roles', detail: 'object[]', description: 'Schema-scoped HDI role names (`names`).' },
];

const HDBGRANTS_ROOT_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'object_owner', detail: 'object', description: 'Privileges granted to the HDI container `#OO` object owner (with optional `WITH GRANT OPTION`).' },
  { name: 'application_user', detail: 'object', description: 'Privileges granted to the runtime `#RT` application user (keep least-privilege; avoid `privileges_with_grant_option`; HANA-SEC-042).' },
];

const PRIVILEGE_ITEM_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'reference', detail: 'string', description: 'Target catalog schema, table, view, or procedure identifier.' },
  { name: 'type', detail: 'string', description: 'Optional catalog object type (`TABLE`, `VIEW`, `PROCEDURE`, ...).' },
  {
    name: 'privileges',
    detail: 'string[]',
    description: 'Database privileges granted without grant option.',
    defaultSnippet: '["SELECT"]',
    enumValues: PRIVILEGE_ENUM_VALUES,
  },
  {
    name: 'privileges_with_grant_option',
    detail: 'string[]',
    description: 'Database privileges granted `WITH GRANT OPTION` (avoid on `application_user`; HANA-SEC-030/042).',
    defaultSnippet: '["SELECT"]',
    enumValues: PRIVILEGE_ENUM_VALUES,
  },
  { name: 'include_filter', detail: 'object[]', description: 'Wildcard filters constraining which objects receive privileges.' },
];

const HDBROLE_JSON_ROOT_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'role', detail: 'object', description: 'Top-level HDI JSON role definition object.' },
];

const HDBROLE_JSON_BODY_FIELDS: readonly ArtifactFieldSpec[] = [
  { name: 'name', detail: 'string', description: 'Fully qualified HDI role name (e.g. `"my.ns::ReaderRole"`).' },
  { name: 'schema_privileges', detail: 'object[]', description: 'Privileges granted across the container runtime schema.' },
  { name: 'object_privileges', detail: 'object[]', description: 'Privileges granted on specific tables, views, procedures, or calculation views.' },
  { name: 'schema_analytic_privileges', detail: 'object[]', description: 'Analytic privileges attached to this role.' },
  { name: 'global_object_privileges', detail: 'object[]', description: 'Catalog object privileges outside the HDI container schema.' },
  { name: 'schema_roles', detail: 'object[]', description: 'Contained sub-roles in this HDI schema (`names`).' },
  { name: 'system_privileges', detail: 'string[]', description: 'System-level administrative privileges (flagged by HANA-SEC-032 if overly broad).' },
  { name: 'application_privileges', detail: 'string[]', description: 'XS application privilege names.' },
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
  { name: 'description', detail: 'string', description: 'Human-readable HTTP destination description ([XSC]).', defaultSnippet: '"$1";' },
  { name: 'host', detail: 'string', description: 'Target HTTP(S) hostname.', defaultSnippet: '"$1";' },
  { name: 'port', detail: 'number', description: 'Target TCP port (`443` for HTTPS, `80` for HTTP).', defaultSnippet: '443;' },
  { name: 'pathPrefix', detail: 'string', description: 'Base URL path prefix prepended to outbound requests.', defaultSnippet: '"/";' },
  { name: 'useProxy', detail: 'boolean', description: 'Routes outbound calls through `proxyHost`:`proxyPort`.', defaultSnippet: 'false;' },
  { name: 'proxyHost', detail: 'string', description: 'Outbound HTTP proxy host.' },
  { name: 'proxyPort', detail: 'number', description: 'Outbound HTTP proxy port.' },
  {
    name: 'authType',
    detail: 'string',
    description: 'Outbound authentication method.',
    defaultSnippet: 'none;',
    enumValues: [
      { value: 'none', description: 'No outbound authentication.' },
      { value: 'basic', description: 'HTTP Basic authentication using XS destination credentials.' },
      { value: 'clientCertificate', description: 'Mutual TLS X.509 client certificate.' },
      { value: 'samlAssertion', description: 'SAML 2.0 assertion propagation.' },
      { value: 'logonTicket', description: 'SAP Logon Ticket authentication.' },
    ],
  },
  { name: 'useSSL', detail: 'boolean', description: 'Requires TLS/HTTPS transport.', defaultSnippet: 'true;' },
  { name: 'sslHostCheck', detail: 'boolean', description: 'Verifies server TLS certificate hostname.', defaultSnippet: 'true;' },
  { name: 'sslAuth', detail: 'string', description: 'SSL authentication trust mode (`client`, `anonymous`).' },
  { name: 'timeout', detail: 'number', description: 'Outbound request timeout in milliseconds (-1 for unlimited).', defaultSnippet: '5000;' },
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
      ctx.parentContainerKey === 'schema_privileges' ||
      ctx.parentContainerKey === 'object_privileges' ||
      ctx.parentContainerKey === 'global_object_privileges'
    ) {
      return PRIVILEGE_ITEM_FIELDS;
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
      ctx.parentContainerKey === 'schema_analytic_privileges'
    ) {
      return PRIVILEGE_ITEM_FIELDS;
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
      return [...HDBGRANTS_ROOT_FIELDS, ...GRANTOR_OWNER_FIELDS, ...PRIVILEGE_ITEM_FIELDS];
    case 'hdbrole':
      return [...HDBROLE_JSON_ROOT_FIELDS, ...HDBROLE_JSON_BODY_FIELDS, ...PRIVILEGE_ITEM_FIELDS];
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
