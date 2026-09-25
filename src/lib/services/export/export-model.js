/**
 * Export model (US V1.5): the single intermediate shape shared by the three
 * formatters (Markdown, JSON, CSV). Building it here — once, from stored
 * investigations or session-only data — keeps every exporter a dumb formatter
 * and puts the content options (AC11) in exactly one place.
 *
 * Pure module — no DOM, no network at all (AC05), no write to the
 * investigation history (AC14) — exercised by `npm run smoke`.
 */

import catalog from '../../../data/tools.json' with { type: 'json' };
import { INVESTIGATION_SOURCES, INVESTIGATION_VERDICTS } from '../investigation-history.js';
import { formatTimestamp } from '../../utils/format-timestamp.js';
import { getDeepLinks } from '../../utils/deep-links.js';
import { sanitizeProviderRawResponse } from '../../utils/provider-response.js';
import { defangIoc } from '../../utils/refang.js';
import { scoreInvestigationAnalysis } from '../../utils/signal-score.js';

/**
 * Local aliases keep the file body readable while letting svelte-check
 * resolve the contracts from their defining modules.
 *
 * @typedef {import('../../types.js').ExportInput} ExportInput
 * @typedef {import('../../types.js').ExportOptions} ExportOptions
 * @typedef {import('../../types.js').InvestigationVerdict} InvestigationVerdict
 * @typedef {import('../../types.js').InvestigationSource} InvestigationSource
 * @typedef {import('../../types.js').InvestigationAnalysisSnapshot} InvestigationAnalysisSnapshot
 * @typedef {import('../../types.js').InvestigationCheckSnapshot} InvestigationCheckSnapshot
 * @typedef {import('../../types.js').Tool} Tool
 * @typedef {import('../../types.js').IocTypeId} IocTypeId
 * @typedef {import('../../utils/deep-links.js').DeepLink} DeepLink
 */

/**
 * Content options of an export (US V1.5): the most useful sections are on by
 * default; raw provider responses stay off by default and are JSON-only.
 *
 * @type {Readonly<{ includeAnalysis: boolean, includeNotes: boolean,
 *   includeTags: boolean, includeLinks: boolean, includeRaw: boolean }>}
 */
export const ExportOptionsDefaults = Object.freeze({
  includeAnalysis: true,
  includeNotes: true,
  includeTags: true,
  includeLinks: true,
  includeRaw: false,
});

/**
 * Options merged with the caller's overrides; flags are always booleans.
 *
 * @typedef {Object} ResolvedExportOptions
 * @property {boolean} includeAnalysis
 * @property {boolean} includeNotes
 * @property {boolean} includeTags
 * @property {boolean} includeLinks
 * @property {boolean} includeRaw
 * @property {Tool[]} [tools] Catalog used to resolve provider names and links.
 * @property {string | Date} [now] Generation date (injectable for tests).
 */

/** Human labels of the check statuses (`No result` ≠ `Error`, AC16). */
const CHECK_STATUS_LABELS = Object.freeze({
  ok: 'OK',
  empty: 'No result',
  error: 'Error',
  cancelled: 'Cancelled',
});

/** Human labels of the recorded provenances (never derived from providers). */
const SOURCE_LABELS = Object.freeze({
  manual: 'Manual entry',
  'extracted-text': 'Extracted from pasted text',
  'email-headers': 'Email headers',
});

/** File extensions per export format. */
const FILE_EXTENSIONS = Object.freeze({ markdown: 'md', json: 'json', csv: 'csv' });

/** What a missing value renders as in Markdown (AC12). */
const NOT_AVAILABLE = 'Not available';

/** IoC type labels, read once from the bundled catalog. */
const IOC_TYPE_LABELS = new Map(
  catalog.iocTypes.map((/** @type {{ id: string, label: string }} */ type) => [type.id, type.label]),
);

/**
 * @typedef {Object} ExportModelMetadata
 * @property {string} generatedAt ISO timestamp of the generation.
 * @property {string} generatedLabel Human label shown in Markdown.
 */

