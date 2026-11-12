'use strict';
/**
 * Minimal TextMate grammar engine for tests (no dependencies).
 * Supports match/begin/end/patterns/include (local, external scope, scope#repo),
 * captures, name/contentName. Enough to verify the shipped grammars.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'syntaxes');
const grammars = {};
for (const f of fs.readdirSync(dir)) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  grammars[g.scopeName] = g;
}

// VS Code ships source.json; a tiny stand-in is enough for the tests
grammars['source.json'] = { scopeName: 'source.json', patterns: [{ name: 'string.quoted.double.json', begin: '"', end: '"' }] };

grammars['source.js'] = { scopeName: 'source.js', patterns: [{ name: 'string.quoted.double.js', begin: '"', end: '"' }, { name: 'keyword.control.js', match: '\\b(?:var|function|return)\\b' }, { name: 'support.function.js', match: '\\b[A-Za-z_]\\w*(?=\\()' }] };

const cache = new Map();
function rx(src) {
  let flags = 'dg';
  if (src.startsWith('(?i)')) { src = src.slice(4); flags += 'i'; }
  const key = flags + src;
  if (!cache.has(key)) cache.set(key, new RegExp(src, flags));
  const r = cache.get(key);
  r.lastIndex = 0;
  return r;
}

function resolve(patterns, grammar, out, seen = new Set()) {
  for (const p of patterns || []) {
    if (p.include) {
      let g = grammar;
      let name = p.include;
      if (name.startsWith('#')) name = name.slice(1);
      else {
        const [scope, repo] = name.split('#');
        g = grammars[scope];
        if (!g) throw new Error('unknown grammar ' + scope);
        if (!repo) { resolve(g.patterns, g, out, seen); continue; }
        name = repo;
      }
      const target = g.repository && g.repository[name];
      if (!target) throw new Error(`unknown repository item ${p.include} in ${grammar.scopeName}`);
      const k = g.scopeName + '#' + name;
      if (seen.has(k)) continue;
      seen.add(k);
      if (target.match || target.begin) out.push({ rule: target, grammar: g });
      else resolve(target.patterns, g, out, seen);
    } else out.push({ rule: p, grammar: grammar });
  }
  return out;
}

function tokenizeLine(line, stack, rootGrammar) {
  const tokens = [];
  const scopesOf = () => stack.flatMap((s) => [s.rule.name, s.inContent ? s.rule.contentName : null]).filter(Boolean);
  const base = [rootGrammar.scopeName];
  const emit = (text, extra = []) => { if (text) tokens.push({ text, scopes: [...base, ...scopesOf(), ...extra.filter(Boolean)] }); };

  const applyCaptures = (m, caps, extra) => {
    // m.indices from the 'd' flag
    const start = m.index, end = m.index + m[0].length;
    if (!caps) { emit(m[0], extra); return; }
    let pos = start;
    const items = Object.keys(caps).map(Number).filter((i) => m.indices[i]).sort((a, b) => m.indices[a][0] - m.indices[b][0] || a - b);
    for (const i of items) {
      const [s, e] = m.indices[i];
      if (s < pos) continue;
      emit(line.slice(pos, s), extra);
      emit(line.slice(s, e), [...extra, caps[i].name]);
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
    let best = null;
    if (top) {
      const r = rx(top.endSrc); r.lastIndex = pos;
      const m = r.exec(line);
      if (m) best = { m, kind: 'end' };
    }
    for (const { rule, grammar } of pats) {
      const r = rx(rule.match || rule.begin); r.lastIndex = pos;
      const m = r.exec(line);
      if (!m) continue;
      if (!best || m.index < best.m.index) best = { m, kind: rule.match ? 'match' : 'begin', rule, grammar };
    }
    if (!best) { emit(line.slice(pos)); pos = line.length; break; }
    const { m } = best;
    emit(line.slice(pos, m.index));
    if (best.kind === 'end') {
      stack.pop();
      // end captures use the popped rule's scope
      const popped = top;
      const saved = stack.length;
      stack.push({ ...popped, inContent: false });
      applyCaptures(m, popped.rule.endCaptures || (popped.rule.captures), []);
      stack.pop();
      pos = m.index + m[0].length;
      if (m[0].length === 0) { if (m.index >= line.length) break; }
    } else if (best.kind === 'match') {
      applyCaptures(m, best.rule.captures, [best.rule.name]);
      pos = m.index + Math.max(1, m[0].length) - (m[0].length ? 0 : 0);
      if (m[0].length === 0) pos = m.index + 1;
    } else {
      const rule = best.rule;
      const endSrc = rule.end.replace(/\\(\d)/g, (_, n) => m[Number(n)] || '');
      stack.push({ rule, grammar: best.grammar, endSrc, inContent: false });
      const entry = stack[stack.length - 1];
      const saved = entry.rule;
      applyCaptures(m, rule.beginCaptures || rule.captures, []);
      entry.inContent = !!rule.contentName;
      pos = m.index + m[0].length;
      if (m[0].length === 0) pos = Math.max(pos, m.index);
    }
  }
  return tokens;
}

function tokenize(scopeName, text) {
  const g = grammars[scopeName];
  if (!g) throw new Error('no grammar ' + scopeName);
  const stack = [];
  const all = [];
  for (const line of text.split(/\r?\n/)) all.push(...tokenizeLine(line, stack, g), { text: '\n', scopes: [] });
  return all;
}

/** true if some token with exactly this text has a scope containing `scope` */
function has(tokens, text, scope) {
  return tokens.some((t) => t.text === text && t.scopes.some((s) => s.includes(scope)));
}

module.exports = { tokenize, has, grammars };
