/**
 * Lossless-enough tokenizer for SAP HANA SQL / SQLScript.
 *
 * Token types:
 *   word, number, string, qident, var (:name), sysvar (::NAME), param (?),
 *   op, punct, lineComment, blockComment, other, raw (format-off region)
 *
 * Every token carries:
 *   nlBefore  number of line breaks in the whitespace in front of it
 *   wsBefore  whether there was any whitespace in front of it
 *   start/end offsets into the source text
 */

export type TokenType =
  | 'word'
  | 'number'
  | 'string'
  | 'qident'
  | 'var'
  | 'sysvar'
  | 'param'
  | 'op'
  | 'punct'
  | 'lineComment'
  | 'blockComment'
  | 'other'
  | 'raw';

export interface BaseToken<T extends TokenType = TokenType> {
  readonly type: T;
  readonly text: string;
  readonly nlBefore: number;
  readonly wsBefore: boolean;
  readonly start: number;
  readonly end: number;
}

export type WordToken = BaseToken<'word'>;
export type NumberToken = BaseToken<'number'>;
export type StringToken = BaseToken<'string'>;
export type QuotedIdentToken = BaseToken<'qident'>;
export type VariableToken = BaseToken<'var'>;
export type SystemVariableToken = BaseToken<'sysvar'>;
export type ParameterToken = BaseToken<'param'>;
export type OperatorToken = BaseToken<'op'>;
export type PunctuationToken = BaseToken<'punct'>;
export type LineCommentToken = BaseToken<'lineComment'>;
export type BlockCommentToken = BaseToken<'blockComment'>;
export type OtherToken = BaseToken<'other'>;
export type RawToken = BaseToken<'raw'>;

export type CommentToken = LineCommentToken | BlockCommentToken;

export type Token =
  | WordToken
  | NumberToken
  | StringToken
  | QuotedIdentToken
  | VariableToken
  | SystemVariableToken
  | ParameterToken
  | OperatorToken
  | PunctuationToken
  | LineCommentToken
  | BlockCommentToken
  | OtherToken
  | RawToken;

export type PragmaMode = 'on' | 'off';

export interface PragmaState {
  mode: PragmaMode;
  offToken: CommentToken | null;
}

