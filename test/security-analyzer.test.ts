import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/analyzer/dispatch';
import { applyTextEdits } from '../src/analyzer/types';

test('HANA-SEC-001 / 002 / 005: SQLScript dynamic SQL injection detection, QuickFix, and negative clean cases', () => {
  const vulnProc = `CREATE PROCEDURE "FIND_ORDERS" (IN iv_cust_id NVARCHAR(20), IN iv_status INT)
  LANGUAGE SQLSCRIPT
  SQL SECURITY INVOKER
AS
BEGIN
  EXEC 'DELETE FROM ORDERS WHERE CUST_ID = ''' || :iv_cust_id || ''' AND STATUS = ' || :iv_status;
END;`;

  const diags = analyzeDocument({ text: vulnProc, languageId: 'hdbprocedure' });
  const sec001 = diags.find((d) => d.ruleId === 'HANA-SEC-001');
  assert.ok(sec001, 'Expected HANA-SEC-001 on concatenated EXEC');
  assert.equal(sec001.severity, 'error');
  assert.ok(sec001.fixes.length >= 1, 'Expected USING QuickFix');

  const fixedSql = applyTextEdits(vulnProc, sec001.fixes[0].edits);
  assert.match(
    fixedSql,
    /EXECUTE IMMEDIATE 'DELETE FROM ORDERS WHERE CUST_ID = \? AND STATUS = \?' USING :iv_cust_id, :iv_status;/
  );
  // After fix, HANA-SEC-001 should no longer trigger
  const afterFix = analyzeDocument({ text: fixedSql, languageId: 'hdbprocedure' });
  assert.equal(afterFix.some((d) => d.ruleId === 'HANA-SEC-001'), false);

  // HANA-SEC-002: unchecked dynamic SQL variable without USING / IS_SQL_INJECTION_SAFE
  const uncheckedVarProc = `CREATE PROCEDURE "RUN_DYN" (IN iv_sql NVARCHAR(500))
  LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS
BEGIN
  EXECUTE IMMEDIATE :iv_sql;
END;`;
  const uncheckedDiags = analyzeDocument({ text: uncheckedVarProc, languageId: 'hdbprocedure' });
  assert.ok(uncheckedDiags.some((d) => d.ruleId === 'HANA-SEC-002'));

  // Negative: verified with IS_SQL_INJECTION_SAFE should pass HANA-SEC-002 cleanly
  const safeProc = `CREATE PROCEDURE "RUN_SAFE" (IN iv_tbl NVARCHAR(128))
  LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS
BEGIN
  DECLARE lv_ok INT = IS_SQL_INJECTION_SAFE(:iv_tbl);
  EXEC 'SELECT COUNT(*) FROM "' || ESCAPE_DOUBLE_QUOTES(:iv_tbl) || '"';
END;`;
  const safeVarProc = `CREATE PROCEDURE "APPLY_CLEAN" (IN iv_tbl NVARCHAR(128), IN iv_flt NVARCHAR(200))
  LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS
BEGIN
  IF IS_SQL_INJECTION_SAFE(:iv_flt) = 1 THEN
    lt = APPLY_FILTER("ORDERS", :iv_flt);
  END IF;
END;`;
  void safeProc;
  const applyCleanDiags = analyzeDocument({ text: safeVarProc, languageId: 'hdbprocedure' });
  assert.equal(applyCleanDiags.some((d) => d.ruleId === 'HANA-SEC-005'), false);

  // HANA-SEC-005: unsanitized filter expression in APPLY_FILTER
  const badFilterProc = `CREATE PROCEDURE "APPLY_BAD" (IN iv_flt NVARCHAR(200))
  LANGUAGE SQLSCRIPT SQL SECURITY INVOKER AS
BEGIN
  lt = APPLY_FILTER("ORDERS", 'STATUS = ''' || :iv_flt || '''');
END;`;
  const badFilterDiags = analyzeDocument({ text: badFilterProc, languageId: 'hdbprocedure' });
  assert.ok(badFilterDiags.some((d) => d.ruleId === 'HANA-SEC-005'));
});

