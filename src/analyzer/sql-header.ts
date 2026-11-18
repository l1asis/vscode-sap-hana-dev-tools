/**
 * Consuming parser for SQLScript routine / library / trigger / anonymous-block headers
 * `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`.
 *
 * Grammar: `docs/specs/grammars/sql-sqlscript.md` §4.1 and `docs/specs/diagnostics/syntax-rules.md`
 * (`HANA-SYN-040`). Every token from the header start through `AS` -> `{ USING ...; }` -> `BEGIN`
 * (or `HEADER ONLY` / `;`) must be consumed by a header production; anything else becomes a
 * {@link HeaderIssue}. Unknown tokens are matched against the follow-set of their exact slot, so
 * `ASd` -> `AS` or `LANUAGE` -> `LANGUAGE` yield actionable typo fixes, and parsing recovers as if the
 * suggested keyword had been written.
 *
 * The parser is purely syntactic: clause ordering / compatibility semantics (`HANA-SYN-028`) are derived
 * from {@link ParsedRoutineHeader.clauses} by the caller.
 */
import { TYPES } from '../formatter/keywords';
import { type Token } from '../formatter/tokenizer';
import { suggestSlotKeyword } from './typo';
import {
  CLAUSE_STARTERS,
  KNOWN_LANGUAGES,
  LANGUAGE_TYPO_TARGETS,
  MANAGEMENT_WORDS,
} from './keyword-sets';

export type HeaderKind = 'procedure' | 'function' | 'library' | 'trigger' | 'do';

export interface HeaderClause {
  /** Canonical clause key (`'LANGUAGE'`, `'SQL SECURITY'`, `'READS SQL DATA'`, ...). */
  readonly key: string;
  /** Index of the clause's first token in the code-token array. */
  readonly tokIdx: number;
  /** `true` when the clause appeared after `AS` (misplaced). */
  readonly afterAs: boolean;
}

export interface HeaderIssue {
  readonly ruleId: 'HANA-SYN-021' | 'HANA-SYN-040';
  readonly tokIdx: number;
  readonly message: string;
  /** Replace the token at `tokIdx` with `replaceWith`, or insert `insertBefore` in front of it. */
  readonly replaceWith?: string;
  readonly insertBefore?: string;
}

export interface ParsedRoutineHeader {
  readonly kind: HeaderKind;
  readonly kindIdx: number;
  readonly isAlter: boolean;
  readonly isVirtual: boolean;
  /** `ALTER PROCEDURE p RECOMPILE`, `ALTER FUNCTION f ENCRYPTION ON`, `... ADD|DROP VARIABLE CACHE ...`. */
  readonly isManagementForm: boolean;
  readonly paramOpenIdx: number;
  readonly paramCloseIdx: number;
  readonly clauses: readonly HeaderClause[];
  readonly returnsIdx: number;
  readonly returnKind: 'none' | 'table' | 'scalar';
  readonly returnVarNames: ReadonlySet<string>;
  readonly language: string | null;
  readonly usingIdxs: readonly { readonly tokIdx: number; readonly afterAs: boolean }[];
  readonly asIdx: number;
  readonly headerOnly: boolean;
  /** Index of the body `BEGIN`, or `-1`. */
  readonly beginIdx: number;
  /** Index right after `BEGIN`, after the terminating `;`, or the stop position. */
  readonly nextIdx: number;
  readonly issues: readonly HeaderIssue[];
}

export interface HeaderParseOptions {
  /** Parse a `.hdblibrary` member (`[PUBLIC | PRIVATE] PROCEDURE | FUNCTION ...`). */
  readonly inLibrary: boolean;
}

