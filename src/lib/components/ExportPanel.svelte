<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { exportInvestigation } from '../services/export/investigation-exporter.js';

  /**
   * Shared export workflow (US V1.5): choose a format, choose the content,
   * then download the file or copy the Markdown. The caller hands over the
   * investigations to export (history entries or session-only data) and the
   * catalog; everything else — model, formatting, generation date — is built
   * locally when the user acts, never before.
   *
   * @type {{ investigations: import('../types.js').ExportInput[],
   *          catalog: import('../types.js').ToolCatalog, title?: string }}
   */
  let { investigations, catalog, title = 'Export investigation' } = $props();

  /** @type {import('../services/clipboard.js').ClipboardService} */
  const clipboard = inject(DI_TOKENS.clipboard);
  /** @type {import('../services/download.js').DownloadService} */
  const download = inject(DI_TOKENS.download);

  let format = $state(/** @type {'markdown' | 'json' | 'csv'} */ ('markdown'));
  let includeAnalysis = $state(true);
  let includeNotes = $state(true);
  let includeTags = $state(true);
  let includeLinks = $state(true);
  let includeRaw = $state(false);
  let previewOpen = $state(false);
  /** @type {string | null} */
  let feedback = $state(null);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let feedbackTimer;

  /** @param {string} message */
  function flash(message) {
    feedback = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2500);
  }

  const options = $derived({
    includeAnalysis,
    includeNotes,
    includeTags,
    includeLinks,
    includeRaw: format === 'json' && includeRaw,
    tools: catalog.tools,
  });
  const result = $derived(
    // The filename and the generation date stay stable while the panel is
    // open: they are derived from the investigations, the format and the
    // content options, not from the wall clock of every render.
    exportInvestigation(investigations, format, options),
  );
  const markdown = $derived(exportInvestigation(investigations, 'markdown', options));

  function downloadFile() {
    try {
      download.save(result.filename, result.content, result.mimeType);
      flash(`Downloaded ${result.filename}`);
    } catch {
      flash('Download failed');
    }
  }

  async function copyMarkdown() {
    try {
      await clipboard.copy(markdown.content);
      flash('Markdown copied ✓');
    } catch {
      flash('Copy failed');
    }
  }
</script>

<section class="export" aria-label={title}>
  <h4 class="export__title">{title}</h4>

  <div class="export__formats" role="group" aria-label="Export format">
    {#each [['markdown', 'Markdown'], ['json', 'JSON'], ['csv', 'CSV']] as [value, label] (value)}
      <button
        type="button"
        class="export__format"
        class:export__format--active={format === value}
        aria-pressed={format === value}
        onclick={() => (format = /** @type {'markdown' | 'json' | 'csv'} */ (value))}
      >
        {label}
      </button>
    {/each}
  </div>

  <fieldset class="export__options">
    <legend class="export__legend">Export options</legend>
    <label class="export__option">
      <input type="checkbox" bind:checked={includeAnalysis} />
      Analysis results
    </label>
    <label class="export__option">
      <input type="checkbox" bind:checked={includeNotes} />
      Analyst notes
    </label>
    <label class="export__option">
      <input type="checkbox" bind:checked={includeTags} />
      Tags
    </label>
    <label class="export__option">
      <input type="checkbox" bind:checked={includeLinks} />
      External investigation links
    </label>
    {#if format === 'json'}
      <label class="export__option">
        <input type="checkbox" bind:checked={includeRaw} />
        Raw provider responses
      </label>
    {/if}
  </fieldset>

  {#if feedback}
    <p class="export__feedback" role="status">{feedback}</p>
  {/if}

  {#if format === 'markdown'}
    <div class="export__actions">
      <button
        type="button"
        class="export__secondary"
        aria-expanded={previewOpen}
        onclick={() => (previewOpen = !previewOpen)}
      >
        {previewOpen ? 'Hide preview' : 'Preview export'}
      </button>
      <button type="button" class="export__secondary" onclick={copyMarkdown}>Copy Markdown</button>
    </div>
    {#if previewOpen}
      <pre class="export__preview">{markdown.content}</pre>
    {/if}
  {/if}

  <div class="export__actions">
    <button
      type="button"
      class="export__primary"
      disabled={investigations.length === 0}
      onclick={downloadFile}
    >
      Download
    </button>
    <span class="export__filename"><code>{result.filename}</code></span>
  </div>

  <p class="export__notice">
    Exports may contain investigation data and analyst notes. Review the file before sharing it.
  </p>
</section>

<style>
  .export {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .export__title {
    margin: 0;
    font-size: var(--font-size-base);
  }

  .export__formats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .export__format {
    padding: var(--space-2) var(--space-4);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .export__format:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .export__format--active {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border-color: var(--color-accent);
  }

  .export__options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: 0;
    border: none;
  }

  .export__legend {
    margin-bottom: var(--space-2);
    padding: 0;
    font-size: var(--font-size-2xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-wide);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .export__option {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .export__option input {
    accent-color: var(--color-accent);
  }

  .export__feedback {
    margin: 0;
    align-self: flex-start;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--color-success);
    background: var(--color-success-soft);
    border-radius: var(--radius-pill);
  }

  .export__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .export__primary,
  .export__secondary {
    padding: var(--space-2) var(--space-4);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .export__primary {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: none;
  }

  .export__primary:hover:not(:disabled) {
    background: var(--color-accent-strong);
  }

  .export__primary:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
  }

  .export__secondary {
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
  }

  .export__secondary:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .export__filename {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    word-break: break-all;
  }

  .export__preview {
    max-height: 18rem;
    overflow: auto;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--color-text);
    background: var(--color-surface-sunken);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .export__notice {
    margin: 0;
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }
</style>
