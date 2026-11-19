/**
 * SQL embedded in another literal, unescaped so the SQL analyzers can check it:
 *
 * - Classic key-value string values `[XSC]`: `.hdbview` `query = "..."` and `.hdbsequence` `reset_by = "..."`
 *   (`\"` -> `"`, `\\` -> `\`, `\n` -> newline, ...; `docs/specs/grammars/hdb-classic-kv.md` §4.3).
 * - Static dynamic SQL literals `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`: `EXEC 'SELECT ''x'' FROM t'` (`''` -> `'`;
 *   `docs/specs/diagnostics/syntax-rules.md` `HANA-SYN-043`).
 *
 * Every SQL character keeps the document offset it came from, so diagnostics and QuickFix edits computed on the SQL
 * map back to exact positions in the host document.
 */
import { type AnalyzerDiagnostic, type CodeFixSuggestion, type TextEditSpan } from './types';

export interface EmbeddedSql {
  /** What the SQL belongs to (`query`, `reset_by`, `EXEC`). */
  readonly key: string;
  /** Unescaped SQL text. */
  readonly sql: string;
  /** Document offset of each SQL character; `map[sql.length]` is the offset of the closing quote. */
  readonly map: readonly number[];
  /** Escapes replacement text for insertion back into the host literal. */
  readonly escape: (text: string) => string;
}

const KV_ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Unescapes the Classic KV string token `doc.slice(start, end)` (quotes included). An unknown escape (`\x`) is kept
 * as written, since the KV grammar defines none.
 */
export function unescapeKvString(doc: string, start: number, end: number, key: string): EmbeddedSql {
  let sql = '';
  const map: number[] = [];
  const close = doc[end - 1] === '"' && end - 1 > start ? end - 1 : end;
  for (let k = start + 1; k < close; k++) {
    const c = doc[k];
    if (c === '\\' && k + 1 < close) {
      const e = KV_ESCAPES[doc[k + 1]];
      if (e !== undefined) {
        sql += e;
        map.push(k);
        k++;
        continue;
      }
    }
    sql += c;
    map.push(k);
  }
  map.push(close);
  return { key, sql, map, escape: (text) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') };
}

/**
 * Unescapes the SQL string literal token `doc.slice(start, end)` (`'...'`, optionally prefixed: `N'...'`): `''` is
 * one quote. Returns `null` when the literal is not closed.
 */
export function unescapeSqlLiteral(doc: string, start: number, end: number, key: string): EmbeddedSql | null {
  const open = doc.indexOf("'", start);
  if (open < 0 || open >= end - 1 || doc[end - 1] !== "'") return null;
  let sql = '';
  const map: number[] = [];
  const close = end - 1;
  for (let k = open + 1; k < close; k++) {
    sql += doc[k];
    map.push(k);
    if (doc[k] === "'" && doc[k + 1] === "'") k++;
  }
  map.push(close);
  return { key, sql, map, escape: (text) => text.replace(/'/g, "''") };
}

function mapOffset(emb: EmbeddedSql, offset: number): number {
  const k = Math.max(0, Math.min(offset, emb.map.length - 1));
  return emb.map[k];
}

/** Maps diagnostics computed on `emb.sql` (offsets relative to it) back to document offsets. */
export function mapEmbeddedDiagnostics(diagnostics: readonly AnalyzerDiagnostic[], emb: EmbeddedSql): AnalyzerDiagnostic[] {
  return diagnostics.map((d) => {
    const fixes: CodeFixSuggestion[] = d.fixes.map((f) => ({
      ...f,
      edits: f.edits.map((e): TextEditSpan => ({ start: mapOffset(emb, e.start), end: mapOffset(emb, e.end), newText: emb.escape(e.newText) })),
    }));
    const start = mapOffset(emb, d.start);
    return { ...d, start, end: Math.max(start, mapOffset(emb, d.end)), fixes };
  });
}

/** Document offset of SQL offset `offset`. */
export function embeddedOffset(emb: EmbeddedSql, offset: number): number {
  return mapOffset(emb, offset);
}
