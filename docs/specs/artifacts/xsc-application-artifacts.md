# XS Classic Application Artifacts: Property Schemas `[XSC]`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md (Pages 81–143)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/011_9_Writing_Server-Side_JavaScript_Code.md (Pages 529–637)
> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/007_5_Setting_up_the_Data_Persistence_Model_in_SAP_HANA.md (Pages 308–312)

Property schemas of the XS Classic application-layer artifacts. Layout and comment rules: `json-formatting.md` (JSON) and `classic-kv-formatting.md` (`.xshttpdest`). Security checks: `docs/specs/diagnostics/security-rules.md`. Completion and hover: `src/sql/artifact-intellisense.ts` (§12 lists what it implements).

**Column conventions.** *Required* is `Yes`, `No`, or a condition. *Default* is the value that applies when the key is omitted, `—` when the corpus states none. Every key is `[XSC]` unless noted. Keys the corpus does not document but that the extension accepts are listed separately, marked *not in corpus*.

---

## 1. Metadata

| Extension | Language ID | Format | Runtime | `.hdiconfig` plug-in | Minimum version | Section |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `.xsapp` | `xsapp` | empty marker (content ignored) | `[XSC]` | none (not migrated, M2 in `artifact-registry.md`) | SAP HANA 1.0 | §2 |
| `.xsaccess` | `xsaccess` | JSON | `[XSC]` | none (migrated to `xs-app.json`) | SAP HANA 1.0 | §3 |
| `.xsprivileges` | `xsprivileges` | JSON | `[XSC]` | none (migrated to `xs-security.json` scopes) | SAP HANA 1.0 | §4 |
| `.xssqlcc` | `xssqlcc` | JSON (tolerant: commas may be omitted, `json-formatting.md`) | `[XSC]` | none | SAP HANA 1.0 | §5 |
| `.xsjob` | `xsjob` | JSON | `[XSC]` | none (migrated to the job scheduler) | SAP HANA 1.0 | §6 |
| `.xssecurestore` | `xssecurestore` | JSON, fixed content `{}` | `[XSC]` | none | SAP HANA 1.0 | §7 |
| `.xshttpdest` | `xshttpdest` | Classic key-value (`key = value;`) | `[XSC]` | none | SAP HANA 1.0 | §8 |
| `.xsoauthappconfig` | `xsoauthappconfig` | JSON | `[XSC]` | none | not stated | §9 |
| `.xsoauthclientconfig` | `xsoauthclientconfig` | JSON | `[XSC]` | none | not stated | §10 |
| `.xsoauthclientflavor` | `xsoauthclientflavor` | JSON | `[XSC]` | none | not stated | §10 |
| `.hdbsynonym` (XSC variant) | `hdbsynonym` | JSON | `[XSC]` | none (the HDI variant: `hdi-target-configs.md` §2) | SAP HANA 1.0 | §11 |


---

## 2. `.xsapp` (Application Descriptor)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md (Pages 83–85, §4.5.1.1)

- The file has no name and no content. Content is allowed for backward compatibility but ignored.
- The package containing `.xsapp` is the application root (`http://<host>:<port>/<package path>/`). It needs an `.xsaccess` file in the same package.
- Property schema: none. The extension accepts an empty file (`HANA-SYN-010` is not raised on an empty `.xsapp`).

Valid: an empty file; `{}`. Invalid: none (content is ignored by the runtime).

---

## 3. `.xsaccess` (Application Access)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md (Pages 85–99, §4.5.2.1–4.5.2.3)

Structural format: one JSON object. Settings are inherited down the package hierarchy; an `.xsaccess` file in a subpackage overrides them.

