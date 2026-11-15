import {
  XSJS_CATALOG,
  XSJS_GLOBALS,
  XSJS_IMPORT_MODULES,
  type XsjsChildRef,
  type XsjsMemberDoc,
  type XsjsMethodDoc,
  type XsjsSymbolEntry,
} from './xsjs-catalog';

export type XsjsCompletionKind =
  | 'namespace'
  | 'class'
  | 'method'
  | 'function'
  | 'property'
  | 'constant';

export interface XsjsCompletionCandidate {
  readonly label: string;
  readonly kind: XsjsCompletionKind;
  readonly detail: string;
  readonly documentation: string;
  readonly deprecated?: string;
  readonly sortPrefix: string;
  readonly replaceStart?: number;
  readonly replaceEnd?: number;
}

export interface XsjsHoverResult {
  readonly markdown: string;
  readonly start: number;
  readonly end: number;
}

export interface XsjsSignatureParamInfo {
  readonly label: string;
  readonly documentation: string;
}

export interface XsjsSignatureInfo {
  readonly label: string;
  readonly documentation: string;
  readonly deprecated?: string;
  readonly parameters: readonly XsjsSignatureParamInfo[];
}

export interface XsjsSignatureHelpResult {
  readonly signatures: readonly XsjsSignatureInfo[];
  readonly activeSignature: number;
  readonly activeParameter: number;
}

interface ResolvedType {
  readonly typeName: string;
  readonly isInstance: boolean;
}

interface MaskedSource {
  /** Comments and string contents replaced by spaces (same length & indices as original text). */
  readonly masked: string;
}

const IDENT_CHAR_RE = /[a-zA-Z0-9_$]/;

/**
 * Replaces comments and string literal bodies with spaces while keeping exact character offsets.
 * String delimiters remain as `'` / `"` / `` ` `` so string boundaries stay recognizable.
 */
function maskCommentsAndStrings(text: string): MaskedSource {
  const chars = text.split('');
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    const next = chars[i + 1] ?? '';

    if (ch === '/' && next === '/') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < chars.length && chars[i] !== '\n') {
        chars[i] = ' ';
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') chars[i] = ' ';
        i++;
      }
      if (i + 1 < chars.length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
      }
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < chars.length) {
        if (chars[i] === '\\') {
          chars[i] = ' ';
          if (i + 1 < chars.length && chars[i + 1] !== '\n') {
            chars[i + 1] = ' ';
          }
          i += 2;
          continue;
        }
        if (chars[i] === quote) {
          i++;
          break;
        }
        if (chars[i] !== '\n') chars[i] = ' ';
        i++;
      }
      continue;
    }

    i++;
  }

  return { masked: chars.join('') };
}

interface CursorMaskState {
  readonly inComment: boolean;
  readonly quote: string | null;
  readonly quoteStart: number;
}

function getCursorMaskState(text: string, offset: number): CursorMaskState {
  if (offset <= 0 || offset > text.length) {
    return { inComment: false, quote: null, quoteStart: -1 };
  }
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let quote: string | null = null;
  let quoteStart = -1;
  while (i < offset) {
    const c = text[i];
    const n = text[i + 1] ?? '';
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') {
        inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (quote !== null) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) {
        quote = null;
        quoteStart = -1;
      }
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      quote = c;
      quoteStart = i;
      i++;
      continue;
    }
    i++;
  }
  return { inComment: inLineComment || inBlockComment, quote, quoteStart };
}

function isInsideMask(text: string, masked: string, offset: number, allowStrings = false): boolean {
  void masked;
  const state = getCursorMaskState(text, offset);
  return state.inComment || (!allowStrings && state.quote !== null);
}

interface ParsedSegment {
  readonly name: string;
  readonly isCall: boolean;
  readonly argsStart?: number;
  readonly argsEnd?: number;
}

interface ParsedChain {
  readonly isNew: boolean;
  readonly segments: readonly ParsedSegment[];
}

