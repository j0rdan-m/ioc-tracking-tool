/**
 * Local file download: turns generated export content into a `Blob` and saves
 * it through an invisible anchor. No network, no backend — the file is built
 * entirely in the browser (AC05).
 *
 * Browser globals are injected (with sensible defaults) so the service stays
 * testable, mirroring `ClipboardService`.
 *
 * @typedef {Object} DownloadServiceDeps
 * @property {typeof Blob} [blob]
 * @property {{ createObjectURL(blob: Blob): string, revokeObjectURL(url: string): void }} [urls]
 * @property {Document | undefined} [documentRef]
 */
export class DownloadService {
  /** @type {typeof Blob} */
  #blob;

  /** @type {{ createObjectURL(blob: Blob): string, revokeObjectURL(url: string): void }} */
  #urls;

  /** @type {Document | undefined} */
  #document;

  /** @param {DownloadServiceDeps} [deps] */
  constructor(deps = {}) {
    this.#blob = deps.blob ?? globalThis.Blob;
    this.#urls = deps.urls ?? globalThis.URL;
    this.#document = deps.documentRef ?? globalThis.document;
  }

  /**
   * @param {string} filename Local filename (see `buildExportFilename`).
   * @param {string} content File content.
   * @param {string} mimeType e.g. `text/markdown;charset=utf-8`.
   */
  save(filename, content, mimeType) {
    if (!this.#document) {
      throw new Error('DownloadService: no document to download from.');
    }
    const blob = new this.#blob([content], { type: mimeType });
    const url = this.#urls.createObjectURL(blob);
    const anchor = this.#document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    this.#document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    this.#urls.revokeObjectURL(url);
  }
}
