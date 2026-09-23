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
import { computeBatchStatus, runBatchAnalysis } from '../src/lib/utils/batch-analyze.js';
import { extractIocs } from '../src/lib/utils/extract-iocs.js';
import { defangIoc, normalizeIoc, refang, refangValue } from '../src/lib/utils/refang.js';
import { parseHeaders } from '../src/lib/utils/email-header-parser.js';
import { analyzeHeaders } from '../src/lib/utils/email-header-analyzer.js';

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

// --- IoC extraction from free text (pure modules, local only) ---
// AC08 guard: extraction/refang/defang must never touch the network. Any
// accidental fetch would make the calls below throw.
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error('extraction must not perform network calls');
};

// Refang + source map: the raw defanged text is recoverable from the output.
const refanged = refang('hxxps://evil[.]example[.]com/login');
if (refanged.value !== 'https://evil.example.com/login') {
  throw new Error(`Refang: wrong output, got "${refanged.value}".`);
}
if (refanged.srcStart.length !== refanged.value.length || refanged.srcEnd.length !== refanged.value.length) {
  throw new Error('Refang: the source map needs one entry per output character.');
}
if ('hxxps://evil[.]example[.]com/login'.slice(refanged.srcStart[0], refanged.srcEnd[refanged.value.length - 1]) !== 'hxxps://evil[.]example[.]com/login') {
  throw new Error('Refang: the source map must recover the exact original substring.');
}
const upperRefanged = refang('HXXPS://a[.]b');
if (upperRefanged.value !== 'https://a.b') {
  throw new Error(`Refang: uppercase variants must be handled, got "${upperRefanged.value}".`);
}
if (refangValue('https://example.com stays untouched') !== 'https://example.com stays untouched') {
  throw new Error('Refang: plain text must not be altered.');
}
if (refangValue('mail me at user[@]host[.]com, thanks') !== 'mail me at user@host.com, thanks') {
  throw new Error('Refang: [@]/[.] must be restored in context.');
}

// Normalization (refang + canonical casing) and defang.
if (normalizeIoc('evil[.]example[.]com.', 'domain') !== 'evil.example.com') {
  throw new Error(`Normalize: domain should be canonical, got "${normalizeIoc('evil[.]example[.]com.', 'domain')}".`);
}
if (normalizeIoc('hxxps://EVIL[.]Example[.]COM/Path', 'url') !== 'https://evil.example.com/Path') {
  throw new Error('Normalize: URL host must lowercase while the path keeps its case.');
}
if (normalizeIoc('USER[@]Example[.]COM', 'email') !== 'user@example.com') {
  throw new Error('Normalize: e-mail should be lowercased.');
}
if (defangIoc('https://evil.example.com/login', 'url') !== 'hxxps://evil[.]example[.]com/login') {
  throw new Error('Defang: wrong neutralized URL.');
}
if (defangIoc('176.128.43.70', 'ip') !== '176[.]128[.]43[.]70') {
  throw new Error('Defang: wrong neutralized IP.');
}
if (defangIoc('user@example.com', 'email') !== 'user[@]example[.]com') {
  throw new Error('Defang: wrong neutralized e-mail.');
}
if (defangIoc('44d88612fea8a8f36de82e1278abb02f', 'file') !== '44d88612fea8a8f36de82e1278abb02f') {
  throw new Error('Defang: hashes have nothing to neutralize.');
}

// AC02: one IoC per shape, extracted from the user-story sample, raw kept.
const sampleText = [
  'Connexion suspecte observée depuis 176.128.43.70.',
  '',
  'La machine a ensuite contacté :',
  'hxxps://cdn-example[.]com/update.exe',
  '',
  'Un message a également été reçu depuis :',
  'security[@]example[.]com',
  '',
  'SHA256 :',
  '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
].join('\n');
const extracted = extractIocs(sampleText);
if (extracted.warning !== null) {
  throw new Error(`Extract: unexpected warning, got "${extracted.warning}".`);
}
if (extracted.iocs.length !== 4) {
  throw new Error(`Extract: the sample text must yield 4 IoCs, got ${extracted.iocs.length}: ${JSON.stringify(extracted.iocs)}.`);
}
const [ipIoc, urlIoc, emailIoc, hashIoc] = extracted.iocs;
if (ipIoc.typeId !== 'ip' || ipIoc.raw !== '176.128.43.70' || ipIoc.normalized !== '176.128.43.70') {
  throw new Error(`Extract: wrong IP extraction, got ${JSON.stringify(ipIoc)}.`);
}
if (urlIoc.typeId !== 'url' || urlIoc.raw !== 'hxxps://cdn-example[.]com/update.exe' || urlIoc.normalized !== 'https://cdn-example.com/update.exe') {
  throw new Error(`Extract: wrong URL extraction, got ${JSON.stringify(urlIoc)}.`);
}
if (emailIoc.typeId !== 'email' || emailIoc.raw !== 'security[@]example[.]com' || emailIoc.normalized !== 'security@example.com') {
  throw new Error(`Extract: wrong e-mail extraction, got ${JSON.stringify(emailIoc)}.`);
}
if (hashIoc.typeId !== 'file' || hashIoc.hashKind !== 'SHA-256' || hashIoc.normalized !== '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8') {
  throw new Error(`Extract: wrong hash extraction, got ${JSON.stringify(hashIoc)}.`);
}
// The host of a URL and the domain of an e-mail are not reported twice.
if (extracted.iocs.some((ioc) => ioc.typeId === 'domain')) {
  throw new Error(`Extract: hosts must stay masked behind their URL/e-mail, got ${JSON.stringify(extracted.iocs)}.`);
}

