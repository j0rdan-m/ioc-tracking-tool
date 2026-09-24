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
and usernames have no keyless API at all, so they go straight to those deep links. An IoC already
typed in the main search box is automatically pre-filled into the modal when it opens; plain
keyword searches are ignored.

Implementation: `src/lib/services/fast-analyze.js` (providers + response normalization),
`src/lib/utils/deep-links.js` (pure deep-link builders) and
`src/lib/components/FastAnalyzeModal.svelte` (UI), wired through `DI_TOKENS.fastAnalyzer` in the
DI container.

## Extract IoCs

The **🔍 Extract IoCs** button opens a modal that pulls every indicator out of a pasted text (log,
ticket, e-mail body). The analysis runs entirely in the browser — the text is never sent anywhere:

- **Detection**: IPv4, domain, URL, e-mail and MD5/SHA-1/SHA-256 hashes, whether written plainly or
  deliberately defanged (`hxxps://evil[.]example[.]com`, `user[@]example[.]com`);
- **Normalization (refang)**: `[.]`, `(.)`, `[dot]`, `(dot)` → `.`, `[@]`, `[at]`, `(at)` → `@` and
  `hxxp`/`hxxps` → `http`/`https`. The value exactly as found in the text is kept next to the
  normalized one;
- **Defang**: one click copies the neutralized form (`176[.]128[.]43[.]70`,
  `hxxps://evil[.]example[.]com/login`, `user[@]example[.]com`; hashes have nothing to neutralize);
- **Actions per indicator**: copy raw / normalized / defanged, hand the normalized value over to
  **⚡ Fast analyze** (IP, domain, URL, e-mail — hashes and usernames have no keyless API), or reveal
  "go further" deep links opened with the indicator already entered;
- **Deduplication** on `type:normalized`, so `example.com` and `example[.]com` collapse into one
  domain indicator while `https://example.com` stays a distinct URL;
- **Safety**: detected values are rendered as inert text — nothing opens without an explicit click,
  and the host of a URL or of an e-mail address is never reported as a second indicator.

Implementation: `src/lib/utils/refang.js` (refang with a source-offset map, defang, normalization)
and `src/lib/utils/extract-iocs.js` (detection, priority masking and deduplication), two pure
modules exercised by `npm run smoke`; `src/lib/components/IocExtractorModal.svelte` renders the UI.

## Batch analysis

Selecting indicators in the **🔍 Extract IoCs** modal (all of them are selected by default, or use
*Select all* / *Deselect all*) and pressing **⚡ Analyze selected** runs the compatible keyless checks
for every selected IoC in one go — no need to open Fast analyze once per indicator:

- **Normalized input**: the refanged, canonical value is what providers receive, so
  `hxxps://evil[.]example[.]com/login` is analysed as `https://evil.example.com/login`;
- **Per-type checks**: IP → IP intelligence + RDAP; domain → RDAP + crt.sh; URL → RDAP + crt.sh on
  its **hostname** (the URL itself stays the indicator); e-mail → RDAP on its domain; hashes and
  usernames have no keyless provider, so they show **No automated check available** and only offer
  deep links;
- **Bounded parallelism**: at most 3 IoCs at a time (each IoC runs its own checks in parallel), so a
  large paste never floods the public providers;
- **Progressive results**: a consolidated table (IoC, type, ASN / Network, RDAP, TLS, global status)
  fills in as answers arrive, with a `N / M checks completed` gauge, and every row expands into the
  raw provider answers (fields, duration, provider message) plus its "go further" links;
- **Isolated failures**: a provider error, a rate limit, a timeout or an empty answer only affects
  its own check — the other IoCs keep running. Nothing is turned into a `Safe` / `Malicious` verdict:
  the provider message is displayed verbatim and the interpretation stays with the analyst;
- **Global status per IoC**: `Complete`, `Partial`, `Error`, `No automated check available` (or
  `Cancelled` / `Running` while the batch is live);
- **Stop analysis**: no further request is launched, results already obtained are kept and the
  indicators the queue never reached flip to `Cancelled`; closing the modal also stops the batch.

Implementation: `src/lib/utils/batch-analyze.js` (queue, bounded concurrency, status derivation —
pure and framework-agnostic, exercised by `npm run smoke`) driven from
`src/lib/components/IocExtractorModal.svelte`.

## Analyze email headers

The **📧 Email headers** button opens a modal that turns a block of raw e-mail headers into a
readable story — again entirely offline: the paste is parsed in the browser and never uploaded.

- **Input**: paste the raw headers (as exported by your mail client) and press *Analyze headers*.
  Folded headers (RFC 5322 §3.2.3 continuation lines) are unfolded first;
- **Summary tab**: `From`, `Reply-To`, `Return-Path`, the `Message-ID` domain, the SPF, DKIM
  (with its selector) and DMARC results read from `Authentication-Results`, the number of
  `Received` hops, the earliest public IP, the transit start time and duration, plus factual
  **signals** — including an explicit domain-mismatch warning when `From`, `Reply-To` and
  `Return-Path` do not share a domain. Signals are descriptive only: no `Safe` / `Malicious` verdict
  is ever derived;
