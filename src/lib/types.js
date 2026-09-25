/**
 * Shared data contracts for the tool catalog.
 *
 * @typedef {Object} IocType
 * @property {string} id    Unique IoC type identifier referenced by tools.
 * @property {string} label Human-readable label displayed in the UI.
 */

/**
 * @typedef {Object} ToolCategory
 * @property {string} id    Unique category identifier referenced by tools.
 * @property {string} label Human-readable label displayed in the UI.
 */

/**
 * @typedef {Object} Tool
 * @property {string} id          Unique identifier (used as list key).
 * @property {string} name        Display name.
 * @property {string} url         Absolute HTTPS URL of the tool.
 * @property {string} categoryId  Identifier of one entry of `catalog.categories`.
 * @property {string[]} iocTypes  Identifiers of the IoC types the tool handles
 *                                (subset of `catalog.iocTypes`).
 * @property {string} description What the tool does and when to use it.
 * @property {string[]} tags      Free-form keywords consumed by the search.
 */

/**
 * @typedef {Object} ToolCatalog
 * @property {string} version     Catalog schema version.
 * @property {string} updatedAt   ISO date of the last manual update.
 * @property {ToolCategory[]} categories
 * @property {IocType[]} iocTypes
 * @property {Tool[]} tools
 */

/**
 * @typedef {Object} HealthResult
 * @property {boolean} ok        True when the site responded with a status below 500.
 * @property {number | null} status HTTP status code (null on network error or timeout).
 * @property {number | null} ms    Response time in milliseconds (null on failure).
 */

/**
 * @typedef {Object} HealthCatalog
 * @property {string} version   Health data schema version.
 * @property {string} checkedAt ISO date of the last health-check run.
 * @property {Record<string, HealthResult>} results Health per tool id.
 */

/**
 * One indicator of compromise extracted from a pasted text by
 * `extractIocs()` (see `src/lib/utils/extract-iocs.js`).
 *
 * @typedef {Object} ExtractedIoc
 * @property {string} id    Stable deduplication key (`typeId:normalized`).
 * @property {'ip' | 'domain' | 'url' | 'file' | 'email'} typeId
 * @property {string} raw        Value as encountered in the text (may be defanged).
 * @property {string} normalized Exploitable (refanged, canonical) value.
 * @property {string} defanged   Neutralized form shown by default in the UI.
 * @property {'MD5' | 'SHA-1' | 'SHA-256' | null} hashKind Display precision for `file` indicators.
 * @property {number} index Position of the first occurrence in the analyzed text.
 */

/**
 * One key fact extracted from a fast-analyze provider response.
 *
 * @typedef {Object} FastCheckField
 * @property {string} label Field label.
 * @property {string} value Field value (plain text, may span several lines).
 * @property {'good' | 'warn' | 'bad'} [tone] Optional severity used for color.
 */

/**
 * Bounded raw response captured directly from a keyless provider after an
 * explicit browser lookup. The body is inert serialized text, never HTML.
 *
 * @typedef {Object} ProviderRawResponse
 * @property {string} url Exact provider URL used for the lookup.
 * @property {number} status HTTP status returned by the provider.
 * @property {string | null} contentType Response content type, when exposed by CORS.
 * @property {string} body Raw response text, possibly truncated.
 * @property {number} originalBytes UTF-8 size before truncation.
 * @property {number} storedBytes UTF-8 size of the retained body.
 * @property {boolean} truncated Whether `body` is a bounded prefix.
 */

/**
 * Outcome of a single fast-analyze check against one provider.
 *
 * @typedef {Object} FastCheckResult
 * @property {'ok' | 'empty' | 'error'} status Outcome of the check.
 * @property {string | null} summary    One-line takeaway shown under the title.
 * @property {FastCheckField[]} fields  Key facts extracted from the response.
 * @property {string | null} message    Human-readable detail for empty/error.
 * @property {ProviderRawResponse | null} raw Bounded raw response, when available.
 */

/**
 * A runnable fast-analyze check for one provider, produced by
 * `FastAnalyzerService.getChecks()`.
 *
 * @typedef {Object} FastCheckDefinition
 * @property {string} id      Stable check identifier (used as list key).
 * @property {string} label   Check label displayed in the UI.
 * @property {string | null} toolId Catalog tool backing this check, if any.
 * @property {(value: string, options?: { signal?: AbortSignal }) => Promise<FastCheckResult>} run
 */