/**
 * @typedef {Object} ExportModelIndicator
 * @property {string} display Headline value — always the defanged one (AC08).
 * @property {string | null} raw Value exactly as originally found, when known.
 * @property {string} normalized Exploitable value used as the identity.
 * @property {string} defanged Neutralized form.
 * @property {string} type IoC type identifier (`ip`, `domain`, …).
 * @property {string} typeLabel Human label of the type from the catalog.
 */

/**
 * @typedef {Object} ExportModelDates
 * @property {string | null} first ISO date of the first analysis, `null` when unknown.
 * @property {string | null} last ISO date of the latest analysis, `null` when unknown.
 * @property {string} firstLabel Displayed first date (`Not available` when unknown, AC12).
 * @property {string} lastLabel Displayed last date (`Not available` when unknown, AC12).
 */

/**
 * @typedef {Object} ExportModelField
 * @property {string} label Field label.
 * @property {string | null} value Field value (`null` when the provider sent nothing).
 */

/**
 * @typedef {Object} ExportModelCheck
 * @property {string} id Stable check identifier.
 * @property {string} label Check label.
 * @property {string | null} provider Catalog tool name backing the check (AC16).
 * @property {string} status Raw status (`ok` | `empty` | `error` | `cancelled`).
 * @property {string} statusLabel Human status (`No result` ≠ `Error`, AC16).
 * @property {number | null} ms Duration in milliseconds.
 * @property {string | null} summary Provider one-liner.
 * @property {string | null} message Provider message (error detail included).
 * @property {ExportModelField[]} fields Key facts returned by the provider.
 * @property {import('../../types.js').ProviderRawResponse | null} [raw] Bounded raw
 *   provider response — present only when the JSON-only `includeRaw` option is on.
 */

/**
 * @typedef {Object} ExportModelAnalysis
 * @property {string | null} checkedAt ISO date of the run, `null` when unknown.
 * @property {ExportModelCheck[]} checks One entry per compatible check.
 */

/**
 * @typedef {Object} ExportModelInvestigation
 * @property {ExportModelIndicator} indicator
 * @property {ExportModelDates} dates
 * @property {{ verdict: InvestigationVerdict, tags?: string[], notes?: string }} analyst
 * @property {ExportModelAnalysis | null} [analysis] Absent when excluded by the
 *   options (AC11), `null` when no analysis is stored (AC12).
 * @property {import('../../utils/signal-score.js').InvestigationSignalScore | null} [signalScore] Derived
 *   heuristic score, never an analyst verdict.
 * @property {{ id: InvestigationSource, label: string } | null} provenance
 *   `null` when the origin is unknown (older entries stay exportable).
 * @property {DeepLink[]} [links] Absent when excluded by the options (AC11).
 */

/**
 * @typedef {Object} ExportModel
 * @property {ExportModelMetadata} metadata
 * @property {ExportModelInvestigation[]} investigations Always an array — the
 *   formatters pick the single- or multi-investigation layout from its length.
 */

/**
 * Builds the export model from one investigation or a selection of them
 * (multi-export: one file, several investigations — AC13).
 *
 * @param {ExportInput[] | ExportInput} inputs Stored entries or session-only data.
 * @param {ExportOptions} [options] Content options (defaults in `ExportOptionsDefaults`).
 * @returns {ExportModel}
 */
export function buildExportModel(inputs, options = {}) {
  /** @type {ResolvedExportOptions} */
  const opts = {
    includeAnalysis: options.includeAnalysis ?? ExportOptionsDefaults.includeAnalysis,
    includeNotes: options.includeNotes ?? ExportOptionsDefaults.includeNotes,
    includeTags: options.includeTags ?? ExportOptionsDefaults.includeTags,
    includeLinks: options.includeLinks ?? ExportOptionsDefaults.includeLinks,
    includeRaw: options.includeRaw ?? ExportOptionsDefaults.includeRaw,
    tools: Array.isArray(options.tools) ? options.tools : undefined,
    now: options.now,
  };
  const generatedAt = toIso(options.now);
  const list = (Array.isArray(inputs) ? inputs : [inputs]).filter(
    (input) => typeof input === 'object' && input !== null,
  );
  return {
    metadata: { generatedAt, generatedLabel: formatTimestamp(generatedAt) },
    investigations: list.map((input) => buildInvestigation(input, opts)),
  };
}

