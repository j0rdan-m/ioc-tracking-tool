<script>
  import CategoryFilter from './lib/components/CategoryFilter.svelte';
  import IocTypeFilter from './lib/components/IocTypeFilter.svelte';
  import SearchBar from './lib/components/SearchBar.svelte';
  import ToolGrid from './lib/components/ToolGrid.svelte';
  import { createAppContainer } from './lib/bootstrap.js';
  import { inject, provideContainer } from './lib/di/provide.js';
  import { DI_TOKENS } from './lib/di/tokens.js';
  import {
    countToolsByCategory,
    countToolsByIocType,
    filterTools,
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

  let query = $state('');
  let selectedCategoryId = $state('all');
  let selectedIocTypeId = $state('all');
  let catalogPromise = $state(toolRepository.getCatalog());

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
      {@const filteredTools = filterTools(catalog.tools, query, selectedCategoryId, selectedIocTypeId)}
      {@const categoryLabelById = new Map(
        catalog.categories.map((category) => [category.id, category.label]),
      )}
      {@const iocLabelById = new Map(catalog.iocTypes.map((iocType) => [iocType.id, iocType.label]))}
      <!-- Faceted counts: each filter row reflects the query and the other facet. -->
      {@const countByCategory = countToolsByCategory(
        filterTools(catalog.tools, query, 'all', selectedIocTypeId),
      )}
      {@const countByIocType = countToolsByIocType(
        filterTools(catalog.tools, query, selectedCategoryId, 'all'),
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
      </section>

      <ToolGrid tools={filteredTools} {categoryLabelById} {iocLabelById} />

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
