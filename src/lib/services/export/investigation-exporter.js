/**
 * Single entry point of the export pipeline (US V1.5): investigation data
 * flows into the shared export model, then into one formatter, then into a
 * local file (`Blob` → download). No network request is ever issued (AC05),
 * and nothing touches `lastAnalyzedAt`.
 *
 * Pure function — only the download service below talks to the DOM — exercised
 * by `npm run smoke`.
 */

import { buildExportFilename, buildExportModel, sanitizeSlug } from './export-model.js';
import { markdownExporter } from './markdown-exporter.js';
import { jsonExporter } from './json-exporter.js';
import { csvExporter } from './csv-exporter.js';

/**
 * @typedef {'markdown' | 'json' | 'csv'} ExportFormat
 */

/**
 * Mime types for the generated files (all safe `Blob`s, never HTML).
 */
export const EXPORT_MIME_TYPES = Object.freeze({
  markdown: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
});

/**
 * Content of one export, ready to download or copy.
 *
 * @param {import('../../types.js').ExportInput[]} inputs Stored entries or session-only data.
 * @param {ExportFormat} format `markdown`, `json` or `csv`.
 * @param {import('../../types.js').ExportOptions} [options]
 * @returns {{ content: string, filename: string, mimeType: string, format: ExportFormat }}
 */
export function exportInvestigation(inputs, format, options = {}) {
  if (!EXPORT_MIME_TYPES[format]) {
    throw new Error(`Export: unknown format "${format}".`);
  }
  const model = buildExportModel(inputs, options);
  const multi = inputs.length > 1;
  const content =
    format === 'markdown' ? markdownExporter(model) : format === 'json' ? jsonExporter(model) : csvExporter(model);
  const slug = inputs.length === 1 ? sanitizeSlug(inputs[0]?.normalized ?? 'ioc') : null;
  const filename = buildExportFilename({
    format,
    generatedAt: model.metadata.generatedAt,
    slug,
    multi,
  });
  return { content, filename, mimeType: EXPORT_MIME_TYPES[format], format };
}
