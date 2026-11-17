import { type Token } from '../formatter/tokenizer';
import { parseRoutineHeader } from './sql-header';
import { findLineNumber } from './sql-order';
import {
  type AnalyzerDiagnostic,
  type CodeFixSuggestion,
  type DiagnosticSeverityLevel,
  type DiagnosticTagKind,
} from './types';

export interface SqlContextOptions {
  readonly languageId: string;
  readonly text: string;
  readonly codeTokens: readonly Token[];
  readonly baseOffset: number;
  readonly lineStarts: readonly number[];
  readonly brokenQidentLines: ReadonlySet<number>;
  readonly unclosedStarts: ReadonlyMap<number, number | undefined>;
  readonly unmatchedCloseStarts: ReadonlySet<number>;
  readonly diagnostics: AnalyzerDiagnostic[];
}

export type RoutineKind = 'procedure' | 'table_function' | 'scalar_function' | 'trigger' | 'library' | 'do';

export interface RoutineContext {
  readonly kind: RoutineKind;
  readonly isAlter: boolean;
  readonly isVirtual: boolean;
  readonly hasReadsSqlData: boolean;
  readonly hasDeterministic: boolean;
  readonly hasAutocommitDdl: boolean;
  readonly hasForeignLanguage: boolean;
  readonly hasExplicitReturns: boolean;
  readonly returnVarNames: ReadonlySet<string>;
  hasSawReturnExpr: boolean;
}

function createRoutineContext(
  kind: RoutineKind,
  opts: Partial<Omit<RoutineContext, 'kind' | 'returnVarNames'>> & {
    readonly returnVarNames?: ReadonlySet<string>;
  } = {}
): RoutineContext {
  return {
    kind,
    isAlter: opts.isAlter ?? false,
    isVirtual: opts.isVirtual ?? false,
    hasReadsSqlData: opts.hasReadsSqlData ?? false,
    hasDeterministic: opts.hasDeterministic ?? false,
    hasAutocommitDdl: opts.hasAutocommitDdl ?? false,
    hasForeignLanguage: opts.hasForeignLanguage ?? false,
    hasExplicitReturns: opts.hasExplicitReturns ?? false,
    returnVarNames: opts.returnVarNames ?? new Set<string>(),
    hasSawReturnExpr: opts.hasSawReturnExpr ?? false,
  };
}

const enum BlockPhase {
  START = 0,
  AFTER_MODIFIER = 1,
  DECL = 2,
  HANDLER = 3,
  EXECUTABLE = 4,
}

type BlockKind =
  | 'begin'
  | 'handler_begin'
  | 'if'
  | 'loop'
  | 'while'
  | 'for'
  | 'library_root'
  | 'single_handler';

interface BlockScope {
  readonly kind: BlockKind;
  readonly parenDepth: number;
  readonly isRoutineRoot: boolean;
  readonly inLoop: boolean;
  readonly inHandler: boolean;
  readonly inAutonomous: boolean;
  readonly inParallel: boolean;
  readonly routine: RoutineContext | undefined;
  phase: BlockPhase;
  terminated: boolean;
  terminatedBy: string;
  handlerKind: 'EXIT' | 'CONTINUE' | null;
  readonly seenConditions: Set<string>;
  firstMemberStart?: number;
}

