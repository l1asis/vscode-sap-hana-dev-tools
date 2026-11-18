import { type Token } from '../formatter/tokenizer';
import { type AnalyzerDiagnostic } from './types';
import {
  SELECT_PRIVILEGE_PREV,
  SET_OPERATORS,
  STMT_CONTINUATION_PREV,
  STMT_EXIT_WORDS,
} from './keyword-sets';

export interface SqlSelectOrderOptions {
  readonly codeTokens: readonly Token[];
  readonly baseOffset: number;
  readonly lineStarts: readonly number[];
  readonly brokenQidentLines: ReadonlySet<number>;
  readonly unclosedStarts: ReadonlyMap<number, number | undefined>;
  readonly unmatchedCloseStarts: ReadonlySet<number>;
  readonly diagnostics: AnalyzerDiagnostic[];
}

const enum SelectStage {
  SELECT = 0,
  FROM = 2,
  WHERE = 3,
  GROUP_BY = 4,
  HAVING = 5,
  WINDOW = 6,
  ORDER_BY = 7,
  LIMIT = 8,
  OFFSET = 9,
  FOR_TAIL = 10,
  INTO_POST = 11,
  WITH_HINT = 12,
}

interface SelectQueryFrame {
  readonly parenDepth: number;
  readonly bracketDepth: number;
  readonly startedInForHeader: boolean;
  caseDepth: number;
  sawFrom: boolean;
  flaggedMissingFrom: boolean;
  sawWhere: boolean;
  sawGroupBy: boolean;
  sawHaving: boolean;
  sawWindow: boolean;
  sawInto: boolean;
  sawOrderBy: boolean;
  sawLimit: boolean;
  sawOffset: boolean;
  sawForTail: boolean;
  sawWithHint: boolean;
  awaitingBranchSelect: boolean;
  highestStage: SelectStage;
  highestStageName: string;
}

export function findLineNumber(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}

function makeSelectFrame(
  parenDepth: number,
  bracketDepth: number,
  startedInForHeader: boolean
): SelectQueryFrame {
  return {
    parenDepth,
    bracketDepth,
    startedInForHeader,
    caseDepth: 0,
    sawFrom: false,
    flaggedMissingFrom: false,
    sawWhere: false,
    sawGroupBy: false,
    sawHaving: false,
    sawWindow: false,
    sawInto: false,
    sawOrderBy: false,
    sawLimit: false,
    sawOffset: false,
    sawForTail: false,
    sawWithHint: false,
    awaitingBranchSelect: false,
    highestStage: SelectStage.SELECT,
    highestStageName: 'SELECT',
  };
}

/**
 * Validates `SELECT` query clause ordering and detects duplicate non-repeatable clauses
 * per query nesting level (`HANA-SYN-027`).
 */
