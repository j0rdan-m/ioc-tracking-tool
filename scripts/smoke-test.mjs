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
import { computeGraphLayout, GRAPH_HEIGHT, GRAPH_WIDTH } from '../src/lib/utils/graph-layout.js';
import { filterGraph, neighborhoodIds } from '../src/lib/utils/graph-filter.js';
import {
  STATUS_LABELS,
  VERDICT_LABELS,
  filterWorkspaceList,
  investigationStats,
} from '../src/lib/utils/workspace-view.js';
import { computeBatchStatus, runBatchAnalysis } from '../src/lib/utils/batch-analyze.js';
import { extractIocs } from '../src/lib/utils/extract-iocs.js';
import { defangIoc, normalizeIoc, refang, refangValue } from '../src/lib/utils/refang.js';
import { parseHeaders } from '../src/lib/utils/email-header-parser.js';
import { analyzeHeaders } from '../src/lib/utils/email-header-analyzer.js';
import {
  ExportOptionsDefaults,
  buildExportFilename,
  buildExportModel,
  buildMultiExportModel,
  capitalize,
  sanitizeSlug,
  slugLabel,
  typeLabel,
} from '../src/lib/services/export/export-model.js';
import { EXPORT_MIME_TYPES, exportInvestigation } from '../src/lib/services/export/investigation-exporter.js';
import { escapeCell } from '../src/lib/services/export/csv-exporter.js';
import {
  INVESTIGATION_STATUSES,
  RELATIONSHIP_TYPES,
  TIMELINE_EVENT_TYPES,
  WORKSPACE_NODE_TYPES,
  addNode,
  addRelationship,
  createInvestigation,
  detectNodeType,
  duplicateInvestigation,
  nodeIdOf,
  recordTimelineEvent,
  removeNode,
  sanitizeInvestigation,
  setInvestigationNotes,
  setInvestigationTags,
  setNodeAnalysis,
  setNodeHidden,
  setNodeNotes,
  setNodePosition,
  setNodeTags,
  setNodeVerdict,
  setInvestigationInfo,
  setStatus,
} from '../src/lib/services/workspace/investigation-model.js';
import {
  InvestigationRepository,
  createIndexedDbWorkspaceAdapter,
  createMemoryWorkspaceAdapter,
} from '../src/lib/services/workspace/investigation-repository.js';
import { InvestigationHistoryService } from '../src/lib/services/investigation-history.js';
import { addIndicatorsToInvestigation, applyPivotCandidates } from '../src/lib/services/workspace/intake.js';
import { WorkspacePivotService, PIVOT_LIMITS } from '../src/lib/services/workspace/pivot-service.js';
import { exportWorkspaceInvestigation } from '../src/lib/services/export/workspace-exporter.js';
import { parseWorkspaceImport, resolveWorkspaceImportCollision } from '../src/lib/services/workspace/import.js';

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

// --- Exports (US V1.5) ---
// AC05: the whole pipeline is pure — with `fetch` rigged to throw, every
// format must still build: a single network call would fail right here.
globalThis.fetch = () => {
  throw new Error('Export: the network must never be used (AC05).');
};

const exportNow = '2026-09-24T08:00:00.000Z';
const exportOptions = { tools: catalog.tools, now: exportNow };

/** Full investigation: verdict, tags, multi-line notes, analysis, provenance. */
const exportEntry = {
  typeId: 'ip',
  normalized: '176.128.43.70',
  defanged: '176[.]128[.]43[.]70',
  firstAnalyzedAt: '2026-09-20T10:00:00.000Z',
  lastAnalyzedAt: '2026-09-22T15:30:00.000Z',
  verdict: 'suspicious',
  tags: ['phishing', 'customer-incident'],
  notes: 'Line one\nline two, with comma',
  source: 'extracted-text',
  latestAnalysis: {
    checkedAt: '2026-09-22T15:30:00.000Z',
    checks: [
      {
        id: 'ip-intel',
        label: 'IP intelligence (geo, ASN, hosting)',
        toolId: 'ipapi-is',
        status: 'ok',
        ms: 320,
        summary: 'Hosting facility',
        fields: [
          { label: 'ASN', value: 'AS64500' },
          { label: 'Organization', value: 'Evil Hosting, "Ltd"' },
          { label: 'Hosting', value: 'Yes' },
          { label: 'Confidence', value: '87' },
        ],
        message: null,
      },
      {
        id: 'ip-rdap',
        label: 'Network registration (RDAP)',
        toolId: null,
        status: 'error',
        ms: 12,
        summary: null,
        fields: [],
        message: 'Unreachable from the browser (network or CORS restriction).',
      },
      {
        id: 'ip-risk',
        label: 'Hosting risk (smoke fixture)',
        toolId: null,
        status: 'empty',
        ms: 5,
        summary: null,
        fields: [],
        message: 'No reports for this address.',
      },
    ],
  },
};

/** Two clean entries for the multi-export checks (no multi-line cells). */
const exportEntry2 = {
  typeId: 'domain',
  normalized: 'phish.example',
  defanged: 'phish[.]example',
  firstAnalyzedAt: '2026-09-21T09:00:00.000Z',
  lastAnalyzedAt: '2026-09-21T09:00:00.000Z',
  verdict: 'unknown',
  tags: [],
  notes: '',
  source: 'manual',
  latestAnalysis: null,
};
const exportEntry3 = {
  typeId: 'ip',
  normalized: '203.0.113.7',
  defanged: '203[.]0[.]113[.]7',
  firstAnalyzedAt: '2026-09-19T12:00:00.000Z',
  lastAnalyzedAt: '2026-09-19T12:00:00.000Z',
  verdict: 'benign',
  tags: ['lab'],
  notes: '',
  source: null,
  latestAnalysis: null,
};
const exportClone = JSON.stringify(exportEntry);

const exportMd = exportInvestigation([exportEntry], 'markdown', exportOptions);
const exportJson = exportInvestigation([exportEntry], 'json', exportOptions);
const exportCsv = exportInvestigation([exportEntry], 'csv', exportOptions);
const jsonPayload = JSON.parse(exportJson.content);

// Mime types: the download is a plain Blob, never HTML.
if (EXPORT_MIME_TYPES.markdown !== 'text/markdown;charset=utf-8') {
  throw new Error('Export: wrong Markdown mime type.');
}
if (
  EXPORT_MIME_TYPES.json !== 'application/json;charset=utf-8' ||
  EXPORT_MIME_TYPES.csv !== 'text/csv;charset=utf-8'
) {
  throw new Error('Export: wrong JSON/CSV mime type.');
}
let unknownFormatRejected = false;
try {
  exportInvestigation([exportEntry], 'pdf', exportOptions);
} catch {
  unknownFormatRejected = true;
}
if (!unknownFormatRejected) {
  throw new Error('Export: an unknown format must be rejected.');
}

