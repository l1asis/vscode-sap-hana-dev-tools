# HDI Grants, Revokes, Roles and Role Configurations: Property Schemas `[XSA]` `[HDI]` `[CLOUD]`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/007_5_Defining_the_Data_Model_in_XS_Advanced.md (Pages 272–275, 498–503)
> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/009_pages_241_270.md (Pages 241–270: _Roles (.hdbrole and .hdbroleconfig)_)

Layout rules: `json-formatting.md`. Security checks: `security-rules.md` (`HANA-SEC-030` .. `-033` for roles, `-040` .. `-042` for grants). Classic `.hdbrole` DSL and its migration to this JSON format: `hdbrole-formatting.md`, `migration-xsc-to-hdi.md` §2.4. Completion and hover: `src/sql/artifact-intellisense.ts` (§5).

---

## 1. Metadata

| Extension | Language ID | Format | Runtime | `.hdiconfig` plug-in | Read by | Section |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `.hdbgrants` | `hdbgrants` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | none (not an HDI artifact) | HDI Deployer `@sap/hdi-deploy` | §2 |
| `.hdbsynonymgrantor` | `hdbgrants` | JSON | `[XSA]` `[HDI]` | none | HDI Deployer (backwards-compatible alias, `HANA-MIG-013`) | §2 |
| `.hdbrevokes` | `hdbrevokes` | JSON, same structure as `.hdbgrants` | `[XSA]` `[HDI]` `[CLOUD]` | none | HDI Deployer 3.8+; processed before `.hdbgrants` | §2 |
| `.hdbrole` (HDI) | `hdbrole` | JSON (root `{`) | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.role` | HDI build plug-in | §3 |
| `.hdbroleconfig` | `hdbroleconfig` | JSON | `[XSA]` `[HDI]` `[CLOUD]` | `com.sap.hana.di.role.config` | HDI build plug-in | §4 |

---

## 2. `.hdbgrants` / `.hdbrevokes`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_XS_Advanced_Model_en/007_5_Defining_the_Data_Model_in_XS_Advanced.md (Pages 272–275 _Permissions for Objects in HDI-Container_, 498–503 _Syntax Options in the hdbgrants File_)

### 2.1 Structure

```text
{ "<grantor service>": {                      level 1: service instance that executes GRANT / REVOKE
    "object_owner":     { <privilege sets> }, level 2: grantees
    "application_user": { <privilege sets> }
} }
```

- **Level 1:** the grantor is an HDI container instance or a user-provided service from the `resources` of `mta.yaml`. Its name is subject to service replacement.
- **Level 2:** `object_owner` is the container's object owner (`<container>#OO`), and `application_user` is the users bound to the application modules.

### 2.2 Grantee keys (`object_owner`, `application_user`)

| Key | Type | Required | Item keys (§2.3) | Notes |
| :--- | :--- | :---: | :--- | :--- |
| `system_privileges` | `Array<Object>` | No | `privileges`, `privileges_with_admin_option` | System privileges. |
| `global_roles` | `Array<Object>` | No | `roles`, `roles_with_admin_option` | Roles without a schema. Not supported when the grantor is an HDI container service. |
| `schema_privileges` | `Array<Object>` | No | `schema`, `privileges`, `privileges_with_grant_option` | |
| `schema_roles` | `Array<Object>` | No | `schema`, `roles`, `roles_with_admin_option` | `roles_with_admin_option` is not allowed when the grantor is an HDI container. |
| `object_privileges` | `Array<Object>` | No | `schema`, `name`, `privileges`, `privileges_with_grant_option` | |
| `global_object_privileges` | `Array<Object>` | No | `name`, `type`, `privileges`, `privileges_with_grant_option` | Objects without a schema (`"type": "REMOTE SOURCE"`). |
| `roles` | `Array<String>` | No | — | Superseded by `global_roles`; still accepted for backward compatibility and `.hdbrole` compatibility. |
| `container_roles` | `Array<String>` | No | — | Superseded by `schema_roles`; still accepted for backward compatibility. |

