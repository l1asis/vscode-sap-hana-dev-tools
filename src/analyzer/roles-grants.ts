import { isClassicHdbrole, roleTokenize, type RoleToken } from '../formatter/hdbrole';
import {
  findObjectProp,
  parseJsonAst,
  type JsonArrayNode,
  type JsonObjectNode,
  type JsonObjectProperty,
} from './json-parser';
import {
  filterSuppressedDiagnostics,
  type AnalyzerContext,
  type AnalyzerDiagnostic,
  type CodeFixSuggestion,
  type TextEditSpan,
} from './types';

const CRITICAL_SYSTEM_PRIVILEGES = new Set([
  'CATALOG READ',
  'TRACE ADMIN',
  'DEBUG',
  'ATTACH DEBUGGER',
  'ADAPTER ADMIN',
  'AGENT ADMIN',
  'AUDIT ADMIN',
  'AUDIT OPERATOR',
  'BACKUP ADMIN',
  'BACKUP OPERATOR',
  'CERTIFICATE ADMIN',
  'CREATE REMOTE SOURCE',
  'CREDENTIAL ADMIN',
  'ENCRYPTION ROOT KEY ADMIN',
  'EXTENDED STORAGE ADMIN',
  'INIFILE ADMIN',
  'LDAP ADMIN',
  'LICENSE ADMIN',
  'LOG ADMIN',
  'MONITOR ADMIN',
  'OPTIMIZER ADMIN',
  'RESOURCE ADMIN',
  'SAVEPOINT ADMIN',
  'SERVICE ADMIN',
  'SESSION ADMIN',
  'SSL ADMIN',
  'TABLE ADMIN',
  'TRUST ADMIN',
  'VERSION ADMIN',
  'WORKLOAD ADMIN',
  'USER ADMIN',
  'ROLE ADMIN',
  'SCENARIO ADMIN',
  'STRUCTUREDPRIVILEGE ADMIN',
  'DATA ADMIN',
]);

const CRITICAL_PRIVILEGE_PAIRS: readonly (readonly [string, string])[] = [
  ['USER ADMIN', 'ROLE ADMIN'],
  ['CREATE SCENARIO', 'SCENARIO ADMIN'],
  ['AUDIT ADMIN', 'AUDIT OPERATOR'],
  ['CREATE STRUCTURED PRIVILEGE', 'STRUCTUREDPRIVILEGE ADMIN'],
];

const HIGH_PRIVILEGE_ROLES = new Set([
  'CONTENT_ADMIN',
  'MODELING',
  'SAP_INTERNAL_HANA_SUPPORT',
  '_SYS_BI_CP_ALL',
]);

const BROAD_WRITE_DDL_PRIVS = new Set([
  'ALL PRIVILEGES',
  'CREATE ANY',
  'ALTER',
  'DROP',
  'INSERT',
  'UPDATE',
  'DELETE',
  'UNMASKED',
]);

const APP_USER_ELEVATED_PRIVS = new Set([
  'ALTER',
  'CREATE ANY',
  'DROP',
  'TRIGGER',
  'INDEX',
  'DEBUG',
  'UNMASKED',
  'ALL PRIVILEGES',
]);

function extractStringItems(arr: JsonArrayNode): Array<{ value: string; start: number; end: number }> {
  const out: Array<{ value: string; start: number; end: number }> = [];
  for (const item of arr.items) {
    if (item.kind === 'string') {
      out.push({ value: String(item.value), start: item.start, end: item.end });
    }
  }
  return out;
}

/**
 * Deletes a JSON property cleanly including its adjacent comma and horizontal whitespace.
 */
function buildDeleteJsonPropertyEdit(
  text: string,
  obj: JsonObjectNode,
  prop: JsonObjectProperty
): TextEditSpan {
  const idx = obj.properties.indexOf(prop);
  const props = obj.properties;
  if (props.length === 1) {
    return { start: prop.entryStart, end: prop.entryEnd, newText: '' };
  }
  if (idx < props.length - 1) {
    // Delete through comma after prop up to start of next prop
    const nextProp = props[idx + 1];
    return { start: prop.entryStart, end: nextProp.entryStart, newText: '' };
  }
  // Last property: delete from end of previous property to end of this property
  const prevProp = props[idx - 1];
  return { start: prevProp.entryEnd, end: prop.entryEnd, newText: '' };
}

/**
 * Converts `"privileges_with_grant_option"` into `"privileges"` (merging into existing array if present).
 */
