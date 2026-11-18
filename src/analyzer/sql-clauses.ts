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
 * and `SEQUENCE` DDL. Every other statement is left to the lexical (#25), header (#26) and starter (#27) checks.
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
 */
import { KEYWORDS, RESERVED } from '../formatter/keywords';
import { type Token } from '../formatter/tokenizer';
import { type StatementScope, type StatementWalkerHooks } from './sql-statements';
import { matchKeywordTypo, suggestSlotKeyword } from './typo';
import {
  BLOCK_STOPS,
  FOLLOW_HIDDEN,
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
    if (end <= start || hasDiagnosticIn(start, end)) return;
    lim = end;
    i = start;
    try {
      body();
    } catch (e) {
      if (e instanceof Stop) report(e.issue);
      else if (!(e instanceof Bail)) throw e;
    }
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
