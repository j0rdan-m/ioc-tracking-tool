<script>
  import ToolCard from './ToolCard.svelte';

  /**
   * Responsive card grid for the filtered tools, with an empty state.
   *
   * @type {{ tools: import('../types.js').Tool[], categoryLabelById: Map<string, string>,
   *          iocLabelById: Map<string, string>, favoriteIds: string[],
   *          onToggleFavorite: (toolId: string) => void }}
   */
  let { tools, categoryLabelById, iocLabelById, favoriteIds, onToggleFavorite } = $props();
</script>

{#if tools.length === 0}
  <p class="empty" role="status">No tool matches your search. Try another keyword or category.</p>
{:else}
  <ul class="grid">
    {#each tools as tool (tool.id)}
      <li>
        <ToolCard
          {tool}
          categoryLabel={categoryLabelById.get(tool.categoryId) ?? 'Uncategorized'}
          iocLabelById={iocLabelById}
          isFavorite={favoriteIds.includes(tool.id)}
          {onToggleFavorite}
        />
      </li>
    {/each}
  </ul>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
    gap: 1.1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .grid > li {
    display: flex;
  }

  .empty {
    margin: 0;
    padding: 2.5rem 1rem;
    text-align: center;
    color: var(--color-text-muted);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-lg);
  }
</style>
