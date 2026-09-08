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

export {};