// AC07: deduplication on the normalized value, per type.
const domainDedup = extractIocs('evil.example.com\nevil[.]example[.]com\nevil.example.com');
if (domainDedup.iocs.length !== 1 || domainDedup.iocs[0].normalized !== 'evil.example.com') {
  throw new Error(`Extract: defanged duplicates must collapse onto one IoC, got ${JSON.stringify(domainDedup.iocs)}.`);
}
const domainAndUrl = extractIocs('example.com\nexample[.]com\nhttps://example.com');
const domainAndUrlKinds = domainAndUrl.iocs.map((ioc) => `${ioc.typeId}:${ioc.normalized}`);
if (domainAndUrl.iocs.length !== 2 || !domainAndUrlKinds.includes('domain:example.com') || !domainAndUrlKinds.includes('url:https://example.com/')) {
  throw new Error(`Extract: a URL is a distinct IoC from its host domain, got ${JSON.stringify(domainAndUrlKinds)}.`);
}

// AC01 (with sentence punctuation) and AC10 (nothing found).
if (extractIocs('Connexion depuis 176.128.43.70.').iocs.map((ioc) => ioc.normalized).join(',') !== '176.128.43.70') {
  throw new Error('Extract: sentence punctuation must not break IPv4 detection.');
}
if (extractIocs('999.999.1.1 looks like an IP but is not one').iocs.length !== 0) {
  throw new Error('Extract: octets over 255 must be rejected.');
}
if (extractIocs('plain words only, nothing observable here').iocs.length !== 0) {
  throw new Error('Extract: text without indicators must yield an empty list.');
}

globalThis.fetch = originalFetch;

// --- Batch analysis (US V1.2) ---
const batchIoc = (/** @type {string} */ typeId, /** @type {string} */ normalized) => ({
  id: `${typeId}:${normalized}`,
  typeId,
  raw: normalized,
  normalized,
  defanged: normalized,
  hashKind: null,
  index: 0,
});
const batchCheck = (/** @type {string} */ status) => ({
  def: {
    id: 'check',
    label: 'Check',
    toolId: null,
    run: async () => ({ status: 'ok', summary: null, fields: [], message: null }),
  },
  status,
  result: null,
  ms: null,
});
// An empty answer is never a failure and never a verdict: it stays Partial.
const batchStatusCases = [
  [[], 'No automated check available'],
  [['pending'], 'Pending'],
  [['running'], 'Running'],
  [['ok', 'ok'], 'Complete'],
  [['ok', 'empty'], 'Partial'],
  [['ok', 'error'], 'Partial'],
  [['empty', 'empty'], 'Partial'],
  [['error', 'error'], 'Error'],
  [['ok', 'cancelled'], 'Cancelled'],
];
for (const [statuses, expected] of batchStatusCases) {
  const actual = computeBatchStatus(statuses.map(batchCheck));
  if (actual !== expected) {
    throw new Error(`Batch: statuses [${statuses}] should be "${expected}", got "${actual}".`);
  }
}

// Concurrency: one check per IoC, so "in flight" counts IoCs (not requests).
let inFlight = 0;
let maxInFlight = 0;
const singleCheckFor = (/** @type {string} */ typeId) =>
  typeId === 'file'
    ? []
    : [
        {
          id: `${typeId}-only`,
          label: 'Only check',
          toolId: null,
          run: async () => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 15));
            inFlight -= 1;
            return { status: 'ok', summary: null, fields: [], message: null };
          },
        },
      ];
