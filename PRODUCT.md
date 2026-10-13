# Product — IOC Investigation Toolkit

**Tagline**: A curated directory of IOC investigation tools rendered as a website by a Svelte frontend, for cybersecurity analysts.

## Product Vision
Provide a browser-based, keyless platform for cybersecurity analysts to investigate indicators of compromise (IoCs) using free unauthenticated APIs, with local history tracking, analysis, and export capabilities. The tool runs entirely client-side with no backend, no API keys, and no external networking.

## Core Features

### Fast Analyze
- Paste an IoC (IP, domain, URL, hash, email) for free browser-based lookups
- Provider checks via RDAP, crt.sh, ipapi.is and other keyless sources
- "Go further" list opens catalog tools with the IoC pre-entered
- Signal scoring with explainable contributions (V2.1)

### Investigation History
- Persistent local storage of analyzed indicators (IndexedDB with localStorage fallback)
- Deduplication on `typeId:normalized` — refanged/defanged spellings collapse into one entry
- Analyst verdict (benign/suspicious/malicious), tags, and notes per indicator
- First-seen and last-analyzed timestamps preserved across re-analyses

### Investigation Workspace (V2)
- Tabbed interface: Overview, Graph, Indicators, Timeline, Notes
- Native SVG graph with interactive features:
  - Node/edge creation and deletion
  - Typed relationships with provenance
  - Filtering by type, verdict, source
  - Neighborhood search and zoom/pan
  - Persistent layout positions
- Signal summary per node
- Export/import workspace (JSON, V1.5 format)

### Provider Evidence & Scoring
- Bounded raw response capture (32 KiB/response, 64 KiB/analysis, 1 MiB rolling history)
- UTF-8-safe truncation with localStorage sanitization
- Local deterministic scoring from normalized fields
- Low/Medium/High bands and explicit `unavailable` state — no automatic verdict attribution

### Export Formats
- **Markdown**: Pure function formatter, defanged IOCs, no HTML injection
- **JSON**: Preserves native types, bounded provider payloads only when requested
- **CSV**: RFC 4180 escaping, safe cell output

### Onboarding Tours
- Spotlight tour highlighting real toolbar controls
- Per-scope persistence (one localStorage record per scope)
- Replayable with "Guide" button
- Keyboard navigation with centered fallback

## Technical Stack
- **Framework**: Svelte 5 + Vite
- **Styling**: CSS custom properties with theme variables (light/dark)
- **Storage**: IndexedDB + localStorage with sanitization adapters
- **Build**: Vite, svelte-check for type checking
- **Deployment**: GitHub Pages

## Security Model
- **Browser-only**: No backend, no API keys, no file uploads to third parties
- **Sanitize on read**: Every storage adapter sanitizes payloads before caching
- **Defanged by default**: All rendered values use defanged forms (e.g., `hxxp://[.]evil[.]example[.]com`)
- **Pure function formatters**: Export markdown/json/csv are DOM-free, no `eval()`, no `dangerouslySetInnerHTML`
- **Input validation at every boundary**: Provider responses, analysis snapshots, investigation data
- **No external networking**: No `fetch()`, no external API calls outside documented keyless public APIs

## Threat Model
- Client-side XSS prevention via sanitization
- Data injection via stored investigations guarded by sanitization
- Unsafe DOM operations prevented by pure function formatters
- Unsafe export formatting prevented by RFC 4180 compliance and text-based output

## Known Limitations
- PDF/Word export not supported
- PNG/SVG graph export not supported
- Backend, sync cloud, SIEM/SOAR, STIX/TAXII, MISP not supported
- Automatic threat attribution from provider data not supported — analyst verdicts always explicit

## Version History
- **V1.3**: Basic IoC extraction, investigation history, export markdown/json/csv
- **V2.0**: Investigation workspace UI, graph interactions, onboarding tours
- **V2.1**: Bounded provider evidence, explicit raw export, versioned signal engine
- **V2.2**: Interactive onboarding, reusable overlay, contextual tours
- **V2.3**: Per-scope persistence, migration of V2.2 flat records

## Next Review
Security review template available at `security-review.md`. Follow the checklist for each new version to maintain the same security baseline.