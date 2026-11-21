export type DiagnosticSeverityLevel = 'error' | 'warning' | 'information' | 'hint';

export type DiagnosticTagKind = 'deprecated' | 'unnecessary';

export type DiagnosticCategory =
  | 'security'
  | 'performance'
  | 'lint'
  | 'migration'
  | 'calculationview'
  | 'syntax';

export type TargetPlatform = 'auto' | 'xsc' | 'hdi' | 'cloud';

export interface TextEditSpan {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

export interface CodeFixSuggestion {
  readonly title: string;
  readonly kind: 'quickfix' | 'refactor' | 'source';
  readonly isPreferred?: boolean;
  readonly edits: readonly TextEditSpan[];
  /** Also rename the document's file, replacing its last suffix (`f.searchruleset` -> `f.hdbsearchruleset`). */
  readonly rename?: { readonly toExtension: string };
}

export interface AnalyzerDiagnostic {
  readonly ruleId: string;
  readonly sapCode?: string;
  readonly category: DiagnosticCategory;
  readonly severity: DiagnosticSeverityLevel;
  readonly tags?: readonly DiagnosticTagKind[];
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly fixes: readonly CodeFixSuggestion[];
}

export interface AnalyzerOptions {
  readonly security: boolean;
  readonly performance: boolean;
  readonly migration: boolean;
  readonly calculationView: boolean;
  readonly syntax: boolean;
  readonly targetPlatform: TargetPlatform;
}

export const DEFAULT_ANALYZER_OPTIONS: AnalyzerOptions = {
  security: true,
  performance: true,
  migration: true,
  calculationView: true,
  syntax: true,
  targetPlatform: 'auto',
};

export interface AnalyzerContext {
  readonly text: string;
  readonly languageId: string;
  readonly filePath?: string;
  readonly options?: Partial<AnalyzerOptions>;
}

export interface TextPosition {
  readonly line: number;
  readonly character: number;
}

/**
 * Fast line-start index mapping character offsets to 0-based `(line, character)` coordinates.
 */
export class LineIndex {
  private readonly lineStarts: number[];

  constructor(private readonly text: string) {
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        this.lineStarts.push(i + 1);
      }
    }
  }

  lineAt(offset: number): number {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.lineStarts[mid] <= clamped) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return hi;
  }

  positionAt(offset: number): TextPosition {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    const line = this.lineAt(clamped);
    return {
      line,
      character: clamped - this.lineStarts[line],
    };
  }
}

/**
 * Applies non-overlapping `TextEditSpan` replacements to `text` deterministically.
 */
export function applyTextEdits(text: string, edits: readonly TextEditSpan[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let lastStart = out.length + 1;
  for (const edit of sorted) {
    const start = Math.max(0, Math.min(edit.start, out.length));
    const end = Math.max(start, Math.min(edit.end, out.length));
    if (end > lastStart) continue;
    out = out.slice(0, start) + edit.newText + out.slice(end);
    lastStart = start;
  }
  return out;
}

const SAP_TO_HANA_RULES: Readonly<Record<string, readonly string[]>> = {
  UNCHECKED_SQL_INJECTION_SAFETY: ['HANA-SEC-001', 'HANA-SEC-002', 'HANA-SEC-005'],
  USE_OF_DYNAMIC_SQL: ['HANA-SEC-001', 'HANA-SEC-003', 'HANA-PERF-006'],
  USE_OF_CE_FUNCTIONS: ['HANA-PERF-001', 'HANA-PERF-002'],
  DML_STATEMENTS_IN_LOOPS: ['HANA-PERF-005'],
  USE_OF_DDL_STATEMENT: ['HANA-PERF-006'],
  USE_OF_WITH_HINT_CLAUSE: ['HANA-PERF-006'],
  ROW_COUNT_AFTER_SELECT: ['HANA-LINT-002'],
  ROW_COUNT_AFTER_DYNAMIC_SQL: ['HANA-LINT-002'],
  COMMIT_OR_ROLLBACK_IN_DYNAMIC_SQL: ['HANA-PERF-006'],
};

export interface SuppressionTracker {
  isSuppressed(ruleId: string, category: DiagnosticCategory, line: number, sapCode?: string): boolean;
}

interface SuppressionEntry {
  readonly line: number;
  readonly endLine?: number;
  readonly fileWide?: boolean;
  readonly tokens: readonly string[];
}

function normalizeSuppressionToken(raw: string): string[] {
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, '').toUpperCase();
  if (!cleaned) return [];
  const results = [cleaned];
  // Map SAP.FOO.CATEGORY -> FOO and associated HANA-* IDs
  const sapMatch = /^SAP\.([A-Z0-9_]+)(?:\.[A-Z0-9_]+)?$/.exec(cleaned);
  if (sapMatch) {
    const base = sapMatch[1];
    results.push(base);
    const mapped = SAP_TO_HANA_RULES[base];
    if (mapped) results.push(...mapped);
  }
  return results;
}

