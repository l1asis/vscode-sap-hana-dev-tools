'use strict';

/**
 * Generates:
 *   1. resources/xsjs.d.ts        (TypeScript / JavaScript language service type declarations for XSJS `$`)
 *   2. src/xsjs/xsjs-catalog.ts   (Pure-TS runtime metadata catalog for zero-config VS Code IntelliSense)
 *
 * Source of truth: docs/specs/catalogs/xsjs-api.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'docs', 'specs', 'catalogs', 'xsjs-api.json');
const DTS_OUT_PATH = path.join(ROOT, 'resources', 'xsjs.d.ts');
const TS_OUT_PATH = path.join(ROOT, 'src', 'xsjs', 'xsjs-catalog.ts');

const RESERVED_IDENTIFIERS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
  'static', 'yield', 'any', 'boolean', 'number', 'string', 'symbol', 'type',
  'arguments', 'eval',
]);

function safeParamName(rawName, index) {
  let name = String(rawName || `arg${index}`).trim();
  const isRest = name.startsWith('...');
  if (isRest) name = name.slice(3).trim();
  name = name.replace(/[^a-zA-Z0-9_$]/g, '_');
  if (!name || /^\d/.test(name)) name = `arg_${name || index}`;
  if (RESERVED_IDENTIFIERS.has(name)) name = `${name}_`;
  return { name, isRest };
}

function safePropKey(name) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function cleanDocText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\*\//g, '*\\/')
    .trim();
}

function formatJsDoc(indent, description, options = {}) {
  const lines = [];
  const cleanDesc = cleanDocText(description);
  if (cleanDesc) lines.push(cleanDesc);
  if (options.deprecated) {
    lines.push(`@deprecated ${cleanDocText(options.deprecated)}`);
  }
  if (Array.isArray(options.params)) {
    for (const p of options.params) {
      const pDesc = cleanDocText(p.description);
      if (pDesc) lines.push(`@param ${p.safeName} ${pDesc}`);
    }
  }
  if (options.returnsDesc) {
    lines.push(`@returns ${cleanDocText(options.returnsDesc)}`);
  }
  if (lines.length === 0) return '';
  if (lines.length === 1 && !lines[0].startsWith('@')) {
    return `${indent}/** ${lines[0]} */\n`;
  }
  return (
    `${indent}/**\n` +
    lines.map((l) => `${indent} * ${l}`).join('\n') +
    `\n${indent} */\n`
  );
}

function sanitizeType(rawType) {
  let t = String(rawType || 'any').trim();
  if (!t) return 'any';
  if (t.toLowerCase() === 'integer' || t.toLowerCase() === 'float' || t.toLowerCase() === 'double') {
    return 'number';
  }
  if (t.toLowerCase() === 'array') return 'any[]';
  if (t.toLowerCase() === 'object') return 'Record<string, any>';
  if (t.toLowerCase() === 'function') return '(...args: any[]) => any';
  if (t === 'undefined') return 'undefined';
  // Guard unbalanced quotes/parens or JSDoc function syntax
  t = t.replace(/\bObject\b/g, 'Record<string, any>');
  t = t.replace(/\bArray\.<([^>]+)>/g, 'Array<$1>');
  t = t.replace(/\bArray\b(?!<)/g, 'any[]');
  return t;
}

function buildObjectFromProps(props) {
  if (!Array.isArray(props) || props.length === 0) return 'Record<string, any>';
  const fields = [];
  for (const prop of props) {
    const k = safePropKey(prop.name);
    const opt = prop.optional ? '?' : '';
    let pt;
    if (Array.isArray(prop.properties) && prop.properties.length > 0) {
      pt = buildObjectFromProps(prop.properties);
    } else if (Array.isArray(prop.types) && prop.types.length > 0) {
      pt = prop.types.map(sanitizeType).join(' | ');
    } else {
      pt = 'any';
    }
    fields.push(`${k}${opt}: ${pt}`);
  }
  return `{ ${fields.join('; ')}; [key: string]: any }`;
}

function formatTypeList(types, fallback = 'any') {
  if (!Array.isArray(types) || types.length === 0) return fallback;
  const uniq = [...new Set(types.map(sanitizeType).filter(Boolean))];
  if (uniq.length === 0) return fallback;
  // Deduplicate redundant types when Record<string, any> is paired with explicit shape
  return uniq.length === 1 ? uniq[0] : uniq.join(' | ');
}

function formatParams(params) {
  if (!Array.isArray(params) || params.length === 0) {
    return { sig: '', docParams: [] };
  }
  // If a property is nested with dots (e.g., foo.bar), avoid duplicate parameter declarations
  const flatParams = params.filter((p) => !String(p.name || '').includes('.'));
  let seenOptional = false;
  const sigParts = [];
  const docParams = [];
  const usedNames = new Set();

  for (let i = 0; i < flatParams.length; i++) {
    const p = flatParams[i];
    const parsed = safeParamName(p.name, i);
    let safeName = parsed.name;
    let suffix = 2;
    while (usedNames.has(safeName)) {
      safeName = `${parsed.name}${suffix++}`;
    }
    usedNames.add(safeName);

    let typeStr;
    if (Array.isArray(p.properties) && p.properties.length > 0) {
      typeStr = buildObjectFromProps(p.properties);
    } else {
      typeStr = formatTypeList(p.types, 'any');
    }

    if (parsed.isRest) {
      const restType = typeStr.endsWith('[]') ? typeStr : `${typeStr.includes('|') || typeStr.includes('=>') ? `(${typeStr})` : typeStr}[]`;
      sigParts.push(`...${safeName}: ${restType}`);
    } else {
      const isOpt = Boolean(p.optional) || seenOptional;
      if (isOpt) seenOptional = true;
      sigParts.push(`${safeName}${isOpt ? '?' : ''}: ${typeStr}`);
    }

    if (p.description) {
      docParams.push({ safeName, description: p.description });
    }
  }

  return { sig: sigParts.join(', '), docParams };
}

function buildNamespaceTree(entries) {
  const root = {
    fullName: '$',
    entry: entries['$'] || null,
    children: new Map(),
  };

  for (const key of Object.keys(entries).sort()) {
    if (key === '$') continue;
    const entry = entries[key];
    const parts = key.replace(/^\$\.?/, '').split('.').filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!cur.children.has(part)) {
        cur.children.set(part, {
          fullName: parts.slice(0, i + 1).reduce((acc, s) => `${acc}.${s}`, '$'),
          entry: null,
          children: new Map(),
        });
      }
      cur = cur.children.get(part);
    }
    cur.entry = entry;
  }

  return root;
}

function emitMemberProperty(indent, m, isNamespaceScope, pendingAliases) {
  const doc = formatJsDoc(indent, m.description, { deprecated: m.deprecated });
  const ro = m.readonly ? 'readonly ' : '';
  let typeStr;
  if (Array.isArray(m.constants) && m.constants.length > 0) {
    const fields = m.constants.map(
      (c) => `readonly ${safePropKey(c.name)}: ${sanitizeType(c.jsType || typeof c.value)}`
    );
    typeStr = `{ ${fields.join('; ')} }`;
  } else if (Array.isArray(m.properties) && m.properties.length > 0) {
    typeStr = buildObjectFromProps(m.properties);
  } else {
    typeStr = formatTypeList(m.types, 'any');
  }

  if (isNamespaceScope) {
    if (RESERVED_IDENTIFIERS.has(m.name)) {
      const internal = `_${m.name}`;
      pendingAliases.push(`${indent}export { ${internal} as ${m.name} };`);
      return `${doc}${indent}const ${internal}: ${typeStr};\n`;
    }
    let decl = `${doc}${indent}export const ${m.name}: ${typeStr};\n`;
    if ((Array.isArray(m.constants) && m.constants.length > 0) || m.name === 'types') {
      decl += `${indent}export type ${m.name} = number;\n`;
    }
    return decl;
  }

  const staticKw = m.static ? 'static ' : '';
  return `${doc}${indent}${staticKw}${ro}${safePropKey(m.name)}: ${typeStr};\n`;
}

function emitMethod(indent, m, isNamespaceScope, pendingAliases) {
  const { sig, docParams } = formatParams(m.params);
  const retType = m.returns && Array.isArray(m.returns.types) && m.returns.types.length > 0
    ? formatTypeList(m.returns.types, 'void')
    : 'void';
  const doc = formatJsDoc(indent, m.description, {
    deprecated: m.deprecated,
    params: docParams,
    returnsDesc: m.returns ? m.returns.description : undefined,
  });

  if (isNamespaceScope) {
    if (RESERVED_IDENTIFIERS.has(m.name)) {
      const internal = `_${m.name}`;
      if (!pendingAliases.some((a) => a.includes(` as ${m.name} }`))) {
        pendingAliases.push(`${indent}export { ${internal} as ${m.name} };`);
      }
      return `${doc}${indent}function ${internal}(${sig}): ${retType};\n`;
    }
    return `${doc}${indent}export function ${m.name}(${sig}): ${retType};\n`;
  }

  const staticKw = m.static ? 'static ' : '';
  return `${doc}${indent}${staticKw}${safePropKey(m.name)}(${sig}): ${retType};\n`;
}

function emitTypedefs(indent, entry) {
  if (!Array.isArray(entry.typedefs) || entry.typedefs.length === 0) return '';
  let out = '';
  for (const td of entry.typedefs) {
    const doc = formatJsDoc(indent, td.description);
    if (Array.isArray(td.properties) && td.properties.length > 0) {
      out += `${doc}${indent}export interface ${td.name} {\n`;
      for (const prop of td.properties) {
        const pDoc = formatJsDoc(`${indent}  `, prop.description);
        const opt = prop.optional ? '?' : '';
        const pType = Array.isArray(prop.properties) && prop.properties.length > 0
          ? buildObjectFromProps(prop.properties)
          : formatTypeList(prop.types, 'any');
        out += `${pDoc}${indent}  ${safePropKey(prop.name)}${opt}: ${pType};\n`;
      }
      out += `${indent}}\n`;
    } else {
      const t = formatTypeList(td.types, 'Record<string, any>');
      out += `${doc}${indent}export type ${td.name} = ${t};\n`;
    }
  }
  return out;
}

function emitMergedConstants(indent, m) {
  let out = '';
  if (Array.isArray(m.constants) && m.constants.length > 0) {
    for (const c of m.constants) {
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(c.name)) continue;
      out += formatJsDoc(indent, c.description);
      out += `${indent}export const ${c.name}: ${sanitizeType(c.jsType || typeof c.value)};\n`;
    }
  } else if (Array.isArray(m.properties) && m.properties.length > 0) {
    for (const p of m.properties) {
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p.name)) continue;
      out += formatJsDoc(indent, p.description);
      out += `${indent}export const ${p.name}: ${formatTypeList(p.types, 'any')};\n`;
    }
  }
  return out;
}

function emitNode(name, node, indent, mergedMember) {
  let out = '';
  const entry = node.entry;
  const childNames = [...node.children.keys()].sort();
  const hasChildren = childNames.length > 0;
  const pendingAliases = [];
  const mergedChildMembers = new Map();

  if (entry && entry.kind === 'class') {
    const doc = formatJsDoc(indent, entry.description);
    const ext =
      Array.isArray(entry.extends) && entry.extends.length > 0
        ? ` extends ${entry.extends.join(', ')}`
        : '';
    out += `${doc}${indent}export class ${name}${ext} {\n`;
    const bodyIndent = `${indent}  `;

    if (Array.isArray(entry.indexSignatures)) {
      for (const idx of entry.indexSignatures) {
        out += `${bodyIndent}[${idx.keyName || 'key'}: ${idx.keyType}]: ${idx.valueType};\n`;
      }
    }
    if (Array.isArray(entry.constructors)) {
      for (const ctor of entry.constructors) {
        const { sig, docParams } = formatParams(ctor.params);
        const cDoc = formatJsDoc(bodyIndent, ctor.description, { params: docParams });
        out += `${cDoc}${bodyIndent}constructor(${sig});\n`;
      }
    }
    if (Array.isArray(entry.members)) {
      for (const m of entry.members) {
        out += emitMemberProperty(bodyIndent, m, false, pendingAliases);
      }
    }
    if (Array.isArray(entry.methods)) {
      for (const m of entry.methods) {
        out += emitMethod(bodyIndent, m, false, pendingAliases);
      }
    }
    if (entry.iterable) {
      out += `${bodyIndent}[Symbol.iterator](): IterableIterator<${sanitizeType(entry.iterable)}>;\n`;
    }
    out += `${indent}}\n`;

    const hasTypedefs = Array.isArray(entry.typedefs) && entry.typedefs.length > 0;
    if (hasChildren || hasTypedefs) {
      out += `${indent}export namespace ${name} {\n`;
      out += emitTypedefs(`${indent}  `, entry);
      for (const childName of childNames) {
        out += emitNode(childName, node.children.get(childName), `${indent}  `);
      }
      out += `${indent}}\n`;
    }
    return out;
  }

  // Namespace (or intermediate container node)
  const doc = entry ? formatJsDoc(indent, entry.description) : '';
  const nsKeyword = indent === '' ? 'declare namespace' : 'export namespace';
  out += `${doc}${indent}${nsKeyword} ${name} {\n`;
  const bodyIndent = `${indent}  `;

  if (mergedMember) {
    out += emitMergedConstants(bodyIndent, mergedMember);
  }

  if (entry) {
    out += emitTypedefs(bodyIndent, entry);
    if (Array.isArray(entry.members)) {
      for (const m of entry.members) {
        if (node.children.has(m.name)) {
          mergedChildMembers.set(m.name, m);
          out += `${bodyIndent}export type ${m.name} = number;\n`;
          continue;
        }
        out += emitMemberProperty(bodyIndent, m, true, pendingAliases);
      }
    }
    if (Array.isArray(entry.methods)) {
      for (const m of entry.methods) {
        out += emitMethod(bodyIndent, m, true, pendingAliases);
      }
    }
    for (const aliasLine of pendingAliases) {
      out += `${aliasLine}\n`;
    }
  }

  for (const childName of childNames) {
    out += emitNode(childName, node.children.get(childName), bodyIndent, mergedChildMembers.get(childName));
  }
  out += `${indent}}\n`;
  return out;
}

function buildDts(catalog) {
  let dts = '';
  dts += '// Generated by scripts/build-xsjs-dts.js from docs/specs/catalogs/xsjs-api.json\n';
  dts += `// Source: ${catalog.source}\n`;
  dts += '// Do not hand-edit; run: npm run build:xsjs-dts\n\n';

  if (catalog.auxTypes && catalog.auxTypes['ctypes.Int64']) {
    const int64 = catalog.auxTypes['ctypes.Int64'];
    dts += `declare namespace ctypes {\n`;
    dts += `  /** ${cleanDocText(int64.description)} */\n`;
    dts += `  export ${int64.definition}\n`;
    dts += `}\n\n`;
  }

  const tree = buildNamespaceTree(catalog.entries);
  dts += emitNode('$', tree, '');
  return dts;
}

