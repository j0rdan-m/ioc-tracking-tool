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
import { countToolsByCategory, countToolsByIocType, filterTools, nextAutoIocFilter } from '../src/lib/utils/filter-tools.js';
import { detectIocType } from '../src/lib/utils/detect-ioc-type.js';

const catalogPath = new URL('../src/data/tools.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

// --- Catalog schema ---
const REQUIRED_FIELDS = ['id', 'name', 'url', 'categoryId', 'iocTypes', 'description', 'tags'];
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
  if (!Array.isArray(tool.iocTypes) || tool.iocTypes.length === 0) {
    throw new Error(`Catalog: "iocTypes" must be a non-empty array on "${tool.id}".`);
  }
}
const categoryIds = new Set(catalog.categories.map((category) => category.id));
const iocTypeIds = new Set(catalog.iocTypes.map((iocType) => iocType.id));
for (const tool of catalog.tools) {
  if (!categoryIds.has(tool.categoryId)) {
    throw new Error(`Catalog: unknown categoryId "${tool.categoryId}" on "${tool.id}".`);
  }
  for (const iocTypeId of tool.iocTypes) {
    if (!iocTypeIds.has(iocTypeId)) {
      throw new Error(`Catalog: unknown iocType "${iocTypeId}" on "${tool.id}".`);
    }
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
const emailMatches = filterTools(loaded.tools, '', 'all', 'email').map((tool) => tool.id);
if (
  emailMatches.join(',') !==
  'mxtoolbox,cyberchef,alienvault-otx,intelligence-x,microsoft-message-header-analyzer,google-messageheader'
) {
  throw new Error(`filterTools: IoC type filter failed, got [${emailMatches}].`);
}
const emailInDnsRecon = filterTools(loaded.tools, '', 'dns-recon', 'email').map((tool) => tool.id);
if (emailInDnsRecon.join(',') !== 'mxtoolbox') {
  throw new Error(`filterTools: combined category + IoC filter failed, got [${emailInDnsRecon}].`);
}
if (countToolsByIocType(loaded.tools).get('file') !== 9) {
  throw new Error('countToolsByIocType: file count failed.');
}

// --- IoC type detection ---
const detectionSamples = [
  ['8.8.8.8', 'ip'],
  ['192.168.0.1', 'ip'],
  ['2001:db8::1', 'ip'],
  ['::1', 'ip'],
  ['999.999.1.1', null],
  ['44d88612fea8a8f36de82e1278abb02f', 'file'],
  ['a9993e364706816aba3e25717850c26c9cd0d89d', 'file'],
  ['a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e', 'file'],
  ['EXAMPLE.COM', 'domain'],
  ['mail.evil-example.co.uk', 'domain'],
  ['user@domain.tld', 'email'],
  ['https://phishing.example.com/login', 'url'],
  ['http://8.8.8.8/pay', 'url'],
  ['evil.com/login', 'url'],
  ['  8.8.8.8  ', 'ip'],
  ['just-a-keyword', null],
  ['cyberchef', null],
  ['', null],
];
for (const [sample, expected] of detectionSamples) {
  const actual = detectIocType(sample);
  if (actual !== expected) {
    throw new Error(`detectIocType: "${sample}" should be ${expected}, got ${actual}.`);
  }
}
for (const [sample] of detectionSamples) {
  const detected = detectIocType(sample);
  if (detected !== null && !iocTypeIds.has(detected)) {
    throw new Error(`detectIocType: unknown IoC type "${detected}" for "${sample}".`);
  }
}

// --- Auto-applied IoC filter transition ---
const transitionCases = [
  // [detected, selectedId, lastAuto, expectedSelectedId, expectedLastAuto]
  ['ip', 'all', null, 'ip', 'ip'],
  ['ip', 'domain', 'ip', 'ip', 'ip'], // re-pasting an IP re-applies it
  [null, 'ip', 'ip', 'all', null], // query cleared: auto value resets
  [null, 'domain', 'ip', 'domain', null], // manual pick survives
  [null, 'all', null, 'all', null],
];
for (const [detected, selectedId, lastAuto, expectedSelected, expectedLastAuto] of transitionCases) {
  const result = nextAutoIocFilter(detected, selectedId, lastAuto);
  if (result.selectedId !== expectedSelected || result.lastAuto !== expectedLastAuto) {
    throw new Error(
      `nextAutoIocFilter(${detected}, ${selectedId}, ${lastAuto}) should be ` +
        `{ selectedId: ${expectedSelected}, lastAuto: ${expectedLastAuto} }, got ` +
        `${JSON.stringify(result)}.`,
    );
  }
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
