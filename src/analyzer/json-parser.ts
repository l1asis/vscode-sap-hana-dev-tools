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

/**
 * Lightweight span-preserving JSON / JSONC AST parser for SAP HANA config and role artifacts.
 * Tolerates `//` line comments, `/* *\/` block comments, and trailing commas while tracking exact offsets.
 */
export function parseJsonAst(text: string): JsonAstNode | null {
  let i = 0;
  const n = text.length;

  function skipTrivia(): void {
    while (i < n) {
      const ch = text[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\ufeff') {
        i++;
        continue;
      }
      if (ch === '/' && text[i + 1] === '/') {
        i += 2;
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && text[i + 1] === '*') {
        i += 2;
        while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i = Math.min(n, i + 2);
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
        const next = text[i + 1] ?? '';
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
      value += ch;
      i++;
    }
    return { kind: 'string', raw: text.slice(start, i), value, start, end: i };
  }

  function parseValue(): JsonAstNode | null {
    skipTrivia();
    if (i >= n) return null;
    const ch = text[i];
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"') return parseString();

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
      i += numMatch[0].length;
      return { kind: 'number', raw: numMatch[0], value: Number(numMatch[0]), start, end: i };
    }
    return null;
  }

  function parseArray(): JsonArrayNode {
    const start = i;
    i++; // '['
    const items: JsonAstNode[] = [];
    while (i < n) {
      skipTrivia();
      if (text[i] === ']') {
        i++;
        return { kind: 'array', items, start, end: i };
      }
      const item = parseValue();
      if (!item) break;
      items.push(item);
      skipTrivia();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return { kind: 'array', items, start, end: i };
      }
      break;
    }
    return { kind: 'array', items, start, end: i };
  }

  function parseObject(): JsonObjectNode {
    const start = i;
    i++; // '{'
    const properties: JsonObjectProperty[] = [];
    while (i < n) {
      skipTrivia();
      if (text[i] === '}') {
        i++;
        return { kind: 'object', properties, start, end: i };
      }
      const keyNode = parseString();
      if (!keyNode) break;
      skipTrivia();
      if (text[i] === ':') i++;
      const value = parseValue();
      if (!value) break;
      properties.push({
        key: String(keyNode.value),
        keyStart: keyNode.start,
        keyEnd: keyNode.end,
        value,
        entryStart: keyNode.start,
        entryEnd: value.end,
      });
      skipTrivia();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return { kind: 'object', properties, start, end: i };
      }
      break;
    }
    return { kind: 'object', properties, start, end: i };
  }

  return parseValue();
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
