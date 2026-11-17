import { isKeyValueArtifact } from '../formatter/detect';
import { DEDICATED_ARTIFACT_LANGUAGES, JSON_ARTIFACT_LANGUAGES, SQL_LANGUAGES } from '../formatter/dispatch';
import { tokenize, type Token } from '../formatter/tokenizer';
import { analyzeDelimiters, type DelimTokenInput } from './delimiters';
import { parseJsonAstWithErrors } from './json-parser';
import { checkSqlSelectClauseOrder } from './sql-order';
import { checkSqlScriptOrderAndContext } from './sql-context';
import { checkSqlLexicalIntegrity, dedupeLexicalCascade } from './sql-lexical';
import { matchKeywordTypo } from './typo';
import {
  filterSuppressedDiagnostics,
  type AnalyzerContext,
  type AnalyzerDiagnostic,
  type CodeFixSuggestion,
} from './types';

export { damerauLevenshtein, matchKeywordTypo, type TypoMatchOptions } from './typo';

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
  'hdbscalarfunction',
  'hdblibrary',
  'hdbtrigger',
  'hdbvirtualprocedure',
  'hdbvirtualfunction',
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

const HDI_ROOT_TARGETS: Readonly<Record<string, readonly string[]>> = {
  hdbprocedure: ['PROCEDURE', 'CREATE'],
  hdbfunction: ['FUNCTION', 'CREATE'],
  hdbtablefunction: ['FUNCTION', 'CREATE'],
  hdbscalarfunction: ['FUNCTION', 'CREATE'],
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
  hdbcollectionindex: ['HASH', 'BLOCK', 'INDEX', 'COLLECTION', 'CREATE'],
  hdbcollectionadjindex: ['ADJACENCY', 'INDEX', 'CREATE'],
  hdbfabricvirtualtable: ['SHARED', 'VIRTUAL', 'CREATE'],
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

function makeReplaceFix(title: string, start: number, end: number, replacement: string): CodeFixSuggestion {
  return {
    title,
    kind: 'quickfix',
    isPreferred: true,
    edits: [{ start, end, newText: replacement }],
  };
}

function makeRemoveFix(title: string, start: number, end: number): CodeFixSuggestion {
  return makeReplaceFix(title, start, end, '');
}

const SQL_TYPE_ARG_NAMES = new Set<string>([
  'DECIMAL',
  'DEC',
  'NUMERIC',
  'SMALLDECIMAL',
  'VARCHAR',
  'NVARCHAR',
  'CHAR',
  'NCHAR',
  'BINARY',
  'VARBINARY',
  'ALPHANUM',
  'SHORTTEXT',
  'FLOAT',
  'DOUBLE',
  'TIME',
  'TIMESTAMP',
  'SECONDDATE',
  'VECTOR',
  'ST_GEOMETRY',
  'ST_POINT',
]);

const SQL_TYPE_ARG_UNITS = new Set<string>(['CHAR', 'CHARACTERS', 'BYTE', 'BYTES']);

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
  // `//` is NOT a SQL/SQLScript comment (only `--` and `/* ... */` are). The tokenizer still recognizes it so a
  // stray quote inside `// it's` cannot swallow the rest of the file; every such comment is reported as an
  // error (`HANA-SYN-005`) by `checkSqlLexicalIntegrity`.
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
  const delimInputs: DelimTokenInput[] = [];
  const lineStarts = getLineStartOffsets(slice);
  const brokenQidentLines = new Set<number>();
  let prevNonCommentTok: Token | null = null;
  let hasEofSwallow = false;

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    if (tok.type === 'lineComment') continue;
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
      prevNonCommentTok = tok;
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
      prevNonCommentTok = tok;
      continue;
    }

    if (tok.type === 'punct') {
      const ch = tok.text;
      if (ch === '(' || ch === '[' || ch === '{' || ch === ')' || ch === ']' || ch === '}' || ch === ';') {
        const isTypeArgOpener =
          ch === '(' &&
          prevNonCommentTok?.type === 'word' &&
          SQL_TYPE_ARG_NAMES.has(prevNonCommentTok.text.toUpperCase());
        delimInputs.push({
          ch,
          start: tok.start,
          end: tok.end,
          tokenIdx: idx,
          isTypeArgOpener,
        });
      }
    }
    prevNonCommentTok = tok;
  }

  const delimResult = analyzeDelimiters(slice, delimInputs, {
    fenceSemicolon: 'all',
    lineStarts,
    spanPenalty: (open, close) => {
      if (!open.isTypeArgOpener || open.tokenIdx === undefined || close.tokenIdx === undefined) return 0;
      let innerDepth = 0;
      for (let t = open.tokenIdx + 1; t < close.tokenIdx; t++) {
        const inner = tokens[t];
        if (inner.type === 'lineComment' || inner.type === 'blockComment') continue;
        if (inner.text === '(') {
          innerDepth++;
          continue;
        }
        if (inner.text === ')') {
          if (innerDepth > 0) innerDepth--;
          continue;
        }
        if (innerDepth > 0) continue;
        if (inner.type === 'qident' || inner.text === ';') return 500;
        if (inner.type === 'word' && !SQL_TYPE_ARG_UNITS.has(inner.text.toUpperCase())) {
          return 500;
        }
      }
      return 0;
    },
  });

  for (const d of delimResult.diagnostics) {
    diagnostics.push({
      ruleId: 'HANA-SYN-003',
      category: 'syntax',
      severity: 'error',
      message: d.message,
      start: baseOffset + d.start,
      end: baseOffset + d.end,
      fixes: [],
    });
  }

  // Only suppress code-level checks if an unclosed literal/comment swallowed through EOF.
  // Line-contained unclosed quoted identifiers still allow downstream lines to be checked.
  const codeTokens = tokens.filter((t) => t.type !== 'lineComment' && t.type !== 'blockComment');
  if (codeTokens.length === 0 || hasEofSwallow) {
    return diagnostics;
  }

  // 1b. Lexical integrity: `//` comments, invalid characters, glued tokens, comma/dot hygiene
  //     (HANA-SYN-005, HANA-SYN-006, HANA-SYN-024)
  const lexicalStartIdx = diagnostics.length;
  const delimBlamed = new Set<number>([...delimResult.unclosedStarts.keys(), ...delimResult.unmatchedCloseStarts]);
  checkSqlLexicalIntegrity({
    tokens,
    text: slice,
    baseOffset,
    skipStarts: delimBlamed,
    brokenLines: brokenQidentLines,
    lineOf: (offset) => findLineNumber(lineStarts, offset),
    diagnostics,
  });
  const afterLexicalIdx = diagnostics.length;

  // 2. Anchored DDL & headerless HDI root keyword typo checks (HANA-SYN-021, HANA-SYN-004)
  checkSqlHeaderTypos(slice, codeTokens, languageId, baseOffset, checkHeaderRoots, diagnostics);

  // 3. Compound block matching (HANA-SYN-020)
  if (checkBlocks && foreignBodyStart < 0) {
    checkSqlScriptBlocks(
      codeTokens,
      baseOffset,
      delimResult.unclosedStarts,
      delimResult.unmatchedCloseStarts,
      diagnostics
    );
  }

  // 4. Missing comma separators (HANA-SYN-023) & trailing commas (HANA-SYN-024)
  checkSqlMissingCommas(
    codeTokens,
    baseOffset,
    lineStarts,
    brokenQidentLines,
    delimResult.unclosedStarts,
    delimResult.unmatchedCloseStarts,
    diagnostics
  );

  // 5. Expression operators, incomplete clauses & missing body semicolons (HANA-SYN-024, HANA-SYN-025)
  // 6. SELECT query clause ordering & duplicate clause checks (HANA-SYN-027)
  // 7. SQLScript header & block declaration order & context checks (HANA-SYN-028, HANA-SYN-029)
  // 8. Single-object HDI artifact trailing statement check (HANA-SYN-004)
  if (foreignBodyStart < 0) {
    if (checkHeaderRoots && HDI_ROOT_TARGETS[languageId] && languageId !== 'hdbdropcreatetable') {
      checkSingleObjectHdiTrailing(
        codeTokens,
        languageId,
        baseOffset,
        lineStarts,
        brokenQidentLines,
        delimResult.unclosedStarts,
        delimResult.unmatchedCloseStarts,
        diagnostics
      );
    }
    checkSqlExpressionsAndClauses(
      codeTokens,
      baseOffset,
      lineStarts,
      brokenQidentLines,
      delimResult.unclosedStarts,
      delimResult.unmatchedCloseStarts,
      diagnostics
    );
    checkSqlSelectClauseOrder({
      codeTokens,
      baseOffset,
      lineStarts,
      brokenQidentLines,
      unclosedStarts: delimResult.unclosedStarts,
      unmatchedCloseStarts: delimResult.unmatchedCloseStarts,
      diagnostics,
    });
    if (SQLSCRIPT_BLOCK_LANGUAGES.has(languageId)) {
      checkSqlScriptOrderAndContext({
        languageId,
        text: slice,
        codeTokens,
        baseOffset,
        lineStarts,
        brokenQidentLines,
        unclosedStarts: delimResult.unclosedStarts,
        unmatchedCloseStarts: delimResult.unmatchedCloseStarts,
        diagnostics,
      });
    }
  }

  if (afterLexicalIdx > lexicalStartIdx) dedupeLexicalCascade(diagnostics, afterLexicalIdx, slice, baseOffset);
  return diagnostics;
}

const PROCEDURAL_HDI_LANGUAGES = new Set<string>([
  'hdbprocedure',
  'hdbfunction',
  'hdbtablefunction',
  'hdbscalarfunction',
  'hdblibrary',
  'hdbtrigger',
  'hdbvirtualprocedure',
  'hdbvirtualfunction',
]);

const HDI_END_COMPOUND_SUFFIXES = new Set<string>(['IF', 'LOOP', 'WHILE', 'FOR']);

/** Counts top-level non-comment statements starting at `startIdx` inside `codeTokens`. */
function countTrailingStatements(codeTokens: readonly Token[], startIdx: number): number {
  let count = 0;
  let inStmt = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let caseDepth = 0;
  let beginDepth = 0;
  let skipNext = false;

  for (let k = startIdx; k < codeTokens.length; k++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const t = codeTokens[k];
    if (t.text === '(') {
      parenDepth++;
      inStmt = true;
      continue;
    }
    if (t.text === ')') {
      if (parenDepth > 0) parenDepth--;
      continue;
    }
    if (t.text === '[') {
      bracketDepth++;
      inStmt = true;
      continue;
    }
    if (t.text === ']') {
      if (bracketDepth > 0) bracketDepth--;
      continue;
    }
    const tUp = t.type === 'word' ? t.text.toUpperCase() : '';
    if (tUp === 'CASE') {
      caseDepth++;
      inStmt = true;
      continue;
    }
    if (tUp === 'BEGIN' && parenDepth === 0 && bracketDepth === 0) {
      beginDepth++;
      inStmt = true;
      continue;
    }
    if (tUp === 'END') {
      const nextUp = codeTokens[k + 1]?.type === 'word' ? codeTokens[k + 1].text.toUpperCase() : '';
      if (HDI_END_COMPOUND_SUFFIXES.has(nextUp)) {
        skipNext = true;
        continue;
      }
      if (caseDepth > 0) {
        caseDepth--;
        continue;
      }
      if (parenDepth === 0 && bracketDepth === 0 && beginDepth > 0) {
        beginDepth--;
        if (beginDepth === 0 && inStmt && k + 1 < codeTokens.length && codeTokens[k + 1].text !== ';') {
          count++;
          inStmt = false;
        }
      }
      continue;
    }
    if (t.text === ';' && parenDepth === 0 && bracketDepth === 0 && caseDepth === 0 && beginDepth === 0) {
      if (inStmt) {
        count++;
        inStmt = false;
      }
      continue;
    }
    if (t.text !== ';') {
      inStmt = true;
    }
  }
  if (inStmt) count++;
  return Math.max(1, count);
}

