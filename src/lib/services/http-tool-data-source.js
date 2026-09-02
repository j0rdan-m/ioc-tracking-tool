/**
 * Data source fetching the catalog over HTTP (e.g. `/api/tools.json`), for
 * when the catalog should be editable without rebuilding the app.
 * `fetch` is injected through the options so tests can stub it, honoring the
 * dependency-injection convention for external libraries.
 */
export class HttpToolDataSource {
  /** @type {string} */
  #url;

  /** @type {typeof globalThis.fetch} */
  #fetch;

  /**
   * @param {string} url
   * @param {{ fetch?: typeof globalThis.fetch }} [options]
   */
  constructor(url, options = {}) {
    this.#url = url;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /** @returns {Promise<import('../types.js').ToolCatalog>} */
  async load() {
    const response = await this.#fetch(this.#url);
    if (!response.ok) {
      throw new Error(`HTTP data source: failed to load "${this.#url}" (status ${response.status}).`);
    }
    return /** @type {import('../types.js').ToolCatalog} */ (await response.json());
  }
}
