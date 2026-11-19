-- Conformance fixtures: security and system administration. Re-authored minimal snippets.
-- Format: docs/specs/diagnostics/conformance-harness.md

-- @case create user and role
CREATE USER report_user PASSWORD Initial1234 NO FORCE_FIRST_PASSWORD_CHANGE;
CREATE ROLE reporting;

-- @case grant and revoke privileges
GRANT SELECT, INSERT ON employees TO reporting;
GRANT SELECT ON SCHEMA sales_area TO reporting WITH GRANT OPTION;
GRANT reporting TO report_user;
REVOKE INSERT ON employees FROM reporting;

-- @case alter and drop user
ALTER USER report_user DEACTIVATE USER NOW;
DROP USER report_user CASCADE;

-- @case usergroup with connect restriction
-- @todo syntax #78 false HANA-SYN-023 at "IP", "APPLICATION"
CREATE USERGROUP analysts CONNECT RESTRICTION (lan_only IP ('10.20.0.0/16') APPLICATION ('reporting_app'));

-- @case usergroup with parameter set
-- @todo syntax #78 false HANA-SYN-024 at "ENABLE", "PARAMETER"
CREATE USERGROUP auditors SET PARAMETER 'minimal_password_length' = '12' ENABLE PARAMETER SET;

-- @case alter system configuration with reconfigure
ALTER SYSTEM ALTER CONFIGURATION ('indexserver.ini', 'SYSTEM') SET ('sql', 'plan_cache_size') = '4000000' WITH RECONFIGURE;

-- @case alter system clear plan cache
ALTER SYSTEM CLEAR SQL PLAN CACHE;

-- @case set schema and session variable
SET SCHEMA sales_area;
SET 'APPLICATION' = 'reporting_app';

-- @case explain plan
-- @todo syntax #78 false HANA-SYN-024 at "FOR"
EXPLAIN PLAN SET STATEMENT_NAME = 'emp_scan' FOR SELECT * FROM employees;
