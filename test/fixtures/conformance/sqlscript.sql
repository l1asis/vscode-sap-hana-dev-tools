-- Conformance fixtures: SQLScript. Re-authored minimal snippets (not copied from SAP docs).
-- Format: docs/specs/diagnostics/conformance-harness.md

-- @case anonymous block with declarations
DO BEGIN
  DECLARE v_count INTEGER = 0;
  DECLARE v_label NVARCHAR(20) DEFAULT 'none';
  SELECT COUNT(*) INTO v_count FROM employees;
  v_label = 'counted';
END;

-- @case procedure with parameters and table output
CREATE PROCEDURE get_dept_emps (IN p_dept INTEGER, OUT et_emps TABLE (emp_id INTEGER, last_name NVARCHAR(40)))
LANGUAGE SQLSCRIPT
SQL SECURITY INVOKER
READS SQL DATA
AS
BEGIN
  et_emps = SELECT emp_id, last_name FROM employees WHERE dept_id = :p_dept;
END;

-- @case scalar function
CREATE FUNCTION add_tax (p_amount DECIMAL(15, 2))
RETURNS r_amount DECIMAL(15, 2)
LANGUAGE SQLSCRIPT
AS
BEGIN
  r_amount = :p_amount * 1.2;
END;

-- @case table function
CREATE FUNCTION top_earners (p_limit INTEGER)
RETURNS TABLE (emp_id INTEGER, salary DECIMAL(15, 2))
LANGUAGE SQLSCRIPT
READS SQL DATA
AS
BEGIN
  RETURN SELECT emp_id, salary FROM employees ORDER BY salary DESC LIMIT :p_limit;
END;

-- @case if elseif else
DO BEGIN
  DECLARE v_n INTEGER = 5;
  IF :v_n > 10 THEN
    v_n = 10;
  ELSEIF :v_n < 0 THEN
    v_n = 0;
  ELSE
    v_n = :v_n + 1;
  END IF;
END;

-- @case for range loop
DO BEGIN
  DECLARE v_sum INTEGER = 0;
  DECLARE i INTEGER;
  FOR i IN 1 .. 10 DO
    v_sum = :v_sum + :i;
  END FOR;
END;

-- @case while loop with break and continue
DO BEGIN
  DECLARE i INTEGER = 0;
  WHILE :i < 100 DO
    i = :i + 1;
    IF MOD(:i, 2) = 0 THEN
      CONTINUE;
    END IF;
    IF :i > 50 THEN
      BREAK;
    END IF;
  END WHILE;
END;

-- @case cursor loop
DO BEGIN
  DECLARE CURSOR c_emps FOR SELECT emp_id, salary FROM employees;
  DECLARE v_total DECIMAL(15, 2) = 0;
  FOR r AS c_emps DO
    v_total = :v_total + r.salary;
  END FOR;
END;

-- @case cursor with parameters and explicit fetch
DO BEGIN
  DECLARE v_id INTEGER;
  DECLARE CURSOR c_dept (p_dept INTEGER) FOR SELECT emp_id FROM employees WHERE dept_id = :p_dept;
  OPEN c_dept(10);
  FETCH c_dept INTO v_id;
  CLOSE c_dept;
END;

-- @case exit handler and signal
DO BEGIN
  DECLARE invalid_input CONDITION FOR SQL_ERROR_CODE 10001;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SELECT ::SQL_ERROR_CODE, ::SQL_ERROR_MESSAGE FROM DUMMY;
  END;
  SIGNAL invalid_input SET MESSAGE_TEXT = 'bad input';
END;

-- @case table variables and table operators
DO BEGIN
  DECLARE lt_emps TABLE (emp_id INTEGER, salary DECIMAL(15, 2));
  lt_emps = SELECT emp_id, salary FROM employees;
  :lt_emps.INSERT((99, 1000));
  SELECT COUNT(*) FROM :lt_emps;
END;

-- @case arrays and cardinality
DO BEGIN
  DECLARE a_ids INTEGER ARRAY = ARRAY(1, 2, 3);
  DECLARE v_len INTEGER;
  a_ids[4] = 4;
  v_len = CARDINALITY(:a_ids);
END;

-- @case dynamic SQL with into and using
DO BEGIN
  DECLARE v_cnt INTEGER;
  EXEC 'SELECT COUNT(*) FROM employees WHERE dept_id = ?' INTO v_cnt USING 10;
  EXECUTE IMMEDIATE 'TRUNCATE TABLE staging_area';
END;

-- @case call procedure with named parameters
CALL get_dept_emps(p_dept => 10, et_emps => ?);

-- @case library usage
DO BEGIN
  USING SQLSCRIPT_STRING AS lib;
  DECLARE v_parts TABLE (piece NVARCHAR(100));
  v_parts = lib:SPLIT_TO_TABLE('a,b,c', ',');
END;

-- @case autonomous transaction block
-- @todo syntax #78 false HANA-SYN-025 at "INSERT"
CREATE PROCEDURE log_event (IN p_msg NVARCHAR(200))
AS
BEGIN
  BEGIN AUTONOMOUS TRANSACTION
    INSERT INTO event_log VALUES (CURRENT_TIMESTAMP, :p_msg);
  END;
END;

-- @case record_count and is_empty on table variables
DO BEGIN
  DECLARE lt TABLE (id INTEGER);
  DECLARE n INTEGER;
  lt = SELECT emp_id AS id FROM employees;
  IF NOT IS_EMPTY(:lt) THEN
    n = RECORD_COUNT(:lt);
  END IF;
END;

-- @case drop procedure and function
DROP PROCEDURE get_dept_emps;
DROP FUNCTION add_tax;
