/**
 * Consuming clause and Pratt expression parsers for core SQL / SQLScript statements (`HANA-SYN-042`)
 * `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`.
 *
 * Plugged into the statement walker (`sql-statements.ts`) as {@link StatementWalkerHooks}: the walker owns
 * statement extents, and these parsers validate the tokens of one statement `[start, end)`.
 *
 * Covered statements: queries (`SELECT`, `WITH ... SELECT`, `( query )`, set operations), `INSERT`, `UPDATE`,
 * `UPSERT` / `REPLACE`, `DELETE`, SQLScript `DECLARE` (variables / cursors), `RETURN`, assignments, `CALL`,
 * `SIGNAL` / `RESIGNAL`, `IF` / `ELSEIF` / `WHILE` conditions, and HDI / catalog `VIEW`, `COLUMN | ROW TABLE`,
 * and `SEQUENCE` DDL, plus the clause lists of the `HIERARCHY*( ... )` table functions (`sql-sqlscript.md` §4.5).
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
import { KEYWORDS, RESERVED } from '../formatter/keywords';
import { type Token } from '../formatter/tokenizer';
import { type StatementScope, type StatementWalkerHooks } from './sql-statements';
import { matchKeywordTypo, suggestOptionKeyword, suggestSlotKeyword } from './typo';
import {
  BLOCK_STOPS,
  FOLLOW_HIDDEN,
  HIERARCHY_CLAUSE_FUNCTIONS,
  HIERARCHY_CLAUSE_STARTERS,
  INTERVAL_UNITS,
  JOIN_STARTERS,
  NON_ALIAS,
  QUERY_CLAUSES,
  RESERVED_OPERANDS,
  TABLE_CONSTRAINT_STARTERS,
  TYPED_LITERAL_WORDS,
} from './keyword-sets';

export interface ClauseIssue {
  readonly ruleId: 'HANA-SYN-021' | 'HANA-SYN-042';
  readonly tokIdx: number;
  readonly message: string;
  readonly replaceWith?: string;
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
  hasDiagnosticIn: (start: number, end: number) => boolean
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
        skipGroup();
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
        expr(0);
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
      case 'SELECT':
      case 'WITH':
        query(false);
        finish('query');
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
      case 'COLUMN':
      case 'ROW':
        i++;
        if (!isWord(i, 'TABLE')) throw BAIL;
        table();
        return;
      case 'SEQUENCE':
        sequence();
        return;
      case 'CREATE': {
        i++;
        if (eat('OR')) expect('REPLACE');
        const k = up(i);
        if (k === 'VIEW') view();
        else if (k === 'SEQUENCE') sequence();
        else if ((k === 'COLUMN' || k === 'ROW') && isWord(i + 1, 'TABLE')) {
          i++;
          table();
        } else throw BAIL;
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

  /** `VIEW <name> [(cols)] [COMMENT '...'] [(params)] AS <query> [WITH ... options]` */
  const view = (): void => {
    i++;
    let depth = 0;
    while (!atEnd() && !(depth === 0 && isWord(i, 'AS'))) {
      if (tx(i) === '(') depth++;
      else if (tx(i) === ')') depth--;
      i++;
    }
    if (!eat('AS')) throw BAIL;
    query(false);
    if (isWord(i, 'WITH')) throw BAIL; // WITH READ ONLY, WITH STRUCTURED PRIVILEGE CHECK, WITH ANONYMIZATION, ...
    finish('view query');
  };

  /** `[COLUMN | ROW] TABLE <name> ( <element> {, <element>} ) [table options]` */
  const table = (): void => {
    expect('TABLE');
    targetName();
    if (isWord(i, 'AS') || isWord(i, 'LIKE')) throw BAIL;
    if (tx(i) !== '(') throw BAIL;
    i++;
    for (;;) {
      const w = up(i);
      if (TABLE_CONSTRAINT_STARTERS.has(w)) {
        // table constraint: lenient up to the next top-level `,` / `)`
        while (!atEnd() && tx(i) !== ',' && tx(i) !== ')') {
          if (tx(i) === '(') skipGroup();
          else i++;
        }
      } else {
        if (!isNameTok(i)) throw BAIL;
        i++;
        const typeTok = tok(i);
        if (!typeTok || (typeTok.type !== 'word' && typeTok.type !== 'qident')) throw BAIL;
        i++;
        while (tx(i) === '.' && (tok(i + 1)?.type === 'word' || tok(i + 1)?.type === 'qident')) i += 2;
        if (tx(i) === '(') skipGroup();
        // Column attributes (NOT NULL, PRIMARY KEY, GENERATED ..., FUZZY SEARCH INDEX ON, PAGE LOADABLE, NUMA NODE,
        // ARRAY, CS_* modifiers, REFERENCES <t>(<c>), ...) are long tail and consumed leniently; only DEFAULT
        // expressions are validated.
        while (!atEnd() && tx(i) !== ',' && tx(i) !== ')') {
          if (isWord(i, 'DEFAULT')) {
            i++;
            expr(0);
          } else if (tx(i) === '(' || tx(i) === '[') {
            skipGroup();
          } else {
            i++;
          }
        }
      }
      if (eat(',')) continue;
      expect(')');
      break;
    }
    // Table options (PARTITION BY, UNLOAD PRIORITY, WITH ..., ...) are long tail.
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