/** Expected keywords (display form) for the pre-`AS` slot of each header kind. */
function expectedBeforeAs(kind: HeaderKind, isVirtual: boolean): string[] {
  if (kind === 'library') return ['LANGUAGE', 'TEST', 'DEFAULT SCHEMA', 'AS'];
  const common = ['LANGUAGE', 'SQL SECURITY', 'DEFAULT SCHEMA', 'READS SQL DATA', 'VARIABLE CACHE', 'DETERMINISTIC', 'WITH ENCRYPTION'];
  const virtual = isVirtual ? ['CONFIGURATION', 'AT'] : [];
  if (kind === 'function') return ['RETURNS', ...common, 'STRUCTURED FILTER CHECK', ...virtual, 'AS'];
  return [...common, 'AUTOCOMMIT DDL', ...virtual, 'AS'];
}

function firstWords(expected: readonly string[]): string[] {
  return [...new Set(expected.map((e) => e.split(' ')[0]))];
}

function formatExpected(expected: readonly string[]): string {
  return expected.map((e) => `'${e}'`).join(', ');
}

/**
 * Attempts to parse a routine header starting at `startIdx` (statement start). Returns `null` when the
 * tokens do not start a `[CREATE [OR REPLACE] | ALTER] [VIRTUAL] PROCEDURE | FUNCTION | LIBRARY | TRIGGER`
 * header, a library member, or an anonymous `DO [(...)] BEGIN` block.
 */
