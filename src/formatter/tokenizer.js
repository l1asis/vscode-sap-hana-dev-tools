'use strict';

/**
 * Lossless-enough tokenizer for SAP HANA SQL / SQLScript.
 *
 * Token types:
 *   word, number, string, qident, var (:name), sysvar (::NAME), param (?),
 *   op, punct, lineComment, blockComment, other, raw (format-off region)
 *
 * Every token carries:
 *   nlBefore  number of line breaks in the whitespace in front of it
 *   wsBefore  whether there was any whitespace in front of it
 *   start/end offsets into the source text
 */

const WORD_START = /[\p{L}_#$]/u;
const WORD_PART = /[\p{L}\p{N}_#$]/u;
const DIGIT = /[0-9]/;

const OFF_RE = /^(?:--|\/\*)\s*hanasql-format\s*:?\s*off\b/i;
const ON_RE = /^(?:--|\/\*)\s*hanasql-format\s*:?\s*on\b/i;

function tokenize(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  let nl = 0;
  let ws = false;

  const push = (type, start, end) => {
    tokens.push({ type, text: text.slice(start, end), nlBefore: nl, wsBefore: ws, start, end });
    nl = 0;
    ws = false;
  };

  while (i < n) {
    const ch = text[i];

    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '\u00a0' || ch === '\ufeff') {
      ws = true;
      if (ch === '\n') nl++;
      i++;
      continue;
    }

    // line comment
    if (ch === '-' && text[i + 1] === '-') {
      let j = i + 2;
      while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
      push('lineComment', i, j);
      i = j;
      continue;
    }

    // block comment
    if (ch === '/' && text[i + 1] === '*') {
      let j = text.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      push('blockComment', i, j);
      i = j;
      continue;
    }

    // string literal
    if (ch === "'") {
      const j = scanString(text, i);
      push('string', i, j);
      i = j;
      continue;
    }

    // quoted identifier
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      push('qident', i, j);
      i = j;
      continue;
    }

    // numbers
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[i + 1] || '') && !isValueEnd(tokens))) {
      let j = i;
      while (j < n && DIGIT.test(text[j])) j++;
      if (text[j] === '.' && DIGIT.test(text[j + 1] || '')) {
        j++;
        while (j < n && DIGIT.test(text[j])) j++;
      }
      if ((text[j] === 'e' || text[j] === 'E') && (DIGIT.test(text[j + 1] || '') || ((text[j + 1] === '+' || text[j + 1] === '-') && DIGIT.test(text[j + 2] || '')))) {
        j += 2;
        while (j < n && DIGIT.test(text[j])) j++;
      }
      push('number', i, j);
      i = j;
      continue;
    }

    // words (and N'..' / X'..' literals)
    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < n && WORD_PART.test(text[j])) j++;
      // SQLScript library call: lib:member( ... )
      if (text[j] === ':' && WORD_START.test(text[j + 1] || '') && text[j + 1] !== ':') {
        let k = j + 2;
        while (k < n && WORD_PART.test(text[k])) k++;
        if (text[k] === '(') {
          push('word', i, k);
          i = k;
          continue;
        }
      }
      if (j - i === 1 && /[NXnx]/.test(ch) && text[j] === "'") {
        const k = scanString(text, j);
        push('string', i, k);
        i = k;
        continue;
      }
      push('word', i, j);
      i = j;
      continue;
    }

    // SQLScript variables
    if (ch === ':') {
      if (text[i + 1] === '=') { push('op', i, i + 2); i += 2; continue; }
      if (text[i + 1] === ':' && WORD_START.test(text[i + 2] || '')) {
        let j = i + 3;
        while (j < n && WORD_PART.test(text[j])) j++;
        push('sysvar', i, j);
        i = j;
        continue;
      }
      if (WORD_START.test(text[i + 1] || '')) {
        let j = i + 2;
        while (j < n && WORD_PART.test(text[j])) j++;
        push('var', i, j);
        i = j;
        continue;
      }
      push('punct', i, i + 1);
      i++;
      continue;
    }

    if (ch === '?') { push('param', i, i + 1); i++; continue; }

    // operators
    const two = text.substr(i, 2);
    if (two === '||' || two === '<>' || two === '!=' || two === '<=' || two === '>=' || two === '=>') {
      push('op', i, i + 2);
      i += 2;
      continue;
    }
    if (two === '..') { push('punct', i, i + 2); i += 2; continue; }
    if ('+-*/%=<>'.includes(ch)) { push('op', i, i + 1); i++; continue; }

    if ('(),;.[]{}'.includes(ch)) { push('punct', i, i + 1); i++; continue; }

    push('other', i, i + 1);
    i++;
  }

  return collapseFormatOff(tokens, text);
}

function scanString(text, i) {
  const n = text.length;
  let j = i + 1;
  while (j < n) {
    if (text[j] === "'") {
      if (text[j + 1] === "'") { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return n;
}

function isValueEnd(tokens) {
  const t = tokens[tokens.length - 1];
  if (!t) return false;
  return t.type === 'word' || t.type === 'qident' || t.type === 'number' || t.text === ')' || t.text === ']';
}

/** Replace "-- hanasql-format off" ... "-- hanasql-format on" regions by one raw token. */
function collapseFormatOff(tokens, text) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ((t.type === 'lineComment' || t.type === 'blockComment') && OFF_RE.test(t.text)) {
      let j = i + 1;
      while (j < tokens.length && !((tokens[j].type === 'lineComment' || tokens[j].type === 'blockComment') && ON_RE.test(tokens[j].text))) j++;
      const last = j < tokens.length ? tokens[j] : tokens[tokens.length - 1];
      out.push({
        type: 'raw',
        text: text.slice(t.start, last.end),
        nlBefore: t.nlBefore,
        wsBefore: t.wsBefore,
        start: t.start,
        end: last.end,
      });
      i = j;
      continue;
    }
    out.push(t);
  }
  return out;
}

module.exports = { tokenize };
