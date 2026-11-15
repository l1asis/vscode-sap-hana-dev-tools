import { analyzeDelimiters, type DelimTokenInput } from './delimiters';

export interface JsonSpan {
  readonly start: number;
  readonly end: number;
}

export interface JsonObjectProperty {
  readonly key: string;
  readonly keyStart: number;
  readonly keyEnd: number;
  readonly value: JsonAstNode;
  readonly entryStart: number;
  readonly entryEnd: number;
}

export interface JsonObjectNode extends JsonSpan {
  readonly kind: 'object';
  readonly properties: readonly JsonObjectProperty[];
}

export interface JsonArrayNode extends JsonSpan {
  readonly kind: 'array';
  readonly items: readonly JsonAstNode[];
}

export interface JsonPrimitiveNode extends JsonSpan {
  readonly kind: 'string' | 'number' | 'boolean' | 'null';
  readonly raw: string;
  readonly value: string | number | boolean | null;
}

export type JsonAstNode = JsonObjectNode | JsonArrayNode | JsonPrimitiveNode;

export type JsonSyntaxErrorCode =
  | 'empty-document'
  | 'unterminated-string'
  | 'unterminated-comment'
  | 'trailing-comma'
  | 'missing-comma'
  | 'missing-colon'
  | 'unclosed-container'
  | 'invalid-quote'
  | 'unquoted-key'
  | 'expected-value'
  | 'unexpected-token'
  | 'trailing-token';

export interface JsonSyntaxError {
  readonly code: JsonSyntaxErrorCode;
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface JsonParseOptions {
  /** Tolerate omitted commas between members (e.g., `.xssqlcc` artifacts). */
  readonly allowMissingCommas?: boolean;
  /** Permit empty/whitespace-only documents (e.g., `.xsapp` marker files). */
  readonly allowEmpty?: boolean;
  /** Permit `//` and `/* *\/` JSONC comments (default `true`). */
  readonly allowComments?: boolean;
}

export interface JsonParseResult {
  readonly ast: JsonAstNode | null;
  readonly errors: readonly JsonSyntaxError[];
}

/**
 * Lightweight span-preserving JSON / JSONC AST parser for SAP HANA config and role artifacts.
 * Recovers a partial AST even when syntax errors exist, and records structured errors separately.
 */
export function parseJsonAst(text: string): JsonAstNode | null {
  return parseJsonAstWithErrors(text).ast;
}

function scanJsonContainerDelims(text: string, allowComments: boolean): DelimTokenInput[] {
  const out: DelimTokenInput[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === q) {
          i++;
          break;
        }
        if (text[i] === '\n' || text[i] === '\r') break;
        i++;
      }
      continue;
    }
    if (allowComments && ch === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (allowComments && ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']') {
      out.push({ ch, start: i, end: i + 1 });
    }
    i++;
  }
  return out;
}

/**
 * Parses JSON / JSONC while collecting syntax diagnostics (`HANA-SYN-010`, `HANA-SYN-011`)
 * and preserving a best-effort recovery AST for downstream semantic checks.
 */
