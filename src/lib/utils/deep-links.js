/**
 * "Go further" deep links: URLs of catalog tools opened with the IoC already
 * entered (query parameter, path segment or search fragment depending on the
 * tool). Only tools present in the catalog that support the IoC type are
 * listed, so links always resolve to a card on the site.
 *
 * Pure module — no DOM, no network — exercised by `npm run smoke`.
 */

/**
 * @typedef {Object} DeepLink
 * @property {string} toolId Identifier of the catalog tool the link points to.
 * @property {string} name   Tool display name (from the catalog).
 * @property {string} url    Tool URL with the IoC already embedded.
 * @property {string} hint   What the tool will show for this IoC.
 */

/** @param {string} value @returns {string} */
const enc = (value) => encodeURIComponent(value);

/**
 * Deep-link builders keyed by IoC type then catalog tool id. Every entry must
 * reference an existing tool id — the smoke test guards against typos.
 *
 * @type {Record<string, Record<string, { url: (value: string) => string, hint: string }>>}
 */
const DEEP_LINK_BUILDERS = {
  ip: {
    abuseipdb: {
      url: (value) => `https://www.abuseipdb.com/check/${value}`,
      hint: 'Abuse reports and confidence score for this IP',
    },
    scamalytics: {
      url: (value) => `https://scamalytics.com/ip/${value}`,
      hint: 'Fraud score and proxy / VPN / Tor detection',
    },
    virustotal: {
      url: (value) => `https://www.virustotal.com/gui/ip-address/${value}`,
      hint: 'Reputation across dozens of antivirus engines',
    },
    'he-bgp-toolkit': {
      url: (value) => `https://bgp.he.net/ip/${value}`,
      hint: 'BGP routes, announced prefixes and ASN details',
    },
    dnslytics: {
      url: (value) => `https://dnslytics.com/ip/${value}`,
      hint: 'Hosting provider and domains co-hosted on this IP',
    },
  },
  domain: {
    crtsh: {
      url: (value) => `https://crt.sh/?q=${value}`,
      hint: 'Subdomains and issuers from certificate transparency logs',
    },
    'urlscan-io': {
      url: (value) => `https://urlscan.io/domain/${value}`,
      hint: 'Historical scans of the domain',
    },
    virustotal: {
      url: (value) => `https://www.virustotal.com/gui/domain/${value}`,
      hint: 'Domain reputation and observed resolutions',
    },
    'alienvault-otx': {
      url: (value) => `https://otx.alienvault.com/indicator/domain/${value}`,
      hint: 'Threat pulses mentioning this domain',
    },
    threatfox: {
      url: (value) => `https://threatfox.abuse.ch/browse.php?search=ioc%3A${value}`,
      hint: 'Malware IOCs linked to this domain',
    },
    mxtoolbox: {
      url: (value) => `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${value}&run=toolpage`,
      hint: 'MX records and mail configuration',
    },
    viewdns: {
      url: (value) => `https://viewdns.info/whois/?domain=${value}`,
      hint: 'WHOIS record and ownership details',
    },
  },
  url: {
    'urlscan-io': {
      url: (value) => `https://urlscan.io/search/#${enc(`page.url:"${value}"`)}`,
      hint: 'Scan history for this exact URL',
    },
    virustotal: {
      url: (value) => `https://www.virustotal.com/gui/search/${enc(value)}`,
      hint: 'URL verdict across antivirus engines',
    },
  },
  file: {
    virustotal: {
      url: (value) => `https://www.virustotal.com/gui/file/${value}`,
      hint: 'Antivirus verdicts for this hash',
    },
    malwarebazaar: {
      url: (value) => `https://bazaar.abuse.ch/browse.php?search=hash%3A${value}`,
      hint: 'Known malware samples matching this hash',
    },
    'hybrid-analysis': {
      url: (value) => `https://www.hybrid-analysis.com/search?query=${value}`,
      hint: 'Sandbox reports mentioning this hash',
    },
    'alienvault-otx': {
      url: (value) => `https://otx.alienvault.com/indicator/file/${value}`,
      hint: 'Threat pulses referencing this file',
    },
  },
  email: {
    haveibeenpwned: {
      url: (value) => `https://haveibeenpwned.com/account/${value}`,
      hint: 'Breaches that exposed this address',
    },
    'alienvault-otx': {
      url: (value) => `https://otx.alienvault.com/indicator/email/${enc(value)}`,
      hint: 'Threat pulses mentioning this address',
    },
    'intelligence-x': {
      url: (value) => `https://intelx.io/?s=${enc(value)}`,
      hint: 'Leaks, pastes and dark-web mentions',
    },
  },
  username: {
    'intelligence-x': {
      url: (value) => `https://intelx.io/?s=${enc(value)}`,
      hint: 'Leaks, pastes and identity mentions',
    },
  },
};

/**
 * Builds the "go further" links for an IoC, keeping only tools that exist in
 * the catalog and support the IoC type. Insertion order defines display order.
 *
 * @param {'ip' | 'domain' | 'url' | 'file' | 'email' | 'username'} iocType
 * @param {string} value The IoC as typed by the user (trimmed).
 * @param {import('../types.js').Tool[]} tools The catalog tools.
 * @returns {DeepLink[]}
 */
export function getDeepLinks(iocType, value, tools) {
  const builders = DEEP_LINK_BUILDERS[iocType];
  if (!builders) {
    return [];
  }
  const toolById = new Map(tools.map((tool) => [tool.id, tool]));
  /** @type {DeepLink[]} */
  const links = [];
  for (const [toolId, builder] of Object.entries(builders)) {
    const tool = toolById.get(toolId);
    if (!tool || !tool.iocTypes.includes(iocType)) {
      continue;
    }
    links.push({ toolId, name: tool.name, url: builder.url(value), hint: builder.hint });
  }
  return links;
}
