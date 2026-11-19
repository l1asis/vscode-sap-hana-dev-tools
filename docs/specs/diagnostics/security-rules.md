# SAP HANA Security Diagnostics & Refactoring Specification

> **Status:** Authoritative Specification (Phase 3)
> **Rule Namespace:** `HANA-SEC-001` – `HANA-SEC-042`
> **Platforms:** `[XSC]` `[XSA]` `[HDI]` `[CLOUD]`
>
> **Sources:**
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/008_6_Logic_Container.md` (Pages 65–138)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/010_8_Imperative_SQLScript_Logic.md` (Pages 220–265)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/016_14_Supportability.md` (Pages 445–470)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md` (Pages 85–112)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/011_9_Writing_Server-Side_JavaScript_Code.md` (Pages 533–555)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Security_Checklists_and_Recommendations_en/004_2_SAP_HANA_Database_Checklists_and_Recommendations.md` (Pages 5–22)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Security_Guide_en/010_8_SAP_HANA_Authorization.md` (Pages 144–220)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Security_Guide_en/020_18_Security_for_SAP_HANA_Deployment_Infrastructure_(HDI).md` (Pages 355–365)
> - `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md` (Pages 307–320)
> - `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/001_pages_1_30.md` (Pages 18–25)

---

## 1. Rule Index

| Rule ID | Severity | Platforms | Target Extensions | QuickFix | Summary |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `HANA-SEC-001` | `Error` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary` | Yes | Unparameterized dynamic SQL string concatenation (`||`) in `EXEC` / `EXECUTE IMMEDIATE`. |
| `HANA-SEC-002` | `Warning` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary` | Partial | Dynamic SQL variable/identifier input without `IS_SQL_INJECTION_SAFE` or `ESCAPE_*_QUOTES`. |
| `HANA-SEC-003` | `Warning` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction` | Yes | `SQL SECURITY DEFINER` (explicit or implicit) combined with dynamic SQL (`EXEC` / `EXECUTE IMMEDIATE`). |
| `HANA-SEC-004` | `Information` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction` | Yes | Omitted `SQL SECURITY` clause defaults to `DEFINER`. |
| `HANA-SEC-005` | `Warning` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.sql`, `.hdbprocedure`, `.hdbfunction` | No | Concatenated or unvalidated filter string passed to `APPLY_FILTER(...)`. |
| `HANA-SEC-010` | `Error` | `[XSC]` | `.xsjs`, `.xsjslib` | Yes | SQL injection via `+` concatenation or template interpolation in `prepareStatement` / `executeQuery` / `executeUpdate`. |
| `HANA-SEC-011` | `Warning` | `[XSC]` | `.xsjs`, `.xsjslib` | Yes | Legacy `$.db.getConnection()` API or mixed `$.db` + `$.hdb` transactions. |
| `HANA-SEC-012` | `Warning` | `[XSC]` | `.xsjs`, `.xsjslib` | No | Reflected XSS sink: request input passed directly into `$.response.setBody(...)`. |
| `HANA-SEC-020` | `Error` | `[XSC]` | `.xsaccess` | Yes | `"exposed": true` with `"authentication": null` or omitted authentication. |
| `HANA-SEC-021` | `Warning` | `[XSC]` | `.xsaccess` | Yes | `"prevent_xsrf": false` or omitted on exposed package (default is `false`). |
| `HANA-SEC-022` | `Warning` | `[XSC]` | `.xsaccess` | No | `"anonymous_connection"` or `"default_connection"` enables unauthenticated/shared technical DB access. |
| `HANA-SEC-023` | `Warning` | `[XSC]` | `.xsaccess` | Yes | Wildcard CORS `"allowOrigin": ["*"]` or omitted `allowOrigin` when `"cors.enabled": true`. |
| `HANA-SEC-024` | `Warning` | `[XSC]` | `.xsaccess` | Yes | `"force_ssl": false` or omitted on exposed package (permits plaintext HTTP). |
| `HANA-SEC-025` | `Information` | `[XSC]` | `.xsaccess` | Yes | `"authorization": null` or missing `X-Frame-Options` clickjacking header. |
| `HANA-SEC-030` | `Warning` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.hdbrole` | Yes | `WITH GRANT OPTION` or `"privileges_with_grant_option"` delegation in role definition. |
| `HANA-SEC-031` | `Warning` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.hdbrole` | No | Privileged administrative system privilege, critical privilege pair, or high-privilege catalog role. |
| `HANA-SEC-032` | `Warning` | `[XSC]` `[XSA]` `[HDI]` `[CLOUD]` | `.hdbrole` | No | Overly broad `ALL PRIVILEGES`, schema-wide write/DDL privilege, or `"%"` wildcard grant. |
| `HANA-SEC-033` | `Error` | `[XSA]` `[HDI]` `[CLOUD]` | `.hdbrole` | Yes | HDI `.hdbrole` `"privileges_with_grant_option"` requires role name suffix `#` (and `#` roles apply only to `#OO`). |
| `HANA-SEC-040` | `Warning` | `[XSA]` `[HDI]` `[CLOUD]` | `.hdbgrants` | No | Over-privileged `"application_user"` block (DDL, write privileges, `*_with_grant_option`, or `roles_with_admin_option`). |
| `HANA-SEC-041` | `Warning` | `[XSA]` `[HDI]` `[CLOUD]` | `.hdbgrants` | No | `"ALL PRIVILEGES"` or broad `"schema_privileges"` granted in `.hdbgrants`. |
| `HANA-SEC-042` | `Information` | `[XSA]` `[HDI]` `[CLOUD]` | `.hdbgrants`, `.hdbrevokes` | No | Granting on `SYS` schema or invalid/empty grantor structure. |