// AC15: filename conventions — slugged indicator + date for a single
// investigation, date only for a selection, extension per format.
if (exportMd.filename !== 'investigation-176.128.43.70-2026-09-24.md') {
  throw new Error(`Export: wrong Markdown filename "${exportMd.filename}".`);
}
if (exportJson.filename !== 'investigation-176.128.43.70-2026-09-24.json') {
  throw new Error(`Export: wrong JSON filename "${exportJson.filename}".`);
}
if (exportCsv.filename !== 'investigation-176.128.43.70-2026-09-24.csv') {
  throw new Error(`Export: wrong CSV filename "${exportCsv.filename}".`);
}
if (sanitizeSlug('https://Evil.Example.COM/login') !== 'https-evil.example.com-login') {
  throw new Error(`Export: wrong slug, got "${sanitizeSlug('https://Evil.Example.COM/login')}".`);
}
if (sanitizeSlug('') !== 'ioc' || sanitizeSlug('///') !== 'ioc') {
  throw new Error('Export: empty slugs must fall back to "ioc".');
}
if (
  buildExportFilename({ format: 'csv', generatedAt: exportNow, slug: 'evil.example', multi: false }) !==
  'investigation-evil.example-2026-09-24.csv'
) {
  throw new Error('Export: buildExportFilename must build single-investigation names.');
}
if (
  buildExportFilename({ format: 'markdown', generatedAt: 'garbage', slug: null, multi: true }) !==
  'investigations-undated.md'
) {
  throw new Error('Export: buildExportFilename must degrade on an unreadable date.');
}
// AC06: analyst notes are reproduced verbatim in every format — multi-line
// notes stay multi-line in Markdown/JSON and are quoted as one cell in CSV.
if (!exportMd.content.includes('## Analyst notes')) {
  throw new Error('Export: Markdown must contain the analyst notes section.');
}
if (!exportMd.content.includes('Line one\nline two, with comma')) {
  throw new Error('Export: Markdown must reproduce the notes verbatim.');
}
if (jsonPayload.notes !== 'Line one\nline two, with comma') {
  throw new Error('Export: JSON must reproduce the notes verbatim.');
}
if (!exportCsv.content.includes('"Line one\nline two, with comma"')) {
  throw new Error('Export: CSV must quote the multi-line notes cell.');
}

// AC07: the exported verdict is strictly the recorded one.
if (!exportMd.content.includes('**Verdict:** Suspicious')) {
  throw new Error('Export: Markdown must show the recorded verdict.');
}
if (jsonPayload.verdict !== 'suspicious') {
  throw new Error('Export: JSON must carry the recorded verdict.');
}

// AC08 + AC17: the headline IoC is defanged and sits between backticks — it
// can never become an active link.
if (!exportMd.content.includes('**IOC:** `176[.]128[.]43[.]70`')) {
  throw new Error('Export: Markdown must show the defanged IoC in backticks.');
}

// AC09: JSON keeps native types — Yes/No become booleans, integers numbers.
if (jsonPayload.analysis.checks[0].fields.hosting !== true) {
  throw new Error('Export: JSON must turn "Yes" into true.');
}
if (jsonPayload.analysis.checks[0].fields.confidence !== 87) {
  throw new Error('Export: JSON must turn "87" into the number 87.');
}
if (typeof jsonPayload.analysis.checks[0].fields.organization !== 'string') {
  throw new Error('Export: JSON must keep free text as a string.');
}
if (jsonPayload.analysis.checks[0].ms !== 320) {
  throw new Error('Export: JSON must keep the duration as a number.');
}
if (jsonPayload.type !== 'ip' || jsonPayload.normalized !== '176.128.43.70') {
  throw new Error('Export: JSON must carry the type and the normalized value.');
}
if (jsonPayload.raw !== null) {
  throw new Error('Export: a history entry has no raw spelling — JSON must use null (AC12).');
}

// AC10: RFC 4180 escaping — commas, quotes and line breaks get quoted.
if (escapeCell('a,b') !== '"a,b"' || escapeCell('say "hi"') !== '"say ""hi"""') {
  throw new Error('Export: escapeCell must quote commas and double the quotes.');
}
if (escapeCell('line1\nline2') !== '"line1\nline2"' || escapeCell('plain') !== 'plain') {
  throw new Error('Export: escapeCell must quote line breaks only.');
}
if (!exportCsv.content.includes('"Evil Hosting, ""Ltd"""')) {
  throw new Error('Export: CSV cells with commas/quotes must be escaped.');
}

// AC16: provider attribution sits between the check heading and its facts;
// `No result` stays distinguishable from `Error`.
const headingAt = exportMd.content.indexOf('### IP intelligence');
const providerAt = exportMd.content.indexOf('Source: ipapi.is');
const firstFieldAt = exportMd.content.indexOf('- ASN:');
if (headingAt === -1 || providerAt === -1 || firstFieldAt === -1 || providerAt < headingAt || providerAt > firstFieldAt) {
  throw new Error('Export: provider attribution must sit between the check heading and the facts.');
}
if (jsonPayload.analysis.checks[0].provider !== 'ipapi.is') {
  throw new Error('Export: JSON must carry the provider name.');
}
if (jsonPayload.analysis.checks[1].provider !== null) {
  throw new Error('Export: a check without a catalog tool has no provider name.');
}
if (
  jsonPayload.analysis.checks[1].statusLabel !== 'Error' ||
  jsonPayload.analysis.checks[2].statusLabel !== 'No result'
) {
  throw new Error('Export: "Error" and "No result" must stay distinguishable.');
}
if (
  !exportMd.content.includes('- Status: Error') ||
  !exportMd.content.includes('- Status: No result') ||
  !exportMd.content.includes('- Message: No reports for this address.')
) {
  throw new Error('Export: Markdown must surface check statuses and messages.');
}

// AC17: the Markdown links section lists names only — a deep-link URL must
// never render as an active link (JSON keeps the structured URLs).
if (!exportMd.content.includes('- AbuseIPDB')) {
  throw new Error('Export: Markdown must list the investigation links by name.');
}
if (exportMd.content.includes('abuseipdb.com/check')) {
  throw new Error('Export: Markdown must not embed deep-link URLs (AC17).');
}
if (!jsonPayload.links.some((link) => link.url.includes('abuseipdb.com/check/176.128.43.70'))) {
  throw new Error('Export: JSON may keep the structured link URLs.');
}

// Provenance label in Markdown, generation date, tags joined for CSV.
if (!exportMd.content.includes('**Source:** Extracted from pasted text')) {
  throw new Error('Export: Markdown must show the recorded provenance.');
}
if (!exportMd.content.includes('Generated: 24/09/2026 08:00')) {
  throw new Error('Export: Markdown must show the generation date.');
}
if (!exportCsv.content.includes('phishing;customer-incident')) {
  throw new Error('Export: CSV must join the tags with semicolons.');
}
const csvHeader = exportCsv.content.split('\n')[0];
if (
  csvHeader.indexOf('ip_intel_status') === -1 ||
  csvHeader.indexOf('asn') === -1 ||
  csvHeader.indexOf('ip_intel_status') > csvHeader.indexOf('asn')
) {
  throw new Error('Export: CSV columns must be base fields, then statuses, then fields.');
}
// AC11: content options are applied when the model is built — excluded
// sections stay absent from the document, not merely empty.
const bareOptions = {
  ...exportOptions,
  includeAnalysis: false,
  includeNotes: false,
  includeTags: false,
  includeLinks: false,
};
const bareInv = buildExportModel([exportEntry], bareOptions).investigations[0];
if ('analysis' in bareInv || 'notes' in bareInv.analyst || 'tags' in bareInv.analyst || 'links' in bareInv) {
  throw new Error('Export: excluded sections must be absent from the model (AC11).');
}
const bareJson = JSON.parse(exportInvestigation([exportEntry], 'json', bareOptions).content);
if ('analysis' in bareJson || 'notes' in bareJson || 'tags' in bareJson || 'links' in bareJson) {
  throw new Error('Export: excluded sections must be absent from JSON (AC11).');
}
const bareMd = exportInvestigation([exportEntry], 'markdown', bareOptions).content;
for (const heading of ['## Tags', '## Analysis results', '## Analyst notes', '## Investigation links']) {
  if (bareMd.includes(heading)) {
    throw new Error(`Export: excluded section "${heading}" leaked into Markdown (AC11).`);
  }
}
const bareCsvHeader = exportInvestigation([exportEntry], 'csv', bareOptions).content.split('\n')[0];
if (bareCsvHeader.includes('notes') || bareCsvHeader.includes('_status')) {
  throw new Error('Export: excluded columns must be absent from CSV (AC11).');
}
// includeRaw (JSON only): the key appears — null, because nothing is retained.
const rawCheck = buildExportModel([exportEntry], { ...exportOptions, includeRaw: true })
  .investigations[0].analysis.checks[0];
