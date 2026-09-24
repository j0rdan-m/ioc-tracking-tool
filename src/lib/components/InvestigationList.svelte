<script>
  import { formatTimestamp } from '../utils/format-timestamp.js';
  import { filterWorkspaceList, investigationStats, STATUS_LABELS } from '../utils/workspace-view.js';
  import { normalizeTag } from '../utils/history-filter.js';

  /**
   * Searchable list of locally stored V2 investigations plus the small creation
   * form. Search covers name, description, tags, notes and contained IoCs.
   *
   * @type {{ investigations: import('../types.js').WorkspaceInvestigation[], loading: boolean,
   *           onOpen: (id: string) => void,
   *           onCreate: (input: { name: string, description?: string, tags?: string[] }) => Promise<void> }}
   */
  let { investigations, loading, onOpen, onCreate } = $props();

  let query = $state('');
  let showCreate = $state(false);
  let name = $state('');
  let description = $state('');
  let tagsDraft = $state('');
  let saving = $state(false);
  let error = $state('');

  const filtered = $derived(filterWorkspaceList(investigations, query));

  async function submit() {
    if (name.trim() === '' || saving) return;
    saving = true;
    error = '';
    try {
      const tags = tagsDraft
        .split(/[\s,]+/)
        .map((tag) => normalizeTag(tag))
        .filter((tag) => tag !== '');
      await onCreate({ name, description, tags });
      name = '';
      description = '';
      tagsDraft = '';
      showCreate = false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not create the investigation.';
    } finally {
      saving = false;
    }
  }
</script>

<div class="list">
  <div class="list__bar">
    <input class="list__search" type="search" bind:value={query}
      placeholder="Search name, tags, notes or IoCs…" aria-label="Search investigations" />
    <button type="button" class="list__create" onclick={() => (showCreate = !showCreate)}>
      {showCreate ? 'Cancel' : '+ Create investigation'}
    </button>
  </div>

  {#if showCreate}
    <form class="create" onsubmit={(event) => { event.preventDefault(); submit(); }}>
      <label class="create__field"><span>Name</span>
        <input bind:value={name} required placeholder="Suspicious customer email — September 2026" />
      </label>
      <label class="create__field"><span>Description</span>
        <textarea bind:value={description} rows="3"
          placeholder="Context, customer, symptoms, next steps…"></textarea>
      </label>
      <label class="create__field"><span>Tags</span>
        <input bind:value={tagsDraft} placeholder="phishing customer email" />
      </label>
      {#if error}<p class="create__error" role="alert">{error}</p>{/if}
      <button type="submit" class="list__create" disabled={name.trim() === '' || saving}>
        {saving ? 'Creating…' : 'Create investigation'}
      </button>
    </form>
  {/if}

  {#if loading}
    <p class="list__empty" role="status">Loading local investigations…</p>
  {:else if filtered.length === 0}
    <p class="list__empty">
      {investigations.length === 0
        ? 'No investigation yet. Create one to group its indicators and relationships.'
        : 'No investigation matches this search.'}
    </p>
  {:else}
    <p class="list__count">{filtered.length} investigation(s)</p>
    <div class="list__items">
      {#each filtered as investigation (investigation.id)}
        {@const stats = investigationStats(investigation)}
        <button type="button" class="card" onclick={() => onOpen(investigation.id)}>
          <span class="card__head">
            <strong>{investigation.name}</strong>
            <span class="card__status">{STATUS_LABELS[investigation.status]}</span>
          </span>
          {#if investigation.description}<span class="card__description">{investigation.description}</span>{/if}
          {#if investigation.tags.length > 0}<span class="card__tags">{investigation.tags.join(' · ')}</span>{/if}
          <span class="card__stats">
            {stats.indicators} IoCs · {stats.relationships} relationships · Updated
            {formatTimestamp(investigation.updatedAt)} UTC
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .list,
  .create {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .list {
    min-height: 18rem;
  }

  .list__bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .list__search,
  .create input,
  .create textarea {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-sunken);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .list__search {
    flex: 1 1 16rem;
    width: auto;
  }

  .list__search:focus,
  .create input:focus,
  .create textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-focus);
  }

  .list__create,
  .card {
    font: inherit;
    cursor: pointer;
  }

  .list__create {
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: var(--border-width-strong) solid var(--color-accent);
    border-radius: var(--radius-pill);
  }

  .list__create:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
  }

  .create {
    padding: var(--space-4);
    background: var(--color-accent-veil);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
  }

  .create__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-muted);
  }

  .create__field textarea {
    resize: vertical;
  }

  .create__error {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-xs);
  }

  .list__empty,
  .list__count {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .list__count {
    font-weight: var(--font-weight-semibold);
  }

  .list__items {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-3);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    text-align: left;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-card);
    transition: var(--transition-colors);
  }

  .card:hover {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  .card__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .card__status {
    padding: var(--pill-padding-y) var(--space-2);
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    background: var(--color-accent-soft);
    border-radius: var(--radius-pill);
  }

  .card__description,
  .card__tags,
  .card__stats {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .card__description {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .card__tags {
    color: var(--color-brand);
    font-family: var(--font-mono);
  }

  .card__stats {
    padding-top: var(--space-2);
    border-top: var(--border-width) solid var(--color-border-subtle);
  }
</style>
