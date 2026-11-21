/**
 * Syntax checks for the XML (`text.xml.hana`) and CGUL text analysis artifacts (#102).
 * Spec: `docs/specs/diagnostics/syntax-rules.md` (`HANA-SYN-001` .. `-003`, `-012`, `-021`),
 * `docs/specs/grammars/hana-xml.md` §5 and `docs/specs/grammars/cgul-text-analysis.md` §2 / §5.
 */
import { analyzeDelimiters, type DelimTokenInput } from './delimiters';
import { matchKeywordTypo } from './typo';
import type { AnalyzerDiagnostic } from './types';
import { parseXmlTree, type XmlErrorKind } from './xml-parser';

/** XML artifact languages checked for well-formedness. Calculation views report `HANA-LINT-101` instead. */
export const XML_SYNTAX_LANGUAGES: readonly string[] = [
  'analyticprivilege',
  'analyticview',
  'attributeview',
  'hdbanalyticprivilege',
  'hdbflowgraph',
  'hdbreptask',
  'hdbsearchruleset',
  'hdbtextconfig',
  'hdbtextdict',
  'hdbtextminingconfig',
  'hdbdecisiontable',
  'xswidget',
  'xscprocedure',
  'xscxmlmodel',
];

/** CGUL text analysis rule languages (`cgul-text-analysis.md`). */
export const CGUL_SYNTAX_LANGUAGES: readonly string[] = ['hdbtextrule', 'hdbtextinclude', 'hdbtextlexicon'];

const XML_RULE: Readonly<Record<XmlErrorKind, string>> = {
  'unterminated-value': 'HANA-SYN-001',
  'unterminated-cdata': 'HANA-SYN-001',
  'unterminated-comment': 'HANA-SYN-002',
  'unterminated-pi': 'HANA-SYN-003',
  'unterminated-declaration': 'HANA-SYN-003',
  'unterminated-tag': 'HANA-SYN-003',
  'unterminated-close-tag': 'HANA-SYN-003',
  'mismatched-close': 'HANA-SYN-003',
  'unexpected-close': 'HANA-SYN-003',
  'unclosed-element': 'HANA-SYN-003',
  attribute: 'HANA-SYN-012',
};

/** XML well-formedness (`hana-xml.md` §5) as `HANA-SYN-001` / `-002` / `-003` / `-012`. */
export function analyzeXmlSyntax(text: string): AnalyzerDiagnostic[] {
  return parseXmlTree(text).errors.map((e) => ({
    ruleId: XML_RULE[e.kind],
    category: 'syntax',
    severity: 'error',
    message: `${e.message}.`,
    start: e.start,
    end: e.end,
    fixes: [],
  }));
}

/** Directives of `cgul-text-analysis.md` §3.1, lower case, without `#`. */
const CGUL_DIRECTIVES: readonly string[] = [
  'include',
  'lexicon',
  'define',
  'group',
  'subgroup',
  'index',
  'feature',
  'category',
  'priority',
  'language',
  'encoding',
  'version',
];

function syn(ruleId: string, message: string, start: number, end: number): AnalyzerDiagnostic {
  return { ruleId, category: 'syntax', severity: 'error', message, start, end, fixes: [] };
}

/** End of the line holding `i` (before `\r` / `\n`). */
function lineEnd(text: string, i: number): number {
  let j = i;
  while (j < text.length && text[j] !== '\n' && text[j] !== '\r') j++;
  return j;
}

/**
 * CGUL lexical pass (`cgul-text-analysis.md` §2, §5.1): unterminated strings and block comments, unbalanced
 * `( )` / `{ }` and single-line `< >` tokens / `[ ]` character classes, and misspelled `#` directives.
 * Strings use backslash escapes and end at the end of the line. Inside `<...>` only `"` starts a string, and the
 * content of `[...]` is literal.
 */
