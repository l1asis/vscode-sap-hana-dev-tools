-- HANA-SYN-005: `//` does not start a SQL comment (QuickFix rewrites it to `--`).
SELECT order_id FROM orders; // legacy note copied from JavaScript
