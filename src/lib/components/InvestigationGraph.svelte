<script>
  import { computeGraphLayout, GRAPH_HEIGHT, GRAPH_WIDTH } from '../utils/graph-layout.js';
  import { filterGraph } from '../utils/graph-filter.js';
  import { setNodePosition } from '../services/workspace/investigation-model.js';

  /** @type {{ investigation: import('../types.js').WorkspaceInvestigation,
   *           selectedNodeId?: string | null,
   *           selectedRelationshipId?: string | null,
   *           onSelectNode: (id: string) => void,
   *           onSelectRelationship: (id: string) => void,
   *           onSave: (next: import('../types.js').WorkspaceInvestigation) => Promise<void> }} */
  let {
    investigation,
    selectedNodeId = null,
    selectedRelationshipId = null,
    onSelectNode = () => {},
    onSelectRelationship = () => {},
    onSave = async () => {},
  } = $props();

  let query = $state('');
  let typeFilter = $state('all');
  let verdictFilter = $state('all');
  let sourceFilter = $state('all');
  let focusId = $state('');
  let focusDepth = $state(1);
  let includeHidden = $state(false);
  let zoom = $state(1);
  /** @type {string | null} */
  let draggingId = $state(null);
  /** @type {{ id: string, x: number, y: number } | null} */
  let dragPosition = $state(null);
  /** @type {{ x: number, y: number }} */
  let dragOffset = $state({ x: 0, y: 0 });

  const nodeTypes = $derived([...new Set(investigation.nodes.map((node) => node.typeId))].sort());
  const filtered = $derived(
    filterGraph(investigation.nodes, investigation.relationships, {
      types: typeFilter === 'all' ? [] : [typeFilter],
      verdicts: verdictFilter === 'all' ? [] : [verdictFilter],
      sources: sourceFilter === 'all' ? [] : [sourceFilter],
      includeHidden,
      focusId,
      focusDepth,
      query,
    }),
  );
  const positions = $derived(computeGraphLayout(filtered.nodes));
  const viewBox = $derived(
    `${(GRAPH_WIDTH * (1 - 1 / zoom)) / 2} ${(GRAPH_HEIGHT * (1 - 1 / zoom)) / 2} ` +
      `${GRAPH_WIDTH / zoom} ${GRAPH_HEIGHT / zoom}`,
  );

  /** @param {string} id */
  function positionOf(id) {
    if (dragPosition?.id === id) return dragPosition;
    return positions.get(id) ?? { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
  }

  /** @param {import('../types.js').WorkspaceNode} node */
  function labelFor(node) {
    return node.defanged.length > 25 ? `${node.defanged.slice(0, 22)}…` : node.defanged;
  }

  /** @param {PointerEvent} event @param {SVGSVGElement} svg */
  function worldPoint(event, svg) {
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * GRAPH_WIDTH,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * GRAPH_HEIGHT,
    };
  }

  /** @param {PointerEvent} event @param {import('../types.js').WorkspaceNode} node */
  function startDrag(event, node) {
    const current = event.currentTarget;
    if (!(current instanceof Element)) return;
    const svg = current.closest('svg');
    if (!(svg instanceof SVGSVGElement)) return;
    const point = worldPoint(event, svg);
    const position = positionOf(node.id);
    draggingId = node.id;
    dragOffset = { x: point.x - position.x, y: point.y - position.y };
    dragPosition = { id: node.id, x: position.x, y: position.y };
    event.preventDefault();
  }

  /** @param {PointerEvent} event */
  function moveDrag(event) {
    if (draggingId === null) return;
    const svg = event.currentTarget;
    if (!(svg instanceof SVGSVGElement)) return;
    const point = worldPoint(event, svg);
    dragPosition = {
      id: draggingId,
      x: Math.max(24, Math.min(GRAPH_WIDTH - 24, point.x - dragOffset.x)),
      y: Math.max(24, Math.min(GRAPH_HEIGHT - 24, point.y - dragOffset.y)),
    };
  }

  function finishDrag() {
    const id = draggingId;
    const position = dragPosition;
    draggingId = null;
    dragPosition = null;
    if (id && position) {
      void onSave(setNodePosition(investigation, id, {
        x: Math.round(position.x * 10) / 10,
        y: Math.round(position.y * 10) / 10,
      }));
    }
  }

  function resetView() {
    typeFilter = 'all';
    verdictFilter = 'all';
    sourceFilter = 'all';
    focusId = '';
    focusDepth = 1;
    includeHidden = false;
    query = '';
    zoom = 1;
  }
</script>