### 2.3 Privilege set items

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `schema` | `String` | No | schema of the grantor service | Fixed schema; overrides the grantor service's schema (`schema_privileges`, `schema_roles`, `object_privileges`). |
| `name` | `String` | `object_privileges`, `global_object_privileges` | — | Object name. |
| `type` | `String` | `global_object_privileges` | — | Object type, e.g. `REMOTE SOURCE`, `USERGROUP`. |
| `privileges` | `Array<String>` | one privilege list | — | Privileges granted without grant / admin option. |
| `privileges_with_grant_option` | `Array<String>` | No | — | `WITH GRANT OPTION`; needed by the object owner when definer-mode views or procedures expose the objects (`HANA-SEC-040` warns on `application_user`). |
| `privileges_with_admin_option` | `Array<String>` | No | — | `system_privileges` only. |
| `roles` | `Array<String>` | one role list | — | `global_roles`, `schema_roles`. A name ending in `#` may contain grant-option privileges, and only the object owner can receive it. |
| `roles_with_admin_option` | `Array<String>` | No | — | `global_roles`, `schema_roles` (not with an HDI container grantor). |

### 2.4 Examples

```json
{
  "external-access": {
    "object_owner": {
      "schema_privileges": [{ "schema": "ERP", "privileges": ["SELECT"], "privileges_with_grant_option": ["SELECT"] }],
      "object_privileges": [{ "schema": "SYS", "name": "TABLES", "privileges_with_grant_option": ["SELECT"] }],
      "global_object_privileges": [{ "name": "A_REMOTE_SOURCE", "type": "REMOTE SOURCE", "privileges": ["CREATE VIRTUAL TABLE"] }]
    },
    "application_user": {
      "object_privileges": [{ "schema": "SYS", "name": "TABLES", "privileges": ["SELECT"] }]
    }
  }
}
```

Invalid:

| Fragment | Problem |
| :--- | :--- |
| `{ "object_owner": { ... } }` at the root | level 1 must be the grantor service name |
| `"object_privileges": [{ "reference": "T" }]` | `reference` is an `.hdbrole` key; `.hdbgrants` uses `schema` + `name` |
| `"schema_roles": [{ "roles": ["R"], "roles_with_admin_option": ["R2"] }]` with an HDI container grantor | admin option not supported for container roles |
| `"system_privileges": ["CATALOG READ"]` | entries are objects: `[{ "privileges": ["CATALOG READ"] }]` |

---

## 3. `.hdbrole` (HDI JSON)

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/009_pages_241_270.md (Pages 241–270)

### 3.1 Root and role keys

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `role` | `Object` | Yes | — | Root: an object with the single key `role`. |
| `role.name` | `String` | Yes | — | Run-time role name, non-empty. A name ending in `#` may hold grant-option privileges and other `#` roles. A name without `#` may not. |
| `role.pattern_escape_character` | `String` (one character) | No | `\` | Escape character for `%` / `_` in wildcard object names. |
| `role.global_roles` | `Array<String>` | No | — | Roles without a schema. |
| `role.schema_roles` | `Array<Object>` | No | — | `{ "schema_reference"?, "names": [...] }`. |
| `role.system_privileges` | `Array<String>` | No | — | Non-empty if present (`HANA-SEC-031` / `-032` on administrative or broad privileges). |
| `role.schema_privileges` | `Array<Object>` | No | — | `{ "reference"?, "privileges", "privileges_with_grant_option"? }`. |
| `role.object_privileges` | `Array<Object>` | No | — | `{ "name", "type", "privileges", "privileges_with_grant_option"?, "pattern_mode"? }`. |
| `role.global_object_privileges` | `Array<Object>` | No | — | `{ "name", "type", "privileges", "privileges_with_grant_option"?, "schema_reference"? }`. |
| `role.schema_analytic_privileges` | `Array<Object>` | No | — | `{ "schema_reference"?, "privileges", "privileges_with_grant_option"? }` or `{ "schema_reference", "names" }`. |

Every list that is present must be non-empty and contain valid entries.

### 3.2 Entry keys

| Key | Type | Used in | Required | Allowed values / constraints |
| :--- | :--- | :--- | :---: | :--- |
| `schema_reference` | `String` | `schema_roles`, `global_object_privileges`, `schema_analytic_privileges` | No | Identifier unique in the file, resolved by `.hdbroleconfig` (§4). Omitted: the container schema. |
| `reference` | `String` | `schema_privileges` | No | Same, for schema privileges. Omitted: the object owner's schema. |
| `names` | `Array<String>` | `schema_roles`, `schema_analytic_privileges` | Yes | Non-empty. |
| `name` | `String` | `object_privileges`, `global_object_privileges` | Yes | Object name or synonym, or a wildcard pattern with `pattern_mode`. |
| `type` | `String` | `object_privileges`, `global_object_privileges` | Yes | `INDEX`, `FUNCTION`, `PROCEDURE`, `SYNONYM`, `TABLE`, `TRIGGER`, `VIEW`, `SEQUENCE`, ... (global: `USERGROUP`, ...). |
| `privileges` | `Array<String>` | all privilege lists | Yes | Non-empty. |
| `privileges_with_grant_option` | `Array<String>` | all privilege lists | No | Only in roles whose name ends with `#` (`HANA-SEC-033`). |
| `pattern_mode` | `Enum` | `object_privileges` | with a wildcard `name` | `"include"` (grant to matching objects), `"exclude"` (revoke from them). Wildcards `%` and `_`; for `FUNCTION`, `PROCEDURE`, `SEQUENCE`, `TABLE`, `VIEW`. |

