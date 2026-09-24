/**
 * Pure graph view helpers for the V2 workspace: facet filters (V2 AC13),
 * neighborhood isolation (US V2 "Focus neighborhood") and search matches
 * (V2 AC14). The graph component only renders what these functions return —
 * no DOM, no network, no Svelte — exercised by `npm run smoke`.
 *
 * @typedef {import('../types.js').WorkspaceNode} WorkspaceNode
 * @typedef {import('../types.js').WorkspaceRelationship} WorkspaceRelationship
 */

/**
 * Collects the ids of `rootId` and everything connected to it within `depth`
 * hops. Links are followed in BOTH directions: an IP reached from a domain is
 * part of the same neighbourhood as the domain that points at it.
 *
 * @param {WorkspaceRelationship[]} relationships
 * @param {string} rootId
 * @param {number} depth Hops from the root (0 = only the root).
 * @returns {Set<string>}
 */
export function neighborhoodIds(relationships, rootId, depth) {
  const found = new Set([rootId]);
  if (depth <= 0 || !Array.isArray(relationships)) {
    return found;
  }
  let frontier = new Set([rootId]);
  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set();
    for (const relationship of relationships) {
      const forward = frontier.has(relationship.sourceId) ? relationship.targetId : null;
      const backward = frontier.has(relationship.targetId) ? relationship.sourceId : null;
      for (const candidate of [forward, backward]) {
        if (candidate && !found.has(candidate)) {
          found.add(candidate);
          next.add(candidate);
        }
      }
    }
    if (next.size === 0) {
      break;
    }
    frontier = next;
  }
  return found;
}

/**
 * Normalizes a facet selection: `['all']`, `[]` or a missing facet means
 * "everything visible"; otherwise the set of allowed values.
 *
 * @param {unknown} list
 * @returns {Set<string> | null}
 */
function normalizeFacet(list) {
  if (!Array.isArray(list)) {
    return null;
  }
  const values = list.filter(
    (value) => typeof value === 'string' && value !== '' && value !== 'all',
  );
  return values.length > 0 ? new Set(values) : null;
}

/**
 * @typedef {Object} GraphFilters
 * @property {string[]} [types] Visible node types (`['all']`/empty = every
 *   type) — minimum facet of V2 AC13.
 * @property {string[]} [verdicts] Visible verdicts (`['all']`/empty = all).
 * @property {string[]} [sources] Visible relationship provenance kinds
 *   (`provider`, `derived`, `analyst`; empty/`['all']` = all).
 * @property {string[]} [sourceTypes] Alias for `sources`, kept explicit for callers.
 * @property {boolean} [includeHidden] Also render nodes hidden from the graph.
 * @property {string} [focusId] Root of the neighborhood isolation.
 * @property {number} [focusDepth] Hops of the isolation (default 1).
 * @property {string} [query] Search text; matching nodes are returned in
 *   `matchIds` so the UI can highlight them without hiding the rest (AC14).
 */

/**
 * Applies every facet to the graph data. Relationships survive only when BOTH
 * endpoints are visible, so a filtered graph never shows dangling edges.
 *
 * @param {WorkspaceNode[]} nodes
 * @param {WorkspaceRelationship[]} relationships
 * @param {GraphFilters} [filters]
 * @returns {{ nodes: WorkspaceNode[], relationships: WorkspaceRelationship[],
 *             matchIds: Set<string> }}
 */
export function filterGraph(nodes, relationships, filters = {}) {
  const all = Array.isArray(nodes) ? nodes : [];
  const rels = Array.isArray(relationships) ? relationships : [];
  const types = normalizeFacet(filters.types);
  const verdicts = normalizeFacet(filters.verdicts);
  const sources = normalizeFacet(filters.sources ?? filters.sourceTypes);
  const sourceRelationships = sources
    ? rels.filter((relationship) => sources.has(relationship.sourceType))
    : rels;
  const focus =
    typeof filters.focusId === 'string' && filters.focusId !== ''
      ? neighborhoodIds(sourceRelationships, filters.focusId, filters.focusDepth ?? 1)
      : null;
  const query = (filters.query ?? '').trim().toLowerCase();

  /** @type {Set<string>} */
  const matchIds = new Set();
  const visible = all.filter((node) => {
    if (node.hidden && !filters.includeHidden) {
      return false;
    }
    if (types && !types.has(node.typeId)) {
      return false;
    }
    if (verdicts && !verdicts.has(node.verdict)) {
      return false;
    }
    if (focus && !focus.has(node.id)) {
      return false;
    }
    if (query !== '') {
      const haystack = `${node.defanged} ${node.value}`.toLowerCase();
      if (haystack.includes(query)) {
        matchIds.add(node.id);
      }
    }
    return true;
  });

  const visibleIds = new Set(visible.map((node) => node.id));
  const visibleRelationships = sourceRelationships.filter(
    (relationship) =>
      visibleIds.has(relationship.sourceId) && visibleIds.has(relationship.targetId),
  );
  return { nodes: visible, relationships: visibleRelationships, matchIds };
}