<div class="graph" aria-label="Investigation graph">
  <div class="graph__controls">
    <input class="graph__search" type="search" bind:value={query} placeholder="Search indicators…" aria-label="Search graph indicators" />
    <select bind:value={typeFilter} aria-label="Filter graph by type">
      <option value="all">All types</option>
      {#each nodeTypes as type (type)}<option value={type}>{type}</option>{/each}
    </select>
    <select bind:value={verdictFilter} aria-label="Filter graph by analyst verdict">
      <option value="all">All verdicts</option>
      <option value="unknown">Unknown</option><option value="benign">Benign</option>
      <option value="suspicious">Suspicious</option><option value="malicious">Malicious</option>
    </select>
    <select bind:value={sourceFilter} aria-label="Filter graph by relationship provenance">
      <option value="all">All sources</option>
      <option value="provider">Provider evidence</option>
      <option value="derived">Derived</option>
      <option value="analyst">Analyst</option>
    </select>
    <select bind:value={focusId} aria-label="Focus neighborhood on">
      <option value="">No neighborhood focus</option>
      {#each investigation.nodes as node (node.id)}<option value={node.id}>Focus: {node.defanged}</option>{/each}
    </select>
    <select bind:value={focusDepth} aria-label="Neighborhood depth" disabled={focusId === ''}>
      <option value={1}>1 hop</option><option value={2}>2 hops</option><option value={3}>3 hops</option>
    </select>
    <label class="graph__checkbox"><input type="checkbox" bind:checked={includeHidden} /> Hidden nodes</label>
    <div class="graph__zoom" role="group" aria-label="Graph zoom">
      <button type="button" aria-label="Zoom out" disabled={zoom <= 0.5} onclick={() => (zoom = Math.max(0.5, zoom - 0.1))}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" disabled={zoom >= 1.5} onclick={() => (zoom = Math.min(1.5, zoom + 0.1))}>+</button>
      <button type="button" onclick={resetView}>Reset</button>
    </div>
  </div>

  <div class="graph__canvas">
    <svg class="graph__svg" viewBox={viewBox} role="img" aria-label="Indicators and typed relationships" onpointermove={moveDrag} onpointerup={finishDrag} onpointercancel={finishDrag} onpointerleave={finishDrag}>
      <defs>
        <marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="graph__arrow" />
        </marker>
      </defs>
      <rect class="graph__backdrop" x="0" y="0" width={GRAPH_WIDTH} height={GRAPH_HEIGHT} />
      {#if filtered.nodes.length === 0}
        <text class="graph__empty" x={GRAPH_WIDTH / 2} y={GRAPH_HEIGHT / 2} text-anchor="middle">No indicator matches these filters.</text>
      {:else}
        {#each filtered.relationships as relationship (relationship.id)}
          {@const source = positionOf(relationship.sourceId)}
          {@const target = positionOf(relationship.targetId)}
          <g class="graph__edge" class:graph__edge--selected={selectedRelationshipId === relationship.id} class:graph__edge--suspected={relationship.confidence === 'suspected'} role="button" tabindex="0" aria-label={`Relationship ${relationship.type}`} onclick={() => onSelectRelationship(relationship.id)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectRelationship(relationship.id); } }}>
            <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} marker-end="url(#graph-arrow)" />
            <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2} text-anchor="middle">{relationship.type}</text>
          </g>
        {/each}
        {#each filtered.nodes as node (node.id)}
          {@const position = positionOf(node.id)}
          <g class="graph__node" class:graph__node--selected={selectedNodeId === node.id} class:graph__node--match={filtered.matchIds.has(node.id)} role="button" tabindex="0" aria-label={`${node.defanged}, ${node.verdict}`} onpointerdown={(event) => startDrag(event, node)} onclick={() => onSelectNode(node.id)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectNode(node.id); } }}>
            <circle cx={position.x} cy={position.y} r="18" />
            <text class="graph__node-label" x={position.x} y={position.y + 32} text-anchor="middle">{labelFor(node)}</text>
            <text class="graph__node-verdict" x={position.x} y={position.y + 44} text-anchor="middle">{node.verdict}</text>
          </g>
        {/each}
      {/if}
    </svg>
  </div>
  <p class="graph__hint">Drag an indicator to save its position. Filters never open a suspicious URL.</p>
</div>

<style>
  .graph {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .graph__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .graph__controls input,
  .graph__controls select {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-xs);
    color: var(--color-text);
    background: var(--color-surface-sunken);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .graph__search {
    flex: 1 1 12rem;
  }

  .graph__checkbox {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .graph__checkbox input {
    accent-color: var(--color-accent);
  }

  .graph__zoom {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  .graph__zoom button {
    padding: var(--space-1) var(--space-2);
    font: inherit;
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .graph__zoom button:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
  }

  .graph__canvas {
    overflow: auto;
    background: var(--color-surface-sunken);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .graph__svg {
    display: block;
    width: 100%;
    min-height: 28rem;
    touch-action: none;
  }

  .graph__backdrop {
    fill: var(--color-surface-sunken);
  }

  .graph__arrow {
    fill: var(--color-border);
  }

  .graph__empty {
    fill: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .graph__edge {
    cursor: pointer;
  }

  .graph__edge line {
    stroke: var(--color-border);
    stroke-width: 2;
  }

  .graph__edge text {
    fill: var(--color-text-muted);
    font-size: var(--font-size-2xs);
    pointer-events: none;
  }

  .graph__edge--suspected line {
    stroke-dasharray: 6 4;
  }

  .graph__edge--selected line {
    stroke: var(--color-accent);
    stroke-width: 3;
  }

  .graph__node {
    cursor: grab;
  }

  .graph__node:active {
    cursor: grabbing;
  }

  .graph__node circle {
    fill: var(--color-surface-raised);
    stroke: var(--color-accent);
    stroke-width: 2;
  }

  .graph__node--selected circle {
    fill: var(--color-accent-soft-strong);
    stroke: var(--color-accent);
    stroke-width: 3;
  }

  .graph__node--match circle {
    stroke: var(--color-warning);
  }

  .graph__node-label {
    fill: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    pointer-events: none;
  }

  .graph__node-verdict {
    fill: var(--color-text-muted);
    font-size: var(--font-size-2xs);
    pointer-events: none;
  }

  .graph__hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }
</style>