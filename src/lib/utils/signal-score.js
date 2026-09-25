/**
 * Versioned, explainable signal scoring for provider analysis snapshots.
 *
 * This is a local heuristic index, not a threat probability and not an analyst
 * verdict. Only explicitly normalized fields are considered; missing flags never
 * become negative evidence. The analyst qualification remains authoritative.
 *
 * @module utils/signal-score
 */

export const SIGNAL_SCORE_VERSION = 1;

export const SIGNAL_LEVEL_LABELS = Object.freeze({
  unavailable: 'Not assessed',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
});

/** @type {Readonly<Record<string, number>>} */
const FIELD_POINTS = Object.freeze({
  'Reported for abuse': 50,
  'Tor exit node': 30,
  'Proxy exit node': 20,
  'VPN exit node': 15,
  'Datacenter / hosting range': 10,
  'Crawler / bot': 5,
  'Bogon / reserved range': 5,
});

/**
 * @typedef {Object} SignalContribution
 * @property {string} id Stable rule identifier.
 * @property {string} label Human-readable observed signal.
 * @property {number} points Points contributed before the final 100-point cap.
 * @property {string} checkId Provider check that exposed the signal.
 * @property {string} field Normalized field used as evidence.
 */

/**
 * @typedef {Object} InvestigationSignalScore
 * @property {1} version Current scoring algorithm.
 * @property {number | null} score Capped index, or `null` when not assessed.
 * @property {'unavailable' | 'low' | 'medium' | 'high'} level Signal band.
 * @property {string} label Human-readable level.
 * @property {SignalContribution[]} contributions Explainable positive rules.
 * @property {number} successfulChecks Number of successful provider checks.
 * @property {number} totalChecks Number of provider checks in the snapshot.
 * @property {boolean} assessed Whether at least one reliable rule was observed.
 */

/**
 * Scores one analysis snapshot from normalized, provider-derived fields only.
 *
 * @param {import('../types.js').InvestigationAnalysisSnapshot | null | undefined} snapshot
 * @returns {InvestigationSignalScore}
 */
export function scoreInvestigationAnalysis(snapshot) {
  const checks = Array.isArray(snapshot?.checks) ? snapshot.checks : [];
  const successfulChecks = checks.filter((check) => check.status === 'ok').length;
  /** @type {Map<string, SignalContribution>} */
  const contributions = new Map();

  for (const check of checks) {
    if (check.status !== 'ok' || !Array.isArray(check.fields)) continue;
    for (const field of check.fields) {
      const points = FIELD_POINTS[field.label];
      const value = String(field.value).trim().toLowerCase();
      if (!Number.isFinite(points) || !['yes', 'true', '1'].includes(value)) continue;
      const id = `field:${field.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      if (!contributions.has(id)) {
        contributions.set(id, {
          id,
          label: field.label,
          points,
          checkId: check.id,
          field: field.label,
        });
      }
    }

    const created = check.fields.find((field) => field.label === 'Created')?.value;
    const age = domainAgeDays(created, snapshot?.checkedAt);
    if (age !== null && !contributions.has('domain-age')) {
      const points = age <= 30 ? 35 : age <= 90 ? 25 : age <= 365 ? 10 : 0;
      contributions.set('domain-age', {
        id: 'domain-age',
        label: age <= 30 ? 'Domain registered within 30 days' : age <= 90 ? 'Domain registered within 90 days' : age <= 365 ? 'Domain registered within one year' : 'Domain older than one year',
        points,
        checkId: check.id,
        field: `Created=${String(created)} (${age} days)`,
      });
    }
  }

  const list = [...contributions.values()].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  const assessed = list.length > 0;
  const rawScore = list.reduce((total, contribution) => total + contribution.points, 0);
  const score = assessed ? Math.min(100, rawScore) : null;
  const level = score === null ? 'unavailable' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return {
    version: SIGNAL_SCORE_VERSION,
    score,
    level,
    label: SIGNAL_LEVEL_LABELS[level],
    contributions: list,
    successfulChecks,
    totalChecks: checks.length,
    assessed,
  };
}

/**
 * @param {unknown} created
 * @param {unknown} checkedAt
 * @returns {number | null}
 */
function domainAgeDays(created, checkedAt) {
  if (typeof created !== 'string' || typeof checkedAt !== 'string') return null;
  const createdAt = Date.parse(created);
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(checked) || checked < createdAt) return null;
  return Math.floor((checked - createdAt) / 86_400_000);
}

/**
 * Summarizes node scores without inventing an investigation-wide verdict. The
 * overview uses the highest observed node score and explicit assessed coverage.
 *
 * @param {import('../types.js').WorkspaceInvestigation} investigation
 * @returns {{ assessed: number, unavailable: number, highest: { nodeId: string, defanged: string, score: InvestigationSignalScore } | null, levels: Record<'unavailable' | 'low' | 'medium' | 'high', number> }}
 */
export function summarizeInvestigationSignals(investigation) {
  const levels = { unavailable: 0, low: 0, medium: 0, high: 0 };
  /** @type {{ nodeId: string, defanged: string, score: InvestigationSignalScore } | null} */
  let highest = null;
  for (const node of Array.isArray(investigation?.nodes) ? investigation.nodes : []) {
    const score = scoreInvestigationAnalysis(node.analysis);
    levels[score.level] += 1;
    if (score.score !== null && (highest === null || score.score > (highest?.score.score ?? -1))) {
      highest = { nodeId: node.id, defanged: node.defanged, score };
    }
  }
  return {
    assessed: levels.low + levels.medium + levels.high,
    unavailable: levels.unavailable,
    highest,
    levels,
  };
}