/**
 * Multi-investigation variant of `buildExportModel`: same model shape, several
 * investigations — the formatters switch layout on `investigations.length`.
 *
 * @param {ExportInput[]} inputs Investigations to export together.
 * @param {ExportOptions} [options]
 * @returns {ExportModel}
 */
export function buildMultiExportModel(inputs, options = {}) {
  return buildExportModel(inputs, options);
}

/**
 * @param {ExportInput} input
 * @param {ResolvedExportOptions} opts
 * @returns {ExportModelInvestigation}
 */
function buildInvestigation(input, opts) {
  const typeId = String(input.typeId ?? '');
  const normalized = String(input.normalized ?? '');
  // The defanged form is computed when the caller has none (session-only data).
  const defanged =
    typeof input.defanged === 'string' && input.defanged !== ''
      ? input.defanged
      : defangIoc(normalized, /** @type {IocTypeId} */ (typeId));
  const raw = typeof input.raw === 'string' && input.raw !== '' ? input.raw : null;
  const tools = opts.tools ?? [];
  const first = typeof input.firstAnalyzedAt === 'string' ? input.firstAnalyzedAt : '';
  const last = typeof input.lastAnalyzedAt === 'string' ? input.lastAnalyzedAt : '';
  const source =
    typeof input.source === 'string' && INVESTIGATION_SOURCES.includes(input.source)
      ? input.source
      : null;

  /** @type {ExportModelInvestigation} */
  const investigation = {
    indicator: {
      // AC08: the headline value is the defanged one in every format, so a
      // pasted report can never turn into an active link or a live request.
      display: defanged,
      raw,
      normalized,
      defanged,
      type: typeId,
      typeLabel: typeLabel(typeId),
    },
    dates: {
      first: first !== '' ? first : null,
      last: last !== '' ? last : null,
      firstLabel: first !== '' ? formatTimestamp(first) : NOT_AVAILABLE,
      lastLabel: last !== '' ? formatTimestamp(last) : NOT_AVAILABLE,
    },
    analyst: {
      // Strictly the recorded verdict: providers never feed it (AC07).
      verdict: normalizeVerdict(input.verdict),
      ...(opts.includeTags ? { tags: normalizeTags(input.tags) } : {}),
      ...(opts.includeNotes
        ? { notes: typeof input.notes === 'string' ? input.notes : '' }
        : {}),
    },
    provenance: source !== null ? { id: source, label: SOURCE_LABELS[source] } : null,
  };
  if (opts.includeAnalysis) {
    investigation.analysis = input.latestAnalysis
      ? buildAnalysis(input.latestAnalysis, opts, tools)
      : null;
    investigation.signalScore = scoreInvestigationAnalysis(input.latestAnalysis);
  }
  if (opts.includeLinks) {
    investigation.links =
      normalized !== ''
        ? getDeepLinks(/** @type {IocTypeId} */ (typeId), normalized, tools)
        : [];
  }
  return investigation;
}

/**
 * @param {InvestigationAnalysisSnapshot} snapshot
 * @param {ResolvedExportOptions} opts
 * @param {Tool[]} tools
 * @returns {ExportModelAnalysis}
 */
function buildAnalysis(snapshot, opts, tools) {
  return {
    checkedAt:
      typeof snapshot.checkedAt === 'string' && snapshot.checkedAt !== ''
        ? snapshot.checkedAt
        : null,
    checks: (Array.isArray(snapshot.checks) ? snapshot.checks : []).map((check) =>
      buildCheck(check, opts, tools),
    ),
  };
}

/**
 * @param {InvestigationCheckSnapshot} snapshot
 * @param {ResolvedExportOptions} opts
 * @param {Tool[]} tools
 * @returns {ExportModelCheck}
 */
