import { tokenize, Token } from './tokenizer';
import * as K from './keywords';
import {
  CaseMode,
  EditorOptions,
  EmbeddedQueryLayout,
  ListContext,
  PartialFormatterOptions,
  ResolvedFormatterOptions,
  resolveOptions,
} from './options';
import {
  BEGIN_MODS,
  DATETIME_FIELDS,
  END_SUFFIXES,
  HDI_FIRST,
  HEADER_WORDS,
  JOIN_PHRASE,
  JOIN_STARTERS,
  NON_VALUE,
  OBJ_TYPES,
  STMT_VERBS,
} from './keywords';

// ---------------------------------------------------------------------------
// types & interfaces
// ---------------------------------------------------------------------------

export interface FormatExtraOptions {
  fragment?: boolean;
  initialLevel?: number;
}

export type WordClass = 'ident' | 'keyword' | 'function' | 'type';
export type OperatorKind = 'binary' | 'unary' | null;

interface BaseLayoutToken {
  t: string;
  srcSp: boolean;
  sp?: boolean;
  cls?: WordClass;
  up?: string;
  op?: OperatorKind;
  forceSpace?: boolean;
  comment?: boolean;
  multi?: boolean;
  noBreak?: boolean;
  /** Clause keyword or option word of a `HIERARCHY*( ... )` call. */
  hier?: boolean;
}

export interface LayoutWordToken extends BaseLayoutToken {
  k: 'word';
  cls: WordClass;
  up: string;
}

export interface LayoutOpToken extends BaseLayoutToken {
  k: 'op';
  op: OperatorKind;
}

export interface LayoutCommentToken extends BaseLayoutToken {
  k: 'comment';
  comment: true;
  multi: boolean;
}

export interface LayoutSimpleToken extends BaseLayoutToken {
  k: 'number' | 'string' | 'qident' | 'var' | 'sysvar' | 'param' | 'punct' | 'other';
}

export type LayoutToken =
  | LayoutWordToken
  | LayoutOpToken
  | LayoutCommentToken
  | LayoutSimpleToken;

export type LineKind = 'code' | 'comment' | 'raw';
export type FrameType = 'stmt' | 'sub' | 'list' | 'plain' | 'hier';
export type ClauseKind =
  | 'select'
  | 'from'
  | 'where'
  | 'group'
  | 'order'
  | 'having'
  | 'limit'
  | 'into'
  | 'values'
  | 'set'
  | 'using'
  | 'with'
  | 'on'
  | 'join'
  | 'update'
  | null;

interface ListContainer {
  line: Line;
  idx: number;
  broken: boolean;
  itemLevel: number;
  ctx: ListContext;
}

type StatementKind =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'merge'
  | 'create'
  | 'declare'
  | 'assign'
  | 'cond'
  | 'casehdr'
  | 'end'
  | 'other';

interface StatementState {
  kind: StatementKind;
  count: number;
  first: string;
  alterSystem: boolean;
  createKind: string | null;
  hdiRoot: boolean;
  paramsSeen: boolean;
  colsSeen: boolean;
  insColsSeen: boolean;
  /**
   * `[CREATE] STRUCTURED FILTER` `[HDI]` `[CLOUD]` (sql-sqlscript.md §6): `header` up to `FOR SELECT`, `clauses`
   * while `ON` / `ESCAPE` / `LIKE` / `NOT LIKE` start lines, `condition` after `WHERE` / `CONDITION PROVIDER`.
   */
  filter: 'header' | 'clauses' | 'condition' | null;
}

type BlockKind = 'begin' | 'if' | 'while' | 'for' | 'loop' | 'casestmt' | 'caseexpr';

interface BlockState {
  kind: BlockKind;
  level: number;
  frame: Frame | null;
  hdrOpen?: boolean;
  hdiRoot?: boolean;
}

type LastEndState = 'start' | 'stmtEnd' | 'blockOpen';

interface WrapCandidate {
  j: number;
  pr: number;
  depth: number;
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const WRAP_BINARY: ReadonlySet<string> = new Set(['||', '+', '-', '*', '/', '%']);

class Line {
  level: number;
  toks: LayoutToken[];
  blank: number;
  kind: LineKind;
  hang: boolean;
  raw: string | null;
  /** Extra spaces after the level indent (`embeddedQueryLayout: aligned`). */
  pad: number;
  /** Nested content and wrapped continuations are relative to `level + baseShift` (`hanging` prefix line). */
  baseShift: number;
  /** Pad of wrapped continuation lines, when it differs from `pad` (`aligned` prefix line). */
  contPad: number | null;

  constructor(level: number, pad = 0) {
    this.level = level;
    this.toks = [];
    this.blank = 0;
    this.kind = 'code'; // code | comment | raw
    this.hang = false; // starts with a leading comma
    this.raw = null;
    this.pad = pad;
    this.baseShift = 0;
    this.contPad = null;
  }

  get base(): number {
    return this.level + this.baseShift;
  }
}

class Frame {
  type: FrameType;
  level: number;
  lineLevel: number;
  closeLevel: number;
  clause: ClauseKind;
  hasSelect: boolean;
  cont: ListContainer | null;
  between: number;
  afterSetOp: boolean;
  hierClause: string;
  /** Extra spaces for every line created in this frame (`embeddedQueryLayout: aligned`). */
  pad: number;

  constructor(type: FrameType, level: number, closeLevel?: number, pad = 0) {
    this.type = type; // stmt | sub | list | plain
    this.level = level; // indent of clause-start lines
    this.lineLevel = level; // indent of the next line created in this frame
    this.closeLevel = closeLevel === undefined ? level : closeLevel;
    this.clause = null;
    this.hasSelect = false;
    this.cont = null; // active "one item per line" list container
    this.between = 0;
    this.afterSetOp = false;
    this.hierClause = ''; // current clause keyword of a `hier` frame
    this.pad = pad;
  }
}

// ---------------------------------------------------------------------------
// layout pass
// ---------------------------------------------------------------------------

class Layout {
  private readonly t: readonly Token[];
  private readonly o: ResolvedFormatterOptions;
  private readonly fragment: boolean;
  private level: number;
  private readonly lines: Line[];
  private cur: Line | null;
  private nextLevel: number | null;
  private nextBlank: number;
  private readonly blocks: BlockState[];
  private frames: Frame[];
  private stmt: StatementState | null;
  private atStmtStart: boolean;
  private pendingHdiBody: boolean;
  private afterHeaderAs: boolean;
  private lastEnd: LastEndState;
  private lastTok: LayoutToken | null;
  private prevCode: LayoutToken | null;

  constructor(tokens: readonly Token[], o: ResolvedFormatterOptions, extra: FormatExtraOptions) {
    this.t = tokens;
    this.o = o;
    this.fragment = !!extra.fragment;
    this.level = extra.initialLevel || 0;
    this.lines = [];
    this.cur = null;
    this.nextLevel = null;
    this.nextBlank = 0;
    this.blocks = [];
    this.frames = [];
    this.stmt = null;
    this.atStmtStart = true;
    this.pendingHdiBody = false;
    this.afterHeaderAs = false;
    this.lastEnd = 'start'; // start | stmtEnd | blockOpen
    this.lastTok = null;
    this.prevCode = null;
  }

  // ---- small helpers ------------------------------------------------------

  top(): Frame | null {
    return this.frames[this.frames.length - 1] || null;
  }

