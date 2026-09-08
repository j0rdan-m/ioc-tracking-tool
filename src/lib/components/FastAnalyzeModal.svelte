<script>
  import { untrack } from 'svelte';
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { detectIocType } from '../utils/detect-ioc-type.js';
  import { getDeepLinks } from '../utils/deep-links.js';

  /**
   * "Fast analyze" modal: paste an IoC, hit Start, and the free unauthenticated
   * APIs behind some catalog tools (ipapi.is, crt.sh) plus generic keyless
   * sources (RDAP) are queried straight from the browser. Each check reports
   * its own status so one failing provider never blocks the others; a
   * "go further" list then offers catalog tools opened with the IoC already
   * entered. When the main search box holds a query, `prefill` seeds the input
   * each time the modal opens.
   *
   * @type {{ open?: boolean, catalog: import('../types.js').ToolCatalog, prefill?: string }}
   */
  let { open = $bindable(false), catalog, prefill = '' } = $props();

  /** @type {import('../services/fast-analyze.js').FastAnalyzerService} */
  const analyzer = inject(DI_TOKENS.fastAnalyzer);

  let value = $state('');
  /** @type {'idle' | 'running' | 'done'} */
  let phase = $state('idle');
  /** @type {string | null} */
  let iocTypeId = $state(null);
  let submittedValue = $state('');
  /** @type {string} */
  let notice = $state('');

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
    // Seed the input from the main search box when it holds something. Read
    // inside untrack() so this effect stays driven by `open` alone — otherwise
    // typing in the main box while the modal is open would reset the results.
    untrack(() => {
      const seed = prefill.trim();
      if (seed !== '') {
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
    submittedValue = value.trim();
    const definitions = analyzer.getChecks(detected);
    checks = definitions.map((def) => ({ def, status: /** @type {'pending'} */ ('pending'), result: null, ms: null }));
    if (definitions.length === 0) {
      phase = 'done';
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
            phase = 'done';
          }
        });
    });
  }

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

      <p class="modal__foot">
        Queries go straight from your browser to the providers (no account, no key, nothing sent to
        this site). Only investigate indicators you are authorized to.
      </p>
    </div>
  </div>
{/if}

<style>
  .modal__backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    padding: 2rem 1rem;
    overflow-y: auto;
    background: rgb(2 8 23 / 0.72);
    backdrop-filter: blur(4px);
  }

  /* Invisible button covering the backdrop so clicking outside the dialog
     is a real, keyboard-reachable close action. */
  .modal__backdrop-button {
    position: absolute;
    inset: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .modal {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    width: min(40rem, 100%);
    margin: auto;
    padding: 1.5rem;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
  }

  .modal__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .modal__eyebrow {
    margin: 0 0 0.15rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-accent);
  }

  .modal__title {
    margin: 0;
    font-size: 1.25rem;
    letter-spacing: -0.01em;
  }

  .modal__close {
    padding: 0.25rem 0.6rem;
    font: inherit;
    font-size: 0.9rem;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    cursor: pointer;
    transition:
      color 0.15s ease,
      border-color 0.15s ease;
  }

  .modal__close:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .modal__hint {
    margin: 0;
    font-size: 0.88rem;
    color: var(--color-text-muted);
  }

  .modal__form {
    display: flex;
    gap: 0.6rem;
  }

  .modal__input {
    flex: 1;
    min-width: 0;
    padding: 0.55rem 1rem;
    font: inherit;
    font-family: var(--font-mono);
    font-size: 0.92rem;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .modal__input::placeholder {
    font-family: var(--font-body);
    color: var(--color-text-muted);
  }

  .modal__input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px rgb(56 189 248 / 0.18);
  }

  .modal__start {
    padding: 0.55rem 1.4rem;
    font: inherit;
    font-weight: 600;
    color: #08131f;
    background: var(--color-accent);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .modal__start:hover:not(:disabled) {
    background: var(--color-accent-strong);
  }

  .modal__start:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .modal__detect,
  .modal__notice {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .modal__detect--warn,
  .modal__notice {
    color: var(--color-text);
  }

  .modal__detect--warn {
    color: rgb(250 204 21);
  }

  .checks {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .check {
    padding: 0.75rem 0.9rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
  }

  .check__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .check__dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: rgb(148 163 184 / 0.7);
  }

  .check__dot--pending {
    animation: check-pulse 1.2s ease-in-out infinite;
  }

  .check__dot--ok {
    background: var(--color-success);
    box-shadow: 0 0 6px rgb(74 222 128 / 0.8);
  }

  .check__dot--empty {
    background: var(--color-accent);
  }

  .check__dot--error {
    background: var(--color-danger);
    box-shadow: 0 0 6px rgb(248 113 113 / 0.8);
  }

  @keyframes check-pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 1;
    }
  }

  .check__label {
    font-weight: 600;
    font-size: 0.92rem;
  }

  .check__ms {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }

  .check__open {
    margin-left: auto;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-accent);
    text-decoration: none;
  }

  .check__open:hover {
    text-decoration: underline;
  }

  .check__pending {
    margin: 0.35rem 0 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .check__summary {
    margin: 0.35rem 0 0;
    font-size: 0.88rem;
  }

  .check__fields {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin: 0.5rem 0 0;
  }

  .check__field {
    display: flex;
    gap: 0.75rem;
  }

  .check__field dt {
    flex: 0 0 8.5rem;
    font-size: 0.78rem;
    color: var(--color-text-muted);
  }

  .check__value {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    white-space: pre-line;
    word-break: break-word;
  }

  .check__value--warn {
    color: rgb(250 204 21);
  }

  .check__value--bad {
    color: var(--color-danger);
  }

  .check__message {
    margin: 0.4rem 0 0;
    font-size: 0.82rem;
    color: var(--color-text-muted);
  }

  .check__message--error {
    color: var(--color-danger);
  }

  .gofurther__title {
    margin: 0.25rem 0 0;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .gofurther__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: 0.5rem;
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }

  .gofurther__link {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    height: 100%;
    padding: 0.55rem 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    text-decoration: none;
    transition: border-color 0.15s ease;
  }

  .gofurther__link:hover {
    border-color: var(--color-accent);
  }

  .gofurther__name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-accent);
  }

  .gofurther__hint {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .modal__foot {
    margin: 0.25rem 0 0;
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }
</style>
