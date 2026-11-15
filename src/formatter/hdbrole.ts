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
  scanBlockCommentEnd,
  scanDoubledQuoteEnd,
  scanLineCommentEnd,
} from './shared';

// ---------------------------------------------------------------------------
// Sniffer (Classic XSC DSL vs HDI JSON)
// ---------------------------------------------------------------------------

function skipWsAndComments(text: string, pos: number): number {
  const n = text.length;
  let i = pos;
  while (i < n) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '\u00a0' || ch === '\ufeff') {
      i++;
      continue;
    }
    if ((ch === '/' && text[i + 1] === '/') || (ch === '-' && text[i + 1] === '-')) {
      i = scanLineCommentEnd(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i = scanBlockCommentEnd(text, i);
      continue;
    }
    break;
  }
  return i;
}

/**
 * Determine whether `.hdbrole` content uses XS Classic DSL (`role ... { ... }`)
 * rather than HDI JSON (`{ "role": { ... } }`).
 */
export function isClassicHdbrole(text: string): boolean {
  const i = skipWsAndComments(text, 0);
  if (i >= text.length) return false;
  if (text[i] === '{') {
    const inside = skipWsAndComments(text, i + 1);
    if (inside >= text.length) return false;
    // JSON object has quoted key or empty `{}`
    return text[inside] !== '"' && text[inside] !== '}';
  }
  return /^role\b/i.test(text.slice(i));
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

export type RoleTokenType =
  | 'word'
  | 'qident'
  | 'dcolon'
  | 'colon'
  | 'dot'
  | 'comma'
  | 'semi'
  | 'lbrace'
  | 'rbrace'
  | 'other'
  | 'lineComment'
  | 'blockComment'
  | 'raw';

export interface RoleToken {
  readonly type: RoleTokenType;
  readonly text: string;
  readonly nlBefore: number;
  readonly wsBefore: boolean;
  readonly start: number;
  readonly end: number;
}

const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[A-Za-z0-9_]/;

export function roleTokenize(text: string): RoleToken[] {
  const tokens: RoleToken[] = [];
  const n = text.length;
  let i = 0;
  let nl = 0;
  let ws = false;

  const push = (type: RoleTokenType, start: number, end: number): void => {
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

    if ((ch === '/' && text[i + 1] === '/') || (ch === '-' && text[i + 1] === '-')) {
      const end = scanLineCommentEnd(text, i);
      push('lineComment', i, end);
      i = end;
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      const end = scanBlockCommentEnd(text, i);
      push('blockComment', i, end);
      i = end;
      continue;
    }

    if (ch === '"') {
      const end = scanDoubledQuoteEnd(text, i, '"', true);
      push('qident', i, end);
      i = end;
      continue;
    }

    if (ch === ':' && text[i + 1] === ':') {
      push('dcolon', i, i + 2);
      i += 2;
      continue;
    }

    if (ch === ':') { push('colon', i, i + 1); i++; continue; }
    if (ch === '.') { push('dot', i, i + 1); i++; continue; }
    if (ch === ',') { push('comma', i, i + 1); i++; continue; }
    if (ch === ';') { push('semi', i, i + 1); i++; continue; }
    if (ch === '{') { push('lbrace', i, i + 1); i++; continue; }
    if (ch === '}') { push('rbrace', i, i + 1); i++; continue; }

    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < n && WORD_PART.test(text[j])) j++;
      push('word', i, j);
      i = j;
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
// AST & Parser
// ---------------------------------------------------------------------------

interface RoleTrivia {
  readonly kind: 'comment' | 'raw';
  readonly text: string;
  readonly isLine: boolean;
  readonly nlBefore: number;
}

interface RolePrivilegeStmt {
  readonly kind: 'stmt';
  readonly leadingTrivia: readonly RoleTrivia[];
  readonly nlBefore: number;
  readonly tokens: readonly RoleToken[];
  readonly hasSemicolon: boolean;
  readonly trailingComment?: RoleTrivia;
}

type RoleBodyItem = RolePrivilegeStmt | RoleTrivia;

interface RoleDoc {
  readonly leadingTrivia: readonly RoleTrivia[];
  readonly headerTokens: readonly RoleToken[];
  readonly hasOpenBrace: boolean;
  readonly braceTrailingComment?: RoleTrivia;
  readonly body: readonly RoleBodyItem[];
  readonly bodyTrailingTrivia: readonly RoleTrivia[];
  readonly hasCloseBrace: boolean;
  readonly postBraceTrivia: readonly RoleTrivia[];
}

function isComment(t: RoleToken): boolean {
  return t.type === 'lineComment' || t.type === 'blockComment';
}

function isTrivia(t: RoleToken): boolean {
  return isComment(t) || t.type === 'raw';
}

class RoleParser {
  private readonly t: readonly RoleToken[];
  private i = 0;

  constructor(tokens: readonly RoleToken[]) {
    this.t = tokens;
  }

  parse(): RoleDoc {
    const leadingTrivia = this.collectTrivia();
    const headerTokens: RoleToken[] = [];

    while (this.i < this.t.length && this.t[this.i].type !== 'lbrace') {
      headerTokens.push(this.t[this.i++]);
    }

    let hasOpenBrace = false;
    let braceTrailingComment: RoleTrivia | undefined;
    if (this.i < this.t.length && this.t[this.i].type === 'lbrace') {
      hasOpenBrace = true;
      this.i++;
      braceTrailingComment = this.consumeInlineComment();
    }

    const body: RoleBodyItem[] = [];
    let bodyTrailingTrivia: RoleTrivia[] = [];

    while (this.i < this.t.length) {
      const triv = this.collectTrivia();
      if (this.i >= this.t.length) {
        bodyTrailingTrivia = triv;
        break;
      }
      if (this.t[this.i].type === 'rbrace') {
        bodyTrailingTrivia = triv;
        break;
      }
      if (this.t[this.i].type === 'raw') {
        for (const t of triv) body.push(t);
        continue;
      }
      if (this.t[this.i].type === 'semi') {
        for (const t of triv) body.push(t);
        this.i++;
        continue;
      }

      const startTok = this.t[this.i];
      const stmtToks: RoleToken[] = [];
      let hasSemicolon = false;
      while (this.i < this.t.length) {
        const cur = this.t[this.i];
        if (cur.type === 'semi') {
          hasSemicolon = true;
          this.i++;
          break;
        }
        if (cur.type === 'rbrace' || cur.type === 'raw') {
          break;
        }
        stmtToks.push(cur);
        this.i++;
      }
      const tc = hasSemicolon ? this.consumeInlineComment() : undefined;
      body.push({
        kind: 'stmt',
        leadingTrivia: triv,
        nlBefore: startTok.nlBefore,
        tokens: stmtToks,
        hasSemicolon,
        trailingComment: tc,
      });
    }

    let hasCloseBrace = false;
    if (this.i < this.t.length && this.t[this.i].type === 'rbrace') {
      hasCloseBrace = true;
      this.i++;
    }

    const postBraceTrivia = this.collectTrivia();

    return {
      leadingTrivia,
      headerTokens,
      hasOpenBrace,
      braceTrailingComment,
      body,
      bodyTrailingTrivia,
      hasCloseBrace,
      postBraceTrivia,
    };
  }

  private collectTrivia(): RoleTrivia[] {
    const out: RoleTrivia[] = [];
    while (this.i < this.t.length && isTrivia(this.t[this.i])) {
      const tk = this.t[this.i++];
      out.push({
        kind: tk.type === 'raw' ? 'raw' : 'comment',
        text: tk.text,
        isLine: tk.type === 'lineComment',
        nlBefore: tk.nlBefore,
      });
    }
    return out;
  }

  private consumeInlineComment(): RoleTrivia | undefined {
    if (this.i >= this.t.length) return undefined;
    const tk = this.t[this.i];
    if (tk.nlBefore === 0 && isComment(tk)) {
      this.i++;
      return { kind: 'comment', text: tk.text, isLine: tk.type === 'lineComment', nlBefore: 0 };
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Determine the index of the `:` token separating target/kind from privileges/objects.
 * Prefix keywords (`system privilege:`, `analytic privilege:`, `catalog analytic privilege:`,
 * `application privilege:`) split on their first `:`; target-led statements split on their last `:`.
 */
function findPrivilegeSeparatorIndex(tokens: readonly RoleToken[]): number {
  const words = tokens
    .filter((t) => t.type === 'word')
    .slice(0, 3)
    .map((t) => t.text.toLowerCase());

  const isPrefixPriv =
    (words[0] === 'system' && words[1] === 'privilege') ||
    (words[0] === 'analytic' && words[1] === 'privilege') ||
    (words[0] === 'application' && words[1] === 'privilege') ||
    (words[0] === 'catalog' && words[1] === 'analytic' && words[2] === 'privilege');

  if (isPrefixPriv) {
    return tokens.findIndex((t) => t.type === 'colon');
  }

  for (let k = tokens.length - 1; k >= 0; k--) {
    if (tokens[k].type === 'colon') return k;
  }
  return -1;
}

function renderTokenSequence(
  tokens: readonly RoleToken[],
  sepColonIndex: number,
  o: ResolvedFormatterOptions
): string {
  let out = '';
  let prev: RoleToken | null = null;
  let prevIdx = -1;

  for (let idx = 0; idx < tokens.length; idx++) {
    const tk = tokens[idx];
    if (isComment(tk)) {
      const norm = normalizeCommentText(tk.text, tk.type === 'lineComment', o);
      out += (out.length > 0 ? ' ' : '') + norm;
      prev = tk;
      prevIdx = idx;
      continue;
    }

    let needSpace = false;
    if (prev) {
      if (isComment(prev)) {
        needSpace = true;
      } else if (tk.type === 'dcolon' || prev.type === 'dcolon') {
        needSpace = false;
      } else if (tk.type === 'dot' || prev.type === 'dot') {
        needSpace = false;
      } else if (tk.type === 'comma') {
        needSpace = false;
      } else if (prev.type === 'comma') {
        needSpace = true;
      } else if (tk.type === 'colon') {
        needSpace = idx !== sepColonIndex && tk.wsBefore;
      } else if (prev.type === 'colon') {
        needSpace = prevIdx === sepColonIndex || tk.wsBefore;
      } else {
        needSpace = true;
      }
    }

    if (needSpace) out += ' ';
    out += tk.text;
    prev = tk;
    prevIdx = idx;
  }

  return out;
}

class RoleRenderer {
  private readonly o: ResolvedFormatterOptions;
  private readonly out: string[] = [];

  constructor(o: ResolvedFormatterOptions) {
    this.o = o;
  }

  private emitBlanks(count: number): void {
    if (this.out.length === 0) return;
    for (let k = 0; k < count; k++) this.out.push('');
  }

  private emitTrivia(trivia: readonly RoleTrivia[], level: number): void {
    for (const tr of trivia) {
      this.emitBlanks(clampBlankLines(tr.nlBefore, this.o));
      if (tr.kind === 'raw') {
        this.out.push(...tr.text.replace(/\r\n?/g, '\n').split('\n'));
      } else {
        this.out.push(...renderCommentLines(tr.text, tr.isLine, level, this.o));
      }
    }
  }

  private trailingSuffix(tc: RoleTrivia | undefined): string {
    if (!tc) return '';
    return ' ' + normalizeCommentText(tc.text, tc.isLine, this.o);
  }

  render(doc: RoleDoc): string {
    this.emitTrivia(doc.leadingTrivia, 0);

    // Header: split on top-level `extends` clauses so `role ...` and `extends ...` stack cleanly
    const headerLines = this.formatHeaderLines(doc.headerTokens);
    const tc = this.trailingSuffix(doc.braceTrailingComment);

    if (headerLines.length === 0) {
      if (doc.hasOpenBrace) this.out.push(`{${tc}`);
    } else {
      for (let k = 0; k < headerLines.length - 1; k++) {
        this.out.push(headerLines[k]);
      }
      const lastHdr = headerLines[headerLines.length - 1];
      this.out.push(doc.hasOpenBrace ? `${lastHdr} {${tc}` : lastHdr);
    }

    const bodyLevel = doc.hasOpenBrace ? 1 : 0;
    for (const item of doc.body) {
      if (item.kind === 'stmt') {
        this.emitTrivia(item.leadingTrivia, bodyLevel);
        this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
        this.renderPrivilegeStmt(item, bodyLevel);
      } else {
        this.emitTrivia([item], bodyLevel);
      }
    }

    this.emitTrivia(doc.bodyTrailingTrivia, bodyLevel);
    if (doc.hasCloseBrace) {
      this.out.push('}');
    }
    this.emitTrivia(doc.postBraceTrivia, 0);
    return finalizeDocument(this.out, this.o);
  }

  private formatHeaderLines(headerTokens: readonly RoleToken[]): string[] {
    if (headerTokens.length === 0) return [];
    const chunks: RoleToken[][] = [[]];
    for (const tk of headerTokens) {
      if (isComment(tk)) {
        chunks[chunks.length - 1].push(tk);
        continue;
      }
      if (tk.type === 'word' && tk.text.toLowerCase() === 'extends' && chunks[chunks.length - 1].length > 0) {
        chunks.push([tk]);
      } else {
        chunks[chunks.length - 1].push(tk);
      }
    }
    return chunks.map((c) => renderTokenSequence(c, -1, this.o));
  }

  private renderPrivilegeStmt(stmt: RolePrivilegeStmt, level: number): void {
    const ind = indentStr(level, this.o);
    const semi = stmt.hasSemicolon ? ';' : '';
    const tc = this.trailingSuffix(stmt.trailingComment);
    const hasEmbeddedComments = stmt.tokens.some((t) => isTrivia(t));
    const sepIdx = findPrivilegeSeparatorIndex(stmt.tokens);

    if (!hasEmbeddedComments) {
      const flat = `${ind}${renderTokenSequence(stmt.tokens, sepIdx, this.o)}${semi}${tc}`;
      if (this.o.maxLineLength === 0 || flat.length <= this.o.maxLineLength) {
        this.out.push(flat);
        return;
      }

      // Wrap long privilege lines at commas with +1 continuation indent
      const wrapped = this.tryWrapAtCommas(stmt.tokens, sepIdx, level, semi, tc);
      if (wrapped) {
        this.out.push(...wrapped);
        return;
      }
      this.out.push(flat);
      return;
    }

    // Preserve standalone comments inside multi-line statements cleanly
    let curLine = ind;
    let curTokens: RoleToken[] = [];
    let semiEmitted = false;
    const flushCode = (isFinal: boolean): void => {
      if (curTokens.length === 0) return;
      const body = renderTokenSequence(
        curTokens,
        sepIdx >= 0 && curTokens.includes(stmt.tokens[sepIdx]) ? curTokens.indexOf(stmt.tokens[sepIdx]) : -1,
        this.o
      );
      const sfx = isFinal && !semiEmitted ? `${semi}${tc}` : '';
      if (sfx) semiEmitted = true;
      this.out.push(`${curLine}${body}${sfx}`);
      curTokens = [];
      curLine = indentStr(level + 1, this.o);
    };

    for (let idx = 0; idx < stmt.tokens.length; idx++) {
      const tk = stmt.tokens[idx];
      if (tk.type === 'raw') {
        flushCode(false);
        this.out.push(...tk.text.replace(/\r\n?/g, '\n').split('\n'));
      } else if (isComment(tk)) {
        if (tk.nlBefore === 0 && curTokens.length > 0) {
          const isFinal = !stmt.tokens.slice(idx + 1).some((x) => !isTrivia(x));
          const body = renderTokenSequence(
            curTokens,
            sepIdx >= 0 && curTokens.includes(stmt.tokens[sepIdx]) ? curTokens.indexOf(stmt.tokens[sepIdx]) : -1,
            this.o
          );
          const cmt = normalizeCommentText(tk.text, tk.type === 'lineComment', this.o);
          const sfx = isFinal && !semiEmitted ? semi : '';
          if (sfx) semiEmitted = true;
          this.out.push(`${curLine}${body}${sfx} ${cmt}`);
          curTokens = [];
          curLine = indentStr(level + 1, this.o);
        } else {
          flushCode(false);
          this.out.push(...renderCommentLines(tk.text, tk.type === 'lineComment', level, this.o));
        }
      } else {
        curTokens.push(tk);
      }
    }
    flushCode(true);
    if (!semiEmitted && (semi || tc)) {
      this.out.push(`${ind}${semi}${tc}`);
    }
  }

  private tryWrapAtCommas(
    tokens: readonly RoleToken[],
    sepIdx: number,
    level: number,
    semi: string,
    tc: string
  ): string[] | null {
    const groups: { tokens: RoleToken[]; sepOffset: number }[] = [{ tokens: [], sepOffset: -1 }];
    for (let idx = 0; idx < tokens.length; idx++) {
      const tk = tokens[idx];
      if (tk.type === 'comma') {
        groups.push({ tokens: [], sepOffset: -1 });
      } else {
        const g = groups[groups.length - 1];
        if (idx === sepIdx) g.sepOffset = g.tokens.length;
        g.tokens.push(tk);
      }
    }
    if (groups.length <= 1) return null;

    const firstIndent = indentStr(level, this.o);
    const contIndent = indentStr(level + 1, this.o);
    const out: string[] = [];

    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      const prefix = k === 0 ? firstIndent : contIndent;
      const suffix = k < groups.length - 1 ? ',' : `${semi}${tc}`;
      out.push(`${prefix}${renderTokenSequence(g.tokens, g.sepOffset, this.o)}${suffix}`);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

export function formatClassicHdbrole(
  text: string,
  userOptions?: PartialFormatterOptions | ResolvedFormatterOptions,
  editor?: EditorOptions
): string {
  const o = resolveOptions(userOptions, editor);
  const tokens = roleTokenize(text);
  const ast = new RoleParser(tokens).parse();
  return new RoleRenderer(o).render(ast);
}
