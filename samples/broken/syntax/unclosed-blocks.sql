-- HANA-SYN-020: IF is closed by END LOOP instead of END IF.
DO BEGIN
  DECLARE v_total INTEGER = 0;
  IF :v_total > 10 THEN
    v_total = 10;
  END LOOP;
END;
