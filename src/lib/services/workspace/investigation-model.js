/**
 * V2 investigation workspace model: investigations grouping indicators, their
 * typed relationships (with provenance and evidence), the analyst verdicts /
 * notes / tags and a local timeline.
 *
 * Pure module — no DOM, no network, no storage (persistence lives in
 * `investigation-repository.js`) — exercised by `npm run smoke`.
 *
 * Design rules (US V2):
 * - `nodes[]` + `relationships[]` are the source of truth: a graph component
 *   only renders them and can be swapped without touching this module;
 * - node identity is `${typeId}:${normalized}` (`nodeIdOf()`), the same key the
 *   V1.3 history uses, so an entry can join a workspace without a re-analysis
 *   (migration) and `evil[.]example.com` / `evil.example.com` collapse into a
 *   single node (AC03);
 * - functions return a NEW investigation (immutable updates): callers keep
 *   reference-based reactivity simple and tests stay deterministic;
 * - the verdict only ever changes through `setNodeVerdict()` — nothing here
 *   derives one from provider data (V2 AC10);
 * - timeline labels carry defanged values only, mirroring the UI.
 */

import { detectIocType } from '../../utils/detect-ioc-type.js';
import { normalizeTag } from '../../utils/history-filter.js';
import { defangIoc, normalizeIoc, refangValue } from '../../utils/refang.js';
import { INVESTIGATION_VERDICTS } from '../investigation-history.js';

/**
 * Local aliases keep the body readable while letting svelte-check resolve the
 * contracts from their defining modules.
 *
 * @typedef {import('../../types.js').WorkspaceInvestigation} WorkspaceInvestigation
 * @typedef {import('../../types.js').WorkspaceNode} WorkspaceNode
 * @typedef {import('../../types.js').WorkspaceNodeType} WorkspaceNodeType
 * @typedef {import('../../types.js').WorkspaceRelationship} WorkspaceRelationship
 * @typedef {import('../../types.js').RelationshipEvidence} RelationshipEvidence
 * @typedef {import('../../types.js').RelationshipConfidence} RelationshipConfidence
 * @typedef {import('../../types.js').RelationshipSourceType} RelationshipSourceType
 * @typedef {import('../../types.js').TimelineEvent} TimelineEvent
 * @typedef {import('../../types.js').TimelineEventType} TimelineEventType
 * @typedef {import('../../types.js').WorkspaceStatus} WorkspaceStatus
 * @typedef {import('../../types.js').InvestigationVerdict} InvestigationVerdict
 * @typedef {import('../../types.js').InvestigationAnalysisSnapshot} InvestigationAnalysisSnapshot
 * @typedef {import('../../types.js').IocTypeId} IocTypeId
 */

/** Node types of the V2 graph (US V2 minimum + `username` so V1.3 history
 *  entries migrate without a re-analysis; `file` is the catalog's hash type). */
export const WORKSPACE_NODE_TYPES = /** @type {const} */ ([
  'ip',
  'domain',
  'url',
  'email',
  'file',
  'asn',
  'certificate',
  'username',
]);

/** Analyst workflow state — never a threat qualification. */
export const INVESTIGATION_STATUSES = /** @type {const} */ ([
  'open',
  'in-progress',
  'closed',
]);

/** Relationship vocabulary (US V2 "Relations"). `type` itself is only validated
 *  as a non-empty string so a future type never blocks saving an investigation. */
export const RELATIONSHIP_TYPES = /** @type {const} */ ([
  'resolves_to',
  'redirects_to',
  'belongs_to_asn',
  'announced_by',
  'certificate_contains',
  'email_from_domain',
  'from_domain',
  'reply_to_domain',
  'return_path_domain',
  'hosted_on',
  'observed_with',
  'extracted_from',
  'host',
  'related_to',
]);

/** A relationship is either measured (`observed`) or an analyst hypothesis. */
export const RELATIONSHIP_CONFIDENCE = /** @type {const} */ (['observed', 'suspected']);

/** Provenance kind of a relationship / evidence entry (V2 AC06). */
export const RELATIONSHIP_SOURCE_TYPES = /** @type {const} */ ([
  'provider',
  'derived',
  'analyst',
]);

