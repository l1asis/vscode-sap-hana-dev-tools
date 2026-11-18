-- Conformance fixtures: data manipulation. Re-authored minimal snippets (not copied from SAP docs).
-- Format: docs/specs/diagnostics/conformance-harness.md

-- @case insert values with column list
INSERT INTO employees (emp_id, last_name, salary) VALUES (1, 'Smith', 4200);

-- @case insert from select
INSERT INTO archive_emps SELECT * FROM employees WHERE active = 0;

-- @case update with expression
UPDATE employees SET salary = salary * 1.05, updated_at = CURRENT_TIMESTAMP WHERE dept_id = 10;

-- @case update from join source
UPDATE employees e SET e.dept_name = d.dept_name FROM employees e, departments d WHERE e.dept_id = d.dept_id;

-- @case delete with subquery
DELETE FROM employees WHERE dept_id NOT IN (SELECT dept_id FROM departments);

-- @case upsert with primary key
UPSERT employees (emp_id, salary) VALUES (1, 5000) WITH PRIMARY KEY;

-- @case replace statement
REPLACE employees VALUES (2, 'Jones', 3900) WHERE emp_id = 2;

-- @case merge into with both branches
-- @todo grammar #79 unscoped MATCHED
MERGE INTO employees t USING staged_emps s ON t.emp_id = s.emp_id
WHEN MATCHED THEN UPDATE SET t.salary = s.salary
WHEN NOT MATCHED THEN INSERT VALUES (s.emp_id, s.last_name, s.salary);

-- @case truncate table
TRUNCATE TABLE staging_area;

-- @case transaction control
-- @todo grammar #79 unscoped READ
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
COMMIT;
ROLLBACK;

-- @case load and unload
LOAD employees ALL;
UNLOAD employees DELETE PERSISTENT MEMORY;