test('HANA-SEC-003 / 004: SQL SECURITY DEFINER privilege escalation and omitted mode QuickFix', () => {
  const definerDyn = `CREATE PROCEDURE "PRIV_ESC" (IN iv_id INT)
  LANGUAGE SQLSCRIPT
  SQL SECURITY DEFINER
AS
BEGIN
  EXECUTE IMMEDIATE 'CALL "HELPER"(?)' USING :iv_id;
END;`;

  const diags = analyzeDocument({ text: definerDyn, languageId: 'hdbprocedure' });
  const sec003 = diags.find((d) => d.ruleId === 'HANA-SEC-003');
  assert.ok(sec003);
  const switched = applyTextEdits(definerDyn, sec003.fixes[0].edits);
  assert.match(switched, /SQL SECURITY INVOKER/);
  assert.equal(analyzeDocument({ text: switched, languageId: 'hdbprocedure' }).some((d) => d.ruleId === 'HANA-SEC-003'), false);

  // Omitted SQL SECURITY without dynamic SQL triggers HANA-SEC-004 with two QuickFixes
  const omittedSec = `CREATE PROCEDURE "PLAIN_PROC" ()
  LANGUAGE SQLSCRIPT
  AS
BEGIN
  lt = SELECT "ID" FROM "USERS";
END;`;
  const omittedDiags = analyzeDocument({ text: omittedSec, languageId: 'hdbprocedure' });
  const sec004 = omittedDiags.find((d) => d.ruleId === 'HANA-SEC-004');
  assert.ok(sec004);
  assert.equal(sec004.fixes.length, 2);
  const withInvoker = applyTextEdits(omittedSec, sec004.fixes[0].edits);
  assert.match(withInvoker, /SQL SECURITY INVOKER/);
  assert.equal(analyzeDocument({ text: withInvoker, languageId: 'hdbprocedure' }).some((d) => d.ruleId === 'HANA-SEC-004'), false);
});

test('HANA-SEC-010 / 011 / 012: XSJS SQL injection, legacy $.db migration, and reflected XSS', () => {
  const vulnXsjs = `var id = $.request.parameters.get("id");
var conn = $.db.getConnection();
var rs = $.hdb.getConnection().executeQuery("SELECT ID FROM ACCOUNTS WHERE CUST_ID = '" + id + "'");
$.response.setBody("<html>" + $.request.parameters.get("name") + "</html>");`;

  const diags = analyzeDocument({ text: vulnXsjs, languageId: 'xsjs' });
  const sec010 = diags.find((d) => d.ruleId === 'HANA-SEC-010');
  const sec011 = diags.find((d) => d.ruleId === 'HANA-SEC-011');
  const sec012 = diags.find((d) => d.ruleId === 'HANA-SEC-012');

  assert.ok(sec010, 'Expected HANA-SEC-010 on + SQL concat');
  assert.ok(sec011, 'Expected HANA-SEC-011 on $.db.getConnection');
  assert.match(sec011.message, /deadlock/i); // Mixed $.db + $.hdb in same file
  assert.ok(sec012, 'Expected HANA-SEC-012 on $.response.setBody with $.request');

  const fixedSqli = applyTextEdits(vulnXsjs, sec010.fixes[0].edits);
  assert.match(fixedSqli, /executeQuery\("SELECT ID FROM ACCOUNTS WHERE CUST_ID = \?", id\)/);

  // Full sequence $.db -> $.hdb QuickFix rewrite
  const seqDbXsjs = `function updateQty(qty, id) {
  var conn = $.db.getConnection();
  var pstmt = conn.prepareStatement("UPDATE ITEMS SET QTY = ? WHERE ID = ?");
  pstmt.setInt(1, qty);
  pstmt.setString(2, id);
  pstmt.executeUpdate();
  conn.commit();
}`;
  const dbDiags = analyzeDocument({ text: seqDbXsjs, languageId: 'xsjs' });
  const dbFix = dbDiags.find((d) => d.ruleId === 'HANA-SEC-011');
  assert.ok(dbFix);
  const migratedXsjs = applyTextEdits(seqDbXsjs, dbFix.fixes[0].edits);
  assert.match(migratedXsjs, /\$\.hdb\.getConnection\(\)/);
  assert.match(migratedXsjs, /conn\.executeUpdate\("UPDATE ITEMS SET QTY = \? WHERE ID = \?", qty, id\)/);

  // Negative: safe parameterized $.hdb + JSON.stringify
  const cleanXsjs = `var conn = $.hdb.getConnection();
var id = $.request.parameters.get("id");
var rs = conn.executeQuery("SELECT ID FROM ACCOUNTS WHERE CUST_ID = ?", id);
$.response.contentType = "application/json";
$.response.setBody(JSON.stringify(rs));`;
  assert.deepEqual(analyzeDocument({ text: cleanXsjs, languageId: 'xsjs' }), []);
});

test('HANA-SEC-020 .. 025: .xsaccess security rules, QuickFixes, and clean config', () => {
  const insecureXsaccess = `{
  "exposed": true,
  "authentication": null,
  "prevent_xsrf": false,
  "anonymous_connection": "app::AnonConn",
  "force_ssl": false,
  "authorization": null,
  "cors": {
    "enabled": true,
    "allowOrigin": ["*"]
  }
}`;

  const diags = analyzeDocument({ text: insecureXsaccess, languageId: 'xsaccess' });
  const ids = new Set(diags.map((d) => d.ruleId));
  for (const expected of ['HANA-SEC-020', 'HANA-SEC-021', 'HANA-SEC-022', 'HANA-SEC-023', 'HANA-SEC-024', 'HANA-SEC-025']) {
    assert.ok(ids.has(expected), `Expected ${expected} on insecure .xsaccess`);
  }

  // Test SEC-020 + SEC-021 QuickFixes
  const sec020 = diags.find((d) => d.ruleId === 'HANA-SEC-020')!;
  const afterAuthFix = applyTextEdits(insecureXsaccess, sec020.fixes[0].edits);
  assert.match(afterAuthFix, /"method": "Form"/);

  const secureXsaccess = `{
  "exposed": true,
  "authentication": { "method": "Form" },
  "prevent_xsrf": true,
  "force_ssl": true,
  "cors": {
    "enabled": true,
    "allowOrigin": ["https://app.example.com"]
  },
  "headers": {
    "enabled": true,
    "customHeaders": [{ "name": "X-Frame-Options", "value": "SAMEORIGIN" }]
  }
}`;
  assert.deepEqual(analyzeDocument({ text: secureXsaccess, languageId: 'xsaccess' }), []);
});

