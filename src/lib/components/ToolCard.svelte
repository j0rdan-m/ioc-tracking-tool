<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { hueFromString } from '../utils/color.js';

  /**
   * One tool card: category, IoC types, description, tags, external link and copy action.
   * The clipboard service is injected — no browser API is used directly here.
   *
   * @type {{ tool: import('../types.js').Tool, categoryLabel: string,
   *          iocLabelById: Map<string, string> }}
   */
  let { tool, categoryLabel, iocLabelById } = $props();

  /** @type {import('../services/clipboard.js').ClipboardService} */
  const clipboard = inject(DI_TOKENS.clipboard);
  const categoryHue = $derived(hueFromString(tool.categoryId));
  const iocLabels = $derived(tool.iocTypes.map((id) => iocLabelById.get(id) ?? id));

  /** @type {'idle' | 'copied' | 'failed'} */
  let copyState = $state('idle');

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
  <span class="card__category">{categoryLabel}</span>
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
    <a class="card__open" href={tool.url} target="_blank" rel="noopener noreferrer">
      Open tool
      <span aria-hidden="true">↗</span>
    </a>
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
    gap: 0.7rem;
    flex: 1;
    padding: 1.2rem 1.25rem;
    background: linear-gradient(180deg, var(--color-surface-raised), var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    transition:
      transform 0.18s ease,
      border-color 0.18s ease;
  }

  .card:hover {
    transform: translateY(-3px);
    border-color: hsl(var(--category-hue) 70% 55% / 0.6);
  }

  .card__category {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .card__category::before {
    content: '';
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: hsl(var(--category-hue) 80% 60%);
    box-shadow: 0 0 8px hsl(var(--category-hue) 80% 60% / 0.8);
  }

  .card__ioc {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: -0.35rem 0 0;
    padding: 0;
    list-style: none;
  }

  .card__ioc-type {
    padding: 0.08rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: hsl(var(--category-hue) 70% 72%);
    background: hsl(var(--category-hue) 70% 55% / 0.12);
    border: 1px solid hsl(var(--category-hue) 70% 55% / 0.3);
    border-radius: 999px;
  }

  .card__name {
    margin: 0;
    font-size: 1.18rem;
    letter-spacing: -0.01em;
  }

  .card__description {
    flex: 1;
    margin: 0;
    font-size: 0.93rem;
    color: var(--color-text-muted);
  }

  .card__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card__tag {
    padding: 0.08rem 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-text-muted);
    background: rgb(148 163 184 / 0.1);
    border: 1px solid rgb(148 163 184 / 0.16);
    border-radius: 999px;
  }

  .card__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.25rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--color-border);
  }

  .card__open {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--color-accent);
    text-decoration: none;
  }

  .card__open:hover {
    text-decoration: underline;
  }

  .card__copy {
    padding: 0.32rem 0.8rem;
    font: inherit;
    font-size: 0.8rem;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    cursor: pointer;
    transition:
      color 0.15s ease,
      border-color 0.15s ease;
  }

  .card__copy:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .card__copy--copied {
    color: var(--color-success);
    border-color: rgb(74 222 128 / 0.5);
  }

  .card__copy--failed {
    color: var(--color-danger);
    border-color: rgb(248 113 113 / 0.5);
  }
</style>