  nextCode(i: number): Token | null {
    for (let j = i + 1; j < this.t.length; j++) {
      const ty = this.t[j].type;
      if (ty !== 'lineComment' && ty !== 'blockComment') return this.t[j];
    }
    return null;
  }

  prevSrc(i: number): Token | null {
    for (let j = i - 1; j >= 0; j--) {
      const ty = this.t[j].type;
      if (ty !== 'lineComment' && ty !== 'blockComment') return this.t[j];
    }
    return null;
  }

  upOf(tok: Token | null): string {
    return tok && tok.type === 'word' ? tok.text.toUpperCase() : '';
  }

  breakLine(level?: number): void {
    if (this.cur && this.cur.toks.length) this.cur = null;
    if (level !== undefined) this.nextLevel = level;
  }

  // ---- token conversion & spacing ----------------------------------------

  caseOf(text: string, mode: CaseMode): string {
    return mode === 'upper' ? text.toUpperCase() : mode === 'lower' ? text.toLowerCase() : text;
  }

  valueLike(p: LayoutToken | null): boolean {
    if (!p) return false;
    if (p.k === 'number' || p.k === 'string' || p.k === 'qident' || p.k === 'var' || p.k === 'sysvar' || p.k === 'param') return true;
    if (p.t === ')' || p.t === ']') return true;
    if (p.k === 'word') return !NON_VALUE.has(p.up);
    return false;
  }

  mkWord(tok: Token, i: number): LayoutWordToken {
    const up = tok.text.toUpperCase();
    const prevT = this.prevSrc(i);
    const nextT = this.nextCode(i);
    const dotAdj = (prevT && prevT.text === '.') || (nextT && nextT.text === '.');
    let cls: WordClass = 'ident';
    if (!dotAdj) {
      const nextParen = !!nextT && nextT.text === '(';
      const isF = K.FUNCTIONS.has(up);
      const isT = K.TYPES.has(up);
      let typeCtx = false;
      if (isT && isF) {
        typeCtx = !!prevT && ((prevT.type === 'word' && (!K.KEYWORDS.has(prevT.text.toUpperCase()) || prevT.text.toUpperCase() === 'AS')) || prevT.type === 'qident');
      }
      if (DATETIME_FIELDS.has(up) && nextT && nextT.text.toUpperCase() === 'FROM') cls = 'keyword';
      else if (isF && nextParen && !typeCtx) cls = 'function';
      else if (isT) cls = 'type';
      else if (K.KEYWORDS.has(up)) cls = 'keyword';
    }
    if (cls === 'ident' && !dotAdj && this.stmt) {
      const st = this.stmt;
      if (st.alterSystem && (up === 'SYSTEM' || K.SYSTEM_WORDS.has(up))) cls = 'keyword';
      else if (st.count <= 6 && (STMT_VERBS.has(st.first) || st.hdiRoot) && K.STATEMENT_NOUNS.has(up)) cls = 'keyword';
      else if (st.filter && up === 'PROVIDER' && prevT && prevT.text.toUpperCase() === 'CONDITION') cls = 'keyword';
    }
    const mode = cls === 'keyword' ? this.o.keywordCase : cls === 'function' ? this.o.functionCase : cls === 'type' ? this.o.dataTypeCase : this.o.identifierCase;
    return { t: this.caseOf(tok.text, mode), k: 'word', cls, up, srcSp: tok.wsBefore };
  }

  mkTok(tok: Token, i: number): LayoutToken {
    const o = this.o;
    switch (tok.type) {
      case 'word':
        return this.mkWord(tok, i);
      case 'number':
        return { t: tok.text, k: 'number', srcSp: tok.wsBefore };
      case 'string': {
        let s = tok.text;
        if (s[0] !== "'") s = s[0].toUpperCase() + s.slice(1);
        return { t: s, k: 'string', srcSp: tok.wsBefore };
      }
      case 'qident': {
        const inner = tok.text.slice(1, -1);
        const prevT = this.prevSrc(i);
        const nextT = this.nextCode(i);
        const dotAdj = (prevT && prevT.text === '.') || (nextT && nextT.text === '.');
        if (o.identifierQuotes === 'removeUnnecessary' && /^[A-Z_][A-Z0-9_]*$/.test(inner) && !K.PROTECTED.has(inner) && !dotAdj) {
          return { t: this.caseOf(inner, o.identifierCase), k: 'word', cls: 'ident', up: inner, srcSp: tok.wsBefore };
        }
        return { t: tok.text, k: 'qident', srcSp: tok.wsBefore };
      }
      case 'var':
        return { t: ':' + this.caseOf(tok.text.slice(1), o.identifierCase), k: 'var', srcSp: tok.wsBefore };
      case 'sysvar':
        return { t: '::' + this.caseOf(tok.text.slice(2), o.keywordCase), k: 'sysvar', srcSp: tok.wsBefore };
      case 'param':
        return { t: '?', k: 'param', srcSp: tok.wsBefore };
      case 'op': {
        let t = tok.text;
        if (t === '<>' && o.notEqualOperator === '!=') t = '!=';
        else if (t === '!=' && o.notEqualOperator === '<>') t = '<>';
        const tk: LayoutOpToken = { t, k: 'op', op: 'binary', srcSp: tok.wsBefore };
        if (t === '+' || t === '-') {
          if (!this.valueLike(this.prevCode)) tk.op = 'unary';
        } else if (t === '*') {
          if (!this.valueLike(this.prevCode)) tk.op = null; // wildcard
        }
        return tk;
      }
      case 'punct':
        return { t: tok.text, k: 'punct', srcSp: tok.wsBefore };
      default:
        return { t: tok.text, k: 'other', srcSp: tok.wsBefore };
    }
  }

  space(a: LayoutToken | null, b: LayoutToken): boolean {
    const o = this.o;
    if (!a) return false;
    if (b.t === ';' || b.t === ',') return false;
    if (a.t === ',') return o.spaceAfterComma;
    if (a.k === 'punct' && (a.t === '.' || a.t === '..')) return false;
    if (b.k === 'punct' && (b.t === '.' || b.t === '..')) return false;
    if (a.t === '(' || a.t === '[') {
      if (b.t === ')' || b.t === ']') return false;
      return a.t === '(' && o.spacesInsideParentheses;
    }
    if (b.t === ')' || b.t === ']') return b.t === ')' && o.spacesInsideParentheses;
    if (b.t === '[') return false;
    if (b.t === '(') {
      if (b.forceSpace !== undefined) return b.forceSpace;
      if (a.k === 'word' && a.up === 'HINT') return false;
      if (a.op === 'unary') return false;
      if (a.op === 'binary') return o.spacesAroundOperators;
      if (a.k === 'word') {
        if (a.cls === 'function' || a.cls === 'type') return false;
        if (a.cls === 'keyword') return true;
        return b.srcSp;
      }
      if (a.k === 'qident') return b.srcSp;
      return true;
    }
    if (a.comment || b.comment) return true;
    if (a.op === 'unary') return false;
    if (a.op === 'binary' || b.op === 'binary') {
      if (!o.spacesAroundOperators) {
        // never glue "-" to "-" (would start a comment) or "/" to "*"
        if (a.t.endsWith('-') && b.t.startsWith('-')) return true;
        if (a.t.endsWith('/') && b.t.startsWith('*')) return true;
        return false;
      }
      return true;
    }
    if (a.k === 'other' || b.k === 'other') return b.srcSp;
    return true;
  }

