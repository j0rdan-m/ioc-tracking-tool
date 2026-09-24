<script>
  import { formatTimestamp } from '../utils/format-timestamp.js';

  /** @type {{ investigation: import('../types.js').WorkspaceInvestigation }} */
  let { investigation } = $props();

  const events = $derived([...investigation.timeline].reverse());
</script>

<section class="timeline" aria-labelledby="timeline-heading">
  <h3 id="timeline-heading">Timeline</h3>
  {#if events.length === 0}
    <p class="timeline__empty">No significant event recorded yet.</p>
  {:else}
    <ol>
      {#each events as event (event.id)}
        <li>
          <time datetime={event.at}>{formatTimestamp(event.at)} UTC</time>
          <span class:timeline__event--error={event.type === 'export_created'}>
            {event.label}
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .timeline h3,
  .timeline p {
    margin: 0;
  }

  .timeline__empty {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  ol {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: 9rem 1fr;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-left: var(--border-width-strong) solid var(--color-border);
  }

  time {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  span {
    font-size: var(--font-size-sm);
    overflow-wrap: anywhere;
  }

  .timeline__event--error {
    color: var(--color-warning);
  }

  @media (max-width: 38rem) {
    li {
      grid-template-columns: 1fr;
    }
  }
</style>