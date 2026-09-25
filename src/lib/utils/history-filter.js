/**
 * Pure helpers behind the local investigation history: the analysis snapshot
 * that gets stored, tag collection and the history search / filters.
 *
 * No DOM, no network — exercised by `npm run smoke`.
 */

import { sanitizeProviderAnalysis } from './provider-response.js';

/**
 * Builds the storable snapshot of a finished analysis (provider results only:
 * never a verdict, which stays an analyst input).
 *
 * @param {{ def: import('../types.js').FastCheckDefinition, status: string,
 *           result: import('../types.js').FastCheckResult | null,
 *           ms: number | null }[]} checkStates
 * @param {string} checkedAt ISO timestamp of the run.
 * @returns {import('../types.js').InvestigationAnalysisSnapshot}
 */
export function buildAnalysisSnapshot(checkStates, checkedAt) {
  return sanitizeProviderAnalysis({
    checkedAt,
    checks: checkStates.map((state) => ({
      id: state.def.id,
      label: state.def.label,
      toolId: state.def.toolId ?? null,
      status: state.status,
      ms: state.ms,
      summary: state.result?.summary ?? null,
      fields: state.result?.fields ?? [],
      message: state.result?.message ?? null,
      raw: state.result?.raw ?? null,
    })),
  }) ?? { checkedAt, checks: [] };
}

/**
 * @param {import('../types.js').InvestigationEntry[]} entries
 * @returns {string[]} Distinct tags of the history, alphabetically sorted.
 */
export function collectTags(entries) {
  const tags = new Set();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      tags.add(tag);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/**
 * Normalizes a tag typed by the analyst: trimmed, lowercased, inner spaces
 * turned into dashes so `Brute Force` and `brute-force` are one tag.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeTag(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Searches and filters the history: the query matches the normalized or the
 * defanged value, the type, the tags or the notes (AC08), and each facet can
 * narrow the list further (AC09).
 *
 * @param {import('../types.js').InvestigationEntry[]} entries
 * @param {{ query?: string, typeId?: string, verdict?: string, tag?: string }} [filters]
 * @returns {import('../types.js').InvestigationEntry[]} Matching entries, input order kept.
 */
export function filterInvestigations(entries, filters = {}) {
  const query = (filters.query ?? '').trim().toLowerCase();
  const typeId = filters.typeId ?? 'all';
  const verdict = filters.verdict ?? 'all';
  const tag = filters.tag ?? 'all';
  return entries.filter((entry) => {
    if (typeId !== 'all' && entry.typeId !== typeId) {
      return false;
    }
    if (verdict !== 'all' && entry.verdict !== verdict) {
      return false;
    }
    if (tag !== 'all' && !entry.tags.includes(tag)) {
      return false;
    }
    if (query === '') {
      return true;
    }
    const haystack = [
      entry.normalized,
      entry.defanged,
      entry.typeId,
      entry.tags.join(' '),
      entry.notes,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}