function checkSingleObjectHdiTrailing(
  codeTokens: readonly Token[],
  languageId: string,
  baseOffset: number,
  lineStarts: readonly number[],
  brokenQidentLines: ReadonlySet<number>,
  unclosedStarts: ReadonlyMap<number, number | undefined>,
  unmatchedCloseStarts: ReadonlySet<number>,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const isProcedural = PROCEDURAL_HDI_LANGUAGES.has(languageId);
  let parenDepth = 0;
  let bracketDepth = 0;
  let caseDepth = 0;
  let beginDepth = 0;
  let sawRootBegin = false;
  let skipNext = false;

  const emitAggregatedTrailing = (afterIdx: number, rootKeepEndOffset: number): void => {
    const firstTok = codeTokens[afterIdx];
    const lastTok = codeTokens[codeTokens.length - 1];
    if (!firstTok || !lastTok) return;
    if (unclosedStarts.has(firstTok.start) || unmatchedCloseStarts.has(firstTok.start)) return;
    if (brokenQidentLines.has(findLineNumber(lineStarts, baseOffset + firstTok.start))) return;

    const count = countTrailingStatements(codeTokens, afterIdx);
    const message =
      count === 1
        ? `Only one top-level declaration is allowed in '.${languageId}'; unexpected trailing statement '${firstTok.text}'.`
        : `Only one top-level declaration is allowed in '.${languageId}'; found ${count} unexpected trailing statements.`;
    const fixTitle = count === 1 ? 'Remove trailing statement' : 'Remove trailing statements';

    diagnostics.push({
      ruleId: 'HANA-SYN-004',
      category: 'syntax',
      severity: 'error',
      message,
      start: baseOffset + firstTok.start,
      end: baseOffset + lastTok.end,
      fixes:
        lastTok.end > rootKeepEndOffset
          ? [makeRemoveFix(fixTitle, baseOffset + rootKeepEndOffset, baseOffset + lastTok.end)]
          : [],
    });
  };

  for (let idx = 0; idx < codeTokens.length; idx++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const tok = codeTokens[idx];
    if (tok.text === '(') {
      parenDepth++;
      continue;
    }
    if (tok.text === ')') {
      if (parenDepth > 0) parenDepth--;
      continue;
    }
    if (tok.text === '[') {
      bracketDepth++;
      continue;
    }
    if (tok.text === ']') {
      if (bracketDepth > 0) bracketDepth--;
      continue;
    }
    const up = tok.type === 'word' ? tok.text.toUpperCase() : '';
    if (up === 'CASE') {
      caseDepth++;
      continue;
    }
    if (up === 'BEGIN' && parenDepth === 0 && bracketDepth === 0) {
      sawRootBegin = true;
      beginDepth++;
      continue;
    }
    if (up === 'END') {
      const nextUp = codeTokens[idx + 1]?.type === 'word' ? codeTokens[idx + 1].text.toUpperCase() : '';
      if (HDI_END_COMPOUND_SUFFIXES.has(nextUp)) {
        skipNext = true;
        continue;
      }
      if (caseDepth > 0) {
        caseDepth--;
        continue;
      }
      if (parenDepth === 0 && bracketDepth === 0 && beginDepth > 0) {
        beginDepth--;
        if (beginDepth === 0 && sawRootBegin) {
          let after = idx + 1;
          while (after < codeTokens.length && codeTokens[after].text === ';') after++;
          if (after < codeTokens.length) {
            emitAggregatedTrailing(after, tok.end);
          }
          return;
        }
      }
      continue;
    }
    if (tok.text === ';' && parenDepth === 0 && bracketDepth === 0 && caseDepth === 0 && beginDepth === 0) {
      let after = idx + 1;
      while (after < codeTokens.length && codeTokens[after].text === ';') after++;
      if (after >= codeTokens.length) return;
      const afterUp = codeTokens[after].type === 'word' ? codeTokens[after].text.toUpperCase() : '';
      if (isProcedural && !sawRootBegin && (afterUp === 'USING' || afterUp === 'BEGIN')) {
        continue;
      }
      emitAggregatedTrailing(after, tok.end);
      return;
    }
  }
}

