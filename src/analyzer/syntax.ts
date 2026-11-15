import { isKeyValueArtifact } from '../formatter/detect';
import { DEDICATED_ARTIFACT_LANGUAGES, JSON_ARTIFACT_LANGUAGES, SQL_LANGUAGES } from '../formatter/dispatch';
import { tokenize, type Token } from '../formatter/tokenizer';
import { parseJsonAstWithErrors } from './json-parser';
import {
  filterSuppressedDiagnostics,
  type AnalyzerContext,
  type AnalyzerDiagnostic,
  type CodeFixSuggestion,
} from './types';

const SQL_SYNTAX_SET = new Set<string>([...SQL_LANGUAGES, 'sql']);
const JSON_SYNTAX_SET = new Set<string>(JSON_ARTIFACT_LANGUAGES);
const CLASSIC_KV_ALWAYS_SET = new Set<string>(['hdbschema', 'hdbti', 'hdbtid', 'hdbtim', 'xshttpdest']);
const DUAL_SQL_KV_SET = new Set<string>(['hdbtable', 'hdbstructure', 'hdbview', 'hdbsequence', 'hdbprocedure']);
const CDS_SET = new Set<string>(['hdbdd', 'hdbcds']);

const SQLSCRIPT_BLOCK_LANGUAGES = new Set<string>([
  'sql',
  'hanasql',
  'hdbprocedure',
  'hdbfunction',
  'hdbtablefunction',
  'hdbtrigger',
  'hdbmigrationtable',
  'procedure',
  'sqlscript',
]);

const MIGRATION_MARKER_RE = /^\s*==\s*(?:version|dev-version|migration)\s*=\s*\d+.*$/i;

const KV_TRAILING_SEMI_OPTIONAL_SET = new Set<string>(['hdbview']);

// Valid SAP HANA SQL statement/DDL keywords at anchor positions so we never flag valid statements.
const VALID_DDL_NOUNS = new Set<string>([
  'PROCEDURE',
  'FUNCTION',
  'TABLE',
  'COLUMN',
  'ROW',
  'VIEW',
  'TRIGGER',
  'LIBRARY',
  'SEQUENCE',
  'INDEX',
  'SCHEMA',
  'SYNONYM',
  'ROLE',
  'USER',
  'USERGROUP',
  'TYPE',
  'COLLECTION',
  'PROJECTION',
  'STATISTICS',
  'STRUCTURED',
  'VIRTUAL',
  'CONSTRAINT',
  'FULLTEXT',
  'FUZZY',
  'RESULT',
  'GRAPH',
  'SCHEDULER',
  'REMOTE',
  'SHARED',
  'AUDIT',
  'CERTIFICATE',
  'PSE',
  'JWT',
  'SAML',
  'LDAP',
  'X509',
  'WORKLOAD',
  'AGENT',
  'ADAPTER',
  'SUBSCRIPTION',
  'TASK',
  'FLOWGRAPH',
  'CREDENTIAL',
]);

const VALID_DDL_MODIFIERS = new Set<string>([
  'OR',
  'REPLACE',
  'GLOBAL',
  'LOCAL',
  'TEMPORARY',
  'PUBLIC',
  'UNIQUE',
  'ONLINE',
  'HISTORY',
  'SYSTEM',
  'APPLICATION',
  'NO',
  'LOGGING',
  'HASH',
  'BLOCK',
  'RANGE',
  'BTREE',
  'CPBTREE',
  'INVERTED',
  'ADJACENCY',
  'SEARCH',
]);

const DDL_TYPO_CANDIDATES: readonly string[] = [
  'PROCEDURE',
  'FUNCTION',
  'TABLE',
  'COLUMN',
  'ROW',
  'VIEW',
  'TRIGGER',
  'LIBRARY',
  'SEQUENCE',
  'INDEX',
  'SCHEMA',
  'SYNONYM',
  'ROLE',
  'USER',
  'TYPE',
  'COLLECTION',
  'PROJECTION',
  'STATISTICS',
  'STRUCTURED',
  'VIRTUAL',
  'CONSTRAINT',
];

const SHORTHAND_TYPOS: Readonly<Record<string, string>> = {
  FUNC: 'FUNCTION',
  FN: 'FUNCTION',
  PROC: 'PROCEDURE',
  PRC: 'PROCEDURE',
  TRIG: 'TRIGGER',
  LIB: 'LIBRARY',
  TAB: 'TABLE',
  TBL: 'TABLE',
  SEQ: 'SEQUENCE',
  SYN: 'SYNONYM',
  PRIV: 'PRIVILEGE',
  STRUCT: 'STRUCTURE',
  COL: 'COLUMN',
  ROL: 'ROLE',
  SCHED: 'SCHEDULER',
  STATS: 'STATISTICS',
};

const HDI_ROOT_TARGETS: Readonly<Record<string, readonly string[]>> = {
  hdbprocedure: ['PROCEDURE', 'CREATE'],
  hdbfunction: ['FUNCTION', 'CREATE'],
  hdbtablefunction: ['FUNCTION', 'CREATE'],
  hdbtrigger: ['TRIGGER', 'CREATE'],
  hdblibrary: ['LIBRARY', 'CREATE'],
  hdbtable: ['COLUMN', 'ROW', 'GLOBAL', 'LOCAL', 'TEMPORARY', 'TABLE', 'CREATE', 'HISTORY', 'VIRTUAL'],
  hdbstructure: ['TYPE', 'CREATE', 'COLUMN', 'ROW'],
  hdbtabletype: ['TYPE', 'CREATE', 'COLUMN', 'ROW'],
  hdbview: ['VIEW', 'PROJECTION', 'CREATE'],
  hdbsequence: ['SEQUENCE', 'CREATE'],
  hdbindex: ['INDEX', 'UNIQUE', 'BTREE', 'CPBTREE', 'INVERTED', 'CREATE'],
  hdbfulltextindex: ['FULLTEXT', 'FUZZY', 'INDEX', 'CREATE'],
  hdbconstraint: ['ALTER', 'CONSTRAINT', 'CREATE'],
  hdbvirtualtable: ['VIRTUAL', 'CREATE'],
  hdbprojectionview: ['PROJECTION', 'VIEW', 'CREATE'],
  hdbstructuredprivilege: ['STRUCTURED', 'CREATE'],
  hdbstructuredfilter: ['STRUCTURED', 'CREATE'],
  hdbresultcache: ['RESULT', 'CREATE'],
  hdbstatistics: ['STATISTICS', 'CREATE'],
  hdbsystemversioning: ['SYSTEM', 'ALTER', 'CREATE'],
  hdbapplicationtime: ['APPLICATION', 'ALTER', 'CREATE'],
  hdbschedulerjob: ['SCHEDULER', 'CREATE'],
  hdbremotetablereplica: ['REMOTE', 'SHARED', 'CREATE'],
  hdbcollection: ['COLLECTION', 'CREATE'],
  hdbcollectionindex: ['INDEX', 'COLLECTION', 'CREATE'],
  hdbcollectionadjindex: ['ADJACENCY', 'INDEX', 'CREATE'],
  hdbfabricvirtualtable: ['VIRTUAL', 'CREATE'],
  hdbdropcreatetable: ['DROP', 'COLUMN', 'ROW', 'CREATE'],
  hdbgraphworkspace: ['GRAPH', 'CREATE'],
  hdbvirtualprocedure: ['VIRTUAL', 'PROCEDURE', 'CREATE'],
  hdbvirtualfunction: ['VIRTUAL', 'FUNCTION', 'CREATE'],
};

const GENERAL_SQL_VALID_ROOTS = new Set<string>([
  'SELECT',
  'WITH',
  'INSERT',
  'UPDATE',
  'DELETE',
  'UPSERT',
  'MERGE',
  'REPLACE',
  'CREATE',
  'ALTER',
  'DROP',
  'GRANT',
  'REVOKE',
  'TRUNCATE',
  'DO',
  'CALL',
  'SET',
  'COMMENT',
  'EXPLAIN',
  'IMPORT',
  'EXPORT',
  'LOAD',
  'UNLOAD',
  'RENAME',
  'LOCK',
  'SIGNAL',
  'DECLARE',
  'CONNECT',
  'DISCONNECT',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'EXEC',
  'EXECUTE',
  'BEGIN',
  'IF',
  'FOR',
  'WHILE',
  'CASE',
  'RECOVER',
  'BACKUP',
  'VALIDATE',
  'PRIVILEGE',
]);

const CDS_DECLARATION_KEYWORDS: readonly string[] = [
  'namespace',
  'using',
  'context',
  'entity',
  'type',
  'view',
  'annotate',
  'extend',
  'define',
  'aspect',
  'service',
  'key',
  'association',
];

const CDS_TOP_KEYWORDS = new Set<string>([
  'namespace',
  'using',
  'context',
  'entity',
  'type',
  'view',
  'annotate',
  'extend',
  'define',
  'aspect',
  'service',
]);

const VALID_KV_KEYS_RE = /\b(?:table\.(?:schemaName|tableType|columns|primaryKey|indexes|temporary|loggingType)|schema|query|public|depends_on|import|host|port|sql|default_schema|increment_by|start_with|maxvalue|minvalue|cycles|reset_by)\b/;

/** Computes Optimal String Alignment (Damerau-Levenshtein) distance between uppercase strings. */
export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
    }
  }
  return dp[m][n];
}

export interface TypoMatchOptions {
  readonly allowShort?: boolean;
  readonly lowercase?: boolean;
}

/**
 * Resolves an unambiguous misspelling or anchored shorthand (e.g. `FUNC` -> `FUNCTION`)
 * against `candidates`. Returns `null` if valid, too short, ambiguous, or unrelated.
 */
export function matchKeywordTypo(
  rawWord: string,
  candidates: readonly string[],
  options: TypoMatchOptions = {}
): string | null {
  const upper = rawWord.toUpperCase();
  const upperCandidates = candidates.map((c) => c.toUpperCase());
  if (upperCandidates.includes(upper)) return null;

  if (options.allowShort !== false) {
    const shorthand = SHORTHAND_TYPOS[upper];
    if (shorthand && upperCandidates.includes(shorthand)) {
      return options.lowercase ? shorthand.toLowerCase() : shorthand;
    }
  }

  if (upper.length < 4) return null;

  let bestTarget: string | null = null;
  let bestDist = Infinity;
  let tied = false;

  for (const cand of upperCandidates) {
    const maxDist = Math.min(upper.length, cand.length) <= 5 ? 1 : 2;
    if (Math.abs(upper.length - cand.length) > maxDist) continue;
    const sameHead =
      upper[0] === cand[0] ||
      (upper.length >= 2 && cand.length >= 2 && upper[0] === cand[1] && upper[1] === cand[0]);
    if (!sameHead) continue;

    const d = damerauLevenshtein(upper, cand);
    if (d > maxDist) continue;

    if (d < bestDist) {
      bestDist = d;
      bestTarget = cand;
      tied = false;
    } else if (d === bestDist) {
      tied = true;
    }
  }

  if (!bestTarget || tied) return null;
  return options.lowercase ? bestTarget.toLowerCase() : bestTarget;
}

