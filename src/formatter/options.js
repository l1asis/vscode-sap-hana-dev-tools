'use strict';

/**
 * Formatter options. Keys map 1:1 to `hanasql.format.<key>` in settings.json.
 * Keep this in sync with `contributes.configuration` in package.json.
 */
const DEFAULTS = Object.freeze({
  enable: true,

  // indentation
  indentSize: 0, // 0 = use the editor's tab size
  indentStyle: 'auto', // auto | spaces | tabs   (auto = use the editor's insertSpaces)

  // letter case
  keywordCase: 'upper', // upper | lower | preserve
  functionCase: 'upper',
  dataTypeCase: 'upper',
  identifierCase: 'preserve', // unquoted identifiers only; quoted ones are never touched

  // line length
  maxLineLength: 120, // 0 = never wrap

  // spacing
  spacesAroundOperators: true,
  spaceAfterComma: true,
  spacesInsideParentheses: false,
  spaceBeforeListParenthesis: true, // CREATE TABLE t (...), INSERT INTO t (...), CREATE PROCEDURE p (...)

  // lists & commas
  commaPosition: 'trailing', // trailing | leading
  oneItemPerLine: ['select', 'set', 'columnDefinitions', 'parameters'],

  // layout
  beginOnNewLine: true,
  procedureHeaderOnSeparateLines: true,
  joinOnNewLine: true,
  breakLogicalOperators: true,
  logicalOperatorPosition: 'before', // before | after
  caseLayout: 'multiline', // multiline | inline

  // semicolons
  trailingSemicolon: 'preserve', // preserve | add | remove

  // blank lines
  maxConsecutiveBlankLines: 1,
  blankLinesBetweenTopLevelStatements: 1, // -1 = keep what is in the source
  blankLinesBetweenStatements: -1, // inside BEGIN ... END blocks, -1 = keep
  removeBlankLinesAtBlockEdges: true,

  // misc
  insertFinalNewline: true,
  endOfLine: 'auto', // auto | lf | crlf
  identifierQuotes: 'preserve', // preserve | removeUnnecessary
  notEqualOperator: 'preserve', // preserve | <> | !=
  spaceAfterCommentMarker: false, // "--foo" -> "-- foo"
});

const LIST_CONTEXTS = ['select', 'from', 'groupBy', 'orderBy', 'set', 'columnDefinitions', 'parameters', 'insertColumns', 'values'];

const ENUMS = {
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

const INTEGERS = {
  indentSize: [0, 16],
  maxLineLength: [0, 1000],
  maxConsecutiveBlankLines: [0, 20],
  blankLinesBetweenTopLevelStatements: [-1, 20],
  blankLinesBetweenStatements: [-1, 20],
};

/**
 * @param {object} user        raw values from settings.json (missing keys are fine)
 * @param {object} [editor]    { tabSize, insertSpaces, eol }
 */
function resolveOptions(user = {}, editor = {}) {
  const o = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const v = user[key];
    if (v === undefined || v === null) continue;
    if (ENUMS[key]) {
      if (ENUMS[key].includes(v)) o[key] = v;
    } else if (INTEGERS[key]) {
      const [lo, hi] = INTEGERS[key];
      const num = Math.trunc(Number(v));
      if (Number.isFinite(num)) o[key] = Math.min(hi, Math.max(lo, num));
    } else if (typeof DEFAULTS[key] === 'boolean') {
      if (typeof v === 'boolean') o[key] = v;
    } else if (Array.isArray(DEFAULTS[key])) {
      if (Array.isArray(v)) o[key] = v.filter((x) => LIST_CONTEXTS.includes(x));
    }
  }

  // derived values
  const tab = Math.max(1, Math.min(16, Math.trunc(editor.tabSize) || 4));
  o.indentWidth = o.indentSize > 0 ? o.indentSize : tab;
  o.useTabs = o.indentStyle === 'tabs' ? true : o.indentStyle === 'spaces' ? false : editor.insertSpaces === false;
  o.eol = o.endOfLine === 'crlf' ? '\r\n' : o.endOfLine === 'lf' ? '\n' : editor.eol === '\r\n' ? '\r\n' : '\n';
  o.listCtx = new Set(o.oneItemPerLine);
  return o;
}

module.exports = { DEFAULTS, LIST_CONTEXTS, resolveOptions };
