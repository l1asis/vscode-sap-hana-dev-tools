import { format } from './formatter';
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
  scanLineCommentEnd,
} from './shared';

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

export type KvTokenType =
  | 'ident'
  | 'number'
  | 'string'
  | 'punct'
  | 'lineComment'
  | 'blockComment'
  | 'other'
  | 'raw';

export interface KvToken {
  readonly type: KvTokenType;
  readonly text: string;
  readonly nlBefore: number;
  readonly wsBefore: boolean;
  readonly start: number;
  readonly end: number;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

export function kvTokenize(text: string): KvToken[] {
  const tokens: KvToken[] = [];
  const n = text.length;
  let i = 0;
  let nl = 0;
  let ws = false;

  const push = (type: KvTokenType, start: number, end: number): void => {
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
      const end = scanBackslashStringEnd(text, i, '"');
      push('string', i, end);
      i = end;
      continue;
    }

    if (
      DIGIT.test(ch) ||
      ((ch === '-' || ch === '+') && DIGIT.test(text[i + 1] || ''))
    ) {
      let j = i + 1;
      while (j < n && DIGIT.test(text[j])) j++;
      if (text[j] === '.' && DIGIT.test(text[j + 1] || '')) {
        j++;
        while (j < n && DIGIT.test(text[j])) j++;
      }
      if (
        (text[j] === 'e' || text[j] === 'E') &&
        (DIGIT.test(text[j + 1] || '') ||
          ((text[j + 1] === '+' || text[j + 1] === '-') && DIGIT.test(text[j + 2] || '')))
      ) {
        j += 2;
        while (j < n && DIGIT.test(text[j])) j++;
      }
      push('number', i, j);
      i = j;
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(text[j])) j++;
      push('ident', i, j);
      i = j;
      continue;
    }

