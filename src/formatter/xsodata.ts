import {
  EditorOptions,
  PartialFormatterOptions,
  ResolvedFormatterOptions,
  resolveOptions,
} from './options';
import {
  clampBlankLines,
  collapsePragmaRegions,
  finalizeDocument,
  indentStr,
  normalizeCommentText,
  renderCommentLines,
  scanBackslashStringEnd,
  scanBlockCommentEnd,
  scanDoubledQuoteEnd,
  scanLineCommentEnd,
} from './shared';

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

export type XsodataTokenType =
  | 'word'
  | 'number'
  | 'string'
  | 'sqstring'
  | 'punct'
  | 'op'
  | 'lineComment'
  | 'blockComment'
  | 'other'
  | 'raw';

export interface XsodataToken {
  readonly type: XsodataTokenType;
  readonly text: string;
  readonly nlBefore: number;
  readonly wsBefore: boolean;
  readonly start: number;
  readonly end: number;
}

const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

export function xsodataTokenize(text: string): XsodataToken[] {
  const tokens: XsodataToken[] = [];
  const n = text.length;
  let i = 0;
  let nl = 0;
  let ws = false;

  const push = (type: XsodataTokenType, start: number, end: number): void => {
    tokens.push({ type, text: text.slice(start, end), nlBefore: nl, wsBefore: ws, start, end });
    nl = 0;
    ws = false;
  };

  while (i < n) {
    const ch = text[i];

    if (
      ch === ' ' ||
      ch === '\t' ||
      ch === '\n' ||
      ch === '\r' ||
      ch === '\f' ||
      ch === '\v' ||
      ch === '\u00a0' ||
      ch === '\ufeff'
    ) {
      ws = true;
      if (ch === '\n') nl++;
      else if (ch === '\r') {
        if (text[i + 1] === '\n') i++;
        nl++;
      }
      i++;
      continue;
    }

    // Line comment //
    if (ch === '/' && text[i + 1] === '/') {
      const end = scanLineCommentEnd(text, i);
      push('lineComment', i, end);
      i = end;
      continue;
    }

    // Block comment /* ... */
    if (ch === '/' && text[i + 1] === '*') {
      const end = scanBlockCommentEnd(text, i);
      push('blockComment', i, end);
      i = end;
      continue;
    }

    // Double-quoted string (backslash escapes supported)
    if (ch === '"') {
      const end = scanBackslashStringEnd(text, i, '"');
      push('string', i, end);
      i = end;
      continue;
    }

    // Single-quoted string (defensive recovery)
    if (ch === "'") {
      const end = scanDoubledQuoteEnd(text, i, "'", true);
      push('sqstring', i, end);
      i = end;
      continue;
    }

    // Numeric literal (optionally signed integer for limits, etc.)
    if (DIGIT.test(ch) || (ch === '-' && DIGIT.test(text[i + 1] || ''))) {
      let j = i + (ch === '-' ? 1 : 0);
      while (j < n && DIGIT.test(text[j])) j++;
      push('number', i, j);
      i = j;
      continue;
    }

    // Identifier / keyword (including hyphenated keywords like `cache-control`)
    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < n) {
        if (WORD_PART.test(text[j])) {
          j++;
        } else if (text[j] === '-' && /[A-Za-z]/.test(text[j + 1] || '')) {
          j++;
        } else {
          break;
        }
      }
      push('word', i, j);
      i = j;
      continue;
    }

    if ('{}();,.='.includes(ch)) {
      push('punct', i, i + 1);
      i++;
      continue;
    }

    if ('+-*/<>!|&^~:?'.includes(ch)) {
      push('op', i, i + 1);
      i++;
      continue;
    }

    push('other', i, i + 1);
    i++;
  }

  return collapsePragmaRegions(
    tokens,
    text,
    (t) => t.type === 'lineComment' || t.type === 'blockComment',
    (rawText, firstTok, endOffset) => ({
      type: 'raw',
      text: rawText,
      nlBefore: firstTok.nlBefore,
      wsBefore: firstTok.wsBefore,
      start: firstTok.start,
      end: endOffset,
    })
  );
}

// ---------------------------------------------------------------------------
// AST Nodes & Parser
// ---------------------------------------------------------------------------

type XsItem = XsBlockNode | XsStatementNode | XsCommentNode | XsRawNode;

interface XsCommentNode {
  readonly kind: 'comment';
  readonly text: string;
  readonly isLine: boolean;
  readonly nlBefore: number;
}

