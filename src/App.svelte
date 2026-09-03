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

  // IoC shape detected in the current query (null when it is not an observable).
  let detectedIocTypeId = $derived(detectIocType(query));

  // Pre-apply the matching IoC-type pill whenever the detected type changes.
  // When the query stops looking like an IoC, the pill is cleared only if it
  // still holds the auto-applied value, so a manual pick survives. untrack()
  // keeps the effect driven by the query alone: writing the pill state back
  // cannot re-trigger the effect.
  let lastAppliedDetection = null;
  $effect(() => {
    const detected = detectedIocTypeId;
    untrack(() => {
      if (detected) {
        if (detected !== lastAppliedDetection) {
          lastAppliedDetection = detected;
          selectedIocTypeId = detected;
        }
        return;
      }
      if (lastAppliedDetection !== null) {
        const wasAutoApplied = selectedIocTypeId === lastAppliedDetection;
        lastAppliedDetection = null;
        if (wasAutoApplied) {
          selectedIocTypeId = 'all';
        }
      }
    });
  });

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
      <!-- When the query is a recognizable IoC it is not a keyword: skip the
           text match and let the auto-applied IoC-type filter drive the list. -->
      {@const queryForText = detectedIocTypeId ? '' : query}
      {@const filteredTools = filterTools(catalog.tools, queryForText, selectedCategoryId, selectedIocTypeId)}
      {@const categoryLabelById = new Map(
        catalog.categories.map((category) => [category.id, category.label]),
      )}
      {@const iocLabelById = new Map(catalog.iocTypes.map((iocType) => [iocType.id, iocType.label]))}
      <!-- Faceted counts: each filter row reflects the query and the other facet. -->
      {@const countByCategory = countToolsByCategory(
        filterTools(catalog.tools, queryForText, 'all', selectedIocTypeId),
      )}
      {@const countByIocType = countToolsByIocType(
        filterTools(catalog.tools, queryForText, selectedCategoryId, 'all'),
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

      {#if detectedIocTypeId}
        <p class="status status--muted" role="status">
          This query looks like <strong>{iocLabelById.get(detectedIocTypeId)}</strong>
          {#if selectedIocTypeId === detectedIocTypeId}
            — the matching IoC-type filter was applied automatically (pick another pill to override).
          {:else}
            — the IoC-type pill you picked stays in effect.
          {/if}
        </p>
      {/if}

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

  /* On small screens the search bar and the filter pills wrap into many rows:
     pinning them would eat most of the viewport, so the toolbar scrolls away
     with the content instead of staying on top. */
  @media (max-width: 48rem) {
    .toolbar {
      position: static;
    }
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
