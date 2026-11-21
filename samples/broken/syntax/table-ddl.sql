-- Missing commas and misspelled attribute keywords in table, index, statistics and partition DDL (#101).
-- Each statement has one mistake. Apply the QuickFix (Ctrl+.) to repair it.

-- Missing ',' after a column attribute, before created_at
CREATE COLUMN TABLE app_orders (
  order_id INTEGER CS_INT NOT NULL,
  customer NVARCHAR(100) DEFAULT 'n/a'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id)
);

-- Missing ',' before a table constraint
CREATE COLUMN TABLE app_lines (
  line_id INTEGER NOT NULL,
  order_id INTEGER DEFAULT 0
  PRIMARY KEY (line_id)
);

-- Missing ',' in an ALTER TABLE column list
ALTER TABLE app_orders ADD (note NVARCHAR(200) COMMENT 'free text' priority TINYINT);

-- Missing ',' in index, statistics and partition column lists
CREATE INDEX app_orders_idx ON app_orders (customer created_at);
CREATE STATISTICS app_orders_stats ON app_orders (customer created_at);
CREATE COLUMN TABLE app_events (event_id INT, region_id INT) PARTITION BY HASH (event_id region_id) PARTITIONS 4;

-- Missing ',' in a window PARTITION BY list
SELECT order_id, ROW_NUMBER() OVER (PARTITION BY customer created_at ORDER BY order_id) AS rn FROM app_orders;

-- Misspelled column attribute keywords
CREATE COLUMN TABLE app_flags (flag_id INTEGER PRIMARYKEY, flag_code NVARCHAR(10));
CREATE COLUMN TABLE app_codes (code_id INTEGER NOT NULL, code_text NVARCHAR(10) DEFALT 'x');