function checkSqlHeaderTypos(
  slice: string,
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
      if (!hdiTargets.includes(upper)) {
        const nextTok = codeTokens[1];
        // Do not flag labels (`lbl:`) or KV-like (`a = b` / `a.b`) if any slipped through
        const looksLikeIdentExpr = nextTok && (nextTok.text === '=' || nextTok.text === ':=' || nextTok.text === '.');
        if (!looksLikeIdentExpr) {
          const fixKw = GENERAL_SQL_VALID_ROOTS.has(upper) ? undefined : matchKeywordTypo(first.text, hdiTargets);
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
          } else {
            diagnostics.push({
              ruleId: 'HANA-SYN-004',
              category: 'syntax',
              severity: 'error',
              message: `Unexpected '${first.text}' at root of '.${languageId}' artifact; expected ${hdiTargets.join(' / ')}.`,
              start: baseOffset + first.start,
              end: baseOffset + first.end,
              fixes: [],
            });
          }
        }
      } else if (upper === 'CREATE') {
        let j = 1;
        if (
          codeTokens[j]?.type === 'word' &&
          codeTokens[j].text.toUpperCase() === 'OR' &&
          codeTokens[j + 1]?.type === 'word' &&
          codeTokens[j + 1].text.toUpperCase() === 'REPLACE'
        ) {
          j += 2;
        }
        const objTok = codeTokens[j];
        if (objTok && objTok.type === 'word') {
          const objUpper = objTok.text.toUpperCase();
          const expectedNonCreate = hdiTargets.filter((t) => t !== 'CREATE');
          if (
            !expectedNonCreate.includes(objUpper) &&
            (VALID_DDL_NOUNS.has(objUpper) || VALID_DDL_MODIFIERS.has(objUpper))
          ) {
            diagnostics.push({
              ruleId: 'HANA-SYN-004',
              category: 'syntax',
              severity: 'error',
              message: `Object type '${objTok.text}' is not valid at root of '.${languageId}' artifact; expected ${expectedNonCreate.join(' / ')}.`,
              start: baseOffset + objTok.start,
              end: baseOffset + objTok.end,
              fixes: [],
            });
          } else if (expectedNonCreate.includes(objUpper)) {
            const stripEndTok = codeTokens[j - 1];
            const between = slice.slice(stripEndTok.end, objTok.start);
            const delEnd = between.trim().length === 0 ? objTok.start : stripEndTok.end;
            const prefixLabel = j === 3 ? 'CREATE OR REPLACE' : 'CREATE';
            diagnostics.push({
              ruleId: 'HANA-SYN-004',
              category: 'syntax',
              severity: 'warning',
              message: `Headerless '.${languageId}' artifact should omit leading '${prefixLabel}'.`,
              start: baseOffset + first.start,
              end: baseOffset + stripEndTok.end,
              fixes: [
                makeRemoveFix(
                  `Remove leading '${prefixLabel}'`,
                  baseOffset + first.start,
                  baseOffset + delEnd
                ),
              ],
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

  // Statement-start checks across the file (`CREATE [OR REPLACE] <TYPO>`, `ALTER <TYPO>`, `DROP <TYPO>`).
  // Routine header clauses (`RETUNS`, `LANUAGE`, `INVOKR`, ...) are validated by the consuming header parser
  // (`sql-header.ts`, run from `checkSqlScriptOrderAndContext`).
  let parenDepth = 0;

  const pushTypo = (tok: Token, fixKw: string, message: string): void => {
    const absStart = baseOffset + tok.start;
    if (diagnostics.some((d) => d.ruleId === 'HANA-SYN-021' && d.start === absStart)) return;
    diagnostics.push({
      ruleId: 'HANA-SYN-021',
      category: 'syntax',
      severity: 'error',
      message,
      start: absStart,
      end: baseOffset + tok.end,
      fixes: [makeReplaceFix(`Replace '${tok.text}' with '${fixKw}'`, absStart, baseOffset + tok.end, fixKw)],
    });
  };

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
    const kw = tok.text.toUpperCase();

    if (isStmtStart && (kw === 'CREATE' || kw === 'ALTER' || kw === 'DROP')) {
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
      const fixKw = matchKeywordTypo(targetTok.text, DDL_TYPO_CANDIDATES);
      if (fixKw) {
        pushTypo(targetTok, fixKw, `Unexpected keyword '${targetTok.text}' after '${kw}'. Did you mean '${fixKw}'?`);
      }
    }
  }

  // Query clause keyword typo checks (works at all paren depths for queries & subqueries)
  checkQueryClauseTypos(codeTokens, baseOffset, diagnostics);
}

const COMPARISON_AFTER_WORD_SET = new Set<string>(['=', '<>', '!=', '<', '>', '<=', '>=', '~=', '^=', 'IS', 'IN', 'LIKE', 'BETWEEN', 'NOT']);
const QUERY_START_PREV = new Set<string>([';', '(', ':=', 'RETURN', 'BEGIN', 'THEN', 'ELSE', 'ELSEIF', 'DO', 'LOOP', 'UNION', 'ALL', 'INTERSECT', 'EXCEPT', 'MINUS']);

function checkQueryClauseTypos(
  codeTokens: readonly Token[],
  baseOffset: number,
  diagnostics: AnalyzerDiagnostic[]
): void {
  for (let i = 0; i < codeTokens.length; i++) {
    const tok = codeTokens[i];
    if (tok.type !== 'word') continue;
    const kw = tok.text.toUpperCase();
    const prev = i > 0 ? codeTokens[i - 1] : null;
    const next = i + 1 < codeTokens.length ? codeTokens[i + 1] : null;
    const next2 = i + 2 < codeTokens.length ? codeTokens[i + 2] : null;

    if (!next || next.text === '.' || next.text === '=' || next.text === ':=' || next.text === '(') {
      // Allow `whre(1)`, `whre := 1`, `whre = 1`, `whre.col`, and lone trailing identifier `...`
      // unless it's `ORDR BY` / `GROP BY` checked below (`next` is `BY`, not punct).
      if (!(next?.type === 'word' && next.text.toUpperCase() === 'BY')) continue;
    }

    const prevTextUp = prev?.type === 'word' ? prev.text.toUpperCase() : prev?.text ?? '';
    let fixKw: string | null = null;

    // 1. SELECT typo at query/statement start (`SELCT "A" FROM "T"`, `RETURN SELCT ...`)
    if (!prev || QUERY_START_PREV.has(prevTextUp)) {
      if (kw !== 'SELECT' && kw !== 'SIGNAL' && kw !== 'SET' && kw !== 'SLICE') {
        const cand = matchKeywordTypo(tok.text, ['SELECT'], { allowShort: false });
        if (cand && next && (next.type === 'qident' || next.type === 'word' || next.type === 'number' || next.type === 'string' || next.text === '*' || next.text === '(')) {
          fixKw = cand;
        }
      }
    }

    // 2. GROP BY / ORDR BY
    if (!fixKw && next?.type === 'word' && next.text.toUpperCase() === 'BY' && prev?.text !== '.') {
      if (kw === 'GROP' || kw === 'GROU' || kw === 'GRUOP') fixKw = 'GROUP';
      else if (kw === 'ORDR' || kw === 'OREDR' || kw === 'ODER') fixKw = 'ORDER';
    }

    // 3. WHRE <operand> <comparison> (after FROM <table_ref>, never after SELECT/comma/dot/AS)
    if (
      !fixKw &&
      tok.nlBefore > 0 &&
      prev &&
      prev.text !== '.' &&
      prev.text !== ',' &&
      prevTextUp !== 'SELECT' &&
      prevTextUp !== 'AS' &&
      prevTextUp !== 'FROM' &&
      prevTextUp !== 'JOIN' &&
      prev.type !== 'op'
    ) {
      const candWhere = matchKeywordTypo(tok.text, ['WHERE'], { allowShort: false });
      if (candWhere && next && next2) {
        const next2Up = next2.type === 'word' ? next2.text.toUpperCase() : next2.text;
        const looksLikePred =
          ((next.type === 'qident' || next.type === 'word' || next.type === 'var') && COMPARISON_AFTER_WORD_SET.has(next2Up)) ||
          (next.type === 'word' && (next.text.toUpperCase() === 'EXISTS' || next.text.toUpperCase() === 'NOT') && next2.text === '(');
        if (looksLikePred) {
          fixKw = candWhere;
        }
      }
    }

    // 4. HAVNG <expr> <cmp> or LIMT <num>
    if (!fixKw && tok.nlBefore > 0 && prev && prev.text !== '.' && prev.text !== ',' && prev.type !== 'op') {
      const candHavLim = matchKeywordTypo(tok.text, ['HAVING', 'LIMIT'], { allowShort: false });
      if (candHavLim === 'LIMIT' && next && (next.type === 'number' || next.type === 'var' || next.type === 'param')) {
        const n2 = next2?.text;
        if (!n2 || n2 === ';' || n2 === ')' || next2?.text.toUpperCase() === 'OFFSET' || next2?.text.toUpperCase() === 'END') {
          fixKw = 'LIMIT';
        }
      } else if (candHavLim === 'HAVING' && next && next2) {
        const next2Up = next2.type === 'word' ? next2.text.toUpperCase() : next2.text;
        if (next2.text === '(' || COMPARISON_AFTER_WORD_SET.has(next2Up)) {
          fixKw = 'HAVING';
        }
      }
    }

    if (fixKw) {
      const absStart = baseOffset + tok.start;
      if (!diagnostics.some((d) => d.ruleId === 'HANA-SYN-021' && d.start === absStart)) {
        diagnostics.push({
          ruleId: 'HANA-SYN-021',
          category: 'syntax',
          severity: 'error',
          message: `Unknown SQL clause keyword '${tok.text}'. Did you mean '${fixKw}'?`,
          start: absStart,
          end: baseOffset + tok.end,
          fixes: [makeReplaceFix(`Replace '${tok.text}' with '${fixKw}'`, absStart, baseOffset + tok.end, fixKw)],
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
  unclosedStarts: ReadonlyMap<number, number | undefined>,
  unmatchedCloseStarts: ReadonlySet<number>,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const stack: BlockFrame[] = [];
  let parenDepth = 0;

  const hasOpenCompound = (): boolean => stack.some((f) => f.kind !== 'CASE');

  for (let i = 0; i < codeTokens.length; i++) {
    const tok = codeTokens[i];
    if (tok.text === ';') {
      parenDepth = 0;
      continue;
    }
    if (tok.text === '(') {
      if (!unclosedStarts.has(tok.start)) parenDepth++;
      continue;
    }
    if (tok.text === ')') {
      if (!unmatchedCloseStarts.has(tok.start)) parenDepth = Math.max(0, parenDepth - 1);
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
  // Clause-syntax graph table function `[CLOUD]` `[HDI]`: `GRAPH WORKSPACE <ws> QUERY '<cypher>' [PARAMETERS (...)]`
  'OPENCYPHER_TABLE',
  // Clause-syntax hierarchy generator & navigation functions `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
  // (`HIERARCHY_COMPOSITE_ID(a, b, ...)` is a plain comma-separated scalar call and stays checked.)
  'HIERARCHY',
  'HIERARCHY_LEVELED',
  'HIERARCHY_SPANTREE',
  'HIERARCHY_TEMPORAL',
  'HIERARCHY_ANCESTORS',
  'HIERARCHY_ANCESTORS_AGGREGATE',
  'HIERARCHY_DESCENDANTS',
  'HIERARCHY_DESCENDANTS_AGGREGATE',
  'HIERARCHY_SIBLINGS',
]);

/** Clause-syntax hierarchy generator & navigation table functions (`<fn>(SOURCE ... START WHERE ... DEPTH ...)`). */
const HIERARCHY_CLAUSE_FUNCTIONS = new Set<string>([
  'HIERARCHY',
  'HIERARCHY_LEVELED',
  'HIERARCHY_SPANTREE',
  'HIERARCHY_TEMPORAL',
  'HIERARCHY_ANCESTORS',
  'HIERARCHY_ANCESTORS_AGGREGATE',
  'HIERARCHY_DESCENDANTS',
  'HIERARCHY_DESCENDANTS_AGGREGATE',
  'HIERARCHY_SIBLINGS',
]);

/**
 * Top-level clause keywords of hierarchy functions that end a preceding `START WHERE` / `WHERE` / `JOIN ... ON`
 * condition. These are non-reserved in SAP HANA, so they only act as terminators inside hierarchy call frames.
 */
const HIERARCHY_CLAUSE_TERMINATORS = new Set<string>([
  'SOURCE',
  'START',
  'JOIN',
  'MEASURES',
  'DISTANCE',
  'LEVELS',
  'SIBLING',
  'VALID',
  'DEPTH',
  'MULTIPARENT',
  'ORPHAN',
  'CYCLE',
  'CACHE',
  'NO',
  'LOAD',
  'RETAIN',
]);

/**
 * `JSON_VALUE` / `JSON_QUERY` take `<ctx>, <path>` followed by space-separated clauses
 * (`RETURNING <type>`, `WITH|WITHOUT [...] WRAPPER`, `<behavior> ON EMPTY`, `<behavior> ON ERROR`).
 * Comma checking is disabled from the first clause keyword onward.
 */
const JSON_CLAUSE_CALL_NAMES = new Set<string>(['JSON_VALUE', 'JSON_QUERY']);
const JSON_CALL_CLAUSE_STARTERS = new Set<string>([
  'RETURNING',
  'WITH',
  'WITHOUT',
  'ERROR',
  'NULL',
  'DEFAULT',
  'EMPTY',
  'ON',
  'KEEP',
  'OMIT',
]);

/** Words that may follow a complete `JSON_TABLE` column definition (behaviors and wrapper clauses). */
const JSON_COLUMN_TRAILING_WORDS = new Set<string>([
  'ERROR',
  'NULL',
  'DEFAULT',
  'EMPTY',
  'ARRAY',
  'OBJECT',
  'ON',
  'WITH',
  'WITHOUT',
  'CONDITIONAL',
  'UNCONDITIONAL',
  'WRAPPER',
  'KEEP',
  'OMIT',
  'QUOTES',
]);

/** True when `(` at `openIdx` opens a `COLUMNS (...)` list of `JSON_TABLE` (incl. `NESTED [PATH] '...' COLUMNS (...)`). */
function isJsonTableColumnsParen(codeTokens: readonly Token[], openIdx: number): boolean {
  const prev = openIdx > 0 ? codeTokens[openIdx - 1] : null;
  if (!prev || prev.type !== 'word' || prev.text.toUpperCase() !== 'COLUMNS') return false;
  let depth = 0;
  for (let k = openIdx - 2; k >= 0; k--) {
    const t = codeTokens[k].text;
    if (t === ';') return false;
    if (t === ')') depth++;
    else if (t === '(') {
      if (depth === 0) {
        const owner = k > 0 ? codeTokens[k - 1] : null;
        const ownerUp = owner?.type === 'word' ? owner.text.toUpperCase() : '';
        if (ownerUp === 'JSON_TABLE') return true;
        if (ownerUp === 'COLUMNS') return isJsonTableColumnsParen(codeTokens, k);
        return false;
      }
      depth--;
    }
  }
  return false;
}

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

function makeInsertSemiFix(insertAt: number): CodeFixSuggestion {
  return {
    title: "Insert ';'",
    kind: 'quickfix',
    isPreferred: true,
    edits: [{ start: insertAt, end: insertAt, newText: ';' }],
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
): 'params' | 'columns' | 'call' | 'skip' | 'json_columns' {
  const listKind = isTypeListOpener(codeTokens, openIdx);
  if (listKind) return listKind;

  // `JSON_TABLE(<ctx>, <path> COLUMNS (<col> <type> PATH '...' [...], NESTED [PATH] '...' COLUMNS (...)))`
  if (isJsonTableColumnsParen(codeTokens, openIdx)) return 'json_columns';

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
  readonly kind: 'params' | 'columns' | 'call' | 'skip' | 'json_columns';
  readonly depth: number;
  // For `JSON_VALUE` / `JSON_QUERY` 'call' frames: disable comma checks at the first clause keyword
  readonly jsonClauseCall: boolean;
  // For 'json_columns' frames (`JSON_TABLE ... COLUMNS (...)`):
  // `start` (before an entry), `entry` (inside `<col> <type> PATH`/`NESTED ...`), `complete` (entry ended,
  // only trailing behavior/wrapper clauses may follow), `value` (awaiting a `DEFAULT <value>` operand).
  jsonPhase: 'start' | 'entry' | 'complete' | 'value';
  jsonNested: boolean;
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

function hasTopLevelCommaInParen(codeTokens: readonly Token[], openIdx: number): boolean {
  let depth = 1;
  for (let k = openIdx + 1; k < codeTokens.length; k++) {
    const t = codeTokens[k].text;
    if (t === '(') depth++;
    else if (t === ')') {
      depth--;
      if (depth === 0) return false;
    } else if (depth === 1 && t === ',') {
      return true;
    } else if (t === ';') {
      return false;
    }
  }
  return false;
}

const CALL_PREFIX_KEYWORDS_NO_OP = new Set<string>([
  'CALL',
  'FUNCTION',
  'PROCEDURE',
  'TABLE',
  'VIEW',
  'ON',
  'INTO',
  'FROM',
  'JOIN',
  'UPDATE',
  'REFERENCES',
  'INDEX',
  'TRIGGER',
  'SEQUENCE',
  'SYNONYM',
  'ROLE',
  'SCHEMA',
  'TYPE',
  'EXISTS',
  'USING',
]);

/**
 * True when `"COL" (` looks like an unqualified quoted column missing a binary operator
 * (e.g. `"PRICE" (1.0 + :tax)`) rather than a valid function or procedure invocation.
 */
function isUnqualifiedColumnParenExpr(codeTokens: readonly Token[], openIdx: number): boolean {
  const tok = codeTokens[openIdx];
  const prev = openIdx > 0 ? codeTokens[openIdx - 1] : null;
  if (!tok || !prev || prev.type !== 'qident') return false;
  if (!tok.wsBefore && tok.nlBefore === 0) return false;
  if (prev.text.includes('::')) return false;
  const beforePrev = openIdx > 1 ? codeTokens[openIdx - 2] : null;
  if (beforePrev?.text === '.' || beforePrev?.text === '::') return false;
  if (beforePrev?.type === 'word' && CALL_PREFIX_KEYWORDS_NO_OP.has(beforePrev.text.toUpperCase())) {
    return false;
  }
  return !hasTopLevelCommaInParen(codeTokens, openIdx);
}

/**
 * Detects missing comma separators (`HANA-SYN-023`) in unambiguous SQL lists:
 * procedure/function parameter lists, table column definitions, `SELECT` projections,
 * function call arguments, `VALUES`, `IN`, and `INSERT` column lists,
 * as well as trailing commas (`HANA-SYN-024`) before `)` or query stop clauses.
 */
function checkSqlMissingCommas(
  codeTokens: readonly Token[],
  baseOffset: number,
  lineStarts: readonly number[],
  brokenQidentLines: ReadonlySet<number>,
  unclosedStarts: ReadonlyMap<number, number | undefined>,
  unmatchedCloseStarts: ReadonlySet<number>,
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

  const emitTrailingComma = (commaTok: Token, beforeText: string): void => {
    const absStart = baseOffset + commaTok.start;
    const absEnd = baseOffset + commaTok.end;
    if (diagnostics.some((d) => d.ruleId === 'HANA-SYN-024' && d.start === absStart)) return;
    diagnostics.push({
      ruleId: 'HANA-SYN-024',
      category: 'syntax',
      severity: 'error',
      message: `Unexpected trailing ',' before '${beforeText}'.`,
      start: absStart,
      end: absEnd,
      fixes: [makeRemoveFix("Remove trailing ','", absStart, absEnd)],
    });
  };

  /**
   * Missing-comma check between `JSON_TABLE` column entries: an entry is complete after `FOR ORDINALITY`,
   * after its `PATH '<path>'` literal, or after a nested `COLUMNS (...)`; only behavior/wrapper clauses
   * (`ERROR|NULL|DEFAULT <v>|EMPTY ARRAY|EMPTY OBJECT ON EMPTY|ERROR`, `WITH|WITHOUT ... WRAPPER`) may follow.
   */
  const checkJsonTableColumnToken = (frame: DeclParenFrame, tok: Token, up: string, prev: Token | null): void => {
    if (tok.text === ',') {
      frame.jsonPhase = 'start';
      frame.jsonNested = false;
      frame.lastItemEnd = tok.end;
      return;
    }
    const prevUpWord = prev?.type === 'word' ? prev.text.toUpperCase() : '';
    switch (frame.jsonPhase) {
      case 'start':
        frame.jsonPhase = 'entry';
        frame.jsonNested = up === 'NESTED';
        break;
      case 'entry':
        if (up === 'ORDINALITY' && prevUpWord === 'FOR') {
          frame.jsonPhase = 'complete';
        } else if (tok.type === 'string' && !frame.jsonNested && prevUpWord === 'PATH') {
          frame.jsonPhase = 'complete';
        }
        break;
      case 'value':
        if (tok.type !== 'op' && tok.text !== '.' && tok.text !== '::') frame.jsonPhase = 'complete';
        break;
      case 'complete':
        if (up === 'DEFAULT' || tok.type === 'op') {
          frame.jsonPhase = 'value';
        } else if (JSON_COLUMN_TRAILING_WORDS.has(up)) {
          // trailing behavior / wrapper clause
        } else if (!isOnBrokenLine(tok)) {
          emitMissingComma(frame.lastItemEnd, tok, `Expected ',' before JSON_TABLE column '${tok.text}'.`);
          frame.jsonPhase = 'entry';
          frame.jsonNested = up === 'NESTED';
        }
        break;
    }
    frame.lastItemEnd = tok.end;
  };

  for (let i = 0; i < codeTokens.length; i++) {
    const tok = codeTokens[i];
    const up = tok.type === 'word' ? tok.text.toUpperCase() : '';
    const prev = i > 0 ? codeTokens[i - 1] : null;
    const prevUp = prev?.type === 'word' ? prev.text.toUpperCase() : prev?.text ?? '';

    if (tok.text === ';') {
      const topSelSemi = selectStack[selectStack.length - 1];
      if (topSelSemi && topSelSemi.depth === parenDepth && topSelSemi.caseDepth === 0 && prev?.text === ',' && !isOnBrokenLine(prev)) {
        emitTrailingComma(prev, ';');
      }
      parenStack.length = 0;
      selectStack.length = 0;
      parenDepth = 0;
      bracketDepth = 0;
      continue;
    }

    if (tok.text === '[') {
      if (unclosedStarts.has(tok.start)) continue;
      bracketDepth++;
      continue;
    }
    if (tok.text === ']') {
      if (unmatchedCloseStarts.has(tok.start)) continue;
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
      if (parenDepth > 0 && unclosedStarts.has(tok.start)) continue;
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
        jsonClauseCall: kind === 'call' && prev?.type === 'word' && JSON_CLAUSE_CALL_NAMES.has(prev.text.toUpperCase()),
        jsonPhase: 'start',
        jsonNested: false,
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
      if (unmatchedCloseStarts.has(tok.start)) continue;
      if (prev?.text === ',' && !isOnBrokenLine(prev)) {
        emitTrailingComma(prev, ')');
      }
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
        // `NESTED [PATH] '...' COLUMNS (...)` entry ends with its nested column list
        if (parentParen.kind === 'json_columns' && popped.kind === 'json_columns') {
          parentParen.jsonPhase = 'complete';
          parentParen.jsonNested = false;
        } else if (parentParen.kind === 'json_columns' && parentParen.jsonPhase === 'value') {
          parentParen.jsonPhase = 'complete';
        }
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
          if (COLUMN_END_MODIFIERS.has(up) || SQL_TYPE_ARG_UNITS.has(up)) {
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

      if (topParen.kind === 'json_columns') {
        checkJsonTableColumnToken(topParen, tok, up, prev);
        continue;
      }

      if (topParen.kind === 'call' && !topParen.callDisabled) {
        if (topParen.jsonClauseCall && JSON_CALL_CLAUSE_STARTERS.has(up)) {
          topParen.callDisabled = true;
          continue;
        }
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
        if (prev?.text === ',' && !isOnBrokenLine(prev)) {
          emitTrailingComma(prev, tok.text);
        }
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

const EXPR_BINARY_ONLY_OPS = new Set<string>([
  '*',
  '/',
  '%',
  '||',
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
]);

const EXPR_CLAUSE_TERMINATORS = new Set<string>([
  'GROUP',
  'HAVING',
  'ORDER',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'MINUS',
  'LIMIT',
  'OFFSET',
  'FOR',
  'WITH',
  'OPTION',
  'WINDOW',
  'START',
  'CONNECT',
  'RETURNING',
  'END',
  'WHERE',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
  'NATURAL',
  'USING',
  'SET',
  'VALUES',
  'WHEN',
  'THEN',
  'ELSE',
  'ELSEIF',
  'DO',
  'INTO',
  'FROM',
]);

const EXPR_PREFIX_WORDS = new Set<string>([
  'NOT',
  'PRIOR',
  'NEW',
  'CONNECT_BY_ROOT',
  'BINARY',
  'DISTINCT',
  'ALL',
  'ANY',
  'SOME',
  'EXISTS',
  'CAST',
  'CASE',
  'ROW',
]);

const EXPR_INFIX_COMPOUND_AFTER_NOT = new Set<string>([
  'IN',
  'LIKE',
  'ILIKE',
  'BETWEEN',
  'SIMILAR',
  'MEMBER',
  'SUBMULTISET',
  'REGEXP_LIKE',
  'EXISTS',
]);

const EXPR_INFIX_DIRECT = new Set<string>([
  'AND',
  'OR',
  'IN',
  'LIKE',
  'ILIKE',
  'BETWEEN',
  'ESCAPE',
]);

const TYPED_LITERAL_WORDS = new Set<string>(['DATE', 'TIME', 'TIMESTAMP', 'SECONDDATE']);
const INTERVAL_UNITS = new Set<string>(['YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'FRACTION', 'TO']);
const WINDOW_OR_ORDER_MODS = new Set<string>(['ASC', 'DESC', 'NULLS', 'FIRST', 'LAST']);

const STMT_BLOCK_END_STOP_PREV = new Set<string>([
  ';',
  ',',
  '(',
  '[',
  '.',
  '::',
  ':=',
  '=',
  '=>',
  'BEGIN',
  'THEN',
  'ELSE',
  'ELSEIF',
  'DO',
  'LOOP',
  'CASE',
  'WHEN',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'MINUS',
  'RETURN',
  'DECLARE',
  'CREATE',
  'ALTER',
  'DROP',
  'AS',
  'WITH',
  'ON',
  'FOR',
  'TO',
  'BY',
  'FROM',
  'INTO',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
  'OUTER',
  'NATURAL',
  'USING',
  'VALUES',
  'SET',
  'WHERE',
  'SELECT',
  'AND',
  'OR',
  'NOT',
  'IS',
  'IN',
  'LIKE',
  'BETWEEN',
  'SIGNAL',
  'RESIGNAL',
  'CALL',
]);

const UNAMBIGUOUS_STMT_START_WORDS = new Set<string>([
  'RETURN',
  'DECLARE',
  'WHILE',
  'LOOP',
  'UPSERT',
  'MERGE',
  'CALL',
  'EXEC',
  'EXECUTE',
  'SIGNAL',
  'RESIGNAL',
  'OPEN',
  'FETCH',
  'CLOSE',
  'COMMIT',
  'ROLLBACK',
]);

type ExprClauseKind =
  | 'select'
  | 'where'
  | 'on'
  | 'having'
  | 'if_cond'
  | 'while_cond'
  | 'until_cond'
  | 'set_rhs'
  | 'return'
  | 'case_when'
  | 'paren_expr';

interface ExprClauseState {
  readonly kind: ExprClauseKind;
  readonly depth: number;
  state: 'start' | 'expectOperand' | 'expectOp';
  pendingOpTok: Token | null;
  unaryOpTok: Token | null;
  lastOperandTok: Token | null;
  isWildcardPossible: boolean;
  inBetween: boolean;
  isPredicateSuffix: boolean;
  afterIntervalLiteral: boolean;
  caseDepth: number;
  awaitingSetEquals: boolean;
  selectItemParts: number;
  sawAsInSelect: boolean;
  sawSelectComparison: boolean;
}

interface ExprParenFrame {
  readonly kind: 'params' | 'columns' | 'skip' | 'call' | 'paren_expr';
  readonly depth: number;
  // Clause-syntax `HIERARCHY*` generator / navigation call frame (scopes hierarchy clause terminators)
  readonly hierarchy: boolean;
  callPendingOpTok: Token | null;
  callUnaryOpTok: Token | null;
}

/**
 * Validates SQL/SQLScript expressions and clause boundaries for:
 * - `HANA-SYN-024`: missing binary/comparison/logical operators (including `"COL" (` and
 *   parenthesized scalar expressions), dangling binary operators, and consecutive binary operators.
 * - `HANA-SYN-025`: incomplete/empty SQL clauses (`SELECT FROM`, `WHERE AND`) and missing `;`
 *   between SQLScript statements inside `BEGIN ... END` compound blocks.
 */
function checkSqlExpressionsAndClauses(
  codeTokens: readonly Token[],
  baseOffset: number,
  lineStarts: readonly number[],
  brokenQidentLines: ReadonlySet<number>,
  unclosedStarts: ReadonlyMap<number, number | undefined>,
  unmatchedCloseStarts: ReadonlySet<number>,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const exprStack: ExprClauseState[] = [];
  const parenFrames: ExprParenFrame[] = [];
  const blockStack: Array<{ kind: BlockKind; isLibraryRoot: boolean; hasStmtToken: boolean }> = [];
  const sawJoinOrMergeAtDepth = new Map<number, boolean>();
  const stmtAllowsSubSelectAtDepth = new Map<number, boolean>();

  let parenDepth = 0;
  let bracketDepth = 0;
  let skipTokensCount = 0;

  const isOnBrokenLine = (tok: Token): boolean =>
    brokenQidentLines.has(findLineNumber(lineStarts, tok.start));

  const pushExprErr = (ruleId: 'HANA-SYN-024' | 'HANA-SYN-025', tok: Token, message: string, fixes: CodeFixSuggestion[] = []): void => {
    if (isOnBrokenLine(tok)) return;
    const absStart = baseOffset + tok.start;
    if (diagnostics.some((d) => (d.ruleId === 'HANA-SYN-024' || d.ruleId === 'HANA-SYN-025') && Math.abs(d.start - absStart) <= 1)) {
      return;
    }
    diagnostics.push({
      ruleId,
      category: 'syntax',
      severity: 'error',
      message,
      start: absStart,
      end: baseOffset + tok.end,
      fixes,
    });
  };

  const makeExprState = (kind: ExprClauseKind, depth: number, awaitingSetEquals = false): ExprClauseState => ({
    kind,
    depth,
    state: 'start',
    pendingOpTok: null,
    unaryOpTok: null,
    lastOperandTok: null,
    isWildcardPossible: false,
    inBetween: false,
    isPredicateSuffix: false,
    afterIntervalLiteral: false,
    caseDepth: 0,
    awaitingSetEquals,
    selectItemParts: 0,
    sawAsInSelect: false,
    sawSelectComparison: false,
  });

  const checkDanglingBeforeBoundary = (ctx: ExprClauseState, boundaryText: string): void => {
    const dangling = ctx.pendingOpTok ?? ctx.unaryOpTok;
    if (dangling) {
      pushExprErr('HANA-SYN-024', dangling, `Dangling operator '${dangling.text}' before '${boundaryText}'.`);
      ctx.pendingOpTok = null;
      ctx.unaryOpTok = null;
    }
  };

  const popExprsAtDepth = (targetDepth: number, boundaryText: string): void => {
    while (exprStack.length > 0 && exprStack[exprStack.length - 1].depth === targetDepth) {
      const top = exprStack.pop()!;
      checkDanglingBeforeBoundary(top, boundaryText);
    }
  };

  const pushExprAtDepth = (kind: ExprClauseKind, depth: number, awaitingSetEquals = false): ExprClauseState => {
    if (kind !== 'case_when' && kind !== 'paren_expr') {
      popExprsAtDepth(depth, kind.toUpperCase());
    }
    const next = makeExprState(kind, depth, awaitingSetEquals);
    exprStack.push(next);
    return next;
  };

  for (let i = 0; i < codeTokens.length; i++) {
    if (skipTokensCount > 0) {
      skipTokensCount--;
      continue;
    }

    const tok = codeTokens[i];
    const up = tok.type === 'word' ? tok.text.toUpperCase() : '';
    const prev = i > 0 ? codeTokens[i - 1] : null;
    const prevUp = prev?.type === 'word' ? prev.text.toUpperCase() : prev?.text ?? '';
    const next = i + 1 < codeTokens.length ? codeTokens[i + 1] : null;
    const nextUp = next?.type === 'word' ? next.text.toUpperCase() : next?.text ?? '';

    if (tok.text === ';') {
      while (exprStack.length > 0) {
        const popped = exprStack.pop()!;
        checkDanglingBeforeBoundary(popped, ';');
      }
      parenFrames.length = 0;
      sawJoinOrMergeAtDepth.clear();
      stmtAllowsSubSelectAtDepth.clear();
      parenDepth = 0;
      bracketDepth = 0;
      const topBlk = blockStack[blockStack.length - 1];
      if (topBlk) topBlk.hasStmtToken = true;
      continue;
    }

    if (tok.text === '[') {
      if (unclosedStarts.has(tok.start)) continue;
      bracketDepth++;
      continue;
    }
    if (tok.text === ']') {
      if (unmatchedCloseStarts.has(tok.start)) continue;
      bracketDepth = Math.max(0, bracketDepth - 1);
      if (bracketDepth === 0) {
        const active = exprStack[exprStack.length - 1];
        if (active && active.depth === parenDepth) {
          active.state = 'expectOp';
          active.lastOperandTok = tok;
          active.pendingOpTok = null;
          active.unaryOpTok = null;
        }
      }
      continue;
    }
    if (bracketDepth > 0) continue;

    // Missing `;` between statements inside BEGIN ... END (HANA-SYN-025)
    if (
      parenDepth === 0 &&
      tok.nlBefore > 0 &&
      prev &&
      blockStack.length > 0
    ) {
      const topBlk = blockStack[blockStack.length - 1];
      const topExpr = exprStack[exprStack.length - 1];
      const insideCaseExpr = topExpr && topExpr.kind === 'case_when';
      if (
        !topBlk.isLibraryRoot &&
        topBlk.kind !== 'CASE' &&
        !insideCaseExpr &&
        !STMT_BLOCK_END_STOP_PREV.has(prevUp) &&
        prev.type !== 'op'
      ) {
        const isAssignmentStart =
          (tok.type === 'word' || tok.type === 'var') && codeTokens[i + 1]?.text === ':=';
        const isBlockStmtStart =
          UNAMBIGUOUS_STMT_START_WORDS.has(up) ||
          (up === 'INSERT' && !['AFTER', 'BEFORE', 'INSTEAD'].includes(prevUp)) ||
          (up === 'UPDATE' && !['FOR', 'ON', 'AFTER', 'BEFORE'].includes(prevUp)) ||
          (up === 'DELETE' && !['ON', 'AFTER', 'BEFORE'].includes(prevUp)) ||
          (up === 'IF' && hasKeywordBeforeBoundary(codeTokens, i + 1, 'THEN')) ||
          (up === 'FOR' && prevUp !== 'HANDLER' && hasKeywordBeforeBoundary(codeTokens, i + 1, 'DO')) ||
          (up === 'SELECT' && !stmtAllowsSubSelectAtDepth.get(0));
        const isBlockEndWithoutSemi = up === 'END' && topBlk.hasStmtToken;

        if ((isAssignmentStart || isBlockStmtStart || isBlockEndWithoutSemi) && !isOnBrokenLine(tok)) {
          popExprsAtDepth(0, tok.text);
          const insertPos = baseOffset + prev.end;
          pushExprErr(
            'HANA-SYN-025',
            tok,
            `Missing ';' at end of preceding statement before '${tok.text}'.`,
            [makeInsertSemiFix(insertPos)]
          );
          stmtAllowsSubSelectAtDepth.set(0, false);
        }
      }
    }

    // Pop `CASE ... END` expressions at any parenDepth (e.g. `(CASE WHEN a = 1 THEN 1 ELSE 0 END)`)
    if (tok.type === 'word' && up === 'END') {
      const topCaseExpr = exprStack[exprStack.length - 1];
      if (topCaseExpr && topCaseExpr.kind === 'case_when' && topCaseExpr.depth === parenDepth && nextUp !== 'IF' && nextUp !== 'FOR' && nextUp !== 'WHILE' && nextUp !== 'LOOP') {
        checkDanglingBeforeBoundary(exprStack.pop()!, 'END');
        const outer = exprStack[exprStack.length - 1];
        if (outer && outer.depth === parenDepth) {
          outer.state = 'expectOp';
          outer.lastOperandTok = tok;
          outer.pendingOpTok = null;
          outer.unaryOpTok = null;
        }
        continue;
      }
    }

    // Track compound SQLScript blocks inside body (matching checkSqlScriptBlocks rules)
    if (parenDepth === 0 && tok.type === 'word') {
      if (up === 'BEGIN') {
        const isLibRoot =
          blockStack.length === 0 &&
          hasPreviousWordBeforeSemi(codeTokens, i, 'LIBRARY');
        blockStack.push({ kind: 'BEGIN', isLibraryRoot: isLibRoot, hasStmtToken: false });
        popExprsAtDepth(0, 'BEGIN');
        stmtAllowsSubSelectAtDepth.set(0, false);
        continue;
      }
      if (up === 'END') {
        popExprsAtDepth(0, 'END');
        stmtAllowsSubSelectAtDepth.set(0, false);
        if (blockStack.length > 0) {
          if (nextUp === 'IF' || nextUp === 'FOR' || nextUp === 'LOOP' || nextUp === 'WHILE' || nextUp === 'CASE') {
            const want = nextUp as BlockKind;
            if (blockStack[blockStack.length - 1].kind === want) {
              blockStack.pop();
            }
            skipTokensCount = 1;
          } else {
            const top = blockStack[blockStack.length - 1];
            if (top.kind === 'BEGIN' || top.kind === 'CASE') {
              blockStack.pop();
            }
          }
        }
        continue;
      }
      const prevIsStmtBoundary = !prev || COMPOUND_BOUNDARY_PREV.has(prevUp);
      if (prevIsStmtBoundary) {
        if (up === 'IF' && nextUp !== 'EXISTS' && !(nextUp === 'NOT' && codeTokens[i + 2]?.text.toUpperCase() === 'EXISTS') && hasKeywordBeforeBoundary(codeTokens, i + 1, 'THEN')) {
          blockStack.push({ kind: 'IF', isLibraryRoot: false, hasStmtToken: false });
          pushExprAtDepth('if_cond', 0);
          continue;
        }
        if (up === 'FOR' && prevUp !== 'HANDLER' && hasKeywordBeforeBoundary(codeTokens, i + 1, 'DO')) {
          blockStack.push({ kind: 'FOR', isLibraryRoot: false, hasStmtToken: false });
          stmtAllowsSubSelectAtDepth.set(0, true);
          continue;
        }
        if (up === 'WHILE' && hasKeywordBeforeBoundary(codeTokens, i + 1, 'DO')) {
          blockStack.push({ kind: 'WHILE', isLibraryRoot: false, hasStmtToken: false });
          pushExprAtDepth('while_cond', 0);
          continue;
        }
        if (up === 'LOOP') {
          blockStack.push({ kind: 'LOOP', isLibraryRoot: false, hasStmtToken: false });
          continue;
        }
      }
      if (up === 'CASE' && prevUp !== 'END' && exprStack.length === 0) {
        blockStack.push({ kind: 'CASE', isLibraryRoot: false, hasStmtToken: false });
        continue;
      }
      if (up === 'ELSEIF' && blockStack.some((b) => b.kind === 'IF')) {
        pushExprAtDepth('if_cond', 0);
        continue;
      }
      const topBlk = blockStack[blockStack.length - 1];
      if (topBlk && up !== 'IF' && up !== 'FOR' && up !== 'WHILE' && up !== 'LOOP') {
        topBlk.hasStmtToken = true;
      }
    }

    // Track whether current statement allows `SELECT` subclause without `;`
    if (parenDepth === 0 && ['CREATE', 'ALTER', 'RETURN', 'AS', 'INSERT', 'UPSERT', 'MERGE', 'WITH', 'FOR', 'USING', 'UNION', 'INTERSECT', 'EXCEPT', 'MINUS'].includes(up)) {
      stmtAllowsSubSelectAtDepth.set(0, true);
    }

    if (tok.text === '(') {
      if (parenDepth > 0 && unclosedStarts.has(tok.start)) continue;

      const activeExpr = exprStack[exprStack.length - 1];
      const topFrame = parenFrames[parenFrames.length - 1];
      const declKind = isTypeListOpener(codeTokens, i);

      let frameKind: ExprParenFrame['kind'] = 'skip';
      if (declKind) {
        frameKind = declKind;
      } else if (topFrame && (topFrame.kind === 'params' || topFrame.kind === 'columns')) {
        frameKind = 'skip';
      } else if (prevUp && SPECIAL_CALL_NAMES.has(prevUp)) {
        frameKind = 'skip';
      } else if (nextUp === 'SELECT' || nextUp === 'WITH') {
        frameKind = 'skip';
      } else if (isUnqualifiedColumnParenExpr(codeTokens, i) && activeExpr && activeExpr.depth === parenDepth) {
        pushExprErr('HANA-SYN-024', tok, `Missing operator between ${prev!.text} and '('.`);
        activeExpr.pendingOpTok = null;
        activeExpr.unaryOpTok = null;
        activeExpr.state = 'expectOp';
        frameKind = 'paren_expr';
      } else if (activeExpr && activeExpr.depth === parenDepth && (activeExpr.state === 'start' || activeExpr.state === 'expectOperand')) {
        activeExpr.pendingOpTok = null;
        activeExpr.unaryOpTok = null;
        frameKind = 'paren_expr';
      } else if (activeExpr && activeExpr.depth === parenDepth && activeExpr.state === 'expectOp') {
        // After value literal / `:var` / `)` / `]` without binary op or call identifier
        if (prev && (prev.type === 'number' || prev.type === 'string' || prev.type === 'var' || prev.type === 'sysvar' || prev.type === 'param' || prev.text === ')' || prev.text === ']')) {
          pushExprErr('HANA-SYN-024', tok, `Missing operator between '${prev.text}' and '('.`);
          frameKind = 'paren_expr';
        } else {
          frameKind = 'call';
        }
      } else if (topFrame && topFrame.kind === 'call' && (topFrame.callPendingOpTok || prev?.text === '(' || prev?.text === ',')) {
        topFrame.callPendingOpTok = null;
        topFrame.callUnaryOpTok = null;
        frameKind = 'paren_expr';
      } else if (prev && (prev.type === 'word' || prev.type === 'qident')) {
        frameKind = 'call';
      }

      parenDepth++;
      parenFrames.push({
        kind: frameKind,
        depth: parenDepth,
        hierarchy: frameKind === 'skip' && HIERARCHY_CLAUSE_FUNCTIONS.has(prevUp) && prev?.type === 'word',
        callPendingOpTok: null,
        callUnaryOpTok: null,
      });

      if (frameKind === 'paren_expr') {
        exprStack.push(makeExprState('paren_expr', parenDepth));
      }
      continue;
    }

    if (tok.text === ')') {
      if (unmatchedCloseStarts.has(tok.start)) continue;

      const poppedFrame =
        parenFrames.length > 0 && parenFrames[parenFrames.length - 1].depth === parenDepth
          ? parenFrames.pop()
          : undefined;
      if (poppedFrame && poppedFrame.kind === 'call') {
        const callDangling = poppedFrame.callPendingOpTok ?? poppedFrame.callUnaryOpTok;
        if (callDangling && !(codeTokens[i - 2]?.text === '(' && callDangling.text === '+')) {
          pushExprErr('HANA-SYN-024', callDangling, `Dangling operator '${callDangling.text}' before ')'.`);
        }
      }

      while (exprStack.length > 0 && exprStack[exprStack.length - 1].depth >= parenDepth) {
        const poppedExpr = exprStack.pop()!;
        checkDanglingBeforeBoundary(poppedExpr, ')');
      }

      parenDepth = Math.max(0, parenDepth - 1);

      const outerExpr = exprStack[exprStack.length - 1];
      if (outerExpr && outerExpr.depth === parenDepth) {
        outerExpr.state = 'expectOp';
        outerExpr.lastOperandTok = tok;
        outerExpr.pendingOpTok = null;
        outerExpr.unaryOpTok = null;
      }
      const outerFrame = parenFrames[parenFrames.length - 1];
      if (outerFrame && outerFrame.depth === parenDepth && outerFrame.kind === 'call') {
        outerFrame.callPendingOpTok = null;
        outerFrame.callUnaryOpTok = null;
      }
      continue;
    }

    // Track `CALL` frame operators for dangling / consecutive checks inside `fn(...)`
    const curFrame = parenFrames[parenFrames.length - 1];
    const inDeclOrSkipFrame =
      curFrame &&
      curFrame.depth === parenDepth &&
      (curFrame.kind === 'params' || curFrame.kind === 'columns' || curFrame.kind === 'skip');
    if (inDeclOrSkipFrame && curFrame.kind !== 'skip') {
      continue;
    }

    // Track clause entry & incomplete clauses (HANA-SYN-025)
    if (tok.type === 'word') {
      if (up === 'SELECT' && !['GRANT', 'REVOKE', 'ALLOW', 'DENY', 'PRIVILEGE', 'COMMENT'].includes(prevUp)) {
        if (nextUp === 'FROM' || nextUp === 'INTO' || nextUp === ';' || nextUp === 'END' || nextUp === ')') {
          pushExprErr('HANA-SYN-025', tok, `Incomplete 'SELECT' clause: missing projection expression before '${next?.text ?? 'EOF'}'.`);
        }
        pushExprAtDepth('select', parenDepth);
        continue;
      }
      if (up === 'FROM') {
        const topE = exprStack[exprStack.length - 1];
        const closingSelect = topE && topE.depth === parenDepth && topE.kind === 'select' && topE.caseDepth === 0;
        if (closingSelect) {
          checkDanglingBeforeBoundary(topE, 'FROM');
          exprStack.pop();
          if (['WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'INTERSECT', 'EXCEPT', 'MINUS', 'LIMIT', 'OFFSET', ';', 'END', ')'].includes(nextUp)) {
            pushExprErr('HANA-SYN-025', tok, `Incomplete 'FROM' clause: missing table reference before '${next?.text ?? 'EOF'}'.`);
          }
          continue;
        }
      }
      if (up === 'JOIN' || up === 'MERGE') {
        sawJoinOrMergeAtDepth.set(parenDepth, true);
      }
      if (up === 'WHERE') {
        popExprsAtDepth(parenDepth, 'WHERE');
        sawJoinOrMergeAtDepth.set(parenDepth, false);
        if (['AND', 'OR', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'INTERSECT', 'EXCEPT', 'MINUS', 'LIMIT', 'OFFSET', ';', 'END', ')'].includes(nextUp)) {
          pushExprErr('HANA-SYN-025', tok, `Incomplete 'WHERE' clause: missing condition predicate before '${next?.text ?? 'EOF'}'.`);
        }
        pushExprAtDepth('where', parenDepth);
        continue;
      }
      if (up === 'HAVING') {
        popExprsAtDepth(parenDepth, 'HAVING');
        if (['ORDER', 'UNION', 'INTERSECT', 'EXCEPT', 'MINUS', 'LIMIT', 'OFFSET', ';', 'END', ')'].includes(nextUp)) {
          pushExprErr('HANA-SYN-025', tok, `Incomplete 'HAVING' clause: missing condition predicate before '${next?.text ?? 'EOF'}'.`);
        }
        pushExprAtDepth('having', parenDepth);
        continue;
      }
      if (up === 'ON' && sawJoinOrMergeAtDepth.get(parenDepth)) {
        sawJoinOrMergeAtDepth.set(parenDepth, false);
        pushExprAtDepth('on', parenDepth);
        continue;
      }
      if (up === 'RETURN' && !['SELECT', 'WITH', ';', 'END', 'TABLE'].includes(nextUp)) {
        const curExpr = exprStack[exprStack.length - 1];
        if (!curExpr || curExpr.depth < parenDepth) {
          pushExprAtDepth('return', parenDepth);
          continue;
        }
      }
      if (up === 'UNTIL') {
        // `VALID FROM <expr> [EXCLUDED] UNTIL <expr> [EXCLUDED]` inside `HIERARCHY_TEMPORAL(...)` is not a loop condition
        if (curFrame?.hierarchy && curFrame.depth === parenDepth) continue;
        pushExprAtDepth('until_cond', parenDepth);
        continue;
      }
    }

    if (tok.text === ':=' && !['SELECT', 'WITH'].includes(nextUp)) {
      const topE = exprStack[exprStack.length - 1];
      if (!topE || topE.depth < parenDepth) {
        pushExprAtDepth('set_rhs', parenDepth);
        continue;
      }
    }
    if (up === 'SET' && !['SCHEMA', 'TRANSACTION', 'SESSION', 'NULL', 'DEFAULT', 'USER', 'ROLE', 'PASSWORD', 'SQL', 'SYSTEM', 'STRING'].includes(nextUp) && prevUp !== 'ON') {
      // Wait for `=` inside `SET col = <expr>`
      pushExprAtDepth('set_rhs', parenDepth, true);
      continue;
    }

    // Active `'call'` paren frame checks when no deeper ExprClauseState is active
    const activeExpr = exprStack[exprStack.length - 1];
    if ((!activeExpr || activeExpr.depth < parenDepth) && curFrame && curFrame.depth === parenDepth && curFrame.kind === 'call') {
      if (tok.text === ',') {
        const dangling = curFrame.callPendingOpTok ?? curFrame.callUnaryOpTok;
        if (dangling) {
          pushExprErr('HANA-SYN-024', dangling, `Dangling operator '${dangling.text}' before ','.`);
        }
        curFrame.callPendingOpTok = null;
        curFrame.callUnaryOpTok = null;
        continue;
      }
      if (tok.type === 'op') {
        if (tok.text === '*' && (prev?.text === '(' || prev?.text === ',' || prev?.text === '.')) {
          curFrame.callPendingOpTok = null;
          continue;
        }
        if (tok.text === '+' || tok.text === '-') {
          if (prev?.text === '(' || prev?.text === ',' || prev?.type === 'op') {
            curFrame.callUnaryOpTok = tok;
          } else {
            curFrame.callPendingOpTok = tok;
          }
          continue;
        }
        if (EXPR_BINARY_ONLY_OPS.has(tok.text)) {
          if (curFrame.callPendingOpTok) {
            pushExprErr('HANA-SYN-024', tok, `Unexpected operator '${tok.text}' after '${curFrame.callPendingOpTok.text}'.`);
          } else {
            curFrame.callPendingOpTok = tok;
          }
          curFrame.callUnaryOpTok = null;
          continue;
        }
      } else {
        curFrame.callPendingOpTok = null;
        curFrame.callUnaryOpTok = null;
      }
      continue;
    }

    if (!activeExpr || activeExpr.depth !== parenDepth) {
      continue;
    }

    // Inside `UPDATE ... SET col = expr`: skip LHS column before `=`
    if (activeExpr.awaitingSetEquals) {
      if (tok.text === '=' || tok.text === ':=') {
        activeExpr.awaitingSetEquals = false;
        activeExpr.state = 'expectOperand';
        activeExpr.pendingOpTok = null;
      } else if (EXPR_CLAUSE_TERMINATORS.has(up) && up !== 'SET') {
        exprStack.pop();
      }
      continue;
    }

    // Nested CASE ... END inside an active expression
    if (up === 'CASE' && prevUp !== 'END') {
      activeExpr.pendingOpTok = null;
      activeExpr.unaryOpTok = null;
      pushExprAtDepth('case_when', parenDepth);
      continue;
    }

    if (activeExpr.kind === 'case_when') {
      if (up === 'WHEN' || up === 'THEN' || up === 'ELSE') {
        checkDanglingBeforeBoundary(activeExpr, tok.text);
        activeExpr.state = 'expectOperand';
        activeExpr.lastOperandTok = null;
        continue;
      }
    }

    // Check clause terminators
    const inHierarchyFrame = !!curFrame && curFrame.hierarchy && curFrame.depth === parenDepth;
    const shouldTerminateExpr =
      // `START WHERE <cond> DEPTH 1` / `JOIN t ON <cond> MEASURES (...)`: non-reserved hierarchy clause keywords
      // end the condition only after a complete operand, so `WHERE depth = 1` keeps `depth` as a column.
      (inHierarchyFrame &&
        (activeExpr.kind === 'where' || activeExpr.kind === 'on') &&
        activeExpr.state === 'expectOp' &&
        HIERARCHY_CLAUSE_TERMINATORS.has(up)) ||
      (activeExpr.kind === 'select' && SELECT_STOP_CLAUSES.has(up) && !(up === 'GROUP' && prevUp === 'WITHIN')) ||
      ((activeExpr.kind === 'where' || activeExpr.kind === 'on' || activeExpr.kind === 'having') &&
        EXPR_CLAUSE_TERMINATORS.has(up) &&
        !(up === 'GROUP' && prevUp === 'WITHIN')) ||
      (activeExpr.kind === 'if_cond' && up === 'THEN') ||
      (activeExpr.kind === 'while_cond' && up === 'DO') ||
      (activeExpr.kind === 'set_rhs' && (up === 'WHERE' || up === 'FROM' || up === 'RETURNING' || up === 'END'));

    if (shouldTerminateExpr) {
      checkDanglingBeforeBoundary(activeExpr, tok.text);
      exprStack.pop();
      // Special: `FROM` after `SELECT` may itself be incomplete (`SELECT 1 FROM WHERE`)
      if (up === 'FROM' && activeExpr.kind === 'select') {
        if (['WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'INTERSECT', 'EXCEPT', 'MINUS', 'LIMIT', 'OFFSET', ';', 'END', ')'].includes(nextUp)) {
          pushExprErr('HANA-SYN-025', tok, `Incomplete 'FROM' clause: missing table reference before '${next?.text ?? 'EOF'}'.`);
        }
      }
      continue;
    }

    // Comma handling inside expressions
    if (tok.text === ',') {
      checkDanglingBeforeBoundary(activeExpr, ',');
      if (activeExpr.kind === 'set_rhs') {
        // Next assignment in `UPDATE T SET a = 1, b = 2`
        activeExpr.awaitingSetEquals = true;
        activeExpr.state = 'start';
        activeExpr.lastOperandTok = null;
      } else {
        activeExpr.state = 'start';
        activeExpr.lastOperandTok = null;
        activeExpr.selectItemParts = 0;
        activeExpr.sawAsInSelect = false;
        activeExpr.isWildcardPossible = false;
      }
      continue;
    }

    // Handle member access `.` / `::`
    if (tok.text === '.' || tok.text === '::') {
      activeExpr.state = 'expectOperand';
      activeExpr.pendingOpTok = null;
      activeExpr.unaryOpTok = null;
      activeExpr.isWildcardPossible = tok.text === '.';
      continue;
    }

    // Handle `SELECT` list modifiers and aliases (`DISTINCT`, `ALL`, `TOP n`, `AS "ALIAS"`, implicit alias)
    if (activeExpr.kind === 'select') {
      if (activeExpr.state === 'start' && (up === 'DISTINCT' || up === 'ALL')) {
        continue;
      }
      if (activeExpr.state === 'start' && up === 'TOP' && next && (next.type === 'number' || next.type === 'var' || next.type === 'param')) {
        skipTokensCount = 1;
        continue;
      }
      if (up === 'AS') {
        checkDanglingBeforeBoundary(activeExpr, 'AS');
        activeExpr.sawAsInSelect = true;
        continue;
      }
      if (activeExpr.sawAsInSelect) {
        activeExpr.sawAsInSelect = false;
        activeExpr.state = 'expectOp';
        activeExpr.lastOperandTok = tok;
        continue;
      }
    }

    // Handle punctuation operators
    if (tok.type === 'op') {
      // Wildcard `*` after `.` or at start of SELECT (`SELECT *`, `SELECT t.*`)
      if (tok.text === '*' && (prev?.text === '.' || (activeExpr.kind === 'select' && (activeExpr.state === 'start' || activeExpr.isWildcardPossible)))) {
        activeExpr.state = 'expectOp';
        activeExpr.pendingOpTok = null;
        activeExpr.unaryOpTok = null;
        activeExpr.lastOperandTok = tok;
        activeExpr.isWildcardPossible = false;
        continue;
      }

      if (tok.text === '+' || tok.text === '-') {
        if (activeExpr.state === 'start' || activeExpr.state === 'expectOperand') {
          activeExpr.unaryOpTok = tok;
          activeExpr.state = 'expectOperand';
        } else {
          activeExpr.pendingOpTok = tok;
          activeExpr.unaryOpTok = null;
          activeExpr.state = 'expectOperand';
        }
        continue;
      }

      if (EXPR_BINARY_ONLY_OPS.has(tok.text)) {
        if (activeExpr.state === 'start') {
          pushExprErr('HANA-SYN-024', tok, `Unexpected leading operator '${tok.text}'.`);
          activeExpr.state = 'expectOperand';
        } else if (activeExpr.state === 'expectOperand') {
          const prevOp = activeExpr.pendingOpTok ?? activeExpr.unaryOpTok;
          if (prevOp) {
            pushExprErr('HANA-SYN-024', tok, `Unexpected operator '${tok.text}' after '${prevOp.text}'.`);
          } else {
            pushExprErr('HANA-SYN-024', tok, `Unexpected operator '${tok.text}'.`);
          }
        } else {
          if (activeExpr.kind === 'where' || activeExpr.kind === 'on' || activeExpr.kind === 'having' || activeExpr.kind === 'if_cond') {
            activeExpr.sawSelectComparison = true;
          }
          activeExpr.pendingOpTok = tok;
          activeExpr.unaryOpTok = null;
          activeExpr.state = 'expectOperand';
        }
        continue;
      }
    }

    // Word / identifier / literal tokens inside expression
    if (tok.type === 'word') {
      // Typed literals: DATE '...', TIME '...', TIMESTAMP '...', SECONDDATE '...', INTERVAL '...' [UNIT]
      if (activeExpr.state !== 'expectOp') {
        if (TYPED_LITERAL_WORDS.has(up) && next?.type === 'string') {
          skipTokensCount = 1;
          activeExpr.state = 'expectOp';
          activeExpr.lastOperandTok = next;
          activeExpr.pendingOpTok = null;
          activeExpr.unaryOpTok = null;
          continue;
        }
        if (up === 'INTERVAL' && next?.type === 'string') {
          let adv = 1;
          if (codeTokens[i + 2]?.type === 'word' && INTERVAL_UNITS.has(codeTokens[i + 2].text.toUpperCase())) {
            adv = 2;
            if (codeTokens[i + 3]?.type === 'word' && codeTokens[i + 3].text.toUpperCase() === 'TO' && codeTokens[i + 4]?.type === 'word') {
              adv = 4;
            }
          }
          skipTokensCount = adv;
          activeExpr.state = 'expectOp';
          activeExpr.lastOperandTok = codeTokens[i + adv];
          activeExpr.pendingOpTok = null;
          activeExpr.unaryOpTok = null;
          activeExpr.afterIntervalLiteral = true;
          continue;
        }
        if (/^[NXB]$/i.test(tok.text) && next?.type === 'string' && !next.wsBefore) {
          skipTokensCount = 1;
          activeExpr.state = 'expectOp';
          activeExpr.lastOperandTok = next;
          activeExpr.pendingOpTok = null;
          activeExpr.unaryOpTok = null;
          continue;
        }
        if (EXPR_PREFIX_WORDS.has(up)) {
          activeExpr.pendingOpTok = null;
          activeExpr.state = 'expectOperand';
          continue;
        }
      }

      // Valid SQL infix keyword operators when in 'expectOp'
      if (activeExpr.state === 'expectOp') {
        if (EXPR_INFIX_DIRECT.has(up)) {
          if (up === 'AND' && activeExpr.inBetween) {
            activeExpr.inBetween = false;
          } else if (up === 'AND' || up === 'OR') {
            activeExpr.sawSelectComparison = false;
          } else {
            activeExpr.sawSelectComparison = true;
          }
          if (up === 'BETWEEN') activeExpr.inBetween = true;
          activeExpr.pendingOpTok = tok;
          activeExpr.unaryOpTok = null;
          activeExpr.state = 'expectOperand';
          continue;
        }
        if (up === 'IS') {
          activeExpr.isPredicateSuffix = true;
          activeExpr.sawSelectComparison = true;
          activeExpr.pendingOpTok = tok;
          activeExpr.unaryOpTok = null;
          activeExpr.state = 'expectOperand';
          continue;
        }
        if (up === 'NOT' && EXPR_INFIX_COMPOUND_AFTER_NOT.has(nextUp)) {
          // e.g. `x NOT IN (...)`, `x NOT BETWEEN 1 AND 5`, `x NOT LIKE '%a%'`
          continue;
        }
        if (
          (up === 'MEMBER' && nextUp === 'OF') ||
          (up === 'SUBMULTISET' && nextUp === 'OF') ||
          (up === 'SIMILAR' && nextUp === 'TO') ||
          (up === 'SOUNDS' && nextUp === 'LIKE')
        ) {
          skipTokensCount = 1;
          activeExpr.pendingOpTok = codeTokens[i + 1];
          activeExpr.unaryOpTok = null;
          activeExpr.state = 'expectOperand';
          continue;
        }
        if (up === 'AT' && nextUp === 'TIME' && codeTokens[i + 2]?.text.toUpperCase() === 'ZONE') {
          skipTokensCount = 2;
          activeExpr.pendingOpTok = codeTokens[i + 2];
          activeExpr.state = 'expectOperand';
          continue;
        }
        if (up === 'COLLATE' && next) {
          skipTokensCount = 1;
          activeExpr.state = 'expectOp';
          activeExpr.lastOperandTok = next;
          continue;
        }
        if (up === 'OVER' || up === 'FILTER') {
          continue;
        }
        if (up === 'WITHIN' && nextUp === 'GROUP') {
          skipTokensCount = 1;
          continue;
        }
        if (WINDOW_OR_ORDER_MODS.has(up)) {
          continue;
        }
      }

      if (activeExpr.isPredicateSuffix && (up === 'NULL' || up === 'TRUE' || up === 'FALSE' || up === 'UNKNOWN' || up === 'EMPTY')) {
        activeExpr.isPredicateSuffix = false;
        activeExpr.pendingOpTok = null;
        activeExpr.unaryOpTok = null;
        activeExpr.state = 'expectOp';
        activeExpr.lastOperandTok = tok;
        continue;
      }
      if (activeExpr.isPredicateSuffix && up === 'DISTINCT' && nextUp === 'FROM') {
        activeExpr.isPredicateSuffix = false;
        skipTokensCount = 1;
        activeExpr.state = 'expectOperand';
        continue;
      }
      if (activeExpr.afterIntervalLiteral && INTERVAL_UNITS.has(up)) {
        continue;
      }

      // If `AND` or `OR` arrives right while expecting RHS operand (`WHERE "PRICE" >= AND ...`), dangling operator!
      if ((activeExpr.state === 'expectOperand' || activeExpr.state === 'start') && (up === 'AND' || up === 'OR')) {
        checkDanglingBeforeBoundary(activeExpr, tok.text);
        activeExpr.state = 'expectOperand';
        continue;
      }
    }

    // Operand token reached (`word`, `qident`, `number`, `string`, `var`, `sysvar`, `param`)
    activeExpr.isPredicateSuffix = false;
    activeExpr.afterIntervalLiteral = false;
    activeExpr.isWildcardPossible = false;

    if (activeExpr.state === 'start' || activeExpr.state === 'expectOperand') {
      activeExpr.state = 'expectOp';
      activeExpr.pendingOpTok = null;
      activeExpr.unaryOpTok = null;
      activeExpr.lastOperandTok = tok;
      if (activeExpr.kind === 'select') activeExpr.selectItemParts = 1;
      continue;
    }

    // activeExpr.state === 'expectOp' and a new operand arrived without an operator!
    if (activeExpr.kind === 'select') {
      // Top-level SELECT list items can have 1 implicit alias (`SELECT "PRICE" "ALIAS" FROM "T"`),
      // handled alongside `HANA-SYN-023`; keep implicit alias tolerance here.
      if (activeExpr.selectItemParts === 1 && (tok.type === 'word' || tok.type === 'qident') && nextUp !== '(') {
        activeExpr.selectItemParts = 2;
        activeExpr.lastOperandTok = tok;
      }
      continue;
    }

    // Inside `where`, `on`, `having`, `if_cond`, `while_cond`, `until_cond`, `set_rhs`, `return`, `case_when`, `paren_expr`:
    // Two adjacent operands with no operator is an unambiguous missing-operator syntax error (`HANA-SYN-024`)!
    const prevText = activeExpr.lastOperandTok?.text ?? prev?.text ?? '';
    const msg =
      activeExpr.sawSelectComparison &&
      (activeExpr.kind === 'where' || activeExpr.kind === 'on' || activeExpr.kind === 'having' || activeExpr.kind === 'if_cond' || activeExpr.kind === 'while_cond')
        ? `Missing logical or comparison operator before '${tok.text}'.`
        : `Missing operator between '${prevText}' and '${tok.text}'.`;
    pushExprErr('HANA-SYN-024', tok, msg);
    activeExpr.sawSelectComparison = false;
    activeExpr.lastOperandTok = tok;
    activeExpr.pendingOpTok = null;
    activeExpr.unaryOpTok = null;
    activeExpr.state = 'expectOp';
  }

  while (exprStack.length > 0) {
    checkDanglingBeforeBoundary(exprStack.pop()!, 'EOF');
  }
}

function hasPreviousWordBeforeSemi(codeTokens: readonly Token[], idx: number, targetWord: string): boolean {
  for (let k = idx - 1; k >= 0; k--) {
    const t = codeTokens[k];
    if (t.text === ';' || t.text === ')') return false;
    if (t.type === 'word' && t.text.toUpperCase() === targetWord) return true;
  }
  return false;
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
  const delimInputs: DelimTokenInput[] = [];
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
    if (ch === '(' || ch === '[' || ch === '{' || ch === ')' || ch === ']' || ch === '}') {
      delimInputs.push({ ch, start: i, end: i + 1 });
      tokens.push({ kind: 'punct', text: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    tokens.push({ kind: 'punct', text: ch, start: i, end: i + 1 });
    i++;
  }

  const delimResult = analyzeDelimiters(text, delimInputs, { fenceSemicolon: 'none' });
  for (const d of delimResult.diagnostics) {
    diagnostics.push({
      ruleId: 'HANA-SYN-003',
      category: 'syntax',
      severity: 'error',
      message: d.message,
      start: d.start,
      end: d.end,
      fixes: [],
    });
  }

  return { tokens, diagnostics };
}

function skipCdsAnnotation(tokens: readonly NonSqlToken[], startIdx: number): number {
  let i = startIdx + 1;
  while (i < tokens.length && tokens[i].text === '.') i += 2;
  if (tokens[i]?.text === ':') {
    i++;
    const startedBracket = tokens[i]?.text === '{' || tokens[i]?.text === '[' || tokens[i]?.text === '(';
    let annotDepth = 0;
    while (i < tokens.length) {
      if (tokens[i].text === '{' || tokens[i].text === '[' || tokens[i].text === '(') {
        annotDepth++;
      } else if (tokens[i].text === '}' || tokens[i].text === ']' || tokens[i].text === ')') {
        if (annotDepth === 0) return i - 1;
        annotDepth--;
        if (annotDepth === 0 && startedBracket) return i;
      } else if (annotDepth === 0) {
        const nxt = tokens[i + 1];
        if (
          tokens[i].kind !== 'punct' &&
          (!nxt || (nxt.text !== '.' && nxt.text !== ':' && nxt.text !== ','))
        ) {
          return i;
        }
      }
      i++;
    }
    return Math.min(startIdx, tokens.length - 1);
  }
  if (tokens[i]?.text === '(') {
    let p = 1;
    i++;
    while (i < tokens.length && p > 0) {
      if (tokens[i].text === '(') p++;
      else if (tokens[i].text === ')') p--;
      i++;
    }
    return i - 1;
  }
  return Math.max(startIdx, i - 1);
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
      i = skipCdsAnnotation(tokens, i);
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

interface CdsBraceFrame {
  readonly kind: 'context' | 'members' | 'skip';
  parenDepth: number;
  bracketDepth: number;
  memberState: 'start' | 'expectColonOrEnd' | 'afterColon' | 'inType';
  memberNameTok: NonSqlToken | null;
}

/**
 * Validates CDS (`.hdbdd`, `.hdbcds`) structural syntax (`HANA-SYN-026`):
 * - missing `;` on top-level `namespace` / `using` directives;
 * - missing `:`, missing type after `:`, or missing `;` between `entity`/`type` members.
 */
function checkCdsStructuralSyntax(
  tokens: readonly NonSqlToken[],
  text: string,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const braceStack: CdsBraceFrame[] = [];
  let pendingHeaderStmt: { kw: string; lastTok: NonSqlToken } | null = null;
  let lastDeclStartIdx = 0;

  const classifyBraceKind = (openIdx: number): CdsBraceFrame['kind'] => {
    const headerSlice: NonSqlToken[] = [];
    for (let k = lastDeclStartIdx; k < openIdx; k++) {
      headerSlice.push(tokens[k]);
    }
    // Check from nearest non-annotation declaration head backward
    let hasColonBeforeBrace = false;
    let hasTechConfig = false;
    let hasViewOrSelect = false;
    let hasAccessPolicy = false;
    let firstKw = '';
    for (let j = headerSlice.length - 1; j >= 0; j--) {
      const h = headerSlice[j];
      if (h.text === ';' || h.text === '}' || h.text === '{') break;
      const low = h.kind === 'word' ? h.text.toLowerCase() : '';
      if (h.text === ':') hasColonBeforeBrace = true;
      if (low === 'configuration' && headerSlice[j - 1]?.text.toLowerCase() === 'technical') hasTechConfig = true;
      if (low === 'select' || low === 'view') hasViewOrSelect = true;
      if (low === 'accesspolicy' || low === 'series') hasAccessPolicy = true;
      if (h.kind === 'word' && !h.text.startsWith('@') && ['entity', 'type', 'context', 'view', 'accesspolicy'].includes(low)) {
        firstKw = low;
      }
    }
    if (hasTechConfig || hasViewOrSelect || hasAccessPolicy || hasColonBeforeBrace) return 'skip';
    if (firstKw === 'context') return 'context';
    if (firstKw === 'entity' || firstKw === 'type') return 'members';
    return 'skip';
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : null;
    const next = i + 1 < tokens.length ? tokens[i + 1] : null;
    const low = tok.kind === 'word' ? tok.text.toLowerCase() : '';
    const topBrace = braceStack[braceStack.length - 1];

    // Skip annotations smoothly in top-level or context/member start
    if (tok.kind === 'word' && tok.text.startsWith('@')) {
      if (pendingHeaderStmt && braceStack.length === 0) {
        const ins = pendingHeaderStmt.lastTok.end;
        diagnostics.push({
          ruleId: 'HANA-SYN-026',
          category: 'syntax',
          severity: 'error',
          message: `Missing ';' at end of '${pendingHeaderStmt.kw}' declaration before '${tok.text}'.`,
          start: tok.start,
          end: tok.end,
          fixes: [makeInsertSemiFix(ins)],
        });
        pendingHeaderStmt = null;
      } else if (
        topBrace &&
        topBrace.kind === 'members' &&
        topBrace.parenDepth === 0 &&
        topBrace.bracketDepth === 0 &&
        topBrace.memberState === 'inType' &&
        prev &&
        text.slice(prev.end, tok.start).includes('\n')
      ) {
        const ins = prev.end;
        diagnostics.push({
          ruleId: 'HANA-SYN-026',
          category: 'syntax',
          severity: 'error',
          message: `Missing ';' at end of CDS member before '${tok.text}'.`,
          start: tok.start,
          end: tok.end,
          fixes: [makeInsertSemiFix(ins)],
        });
        topBrace.memberState = 'start';
        topBrace.memberNameTok = null;
      }
      i = skipCdsAnnotation(tokens, i);
      lastDeclStartIdx = i + 1;
      continue;
    }

    if (tok.text === '{') {
      if (pendingHeaderStmt && braceStack.length === 0) {
        const ins = pendingHeaderStmt.lastTok.end;
        diagnostics.push({
          ruleId: 'HANA-SYN-026',
          category: 'syntax',
          severity: 'error',
          message: `Missing ';' at end of '${pendingHeaderStmt.kw}' declaration before '{'.`,
          start: tok.start,
          end: tok.end,
          fixes: [makeInsertSemiFix(ins)],
        });
        pendingHeaderStmt = null;
      }
      braceStack.push({
        kind: classifyBraceKind(i),
        parenDepth: 0,
        bracketDepth: 0,
        memberState: 'start',
        memberNameTok: null,
      });
      lastDeclStartIdx = i + 1;
      continue;
    }

    if (tok.text === '}') {
      if (braceStack.length > 0) braceStack.pop();
      lastDeclStartIdx = i + 1;
      continue;
    }

    // Track top-level `namespace` / `using` header semicolons
    if (braceStack.length === 0) {
      if (tok.text === ';') {
        pendingHeaderStmt = null;
        lastDeclStartIdx = i + 1;
        continue;
      }
      if (!pendingHeaderStmt && (low === 'namespace' || low === 'using')) {
        pendingHeaderStmt = { kw: low, lastTok: tok };
        continue;
      }
      if (pendingHeaderStmt) {
        if (
          tok.kind === 'word' &&
          CDS_TOP_KEYWORDS.has(low) &&
          prev?.text !== '.' &&
          prev?.text !== '::' &&
          prev?.text.toLowerCase() !== 'as'
        ) {
          const ins = pendingHeaderStmt.lastTok.end;
          diagnostics.push({
            ruleId: 'HANA-SYN-026',
            category: 'syntax',
            severity: 'error',
            message: `Missing ';' at end of '${pendingHeaderStmt.kw}' declaration before '${tok.text}'.`,
            start: tok.start,
            end: tok.end,
            fixes: [makeInsertSemiFix(ins)],
          });
          pendingHeaderStmt = low === 'namespace' || low === 'using' ? { kw: low, lastTok: tok } : null;
          lastDeclStartIdx = i;
        } else {
          pendingHeaderStmt.lastTok = tok;
        }
      }
      continue;
    }

    if (!topBrace || topBrace.kind !== 'members') {
      if (tok.text === ';') lastDeclStartIdx = i + 1;
      continue;
    }

    if (tok.text === '(') {
      topBrace.parenDepth++;
      continue;
    }
    if (tok.text === ')') {
      topBrace.parenDepth = Math.max(0, topBrace.parenDepth - 1);
      continue;
    }
    if (tok.text === '[') {
      topBrace.bracketDepth++;
      continue;
    }
    if (tok.text === ']') {
      topBrace.bracketDepth = Math.max(0, topBrace.bracketDepth - 1);
      continue;
    }
    if (topBrace.parenDepth > 0 || topBrace.bracketDepth > 0) {
      continue;
    }

    if (tok.text === ';') {
      if (topBrace.memberState === 'afterColon') {
        diagnostics.push({
          ruleId: 'HANA-SYN-026',
          category: 'syntax',
          severity: 'error',
          message: `Expected type specification after ':' for CDS field '${topBrace.memberNameTok?.text ?? ''}'.`,
          start: prev?.start ?? tok.start,
          end: prev?.end ?? tok.end,
          fixes: [],
        });
      } else if (topBrace.memberState === 'expectColonOrEnd') {
        diagnostics.push({
          ruleId: 'HANA-SYN-026',
          category: 'syntax',
          severity: 'error',
          message: `Expected ': <type>' for CDS field '${topBrace.memberNameTok?.text ?? ''}'.`,
          start: topBrace.memberNameTok?.start ?? tok.start,
          end: topBrace.memberNameTok?.end ?? tok.end,
          fixes: [],
        });
      }
      topBrace.memberState = 'start';
      topBrace.memberNameTok = null;
      lastDeclStartIdx = i + 1;
      continue;
    }

    if (topBrace.memberState === 'start') {
      if (tok.kind === 'word') {
        if ((low === 'key' || low === 'virtual' || low === 'element') && next && next.kind === 'word') {
          continue;
        }
        if (low === 'type' || low === 'entity') {
          lastDeclStartIdx = i;
          continue;
        }
        topBrace.memberNameTok = tok;
        topBrace.memberState = 'expectColonOrEnd';
      }
      continue;
    }

    if (topBrace.memberState === 'expectColonOrEnd') {
      if (tok.text === ':') {
        topBrace.memberState = 'afterColon';
      } else if (tok.kind === 'word') {
        diagnostics.push({
          ruleId: 'HANA-SYN-026',
          category: 'syntax',
          severity: 'error',
          message: `Expected ':' after CDS field '${topBrace.memberNameTok?.text ?? ''}' before '${tok.text}'.`,
          start: tok.start,
          end: tok.end,
          fixes: prev ? [{ title: "Insert ':'", kind: 'quickfix', isPreferred: true, edits: [{ start: prev.end, end: prev.end, newText: ' :' }] }] : [],
        });
        topBrace.memberState = 'inType';
      } else {
        topBrace.memberState = 'inType';
      }
      continue;
    }

    if (topBrace.memberState === 'afterColon') {
      if (tok.text === ';' || tok.text === '}') {
        diagnostics.push({
          ruleId: 'HANA-SYN-026',
          category: 'syntax',
          severity: 'error',
          message: `Expected type specification after ':' for CDS field '${topBrace.memberNameTok?.text ?? ''}'.`,
          start: prev?.start ?? tok.start,
          end: prev?.end ?? tok.end,
          fixes: [],
        });
        topBrace.memberState = 'start';
        topBrace.memberNameTok = null;
      } else {
        topBrace.memberState = 'inType';
      }
      continue;
    }

    // topBrace.memberState === 'inType'
    if (prev && text.slice(prev.end, tok.start).includes('\n') && tok.kind === 'word') {
      const nextIsColon = next?.text === ':';
      const nextModAndColon =
        (low === 'key' || low === 'virtual' || low === 'element') &&
        next?.kind === 'word' &&
        tokens[i + 2]?.text === ':';
      if (nextIsColon || nextModAndColon) {
        const ins = prev.end;
        diagnostics.push({
          ruleId: 'HANA-SYN-026',
          category: 'syntax',
          severity: 'error',
          message: `Missing ';' at end of CDS member '${topBrace.memberNameTok?.text ?? ''}' before '${tok.text}'.`,
          start: tok.start,
          end: tok.end,
          fixes: [makeInsertSemiFix(ins)],
        });
        topBrace.memberState = 'start';
        topBrace.memberNameTok = null;
        i--; // Re-process the new field declaration from 'start'
      }
    }
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
      checkCdsStructuralSyntax(tokens, text, diagnostics);
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
