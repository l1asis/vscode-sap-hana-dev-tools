export type OpenDelim = '(' | '[' | '{';
export type CloseDelim = ')' | ']' | '}';
export type FenceSemicolonMode = 'all' | 'non-block-non-for' | 'none';

export interface DelimTokenInput {
  readonly ch: OpenDelim | CloseDelim | ';';
  readonly start: number;
  readonly end: number;
  /** Token index in caller stream, useful for custom spanPenalty hooks. */
  readonly tokenIdx?: number;
  /** JS `for (` header where semicolons inside `(...)` are expected. */
  readonly forHeader?: boolean;
  /** SQL inline precision/length datatype opener like `DECIMAL(` or `NVARCHAR(`. */
  readonly isTypeArgOpener?: boolean;
}

export interface DelimDiagnostic {
  readonly kind: 'unmatched-close' | 'mismatch-close' | 'unclosed-open';
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly expectedCh?: CloseDelim;
  /** Offset of the enclosing matched closer before which an unclosed container should stop. */
  readonly stopBeforeOffset?: number;
}

export interface DelimAnalysisOptions {
  readonly fenceSemicolon?: FenceSemicolonMode;
  readonly lineStarts?: readonly number[];
  readonly spanPenalty?: (open: DelimTokenInput, close: DelimTokenInput, openLine: number, closeLine: number) => number;
}

export interface DelimAnalysisResult {
  readonly diagnostics: DelimDiagnostic[];
  /** Start offsets of openers identified as unclosed -> optional enclosing stopBeforeOffset. */
  readonly unclosedStarts: Map<number, number | undefined>;
  /** Start offsets of closers identified as unmatched / stray. */
  readonly unmatchedCloseStarts: Set<number>;
}

interface PositionedDelim {
  readonly input: DelimTokenInput;
  readonly ch: OpenDelim | CloseDelim;
  readonly isOpen: boolean;
  readonly line: number;
  readonly indent: number;
  readonly isLineStart: boolean;
  readonly isLineEnd: boolean;
  /** Brace depth (`{ ... }`) active when this delimiter appeared (for JS semi fencing). */
  readonly braceDepth: number;
  /** Ordinal index of this token within its chunk (including semicolons). */
  readonly streamOrder: number;
}

const SKIP_COST = 1000;
const FENCE_PENALTY = 10000;
const MAX_DP_DELIMS = 96;

export function matchingCloser(ch: OpenDelim): CloseDelim {
  if (ch === '(') return ')';
  if (ch === '[') return ']';
  return '}';
}

export function matchingOpener(ch: CloseDelim): OpenDelim {
  if (ch === ')') return '(';
  if (ch === ']') return '[';
  return '{';
}

export function isOpenDelim(ch: string): ch is OpenDelim {
  return ch === '(' || ch === '[' || ch === '{';
}

export function isCloseDelim(ch: string): ch is CloseDelim {
  return ch === ')' || ch === ']' || ch === '}';
}

export function computeLineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

export function findLineForOffset(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}

/**
 * Analyzes `( )`, `[ ]`, and `{ }` delimiters using an O(N) fast path for balanced code
 * and indentation-/boundary-aware minimum-cost alignment when an imbalance exists,
 * so deleting a bracket inside an outer pair blames the inner missing bracket rather than
 * shifting blame to the outermost declaration.
 */
