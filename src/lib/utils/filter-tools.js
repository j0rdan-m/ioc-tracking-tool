/**
 * Pure, framework-agnostic helpers consumed by the UI and unit tests.
 */

/**
 * @param {import('../types.js').Tool} tool
 * @param {string} normalizedQuery
 * @returns {boolean}
 */
function matchesQuery(tool, normalizedQuery) {
  if (normalizedQuery === '') {
    return true;
  }
  const haystack = [tool.name, tool.description, tool.url, ...tool.tags].join(' ').toLowerCase();
  return haystack.includes(normalizedQuery);
}

/**
 * Filters tools by free-text query (name, description, tags, URL), category and
 * IoC type. Facets combine with AND; 'all' disables a facet.
 *
 * @param {import('../types.js').Tool[]} tools
 * @param {string} query Raw user input.
 * @param {string} categoryId Category identifier, or 'all' to keep everything.
 * @param {string} [iocTypeId='all'] IoC type identifier, or 'all' to keep everything.
 * @returns {import('../types.js').Tool[]}
 */
export function filterTools(tools, query, categoryId, iocTypeId = 'all') {
  const normalizedQuery = query.trim().toLowerCase();
  return tools.filter((tool) => {
    const matchesCategory = categoryId === 'all' || tool.categoryId === categoryId;
    const matchesIocType = iocTypeId === 'all' || tool.iocTypes.includes(iocTypeId);
    return matchesCategory && matchesIocType && matchesQuery(tool, normalizedQuery);
  });
}

/**
 * Counts tools per category id, plus an 'all' entry for the global count.
 *
 * @param {import('../types.js').Tool[]} tools
 * @returns {Map<string, number>}
 */
export function countToolsByCategory(tools) {
  /** @type {Map<string, number>} */
  const counts = new Map([['all', tools.length]]);
  for (const tool of tools) {
    counts.set(tool.categoryId, (counts.get(tool.categoryId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Counts tools per IoC type id (a tool handling several types counts once per
 * type), plus an 'all' entry for the global count.
 *
 * @param {import('../types.js').Tool[]} tools
 * @returns {Map<string, number>}
 */
export function countToolsByIocType(tools) {
  /** @type {Map<string, number>} */
  const counts = new Map([['all', tools.length]]);
  for (const tool of tools) {
    for (const iocTypeId of tool.iocTypes) {
      counts.set(iocTypeId, (counts.get(iocTypeId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Pure state transition for the auto-applied IoC-type filter, consumed by the
 * App effect. While the query is a recognizable IoC, the filter always follows
 * the detected type (re-pasting an observable re-applies it, even after a
 * manual pick); when it stops being one, the filter resets to 'all' only if it
 * still holds the auto-applied value, so a manual pick survives.
 *
 * @param {string|null} detected IoC type detected in the query (null if none).
 * @param {string} selectedId Currently selected IoC-type filter id.
 * @param {string|null} lastAuto IoC type auto-applied by the previous transition.
 * @returns {{ selectedId: string, lastAuto: string|null }}
 */
export function nextAutoIocFilter(detected, selectedId, lastAuto) {
  if (detected) {
    return { selectedId: detected, lastAuto: detected };
  }
  if (lastAuto !== null && selectedId === lastAuto) {
    return { selectedId: 'all', lastAuto: null };
  }
  return { selectedId, lastAuto: null };
}
