import * as vscode from 'vscode';
import {
  ARTIFACT_FORMATTER_LANGUAGES,
  SQL_LANGUAGES,
  XSJS_LANGUAGES,
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
import {
  applyOffsetEdits,
  extractJsPragmaRegions,
  restoreJsPragmaRegions,
} from './formatter/xsjs';

const XSJS_SCHEME = 'hanasql-xsjs-format';
const XSJS_DELEGATE_URI = vscode.Uri.parse(`${XSJS_SCHEME}:/delegate.js`);

let output: vscode.OutputChannel | undefined;

class XsjsVirtualContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private content = '';

  setContent(next: string): void {
    this.content = next;
    this.emitter.fire(XSJS_DELEGATE_URI);
  }

  provideTextDocumentContent(): string {
    return this.content;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

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

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err: unknown) {
    const detail = err instanceof Error && err.stack ? err.stack : String(err);
    output?.appendLine(`[format] ${detail}`);
    vscode.window.showErrorMessage('SAP HANA SQL: formatting failed (see output channel "SAP HANA SQL").');
    return fallback;
  }
}

async function safeAsync(fn: () => Promise<vscode.TextEdit[]>): Promise<vscode.TextEdit[]> {
  try {
    return await fn();
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
    }, []);
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
    }, []);
  },
};

function createXsjsProvider(
  virtualContent: XsjsVirtualContentProvider
): vscode.DocumentFormattingEditProvider & vscode.DocumentRangeFormattingEditProvider {
  let queue: Promise<void> = Promise.resolve();

  const runSerialized = async (
    task: () => Promise<vscode.TextEdit[]>
  ): Promise<vscode.TextEdit[]> => {
    const prev = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await task();
    } finally {
      release();
    }
  };

  return {
    provideDocumentFormattingEdits(
      document: vscode.TextDocument,
      options: vscode.FormattingOptions
    ): Promise<vscode.TextEdit[]> {
      const raw = readSettings(document);
      if (raw.enable === false) return Promise.resolve([]);
      return runSerialized(() =>
        safeAsync(async () => {
          const text = document.getText();
          const { sanitized, regions } = extractJsPragmaRegions(text);
          virtualContent.setContent(sanitized);
          const virtualDoc = await vscode.workspace.openTextDocument(XSJS_DELEGATE_URI);
          const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatDocumentProvider',
            virtualDoc.uri,
            options
          );
          if (!edits || edits.length === 0) return [];
          const formattedSanitized = applyOffsetEdits(
            sanitized,
            edits.map((e) => ({
              startOffset: virtualDoc.offsetAt(e.range.start),
              endOffset: virtualDoc.offsetAt(e.range.end),
              newText: e.newText,
            }))
          );
          const finalText = restoreJsPragmaRegions(formattedSanitized, regions);
          return finalText === text ? [] : [vscode.TextEdit.replace(fullRange(document), finalText)];
        })
      );
    },

    provideDocumentRangeFormattingEdits(
      document: vscode.TextDocument,
      range: vscode.Range,
      options: vscode.FormattingOptions
    ): Promise<vscode.TextEdit[]> {
      const raw = readSettings(document);
      if (raw.enable === false) return Promise.resolve([]);
      return runSerialized(() =>
        safeAsync(async () => {
          const text = document.getText();
          const { regions } = extractJsPragmaRegions(text);
          if (regions.size > 0) {
            // Avoid corrupting off-pragma regions during partial JS range edits
            return [];
          }
          virtualContent.setContent(text);
          const virtualDoc = await vscode.workspace.openTextDocument(XSJS_DELEGATE_URI);
          const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatRangeProvider',
            virtualDoc.uri,
            range,
            options
          );
          return edits ?? [];
        })
      );
    },
  };
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('SAP HANA SQL');
  const xsjsVirtual = new XsjsVirtualContentProvider();
  const xsjsProvider = createXsjsProvider(xsjsVirtual);

  const documentSelector: vscode.DocumentFilter[] = ARTIFACT_FORMATTER_LANGUAGES.map((language) => ({ language }));
  const rangeSelector: vscode.DocumentFilter[] = SQL_LANGUAGES.map((language) => ({ language }));
  const xsjsSelector: vscode.DocumentFilter[] = XSJS_LANGUAGES.map((language) => ({ language }));

  context.subscriptions.push(
    output,
    xsjsVirtual,
    vscode.workspace.registerTextDocumentContentProvider(XSJS_SCHEME, xsjsVirtual),
    vscode.languages.registerDocumentFormattingEditProvider(documentSelector, provider),
    vscode.languages.registerDocumentRangeFormattingEditProvider(rangeSelector, provider),
    vscode.languages.registerDocumentFormattingEditProvider(xsjsSelector, xsjsProvider),
    vscode.languages.registerDocumentRangeFormattingEditProvider(xsjsSelector, xsjsProvider),
    vscode.commands.registerCommand('hanasql.openFormatterSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:l1asis.sap-hana-dev-tools hanasql.format')
    )
  );
}

export function deactivate(): void {}