export function analyzeDelimiters(
  text: string,
  tokens: readonly DelimTokenInput[],
  options: DelimAnalysisOptions = {}
): DelimAnalysisResult {
  const fenceMode: FenceSemicolonMode = options.fenceSemicolon ?? 'none';
  const unclosedStarts = new Map<number, number | undefined>();
  const unmatchedCloseStarts = new Set<number>();
  const diagnostics: DelimDiagnostic[] = [];

  if (tokens.length === 0 || isFastBalanced(tokens, fenceMode)) {
    return { diagnostics, unclosedStarts, unmatchedCloseStarts };
  }

  const lineStarts = options.lineStarts ?? computeLineStartOffsets(text);
  const lineIndentCache = new Map<number, number>();
  const getLineIndent = (line: number): number => {
    let cached = lineIndentCache.get(line);
    if (cached !== undefined) return cached;
    const s = lineStarts[line] ?? 0;
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
    let indent = 0;
    for (let k = s; k < end; k++) {
      const c = text[k];
      if (c === ' ') indent++;
      else if (c === '\t') indent += 4;
      else break;
    }
    lineIndentCache.set(line, indent);
    return indent;
  };

  const toPositioned = (tok: DelimTokenInput, braceDepth: number, streamOrder: number): PositionedDelim => {
    const ch = tok.ch as OpenDelim | CloseDelim;
    const line = findLineForOffset(lineStarts, tok.start);
    const lStart = lineStarts[line] ?? 0;
    const rawEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
    const lEnd = rawEnd > lStart && text[rawEnd - 1] === '\n' ? rawEnd - 1 : rawEnd;

    let isLineStart = true;
    for (let k = lStart; k < tok.start; k++) {
      const c = text[k];
      if (c !== ' ' && c !== '\t') {
        isLineStart = false;
        break;
      }
    }

    let isLineEnd = true;
    for (let k = tok.end; k < lEnd; k++) {
      const c = text[k];
      if (c === ' ' || c === '\t' || c === '\r') continue;
      if ((c === '/' && text[k + 1] === '/') || (c === '-' && text[k + 1] === '-')) break;
      isLineEnd = false;
      break;
    }

    return {
      input: tok,
      ch,
      isOpen: isOpenDelim(ch),
      line,
      indent: getLineIndent(line),
      isLineStart,
      isLineEnd,
      braceDepth,
      streamOrder,
    };
  };

  const chunks: Array<{ delims: PositionedDelim[]; unbracedSemiOrders: ReadonlyMap<number, number[]> }> = [];
  if (fenceMode === 'all') {
    let current: DelimTokenInput[] = [];
    for (const tok of tokens) {
      if (tok.ch === ';') {
        if (current.length > 0 && !isFastBalanced(current, 'none')) {
          chunks.push(buildChunkData(current, toPositioned, false));
        }
        current = [];
      } else {
        current.push(tok);
      }
    }
    if (current.length > 0 && !isFastBalanced(current, 'none')) {
      chunks.push(buildChunkData(current, toPositioned, false));
    }
  } else {
    chunks.push(buildChunkData(tokens, toPositioned, fenceMode === 'non-block-non-for'));
  }

  for (const chunk of chunks) {
    resolveUnbalancedChunk(
      chunk.delims,
      chunk.unbracedSemiOrders,
      options.spanPenalty,
      diagnostics,
      unclosedStarts,
      unmatchedCloseStarts
    );
  }

  diagnostics.sort((a, b) => a.start - b.start);
  return { diagnostics, unclosedStarts, unmatchedCloseStarts };
}

function isFastBalanced(tokens: readonly DelimTokenInput[], fenceMode: FenceSemicolonMode): boolean {
  const stack: DelimTokenInput[] = [];
  for (const tok of tokens) {
    if (tok.ch === ';') {
      if (fenceMode === 'all' && stack.length > 0) return false;
      if (fenceMode === 'non-block-non-for' && stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.ch === '[' || (top.ch === '(' && !top.forHeader)) return false;
      }
      continue;
    }
    if (isOpenDelim(tok.ch)) {
      stack.push(tok);
    } else {
      const top = stack.pop();
      if (!top || matchingCloser(top.ch as OpenDelim) !== tok.ch) return false;
    }
  }
  return stack.length === 0;
}

function buildChunkData(
  tokens: readonly DelimTokenInput[],
  toPositioned: (tok: DelimTokenInput, braceDepth: number, streamOrder: number) => PositionedDelim,
  trackSemiEpochs: boolean
): { delims: PositionedDelim[]; unbracedSemiOrders: ReadonlyMap<number, number[]> } {
  const delims: PositionedDelim[] = [];
  const unbracedSemiOrders = new Map<number, number[]>();
  let braceDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.ch === ';') {
      if (trackSemiEpochs) {
        let arr = unbracedSemiOrders.get(braceDepth);
        if (!arr) {
          arr = [];
          unbracedSemiOrders.set(braceDepth, arr);
        }
        arr.push(i);
      }
      continue;
    }
    if (tok.ch === '{') {
      delims.push(toPositioned(tok, braceDepth, i));
      braceDepth++;
    } else if (tok.ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      delims.push(toPositioned(tok, braceDepth, i));
    } else {
      delims.push(toPositioned(tok, braceDepth, i));
    }
  }

  return { delims, unbracedSemiOrders };
}

function hasSemiInRange(sortedOrders: readonly number[] | undefined, fromOrder: number, toOrder: number): boolean {
  if (!sortedOrders || sortedOrders.length === 0) return false;
  let lo = 0;
  let hi = sortedOrders.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = sortedOrders[mid];
    if (v <= fromOrder) lo = mid + 1;
    else if (v >= toOrder) hi = mid - 1;
    else return true;
  }
  return false;
}

