/**
 * Smoke test for the catalog and the framework-agnostic core (DI container,
 * repository, data sources, filtering, favorites). Run with `npm run smoke`.
 *
 * The composition root itself is exercised by `npm run build`, since it imports
 * the bundled JSON through Vite.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createContainer } from '../src/lib/di/container.js';
import { DI_TOKENS } from '../src/lib/di/tokens.js';
import { HttpToolDataSource } from '../src/lib/services/http-tool-data-source.js';
import { StaticToolDataSource } from '../src/lib/services/static-tool-data-source.js';
import { ToolRepository } from '../src/lib/services/tool-repository.js';
import { countToolsByCategory, countToolsByIocType, filterTools, nextAutoIocFilter } from '../src/lib/utils/filter-tools.js';
import { detectIocType } from '../src/lib/utils/detect-ioc-type.js';
import { FavoritesService } from '../src/lib/services/favorites.js';
import { FastAnalyzerService } from '../src/lib/services/fast-analyze.js';
import { getDeepLinks } from '../src/lib/utils/deep-links.js';

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
if (loaded.tools.length !== 35) {
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
if (countToolsByCategory(loaded.tools).get('all') !== 35) {
  throw new Error('countToolsByCategory: global count failed.');
}
const emailMatches = filterTools(loaded.tools, '', 'all', 'email').map((tool) => tool.id);
if (
  emailMatches.join(',') !==
  'mxtoolbox,cyberchef,alienvault-otx,intelligence-x,microsoft-message-header-analyzer,google-messageheader,breach-directory,haveibeenpwned'
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

// --- Favorites service ---
const memoryStore = new Map();
const favoritesStorage = {
  getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
  setItem: (key, value) => memoryStore.set(key, String(value)),
};
const favoritesService = new FavoritesService(favoritesStorage);
if (favoritesService.getFavorites().length !== 0) {
  throw new Error('FavoritesService: storage should start empty.');
}
favoritesService.toggle('hostip');
favoritesService.toggle('crtsh');
if (favoritesService.getFavorites().join(',') !== 'hostip,crtsh') {
  throw new Error(`FavoritesService: unexpected list, got [${favoritesService.getFavorites()}].`);
}
if (!favoritesService.isFavorite('crtsh') || favoritesService.isFavorite('virustotal')) {
  throw new Error('FavoritesService: isFavorite failed.');
}
favoritesService.toggle('hostip');
if (favoritesService.getFavorites().join(',') !== 'crtsh') {
  throw new Error('FavoritesService: toggle removal failed.');
}
const sameStorageFavorites = new FavoritesService(favoritesStorage);
if (!sameStorageFavorites.isFavorite('crtsh')) {
  throw new Error('FavoritesService: favorites must persist through the storage.');
}
memoryStore.set('ioc-toolkit:favorites', 'not-json');
if (favoritesService.getFavorites().length !== 0) {
  throw new Error('FavoritesService: corrupted storage should yield an empty list.');
}
const isolatedFavorites = new FavoritesService();
isolatedFavorites.toggle('virustotal');
if (!isolatedFavorites.isFavorite('virustotal')) {
  throw new Error('FavoritesService: in-memory fallback failed.');
}

// --- Health catalog (optional snapshot, regenerated by `npm run health`) ---
const healthPath = new URL('../src/data/health.json', import.meta.url);
if (existsSync(healthPath)) {
  const health = JSON.parse(readFileSync(healthPath, 'utf8'));
  if (
    typeof health.checkedAt !== 'string' ||
    typeof health.results !== 'object' ||
    health.results === null
  ) {
    throw new Error('Health catalog: malformed health.json.');
  }
  for (const [toolId, result] of Object.entries(health.results)) {
    if (!ids.includes(toolId)) {
      throw new Error(`Health catalog: unknown tool id "${toolId}".`);
    }
    if (typeof result.ok !== 'boolean') {
      throw new Error(`Health catalog: bad entry for "${toolId}".`);
    }
  }
}

// --- fetch injected into HttpToolDataSource ---
const fakeFetch = async () => ({ ok: true, json: async () => catalog });
const httpRepository = new ToolRepository(
  new HttpToolDataSource('/tools.json', { fetch: fakeFetch }),
);
if ((await httpRepository.getCatalog()).tools.length !== 35) {
  throw new Error('HttpToolDataSource: injected fetch failed.');
}

// --- Fast analyze: "go further" deep links (pure helper) ---
const ipLinks = getDeepLinks('ip', '8.8.8.8', loaded.tools);
const ipLinkById = new Map(ipLinks.map((link) => [link.toolId, link]));
if (ipLinkById.get('abuseipdb')?.url !== 'https://www.abuseipdb.com/check/8.8.8.8') {
  throw new Error('Fast analyze: wrong AbuseIPDB deep link for an IP.');
}
if (!ipLinkById.has('virustotal')) {
  throw new Error('Fast analyze: VirusTotal deep link missing for an IP.');
}
const fileLinks = getDeepLinks(
  'file',
  '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f',
  loaded.tools,
);
const fileLinkById = new Map(fileLinks.map((link) => [link.toolId, link]));
if (
  fileLinkById.get('malwarebazaar')?.url !==
  'https://bazaar.abuse.ch/browse.php?search=hash%3A275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f'
) {
  throw new Error('Fast analyze: wrong MalwareBazaar deep link for a hash.');
}
const emailLinks = getDeepLinks('email', 'user@example.com', loaded.tools);
if (!emailLinks.some((link) => link.toolId === 'haveibeenpwned')) {
  throw new Error('Fast analyze: Have I Been Pwned deep link missing for an email.');
}
if (getDeepLinks('username', 'someuser', loaded.tools).length === 0) {
  throw new Error('Fast analyze: no deep link for usernames.');
}
for (const link of [...ipLinks, ...fileLinks, ...emailLinks]) {
  if (!ids.includes(link.toolId)) {
    throw new Error(`Fast analyze: deep link pointing at unknown tool "${link.toolId}".`);
  }
  if (!link.url.startsWith('https://')) {
    throw new Error(`Fast analyze: deep link for "${link.toolId}" must be an https URL.`);
  }
}
if (getDeepLinks('domain', 'example.com', []).length !== 0) {
  throw new Error('Fast analyze: deep links must vanish when the catalog is empty.');
}

// --- Fast analyze service (injected fetch, canned responses) ---
const cannedFastFetch = async (/** @type {string | URL} */ url) => {
  const target = String(url);
  if (target.startsWith('https://api.ipapi.is/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ip: '8.8.8.8',
        company: 'Google LLC',
        asn: 'AS15169 Google LLC',
        city: 'Mountain View',
        region: 'California',
        country: 'United States',
        is_tor: true,
      }),
    };
  }
  if (target.startsWith('https://rdap.org/ip/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        name: 'GOGL',
        startAddress: '8.8.8.0',
        endAddress: '8.8.8.255',
        country: 'US',
        entities: [{ roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Google LLC']]] }],
      }),
    };
  }
  if (target.startsWith('https://rdap.org/domain/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ldhName: 'EXAMPLE.COM',
        status: ['client transfer prohibited'],
        events: [
          { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
          { eventAction: 'expiration', eventDate: '2026-08-13T04:00:00Z' },
        ],
        entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'RESERVED-IANA']]] }],
        nameservers: [{ ldhName: 'A.IANA-SERVERS.NET' }, { ldhName: 'B.IANA-SERVERS.NET' }],
      }),
    };
  }
  if (target.startsWith('https://crt.sh/')) {
    return {
      ok: true,
      status: 200,
      json: async () => [
        { name_value: 'example.com\n*.example.com', issuer_name: 'Cloudflare TLS CA', not_before: '2026-07-29T22:10:08' },
        { name_value: 'example.com', issuer_name: "Let's Encrypt", not_before: '2026-08-20T00:00:00' },
        // S/MIME entry: the email SAN must be filtered out of the sample names.
        { name_value: 'contact@example.com', issuer_name: 'S/MIME CA', not_before: '2026-08-25T00:00:00' },
      ],
    };
  }
  throw new Error(`Unexpected URL in fast-analyze stub: ${target}`);
};
const analyzer = new FastAnalyzerService({ fetch: cannedFastFetch });