/** Significant actions recorded on the timeline (V2 AC15). */
export const TIMELINE_EVENT_TYPES = /** @type {const} */ ([
  'investigation_created',
  'indicator_added',
  'indicator_removed',
  'analysis_started',
  'analysis_completed',
  'pivot_performed',
  'relationship_created',
  'verdict_changed',
  'note_added',
  'export_created',
]);

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Stable node identity (`domain:evil.example.com`): what deduplication (AC03),
 * relationship endpoints and the V1.3 history ids all agree on.
 *
 * @param {string} typeId
 * @param {string} normalized
 * @returns {string}
 */
export function nodeIdOf(typeId, normalized) {
  return `${typeId}:${normalized}`;
}

/** Fresh investigation id; a caller-supplied one wins so imports keep their ids. */
function generateId() {
  const unique = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `inv-${unique}`;
}

/** `suspicious` → `Suspicious` (timeline labels). */
function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Tags reuse the V1.3 normalization (`Brute Force` → `brute-force`), deduplicated. */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  const normalized = tags
    .filter((tag) => typeof tag === 'string')
    .map((tag) => normalizeTag(tag))
    .filter((tag) => tag !== '');
  return [...new Set(normalized)];
}

/**
 * Appends one timeline event and bumps `updatedAt` (V2 AC15). Used by every
 * mutator and exported so later flows (analysis, pivot, export) record their
 * own events through the same validated path.
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {{ type: TimelineEventType, label: string }} event
 * @param {string | null} [nodeId] Related node, when any.
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function recordTimelineEvent(
  investigation,
  event,
  nodeId = null,
  now = new Date().toISOString(),
) {
  assertInvestigation(investigation);
  if (!TIMELINE_EVENT_TYPES.includes(event.type)) {
    throw new TypeError(`Workspace: unknown timeline event type "${event.type}".`);
  }
  if (typeof event.label !== 'string' || event.label === '') {
    throw new TypeError('Workspace: a timeline event needs a label.');
  }
  /** @type {TimelineEvent} */
  const timelineEvent = {
    // Unique within the investigation: type + date + append position.
    id: `${event.type}|${now}|${investigation.timeline.length}`,
    type: event.type,
    label: event.label,
    nodeId: nodeId ?? null,
    at: now,
  };
  return {
    ...investigation,
    timeline: [...investigation.timeline, timelineEvent],
    updatedAt: now,
  };
}

/**
 * Detects the graph node type of a value: ASNs by shape, everything else
 * through the V1.1 detector on the REFANGED text, so a defanged paste is still
 * recognized (`hxxps://evil[.]example[.]com/x` → `url`). Certificates are never
 * guessed — callers assign them explicitly.
 *
 * @param {unknown} value
 * @returns {WorkspaceNodeType | null}
 */
export function detectNodeType(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return null;
  }
  if (/^AS\d{1,10}$/i.test(text)) {
    return 'asn';
  }
  return /** @type {WorkspaceNodeType | null} */ (detectIocType(refangValue(text)));
}

/**
 * Canonical exploitable form of a node value. ASNs keep their conventional
 * `AS12345` spelling; every other type follows the V1.1 normalization rules.
 *
 * @param {unknown} value
 * @param {WorkspaceNodeType} typeId
 * @returns {string}
 */
function normalizeNodeValue(value, typeId) {
  const text = String(value ?? '').trim();
  if (text === '') {
    throw new TypeError('Workspace: a node needs a non-empty value (V2 AC02).');
  }
  if (!WORKSPACE_NODE_TYPES.includes(typeId)) {
    throw new TypeError(`Workspace: unknown node type "${typeId}".`);
  }
  if (typeId === 'asn') {
    const digits = text.replace(/^AS/i, '');
    if (!/^\d{1,10}$/.test(digits)) {
      throw new TypeError(`Workspace: "${text}" is not a valid ASN.`);
    }
    return `AS${digits}`;
  }
  return normalizeIoc(text, /** @type {IocTypeId} */ (typeId));
}

/**
 * Boundary guard: every mutator expects a real investigation (built by
 * `createInvestigation()` or the repository sanitizer).
 *
 * @param {unknown} investigation
 */
function assertInvestigation(investigation) {
  if (
    !isObject(investigation) ||
    typeof investigation.id !== 'string' ||
    !Array.isArray(investigation.nodes) ||
    !Array.isArray(investigation.relationships) ||
    !Array.isArray(investigation.timeline)
  ) {
    throw new TypeError('Workspace: not an investigation — build one with createInvestigation().');
  }
}