if (!('raw' in rawCheck) || rawCheck.raw !== null) {
  throw new Error('Export: includeRaw must add a null raw payload (AC12).');
}
const defaultCheck = buildExportModel([exportEntry], exportOptions).investigations[0].analysis.checks[0];
if ('raw' in defaultCheck) {
  throw new Error('Export: raw payloads must stay opt-in (AC11).');
}
if (
  ExportOptionsDefaults.includeAnalysis !== true ||
  ExportOptionsDefaults.includeNotes !== true ||
  ExportOptionsDefaults.includeTags !== true ||
  ExportOptionsDefaults.includeLinks !== true ||
  ExportOptionsDefaults.includeRaw !== false ||
  !Object.isFrozen(ExportOptionsDefaults)
) {
  throw new Error('Export: unexpected default content options.');
}

// AC12: missing data never breaks an export — null in JSON, empty in CSV,
// "Not available" in Markdown; older entries without provenance still work.
const partial = { typeId: 'domain', normalized: 'example.test' };
const partialInv = buildExportModel([partial], exportOptions).investigations[0];
if (partialInv.dates.first !== null || partialInv.dates.last !== null) {
  throw new Error('Export: missing dates must be null in the model (AC12).');
}
if (partialInv.dates.firstLabel !== 'Not available' || partialInv.dates.lastLabel !== 'Not available') {
  throw new Error('Export: missing dates must read "Not available" (AC12).');
}
if (partialInv.analyst.verdict !== 'unknown' || partialInv.analysis !== null || partialInv.provenance !== null) {
  throw new Error('Export: a partial entry must default safely (AC12).');
}
if (partialInv.indicator.defanged !== 'example[.]test') {
  throw new Error('Export: a missing defanged value must be computed.');
}
const partialMd = exportInvestigation([partial], 'markdown', exportOptions).content;
if (!partialMd.includes('**First analyzed:** Not available') || !partialMd.includes('**Verdict:** Unknown')) {
  throw new Error('Export: Markdown must show "Not available" / "Unknown" (AC12).');
}
if (!partialMd.includes('No analysis stored.')) {
  throw new Error('Export: Markdown must say when no analysis is stored.');
}
if (partialMd.includes('**Source:**')) {
  throw new Error('Export: an unknown provenance must be omitted, not invented.');
}
const partialJson = JSON.parse(exportInvestigation([partial], 'json', exportOptions).content);
if (partialJson.firstAnalyzedAt !== null || partialJson.lastAnalyzedAt !== null || partialJson.source !== null) {
  throw new Error('Export: JSON must use null for missing data (AC12).');
}
if (partialJson.verdict !== 'unknown' || partialJson.analysis !== null) {
  throw new Error('Export: JSON must default the verdict and report no analysis.');
}
const partialLines = exportInvestigation([partial], 'csv', exportOptions).content.trimEnd().split('\n');
const partialCols = partialLines[0].split(',');
const partialVals = partialLines[1].split(',');
const partialCell = (/** @type {string} */ name) => partialVals[partialCols.indexOf(name)];
if (
  partialCell('ioc') !== 'example[.]test' ||
  partialCell('raw') !== '' ||
  partialCell('first_analyzed') !== '' ||
  partialCell('last_analyzed') !== '' ||
  partialCell('source') !== '' ||
  partialCell('verdict') !== 'unknown'
) {
  throw new Error('Export: CSV must render missing data as empty cells (AC12).');
}
// AC13: multi-export — one file, several investigations.
const multiModel = buildMultiExportModel([exportEntry2, exportEntry3], exportOptions);
if (multiModel.investigations.length !== 2 || multiModel.metadata.generatedAt !== exportNow) {
  throw new Error('Export: the multi model must carry every investigation and the date.');
}
const multiMd = exportInvestigation([exportEntry2, exportEntry3], 'markdown', exportOptions);
if (!multiMd.content.startsWith('# IOC Investigation Report')) {
  throw new Error('Export: a multi export must use the report layout.');
}
if (!multiMd.content.includes('## phish[.]example') || !multiMd.content.includes('## 203[.]0[.]113[.]7')) {
  throw new Error('Export: every investigation must appear in the report.');
}
const multiJson = JSON.parse(exportInvestigation([exportEntry2, exportEntry3], 'json', exportOptions).content);
if (!Array.isArray(multiJson.investigations) || multiJson.investigations.length !== 2) {
  throw new Error('Export: the JSON report must list every investigation.');
}
if (multiJson.generatedAt !== exportNow) {
  throw new Error('Export: the JSON report must carry the generation date.');
}
const multiCsv = exportInvestigation([exportEntry2, exportEntry3], 'csv', exportOptions);
const multiLines = multiCsv.content.trimEnd().split('\n');
if (
  multiLines.length !== 3 ||
  !multiLines[1].includes('phish[.]example') ||
  !multiLines[2].includes('203[.]0[.]113[.]7')
) {
  throw new Error('Export: CSV must hold one line per investigation.');
}
if (multiCsv.filename !== 'investigations-2026-09-24.csv') {
  throw new Error(`Export: wrong multi filename "${multiCsv.filename}" (AC15).`);
}

// AC14: building an export never mutates the investigations — the history and
// its lastAnalyzedAt stay untouched.
if (JSON.stringify(exportEntry) !== exportClone) {
  throw new Error('Export: the source investigation was mutated (AC14).');
}

// Session-only input without a defanged spelling: it is computed from the
// normalized value, and the original raw spelling travels along in JSON.
const sessionUrl = {
  typeId: 'url',
  normalized: 'https://evil.example.com/login',
  raw: 'hxxps://evil[.]example[.]com/login',
  latestAnalysis: null,
};
const sessionMd = exportInvestigation([sessionUrl], 'markdown', exportOptions);
if (!sessionMd.content.includes('hxxps://evil[.]example[.]com/login')) {
  throw new Error('Export: a missing defanged value must be computed (AC08).');
}
if (!/^[A-Za-z0-9._-]+\.md$/.test(sessionMd.filename)) {
  throw new Error(`Export: unsafe filename "${sessionMd.filename}" (AC15).`);
}
const sessionJson = JSON.parse(exportInvestigation([sessionUrl], 'json', exportOptions).content);
if (sessionJson.raw !== 'hxxps://evil[.]example[.]com/login') {
  throw new Error('Export: JSON must keep the value exactly as found.');
}
if (sessionJson.verdict !== 'unknown') {
  throw new Error('Export: a session export without a recorded verdict is "unknown" (AC07).');
}

// Shared helpers stay in sync with the catalog and the display conventions.
if (capitalize('unknown') !== 'Unknown' || slugLabel('Sample names') !== 'sample_names' || slugLabel('ASN') !== 'asn') {
  throw new Error('Export: shared formatting helpers are off-contract.');
}
for (const type of catalog.iocTypes) {
  if (typeLabel(type.id) !== type.label) {
    throw new Error(`Export: typeLabel("${type.id}") must match the catalog.`);
  }
}
if (typeLabel('nope') !== 'nope') {
  throw new Error('Export: typeLabel must fall back to the identifier.');
}

// --- Investigation workspace (US V2, lot 1) --------------------------------
// This whole section runs while `globalThis.fetch` still throws (stubbed by
// the export tests above): creating, mutating and persisting a workspace must
// never touch the network (US V2: local-only, pivots only via expected sources).

const wsNow = '2026-09-24T14:26:00.000Z';