  push(tk: LayoutToken): LayoutToken {
    const f = this.top();
    if (!this.cur) {
      const level = this.nextLevel !== null ? this.nextLevel : f ? f.lineLevel : this.level;
      this.cur = new Line(level, f ? f.pad : 0);
      this.cur.blank = this.nextBlank;
      this.nextBlank = 0;
      this.nextLevel = null;
      this.lines.push(this.cur);
    }
    tk.sp = this.cur.toks.length === 0 ? false : this.space(this.lastTok, tk);
    this.cur.toks.push(tk);
    this.lastTok = tk;
    if (!tk.comment) {
      this.prevCode = tk;
      if (this.stmt) this.stmt.count++;
    }
    return tk;
  }

  emit(tok: Token, i: number): LayoutToken {
    return this.push(this.mkTok(tok, i));
  }

  // ---- blank lines -------------------------------------------------------

  blankFor(srcBlank: number): number {
    const o = this.o;
    if (this.lines.length === 0) return 0;
    const prev = this.lines[this.lines.length - 1];
    if ((prev.kind === 'comment' || prev.kind === 'raw') && srcBlank === 0) return 0; // attached to what follows
    if (this.lastEnd === 'blockOpen' && o.removeBlankLinesAtBlockEdges) return 0;
    const topLevel = this.level === 0 && this.blocks.length === 0;
    const policy = topLevel ? o.blankLinesBetweenTopLevelStatements : o.blankLinesBetweenStatements;
    if (this.lastEnd === 'stmtEnd' && policy >= 0) return policy;
    return Math.min(srcBlank, o.maxConsecutiveBlankLines);
  }

  // ---- statement bookkeeping --------------------------------------------

  stmtKind(tok: Token, up: string, i: number): StatementKind {
    if (tok.type === 'word') {
      switch (up) {
        case 'SELECT': case 'WITH': return 'select';
        case 'INSERT': case 'UPSERT': case 'REPLACE': return 'insert';
        case 'UPDATE': return 'update';
        case 'DELETE': return 'delete';
        case 'MERGE': return 'merge';
        case 'CREATE': case 'PROCEDURE': case 'FUNCTION': case 'VIEW': case 'COLUMN': case 'ROW': case 'TABLE': case 'VIRTUAL': case 'PROJECTION': case 'TYPE': case 'LIBRARY': case 'TRIGGER': return 'create';
        case 'DECLARE': return 'declare';
        default: break;
      }
    }
    if (tok.type === 'punct' && tok.text === '(') return 'select';
    if (tok.type === 'word' || tok.type === 'var') {
      const nx = this.nextCode(i);
      if (nx && (nx.text === '=' || nx.text === ':=')) return 'assign';
    }
    return 'other';
  }

  beginStatement(tok: Token, i: number): void {
    const up = this.upOf(tok);
    if (this.blocks.length === 0 && up !== 'USING' && up !== 'BEGIN') {
      this.pendingHdiBody = false;
      this.afterHeaderAs = false;
    }
    const hdiRoot =
      this.blocks.length === 0 &&
      (HDI_FIRST.has(up) || (this.pendingHdiBody && (up === 'USING' || up === 'BEGIN')));
    this.nextBlank = this.blankFor(Math.max(0, tok.nlBefore - 1));
    this.stmt = {
      kind: this.stmtKind(tok, up, i),
      count: 0,
      first: up,
      alterSystem: false,
      createKind: null,
      hdiRoot,
      paramsSeen: false,
      colsSeen: false,
      insColsSeen: false,
      filter: null,
    };
    this.frames = [new Frame('stmt', this.level)];
    this.atStmtStart = false;
    this.nextLevel = this.level;
  }

  endStatement(): void {
    this.breakLine();
    this.nextLevel = null;
    this.atStmtStart = true;
    this.stmt = null;
    this.frames = [];
    this.afterHeaderAs = false;
    this.lastEnd = 'stmtEnd';
  }

  endHeader(): void {
    this.breakLine();
    this.nextLevel = null;
    this.atStmtStart = true;
    this.stmt = null;
    this.frames = [];
    this.lastEnd = 'blockOpen';
  }

  syntheticSemi(): void {
    this.push({ t: ';', k: 'punct', srcSp: false });
    this.endStatement();
  }

  /** In "add" mode, terminate an unterminated statement before END / ELSE / WHEN. */
  ensureSemi(): boolean {
    const st = this.stmt;
    if (this.o.trailingSemicolon !== 'add' || this.fragment) return false;
    if (this.atStmtStart || !st || st.count === 0) return false;
    if (st.kind === 'casehdr' || st.kind === 'cond') return false;
    if (this.lastTok && this.lastTok.t === ';') return false;
    this.syntheticSemi();
    return true;
  }

  // ---- lists -------------------------------------------------------------

  openCont(f: Frame, ctx: ListContext, itemLevel: number): void {
    if (!this.cur) return;
    f.cont = { line: this.cur, idx: this.cur.toks.length, broken: false, itemLevel, ctx };
  }

  splitList(f: Frame, c: ListContainer): void {
    const line = c.line;
    const tail = line.toks.splice(c.idx);
    c.broken = true;
    f.lineLevel = c.itemLevel;
    if (tail.length === 0) {
      if (this.cur === line) { this.cur = null; this.nextLevel = c.itemLevel; }
      return;
    }
    const nl = new Line(c.itemLevel, f.pad);
    nl.toks = tail;
    const idx = this.lines.indexOf(line);
    this.lines.splice(idx + 1, 0, nl);
    if (this.cur === line) this.cur = nl;
    c.line = nl;
    c.idx = 0;
    // everything created after the moved tokens was relative to the base of their old line
    const delta = c.itemLevel - line.base;
    if (delta !== 0) {
      for (let k = idx + 2; k < this.lines.length; k++) this.lines[k].level += delta;
      if (this.nextLevel !== null) this.nextLevel += delta;
      const fi = this.frames.indexOf(f);
      for (let k = fi + 1; k < this.frames.length; k++) {
        const g = this.frames[k];
        g.level += delta; g.lineLevel += delta; g.closeLevel += delta;
        if (g.cont) g.cont.itemLevel += delta;
      }
      for (const b of this.blocks) if (b.frame && this.frames.indexOf(b.frame) > fi) b.level += delta;
    }
  }

  commaBreak(tk: LayoutToken, level: number): void {
    if (this.o.commaPosition === 'leading') {
      this.breakLine(level);
      this.push(tk);
      if (this.cur) this.cur.hang = true;
    } else {
      this.push(tk);
      this.breakLine(level);
    }
  }

  comma(): void {
    const f = this.top()!;
    const tk: LayoutSimpleToken = { t: ',', k: 'punct', srcSp: false };
    const c = f.cont;
    if (c) {
      if (!c.broken) this.splitList(f, c);
      this.commaBreak(tk, c.itemLevel);
    } else if (f.clause === 'with' && (f.type === 'stmt' || f.type === 'sub')) {
      this.commaBreak(tk, f.level);
    } else {
      this.push(tk);
    }
  }

  // ---- parentheses -------------------------------------------------------

