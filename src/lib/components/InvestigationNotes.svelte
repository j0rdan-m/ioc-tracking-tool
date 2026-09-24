<script>
  import { setInvestigationNotes } from '../services/workspace/investigation-model.js';
  import { formatTimestamp } from '../utils/format-timestamp.js';

  /**
   * @type {{ investigation: import('../types.js').WorkspaceInvestigation,
   *           onSave: (next: import('../types.js').WorkspaceInvestigation) => Promise<void> }}
   */
  let { investigation, onSave } = $props();

  let draft = $state('');
  let savedAt = $state('');
  let saving = $state(false);

  $effect(() => {
    draft = investigation.notes;
  });

  async function save() {
    if (saving) return;
    saving = true;
    try {
      await onSave(setInvestigationNotes(investigation, draft));
      savedAt = new Date().toISOString();
    } finally {
      saving = false;
    }
  }
</script>

<section class="notes" aria-labelledby="investigation-notes-heading">
  <div>
    <h3 id="investigation-notes-heading">Investigation notes</h3>
    <p>Stored verbatim and locally. Line breaks are preserved on export.</p>
  </div>
  <textarea
    bind:value={draft}
    rows="14"
    placeholder="Campaign context, hypotheses, correlations, next steps…"
    aria-label="Investigation notes"
  ></textarea>
  <div class="notes__actions">
    <button type="button" onclick={save} disabled={saving || draft === investigation.notes}>
      {saving ? 'Saving…' : 'Save notes'}
    </button>
    {#if savedAt}<span>Saved {formatTimestamp(savedAt)} UTC</span>{/if}
  </div>
</section>

<style>
  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .notes h3,
  .notes p {
    margin: 0;
  }

  .notes p,
  .notes__actions span {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  textarea {
    width: 100%;
    padding: var(--space-3);
    resize: vertical;
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-sunken);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-focus);
  }

  .notes__actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  button {
    padding: var(--space-2) var(--space-4);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: var(--border-width-strong) solid var(--color-accent);
    border-radius: var(--radius-pill);
    cursor: pointer;
  }

  button:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
  }
</style>