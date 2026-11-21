/**
 * Lossless, dependency-free XML parser for the `text.xml.hana` artifacts (`docs/specs/grammars/hana-xml.md` §5).
 * It records exact offsets for elements and attributes and recovers from every well-formedness error, so one broken
 * tag never hides the rest of the document. No DTD, schema or namespace validation.
 */

export interface XmlAttr {
  readonly name: string;
  readonly value: string;
  readonly attrStart: number;
  readonly attrEnd: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

export interface XmlElementNode {
  readonly tagName: string;
  readonly start: number;
  readonly openTagEnd: number;
  end: number;
  readonly selfClosing: boolean;
  readonly attrs: readonly XmlAttr[];
  readonly attrMap: ReadonlyMap<string, XmlAttr>;
  readonly children: XmlElementNode[];
  readonly parent?: XmlElementNode;
}

/**
 * Well-formedness error class (`hana-xml.md` §5), mapped to `HANA-SYN-001` / `-002` / `-003` / `-012` by
 * `analyzeXmlSyntax` and reported as `HANA-LINT-101` for calculation views.
 */
export type XmlErrorKind =
  | 'unterminated-comment'
  | 'unterminated-cdata'
  | 'unterminated-pi'
  | 'unterminated-declaration'
  | 'unterminated-tag'
  | 'unterminated-close-tag'
  | 'unterminated-value'
  | 'attribute'
  | 'mismatched-close'
  | 'unexpected-close'
  | 'unclosed-element';

export interface XmlParseError {
  readonly kind: XmlErrorKind;
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface XmlParseResult {
  readonly roots: readonly XmlElementNode[];
  readonly errors: readonly XmlParseError[];
}

const NAME_CHAR = /[A-Za-z0-9_:\-.]/;
const SPACE = /\s/;

export function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** End of the line containing `offset` (before `\r\n` / `\n`), capped at `limit`. */
function lineEndFrom(text: string, offset: number, limit: number): number {
  let i = offset;
  while (i < limit && text[i] !== '\n' && text[i] !== '\r') i++;
  return i;
}

function parseAttributes(
  text: string,
  sliceStart: number,
  sliceEnd: number
): { attrs: XmlAttr[]; error?: { message: string; start: number; end: number } } {
  const attrs: XmlAttr[] = [];
  let i = sliceStart;
  while (i < sliceEnd) {
    while (i < sliceEnd && SPACE.test(text[i])) i++;
    if (i >= sliceEnd) break;

    const attrStart = i;
    while (i < sliceEnd && NAME_CHAR.test(text[i])) i++;
    if (i === attrStart) {
      return { attrs, error: { message: `Unexpected character '${text[i]}' inside element attributes`, start: i, end: i + 1 } };
    }
    const name = text.slice(attrStart, i);

    while (i < sliceEnd && SPACE.test(text[i])) i++;
    if (text[i] !== '=') {
      return { attrs, error: { message: `Expected '=' after attribute '${name}'`, start: attrStart, end: attrStart + name.length } };
    }
    i++;
    while (i < sliceEnd && SPACE.test(text[i])) i++;
    const quote = text[i];
    if (quote !== '"' && quote !== '\'') {
      return { attrs, error: { message: `Expected quoted value for attribute '${name}'`, start: attrStart, end: attrStart + name.length } };
    }
    const valueStart = i;
    i++;
    while (i < sliceEnd && text[i] !== quote) i++;
    if (i >= sliceEnd) {
      // The tag scanner already reported the unterminated value; keep what was read.
      attrs.push({ name, value: decodeXmlEntities(text.slice(valueStart + 1, sliceEnd)), attrStart, attrEnd: sliceEnd, valueStart, valueEnd: sliceEnd });
      return { attrs };
    }
    const valueEnd = i + 1;
    i++;
    attrs.push({
      name,
      value: decodeXmlEntities(text.slice(valueStart + 1, valueEnd - 1)),
      attrStart,
      attrEnd: valueEnd,
      valueStart,
      valueEnd,
    });
  }
  return { attrs };
}

/** Skips `<!...>` declarations (`<!DOCTYPE x [ ... ]>`), honouring quotes and an internal `[...]` subset. */
function skipDeclaration(text: string, lt: number): number {
  let i = lt + 2;
  let quote: string | null = null;
  let subset = 0;
  while (i < text.length) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === '\'') {
      quote = c;
    } else if (c === '[') {
      subset++;
    } else if (c === ']') {
      subset = Math.max(0, subset - 1);
    } else if (c === '>' && subset === 0) {
      return i + 1;
    }
    i++;
  }
  return -1;
}

