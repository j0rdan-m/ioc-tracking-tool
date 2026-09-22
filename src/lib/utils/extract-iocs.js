/**
 * Extraction of indicators of compromise from free-form text (logs, tickets,
 * e-mail bodies). Runs entirely in the browser — no network call, no service.
 *
 * Pipeline: refang (keeping a source map) → candidate matches per shape →
 * edge-punctuation trimming → validation through `detectIocType()` (the same
 * authority used by the search box and Fast analyze) → priority masking so a
 * URL swallows the domain inside it → normalization → deduplication on
 * `type:normalized` → ordered by first appearance.
 *
 * Pure module — no DOM, no network — exercised by `npm run smoke`.
 */
import { detectIocType } from './detect-ioc-type.js';
import { defangIoc, normalizeIoc, refang, stripEdgePunctuation } from './refang.js';

/** Guards against pathological pastes (multi-megabyte logs). */
const MAX_INPUT_LENGTH = 200_000;
/** Upper bound of rendered indicators, so the DOM stays responsive. */
const MAX_RESULTS = 200;

/** Candidate shapes, tried by ascending priority (URL wins over its domain). */
const PRIORITY_ORDER = /** @type {const} */ (['url', 'email', 'ip', 'file', 'domain']);

/**
 * Hash lengths, longest first so a SHA-256 is not eaten by shorter patterns.
 * @type {{ length: number, kind: 'MD5' | 'SHA-1' | 'SHA-256' }[]}
 */
const HASH_KINDS = [
  { length: 64, kind: 'SHA-256' },
  { length: 40, kind: 'SHA-1' },
  { length: 32, kind: 'MD5' },
];

/**
 * @typedef {Object} ExtractIocsResult
 * @property {import('../types.js').ExtractedIoc[]} iocs Deduplicated indicators, in order of appearance.
 * @property {string | null} warning Non-fatal notice (input truncated, result list capped).
 */

/**
 * Extracts, normalizes and deduplicates the IoCs contained in a free text.
 *
 * @param {string} text Raw user text.
 * @returns {ExtractIocsResult}
 */
export function extractIocs(text) {
  if (text.length > MAX_INPUT_LENGTH) {
    return {
      iocs: [],
      warning: `Input is too large: only the first ${MAX_INPUT_LENGTH.toLocaleString('en-US')} characters were analyzed.`,
    };
  }
  const { value: refanged, srcStart, srcEnd } = refang(text);

  /**
   * One candidate match in refanged coordinates.
   *
   * @typedef {Object} Candidate
   * @property {'ip' | 'domain' | 'url' | 'file' | 'email'} typeId
   * @property {number} start Start offset in the refanged text.
   * @property {number} end   End offset (exclusive) in the refanged text.
   * @property {string} normalizedRefanged Trimmed refanged value.
   * @property {'MD5' | 'SHA-1' | 'SHA-256' | null} hashKind
   */

  /** @type {Candidate[]} */
  const candidates = [];

  /**
   * Collects matches of one regex whose detected type matches the expectation.
   *
   * @param {RegExp} regex
   * @param {'ip' | 'domain' | 'url' | 'file' | 'email'} expectedType
   * @param {'MD5' | 'SHA-1' | 'SHA-256' | null} hashKind
   */
  const collect = (regex, expectedType, hashKind) => {
    regex.lastIndex = 0;
    for (const match of refanged.matchAll(regex)) {
      const start = match.index ?? 0;
      const trimmed = stripEdgePunctuation(match[0]);
      const lead = match[0].length - match[0].trimStart().length;
      const candidateStart = start + lead;
      const candidateEnd = candidateStart + trimmed.length;
      if (trimmed === '') {
        continue;
      }
      if (detectIocType(trimmed) !== expectedType) {
        continue; // e.g. 999.999.1.1 fails octet validation
      }
      candidates.push({ typeId: expectedType, start: candidateStart, end: candidateEnd, normalizedRefanged: trimmed, hashKind });
    }
  };

  collect(/https?:\/\/[^\s<>"'`]+/gi, 'url', null);
  collect(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi, 'email', null);
  collect(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, 'ip', null);
  for (const { length, kind } of HASH_KINDS) {
    collect(new RegExp(`\\b[a-f0-9]{${length}}\\b`, 'gi'), 'file', kind);
  }
  collect(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi, 'domain', null);

  // Priority masking: a candidate overlapping an already-kept one
  // (higher priority, or earlier position within the same priority) is
  // dropped — the domain inside a URL or an e-mail is not reported twice.
  candidates.sort(
    (a, b) =>
      PRIORITY_ORDER.indexOf(a.typeId) - PRIORITY_ORDER.indexOf(b.typeId) || a.start - b.start,
  );
  /** @type {Candidate[]} */
  const kept = [];
  for (const candidate of candidates) {
    if (kept.some((acc) => candidate.start < acc.end && acc.start < candidate.end)) {
      continue;
    }
    kept.push(candidate);
  }

  // Deduplication on `type:normalized`, first occurrence wins (its raw form
  // and position are the ones displayed), then order by appearance.
  /** @type {Map<string, import('../types.js').ExtractedIoc>} */
  const byKey = new Map();
  for (const candidate of kept) {
    const raw = text.slice(srcStart[candidate.start], srcEnd[candidate.end - 1]);
    const normalized = normalizeIoc(raw, candidate.typeId);
    const key = `${candidate.typeId}:${normalized}`;
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, {
      id: key,
      typeId: candidate.typeId,
      raw,
      normalized,
      defanged: defangIoc(normalized, candidate.typeId),
      hashKind: candidate.hashKind,
      index: srcStart[candidate.start],
    });
  }

  /** @type {import('../types.js').ExtractedIoc[]} */
  const iocs = [...byKey.values()].sort((a, b) => a.index - b.index);
  let warning = null;
  if (iocs.length > MAX_RESULTS) {
    warning = `Result list truncated to the first ${MAX_RESULTS} indicators.`;
    iocs.length = MAX_RESULTS;
  }
  return { iocs, warning };
}