    if ('=:;,.{}[]'.includes(ch)) {
      push('punct', i, i + 1);
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
// AST Nodes (Discriminated Unions)
// ---------------------------------------------------------------------------

export interface KvCommentNode {
  readonly kind: 'comment';
  readonly text: string;
  readonly isLine: boolean;
  readonly nlBefore: number;
}

export interface KvRawNode {
  readonly kind: 'raw';
  readonly text: string;
  readonly nlBefore: number;
}

export type KvTriviaNode = KvCommentNode | KvRawNode;

export interface KvMalformedNode {
  readonly kind: 'malformed';
  readonly text: string;
  readonly leadingComments: KvTriviaNode[];
  readonly nlBefore: number;
}

export interface KvStringValue {
  readonly kind: 'string';
  readonly raw: string;
}

export interface KvNumberValue {
  readonly kind: 'number';
  readonly raw: string;
}

export interface KvIdentValue {
  readonly kind: 'ident';
  readonly text: string;
}

export interface KvPairValue {
  readonly kind: 'pair';
  readonly key: KvValueNode;
  readonly value: KvValueNode;
}

export interface KvArrayItem {
  readonly value: KvValueNode;
  readonly leadingComments: KvTriviaNode[];
  readonly trailingComment?: KvCommentNode;
}

export interface KvArrayValue {
  readonly kind: 'array';
  readonly items: KvArrayItem[];
  readonly trailingComments: KvTriviaNode[];
  readonly unclosed: boolean;
}

export interface KvStructField {
  readonly kind: 'field';
  readonly keyPath: string[];
  readonly value: KvValueNode;
  readonly hasSemi: boolean;
  readonly leadingComments: KvTriviaNode[];
  readonly trailingComment?: KvCommentNode;
}

export type KvStructMember = KvStructField | KvMalformedNode;

export interface KvStructValue {
  readonly kind: 'struct';
  readonly members: KvStructMember[];
  readonly trailingComments: KvTriviaNode[];
  readonly unclosed: boolean;
}

export interface KvRawExprValue {
  readonly kind: 'rawExpr';
  readonly text: string;
}

export type KvValueNode =
  | KvStringValue
  | KvNumberValue
  | KvIdentValue
  | KvPairValue
  | KvArrayValue
  | KvStructValue
  | KvRawExprValue;

export interface KvAssignmentNode {
  readonly kind: 'assignment';
  readonly keyPath: string[];
  readonly value: KvValueNode;
  readonly hasSemi: boolean;
  readonly nlBefore: number;
  readonly leadingComments: KvTriviaNode[];
  readonly trailingComment?: KvCommentNode;
}

export type KvTopItem = KvAssignmentNode | KvCommentNode | KvRawNode | KvMalformedNode;

export interface KvDocument {
  readonly kind: 'document';
  readonly items: KvTopItem[];
}

// ---------------------------------------------------------------------------
// Tolerant AST Parser
// ---------------------------------------------------------------------------

function isTrivia(t: KvToken | undefined): boolean {
  return !!t && (t.type === 'lineComment' || t.type === 'blockComment' || t.type === 'raw');
}

function toTriviaNode(t: KvToken): KvTriviaNode {
  if (t.type === 'raw') {
    return { kind: 'raw', text: t.text, nlBefore: t.nlBefore };
  }
  return {
    kind: 'comment',
    text: t.text,
    isLine: t.type === 'lineComment',
    nlBefore: t.nlBefore,
  };
}

class KvParser {
  private readonly t: readonly KvToken[];
  private readonly src: string;
  private i = 0;

  constructor(tokens: readonly KvToken[], src: string) {
    this.t = tokens;
    this.src = src;
  }

  private peek(offset = 0): KvToken | undefined {
    return this.t[this.i + offset];
  }

  private nextNonTriviaOffset(from = this.i): number {
    let k = from;
    while (k < this.t.length && isTrivia(this.t[k])) k++;
    return k;
  }

  private collectTrivia(): KvTriviaNode[] {
    const trivia: KvTriviaNode[] = [];
    while (this.i < this.t.length && isTrivia(this.t[this.i])) {
      trivia.push(toTriviaNode(this.t[this.i]));
      this.i++;
    }
    return trivia;
  }

  private collectInlineTrailingComment(): KvCommentNode | undefined {
    const nx = this.peek();
    if (nx && (nx.type === 'lineComment' || nx.type === 'blockComment') && nx.nlBefore === 0) {
      this.i++;
      return {
        kind: 'comment',
        text: nx.text,
        isLine: nx.type === 'lineComment',
        nlBefore: 0,
      };
    }
    return undefined;
  }

  /**
   * Check whether tokens starting at `pos` match `ident ('.' ident)* '='`,
   * ignoring trivia between path parts. Returns token index of `'='` or -1.
   */
  private matchAssignmentAt(pos: number): { eqIdx: number; keyPath: string[]; afterEq: number } | null {
    let k = this.nextNonTriviaOffset(pos);
    const first = this.t[k];
    if (!first || first.type !== 'ident') return null;
    const keyPath: string[] = [first.text];
    k++;
    for (;;) {
      const dotPos = this.nextNonTriviaOffset(k);
      const dot = this.t[dotPos];
      if (!dot || dot.text !== '.') break;
      const segPos = this.nextNonTriviaOffset(dotPos + 1);
      const seg = this.t[segPos];
      if (!seg || seg.type !== 'ident') return null;
      keyPath.push(seg.text);
      k = segPos + 1;
    }
    const eqPos = this.nextNonTriviaOffset(k);
    const eq = this.t[eqPos];
    if (!eq || eq.text !== '=') return null;
    return { eqIdx: eqPos, keyPath, afterEq: eqPos + 1 };
  }

  parseDocument(): KvDocument {
    const items: KvTopItem[] = [];
    while (this.i < this.t.length) {
      const trivia = this.collectTrivia();
      if (this.i >= this.t.length) {
        for (const tr of trivia) items.push(tr);
        break;
      }

      const match = this.matchAssignmentAt(this.i);
      if (match) {
        const nlBefore = this.t[this.i].nlBefore;
        this.i = match.afterEq;
        const value = this.parseTopValue();
        const { hasSemi, trailingComment } = this.consumeOptionalSemi();
        items.push({
          kind: 'assignment',
          keyPath: match.keyPath,
          value,
          hasSemi,
          nlBefore,
          leadingComments: trivia,
          trailingComment,
        });
        continue;
      }

      // Malformed recovery: gather until ';' or next assignment start or EOF
      const startTok = this.t[this.i];
      let endOffset = startTok.end;
      this.i++;
      while (this.i < this.t.length) {
        const cur = this.t[this.i];
        if (cur.type === 'raw') break;
        if (this.matchAssignmentAt(this.i)) break;
        if (cur.text === ';') {
          endOffset = cur.end;
          this.i++;
          break;
        }
        if (cur.nlBefore > 0 && isTrivia(cur)) break;
        endOffset = cur.end;
        this.i++;
      }
      items.push({
        kind: 'malformed',
        text: this.src.slice(startTok.start, endOffset).trimEnd(),
        leadingComments: trivia,
        nlBefore: startTok.nlBefore,
      });
    }
    return { kind: 'document', items };
  }

  private consumeOptionalSemi(): { hasSemi: boolean; trailingComment?: KvCommentNode } {
    const k = this.nextNonTriviaOffset(this.i);
    if (k < this.t.length && this.t[k].text === ';' && k === this.i) {
      this.i++;
      return { hasSemi: true, trailingComment: this.collectInlineTrailingComment() };
    }
    if (k < this.t.length && this.t[k].text === ';') {
      // Only consume ';' across inline comments
      let allInline = true;
      for (let m = this.i; m < k; m++) {
        if (this.t[m].nlBefore > 0 || this.t[m].type === 'raw') {
          allInline = false;
          break;
        }
      }
      if (allInline) {
        this.i = k + 1;
        return { hasSemi: true, trailingComment: this.collectInlineTrailingComment() };
      }
    }
    return { hasSemi: false, trailingComment: this.collectInlineTrailingComment() };
  }

  private parseTopValue(): KvValueNode {
    const first = this.parseValue(false);
    // Support SAP docs unbracketed comma-separated list in .hdbview: depends_on = "a", "b";
    const nextPos = this.nextNonTriviaOffset(this.i);
    if (nextPos === this.i && this.t[nextPos] && this.t[nextPos].text === ',') {
      const items: KvArrayItem[] = [{ value: first, leadingComments: [] }];
      while (this.i < this.t.length) {
        const commaPos = this.nextNonTriviaOffset(this.i);
        if (!this.t[commaPos] || this.t[commaPos].text !== ',') break;
        this.i = commaPos + 1;
        const itemTrivia = this.collectTrivia();
        const k = this.nextNonTriviaOffset(this.i);
        if (k >= this.t.length || this.t[k].text === ';') break;
        const val = this.parseValue(false);
        const tc = this.collectInlineTrailingComment();
        items.push({ value: val, leadingComments: itemTrivia, trailingComment: tc });
      }
      return { kind: 'array', items, trailingComments: [], unclosed: false };
    }
    return first;
  }

  private parseValue(allowPair: boolean): KvValueNode {
    const pos = this.nextNonTriviaOffset(this.i);
    // Do not jump past newlines/comments into an unrelated statement if value is missing
    if (pos >= this.t.length) {
      return { kind: 'rawExpr', text: '' };
    }
    this.i = pos;
    const tok = this.t[this.i];
    if (tok.text === ';') {
      return { kind: 'rawExpr', text: '' };
    }
    if (tok.text === '[') return this.parseArray();
    if (tok.text === '{') return this.parseStruct();

    let base: KvValueNode;
    if (tok.type === 'string') {
      this.i++;
      base = { kind: 'string', raw: tok.text };
    } else if (tok.type === 'number') {
      this.i++;
      base = { kind: 'number', raw: tok.text };
    } else if (tok.type === 'ident') {
      // Stop if this starts a new assignment (recovery for missing value)
      if (this.matchAssignmentAt(this.i)) {
        return { kind: 'rawExpr', text: '' };
      }
      this.i++;
      base = { kind: 'ident', text: tok.text };
    } else {
      // Malformed expression tokens until delimiter
      const start = tok.start;
      let end = tok.end;
      this.i++;
      while (this.i < this.t.length) {
        const cur = this.t[this.i];
        if (
          cur.text === ';' ||
          cur.text === ',' ||
          cur.text === '}' ||
          cur.text === ']' ||
          cur.type === 'raw' ||
          this.matchAssignmentAt(this.i)
        ) {
          break;
        }
        end = cur.end;
        this.i++;
      }
      return { kind: 'rawExpr', text: this.src.slice(start, end).trim() };
    }

    if (allowPair) {
      const colonPos = this.nextNonTriviaOffset(this.i);
      if (colonPos < this.t.length && this.t[colonPos].text === ':') {
        this.i = colonPos + 1;
        const rhs = this.parseValue(false);
        return { kind: 'pair', key: base, value: rhs };
      }
    }
    return base;
  }

  private parseArray(): KvArrayValue {
    this.i++; // consume '['
    const items: KvArrayItem[] = [];
    let trailingComments: KvTriviaNode[] = [];
    let unclosed = true;

    while (this.i < this.t.length) {
      const leading = this.collectTrivia();
      if (this.i >= this.t.length) {
        trailingComments = leading;
        break;
      }
      const cur = this.t[this.i];
      if (cur.text === ']') {
        this.i++;
        trailingComments = leading;
        unclosed = false;
        break;
      }
      if (cur.text === ';') {
        // Recover missing ']' before ';'
        trailingComments = leading;
        break;
      }
      if (cur.text === ',') {
        // Stray/duplicate comma
        this.i++;
        if (leading.length) trailingComments.push(...leading);
        continue;
      }

      const val = this.parseValue(true);
      let tc = this.collectInlineTrailingComment();
      const commaPos = this.nextNonTriviaOffset(this.i);
      if (commaPos < this.t.length && this.t[commaPos].text === ',') {
        // Consume comma if only inline trivia precedes it
        let inlineOk = true;
        for (let m = this.i; m < commaPos; m++) {
          if (this.t[m].nlBefore > 0 || this.t[m].type === 'raw') {
            inlineOk = false;
            break;
          }
        }
        if (inlineOk) {
          this.i = commaPos + 1;
          if (!tc) tc = this.collectInlineTrailingComment();
        }
      }
      items.push({ value: val, leadingComments: leading, trailingComment: tc });
    }

    return { kind: 'array', items, trailingComments, unclosed };
  }

  private parseStruct(): KvStructValue {
    this.i++; // consume '{'
    const members: KvStructMember[] = [];
    let trailingComments: KvTriviaNode[] = [];
    let unclosed = true;

    while (this.i < this.t.length) {
      const leading = this.collectTrivia();
      if (this.i >= this.t.length) {
        trailingComments = leading;
        break;
      }
      const cur = this.t[this.i];
      if (cur.text === '}') {
        this.i++;
        trailingComments = leading;
        unclosed = false;
        break;
      }
      if (cur.text === ']') {
        // Recover missing '}' before enclosing ']'
        trailingComments = leading;
        break;
      }

      const match = this.matchAssignmentAt(this.i);
      if (match) {
        this.i = match.afterEq;
        const val = this.parseValue(false);
        const { hasSemi, trailingComment } = this.consumeOptionalSemi();
        members.push({
          kind: 'field',
          keyPath: match.keyPath,
          value: val,
          hasSemi,
          leadingComments: leading,
          trailingComment,
        });
        continue;
      }

      // Malformed member inside struct
      const startTok = cur;
      let endOffset = cur.end;
      this.i++;
      while (this.i < this.t.length) {
        const nx = this.t[this.i];
        if (nx.text === '}' || nx.text === ']' || nx.type === 'raw' || this.matchAssignmentAt(this.i)) break;
        if (nx.text === ';') {
          endOffset = nx.end;
          this.i++;
          break;
        }
        endOffset = nx.end;
        this.i++;
      }
      members.push({
        kind: 'malformed',
        text: this.src.slice(startTok.start, endOffset).trimEnd(),
        leadingComments: leading,
        nlBefore: startTok.nlBefore,
      });
    }

    return { kind: 'struct', members, trailingComments, unclosed };
  }
}

// ---------------------------------------------------------------------------
// Embedded SQL String Formatting (.hdbview query / .hdbsequence reset_by)
// ---------------------------------------------------------------------------

function unescapeKvString(inner: string): string {
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== '\\' || i + 1 >= inner.length) {
      out += ch;
      continue;
    }
    const nx = inner[i + 1];
    switch (nx) {
      case '"':
        out += '"';
        i++;
        break;
      case '\\':
        out += '\\';
        i++;
        break;
      case 'n':
        out += '\n';
        i++;
        break;
      case 'r':
        out += '\r';
        i++;
        break;
      case 't':
        out += '\t';
        i++;
        break;
      case 'b':
        out += '\b';
        i++;
        break;
      case 'f':
        out += '\f';
        i++;
        break;
      case '/':
        out += '/';
        i++;
        break;
      default:
        out += ch;
        break;
    }
  }
  return out;
}

