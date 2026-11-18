-- HANA-SYN-001: the string literal below is never closed.
SELECT order_id, 'pending AS status_label FROM orders;
