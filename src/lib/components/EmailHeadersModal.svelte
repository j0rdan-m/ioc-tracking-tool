<script>
  import { inject } from '../di/provide.js';
  import { DI_TOKENS } from '../di/tokens.js';
  import { computeBatchStatus, runBatchAnalysis } from '../utils/batch-analyze.js';
  import { parseHeaders } from '../utils/email-header-parser.js';
  import { analyzeHeaders } from '../utils/email-header-analyzer.js';
  import { extractIocs } from '../utils/extract-iocs.js';
  import { buildAnalysisSnapshot } from '../utils/history-filter.js';

  /**
   * "Analyze email headers" modal: local RFC 5322 header parsing → auth
   * summary, mail path, identity signals, extracted IoCs. Reuse V1.1
   * extraction/normalization and the Fast/batch/history piping: a single
   * indicator is handed over to Fast analyze through `onAnalyze` (App closes
   * this modal and opens the other one seeded), while "Analyze selected" runs
   * the batch in place through the shared batch runner and records every
   * settled row in the local investigation history.
   *
   * @type {{ open?: boolean, catalog: import('../types.js').ToolCatalog,
   *          onAnalyze?: (normalized: string) => void }}
   */
  let { open = $bindable(false), catalog, onAnalyze = () => {} } = $props();

  /** @type {import('../services/fast-analyze.js').FastAnalyzerService} */
  const analyzer = inject(DI_TOKENS.fastAnalyzer);
  /** @type {import('../services/investigation-history.js').InvestigationHistoryService} */
  const history = inject(DI_TOKENS.investigations);

  let rawInput = $state('');
  /** @type {import('../utils/email-header-parser.js').ParsedEmailHeaders | null} */
  let parsed = $state(null);
  /** @type {import('../utils/email-header-analyzer.js').EmailHeaderAnalysis | null} */
  let analysis = $state(null);
  let feedback = $state('');
  let activeTab = $state('summary');
  /** @type {string[]} */
  let selectedIds = $state([]);
  let selectAll = $state(false);

  const TYPE_LABELS = { ip: 'IP', domain: 'Domain', url: 'URL', file: 'Hash', email: 'Email', username: 'Username' };

  /** @param {string} text */
  function runAnalysis(text) {
    // A new analysis invalidates the previous batch.
    batchRun?.stop();
    batchRun = null;
    batchRows = [];
    detailIds = [];
    analysisRunning = false;
    stopping = false;
    try {
      parsed = parseHeaders(text);
      analysis = analyzeHeaders(parsed);
      selectedIds = [];
      selectAll = false;
      activeTab = 'summary';
      feedback = '';
    } catch (err) {
      analysis = null;
      parsed = null;
      feedback = 'parse_error';
      console.error(err);
    }
  }

  function handleAnalyzeClick() {
    if (!rawInput.trim()) return;
    runAnalysis(rawInput.trim());
  }

  // $derived.by (not $derived): the closure makes TypeScript use the declared
  // union type of `analysis` instead of narrowing it to its null initializer.
  const extractedIocs = $derived.by(() =>
    analysis
      ? extractIocs(
          analysis.iocs.ips.concat(analysis.iocs.domains).concat(analysis.iocs.emails).join('\n'),
        ).iocs
      : [],
  );

  const privateIps = $derived.by(() =>
    analysis
      ? analysis.iocs.ips.filter((ip) => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)/.test(ip))
      : [],
  );

  const publicIocs = $derived(
    extractedIocs.filter((ioc) => !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)/.test(ioc.normalized)),
  );

  const selectedCount = $derived(selectedIds.length);

  function toggleSelect(id) {
    const idx = selectedIds.indexOf(id);
    if (idx >= 0) selectedIds.splice(idx, 1);
    else selectedIds.push(id);
    selectAll = selectedIds.length === publicIocs.length;
  }

  function toggleSelectAll() {
    if (selectedIds.length === publicIocs.length) {
      selectedIds = [];
      selectAll = false;
    } else {
      selectedIds = publicIocs.map((i) => i.id);
      selectAll = true;
    }
  }

  // Types backed by a keyless check: handing a value over to Fast analyze only
  // makes sense for those (a hash would land on an empty check list).
  const analyzableTypes = $derived(
    new Set(
      ['ip', 'domain', 'url', 'file', 'email'].filter(
        (type) => analyzer.getChecks(/** @type {import('../types.js').IocTypeId} */ (type)).length > 0,
      ),
    ),
  );

  // --- Batch analysis (shared plumbing with the Extract IoCs modal) --------
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
  // Ids already written to the local history during the current batch.
  /** @type {Set<string>} */
  const recordedIds = new Set();

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

  /**
   * Runs the compatible keyless checks of every selected indicator in one
   * operation (3 at a time), progressively filling the consolidated table.
   * Stopping keeps what already settled.
   */
  function analyzeSelected() {
    const iocs = publicIocs.filter((ioc) => selectedIds.includes(ioc.id));
    if (iocs.length === 0 || analysisRunning) {
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

  /** @param {string} id */
  function toggleDetail(id) {
    detailIds = detailIds.includes(id) ? detailIds.filter((entry) => entry !== id) : [...detailIds, id];
  }

  /**
   * Hands the normalized value over to Fast analyze: App closes this modal and
   * opens the other one seeded with it (the value is by construction a valid
   * IoC, so the modal's prefill guard accepts it).
   *
   * @param {import('../types.js').ExtractedIoc} ioc
   */
  function analyzeSingle(ioc) {
    open = false;
    onAnalyze(ioc.normalized);
  }

  function copyText(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
  }

  function handleClear() {
    if (confirm('Remove the pasted headers? This won’t affect your saved history.')) reset();
  }

  function reset() {
    batchRun?.stop();
    batchRun = null;
    batchRows = [];
    detailIds = [];
    analysisRunning = false;
    stopping = false;
    recordedIds.clear();
    rawInput = '';
    parsed = null;
    analysis = null;
    selectedIds = [];
    selectAll = false;
    activeTab = 'summary';
    feedback = '';
  }

  function close() {
    // Closing stops any running batch: no request is issued while the results
    // are out of sight. The pasted headers are kept for the next opening —
    // only the explicit "Clear headers" action discards them.
    batchRun?.stop();
    open = false;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso.slice(0, 16);
    }
  }

</script>

<style>
  .eh__tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--color-border); }
  .eh__tab { padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; color: var(--color-text-muted); background: transparent; border: none; border-bottom: 2px solid transparent; cursor: pointer; transition: color .15s, border-color .15s; }
  .eh__tab--active { color: var(--color-text); border-color: var(--color-accent); }
  .eh__summary { display: grid; gap: 1rem; }
  .eh__row { display: flex; gap: 0.5rem; align-items: center; }
  .eh__row > dt { font-size: 0.78rem; color: var(--color-text-muted); min-width: 130px; }
  .eh__row > dd { margin: 0; font-family: var(--font-mono); font-size: 0.88rem; word-break: break-all; }
  .eh__path { display: grid; gap: 0.75rem; }
  .eh__hop { padding: 0.6rem; background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: 8px; }
  .eh__hop-num { font-size: 0.72rem; color: var(--color-text-muted); margin-bottom: 0.25rem; }
  .eh__hop-name { font-weight: 600; font-size: 0.88rem; color: var(--color-text); word-break: break-all; }
  .eh__hop-ip { font-family: var(--font-mono); font-size: 0.82rem; color: var(--color-text-muted); }
  .eh__hop--private { opacity: 0.6; }
  .eh__hop--private .eh__hop-ip { color: var(--color-warning); }
  .eh__hop-date { font-size: 0.74rem; color: var(--color-text-muted); }
  .eh__signals { display: flex; flex-direction: column; gap: 0.4rem; }
  .eh__signal { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
  .eh__signal--ok { color: var(--color-success); }
  .eh__signal--warn { color: var(--color-warning); }
  .eh__signal--info { color: var(--color-accent); }
  .eh__ioc-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--color-border); }
  .eh__ioc-row:last-child { border-bottom: none; }
  .eh__ioc-type { font-size: 0.75rem; font-weight: 600; padding: 0.1rem 0.5rem; border-radius: 4px; color: var(--color-text-muted); background: var(--color-surface-raised); white-space: nowrap; }
  .eh__ioc-value { font-family: var(--font-mono); font-size: 0.86rem; word-break: break-all; }
  .eh__actions { display: flex; gap: 0.35rem; margin-left: auto; }
  .eh__btn { padding: 0.25rem 0.8rem; font: inherit; font-size: 0.8rem; border: 1px solid var(--color-border); border-radius: 999px; background: transparent; cursor: pointer; }
  .eh__btn--copy { color: var(--color-text-muted); }
  .eh__btn--copy:hover { color: var(--color-text); }
  .eh__btn--primary { color: var(--color-text); background: var(--color-accent); }
  .eh__btn--primary:hover { background: var(--color-accent-strong); }
  .eh__raw { font-family: var(--font-mono); font-size: 0.82rem; white-space: pre-wrap; word-break: break-all; padding: 0.8rem; background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: 8px; margin: 0; max-height: 500px; overflow: auto; }
  .eh__feedback { font-size: 0.8rem; color: var(--color-success); font-weight: 600; }
  .eh__empty { padding: 2.5rem 1rem; text-align: center; }
  .eh__empty p { margin: 0 0 0.5rem; color: var(--color-text-muted); font-size: 0.9rem; }
  .eh__hint { font-size: 0.8rem; color: var(--color-text-muted); margin: 0; }
  .eh__sub { font-size: 0.76rem; color: var(--color-text-muted); }
  .eh__code { font-family: var(--font-mono); }
  .eh__tag { font-size: 0.72rem; color: var(--color-warning); background: rgb(250 204 21 / 0.12); padding: 0.05rem 0.4rem; border-radius: 999px; }
  .eh__selbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
  .eh__count { font-size: 0.82rem; color: var(--color-text-muted); }
    .eh__arrow { text-align: center; color: var(--color-text-muted); font-size: 1.1rem; }

  /* Dialog structure (scoped: each modal styles its own copy). */
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
    width: min(58rem, 100%);
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

  .modal__foot {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0;
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }

  /* Input zone above the tabs. */
  .eh__input {
    display: grid;
    gap: 0.6rem;
  }

  .eh__input-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .eh__textarea {
    width: 100%;
    min-height: 10rem;
    padding: 0.65rem 0.9rem;
    font: inherit;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    resize: vertical;
  }

  .eh__textarea::placeholder {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .eh__textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px rgb(56 189 248 / 0.18);
  }

  .eh__ioCs {
    display: grid;
    gap: 0.6rem;
  }

  .eh__ioc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 8px;
  }

  /* Batch analysis (shared look with the Extract IoCs modal). */
  .batch {
    display: grid;
    gap: 0.6rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-border);
  }

  .batch__head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.82rem;
  }

  .batch__progress {
    font-weight: 600;
    color: var(--color-text);
  }

  .batch__phase {
    color: var(--color-text-muted);
  }

  .batch__gauge {
    height: 6px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    overflow: hidden;
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
    font-size: 0.84rem;
  }

  .batch__table th {
    padding: 0.35rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 600;
    text-align: left;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
  }

  .batch__table td {
    padding: 0.4rem 0.5rem;
    vertical-align: top;
    border-bottom: 1px solid var(--color-border);
  }

  .batch__ioc {
    word-break: break-all;
  }

  .batch__expand {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0;
    font: inherit;
    text-align: left;
    color: var(--color-text);
    background: none;
    border: none;
    cursor: pointer;
  }

  .batch__expand code {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    word-break: break-all;
  }

  .batch__status {
    padding: 0.1rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--color-text-muted);
    white-space: nowrap;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 999px;
  }

  .batch__status--ok { color: var(--color-success); border-color: var(--color-success); }
  .batch__status--warn { color: var(--color-warning); border-color: var(--color-warning); }
  .batch__status--bad { color: var(--color-danger); border-color: var(--color-danger); }

  .batch__detail td {
    background: var(--color-surface);
  }

  .batch__check-status {
    font-size: 0.74rem;
    color: var(--color-text-muted);
  }

  .checks {
    display: grid;
    gap: 0.45rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .check {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
  }

  .check__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-text-muted);
  }

  .check__dot--ok { background: var(--color-success); }
  .check__dot--empty { background: var(--color-warning); }
  .check__dot--error { background: var(--color-danger); }
  .check__dot--pending { background: var(--color-text-muted); }

  .check__label {
    font-weight: 600;
    color: var(--color-text);
  }

  .check__summary {
    flex-basis: 100%;
    margin: 0;
    font-size: 0.78rem;
    color: var(--color-text-muted);
  }

  .eh__btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .eh__btn--primary:disabled:hover {
    background: var(--color-accent);
  }
