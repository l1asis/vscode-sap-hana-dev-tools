/**
 * Formatter options. Keys map 1:1 to `hanasql.format.<key>` in settings.json.
 * Keep this in sync with `contributes.configuration` in package.json.
 */

export type IndentStyle = 'auto' | 'spaces' | 'tabs';
export type CaseMode = 'upper' | 'lower' | 'preserve';
export type CommaPosition = 'trailing' | 'leading';
export type ListContext =
  | 'select'
  | 'from'
  | 'groupBy'
  | 'orderBy'
  | 'set'
  | 'columnDefinitions'
  | 'parameters'
  | 'insertColumns'
  | 'values';
export type LogicalOperatorPosition = 'before' | 'after';
export type CaseLayout = 'multiline' | 'inline';
export type TrailingSemicolonMode = 'preserve' | 'add' | 'remove';
export type EndOfLineSetting = 'auto' | 'lf' | 'crlf';
export type IdentifierQuotesMode = 'preserve' | 'removeUnnecessary';
export type NotEqualOperatorMode = 'preserve' | '<>' | '!=';

export interface FormatterOptions {
  enable: boolean;

  // indentation
  indentSize: number; // 0 = use the editor's tab size
  indentStyle: IndentStyle; // auto | spaces | tabs (auto = use the editor's insertSpaces)

  // letter case
  keywordCase: CaseMode; // upper | lower | preserve
  functionCase: CaseMode;
  dataTypeCase: CaseMode;
  identifierCase: CaseMode; // unquoted identifiers only; quoted ones are never touched

  // line length
  maxLineLength: number; // 0 = never wrap

  // spacing
  spacesAroundOperators: boolean;
  spaceAfterComma: boolean;
  spacesInsideParentheses: boolean;
  spaceBeforeListParenthesis: boolean; // CREATE TABLE t (...), INSERT INTO t (...), CREATE PROCEDURE p (...)

  // lists & commas
  commaPosition: CommaPosition; // trailing | leading
  oneItemPerLine: ListContext[];

  // layout
  beginOnNewLine: boolean;
  procedureHeaderOnSeparateLines: boolean;
  joinOnNewLine: boolean;
  breakLogicalOperators: boolean;
  logicalOperatorPosition: LogicalOperatorPosition; // before | after
  caseLayout: CaseLayout; // multiline | inline

  // semicolons
  trailingSemicolon: TrailingSemicolonMode; // preserve | add | remove

  // blank lines
  maxConsecutiveBlankLines: number;
  blankLinesBetweenTopLevelStatements: number; // -1 = keep what is in the source
  blankLinesBetweenStatements: number; // inside BEGIN ... END blocks, -1 = keep
  removeBlankLinesAtBlockEdges: boolean;

  // misc
  insertFinalNewline: boolean;
  endOfLine: EndOfLineSetting; // auto | lf | crlf
  identifierQuotes: IdentifierQuotesMode; // preserve | removeUnnecessary
  notEqualOperator: NotEqualOperatorMode; // preserve | <> | !=
  spaceAfterCommentMarker: boolean; // "--foo" -> "-- foo"
}

export type PartialFormatterOptions = Partial<FormatterOptions>;

export interface EditorOptions {
  tabSize?: number;
  insertSpaces?: boolean;
  eol?: '\n' | '\r\n' | string;
}

export interface ResolvedFormatterOptions extends FormatterOptions {
  indentWidth: number;
  useTabs: boolean;
  eol: '\n' | '\r\n';
  listCtx: Set<ListContext>;
}

export const LIST_CONTEXTS: readonly ListContext[] = [
  'select',
  'from',
  'groupBy',
  'orderBy',
  'set',
  'columnDefinitions',
  'parameters',
  'insertColumns',
  'values',
];

