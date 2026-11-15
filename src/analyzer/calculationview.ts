import {
  filterSuppressedDiagnostics,
  type AnalyzerContext,
  type AnalyzerDiagnostic,
  type CodeFixSuggestion,
} from './types';

interface XmlAttr {
  readonly name: string;
  readonly value: string;
  readonly attrStart: number;
  readonly attrEnd: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

interface XmlElementNode {
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

interface XmlParseResult {
  readonly roots: readonly XmlElementNode[];
  readonly errors: ReadonlyArray<{ readonly message: string; readonly start: number; readonly end: number }>;
}

interface AritySpec {
  readonly min: number;
  readonly max: number;
  readonly label: string;
}

const NODE_ARITY_SPECS: Readonly<Record<string, AritySpec>> = {
  'Calculation:ProjectionView': { min: 1, max: 1, label: 'exactly 1' },
  'Calculation:AggregationView': { min: 1, max: 1, label: 'exactly 1' },
  'Calculation:RankView': { min: 1, max: 1, label: 'exactly 1' },
  'Calculation:AnonymizationView': { min: 1, max: 1, label: 'exactly 1' },
  'Calculation:JoinView': { min: 2, max: Number.POSITIVE_INFINITY, label: 'at least 2' },
  'Calculation:NonEquiJoinView': { min: 2, max: Number.POSITIVE_INFINITY, label: 'at least 2' },
  'Calculation:UnionView': { min: 2, max: Number.POSITIVE_INFINITY, label: 'at least 2' },
  'Calculation:IntersectView': { min: 2, max: 2, label: 'exactly 2' },
  'Calculation:MinusView': { min: 2, max: 2, label: 'exactly 2' },
  'Calculation:StarJoinView': { min: 1, max: Number.POSITIVE_INFINITY, label: 'at least 1' },
  'Calculation:HierarchyView': { min: 1, max: Number.POSITIVE_INFINITY, label: 'at least 1' },
};

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributes(text: string, sliceStart: number, sliceEnd: number): { attrs: XmlAttr[]; error?: string } {
  const attrs: XmlAttr[] = [];
  let i = sliceStart;
  while (i < sliceEnd) {
    while (i < sliceEnd && /\s/.test(text[i])) i++;
    if (i >= sliceEnd) break;

    const attrStart = i;
    while (i < sliceEnd && /[A-Za-z0-9_:\-.]/.test(text[i])) i++;
    if (i === attrStart) {
      return { attrs, error: `Unexpected character '${text[i]}' inside element attributes` };
    }
    const name = text.slice(attrStart, i);

    while (i < sliceEnd && /\s/.test(text[i])) i++;
    if (text[i] !== '=') {
      return { attrs, error: `Expected '=' after attribute '${name}'` };
    }
    i++;
    while (i < sliceEnd && /\s/.test(text[i])) i++;
    const quote = text[i];
    if (quote !== '"' && quote !== '\'') {
      return { attrs, error: `Expected quoted value for attribute '${name}'` };
    }
    const valueStart = i;
    i++;
    while (i < sliceEnd && text[i] !== quote) i++;
    if (i >= sliceEnd) {
      return { attrs, error: `Unterminated quote in attribute '${name}'` };
    }
    const valueEnd = i + 1;
    const rawValue = text.slice(valueStart + 1, i);
    i++;

    attrs.push({
      name,
      value: decodeXmlEntities(rawValue),
      attrStart,
      attrEnd: valueEnd,
      valueStart,
      valueEnd,
    });
  }
  return { attrs };
}

/**
 * Lossless pure-TS XML parser recording exact byte offsets for elements and attributes.
 */
function parseXmlTree(text: string): XmlParseResult {
  const roots: XmlElementNode[] = [];
  const stack: XmlElementNode[] = [];
  const errors: Array<{ message: string; start: number; end: number }> = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;

    // Comment <!-- ... -->
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) {
        errors.push({ message: 'Unterminated XML comment', start: lt, end: Math.min(n, lt + 4) });
        break;
      }
      i = end + 3;
      continue;
    }