// AC01: creation with name / description / tags + one created timeline event.
let ws = createInvestigation(
  {
    name: 'Suspicious customer email',
    description: 'Phishing campaign seen on 24/09',
    tags: ['Phishing', 'Customer Incident'],
  },
  wsNow,
);
if (ws.name !== 'Suspicious customer email' || ws.description !== 'Phishing campaign seen on 24/09') {
  throw new Error('Workspace: name/description must be stored (AC01).');
}
if (ws.tags.join(',') !== 'phishing,customer-incident') {
  throw new Error(`Workspace: tags must normalize like V1.3, got ${JSON.stringify(ws.tags)} (AC01).`);
}
if (
  ws.status !== 'open' ||
  ws.nodes.length !== 0 ||
  ws.timeline.length !== 1 ||
  ws.timeline[0].type !== 'investigation_created'
) {
  throw new Error('Workspace: a fresh investigation must be open and record its creation (AC01/AC15).');
}
let wsThrew = false;
try {
  createInvestigation({ name: '   ' }, wsNow);
} catch {
  wsThrew = true;
}
if (!wsThrew) {
  throw new Error('Workspace: an empty name must be rejected (AC01).');
}

// AC02/AC03: auto-typed nodes; defanged, plain and uppercase spellings of the
// same indicator collapse into ONE node keeping the V1.3 identity.
ws = addNode(ws, { value: 'evil[.]example.com', seed: true }, wsNow);
ws = addNode(ws, { value: 'EVIL.example.COM' }, wsNow);
if (ws.nodes.length !== 1) {
  throw new Error(`Workspace: spellings must deduplicate, got ${ws.nodes.length} nodes (AC03).`);
}
const wsDomain = ws.nodes[0];
if (wsDomain.id !== nodeIdOf('domain', 'evil.example.com') || !wsDomain.seed || wsDomain.depth !== 0) {
  throw new Error('Workspace: seed nodes must use the V1.3 identity and depth 0 (AC03).');
}
// Re-adding without the seed flag must not clear it: the flag is sticky.
ws = addNode(ws, { value: 'evil.example.com' }, wsNow);
if (!ws.nodes[0].seed) {
  throw new Error('Workspace: the seed flag must be sticky (AC03).');
}

ws = addNode(ws, { value: 'hxxps://evil[.]example[.]com/login' }, wsNow); // refang detect → url
ws = addNode(ws, { value: 'AS12345' }, wsNow); // → asn
ws = addNode(ws, { value: 'admin[@]evil.example.com' }, wsNow); // → email
ws = addNode(ws, { value: 'd41d8cd98f00b204e9800998ecf8427e' }, wsNow); // → file (hash)
ws = addNode(ws, { value: '203.0.113.24', seed: true }, wsNow); // → ip
const wsTypes = ws.nodes.map((node) => node.typeId).sort().join(',');
if (wsTypes !== 'asn,domain,email,file,ip,url') {
  throw new Error(`Workspace: unexpected node types "${wsTypes}" (AC02).`);
}
if (detectNodeType('AS64500') !== 'asn' || detectNodeType('this is not an ioc') !== null) {
  throw new Error('Workspace: detectNodeType must recognize ASNs and reject plain text.');
}
wsThrew = false;
try {
  addNode(ws, { value: '??? ???' }, wsNow);
} catch {
  wsThrew = true;
}
if (!wsThrew) {
  throw new Error('Workspace: an undetectable value without typeId must be rejected (AC02).');
}
// AC10: a fresh node always starts as `unknown` — never a derived verdict.
const wsIpNode = ws.nodes.find((node) => node.typeId === 'ip');
if (!wsIpNode || wsIpNode.verdict !== 'unknown') {
  throw new Error('Workspace: a fresh node must start with the "unknown" verdict (AC10).');
}
// Vocabularies exported for the future UI (AC05: every relation is typed).
for (const required of ['resolves_to', 'certificate_contains', 'related_to']) {
  if (!RELATIONSHIP_TYPES.includes(required)) {
    throw new Error(`Workspace: RELATIONSHIP_TYPES must offer "${required}" (AC05).`);
  }
}
if (
  !WORKSPACE_NODE_TYPES.includes('certificate') ||
  !INVESTIGATION_STATUSES.includes('in-progress') ||
  !TIMELINE_EVENT_TYPES.includes('pivot_performed')
) {
  throw new Error('Workspace: exported vocabularies are incomplete.');
}

// AC05/AC06/AC12: typed relationships with provenance, merged evidence and
// explicit rejection of malformed input.
const wsDomainId = nodeIdOf('domain', 'evil.example.com');
const wsIpId = nodeIdOf('ip', '203.0.113.24');
const wsUrlId = nodeIdOf('url', 'https://evil.example.com/login');
ws = addRelationship(
  ws,
  {
    sourceId: wsUrlId,
    targetId: wsDomainId,
    type: 'host',
    sourceType: 'derived',
    sourceLabel: 'URL parsing',
    observedAt: wsNow,
  },
  wsNow,
);
ws = addRelationship(
  ws,
  {
    sourceId: wsDomainId,
    targetId: wsIpId,
    type: 'resolves_to',
    sourceType: 'provider',
    sourceLabel: 'Fast Analyze',
    provider: 'rdap',
    observedAt: wsNow,
  },
  wsNow,
);
if (ws.relationships.length !== 2) {
  throw new Error(`Workspace: expected 2 relationships, got ${ws.relationships.length} (AC05).`);
}
const resolves = ws.relationships.find((rel) => rel.type === 'resolves_to');
if (!resolves || resolves.sourceType !== 'provider' || resolves.provider !== 'rdap') {
  throw new Error('Workspace: relationship provenance must be kept (AC06).');
}
// A second, different observation of the SAME link appends evidence — one edge,
// several proofs (US V2 "Relations dupliquées" / "Evidence").
ws = addRelationship(
  ws,
  {
    sourceId: wsDomainId,
    targetId: wsIpId,
    type: 'resolves_to',
    sourceType: 'analyst',
    sourceLabel: 'Analyst',
    confidence: 'suspected',
    observedAt: '2026-09-24T15:00:00.000Z',
  },
  '2026-09-24T15:00:00.000Z',
);
const afterEvidence = ws.relationships.filter((rel) => rel.type === 'resolves_to');
if (afterEvidence.length !== 1) {
  throw new Error('Workspace: the same link must not duplicate the edge (AC05).');
}
if (afterEvidence[0].evidence.length !== 2) {
  throw new Error(`Workspace: expected 2 evidence entries, got ${afterEvidence[0].evidence.length}.`);
}
if (afterEvidence[0].confidence !== 'observed') {
  throw new Error('Workspace: an observed link must not downgrade to suspected.');
}
if (afterEvidence[0].observedAt !== '2026-09-24T15:00:00.000Z') {
  throw new Error('Workspace: observedAt must reflect the latest observation.');
}
// Re-adding the exact same observation must not grow the evidence list.
ws = addRelationship(
  ws,
  {
    sourceId: wsDomainId,
    targetId: wsIpId,
    type: 'resolves_to',
    sourceType: 'analyst',
    sourceLabel: 'Analyst',
    confidence: 'suspected',
    observedAt: '2026-09-24T15:00:00.000Z',
  },
  '2026-09-24T15:30:00.000Z',
);
if (ws.relationships.find((rel) => rel.type === 'resolves_to').evidence.length !== 2) {
  throw new Error('Workspace: an identical observation must not duplicate evidence.');
}
// AC12: a manual `related_to` link, source = analyst, confidence = suspected.
const wsHashId = nodeIdOf('file', 'd41d8cd98f00b204e9800998ecf8427e');
ws = addRelationship(
  ws,
  {
    sourceId: wsIpId,
    targetId: wsHashId,
    type: 'related_to',
    sourceType: 'analyst',
    sourceLabel: 'Analyst',
    confidence: 'suspected',
    observedAt: wsNow,
  },
  wsNow,
);
const manual = ws.relationships.find((rel) => rel.type === 'related_to');
if (!manual || manual.confidence !== 'suspected' || manual.sourceType !== 'analyst') {
  throw new Error('Workspace: a manual relationship must keep source Analyst (AC12).');
}
// Boundary rejections: unknown endpoints, missing type, unknown provenance.
for (const bad of [
  () => addRelationship(ws, { sourceId: 'nope', targetId: wsIpId, type: 'host', sourceType: 'derived' }, wsNow),
  () => addRelationship(ws, { sourceId: wsIpId, targetId: wsHashId, type: '  ', sourceType: 'analyst' }, wsNow),
  () => addRelationship(ws, { sourceId: wsIpId, targetId: wsHashId, type: 'host', sourceType: /** @type {any} */ ('magic') }, wsNow),
]) {
  wsThrew = false;
  try {
    bad();
  } catch {
    wsThrew = true;
  }
  if (!wsThrew) {
    throw new Error('Workspace: malformed relationships must be rejected (AC05/AC06).');
  }
}