function buildRenameGrantOptionToPrivilegesEdit(
  text: string,
  obj: JsonObjectNode,
  grantOptProp: JsonObjectProperty
): TextEditSpan[] {
  const privProp = findObjectProp(obj, 'privileges');
  if (!privProp || privProp.value.kind !== 'array' || grantOptProp.value.kind !== 'array') {
    return [
      {
        start: grantOptProp.keyStart,
        end: grantOptProp.keyEnd,
        newText: '"privileges"',
      },
    ];
  }

  const existing = extractStringItems(privProp.value).map((s) => s.value);
  const grantable = extractStringItems(grantOptProp.value).map((s) => s.value);
  const merged = [...new Set([...existing, ...grantable])];
  const serialized = `[${merged.map((v) => JSON.stringify(v)).join(', ')}]`;
  return [
    { start: privProp.value.start, end: privProp.value.end, newText: serialized },
    buildDeleteJsonPropertyEdit(text, obj, grantOptProp),
  ];
}

function analyzeClassicHdbrole(text: string, diagnostics: AnalyzerDiagnostic[]): void {
  const tokens = roleTokenize(text).filter(
    (t) => t.type !== 'lineComment' && t.type !== 'blockComment' && t.type !== 'raw'
  );
  if (tokens.length === 0) return;

  // Split statements by `;` or `{`/`}` header delimiters
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

  const collectedSystemPrivs = new Map<string, { start: number; end: number }>();

  for (const stmt of stmts) {
    if (stmt.length === 0) continue;
    const colonIdx = stmt.findIndex((t) => t.type === 'colon');
    const headWords = (colonIdx >= 0 ? stmt.slice(0, colonIdx) : stmt)
      .map((t) => t.text.toUpperCase())
      .join(' ');

    // HANA-SEC-030: WITH GRANT OPTION
    for (let i = 0; i + 2 < stmt.length; i++) {
      if (
        stmt[i].text.toUpperCase() === 'WITH' &&
        stmt[i + 1].text.toUpperCase() === 'GRANT' &&
        stmt[i + 2].text.toUpperCase() === 'OPTION'
      ) {
        let delStart = stmt[i].start;
        while (delStart > 0 && (text[delStart - 1] === ' ' || text[delStart - 1] === '\t')) {
          delStart--;
        }
        diagnostics.push({
          ruleId: 'HANA-SEC-030',
          category: 'security',
          severity: 'warning',
          message:
            "'WITH GRANT OPTION' / 'privileges_with_grant_option' allows grantees to redistribute privileges. Restrict grantable roles to container object owners or remove grant option.",
          start: stmt[i].start,
          end: stmt[i + 2].end,
          fixes: [
            {
              title: 'Remove WITH GRANT OPTION',
              kind: 'quickfix',
              isPreferred: true,
              edits: [{ start: delStart, end: stmt[i + 2].end, newText: '' }],
            },
          ],
        });
      }
    }

    // Parse comma-separated items after colon (stripping trailing WITH GRANT OPTION)
    if (colonIdx !== -1) {
      let endIdx = stmt.length;
      if (
        endIdx >= 3 &&
        stmt[endIdx - 3].text.toUpperCase() === 'WITH' &&
        stmt[endIdx - 2].text.toUpperCase() === 'GRANT' &&
        stmt[endIdx - 1].text.toUpperCase() === 'OPTION'
      ) {
        endIdx -= 3;
      }
      const rhsGroups: RoleToken[][] = [];
      let g: RoleToken[] = [];
      for (let i = colonIdx + 1; i < endIdx; i++) {
        if (stmt[i].type === 'comma') {
          if (g.length > 0) rhsGroups.push(g);
          g = [];
        } else {
          g.push(stmt[i]);
        }
      }
      if (g.length > 0) rhsGroups.push(g);

      for (const group of rhsGroups) {
        const privUpper = group.map((t) => t.text.replace(/^"|"$/g, '')).join(' ').toUpperCase();
        const spanStart = group[0].start;
        const spanEnd = group[group.length - 1].end;

        if (headWords.startsWith('SYSTEM PRIVILEGE')) {
          collectedSystemPrivs.set(privUpper, { start: spanStart, end: spanEnd });
          if (CRITICAL_SYSTEM_PRIVILEGES.has(privUpper)) {
            diagnostics.push({
              ruleId: 'HANA-SEC-031',
              category: 'security',
              severity: 'warning',
              message: `Role assigns high-privilege system permission or unrestricted catalog role ('${privUpper}'). Follow least privilege and separation of duties.`,
              start: spanStart,
              end: spanEnd,
              fixes: [],
            });
          }
        } else if (headWords.startsWith('ANALYTIC PRIVILEGE') || headWords.startsWith('CATALOG ANALYTIC PRIVILEGE')) {
          if (HIGH_PRIVILEGE_ROLES.has(privUpper)) {
            diagnostics.push({
              ruleId: 'HANA-SEC-031',
              category: 'security',
              severity: 'warning',
              message: `Role assigns high-privilege system permission or unrestricted catalog role ('${privUpper}'). Follow least privilege and separation of duties.`,
              start: spanStart,
              end: spanEnd,
              fixes: [],
            });
          }
        } else if (
          headWords.startsWith('SCHEMA') ||
          headWords.startsWith('CATALOG SCHEMA') ||
          headWords.startsWith('SQL OBJECT') ||
          headWords.startsWith('CATALOG SQL OBJECT')
        ) {
          if (
            privUpper === 'ALL PRIVILEGES' ||
            privUpper === 'CREATE ANY' ||
            privUpper === 'ALTER' ||
            privUpper === 'DROP'
          ) {
            diagnostics.push({
              ruleId: 'HANA-SEC-032',
              category: 'security',
              severity: 'warning',
              message: `Overly broad privilege grant ('${privUpper}'). Grant specific privileges on explicit objects instead of ALL PRIVILEGES, schema-wide DML/DDL, or '%' wildcards.`,
              start: spanStart,
              end: spanEnd,
              fixes: [],
            });
          }
        }
      }
    } else if (headWords.startsWith('EXTENDS CATALOG ROLE')) {
      const roleTok = stmt[stmt.length - 1];
      const roleUpper = roleTok.text.replace(/^"|"$/g, '').toUpperCase();
      if (HIGH_PRIVILEGE_ROLES.has(roleUpper)) {
        diagnostics.push({
          ruleId: 'HANA-SEC-031',
          category: 'security',
          severity: roleUpper === 'SAP_INTERNAL_HANA_SUPPORT' ? 'error' : 'warning',
          message: `Role assigns high-privilege system permission or unrestricted catalog role ('${roleUpper}'). Follow least privilege and separation of duties.`,
          start: roleTok.start,
          end: roleTok.end,
          fixes: [],
        });
      }
    }
  }

  // Check Separation of Duties critical privilege pairs
  for (const [p1, p2] of CRITICAL_PRIVILEGE_PAIRS) {
    const s1 = collectedSystemPrivs.get(p1);
    const s2 = collectedSystemPrivs.get(p2);
    if (s1 && s2) {
      diagnostics.push({
        ruleId: 'HANA-SEC-031',
        category: 'security',
        severity: 'error',
        message: `Role assigns high-privilege system permission or unrestricted catalog role ('${p1} + ${p2}'). Follow least privilege and separation of duties.`,
        start: s2.start,
        end: s2.end,
        fixes: [],
      });
    }
  }
}

