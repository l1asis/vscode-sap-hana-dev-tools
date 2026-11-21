import { filterSuppressedDiagnostics, type AnalyzerContext, type AnalyzerDiagnostic } from './types';

/**
 * A design-time suffix that is renamed, replaced or unsupported in HDI (`HANA-MIG-013`).
 * Spec: `docs/specs/diagnostics/migration-xsc-to-hdi.md` (`HANA-MIG-013`) and the status column of
 * `docs/specs/artifacts/artifact-registry.md`, which `test/artifact-registry.test.ts` keeps in sync with this table.
 */
export interface SuffixMigration {
  /** VS Code language the suffix is registered under. */
  readonly languageId: string;
  /** HDI suffix that replaces it, when there is one. */
  readonly target?: string;
  /** `true` when a plain file rename to `target` is enough (the content stays valid). */
  readonly rename: boolean;
  /** Message text after the quoted suffix. */
  readonly reason: string;
}

/** Keyed by lower-case suffix with the leading dot. */
export const SUFFIX_MIGRATIONS: Readonly<Record<string, SuffixMigration>> = {
  // Renamed, same content [XSC] -> [HDI]
  '.calculationview': {
    languageId: 'calculationview',
    target: '.hdbcalculationview',
    rename: true,
    reason: "is the XS Classic suffix of calculation views. HDI uses '.hdbcalculationview' with the same syntax.",
  },
  '.searchruleset': {
    languageId: 'hdbsearchruleset',
    target: '.hdbsearchruleset',
    rename: true,
    reason: "is the XS Classic suffix of search rule sets. HDI uses '.hdbsearchruleset' with the same syntax.",
  },
  '.textminingconfig': {
    languageId: 'hdbtextminingconfig',
    target: '.hdbtextminingconfig',
    rename: true,
    reason: "is the XS Classic suffix of text mining configurations. HDI uses '.hdbtextminingconfig' with the same syntax.",
  },
  '.hdbsynonymgrantor': {
    languageId: 'hdbgrants',
    target: '.hdbgrants',
    rename: true,
    reason: "is a backwards-compatible alias of '.hdbgrants'. The HDI Deployer still reads it, but '.hdbgrants' is the current suffix.",
  },
  '.hdbscalarfunction': {
    languageId: 'hdbscalarfunction',
    target: '.hdbfunction',
    rename: true,
    reason: "is not supported in HDI. Scalar functions are '.hdbfunction' artifacts.",
  },
  '.hdbtablefunction': {
    languageId: 'hdbtablefunction',
    target: '.hdbfunction',
    rename: true,
    reason: "is not supported in HDI. Table functions are '.hdbfunction' artifacts.",
  },
  // Replaced, the content must change [XSC] -> [HDI]
  '.analyticprivilege': {
    languageId: 'analyticprivilege',
    target: '.hdbanalyticprivilege',
    rename: false,
    reason: "is renamed to '.hdbanalyticprivilege' in HDI, and classical XML analytic privileges must first become SQL analytic privileges.",
  },
  '.attributeview': {
    languageId: 'attributeview',
    target: '.hdbcalculationview',
    rename: false,
    reason: "is not supported in HDI. Convert the attribute view to a graphical calculation view (dataCategory DIMENSION).",
  },
  '.analyticview': {
    languageId: 'analyticview',
    target: '.hdbcalculationview',
    rename: false,
    reason: "is not supported in HDI. Convert the analytic view to a graphical calculation view (dataCategory CUBE).",
  },
  '.procedure': {
    languageId: 'xscprocedure',
    target: '.hdbprocedure',
    rename: false,
    reason: "(XML procedure format) is deprecated and not supported in HDI. Rewrite it as a '.hdbprocedure' SQLScript artifact.",
  },
  '.hdbtextbundle': {
    languageId: 'hdbtextbundle',
    rename: false,
    reason: "is not supported in HDI. Texts move to '.properties' files of the XS Advanced translation concept.",
  },
  '.hdbtid': {
    languageId: 'hdbtid',
    target: '.hdbtabledata',
    rename: false,
    reason: "is already deprecated in the XS Classic repository and not supported in HDI. Use '.hdbtabledata'.",
  },
  '.hdbtim': {
    languageId: 'hdbtim',
    target: '.hdbtabledata',
    rename: false,
    reason: "is already deprecated in the XS Classic repository and not supported in HDI. Use '.hdbtabledata'.",
  },
  '.hdbruldec': {
    languageId: 'hdbdecisiontable',
    rename: false,
    reason: 'is not supported in HDI. Convert the decision table to a graphical calculation view or a table function.',
  },
  '.decrule': {
    languageId: 'hdbdecisiontable',
    rename: false,
    reason: 'is not supported in HDI. Convert the decision table to a graphical calculation view or a table function.',
  },
  '.hdbdecisiontable': {
    languageId: 'hdbdecisiontable',
    rename: false,
    reason: 'is not supported in HDI. Convert the decision table to a graphical calculation view or a table function.',
  },
  '.dqconfig': {
    languageId: 'xscxmlmodel',
    target: '.hdbflowgraph',
    rename: false,
    reason: "(data quality) is deprecated and not supported in HDI. Use a '.hdbflowgraph'.",
  },
  '.aflpmml': {
    languageId: 'xscxmlmodel',
    rename: false,
    reason: '(old Application Function Modeler file) is not supported in HDI.',
  },
  '.hdbflowgraphtemplate': {
    languageId: 'xscxmlmodel',
    rename: false,
    reason: '(AFL node-palette template) is not supported in HDI.',
  },
  '.dataflow': {
    languageId: 'xscxmlmodel',
    rename: false,
    reason: '(data provisioning) is not supported in HDI.',
  },
  '.halmscenario': {
    languageId: 'xscxmlmodel',
    rename: false,
    reason: '(HALM scenario) is not supported in HDI.',
  },
  '.hdbremotesource': {
    languageId: 'hdbremotesource',
    rename: false,
    reason:
      "(Hadoop remote source) is not supported in HDI. An administrator creates the remote source; grant the container access with a '.hdbgrants' global_object_privileges entry of type 'REMOTE SOURCE'.",
  },
  // Deprecated HDI plug-in [XSA]
  '.hdbhadoopmrjob': {
    languageId: 'hdbmrjob',
    target: '.hdbvirtualpackagehadoop',
    rename: false,
    reason: "uses the deprecated 'hdbhadoopmrjob' plug-in. Use the 'hdbvirtualpackagehadoop' plug-in instead.",
  },
};

