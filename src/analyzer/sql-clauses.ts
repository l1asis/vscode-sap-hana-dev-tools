/**
 * Consuming clause and Pratt expression parsers for core SQL / SQLScript statements (`HANA-SYN-042`)
 * `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`.
 *
 * Plugged into the statement walker (`sql-statements.ts`) as {@link StatementWalkerHooks}: the walker owns
 * statement extents, and these parsers validate the tokens of one statement `[start, end)`.
 *
 * Covered statements: queries (`SELECT`, `WITH ... SELECT`, `( query )`, set operations), `INSERT`, `UPDATE`,
 * `UPSERT` / `REPLACE`, `DELETE`, SQLScript `DECLARE` (variables / cursors), `RETURN`, assignments, `CALL`,
 * `SIGNAL` / `RESIGNAL`, `IF` / `ELSEIF` / `WHILE` conditions, HDI / catalog `VIEW` and `SEQUENCE` DDL, table DDL
 * (`[<table_type>] TABLE`, `TYPE ... AS TABLE`, `ALTER TABLE ... ADD | ALTER | DROP`, index / statistics / graph workspace
 * column lists, `PARTITION BY` column lists, window specifications: `sql-sqlscript.md` §4.12), the headerless `[HDI]`
 * `[CLOUD]` `STRUCTURED FILTER` and `REMOTE TABLE REPLICA` productions (`sql-sqlscript.md` §4.11), plus the clause lists
 * of the `HIERARCHY*( ... )` table functions (`sql-sqlscript.md` §4.5).
 * Every other statement is left to the lexical (#25), header (#26) and starter (#27) checks.
 *
 * Error policy (zero false positives on valid long-tail SQL):
 * - Diagnostics are only raised at a **clause boundary**: once a clause (select item, `FROM` item, condition,
 *   `ORDER BY` item, ...) has been consumed, the next token must belong to the clause's follow-set.
 *   A word that is a typo of a follow-set keyword is reported as `HANA-SYN-021` (with QuickFix); a plain
 *   identifier, literal, or punctuation is reported as `HANA-SYN-042`; any other **keyword** (`KEYWORDS`
 *   catalog) silently ends validation of the statement, since it may start a clause that is not modelled.
 * - Anything the parsers do not understand (unknown operand syntax, special-syntax function arguments such as
 *   `CAST(x AS INT)` or `EXTRACT(YEAR FROM d)`, JSON object literals, ...) silently ends validation.
 * - Nothing is reported for a statement that already carries any diagnostic.
 * - Exception: a hierarchy call's clause list **recovers** after an error (repairs the typo, or skips to the next
 *   clause keyword), so all of its errors are reported, even in a statement with other diagnostics, except at a
 *   token that already carries one.
 */
import { KEYWORDS, RESERVED, TYPES } from '../formatter/keywords';
import { type Token } from '../formatter/tokenizer';
import { type StatementScope, type StatementWalkerHooks } from './sql-statements';
import { matchKeywordTypo, suggestOptionKeyword, suggestSlotKeyword } from './typo';
import {
  BLOCK_STOPS,
  COLUMN_ATTRIBUTE_STARTERS,
  FOLLOW_HIDDEN,
  GRAPH_WORKSPACE_CLAUSES,
  HIERARCHY_CLAUSE_FUNCTIONS,
  HIERARCHY_CLAUSE_STARTERS,
  INTERVAL_UNITS,
  JOIN_STARTERS,
  NON_ALIAS,
  QUERY_CLAUSES,
  RESERVED_OPERANDS,
  STRUCTURED_FILTER_CLAUSES,
  TABLE_CONSTRAINT_STARTERS,
  TYPED_LITERAL_WORDS,
} from './keyword-sets';

export interface ClauseIssue {
  readonly ruleId: 'HANA-SYN-021' | 'HANA-SYN-023' | 'HANA-SYN-025' | 'HANA-SYN-042';
  readonly tokIdx: number;
  /** Last token of the span when it covers more than `tokIdx` (`NOT LIKE`). */
  readonly endTokIdx?: number;
  readonly message: string;
  readonly replaceWith?: string;
  /** `HANA-SYN-023`: QuickFix inserts `,` after this token. */
  readonly insertCommaAfter?: number;
  /** Valid SQL that most likely hides a mistake; a second QuickFix inserts `AS ` before `tokIdx`. */
  readonly likelyAlias?: boolean;
  /** QuickFix: insert `text` right after token `afterTok` (`Insert 'IMMEDIATE'`). */
  readonly insert?: { readonly afterTok: number; readonly text: string };
}

/**
 * A consumed `EXEC` / `EXECUTE IMMEDIATE` statement, for the binding and static-literal checks that need the
 * document text (`HANA-SYN-043`, `syntax.ts`). Token indices refer to the hooks' token array.
 */
export interface ExecStatement {
  readonly kwIdx: number;
  /** The SQL expression when it is a single string literal (`EXEC 'SELECT ...'`), else `-1`. */
  readonly literalIdx: number;
  /** First token of each `INTO` target. */
  readonly into: readonly number[];
  /** `[start, end)` token ranges of the `USING` expressions, or `null` without `USING`. */
  readonly using: ReadonlyArray<readonly [number, number]> | null;
  readonly usingIdx: number;
}

/** Silent abort: the statement uses syntax that is not modelled. */
class Bail {
  readonly bail = true;
}

/** Definite clause-boundary error. */
class Stop {
  constructor(readonly issue: ClauseIssue) {}
}

const BAIL = new Bail();

const COMPARISON_OPS = new Set<string>(['=', '<>', '!=', '<', '>', '<=', '>=']);

/**
 * Creates the walker hooks that run the clause parsers. `report` receives one issue per statement;
 * `hasDiagnosticIn` tells whether a token range already carries a diagnostic.
 */
