<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { INVESTIGATION_VERDICTS } from '../services/investigation-history.js';
  import { getDeepLinks } from '../utils/deep-links.js';
  import { formatTimestamp } from '../utils/format-timestamp.js';
  import { collectTags, filterInvestigations, normalizeTag } from '../utils/history-filter.js';

  /**
   * "History" modal: the local investigation notebook. It lists the indicators
   * the analyst already analysed (Fast analyze, batch analysis or an explicit
   * save), most recently analysed first, with the analyst qualification —
   * verdict, tags, notes — kept apart from the provider results. Everything is
   * read from and written to the browser storage: no account, no backend, no
   * network call (consulting or editing the history sends nothing anywhere).
   *
   * @type {{ open?: boolean, catalog: import('../types.js').ToolCatalog,
   *          onAnalyze?: (normalized: string) => void }}
   */
  let { open = $bindable(false), catalog, onAnalyze = () => {} } = $props();

  /** @type {import('../services/investigation-history.js').InvestigationHistoryService} */
  const history = inject(DI_TOKENS.investigations);
  /** @type {import('../services/clipboard.js').ClipboardService} */
  const clipboard = inject(DI_TOKENS.clipboard);

  /** @type {import('../types.js').InvestigationEntry[]} */
  let entries = $state([]);
  /** @type {'list' | 'detail'} */
  let view = $state('list');
  /** @type {string | null} */
  let selectedId = $state(null);

  let query = $state('');
  let filterTypeId = $state('all');
  let filterVerdict = $state('all');
  let filterTag = $state('all');

  let notesDraft = $state('');
  let tagDraft = $state('');
  /** @type {string | null} */
  let feedback = $state(null);
  let pendingDelete = $state(false);
  let confirmClear = $state(false);
  let showLinks = $state(false);

  /** @type {HTMLInputElement | undefined} */
  let searchEl = $state();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let feedbackTimer;

  const filtered = $derived(
    filterInvestigations(entries, {
      query,
      typeId: filterTypeId,
      verdict: filterVerdict,
      tag: filterTag,
    }),
  );
  const tags = $derived(collectTags(entries));
  const selected = $derived(entries.find((entry) => entry.id === selectedId) ?? null);
    const deepLinks = $derived(
    selected
      ? getDeepLinks(/** @type {import('../types.js').IocTypeId} */ (selected.typeId), selected.normalized, catalog.tools)
      : [],
  );

  /** Compact type labels; hashes carry their digest kind. */
  const TYPE_LABELS = {
    ip: 'IP',
    domain: 'Domain',
    url: 'URL',
    file: 'Hash',
    email: 'Email',
    username: 'Username',
  };

  /**
   * @param {import('../types.js').InvestigationEntry} entry
   * @returns {string}
   */
  function typeLabel(entry) {
    if (entry.typeId === 'file') {
      if (entry.normalized.length === 64) return 'SHA256';
      if (entry.normalized.length === 40) return 'SHA-1';
      if (entry.normalized.length === 32) return 'MD5';
      return 'Hash';
    }
    return TYPE_LABELS[entry.typeId] ?? entry.typeId;
  }

  /** @param {string} verdict @returns {string} */
  function verdictLabel(verdict) {
    return verdict.charAt(0).toUpperCase() + verdict.slice(1);
  }

  /** @type {Record<string, string>} */
  const CHECK_STATUS_LABELS = {
    ok: 'OK',
    empty: 'Empty',
    error: 'Error',
    cancelled: 'Cancelled',
  };

  function refresh() {
    entries = history.list();
    if (selectedId !== null && !entries.some((entry) => entry.id === selectedId)) {
      view = 'list';
      selectedId = null;
    }
  }

  /**
   * @param {string} message
   */
  function flash(message) {
    feedback = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2000);
  }

  /** @param {string} id */
  function openDetail(id) {
    selectedId = id;
    view = 'detail';
    notesDraft = history.get(id)?.notes ?? '';
    tagDraft = '';
    pendingDelete = false;
    showLinks = false;
  }

  function backToList() {
    view = 'list';
    selectedId = null;
    pendingDelete = false;
    confirmClear = false;
  }

  /** Tool lookup so a stored check links back to its catalog tool. */
  const toolById = $derived(new Map(catalog.tools.map((tool) => [tool.id, tool])));

  /** @param {import('../types.js').InvestigationVerdict} verdict */
  function setVerdict(verdict) {
    if (selected) {
      history.setVerdict(selected.id, verdict);
    }
  }

  function addTag() {
    const tag = normalizeTag(tagDraft);
    if (!selected || tag === '' || selected.tags.includes(tag)) {
      tagDraft = '';
      return;
    }
    history.setTags(selected.id, [...selected.tags, tag]);
    tagDraft = '';
  }

  /** @param {string} tag */
  function removeTag(tag) {
    if (selected) {
      history.setTags(
        selected.id,
        selected.tags.filter((entry) => entry !== tag),
      );
    }
  }

  function saveNotes() {
    if (selected) {
      history.setNotes(selected.id, notesDraft);
      flash('Saved locally ✓');
    }
  }

  /**
   * @param {string} value
   * @param {string} message Confirmation shown once the copy succeeded.
   */
  async function copyValue(value, message) {
    try {
      await clipboard.copy(value);
      flash(message);
    } catch {
      flash('Copy failed');
    }
  }

  /** Re-runs the analysis on the normalized value; the entry is updated, not duplicated. */
  function rerun() {
    if (selected) {
      onAnalyze(selected.normalized);
    }
  }

  function deleteEntry() {
    if (selected) {
      history.remove(selected.id);
      backToList();
    }
  }

  function clearHistory() {
    history.clear();
    confirmClear = false;
    backToList();
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key === 'Escape' && open) {
      open = false;
    }
  }

  $effect(() => {
    const unsubscribe = history.subscribe(refresh);
    return unsubscribe;
  });

  $effect(() => {
    if (!open) {
      return;
    }
    refresh();
    searchEl?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="modal__backdrop">
    <!-- Full-size dismissal button behind the dialog: an accessible close target. -->
    <button
      type="button"
      class="modal__backdrop-button"
      aria-label="Close"
      onclick={() => (open = false)}
    ></button>
    <div
      class="modal modal--md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
      tabindex="-1"
    >
      <header class="modal__head">
        <div>
          <p class="modal__eyebrow">🗒 History</p>
          <h2 id="history-title" class="modal__title">Local investigation notebook</h2>
        </div>
        <button type="button" class="modal__close" aria-label="Close" onclick={() => (open = false)}>
          ✕
        </button>
      </header>

      <p class="modal__hint">
        Investigation history is stored locally in this browser: no account, no backend. Notes,
        tags and verdicts never leave the page — only the indicator itself reaches a provider when
        you run an analysis.
      </p>

      {#if feedback}
        <p class="hist__feedback" role="status">{feedback}</p>
      {/if}

      {#if view === 'detail' && selected}
        <div class="hist__detail">
          <button type="button" class="hist__back" onclick={backToList}>← All investigations</button>
          <h3 class="hist__ioc"><code>{selected.defanged}</code></h3>

          <dl class="hist__meta">
            <div><dt>Type</dt><dd>{typeLabel(selected)}</dd></div>
            <div><dt>First analyzed</dt><dd>{formatTimestamp(selected.firstAnalyzedAt)}</dd></div>
            <div><dt>Last analyzed</dt><dd>{formatTimestamp(selected.lastAnalyzedAt)}</dd></div>
          </dl>

          <section class="hist__section" aria-label="Analyst verdict">
            <h4 class="hist__section-title">Analyst verdict</h4>
            <p class="hist__note">
              Your own qualification. It is never derived from the provider answers below.
            </p>
            <div class="hist__verdicts">
              {#each INVESTIGATION_VERDICTS as verdict (verdict)}
                <button
                  type="button"
                  class="hist__verdict-button"
                  class:hist__verdict-button--active={selected.verdict === verdict}
                  aria-pressed={selected.verdict === verdict}
                  onclick={() => setVerdict(verdict)}
                >
                  {verdictLabel(verdict)}
                </button>
              {/each}
            </div>
          </section>

          <section class="hist__section" aria-label="Tags">
            <h4 class="hist__section-title">Tags</h4>
            {#if selected.tags.length > 0}
              <ul class="hist__tags">
                {#each selected.tags as tag (tag)}
                  <li class="hist__tag">
                    {tag}
                    <button
                      type="button"
                      class="hist__tag-remove"
                      aria-label={`Remove tag ${tag}`}
                      onclick={() => removeTag(tag)}>✕</button
                    >
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="hist__tag-add">
              <input
                bind:value={tagDraft}
                class="hist__tag-input"
                type="text"
                placeholder="Add a tag…"
                aria-label="Add a tag"
                spellcheck="false"
                onkeydown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
              />
              <button
                type="button"
                class="hist__secondary"
                disabled={tagDraft.trim() === ''}
                onclick={addTag}>Add tag</button
              >
            </div>
          </section>

          <section class="hist__section" aria-label="Provider results">
            <h4 class="hist__section-title">Provider results</h4>
            {#if selected.latestAnalysis}
              <p class="hist__note">
                Latest analysis: {formatTimestamp(selected.latestAnalysis.checkedAt)} UTC
              </p>
              {#if selected.latestAnalysis.checks.length === 0}
                <p class="hist__note">
                  Automated analysis: not available for this indicator type — only the deep links
                  below apply.
                </p>
              {:else}
                <ul class="checks" aria-label="Stored provider results">
                  {#each selected.latestAnalysis.checks as check (check.id)}
                    <li class="check">
                      <div class="check__head">
                        <span
                          class="check__dot"
                          class:check__dot--ok={check.status === 'ok'}
                          class:check__dot--empty={check.status === 'empty'}
                          class:check__dot--error={check.status === 'error'}
                          class:check__dot--cancelled={check.status === 'cancelled'}
                          aria-hidden="true"
                        ></span>
                        <span class="check__label">{check.label}</span>
                        <span class="check__state"
                          >{CHECK_STATUS_LABELS[check.status] ?? check.status}</span
                        >
                        {#if check.ms != null}
                          <span class="check__ms">{check.ms} ms</span>
                        {/if}
                        {#if check.toolId}
                          {@const tool = toolById.get(check.toolId)}
                          {#if tool}
                            <a
                              class="check__open"
                              href={tool.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open {tool.name} ↗
                            </a>
                          {/if}
                        {/if}
                      </div>
                      {#if check.summary}
                        <p class="check__summary">{check.summary}</p>
                      {/if}
                      {#if check.fields.length > 0}
                        <dl class="check__fields">
                          {#each check.fields as field (field.label)}
                            <div class="check__field">
                              <dt>{field.label}</dt>
                              <dd
                                class="check__value"
                                class:check__value--warn={field.tone === 'warn'}
                                class:check__value--bad={field.tone === 'bad'}
                                >{field.value}</dd
                              >
                            </div>
                          {/each}
                        </dl>
                      {/if}
                      {#if check.message}
                        <p
                          class="check__message"
                          class:check__message--error={check.status === 'error'}
                        >
                          {check.message}
                        </p>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            {:else}
              <p class="hist__note">
                No analysis stored yet — this indicator was kept manually, or no automated check is
                available for its type.
              </p>
            {/if}
          </section>

          <section class="hist__section" aria-label="Analyst notes">
            <h4 class="hist__section-title">Analyst notes</h4>
            <textarea
              bind:value={notesDraft}
              class="hist__notes"
              rows="5"
              placeholder="Observations, correlations, next steps…"
              aria-label="Analyst notes"
            ></textarea>
            <div class="hist__notes-actions">
              <button type="button" class="hist__primary" onclick={saveNotes}>Save notes</button>
              <span class="hist__note">Stored locally; never sent to the providers.</span>
            </div>
          </section>

          <section class="hist__section" aria-label="Actions">
            <h4 class="hist__section-title">Actions</h4>
            <div class="hist__actions">
              <button type="button" class="hist__primary" onclick={rerun}>Run analysis again</button>
              <button
                type="button"
                class="hist__secondary"
                onclick={() => copyValue(selected.normalized, 'IoC copied ✓')}>Copy IoC</button
              >
              <button
                type="button"
                class="hist__secondary"
                onclick={() => copyValue(selected.defanged, 'Defanged IoC copied ✓')}
                >Copy defanged IoC</button
              >
              <button
                type="button"
                class="hist__secondary"
                aria-expanded={showLinks}
                onclick={() => (showLinks = !showLinks)}>🧰 Open investigation tools</button
              >
              <button type="button" class="hist__danger" onclick={() => (pendingDelete = true)}>
                Delete from history
              </button>
            </div>

            {#if showLinks}
              {#if deepLinks.length > 0}
                <ul class="gofurther__list" aria-label="Open the indicator in a full tool">
                  {#each deepLinks as link (link.toolId)}
                    <li>
                      <a
                        class="gofurther__link"
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span class="gofurther__name">{link.name} ↗</span>
                        <span class="gofurther__hint">{link.hint}</span>
                      </a>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="hist__note">No catalog tool covers this indicator type.</p>
              {/if}
            {/if}

            {#if pendingDelete}
              <div
                class="hist__confirm"
                role="alertdialog"
                aria-label="Confirm deleting the investigation"
              >
                <p class="hist__confirm-text">
                  Delete this investigation from local history? This action cannot be undone.
                </p>
                <div class="hist__confirm-actions">
                  <button type="button" class="hist__danger" onclick={deleteEntry}>
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    class="hist__secondary"
                    onclick={() => (pendingDelete = false)}>Cancel</button
                  >
                </div>
              </div>
            {/if}
          </section>
        </div>
      {:else}
        <div class="hist__filters">
          <input
            bind:this={searchEl}
            bind:value={query}
            class="hist__search"
            type="search"
            placeholder="Search history…"
            aria-label="Search history"
          />
          <select class="hist__select" bind:value={filterTypeId} aria-label="Filter by IoC type">
            <option value="all">All types</option>
            {#each catalog.iocTypes as iocType (iocType.id)}
              <option value={iocType.id}>{iocType.label}</option>
            {/each}
          </select>
          <select
            class="hist__select"
            bind:value={filterVerdict}
            aria-label="Filter by analyst verdict"
          >
            <option value="all">All verdicts</option>
            {#each INVESTIGATION_VERDICTS as verdict (verdict)}
              <option value={verdict}>{verdictLabel(verdict)}</option>
            {/each}
          </select>
          <select
            class="hist__select"
            bind:value={filterTag}
            aria-label="Filter by tag"
            disabled={tags.length === 0}
          >
            <option value="all">All tags</option>
            {#each tags as tag (tag)}
              <option value={tag}>{tag}</option>
            {/each}
          </select>
        </div>

        <div class="hist__bar">
          <span class="hist__count" role="status">
            {filtered.length} of {entries.length} investigations
          </span>
          {#if entries.length > 0}
            <button type="button" class="hist__danger" onclick={() => (confirmClear = true)}>
              Clear history
            </button>
          {/if}
        </div>

        {#if confirmClear}
          <div class="hist__confirm" role="alertdialog" aria-label="Confirm clearing the history">
            <p class="hist__confirm-text">
              Delete all locally stored investigations? This will remove the analysis history, the
              analyst verdicts, the notes and the tags. Favorites will not be affected.
            </p>
            <div class="hist__confirm-actions">
              <button type="button" class="hist__danger" onclick={clearHistory}>
                Yes, clear history
              </button>
              <button
                type="button"
                class="hist__secondary"
                onclick={() => (confirmClear = false)}>Cancel</button
              >
            </div>
          </div>
        {/if}

        {#if entries.length === 0}
          <p class="hist__empty" role="status">
            No investigation stored yet. Run Fast analyze, use ⚡ Analyze selected in Extract IoCs, or
            keep an indicator with "Save to history".
          </p>
        {:else if filtered.length === 0}
          <p class="hist__empty" role="status">No investigation matches these filters.</p>
        {:else}
          <table class="hist__table">
            <thead>
              <tr>
                <th scope="col">IoC</th>
                <th scope="col">Type</th>
                <th scope="col">Analyst verdict</th>
                <th scope="col">Last analyzed</th>
              </tr>
            </thead>
            <tbody>
              {#each filtered as entry (entry.id)}
                <tr>
                  <td>
                    <button type="button" class="hist__open" onclick={() => openDetail(entry.id)}>
                      <code>{entry.defanged}</code>
                    </button>
                  </td>
                  <td>{typeLabel(entry)}</td>
                  <td>
                    <span
                      class="hist__verdict"
                      class:hist__verdict--unknown={entry.verdict === 'unknown'}
                      class:hist__verdict--benign={entry.verdict === 'benign'}
                      class:hist__verdict--suspicious={entry.verdict === 'suspicious'}
                      class:hist__verdict--malicious={entry.verdict === 'malicious'}
                      >{verdictLabel(entry.verdict)}</span
                    >
                  </td>
                  <td class="hist__date">{formatTimestamp(entry.lastAnalyzedAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}

      <p class="modal__foot">
        Everything here lives in this browser only. Clearing the history never touches the catalog
        favorites.
      </p>
    </div>
  </div>
{/if}

<style>
  /* Dialog chrome (backdrop, box, header, buttons, footer) is shared by every
     modal: see src/styles/components.css. Only the content below is local. */

  .hist__feedback {
    margin: 0;
    align-self: flex-start;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--color-success);
    background: var(--color-success-soft);
    border-radius: var(--radius-pill);
  }

  .hist__filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .hist__search {
    flex: 1 1 14rem;
    min-width: 0;
    padding: var(--space-2) var(--space-4);
    font: inherit;
    font-size: var(--font-size-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-pill);
  }

  .hist__search:focus,
  .hist__select:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-focus);
  }

  .hist__select {
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-xs);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .hist__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .hist__count {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
  }

  .hist__primary,
  .hist__secondary,
  .hist__danger {
    padding: var(--space-2) var(--space-4);
    font: inherit;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .hist__primary {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: none;
  }

  .hist__primary:hover {
    background: var(--color-accent-strong);
  }

  .hist__secondary {
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
  }

  .hist__secondary:hover:not(:disabled) {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .hist__secondary:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
  }

  .hist__danger {
    color: var(--color-danger);
    background: transparent;
    border: var(--border-width) solid var(--color-danger-border);
  }

  .hist__danger:hover {
    border-color: var(--color-danger);
    background: var(--color-danger-soft);
  }

  .hist__confirm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-danger-soft-weak);
    border: var(--border-width) solid var(--color-danger-border-strong);
    border-radius: var(--radius-md);
  }

  .hist__confirm-text {
    margin: 0;
    font-size: var(--font-size-xs);
  }

  .hist__confirm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .hist__empty {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .hist__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-xs);
    text-align: left;
  }

  .hist__table th {
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-2xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-snug);
    text-transform: uppercase;
    color: var(--color-text-muted);
    border-bottom: var(--border-width) solid var(--color-border);
  }

  .hist__table td {
    padding: var(--space-2);
    vertical-align: top;
    border-bottom: var(--border-width) solid var(--color-border-subtle);
  }

  .hist__open {
    padding: 0;
    font: inherit;
    color: var(--color-accent);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .hist__open code {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    word-break: break-all;
  }

  .hist__open:hover code {
    text-decoration: underline;
  }

  .hist__verdict {
    display: inline-block;
    padding: var(--pill-padding-y) var(--space-2);
    font-size: var(--font-size-2xs);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    color: var(--color-text-muted);
    background: var(--color-neutral-soft);
    border-radius: var(--radius-pill);
  }

  .hist__verdict--benign {
    color: var(--color-success);
    background: var(--color-success-soft);
  }

  .hist__verdict--suspicious {
    color: var(--color-warning);
    background: var(--color-warning-soft);
  }

  .hist__verdict--malicious {
    color: var(--color-danger);
    background: var(--color-danger-soft);
  }

  .hist__date {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .hist__verdict--unknown {
    color: var(--color-text-muted);
  }

  /* ---------- Investigation sheet ---------- */
  .hist__detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hist__back {
    align-self: flex-start;
    padding: 0;
    font: inherit;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .hist__back:hover {
    color: var(--color-accent);
  }

  .hist__ioc {
    margin: 0;
    font-size: var(--font-size-lg);
    word-break: break-all;
  }

  .hist__ioc code {
    font-family: var(--font-mono);
  }

  .hist__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
    margin: 0;
  }

  .hist__meta dt {
    font-size: var(--font-size-2xs);
    letter-spacing: var(--letter-spacing-snug);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .hist__meta dd {
    margin: 0 0 0;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }

  .hist__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .hist__section-title {
    margin: 0;
    font-size: var(--font-size-2xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-wide);
    text-transform: uppercase;
    color: var(--color-accent);
  }

  .hist__note {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .hist__verdicts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .hist__verdict-button {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .hist__verdict-button:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .hist__verdict-button--active {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border-color: var(--color-accent);
  }

  .hist__tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .hist__tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-xs);
    color: var(--color-text);
    background: var(--color-neutral-chip);
    border-radius: var(--radius-pill);
  }

  .hist__tag-remove {
    padding: 0;
    font: inherit;
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .hist__tag-remove:hover {
    color: var(--color-danger);
  }

  .hist__tag-add {
    display: flex;
    gap: var(--space-2);
  }

  .hist__tag-input {
    flex: 1 1 12rem;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-xs);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .hist__tag-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-focus);
  }

  .hist__notes {
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
    line-height: var(--line-height-tight);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    resize: vertical;
  }

  .hist__notes:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-focus);
  }

  .hist__notes-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .hist__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* ---------- Stored provider results ---------- */
  .checks {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .check {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .check__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .check__dot {
    width: var(--status-dot-size);
    height: var(--status-dot-size);
    border-radius: var(--radius-circle);
    background: var(--color-neutral-marker);
  }

  .check__dot--ok {
    background: var(--color-success);
    box-shadow: var(--shadow-glow-success);
  }

  .check__dot--empty {
    background: var(--color-accent);
  }

  .check__dot--error {
    background: var(--color-danger);
    box-shadow: var(--shadow-glow-danger);
  }

  .check__dot--cancelled {
    background: transparent;
    border: var(--border-width) solid var(--color-text-muted);
  }

  .check__label {
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-sm);
  }

  .check__state {
    font-size: var(--font-size-2xs);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-muted);
  }

  .check__ms {
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }

  .check__open {
    margin-left: auto;
    font-size: var(--font-size-2xs);
    font-weight: var(--font-weight-semibold);
    color: var(--color-accent);
    text-decoration: none;
  }

  .check__open:hover {
    text-decoration: underline;
  }

  .check__summary {
    margin: var(--space-1) 0 0;
    font-size: var(--font-size-xs);
  }

  .check__fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: var(--space-2) 0 0;
  }

  .check__field {
    display: flex;
    gap: var(--space-3);
  }

  .check__field dt {
    flex: 0 0 8.5rem;
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }

  .check__value {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    white-space: pre-line;
    word-break: break-word;
  }

  .check__value--warn {
    color: var(--color-warning);
  }

  .check__value--bad {
    color: var(--color-danger);
  }

  .check__message {
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .check__message--error {
    color: var(--color-danger);
  }

  .gofurther__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: var(--space-2);
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
  }

  .gofurther__link {
    display: flex;
    flex-direction: column;
    gap: 0;
    height: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: var(--transition-field);
  }

  .gofurther__link:hover {
    border-color: var(--color-accent);
  }

  .gofurther__name {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-accent);
  }

  .gofurther__hint {
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }
</style>