interface XsRawNode {
  readonly kind: 'raw';
  readonly text: string;
  readonly nlBefore: number;
}

interface XsBlockNode {
  readonly kind: 'block';
  readonly headerTokens: readonly XsodataToken[];
  readonly items: readonly XsItem[];
  readonly headerTrailingComment?: XsCommentNode;
  readonly nlBefore: number;
  readonly unclosed: boolean;
}

interface XsStatementNode {
  readonly kind: 'statement';
  readonly tokens: readonly XsodataToken[]; // code & embedded comments
  readonly hasSemicolon: boolean;
  readonly trailingComment?: XsCommentNode;
  readonly nlBefore: number;
}

const TOP_BLOCK_KEYWORDS = new Set(['service', 'annotations', 'settings']);

function isComment(t: XsodataToken): boolean {
  return t.type === 'lineComment' || t.type === 'blockComment';
}

function isTrivia(t: XsodataToken): boolean {
  return isComment(t) || t.type === 'raw';
}

class XsParser {
  private readonly t: readonly XsodataToken[];
  private i = 0;

  constructor(tokens: readonly XsodataToken[]) {
    this.t = tokens;
  }

  parseDocument(): XsItem[] {
    return this.parseItems(false);
  }

  private parseItems(stopAtBrace: boolean): XsItem[] {
    const items: XsItem[] = [];

    while (this.i < this.t.length) {
      const tok = this.t[this.i];
      if (stopAtBrace && tok.text === '}') {
        break;
      }

      if (tok.type === 'raw') {
        items.push({ kind: 'raw', text: tok.text, nlBefore: tok.nlBefore });
        this.i++;
        continue;
      }

      if (isComment(tok)) {
        items.push({
          kind: 'comment',
          text: tok.text,
          isLine: tok.type === 'lineComment',
          nlBefore: tok.nlBefore,
        });
        this.i++;
        continue;
      }

      // Stray punctuation at item boundary (e.g., extra `;` or unmatched `}`)
      if (tok.text === ';') {
        this.i++;
        continue;
      }

      if (this.startsBlock(this.i)) {
        items.push(this.parseBlock());
        continue;
      }

      items.push(this.parseStatement(stopAtBrace));
    }

    return items;
  }

  private startsBlock(idx: number): boolean {
    const first = this.t[idx];
    if (first.type !== 'word' || !TOP_BLOCK_KEYWORDS.has(first.text.toLowerCase())) {
      return false;
    }
    let k = idx;
    while (k < this.t.length) {
      const tk = this.t[k];
      if (tk.text === '{') return true;
      if (tk.text === ';' || tk.text === '}') return false;
      k++;
    }
    return false;
  }

  private parseBlock(): XsBlockNode {
    const nlBefore = this.t[this.i].nlBefore;
    const headerTokens: XsodataToken[] = [];

    while (this.i < this.t.length && this.t[this.i].text !== '{') {
      headerTokens.push(this.t[this.i]);
      this.i++;
    }

    if (this.i < this.t.length && this.t[this.i].text === '{') {
      this.i++; // consume '{'
    }

    const headerTrailingComment = this.consumeInlineComment();
    const items = this.parseItems(true);

    let unclosed = true;
    if (this.i < this.t.length && this.t[this.i].text === '}') {
      unclosed = false;
      this.i++; // consume '}'
    }

    // Consume trailing ';' after block brace if present in malformed user input (rule: no trailing ';' after '}')
    if (this.i < this.t.length && this.t[this.i].text === ';') {
      this.i++;
    }

    return {
      kind: 'block',
      headerTokens,
      items,
      headerTrailingComment,
      nlBefore,
      unclosed,
    };
  }

  private parseStatement(insideBlock: boolean): XsStatementNode {
    const nlBefore = this.t[this.i].nlBefore;
    const tokens: XsodataToken[] = [];
    let parenDepth = 0;
    let hasSemicolon = false;

    while (this.i < this.t.length) {
      const tk = this.t[this.i];
      if (tk.text === '(') parenDepth++;
      else if (tk.text === ')' && parenDepth > 0) parenDepth--;

      if (parenDepth === 0) {
        if (tk.text === ';') {
          hasSemicolon = true;
          this.i++;
          break;
        }
        if (insideBlock && tk.text === '}') {
          break;
        }
        if (tk.type === 'raw') {
          break;
        }
        // Recover on missing semicolon before a nested/top block
        if (tokens.length > 0 && tk.nlBefore > 0 && this.startsBlock(this.i)) {
          break;
        }
      }

      tokens.push(tk);
      this.i++;
    }

    const trailingComment = hasSemicolon ? this.consumeInlineComment() : undefined;

    return {
      kind: 'statement',
      tokens,
      hasSemicolon,
      trailingComment,
      nlBefore,
    };
  }