### 3.3 Examples

```json
{
  "role": {
    "name": "app.sales::Reader",
    "global_roles": ["GLOBAL_ROLE_1"],
    "schema_roles": [{ "schema_reference": "RoleSchemaRef1", "names": ["RoleA"] }],
    "schema_privileges": [{ "reference": "Ref1", "privileges": ["SELECT"] }],
    "object_privileges": [
      { "name": "app.sales::ORDERS", "type": "TABLE", "privileges": ["SELECT"] },
      { "name": "app.sales::REPORT_%", "type": "VIEW", "privileges": ["SELECT"], "pattern_mode": "include" }
    ]
  }
}
```

Invalid:

| Fragment | Problem |
| :--- | :--- |
| `{ "name": "R" }` | no `role` root |
| `"name": "Reader"` with `privileges_with_grant_option` | grant options need a role name ending in `#` |
| `"object_privileges": [{ "name": "T%", "type": "TABLE", "privileges": ["SELECT"] }]` | wildcard name without `pattern_mode` |
| `"system_privileges": []` | a present list must not be empty |
| `"application_privileges": ["app::Execute"]` | not an HDI role key (XS Classic application privileges move to `xs-security.json` scopes) |

---

## 4. `.hdbroleconfig`

> Source: research/refs/extracted/hana-cloud-database_SAP_HANA_Cloud,_SAP_HANA_Database_Deployment_Infrastructure_/009_pages_241_270.md (Pages 241–270)

Optional. Resolves the `schema_reference` / `reference` identifiers of a role to real or logical schemas.

| Key | Type | Required | Allowed values / constraints |
| :--- | :--- | :---: | :--- |
| `"<role name>"` | `Object` | Yes | Root key: the role's `name`. |
| `."<reference>"` | `Object` | Yes | One per reference used in the role. |
| `."<reference>".schema` | `String` | one of the two | Real schema. |
| `."<reference>".logical_schema` | `String` | one of the two | Logical schema (deployment dependency on a `.hdblogicalschema`, `hdi-target-configs.md` §4). |

```json
{
  "app.sales::Reader": {
    "Ref1": { "schema": "Schema1" },
    "RoleSchemaRef1": { "logical_schema": "LogicalSchema1" }
  }
}
```

Invalid: `{ "Ref1": { "schema": "S" } }` (missing role-name level); `{ "R": { "Ref1": { "schema": "S", "logical_schema": "L" } } }` (one target per reference).

---

## 5. IntelliSense Reconciliation (#65)

`src/sql/artifact-intellisense.ts` now follows §2 and §3:

| Table | Change |
| :--- | :--- |
| `GRANTOR_OWNER_FIELDS` | Added `system_privileges` and `global_roles`. Kept `roles` and added `container_roles`, both marked as superseded. |
| `GRANTS_PRIVILEGE_ITEM_FIELDS` (new, `.hdbgrants` items) | `schema`, `name`, `type`, `privileges`, `privileges_with_grant_option`, `privileges_with_admin_option`, `roles`, `roles_with_admin_option`. Dropped the undocumented `reference` and `include_filter`, which belong to `.hdbrole` and `.hdbtabledata`. |
| `ROLE_PRIVILEGE_ITEM_FIELDS` (new, `.hdbrole` entries) | `name`, `type`, `privileges`, `privileges_with_grant_option`, `pattern_mode`, `reference`, `schema_reference`, `names`. |
| `HDBROLE_JSON_BODY_FIELDS` | Added `global_roles` and `pattern_escape_character`. Removed `application_privileges` (not an HDI role key). |