/**
 * Extracts a chained member/call expression ending at `endOffset` inside `masked`.
 * Example: `new $.net.Mail().` -> chain ending before `.`.
 */
function extractExpressionChainEndingAt(masked: string, endOffset: number): ParsedChain | null {
  let i = endOffset;
  while (i > 0 && /\s/.test(masked[i - 1])) i--;

  const rawSegments: ParsedSegment[] = [];

  while (i > 0) {
    let isCall = false;
    let argsStart: number | undefined;
    let argsEnd: number | undefined;
    while (i > 0 && /\s/.test(masked[i - 1])) i--;

    // Check trailing call `(...)`
    if (i > 0 && masked[i - 1] === ')') {
      isCall = true;
      argsEnd = i - 1;
      let depth = 1;
      i--;
      while (i > 0 && depth > 0) {
        if (masked[i - 1] === ')') depth++;
        else if (masked[i - 1] === '(') depth--;
        i--;
      }
      if (depth !== 0) return null;
      argsStart = i + 1;
      while (i > 0 && /\s/.test(masked[i - 1])) i--;
    }

    // Read identifier
    const identEnd = i;
    while (i > 0 && IDENT_CHAR_RE.test(masked[i - 1])) i--;
    if (i === identEnd) return null;
    const name = masked.slice(i, identEnd);
    rawSegments.unshift({
      name,
      isCall,
      ...(argsStart !== undefined ? { argsStart, argsEnd } : {}),
    });

    while (i > 0 && /\s/.test(masked[i - 1])) i--;
    if (i > 0 && masked[i - 1] === '.') {
      i--;
      while (i > 0 && /\s/.test(masked[i - 1])) i--;
      continue;
    }
    break;
  }

  if (rawSegments.length === 0) return null;

  // Check if preceded by `new` keyword
  let k = i;
  while (k > 0 && /\s/.test(masked[k - 1])) k--;
  const before = masked.slice(Math.max(0, k - 4), k);
  const isNew = /(?:^|[^a-zA-Z0-9_$])new$/.test(before);

  return { isNew, segments: rawSegments };
}

function getEntryAndAncestors(typeName: string): readonly XsjsSymbolEntry[] {
  const result: XsjsSymbolEntry[] = [];
  const visited = new Set<string>();
  const queue = [typeName];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const entry = XSJS_CATALOG[current];
    if (!entry) continue;
    result.push(entry);
    if (entry.extends) {
      for (const base of entry.extends) {
        if (!visited.has(base)) queue.push(base);
      }
    }
  }
  return result;
}

function resolveCatalogReturnType(typeExpr: string): ResolvedType | null {
  const parts = typeExpr
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p && p !== 'undefined' && p !== 'null' && p !== 'void');

  for (const part of parts) {
    if (part.startsWith('typeof ')) {
      const target = part.slice('typeof '.length).trim();
      const targetEntry = XSJS_CATALOG[target];
      if (targetEntry) {
        return { typeName: target, isInstance: targetEntry.kind === 'namespace' };
      }
    }
    const cleaned = part.replace(/\[\]$/, '').trim();
    const entry = XSJS_CATALOG[cleaned];
    if (entry) {
      return { typeName: cleaned, isInstance: entry.kind !== 'class' ? entry.kind === 'namespace' : true };
    }
  }
  return null;
}

function collectInheritedMembers(entry: XsjsSymbolEntry): {
  children: readonly XsjsChildRef[];
  members: readonly XsjsMemberDoc[];
  methods: readonly XsjsMethodDoc[];
} {
  const entries = getEntryAndAncestors(entry.fullName);
  const seenMembers = new Set<string>();
  const members: XsjsMemberDoc[] = [];
  const methods: XsjsMethodDoc[] = [];

  for (const e of entries) {
    for (const m of e.members) {
      if (!seenMembers.has(m.name)) {
        seenMembers.add(m.name);
        members.push(m);
      }
    }
    for (const fn of e.methods) {
      methods.push(fn);
    }
  }
  return {
    children: entry.children,
    members,
    methods,
  };
}

