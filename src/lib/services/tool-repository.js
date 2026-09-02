/**
 * Read-side repository over the tool catalog.
 *
 * The data source is injected, so the storage can vary (bundled JSON, HTTP
 * API, in-memory fixture in tests) without touching consumers.
 */
export class ToolRepository {
  /** @type {{ load(): Promise<import('../types.js').ToolCatalog> }} */
  #dataSource;

  /** @param {{ load(): Promise<import('../types.js').ToolCatalog> }} dataSource */
  constructor(dataSource) {
    this.#dataSource = dataSource;
  }

  /** @returns {Promise<import('../types.js').ToolCatalog>} */
  getCatalog() {
    return this.#dataSource.load();
  }
}
