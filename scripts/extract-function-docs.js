#!/usr/bin/env node
'use strict';
/**
 * Local-only (#43): distills built-in function documentation from the extracted SAP reference corpus
 * (research/refs/extracted/, git-ignored) into docs/specs/catalogs/builtin-functions.json.
 *
 *   node scripts/extract-function-docs.js            report what would change (no writes)
 *   node scripts/extract-function-docs.js --write    merge into builtin-functions.json, then run npm run build:keywords
 *   node scripts/extract-function-docs.js --draft    also write research/function-docs/draft.json for review
 *
 * Merge policy (never loses curated metadata):
 *   - an entry whose signatures are a `NAME(...)` placeholder, or whose description is generator boilerplate,
 *     takes the extracted signatures, description, return type and parameters;
 *   - any other entry only gains fields it does not have yet (params, platforms, kind, receiverType, source, ...);
 *   - `--add` also appends functions that are documented but missing from the catalog.
 *
 * Parsers: SQL Reference `## NAME Function (Category)` chapters, Spatial Reference method / constructor chapters,
 * Property Graph Engine Reference `NAME(ARG) => TYPE` built-ins. Spec: docs/specs/diagnostics/sql-intellisense.md §6.
 * Never run in CI.
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib/sql-catalog');

const CORPUS = path.join(lib.ROOT, 'research', 'refs', 'extracted');
const ON_PREM = ['XSC', 'XSA', 'HDI'];
const CLOUD = ['CLOUD'];

const GUIDES = {
  platformSql: { dir: 'SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_for_SAP_HANA_Platform', platforms: ON_PREM },
  cloudSql: { dir: 'hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_SQL_Reference_Guide', platforms: CLOUD },
  platformSqlScript: { dir: 'SAP_HANA_PLATFORM_SAP_HANA_SQLScript_Reference_for_SAP_HANA_Platform', platforms: ON_PREM },
  cloudSqlScript: { dir: 'hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_SQLScript_Reference', platforms: CLOUD },
  // prebuilt PDFs: lines are not clipped at the page margin (SPEC_RULES §1.7); used to complete clipped signatures
  platformSqlEn: { dir: 'SAP_HANA_PLATFORM_SAP_HANA_SQL_Reference_Guide_en', platforms: ON_PREM },
  platformSqlScriptEn: { dir: 'SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en', platforms: ON_PREM },
  platformSpatial: { dir: 'SAP_HANA_PLATFORM_SAP_HANA_Spatial_Reference_en', platforms: ON_PREM },
  cloudSpatial: { dir: 'hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Spatial_Reference', platforms: CLOUD },
  cloudGraph: { dir: 'hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Property_Graph_Engine_Refe', platforms: CLOUD },
  platformGraph: { dir: 'SAP_HANA_PLATFORM_SAP_HANA_Graph_Reference_en', platforms: ['XSA', 'HDI'] },
};

/** SQL Reference chapter category -> catalog category (only used to split `misc`). */
const SQL_REF_CATEGORY = {
  Array: 'array',
  Fulltext: 'fulltext',
  JSON: 'json',
  'Series Data': 'series',
  Security: 'security',
  Vector: 'vector',
  AI: 'ai',
  Miscellaneous: 'misc',
};

/** SQL Reference chapter category -> catalog category for functions the catalog does not have yet. */
const REF_TO_CATEGORY = {
  ...SQL_REF_CATEGORY,
  String: 'string',
  Datetime: 'datetime',
  Numeric: 'numeric',
  'Data Type Conversion': 'conversion',
  Aggregate: 'aggregate',
  Window: 'window',
};

// ---- text helpers ------------------------------------------------------------------------------------------------

const readChapters = (dir) => {
  const abs = path.join(CORPUS, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => /^\d+_.*\.md$/.test(f) && !/_Content\.md$/.test(f))
    .sort()
    .map((f) => ({ file: `${dir}/${f}`, lines: fs.readFileSync(path.join(abs, f), 'utf8').split(/\r?\n/) }));
};

