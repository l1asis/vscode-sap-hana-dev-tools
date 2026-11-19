-- Conformance fixtures: hierarchy functions. Re-authored minimal snippets.
-- Format: docs/specs/diagnostics/conformance-harness.md

-- @case hierarchy generator over parent-child source
SELECT hierarchy_rank, hierarchy_level, node_id
FROM HIERARCHY (SOURCE (SELECT node_id, parent_id FROM org_edges) SIBLING ORDER BY node_id)
ORDER BY hierarchy_rank;

-- @case hierarchy descendants navigation
SELECT node_id, hierarchy_distance
FROM HIERARCHY_DESCENDANTS (SOURCE HIERARCHY (SOURCE org_edges) START WHERE node_id = 'ROOT' DISTANCE FROM 1 TO 2);

-- @case hierarchy generator with every generator clause
SELECT hierarchy_rank, node_id
FROM HIERARCHY (
    SOURCE (SELECT node_id, parent_id, ord FROM org_edges)
    START WHERE parent_id IS NULL
    SIBLING ORDER BY ord DESC NULLS LAST
    DEPTH 4
    MULTIPARENT LEAVES
    ORPHAN ADOPT
    CYCLE ERROR
    CACHE FORCE
    LOAD INCREMENTAL
);

-- @case spantree generator with no cache and string load option
SELECT node_id FROM HIERARCHY_SPANTREE (SOURCE org_edges SIBLING ORDER BY ord NO CACHE LOAD 'bulk');

-- @case temporal generator with validity interval
SELECT node_id
FROM HIERARCHY_TEMPORAL (
    SOURCE org_edges_temporal
    SIBLING ORDER BY ord
    VALID FROM '2024-01-01' EXCLUDED UNTIL '2025-01-01' EXCLUDED
    ORPHAN IGNORE
);

-- @case leveled generator with retained nulls
SELECT hierarchy_level_name, node_id
FROM HIERARCHY_LEVELED (SOURCE region_levels LEVELS (lvl_country, lvl_city) SIBLING ORDER BY lvl_country RETAIN NULLS 'not trailing');

-- @case ancestors and siblings navigation
SELECT node_id FROM HIERARCHY_ANCESTORS (SOURCE HIERARCHY (SOURCE org_edges) START WHERE node_id = 'C4' DISTANCE -2);
SELECT node_id FROM HIERARCHY_SIBLINGS (SOURCE HIERARCHY (SOURCE org_edges) START WHERE node_id = 'C4');

-- @case descendants aggregate with join, measures and totals
SELECT node_id, sum_amount
FROM HIERARCHY_DESCENDANTS_AGGREGATE (
    SOURCE HIERARCHY (SOURCE org_edges)
    JOIN sales s ON s.node_id = node_id
    MEASURES (SUM(s.amount) AS sum_amount, COUNT(DISTINCT s.customer_id) AS customers)
    WHERE hierarchy_level <= 2
    WITH SUBTOTAL '(subtotal)'
    WITH NOT MATCHED '(unassigned)'
    WITH TOTAL
);

-- @case ancestors aggregate inside a view
CREATE VIEW org_paths AS
SELECT node_id, path_names
FROM HIERARCHY_ANCESTORS_AGGREGATE (
    SOURCE HIERARCHY (SOURCE org_edges)
    START WHERE node_id = 'C4'
    MEASURES (STRING_AGG(node_name, '/') AS path_names)
);
