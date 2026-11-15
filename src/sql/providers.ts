import * as vscode from 'vscode';
import { SQL_LANGUAGES } from '../formatter/dispatch';
import { type CaseMode } from '../formatter/options';
import {
  getArtifactCompletions,
  getArtifactHover,
  isDesignTimeConfigOrKvMode,
} from './artifact-intellisense';
import {
  getSqlCompletions,
  getSqlHover,
  getSqlSignatureHelp,
  type SqlCompletionCandidate,
  type SqlCompletionKind,
  type SqlIntelliSenseOptions,
  type TargetPlatform,
} from './intellisense-core';

const SQL_LANGUAGE_SET = new Set<string>([...SQL_LANGUAGES, 'sql']);
const ARTIFACT_LANGUAGE_IDS: readonly string[] = [
  'xsaccess',
  'hdiconfig',
  'hdbgrants',
  'hdbrevokes',
  'hdbrole',
  'hdbschema',
  'hdbti',
  'xshttpdest',
];

export const ALL_INTELLISENSE_LANGUAGES: readonly string[] = [
  ...new Set([...SQL_LANGUAGE_SET, ...ARTIFACT_LANGUAGE_IDS]),
];

function isSqlIntelliSenseEnabled(): boolean {
  return vscode.workspace.getConfiguration('hanasql').get<boolean>('sql.enableIntelliSense', true);
}

function readSqlOptions(): SqlIntelliSenseOptions {
  const cfg = vscode.workspace.getConfiguration('hanasql');
  return {
    keywordCase: cfg.get<CaseMode>('format.keywordCase', 'upper'),
    functionCase: cfg.get<CaseMode>('format.functionCase', 'upper'),
    dataTypeCase: cfg.get<CaseMode>('format.dataTypeCase', 'upper'),
    targetPlatform: cfg.get<TargetPlatform>('analyze.targetPlatform', 'auto'),
  };
}

function toVsCodeCompletionKind(kind: SqlCompletionKind): vscode.CompletionItemKind {
  switch (kind) {
    case 'keyword':
      return vscode.CompletionItemKind.Keyword;
    case 'type':
      return vscode.CompletionItemKind.TypeParameter;
    case 'constant':
      return vscode.CompletionItemKind.Constant;
    case 'function':
      return vscode.CompletionItemKind.Function;
    case 'variable':
      return vscode.CompletionItemKind.Variable;
    case 'module':
      return vscode.CompletionItemKind.Module;
  }
}

function toCompletionItem(
  document: vscode.TextDocument,
  candidate: SqlCompletionCandidate
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(candidate.label, toVsCodeCompletionKind(candidate.kind));
  item.detail = candidate.detail;
  item.sortText = `${candidate.sortPrefix}_${candidate.label}`;
  item.insertText = candidate.isSnippet
    ? new vscode.SnippetString(candidate.insertText)
    : candidate.insertText;
  if (candidate.filterText) {
    item.filterText = candidate.filterText;
  }
  if (candidate.documentation) {
    item.documentation = new vscode.MarkdownString(candidate.documentation);
  }
  if (candidate.deprecated) {
    item.tags = [vscode.CompletionItemTag.Deprecated];
  }
  if (candidate.replaceStart !== undefined && candidate.replaceEnd !== undefined) {
    item.range = new vscode.Range(
      document.positionAt(candidate.replaceStart),
      document.positionAt(candidate.replaceEnd)
    );
  }
  return item;
}

/**
 * Registers zero-config Completion, Hover, and SignatureHelp providers for
 * SAP HANA SQL, SQLScript, HDI DDL, Design-Time JSON config, and Classic KV artifacts.
 */
export function registerSqlIntelliSense(): vscode.Disposable[] {
  const allSelector: vscode.DocumentSelector = ALL_INTELLISENSE_LANGUAGES.map((language) => ({
    language,
  }));
  const signatureSelector: vscode.DocumentSelector = [...SQL_LANGUAGE_SET].map((language) => ({
    language,
  }));

  const completionProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (!isSqlIntelliSenseEnabled()) return undefined;
      const text = document.getText();
      const offset = document.offsetAt(position);
      const candidates = isDesignTimeConfigOrKvMode(document.languageId, text)
        ? getArtifactCompletions(document.languageId, text, offset)
        : SQL_LANGUAGE_SET.has(document.languageId)
          ? getSqlCompletions(text, offset, readSqlOptions())
          : [];
      if (candidates.length === 0) return undefined;
      return candidates.map((c) => toCompletionItem(document, c));
    },
  };

  const hoverProvider: vscode.HoverProvider = {
    provideHover(document, position) {
      if (!isSqlIntelliSenseEnabled()) return undefined;
      const text = document.getText();
      const offset = document.offsetAt(position);
      const hover = isDesignTimeConfigOrKvMode(document.languageId, text)
        ? getArtifactHover(document.languageId, text, offset)
        : SQL_LANGUAGE_SET.has(document.languageId)
          ? getSqlHover(text, offset, readSqlOptions())
          : null;
      if (!hover) return undefined;
      const range = new vscode.Range(
        document.positionAt(hover.start),
        document.positionAt(hover.end)
      );
      return new vscode.Hover(new vscode.MarkdownString(hover.markdown), range);
    },
  };

  const signatureProvider: vscode.SignatureHelpProvider = {
    provideSignatureHelp(document, position) {
      if (!isSqlIntelliSenseEnabled()) return undefined;
      const text = document.getText();
      if (isDesignTimeConfigOrKvMode(document.languageId, text)) return undefined;
      const offset = document.offsetAt(position);
      const sigHelp = getSqlSignatureHelp(text, offset, readSqlOptions());
      if (!sigHelp || sigHelp.signatures.length === 0) return undefined;

      const help = new vscode.SignatureHelp();
      help.activeSignature = sigHelp.activeSignature;
      help.activeParameter = sigHelp.activeParameter;
      help.signatures = sigHelp.signatures.map((s) => {
        const info = new vscode.SignatureInformation(
          s.label,
          s.documentation ? new vscode.MarkdownString(s.documentation) : undefined
        );
        info.parameters = s.parameters.map(
          (p) =>
            new vscode.ParameterInformation(
              p.label,
              p.documentation ? new vscode.MarkdownString(p.documentation) : undefined
            )
        );
        return info;
      });
      return help;
    },
  };

  return [
    vscode.languages.registerCompletionItemProvider(allSelector, completionProvider, '.', ':', '"', '='),
    vscode.languages.registerHoverProvider(allSelector, hoverProvider),
    vscode.languages.registerSignatureHelpProvider(signatureSelector, signatureProvider, '(', ','),
  ];
}
