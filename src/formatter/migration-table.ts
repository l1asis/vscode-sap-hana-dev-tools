import { format } from './formatter';
import {
  EditorOptions,
  PartialFormatterOptions,
  ResolvedFormatterOptions,
  resolveOptions,
} from './options';
import { finalizeDocument, normalizeCommentText } from './shared';

const MARKER_RE = /^\s*==\s*(version|dev-version|migration)\s*=\s*(\d+)\s*((?:\/\*|--).*)?$/i;
const PRAGMA_OFF_LINE_RE = /(?:--|\/\*)\s*hanasql-format\s*:?\s*off\b/i;
const PRAGMA_ON_LINE_RE = /(?:--|\/\*)\s*hanasql-format\s*:?\s*on\b/i;

interface MigrationSection {
  readonly markerLine: string | null; // null for preamble before first marker
  readonly bodyLines: string[];
}

/**
 * Format `.hdbmigrationtable` files by normalizing `== version` / `== dev-version` / `== migration`
 * section headers and delegating each SQL/DDL body section to the core HANA SQL formatter.
 */
export function formatMigrationTable(
  text: string,
  userOptions?: PartialFormatterOptions | ResolvedFormatterOptions,
  editor?: EditorOptions
): string {
  const o = resolveOptions(userOptions, editor);
  if (o.enable === false || text.trim() === '') {
    return text === '' ? '' : text;
  }

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const sections: MigrationSection[] = [];
  let current: MigrationSection = { markerLine: null, bodyLines: [] };
  let inPragmaOff = false;

  for (const line of lines) {
    if (!inPragmaOff) {
      const m = MARKER_RE.exec(line);
      if (m) {
        if (current.markerLine !== null || current.bodyLines.some((l) => l.trim() !== '')) {
          sections.push(current);
        }
        const kind = m[1].toLowerCase();
        const num = m[2];
        const rawComment = m[3]?.trim();
        let header = `== ${kind} = ${num}`;
        if (rawComment) {
          const isLine = rawComment.startsWith('//') || rawComment.startsWith('--');
          header += ' ' + normalizeCommentText(rawComment, isLine, o);
        }
        current = { markerLine: header, bodyLines: [] };
        continue;
      }
      if (PRAGMA_OFF_LINE_RE.test(line) && !PRAGMA_ON_LINE_RE.test(line)) {
        inPragmaOff = true;
      }
    } else if (PRAGMA_ON_LINE_RE.test(line)) {
      inPragmaOff = false;
    }

    current.bodyLines.push(line);
  }
  sections.push(current);

  const sqlOpts: ResolvedFormatterOptions = {
    ...o,
    insertFinalNewline: false,
    endOfLine: 'lf',
    eol: '\n',
  };

  const out: string[] = [];

  for (let idx = 0; idx < sections.length; idx++) {
    const sec = sections[idx];
    const hasMarker = sec.markerLine !== null;

    // Blank line separator between consecutive non-empty sections / headers
    if (out.length > 0 && hasMarker) {
      out.push('');
    }
    if (hasMarker) {
      out.push(sec.markerLine!);
    }

    // Trim leading/trailing empty lines inside the section body before SQL formatting
    let start = 0;
    while (start < sec.bodyLines.length && sec.bodyLines[start].trim() === '') start++;
    let end = sec.bodyLines.length;
    while (end > start && sec.bodyLines[end - 1].trim() === '') end--;

    if (end > start) {
      const rawBody = sec.bodyLines.slice(start, end).join('\n');
      const formattedBody = format(rawBody, sqlOpts, { ...editor, eol: '\n' })
        .replace(/\r\n?/g, '\n')
        .replace(/\n+$/, '');
      if (formattedBody.length > 0) {
        out.push(...formattedBody.split('\n'));
      }
    }
  }

  return finalizeDocument(out, o);
}