/**
 * Identifier of an IoC type supported by the catalog and its filters.
 *
 * @typedef {'ip' | 'domain' | 'url' | 'file' | 'email' | 'username'} IocTypeId
 */

/**
 * State of one provider check inside a batch analysis.
 *
 * @typedef {'pending' | 'running' | 'ok' | 'empty' | 'error' | 'cancelled'} BatchCheckStatus
 */

/**
 * Global status of one IoC in a batch analysis (see `computeBatchStatus`).
 *
 * @typedef {'Pending' | 'Running' | 'Complete' | 'Partial' | 'Error' | 'Cancelled'
 *           | 'No automated check available'} BatchIocStatus
 */

/**
 * One provider check of a batch analysis, updated as it settles.
 *
 * @typedef {Object} BatchCheckState
 * @property {FastCheckDefinition} def     Check definition (id, label, toolId, run).
 * @property {BatchCheckStatus} status     Current state of the check.
 * @property {FastCheckResult | null} result Normalized provider answer once settled.
 * @property {number | null} ms            Duration in milliseconds (null while pending).
 */

/**
 * One IoC of a batch analysis and the state of each of its checks.
 *
 * @typedef {Object} BatchRow
 * @property {ExtractedIoc} ioc          The analysed indicator (normalized value used).
 * @property {BatchCheckState[]} checkStates One entry per compatible provider check.
 */

/**
 * Analyst qualification of an investigation. Never set automatically: only the
 * analyst assigns it, and no provider answer is ever turned into a verdict.
 *
 * @typedef {'unknown' | 'benign' | 'suspicious' | 'malicious'} InvestigationVerdict
 */

/**
 * Serializable snapshot of one provider check, kept with an investigation.
 *
 * @typedef {Object} InvestigationCheckSnapshot
 * @property {string} id          Stable check identifier.
 * @property {string} label       Check label.
 * @property {string | null} toolId Catalog tool backing the check, if any.
 * @property {string} status      `ok` | `empty` | `error` | `cancelled`.
 * @property {number | null} ms   Duration in milliseconds.
 * @property {string | null} summary Provider one-liner.
 * @property {FastCheckField[]} fields Key facts returned by the provider.
 * @property {string | null} message Provider message (error detail included).
 * @property {ProviderRawResponse | null} [raw] Bounded raw response, when available.
 */

/**
 * Latest analysis stored for an investigation: only the most recent run is
 * kept, older snapshots are intentionally not retained in this version.
 *
 * @typedef {Object} InvestigationAnalysisSnapshot
 * @property {string} checkedAt ISO date of the run.
 * @property {InvestigationCheckSnapshot[]} checks One entry per compatible check.
 */

/**
 * One locally stored investigation: the indicator, the analyst qualification
 * (verdict, tags, notes) and the latest provider results. Keyed on
 * `typeId:normalized` so refanged and defanged spellings collapse into one.
 *
 * @typedef {Object} InvestigationEntry
 * @property {string} id           Storage key (`${typeId}:${normalized}`).
 * @property {string} typeId       IoC type identifier.
 * @property {string} normalized   Exploitable value used as the identity (AC14).
 * @property {string} defanged     Neutralized form shown in the UI.
 * @property {string} firstAnalyzedAt ISO date of the first analysis or save.
 * @property {string} lastAnalyzedAt  ISO date of the latest analysis or save.
 * @property {InvestigationVerdict} verdict Analyst qualification (default `unknown`).
 * @property {string[]} tags       Free-form labels used for filtering.
 * @property {string} notes        Free-form analyst notes.
 * @property {InvestigationAnalysisSnapshot | null} latestAnalysis Latest provider results.
 * @property {InvestigationSource | null} source Provenance of the investigation (US V1.5),
 *   `null` when unknown.
 */

/**
 * Provenance of an investigation: how the indicator first entered the app.
 * Exported as-is when known (US V1.5), never derived from provider answers.
 *
 * @typedef {'manual' | 'extracted-text' | 'email-headers'} InvestigationSource
 */