/** Languages whose files can carry `HANA-MIG-013`. */
export const SUFFIX_MIGRATION_LANGUAGES: readonly string[] = [
  ...new Set(Object.values(SUFFIX_MIGRATIONS).map((m) => m.languageId)),
];

/** Lower-case last suffix of a path (`/a/B.SearchRuleSet` -> `.searchruleset`), or `undefined`. */
export function fileSuffix(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const m = /(\.[^./\\]+)$/.exec(filePath);
  return m ? m[1].toLowerCase() : undefined;
}

/**
 * `HANA-MIG-013`: the file suffix is renamed, replaced or unsupported in HDI. Information on the first line, with a
 * file-rename QuickFix when the content stays valid under the new suffix.
 */
export function analyzeSuffixMigration(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { text, filePath, options } = ctx;
  if (options?.migration === false || options?.targetPlatform === 'xsc') return [];
  const suffix = fileSuffix(filePath);
  const entry = suffix ? SUFFIX_MIGRATIONS[suffix] : undefined;
  if (!suffix || !entry) return [];

  const nl = text.indexOf('\n');
  const end = nl === -1 ? text.length : text[nl - 1] === '\r' ? nl - 1 : nl;
  return filterSuppressedDiagnostics(text, [
    {
      ruleId: 'HANA-MIG-013',
      category: 'migration',
      severity: 'information',
      message: `'${suffix}' ${entry.reason}`,
      start: 0,
      end,
      fixes:
        entry.rename && entry.target
          ? [{ title: `Rename to ${entry.target}`, kind: 'quickfix', isPreferred: true, edits: [], rename: { toExtension: entry.target } }]
          : [],
    },
  ]);
}
