/**
 * Pure onboarding model: the ordered steps shown on a first visit and the
 * navigation arithmetic driving the spotlight overlay. No DOM, no storage and no
 * Svelte here, so the whole flow is exercised by `npm run smoke`; the component
 * only renders what these functions return.
 *
 * One tour per context — the page toolbar, the Extract IoCs modal and the
 * investigation workspace — so an analyst is guided where they actually work,
 * and each one is remembered independently.
 *
 * A step points at a `data-tour` attribute set on real controls. Targets are
 * unique per tour, so the overlay resolves them without any scoping plumbing.
 * When a target is missing (responsive layout, a step rendered before its
 * section exists), the component falls back to a centered card: the tour must
 * never block the analyst.
 *
 * @typedef {{ id: string, target: string, eyebrow: string, title: string, body: string }} TourStep
 * @typedef {'page' | 'extract' | 'workspace'} TourScope
 */

/**
 * Bumped per tour whenever its step list changes materially, so an analyst who
 * already finished an older version is offered the new one.
 */
export const TOUR_VERSIONS = Object.freeze({
  page: 1,
  extract: 1,
  workspace: 1,
});

/** @type {readonly TourStep[]} */
export const PAGE_TOUR = Object.freeze([
  {
    id: 'search',
    target: 'search',
    eyebrow: 'Step 1 · Find the right tool',
    title: 'Paste an observable, get the matching tools',
    body:
      'Type an IP, domain, URL, hash, e-mail or username: the app detects the IoC type and filters the catalog on it. Plain keywords work too, and the category, IoC-type and Favorites pills narrow the list further. Nothing is ever submitted from your query — the search is local.',
  },
  {
    id: 'fast-analyze',
    target: 'fast-analyze',
    eyebrow: 'Step 2 · Quick first read',
    title: 'Fast analyze queries free public APIs',
    body:
      'One IoC in, one quick read out: geolocation, RDAP registration and TLS certificates from keyless public APIs, called straight from your browser. Results are factual provider messages — you keep the interpretation, the app never declares an indicator safe or malicious.',
  },
  {
    id: 'extract-iocs',
    target: 'extract-iocs',
    eyebrow: 'Step 3 · Bulk triage',
    title: 'Extract IoCs from any pasted text',
    body:
      'Drop a log, a ticket or an e-mail body: the extractor pulls every indicator out of it, defanged or not, and normalizes it. You then run a batch analysis over the selection. The text never leaves the browser.',
  },
  {
    id: 'workspace',
    target: 'workspace',
    eyebrow: 'Step 4 · Investigation workspaces',
    title: 'Group evidence in a workspace',
    body:
      'A workspace is one investigation stored locally in your browser (IndexedDB): nodes for every indicator, typed relationships, a timeline, notes and verdicts. Pivot across providers from a node, then export the whole case as JSON, Markdown or CSV — or import a colleague’s export. No account, no sync, no server.',
  },
  {
    id: 'history',
    target: 'history',
    eyebrow: 'Step 5 · Keep your analyst notes',
    title: 'History holds your verdicts and notes',
    body:
      'Every indicator you analyse is kept locally with your own verdict, tags and notes, kept deliberately apart from the provider output. Use it to re-run an analysis or export your notebook.',
  },
  {
    id: 'email-headers',
    target: 'email-headers',
    eyebrow: 'Step 6 · Phishing mails',
    title: 'Read email headers locally',
    body:
      'Paste raw headers to get the authentication results (SPF, DKIM, DMARC), the mail path and the extracted indicators. Parsing happens in the browser; only an explicit analysis click sends a single indicator to a public API.',
  },
  {
    id: 'favorites',
    target: 'favorites',
    eyebrow: 'Step 7 · Your own shortlist',
    title: 'Star the tools you trust and reuse',
    body:
      'Mark any tool as a favorite to keep it one click away, then filter the catalog down to your shortlist. Favorites live in this browser only. This guide can be replayed any time with the “Guide” button — and clearing your browser data brings it back.',
  },
]);