function resolveDollarImport(seg: ParsedSegment, rawText: string): ResolvedType | null {
  if (!seg.isCall || seg.argsStart === undefined || seg.argsEnd === undefined) {
    return null;
  }
  const argsText = rawText.slice(seg.argsStart, seg.argsEnd);
  const twoArg = /^\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*$/.exec(argsText);
  if (twoArg) {
    const key = `${twoArg[1]}:${twoArg[2]}`;
    const target = XSJS_IMPORT_MODULES[key];
    const targetEntry = target ? XSJS_CATALOG[target] : undefined;
    if (target && targetEntry) {
      return { typeName: target, isInstance: targetEntry.kind === 'namespace' };
    }
    return null;
  }
  const oneArg = /^\s*['"]([^'"]+)['"]\s*$/.exec(argsText);
  if (oneArg && XSJS_IMPORT_MODULES[oneArg[1]]) {
    const target = XSJS_IMPORT_MODULES[oneArg[1]];
    const targetEntry = XSJS_CATALOG[target];
    if (targetEntry) {
      return { typeName: target, isInstance: targetEntry.kind === 'namespace' };
    }
  }
  return null;
}

function resolveChain(
  chain: ParsedChain,
  locals: ReadonlyMap<string, ResolvedType>,
  rawText = ''
): ResolvedType | null {
  if (chain.segments.length === 0) return null;
  const first = chain.segments[0];
  let current: ResolvedType | null = null;

  if (!first.isCall && XSJS_CATALOG[first.name]) {
    const rootEntry = XSJS_CATALOG[first.name];
    current = { typeName: first.name, isInstance: rootEntry.kind === 'namespace' };
  } else {
    const localType = locals.get(first.name);
    if (localType) {
      if (first.isCall) {
        if (!chain.isNew || XSJS_CATALOG[localType.typeName]?.kind !== 'class') {
          return null;
        }
        current = { typeName: localType.typeName, isInstance: true };
      } else {
        current = localType;
      }
    } else if (first.isCall) {
      const globalFn = XSJS_GLOBALS.find((g) => g.name === first.name);
      if (!globalFn) return null;
      current = resolveCatalogReturnType(globalFn.returnType);
      if (!current) return null;
    } else {
      return null;
    }
  }

  for (let idx = 1; idx < chain.segments.length; idx++) {
    const seg = chain.segments[idx];
    const entry: XsjsSymbolEntry | undefined = XSJS_CATALOG[current.typeName];
    if (!entry) return null;

    if (current.typeName === '$' && seg.name === 'import' && seg.isCall) {
      const imported = resolveDollarImport(seg, rawText);
      if (imported) {
        current = imported;
        continue;
      }
    }

    // 1. Child namespace / class lookup (valid for namespace or static class side)
    const child: XsjsChildRef | undefined = entry.children.find((c) => c.name === seg.name);
    if (child) {
      const isLast: boolean = idx === chain.segments.length - 1;
      const instantiated: boolean = chain.isNew && child.kind === 'class' && (isLast || seg.isCall);
      current = {
        typeName: child.fullName,
        isInstance: instantiated ? true : child.kind === 'namespace',
      };
      continue;
    }

    const { members, methods } = collectInheritedMembers(entry);

    // 2. Call segment (.methodName(...)) or property reference
    if (seg.isCall) {
      const matchedMethod = methods.find((m) => m.name === seg.name);
      if (!matchedMethod) return null;
      const ret = resolveCatalogReturnType(matchedMethod.returnType);
      if (!ret) return null;
      current = ret;
      continue;
    }

    const matchedMember = members.find((m) => m.name === seg.name);
    if (matchedMember) {
      const resolvedMember = resolveCatalogReturnType(matchedMember.type);
      if (!resolvedMember) return null;
      current = resolvedMember;
      continue;
    }

    const matchedMethod = methods.find((m) => m.name === seg.name);
    if (matchedMethod && idx === chain.segments.length - 1) {
      return null;
    }

    return null;
  }

  if (chain.isNew && XSJS_CATALOG[current.typeName]?.kind === 'class') {
    return { typeName: current.typeName, isInstance: true };
  }
  return current;
}