  listContextFor(f: Frame): ListContext | null {
    const st = this.stmt!;
    const p = this.prevCode;
    if (!p) return null;
    const pIdent = (p.k === 'word' && p.cls === 'ident') || p.k === 'qident';
    if (f.type === 'stmt') {
      if (st.kind === 'create' && (st.createKind === 'PROCEDURE' || st.createKind === 'FUNCTION') && !st.paramsSeen && pIdent) {
        st.paramsSeen = true;
        return 'parameters';
      }
      if (st.kind === 'create' && st.createKind === 'TABLE' && !st.colsSeen && pIdent) {
        st.colsSeen = true;
        return 'columnDefinitions';
      }
      if (((st.kind === 'create' && st.createKind === 'VIEW') || st.kind === 'insert') && !st.insColsSeen && pIdent) {
        st.insColsSeen = true;
        return 'insertColumns';
      }
      if (p.k === 'word' && p.up === 'VALUES') return 'values';
    }
    if (p.k === 'word' && p.up === 'TABLE' && (st.kind === 'create' || st.kind === 'declare')) return 'columnDefinitions';
    return null;
  }

  openParen(tok: Token, i: number): void {
    const f = this.top()!;
    const nx = this.nextCode(i);
    const nup = this.upOf(nx);
    const tk: LayoutSimpleToken = { t: '(', k: 'punct', srcSp: tok.wsBefore };

    // `HIERARCHY*(`: one clause per line, one level deeper than the call (sql-sqlscript.md §4.5)
    const p = this.prevCode;
    if (p && p.k === 'word' && p.cls === 'function' && K.HIERARCHY_CLAUSE_FUNCTIONS.has(p.up)) {
      this.push(tk);
      const base = this.cur!.base;
      const hf = new Frame('hier', base + 1, base, f.pad);
      this.frames.push(hf);
      this.breakLine(hf.level);
      return;
    }

    if (nup === 'SELECT' || nup === 'WITH') {
      this.push(tk);
      const base = this.cur!.base;
      const sf = new Frame('sub', base + 1, base, f.pad);
      this.frames.push(sf);
      this.breakLine(sf.level);
      return;
    }

    const ctx = this.listContextFor(f);
    if (ctx && this.o.listCtx.has(ctx)) {
      tk.forceSpace = this.o.spaceBeforeListParenthesis;
      this.push(tk);
      const base = this.cur!.base;
      const lf = new Frame('list', f.level, base, f.pad);
      lf.lineLevel = base + 1;
      this.frames.push(lf);
      this.openCont(lf, ctx, base + 1);
      return;
    }
    if (ctx) tk.forceSpace = this.o.spaceBeforeListParenthesis;
    this.push(tk);
    this.frames.push(new Frame('plain', f.level, this.cur!.base, f.pad));
    const pf = this.top()!;
    pf.lineLevel = f.lineLevel;
  }

  closeParen(): void {
    const tk: LayoutSimpleToken = { t: ')', k: 'punct', srcSp: false };
    if (this.frames.length > 1) {
      const f = this.frames.pop()!;
      if (f.type === 'sub' || f.type === 'hier' || (f.type === 'list' && f.cont && f.cont.broken)) this.breakLine(f.closeLevel);
    }
    this.push(tk);
  }

  // ---- comments ----------------------------------------------------------

  commentText(text: string, isLine: boolean): string {
    let t = text.replace(/[ \t]+$/, '');
    if (isLine) {
      if (this.o.spaceAfterCommentMarker && /^--[A-Za-z0-9]/.test(t)) t = '-- ' + t.slice(2);
    } else if (/[\r\n]/.test(t)) {
      t = t.replace(/\r\n?/g, '\n');
    }
    return t;
  }

  comment(tok: Token): void {
    const isLine = tok.type === 'lineComment';
    const standalone = tok.nlBefore > 0 || this.lines.length === 0 || (this.lastTok === null && !this.cur);
    const tk: LayoutCommentToken = {
      t: this.commentText(tok.text, isLine),
      k: 'comment',
      comment: true,
      srcSp: true,
      multi: tok.text.includes('\n'),
    };

    if (standalone) {
      if (this.cur && this.cur.toks.length) this.breakLine();
      let level: number;
      let pad = 0;
      if (this.atStmtStart) {
        this.nextBlank = this.blankFor(Math.max(0, tok.nlBefore - 1));
        level = this.level;
      } else {
        const f = this.top();
        level = this.nextLevel !== null ? this.nextLevel : f ? f.lineLevel : this.level;
        pad = f ? f.pad : 0;
      }
      const line = new Line(level, pad);
      line.kind = 'comment';
      line.blank = this.nextBlank;
      this.nextBlank = 0;
      this.lines.push(line);
      tk.sp = false;
      line.toks.push(tk);
      this.cur = null;
      this.nextLevel = null;
      return;
    }

    // trailing comment
    if (this.cur && this.cur.hang && this.cur.toks.length === 1 && this.lines.length > 1) {
      // "a -- note" followed by ", b": keep the note on the line of "a"
      const prev = this.lines[this.lines.indexOf(this.cur) - 1];
      if (prev && prev.kind === 'code') {
        tk.sp = true;
        prev.toks.push(tk);
        return;
      }
    }
    if (!this.cur) {
      const last = this.lines[this.lines.length - 1];
      if (last && last.kind !== 'raw') {
        tk.sp = true;
        last.toks.push(tk);
        for (const f of this.frames) {
          if (f.cont && f.cont.line === last && f.cont.idx === last.toks.length - 1) f.cont.idx++;
        }
      } else {
        this.push(tk);
      }
    } else {
      tk.sp = true;
      this.cur.toks.push(tk);
      for (const f of this.frames) {
        if (f.cont && f.cont.line === this.cur && f.cont.idx === this.cur.toks.length - 1) f.cont.idx++;
      }
    }
    if (isLine) this.breakLine();
  }

  raw(tok: Token): void {
    if (this.cur && this.cur.toks.length) this.breakLine();
    if (this.atStmtStart) this.nextBlank = this.blankFor(Math.max(0, tok.nlBefore - 1));
    const line = new Line(0);
    line.kind = 'raw';
    line.raw = tok.text;
    line.blank = this.nextBlank;
    this.nextBlank = 0;
    this.lines.push(line);
    this.cur = null;
    this.nextLevel = null;
  }

  // ---- main loop ---------------------------------------------------------

  run(): Line[] {
    for (let i = 0; i < this.t.length; i++) {
      const tok = this.t[i];
      if (tok.type === 'lineComment' || tok.type === 'blockComment') { this.comment(tok); continue; }
      if (tok.type === 'raw') { this.raw(tok); continue; }
      i += this.code(tok, i);
    }
    this.finish();
    return this.lines;
  }

  code(tok: Token, i: number): number {
    const isSemi = tok.type === 'punct' && tok.text === ';';

    // "END IF" etc. without semicolon followed by something else
    if (this.stmt && this.stmt.kind === 'end' && !isSemi && this.o.trailingSemicolon === 'add' && !this.fragment && this.stmt.count > 0) {
      this.syntheticSemi();
    }

    if (this.atStmtStart) {
      if (isSemi && this.lines.length) {
        // empty statement ";;" -> drop duplicate
        const last = this.lines[this.lines.length - 1];
        const lt = last.toks[last.toks.length - 1];
        if (lt && lt.t === ';' && last.kind === 'code') return 0;
      }
      this.beginStatement(tok, i);
    }

    if (isSemi) {
      while (this.frames.length > 1) this.frames.pop();
      this.push({ t: ';', k: 'punct', srcSp: false });
      this.endStatement();
      return 0;
    }

    if (tok.type === 'punct') {
      switch (tok.text) {
        case '(': this.openParen(tok, i); return 0;
        case ')': this.closeParen(); return 0;
        case ',': this.comma(); return 0;
        default: break;
      }
    }

    if (tok.type === 'word') return this.word(tok, i);

    this.emit(tok, i);
    return 0;
  }