function analyzeHdiHdbrole(text: string, diagnostics: AnalyzerDiagnostic[]): void {
  const ast = parseJsonAst(text);
  if (!ast || ast.kind !== 'object') return;
  const roleProp = findObjectProp(ast, 'role');
  if (!roleProp || roleProp.value.kind !== 'object') return;
  const roleObj = roleProp.value;

  const nameProp = findObjectProp(roleObj, 'name');
  const roleName = nameProp && nameProp.value.kind === 'string' ? String(nameProp.value.value) : '';
  const hasHashSuffix = roleName.endsWith('#');

  const collectedSystemPrivs = new Map<string, { start: number; end: number }>();
  const grantOptionRefs: Array<{ obj: JsonObjectNode; prop: JsonObjectProperty }> = [];

  // 1. system_privileges
  const sysPrivs = findObjectProp(roleObj, 'system_privileges');
  if (sysPrivs && sysPrivs.value.kind === 'array') {
    for (const item of extractStringItems(sysPrivs.value)) {
      const u = item.value.toUpperCase();
      collectedSystemPrivs.set(u, { start: item.start, end: item.end });
      if (CRITICAL_SYSTEM_PRIVILEGES.has(u)) {
        diagnostics.push({
          ruleId: 'HANA-SEC-031',
          category: 'security',
          severity: 'warning',
          message: `Role assigns high-privilege system permission or unrestricted catalog role ('${u}'). Follow least privilege and separation of duties.`,
          start: item.start,
          end: item.end,
          fixes: [],
        });
      }
    }
  }

  for (const [p1, p2] of CRITICAL_PRIVILEGE_PAIRS) {
    const s1 = collectedSystemPrivs.get(p1);
    const s2 = collectedSystemPrivs.get(p2);
    if (s1 && s2) {
      diagnostics.push({
        ruleId: 'HANA-SEC-031',
        category: 'security',
        severity: 'error',
        message: `Role assigns high-privilege system permission or unrestricted catalog role ('${p1} + ${p2}'). Follow least privilege and separation of duties.`,
        start: s2.start,
        end: s2.end,
        fixes: [],
      });
    }
  }

  // 2. global_roles
  const globalRoles = findObjectProp(roleObj, 'global_roles');
  if (globalRoles && globalRoles.value.kind === 'array') {
    for (const item of globalRoles.value.items) {
      const names =
        item.kind === 'string'
          ? [{ value: String(item.value), start: item.start, end: item.end }]
          : item.kind === 'object' && findObjectProp(item, 'names')?.value.kind === 'array'
            ? extractStringItems(findObjectProp(item, 'names')!.value as JsonArrayNode)
            : [];
      for (const n of names) {
        const u = n.value.toUpperCase();
        if (HIGH_PRIVILEGE_ROLES.has(u)) {
          diagnostics.push({
            ruleId: 'HANA-SEC-031',
            category: 'security',
            severity: u === 'SAP_INTERNAL_HANA_SUPPORT' ? 'error' : 'warning',
            message: `Role assigns high-privilege system permission or unrestricted catalog role ('${u}'). Follow least privilege and separation of duties.`,
            start: n.start,
            end: n.end,
            fixes: [],
          });
        }
      }
    }
  }

  // 3. Privilege arrays (schema_privileges, object_privileges, global_object_privileges, schema_analytic_privileges)
  const sections: readonly string[] = [
    'schema_privileges',
    'object_privileges',
    'global_object_privileges',
    'schema_analytic_privileges',
  ];

  for (const secKey of sections) {
    const secProp = findObjectProp(roleObj, secKey);
    if (!secProp || secProp.value.kind !== 'array') continue;

    for (const item of secProp.value.items) {
      if (item.kind !== 'object') continue;

      const grantOpt = findObjectProp(item, 'privileges_with_grant_option');
      if (grantOpt && grantOpt.value.kind === 'array' && grantOpt.value.items.length > 0) {
        grantOptionRefs.push({ obj: item, prop: grantOpt });
        const fixEdits = buildRenameGrantOptionToPrivilegesEdit(text, item, grantOpt);
        diagnostics.push({
          ruleId: 'HANA-SEC-030',
          category: 'security',
          severity: 'warning',
          message:
            "'WITH GRANT OPTION' / 'privileges_with_grant_option' allows grantees to redistribute privileges. Restrict grantable roles to container object owners or remove grant option.",
          start: grantOpt.keyStart,
          end: grantOpt.value.end,
          fixes: [
            {
              title: "Convert 'privileges_with_grant_option' to standard 'privileges'",
              kind: 'quickfix',
              isPreferred: true,
              edits: fixEdits,
            },
          ],
        });
      }

      // Broad schema/object privileges (HANA-SEC-032)
      for (const keyName of ['privileges', 'privileges_with_grant_option'] as const) {
        const privList = findObjectProp(item, keyName);
        if (!privList || privList.value.kind !== 'array') continue;
        for (const p of extractStringItems(privList.value)) {
          const u = p.value.toUpperCase();
          if (
            u === 'ALL PRIVILEGES' ||
            u === 'CREATE ANY' ||
            (secKey === 'schema_privileges' && BROAD_WRITE_DDL_PRIVS.has(u))
          ) {
            diagnostics.push({
              ruleId: 'HANA-SEC-032',
              category: 'security',
              severity: 'warning',
              message: `Overly broad privilege grant ('${u}'). Grant specific privileges on explicit objects instead of ALL PRIVILEGES, schema-wide DML/DDL, or '%' wildcards.`,
              start: p.start,
              end: p.end,
              fixes: [],
            });
          }
        }
      }

      // Wildcard '%' name with pattern_mode: include
      if (secKey === 'object_privileges') {
        const objNameProp = findObjectProp(item, 'name');
        const patMode = findObjectProp(item, 'pattern_mode');
        if (
          objNameProp &&
          objNameProp.value.kind === 'string' &&
          objNameProp.value.value === '%' &&
          patMode &&
          patMode.value.kind === 'string' &&
          String(patMode.value.value).toLowerCase() === 'include'
        ) {
          diagnostics.push({
            ruleId: 'HANA-SEC-032',
            category: 'security',
            severity: 'warning',
            message:
              "Overly broad privilege grant ('pattern_mode: include' with '%'). Grant specific privileges on explicit objects instead of ALL PRIVILEGES, schema-wide DML/DDL, or '%' wildcards.",
            start: objNameProp.keyStart,
            end: objNameProp.value.end,
            fixes: [],
          });
        }
      }
    }
  }

  // roles_with_admin_option on role root
  const adminOpt = findObjectProp(roleObj, 'roles_with_admin_option');
  if (adminOpt && adminOpt.value.kind === 'array' && adminOpt.value.items.length > 0) {
    diagnostics.push({
      ruleId: 'HANA-SEC-030',
      category: 'security',
      severity: 'warning',
      message:
        "'roles_with_admin_option' allows grantees to redistribute roles. Remove admin option unless strictly required for container owner administration.",
      start: adminOpt.keyStart,
      end: adminOpt.value.end,
      fixes: [],
    });
  }

  // HANA-SEC-033: HDI `#` suffix required when privileges_with_grant_option is present
  if (grantOptionRefs.length > 0 && nameProp && nameProp.value.kind === 'string' && !hasHashSuffix) {
    const mergeAllEdits = grantOptionRefs.flatMap((r) =>
      buildRenameGrantOptionToPrivilegesEdit(text, r.obj, r.prop)
    );
    const fixes: CodeFixSuggestion[] = [
      {
        title: "Convert 'privileges_with_grant_option' to standard 'privileges'",
        kind: 'quickfix',
        edits: mergeAllEdits,
      },
      {
        title: `Append '#' suffix to role name ('${roleName}#')`,
        kind: 'quickfix',
        isPreferred: true,
        edits: [
          {
            start: nameProp.value.start,
            end: nameProp.value.end,
            newText: JSON.stringify(`${roleName}#`),
          },
        ],
      },
    ];

    diagnostics.push({
      ruleId: 'HANA-SEC-033',
      category: 'security',
      severity: 'error',
      message:
        "HDI roles with 'privileges_with_grant_option' must have a role name ending with '#' (only grantable to container object owner '#OO').",
      start: nameProp.value.start,
      end: nameProp.value.end,
      fixes,
    });
  }
}

