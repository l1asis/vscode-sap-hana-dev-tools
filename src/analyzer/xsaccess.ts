import {
  buildJsonInsertPropertyEdit,
  findObjectProp,
  parseJsonAst,
  type JsonObjectNode,
} from './json-parser';
import {
  filterSuppressedDiagnostics,
  type AnalyzerContext,
  type AnalyzerDiagnostic,
} from './types';

function isExposedTrue(root: JsonObjectNode): { exposed: boolean; propStart: number; propEnd: number } {
  const prop = findObjectProp(root, 'exposed');
  if (prop && prop.value.kind === 'boolean' && prop.value.value === true) {
    return { exposed: true, propStart: prop.keyStart, propEnd: prop.value.end };
  }
  return { exposed: false, propStart: root.start, propEnd: Math.min(root.end, root.start + 1) };
}

function hasXFrameOptionsHeader(root: JsonObjectNode): boolean {
  const headersProp = findObjectProp(root, 'headers');
  if (!headersProp || headersProp.value.kind !== 'object') return false;
  const enabledProp = findObjectProp(headersProp.value, 'enabled');
  if (!enabledProp || enabledProp.value.kind !== 'boolean' || enabledProp.value.value !== true) {
    return false;
  }
  const customHeaders = findObjectProp(headersProp.value, 'customHeaders');
  if (!customHeaders || customHeaders.value.kind !== 'array') return false;
  return customHeaders.value.items.some((item) => {
    if (item.kind !== 'object') return false;
    const nameProp = findObjectProp(item, 'name');
    return (
      nameProp &&
      nameProp.value.kind === 'string' &&
      String(nameProp.value.value).toLowerCase() === 'x-frame-options'
    );
  });
}

/**
 * Analyzes XS Classic `.xsaccess` JSON configuration files for security misconfigurations.
 */