const WORD_START = /[\p{L}_#$]/u;
const WORD_PART = /[\p{L}\p{N}_#$]/u;
const DIGIT = /[0-9]/;

const OFF_RE = /^(?:--|\/\*)\s*hanasql-format\s*:?\s*off\b/i;
const ON_RE = /^(?:--|\/\*)\s*hanasql-format\s*:?\s*on\b/i;

export interface TokenizeOptions {
  readonly collapseFormatOff?: boolean;
  readonly slashComments?: boolean;
}

export function tokenize(text: string, options: TokenizeOptions = {}): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;
  let nl = 0;
  let ws = false;

  const push = <T extends TokenType>(type: T, start: number, end: number): void => {
    tokens.push({ type, text: text.slice(start, end), nlBefore: nl, wsBefore: ws, start, end } as Token);
    nl = 0;
    ws = false;
  };

  while (i < n) {
    const ch = text[i];

    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '\u00a0' || ch === '\ufeff') {
      ws = true;
      if (ch === '\n') nl++;
      i++;
      continue;
    }

    // line comment
    if ((ch === '-' && text[i + 1] === '-') || (options.slashComments && ch === '/' && text[i + 1] === '/')) {
      let j = i + 2;
      while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
      push('lineComment', i, j);
      i = j;
      continue;
    }

    // block comment
    if (ch === '/' && text[i + 1] === '*') {
      let j = text.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      push('blockComment', i, j);
      i = j;
      continue;
    }

    // string literal
    if (ch === "'") {
      const j = scanString(text, i);
      push('string', i, j);
      i = j;
      continue;
    }

    // quoted identifier
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      push('qident', i, j);
      i = j;
      continue;
    }

    // numbers
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[i + 1] || '') && !isValueEnd(tokens))) {
      let j = i;
      while (j < n && DIGIT.test(text[j])) j++;
      if (text[j] === '.' && DIGIT.test(text[j + 1] || '')) {
        j++;
        while (j < n && DIGIT.test(text[j])) j++;
      }
      if ((text[j] === 'e' || text[j] === 'E') && (DIGIT.test(text[j + 1] || '') || ((text[j + 1] === '+' || text[j + 1] === '-') && DIGIT.test(text[j + 2] || '')))) {
        j += 2;
        while (j < n && DIGIT.test(text[j])) j++;
      }
      push('number', i, j);
      i = j;
      continue;
    }

    // words (and N'..' / X'..' literals)
    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < n && WORD_PART.test(text[j])) j++;
      // SQLScript library call: lib:member( ... )
      if (text[j] === ':' && WORD_START.test(text[j + 1] || '') && text[j + 1] !== ':') {
        let k = j + 2;
        while (k < n && WORD_PART.test(text[k])) k++;
        if (text[k] === '(') {
          push('word', i, k);
          i = k;
          continue;
        }
      }
      if (j - i === 1 && /[NXnx]/.test(ch) && text[j] === "'") {
        const k = scanString(text, j);
        push('string', i, k);
        i = k;
        continue;
      }
      push('word', i, j);
      i = j;
      continue;
    }

    // SQLScript variables
    if (ch === ':') {
      if (text[i + 1] === '=') { push('op', i, i + 2); i += 2; continue; }
      if (text[i + 1] === ':' && WORD_START.test(text[i + 2] || '')) {
        let j = i + 3;
        while (j < n && WORD_PART.test(text[j])) j++;
        push('sysvar', i, j);
        i = j;
        continue;
      }
      if (WORD_START.test(text[i + 1] || '')) {
        let j = i + 2;
        while (j < n && WORD_PART.test(text[j])) j++;
        push('var', i, j);
        i = j;
        continue;
      }
      push('punct', i, i + 1);
      i++;
      continue;
    }

    if (ch === '?') { push('param', i, i + 1); i++; continue; }

    // operators
    const two = text.slice(i, i + 2);
    if (two === '||' || two === '<>' || two === '!=' || two === '<=' || two === '>=' || two === '=>') {
      push('op', i, i + 2);
      i += 2;
      continue;
    }
    if (two === '..') { push('punct', i, i + 2); i += 2; continue; }
    if ('+-*/%=<>'.includes(ch)) { push('op', i, i + 1); i++; continue; }

    if ('(),;.[]{}'.includes(ch)) { push('punct', i, i + 1); i++; continue; }

    push('other', i, i + 1);
    i++;
  }

  return options.collapseFormatOff === false ? tokens : collapseFormatOff(tokens, text);
}

function scanString(text: string, i: number): number {
  const n = text.length;
  let j = i + 1;
  while (j < n) {
    if (text[j] === "'") {
      if (text[j + 1] === "'") { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return n;
}

function isValueEnd(tokens: readonly Token[]): boolean {
  const t = tokens[tokens.length - 1];
  if (!t) return false;
  return t.type === 'word' || t.type === 'qident' || t.type === 'number' || t.text === ')' || t.text === ']';
}

function isCommentToken(t: Token): t is CommentToken {
  return t.type === 'lineComment' || t.type === 'blockComment';
}

/** Replace "-- hanasql-format off" ... "-- hanasql-format on" regions by one raw token. */
function collapseFormatOff(tokens: readonly Token[], text: string): Token[] {
  const out: Token[] = [];
  const pragma: PragmaState = { mode: 'on', offToken: null };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (pragma.mode === 'off' && pragma.offToken !== null) {
      if ((isCommentToken(t) && ON_RE.test(t.text)) || i === tokens.length - 1) {
        out.push({
          type: 'raw',
          text: text.slice(pragma.offToken.start, t.end),
          nlBefore: pragma.offToken.nlBefore,
          wsBefore: pragma.offToken.wsBefore,
          start: pragma.offToken.start,
          end: t.end,
        });
        pragma.mode = 'on';
        pragma.offToken = null;
      }
      continue;
    }

    if (isCommentToken(t) && OFF_RE.test(t.text)) {
      if (i === tokens.length - 1) {
        out.push({
          type: 'raw',
          text: text.slice(t.start, t.end),
          nlBefore: t.nlBefore,
          wsBefore: t.wsBefore,
          start: t.start,
          end: t.end,
        });
      } else {
        pragma.mode = 'off';
        pragma.offToken = t;
      }
      continue;
    }

    out.push(t);
  }
  return out;
}
