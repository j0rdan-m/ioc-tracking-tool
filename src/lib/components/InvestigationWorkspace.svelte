<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import GraphNodeDetails from './GraphNodeDetails.svelte';
  import GraphRelationDetails from './GraphRelationDetails.svelte';
  import WorkspaceExportPanel from './WorkspaceExportPanel.svelte';
  import InvestigationGraph from './InvestigationGraph.svelte';
  import InvestigationNotes from './InvestigationNotes.svelte';
  import InvestigationOverview from './InvestigationOverview.svelte';
  import InvestigationTimeline from './InvestigationTimeline.svelte';
  import OnboardingTour from './OnboardingTour.svelte';
  import {
    addNode,
    addRelationship,
    RELATIONSHIP_TYPES,
    recordTimelineEvent,
    setInvestigationInfo,
    setInvestigationTags,
    setStatus,
  } from '../services/workspace/investigation-model.js';
  import { normalizeTag } from '../utils/history-filter.js';
  import { TOUR_VERSIONS, WORKSPACE_TOUR } from '../utils/onboarding-tour.js';
  import { STATUS_LABELS } from '../utils/workspace-view.js';

  /** @type {{ investigation: import('../types.js').WorkspaceInvestigation,
   *           catalog: import('../types.js').ToolCatalog,
   *           onBack: () => void,
   *           onSave: (next: import('../types.js').WorkspaceInvestigation) => Promise<void>,
   *           onAnalyze: (normalized: string) => void }} */
  let { investigation, catalog, onBack, onSave, onAnalyze } = $props();

  /** @type {import('../services/onboarding.js').OnboardingService} */
  const onboarding = inject(DI_TOKENS.onboarding);

  /** @type {'overview' | 'graph' | 'indicators' | 'timeline' | 'notes'} */
  let tab = $state('overview');
  let showInfo = $state(false);
  let showAddNode = $state(false);
  let showAddRelationship = $state(false);
  let showExport = $state(false);
  let name = $state('');
  let description = $state('');
  let tagDraft = $state('');
  let nodeValue = $state('');
  let sourceId = $state('');
  let targetId = $state('');
  let relationshipType = $state('observed_with');
  let relationshipConfidence = $state('suspected');
  let selectedNodeId = $state(null);
  let selectedRelationshipId = $state(null);
  let saving = $state(false);
  let error = $state('');
  let tourOpen = $state(false);

  const selectedNode = $derived(
    selectedNodeId === null ? null : investigation.nodes.find((node) => node.id === selectedNodeId) ?? null,
  );
  const selectedRelationship = $derived(
    selectedRelationshipId === null
      ? null
      : investigation.relationships.find((entry) => entry.id === selectedRelationshipId) ?? null,
  );
  const relationshipSource = $derived(
    selectedRelationship
      ? investigation.nodes.find((node) => node.id === selectedRelationship.sourceId) ?? null
      : null,
  );
  const relationshipTarget = $derived(
    selectedRelationship
      ? investigation.nodes.find((node) => node.id === selectedRelationship.targetId) ?? null
      : null,
  );

  $effect(() => {
    name = investigation.name;
    description = investigation.description;
    sourceId = investigation.nodes[0]?.id ?? '';
    targetId = investigation.nodes[1]?.id ?? investigation.nodes[0]?.id ?? '';
  });

  /** @param {import('../types.js').WorkspaceInvestigation} next */
  async function commit(next) {
    if (saving || next === investigation) return;
    saving = true;
    error = '';
    try {
      await onSave(next);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save the investigation.';
    } finally {
      saving = false;
    }
  }

  function saveInfo() {
    commit(setInvestigationInfo(investigation, { name, description }));
  }

  function addTag() {
    const tag = normalizeTag(tagDraft);
    tagDraft = '';
    if (tag !== '' && !investigation.tags.includes(tag)) {
      commit(setInvestigationTags(investigation, [...investigation.tags, tag]));
    }
  }

  /** @param {string} tag */
  function removeTag(tag) {
    commit(setInvestigationTags(investigation, investigation.tags.filter((entry) => entry !== tag)));
  }

  function addIndicator() {
    if (nodeValue.trim() !== '') {
      commit(addNode(investigation, { value: nodeValue, seed: true }));
    }
    nodeValue = '';
    showAddNode = false;
  }

  function addManualRelationship() {
    if (sourceId === '' || targetId === '') return;
    commit(
      addRelationship(investigation, {
        sourceId,
        targetId,
        type: relationshipType,
        confidence: /** @type {'observed' | 'suspected'} */ (relationshipConfidence),
        sourceType: 'analyst',
        sourceLabel: 'Analyst',
      }),
    );
    showAddRelationship = false;
  }

  function selectNode(id) {
    selectedNodeId = id;
    selectedRelationshipId = null;
  }

  function selectRelationship(id) {
    selectedRelationshipId = id;
    selectedNodeId = null;
  }

  function closeDetails() {
    selectedNodeId = null;
    selectedRelationshipId = null;
  }

  // The contextual guide opens on the first workspace the analyst enters, then
  // only on an explicit click on its "Guide" button. `investigation.id` is the
  // dependency: it re-evaluates when another investigation is opened, so the
  // check happens once per entry — the flag itself is what keeps it quiet.
  let tourCheckedFor = null;
  $effect(() => {
    const currentId = investigation.id;
    if (tourCheckedFor === currentId) return;
    tourCheckedFor = currentId;
    if (onboarding.shouldAutoOpen('workspace', TOUR_VERSIONS.workspace)) {
      tourOpen = true;
    }
  });
