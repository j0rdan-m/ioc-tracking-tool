/**
 * Copies text to the clipboard.
 *
 * Browser globals are injected (with sensible defaults) so the service stays
 * testable and can degrade gracefully outside secure contexts.
 */
export class ClipboardService {
  /** @type {{ writeText(text: string): Promise<void> } | undefined} */
  #clipboard;

  /** @type {Document | undefined} */
  #document;

  /**
   * @param {{ writeText(text: string): Promise<void> }} [clipboard]
   * @param {Document} [documentRef]
   */
  constructor(clipboard = globalThis.navigator?.clipboard, documentRef = globalThis.document) {
    this.#clipboard = clipboard;
    this.#document = documentRef;
  }

  /** @param {string} text */
  async copy(text) {
    if (this.#clipboard) {
      await this.#clipboard.writeText(text);
      return;
    }
    this.#copyWithLegacyFallback(text);
  }

  /** @param {string} text */
  #copyWithLegacyFallback(text) {
    if (!this.#document) {
      throw new Error('ClipboardService: no clipboard API and no document to fall back on.');
    }
    const textarea = this.#document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    this.#document.body.appendChild(textarea);
    textarea.select();
    try {
      if (!this.#document.execCommand('copy')) {
        throw new Error('ClipboardService: legacy copy command failed.');
      }
    } finally {
      textarea.remove();
    }
  }
}