</style>

{#if open}
  <div class="modal__backdrop">
    <!-- Full-size dismissal button behind the dialog: an accessible close target. -->
    <button type="button" class="modal__backdrop-button" aria-label="Close" onclick={close}></button>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-headers-title"
      tabindex="-1"
      onkeydown={(e) => e.key === 'Escape' && close()}
    >
      <header class="modal__head">
        <div>
          <p class="modal__eyebrow">📬 Email headers</p>
          <h2 id="email-headers-title" class="modal__title">Analyze email headers</h2>
        </div>
        <button type="button" class="modal__close" aria-label="Close" onclick={close}>✕</button>
      </header>

    <div class="modal__body">
      <div class="eh__input">
        <textarea
          bind:value={rawInput}
          placeholder="Paste raw email headers here..."
          rows="8"
          class="eh__textarea"
        ></textarea>
        <div class="eh__input-actions">
          <button class="eh__btn eh__btn--primary" onclick={handleAnalyzeClick}>
            Analyze headers
          </button>
        </div>
        <p class="eh__hint">
          Header parsing is performed locally in your browser. Raw headers are never uploaded.
        </p>
      </div>

      {#if !analysis && rawInput.trim() && feedback === 'parse_error'}
        <p class="eh__hint" style="color:var(--color-danger);">
          Headers parsed, but no interpretable Received/From/Authentication-Results
          blocks were found. Adjust the input and try again.
        </p>
            {/if}

      {#if analysis}
        <nav class="eh__tabs">
          <button class="eh__tab" class:eh__tab--active={activeTab === 'summary'} onclick={() => (activeTab = 'summary')}>Summary</button>
          <button class="eh__tab" class:eh__tab--active={activeTab === 'path'} onclick={() => (activeTab = 'path')}>Mail path</button>
          <button class="eh__tab" class:eh__tab--active={activeTab === 'ioCs'} onclick={() => (activeTab = 'ioCs')}>IoC extraction</button>
          <button class="eh__tab" class:eh__tab--active={activeTab === 'raw'} onclick={() => (activeTab = 'raw')}>Raw headers</button>
        </nav>

        {#if activeTab === 'summary'}
          <dl class="eh__summary">
            <div class="eh__row"><dt>From</dt><dd>{analysis.summary.from ?? '—'}</dd></div>
            <div class="eh__row"><dt>Reply-To</dt><dd>{analysis.summary.replyTo ?? '—'}</dd></div>
            <div class="eh__row"><dt>Return-Path</dt><dd>{analysis.summary.returnPath ?? '—'}</dd></div>
            <div class="eh__row"><dt>Message-ID domain</dt><dd>{analysis.summary.messageIdDomain ?? '—'}</dd></div>
            <div class="eh__row"><dt>SPF</dt><dd>{analysis.auth.spf.result ?? '—'}{#if analysis.auth.spf.domain} <span class="eh__sub">({analysis.auth.spf.domain})</span>{/if}</dd></div>
            <div class="eh__row"><dt>DKIM</dt><dd>{analysis.auth.dkim.result ?? '—'}{#if analysis.auth.dkim.domain} <span class="eh__sub">({analysis.auth.dkim.domain})</span>{/if}{#if analysis.auth.dkim.selector} <span class="eh__sub">selector={analysis.auth.dkim.selector}</span>{/if}</dd></div>
            <div class="eh__row"><dt>DMARC</dt><dd>{analysis.auth.dmarc.result ?? '—'}{#if analysis.auth.dmarc.domain} <span class="eh__sub">({analysis.auth.dmarc.domain})</span>{/if}</dd></div>
            <div class="eh__row"><dt>Received hops</dt><dd>{analysis.mailPath.length}</dd></div>
            {#if analysis.earliestPublicIp}
              <div class="eh__row"><dt>Earliest public IP</dt><dd class="eh__code">{analysis.earliestPublicIp}</dd></div>
            {/if}
            {#if analysis.transit.earliest}
              <div class="eh__row"><dt>Transit started</dt><dd>{formatDate(analysis.transit.earliest)}</dd></div>
              {#if analysis.transit.durationMs !== null}
                <div class="eh__row"><dt>Transit time</dt><dd>{Math.round(analysis.transit.durationMs / 1000)}s</dd></div>
              {/if}
            {/if}
            <div class="eh__row">
              <dt>Identity</dt>
              <dd>
                <div class="eh__signals">
                  {#if analysis.identity.differs}
                    <div class="eh__signal eh__signal--warn">⚠ Domain mismatch across From / Reply-To / Return-Path</div>
                  {:else}
                    <div class="eh__signal eh__signal--ok">✓ Identity domains align</div>
                  {/if}
                </div>
              </dd>
            </div>
            {#if analysis.signals.length > 0}
              <div class="eh__row">
                <dt>Signals</dt>
                <dd>
                  <div class="eh__signals">
                    {#each analysis.signals as sig}
                      <div
                        class="eh__signal"
                        class:eh__signal--info={sig.icon === 'info'}
                        class:eh__signal--warn={sig.icon === 'warn'}
                        class:eh__signal--ok={sig.icon === 'ok'}
                      >
                        {sig.icon === 'ok' ? '✓' : sig.icon === 'warn' ? '⚠' : 'ℹ'} {sig.label}
                      </div>
                    {/each}
                  </div>
                </dd>
              </div>
            {/if}
          </dl>
        {/if}

        {#if activeTab === 'path'}
          <div class="eh__path">
            <p class="eh__hint">Ordered earliest → final receiving server. Private/local IPs are flagged for traceability.</p>
            {#each analysis.mailPath as hop, i (i)}
              <div class="eh__hop" class:eh__hop--private={hop.ipKind !== 'public'}>
                <div class="eh__hop-num">Hop {analysis.mailPath.length - i}</div>
                {#if hop.host}<div class="eh__hop-name">{hop.host}</div>{/if}
                {#if hop.ip}
                  <div class="eh__hop-ip">{hop.ip}{#if hop.ipKind !== 'public'} <span class="eh__tag">Private / local address</span>{/if}</div>
                {/if}
                {#if hop.date}<div class="eh__hop-date">{formatDate(hop.dateIso ?? hop.date)}</div>{/if}
              </div>
              {#if i < analysis.mailPath.length - 1}
                <div class="eh__arrow">↓</div>
              {/if}
                        {/each}
          </div>
        {/if}

        {#if activeTab === 'ioCs'}
          <section class="eh__ioCs">
            <p class="eh__hint">
              {publicIocs.length} investigable IoC(s) extracted from the headers.{#if privateIps.length} Private/local IPs below.{/if}
            </p>
            {#if publicIocs.length}
              <div class="eh__selbar">
                <span class="eh__count">{selectedCount} of {publicIocs.length} selected</span>
                <button class="eh__btn" onclick={toggleSelectAll}>{selectedCount === publicIocs.length ? 'Deselect all' : 'Select all'}</button>
                <button
                  class="eh__btn eh__btn--primary"
                  disabled={selectedCount === 0 || analysisRunning}
                  title="Run the compatible keyless checks for every selected IoC"
                  onclick={analyzeSelected}
                >
                  ⚡ Analyze selected
                </button>
                {#if analysisRunning}
                  <button class="eh__btn" disabled={stopping} onclick={stopAnalysis}>
                    {stopping ? 'Stopping…' : 'Stop analysis'}
                  </button>
                {/if}
              </div>
              <ul class="eh__ioc-list">
                {#each publicIocs as ioc (ioc.id)}
                  <li class="eh__ioc-row">
                    <input type="checkbox" checked={selectedIds.includes(ioc.id)} onchange={() => toggleSelect(ioc.id)} />
                    <span class="eh__ioc-type">{TYPE_LABELS[ioc.typeId] ?? ioc.typeId}</span>
                    <span class="eh__ioc-value">{ioc.defanged}</span>
                    {#if ioc.normalized !== ioc.defanged}
                      <span class="eh__sub">→ {ioc.normalized}</span>
                    {/if}
                    <div class="eh__actions">
                      <button class="eh__btn eh__btn--copy" title="Copy normalized" onclick={() => copyText(ioc.normalized)}>Copy</button>
                      <button class="eh__btn eh__btn--copy" title="Copy defanged" onclick={() => copyText(ioc.defanged)}>Defang</button>
                      {#if analyzableTypes.has(ioc.typeId)}
                        <button class="eh__btn eh__btn--primary" title="Open Fast analyze seeded with the normalized value" onclick={() => analyzeSingle(ioc)}>
                          ⚡ Fast analyze
                        </button>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
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
                            <span aria-hidden="true">{detailIds.includes(row.ioc.id) ? '▼' : '▶'}</span>
                            <code>{row.ioc.defanged}</code>
                          </button>
                        </td>
                        <td>{TYPE_LABELS[row.ioc.typeId] ?? row.ioc.typeId}</td>
                        <td>
                          <span
                            class="batch__status"
                            class:batch__status--ok={status === 'Complete'}
                            class:batch__status--warn={status === 'Partial'}
                            class:batch__status--bad={status === 'Error'}>{status}</span
                          >
                        </td>
                      </tr>
                      {#if detailIds.includes(row.ioc.id)}
                        <tr class="batch__detail">
                          <td colspan="3">
                            {#if row.checkStates.length === 0}
                              <p class="eh__hint">
                                No automated check available for this indicator type.
                              </p>
                            {:else}
                              <ul class="checks" aria-label={`Checks for ${row.ioc.normalized}`}>
                                {#each row.checkStates as check (check.def.id)}
                                  <li class="check">
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
                                      >{CHECK_STATUS_LABELS[check.status]}</span
                                    >
                                    {#if check.ms != null}
                                      <span class="eh__sub">{check.ms} ms</span>
                                    {/if}
                                    {#if check.result?.summary}
                                      <p class="check__summary">{check.result.summary}</p>
                                    {/if}
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
            {#if privateIps.length}
              <p class="eh__sub">Non-investigable (private/local) IPs in path:</p>
              <ul class="eh__ioc-list">
                {#each privateIps as ip (ip)}
                  <li class="eh__ioc-row">
                    <span class="eh__ioc-type">IP</span>
                    <span class="eh__code eh__ioc-value">{ip}</span>
                    <span class="eh__tag">Private / local address</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}

        {#if activeTab === 'raw'}
          <pre class="eh__raw">{parsed ? parsed.raw : ''}</pre>
        {/if}
      {/if}

      {#if !analysis}
        <div class="eh__empty">
          <p>Paste email headers above, then click <strong>Analyze headers</strong>.</p>
          <p class="eh__hint">Parsing is performed locally in your browser. Nothing is sent over the network.</p>
        </div>
      {/if}
    </div>

      <footer class="modal__foot">
        <button class="eh__btn" onclick={handleClear}>Clear headers</button>
        {#if feedback === 'saved'}<span class="eh__feedback">Saved locally</span>{/if}
      </footer>
    </div>
  </div>
{/if}


