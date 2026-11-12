'use strict';

const vscode = require('vscode');
const { format } = require('./formatter/formatter');
const { DEFAULTS, resolveOptions } = require('./formatter/options');
const { isKeyValueArtifact } = require('./formatter/detect');

// Languages whose files can contain SQL. For .hdbtable/.hdbview/.hdbsequence/.hdbstructure the same
// extension is XS Classic `key = value;` syntax in some projects; those files are detected and skipped.
const SQL_LANGUAGES = ['hanasql', 'hdbtable', 'hdbstructure', 'hdbview', 'hdbsequence'];
let output;

function readSettings(document) {
  const cfg = vscode.workspace.getConfiguration('hanasql.format', document);
  const raw = {};
  for (const key of Object.keys(DEFAULTS)) raw[key] = cfg.get(key);
  return raw;
}

function editorInfo(document, options) {
  return {
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
    eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
  };
}

function fullRange(document) {
  const last = document.lineAt(document.lineCount - 1);
  return new vscode.Range(0, 0, last.lineNumber, last.text.length);
}

function safe(fn) {
  try {
    return fn();
  } catch (err) {
    output.appendLine(`[format] ${err && err.stack ? err.stack : err}`);
    vscode.window.showErrorMessage('SAP HANA SQL: formatting failed (see output channel "SAP HANA SQL").');
    return [];
  }
}

const provider = {
  provideDocumentFormattingEdits(document, options) {
    const raw = readSettings(document);
    if (raw.enable === false) return [];
    return safe(() => {
      const text = document.getText();
      if (isKeyValueArtifact(text)) return [];
      const result = format(text, raw, editorInfo(document, options));
      return result === text ? [] : [vscode.TextEdit.replace(fullRange(document), result)];
    });
  },

  provideDocumentRangeFormattingEdits(document, range, options) {
    const raw = readSettings(document);
    if (raw.enable === false) return [];
    return safe(() => {
      if (isKeyValueArtifact(document.getText())) return [];
      // work on whole lines
      const endLine = range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
      const lineRange = new vscode.Range(range.start.line, 0, endLine, document.lineAt(endLine).text.length);
      const text = document.getText(lineRange);
      const ed = editorInfo(document, options);
      const o = resolveOptions(raw, ed);
      // derive the starting indentation level from the first non-empty line
      const first = document.lineAt(range.start.line).text;
      const lead = /^[ \t]*/.exec(first)[0];
      const cols = [...lead].reduce((n, ch) => n + (ch === '\t' ? o.indentWidth : 1), 0);
      const level = Math.floor(cols / o.indentWidth);
      const result = format(text, o, ed, { fragment: true, initialLevel: level });
      return result === text ? [] : [vscode.TextEdit.replace(lineRange, result)];
    });
  },
};

function activate(context) {
  output = vscode.window.createOutputChannel('SAP HANA SQL');
  const selector = SQL_LANGUAGES.map((language) => ({ language }));
  context.subscriptions.push(
    output,
    vscode.languages.registerDocumentFormattingEditProvider(selector, provider),
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, provider),
    vscode.commands.registerCommand('hanasql.openFormatterSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:l1asis.sap-hana-dev-tools hanasql.format')
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
