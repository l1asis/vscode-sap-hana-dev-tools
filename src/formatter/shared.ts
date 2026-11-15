import { CommentToken, Token } from './tokenizer';
import { ResolvedFormatterOptions } from './options';

/**
 * Shared scanner & rendering utilities for pure-TypeScript SAP HANA formatters.
 * Zero runtime dependencies; preserves comments, pragmas, and malformed input.
 */

export const PRAGMA_OFF_RE = /^(?:--|\/\/|\/\*)\s*hanasql-format\s*:?\s*off\b/i;
export const PRAGMA_ON_RE = /^(?:--|\/\/|\/\*)\s*hanasql-format\s*:?\s*on\b/i;

export interface RawSpanToken {
  readonly type: string;
  readonly text: string;
  readonly nlBefore: number;
  readonly wsBefore: boolean;
  readonly start: number;
  readonly end: number;
}

/** Scan a single-line comment starting after its 2-char prefix (e.g. `//` or `--`). */
export function scanLineCommentEnd(text: string, start: number): number {
  const n = text.length;
  let j = start + 2;
  while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
  return j;
}

/** Scan a `/* ... *\/` block comment starting at `start`. Unclosed comments run to EOF. */
export function scanBlockCommentEnd(text: string, start: number): number {
  const close = text.indexOf('*/', start + 2);
  return close === -1 ? text.length : close + 2;
}

/**
 * Scan a double-quoted string literal with backslash escapes (`\"`, `\\`, etc.),
 * used by Classic KV and XSODATA. Unclosed strings run to EOF.
 */
export function scanBackslashStringEnd(text: string, start: number, quoteChar: '"' | "'" | '`'): number {
  const n = text.length;
  let j = start + 1;
  while (j < n) {
    const ch = text[j];
    if (ch === '\\') {
      j += j + 1 < n ? 2 : 1;
      continue;
    }
    if (ch === quoteChar) return j + 1;
    j++;
  }
  return n;
}

/**
 * Scan a SQL/CDS doubled-quote delimited string/identifier (`'...'` with `''` or `\'`,
 * or `"..."` with `""`). Unclosed literals run to EOF.
 */
export function scanDoubledQuoteEnd(
  text: string,
  start: number,
  quoteChar: '"' | "'",
  allowBackslashEscape = false
): number {
  const n = text.length;
  let j = start + 1;
  while (j < n) {
    const ch = text[j];
    if (allowBackslashEscape && ch === '\\') {
      j += j + 1 < n ? 2 : 1;
      continue;
    }
    if (ch === quoteChar) {
      if (text[j + 1] === quoteChar) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return n;
}

/**
 * Collapse tokens between `hanasql-format off` and `hanasql-format on` pragmas
 * (supporting `--`, `//`, and `/* ... *\/` comment markers) into single `raw` tokens.
 */
export function collapsePragmaRegions<T extends RawSpanToken>(
  tokens: readonly T[],
  text: string,
  isComment: (tok: T) => boolean,
  makeRaw: (rawText: string, firstTok: T, endOffset: number) => T
): T[] {
  const out: T[] = [];
  let offTok: T | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (offTok !== null) {
      if ((isComment(t) && PRAGMA_ON_RE.test(t.text)) || i === tokens.length - 1) {
        out.push(makeRaw(text.slice(offTok.start, t.end), offTok, t.end));
        offTok = null;
      }
      continue;
    }
    if (isComment(t) && PRAGMA_OFF_RE.test(t.text)) {
      if (i === tokens.length - 1) {
        out.push(makeRaw(t.text, t, t.end));
      } else {
        offTok = t;
      }
      continue;
    }
    out.push(t);
  }
  return out;
}

/** Collapse SQL tokens using the standard `Token` shape. */
export function isSqlCommentToken(t: Token): t is CommentToken {
  return t.type === 'lineComment' || t.type === 'blockComment';
}

/** Normalize a line or block comment according to formatter options. */
export function normalizeCommentText(text: string, isLine: boolean, o: ResolvedFormatterOptions): string {
  let t = text.replace(/[ \t]+$/, '');
  if (isLine) {
    if (o.spaceAfterCommentMarker) {
      if (/^--[A-Za-z0-9]/.test(t)) t = '-- ' + t.slice(2);
      else if (/^\/\/(?![\/\s])/.test(t)) t = '// ' + t.slice(2);
    }
  } else if (/[\r\n]/.test(t)) {
    t = t.replace(/\r\n?/g, '\n');
  }
  return t;
}

/** Compute the single indentation unit string from resolved options. */
export function indentUnit(o: ResolvedFormatterOptions): string {
  return o.useTabs ? '\t' : ' '.repeat(o.indentWidth);
}

/** Repeat indentation unit `level` times (clamped at 0). */
export function indentStr(level: number, o: ResolvedFormatterOptions): string {
  return indentUnit(o).repeat(Math.max(0, level));
}

/** Format a standalone (or indented multi-line) comment into output lines. */
export function renderCommentLines(
  text: string,
  isLine: boolean,
  level: number,
  o: ResolvedFormatterOptions
): string[] {
  const norm = normalizeCommentText(text, isLine, o);
  const ind = indentStr(level, o);
  if (!norm.includes('\n')) return [ind + norm];
  const parts = norm.split('\n');
  const rest = parts.slice(1);
  const starred = rest.every((s) => s.trim() === '' || /^\s*\*/.test(s));
  const out = [ind + parts[0]];
  for (const s of rest) {
    out.push(starred ? (s.trim() === '' ? '' : ind + ' ' + s.trim()) : s);
  }
  return out;
}

/** Join formatted lines with resolved EOL and `insertFinalNewline` policy. */
export function finalizeDocument(
  lines: readonly string[],
  o: ResolvedFormatterOptions,
  fragment = false
): string {
  if (lines.length === 0) return '';
  let result = lines.join(o.eol);
  if (!fragment && o.insertFinalNewline) result += o.eol;
  return result;
}

/** Clamp source blank lines between tokens to `maxConsecutiveBlankLines`. */
export function clampBlankLines(nlBefore: number, o: ResolvedFormatterOptions): number {
  const rawBlanks = Math.max(0, nlBefore - 1);
  return Math.min(rawBlanks, o.maxConsecutiveBlankLines);
}