export function analyzeXsaccess(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { text, options } = ctx;
  if (options?.security === false) return [];

  const ast = parseJsonAst(text);
  if (!ast || ast.kind !== 'object') return [];

  const diagnostics: AnalyzerDiagnostic[] = [];
  const exposedInfo = isExposedTrue(ast);

  // HANA-SEC-020: exposed: true without authentication
  if (exposedInfo.exposed) {
    const authProp = findObjectProp(ast, 'authentication');
    const isNullOrEmptyArray =
      !authProp ||
      authProp.value.kind === 'null' ||
      (authProp.value.kind === 'array' && authProp.value.items.length === 0);

    if (isNullOrEmptyArray) {
      const fixEdit = authProp
        ? {
            start: authProp.value.start,
            end: authProp.value.end,
            newText: '{\n    "method": "Form"\n  }',
          }
        : buildJsonInsertPropertyEdit(text, ast, 'authentication', '{\n    "method": "Form"\n  }');

      diagnostics.push({
        ruleId: 'HANA-SEC-020',
        category: 'security',
        severity: 'error',
        message:
          "Package has '\"exposed\": true' without authentication ('\"authentication\": null' or omitted). Endpoints are publicly accessible.",
        start: authProp ? authProp.keyStart : exposedInfo.propStart,
        end: authProp ? authProp.value.end : exposedInfo.propEnd,
        fixes: [
          {
            title: 'Enable Form authentication in .xsaccess',
            kind: 'quickfix',
            isPreferred: true,
            edits: [fixEdit],
          },
        ],
      });
    }
  }

  // HANA-SEC-021: prevent_xsrf disabled or omitted when exposed
  const xsrfProp = findObjectProp(ast, 'prevent_xsrf');
  if (xsrfProp && xsrfProp.value.kind === 'boolean' && xsrfProp.value.value === false) {
    diagnostics.push({
      ruleId: 'HANA-SEC-021',
      category: 'security',
      severity: 'warning',
      message:
        "'prevent_xsrf' is disabled or omitted (defaults to false). Enable '\"prevent_xsrf\": true' to enforce X-CSRF-Token checks.",
      start: xsrfProp.keyStart,
      end: xsrfProp.value.end,
      fixes: [
        {
          title: 'Set "prevent_xsrf": true',
          kind: 'quickfix',
          isPreferred: true,
          edits: [{ start: xsrfProp.value.start, end: xsrfProp.value.end, newText: 'true' }],
        },
      ],
    });
  } else if (exposedInfo.exposed && !xsrfProp) {
    diagnostics.push({
      ruleId: 'HANA-SEC-021',
      category: 'security',
      severity: 'warning',
      message:
        "'prevent_xsrf' is disabled or omitted (defaults to false). Enable '\"prevent_xsrf\": true' to enforce X-CSRF-Token checks.",
      start: exposedInfo.propStart,
      end: exposedInfo.propEnd,
      fixes: [
        {
          title: 'Add "prevent_xsrf": true',
          kind: 'quickfix',
          isPreferred: true,
          edits: [buildJsonInsertPropertyEdit(text, ast, 'prevent_xsrf', 'true')],
        },
      ],
    });
  }

  // HANA-SEC-022: anonymous_connection or default_connection
  const anonProp = findObjectProp(ast, 'anonymous_connection');
  if (anonProp && anonProp.value.kind === 'string' && String(anonProp.value.value).trim() !== '') {
    diagnostics.push({
      ruleId: 'HANA-SEC-022',
      category: 'security',
      severity: 'warning',
      message:
        "'anonymous_connection' executes unauthenticated requests under a static .xssqlcc user. Restrict to isolated public packages.",
      start: anonProp.keyStart,
      end: anonProp.value.end,
      fixes: [],
    });
  }
  const defConnProp = findObjectProp(ast, 'default_connection');
  if (defConnProp && defConnProp.value.kind === 'string' && String(defConnProp.value.value).trim() !== '') {
    diagnostics.push({
      ruleId: 'HANA-SEC-022',
      category: 'security',
      severity: 'warning',
      message:
        "'default_connection' overrides authenticated DB user identity for all SQL calls in this package with a single .xssqlcc user.",
      start: defConnProp.keyStart,
      end: defConnProp.value.end,
      fixes: [],
    });
  }

  // HANA-SEC-023: Overly permissive CORS policy
  const corsProp = findObjectProp(ast, 'cors');
  if (corsProp && corsProp.value.kind === 'object') {
    const corsObj = corsProp.value;
    const enabledProp = findObjectProp(corsObj, 'enabled');
    if (enabledProp && enabledProp.value.kind === 'boolean' && enabledProp.value.value === true) {
      const originProp = findObjectProp(corsObj, 'allowOrigin');
      if (!originProp) {
        diagnostics.push({
          ruleId: 'HANA-SEC-023',
          category: 'security',
          severity: 'warning',
          message:
            'CORS is enabled with wildcard \'"*"\' origin (explicit or default). Specify explicit trusted origins in \'allowOrigin\'.',
          start: corsProp.keyStart,
          end: enabledProp.value.end,
          fixes: [
            {
              title: 'Restrict CORS allowOrigin to trusted origin',
              kind: 'quickfix',
              isPreferred: true,
              edits: [
                buildJsonInsertPropertyEdit(
                  text,
                  corsObj,
                  'allowOrigin',
                  '["https://trusted-origin.example.com"]'
                ),
              ],
            },
          ],
        });
      } else if (
        (originProp.value.kind === 'string' && originProp.value.value === '*') ||
        (originProp.value.kind === 'array' &&
          originProp.value.items.some((it) => it.kind === 'string' && it.value === '*'))
      ) {
        diagnostics.push({
          ruleId: 'HANA-SEC-023',
          category: 'security',
          severity: 'warning',
          message:
            'CORS is enabled with wildcard \'"*"\' origin (explicit or default). Specify explicit trusted origins in \'allowOrigin\'.',
          start: originProp.keyStart,
          end: originProp.value.end,
          fixes: [
            {
              title: 'Replace wildcard "*" allowOrigin with explicit trusted origin',
              kind: 'quickfix',
              isPreferred: true,
              edits: [
                {
                  start: originProp.value.start,
                  end: originProp.value.end,
                  newText: '["https://trusted-origin.example.com"]',
                },
              ],
            },
          ],
        });
      }
    }
  }

  // HANA-SEC-024: force_ssl disabled or omitted when exposed
  const sslProp = findObjectProp(ast, 'force_ssl');
  if (sslProp && sslProp.value.kind === 'boolean' && sslProp.value.value === false) {
    diagnostics.push({
      ruleId: 'HANA-SEC-024',
      category: 'security',
      severity: 'warning',
      message:
        "'force_ssl' is disabled or omitted (defaults to false), permitting plaintext HTTP traffic. Enable '\"force_ssl\": true'.",
      start: sslProp.keyStart,
      end: sslProp.value.end,
      fixes: [
        {
          title: 'Set "force_ssl": true',
          kind: 'quickfix',
          isPreferred: true,
          edits: [{ start: sslProp.value.start, end: sslProp.value.end, newText: 'true' }],
        },
      ],
    });
  } else if (exposedInfo.exposed && !sslProp) {
    diagnostics.push({
      ruleId: 'HANA-SEC-024',
      category: 'security',
      severity: 'warning',
      message:
        "'force_ssl' is disabled or omitted (defaults to false), permitting plaintext HTTP traffic. Enable '\"force_ssl\": true'.",
      start: exposedInfo.propStart,
      end: exposedInfo.propEnd,
      fixes: [
        {
          title: 'Add "force_ssl": true',
          kind: 'quickfix',
          isPreferred: true,
          edits: [buildJsonInsertPropertyEdit(text, ast, 'force_ssl', 'true')],
        },
      ],
    });
  }

  // HANA-SEC-025: authorization: null or missing X-Frame-Options when exposed
  const authzProp = findObjectProp(ast, 'authorization');
  if (authzProp && authzProp.value.kind === 'null') {
    diagnostics.push({
      ruleId: 'HANA-SEC-025',
      category: 'security',
      severity: 'information',
      message:
        '"authorization": null removes parent package authorization requirements for this package and all child packages.',
      start: authzProp.keyStart,
      end: authzProp.value.end,
      fixes: [],
    });
  }

  if (exposedInfo.exposed && !findObjectProp(ast, 'headers') && !hasXFrameOptionsHeader(ast)) {
    const headerPayload =
      '{\n    "enabled": true,\n    "customHeaders": [{ "name": "X-Frame-Options", "value": "SAMEORIGIN" }]\n  }';
    diagnostics.push({
      ruleId: 'HANA-SEC-025',
      category: 'security',
      severity: 'information',
      message: 'Missing X-Frame-Options custom header under "headers" weakens clickjacking defense.',
      start: exposedInfo.propStart,
      end: exposedInfo.propEnd,
      fixes: [
        {
          title: 'Add X-Frame-Options: SAMEORIGIN clickjacking header',
          kind: 'quickfix',
          edits: [buildJsonInsertPropertyEdit(text, ast, 'headers', headerPayload)],
        },
      ],
    });
  }

  return filterSuppressedDiagnostics(text, diagnostics);
}