    // CDATA <![CDATA[ ... ]]>
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) {
        errors.push({ message: 'Unterminated CDATA section', start: lt, end: Math.min(n, lt + 9) });
        break;
      }
      i = end + 3;
      continue;
    }

    // Processing instruction <?...?>
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) {
        errors.push({ message: 'Unterminated XML processing instruction', start: lt, end: Math.min(n, lt + 2) });
        break;
      }
      i = end + 2;
      continue;
    }

    // Closing tag </tag>
    if (text.startsWith('</', lt)) {
      const gt = text.indexOf('>', lt + 2);
      if (gt === -1) {
        errors.push({ message: 'Unterminated closing tag', start: lt, end: Math.min(n, lt + 4) });
        break;
      }
      const closeName = text.slice(lt + 2, gt).trim();
      const top = stack[stack.length - 1];
      if (!top) {
        errors.push({ message: `Unexpected closing tag '</${closeName}>'`, start: lt, end: gt + 1 });
      } else if (top.tagName !== closeName) {
        errors.push({
          message: `Mismatched closing tag '</${closeName}>' (expected '</${top.tagName}>')`,
          start: lt,
          end: gt + 1,
        });
        // Pop matching ancestor if present to recover cleanly
        let matchIdx = -1;
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tagName === closeName) {
            matchIdx = k;
            break;
          }
        }
        if (matchIdx >= 0) {
          while (stack.length > matchIdx) {
            const popped = stack.pop()!;
            popped.end = gt + 1;
          }
        }
      } else {
        stack.pop();
        top.end = gt + 1;
      }
      i = gt + 1;
      continue;
    }

    // Opening or self-closing tag (respect quotes when finding closing '>')
    let cursor = lt + 1;
    let quote: string | null = null;
    let gt = -1;
    while (cursor < n) {
      const c = text[cursor];
      if (quote !== null) {
        if (c === quote) quote = null;
      } else {
        if (c === '"' || c === '\'') quote = c;
        else if (c === '>') {
          gt = cursor;
          break;
        }
      }
      cursor++;
    }
    if (gt === -1) {
      errors.push({ message: 'Unterminated opening XML tag', start: lt, end: Math.min(n, lt + 20) });
      break;
    }

    const innerEnd = text[gt - 1] === '/' ? gt - 1 : gt;
    const selfClosing = text[gt - 1] === '/';

    let nameEnd = lt + 1;
    while (nameEnd < innerEnd && !/\s/.test(text[nameEnd])) nameEnd++;
    const tagName = text.slice(lt + 1, nameEnd);
    const { attrs, error: attrErr } = parseAttributes(text, nameEnd, innerEnd);
    if (attrErr) {
      errors.push({ message: attrErr, start: lt, end: gt + 1 });
    }

    const attrMap = new Map<string, XmlAttr>();
    for (const a of attrs) attrMap.set(a.name, a);

    const parent = stack[stack.length - 1];
    const node: XmlElementNode = {
      tagName,
      start: lt,
      openTagEnd: gt + 1,
      end: gt + 1,
      selfClosing,
      attrs,
      attrMap,
      children: [],
      parent,
    };

    if (parent) parent.children.push(node);
    else roots.push(node);

    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }

  for (const unclosed of stack) {
    errors.push({
      message: `Unclosed XML element '<${unclosed.tagName}>'`,
      start: unclosed.start,
      end: unclosed.openTagEnd,
    });
  }

  return { roots, errors };
}

function collectElementsByName(node: XmlElementNode, names: ReadonlySet<string>, out: XmlElementNode[]): void {
  if (names.has(node.tagName)) out.push(node);
  for (const child of node.children) collectElementsByName(child, names, out);
}

/**
 * Finds cycles in calculationView -> input(#source) dependency edges.
 */
