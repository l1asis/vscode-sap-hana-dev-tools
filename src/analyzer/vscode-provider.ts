import * as vscode from 'vscode';
import { ANALYZER_LANGUAGES, analyzeDocument } from './dispatch';
import { convertArtifactDirection } from './migrator';
import {
  DEFAULT_ANALYZER_OPTIONS,
  type AnalyzerDiagnostic,
  type AnalyzerOptions,
  type DiagnosticSeverityLevel,
  type DiagnosticTagKind,
  type TargetPlatform,
} from './types';

const DIAGNOSTIC_SOURCE = 'SAP HANA';

function readAnalyzerOptions(): { enabled: boolean; options: AnalyzerOptions } {
  const cfg = vscode.workspace.getConfiguration('hanasql').get<Record<string, unknown>>('analyze') ?? {};
  const enabled = cfg.enable !== false;
  const rawPlatform = cfg.targetPlatform;
  const targetPlatform: TargetPlatform =
    rawPlatform === 'xsc' || rawPlatform === 'hdi' || rawPlatform === 'cloud' || rawPlatform === 'auto'
      ? rawPlatform
      : DEFAULT_ANALYZER_OPTIONS.targetPlatform;

  return {
    enabled,
    options: {
      security: cfg.security !== false,
      performance: cfg.performance !== false,
      migration: cfg.migration !== false,
      calculationView: cfg.calculationView !== false,
      syntax: cfg.syntax !== false,
      targetPlatform,
    },
  };
}

function mapSeverity(sev: DiagnosticSeverityLevel): vscode.DiagnosticSeverity {
  switch (sev) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'information':
      return vscode.DiagnosticSeverity.Information;
    case 'hint':
      return vscode.DiagnosticSeverity.Hint;
  }
}

function mapTags(tags?: readonly DiagnosticTagKind[]): vscode.DiagnosticTag[] | undefined {
  if (!tags || tags.length === 0) return undefined;
  return tags.map((t) =>
    t === 'deprecated' ? vscode.DiagnosticTag.Deprecated : vscode.DiagnosticTag.Unnecessary
  );
}

/**
 * Registers the Phase 3 offline diagnostic engine, CodeAction QuickFix provider,
 * and interactive XSC <-> HDI migration commands.
 */