- **Mail path tab**: every `Received` hop, ordered earliest → final receiving server (numbered
  backwards, so hop 1 is where the message started), with the announced host, the IPv4 literal and
  the date; private / loopback / link-local addresses are flagged;
- **IoC extraction tab**: the IPs, domains and e-mail addresses found in the headers are
  deduplicated and defanged for display, with *Copy* (normalized) and *Defang* actions per
  indicator. Selecting them and pressing **⚡ Analyze selected** runs the same keyless batch as the
  Extract IoCs modal (3 IoCs at a time, progressive table, stoppable, recorded in the local
  history), while **⚡ Fast analyze** on a single indicator hands it over to the Fast analyze modal.
  Private / local IPs are listed separately as non-investigable;
- **Raw headers tab**: the paste exactly as it was entered, for copy/paste back into another tool;
- **Close ≠ clear**: closing the modal stops a running batch but keeps the pasted headers, so they
  are still there next time; only *Clear headers* (with a confirmation) discards them.

Implementation: `src/lib/utils/email-header-parser.js` (unfolding + ordered field lookup) and
`src/lib/utils/email-header-analyzer.js` (auth results, mail path, identity signals — pure modules
exercised by `npm run smoke`), rendered by `src/lib/components/EmailHeadersModal.svelte` and wired
in `App.svelte` through the `onAnalyze` hand-off, exactly like the other modals.

## Exports

Every view where an investigation is visible can export it as a local file — **Markdown** for
tickets, wikis and incident reports, **JSON** for tooling and archiving, **CSV** for spreadsheets
and IoC comparisons. Nothing is uploaded: the file is built in the browser as a `Blob` and saved
through an invisible anchor, and the export never touches the network or the stored history.

- **Entry points**: the *Export* button in a History detail, the *Export selected* button with the
  per-row checkboxes in History (several investigations → one file), *⬇ Export* at the end of a
  Fast analyze run, and *⬇ Export results* on a finished batch in Extract IoCs (session-only data
  is exported without writing to the history);
- **Content options**: analysis results, analyst notes, tags and external investigation links are
  exported by default and can be turned off per export — excluded sections are absent from the
  file, not empty. *Raw provider responses* (JSON only) is off by default and currently yields
  `null`, since the app does not retain the raw payloads;
- **Safety**: the headline IoC is always the defanged form (`176[.]128[.]43[.]70`,
  `hxxps://evil[.]example[.]com/...`) and sits between backticks in Markdown; the links section
  lists tool names only, never an active URL. The verdict, tags and notes are exported exactly as
  recorded — providers never feed them — and the provenance (`manual`, `extracted-text`,
  `email-headers`) is shown when known;
- **Missing data** never breaks an export: `null` in JSON, empty cells in CSV, *Not available* in
  Markdown; entries saved before provenance existed export fine without it;
- **Formats**: Markdown follows the report layout (one `## IoC` block per investigation for a
  selection); JSON keeps native types (`Yes` → `true`, `"87"` → `87`); CSV is one line per IoC —
  base columns, one `<check>_status` column per provider, then one column per field, RFC 4180
  quoted, tags joined with `;`;
- **Filenames**: `investigation-<slug>-<YYYY-MM-DD>.md|json|csv` for one investigation,
  `investigations-<YYYY-MM-DD>.<ext>` for a selection.

Implementation: `src/lib/services/export/` (shared model `export-model.js` + the three pure
formatters), `src/lib/services/export/investigation-exporter.js` (single entry point),
`src/lib/services/download.js` (Blob → file, registered as `DI_TOKENS.download`) and
`src/lib/components/ExportPanel.svelte` (shared panel: options, preview, copy, download) —
exercised end to end by `npm run smoke`.

## Getting started