### 3.1 Root keys

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `exposed` | `Boolean` | No | `false` | `true` exposes the package content over HTTP(S). |
| `authentication` | `Object` \| `null` | Yes | — | `{ "method": "Form" }`. `null` allows unauthenticated access (`HANA-SEC-020`). |
| `authorization` | `Array<String>` \| `null` | No | none (any user) | Application privilege names from an `.xsprivileges` file (`"pkg::Execute"`). `null` disables inherited authorization. |
| `anonymous_connection` | `String` \| `null` | No | `null` | `.xssqlcc` used when no credentials are given (`"pkg::AnonConn"`); not recommended (`HANA-SEC-022`). |
| `default_connection` | `String` | No | — | `.xssqlcc` used for every SQL execution in the package. Priority: `$.db.getConnection(sqlcc)` > `default_connection` > authenticated user > `anonymous_connection`. |
| `cache_control` | `String` \| `null` | No | `null` | HTTP `Cache-Control` directives (`"no-cache, no-store"` recommended). |
| `cors` | `Object` | No | disabled | §3.3. |
| `default_file` | `String` | No | `"index.html"` | File served for the package URL. |
| `enable_etags` | `Boolean` | No | `true` | Generates ETags. |
| `force_ssl` | `Boolean` | No | `false` | `true` requires HTTPS (`HANA-SEC-024`). |
| `mime_mapping` | `Array<Object>` | No | server defaults | `{ "extension": "<ext>", "mimetype": "<type>" }`; supersedes the server mapping for the listed extensions only. |
| `prevent_xsrf` | `Boolean` | No | `false` | `true` enforces the `X-CSRF-Token` check (`HANA-SEC-021`). |
| `rewrite_rules` | `Array<Object>` | No | — | `{ "source": "<regex>", "target": "<path>" }`; `$1` .. refer to groups (`"source": "/go/(\\d+)/"`). |
| `headers` | `Object` | No | disabled | §3.4. |

### 3.2 `authentication`

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `method` | `Enum` | Yes | — | `"Form"`. Other methods (Basic, logon ticket, SAML2, X509, SPNEGO) are configured in the SAP HANA XS Administration Tool. Any other key in this object is ignored. |

### 3.3 `cors`

| Key | Type | Required | Default (when `enabled` is `true`) | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `enabled` | `Boolean` | Yes | `false` | `false`: no preflight answers, no CORS headers, CORS requests refused. |
| `allowMethods` | `Array<String>` | No | `["GET", "POST", "HEAD", "OPTIONS"]` | HTTP methods. |
| `allowOrigin` | `Array<String>` | No | `["*"]` | Host names, `*` wildcard allowed (`*.sap.com`). `"*"` is reported by `HANA-SEC-023`. |
| `maxAge` | `String` | No | `"3600"` | Preflight cache time in seconds. |
| `allowHeaders` | `Array<String>` | No | none | Allowed request headers. |
| `exposeHeaders` | `Array<String>` | No | none | Response headers exposed to the client. |

### 3.4 `headers`

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `enabled` | `Boolean` | Yes | — | Must be `true` for custom headers to apply. Runtime settings override design-time settings. |
| `customHeaders` | `Array<Object>` | No | — | `{ "name": "X-Frame-Options", "value": "DENY" \| "SAMEORIGIN" \| "ALLOW-FROM <URL>" }` (one URL only). |

### 3.5 Examples

```json
{
  "exposed": true,
  "authentication": { "method": "Form" },
  "authorization": ["acme.app::Execute"],
  "force_ssl": true,
  "prevent_xsrf": true,
  "cache_control": "no-cache, no-store",
  "cors": { "enabled": true, "allowOrigin": ["https://portal.acme.com"], "maxAge": "600" },
  "headers": { "enabled": true, "customHeaders": [{ "name": "X-Frame-Options", "value": "SAMEORIGIN" }] }
}
```

Invalid:

| Fragment | Problem |
| :--- | :--- |
| `"exposed": "true"` | `exposed` is a Boolean |
| `"authentication": { "method": "Kerberos" }` | only `"Form"` is evaluated from `.xsaccess` |
| `"mime_types": [ ... ]` | unknown key; the key is `mime_mapping` |
| `"headers": { "x_frame_options": "DENY" }` | unknown key; use `customHeaders` |
| `"authorization": "acme.app::Execute"` | must be an array or `null` |

---

## 4. `.xsprivileges` (Application Privileges)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md (Pages 100–104, §4.5.3)

The file has no name. One per package; files at different levels of the hierarchy are allowed. A privilege name is prefixed with the package on activation (`Execute` in `sap.hana.xse` becomes `sap.hana.xse::Execute`), and only `_SYS_REPO` holds it until it is granted with `_SYS_REPO.GRANT_APPLICATION_PRIVILEGE`.

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `privileges` | `Array<Object>` | Yes | — | Root key. |
| `privileges[].name` | `String` | Yes | — | Privilege name without the package (`"Execute"`, `"Admin"`). |
| `privileges[].description` | `String` | No | — | Free text. |

```json
{
  "privileges": [
    { "name": "Execute", "description": "Basic execution privilege" },
    { "name": "Admin", "description": "Administration privilege" }
  ]
}
```

