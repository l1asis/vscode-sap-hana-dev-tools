-- Conformance fixtures: hierarchy functions. Re-authored minimal snippets.
-- Format: docs/specs/diagnostics/conformance-harness.md

-- @case hierarchy generator over parent-child source
-- @todo grammar #75 unscoped SOURCE
SELECT hierarchy_rank, hierarchy_level, node_id
FROM HIERARCHY (SOURCE (SELECT node_id, parent_id FROM org_edges) SIBLING ORDER BY node_id)
ORDER BY hierarchy_rank;

-- @case hierarchy descendants navigation
-- @todo grammar #75 unscoped SOURCE, TO
SELECT node_id, hierarchy_distance
FROM HIERARCHY_DESCENDANTS (SOURCE HIERARCHY (SOURCE org_edges) START WHERE node_id = 'ROOT' DISTANCE FROM 1 TO 2);