/**
 * Creates an empty investigation (V2 AC01): name required, description and
 * tags optional, status `open`, one `investigation_created` timeline event.
 *
 * @param {{ name: string, description?: string, tags?: string[], status?: WorkspaceStatus,
 *           id?: string }} input
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function createInvestigation(input, now = new Date().toISOString()) {
  const name = String(input?.name ?? '').trim();
  if (name === '') {
    throw new TypeError('Workspace: an investigation needs a non-empty name (V2 AC01).');
  }
  const status = input.status ?? 'open';
  if (!INVESTIGATION_STATUSES.includes(status)) {
    throw new TypeError(`Workspace: unknown investigation status "${status}".`);
  }
  const investigation = {
    id: typeof input.id === 'string' && input.id !== '' ? input.id : generateId(),
    name,
    description: String(input.description ?? ''),
    status,
    tags: normalizeTags(input.tags),
    notes: '',
    nodes: [],
    relationships: [],
    timeline: [],
    createdAt: now,
    updatedAt: now,
  };
  return recordTimelineEvent(
    investigation,
    { type: 'investigation_created', label: `Investigation "${name}" created` },
    null,
    now,
  );
}

/**
 * Adds an indicator / artifact (V2 AC02). The value is normalized and the node
 * deduplicated on `typeId:normalized` (V2 AC03): adding `evil[.]example.com`
 * and `evil.example.com` yields ONE node, keeping its verdict, notes and
 * analysis untouched. Seed flags are sticky (`true` wins) and depth keeps the
 * smallest known value.
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {{ value: string, typeId?: WorkspaceNodeType, seed?: boolean, depth?: number,
 *           raw?: string | null }} input `typeId` is auto-detected when omitted.
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function addNode(investigation, input, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const typeId = input.typeId ?? detectNodeType(input.value);
  if (typeId === null || typeId === undefined) {
    throw new TypeError('Workspace: could not detect the node type — pass "typeId" explicitly.');
  }
  const value = normalizeNodeValue(input.value, typeId);
  const id = nodeIdOf(typeId, value);
  const existing = investigation.nodes.find((node) => node.id === id);
  if (existing) {
    // AC03: same normalized indicator = same node. Never rewrite analyst data;
    // only merge the structural hints (seed, depth) into the existing node.
    const seed = existing.seed || input.seed === true;
    const depth =
      input.depth !== undefined && input.depth < existing.depth ? input.depth : existing.depth;
    if (seed === existing.seed && depth === existing.depth) {
      return investigation;
    }
    return {
      ...investigation,
      nodes: investigation.nodes.map((node) => (node.id === id ? { ...node, seed, depth } : node)),
      updatedAt: now,
    };
  }
  /** @type {WorkspaceNode} */
  const node = {
    id,
    typeId,
    value,
    defanged: defangIoc(value, /** @type {IocTypeId} */ (typeId)),
    raw: typeof input.raw === 'string' && input.raw !== '' ? input.raw : String(input.value).trim(),
    // V2 AC10: a fresh node is always `unknown`; only the analyst changes it.
    verdict: 'unknown',
    notes: '',
    analysis: null,
    seed: input.seed === true,
    depth: input.seed === true ? 0 : Math.max(0, Math.floor(input.depth ?? 1)),
    tags: [],
    hidden: false,
    position: null,
    addedAt: now,
  };
  return recordTimelineEvent(
    { ...investigation, nodes: [...investigation.nodes, node] },
    { type: 'indicator_added', label: `${node.defanged} added` },
    id,
    now,
  );
}

