/**
 * Data source serving a catalog bundled at build time (static JSON import).
 * Receiving the catalog through the constructor keeps it fully injectable
 * and trivially testable.
 */
export class StaticToolDataSource {
  /** @type {import('../types.js').ToolCatalog} */
  #catalog;

  /** @param {import('../types.js').ToolCatalog} catalog */
  constructor(catalog) {
    this.#catalog = catalog;
  }

  /** @returns {Promise<import('../types.js').ToolCatalog>} */
  async load() {
    return this.#catalog;
  }
}