const batchSnapshots = [];
const batchRun = runBatchAnalysis(
  ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5', '6.6.6.6'].map((ip) =>
    batchIoc('ip', ip),
  ),
  singleCheckFor,
  { onUpdate: (rows) => batchSnapshots.push(rows) },
);
await batchRun.done;
if (maxInFlight !== 3) {
  throw new Error(`Batch: at most 3 IoCs must be analysed concurrently, observed ${maxInFlight}.`);
}
const batchStatuses = batchRun.rows.map((row) => computeBatchStatus(row.checkStates));
if (batchStatuses.join(',') !== 'Complete,Complete,Complete,Complete,Complete,Complete') {
  throw new Error(`Batch: every analysed IoC should be Complete, got [${batchStatuses}].`);
}
// AC07: a settled IoC is published while the others are still pending.
const progressive = batchSnapshots.some(
  (rows) =>
    rows.some((row) => computeBatchStatus(row.checkStates) === 'Complete') &&
    rows.some((row) => computeBatchStatus(row.checkStates) !== 'Complete'),
);
if (!progressive) {
  throw new Error('Batch: results must be published progressively (AC07).');
}

// AC12: a duplicated indicator runs once per batch.
const dedupRun = runBatchAnalysis(
  [batchIoc('ip', '1.1.1.1'), batchIoc('ip', '1.1.1.1')],
  singleCheckFor,
);
await dedupRun.done;
if (dedupRun.rows.length !== 1) {
  throw new Error(`Batch: a duplicated IoC must run once, got ${dedupRun.rows.length} rows.`);
}

// AC05/AC06/AC10/AC11: a failing provider degrades its own check only, and a
// hash reports "No automated check available" instead of any verdict.
const mixedRun = runBatchAnalysis(
  [batchIoc('domain', 'a.example'), batchIoc('file', 'f'.repeat(64))],
  (typeId) =>
    typeId === 'file'
      ? []
      : [
          {
            id: `${typeId}-rdap`,
            label: 'RDAP',
            toolId: null,
            run: async () => ({
              status: 'ok',
              summary: 'ACME',
              fields: [{ label: 'Network', value: 'ACME' }],
              message: null,
            }),
          },
          {
            id: `${typeId}-certs`,
            label: 'TLS',
            toolId: null,
            run: async () => {
              throw new Error('HTTP 403 — blocked by the provider');
            },
          },
        ],
);
await mixedRun.done;
const mixedDomain = mixedRun.rows[0];
const mixedHash = mixedRun.rows[1];
if (computeBatchStatus(mixedDomain.checkStates) !== 'Partial') {
  throw new Error(
    `Batch: a failing provider must leave its IoC Partial, got ${computeBatchStatus(mixedDomain.checkStates)}.`,
  );
}
if (
  mixedDomain.checkStates[1].status !== 'error' ||
  !String(mixedDomain.checkStates[1].result?.message).includes('403')
) {
  throw new Error('Batch: the provider message must be surfaced verbatim, never turned into a verdict.');
}
if (
  mixedHash.checkStates.length !== 0 ||
  computeBatchStatus(mixedHash.checkStates) !== 'No automated check available'
) {
  throw new Error('Batch: hashes have no automated check (AC10).');
}

// AC09: stopping keeps what already settled and cancels what never started.
/** @type {Map<string, (result: any) => void>} */
const manualResolvers = new Map();
const manualChecks = () => [
  {
    id: 'manual',
    label: 'Manual',
    toolId: null,
    run: (value) =>
      new Promise((resolve) => manualResolvers.set(value, resolve)),
  },
];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const stoppedRun = runBatchAnalysis(
  ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5'].map((ip) => batchIoc('ip', ip)),
  manualChecks,
);
await tick(); // the first three IoCs are in flight, the last two are queued
stoppedRun.stop();
if (computeBatchStatus(stoppedRun.rows[3].checkStates) !== 'Cancelled') {
  throw new Error('Batch: queued IoCs must flip to Cancelled as soon as the analysis stops.');
}
for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
  manualResolvers.get(ip)?.({ status: 'ok', summary: null, fields: [], message: null });
}
await stoppedRun.done;
const stoppedStatuses = stoppedRun.rows.map((row) => computeBatchStatus(row.checkStates));
if (stoppedStatuses.join(',') !== 'Complete,Complete,Complete,Cancelled,Cancelled') {
  throw new Error(
    `Batch: stop must keep the results already obtained and cancel the rest, got [${stoppedStatuses}].`,
  );
}

