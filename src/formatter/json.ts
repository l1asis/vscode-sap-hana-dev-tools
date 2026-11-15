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

export type JsonTokenType =
  | 'string'
  | 'number'
  | 'word'
  | 'punct'
  | 'lineComment'
  | 'blockComment'
  | 'other'
  | 'raw';

export interface JsonToken {
  readonly type: JsonTokenType;
  readonly text: string;
  readonly nlBefore: number;
  readonly wsBefore: boolean;
  readonly start: number;
  readonly end: number;
}

const DIGIT = /[0-9]/;
const WORD_START = /[A-Za-z_$]/;
const WORD_PART = /[A-Za-z0-9_$-]/;

export function jsonTokenize(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const n = text.length;
  let i = 0;
  let nl = 0;
  let ws = false;

  const push = (type: JsonTokenType, start: number, end: number): void => {
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

    if (ch === '/' && text[i + 1] === '/') {
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

    if (DIGIT.test(ch) || (ch === '-' && DIGIT.test(text[i + 1] || ''))) {
      let j = i + (ch === '-' ? 1 : 0);
      while (j < n && DIGIT.test(text[j])) j++;
      if (text[j] === '.' && DIGIT.test(text[j + 1] || '')) {
        j++;
        while (j < n && DIGIT.test(text[j])) j++;
      }
      if ((text[j] === 'e' || text[j] === 'E') && (DIGIT.test(text[j + 1] || '') || ((text[j + 1] === '+' || text[j + 1] === '-') && DIGIT.test(text[j + 2] || '')))) {
        j++;
        if (text[j] === '+' || text[j] === '-') j++;
        while (j < n && DIGIT.test(text[j])) j++;
      }
      push('number', i, j);
      i = j;
      continue;
    }

    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < n && WORD_PART.test(text[j])) j++;
      push('word', i, j);
      i = j;
      continue;
    }

    if ('{}[]:,'.includes(ch)) {
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
// AST Nodes & Tolerant Parser
// ---------------------------------------------------------------------------

interface JsonCommentTrivia {
  readonly kind: 'comment';
  readonly text: string;
  readonly isLine: boolean;
  readonly nlBefore: number;
}

interface JsonRawTrivia {
  readonly kind: 'raw';
  readonly text: string;
  readonly nlBefore: number;
}

type JsonTrivia = JsonCommentTrivia | JsonRawTrivia;

type JsonValueNode =
  | { readonly kind: 'scalar'; readonly raw: string }
  | JsonObjectNode
  | JsonArrayNode
  | { readonly kind: 'raw'; readonly text: string };

interface JsonMemberNode {
  readonly leadingTrivia: readonly JsonTrivia[];
  readonly nlBefore: number;
  readonly key: string;
  readonly hasColon: boolean;
  readonly value: JsonValueNode | null;
  readonly hasComma: boolean;
  readonly trailingComment?: JsonCommentTrivia;
}

interface JsonObjectNode {
  readonly kind: 'object';
  readonly members: readonly JsonMemberNode[];
  readonly trailingTrivia: readonly JsonTrivia[];
  readonly unclosed: boolean;
}

interface JsonElementNode {
  readonly leadingTrivia: readonly JsonTrivia[];
  readonly nlBefore: number;
  readonly value: JsonValueNode;
  readonly hasComma: boolean;
  readonly trailingComment?: JsonCommentTrivia;
}

interface JsonArrayNode {
  readonly kind: 'array';
  readonly elements: readonly JsonElementNode[];
  readonly trailingTrivia: readonly JsonTrivia[];
  readonly unclosed: boolean;
}

interface JsonTopItem {
  readonly leadingTrivia: readonly JsonTrivia[];
  readonly nlBefore: number;
  readonly value: JsonValueNode;
  readonly trailingComment?: JsonCommentTrivia;
}

function isComment(t: JsonToken): boolean {
  return t.type === 'lineComment' || t.type === 'blockComment';
}

function isTrivia(t: JsonToken): boolean {
  return isComment(t) || t.type === 'raw';
}

class JsonParser {
  private readonly t: readonly JsonToken[];
  private readonly src: string;
  private i = 0;

  constructor(tokens: readonly JsonToken[], src: string) {
    this.t = tokens;
    this.src = src;
  }

  parseDocument(): { items: JsonTopItem[]; trailingTrivia: JsonTrivia[] } {
    const items: JsonTopItem[] = [];
    let trailingTrivia: JsonTrivia[] = [];

    while (this.i < this.t.length) {
      const leading = this.collectTrivia();
      if (this.i >= this.t.length) {
        trailingTrivia = leading;
        break;
      }
      const startTok = this.t[this.i];
      const val = this.parseValue();
      const tc = this.collectInlineTrailingComment();
      items.push({
        leadingTrivia: leading,
        nlBefore: startTok.nlBefore,
        value: val,
        trailingComment: tc,
      });
    }

    return { items, trailingTrivia };
  }

  private collectTrivia(): JsonTrivia[] {
    const out: JsonTrivia[] = [];
    while (this.i < this.t.length && isTrivia(this.t[this.i])) {
      const tk = this.t[this.i++];
      if (tk.type === 'raw') {
        out.push({ kind: 'raw', text: tk.text, nlBefore: tk.nlBefore });
      } else {
        out.push({
          kind: 'comment',
          text: tk.text,
          isLine: tk.type === 'lineComment',
          nlBefore: tk.nlBefore,
        });
      }
    }
    return out;
  }

  private collectInlineTrailingComment(): JsonCommentTrivia | undefined {
    if (this.i >= this.t.length) return undefined;
    const tk = this.t[this.i];
    if (tk.nlBefore === 0 && isComment(tk)) {
      this.i++;
      return {
        kind: 'comment',
        text: tk.text,
        isLine: tk.type === 'lineComment',
        nlBefore: 0,
      };
    }
    return undefined;
  }

  private nextNonTrivia(from: number): number {
    let k = from;
    while (k < this.t.length && isTrivia(this.t[k])) k++;
    return k;
  }

  private consumeCommaAndInlineComment(): {
    hasComma: boolean;
    trailingComment?: JsonCommentTrivia;
  } {
    let tc = this.collectInlineTrailingComment();
    const commaIdx = this.nextNonTrivia(this.i);
    if (commaIdx < this.t.length && this.t[commaIdx].text === ',') {
      let sameSpan = true;
      for (let m = this.i; m < commaIdx; m++) {
        if (this.t[m].nlBefore > 0 || this.t[m].type === 'raw') {
          sameSpan = false;
          break;
        }
      }
      if (sameSpan) {
        this.i = commaIdx + 1;
        if (!tc) tc = this.collectInlineTrailingComment();
        return { hasComma: true, trailingComment: tc };
      }
    }
    return { hasComma: false, trailingComment: tc };
  }

  private parseValue(): JsonValueNode {
    if (this.i >= this.t.length) return { kind: 'raw', text: '' };
    const tk = this.t[this.i];
    if (tk.text === '{') return this.parseObject();
    if (tk.text === '[') return this.parseArray();
    if (tk.type === 'string') {
      this.i++;
      return { kind: 'scalar', raw: tk.text.replace(/\r\n?/g, '\n') };
    }
    if (tk.type === 'number' || tk.type === 'word') {
      this.i++;
      return { kind: 'scalar', raw: tk.text };
    }
    // Malformed unexpected token
    this.i++;
    return { kind: 'raw', text: tk.text };
  }

  private parseObject(): JsonObjectNode {
    this.i++; // consume '{'
    const members: JsonMemberNode[] = [];
    let trailingTrivia: JsonTrivia[] = [];
    let unclosed = true;

    while (this.i < this.t.length) {
      const leading = this.collectTrivia();
      if (this.i >= this.t.length) {
        trailingTrivia = leading;
        break;
      }

      const cur = this.t[this.i];
      if (cur.text === '}') {
        trailingTrivia = leading;
        unclosed = false;
        this.i++;
        break;
      }

      // Tolerate stray commas
      if (cur.text === ',') {
        if (members.length > 0 && !members[members.length - 1].hasComma) {
          const prev = members.pop()!;
          this.i++;
          const postTc = this.collectInlineTrailingComment() ?? prev.trailingComment;
          members.push({ ...prev, hasComma: true, trailingComment: postTc });
        } else {
          this.i++;
        }
        continue;
      }

      // Recover from stray close bracket inside object
      if (cur.text === ']') {
        trailingTrivia = leading;
        break;
      }

      const keyTok = cur;
      const startOffset = keyTok.start;
      this.i++;

      const colonIdx = this.nextNonTrivia(this.i);
      let hasColon = false;
      let val: JsonValueNode | null = null;

      if (colonIdx < this.t.length && this.t[colonIdx].text === ':') {
        hasColon = true;
        this.i = colonIdx + 1;
        const valIdx = this.nextNonTrivia(this.i);
        if (valIdx < this.t.length && this.t[valIdx].text !== '}' && this.t[valIdx].text !== ',') {
          this.i = valIdx;
          val = this.parseValue();
        }
      } else {
        // Malformed object entry without ':' — preserve raw span on line
        while (
          this.i < this.t.length &&
          this.t[this.i].nlBefore === 0 &&
          this.t[this.i].text !== ',' &&
          this.t[this.i].text !== '}'
        ) {
          this.i++;
        }
        const rawSpan = this.src.slice(startOffset, this.t[this.i - 1].end);
        const commaInfo = this.consumeCommaAndInlineComment();
        members.push({
          leadingTrivia: leading,
          nlBefore: keyTok.nlBefore,
          key: rawSpan,
          hasColon: false,
          value: null,
          hasComma: commaInfo.hasComma,
          trailingComment: commaInfo.trailingComment,
        });
        continue;
      }

      const commaInfo = this.consumeCommaAndInlineComment();
      members.push({
        leadingTrivia: leading,
        nlBefore: keyTok.nlBefore,
        key: keyTok.text,
        hasColon,
        value: val,
        hasComma: commaInfo.hasComma,
        trailingComment: commaInfo.trailingComment,
      });
    }

    return { kind: 'object', members, trailingTrivia, unclosed };
  }

  private parseArray(): JsonArrayNode {
    this.i++; // consume '['
    const elements: JsonElementNode[] = [];
    let trailingTrivia: JsonTrivia[] = [];
    let unclosed = true;

    while (this.i < this.t.length) {
      const leading = this.collectTrivia();
      if (this.i >= this.t.length) {
        trailingTrivia = leading;
        break;
      }

      const cur = this.t[this.i];
      if (cur.text === ']') {
        trailingTrivia = leading;
        unclosed = false;
        this.i++;
        break;
      }

      if (cur.text === ',') {
        if (elements.length > 0 && !elements[elements.length - 1].hasComma) {
          const prev = elements.pop()!;
          this.i++;
          const postTc = this.collectInlineTrailingComment() ?? prev.trailingComment;
          elements.push({ ...prev, hasComma: true, trailingComment: postTc });
        } else {
          this.i++;
        }
        continue;
      }

      if (cur.text === '}') {
        trailingTrivia = leading;
        break;
      }

      const startTok = cur;
      const val = this.parseValue();
      const commaInfo = this.consumeCommaAndInlineComment();
      elements.push({
        leadingTrivia: leading,
        nlBefore: startTok.nlBefore,
        value: val,
        hasComma: commaInfo.hasComma,
        trailingComment: commaInfo.trailingComment,
      });
    }

    return { kind: 'array', elements, trailingTrivia, unclosed };
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class JsonRenderer {
  private readonly o: ResolvedFormatterOptions;
  private readonly out: string[] = [];

  constructor(o: ResolvedFormatterOptions) {
    this.o = o;
  }

  private emitBlanks(count: number): void {
    if (this.out.length === 0) return;
    for (let k = 0; k < count; k++) this.out.push('');
  }

  private emitTrivia(trivia: readonly JsonTrivia[], level: number): void {
    for (const tr of trivia) {
      this.emitBlanks(clampBlankLines(tr.nlBefore, this.o));
      if (tr.kind === 'raw') {
        this.out.push(...tr.text.replace(/\r\n?/g, '\n').split('\n'));
      } else {
        this.out.push(...renderCommentLines(tr.text, tr.isLine, level, this.o));
      }
    }
  }

  private trailingSuffix(tc: JsonCommentTrivia | undefined): string {
    if (!tc) return '';
    return ' ' + normalizeCommentText(tc.text, tc.isLine, this.o);
  }

  renderDocument(doc: { items: JsonTopItem[]; trailingTrivia: JsonTrivia[] }): string {
    for (const item of doc.items) {
      this.emitTrivia(item.leadingTrivia, 0);
      this.emitBlanks(clampBlankLines(item.nlBefore, this.o));
      const lines = this.renderValue(item.value, 0, 0);
      if (lines.length === 1) {
        this.out.push(lines[0] + this.trailingSuffix(item.trailingComment));
      } else {
        this.out.push(...lines.slice(0, -1));
        this.out.push(lines[lines.length - 1] + this.trailingSuffix(item.trailingComment));
      }
    }
    this.emitTrivia(doc.trailingTrivia, 0);
    return finalizeDocument(this.out, this.o);
  }

  private canInlineNestedObject(obj: JsonObjectNode, level: number, inlinePrefixLen: number): boolean {
    if (level === 0 || obj.unclosed) return false;
    if (obj.trailingTrivia.length > 0 || obj.members.length !== 1) return false;
    const m = obj.members[0];
    if (
      m.leadingTrivia.length > 0 ||
      m.trailingComment ||
      !m.hasColon ||
      !m.value ||
      m.value.kind !== 'scalar' ||
      m.hasComma
    ) {
      return false;
    }
    const flat = `{ ${m.key}: ${m.value.raw} }`;
    if (flat.includes('\n')) return false;
    return this.o.maxLineLength === 0 || inlinePrefixLen + flat.length + 1 <= this.o.maxLineLength;
  }

  private renderValue(val: JsonValueNode, level: number, inlinePrefixLen: number): string[] {
    switch (val.kind) {
      case 'scalar':
        return val.raw.split('\n');
      case 'raw':
        return val.text ? val.text.split('\n') : [''];
      case 'object':
        return this.renderObject(val, level, inlinePrefixLen);
      case 'array':
        return this.renderArray(val, level, inlinePrefixLen);
    }
  }

  private renderObject(obj: JsonObjectNode, level: number, inlinePrefixLen: number): string[] {
    if (obj.members.length === 0 && obj.trailingTrivia.length === 0) {
      return [obj.unclosed ? '{' : '{}'];
    }

    if (this.canInlineNestedObject(obj, level, inlinePrefixLen)) {
      const m = obj.members[0];
      const valText = (m.value as { kind: 'scalar'; raw: string }).raw;
      return [`{ ${m.key}: ${valText} }`];
    }

    const lines: string[] = ['{'];
    const childIndent = indentStr(level + 1, this.o);

    for (let idx = 0; idx < obj.members.length; idx++) {
      const m = obj.members[idx];
      this.pushTriviaInto(lines, m.leadingTrivia, level + 1);
      if (lines.length > 1) {
        const blanks = clampBlankLines(m.nlBefore, this.o);
        for (let b = 0; b < blanks; b++) lines.push('');
      }

      const comma = m.hasComma ? ',' : '';
      const tc = this.trailingSuffix(m.trailingComment);

      if (!m.hasColon) {
        lines.push(`${childIndent}${m.key}${comma}${tc}`);
        continue;
      }

      const prefix = `${childIndent}${m.key}: `;
      if (!m.value) {
        lines.push(`${prefix.trimEnd()}${comma}${tc}`);
        continue;
      }

      const valLines = this.renderValue(m.value, level + 1, prefix.length);
      if (valLines.length === 1) {
        lines.push(`${prefix}${valLines[0]}${comma}${tc}`);
      } else {
        lines.push(`${prefix}${valLines[0]}`);
        for (let k = 1; k < valLines.length - 1; k++) lines.push(valLines[k]);
        lines.push(`${valLines[valLines.length - 1]}${comma}${tc}`);
      }
    }

    this.pushTriviaInto(lines, obj.trailingTrivia, level + 1);
    if (!obj.unclosed) {
      lines.push(`${indentStr(level, this.o)}}`);
    }
    return lines;
  }

  private renderArray(arr: JsonArrayNode, level: number, inlinePrefixLen: number): string[] {
    if (arr.elements.length === 0 && arr.trailingTrivia.length === 0) {
      return [arr.unclosed ? '[' : '[]'];
    }

    const hasTrivia =
      arr.trailingTrivia.length > 0 ||
      arr.elements.some((el) => el.leadingTrivia.length > 0 || !!el.trailingComment);
    const allScalars = arr.elements.every((el) => el.value.kind === 'scalar');

    if (level > 0 && !arr.unclosed && !hasTrivia && allScalars) {
      const parts = arr.elements.map((el, idx) => {
        const raw = (el.value as { kind: 'scalar'; raw: string }).raw;
        const comma = el.hasComma && idx < arr.elements.length - 1 ? ', ' : el.hasComma ? ',' : idx < arr.elements.length - 1 ? ' ' : '';
        return raw + comma;
      });
      const single = `[${parts.join('')}]`;
      if (
        !single.includes('\n') &&
        (this.o.maxLineLength === 0 || inlinePrefixLen + single.length + 1 <= this.o.maxLineLength)
      ) {
        return [single];
      }
    }

    const lines: string[] = ['['];
    const childIndent = indentStr(level + 1, this.o);

    for (let idx = 0; idx < arr.elements.length; idx++) {
      const el = arr.elements[idx];
      this.pushTriviaInto(lines, el.leadingTrivia, level + 1);
      if (lines.length > 1) {
        const blanks = clampBlankLines(el.nlBefore, this.o);
        for (let b = 0; b < blanks; b++) lines.push('');
      }

      const comma = el.hasComma ? ',' : '';
      const tc = this.trailingSuffix(el.trailingComment);
      const valLines = this.renderValue(el.value, level + 1, childIndent.length);

      if (valLines.length === 1) {
        lines.push(`${childIndent}${valLines[0]}${comma}${tc}`);
      } else {
        lines.push(`${childIndent}${valLines[0]}`);
        for (let k = 1; k < valLines.length - 1; k++) lines.push(valLines[k]);
        lines.push(`${valLines[valLines.length - 1]}${comma}${tc}`);
      }
    }

    this.pushTriviaInto(lines, arr.trailingTrivia, level + 1);
    if (!arr.unclosed) {
      lines.push(`${indentStr(level, this.o)}]`);
    }
    return lines;
  }

  private pushTriviaInto(lines: string[], trivia: readonly JsonTrivia[], level: number): void {
    for (const tr of trivia) {
      if (lines.length > 1) {
        const blanks = clampBlankLines(tr.nlBefore, this.o);
        for (let b = 0; b < blanks; b++) lines.push('');
      }
      if (tr.kind === 'raw') {
        lines.push(...tr.text.replace(/\r\n?/g, '\n').split('\n'));
      } else {
        lines.push(...renderCommentLines(tr.text, tr.isLine, level, this.o));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

export function formatJsonArtifact(
  text: string,
  userOptions?: PartialFormatterOptions | ResolvedFormatterOptions,
  editor?: EditorOptions
): string {
  const o = resolveOptions(userOptions, editor);
  const tokens = jsonTokenize(text);
  const ast = new JsonParser(tokens, text).parseDocument();
  return new JsonRenderer(o).renderDocument(ast);
}