/** Undoes PDF line-wrap hyphenation inside table cells (`param- eter` -> `parameter`). */
const dehyphen = (s) => s.replace(/([a-z])- ([a-z])/g, '$1$2');
const squash = (s) => dehyphen(s.replace(/\s+/g, ' ').trim());
/** First sentence (or the whole text when short). */
const firstSentence = (s) => {
  const t = squash(s);
  const m = t.match(/^(.*?[.!?])(?:\s|$)/);
  return m && m[1].length >= 20 ? m[1] : t;
};
const normalizeSignature = (s) =>
  squash(s)
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .replace(/\s+,/g, ',')
    .replace(/^(\w+)\s+\(/, '$1(');

/** `{ start, end }` index ranges of chapters between `isHeading` lines. */
function sections(lines, isHeading) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = isHeading(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !/^#{1,3} /.test(lines[j])) j++;
    out.push({ match: m, start: i, end: j });
  }
  return out;
}

/** Fenced blocks (`text` / `ebnf` / `sql`) in lines[a..b) with their position. */
function fences(lines, a, b) {
  const out = [];
  for (let i = a; i < b; i++) {
    const m = lines[i].match(/^```(\w*)\s*$/);
    if (!m) continue;
    let j = i + 1;
    while (j < b && !/^```\s*$/.test(lines[j])) j++;
    out.push({ lang: m[1], start: i, end: j, body: lines.slice(i + 1, j) });
    i = j;
  }
  return out;
}

// ---- return type inference ---------------------------------------------------------------------------------------

const TYPE_WORDS =
  'TINYINT|SMALLINT|INTEGER|INT|BIGINT|DECIMAL|SMALLDECIMAL|REAL|DOUBLE|FLOAT|BOOLEAN|VARCHAR|NVARCHAR|ALPHANUM|SHORTTEXT|VARBINARY|BLOB|CLOB|NCLOB|TEXT|DATE|TIME|SECONDDATE|TIMESTAMP|ST_GEOMETRY|ST_POINT|REAL_VECTOR|HALF_VECTOR|JSON|ARRAY|TABLE';
const TYPE_RE = new RegExp(`\\b(${TYPE_WORDS})\\b`);

/** Best-effort return type from reference prose; `null` when the text does not say. */
function inferReturnType(text) {
  const t = squash(text);
  const T = `\`?(${TYPE_WORDS})\`?`;
  const sized = t.match(new RegExp(`(?:Return Type|returns?|of type) \`?((?:${TYPE_WORDS})\\(\\d+(?:, ?\\d+)?\\))`, 'i'));
  if (sized) return sized[1].toUpperCase();
  const label = t.match(new RegExp(`\\bReturn Type:? ${T}`));
  if (label) return label[1].toUpperCase();
  if (/\bas an integer value\b/i.test(t) || /\breturns? (?:the value )?1 (?:if|when)\b[^.]*\b0\b/i.test(t) || /\bA 1 \([^)]*\) is returned\b/.test(t)) return 'INTEGER';
  const patterns = [
    new RegExp(`\\b(?:as|is) an? ${T} value\\b`, 'i'),
    new RegExp(`\\breturns?\\b[^.]{0,60}?\\bof type ${T}`, 'i'),
    new RegExp(`(?:return|result|output) (?:data )?type (?:is|of the function is|of this function is)(?: an?)? ${T}`, 'i'),
    new RegExp(`returns? (?:an?|the)? ?(?:value|values|result) (?:of|with) (?:the )?(?:data )?type ${T}`, 'i'),
    new RegExp(`returns? (?:an?|the)? ?(?:[\\w-]+ ){0,2}${T} (?:value|string|number|data type|type|representation|hash|object|array)\\b`, 'i'),
    new RegExp(`\\b(?:is|are) returned as (?:an? )?${T}`, 'i'),
    new RegExp(`\\breturns? (?:an? )?${T}(?: value)?(?:[.,;]|$)`, 'i'),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return m[1].toUpperCase() === 'INT' ? 'INTEGER' : m[1].toUpperCase();
  }
  if (/Result type based on input/i.test(t)) return 'numeric (by input type)';
  return null;
}

