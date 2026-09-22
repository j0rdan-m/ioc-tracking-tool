<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { extractIocs } from '../utils/extract-iocs.js';
  import { getDeepLinks } from '../utils/deep-links.js';

  /**
   * "Extract IoCs" modal: paste a whole text (log, ticket, e-mail body) and the
   * indicators it contains are detected, refanged, normalized and listed —
   * entirely in the browser, nothing is sent anywhere. Each indicator offers
   * copy actions (raw / normalized / defanged), a Fast analyze hand-off when
   * its type has keyless checks, and "go further" deep links revealed only by
   * an explicit click. The pasted text and the results survive close/reopen so
   * the analyst can edit and re-extract.
   *
   * @type {{ open?: boolean, catalog: import('../types.js').ToolCatalog,
   *          onAnalyze?: (normalized: string) => void }}
   */
  let { open = $bindable(false), catalog, onAnalyze = () => {} } = $props();

  /** @type {import('../services/clipboard.js').ClipboardService} */
  const clipboard = inject(DI_TOKENS.clipboard);
  /** @type {import('../services/fast-analyze.js').FastAnalyzerService} */
  const analyzer = inject(DI_TOKENS.fastAnalyzer);

  let text = $state('');
  /** @type {import('../utils/extract-iocs.js').ExtractIocsResult | null} */
  let result = $state(null);

  /** @type {HTMLTextAreaElement | undefined} */
  let textareaEl = $state();

  /** IoC types the extractor can produce. */
  /** @type {('ip' | 'domain' | 'url' | 'file' | 'email')[]} */
  const EXTRACTED_TYPES = ['ip', 'domain', 'url', 'file', 'email'];

  // Types backed by a keyless check: handing a value over to Fast analyze only
  // makes sense for those (a hash would land on an empty check list).
  const analyzableTypes = $derived(
    new Set(EXTRACTED_TYPES.filter((type) => analyzer.getChecks(type).length > 0)),
  );

  /** Compact list labels; hashes carry their digest kind (MD5 / SHA-1 / SHA-256). */
  const LABELS = { ip: 'IP', domain: 'Domain', url: 'URL', file: 'Hash', email: 'Email' };

  /**
   * @param {import('../types.js').ExtractedIoc} ioc
   * @returns {string}
   */
  function iocLabel(ioc) {
    return ioc.typeId === 'file' && ioc.hashKind ? ioc.hashKind : LABELS[ioc.typeId];
  }

  // "Investigate" rows start collapsed so no external link can be reached
  // without an explicit, deliberate click.
  /** @type {string[]} */
  let expandedIds = $state([]);

  // Deep links of the currently expanded indicators, built on demand.
  const deepLinksById = $derived(
    new Map(
      expandedIds.map((id) => {
        const ioc = result?.iocs.find((entry) => entry.id === id) ?? null;
        return [id, ioc ? getDeepLinks(ioc.typeId, ioc.normalized, catalog.tools) : []];
      }),
    ),
  );

  /** @type {string | null} Last copy outcome, as `<iocId>:<variant>` (or with a `:failed` suffix). */
  let copiedKey = $state(null);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resetTimer;

  /**
   * Copies one variant of an indicator through the injected clipboard service.
   *
   * @param {import('../types.js').ExtractedIoc} ioc
   * @param {'raw' | 'normalized' | 'defanged'} variant
   */
  async function copy(ioc, variant) {
    const key = `${ioc.id}:${variant}`;
    try {
      await clipboard.copy(ioc[variant]);
      copiedKey = key;
    } catch {
      copiedKey = `${key}:failed`;
    } finally {
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (copiedKey = null), 2000);
    }
  }

  function extract() {
    if (text.trim() === '') {
      return;
    }
    result = extractIocs(text);
  }

  function clearAll() {
    text = '';
    result = null;
    expandedIds = [];
  }

  /** @param {string} id */
  function toggleInvestigate(id) {
    expandedIds = expandedIds.includes(id)
      ? expandedIds.filter((entry) => entry !== id)
      : [...expandedIds, id];
  }

  /**
   * Hands the normalized value over to Fast analyze: App closes this modal and
   * opens the other one seeded with it (the value is by construction a valid
   * IoC, so the modal's prefill guard accepts it).
   *
   * @param {import('../types.js').ExtractedIoc} ioc
   */
  function analyze(ioc) {
    open = false;
    onAnalyze(ioc.normalized);
  }

  function close() {
    open = false;
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key === 'Escape') {
      close();
    }
  }

  /** @param {KeyboardEvent} event Ctrl/Cmd+Enter runs the extraction. */
  function onTextareaKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      extract();
    }
  }

  $effect(() => {
    if (!open) {
      return;
    }
    textareaEl?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="modal__backdrop">
    <!-- Full-size dismissal button behind the dialog: an accessible close target. -->
    <button type="button" class="modal__backdrop-button" aria-label="Close" onclick={close}></button>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extract-iocs-title"
      tabindex="-1"
    >
      <header class="modal__head">
        <div>
          <p class="modal__eyebrow">🔍 Extract IoCs</p>
          <h2 id="extract-iocs-title" class="modal__title">Pull indicators out of a pasted text</h2>
        </div>
        <button type="button" class="modal__close" aria-label="Close" onclick={close}>✕</button>
      </header>

      <p class="modal__hint">
        Paste a log, a ticket or an e-mail body: the indicators it contains — defanged or not — are
        detected, refanged and listed. Everything runs in your browser, nothing is sent anywhere.
      </p>

      <form
        class="modal__form"
        onsubmit={(event) => {
          event.preventDefault();
          extract();
        }}
      >
        <textarea
          bind:this={textareaEl}
          bind:value={text}
          class="modal__textarea"
          rows="7"
          placeholder={'176.128.43.70\nexample[.]com\nhxxps://evil[.]example[.]com/login\nuser[@]example[.]com\n44d88612fea8a8f36de82e1278abb02f'}
          aria-label="Text to analyze"
          spellcheck="false"
          onkeydown={onTextareaKeydown}
        ></textarea>
        <div class="modal__form-actions">
          <button type="submit" class="modal__start" disabled={text.trim() === ''}>Extract</button>
          <button type="button" class="modal__clear" onclick={clearAll} disabled={text === '' && !result}>
            Clear
          </button>
        </div>
      </form>

      {#if result?.warning}
        <p class="modal__notice" role="status">{result.warning}</p>
      {/if}

      {#if result}
        {#if result.iocs.length === 0}
          <p class="modal__notice" role="status">No indicator of compromise detected.</p>
        {:else}
          <p class="modal__count" role="status">
            {result.iocs.length}
            IoC{result.iocs.length === 1 ? '' : 's'} detected
          </p>
          <ul class="iocs" aria-label="Extracted indicators">
            {#each result.iocs as ioc (ioc.id)}
              <li class="ioc">
                <div class="ioc__head">
                  <span class="ioc__type">{iocLabel(ioc)}</span>
                  <div class="ioc__actions">
                    {#each [['raw', 'Copy raw'], ['normalized', 'Copy normalized'], ['defanged', 'Copy defanged']] as [variant, label] (variant)}
                      <button
                        type="button"
                        class="ioc__copy"
                        class:ioc__copy--copied={copiedKey === `${ioc.id}:${variant}`}
                        onclick={() => copy(ioc, /** @type {'raw' | 'normalized' | 'defanged'} */ (variant))}
                      >
                        {copiedKey === `${ioc.id}:${variant}`
                          ? 'Copied ✓'
                          : copiedKey === `${ioc.id}:${variant}:failed`
                            ? 'Copy failed'
                            : label}
                      </button>
                    {/each}
                    {#if analyzableTypes.has(ioc.typeId)}
                      <button
                        type="button"
                        class="ioc__analyze"
                        title="Open Fast analyze seeded with the normalized value"
                        onclick={() => analyze(ioc)}
                      >
                        ⚡ Fast analyze
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="ioc__investigate"
                      aria-expanded={expandedIds.includes(ioc.id)}
                      onclick={() => toggleInvestigate(ioc.id)}
                    >
                      🧰 Investigate
                    </button>
                  </div>
                </div>
                <!-- Values are rendered as inert text, never links: nothing opens without an explicit action. -->
                <code class="ioc__value">{ioc.raw}</code>
                {#if ioc.normalized !== ioc.raw}
                  <p class="ioc__normalized">→ <code>{ioc.normalized}</code></p>
                {/if}
                {#if expandedIds.includes(ioc.id)}
                  {@const links = deepLinksById.get(ioc.id) ?? []}
                  {#if links.length > 0}
                    <ul class="gofurther__list" aria-label="Open the indicator in a full tool">
                      {#each links as link (link.toolId)}
                        <li>
                          <a
                            class="gofurther__link"
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span class="gofurther__name">{link.name} ↗</span>
                            <span class="gofurther__hint">{link.hint}</span>
                          </a>
                        </li>
                      {/each}
                    </ul>
                  {:else}
                    <p class="ioc__nolinks">No catalog tool covers this indicator type.</p>
                  {/if}
                {/if}
              </li>
            {/each}

          </ul>
        {/if}
      {/if}

      <p class="modal__foot">
        Extraction runs entirely in this browser: the pasted text is never sent to any API. External
        links only open on an explicit click.
      </p>
    </div>
  </div>
{/if}

<style>
  .modal__backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    padding: 2rem 1rem;
    overflow-y: auto;
    background: rgb(2 8 23 / 0.72);
    backdrop-filter: blur(4px);
  }

  /* Invisible button covering the backdrop so clicking outside the dialog
     is a real, keyboard-reachable close action. */
  .modal__backdrop-button {
    position: absolute;
    inset: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .modal {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    width: min(40rem, 100%);
    margin: auto;
    padding: 1.5rem;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
  }

  .modal__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .modal__eyebrow {
    margin: 0 0 0.15rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-accent);
  }

  .modal__title {
    margin: 0;
    font-size: 1.25rem;
    letter-spacing: -0.01em;
  }

  .modal__close {
    padding: 0.25rem 0.6rem;
    font: inherit;
    font-size: 0.9rem;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    cursor: pointer;
    transition:
      color 0.15s ease,
      border-color 0.15s ease;
  }

  .modal__close:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .modal__hint {
    margin: 0;
    font-size: 0.88rem;
    color: var(--color-text-muted);
  }

  .modal__form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .modal__textarea {
    flex: 1 1 100%;
    min-width: 0;
    padding: 0.65rem 0.9rem;
    font: inherit;
    font-family: var(--font-mono);
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    resize: vertical;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .modal__textarea::placeholder {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .modal__textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px rgb(56 189 248 / 0.18);
  }

  .modal__form-actions {
    display: flex;
    flex: 1 1 100%;
    justify-content: flex-end;
    gap: 0.6rem;
  }

  .modal__start,
  .modal__clear {
    padding: 0.55rem 1.4rem;
    font: inherit;
    font-weight: 600;
    border-radius: 10px;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease;
  }

  .modal__start {
    color: #08131f;
    background: var(--color-accent);
    border: none;
  }

  .modal__start:hover:not(:disabled) {
    background: var(--color-accent-strong);
  }

  .modal__start:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .modal__clear {
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
  }

  .modal__clear:hover:not(:disabled) {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .modal__clear:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .modal__count,
  .modal__notice {
    margin: 0;
    font-size: 0.88rem;
    color: var(--color-text);
  }

  .iocs {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ioc {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.75rem 0.9rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
  }

  .ioc__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .ioc__type {
    padding: 0.1rem 0.6rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-accent);
    background: rgb(56 189 248 / 0.12);
    border-radius: 999px;
  }

  .ioc__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .ioc__copy,
  .ioc__analyze,
  .ioc__investigate {
    padding: 0.25rem 0.7rem;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    border-radius: 999px;
    cursor: pointer;
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      background-color 0.15s ease;
  }

  .ioc__copy {
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
  }

  .ioc__copy:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .ioc__copy--copied {
    color: var(--color-success);
    border-color: var(--color-success);
  }

  .ioc__analyze {
    color: #08131f;
    background: var(--color-accent);
    border: none;
  }

  .ioc__analyze:hover {
    background: var(--color-accent-strong);
  }

  .ioc__investigate {
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
  }

  .ioc__investigate:hover,
  .ioc__investigate[aria-expanded='true'] {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .ioc__value {
    font-family: var(--font-mono);
    font-size: 0.88rem;
    word-break: break-all;
  }

  .ioc__normalized {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--color-text-muted);
    word-break: break-all;
  }

  .ioc__normalized code {
    color: var(--color-text);
  }

  .ioc__nolinks {
    margin: 0;
    font-size: 0.82rem;
    color: var(--color-text-muted);
  }

  .gofurther__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: 0.5rem;
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
  }

  .gofurther__link {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    height: 100%;
    padding: 0.55rem 0.75rem;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    text-decoration: none;
    transition: border-color 0.15s ease;
  }

  .gofurther__link:hover {
    border-color: var(--color-accent);
  }

  .gofurther__name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-accent);
  }

  .gofurther__hint {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .modal__foot {
    margin: 0.25rem 0 0;
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }
</style>