```bash
npm install
npm run dev       # start the dev server (http://localhost:5173)
npm run check     # static analysis (svelte-check + JSDoc types)
npm run smoke     # catalog + core smoke test
npm run theme     # theme guard: no hard-coded colour/radius/font-size in components
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

## Investigation workspace (V2)

The V2 workspace groups several indicators into a single *investigation* — nodes,
typed relationships (with provenance and evidence), analyst verdicts, notes, tags
and a local timeline — instead of isolated single-IoC entries.

- **Lot 1 — data layer (implemented)**: the pure model
  (`src/lib/services/workspace/investigation-model.js`) deduplicates nodes on
  `typeId:normalized` (defanged/plain spellings collapse into one node), keeps
  verdicts analyst-only, merges repeated observations of a relationship into one
  edge carrying several evidence entries, and records significant actions on a
  timeline. `InvestigationRepository` persists investigations in **IndexedDB**
  (in-memory fallback) and is registered in the DI container as
  `DI_TOKENS.investigationWorkspace`. Everything stays local — no network, no
  backend — and removing a node never touches the V1.3 history;
- **Lot 2 — workspace UI (implemented)**: `WorkspaceModal` provides a searchable list and creation
  form; `InvestigationWorkspace` provides Overview, Graph, Indicators, Timeline and Notes tabs.
  The native SVG graph supports type, verdict and relationship-provenance filters, search highlighting,
  neighborhood focus, zoom and persistent drag positions. Analysts can add nodes and typed
  relationships, set verdicts and edit verbatim notes; the existing `ExportPanel` can export the
  workspace's available indicator data locally in Markdown, JSON or CSV. The workspace remains
  IndexedDB-backed with an in-memory fallback and is opened from the toolbar's **🕸 Workspace** action;
- **Next lots**: bounded pivots with selection before any graph expansion, V1.3 history migration,
  V1.5 workspace-specific export metadata and JSON import.

`npm run smoke` exercises creation, deduplication, provenance, evidence merging,
analyst-only verdicts, verbatim notes, timeline, repository persistence and the
storage sanitizer.

## Project structure

```
src/
  data/tools.json             # ← edit this file to add/remove tools
  styles/
    theme.css                 # ← edit this file to restyle the whole app (tokens only)
    base.css                  # reset, document defaults, page backdrop
    components.css            # shared dialog chrome (.modal, .modal__head, …)
  app.css                     # stylesheet entry point (@imports the three files above)
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
      download.js                 # Blob → local file download (US V1.5, no network)
      export/                     # US V1.5 export pipeline: model + Markdown/JSON/CSV formatters
      investigation-history.js     # V1.3 per-IoC history (localStorage)
      workspace/                   # US V2 investigation workspace (lot 1: data layer)
        investigation-model.js         # pure model: nodes, relationships, evidence, timeline
        investigation-repository.js    # IndexedDB persistence (memory fallback), DI-injected
    utils/                    # pure helpers (refang/defang, IoC extraction, batch analysis, filtering, colors)
    components/               # Svelte UI components
  App.svelte                  # page layout & state
  main.js                     # entry point: builds the container, mounts the app
```

## Theming and styles

All the look and feel lives in **`src/styles/theme.css`**: one `:root` block of CSS custom
properties. No component hard-codes a colour, a radius, a font size, a shadow or a spacing value —
they all consume these tokens, so changing a value there restyles every place it is used, with no
component to touch and no build step (it is plain CSS, not SCSS). The tokens are also overridable
at runtime (DevTools, a `@media (prefers-color-scheme: light)` block, a user setting), which is what
makes a future light theme a purely additive change.

The file is organised in seven sets:

| Set | Examples | What it controls |
| --- | --- | --- |
| 1. Palette | `--palette-navy-950`, `--palette-sky-400` | Raw colours, meaningless on their own |
| 2. Semantic colours | `--color-bg`, `--color-text`, `--color-accent`, `--color-border` | Which role each colour plays; the translucent soft/veil variants are derived with `color-mix()` |
| 3. Typography | `--font-body`, `--font-mono`, `--font-size-*`, `--line-height-*`, `--letter-spacing-*` | Fonts and the type ladder |
| 4. Shape | `--radius-xs` … `--radius-card`, `--radius-lg`, `--radius-pill`, `--radius-circle` | One edit re-shapes every card, dialog, input and chip |
| 5. Elevation | `--shadow-card`, `--shadow-focus`, `--shadow-glow-*` | Depth, focus rings and glows |
| 6. Layout | `--space-1` … `--space-10`, `--app-max-width`, `--modal-width-*`, `--z-*` | Spacing ladder, page width, dialog widths, stacking |
| 7. Motion | `--duration-*`, `--ease-*`, `--transition-colors/lift/field/width/tap` | Durations and the composed transitions |

Typical edits:

```css
/* A warmer accent: chips, focus rings and glows follow automatically. */
--color-accent: var(--palette-amber-400);

/* Squarer UI: pills become 8px rounded rectangles. */
--radius-pill: var(--radius-sm);

/* Denser typography. */
--font-size-base: 0.9rem;
--font-size-sm: 0.8rem;
```

`--category-hue` is set per tool card (`ToolCard.svelte`) and used with the
`--category-saturation*` / `--category-lightness*` tokens, so the category colour coding is a token
scale too. The two other stylesheets — `base.css` (reset and document defaults) and
`components.css` (the dialog chrome shared by the four modals) — are structural: they exist so the
shared shell is declared once instead of being copy-pasted into every modal.

The contract is enforced by **`npm run theme`** (`scripts/check-theme.mjs`): every `var(--token)`
used under `src/` must be declared in `theme.css`, and components must not hard-code a colour,
radius, font size or shadow. A stray `#38bdf8` or `border-radius: 10px` in a component fails the
check with the offending file and line. Run it alongside `npm run check` / `npm run smoke`.

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
