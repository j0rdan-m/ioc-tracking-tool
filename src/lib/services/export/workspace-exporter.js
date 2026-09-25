/**
 * Local formatters for a complete V2 investigation export. They reuse the
 * existing V1.5 content options but add the graph, evidence and timeline that
 * make a workspace export round-trippable. No provider or network call is made.
 *
 * @module export/workspace-exporter
 */

import { sanitizeSlug } from './export-model.js';
import { formatTimestamp } from '../../utils/format-timestamp.js';
import { escapeCell } from './csv-exporter.js';
import { sanitizeProviderRawResponse } from '../../utils/provider-response.js';

/** @typedef {import('../../types.js').WorkspaceInvestigation} WorkspaceInvestigation */

export const WORKSPACE_EXPORT_MIME_TYPES = Object.freeze({
  markdown: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
});

/**
 * @param {WorkspaceInvestigation} investigation
 * @param {'markdown' | 'json' | 'csv'} format
 * @param {{ now?: string, includeAnalysis?: boolean, includeNotes?: boolean,
 *           includeTags?: boolean, includeRelationships?: boolean,
 *           includeTimeline?: boolean, includeRaw?: boolean }} [options]
 * @returns {{ content: string, filename: string, mimeType: string, format: string }}
 */
export function exportWorkspaceInvestigation(investigation, format, options = {}) {
  if (!WORKSPACE_EXPORT_MIME_TYPES[format]) throw new Error(`Workspace export: unknown format "${format}".`);
  if (!investigation || typeof investigation !== 'object') {
    throw new TypeError('Workspace export: an investigation is required.');
  }
  const generatedAt = typeof options.now === 'string' && options.now !== '' ? options.now : new Date().toISOString();
  const model = projectInvestigation(investigation, options);
  const content = format === 'json'
    ? jsonDocument(model, generatedAt)
    : format === 'csv'
      ? csvDocument(model, generatedAt, options)
      : markdownDocument(model, generatedAt, options);
  return {
    content,
    filename: `investigation-workspace-${sanitizeSlug(investigation.name)}-${generatedAt.slice(0, 10)}.${format}`,
    mimeType: WORKSPACE_EXPORT_MIME_TYPES[format],
    format,
  };
}

function jsonDocument(investigation, generatedAt) {
  return JSON.stringify({ generatedAt, investigation }, null, 2) + '\n';
}

/**
 * Applies content choices to a shallow serializable copy. The original
 * investigation is never changed by export generation.
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {object} options
 * @returns {WorkspaceInvestigation}
 */
function projectInvestigation(investigation, options) {
  return {
    ...investigation,
    tags: options.includeTags === false ? [] : [...investigation.tags],
    notes: options.includeNotes === false ? '' : investigation.notes,
    relationships: options.includeRelationships === false ? [] : [...investigation.relationships],
    timeline: options.includeTimeline === false ? [] : [...investigation.timeline],
    nodes: investigation.nodes.map((node) => ({
      ...node,
      tags: options.includeTags === false ? [] : [...node.tags],
      notes: options.includeNotes === false ? '' : node.notes,
      analysis: options.includeAnalysis === false
        ? null
        : projectAnalysis(node.analysis, options.includeRaw === true),
    })),
  };
}

/**
 * @param {WorkspaceInvestigation['nodes'][number]['analysis']} analysis
 * @param {boolean} includeRaw
 * @returns {WorkspaceInvestigation['nodes'][number]['analysis']}
 */
function projectAnalysis(analysis, includeRaw) {
  if (!analysis) return null;
  return {
    ...analysis,
    checks: analysis.checks.map((check) => {
      if (includeRaw) {
        return {
          ...check,
          fields: check.fields.map((field) => ({ ...field })),
          raw: sanitizeProviderRawResponse(check.raw),
        };
      }
      const { raw: _raw, ...withoutRaw } = check;
      return {
        ...withoutRaw,
        fields: check.fields.map((field) => ({ ...field })),
      };
    }),
  };
}

function markdownDocument(investigation, generatedAt, options) {
  const includeAnalysis = options.includeAnalysis !== false;
  const includeNotes = options.includeNotes !== false;
  const includeTags = options.includeTags !== false;
  const includeRelationships = options.includeRelationships !== false;
  const includeTimeline = options.includeTimeline !== false;
  const lines = [
    '# IOC Investigation Workspace',
    '',
    `Generated: ${formatTimestamp(generatedAt)}`,
    '',
    `**Name:** ${investigation.name}`,
    `**Status:** ${investigation.status}`,
    `**Description:** ${investigation.description || 'Not available'}`,
    `**Indicators:** ${investigation.nodes.length}`,
    `**Relationships:** ${investigation.relationships.length}`,
  ];
  if (includeTags && investigation.tags.length > 0) lines.push(`**Tags:** ${investigation.tags.join(', ')}`);
  if (includeNotes && investigation.notes) lines.push('', '## Investigation notes', '', investigation.notes);
  lines.push('', '## Indicators', '');
  for (const node of investigation.nodes) {
    lines.push(`### \`${node.defanged}\``, '', `- Type: ${node.typeId}`, `- Analyst verdict: ${node.verdict}`, `- Source: ${node.source}`);
    if (includeAnalysis && node.analysis) {
      lines.push(`- Analysis: ${node.analysis.checks.map((check) => `${check.label} (${check.status})`).join(', ') || 'No result'}`);
    }
    if (includeNotes && node.notes) lines.push('', '#### Analyst notes', '', node.notes);
  }
  if (includeRelationships) {
    lines.push('', '## Relationships', '');
    for (const relationship of investigation.relationships) {
      const source = investigation.nodes.find((node) => node.id === relationship.sourceId);
      const target = investigation.nodes.find((node) => node.id === relationship.targetId);
      lines.push(`- ${source?.defanged ?? relationship.sourceId} → ${target?.defanged ?? relationship.targetId} (${relationship.type}; ${relationship.confidence}; ${relationship.sourceLabel ?? relationship.sourceType})`);
    }
  }
  if (includeTimeline) {
    lines.push('', '## Timeline', '');
    for (const event of investigation.timeline) lines.push(`- ${formatTimestamp(event.at)} — ${event.label}`);
  }
  return lines.join('\n') + '\n';
}

function csvDocument(investigation, generatedAt, options) {
  const includeNotes = options.includeNotes !== false;
  const columns = ['ioc', 'type', 'verdict', 'source', 'seed', 'depth', 'tags', 'analysis_status', 'notes'];
  const rows = investigation.nodes.map((node) => [
    node.defanged,
    node.typeId,
    node.verdict,
    node.source,
    String(node.seed),
    String(node.depth),
    node.tags.join(';'),
    node.analysis ? node.analysis.checks.map((check) => `${check.id}:${check.status}`).join('|') : '',
    includeNotes ? node.notes : '',
  ]);
  return [columns.join(','), ...rows.map((row) => row.map((value) => escapeCell(String(value))).join(','))].join('\n') + '\n';
}