/**
 * Infers types of local `var`/`let`/`const` bindings and simple reassignments prior to `offset`.
 * Example: `var conn = $.hdb.getConnection();` -> `conn: $.hdb.Connection (instance)`.
 */
export function inferXsjsLocalVariables(
  masked: string,
  limitOffset: number,
  rawText = masked
): Map<string, ResolvedType> {
  const locals = new Map<string, ResolvedType>();
  const slice = masked.slice(0, limitOffset);
  const assignRe = /(?:^|[;{}\n])\s*(?:(?:var|let|const)\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*([^;\n]+)(?=[;\n]|$)/g;

  let m: RegExpExecArray | null;
  while ((m = assignRe.exec(slice)) !== null) {
    const varName = m[1];
    const rhsRaw = m[2].trim();
    const rhsOffset = m.index + m[0].length;
    const chain = extractExpressionChainEndingAt(slice, rhsOffset);
    if (chain) {
      const resolved = resolveChain(chain, locals, rawText);
      if (resolved) {
        locals.set(varName, resolved);
        continue;
      }
    }
    if (rhsRaw.startsWith('$') || rhsRaw.startsWith('new ') || rhsRaw.startsWith('jasmine') || rhsRaw.startsWith('sap')) {
      const subChain = extractExpressionChainEndingAt(slice, rhsOffset);
      if (subChain) {
        const resolved = resolveChain(subChain, locals, rawText);
        if (resolved) locals.set(varName, resolved);
      }
    }
  }

  return locals;
}

function formatMethodSignature(name: string, method: XsjsMethodDoc, classOrNsPrefix?: string): string {
  const params = method.params
    .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`)
    .join(', ');
  const prefix = classOrNsPrefix ? `${classOrNsPrefix}.` : '';
  return `${prefix}${name}(${params}): ${method.returnType}`;
}

function buildMethodDocumentation(overloads: readonly XsjsMethodDoc[]): string {
  const sections: string[] = [];
  for (const fn of overloads) {
    const lines: string[] = [];
    lines.push('```ts\n' + formatMethodSignature(fn.name, fn) + '\n```');
    if (fn.deprecated) {
      lines.push(`**@deprecated** ${fn.deprecated}`);
    }
    if (fn.description) {
      lines.push(fn.description);
    }
    if (fn.params.length > 0) {
      lines.push(
        fn.params
          .map((p) => `- \`${p.name}\` (\`${p.type}\`)${p.description ? `: ${p.description}` : ''}`)
          .join('\n')
      );
    }
    sections.push(lines.join('\n\n'));
  }
  return sections.join('\n\n---\n\n');
}

function mapChildKind(child: XsjsChildRef): XsjsCompletionKind {
  return child.kind === 'class' ? 'class' : 'namespace';
}

function isConstantMember(entry: XsjsSymbolEntry, member: XsjsMemberDoc): boolean {
  if (member.readonly && member.static) return true;
  if (entry.fullName.endsWith('.types') || entry.fullName === '$.net.http') {
    return /^[A-Z][A-Z0-9_]*$/.test(member.name);
  }
  return false;
}