// ---- SQL Reference ---------------------------------------------------------------------------------------------------

function parseSqlReference(guide) {
  const out = new Map();
  for (const ch of readChapters(guide.dir)) {
    const L = ch.lines;
    // `## NAME Function (Category)` (Custom PDF chapters) or `### 4.9.1.9 NAME Function (Category)` (prebuilt `_en` PDFs)
    for (const s of sections(L, (l) => l.match(/^#{2,3} (?:[\d.]+\s+)?(?:Text Mining: )?([A-Z][A-Z0-9_]*) Function(?: \(([^)]+)\))?\s*$/))) {
      const name = s.match[1];
      const refCategory = s.match[2] || null;
      const body = L.slice(s.start + 1, s.end);
      const at = (label) => body.findIndex((l) => l.replace(/^#{3,5}\s+/, '').replace(/:$/, '').trim() === label);
      const iSyntax = at('Syntax');
      const iElems = at('Syntax Elements');
      const iDesc = at('Description');
      const summary = body.slice(0, iSyntax < 0 ? 3 : iSyntax).filter((l) => l.trim() && !l.startsWith('>')).join(' ');
      const synEnd = [iElems, iDesc].filter((x) => x > iSyntax).sort((a, b) => a - b)[0] ?? body.length;
      const signatures = [];
      const productions = new Map();
      for (const f of fences(body, Math.max(0, iSyntax), synEnd)) {
        let cur = '';
        const flush = () => {
          // `COUNT(*) | COUNT([ALL] <expression>)`: one signature per top-level alternative
          if (cur.trim()) for (const alt of cur.split(new RegExp(`\\s\\|\\s*(?=${name}\\s*\\()`, 'i'))) signatures.push(normalizeSignature(alt));
          cur = '';
        };
        for (const raw of f.body) {
          const line = raw.trim();
          const prod = line.match(/^<([\w ]+)>\s*::=\s*(.*)$/);
          if (prod) {
            flush();
            productions.set(prod[1].trim(), squash(prod[2]));
            continue;
          }
          if (!line) {
            flush();
            continue;
          }
          if (new RegExp(`^${name}\\b`, 'i').test(line) && cur) flush();
          if (cur || new RegExp(`^${name}\\b`, 'i').test(line)) cur += ' ' + line;
          else if (productions.size) {
            const last = [...productions.keys()].pop();
            productions.set(last, squash(productions.get(last) + ' ' + line));
          }
        }
        flush();
      }
      // Syntax Elements: `<param>` lines followed by description lines
      const params = [];
      if (iElems >= 0) {
        const stop = body.findIndex((l, k) => k > iElems && (/^Description\s*$/.test(l) || /^> \*\*Example/.test(l) || /^Related Information/.test(l)));
        let cur = null;
        for (const raw of body.slice(iElems + 1, stop < 0 ? body.length : stop)) {
          const line = raw.trim();
          if (/^```/.test(line)) continue;
          const pm = line.match(/^<([\w ]+)>$/);
          const prod = line.match(/^<([\w ]+)>\s*::=\s*(.*)$/);
          if (prod) {
            productions.set(prod[1].trim(), squash(prod[2]));
            continue;
          }
          if (pm) {
            cur = { name: pm[1].trim(), description: '' };
            params.push(cur);
          } else if (cur && line && !line.startsWith('|')) {
            cur.description += ' ' + line;
          }
        }
      }
      const description = iDesc >= 0 ? body.slice(iDesc + 1).filter((l) => !/^```/.test(l)).join(' ') : '';
      const exampleAt = description.search(/> \*\*Example/);
      const descText = exampleAt >= 0 ? description.slice(0, exampleAt) : description;
      // Output columns of table functions, and the "Result type based on input" mapping of aggregates
      let returnDescription = null;
      let tableResult = false;
      const iCols = body.findIndex((l) => /returns a table with the following columns/i.test(l));
      if (iCols >= 0) {
        const cols = [];
        for (const row of body.slice(iCols + 1)) {
          if (cols.length && !row.startsWith('|')) break;
          const c = row.split('|').map((x) => x.trim());
          if (c.length >= 4 && c[1] && !/^(Column Name|-+)$/.test(c[1])) cols.push(`${c[1]} ${c[2]}`);
        }
        if (cols.length) {
          tableResult = true;
          returnDescription = `Columns: ${cols.join(', ')}.`;
        }
      }
      const iMap = body.findIndex((l) => /Result type based on input/i.test(l));
      if (iMap >= 0) {
        const rows = body.slice(iMap + 1, iMap + 12).filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l)).map((l) => l.split('|').slice(1, -1).map((x) => x.trim().replace(/`/g, '')));
        if (rows.length >= 2 && rows[0].length === rows[1].length) {
          returnDescription = `By input type: ${rows[0].map((from, k) => `${from} -> ${rows[1][k].replace(/\s*\*$/, '')}`).join(', ')}.`;
        }
      }
      out.set(name, {
        name,
        refCategory,
        summary: firstSentence(summary || descText),
        signatures: [...new Set(signatures)],
        params: params.map((p) => ({
          name: p.name,
          ...(productions.has(p.name) ? { values: productions.get(p.name) } : {}),
          description: firstSentence(p.description) || (productions.has(p.name) ? `One of: ${productions.get(p.name)}` : ''),
        })),
        productions: Object.fromEntries(productions),
        returnType: tableResult ? 'TABLE' : inferReturnType(`${summary} ${body.slice(iSyntax < 0 ? 0 : iSyntax).filter((l) => !/^```/.test(l)).join(' ').split('> **Example')[0]}`),
        ...(returnDescription ? { returnDescription } : {}),
        ...(tableResult ? { kind: 'table-function' } : {}),
        source: `${ch.file} § ${L[s.start].replace(/^## /, '')}`,
      });
    }
  }
  return out;
}

// ---- Spatial Reference --------------------------------------------------------------------------------------------

function parseSpatialReference(guide) {
  const out = new Map();
  for (const ch of readChapters(guide.dir)) {
    const L = ch.lines;
    const heads = sections(L, (l) => l.match(/^#{2,4} (?:[\d.]+\s+)?(ST_\w+)(\([^)]*\))? (Method|Constructor|Function|Static Method|Aggregate Method)\s*$/));
    for (const s of heads) {
      const [, display, overload, kindWord] = s.match;
      const name = display.toUpperCase();
      const body = L.slice(s.start + 1, s.end);
      const summary = body.find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|')) || '';
      const signatures = [];
      for (const f of fences(body, 0, body.length)) {
        if (f.lang && f.lang !== 'text') continue;
        let sig = squash(f.body.join(' '));
        if (!new RegExp(display.replace(/_/g, '_'), 'i').test(sig)) continue;
        signatures.push(normalizeSignature(sig));
      }
      if (!signatures.length) {
        // `<lineString>.`ST_LineInterpolatePoint`(<fraction>)` written as inline code instead of a fence
        const iSyn = body.findIndex((l) => /^#{2,5} Syntax\s*$/.test(l));
        const line = iSyn >= 0 ? (body[iSyn + 1] || '').trim() : '';
        if (/`/.test(line) && new RegExp(display, 'i').test(line)) signatures.push(normalizeSignature(line.replace(/`/g, '')));
      }
      const params = [];
      const iParams = body.findIndex((l) => /^#{2,5} Parameters\s*$/.test(l));
      if (iParams >= 0) {
        for (const row of body.slice(iParams + 1)) {
          if (/^#{2,5} /.test(row)) break;
          const cells = row.split('|').map((c) => c.trim());
          if (cells.length < 4 || cells[1] === 'Name' || /^-+$/.test(cells[1])) continue;
          params.push({ name: cells[1].replace(/[`<>]/g, ''), type: squash(cells[2]), description: firstSentence(cells[3]) });
        }
      }
      let returnType = null;
      let returnDescription = null;
      const iRet = body.findIndex((l) => /^#{2,5} Returns\s*$/.test(l));
      if (iRet >= 0) {
        const text = [];
        for (const l of body.slice(iRet + 1)) {
          if (/^#{2,5} /.test(l) || /^> /.test(l)) break;
          text.push(l);
        }
        const t = squash(text.join(' '));
        const m = t.match(new RegExp(`^((?:ST_\\w+|${TYPE_WORDS}|MULTISET)(?:\\(\\d+\\))?(?: ARRAY)?)(?=\\s|$)\\s*(.*)$`, 'i'));
        if (m) {
          returnType = m[1];
          returnDescription = firstSentence(m[2]);
        }
      }
      const kind = kindWord === 'Constructor' ? 'constructor' : kindWord === 'Function' ? 'function' : kindWord === 'Aggregate Method' || /AGGR$/.test(name) ? 'aggregate' : 'method';
      const receiver = signatures.find((x) => /^<(\w+)>\./.test(x))?.match(/^<(\w+)>\./)?.[1];
      const prev = out.get(name);
      const entry = prev || {
        name,
        kind,
        summary: firstSentence(summary),
        signatures: [],
        params: [],
        returnType,
        ...(returnDescription ? { returnDescription } : {}),
        ...(receiver ? { receiverType: receiver === 'geometry' ? 'ST_Geometry' : receiver.replace(/^(\w)/, (c) => c.toUpperCase()) } : {}),
        source: `${ch.file} § ${L[s.start].replace(/^#+ (?:[\d.]+\s+)?/, '')}`,
      };
      for (const sig of signatures) if (!entry.signatures.includes(sig)) entry.signatures.push(sig);
      for (const p of params) if (!entry.params.some((q) => q.name === p.name)) entry.params.push(p);
      if (!entry.returnType && returnType) entry.returnType = returnType;
      if (overload && kind === 'constructor') entry.returnType = entry.returnType || display;
      out.set(name, entry);
    }
  }
  for (const e of out.values()) if (e.kind === 'constructor' && !e.returnType) e.returnType = e.name;
  return out;
}

// ---- Property Graph Engine Reference ----------------------------------------------------------------------------------

function parseGraphReference(guide) {
  const out = new Map();
  for (const ch of readChapters(guide.dir)) {
    const L = ch.lines;
    let heading = '';
    let summary = '';
    for (let i = 0; i < L.length; i++) {
      const h = L[i].match(/^#{2,3} (.+)$/);
      if (h) {
        heading = h[1];
        summary = (L[i + 1] || '').trim();
        continue;
      }
      const m = L[i].match(/^([A-Z][A-Z_]+)\((.*)\) => (.+)$/);
      if (!m) continue;
      const [, name, args, ret] = m;
      const sig = `${name}(${args
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => (/^</.test(a) ? a : `<${a.toLowerCase()}>`))
        .join(', ')})`;
      const e = out.get(name) || { name, kind: 'function', summary: firstSentence(summary), signatures: [], params: [], returnType: ret.trim().toUpperCase(), source: `${ch.file} § ${heading}` };
      if (!e.signatures.includes(sig)) e.signatures.push(sig);
      out.set(name, e);
    }
  }
  return out;
}

// ---- merge ----------------------------------------------------------------------------------------------------------------

/** Balanced `()` / `[]` / `{}`: a signature that was not clipped by the PDF page margin. */
function balanced(sig) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const c of sig.replace(/'[^']*'/g, '')) {
    if ('([{'.includes(c)) stack.push(c);
    else if (pairs[c] && stack.pop() !== pairs[c]) return false;
  }
  return stack.length === 0;
}
/** A summary that reads like a definition (`Returns ...`, `Converts ...`), not a note. */
const SUMMARY_RE = /^(?:[A-Z][a-z]+s|Is|Gets|Tests)\b/;
/**
 * GraphScript built-ins not cataloged as global functions: their names are SQL words that are followed by `(` in
 * plain SQL (`HIERARCHY(SOURCE (SELECT ...))`), so a global entry would mis-highlight and mis-hover them.
 */
const GRAPH_SKIP = new Set(['SOURCE', 'TARGET']);
/** GraphScript built-ins named like SQL clause words that never precede `(` in plain SQL (`VERTEX TABLE`, `EDGE TABLE`). */
const GRAPH_SQL_SAFE = new Set(['VERTEX', 'EDGE', 'LABEL']);

const PLACEHOLDER_SIG = (f) => f.signatures.length === 1 && f.signatures[0] === `${f.name}(...)`;
const BOILERPLATE = /^Built-in SAP HANA (?:SQL |Spatial |Series Data |Text Mining )?(?:\w+ )*function(?:\/method)? [A-Z0-9_]+ \(|^Built-in SAP HANA SQL function \(/;

function platformsOf(name, sources) {
  const p = new Set();
  for (const s of sources) if (s.map.has(name)) for (const x of s.guide.platforms) p.add(x);
  return lib.PLATFORMS.filter((x) => p.has(x));
}

function merge(model, { add }) {
  const sql = [
    { guide: GUIDES.cloudSql, map: parseSqlReference(GUIDES.cloudSql) },
    { guide: GUIDES.platformSql, map: parseSqlReference(GUIDES.platformSql) },
    { guide: GUIDES.cloudSqlScript, map: parseSqlReference(GUIDES.cloudSqlScript) },
    { guide: GUIDES.platformSqlScript, map: parseSqlReference(GUIDES.platformSqlScript) },
    { guide: GUIDES.platformSqlEn, map: parseSqlReference(GUIDES.platformSqlEn) },
    { guide: GUIDES.platformSqlScriptEn, map: parseSqlReference(GUIDES.platformSqlScriptEn) },
  ];
  const spatial = [
    { guide: GUIDES.platformSpatial, map: parseSpatialReference(GUIDES.platformSpatial) },
    { guide: GUIDES.cloudSpatial, map: parseSpatialReference(GUIDES.cloudSpatial) },
  ];
  const graph = [
    { guide: GUIDES.cloudGraph, map: parseGraphReference(GUIDES.cloudGraph) },
    { guide: GUIDES.platformGraph, map: parseGraphReference(GUIDES.platformGraph) },
  ];
  // Custom-PDF chapters clip long lines (SPEC_RULES §1.7): take each field from the guide where it is complete.
  const doc = (name, group) => {
    const all = group.map((g) => g.map.get(name)).filter(Boolean);
    if (all.length === 0) return undefined;
    const best = { ...all[0] };
    const sigsOk = all.find((d) => d.signatures.length && d.signatures.every(balanced));
    if (sigsOk) best.signatures = sigsOk.signatures;
    best.summary = (all.find((d) => SUMMARY_RE.test(d.summary)) || all[0]).summary;
    best.returnType = all.map((d) => d.returnType).find(Boolean) || null;
    if (!best.params.length) best.params = (all.find((d) => d.params.length) || best).params;
    return best;
  };
  const report = { filled: [], enriched: [], added: [], undocumented: [], noReturnType: [] };

  const fns = model.raw.functions.functions;
  const known = new Set(fns.map((f) => `${f.library}:${f.name}`));
  for (const f of fns) {
    const group = f.category === 'spatial' ? spatial : f.category === 'graphscript' ? graph : f.library === 'SYS' ? sql : null;
    const d = group && doc(f.name, group);
    if (!d) {
      if (PLACEHOLDER_SIG(f)) report.undocumented.push(f.name);
      continue;
    }
    const placeholder = PLACEHOLDER_SIG(f) || BOILERPLATE.test(f.description || '');
    if (placeholder && d.signatures.length) {
      f.signatures = d.signatures;
      f.description = d.summary;
      if (d.returnType) f.returnType = d.returnType;
      else report.noReturnType.push(f.name);
      report.filled.push(f.name);
    } else {
      report.enriched.push(f.name);
    }
    if (!f.params && d.params.length) f.params = d.params;
    if (!f.kind && d.kind) f.kind = d.kind;
    if (!f.receiverType && d.receiverType) f.receiverType = d.receiverType;
    if (!f.returnDescription && d.returnDescription) f.returnDescription = d.returnDescription;
    if (!f.source) f.source = d.source;
    const plats = platformsOf(f.name, group);
    if (plats.length && (!f.platforms || placeholder)) f.platforms = plats;
    if (f.category === 'misc' && d.refCategory && SQL_REF_CATEGORY[d.refCategory] && model.categories.has(SQL_REF_CATEGORY[d.refCategory])) {
      f.category = SQL_REF_CATEGORY[d.refCategory];
    }
  }

  if (add) {
    // SQL Reference functions missing from the catalog, in their chapter's category
    const names = new Set(sql.flatMap((g) => [...g.map.keys()]));
    for (const name of [...names].sort()) {
      if (known.has(`SYS:${name}`)) continue;
      const d = doc(name, sql);
      const category = REF_TO_CATEGORY[d.refCategory];
      if (!category || !d.signatures.length || !d.signatures.every(balanced)) continue;
      fns.push({
        name,
        library: 'SYS',
        category,
        ...(d.kind ? { kind: d.kind } : {}),
        platforms: platformsOf(name, sql),
        signatures: d.signatures,
        ...(d.params.length ? { params: d.params } : {}),
        returnType: d.returnType || 'ANY',
        ...(d.returnDescription ? { returnDescription: d.returnDescription } : {}),
        description: d.summary,
        source: d.source,
      });
      known.add(`SYS:${name}`);
      report.added.push(name);
      if (!d.returnType) report.noReturnType.push(name);
    }
    for (const [group, category, library] of [
      [spatial, 'spatial', 'SYS'],
      [graph, 'graphscript', 'GRAPHSCRIPT'],
    ]) {
      const names = new Set(group.flatMap((g) => [...g.map.keys()]));
      for (const name of [...names].sort()) {
        if (known.has(`${library}:${name}`) || known.has(`SYS:${name}`)) continue;
        if (category === 'graphscript' && (GRAPH_SKIP.has(name) || (model.words.has(name) && !GRAPH_SQL_SAFE.has(name)))) continue;
        const d = doc(name, group);
        if (!d.signatures.length) continue;
        fns.push({
          name,
          library,
          category,
          ...(d.kind ? { kind: d.kind } : {}),
          ...(d.receiverType ? { receiverType: d.receiverType } : {}),
          platforms: platformsOf(name, group),
          signatures: d.signatures,
          ...(d.params.length ? { params: d.params } : {}),
          returnType: d.returnType || 'ANY',
          ...(d.returnDescription ? { returnDescription: d.returnDescription } : {}),
          description: d.summary,
          source: d.source,
        });
        known.add(`${library}:${name}`);
        report.added.push(name);
      }
    }
  }
  return { report, sql, spatial, graph };
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (!fs.existsSync(CORPUS)) {
    console.error(`No corpus at ${path.relative(lib.ROOT, CORPUS)} (local only).`);
    process.exit(1);
  }
  const model = lib.loadCatalog();
  const { report, sql, spatial, graph } = merge(model, { add: args.has('--add') });
  for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v.length}${v.length && v.length <= 60 ? ` (${v.join(', ')})` : ''}`);
  if (args.has('--draft')) {
    const dir = path.join(lib.ROOT, 'research', 'function-docs');
    fs.mkdirSync(dir, { recursive: true });
    const dump = (group) => Object.fromEntries(group.flatMap((g) => [...g.map].map(([k, v]) => [`${g.guide.dir}:${k}`, v])));
    fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify({ sql: dump(sql), spatial: dump(spatial), graph: dump(graph) }, null, 2));
  }
  if (args.has('--write')) {
    const next = lib.loadCatalog(model.raw);
    fs.writeFileSync(lib.FUNCTIONS_PATH, lib.formatFunctionCatalog(next));
    console.log(`wrote ${path.relative(lib.ROOT, lib.FUNCTIONS_PATH)}; now run npm run build:keywords`);
  }
}

if (require.main === module) main();

module.exports = { parseSqlReference, parseSpatialReference, parseGraphReference, inferReturnType, GUIDES };
