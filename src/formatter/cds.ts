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
// Lexer
// ---------------------------------------------------------------------------

export type CdsTokenType =
  | 'word'
  | 'number'
  | 'string'
  | 'qident'
  | 'bident' // ![...]
  | 'typedLiteral' // x'...', date'...', time'...', timestamp'...'
  | 'annot' // @Foo.bar
  | 'enumSym' // #COLUMN
  | 'sysvar' // $user, $env, $parameters, $projection
  | 'op'
  | 'punct'
  | 'lineComment'
  | 'blockComment'
  | 'other'
  | 'raw';

export interface CdsToken {
  readonly type: CdsTokenType;
  readonly text: string;
  readonly nlBefore: number;
  readonly wsBefore: boolean;
  readonly start: number;
  readonly end: number;
}

const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const TYPED_LIT_PREFIXES = new Set(['x', 'date', 'time', 'timestamp']);

export function cdsTokenize(text: string): CdsToken[] {
  const tokens: CdsToken[] = [];
  const n = text.length;
  let i = 0;
  let nl = 0;
  let ws = false;

  const push = (type: CdsTokenType, start: number, end: number): void => {
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

    if (ch === "'") {
      const end = scanDoubledQuoteEnd(text, i, "'", true);
      push('string', i, end);
      i = end;
      continue;
    }

    if (ch === '"') {
      const end = scanDoubledQuoteEnd(text, i, '"', false);
      push('qident', i, end);
      i = end;
      continue;
    }

    // CAP bracketed identifier: ![...]
    if (ch === '!' && text[i + 1] === '[') {
      const close = text.indexOf(']', i + 2);
      const end = close === -1 ? n : close + 1;
      push('bident', i, end);
      i = end;
      continue;
    }

    // Annotation token: @Path.Subpath
    if (ch === '@' && WORD_START.test(text[i + 1] || '')) {
      let j = i + 2;
      while (j < n && (WORD_PART.test(text[j]) || text[j] === '.')) j++;
      if (text[j - 1] === '.') j--;
      push('annot', i, j);
      i = j;
      continue;
    }

    // Enum symbol: #COLUMN
    if (ch === '#' && WORD_START.test(text[i + 1] || '')) {
      let j = i + 2;
      while (j < n && WORD_PART.test(text[j])) j++;
      push('enumSym', i, j);
      i = j;
      continue;
    }

    // Session/query variable: $user, $env, $parameters, $projection
    if (ch === '$' && WORD_START.test(text[i + 1] || '')) {
      let j = i + 2;
      while (j < n && WORD_PART.test(text[j])) j++;
      push('sysvar', i, j);
      i = j;
      continue;
    }

    // Numbers
    if (DIGIT.test(ch)) {
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

    // Words and typed literals (x'...', date'...', time'...', timestamp'...')
    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < n && WORD_PART.test(text[j])) j++;
      const wordLower = text.slice(i, j).toLowerCase();
      if (TYPED_LIT_PREFIXES.has(wordLower) && text[j] === "'") {
        const end = scanDoubledQuoteEnd(text, j, "'", true);
        push('typedLiteral', i, end);
        i = end;
        continue;
      }
      push('word', i, j);
      i = j;
      continue;
    }

    // Multi-char punct/operators
    const two = text.slice(i, i + 2);
    if (two === '::' || two === '..') {
      push('punct', i, i + 2);
      i += 2;
      continue;
    }
    if (two === '||' || two === '!=' || two === '<>' || two === '<=' || two === '>=' || two === '=>') {
      push('op', i, i + 2);
      i += 2;
      continue;
    }

    if ('=<>+-*/'.includes(ch)) {
      push('op', i, i + 1);
      i++;
      continue;
    }

    if ('{}[]();:,.'.includes(ch)) {
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
// Structural Formatter
// ---------------------------------------------------------------------------

type BraceKind = 'decl' | 'projection' | 'fkList' | 'annotObj';
type ParenKind = 'plain' | 'series' | 'params';

interface CdsFrame {
  readonly kind: BraceKind | ParenKind | 'annotArr';
  readonly openChar: '{' | '(' | '[';
  readonly baseLevel: number;
  readonly innerLevel: number;
  readonly inline: boolean;
}

const NON_VALUE_WORDS = new Set([
  'where', 'on', 'and', 'or', 'not', 'when', 'then', 'else', 'case', 'in', 'is', 'as',
  'having', 'default', 'like', 'escape', 'between', 'exists', 'any', 'some', 'union', 'all',
  'from', 'into', 'group', 'order', 'by', 'limit', 'offset', 'distinct', 'top',
]);

const HEADER_STARTERS = new Set(['namespace', 'using', 'package', 'in']);
const CLAUSE_BREAK_WORDS = new Set(['group', 'having', 'order', 'limit', 'union', 'with']);
const SERIES_SUBCLAUSE_STARTERS = new Set(['series', 'period', 'equidistant', 'not', 'minvalue', 'maxvalue', 'no']);

function isTrivia(t: CdsToken | undefined): boolean {
  return !!t && (t.type === 'lineComment' || t.type === 'blockComment' || t.type === 'raw');
}

class CdsLayout {
  private readonly t: readonly CdsToken[];
  private readonly o: ResolvedFormatterOptions;
  private readonly lines: string[] = [];
  private curTokens: CdsToken[] = [];
  private curLineText = '';
  private curLevel = 0;
  private pendingLineLevel: number | null = null;
  private pendingBlank = 0;

  private readonly frames: CdsFrame[] = [];
  private inHeaderSection = false;
  private seenNonHeader = false;
  private inView = false;
  private viewFrameDepth = 0;
  private inSelectFrom = false;
  private inWithParams = false;
  private inAssociationTo = false;
  private inAnnot = false;
  private caseStack: number[] = [];
  private lastCodeToken: CdsToken | null = null;
  private atStmtStart = true;
  private pendingBreak = false;

  constructor(tokens: readonly CdsToken[], o: ResolvedFormatterOptions) {
    this.t = tokens;
    this.o = o;
  }

  private nextCode(from: number): CdsToken | null {
    for (let k = from + 1; k < this.t.length; k++) {
      if (!isTrivia(this.t[k])) return this.t[k];
    }
    return null;
  }

  private prevCode(from: number): CdsToken | null {
    for (let k = from - 1; k >= 0; k--) {
      if (!isTrivia(this.t[k])) return this.t[k];
    }
    return null;
  }

  private topFrame(): CdsFrame | undefined {
    return this.frames[this.frames.length - 1];
  }

  private activeIndent(): number {
    const f = this.topFrame();
    return f ? f.innerLevel : 0;
  }

  private flushLine(): void {
    if (this.curTokens.length === 0) return;
    for (let b = 0; b < this.pendingBlank; b++) {
      if (this.lines.length > 0) this.lines.push('');
    }
    this.pendingBlank = 0;
    this.lines.push((indentStr(this.curLevel, this.o) + this.curLineText).replace(/[ \t]+$/, ''));
    this.curTokens = [];
    this.curLineText = '';
    this.pendingLineLevel = null;
  }

  private breakLine(nextLevel?: number): void {
    this.flushLine();
    if (nextLevel !== undefined) this.pendingLineLevel = nextLevel;
    this.pendingBreak = false;
  }

  private ensureLineStarted(levelOverride?: number): void {
    if (this.curTokens.length > 0) return;
    this.curLevel =
      levelOverride !== undefined
        ? levelOverride
        : this.pendingLineLevel !== null
          ? this.pendingLineLevel
          : this.activeIndent();
    this.pendingLineLevel = null;
  }

  private isValueEnd(tok: CdsToken | null): boolean {
    if (!tok) return false;
    if (
      tok.type === 'number' ||
      tok.type === 'string' ||
      tok.type === 'qident' ||
      tok.type === 'bident' ||
      tok.type === 'typedLiteral' ||
      tok.type === 'enumSym' ||
      tok.type === 'sysvar'
    ) {
      return true;
    }
    if (tok.text === ')' || tok.text === ']') return true;
    if (tok.type === 'word') return !NON_VALUE_WORDS.has(tok.text.toLowerCase());
    return false;
  }

  private isUnarySign(tok: CdsToken, idx: number): boolean {
    if (tok.text !== '+' && tok.text !== '-') return false;
    const prev = this.prevCode(idx);
    return !this.isValueEnd(prev);
  }

  private isParamColon(tok: CdsToken, idx: number): boolean {
    if (tok.text !== ':') return false;
    const nx = this.t[idx + 1];
    if (!nx || nx.type !== 'word' || nx.wsBefore) return false;
    const prev = this.prevCode(idx);
    if (!prev) return false;
    if (prev.type === 'op' || prev.text === '(' || prev.text === '[' || prev.text === ',') return true;
    if (prev.type === 'word' && NON_VALUE_WORDS.has(prev.text.toLowerCase())) return true;
    return false;
  }

  private needsSpace(prev: CdsToken, cur: CdsToken, curIdx: number): boolean {
    if (cur.text === ';' || cur.text === ',') return false;
    if (prev.text === ',') return true;
    if (prev.text === '.' || cur.text === '.' || prev.text === '::' || cur.text === '::') return false;
    if (prev.text === '..' || cur.text === '..') return false;

    // Nested path projection: orders[...].{ ... }
    if (prev.text === '.' && cur.text === '{') return false;

    // Parameter ref :PAR1 vs declaration colons
    if (prev.text === ':' && this.isParamColon(prev, curIdx - 1)) return false;
    if (cur.text === ':') {
      // @Annotation: value -> no space before ':', space after ':'
      if (prev.type === 'annot' || this.inAnnot) return false;
      // Parameter ref :PAR1
      if (this.isParamColon(cur, curIdx)) return true;
      // Declaration colon: name : Type
      return true;
    }
    if (prev.text === ':') return true;

    // Brackets & parens
    if (cur.text === '[' || cur.text === ']') {
      if (cur.text === '[' && (prev.text === ':' || prev.text === '=')) return true;
      if (cur.text === '[' && prev.type === 'word' && NON_VALUE_WORDS.has(prev.text.toLowerCase())) return true;
      return false;
    }
    if (prev.text === '[') return false;

    if (prev.text === '(') return false;
    if (cur.text === ')') return false;
    if (cur.text === '(') {
      if (prev.type === 'word') {
        const low = prev.text.toLowerCase();
        // Type args String(10), Decimal(15, 2), and function calls upper(x) -> no space
        // Keywords like `series (`, `identity (`, `on (`, `in (`, `and (` -> space
        if (
          low === 'series' ||
          low === 'identity' ||
          low === 'on' ||
          low === 'in' ||
          low === 'and' ||
          low === 'or' ||
          low === 'not' ||
          low === 'as' ||
          low === 'exists'
        ) {
          return true;
        }
        return false;
      }
      if (prev.type === 'qident' || prev.type === 'bident') return false;
      if (prev.type === 'op' || prev.text === ',') return true;
      return false;
    }

    if (prev.text === '{' && cur.text === '}') return false;
    if (prev.text === '{' || cur.text === '}') return true;

    if (prev.type === 'op' && this.isUnarySign(prev, curIdx - 1)) return false;
    if (prev.type === 'op' || cur.type === 'op') return true;

    return true;
  }

  private emitToken(tok: CdsToken, idx: number, levelOverride?: number): void {
    if (this.pendingBreak) this.breakLine();
    this.ensureLineStarted(levelOverride);
    if (this.curTokens.length > 0) {
      const prev = this.curTokens[this.curTokens.length - 1];
      if (this.needsSpace(prev, tok, idx)) this.curLineText += ' ';
    }
    this.curTokens.push(tok);
    this.curLineText += tok.text;
    if (!isTrivia(tok)) {
      this.lastCodeToken = tok;
      this.atStmtStart = false;
    }
  }

  private findMatchingBrace(openIdx: number, openChar: '{' | '[' | '(', closeChar: '}' | ']' | ')'): number {
    let depth = 0;
    for (let k = openIdx; k < this.t.length; k++) {
      const txt = this.t[k].text;
      if (txt === openChar) depth++;
      else if (txt === closeChar) {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  }

  /** Determine whether a `{ ... }` block can fit cleanly on a single line. */
  private canInlineBrace(openIdx: number, kind: BraceKind): boolean {
    if (kind === 'decl') {
      // Empty block `{}` always inline
      const nx = this.t[openIdx + 1];
      return !!nx && nx.text === '}';
    }
    const closeIdx = this.findMatchingBrace(openIdx, '{', '}');
    if (closeIdx === -1) return false;
    if (closeIdx === openIdx + 1) return true; // empty `{}`

    let commas = 0;
    let totalLen = this.curLineText.length + indentStr(this.activeIndent(), this.o).length;
    for (let k = openIdx + 1; k < closeIdx; k++) {
      const tk = this.t[k];
      if (isTrivia(tk)) return false;
      const low = tk.type === 'word' ? tk.text.toLowerCase() : '';
      if (tk.text === '{' || low === 'case') return false;
      if (tk.text === ',') commas++;
      totalLen += tk.text.length + 1;
    }
    if (kind === 'projection' && commas > 0) return false;
    if (this.o.maxLineLength > 0 && totalLen + 2 > this.o.maxLineLength) return false;
    return true;
  }

  private canInlineBracket(openIdx: number): boolean {
    const closeIdx = this.findMatchingBrace(openIdx, '[', ']');
    if (closeIdx === -1) return false;
    let totalLen = this.curLineText.length + indentStr(this.activeIndent(), this.o).length;
    for (let k = openIdx + 1; k < closeIdx; k++) {
      const tk = this.t[k];
      if (isTrivia(tk)) return false;
      if (tk.text === '{' || tk.text === '[') return false;
      totalLen += tk.text.length + 1;
    }
    return this.o.maxLineLength === 0 || totalLen + 2 <= this.o.maxLineLength;
  }

  private classifyBrace(idx: number): BraceKind {
    if (this.inAnnot) return 'annotObj';
    if (this.lastCodeToken && this.lastCodeToken.text === '.') return 'projection';
    if (this.inSelectFrom) {
      const prev = this.prevCode(idx);
      if (prev && prev.type === 'word' && prev.text.toLowerCase() === 'mixin') {
        return 'decl';
      }
      return 'projection';
    }
    if (this.inAssociationTo) return 'fkList';
    return 'decl';
  }

  private updateContextOnWord(tok: CdsToken, idx: number): void {
    const low = tok.text.toLowerCase();
    const nx = this.nextCode(idx);

    if (this.atStmtStart && this.frames.length === 0) {
      if (HEADER_STARTERS.has(low)) {
        this.inHeaderSection = true;
      } else {
        if (this.inHeaderSection && !this.seenNonHeader) {
          this.pendingBlank = Math.max(this.pendingBlank, 1);
        }
        this.inHeaderSection = false;
        this.seenNonHeader = true;
      }
    }

    if (low === 'view' && (this.atStmtStart || (this.lastCodeToken && this.lastCodeToken.text === 'define'))) {
      this.inView = true;
      this.viewFrameDepth = this.frames.length;
      this.inSelectFrom = false;
    }
    if (low === 'select' && nx && nx.type === 'word' && nx.text.toLowerCase() === 'from') {
      this.inSelectFrom = true;
    }
    if (low === 'with' && nx && nx.type === 'word' && nx.text.toLowerCase() === 'parameters') {
      this.inWithParams = true;
    }
    if (low === 'as' && this.inWithParams) {
      this.inWithParams = false;
    }
    if (low === 'association' || low === 'composition') {
      this.inAssociationTo = true;
    }
    if (low === 'on' && this.inAssociationTo) {
      this.inAssociationTo = false;
    }
  }

  private handleComment(tok: CdsToken): void {
    const isLine = tok.type === 'lineComment';
    if (tok.type === 'raw') {
      this.breakLine();
      if (this.lines.length > 0 && this.pendingBlank === 0) {
        this.pendingBlank = clampBlankLines(tok.nlBefore, this.o);
      }
      for (let b = 0; b < this.pendingBlank; b++) {
        if (this.lines.length > 0) this.lines.push('');
      }
      this.pendingBlank = 0;
      this.lines.push(...tok.text.replace(/\r\n?/g, '\n').split('\n'));
      return;
    }

    const standalone = tok.nlBefore > 0 || (this.curTokens.length === 0 && !this.pendingBreak);
    if (standalone) {
      this.breakLine();
      const blanks = clampBlankLines(tok.nlBefore, this.o);
      if (this.lines.length > 0 && this.pendingBlank === 0) this.pendingBlank = blanks;
      for (let b = 0; b < this.pendingBlank; b++) {
        if (this.lines.length > 0) this.lines.push('');
      }
      this.pendingBlank = 0;
      this.lines.push(...renderCommentLines(tok.text, isLine, this.activeIndent(), this.o));
      return;
    }

    // Inline trailing comment
    this.ensureLineStarted();
    this.curLineText += ' ' + normalizeCommentText(tok.text, isLine, this.o);
    if (isLine) this.breakLine();
  }

  run(): string {
    for (let i = 0; i < this.t.length; i++) {
      const tok = this.t[i];
      if (isTrivia(tok)) {
        this.handleComment(tok);
        continue;
      }

      if (this.atStmtStart && this.curTokens.length === 0 && !this.pendingBreak) {
        const blanks = clampBlankLines(tok.nlBefore, this.o);
        if (blanks > this.pendingBlank) this.pendingBlank = blanks;
      }

      if (tok.type === 'annot') {
        if (!this.inWithParams && this.curTokens.length > 0) this.breakLine();
        if (this.atStmtStart && this.inHeaderSection && !this.seenNonHeader) {
          this.pendingBlank = Math.max(this.pendingBlank, 1);
          this.inHeaderSection = false;
          this.seenNonHeader = true;
        }
        this.emitToken(tok, i);
        const nx = this.nextCode(i);
        if (nx && nx.text === ':') {
          this.inAnnot = true;
        } else if (!this.inWithParams) {
          this.pendingBreak = true;
        }
        continue;
      }

      if (this.inAnnot && tok.text !== ':' && tok.text !== '{' && tok.text !== '[') {
        const prev = this.lastCodeToken;
        if (prev && prev.text === ':') {
          // Scalar annotation value
          this.emitToken(tok, i);
          const nx = this.nextCode(i);
          if (this.frames.length === 0 || this.topFrame()?.kind === 'decl') {
            if (!nx || (nx.text !== '.' && nx.text !== ',')) {
              this.inAnnot = false;
              if (!this.inWithParams) this.pendingBreak = true;
            }
          }
          continue;
        }
      }

      if (tok.type === 'word') {
        const low = tok.text.toLowerCase();

        if (this.inView && !this.pendingBreak && this.frames.every((f) => f.kind === 'decl')) {
          if (low === 'union') {
            this.breakLine(this.activeIndent());
            this.inSelectFrom = false;
          } else if (low === 'select' && this.lastCodeToken && this.lastCodeToken.type === 'word') {
            const prevLow = this.lastCodeToken.text.toLowerCase();
            if (prevLow === 'union' || prevLow === 'all') {
              this.breakLine(this.activeIndent());
            } else if (prevLow === 'as' && this.curLineText.length > 60) {
              this.breakLine(this.activeIndent());
            }
          } else if (CLAUSE_BREAK_WORDS.has(low)) {
            if (low === 'group' || low === 'order') {
              const nx = this.nextCode(i);
              if (nx && nx.type === 'word' && nx.text.toLowerCase() === 'by') {
                this.breakLine(this.activeIndent());
              }
            } else if (low === 'having' || low === 'limit') {
              this.breakLine(this.activeIndent());
            } else if (low === 'with' && this.nextCode(i)?.text.toLowerCase() === 'structured') {
              this.breakLine(this.activeIndent());
            }
          } else if (low === 'where' && this.curTokens.length > 0) {
            this.breakLine(this.activeIndent());
          }
        }

        // CASE ... WHEN ... THEN ... ELSE ... END inside view projections
        if (low === 'case') {
          this.caseStack.push(this.activeIndent());
        } else if ((low === 'when' || low === 'else') && this.caseStack.length > 0) {
          this.breakLine(this.caseStack[this.caseStack.length - 1] + 1);
        } else if (low === 'end' && this.caseStack.length > 0) {
          const lvl = this.caseStack.pop()!;
          this.breakLine(lvl);
        }

        // Inside series ( ... )
        const tf = this.topFrame();
        if (tf && tf.kind === 'series' && SERIES_SUBCLAUSE_STARTERS.has(low)) {
          const prevLow = this.lastCodeToken?.type === 'word' ? this.lastCodeToken.text.toLowerCase() : '';
          if (
            this.curTokens.length > 0 &&
            !(low === 'series' && prevLow === 'for') &&
            !(low === 'not' && prevLow === 'allowed') &&
            !(low === 'equidistant' && prevLow === 'not') &&
            !(low === 'minvalue' && prevLow === 'no') &&
            !(low === 'maxvalue' && prevLow === 'no')
          ) {
            this.breakLine(tf.innerLevel);
          }
        }

        this.updateContextOnWord(tok, i);
        this.emitToken(tok, i);
        continue;
      }

      if (tok.text === '{') {
        const kind = this.classifyBrace(i);
        const inline = this.canInlineBrace(i, kind);
        const baseLevel = this.curTokens.length > 0 ? this.curLevel : this.activeIndent();
        this.emitToken(tok, i, baseLevel);
        this.frames.push({
          kind,
          openChar: '{',
          baseLevel,
          innerLevel: inline ? baseLevel : baseLevel + 1,
          inline,
        });
        this.inAssociationTo = false;
        if (!inline) {
          this.pendingBreak = true;
          this.atStmtStart = kind === 'decl';
        }
        continue;
      }

      if (tok.text === '}') {
        const top = this.topFrame();
        const popped = top && top.openChar === '{' ? this.frames.pop()! : undefined;
        if (popped && !popped.inline) {
          this.breakLine(popped.baseLevel);
        }
        this.emitToken(tok, i, popped ? popped.baseLevel : Math.max(0, this.activeIndent()));
        if (popped?.kind === 'annotObj') {
          this.inAnnot = false;
          if (!this.inWithParams) this.pendingBreak = true;
        }
        if (popped?.kind === 'projection') {
          // If projection `}` is followed by `where` that fits, stay on line unless long
          const nx = this.nextCode(i);
          if (nx && nx.type === 'word') {
            const nlow = nx.text.toLowerCase();
            if (nlow === 'where' || nlow === 'group' || nlow === 'having' || nlow === 'order' || nlow === 'limit' || nlow === 'union' || nlow === 'with') {
              this.pendingBreak = true;
            }
          }
        }
        continue;
      }

      if (tok.text === '[') {
        if (this.inAnnot) {
          const inline = this.canInlineBracket(i);
          const baseLevel = this.curTokens.length > 0 ? this.curLevel : this.activeIndent();
          this.emitToken(tok, i);
          this.frames.push({
            kind: 'annotArr',
            openChar: '[',
            baseLevel,
            innerLevel: inline ? baseLevel : baseLevel + 1,
            inline,
          });
          if (!inline) this.pendingBreak = true;
          continue;
        }
        this.emitToken(tok, i);
        continue;
      }

      if (tok.text === ']') {
        const top = this.topFrame();
        if (top && top.openChar === '[') {
          const popped = this.frames.pop()!;
          if (!popped.inline) this.breakLine(popped.baseLevel);
          this.emitToken(tok, i, popped.baseLevel);
          if (this.frames.every((f) => f.kind === 'decl')) {
            this.inAnnot = false;
            if (!this.inWithParams) this.pendingBreak = true;
          }
          continue;
        }
        this.emitToken(tok, i);
        continue;
      }

      if (tok.text === '(') {
        const prevLow = this.lastCodeToken?.type === 'word' ? this.lastCodeToken.text.toLowerCase() : '';
        const isSeries = prevLow === 'series';
        const baseLevel = this.curTokens.length > 0 ? this.curLevel : this.activeIndent();
        const kind: ParenKind = isSeries ? 'series' : 'plain';
        this.emitToken(tok, i);
        this.frames.push({
          kind,
          openChar: '(',
          baseLevel,
          innerLevel: isSeries ? baseLevel + 1 : baseLevel,
          inline: !isSeries,
        });
        if (isSeries) this.pendingBreak = true;
        continue;
      }

      if (tok.text === ')') {
        const top = this.topFrame();
        const popped = top && top.openChar === '(' ? this.frames.pop()! : undefined;
        if (popped && !popped.inline) {
          this.breakLine(popped.baseLevel);
        }
        this.emitToken(tok, i, popped ? popped.baseLevel : undefined);
        continue;
      }

      if (tok.text === ',') {
        this.emitToken(tok, i);
        const top = this.topFrame();
        if (top && !top.inline && (top.kind === 'projection' || top.kind === 'fkList' || top.kind === 'annotObj' || top.kind === 'annotArr')) {
          this.pendingBreak = true;
        }
        continue;
      }

      if (tok.text === ';') {
        this.emitToken(tok, i);
        if (this.frames.length <= this.viewFrameDepth) {
          this.inView = false;
          this.inSelectFrom = false;
          this.inWithParams = false;
        }
        this.inAssociationTo = false;
        this.inAnnot = false;
        this.atStmtStart = true;
        this.pendingBreak = true;
        continue;
      }

      this.emitToken(tok, i);
    }

    this.flushLine();
    return finalizeDocument(this.lines, this.o);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format an SAP HANA CDS document (`.hdbdd` or `.hdbcds`).
 */
export function formatCds(
  text: string,
  userOptions: PartialFormatterOptions | ResolvedFormatterOptions = {},
  editor: EditorOptions = {}
): string {
  const o =
    'listCtx' in userOptions && userOptions.listCtx instanceof Set
      ? userOptions
      : resolveOptions(userOptions, editor);
  const tokens = cdsTokenize(text);
  if (tokens.length === 0) return '';
  return new CdsLayout(tokens, o).run();
}