const ipChecks = analyzer.getChecks('ip');
if (ipChecks.map((check) => check.id).join(',') !== 'ip-intel,ip-rdap') {
  throw new Error(`Fast analyze: unexpected IP checks, got [${ipChecks.map((c) => c.id)}].`);
}
const ipIntel = await ipChecks[0].run('8.8.8.8');
if (ipIntel.status !== 'ok') {
  throw new Error(`Fast analyze: ip-intel should succeed, got ${ipIntel.status} (${ipIntel.message}).`);
}
if (!ipIntel.fields.some((field) => field.label === 'Company' && field.value === 'Google LLC')) {
  throw new Error('Fast analyze: ip-intel should expose the company name.');
}
if (!ipIntel.fields.some((field) => field.label === 'Tor exit node' && field.tone === 'bad')) {
  throw new Error('Fast analyze: ip-intel should flag is_tor with a bad tone.');
}
const ipRdap = await ipChecks[1].run('8.8.8.8');
if (!ipRdap.fields.some((field) => field.label === 'Network' && field.value === 'GOGL')) {
  throw new Error('Fast analyze: ip-rdap should expose the network name.');
}
if (!ipRdap.fields.some((field) => field.label === 'Range' && field.value.includes('8.8.8.0'))) {
  throw new Error('Fast analyze: ip-rdap should expose the address range.');
}