// AC10/AC11: verdict, notes and tags are analyst-only, verbatim, timeline-aware.
const wsTimelineBefore = ws.timeline.length;
ws = setNodeVerdict(ws, wsIpId, 'suspicious', '2026-09-24T16:00:00.000Z');
const verdictNode = ws.nodes.find((node) => node.id === wsIpId);
if (verdictNode.verdict !== 'suspicious') {
  throw new Error('Workspace: the analyst verdict must be stored (AC10).');
}
if (!ws.timeline.some((event) => event.type === 'verdict_changed' && event.nodeId === wsIpId)) {
  throw new Error('Workspace: a verdict change must appear on the timeline (AC15).');
}
wsThrew = false;
try {
  setNodeVerdict(ws, wsIpId, /** @type {any} */ ('safe'), wsNow);
} catch {
  wsThrew = true;
}
if (!wsThrew) {
  throw new Error('Workspace: an unknown verdict must be rejected (AC10).');
}
// Storing provider results must never touch the verdict (AC10).
ws = setNodeAnalysis(
  ws,
  wsIpId,
  {
    checkedAt: wsNow,
    checks: [
      { id: 'ip-intel', label: 'IP intelligence', toolId: 'ipapi-is', status: 'ok', ms: 12,
        summary: null, fields: [{ label: 'ASN', value: 'AS12345' }], message: null },
    ],
  },
  wsNow,
);
const analyzedNode = ws.nodes.find((node) => node.id === wsIpId);
if (analyzedNode.verdict !== 'suspicious' || analyzedNode.analysis?.checks?.[0]?.id !== 'ip-intel') {
  throw new Error('Workspace: analysis must be stored without changing the verdict (AC10).');
}
// Notes keep line breaks and spacing exactly (AC11).
const multilineNote = 'IP observed in the first suspicious email.\nAlso present in proxy logs.\n  indented line';
ws = setNodeNotes(ws, wsIpId, multilineNote, wsNow);
ws = setInvestigationNotes(ws, 'Campaign reuses the same ASN.\nNeed to verify the second domain.', wsNow);
const notedNode = ws.nodes.find((node) => node.id === wsIpId);
if (notedNode.notes !== multilineNote || !ws.notes.includes('\nNeed to verify')) {
  throw new Error('Workspace: notes must be stored verbatim (AC11).');
}
// Tags: investigation-level and node-level, normalized like V1.3 (AC11).
ws = setInvestigationTags(ws, ['Phishing', 'phishing', 'September 2026'], wsNow);
ws = setNodeTags(ws, wsDomainId, ['c2-candidate'], wsNow);
if (ws.tags.join(',') !== 'phishing,september-2026') {
  throw new Error(`Workspace: investigation tags must normalize+dedupe, got ${JSON.stringify(ws.tags)} (AC11).`);
}
if (ws.nodes.find((node) => node.id === wsDomainId).tags.join(',') !== 'c2-candidate') {
  throw new Error('Workspace: node tags must be stored (AC11).');
}
// Status is an advancement marker (AC01/Overview), never a threat qualification.
ws = setStatus(ws, 'in-progress', wsNow);
if (ws.status !== 'in-progress') {
  throw new Error('Workspace: status must be stored.');
}
wsThrew = false;
try {
  setStatus(ws, /** @type {any} */ ('done'), wsNow);
} catch {
  wsThrew = true;
}
if (!wsThrew) {
  throw new Error('Workspace: an unknown status must be rejected.');
}
// AC17: dragged positions and hidden flags persist on the node.
ws = setNodePosition(ws, wsIpId, { x: 120.5, y: -40 });
const positioned = ws.nodes.find((node) => node.id === wsIpId);
if (positioned.position?.x !== 120.5 || positioned.position?.y !== -40) {
  throw new Error('Workspace: node positions must persist (AC17).');
}
ws = setNodeHidden(ws, wsHashId, true);
if (!ws.nodes.find((node) => node.id === wsHashId).hidden) {
  throw new Error('Workspace: hiding a node must persist without removing it.');
}
// Timeline: every significant action recorded with a unique id (AC15).
const wsEventTypes = ws.timeline.map((event) => event.type);
for (const expected of ['investigation_created', 'indicator_added', 'relationship_created', 'verdict_changed', 'note_added', 'analysis_completed']) {
  if (!wsEventTypes.includes(expected)) {
    throw new Error(`Workspace: timeline must record "${expected}" (AC15).`);
  }
}
const wsEventIds = new Set(ws.timeline.map((event) => event.id));
if (wsEventIds.size !== ws.timeline.length || ws.timeline.length <= wsTimelineBefore) {
  throw new Error('Workspace: timeline event ids must be unique (AC15).');
}
ws = recordTimelineEvent(ws, { type: 'export_created', label: 'Export created (markdown)' }, null, wsNow);
if (!ws.timeline.some((event) => event.type === 'export_created')) {
  throw new Error('Workspace: recordTimelineEvent must accept later flows (AC15).');
}

// AC18/AC19: removing a node touches ONLY this workspace — the V1.3 global
// history and other investigations stay byte-identical.
const wsHistory = new InvestigationHistoryService(undefined, 'ioc-toolkit:ws-ac19-probe');
wsHistory.upsert(
  { id: wsIpId, typeId: 'ip', normalized: '203.0.113.24', defanged: '203[.]0[.]113[.]24' },
  null,
  'manual',
);
const wsOther = createInvestigation({ name: 'Unrelated case' }, wsNow);
const wsOtherSnapshot = JSON.stringify(wsOther);
const wsHistorySnapshot = JSON.stringify(wsHistory.list());
const wsBeforeRemove = ws;
ws = removeNode(ws, wsIpId, wsNow);
if (ws.nodes.some((node) => node.id === wsIpId)) {
  throw new Error('Workspace: removeNode must drop the node.');
}
if (ws.relationships.some((rel) => rel.sourceId === wsIpId || rel.targetId === wsIpId)) {
  throw new Error('Workspace: removeNode must drop the relationships touching the node (AC18).');
}
if (!wsBeforeRemove.nodes.some((node) => node.id === wsIpId)) {
  throw new Error('Workspace: removeNode must not mutate its input (immutable updates).');
}
if (JSON.stringify(wsOther) !== wsOtherSnapshot) {
  throw new Error('Workspace: another investigation must stay untouched (AC18).');
}
if (JSON.stringify(wsHistory.list()) !== wsHistorySnapshot) {
  throw new Error('Workspace: removing a node must never touch the V1.3 history (AC19).');
}