/**
 * Removes a node and every relationship pointing to it (V2 AC18/AC19): only
 * THIS workspace changes — the V1.3 global history is a separate store and is
 * never touched. Removing an unknown node is a no-op.
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string} nodeId
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function removeNode(investigation, nodeId, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const node = investigation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return investigation;
  }
  return recordTimelineEvent(
    {
      ...investigation,
      nodes: investigation.nodes.filter((candidate) => candidate.id !== nodeId),
      relationships: investigation.relationships.filter(
        (relationship) => relationship.sourceId !== nodeId && relationship.targetId !== nodeId,
      ),
    },
    { type: 'indicator_removed', label: `${node.defanged} removed` },
    nodeId,
    now,
  );
}

/**
 * Adds a typed relationship between two nodes (V2 AC05/AC12). Both endpoints
 * must already exist (create them with `addNode()` first).
 *
 * Deduplication (US V2 "Relations dupliquées"): a second observation of the
 * same `(source, target, type)` does NOT create a second edge — it appends an
 * evidence entry to the existing one, so several sources (DNS provider, email
 * header, analyst) can confirm the same link. `observed` evidence never
 * downgrades an existing `observed` confidence, and a later observation only
 * raises `observedAt`.
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {{ sourceId: string, targetId: string, type: string,
 *           confidence?: RelationshipConfidence, sourceType: RelationshipSourceType,
 *           sourceLabel?: string | null, provider?: string | null,
 *           observedAt?: string }} input `sourceType: 'analyst'` = manual link
 *   (V2 AC12); `'provider'` / `'derived'` keep the automatic provenance (AC06).
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function addRelationship(investigation, input, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const source = investigation.nodes.find((node) => node.id === input.sourceId);
  const target = investigation.nodes.find((node) => node.id === input.targetId);
  if (!source || !target) {
    throw new TypeError(
      `Workspace: relationship endpoints must exist ("${!source ? input.sourceId : input.targetId}" not found).`,
    );
  }
  const type = String(input.type ?? '').trim();
  if (type === '') {
    throw new TypeError('Workspace: a relationship needs a type (V2 AC05).');
  }
  if (!RELATIONSHIP_SOURCE_TYPES.includes(input.sourceType)) {
    throw new TypeError(`Workspace: unknown relationship sourceType "${input.sourceType}".`);
  }
  const confidence = RELATIONSHIP_CONFIDENCE.includes(input.confidence ?? 'observed')
    ? (input.confidence ?? 'observed')
    : 'observed';
  const id = `${source.id}->${target.id}:${type}`;
  const observedAt = typeof input.observedAt === 'string' && input.observedAt !== ''
    ? input.observedAt
    : now;
  /** @type {RelationshipEvidence} */
  const evidence = {
    sourceType: input.sourceType,
    sourceLabel:
      typeof input.sourceLabel === 'string' && input.sourceLabel !== ''
        ? input.sourceLabel
        : null,
    provider: typeof input.provider === 'string' && input.provider !== '' ? input.provider : null,
    observedAt,
  };
  const existing = investigation.relationships.find((relationship) => relationship.id === id);
  if (existing) {
    const duplicate = existing.evidence.some(
      (entry) =>
        entry.sourceType === evidence.sourceType &&
        entry.sourceLabel === evidence.sourceLabel &&
        entry.provider === evidence.provider &&
        entry.observedAt === evidence.observedAt,
    );
    return {
      ...investigation,
      relationships: investigation.relationships.map((relationship) =>
        relationship.id !== id
          ? relationship
          : {
              ...relationship,
              confidence:
                relationship.confidence === 'observed' || confidence === 'observed'
                  ? 'observed'
                  : 'suspected',
              observedAt: relationship.observedAt > observedAt ? relationship.observedAt : observedAt,
              evidence: duplicate ? existing.evidence : [...existing.evidence, evidence],
            },
      ),
      updatedAt: now,
    };
  }
  /** @type {WorkspaceRelationship} */
  const relationship = {
    id,
    sourceId: source.id,
    targetId: target.id,
    type,
    confidence,
    sourceType: input.sourceType,
    sourceLabel: evidence.sourceLabel,
    provider: evidence.provider,
    observedAt,
    evidence: [evidence],
  };
  return recordTimelineEvent(
    { ...investigation, relationships: [...investigation.relationships, relationship] },
    {
      type: 'relationship_created',
      label: `${source.defanged} → ${target.defanged} (${type})`,
    },
    null,
    now,
  );
}