function getImportStringCompletions(
  text: string,
  masked: string,
  quoteStart: number,
  offset: number
): readonly XsjsCompletionCandidate[] {
  const prefix = text.slice(quoteStart + 1, offset);
  if (prefix.includes('\n')) return [];
  const lowerPrefix = prefix.toLowerCase();
  const beforeQuote = masked.slice(0, quoteStart);

  // 1st argument: $.import("sap.hana...", "...")
  if (/(?:^|[^a-zA-Z0-9_$])\$\s*\.\s*import\s*\(\s*$/.test(beforeQuote)) {
    const packages = new Map<string, string[]>();
    for (const [key, target] of Object.entries(XSJS_IMPORT_MODULES)) {
      const idx = key.indexOf(':');
      if (idx <= 0) continue;
      const pkg = key.slice(0, idx);
      const lib = key.slice(idx + 1);
      const libs = packages.get(pkg) ?? [];
      libs.push(`${lib} -> ${target}`);
      packages.set(pkg, libs);
    }

    const candidates: XsjsCompletionCandidate[] = [];
    for (const [pkg, libs] of [...packages.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (lowerPrefix && !pkg.toLowerCase().startsWith(lowerPrefix)) continue;
      candidates.push({
        label: pkg,
        kind: 'namespace',
        detail: 'SAP HANA XS package',
        documentation: `Available libraries: ${libs.map((l) => `\`${l}\``).join(', ')}`,
        sortPrefix: '0',
        replaceStart: quoteStart + 1,
        replaceEnd: offset,
      });
    }
    return candidates;
  }

  // 2nd argument: $.import("sap.hana.xs.libs.dbutils", "xsds")
  const secondArgMatch = /(?:^|[^a-zA-Z0-9_$])\$\s*\.\s*import\s*\(\s*(['"])[^\n'"]*\1\s*,\s*$/.exec(beforeQuote);
  if (secondArgMatch) {
    const pkgCallMatch = /(?:^|[^a-zA-Z0-9_$])\$\s*\.\s*import\s*\(\s*['"]([^'"]+)['"]\s*,\s*$/.exec(
      text.slice(Math.max(0, quoteStart - 256), quoteStart)
    );
    if (!pkgCallMatch) return [];
    const pkg = pkgCallMatch[1];
    const prefixKey = `${pkg}:`;
    const candidates: XsjsCompletionCandidate[] = [];
    for (const [key, target] of Object.entries(XSJS_IMPORT_MODULES).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!key.startsWith(prefixKey)) continue;
      const lib = key.slice(prefixKey.length);
      if (lowerPrefix && !lib.toLowerCase().startsWith(lowerPrefix)) continue;
      const entry = XSJS_CATALOG[target];
      candidates.push({
        label: lib,
        kind: 'namespace',
        detail: target,
        documentation: entry?.description ?? `SAP HANA XS library \`${target}\``,
        sortPrefix: '0',
        replaceStart: quoteStart + 1,
        replaceEnd: offset,
      });
    }
    return candidates;
  }

  return [];
}

const ROOT_NAMESPACE_NAMES = ['$', 'jasmine', 'sap'] as const;

/**
 * Computes completion candidates at `offset` inside an XSJS/XSJSLIB document.
 */