function findViewCycles(
  edges: ReadonlyMap<string, readonly { targetId: string; node: XmlElementNode }[]>
): Set<string> {
  const cyclicIds = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();

  const dfs = (id: string): void => {
    state.set(id, 'visiting');
    for (const edge of edges.get(id) ?? []) {
      if (!edges.has(edge.targetId)) continue;
      const st = state.get(edge.targetId);
      if (st === 'visiting') {
        cyclicIds.add(id);
        cyclicIds.add(edge.targetId);
      } else if (!st) {
        dfs(edge.targetId);
      }
    }
    state.set(id, 'done');
  };

  for (const id of edges.keys()) {
    if (!state.has(id)) dfs(id);
  }
  return cyclicIds;
}

/**
 * Builds a clean attribute deletion span including one preceding space when present.
 */
function deleteAttrSpan(text: string, attr: XmlAttr): { start: number; end: number; newText: string } {
  let start = attr.attrStart;
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
  return { start, end: attr.attrEnd, newText: '' };
}

/**
 * Analyzes `.calculationview` and `.hdbcalculationview` XML documents.
 */
export function analyzeCalculationView(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { text, languageId, options } = ctx;
  if (options?.calculationView === false) return [];

  const targetPlatform = options?.targetPlatform ?? 'auto';
  const isHdiArtifact =
    languageId === 'hdbcalculationview' || targetPlatform === 'hdi' || targetPlatform === 'cloud';

  const parsed = parseXmlTree(text);
  const diagnostics: AnalyzerDiagnostic[] = [];

  // HANA-LINT-101: Well-formedness and root <Calculation:scenario id="...">
  for (const err of parsed.errors) {
    diagnostics.push({
      ruleId: 'HANA-LINT-101',
      category: 'calculationview',
      severity: 'error',
      message: `Malformed calculation view XML: ${err.message}.`,
      start: err.start,
      end: err.end,
      fixes: [],
    });
  }

  const root = parsed.roots.find((r) => r.tagName === 'Calculation:scenario' || r.tagName === 'scenario');
  if (!root) {
    if (parsed.errors.length === 0) {
      const first = parsed.roots[0];
      diagnostics.push({
        ruleId: 'HANA-LINT-101',
        category: 'calculationview',
        severity: 'error',
        message: "Malformed calculation view XML: missing root '<Calculation:scenario>' element.",
        start: first ? first.start : 0,
        end: first ? first.openTagEnd : Math.min(text.length, 40),
        fixes: [],
      });
    }
    return filterSuppressedDiagnostics(text, diagnostics);
  }

  const rootIdAttr = root.attrMap.get('id');
  if (!rootIdAttr || rootIdAttr.value.trim() === '') {
    diagnostics.push({
      ruleId: 'HANA-LINT-101',
      category: 'calculationview',
      severity: 'error',
      message: "Malformed calculation view XML: missing required 'id' attribute on <Calculation:scenario>.",
      start: root.start,
      end: root.openTagEnd,
      fixes: [],
    });
  }

  // Collect DataSources & CalculationViews
  const dataSources: XmlElementNode[] = [];
  const calcViews: XmlElementNode[] = [];
  const logicalModels: XmlElementNode[] = [];
  const columnObjects: XmlElementNode[] = [];

  collectElementsByName(root, new Set(['DataSource', 'Calculation:DataSource']), dataSources);
  collectElementsByName(root, new Set(['calculationView']), calcViews);
  collectElementsByName(root, new Set(['logicalModel']), logicalModels);
  collectElementsByName(root, new Set(['columnObject']), columnObjects);

  const nodeIds = new Set<string>();
  const dataSourceIds = new Set<string>();
  const calcViewIds = new Set<string>();

  for (const ds of dataSources) {
    const idAttr = ds.attrMap.get('id');
    if (idAttr?.value) {
      if (nodeIds.has(idAttr.value)) {
        diagnostics.push({
          ruleId: 'HANA-LINT-105',
          category: 'calculationview',
          severity: 'warning',
          message: `Duplicate ID '${idAttr.value}' across DataSource/calculationView nodes.`,
          start: idAttr.valueStart,
          end: idAttr.valueEnd,
          fixes: [],
        });
      }
      nodeIds.add(idAttr.value);
      dataSourceIds.add(idAttr.value);
    }
  }

  for (const cv of calcViews) {
    const idAttr = cv.attrMap.get('id');
    if (idAttr?.value) {
      if (nodeIds.has(idAttr.value)) {
        diagnostics.push({
          ruleId: 'HANA-LINT-105',
          category: 'calculationview',
          severity: 'warning',
          message: `Duplicate ID '${idAttr.value}' or unknown columnObjectName in calculation view.`,
          start: idAttr.valueStart,
          end: idAttr.valueEnd,
          fixes: [],
        });
      }
      nodeIds.add(idAttr.value);
      calcViewIds.add(idAttr.value);
    }
  }

  // Evaluate each <calculationView>: HANA-LINT-102 (inputs/cycles), HANA-LINT-103 (arity), HANA-LINT-107 (ScriptView)
  const viewEdges = new Map<string, Array<{ targetId: string; node: XmlElementNode }>>();

  for (const cv of calcViews) {
    const cvId = cv.attrMap.get('id')?.value ?? '';
    const xsiType = cv.attrMap.get('xsi:type')?.value ?? '';
    const inputs = cv.children.filter((c) => c.tagName === 'input');

    // HANA-LINT-107: Deprecated Calculation:ScriptView
    if (xsiType === 'Calculation:ScriptView' && isHdiArtifact) {
      const typeAttr = cv.attrMap.get('xsi:type')!;
      diagnostics.push({
        ruleId: 'HANA-LINT-107',
        category: 'calculationview',
        severity: targetPlatform === 'cloud' ? 'error' : 'warning',
        tags: ['deprecated'],
        message:
          "XSC-only construct ('Calculation:ScriptView') found in HDI .hdbcalculationview. Convert scripted logic to a Table Function (.hdbfunction).",
        start: typeAttr.valueStart,
        end: typeAttr.valueEnd,
        fixes: [],
      });
    }

    // HANA-LINT-103: Input cardinality constraints by xsi:type
    const spec = NODE_ARITY_SPECS[xsiType];
    if (spec && (inputs.length < spec.min || inputs.length > spec.max)) {
      diagnostics.push({
        ruleId: 'HANA-LINT-103',
        category: 'calculationview',
        severity: 'error',
        message: `Node '${cvId || '(unnamed)'}' of type '${xsiType}' requires ${spec.label} <input> elements (found ${inputs.length}).`,
        start: cv.start,
        end: cv.openTagEnd,
        fixes: [],
      });
    }

    const outgoing: Array<{ targetId: string; node: XmlElementNode }> = [];
    for (const inp of inputs) {
      const nodeAttr = inp.attrMap.get('node');
      if (!nodeAttr || !nodeAttr.value.trim()) {
        diagnostics.push({
          ruleId: 'HANA-LINT-102',
          category: 'calculationview',
          severity: 'error',
          message: `Unresolved or cyclic node input '(missing node)' in calculationView '${cvId}'.`,
          start: inp.start,
          end: inp.openTagEnd,
          fixes: [],
        });
        continue;
      }

      const rawRef = nodeAttr.value.trim();
      const targetId = rawRef.startsWith('#') ? rawRef.slice(1) : rawRef;
      outgoing.push({ targetId, node: inp });

      if (!nodeIds.has(targetId) || targetId === cvId) {
        diagnostics.push({
          ruleId: 'HANA-LINT-102',
          category: 'calculationview',
          severity: 'error',
          message: `Unresolved or cyclic node input '#${targetId}' in calculationView '${cvId}'.`,
          start: nodeAttr.valueStart,
          end: nodeAttr.valueEnd,
          fixes: [],
        });
      }
    }
    if (cvId) viewEdges.set(cvId, outgoing);
  }

  // Detect indirect cycles among calculationViews
  const cyclicIds = findViewCycles(viewEdges);
  for (const cid of cyclicIds) {
    const cvNode = calcViews.find((c) => c.attrMap.get('id')?.value === cid);
    if (cvNode) {
      const idAttr = cvNode.attrMap.get('id')!;
      diagnostics.push({
        ruleId: 'HANA-LINT-102',
        category: 'calculationview',
        severity: 'error',
        message: `Unresolved or cyclic node input in calculationView '${cid}': dependency cycle detected.`,
        start: idAttr.valueStart,
        end: idAttr.valueEnd,
        fixes: [],
      });
    }
  }

  // HANA-LINT-104 & HANA-LINT-105: LogicalModel, CUBE vs DIMENSION measure checks, and mappings
  const dataCategory = root.attrMap.get('dataCategory')?.value ?? '';
  if (logicalModels.length === 0) {
    diagnostics.push({
      ruleId: 'HANA-LINT-104',
      category: 'calculationview',
      severity: 'error',
      message: 'LogicalModel validation error: missing <logicalModel> definition in calculation view.',
      start: root.start,
      end: root.openTagEnd,
      fixes: [],
    });
  } else {
    const lm = logicalModels[0];
    const lmIdAttr = lm.attrMap.get('id');
    if (lmIdAttr && calcViewIds.size > 0 && !calcViewIds.has(lmIdAttr.value)) {
      diagnostics.push({
        ruleId: 'HANA-LINT-104',
        category: 'calculationview',
        severity: 'warning',
        message: `LogicalModel validation error: logicalModel id '${lmIdAttr.value}' does not match any <calculationView id>.`,
        start: lmIdAttr.valueStart,
        end: lmIdAttr.valueEnd,
        fixes: [],
      });
    }

    const attrs: XmlElementNode[] = [];
    const measures: XmlElementNode[] = [];
    const mappings: XmlElementNode[] = [];
    collectElementsByName(lm, new Set(['attribute', 'calculatedAttribute']), attrs);
    collectElementsByName(lm, new Set(['measure', 'calculatedMeasure']), measures);
    collectElementsByName(lm, new Set(['keyMapping', 'measureMapping']), mappings);

    if (dataCategory === 'CUBE' && measures.length === 0) {
      diagnostics.push({
        ruleId: 'HANA-LINT-104',
        category: 'calculationview',
        severity: 'warning',
        message:
          'LogicalModel validation error: dataCategory="CUBE" must define at least one <measure>.',
        start: root.attrMap.get('dataCategory')?.valueStart ?? lm.start,
        end: root.attrMap.get('dataCategory')?.valueEnd ?? lm.openTagEnd,
        fixes: [],
      });
    } else if (dataCategory === 'DIMENSION' && measures.length > 0) {
      diagnostics.push({
        ruleId: 'HANA-LINT-104',
        category: 'calculationview',
        severity: 'error',
        message:
          'LogicalModel validation error: dataCategory="DIMENSION" cannot define measures.',
        start: measures[0].start,
        end: measures[0].openTagEnd,
        fixes: [],
      });
    }

    const seenLmFieldIds = new Set<string>();
    for (const field of [...attrs, ...measures]) {
      const fId = field.attrMap.get('id');
      if (!fId || !fId.value) continue;
      if (seenLmFieldIds.has(fId.value)) {
        diagnostics.push({
          ruleId: 'HANA-LINT-105',
          category: 'calculationview',
          severity: 'warning',
          message: `Duplicate ID '${fId.value}' in logicalModel attributes/measures.`,
          start: fId.valueStart,
          end: fId.valueEnd,
          fixes: [],
        });
      }
      seenLmFieldIds.add(fId.value);
    }

    const rootId = rootIdAttr?.value ?? '';
    for (const mp of mappings) {
      const colObj = mp.attrMap.get('columnObjectName');
      if (
        colObj &&
        colObj.value &&
        !nodeIds.has(colObj.value) &&
        colObj.value !== rootId
      ) {
        diagnostics.push({
          ruleId: 'HANA-LINT-105',
          category: 'calculationview',
          severity: 'warning',
          message: `Duplicate ID or unknown columnObjectName '${colObj.value}' in mapping.`,
          start: colObj.valueStart,
          end: colObj.valueEnd,
          fixes: [],
        });
      }
    }
  }

  // HANA-LINT-106: Privilege checks (ANALYTIC_PRIVILEGE / checkAnalyticPrivileges / NONE)
  const applyPriv = root.attrMap.get('applyPrivilegeType');
  const checkAnalytic = root.attrMap.get('checkAnalyticPrivileges');

  if (
    applyPriv &&
    (applyPriv.value === 'ANALYTIC_PRIVILEGE' ||
      (applyPriv.value === 'NONE' && (dataCategory === 'CUBE' || dataCategory === 'DIMENSION')))
  ) {
    diagnostics.push({
      ruleId: 'HANA-LINT-106',
      category: 'calculationview',
      severity: 'warning',
      message: `Calculation view uses legacy/missing analytic privilege setting ('${applyPriv.value}'). Prefer 'applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"'.`,
      start: applyPriv.valueStart,
      end: applyPriv.valueEnd,
      fixes: [
        {
          title: 'Set applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"',
          kind: 'quickfix',
          isPreferred: true,
          edits: [
            {
              start: applyPriv.valueStart,
              end: applyPriv.valueEnd,
              newText: '"SQL_ANALYTIC_PRIVILEGE"',
            },
          ],
        },
      ],
    });
  } else if (checkAnalytic && checkAnalytic.value === 'true') {
    const fix: CodeFixSuggestion = applyPriv
      ? {
          title: 'Remove legacy checkAnalyticPrivileges attribute',
          kind: 'quickfix',
          isPreferred: true,
          edits: [deleteAttrSpan(text, checkAnalytic)],
        }
      : {
          title: 'Replace checkAnalyticPrivileges with applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"',
          kind: 'quickfix',
          isPreferred: true,
          edits: [
            {
              start: checkAnalytic.attrStart,
              end: checkAnalytic.attrEnd,
              newText: 'applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"',
            },
          ],
        };

    diagnostics.push({
      ruleId: 'HANA-LINT-106',
      category: 'calculationview',
      severity: 'warning',
      message:
        "Calculation view uses legacy/missing analytic privilege setting ('checkAnalyticPrivileges=\"true\"'). Prefer 'applyPrivilegeType=\"SQL_ANALYTIC_PRIVILEGE\"'.",
      start: checkAnalytic.attrStart,
      end: checkAnalytic.attrEnd,
      fixes: [fix],
    });
  }

  // HANA-LINT-107: XSC schemaName / defaultSchema constructs in HDI
  if (isHdiArtifact) {
    const defSchema = root.attrMap.get('defaultSchema');
    if (defSchema) {
      diagnostics.push({
        ruleId: 'HANA-LINT-107',
        category: 'calculationview',
        severity: 'warning',
        message:
          "XSC-only construct ('defaultSchema') found in HDI .hdbcalculationview. Remove defaultSchema and use schema-agnostic <resourceUri> references.",
        start: defSchema.attrStart,
        end: defSchema.attrEnd,
        fixes: [
          {
            title: "Remove XSC-only 'defaultSchema' attribute",
            kind: 'quickfix',
            isPreferred: true,
            edits: [deleteAttrSpan(text, defSchema)],
          },
        ],
      });
    }

    for (const co of columnObjects) {
      const schemaAttr = co.attrMap.get('schemaName');
      if (schemaAttr) {
        diagnostics.push({
          ruleId: 'HANA-LINT-107',
          category: 'calculationview',
          severity: 'warning',
          message:
            "XSC-only construct ('schemaName') found in HDI .hdbcalculationview. Use schema-agnostic <resourceUri>.",
          start: schemaAttr.attrStart,
          end: schemaAttr.attrEnd,
          fixes: [
            {
              title: "Remove 'schemaName' attribute from <columnObject>",
              kind: 'quickfix',
              isPreferred: true,
              edits: [deleteAttrSpan(text, schemaAttr)],
            },
          ],
        });
      }
    }
  }

  return filterSuppressedDiagnostics(text, diagnostics);
}
