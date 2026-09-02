<script>
  /**
   * IoC type filter pills with per-type tool counts.
   *
   * @type {{ iocTypes: import('../types.js').IocType[], selectedId?: string,
   *          countByIocType: Map<string, number> }}
   */
  let { iocTypes, selectedId = $bindable('all'), countByIocType } = $props();
</script>

<div class="filters" role="group" aria-label="Filter tools by IoC type">
  <button
    type="button"
    class="filter"
    class:filter--active={selectedId === 'all'}
    onclick={() => (selectedId = 'all')}
  >
    All
    <span class="filter__count">{countByIocType.get('all') ?? 0}</span>
  </button>
  {#each iocTypes as iocType (iocType.id)}
    <button
      type="button"
      class="filter"
      class:filter--active={selectedId === iocType.id}
      onclick={() => (selectedId = iocType.id)}
    >
      {iocType.label}
      <span class="filter__count">{countByIocType.get(iocType.id) ?? 0}</span>
    </button>
  {/each}
</div>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .filter {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.4rem 0.85rem;
    font: inherit;
    font-size: 0.86rem;
    font-weight: 500;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    cursor: pointer;
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      background-color 0.15s ease;
  }

  .filter:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .filter--active {
    color: var(--color-accent);
    background: rgb(56 189 248 / 0.12);
    border-color: var(--color-accent);
  }

  .filter__count {
    padding: 0.05rem 0.45rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--color-text-muted);
    background: rgb(148 163 184 / 0.12);
    border-radius: 999px;
  }

  .filter--active .filter__count {
    color: var(--color-accent);
    background: rgb(56 189 248 / 0.16);
  }
</style>