function escapeKvString(sql: string): string {
  return sql.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatEmbeddedSqlLiteral(
  rawLiteral: string,
  keyStr: string,
  level: number,
  o: ResolvedFormatterOptions,
  editor: EditorOptions
): string | null {
  if (rawLiteral.length < 2 || !rawLiteral.startsWith('"') || !rawLiteral.endsWith('"')) {
    return null;
  }
  // Avoid touching unclosed or trivially empty string literals
  const inner = rawLiteral.slice(1, -1);
  const unescaped = unescapeKvString(inner);
  if (unescaped.trim() === '') return '""';

  try {
    const sqlOpts: ResolvedFormatterOptions = {
      ...o,
      trailingSemicolon: 'remove',
      insertFinalNewline: false,
      endOfLine: 'lf',
      eol: '\n',
    };
    const sql0 = format(unescaped, sqlOpts, { ...editor, eol: '\n' }, { initialLevel: 0 });
    if (!sql0) return '""';
    const esc0 = escapeKvString(sql0);
    const singleLineLen = level * o.indentWidth + keyStr.length + 3 + esc0.length + 2; // ` = "...";`
    if (!esc0.includes('\n') && (o.maxLineLength === 0 || singleLineLen <= o.maxLineLength)) {
      return `"${esc0}"`;
    }
    const sqlIndented = format(
      unescaped,
      sqlOpts,
      { ...editor, eol: '\n' },
      { initialLevel: level + 1 }
    );
    const escMulti = escapeKvString(sqlIndented);
    return `"\n${escMulti}\n${indentStr(level, o)}"`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class KvRenderer {
  private readonly o: ResolvedFormatterOptions;
  private readonly editor: EditorOptions;
  private readonly out: string[] = [];

  constructor(o: ResolvedFormatterOptions, editor: EditorOptions) {
    this.o = o;
    this.editor = editor;
  }

  private emitBlanks(count: number): void {
    if (this.out.length === 0) return;
    for (let k = 0; k < count; k++) this.out.push('');
  }

  private emitTrivia(trivia: readonly KvTriviaNode[], level: number): void {
    for (const tr of trivia) {
      this.emitBlanks(clampBlankLines(tr.nlBefore, this.o));
      if (tr.kind === 'raw') {
        this.out.push(...tr.text.replace(/\r\n?/g, '\n').split('\n'));
      } else {
        this.out.push(...renderCommentLines(tr.text, tr.isLine, level, this.o));
      }
    }
  }

  private trailingSuffix(tc: KvCommentNode | undefined): string {
    if (!tc) return '';
    return ' ' + normalizeCommentText(tc.text, tc.isLine, this.o);
  }

  renderDocument(doc: KvDocument): string {
    for (const item of doc.items) {
      if (item.kind === 'comment') {
        this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
        this.out.push(...renderCommentLines(item.text, item.isLine, 0, this.o));
      } else if (item.kind === 'raw') {
        this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
        this.out.push(...item.text.replace(/\r\n?/g, '\n').split('\n'));
      } else if (item.kind === 'malformed') {
        this.emitTrivia(item.leadingComments, 0);
        this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
        this.out.push(...item.text.replace(/\r\n?/g, '\n').split('\n'));
      } else {
        this.emitTrivia(item.leadingComments, 0);
        this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
        this.renderAssignment(item, 0);
      }
    }
    return finalizeDocument(this.out, this.o);
  }

  private renderAssignment(node: KvAssignmentNode, level: number): void {
    const key = node.keyPath.join('.');
    const prefix = indentStr(level, this.o) + key + ' = ';

    if (
      level === 0 &&
      node.keyPath.length === 1 &&
      (node.keyPath[0] === 'query' || node.keyPath[0] === 'reset_by') &&
      node.value.kind === 'string'
    ) {
      const formattedSql = formatEmbeddedSqlLiteral(node.value.raw, key, level, this.o, this.editor);
      if (formattedSql !== null) {
        const lines = formattedSql.split('\n');
        if (lines.length === 1) {
          this.out.push(prefix + lines[0] + ';' + this.trailingSuffix(node.trailingComment));
        } else {
          this.out.push(prefix + lines[0]);
          for (let k = 1; k < lines.length - 1; k++) this.out.push(lines[k]);
          this.out.push(
            lines[lines.length - 1] + ';' + this.trailingSuffix(node.trailingComment)
          );
        }
        return;
      }
    }

    const forceMultiStruct = level === 0 && key === 'import';
    const valLines = this.renderValue(node.value, level, prefix.length, forceMultiStruct);
    if (valLines.length === 1) {
      this.out.push(prefix + valLines[0] + ';' + this.trailingSuffix(node.trailingComment));
    } else {
      this.out.push(prefix + valLines[0]);
      for (let k = 1; k < valLines.length - 1; k++) this.out.push(valLines[k]);
      this.out.push(valLines[valLines.length - 1] + ';' + this.trailingSuffix(node.trailingComment));
    }
  }

  private renderValue(
    val: KvValueNode,
    level: number,
    inlinePrefixLen: number,
    forceMultiStruct: boolean
  ): string[] {
    switch (val.kind) {
      case 'string':
        return [val.raw.replace(/\r\n?/g, '\n')];
      case 'number':
        return [val.raw];
      case 'ident':
        return [val.text];
      case 'rawExpr':
        return val.text ? [val.text] : [''];
      case 'pair': {
        const k = this.renderValue(val.key, level, inlinePrefixLen, false)[0];
        const v = this.renderValue(val.value, level, inlinePrefixLen, false)[0];
        return [`${k} : ${v}`];
      }
      case 'array':
        return this.renderArray(val, level, inlinePrefixLen, forceMultiStruct);
      case 'struct':
        return this.renderStruct(val, level, inlinePrefixLen, forceMultiStruct);
    }
  }

  private canRenderInlineScalar(v: KvValueNode): boolean {
    return (
      v.kind === 'string' ||
      v.kind === 'number' ||
      v.kind === 'ident' ||
      v.kind === 'pair' ||
      v.kind === 'rawExpr'
    );
  }

  private renderArray(
    arr: KvArrayValue,
    level: number,
    inlinePrefixLen: number,
    forceMultiStruct: boolean
  ): string[] {
    if (arr.items.length === 0 && arr.trailingComments.length === 0) {
      return [arr.unclosed ? '[' : '[]'];
    }

    const hasComments =
      arr.trailingComments.length > 0 ||
      arr.items.some((it) => it.leadingComments.length > 0 || !!it.trailingComment);
    const hasStruct = arr.items.some((it) => it.value.kind === 'struct');
    const allScalars = arr.items.every((it) => this.canRenderInlineScalar(it.value));

    if (!arr.unclosed && !hasComments && !hasStruct && allScalars) {
      const rendered = arr.items.map(
        (it) => this.renderValue(it.value, level, 0, false)[0]
      );
      const hasPairs = arr.items.some((it) => it.value.kind === 'pair');
      const inner = rendered.join(', ');
      const single = hasPairs ? `[ ${inner} ]` : `[${inner}]`;
      if (
        !single.includes('\n') &&
        (this.o.maxLineLength === 0 || inlinePrefixLen + single.length + 1 <= this.o.maxLineLength)
      ) {
        return [single];
      }
    }

    const lines: string[] = ['['];
    const itemIndent = indentStr(level + 1, this.o);
    for (let idx = 0; idx < arr.items.length; idx++) {
      const it = arr.items[idx];
      const comma = idx < arr.items.length - 1 ? ',' : '';
      for (const tr of it.leadingComments) {
        if (tr.kind === 'raw') {
          lines.push(...tr.text.replace(/\r\n?/g, '\n').split('\n'));
        } else {
          lines.push(...renderCommentLines(tr.text, tr.isLine, level + 1, this.o));
        }
      }
      const itemLines = this.renderValue(
        it.value,
        level + 1,
        itemIndent.length,
        forceMultiStruct
      );
      if (itemLines.length === 1) {
        lines.push(
          itemIndent + itemLines[0] + comma + this.trailingSuffix(it.trailingComment)
        );
      } else {
        lines.push(itemIndent + itemLines[0]);
        for (let k = 1; k < itemLines.length - 1; k++) lines.push(itemLines[k]);
        lines.push(
          itemLines[itemLines.length - 1] + comma + this.trailingSuffix(it.trailingComment)
        );
      }
    }
    for (const tr of arr.trailingComments) {
      if (tr.kind === 'raw') {
        lines.push(...tr.text.replace(/\r\n?/g, '\n').split('\n'));
      } else {
        lines.push(...renderCommentLines(tr.text, tr.isLine, level + 1, this.o));
      }
    }
    if (!arr.unclosed) lines.push(indentStr(level, this.o) + ']');
    return lines;
  }

  private renderStruct(
    st: KvStructValue,
    level: number,
    inlinePrefixLen: number,
    forceMulti: boolean
  ): string[] {
    if (st.members.length === 0 && st.trailingComments.length === 0) {
      return [st.unclosed ? '{' : '{}'];
    }

    const hasCommentsOrMalformed =
      st.trailingComments.length > 0 ||
      st.members.some(
        (m) =>
          m.kind === 'malformed' ||
          m.leadingComments.length > 0 ||
          !!m.trailingComment
      );

    if (!forceMulti && !st.unclosed && !hasCommentsOrMalformed) {
      const parts: string[] = [];
      let allSingle = true;
      for (const m of st.members) {
        if (m.kind !== 'field') {
          allSingle = false;
          break;
        }
        const vLines = this.renderValue(m.value, level + 1, 0, false);
        if (vLines.length > 1 || vLines[0].includes('\n')) {
          allSingle = false;
          break;
        }
        parts.push(`${m.keyPath.join('.')} = ${vLines[0]};`);
      }
      if (allSingle) {
        const single = `{ ${parts.join(' ')} }`;
        if (
          this.o.maxLineLength === 0 ||
          inlinePrefixLen + single.length + 1 <= this.o.maxLineLength
        ) {
          return [single];
        }
      }
    }

    const lines: string[] = ['{'];
    const fieldIndent = indentStr(level + 1, this.o);
    for (const m of st.members) {
      for (const tr of m.leadingComments) {
        if (tr.kind === 'raw') {
          lines.push(...tr.text.replace(/\r\n?/g, '\n').split('\n'));
        } else {
          lines.push(...renderCommentLines(tr.text, tr.isLine, level + 1, this.o));
        }
      }
      if (m.kind === 'malformed') {
        lines.push(
          ...m.text
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((l) => (l.trim() ? fieldIndent + l.trimStart() : ''))
        );
        continue;
      }
      const keyPrefix = fieldIndent + m.keyPath.join('.') + ' = ';
      const vLines = this.renderValue(m.value, level + 1, keyPrefix.length, false);
      if (vLines.length === 1) {
        lines.push(keyPrefix + vLines[0] + ';' + this.trailingSuffix(m.trailingComment));
      } else {
        lines.push(keyPrefix + vLines[0]);
        for (let k = 1; k < vLines.length - 1; k++) lines.push(vLines[k]);
        lines.push(
          vLines[vLines.length - 1] + ';' + this.trailingSuffix(m.trailingComment)
        );
      }
    }
    for (const tr of st.trailingComments) {
      if (tr.kind === 'raw') {
        lines.push(...tr.text.replace(/\r\n?/g, '\n').split('\n'));
      } else {
        lines.push(...renderCommentLines(tr.text, tr.isLine, level + 1, this.o));
      }
    }
    if (!st.unclosed) lines.push(indentStr(level, this.o) + '}');
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an XS Classic key-value design-time artifact into its tolerant AST.
 */
export function parseClassicKv(text: string): KvDocument {
  const tokens = kvTokenize(text);
  if (tokens.length === 0) return { kind: 'document', items: [] };
  return new KvParser(tokens, text).parseDocument();
}

/**
 * Format an XS Classic key-value design-time artifact
 * (`.hdbtable`, `.hdbstructure`, `.hdbview`, `.hdbsequence`, `.hdbschema`, `.hdbti`).
 */
export function formatClassicKv(
  text: string,
  userOptions: PartialFormatterOptions | ResolvedFormatterOptions = {},
  editor: EditorOptions = {}
): string {
  const o =
    'listCtx' in userOptions && userOptions.listCtx instanceof Set
      ? userOptions
      : resolveOptions(userOptions, editor);
  const tokens = kvTokenize(text);
  if (tokens.length === 0) return '';
  const ast = new KvParser(tokens, text).parseDocument();
  return new KvRenderer(o, editor).renderDocument(ast);
}