export function getXsjsCompletions(text: string, offset: number): readonly XsjsCompletionCandidate[] {
  const { masked } = maskCommentsAndStrings(text);
  const maskState = getCursorMaskState(text, offset);
  if (maskState.inComment) return [];
  if (maskState.quote !== null) {
    return getImportStringCompletions(text, masked, maskState.quoteStart, offset);
  }

  // Identify optional partial word currently being typed right before cursor.
  let wordStart = offset;
  while (wordStart > 0 && IDENT_CHAR_RE.test(masked[wordStart - 1])) {
    wordStart--;
  }
  const typedPrefix = masked.slice(wordStart, offset);

  let beforeWord = wordStart;
  while (beforeWord > 0 && /\s/.test(masked[beforeWord - 1])) {
    beforeWord--;
  }

  // Case 1: Root namespace (`$`, `jasmine`, `sap`) and XSUnit globals when typing top-level identifier
  if (beforeWord === 0 || masked[beforeWord - 1] !== '.') {
    if (!typedPrefix) return [];
    const lowerPrefix = typedPrefix.toLowerCase();
    const candidates: XsjsCompletionCandidate[] = [];

    for (const rootName of ROOT_NAMESPACE_NAMES) {
      const rootEntry = XSJS_CATALOG[rootName];
      if (!rootEntry) continue;
      if (!rootName.toLowerCase().startsWith(lowerPrefix)) continue;
      candidates.push({
        label: rootName,
        kind: 'namespace',
        detail: `namespace ${rootName}`,
        documentation: rootEntry.description,
        sortPrefix: '0',
      });
    }

    for (const g of XSJS_GLOBALS) {
      if (!g.name.toLowerCase().startsWith(lowerPrefix)) continue;
      candidates.push({
        label: g.name,
        kind: 'function',
        detail: formatMethodSignature(g.name, g),
        documentation: buildMethodDocumentation([g]),
        ...(g.deprecated ? { deprecated: g.deprecated } : {}),
        sortPrefix: '1',
      });
    }

    return candidates;
  }

  // Case 2: Member completion `<receiver>.<partial>`
  const dotIndex = beforeWord - 1;
  const chain = extractExpressionChainEndingAt(masked, dotIndex);
  if (!chain) return [];

  const locals = inferXsjsLocalVariables(masked, dotIndex, text);
  const resolved = resolveChain(chain, locals, text);
  if (!resolved) return [];

  const entry = XSJS_CATALOG[resolved.typeName];
  if (!entry) return [];

  const { children, members, methods } = collectInheritedMembers(entry);
  const candidates: XsjsCompletionCandidate[] = [];
  const lowerPrefix = typedPrefix.toLowerCase();

  // Child namespaces / nested classes
  for (const c of children) {
    if (lowerPrefix && !c.name.toLowerCase().startsWith(lowerPrefix)) continue;
    candidates.push({
      label: c.name,
      kind: mapChildKind(c),
      detail: `${c.kind} ${c.fullName}`,
      documentation: c.description,
      sortPrefix: '1',
    });
  }

  const isClassType = entry.kind === 'class';
  for (const m of members) {
    if (isClassType && !resolved.isInstance && !m.static) continue;
    if (isClassType && resolved.isInstance && m.static) continue;
    if (lowerPrefix && !m.name.toLowerCase().startsWith(lowerPrefix)) continue;

    candidates.push({
      label: m.name,
      kind: isConstantMember(entry, m) ? 'constant' : 'property',
      detail: m.type,
      documentation: m.deprecated ? `**@deprecated** ${m.deprecated}\n\n${m.description}` : m.description,
      ...(m.deprecated ? { deprecated: m.deprecated } : {}),
      sortPrefix: '2',
    });
  }

  // Group overloaded methods by name
  const methodsByName = new Map<string, XsjsMethodDoc[]>();
  for (const fn of methods) {
    if (isClassType && !resolved.isInstance && !fn.static) continue;
    if (isClassType && resolved.isInstance && fn.static) continue;
    if (lowerPrefix && !fn.name.toLowerCase().startsWith(lowerPrefix)) continue;
    const list = methodsByName.get(fn.name) ?? [];
    list.push(fn);
    methodsByName.set(fn.name, list);
  }

  for (const [name, overloads] of methodsByName.entries()) {
    const first = overloads[0];
    const overloadNote = overloads.length > 1 ? ` (+${overloads.length - 1} overload${overloads.length > 2 ? 's' : ''})` : '';
    const allDeprecated = overloads.every((o) => Boolean(o.deprecated));
    candidates.push({
      label: name,
      kind: entry.kind === 'namespace' ? 'function' : 'method',
      detail: `${formatMethodSignature(name, first)}${overloadNote}`,
      documentation: buildMethodDocumentation(overloads),
      ...(allDeprecated && first.deprecated ? { deprecated: first.deprecated } : {}),
      sortPrefix: '3',
    });
  }

  return candidates;
}

