-- HANA-SYN-040: the routine header is missing AS before BEGIN.
CREATE PROCEDURE archive_orders ()
LANGUAGE SQLSCRIPT
BEGIN
  DELETE FROM orders WHERE archived = 1;
END;
