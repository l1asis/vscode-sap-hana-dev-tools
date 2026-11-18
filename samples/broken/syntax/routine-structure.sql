-- HANA-SYN-028: READS SQL DATA after AS belongs in the header.
CREATE PROCEDURE count_orders () AS READS SQL DATA
BEGIN
  SELECT COUNT(*) FROM orders;
END;
