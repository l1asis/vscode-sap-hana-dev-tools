import { cdsTokenize, type CdsToken } from '../formatter/cds';
import {
  parseClassicKv,
  type KvAssignmentNode,
  type KvStructValue,
  type KvValueNode,
} from '../formatter/classic-kv';
import { isKeyValueArtifact } from '../formatter/detect';
import { isClassicHdbrole, roleTokenize, type RoleToken } from '../formatter/hdbrole';
import { tokenize, type Token } from '../formatter/tokenizer';
import {
  applyTextEdits,
  filterSuppressedDiagnostics,
  type AnalyzerContext,
  type AnalyzerDiagnostic,
  type CodeFixSuggestion,
  type TextEditSpan,
} from './types';

function unquoteKvString(raw: string): string {
  if (raw.length < 2) return raw;
  const inner = raw.slice(1, -1);
  return inner
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, '\'')
    .replace(/\\\\/g, '\\');
}

function escapeKvString(val: string): string {
  return `"${val
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`;
}

function escapeSqlSingleQuote(val: string): string {
  return `'${val.replace(/'/g, '\'\'')}'`;
}

export function deriveObjectName(filePath?: string, fallback = 'OBJECT_NAME'): string {
  if (!filePath) return fallback;
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() ?? '';
  const baseName = fileName.replace(/\.[^.]+$/, '') || fallback;
  // Derive pkg prefix if inside /src/ or standard package folder, otherwise use baseName cleanly
  const srcMatch = /\/src\/(.+)\/[^/]+$/i.exec(normalized);
  if (srcMatch && srcMatch[1]) {
    const pkg = srcMatch[1].replace(/\//g, '.');
    return `${pkg}::${baseName}`;
  }
  return baseName;
}

function getAssignmentsMap(text: string): Map<string, KvAssignmentNode> {
  const ast = parseClassicKv(text);
  const map = new Map<string, KvAssignmentNode>();
  for (const item of ast.items) {
    if (item.kind === 'assignment') {
      map.set(item.keyPath.join('.').toLowerCase(), item);
    }
  }
  return map;
}

function readKvScalarString(val: KvValueNode | undefined): string | null {
  if (!val) return null;
  if (val.kind === 'string') return unquoteKvString(val.raw);
  if (val.kind === 'ident') return val.text;
  if (val.kind === 'number') return val.raw;
  if (val.kind === 'rawExpr') return val.text;
  return null;
}

function readKvBool(val: KvValueNode | undefined): boolean | null {
  const s = readKvScalarString(val);
  if (!s) return null;
  if (s.toLowerCase() === 'true') return true;
  if (s.toLowerCase() === 'false') return false;
  return null;
}

function readKvStringArray(val: KvValueNode | undefined): string[] {
  if (!val || val.kind !== 'array') return [];
  const out: string[] = [];
  for (const item of val.items) {
    const s = readKvScalarString(item.value);
    if (s !== null) out.push(s);
  }
  return out;
}

function getStructFieldsMap(st: KvStructValue): Map<string, KvValueNode> {
  const fields = new Map<string, KvValueNode>();
  for (const m of st.members) {
    if (m.kind === 'field') {
      fields.set(m.keyPath.join('.').toLowerCase(), m.value);
    }
  }
  return fields;
}

const SQL_UNQUOTED_DEFAULTS = new Set([
  'CURRENT_TIMESTAMP',
  'CURRENT_UTCTIMESTAMP',
  'CURRENT_DATE',
  'CURRENT_UTCDATE',
  'CURRENT_TIME',
  'CURRENT_UTCTIME',
  'CURRENT_USER',
  'SESSION_USER',
  'NULL',
  'TRUE',
  'FALSE',
]);

function renderKvDefaultValue(defNode: KvValueNode, sqlType: string): string {
  if (defNode.kind === 'number') return defNode.raw;
  if (defNode.kind === 'ident') return defNode.text;
  if (defNode.kind === 'string') {
    const inner = unquoteKvString(defNode.raw);
    if (SQL_UNQUOTED_DEFAULTS.has(inner.toUpperCase())) return inner.toUpperCase();
    if (/^-?\d+(?:\.\d+)?$/.test(inner) && /^(?:INT|INTEGER|BIGINT|SMALLINT|TINYINT|DECIMAL|DOUBLE|REAL)/i.test(sqlType)) {
      return inner;
    }
    return escapeSqlSingleQuote(inner);
  }
  return readKvScalarString(defNode) ?? 'NULL';
}

function renderHdiColumnDefinitions(columnsNode: KvValueNode | undefined): string[] {
  if (!columnsNode || columnsNode.kind !== 'array') return [];
  const lines: string[] = [];
  for (const item of columnsNode.items) {
    if (item.value.kind !== 'struct') continue;
    const f = getStructFieldsMap(item.value);
    const colName = readKvScalarString(f.get('name'));
    const sqlTypeRaw = readKvScalarString(f.get('sqltype')) ?? 'NVARCHAR';
    if (!colName) continue;

    const sqlType = sqlTypeRaw.toUpperCase();
    const len = readKvScalarString(f.get('length'));
    const prec = readKvScalarString(f.get('precision'));
    const scale = readKvScalarString(f.get('scale'));

    let typeExpr = sqlType;
    if (prec) {
      typeExpr = scale ? `${sqlType}(${prec}, ${scale})` : `${sqlType}(${prec})`;
    } else if (len) {
      typeExpr = `${sqlType}(${len})`;
    }

    const parts: string[] = [`"${colName}"`, typeExpr];
    const defVal = f.get('defaultvalue');
    if (defVal) {
      parts.push(`DEFAULT ${renderKvDefaultValue(defVal, sqlType)}`);
    }
    const nullable = readKvBool(f.get('nullable'));
    if (nullable === false) {
      parts.push('NOT NULL');
    }
    const comment = readKvScalarString(f.get('comment'));
    if (comment) {
      parts.push(`COMMENT ${escapeSqlSingleQuote(comment)}`);
    }
    lines.push(parts.join(' '));
  }
  return lines;
}

/**
 * Converts XSC Classic KV `.hdbtable` (`table.columns = [...]`) to HDI DDL `.hdbtable`.
 */
export function convertHdbtableKvToHdi(text: string, objectName = 'MY_TABLE'): string {
  const assigns = getAssignmentsMap(text);
  const tableTypeRaw = (readKvScalarString(assigns.get('table.tabletype')?.value) ?? 'COLUMNSTORE').toUpperCase();
  const temporary = readKvBool(assigns.get('table.temporary')?.value) === true;
  const description = readKvScalarString(assigns.get('table.description')?.value);
  const loggingType = (readKvScalarString(assigns.get('table.loggingtype')?.value) ?? '').toUpperCase();

  const colLines = renderHdiColumnDefinitions(assigns.get('table.columns')?.value);
  const pkCols = readKvStringArray(assigns.get('table.primarykey.pkcolumns')?.value);
  if (pkCols.length > 0) {
    colLines.push(`PRIMARY KEY (${pkCols.map((c) => `"${c}"`).join(', ')})`);
  }

  const kindPrefix = `${temporary ? 'GLOBAL TEMPORARY ' : ''}${tableTypeRaw === 'ROWSTORE' ? 'ROW TABLE' : 'COLUMN TABLE'}`;
  const body = colLines.length > 0 ? `\n  ${colLines.join(',\n  ')}\n` : '';
  const suffixes: string[] = [];
  if (description) suffixes.push(`COMMENT ${escapeSqlSingleQuote(description)}`);
  if (loggingType === 'NOLOGGING') suffixes.push('NO LOGGING');
  const tail = suffixes.length > 0 ? ` ${suffixes.join(' ')}` : '';

  let out = `${kindPrefix} "${objectName}" (${body})${tail}`;

  const indexesNode = assigns.get('table.indexes')?.value;
  if (indexesNode && indexesNode.kind === 'array' && indexesNode.items.length > 0) {
    const todoLines: string[] = [];
    for (const item of indexesNode.items) {
      if (item.value.kind !== 'struct') continue;
      const idxFields = getStructFieldsMap(item.value);
      const idxName = readKvScalarString(idxFields.get('name')) ?? 'IDX';
      const unique = readKvBool(idxFields.get('unique')) === true ? 'UNIQUE ' : '';
      const idxType = readKvScalarString(idxFields.get('indextype'))?.toUpperCase();
      const typePart = idxType ? `${idxType} ` : '';
      const cols = readKvStringArray(idxFields.get('indexcolumns'));
      const colSql = cols.map((c) => `"${c}"`).join(', ');
      todoLines.push(`-- TODO(.hdbindex): ${unique}${typePart}INDEX "${idxName}" ON "${objectName}" (${colSql})`);
    }
    if (todoLines.length > 0) {
      out += `\n\n${todoLines.join('\n')}`;
    }
  }

  return `${out}\n`;
}

/**
 * Reverse-converts HDI DDL `.hdbtable` (`COLUMN TABLE ...`) into XSC Classic KV `.hdbtable`.
 */
export function convertHdbtableHdiToKv(text: string, targetSchema = 'MYSCHEMA'): string {
  const toks = tokenize(text).filter(
    (t) => t.type !== 'lineComment' && t.type !== 'blockComment' && t.type !== 'raw'
  );
  let temporary = false;
  let tableType: 'COLUMNSTORE' | 'ROWSTORE' = 'COLUMNSTORE';
  let i = 0;

  while (i < toks.length) {
    const w = toks[i].text.toUpperCase();
    if (w === 'CREATE') {
      i++;
      continue;
    }
    if (w === 'GLOBAL' && toks[i + 1]?.text.toUpperCase() === 'TEMPORARY') {
      temporary = true;
      i += 2;
      continue;
    }
    if (w === 'COLUMN' && toks[i + 1]?.text.toUpperCase() === 'TABLE') {
      tableType = 'COLUMNSTORE';
      i += 2;
      break;
    }
    if (w === 'ROW' && toks[i + 1]?.text.toUpperCase() === 'TABLE') {
      tableType = 'ROWSTORE';
      i += 2;
      break;
    }
    if (w === 'TABLE') {
      tableType = 'ROWSTORE';
      i += 1;
      break;
    }
    i++;
  }

  // Skip object name ("schema"."table" or "pkg::table") until '('
  let schemaName = targetSchema;
  while (i < toks.length && toks[i].text !== '(') {
    if (toks[i + 1]?.text === '.') {
      schemaName = toks[i].text.replace(/^"|"$/g, '') || schemaName;
    }
    i++;
  }
  if (toks[i]?.text !== '(') return text;

  // Match outer parens
  let depth = 0;
  const openIdx = i;
  let closeIdx = -1;
  for (let k = openIdx; k < toks.length; k++) {
    if (toks[k].text === '(') depth++;
    else if (toks[k].text === ')') {
      depth--;
      if (depth === 0) {
        closeIdx = k;
        break;
      }
    }
  }
  if (closeIdx === -1) return text;

  // Table-level options after closing paren
  let tableComment: string | null = null;
  let noLogging = false;
  for (let k = closeIdx + 1; k < toks.length; k++) {
    const w = toks[k].text.toUpperCase();
    if (w === 'COMMENT' && toks[k + 1]?.type === 'string') {
      tableComment = toks[k + 1].text.slice(1, -1).replace(/''/g, '\'');
      k++;
    } else if (w === 'NO' && toks[k + 1]?.text.toUpperCase() === 'LOGGING') {
      noLogging = true;
      k++;
    }
  }

  // Split column / constraint clauses at depth 0 commas
  const clauses: Token[][] = [];
  let cur: Token[] = [];
  let pDepth = 0;
  for (let k = openIdx + 1; k < closeIdx; k++) {
    const t = toks[k];
    if (t.text === '(') pDepth++;
    else if (t.text === ')') pDepth = Math.max(0, pDepth - 1);
    if (t.text === ',' && pDepth === 0) {
      if (cur.length > 0) clauses.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  if (cur.length > 0) clauses.push(cur);

  const colStructs: string[] = [];
  const pkCols: string[] = [];

  for (const clause of clauses) {
    const first = clause[0]?.text.toUpperCase() ?? '';
    const second = clause[1]?.text.toUpperCase() ?? '';
    if (first === 'PRIMARY' && second === 'KEY') {
      const lp = clause.findIndex((t) => t.text === '(');
      const rp = clause.findIndex((t, idx) => idx > lp && t.text === ')');
      if (lp !== -1 && rp > lp) {
        for (let k = lp + 1; k < rp; k++) {
          if (clause[k].text !== ',') {
            pkCols.push(escapeKvString(clause[k].text.replace(/^"|"$/g, '')));
          }
        }
      }
      continue;
    }
    if (first === 'CONSTRAINT' && clause.some((t) => t.text.toUpperCase() === 'PRIMARY')) {
      const pkIdx = clause.findIndex((t) => t.text.toUpperCase() === 'PRIMARY');
      const lp = clause.findIndex((t, idx) => idx > pkIdx && t.text === '(');
      const rp = clause.findIndex((t, idx) => idx > lp && t.text === ')');
      if (lp !== -1 && rp > lp) {
        for (let k = lp + 1; k < rp; k++) {
          if (clause[k].text !== ',') pkCols.push(escapeKvString(clause[k].text.replace(/^"|"$/g, '')));
        }
      }
      continue;
    }
    if (first === 'UNIQUE' || first === 'FOREIGN' || first === 'CHECK') continue;

    const colName = clause[0].text.replace(/^"|"$/g, '');
    const sqlType = clause[1]?.text.toUpperCase() ?? 'NVARCHAR';
    const fields: string[] = [`name = ${escapeKvString(colName)};`, `sqlType = ${sqlType};`];

    let pos = 2;
    if (clause[pos]?.text === '(') {
      const endP = clause.findIndex((t, idx) => idx > pos && t.text === ')');
      if (endP > pos + 1) {
        const inner = clause.slice(pos + 1, endP).filter((t) => t.text !== ',');
        if (inner.length === 1) {
          if (sqlType === 'DECIMAL' || sqlType === 'DEC' || sqlType === 'FLOAT') {
            fields.push(`precision = ${inner[0].text};`);
          } else {
            fields.push(`length = ${inner[0].text};`);
          }
        } else if (inner.length >= 2) {
          fields.push(`precision = ${inner[0].text};`);
          fields.push(`scale = ${inner[1].text};`);
        }
        pos = endP + 1;
      }
    }

    let nullable = true;
    while (pos < clause.length) {
      const kw = clause[pos].text.toUpperCase();
      if (kw === 'NOT' && clause[pos + 1]?.text.toUpperCase() === 'NULL') {
        nullable = false;
        pos += 2;
        continue;
      }
      if (kw === 'NULL') {
        nullable = true;
        pos++;
        continue;
      }
      if (kw === 'DEFAULT' && clause[pos + 1]) {
        const dv = clause[pos + 1];
        if (dv.type === 'string') {
          fields.push(`defaultValue = ${escapeKvString(dv.text.slice(1, -1).replace(/''/g, '\''))};`);
        } else {
          fields.push(`defaultValue = ${escapeKvString(dv.text)};`);
        }
        pos += 2;
        continue;
      }
      if (kw === 'COMMENT' && clause[pos + 1]?.type === 'string') {
        fields.push(`comment = ${escapeKvString(clause[pos + 1].text.slice(1, -1).replace(/''/g, '\''))};`);
        pos += 2;
        continue;
      }
      pos++;
    }
    fields.splice(2, 0, `nullable = ${nullable};`);
    colStructs.push(`  {${fields.join(' ')}}`);
  }

  const lines: string[] = [
    `table.schemaName = ${escapeKvString(schemaName)};`,
    `table.tableType = ${tableType};`,
  ];
  if (temporary) lines.push('table.temporary = true;');
  if (tableComment) lines.push(`table.description = ${escapeKvString(tableComment)};`);
  if (noLogging) lines.push('table.loggingType = NOLOGGING;');
  lines.push(`table.columns = [\n${colStructs.join(',\n')}\n];`);
  if (pkCols.length > 0) {
    lines.push(`table.primaryKey.pkcolumns = [${pkCols.join(', ')}];`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Rewrites `"_SYS_BIC"."pkg/OBJ"` to `"pkg::OBJ"` and strips the `"<schema>".` prefix matching the classic
 * `schema=` property, so container-local objects resolve in `[HDI]`.
 */
function stripClassicSchemaRefs(sql: string, schema: string | null): string {
  let out = sql.replace(/(?:"_SYS_BIC"|_SYS_BIC)\."([^"]+)"/gi, (_m, obj: string) => `"${obj.replace(/\//g, '::')}"`);
  if (schema) {
    const escapedSchema = schema.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`"${escapedSchema}"\\s*\\.\\s*`, 'g'), '');
    out = out.replace(new RegExp(`\\b${escapedSchema}\\s*\\.\\s*`, 'gi'), '');
  }
  return out;
}

/**
 * Converts XSC Classic KV `.hdbview` (`schema = ...; query = "...";`) to HDI DDL `.hdbview`.
 */
export function convertHdbviewKvToHdi(text: string, objectName = 'MY_VIEW'): string {
  const assigns = getAssignmentsMap(text);
  const schema = readKvScalarString(assigns.get('schema')?.value);
  const queryRaw = readKvScalarString(assigns.get('query')?.value) ?? '';
  let cleanQuery = queryRaw.trim().replace(/;+\s*$/, '');

  cleanQuery = stripClassicSchemaRefs(cleanQuery, schema);

  return `VIEW "${objectName}"\nAS ${cleanQuery}\n`;
}

/**
 * Reverse-converts HDI DDL `.hdbview` (`VIEW "..." AS ...`) into XSC Classic KV `.hdbview`.
 */
export function convertHdbviewHdiToKv(text: string, targetSchema = 'MYSCHEMA'): string {
  const toks = tokenize(text).filter(
    (t) => t.type !== 'lineComment' && t.type !== 'blockComment' && t.type !== 'raw'
  );
  const asIdx = toks.findIndex((t) => t.type === 'word' && t.text.toUpperCase() === 'AS');
  if (asIdx === -1 || asIdx + 1 >= toks.length) return text;

  const queryStart = toks[asIdx + 1].start;
  let queryBody = text.slice(queryStart).trim().replace(/;+\s*$/, '');
  const assocIdx = queryBody.search(/\bWITH\s+ASSOCIATIONS\b/i);
  let suffixNote = '';
  if (assocIdx !== -1) {
    queryBody = queryBody.slice(0, assocIdx).trim();
    suffixNote = '// Note: HDI WITH ASSOCIATIONS clause stripped (unsupported in XS Classic .hdbview)\n';
  }

  // Extract simple FROM / JOIN table identifiers for depends_on
  const deps = new Set<string>();
  const qToks = toks.slice(asIdx + 1);
  for (let i = 0; i + 1 < qToks.length; i++) {
    const uw = qToks[i].text.toUpperCase();
    if (uw === 'FROM' || uw === 'JOIN') {
      const next = qToks[i + 1];
      if (next && next.text !== '(') {
        const cleanName = next.text.replace(/^"|"$/g, '');
        if (cleanName) deps.add(escapeKvString(cleanName));
      }
    }
  }

  const lines: string[] = [
    `schema = ${escapeKvString(targetSchema)};`,
    `query = ${escapeKvString(queryBody)};`,
  ];
  if (deps.size > 0) {
    lines.push(`depends_on = [${[...deps].join(', ')}];`);
  }
  return `${suffixNote}${lines.join('\n')}\n`;
}

/**
 * Converts XSC Classic KV `.hdbsequence` to HDI DDL `.hdbsequence`.
 */
export function convertHdbsequenceKvToHdi(text: string, objectName = 'MY_SEQ'): string {
  const assigns = getAssignmentsMap(text);
  const clauses: string[] = [];

  const inc = readKvScalarString(assigns.get('increment_by')?.value);
  if (inc) clauses.push(`INCREMENT BY ${inc}`);

  const start = readKvScalarString(assigns.get('start_with')?.value);
  if (start) clauses.push(`START WITH ${start}`);

  const noMax = readKvBool(assigns.get('nomaxvalue')?.value);
  const maxVal = readKvScalarString(assigns.get('maxvalue')?.value);
  // `NO MAXVALUE` / `NO MINVALUE` are two words in HANA SQL `<sequence_parameter>` [HDI] [CLOUD].
  if (noMax === true) clauses.push('NO MAXVALUE');
  else if (maxVal) clauses.push(`MAXVALUE ${maxVal}`);

  const noMin = readKvBool(assigns.get('nominvalue')?.value);
  const minVal = readKvScalarString(assigns.get('minvalue')?.value);
  if (noMin === true) clauses.push('NO MINVALUE');
  else if (minVal) clauses.push(`MINVALUE ${minVal}`);

  const cycles = readKvBool(assigns.get('cycles')?.value);
  if (cycles === true) clauses.push('CYCLE');
  else if (cycles === false) clauses.push('NO CYCLE');

  const resetBy = readKvScalarString(assigns.get('reset_by')?.value);
  if (resetBy) {
    const schema = readKvScalarString(assigns.get('schema')?.value);
    clauses.push(`RESET BY ${stripClassicSchemaRefs(resetBy.trim().replace(/;+\s*$/, ''), schema)}`);
  }

  const body = clauses.length > 0 ? `\n  ${clauses.join('\n  ')}` : '';
  return `SEQUENCE "${objectName}"${body}\n`;
}

/**
 * Reverse-converts HDI DDL `.hdbsequence` into XSC Classic KV `.hdbsequence`.
 */
export function convertHdbsequenceHdiToKv(text: string, targetSchema = 'MYSCHEMA'): string {
  const toks = tokenize(text).filter(
    (t) => t.type !== 'lineComment' && t.type !== 'blockComment' && t.type !== 'raw'
  );
  const lines: string[] = [`schema = ${escapeKvString(targetSchema)};`];
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].text.toUpperCase();
    const next = toks[i + 1]?.text.toUpperCase();
    if (w === 'INCREMENT' && next === 'BY' && toks[i + 2]) {
      lines.push(`increment_by = ${toks[i + 2].text};`);
      i += 2;
    } else if (w === 'START' && next === 'WITH' && toks[i + 2]) {
      lines.push(`start_with = ${toks[i + 2].text};`);
      i += 2;
    } else if (w === 'MAXVALUE' && toks[i + 1]) {
      lines.push(`maxvalue = ${toks[i + 1].text};`);
      i++;
    } else if (w === 'NO' && next === 'MAXVALUE') {
      lines.push('nomaxvalue = true;');
      i++;
    } else if (w === 'NO' && next === 'MINVALUE') {
      lines.push('nominvalue = true;');
      i++;
    } else if (w === 'NOMAXVALUE' || w === 'NOMINVALUE') {
      // Legacy single-word form written by converter versions <= 0.10.1; not valid HANA SQL.
      lines.push(`${w.toLowerCase()} = true;`);
    } else if (w === 'MINVALUE' && toks[i + 1]) {
      lines.push(`minvalue = ${toks[i + 1].text};`);
      i++;
    } else if (w === 'NO' && next === 'CYCLE') {
      lines.push('cycles = false;');
      i++;
    } else if (w === 'CYCLE') {
      lines.push('cycles = true;');
    } else if (w === 'RESET' && next === 'BY' && toks[i + 2]) {
      const rest = text.slice(toks[i + 2].start).trim().replace(/;+\s*$/, '');
      lines.push(`reset_by = ${escapeKvString(rest)};`);
      break;
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Converts XSC Classic KV `.hdbstructure` (`table.columns = [...]`) to HDI `.hdbtabletype`.
 */
export function convertHdbstructureKvToTableType(text: string, objectName = 'MY_TT'): string {
  const assigns = getAssignmentsMap(text);
  const colLines = renderHdiColumnDefinitions(assigns.get('table.columns')?.value);
  const body = colLines.length > 0 ? `\n  ${colLines.join(',\n  ')}\n` : '';
  return `TYPE "${objectName}" AS TABLE (${body})\n`;
}

function inferObjectTypeFromClassicSubject(subject: string): string {
  const lower = subject.toLowerCase();
  if (lower.endsWith('.hdbview') || lower.endsWith('.view') || lower.endsWith('.calculationview')) return 'VIEW';
  if (lower.endsWith('.hdbprocedure') || lower.endsWith('.procedure')) return 'PROCEDURE';
  if (lower.endsWith('.hdbfunction') || lower.endsWith('.hdbtablefunction')) return 'FUNCTION';
  if (lower.endsWith('.hdbsequence')) return 'SEQUENCE';
  return 'TABLE';
}

function normalizeClassicObjectName(rawToks: readonly RoleToken[]): string {
  const joined = rawToks.map((t) => t.text.replace(/^"|"$/g, '')).join('');
  // Strip `.hdbtable` etc. suffix cleanly and keep package::Object form
  const strippedExt = joined.replace(/\.(?:hdbtable|hdbview|hdbprocedure|hdbfunction|hdbsequence|hdbschema|calculationview)$/i, '');
  const parts = strippedExt.split(':');
  if (parts.length === 2 && !strippedExt.includes('::')) {
    return `${parts[0]}::${parts[1].replace(/\..+$/, '')}`;
  }
  if (strippedExt.includes('::')) {
    const [pkg, objWithSub] = strippedExt.split('::');
    const obj = objWithSub.split('.')[0];
    return `${pkg}::${obj}`;
  }
  return strippedExt;
}

/**
 * Converts XSC Classic `.hdbrole` privilege DSL into HDI JSON `.hdbrole`.
 */
export function convertClassicHdbroleToHdiJson(text: string): string {
  const tokens = roleTokenize(text).filter(
    (t) => t.type !== 'lineComment' && t.type !== 'blockComment' && t.type !== 'raw'
  );

  const stmts: RoleToken[][] = [];
  let cur: RoleToken[] = [];
  for (const tok of tokens) {
    if (tok.type === 'semi' || tok.type === 'lbrace' || tok.type === 'rbrace') {
      if (cur.length > 0) {
        stmts.push(cur);
        cur = [];
      }
      continue;
    }
    cur.push(tok);
  }
  if (cur.length > 0) stmts.push(cur);

  let roleName = 'MY_ROLE';
  let needsGrantHash = false;
  const schemaRoles: string[] = [];
  const globalRoles: string[] = [];
  const systemPrivs: string[] = [];
  const schemaPrivs: Array<Record<string, unknown>> = [];
  const objectPrivs: Array<Record<string, unknown>> = [];
  const analyticPrivs: Array<Record<string, unknown>> = [];

  for (const stmt of stmts) {
    if (stmt.length === 0) continue;
    let colonIdx = -1;
    for (let k = stmt.length - 1; k >= 0; k--) {
      if (stmt[k].type === 'colon') {
        colonIdx = k;
        break;
      }
    }
    const lhs = colonIdx >= 0 ? stmt.slice(0, colonIdx) : stmt;
    const lhsUpper = lhs.map((t) => t.text.toUpperCase()).join(' ');

    if (lhs[0]?.text.toUpperCase() === 'ROLE') {
      roleName = lhs.slice(1).map((t) => t.text.replace(/^"|"$/g, '')).join('');
      continue;
    }
    if (lhsUpper.startsWith('EXTENDS CATALOG ROLE')) {
      globalRoles.push(lhs[lhs.length - 1].text.replace(/^"|"$/g, ''));
      continue;
    }
    if (lhsUpper.startsWith('EXTENDS ROLE')) {
      schemaRoles.push(lhs.slice(2).map((t) => t.text.replace(/^"|"$/g, '')).join(''));
      continue;
    }
    if (colonIdx === -1) continue;

    let endIdx = stmt.length;
    let withGrantOption = false;
    if (
      endIdx >= 3 &&
      stmt[endIdx - 3].text.toUpperCase() === 'WITH' &&
      stmt[endIdx - 2].text.toUpperCase() === 'GRANT' &&
      stmt[endIdx - 1].text.toUpperCase() === 'OPTION'
    ) {
      withGrantOption = true;
      needsGrantHash = true;
      endIdx -= 3;
    }

    const privs: string[] = [];
    let group: RoleToken[] = [];
    for (let i = colonIdx + 1; i < endIdx; i++) {
      if (stmt[i].type === 'comma') {
        if (group.length > 0) privs.push(group.map((t) => t.text.replace(/^"|"$/g, '')).join(' '));
        group = [];
      } else {
        group.push(stmt[i]);
      }
    }
    if (group.length > 0) privs.push(group.map((t) => t.text.replace(/^"|"$/g, '')).join(' '));

    const privKey = withGrantOption ? 'privileges_with_grant_option' : 'privileges';

    if (lhsUpper.startsWith('SYSTEM PRIVILEGE')) {
      systemPrivs.push(...privs);
    } else if (lhsUpper.startsWith('CATALOG SCHEMA')) {
      const refName = lhs[lhs.length - 1]?.text.replace(/^"|"$/g, '') ?? 'EXTERNAL_SCHEMA';
      schemaPrivs.push({ reference: refName, [privKey]: privs });
    } else if (lhsUpper.startsWith('SCHEMA')) {
      schemaPrivs.push({ [privKey]: privs });
    } else if (lhsUpper.startsWith('CATALOG SQL OBJECT')) {
      const rawSubject = lhs.slice(3).map((t) => t.text).join('');
      const parts = rawSubject.split('.');
      const objName = (parts[parts.length - 1] ?? rawSubject).replace(/^"|"$/g, '');
      objectPrivs.push({
        name: objName,
        type: inferObjectTypeFromClassicSubject(rawSubject),
        [privKey]: privs,
      });
    } else if (lhsUpper.startsWith('SQL OBJECT')) {
      const subjectTokens = lhs.slice(2);
      const rawJoined = subjectTokens.map((t) => t.text).join('');
      objectPrivs.push({
        name: normalizeClassicObjectName(subjectTokens),
        type: inferObjectTypeFromClassicSubject(rawJoined),
        [privKey]: privs,
      });
    } else if (lhsUpper.startsWith('ANALYTIC PRIVILEGE') || lhsUpper.startsWith('CATALOG ANALYTIC PRIVILEGE')) {
      analyticPrivs.push({ [privKey]: privs });
    }
  }

  if (needsGrantHash && !roleName.endsWith('#')) {
    roleName = `${roleName}#`;
  }

  const roleObj: Record<string, unknown> = { name: roleName };
  if (schemaRoles.length > 0) roleObj.schema_roles = [{ names: schemaRoles }];
  if (globalRoles.length > 0) roleObj.global_roles = globalRoles;
  if (systemPrivs.length > 0) roleObj.system_privileges = systemPrivs;
  if (schemaPrivs.length > 0) roleObj.schema_privileges = schemaPrivs;
  if (objectPrivs.length > 0) roleObj.object_privileges = objectPrivs;
  if (analyticPrivs.length > 0) roleObj.schema_analytic_privileges = analyticPrivs;

  return `${JSON.stringify({ role: roleObj }, null, 2)}\n`;
}

/**
 * Converts XSC `.hdbdd` CDS artifacts into HDI `.hdbcds` syntax (`HANA-MIG-005`).
 */
function isCdsCodeToken(tok: CdsToken): boolean {
  return tok.type !== 'lineComment' && tok.type !== 'blockComment' && tok.type !== 'raw';
}

function removeCdsAnnotationSpan(text: string, start: number, end: number): TextEditSpan {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const eolIdx = text.indexOf('\n', end);
  const lineEnd = eolIdx === -1 ? text.length : eolIdx;

  const before = text.slice(lineStart, start);
  const afterRaw = text.slice(end, lineEnd);
  const after = afterRaw.endsWith('\r') ? afterRaw.slice(0, -1) : afterRaw;
  const beforeClear = /^[ \t]*$/.test(before);
  const afterClear = /^[ \t]*$/.test(after);

  if (beforeClear && afterClear) {
    if (eolIdx !== -1) {
      return { start: lineStart, end: eolIdx + 1, newText: '' };
    }
    if (lineStart > 0) {
      const prevEnd = text[lineStart - 2] === '\r' ? lineStart - 2 : lineStart - 1;
      return { start: prevEnd, end: text.length, newText: '' };
    }
    return { start: 0, end: text.length, newText: '' };
  }

  if (!beforeClear && afterClear) {
    let trimLeft = start;
    while (trimLeft > lineStart && (text[trimLeft - 1] === ' ' || text[trimLeft - 1] === '\t')) {
      trimLeft--;
    }
    const trimRight = eolIdx === -1 ? text.length : text[eolIdx - 1] === '\r' ? eolIdx - 1 : eolIdx;
    return { start: trimLeft, end: trimRight, newText: '' };
  }

  let trimRight = end;
  while (trimRight < lineEnd && (text[trimRight] === ' ' || text[trimRight] === '\t')) {
    trimRight++;
  }
  if (beforeClear) {
    return { start, end: trimRight, newText: '' };
  }

  const prevCh = text[start - 1] ?? '';
  const nextCh = text[trimRight] ?? '';
  const needsSpace = /[A-Za-z0-9_$]/.test(prevCh) && /[A-Za-z0-9_$]/.test(nextCh);
  return { start, end: trimRight, newText: needsSpace ? ' ' : '' };
}

function findMatchingCdsDelimiter(codeToks: readonly CdsToken[], openIdx: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = openIdx; i < codeToks.length; i++) {
    if (codeToks[i].text === openCh) depth++;
    else if (codeToks[i].text === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipCdsAnnotation(codeToks: readonly CdsToken[], startIdx: number): number {
  let i = startIdx + 1;
  if (codeToks[i]?.text === ':') {
    i++;
    const val = codeToks[i];
    if (!val) return i;
    if (val.text === '{') {
      const close = findMatchingCdsDelimiter(codeToks, i, '{', '}');
      i = close !== -1 ? close + 1 : i + 1;
    } else if (val.text === '[') {
      const close = findMatchingCdsDelimiter(codeToks, i, '[', ']');
      i = close !== -1 ? close + 1 : i + 1;
    } else if (val.text === '(') {
      const close = findMatchingCdsDelimiter(codeToks, i, '(', ')');
      i = close !== -1 ? close + 1 : i + 1;
    } else {
      i++;
    }
  }
  if (codeToks[i]?.text === ';') i++;
  return i;
}

/** Existing `} technical configuration { ... }` block that follows an entity's closing brace. */
interface TechConfigBlock {
  readonly open: CdsToken;
  readonly close: CdsToken;
  readonly hasStore: boolean;
  readonly indexNames: ReadonlySet<string>;
}

interface TargetEntityInfo {
  readonly entityOpen: CdsToken;
  readonly entityClose: CdsToken;
  /** Whether a `;` already follows the entity (after its technical configuration, if any). */
  readonly hasTrailingSemi: boolean;
  readonly techConfig: TechConfigBlock | null;
}

function isCdsWord(tok: CdsToken | undefined, word: string): boolean {
  return tok?.type === 'word' && tok.text.toLowerCase() === word;
}

/**
 * Reads the `technical configuration { ... }` block that CDS places *after* the entity's closing brace
 * (`entity E { ... } technical configuration { ... };`) `[XSC]` `[HDI]`.
 */
function readTechConfigAfter(codeToks: readonly CdsToken[], entityCloseIdx: number): { block: TechConfigBlock; closeIdx: number } | null {
  const k = entityCloseIdx + 1;
  if (!isCdsWord(codeToks[k], 'technical') || !isCdsWord(codeToks[k + 1], 'configuration') || codeToks[k + 2]?.text !== '{') {
    return null;
  }
  const closeIdx = findMatchingCdsDelimiter(codeToks, k + 2, '{', '}');
  if (closeIdx === -1) return null;
  let hasStore = false;
  const indexNames = new Set<string>();
  for (let b = k + 3; b < closeIdx; b++) {
    if (isCdsWord(codeToks[b], 'store') && (isCdsWord(codeToks[b - 1], 'column') || isCdsWord(codeToks[b - 1], 'row'))) {
      hasStore = true;
    } else if (isCdsWord(codeToks[b], 'index') && codeToks[b + 1]) {
      indexNames.add(codeToks[b + 1].text.toLowerCase());
    }
  }
  return { block: { open: codeToks[k + 2], close: codeToks[closeIdx], hasStore, indexNames }, closeIdx };
}

function findTargetEntityAfterAnnotation(codeToks: readonly CdsToken[], afterIdx: number): TargetEntityInfo | null {
  let i = afterIdx;
  while (i < codeToks.length) {
    const t = codeToks[i];
    if (t.type === 'annot') {
      i = skipCdsAnnotation(codeToks, i);
      continue;
    }
    if (t.type === 'word' && t.text.toLowerCase() === 'entity') {
      let k = i + 1;
      while (k < codeToks.length && codeToks[k].text !== '{' && codeToks[k].text !== ';') {
        k++;
      }
      if (codeToks[k]?.text !== '{') return null;
      const closeIdx = findMatchingCdsDelimiter(codeToks, k, '{', '}');
      if (closeIdx === -1) return null;
      const tc = readTechConfigAfter(codeToks, closeIdx);
      const lastIdx = tc ? tc.closeIdx : closeIdx;
      return {
        entityOpen: codeToks[k],
        entityClose: codeToks[closeIdx],
        hasTrailingSemi: codeToks[lastIdx + 1]?.text === ';',
        techConfig: tc?.block ?? null,
      };
    }
    return null;
  }
  return null;
}

function unquoteCdsString(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('\'') && raw.endsWith('\'')) {
    return raw.slice(1, -1).replace(/''/g, '\'');
  }
  return raw;
}

interface CatalogIndexClause {
  readonly name: string;
  readonly text: string;
}

/**
 * Converts `@Catalog.index: [{ name, unique, order, elementNames }]` into technical configuration clauses.
 * CDS orders a whole index, not single columns: `[unique] index <name> on (<a>, <b>) asc|desc;`.
 */
function parseCatalogIndexClauses(codeToks: readonly CdsToken[], arrOpenIdx: number, arrCloseIdx: number): CatalogIndexClause[] {
  const clauses: CatalogIndexClause[] = [];
  let i = arrOpenIdx + 1;
  while (i < arrCloseIdx) {
    if (codeToks[i].text !== '{') {
      i++;
      continue;
    }
    const objClose = findMatchingCdsDelimiter(codeToks, i, '{', '}');
    if (objClose === -1 || objClose >= arrCloseIdx) break;

    let idxName = '';
    let isUnique = false;
    let orderDir = 'asc';
    const elements: string[] = [];

    let p = i + 1;
    while (p < objClose) {
      const keyTok = codeToks[p];
      if (keyTok.type !== 'word' || codeToks[p + 1]?.text !== ':') {
        p++;
        continue;
      }
      const keyLower = keyTok.text.toLowerCase();
      const valTok = codeToks[p + 2];
      if (!valTok) break;

      if (keyLower === 'name' && valTok.type === 'string') {
        idxName = unquoteCdsString(valTok.text);
        p += 3;
      } else if (keyLower === 'unique' && valTok.type === 'word') {
        isUnique = valTok.text.toLowerCase() === 'true';
        p += 3;
      } else if (keyLower === 'order' && valTok.type === 'enumSym') {
        orderDir = valTok.text.toLowerCase() === '#desc' ? 'desc' : 'asc';
        p += 3;
      } else if (keyLower === 'elementnames' && valTok.text === '[') {
        const elClose = findMatchingCdsDelimiter(codeToks, p + 2, '[', ']');
        const limit = elClose !== -1 && elClose < objClose ? elClose : objClose;
        for (let e = p + 3; e < limit; e++) {
          if (codeToks[e].type === 'string') {
            const col = unquoteCdsString(codeToks[e].text).trim();
            if (col) elements.push(col);
          }
        }
        p = limit + 1;
      } else {
        p += 3;
      }
    }

    if (idxName && elements.length > 0) {
      const uq = isUnique ? 'unique ' : '';
      clauses.push({ name: idxName, text: `${uq}index ${idxName} on (${elements.join(', ')}) ${orderDir};` });
    }
    i = objClose + 1;
  }
  return clauses;
}

/** Leading whitespace of the line that contains `offset`, or `null` when other text precedes it on that line. */
function lineIndentBefore(text: string, offset: number): string | null {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  return /^[ \t]*$/.test(before) ? before : null;
}

/**
 * Indentation for clauses inside a block that opens at `open` and closes at `close`: the indentation of the
 * block's first inner line, or the closing brace's indentation plus four spaces.
 */
function innerBlockIndent(text: string, open: CdsToken, close: CdsToken, closeIndent: string): string {
  const firstInner = /\n([ \t]*)\S/.exec(text.slice(open.end, close.start));
  const indent = firstInner?.[1];
  return indent !== undefined && indent.length > closeIndent.length ? indent : `${closeIndent}    `;
}

function buildTechConfigEdit(text: string, target: TargetEntityInfo, clauses: readonly string[]): TextEditSpan {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const tc = target.techConfig;

  if (tc) {
    // Merge into the existing block, before its closing brace.
    const closeIndent = lineIndentBefore(text, tc.close.start);
    if (closeIndent !== null && text.slice(tc.open.end, tc.close.start).includes('\n')) {
      const inner = innerBlockIndent(text, tc.open, tc.close, closeIndent);
      const lineStart = tc.close.start - closeIndent.length;
      return { start: lineStart, end: lineStart, newText: clauses.map((c) => `${inner}${c}${eol}`).join('') };
    }
    const prevCh = text[tc.close.start - 1] ?? '';
    const newText = /\s/.test(prevCh) ? `${clauses.join(' ')} ` : ` ${clauses.join(' ')}`;
    return { start: tc.close.start, end: tc.close.start, newText };
  }

  // No block yet: append `technical configuration { ... }` after the entity's closing brace.
  const semi = target.hasTrailingSemi ? '' : ';';
  const closeIndent = lineIndentBefore(text, target.entityClose.start);
  if (closeIndent !== null && text.slice(target.entityOpen.end, target.entityClose.start).includes('\n')) {
    const inner = innerBlockIndent(text, target.entityOpen, target.entityClose, closeIndent);
    const body = clauses.map((c) => `${inner}${c}${eol}`).join('');
    return {
      start: target.entityClose.end,
      end: target.entityClose.end,
      newText: ` technical configuration {${eol}${body}${closeIndent}}${semi}`,
    };
  }
  return {
    start: target.entityClose.end,
    end: target.entityClose.end,
    newText: ` technical configuration { ${clauses.join(' ')} }${semi}`,
  };
}

function findHdbddMigrationSpans(text: string): Array<{ start: number; end: number }> {
  const codeToks = cdsTokenize(text).filter(isCdsCodeToken);
  const hits: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < codeToks.length; i++) {
    const t = codeToks[i];
    if (t.type !== 'annot') continue;
    const low = t.text.toLowerCase();
    if (low === '@schema' && codeToks[i + 1]?.text === ':' && codeToks[i + 2]?.type === 'string') {
      hits.push({ start: t.start, end: codeToks[i + 2].end });
      i += 2;
    } else if (
      low === '@catalog.tabletype' &&
      codeToks[i + 1]?.text === ':' &&
      codeToks[i + 2]?.type === 'enumSym' &&
      /^#(?:COLUMN|ROW)$/i.test(codeToks[i + 2].text)
    ) {
      hits.push({ start: t.start, end: codeToks[i + 2].end });
      i += 2;
    } else if (low === '@catalog.index' && codeToks[i + 1]?.text === ':' && codeToks[i + 2]?.text === '[') {
      const arrClose = findMatchingCdsDelimiter(codeToks, i + 2, '[', ']');
      const end = arrClose !== -1 ? codeToks[arrClose].end : t.end;
      hits.push({ start: t.start, end });
      if (arrClose !== -1) i = arrClose;
    } else if (low === '@withstructuredprivilegecheck') {
      hits.push({ start: t.start, end: t.end });
    }
  }
  return hits;
}

/**
 * Converts XSC `.hdbdd` CDS artifacts into HDI `.hdbcds` syntax (`HANA-MIG-005`).
 */
export function convertHdbddToHdbcds(text: string): string {
  const codeToks = cdsTokenize(text).filter(isCdsCodeToken);
  const edits: TextEditSpan[] = [];
  const techAdditions = new Map<number, { target: TargetEntityInfo; store: string | null; indexes: string[] }>();
  const entryFor = (target: TargetEntityInfo) => {
    let entry = techAdditions.get(target.entityClose.start);
    if (!entry) {
      entry = { target, store: null, indexes: [] };
      techAdditions.set(target.entityClose.start, entry);
    }
    return entry;
  };
  // SAP forbids @Catalog.tableType / @Catalog.index together with the matching technical configuration
  // clause, so an existing clause always wins and is never duplicated.
  const queueStore = (target: TargetEntityInfo, clause: string): void => {
    if (target.techConfig?.hasStore) return;
    const entry = entryFor(target);
    entry.store ??= clause;
  };
  const queueIndex = (target: TargetEntityInfo, idx: CatalogIndexClause): void => {
    if (target.techConfig?.indexNames.has(idx.name.toLowerCase())) return;
    entryFor(target).indexes.push(idx.text);
  };

  for (let i = 0; i < codeToks.length; i++) {
    const tok = codeToks[i];
    if (tok.type !== 'annot') continue;
    const low = tok.text.toLowerCase();

    // 1. Strip @Schema : '...' (both standalone lines and inline occurrences)
    if (low === '@schema' && codeToks[i + 1]?.text === ':' && codeToks[i + 2]?.type === 'string') {
      const hasSemi = codeToks[i + 3]?.text === ';';
      const endIdx = hasSemi ? i + 3 : i + 2;
      edits.push(removeCdsAnnotationSpan(text, tok.start, codeToks[endIdx].end));
      i = endIdx;
      continue;
    }

    // 2. Remove @WithStructuredPrivilegeCheck marker annotation
    if (low === '@withstructuredprivilegecheck') {
      const hasSemi = codeToks[i + 1]?.text === ';';
      const endIdx = hasSemi ? i + 1 : i;
      edits.push(removeCdsAnnotationSpan(text, tok.start, codeToks[endIdx].end));
      i = endIdx;
      continue;
    }

    // 3. Transform @Catalog.tableType : #COLUMN / #ROW + entity { ... } -> technical configuration
    if (
      low === '@catalog.tabletype' &&
      codeToks[i + 1]?.text === ':' &&
      codeToks[i + 2]?.type === 'enumSym' &&
      /^#(?:COLUMN|ROW)$/i.test(codeToks[i + 2].text)
    ) {
      const storeKeyword = codeToks[i + 2].text.toUpperCase() === '#ROW' ? 'row store;' : 'column store;';
      const hasSemi = codeToks[i + 3]?.text === ';';
      const endIdx = hasSemi ? i + 3 : i + 2;
      const target = findTargetEntityAfterAnnotation(codeToks, endIdx + 1);
      if (target) {
        edits.push(removeCdsAnnotationSpan(text, tok.start, codeToks[endIdx].end));
        queueStore(target, storeKeyword);
      }
      i = endIdx;
      continue;
    }

    // 4. Convert @Catalog.index : [ ... ] -> technical configuration or comment note
    if (low === '@catalog.index' && codeToks[i + 1]?.text === ':' && codeToks[i + 2]?.text === '[') {
      const arrClose = findMatchingCdsDelimiter(codeToks, i + 2, '[', ']');
      if (arrClose !== -1) {
        const hasSemi = codeToks[arrClose + 1]?.text === ';';
        const endIdx = hasSemi ? arrClose + 1 : arrClose;
        const clauses = parseCatalogIndexClauses(codeToks, i + 2, arrClose);
        if (clauses.length > 0) {
          const target = findTargetEntityAfterAnnotation(codeToks, endIdx + 1);
          if (target) {
            edits.push(removeCdsAnnotationSpan(text, tok.start, codeToks[endIdx].end));
            for (const c of clauses) queueIndex(target, c);
          } else {
            edits.push({
              start: tok.start,
              end: codeToks[endIdx].end,
              newText: clauses
                .map((c) => `/* Converted from @Catalog.index -> place in technical configuration { ${c.text} }; */`)
                .join('\n'),
            });
          }
        }
        i = endIdx;
      }
    }
  }

  for (const { target, store, indexes } of techAdditions.values()) {
    const clauses = store ? [store, ...indexes] : indexes;
    if (clauses.length > 0) edits.push(buildTechConfigEdit(text, target, clauses));
  }

  return applyTextEdits(text, edits);
}

/**
 * Converts a full artifact between XSC and HDI syntax for editor refactor commands.
 */
export function convertArtifactDirection(
  text: string,
  languageId: string,
  direction: 'toHdi' | 'toXsc',
  filePath?: string
): { content: string; note?: string } | null {
  const objectName = deriveObjectName(filePath);

  if (languageId === 'hdbtable') {
    if (direction === 'toHdi' && isKeyValueArtifact(text)) {
      return { content: convertHdbtableKvToHdi(text, objectName) };
    }
    if (direction === 'toXsc' && !isKeyValueArtifact(text)) {
      return { content: convertHdbtableHdiToKv(text) };
    }
  } else if (languageId === 'hdbview') {
    if (direction === 'toHdi' && isKeyValueArtifact(text)) {
      return { content: convertHdbviewKvToHdi(text, objectName) };
    }
    if (direction === 'toXsc' && !isKeyValueArtifact(text)) {
      return { content: convertHdbviewHdiToKv(text) };
    }
  } else if (languageId === 'hdbsequence') {
    if (direction === 'toHdi' && isKeyValueArtifact(text)) {
      return { content: convertHdbsequenceKvToHdi(text, objectName) };
    }
    if (direction === 'toXsc' && !isKeyValueArtifact(text)) {
      return { content: convertHdbsequenceHdiToKv(text) };
    }
  } else if (languageId === 'hdbstructure' && direction === 'toHdi') {
    return {
      content: convertHdbstructureKvToTableType(text, objectName),
      note: 'HDI replaces .hdbstructure with .hdbtabletype',
    };
  } else if (languageId === 'hdbrole' && direction === 'toHdi' && isClassicHdbrole(text)) {
    return { content: convertClassicHdbroleToHdiJson(text) };
  } else if ((languageId === 'hdbdd' || languageId === 'hdbcds') && direction === 'toHdi') {
    return {
      content: convertHdbddToHdbcds(text),
      note: 'Rename target extension from .hdbdd to .hdbcds for HDI',
    };
  }

  return null;
}

/**
 * Emits non-intrusive migration diagnostics and one-click AST conversion CodeActions.
 */
export function analyzeMigration(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { text, languageId, filePath, options } = ctx;
  if (options?.migration === false) return [];
  const targetPlatform = options?.targetPlatform ?? 'auto';
  if (targetPlatform === 'xsc') return [];

  const diagnostics: AnalyzerDiagnostic[] = [];
  const endOffset = Math.min(text.length, Math.max(1, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n')));
  const fullRangeFix = (title: string, newText: string): CodeFixSuggestion => ({
    title,
    kind: 'quickfix',
    edits: [{ start: 0, end: text.length, newText }],
  });

  if (languageId === 'hdbtable' && isKeyValueArtifact(text)) {
    const converted = convertHdbtableKvToHdi(text, deriveObjectName(filePath));
    diagnostics.push({
      ruleId: 'HANA-MIG-001',
      category: 'migration',
      severity: 'information',
      message: 'XS Classic KV .hdbtable artifact can be converted to HDI DDL (COLUMN TABLE / ROW TABLE).',
      start: 0,
      end: endOffset,
      fixes: [fullRangeFix('Convert Classic .hdbtable to HDI DDL syntax', converted)],
    });
  } else if (languageId === 'hdbview' && isKeyValueArtifact(text)) {
    const converted = convertHdbviewKvToHdi(text, deriveObjectName(filePath));
    diagnostics.push({
      ruleId: 'HANA-MIG-002',
      category: 'migration',
      severity: 'information',
      message: 'XS Classic KV .hdbview artifact can be converted to HDI DDL (VIEW ... AS ...).',
      start: 0,
      end: endOffset,
      fixes: [fullRangeFix('Convert Classic .hdbview to HDI DDL syntax', converted)],
    });
  } else if (languageId === 'hdbsequence' && isKeyValueArtifact(text)) {
    const converted = convertHdbsequenceKvToHdi(text, deriveObjectName(filePath));
    diagnostics.push({
      ruleId: 'HANA-MIG-003',
      category: 'migration',
      severity: 'information',
      message: 'XS Classic KV .hdbsequence artifact can be converted to HDI DDL (SEQUENCE ...).',
      start: 0,
      end: endOffset,
      fixes: [fullRangeFix('Convert Classic .hdbsequence to HDI DDL syntax', converted)],
    });
  } else if (languageId === 'hdbrole' && isClassicHdbrole(text)) {
    const converted = convertClassicHdbroleToHdiJson(text);
    diagnostics.push({
      ruleId: 'HANA-MIG-004',
      category: 'migration',
      severity: 'information',
      message: 'XS Classic .hdbrole DSL can be migrated to HDI JSON .hdbrole schema.',
      start: 0,
      end: endOffset,
      fixes: [fullRangeFix('Convert Classic .hdbrole to HDI JSON .hdbrole', converted)],
    });
  } else if (languageId === 'hdbdd' || languageId === 'hdbcds') {
    const hits = findHdbddMigrationSpans(text);
    if (hits.length > 0) {
      const converted = convertHdbddToHdbcds(text);
      for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        diagnostics.push({
          ruleId: 'HANA-MIG-005',
          category: 'migration',
          severity: 'warning',
          message:
            'XSC .hdbdd annotations (@Schema / @Catalog.*) must be converted for HDI .hdbcds (remove @Schema and use technical configuration).',
          start: hit.start,
          end: hit.end,
          fixes: [
            {
              title: 'Convert .hdbdd annotations to HDI .hdbcds syntax',
              kind: 'quickfix',
              isPreferred: i === 0,
              edits: [{ start: 0, end: text.length, newText: converted }],
            },
          ],
        });
      }
    }
  } else if (languageId === 'hdbstructure' && isKeyValueArtifact(text)) {
    diagnostics.push({
      ruleId: 'HANA-MIG-006',
      category: 'migration',
      severity: 'information',
      message: 'XS Classic .hdbstructure is replaced by HDI .hdbtabletype (TYPE ... AS TABLE (...)).',
      start: 0,
      end: endOffset,
      fixes: [
        fullRangeFix(
          'Convert .hdbstructure to HDI .hdbtabletype DDL',
          convertHdbstructureKvToTableType(text, deriveObjectName(filePath))
        ),
      ],
    });
  } else if (languageId === 'hdbschema') {
    diagnostics.push({
      ruleId: 'HANA-MIG-012',
      category: 'migration',
      severity: 'information',
      message:
        '.hdbschema files are obsolete in HDI; database schemas are provisioned automatically by the HDI container.',
      start: 0,
      end: endOffset,
      fixes: [],
    });
  } else if (languageId === 'hdbti') {
    diagnostics.push({
      ruleId: 'HANA-MIG-012',
      category: 'migration',
      severity: 'information',
      message:
        '.hdbti table import definitions are replaced by HDI .hdbtabledata + CSV artifacts in XSA / SAP HANA Cloud.',
      start: 0,
      end: endOffset,
      fixes: [],
    });
  }

  return filterSuppressedDiagnostics(text, diagnostics);
}
