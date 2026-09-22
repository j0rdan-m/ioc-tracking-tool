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
 * Outcome of a single fast-analyze check against one provider.
 *
 * @typedef {Object} FastCheckResult
 * @property {'ok' | 'empty' | 'error'} status Outcome of the check.
 * @property {string | null} summary    One-line takeaway shown under the title.
 * @property {FastCheckField[]} fields  Key facts extracted from the response.
 * @property {string | null} message    Human-readable detail for empty/error.
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
 */

export {};