  // ---- words: blocks, clauses, headers ----------------------------------

  word(tok: Token, i: number): number {
    const o = this.o;
    const f = this.top()!;
    const st = this.stmt!;
    const up = tok.text.toUpperCase();
    const nx = this.nextCode(i);
    const nup = this.upOf(nx);
    const pup = this.prevCode && this.prevCode.k === 'word' ? this.prevCode.up : '';
    const clauseFrame = f.type === 'stmt' || f.type === 'sub';
    const stmtLevel = f.type === 'stmt' && this.frames.length === 1;
    const topBlock = this.blocks[this.blocks.length - 1] || null;

    if (up === 'SYSTEM' && st.first === 'ALTER' && st.count === 1) st.alterSystem = true;
    if (st.kind === 'create' && !st.createKind && OBJ_TYPES.has(up)) st.createKind = up;
    if (up === 'FILTER' && pup === 'STRUCTURED' && st.count <= 2 && this.blocks.length === 0) st.filter = 'header';

    // BETWEEN a AND b: that AND is not a logical operator
    if (up === 'BETWEEN') { f.between++; return this.plain(tok, i); }

    switch (up) {
      case 'BEGIN':
        if (stmtLevel) return this.doBegin(tok, i);
        break;

      case 'END':
        return this.doEnd(tok, i);

      case 'IF':
        if (stmtLevel && st.count === 0) {
          this.blocks.push({ kind: 'if', level: this.level, hdrOpen: true, frame: f });
          st.kind = 'cond';
        }
        break;

      case 'WHILE':
      case 'FOR':
        if (stmtLevel && st.count === 0) {
          this.blocks.push({ kind: up === 'WHILE' ? 'while' : 'for', level: this.level, hdrOpen: true, frame: f });
          st.kind = 'cond';
        }
        break;

      case 'LOOP':
        if (stmtLevel && st.count === 0) {
          this.blocks.push({ kind: 'loop', level: this.level, frame: f });
          this.emit(tok, i);
          this.level++;
          this.endHeader();
          return 0;
        }
        break;

      case 'DO':
        if (stmtLevel && topBlock && topBlock.hdrOpen && (topBlock.kind === 'while' || topBlock.kind === 'for')) {
          this.emit(tok, i);
          topBlock.hdrOpen = false;
          this.level = topBlock.level + 1;
          this.endHeader();
          return 0;
        }
        break;

      case 'CASE':
        if (stmtLevel && st.count === 0) {
          this.blocks.push({ kind: 'casestmt', level: this.level, hdrOpen: true, frame: f });
          st.kind = 'casehdr';
        } else {
          this.blocks.push({ kind: 'caseexpr', level: this.cur ? this.cur.base : f.lineLevel, frame: f });
        }
        break;

      case 'WHEN': {
        if (st.kind === 'merge' && clauseFrame && stmtLevel) {
          this.breakLine(f.level);
          f.lineLevel = f.level + 1;
          break;
        }
        if (topBlock && topBlock.kind === 'casestmt' && stmtLevel) {
          this.ensureSemiAndRestart(tok, i);
          const nf = this.top()!;
          this.nextBlank = this.blankFor(Math.max(0, tok.nlBefore - 1));
          this.level = topBlock.level + 1;
          nf.level = this.level;
          nf.pad = 0;
          nf.lineLevel = this.level + 1;
          this.breakLine(this.level);
          topBlock.hdrOpen = true;
          break;
        }
        if (topBlock && topBlock.kind === 'caseexpr' && o.caseLayout === 'multiline') {
          this.breakLine(topBlock.level + 1);
        }
        break;
      }

      case 'THEN':
        if (stmtLevel && topBlock && topBlock.hdrOpen && (topBlock.kind === 'if' || topBlock.kind === 'casestmt')) {
          this.emit(tok, i);
          topBlock.hdrOpen = false;
          this.level = topBlock.level + (topBlock.kind === 'if' ? 1 : 2);
          this.endHeader();
          return 0;
        }
        break;

      case 'ELSEIF':
        if (stmtLevel && topBlock && topBlock.kind === 'if') {
          this.ensureSemiAndRestart(tok, i);
          const nf = this.top()!;
          this.nextBlank = this.blankFor(Math.max(0, tok.nlBefore - 1));
          this.level = topBlock.level;
          nf.level = this.level;
          nf.pad = 0;
          nf.lineLevel = this.level + 1;
          this.breakLine(this.level);
          topBlock.hdrOpen = true;
          this.stmt!.kind = 'cond';
        }
        break;

      case 'ELSE':
        if (stmtLevel && topBlock && (topBlock.kind === 'if' || topBlock.kind === 'casestmt') && !topBlock.hdrOpen) {
          this.ensureSemiAndRestart(tok, i);
          const nf = this.top()!;
          this.nextBlank = this.blankFor(Math.max(0, tok.nlBefore - 1));
          this.level = topBlock.level + (topBlock.kind === 'if' ? 0 : 1);
          nf.level = this.level;
          nf.pad = 0;
          this.breakLine(this.level);
          this.emit(tok, i);
          this.level += 1;
          this.endHeader();
          return 0;
        }
        if (topBlock && topBlock.kind === 'caseexpr' && o.caseLayout === 'multiline') {
          this.breakLine(topBlock.level + 1);
        }
        break;

      default:
        break;
    }

    if (f.type === 'hier') return this.hierarchyWord(tok, i, up, pup, f);

    // ---- statement header of CREATE / HDI PROCEDURE / FUNCTION / LIBRARY ---
    if (stmtLevel && this.blocks.length === 0 && this.afterHeaderAs && up === 'USING') {
      const keepHdiRoot = st.hdiRoot;
      this.afterHeaderAs = false;
      if (this.cur && this.cur.toks.length) this.breakLine(f.level);
      this.beginStatement(tok, i);
      this.stmt!.hdiRoot = keepHdiRoot;
      return this.plain(tok, i);
    }
    if (
      stmtLevel &&
      this.blocks.length === 0 &&
      st.kind === 'create' &&
      up === 'AS' &&
      st.count > 0 &&
      (st.createKind === 'PROCEDURE' || st.createKind === 'FUNCTION' || st.createKind === 'LIBRARY' || st.createKind === 'TRIGGER') &&
      this.prevCode &&
      this.prevCode.t !== '('
    ) {
      this.afterHeaderAs = true;
      if (st.hdiRoot) this.pendingHdiBody = true;
    }
    if (stmtLevel && o.procedureHeaderOnSeparateLines && st.kind === 'create' && (st.createKind === 'PROCEDURE' || st.createKind === 'FUNCTION' || st.createKind === 'LIBRARY') && HEADER_WORDS.has(up) && st.count > 0) {
      const ok =
        up === 'DEFAULT' ? nup === 'SCHEMA' :
        up === 'SQL' ? nup === 'SECURITY' && pup !== 'READS' && pup !== 'MODIFIES' :
        up === 'READS' || up === 'MODIFIES' ? true :
        true;
      if (ok && this.prevCode && this.prevCode.t !== '(') {
        this.breakLine(f.level);
        return this.plain(tok, i);
      }
    }

    // ---- clause keywords -------------------------------------------------
    if (st.filter && stmtLevel) {
      const r = this.structuredFilterWord(tok, i, up, nup, pup, f, st);
      if (r !== null) return r;
    }
    if (clauseFrame) {
      const r = this.clauseWord(tok, i, up, nup, pup, f, st);
      if (r !== null) return r;
    }

    // ---- AND / OR --------------------------------------------------------
    if ((up === 'AND' || up === 'OR') && clauseFrame) {
      if (up === 'AND' && f.between > 0) {
        f.between--;
        const tk = this.mkTok(tok, i);
        tk.noBreak = true;
        this.push(tk);
        return 0;
      }
      const inCaseExpr = topBlock && topBlock.kind === 'caseexpr' && topBlock.frame === f;
      if (o.breakLogicalOperators && !inCaseExpr && (f.clause === 'where' || f.clause === 'having' || f.clause === 'on')) {
        if (o.logicalOperatorPosition === 'before') {
          this.breakLine(f.lineLevel);
          this.emit(tok, i);
        } else {
          this.emit(tok, i);
          this.breakLine(f.lineLevel);
        }
        return 0;
      }
    } else if (up === 'AND' && f.between > 0) {
      f.between--;
      const tk = this.mkTok(tok, i);
      tk.noBreak = true;
      this.push(tk);
      return 0;
    }

    return this.plain(tok, i);
  }

