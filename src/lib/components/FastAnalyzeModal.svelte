<script>
  import { untrack } from 'svelte';
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import ExportPanel from './ExportPanel.svelte';
  import { detectIocType } from '../utils/detect-ioc-type.js';
  import { getDeepLinks } from '../utils/deep-links.js';
  import { buildAnalysisSnapshot } from '../utils/history-filter.js';
  import { defangIoc, normalizeIoc } from '../utils/refang.js';

  /**
   * "Fast analyze" modal: paste an IoC, hit Start, and the free unauthenticated
   * APIs behind some catalog tools (ipapi.is, crt.sh) plus generic keyless
   * sources (RDAP) are queried straight from the browser. Each check reports
   * its own status so one failing provider never blocks the others; a
   * "go further" list then offers catalog tools opened with the IoC already
   * entered. When the main search box holds a query that is itself an IoC,
   * `prefill` seeds the input each time the modal opens; keyword queries are
   * ignored so they never overwrite the current input.
   *
   * @type {{ open?: boolean, catalog: import('../types.js').ToolCatalog, prefill?: string }}
   */
  let { open = $bindable(false), catalog, prefill = '' } = $props();

  /** @type {import('../services/fast-analyze.js').FastAnalyzerService} */
  const analyzer = inject(DI_TOKENS.fastAnalyzer);
  /** @type {import('../services/investigation-history.js').InvestigationHistoryService} */
  const history = inject(DI_TOKENS.investigations);

  let value = $state('');
  /** @type {'idle' | 'running' | 'done'} */
  let phase = $state('idle');
  /** @type {string | null} */
  let iocTypeId = $state(null);
  let submittedValue = $state('');
  /** @type {string} */
  let notice = $state('');
  let finishedAt = $state('');
  let submittedRaw = $state('');
  let showExport = $state(false);

  /**
   * One entry per check of the current run, updated in place as the promises
   * settle (Svelte 5 deep proxies keep the list reactive).
   *
   * @type {{ def: import('../types.js').FastCheckDefinition,
   *          status: 'pending' | 'ok' | 'empty' | 'error',
   *          result: import('../types.js').FastCheckResult | null,
   *          ms: number | null }[]}
   */
  let checks = $state([]);

  const toolById = $derived(new Map(catalog.tools.map((tool) => [tool.id, tool])));
  const deepLinks = $derived(
    iocTypeId && submittedValue !== '' ? getDeepLinks(iocTypeId, submittedValue, catalog.tools) : [],
  );
  // Live preview of the detected type while the user types (before Start).
  const detectedPreview = $derived(detectIocType(value));

  /** @type {HTMLInputElement | undefined} */
  let inputEl = $state();
  /** @type {AbortController | undefined} */
  let runController;

  $effect(() => {
    if (!open) {
      return;
    }
    resetResults();
    // Seed the input from the main search box when it holds a recognizable IoC.
    // A keyword is deliberately ignored: it would only trip the "not an IoC"
    // warning, and the previous indicator (if any) is left untouched. Read
    // inside untrack() so this effect stays driven by `open` alone — otherwise
    // typing in the main box while the modal is open would reset the results.
    untrack(() => {
      const seed = prefill.trim();
      if (seed !== '' && detectIocType(seed)) {
        value = seed;
      }
    });
    inputEl?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      abortInFlight();
    };
  });

  function close() {
    open = false;
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key === 'Escape') {
      close();
    }
  }

  function resetResults() {
    abortInFlight();
    phase = 'idle';
    iocTypeId = null;
    submittedValue = '';
    submittedRaw = '';
    finishedAt = '';
    showExport = false;
    checks = [];
    notice = '';
  }

  function abortInFlight() {
    runController?.abort();
    runController = undefined;
  }

  function start() {
    const detected = detectIocType(value);
    if (!detected) {
      notice =
        'This does not look like an IoC. Supported shapes: IP, domain, URL, MD5/SHA-1/SHA-256 hash, email.';
      return;
    }
    notice = '';
    abortInFlight();
    runController = new AbortController();
    iocTypeId = detected;
    // Normalized (refanged, canonical) value: it is what providers receive and
    // what keys the local investigation history, so `EXAMPLE.COM` and
    // `example.com` are one investigation (AC14).
    submittedRaw = value.trim();
    submittedValue = normalizeIoc(value, detected);
    finishedAt = '';
    showExport = false;
    const definitions = analyzer.getChecks(detected);
    checks = definitions.map((def) => ({ def, status: /** @type {'pending'} */ ('pending'), result: null, ms: null }));
    if (definitions.length === 0) {
      phase = 'done';
      finishedAt = new Date().toISOString();
      notice =
        'No free unauthenticated API can check this IoC type directly from the browser — open a tool below to go further.';
      return;
    }
    phase = 'running';
    let pending = definitions.length;
    definitions.forEach((def, index) => {
      const startedAt = performance.now();
      def.run(submittedValue, { signal: runController?.signal })
        .then((result) => {
          checks[index].status = result.status;
          checks[index].result = result;
          checks[index].ms = Math.round(performance.now() - startedAt);
        })
        .catch(() => {
          checks[index].status = 'error';
          checks[index].result = {
            status: 'error',
            summary: null,
            fields: [],
            message: 'Unexpected failure.',
          };
        })
        .finally(() => {
          pending -= 1;
          if (pending === 0) {
            finishedAt = new Date().toISOString();
            phase = 'done';
            saveToHistory();
          }
        });
    });
  }

  /**
   * Records the finished run in the local investigation history: the entry is
   * created on the first analysis of the indicator and updated afterwards
   * (never duplicated), leaving the analyst verdict, notes and tags untouched.
   * Investigating by hand here means a `manual` provenance (US V1.5).
   */
  function saveToHistory() {
    if (!iocTypeId || submittedValue === '' || checks.length === 0) {
      return;
    }
    const typeId = /** @type {import('../types.js').IocTypeId} */ (iocTypeId);
    history.upsert(
      {
        id: `${typeId}:${submittedValue}`,
        typeId,
        normalized: submittedValue,
        defanged: defangIoc(submittedValue, typeId),
      },
      buildAnalysisSnapshot(checks, finishedAt || new Date().toISOString()),
      'manual',
    );
  }

  /**
   * Session-only export input (AC14): the current run merged with whatever the
   * history already knows (verdict, tags, notes, dates). Reading the history
   * never writes to it — the export leaves `lastAnalyzedAt` untouched.
   *
   * @returns {import('../types.js').ExportInput | null}
   */
  function buildSessionExport() {
    if (!iocTypeId || submittedValue === '' || phase !== 'done') {
      return null;
    }
    const typeId = /** @type {import('../types.js').IocTypeId} */ (iocTypeId);
    const stored = history.get(`${typeId}:${submittedValue}`);
    return {
      typeId,
      normalized: submittedValue,
      defanged: defangIoc(submittedValue, typeId),
      raw: submittedRaw,
      firstAnalyzedAt: stored?.firstAnalyzedAt ?? finishedAt,
      lastAnalyzedAt: stored?.lastAnalyzedAt ?? finishedAt,
      verdict: stored?.verdict ?? 'unknown',
      tags: stored?.tags ?? [],
      notes: stored?.notes ?? '',
      source: stored?.source ?? 'manual',
      latestAnalysis: buildAnalysisSnapshot(checks, finishedAt || new Date().toISOString()),
    };
  }
  const sessionExport = $derived(buildSessionExport());

  /** @param {string} iocType @returns {string} */
  function iocLabel(iocType) {
    return catalog.iocTypes.find((entry) => entry.id === iocType)?.label ?? iocType;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="modal__backdrop">
    <!-- Full-size dismissal button behind the dialog: an accessible close target. -->
    <button type="button" class="modal__backdrop-button" aria-label="Close" onclick={close}></button>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fast-analyze-title"
      tabindex="-1"
    >
      <header class="modal__head">
        <div>
          <p class="modal__eyebrow">⚡ Fast analyze</p>
          <h2 id="fast-analyze-title" class="modal__title">Quick lookups for one IoC</h2>
        </div>
        <button type="button" class="modal__close" aria-label="Close" onclick={close}>✕</button>
      </header>

      <p class="modal__hint">
        Paste an indicator: free, no-account APIs are queried directly from your browser for a first
        read, then open a tool below to go further.
      </p>

      <form
        class="modal__form"
        onsubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <input
          bind:this={inputEl}
          bind:value
          class="modal__input"
          type="text"
          placeholder="IP, domain, URL, hash or email…"
          aria-label="Indicator of compromise"
          spellcheck="false"
          autocomplete="off"
        />
        <button type="submit" class="modal__start" disabled={phase === 'running' || value.trim() === ''}>
          Start
        </button>
      </form>

      {#if value.trim() !== '' && detectedPreview}
        <p class="modal__detect" role="status">
          Detected: <strong>{iocLabel(detectedPreview)}</strong>
        </p>
      {:else if value.trim() !== ''}
        <p class="modal__detect modal__detect--warn" role="status">
          Not recognized as an IP, domain, URL, hash or email.
        </p>
      {/if}

      {#if notice}
        <p class="modal__notice" role="status">{notice}</p>
      {/if}

      {#if checks.length > 0}
        <ul class="checks" aria-live="polite" aria-label="Fast analysis results">
          {#each checks as check (check.def.id)}
            <li class="check">
              <div class="check__head">
                <span
                  class="check__dot"
                  class:check__dot--ok={check.status === 'ok'}
                  class:check__dot--empty={check.status === 'empty'}
                  class:check__dot--error={check.status === 'error'}
                  class:check__dot--pending={check.status === 'pending'}
                  aria-hidden="true"
                ></span>
                <span class="check__label">{check.def.label}</span>
                {#if check.ms != null}
                  <span class="check__ms">{check.ms} ms</span>
                {/if}
                {#if check.def.toolId}
                  {@const tool = toolById.get(check.def.toolId)}
                  {#if tool}
                    <a class="check__open" href={tool.url} target="_blank" rel="noopener noreferrer">
                      Open {tool.name} ↗
                    </a>
                  {/if}
                {/if}
              </div>
              {#if check.status === 'pending'}
                <p class="check__pending">Checking…</p>
              {:else if check.result}
                {#if check.result.summary}
                  <p class="check__summary">{check.result.summary}</p>
                {/if}
                {#if check.result.fields.length > 0}
                  <dl class="check__fields">
                    {#each check.result.fields as field (field.label)}
                      <div class="check__field">
                        <dt>{field.label}</dt>
                        <dd
                          class="check__value"
                          class:check__value--warn={field.tone === 'warn'}
                          class:check__value--bad={field.tone === 'bad'}
                        >
                          {field.value}
                        </dd>
                      </div>
                    {/each}
                  </dl>
                {/if}
                {#if check.result.message}
                  <p class="check__message" class:check__message--error={check.status === 'error'}>
                    {check.result.message}
                  </p>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if deepLinks.length > 0}
        <section class="gofurther" aria-label="Open the IoC in a full tool">
          <h3 class="gofurther__title">Go further</h3>
          <ul class="gofurther__list">
            {#each deepLinks as link (link.toolId)}
              <li>
                <a class="gofurther__link" href={link.url} target="_blank" rel="noopener noreferrer">
                  <span class="gofurther__name">{link.name} ↗</span>
                  <span class="gofurther__hint">{link.hint}</span>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if sessionExport}
        <div class="export__trigger">
          <button
            type="button"
            class="fast__export"
            aria-expanded={showExport}
            onclick={() => (showExport = !showExport)}>⬇ Export</button
          >
        </div>
        {#if showExport}
          <ExportPanel investigations={[sessionExport]} {catalog} title="Export investigation" />
        {/if}
      {/if}

      <p class="modal__foot">
        Queries go straight from your browser to the providers (no account, no key, nothing sent to
        this site). Only investigate indicators you are authorized to.
      </p>
    </div>
  </div>
{/if}

<style>
  /* Dialog chrome (backdrop, box, header, buttons, footer) is shared by every
     modal: see src/styles/components.css. Only the content below is local. */

  .export__trigger {
    display: flex;
    justify-content: flex-end;
  }

  .fast__export {
    padding: var(--space-2) var(--space-4);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-muted);
    background: transparent;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .fast__export:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .checks {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .check {
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface);
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

  .check__dot--pending {
    animation: check-pulse 1.2s ease-in-out infinite;
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

  @keyframes check-pulse {
    0%,
    100% {
      opacity: var(--opacity-pulse-min);
    }
    50% {
      opacity: 1;
    }
  }

  .check__label {
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-base);
  }

  .check__ms {
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }

  .check__open {
    margin-left: auto;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--color-accent);
    text-decoration: none;
  }

  .check__open:hover {
    text-decoration: underline;
  }

  .check__pending {
    margin: var(--space-1) 0 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .check__summary {
    margin: var(--space-1) 0 0;
    font-size: var(--font-size-sm);
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
    font-size: var(--font-size-xs);
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

  .gofurther__title {
    margin: var(--space-1) 0 0;
    font-size: var(--font-size-2xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-wide);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .gofurther__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  .gofurther__link {
    display: flex;
    flex-direction: column;
    gap: 0;
    height: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
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

  .modal__foot {
    margin: var(--space-1) 0 0;
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }
</style>