Invalid: `{ "privileges": ["Execute"] }` (entries are objects); `{ "privileges": [{ "name": "acme.app::Execute" }] }` (the name must not repeat the package).

---

## 5. `.xssqlcc` (SQL Connection Configuration)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/011_9_Writing_Server-Side_JavaScript_Code.md (Pages 578–588, §9.5)

Activation creates an inactive runtime object. An administrator activates it in the XS Administration Tool, which creates the user `XSSQLCC_AUTO_USER_[...]` and grants it `role_for_auto_user`.

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `description` | `String` | No | — | Free text. |
| `role_for_auto_user` | `String` | No | — | Repository role (`"com.acme.roles::JobAdministrator"`). |

```json
{
  "description": "Admin SQL connection",
  "role_for_auto_user": "com.acme.roles::JobAdministrator"
}
```

The reference example omits the comma between the two keys. The extension accepts that form (`json-formatting.md`; `HANA-SYN-010` does not report a missing comma in `.xssqlcc`). Invalid: `{ "role_for_auto_user": ["r1", "r2"] }` (one role string).

---

## 6. `.xsjob` (Scheduled Job)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/011_9_Writing_Server-Side_JavaScript_Code.md (Pages 589–599, §9.7)

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `description` | `String` | No | — | Shown in the XS Administration Tool. |
| `action` | `String` | Yes | — | `"<package.path>:<service>.xsjs::<function>"`, or an SQLScript procedure in place of the XSJS service. |
| `schedules` | `Array<Object>` | Yes | — | One entry per schedule. |
| `schedules[].description` | `String` | No | — | Free text. |
| `schedules[].xscron` | `String` | Yes | — | Seven fields, left to right: Year (4 digits), Month (`1`–`12`), Day (`-31`–`31`), DayOfWeek (`mon`–`sun`), Hour (`0`–`23`), Minute (`0`–`59`), Second (`0`–`59`). `*` is a wildcard and `*/n` a step. |
| `schedules[].parameter` | `Object` | No | — | Input parameters of the action (`{ "stock": "SAP.DE" }`). |
| `schedules[].signature_version` | `Integer` | No | `0` | Increase when the action's parameter signature changes; runtime schedules are then deactivated. No minor versions (`1.2` is read as `12`). The reference prints it inside a schedule entry. |

```json
{
  "description": "Read stock value",
  "action": "yahoo:yahoo.xsjs::readStock",
  "schedules": [
    { "description": "Every 5 minutes at second 20", "signature_version": 1, "xscron": "* * * * * */5 20", "parameter": { "stock": "SAP.DE" } }
  ]
}
```

Invalid: `"xscron": "*/5 * * * *"` (five-field Unix cron; `.xsjob` needs seven fields); `"signature_version": 1.2`; a schedule without `xscron`.

---

## 7. `.xssecurestore` (Secure Store)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/011_9_Writing_Server-Side_JavaScript_Code.md (Pages 529–637, `$.security.Store`)

The file (for example `localStore.xssecurestore`) must contain only `{}`. Data is stored at runtime through `$.security.Store("localStore.xssecurestore")`.

Valid: `{}`. Invalid: any key (`{ "password": "..." }`). Secrets never belong in the design-time file.

---

## 8. `.xshttpdest` (HTTP Destination, Classic KV)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md (Pages 114–129, §4.7.1–4.7.2)

