/**
 * Batch analysis orchestrator: runs the Fast analyze checks of several IoCs in
 * one operation, with a bounded degree of parallelism.
 *
 * Framework-agnostic and side-effect free: it never performs a request itself
 * (every check comes from the injected `getChecks`), holds no DOM reference and
 * reports progress through an immutable snapshot callback. Results are exposed
 * as soon as each check settles, never as a single final block.
 *
 * A provider failure only affects its own check: the queue keeps draining and
 * an IoC whose checks all fail never blocks the others. Nothing here turns an
 * empty answer into a verdict, nor a provider error into a malicious flag.
 *
 * Exercised by `npm run smoke`.
 */

/**
 * Global status of one IoC, derived from its check states.
 *
 * - `No automated check available`: the type has no keyless provider (hashes,
 *   usernames) — no request is launched, only deep links are offered;
 * - `Complete`: every applicable check returned data;
 * - `Error`: every applicable check failed;
 * - `Partial`: anything in between (at least one answer, but some check failed
 *   or came back empty) — an empty answer is not a failure and never becomes a
 *   verdict.
 *
 * `Pending` / `Running` / `Cancelled` describe a row that is not final.
 *
 * @param {import('../types.js').BatchCheckState[]} checkStates
 * @returns {import('../types.js').BatchIocStatus}
 */
export function computeBatchStatus(checkStates) {
  if (checkStates.length === 0) {
    return 'No automated check available';
  }
  const statuses = checkStates.map((state) => state.status);
  if (statuses.some((status) => status === 'cancelled')) {
    return 'Cancelled';
  }
  if (statuses.every((status) => status === 'pending')) {
    return 'Pending';
  }
  if (statuses.some((status) => status === 'pending' || status === 'running')) {
    return 'Running';
  }
  if (statuses.every((status) => status === 'ok')) {
    return 'Complete';
  }
  if (statuses.every((status) => status === 'error')) {
    return 'Error';
  }
  return 'Partial';
}

/**
 * @typedef {Object} BatchRun
 * @property {import('../types.js').BatchRow[]} rows Live rows (mutated in place).
 * @property {Promise<void>} done Resolves when the queue drained or was stopped.
 * @property {() => void} stop Aborts in-flight checks and cancels queued rows.
 */

/**
 * Runs the compatible checks of every given IoC, at most `concurrency` IoCs at
 * a time (the checks of one IoC run in parallel — they are independent).
 *
 * @param {import('../types.js').ExtractedIoc[]} iocs IoCs to analyse (already
 *   normalized by the extractor and deduplicated by `id`).
 * @param {(typeId: string) => import('../types.js').FastCheckDefinition[]} getChecks
 *   Check factory, typically `FastAnalyzerService.getChecks`.
 * @param {{ concurrency?: number, signal?: AbortSignal,
 *           onUpdate?: (rows: import('../types.js').BatchRow[]) => void }} [options]
 * @returns {BatchRun}
 */
export function runBatchAnalysis(iocs, getChecks, options = {}) {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const controller = new AbortController();
  const signal = controller.signal;
  const onUpdate = options.onUpdate;

  // AC12: an indicator is analysed once per batch, whatever the caller passed
  // (the extractor already deduplicates, this is belt-and-braces).
  const uniqueIocs = [...new Map(iocs.map((ioc) => [ioc.id, ioc])).values()];

  const rows = uniqueIocs.map((ioc) => ({
    ioc,
    checkStates: getChecks(ioc.typeId).map((def) => ({
      def,
      status: /** @type {import('../types.js').BatchCheckStatus} */ ('pending'),
      result: null,
      ms: null,
    })),
  }));

  // Snapshot on every emit: consumers assign it to reactive state, and the
  // module keeps owning the live rows without any framework in the loop.
  const snapshot = () =>
    rows.map((row) => ({
      ioc: row.ioc,
      checkStates: row.checkStates.map((state) => ({ ...state })),
    }));

  let cursor = 0;
  let active = 0;
  let finished = false;
  /** @type {(() => void) | undefined} */
  let resolveDone;
  const done = new Promise((/** @type {(value: void) => void} */ resolve) => {
    resolveDone = () => resolve();
  });

  const emit = () => onUpdate?.(snapshot());

  /**
   * Rows the queue never reached are reported as cancelled instead of staying
   * pending forever once the analyst stops the analysis.
   */
  function cancelQueuedRows() {
    let touched = false;
    for (let index = cursor; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.checkStates.every((state) => state.status === 'pending')) {
        row.checkStates = row.checkStates.map((state) => ({ ...state, status: 'cancelled' }));
        touched = true;
      }
    }
    if (touched) {
      emit();
    }
  }

  /** @param {import('../types.js').BatchRow} row */
  async function analyzeRow(row) {
    await Promise.all(
      row.checkStates.map(async (state) => {
        const startedAt = performance.now();
        state.status = 'running';
        emit();
        let result;
        try {
          result = await state.def.run(row.ioc.normalized, { signal });
        } catch (error) {
          // `run()` is contractually non-throwing; this keeps one rogue check
          // from breaking the batch anyway.
          result = {
            status: /** @type {const} */ ('error'),
            summary: null,
            fields: [],
            message: error instanceof Error ? error.message : 'Unexpected failure.',
            raw: null,
          };
        }
        state.ms = Math.round(performance.now() - startedAt);
        if (signal.aborted && result.status === 'error') {
          // Provider call cut short by "Stop analysis": that is a cancellation,
          // not a provider error, and it must never look like a verdict.
          state.status = 'cancelled';
          state.result = null;
        } else {
          state.status = result.status;
          state.result = result;
        }
        emit();
      }),
    );
  }

  function pump() {
    if (finished) {
      return;
    }
    while (active < concurrency && cursor < rows.length && !signal.aborted) {
      const row = rows[cursor];
      cursor += 1;
      active += 1;
      analyzeRow(row).finally(() => {
        active -= 1;
        pump();
      });
    }
    if (active === 0 && (cursor >= rows.length || signal.aborted)) {
      finished = true;
      if (signal.aborted) {
        cancelQueuedRows();
      }
      emit();
      resolveDone?.();
    }
  }

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  // Queued rows flip to cancelled immediately, without waiting for the checks
  // already in flight to settle.
  signal.addEventListener('abort', cancelQueuedRows, { once: true });

  pump();

  return {
    rows,
    done,
    stop: () => controller.abort(),
  };
}