const TERMINATOR_KEYWORDS = new Set<string>(['RETURN', 'SIGNAL', 'RESIGNAL', 'BREAK', 'CONTINUE']);
const END_COMPOUND_SUFFIXES = new Set<string>(['IF', 'LOOP', 'WHILE', 'FOR']);
const TOP_LEVEL_IMPERATIVE_KEYWORDS = new Set<string>([
  'DECLARE',
  'IF',
  'LOOP',
  'WHILE',
  'FOR',
  'BREAK',
  'CONTINUE',
  'SIGNAL',
  'RESIGNAL',
  'RETURN',
]);
const DML_WRITE_KEYWORDS = new Set<string>(['INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'MERGE', 'REPLACE']);
const DDL_KEYWORDS = new Set<string>(['CREATE', 'ALTER', 'DROP', 'RENAME', 'TRUNCATE']);
const NONDETERMINISTIC_CALLS = new Set<string>(['RAND', 'RAND_SECURE', 'SESSION_CONTEXT', 'NOW']);
const NONDETERMINISTIC_NILADIC = new Set<string>([
  'SYSUUID',
  'SESSION_USER',
  'CURRENT_TIMESTAMP',
  'CURRENT_UTCTIMESTAMP',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'CURRENT_UTCDATE',
  'CURRENT_UTCTIME',
  'CURRENT_MVCC_SNAPSHOT_TIMESTAMP',
  'CURRENT_TRANSACTION_ISOLATION_LEVEL',
]);

function wordUpper(tok: Token | undefined): string {
  return tok && tok.type === 'word' ? tok.text.toUpperCase() : '';
}

function isSimpleIdOrIdent(tok: Token | undefined): boolean {
  return Boolean(tok && (tok.type === 'word' || tok.type === 'qident' || tok.type === 'sysvar'));
}

/**
 * Finds the closing `)` index matching `(` at `openIdx`, or returns `-1` if unclosed.
 */
function findMatchingParen(tokens: readonly Token[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    const text = tokens[i].text;
    if (text === '(') {
      depth++;
    } else if (text === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Scans forward from `startIdx` until `targetUpper` at local depth 0 (outside parens and `CASE ... END`),
 * stopping early if a hard boundary (`;`, `END`, or EOF) is encountered at depth 0.
 */
function scanUntilClauseKeyword(
  tokens: readonly Token[],
  startIdx: number,
  targetUpper: string
): { targetIdx: number; nextIdx: number } {
  let pDepth = 0;
  let cDepth = 0;
  for (let i = startIdx; i < tokens.length; i++) {
    const tok = tokens[i];
    const up = wordUpper(tok);
    if (tok.text === '(') {
      pDepth++;
      continue;
    }
    if (tok.text === ')') {
      if (pDepth > 0) pDepth--;
      continue;
    }
    if (up === 'CASE') {
      cDepth++;
      continue;
    }
    if (up === 'END') {
      const suf = wordUpper(tokens[i + 1]);
      if (!END_COMPOUND_SUFFIXES.has(suf)) {
        if (cDepth > 0) {
          cDepth--;
          continue;
        }
        if (pDepth === 0) return { targetIdx: -1, nextIdx: i };
      } else if (pDepth === 0 && cDepth === 0) {
        return { targetIdx: -1, nextIdx: i };
      }
      continue;
    }
    if (pDepth === 0 && cDepth === 0) {
      if (up === targetUpper) {
        return { targetIdx: i, nextIdx: i + 1 };
      }
      if (tok.text === ';') {
        return { targetIdx: -1, nextIdx: i };
      }
    }
  }
  return { targetIdx: -1, nextIdx: tokens.length };
}

function makeVisibilityFixes(insertAt: number): readonly CodeFixSuggestion[] {
  return [
    {
      title: "Add 'PRIVATE'",
      kind: 'quickfix',
      isPreferred: true,
      edits: [{ start: insertAt, end: insertAt, newText: 'PRIVATE ' }],
    },
    {
      title: "Add 'PUBLIC'",
      kind: 'quickfix',
      isPreferred: false,
      edits: [{ start: insertAt, end: insertAt, newText: 'PUBLIC ' }],
    },
  ];
}

function makeAddConstantFix(text: string, baseOffset: number, nameEnd: number): CodeFixSuggestion {
  const needsTrailingSpace = nameEnd < text.length && !/\s/.test(text[nameEnd]) ? ' ' : '';
  return {
    title: "Add 'CONSTANT'",
    kind: 'quickfix',
    isPreferred: true,
    edits: [{ start: baseOffset + nameEnd, end: baseOffset + nameEnd, newText: ` CONSTANT${needsTrailingSpace}` }],
  };
}

function makeMoveLibVarBeforeMembersFix(
  text: string,
  baseOffset: number,
  firstMemberStart: number,
  stmtStart: number,
  stmtEnd: number,
  hasSemi: boolean
): CodeFixSuggestion | undefined {
  if (firstMemberStart >= stmtStart || stmtEnd <= stmtStart) return undefined;

  const declText = hasSemi ? text.slice(stmtStart, stmtEnd) : `${text.slice(stmtStart, stmtEnd)};`;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  let firstLineStart = firstMemberStart;
  while (firstLineStart > 0 && text[firstLineStart - 1] !== '\n') firstLineStart--;
  const onlyWsBeforeFirst = text.slice(firstLineStart, firstMemberStart).trim().length === 0;

  let stmtLineStart = stmtStart;
  while (stmtLineStart > 0 && text[stmtLineStart - 1] !== '\n') stmtLineStart--;
  const onlyWsBeforeStmt = text.slice(stmtLineStart, stmtStart).trim().length === 0;

  let afterStmtWsEnd = stmtEnd;
  while (afterStmtWsEnd < text.length && (text[afterStmtWsEnd] === ' ' || text[afterStmtWsEnd] === '\t')) {
    afterStmtWsEnd++;
  }
  const atEolAfterStmt =
    afterStmtWsEnd >= text.length ||
    text[afterStmtWsEnd] === '\n' ||
    (text[afterStmtWsEnd] === '\r' && text[afterStmtWsEnd + 1] === '\n');

  let delStart: number;
  let delEnd: number;
  if (onlyWsBeforeStmt && atEolAfterStmt) {
    if (afterStmtWsEnd < text.length) {
      delStart = stmtLineStart;
      delEnd = text[afterStmtWsEnd] === '\r' ? afterStmtWsEnd + 2 : afterStmtWsEnd + 1;
    } else {
      delStart =
        stmtLineStart > 0
          ? stmtLineStart >= 2 && text[stmtLineStart - 2] === '\r'
            ? stmtLineStart - 2
            : stmtLineStart - 1
          : stmtLineStart;
      delEnd = afterStmtWsEnd;
    }
  } else if (onlyWsBeforeStmt) {
    delStart = stmtStart;
    delEnd = afterStmtWsEnd;
  } else {
    delStart = stmtStart;
    while (delStart > firstMemberStart && (text[delStart - 1] === ' ' || text[delStart - 1] === '\t')) {
      delStart--;
    }
    delEnd = stmtEnd;
  }

  const insertAt = onlyWsBeforeFirst ? firstLineStart : firstMemberStart;
  const insertText = onlyWsBeforeFirst
    ? `${text.slice(firstLineStart, firstMemberStart)}${declText}${eol}`
    : `${declText} `;

  if (insertAt > delStart || delStart >= delEnd) return undefined;
  return {
    title: 'Move declaration before first member',
    kind: 'refactor',
    isPreferred: false,
    edits: [
      { start: baseOffset + insertAt, end: baseOffset + insertAt, newText: insertText },
      { start: baseOffset + delStart, end: baseOffset + delEnd, newText: '' },
    ],
  };
}

/**
 * Validates SQLScript routine header ordering/compatibility, `USING` placement, compound block
 * declaration/handler ordering, handler scope conflicts, and unreachable statements (`HANA-SYN-028`).
 */
export function checkSqlScriptOrderAndContext(opts: SqlContextOptions): void {
  const {
    text,
    codeTokens,
    baseOffset,
    lineStarts,
    brokenQidentLines,
    unclosedStarts,
    unmatchedCloseStarts,
    diagnostics,
  } = opts;
  if (codeTokens.length === 0) return;

  const emitDiag = (
    tok: Token,
    ruleId: string,
    message: string,
    severity: DiagnosticSeverityLevel = 'error',
    tags?: readonly DiagnosticTagKind[],
    fixes: readonly CodeFixSuggestion[] = []
  ): void => {
    if (unclosedStarts.has(tok.start) || unmatchedCloseStarts.has(tok.start)) return;
    const line = findLineNumber(lineStarts, baseOffset + tok.start);
    if (brokenQidentLines.has(line)) return;
    diagnostics.push({
      ruleId,
      category: 'syntax',
      severity,
      ...(tags ? { tags } : {}),
      message,
      start: baseOffset + tok.start,
      end: baseOffset + tok.end,
      fixes,
    });
  };

  /** Consumes qualified name (`a.b.c`), stopping cleanly before `(`, `;`, or header keywords. */
  const skipQualifiedName = (idx: number): number => {
    let i = idx;
    if (!isSimpleIdOrIdent(codeTokens[i])) return i;
    i++;
    while (i + 1 < codeTokens.length && codeTokens[i].text === '.' && isSimpleIdOrIdent(codeTokens[i + 1])) {
      i += 2;
    }
    return i;
  };

  /** Consumes a `USING <lib> [AS <alias>];` clause and returns index after `;`. */
  const consumeUsingStmt = (idx: number): number => {
    let i = idx + 1;
    i = skipQualifiedName(i);
    if (wordUpper(codeTokens[i]) === 'AS' && isSimpleIdOrIdent(codeTokens[i + 1])) {
      i += 2;
    }
    if (codeTokens[i]?.text === ';') return i + 1;
    return i;
  };

  interface ParsedRoutineResult {
    readonly handled: boolean;
    readonly nextIdx: number;
    readonly openedRoutine?: RoutineContext;
    readonly openedKind?: BlockKind;
  }

  /**
   * Parses a routine/library/trigger/`DO` header at statement start with the consuming header parser
   * (`parseRoutineHeader`), reports its syntax issues (`HANA-SYN-021` / `HANA-SYN-040`), and validates
   * clause placement and compatibility (`HANA-SYN-028`).
   * Returns `nextIdx` pointing immediately after `BEGIN` if a block was opened, or after `;`/EOF otherwise.
   */
  const tryParseRoutineHeader = (startIdx: number, inLibrary: boolean): ParsedRoutineResult => {
    const hdr = parseRoutineHeader(codeTokens, startIdx, { inLibrary });
    if (!hdr) return { handled: false, nextIdx: startIdx };

    // A missing / extra bracket inside the header (already reported as HANA-SYN-003) desynchronizes clause
    // parsing, so structural header issues are suppressed for that header; word-local typos are kept.
    const hdrStart = codeTokens[startIdx].start;
    const hdrEnd = codeTokens[Math.min(hdr.nextIdx, codeTokens.length) - 1]?.end ?? hdrStart;
    const inHeader = (off: number): boolean => off >= hdrStart && off < hdrEnd;
    const hasDelimiterError =
      [...unclosedStarts.keys()].some(inHeader) || [...unmatchedCloseStarts].some(inHeader);

    for (const iss of hdr.issues) {
      const tok = codeTokens[iss.tokIdx];
      if (!tok) continue;
      if (hasDelimiterError && iss.ruleId === 'HANA-SYN-040') continue;
      const fixes: CodeFixSuggestion[] = [];
      if (iss.replaceWith !== undefined) {
        fixes.push({
          title: `Replace '${tok.text}' with '${iss.replaceWith}'`,
          kind: 'quickfix',
          isPreferred: true,
          edits: [{ start: baseOffset + tok.start, end: baseOffset + tok.end, newText: iss.replaceWith }],
        });
      } else if (iss.insertBefore !== undefined) {
        fixes.push({
          title: `Insert '${iss.insertBefore.trim()}'`,
          kind: 'quickfix',
          isPreferred: true,
          edits: [{ start: baseOffset + tok.start, end: baseOffset + tok.start, newText: iss.insertBefore }],
        });
      }
      emitDiag(tok, iss.ruleId, iss.message, 'error', undefined, fixes);
    }

    const kindTok = codeTokens[hdr.kindIdx];
    if (hdr.kind === 'do') {
      return hdr.beginIdx >= 0
        ? { handled: true, nextIdx: hdr.nextIdx, openedKind: 'begin', openedRoutine: createRoutineContext('do') }
        : { handled: true, nextIdx: hdr.nextIdx };
    }
    if (hdr.kind === 'trigger') {
      return hdr.beginIdx >= 0
        ? {
            handled: true,
            nextIdx: hdr.nextIdx,
            openedKind: 'begin',
            openedRoutine: createRoutineContext('trigger', { isAlter: hdr.isAlter }),
          }
        : { handled: true, nextIdx: hdr.nextIdx };
    }
    if (hdr.kind === 'library') {
      return hdr.beginIdx >= 0
        ? {
            handled: true,
            nextIdx: hdr.nextIdx,
            openedKind: 'library_root',
            openedRoutine: createRoutineContext('library', { isAlter: hdr.isAlter }),
          }
        : { handled: true, nextIdx: hdr.nextIdx };
    }
    if (hdr.isManagementForm) return { handled: true, nextIdx: hdr.nextIdx };

    const isFunction = hdr.kind === 'function';
    const isProcedure = hdr.kind === 'procedure';

    // Parameter modes: functions only take IN parameters.
    if (isFunction && hdr.paramOpenIdx >= 0 && hdr.paramCloseIdx > hdr.paramOpenIdx) {
      let pDepth = 0;
      let atParamStart = true;
      for (let p = hdr.paramOpenIdx + 1; p < hdr.paramCloseIdx; p++) {
        const pt = codeTokens[p];
        if (pt.text === '(' || pt.text === '[') {
          pDepth++;
          atParamStart = false;
        } else if (pt.text === ')' || pt.text === ']') {
          if (pDepth > 0) pDepth--;
          atParamStart = false;
        } else if (pDepth === 0 && pt.text === ',') {
          atParamStart = true;
        } else if (atParamStart && pDepth === 0) {
          atParamStart = false;
          const pUp = wordUpper(pt);
          if (pUp === 'OUT' || pUp === 'INOUT') {
            emitDiag(
              pt,
              'HANA-SYN-028',
              `Parameter mode '${pUp}' is not allowed in a FUNCTION header; functions only support 'IN' parameters.`
            );
          }
        }
      }
    }

    for (const u of hdr.usingIdxs) {
      if (!u.afterAs) {
        emitDiag(
          codeTokens[u.tokIdx],
          'HANA-SYN-028',
          `'USING' library declaration must appear after 'AS' (or at the start of root 'BEGIN').`
        );
      }
    }

    // Clause placement, duplicates, and kind compatibility.
    const seenClauses = new Set<string>();
    let firstTrailingOptionName: string | undefined;
    let sawReturns = false;
    let hasReadsSqlData = false;
    let hasDeterministic = false;
    let hasAutocommitDdl = false;
    let autocommitTok: Token | undefined;
    for (const cl of hdr.clauses) {
      const tok = codeTokens[cl.tokIdx];
      switch (cl.key) {
        case 'RETURNS':
          if (isProcedure) {
            emitDiag(tok, 'HANA-SYN-028', `'RETURNS' clause is not allowed in a PROCEDURE header; use OUT/INOUT parameters instead.`);
          } else if (cl.afterAs) {
            emitDiag(tok, 'HANA-SYN-028', `Header clause 'RETURNS' must appear before 'AS'.`);
          } else if (seenClauses.has('RETURNS')) {
            emitDiag(tok, 'HANA-SYN-028', `Duplicate 'RETURNS' clause in FUNCTION header.`);
          } else {
            seenClauses.add('RETURNS');
            sawReturns = true;
            if (firstTrailingOptionName) {
              emitDiag(tok, 'HANA-SYN-028', `'RETURNS' clause must appear before '${firstTrailingOptionName}' in FUNCTION header.`);
            }
          }
          continue;
        case 'SEQUENTIAL EXECUTION':
        case 'PARALLEL EXECUTION':
          emitDiag(
            tok,
            'HANA-SYN-028',
            `'${cl.key}' must appear immediately after 'BEGIN' (or branch keyword), not in the routine header.`
          );
          continue;
        case 'AUTONOMOUS TRANSACTION':
          emitDiag(tok, 'HANA-SYN-028', `'AUTONOMOUS TRANSACTION' must appear immediately after 'BEGIN', not in the routine header.`);
          continue;
        case 'AUTOCOMMIT DDL':
          if (isFunction) {
            emitDiag(tok, 'HANA-SYN-028', `'AUTOCOMMIT DDL' is not allowed in a FUNCTION header.`);
            continue;
          }
          hasAutocommitDdl = true;
          autocommitTok = tok;
          break;
        case 'STRUCTURED FILTER CHECK':
          if (isProcedure) {
            emitDiag(tok, 'HANA-SYN-028', `'STRUCTURED FILTER CHECK' is only supported in FUNCTION headers.`);
            continue;
          }
          break;
        case 'READS SQL DATA':
          hasReadsSqlData = true;
          break;
        case 'DETERMINISTIC':
          hasDeterministic = true;
          break;
        default:
          break;
      }
      if (cl.afterAs) {
        emitDiag(tok, 'HANA-SYN-028', `Header clause '${cl.key}' must appear before 'AS'.`);
      } else if (seenClauses.has(cl.key)) {
        emitDiag(tok, 'HANA-SYN-028', `Duplicate '${cl.key}' clause in routine header.`);
      } else {
        seenClauses.add(cl.key);
        if (!firstTrailingOptionName && cl.key !== 'CONFIGURATION' && cl.key !== 'AT') firstTrailingOptionName = cl.key;
      }
    }

    if (isProcedure && hasReadsSqlData && hasAutocommitDdl && autocommitTok) {
      emitDiag(autocommitTok, 'HANA-SYN-028', `'AUTOCOMMIT DDL' is not allowed in a 'READS SQL DATA' procedure.`);
    }
    if (isFunction && !hdr.isAlter && !hdr.isVirtual && !sawReturns && kindTok) {
      emitDiag(kindTok, 'HANA-SYN-028', `Missing 'RETURNS' clause in FUNCTION header.`);
    }

    const hasForeignLanguage = hdr.language !== null && hdr.language !== 'SQLSCRIPT';
    if (hdr.beginIdx < 0 || hasForeignLanguage) {
      // No body, or a foreign (R/RLANG/GRAPH/...) body that is not SQLScript.
      return { handled: true, nextIdx: hdr.nextIdx };
    }
    const routineKind: RoutineKind = isProcedure
      ? 'procedure'
      : hdr.returnKind === 'table'
        ? 'table_function'
        : 'scalar_function';
    return {
      handled: true,
      nextIdx: hdr.nextIdx,
      openedKind: 'begin',
      openedRoutine: createRoutineContext(routineKind, {
        isAlter: hdr.isAlter,
        isVirtual: hdr.isVirtual,
        hasReadsSqlData,
        hasDeterministic,
        hasAutocommitDdl,
        hasForeignLanguage,
        hasExplicitReturns: sawReturns,
        returnVarNames: hdr.returnVarNames,
      }),
    };
  };

  /**
   * Parses `DECLARE [EXIT | CONTINUE] HANDLER FOR <cond_list>` starting at `FOR`,
   * validates scope handler kind conflicts and duplicates, and returns token index of handler body start.
   */
  const parseHandlerForClause = (
    handlerTok: Token,
    handlerKind: 'EXIT' | 'CONTINUE' | null,
    forStartIdx: number,
    scopeStack: readonly BlockScope[]
  ): number => {
    const curScope = scopeStack[scopeStack.length - 1];
    if (handlerKind && curScope) {
      if (curScope.handlerKind && curScope.handlerKind !== handlerKind) {
        emitDiag(
          handlerTok,
          'HANA-SYN-028',
          `'${handlerKind} HANDLER' cannot appear in the same scope as '${curScope.handlerKind} HANDLER'.`
        );
      } else if (handlerKind === 'EXIT') {
        for (let s = scopeStack.length - 2; s >= 0; s--) {
          if (scopeStack[s].handlerKind === 'CONTINUE') {
            emitDiag(
              handlerTok,
              'HANA-SYN-028',
              `'EXIT HANDLER' cannot be declared in a nested scope inside an enclosing 'CONTINUE HANDLER' scope.`
            );
            break;
          }
        }
      }
      if (!curScope.handlerKind) {
        curScope.handlerKind = handlerKind;
      }
    }

    let j = forStartIdx;
    if (wordUpper(codeTokens[j]) === 'FOR') {
      j++;
    } else {
      return j;
    }

    while (j < codeTokens.length) {
      const condTok = codeTokens[j];
      const condUp = wordUpper(condTok);
      let condKey: string | undefined;
      let condDisplay: string | undefined;

      if (condUp === 'SQLEXCEPTION') {
        condKey = 'SQLEXCEPTION';
        condDisplay = 'SQLEXCEPTION';
        j++;
      } else if (condUp === 'SQL_ERROR_CODE' && codeTokens[j + 1]?.type === 'number') {
        const codeNum = codeTokens[j + 1].text;
        condKey = `SQL_ERROR_CODE:${codeNum}`;
        condDisplay = `SQL_ERROR_CODE ${codeNum}`;
        j += 2;
      } else if (condTok && (condTok.type === 'word' || condTok.type === 'qident')) {
        const norm = condTok.type === 'qident' ? condTok.text : condTok.text.toUpperCase();
        condKey = `COND:${norm}`;
        condDisplay = condTok.text;
        j++;
      } else {
        break;
      }

      if (condKey && condDisplay && curScope) {
        if (curScope.seenConditions.has(condKey)) {
          emitDiag(condTok, 'HANA-SYN-028', `Duplicate condition handler for '${condDisplay}' in this scope.`);
        } else {
          curScope.seenConditions.add(condKey);
        }
      }

      if (codeTokens[j]?.text === ',') {
        j++;
        continue;
      }
      break;
    }

    return j;
  };

  const scopeStack: BlockScope[] = [];
  let parenDepth = 0;
  let caseDepth = 0;
  let atStmtStart = true;

  const pushScope = (
    kind: BlockKind,
    isRoutineRoot: boolean,
    routine: RoutineContext | undefined,
    inLoop: boolean,
    inHandler: boolean,
    inAutonomous = false,
    inParallel = false
  ): void => {
    scopeStack.push({
      kind,
      parenDepth,
      isRoutineRoot,
      inLoop,
      inHandler,
      inAutonomous,
      inParallel,
      routine,
      phase: kind === 'single_handler' ? BlockPhase.EXECUTABLE : BlockPhase.START,
      terminated: false,
      terminatedBy: '',
      handlerKind: null,
      seenConditions: new Set<string>(),
    });
  };

  const resetBranchScope = (scope: BlockScope): void => {
    scope.phase = BlockPhase.START;
    scope.terminated = false;
    scope.terminatedBy = '';
    scope.handlerKind = null;
    scope.seenConditions.clear();
  };

  let i = 0;
  while (i < codeTokens.length) {
    const tok = codeTokens[i];
    const up = wordUpper(tok);
    const prevTok = i > 0 ? codeTokens[i - 1] : undefined;
    const nextTok = codeTokens[i + 1];
    const nextUp = wordUpper(nextTok);
    const topScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined;

    // 1. Track expression delimiters cleanly even inside statements
    if (tok.text === '(') {
      parenDepth++;
      atStmtStart = false;
      i++;
      continue;
    }
    if (tok.text === ')') {
      if (parenDepth > 0) parenDepth--;
      atStmtStart = false;
      i++;
      continue;
    }
    if (tok.text === ';') {
      while (
        scopeStack.length > 0 &&
        scopeStack[scopeStack.length - 1].kind === 'single_handler' &&
        parenDepth === scopeStack[scopeStack.length - 1].parenDepth &&
        caseDepth === 0
      ) {
        scopeStack.pop();
      }
      atStmtStart = true;
      i++;
      continue;
    }
    if (up === 'CASE') {
      caseDepth++;
      atStmtStart = false;
      i++;
      continue;
    }

    // 2. Block closers / IF branch switches at matching paren & zero CASE depth
    if (topScope && caseDepth === 0 && parenDepth === topScope.parenDepth) {
      if (up === 'END') {
        if (END_COMPOUND_SUFFIXES.has(nextUp)) {
          // `END IF` / `END LOOP` / `END WHILE` / `END FOR`
          const expectedKind = nextUp.toLowerCase() as BlockKind;
          while (
            scopeStack.length > 0 &&
            scopeStack[scopeStack.length - 1].kind === 'single_handler' &&
            scopeStack[scopeStack.length - 1].parenDepth === parenDepth
          ) {
            scopeStack.pop();
          }
          const idxMatch = (() => {
            for (let s = scopeStack.length - 1; s >= 0; s--) {
              if (scopeStack[s].kind === expectedKind) return s;
              if (
                scopeStack[s].kind === 'begin' ||
                scopeStack[s].kind === 'handler_begin' ||
                scopeStack[s].kind === 'library_root'
              ) {
                return -1;
              }
            }
            return -1;
          })();
          if (idxMatch >= 0) {
            scopeStack.length = idxMatch;
          }
          if (
            scopeStack.length > 0 &&
            scopeStack[scopeStack.length - 1].kind === 'single_handler' &&
            codeTokens[i + 2]?.text !== ';'
          ) {
            scopeStack.pop();
          }
          atStmtStart = false;
          i += 2;
          continue;
        } else {
          // Plain `END` closing `BEGIN` / `handler_begin` / `library_root`
          while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].kind === 'single_handler') {
            scopeStack.pop();
          }
          while (
            scopeStack.length > 0 &&
            scopeStack[scopeStack.length - 1].kind !== 'begin' &&
            scopeStack[scopeStack.length - 1].kind !== 'handler_begin' &&
            scopeStack[scopeStack.length - 1].kind !== 'library_root'
          ) {
            scopeStack.pop();
          }
          const popped = scopeStack.length > 0 ? scopeStack.pop() : undefined;
          if (
            popped?.isRoutineRoot &&
            popped.routine?.kind === 'table_function' &&
            !popped.routine.isVirtual &&
            !popped.routine.hasForeignLanguage &&
            popped.routine.hasExplicitReturns &&
            !popped.routine.hasSawReturnExpr
          ) {
            emitDiag(tok, 'HANA-SYN-029', `Table UDF body is missing a 'RETURN <query_or_table_var>;' statement.`);
          }
          atStmtStart = scopeStack[scopeStack.length - 1]?.kind === 'library_root';
          i++;
          continue;
        }
      }

      if (topScope.kind === 'if' && (up === 'ELSEIF' || up === 'ELSE')) {
        resetBranchScope(topScope);
        if (up === 'ELSEIF') {
          const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'THEN');
          i = nextIdx;
        } else {
          i++;
        }
        atStmtStart = true;
        continue;
      }
    } else if (up === 'END' && !END_COMPOUND_SUFFIXES.has(nextUp) && caseDepth > 0) {
      caseDepth--;
      i++;
      continue;
    }

    // 2b. Non-deterministic expressions inside DETERMINISTIC routines (`HANA-SYN-029`)
    if (topScope && topScope.kind !== 'library_root' && topScope.routine?.hasDeterministic && tok.type === 'word') {
      if (prevTok?.text === '.' && (up === 'NEXTVAL' || up === 'CURRVAL')) {
        emitDiag(
          tok,
          'HANA-SYN-029',
          `Sequence pseudo-column '.${up}' is non-deterministic and should not be used in a DETERMINISTIC routine.`,
          'warning'
        );
      } else if (
        prevTok?.text !== '.' &&
        ((NONDETERMINISTIC_CALLS.has(up) && nextTok?.text === '(') ||
          (NONDETERMINISTIC_NILADIC.has(up) &&
            nextTok?.text !== ':=' &&
            nextTok?.text !== '=' &&
            nextTok?.text !== '.'))
      ) {
        emitDiag(
          tok,
          'HANA-SYN-029',
          `Non-deterministic built-in '${up}' used inside a DETERMINISTIC routine.`,
          'warning'
        );
      }
    }

    // 3. Top-level outside any block scope: recognize CREATE/ALTER/VIRTUAL PROCEDURE|FUNCTION|LIBRARY|TRIGGER|DO
    if (!topScope) {
      if (atStmtStart && parenDepth === 0) {
        const res = tryParseRoutineHeader(i, false);
        if (res.handled) {
          if (res.openedKind && res.openedRoutine) {
            pushScope(res.openedKind, true, res.openedRoutine, false, false);
          }
          i = res.nextIdx;
          atStmtStart = true;
          continue;
        }
        if (
          TOP_LEVEL_IMPERATIVE_KEYWORDS.has(up) &&
          nextTok?.text !== '=' &&
          nextTok?.text !== ':=' &&
          nextTok?.text !== '.'
        ) {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `Imperative statement '${up}' is only allowed inside a routine or 'DO BEGIN ... END' block.`
          );
          if (up === 'IF') {
            const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'THEN');
            pushScope('if', false, undefined, false, false);
            i = nextIdx;
            continue;
          }
          if (up === 'WHILE') {
            const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'DO');
            pushScope('while', false, undefined, true, false);
            i = nextIdx;
            continue;
          }
          if (up === 'FOR') {
            const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'DO');
            pushScope('for', false, undefined, true, false);
            i = nextIdx;
            continue;
          }
          if (up === 'LOOP') {
            pushScope('loop', false, undefined, true, false);
            i++;
            continue;
          }
        }
      }
      atStmtStart = false;
      i++;
      continue;
    }

    // 4. Inside `.hdblibrary` root block: parse USING / member VARIABLE / PROCEDURE / FUNCTION
    if (topScope.kind === 'library_root') {
      if (!atStmtStart || parenDepth !== topScope.parenDepth || caseDepth !== 0) {
        i++;
        continue;
      }

      const hasVisibility = up === 'PUBLIC' || up === 'PRIVATE';
      const memberTok = hasVisibility ? nextTok : tok;
      const memberUp = hasVisibility ? nextUp : up;

      if (!hasVisibility && up === 'USING' && isSimpleIdOrIdent(nextTok)) {
        if (topScope.phase >= BlockPhase.DECL) {
          emitDiag(
            tok,
            'HANA-SYN-028',
            `'USING' declaration in a LIBRARY must appear before variable declarations and member procedures/functions.`
          );
        } else {
          topScope.phase = BlockPhase.AFTER_MODIFIER;
        }
        atStmtStart = false;
        i++;
        continue;
      }

      if (memberUp === 'VARIABLE' && memberTok) {
        if (!hasVisibility) {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `Library member 'VARIABLE' must specify 'PUBLIC' or 'PRIVATE' visibility.`,
            'error',
            undefined,
            makeVisibilityFixes(baseOffset + tok.start)
          );
        }

        let cur = hasVisibility ? i + 2 : i + 1;
        const nameEndIdx = skipQualifiedName(cur);
        const constInsertTok = nameEndIdx > cur ? codeTokens[nameEndIdx - 1] : undefined;
        if (nameEndIdx > cur) {
          cur = nameEndIdx;
        }
        let hasConstant = false;
        let initTok: Token | undefined;
        let localParen = 0;
        let localCase = 0;
        while (cur < codeTokens.length) {
          const t = codeTokens[cur];
          const tUp = wordUpper(t);
          if (t.text === '(') {
            localParen++;
          } else if (t.text === ')') {
            if (localParen > 0) localParen--;
          } else if (tUp === 'CASE') {
            localCase++;
          } else if (tUp === 'END' && localCase > 0 && !END_COMPOUND_SUFFIXES.has(wordUpper(codeTokens[cur + 1]))) {
            localCase--;
          } else if (localParen === 0 && localCase === 0) {
            if (t.text === ';') break;
            if (tUp === 'END' || tUp === 'PUBLIC' || tUp === 'PRIVATE') break;
            if (tUp === 'CONSTANT') {
              hasConstant = true;
            } else if (!initTok && (tUp === 'DEFAULT' || t.text === '=' || t.text === ':=')) {
              initTok = t;
            }
          }
          cur++;
        }

        const hasSemi = codeTokens[cur]?.text === ';';
        const lastStmtTok = hasSemi ? codeTokens[cur] : codeTokens[Math.max(i, cur - 1)];
        if (topScope.phase >= BlockPhase.EXECUTABLE) {
          const moveFix =
            topScope.firstMemberStart !== undefined && lastStmtTok
              ? makeMoveLibVarBeforeMembersFix(
                  text,
                  baseOffset,
                  topScope.firstMemberStart,
                  tok.start,
                  lastStmtTok.end,
                  hasSemi
                )
              : undefined;
          emitDiag(
            memberTok,
            'HANA-SYN-028',
            `Library variable declarations must appear before member procedures and functions.`,
            'error',
            undefined,
            moveFix ? [moveFix] : []
          );
        } else {
          topScope.phase = BlockPhase.DECL;
        }

        if (initTok && !hasConstant) {
          const constFixes =
            constInsertTok && initTok.start > constInsertTok.end
              ? [makeAddConstantFix(text, baseOffset, constInsertTok.end)]
              : [];
          emitDiag(
            initTok,
            'HANA-SYN-028',
            `Library variable initializer '${initTok.text.toUpperCase()}' requires 'CONSTANT'.`,
            'error',
            undefined,
            constFixes
          );
        }
        i = hasSemi ? cur + 1 : cur;
        atStmtStart = true;
        continue;
      }

      if (memberUp === 'PROCEDURE' || memberUp === 'FUNCTION') {
        if (!hasVisibility) {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `Library member '${memberUp}' must specify 'PUBLIC' or 'PRIVATE' visibility.`,
            'error',
            undefined,
            makeVisibilityFixes(baseOffset + tok.start)
          );
        }
        if (topScope.firstMemberStart === undefined) {
          topScope.firstMemberStart = tok.start;
        }
        topScope.phase = BlockPhase.EXECUTABLE;
        const res = tryParseRoutineHeader(i, true);
        if (res.handled) {
          if (res.openedKind && res.openedRoutine) {
            pushScope(res.openedKind, true, res.openedRoutine, false, false);
          }
          i = res.nextIdx;
          atStmtStart = true;
          continue;
        }
      }

      emitDiag(
        tok,
        'HANA-SYN-029',
        `Statement '${up || tok.text}' is not allowed directly inside a LIBRARY body; use 'PUBLIC'/'PRIVATE' 'VARIABLE', 'PROCEDURE', or 'FUNCTION' members.`
      );
      atStmtStart = false;
      i++;
      continue;
    }

    // 5. Inside a SQLScript compound block at statement start
    if (!atStmtStart || parenDepth !== topScope.parenDepth || caseDepth !== 0) {
      i++;
      continue;
    }

    // 5a. Block modifiers (`SEQUENTIAL EXECUTION`, `PARALLEL EXECUTION`, `AUTONOMOUS TRANSACTION`)
    if (
      ((up === 'SEQUENTIAL' || up === 'PARALLEL') && nextUp === 'EXECUTION') ||
      (up === 'AUTONOMOUS' && nextUp === 'TRANSACTION')
    ) {
      const modName = up === 'AUTONOMOUS' ? 'AUTONOMOUS TRANSACTION' : `${up} EXECUTION`;
      const isBeginKind = topScope.kind === 'begin' || topScope.kind === 'handler_begin';
      const routine = topScope.routine;
      const isFunctionRoutine = Boolean(
        routine && (routine.kind === 'scalar_function' || routine.kind === 'table_function')
      );
      if (topScope.phase === BlockPhase.START) {
        if (!isBeginKind && up !== 'SEQUENTIAL') {
          emitDiag(tok, 'HANA-SYN-028', `'${modName}' is only valid on a 'BEGIN' block.`);
        } else if (up === 'AUTONOMOUS') {
          if (routine?.kind === 'trigger') {
            emitDiag(tok, 'HANA-SYN-029', `'BEGIN AUTONOMOUS TRANSACTION' is not allowed inside a TRIGGER body.`);
          } else {
            (topScope as { inAutonomous: boolean }).inAutonomous = true;
            if (isFunctionRoutine || routine?.hasReadsSqlData) {
              emitDiag(
                tok,
                'HANA-SYN-029',
                `'BEGIN AUTONOMOUS TRANSACTION' is not allowed inside a FUNCTION or READS SQL DATA procedure.`
              );
            }
          }
        } else if (up === 'PARALLEL') {
          if (routine?.kind === 'trigger') {
            emitDiag(tok, 'HANA-SYN-029', `'BEGIN PARALLEL EXECUTION' is not allowed inside a TRIGGER body.`);
          } else {
            (topScope as { inParallel: boolean }).inParallel = true;
            if (isFunctionRoutine) {
              emitDiag(tok, 'HANA-SYN-029', `'BEGIN PARALLEL EXECUTION' is not allowed inside a FUNCTION.`);
            }
          }
        }
        topScope.phase = BlockPhase.AFTER_MODIFIER;
      } else {
        emitDiag(
          tok,
          'HANA-SYN-028',
          `'${modName}' must appear immediately after the block opener, before declarations and statements.`
        );
      }
      i += 2;
      atStmtStart = true;
      continue;
    }

    // 5b. Misplaced routine header clauses inside block body
    if (
      (up === 'READS' && nextUp === 'SQL' && wordUpper(codeTokens[i + 2]) === 'DATA') ||
      (up === 'SQL' && nextUp === 'SECURITY') ||
      (up === 'DEFAULT' && nextUp === 'SCHEMA') ||
      (up === 'AUTOCOMMIT' && nextUp === 'DDL') ||
      (up === 'LANGUAGE' && nextUp === 'SQLSCRIPT')
    ) {
      const label =
        up === 'READS' ? 'READS SQL DATA' : up === 'LANGUAGE' ? 'LANGUAGE' : `${up} ${nextUp}`;
      emitDiag(tok, 'HANA-SYN-028', `Header clause '${label}' must appear before 'AS' in the routine header.`);
      atStmtStart = false;
      i++;
      continue;
    }

    // 5c. `USING <library> [AS <alias>];`
    if (up === 'USING' && isSimpleIdOrIdent(nextTok)) {
      if (!topScope.isRoutineRoot) {
        emitDiag(
          tok,
          'HANA-SYN-028',
          `'USING' declaration is only allowed at routine root level (after 'AS' or at the top of root 'BEGIN').`
        );
      } else if (topScope.phase > BlockPhase.AFTER_MODIFIER) {
        emitDiag(
          tok,
          'HANA-SYN-028',
          `'USING' declaration must appear before 'DECLARE' and statements at routine root level.`
        );
      } else {
        topScope.phase = BlockPhase.AFTER_MODIFIER;
      }
      i = consumeUsingStmt(i);
      atStmtStart = true;
      continue;
    }

    // 5d. `DECLARE` (variable/table/array/cursor/condition vs handler)
    if (up === 'DECLARE') {
      const isHandler =
        (nextUp === 'EXIT' || nextUp === 'CONTINUE') && wordUpper(codeTokens[i + 2]) === 'HANDLER';
      const isBareHandler = nextUp === 'HANDLER';

      if (isHandler || isBareHandler) {
        const hKind: 'EXIT' | 'CONTINUE' | null =
          nextUp === 'EXIT' ? 'EXIT' : nextUp === 'CONTINUE' ? 'CONTINUE' : null;
        if (topScope.inParallel) {
          emitDiag(tok, 'HANA-SYN-029', `'DECLARE ... HANDLER' is not allowed inside 'BEGIN PARALLEL EXECUTION'.`);
        }
        if (topScope.phase >= BlockPhase.EXECUTABLE) {
          emitDiag(
            tok,
            'HANA-SYN-028',
            `'DECLARE ... HANDLER' must appear before executable statements in this block.`
          );
        } else {
          topScope.phase = BlockPhase.HANDLER;
        }
        const forIdx = isHandler ? i + 3 : i + 2;
        const bodyIdx = parseHandlerForClause(tok, hKind, forIdx, scopeStack);
        if (wordUpper(codeTokens[bodyIdx]) === 'BEGIN') {
          pushScope(
            'handler_begin',
            false,
            topScope.routine,
            false,
            true,
            topScope.inAutonomous,
            topScope.inParallel
          );
          i = bodyIdx + 1;
          atStmtStart = true;
        } else {
          pushScope(
            'single_handler',
            false,
            topScope.routine,
            false,
            true,
            topScope.inAutonomous,
            topScope.inParallel
          );
          i = bodyIdx;
          atStmtStart = true;
        }
        continue;
      }

      // Variable / Table / Array / Cursor / Condition declaration
      if (
        topScope.inAutonomous &&
        (wordUpper(codeTokens[i + 1]) === 'CURSOR' || wordUpper(codeTokens[i + 2]) === 'CURSOR')
      ) {
        emitDiag(
          tok,
          'HANA-SYN-029',
          `Cursor declarations ('DECLARE ... CURSOR') are not allowed inside 'BEGIN AUTONOMOUS TRANSACTION'.`
        );
      }
      if (topScope.phase === BlockPhase.HANDLER) {
        emitDiag(
          tok,
          'HANA-SYN-028',
          `'DECLARE' variable/cursor/condition must appear before 'DECLARE ... HANDLER' in this block.`
        );
      } else if (topScope.phase >= BlockPhase.EXECUTABLE) {
        emitDiag(tok, 'HANA-SYN-028', `'DECLARE' must appear before executable statements in this block.`);
      } else {
        topScope.phase = BlockPhase.DECL;
      }
      atStmtStart = false;
      i++;
      continue;
    }

    // 5e. Executable statements & control flow (check unreachable FIRST)
    if (topScope.terminated && topScope.kind !== 'single_handler') {
      emitDiag(tok, 'HANA-SYN-028', `Unreachable statement after '${topScope.terminatedBy}'.`, 'warning', [
        'unnecessary',
      ]);
    }
    topScope.phase = BlockPhase.EXECUTABLE;

    const routine = topScope.routine;
    const isFunctionRoutine = Boolean(
      routine && (routine.kind === 'scalar_function' || routine.kind === 'table_function')
    );
    const isReadOnlyRoutine = Boolean(isFunctionRoutine || routine?.hasReadsSqlData);
    const notAssigned = nextTok?.text !== '=' && nextTok?.text !== ':=' && nextTok?.text !== '.';

    // Context-sensitive legality checks (`HANA-SYN-029`)
    if (notAssigned) {
      if (up === 'RETURN') {
        const isBareReturn =
          !nextTok ||
          nextTok.text === ';' ||
          nextUp === 'END' ||
          nextUp === 'ELSE' ||
          nextUp === 'ELSEIF';
        if (topScope.inParallel) {
          emitDiag(tok, 'HANA-SYN-029', `'RETURN' is not allowed inside 'BEGIN PARALLEL EXECUTION'.`);
        } else if (routine?.kind === 'table_function') {
          if (isBareReturn) {
            emitDiag(
              tok,
              'HANA-SYN-029',
              `Table UDF cannot use bare 'RETURN;'; return a table expression via 'RETURN <query_or_table_var>;'.`
            );
          } else {
            routine.hasSawReturnExpr = true;
          }
        } else if (!isBareReturn && routine) {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `'RETURN <expr>' is only allowed in a Table UDF; use return parameter assignment or bare 'RETURN;' instead.`
          );
        }
      } else if ((up === 'BREAK' || up === 'CONTINUE') && !topScope.inLoop) {
        emitDiag(tok, 'HANA-SYN-029', `'${up}' is only allowed inside a 'LOOP', 'WHILE', or 'FOR' statement.`);
      } else if (up === 'RESIGNAL' && !topScope.inHandler) {
        emitDiag(tok, 'HANA-SYN-029', `'RESIGNAL' is only allowed inside a 'DECLARE ... HANDLER' exception handler.`);
      } else if (up === 'SIGNAL' && nextUp === 'SQL_ERROR_CODE' && codeTokens[i + 2]?.type === 'number') {
        const codeNum = Number(codeTokens[i + 2].text);
        if (!Number.isInteger(codeNum) || codeNum < 10000 || codeNum > 19999) {
          emitDiag(
            codeTokens[i + 2],
            'HANA-SYN-029',
            `'SIGNAL SQL_ERROR_CODE' code ${codeTokens[i + 2].text} must be a user-defined error code between 10000 and 19999.`
          );
        }
      } else if (up === 'DO' && (nextTok?.text === '(' || nextUp === 'BEGIN')) {
        emitDiag(tok, 'HANA-SYN-029', `Nested 'DO BEGIN ... END' anonymous blocks are not allowed inside a routine.`);
        let cur = i + 1;
        if (nextTok?.text === '(') {
          const closeIdx = findMatchingParen(codeTokens, cur);
          cur = closeIdx >= 0 ? closeIdx + 1 : cur + 1;
        }
        if (wordUpper(codeTokens[cur]) === 'BEGIN') {
          pushScope(
            'begin',
            false,
            topScope.routine,
            topScope.inLoop,
            topScope.inHandler,
            topScope.inAutonomous,
            topScope.inParallel
          );
          atStmtStart = true;
          i = cur + 1;
          continue;
        }
      } else if (DML_WRITE_KEYWORDS.has(up)) {
        const targetTok =
          (up === 'INSERT' || up === 'MERGE') && nextUp === 'INTO'
            ? codeTokens[i + 2]
            : up === 'DELETE' && nextUp === 'FROM'
              ? codeTokens[i + 2]
              : nextTok;
        if (isReadOnlyRoutine && targetTok && targetTok.type !== 'var') {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `'${up}' on persistent table '${targetTok.text}' is not allowed inside a FUNCTION or READS SQL DATA procedure.`
          );
        }
      } else if (DDL_KEYWORDS.has(up) && (nextTok?.type === 'word' || nextTok?.type === 'qident')) {
        if (isReadOnlyRoutine) {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `DDL statement '${up}' is not allowed inside a FUNCTION or READS SQL DATA procedure.`
          );
        } else if (topScope.inAutonomous) {
          emitDiag(tok, 'HANA-SYN-029', `DDL statement '${up}' is not allowed inside 'BEGIN AUTONOMOUS TRANSACTION'.`);
        } else if (topScope.inParallel) {
          emitDiag(tok, 'HANA-SYN-029', `DDL statement '${up}' is not allowed inside 'BEGIN PARALLEL EXECUTION'.`);
        } else if (routine?.kind === 'trigger') {
          emitDiag(tok, 'HANA-SYN-029', `DDL statement '${up}' is not allowed inside a TRIGGER body.`);
        }
      } else if (
        up === 'COMMIT' ||
        up === 'ROLLBACK' ||
        up === 'SAVEPOINT' ||
        (up === 'LOCK' && nextUp === 'TABLE') ||
        (up === 'SET' && nextUp === 'TRANSACTION')
      ) {
        if (isReadOnlyRoutine) {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `Transaction control statement '${up}' is not allowed inside a FUNCTION or READS SQL DATA procedure.`
          );
        } else if (topScope.inParallel) {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `Transaction control statement '${up}' is not allowed inside 'BEGIN PARALLEL EXECUTION'.`
          );
        } else if (routine?.kind === 'trigger') {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `Transaction control statement '${up}' is not allowed inside a TRIGGER body.`
          );
        }
      } else if ((up === 'EXEC' && nextTok && nextTok.text !== ';') || (up === 'EXECUTE' && nextUp === 'IMMEDIATE')) {
        const dynLabel = up === 'EXECUTE' ? 'EXECUTE IMMEDIATE' : 'EXEC';
        if (isReadOnlyRoutine) {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `Dynamic SQL ('${dynLabel}') is not allowed inside a FUNCTION or READS SQL DATA procedure.`
          );
        } else if (topScope.inAutonomous) {
          emitDiag(tok, 'HANA-SYN-029', `Dynamic SQL ('${dynLabel}') is not allowed inside 'BEGIN AUTONOMOUS TRANSACTION'.`);
        } else if (topScope.inParallel) {
          emitDiag(tok, 'HANA-SYN-029', `Dynamic SQL ('${dynLabel}') is not allowed inside 'BEGIN PARALLEL EXECUTION'.`);
        } else if (routine?.kind === 'trigger') {
          emitDiag(tok, 'HANA-SYN-029', `Dynamic SQL ('${dynLabel}') is not allowed inside a TRIGGER body.`);
        }
      } else if (up === 'CALL' && nextTok) {
        if (isFunctionRoutine) {
          emitDiag(tok, 'HANA-SYN-029', `'CALL' procedure invocation is not allowed inside a FUNCTION.`);
        } else if (topScope.inAutonomous) {
          emitDiag(tok, 'HANA-SYN-029', `'CALL' is not allowed inside 'BEGIN AUTONOMOUS TRANSACTION'.`);
        }
      } else if ((up === 'OPEN' || up === 'FETCH' || up === 'CLOSE') && nextTok && nextTok.text !== '(') {
        if (topScope.inAutonomous) {
          emitDiag(
            tok,
            'HANA-SYN-029',
            `Cursor statement '${up}' is not allowed inside 'BEGIN AUTONOMOUS TRANSACTION'.`
          );
        }
      }
    }

    // Terminator keywords (`RETURN`, `SIGNAL`, `RESIGNAL`, `BREAK`, `CONTINUE`)
    if (TERMINATOR_KEYWORDS.has(up) && notAssigned) {
      topScope.terminated = true;
      topScope.terminatedBy = up;
      atStmtStart = false;
      i++;
      continue;
    }

    // Nested compound blocks (`BEGIN`, `IF`, `WHILE`, `FOR`, `LOOP`)
    if (up === 'BEGIN') {
      pushScope(
        'begin',
        false,
        topScope.routine,
        topScope.inLoop,
        topScope.inHandler,
        topScope.inAutonomous,
        topScope.inParallel
      );
      atStmtStart = true;
      i++;
      continue;
    }
    if (up === 'IF') {
      const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'THEN');
      pushScope(
        'if',
        false,
        topScope.routine,
        topScope.inLoop,
        topScope.inHandler,
        topScope.inAutonomous,
        topScope.inParallel
      );
      atStmtStart = true;
      i = nextIdx;
      continue;
    }
    if (up === 'WHILE') {
      const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'DO');
      pushScope(
        'while',
        false,
        topScope.routine,
        true,
        topScope.inHandler,
        topScope.inAutonomous,
        topScope.inParallel
      );
      atStmtStart = true;
      i = nextIdx;
      continue;
    }
    if (up === 'FOR') {
      const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'DO');
      pushScope(
        'for',
        false,
        topScope.routine,
        true,
        topScope.inHandler,
        topScope.inAutonomous,
        topScope.inParallel
      );
      atStmtStart = true;
      i = nextIdx;
      continue;
    }
    if (up === 'LOOP') {
      pushScope(
        'loop',
        false,
        topScope.routine,
        true,
        topScope.inHandler,
        topScope.inAutonomous,
        topScope.inParallel
      );
      atStmtStart = true;
      i++;
      continue;
    }

    atStmtStart = false;
    i++;
  }
}