Structural format: `key = value;` lines (`docs/specs/grammars/hdb-classic-kv.md`). Every line, including the last, ends in `;`. Strings are double-quoted, and `//` line comments are allowed. An extension file uses `modifies` and overrides identical keys of the destination it extends.

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `host` | `String` | Yes | — | Target host name. |
| `port` | `Integer` | Yes | — | Target port. |
| `description` | `String` | No | `""` | Free text. |
| `useSSL` | `Boolean` | No | `false` | HTTPS for outbound connections (SSL itself is configured in the trust store). |
| `sslAuth` | `Enum` | No | `client` | `client` (trust-store entry required), `anonymous` (built-in key, no authentication). Only with `useSSL = true`. |
| `sslHostCheck` | `Boolean` | No | `true` | Certificate subject must match `host`. Only with `useSSL = true`. |
| `pathPrefix` | `String` | No | `""` | Prefix added to the request path (`"/d/quotes.csv?f=a"`). |
| `authType` | `Enum` | No | `none` | `none`, `basic`, `AssertionTicket`, `SamlAssertion`, `SamlAssertionPropagation`. |
| `samlProvider` | `String` | `authType = SamlAssertion` | — | SAML identity provider. |
| `samlACS` | `String` | `authType = SamlAssertion` | — | `""` (POST parameter), a URL path such as `"/saml/acs/sso"`, `"header"`, `"parameter:assertion"`. |
| `samlAttributes` | `String` | `authType = SamlAssertion` | — | `"name1=<property>&name2=<property>"`. |
| `samlNameId` | `Array<String>` | `authType = SamlAssertion` | — | `"email"`, `"unspecified"`. |
| `proxyType` | `Enum` | No | `none` | `none`, `http`, `socks`. |
| `proxyHost` | `String` | with a proxy | `""` | Proxy host name. |
| `proxyPort` | `Integer` | with a proxy | `0` | Proxy port. |
| `timeout` | `Integer` | No | `-1` | Connect timeout in milliseconds; `-1` = no limit (the 300 s request-session timeout still applies). |
| `remoteSID` | `String` | `authType = AssertionTicket` | — | SID of the remote ABAP system. |
| `remoteClient` | `String` | `authType = AssertionTicket` | — | Client of the remote ABAP system. |
| `oAuthAppConfigPackage` | `String` | with `oAuthAppConfig` | — | Package of the `.xsoauthappconfig`. |
| `oAuthAppConfig` | `String` | No | — | Name of the `.xsoauthappconfig` (§9). |
| `modifies` | path | extension files only | — | `modifies pkg.path.testApp:yahoo.xshttpdest;` (unquoted repository path). |
| `useProxy` | `Boolean` | No | — | Older proxy switch. The keyword list uses `proxyType`, but the `proxyHost` / `proxyPort` descriptions still refer to `useProxy = true`. |

```text
host = "download.finance.yahoo.com";
port = 443;
description = "Stock quotes";
useSSL = true;
sslAuth = anonymous;
pathPrefix = "/d/quotes.csv?f=a";
authType = none;
proxyType = none;
timeout = 5000;
```

Invalid: a line without `;` (`HANA-SYN-022`); `host = download.finance.yahoo.com;` (unquoted string); `authType = clientCertificate;` (not an allowed value); a file without `host` or `port`.

---

## 9. `.xsoauthappconfig` (OAuth Application Configuration)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md (Pages 130–135, §4.7.3.1)

An OAuth configuration needs all three files: application configuration, client configuration, client flavor.

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `clientConfig` | `String` | Yes | — | `"<path.to.package>:<ClientConfigName>"` of an `.xsoauthclientconfig`. |
| `description` | `String` | No | — | Free text. |
| `mandatoryScopes` | `Array<String>` | No | — | OAuth scopes the client always requests. |
| `optionalScopes` | `Array<String>` | No | — | Additional scopes. |
| `modifies` | `String` | No | — | `"<path.to.package>:<ObjectName>"` of the configuration this file extends. |

```json
{
  "clientConfig": "sap.hana.xs.oAuth.lib.providerconfig.providermodel:abap_ac",
  "description": "ABAP test application for OAuth",
  "mandatoryScopes": ["OAUTH2_TEST_SCOPE1"],
  "optionalScopes": ["OAUTH2_TEST_SCOPE3"]
}
```

Invalid: no `clientConfig`; `"mandatoryScopes": "OAUTH2_TEST_SCOPE1"` (array required).

---

## 10. `.xsoauthclientconfig` and `.xsoauthclientflavor`

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/006_4_Setting_Up_Your_Application.md (Pages 135–143, §4.7.3.2–4.7.3.3)

### 10.1 `.xsoauthclientconfig`

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `clientFlavor` | `String` | Yes | — | `"<path.to.package>:<FlavorName>"` of an `.xsoauthclientflavor`. |
| `clientID` | `String` | Yes | — | Client ID registered at the authorization server. |
| `clientAuthType` | `Enum` | Yes | — | `"basic"` (user and password), `"cert"` (client certificate). |
| `authorizationEndpointURL` | `String` | Yes | — | `"/sap/bc/sec/oauth2/authorize"`. |
| `tokenEndpointURL` | `String` | Yes | — | `"/sap/bc/sec/oauth2/token"`. |
| `revocationEndpointURL` | `String` | Yes | — | `"/sap/bc/sec/oauth2/revoke"`. |
| `flow` | `Enum` | Yes | — | `"saml2Bearer"`, `"authCode"`. |
| `description` | `String` | No | — | Free text. |
| `samlIssuer` | `String` | `flow = saml2Bearer` | — | SAML issuer ID. |
| `redirectURL` | `String` | `flow = authCode` | — | `"<HOST>:<PORT>/sap/hana/xs/oAuth/lib/runtime/tokenRequest.xsjs"`. |
| `scopeReq` | `Enum` | No | — | `"maxScopes"` (only value implemented), `"iterativeScopes"`. |
| `shared` | `String` (`"true"` / `"false"`) | No | — | Whether applications share the configuration. Only `"true"` is implemented. |
| `modifies` | `String` | No | — | Configuration this file extends. |

