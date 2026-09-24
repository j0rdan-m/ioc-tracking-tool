/**
 * Workspace intake helpers: move extracted indicators or V1.3 history entries
 * into a local investigation without touching the global history store.
 *
 * This module is pure (no DOM, storage or network) and deliberately does not
 * derive verdicts. Analyst fields are copied only when they are already present
 * on the input record; provider answers are copied as snapshots, never turned
 * into a qualification.
 *
 * @module workspace/intake
 */

import { detectIocType } from '../../utils/detect-ioc-type.js';
import {
  addNode,
  addRelationship,
  nodeIdOf,
  setNodeAnalysis,
  setNodeNotes,
  setNodeTags,
  setNodeVerdict,
  recordTimelineEvent,
} from './investigation-model.js';

/** @typedef {import('../../types.js').WorkspaceInvestigation} WorkspaceInvestigation */
/** @typedef {import('../../types.js').WorkspaceIndicatorInput} WorkspaceIndicatorInput */
/** @typedef {import('../../types.js').InvestigationSource} InvestigationSource */

/**
 * Adds one or more indicators to an investigation. New indicators are seeds by
 * default. Existing normalized values are deduplicated and never overwrite the
 * analyst's existing data.
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {WorkspaceIndicatorInput | WorkspaceIndicatorInput[]} inputs
 * @param {{ source?: InvestigationSource, seed?: boolean, now?: string }} [options]
 * @returns {WorkspaceInvestigation}
 */
export function addIndicatorsToInvestigation(investigation, inputs, options = {}) {
  const list = Array.isArray(inputs) ? inputs : [inputs];
  const source = options.source ?? 'manual';
  const now = options.now ?? new Date().toISOString();
  const seed = options.seed !== false;
  let next = investigation;

  for (const input of list) {
    if (!input || typeof input.normalized !== 'string' || input.normalized.trim() === '') {
      throw new TypeError('Workspace intake: an indicator needs a non-empty normalized value.');
    }
    const typeId = input.typeId ?? detectIocType(input.normalized);
    if (typeId === null || typeId === undefined) {
      throw new TypeError(`Workspace intake: could not detect the type of "${input.normalized}".`);
    }
    next = addNode(
      next,
      {
        value: input.normalized,
        typeId: /** @type {import('../../types.js').WorkspaceNodeType} */ (typeId),
        raw: typeof input.raw === 'string' ? input.raw : input.normalized,
        source: input.source ?? source,
        seed,
        depth: seed ? 0 : 1,
      },
      now,
    );
    const id = nodeIdOf(typeId, input.normalized);
    const node = next.nodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    if (input.latestAnalysis && node.analysis === null) {
      next = setNodeAnalysis(next, id, input.latestAnalysis, now);
    }
    if (input.verdict && input.verdict !== 'unknown' && node.verdict === 'unknown') {
      next = setNodeVerdict(next, id, input.verdict, now);
    }
    if (typeof input.notes === 'string' && input.notes !== '' && node.notes === '') {
      next = setNodeNotes(next, id, input.notes, now);
    }
    if (Array.isArray(input.tags) && input.tags.length > 0 && node.tags.length === 0) {
      next = setNodeTags(next, id, input.tags, now);
    }
  }
  return addDeterministicIntakeRelations(next, list, now);
}

/** Adds host/domain edges derivable from URL and e-mail values only. */
function addDeterministicIntakeRelations(investigation, inputs, now) {
  let next = investigation;
  for (const input of inputs) {
    const typeId = input.typeId ?? detectIocType(input.normalized);
    if (typeId !== 'url' && typeId !== 'email') continue;
    const sourceId = nodeIdOf(typeId, input.normalized);
    const derivedValue = typeId === 'url' ? hostFromUrl(input.normalized) : domainFromEmail(input.normalized);
    if (!derivedValue || detectIocType(derivedValue) !== 'domain') continue;
    next = addNode(
      next,
      { value: derivedValue, typeId: 'domain', seed: false, depth: 1, source: input.source ?? 'manual' },
      now,
    );
    next = addRelationship(
      next,
      {
        sourceId,
        targetId: nodeIdOf('domain', derivedValue),
        type: typeId === 'url' ? 'host' : 'email_uses_domain',
        confidence: 'observed',
        sourceType: 'derived',
        sourceLabel: typeId === 'url' ? 'URL parsing' : 'Email parsing',
        observedAt: now,
      },
      now,
    );
  }
  return next;
}

/** @param {string} value */
function hostFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** @param {string} value */
function domainFromEmail(value) {
  const domain = value.split('@').pop()?.toLowerCase() ?? '';
  return domain.includes('.') ? domain : null;
}

/**
 * Applies explicitly selected pivot candidates. No candidate is added until
 * this function is called by the UI, which keeps expansion under analyst
 * control (AC08).
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string} sourceNodeId
 * @param {import('./pivot-service.js').PivotCandidate[]} candidates
 * @param {string} [now]
 * @returns {WorkspaceInvestigation}
 */
export function applyPivotCandidates(investigation, sourceNodeId, candidates, now = new Date().toISOString()) {
  const source = investigation.nodes.find((node) => node.id === sourceNodeId);
  if (!source) throw new TypeError(`Workspace pivot: unknown source node "${sourceNodeId}".`);
  let next = investigation;
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    next = addNode(
      next,
      {
        value: candidate.value,
        typeId: /** @type {import('../../types.js').WorkspaceNodeType} */ (candidate.typeId),
        raw: candidate.raw,
        seed: false,
        depth: source.depth + 1,
        source: 'manual',
      },
      now,
    );
    next = addRelationship(
      next,
      {
        sourceId: sourceNodeId,
        targetId: nodeIdOf(candidate.typeId, candidate.value),
        type: candidate.relationType,
        confidence: candidate.confidence,
        sourceType: candidate.sourceType,
        sourceLabel: candidate.sourceLabel,
        provider: candidate.provider,
        observedAt: now,
      },
      now,
    );
  }
  return recordTimelineEvent(
    next,
    { type: 'pivot_performed', label: `Pivot from ${source.defanged} completed` },
    sourceNodeId,
    now,
  );
}