function makeReplaceFix(title: string, start: number, end: number, replacement: string): CodeFixSuggestion {
  return {
    title,
    kind: 'quickfix',
    isPreferred: true,
    edits: [{ start, end, newText: replacement }],
  };
}

function matchingCloser(opener: '(' | '[' | '{'): ')' | ']' | '}' {
  if (opener === '(') return ')';
  if (opener === '[') return ']';
  return '}';
}

function matchingOpener(closer: ')' | ']' | '}'): '(' | '[' | '{' {
  if (closer === ')') return '(';
  if (closer === ']') return '[';
  return '{';
}

function isDoubledQuoteClosed(raw: string, quote: "'" | '"'): boolean {
  let k = 1;
  while (k < raw.length) {
    if (raw[k] === quote) {
      if (raw[k + 1] === quote) {
        k += 2;
        continue;
      }
      return k === raw.length - 1;
    }
    k++;
  }
  return false;
}

/** Splits `.hdbmigrationtable` text into SQL body sections with exact UTF-16 base offsets. */
function splitMigrationTableSections(text: string): Array<{ slice: string; baseOffset: number }> {
  const sections: Array<{ slice: string; baseOffset: number }> = [];
  let pos = 0;
  let secStart = 0;
  const n = text.length;

  while (pos < n) {
    const nlIdx = text.indexOf('\n', pos);
    const lineEnd = nlIdx === -1 ? n : nlIdx;
    const rawLine = text.slice(pos, lineEnd).replace(/\r$/, '');
    if (MIGRATION_MARKER_RE.test(rawLine)) {
      if (pos > secStart) {
        sections.push({ slice: text.slice(secStart, pos), baseOffset: secStart });
      }
      secStart = nlIdx === -1 ? n : nlIdx + 1;
    }
    pos = nlIdx === -1 ? n : nlIdx + 1;
  }

  if (secStart < n) {
    sections.push({ slice: text.slice(secStart), baseOffset: secStart });
  }
  return sections;
}

function hasForeignLanguageProcedureBody(codeTokens: readonly Token[]): number {
  for (let i = 0; i + 1 < codeTokens.length; i++) {
    if (
      codeTokens[i].type === 'word' &&
      codeTokens[i].text.toUpperCase() === 'LANGUAGE' &&
      codeTokens[i + 1].type === 'word'
    ) {
      const lang = codeTokens[i + 1].text.toUpperCase();
      if (lang === 'R' || lang === 'RLANG' || lang === 'GRAPH') {
        for (let j = i + 2; j < codeTokens.length; j++) {
          if (codeTokens[j].type === 'word' && codeTokens[j].text.toUpperCase() === 'BEGIN') {
            return codeTokens[j].start;
          }
        }
        return codeTokens[i + 1].end;
      }
    }
  }
  return -1;
}

interface SqlSectionScanOptions {
  readonly baseOffset: number;
  readonly languageId: string;
  readonly checkBlocks: boolean;
  readonly checkHeaderRoots: boolean;
}

function resolveUnclosedQidentSpan(
  tokens: readonly Token[],
  tokIdx: number
): { readonly start: number; readonly end: number; readonly message: string } {
  const tok = tokens[tokIdx];
  // Trace backward along zero-whitespace word/qident tokens on the same line
  // so `"NAME AS "ITEM_NAME",` and `NAME" AS "ITEM_NAME",` point to the broken identifier head.
  let headIdx = tokIdx;
  while (
    headIdx > 0 &&
    tokens[headIdx].nlBefore === 0 &&
    !tokens[headIdx].wsBefore &&
    (tokens[headIdx - 1].type === 'word' || tokens[headIdx - 1].type === 'qident')
  ) {
    headIdx--;
  }

  const head = tokens[headIdx];
  if (headIdx < tokIdx && head.type === 'word') {
    // Missing opening quote: `NAME" AS "ITEM_NAME",` -> highlight `NAME"`
    return {
      start: head.start,
      end: Math.min(tok.end, head.end + 1),
      message: `Unterminated quoted identifier (missing opening '"' before '${head.text}"').`,
    };
  }

  if (head.type === 'qident') {
    const body = head.text.slice(1);
    const spaceMatch = /[ \t\r\n,;()]/.exec(body);
    const wordEnd = spaceMatch ? head.start + 1 + Math.max(1, spaceMatch.index) : head.end;
    return {
      start: head.start,
      end: Math.min(head.end, Math.max(head.start + 2, wordEnd)),
      message: 'Unterminated quoted identifier.',
    };
  }

  return {
    start: tok.start,
    end: Math.min(tok.end, tok.start + 2),
    message: 'Unterminated quoted identifier.',
  };
}

function getLineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function findLineNumber(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}

function analyzeSqlSection(slice: string, opts: SqlSectionScanOptions): AnalyzerDiagnostic[] {
  const { baseOffset, languageId, checkBlocks, checkHeaderRoots } = opts;
  const diagnostics: AnalyzerDiagnostic[] = [];
  const allTokens = tokenize(slice, {
    collapseFormatOff: false,
    slashComments: true,
    singleLineQident: true,
  });
  const preTokens = allTokens.filter((t) => t.type !== 'lineComment' && t.type !== 'blockComment');

  // Skip lexical & block checks inside LANGUAGE R / RLANG / GRAPH opaque embedded code bodies.
  const foreignBodyStart = hasForeignLanguageProcedureBody(preTokens);
  const tokens =
    foreignBodyStart >= 0 ? allTokens.filter((t) => t.start < foreignBodyStart) : allTokens;

  // 1. Lexical checks: unterminated comments/strings/qidents (HANA-SYN-001, HANA-SYN-002) & delimiters (HANA-SYN-003)
  const delimStack: Array<{ ch: '(' | '[' | '{'; start: number; end: number }> = [];
  const lineStarts = getLineStartOffsets(slice);
  const brokenQidentLines = new Set<number>();
  let hasEofSwallow = false;

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    if (tok.type === 'blockComment') {
      if (tok.text.length < 4 || !tok.text.endsWith('*/')) {
        hasEofSwallow = true;
        diagnostics.push({
          ruleId: 'HANA-SYN-002',
          category: 'syntax',
          severity: 'error',
          message: "Unterminated block comment '/*'.",
          start: baseOffset + tok.start,
          end: baseOffset + Math.min(tok.end, tok.start + 2),
          fixes: [],
        });
      }
      continue;
    }

    if (tok.type === 'string') {
      const quoteIdx = tok.text.indexOf("'");
      const body = quoteIdx >= 0 ? tok.text.slice(quoteIdx) : tok.text;
      if (!isDoubledQuoteClosed(body, "'")) {
        hasEofSwallow = true;
        const nlPos = tok.text.search(/[\r\n]/);
        const headEnd = nlPos >= 0 ? tok.start + nlPos : Math.min(tok.end, tok.start + 16);
        diagnostics.push({
          ruleId: 'HANA-SYN-001',
          category: 'syntax',
          severity: 'error',
          message: 'Unterminated string literal.',
          start: baseOffset + tok.start,
          end: baseOffset + Math.max(headEnd, Math.min(tok.end, tok.start + 2)),
          fixes: [],
        });
      }
      continue;
    }

    if (tok.type === 'qident') {
      if (!isDoubledQuoteClosed(tok.text, '"')) {
        const resolved = resolveUnclosedQidentSpan(tokens, idx);
        brokenQidentLines.add(findLineNumber(lineStarts, tok.start));
        brokenQidentLines.add(findLineNumber(lineStarts, resolved.start));
        diagnostics.push({
          ruleId: 'HANA-SYN-001',
          category: 'syntax',
          severity: 'error',
          message: resolved.message,
          start: baseOffset + resolved.start,
          end: baseOffset + resolved.end,
          fixes: [],
        });
      }
      continue;
    }

    if (tok.type === 'punct') {
      const ch = tok.text;
      if (ch === '(' || ch === '[' || ch === '{') {
        delimStack.push({ ch, start: tok.start, end: tok.end });
      } else if (ch === ')' || ch === ']' || ch === '}') {
        const expected = matchingOpener(ch);
        const top = delimStack[delimStack.length - 1];
        if (!top) {
          diagnostics.push({
            ruleId: 'HANA-SYN-003',
            category: 'syntax',
            severity: 'error',
            message: `Unmatched closing delimiter '${ch}'.`,
            start: baseOffset + tok.start,
            end: baseOffset + tok.end,
            fixes: [],
          });
        } else if (top.ch !== expected) {
          diagnostics.push({
            ruleId: 'HANA-SYN-003',
            category: 'syntax',
            severity: 'error',
            message: `Unexpected closing delimiter '${ch}'. Expected '${matchingCloser(top.ch)}'.`,
            start: baseOffset + tok.start,
            end: baseOffset + tok.end,
            fixes: [],
          });
          // Recover stack if an enclosing frame matches this closer
          const matchIdx = findLastDelimIndex(delimStack, expected);
          if (matchIdx >= 0) {
            delimStack.length = matchIdx;
          }
        } else {
          delimStack.pop();
        }
      }
    }
  }

  for (const unclosed of delimStack) {
    diagnostics.push({
      ruleId: 'HANA-SYN-003',
      category: 'syntax',
      severity: 'error',
      message: `Unclosed delimiter '${unclosed.ch}'.`,
      start: baseOffset + unclosed.start,
      end: baseOffset + unclosed.end,
      fixes: [],
    });
  }

  // Only suppress code-level checks if an unclosed literal/comment swallowed through EOF.
  // Line-contained unclosed quoted identifiers still allow downstream lines to be checked.
  const codeTokens = tokens.filter((t) => t.type !== 'lineComment' && t.type !== 'blockComment');
  if (codeTokens.length === 0 || hasEofSwallow) {
    return diagnostics;
  }

  // 2. Anchored DDL & headerless HDI root keyword typo checks (HANA-SYN-021)
  checkSqlHeaderTypos(codeTokens, languageId, baseOffset, checkHeaderRoots, diagnostics);

  // 3. Compound block matching (HANA-SYN-020)
  if (checkBlocks && foreignBodyStart < 0) {
    checkSqlScriptBlocks(codeTokens, baseOffset, diagnostics);
  }

  // 4. Missing comma separators (HANA-SYN-023)
  checkSqlMissingCommas(codeTokens, baseOffset, lineStarts, brokenQidentLines, diagnostics);

  return diagnostics;
}

function findLastDelimIndex<T extends { ch: string }>(stack: readonly T[], target: string): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].ch === target) return i;
  }
  return -1;
}