---

## 2. SQLScript Security Rules (`HANA-SEC-001` – `HANA-SEC-005`)

> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/010_8_Imperative_SQLScript_Logic.md` (Pages 222–235, 290–298)
> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_SQL_Script_Reference_en/016_14_Supportability.md` (Pages 451–454)

### SQLScript Security Reference Grammar

```ebnf
exec_stmt               ::= ( 'EXEC' | 'EXECUTE' 'IMMEDIATE' ) <sql_string_expr>
                            [ 'INTO' <var_name_list> [ 'DEFAULT' <expr_list> ] ]
                            [ 'USING' <expr_list> ] ;

create_logic_header     ::= 'CREATE' [ 'OR' 'REPLACE' ] ( 'PROCEDURE' | 'FUNCTION' ) <obj_name>
                            [ '(' <param_list> ')' ]
                            [ 'RETURNS' <return_type> ]
                            [ 'LANGUAGE' ( 'SQLSCRIPT' | 'R' ) ]
                            [ 'SQL' 'SECURITY' ( 'DEFINER' | 'INVOKER' ) ]
                            [ 'DEFAULT' 'SCHEMA' <schema_name> ]
                            [ 'READS' 'SQL' 'DATA' ] ;
```

Rules enforced by SAP HANA SQLScript compiler:
- `?` placeholders bind positional expressions from `USING <expr_list>`.
- `?<n>` and `:<var_name>` bind-variable forms **cannot** be mixed in the same dynamic SQL string.
- `?` placeholders are valid only for scalar value expressions (literals/column values), not SQL identifiers (schema/table/column names).
- Clause order and binding mistakes are syntax errors, reported by `HANA-SYN-042` / `HANA-SYN-043` (`syntax-rules.md`), not by the security rules.

---

