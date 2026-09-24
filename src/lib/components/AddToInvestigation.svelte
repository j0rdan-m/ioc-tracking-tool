<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { addIndicatorsToInvestigation } from '../services/workspace/intake.js';
  import { createInvestigation } from '../services/workspace/investigation-model.js';
  import { normalizeTag } from '../utils/history-filter.js';

  /** @type {{ open?: boolean, indicators: import('../types.js').WorkspaceIndicatorInput[],
   *           source?: import('../types.js').InvestigationSource,
   *           title?: string, onClose?: () => void }} */
  let { open = $bindable(false), indicators = [], source = 'manual', title = 'Add to investigation', onClose = () => {} } = $props();
  const repository = inject(DI_TOKENS.investigationWorkspace);
  let investigations = $state([]);
  let selectedId = $state('');
  let newName = $state('');
  let newDescription = $state('');
  let newTags = $state('');
  let createNew = $state(false);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state('');
  let feedback = $state('');

  async function refresh() {
    loading = true;
    try {
      investigations = await repository.list();
      if (!selectedId && investigations.length > 0) selectedId = investigations[0].id;
      if (investigations.length === 0) createNew = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load investigations.';
    } finally {
      loading = false;
    }
  }

  function close() {
    open = false;
    selectedId = '';
    newName = '';
    newDescription = '';
    newTags = '';
    createNew = false;
    error = '';
    feedback = '';
    onClose();
  }

  async function saveTo(investigation) {
    const next = addIndicatorsToInvestigation(investigation, indicators, { source });
    await repository.save(next);
    feedback = `Added ${indicators.length} indicator(s) to ${investigation.name}.`;
    close();
  }

  async function addExisting() {
    const investigation = investigations.find((entry) => entry.id === selectedId);
    if (!investigation || saving) return;
    saving = true;
    error = '';
    try { await saveTo(investigation); } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not add indicators to the investigation.';
    } finally { saving = false; }
  }

  async function createAndAdd() {
    if (newName.trim() === '' || saving) return;
    saving = true;
    error = '';
    try {
      const tags = newTags.split(/[\s,]+/).map(normalizeTag).filter(Boolean);
      const investigation = createInvestigation({ name: newName, description: newDescription, tags });
      await saveTo(investigation);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not create the investigation.';
    } finally { saving = false; }
  }

  $effect(() => { if (open) { void refresh(); } });
</script>

{#if open}
  <section class="intake" aria-label={title}>
    <header class="intake__head">
      <div><strong>{title}</strong><small>{indicators.length} indicator(s) selected</small></div>
      <button type="button" aria-label="Close add to investigation" onclick={close}>✕</button>
    </header>
    {#if loading}
      <p class="intake__status">Loading local investigations…</p>
    {:else if !createNew}
      <label class="intake__field"><span>Investigation</span>
        <select bind:value={selectedId}>
          {#each investigations as investigation (investigation.id)}
            <option value={investigation.id}>{investigation.name} · {investigation.nodes.length} IoCs</option>
          {/each}
        </select>
      </label>
      <div class="intake__actions">
        <button type="button" class="intake__secondary" onclick={() => (createNew = true)}>+ Create new</button>
        <button type="button" class="intake__primary" disabled={saving || !selectedId} onclick={addExisting}>{saving ? 'Adding…' : 'Add selected'}</button>
      </div>
    {:else}
      <label class="intake__field"><span>Name</span><input bind:value={newName} placeholder="Investigation name" required /></label>
      <label class="intake__field"><span>Description</span><textarea bind:value={newDescription} rows="2"></textarea></label>


      <label class="intake__field"><span>Tags</span><input bind:value={newTags} placeholder="phishing customer incident" /></label>
      <div class="intake__actions">
        {#if investigations.length > 0}<button type="button" class="intake__secondary" onclick={() => (createNew = false)}>Cancel</button>{/if}
        <button type="button" class="intake__primary" disabled={saving || newName.trim() === ''} onclick={createAndAdd}>{saving ? 'Creating…' : 'Create and add'}</button>
      </div>
    {/if}
    {#if feedback}<p class="intake__feedback" role="status">{feedback}</p>{/if}
    {#if error}<p class="intake__error" role="alert">{error}</p>{/if}
    <p class="intake__notice">Indicators are stored locally in this browser. No provider or backend is contacted.</p>
  </section>
{/if}

<style>
  .intake { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3); color: var(--color-text); background: var(--color-surface-raised); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); }
  .intake__head, .intake__actions { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .intake__head > div { display: flex; flex-direction: column; gap: var(--space-1); }
  .intake__head small, .intake__notice, .intake__status { color: var(--color-text-muted); font-size: var(--font-size-xs); }
  .intake__head button, .intake__actions button { padding: var(--space-2) var(--space-3); font: inherit; font-size: var(--font-size-sm); color: var(--color-text-muted); background: transparent; border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; }
  .intake__field { display: flex; flex-direction: column; gap: var(--space-1); color: var(--color-text-muted); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
  .intake input, .intake select, .intake textarea { padding: var(--space-2) var(--space-3); font: inherit; color: var(--color-text); background: var(--color-surface-sunken); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); }
  .intake__actions { justify-content: flex-end; }
  .intake__primary { color: var(--color-accent-contrast) !important; background: var(--color-accent) !important; }
  .intake__feedback { margin: 0; color: var(--color-success); font-size: var(--font-size-xs); }
  .intake__error { margin: 0; color: var(--color-danger); font-size: var(--font-size-xs); }
  .intake__notice { margin: 0; }
  button:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
</style>