export function parseRoutineHeader(
  tokens: readonly Token[],
  startIdx: number,
  opts: HeaderParseOptions
): ParsedRoutineHeader | null {
  /** Typo-corrected keyword overrides by token index (recovery treats them as the suggested keyword). */
  const alias = new Map<number, string>();
  const up = (i: number): string => {
    const a = alias.get(i);
    if (a !== undefined) return a;
    const t = tokens[i];
    return t && t.type === 'word' ? t.text.toUpperCase() : '';
  };
  const text = (i: number): string => tokens[i]?.text ?? '';
  const issues: HeaderIssue[] = [];
  const issue = (ruleId: HeaderIssue['ruleId'], tokIdx: number, message: string, extra: Partial<HeaderIssue> = {}): void => {
    issues.push({ ruleId, tokIdx, message, ...extra });
  };

  /** Consumes `name {. name}` (word / quoted identifier / glued `::part`), returning the next index or `-1`. */
  const parseName = (i: number): number => {
    const t = tokens[i];
    if (!t || (t.type !== 'word' && t.type !== 'qident')) return -1;
    let j = i + 1;
    for (;;) {
      const n = tokens[j];
      if (n?.text === '.' && (tokens[j + 1]?.type === 'word' || tokens[j + 1]?.type === 'qident')) {
        j += 2;
      } else if (n?.type === 'sysvar' && !n.wsBefore) {
        j++; // undelimited `a.b::c` (reported as HANA-SYN-006)
      } else {
        return j;
      }
    }
  };

  /** Returns the index of the `)` matching the `(` at `openIdx`, or `-1`. */
  const matchParen = (openIdx: number): number => {
    let depth = 0;
    for (let k = openIdx; k < tokens.length; k++) {
      if (tokens[k].text === '(') depth++;
      else if (tokens[k].text === ')' && --depth === 0) return k;
      else if (tokens[k].text === ';' && depth <= 1) return -1;
    }
    return -1;
  };

  // ---- 1. Prefix & object kind -------------------------------------------------------------------------
  let i = startIdx;
  let isAlter = false;
  let isVirtual = false;
  if (opts.inLibrary) {
    if (up(i) === 'PUBLIC' || up(i) === 'PRIVATE') i++;
  } else if (up(i) === 'CREATE') {
    i++;
    if (up(i) === 'OR' && up(i + 1) === 'REPLACE') i += 2;
  } else if (up(i) === 'ALTER') {
    isAlter = true;
    i++;
  }
  if (!opts.inLibrary && up(i) === 'VIRTUAL') {
    isVirtual = true;
    i++;
  }

  const kindIdx = i;
  const kindWord = up(i);
  let kind: HeaderKind;
  if (kindWord === 'PROCEDURE') kind = 'procedure';
  else if (kindWord === 'FUNCTION') kind = 'function';
  else if (kindWord === 'LIBRARY' && !opts.inLibrary && !isVirtual) kind = 'library';
  else if (kindWord === 'TRIGGER' && !opts.inLibrary && !isVirtual && !isAlter) kind = 'trigger';
  else if (kindWord === 'DO' && !opts.inLibrary && i === startIdx && (text(i + 1) === '(' || up(i + 1) === 'BEGIN')) kind = 'do';
  else return null;
  i++;

  let paramOpenIdx = -1;
  let paramCloseIdx = -1;
  const clauses: HeaderClause[] = [];
  const usingIdxs: { tokIdx: number; afterAs: boolean }[] = [];
  const returnVarNames = new Set<string>();
  let returnsIdx = -1;
  let returnKind: ParsedRoutineHeader['returnKind'] = 'none';
  let language: string | null = null;
  let asIdx = -1;
  let headerOnly = false;
  let isManagementForm = false;
  let builtin = false;

  const result = (beginIdx: number, nextIdx: number): ParsedRoutineHeader => ({
    kind,
    kindIdx,
    isAlter,
    isVirtual,
    isManagementForm,
    paramOpenIdx,
    paramCloseIdx,
    clauses,
    returnsIdx,
    returnKind,
    returnVarNames,
    language,
    usingIdxs,
    asIdx,
    headerOnly,
    beginIdx,
    nextIdx,
    issues,
  });

  // ---- 2. Anonymous block: DO [(<params>)] BEGIN --------------------------------------------------------
  if (kind === 'do') {
    if (text(i) === '(') {
      paramOpenIdx = i;
      paramCloseIdx = matchParen(i);
      i = paramCloseIdx >= 0 ? paramCloseIdx + 1 : i + 1;
    }
    if (up(i) === 'BEGIN') return result(i, i + 1);
    issue('HANA-SYN-040', Math.min(i, tokens.length - 1), `Expected 'BEGIN' after 'DO' block parameters.`);
    return result(-1, i);
  }

  // ---- 3. Object name ----------------------------------------------------------------------------------
  const afterName = parseName(i);
  if (afterName < 0) {
    if (i < tokens.length) issue('HANA-SYN-040', i, `Expected ${kind === 'library' ? 'library' : kind} name after '${kindWord}'.`);
  } else {
    i = afterName;
  }

  // `ALTER PROCEDURE p RECOMPILE`, `ALTER FUNCTION f ENCRYPTION ON`, `ALTER PROCEDURE p ADD VARIABLE CACHE ...`
  if (isAlter && MANAGEMENT_WORDS.has(up(i))) {
    isManagementForm = true;
    while (i < tokens.length && text(i) !== ';') i++;
    return result(-1, text(i) === ';' ? i + 1 : i);
  }

  // ---- 4. Trigger header ---------------------------------------------------------------------------------
  if (kind === 'trigger') return parseTriggerTail(i);

  // ---- 5. Parameter list ---------------------------------------------------------------------------------
  if (kind !== 'library' && text(i) === '(') {
    paramOpenIdx = i;
    paramCloseIdx = matchParen(i);
    i = paramCloseIdx >= 0 ? paramCloseIdx + 1 : i + 1;
  }

  // ---- 6. Clauses, AS, USING, body -----------------------------------------------------------------------
  const expectedPre = expectedBeforeAs(kind, isVirtual);
  const expectedPost = ['USING', 'BEGIN', 'HEADER ONLY'];
  const seen = new Set<string>();
  /** `true` while skipping a run of unexpected tokens (only one HANA-SYN-040 per run). */
  let inJunk = false;

  const addClause = (key: string, tokIdx: number): void => {
    clauses.push({ key, tokIdx, afterAs: asIdx >= 0 });
    seen.add(key);
  };

  /** Consumes `<name> <type> [(..)] [ARRAY] {, ...}` or `<type>` after `RETURNS`; returns next index. */
  const parseScalarReturns = (j: number): number => {
    for (;;) {
      const t = tokens[j];
      if (!t || (t.type !== 'word' && t.type !== 'qident')) {
        issue('HANA-SYN-040', Math.min(j, tokens.length - 1), `Expected return type after 'RETURNS'.`);
        return j;
      }
      // `<name> <type>` vs. a bare `<type>`: the second word is a type unless it is a header clause keyword
      // (or a typo of one, `RETURNS INT LANUAGE ...`), and a known type name followed by a non-type word is
      // itself the type.
      const n = tokens[j + 1];
      const nUp = up(j + 1);
      const nIsWordLike = Boolean(n && (n.type === 'word' || n.type === 'qident'));
      const nIsClause =
        CLAUSE_STARTERS.has(nUp) ||
        nUp === 'ARRAY' ||
        (n?.type === 'word' && suggestSlotKeyword(n.text, [...CLAUSE_STARTERS]) !== null);
      const tIsType = t.type === 'word' && TYPES.has(t.text.toUpperCase());
      const nIsType = n?.type === 'qident' || (n?.type === 'word' && TYPES.has(nUp)) || text(j + 2) === '(';
      const hasName = nIsWordLike && !nIsClause && (!tIsType || nIsType);
      if (hasName) {
        returnVarNames.add(t.type === 'qident' ? t.text : t.text.toUpperCase());
        j++;
      }
      const typeEnd = parseName(j);
      j = typeEnd < 0 ? j + 1 : typeEnd;
      if (text(j) === '(') {
        const close = matchParen(j);
        j = close >= 0 ? close + 1 : j + 1;
      }
      if (up(j) === 'ARRAY') j++;
      if (text(j) !== ',') return j;
      j++;
    }
  };

  /**
   * Tries to consume one clause at `j`. Returns the next index, or `-1` when no production matches.
   * Clause-level argument errors are reported here (with typo suggestions for the argument slot).
   */
  const parseClause = (j: number): number => {
    const w = up(j);
    const w2 = up(j + 1);
    const w3 = up(j + 2);
    const argTypo = (slotIdx: number, expected: readonly string[], after: string): void => {
      const t = tokens[slotIdx];
      const fix = t && t.type === 'word' ? suggestSlotKeyword(t.text, expected) : null;
      if (fix && t) {
        issue('HANA-SYN-021', slotIdx, `Unknown keyword '${t.text}' after '${after}'. Did you mean '${fix}'?`, { replaceWith: fix });
      } else {
        issue('HANA-SYN-040', Math.min(slotIdx, tokens.length - 1), `Expected ${expected.map((e) => `'${e}'`).join(' or ')} after '${after}'.`);
      }
    };

    switch (w) {
      case 'RETURNS': {
        if (kind === 'library') return -1;
        returnsIdx = returnsIdx < 0 ? j : returnsIdx;
        addClause('RETURNS', j);
        if (up(j + 1) === 'TABLE') {
          returnKind = 'table';
          if (text(j + 2) === '(') {
            const close = matchParen(j + 2);
            return close >= 0 ? close + 1 : j + 3;
          }
          issue('HANA-SYN-040', Math.min(j + 2, tokens.length - 1), `Expected '(' column list after 'RETURNS TABLE'.`);
          return j + 2;
        }
        if (returnKind !== 'table') returnKind = 'scalar';
        return parseScalarReturns(j + 1);
      }
      case 'LANGUAGE': {
        addClause('LANGUAGE', j);
        const t = tokens[j + 1];
        if (!t || t.type !== 'word' || CLAUSE_STARTERS.has(up(j + 1))) {
          issue('HANA-SYN-040', Math.min(j + 1, tokens.length - 1), `Expected language name after 'LANGUAGE'.`);
          return j + 1;
        }
        const lang = t.text.toUpperCase();
        if (!KNOWN_LANGUAGES.has(lang)) {
          const fix = suggestSlotKeyword(t.text, [...LANGUAGE_TYPO_TARGETS]);
          if (fix) {
            issue('HANA-SYN-021', j + 1, `Unknown keyword '${t.text}' after 'LANGUAGE'. Did you mean '${fix}'?`, { replaceWith: fix });
            language = fix;
            return j + 2;
          }
        }
        language = lang;
        return j + 2;
      }
      case 'SQL':
        if (w2 !== 'SECURITY') {
          const fix = tokens[j + 1]?.type === 'word' ? suggestSlotKeyword(tokens[j + 1].text, ['SECURITY']) : null;
          if (!fix) return -1;
          issue('HANA-SYN-021', j + 1, `Unknown keyword '${tokens[j + 1].text}' after 'SQL'. Did you mean 'SECURITY'?`, { replaceWith: fix });
        }
        addClause('SQL SECURITY', j);
        if (w3 === 'DEFINER' || w3 === 'INVOKER') return j + 3;
        argTypo(j + 2, ['DEFINER', 'INVOKER'], 'SECURITY');
        return tokens[j + 2]?.type === 'word' && !CLAUSE_STARTERS.has(w3) ? j + 3 : j + 2;
      case 'DEFAULT': {
        if (w2 !== 'SCHEMA') return -1;
        addClause('DEFAULT SCHEMA', j);
        const end = parseName(j + 2);
        if (end < 0) {
          issue('HANA-SYN-040', Math.min(j + 2, tokens.length - 1), `Expected schema name after 'DEFAULT SCHEMA'.`);
          return j + 2;
        }
        return end;
      }
      case 'READS': {
        if (w2 !== 'SQL' || w3 !== 'DATA' || kind === 'library') return -1;
        addClause('READS SQL DATA', j);
        if (up(j + 3) === 'WITH' && up(j + 4) === 'RESULT' && up(j + 5) === 'VIEW') {
          const end = parseName(j + 6);
          if (end < 0) {
            issue('HANA-SYN-040', Math.min(j + 6, tokens.length - 1), `Expected view name after 'WITH RESULT VIEW'.`);
            return j + 6;
          }
          return end;
        }
        return j + 3;
      }
      case 'VARIABLE': {
        if (w2 !== 'CACHE' || kind === 'library') return -1;
        addClause('VARIABLE CACHE', j);
        let k = j + 2;
        if (up(k) !== 'ON') {
          argTypo(k, ['ON'], 'VARIABLE CACHE');
          return k;
        }
        k++;
        for (;;) {
          if (text(k) === '(') {
            const close = matchParen(k);
            k = close >= 0 ? close + 1 : k + 1;
          } else if (tokens[k]?.type === 'word' && !CLAUSE_STARTERS.has(up(k))) {
            k++;
          } else {
            issue('HANA-SYN-040', Math.min(k, tokens.length - 1), `Expected variable name in 'VARIABLE CACHE ON' list.`);
            return k;
          }
          if (up(k) === 'ENABLE' || up(k) === 'DISABLE' || up(k) === 'AUTOMATIC') k++;
          if (text(k) !== ',') return k;
          k++;
        }
      }
      case 'DETERMINISTIC':
        if (kind === 'library') return -1;
        addClause('DETERMINISTIC', j);
        return j + 1;
      case 'WITH':
        if (w2 === 'ENCRYPTION' && kind !== 'library') {
          addClause('WITH ENCRYPTION', j);
          return j + 2;
        }
        return -1;
      case 'AUTOCOMMIT':
        if (w2 !== 'DDL' || kind === 'library') return -1;
        addClause('AUTOCOMMIT DDL', j);
        if (w3 === 'ON' || w3 === 'OFF') return j + 3;
        argTypo(j + 2, ['ON', 'OFF'], 'AUTOCOMMIT DDL');
        return j + 2;
      case 'STRUCTURED':
        if (w2 !== 'FILTER' || w3 !== 'CHECK' || kind === 'library') return -1;
        addClause('STRUCTURED FILTER CHECK', j);
        return j + 3;
      case 'NO':
        if (w2 === 'STRUCTURED' && w3 === 'FILTER' && up(j + 3) === 'CHECK' && kind !== 'library') {
          addClause('STRUCTURED FILTER CHECK', j);
          return j + 4;
        }
        return -1;
      case 'SEQUENTIAL':
      case 'PARALLEL':
        if (w2 !== 'EXECUTION' || kind === 'library') return -1;
        addClause(`${w} EXECUTION`, j);
        return j + 2;
      case 'AUTONOMOUS':
        if (w2 !== 'TRANSACTION' || kind === 'library') return -1;
        addClause('AUTONOMOUS TRANSACTION', j);
        return j + 2;
      case 'TEST':
        if (kind !== 'library') return -1;
        addClause('TEST', j);
        return j + 1;
      case 'CONFIGURATION':
        if (!isVirtual) return -1;
        addClause('CONFIGURATION', j);
        if (tokens[j + 1]?.type === 'string') return j + 2;
        issue('HANA-SYN-040', Math.min(j + 1, tokens.length - 1), `Expected configuration string literal after 'CONFIGURATION'.`);
        return j + 1;
      case 'AT': {
        if (!isVirtual) return -1;
        addClause('AT', j);
        const end = parseName(j + 1);
        if (end < 0) {
          issue('HANA-SYN-040', Math.min(j + 1, tokens.length - 1), `Expected remote location after 'AT'.`);
          return j + 1;
        }
        return end;
      }
      default:
        return -1;
    }
  };

  while (i < tokens.length) {
    const t = tokens[i];
    const w = up(i);

    if (t.text === ';') {
      if (isAlter && asIdx < 0) {
        // Option-only ALTER (`ALTER FUNCTION f [NO] STRUCTURED FILTER CHECK;`)
        isManagementForm = true;
      } else if (builtin) {
        // System library signatures (`PROCEDURE ... AS BUILTIN;`)
      } else if (!headerOnly && !isVirtual && asIdx < 0) {
        issue('HANA-SYN-040', i, `Incomplete ${kindWord} header: expected 'AS' followed by 'BEGIN' or 'HEADER ONLY' before ';'.`);
      } else if (!headerOnly && !isVirtual && kind !== 'library') {
        issue('HANA-SYN-040', i, `Expected 'BEGIN' or 'HEADER ONLY' after 'AS' in ${kindWord} header.`);
      }
      return result(-1, i + 1);
    }

    if (w === 'BEGIN') {
      if (asIdx < 0 && !isVirtual) {
        issue('HANA-SYN-040', i, `Missing 'AS' before 'BEGIN' in ${kindWord} header.`, { insertBefore: 'AS ' });
      }
      return result(i, i + 1);
    }

    if (w === 'AS') {
      if (asIdx >= 0) {
        issue('HANA-SYN-040', i, `Duplicate 'AS' in ${kindWord} header.`);
      } else {
        asIdx = i;
      }
      inJunk = false;
      i++;
      continue;
    }

    if (w === 'BUILTIN' && asIdx >= 0 && !builtin) {
      builtin = true; // `SYS.SQLSCRIPT_*` built-in library signatures
      inJunk = false;
      i++;
      continue;
    }

    if (w === 'USING' && kind !== 'library') {
      usingIdxs.push({ tokIdx: i, afterAs: asIdx >= 0 });
      let k = parseName(i + 1);
      if (k < 0) {
        issue('HANA-SYN-040', Math.min(i + 1, tokens.length - 1), `Expected library name after 'USING'.`);
        k = i + 1;
      } else if (up(k) === 'AS') {
        const aliasEnd = parseName(k + 1);
        k = aliasEnd < 0 ? k + 1 : aliasEnd;
      }
      if (text(k) === ';') {
        k++;
      } else if (k < tokens.length) {
        issue('HANA-SYN-040', k, `Expected ';' after 'USING' library declaration.`);
      }
      inJunk = false;
      i = k;
      continue;
    }

    if (w === 'HEADER' && up(i + 1) === 'ONLY') {
      if (asIdx < 0 && !isVirtual) issue('HANA-SYN-040', i, `'HEADER ONLY' must follow 'AS'.`, { insertBefore: 'AS ' });
      headerOnly = true;
      i += 2;
      if (up(i) === 'ON' && up(i + 1) === 'INVALID') {
        i += 2;
        headerOnly = false; // `AS HEADER ONLY ON INVALID BEGIN ... END`
      }
      inJunk = false;
      if (headerOnly && i < tokens.length && text(i) !== ';') {
        issue('HANA-SYN-040', i, `Expected ';' after 'HEADER ONLY'.`);
      }
      if (headerOnly) return result(-1, text(i) === ';' ? i + 1 : i);
      continue;
    }

    const next = parseClause(i);
    if (next >= 0) {
      inJunk = false;
      i = next;
      continue;
    }

    // Unconsumed token: typo against this slot's follow-set, else an unexpected-token diagnostic.
    const expected = asIdx >= 0 ? expectedPost : expectedPre.filter((e) => !seen.has(e) || e === 'AS');
    const fix = t.type === 'word' && !alias.has(i) ? suggestSlotKeyword(t.text, firstWords(expected)) : null;
    if (fix) {
      issue('HANA-SYN-021', i, `Unknown keyword '${t.text}' in ${kindWord} header. Did you mean '${fix}'?`, { replaceWith: fix });
      alias.set(i, fix);
      inJunk = false;
      continue; // re-dispatch as the suggested keyword
    }
    if (isVirtual) {
      i++; // long-tail virtual routine options (remote adapter properties) are not validated
      continue;
    }
    if (!inJunk) {
      const where = asIdx >= 0 ? `after 'AS'` : `in ${kindWord} header`;
      issue('HANA-SYN-040', i, `Unexpected '${t.text}' ${where}; expected ${formatExpected(expected)}.`);
      inJunk = true;
    }
    i++;
  }

  if (!isVirtual && asIdx < 0 && tokens.length > 0) {
    issue('HANA-SYN-040', tokens.length - 1, `Incomplete ${kindWord} header: expected 'AS' followed by 'BEGIN' or 'HEADER ONLY'.`);
  }
  return result(-1, i);

  // ---- Trigger tail --------------------------------------------------------------------------------------
  function parseTriggerTail(start: number): ParsedRoutineHeader {
    let j = start;
    const expectAt = (k: number, expected: readonly string[], context: string): boolean => {
      if (expected.includes(up(k))) return true;
      const t = tokens[k];
      const fix = t && t.type === 'word' ? suggestSlotKeyword(t.text, expected) : null;
      if (fix && t) {
        issue('HANA-SYN-021', k, `Unknown keyword '${t.text}' ${context}. Did you mean '${fix}'?`, { replaceWith: fix });
        alias.set(k, fix);
        return true;
      }
      issue('HANA-SYN-040', Math.min(k, tokens.length - 1), `Expected ${formatExpected(expected)} ${context}${t ? `, found '${t.text}'` : ''}.`);
      return false;
    };
    const stop = (): ParsedRoutineHeader => {
      while (j < tokens.length && text(j) !== ';' && up(j) !== 'BEGIN') j++;
      return up(j) === 'BEGIN' ? result(j, j + 1) : result(-1, text(j) === ';' ? j + 1 : j);
    };

    // <trigger_action_time> ::= BEFORE | AFTER | INSTEAD OF
    if (!expectAt(j, ['BEFORE', 'AFTER', 'INSTEAD'], 'in TRIGGER header (action time)')) return stop();
    if (up(j) === 'INSTEAD') {
      j++;
      if (!expectAt(j, ['OF'], "after 'INSTEAD'")) return stop();
    }
    j++;

    // <trigger_event_list> ::= <trigger_event> { OR <trigger_event> }
    for (;;) {
      if (!expectAt(j, ['INSERT', 'UPDATE', 'DELETE'], 'in TRIGGER header (event)')) return stop();
      const ev = up(j);
      j++;
      if (ev === 'UPDATE' && (up(j) === 'OF' || (up(j) === 'EXCEPT' && up(j + 1) === 'OF'))) {
        j += up(j) === 'EXCEPT' ? 2 : 1;
        for (;;) {
          const end = parseName(j);
          if (end < 0) {
            issue('HANA-SYN-040', Math.min(j, tokens.length - 1), `Expected column name in 'UPDATE OF' list.`);
            return stop();
          }
          j = end;
          if (text(j) !== ',') break;
          j++;
        }
      }
      if (up(j) !== 'OR') break;
      j++;
    }

    // ON <subject_table_name>
    if (!expectAt(j, ['ON'], 'in TRIGGER header (before subject table)')) return stop();
    const subjEnd = parseName(j + 1);
    if (subjEnd < 0) {
      issue('HANA-SYN-040', Math.min(j + 1, tokens.length - 1), `Expected subject table name after 'ON'.`);
      return stop();
    }
    j = subjEnd;

    // [ REFERENCING <transition> { , <transition> } ]
    if (up(j) === 'REFERENCING') {
      j++;
      for (;;) {
        if (!expectAt(j, ['OLD', 'NEW'], 'in REFERENCING transition')) return stop();
        j++;
        if (!expectAt(j, ['ROW', 'TABLE'], `after '${up(j - 1)}'`)) return stop();
        j++;
        if (up(j) === 'AS') j++;
        const end = parseName(j);
        if (end < 0) {
          issue('HANA-SYN-040', Math.min(j, tokens.length - 1), `Expected transition variable name in REFERENCING clause.`);
          return stop();
        }
        j = end;
        if (text(j) !== ',') break;
        j++;
      }
    }

    // [ FOR EACH { ROW | STATEMENT } ]
    if (up(j) === 'FOR') {
      j++;
      if (!expectAt(j, ['EACH'], "after 'FOR'")) return stop();
      j++;
      if (!expectAt(j, ['ROW', 'STATEMENT'], "after 'FOR EACH'")) return stop();
      j++;
    }

    // [ { FOLLOWS | PRECEDES } <trigger_name> { , <trigger_name> } ]
    if (up(j) === 'FOLLOWS' || up(j) === 'PRECEDES') {
      j++;
      for (;;) {
        const end = parseName(j);
        if (end < 0) {
          issue('HANA-SYN-040', Math.min(j, tokens.length - 1), `Expected trigger name in ordering clause.`);
          return stop();
        }
        j = end;
        if (text(j) !== ',') break;
        j++;
      }
    }

    // [ ONLINE ] BEGIN
    if (up(j) === 'ONLINE') j++;
    if (up(j) === 'BEGIN') return result(j, j + 1);
    const t = tokens[j];
    const fix = t && t.type === 'word' ? suggestSlotKeyword(t.text, ['BEGIN', 'ONLINE']) : null;
    if (fix === 'BEGIN' && t) {
      issue('HANA-SYN-021', j, `Unknown keyword '${t.text}' in TRIGGER header. Did you mean 'BEGIN'?`, { replaceWith: fix });
      return result(j, j + 1);
    }
    issue(
      'HANA-SYN-040',
      Math.min(j, tokens.length - 1),
      t
        ? `Unexpected '${t.text}' in TRIGGER header; expected 'BEGIN' (optional clauses must follow the order REFERENCING, FOR EACH, FOLLOWS | PRECEDES, ONLINE).`
        : `Incomplete TRIGGER header: expected 'BEGIN'.`
    );
    return stop();
  }
}