/** Parses `text` into element trees plus every well-formedness error (`hana-xml.md` §5). */
export function parseXmlTree(text: string): XmlParseResult {
  const roots: XmlElementNode[] = [];
  const stack: XmlElementNode[] = [];
  const errors: XmlParseError[] = [];
  // Elements whose start tag was broken: they may have been empty elements, so they close silently.
  const recovered = new Set<XmlElementNode>();
  // An unterminated comment, CDATA section, declaration or PI swallows the rest: the elements still open are not
  // reported again as unclosed.
  let swallowed = false;
  const n = text.length;
  let i = 0;

  const addNode = (tagName: string, lt: number, tagEnd: number, selfClosing: boolean, attrs: XmlAttr[]): XmlElementNode => {
    const attrMap = new Map<string, XmlAttr>();
    for (const a of attrs) attrMap.set(a.name, a);
    const parent = stack[stack.length - 1];
    const node: XmlElementNode = { tagName, start: lt, openTagEnd: tagEnd, end: tagEnd, selfClosing, attrs, attrMap, children: [], parent };
    if (parent) parent.children.push(node);
    else roots.push(node);
    if (!selfClosing) stack.push(node);
    return node;
  };

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) {
        errors.push({ kind: 'unterminated-comment', message: 'Unterminated XML comment', start: lt, end: Math.min(n, lt + 4) });
        swallowed = true;
        break;
      }
      i = end + 3;
      continue;
    }

    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) {
        errors.push({ kind: 'unterminated-cdata', message: 'Unterminated CDATA section', start: lt, end: Math.min(n, lt + 9) });
        swallowed = true;
        break;
      }
      i = end + 3;
      continue;
    }

    if (text.startsWith('<!', lt)) {
      const end = skipDeclaration(text, lt);
      if (end === -1) {
        errors.push({ kind: 'unterminated-declaration', message: 'Unterminated XML declaration', start: lt, end: Math.min(n, lt + 2) });
        swallowed = true;
        break;
      }
      i = end;
      continue;
    }

    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) {
        errors.push({ kind: 'unterminated-pi', message: 'Unterminated XML processing instruction', start: lt, end: Math.min(n, lt + 2) });
        swallowed = true;
        break;
      }
      i = end + 2;
      continue;
    }

    // Closing tag </name>
    if (text.startsWith('</', lt)) {
      let nameEnd = lt + 2;
      while (nameEnd < n && NAME_CHAR.test(text[nameEnd])) nameEnd++;
      let gt = nameEnd;
      while (gt < n && SPACE.test(text[gt])) gt++;
      const closeName = text.slice(lt + 2, nameEnd);
      if (text[gt] !== '>') {
        errors.push({ kind: 'unterminated-close-tag', message: `Unterminated closing tag '</${closeName}'`, start: lt, end: Math.max(nameEnd, lt + 2) });
        // Recover: treat the name as closed, continue at the next character.
        gt = nameEnd - 1;
      }
      const tagEnd = gt + 1;
      while (stack.length > 0 && recovered.has(stack[stack.length - 1]) && stack[stack.length - 1].tagName !== closeName) {
        stack.pop()!.end = lt;
      }
      const top = stack[stack.length - 1];
      if (!top) {
        errors.push({ kind: 'unexpected-close', message: `Unexpected closing tag '</${closeName}>'`, start: lt, end: tagEnd });
      } else if (top.tagName !== closeName) {
        errors.push({
          kind: 'mismatched-close',
          message: `Mismatched closing tag '</${closeName}>' (expected '</${top.tagName}>')`,
          start: lt,
          end: tagEnd,
        });
        // Close the matching ancestor, if any, so the rest of the tree stays aligned.
        let matchIdx = -1;
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tagName === closeName) {
            matchIdx = k;
            break;
          }
        }
        if (matchIdx >= 0) {
          while (stack.length > matchIdx) stack.pop()!.end = tagEnd;
        }
      } else {
        stack.pop();
        top.end = tagEnd;
      }
      i = Math.max(tagEnd, lt + 2);
      continue;
    }

    // Opening or empty tag. `<` is never valid inside a tag or an attribute value (XML 1.0 AttValue), so a `<`
    // ends an unterminated tag or value there and parsing resumes at it.
    let nameEnd = lt + 1;
    while (nameEnd < n && !SPACE.test(text[nameEnd]) && text[nameEnd] !== '>' && text[nameEnd] !== '/' && text[nameEnd] !== '<') {
      nameEnd++;
    }
    const tagName = text.slice(lt + 1, nameEnd);
    let cursor = nameEnd;
    let quote: string | null = null;
    let quoteStart = -1;
    let gt = -1;
    let stop = -1;
    while (cursor < n) {
      const c = text[cursor];
      if (quote !== null) {
        if (c === quote) quote = null;
        else if (c === '<') {
          stop = cursor;
          break;
        }
      } else if (c === '"' || c === '\'') {
        quote = c;
        quoteStart = cursor;
      } else if (c === '>') {
        gt = cursor;
        break;
      } else if (c === '<') {
        stop = cursor;
        break;
      }
      cursor++;
    }

    if (gt === -1) {
      const limit = stop === -1 ? n : stop;
      if (quote !== null) {
        errors.push({
          kind: 'unterminated-value',
          message: `Unterminated attribute value in '<${tagName}>'`,
          start: quoteStart,
          end: Math.max(quoteStart + 1, lineEndFrom(text, quoteStart, limit)),
        });
      } else {
        errors.push({ kind: 'unterminated-tag', message: `Unterminated opening tag '<${tagName}'`, start: lt, end: Math.max(nameEnd, lt + 1) });
      }
      let attrEnd = limit;
      while (attrEnd > nameEnd && SPACE.test(text[attrEnd - 1])) attrEnd--;
      const { attrs } = parseAttributes(text, nameEnd, quote !== null ? quoteStart : attrEnd);
      recovered.add(addNode(tagName, lt, attrEnd, false, attrs));
      if (stop === -1) {
        swallowed = true;
        break;
      }
      i = stop;
      continue;
    }

    const selfClosing = text[gt - 1] === '/' && gt - 1 >= nameEnd;
    const innerEnd = selfClosing ? gt - 1 : gt;
    const { attrs, error } = parseAttributes(text, nameEnd, innerEnd);
    if (error) errors.push({ kind: 'attribute', ...error });
    addNode(tagName, lt, gt + 1, selfClosing, attrs);
    i = gt + 1;
  }

  for (const unclosed of swallowed ? [] : stack) {
    if (recovered.has(unclosed)) continue;
    errors.push({
      kind: 'unclosed-element',
      message: `Unclosed XML element '<${unclosed.tagName}>'`,
      start: unclosed.start,
      end: unclosed.openTagEnd,
    });
  }

  return { roots, errors };
}
