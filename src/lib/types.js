/**
 * Shared data contracts for the tool catalog.
 *
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
 * @property {string} description What the tool does and when to use it.
 * @property {string[]} tags      Free-form keywords consumed by the search.
 */

/**
 * @typedef {Object} ToolCatalog
 * @property {string} version     Catalog schema version.
 * @property {string} updatedAt   ISO date of the last manual update.
 * @property {ToolCategory[]} categories
 * @property {Tool[]} tools
 */

export {};