export function analyzeCgulSyntax(text: string): AnalyzerDiagnostic[] {
  const out: AnalyzerDiagnostic[] = [];
  const delims: DelimTokenInput[] = [];
  const n = text.length;
  let lineStart = true;
  let i = 0;

  /** Unterminated strings: they swallowed the closers after them on their line (`syntax-rules.md` `HANA-SYN-001`). */
  const unterminated: Array<{ readonly start: number; readonly lineStart: number }> = [];

  /** Scans a string starting at `i`; returns the index after it. Reports it when the line ends first. */
  const scanString = (from: number): number => {
    const quote = text[from];
    let j = from + 1;
    while (j < n && text[j] !== '\n' && text[j] !== '\r') {
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text[j] === quote) return j + 1;
      j++;
    }
    out.push(syn('HANA-SYN-001', 'Unterminated string literal.', from, Math.max(from + 1, Math.min(j, from + 24))));
    unterminated.push({ start: from, lineStart: text.lastIndexOf('\n', from) + 1 });
    return j;
  };

  while (i < n) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      lineStart = true;
      i++;
      continue;
    }
    if (/[ \t\f\v\uFEFF]/.test(ch)) {
      i++;
      continue;
    }
    const atLineStart = lineStart;
    lineStart = false;

    if ((ch === '/' && text[i + 1] === '/') || (ch === '-' && text[i + 1] === '-')) {
      i = lineEnd(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        out.push(syn('HANA-SYN-002', "Unterminated block comment '/*'.", i, i + 2));
        break;
      }
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      i = scanString(i);
      continue;
    }

    if (ch === '#' && atLineStart) {
      let j = i + 1;
      while (j < n && /[A-Za-z_]/.test(text[j])) j++;
      const word = text.slice(i + 1, j);
      if (word && !CGUL_DIRECTIVES.includes(word.toLowerCase())) {
        const fix = matchKeywordTypo(word, CGUL_DIRECTIVES, { allowShort: true, lowercase: true });
        if (fix) {
          out.push({
            ruleId: 'HANA-SYN-021',
            category: 'syntax',
            severity: 'error',
            message: `Unknown CGUL directive '#${word}'. Did you mean '#${fix}'?`,
            start: i,
            end: j,
            fixes: [{ title: `Replace with '#${fix}'`, kind: 'quickfix', isPreferred: true, edits: [{ start: i + 1, end: j, newText: fix }] }],
          });
        }
      }
      i = j;
      continue;
    }

    // `<...>` token spec or `#include <path>`: single line; `=>` / `->` are operators, not closers.
    if (ch === '<') {
      let j = i + 1;
      let closed = false;
      while (j < n && text[j] !== '\n' && text[j] !== '\r') {
        if (text[j] === '"') {
          j = scanString(j);
          continue;
        }
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '>') {
          closed = true;
          j++;
          break;
        }
        // Tokens do not nest: a second `<` starts the next token, so this one is unclosed.
        if (text[j] === '<') break;
        j++;
      }
      if (!closed) out.push(syn('HANA-SYN-003', "Unclosed delimiter '<'.", i, i + 1));
      i = j;
      continue;
    }
    if (ch === '>' && text[i - 1] !== '=' && text[i - 1] !== '-') {
      out.push(syn('HANA-SYN-003', "Unmatched closing delimiter '>'.", i, i + 1));
      i++;
      continue;
    }

    // `[...]` character class or slot binding: single line, literal content.
    if (ch === '[') {
      let j = i + 1;
      let closed = false;
      while (j < n && text[j] !== '\n' && text[j] !== '\r') {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === ']') {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (!closed) out.push(syn('HANA-SYN-003', "Unclosed delimiter '['.", i, i + 1));
      i = j;
      continue;
    }
    if (ch === ']') {
      out.push(syn('HANA-SYN-003', "Unmatched closing delimiter ']'.", i, i + 1));
      i++;
      continue;
    }

    if (ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      delims.push({ ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    i++;
  }

  for (const d of analyzeDelimiters(text, delims).diagnostics) {
    // An opener before an unterminated string on the same line was most likely closed inside the swallowed text.
    if (d.kind === 'unclosed-open' && unterminated.some((u) => u.start > d.start && u.lineStart <= d.start)) continue;
    out.push(syn('HANA-SYN-003', d.message, d.start, d.end));
  }
  return out.sort((a, b) => a.start - b.start);
}