/** @type {readonly TourStep[]} */
export const EXTRACT_TOUR = Object.freeze([
  {
    id: 'extract-input',
    target: 'extract-input',
    eyebrow: 'Step 1 · Feed the extractor',
    title: 'Paste a log, a ticket or an e-mail body',
    body:
      'Drop any raw text here: the extractor detects IPv4, domains, URLs, e-mails and MD5/SHA-1/SHA-256 hashes — including the deliberately defanged spellings (hxxps://evil[.]example[.]com, user[@]example[.]com) commonly used in reports. The text never leaves your browser.',
  },
  {
    id: 'extract-run',
    target: 'extract-run',
    eyebrow: 'Step 2 · Detect and normalize',
    title: 'One click lists every indicator',
    body:
      'Extract normalizes each value (defanged spellings are refanged) while keeping the exact string you pasted next to it, and collapses duplicates. Detection is deterministic and local: the count under the paste area tells you what was found.',
  },
  {
    id: 'extract-selection',
    target: 'extract-selection',
    eyebrow: 'Step 3 · Choose what to do next',
    title: 'Selection drives the next action',
    body:
      'Every fresh extraction selects all its indicators. Untick what you do not want to investigate, then either run the batch analysis or send the selection straight to an investigation workspace with “Add selected to investigation”.',
  },
  {
    id: 'extract-batch',
    target: 'extract-batch',
    eyebrow: 'Step 4 · Batch analysis',
    title: 'One run, every compatible check',
    body:
      'Analyze selected runs the keyless checks of each selected indicator in one operation, three at a time, filling a consolidated table you can stop at any moment — whatever already settled is kept. Only indicators whose type has a keyless check are analysed; the others go to the deep links.',
  },
  {
    id: 'extract-list',
    target: 'extract-list',
    eyebrow: 'Step 5 · Work on a single indicator',
    title: 'Copy, investigate, or go further',
    body:
      'Each row offers the raw, normalized and defanged forms for your report, a Fast analyze hand-off, and “Investigate” to reveal deep links. Those links stay collapsed until you click them, so no external service is ever opened by accident.',
  },
  {
    id: 'extract-foot',
    target: 'extract-foot',
    eyebrow: 'Step 6 · What leaves your browser',
    title: 'Extraction is local, analysis is explicit',
    body:
      'Extraction never sends anything. Only an explicit analysis click queries the documented keyless public APIs, one indicator at a time. The verdict stays yours: the app shows what providers answer and never decides for you. This guide replays with the “Guide” button.',
  },
]);

/** @type {readonly TourStep[]} */
export const WORKSPACE_TOUR = Object.freeze([
  {
    id: 'workspace-status',
    target: 'workspace-status',
    eyebrow: 'Step 1 · The investigation header',
    title: 'Name it, qualify it, close it',
    body:
      'The status (open / monitoring / closed) is yours to set as the case evolves, and “Edit details” holds the name and description your report will quote. Both are saved locally in your browser, with no account and no sync.',
  },
  {
    id: 'workspace-export',
    target: 'workspace-export',
    eyebrow: 'Step 2 · Get the case out',
    title: 'Export the whole investigation',
    body:
      'Export produces JSON, Markdown or CSV of the full workspace — nodes, relationships, verdicts, notes and timeline. The JSON export can include the bounded provider responses when you explicitly ask for them. A colleague’s export can be imported back from the investigations list.',
  },
  {
    id: 'workspace-tags',
    target: 'workspace-tags',
    eyebrow: 'Step 3 · Label the case',
    title: 'Tags keep several cases apart',
    body:
      'Free-form tags (phishing, campaign-42, ticket-1234…) let you find the same investigation later from the list. They are plain strings, normalized locally, and can be removed one by one.',
  },
  {
    id: 'workspace-tabs',
    target: 'workspace-tabs',
    eyebrow: 'Step 4 · Five views of one case',
    title: 'Overview, Graph, Indicators, Timeline, Notes',
    body:
      'Overview holds the status, the counts and your verdict distribution. Graph is the pivot view. Indicators lists every observable with its verdict. Timeline records the significant actions. Notes keeps your free-form analysis. Everything you edit saves immediately.',
  },
  {
    id: 'workspace-overview',
    target: 'workspace-overview',
    eyebrow: 'Step 5 · Read the signal, keep the verdict',
    title: 'Heuristic signals never decide for you',
    body:
      'The signal score is a local, explainable heuristic computed from the normalized provider fields — it shows its contributions and reports “Not assessed” when nothing reliable is stored. It never overwrites your verdict and is recomputed at export time.',
  },
  {
    id: 'workspace-indicators',
    target: 'workspace-indicators',
    eyebrow: 'Step 6 · Build the graph',
    title: 'Add indicators and link them',
    body:
      'Indicators are deduplicated on type + normalized value, so a defanged and a plain spelling collapse into one node. Relationships are typed and qualified (observed / suspected) with their provenance; open a node in the Graph to pivot across providers from there. This guide replays with the “Guide” button.',
  },
]);

/** Every tour, keyed by the scope that owns it. */
export const TOURS = Object.freeze({
  page: PAGE_TOUR,
  extract: EXTRACT_TOUR,
  workspace: WORKSPACE_TOUR,
});

/**
 * The `data-tour` selectors a tour needs, in order (used by smoke coverage).
 *
 * @param {readonly TourStep[]} steps
 * @returns {readonly string[]}
 */
export function tourTargets(steps) {
  return Object.freeze(steps.map((step) => step.target));
}