const domainChecks = analyzer.getChecks('domain');
if (domainChecks.map((check) => check.id).join(',') !== 'domain-rdap,domain-certs') {
  throw new Error(`Fast analyze: unexpected domain checks, got [${domainChecks.map((c) => c.id)}].`);
}
const domainRdap = await domainChecks[0].run('example.com');
if (!domainRdap.fields.some((field) => field.label === 'Registrar' && field.value === 'RESERVED-IANA')) {
  throw new Error('Fast analyze: domain-rdap should expose the registrar.');
}
if (!domainRdap.fields.some((field) => field.label === 'Created' && field.value === '1995-08-14')) {
  throw new Error('Fast analyze: domain-rdap should expose the creation date.');
}
const domainCerts = await domainChecks[1].run('example.com');
if (domainCerts.status !== 'ok' || !domainCerts.summary?.includes('3 certificate')) {
  throw new Error(`Fast analyze: crt.sh check should summarize 3 certificates, got ${domainCerts.summary}.`);
}
const sampleNames = domainCerts.fields.find((field) => field.label === 'Sample names')?.value ?? '';
if (sampleNames !== 'example.com') {
  throw new Error(`Fast analyze: crt.sh names should be deduplicated and wildcard-stripped, got "${sampleNames}".`);
}

// URL checks read the hostname out of the URL (even without a scheme).
const requested = [];
const urlAnalyzer = new FastAnalyzerService({
  fetch: async (/** @type {string | URL} */ url) => {
    requested.push(String(url));
    return { ok: true, status: 200, json: async () => [] };
  },
});
await urlAnalyzer.getChecks('url')[1].run('https://login.evil-example.com/steal');
if (!requested.some((url) => url.startsWith('https://crt.sh/') && url.includes('login.evil-example.com'))) {
  throw new Error(`Fast analyze: url checks should query crt.sh for the URL hostname, got ${requested}.`);
}
// Email checks read the domain part of the address.
await urlAnalyzer.getChecks('email')[0].run('user@example.com');
if (!requested.some((url) => url.startsWith('https://rdap.org/domain/example.com'))) {
  throw new Error('Fast analyze: email checks should query RDAP for the email domain.');
}

// Failures degrade into { status: 'error' } results with a message.
const failingAnalyzer = new FastAnalyzerService({
  fetch: async () => {
    throw new Error('boom');
  },
});
const failed = await failingAnalyzer.getChecks('ip')[0].run('8.8.8.8');
if (failed.status !== 'error' || failed.message !== 'boom' || failed.fields.length !== 0) {
  throw new Error(`Fast analyze: provider failures must become error results, got ${JSON.stringify(failed)}.`);
}
const notFoundAnalyzer = new FastAnalyzerService({
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
});
const notFound = await notFoundAnalyzer.getChecks('domain')[0].run('example.com');
if (notFound.status !== 'error' || !notFound.message?.includes('404')) {
  throw new Error(`Fast analyze: a 404 must surface as an error mentioning it, got ${notFound.message}.`);
}

// No live check for hashes / usernames (providers now require an API key).
if (analyzer.getChecks('file').length !== 0 || analyzer.getChecks('username').length !== 0) {
  throw new Error('Fast analyze: file and username must fall back to deep links only.');
}


console.log(`SMOKE OK — ${loaded.tools.length} tools / ${loaded.categories.length} categories`);
console.log(`ids: ${ids.join(', ')}`);
console.log(`counts: ${JSON.stringify([...countToolsByCategory(loaded.tools)])}`);
