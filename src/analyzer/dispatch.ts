import { isKeyValueArtifact } from '../formatter/detect';
import { analyzeCalculationView } from './calculationview';
import { analyzeMigration } from './migrator';
import { analyzeRolesAndGrants, analyzeXsodata } from './roles-grants';
import { analyzeSqlScript } from './sqlscript';
import { type AnalyzerContext, type AnalyzerDiagnostic } from './types';
import { analyzeXsaccess } from './xsaccess';
import { analyzeXsjs } from './xsjs';

const SQLSCRIPT_ANALYZER_LANGUAGES = new Set([
  'hanasql',
  'sql',
  'hdbprocedure',
  'hdbfunction',
  'hdbtablefunction',
  'hdblibrary',
  'hdbtrigger',
]);

export const ANALYZER_LANGUAGES: readonly string[] = [
  'hanasql',
  'sql',
  'hdbprocedure',
  'hdbfunction',
  'hdbtablefunction',
  'hdbtrigger',
  'hdblibrary',
  'hdbview',
  'hdbtable',
  'hdbstructure',
  'hdbsequence',
  'hdbschema',
  'hdbti',
  'hdbdd',
  'hdbcds',
  'hdbrole',
  'hdbgrants',
  'hdbrevokes',
  'xsjs',
  'xsjslib',
  'xsaccess',
  'xsodata',
  'calculationview',
  'hdbcalculationview',
];

/**
 * Runs all relevant Phase 3 static analyzers (Security, Performance, Calculation View, Migration)
 * on a document in pure TypeScript without any VS Code runtime dependency.
 */
export function analyzeDocument(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { languageId, text } = ctx;

  if (SQLSCRIPT_ANALYZER_LANGUAGES.has(languageId)) {
    return analyzeSqlScript(ctx);
  }

  if (languageId === 'hdbview') {
    if (isKeyValueArtifact(text)) {
      return analyzeMigration(ctx);
    }
    return analyzeSqlScript(ctx);
  }

  if (
    languageId === 'hdbtable' ||
    languageId === 'hdbsequence' ||
    languageId === 'hdbstructure' ||
    languageId === 'hdbschema' ||
    languageId === 'hdbti' ||
    languageId === 'hdbdd' ||
    languageId === 'hdbcds'
  ) {
    return analyzeMigration(ctx);
  }

  if (languageId === 'hdbrole') {
    return [...analyzeRolesAndGrants(ctx), ...analyzeMigration(ctx)];
  }

  if (languageId === 'hdbgrants' || languageId === 'hdbrevokes') {
    return analyzeRolesAndGrants(ctx);
  }

  if (languageId === 'xsjs' || languageId === 'xsjslib') {
    return analyzeXsjs(ctx);
  }

  if (languageId === 'xsaccess') {
    return analyzeXsaccess(ctx);
  }

  if (languageId === 'xsodata') {
    return analyzeXsodata(ctx);
  }

  if (languageId === 'calculationview' || languageId === 'hdbcalculationview') {
    return analyzeCalculationView(ctx);
  }

  return [];
}
