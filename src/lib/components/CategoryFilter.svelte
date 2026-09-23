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
    gap: var(--space-2);
  }

  .filter {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .filter:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .filter--active {
    color: var(--color-accent);
    background: var(--color-accent-soft);
    border-color: var(--color-accent);
  }

  .filter__count {
    padding: var(--pill-padding-y) var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
    background: var(--color-neutral-soft);
    border-radius: var(--radius-pill);
  }

  .filter--active .filter__count {
    color: var(--color-accent);
    background: var(--color-accent-soft-strong);
  }
</style>
