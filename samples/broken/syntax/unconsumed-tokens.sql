-- HANA-SYN-042: a second alias after the table alias.
SELECT o.order_id FROM orders o extra_alias;