  private consumeInlineComment(): XsCommentNode | undefined {
    if (this.i >= this.t.length) return undefined;
    const next = this.t[this.i];
    if (next.nlBefore === 0 && isComment(next)) {
      this.i++;
      return {
        kind: 'comment',
        text: next.text,
        isLine: next.type === 'lineComment',
        nlBefore: 0,
      };
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Token Spacing & Clause Analysis
// ---------------------------------------------------------------------------

const ENTITY_SUBCLAUSE_KEYWORDS = new Set([
  'with',
  'without',
  'omitting',
  'key',
  'keys',
  'concurrencytoken',
  'etag',
  'navigates',
  'aggregates',
  'parameters',
  'create',
  'update',
  'delete',
]);

const ASSOC_SUBCLAUSE_KEYWORDS = new Set([
  'principal',
  'dependent',
  'over',
  'no',
  'storage',
  'create',
  'update',
  'delete',
]);

const MOD_KEYWORDS = new Set(['create', 'update', 'delete']);

function needSpaceBetween(prev: XsodataToken | null, curr: XsodataToken): boolean {
  if (!prev) return false;
  if (prev.text === '.' || curr.text === '.') return false;
  if (curr.text === ';' || curr.text === ',') return false;
  if (prev.text === '(' || curr.text === ')') {
    if (curr.text === ')') return false;
    if (prev.text === '(') return false;
    return true;
  }
  if (curr.text === '(') {
    // Keep "Customers"("ID") attached; space keyword-led lists like navigates (...), with (...), events (...), key (...)
    return prev.type === 'word';
  }
  if (curr.text === ')') return false;
  if (prev.text === '=' || curr.text === '=') return true;
  return true;
}

function renderTokensInline(tokens: readonly XsodataToken[], o: ResolvedFormatterOptions): string {
  let line = '';
  let prev: XsodataToken | null = null;
  for (const tok of tokens) {
    if (isComment(tok)) {
      const norm = normalizeCommentText(tok.text, tok.type === 'lineComment', o);
      line += (line.length > 0 ? ' ' : '') + norm;
      prev = tok;
      continue;
    }
    if (prev && isComment(prev)) {
      line += ' ' + tok.text;
      prev = tok;
      continue;
    }
    if (needSpaceBetween(prev, tok)) {
      line += ' ';
    }
    line += tok.text;
    prev = tok;
  }
  return line;
}

function nextCodeToken(tokens: readonly XsodataToken[], from: number): XsodataToken | null {
  for (let k = from + 1; k < tokens.length; k++) {
    if (!isTrivia(tokens[k])) return tokens[k];
  }
  return null;
}

function prevCodeToken(tokens: readonly XsodataToken[], from: number): XsodataToken | null {
  for (let k = from - 1; k >= 0; k--) {
    if (!isTrivia(tokens[k])) return tokens[k];
  }
  return null;
}

interface ClauseChunk {
  readonly tokens: XsodataToken[];
  readonly trailingComment?: XsodataToken;
}

function splitStatementClauses(
  tokens: readonly XsodataToken[],
  isAssociation: boolean
): { head: ClauseChunk; clauses: ClauseChunk[]; hasModification: boolean; hasComments: boolean } {
  const hasComments = tokens.some((t) => isTrivia(t));
  let hasModification = false;

  const chunks: XsodataToken[][] = [[]];
  let parenDepth = 0;

  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.text === '(') parenDepth++;
    else if (tk.text === ')' && parenDepth > 0) parenDepth--;

    if (parenDepth === 0 && tk.type === 'word') {
      const low = tk.text.toLowerCase();
      if (MOD_KEYWORDS.has(low)) {
        hasModification = true;
      }

      const prev = prevCodeToken(tokens, k);
      const next = nextCodeToken(tokens, k);

      let startsNewClause = false;
      if (k > 0) {
        if (isAssociation) {
          if (ASSOC_SUBCLAUSE_KEYWORDS.has(low)) {
            if (low === 'no') {
              startsNewClause = next?.text.toLowerCase() === 'storage';
            } else if (low === 'storage') {
              startsNewClause = prev?.text.toLowerCase() !== 'no';
            } else {
              startsNewClause = true;
            }
          }
        } else {
          if (ENTITY_SUBCLAUSE_KEYWORDS.has(low)) {
            if (low === 'key') {
              // Avoid splitting inside `parameters via key and entity`
              startsNewClause = prev?.text.toLowerCase() !== 'via';
            } else if (low === 'with') {
              // In case of future extensions, `with` in entity starts `with (...)`
              startsNewClause = next?.text === '(';
            } else {
              startsNewClause = true;
            }
          }
        }
      }

      if (startsNewClause && chunks[chunks.length - 1].length > 0) {
        chunks.push([]);
      }
    }

    chunks[chunks.length - 1].push(tk);
  }

  // Pull trailing inline comment at the end of chunk[m] if there was one before the next chunk,
  // or leave leading standalone comments attached nicely.
  const toChunk = (arr: XsodataToken[]): ClauseChunk => {
    if (arr.length > 0 && isComment(arr[arr.length - 1])) {
      // Only treat as trailing inline comment if it shares line with prior token
      const last = arr[arr.length - 1];
      if (last.nlBefore === 0 && arr.length > 1) {
        return { tokens: arr.slice(0, -1), trailingComment: last };
      }
    }
    return { tokens: arr };
  };

  const head = toChunk(chunks[0]);
  const clauses = chunks.slice(1).map(toChunk);
  return { head, clauses, hasModification, hasComments };
}

/**
 * Split a comma-separated list inside top-level parens `prefix ( item1, item2, ... ) suffix`
 * if `tokens` contains a single keyword-led `(` ... `)` exceeding `maxLineLength`.
 */
function tryWrapParenListClause(
  tokens: readonly XsodataToken[],
  level: number,
  suffixText: string,
  o: ResolvedFormatterOptions
): string[] | null {
  if (o.maxLineLength === 0) return null;

  // Locate first top-level '(' attached to a keyword (`with`, `navigates`, `events`, etc.)
  let openIdx = -1;
  let closeIdx = -1;
  let depth = 0;

  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (isTrivia(tk)) continue;
    if (tk.text === '(') {
      if (depth === 0 && openIdx === -1) {
        openIdx = k;
      }
      depth++;
    } else if (tk.text === ')') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && openIdx !== -1) {
          closeIdx = k;
          break;
        }
      }
    }
  }

  if (openIdx === -1 || closeIdx === -1) return null;

  const prefixToks = tokens.slice(0, openIdx);
  const innerToks = tokens.slice(openIdx + 1, closeIdx);
  const tailToks = tokens.slice(closeIdx + 1);

  if (innerToks.length === 0) return null;

  // Split innerToks by top-level commas
  const items: XsodataToken[][] = [[]];
  let innerDepth = 0;
  for (const tk of innerToks) {
    if (tk.text === '(') innerDepth++;
    else if (tk.text === ')' && innerDepth > 0) innerDepth--;
    if (innerDepth === 0 && tk.text === ',') {
      items.push([]);
    } else {
      items[items.length - 1].push(tk);
    }
  }

  if (items.length <= 1) return null;

  const baseIndent = indentStr(level, o);
  const itemIndent = indentStr(level + 1, o);
  const prefixText = renderTokensInline(prefixToks, o);
  const spaceBeforeParen =
    prefixToks.length > 0 && prefixToks[prefixToks.length - 1].type === 'word' ? ' ' : '';
  const openLine = `${baseIndent}${prefixText}${spaceBeforeParen}(`;

  const out: string[] = [openLine];
  for (let idx = 0; idx < items.length; idx++) {
    const piece = renderTokensInline(items[idx], o);
    const comma = idx < items.length - 1 ? ',' : '';
    out.push(`${itemIndent}${piece}${comma}`);
  }
  const tailText = tailToks.length > 0 ? ' ' + renderTokensInline(tailToks, o) : '';
  out.push(`${baseIndent})${tailText}${suffixText}`);
  return out;
}