/**
 * Intake item accepted by the workspace helper. It can be an extracted IoC, a
 * V1.3 history entry, or a small session-only object; the helper only consumes
 * the fields it owns and never mutates the input.
 *
 * @typedef {Object} WorkspaceIndicatorInput
 * @property {string} typeId IoC type identifier.
 * @property {string} normalized Normalized value used as identity.
 * @property {string} [raw] Original spelling, when known.
 * @property {string} [defanged] Defanged spelling, when known.
 * @property {InvestigationSource} [source] Intake provenance.
 * @property {InvestigationVerdict} [verdict] Analyst qualification to preserve during migration.
 * @property {string[]} [tags] Analyst tags to preserve during migration.
 * @property {string} [notes] Analyst notes to preserve during migration.
 * @property {InvestigationAnalysisSnapshot | null} [latestAnalysis] Latest provider snapshot.
 */

/**
 * Normalized input accepted by the export pipeline (US V1.5). A stored
 * `InvestigationEntry` satisfies it directly; session-only data (Fast analyze,
 * batch results not kept in the history) can be adapted by the caller with
 * sensible defaults (`verdict: 'unknown'`, empty tags/notes, no dates).
 *
 * @typedef {Object} ExportInput
 * @property {string} typeId   IoC type identifier.
 * @property {string} normalized Exploitable value used as the identity.
 * @property {string} [defanged] Neutralized form (computed when missing).
 * @property {string | null} [raw] Value exactly as originally found, when known.
 * @property {string} [firstAnalyzedAt] ISO date of the first analysis, `''` when unknown.
 * @property {string} [lastAnalyzedAt] ISO date of the latest analysis, `''` when unknown.
 * @property {InvestigationVerdict} [verdict] Analyst qualification (default `unknown`).
 * @property {string[]} [tags] Free-form labels.
 * @property {string} [notes] Free-form analyst notes.
 * @property {InvestigationAnalysisSnapshot | null} [latestAnalysis] Latest provider results.
 * @property {InvestigationSource | null} [source] Provenance, when known.
 */

/**
 * Content options of an export (US V1.5). The most useful options default to
 * on; raw provider responses stay off by default.
 *
 * @typedef {Object} ExportOptions
 * @property {boolean} [includeAnalysis] Include the latest analysis results.
 * @property {boolean} [includeNotes]    Include the analyst notes.
 * @property {boolean} [includeTags]     Include the tags.
 * @property {boolean} [includeLinks]    Include the external investigation links.
 * @property {boolean} [includeRaw]      Include raw provider responses (JSON only; the
 *   application does not retain them yet, so the value stays `null`).
 * @property {import('./types.js').Tool[]} [tools] Catalog used to resolve provider
 *   names and build the investigation links.
 * @property {string | Date} [now] Generation date (injectable for tests).
 */

/**
 * V2 investigation workspace (US V2).
 *
 * An investigation groups indicators (`nodes`), their typed relationships, the
 * analyst data and a timeline. The workspace — not the future graph component
 * — is the source of truth.
 */

/**
 * Analyst workflow state of an investigation. Describes the advancement of the
 * work, never a threat qualification.
 *
 * @typedef {'open' | 'in-progress' | 'closed'} WorkspaceStatus
 */

/**
 * Node types of the V2 graph (US V2 minimum + `username` so V1.3 history
 * entries can migrate without a re-analysis). `file` is the catalog's hash
 * type; `asn` and `certificate` exist only in the workspace.
 *
 * @typedef {'ip' | 'domain' | 'url' | 'email' | 'file' | 'asn' | 'certificate' | 'username'} WorkspaceNodeType
 */

/**
 * One indicator / artifact of an investigation. Identity is
 * `${typeId}:${normalized}` (`nodeIdOf()`), matching the V1.3 history key so
 * refanged and defanged spellings collapse into one node (AC03).
 *
 * @typedef {Object} WorkspaceNode
 * @property {string} id          Stable deduplication key (`typeId:normalized`).
 * @property {WorkspaceNodeType} typeId Node type.
 * @property {string} value       Normalized (exploitable) value.
 * @property {string} defanged    Neutralized form shown in the UI.
 * @property {string | null} raw   Value exactly as entered/found, when known.
 * @property {InvestigationSource} source How the node entered the workspace.
 * @property {InvestigationVerdict} verdict Analyst qualification only — never
 *   derived from provider data (AC10).
 * @property {string} notes       Verbatim analyst notes for this node (AC11).
 * @property {InvestigationAnalysisSnapshot | null} analysis Latest provider
 *   results (filled when an analysis is recorded on the node).
 * @property {boolean} seed       True for the investigation's starting indicators.
 * @property {number} depth       Hops from the nearest seed (0 = seed); caps automatic expansion.
 * @property {string[]} tags      Investigation-level tags on the node (V2 AC11).
 * @property {boolean} hidden     Hidden from the graph view without being removed.
 * @property {{ x: number, y: number } | null} position Manually dragged layout
 *   position, persisted so a reopened investigation keeps its layout (V2 AC17);
 *   `null` = let the automatic layout place it.
 * @property {string} addedAt     ISO date when the node joined the workspace.
 */