/**
 * Parses `@AnalyzerSuppress(...)` and `hanasql-analyze-disable` pragmas across comments.
 */
export function buildSuppressionTracker(text: string): SuppressionTracker {
  const lines = text.split(/\r?\n/);
  const entries: SuppressionEntry[] = [];
  const openBlocks = new Map<string, number>();

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // 1. @AnalyzerSuppress('SAP.USE_OF_CE_FUNCTIONS.PERFORMANCE', ...)
    const sapSuppressRe = /@AnalyzerSuppress\s*\(([^)]+)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = sapSuppressRe.exec(line)) !== null) {
      const tokens = m[1].split(',').flatMap(normalizeSuppressionToken);
      if (tokens.length > 0) {
        entries.push({ line: lineIdx, tokens });
      }
    }

    // 2. hanasql-analyze-disable-file [RULES...]
    const fileDisableMatch = /hanasql-analyze-disable-file(?:\s+([^*>\r\n]+))?/i.exec(line);
    if (fileDisableMatch) {
      const rawList = fileDisableMatch[1]?.trim();
      const tokens = rawList
        ? rawList.split(/[\s,]+/).flatMap(normalizeSuppressionToken)
        : ['ALL'];
      entries.push({ line: 0, fileWide: true, tokens });
      continue;
    }

    // 3. hanasql-analyze-disable [RULES...]
    const disableMatch = /hanasql-analyze-disable(?!-file)(?:\s+([^*>\r\n]+))?/i.exec(line);
    if (disableMatch) {
      const rawList = disableMatch[1]?.trim();
      const tokens = rawList
        ? rawList.split(/[\s,]+/).flatMap(normalizeSuppressionToken)
        : ['ALL'];
      for (const tok of tokens) {
        if (!openBlocks.has(tok)) openBlocks.set(tok, lineIdx);
      }
      entries.push({ line: lineIdx, tokens });
    }

    // 4. hanasql-analyze-enable [RULES...]
    const enableMatch = /hanasql-analyze-enable(?:\s+([^*>\r\n]+))?/i.exec(line);
    if (enableMatch) {
      const rawList = enableMatch[1]?.trim();
      const tokens = rawList
        ? rawList.split(/[\s,]+/).flatMap(normalizeSuppressionToken)
        : [...openBlocks.keys()];
      for (const tok of tokens) {
        const startLine = openBlocks.get(tok);
        if (startLine !== undefined) {
          entries.push({ line: startLine, endLine: lineIdx, tokens: [tok] });
          openBlocks.delete(tok);
        }
      }
    }
  }

  const isCommentLine = (idx: number): boolean => {
    const trimmed = (lines[idx] ?? '').trim();
    return (
      trimmed === '' ||
      trimmed.startsWith('--') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('<!--')
    );
  };

  return {
    isSuppressed(ruleId: string, category: DiagnosticCategory, line: number, sapCode?: string): boolean {
      const candidates = new Set<string>([
        'ALL',
        ruleId.toUpperCase(),
        category.toUpperCase(),
      ]);
      if (sapCode) {
        for (const t of normalizeSuppressionToken(sapCode)) candidates.add(t);
      }

      for (const entry of entries) {
        if (!entry.tokens.some((t) => candidates.has(t))) continue;
        if (entry.fileWide) return true;
        if (entry.endLine !== undefined) {
          if (line >= entry.line && line <= entry.endLine) return true;
        }
        // Preceding consecutive comment block directly above target statement
        if (entry.line === line) return true;
        if (entry.line < line) {
          let onlyCommentsBetween = true;
          for (let k = entry.line + 1; k < line; k++) {
            if (!isCommentLine(k)) {
              onlyCommentsBetween = false;
              break;
            }
          }
          if (onlyCommentsBetween) return true;
        }
      }
      return false;
    },
  };
}

export function resolveAnalyzerOptions(partial?: Partial<AnalyzerOptions>): AnalyzerOptions {
  return {
    ...DEFAULT_ANALYZER_OPTIONS,
    ...(partial ?? {}),
  };
}

export function filterSuppressedDiagnostics(
  text: string,
  diagnostics: readonly AnalyzerDiagnostic[]
): AnalyzerDiagnostic[] {
  if (diagnostics.length === 0) return [];
  const lineIndex = new LineIndex(text);
  const tracker = buildSuppressionTracker(text);
  return diagnostics.filter((d) => {
    const line = lineIndex.lineAt(d.start);
    return !tracker.isSuppressed(d.ruleId, d.category, line, d.sapCode);
  });
}
