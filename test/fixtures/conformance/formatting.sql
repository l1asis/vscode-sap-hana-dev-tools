-- Conformance fixtures: formatter safety (comments, pragmas, literals). Re-authored snippets.
-- Format: docs/specs/diagnostics/conformance-harness.md

-- @case format-off region is untouched
-- hanasql-format off
select   a ,b
  from   t;
-- hanasql-format on
select 1 from dummy;

-- @case unterminated format-off region runs to the end
select 1 from dummy;
-- hanasql-format off
select   keep ,   this   from t;

-- @case multiline string literal is not reflowed
SELECT 'line one
   line two  with  spaces' AS txt FROM DUMMY;

-- @case quoted identifiers with escaped quotes and keywords
SELECT "Select", "my""col", "FROM" FROM "my.schema"."some::Table";

-- @case block comment between tokens and nested-looking markers
SELECT /* -- not a line comment */ a FROM t /* a /* b */;

-- @case operators keep their spelling
SELECT a FROM t WHERE a <> 1 AND b != 2 AND c >= 3 AND d <= 4 AND e || f = 'x';

-- @case lowercase input is re-cased without changing words
select e.emp_id, count(*) from employees e where e.dept_id = 10 group by e.emp_id;

-- @case semicolon-free last statement
SELECT 1 FROM DUMMY

-- @case embedded queries: table variable assignment, WITH, set operators and RETURN (#64)
CREATE FUNCTION top_customers (p_min DECIMAL(15, 2))
RETURNS TABLE (customer_id INTEGER, total DECIMAL(15, 2))
LANGUAGE SQLSCRIPT
AS
BEGIN
  lt_orders = SELECT o.customer_id, SUM(o.amount) AS total FROM orders o INNER JOIN customers c ON c.id = o.customer_id WHERE o.status = 'A' AND o.amount > 0 GROUP BY o.customer_id;
  lt_all := WITH big AS (SELECT customer_id, total FROM :lt_orders WHERE total >= :p_min) SELECT customer_id, total FROM big UNION ALL SELECT customer_id, 0 FROM :lt_orders WHERE total < :p_min;
  RETURN SELECT customer_id, total FROM (SELECT customer_id, total FROM :lt_all) s ORDER BY total DESC;
END;

-- @case embedded query with comments after the prefix
DO BEGIN
  lt = -- all rows
    SELECT a, /* first */ b FROM t;
  lt2 /* note */ = SELECT a FROM :lt;
END;
