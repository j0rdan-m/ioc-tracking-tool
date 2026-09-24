/**
 * Pure helpers behind the V2 investigation LIST and Overview tab: text search
 * over name / description / tags / contained IoCs / notes (US V2 "Recherche
 * d'investigation") and the counters shown before entering the graph.
 *
 * No DOM, no network, no Svelte — exercised by `npm run smoke`.
 *
 * @typedef {import('../types.js').WorkspaceInvestigation} WorkspaceInvestigation
 */

/** Human labels of the workflow statuses (advancement, never a threat call). */
export const STATUS_LABELS = Object.freeze({
  open: 'Open',
  'in-progress': 'In progress',
  closed: 'Closed',
});

/** Human labels of the analyst verdicts, in display order. */
export const VERDICT_LABELS = Object.freeze({
  unknown: 'Unknown',
  benign: 'Benign',
  suspicious: 'Suspicious',
  malicious: 'Malicious',
});

/**
 * Summary counters of one investigation, used by the list rows and the
 * Overview tab (US V2 "Overview").
 *
 * @param {WorkspaceInvestigation} investigation
 * @returns {{ indicators: number, relationships: number, seeds: number,
 *             verdicts: Record<'unknown' | 'benign' | 'suspicious' | 'malicious', number>,
 *             lastActivity: string }}
 */
export function investigationStats(investigation) {
  const nodes = Array.isArray(investigation?.nodes) ? investigation.nodes : [];
  const relationships = Array.isArray(investigation?.relationships)
    ? investigation.relationships
    : [];
  /** @type {Record<'unknown' | 'benign' | 'suspicious' | 'malicious', number>} */
  const verdicts = { unknown: 0, benign: 0, suspicious: 0, malicious: 0 };
  let seeds = 0;
  for (const node of nodes) {
    if (verdicts[node.verdict] !== undefined) {
      verdicts[node.verdict] += 1;
    }
    if (node.seed) {
      seeds += 1;
    }
  }
  return {
    indicators: nodes.length,
    relationships: relationships.length,
    seeds,
    verdicts,
    // The model bumps updatedAt on every mutation, so it IS the last activity.
    lastActivity: investigation?.updatedAt ?? '',
  };
}

/**
 * Searches investigations by name, description, tags, notes (global and per
 * node) and the IoCs they contain. An empty query returns a fresh copy in the
 * caller's order; the match is case-insensitive and substring-based.
 *
 * @param {WorkspaceInvestigation[]} investigations
 * @param {string} query
 * @returns {WorkspaceInvestigation[]} Matching investigations, input order kept.
 */
export function filterWorkspaceList(investigations, query) {
  const list = Array.isArray(investigations) ? investigations : [];
  const text = String(query ?? '').trim().toLowerCase();
  if (text === '') {
    return [...list];
  }
  return list.filter((investigation) => {
    const haystack = [
      investigation.name,
      investigation.description,
      investigation.tags.join(' '),
      investigation.notes,
      ...investigation.nodes.flatMap((node) => [node.defanged, node.value, node.notes]),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  });
}