function buildCheck(snapshot, opts, tools) {
  const tool = snapshot.toolId
    ? tools.find((candidate) => candidate.id === snapshot.toolId)
    : null;
  const status = String(snapshot.status ?? '');
  /** @type {ExportModelCheck} */
  const check = {
    id: String(snapshot.id ?? ''),
    label: String(snapshot.label ?? ''),
    provider: tool ? tool.name : null,
    status,
    statusLabel: CHECK_STATUS_LABELS[snapshot.status] ?? capitalize(status),
    ms: typeof snapshot.ms === 'number' && Number.isFinite(snapshot.ms) ? snapshot.ms : null,
    summary:
      typeof snapshot.summary === 'string' && snapshot.summary !== ''
        ? snapshot.summary
        : null,
    message:
      typeof snapshot.message === 'string' && snapshot.message !== ''
        ? snapshot.message
        : null,
    fields: (Array.isArray(snapshot.fields) ? snapshot.fields : [])
      .filter((field) => typeof field?.label === 'string')
      .map((field) => ({
        label: field.label,
        value: field.value === null || field.value === undefined ? null : String(field.value),
      })),
  };
  if (opts.includeRaw) {
    // JSON-only, explicit opt-in. Sanitizing again protects exports built from
    // session data or an injected repository that bypassed normal boundaries.
    check.raw = sanitizeProviderRawResponse(snapshot.raw);
  }
  return check;
}

/**
 * Local filename for one export (AC15): `investigation-<slug>-<date>.<ext>`
 * for a single investigation, `investigations-<date>.<ext>` for a selection.
 * Only filename-safe characters are kept.
 *
 * @param {{ format: string, generatedAt: string, slug?: string | null,
 *           multi?: boolean }} spec
 * @returns {string}
 */
export function buildExportFilename(spec) {
  const extension = FILE_EXTENSIONS[spec.format] ?? 'txt';
  const stamp = dateStamp(spec.generatedAt);
  const slug = spec.slug ? sanitizeSlug(spec.slug) : null;
  const base = spec.multi || slug === null ? 'investigations' : `investigation-${slug}`;
  return `${base}-${stamp}.${extension}`;
}

/**
 * Filesystem-safe slug of an indicator: lowercased, everything but
 * letters / digits / dots collapsed into dashes, capped in length. Falls back
 * to `ioc` so a filename is never empty.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeSlug(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
    .replace(/[-.]+$/, '');
  return slug !== '' ? slug : 'ioc';
}

/**
 * Machine-friendly key for a field label (`Sample names` → `sample_names`),
 * shared by the JSON object keys and the CSV column names.
 *
 * @param {unknown} label
 * @returns {string}
 */
export function slugLabel(label) {
  const slug = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug !== '' ? slug : 'field';
}

/**
 * Human label of an IoC type, read from the bundled catalog. Unknown
 * identifiers fall back to themselves so a newer type still exports.
 *
 * @param {unknown} typeId
 * @returns {string}
 */
export function typeLabel(typeId) {
  const id = String(typeId ?? '');
  return IOC_TYPE_LABELS.get(id) ?? id;
}

/**
 * First letter uppercased (`unknown` → `Unknown`).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function capitalize(value) {
  const text = String(value ?? '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * `YYYY-MM-DD` stamp of a generation date, `undated` when unreadable.
 *
 * @param {unknown} iso
 * @returns {string}
 */
function dateStamp(iso) {
  const text = String(iso ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : 'undated';
}

/**
 * @param {unknown} now
 * @returns {string} ISO timestamp.
 */
function toIso(now) {
  const date =
    now instanceof Date ? now : new Date(typeof now === 'string' ? now : Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/**
 * @param {unknown} verdict
 * @returns {InvestigationVerdict} The recorded verdict, `unknown` otherwise.
 */
function normalizeVerdict(verdict) {
  return typeof verdict === 'string' &&
    INVESTIGATION_VERDICTS.includes(/** @type {InvestigationVerdict} */ (verdict))
    ? /** @type {InvestigationVerdict} */ (verdict)
    : 'unknown';
}

/**
 * @param {unknown} tags
 * @returns {string[]} Non-empty string tags, in order.
 */
function normalizeTags(tags) {
  return Array.isArray(tags)
    ? tags.filter((tag) => typeof tag === 'string' && tag !== '')
    : [];
}

