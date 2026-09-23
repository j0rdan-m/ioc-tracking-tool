<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { hueFromString } from '../utils/color.js';

  /**
   * One tool card: category, IoC types, description, tags, external link, copy,
   * favorite and health actions. The clipboard service is injected — no browser
   * API is used directly here. Favorites state lives in App; the card only
   * reports clicks through onToggleFavorite.
   *
   * @type {{ tool: import('../types.js').Tool, categoryLabel: string,
   *          iocLabelById: Map<string, string>, isFavorite: boolean,
   *          onToggleFavorite: (toolId: string) => void,
   *          health: import('../types.js').HealthResult | null,
   *          healthCheckedAt: string | null }}
   */
  let {
    tool,
    categoryLabel,
    iocLabelById,
    isFavorite,
    onToggleFavorite,
    health,
    healthCheckedAt,
  } = $props();

  /** @type {import('../services/clipboard.js').ClipboardService} */
  const clipboard = inject(DI_TOKENS.clipboard);
  const categoryHue = $derived(hueFromString(tool.categoryId));
  const iocLabels = $derived(tool.iocTypes.map((id) => iocLabelById.get(id) ?? id));
  const healthTooltip = $derived(
    health
      ? `Last check: ${healthCheckedAt ? healthCheckedAt.slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown'} — HTTP ${health.status ?? 'no response'}${health.ms != null ? ` · ${health.ms} ms` : ''}`
      : 'No health data for this tool yet.',
  );

  /** @type {'idle' | 'copied' | 'failed'} */
  let copyState = $state('idle');

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resetTimer;

  async function copyLink() {
    try {
      await clipboard.copy(tool.url);
      copyState = 'copied';
    } catch {
      copyState = 'failed';
    } finally {
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (copyState = 'idle'), 2000);
    }
  }
</script>

<article class="card" style="--category-hue: {categoryHue}">
  <div class="card__head">
    <span class="card__category">{categoryLabel}</span>
    <button
      type="button"
      class="card__favorite"
      class:card__favorite--active={isFavorite}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? `Remove ${tool.name} from favorites` : `Add ${tool.name} to favorites`}
      onclick={() => onToggleFavorite(tool.id)}
    >
      {isFavorite ? '♥' : '♡'}
    </button>
  </div>
  <ul class="card__ioc" aria-label="IoC types handled by this tool">
    {#each iocLabels as iocLabel (iocLabel)}
      <li class="card__ioc-type">{iocLabel}</li>
    {/each}
  </ul>
  <h2 class="card__name">{tool.name}</h2>
  <p class="card__description">{tool.description}</p>
  <ul class="card__tags">
    {#each tool.tags as tag (tag)}
      <li class="card__tag">{tag}</li>
    {/each}
  </ul>
  <footer class="card__actions">
    <div class="card__actions-left">
      <span
        class="card__health"
        class:card__health--up={health?.ok === true}
        class:card__health--down={health?.ok === false}
        title={healthTooltip}
      >
        <span class="card__health-dot" aria-hidden="true"></span>
        {health ? (health.ok ? 'Up' : 'Down') : '—'}
      </span>
      <a class="card__open" href={tool.url} target="_blank" rel="noopener noreferrer">
        Open tool
        <span aria-hidden="true">↗</span>
      </a>
    </div>
    <button
      type="button"
      class="card__copy"
      class:card__copy--copied={copyState === 'copied'}
      class:card__copy--failed={copyState === 'failed'}
      onclick={copyLink}
    >
      {copyState === 'copied' ? 'Copied ✓' : copyState === 'failed' ? 'Copy failed' : 'Copy link'}
    </button>
  </footer>
</article>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    flex: 1;
    padding: var(--space-5);
    background: linear-gradient(180deg, var(--color-surface-raised), var(--color-surface));
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    transition: var(--transition-lift);
  }

  .card:hover {
    transform: translateY(var(--card-lift));
    border-color: hsl(var(--category-hue) var(--category-saturation-soft) var(--category-lightness-soft) / 0.6);
  }

  .card__category {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-2xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-wider);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .card__category::before {
    content: '';
    width: var(--status-dot-size);
    height: var(--status-dot-size);
    border-radius: var(--radius-circle);
    background: hsl(var(--category-hue) var(--category-saturation) var(--category-lightness));
    box-shadow: var(--shadow-glow-category);
  }

  .card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .card__favorite {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    font-size: var(--font-size-md);
    line-height: var(--line-height-solid);
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: var(--transition-tap);
  }

  .card__favorite:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
    transform: scale(1.08);
  }

  .card__favorite--active {
    color: var(--color-accent);
    background: var(--color-accent-soft);
    border-color: var(--color-accent);
  }

  .card__ioc {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: calc(-1 * var(--space-1)) 0 0;
    padding: 0;
    list-style: none;
  }

  .card__ioc-type {
    padding: var(--pill-padding-y) var(--space-2);
    font-size: var(--font-size-2xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-snug);
    color: hsl(var(--category-hue) var(--category-saturation-soft) var(--category-lightness-text));
    background: hsl(var(--category-hue) var(--category-saturation-soft) var(--category-lightness-soft) / 0.12);
    border: var(--border-width) solid hsl(var(--category-hue) var(--category-saturation-soft) var(--category-lightness-soft) / 0.3);
    border-radius: var(--radius-pill);
  }

  .card__name {
    margin: 0;
    font-size: var(--font-size-lg);
    letter-spacing: var(--letter-spacing-tight);
  }

  .card__description {
    flex: 1;
    margin: 0;
    font-size: var(--font-size-base);
    color: var(--color-text-muted);
  }

  .card__tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card__tag {
    padding: var(--pill-padding-y) var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
    background: var(--color-neutral-faint);
    border: var(--border-width) solid var(--color-neutral-border);
    border-radius: var(--radius-pill);
  }

  .card__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-1);
    padding-top: var(--space-3);
    border-top: var(--border-width) solid var(--color-border);
  }

  .card__actions-left {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .card__health {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    cursor: help;
  }

  .card__health-dot {
    width: var(--status-dot-size);
    height: var(--status-dot-size);
    border-radius: var(--radius-circle);
    background: var(--color-neutral-marker);
  }

  .card__health--up .card__health-dot {
    background: var(--color-success);
    box-shadow: var(--shadow-glow-success);
  }

  .card__health--down .card__health-dot {
    background: var(--color-danger);
    box-shadow: var(--shadow-glow-danger);
  }

  .card__open {
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-base);
    color: var(--color-accent);
    text-decoration: none;
  }

  .card__open:hover {
    text-decoration: underline;
  }

  .card__copy {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .card__copy:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .card__copy--copied {
    color: var(--color-success);
    border-color: var(--color-success-border);
  }

  .card__copy--failed {
    color: var(--color-danger);
    border-color: var(--color-danger-border);
  }
</style>