function compactMember(m) {
  const types = Array.isArray(m.types) && m.types.length > 0 ? m.types : ['any'];
  return {
    name: m.name,
    type: types.map(sanitizeType).join(' | '),
    description: cleanDocText(m.description || ''),
    ...(m.readonly ? { readonly: true } : {}),
    ...(m.static ? { static: true } : {}),
    ...(m.deprecated ? { deprecated: cleanDocText(m.deprecated) } : {}),
  };
}

function compactMethod(m) {
  const params = (Array.isArray(m.params) ? m.params : [])
    .filter((p) => !String(p.name || '').includes('.'))
    .map((p, idx) => {
      const parsed = safeParamName(p.name, idx);
      const types = Array.isArray(p.types) && p.types.length > 0 ? p.types.map(sanitizeType).join(' | ') : 'any';
      return {
        name: parsed.isRest ? `...${parsed.name}` : parsed.name,
        type: types,
        ...(p.optional ? { optional: true } : {}),
        description: cleanDocText(p.description || ''),
      };
    });
  const retTypes = m.returns && Array.isArray(m.returns.types) && m.returns.types.length > 0
    ? m.returns.types.map(sanitizeType).join(' | ')
    : 'void';
  return {
    name: m.name,
    params,
    returnType: retTypes,
    description: cleanDocText(m.description || ''),
    ...(m.static ? { static: true } : {}),
    ...(m.deprecated ? { deprecated: cleanDocText(m.deprecated) } : {}),
  };
}

