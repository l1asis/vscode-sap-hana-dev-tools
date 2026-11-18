/**
 * Finds string-literal collections (`['A', 'B']`, `new Set(['A', 'B'])`) in TypeScript source, for the guard
 * that keeps hand-maintained SQL keyword sets out of the analyzer and formatter (#77). Dependency-free:
 * comments are blanked, strings and regex literals are skipped, then every bracket list whose items are only
 * string literals and spreads is reported.
 */

export interface WordCollection {
  /** 1-based line of the opening `[`. */
  readonly line: number;
  /** Declared name (`const NAME = ...`), or `null` for an inline list. */
  readonly name: string | null;
  /** `new Set([...])` rather than a plain array. */
  readonly isSet: boolean;
  /** Module-level declaration (no indentation). */
  readonly topLevel: boolean;
  readonly items: readonly string[];
}

/** Replaces comments with spaces (offsets kept), leaving strings intact and blanking regex literal bodies. */
function blankComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      out += src[i] ?? '';
      i++;
      continue;
    }
    if (c === '/' && /(?:[(,=:!&|?{};\n]|return)\s*$/.test(out.slice(-12))) {
      // regex literal: blank brackets so `[...]` classes are not taken for lists
      out += c;
      i++;
      let inClass = false;
      while (i < src.length && src[i] !== '\n') {
        const ch = src[i];
        if (ch === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        out += ch === '[' || ch === ']' || ch === "'" ? ' ' : ch;
        i++;
      }
      out += src[i] ?? '';
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const STRING_RE = /'((?:[^'\\]|\\.)*)'/g;

export function findWordCollections(source: string): WordCollection[] {
  const src = blankComments(source);
  const found: WordCollection[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '[') continue;
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "'") {
        j++;
        while (j < src.length && src[j] !== "'") {
          if (src[j] === '\\') j++;
          j++;
        }
        continue;
      }
      if (c === '[') depth++;
      else if (c === ']' && --depth === 0) break;
    }
    const body = src.slice(i + 1, j);
    if (/[[\]]/.test(body.replace(STRING_RE, "''"))) continue; // nested lists: inner ones are visited on their own
    const items = [...body.matchAll(STRING_RE)].map((m) => m[1]);
    const rest = body.replace(STRING_RE, '').replace(/\.\.\.[A-Za-z_][\w.()]*/g, '').replace(/[\s,]/g, '');
    if (items.length < 2 || rest) continue;
    const before = src.slice(Math.max(0, i - 200), i);
    const decl = before.match(/(?:^|\n)([ \t]*)(?:export\s+)?(?:const|let)\s+([A-Za-z_]\w*)\s*(?::[^=;]+)?=\s*(?:new\s+Set(?:<string>)?\(\s*)?$/);
    found.push({
      line: source.slice(0, i).split('\n').length,
      name: decl ? decl[2] : null,
      isSet: /new\s+Set(?:<string>)?\(\s*$/.test(before),
      topLevel: decl ? decl[1] === '' : false,
      items,
    });
  }
  return found;
}
