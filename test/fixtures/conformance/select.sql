-- Conformance fixtures: queries. Re-authored minimal snippets (not copied from SAP docs).
-- Format: docs/specs/diagnostics/conformance-harness.md

-- @case projection with aliases
SELECT emp_id, last_name AS surname, salary * 12 annual FROM employees;

-- @case where with logical operators and IN list
SELECT emp_id FROM employees WHERE dept_id IN (10, 20, 30) AND (salary > 1000 OR grade = 'A') AND NOT active = 0;

-- @case between, like, is null
SELECT emp_id FROM employees WHERE hired BETWEEN '2020-01-01' AND '2020-12-31' AND last_name LIKE 'Sm%' AND manager_id IS NOT NULL;

-- @case inner and left outer joins
SELECT e.emp_id, d.dept_name, l.city
FROM employees e
INNER JOIN departments d ON d.dept_id = e.dept_id
LEFT OUTER JOIN locations l ON l.loc_id = d.loc_id;

-- @case group by having order by
SELECT dept_id, COUNT(*) AS cnt, AVG(salary) AS avg_sal
FROM employees
GROUP BY dept_id
HAVING COUNT(*) > 5
ORDER BY avg_sal DESC;

-- @case limit and offset
SELECT emp_id FROM employees ORDER BY emp_id LIMIT 10 OFFSET 20;

-- @case common table expression
WITH dept_totals AS (SELECT dept_id, SUM(salary) AS total FROM employees GROUP BY dept_id)
SELECT dept_id, total FROM dept_totals WHERE total > 100000;

-- @case set operations
SELECT emp_id FROM employees UNION ALL SELECT emp_id FROM contractors EXCEPT SELECT emp_id FROM terminated;

-- @case scalar and exists subqueries
SELECT d.dept_id, (SELECT MAX(salary) FROM employees e WHERE e.dept_id = d.dept_id) AS top_sal
FROM departments d
WHERE EXISTS (SELECT 1 FROM employees e WHERE e.dept_id = d.dept_id);

-- @case searched and simple CASE
SELECT emp_id,
  CASE WHEN salary > 5000 THEN 'high' WHEN salary > 2000 THEN 'mid' ELSE 'low' END AS band,
  CASE grade WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END AS grade_no
FROM employees;

-- @case string, date and conversion functions
SELECT UPPER(last_name), SUBSTRING(first_name, 1, 3), ADD_DAYS(CURRENT_DATE, 7), TO_VARCHAR(salary), COALESCE(bonus, 0)
FROM employees;

-- @case LEFT and RIGHT functions after a logical operator
SELECT emp_id FROM employees WHERE active = 1 AND LEFT(last_name, 2) = 'Sm' OR RIGHT(last_name, 1) = 'z';

-- @case typed literals
SELECT DATE'2024-01-31', TIMESTAMP'2024-01-31 10:00:00', N'unicode', X'0AFF', 1.5E3 FROM DUMMY;

-- @case hexadecimal numeric literal
SELECT 0x0abc "hex_value" FROM DUMMY;

-- @case aggregate with DISTINCT and string_agg
SELECT dept_id, COUNT(DISTINCT grade), STRING_AGG(last_name, ', ' ORDER BY last_name) FROM employees GROUP BY dept_id;

-- @case window function with partition and order
SELECT emp_id, RANK() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rnk FROM employees;

-- @case window frame clause
-- @todo grammar #79 unscoped PRECEDING, ROWS, UNBOUNDED
SELECT emp_id, SUM(salary) OVER (ORDER BY hired ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running FROM employees;

-- @case statement hint
-- @todo grammar #79 unscoped HINT
SELECT emp_id FROM employees WITH HINT (NO_INLINE);

-- @case ORDER BY NULLS LAST
-- @todo grammar #79 unscoped LAST, NULLS
SELECT emp_id FROM employees ORDER BY bonus DESC NULLS LAST;

-- @case parameter markers and session functions
SELECT emp_id FROM employees WHERE dept_id = ? AND created_by = CURRENT_USER;

-- @case table sample and FOR UPDATE
SELECT emp_id FROM employees WHERE dept_id = 10 FOR UPDATE;

-- @case series generate table function
-- @todo syntax #78 false HANA-SYN-023 at "TABLE", "sales_series"
-- @todo grammar #79 unscoped SERIES
SELECT * FROM SERIES_GENERATE(SERIES TABLE sales_series);

-- @case comments are preserved around clauses
-- leading comment
SELECT emp_id /* the key */, last_name -- trailing note
FROM employees; /* after */
