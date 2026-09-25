/**
 * Pure onboarding model: the ordered steps shown on a first visit and the
 * navigation arithmetic driving the spotlight overlay. No DOM, no storage and no
 * Svelte here, so the whole flow is exercised by `npm run smoke`; the component
 * only renders what these functions return.
 *
 * A step points at a `data-tour` attribute set on real toolbar controls. When a
 * target is missing (responsive layout, a dialog opened on top), the component
 * falls back to a centered card: the tour must never block the analyst.
 *
 * @typedef {{ id: string, target: string, eyebrow: string, title: string, body: string }} TourStep
 */

/**
 * Bumped whenever the step list changes materially, so an analyst who already
 * finished an older tour can be offered the new one.
 */
export const TOUR_VERSION = 1;

/** @type {readonly TourStep[]} */
export const TOUR_STEPS = Object.freeze([
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

/** The `data-tour` selectors a step needs, in order (used by smoke coverage). */
export const TOUR_TARGETS = Object.freeze(TOUR_STEPS.map((step) => step.target));

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
 * @returns {number}
 */
export function prevIndex(index) {
  return clampIndex(index - 1, TOUR_STEPS.length);
}

/** @param {number} index @returns {boolean} */
export function isFirstStep(index) {
  return clampIndex(index, TOUR_STEPS.length) === 0;
}

/**
 * @param {number} index
 * @param {number} [length]
 * @returns {boolean}
 */
export function isLastStep(index, length = TOUR_STEPS.length) {
  const total = Math.max(1, Math.trunc(length));
  return clampIndex(index, total) === total - 1;
}

/**
 * Progress readout for the step counter and the progress bar.
 *
 * @param {number} index
 * @param {number} [length]
 * @returns {{ current: number, total: number, percent: number }}
 */
export function stepProgress(index, length = TOUR_STEPS.length) {
  const total = Math.max(1, Math.trunc(length));
  const current = clampIndex(index, total) + 1;
  return { current, total, percent: Math.round((current / total) * 100) };
}

/**
 * @param {number} index
 * @param {readonly TourStep[]} [steps]
 * @returns {TourStep | null}
 */
export function getStep(index, steps = TOUR_STEPS) {
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