export function checkSqlSelectClauseOrder(opts: SqlSelectOrderOptions): void {
  const {
    codeTokens,
    baseOffset,
    lineStarts,
    brokenQidentLines,
    unclosedStarts,
    unmatchedCloseStarts,
    diagnostics,
  } = opts;

  const queryStack: SelectQueryFrame[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let skipTokens = 0;
  let inForLoopHeader = false;
  let inPrivilegeStmtAtRoot = false;

  const pushOrderErr = (tok: Token, message: string): void => {
    if (brokenQidentLines.has(findLineNumber(lineStarts, tok.start))) return;
    const absStart = baseOffset + tok.start;
    if (diagnostics.some((d) => d.ruleId === 'HANA-SYN-027' && d.start === absStart)) return;
    diagnostics.push({
      ruleId: 'HANA-SYN-027',
      category: 'syntax',
      severity: 'error',
      message,
      start: absStart,
      end: baseOffset + tok.end,
      fixes: [],
    });
  };

  const popAtCurrentDepth = (): void => {
    while (queryStack.length > 0) {
      const top = queryStack[queryStack.length - 1];
      if (top.parenDepth > parenDepth || (top.parenDepth === parenDepth && top.bracketDepth >= bracketDepth)) {
        queryStack.pop();
      } else {
        break;
      }
    }
  };

  const activeFrame = (): SelectQueryFrame | undefined => {
    const top = queryStack[queryStack.length - 1];
    if (!top) return undefined;
    return top.parenDepth === parenDepth && top.bracketDepth === bracketDepth ? top : undefined;
  };

  const checkPostFromClause = (
    frame: SelectQueryFrame,
    tok: Token,
    clauseName: string,
    stage: SelectStage,
    alreadySeen: boolean
  ): boolean => {
    if (alreadySeen) {
      pushOrderErr(tok, `Duplicate '${clauseName}' clause in SELECT query.`);
      return false;
    }
    if (!frame.sawFrom) {
      if (!frame.flaggedMissingFrom) {
        pushOrderErr(tok, `'${clauseName}' clause must appear after 'FROM' clause in SELECT query.`);
        frame.flaggedMissingFrom = true;
      }
      if (stage > frame.highestStage) {
        frame.highestStage = stage;
        frame.highestStageName = clauseName;
      }
      return true;
    }
    if (frame.highestStage > stage) {
      pushOrderErr(tok, `Unexpected '${clauseName}' clause after '${frame.highestStageName}' in SELECT query.`);
      return false;
    }
    frame.highestStage = stage;
    frame.highestStageName = clauseName;
    return true;
  };

  for (let i = 0; i < codeTokens.length; i++) {
    if (skipTokens > 0) {
      skipTokens--;
      continue;
    }

    const tok = codeTokens[i];
    const up = tok.type === 'word' ? tok.text.toUpperCase() : '';
    const prev = i > 0 ? codeTokens[i - 1] : null;
    const prevUp = prev?.type === 'word' ? prev.text.toUpperCase() : prev?.text ?? '';
    const next = i + 1 < codeTokens.length ? codeTokens[i + 1] : null;
    const nextUp = next?.type === 'word' ? next.text.toUpperCase() : next?.text ?? '';

    if (tok.text === ';') {
      queryStack.length = 0;
      parenDepth = 0;
      bracketDepth = 0;
      inForLoopHeader = false;
      inPrivilegeStmtAtRoot = false;
      continue;
    }

    if (tok.text === '[') {
      if (!unclosedStarts.has(tok.start)) bracketDepth++;
      continue;
    }
    if (tok.text === ']') {
      if (!unmatchedCloseStarts.has(tok.start)) {
        popAtCurrentDepth();
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
      continue;
    }
    if (tok.text === '(') {
      if (!unclosedStarts.has(tok.start)) parenDepth++;
      continue;
    }
    if (tok.text === ')') {
      if (!unmatchedCloseStarts.has(tok.start)) {
        popAtCurrentDepth();
        parenDepth = Math.max(0, parenDepth - 1);
      }
      continue;
    }

    if (bracketDepth > 0 || tok.type !== 'word') {
      // Detect statement-level assignment `<var> :=` terminating a prior unterminated query at root depth
      if (parenDepth === 0 && next?.text === ':=' && (tok.type === 'word' || tok.type === 'var')) {
        const cur = activeFrame();
        if (cur && cur.caseDepth === 0) queryStack.pop();
      }
      continue;
    }

    // Track privilege/policy statements (`GRANT`, `REVOKE`, `STRUCTURED PRIVILEGE`) at root parenDepth
    if (
      parenDepth === 0 &&
      ((up === 'GRANT' || up === 'REVOKE' || up === 'STRUCTURED' || up === 'AUDIT') ||
        (up === 'PRIVILEGE' && prevUp === 'STRUCTURED'))
    ) {
      inPrivilegeStmtAtRoot = true;
      continue;
    }
    if (parenDepth === 0 && inPrivilegeStmtAtRoot) continue;

    // Track `FOR ... DO` cursor header so `DO` cleanly closes `FOR r AS SELECT ... DO`
    if (parenDepth === 0 && up === 'FOR' && prevUp !== 'END' && prevUp !== 'HANDLER' && prev?.text !== '.' && nextUp !== 'EACH') {
      const top = activeFrame();
      if (!top) inForLoopHeader = true;
    } else if (up === 'BEGIN' && parenDepth === 0) {
      inForLoopHeader = false;
    }

    // Skip qualified object members (e.g. `t.from`, `t.order`, `alias:member`)
    if (prev?.text === '.' || prev?.text === ':') {
      continue;
    }

    // Track CASE ... END inside an active SELECT frame
    const frame = activeFrame();
    if (frame) {
      if (up === 'CASE' && prevUp !== 'END') {
        frame.caseDepth++;
        continue;
      }
      if (up === 'END') {
        const isQualifiedEnd = nextUp === 'IF' || nextUp === 'FOR' || nextUp === 'WHILE' || nextUp === 'LOOP' || nextUp === 'CASE';
        if (frame.caseDepth > 0 && !isQualifiedEnd) {
          frame.caseDepth--;
          continue;
        }
        queryStack.pop();
        continue;
      }
      if (frame.caseDepth > 0) {
        continue;
      }
      if (up === 'DO' && frame.startedInForHeader) {
        queryStack.pop();
        inForLoopHeader = false;
        continue;
      }
      if (up === 'THEN' && parenDepth === 0) {
        queryStack.pop();
        continue;
      }
      if (
        parenDepth === 0 &&
        tok.nlBefore > 0 &&
        frame.sawFrom &&
        prev &&
        prev.text !== ',' &&
        prev.type !== 'op' &&
        !STMT_CONTINUATION_PREV.has(prevUp) &&
        ((up !== 'FOR' && up !== 'IF' && up !== 'WHILE' && STMT_EXIT_WORDS.has(up)) ||
          (up === 'FOR' && prevUp === ';'))
      ) {
        if (up !== 'CONTINUE' && up !== 'BREAK' && !(up === 'UPDATE' && prevUp === 'FOR')) {
          queryStack.pop();
          inForLoopHeader = false;
        }
      }
    } else if (up === 'DO' && parenDepth === 0) {
      inForLoopHeader = false;
    }

    // Start / continue a SELECT query frame
    if (up === 'SELECT' && !SELECT_PRIVILEGE_PREV.has(prevUp) && !(prevUp === 'FOR' && nextUp === 'ON')) {
      const cur = activeFrame();
      if (cur && cur.awaitingBranchSelect) {
        cur.awaitingBranchSelect = false;
        cur.highestStage = SelectStage.SELECT;
        cur.highestStageName = 'SELECT';
      } else {
        if (cur) queryStack.pop();
        queryStack.push(makeSelectFrame(parenDepth, bracketDepth, inForLoopHeader));
      }
      inForLoopHeader = false;
      continue;
    }

    const cur = activeFrame();
    if (!cur || cur.caseDepth > 0) continue;

    // 1. `INTO` (either pre-FROM SQLScript SELECT ... INTO or post-subquery SQL SELECT ... FROM ... INTO)
    if (up === 'INTO' && prevUp !== 'AS') {
      if (cur.sawInto) {
        pushOrderErr(tok, "Duplicate 'INTO' clause in SELECT query.");
      } else if (cur.sawWithHint || cur.sawForTail) {
        pushOrderErr(tok, `Unexpected 'INTO' clause after '${cur.highestStageName}' in SELECT query.`);
      } else {
        cur.sawInto = true;
        if (cur.sawFrom) {
          cur.highestStage = SelectStage.INTO_POST;
          cur.highestStageName = 'INTO';
        }
      }
      continue;
    }

    // 2. `FROM` (excluding `IS [NOT] DISTINCT FROM` and temporal `FOR SYSTEM_TIME|APPLICATION_TIME FROM`)
    if (up === 'FROM' && prevUp !== 'AS') {
      if (prevUp === 'DISTINCT' || prevUp === 'SYSTEM_TIME' || prevUp === 'APPLICATION_TIME') {
        continue;
      }
      if (cur.sawFrom) {
        pushOrderErr(tok, "Duplicate 'FROM' clause in SELECT query.");
      } else {
        if (cur.highestStage >= SelectStage.WHERE && !cur.flaggedMissingFrom) {
          pushOrderErr(tok, `'FROM' clause must precede '${cur.highestStageName}' in SELECT query.`);
        }
        cur.sawFrom = true;
        if (cur.highestStage < SelectStage.FROM) {
          cur.highestStage = SelectStage.FROM;
          cur.highestStageName = 'FROM';
        }
      }
      continue;
    }

    // 3. `WHERE`
    if (up === 'WHERE' && prevUp !== 'AS') {
      if (checkPostFromClause(cur, tok, 'WHERE', SelectStage.WHERE, cur.sawWhere)) {
        cur.sawWhere = true;
      }
      continue;
    }

    // 4. `GROUP BY` (excluding `WITHIN GROUP (ORDER BY ...)` and `GROUP CLUSTER BY`)
    if (up === 'GROUP' && nextUp === 'BY' && prevUp !== 'WITHIN' && prevUp !== 'AS') {
      if (checkPostFromClause(cur, tok, 'GROUP BY', SelectStage.GROUP_BY, cur.sawGroupBy)) {
        cur.sawGroupBy = true;
      }
      skipTokens = 1;
      continue;
    }

    // 5. `HAVING`
    if (up === 'HAVING' && prevUp !== 'AS') {
      if (checkPostFromClause(cur, tok, 'HAVING', SelectStage.HAVING, cur.sawHaving)) {
        cur.sawHaving = true;
      }
      continue;
    }

    // 6. `WINDOW <name> AS (`
    if (
      up === 'WINDOW' &&
      prevUp !== 'AS' &&
      (next?.type === 'word' || next?.type === 'qident') &&
      codeTokens[i + 2]?.type === 'word' &&
      codeTokens[i + 2].text.toUpperCase() === 'AS' &&
      codeTokens[i + 3]?.text === '('
    ) {
      if (checkPostFromClause(cur, tok, 'WINDOW', SelectStage.WINDOW, cur.sawWindow)) {
        cur.sawWindow = true;
      }
      continue;
    }

    // 7. Set operators (`UNION`, `INTERSECT`, `EXCEPT`, `MINUS`)
    if (SET_OPERATORS.has(up) && prevUp !== 'AS' && !cur.awaitingBranchSelect) {
      if (cur.highestStage >= SelectStage.ORDER_BY) {
        pushOrderErr(
          tok,
          `'${up}' cannot follow '${cur.highestStageName}' at the same query level unless the preceding branch is wrapped in parentheses.`
        );
      }
      cur.sawFrom = false;
      cur.flaggedMissingFrom = false;
      cur.sawWhere = false;
      cur.sawGroupBy = false;
      cur.sawHaving = false;
      cur.sawWindow = false;
      cur.highestStage = SelectStage.SELECT;
      cur.highestStageName = up;
      cur.awaitingBranchSelect = true;
      if (nextUp === 'ALL' || nextUp === 'DISTINCT') {
        skipTokens = 1;
      }
      continue;
    }

    // 8. `ORDER BY` (excluding `OVER (... ORDER BY ...)` which is at a deeper parenDepth)
    if (up === 'ORDER' && nextUp === 'BY' && prevUp !== 'AS' && prevUp !== 'PARTITION') {
      if (checkPostFromClause(cur, tok, 'ORDER BY', SelectStage.ORDER_BY, cur.sawOrderBy)) {
        cur.sawOrderBy = true;
      }
      skipTokens = 1;
      continue;
    }

    // 9. `LIMIT`
    if (up === 'LIMIT' && prevUp !== 'AS') {
      if (checkPostFromClause(cur, tok, 'LIMIT', SelectStage.LIMIT, cur.sawLimit)) {
        cur.sawLimit = true;
      }
      continue;
    }

    // 10. `OFFSET <count>` (must follow `LIMIT`)
    if (
      up === 'OFFSET' &&
      prevUp !== 'AS' &&
      next &&
      (next.type === 'number' || next.type === 'var' || next.type === 'param' || next.text === '?')
    ) {
      if (cur.sawOffset) {
        pushOrderErr(tok, "Duplicate 'OFFSET' clause in SELECT query.");
      } else if (!cur.sawFrom) {
        if (!cur.flaggedMissingFrom) {
          pushOrderErr(tok, "'OFFSET' clause must appear after 'FROM' and 'LIMIT' clauses in SELECT query.");
          cur.flaggedMissingFrom = true;
        }
      } else if (!cur.sawLimit) {
        pushOrderErr(tok, "'OFFSET' clause must follow 'LIMIT' clause in SELECT query.");
      } else if (cur.highestStage > SelectStage.OFFSET) {
        pushOrderErr(tok, `Unexpected 'OFFSET' clause after '${cur.highestStageName}' in SELECT query.`);
      } else {
        cur.sawOffset = true;
        cur.highestStage = SelectStage.OFFSET;
        cur.highestStageName = 'OFFSET';
      }
      continue;
    }

    // 11. `FOR UPDATE | FOR SHARE LOCK | FOR XML | FOR JSON`
    if (
      up === 'FOR' &&
      prevUp !== 'AS' &&
      (nextUp === 'UPDATE' ||
        (nextUp === 'SHARE' && codeTokens[i + 2]?.text.toUpperCase() === 'LOCK') ||
        nextUp === 'XML' ||
        nextUp === 'JSON')
    ) {
      const label = nextUp === 'SHARE' ? 'FOR SHARE LOCK' : `FOR ${nextUp}`;
      if (checkPostFromClause(cur, tok, label, SelectStage.FOR_TAIL, cur.sawForTail)) {
        cur.sawForTail = true;
      }
      skipTokens = nextUp === 'SHARE' ? 2 : 1;
      continue;
    }

    // 12. `WITH HINT`
    if (up === 'WITH' && nextUp === 'HINT') {
      if (checkPostFromClause(cur, tok, 'WITH HINT', SelectStage.WITH_HINT, cur.sawWithHint)) {
        cur.sawWithHint = true;
      }
      skipTokens = 1;
      continue;
    }
  }
}
