<script>
  /**
   * Category filter pills with per-category tool counts.
   *
   * @type {{ categories: import('../types.js').ToolCategory[], selectedId?: string,
   *          countByCategory: Map<string, number> }}
   */
  let { categories, selectedId = $bindable('all'), countByCategory } = $props();
</script>

<div class="filters" role="group" aria-label="Filter tools by category">
  <button
    type="button"
    class="filter"
    class:filter--active={selectedId === 'all'}
    onclick={() => (selectedId = 'all')}
  >
    All
    <span class="filter__count">{countByCategory.get('all') ?? 0}</span>
  </button>
  {#each categories as category (category.id)}
    <button
      type="button"
      class="filter"
      class:filter--active={selectedId === category.id}
      onclick={() => (selectedId = category.id)}
    >
      {category.label}
      <span class="filter__count">{countByCategory.get(category.id) ?? 0}</span>
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
