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
 * Filters tools by free-text query (name, description, tags, URL) and category.
 *
 * @param {import('../types.js').Tool[]} tools
 * @param {string} query Raw user input.
 * @param {string} categoryId Category identifier, or 'all' to keep everything.
 * @returns {import('../types.js').Tool[]}
 */
export function filterTools(tools, query, categoryId) {
  const normalizedQuery = query.trim().toLowerCase();
  return tools.filter((tool) => {
    const matchesCategory = categoryId === 'all' || tool.categoryId === categoryId;
    return matchesCategory && matchesQuery(tool, normalizedQuery);
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