function resolveUnbalancedChunk(
  delims: readonly PositionedDelim[],
  unbracedSemiOrders: ReadonlyMap<number, number[]>,
  spanPenalty: DelimAnalysisOptions['spanPenalty'],
  diagnostics: DelimDiagnostic[],
  unclosedStarts: Map<number, number | undefined>,
  unmatchedCloseStarts: Set<number>
): void {
  // 1. Only pre-collapse tight same-line pairs if the chunk exceeds MAX_DP_DELIMS,
  //    so small/medium chunks let DP jointly weigh spanPenalty & layout across every bracket.
  let rem: PositionedDelim[];
  if (delims.length <= MAX_DP_DELIMS) {
    rem = [...delims];
  } else {
    const paired = new Array<boolean>(delims.length).fill(false);
    const stack: number[] = [];
    for (let i = 0; i < delims.length; i++) {
      const d = delims[i];
      if (d.isOpen) {
        stack.push(i);
        continue;
      }
      const topIdx = stack.length > 0 ? stack[stack.length - 1] : -1;
      if (topIdx >= 0 && delims[topIdx].line === d.line && matchingCloser(delims[topIdx].ch as OpenDelim) === d.ch) {
        const openD = delims[topIdx];
        const fencedOut =
          (openD.ch !== '{' &&
            !openD.input.forHeader &&
            hasSemiInRange(unbracedSemiOrders.get(openD.braceDepth), openD.streamOrder, d.streamOrder)) ||
          (spanPenalty ? spanPenalty(openD.input, d.input, openD.line, d.line) > 0 : false);
        if (!fencedOut) {
          stack.pop();
          paired[topIdx] = true;
          paired[i] = true;
          continue;
        }
      }
      stack.length = 0;
    }

    rem = [];
    for (let i = 0; i < delims.length; i++) {
      if (!paired[i]) rem.push(delims[i]);
    }
  }
  if (rem.length === 0) return;

  if (rem.length > MAX_DP_DELIMS) {
    fallbackStackDiagnostics(rem, diagnostics, unclosedStarts, unmatchedCloseStarts);
    return;
  }

  // 2. Minimum-cost non-crossing bracket alignment across the reduced sequence.
  const m = rem.length;
  const dp: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const choice: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(-1));

  const computePairCost = (i: number, k: number): number => {
    const o = rem[i];
    const c = rem[k];
    if (!o.isOpen || c.isOpen || matchingCloser(o.ch as OpenDelim) !== c.ch) {
      return Infinity;
    }
    if (
      o.ch !== '{' &&
      !o.input.forHeader &&
      hasSemiInRange(unbracedSemiOrders.get(o.braceDepth), o.streamOrder, c.streamOrder)
    ) {
      return FENCE_PENALTY;
    }

    let cost = 0;
    if (o.line < c.line) {
      if (c.isLineStart) {
        if (c.indent < o.indent) cost += 220 + Math.min(80, o.indent - c.indent);
        else if (c.indent > o.indent) cost += 120 + Math.min(80, c.indent - o.indent);
      } else {
        if (c.indent === o.indent) cost += 15;
        else if (c.indent < o.indent) cost += 180 + Math.min(80, o.indent - c.indent);
        else cost += 80 + Math.min(80, c.indent - o.indent);
      }
      if (o.isLineEnd && !c.isLineStart) cost += 45;
      if (!o.isLineEnd && c.isLineStart) cost += 45;
    }

    if (spanPenalty) {
      cost += spanPenalty(o.input, c.input, o.line, c.line);
    }

    // Small distance tie-breaker prefers innermost balanced pairs when layout is symmetric.
    cost += (k - i) * 0.1 + Math.min(20, (c.line - o.line) * 0.25);
    return cost;
  };

  for (let len = 1; len <= m; len++) {
    for (let i = 0; i + len <= m; i++) {
      const j = i + len - 1;
      let best = SKIP_COST + (i + 1 <= j ? dp[i + 1][j] : 0);
      let bestChoice = -1;

      if (rem[i].isOpen) {
        const expectedClose = matchingCloser(rem[i].ch as OpenDelim);
        for (let k = i + 1; k <= j; k++) {
          if (rem[k].ch !== expectedClose) continue;
          const pCost = computePairCost(i, k);
          if (!Number.isFinite(pCost) || pCost >= FENCE_PENALTY) continue;
          const inner = i + 1 <= k - 1 ? dp[i + 1][k - 1] : 0;
          const after = k + 1 <= j ? dp[k + 1][j] : 0;
          const total = pCost + inner + after;
          if (total < best) {
            best = total;
            bestChoice = k;
          }
        }
      }

      dp[i][j] = best;
      choice[i][j] = bestChoice;
    }
  }

  // 3. Reconstruct matched pairs and unmatched indices.
  const matchedPairs: Array<{ readonly openIdx: number; readonly closeIdx: number }> = [];
  const unmatchedIndices: number[] = [];

  const reconstruct = (l: number, r: number): void => {
    if (l > r) return;
    const k = choice[l][r];
    if (k < 0) {
      unmatchedIndices.push(l);
      reconstruct(l + 1, r);
    } else {
      matchedPairs.push({ openIdx: l, closeIdx: k });
      reconstruct(l + 1, k - 1);
      reconstruct(k + 1, r);
    }
  };
  reconstruct(0, m - 1);

  const enclosesNoCrossing = (u1: number, u2: number): boolean => {
    for (const pair of matchedPairs) {
      const oInside = pair.openIdx > u1 && pair.openIdx < u2;
      const cInside = pair.closeIdx > u1 && pair.closeIdx < u2;
      if (oInside !== cInside) return false;
    }
    return true;
  };

  // Find innermost matched closer enclosing each unmatched opener (used by JSON recovery AST).
  const findStopBeforeOffset = (uIdx: number): number | undefined => {
    let bestCloseStart: number | undefined;
    for (const pair of matchedPairs) {
      if (pair.openIdx < uIdx && uIdx < pair.closeIdx) {
        const cStart = rem[pair.closeIdx].input.start;
        if (bestCloseStart === undefined || cStart < bestCloseStart) {
          bestCloseStart = cStart;
        }
      }
    }
    return bestCloseStart;
  };

  for (let u = 0; u < unmatchedIndices.length; u++) {
    const idx = unmatchedIndices[u];
    const tok = rem[idx];
    const nextIdx = u + 1 < unmatchedIndices.length ? unmatchedIndices[u + 1] : -1;

    // Pair adjacent unmatched opener + mismatched closer cleanly when no matched bracket crosses them
    if (
      tok.isOpen &&
      nextIdx >= 0 &&
      !rem[nextIdx].isOpen &&
      matchingCloser(tok.ch as OpenDelim) !== rem[nextIdx].ch &&
      enclosesNoCrossing(idx, nextIdx)
    ) {
      const closer = rem[nextIdx];
      const expectedCh = matchingCloser(tok.ch as OpenDelim);
      unclosedStarts.set(tok.input.start, findStopBeforeOffset(idx));
      unmatchedCloseStarts.add(closer.input.start);
      diagnostics.push({
        kind: 'mismatch-close',
        start: closer.input.start,
        end: closer.input.end,
        expectedCh,
        message: `Unexpected closing delimiter '${closer.ch}'. Expected '${expectedCh}'.`,
      });
      u++;
      continue;
    }

    if (tok.isOpen) {
      const stopBefore = findStopBeforeOffset(idx);
      unclosedStarts.set(tok.input.start, stopBefore);
      diagnostics.push({
        kind: 'unclosed-open',
        start: tok.input.start,
        end: tok.input.end,
        stopBeforeOffset: stopBefore,
        message: `Unclosed delimiter '${tok.ch}'.`,
      });
    } else {
      unmatchedCloseStarts.add(tok.input.start);
      diagnostics.push({
        kind: 'unmatched-close',
        start: tok.input.start,
        end: tok.input.end,
        message: `Unmatched closing delimiter '${tok.ch}'.`,
      });
    }
  }
}