export function parseJsonAstWithErrors(text: string, options: JsonParseOptions = {}): JsonParseResult {
  const allowMissingCommas = options.allowMissingCommas ?? false;
  const allowEmpty = options.allowEmpty ?? false;
  const allowComments = options.allowComments ?? true;
  const delimRecovery = analyzeDelimiters(text, scanJsonContainerDelims(text, allowComments), {
    fenceSemicolon: 'none',
  });

  let i = 0;
  const n = text.length;
  const errors: JsonSyntaxError[] = [];

  function pushError(code: JsonSyntaxErrorCode, message: string, start: number, end: number): void {
    const safeStart = Math.max(0, Math.min(start, n));
    const safeEnd = Math.max(safeStart, Math.min(Math.max(end, safeStart + (safeStart < n ? 1 : 0)), n));
    // Avoid stacking duplicate errors at the exact same offset.
    if (errors.some((e) => e.code === code && e.start === safeStart)) return;
    errors.push({ code, message, start: safeStart, end: safeEnd });
  }

  function skipTrivia(): void {
    while (i < n) {
      const ch = text[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\ufeff') {
        i++;
        continue;
      }
      if (allowComments && ch === '/' && text[i + 1] === '/') {
        i += 2;
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (allowComments && ch === '/' && text[i + 1] === '*') {
        const commentStart = i;
        i += 2;
        let closed = false;
        while (i + 1 < n) {
          if (text[i] === '*' && text[i + 1] === '/') {
            i += 2;
            closed = true;
            break;
          }
          i++;
        }
        if (!closed) {
          i = n;
          pushError('unterminated-comment', "Unterminated block comment '/*'.", commentStart, commentStart + 2);
        }
        continue;
      }
      break;
    }
  }

  function parseString(): JsonPrimitiveNode | null {
    if (text[i] !== '"') return null;
    const start = i;
    i++;
    let value = '';
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') {
        if (i + 1 >= n) {
          i = n;
          pushError('unterminated-string', 'Unterminated string literal.', start, Math.min(n, start + 2));
          return { kind: 'string', raw: text.slice(start, i), value, start, end: i };
        }
        const next = text[i + 1];
        if (next === 'n') value += '\n';
        else if (next === 'r') value += '\r';
        else if (next === 't') value += '\t';
        else if (next === 'u' && /^[0-9a-fA-F]{4}/.test(text.slice(i + 2, i + 6))) {
          value += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 4;
        } else {
          value += next;
        }
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        return { kind: 'string', raw: text.slice(start, i), value, start, end: i };
      }
      if (ch === '\n' || ch === '\r') {
        pushError('unterminated-string', 'Unterminated string literal.', start, i);
        return { kind: 'string', raw: text.slice(start, i), value, start, end: i };
      }
      value += ch;
      i++;
    }
    pushError('unterminated-string', 'Unterminated string literal.', start, i);
    return { kind: 'string', raw: text.slice(start, i), value, start, end: i };
  }

  function parseSingleQuotedRecovery(): JsonPrimitiveNode {
    const start = i;
    i++; // '\''
    let value = '';
    let closed = false;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < n) {
        value += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '\'') {
        i++;
        closed = true;
        break;
      }
      if (ch === '\n' || ch === '\r') break;
      value += ch;
      i++;
    }
    const msg = closed
      ? 'Single-quoted strings are not valid in JSON; use double quotes.'
      : 'Unterminated single-quoted string; JSON requires double quotes.';
    pushError('invalid-quote', msg, start, i);
    return { kind: 'string', raw: text.slice(start, i), value, start, end: i };
  }

  /**
   * Checks whether `text` at current `i` looks like a new property entry (`"key":` or `key:`)
   * so missing property values don't swallow the next property's key.
   */
  function looksLikeNextPropertyKey(): boolean {
    if (text[i] !== '"') return false;
    let j = i + 1;
    while (j < n) {
      const ch = text[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '"') {
        j++;
        break;
      }
      if (ch === '\n' || ch === '\r') return false;
      j++;
    }
    while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
    return text[j] === ':';
  }

  function parseValue(): JsonAstNode | null {
    skipTrivia();
    if (i >= n) return null;
    const ch = text[i];
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"') return parseString();
    if (ch === '\'') return parseSingleQuotedRecovery();

    const start = i;
    if (text.startsWith('true', i) && !/[A-Za-z0-9_$]/.test(text[i + 4] ?? '')) {
      i += 4;
      return { kind: 'boolean', raw: 'true', value: true, start, end: i };
    }
    if (text.startsWith('false', i) && !/[A-Za-z0-9_$]/.test(text[i + 5] ?? '')) {
      i += 5;
      return { kind: 'boolean', raw: 'false', value: false, start, end: i };
    }
    if (text.startsWith('null', i) && !/[A-Za-z0-9_$]/.test(text[i + 4] ?? '')) {
      i += 4;
      return { kind: 'null', raw: 'null', value: null, start, end: i };
    }
    const numMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (numMatch) {
      const afterNum = text[i + numMatch[0].length] ?? '';
      if (!/[0-9A-Za-z_.]/.test(afterNum)) {
        i += numMatch[0].length;
        return { kind: 'number', raw: numMatch[0], value: Number(numMatch[0]), start, end: i };
      }
    }
    return null;
  }

  function skipInvalidValueToken(): boolean {
    const start = i;
    if (i >= n) return false;
    if (/[A-Za-z0-9_$.+-]/.test(text[i])) {
      while (i < n && /[A-Za-z0-9_$.+-]/.test(text[i])) i++;
      pushError('unexpected-token', `Unexpected JSON token '${text.slice(start, i)}'.`, start, i);
      return true;
    }
    pushError('unexpected-token', `Unexpected character '${text[i]}' in JSON.`, start, start + 1);
    i++;
    return true;
  }

  function parseArray(): JsonArrayNode {
    const start = i;
    const stopBefore = delimRecovery.unclosedStarts.get(start);
    i++; // '['
    const items: JsonAstNode[] = [];
    while (i < n) {
      skipTrivia();
      if (i >= n) {
        pushError('unclosed-container', "Unclosed JSON array '['.", start, start + 1);
        return { kind: 'array', items, start, end: i };
      }
      if (text[i] === '}') {
        pushError('unexpected-token', "Unexpected '}' inside JSON array; expected ']'.", i, i + 1);
        return { kind: 'array', items, start, end: i };
      }
      if (stopBefore !== undefined && i >= stopBefore) {
        pushError('unclosed-container', "Unclosed JSON array '['.", start, start + 1);
        return { kind: 'array', items, start, end: i };
      }
      if (text[i] === ']') {
        if (delimRecovery.unmatchedCloseStarts.has(i)) {
          pushError('unexpected-token', "Unmatched closing ']' in JSON array.", i, i + 1);
          i++;
          skipTrivia();
          if (text[i] === ',') i++;
          continue;
        }
        i++;
        return { kind: 'array', items, start, end: i };
      }
      const item = parseValue();
      if (!item) {
        if (!skipInvalidValueToken()) break;
        skipTrivia();
        if (text[i] === ',') {
          const commaPos = i;
          i++;
          skipTrivia();
          if (text[i] === ']') {
            pushError('trailing-comma', 'Trailing comma is not allowed in JSON artifacts.', commaPos, commaPos + 1);
            i++;
            return { kind: 'array', items, start, end: i };
          }
        }
        continue;
      }
      items.push(item);
      skipTrivia();
      if (i >= n) {
        pushError('unclosed-container', "Unclosed JSON array '['.", start, start + 1);
        return { kind: 'array', items, start, end: i };
      }
      if (text[i] === ',') {
        const commaPos = i;
        i++;
        skipTrivia();
        if (text[i] === ']') {
          pushError('trailing-comma', 'Trailing comma is not allowed in JSON artifacts.', commaPos, commaPos + 1);
          i++;
          return { kind: 'array', items, start, end: i };
        }
        continue;
      }
      if (text[i] === '}') {
        pushError('unexpected-token', "Unexpected '}' inside JSON array; expected ']'.", i, i + 1);
        return { kind: 'array', items, start, end: i };
      }
      if (stopBefore !== undefined && i >= stopBefore) {
        pushError('unclosed-container', "Unclosed JSON array '['.", start, start + 1);
        return { kind: 'array', items, start, end: i };
      }
      if (text[i] === ']') {
        if (delimRecovery.unmatchedCloseStarts.has(i)) {
          pushError('unexpected-token', "Unmatched closing ']' in JSON array.", i, i + 1);
          i++;
          skipTrivia();
          if (text[i] === ',') i++;
          continue;
        }
        i++;
        return { kind: 'array', items, start, end: i };
      }
      if (!allowMissingCommas) {
        pushError('missing-comma', "Expected ',' between JSON array elements.", i, i + 1);
      }
    }
    pushError('unclosed-container', "Unclosed JSON array '['.", start, start + 1);
    return { kind: 'array', items, start, end: i };
  }

  function parseObject(): JsonObjectNode {
    const start = i;
    const stopBefore = delimRecovery.unclosedStarts.get(start);
    i++; // '{'
    const properties: JsonObjectProperty[] = [];
    while (i < n) {
      skipTrivia();
      if (i >= n) {
        pushError('unclosed-container', "Unclosed JSON object '{'.", start, start + 1);
        return { kind: 'object', properties, start, end: i };
      }
      if (text[i] === ']') {
        pushError('unexpected-token', "Unexpected ']' inside JSON object; expected '}'.", i, i + 1);
        return { kind: 'object', properties, start, end: i };
      }
      if (stopBefore !== undefined && i >= stopBefore) {
        pushError('unclosed-container', "Unclosed JSON object '{'.", start, start + 1);
        return { kind: 'object', properties, start, end: i };
      }
      if (text[i] === '}') {
        if (delimRecovery.unmatchedCloseStarts.has(i)) {
          pushError('unexpected-token', "Unmatched closing '}' in JSON object.", i, i + 1);
          i++;
          skipTrivia();
          if (text[i] === ',') i++;
          continue;
        }
        i++;
        return { kind: 'object', properties, start, end: i };
      }

      let keyNode: JsonPrimitiveNode | null = null;
      if (text[i] === '"') {
        keyNode = parseString();
      } else if (text[i] === '\'') {
        keyNode = parseSingleQuotedRecovery();
      } else if (/[A-Za-z_$]/.test(text[i])) {
        const keyStart = i;
        while (i < n && /[A-Za-z0-9_$-]/.test(text[i])) i++;
        const rawKey = text.slice(keyStart, i);
        pushError('unquoted-key', `JSON object key '${rawKey}' must be double-quoted.`, keyStart, i);
        keyNode = { kind: 'string', raw: rawKey, value: rawKey, start: keyStart, end: i };
      } else {
        if (!skipInvalidValueToken()) break;
        skipTrivia();
        if (text[i] === ',') i++;
        continue;
      }

      if (!keyNode) continue;
      skipTrivia();
      if (i >= n) {
        pushError('unclosed-container', "Unclosed JSON object '{'.", start, start + 1);
        return { kind: 'object', properties, start, end: i };
      }

      let hadColon = false;
      let colonPos = keyNode.end;
      if (text[i] === ':') {
        hadColon = true;
        colonPos = i;
        i++;
      } else {
        pushError('missing-colon', "Expected ':' after JSON property key.", keyNode.start, keyNode.end);
        // If followed by another property or delimiter, do not consume it as this key's value.
        if (text[i] === ',' || text[i] === '}' || looksLikeNextPropertyKey()) {
          if (text[i] === ',') i++;
          continue;
        }
      }

      skipTrivia();
      if (i >= n) {
        if (hadColon) {
          pushError('expected-value', 'Expected property value after ":".', colonPos, colonPos + 1);
        }
        pushError('unclosed-container', "Unclosed JSON object '{'.", start, start + 1);
        return { kind: 'object', properties, start, end: i };
      }

      if (text[i] === ',' || text[i] === '}' || (hadColon && looksLikeNextPropertyKey())) {
        pushError('expected-value', 'Expected property value after ":".', colonPos, colonPos + 1);
        if (text[i] === ',') i++;
        continue;
      }

      const value = parseValue();
      if (!value) {
        if (!skipInvalidValueToken()) break;
        skipTrivia();
        if (text[i] === ',') {
          const commaPos = i;
          i++;
          skipTrivia();
          if (text[i] === '}') {
            pushError('trailing-comma', 'Trailing comma is not allowed in JSON artifacts.', commaPos, commaPos + 1);
            i++;
            return { kind: 'object', properties, start, end: i };
          }
        }
        continue;
      }

      properties.push({
        key: String(keyNode.value),
        keyStart: keyNode.start,
        keyEnd: keyNode.end,
        value,
        entryStart: keyNode.start,
        entryEnd: value.end,
      });

      skipTrivia();
      if (i >= n) {
        pushError('unclosed-container', "Unclosed JSON object '{'.", start, start + 1);
        return { kind: 'object', properties, start, end: i };
      }
      if (text[i] === ',') {
        const commaPos = i;
        i++;
        skipTrivia();
        if (text[i] === '}') {
          pushError('trailing-comma', 'Trailing comma is not allowed in JSON artifacts.', commaPos, commaPos + 1);
          i++;
          return { kind: 'object', properties, start, end: i };
        }
        continue;
      }
      if (text[i] === ']') {
        pushError('unexpected-token', "Unexpected ']' inside JSON object; expected '}'.", i, i + 1);
        return { kind: 'object', properties, start, end: i };
      }
      if (stopBefore !== undefined && i >= stopBefore) {
        pushError('unclosed-container', "Unclosed JSON object '{'.", start, start + 1);
        return { kind: 'object', properties, start, end: i };
      }
      if (text[i] === '}') {
        if (delimRecovery.unmatchedCloseStarts.has(i)) {
          pushError('unexpected-token', "Unmatched closing '}' in JSON object.", i, i + 1);
          i++;
          skipTrivia();
          if (text[i] === ',') i++;
          continue;
        }
        i++;
        return { kind: 'object', properties, start, end: i };
      }
      if (!allowMissingCommas) {
        pushError('missing-comma', "Expected ',' between JSON object properties.", i, i + 1);
      }
    }
    pushError('unclosed-container', "Unclosed JSON object '{'.", start, start + 1);
    return { kind: 'object', properties, start, end: i };
  }

  skipTrivia();
  if (i >= n) {
    if (!allowEmpty && errors.length === 0) {
      pushError('empty-document', 'Expected a JSON object, array, or value.', 0, n > 0 ? 1 : 0);
    }
    return { ast: null, errors };
  }

  const ast = parseValue();
  if (!ast) {
    skipInvalidValueToken();
    return { ast: null, errors };
  }

  skipTrivia();
  if (i < n) {
    const tailEnd = Math.min(n, i + 20);
    pushError('trailing-token', `Unexpected trailing content after JSON root value.`, i, tailEnd);
  }

  return { ast, errors };
}