/**
 * Sets the analyst verdict of one node (V2 AC10). This is the ONLY way a
 * verdict changes: nothing in the model derives it from provider data.
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string} nodeId
 * @param {InvestigationVerdict} verdict
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function setNodeVerdict(investigation, nodeId, verdict, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const node = investigation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new TypeError(`Workspace: unknown node "${nodeId}".`);
  }
  if (!INVESTIGATION_VERDICTS.includes(verdict)) {
    throw new TypeError(`Workspace: unknown verdict "${verdict}".`);
  }
  if (node.verdict === verdict) {
    return investigation;
  }
  return recordTimelineEvent(
    {
      ...investigation,
      nodes: investigation.nodes.map((candidate) =>
        candidate.id === nodeId ? { ...candidate, verdict } : candidate,
      ),
    },
    { type: 'verdict_changed', label: `${node.defanged} marked ${capitalize(verdict)}` },
    nodeId,
    now,
  );
}

/**
 * Stores the analyst notes of one node verbatim — line breaks and spacing are
 * never rewritten (V2 AC11, same rule as the V1.3 history).
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string} nodeId
 * @param {string} notes
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function setNodeNotes(investigation, nodeId, notes, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const node = investigation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new TypeError(`Workspace: unknown node "${nodeId}".`);
  }
  const text = String(notes ?? '');
  if (node.notes === text) {
    return investigation;
  }
  return recordTimelineEvent(
    {
      ...investigation,
      nodes: investigation.nodes.map((candidate) =>
        candidate.id === nodeId ? { ...candidate, notes: text } : candidate,
      ),
    },
    { type: 'note_added', label: `${node.defanged} note updated` },
    nodeId,
    now,
  );
}

/**
 * Stores the investigation-level notes verbatim (V2 AC11).
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string} notes
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function setInvestigationNotes(investigation, notes, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const text = String(notes ?? '');
  if (investigation.notes === text) {
    return investigation;
  }
  return recordTimelineEvent(
    { ...investigation, notes: text },
    { type: 'note_added', label: 'Investigation notes updated' },
    null,
    now,
  );
}

/**
 * Replaces the investigation-level tags (normalized like V1.3: lowercased,
 * spaces → dashes, deduplicated).
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string[]} tags
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function setInvestigationTags(investigation, tags, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const next = normalizeTags(tags);
  if (next.length === investigation.tags.length && next.every((tag) => investigation.tags.includes(tag))) {
    return investigation;
  }
  return { ...investigation, tags: next, updatedAt: now };
}

/**
 * Replaces the tags of one node (same normalization as the investigation tags).
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string} nodeId
 * @param {string[]} tags
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function setNodeTags(investigation, nodeId, tags, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const node = investigation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new TypeError(`Workspace: unknown node "${nodeId}".`);
  }
  const next = normalizeTags(tags);
  if (next.length === node.tags.length && next.every((tag) => node.tags.includes(tag))) {
    return investigation;
  }
  return {
    ...investigation,
    nodes: investigation.nodes.map((candidate) =>
      candidate.id === nodeId ? { ...candidate, tags: next } : candidate,
    ),
    updatedAt: now,
  };
}

/**
 * Sets the analyst workflow status (`open` / `in-progress` / `closed`) — an
 * advancement marker, never a threat qualification.
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {WorkspaceStatus} status
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function setStatus(investigation, status, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  if (!INVESTIGATION_STATUSES.includes(status)) {
    throw new TypeError(`Workspace: unknown investigation status "${status}".`);
  }
  if (investigation.status === status) {
    return investigation;
  }
  return { ...investigation, status, updatedAt: now };
}

/**
 * Updates the analyst-facing metadata of an investigation (V2 AC01: the name
 * and description stay editable after creation). Tags and status have their
 * own mutators — one concern per function. A no-op patch returns the input
 * unchanged so the UI can detect "nothing to save".
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {{ name?: string, description?: string }} patch
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function setInvestigationInfo(investigation, patch, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const name = patch?.name !== undefined ? String(patch.name).trim() : investigation.name;
  if (name === '') {
    throw new TypeError('Workspace: an investigation needs a non-empty name (V2 AC01).');
  }
  const description =
    patch?.description !== undefined ? String(patch.description) : investigation.description;
  if (name === investigation.name && description === investigation.description) {
    return investigation;
  }
  return { ...investigation, name, description, updatedAt: now };
}

/**
 * Sets the latest provider analysis on one node without changing its analyst
 * verdict (V2 AC10) and records an `analysis_completed` timeline event.
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string} nodeId
 * @param {InvestigationAnalysisSnapshot | null} analysis
 * @param {string} [now] ISO date (injectable for tests).
 * @returns {WorkspaceInvestigation}
 */