function fallbackStackDiagnostics(
  rem: readonly PositionedDelim[],
  diagnostics: DelimDiagnostic[],
  unclosedStarts: Map<number, number | undefined>,
  unmatchedCloseStarts: Set<number>
): void {
  const stack: PositionedDelim[] = [];
  for (const d of rem) {
    if (d.isOpen) {
      stack.push(d);
    } else {
      const expected = matchingOpener(d.ch as CloseDelim);
      const top = stack[stack.length - 1];
      if (!top) {
        unmatchedCloseStarts.add(d.input.start);
        diagnostics.push({
          kind: 'unmatched-close',
          start: d.input.start,
          end: d.input.end,
          message: `Unmatched closing delimiter '${d.ch}'.`,
        });
      } else if (top.ch !== expected) {
        const expectedCh = matchingCloser(top.ch as OpenDelim);
        unmatchedCloseStarts.add(d.input.start);
        diagnostics.push({
          kind: 'mismatch-close',
          start: d.input.start,
          end: d.input.end,
          expectedCh,
          message: `Unexpected closing delimiter '${d.ch}'. Expected '${expectedCh}'.`,
        });
        let found = -1;
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].ch === expected) {
            found = k;
            break;
          }
        }
        if (found >= 0) stack.length = found;
      } else {
        stack.pop();
      }
    }
  }

  for (const unclosed of stack) {
    unclosedStarts.set(unclosed.input.start, undefined);
    diagnostics.push({
      kind: 'unclosed-open',
      start: unclosed.input.start,
      end: unclosed.input.end,
      message: `Unclosed delimiter '${unclosed.ch}'.`,
    });
  }
}