/**
 * Wrap comma-separated settings entries (`hints "a", "b";` or `limits k = v, k2 = v2;`) when exceeding maxLineLength.
 */
function tryWrapCommaKeywordList(
  tokens: readonly XsodataToken[],
  level: number,
  suffixText: string,
  o: ResolvedFormatterOptions
): string[] | null {
  if (o.maxLineLength === 0 || tokens.length < 3) return null;
  const firstLow = tokens[0].text.toLowerCase();
  if (firstLow !== 'hints' && firstLow !== 'limits') return null;

  const items: XsodataToken[][] = [[]];
  for (let k = 1; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.text === ',') {
      items.push([]);
    } else {
      items[items.length - 1].push(tk);
    }
  }
  if (items.length <= 1) return null;

  const baseIndent = indentStr(level, o);
  const itemIndent = indentStr(level + 1, o);
  const out: string[] = [`${baseIndent}${tokens[0].text} ${renderTokensInline(items[0], o)},`];
  for (let idx = 1; idx < items.length; idx++) {
    const isLast = idx === items.length - 1;
    out.push(
      `${itemIndent}${renderTokensInline(items[idx], o)}${isLast ? suffixText : ','}`
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class XsRenderer {
  private readonly o: ResolvedFormatterOptions;
  private readonly out: string[] = [];

  constructor(o: ResolvedFormatterOptions) {
    this.o = o;
  }

  private emitBlanks(count: number): void {
    if (this.out.length === 0) return;
    for (let k = 0; k < count; k++) this.out.push('');
  }

  private trailingSuffix(c: XsCommentNode | undefined): string {
    if (!c) return '';
    return ' ' + normalizeCommentText(c.text, c.isLine, this.o);
  }

  renderDocument(items: readonly XsItem[]): string {
    let seenTopBlock = false;
    for (const item of items) {
      if (item.kind === 'block') {
        if (seenTopBlock) {
          this.emitBlanks(Math.max(1, clampBlankLines(item.nlBefore, this.o)));
        } else {
          this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
        }
        seenTopBlock = true;
        this.renderBlock(item, 0);
      } else {
        seenTopBlock = false;
        this.renderNonBlockItem(item, 0);
      }
    }
    return finalizeDocument(this.out, this.o);
  }

  private renderNonBlockItem(item: Exclude<XsItem, XsBlockNode>, level: number): void {
    if (item.kind === 'comment') {
      this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
      this.out.push(...renderCommentLines(item.text, item.isLine, level, this.o));
    } else if (item.kind === 'raw') {
      this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
      this.out.push(...item.text.replace(/\r\n?/g, '\n').split('\n'));
    } else {
      this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
      this.renderStatement(item, level);
    }
  }

  private renderBlock(block: XsBlockNode, level: number): void {
    const header = renderTokensInline(block.headerTokens, this.o);
    const ind = indentStr(level, this.o);
    const tc = this.trailingSuffix(block.headerTrailingComment);

    if (block.items.length === 0 && !block.unclosed) {
      this.out.push(`${ind}${header} {}${tc}`);
      return;
    }

    this.out.push(`${ind}${header} {${tc}`);
    for (const child of block.items) {
      if (child.kind === 'block') {
        this.emitBlanks(clampBlankLines(child.nlBefore, this.o));
        this.renderBlock(child, level + 1);
      } else {
        this.renderNonBlockItem(child, level + 1);
      }
    }
    if (!block.unclosed) {
      this.out.push(`${ind}}`);
    }
  }

  private renderStatement(stmt: XsStatementNode, level: number): void {
    if (stmt.tokens.length === 0) return;

    const ind = indentStr(level, this.o);
    const semi = stmt.hasSemicolon ? ';' : '';
    const tc = this.trailingSuffix(stmt.trailingComment);
    const endSuffix = `${semi}${tc}`;

    const firstCode = stmt.tokens.find((t) => !isTrivia(t));
    const isAssociation = firstCode?.type === 'word' && firstCode.text.toLowerCase() === 'association';
    const isTopServiceEntry =
      firstCode !== undefined &&
      (isAssociation || firstCode.type === 'string' || firstCode.type === 'sqstring');

    if (isTopServiceEntry) {
      const { head, clauses, hasModification, hasComments } = splitStatementClauses(
        stmt.tokens,
        isAssociation
      );
      const flat = `${ind}${renderTokensInline(stmt.tokens, this.o)}${endSuffix}`;
      const fits = this.o.maxLineLength === 0 || flat.length <= this.o.maxLineLength;
      const hadNewlines = stmt.tokens.some((t, idx) => idx > 0 && t.nlBefore > 0);

      const keepSingleLine =
        !hasComments &&
        !hasModification &&
        fits &&
        (isAssociation ? !hadNewlines || clauses.length === 0 : clauses.length <= 1);

      if (keepSingleLine) {
        this.out.push(flat);
        return;
      }

      if (clauses.length > 0) {
        const contLevel = level + 1;
        this.emitClauseChunk(head, level, clauses.length === 0 ? endSuffix : '', true);
        for (let idx = 0; idx < clauses.length; idx++) {
          const isLast = idx === clauses.length - 1;
          this.emitClauseChunk(clauses[idx], contLevel, isLast ? endSuffix : '', false);
        }
        return;
      }
    }

    // Standard entry (annotations / settings / short service entry / fallback)
    const flat = `${ind}${renderTokensInline(stmt.tokens, this.o)}${endSuffix}`;
    if (this.o.maxLineLength > 0 && flat.length > this.o.maxLineLength) {
      const wrappedParen = tryWrapParenListClause(stmt.tokens, level, endSuffix, this.o);
      if (wrappedParen) {
        this.out.push(...wrappedParen);
        return;
      }
      const wrappedComma = tryWrapCommaKeywordList(stmt.tokens, level, endSuffix, this.o);
      if (wrappedComma) {
        this.out.push(...wrappedComma);
        return;
      }
    }

    this.out.push(flat);
  }

  private emitClauseChunk(
    chunk: ClauseChunk,
    level: number,
    suffix: string,
    isHead: boolean
  ): void {
    const chunkComment = chunk.trailingComment
      ? ' ' + normalizeCommentText(chunk.trailingComment.text, chunk.trailingComment.type === 'lineComment', this.o)
      : '';
    const fullSuffix = `${suffix}${chunkComment}`;
    const ind = indentStr(level, this.o);

    // If the chunk contains standalone comments inside it, flush them cleanly line-by-line
    const hasEmbeddedComments = chunk.tokens.some((t) => isComment(t));
    if (!hasEmbeddedComments) {
      const line = `${ind}${renderTokensInline(chunk.tokens, this.o)}${fullSuffix}`;
      if (!isHead && this.o.maxLineLength > 0 && line.length > this.o.maxLineLength) {
        const wrapped = tryWrapParenListClause(chunk.tokens, level, fullSuffix, this.o);
        if (wrapped) {
          this.out.push(...wrapped);
          return;
        }
      }
      this.out.push(line);
      return;
    }

    // Chunk with embedded comments: emit standalone comment tokens cleanly, code tokens together
    let pendingCode: XsodataToken[] = [];
    let suffixEmitted = false;
    const flushPending = (final: boolean): void => {
      if (pendingCode.length === 0) return;
      const sfx = final && !suffixEmitted ? fullSuffix : '';
      if (sfx) suffixEmitted = true;
      const line = `${ind}${renderTokensInline(pendingCode, this.o)}${sfx}`;
      this.out.push(line);
      pendingCode = [];
    };

    for (let k = 0; k < chunk.tokens.length; k++) {
      const tk = chunk.tokens[k];
      if (isComment(tk)) {
        if (tk.nlBefore === 0 && pendingCode.length > 0) {
          const isFinalChunk = !chunk.tokens.slice(k + 1).some((x) => !isTrivia(x));
          const sfx = isFinalChunk && !suffixEmitted ? fullSuffix : '';
          if (sfx) suffixEmitted = true;
          const line =
            `${ind}${renderTokensInline(pendingCode, this.o)}` +
            sfx +
            ' ' +
            normalizeCommentText(tk.text, tk.type === 'lineComment', this.o);
          this.out.push(line);
          pendingCode = [];
        } else {
          flushPending(false);
          this.out.push(...renderCommentLines(tk.text, tk.type === 'lineComment', level, this.o));
        }
      } else {
        pendingCode.push(tk);
      }
    }
    flushPending(true);
    if (!suffixEmitted && fullSuffix.trim() !== '') {
      this.out.push(`${ind}${fullSuffix.trimStart()}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function formatXsodata(
  text: string,
  userOptions?: PartialFormatterOptions | ResolvedFormatterOptions,
  editor?: EditorOptions
): string {
  const o = resolveOptions(userOptions, editor);
  const tokens = xsodataTokenize(text);
  const parser = new XsParser(tokens);
  const ast = parser.parseDocument();
  return new XsRenderer(o).renderDocument(ast);
}
