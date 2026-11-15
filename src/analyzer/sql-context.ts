import { type Token } from '../formatter/tokenizer';
import { findLineNumber } from './sql-order';
import { type AnalyzerDiagnostic, type DiagnosticSeverityLevel, type DiagnosticTagKind } from './types';

export interface SqlContextOptions {
  readonly languageId: string;
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
  readonly returnVarNames: ReadonlySet<string>;
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
  readonly routine: RoutineContext | undefined;
  phase: BlockPhase;
  terminated: boolean;
  terminatedBy: string;
  handlerKind: 'EXIT' | 'CONTINUE' | null;
  readonly seenConditions: Set<string>;
}

const TERMINATOR_KEYWORDS = new Set<string>(['RETURN', 'SIGNAL', 'RESIGNAL', 'BREAK', 'CONTINUE']);
const END_COMPOUND_SUFFIXES = new Set<string>(['IF', 'LOOP', 'WHILE', 'FOR']);

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

/**
 * Checks whether `tokens[idx..]` begins a routine header option after `RETURNS` (used so `RETURNS <type>`
 * does not swallow `LANGUAGE`, `SQL SECURITY`, `DEFAULT SCHEMA`, etc.).
 */
function isFunctionHeaderBoundary(tokens: readonly Token[], idx: number): boolean {
  const up = wordUpper(tokens[idx]);
  if (!up) return tokens[idx]?.text === ';';
  const nextUp = wordUpper(tokens[idx + 1]);
  const thirdUp = wordUpper(tokens[idx + 2]);
  if (up === 'AS' || up === 'BEGIN' || up === 'LANGUAGE' || up === 'DETERMINISTIC' || up === 'CONFIGURATION') {
    return true;
  }
  if (up === 'SQL' && nextUp === 'SECURITY') return true;
  if (up === 'DEFAULT' && nextUp === 'SCHEMA') return true;
  if (up === 'READS' && nextUp === 'SQL') return true;
  if (up === 'WITH' && (nextUp === 'ENCRYPTION' || nextUp === 'RESULT' || nextUp === 'PARAMETERS')) return true;
  if (up === 'AUTOCOMMIT' && nextUp === 'DDL') return true;
  if (up === 'STRUCTURED' && nextUp === 'FILTER' && thirdUp === 'CHECK') return true;
  if (up === 'NO' && nextUp === 'STRUCTURED' && wordUpper(tokens[idx + 2]) === 'FILTER') return true;
  if (up === 'VARIABLE' && nextUp === 'CACHE') return true;
  if (up === 'HEADER' && nextUp === 'ONLY') return true;
  if ((up === 'SEQUENTIAL' || up === 'PARALLEL') && nextUp === 'EXECUTION') return true;
  if (up === 'AUTONOMOUS' && nextUp === 'TRANSACTION') return true;
  return false;
}

/**
 * Validates SQLScript routine header ordering/compatibility, `USING` placement, compound block
 * declaration/handler ordering, handler scope conflicts, and unreachable statements (`HANA-SYN-028`).
 */
