-- HANA-SYN-023: missing comma between SELECT list items.
SELECT order_id customer_id amount FROM orders;
-- HANA-SYN-024: dangling operator and trailing comma.
SELECT order_id FROM orders WHERE amount > 100 AND;
SELECT order_id, amount, FROM orders;
