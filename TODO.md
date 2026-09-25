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

Hors périmètre V2 : PDF/Word, export PNG/SVG du graphe, backend, comptes, sync
cloud, SIEM/SOAR, STIX/TAXII, MISP, scoring ou attribution automatiques.
