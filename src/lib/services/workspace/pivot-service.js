/**
 * Bounded pivot discovery for the investigation workspace.
 *
 * Providers are queried only after an explicit Pivot action. This service never
 * opens an indicator URL, never performs a second hop by itself and never
 * mutates the investigation: the caller receives candidates and decides which
 * ones to apply.
 *
 * @module workspace/pivot-service
 */

import { normalizeIoc } from '../../utils/refang.js';
import { detectNodeType } from './investigation-model.js';

/** @typedef {import('../../types.js').WorkspaceNode} WorkspaceNode */
/** @typedef {import('../../types.js').FastCheckDefinition} FastCheckDefinition */
/** @typedef {import('../../types.js').FastCheckResult} FastCheckResult */

/**
 * @typedef {Object} PivotCandidate
 * @property {string} typeId
 * @property {string} value
 * @property {string} raw
 * @property {string} relationType
 * @property {'observed' | 'suspected'} confidence
 * @property {'provider' | 'derived' | 'analyst'} sourceType
 * @property {string} sourceLabel
 * @property {string | null} provider
 * @property {number} depth
 * @property {string} checkId
 */

/**
 * @typedef {Object} PivotResult
 * @property {string} nodeId
 * @property {PivotCandidate[]} candidates
 * @property {{ id: string, label: string, provider: string | null, status: string, summary: string | null, message: string | null }[]} checks
 * @property {boolean} limited
 * @property {string | null} limitReason
 */

export const PIVOT_LIMITS = Object.freeze({
  maxDepth: 2,
  maxCandidates: 20,
  maxProviderRequests: 4,
});

/**
 * @param {{ getChecks: (typeId: string) => FastCheckDefinition[] }} analyzer
 * @param {{ limits?: Partial<typeof PIVOT_LIMITS> }} [options]
 */
export class WorkspacePivotService {
  #analyzer;
  #limits;

  constructor(analyzer, options = {}) {
    this.#analyzer = analyzer;
    this.#limits = { ...PIVOT_LIMITS, ...options.limits };
  }

  /**
   * @param {WorkspaceNode} node
   * @param {{ signal?: AbortSignal, depth?: number, limits?: Partial<typeof PIVOT_LIMITS> }} [options]
   * @returns {Promise<PivotResult>}
   */
  async discover(node, options = {}) {
    const limits = { ...this.#limits, ...options.limits };
    const depth = options.depth ?? node.depth ?? 0;
    if (depth >= limits.maxDepth) {
      return {
        nodeId: node.id,
        candidates: [],
        checks: [],
        limited: true,
        limitReason: `Maximum pivot depth (${limits.maxDepth}) reached.`,
      };
    }

    const allDefinitions = this.#analyzer.getChecks(node.typeId);
    const definitions = allDefinitions.slice(0, limits.maxProviderRequests);
    /** @type {PivotResult['checks']} */
    const checks = [];
    /** @type {PivotCandidate[]} */
    const allCandidates = [];
    for (const definition of definitions) {
      /** @type {FastCheckResult} */
      let result;
      try {
        result = await definition.run(node.value, { signal: options.signal });
      } catch (error) {
        result = {
          status: 'error',
          summary: null,
          fields: [],
          message: error instanceof Error ? error.message : 'Unexpected pivot failure.',
          raw: null,
        };
      }
      checks.push({
        id: definition.id,
        label: definition.label,
        provider: definition.toolId,
        status: result.status,
        summary: result.summary,
        message: result.message,
      });
      if (result.status === 'ok') {
        allCandidates.push(...candidatesFromResult(node, definition, result, depth + 1));
      }
    }
    const candidates = deduplicateCandidates(allCandidates).slice(0, limits.maxCandidates);
    const limited = allDefinitions.length > definitions.length || allCandidates.length > candidates.length;
    return {
      nodeId: node.id,
      candidates,
      checks,
      limited,
      limitReason: limited ? 'The pivot result was capped; choose the relevant candidates.' : null,
    };
  }
}

function candidatesFromResult(node, definition, result, depth) {
  const provider = definition.toolId;
  const sourceLabel = definition.label;
  /** @type {PivotCandidate[]} */
  const candidates = [];
  const add = (value, typeId, relationType) => {
    if (typeof value !== 'string' || value.trim() === '') return;
    const trimmed = value.trim();
    const normalized = typeId === 'asn'
      ? `AS${trimmed.replace(/^AS/i, '').replace(/\D/g, '')}`
      : normalizeIoc(trimmed, /** @type {import('../../types.js').IocTypeId} */ (typeId));
    if (normalized === '' || detectNodeType(normalized) !== typeId || normalized === node.value) return;
    candidates.push({
      typeId,
      value: normalized,
      raw: trimmed,
      relationType,
      confidence: 'observed',
      sourceType: 'provider',
      sourceLabel,
      provider,
      depth,
      checkId: definition.id,
    });
  };

  for (const field of result.fields) {
    if (node.typeId === 'ip' && field.label === 'ASN') add(field.value, 'asn', 'announced_by');
    if ((node.typeId === 'domain' || node.typeId === 'url') && field.label === 'Sample names') {
      for (const value of String(field.value).split(/\n+/)) {
        add(value.replace(/^\*\./, ''), 'domain', 'certificate_contains');
      }
    }
    if ((node.typeId === 'domain' || node.typeId === 'url') && field.label === 'Nameservers') {
      for (const value of String(field.value).split(/[,\s]+/)) add(value, 'domain', 'nameserver');
    }
  }
  if (node.typeId === 'url') {
    try { add(new URL(node.value).hostname, 'domain', 'host'); } catch { /* invalid URL is rejected upstream */ }
  } else if (node.typeId === 'email') {
    const domain = node.value.split('@').pop();
    if (domain) add(domain, 'domain', 'email_uses_domain');
  }
  return candidates;
}

function deduplicateCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.typeId}:${candidate.value}:${candidate.relationType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