function buildTsCatalogModule(catalog) {
  const tree = buildNamespaceTree(catalog.entries);
  const compact = {};

  function collectChildren(node) {
    const out = [];
    for (const [childName, childNode] of [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push({
        name: childName,
        fullName: childNode.fullName,
        kind: childNode.entry ? childNode.entry.kind : 'namespace',
        description: cleanDocText(childNode.entry ? childNode.entry.description : ''),
      });
    }
    return out;
  }

  function extractConstantMembers(m) {
    if (Array.isArray(m.constants) && m.constants.length > 0) {
      return m.constants.map((c) => ({
        name: c.name,
        type: sanitizeType(c.jsType || typeof c.value),
        description: `Constant value: ${c.value}`,
        static: true,
        readonly: true,
      }));
    }
    if (Array.isArray(m.properties) && m.properties.length > 0) {
      return m.properties.map((p) => ({
        name: p.name,
        type: Array.isArray(p.types) ? p.types.map(sanitizeType).join(' | ') : 'number',
        description: p.default !== undefined ? `Default value: ${p.default}` : '',
        static: true,
        readonly: true,
      }));
    }
    return [];
  }

  function visit(node, mergedMember) {
    const e = node.entry;
    const children = collectChildren(node);
    const members = mergedMember ? extractConstantMembers(mergedMember) : [];
    const mergedChildMembers = new Map();

    if (e && Array.isArray(e.members)) {
      for (const m of e.members) {
        if (node.children.has(m.name)) {
          mergedChildMembers.set(m.name, m);
          continue;
        }
        const constMembers = extractConstantMembers(m);
        if (constMembers.length > 0) {
          members.push({
            name: m.name,
            type: `${node.fullName}.${m.name}`,
            description: cleanDocText(m.description || ''),
            static: Boolean(m.static),
            readonly: true,
          });
          compact[`${node.fullName}.${m.name}`] = {
            fullName: `${node.fullName}.${m.name}`,
            kind: 'namespace',
            description: cleanDocText(m.description || ''),
            children: [],
            members: constMembers,
            methods: [],
            constructors: [],
          };
        } else {
          members.push(compactMember(m));
        }
      }
    }

    compact[node.fullName] = {
      fullName: node.fullName,
      kind: e ? e.kind : 'namespace',
      description: cleanDocText(e ? e.description : ''),
      ...(e && Array.isArray(e.extends) && e.extends.length > 0 ? { extends: e.extends } : {}),
      children,
      members,
      methods: e && Array.isArray(e.methods) ? e.methods.map(compactMethod) : [],
      constructors: e && Array.isArray(e.constructors)
        ? e.constructors.map((c) => compactMethod({ name: node.fullName.split('.').pop(), ...c, returns: { types: [node.fullName] } }))
        : [],
    };

    for (const [childName, child] of node.children.entries()) {
      visit(child, mergedChildMembers.get(childName));
    }
  }

  visit(tree, null);

  const header =
    '// Generated by scripts/build-xsjs-dts.js from docs/specs/catalogs/xsjs-api.json\n' +
    '// Do not hand-edit; run: npm run build:xsjs-dts\n\n' +
    'export interface XsjsParamDoc {\n' +
    '  readonly name: string;\n' +
    '  readonly type: string;\n' +
    '  readonly optional?: boolean;\n' +
    '  readonly description: string;\n' +
    '}\n\n' +
    'export interface XsjsMemberDoc {\n' +
    '  readonly name: string;\n' +
    '  readonly type: string;\n' +
    '  readonly description: string;\n' +
    '  readonly readonly?: boolean;\n' +
    '  readonly static?: boolean;\n' +
    '  readonly deprecated?: string;\n' +
    '}\n\n' +
    'export interface XsjsMethodDoc {\n' +
    '  readonly name: string;\n' +
    '  readonly params: readonly XsjsParamDoc[];\n' +
    '  readonly returnType: string;\n' +
    '  readonly description: string;\n' +
    '  readonly static?: boolean;\n' +
    '  readonly deprecated?: string;\n' +
    '}\n\n' +
    'export interface XsjsChildRef {\n' +
    '  readonly name: string;\n' +
    '  readonly fullName: string;\n' +
    '  readonly kind: string;\n' +
    '  readonly description: string;\n' +
    '}\n\n' +
    'export interface XsjsSymbolEntry {\n' +
    '  readonly fullName: string;\n' +
    '  readonly kind: string;\n' +
    '  readonly description: string;\n' +
    '  readonly extends?: readonly string[];\n' +
    '  readonly children: readonly XsjsChildRef[];\n' +
    '  readonly members: readonly XsjsMemberDoc[];\n' +
    '  readonly methods: readonly XsjsMethodDoc[];\n' +
    '  readonly constructors: readonly XsjsMethodDoc[];\n' +
    '}\n\n';

  return `${header}export const XSJS_CATALOG: Readonly<Record<string, XsjsSymbolEntry>> = ${JSON.stringify(compact, null, 2)};\n`;
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  fs.mkdirSync(path.dirname(DTS_OUT_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(TS_OUT_PATH), { recursive: true });

  const dts = buildDts(catalog);
  const tsMod = buildTsCatalogModule(catalog);

  fs.writeFileSync(DTS_OUT_PATH, dts, 'utf8');
  fs.writeFileSync(TS_OUT_PATH, tsMod, 'utf8');

  console.log(`Generated ${path.relative(ROOT, DTS_OUT_PATH)} (${Buffer.byteLength(dts, 'utf8')} bytes)`);
  console.log(`Generated ${path.relative(ROOT, TS_OUT_PATH)} (${Buffer.byteLength(tsMod, 'utf8')} bytes)`);
}

if (require.main === module) {
  main();
}

module.exports = { buildDts, buildTsCatalogModule };
