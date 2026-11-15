import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  getXsjsCompletions,
  getXsjsHover,
  getXsjsSignatureHelp,
  type XsjsCompletionKind,
} from './intellisense-core';

function toVsCodeCompletionKind(kind: XsjsCompletionKind): vscode.CompletionItemKind {
  switch (kind) {
    case 'namespace':
      return vscode.CompletionItemKind.Module;
    case 'class':
      return vscode.CompletionItemKind.Class;
    case 'method':
      return vscode.CompletionItemKind.Method;
    case 'function':
      return vscode.CompletionItemKind.Function;
    case 'constant':
      return vscode.CompletionItemKind.Constant;
    case 'property':
      return vscode.CompletionItemKind.Property;
  }
}

function isXsjsIntelliSenseEnabled(): boolean {
  return vscode.workspace.getConfiguration('hanasql').get<boolean>('xsjs.enableIntelliSense', true);
}

/**
 * Registers zero-config Completion, Hover, and SignatureHelp providers for `.xsjs` and `.xsjslib`.
 */
export function registerXsjsIntelliSense(selector: vscode.DocumentSelector): vscode.Disposable[] {
  const completionProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (!isXsjsIntelliSenseEnabled()) return undefined;
      const offset = document.offsetAt(position);
      const candidates = getXsjsCompletions(document.getText(), offset);
      if (candidates.length === 0) return undefined;

      return candidates.map((c) => {
        const item = new vscode.CompletionItem(c.label, toVsCodeCompletionKind(c.kind));
        item.detail = c.detail;
        item.sortText = `${c.sortPrefix}_${c.label}`;
        if (c.documentation) {
          item.documentation = new vscode.MarkdownString(c.documentation);
        }
        if (c.deprecated) {
          item.tags = [vscode.CompletionItemTag.Deprecated];
        }
        if (c.replaceStart !== undefined && c.replaceEnd !== undefined) {
          item.range = new vscode.Range(
            document.positionAt(c.replaceStart),
            document.positionAt(c.replaceEnd)
          );
        }
        return item;
      });
    },
  };

  const hoverProvider: vscode.HoverProvider = {
    provideHover(document, position) {
      if (!isXsjsIntelliSenseEnabled()) return undefined;
      const offset = document.offsetAt(position);
      const hover = getXsjsHover(document.getText(), offset);
      if (!hover) return undefined;

      const md = new vscode.MarkdownString(hover.markdown);
      const range = new vscode.Range(
        document.positionAt(hover.start),
        document.positionAt(hover.end)
      );
      return new vscode.Hover(md, range);
    },
  };

  const signatureProvider: vscode.SignatureHelpProvider = {
    provideSignatureHelp(document, position) {
      if (!isXsjsIntelliSenseEnabled()) return undefined;
      const offset = document.offsetAt(position);
      const sigHelp = getXsjsSignatureHelp(document.getText(), offset);
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
    vscode.languages.registerCompletionItemProvider(selector, completionProvider, '.', '$', '"', '\''),
    vscode.languages.registerHoverProvider(selector, hoverProvider),
    vscode.languages.registerSignatureHelpProvider(selector, signatureProvider, '(', ','),
  ];
}

/**
 * Installs `resources/xsjs.d.ts` into the active workspace folder's `.vscode/xsjs.d.ts`
 * and updates `jsconfig.json` so VS Code's built-in JS/TS language service recognizes XSJS `$` globals.
 */
export async function installXsjsTypeDeclarations(extensionPath: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage(
      'Open a workspace folder first to configure XSJS type definitions (xsjs.d.ts).'
    );
    return;
  }

  const targetFolder =
    folders.length === 1
      ? folders[0]
      : await vscode.window.showWorkspaceFolderPick({
          placeHolder: 'Select workspace folder for XSJS xsjs.d.ts configuration',
        });
  if (!targetFolder) return;

  const srcDts = path.join(extensionPath, 'resources', 'xsjs.d.ts');
  if (!fs.existsSync(srcDts)) {
    void vscode.window.showErrorMessage(`Bundled XSJS declaration file not found: ${srcDts}`);
    return;
  }

  const rootDir = targetFolder.uri.fsPath;
  const vscodeDir = path.join(rootDir, '.vscode');
  const destDts = path.join(vscodeDir, 'xsjs.d.ts');
  await fs.promises.mkdir(vscodeDir, { recursive: true });
  await fs.promises.copyFile(srcDts, destDts);

  const jsconfigPath = path.join(rootDir, 'jsconfig.json');
  let jsconfig: Record<string, unknown> = {};
  if (fs.existsSync(jsconfigPath)) {
    try {
      const raw = await fs.promises.readFile(jsconfigPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        jsconfig = parsed as Record<string, unknown>;
      }
    } catch {
      void vscode.window.showWarningMessage(
        'Existing jsconfig.json could not be parsed cleanly; copied .vscode/xsjs.d.ts without modifying jsconfig.json.'
      );
      return;
    }
  } else {
    jsconfig = {
      compilerOptions: {
        checkJs: false,
        target: 'ES2020',
      },
      include: ['**/*.xsjs', '**/*.xsjslib', '**/*.js'],
    };
  }

  const includeList = Array.isArray(jsconfig.include)
    ? [...(jsconfig.include as unknown[]).filter((x): x is string => typeof x === 'string')]
    : ['**/*.xsjs', '**/*.xsjslib', '**/*.js'];
  if (!includeList.includes('.vscode/xsjs.d.ts')) {
    includeList.push('.vscode/xsjs.d.ts');
  }
  jsconfig.include = includeList;

  await fs.promises.writeFile(jsconfigPath, `${JSON.stringify(jsconfig, null, 2)}\n`, 'utf8');
  void vscode.window.showInformationMessage(
    `Installed XSJS type definitions to .vscode/xsjs.d.ts and configured jsconfig.json in ${targetFolder.name}.`
  );
}