// AC16: persistence through the repository. The adapter is injected, so a NEW
// repository over the same backend simulates "close then reopen the app".
const wsAdapter = createMemoryWorkspaceAdapter();
const wsRepo = new InvestigationRepository(wsAdapter);
let wsNotifications = 0;
const wsUnsubscribe = wsRepo.subscribe(() => {
  wsNotifications += 1;
});
const wsSaved = await wsRepo.save(ws);
if (wsSaved.id !== ws.id) {
  throw new Error('Workspace: save must return the stored investigation (AC16).');
}
if (wsNotifications !== 1) {
  throw new Error('Workspace: subscribers must be notified after a save.');
}
const wsFetched = await wsRepo.get(ws.id);
if (!wsFetched || wsFetched.nodes.length !== ws.nodes.length ||
    wsFetched.relationships.length !== ws.relationships.length) {
  throw new Error('Workspace: a fresh repository must reload the investigation (AC16).');
}
const wsRepoAfterReload = new InvestigationRepository(wsAdapter);
const wsListed = await wsRepoAfterReload.list();
if (wsListed.length !== 1 || wsListed[0].id !== ws.id) {
  throw new Error('Workspace: investigations must survive a repository restart (AC16).');
}
// Invalid payloads are rejected at the save boundary.
wsThrew = false;
try {
  await wsRepo.save(/** @type {any} */ ({ id: 'x' }));
} catch {
  wsThrew = true;
}
if (!wsThrew) {
  throw new Error('Workspace: saving a non-investigation must be rejected.');
}
// Removal returns false for an unknown id, true otherwise, and notifies.
if (await wsRepo.remove('inv-does-not-exist')) {
  throw new Error('Workspace: removing an unknown investigation must return false.');
}
if (!(await wsRepo.remove(ws.id)) || (await wsRepo.get(ws.id)) !== null) {
  throw new Error('Workspace: remove must drop the investigation (AC16).');
}
wsUnsubscribe();
if (wsNotifications !== 2) {
  throw new Error(`Workspace: expected 2 notifications (1 save + 1 remove), got ${wsNotifications}.`);
}
// The V1.3 history probe above must still be intact after all of this (AC19).
if (JSON.stringify(wsHistory.list()) !== wsHistorySnapshot) {
  throw new Error('Workspace: repository operations must never touch the V1.3 history (AC19).');
}
// Sanitizer: corrupted / partial / hostile payloads never crash a reader (AC16).
const wsGarbage = [
  null,
  42,
  'string',
  {},
  { id: '', name: 'no id' },
  { id: 'inv-ok', name: '' },
  { id: 'inv-ok2', name: '   ' },
];
for (const garbage of wsGarbage) {
  if (sanitizeInvestigation(garbage) !== null) {
    throw new Error(`Workspace: sanitizeInvestigation must reject ${JSON.stringify(garbage)}.`);
  }
}
const wsPartial = sanitizeInvestigation({
  id: 'inv-partial',
  name: 'Partial case',
  status: 'unknown-status',
  tags: 'not-an-array',
  notes: 12345,
  nodes: [
    'junk',
    { id: 'domain:evil.example.com', typeId: 'bogus-type', value: 'evil.example.com' },
    { id: 'domain:evil.example.com', typeId: 'domain', value: 'evil.example.com', verdict: 'scary' },
  ],
  relationships: [
    // Dangling: points at a node that was dropped → removed.
    { id: 'a->b', sourceId: 'domain:evil.example.com', targetId: 'ghost:nowhere', type: 'resolves_to' },
    { id: 'ok', sourceId: 'domain:evil.example.com', targetId: 'domain:evil.example.com',
      type: 'related_to', confidence: 'weird', sourceType: 'nope', evidence: 'broken' },
  ],
  timeline: [{ id: 'e1', type: 'unknown_event', label: 'x', at: wsNow }, 'junk'],
});
if (!wsPartial || wsPartial.status !== 'open' || !Array.isArray(wsPartial.tags)) {
  throw new Error('Workspace: a partial payload must sanitize to safe defaults (AC16).');
}
if (wsPartial.notes !== '' || wsPartial.nodes.length !== 1) {
  throw new Error('Workspace: the sanitizer must drop invalid fields and nodes (AC16).');
}
if (wsPartial.nodes[0].verdict !== 'unknown' || wsPartial.nodes[0].defanged !== 'evil[.]example[.]com') {
  throw new Error('Workspace: the sanitizer must reset an invalid verdict and recompute the defang.');
}
if (wsPartial.relationships.length !== 1) {
  throw new Error('Workspace: dangling relationships must be dropped by the sanitizer.');
}
if (wsPartial.relationships[0].confidence !== 'suspected' ||
    wsPartial.relationships[0].sourceType !== 'analyst' ||
    !Array.isArray(wsPartial.relationships[0].evidence)) {
  throw new Error('Workspace: the sanitizer must reset invalid relationship fields.');
}
if (wsPartial.timeline.length !== 0) {
  throw new Error('Workspace: unknown timeline events must be dropped.');
}
// Memory adapter sanitizes its seed too; IndexedDB adapter returns null when
// the factory is unavailable (Node test environment has no indexedDB).
const wsSeeded = createMemoryWorkspaceAdapter([{ bogus: true }, ws]);
if ((await wsSeeded.getAll()).length !== 1) {
  throw new Error('Workspace: the memory adapter must sanitize its seed.');
}
if (createIndexedDbWorkspaceAdapter(null) !== null) {
  throw new Error('Workspace: the IndexedDB adapter must fall back when unavailable.');
}

// --- Pure workspace view helpers (V2 lot 2) ---------------------------------
const graphDomain = {
  id: 'domain:graph.example.com', typeId: 'domain', value: 'graph.example.com',
  defanged: 'graph[.]example[.]com', raw: 'graph.example.com', verdict: 'unknown',
  notes: '', analysis: null, seed: true, depth: 0, tags: [], hidden: false,
  position: { x: 101, y: 202 }, addedAt: wsNow,
};
const graphIp = {
  ...graphDomain, id: 'ip:192.0.2.10', typeId: 'ip', value: '192.0.2.10',
  defanged: '192.0.2.10', seed: false, depth: 1, position: null,
};
const graphUrl = {
  ...graphDomain, id: 'url:https://graph.example.com/login', typeId: 'url',
  value: 'https://graph.example.com/login', defanged: 'hxxps://graph[.]example[.]com/login',
  seed: false, depth: 2, position: null,
};
const graphNodes = [graphDomain, graphIp, graphUrl];
const graphRelationships = [
  { id: `${graphDomain.id}->${graphIp.id}:resolves_to`, sourceId: graphDomain.id, targetId: graphIp.id,
    type: 'resolves_to', confidence: 'observed', sourceType: 'provider', sourceLabel: 'RDAP', provider: 'rdap', observedAt: wsNow, evidence: [] },
  { id: `${graphIp.id}->${graphUrl.id}:related_to`, sourceId: graphIp.id, targetId: graphUrl.id,
    type: 'related_to', confidence: 'suspected', sourceType: 'analyst', sourceLabel: 'Analyst', provider: null, observedAt: wsNow, evidence: [] },
];
const graphLayout = computeGraphLayout(graphNodes, { width: GRAPH_WIDTH, height: GRAPH_HEIGHT });
if (graphLayout.size !== graphNodes.length || graphLayout.get(graphDomain.id).x !== 101 || graphLayout.get(graphDomain.id).y !== 202) {
  throw new Error('Graph layout: stored drag positions must win over automatic placement (AC17).');
}
const oneHop = neighborhoodIds(graphRelationships, graphDomain.id, 1);
if (oneHop.size !== 2 || !oneHop.has(graphIp.id) || oneHop.has(graphUrl.id)) {
  throw new Error('Graph filter: neighborhood isolation must honor the requested depth.');
}
const graphFiltered = filterGraph(graphNodes, graphRelationships, {
  types: ['domain'], verdicts: ['unknown'], focusId: graphDomain.id, focusDepth: 1, query: 'graph',
});
if (graphFiltered.nodes.length !== 1 || graphFiltered.nodes[0].id !== graphDomain.id || graphFiltered.relationships.length !== 0 || !graphFiltered.matchIds.has(graphDomain.id)) {
  throw new Error('Graph filter: facets must compose and edges must disappear with a hidden endpoint.');
}
if (filterGraph(graphNodes, graphRelationships, { sources: ['analyst'] }).relationships.length !== 1 ||
    filterGraph(graphNodes, graphRelationships, { sourceTypes: ['provider'] }).relationships.length !== 1) {
  throw new Error('Graph filter: relationship provenance must be filterable.');
}
if (filterGraph(graphNodes, graphRelationships, { includeHidden: false }).nodes.some((node) => node.hidden)) {
  throw new Error('Graph filter: hidden nodes must be excluded by default.');
}
const viewInvestigation = {
  id: 'view-1', name: 'Customer incident', description: 'Campaign notes', status: 'open',
  tags: ['phishing'], notes: 'Check firewall logs', nodes: graphNodes, relationships: graphRelationships,
  timeline: [], createdAt: wsNow, updatedAt: wsNow,
};
const viewStats = investigationStats(viewInvestigation);
if (viewStats.indicators !== 3 || viewStats.relationships !== 2 || viewStats.seeds !== 1 || viewStats.verdicts.unknown !== 3) {
  throw new Error('Workspace view: investigation counters are incorrect.');
}
if (filterWorkspaceList([viewInvestigation], 'FIREWALL').length !== 1 || filterWorkspaceList([viewInvestigation], 'not-present').length !== 0) {
  throw new Error('Workspace view: search must cover investigation notes and IoCs.');
}
if (STATUS_LABELS.closed !== 'Closed' || VERDICT_LABELS.suspicious !== 'Suspicious') {
  throw new Error('Workspace view: status and verdict labels are off-contract.');
}
const editedInfo = setInvestigationInfo(ws, { name: 'Renamed case', description: 'Updated context' }, wsNow);
if (editedInfo.name !== 'Renamed case' || editedInfo.description !== 'Updated context' || editedInfo === ws) {
  throw new Error('Workspace model: investigation metadata must be editable immutably.');
}

