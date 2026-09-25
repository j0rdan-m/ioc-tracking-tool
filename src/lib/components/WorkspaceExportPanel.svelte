<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { exportWorkspaceInvestigation } from '../services/export/workspace-exporter.js';

  /** @type {{ investigation: import('../types.js').WorkspaceInvestigation,
   *           title?: string, onExported?: (format: string) => void }} */
  let { investigation, title = 'Export investigation', onExported = () => {} } = $props();
  const clipboard = inject(DI_TOKENS.clipboard);
  const download = inject(DI_TOKENS.download);
  let format = $state(/** @type {'markdown' | 'json' | 'csv'} */ ('markdown'));
  let includeAnalysis = $state(true);
  let includeNotes = $state(true);
  let includeTags = $state(true);
  let includeRelationships = $state(true);
  let includeTimeline = $state(true);
  let includeRaw = $state(false);
  let previewOpen = $state(false);
  let feedback = $state('');
  let feedbackTimer;

  const options = $derived({
    includeAnalysis,
    includeNotes,
    includeTags,
    includeRelationships,
    includeTimeline,
    includeRaw: format === 'json' && includeRaw,
  });
  const result = $derived(exportWorkspaceInvestigation(investigation, format, options));
  const markdown = $derived(exportWorkspaceInvestigation(investigation, 'markdown', options));

  function flash(message) {
    feedback = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = ''), 2600);
  }
  function downloadFile() {
    try {
      download.save(result.filename, result.content, result.mimeType);
      onExported(format);
      flash(`Downloaded ${result.filename}`);
    } catch { flash('Download failed'); }
  }
  async function copyMarkdown() {
    try {
      await clipboard.copy(markdown.content);
      onExported('markdown');
      flash('Markdown copied ✓');
    } catch { flash('Copy failed'); }
  }
</script>

<section class="workspace-export" aria-label={title}>
  <h4 class="workspace-export__title">{title}</h4>
  <div class="workspace-export__formats" role="group" aria-label="Workspace export format">
    {#each [['markdown', 'Markdown'], ['json', 'JSON'], ['csv', 'CSV']] as [value, label] (value)}
      <button type="button" class="workspace-export__format" class:workspace-export__format--active={format === value} aria-pressed={format === value} onclick={() => (format = /** @type {'markdown' | 'json' | 'csv'} */ (value))}>{label}</button>
    {/each}
  </div>
  <fieldset class="workspace-export__options">
    <legend>Export options</legend>
    <label><input type="checkbox" bind:checked={includeAnalysis} /> Analysis results</label>
    <label><input type="checkbox" bind:checked={includeNotes} /> Analyst notes</label>
    <label><input type="checkbox" bind:checked={includeTags} /> Tags</label>
    <label><input type="checkbox" bind:checked={includeRelationships} /> Relationships and evidence</label>
    <label><input type="checkbox" bind:checked={includeTimeline} /> Timeline</label>
    {#if format === 'json'}
      <label><input type="checkbox" bind:checked={includeRaw} /> Raw provider responses</label>
    {/if}
  </fieldset>
  {#if feedback}<p class="workspace-export__feedback" role="status">{feedback}</p>{/if}
  {#if format === 'markdown'}
    <div class="workspace-export__actions">
      <button type="button" aria-expanded={previewOpen} onclick={() => (previewOpen = !previewOpen)}>{previewOpen ? 'Hide preview' : 'Preview export'}</button>
      <button type="button" onclick={copyMarkdown}>Copy Markdown</button>
    </div>
    {#if previewOpen}<pre class="workspace-export__preview">{markdown.content}</pre>{/if}
  {/if}
  <div class="workspace-export__actions">
    <button type="button" class="workspace-export__primary" onclick={downloadFile}>Download</button>
    <code>{result.filename}</code>
  </div>
  <p class="workspace-export__notice">Exports may contain investigation data, relationships and analyst notes. Review the file before sharing it.</p>
</section>


<style>
  .workspace-export { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); background: var(--color-surface-raised); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); }
  .workspace-export__title, .workspace-export__notice, .workspace-export__feedback, .workspace-export__preview { margin: 0; }
  .workspace-export__title { font-size: var(--font-size-base); }
  .workspace-export__formats, .workspace-export__actions, .workspace-export__options { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
  .workspace-export__options { margin: 0; padding: 0; border: 0; }
  .workspace-export__options legend { margin-bottom: var(--space-1); font-size: var(--font-size-2xs); font-weight: var(--font-weight-semibold); color: var(--color-text-muted); }
  .workspace-export__options label { display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--font-size-sm); }
  .workspace-export__options input { accent-color: var(--color-accent); }
  .workspace-export__format, .workspace-export__actions button { padding: var(--space-2) var(--space-3); font: inherit; font-size: var(--font-size-sm); color: var(--color-text-muted); background: transparent; border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; }
  .workspace-export__format--active, .workspace-export__primary { color: var(--color-accent-contrast) !important; background: var(--color-accent) !important; }
  .workspace-export__actions code { align-self: center; color: var(--color-text-muted); font-size: var(--font-size-xs); overflow-wrap: anywhere; }
  .workspace-export__feedback { color: var(--color-success); font-size: var(--font-size-xs); }
  .workspace-export__preview { max-height: 18rem; overflow: auto; padding: var(--space-3); color: var(--color-text); background: var(--color-surface-sunken); font-family: var(--font-mono); font-size: var(--font-size-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
  .workspace-export__notice { color: var(--color-text-muted); font-size: var(--font-size-2xs); }
</style>
