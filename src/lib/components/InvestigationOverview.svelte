<script>
  import { investigationStats, STATUS_LABELS, VERDICT_LABELS } from '../utils/workspace-view.js';
  import { formatTimestamp } from '../utils/format-timestamp.js';
  import { summarizeInvestigationSignals } from '../utils/signal-score.js';

  /** @type {{ investigation: import('../types.js').WorkspaceInvestigation }} */
  let { investigation } = $props();

  const stats = $derived(investigationStats(investigation));
  const signals = $derived(summarizeInvestigationSignals(investigation));
  const created = $derived(formatTimestamp(investigation.createdAt));
  const updated = $derived(formatTimestamp(investigation.updatedAt));
</script>

<section class="overview" aria-labelledby="overview-heading" data-tour="workspace-overview">
  <h3 id="overview-heading">Investigation</h3>
  <p class="overview__description">{investigation.description || 'No description yet.'}</p>
  <div class="overview__grid">
    <article><span>Status</span><strong>{STATUS_LABELS[investigation.status]}</strong></article>
    <article><span>Created</span><strong>{created} UTC</strong></article>
    <article><span>Last activity</span><strong>{updated} UTC</strong></article>
    <article><span>Indicators</span><strong>{stats.indicators}</strong></article>
    <article><span>Relationships</span><strong>{stats.relationships}</strong></article>
    <article><span>Seeds</span><strong>{stats.seeds}</strong></article>
  </div>

  <section class="overview__signals" aria-label="Heuristic signal summary">
    <h4>Signal coverage</h4>
    <div class="overview__grid">
      <article><span>Highest observed</span><strong>{signals.highest ? `${signals.highest.score.label} · ${signals.highest.score.score}/100` : 'Not assessed'}</strong></article>
      <article><span>Assessed indicators</span><strong>{signals.assessed}</strong></article>
      <article><span>Not assessed</span><strong>{signals.unavailable}</strong></article>
    </div>
    {#if signals.highest}
      <p>Highest signal: <code>{signals.highest.defanged}</code>. Open its graph details for the full score rationale.</p>
    {:else}
      <p>No reliable weighted signal has been stored for this investigation yet.</p>
    {/if}
  </section>

  <div class="overview__verdicts" aria-label="Analyst verdict distribution">
    {#each Object.keys(VERDICT_LABELS) as verdict (verdict)}
      <article class="verdict-card verdict-card--{verdict}">
        <span>{VERDICT_LABELS[verdict]}</span>
        <strong>{stats.verdicts[verdict]}</strong>
      </article>
    {/each}
  </div>

  <p class="overview__note">
    Verdicts are analyst decisions only. Provider data never changes them automatically.
  </p>
</section>

<style>
  .overview {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .overview h3,
  .overview h4,
  .overview p {
    margin: 0;
  }

  .overview__description {
    color: var(--color-text-muted);
    white-space: pre-wrap;
  }

  .overview__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: var(--space-2);
  }

  .overview__signals {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .overview__signals h4 {
    color: var(--color-text);
    font-size: var(--font-size-sm);
  }

  .overview__signals p,
  .overview__signals code {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .overview__verdicts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: var(--space-2);
  }

  article {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  article span {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  article strong {
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-lg);
  }

  .verdict-card--suspicious {
    border-left: var(--border-width-strong) solid var(--color-warning);
  }

  .verdict-card--malicious {
    border-left: var(--border-width-strong) solid var(--color-danger);
  }

  .verdict-card--benign {
    border-left: var(--border-width-strong) solid var(--color-success);
  }

  .overview__note {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }
</style>