/**
 * One proof that a relationship was observed (US V2 "Evidence"). Several
 * entries may confirm the same relationship.
 *
 * @typedef {Object} RelationshipEvidence
 * @property {RelationshipSourceType} sourceType Provenance kind (AC06).
 * @property {string | null} sourceLabel Human label ("Fast Analyze", "Email
 *   headers", "Analyst", "URL parsing").
 * @property {string | null} provider Provider that produced it, when any.
 * @property {string} observedAt ISO date of the observation.
 */

/**
 * Measured link (`observed`) vs analyst hypothesis (`suspected`).
 *
 * @typedef {'observed' | 'suspected'} RelationshipConfidence
 */

/**
 * Provenance kind of a relationship / evidence entry: provider answer,
 * deterministic derivation from another node, or an analyst hand-made link.
 *
 * @typedef {'provider' | 'derived' | 'analyst'} RelationshipSourceType
 */

/**
 * Typed, directed link between two nodes (AC05) keeping its provenance
 * (AC06). Repeated observations of the same link merge into ONE relationship
 * carrying several evidence entries instead of duplicating the edge.
 *
 * @typedef {Object} WorkspaceRelationship
 * @property {string} id         Deduplication key (`sourceId->targetId:type`).
 * @property {string} sourceId   Source node id.
 * @property {string} targetId   Target node id.
 * @property {string} type       Explicit relation type (see RELATIONSHIP_TYPES).
 * @property {RelationshipConfidence} confidence `observed` vs `suspected`.
 * @property {RelationshipSourceType} sourceType Provenance kind (AC06).
 * @property {string | null} sourceLabel Human provenance label.
 * @property {string | null} provider Provider id/tool when `sourceType` is `provider`.
 * @property {string} observedAt ISO date of the latest observation.
 * @property {RelationshipEvidence[]} evidence Every proof gathered for this link.
 */

/**
 * Significant action of the investigation (AC15). The timeline records what
 * happened, not raw provider payloads.
 *
 * @typedef {Object} TimelineEvent
 * @property {string} id       Unique within the investigation.
 * @property {TimelineEventType} type Event kind (see TIMELINE_EVENT_TYPES).
 * @property {string} label    One-line description (defanged values only).
 * @property {string | null} nodeId Related node, when any.
 * @property {string} at       ISO date.
 */

/**
 * One of the significant actions recorded on the timeline (AC15).
 *
 * @typedef {'investigation_created' | 'indicator_added' | 'indicator_removed'
 *   | 'analysis_started' | 'analysis_completed' | 'pivot_performed'
 *   | 'relationship_created' | 'verdict_changed' | 'note_added'
 *   | 'export_created'} TimelineEventType
 */

/**
 * V2 investigation workspace: the graph component only renders this data — it
 * is never the source of truth, which keeps exports, tests and any future
 * graph library interchangeable.
 *
 * @typedef {Object} WorkspaceInvestigation
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {WorkspaceStatus} status Analyst workflow state (`open` / `in-progress` / `closed`).
 * @property {string[]} tags    Investigation-level tags (AC11).
 * @property {string} notes     Global investigation notes, verbatim (AC11).
 * @property {WorkspaceNode[]} nodes Indicators / artifacts (deduplicated, AC03).
 * @property {WorkspaceRelationship[]} relationships Typed links with provenance (AC05/AC06).
 * @property {TimelineEvent[]} timeline Significant actions, oldest first (AC15).
 * @property {string} createdAt ISO date.
 * @property {string} updatedAt ISO date of the last change.
 */

export {};