export function findObjectProp(obj: JsonObjectNode, key: string): JsonObjectProperty | undefined {
  return obj.properties.find((p) => p.key === key);
}

/**
 * Produces an insertion `TextEdit` appending a new key-value pair neatly inside `obj`.
 */
export function buildJsonInsertPropertyEdit(
  text: string,
  obj: JsonObjectNode,
  key: string,
  serializedValue: string
): { start: number; end: number; newText: string } {
  const closeBrace = obj.end - 1;
  const lineStart = text.lastIndexOf('\n', obj.start) + 1;
  const baseIndentMatch = /^[ \t]*/.exec(text.slice(lineStart, obj.start));
  const baseIndent = baseIndentMatch ? baseIndentMatch[0] : '';
  const propIndent = obj.properties.length > 0
    ? (/^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', obj.properties[0].entryStart) + 1, obj.properties[0].entryStart))?.[0] ?? `${baseIndent}  `)
    : `${baseIndent}  `;

  if (obj.properties.length === 0) {
    return {
      start: obj.start + 1,
      end: closeBrace,
      newText: `\n${propIndent}"${key}": ${serializedValue}\n${baseIndent}`,
    };
  }

  const last = obj.properties[obj.properties.length - 1];
  const afterLast = text.slice(last.entryEnd, closeBrace);
  const hasTrailingComma = afterLast.includes(',');
  const insertAt = hasTrailingComma ? last.entryEnd + afterLast.indexOf(',') + 1 : last.entryEnd;
  const prefix = hasTrailingComma ? '' : ',';
  return {
    start: insertAt,
    end: insertAt,
    newText: `${prefix}\n${propIndent}"${key}": ${serializedValue}`,
  };
}