  plain(tok: Token, i: number): number {
    this.emit(tok, i);
    return 0;
  }

  /**
   * A word at the top level of a `HIERARCHY*( ... )` call (sql-sqlscript.md §4.5). A clause keyword after the
   * call's `(` or after a complete operand starts a line; clause keywords and option words in their own position
   * are cased as keywords, so `START WHERE depth = 1` keeps `depth` as an identifier.
   */
  hierarchyWord(tok: Token, i: number, up: string, pup: string, f: Frame): number {
    const p = this.prevCode;
    const tk = this.mkWord(tok, i);
    // `START WHERE` and `NO CACHE` are two-word clause keywords
    const phrase = (pup === 'START' && up === 'WHERE') || (pup === 'NO' && up === 'CACHE');
    let keyword = false;
    if (K.HIERARCHY_CLAUSE_STARTERS.has(up) && p && (phrase || p.t === '(' || this.valueLike(p))) {
      keyword = true;
      if (!phrase) {
        this.breakLine(f.level);
        f.hierClause = up;
      }
    } else if (K.HIERARCHY_OPTION_WORDS.has(up) && p && p.hier && pup !== 'SOURCE' && pup !== 'START' && pup !== 'JOIN') {
      keyword = true; // ORPHAN ROOT, CYCLE BREAKUP, LOAD BULK, WITH SUBTOTAL, ...
    } else if ((up === 'UNTIL' || up === 'EXCLUDED') && f.hierClause === 'VALID') {
      keyword = true;
    }
    if (keyword) {
      tk.cls = 'keyword';
      tk.t = this.caseOf(tok.text, this.o.keywordCase);
      tk.hier = true;
    }
    this.push(tk);
    return 0;
  }

  ensureSemiAndRestart(tok: Token, i: number): void {
    if (this.ensureSemi()) this.beginStatement(tok, i);
  }

  doBegin(tok: Token, i: number): number {
    const f = this.top()!;
    const anonymous = this.cur && this.cur.toks.length === 1 && this.prevCode && this.prevCode.up === 'DO';
    if (this.o.beginOnNewLine && !anonymous && this.cur && this.cur.toks.length) this.breakLine(f.level);
    this.blocks.push({ kind: 'begin', level: this.level, frame: f, hdiRoot: !!(this.stmt && this.stmt.hdiRoot) || this.pendingHdiBody });
    this.pendingHdiBody = false;
    this.afterHeaderAs = false;
    this.emit(tok, i);
    let consumed = 0;
    for (;;) {
      const nx = this.t[i + consumed + 1];
      if (nx && nx.type === 'word' && BEGIN_MODS.has(nx.text.toUpperCase())) {
        consumed++;
        this.emit(nx, i + consumed);
      } else break;
    }
    this.level += 1;
    this.endHeader();
    return consumed;
  }

  doEnd(tok: Token, i: number): number {
    const topBlock = this.blocks[this.blocks.length - 1] || null;

    if (topBlock && topBlock.kind === 'caseexpr') {
      this.blocks.pop();
      if (this.o.caseLayout === 'multiline') this.breakLine(topBlock.level);
      this.emit(tok, i);
      return 0;
    }

    if (this.frames.length === 1) {
      this.ensureSemiAndRestart(tok, i);
      const nf = this.top()!;
      this.nextBlank = this.o.removeBlankLinesAtBlockEdges ? 0 : this.blankFor(Math.max(0, tok.nlBefore - 1));
      const blk = this.blocks.pop();
      this.level = blk ? blk.level : Math.max(0, this.level - 1);
      nf.level = this.level;
      nf.pad = 0;
      nf.lineLevel = this.level + 1;
      this.breakLine(this.level);
      this.stmt!.kind = 'end';
      if (blk && blk.hdiRoot && this.blocks.length === 0) this.stmt!.hdiRoot = true;
      this.emit(tok, i);
      const nx = this.t[i + 1];
      if (nx && nx.type === 'word' && END_SUFFIXES.has(nx.text.toUpperCase())) {
        this.emit(nx, i + 1);
        return 1;
      }
      return 0;
    }

    this.emit(tok, i);
    return 0;
  }

  // ---- embedded queries (sql-formatting.md §5.1) -------------------------

  /**
   * Whether the `SELECT` / `WITH` at hand starts the query of `<target> =` / `<target> :=` (at most three code
   * tokens so far) or `RETURN`, outside any parentheses.
   */
  isEmbeddedQueryStart(f: Frame, st: StatementState): boolean {
    if (f.type !== 'stmt' || this.frames.length !== 1 || f.hasSelect || f.clause !== null) return false;
    const p = this.prevCode;
    if (!p) return false;
    if (p.k === 'op' && (p.t === '=' || p.t === ':=')) return st.count <= 3;
    return p.k === 'word' && p.up === 'RETURN' && st.count === 1;
  }

  /** The layout to use: `newLine` when a line comment already ended the prefix line, `hanging` for tabs. */
  embeddedQueryMode(): EmbeddedQueryLayout {
    const onPrefixLine = !!this.cur && this.cur.toks.some((t) => !t.comment);
    if (!onPrefixLine) return 'newLine';
    if (this.o.embeddedQueryLayout === 'aligned' && this.o.useTabs) return 'hanging';
    return this.o.embeddedQueryLayout;
  }

  /** Before `SELECT` / `WITH` is pushed: move the query one level deeper (`hanging`, `newLine`). */
  beforeEmbeddedQuery(f: Frame, mode: EmbeddedQueryLayout): void {
    if (mode === 'aligned') return;
    f.level += 1;
    f.lineLevel = f.level;
    if (mode === 'hanging') this.cur!.baseShift = 1;
    else this.breakLine(f.level);
  }