// --- V2 lot 3: intake and bounded pivots -----------------------------------
const intakeInputs = [
  { typeId: 'domain', normalized: 'evil.example.com', raw: 'evil[.]example[.]com', source: 'extracted-text' },
  { typeId: 'url', normalized: 'https://evil.example.com/login', raw: 'hxxps://evil[.]example[.]com/login', source: 'extracted-text' },
  { typeId: 'ip', normalized: '192.0.2.44', source: 'email-headers', verdict: 'suspicious', notes: 'Line one\nLine two', tags: ['customer-incident'] },
];
const intakeInputsBefore = JSON.stringify(intakeInputs);
const intakeCase = addIndicatorsToInvestigation(createInvestigation({ name: 'Intake case' }, wsNow), intakeInputs, { now: wsNow });
if (intakeCase.nodes.length !== 3 || intakeCase.relationships.length !== 1) throw new Error('Workspace intake: indicators and host relation must be added.');
if (JSON.stringify(intakeInputs) !== intakeInputsBefore) throw new Error('Workspace intake: inputs must not be mutated.');
const intakeDomain = intakeCase.nodes.find((node) => node.id === 'domain:evil.example.com');
const intakeIp = intakeCase.nodes.find((node) => node.id === 'ip:192.0.2.44');
if (intakeDomain?.source !== 'extracted-text' || intakeIp?.verdict !== 'suspicious' || intakeIp.notes !== 'Line one\nLine two') throw new Error('Workspace intake: provenance and analyst fields must be preserved.');
if (intakeCase.relationships[0]?.type !== 'host' || intakeCase.relationships[0]?.sourceType !== 'derived') throw new Error('Workspace intake: host relation must be attributed.');

let pivotCalls = 0;
const fakePivotAnalyzer = { getChecks() { pivotCalls += 1; return [{ id: 'fake-asn', label: 'Fake ASN', toolId: 'fake-provider', run: async () => ({ status: 'ok', summary: null, fields: [{ label: 'ASN', value: 'AS64500' }], message: null }) }]; } };
const pivotService = new WorkspacePivotService(fakePivotAnalyzer, { limits: { ...PIVOT_LIMITS, maxCandidates: 1, maxProviderRequests: 1 } });
const pivotBase = addNode(createInvestigation({ name: 'Pivot case' }, wsNow), { value: '192.0.2.45', seed: true }, wsNow);
const pivotNode = pivotBase.nodes[0];
const pivotBefore = JSON.stringify(pivotBase);
const pivotResult = await pivotService.discover(pivotNode);
if (pivotCalls !== 1 || pivotResult.candidates[0]?.value !== 'AS64500') throw new Error('Workspace pivot: discovery must return provider candidates.');
if (JSON.stringify(pivotBase) !== pivotBefore) throw new Error('Workspace pivot: discovery must not expand before selection.');
const pivotApplied = applyPivotCandidates(pivotBase, pivotNode.id, pivotResult.candidates, wsNow);
if (pivotApplied.nodes.length !== 2 || !pivotApplied.relationships.some((relationship) => relationship.type === 'announced_by' && relationship.sourceType === 'provider')) throw new Error('Workspace pivot: selected candidates must add typed relations.');
const pivotDepth = await pivotService.discover({ ...pivotNode, depth: PIVOT_LIMITS.maxDepth });
if (!pivotDepth.limited || pivotDepth.candidates.length !== 0 || pivotCalls !== 1) throw new Error('Workspace pivot: depth limit must stop provider requests.');