/**
 * Keeps an index inside `[0, length - 1]`; an empty step list resolves to 0.
 *
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
export function clampIndex(index, length) {
  const total = Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : 0;
  if (total === 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), total - 1);
}

/**
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
export function nextIndex(index, length) {
  return clampIndex(index + 1, length);
}

/**
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
export function prevIndex(index, length) {
  return clampIndex(index - 1, length);
}

/**
 * @param {number} index
 * @param {number} length
 * @returns {boolean}
 */
export function isFirstStep(index, length) {
  return clampIndex(index, length) === 0;
}

/**
 * @param {number} index
 * @param {number} length
 * @returns {boolean}
 */
export function isLastStep(index, length) {
  const total = Math.max(1, Math.trunc(length));
  return clampIndex(index, total) === total - 1;
}

/**
 * Progress readout for the step counter and the progress bar.
 *
 * @param {number} index
 * @param {number} length
 * @returns {{ current: number, total: number, percent: number }}
 */
export function stepProgress(index, length) {
  const total = Math.max(1, Math.trunc(length));
  const current = clampIndex(index, total) + 1;
  return { current, total, percent: Math.round((current / total) * 100) };
}

/**
 * @param {number} index
 * @param {readonly TourStep[]} steps
 * @returns {TourStep | null}
 */
export function getStep(index, steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return steps[clampIndex(index, steps.length)] ?? null;
}

/**
 * @typedef {{ top: number, left: number, width: number, height: number }} TargetRect
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{ top: number, left: number, width: number, height: number, visible: boolean }} SpotlightBox
 * @typedef {{ top: number, left: number, placement: 'below' | 'above' | 'right' | 'left' | 'center' }} CardBox
 * @typedef {{ spotlight: SpotlightBox, card: CardBox }} TourLayout
 */

/**
 * Zero-sized boxes never count as a valid spotlight.
 *
 * @param {TargetRect | null} rect
 * @returns {rect is TargetRect}
 */
function isUsableRect(rect) {
  return (
    rect !== null &&
    typeof rect === 'object' &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.left) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * Places the tour card next to the highlighted control and keeps it inside the
 * viewport. Pure geometry — the component only measures the DOM and applies
 * what this returns, so the placement rules are covered by `npm run smoke`.
 *
 * The card prefers below the target, then above, then right, then left, and is
 * finally clamped to the viewport. A missing or hidden target (responsive
 * layout, a dialog stacked on top) centers the card so the tour never traps the
 * analyst behind an invisible highlight.
 *
 * @param {TargetRect | null} rect
 * @param {Size} viewport
 * @param {Size} card
 * @param {{ offset?: number, margin?: number }} [options]
 * @returns {TourLayout}
 */
export function computeTourLayout(rect, viewport, card, options = {}) {
  const rawOffset = options?.offset;
  const rawMargin = options?.margin;
  const offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? rawOffset : 12;
  const margin = typeof rawMargin === 'number' && Number.isFinite(rawMargin) ? rawMargin : 16;
  const cardWidth = Number.isFinite(card?.width) ? card.width : 0;
  const cardHeight = Number.isFinite(card?.height) ? card.height : 0;
  const maxLeft = viewport.width - cardWidth - margin;
  const maxTop = viewport.height - cardHeight - margin;

  /** @param {number} value @param {number} max */
  const clamp = (value, max) => Math.min(Math.max(value, margin), Math.max(margin, max));

  if (!isUsableRect(rect) || !viewport.width || !viewport.height) {
    return {
      spotlight: { top: 0, left: 0, width: 0, height: 0, visible: false },
      card: {
        top: clamp((viewport.height - cardHeight) / 2, maxTop),
        left: clamp((viewport.width - cardWidth) / 2, maxLeft),
        placement: 'center',
      },
    };
  }

  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;
  /** @type {CardBox['placement']} */
  let placement = 'below';
  if (bottom + offset + cardHeight + margin <= viewport.height) placement = 'below';
  else if (rect.top - offset - cardHeight - margin >= 0) placement = 'above';
  else if (right + offset + cardWidth + margin <= viewport.width) placement = 'right';
  else if (rect.left - offset - cardWidth - margin >= 0) placement = 'left';

  let top = bottom + offset;
  let left = rect.left;
  if (placement === 'above') {
    top = rect.top - offset - cardHeight;
  } else if (placement === 'right') {
    top = rect.top + rect.height / 2 - cardHeight / 2;
    left = right + offset;
  } else if (placement === 'left') {
    top = rect.top + rect.height / 2 - cardHeight / 2;
    left = rect.left - offset - cardWidth;
  }

  return {
    spotlight: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      visible: true,
    },
    card: { top: clamp(top, maxTop), left: clamp(left, maxLeft), placement },
  };
}
