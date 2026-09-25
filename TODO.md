# TODO

## US V2 — Investigation Workspace & Pivot Graph

- [x] **Lot 1 — socle V2** : modèle `Investigation` (nœuds, relations typées,
  preuves, timeline), déduplication sur `typeId:normalized`, repository **IndexedDB**
  injectable avec repli mémoire, câblage DI (`investigationWorkspace`), smoke tests
  (AC01–AC03, AC05–AC06, AC10–AC12, AC15–AC19) + README.
- [x] **Lot 2 — Workspace UI** : liste/recherche d'investigations, vue workspace à
  onglets (Overview, Graph, Indicators, Timeline, Notes), graphe SVG natif
  interactif (filtres type/verdict/source, recherche, focus voisinage, zoom,
  positions persistantes), création manuelle de nœuds/relations, verdicts/notes
  (AC04, AC09, AC13–AC14, UI des AC10–AC12/AC17) + smoke tests et README.
- [x] **Lot 3 — Pivot & traçabilité** : `PivotService` borné sur les providers
  existants, sélection avant ajout (anti-explosion), relations déterministes
  URL/e-mail, migration V1.3 (« Add to investigation »), export V1.5 d'un
  workspace, import JSON (AC07–AC08, AC20–AC22).
- [x] **Lot 4 — Validation** : couverture smoke de l'intake, des pivots et de
  l'export/import Workspace, `npm run smoke` + `check` + `theme` + `build`,
  README à jour.
- [x] **Lot 5 — safe investigation lifecycle** : deep-copy duplication with a new
  ID and open status, permanent deletion guarded by the exact investigation name,
  and collision-safe JSON import that preserves both records. Smoke coverage and
  README updated.

## V2.1 — Provider evidence & explainable scoring

- [x] **Lot 1 — bounded provider evidence**: keyless Fast Analyze responses now retain
  inert raw text (32 KiB per response, 64 KiB per analysis, 1 MiB rolling history budget),
  with UTF-8-safe truncation and localStorage sanitization.
- [x] **Lot 2 — explicit raw export**: JSON exports include bounded provider payloads only when
  requested; Markdown and CSV never receive them.
- [x] **Lot 3 — versioned signal engine**: local deterministic scoring from normalized fields,
  explainable contributions, Low/Medium/High bands and an explicit `unavailable` state; no
  automatic verdict or attribution.
- [x] **Lot 4 — UI integration**: Fast Analyze, batch, History, Workspace overview and node
  details expose the score and expandable raw responses; score and raw are included in exports
  with regression coverage.

## V2.2 — Interactive onboarding

- [x] **Lot 1 — spotlight tour**: first-visit guided tour highlighting the real toolbar controls
  (search, Fast analyze, Extract IoCs, Workspace, History, Email headers, Favorites), replayable
  with the "Guide" button; keyboard navigation and a centered fallback when a target cannot be
  measured.
- [x] **Lot 2 — pure model & persistence**: `utils/onboarding-tour.js` (steps, navigation, card
  placement geometry) + `services/onboarding.js` (versioned localStorage flag) wired through
  `DI_TOKENS.onboarding`, smoke coverage including the `data-tour` target check, README updated.

## V2.3 — Contextual onboarding tours

- [x] **Lot 1 — reusable overlay**: `OnboardingTour.svelte` now takes a `steps` list and a `scope`
  (per-scope DOM ids), so one component drives every tour; the page tour is unchanged for the user.
- [x] **Lot 2 — Extract IoCs tour**: 6 steps (paste, Extract, selection bar & *Add to
  investigation*, batch analysis, IoC list, what leaves the browser), auto-opened on the first
  opening of the modal, with a Guide button in the dialog header; Escape is owned by the tour while
  it is open.
- [x] **Lot 3 — Workspace tour**: 6 steps (status & details, Export, tags, the five tabs, signal
  summary, indicators & relationships), auto-opened on the first workspace entered, with a Guide
  button in the investigation header.
- [x] **Lot 4 — per-scope persistence**: one localStorage record per scope, independent flags,
  scoped `reset()`, and migration of the V2.2 flat record to the `page` scope. Smoke coverage over
  the three step lists, target uniqueness/existence, navigation, placement and persistence.

## V2 scope boundaries

Hors périmètre V2/V2.1 : PDF/Word, export PNG/SVG du graphe, backend, comptes, sync
cloud, SIEM/SOAR, STIX/TAXII, MISP, attribution automatique. Le scoring heuristique local
et les réponses brutes bornées sont implémentés sans backend.
