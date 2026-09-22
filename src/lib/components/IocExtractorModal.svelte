<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { computeBatchStatus, runBatchAnalysis } from '../utils/batch-analyze.js';
  import { extractIocs } from '../utils/extract-iocs.js';
  import { getDeepLinks } from '../utils/deep-links.js';
  import { buildAnalysisSnapshot } from '../utils/history-filter.js';

  /**
   * "Extract IoCs" modal: paste a whole text (log, ticket, e-mail body) and the
   * indicators it contains are detected, refanged, normalized and listed —
   * entirely in the browser, nothing is sent anywhere. Each indicator offers
   * copy actions (raw / normalized / defanged), a Fast analyze hand-off when
   * its type has keyless checks, and "go further" deep links revealed only by
   * an explicit click. The pasted text and the results survive close/reopen so
   * the analyst can edit and re-extract.
   *
   * The same list drives the batch analysis: selected indicators run their
   * compatible checks in one operation (3 IoCs at a time), progressively
   * filling a consolidated table whose rows expand into the raw provider
   * answers. Stopping keeps what already settled.
   *
   * @type {{ open?: boolean, catalog: import('../types.js').ToolCatalog,
   *          onAnalyze?: (normalized: string) => void }}
   */
  let { open = $bindable(false), catalog, onAnalyze = () => {} } = $props();

  /** @type {import('../services/clipboard.js').ClipboardService} */
  const clipboard = inject(DI_TOKENS.clipboard);
  /** @type {import('../services/fast-analyze.js').FastAnalyzerService} */
  const analyzer = inject(DI_TOKENS.fastAnalyzer);
  /** @type {import('../services/investigation-history.js').InvestigationHistoryService} */
  const history = inject(DI_TOKENS.investigations);

  let text = $state('');
  /** @type {import('../utils/extract-iocs.js').ExtractIocsResult | null} */
  let result = $state(null);

  /** @type {HTMLTextAreaElement | undefined} */
  let textareaEl = $state();

  /** IoC types the extractor can produce. */
  /** @type {('ip' | 'domain' | 'url' | 'file' | 'email')[]} */
  const EXTRACTED_TYPES = ['ip', 'domain', 'url', 'file', 'email'];

  // Types backed by a keyless check: handing a value over to Fast analyze only
  // makes sense for those (a hash would land on an empty check list).
  const analyzableTypes = $derived(
    new Set(EXTRACTED_TYPES.filter((type) => analyzer.getChecks(type).length > 0)),
  );

  /** Compact list labels; hashes carry their digest kind (MD5 / SHA-1 / SHA-256). */
  const LABELS = { ip: 'IP', domain: 'Domain', url: 'URL', file: 'Hash', email: 'Email' };

  /**
   * @param {import('../types.js').ExtractedIoc} ioc
   * @returns {string}
   */
  function iocLabel(ioc) {
    return ioc.typeId === 'file' && ioc.hashKind ? ioc.hashKind : LABELS[ioc.typeId];
  }

  // "Investigate" rows start collapsed so no external link can be reached
  // without an explicit, deliberate click.
  /** @type {string[]} */
  let expandedIds = $state([]);

  // Deep links of the currently expanded indicators, built on demand.
  const deepLinksById = $derived(
    new Map(
      expandedIds.map((id) => {
        const ioc = result?.iocs.find((entry) => entry.id === id) ?? null;
        return [id, ioc ? getDeepLinks(ioc.typeId, ioc.normalized, catalog.tools) : []];
      }),
    ),
  );

  /** Tool lookup used by the detail blocks to link back to the catalog. */
  const toolById = $derived(new Map(catalog.tools.map((tool) => [tool.id, tool])));

  // --- Batch analysis ------------------------------------------------------
  // Every fresh extraction selects all the indicators it found, so "Analyze
  // selected" works right after a paste. Selection only decides what the next
  // batch runs: the IoCs themselves are normalized by the extractor.
  /** @type {string[]} */
  let selectedIds = $state([]);
  /** Snapshots emitted by the batch runner; assigned on every update so Svelte
   *  sees the changes (the runner mutates its own rows). */
  /** @type {import('../types.js').BatchRow[]} */
  let batchRows = $state([]);
  let analysisRunning = $state(false);
  let stopping = $state(false);
  /** Ids whose detailed block is expanded. */
  /** @type {string[]} */
  let detailIds = $state([]);
  /** @type {ReturnType<typeof runBatchAnalysis> | null} */
  let batchRun = null;
  // Incremented on every launch so a late update (or the completion) of a
  // previous batch can never overwrite the state of the current one.
  let batchGeneration = 0;

  /** Check states considered final for the progress gauge. */
  /** @type {import('../types.js').BatchCheckStatus[]} */
  const SETTLED_STATUSES = ['ok', 'empty', 'error', 'cancelled'];

  const progress = $derived.by(() => {
    const total = batchRows.reduce((count, row) => count + row.checkStates.length, 0);
    const settled = batchRows.reduce(
      (count, row) =>
        count + row.checkStates.filter((state) => SETTLED_STATUSES.includes(state.status)).length,
      0,
    );
    return { total, settled, percent: total === 0 ? 0 : Math.round((settled / total) * 100) };
  });

  /** @type {Record<import('../types.js').BatchCheckStatus, string>} */
  const CHECK_STATUS_LABELS = {
    pending: 'Pending',
    running: 'Running',
    ok: 'OK',
    empty: 'Empty',
    error: 'Error',
    cancelled: 'Cancelled',
  };

  /**
   * @param {import('../types.js').BatchCheckStatus} status
   * @returns {string}
   */
  function checkStatusLabel(status) {
    return CHECK_STATUS_LABELS[status];
  }

  /**
   * Short table cell for a check column; "—" when the IoC type has no such
   * check at all (e.g. no TLS column for an IP).
   *
   * @param {import('../types.js').BatchCheckState | null} state
   * @returns {string}
   */
  function checkCell(state) {
    if (!state) {
      return '—';
    }
    if (state.status === 'ok') return '✓ OK';
    if (state.status === 'empty') return '∅ Empty';
    if (state.status === 'error') return '✗ Error';
    if (state.status === 'cancelled') return '⊘ Cancelled';
    return state.status === 'running' ? '… Running' : '… Pending';
  }

  /**
   * @param {import('../types.js').BatchRow} row
   * @param {string} needle Part of the check id (`intel`, `rdap`, `certs`).
   * @returns {import('../types.js').BatchCheckState | null}
   */
  function findCheck(row, needle) {
    return row.checkStates.find((state) => state.def.id.includes(needle)) ?? null;
  }

  /**
   * @param {import('../types.js').BatchCheckState | null} state
   * @param {string} label
   * @returns {string | null}
   */
  function fieldValue(state, label) {
    return state?.result?.fields?.find((field) => field.label === label)?.value ?? null;
  }

  /**
   * "ASN / Network" column: IP intelligence when the provider answered,
   * otherwise the RDAP network name (IPs only — other types show "—").
   *
   * @param {import('../types.js').BatchRow} row
   * @returns {string}
   */
  function networkCell(row) {
    const intel = findCheck(row, 'intel');
    if (intel?.status === 'ok') {
      const value = [fieldValue(intel, 'ASN'), fieldValue(intel, 'Company')]
        .filter(Boolean)
        .join(' · ');
      return value !== '' ? value : '✓';
    }
    const rdap = findCheck(row, 'rdap');
    const network = fieldValue(rdap, 'Network');
    return rdap?.status === 'ok' && network ? network : '—';
  }

  /**
   * "TLS" column: number of certificate entries reported by crt.sh.
   *
   * @param {import('../types.js').BatchRow} row
   * @returns {string}
   */
  function tlsCell(row) {
    const certs = findCheck(row, 'certs');
    if (certs?.status === 'ok') {
      const count = certs.result?.summary?.match(/\d+/)?.[0];
      return count ? `${count} certs` : '✓ OK';
    }
    return checkCell(certs);
  }

  /** @param {string} id */
  function toggleSelected(id) {
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter((entry) => entry !== id)
      : [...selectedIds, id];
  }

  function selectAll() {
    selectedIds = (result?.iocs ?? []).map((ioc) => ioc.id);
  }

  function deselectAll() {
    selectedIds = [];
  }

  /** @param {string} id */
  function toggleDetail(id) {
    detailIds = detailIds.includes(id)
      ? detailIds.filter((entry) => entry !== id)
      : [...detailIds, id];
  }

  // Ids already written to the local history during the current batch.
  /** @type {Set<string>} */
  const recordedIds = new Set();

  /**
   * Records every row that reached a final state in the local investigation
   * history. The entry is created on the first analysis of the indicator and
   * updated afterwards, never duplicated. Cancelled rows are skipped: they
   * never ran, so they must not replace an earlier snapshot.
   *
   * @param {import('../types.js').BatchRow[]} rows
   */
  function recordFinishedRows(rows) {
    for (const row of rows) {
      const status = computeBatchStatus(row.checkStates);
      if (status === 'Pending' || status === 'Running' || status === 'Cancelled') {
        continue;
      }
      if (recordedIds.has(row.ioc.id)) {
        continue;
      }
      recordedIds.add(row.ioc.id);
      history.upsert(row.ioc, buildAnalysisSnapshot(row.checkStates, new Date().toISOString()));
    }
  }

  /** Explicit "keep this indicator" action: no analysis, but a stored entry. */
  /** @type {string | null} */
  let savedKey = $state(null);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let savedTimer;

  /** @param {import('../types.js').ExtractedIoc} ioc */
  function saveIoc(ioc) {
    history.upsert(ioc);
    savedKey = ioc.id;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedKey = null), 2000);
  }

  /**
   * Runs the compatible checks for every selected IoC, at most 3 IoCs at a
   * time (each IoC runs its own checks in parallel). Results are published
   * progressively through the runner's snapshots — the table never waits for
   * the whole batch to finish.
   */
  function analyzeSelected() {
    const iocs = (result?.iocs ?? []).filter((ioc) => selectedIds.includes(ioc.id));
    if (iocs.length === 0) {
      return;
    }
    batchGeneration += 1;
    const generation = batchGeneration;
    recordedIds.clear();
    detailIds = [];
    batchRows = [];
    stopping = false;
    analysisRunning = true;
    const run = runBatchAnalysis(
      iocs,
      (typeId) => analyzer.getChecks(/** @type {import('../types.js').IocTypeId} */ (typeId)),
      {
        concurrency: 3,
        onUpdate: (rows) => {
          // A superseded batch must not keep feeding the table.
          if (generation === batchGeneration) {
            batchRows = rows;
            recordFinishedRows(rows);
          }
        },
      },
    );
    batchRun = run;
    run.done.then(() => {
      if (generation !== batchGeneration) {
        return;
      }
      analysisRunning = false;
      stopping = false;
      batchRun = null;
    });
  }

  /** Stops the running batch: in-flight checks settle, queued IoCs cancel. */
  function stopAnalysis() {
    stopping = true;
    batchRun?.stop();
  }

  /** @type {string | null} Last copy outcome, as `<iocId>:<variant>` (or with a `:failed` suffix). */
  let copiedKey = $state(null);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resetTimer;

  /**
   * Copies one variant of an indicator through the injected clipboard service.
   *
   * @param {import('../types.js').ExtractedIoc} ioc
   * @param {'raw' | 'normalized' | 'defanged'} variant
   */
  async function copy(ioc, variant) {
    const key = `${ioc.id}:${variant}`;
    try {
      await clipboard.copy(ioc[variant]);
      copiedKey = key;
    } catch {
      copiedKey = `${key}:failed`;
    } finally {
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (copiedKey = null), 2000);
    }
  }

  function extract() {
    if (text.trim() === '') {
      return;
    }
    // A new extraction invalidates the previous batch and selects everything
    // it found, so "Analyze selected" is immediately usable.
    batchRun?.stop();
    batchRun = null;
    result = extractIocs(text);
    selectedIds = result.iocs.map((ioc) => ioc.id);
    batchRows = [];
    detailIds = [];
    analysisRunning = false;
    stopping = false;
  }

  function clearAll() {
    batchRun?.stop();
    batchRun = null;
    text = '';
    result = null;
    expandedIds = [];
    selectedIds = [];
    batchRows = [];
    detailIds = [];
    analysisRunning = false;
    stopping = false;
  }

  /** @param {string} id */
  function toggleInvestigate(id) {
    expandedIds = expandedIds.includes(id)
      ? expandedIds.filter((entry) => entry !== id)
      : [...expandedIds, id];
  }

  /**
   * Hands the normalized value over to Fast analyze: App closes this modal and
   * opens the other one seeded with it (the value is by construction a valid
   * IoC, so the modal's prefill guard accepts it).
   *
   * @param {import('../types.js').ExtractedIoc} ioc
   */
  function analyze(ioc) {
    open = false;
    onAnalyze(ioc.normalized);
  }

  function close() {
    // Closing stops any running batch: no request is issued while the results
    // are out of sight, and everything already obtained is kept for the next
    // opening.
    batchRun?.stop();
    open = false;
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key === 'Escape') {
      close();
    }
  }

  /** @param {KeyboardEvent} event Ctrl/Cmd+Enter runs the extraction. */
  function onTextareaKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      extract();
    }
  }

  $effect(() => {
    if (!open) {
      return;
    }
    textareaEl?.focus();
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
    <button type="button" class="modal__backdrop-button" aria-label="Close" onclick={close}></button>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extract-iocs-title"
      tabindex="-1"
    >
      <header class="modal__head">
        <div>
          <p class="modal__eyebrow">🔍 Extract IoCs</p>
          <h2 id="extract-iocs-title" class="modal__title">Pull indicators out of a pasted text</h2>
        </div>
        <button type="button" class="modal__close" aria-label="Close" onclick={close}>✕</button>
      </header>

      <p class="modal__hint">
        Paste a log, a ticket or an e-mail body: the indicators it contains — defanged or not — are
        detected, refanged and listed. Everything runs in your browser, nothing is sent anywhere.
      </p>

      <form
        class="modal__form"
        onsubmit={(event) => {
          event.preventDefault();
          extract();
        }}
      >
        <textarea
          bind:this={textareaEl}
          bind:value={text}
          class="modal__textarea"
          rows="7"
          placeholder={'176.128.43.70\nexample[.]com\nhxxps://evil[.]example[.]com/login\nuser[@]example[.]com\n44d88612fea8a8f36de82e1278abb02f'}
          aria-label="Text to analyze"
          spellcheck="false"
          onkeydown={onTextareaKeydown}
        ></textarea>
        <div class="modal__form-actions">
          <button type="submit" class="modal__start" disabled={text.trim() === ''}>Extract</button>
          <button type="button" class="modal__clear" onclick={clearAll} disabled={text === '' && !result}>
            Clear
          </button>
        </div>
      </form>

      {#if result?.warning}
        <p class="modal__notice" role="status">{result.warning}</p>
      {/if}

      {#if result}
        {#if result.iocs.length === 0}
          <p class="modal__notice" role="status">No indicator of compromise detected.</p>
        {:else}
          <p class="modal__count" role="status">
            {result.iocs.length}
            IoC{result.iocs.length === 1 ? '' : 's'} detected
          </p>

          <!-- Selection: what the next batch will analyse (all by default). -->
          <div class="batch__bar">
            <span class="batch__selected" role="status">
              {selectedIds.length}
              IoC selected
            </span>
            <button type="button" class="ioc__copy" onclick={selectAll}>Select all</button>
            <button type="button" class="ioc__copy" onclick={deselectAll}>Deselect all</button>
            <button
              type="button"
              class="ioc__analyze"
              disabled={selectedIds.length === 0 || analysisRunning}
              title="Run the compatible keyless checks for every selected IoC"
              onclick={analyzeSelected}
            >
              ⚡ Analyze selected
            </button>
            {#if analysisRunning}
              <button type="button" class="ioc__copy" disabled={stopping} onclick={stopAnalysis}>
                {stopping ? 'Stopping…' : 'Stop analysis'}
              </button>
            {/if}
          </div>

          <ul class="iocs" aria-label="Extracted indicators">
            {#each result.iocs as ioc (ioc.id)}
              <li class="ioc">
                <div class="ioc__head">
                  <div class="ioc__ident">
                    <input
                      class="ioc__check"
                      type="checkbox"
                      checked={selectedIds.includes(ioc.id)}
                      aria-label={`Select ${ioc.normalized} for batch analysis`}
                      onchange={() => toggleSelected(ioc.id)}
                    />
                    <span class="ioc__type">{iocLabel(ioc)}</span>
                  </div>
                  <div class="ioc__actions">
                    {#each [['raw', 'Copy raw'], ['normalized', 'Copy normalized'], ['defanged', 'Copy defanged']] as [variant, label] (variant)}
                      <button
                        type="button"
                        class="ioc__copy"
                        class:ioc__copy--copied={copiedKey === `${ioc.id}:${variant}`}
                        onclick={() => copy(ioc, /** @type {'raw' | 'normalized' | 'defanged'} */ (variant))}
                      >
                        {copiedKey === `${ioc.id}:${variant}`
                          ? 'Copied ✓'
                          : copiedKey === `${ioc.id}:${variant}:failed`
                            ? 'Copy failed'
                            : label}
                      </button>
                    {/each}
                    <!-- Saving works for every type, including hashes with no automated check. -->
                    <button
                      type="button"
                      class="ioc__copy"
                      class:ioc__copy--copied={savedKey === ioc.id}
                      title="Keep this indicator in the local investigation history"
                      onclick={() => saveIoc(ioc)}
                    >
                      {savedKey === ioc.id ? 'Saved locally ✓' : '🗒 Save to history'}
                    </button>
                    {#if analyzableTypes.has(ioc.typeId)}
                      <button
                        type="button"
                        class="ioc__analyze"
                        title="Open Fast analyze seeded with the normalized value"
                        onclick={() => analyze(ioc)}
                      >
                        ⚡ Fast analyze
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="ioc__investigate"
                      aria-expanded={expandedIds.includes(ioc.id)}
                      onclick={() => toggleInvestigate(ioc.id)}
                    >
                      🧰 Investigate
                    </button>
                  </div>
                </div>
                <!-- Values are rendered as inert text, never links: nothing opens without an explicit action. -->
                <code class="ioc__value">{ioc.raw}</code>
                {#if ioc.normalized !== ioc.raw}
                  <p class="ioc__normalized">→ <code>{ioc.normalized}</code></p>
                {/if}
                {#if expandedIds.includes(ioc.id)}
                  {@const links = deepLinksById.get(ioc.id) ?? []}
                  {#if links.length > 0}
                    <ul class="gofurther__list" aria-label="Open the indicator in a full tool">
                      {#each links as link (link.toolId)}
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
                    <p class="ioc__nolinks">No catalog tool covers this indicator type.</p>
                  {/if}
                {/if}
              </li>
            {/each}

          </ul>

          {#if batchRows.length > 0}
            <section class="batch" aria-label="Batch analysis">
              <div class="batch__head">
                <span class="batch__progress" role="status">
                  {progress.total === 0
                    ? 'No automated check to run for this selection'
                    : `${progress.settled} / ${progress.total} checks completed`}
                </span>
                <span class="batch__phase">
                  {analysisRunning ? (stopping ? 'Stopping…' : 'Analysis in progress…') : 'Finished'}
                </span>
              </div>
              {#if progress.total > 0}
                <div
                  class="batch__gauge"
                  role="progressbar"
                  aria-label="Batch analysis progress"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={progress.percent}
                >
                  <span class="batch__gauge-fill" style="width: {progress.percent}%"></span>
                </div>
              {/if}

              <table class="batch__table">
                <thead>
                  <tr>
                    <th scope="col">IoC</th>
                    <th scope="col">Type</th>
                    <th scope="col">ASN / Network</th>
                    <th scope="col">RDAP</th>
                    <th scope="col">TLS</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {#each batchRows as row (row.ioc.id)}
                    {@const status = computeBatchStatus(row.checkStates)}
                    <tr>
                      <td class="batch__ioc">
                        <button
                          type="button"
                          class="batch__expand"
                          aria-expanded={detailIds.includes(row.ioc.id)}
                          onclick={() => toggleDetail(row.ioc.id)}
                        >
                          <span aria-hidden="true"
                            >{detailIds.includes(row.ioc.id) ? '▼' : '▶'}</span
                          >
                          <code>{row.ioc.defanged}</code>
                        </button>
                      </td>
                      <td>{iocLabel(row.ioc)}</td>
                      <td>{networkCell(row)}</td>
                      <td>{checkCell(findCheck(row, 'rdap'))}</td>
                      <td>{tlsCell(row)}</td>
                      <td>
                        <span
                          class="batch__status"
                          class:batch__status--ok={status === 'Complete'}
                          class:batch__status--warn={status === 'Partial'}
                          class:batch__status--bad={status === 'Error'}
                          >{status}</span
                        >
                      </td>
                    </tr>
                    {#if detailIds.includes(row.ioc.id)}
                      {@const links = getDeepLinks(row.ioc.typeId, row.ioc.normalized, catalog.tools)}
                      <tr class="batch__detail">
                        <td colspan="6">
                          {#if row.checkStates.length === 0}
                            <p class="ioc__nolinks">
                              No automated check available for this indicator type — the links below
                              open it in a full tool.
                            </p>
                          {:else}
                            <ul class="checks" aria-label={`Checks for ${row.ioc.normalized}`}>
                              {#each row.checkStates as check (check.def.id)}
                                <li class="check">
                                  <div class="check__head">
                                    <span
                                      class="check__dot"
                                      class:check__dot--ok={check.status === 'ok'}
                                      class:check__dot--empty={check.status === 'empty'}
                                      class:check__dot--error={check.status === 'error'}
                                      class:check__dot--pending={check.status === 'pending' ||
                                        check.status === 'running'}
                                      aria-hidden="true"
                                    ></span>
                                    <span class="check__label">{check.def.label}</span>
                                    <span class="batch__check-status"
                                      >{checkStatusLabel(check.status)}</span
                                    >
                                    {#if check.ms != null}
                                      <span class="check__ms">{check.ms} ms</span>
                                    {/if}
                                    {#if check.def.toolId}
                                      {@const tool = toolById.get(check.def.toolId)}
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
                                  {#if check.result?.summary}
                                    <p class="check__summary">{check.result.summary}</p>
                                  {/if}
                                  {#if check.result && check.result.fields.length > 0}
                                    <dl class="check__fields">
                                      {#each check.result.fields as field (field.label)}
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
                                  {#if check.result?.message}
                                    <p
                                      class="check__message"
                                      class:check__message--error={check.status === 'error'}
                                      >{check.result.message}</p
                                    >
                                  {/if}
                                </li>
                              {/each}
                            </ul>
                          {/if}
                          {#if links.length > 0}
                            <p class="gofurther__title">Go further</p>
                            <ul
                              class="gofurther__list"
                              aria-label="Open the indicator in a full tool"
                            >
                              {#each links as link (link.toolId)}
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
                          {/if}
                        </td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </section>
          {/if}
        {/if}
      {/if}

      <p class="modal__foot">
        Extraction runs entirely in this browser: the pasted text is never sent to any API. External
        links only open on an explicit click.
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
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .modal__textarea {
    flex: 1 1 100%;
    min-width: 0;
    padding: 0.65rem 0.9rem;
    font: inherit;
    font-family: var(--font-mono);
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    resize: vertical;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .modal__textarea::placeholder {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .modal__textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px rgb(56 189 248 / 0.18);
  }

  .modal__form-actions {
    display: flex;
    flex: 1 1 100%;
    justify-content: flex-end;
    gap: 0.6rem;
  }

  .modal__start,
  .modal__clear {
    padding: 0.55rem 1.4rem;
    font: inherit;
    font-weight: 600;
    border-radius: 10px;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease;
  }

  .modal__start {
    color: #08131f;
    background: var(--color-accent);
    border: none;
  }

  .modal__start:hover:not(:disabled) {
    background: var(--color-accent-strong);
  }

  .modal__start:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .modal__clear {
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
  }

  .modal__clear:hover:not(:disabled) {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .modal__clear:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .modal__count,
  .modal__notice {
    margin: 0;
    font-size: 0.88rem;
    color: var(--color-text);
  }

  .iocs {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ioc {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.75rem 0.9rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
  }

  .ioc__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .ioc__type {
    padding: 0.1rem 0.6rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-accent);
    background: rgb(56 189 248 / 0.12);
    border-radius: 999px;
  }

  .ioc__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .ioc__copy,
  .ioc__analyze,
  .ioc__investigate {
    padding: 0.25rem 0.7rem;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    border-radius: 999px;
    cursor: pointer;
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      background-color 0.15s ease;
  }

  .ioc__copy {
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
  }

  .ioc__copy:hover {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .ioc__copy--copied {
    color: var(--color-success);
    border-color: var(--color-success);
  }

  .ioc__analyze {
    color: #08131f;
    background: var(--color-accent);
    border: none;
  }

  .ioc__analyze:hover {
    background: var(--color-accent-strong);
  }

  .ioc__investigate {
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
  }

  .ioc__investigate:hover,
  .ioc__investigate[aria-expanded='true'] {
    color: var(--color-text);
    border-color: var(--color-accent);
  }

  .ioc__value {
    font-family: var(--font-mono);
    font-size: 0.88rem;
    word-break: break-all;
  }

  .ioc__normalized {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--color-text-muted);
    word-break: break-all;
  }

  .ioc__normalized code {
    color: var(--color-text);
  }

  .ioc__nolinks {
    margin: 0;
    font-size: 0.82rem;
    color: var(--color-text-muted);
  }

  .gofurther__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: 0.5rem;
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
  }

  .gofurther__link {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    height: 100%;
    padding: 0.55rem 0.75rem;
    background: var(--color-surface-raised);
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

  /* ---------- Selection & batch analysis ---------- */
  .ioc__ident {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .ioc__check {
    width: 1rem;
    height: 1rem;
    accent-color: var(--color-accent);
    cursor: pointer;
  }

  .batch__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
  }

  .batch__selected {
    margin-right: auto;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .batch {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 0.9rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
  }

  .batch__head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .batch__progress {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .batch__phase {
    font-size: 0.78rem;
    color: var(--color-text-muted);
  }

  .batch__gauge {
    height: 0.4rem;
    overflow: hidden;
    background: rgb(148 163 184 / 0.18);
    border-radius: 999px;
  }

  .batch__gauge-fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 0.2s ease;
  }

  .batch__table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    text-align: left;
  }

  .batch__table th {
    padding: 0.3rem 0.45rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
  }

  .batch__table td {
    padding: 0.4rem 0.45rem;
    vertical-align: top;
    border-bottom: 1px solid rgb(36 52 92 / 0.6);
  }

  .batch__ioc {
    min-width: 11rem;
  }

  .batch__expand {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0;
    font: inherit;
    color: var(--color-text);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .batch__expand code {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    word-break: break-all;
  }

  .batch__check-status {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .batch__status {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
    color: var(--color-text-muted);
    background: rgb(148 163 184 / 0.12);
    border-radius: 999px;
  }

  .batch__status--ok {
    color: var(--color-success);
    background: rgb(74 222 128 / 0.14);
  }

  .batch__status--warn {
    color: rgb(250 204 21);
    background: rgb(250 204 21 / 0.14);
  }

  .batch__status--bad {
    color: var(--color-danger);
    background: rgb(248 113 113 / 0.14);
  }

  .batch__detail td {
    padding: 0.55rem 0.45rem 0.7rem;
    background: rgb(24 37 74 / 0.5);
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
    padding: 0.6rem 0.7rem;
    background: var(--color-surface-raised);
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
    font-size: 0.88rem;
  }

  .check__ms {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }

  .check__open {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--color-accent);
    text-decoration: none;
  }

  .check__open:hover {
    text-decoration: underline;
  }

  .check__summary {
    margin: 0.35rem 0 0;
    font-size: 0.85rem;
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
    font-size: 0.76rem;
    color: var(--color-text-muted);
  }

  .check__value {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.78rem;
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
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .check__message--error {
    color: var(--color-danger);
  }

  .gofurther__title {
    margin: 0.6rem 0 0;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }
</style>