### `HANA-SEC-001` Dynamic SQL Concatenation (`EXEC` / `EXECUTE IMMEDIATE`)
- **Severity:** `Error` (CWE-89)
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary`
- **AST / Lexical Trigger:**
  - `EXEC` or `EXECUTE IMMEDIATE` statement whose SQL argument expression contains `||` concatenation combining string literals and SQLScript variables (`:var`, local identifiers), OR a string variable `EXEC :lv_sql` / `EXECUTE IMMEDIATE :lv_sql` initialized via `||` within the same block without parameterization.
  - Suppression: Exempt if preceded by `@AnalyzerSuppress('SAP.USE_OF_DYNAMIC_SQL.SECURITY')` / `-- hanasql-analyze-disable HANA-SEC-001`.
- **Diagnostic Message:** `Dynamic SQL concatenation risks SQL injection. Use 'EXECUTE IMMEDIATE ... USING ...' with '?' placeholders for value arguments.`
- **Auto-Fix / QuickFix:**
  Convert string-literal + quoted/unquoted `:var` concatenations inside `EXEC` or `EXECUTE IMMEDIATE` into `?` placeholders with `USING <var_list>`. Preserve existing `INTO <var_list>` (note `INTO` precedes `USING`). If concatenated value is clearly a SQL identifier (e.g., directly after `FROM`, `INTO`, `JOIN`, `TABLE`, `UPDATE`, `CALL`, and not wrapped in `'...'`), wrap with `ESCAPE_DOUBLE_QUOTES` or flag for manual `IS_SQL_INJECTION_SAFE` guard rather than rewriting to invalid `?` table-name syntax.
  - **Before:**
    ```sql
    EXEC 'DELETE FROM ORDERS WHERE CUST_ID = ''' || :iv_cust_id || ''' AND STATUS = ' || :iv_status;
    ```
  - **After:**
    ```sql
    EXECUTE IMMEDIATE 'DELETE FROM ORDERS WHERE CUST_ID = ? AND STATUS = ?' USING :iv_cust_id, :iv_status;
    ```

---

### `HANA-SEC-002` Unsanitized Dynamic SQL Input
- **Severity:** `Warning`
- **Official Code Analyzer Mapping:** `SAP.UNCHECKED_SQL_INJECTION_SAFETY.SECURITY`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`, `.hdblibrary`
- **AST / Lexical Trigger:**
  - `EXEC <expr>` or `EXECUTE IMMEDIATE <expr>` where a procedure/function `IN` parameter flows into dynamic SQL via string concatenation `||` or intermediate variable assignment, and neither:
    1. `USING` parameter binding is used for that variable, nor
    2. the variable/identifier is validated/sanitized with `IS_SQL_INJECTION_SAFE(<var>)`, `ESCAPE_SINGLE_QUOTES(<var>)`, or `ESCAPE_DOUBLE_QUOTES(<var>)` prior to execution.
- **Diagnostic Message:** `Unchecked dynamic SQL input (SAP.UNCHECKED_SQL_INJECTION_SAFETY.SECURITY). Validate identifiers with IS_SQL_INJECTION_SAFE() or bind values with USING.`
- **Auto-Fix / QuickFix:**
  When `||` concatenates a scalar identifier parameter `:p_obj` wrapped in double quotes (`'"' || :p_obj || '"'`), offer QuickFix wrapping `:p_obj` in `ESCAPE_DOUBLE_QUOTES(:p_obj)` (and inserting an `IS_SQL_INJECTION_SAFE` guard comment/check).

---

### `HANA-SEC-003` Privilege Escalation via `SQL SECURITY DEFINER` + Dynamic SQL
- **Severity:** `Warning` (CWE-269)
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`
- **AST / Lexical Trigger:**
  - `CREATE [OR REPLACE] PROCEDURE` (or non-table `FUNCTION`) with explicit `SQL SECURITY DEFINER` OR omitted `SQL SECURITY` clause (which defaults to `DEFINER` in SAP HANA) whose body contains `EXEC`, `EXECUTE IMMEDIATE`, or `APPLY_FILTER`.
- **Diagnostic Message:** `Procedure runs with SQL SECURITY DEFINER privileges while executing dynamic SQL. Switch to SQL SECURITY INVOKER to enforce caller authorizations.`
- **Auto-Fix / QuickFix:**
  - **Before:**
    ```sql
    CREATE PROCEDURE "MY_PROC" (IN iv_filter NVARCHAR(100))
      LANGUAGE SQLSCRIPT
      SQL SECURITY DEFINER
      AS
    BEGIN
      EXEC 'CALL "HELPER_PROC"(''' || :iv_filter || ''')';
    END;
    ```
  - **After:**
    ```sql
    CREATE PROCEDURE "MY_PROC" (IN iv_filter NVARCHAR(100))
      LANGUAGE SQLSCRIPT
      SQL SECURITY INVOKER
      AS
    BEGIN
      EXEC 'CALL "HELPER_PROC"(''' || :iv_filter || ''')';
    END;
    ```
  *(Note: When `SQL SECURITY` is omitted, insert `SQL SECURITY INVOKER` immediately before `DEFAULT SCHEMA`, `READS SQL DATA`, or `AS`.)*

---

### `HANA-SEC-004` Implicit `SQL SECURITY` Mode (`DEFINER` Default)
- **Severity:** `Information`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`
- **AST / Lexical Trigger:**
  - `CREATE [OR REPLACE] PROCEDURE` or `CREATE [OR REPLACE] FUNCTION` header omits the `SQL SECURITY { DEFINER | INVOKER }` clause.
- **Diagnostic Message:** `SQL SECURITY mode is omitted; SAP HANA defaults to DEFINER. Declare SQL SECURITY INVOKER or SQL SECURITY DEFINER explicitly.`
- **Auto-Fix / QuickFix:**
  Provide two QuickFix options:
  1. `Add SQL SECURITY INVOKER` (recommended for least privilege on procedures)
  2. `Add SQL SECURITY DEFINER` (explicit documentation of intentional owner context; required for Table UDFs and HDI container exposure patterns)

---

### `HANA-SEC-005` Unsanitized Filter in `APPLY_FILTER`
- **Severity:** `Warning`
- **Target Extensions:** `.sql`, `.hdbprocedure`, `.hdbfunction`
- **AST / Lexical Trigger:**
  - Call to `APPLY_FILTER(<dataset>, <filter_expr>)` where `<filter_expr>` is a `||` concatenation expression or a parameter variable not preceded by `IS_SQL_INJECTION_SAFE(...)` / `ESCAPE_SINGLE_QUOTES(...)`. *(Note: `APPLY_FILTER` does not support `?` / `USING` bind syntax.)*
- **Diagnostic Message:** `Dynamic filter expression in APPLY_FILTER is not checked with IS_SQL_INJECTION_SAFE() or ESCAPE_SINGLE_QUOTES().`
- **Auto-Fix / QuickFix:** None (requires business-specific filter validation or static `WHERE` rewrite).

---

## 3. XSJS Security & API Modernization Rules (`HANA-SEC-010` – `HANA-SEC-012`)

> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/011_9_Writing_Server-Side_JavaScript_Code.md` (Pages 535–548, 560–566)
> Source: `docs/specs/catalogs/xsjs-api.json` (`$.db`, `$.hdb`, `$.response`, `$.request`, `$.util.codec`)

### Legacy `$.db` to Modern `$.hdb` API Mapping

| Pattern | Legacy `$.db` [Deprecated] | Modern `$.hdb` Equivalent |
| :--- | :--- | :--- |
| Connect | `var conn = $.db.getConnection();` | `var conn = $.hdb.getConnection();` |
| Query | `var p = conn.prepareStatement(sql); p.setString(1, x); var rs = p.executeQuery();` | `var rs = conn.executeQuery(sql, x);` |
| DML / DDL | `var p = conn.prepareStatement(sql); p.setInt(1, n); p.executeUpdate();` | `var count = conn.executeUpdate(sql, n);` |
| Stored Procedure | `var p = conn.prepareCall("{call PROC(?, ?)}");` | `var fn = conn.loadProcedure(schema, name); fn(arg1);` |
| Commit / Rollback / Close | `conn.commit(); conn.rollback(); conn.close();` | `conn.commit(); conn.rollback(); conn.close();` |
| Row Iteration | `while (rs.next()) { rs.getString(1); }` | `for (var i = 0; i < rs.length; i++) { rs[i].COL; }` *(or `$.util`)* |

---

### `HANA-SEC-010` SQL Injection in XSJS Database Calls
- **Severity:** `Error` (CWE-89)
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **AST / Lexical Trigger:**
  - First argument to `.prepareStatement(...)`, `.prepareCall(...)`, `.executeQuery(...)`, or `.executeUpdate(...)` contains:
    - binary `+` string concatenation with any non-literal identifier, member expression (`$.request.parameters.get(...)`), or call expression, OR
    - ES6 template literal `` `...${expr}...` `` containing `${...}` interpolation.
- **Diagnostic Message:** `SQL string concatenation in XSJS enables SQL injection. Use '?' placeholders with bound parameters.`
- **Auto-Fix / QuickFix:**
  - **Before (`$.hdb`):**
    ```javascript
    var conn = $.hdb.getConnection();
    var id = $.request.parameters.get("id");
    var rs = conn.executeQuery("SELECT * FROM ACCOUNTS WHERE CUST_ID = '" + id + "'");
    ```
  - **After (`$.hdb`):**
    ```javascript
    var conn = $.hdb.getConnection();
    var id = $.request.parameters.get("id");
    var rs = conn.executeQuery("SELECT * FROM ACCOUNTS WHERE CUST_ID = ?", id);
    ```
  - **Before (`$.db`):**
    ```javascript
    var conn = $.db.getConnection();
    var pstmt = conn.prepareStatement("SELECT * FROM ACCOUNTS WHERE CUST_ID = '" + id + "'");
    ```
  - **After (`$.db`):**
    ```javascript
    var conn = $.db.getConnection();
    var pstmt = conn.prepareStatement("SELECT * FROM ACCOUNTS WHERE CUST_ID = ?");
    pstmt.setString(1, id);
    ```

---

### `HANA-SEC-011` Deprecated `$.db.getConnection()` & Mixed DB API Deadlock Risk
- **Severity:** `Warning`
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **AST / Lexical Trigger:**
  1. Any call to `$.db.getConnection(...)`.
  2. Higher severity note in message when the same file calls **both** `$.db.getConnection` and `$.hdb.getConnection` (`011_9_Writing_Server-Side_JavaScript_Code.md:843` — distinct connections risk deadlocks).
- **Diagnostic Message:**
  - Single API: `'$.db.getConnection()' is deprecated in favor of '$.hdb.getConnection()', which binds parameters inline and avoids positional index mismatches.`
  - Mixed APIs: `Mixing '$.db' and '$.hdb' connections in the same request uses separate database sessions and can cause deadlocks.`
- **Auto-Fix / QuickFix:**
  Refactor `$.db.getConnection(...)` -> `$.hdb.getConnection(...)` (and when a single-statement `conn.prepareStatement(sql)` + sequential `pstmt.set*(i, val)` + `pstmt.executeQuery()` / `pstmt.executeUpdate()` pattern is detected on the same variable without cursor `rs.next()` column index coupling, offer full `conn.executeQuery(sql, val1, ...)` / `conn.executeUpdate(sql, val1, ...)` rewrite; otherwise rewrite `$.db.getConnection` -> `$.hdb.getConnection` with comment if manual `ResultSet` adaptation is required).
  - **Before:**
    ```javascript
    var conn = $.db.getConnection();
    var pstmt = conn.prepareStatement("UPDATE ITEMS SET QTY = ? WHERE ID = ?");
    pstmt.setInt(1, qty);
    pstmt.setString(2, id);
    pstmt.executeUpdate();
    conn.commit();
    ```
  - **After:**
    ```javascript
    var conn = $.hdb.getConnection();
    conn.executeUpdate("UPDATE ITEMS SET QTY = ? WHERE ID = ?", qty, id);
    conn.commit();
    ```

---

### `HANA-SEC-012` Unescaped Response Output (Reflected XSS)
- **Severity:** `Warning` (CWE-79)
- **Target Extensions:** `.xsjs`, `.xsjslib`
- **AST / Lexical Trigger:**
  - Call to `$.response.setBody(...)` whose argument directly references `$.request.parameters`, `$.request.body`, or `$.request.headers` (including concatenation with HTML tags like `"<html>..." + ...` and when `$.response.contentType` is `"text/html"` or unset) without JSON serialization (`JSON.stringify(...)`).
- **Diagnostic Message:** `Passing request input directly to $.response.setBody() without encoding or JSON serialization risks reflected XSS.`
- **Auto-Fix / QuickFix:** None (requires encoding or switching response format to JSON with `application/json`).

---

## 4. XS Classic `.xsaccess` Security Rules (`HANA-SEC-020` – `HANA-SEC-025`)

> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md` (Pages 86–101)
> Source: `docs/specs/artifacts/json-formatting.md`

### Detection Lexicon (`.xsaccess` Keys & Defaults)

| Key | SAP Documented Default | Secure Target |
| :--- | :--- | :--- |
| `"exposed"` | `false` | `false` unless explicitly needed via HTTP |
| `"authentication"` | None / omitted (`null` allowed) | `{"method": "Form"}` (or SSO / Basic / LogonTicket) |
| `"prevent_xsrf"` | `false` | `true` for exposed non-read-only apps |
| `"force_ssl"` | `false` | `true` |
| `"anonymous_connection"` | `null` | `null` / omitted |
| `"default_connection"` | `null` | Avoid shared technical credentials when per-user DB auth applies |
| `"cors.allowOrigin"` | `["*"]` when `"cors.enabled": true` | Explicit trusted origins, never `["*"]` |
| `"authorization"` | Inherited; `null` disables | Array of `.xsprivileges` privilege names |
| `"headers"` | Disabled | `"enabled": true` with `X-Frame-Options` (`DENY` / `SAMEORIGIN`) |

---

### `HANA-SEC-020` Unauthenticated Exposed Package
- **Severity:** `Error` (CWE-306)
- **Target Extensions:** `.xsaccess`
- **AST / Lexical Trigger:**
  - Root JSON object has `"exposed": true` AND either:
    - `"authentication": null`, OR
    - `"authentication": []`, OR
    - `"authentication"` property is omitted.
- **Diagnostic Message:** `Package has '"exposed": true' without authentication ('"authentication": null' or omitted). Endpoints are publicly accessible.`
- **Auto-Fix / QuickFix:**
  Replace `"authentication": null` / `[]` with `"authentication": { "method": "Form" }`, or insert `"authentication": { "method": "Form" },` after `"exposed": true`.
  - **Before:**
    ```json
    {
      "exposed": true,
      "authentication": null
    }
    ```
  - **After:**
    ```json
    {
      "exposed": true,
      "authentication": {
        "method": "Form"
      }
    }
    ```

---

### `HANA-SEC-021` XSRF / CSRF Protection Disabled
- **Severity:** `Warning` (CWE-352)
- **Target Extensions:** `.xsaccess`
- **AST / Lexical Trigger:**
  - `"prevent_xsrf": false`, OR `"exposed": true` and `"prevent_xsrf"` property is omitted (default is `false`).
- **Diagnostic Message:** `'prevent_xsrf' is disabled or omitted (defaults to false). Enable '"prevent_xsrf": true' to enforce X-CSRF-Token checks.`
- **Auto-Fix / QuickFix:** Change `"prevent_xsrf": false` to `"prevent_xsrf": true`, or insert `"prevent_xsrf": true` into the object.

---

### `HANA-SEC-022` Shared Technical SQLCC Connection (`anonymous_connection` / `default_connection`)
- **Severity:** `Warning`
- **Target Extensions:** `.xsaccess`
- **AST / Lexical Trigger:**
  - Non-null string value configured for `"anonymous_connection"` or `"default_connection"`.
- **Diagnostic Message:**
  - `anonymous_connection`: `'anonymous_connection' executes unauthenticated requests under a static .xssqlcc user. Restrict to isolated public packages.`
  - `default_connection`: `'default_connection' overrides authenticated DB user identity for all SQL calls in this package with a single .xssqlcc user.`
- **Auto-Fix / QuickFix:** None (architectural decision).

---

### `HANA-SEC-023` Overly Permissive CORS Policy
- **Severity:** `Warning` (CWE-942)
- **Target Extensions:** `.xsaccess`
- **AST / Lexical Trigger:**
  - `"cors"` object has `"enabled": true` AND:
    - `"allowOrigin"` contains `"*"` (string or array element), OR
    - `"allowOrigin"` is omitted (SAP XS defaults `allowOrigin` to `["*"]` when `cors.enabled` is `true`).
- **Diagnostic Message:** `CORS is enabled with wildcard '"*"' origin (explicit or default). Specify explicit trusted origins in 'allowOrigin'.`
- **Auto-Fix / QuickFix:** Replace `"*"` (or insert `"allowOrigin"` property) with `["https://trusted-origin.example.com"]`.
  - **Before:**
    ```json
    "cors": {
      "enabled": true,
      "allowOrigin": ["*"]
    }
    ```
  - **After:**
    ```json
    "cors": {
      "enabled": true,
      "allowOrigin": ["https://trusted-origin.example.com"]
    }
    ```

---

### `HANA-SEC-024` Unencrypted HTTP Allowed (`force_ssl` Disabled)
- **Severity:** `Warning` (CWE-319)
- **Target Extensions:** `.xsaccess`
- **AST / Lexical Trigger:**
  - `"force_ssl": false`, OR `"exposed": true` and `"force_ssl"` is omitted (default is `false`).
- **Diagnostic Message:** `'force_ssl' is disabled or omitted (defaults to false), permitting plaintext HTTP traffic. Enable '"force_ssl": true'.`
- **Auto-Fix / QuickFix:** Change `"force_ssl": false` to `"force_ssl": true` or add `"force_ssl": true`.

---

### `HANA-SEC-025` Disabled Authorization Inheritance or Missing Frame Protection
- **Severity:** `Information`
- **Target Extensions:** `.xsaccess`
- **AST / Lexical Trigger:**
  - `"authorization": null` (explicitly disables parent `.xsprivileges` requirement for this package and all subpackages), OR `"exposed": true` with missing `"headers"` / `"X-Frame-Options"` configuration.
- **Diagnostic Message:**
  - `"authorization": null` removes parent package authorization requirements for this package and all child packages.
  - Missing `X-Frame-Options` custom header under `"headers"` weakens clickjacking defense.
- **Auto-Fix / QuickFix:** For missing `headers`, offer inserting `"headers": { "enabled": true, "customHeaders": [{ "name": "X-Frame-Options", "value": "SAMEORIGIN" }] }`.

---

## 5. `.hdbrole` & `.hdbgrants` Least-Privilege Rules (`HANA-SEC-030` – `HANA-SEC-042`)

> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Security_Checklists_and_Recommendations_en/004_2_SAP_HANA_Database_Checklists_and_Recommendations.md` (Pages 6–15)
> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Security_Guide_en/010_8_SAP_HANA_Authorization.md` (Pages 147, 199–201)
> Source: `research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Deployment_Infrastructure_(DI)_Reference_en/008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md` (Pages 307–317)
> Source: `research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/001_pages_1_30.md` (Pages 20–24)

### Critical Privileges & Roles Lexicon

| Category | Exact Identifiers |
| :--- | :--- |
| Production-restricted (`CHECKLISTS`) | `CATALOG READ`, `TRACE ADMIN`, `DEBUG`, `ATTACH DEBUGGER` |
| High-risk System Privileges (`CHECKLISTS`) | `ADAPTER ADMIN`, `AGENT ADMIN`, `AUDIT ADMIN`, `AUDIT OPERATOR`, `BACKUP ADMIN`, `BACKUP OPERATOR`, `CERTIFICATE ADMIN`, `CREATE REMOTE SOURCE`, `CREDENTIAL ADMIN`, `ENCRYPTION ROOT KEY ADMIN`, `EXTENDED STORAGE ADMIN`, `INIFILE ADMIN`, `LDAP ADMIN`, `LICENSE ADMIN`, `LOG ADMIN`, `MONITOR ADMIN`, `OPTIMIZER ADMIN`, `RESOURCE ADMIN`, `SAVEPOINT ADMIN`, `SERVICE ADMIN`, `SESSION ADMIN`, `SSL ADMIN`, `TABLE ADMIN`, `TRUST ADMIN`, `VERSION ADMIN`, `WORKLOAD ADMIN`, `USER ADMIN`, `ROLE ADMIN`, `SCENARIO ADMIN`, `STRUCTUREDPRIVILEGE ADMIN`, `DATA ADMIN` |
| Critical Privilege Pairs (`CHECKLISTS`) | `USER ADMIN` + `ROLE ADMIN`; `CREATE SCENARIO` + `SCENARIO ADMIN`; `AUDIT ADMIN` + `AUDIT OPERATOR`; `CREATE STRUCTURED PRIVILEGE` + `STRUCTUREDPRIVILEGE ADMIN` |
| High-Privilege Catalog Roles | `CONTENT_ADMIN`, `MODELING`, `SAP_INTERNAL_HANA_SUPPORT`, `_SYS_BI_CP_ALL` |

---

### `HANA-SEC-030` Privilege Propagation (`WITH GRANT OPTION`) in `.hdbrole`
- **Severity:** `Warning` (CWE-266)
- **Target Extensions:** `.hdbrole` (both `[XSC]` DSL and `[HDI]` JSON)
- **AST / Lexical Trigger:**
  - **Classic `.hdbrole`:** Privilege statement ends with `WITH GRANT OPTION;` (case-insensitive).
  - **HDI `.hdbrole` (JSON):** Object inside `"schema_privileges"`, `"object_privileges"`, `"global_object_privileges"`, `"schema_analytic_privileges"`, or role root contains non-empty `"privileges_with_grant_option"` or `"roles_with_admin_option"`.
- **Diagnostic Message:** `'WITH GRANT OPTION' / 'privileges_with_grant_option' allows grantees to redistribute privileges. Restrict grantable roles to container object owners or remove grant option.`
- **Auto-Fix / QuickFix:**
  - Classic `.hdbrole`: Remove `WITH GRANT OPTION` before `;`.
  - HDI JSON `.hdbrole`: Rename `"privileges_with_grant_option"` to `"privileges"` (merging arrays if `"privileges"` already exists on the same entry).
  - **Before (Classic):**
    ```sql
    sql object my.pkg::ORDERS: SELECT, UPDATE WITH GRANT OPTION;
    ```
  - **After (Classic):**
    ```sql
    sql object my.pkg::ORDERS: SELECT, UPDATE;
    ```

---

### `HANA-SEC-031` Critical System Privilege or Privileged Role in `.hdbrole`
- **Severity:** `Warning` (`Error` for critical separation-of-duties pairs or `SAP_INTERNAL_HANA_SUPPORT`)
- **Target Extensions:** `.hdbrole` (Classic & HDI)
- **AST / Lexical Trigger:**
  - Classic `system privilege:` or HDI `"system_privileges"` includes any privilege in the Critical Privileges Lexicon above.
  - Classic `extends catalog role` or HDI `"global_roles"` includes `CONTENT_ADMIN`, `MODELING`, or `SAP_INTERNAL_HANA_SUPPORT`.
  - Classic `analytic privilege:` / `catalog analytic privilege:` references `_SYS_BI_CP_ALL`.
  - Role contains both members of any Critical Privilege Pair (`USER ADMIN` + `ROLE ADMIN`, `AUDIT ADMIN` + `AUDIT OPERATOR`, `CREATE SCENARIO` + `SCENARIO ADMIN`, `CREATE STRUCTURED PRIVILEGE` + `STRUCTUREDPRIVILEGE ADMIN`).
- **Diagnostic Message:** `Role assigns high-privilege system permission or unrestricted catalog role ('<name>'). Follow least privilege and separation of duties.`
- **Auto-Fix / QuickFix:** None.

---

### `HANA-SEC-032` Overly Broad Object, Schema, or Wildcard Privileges in `.hdbrole`
- **Severity:** `Warning`
- **Target Extensions:** `.hdbrole` (Classic & HDI)
- **AST / Lexical Trigger:**
  - Classic `catalog schema`, `schema`, `catalog sql object`, or `sql object` grants `ALL PRIVILEGES`, `CREATE ANY`, `ALTER`, or `DROP`.
  - HDI `"schema_privileges"` grants schema-wide write/DDL privileges (`INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE ANY`, `UNMASKED`) across an entire schema instead of scoped `"object_privileges"`.
  - HDI `"object_privileges"` uses `"pattern_mode": "include"` with `"name": "%"` (matches all objects).
- **Diagnostic Message:** `Overly broad privilege grant ('<priv/pattern>'). Grant specific privileges on explicit objects instead of ALL PRIVILEGES, schema-wide DML/DDL, or '%' wildcards.`
- **Auto-Fix / QuickFix:** None.

---

### `HANA-SEC-033` HDI `#`-Suffix Constraint Violation on Grantable Roles
- **Severity:** `Error`
- **Target Extensions:** `.hdbrole` (`[HDI]` / `[CLOUD]`)
- **AST / Lexical Trigger:**
  - HDI JSON `.hdbrole` contains non-empty `"privileges_with_grant_option"` anywhere while `"role.name"` does **not** end with `#`. (HDI role plug-in rejects non-`#` roles with grant options: `008_6_SAP_HDI_Artifact_Types_and_Build_Plug-ins_Reference.md:2011`).
- **Diagnostic Message:** `HDI roles with 'privileges_with_grant_option' must have a role name ending with '#' (only grantable to container object owner '#OO').`
- **Auto-Fix / QuickFix:** Offer two QuickFixes:
  1. Remove `"privileges_with_grant_option"` / merge into `"privileges"` (`HANA-SEC-030` fix), OR
  2. Append `#` to `"role.name"`.

---

### `HANA-SEC-040` Over-Privileged `application_user` in `.hdbgrants`
- **Severity:** `Warning`
- **Target Extensions:** `.hdbgrants`
- **AST / Lexical Trigger:**
  Inside any `<grantor_service>.application_user` object:
  - Any privilege entry contains `"privileges_with_grant_option"` or `"roles_with_admin_option"`, OR
  - Any privilege array includes DDL / administrative privileges (`ALTER`, `CREATE ANY`, `DROP`, `TRIGGER`, `INDEX`, `DEBUG`, `UNMASKED`, `ALL PRIVILEGES`), OR
  - Grants roles whose names end in `#` or `#OO` variants to `application_user`.
- **Diagnostic Message:** `'application_user' receives elevated privileges (<detail>). Keep runtime application users read/execute-scoped and restrict '#'/WITH GRANT OPTION to 'object_owner'.`
- **Auto-Fix / QuickFix:**
  For `"privileges_with_grant_option"` inside `"application_user"`, offer QuickFix renaming key to `"privileges"` (merging if needed).

---

### `HANA-SEC-041` Overly Broad Schema or `ALL PRIVILEGES` in `.hdbgrants`
- **Severity:** `Warning`
- **Target Extensions:** `.hdbgrants`
- **AST / Lexical Trigger:**
  Inside either `"object_owner"` or `"application_user"`:
  - Any privilege entry includes `"ALL PRIVILEGES"` or `"CREATE ANY"`.
  - `"schema_privileges"` grants `"INSERT"`, `"UPDATE"`, `"DELETE"`, or `"ALTER"` across a whole external schema instead of explicit `"object_privileges"`.
  - `"system_privileges"` is specified inside `.hdbgrants`.
- **Diagnostic Message:** `Avoid granting ALL PRIVILEGES, CREATE ANY, or schema-wide modification rights in .hdbgrants; enumerate explicit object_privileges or least-privilege roles.`
- **Auto-Fix / QuickFix:** None.

---

### `HANA-SEC-042` System Schema (`SYS`) Grants & `.hdbgrants` Structure Hygiene
- **Severity:** `Information`
- **Target Extensions:** `.hdbgrants`, `.hdbrevokes`
- **AST / Lexical Trigger:**
  - `.hdbgrants` entry specifies `"schema": "SYS"` or `"schema": "_SYS_REPO"` with non-`SELECT` privileges (upgraded to `Warning`) or missing explicit `"object_privileges"` enumeration (`Information`).
  - Both `"object_owner"` and `"application_user"` are missing inside a grantor service block.
- **Diagnostic Message:**
  - System schema grant: `External grant targets system schema 'SYS'/'_SYS_REPO'. Verify minimal SELECT-only metadata privileges.`
  - Empty grantor: `Grantor entry should define at least one of 'object_owner' or 'application_user'.`
- **Auto-Fix / QuickFix:** None.
