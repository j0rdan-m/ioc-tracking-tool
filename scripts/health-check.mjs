/**
 * Health-checks every tool URL and writes a snapshot to src/data/health.json.
 * Run with `npm run health` (also executed by the deploy workflow).
 *
 * Classification: any HTTP response counts as "up" (a 403 from a bot-protected
 * site still proves it is online); network errors, timeouts and HTTP 5xx count
 * as "down".
 */
import { readFileSync, writeFileSync } from 'node:fs';

const catalogPath = new URL('../src/data/tools.json', import.meta.url);
const healthPath = new URL('../src/data/health.json', import.meta.url);
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 8;

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status: number | null, ms: number }>}
 */
async function checkTool(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ioc-toolkit-healthcheck/1.0)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: response.status < 500, status: response.status, ms: Date.now() - startedAt };
  } catch {
    return { ok: false, status: null, ms: Date.now() - startedAt };
  }
}

/**
 * Runs an async worker over items with a bounded number of parallel lanes.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Promise<object>} worker
 * @param {number} concurrency
 * @returns {Promise<object[]>}
 */
async function runWithConcurrency(items, worker, concurrency) {
  /** @type {object[]} */
  const results = new Array(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

const tools = catalog.tools;
const checks = await runWithConcurrency(tools, async (tool) => ({ [tool.id]: await checkTool(tool.url) }), CONCURRENCY);

/** @type {{ version: string, checkedAt: string, results: Record<string, { ok: boolean, status: number | null, ms: number }> }} */
const health = {
  version: '1.0.0',
  checkedAt: new Date().toISOString(),
  results: Object.assign({}, ...checks),
};

writeFileSync(healthPath, JSON.stringify(health, null, 2) + '\n');

const up = Object.values(health.results).filter((result) => result.ok).length;
console.log(`HEALTH OK — ${up}/${tools.length} tools up at ${health.checkedAt}`);
