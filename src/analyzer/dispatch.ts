import { isKeyValueArtifact } from '../formatter/detect';
import {
  DEDICATED_ARTIFACT_LANGUAGES,
  SQL_LANGUAGES,
  XSJS_LANGUAGES,
} from '../formatter/dispatch';
import { analyzeCalculationView } from './calculationview';
import { analyzeMigration } from './migrator';
import { analyzeRolesAndGrants, analyzeXsodata } from './roles-grants';
import { analyzeSqlScript } from './sqlscript';
import { analyzeSyntax } from './syntax';
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

export const ANALYZER_LANGUAGES: readonly string[] = Array.from(
  new Set<string>([
    'sql',
    ...SQL_LANGUAGES,
    ...DEDICATED_ARTIFACT_LANGUAGES,
    ...XSJS_LANGUAGES,
    'calculationview',
    'hdbcalculationview',
  ])
);

function analyzeSemantics(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
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

  if (languageId === 'xsaccess') {
    return analyzeXsaccess(ctx);
  }

  if (languageId === 'xsodata') {
    return analyzeXsodata(ctx);
  }

  return [];
}

/**
 * Runs all relevant Phase 3 static analyzers (Syntax, Security, Performance, Calculation View, Migration)
 * on a document in pure TypeScript without any VS Code runtime dependency.
 */
export function analyzeDocument(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { languageId } = ctx;

  if (languageId === 'xsjs' || languageId === 'xsjslib') {
    return analyzeXsjs(ctx);
  }

  if (languageId === 'calculationview' || languageId === 'hdbcalculationview') {
    return analyzeCalculationView(ctx);
  }

  const semantic = analyzeSemantics(ctx);
  const syntax = analyzeSyntax(ctx);
  return semantic.length === 0 ? syntax : syntax.length === 0 ? semantic : [...syntax, ...semantic];
}