/**
 * Computes hover documentation at `offset` inside an XSJS/XSJSLIB document.
 */
export function getXsjsHover(text: string, offset: number): XsjsHoverResult | null {
  const { masked } = maskCommentsAndStrings(text);
  if (isInsideMask(text, masked, offset)) return null;

  let start = offset;
  let end = offset;
  while (start > 0 && IDENT_CHAR_RE.test(masked[start - 1])) start--;
  while (end < masked.length && IDENT_CHAR_RE.test(masked[end])) end++;
  if (start === end) return null;

  const ident = masked.slice(start, end);
  let before = start;
  while (before > 0 && /\s/.test(masked[before - 1])) before--;

  // Top-level identifier hover (`$`, `jasmine`, `sap`, local variable, or XSUnit global function)
  if (before === 0 || masked[before - 1] !== '.') {
    if (ROOT_NAMESPACE_NAMES.includes(ident as (typeof ROOT_NAMESPACE_NAMES)[number])) {
      const rootEntry = XSJS_CATALOG[ident];
      if (rootEntry) {
        return {
          markdown: `\`\`\`ts\ndeclare namespace ${ident}\n\`\`\`\n\n${rootEntry.description}`,
          start,
          end,
        };
      }
    }

    const locals = inferXsjsLocalVariables(masked, start, text);
    const localResolved = locals.get(ident);
    if (localResolved) {
      const entry = XSJS_CATALOG[localResolved.typeName];
      return {
        markdown: `\`\`\`ts\nvar ${ident}: ${localResolved.typeName}\n\`\`\`${entry?.description ? `\n\n${entry.description}` : ''}`,
        start,
        end,
      };
    }

    const globalFns = XSJS_GLOBALS.filter((g) => g.name === ident);
    if (globalFns.length > 0) {
      return {
        markdown: buildMethodDocumentation(globalFns),
        start,
        end,
      };
    }

    return null;
  }

  // Member hover (`receiver.ident`)
  const chain = extractExpressionChainEndingAt(masked, before - 1);
  if (!chain) return null;
  const locals = inferXsjsLocalVariables(masked, before - 1, text);
  const resolved = resolveChain(chain, locals, text);
  if (!resolved) return null;
  const entry = XSJS_CATALOG[resolved.typeName];
  if (!entry) return null;

  const child = entry.children.find((c) => c.name === ident);
  if (child) {
    const kindPrefix = child.kind === 'class' ? 'class' : 'namespace';
    return {
      markdown: `\`\`\`ts\n${kindPrefix} ${child.fullName}\n\`\`\`${child.description ? `\n\n${child.description}` : ''}`,
      start,
      end,
    };
  }

  const { members, methods } = collectInheritedMembers(entry);
  const matchedMember = members.find((m) => m.name === ident);
  if (matchedMember) {
    const dep = matchedMember.deprecated ? `\n\n**@deprecated** ${matchedMember.deprecated}` : '';
    const ro = matchedMember.readonly ? 'readonly ' : '';
    return {
      markdown: `\`\`\`ts\n(property) ${entry.fullName}.${ro}${matchedMember.name}: ${matchedMember.type}\n\`\`\`${dep}${matchedMember.description ? `\n\n${matchedMember.description}` : ''}`,
      start,
      end,
    };
  }

  const matchedMethods = methods.filter((m) => m.name === ident);
  if (matchedMethods.length > 0) {
    const formatted = matchedMethods
      .map((fn) => {
        const header = '```ts\n' + formatMethodSignature(ident, fn, entry.fullName) + '\n```';
        const dep = fn.deprecated ? `\n\n**@deprecated** ${fn.deprecated}` : '';
        const desc = fn.description ? `\n\n${fn.description}` : '';
        return `${header}${dep}${desc}`;
      })
      .join('\n\n---\n\n');
    return { markdown: formatted, start, end };
  }

  return null;
}

/**
 * Computes active function/constructor signature help inside `(...)` at `offset`.
 */
