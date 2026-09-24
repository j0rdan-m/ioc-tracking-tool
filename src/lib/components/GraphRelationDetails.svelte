<script>
  import { formatTimestamp } from '../utils/format-timestamp.js';

  /** @type {{ relationship: import('../types.js').WorkspaceRelationship,
   *           source: import('../types.js').WorkspaceNode,
   *           target: import('../types.js').WorkspaceNode,
   *           onClose: () => void }} */
  let { relationship, source, target, onClose } = $props();
</script>

<aside class="details" aria-label="Relationship details">
  <header class="details__head">
    <div><span>{relationship.type}</span><code>{source.defanged} → {target.defanged}</code></div>
    <button type="button" aria-label="Close relationship" onclick={onClose}>✕</button>
  </header>

  <div class="details__body">
    <section>
      <h4>Type</h4><p>{relationship.type}</p>
      <h4>Qualification</h4><p>{relationship.confidence === 'observed' ? 'Observed' : 'Suspected'}</p>
      <h4>Origin</h4>
      <p>{relationship.sourceLabel ?? relationship.sourceType}{relationship.provider ? ` · ${relationship.provider}` : ''}</p>
    </section>

    <section>
      <h4>Evidence</h4>
      <ol class="details__evidence">
        {#each relationship.evidence as evidence, index (index)}
          <li>
            <span>{evidence.sourceLabel ?? evidence.sourceType}{evidence.provider ? ` · ${evidence.provider}` : ''}</span>
            <time datetime={evidence.observedAt}>{formatTimestamp(evidence.observedAt)} UTC</time>
          </li>
        {/each}
      </ol>
    </section>
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

  .details__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
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
  .details__head code {
    overflow-wrap: anywhere;
  }

  .details__head span,
  .details__body p {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .details__head code {
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  button {
    padding: var(--space-1) var(--space-2);
    font: inherit;
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  button:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
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
  .details__evidence {
    margin: 0;
  }

  .details__body h4 {
    color: var(--color-text);
    font-size: var(--font-size-xs);
  }

  .details__evidence {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0;
    list-style: none;
  }

  .details__evidence li {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-left: var(--space-2);
    border-left: var(--border-width) solid var(--color-border);
  }

  .details__evidence time {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
  }
</style>