  /**
   * After `SELECT` / `WITH` is pushed (`aligned`): every later line of the query is padded to the keyword's column.
   * Falls back to `hanging` when the column is past half of `maxLineLength`, or the prefix holds a multi-line comment.
   */
  alignEmbeddedQuery(f: Frame): void {
    const line = this.cur!;
    const toks = line.toks;
    let col = line.level * this.o.indentWidth + line.pad;
    for (let j = 0; j < toks.length - 1; j++) col += (j > 0 && toks[j].sp ? 1 : 0) + toks[j].t.length;
    if (toks[toks.length - 1].sp) col += 1;
    const max = this.o.maxLineLength;
    if (toks.some((t) => t.multi) || (max > 0 && col > Math.floor(max / 2))) {
      f.level += 1;
      line.baseShift = 1;
      return;
    }
    f.pad = col - f.level * this.o.indentWidth;
    line.contPad = f.pad;
  }

  /**
   * `[CREATE] STRUCTURED FILTER <name> FOR SELECT` `[HDI]` `[CLOUD]` (sql-sqlscript.md §6): `FOR SELECT` stays on
   * the header line, and `ON`, `ESCAPE`, `LIKE`, `NOT LIKE`, `WHERE` and `CONDITION PROVIDER` each start a line at
   * the header's level. Inside the `WHERE` condition, `LIKE` and `NOT` are operators again. Returns null for other words.
   */
  structuredFilterWord(tok: Token, i: number, up: string, nup: string, pup: string, f: Frame, st: StatementState): number | null {
    if (st.filter === 'header') {
      if (up !== 'SELECT' || pup !== 'FOR') return null;
      this.push(this.mkTok(tok, i));
      st.filter = 'clauses';
      return 0;
    }
    if (st.filter !== 'clauses' || !K.STRUCTURED_FILTER_CLAUSES.includes(up)) return null;
    // two-word clauses: `NOT LIKE`, `CONDITION PROVIDER`
    const second = up === 'NOT' ? 'LIKE' : up === 'CONDITION' ? 'PROVIDER' : null;
    if (second && nup !== second) return null;
    if (up === 'LIKE' && pup === 'NOT') return null;
    this.breakLine(f.level);
    f.clause = up === 'WHERE' ? 'where' : null;
    f.cont = null;
    this.push(this.mkTok(tok, i));
    let used = 0;
    const nx = this.t[i + 1];
    if (second && nx && nx.type === 'word' && nx.text.toUpperCase() === second) {
      this.emit(nx, i + 1);
      used = 1;
    }
    f.lineLevel = f.level + 1;
    if (up === 'WHERE' || up === 'CONDITION') st.filter = 'condition';
    return used;
  }

  /** Clause keywords. Returns null when the word is not a clause start. */
  clauseWord(tok: Token, i: number, up: string, nup: string, pup: string, f: Frame, st: StatementState): number | null {
    const o = this.o;
    const tk = (): LayoutToken => this.mkTok(tok, i);
    const startClause = (name: ClauseKind, ctx: ListContext | null): number => {
      this.breakLine(f.level);
      f.clause = name;
      f.cont = null;
      this.push(tk());
      f.lineLevel = f.level + 1;
      if (ctx && o.listCtx.has(ctx)) this.openCont(f, ctx, f.level + 1);
      return 0;
    };

    switch (up) {
      case 'SELECT': {
        const embed = this.isEmbeddedQueryStart(f, st) ? this.embeddedQueryMode() : null;
        if (embed) this.beforeEmbeddedQuery(f, embed);
        const inline = embed !== null || !this.cur || !this.cur.toks.length;
        f.hasSelect = true;
        f.clause = 'select';
        f.cont = null;
        if (!inline) this.breakLine(f.level);
        this.push(tk());
        if (embed === 'aligned') this.alignEmbeddedQuery(f);
        f.lineLevel = f.level + 1;
        if (o.listCtx.has('select')) this.openCont(f, 'select', f.level + 1);
        return 0;
      }

      case 'DISTINCT':
      case 'ALL':
        if (f.clause === 'select' && f.cont && !f.cont.broken && this.cur && f.cont.idx === this.cur.toks.length) {
          this.push(tk());
          f.cont.idx = this.cur.toks.length;
          return 0;
        }
        if (f.afterSetOp) {
          this.push(tk());
          f.afterSetOp = false;
          this.breakLine(f.level);
          return 0;
        }
        return null;

      case 'TOP':
        if (f.clause === 'select' && f.cont && !f.cont.broken && this.cur && f.cont.idx === this.cur.toks.length) {
          this.push(tk());
          const nx = this.t[i + 1];
          let used = 0;
          if (nx && nx.type === 'number') { this.emit(nx, i + 1); used = 1; }
          f.cont.idx = this.cur.toks.length;
          return used;
        }
        return null;

      case 'FROM':
        if (f.hasSelect) return startClause('from', 'from');
        return null;

      case 'WHERE':
        return startClause('where', null);

      case 'GROUP':
        if (nup === 'BY') {
          this.breakLine(f.level);
          f.clause = 'group';
          f.cont = null;
          this.push(tk());
          const by = this.t[i + 1];
          this.emit(by, i + 1);
          f.lineLevel = f.level + 1;
          if (o.listCtx.has('groupBy')) this.openCont(f, 'groupBy', f.level + 1);
          return 1;
        }
        return null;

      case 'ORDER':
        if (nup === 'BY') {
          this.breakLine(f.level);
          f.clause = 'order';
          f.cont = null;
          this.push(tk());
          const by = this.t[i + 1];
          this.emit(by, i + 1);
          f.lineLevel = f.level + 1;
          if (o.listCtx.has('orderBy')) this.openCont(f, 'orderBy', f.level + 1);
          return 1;
        }
        return null;

      case 'HAVING':
        return startClause('having', null);

      case 'LIMIT':
        return startClause('limit', null);

      case 'INTO':
        if (f.hasSelect && f.clause !== 'from' && f.clause !== 'where') return startClause('into', null);
        if (f.hasSelect && (f.clause === 'from' || f.clause === 'where')) return null;
        return null;

      case 'UNION': case 'INTERSECT': case 'EXCEPT': case 'MINUS':
        if (f.hasSelect || (this.cur && this.cur.toks.length)) {
          this.breakLine(f.level);
          this.push(tk());
          f.hasSelect = false;
          f.clause = null;
          f.cont = null;
          if (nup === 'ALL' || nup === 'DISTINCT') f.afterSetOp = true;
          else this.breakLine(f.level);
          return 0;
        }
        return null;

      case 'VALUES':
        if (st.kind === 'insert' && f.type === 'stmt') return startClause('values', null);
        return null;

      case 'SET':
        if (st.kind === 'update' && f.type === 'stmt' && !f.clause) return startClause('set', 'set');
        if (st.kind === 'update' && f.type === 'stmt' && f.clause === 'update') return startClause('set', 'set');
        return null;

      case 'USING':
        if (st.kind === 'merge' && f.type === 'stmt') return startClause('using', null);
        return null;

      case 'WITH':
        if (st.count === 0 && f.type !== 'plain') {
          f.clause = 'with';
          this.push(tk());
          f.lineLevel = f.level + 1;
          return 0;
        }
        if (this.isEmbeddedQueryStart(f, st)) {
          const embed = this.embeddedQueryMode();
          this.beforeEmbeddedQuery(f, embed);
          f.clause = 'with';
          this.push(tk());
          if (embed === 'aligned') this.alignEmbeddedQuery(f);
          f.lineLevel = f.level + 1;
          return 0;
        }
        return null;

      case 'ON':
        if (st.kind === 'merge' && f.type === 'stmt' && f.clause === 'using') {
          this.breakLine(f.level);
          f.clause = 'on';
          this.push(tk());
          f.lineLevel = f.level + 1;
          return 0;
        }
        if (f.clause === 'join' || f.clause === 'from') {
          if (o.joinOnNewLine) {
            this.breakLine(f.level + 1);
            f.lineLevel = f.level + 1;
          }
          f.clause = 'on';
          this.push(tk());
          f.lineLevel = f.level + 1;
          return 0;
        }
        return null;

      default:
        break;
    }

    // joins
    if (JOIN_STARTERS.has(up) && (f.clause === 'from' || f.clause === 'join' || f.clause === 'on')) {
      if (JOIN_PHRASE.has(pup) && f.clause === 'join' && this.cur && this.cur.toks.length) return null; // inside "LEFT OUTER JOIN"
      if ((up === 'LEFT' || up === 'RIGHT') && nup !== 'JOIN' && nup !== 'OUTER') return null;
      this.breakLine(f.level);
      f.clause = 'join';
      this.push(tk());
      f.lineLevel = f.level + 1;
      return 0;
    }
    if (up === 'OUTER' && f.clause === 'join') return null;

    return null;
  }

