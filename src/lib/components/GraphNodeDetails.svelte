<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import {
    removeNode,
    setNodeHidden,
    setNodeNotes,
    setNodeVerdict,
  } from '../services/workspace/investigation-model.js';
  import { getDeepLinks } from '../utils/deep-links.js';
  import { formatTimestamp } from '../utils/format-timestamp.js';

  /** @type {{ node: import('../types.js').WorkspaceNode,
   *           investigation: import('../types.js').WorkspaceInvestigation,
   *           catalog: import('../types.js').ToolCatalog,
   *           onClose: () => void,
   *           onAnalyze: (normalized: string) => void,
   *           onSave: (next: import('../types.js').WorkspaceInvestigation) => Promise<void> }} */
  let { node, investigation, catalog, onClose, onAnalyze, onSave } = $props();

  const clipboard = inject(DI_TOKENS.clipboard);
  let notesDraft = $state('');
  let copied = $state(false);
  let saving = $state(false);
  const connected = $derived(
    investigation.relationships.flatMap((relationship) => {
      const otherId =
        relationship.sourceId === node.id
          ? relationship.targetId
          : relationship.targetId === node.id
            ? relationship.sourceId
            : null;
      const other = otherId ? investigation.nodes.find((candidate) => candidate.id === otherId) : null;
      return other
        ? [{ relationship, other, outgoing: relationship.sourceId === node.id }]
        : [];
    }),
  );
  const links = $derived(
    ['ip', 'domain', 'url', 'email', 'file', 'username'].includes(node.typeId)
      ? getDeepLinks(
          /** @type {import('../types.js').IocTypeId} */ (node.typeId),
          node.value,
          catalog.tools,
        )
      : [],
  );

  $effect(() => {
    notesDraft = node.notes;
  });

  /** @param {import('../types.js').WorkspaceInvestigation} next */
  async function commit(next) {
    if (saving || next === investigation) return;
    saving = true;
    await onSave(next);
    saving = false;
  }

  function saveNotes() {
    commit(setNodeNotes(investigation, node.id, notesDraft));
  }

  function remove() {
    if (confirm(`Remove ${node.defanged} from this investigation? Global History is unchanged.`)) {
      void commit(removeNode(investigation, node.id));
      onClose();
    }
  }

  function toggleHidden() {
    void commit(setNodeHidden(investigation, node.id, !node.hidden));
  }

  async function copyValue() {
    await clipboard.copy(node.value);
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }
</script>

<aside class="details" aria-label={`Details for ${node.defanged}`}>
  <header class="details__head">
    <div><span>{node.typeId}</span><code>{node.defanged}</code></div>
    <button type="button" aria-label="Close details" onclick={onClose}>✕</button>
  </header>

  <div class="details__body">
    <section>
      <h4>Type</h4><p>{node.typeId}</p>
      <h4>Analyst verdict</h4>
      <select
        value={node.verdict}
        onchange={(event) =>
          commit(setNodeVerdict(
            investigation,
            node.id,
            /** @type {import('../types.js').InvestigationVerdict} */ (event.currentTarget.value),
          ))}
      >
        <option value="unknown">Unknown</option><option value="benign">Benign</option>
        <option value="suspicious">Suspicious</option><option value="malicious">Malicious</option>
      </select>
    </section>

    <section>
      <h4>Connections</h4>
      {#if connected.length === 0}<p>No relationship yet.</p>{/if}
      <ul>
        {#each connected as connection (connection.relationship.id)}
          <li><span>{connection.outgoing ? '→' : '←'} <code>{connection.other.defanged}</code></span>
            <small>{connection.relationship.type} · {connection.relationship.confidence}</small>
          </li>
        {/each}
      </ul>
    </section>

    <section>
      <h4>Analyst notes</h4>
      <textarea bind:value={notesDraft} rows="6" aria-label="Node analyst notes"></textarea>
      <button type="button" disabled={saving || notesDraft === node.notes} onclick={saveNotes}>Save notes</button>
    </section>

    {#if node.analysis}
      <section>
        <h4>Latest analysis</h4>
        <p>Checked {formatTimestamp(node.analysis.checkedAt)} UTC</p>
        <ul>
          {#each node.analysis.checks as check (check.toolId)}
            <li><strong>{check.toolId}</strong> <span>{check.status}</span>
              {#if check.summary}<small>{check.summary}</small>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>

  <footer class="details__actions">
    {#if links.length > 0}
      <button type="button" onclick={() => onAnalyze(node.value)}>Analyze</button>
    {/if}
    <button type="button" disabled title="Pivot discovery is added in the next workspace lot">Pivot</button>
    <button type="button" onclick={copyValue}>{copied ? 'Copied ✓' : 'Copy'}</button>
    <button type="button" onclick={toggleHidden}>{node.hidden ? 'Show in graph' : 'Hide from graph'}</button>
    <button type="button" onclick={remove}>Remove from investigation</button>
  </footer>
  <div class="details__links">
    {#each links as link (link.toolId)}
      <a href={link.url} target="_blank" rel="noopener noreferrer">{link.name} ↗</a>
    {/each}
  </div>
</aside>

<style>
  .details {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3);
    background: var(--color-surface-sunken);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .details__head,
  .details__actions,
  .details__links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .details__head {
    justify-content: space-between;
    padding-bottom: var(--space-2);
    border-bottom: var(--border-width) solid var(--color-border);
  }

  .details__head > div {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: var(--space-1);
  }

  .details__head span,
  .details__head code,
  .details__body h4,
  .details__body p,
  .details__body small {
    overflow-wrap: anywhere;
  }

  .details__head span {
    color: var(--color-text-muted);
    font-size: var(--font-size-2xs);
    text-transform: uppercase;
    letter-spacing: var(--letter-spacing-wide);
  }

  .details__head code {
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  button {
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

  button:hover:not(:disabled) {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  button:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
  }

  .details__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .details__body section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .details__body h4,
  .details__body p,
  .details__body ul {
    margin: 0;
  }

  .details__body h4 {
    color: var(--color-text);
    font-size: var(--font-size-xs);
  }

  .details__body p,
  .details__body small {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .details__body select,
  .details__body textarea {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .details__body textarea {
    min-height: 7rem;
    resize: vertical;
  }

  .details__body ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0;
    list-style: none;
  }

  .details__body li {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .details__body li code {
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    overflow-wrap: anywhere;
  }

  .details__actions {
    padding-top: var(--space-2);
    border-top: var(--border-width) solid var(--color-border);
  }

  .details__links a {
    color: var(--color-accent);
    font-size: var(--font-size-xs);
  }
</style>
