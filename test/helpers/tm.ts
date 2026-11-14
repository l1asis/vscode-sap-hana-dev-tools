/**
 * Minimal TextMate grammar engine for tests (no dependencies).
 * Supports match/begin/end/patterns/include (local, external scope, scope#repo),
 * captures, name/contentName. Enough to verify the shipped grammars.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface TmCapture {
  name?: string;
}

export type TmCaptureMap = Record<string, TmCapture>;

export interface TmRule {
  name?: string;
  contentName?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: TmRule[];
  include?: string;
  captures?: TmCaptureMap;
  beginCaptures?: TmCaptureMap;
  endCaptures?: TmCaptureMap;
}

export interface TmGrammar {
  name?: string;
  scopeName: string;
  patterns?: TmRule[];
  repository?: Record<string, TmRule>;
}

export interface TmToken {
  text: string;
  scopes: string[];
}

interface ResolvedRule {
  rule: TmRule;
  grammar: TmGrammar;
}

interface StackEntry {
  rule: TmRule;
  grammar: TmGrammar;
  endSrc: string;
  inContent: boolean;
}

type MatchCandidate =
  | { kind: 'end'; m: RegExpExecArray }
  | { kind: 'match'; m: RegExpExecArray; rule: TmRule; grammar: TmGrammar }
  | { kind: 'begin'; m: RegExpExecArray; rule: TmRule; grammar: TmGrammar };

const dir = fs.existsSync(path.join(__dirname, '..', '..', 'syntaxes'))
  ? path.join(__dirname, '..', '..', 'syntaxes')
  : path.join(__dirname, '..', '..', '..', 'syntaxes');

export const grammars: Record<string, TmGrammar> = {};
for (const f of fs.readdirSync(dir)) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as TmGrammar;
  grammars[g.scopeName] = g;
}

// VS Code ships source.json; a tiny stand-in is enough for the tests
grammars['source.json'] = {
  scopeName: 'source.json',
  patterns: [{ name: 'string.quoted.double.json', begin: '"', end: '"' }],
};

grammars['source.js'] = {
  scopeName: 'source.js',
  patterns: [
    { name: 'string.quoted.double.js', begin: '"', end: '"' },
    { name: 'keyword.control.js', match: '\\b(?:var|function|return)\\b' },
    { name: 'support.function.js', match: '\\b[A-Za-z_]\\w*(?=\\()' },
  ],
};

grammars['text.xml'] = {
  scopeName: 'text.xml',
  patterns: [{ name: 'meta.tag.xml', begin: '<', end: '>' }],
};

const cache = new Map<string, RegExp>();
function rx(src: string): RegExp {
  let flags = 'dg';
  if (src.startsWith('(?i)')) {
    src = src.slice(4);
    flags += 'i';
  }
  const key = flags + src;
  let r = cache.get(key);
  if (!r) {
    r = new RegExp(src, flags);
    cache.set(key, r);
  }
  r.lastIndex = 0;
  return r;
}

function resolve(
  patterns: readonly TmRule[] | undefined,
  grammar: TmGrammar,
  out: ResolvedRule[],
  seen = new Set<string>()
): ResolvedRule[] {
  for (const p of patterns || []) {
    if (p.include) {
      let g: TmGrammar | undefined = grammar;
      let name = p.include;
      if (name.startsWith('#')) {
        name = name.slice(1);
      } else {
        const [scope, repo] = name.split('#');
        g = grammars[scope];
        if (!g) throw new Error('unknown grammar ' + scope);
        if (!repo) {
          resolve(g.patterns, g, out, seen);
          continue;
        }
        name = repo;
      }
      const target = g.repository && g.repository[name];
      if (!target) throw new Error(`unknown repository item ${p.include} in ${grammar.scopeName}`);
      const k = g.scopeName + '#' + name;
      if (seen.has(k)) continue;
      seen.add(k);
      if (target.match || target.begin) out.push({ rule: target, grammar: g });
      else resolve(target.patterns, g, out, seen);
    } else {
      out.push({ rule: p, grammar });
    }
  }
  return out;
}

function isDefinedScope(scope: string | null | undefined): scope is string {
  return typeof scope === 'string' && scope.length > 0;
}

function tokenizeLine(line: string, stack: StackEntry[], rootGrammar: TmGrammar): TmToken[] {
  const tokens: TmToken[] = [];
  const scopesOf = (): string[] =>
    stack.flatMap((s) => [s.rule.name, s.inContent ? s.rule.contentName : null]).filter(isDefinedScope);
  const base = [rootGrammar.scopeName];
  const emit = (text: string, extra: Array<string | undefined> = []): void => {
    if (text) {
      tokens.push({ text, scopes: [...base, ...scopesOf(), ...extra.filter(isDefinedScope)] });
    }
  };

  const applyCaptures = (m: RegExpExecArray, caps: TmCaptureMap | undefined, extra: Array<string | undefined>): void => {
    // m.indices from the 'd' flag
    const start = m.index;
    const end = m.index + m[0].length;
    const indices = m.indices;
    if (!caps || !indices) {
      emit(m[0], extra);
      return;
    }
    let pos = start;
    const items = Object.keys(caps)
      .map(Number)
      .filter((i) => indices[i] !== undefined)
      .sort((a, b) => indices[a]![0] - indices[b]![0] || a - b);
    for (const i of items) {
      const [s, e] = indices[i]!;
      if (s < pos) continue;
      emit(line.slice(pos, s), extra);
      emit(line.slice(s, e), [...extra, caps[String(i)]?.name]);
      pos = e;
    }
    emit(line.slice(pos, end), extra);
  };

  let pos = 0;
  let guard = 0;
  while (pos < line.length && guard++ < 10000) {
    const top = stack[stack.length - 1];
    const g = top ? top.grammar : rootGrammar;
    const pats = resolve(top ? top.rule.patterns : rootGrammar.patterns, g, []);
    let best: MatchCandidate | null = null;
    if (top) {
      const r = rx(top.endSrc);
      r.lastIndex = pos;
      const m = r.exec(line);
      if (m) best = { m, kind: 'end' };
    }
    for (const { rule, grammar } of pats) {
      const patternSrc = rule.match || rule.begin;
      if (!patternSrc) continue;
      const r = rx(patternSrc);
      r.lastIndex = pos;
      const m = r.exec(line);
      if (!m) continue;
      if (!best || m.index < best.m.index) {
        best = { m, kind: rule.match ? 'match' : 'begin', rule, grammar };
      }
    }
    if (!best) {
      emit(line.slice(pos));
      pos = line.length;
      break;
    }
    const { m } = best;
    emit(line.slice(pos, m.index));
    if (best.kind === 'end') {
      stack.pop();
      // end captures use the popped rule's scope
      const popped = top!;
      stack.push({ ...popped, inContent: false });
      applyCaptures(m, popped.rule.endCaptures || popped.rule.captures, []);
      stack.pop();
      pos = m.index + m[0].length;
      if (m[0].length === 0) {
        if (m.index >= line.length) break;
      }
    } else if (best.kind === 'match') {
      applyCaptures(m, best.rule.captures, [best.rule.name]);
      pos = m.index + Math.max(1, m[0].length);
      if (m[0].length === 0) pos = m.index + 1;
    } else {
      const rule = best.rule;
      const endSrc = (rule.end || '').replace(/\\(\d)/g, (_, n: string) => m[Number(n)] || '');
      stack.push({ rule, grammar: best.grammar, endSrc, inContent: false });
      const entry = stack[stack.length - 1];
      applyCaptures(m, rule.beginCaptures || rule.captures, []);
      entry.inContent = !!rule.contentName;
      pos = m.index + m[0].length;
      if (m[0].length === 0) pos = Math.max(pos, m.index);
    }
  }
  return tokens;
}

export function tokenize(scopeName: string, text: string): TmToken[] {
  const g = grammars[scopeName];
  if (!g) throw new Error('no grammar ' + scopeName);
  const stack: StackEntry[] = [];
  const all: TmToken[] = [];
  for (const line of text.split(/\r?\n/)) {
    all.push(...tokenizeLine(line, stack, g), { text: '\n', scopes: [] });
  }
  return all;
}

/** true if some token with exactly this text has a scope containing `scope` */
export function has(tokens: readonly TmToken[], text: string, scope: string): boolean {
  return tokens.some((t) => t.text === text && t.scopes.some((s) => s.includes(scope)));
}
