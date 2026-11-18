-- HANA-SYN-027: ORDER BY before WHERE.
SELECT order_id FROM orders ORDER BY order_id WHERE amount > 100;
