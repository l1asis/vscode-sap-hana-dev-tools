/**
 * Embedded SQL inside Classic key-value string values `[XSC]`: `.hdbview` `query = "..."` and `.hdbsequence`
 * `reset_by = "..."` (`docs/specs/grammars/hdb-classic-kv.md` §4.3).
 *
 * The value is unescaped (`\"` -> `"`, `\\` -> `\`, `\n` -> newline, ...) into plain SQL that the SQL analyzers
 * can check. Every character keeps the document offset it came from, so diagnostics and QuickFix edits computed
 * on the SQL map back to exact positions in the KV file.
 */
import { type AnalyzerDiagnostic, type CodeFixSuggestion, type TextEditSpan } from './types';

export interface EmbeddedSql {
  /** The key the SQL belongs to (`query`, `reset_by`). */
  readonly key: string;
  /** Unescaped SQL text. */
  readonly sql: string;
  /** Document offset of each SQL character; `map[sql.length]` is the offset of the closing quote. */
  readonly map: readonly number[];
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Unescapes the string token `doc.slice(start, end)` (quotes included). An unknown escape (`\x`) is kept as written,
 * since the KV grammar defines none.
 */
export function unescapeKvString(doc: string, start: number, end: number, key: string): EmbeddedSql {
  let sql = '';
  const map: number[] = [];
  const close = doc[end - 1] === '"' && end - 1 > start ? end - 1 : end;
  for (let k = start + 1; k < close; k++) {
    const c = doc[k];
    if (c === '\\' && k + 1 < close) {
      const e = SIMPLE_ESCAPES[doc[k + 1]];
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
  return { key, sql, map };
}

/** Escapes replacement text for insertion into a KV string (`"` and `\`). */
function escapeForKv(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
      edits: f.edits.map((e): TextEditSpan => ({ start: mapOffset(emb, e.start), end: mapOffset(emb, e.end), newText: escapeForKv(e.newText) })),
    }));
    const start = mapOffset(emb, d.start);
    return { ...d, start, end: Math.max(start, mapOffset(emb, d.end)), fixes };
  });
}
