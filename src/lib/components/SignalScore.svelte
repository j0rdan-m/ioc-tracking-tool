<script>
  import { scoreInvestigationAnalysis } from '../utils/signal-score.js';

  /** @type {{ analysis?: import('../types.js').InvestigationAnalysisSnapshot | null, compact?: boolean }} */
  let { analysis = null, compact = false } = $props();

  const score = $derived(scoreInvestigationAnalysis(analysis));
</script>

<section class="signal" class:signal--compact={compact} aria-label="Heuristic signal level">
  <header>
    <span>Signal level</span>
    <strong class="signal__level signal__level--{score.level}">
      {score.label}{score.score === null ? '' : ` · ${score.score}/100`}
    </strong>
  </header>
  {#if score.assessed && score.contributions.length > 0}
    <details>
      <summary>Why this score?</summary>
      <ul>
        {#each score.contributions as contribution (contribution.id)}
          <li>
            <span>{contribution.label}</span>
            <small>+{contribution.points} · {contribution.checkId} · {contribution.field}</small>
          </li>
        {/each}
      </ul>
    </details>
  {:else}
    <p>Not assessed — the keyless providers returned no reliable weighted signal.</p>
  {/if}
  <p class="signal__notice">Heuristic — not a verdict. Analyst qualification remains separate.</p>
</section>

<style>
  .signal {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  header span,
  summary,
  p {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  p {
    margin: 0;
  }

  .signal__level {
    padding: var(--space-1) var(--space-2);
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    background: var(--color-surface-sunken);
    border-radius: var(--radius-pill);
  }

  .signal__level--low {
    color: var(--color-success);
    background: var(--color-success-soft);
  }

  .signal__level--medium {
    color: var(--color-warning);
    background: var(--color-warning-soft);
  }

  .signal__level--high {
    color: var(--color-danger);
    background: var(--color-danger-soft);
  }

  details {
    min-width: 0;
  }

  summary {
    cursor: pointer;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  li span {
    color: var(--color-text);
    font-size: var(--font-size-xs);
  }

  li small {
    color: var(--color-text-muted);
    font-size: var(--font-size-2xs);
    overflow-wrap: anywhere;
  }

  .signal__notice {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .signal--compact {
    padding: var(--space-2);
  }
</style>
