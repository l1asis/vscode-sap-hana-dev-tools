import { scanBackslashStringEnd, scanBlockCommentEnd, scanLineCommentEnd } from './shared';

const JS_PRAGMA_OFF_RE = /(?:\/\/|\/\*)\s*hanasql-format\s+off\b/i;
const JS_PRAGMA_ON_RE = /(?:\/\/|\/\*)\s*hanasql-format\s+on\b/i;

export interface OffsetEdit {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly newText: string;
}

export interface JsPragmaMaskResult {
  /** Source text with `hanasql-format off ... on` spans replaced by JS comment sentinels. */
  readonly sanitized: string;
  /** Map from sentinel comment string to original verbatim text slice. */
  readonly regions: ReadonlyMap<string, string>;
}

/**
 * Scan `.xsjs` / `.xsjslib` text for `// hanasql-format off ... on` or `/* hanasql-format off ... on *\/`
 * comment pragmas (ignoring strings/template literals) and mask them with unique comment sentinels
 * before delegating formatting to VS Code's JavaScript formatter.
 */
export function extractJsPragmaRegions(text: string): JsPragmaMaskResult {
  const n = text.length;
  const regions = new Map<string, string>();
  const spans: Array<{ start: number; end: number }> = [];

  let i = 0;
  let offStart: number | null = null;

  while (i < n) {
    const ch = text[i];

    // Comments (eligible for pragma markers)
    if (ch === '/' && text[i + 1] === '/') {
      const end = scanLineCommentEnd(text, i);
      const comment = text.slice(i, end);
      if (offStart === null) {
        if (JS_PRAGMA_OFF_RE.test(comment)) {
          // Include leading horizontal whitespace on the pragma-off line
          let lineStart = i;
          while (lineStart > 0 && (text[lineStart - 1] === ' ' || text[lineStart - 1] === '\t')) {
            lineStart--;
          }
          offStart = lineStart;
        }
      } else if (JS_PRAGMA_ON_RE.test(comment)) {
        spans.push({ start: offStart, end });
        offStart = null;
      }
      i = end;
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      const end = scanBlockCommentEnd(text, i);
      const comment = text.slice(i, end);
      if (offStart === null) {
        if (JS_PRAGMA_OFF_RE.test(comment)) {
          let lineStart = i;
          while (lineStart > 0 && (text[lineStart - 1] === ' ' || text[lineStart - 1] === '\t')) {
            lineStart--;
          }
          offStart = lineStart;
        }
      } else if (JS_PRAGMA_ON_RE.test(comment)) {
        spans.push({ start: offStart, end });
        offStart = null;
      }
      i = end;
      continue;
    }

    // String & template literals (ignore pragma-looking text inside strings)
    if (ch === '"' || ch === "'" || ch === '`') {
      i = scanBackslashStringEnd(text, i, ch);
      continue;
    }

    i++;
  }

  // Unclosed `hanasql-format off` extends to EOF
  if (offStart !== null) {
    spans.push({ start: offStart, end: n });
  }

  if (spans.length === 0) {
    return { sanitized: text, regions };
  }

  let sanitized = '';
  let cursor = 0;
  spans.forEach((sp, idx) => {
    const sentinel = `/* __HANASQL_XSJS_PRAGMA_${idx}__ */`;
    regions.set(sentinel, text.slice(sp.start, sp.end));
    sanitized += text.slice(cursor, sp.start) + sentinel;
    cursor = sp.end;
  });
  sanitized += text.slice(cursor);

  return { sanitized, regions };
}

/**
 * Restore verbatim `hanasql-format off ... on` spans after JS formatting.
 * Removes indentation inserted before the placeholder sentinel on its own line
 * because each captured span already includes its original leading indentation.
 */
export function restoreJsPragmaRegions(
  formatted: string,
  regions: ReadonlyMap<string, string>
): string {
  if (regions.size === 0) return formatted;
  let result = formatted;
  for (const [sentinel, original] of regions.entries()) {
    const escaped = sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRe = new RegExp(`^[ \\t]*${escaped}`, 'm');
    if (lineRe.test(result)) {
      result = result.replace(lineRe, () => original);
    } else {
      result = result.replace(sentinel, () => original);
    }
  }
  return result;
}

/**
 * Apply offset-based edits in reverse offset order to produce the resulting text string.
 */
export function applyOffsetEdits(text: string, edits: readonly OffsetEdit[]): string {
  if (edits.length === 0) return text;
  const sorted = [...edits].sort((a, b) => b.startOffset - a.startOffset || b.endOffset - a.endOffset);
  let out = text;
  for (const edit of sorted) {
    out = out.slice(0, edit.startOffset) + edit.newText + out.slice(edit.endOffset);
  }
  return out;
}