### 10.2 `.xsoauthclientflavor`

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `parameters` | `Array<Object>` | Yes | — | Root key: one entry per request parameter. |
| `parameters[].flavorStep` | `Enum` | Yes | — | `1Aut`, `2Gra`, `3Prc`, `4Ref`, `5Rev`, `saml`. The extracted value list prints `IAut`, an OCR artifact; the same section's example uses `1Aut`. |
| `parameters[].paramLocation` | `Enum` | Yes | — | `uri`, `head` (request header), `para` (request body). |
| `parameters[].paramName` | `String` | Yes | — | Parameter name (`"client_id"`, `"token"`). |
| `parameters[].paramValue` | `String` | Yes | — | Value or name of the value to evaluate. |
| `parameters[].valueType` | `Enum` | Yes | — | `litr` (literal), `eval` (evaluated by the runtime), `sec` (evaluated securely). |
| `parameters[].paramMandatory` | `String` (`"true"` / `"false"`) | Yes | — | Whether the parameter is required. |

```json
{
  "parameters": [
    { "flavorStep": "1Aut", "paramLocation": "uri", "paramName": "client_id", "paramValue": "client_id", "valueType": "eval", "paramMandatory": "true" },
    { "flavorStep": "2Gra", "paramLocation": "head", "paramName": "Authorization", "paramValue": "Basic Authentication", "valueType": "sec", "paramMandatory": "true" }
  ]
}
```

Invalid: `"flow": "clientCredentials"`; `"clientAuthType": "oauth"`; `"paramLocation": "body"` (use `para`); `"paramMandatory": true` (the reference uses the strings `"true"` / `"false"`).

---

## 11. `.hdbsynonym` (XS Classic Variant)

> Source: research/refs/extracted/SAP_HANA_PLATFORM_SAP_HANA_Developer_Guide_for_SAP_HANA_Studio_en/007_5_Setting_up_the_Data_Persistence_Model_in_SAP_HANA.md (Pages 308–312, §5.2.6)

One synonym per file. The root key is the synonym's full repository name, and it must match the file (`MySynonym1.hdbsynonym` in package `acme.com.app1` → `"acme.com.app1::MySynonym1"`). The target must be a catalog-only object: neither another synonym nor an object created from a design-time artifact.

| Key | Type | Required | Default | Allowed values / constraints |
| :--- | :--- | :---: | :--- | :--- |
| `"<package>::<name>"` | `Object` | Yes | — | Root key; exactly one. |
| `.target` | `Object` | Yes | — | |
| `.target.schema` | `String` | Yes | — | Authoring schema of the target, resolved through the system's schema mapping. |
| `.target.object` | `String` | Yes | — | Catalog object name. |
| `.schema` | `String` | Yes | — | Schema in which the synonym is created. |

```json
{
  "acme.com.app1::MySynonym1": {
    "target": { "schema": "DEFAULT_SCHEMA", "object": "MY_ERP_TABLE_1" },
    "schema": "SCHEMA_2"
  }
}
```

Invalid: two root keys (one synonym per file); a root key that does not match the file and package; a target that is a synonym.

---

## 12. IntelliSense Coverage

`src/sql/artifact-intellisense.ts` offers key completion and hover for `.xsaccess` (§3) and `.xshttpdest` (§8). The tables there follow this spec; the other artifacts of this file have highlighting, formatting and syntax checks only.

**Not in corpus** (accepted by the grammar, no completion): none for `.xsaccess`. Earlier completion lists offered `mime_types`, `max_request_runtime`, `authentication.realm`, `cors.allowCredential`, `headers.custom` and `headers.x_frame_options`, which the reference does not document. They were removed (#65).