export function setNodeAnalysis(investigation, nodeId, analysis, now = new Date().toISOString()) {
  assertInvestigation(investigation);
  const node = investigation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new TypeError(`Workspace: unknown node "${nodeId}".`);
  }
  return recordTimelineEvent(
    {
      ...investigation,
      nodes: investigation.nodes.map((candidate) =>
        candidate.id === nodeId ? { ...candidate, analysis } : candidate,
      ),
    },
    { type: 'analysis_completed', label: `${node.defanged} analysis completed` },
    nodeId,
    now,
  );
}

/**
 * Persists the manually dragged position of a node (V2 AC17) so a reopened
 * investigation keeps its layout. `null` clears it (back to auto-layout).
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string} nodeId
 * @param {{ x: number, y: number } | null} position
 * @returns {WorkspaceInvestigation}
 */
export function setNodePosition(investigation, nodeId, position) {
  assertInvestigation(investigation);
  const node = investigation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new TypeError(`Workspace: unknown node "${nodeId}".`);
  }
  const valid =
    position === null ||
    (typeof position.x === 'number' &&
      typeof position.y === 'number' &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y));
  if (!valid) {
    throw new TypeError('Workspace: position must be { x, y } finite numbers or null.');
  }
  const current = node.position;
  if (
    (position === null && current === null) ||
    (position !== null && current !== null && position.x === current.x && position.y === current.y)
  ) {
    return investigation;
  }
  return {
    ...investigation,
    nodes: investigation.nodes.map((candidate) =>
      candidate.id === nodeId ? { ...candidate, position } : candidate,
    ),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Hides / shows a node in the graph without removing it from the
 * investigation (US V2 "Hide from graph").
 *
 * @param {WorkspaceInvestigation} investigation
 * @param {string} nodeId
 * @param {boolean} hidden
 * @returns {WorkspaceInvestigation}
 */
export function setNodeHidden(investigation, nodeId, hidden) {
  assertInvestigation(investigation);
  const node = investigation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new TypeError(`Workspace: unknown node "${nodeId}".`);
  }
  if (node.hidden === hidden) {
    return investigation;
  }
  return {
    ...investigation,
    nodes: investigation.nodes.map((candidate) =>
      candidate.id === nodeId ? { ...candidate, hidden } : candidate,
    ),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Reads and sanitizes a stored investigation: a corrupted or partial payload
 * must never break the UI (same policy as the V1.3 history). Unknown fields
 * are dropped, missing collections default to empty, dangling relationships
 * (endpoint no longer present) are removed. Returns `null` when the payload is
 * not an investigation at all.
 *
 * @param {unknown} value
 * @returns {WorkspaceInvestigation | null}
 */
export function sanitizeInvestigation(value) {
  if (!isObject(value) || typeof value.id !== 'string' || value.id === '' ||
      typeof value.name !== 'string' || value.name.trim() === '') {
    return null;
  }
  const now = typeof value.createdAt === 'string' && value.createdAt !== ''
    ? value.createdAt
    : new Date().toISOString();
  /** @type {WorkspaceNode[]} */
  const nodes = [];
  for (const raw of Array.isArray(value.nodes) ? value.nodes : []) {
    const node = sanitizeNode(raw);
    if (node) {
      nodes.push(node);
    }
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  /** @type {WorkspaceRelationship[]} */
  const relationships = [];
  for (const raw of Array.isArray(value.relationships) ? value.relationships : []) {
    const relationship = sanitizeRelationship(raw, nodeIds);
    if (relationship) {
      relationships.push(relationship);
    }
  }
  /** @type {TimelineEvent[]} */
  const timeline = [];
  for (const raw of Array.isArray(value.timeline) ? value.timeline : []) {
    const event = sanitizeTimelineEvent(raw);
    if (event) {
      timeline.push(event);
    }
  }
  return {
    id: value.id,
    name: value.name.trim(),
    description: typeof value.description === 'string' ? value.description : '',
    status: INVESTIGATION_STATUSES.includes(value.status) ? value.status : 'open',
    tags: normalizeTags(value.tags),
    notes: typeof value.notes === 'string' ? value.notes : '',
    nodes,
    relationships,
    timeline,
    createdAt: now,
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt !== '' ? value.updatedAt : now,
  };
}

/**
 * @param {unknown} value
 * @returns {WorkspaceNode | null}
 */
function sanitizeNode(value) {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' || value.id === '' ||
    typeof value.value !== 'string'
  ) {
    return null;
  }
  const typeId = WORKSPACE_NODE_TYPES.includes(value.typeId) ? value.typeId : null;
  if (typeId === null) {
    return null;
  }
  const depth = typeof value.depth === 'number' && Number.isFinite(value.depth) && value.depth >= 0
    ? Math.floor(value.depth)
    : 1;
  const position = isObject(value.position) &&
    typeof value.position.x === 'number' && Number.isFinite(value.position.x) &&
    typeof value.position.y === 'number' && Number.isFinite(value.position.y)
    ? { x: value.position.x, y: value.position.y }
    : null;
  return {
    id: value.id,
    typeId,
    value: value.value,
    defanged: typeof value.defanged === 'string' && value.defanged !== ''
      ? value.defanged
      : defangIoc(value.value, /** @type {IocTypeId} */ (typeId)),
    raw: typeof value.raw === 'string' && value.raw !== '' ? value.raw : value.value,
    verdict: INVESTIGATION_VERDICTS.includes(value.verdict) ? value.verdict : 'unknown',
    notes: typeof value.notes === 'string' ? value.notes : '',
    analysis: isObject(value.analysis) && typeof value.analysis.checkedAt === 'string' &&
      Array.isArray(value.analysis.checks)
      ? { checkedAt: value.analysis.checkedAt, checks: value.analysis.checks }
      : null,
    seed: value.seed === true,
    depth,
    tags: normalizeTags(value.tags),
    hidden: value.hidden === true,
    position,
    addedAt: typeof value.addedAt === 'string' && value.addedAt !== ''
      ? value.addedAt
      : new Date().toISOString(),
  };
}

/**
 * @param {unknown} value
 * @param {Set<string>} nodeIds Endpoint universe — dangling links are dropped.
 * @returns {WorkspaceRelationship | null}
 */
function sanitizeRelationship(value, nodeIds) {
  if (
    !isObject(value) ||
    typeof value.sourceId !== 'string' ||
    typeof value.targetId !== 'string' ||
    typeof value.type !== 'string' || value.type === '' ||
    !nodeIds.has(value.sourceId) ||
    !nodeIds.has(value.targetId)
  ) {
    return null;
  }
  /** @type {RelationshipEvidence[]} */
  const evidence = [];
  for (const raw of Array.isArray(value.evidence) ? value.evidence : []) {
    if (
      isObject(raw) &&
      RELATIONSHIP_SOURCE_TYPES.includes(raw.sourceType) &&
      typeof raw.observedAt === 'string'
    ) {
      evidence.push({
        sourceType: raw.sourceType,
        sourceLabel: typeof raw.sourceLabel === 'string' && raw.sourceLabel !== ''
          ? raw.sourceLabel
          : null,
        provider: typeof raw.provider === 'string' && raw.provider !== '' ? raw.provider : null,
        observedAt: raw.observedAt,
      });
    }
  }
  return {
    id: typeof value.id === 'string' && value.id !== ''
      ? value.id
      : `${value.sourceId}->${value.targetId}:${value.type}`,
    sourceId: value.sourceId,
    targetId: value.targetId,
    type: value.type,
    confidence: RELATIONSHIP_CONFIDENCE.includes(value.confidence) ? value.confidence : 'suspected',
    sourceType: RELATIONSHIP_SOURCE_TYPES.includes(value.sourceType) ? value.sourceType : 'analyst',
    sourceLabel: typeof value.sourceLabel === 'string' && value.sourceLabel !== ''
      ? value.sourceLabel
      : null,
    provider: typeof value.provider === 'string' && value.provider !== '' ? value.provider : null,
    observedAt: typeof value.observedAt === 'string' && value.observedAt !== ''
      ? value.observedAt
      : evidence[0]?.observedAt ?? '',
    evidence,
  };
}

/**
 * @param {unknown} value
 * @returns {TimelineEvent | null}
 */
function sanitizeTimelineEvent(value) {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' || value.id === '' ||
    !TIMELINE_EVENT_TYPES.includes(value.type) ||
    typeof value.label !== 'string' || value.label === '' ||
    typeof value.at !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    type: value.type,
    label: value.label,
    nodeId: typeof value.nodeId === 'string' && value.nodeId !== '' ? value.nodeId : null,
    at: value.at,
  };
}