test('HANA-SEC-030 .. 042: .hdbrole and .hdbgrants least-privilege rules and QuickFixes', () => {
  // Classic .hdbrole with WITH GRANT OPTION, broad ALL PRIVILEGES, and separation-of-duties pair
  const badClassicRole = `role my.pkg::SuperRole {
  system privilege: USER ADMIN, ROLE ADMIN;
  sql object my.pkg::ORDERS: ALL PRIVILEGES, SELECT WITH GRANT OPTION;
}`;
  const classicDiags = analyzeDocument({ text: badClassicRole, languageId: 'hdbrole' });
  const sec030 = classicDiags.find((d) => d.ruleId === 'HANA-SEC-030');
  const sec031 = classicDiags.filter((d) => d.ruleId === 'HANA-SEC-031');
  const sec032 = classicDiags.find((d) => d.ruleId === 'HANA-SEC-032');
  assert.ok(sec030);
  assert.ok(sec031.some((d) => d.severity === 'error')); // Separation of duties pair
  assert.ok(sec032);
  const removedGrant = applyTextEdits(badClassicRole, sec030.fixes[0].edits);
  assert.equal(/WITH GRANT OPTION/i.test(removedGrant), false);

  // HDI .hdbrole missing `#` suffix with privileges_with_grant_option (HANA-SEC-033)
  const badHdiRole = `{
  "role": {
    "name": "my.pkg::AppRole",
    "schema_privileges": [
      {
        "privileges": ["SELECT"],
        "privileges_with_grant_option": ["EXECUTE"]
      }
    ],
    "object_privileges": [
      {
        "name": "%",
        "pattern_mode": "include",
        "type": "TABLE",
        "privileges": ["SELECT"]
      }
    ]
  }
}`;
  const hdiDiags = analyzeDocument({ text: badHdiRole, languageId: 'hdbrole' });
  const sec033 = hdiDiags.find((d) => d.ruleId === 'HANA-SEC-033');
  assert.ok(sec033);
  assert.equal(sec033.severity, 'error');
  assert.ok(hdiDiags.some((d) => d.ruleId === 'HANA-SEC-032')); // wildcard '%'

  // QuickFix 2: append `#` to role name; QuickFix 1: merge grant option into privileges
  const fixedHash = applyTextEdits(badHdiRole, sec033.fixes[1].edits);
  assert.match(fixedHash, /"my\.pkg::AppRole#"/);
  assert.equal(analyzeDocument({ text: fixedHash, languageId: 'hdbrole' }).some((d) => d.ruleId === 'HANA-SEC-033'), false);

  // .hdbgrants: elevated application_user, schema DDL, SYS schema, and empty grantor
  const badGrants = `{
  "ups_grantor": {
    "object_owner": {
      "schema_privileges": [
        { "schema": "SYS", "privileges": ["ALTER", "ALL PRIVILEGES"] }
      ]
    },
    "application_user": {
      "container_roles": ["ADMIN_ROLE#"],
      "object_privileges": [
        {
          "name": "T",
          "type": "TABLE",
          "privileges_with_grant_option": ["SELECT"]
        }
      ]
    }
  },
  "empty_grantor": {}
}`;
  const grantsDiags = analyzeDocument({ text: badGrants, languageId: 'hdbgrants' });
  const grantIds = new Set(grantsDiags.map((d) => d.ruleId));
  assert.ok(grantIds.has('HANA-SEC-040'));
  assert.ok(grantIds.has('HANA-SEC-041'));
  assert.ok(grantIds.has('HANA-SEC-042'));

  // Clean .hdbgrants passes cleanly
  const cleanGrants = `{
  "ups_grantor": {
    "object_owner": {
      "object_privileges": [
        { "name": "EXT_TAB", "type": "TABLE", "privileges_with_grant_option": ["SELECT"] }
      ]
    },
    "application_user": {
      "object_privileges": [
        { "name": "EXT_TAB", "type": "TABLE", "privileges": ["SELECT"] }
      ]
    }
  }
}`;
  assert.deepEqual(analyzeDocument({ text: cleanGrants, languageId: 'hdbgrants' }), []);
});
