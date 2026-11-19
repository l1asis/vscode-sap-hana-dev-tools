/**
 * Keyword typo matching shared by the SQL / SQLScript, CDS, and XSJS syntax analyzers.
 */

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

/**
 * Suggests the keyword a token most likely meant when it sits in a parser slot whose follow-set is known
 * (`expected`). Unlike {@link matchKeywordTypo}, the token is already known to be invalid in this slot, so
 * short keywords (`AS`, `ON`, `IN`, `OF`, `OR`, `TO`) and 3-letter typos of 4-letter keywords are matched too:
 * a 1-edit typo with the same leading character (`ASd` -> `AS`, `INN` -> `IN`, `DSC` -> `DESC`). Returns `null` when nothing matches unambiguously.
 */
export function suggestSlotKeyword(rawWord: string, expected: readonly string[]): string | null {
  const upper = rawWord.toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(upper)) return null;
  const long = matchKeywordTypo(rawWord, expected.filter((c) => c.length >= 4));
  if (long) return long;
  let best: string | null = null;
  let tied = false;
  for (const cand of expected) {
    if (cand.length > 4 || upper.length < 2 || (cand.length === 4 && upper.length !== 3)) continue;
    if (Math.abs(upper.length - cand.length) > 1 || upper[0] !== cand[0]) continue;
    if (damerauLevenshtein(upper, cand) !== 1) continue;
    if (best && best !== cand) tied = true;
    best = cand;
  }
  return best && !tied ? best : null;
}

/**
 * Like {@link suggestSlotKeyword}, for a **closed** option slot: the slot holds only the few words in `options`
 * (`CYCLE BREAKUP | ERROR`), so a 2-edit typo of an option of 5+ letters with the same leading character is
 * matched too (`BRKUP` -> `BREAKUP`). Returns `null` when nothing matches unambiguously.
 */
export function suggestOptionKeyword(rawWord: string, options: readonly string[]): string | null {
  const slot = suggestSlotKeyword(rawWord, options);
  if (slot) return slot;
  const upper = rawWord.toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(upper) || upper.length < 3) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  let tied = false;
  for (const cand of options) {
    if (cand.length < 5 || upper[0] !== cand[0] || Math.abs(upper.length - cand.length) > 2) continue;
    const d = damerauLevenshtein(upper, cand);
    if (d > 2) continue;
    if (d < bestDist) {
      best = cand;
      bestDist = d;
      tied = false;
    } else if (d === bestDist) {
      tied = true;
    }
  }
  return best && !tied ? best : null;
}