function analyzeHdbgrantsOrRevokes(
  text: string,
  languageId: string,
  diagnostics: AnalyzerDiagnostic[]
): void {
  const ast = parseJsonAst(text);
  if (!ast || ast.kind !== 'object') return;

  for (const serviceProp of ast.properties) {
    if (serviceProp.value.kind !== 'object') continue;
    const grantorObj = serviceProp.value;
    const objOwner = findObjectProp(grantorObj, 'object_owner');
    const appUser = findObjectProp(grantorObj, 'application_user');

    // HANA-SEC-042: Empty grantor block missing both object_owner & application_user
    if (!objOwner && !appUser) {
      diagnostics.push({
        ruleId: 'HANA-SEC-042',
        category: 'security',
        severity: 'information',
        message: "Grantor entry should define at least one of 'object_owner' or 'application_user'.",
        start: serviceProp.keyStart,
        end: serviceProp.keyEnd,
        fixes: [],
      });
    }

    const targets: Array<{ kind: 'object_owner' | 'application_user'; node: JsonObjectNode }> = [];
    if (objOwner?.value.kind === 'object') {
      targets.push({ kind: 'object_owner', node: objOwner.value });
    }
    if (appUser?.value.kind === 'object') {
      targets.push({ kind: 'application_user', node: appUser.value });
    }

    for (const target of targets) {
      const targetNode = target.node;
      const isAppUser = target.kind === 'application_user';

      // Check system_privileges inside .hdbgrants (HANA-SEC-041)
      const sysPrivs = findObjectProp(targetNode, 'system_privileges');
      if (sysPrivs && sysPrivs.value.kind === 'array' && sysPrivs.value.items.length > 0 && languageId === 'hdbgrants') {
        diagnostics.push({
          ruleId: 'HANA-SEC-041',
          category: 'security',
          severity: 'warning',
          message:
            'Avoid granting ALL PRIVILEGES, CREATE ANY, or schema-wide modification rights in .hdbgrants; enumerate explicit object_privileges or least-privilege roles.',
          start: sysPrivs.keyStart,
          end: sysPrivs.value.end,
          fixes: [],
        });
      }

      // Check role arrays in application_user for `#` / `#OO` / admin option (HANA-SEC-040)
      if (isAppUser) {
        const rolesAdminOpt = findObjectProp(targetNode, 'roles_with_admin_option');
        if (rolesAdminOpt && rolesAdminOpt.value.kind === 'array' && rolesAdminOpt.value.items.length > 0) {
          diagnostics.push({
            ruleId: 'HANA-SEC-040',
            category: 'security',
            severity: 'warning',
            message:
              "'application_user' receives elevated privileges (roles_with_admin_option). Keep runtime application users read/execute-scoped and restrict '#'/WITH GRANT OPTION to 'object_owner'.",
            start: rolesAdminOpt.keyStart,
            end: rolesAdminOpt.value.end,
            fixes: [],
          });
        }
        for (const rKey of ['roles', 'container_roles', 'global_roles'] as const) {
          const rProp = findObjectProp(targetNode, rKey);
          if (!rProp || rProp.value.kind !== 'array') continue;
          for (const item of extractStringItems(rProp.value)) {
            if (item.value.endsWith('#') || item.value.includes('#OO')) {
              diagnostics.push({
                ruleId: 'HANA-SEC-040',
                category: 'security',
                severity: 'warning',
                message: `'application_user' receives elevated privileges (${item.value}). Keep runtime application users read/execute-scoped and restrict '#'/WITH GRANT OPTION to 'object_owner'.`,
                start: item.start,
                end: item.end,
                fixes: [],
              });
            }
          }
        }
      }

      for (const secKey of ['schema_privileges', 'object_privileges', 'schema_analytic_privileges'] as const) {
        const secProp = findObjectProp(targetNode, secKey);
        if (!secProp || secProp.value.kind !== 'array') continue;

        for (const entry of secProp.value.items) {
          if (entry.kind !== 'object') continue;

          // HANA-SEC-042: SYS / _SYS_REPO schema check
          const schemaProp = findObjectProp(entry, 'schema');
          if (schemaProp && schemaProp.value.kind === 'string') {
            const schemaName = String(schemaProp.value.value).toUpperCase();
            if (schemaName === 'SYS' || schemaName === '_SYS_REPO') {
              const pProp = findObjectProp(entry, 'privileges');
              const privs = pProp?.value.kind === 'array' ? extractStringItems(pProp.value).map((x) => x.value.toUpperCase()) : [];
              const hasNonSelect = privs.some((pv) => pv !== 'SELECT');
              diagnostics.push({
                ruleId: 'HANA-SEC-042',
                category: 'security',
                severity: hasNonSelect ? 'warning' : 'information',
                message:
                  "External grant targets system schema 'SYS'/'_SYS_REPO'. Verify minimal SELECT-only metadata privileges.",
                start: schemaProp.keyStart,
                end: schemaProp.value.end,
                fixes: [],
              });
            }
          }

          // privileges_with_grant_option on application_user -> HANA-SEC-040 + QuickFix
          const grantOpt = findObjectProp(entry, 'privileges_with_grant_option');
          if (isAppUser && grantOpt && grantOpt.value.kind === 'array' && grantOpt.value.items.length > 0) {
            diagnostics.push({
              ruleId: 'HANA-SEC-040',
              category: 'security',
              severity: 'warning',
              message:
                "'application_user' receives elevated privileges (privileges_with_grant_option). Keep runtime application users read/execute-scoped and restrict '#'/WITH GRANT OPTION to 'object_owner'.",
              start: grantOpt.keyStart,
              end: grantOpt.value.end,
              fixes: [
                {
                  title: "Convert 'privileges_with_grant_option' to standard 'privileges'",
                  kind: 'quickfix',
                  isPreferred: true,
                  edits: buildRenameGrantOptionToPrivilegesEdit(text, entry, grantOpt),
                },
              ],
            });
          }

          for (const keyName of ['privileges', 'privileges_with_grant_option'] as const) {
            const pProp = findObjectProp(entry, keyName);
            if (!pProp || pProp.value.kind !== 'array') continue;
            for (const p of extractStringItems(pProp.value)) {
              const u = p.value.toUpperCase();
              if (isAppUser && APP_USER_ELEVATED_PRIVS.has(u)) {
                diagnostics.push({
                  ruleId: 'HANA-SEC-040',
                  category: 'security',
                  severity: 'warning',
                  message: `'application_user' receives elevated privileges (${u}). Keep runtime application users read/execute-scoped and restrict '#'/WITH GRANT OPTION to 'object_owner'.`,
                  start: p.start,
                  end: p.end,
                  fixes: [],
                });
              }

              if (
                u === 'ALL PRIVILEGES' ||
                u === 'CREATE ANY' ||
                (secKey === 'schema_privileges' && (u === 'INSERT' || u === 'UPDATE' || u === 'DELETE' || u === 'ALTER'))
              ) {
                diagnostics.push({
                  ruleId: 'HANA-SEC-041',
                  category: 'security',
                  severity: 'warning',
                  message:
                    'Avoid granting ALL PRIVILEGES, CREATE ANY, or schema-wide modification rights in .hdbgrants; enumerate explicit object_privileges or least-privilege roles.',
                  start: p.start,
                  end: p.end,
                  fixes: [],
                });
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Analyzes `.hdbrole`, `.hdbgrants`, and `.hdbrevokes` authorization artifacts.
 */
export function analyzeRolesAndGrants(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { text, languageId, options } = ctx;
  if (options?.security === false) return [];

  const diagnostics: AnalyzerDiagnostic[] = [];
  if (languageId === 'hdbrole') {
    if (isClassicHdbrole(text)) {
      analyzeClassicHdbrole(text, diagnostics);
    } else {
      analyzeHdiHdbrole(text, diagnostics);
    }
  } else if (languageId === 'hdbgrants' || languageId === 'hdbrevokes') {
    analyzeHdbgrantsOrRevokes(text, languageId, diagnostics);
  }

  return filterSuppressedDiagnostics(text, diagnostics);
}

/**
 * Analyzes `.xsodata` files for XSC -> XSA migration issues (`HANA-MIG-011`).
 */
export function analyzeXsodata(ctx: AnalyzerContext): AnalyzerDiagnostic[] {
  const { text, options } = ctx;
  if (options?.migration === false || options?.targetPlatform === 'xsc') return [];

  const diagnostics: AnalyzerDiagnostic[] = [];
  // Match string literals referencing XSC calculation views or _SYS_BIC schema paths
  const strRe = /"([^"\r\n]+)"(?:\s*\.\s*"([^"\r\n]+)")?/g;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(text)) !== null) {
    const first = m[1];
    const second = m[2];
    if (second !== undefined) {
      if (first.toUpperCase() === '_SYS_BIC') {
        const hdiRef = `"${second.replace(/\//g, '::')}"`;
        diagnostics.push({
          ruleId: 'HANA-MIG-011',
          category: 'migration',
          severity: 'warning',
          message: `Hardcoded _SYS_BIC reference '${m[0]}' in .xsodata. Replace with container object '${hdiRef}'.`,
          start: m.index,
          end: m.index + m[0].length,
          fixes: [
            {
              title: `Replace '${m[0]}' with '${hdiRef}'`,
              kind: 'quickfix',
              isPreferred: true,
              edits: [{ start: m.index, end: m.index + m[0].length, newText: hdiRef }],
            },
          ],
        });
      }
      continue;
    }

    if (first.includes('/') && /\.(?:calculationview|attributeview|analyticview)$/i.test(first)) {
      const bare = first.replace(/\.(?:calculationview|attributeview|analyticview)$/i, '');
      const hdiRef = `"${bare.replace(/\//g, '::')}"`;
      diagnostics.push({
        ruleId: 'HANA-MIG-011',
        category: 'migration',
        severity: 'warning',
        message: `XSC repository view path '${m[0]}' is incompatible with HDI. Replace with runtime object '${hdiRef}'.`,
        start: m.index,
        end: m.index + m[0].length,
        fixes: [
          {
            title: `Replace with '${hdiRef}'`,
            kind: 'quickfix',
            isPreferred: true,
            edits: [{ start: m.index, end: m.index + m[0].length, newText: hdiRef }],
          },
        ],
      });
    }
  }

  return filterSuppressedDiagnostics(text, diagnostics);
}
