<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { createInvestigation } from '../services/workspace/investigation-model.js';
  import InvestigationList from './InvestigationList.svelte';
  import InvestigationWorkspace from './InvestigationWorkspace.svelte';

  /**
   * Entry point of the local V2 workspace. The modal owns repository loading and
   * selection; the workspace components only mutate the investigation object and
   * hand the resulting immutable value back for persistence.
   *
   * @type {{ open?: boolean, catalog: import('../types.js').ToolCatalog,
   *           onAnalyze?: (normalized: string) => void }}
   */
  let { open = $bindable(false), catalog, onAnalyze = () => {} } = $props();

  /** @type {import('../services/workspace/investigation-repository.js').InvestigationRepository} */
  const repository = inject(DI_TOKENS.investigationWorkspace);
  const importer = inject(DI_TOKENS.investigationImport);
  let importInput = $state(/** @type {HTMLInputElement | undefined} */ (undefined));

  async function handleImport(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const parsed = importer.parse(await file.text());
      const saved = await repository.save(parsed.investigation);
      investigations = await repository.list();
      selectedId = saved.id;
      flash(`Imported ${saved.name} locally ✓`);
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : 'Could not import the investigation.');
    } finally {
      if (importInput) importInput.value = '';
    }
  }

  /** @type {import('../types.js').WorkspaceInvestigation[]} */
  let investigations = $state([]);
  /** @type {string | null} */
  let selectedId = $state(null);
  let loading = $state(true);
  let feedback = $state('');
  let unsubscribe = () => {};

  const selected = $derived(
    selectedId === null ? null : investigations.find((entry) => entry.id === selectedId) ?? null,
  );

  /** @param {string} message */
  function flash(message) {
    feedback = message;
  }

  async function refresh() {
    investigations = await repository.list();
    if (selectedId !== null && !investigations.some((entry) => entry.id === selectedId)) {
      selectedId = null;
    }
  }

  /**
   * @param {{ name: string, description?: string, tags?: string[] }} input
   */
  async function create(input) {
    const investigation = await repository.save(createInvestigation(input));
    selectedId = investigation.id;
    flash('Investigation created and stored locally ✓');
  }

  /**
   * @param {import('../types.js').WorkspaceInvestigation} investigation
   */
  async function save(investigation) {
    await repository.save(investigation);
  }

  /** @param {string} normalized */
  function analyze(normalized) {
    open = false;
    onAnalyze(normalized);
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key === 'Escape' && open) {
      open = false;
    }
  }

  $effect(() => {
    unsubscribe = repository.subscribe(refresh);
    return () => unsubscribe();
  });

  $effect(() => {
    if (!open) return;
    refresh();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="modal__backdrop">
    <button
      type="button"
      class="modal__backdrop-button"
      aria-label="Close"
      onclick={() => (open = false)}
    ></button>
    <div
      class="modal modal--lg workspace-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-title"
      tabindex="-1"
    >
      <header class="modal__head">
        <div>
          <p class="modal__eyebrow">🕸 Investigation workspace</p>
          <h2 id="workspace-title" class="modal__title">Local investigation graph</h2>
        </div>
        <button type="button" class="modal__close" aria-label="Close" onclick={() => (open = false)}>
          ✕
        </button>
      </header>

      <p class="modal__hint">
        Investigations, notes and graph positions are stored in this browser only. Graph pivots are
        explicit: opening a suspicious URL or domain never happens automatically.
      </p>

      {#if feedback}
        <p class="workspace-modal__feedback" role="status">{feedback}</p>
      {/if}
      <div class="workspace-import">
        <button type="button" onclick={() => importInput?.click()}>⬆ Import JSON</button>
        <input bind:this={importInput} type="file" accept="application/json,.json" onchange={handleImport} aria-label="Import investigation JSON" />
        <span>Local JSON only — no upload.</span>
      </div>

      {#if selected}
        <InvestigationWorkspace
          investigation={selected}
          {catalog}
          onBack={() => {
            selectedId = null;
            feedback = '';
          }}
          onSave={save}
          onAnalyze={analyze}
        />
      {:else}
        <InvestigationList
          investigations={investigations}
          {loading}
          onOpen={(id) => (selectedId = id)}
          onCreate={create}
        />
      {/if}
    </div>
  </div>
{/if}

<style>
  .workspace-modal {
    max-height: min(90vh, 62rem);
  }

  .workspace-modal__feedback {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--color-success);
    font-size: var(--font-size-xs);
    background: var(--color-success-soft);
    border: var(--border-width) solid var(--color-success-border);
    border-radius: var(--radius-md);
  }

  .workspace-import {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .workspace-import button {
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .workspace-import input { display: none; }
</style>