/**
 * Smoke test for the catalog and the framework-agnostic core (DI container,
 * repository, data sources, filtering). Run with `npm run smoke`.
 *
 * The composition root itself is exercised by `npm run build`, since it imports
 * the bundled JSON through Vite.
 */
import { readFileSync } from 'node:fs';
import { createContainer } from '../src/lib/di/container.js';
import { DI_TOKENS } from '../src/lib/di/tokens.js';
import { HttpToolDataSource } from '../src/lib/services/http-tool-data-source.js';
import { StaticToolDataSource } from '../src/lib/services/static-tool-data-source.js';
import { ToolRepository } from '../src/lib/services/tool-repository.js';
import { countToolsByCategory, filterTools } from '../src/lib/utils/filter-tools.js';

const catalogPath = new URL('../src/data/tools.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

// --- Catalog schema ---
const REQUIRED_FIELDS = ['id', 'name', 'url', 'categoryId', 'description', 'tags'];
for (const tool of catalog.tools) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in tool) || tool[field] === '') {
      throw new Error(`Catalog: missing field "${field}" on tool "${tool.id ?? '?'}".`);
    }
  }
  if (!/^https:\/\/.+/.test(tool.url)) {
    throw new Error(`Catalog: "url" must be an absolute https URL on "${tool.id}".`);
  }
  if (!Array.isArray(tool.tags) || tool.tags.length === 0) {
    throw new Error(`Catalog: "tags" must be a non-empty array on "${tool.id}".`);
  }
}
const categoryIds = new Set(catalog.categories.map((category) => category.id));
for (const tool of catalog.tools) {
  if (!categoryIds.has(tool.categoryId)) {
    throw new Error(`Catalog: unknown categoryId "${tool.categoryId}" on "${tool.id}".`);
  }
}
const ids = catalog.tools.map((tool) => tool.id);
if (new Set(ids).size !== ids.length) {
  throw new Error('Catalog: duplicate tool ids.');
}

// --- DI container: lazy singletons ---
const container = createContainer();
let built = 0;
container.register(DI_TOKENS.clipboard, () => {
  built += 1;
  return { id: built };
});
if (container.resolve(DI_TOKENS.clipboard) !== container.resolve(DI_TOKENS.clipboard)) {
  throw new Error('DI: container must memoize singletons.');
}
if (built !== 1) {
  throw new Error('DI: factory must be invoked exactly once.');
}
if (container.has(DI_TOKENS.toolRepository)) {
  throw new Error('DI: has() must be false for unregistered tokens.');
}

// --- Repository with injected data source ---
const repository = new ToolRepository(new StaticToolDataSource(catalog));
const loaded = await repository.getCatalog();
if (loaded.tools.length !== 31) {
  throw new Error(`Catalog: expected 17 tools, got ${loaded.tools.length}.`);
}

// --- Filtering behavior ---
const geoipMatches = filterTools(loaded.tools, 'geoip', 'all').map((tool) => tool.id);
if (geoipMatches.join(',') !== 'hostip') {
  throw new Error(`filterTools: 'geoip' should match only "hostip", got [${geoipMatches}].`);
}
const reputationMatches = filterTools(loaded.tools, '', 'reputation').map((tool) => tool.id);
if (reputationMatches.join(',') !== 'abuseipdb,scamalytics,urlvoid,sucuri-sitecheck,controld-link-checker,isitphishing') {
  throw new Error(`filterTools: category filter failed, got [${reputationMatches}].`);
}
if (countToolsByCategory(loaded.tools).get('all') !== 31) {
  throw new Error('countToolsByCategory: global count failed.');
}

// --- fetch injected into HttpToolDataSource ---
const fakeFetch = async () => ({ ok: true, json: async () => catalog });
const httpRepository = new ToolRepository(
  new HttpToolDataSource('/tools.json', { fetch: fakeFetch }),
);
if ((await httpRepository.getCatalog()).tools.length !== 31) {
  throw new Error('HttpToolDataSource: injected fetch failed.');
}

console.log(`SMOKE OK — ${loaded.tools.length} tools / ${loaded.categories.length} categories`);
console.log(`ids: ${ids.join(', ')}`);
console.log(`counts: ${JSON.stringify([...countToolsByCategory(loaded.tools)])}`);
