/**
 * Safe local import boundary for V2 workspace JSON files. The browser only
 * parses a user-selected file; no upload, request or backend is involved.
 *
 * @module workspace/import
 */

import { sanitizeInvestigation } from './investigation-model.js';

const MAX_IMPORT_BYTES = 5_000_000;

/**
 * Parses and sanitizes a workspace JSON document. The generated export shape
 * (`{ generatedAt, investigation }`) and a bare investigation object are both
 * accepted. Invalid, oversized or structurally unusable files are rejected.
 *
 * @param {string} text JSON text read from a local file.
 * @returns {{ investigation: import('../../types.js').WorkspaceInvestigation, generatedAt: string | null }}
 */
export function parseWorkspaceImport(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new TypeError('Workspace import: the selected file is empty.');
  }
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new RangeError('Workspace import: the JSON file is larger than 5 MB.');
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`Workspace import: invalid JSON (${error instanceof Error ? error.message : 'parse error'}).`);
  }
  const candidate = payload && typeof payload === 'object' && !Array.isArray(payload) && 'investigation' in payload
    ? payload.investigation
    : payload;
  const investigation = sanitizeInvestigation(candidate);
  if (!investigation) {
    throw new TypeError('Workspace import: the JSON does not contain a valid investigation.');
  }
  return {
    investigation,
    generatedAt:
      payload && typeof payload === 'object' && typeof payload.generatedAt === 'string'
        ? payload.generatedAt
        : null,
  };
}
