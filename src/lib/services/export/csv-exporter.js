/**
 * CSV exporter (US V1.5): flat table for Excel, LibreOffice, third-party
 * imports and IoC comparisons. One IoC per line; columns are the base fields
 * first, then one provider status per check, then the flattened field values
 * (as in the US examples: `...,asn,organization,country,notes`).
 *
 * Fields containing `,`, `"`, or a line break are quoted per the CSV rules
 * (AC10). Missing data yields empty cells, never an error (AC12).
 *
 * Pure module — no DOM, no network — exercised by `npm run smoke`.
 */

import { slugLabel } from './export-model.js';

/**
 * @param {object} model Export model (see `buildExportModel`).
 * @returns {string} CSV document, `\n`-terminated.
 */
export function csvExporter(model) {
  const columns = baseColumns(model) ?? ['ioc', 'type'];
  const rows = model.investigations.map((investigation) =>
    columns.map((column) => escapeCell(readCell(investigation, column))),
  );
  return [columns.join(','), ...rows.map((cells) => cells.join(','))].join('\n') + '\n';
}

/**
 * Totally flat column plan shared by every row: base fields, then one
 * `<check>_status` column per observed check, then one column per flattened
 * field label in order of first appearance.
 *
 * @param {object} model
 * @returns {string[] | null} `null` when there is nothing to export.
 */
function baseColumns(model) {
  const hasNotes = model.investigations.some((inv) => inv.analyst?.notes !== undefined);
  const base = ['ioc', 'type', 'raw', 'normalized', 'defanged', 'first_analyzed', 'last_analyzed', 'verdict', 'source', 'tags'];
  const statuses = collectStatuses(model);
  const fields = collectFields(model);
  const columns = [...base, ...statuses];
  if (fields.length > 0) {
    columns.push(...fields);
  }
  if (hasNotes) {
    columns.push('notes');
  }
  return columns;
}

/**
 * One `<check>_status` column per distinct check seen (`rdap_status`), in
 * order of first appearance. Errors and empty answers stay visible there.
 *
 * @param {object} model
 * @returns {string[]}
 */
function collectStatuses(model) {
  const seen = new Set();
  const columns = [];
  for (const investigation of model.investigations) {
    const analysis = investigation.analysis;
    if (!analysis || !Array.isArray(analysis.checks)) {
      continue;
    }
    for (const check of analysis.checks) {
      const column = `${slugLabel(check.id)}_status`;
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    }
  }
  return columns;
}

/**
 * One column per distinct field label (`asn`, `organization`, `country`…), in
 * order of first appearance, so multi-IoC exports compare cleanly.
 *
 * @param {object} model
 * @returns {string[]}
 */
function collectFields(model) {
  const seen = new Set();
  const columns = [];
  for (const investigation of model.investigations) {
    const analysis = investigation.analysis;
    if (!analysis || !Array.isArray(analysis.checks)) {
      continue;
    }
    for (const check of analysis.checks) {
      for (const field of check.fields ?? []) {
        const column = slugLabel(field.label);
        if (!seen.has(column)) {
          seen.add(column);
          columns.push(column);
        }
      }
    }
  }
  return columns;
}

/**
 * @param {object} investigation
 * @param {string} column
 * @returns {string} Raw cell content before escaping.
 */
function readCell(investigation, column) {
  const indicator = investigation.indicator ?? {};
  const dates = investigation.dates ?? {};
  const analyst = investigation.analyst ?? {};
  switch (column) {
    case 'ioc':
      return indicator.display ?? '';
    case 'type':
      return indicator.type ?? '';
    case 'raw':
      return indicator.raw ?? '';
    case 'normalized':
      return indicator.normalized ?? '';
    case 'defanged':
      return indicator.defanged ?? '';
    case 'first_analyzed':
      return dates.first ?? '';
    case 'last_analyzed':
      return dates.last ?? '';
    case 'verdict':
      return analyst.verdict ?? '';
    case 'source':
      return investigation.provenance?.id ?? '';
    case 'tags':
      // Tags join on `;` (US example: `phishing;customer-incident`).
      return Array.isArray(analyst.tags) ? analyst.tags.join(';') : '';
    case 'notes':
      return typeof analyst.notes === 'string' ? analyst.notes : '';
    default:
      break;
  }
  if (column.endsWith('_status')) {
    const id = column.slice(0, -'_status'.length);
    const checks = investigation.analysis?.checks ?? [];
    const check = checks.find((candidate) => slugLabel(candidate.id) === id);
    return check ? String(check.status ?? '') : '';
  }
  const values = [];
  const checks = investigation.analysis?.checks ?? [];
  for (const check of checks) {
    for (const field of check.fields ?? []) {
      if (slugLabel(field.label) === column && field.value !== null && field.value !== undefined) {
        values.push(String(field.value));
      }
    }
  }
  return values.join(' | ');
}

/**
 * RFC 4180 escaping: a field containing `,`, `"`, `\n` or `\r` is wrapped in
 * double quotes and inner quotes are doubled (AC10).
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeCell(value) {
  const text = value ?? '';
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
