/**
 * Bounded, serializable provider-response helpers shared by analysis, local
 * persistence and export. Raw bodies are inert text: they are never rendered as
 * HTML, never fetched again and never sent to an application backend.
 *
 * @module utils/provider-response
 */

/** Maximum UTF-8 bytes retained for one provider response. */
export const PROVIDER_RAW_MAX_BYTES = 32 * 1024;

/** Maximum UTF-8 bytes retained across one analysis snapshot. */
export const ANALYSIS_RAW_MAX_BYTES = 64 * 1024;

/** Maximum raw bytes retained across the localStorage-backed history. */
export const HISTORY_RAW_MAX_BYTES = 1024 * 1024;

/**
 * @typedef {Object} ProviderRawResponse
 * @property {string} url Exact provider URL used for the lookup.
 * @property {number} status HTTP status returned by the provider.
 * @property {string | null} contentType Response content type, when exposed by CORS.
 * @property {string} body Raw response text, possibly truncated.
 * @property {number} originalBytes UTF-8 size before truncation.
 * @property {number} storedBytes UTF-8 size of the retained body.
 * @property {boolean} truncated Whether `body` is a bounded prefix.
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Captures a raw response as bounded UTF-8 text. Truncation happens only after
 * the full response has been parsed for normalized display fields.
 *
 * @param {{ url: string, status: number, contentType?: string | null, body: string }} input
 * @returns {ProviderRawResponse}
 */
export function createProviderRawResponse(input) {
  const body = String(input.body ?? '');
  const bytes = new TextEncoder().encode(body);
  const originalBytes = bytes.byteLength;
  const truncated = originalBytes > PROVIDER_RAW_MAX_BYTES;
  const retained = truncated ? decodePrefix(bytes, PROVIDER_RAW_MAX_BYTES) : body;
  return {
    url: String(input.url ?? '').slice(0, 2048),
    status: Number.isFinite(input.status) ? Math.trunc(input.status) : 0,
    contentType:
      typeof input.contentType === 'string' && input.contentType !== ''
        ? input.contentType.slice(0, 256)
        : null,
    body: retained,
    originalBytes,
    storedBytes: new TextEncoder().encode(retained).byteLength,
    truncated,
  };
}

/**
 * @param {Uint8Array} bytes
 * @param {number} maxBytes
 * @returns {string}
 */
function decodePrefix(bytes, maxBytes) {
  let end = Math.min(maxBytes, bytes.byteLength);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(bytes.slice(0, end));
}

/**
 * Sanitizes one stored response. Invalid or oversized shapes become `null`; the
 * body is re-bounded because imported/local records are untrusted boundaries.
 *
 * @param {unknown} value
 * @returns {ProviderRawResponse | null}
 */
export function sanitizeProviderRawResponse(value) {
  if (!isObject(value) || typeof value.body !== 'string' || typeof value.url !== 'string') {
    return null;
  }
  return createProviderRawResponse({
    url: value.url,
    status: typeof value.status === 'number' ? value.status : 0,
    contentType: typeof value.contentType === 'string' ? value.contentType : null,
    body: value.body,
  });
}

/** @param {ProviderRawResponse} raw */
export function providerRawBytes(raw) {
  return raw.storedBytes;
}

/**
 * Sanitizes an analysis snapshot, preserving normalized fields and bounded raw
 * responses while dropping unknown or structurally invalid data.
 *
 * @param {unknown} value
 * @returns {import('../types.js').InvestigationAnalysisSnapshot | null}
 */
export function sanitizeProviderAnalysis(value) {
  if (!isObject(value) || typeof value.checkedAt !== 'string' || !Array.isArray(value.checks)) {
    return null;
  }
  let remaining = ANALYSIS_RAW_MAX_BYTES;
  const checks = [];
  for (const candidate of value.checks.slice(0, 20)) {
    if (!isObject(candidate) || typeof candidate.id !== 'string' || typeof candidate.label !== 'string') {
      continue;
    }
    let raw = sanitizeProviderRawResponse(candidate.raw);
    if (raw && providerRawBytes(raw) <= remaining) {
      remaining -= providerRawBytes(raw);
    } else {
      raw = null;
    }
    const fields = (Array.isArray(candidate.fields) ? candidate.fields : [])
      .filter((field) => isObject(field) && typeof field.label === 'string' && typeof field.value === 'string')
      .slice(0, 100)
      .map((field) => ({
        label: field.label.slice(0, 256),
        value: field.value,
        ...(field.tone === 'good' || field.tone === 'warn' || field.tone === 'bad' ? { tone: field.tone } : {}),
      }));
    checks.push({
      id: candidate.id.slice(0, 128),
      label: candidate.label.slice(0, 512),
      toolId: typeof candidate.toolId === 'string' ? candidate.toolId : null,
      status: ['ok', 'empty', 'error', 'cancelled'].includes(candidate.status) ? candidate.status : 'error',
      ms: typeof candidate.ms === 'number' && Number.isFinite(candidate.ms) ? candidate.ms : null,
      summary: typeof candidate.summary === 'string' ? candidate.summary : null,
      fields,
      message: typeof candidate.message === 'string' ? candidate.message : null,
      raw,
    });
  }
  return { checkedAt: value.checkedAt, checks };
}

/**
 * Enforces a rolling raw-body budget by dropping the oldest response first. The
 * input entries and their snapshots are not mutated.
 *
 * @template {{ latestAnalysis?: import('../types.js').InvestigationAnalysisSnapshot | null,
 *   lastAnalyzedAt?: string }} T
 * @param {T[]} entries
 * @param {number} [maxBytes]
 * @returns {T[]}
 */
export function boundHistoryRawResponses(entries, maxBytes = HISTORY_RAW_MAX_BYTES) {
  /** @type {{ entry: T, index: number, check: number, bytes: number, at: string }[]} */
  const candidates = [];
  const next = entries.map((entry, entryIndex) => {
    const analysis = entry.latestAnalysis;
    if (!analysis?.checks.some((check) => check.raw)) return entry;
    const checks = analysis.checks.map((check, checkIndex) => {
      if (!check.raw) return check;
      const bytes = providerRawBytes(check.raw);
      candidates.push({ entry, index: entryIndex, check: checkIndex, bytes, at: analysis.checkedAt || entry.lastAnalyzedAt || '' });
      return { ...check };
    });
    return { ...entry, latestAnalysis: { ...analysis, checks } };
  });
  let total = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
  candidates.sort((a, b) => a.at.localeCompare(b.at));
  for (const candidate of candidates) {
    if (total <= maxBytes) break;
    const analysis = next[candidate.index].latestAnalysis;
    if (analysis) analysis.checks[candidate.check].raw = null;
    total -= candidate.bytes;
  }
  return next;
}