export function createClauseHooks(
  T: readonly Token[],
  report: (issue: ClauseIssue) => void,
  hasDiagnosticIn: (start: number, end: number) => boolean,
  onExec?: (stmt: ExecStatement) => void
): StatementWalkerHooks {
  let lim = 0;
  let i = 0;
  /** Recovered hierarchy-call issues of the current statement (reported even when parsing stops later). */
  let soft: ClauseIssue[] = [];

  // ---- token helpers ----------------------------------------------------------------------------------------
  const tok = (k: number): Token | undefined => (k < lim ? T[k] : undefined);
  const up = (k: number): string => {
    const t = tok(k);
    return t && t.type === 'word' ? t.text.toUpperCase() : '';
  };
  const tx = (k: number): string => tok(k)?.text ?? '';
  const isWord = (k: number, w: string): boolean => up(k) === w;
  const atEnd = (): boolean => i >= lim;

  const eat = (w: string): boolean => {
    if (isWord(i, w) || (tok(i)?.type !== 'word' && tx(i) === w)) {
      i++;
      return true;
    }
    return false;
  };
  const expect = (w: string): void => {
    if (!eat(w)) throw BAIL;
  };

  /** Skips a balanced `(` ... `)` / `[` ... `]` group starting at `i`. */
  const skipGroup = (): void => {
    const open = tx(i);
    const close = open === '(' ? ')' : ']';
    let depth = 0;
    for (; i < lim; i++) {
      if (tx(i) === open) depth++;
      else if (tx(i) === close && --depth === 0) {
        i++;
        return;
      }
    }
    throw BAIL;
  };

  const isNameTok = (k: number): boolean => {
    const t = tok(k);
    if (!t) return false;
    if (t.type === 'qident') return true;
    return t.type === 'word' && !RESERVED.has(t.text.toUpperCase());
  };

  // ---- boundary check ---------------------------------------------------------------------------------------
  /**
   * Requires `tok(i)` to be in `follow` (words or punctuation), the statement end, or `)` when `allowClose`.
   * Typos of follow words -> HANA-SYN-021; non-keyword tokens -> HANA-SYN-042; other keywords -> silent bail.
   */
  const boundary = (follow: readonly string[], context: string, allowClose: boolean): void => {
    if (atEnd()) return;
    const t = tok(i);
    if (!t) return;
    const w = up(i);
    if (t.type === 'word' ? follow.includes(w) : follow.includes(t.text)) return;
    if (allowClose && t.text === ')') return;
    if (t.type === 'word') {
      const fix = suggestSlotKeyword(t.text, follow.filter((f) => /^[A-Z_]+$/.test(f)));
      if (fix) {
        throw new Stop({
          ruleId: 'HANA-SYN-021',
          tokIdx: i,
          message: `Unknown keyword '${t.text}' after ${context}. Did you mean '${fix}'?`,
          replaceWith: fix,
        });
      }
      if (KEYWORDS.has(w) || RESERVED.has(w)) throw BAIL;
    }
    if (t.type === 'other' || t.type === 'raw') throw BAIL;
    const shownList = follow.filter((f) => !FOLLOW_HIDDEN.has(f));
    const shown = shownList.slice(0, 10).map((f) => `'${f}'`).join(', ');
    throw new Stop({
      ruleId: 'HANA-SYN-042',
      tokIdx: i,
      message: `Unexpected '${t.text}' after ${context}; expected ${shown}${shownList.length > 10 ? ', ...' : ''}.`,
    });
  };

  /**
   * Optional `[AS] alias`. An implicit alias candidate that is a typo of a `follow` keyword and is not itself
   * followed by a valid boundary is reported as a typo (`SELECT a FROMM t`, `FROM t WHEREE x = 1`).
   */
  const alias = (follow: readonly string[], context: string, allowColumnList: boolean): string | null => {
    if (eat('AS')) {
      const t = tok(i);
      if (!t || (t.type !== 'word' && t.type !== 'qident' && t.type !== 'string')) throw BAIL;
      i++;
      if (allowColumnList && tx(i) === '(') skipGroup();
      return t.text;
    }
    const t = tok(i);
    if (!t) return null;
    if (t.type === 'qident' || (t.type === 'word' && !RESERVED.has(up(i)) && !NON_ALIAS.has(up(i)))) {
      const n = tok(i + 1);
      const nextOk =
        !n ||
        (n.type === 'word' ? follow.includes(n.text.toUpperCase()) || NON_ALIAS.has(n.text.toUpperCase()) : follow.includes(n.text) || n.text === ')');
      if (!nextOk && t.type === 'word') {
        const fix = matchKeywordTypo(t.text, follow.filter((f) => /^[A-Z_]+$/.test(f) && f.length >= 4));
        if (fix) {
          throw new Stop({
            ruleId: 'HANA-SYN-021',
            tokIdx: i,
            message: `Unknown keyword '${t.text}' after ${context}. Did you mean '${fix}'?`,
            replaceWith: fix,
          });
        }
      }
      i++;
      if (allowColumnList && tx(i) === '(') skipGroup();
      return t.text;
    }
    return null;
  };

  // ---- expressions (Pratt) ------------------------------------------------------------------------------------
  /** Parses a comma-separated function argument list leniently: any failure skips the group silently. */
  const callArgs = (): void => {
    const open = i;
    try {
      i++;
      if (eat(')')) return;
      for (;;) {
        if (tx(i) === '*' && (tx(i + 1) === ')' || tx(i + 1) === ',')) i++;
        else {
          eat('DISTINCT') || eat('ALL');
          expr(0);
          if (tx(i) === '=>') {
            i++;
            expr(0);
          }
        }
        if (eat(',')) continue;
        if (eat(')')) return;
        throw BAIL;
      }
    } catch (e) {
      if (e instanceof Stop) throw e;
      i = open;
      skipGroup();
    }
  };

  /** Postfix chain after a primary: `.name`, `.method(...)`, `[index]`, window / aggregate modifiers. */
  const postfix = (): void => {
    for (;;) {
      if (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) {
        i += 2;
        if (tx(i) === '(') callArgs();
      } else if (tx(i) === '.' && tx(i + 1) === '*') {
        i += 2;
        return;
      } else if (tx(i) === '[') {
        skipGroup();
      } else if (isWord(i, 'OVER') && tx(i + 1) === '(') {
        i++;
        windowSpec();
      } else if (isWord(i, 'WITHIN') && isWord(i + 1, 'GROUP') && tx(i + 2) === '(') {
        i += 2;
        skipGroup();
      } else if (isWord(i, 'FILTER') && tx(i + 1) === '(') {
        i++;
        skipGroup();
      } else {
        return;
      }
    }
  };

  const primary = (): void => {
    const t = tok(i);
    if (!t) throw BAIL;
    switch (t.type) {
      case 'number':
      case 'string':
      case 'param':
      case 'sysvar':
        i++;
        return;
      case 'var':
        i++;
        postfix();
        return;
      case 'qident':
        i++;
        if (tx(i) === '(') callArgs();
        postfix();
        return;
      case 'op':
        if (t.text === '-' || t.text === '+') {
          i++;
          expr(8);
          return;
        }
        throw BAIL;
      case 'punct':
        if (t.text === '(') {
          if (isWord(i + 1, 'SELECT') || isWord(i + 1, 'WITH')) {
            i++;
            query(true);
            expect(')');
          } else {
            i++;
            expr(0);
            while (eat(',')) expr(0);
            expect(')');
          }
          postfix();
          return;
        }
        throw BAIL;
      case 'word':
        break;
      default:
        throw BAIL;
    }
    const w = up(i);
    if (w === 'CASE') {
      i++;
      if (!isWord(i, 'WHEN')) expr(0);
      if (!isWord(i, 'WHEN')) throw BAIL;
      while (eat('WHEN')) {
        expr(0);
        expect('THEN');
        expr(0);
      }
      if (eat('ELSE')) expr(0);
      expect('END');
      return;
    }
    if (w === 'NOT') {
      i++;
      expr(3);
      return;
    }
    if (w === 'EXISTS' && tx(i + 1) === '(') {
      i++;
      primary();
      return;
    }
    if (w === 'NEW' && tok(i + 1)?.type === 'word' && tx(i + 2) === '(') {
      i++;
      primary();
      return;
    }
    if (TYPED_LITERAL_WORDS.has(w) && tok(i + 1)?.type === 'string') {
      i += 2;
      return;
    }
    if (w === 'INTERVAL' && tok(i + 1)?.type === 'string') {
      i += 2;
      while (INTERVAL_UNITS.has(up(i))) i++;
      return;
    }
    if (tx(i + 1) === '(') {
      // Function call (reserved words such as LEFT / RIGHT / CHAR / CUBE / ROLLUP are functions here).
      if (NON_ALIAS.has(w) && w !== 'LEFT' && w !== 'RIGHT' && w !== 'REPLACE') throw BAIL;
      i++;
      callArgs();
      postfix();
      return;
    }
    if (RESERVED.has(w) && !RESERVED_OPERANDS.has(w)) throw BAIL;
    if (NON_ALIAS.has(w)) throw BAIL;
    i++;
    postfix();
  };

  /** Pratt loop: OR 1, AND 2, NOT 3, predicates / comparison 4, `||` 5, `+ -` 6, `* / %` 7, unary 8. */
  const expr = (minPrec: number): void => {
    primary();
    for (;;) {
      const t = tok(i);
      if (!t) return;
      const w = up(i);
      if (t.type === 'op') {
        let prec = 0;
        if (COMPARISON_OPS.has(t.text)) prec = 4;
        else if (t.text === '||') prec = 5;
        else if (t.text === '+' || t.text === '-') prec = 6;
        else if (t.text === '*' || t.text === '/' || t.text === '%') prec = 7;
        if (prec === 0 || prec <= minPrec) return;
        i++;
        if (prec === 4 && (isWord(i, 'ANY') || isWord(i, 'ALL') || isWord(i, 'SOME')) && tx(i + 1) === '(') {
          i++;
          primary();
          continue;
        }
        expr(prec);
        continue;
      }
      if (w === 'OR' || w === 'AND') {
        const prec = w === 'OR' ? 1 : 2;
        if (prec <= minPrec) return;
        i++;
        expr(prec);
        continue;
      }
      if (w === 'COLLATE' && tok(i + 1)?.type === 'word') {
        i += 2;
        continue;
      }
      if (4 <= minPrec) return;
      if (w === 'IS') {
        i++;
        eat('NOT');
        if (eat('NULL') || eat('TRUE') || eat('FALSE') || eat('UNKNOWN')) continue;
        if (eat('DISTINCT')) {
          expect('FROM');
          expr(4);
          continue;
        }
        throw BAIL;
      }
      let negated = false;
      if (w === 'NOT' && ['BETWEEN', 'IN', 'LIKE', 'LIKE_REGEXPR', 'MEMBER'].includes(up(i + 1))) {
        i++;
        negated = true;
      }
      const pw = up(i);
      if (pw === 'BETWEEN') {
        i++;
        expr(5);
        expect('AND');
        expr(5);
        continue;
      }
      if (pw === 'IN') {
        i++;
        if (tx(i) !== '(' && tok(i)?.type !== 'var') throw BAIL;
        primary();
        continue;
      }
      if (pw === 'LIKE' || pw === 'LIKE_REGEXPR') {
        i++;
        expr(5);
        if (eat('ESCAPE') || eat('FLAG')) expr(5);
        continue;
      }
      if (pw === 'MEMBER') {
        i++;
        expect('OF');
        expr(5);
        continue;
      }
      if (negated) throw BAIL;
      return;
    }
  };

  // ---- hierarchy functions (sql-sqlscript.md §4.5) ----------------------------------------------------------
  /** The token at `k` ends a hierarchy clause: a clause keyword, `)`, or the end of the statement. */
  const hierBoundaryAt = (k: number): boolean =>
    !tok(k) || tx(k) === ')' || (tok(k)?.type === 'word' && HIERARCHY_CLAUSE_STARTERS.has(up(k)));

  const typo = (k: number, fix: string, where: string): void => {
    soft.push({ ruleId: 'HANA-SYN-021', tokIdx: k, message: `Unknown keyword '${tx(k)}' ${where}. Did you mean '${fix}'?`, replaceWith: fix });
  };

  /**
   * Reports that `expected` is missing after the clause keyword at `kwIdx`: at the offending token, or at the
   * keyword when the clause just ends. Returns `false`, so the caller skips to the next clause keyword.
   */
  const hierExpected = (kwIdx: number, expected: string, where: string): boolean => {
    const kw = tx(kwIdx).toUpperCase();
    soft.push(
      hierBoundaryAt(i)
        ? { ruleId: 'HANA-SYN-042', tokIdx: kwIdx, message: `Missing ${expected} after '${kw}' ${where}.` }
        : { ruleId: 'HANA-SYN-042', tokIdx: i, message: `Unexpected '${tx(i)}' after '${kw}' ${where}; expected ${expected}.` }
    );
    return false;
  };

  /** Option word from `options`, exact or a repaired typo. A `required` slot holds nothing but `options`. */
  const hierOption = (options: readonly string[], required: boolean, where: string): string | null => {
    const t = tok(i);
    if (!t || t.type !== 'word') return null;
    const w = up(i);
    if (options.includes(w)) {
      i++;
      return w;
    }
    if (HIERARCHY_CLAUSE_STARTERS.has(w)) return null;
    // An optional slot may also be followed by the next clause, so the closest of both wins (`CACHE FORCEE`).
    const fix = suggestOptionKeyword(t.text, required ? options : [...options, ...HIERARCHY_CLAUSE_STARTERS]);
    if (!fix || !options.includes(fix)) return null;
    typo(i, fix, where);
    i++;
    return fix;
  };

  /**
   * `word`, or an operand in the same slot (`START WHERE <cond>` vs. `START <table>`, `DISTANCE FROM 1` vs.
   * `DISTANCE <expr>`). A typo of `word` counts only when the operand reading fails: `START WHEER x = 1` is a
   * typo, `START wheer` is a table.
   */
  const hierKeywordOrOperand = (word: string, operand: () => void, operandEnds: (k: number) => boolean, where: string): boolean => {
    if (isWord(i, word)) {
      i++;
      return true;
    }
    const t = tok(i);
    if (!t || t.type !== 'word' || HIERARCHY_CLAUSE_STARTERS.has(up(i))) return false;
    const fix = suggestSlotKeyword(t.text, [word]);
    if (!fix) return false;
    const save = i;
    const saveSoft = soft.length;
    let operandOk = false;
    try {
      operand();
      operandOk = operandEnds(i);
    } catch (e) {
      if (!(e instanceof Bail) && !(e instanceof Stop)) throw e;
    }
    i = save;
    soft.length = saveSoft;
    if (operandOk) return false;
    typo(i, fix, where);
    i++;
    return true;
  };

  /**
   * `[AS] alias` after a `SOURCE` / `START` / `JOIN` table. An implicit alias must be followed by a clause boundary
   * (or by `ON` after a `JOIN` table).
   */
  const hierAlias = (join: boolean): void => {
    if (eat('AS')) {
      if (!isNameTok(i)) throw BAIL;
      i++;
      return;
    }
    const t = tok(i);
    if (!t || !isNameTok(i) || !(hierBoundaryAt(i + 1) || (join && isWord(i + 1, 'ON')))) return;
    if (t.type === 'word' && (HIERARCHY_CLAUSE_STARTERS.has(up(i)) || suggestSlotKeyword(t.text, [...HIERARCHY_CLAUSE_STARTERS]))) return;
    i++;
  };

  /** `( <query> )` inside a hierarchy call. An error is recorded and the parentheses are skipped. */
  const hierSubquery = (): void => {
    const open = i;
    if (isWord(i + 1, 'SELECT') || isWord(i + 1, 'WITH') || tx(i + 1) === '(') {
      try {
        i++;
        query(true);
        expect(')');
        return;
      } catch (e) {
        if (e instanceof Stop) soft.push(e.issue);
        else if (!(e instanceof Bail)) throw e;
      }
      i = open;
    }
    skipGroup();
  };

  /** `<table_ref> | ( <query> ) | :var | <hierarchy_call>`, with an optional alias. */
  const hierTableExpr = (join = false): void => {
    const t = tok(i);
    if (!t) throw BAIL;
    if (t.text === '(') hierSubquery();
    else if (t.type === 'var') i++;
    else if (t.type === 'word' && HIERARCHY_CLAUSE_FUNCTIONS.has(up(i)) && tx(i + 1) === '(') hierarchyCall();
    else if (isNameTok(i)) {
      i++;
      while (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
      if (tx(i) === '(') callArgs();
    } else throw BAIL;
    hierAlias(join);
  };

  /** `( <name> {, <name>} )` of `LEVELS`. */
  const hierNameList = (kwIdx: number, where: string): boolean => {
    if (tx(i) !== '(') return hierExpected(kwIdx, "'('", where);
    const open = i;
    i++;
    for (;;) {
      if (isNameTok(i)) {
        i++;
        if (eat(',')) continue;
        if (eat(')')) return true;
      }
      soft.push({ ruleId: 'HANA-SYN-042', tokIdx: i, message: `Unexpected '${tx(i)}' in LEVELS list ${where}; expected a column name, ',' or ')'.` });
      i = open;
      skipGroup();
      return true;
    }
  };

  /** `( <aggregate>(...) [AS <alias>] {, ...} )` of `MEASURES`. */
  const hierMeasures = (kwIdx: number, where: string): boolean => {
    if (tx(i) !== '(') return hierExpected(kwIdx, "'('", where);
    const open = i;
    try {
      i++;
      for (;;) {
        expr(0);
        if (eat('AS')) {
          if (!isNameTok(i)) throw BAIL;
          i++;
        }
        if (eat(',')) continue;
        expect(')');
        return true;
      }
    } catch (e) {
      if (e instanceof Stop) soft.push(e.issue);
      else if (!(e instanceof Bail)) throw e;
    }
    i = open;
    skipGroup();
    return true;
  };

  /**
   * One clause after its keyword `w` (at `kwIdx`). Returns `false` after reporting a problem, so the caller skips
   * to the next clause keyword.
   */
  const hierClause = (w: string, kwIdx: number, where: string): boolean => {
    switch (w) {
      case 'SOURCE':
        hierTableExpr();
        return true;
      case 'START':
        if (hierKeywordOrOperand('WHERE', hierTableExpr, hierBoundaryAt, where)) expr(0);
        else hierTableExpr();
        return true;
      case 'WHERE':
        expr(0);
        return true;
      case 'JOIN':
        hierTableExpr(true);
        if (!hierOption(['ON'], true, where)) return hierExpected(kwIdx, "'ON'", where);
        expr(0);
        return true;
      case 'SIBLING':
        if (!hierOption(['ORDER'], true, where)) return hierExpected(kwIdx, "'ORDER BY'", where);
        if (!hierOption(['BY'], true, where)) return hierExpected(i - 1, "'BY'", where);
        for (;;) {
          expr(0);
          eat('ASC') || eat('DESC');
          if (eat('NULLS') && !eat('FIRST') && !eat('LAST')) throw BAIL;
          if (!eat(',')) return true;
        }
      case 'LEVELS':
        return hierNameList(kwIdx, where);
      case 'MEASURES':
        return hierMeasures(kwIdx, where);
      case 'VALID':
        if (eat('FROM')) {
          expr(5);
          eat('EXCLUDED');
          if (!hierOption(['UNTIL'], true, where)) return hierExpected(kwIdx, "'UNTIL'", where);
          expr(5);
          eat('EXCLUDED');
          return true;
        }
        if (eat('AT')) {
          expr(5);
          if (eat('FROM')) expect('EXCLUDED');
          if (eat('UNTIL')) expect('EXCLUDED');
          return true;
        }
        return hierExpected(kwIdx, "'FROM' or 'AT'", where);
      case 'DEPTH': {
        // `DEPTH <integer>`: a bare word (`DEPTH FIRST`) is never an integer.
        const t = tok(i);
        if (hierBoundaryAt(i) || (t?.type === 'word' && tx(i + 1) !== '(')) return hierExpected(kwIdx, 'an integer', where);
        expr(5);
        return true;
      }
      case 'MULTIPARENT':
        hierOption(['ERROR', 'LEAVES'], false, where);
        return true;
      case 'ORPHAN':
        return hierOption(['IGNORE', 'ERROR', 'ADOPT', 'ROOT'], true, where) ? true : hierExpected(kwIdx, "'IGNORE', 'ERROR', 'ADOPT' or 'ROOT'", where);
      case 'CYCLE':
        return hierOption(['BREAKUP', 'ERROR'], true, where) ? true : hierExpected(kwIdx, "'BREAKUP' or 'ERROR'", where);
      case 'CACHE':
        if (tok(i)?.type === 'string') i++;
        else hierOption(['FORCE'], false, where);
        return true;
      case 'NO':
        return hierOption(['CACHE'], true, where) ? true : hierExpected(kwIdx, "'CACHE'", where);
      case 'LOAD':
        if (tok(i)?.type === 'string') {
          i++;
          return true;
        }
        return hierOption(['BULK', 'INCREMENTAL'], true, where) ? true : hierExpected(kwIdx, "'BULK', 'INCREMENTAL' or a string", where);
      case 'RETAIN':
        if (!hierOption(['NULLS'], true, where)) return hierExpected(kwIdx, "'NULLS'", where);
        if (tok(i)?.type !== 'string') return hierExpected(i - 1, "a string ('none', 'not trailing' or 'all')", where);
        i++;
        return true;
      case 'DISTANCE': {
        let bound = false;
        if (hierKeywordOrOperand('FROM', () => expr(5), (k) => hierBoundaryAt(k) || isWord(k, 'TO'), where)) {
          expr(5);
          bound = true;
        }
        if (bound ? hierOption(['TO'], false, where) : hierKeywordOrOperand('TO', () => expr(5), hierBoundaryAt, where)) {
          expr(5);
          bound = true;
        }
        if (bound) return true;
        if (hierBoundaryAt(i)) return hierExpected(kwIdx, "'FROM', 'TO' or a distance", where);
        expr(5);
        return true;
      }
      case 'WITH': {
        const opt = hierOption(['SUBTOTAL', 'BALANCE', 'NOT', 'TOTAL'], true, where);
        if (!opt) return hierExpected(kwIdx, "'SUBTOTAL', 'BALANCE', 'NOT MATCHED' or 'TOTAL'", where);
        if (opt === 'NOT' && !hierOption(['MATCHED'], true, where)) return hierExpected(i - 1, "'MATCHED'", where);
        if (!hierBoundaryAt(i)) expr(0);
        return true;
      }
      default:
        throw BAIL;
    }
  };

  /**
   * `HIERARCHY*( <clause> { <clause> } )` (§4.5). Clauses are accepted in any order. After each clause the next
   * token must be a clause keyword or `)`. A typo is repaired; anything else is reported once and skipped up to the
   * next clause keyword.
   */
  const hierarchyCall = (): void => {
    const where = `in ${up(i)} call`;
    i += 2; // name (
    let recovering = false;
    let afterCond = false;
    for (;;) {
      if (atEnd()) throw BAIL;
      if (tx(i) === ')') {
        i++;
        return;
      }
      const kwIdx = i;
      const t = tok(i)!;
      let w: string | null = null;
      if (t.type === 'word') {
        const u = up(i);
        if (HIERARCHY_CLAUSE_STARTERS.has(u)) w = u;
        else {
          // After a condition, `ANDD` is more likely a typo of `AND` than of a clause keyword.
          const fix = suggestSlotKeyword(t.text, afterCond ? [...HIERARCHY_CLAUSE_STARTERS, 'AND', 'OR'] : [...HIERARCHY_CLAUSE_STARTERS]);
          if (fix) {
            typo(i, fix, where);
            w = fix;
          }
        }
      }
      if (!w) {
        if (!recovering) {
          if (t.type === 'word' && (KEYWORDS.has(up(i)) || RESERVED.has(up(i)))) throw BAIL; // a clause that is not modelled
          // `START WHERE a + DEPTH 2`: `DEPTH` was read as a column, but the operator is what is missing its operand.
          const kw = i - 1;
          if (tok(kw)?.type === 'word' && HIERARCHY_CLAUSE_STARTERS.has(up(kw)) && tok(kw - 1)?.type === 'op') {
            soft.push({ ruleId: 'HANA-SYN-042', tokIdx: kw - 1, message: `Missing operand after '${tx(kw - 1)}' before '${up(kw)}' ${where}.` });
            i = kw;
            continue;
          }
          soft.push({
            ruleId: 'HANA-SYN-042',
            tokIdx: i,
            message: `Unexpected '${t.text}' ${where}; expected a hierarchy clause ('SOURCE', 'START', 'SIBLING', ...) or ')'.`,
          });
          recovering = true;
        }
        if (t.text === '(' || t.text === '[') skipGroup();
        else i++;
        continue;
      }
      i++;
      recovering = false;
      if (w === 'AND' || w === 'OR') {
        expr(0);
        continue;
      }
      recovering = !hierClause(w, kwIdx, where);
      afterCond = !recovering && (w === 'START' || w === 'WHERE' || w === 'JOIN');
    }
  };

  // ---- queries ---------------------------------------------------------------------------------------------
  /** Follow-set at the end of a (sub)query term. */
  const queryFollow = (inParens: boolean): string[] => [
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'MINUS',
    'ORDER',
    'LIMIT',
    'OFFSET',
    'FOR',
    'WITH',
    'INTO',
    ...(inParens ? [] : [';', ...BLOCK_STOPS]),
  ];

  const selectListFollow = (inParens: boolean): string[] => [',', 'FROM', 'INTO', ...QUERY_CLAUSES.slice(2), ...queryFollow(inParens)];
  const fromFollow = (inParens: boolean): string[] => [',', ...JOIN_STARTERS, 'ON', 'USING', 'WHERE', 'GROUP', 'HAVING', 'WINDOW', ...queryFollow(inParens)];
  const condFollow = (extra: readonly string[], inParens: boolean): string[] => ['AND', 'OR', ...extra, ...queryFollow(inParens)];

  /**
   * `SELECT\n  "ID"\n  "NAME"`: a bare column reference whose implicit alias starts a new line is valid SQL, but far
   * more likely a missing comma. Reported as a warning with both fixes; the alias reading is kept for parsing.
   * Wrapped long items (`WIDTH_BUCKET(...)\n "Wages"`) are not bare column references and stay silent.
   */
  const newLineAlias = (itemStart: number): void => {
    const a = tok(i);
    if (!a || a.nlBefore === 0 || (a.type !== 'qident' && !(a.type === 'word' && isNameTok(i) && !NON_ALIAS.has(up(i))))) return;
    for (let k = itemStart; k < i; k++) {
      const t = tok(k)!;
      const nameAt = (k - itemStart) % 2 === 0;
      if (nameAt ? !(t.type === 'qident' || (t.type === 'word' && isNameTok(k))) : t.text !== '.') return;
    }
    if ((i - itemStart) % 2 === 0) return; // ends with `.`
    let column = '';
    for (let k = itemStart; k < i; k++) column += tx(k);
    soft.push({
      ruleId: 'HANA-SYN-023',
      tokIdx: i,
      message: `'${a.text}' on its own line reads as an alias of '${column}'. Add ',' if it is the next column, or 'AS' if it is an alias.`,
      insertCommaAfter: i - 1,
      likelyAlias: true,
    });
  };

  const intoTargets = (): void => {
    for (;;) {
      const t = tok(i);
      if (!t || (t.type !== 'word' && t.type !== 'qident' && t.type !== 'var')) throw BAIL;
      i++;
      postfix();
      if (!eat(',')) break;
    }
    if (eat('DEFAULT')) {
      expr(0);
      while (eat(',')) expr(0);
    }
  };

  const tableRef = (inParens: boolean): void => {
    const t = tok(i);
    if (!t) throw BAIL;
    if (t.text === '(') {
      if (isWord(i + 1, 'SELECT') || isWord(i + 1, 'WITH') || tx(i + 1) === '(') {
        i++;
        query(true);
        expect(')');
      } else {
        throw BAIL; // parenthesized join tree
      }
    } else if (t.type === 'word' && HIERARCHY_CLAUSE_FUNCTIONS.has(up(i)) && tx(i + 1) === '(') {
      hierarchyCall();
    } else if (t.type === 'var') {
      i++;
    } else if (isNameTok(i) || (t.type === 'word' && tx(i + 1) === '(')) {
      i++;
      while (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
      if (tok(i)?.type === 'sysvar' && !tok(i)?.wsBefore) i++;
      // Parameters, filters and association navigation: `"V"(5)[ID < 6]:"ASSOC"('EN').col`, `t2:a[y1 > 1]`
      for (;;) {
        if (tx(i) === '(') callArgs();
        else if (tx(i) === '[') skipGroup();
        else if (tok(i)?.type === 'var' && !tok(i)?.wsBefore) i++;
        else if (tx(i) === ':' && !tok(i)?.wsBefore && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
        else if (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
        else break;
      }
      if (isWord(i, 'WITH') && isWord(i + 1, 'ORDINALITY')) i += 2;
    } else {
      throw BAIL;
    }
    alias(fromFollow(inParens), `table reference '${t.text}'`, true);
  };

  const fromItem = (inParens: boolean): void => {
    tableRef(inParens);
    for (;;) {
      const w = up(i);
      if (!JOIN_STARTERS.includes(w)) return;
      eat('NATURAL');
      if (eat('INNER') || eat('CROSS')) {
        /* join type */
      } else if (eat('LEFT') || eat('RIGHT') || eat('FULL')) {
        eat('OUTER');
      }
      while (eat('MANY') || eat('ONE') || eat('EXACT') || eat('TO')) {
        /* join cardinality */
      }
      expect('JOIN');
      tableRef(inParens);
      if (eat('ON')) {
        expr(0);
        boundary(condFollow([',', ...JOIN_STARTERS, 'WHERE', 'GROUP', 'HAVING', 'WINDOW'], inParens), 'JOIN condition', inParens);
      } else if (eat('USING')) {
        if (tx(i) !== '(') throw BAIL;
        skipGroup();
      }
    }
  };

  const selectCore = (inParens: boolean): void => {
    expect('SELECT');
    if (eat('TOP')) expr(8);
    eat('DISTINCT') || eat('ALL');
    // select list
    for (;;) {
      if (tx(i) === '*') i++;
      else {
        const itemStart = i;
        expr(0);
        newLineAlias(itemStart);
        alias(selectListFollow(inParens), 'select item', false);
      }
      boundary(selectListFollow(inParens), 'select item', inParens);
      if (!eat(',')) break;
    }
    if (eat('INTO')) {
      intoTargets();
      boundary(['FROM', ...QUERY_CLAUSES.slice(2), ...queryFollow(inParens)], 'INTO target list', inParens);
    }
    if (eat('FROM')) {
      for (;;) {
        fromItem(inParens);
        boundary(fromFollow(inParens), 'FROM item', inParens);
        if (!eat(',')) break;
      }
    }
    if (eat('WHERE')) {
      expr(0);
      boundary(condFollow(['GROUP', 'HAVING', 'WINDOW'], inParens), 'WHERE condition', inParens);
    }
    if (isWord(i, 'GROUP')) {
      i++;
      expect('BY');
      for (;;) {
        if (isWord(i, 'GROUPING') && isWord(i + 1, 'SETS')) {
          if (tx(i + 2) !== '(') throw BAIL; // GROUPING SETS <options> (...): BEST, LIMIT, STRUCTURED RESULT, ...
          i += 2;
          skipGroup();
        } else {
          expr(0);
        }
        boundary([',', 'HAVING', 'WINDOW', ...queryFollow(inParens)], 'GROUP BY item', inParens);
        if (!eat(',')) break;
      }
    }
    if (eat('HAVING')) {
      expr(0);
      boundary(condFollow(['WINDOW'], inParens), 'HAVING condition', inParens);
    }
    if (isWord(i, 'WINDOW')) throw BAIL;
  };

  const queryTerm = (inParens: boolean): void => {
    if (tx(i) === '(') {
      i++;
      query(true);
      expect(')');
      return;
    }
    selectCore(inParens);
  };

  const query = (inParens: boolean): void => {
    if (eat('WITH')) {
      for (;;) {
        if (!isNameTok(i)) throw BAIL;
        i++;
        if (tx(i) === '(') skipGroup();
        expect('AS');
        if (tx(i) !== '(') throw BAIL;
        i++;
        query(true);
        expect(')');
        if (!eat(',')) break;
      }
    }
    queryTerm(inParens);
    for (;;) {
      if (eat('UNION') || eat('INTERSECT') || eat('EXCEPT') || eat('MINUS')) {
        eat('ALL') || eat('DISTINCT');
        queryTerm(inParens);
        continue;
      }
      break;
    }
    if (isWord(i, 'ORDER')) {
      i++;
      expect('BY');
      for (;;) {
        expr(0);
        eat('ASC') || eat('DESC');
        if (eat('NULLS')) {
          if (!eat('FIRST') && !eat('LAST')) throw BAIL;
        }
        boundary([',', 'ASC', 'DESC', 'NULLS', 'LIMIT', 'OFFSET', 'FOR', 'WITH', 'INTO', ...(inParens ? [] : [';', ...BLOCK_STOPS])], 'ORDER BY item', inParens);
        if (!eat(',')) break;
      }
    }
    if (eat('LIMIT')) {
      expr(5);
      if (eat('OFFSET')) expr(5);
      if (eat('TOTAL')) expect('ROWCOUNT');
      boundary(['FOR', 'WITH', 'INTO', ...(inParens ? [] : [';', ...BLOCK_STOPS])], 'LIMIT clause', inParens);
    }
    if (isWord(i, 'FOR') || isWord(i, 'INTO')) throw BAIL; // FOR UPDATE / SHARE LOCK / JSON / XML, post-query INTO
    if (isWord(i, 'WITH') && isWord(i + 1, 'HINT') && tx(i + 2) === '(') {
      i += 2;
      skipGroup();
    }
  };

  /** Requires the statement (or query) to end here. */
  const finish = (context: string): void => {
    boundary([';', ...BLOCK_STOPS], context, false);
  };

  // ---- statements --------------------------------------------------------------------------------------------
  const targetName = (): void => {
    const t = tok(i);
    if (!t) throw BAIL;
    if (t.type === 'var') {
      i++;
      return;
    }
    if (!isNameTok(i)) throw BAIL;
    i++;
    while (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
    if (tok(i)?.type === 'sysvar' && !tok(i)?.wsBefore) i++;
  };

  const rhs = (): void => {
    if (isWord(i, 'SELECT') || isWord(i, 'WITH')) query(false);
    else expr(0);
  };

  const statement = (scope: StatementScope): void => {
    const w = up(i);
    switch (w) {
      case 'WITH':
        // `WITH SQL STATISTICS INTO <row_var> DO <statement>` (collect_statistics_clause)
        if (isWord(i + 1, 'SQL') && isWord(i + 2, 'STATISTICS')) {
          i += 3;
          expect('INTO');
          targetName();
          expect('DO');
          statement(scope);
          return;
        }
        query(false);
        finish('query');
        return;
      case 'SELECT':
        query(false);
        finish('query');
        return;
      case 'EXEC':
      case 'EXECUTE':
        execStmt();
        return;
      case 'INSERT':
      case 'UPSERT':
      case 'REPLACE': {
        i++;
        if (w === 'INSERT') expect('INTO');
        else eat('INTO');
        targetName();
        if (tx(i) === '(' && !isWord(i + 1, 'SELECT') && !isWord(i + 1, 'WITH')) skipGroup();
        if (eat('VALUES')) {
          if (tx(i) !== '(') throw BAIL;
          primary();
          if (w !== 'INSERT') {
            if (eat('WHERE')) {
              expr(0);
              finish('WHERE condition');
            } else if (eat('WITH')) {
              expect('PRIMARY');
              expect('KEY');
              finish(`${w} statement`);
            }
          }
          finish(`${w} VALUES list`);
          return;
        }
        if (isWord(i, 'SELECT') || isWord(i, 'WITH') || tx(i) === '(') {
          query(false);
          finish('query');
          return;
        }
        throw BAIL;
      }
      case 'UPDATE': {
        i++;
        targetName();
        alias(['SET'], 'UPDATE target', false);
        expect('SET');
        for (;;) {
          if (tx(i) === '(') throw BAIL;
          targetName();
          expect('=');
          expr(0);
          boundary([',', 'FROM', 'WHERE', 'WITH', ';', ...BLOCK_STOPS], 'SET assignment', false);
          if (!eat(',')) break;
        }
        if (eat('FROM')) {
          for (;;) {
            fromItem(false);
            if (!eat(',')) break;
          }
        }
        if (eat('WHERE')) {
          expr(0);
          boundary(['AND', 'OR', 'WITH', ';', ...BLOCK_STOPS], 'WHERE condition', false);
        }
        if (isWord(i, 'WITH')) throw BAIL;
        finish('UPDATE statement');
        return;
      }
      case 'DELETE': {
        i++;
        eat('FROM');
        targetName();
        alias(['WHERE', 'WITH', ';', ...BLOCK_STOPS], 'DELETE target', false);
        if (eat('WHERE')) {
          expr(0);
          boundary(['AND', 'OR', 'WITH', ';', ...BLOCK_STOPS], 'WHERE condition', false);
        }
        if (isWord(i, 'WITH')) throw BAIL;
        finish('DELETE statement');
        return;
      }
      case 'RETURN':
        i++;
        if (atEnd()) return;
        rhs();
        finish('RETURN value');
        return;
      case 'CALL':
        i++;
        targetName();
        if (tx(i) === '(') callArgs();
        if (!atEnd()) throw BAIL; // WITH OVERVIEW, IN DEBUG MODE, ...
        return;
      case 'SIGNAL':
      case 'RESIGNAL':
        i++;
        if (isWord(i, 'SQL_ERROR_CODE')) {
          i++;
          expr(5);
        } else if (isNameTok(i)) {
          i++;
        }
        if (eat('SET')) {
          expect('MESSAGE_TEXT');
          expect('=');
          expr(0);
        }
        finish(`${w} statement`);
        return;
      case 'DECLARE':
        declare();
        return;
      case 'VIEW':
        view();
        return;
      case 'PROJECTION':
        i++;
        if (!isWord(i, 'VIEW')) throw BAIL;
        view();
        return;
      case 'TABLE':
      case 'COLUMN':
      case 'ROW':
      case 'HISTORY':
      case 'GLOBAL':
      case 'LOCAL':
        if (tableTypeAt(i) < 0) break;
        table();
        return;
      case 'TYPE':
        if (!isNameTok(i + 1)) break;
        tableType();
        return;
      case 'ALTER':
        if (!isWord(i + 1, 'TABLE')) break;
        alterTable();
        return;
      case 'UNIQUE':
      case 'BTREE':
      case 'CPBTREE':
      case 'INVERTED':
      case 'INDEX':
      case 'FULLTEXT':
      case 'FUZZY':
      case 'HASH':
      case 'BLOCK':
      case 'STATISTICS':
        if (indexNounAt(i) < 0) break;
        indexOrStatistics();
        return;
      case 'GRAPH':
        if (!isWord(i + 1, 'WORKSPACE')) break;
        graphWorkspace();
        return;
      case 'SEQUENCE':
        sequence();
        return;
      case 'STRUCTURED':
        if (!isWord(i + 1, 'FILTER')) throw BAIL;
        structuredFilter();
        return;
      case 'REMOTE':
        if (!isWord(i + 1, 'TABLE') || !isWord(i + 2, 'REPLICA')) throw BAIL;
        remoteTableReplica();
        return;
      case 'CREATE': {
        i++;
        if (eat('OR')) expect('REPLACE');
        const k = up(i);
        if (k === 'VIEW') view();
        else if (k === 'PROJECTION' && isWord(i + 1, 'VIEW')) {
          i++;
          view();
        } else if (k === 'SEQUENCE') sequence();
        else if (k === 'STRUCTURED' && isWord(i + 1, 'FILTER')) structuredFilter();
        else if (tableTypeAt(i) >= 0) table();
        else if (k === 'TYPE' && isNameTok(i + 1)) tableType();
        else if (indexNounAt(i) >= 0) indexOrStatistics();
        else if (k === 'GRAPH' && isWord(i + 1, 'WORKSPACE')) graphWorkspace();
        else throw BAIL;
        return;
      }
      default:
        break;
    }
    if (scope === 'block') {
      // Assignment `<target> (= | :=) <expr | query>`
      const t = tok(i);
      if (!t || (t.type !== 'word' && t.type !== 'qident' && t.type !== 'var')) throw BAIL;
      i++;
      for (;;) {
        if (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
        else if (tx(i) === '[') skipGroup();
        else break;
      }
      if (tx(i) !== '=' && tx(i) !== ':=') throw BAIL; // method calls, library calls, multi-target
      i++;
      rhs();
      finish('assignment');
      return;
    }
    throw BAIL;
  };

  /** Requires keyword `w` at `i` (a typo is `HANA-SYN-021`, anything else `HANA-SYN-042`). */
  const expectKeyword = (w: string, context: string): void => {
    if (eat(w)) return;
    const t = tok(i);
    const fix = t?.type === 'word' ? suggestSlotKeyword(t.text, [w]) : null;
    if (fix) throw new Stop({ ruleId: 'HANA-SYN-021', tokIdx: i, message: `Unknown keyword '${t!.text}' after ${context}. Did you mean '${fix}'?`, replaceWith: fix });
    throw new Stop(
      t
        ? { ruleId: 'HANA-SYN-042', tokIdx: i, message: `Unexpected '${t.text}' after ${context}; expected '${w}'.` }
        : { ruleId: 'HANA-SYN-042', tokIdx: i - 1, message: `Missing '${w}' after ${context}.` }
    );
  };

  /**
   * `(EXEC | EXECUTE IMMEDIATE) <expr> [INTO <var> {, <var>} [DEFAULT <expr> {, <expr>}]] [USING <expr> {, <expr>}]
   * [READS SQL DATA]` (SQLScript Reference, 8.10 Dynamic SQL). The clause order is fixed.
   */
  const execStmt = (): void => {
    const kwIdx = i;
    let label = 'EXEC';
    if (isWord(i, 'EXECUTE')) {
      i++;
      label = 'EXECUTE IMMEDIATE';
      if (!eat('IMMEDIATE')) {
        const t = tok(i);
        const fix = t?.type === 'word' ? suggestSlotKeyword(t.text, ['IMMEDIATE']) : null;
        if (fix) throw new Stop({ ruleId: 'HANA-SYN-021', tokIdx: i, message: `Unknown keyword '${t!.text}' after 'EXECUTE'. Did you mean '${fix}'?`, replaceWith: fix });
        if (!t || t.type === 'string' || t.type === 'var' || t.text === '(') {
          throw new Stop({
            ruleId: 'HANA-SYN-042',
            tokIdx: kwIdx,
            message: "Dynamic SQL needs 'EXECUTE IMMEDIATE' (or 'EXEC'); 'EXECUTE' alone is not a SQLScript statement.",
            insert: { afterTok: kwIdx, text: ' IMMEDIATE' },
          });
        }
        throw BAIL;
      }
    } else {
      i++;
    }
    if (atEnd()) throw new Stop({ ruleId: 'HANA-SYN-042', tokIdx: i - 1, message: `Missing the SQL string after '${label}'.` });
    const exprStart = i;
    expr(0);
    const literalIdx = i === exprStart + 1 && tok(exprStart)?.type === 'string' ? exprStart : -1;

    const into: number[] = [];
    let using: Array<readonly [number, number]> | null = null;
    let usingIdx = -1;
    let reads = false;
    const clauseStop = (message: string): never => {
      throw new Stop({ ruleId: 'HANA-SYN-042', tokIdx: i, message });
    };
    for (;;) {
      const w = up(i);
      if (w === 'INTO') {
        if (into.length) clauseStop(`Duplicate 'INTO' clause in ${label} statement.`);
        if (using || reads) clauseStop(`'INTO' must come before ${using ? "'USING'" : "'READS SQL DATA'"} in ${label} statement.`);
        i++;
        for (;;) {
          const t = tok(i);
          if (!t || !(t.type === 'qident' || t.type === 'var' || isNameTok(i))) {
            throw new Stop(
              t ? { ruleId: 'HANA-SYN-042', tokIdx: i, message: `Unexpected '${t.text}' after 'INTO'; expected a variable.` } : { ruleId: 'HANA-SYN-042', tokIdx: i - 1, message: "Missing variable after 'INTO'." }
            );
          }
          into.push(i);
          i++;
          if (tx(i) === '[') skipGroup();
          if (!eat(',')) break;
        }
        if (isWord(i, 'DEFAULT')) {
          const defIdx = i;
          i++;
          let n = 0;
          for (;;) {
            if (atEnd() || tx(i) === ';') throw new Stop({ ruleId: 'HANA-SYN-042', tokIdx: i - 1, message: "Missing value after 'DEFAULT'." });
            expr(0);
            n++;
            if (!eat(',')) break;
          }
          if (n !== into.length) {
            throw new Stop({
              ruleId: 'HANA-SYN-042',
              tokIdx: defIdx,
              message: `'DEFAULT' lists ${n} value${n === 1 ? '' : 's'} for ${into.length} 'INTO' variable${into.length === 1 ? '' : 's'}.`,
            });
          }
        }
        continue;
      }
      if (w === 'DEFAULT') clauseStop(`'DEFAULT' needs a preceding 'INTO' variable list in ${label} statement.`);
      if (w === 'USING') {
        if (using) clauseStop(`Duplicate 'USING' clause in ${label} statement.`);
        if (reads) clauseStop(`'USING' must come before 'READS SQL DATA' in ${label} statement.`);
        usingIdx = i;
        i++;
        using = [];
        for (;;) {
          if (atEnd() || tx(i) === ';') throw new Stop({ ruleId: 'HANA-SYN-042', tokIdx: i - 1, message: "Missing expression after 'USING'." });
          const s = i;
          expr(0);
          using.push([s, i]);
          if (!eat(',')) break;
        }
        continue;
      }
      if (w === 'READS') {
        if (reads) clauseStop(`Duplicate 'READS SQL DATA' in ${label} statement.`);
        i++;
        expectKeyword('SQL', "'READS'");
        expectKeyword('DATA', "'READS SQL'");
        reads = true;
        continue;
      }
      break;
    }
    const t = tok(i);
    const fix = t?.type === 'word' ? suggestSlotKeyword(t.text, ['INTO', 'USING', 'READS']) : null;
    if (fix) throw new Stop({ ruleId: 'HANA-SYN-021', tokIdx: i, message: `Unknown keyword '${t!.text}' in ${label} statement. Did you mean '${fix}'?`, replaceWith: fix });
    boundary(['INTO', 'USING', 'READS', ';', ...BLOCK_STOPS], `${label} statement`, false);
    onExec?.({ kwIdx, literalIdx, into, using, usingIdx });
  };

  /** `DECLARE <names> [CONSTANT] <type> [NOT NULL] [(DEFAULT | = | :=) <expr | query>]` and cursors. */
  const declare = (): void => {
    i++;
    if (isWord(i, 'CURSOR')) {
      i++;
      if (!isNameTok(i)) throw BAIL;
      i++;
      cursorTail();
      return;
    }
    if (!isNameTok(i)) throw BAIL;
    i++;
    if (isWord(i, 'CURSOR')) {
      i++;
      cursorTail();
      return;
    }
    while (eat(',')) {
      if (!isNameTok(i)) throw BAIL;
      i++;
    }
    if (isWord(i, 'CONDITION')) throw BAIL;
    eat('CONSTANT');
    // Type: skipped leniently up to NOT NULL / initializer / end.
    let sawType = false;
    while (!atEnd() && !isWord(i, 'DEFAULT') && tx(i) !== '=' && tx(i) !== ':=' && !(isWord(i, 'NOT') && isWord(i + 1, 'NULL'))) {
      if (tx(i) === '(' || tx(i) === '[') skipGroup();
      else i++;
      sawType = true;
    }
    if (!sawType && !atEnd()) throw BAIL;
    if (isWord(i, 'NOT')) i += 2;
    if (eat('DEFAULT') || eat('=') || eat(':=')) {
      rhs();
      finish('variable initializer');
    }
  };

  const cursorTail = (): void => {
    if (tx(i) === '(') skipGroup();
    expect('FOR');
    query(false);
    finish('cursor query');
  };

  /**
   * `VIEW <name> [COMMENT '...'] [(cols)] [(IN <p> <type> [DEFAULT <expr>], ...)] AS <query>
   *  [WITH ASSOCIATIONS (...)] [WITH ... options]`. The parameter list is validated; the rest of the header is skipped.
   */
  const view = (): void => {
    i++;
    let depth = 0;
    while (!atEnd() && !(depth === 0 && isWord(i, 'AS'))) {
      if (depth === 0 && tx(i) === '(' && isWord(i + 1, 'IN')) {
        viewParams();
        continue;
      }
      if (tx(i) === '(') depth++;
      else if (tx(i) === ')') depth--;
      i++;
    }
    if (!eat('AS')) throw BAIL;
    query(false);
    if (isWord(i, 'WITH') && isWord(i + 1, 'ASSOCIATIONS') && tx(i + 2) === '(') {
      i += 2;
      associations();
    }
    if (isWord(i, 'WITH')) throw BAIL; // WITH READ ONLY, WITH STRUCTURED PRIVILEGE CHECK, WITH ANONYMIZATION, ...
    finish('view query');
  };

  /** `( IN <name> <type> [DEFAULT <expr>] {, ...} )` of a parameterized view. */
  const viewParams = (): void => {
    i++;
    for (;;) {
      expect('IN');
      if (!isNameTok(i)) throw BAIL;
      i++;
      const typeTok = tok(i);
      if (!typeTok || (typeTok.type !== 'word' && typeTok.type !== 'qident')) throw BAIL;
      i++;
      while (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
      if (tx(i) === '(') skipGroup();
      if (eat('DEFAULT')) expr(0);
      boundary([',', ')'], 'view parameter', true);
      if (eat(',')) continue;
      expect(')');
      return;
    }
  };

  /**
   * `( <association_def> {, <association_def>} )` after `WITH ASSOCIATIONS` (views and tables):
   * `[MANY | ONE TO MANY | ONE] JOIN <target> [[AS] <alias>] ON <cond> [WITH DEFAULT FILTER <cond>]`
   * or a reused association `[<schema>.][<table>.]<association> [AS <alias>]`.
   */
  const associations = (): void => {
    i++;
    for (;;) {
      if (eat('MANY') || eat('ONE')) {
        expect('TO');
        if (!eat('MANY') && !eat('ONE')) throw BAIL;
      }
      if (eat('JOIN')) {
        targetName();
        alias(['ON'], 'association target', false);
        boundary(['ON'], 'association target', false);
        expect('ON');
        expr(0);
        if (isWord(i, 'WITH')) {
          i++;
          expect('DEFAULT');
          expect('FILTER');
          expr(0);
        }
      } else {
        targetName();
        if (eat('AS')) {
          if (!isNameTok(i)) throw BAIL;
          i++;
        }
      }
      if (isWord(i, 'JOIN') || ((isWord(i, 'MANY') || isWord(i, 'ONE')) && isWord(i + 1, 'TO'))) {
        throw new Stop({ ruleId: 'HANA-SYN-023', tokIdx: i, message: `Expected ',' before association '${tx(i)}'.`, insertCommaAfter: i - 1 });
      }
      boundary([',', 'AND', 'OR', 'WITH'], 'association', true);
      if (eat(',')) continue;
      expect(')');
      return;
    }
  };

  // ---- table DDL: column definitions, constraints, indexes, statistics, partitions (sql-sqlscript.md §4.12) -----
  /** `HANA-SYN-023` at `tok(i)`: a `,` is missing before it (QuickFix inserts it after the previous token). */
  const missingComma = (what: string): never => {
    const shown = isWord(i, '$') && tx(i + 1) === '.' ? `$.${tx(i + 2)}` : tx(i); // document path `$."b"`
    throw new Stop({ ruleId: 'HANA-SYN-023', tokIdx: i, message: `Expected ',' before ${what} '${shown}'.`, insertCommaAfter: i - 1 });
  };
  const onOff = (): void => {
    if (!eat('ON') && !eat('OFF')) throw BAIL;
  };
  const needString = (): void => {
    if (tok(i)?.type !== 'string') throw BAIL;
    i++;
  };
  const nameTok = (): void => {
    if (!isNameTok(i)) throw BAIL;
    i++;
  };
  /** `[BTREE | CPBTREE | INVERTED { HASH | VALUE | INDIVIDUAL }]` (`rs_tree_type_index`, `cs_inverted_type_index`). */
  const indexTypeOpt = (): void => {
    if (eat('BTREE') || eat('CPBTREE')) return;
    if (eat('INVERTED') && !eat('HASH') && !eat('VALUE') && !eat('INDIVIDUAL')) throw BAIL;
  };
  /** A data type follows at `k`: a built-in type word, a quoted (user-defined) type, or a qualified type name. */
  const typeAt = (k: number): boolean => {
    const t = tok(k);
    if (!t) return false;
    if (t.type === 'qident') return true;
    return t.type === 'word' && (TYPES.has(up(k)) || /^(?:CS|DDIC)_/.test(up(k)) || (tx(k + 1) === '.' && tok(k + 2)?.type !== undefined));
  };
  /** `<name> <type>` starts at `k`: the next column definition of an element list. */
  const columnDefAt = (k: number): boolean => isNameTok(k) && typeAt(k + 1);
  /**
   * A table-level constraint starts at `k`: `[CONSTRAINT <name>] { PRIMARY KEY [<index_type>] ( | UNIQUE [<index_type>] (
   * | FOREIGN KEY | CHECK ( }`. `PRIMARY KEY` / `UNIQUE` without a column list are column constraints.
   */
  const tableConstraintAt = (k: number): boolean => {
    let j = k;
    if (isWord(j, 'CONSTRAINT') && isNameTok(j + 1)) j += 2;
    if (isWord(j, 'FOREIGN') && isWord(j + 1, 'KEY')) return true;
    if (isWord(j, 'CHECK') && tx(j + 1) === '(') return true;
    if (isWord(j, 'PRIMARY') && isWord(j + 1, 'KEY')) j += 2;
    else if (isWord(j, 'UNIQUE')) j++;
    else return false;
    if (isWord(j, 'BTREE') || isWord(j, 'CPBTREE')) j++;
    else if (isWord(j, 'INVERTED')) j += 2;
    return tx(j) === '(';
  };

  /**
   * `( <item> {, <item>} )`, entered at `(`. An item is a (qualified) column name, a document path `$.a.b`
   * (collection indexes), `YEAR | MONTH | HOUR ( <column> )` or `<column> AS <type>` (partition expressions), with an
   * optional `ASC | DESC` (index columns). Two adjacent items are `HANA-SYN-023`; anything else ends validation.
   */
  const columnList = (what: string, opts: { order?: boolean; partition?: boolean } = {}): void => {
    i++;
    for (;;) {
      const item = i;
      if (isWord(i, '$') && tx(i + 1) === '.') i++;
      else if (opts.partition && tok(i)?.type === 'word' && tx(i + 1) === '(') {
        i++;
        skipGroup();
      } else nameTok();
      while (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
      if (i === item) throw BAIL;
      if (opts.partition && eat('AS')) {
        if (!typeAt(i)) throw BAIL;
        i++;
        if (tx(i) === '(') skipGroup();
      }
      if (opts.order) eat('ASC') || eat('DESC');
      if (eat(',')) continue;
      if (eat(')')) return;
      if (isNameTok(i) || (isWord(i, '$') && tx(i + 1) === '.')) missingComma(what);
      throw BAIL;
    }
  };

  /**
   * `REFERENCES <table> [( <columns> )] { ON { UPDATE | DELETE } <action> } [[NOT] ENFORCED] [[NOT] VALIDATED]
   * [INITIALLY { IMMEDIATE | DEFERRED }]`, entered after `REFERENCES`.
   */
  const references = (): void => {
    targetName();
    if (tx(i) === '(') columnList('column');
    for (;;) {
      if (isWord(i, 'ON') && (isWord(i + 1, 'UPDATE') || isWord(i + 1, 'DELETE'))) {
        i += 2;
        if (eat('CASCADE') || eat('RESTRICT')) continue;
        if (eat('SET') && (eat('NULL') || eat('DEFAULT'))) continue;
        throw BAIL;
      }
      if (isWord(i, 'NOT') && (isWord(i + 1, 'ENFORCED') || isWord(i + 1, 'VALIDATED'))) i += 2;
      else if (eat('ENFORCED') || eat('VALIDATED')) {
        /* constraint enforcement */
      } else if (eat('INITIALLY')) {
        if (!eat('IMMEDIATE') && !eat('DEFERRED')) throw BAIL;
      } else return;
    }
  };

  /**
   * Column attributes after the data type, in any order (`column_definition` and `column_constraint` of CREATE TABLE,
   * the `fulltext_elem` options of `TEXT` / `BINTEXT` / `SHORTTEXT`, and `CS_*` / `DDIC_*` storage types). Returns at
   * the first token that starts none of them.
   */
  const columnAttributes = (): void => {
    for (;;) {
      if (atEnd() || tx(i) === ',' || tx(i) === ')' || tableConstraintAt(i)) return;
      const w = up(i);
      const next = up(i + 1);
      // A word followed by a data type is the next column (`ID INT PRIMARY KEY TEXT NVARCHAR(10)`): a missing `,`.
      if (TYPES.has(next) && w !== 'AS' && w !== 'DEFAULT') return;
      if (/^(?:CS|DDIC)_[A-Z0-9_]+$/.test(w)) {
        i++;
        if (tx(i) === '(') skipGroup();
        continue;
      }
      // Each attribute is recognized by its leading word(s), so a column named `text` or `language` is not one.
      switch (w) {
        case 'NULL':
        case 'HIDDEN':
        case 'SYNC':
        case 'SYNCHRONOUS':
          i++;
          continue;
        case 'NOT':
          if (next !== 'NULL' && next !== 'HIDDEN') return;
          i += 2;
          continue;
        case 'DEFAULT':
          i++;
          if (eat('LOADABLE')) continue; // load_unit `DEFAULT LOADABLE`
          expr(0);
          continue;
        case 'CONSTRAINT':
          if (!isNameTok(i + 1) || !['PRIMARY', 'UNIQUE', 'REFERENCES'].includes(up(i + 2))) return;
          i += 2;
          continue;
        case 'UNIQUE':
          i++;
          indexTypeOpt();
          continue;
        case 'PRIMARY':
          if (next !== 'KEY') return;
          i += 2;
          indexTypeOpt();
          continue;
        case 'REFERENCES':
          i++;
          references();
          continue;
        case 'GENERATED':
          if (next !== 'ALWAYS' && next !== 'BY') return;
          i++;
          if (eat('BY')) {
            expect('DEFAULT');
            expect('AS');
            expect('IDENTITY');
          } else {
            expect('ALWAYS');
            expect('AS');
            if (eat('ROW')) {
              if (!eat('START') && !eat('END')) throw BAIL;
              eat('COMMIT');
              continue;
            }
            if (!eat('IDENTITY')) {
              expr(0);
              continue;
            }
          }
          if (tx(i) === '(') skipGroup(); // sequence options
          continue;
        case 'AS': // calculated field
          i++;
          expr(0);
          continue;
        case 'MEMORY':
          if (next !== 'THRESHOLD') return;
          i += 2;
          if (!eat('NULL')) expr(5);
          continue;
        case 'ENABLE':
        case 'DISABLE':
          if (next !== 'SCHEMA') return;
          i += 2;
          expect('FLEXIBILITY');
          continue;
        case 'FUZZY':
          if (next !== 'SEARCH') return;
          i += 2;
          if (eat('INDEX')) onOff();
          else {
            expect('MODE');
            if (!eat('NULL') && tok(i)?.type === 'string') i++;
          }
          continue;
        case 'PERSISTENT':
          if (next !== 'MEMORY') return;
          i += 2;
          if (!eat('ON') && !eat('OFF') && !eat('DEFAULT')) throw BAIL;
          continue;
        case 'COMMENT':
        case 'CONFIGURATION':
          if (tok(i + 1)?.type !== 'string') return;
          i += 2;
          continue;
        case 'TOKEN':
          if (next !== 'SEPARATORS') return;
          i += 2;
          needString();
          continue;
        case 'COLUMN':
        case 'PAGE':
          if (next !== 'LOADABLE') return;
          i += 2;
          continue;
        case 'NUMA':
          if (next !== 'NODE') return;
          i += 2;
          if (!eat('NULL')) {
            if (tx(i) !== '(') throw BAIL;
            skipGroup();
          }
          eat('IMMEDIATE') || eat('DEFERRED');
          continue;
        case 'AUDIT':
          if (next !== 'READ' && next !== 'NONE') return;
          i += 2;
          continue;
        case 'LANGUAGE':
          if (next === 'COLUMN') {
            i += 2;
            nameTok();
          } else if (next === 'DETECTION' && tx(i + 2) === '(') {
            i += 2;
            skipGroup();
          } else return;
          continue;
        case 'MIME':
          if (next !== 'TYPE') return;
          i += 2;
          if (eat('COLUMN')) nameTok();
          else needString();
          continue;
        case 'ASYNC':
        case 'ASYNCHRONOUS':
          i++;
          if (eat('FLUSH')) {
            eat('QUEUE');
            for (;;) {
              if (eat('EVERY')) {
                expr(5);
                expect('MINUTES');
              } else if (eat('AFTER')) {
                expr(5);
                expect('DOCUMENTS');
              } else throw BAIL;
              if (!eat('OR')) break;
            }
          }
          continue;
        case 'PHRASE':
          if (next !== 'INDEX') return;
          i += 2;
          expect('RATIO');
          expr(5);
          continue;
        case 'SEARCH':
        case 'FAST':
        case 'TEXT':
          if (next !== (w === 'SEARCH' ? 'ONLY' : w === 'FAST' ? 'PREPROCESS' : 'ANALYSIS')) return;
          i += 2;
          onOff();
          continue;
        case 'CLIENTSIDE': // `CLIENTSIDE ENCRYPTION { [ON] WITH <key> [RANDOM | DETERMINISTIC] | OFF }`
          if (next !== 'ENCRYPTION') return;
          i += 2;
          if (eat('OFF')) continue;
          eat('ON');
          expect('WITH');
          targetName();
          eat('RANDOM') || eat('DETERMINISTIC');
          continue;
        default:
          return; // long tail, or the end of the column definition
      }
    }
  };

  /**
   * After a table element: `,`, `)`, or the end. A table constraint or `<name> <type>` here is a missing `,`
   * (`HANA-SYN-023`); a misspelled attribute keyword is `HANA-SYN-021`; anything else ends validation silently.
   */
  const elementEnd = (): void => {
    if (atEnd() || tx(i) === ',' || tx(i) === ')') return;
    if (tableConstraintAt(i)) missingComma('table constraint');
    if (columnDefAt(i) || (isNameTok(i) && isWord(i + 1, 'ALTER'))) missingComma('column');
    const t = tok(i)!;
    const w = up(i);
    if (t.type === 'word' && !KEYWORDS.has(w) && !RESERVED.has(w)) {
      // `PRIMARYKEY`, `NOTNULL`: two attribute words written as one
      const glued = [['PRIMARY', 'KEY'], ['NOT', 'NULL']].find(([a, b]) => w === a + b || w === `${a}_${b}`);
      const fix = glued ? glued.join(' ') : matchKeywordTypo(t.text, [...COLUMN_ATTRIBUTE_STARTERS].filter((x) => x.length >= 4));
      if (fix) throw new Stop({ ruleId: 'HANA-SYN-021', tokIdx: i, message: `Unknown keyword '${t.text}' in column definition. Did you mean '${fix}'?`, replaceWith: fix });
    }
    throw BAIL;
  };

  /** `<column_name> <data_type> [ARRAY] { <column_attribute> }`, or `<column_name> ALTER { <column_attribute> }` (ALTER TABLE). */
  const columnDefinition = (): void => {
    nameTok();
    if (eat('ALTER')) {
      columnAttributes();
      return;
    }
    // A user-defined type is any other word; `(a, b) AS <query>` and `ALTER (<c> ALTER ...)` are long tail.
    if (!typeAt(i) && !(tok(i)?.type === 'word' && !COLUMN_ATTRIBUTE_STARTERS.has(up(i)) && !RESERVED.has(up(i)))) throw BAIL;
    i++;
    while (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
    if (tx(i) === '(') skipGroup();
    eat('ARRAY');
    columnAttributes();
  };

  /**
   * `[CONSTRAINT <name>] { PRIMARY KEY [<index_type>] (cols) | UNIQUE [<index_type>] (cols)
   * | FOREIGN KEY (cols) <references_specification> | CHECK (<condition>) }`. `INDEX` / `PERIOD FOR` elements are long tail.
   */
  const tableConstraint = (): void => {
    if (eat('CONSTRAINT')) nameTok();
    if (eat('PRIMARY')) {
      expect('KEY');
      indexTypeOpt();
      if (tx(i) !== '(') throw BAIL;
      columnList('column', { order: true });
    } else if (eat('UNIQUE')) {
      indexTypeOpt();
      if (tx(i) !== '(') throw BAIL;
      columnList('column', { order: true });
    } else if (eat('FOREIGN')) {
      expect('KEY');
      if (tx(i) !== '(') throw BAIL;
      columnList('column');
      expect('REFERENCES');
      references();
    } else if (eat('CHECK')) {
      if (tx(i) !== '(') throw BAIL;
      primary();
    } else {
      while (!atEnd() && tx(i) !== ',' && tx(i) !== ')') {
        if (tx(i) === '(') skipGroup();
        else i++;
      }
    }
  };

  /** `( <table_element> {, <table_element>} )`, entered at `(`: column definitions and table constraints. */
  const tableElements = (): void => {
    i++;
    for (;;) {
      const w = up(i);
      if (TABLE_CONSTRAINT_STARTERS.has(w) && !typeAt(i + 1)) tableConstraint();
      else columnDefinition();
      elementEnd();
      if (eat(',')) continue;
      expect(')');
      return;
    }
  };

  /**
   * Table options after the element list are long tail. They are scanned up to the statement end, and only the
   * column lists of `[SUB]PARTITION BY { HASH | RANGE } ( ... )` (also after `,` in multi-level schemes) are validated.
   */
  const tableOptions = (): void => {
    let partitioning = false;
    while (!atEnd()) {
      if ((isWord(i, 'PARTITION') || isWord(i, 'SUBPARTITION')) && isWord(i + 1, 'BY')) {
        i += 2;
        partitioning = true;
        continue;
      }
      if (partitioning && (isWord(i, 'HASH') || isWord(i, 'RANGE')) && tx(i + 1) === '(') {
        i++;
        columnList('partitioning column', { partition: true });
        continue;
      }
      if (partitioning && isWord(i, 'PARTITIONS')) {
        i += 2; // `PARTITIONS <n>` or `PARTITIONS GET_NUM_SERVERS()`
        if (tx(i) === '(') skipGroup();
        continue;
      }
      if (partitioning && (isWord(i, 'ROUNDROBIN') || tx(i) === ',')) {
        i++;
        continue;
      }
      partitioning = false;
      if (tx(i) === '(' || tx(i) === '[') skipGroup();
      else i++;
    }
  };

  /** `<table_type> TABLE` starts at `k` (`COLUMN`, `ROW`, `HISTORY COLUMN`, `{ GLOBAL | LOCAL } TEMPORARY [COLUMN | ROW]`). */
  const tableTypeAt = (k: number): number => {
    let j = k;
    if (isWord(j, 'GLOBAL') || isWord(j, 'LOCAL')) {
      if (!isWord(j + 1, 'TEMPORARY')) return -1;
      j += 2;
      if (isWord(j, 'COLUMN') || isWord(j, 'ROW')) j++;
    } else if (isWord(j, 'HISTORY')) {
      if (!isWord(j + 1, 'COLUMN')) return -1;
      j += 2;
    } else if (isWord(j, 'COLUMN') || isWord(j, 'ROW')) j++;
    return isWord(j, 'TABLE') ? j : -1;
  };

  /**
   * `<table_type> TABLE <name> ( <table_element> {, ...} ) [WITH ASSOCIATIONS (...)] [<table options>]`, or
   * `... TABLE <name> ( <column_name> {, ...} ) [ADD ( <identity column> )] AS ...` (the subquery is long tail).
   */
  const table = (): void => {
    i = tableTypeAt(i) + 1;
    targetName();
    if (isWord(i, 'AS') || isWord(i, 'LIKE')) throw BAIL;
    if (tx(i) !== '(') throw BAIL;
    if (isNameTok(i + 1) && (tx(i + 2) === ',' || tx(i + 2) === ')')) {
      columnList('column');
      if (!isWord(i, 'ADD') || tx(i + 1) !== '(') throw BAIL;
      i++;
      tableElements();
      throw BAIL;
    }
    tableElements();
    if (isWord(i, 'WITH') && isWord(i + 1, 'ASSOCIATIONS') && tx(i + 2) === '(') {
      i += 2;
      associations();
    }
    tableOptions();
  };

  /** `TYPE <name> AS TABLE ( <table_element> {, ...} ) [...]` (`.hdbtabletype`, `.hdbstructure`, `CREATE TYPE`). */
  const tableType = (): void => {
    i++;
    targetName();
    expect('AS');
    expect('TABLE');
    if (tx(i) !== '(') throw BAIL;
    tableElements();
  };

  /**
   * `ALTER TABLE <name> { ADD ( <elements> ) | ALTER ( <elements> ) | DROP ( <columns> ) | ADD [CONSTRAINT <n>]
   * <table_constraint> | PARTITION BY ... }`. Other ALTER TABLE clauses are long tail.
   */
  const alterTable = (): void => {
    i += 2;
    targetName();
    if ((isWord(i, 'ADD') || isWord(i, 'ALTER')) && tx(i + 1) === '(') {
      i++;
      tableElements();
    } else if (isWord(i, 'DROP') && tx(i + 1) === '(') {
      i++;
      columnList('column');
    } else if (isWord(i, 'ADD') && (isWord(i + 1, 'CONSTRAINT') || tableConstraintAt(i + 1))) {
      i++;
      tableConstraint();
    } else if (!(isWord(i, 'PARTITION') && isWord(i + 1, 'BY'))) throw BAIL;
    tableOptions();
  };

  /**
   * An index or statistics header ends at `k` - 1 and returns the index of its noun, or `-1`:
   * `[UNIQUE] [<index_type>] INDEX`, `FULLTEXT INDEX`, `FUZZY SEARCH INDEX`, `HASH INDEX`, `BLOCK RANGE INDEX`, `STATISTICS`.
   */
  const indexNounAt = (k: number): number => {
    let j = k;
    if (isWord(j, 'STATISTICS')) return j;
    if (isWord(j, 'FULLTEXT') || isWord(j, 'HASH')) j++;
    else if (isWord(j, 'FUZZY') && isWord(j + 1, 'SEARCH')) j += 2;
    else if (isWord(j, 'BLOCK') && isWord(j + 1, 'RANGE')) j += 2;
    else {
      if (isWord(j, 'UNIQUE')) j++;
      if (isWord(j, 'BTREE') || isWord(j, 'CPBTREE')) j++;
      else if (isWord(j, 'INVERTED')) j += 2;
    }
    return isWord(j, 'INDEX') ? j : -1;
  };

  /** `<index header> <name> ON <table> ( <column> [ASC | DESC] {, ...} ) [...]` and `STATISTICS [<name>] ON <table> [( <columns> )] [...]` */
  const indexOrStatistics = (): void => {
    i = indexNounAt(i);
    const statistics = isWord(i, 'STATISTICS');
    i++;
    if (!(statistics && isWord(i, 'ON'))) targetName();
    expect('ON');
    targetName();
    if (tx(i) === '(') columnList(statistics ? 'column' : 'index column', { order: !statistics });
    else if (!statistics) throw BAIL;
    // Index and statistics options (`ASYNC`, `FAST PREPROCESS OFF`, `TYPE HISTOGRAM`, `ONLINE`, ...) are long tail.
  };

  /**
   * `GRAPH WORKSPACE <name> EDGE TABLE <t> SOURCE [COLUMN] <columns> [REFERENCES <t>] TARGET [COLUMN] <columns> ...
   * KEY [COLUMN] <columns> [LABEL '...'] VERTEX TABLE <t> KEY [COLUMN] <columns> [...]` (§4.4). The clauses are read in
   * any order; each `<columns>` list is `<name> {, <name>}`.
   */
  const graphWorkspace = (): void => {
    i += 2;
    targetName();
    if (!isWord(i, 'EDGE') && !isWord(i, 'VERTEX')) throw BAIL; // ADJACENCY INDEX / COLLECTION forms
    while (!atEnd()) {
      if ((eat('EDGE') || eat('VERTEX')) && eat('TABLE')) targetName();
      else if (eat('SOURCE') || eat('TARGET') || eat('KEY')) {
        eat('COLUMN');
        for (;;) {
          nameTok();
          if (eat(',')) continue;
          if (isNameTok(i) && !(tok(i)?.type === 'word' && GRAPH_WORKSPACE_CLAUSES.has(up(i)))) missingComma('column');
          break;
        }
      } else if (eat('REFERENCES')) targetName();
      else if (eat('LABEL')) needString();
      else return; // cache options, ... (long tail)
    }
  };

  /**
   * `OVER ( [<window_name>] [PARTITION BY <expr> {, <expr>}] [ORDER BY <expr> [ASC | DESC] [NULLS FIRST | LAST] {, ...}]
   * [<window_frame_clause>] )`, entered at `(`. Two adjacent `PARTITION BY` / `ORDER BY` items are `HANA-SYN-023`. A
   * frame clause, `SERIES (...)` or anything else is skipped silently.
   */
  const windowSpec = (): void => {
    const open = i;
    try {
      i++;
      if (isNameTok(i) && !isWord(i, 'PARTITION') && !isWord(i, 'ORDER') && tok(i)?.type === 'word' && (isWord(i + 1, 'PARTITION') || isWord(i + 1, 'ORDER') || tx(i + 1) === ')')) i++;
      for (const clause of ['PARTITION', 'ORDER']) {
        if (!isWord(i, clause) || !isWord(i + 1, 'BY')) continue;
        i += 2;
        for (;;) {
          expr(0);
          if (clause === 'ORDER') {
            eat('ASC') || eat('DESC');
            if (eat('NULLS') && !eat('FIRST') && !eat('LAST')) throw BAIL;
          }
          if (eat(',')) continue;
          if (isWord(i, 'ROWS') || isWord(i, 'RANGE') || isWord(i, 'GROUPS')) throw BAIL; // window frame: long tail
          const t = tok(i);
          if (t && (t.type === 'qident' || t.type === 'number' || t.type === 'string' || t.type === 'var' || (t.type === 'word' && isNameTok(i) && !NON_ALIAS.has(up(i)) && !KEYWORDS.has(up(i))))) {
            missingComma(`${clause} BY item`);
          }
          break;
        }
      }
      expect(')');
    } catch (e) {
      if (e instanceof Stop) throw e;
      if (!(e instanceof Bail)) throw e;
      i = open;
      skipGroup();
    }
  };

  // ---- headerless structured filters and remote table replicas (sql-sqlscript.md §4.11) ------------------------
  /** `HANA-SYN-025` on the last consumed token: a required clause is missing after it. */
  const missing = (what: string, context: string): never => {
    throw new Stop({ ruleId: 'HANA-SYN-025', tokIdx: i - 1, message: `Incomplete ${context}: missing ${what} after '${tx(i - 1)}'.` });
  };
  /**
   * Requires `tok(i)` to be one of `follow`. At the statement end, or at a keyword of a later clause in
   * `later`, the clause is missing from `production` (`HANA-SYN-025`); anything else goes through
   * {@link boundary} with `after` as its context.
   */
  const need = (follow: readonly string[], what: string, production: string, after: string, later: readonly string[]): void => {
    if (atEnd() || (later.includes(up(i)) && !follow.includes(up(i)))) missing(what, production);
    boundary(follow, after, false);
    if (!follow.includes(up(i)) && !follow.includes(tx(i))) throw BAIL;
  };
  /** A name is required at `i` (a reserved word or the statement end means it is missing). */
  const needName = (what: string, context: string): void => {
    if (atEnd() || (tok(i)?.type === 'word' && RESERVED.has(up(i)))) missing(what, context);
    targetName();
  };

  /** Clause words of a structured filter in order (`ON`, `ESCAPE`, `LIKE`, `NOT`, `WHERE`, `CONDITION`). */
  const FILTER_CLAUSES = STRUCTURED_FILTER_CLAUSES;
  const FILTER_CLAUSES_FROM_NOT = FILTER_CLAUSES.slice(FILTER_CLAUSES.indexOf('NOT'));
  const FILTER_CONDITION_WORDS = FILTER_CLAUSES.slice(FILTER_CLAUSES.indexOf('WHERE'));
  const FILTER_CONDITION = "'WHERE <condition>' or 'CONDITION PROVIDER <procedure>'";

  /** `<wildcard_object> {, <wildcard_object>}` after `LIKE` / `NOT LIKE`: schema-local, double-quoted names. */
  const wildcardList = (keyword: string): void => {
    const ctx = 'structured filter';
    for (;;) {
      const t = tok(i);
      if (!t || (t.type === 'word' && RESERVED.has(up(i)))) missing(`an object name pattern`, ctx);
      if (t!.type === 'string') {
        throw new Stop({ ruleId: 'HANA-SYN-042', tokIdx: i, message: `Unexpected '${t!.text}' in ${keyword} list; expected a double-quoted object name pattern.` });
      }
      if (t!.type !== 'qident' && t!.type !== 'word') throw BAIL;
      i++;
      if (tx(i) === '.') {
        throw new Stop({ ruleId: 'HANA-SYN-042', tokIdx: i, message: `Unexpected '.' in ${keyword} list; a wildcard object name is schema-local.` });
      }
      if (!eat(',')) return;
    }
  };

  /**
   * `STRUCTURED FILTER <name> FOR SELECT [ON <object> {, <object>}]
   *  [[ESCAPE '<char>'] LIKE <wildcard> {, ...} [NOT LIKE <wildcard> {, ...}]]
   *  (WHERE <condition> | CONDITION PROVIDER <procedure>)`, entered at `STRUCTURED`. The wildcard clauses are
   * `[HDI]` plug-in syntax; `CREATE STRUCTURED FILTER` `[CLOUD]` uses the same production.
   */
  const structuredFilter = (): void => {
    const ctx = 'structured filter';
    i += 2;
    needName('a filter name', ctx);
    need(['FOR'], "'FOR SELECT'", ctx, 'structured filter name', FILTER_CLAUSES);
    i++;
    need(['SELECT'], "'SELECT'", ctx, "'FOR'", FILTER_CLAUSES);
    i++;
    let after = "'FOR SELECT'";
    if (eat('ON')) {
      for (;;) {
        needName('an object name', ctx);
        if (!eat(',')) break;
      }
      after = 'structured filter object';
    }
    if (eat('ESCAPE')) {
      if (atEnd() || tok(i)?.type === 'word') missing('an escape character string', ctx);
      if (tok(i)?.type !== 'string') {
        throw new Stop({ ruleId: 'HANA-SYN-042', tokIdx: i, message: `Unexpected '${tx(i)}' after 'ESCAPE'; expected a single-character string.` });
      }
      i++;
      need(['LIKE'], "a 'LIKE' list", ctx, "'ESCAPE' character", FILTER_CLAUSES_FROM_NOT);
    }
    if (eat('LIKE')) {
      wildcardList('LIKE');
      after = "'LIKE' list";
      if (isWord(i, 'NOT') && isWord(i + 1, 'LIKE')) {
        i += 2;
        wildcardList('NOT LIKE');
        after = "'NOT LIKE' list";
      }
    } else if (isWord(i, 'NOT') && isWord(i + 1, 'LIKE')) {
      throw new Stop({
        ruleId: 'HANA-SYN-042',
        tokIdx: i,
        endTokIdx: i + 1,
        message: "'NOT LIKE' requires a preceding 'LIKE' list in a structured filter.",
      });
    }
    need(FILTER_CONDITION_WORDS, FILTER_CONDITION, ctx, after, []);
    if (eat('WHERE')) {
      if (atEnd()) missing('a filter condition', ctx);
      expr(0);
      finish('structured filter condition');
      return;
    }
    i++;
    need(['PROVIDER'], "'PROVIDER'", ctx, "'CONDITION'", []);
    i++;
    needName('a condition provider procedure name', ctx);
    finish('condition provider procedure');
  };

  /** `REMOTE TABLE REPLICA <target_table> ON <virtual_table>`, entered at `REMOTE` (plug-in syntax, `[HDI]` `[CLOUD]`). */
  const remoteTableReplica = (): void => {
    const ctx = 'remote table replica';
    i += 3;
    needName('a target table name', ctx);
    need(['ON'], "'ON <virtual_table>'", ctx, 'remote table replica target', []);
    i++;
    needName('a virtual table name', ctx);
    finish('virtual table name');
  };

  /** `SEQUENCE <name> { <sequence_option> }` */
  const sequence = (): void => {
    expect('SEQUENCE');
    targetName();
    const OPTIONS = ['START', 'INCREMENT', 'MAXVALUE', 'MINVALUE', 'NO', 'CYCLE', 'CACHE', 'RESET', 'RESTART', ';', ...BLOCK_STOPS];
    while (!atEnd()) {
      if (eat('START') || eat('RESTART')) {
        expect('WITH');
        expr(5);
      } else if (eat('INCREMENT')) {
        expect('BY');
        expr(5);
      } else if (eat('MAXVALUE') || eat('MINVALUE') || eat('CACHE')) {
        expr(5);
      } else if (eat('NO')) {
        if (!eat('MAXVALUE') && !eat('MINVALUE') && !eat('CYCLE') && !eat('CACHE')) throw BAIL;
      } else if (eat('CYCLE')) {
        /* flag */
      } else if (eat('RESET')) {
        expect('BY');
        throw BAIL; // RESET BY <subquery>: long tail
      } else {
        boundary(OPTIONS, 'sequence option', false);
        throw BAIL;
      }
    }
  };

  const run = (start: number, end: number, body: () => void): void => {
    if (end <= start) return;
    // A statement with a diagnostic is still parsed for its recovered hierarchy-call issues, but its boundary
    // error is dropped: it is likely a cascade of the existing diagnostic.
    const prior = hasDiagnosticIn(start, end);
    lim = end;
    i = start;
    soft = [];
    try {
      body();
    } catch (e) {
      if (e instanceof Stop) {
        if (!prior) report(e.issue);
      } else if (!(e instanceof Bail)) throw e;
    }
    for (const issue of soft) if (!hasDiagnosticIn(issue.tokIdx, issue.tokIdx + 1)) report(issue);
  };

  return {
    checkStatement: (start, end, scope) => run(start, end, () => statement(scope)),
    checkCondition: (start, end, keyword) =>
      run(start, end, () => {
        expr(0);
        boundary(['AND', 'OR', keyword], `${keyword === 'DO' ? 'WHILE' : 'IF'} condition`, false);
      }),
  };
}
