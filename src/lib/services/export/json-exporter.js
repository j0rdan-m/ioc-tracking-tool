/**
 * JSON exporter (US V1.5): structured format for technical reuse, archiving
 * and tooling. Native types are preserved wherever possible (`boolean`,
 * `number`, `string`, `array`, `object`, `null`) (AC09): flags written `Yes` /
 * `No` by the providers become booleans, plain integers become numbers, and
 * missing technical data stays `null` or absent instead of failing (AC12).
 *
 * Pure module — no DOM, no network — exercised by `npm run smoke`.
 */

import { slugLabel } from './export-model.js';

/**
 * @param {object} model Export model (see `buildExportModel`).
 * @returns {string} JSON document (single investigation or report).
 */
export function jsonExporter(model) {
  const payload =
    model.investigations.length === 1
      ? singleReport(model)
      : report(model);
  return JSON.stringify(payload, null, 2) + '\n';
}

/**
 * Totally flat single-investigation object, as close as possible to the US
 * examples: the display IoC, the type, the analyst verdict, the dates, then
 * the optional sections.
 *
 * @param {object} model
 * @returns {Record<string, unknown>}
 */
function singleReport(model) {
  const investigation = jsonInvestigation(model.investigations[0]);
  return { generatedAt: model.metadata.generatedAt, ...investigation };
}

/**
 * @param {object} model
 * @returns {Record<string, unknown>}
 */
function report(model) {
  return {
    generatedAt: model.metadata.generatedAt,
    investigations: model.investigations.map(jsonInvestigation),
  };
}

/**
 * @param {object} investigation One investigation of the export model.
 * @returns {Record<string, unknown>}
 */
function jsonInvestigation(investigation) {
  const indicator = investigation.indicator;
  const dates = investigation.dates;

  /** @type {Record<string, unknown>} */
  const payload = {
    ioc: indicator.display,
    type: indicator.type,
    raw: indicator.raw,
    normalized: indicator.normalized,
    defanged: indicator.defanged,
    source: investigation.provenance?.id ?? null,
    firstAnalyzedAt: dates.first,
    lastAnalyzedAt: dates.last,
    // The exported verdict is strictly the one recorded on the investigation:
    // providers never feed it (AC07).
    verdict: investigation.analyst.verdict,
  };

  if (investigation.analyst.tags !== undefined) {
    payload.tags = investigation.analyst.tags;
  }
  // Notes are reproduced verbatim (AC06); when the option is off the key is
  // absent from the model and stays absent here (AC11).
  if (investigation.analyst.notes !== undefined) {
    payload.notes = investigation.analyst.notes;
  }
  if (investigation.analysis !== undefined) {
    payload.analysis = investigation.analysis
      ? {
          checkedAt: investigation.analysis.checkedAt,
          checks: investigation.analysis.checks.map(jsonCheck),
        }
      : null;
  }
  if (investigation.links !== undefined && investigation.links !== null) {
    payload.links = investigation.links.map((link) => ({ name: link.name, url: link.url }));
  }
  return payload;
}

/**
 * @param {object} check One check of the export model.
 * @returns {Record<string, unknown>}
 */
function jsonCheck(check) {
  const fields = {};
  for (const field of check.fields ?? []) {
    fields[slugLabel(field.label)] = nativeValue(field.value);
  }
  /** @type {Record<string, unknown>} */
  const payload = {
    id: check.id,
    label: check.label,
    provider: check.provider,
    status: check.status,
    statusLabel: check.statusLabel,
    ms: check.ms,
    summary: check.summary,
    message: check.message,
    fields,
  };
  // Raw provider responses are opt-in (JSON only); `(AC12)` keeps absent data
  // to `null` when the option is on but the payload was never retained.
  if ('raw' in check) {
    payload.raw = check.raw ?? null;
  }
  return payload;
}

/**
 * Native JSON types for provider field values: `Yes`/`No` become booleans
 * (matching the US `hosting: false` example), plain integers become numbers,
 * everything else stays a string (AC09).
 *
 * @param {unknown} value
 * @returns {boolean | number | string | null}
 */
function nativeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return String(value);
  }
  if (value === 'Yes') {
    return true;
  }
  if (value === 'No') {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    const asNumber = Number(value);
    if (Number.isSafeInteger(asNumber)) {
      return asNumber;
    }
  }
  return value;
}