function checkSqlHeaderTypos(
  codeTokens: readonly Token[],
  languageId: string,
  baseOffset: number,
  checkHeaderRoots: boolean,
  diagnostics: AnalyzerDiagnostic[]
): void {
  // Root check for headerless HDI artifacts (first non-comment token at file root)
  if (checkHeaderRoots && codeTokens[0].type === 'word') {
    const first = codeTokens[0];
    const upper = first.text.toUpperCase();
    const hdiTargets = HDI_ROOT_TARGETS[languageId];
    if (hdiTargets) {
      if (!hdiTargets.includes(upper) && !GENERAL_SQL_VALID_ROOTS.has(upper)) {
        const nextTok = codeTokens[1];
        // Do not flag labels (`lbl:`) or KV-like (`a = b` / `a.b`) if any slipped through
        const looksLikeIdentExpr = nextTok && (nextTok.text === '=' || nextTok.text === ':=' || nextTok.text === '.');
        if (!looksLikeIdentExpr) {
          const fixKw = matchKeywordTypo(first.text, hdiTargets);
          if (fixKw) {
            diagnostics.push({
              ruleId: 'HANA-SYN-021',
              category: 'syntax',
              severity: 'error',
              message: `Unknown keyword '${first.text}' at artifact root. Did you mean '${fixKw}'?`,
              start: baseOffset + first.start,
              end: baseOffset + first.end,
              fixes: [makeReplaceFix(`Replace '${first.text}' with '${fixKw}'`, baseOffset + first.start, baseOffset + first.end, fixKw)],
            });
          }
        }
      } else if (
        (upper === 'COLUMN' || upper === 'ROW' || upper === 'VIRTUAL' || upper === 'PROJECTION' || upper === 'STRUCTURED' || upper === 'FULLTEXT') &&
        codeTokens[1]?.type === 'word'
      ) {
        const second = codeTokens[1];
        const secUpper = second.text.toUpperCase();
        const secondTargets =
          upper === 'STRUCTURED'
            ? ['PRIVILEGE', 'FILTER']
            : upper === 'FULLTEXT'
              ? ['INDEX']
              : ['TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION'];
        if (!secondTargets.includes(secUpper) && !VALID_DDL_NOUNS.has(secUpper) && !VALID_DDL_MODIFIERS.has(secUpper)) {
          const fixKw = matchKeywordTypo(second.text, secondTargets);
          if (fixKw) {
            diagnostics.push({
              ruleId: 'HANA-SYN-021',
              category: 'syntax',
              severity: 'error',
              message: `Unknown keyword '${second.text}' after '${upper}'. Did you mean '${fixKw}'?`,
              start: baseOffset + second.start,
              end: baseOffset + second.end,
              fixes: [makeReplaceFix(`Replace '${second.text}' with '${fixKw}'`, baseOffset + second.start, baseOffset + second.end, fixKw)],
            });
          }
        }
      }
    } else if (languageId === 'sql' || languageId === 'hanasql') {
      // In plain .sql/.hanasql, check bare declaration typo like `FUNC my_fn() ...` at root
      const nextTok = codeTokens[1];
      if ((upper === 'FUNC' || upper === 'FUNCTON' || upper === 'FUNCTOIN' || upper === 'FUNTION') && nextTok && (nextTok.type === 'word' || nextTok.type === 'qident')) {
        const fixKw = 'FUNCTION';
        diagnostics.push({
          ruleId: 'HANA-SYN-021',
          category: 'syntax',
          severity: 'error',
          message: `Unknown keyword '${first.text}'. Did you mean 'CREATE ${fixKw}' or '${fixKw}'?`,
          start: baseOffset + first.start,
          end: baseOffset + first.end,
          fixes: [makeReplaceFix(`Replace '${first.text}' with '${fixKw}'`, baseOffset + first.start, baseOffset + first.end, fixKw)],
        });
      }
    }
  }

  // Statement-start checks across the file (`CREATE [OR REPLACE] <TYPO>`, `ALTER <TYPO>`, `DROP <TYPO>`)
  let parenDepth = 0;
  for (let i = 0; i < codeTokens.length; i++) {
    const tok = codeTokens[i];
    if (tok.text === '(') {
      parenDepth++;
      continue;
    }
    if (tok.text === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (parenDepth > 0 || tok.type !== 'word') continue;

    const prev = i > 0 ? codeTokens[i - 1] : null;
    const isStmtStart = !prev || prev.text === ';';
    if (!isStmtStart) continue;

    const kw = tok.text.toUpperCase();
    if (kw === 'CREATE' || kw === 'ALTER' || kw === 'DROP') {
      let j = i + 1;
      if (kw === 'CREATE' && codeTokens[j]?.text.toUpperCase() === 'OR' && codeTokens[j + 1]?.text.toUpperCase() === 'REPLACE') {
        j += 2;
      }
      while (j < codeTokens.length && codeTokens[j].type === 'word' && VALID_DDL_MODIFIERS.has(codeTokens[j].text.toUpperCase())) {
        j++;
      }
      const targetTok = codeTokens[j];
      if (!targetTok || targetTok.type !== 'word') continue;
      const targetUpper = targetTok.text.toUpperCase();
      if (VALID_DDL_NOUNS.has(targetUpper)) continue;
      // Guard against valid user DDL phrases like `ALTER SYSTEM ...`, `CREATE SCHEMA ...` already in VALID_DDL_NOUNS
      const fixKw = matchKeywordTypo(targetTok.text, DDL_TYPO_CANDIDATES);
      if (fixKw) {
        diagnostics.push({
          ruleId: 'HANA-SYN-021',
          category: 'syntax',
          severity: 'error',
          message: `Unexpected keyword '${targetTok.text}' after '${kw}'. Did you mean '${fixKw}'?`,
          start: baseOffset + targetTok.start,
          end: baseOffset + targetTok.end,
          fixes: [
            makeReplaceFix(
              `Replace '${targetTok.text}' with '${fixKw}'`,
              baseOffset + targetTok.start,
              baseOffset + targetTok.end,
              fixKw
            ),
          ],
        });
      }
    }
  }
}

type BlockKind = 'BEGIN' | 'IF' | 'FOR' | 'WHILE' | 'LOOP' | 'CASE';

interface BlockFrame {
  readonly kind: BlockKind;
  readonly start: number;
  readonly end: number;
}

function hasKeywordBeforeBoundary(
  codeTokens: readonly Token[],
  startIdx: number,
  targetWord: string
): boolean {
  let depth = 0;
  for (let k = startIdx; k < codeTokens.length; k++) {
    const t = codeTokens[k];
    if (t.text === '(') {
      depth++;
      continue;
    }
    if (t.text === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      if (t.text === ';') return false;
      if (t.type === 'word') {
        const up = t.text.toUpperCase();
        if (up === targetWord) return true;
        if (up === 'BEGIN' || up === 'END') return false;
      }
    }
  }
  return false;
}

const COMPOUND_BOUNDARY_PREV = new Set([';', 'BEGIN', 'THEN', 'ELSE', 'ELSEIF', 'DO', 'LOOP', ':']);

function checkSqlScriptBlocks(
  codeTokens: readonly Token[],
  baseOffset: number,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const stack: BlockFrame[] = [];
  let parenDepth = 0;

  const hasOpenCompound = (): boolean => stack.some((f) => f.kind !== 'CASE');

  for (let i = 0; i < codeTokens.length; i++) {
    const tok = codeTokens[i];
    if (tok.text === '(') {
      parenDepth++;
      continue;
    }
    if (tok.text === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (tok.type !== 'word') continue;

    const up = tok.text.toUpperCase();
    const prev = i > 0 ? codeTokens[i - 1] : null;
    const prevUp = prev?.type === 'word' ? prev.text.toUpperCase() : prev?.text ?? '';
    const isBoundaryPrev = !prev || COMPOUND_BOUNDARY_PREV.has(prevUp);

    // Check anchored statement-start control-flow typos inside BEGIN..END bodies (HANA-SYN-021)
    if (parenDepth === 0 && isBoundaryPrev && hasOpenCompound()) {
      const next = codeTokens[i + 1];
      const nextText = next?.text ?? '';
      if (
        nextText !== ':=' &&
        nextText !== '=' &&
        nextText !== '.' &&
        nextText !== '(' &&
        nextText !== ',' &&
        !['BEGIN', 'END', 'IF', 'ELSE', 'ELSEIF', 'FOR', 'WHILE', 'LOOP', 'CASE', 'DECLARE', 'RETURN', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'MERGE', 'REPLACE', 'CALL', 'EXEC', 'EXECUTE', 'SIGNAL', 'RESIGNAL', 'DO', 'EXIT', 'CONTINUE', 'OPEN', 'FETCH', 'CLOSE', 'USING', 'TRUNCATE', 'COMMIT', 'ROLLBACK'].includes(up)
      ) {
        const bodyTypo =
          up === 'ELSIF'
            ? 'ELSEIF'
            : matchKeywordTypo(tok.text, ['RETURN', 'DECLARE', 'ELSEIF', 'ELSE', 'WHILE', 'BEGIN'], { allowShort: false });
        if (bodyTypo) {
          diagnostics.push({
            ruleId: 'HANA-SYN-021',
            category: 'syntax',
            severity: 'error',
            message: `Unknown SQLScript keyword '${tok.text}'. Did you mean '${bodyTypo}'?`,
            start: baseOffset + tok.start,
            end: baseOffset + tok.end,
            fixes: [
              makeReplaceFix(
                `Replace '${tok.text}' with '${bodyTypo}'`,
                baseOffset + tok.start,
                baseOffset + tok.end,
                bodyTypo
              ),
            ],
          });
        }
      }
    }

    if (up === 'BEGIN' && parenDepth === 0 && prevTextNotMember(prev)) {
      stack.push({ kind: 'BEGIN', start: tok.start, end: tok.end });
      continue;
    }

    if (up === 'CASE' && prevTextNotMember(prev) && prevUp !== 'END') {
      stack.push({ kind: 'CASE', start: tok.start, end: tok.end });
      continue;
    }

    if (up === 'IF' && parenDepth === 0 && prevUp !== 'END' && isBoundaryPrev) {
      const nextUp = codeTokens[i + 1]?.type === 'word' ? codeTokens[i + 1].text.toUpperCase() : '';
      if (nextUp !== 'EXISTS' && nextUp !== 'NOT' && hasKeywordBeforeBoundary(codeTokens, i + 1, 'THEN')) {
        stack.push({ kind: 'IF', start: tok.start, end: tok.end });
      }
      continue;
    }

    if (up === 'FOR' && parenDepth === 0 && prevUp !== 'END' && prevUp !== 'HANDLER' && isBoundaryPrev) {
      if (hasKeywordBeforeBoundary(codeTokens, i + 1, 'DO')) {
        stack.push({ kind: 'FOR', start: tok.start, end: tok.end });
      }
      continue;
    }

    if (up === 'WHILE' && parenDepth === 0 && prevUp !== 'END' && isBoundaryPrev) {
      if (hasKeywordBeforeBoundary(codeTokens, i + 1, 'DO')) {
        stack.push({ kind: 'WHILE', start: tok.start, end: tok.end });
      }
      continue;
    }

    if (up === 'LOOP' && parenDepth === 0 && prevUp !== 'END' && isBoundaryPrev && hasOpenCompound()) {
      stack.push({ kind: 'LOOP', start: tok.start, end: tok.end });
      continue;
    }

    if (up === 'END' && prevTextNotMember(prev)) {
      const next = codeTokens[i + 1];
      const nextUp = next?.type === 'word' ? next.text.toUpperCase() : '';

      if (nextUp === 'IF' || nextUp === 'FOR' || nextUp === 'WHILE' || nextUp === 'LOOP' || nextUp === 'CASE') {
        const expectedKind = nextUp as Exclude<BlockKind, 'BEGIN'>;
        const closeEnd = next.end;
        i++; // consume qualifier (`IF`, `FOR`, `WHILE`, `LOOP`, `CASE`)
        const top = stack[stack.length - 1];
        if (!top) {
          diagnostics.push({
            ruleId: 'HANA-SYN-020',
            category: 'syntax',
            severity: 'error',
            message: `Unexpected 'END ${expectedKind}' without matching '${expectedKind}'.`,
            start: baseOffset + tok.start,
            end: baseOffset + closeEnd,
            fixes: [],
          });
        } else if (top.kind !== expectedKind) {
          diagnostics.push({
            ruleId: 'HANA-SYN-020',
            category: 'syntax',
            severity: 'error',
            message: `Unexpected 'END ${expectedKind}'; open '${top.kind}' block expects '${top.kind === 'BEGIN' || top.kind === 'CASE' ? 'END' : `END ${top.kind}`}'.`,
            start: baseOffset + tok.start,
            end: baseOffset + closeEnd,
            fixes: [],
          });
          // Recover stack if an enclosing frame matches
          for (let s = stack.length - 1; s >= 0; s--) {
            if (stack[s].kind === expectedKind) {
              stack.length = s;
              break;
            }
          }
        } else {
          stack.pop();
        }
        continue;
      }

      // Bare `END`: closes `CASE` expression or `BEGIN` block
      const top = stack[stack.length - 1];
      if (!top) {
        diagnostics.push({
          ruleId: 'HANA-SYN-020',
          category: 'syntax',
          severity: 'error',
          message: "Unexpected 'END' without matching 'BEGIN' or 'CASE'.",
          start: baseOffset + tok.start,
          end: baseOffset + tok.end,
          fixes: [],
        });
      } else if (top.kind === 'BEGIN' || top.kind === 'CASE') {
        stack.pop();
      } else {
        diagnostics.push({
          ruleId: 'HANA-SYN-020',
          category: 'syntax',
          severity: 'error',
          message: `Expected 'END ${top.kind}' before 'END'.`,
          start: baseOffset + tok.start,
          end: baseOffset + tok.end,
          fixes: [],
        });
        // Pop leaked inner control frame and closing outer BEGIN if present
        stack.pop();
        if (stack[stack.length - 1]?.kind === 'BEGIN') {
          stack.pop();
        }
      }
    }
  }

  for (const unclosed of stack) {
    const closerLabel = unclosed.kind === 'BEGIN' || unclosed.kind === 'CASE' ? 'END' : `END ${unclosed.kind}`;
    diagnostics.push({
      ruleId: 'HANA-SYN-020',
      category: 'syntax',
      severity: 'error',
      message: `Unclosed '${unclosed.kind}' block; expected '${closerLabel}'.`,
      start: baseOffset + unclosed.start,
      end: baseOffset + unclosed.end,
      fixes: [],
    });
  }
}

function prevTextNotMember(prev: Token | null): boolean {
  return !prev || prev.text !== '.';
}

const SPECIAL_CALL_NAMES = new Set<string>([
  'CAST',
  'CONVERT',
  'EXTRACT',
  'SUBSTRING',
  'TRIM',
  'POSITION',
  'OVERLAY',
  'TREAT',
  'XMLELEMENT',
  'XMLFOREST',
  'XMLAGG',
  'XMLATTRIBUTES',
  'XMLPARSE',
  'XMLSERIALIZE',
  'XMLTABLE',
  'OPENJSON',
  'JSON_TABLE',
  'JSON_OBJECT',
  'JSON_ARRAY',
  'OVER',
  'FILTER',
  'WITHIN',
  'EXISTS',
  'USING',
  'CHECK',
  'CONSTRAINT',
  'PRIMARY',
  'UNIQUE',
  'FOREIGN',
  'REFERENCES',
  'GENERATED',
  'AS',
  'PARTITION',
  'SUBPARTITION',
  'SERIES',
  'RANGE',
  'HASH',
  'ROUNDROBIN',
  'SET',
]);

const PARAM_MODES = new Set<string>(['IN', 'OUT', 'INOUT']);

const COLUMN_END_MODIFIERS = new Set<string>([
  'NOT',
  'NULL',
  'PRIMARY',
  'KEY',
  'UNIQUE',
  'ARRAY',
  'COLUMN',
  'ROW',
  'PAGE',
  'LOADABLE',
  'ONLINE',
  'INVISIBLE',
  'HIDDEN',
  'AUTO',
  'MERGE',
  'ENCRYPTED',
  'DETERMINISTIC',
  'PRECISION',
  'VARYING',
  'TIME',
  'ZONE',
  'WITH',
  'WITHOUT',
  'LOCAL',
  'ASC',
  'DESC',
]);

const COLUMN_CLAUSE_MODIFIERS = new Set<string>([
  'DEFAULT',
  'COMMENT',
  'CONSTRAINT',
  'REFERENCES',
  'AS',
  'CHECK',
  'GENERATED',
  'ALWAYS',
  'BY',
  'IDENTITY',
  'MEMORY',
  'LOAD',
  'UNLOAD',
  'NUMA',
  'PERSISTENT',
  'FUZZY',
  'WITH',
  'IN',
  'ON',
  'MATCH',
  'DELETE',
  'UPDATE',
  'SET',
  'NO',
  'GROUP',
  'SERIES',
  'PERIOD',
  'DDIC_ACDAY',
  'DDIC_ACMONTH',
  'CS_FIXED',
  'CS_INT',
  'CS_DOUBLE',
  'CS_STRING',
  'LANGUAGE',
]);

const SELECT_STOP_CLAUSES = new Set<string>([
  'FROM',
  'INTO',
  'BULK',
  'WHERE',
  'GROUP',
  'HAVING',
  'ORDER',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'MINUS',
  'WINDOW',
  'LIMIT',
  'OFFSET',
  'FOR',
  'WITH',
  'OPTION',
  'WHEN',
  'THEN',
  'ELSE',
]);

const SELECT_PREFIX_OPS = new Set<string>([
  '+',
  '-',
  '*',
  '/',
  '%',
  '||',
  '.',
  '=',
  '<>',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '~=',
  '^=',
  '=>',
  'AND',
  'OR',
  'NOT',
  'IS',
  'IN',
  'LIKE',
  'BETWEEN',
  'ESCAPE',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'DATE',
  'TIME',
  'TIMESTAMP',
  'INTERVAL',
  'DISTINCT',
  'ALL',
  'PRIOR',
  'NEW',
  'CONNECT_BY_ROOT',
  'OVER',
  'FILTER',
  'WITHIN',
]);

const CALL_INFIX_OR_CLAUSE = new Set<string>([
  'AS',
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS',
  'LIKE',
  'BETWEEN',
  'ESCAPE',
  'ASC',
  'DESC',
  'NULLS',
  'FIRST',
  'LAST',
  'ORDER',
  'GROUP',
  'PARTITION',
  'WITHIN',
  'OVER',
  'FILTER',
  'SEPARATOR',
  'USING',
  'FROM',
  'FOR',
  'TO',
  'BY',
  'DAY',
  'MONTH',
  'YEAR',
  'HOUR',
  'MINUTE',
  'SECOND',
  'ZONE',
  'AT',
  'RESPECT',
  'IGNORE',
  'NULL',
]);

const CALL_PREFIX_WORDS = new Set<string>([
  'NOT',
  'DATE',
  'TIME',
  'TIMESTAMP',
  'INTERVAL',
  'DISTINCT',
  'ALL',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'CAST',
  'NEW',
  'PRIOR',
  'ROW',
]);

function makeInsertCommaFix(insertAt: number): CodeFixSuggestion {
  return {
    title: "Insert ','",
    kind: 'quickfix',
    isPreferred: true,
    edits: [{ start: insertAt, end: insertAt, newText: ',' }],
  };
}

function isValueOperandStart(tok: Token, inCall = false): boolean {
  if (tok.type === 'number' || tok.type === 'string' || tok.type === 'qident' || tok.type === 'var' || tok.type === 'sysvar' || tok.type === 'param') {
    return true;
  }
  if (tok.text === '(' || tok.text === '[') return true;
  if (tok.type === 'word') {
    const up = tok.text.toUpperCase();
    if (inCall && CALL_INFIX_OR_CLAUSE.has(up)) return false;
    return !SELECT_STOP_CLAUSES.has(up) && !SELECT_PREFIX_OPS.has(up);
  }
  return false;
}

function isTypeListOpener(codeTokens: readonly Token[], openIdx: number): 'params' | 'columns' | null {
  let k = openIdx - 1;
  // Walk back over optional qualified object name `("ns"."fn")` or `name`
  while (k >= 0 && (codeTokens[k].type === 'word' || codeTokens[k].type === 'qident')) {
    if (k - 1 >= 0 && codeTokens[k - 1].text === '.') {
      k -= 2;
      continue;
    }
    break;
  }
  if (k < 0) return null;

  const before = codeTokens[k];
  const beforeUp = before.type === 'word' ? before.text.toUpperCase() : '';
  if (beforeUp === 'TABLE') {
    const prevUp = codeTokens[k - 1]?.type === 'word' ? codeTokens[k - 1].text.toUpperCase() : '';
    if (['RETURNS', 'AS', 'COLUMN', 'ROW', 'TEMPORARY', 'GLOBAL', 'LOCAL', 'HISTORY', 'VIRTUAL', 'CREATE', 'IN', 'OUT', 'INOUT'].includes(prevUp)) {
      return 'columns';
    }
    // Check inside procedure/function parameter declaration: `IN im_tbl TABLE (...)`
    return 'columns';
  }
  if (beforeUp === 'ADD' && openIdx >= 2) {
    // `ALTER TABLE ... ADD (...)`
    for (let b = k - 1; b >= Math.max(0, k - 8); b--) {
      if (codeTokens[b].text === ';') break;
      if (codeTokens[b].type === 'word' && codeTokens[b].text.toUpperCase() === 'TABLE') {
        return 'columns';
      }
    }
  }
  if (before.type === 'word' || before.type === 'qident') {
    // Check header keyword immediately before object name: `PROCEDURE "name" (...)`, `FUNCTION "name" (...)`, `TABLE "name" (...)`
    const prevWordIdx = k;
    let headerIdx = prevWordIdx - 1;
    // Handle `FUNCTION "pkg::name"` when tokenized as one qident: headerIdx is keyword
    while (headerIdx >= 0 && codeTokens[headerIdx].text === '.') headerIdx -= 2;
    const hdr = headerIdx >= 0 && codeTokens[headerIdx].type === 'word' ? codeTokens[headerIdx].text.toUpperCase() : '';
    if (hdr === 'PROCEDURE' || hdr === 'FUNCTION') return 'params';
    if (hdr === 'TABLE') return 'columns';
    // Handle `DO (IN ...)`
    if (beforeUp === 'DO') return 'params';
  }
  return null;
}

function classifyParenFrame(
  codeTokens: readonly Token[],
  openIdx: number,
  enclosing: { readonly kind: string; readonly declPhase?: string } | undefined
): 'params' | 'columns' | 'call' | 'skip' {
  const listKind = isTypeListOpener(codeTokens, openIdx);
  if (listKind) return listKind;

  // Type parameter list inside a parameter/column declaration, e.g. DECIMAL(3, 2)
  if ((enclosing?.kind === 'params' || enclosing?.kind === 'columns') && enclosing.declPhase === 'sawType') {
    return 'call';
  }

  // Skip parens inside constraint/default/check clauses of CREATE TABLE
  if (enclosing?.kind === 'columns' || enclosing?.kind === 'params') {
    return 'skip';
  }

  const prev = openIdx > 0 ? codeTokens[openIdx - 1] : null;
  const prevUp = prev?.type === 'word' ? prev.text.toUpperCase() : '';
  if (prevUp && SPECIAL_CALL_NAMES.has(prevUp)) return 'skip';

  // Skip index definition parens `ON "TBL" ("COL1" ASC, "COL2")` and CTE/table column lists after `WITH name (`
  const next = codeTokens[openIdx + 1];
  const nextUp = next?.type === 'word' ? next.text.toUpperCase() : '';
  if (nextUp === 'SELECT' || nextUp === 'WITH') return 'skip';

  if (prevUp === 'VALUES' || prevUp === 'IN') return 'call';

  // `INSERT INTO "T" ("A", "B")` or DDL clauses `ON "TBL" (...)` / `WITH PARAMETERS (...)`
  if (prev && (prev.type === 'word' || prev.type === 'qident')) {
    if (prevUp === 'PARAMETERS' && codeTokens[openIdx - 2]?.type === 'word' && codeTokens[openIdx - 2].text.toUpperCase() === 'WITH') {
      return 'skip';
    }

    // Walk back past optional qualified object name `[schema.]name`
    let preNameIdx = openIdx - 2;
    while (preNameIdx >= 1 && codeTokens[preNameIdx].text === '.') {
      preNameIdx -= 2;
    }
    const preNameUp =
      preNameIdx >= 0 && codeTokens[preNameIdx].type === 'word' ? codeTokens[preNameIdx].text.toUpperCase() : '';
    if (preNameUp === 'REFERENCES') return 'skip';
    if (preNameUp === 'ON') {
      for (let b = preNameIdx - 1; b >= Math.max(0, preNameIdx - 10); b--) {
        if (codeTokens[b].text === ';' || codeTokens[b].text === ')') break;
        const w = codeTokens[b].type === 'word' ? codeTokens[b].text.toUpperCase() : '';
        if (['INDEX', 'ADJACENCY', 'GRAPH', 'TRIGGER', 'STATISTICS', 'PROJECTION'].includes(w)) return 'skip';
        if (w === 'SELECT' || w === 'JOIN' || w === 'WHERE' || w === 'SET') break;
      }
    }

    for (let b = openIdx - 1; b >= Math.max(0, openIdx - 6); b--) {
      if (codeTokens[b].text === ';' || codeTokens[b].text === ')') break;
      const w = codeTokens[b].type === 'word' ? codeTokens[b].text.toUpperCase() : '';
      if (w === 'INSERT' || w === 'UPSERT') return 'call';
      if (w === 'CREATE' || w === 'ALTER' || w === 'ON' || w === 'AS') break;
    }
    // Exclude SQL keywords introducing parenthesized expressions or clauses rather than call arg lists
    if (
      prevUp &&
      [
        'SELECT',
        'IF',
        'ELSEIF',
        'WHILE',
        'FOR',
        'WHERE',
        'WHEN',
        'THEN',
        'ELSE',
        'AND',
        'OR',
        'NOT',
        'CASE',
        'RETURN',
        'RETURNS',
        'ON',
        'TO',
        'FROM',
        'JOIN',
        'USING',
        'HAVING',
        'DO',
        'UNTIL',
        'BY',
        'BETWEEN',
        'LIKE',
        'AS',
        'ANY',
        'ALL',
        'SOME',
        'DISTINCT',
        'TOP',
        'LIMIT',
        'OFFSET',
        'SET',
        'INTO',
        'WITH',
        'EXISTS',
        'UNIQUE',
        'OVER',
        'FILTER',
        'WITHIN',
        'GROUP',
        'ORDER',
        'PARTITION',
        'UNION',
        'INTERSECT',
        'EXCEPT',
        'MINUS',
      ].includes(prevUp)
    ) {
      return 'skip';
    }
    return 'call';
  }

  return 'skip';
}

interface DeclParenFrame {
  readonly kind: 'params' | 'columns' | 'call' | 'skip';
  readonly depth: number;
  declPhase: 'start' | 'sawName' | 'sawType' | 'inConstraint';
  lastItemEnd: number;
  awaitingTypeSegment: boolean;
  // For 'call' frames:
  callExpectOperand: boolean;
  callPrevOperandEnd: number;
  callDisabled: boolean;
  caseDepth: number;
}

interface SelectListFrame {
  readonly depth: number;
  caseDepth: number;
  itemParts: number;
  skipTopCount: boolean;
  expectOperand: boolean;
  expectExplicitAlias: boolean;
  afterExplicitAlias: boolean;
  lastItemEnd: number;
  tentativeAliasTok: Token | null;
  beforeAliasEnd: number;
}

/**
 * Detects missing comma separators (`HANA-SYN-023`) in unambiguous SQL lists:
 * procedure/function parameter lists, table column definitions, `SELECT` projections,
 * function call arguments, `VALUES`, `IN`, and `INSERT` column lists.
 */
function checkSqlMissingCommas(
  codeTokens: readonly Token[],
  baseOffset: number,
  lineStarts: readonly number[],
  brokenQidentLines: ReadonlySet<number>,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const parenStack: DeclParenFrame[] = [];
  const selectStack: SelectListFrame[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;

  const isOnBrokenLine = (tok: Token): boolean =>
    brokenQidentLines.has(findLineNumber(lineStarts, tok.start));

  const emitMissingComma = (insertPos: number, diagTok: Token, message: string): void => {
    const absInsert = baseOffset + insertPos;
    const absStart = baseOffset + diagTok.start;
    const absEnd = baseOffset + diagTok.end;
    if (diagnostics.some((d) => d.ruleId === 'HANA-SYN-023' && d.start === absStart)) return;
    diagnostics.push({
      ruleId: 'HANA-SYN-023',
      category: 'syntax',
      severity: 'error',
      message,
      start: absStart,
      end: absEnd,
      fixes: [makeInsertCommaFix(absInsert)],
    });
  };

  for (let i = 0; i < codeTokens.length; i++) {
    const tok = codeTokens[i];
    const up = tok.type === 'word' ? tok.text.toUpperCase() : '';
    const prev = i > 0 ? codeTokens[i - 1] : null;
    const prevUp = prev?.type === 'word' ? prev.text.toUpperCase() : prev?.text ?? '';

    if (tok.text === ';') {
      parenStack.length = 0;
      selectStack.length = 0;
      parenDepth = 0;
      bracketDepth = 0;
      continue;
    }

    if (tok.text === '[') {
      bracketDepth++;
      continue;
    }
    if (tok.text === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      if (bracketDepth === 0) {
        const tp = parenStack[parenStack.length - 1];
        if (tp && tp.depth === parenDepth) {
          tp.lastItemEnd = tok.end;
          tp.callPrevOperandEnd = tok.end;
          tp.callExpectOperand = false;
        }
        const ts = selectStack[selectStack.length - 1];
        if (ts && ts.depth === parenDepth && ts.caseDepth === 0) {
          ts.lastItemEnd = tok.end;
          ts.expectOperand = false;
          if (ts.itemParts === 0) ts.itemParts = 1;
        }
      }
      continue;
    }
    if (bracketDepth > 0) continue;

    if (tok.text === '(') {
      const topParen = parenStack[parenStack.length - 1];
      const topSel = selectStack[selectStack.length - 1];

      // Check active SELECT list right before `( ... )`:
      // e.g. `fn(...)` is part of expression, whereas `"A" AS "X" (1)` or `1 (2)` is invalid.
      if (topSel && topSel.depth === parenDepth && topSel.caseDepth === 0) {
        if (topSel.afterExplicitAlias) {
          if (!isOnBrokenLine(tok)) {
            emitMissingComma(topSel.lastItemEnd, tok, "Expected ',' before '(' in SELECT list.");
          }
          topSel.afterExplicitAlias = false;
          topSel.itemParts = 1;
        } else if (!topSel.expectOperand && prev && prev.type !== 'word' && prev.type !== 'qident' && prev.type !== 'sysvar') {
          if (!isOnBrokenLine(tok)) {
            emitMissingComma(topSel.lastItemEnd, tok, "Expected ',' before '(' in SELECT list.");
          }
        } else if (!topSel.expectOperand && prev && (prev.type === 'word' || prev.type === 'qident') && topSel.tentativeAliasTok === prev) {
          // Case `SELECT "NAME"\n SUM(x)`: `SUM` was mistakenly held as tentativeAliasTok!
          if (!isOnBrokenLine(prev)) {
            emitMissingComma(topSel.beforeAliasEnd, prev, `Expected ',' before '${prev.text}' in SELECT list.`);
          }
          topSel.tentativeAliasTok = null;
          topSel.itemParts = 1;
        }
        topSel.expectOperand = false;
      } else if (topParen && topParen.depth === parenDepth && topParen.kind === 'call' && !topParen.callDisabled) {
        if (!topParen.callExpectOperand && prev && prev.type !== 'word' && prev.type !== 'qident' && prev.type !== 'sysvar') {
          if (!isOnBrokenLine(tok)) {
            emitMissingComma(topParen.callPrevOperandEnd, tok, "Expected ',' before '(' in argument list.");
          }
        }
        topParen.callExpectOperand = false;
      }

      parenDepth++;
      const kind = classifyParenFrame(codeTokens, i, topParen);
      parenStack.push({
        kind,
        depth: parenDepth,
        declPhase: 'start',
        lastItemEnd: tok.end,
        awaitingTypeSegment: false,
        callExpectOperand: true,
        callPrevOperandEnd: tok.end,
        callDisabled: false,
        caseDepth: 0,
      });
      continue;
    }

    if (tok.text === ')') {
      // Close any SELECT opened at this paren depth
      while (selectStack.length > 0 && selectStack[selectStack.length - 1].depth >= parenDepth) {
        selectStack.pop();
      }
      const popped = parenStack.length > 0 && parenStack[parenStack.length - 1].depth === parenDepth
        ? parenStack.pop()
        : undefined;
      parenDepth = Math.max(0, parenDepth - 1);

      // Update enclosing frame's last item end to include the closed `(...)`
      const parentParen = parenStack[parenStack.length - 1];
      if (parentParen && parentParen.depth === parenDepth && popped) {
        parentParen.lastItemEnd = tok.end;
        parentParen.callPrevOperandEnd = tok.end;
        parentParen.callExpectOperand = false;
      }
      const topSelAfter = selectStack[selectStack.length - 1];
      if (topSelAfter && topSelAfter.depth === parenDepth && topSelAfter.caseDepth === 0) {
        topSelAfter.lastItemEnd = tok.end;
        topSelAfter.expectOperand = false;
        if (topSelAfter.itemParts === 0) topSelAfter.itemParts = 1;
      }
      continue;
    }

    // Track `SELECT` lists cleanly
    if (up === 'SELECT' && !['GRANT', 'REVOKE', 'ALLOW', 'DENY', 'PRIVILEGE'].includes(prevUp)) {
      const topParen = parenStack[parenStack.length - 1];
      if (!topParen || (topParen.kind !== 'params' && topParen.kind !== 'columns')) {
        selectStack.push({
          depth: parenDepth,
          caseDepth: 0,
          itemParts: 0,
          skipTopCount: false,
          expectOperand: true,
          expectExplicitAlias: false,
          afterExplicitAlias: false,
          lastItemEnd: tok.end,
          tentativeAliasTok: null,
          beforeAliasEnd: tok.end,
        });
        continue;
      }
    }

    // Active paren declaration/call handling at exact top paren depth
    const topParen = parenStack[parenStack.length - 1];
    if (topParen && topParen.depth === parenDepth) {
      if (topParen.kind === 'params' || topParen.kind === 'columns') {
        if (tok.text === ',') {
          topParen.declPhase = 'start';
          topParen.lastItemEnd = tok.end;
          topParen.awaitingTypeSegment = false;
          continue;
        }

        if (topParen.kind === 'params' && PARAM_MODES.has(up)) {
          if (topParen.declPhase !== 'start' && !isOnBrokenLine(tok) && prev) {
            emitMissingComma(prev.end, tok, `Expected ',' before parameter '${tok.text}'.`);
          }
          topParen.declPhase = 'start';
          topParen.awaitingTypeSegment = false;
          continue;
        }

        if (topParen.declPhase === 'start') {
          if (['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'PERIOD', 'LIKE'].includes(up)) {
            topParen.declPhase = 'inConstraint';
          } else if (tok.type === 'word' || tok.type === 'qident') {
            topParen.declPhase = 'sawName';
          }
          topParen.lastItemEnd = tok.end;
          continue;
        }

        if (topParen.declPhase === 'sawName') {
          topParen.declPhase = 'sawType';
          topParen.lastItemEnd = tok.end;
          topParen.awaitingTypeSegment = tok.text === '.';
          continue;
        }

        if (topParen.declPhase === 'sawType') {
          if (tok.text === '.' || tok.text === '::' || tok.text === '[' || tok.text === ']') {
            topParen.awaitingTypeSegment = tok.text === '.' || tok.text === '::';
            topParen.lastItemEnd = tok.end;
            continue;
          }
          if (topParen.awaitingTypeSegment) {
            topParen.awaitingTypeSegment = false;
            topParen.lastItemEnd = tok.end;
            continue;
          }
          if (COLUMN_END_MODIFIERS.has(up)) {
            topParen.lastItemEnd = tok.end;
            continue;
          }
          if (COLUMN_CLAUSE_MODIFIERS.has(up) || tok.text === '=>') {
            topParen.declPhase = 'inConstraint';
            topParen.lastItemEnd = tok.end;
            continue;
          }
          // Non-modifier word or quoted identifier after `<col> <type>` -> missing comma!
          if ((tok.type === 'word' || tok.type === 'qident') && !isOnBrokenLine(tok)) {
            emitMissingComma(
              topParen.lastItemEnd,
              tok,
              `Expected ',' before ${topParen.kind === 'params' ? 'parameter' : 'column'} '${tok.text}'.`
            );
            topParen.declPhase = 'sawName';
            topParen.lastItemEnd = tok.end;
            continue;
          }
          topParen.lastItemEnd = tok.end;
          continue;
        }

        // In 'inConstraint' (e.g. DEFAULT ..., REFERENCES ...):
        // Already catches missing `,` before `IN`/`OUT`/`INOUT` above; skip rest until `,` or `)`
        topParen.lastItemEnd = tok.end;
        continue;
      }

      if (topParen.kind === 'call' && !topParen.callDisabled) {
        if (up === 'CASE' && prevUp !== 'END') {
          topParen.caseDepth++;
          continue;
        }
        if (up === 'END') {
          if (topParen.caseDepth > 0) {
            topParen.caseDepth--;
            topParen.callExpectOperand = false;
            topParen.callPrevOperandEnd = tok.end;
          }
          continue;
        }
        if (topParen.caseDepth > 0) continue;

        if (tok.text === ',') {
          topParen.callExpectOperand = true;
          topParen.callPrevOperandEnd = tok.end;
          continue;
        }
        if (up === 'ORDER' || up === 'GROUP' || up === 'PARTITION') {
          topParen.callDisabled = true;
          continue;
        }
        if (tok.type === 'op' || tok.text === '.' || tok.text === '::' || tok.text === ']') {
          topParen.callExpectOperand = true;
          continue;
        }
        if (tok.type === 'word' && (CALL_INFIX_OR_CLAUSE.has(up) || CALL_PREFIX_WORDS.has(up))) {
          topParen.callExpectOperand = true;
          continue;
        }
        if (isValueOperandStart(tok, true)) {
          if (!topParen.callExpectOperand && !isOnBrokenLine(tok)) {
            emitMissingComma(topParen.callPrevOperandEnd, tok, `Expected ',' before '${tok.text}'.`);
          }
          topParen.callExpectOperand = false;
          topParen.callPrevOperandEnd = tok.end;
        }
      }
    }

    // Active SELECT projection list check (at exact select depth)
    const topSel = selectStack[selectStack.length - 1];
    if (topSel && topSel.depth === parenDepth) {
      if (up === 'CASE' && prevUp !== 'END') {
        topSel.caseDepth++;
        continue;
      }
      if (up === 'END') {
        if (topSel.caseDepth > 0) {
          topSel.caseDepth--;
          topSel.expectOperand = false;
          topSel.itemParts = Math.max(1, topSel.itemParts);
          topSel.lastItemEnd = tok.end;
          continue;
        }
        selectStack.pop();
        continue;
      }
      if (topSel.caseDepth > 0) continue;

      // Close SELECT on clause terminators (note `WITHIN GROUP` is not a GROUP BY terminator)
      if (SELECT_STOP_CLAUSES.has(up) && !(up === 'GROUP' && prevUp === 'WITHIN')) {
        selectStack.pop();
        continue;
      }

      if (tok.text === ',') {
        topSel.itemParts = 0;
        topSel.expectOperand = true;
        topSel.expectExplicitAlias = false;
        topSel.afterExplicitAlias = false;
        topSel.tentativeAliasTok = null;
        topSel.lastItemEnd = tok.end;
        continue;
      }

      if (topSel.itemParts === 0 && (up === 'DISTINCT' || up === 'ALL')) {
        continue;
      }
      if (topSel.itemParts === 0 && up === 'TOP') {
        topSel.skipTopCount = true;
        continue;
      }
      if (topSel.skipTopCount) {
        topSel.skipTopCount = false;
        continue;
      }

      if (topSel.expectExplicitAlias) {
        topSel.expectExplicitAlias = false;
        topSel.afterExplicitAlias = true;
        topSel.lastItemEnd = tok.end;
        continue;
      }

      if (up === 'AS') {
        if (topSel.tentativeAliasTok && !isOnBrokenLine(topSel.tentativeAliasTok)) {
          // Previous expression had a bare next column followed by `AS`: e.g. `"NAME"\n "PRICE" AS "P"`
          emitMissingComma(
            topSel.beforeAliasEnd,
            topSel.tentativeAliasTok,
            `Expected ',' before '${topSel.tentativeAliasTok.text}'.`
          );
          topSel.tentativeAliasTok = null;
        }
        topSel.expectExplicitAlias = true;
        topSel.afterExplicitAlias = false;
        continue;
      }

      if (topSel.afterExplicitAlias) {
        if (!isOnBrokenLine(tok)) {
          emitMissingComma(topSel.lastItemEnd, tok, `Expected ',' before '${tok.text}' in SELECT list.`);
        }
        topSel.afterExplicitAlias = false;
        topSel.itemParts = 1;
        topSel.expectOperand = false;
        topSel.lastItemEnd = tok.end;
        continue;
      }

      // Operators / expression continuations
      if (tok.type === 'op' || tok.text === '.' || tok.text === '::' || tok.text === '[' || tok.text === ']' || (tok.type === 'word' && SELECT_PREFIX_OPS.has(up))) {
        if (
          topSel.tentativeAliasTok &&
          (tok.type === 'op' || tok.text === '.' || tok.text === '::') &&
          !isOnBrokenLine(topSel.tentativeAliasTok)
        ) {
          // Pattern: `"NAME" "PRICE" * 1.1` -> `"PRICE"` starts a new computed column, not an alias!
          emitMissingComma(
            topSel.beforeAliasEnd,
            topSel.tentativeAliasTok,
            `Expected ',' before '${topSel.tentativeAliasTok.text}' in SELECT list.`
          );
          topSel.tentativeAliasTok = null;
          topSel.itemParts = 1;
        }
        topSel.expectOperand = tok.text !== ']';
        if (tok.text === '*') {
          // Could be `SELECT *` or `t.*` or binary multiplication `a * b`
          if (prevUp === 'SELECT' || prevUp === ',' || prev?.text === '.') {
            topSel.expectOperand = false;
            topSel.itemParts = Math.max(1, topSel.itemParts);
            topSel.lastItemEnd = tok.end;
          }
        }
        continue;
      }

      if (up === 'TIME' || up === 'ZONE' || up === 'AT' || (up === 'GROUP' && prevUp === 'WITHIN') || ['DAY', 'MONTH', 'YEAR', 'HOUR', 'MINUTE', 'SECOND'].includes(up)) {
        topSel.expectOperand = up === 'AT' || up === 'TIME' || up === 'ZONE' || up === 'GROUP';
        topSel.lastItemEnd = tok.end;
        continue;
      }

      // Operand token inside SELECT list
      if (topSel.expectOperand) {
        topSel.expectOperand = false;
        topSel.itemParts = 1;
        topSel.lastItemEnd = tok.end;
        continue;
      }

      // Second or third adjacent operand with no separating comma or operator!
      const isPlainAliasCandidate = tok.type === 'word' || tok.type === 'qident';
      const nextIsParen = codeTokens[i + 1]?.text === '(';
      if (topSel.itemParts >= 2 || !isPlainAliasCandidate || nextIsParen) {
        if (!isOnBrokenLine(tok)) {
          emitMissingComma(topSel.lastItemEnd, tok, `Expected ',' before '${tok.text}' in SELECT list.`);
        }
        topSel.tentativeAliasTok = null;
        topSel.itemParts = 1;
        topSel.lastItemEnd = tok.end;
      } else {
        // Record tentative implicit alias (`SELECT col alias`) in case a 3rd item or `*`/`+` follows
        topSel.beforeAliasEnd = topSel.lastItemEnd;
        topSel.tentativeAliasTok = tok;
        topSel.itemParts = 2;
        topSel.lastItemEnd = tok.end;
      }
    }
  }
}

interface NonSqlToken {
  readonly kind: 'word' | 'string' | 'punct' | 'expr';
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Lexical + delimiter scanner for non-SQL HANA artifacts using backslash string escapes:
 * CDS (`.hdbdd`, `.hdbcds`), Classic KV, `.xsodata`, and Classic `.hdbrole`.
 */
function scanNonSqlArtifacts(
  text: string,
  options: { readonly allowCdsExpr?: boolean; readonly singleLineDoubleQuote?: boolean }
): { tokens: NonSqlToken[]; diagnostics: AnalyzerDiagnostic[] } {
  const diagnostics: AnalyzerDiagnostic[] = [];
  const tokens: NonSqlToken[] = [];
  const delimStack: Array<{ ch: '(' | '[' | '{'; start: number; end: number }> = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '\ufeff') {
      i++;
      continue;
    }

    // Line comment `//` or `--`
    if ((ch === '/' && text[i + 1] === '/') || (ch === '-' && text[i + 1] === '-')) {
      i += 2;
      while (i < n && text[i] !== '\n') i++;
      continue;
    }

    // Block comment `/* ... */`
    if (ch === '/' && text[i + 1] === '*') {
      const start = i;
      i += 2;
      let closed = false;
      while (i + 1 < n) {
        if (text[i] === '*' && text[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        i = n;
        diagnostics.push({
          ruleId: 'HANA-SYN-002',
          category: 'syntax',
          severity: 'error',
          message: "Unterminated block comment '/*'.",
          start,
          end: Math.min(n, start + 2),
          fixes: [],
        });
      }
      continue;
    }

    // Backslash-escaped string literals (`"..."` and `'...'`)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        if (options.singleLineDoubleQuote && quote === '"' && (text[i] === '\n' || text[i] === '\r')) {
          break;
        }
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        const tailNl = text.slice(start, i).search(/[\r\n]/);
        const spanEnd = tailNl >= 0 ? start + Math.max(2, tailNl) : Math.min(n, Math.max(i, start + 2));
        diagnostics.push({
          ruleId: 'HANA-SYN-001',
          category: 'syntax',
          severity: 'error',
          message: quote === '"' ? 'Unterminated string or quoted identifier.' : 'Unterminated string literal.',
          start,
          end: Math.min(spanEnd, start + 24),
          fixes: [],
        });
      }
      tokens.push({ kind: 'string', text: text.slice(start, i), start, end: i });
      continue;
    }

    // CDS raw SQL expression literal `![ ... ]`
    if (options.allowCdsExpr && ch === '!' && text[i + 1] === '[') {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        const c = text[i];
        if (c === "'") {
          i++;
          while (i < n) {
            if (text[i] === "'" && text[i + 1] === "'") {
              i += 2;
              continue;
            }
            if (text[i] === "'") {
              i++;
              break;
            }
            i++;
          }
          continue;
        }
        if (c === '[') depth++;
        else if (c === ']') depth--;
        i++;
      }
      if (depth > 0) {
        diagnostics.push({
          ruleId: 'HANA-SYN-001',
          category: 'syntax',
          severity: 'error',
          message: "Unterminated CDS expression literal '![...]'.",
          start,
          end: Math.min(n, start + 2),
          fixes: [],
        });
      }
      tokens.push({ kind: 'expr', text: text.slice(start, i), start, end: i });
      continue;
    }

    // Words / identifiers
    if (/[A-Za-z_@#$\p{L}]/u.test(ch)) {
      const start = i;
      i++;
      while (i < n && /[A-Za-z0-9_#$\p{L}\p{N}]/u.test(text[i])) i++;
      tokens.push({ kind: 'word', text: text.slice(start, i), start, end: i });
      continue;
    }

    // Delimiters
    if (ch === '(' || ch === '[' || ch === '{') {
      delimStack.push({ ch, start: i, end: i + 1 });
      tokens.push({ kind: 'punct', text: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      const expected = matchingOpener(ch);
      const top = delimStack[delimStack.length - 1];
      if (!top) {
        diagnostics.push({
          ruleId: 'HANA-SYN-003',
          category: 'syntax',
          severity: 'error',
          message: `Unmatched closing delimiter '${ch}'.`,
          start: i,
          end: i + 1,
          fixes: [],
        });
      } else if (top.ch !== expected) {
        diagnostics.push({
          ruleId: 'HANA-SYN-003',
          category: 'syntax',
          severity: 'error',
          message: `Unexpected closing delimiter '${ch}'. Expected '${matchingCloser(top.ch)}'.`,
          start: i,
          end: i + 1,
          fixes: [],
        });
        const matchIdx = findLastDelimIndex(delimStack, expected);
        if (matchIdx >= 0) {
          delimStack.length = matchIdx;
        }
      } else {
        delimStack.pop();
      }
      tokens.push({ kind: 'punct', text: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    tokens.push({ kind: 'punct', text: ch, start: i, end: i + 1 });
    i++;
  }

  for (const unclosed of delimStack) {
    diagnostics.push({
      ruleId: 'HANA-SYN-003',
      category: 'syntax',
      severity: 'error',
      message: `Unclosed delimiter '${unclosed.ch}'.`,
      start: unclosed.start,
      end: unclosed.end,
      fixes: [],
    });
  }

  return { tokens, diagnostics };
}

function checkCdsDeclarationTypos(tokens: readonly NonSqlToken[], diagnostics: AnalyzerDiagnostic[]): void {
  let depth = 0;
  let expectStmtStart = true;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.text === '{' || t.text === '[' || t.text === '(') {
      depth++;
      expectStmtStart = t.text === '{';
      continue;
    }
    if (t.text === '}' || t.text === ']' || t.text === ')') {
      depth = Math.max(0, depth - 1);
      expectStmtStart = t.text === '}';
      continue;
    }
    if (t.text === ';') {
      expectStmtStart = true;
      continue;
    }
    if (!expectStmtStart) continue;

    // Skip CDS `@Annotation` headers (`@Schema: 'X'`, `@Catalog.index: [...]`)
    if (t.kind === 'word' && t.text.startsWith('@')) {
      i++;
      while (i < tokens.length && tokens[i].text === '.') i += 2;
      if (tokens[i]?.text === ':') {
        i++;
        const startedBracket = tokens[i]?.text === '{' || tokens[i]?.text === '[' || tokens[i]?.text === '(';
        let annotDepth = 0;
        while (i < tokens.length) {
          if (tokens[i].text === '{' || tokens[i].text === '[' || tokens[i].text === '(') {
            annotDepth++;
          } else if (tokens[i].text === '}' || tokens[i].text === ']' || tokens[i].text === ')') {
            if (annotDepth === 0) break;
            annotDepth--;
            if (annotDepth === 0 && startedBracket) break;
          }
          if (annotDepth === 0) {
            const nxt = tokens[i + 1];
            if (
              tokens[i].kind !== 'punct' &&
              (!nxt || (nxt.text !== '.' && nxt.text !== ':' && nxt.text !== ','))
            ) {
              break;
            }
          }
          i++;
        }
      } else if (tokens[i]?.text === '(') {
        let p = 1;
        i++;
        while (i < tokens.length && p > 0) {
          if (tokens[i].text === '(') p++;
          else if (tokens[i].text === ')') p--;
          i++;
        }
        i--;
      }
      expectStmtStart = true;
      continue;
    }

    if (t.kind === 'word') {
      const lower = t.text.toLowerCase();
      if (!CDS_TOP_KEYWORDS.has(lower)) {
        const next = tokens[i + 1];
        // Never flag entity field declarations (`field : Type;` or `field = ...;`) or member access
        const nextIsDelimiter = !next || [':', '=', ',', ';', '(', '.'].includes(next.text);
        if (!nextIsDelimiter && next.kind === 'word') {
          const fixKw = matchKeywordTypo(t.text, CDS_DECLARATION_KEYWORDS, {
            allowShort: false,
            lowercase: true,
          });
          if (fixKw && (depth === 0 || ['entity', 'context', 'type', 'view', 'key', 'association'].includes(fixKw))) {
            diagnostics.push({
              ruleId: 'HANA-SYN-021',
              category: 'syntax',
              severity: 'error',
              message: `Unknown CDS keyword '${t.text}'. Did you mean '${fixKw}'?`,
              start: t.start,
              end: t.end,
              fixes: [makeReplaceFix(`Replace '${t.text}' with '${fixKw}'`, t.start, t.end, fixKw)],
            });
          }
        }
      }
    }
    expectStmtStart = false;
  }
}

/**
 * Validates Classic Key-Value syntax (`key = value;`, `{ k = v; }`) for `HANA-SYN-022`
 * while preserving documented tolerances (optional trailing semicolon in `.hdbview`, comma lists).
 */
function checkClassicKvStructure(
  tokens: readonly NonSqlToken[],
  languageId: string,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const stack: Array<{ mode: 'top' | 'object' | 'array'; arrayExpectSep: boolean; lastArrayItemEnd: number }> = [
    { mode: 'top', arrayExpectSep: false, lastArrayItemEnd: 0 },
  ];
  let state: 'expectKey' | 'expectEq' | 'expectVal' | 'inVal' = 'expectKey';
  let currentKey = '';
  let valDepth = 0;

  const isKeyMode = (): boolean => {
    const mode = stack[stack.length - 1].mode;
    return mode === 'top' || mode === 'object';
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const topFrame = stack[stack.length - 1];

    if (t.text === '(' || t.text === '[' || t.text === '{') {
      if (topFrame.mode === 'array' && (t.text === '{' || t.text === '[') && topFrame.arrayExpectSep) {
        diagnostics.push({
          ruleId: 'HANA-SYN-023',
          category: 'syntax',
          severity: 'error',
          message: `Expected ',' before '${t.text}' in array literal.`,
          start: t.start,
          end: t.end,
          fixes: [makeInsertCommaFix(topFrame.lastArrayItemEnd)],
        });
      }
      if (state === 'expectKey' && t.text === '{') {
        stack.push({ mode: 'object', arrayExpectSep: false, lastArrayItemEnd: t.end });
        continue;
      }
      if (state === 'inVal' || state === 'expectVal') {
        state = 'inVal';
        if (t.text === '{') {
          stack.push({ mode: 'object', arrayExpectSep: false, lastArrayItemEnd: t.end });
          state = 'expectKey';
        } else if (t.text === '[') {
          stack.push({ mode: 'array', arrayExpectSep: false, lastArrayItemEnd: t.end });
        } else {
          valDepth++;
        }
      } else {
        stack.push({
          mode: t.text === '[' ? 'array' : t.text === '{' ? 'object' : 'top',
          arrayExpectSep: false,
          lastArrayItemEnd: t.end,
        });
      }
      continue;
    }

    if (t.text === ')' || t.text === ']' || t.text === '}') {
      if (valDepth > 0 && t.text === ')') {
        valDepth--;
        continue;
      }
      if (state === 'expectVal' && isKeyMode()) {
        diagnostics.push({
          ruleId: 'HANA-SYN-022',
          category: 'syntax',
          severity: 'error',
          message: `Expected value after '=' for key '${currentKey}'.`,
          start: t.start,
          end: t.end,
          fixes: [],
        });
      } else if (state === 'expectEq' && isKeyMode()) {
        diagnostics.push({
          ruleId: 'HANA-SYN-022',
          category: 'syntax',
          severity: 'error',
          message: `Expected '=' after key '${currentKey}'.`,
          start: t.start,
          end: t.end,
          fixes: [],
        });
      }
      if (stack.length > 1) {
        stack.pop();
      }
      const newTop = stack[stack.length - 1];
      if (newTop.mode === 'array') {
        newTop.arrayExpectSep = true;
        newTop.lastArrayItemEnd = t.end;
      }
      state = isKeyMode() ? (stack.length > 1 ? 'inVal' : 'expectKey') : 'inVal';
      // When an object inside `[ ... ]` or value closes back to enclosing KV block, expect `;` or `,`
      if (stack.length === 1 && t.text === '}') state = 'inVal';
      continue;
    }

    if (topFrame.mode === 'array') {
      if (t.text === ',' || (languageId === 'hdbti' && t.text === ':')) {
        topFrame.arrayExpectSep = false;
        topFrame.lastArrayItemEnd = t.end;
        continue;
      }
      if (t.text === '.' || t.text === '-') {
        topFrame.arrayExpectSep = false;
        topFrame.lastArrayItemEnd = t.end;
        continue;
      }
      if (t.kind === 'word' || t.kind === 'string') {
        if (topFrame.arrayExpectSep) {
          diagnostics.push({
            ruleId: 'HANA-SYN-023',
            category: 'syntax',
            severity: 'error',
            message: `Expected ',' before '${t.text}' in array literal.`,
            start: t.start,
            end: t.end,
            fixes: [makeInsertCommaFix(topFrame.lastArrayItemEnd)],
          });
        }
        topFrame.arrayExpectSep = true;
        topFrame.lastArrayItemEnd = t.end;
      }
      continue;
    }

    if (!isKeyMode()) {
      continue;
    }

    if (state === 'expectKey') {
      if (t.text === ';') {
        continue;
      }
      if (t.kind === 'word') {
        currentKey = t.text;
        while (tokens[i + 1]?.text === '.' && tokens[i + 2]?.kind === 'word') {
          currentKey += `.${tokens[i + 2].text}`;
          i += 2;
        }
        state = 'expectEq';
        continue;
      }
      // Stray token where key was expected inside `{}` or top-level
      continue;
    }

    if (state === 'expectEq') {
      if (t.text === '=') {
        state = 'expectVal';
        continue;
      }
      diagnostics.push({
        ruleId: 'HANA-SYN-022',
        category: 'syntax',
        severity: 'error',
        message: `Expected '=' after key '${currentKey}'.`,
        start: t.start,
        end: t.end,
        fixes: [],
      });
      if (t.text === ';') {
        state = 'expectKey';
      } else {
        state = 'inVal';
      }
      continue;
    }

    if (state === 'expectVal') {
      if (t.text === ';') {
        diagnostics.push({
          ruleId: 'HANA-SYN-022',
          category: 'syntax',
          severity: 'error',
          message: `Expected value after '=' for key '${currentKey}'.`,
          start: t.start,
          end: t.end,
          fixes: [],
        });
        state = 'expectKey';
        continue;
      }
      // Detect missing value before the next `nextKey(.sub)* =` assignment
      if (t.kind === 'word') {
        let look = i + 1;
        while (tokens[look]?.text === '.' && tokens[look + 1]?.kind === 'word') look += 2;
        if (tokens[look]?.text === '=') {
          diagnostics.push({
            ruleId: 'HANA-SYN-022',
            category: 'syntax',
            severity: 'error',
            message: `Expected value after '=' for key '${currentKey}'.`,
            start: t.start,
            end: t.end,
            fixes: [],
          });
          i--; // re-process `t` as next key
          state = 'expectKey';
          continue;
        }
      }
      state = 'inVal';
      continue;
    }

    if (state === 'inVal' && valDepth === 0 && t.text === ';') {
      state = 'expectKey';
    }
  }

  if (state === 'expectEq') {
    const last = tokens[tokens.length - 1];
    if (last) {
      diagnostics.push({
        ruleId: 'HANA-SYN-022',
        category: 'syntax',
        severity: 'error',
        message: `Expected '=' after key '${currentKey}'.`,
        start: last.start,
        end: last.end,
        fixes: [],
      });
    }
  } else if (state === 'expectVal') {
    const last = tokens[tokens.length - 1];
    if (last) {
      diagnostics.push({
        ruleId: 'HANA-SYN-022',
        category: 'syntax',
        severity: 'error',
        message: `Expected value after '=' for key '${currentKey}'.`,
        start: last.start,
        end: last.end,
        fixes: [],
      });
    }
  }
  void languageId;
  void KV_TRAILING_SEMI_OPTIONAL_SET;
}

function analyzeJsonArtifactSyntax(text: string, languageId: string): AnalyzerDiagnostic[] {
  const { errors } = parseJsonAstWithErrors(text, {
    allowMissingCommas: languageId === 'xssqlcc',
    allowEmpty: languageId === 'xsapp',
    allowComments: true,
  });

  return errors.map((err): AnalyzerDiagnostic => {
    if (err.code === 'trailing-comma') {
      return {
        ruleId: 'HANA-SYN-011',
        category: 'syntax',
        severity: 'error',
        message: err.message,
        start: err.start,
        end: err.end,
        fixes: [makeReplaceFix('Remove trailing comma', err.start, err.end, '')],
      };
    }
    return {
      ruleId: 'HANA-SYN-010',
      category: 'syntax',
      severity: 'error',
      message: err.message,
      start: err.start,
      end: err.end,
      fixes: [],
    };
  });
}

function isHdiJsonHdbrole(text: string): boolean {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\ufeff') {
      i++;
      continue;
    }
    if ((ch === '/' && text[i + 1] === '/') || (ch === '-' && text[i + 1] === '-')) {
      i += 2;
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    return ch === '{';
  }
  return false;
}

function looksLikeKeyValueMode(languageId: string, text: string): boolean {
  if (CLASSIC_KV_ALWAYS_SET.has(languageId)) return true;
  if (!DUAL_SQL_KV_SET.has(languageId)) return false;
  if (isKeyValueArtifact(text)) return true;

  // Fallback for Classic KV files whose very first line is missing `=`
  const stripped = text.replace(/^\s*(?:\/\/|--).*/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trimStart();
  if (/^(?:CREATE|ALTER|DROP|COLUMN|ROW|VIEW|PROJECTION|PROCEDURE|SEQUENCE|GLOBAL|LOCAL|TEMPORARY|PUBLIC|TYPE|STRUCTURED|FUNC|FUNCTON|PROC|PROCEDUR|TABEL|VEIW|COLUM)\b/i.test(stripped)) {
    return false;
  }
  return VALID_KV_KEYS_RE.test(stripped);
}

/**
 * Pure-TS offline syntax checker (`HANA-SYN-*`) covering SQL/SQLScript, JSON/JSONC,
 * CDS, Classic KV, `.xsodata`, Classic `.hdbrole`, and `.hdbmigrationtable`.
 */
export function analyzeSyntax(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  if (ctx.options?.syntax === false) return [];
  const { languageId, text } = ctx;

  // Empty documents are valid placeholders except strict JSON (which `.xsapp` explicitly allows).
  if (JSON_SYNTAX_SET.has(languageId)) {
    return filterSuppressedDiagnostics(text, analyzeJsonArtifactSyntax(text, languageId));
  }

  if (languageId === 'hdbrole') {
    if (isHdiJsonHdbrole(text)) {
      return filterSuppressedDiagnostics(text, analyzeJsonArtifactSyntax(text, languageId));
    }
    const { tokens, diagnostics } = scanNonSqlArtifacts(text, { singleLineDoubleQuote: true });
    if (tokens.length > 0 && tokens[0].kind === 'word' && tokens[0].text.toLowerCase() !== 'role') {
      const fixKw = matchKeywordTypo(tokens[0].text, ['role'], { allowShort: true, lowercase: true });
      if (fixKw) {
        diagnostics.push({
          ruleId: 'HANA-SYN-021',
          category: 'syntax',
          severity: 'error',
          message: `Unknown keyword '${tokens[0].text}' in Classic .hdbrole. Did you mean 'role'?`,
          start: tokens[0].start,
          end: tokens[0].end,
          fixes: [makeReplaceFix("Replace with 'role'", tokens[0].start, tokens[0].end, 'role')],
        });
      }
    }
    return filterSuppressedDiagnostics(text, diagnostics);
  }

  if (languageId === 'hdbmigrationtable') {
    const sections = splitMigrationTableSections(text);
    const out: AnalyzerDiagnostic[] = [];
    for (const sec of sections) {
      if (!sec.slice.trim()) continue;
      out.push(
        ...analyzeSqlSection(sec.slice, {
          baseOffset: sec.baseOffset,
          languageId: 'sql',
          checkBlocks: true,
          checkHeaderRoots: false,
        })
      );
    }
    return filterSuppressedDiagnostics(text, out);
  }

  if (CDS_SET.has(languageId)) {
    const { tokens, diagnostics } = scanNonSqlArtifacts(text, {
      allowCdsExpr: true,
      singleLineDoubleQuote: true,
    });
    if (!diagnostics.some((d) => d.ruleId === 'HANA-SYN-002')) {
      checkCdsDeclarationTypos(tokens, diagnostics);
    }
    return filterSuppressedDiagnostics(text, diagnostics);
  }

  if (languageId === 'xsodata') {
    const { tokens, diagnostics } = scanNonSqlArtifacts(text, { singleLineDoubleQuote: true });
    if (tokens.length > 0 && tokens[0].kind === 'word' && tokens[0].text.toLowerCase() !== 'service') {
      const fixKw = matchKeywordTypo(tokens[0].text, ['service'], { allowShort: false, lowercase: true });
      if (fixKw) {
        diagnostics.push({
          ruleId: 'HANA-SYN-021',
          category: 'syntax',
          severity: 'error',
          message: `Unknown keyword '${tokens[0].text}' in .xsodata. Did you mean 'service'?`,
          start: tokens[0].start,
          end: tokens[0].end,
          fixes: [makeReplaceFix("Replace with 'service'", tokens[0].start, tokens[0].end, 'service')],
        });
      }
    }
    return filterSuppressedDiagnostics(text, diagnostics);
  }

  if (looksLikeKeyValueMode(languageId, text)) {
    const { tokens, diagnostics } = scanNonSqlArtifacts(text, {});
    if (!diagnostics.some((d) => d.ruleId === 'HANA-SYN-001' || d.ruleId === 'HANA-SYN-002')) {
      checkClassicKvStructure(tokens, languageId, diagnostics);
    }
    return filterSuppressedDiagnostics(text, diagnostics);
  }

  if (SQL_SYNTAX_SET.has(languageId) || DEDICATED_ARTIFACT_LANGUAGES.includes(languageId)) {
    if (!text.trim()) return [];
    const diagnostics = analyzeSqlSection(text, {
      baseOffset: 0,
      languageId,
      checkBlocks: SQLSCRIPT_BLOCK_LANGUAGES.has(languageId),
      checkHeaderRoots: languageId !== 'sql' && languageId !== 'hanasql',
    });
    return filterSuppressedDiagnostics(text, diagnostics);
  }

  return [];
}