export function registerAnalyzerFeatures(): vscode.Disposable[] {
  const languageSet = new Set(ANALYZER_LANGUAGES);
  const collection = vscode.languages.createDiagnosticCollection('hanasql');
  const resultsByUri = new Map<string, AnalyzerDiagnostic[]>();
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const refreshDocument = (doc: vscode.TextDocument): void => {
    const key = doc.uri.toString();
    if (!languageSet.has(doc.languageId) || doc.uri.scheme === 'hanasql-xsjs-format') {
      collection.delete(doc.uri);
      resultsByUri.delete(key);
      return;
    }

    const { enabled, options } = readAnalyzerOptions();
    if (!enabled) {
      collection.delete(doc.uri);
      resultsByUri.delete(key);
      return;
    }

    const analyzerDiagnostics = analyzeDocument({
      text: doc.getText(),
      languageId: doc.languageId,
      filePath: doc.uri.fsPath,
      options,
    });
    resultsByUri.set(key, analyzerDiagnostics);

    const vsDiagnostics = analyzerDiagnostics.map((d) => {
      const range = new vscode.Range(doc.positionAt(d.start), doc.positionAt(d.end));
      const diag = new vscode.Diagnostic(range, d.message, mapSeverity(d.severity));
      diag.source = DIAGNOSTIC_SOURCE;
      diag.code = d.sapCode ? `${d.ruleId} (${d.sapCode})` : d.ruleId;
      const mappedTags = mapTags(d.tags);
      if (mappedTags) diag.tags = mappedTags;
      return diag;
    });
    collection.set(doc.uri, vsDiagnostics);
  };

  const scheduleRefresh = (doc: vscode.TextDocument): void => {
    const key = doc.uri.toString();
    const prev = pendingTimers.get(key);
    if (prev) clearTimeout(prev);
    pendingTimers.set(
      key,
      setTimeout(() => {
        pendingTimers.delete(key);
        refreshDocument(doc);
      }, 200)
    );
  };

  const refreshAllOpen = (): void => {
    for (const doc of vscode.workspace.textDocuments) {
      refreshDocument(doc);
    }
  };

  const codeActionProvider: vscode.CodeActionProvider = {
    provideCodeActions(document, range, context) {
      const stored = resultsByUri.get(document.uri.toString());
      if (!stored || stored.length === 0) return undefined;

      const reqStart = document.offsetAt(range.start);
      const reqEnd = document.offsetAt(range.end);
      const actions: vscode.CodeAction[] = [];

      for (const diag of stored) {
        if (diag.fixes.length === 0) continue;
        // Include if diagnostic overlaps requested selection/cursor range
        if (diag.end < reqStart || diag.start > reqEnd) continue;

        const diagRange = new vscode.Range(document.positionAt(diag.start), document.positionAt(diag.end));
        const diagCode = diag.sapCode ? `${diag.ruleId} (${diag.sapCode})` : diag.ruleId;
        const matchingVsDiags = context.diagnostics.filter(
          (vd) => vd.code === diagCode && vd.range.isEqual(diagRange)
        );
        for (const fix of diag.fixes) {
          const kind =
            fix.kind === 'refactor'
              ? vscode.CodeActionKind.RefactorRewrite
              : vscode.CodeActionKind.QuickFix;
          const action = new vscode.CodeAction(fix.title, kind);
          if (fix.isPreferred) action.isPreferred = true;

          const edit = new vscode.WorkspaceEdit();
          for (const span of fix.edits) {
            edit.replace(
              document.uri,
              new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
              span.newText
            );
          }
          action.edit = edit;
          action.diagnostics =
            matchingVsDiags.length > 0
              ? matchingVsDiags
              : [new vscode.Diagnostic(diagRange, diag.message, mapSeverity(diag.severity))];
          actions.push(action);
        }
      }

      return actions;
    },
  };

  const selector: vscode.DocumentFilter[] = ANALYZER_LANGUAGES.map((language) => ({ language }));

  refreshAllOpen();

  return [
    collection,
    vscode.languages.registerCodeActionsProvider(selector, codeActionProvider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite],
    }),
    vscode.workspace.onDidOpenTextDocument(refreshDocument),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleRefresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const timer = pendingTimers.get(key);
      if (timer) clearTimeout(timer);
      pendingTimers.delete(key);
      resultsByUri.delete(key);
      collection.delete(doc.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('hanasql.analyze')) {
        refreshAllOpen();
      }
    }),
  ];
}

/**
 * Interactive editor command converting the active artifact between XSC and XSA/HDI syntax.
 */
export async function runMigrationCommand(direction: 'toHdi' | 'toXsc'): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open a SAP HANA artifact file first to convert it.');
    return;
  }

  const doc = editor.document;
  const converted = convertArtifactDirection(doc.getText(), doc.languageId, direction, doc.uri.fsPath);
  if (!converted) {
    void vscode.window.showInformationMessage(
      direction === 'toHdi'
        ? `No XSC -> HDI conversion is needed or supported for '${doc.languageId}' in its current format.`
        : `No HDI -> XSC conversion is supported for '${doc.languageId}' in its current format.`
    );
    return;
  }

  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Replace active editor content', action: 'replace' as const },
      { label: 'Open converted output in new editor tab', action: 'preview' as const },
    ],
    {
      placeHolder: converted.note
        ? `${converted.note} — choose how to apply converted output`
        : 'Choose how to apply converted artifact output',
    }
  );
  if (!choice) return;

  if (choice.action === 'replace') {
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    await editor.edit((eb) => eb.replace(fullRange, converted.content));
    return;
  }

  const targetDoc = await vscode.workspace.openTextDocument({
    content: converted.content,
    language: doc.languageId === 'hdbdd' && direction === 'toHdi' ? 'hdbcds' : doc.languageId,
  });
  await vscode.window.showTextDocument(targetDoc, { viewColumn: vscode.ViewColumn.Beside });
}