export function checkSqlScriptOrderAndContext(opts: SqlContextOptions): void {
  const {
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
    tags?: readonly DiagnosticTagKind[]
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
      fixes: [],
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
   * Attempts to parse and validate a routine/library/trigger/`DO` header at statement start.
   * Returns `nextIdx` pointing immediately after `BEGIN` if a block was opened, or after `;`/EOF otherwise.
   */
  const tryParseRoutineHeader = (startIdx: number, inLibrary: boolean): ParsedRoutineResult => {
    let i = startIdx;
    let isAlter = false;
    let isVirtual = false;

    const firstUp = wordUpper(codeTokens[i]);
    if (inLibrary && (firstUp === 'PUBLIC' || firstUp === 'PRIVATE')) {
      i++;
    } else if (!inLibrary) {
      if (firstUp === 'CREATE') {
        i++;
        if (wordUpper(codeTokens[i]) === 'OR' && wordUpper(codeTokens[i + 1]) === 'REPLACE') {
          i += 2;
        }
      } else if (firstUp === 'ALTER') {
        isAlter = true;
        i++;
      } else if (firstUp === 'VIRTUAL') {
        isVirtual = true;
        i++;
      }
    }

    const kindTok = codeTokens[i];
    const kindUp = wordUpper(kindTok);
    if (!kindTok || kindTok.type !== 'word') {
      return { handled: false, nextIdx: startIdx };
    }

    // Anonymous DO [(params)] BEGIN ... END block (top-level only)
    if (kindUp === 'DO' && !inLibrary && i === startIdx) {
      const nextTok = codeTokens[i + 1];
      if (nextTok?.text === '(' || wordUpper(nextTok) === 'BEGIN') {
        let cur = i + 1;
        if (nextTok.text === '(') {
          const closeIdx = findMatchingParen(codeTokens, cur);
          cur = closeIdx >= 0 ? closeIdx + 1 : cur + 1;
        }
        if (wordUpper(codeTokens[cur]) === 'BEGIN') {
          return {
            handled: true,
            nextIdx: cur + 1,
            openedKind: 'begin',
            openedRoutine: {
              kind: 'do',
              isAlter: false,
              isVirtual: false,
              hasReadsSqlData: false,
              hasDeterministic: false,
              hasAutocommitDdl: false,
              hasForeignLanguage: false,
              returnVarNames: new Set<string>(),
            },
          };
        }
      }
      return { handled: false, nextIdx: startIdx };
    }

    if (kindUp === 'TRIGGER' && !inLibrary) {
      i++;
      while (i < codeTokens.length) {
        const up = wordUpper(codeTokens[i]);
        if (codeTokens[i].text === ';') return { handled: true, nextIdx: i + 1 };
        if (up === 'BEGIN') {
          return {
            handled: true,
            nextIdx: i + 1,
            openedKind: 'begin',
            openedRoutine: {
              kind: 'trigger',
              isAlter,
              isVirtual: false,
              hasReadsSqlData: false,
              hasDeterministic: false,
              hasAutocommitDdl: false,
              hasForeignLanguage: false,
              returnVarNames: new Set<string>(),
            },
          };
        }
        if (codeTokens[i].text === '(') {
          const closeIdx = findMatchingParen(codeTokens, i);
          if (closeIdx >= 0) {
            i = closeIdx + 1;
            continue;
          }
        }
        i++;
      }
      return { handled: true, nextIdx: i };
    }

    if (kindUp === 'LIBRARY' && !inLibrary) {
      i++;
      i = skipQualifiedName(i);
      while (i < codeTokens.length) {
        const up = wordUpper(codeTokens[i]);
        if (codeTokens[i].text === ';') return { handled: true, nextIdx: i + 1 };
        if (up === 'BEGIN') {
          return {
            handled: true,
            nextIdx: i + 1,
            openedKind: 'library_root',
            openedRoutine: {
              kind: 'library',
              isAlter,
              isVirtual: false,
              hasReadsSqlData: false,
              hasDeterministic: false,
              hasAutocommitDdl: false,
              hasForeignLanguage: false,
              returnVarNames: new Set<string>(),
            },
          };
        }
        i++;
      }
      return { handled: true, nextIdx: i };
    }

    if (kindUp !== 'PROCEDURE' && kindUp !== 'FUNCTION') {
      return { handled: false, nextIdx: startIdx };
    }

    const isFunction = kindUp === 'FUNCTION';
    const isProcedure = kindUp === 'PROCEDURE';
    i++;
    i = skipQualifiedName(i);

    // Non-body management ALTER forms (`ALTER PROCEDURE p RECOMPILE`, `ALTER PROCEDURE/FUNCTION x ENCRYPTION ON`)
    if (isAlter) {
      const afterNameUp = wordUpper(codeTokens[i]);
      if (afterNameUp === 'RECOMPILE' || afterNameUp === 'ENCRYPTION') {
        while (i < codeTokens.length && codeTokens[i].text !== ';') i++;
        return { handled: true, nextIdx: codeTokens[i]?.text === ';' ? i + 1 : i };
      }
    }

    // Parameter list `(...)`
    if (codeTokens[i]?.text === '(') {
      const closeIdx = findMatchingParen(codeTokens, i);
      if (closeIdx >= 0) {
        let pDepth = 0;
        let atParamStart = true;
        for (let p = i + 1; p < closeIdx; p++) {
          const pt = codeTokens[p];
          if (pt.text === '(' || pt.text === '[') {
            pDepth++;
            atParamStart = false;
            continue;
          }
          if (pt.text === ')' || pt.text === ']') {
            if (pDepth > 0) pDepth--;
            atParamStart = false;
            continue;
          }
          if (pDepth === 0 && pt.text === ',') {
            atParamStart = true;
            continue;
          }
          if (atParamStart && pDepth === 0) {
            atParamStart = false;
            const pUp = wordUpper(pt);
            if (isFunction && (pUp === 'OUT' || pUp === 'INOUT')) {
              emitDiag(
                pt,
                'HANA-SYN-028',
                `Parameter mode '${pUp}' is not allowed in a FUNCTION header; functions only support 'IN' parameters.`
              );
            }
          }
        }
        i = closeIdx + 1;
      } else {
        i++;
      }
    }

    let sawAs = false;
    let sawReturns = false;
    let returnKind: 'none' | 'table' | 'scalar' = 'none';
    const returnVarNames = new Set<string>();
    let firstTrailingOptionName: string | undefined;
    const seenClauses = new Set<string>();
    let hasReadsSqlData = false;
    let hasDeterministic = false;
    let hasAutocommitDdl = false;
    let autocommitTok: Token | undefined;
    let hasForeignLanguage = false;
    let isHeaderOnly = false;

    const recordClause = (tok: Token, key: string, label: string, isTrailingOption: boolean): void => {
      if (sawAs) {
        emitDiag(tok, 'HANA-SYN-028', `Header clause '${label}' must appear before 'AS'.`);
      } else if (seenClauses.has(key)) {
        emitDiag(tok, 'HANA-SYN-028', `Duplicate '${label}' clause in routine header.`);
      } else {
        seenClauses.add(key);
        if (isTrailingOption && !firstTrailingOptionName) {
          firstTrailingOptionName = label;
        }
      }
    };

    const finalizeHeaderChecks = (): void => {
      if (isProcedure && hasReadsSqlData && hasAutocommitDdl && autocommitTok) {
        emitDiag(
          autocommitTok,
          'HANA-SYN-028',
          `'AUTOCOMMIT DDL' is not allowed in a 'READS SQL DATA' procedure.`
        );
      }
      if (isFunction && !isAlter && !sawReturns) {
        emitDiag(kindTok, 'HANA-SYN-028', `Missing 'RETURNS' clause in FUNCTION header.`);
      }
    };

    while (i < codeTokens.length) {
      const tok = codeTokens[i];
      const up = wordUpper(tok);
      const nextUp = wordUpper(codeTokens[i + 1]);
      const thirdUp = wordUpper(codeTokens[i + 2]);

      if (tok.text === ';') {
        finalizeHeaderChecks();
        return { handled: true, nextIdx: i + 1 };
      }

      if (up === 'BEGIN') {
        finalizeHeaderChecks();
        if (hasForeignLanguage) {
          // Foreign bodies (R/RLANG/GRAPH/etc.) are not SQLScript
          return { handled: true, nextIdx: i + 1 };
        }
        const routineKind: RoutineKind = isProcedure
          ? 'procedure'
          : returnKind === 'table'
            ? 'table_function'
            : 'scalar_function';
        return {
          handled: true,
          nextIdx: i + 1,
          openedKind: 'begin',
          openedRoutine: {
            kind: routineKind,
            isAlter,
            isVirtual,
            hasReadsSqlData,
            hasDeterministic,
            hasAutocommitDdl,
            hasForeignLanguage,
            returnVarNames,
          },
        };
      }

      if (up === 'AS') {
        sawAs = true;
        i++;
        continue;
      }

      if (up === 'USING') {
        if (!sawAs) {
          emitDiag(
            tok,
            'HANA-SYN-028',
            `'USING' library declaration must appear after 'AS' (or at the start of root 'BEGIN').`
          );
        }
        i = consumeUsingStmt(i);
        continue;
      }

      if (up === 'RETURNS') {
        if (isProcedure) {
          emitDiag(
            tok,
            'HANA-SYN-028',
            `'RETURNS' clause is not allowed in a PROCEDURE header; use OUT/INOUT parameters instead.`
          );
        } else if (sawAs) {
          emitDiag(tok, 'HANA-SYN-028', `Header clause 'RETURNS' must appear before 'AS'.`);
        } else if (seenClauses.has('RETURNS')) {
          emitDiag(tok, 'HANA-SYN-028', `Duplicate 'RETURNS' clause in FUNCTION header.`);
        } else {
          seenClauses.add('RETURNS');
          sawReturns = true;
          if (firstTrailingOptionName) {
            emitDiag(
              tok,
              'HANA-SYN-028',
              `'RETURNS' clause must appear before '${firstTrailingOptionName}' in FUNCTION header.`
            );
          }
        }
        i++;
        if (wordUpper(codeTokens[i]) === 'TABLE') {
          returnKind = 'table';
          i++;
          if (codeTokens[i]?.text === '(') {
            const closeIdx = findMatchingParen(codeTokens, i);
            i = closeIdx >= 0 ? closeIdx + 1 : i + 1;
          }
        } else {
          if (returnKind !== 'table') returnKind = 'scalar';
          let pDepth = 0;
          let expectingRetVar = true;
          while (i < codeTokens.length) {
            const rt = codeTokens[i];
            if (rt.text === '(') {
              pDepth++;
              expectingRetVar = false;
              i++;
              continue;
            }
            if (rt.text === ')') {
              if (pDepth > 0) pDepth--;
              expectingRetVar = false;
              i++;
              continue;
            }
            if (pDepth === 0 && isFunctionHeaderBoundary(codeTokens, i)) {
              break;
            }
            if (pDepth === 0 && rt.text === ',') {
              expectingRetVar = true;
              i++;
              continue;
            }
            if (
              expectingRetVar &&
              pDepth === 0 &&
              (rt.type === 'word' || rt.type === 'qident') &&
              codeTokens[i + 1] &&
              codeTokens[i + 1].text !== '(' &&
              codeTokens[i + 1].text !== ',' &&
              !isFunctionHeaderBoundary(codeTokens, i + 1)
            ) {
              returnVarNames.add(rt.type === 'qident' ? rt.text : rt.text.toUpperCase());
              expectingRetVar = false;
            }
            i++;
          }
        }
        continue;
      }

      if (up === 'LANGUAGE') {
        recordClause(tok, 'LANGUAGE', 'LANGUAGE', true);
        if (nextUp && nextUp !== 'SQLSCRIPT' && codeTokens[i + 1]?.type === 'word') {
          hasForeignLanguage = true;
        }
        i += codeTokens[i + 1] && !isFunctionHeaderBoundary(codeTokens, i + 1) ? 2 : 1;
        continue;
      }

      if (up === 'SQL' && nextUp === 'SECURITY') {
        recordClause(tok, 'SQL SECURITY', 'SQL SECURITY', true);
        i += 2;
        if (wordUpper(codeTokens[i]) === 'DEFINER' || wordUpper(codeTokens[i]) === 'INVOKER') i++;
        continue;
      }

      if (up === 'DEFAULT' && nextUp === 'SCHEMA') {
        recordClause(tok, 'DEFAULT SCHEMA', 'DEFAULT SCHEMA', true);
        i += 2;
        if (isSimpleIdOrIdent(codeTokens[i]) && !isFunctionHeaderBoundary(codeTokens, i)) {
          i++;
        }
        continue;
      }

      if (up === 'READS' && nextUp === 'SQL' && thirdUp === 'DATA') {
        if (isFunction) {
          emitDiag(
            tok,
            'HANA-SYN-028',
            `'READS SQL DATA' is not allowed in a FUNCTION header; functions are inherently read-only.`
          );
        } else {
          recordClause(tok, 'READS SQL DATA', 'READS SQL DATA', true);
        }
        hasReadsSqlData = true;
        i += 3;
        continue;
      }

      if (up === 'DETERMINISTIC') {
        recordClause(tok, 'DETERMINISTIC', 'DETERMINISTIC', true);
        hasDeterministic = true;
        i++;
        continue;
      }

      if (up === 'WITH' && nextUp === 'ENCRYPTION') {
        recordClause(tok, 'WITH ENCRYPTION', 'WITH ENCRYPTION', true);
        i += 2;
        continue;
      }

      if (up === 'AUTOCOMMIT' && nextUp === 'DDL') {
        if (isFunction) {
          emitDiag(tok, 'HANA-SYN-028', `'AUTOCOMMIT DDL' is not allowed in a FUNCTION header.`);
        } else {
          recordClause(tok, 'AUTOCOMMIT DDL', 'AUTOCOMMIT DDL', true);
          hasAutocommitDdl = true;
          autocommitTok = tok;
        }
        i += 2;
        if (wordUpper(codeTokens[i]) === 'ON' || wordUpper(codeTokens[i]) === 'OFF') i++;
        continue;
      }

      if ((up === 'STRUCTURED' && nextUp === 'FILTER' && thirdUp === 'CHECK') || (up === 'NO' && nextUp === 'STRUCTURED' && thirdUp === 'FILTER')) {
        const isNo = up === 'NO';
        if (isProcedure) {
          emitDiag(tok, 'HANA-SYN-028', `'STRUCTURED FILTER CHECK' is only supported in FUNCTION headers.`);
        } else {
          recordClause(tok, 'STRUCTURED FILTER CHECK', 'STRUCTURED FILTER CHECK', true);
        }
        i += isNo ? 4 : 3;
        continue;
      }

      if ((up === 'SEQUENTIAL' || up === 'PARALLEL') && nextUp === 'EXECUTION') {
        emitDiag(
          tok,
          'HANA-SYN-028',
          `'${up} EXECUTION' must appear immediately after 'BEGIN' (or branch keyword), not in the routine header.`
        );
        i += 2;
        continue;
      }

      if (up === 'AUTONOMOUS' && nextUp === 'TRANSACTION') {
        emitDiag(
          tok,
          'HANA-SYN-028',
          `'AUTONOMOUS TRANSACTION' must appear immediately after 'BEGIN', not in the routine header.`
        );
        i += 2;
        continue;
      }

      if (up === 'HEADER' && nextUp === 'ONLY') {
        isHeaderOnly = true;
        i += 2;
        if (wordUpper(codeTokens[i]) === 'ON' && wordUpper(codeTokens[i + 1]) === 'INVALID') i += 2;
        continue;
      }

      // VIRTUAL / XSC additional header options (`CONFIGURATION ... AT ...`, `WITH RESULT VIEW ...`, `VARIABLE CACHE ...`)
      if (tok.text === '(') {
        const closeIdx = findMatchingParen(codeTokens, i);
        i = closeIdx >= 0 ? closeIdx + 1 : i + 1;
        continue;
      }

      if (isVirtual || isHeaderOnly || up === 'CONFIGURATION' || up === 'VARIABLE' || up === 'WITH') {
        i++;
        continue;
      }

      i++;
    }

    finalizeHeaderChecks();
    return { handled: true, nextIdx: i };
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
    inHandler: boolean
  ): void => {
    scopeStack.push({
      kind,
      parenDepth,
      isRoutineRoot,
      inLoop,
      inHandler,
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
      while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].kind === 'single_handler' && parenDepth === scopeStack[scopeStack.length - 1].parenDepth && caseDepth === 0) {
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
              if (scopeStack[s].kind === 'begin' || scopeStack[s].kind === 'handler_begin' || scopeStack[s].kind === 'library_root') {
                return -1;
              }
            }
            return -1;
          })();
          if (idxMatch >= 0) {
            scopeStack.length = idxMatch;
          }
          if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].kind === 'single_handler' && codeTokens[i + 2]?.text !== ';') {
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
          if (scopeStack.length > 0) {
            scopeStack.pop();
          }
          atStmtStart = false;
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
      }
      atStmtStart = false;
      i++;
      continue;
    }

    // 4. Inside `.hdblibrary` root block: parse member PROCEDURE / FUNCTION / VARIABLE
    if (topScope.kind === 'library_root') {
      if (atStmtStart) {
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
    if (((up === 'SEQUENTIAL' || up === 'PARALLEL') && nextUp === 'EXECUTION') || (up === 'AUTONOMOUS' && nextUp === 'TRANSACTION')) {
      const modName = up === 'AUTONOMOUS' ? 'AUTONOMOUS TRANSACTION' : `${up} EXECUTION`;
      const isBeginKind = topScope.kind === 'begin' || topScope.kind === 'handler_begin';
      if (topScope.phase === BlockPhase.START) {
        if (!isBeginKind && up !== 'SEQUENTIAL') {
          emitDiag(tok, 'HANA-SYN-028', `'${modName}' is only valid on a 'BEGIN' block.`);
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
        up === 'READS'
          ? 'READS SQL DATA'
          : up === 'LANGUAGE'
            ? 'LANGUAGE'
            : `${up} ${nextUp}`;
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
          pushScope('handler_begin', false, topScope.routine, false, true);
          i = bodyIdx + 1;
          atStmtStart = true;
        } else {
          pushScope('single_handler', false, topScope.routine, false, true);
          i = bodyIdx;
          atStmtStart = true;
        }
        continue;
      }

      // Variable / Table / Array / Cursor / Condition declaration
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

    // Terminator keywords (`RETURN`, `SIGNAL`, `RESIGNAL`, `BREAK`, `CONTINUE`)
    if (
      TERMINATOR_KEYWORDS.has(up) &&
      nextTok?.text !== '=' &&
      nextTok?.text !== ':=' &&
      nextTok?.text !== '.'
    ) {
      topScope.terminated = true;
      topScope.terminatedBy = up;
      atStmtStart = false;
      i++;
      continue;
    }

    // Nested compound blocks (`BEGIN`, `IF`, `WHILE`, `FOR`, `LOOP`)
    if (up === 'BEGIN') {
      pushScope('begin', false, topScope.routine, topScope.inLoop, topScope.inHandler);
      atStmtStart = true;
      i++;
      continue;
    }
    if (up === 'IF') {
      const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'THEN');
      pushScope('if', false, topScope.routine, topScope.inLoop, topScope.inHandler);
      atStmtStart = true;
      i = nextIdx;
      continue;
    }
    if (up === 'WHILE') {
      const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'DO');
      pushScope('while', false, topScope.routine, true, topScope.inHandler);
      atStmtStart = true;
      i = nextIdx;
      continue;
    }
    if (up === 'FOR') {
      const { nextIdx } = scanUntilClauseKeyword(codeTokens, i + 1, 'DO');
      pushScope('for', false, topScope.routine, true, topScope.inHandler);
      atStmtStart = true;
      i = nextIdx;
      continue;
    }
    if (up === 'LOOP') {
      pushScope('loop', false, topScope.routine, true, topScope.inHandler);
      atStmtStart = true;
      i++;
      continue;
    }

    atStmtStart = false;
    i++;
  }
}
