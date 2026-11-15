import { formatClassicKv } from './classic-kv';
import { formatCds } from './cds';
import { isKeyValueArtifact } from './detect';
import { format, FormatExtraOptions } from './formatter';
import { formatClassicHdbrole, isClassicHdbrole } from './hdbrole';
import { formatJsonArtifact } from './json';
import { formatMigrationTable } from './migration-table';
import { EditorOptions, PartialFormatterOptions, ResolvedFormatterOptions } from './options';
import { formatXsodata } from './xsodata';

/** Languages backed by SQL/SQLScript formatting (plus dual-syntax XSC KV / HDI DDL files). */
export const SQL_LANGUAGES: readonly string[] = [
  'hanasql',
  'hdbprocedure',
  'hdbfunction',
  'hdbtablefunction',
  'hdbtrigger',
  'hdbindex',
  'hdbfulltextindex',
  'hdbconstraint',
  'hdbvirtualtable',
  'hdbtabletype',
  'hdbprojectionview',
  'hdbstructuredprivilege',
  'hdbstructuredfilter',
  'hdbresultcache',
  'hdbstatistics',
  'hdbsystemversioning',
  'hdbschedulerjob',
  'hdbremotetablereplica',
  'hdbcollection',
  'hdbcollectionindex',
  'hdbcollectionadjindex',
  'hdbfabricvirtualtable',
  'hdblibrary',
  'hdbdropcreatetable',
  'hdbapplicationtime',
  'hdbgraphworkspace',
  'hdbvirtualprocedure',
  'hdbvirtualfunction',
  'hdbtable',
  'hdbstructure',
  'hdbview',
  'hdbsequence',
];

/** Pure JSON and tolerant JSONC configuration/grant/synonym design-time languages. */
export const JSON_ARTIFACT_LANGUAGES: readonly string[] = [
  // XS Classic JSON / tolerant JSON
  'xsaccess',
  'xsapp',
  'xsprivileges',
  'xssecurestore',
  'xssqlcc',
  'xsjob',
  'hdbsynonym',
  'xsappsite',
  'xsoauthappconfig',
  'xsoauthclientconfig',
  'xsoauthclientflavor',
  // HDI / XSA / HANA Cloud JSON config
  'hdbgrants',
  'hdbrevokes',
  'hdbroleconfig',
  'hdbsynonymconfig',
  'hdbpublicsynonym',
  'hdbvirtualtableconfig',
  'hdblogicalschemaconfig',
  'hdbprojectionviewconfig',
  'hdbfabricvirtualtableconfig',
  'hdbtabledata',
  'hdbeshconfig',
  'hdiconfig',
  'hdinamespace',
  'hdbvirtualpackage',
  'hdbvirtualpackagehadoop',
  'hdbvirtualpackagesparksql',
  'hdbmrjob',
];

/** Dedicated non-SQL design-time artifact languages handled synchronously by AST formatters. */
export const DEDICATED_ARTIFACT_LANGUAGES: readonly string[] = [
  'hdbschema',
  'hdbti',
  'hdbtid',
  'hdbtim',
  'xshttpdest',
  'hdbdd',
  'hdbcds',
  'xsodata',
  'hdbrole',
  'hdbmigrationtable',
  ...JSON_ARTIFACT_LANGUAGES,
];

/** XS JavaScript languages formatted via VS Code's built-in JS/TS formatter delegation. */
export const XSJS_LANGUAGES: readonly string[] = ['xsjs', 'xsjslib'];

/** Synchronous AST-formatted language IDs registered with the main formatter provider. */
export const ARTIFACT_FORMATTER_LANGUAGES: readonly string[] = [
  ...SQL_LANGUAGES,
  ...DEDICATED_ARTIFACT_LANGUAGES,
];

/** Every VS Code language ID bound to `l1asis.sap-hana-dev-tools` default formatting. */
export const ALL_FORMATTER_LANGUAGES: readonly string[] = [
  ...ARTIFACT_FORMATTER_LANGUAGES,
  ...XSJS_LANGUAGES,
];

const DUAL_KV_DDL_LANGUAGES = new Set(['hdbtable', 'hdbstructure', 'hdbview', 'hdbsequence']);
const ALWAYS_KV_LANGUAGES = new Set(['hdbschema', 'hdbti', 'hdbtid', 'hdbtim', 'xshttpdest']);
const CDS_LANGUAGES = new Set(['hdbdd', 'hdbcds']);
const JSON_LANGUAGES = new Set(JSON_ARTIFACT_LANGUAGES);

/**
 * Route synchronous document formatting to the appropriate dedicated AST/layout formatter
 * based on VS Code language ID and (for dual-mode XSC/HDI extensions) content sniffing.
 */
export function formatDocument(
  languageId: string,
  text: string,
  userOptions?: PartialFormatterOptions | ResolvedFormatterOptions,
  editor?: EditorOptions,
  extra?: FormatExtraOptions
): string {
  if (ALWAYS_KV_LANGUAGES.has(languageId)) {
    return formatClassicKv(text, userOptions, editor);
  }
  if (DUAL_KV_DDL_LANGUAGES.has(languageId)) {
    return isKeyValueArtifact(text)
      ? formatClassicKv(text, userOptions, editor)
      : format(text, userOptions, editor, extra);
  }
  if (CDS_LANGUAGES.has(languageId)) {
    return formatCds(text, userOptions, editor);
  }
  if (languageId === 'xsodata') {
    return formatXsodata(text, userOptions, editor);
  }
  if (languageId === 'hdbrole') {
    return isClassicHdbrole(text)
      ? formatClassicHdbrole(text, userOptions, editor)
      : formatJsonArtifact(text, userOptions, editor);
  }
  if (languageId === 'hdbmigrationtable') {
    return formatMigrationTable(text, userOptions, editor);
  }
  if (JSON_LANGUAGES.has(languageId)) {
    return formatJsonArtifact(text, userOptions, editor);
  }
  return format(text, userOptions, editor, extra);
}

/** Whether partial range formatting applies cleanly to the given language & content. */
export function supportsRangeFormatting(languageId: string, text: string): boolean {
  if (
    ALWAYS_KV_LANGUAGES.has(languageId) ||
    CDS_LANGUAGES.has(languageId) ||
    languageId === 'xsodata' ||
    languageId === 'hdbrole' ||
    languageId === 'hdbmigrationtable' ||
    JSON_LANGUAGES.has(languageId)
  ) {
    return false;
  }
  if (DUAL_KV_DDL_LANGUAGES.has(languageId) && isKeyValueArtifact(text)) {
    return false;
  }
  return true;
}