  // ---- end of input ------------------------------------------------------

  finish(): void {
    const o = this.o;
    const st = this.stmt;
    if (!this.fragment && o.trailingSemicolon === 'add' && st && !this.atStmtStart && st.count > 0 && this.lastTok && this.lastTok.t !== ';' && !st.hdiRoot && this.frames.length >= 1) {
      this.syntheticSemi();
    }
    if (!this.fragment && o.trailingSemicolon === 'remove') {
      for (let k = this.lines.length - 1; k >= 0; k--) {
        const line = this.lines[k];
        if (line.kind !== 'code') { if (line.kind === 'raw') break; continue; }
        let j = line.toks.length - 1;
        while (j >= 0 && line.toks[j].comment) j--;
        if (j >= 0 && line.toks[j].t === ';') line.toks.splice(j, 1);
        if (line.toks.length === 0) this.lines.splice(k, 1);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// render pass
// ---------------------------------------------------------------------------

function render(lines: readonly Line[], o: ResolvedFormatterOptions): string[] {
  const unit = o.useTabs ? '\t' : ' '.repeat(o.indentWidth);
  const indentOf = (level: number): string => unit.repeat(Math.max(0, level));
  const widthOf = (level: number): number => Math.max(0, level) * o.indentWidth;
  const out: string[] = [];

  lines.forEach((line, idx) => {
    if (idx > 0) for (let k = 0; k < line.blank; k++) out.push('');

    if (line.kind === 'raw') {
      out.push(...(line.raw ?? '').replace(/\r\n?/g, '\n').split('\n'));
      return;
    }

    if (line.kind === 'comment') {
      const tk = line.toks[0];
      const ind = indentOf(line.level) + ' '.repeat(line.pad);
      if (!tk.multi) { out.push(ind + tk.t); return; }
      const parts = tk.t.split('\n');
      const rest = parts.slice(1);
      const starred = rest.every((s) => s.trim() === '' || /^\s*\*/.test(s));
      out.push(ind + parts[0]);
      for (const s of rest) out.push(starred ? (s.trim() === '' ? '' : ind + ' ' + s.trim()) : s);
      return;
    }

    renderCode(line);
  });

  function renderCode(line: Line): void {
    const toks = line.toks;
    if (!toks.length) return;
    let firstIndent = indentOf(line.level) + ' '.repeat(line.pad);
    let outdent = 0;
    if (line.hang) {
      if (!o.useTabs && ((o.indentWidth >= 2 && line.level > 0) || line.pad >= 2)) {
        firstIndent = firstIndent.slice(0, -2);
        outdent = 2;
      }
    }
    const contPad = line.contPad ?? line.pad;
    const contIndent = indentOf(line.base + 1) + ' '.repeat(contPad);
    const max = o.maxLineLength;

    // text pieces
    const txt = (j: number, first: boolean): string => (first ? '' : toks[j].sp ? ' ' : '') + toks[j].t;
    const w = (j: number, first: boolean): number => (toks[j].comment ? 0 : txt(j, first).length);

    // wrap candidates
    const cands: WrapCandidate[] = [];
    if (max > 0) {
      let depth = 0;
      const depthAt: number[] = [];
      for (let j = 0; j < toks.length; j++) {
        depthAt[j] = depth;
        if (toks[j].t === '(' || toks[j].t === '[') depth++;
        else if (toks[j].t === ')' || toks[j].t === ']') depth--;
      }
      for (let j = 1; j < toks.length; j++) {
        const p = toks[j - 1];
        const t = toks[j];
        if (t.comment || p.comment || t.t === ')' || t.t === ';') continue;
        if (j === 1 && line.hang) continue;
        let pr = 0;
        if (p.t === ',') pr = 1;
        else if (t.k === 'word' && t.cls === 'keyword' && (t.up === 'AND' || t.up === 'OR') && !t.noBreak) pr = 2;
        else if (t.op === 'binary' && WRAP_BINARY.has(t.t)) pr = 3;
        if (pr) cands.push({ j, pr, depth: depthAt[j] });
      }
    }

    const starts: number[] = [0];
    let segStart = 0;
    let segW = widthOf(line.level) + line.pad - outdent;
    const contW = widthOf(line.base + 1) + contPad;
    if (max > 0) {
      for (let j = 0; j < toks.length; j++) {
        for (;;) {
          const add = w(j, j === segStart);
          if (segW + add <= max || j === segStart) { segW += add; break; }
          let best: WrapCandidate | null = null;
          for (const c of cands) {
            if (c.j <= segStart || c.j > j) continue;
            if (!best || c.depth < best.depth || (c.depth === best.depth && (c.pr < best.pr || (c.pr === best.pr && c.j > best.j)))) best = c;
          }
          if (!best) { segW += add; break; }
          starts.push(best.j);
          segStart = best.j;
          segW = contW;
          for (let m = segStart; m < j; m++) segW += w(m, m === segStart);
        }
      }
    }
    starts.push(toks.length);
    for (let s = 0; s < starts.length - 1; s++) {
      let text = '';
      for (let j = starts[s]; j < starts[s + 1]; j++) text += txt(j, j === starts[s]);
      out.push(((s === 0 ? firstIndent : contIndent) + text).replace(/\s+$/, ''));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

function isResolvedOptions(
  opts: PartialFormatterOptions | ResolvedFormatterOptions
): opts is ResolvedFormatterOptions {
  return 'listCtx' in opts && opts.listCtx instanceof Set;
}

export function format(
  text: string,
  userOptions: PartialFormatterOptions | ResolvedFormatterOptions = {},
  editor: EditorOptions = {},
  extra: FormatExtraOptions = {}
): string {
  const o = isResolvedOptions(userOptions) ? userOptions : resolveOptions(userOptions, editor);
  const tokens = tokenize(text);
  if (tokens.length === 0) return o.insertFinalNewline && !extra.fragment && text.length ? '' : '';
  const lines = new Layout(tokens, o, extra).run();
  const rendered = render(lines, o);
  let result = rendered.join(o.eol);
  if (!extra.fragment) result += o.insertFinalNewline ? o.eol : '';
  return result;
}
