<script>
  import CategoryFilter from './lib/components/CategoryFilter.svelte';
  import IocTypeFilter from './lib/components/IocTypeFilter.svelte';
  import SearchBar from './lib/components/SearchBar.svelte';
  import ToolGrid from './lib/components/ToolGrid.svelte';
  import { createAppContainer } from './lib/bootstrap.js';
  import { inject, provideContainer } from './lib/di/provide.js';
  import { DI_TOKENS } from './lib/di/tokens.js';
  import { untrack } from 'svelte';
  import { detectIocType } from './lib/utils/detect-ioc-type.js';
  import {
    countToolsByCategory,
    countToolsByIocType,
    filterTools,
    nextAutoIocFilter,
  } from './lib/utils/filter-tools.js';

  let { container } = $props();
  if (!container) {
    throw new Error('App: missing "container" prop (the DI container built in main.js).');
  }

  // Publish the DI container so any descendant can inject its dependencies.
  // The container is built once in main.js and never changes afterwards, so
  // capturing its initial value here is intentional.
  // svelte-ignore state_referenced_locally
  provideContainer(container);
  const toolRepository = inject(DI_TOKENS.toolRepository);
  const favorites = inject(DI_TOKENS.favorites);

  let query = $state('');
  let selectedCategoryId = $state('all');
  let selectedIocTypeId = $state('all');
  let favoriteIds = $state(favorites.getFavorites());
  let favoritesOnly = $state(false);
  let catalogPromise = $state(toolRepository.getCatalog());

  // IoC shape detected in the current query (null when it is not an observable).
  let detectedIocTypeId = $derived(detectIocType(query));

  // While the query looks like an IoC, the IoC-type pill always follows the
  // detected type (re-pasting an observable re-applies it, even after a manual
  // pick). When the query stops being an IoC, the pill resets to 'all' only if
  // it still holds the auto-applied value, so a manual pick survives. The
  // transition lives in nextAutoIocFilter (pure + unit-tested); untrack() keeps
  // this effect driven by the query alone, so writing the pill state back
  // cannot re-trigger the effect.
  let lastAutoDetection = null;
  $effect(() => {
    const detected = detectedIocTypeId;
    untrack(() => {
      const next = nextAutoIocFilter(detected, selectedIocTypeId, lastAutoDetection);
      lastAutoDetection = next.lastAuto;
      selectedIocTypeId = next.selectedId;
    });
  });

  /**
   * Toggles a tool favorite and persists the new list via the service.
   *
   * @param {string} toolId
   */
  function toggleFavorite(toolId) {
    favoriteIds = favorites.toggle(toolId);
  }

  function retryLoadingCatalog() {
    catalogPromise = toolRepository.getCatalog();
  }
</script>

