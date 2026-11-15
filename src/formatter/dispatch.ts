import { formatClassicKv } from './classic-kv';
import { formatCds } from './cds';
import { isKeyValueArtifact } from './detect';
import { format, FormatExtraOptions } from './formatter';
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

/** Dedicated non-SQL design-time artifact languages supported by AST formatters. */
export const DEDICATED_ARTIFACT_LANGUAGES: readonly string[] = [
  'hdbschema',
  'hdbti',
  'hdbdd',
  'hdbcds',
  'xsodata',
];

/** All VS Code language IDs registered with the DocumentFormattingEditProvider. */
export const ARTIFACT_FORMATTER_LANGUAGES: readonly string[] = [
  ...SQL_LANGUAGES,
  ...DEDICATED_ARTIFACT_LANGUAGES,
];

const DUAL_KV_DDL_LANGUAGES = new Set(['hdbtable', 'hdbstructure', 'hdbview', 'hdbsequence']);
const ALWAYS_KV_LANGUAGES = new Set(['hdbschema', 'hdbti']);
const CDS_LANGUAGES = new Set(['hdbdd', 'hdbcds']);

/**
 * Route document formatting to the appropriate dedicated AST/layout formatter
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
  return format(text, userOptions, editor, extra);
}

/** Whether partial range formatting applies cleanly to the given language & content. */
export function supportsRangeFormatting(languageId: string, text: string): boolean {
  if (ALWAYS_KV_LANGUAGES.has(languageId) || CDS_LANGUAGES.has(languageId) || languageId === 'xsodata') {
    return false;
  }
  if (DUAL_KV_DDL_LANGUAGES.has(languageId) && isKeyValueArtifact(text)) {
    return false;
  }
  return true;
}