// A check cut short by the stop is a cancellation, never a provider error.
const abortAwareRun = runBatchAnalysis(
  [batchIoc('ip', '9.9.9.9')],
  () => [
    {
      id: 'abort-aware',
      label: 'Abort aware',
      toolId: null,
      run: (value, options = {}) =>
        new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () =>
            reject(new Error('This operation was aborted')),
          );
        }),
    },
  ],
);
await tick();
abortAwareRun.stop();
await abortAwareRun.done;
if (computeBatchStatus(abortAwareRun.rows[0].checkStates) !== 'Cancelled') {
  throw new Error('Batch: an aborted check must read Cancelled, not an error/verdict (AC11).');
}

// --- Email headers (local RFC 5322 parsing + authentication) --------------
// Parsing must stay offline: an accidental network call would make the block
// below throw, since the global fetch is replaced by a throwing stub.
globalThis.fetch = () => {
  throw new Error('email header analysis must not perform network calls');
};

const headerSample = [
  'Received: from mail-eu.smtp.example.com (mail-eu.smtp.example.com [209.85.202.48])',
  '\tby mx.google.com with ESMTPS id abc123',
  '\tfor <victim@example.org>',
  '\t; Mon, 15 Sep 2025 10:00:00 +0000',
  'Received: from workstation.local ([192.168.1.20])',
  '\tby mail-eu.smtp.example.com with ESMTP id def456',
  '\t; Mon, 15 Sep 2025 09:59:50 +0000',
  'Authentication-Results: mx.google.com;',
  '\tspf=pass (google.com: domain of sender@phish.example designates 209.85.202.48 as permitted sender)',
  '\tsmtp.mailfrom=sender@phish.example;',
  '\tdkim=pass header.d=phish.example header.s=sel1;',
  '\tdmarc=fail (p=REJECT sp=REJECT dis=NONE) header.from=example.org',
  'From: "Support" <help@example.org>',
  'Reply-To: reply@other.example',
  'Return-Path: <bounce@phish.example>',
  'Message-ID: <abc@mail.phish.example>',
  'this line has no colon and must be skipped, not abort the parse',
].join('\r\n');

const parsedHeaders = parseHeaders(headerSample);
if (parsedHeaders.field('From') !== '"Support" <help@example.org>') {
  throw new Error(`Email headers: wrong From field, got "${parsedHeaders.field('From')}".`);
}

// RFC 5322 §3.2.3: a folded field is one logical value.
const authValue = parsedHeaders.field('Authentication-Results');
if (!authValue?.includes('smtp.mailfrom=sender@phish.example') || !authValue?.includes('header.from=example.org')) {
  throw new Error(`Email headers: folded Authentication-Results must be unfolded, got "${authValue}".`);
}

const headerAnalysis = analyzeHeaders(parsedHeaders);
if (headerAnalysis.summary.from !== 'help@example.org' || headerAnalysis.summary.replyTo !== 'reply@other.example') {
  throw new Error(`Email headers: wrong From/Reply-To summary, got ${JSON.stringify(headerAnalysis.summary)}.`);
}
if (headerAnalysis.summary.returnPath !== 'bounce@phish.example' || headerAnalysis.summary.messageIdDomain !== 'mail.phish.example') {
  throw new Error(`Email headers: wrong Return-Path/Message-ID summary, got ${JSON.stringify(headerAnalysis.summary)}.`);
}

// Authentication-Results (SPF/DKIM/DMARC + their domains).
if (headerAnalysis.auth.spf.result !== 'PASS' || headerAnalysis.auth.spf.domain !== 'sender@phish.example') {
  throw new Error(`Email headers: wrong SPF result, got ${JSON.stringify(headerAnalysis.auth.spf)}.`);
}
if (headerAnalysis.auth.dkim.result !== 'PASS' || headerAnalysis.auth.dkim.domain !== 'phish.example') {
  throw new Error(`Email headers: wrong DKIM result, got ${JSON.stringify(headerAnalysis.auth.dkim)}.`);
}
if (headerAnalysis.auth.dmarc.result !== 'FAIL' || headerAnalysis.auth.dmarc.domain !== 'example.org') {
  throw new Error(`Email headers: wrong DMARC result, got ${JSON.stringify(headerAnalysis.auth.dmarc)}.`);
}

