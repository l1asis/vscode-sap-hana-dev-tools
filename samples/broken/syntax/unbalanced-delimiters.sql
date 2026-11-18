-- HANA-SYN-003: one closing parenthesis is missing, one is extra.
SELECT order_id FROM orders WHERE (amount > 100 AND (region = 'EU' OR region = 'US');
SELECT customer_id FROM customers WHERE active = 1);
