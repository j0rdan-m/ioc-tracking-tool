# IOC Investigation Toolkit

A lightweight Svelte (JavaScript) web app presenting a curated directory of online tools used to
pivot on **Indicators of Compromise (IOCs)** during cybersecurity forensic investigations.

The catalog lives in a single JSON file — [`src/data/tools.json`](src/data/tools.json) — where each
entry explains what the tool does, lists the IoC types it handles, and links to it. The Svelte
frontend renders the catalog with free-text search, category filters and IoC-type filters
(IP, domain & DNS, URL, file & hash, email, username). Pasting an observable (IP, hash, domain, email or
URL) auto-detects its IoC type, pre-applies the matching filter and searches by type instead of
by keyword (`src/lib/utils/detect-ioc-type.js`). Tools can be starred as favorites — the selection
is stored in the browser (localStorage) and a dedicated pill shows only them.

## Fast analyze

The **⚡ Fast analyze** button opens a modal for a quick first read on a single indicator: paste an
IoC (IP, domain, URL, hash or email), press **Start**, and the app queries free, unauthenticated
public APIs straight from the browser — no account, no API key, nothing sent to a backend:

| Check | Source | IoC types |
| --- | --- | --- |
| IP intelligence (geo, ASN, hosting, risk flags) | [ipapi.is](https://ipapi.is/) (catalog tool; [ipwho.is](https://ipwho.is/) fallback) | IP |
| Registration & registrar (RDAP) | [rdap.org](https://rdap.org/) | Domain, IP, URL host, email domain |
| TLS certificates (CT logs) | [crt.sh](https://crt.sh/) (catalog tool) | Domain, URL host |

Every check reports its own status (ok / empty / error), so one failing provider never blocks the
others. Tools that cannot be called from the browser — VirusTotal, abuse.ch (both now require an
API key) or urlscan.io (no CORS headers) — are offered as **"go further" links** that open the tool
with the IoC already entered (e.g. `abuseipdb.com/check/<ip>`, `crt.sh/?q=<domain>`). File hashes
and usernames have no keyless API at all, so they go straight to those deep links. A query already
typed in the main search box is automatically pre-filled into the modal when it opens.

Implementation: `src/lib/services/fast-analyze.js` (providers + response normalization),
`src/lib/utils/deep-links.js` (pure deep-link builders) and
`src/lib/components/FastAnalyzeModal.svelte` (UI), wired through `DI_TOKENS.fastAnalyzer` in the
DI container.

## Getting started

```bash
npm install
npm run dev       # start the dev server (http://localhost:5173)
npm run check     # static analysis (svelte-check + JSDoc types)
npm run smoke     # catalog + core smoke test
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

## Catalog content

| Tool | Category | Purpose |
| --- | --- | --- |
| [HostIP](https://www.hostip.fr/) | Geolocation | Geolocate an IP (country, city, ISP) |
| [AbuseIPDB](https://www.abuseipdb.com/) | Reputation | Check abuse reports on an IP |
| [Scamalytics](https://scamalytics.com/) | Reputation | IP fraud score (AbuseIPDB alternative) |
| [Cyberbro (demo)](https://demo.cyberbro.net/) | Multi-engine | Check an observable against many engines at once |
| [suip.biz](https://suip.biz/) | Multi-engine | Online recon toolbox (ports, whois, DNS…) |
| [ipapi.is](https://ipapi.is/) | Enrichment | IP intelligence: ASN, hosting/VPN detection |
| [IPinfo](https://ipinfo.io/) | Enrichment | IP data: ASN, company, carrier, privacy detection |
| [UnshortLink](https://unshortlink.com/fr) | URL analysis | Expand a shortened link to reveal its real destination |
| [URL Unshortener](https://unshorten.me/) | URL analysis | Expand shortened links without clicking them |
| [URLVoid](https://www.urlvoid.com/) | Reputation | Domain/URL reputation against dozens of blocklists |
| [Sucuri SiteCheck](https://sitecheck.sucuri.net/) | Reputation | Website malware and blacklist scan |
| [Control D Link Checker](https://controld.com/tools/website-link-checker) | Reputation | Check whether a link is safe to open |
| [IsItPhishing](https://www.isitphishing.ai/) | Reputation | AI verdict on phishing URLs |
| [crt.sh](https://crt.sh) | DNS & domain recon | Subdomains via TLS certificates (CT logs) |
| [DNSDumpster](https://dnsdumpster.com) | DNS & domain recon | Complete DNS cartography |
| [DNSlytics](https://dnslytics.com) | DNS & domain recon | DNS history & reverse IP |
| [MXToolbox](https://mxtoolbox.com) | DNS & domain recon | Email, SPF/DMARC, blacklists |
| [ViewDNS.info](https://viewdns.info) | DNS & domain recon | WHOIS, IP history, port scan |
| [CyberChef](https://gchq.github.io/CyberChef/) | Decoding & transformation | Decode/encode, deobfuscate JS, extract strings |
| [VirusTotal](https://www.virustotal.com/) | File & hash analysis | File/URL/IP reputation across dozens of AV engines |
| [MalwareBazaar](https://bazaar.abuse.ch/) | File & hash analysis | Malware sample database searchable by hash/signature |
| [Hybrid Analysis](https://www.hybrid-analysis.com/) | File & hash analysis | Free sandbox with behavioral analysis reports |
| [ANY.RUN](https://any.run/) | File & hash analysis | Interactive real-time malware sandbox |
| [urlscan.io](https://urlscan.io/) | URL analysis | Safe URL scan: screenshot, DOM, network, IoCs |
| [PhishTank](https://www.phishtank.com/) | URL analysis | Collaborative phishing URL database |
| [AlienVault OTX](https://otx.alienvault.com/) | Threat intelligence | Large IoC-sharing community (threat pulses) |
| [ThreatFox](https://threatfox.abuse.ch/) | Threat intelligence | Malware IoCs: C2 servers, distribution URLs |
| [Intelligence X](https://intelx.io/) | Threat intelligence | Search leaks, pastes, dark web, WHOIS/DNS history |
| [Microsoft Message Header Analyzer](https://mha.azurewebsites.net/) | Email header analysis | Make raw email headers readable (SPF/DKIM/DMARC) |
| [Google Admin Toolbox Messageheader](https://toolbox.googleapps.com/apps/messageheader/) | Email header analysis | Alternative email path & authentication visualizer |
| [Hurricane Electric BGP Toolkit](https://bgp.he.net/) | Network & BGP | BGP routes, announced prefixes, ASN history |
| [Web Check](https://web-check.xyz/) | URL analysis | All-in-one website analyzer: DNS, SSL, headers, tech stack |
| [Breach Directory](https://breachdirectory.org/) | Threat intelligence | Breach search by email, username, phone or password |
| [Have I Been Pwned](https://haveibeenpwned.com/) | Threat intelligence | Reference breach database (emails, domains, passwords) |
| [UserSearch](https://usersearch.com/) | Threat intelligence | Username lookup across social networks & forums |

## Project structure

```
src/
  data/tools.json             # ← edit this file to add/remove tools
  lib/
    bootstrap.js              # composition root: builds the DI container
    di/                       # tiny DI container + Svelte context bridge
      container.js            #   lazy-singleton container (no external library)
      provide.js              #   provideContainer() / inject() on Svelte context
      tokens.js               #   injection tokens (Symbols)
    services/                 # framework-agnostic services
      static-tool-data-source.js  # serves the bundled JSON catalog
      http-tool-data-source.js    # fetches the catalog over HTTP (fetch injected)
      tool-repository.js          # read-side repository over the catalog
      clipboard.js                # copy-to-clipboard with legacy fallback
      favorites.js                # starred tools persisted in localStorage
    utils/                    # pure helpers (filtering, counting, colors)
    components/               # Svelte UI components
  App.svelte                  # page layout & state
  main.js                     # entry point: builds the container, mounts the app
```

## Adding a tool

Append an entry to `src/data/tools.json`:

```json
{
  "id": "example-tool",
  "name": "Example Tool",
  "url": "https://example.com/",
  "categoryId": "url-analysis",
  "iocTypes": ["url", "domain"],
  "description": "One or two sentences explaining what the tool does and when to use it.",
  "tags": ["url", "example"]
}
```

If the category does not exist yet, add it to `categories`; it automatically gets its own filter
pill and accent color (derived from the category id, see `src/lib/utils/color.js`).

`iocTypes` powers the second filter row: list every IoC type the tool can handle among `ip`,
`domain`, `url`, `file`, `email` and `username` (defined at the top of the catalog). If a type is
missing, add it to the `iocTypes` definitions — it automatically gets its own filter pill.

## Deployment (GitHub Pages)

The site is published on every push to `main` by the workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): install → smoke test → build → deploy.

One-time repository setting: **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
The Vite `base` in [`vite.config.js`](vite.config.js) must match the Pages subpath
(`/ioc-tracking-tool/`); switch it to `/` when using a custom domain.

## Architecture notes (dependency injection)

External dependencies are never hard-imported deep inside components:

- The **catalog data** is injected: `main.js` calls the composition root
  (`bootstrap.js`) which registers a `StaticToolDataSource` (bundled JSON). To serve the catalog
  from an API instead, swap one registration:

  ```js
  // src/lib/bootstrap.js
  import { HttpToolDataSource } from './services/http-tool-data-source.js';

  container.register(DI_TOKENS.toolCatalogSource, () => new HttpToolDataSource('/api/tools.json'));
  ```

- **`fetch`** is injected into `HttpToolDataSource` (constructor option), so it can be stubbed in
  tests.
- The **fast-analyze providers** use the `fetch` injected into `FastAnalyzerService` (constructor
  option), so the live lookups can be stubbed in tests.
- The **browser clipboard** is injected into `ClipboardService` (constructor defaults), with a
  legacy fallback for non-secure contexts.
- The **favorites storage** is injected into `FavoritesService` (browser `localStorage` by default,
  in-memory fallback), so persistence can be stubbed in tests.
- Components receive dependencies through Svelte context (`provideContainer` / `inject`) instead of
  importing singletons, which keeps them decoupled and easy to test.

## Tool health checks

Every deploy runs `npm run health`, which pings each tool URL from CI and writes a snapshot to
`src/data/health.json`, bundled into the app (the workflow also runs every 6 hours to keep the
indicators fresh). Each card shows a status dot — green = the site responded, red = network error,
timeout or HTTP 5xx — with the HTTP status, latency and check date on hover. Any HTTP response
counts as "up": a bot-protected site answering 403 is still online.

## Disclaimer

All links point to third-party public services. Never submit confidential data, and only use them
on indicators you are authorized to investigate.