export const DEFAULTS: Readonly<FormatterOptions> = Object.freeze<FormatterOptions>({
  enable: true,

  // indentation
  indentSize: 0,
  indentStyle: 'auto',

  // letter case
  keywordCase: 'upper',
  functionCase: 'upper',
  dataTypeCase: 'upper',
  identifierCase: 'preserve',

  // line length
  maxLineLength: 120,

  // spacing
  spacesAroundOperators: true,
  spaceAfterComma: true,
  spacesInsideParentheses: false,
  spaceBeforeListParenthesis: true,

  // lists & commas
  commaPosition: 'trailing',
  oneItemPerLine: ['select', 'set', 'columnDefinitions', 'parameters'],

  // layout
  beginOnNewLine: true,
  procedureHeaderOnSeparateLines: true,
  joinOnNewLine: true,
  breakLogicalOperators: true,
  logicalOperatorPosition: 'before',
  caseLayout: 'multiline',

  // semicolons
  trailingSemicolon: 'preserve',

  // blank lines
  maxConsecutiveBlankLines: 1,
  blankLinesBetweenTopLevelStatements: 1,
  blankLinesBetweenStatements: -1,
  removeBlankLinesAtBlockEdges: true,

  // misc
  insertFinalNewline: true,
  endOfLine: 'auto',
  identifierQuotes: 'preserve',
  notEqualOperator: 'preserve',
  spaceAfterCommentMarker: false,
});

const ENUMS: Partial<Record<keyof FormatterOptions, readonly string[]>> = {
  indentStyle: ['auto', 'spaces', 'tabs'],
  keywordCase: ['upper', 'lower', 'preserve'],
  functionCase: ['upper', 'lower', 'preserve'],
  dataTypeCase: ['upper', 'lower', 'preserve'],
  identifierCase: ['upper', 'lower', 'preserve'],
  commaPosition: ['trailing', 'leading'],
  logicalOperatorPosition: ['before', 'after'],
  caseLayout: ['multiline', 'inline'],
  trailingSemicolon: ['preserve', 'add', 'remove'],
  endOfLine: ['auto', 'lf', 'crlf'],
  identifierQuotes: ['preserve', 'removeUnnecessary'],
  notEqualOperator: ['preserve', '<>', '!='],
};

const INTEGERS: Partial<Record<keyof FormatterOptions, readonly [number, number]>> = {
  indentSize: [0, 16],
  maxLineLength: [0, 1000],
  maxConsecutiveBlankLines: [0, 20],
  blankLinesBetweenTopLevelStatements: [-1, 20],
  blankLinesBetweenStatements: [-1, 20],
};

function isListContext(value: unknown): value is ListContext {
  return typeof value === 'string' && (LIST_CONTEXTS as readonly string[]).includes(value);
}

/**
 * Resolves raw user settings (`hanasql.format.*`) and editor options into a validated options object.
 */
export function resolveOptions(
  user: PartialFormatterOptions | Record<string, unknown> = {},
  editor: EditorOptions = {}
): ResolvedFormatterOptions {
  const base: FormatterOptions = {
    ...DEFAULTS,
    oneItemPerLine: [...DEFAULTS.oneItemPerLine],
  };
  const target = base as unknown as Record<keyof FormatterOptions, unknown>;
  const source = user as Record<string, unknown>;

  for (const key of Object.keys(DEFAULTS) as Array<keyof FormatterOptions>) {
    const v = source[key];
    if (v === undefined || v === null) continue;
    const enumValues = ENUMS[key];
    const intBounds = INTEGERS[key];
    if (enumValues) {
      if (typeof v === 'string' && enumValues.includes(v)) target[key] = v;
    } else if (intBounds) {
      const [lo, hi] = intBounds;
      const num = Math.trunc(Number(v));
      if (Number.isFinite(num)) target[key] = Math.min(hi, Math.max(lo, num));
    } else if (typeof DEFAULTS[key] === 'boolean') {
      if (typeof v === 'boolean') target[key] = v;
    } else if (Array.isArray(DEFAULTS[key])) {
      if (Array.isArray(v)) target[key] = v.filter(isListContext);
    }
  }

  // derived values
  const rawTab = editor.tabSize !== undefined ? Math.trunc(editor.tabSize) : 0;
  const tab = Math.max(1, Math.min(16, rawTab || 4));
  const indentWidth = base.indentSize > 0 ? base.indentSize : tab;
  const useTabs =
    base.indentStyle === 'tabs'
      ? true
      : base.indentStyle === 'spaces'
        ? false
        : editor.insertSpaces === false;
  const eol: '\n' | '\r\n' =
    base.endOfLine === 'crlf'
      ? '\r\n'
      : base.endOfLine === 'lf'
        ? '\n'
        : editor.eol === '\r\n'
          ? '\r\n'
          : '\n';
  const listCtx = new Set<ListContext>(base.oneItemPerLine);

  return {
    ...base,
    indentWidth,
    useTabs,
    eol,
    listCtx,
  };
}