// Mail path: ordered earliest → final receiving server, private IPs flagged.
if (headerAnalysis.mailPath.length !== 2) {
  throw new Error(`Email headers: expected 2 hops, got ${headerAnalysis.mailPath.length}.`);
}
const [firstHop, lastHop] = headerAnalysis.mailPath;
if (firstHop.ip !== '192.168.1.20' || firstHop.ipKind !== 'private') {
  throw new Error(`Email headers: the earliest hop must come first and be flagged private, got ${JSON.stringify(firstHop)}.`);
}
if (lastHop.ip !== '209.85.202.48' || lastHop.host !== 'mail-eu.smtp.example.com') {
  throw new Error(`Email headers: wrong final hop, got ${JSON.stringify(lastHop)}.`);
}
if (headerAnalysis.earliestPublicIp !== '209.85.202.48') {
  throw new Error(`Email headers: wrong earliest public IP, got "${headerAnalysis.earliestPublicIp}".`);
}
if (headerAnalysis.mailPath[0].dateIso !== '2025-09-15T09:59:50.000Z' || headerAnalysis.transit.durationMs !== 10000) {
  throw new Error(`Email headers: wrong transit timing, got ${JSON.stringify(headerAnalysis.transit)}.`);
}

// Identity mismatch + factual signals (never a verdict).
if (headerAnalysis.identity.differs !== true) {
  throw new Error('Email headers: mismatching From/Reply-To/Return-Path domains must be reported.');
}
const signalLabels = headerAnalysis.signals.map((signal) => signal.label);
for (const expected of ['SPF PASS', 'DMARC failed', 'Reply-To domain differs from From domain']) {
  if (!signalLabels.includes(expected)) {
    throw new Error(`Email headers: missing "${expected}" signal, got ${JSON.stringify(signalLabels)}.`);
  }
}
if (signalLabels.some((label) => /safe|malicious/i.test(label))) {
  throw new Error(`Email headers: signals must stay factual, got ${JSON.stringify(signalLabels)}.`);
}

// IoC candidates: public IPs only, plus the addresses/domains for the extractor.
if (headerAnalysis.iocs.ips.join(',') !== '209.85.202.48') {
  throw new Error(`Email headers: private IPs must be excluded from the IoC list, got ${JSON.stringify(headerAnalysis.iocs.ips)}.`);
}
if (headerAnalysis.iocs.emails.join(',') !== 'help@example.org,reply@other.example,bounce@phish.example') {
  throw new Error(`Email headers: wrong e-mail candidates, got ${JSON.stringify(headerAnalysis.iocs.emails)}.`);
}
for (const domain of ['example.org', 'other.example', 'phish.example', 'mail.phish.example']) {
  if (!headerAnalysis.iocs.domains.includes(domain)) {
    throw new Error(`Email headers: missing "${domain}" in the domain candidates, got ${JSON.stringify(headerAnalysis.iocs.domains)}.`);
  }
}

// Fallbacks: Received-SPF when there is no Authentication-Results, DKIM-Signature
// for the signing domain/selector, and a malformed Received date must degrade to
// null (it used to throw a RangeError and lose the whole analysis).
const fallbackAnalysis = analyzeHeaders(
  parseHeaders(
    [
      'Received-SPF: Pass (mailfrom) smtp.mailfrom=spf.example',
      'DKIM-Signature: v=1; a=rsa-sha256; d=signed.example; s=selector42; b=abc',
      'Received: from bare-relay by no-date.example with SMTP',
      'Received: from broken (broken.example) by last.example with SMTP; not-a-date',
      'From: someone@signed.example',
    ].join('\n'),
  ),
);
if (fallbackAnalysis.auth.spf.result !== 'PASS' || fallbackAnalysis.auth.spf.domain !== 'spf.example') {
  throw new Error(`Email headers: Received-SPF fallback failed, got ${JSON.stringify(fallbackAnalysis.auth.spf)}.`);
}
if (
  fallbackAnalysis.auth.dkim.result !== 'PASS' ||
  fallbackAnalysis.auth.dkim.domain !== 'signed.example' ||
  fallbackAnalysis.auth.dkim.selector !== 'selector42'
) {
  throw new Error(`Email headers: DKIM-Signature fallback failed, got ${JSON.stringify(fallbackAnalysis.auth.dkim)}.`);
}
if (fallbackAnalysis.mailPath[0].dateIso !== null) {
  throw new Error('Email headers: a malformed Received date must resolve to null, not throw.');
}
if (!fallbackAnalysis.signals.some((signal) => signal.label === 'Unable to fully parse one or more Received headers')) {
  throw new Error('Email headers: a hop without IP nor date must surface an explicit signal.');
}

globalThis.fetch = originalFetch;

console.log(`SMOKE OK — ${loaded.tools.length} tools / ${loaded.categories.length} categories`);
console.log(`ids: ${ids.join(', ')}`);
console.log(`counts: ${JSON.stringify([...countToolsByCategory(loaded.tools)])}`);
