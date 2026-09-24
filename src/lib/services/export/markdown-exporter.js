/**
 * Markdown exporter (US V1.5): human-readable format for documentation,
 * tickets, incident reports, Git, wikis. Suspect URLs are defanged by default
 * (AC08) and the IoC itself is never an active link: it always sits between
 * backticks (AC17).
 *
 * Pure module — no DOM, no network — exercised by `npm run smoke`.
 */

import { capitalize } from './export-model.js';

/**
 * @param {object} model Export model (see `buildExportModel`).
 * @returns {string} Markdown document (single investigation or report).
 */
export function markdownExporter(model) {
  const parts = [];
  if (model.investigations.length === 1) {
    return singleReport(model.investigations[0], model.metadata);
  }
  parts.push('# IOC Investigation Report', '', `Generated: ${model.metadata.generatedLabel}`);
  for (const investigation of model.investigations) {
    parts.push('', '---', '', '## ' + escapeHeading(investigation.indicator.display));
    parts.push(...metaLines(investigation));
    parts.push(...sectionBlocks(investigation));
  }
  return parts.filter((line) => line !== null).join('\n') + '\n';
}

/**
 * @param {object} investigation Single investigation of the model.
 * @param {{ generatedLabel: string }} metadata
 * @returns {string}
 */
function singleReport(investigation, metadata) {
  const parts = ['# IOC Investigation', '', `Generated: ${metadata.generatedLabel}`, '', '## Indicator'];
  parts.push(...metaLines(investigation));
  parts.push(...sectionBlocks(investigation));
  return parts.filter((line) => line !== null).join('\n') + '\n';
}

/**
 * Indicator block shared by the single and multi layouts: display value,
 * type, analyst verdict, dates and provenance when known (never a link).
 *
 * @param {object} investigation
 * @returns {string[]}
 */
function metaLines(investigation) {
  const indicator = investigation.indicator;
  const dates = investigation.dates;
  const verdict = capitalize(String(investigation.analyst.verdict ?? 'unknown'));
  const lines = [
    '',
    `**IOC:** \`${indicator.display}\``,
    `**Type:** ${indicator.typeLabel}`,
    `**Verdict:** ${verdict}`,
    '',
    `**First analyzed:** ${dates.firstLabel}`,
    `**Last analyzed:** ${dates.lastLabel}`,
  ];
  if (investigation.provenance?.label) {
    lines.push(`**Source:** ${investigation.provenance.label}`);
  }
  return lines;
}

/**
 * @param {object} investigation
 * @returns {string[]}
 */
function sectionBlocks(investigation) {
  const parts = [];
  const tags = investigation.analyst?.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    parts.push('', '## Tags', '');
    for (const tag of tags) {
      parts.push(`- ${tag}`);
    }
  }
  if (investigation.analysis !== undefined && investigation.analysis !== null) {
    parts.push('', '## Analysis results');
    parts.push(...analysisLines(investigation.analysis));
  } else if (investigation.analysis === null) {
    parts.push('', '## Analysis results', '', 'No analysis stored.');
  }
  if (typeof investigation.analyst?.notes === 'string' && investigation.analyst.notes !== '') {
    parts.push('', '## Analyst notes', '', investigation.analyst.notes);
  }
  const links = investigation.links;
  if (Array.isArray(links) && links.length > 0) {
    parts.push('', '## Investigation links', '');
    for (const link of links) {
      // Names only: the IoC embedded in deep-link URLs must not become an
      // active link by accident (AC17).
      parts.push(`- ${link.name}`);
    }
  }
  return parts;
}

/**
 * One `### <check>` block per provider check: provider attribution first so
 * the origin of the data is always identifiable (AC16), then the key facts.
 * Errors and empty answers are never hidden: `Status: Error` vs `Status: No
 * result` tells "check could not be performed" apart from "no evidence found".
 *
 * @param {object} analysis Analysis section of the model.
 * @returns {string[]}
 */
function analysisLines(analysis) {
  if (!Array.isArray(analysis.checks) || analysis.checks.length === 0) {
    return ['', 'No automated check available.'];
  }
  const parts = [];
  for (const check of analysis.checks) {
    parts.push('', `### ${check.label}`);
    if (check.provider) {
      parts.push('', `Source: ${check.provider}`);
    }
    parts.push('');
    const fields = Array.isArray(check.fields) ? check.fields : [];
    if (check.status === 'ok') {
      if (fields.length > 0) {
        for (const field of fields) {
          parts.push(`- ${field.label}: ${joinMultiline(field.value)}`);
        }
      } else if (check.summary) {
        parts.push(`- ${joinMultiline(check.summary)}`);
      } else {
        parts.push(`- Status: ${check.statusLabel}`);
      }
    } else {
      parts.push(`- Status: ${check.statusLabel}`);
      if (check.message) {
        parts.push(`- Message: ${joinMultiline(check.message)}`);
      } else if (check.summary) {
        parts.push(`- ${joinMultiline(check.summary)}`);
      }
    }
  }
  return parts;
}

/**
 * A field value rendered inside a single list item: multi-line values are
 * joined (`Sample names` use `\n` separators upstream) so the bullet stays
 * readable. Analyst notes are NOT touched (AC06).
 *
 * @param {unknown} value
 * @returns {string}
 */
function joinMultiline(value) {
  return String(value ?? '').replace(/\s*\n\s*/g, ' \u00b7 ');
}

/**
 * @param {string} text
 * @returns {string} Multi-report `## IoC` heading text, de-linked.
 */
function escapeHeading(text) {
  // Keep the heading on one line; the IoC is defanged upstream (AC08) so it
  // can never be an active markdown link (AC17).
  return String(text).replace(/\r?\n/g, ' \u00b7 ');
}