// --- V2 lot 3: workspace export/import --------------------------------------
let exportCase = createInvestigation({ name: 'Export case', description: 'Local report' }, wsNow);
exportCase = addNode(exportCase, { value: 'evil.example.com', seed: true }, wsNow);
exportCase = addNode(exportCase, { value: '192.0.2.46', seed: true }, wsNow);
exportCase = addRelationship(exportCase, {
  sourceId: 'domain:evil.example.com', targetId: 'ip:192.0.2.46', type: 'resolves_to',
  sourceType: 'provider', sourceLabel: 'Fake provider', provider: 'fake-provider', observedAt: wsNow,
}, wsNow);
exportCase = setNodeNotes(exportCase, 'domain:evil.example.com', 'Comma, quote " and\nline break', wsNow);
exportCase = setNodeAnalysis(exportCase, 'ip:192.0.2.46', {
  checkedAt: wsNow,
  checks: [{ id: 'fake', label: 'Fake check', toolId: 'fake-provider', status: 'ok', summary: 'OK', fields: [{ label: 'Country', value: 'FR' }], message: null }],
}, wsNow);
exportCase = setInvestigationNotes(exportCase, 'Campaign note\nwith a line break', wsNow);
const workspaceJson = exportWorkspaceInvestigation(exportCase, 'json', { now: wsNow });
const workspaceJsonPayload = JSON.parse(workspaceJson.content);
if (workspaceJsonPayload.generatedAt !== wsNow || workspaceJsonPayload.investigation.nodes.length !== 2) throw new Error('Workspace export: JSON must preserve the investigation.');
const workspaceMarkdown = exportWorkspaceInvestigation(exportCase, 'markdown', { now: wsNow });
if (!workspaceMarkdown.content.includes('`evil[.]example[.]com`') || !workspaceMarkdown.content.includes('Fake provider')) throw new Error('Workspace export: Markdown must include defanged values and provenance.');
if (/\]\(https?:\/\//i.test(workspaceMarkdown.content)) throw new Error('Workspace export: Markdown must not create active indicator links.');
const workspaceCsv = exportWorkspaceInvestigation(exportCase, 'csv', { now: wsNow });
if (!workspaceCsv.content.includes('"Comma, quote "" and\nline break"')) throw new Error('Workspace export: CSV must escape commas, quotes and line breaks.');
const importedWorkspace = parseWorkspaceImport(workspaceJson.content);
if (importedWorkspace.investigation.id !== exportCase.id || importedWorkspace.investigation.relationships.length !== 1 || importedWorkspace.generatedAt !== wsNow) throw new Error('Workspace import: generated JSON must round-trip locally.');
let importRejected = false;
try { parseWorkspaceImport('{not-json'); } catch { importRejected = true; }
if (!importRejected) throw new Error('Workspace import: malformed JSON must be rejected.');

// Lot 5: a duplicate is a new identity with no mutable aliases to the source.
let lifecycleSource = createInvestigation(
  { name: 'Lifecycle source', description: 'Context', tags: ['Phishing'] },
  wsNow,
);
lifecycleSource = addNode(lifecycleSource, { value: 'duplicate.example.com', seed: true }, wsNow);
lifecycleSource = addNode(lifecycleSource, { value: '192.0.2.47' }, wsNow);
lifecycleSource = addRelationship(lifecycleSource, {
  sourceId: 'domain:duplicate.example.com',
  targetId: 'ip:192.0.2.47',
  type: 'resolves_to',
  sourceType: 'provider',
  sourceLabel: 'Lifecycle provider',
  provider: 'fake-provider',
  observedAt: wsNow,
}, wsNow);
lifecycleSource = setStatus(lifecycleSource, 'closed', wsNow);
lifecycleSource = setNodeVerdict(lifecycleSource, 'domain:duplicate.example.com', 'suspicious', wsNow);
lifecycleSource = setNodeNotes(lifecycleSource, 'domain:duplicate.example.com', 'Original node note', wsNow);
lifecycleSource = setNodeTags(lifecycleSource, 'domain:duplicate.example.com', ['c2'], wsNow);
lifecycleSource = setNodePosition(lifecycleSource, 'domain:duplicate.example.com', { x: 111, y: 222 });
lifecycleSource = setNodeAnalysis(lifecycleSource, 'ip:192.0.2.47', {
  checkedAt: wsNow,
  checks: [{ id: 'duplicate-check', label: 'Duplicate check', toolId: null, status: 'ok', summary: null, fields: [{ label: 'ASN', value: 'AS64500' }], message: null }],
}, wsNow);
lifecycleSource = setInvestigationNotes(lifecycleSource, 'Original investigation note', wsNow);
const lifecycleSnapshot = JSON.stringify(lifecycleSource);
const duplicateAt = '2026-09-25T10:00:00.000Z';
const lifecycleCopy = duplicateInvestigation(lifecycleSource, { now: duplicateAt });
if (
  lifecycleCopy.id === lifecycleSource.id ||
  lifecycleCopy.name !== 'Lifecycle source (Copy)' ||
  lifecycleCopy.status !== 'open' ||
  lifecycleCopy.createdAt !== duplicateAt ||
  lifecycleCopy.updatedAt !== duplicateAt ||
  lifecycleCopy.timeline.length !== lifecycleSource.timeline.length + 1 ||
  lifecycleCopy.timeline.at(-1)?.type !== 'investigation_created'
) {
  throw new Error('Workspace duplicate: identity, lifecycle state and creation event must be fresh.');
}
if (
  lifecycleCopy.nodes[0] === lifecycleSource.nodes[0] ||
  lifecycleCopy.nodes[1].analysis?.checks[0] === lifecycleSource.nodes[1].analysis?.checks[0] ||
  lifecycleCopy.relationships[0].evidence[0] === lifecycleSource.relationships[0].evidence[0]
) {
  throw new Error('Workspace duplicate: nested graph and analysis data must be deeply independent.');
}
const copiedAnalysis = /** @type {NonNullable<import('../src/lib/types.js').WorkspaceNode['analysis']>} */ (lifecycleCopy.nodes[1].analysis);
copiedAnalysis.checks[0].fields[0].value = 'AS65535';
lifecycleCopy.relationships[0].evidence[0].provider = 'changed';
lifecycleCopy.tags.push('changed');
lifecycleCopy.nodes[0].notes = 'Changed copy note';
if (JSON.stringify(lifecycleSource) !== lifecycleSnapshot) {
  throw new Error('Workspace duplicate: mutating the copy must not mutate its source.');
}
if (
  lifecycleCopy.nodes[0].verdict !== 'suspicious' ||
  lifecycleCopy.nodes[0].position?.x !== 111 ||
  lifecycleCopy.relationships[0].evidence[0].sourceLabel !== 'Lifecycle provider' ||
  lifecycleCopy.notes !== 'Original investigation note'
) {
  throw new Error('Workspace duplicate: analyst and provenance data must be preserved.');
}
let emptyDuplicateName = false;
try { duplicateInvestigation(lifecycleSource, { name: '   ' }); } catch { emptyDuplicateName = true; }
if (!emptyDuplicateName) throw new Error('Workspace duplicate: an empty copy name must be rejected.');

// A colliding import is copied instead of replacing the existing record.
const importedAt = '2026-09-25T11:00:00.000Z';
const collisionCopy = resolveWorkspaceImportCollision(
  lifecycleSource,
  new Set([lifecycleSource.id]),
  { now: importedAt },
);
if (
  collisionCopy.id === lifecycleSource.id ||
  collisionCopy.name !== 'Lifecycle source (Imported copy)' ||
  collisionCopy.status !== 'open' ||
  collisionCopy.nodes.length !== lifecycleSource.nodes.length
) {
  throw new Error('Workspace import: an id collision must create an independent copy.');
}
if (resolveWorkspaceImportCollision(lifecycleSource, [], { now: importedAt }).id !== lifecycleSource.id) {
  throw new Error('Workspace import: a non-colliding investigation must keep its id.');
}
const lifecycleRepo = new InvestigationRepository(createMemoryWorkspaceAdapter([lifecycleSource]));
await lifecycleRepo.save(collisionCopy);
const lifecycleRecords = await lifecycleRepo.list();
if (lifecycleRecords.length !== 2 || new Set(lifecycleRecords.map((entry) => entry.id)).size !== 2) {
  throw new Error('Workspace import: resolving a collision must preserve both investigations.');
}

// UI safety: deletion is disabled until the exact investigation name is typed.
const investigationListSource = readFileSync(
  new URL('../src/lib/components/InvestigationList.svelte', import.meta.url),
  'utf8',
);
if (
  !investigationListSource.includes('deleteName !== investigation.name') ||
  !investigationListSource.includes('await onDelete(investigation.id)')
) {
  throw new Error('Workspace delete: permanent deletion must require the exact name.');
}

// Regression: the list must leave its loading state after repository.list(),
// including when that call fails. Otherwise the empty list stays hidden.
const workspaceModalSource = readFileSync(
  new URL('../src/lib/components/WorkspaceModal.svelte', import.meta.url),
  'utf8',
);
const refreshSource = workspaceModalSource.match(
  /async function refresh\(\) \{([\s\S]*?)^  \}/m,
)?.[1];
if (
  !refreshSource?.includes('loading = true;') ||
  !/catch\s*\(cause\)/.test(refreshSource) ||
  !/finally\s*\{\s*loading = false;\s*\}/.test(refreshSource)
) {
  throw new Error('Workspace list: refresh must always clear its loading state.');
}

globalThis.fetch = originalFetch;

console.log(`SMOKE OK — ${loaded.tools.length} tools / ${loaded.categories.length} categories`);
console.log(`ids: ${ids.join(', ')}`);
console.log(`counts: ${JSON.stringify([...countToolsByCategory(loaded.tools)])}`);