export function getXsjsSignatureHelp(text: string, offset: number): XsjsSignatureHelpResult | null {
  const { masked } = maskCommentsAndStrings(text);
  if (isInsideMask(text, masked, offset, true)) return null;

  // Walk backward to find unmatched '(' and count top-level commas
  let depth = 0;
  let commaCount = 0;
  let openParen = -1;
  for (let i = offset - 1; i >= 0; i--) {
    const ch = masked[i];
    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth === 0) {
        openParen = i;
        break;
      }
      depth--;
    } else if (ch === ',' && depth === 0) {
      commaCount++;
    } else if (ch === ';' || ch === '{' || ch === '}') {
      if (depth === 0) return null;
    }
  }
  if (openParen < 0) return null;

  const chain = extractExpressionChainEndingAt(masked, openParen);
  if (!chain || chain.segments.length === 0) return null;

  const locals = inferXsjsLocalVariables(masked, openParen, text);

  // Constructor invocation: `new $.net.Mail(...)` or `new TableUtils(...)`
  if (chain.isNew) {
    const resolvedClass = resolveChain({ isNew: false, segments: chain.segments }, locals, text);
    if (!resolvedClass) return null;
    const entry = XSJS_CATALOG[resolvedClass.typeName];
    if (!entry || entry.constructors.length === 0) return null;

    const signatures = entry.constructors.map((ctor) => toSignatureInfo(`new ${resolvedClass.typeName}`, ctor));
    return {
      signatures,
      activeSignature: selectBestOverload(entry.constructors, commaCount),
      activeParameter: commaCount,
    };
  }

  // Top-level XSUnit global invocation: `describe(...)`, `expect(...)`, `spyOn(...)`
  if (chain.segments.length === 1) {
    const fnName = chain.segments[0].name;
    const globalMatches = XSJS_GLOBALS.filter((g) => g.name === fnName);
    if (globalMatches.length === 0) return null;
    return {
      signatures: globalMatches.map((g) => toSignatureInfo(g.name, g)),
      activeSignature: selectBestOverload(globalMatches, commaCount),
      activeParameter: commaCount,
    };
  }

  // Method / function invocation: `receiver.method(...)`
  const methodSeg = chain.segments[chain.segments.length - 1];
  const receiverChain: ParsedChain = { isNew: false, segments: chain.segments.slice(0, -1) };
  const resolvedReceiver = resolveChain(receiverChain, locals, text);
  if (!resolvedReceiver) return null;

  const entry = XSJS_CATALOG[resolvedReceiver.typeName];
  if (!entry) return null;

  const { methods } = collectInheritedMembers(entry);
  const matching = methods.filter((m) => m.name === methodSeg.name);
  if (matching.length === 0) return null;

  const signatures = matching.map((m) => toSignatureInfo(`${entry.fullName}.${m.name}`, m));
  return {
    signatures,
    activeSignature: selectBestOverload(matching, commaCount),
    activeParameter: commaCount,
  };
}

function toSignatureInfo(displayName: string, method: XsjsMethodDoc): XsjsSignatureInfo {
  const paramStrings = method.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`);
  const label = `${displayName}(${paramStrings.join(', ')}): ${method.returnType}`;
  return {
    label,
    documentation: method.description,
    ...(method.deprecated ? { deprecated: method.deprecated } : {}),
    parameters: method.params.map((p, idx) => ({
      label: paramStrings[idx],
      documentation: p.description ? `\`${p.type}\` — ${p.description}` : `\`${p.type}\``,
    })),
  };
}

function selectBestOverload(methods: readonly XsjsMethodDoc[], paramIndex: number): number {
  for (let i = 0; i < methods.length; i++) {
    const params = methods[i].params;
    const hasRest = params.some((p) => p.name.startsWith('...'));
    if (hasRest || paramIndex < params.length) {
      return i;
    }
  }
  return 0;
}
