import * as vscode from 'vscode';
import {
  ARTIFACT_FORMATTER_LANGUAGES,
  SQL_LANGUAGES,
  formatDocument,
  supportsRangeFormatting,
} from './formatter/dispatch';
import { format } from './formatter/formatter';
import {
  DEFAULTS,
  EditorOptions,
  FormatterOptions,
  PartialFormatterOptions,
  resolveOptions,
} from './formatter/options';

let output: vscode.OutputChannel | undefined;

function readSettings(document: vscode.TextDocument): PartialFormatterOptions {
  const cfg = vscode.workspace.getConfiguration('hanasql.format', document);
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS) as Array<keyof FormatterOptions>) {
    raw[key] = cfg.get(key);
  }
  return raw as PartialFormatterOptions;
}

function editorInfo(document: vscode.TextDocument, options: vscode.FormattingOptions): EditorOptions {
  return {
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
    eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
  };
}

function fullRange(document: vscode.TextDocument): vscode.Range {
  const last = document.lineAt(document.lineCount - 1);
  return new vscode.Range(0, 0, last.lineNumber, last.text.length);
}

function safe(fn: () => vscode.TextEdit[]): vscode.TextEdit[] {
  try {
    return fn();
  } catch (err: unknown) {
    const detail = err instanceof Error && err.stack ? err.stack : String(err);
    output?.appendLine(`[format] ${detail}`);
    vscode.window.showErrorMessage('SAP HANA SQL: formatting failed (see output channel "SAP HANA SQL").');
    return [];
  }
}

const provider: vscode.DocumentFormattingEditProvider & vscode.DocumentRangeFormattingEditProvider = {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions
  ): vscode.TextEdit[] {
    const raw = readSettings(document);
    if (raw.enable === false) return [];
    return safe(() => {
      const text = document.getText();
      const result = formatDocument(document.languageId, text, raw, editorInfo(document, options));
      return result === text ? [] : [vscode.TextEdit.replace(fullRange(document), result)];
    });
  },

  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions
  ): vscode.TextEdit[] {
    const raw = readSettings(document);
    if (raw.enable === false) return [];
    return safe(() => {
      if (!supportsRangeFormatting(document.languageId, document.getText())) return [];
      // work on whole lines
      const endLine =
        range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
      const lineRange = new vscode.Range(range.start.line, 0, endLine, document.lineAt(endLine).text.length);
      const text = document.getText(lineRange);
      const ed = editorInfo(document, options);
      const o = resolveOptions(raw, ed);
      // derive the starting indentation level from the first non-empty line
      const first = document.lineAt(range.start.line).text;
      const leadMatch = /^[ \t]*/.exec(first);
      const lead = leadMatch ? leadMatch[0] : '';
      const cols = [...lead].reduce((n, ch) => n + (ch === '\t' ? o.indentWidth : 1), 0);
      const level = Math.floor(cols / o.indentWidth);
      const result = format(text, o, ed, { fragment: true, initialLevel: level });
      return result === text ? [] : [vscode.TextEdit.replace(lineRange, result)];
    });
  },
};

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('SAP HANA SQL');
  const documentSelector: vscode.DocumentFilter[] = ARTIFACT_FORMATTER_LANGUAGES.map((language) => ({ language }));
  const rangeSelector: vscode.DocumentFilter[] = SQL_LANGUAGES.map((language) => ({ language }));
  context.subscriptions.push(
    output,
    vscode.languages.registerDocumentFormattingEditProvider(documentSelector, provider),
    vscode.languages.registerDocumentRangeFormattingEditProvider(rangeSelector, provider),
    vscode.commands.registerCommand('hanasql.openFormatterSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:l1asis.sap-hana-dev-tools hanasql.format')
    )
  );
}

export function deactivate(): void {}