<div class="page">
  <header class="hero">
    <p class="hero__eyebrow">Cybersecurity · Digital forensics</p>
    <h1 class="hero__title">IOC Investigation Toolkit</h1>
    <p class="hero__subtitle">
      A curated directory of online services to pivot on indicators of compromise (IOCs) during an
      investigation: geolocate an IP, assess its reputation, or cross-check observables across
      multiple engines.
    </p>
  </header>

  <main class="content">
    {#await catalogPromise}
      <p class="status" role="status">Loading the tool catalog…</p>
    {:then catalog}
      <!-- Favorites facet: the pool narrows before the other facets apply. -->
      {@const favoritePool = favoritesOnly
        ? catalog.tools.filter((tool) => favoriteIds.includes(tool.id))
        : catalog.tools}
      <!-- When the query is a recognizable IoC it is not a keyword: skip the
           text match and let the auto-applied IoC-type filter drive the list. -->
      {@const queryForText = detectedIocTypeId ? '' : query}
      {@const filteredTools = filterTools(favoritePool, queryForText, selectedCategoryId, selectedIocTypeId)}
      {@const categoryLabelById = new Map(
        catalog.categories.map((category) => [category.id, category.label]),
      )}
      {@const iocLabelById = new Map(catalog.iocTypes.map((iocType) => [iocType.id, iocType.label]))}
      <!-- Faceted counts: each filter row reflects the query and the other facet. -->
      {@const countByCategory = countToolsByCategory(
        filterTools(favoritePool, queryForText, 'all', selectedIocTypeId),
      )}
      {@const countByIocType = countToolsByIocType(
        filterTools(favoritePool, queryForText, selectedCategoryId, 'all'),
      )}

      <section class="toolbar">
        <SearchBar bind:value={query} />
        <CategoryFilter
          categories={catalog.categories}
          bind:selectedId={selectedCategoryId}
          {countByCategory}
        />
        <IocTypeFilter
          iocTypes={catalog.iocTypes}
          bind:selectedId={selectedIocTypeId}
          {countByIocType}
        />
        <button
          type="button"
          class="favorites-toggle"
          class:favorites-toggle--active={favoritesOnly}
          aria-pressed={favoritesOnly}
          onclick={() => (favoritesOnly = !favoritesOnly)}
        >
          ★ Favorites
          <span class="favorites-toggle__count">{favoriteIds.length}</span>
        </button>
      </section>

      {#if detectedIocTypeId}
        <p class="status status--muted" role="status">
          This query looks like <strong>{iocLabelById.get(detectedIocTypeId)}</strong>
          {#if selectedIocTypeId === detectedIocTypeId}
            — the matching IoC-type filter is applied automatically (pick another pill to override).
          {:else}
            — the IoC-type pill you picked stays in effect.
          {/if}
        </p>
      {/if}

      <ToolGrid
        tools={filteredTools}
        {categoryLabelById}
        {iocLabelById}
        {favoriteIds}
        {onToggleFavorite}
      />

      <p class="status status--muted" role="status">
        Showing {filteredTools.length} of {catalog.tools.length} tools.
      </p>
    {:catch error}
      <p class="status status--error" role="alert">
        Could not load the tool catalog: {error.message}
      </p>
      <button type="button" class="retry" onclick={retryLoadingCatalog}>Retry</button>
    {/await}
  </main>

  <footer class="footer">
    <p>
      Links point to third-party services: never submit confidential data, and use them only on
      indicators you are authorized to investigate.
    </p>
  </footer>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 2.25rem;
    min-height: 100vh;
    max-width: 68rem;
    margin-inline: auto;
    padding: 3.5rem 1.25rem 3rem;
  }

  .hero {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .hero__eyebrow {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-accent);
  }

  .hero__title {
    margin: 0;
    font-size: clamp(1.9rem, 4vw, 2.75rem);
    line-height: 1.15;
    letter-spacing: -0.02em;
  }

  .hero__subtitle {
    margin: 0;
    max-width: 46rem;
    color: var(--color-text-muted);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .toolbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
    padding: 0.75rem 0;
    background: color-mix(in srgb, var(--color-bg) 85%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--color-border);
  }

  /* On small screens the search bar and the filter pills wrap into many rows:
     pinning them would eat most of the viewport, so the toolbar scrolls away
     with the content instead of staying on top. */
  @media (max-width: 48rem) {
    .toolbar {
      position: static;
    }
  }

  .favorites-toggle {
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

  .favorites-toggle:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .favorites-toggle--active {
    color: var(--color-accent);
    background: rgb(56 189 248 / 0.12);
    border-color: var(--color-accent);
  }

  .favorites-toggle__count {
    padding: 0.05rem 0.45rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--color-text-muted);
    background: rgb(148 163 184 / 0.12);
    border-radius: 999px;
  }

  .favorites-toggle--active .favorites-toggle__count {
    color: var(--color-accent);
    background: rgb(56 189 248 / 0.16);
  }

  .status {
    margin: 0;
    color: var(--color-text-muted);
  }

  .status--muted {
    font-size: 0.85rem;
  }

  .status--error {
    color: var(--color-danger);
  }

  .retry {
    align-self: flex-start;
    padding: 0.5rem 1.3rem;
    font: inherit;
    font-weight: 600;
    color: #08131f;
    background: var(--color-accent);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .retry:hover {
    background: var(--color-accent-strong);
  }

  .footer {
    margin-top: auto;
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-border);
  }

  .footer p {
    margin: 0;
    max-width: 60rem;
    font-size: 0.82rem;
    color: var(--color-text-muted);
  }
</style>