</script>

<section class="workspace" aria-label="Investigation workspace">
  <header class="workspace__head">
    <button type="button" class="workspace__back" onclick={onBack}>← All investigations</button>
    <div class="workspace__title">
      <h2>{investigation.name}</h2>
      <span class:workspace__status--active={investigation.status !== 'closed'}>
        {STATUS_LABELS[investigation.status]}
      </span>
    </div>
    <div class="workspace__head-actions" data-tour="workspace-status">
      <label>
        Status
        <select
          value={investigation.status}
          onchange={(event) =>
            commit(setStatus(
              investigation,
              /** @type {import('../types.js').WorkspaceStatus} */ (event.currentTarget.value),
            ))}
        >
          {#each Object.entries(STATUS_LABELS) as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
      </label>
      <button type="button" onclick={() => (showInfo = !showInfo)}>
        {showInfo ? 'Close details' : 'Edit details'}
      </button>
      <button type="button" data-tour="workspace-export" onclick={() => (showExport = !showExport)}>
        Export
      </button>
      <button type="button" onclick={() => (tourOpen = true)} title="Replay the interactive guide">
        ❔ Guide
      </button>
    </div>
  </header>

  {#if showInfo}
    <div class="info">
      <label>Name<input bind:value={name} /></label>
      <label>Description<textarea bind:value={description} rows="3"></textarea></label>
      <button type="button" disabled={saving} onclick={saveInfo}>Save details</button>
    </div>
  {/if}

  <div class="tags" aria-label="Investigation tags" data-tour="workspace-tags">
    {#each investigation.tags as tag (tag)}
      <span>
        {tag}<button type="button" aria-label={`Remove ${tag}`} onclick={() => removeTag(tag)}>×</button>
      </span>
    {/each}
    <input
      value={tagDraft}
      placeholder="+ tag"
      aria-label="Add investigation tag"
      onchange={(event) => {
        tagDraft = event.currentTarget.value;
        addTag();
      }}
    />
  </div>

  {#if error}<p class="workspace__error" role="alert">{error}</p>{/if}
  {#if showExport}
    <WorkspaceExportPanel investigation={investigation} title="Export workspace" onExported={(format) => commit(recordTimelineEvent(investigation, { type: 'export_created', label: `Workspace exported (${format})` }, null))} />
  {/if}

  <nav class="tabs" aria-label="Investigation sections" data-tour="workspace-tabs">
    {#each [
      ['overview', 'Overview'],
      ['graph', 'Graph'],
      ['indicators', 'Indicators'],
      ['timeline', 'Timeline'],
      ['notes', 'Notes'],
    ] as [value, label] (value)}
      <button
        type="button"
        class:tabs__button--active={tab === value}
        aria-current={tab === value ? 'page' : undefined}
        onclick={() => (tab = /** @type {typeof tab} */ (value))}
      >{label}</button>
    {/each}
  </nav>

  {#if tab === 'overview'}
    <InvestigationOverview {investigation} />
  {:else if tab === 'graph'}
    <div class="workspace__graph-layout">
      <InvestigationGraph
        {investigation}
        {selectedNodeId}
        {selectedRelationshipId}
        onSelectNode={selectNode}
        onSelectRelationship={selectRelationship}
        onSave={commit}
      />
      {#if selectedNode}
        <GraphNodeDetails
          node={selectedNode}
          {investigation}
          {catalog}
          onClose={closeDetails}
          {onAnalyze}
          onSave={commit}
        />
      {:else if selectedRelationship && relationshipSource && relationshipTarget}
        <GraphRelationDetails
          relationship={selectedRelationship}
          source={relationshipSource}
          target={relationshipTarget}
          onClose={closeDetails}
        />
      {/if}
    </div>
  {:else if tab === 'indicators'}
    <section class="indicators" aria-labelledby="indicators-heading" data-tour="workspace-indicators">
      <div class="indicators__head">
        <div>
          <h3 id="indicators-heading">Indicators</h3>
          <p>Values are normalized locally; the defanged form is always shown in the UI.</p>
        </div>
        <button type="button" onclick={() => (showAddNode = !showAddNode)}>
          {showAddNode ? 'Cancel' : '+ Add indicator'}
        </button>
      </div>

      {#if showAddNode}
        <form class="workspace-form" onsubmit={(event) => { event.preventDefault(); addIndicator(); }}>
          <label>Indicator value<input bind:value={nodeValue} required placeholder="IP, domain, URL, hash or email" /></label>
          <button type="submit" disabled={nodeValue.trim() === ''}>Add indicator</button>
        </form>
      {/if}

      {#if investigation.nodes.length === 0}
        <p class="workspace-empty">No indicator yet. Add the first observable to start the graph.</p>
      {:else}
        <div class="indicator-list">
          {#each investigation.nodes as node (node.id)}
            <button type="button" class="indicator-row" class:indicator-row--selected={selectedNodeId === node.id} onclick={() => selectNode(node.id)}>
              <span><strong>{node.defanged}</strong><small>{node.typeId} · {node.verdict}</small></span>
              {#if node.seed}<span class="indicator-row__badge">Seed</span>{/if}
            </button>
          {/each}
        </div>
      {/if}

      <div class="indicators__relations-head">
        <h3>Relationships</h3>
        <button type="button" disabled={investigation.nodes.length < 2} onclick={() => (showAddRelationship = !showAddRelationship)}>
          {showAddRelationship ? 'Cancel' : '+ Add relationship'}
        </button>
      </div>
      {#if showAddRelationship}
        <form class="workspace-form workspace-form--relationship" onsubmit={(event) => { event.preventDefault(); addManualRelationship(); }}>
          <label>Source<select bind:value={sourceId}>{#each investigation.nodes as node (node.id)}<option value={node.id}>{node.defanged}</option>{/each}</select></label>
          <label>Relationship<select bind:value={relationshipType}>{#each RELATIONSHIP_TYPES as type (type)}<option value={type}>{type}</option>{/each}</select></label>
          <label>Target<select bind:value={targetId}>{#each investigation.nodes as node (node.id)}<option value={node.id}>{node.defanged}</option>{/each}</select></label>
          <label>Qualification<select bind:value={relationshipConfidence}><option value="suspected">Suspected</option><option value="observed">Observed</option></select></label>
          <button type="submit" disabled={sourceId === '' || targetId === ''}>Add relationship</button>
        </form>
      {/if}
      {#if investigation.relationships.length === 0}
        <p class="workspace-empty">No relationship recorded yet.</p>
      {:else}
        <div class="relationship-list">
          {#each investigation.relationships as relationship (relationship.id)}
            {@const source = investigation.nodes.find((node) => node.id === relationship.sourceId)}
            {@const target = investigation.nodes.find((node) => node.id === relationship.targetId)}
            {#if source && target}
              <button type="button" class="relationship-row" class:relationship-row--selected={selectedRelationshipId === relationship.id} onclick={() => selectRelationship(relationship.id)}>
                <strong>{source.defanged} → {target.defanged}</strong>
                <small>{relationship.type} · {relationship.confidence} · {relationship.sourceLabel ?? relationship.sourceType}</small>
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  {:else if tab === 'timeline'}
    <InvestigationTimeline {investigation} />
  {:else if tab === 'notes'}
    <InvestigationNotes {investigation} onSave={commit} />
  {/if}
</section>

<OnboardingTour bind:open={tourOpen} steps={WORKSPACE_TOUR} scope="workspace" />

<style>
  .workspace {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-height: 28rem;
  }

  .workspace__head,
  .indicators__head,
  .indicators__relations-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .workspace__title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .workspace__title h2,
  .workspace__title span,
  .workspace__back {
    margin: 0;
  }

  .workspace__title h2 {
    font-size: var(--font-size-lg);
  }

  .workspace__title span {
    padding: var(--pill-padding-y) var(--space-2);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    background: var(--color-neutral-soft);
    border-radius: var(--radius-pill);
  }

  .workspace__title .workspace__status--active {
    color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  .workspace__back,
  .workspace__head-actions button,
  .indicators__head button,
  .indicators__relations-head button,
  .workspace-form button {
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

  .workspace__back:hover,
  .workspace__head-actions button:hover,
  .indicators__head button:hover,
  .indicators__relations-head button:hover:not(:disabled),
  .workspace-form button:hover:not(:disabled) {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .workspace__head-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .workspace__head-actions label,
  .workspace-form label {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  select,
  input,
  textarea {
    padding: var(--space-2) var(--space-3);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-sunken);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .info,
  .workspace-form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-accent-veil);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .info label,
  .workspace-form label {
    flex: 1 1 12rem;
    flex-direction: column;
    align-items: stretch;
  }

  .info textarea {
    min-height: 4rem;
    resize: vertical;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .tags > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    color: var(--color-brand);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    background: var(--color-brand-veil);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-pill);
  }

  .tags span button {
    padding: 0;
    color: inherit;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .tags input {
    min-width: 8rem;
    font-size: var(--font-size-xs);
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    border-bottom: var(--border-width) solid var(--color-border);
  }

  .tabs button {
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    background: transparent;
    border: 0;
    border-bottom: var(--border-width-strong) solid transparent;
    cursor: pointer;
  }

  .tabs button:hover,
  .tabs__button--active {
    color: var(--color-accent) !important;
    border-bottom-color: var(--color-accent) !important;
  }

  .workspace__graph-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(15rem, 20rem);
    gap: var(--space-3);
    align-items: start;
  }

  .indicators {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  .indicators h3,
  .indicators p {
    margin: 0;
  }

  .indicators p {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .workspace-form--relationship {
    align-items: end;
  }

  .workspace-form--relationship label {
    flex: 1 1 10rem;
  }

  .indicator-list,
  .relationship-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-2);
  }

  .indicator-row,
  .relationship-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3);
    font: inherit;
    color: var(--color-text);
    text-align: left;
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .relationship-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .indicator-row:hover,
  .relationship-row:hover,
  .indicator-row--selected,
  .relationship-row--selected {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  .indicator-row span,
  .relationship-row strong,
  .relationship-row small {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .indicator-row strong,
  .indicator-row small,
  .relationship-row strong,
  .relationship-row small {
    display: block;
  }

  .indicator-row small,
  .relationship-row small {
    margin-top: var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .indicator-row__badge {
    padding: var(--pill-padding-y) var(--space-2);
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    background: var(--color-accent-soft);
    border-radius: var(--radius-pill);
  }

  .workspace-empty {
    padding: var(--space-4);
    color: var(--color-text-muted);
    text-align: center;
    background: var(--color-surface-sunken);
    border: var(--border-width) dashed var(--color-border);
    border-radius: var(--radius-md);
  }

  @media (max-width: 64rem) {
    .workspace__graph-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 48rem) {
    .workspace__head,
    .indicators__head,
    .indicators__relations-head {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
