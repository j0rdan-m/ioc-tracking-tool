# IOC Investigation Toolkit

A lightweight Svelte (JavaScript) web app presenting a curated directory of online tools used to
pivot on **Indicators of Compromise (IOCs)** during cybersecurity forensic investigations.

The catalog lives in a single JSON file — [`src/data/tools.json`](src/data/tools.json) — where each
entry explains what the tool does and links to it. The Svelte frontend renders the catalog with
free-text search and category filters.

## Getting started

```bash
npm install
npm run dev       # start the dev server (http://localhost:5173)
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
| [URL Unshortener](https://unshorten.me/) | Decoding & transformation | Expand shortened links without clicking them |
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
  "description": "One or two sentences explaining what the tool does and when to use it.",
  "tags": ["url", "example"]
}
```

If the category does not exist yet, add it to `categories`; it automatically gets its own filter
pill and accent color (derived from the category id, see `src/lib/utils/color.js`).

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
- The **browser clipboard** is injected into `ClipboardService` (constructor defaults), with a
  legacy fallback for non-secure contexts.
- Components receive dependencies through Svelte context (`provideContainer` / `inject`) instead of
  importing singletons, which keeps them decoupled and easy to test.

## Disclaimer

All links point to third-party public services. Never submit confidential data, and only use them
on indicators you are authorized to investigate.
