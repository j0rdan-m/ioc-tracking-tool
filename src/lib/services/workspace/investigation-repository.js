/**
 * V2 investigation workspace repository: persists whole investigations
 * (nodes + relationships + analyst data + timeline) locally. IndexedDB is
 * preferred over localStorage because a workspace easily exceeds the ~5 MB
 * localStorage quota (US V2 "Sauvegarde"); the storage backend is a tiny
 * injected adapter, so tests — and browsers without IndexedDB — fall back to
 * an in-memory implementation with the exact same behaviour.
 *
 * Nothing here touches the network: investigations never leave the browser.
 * Corrupted or partial records are sanitized on read (and dropped when
 * unusable) instead of crashing the UI. Writes are cache-first and
 * best-effort: when the adapter rejects (quota, private mode) the session
 * keeps working with the in-memory copy, the same policy as the V1.3
 * `InvestigationHistoryService`.
 */

import { sanitizeInvestigation } from './investigation-model.js';

/** @typedef {import('../../types.js').WorkspaceInvestigation} WorkspaceInvestigation */

/**
 * Storage backend contract. Implementations resolve with plain data only —
 * no events, no network.
 *
 * @typedef {Object} WorkspaceAdapter
 * @property {() => Promise<unknown[]>} getAll
 * @property {(investigation: WorkspaceInvestigation) => Promise<void>} put
 * @property {(id: string) => Promise<void>} delete
 */

const DB_NAME = 'ioc-toolkit-workspace';
const DB_VERSION = 1;
const STORE_NAME = 'investigations';

/**
 * In-memory adapter (tests, private mode, browsers without IndexedDB). The
 * seed is sanitized so a caller cannot smuggle invalid records in.
 *
 * @param {unknown[]} [seed]
 * @returns {WorkspaceAdapter}
 */
export function createMemoryWorkspaceAdapter(seed = []) {
  /** @type {Map<string, WorkspaceInvestigation>} */
  const records = new Map();
  for (const value of Array.isArray(seed) ? seed : []) {
    const investigation = sanitizeInvestigation(value);
    if (investigation) {
      records.set(investigation.id, investigation);
    }
  }
  return {
    getAll: async () => [...records.values()],
    put: async (investigation) => {
      records.set(investigation.id, investigation);
    },
    delete: async (id) => {
      records.delete(id);
    },
  };
}

/**
 * IndexedDB adapter over one `investigations` store (keyPath `id`). Returns
 * `null` when IndexedDB is unavailable so callers can fall back to memory.
 *
 * @param {IDBFactory | null | undefined} [factory]
 * @returns {WorkspaceAdapter | null}
 */
export function createIndexedDbWorkspaceAdapter(factory = globalThis.indexedDB) {
  if (!factory) {
    return null;
  }
  /** @type {Promise<IDBDatabase> | null} */
  let opening = null;
  const open = () => {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const request = factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('IndexedDB: cannot open the workspace database.'));
      }).catch((error) => {
        // A failed open must not be cached: the next operation retries.
        opening = null;
        throw error;
      });
    }
    return opening;
  };
  /**
   * @param {'readonly' | 'readwrite'} mode
   * @param {(store: IDBObjectStore) => IDBRequest} operation
   * @returns {Promise<any>}
   */
  const run = (mode, operation) =>
    open().then(
      (database) =>
        new Promise((resolve, reject) => {
          const request = operation(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(request.error ?? new Error('IndexedDB: workspace request failed.'));
        }),
    );
  return {
    getAll: () => run('readonly', (store) => store.getAll()),
    put: (investigation) =>
      run('readwrite', (store) => store.put(investigation)).then(() => undefined),
    delete: (id) => run('readwrite', (store) => store.delete(id)).then(() => undefined),
  };
}

/**
 * Browser default: IndexedDB when reachable, memory otherwise.
 *
 * @returns {WorkspaceAdapter}
 */
export function createDefaultWorkspaceAdapter() {
  try {
    return createIndexedDbWorkspaceAdapter() ?? createMemoryWorkspaceAdapter();
  } catch {
    return createMemoryWorkspaceAdapter();
  }
}

export class InvestigationRepository {
  /** @type {WorkspaceAdapter} */ #adapter;
  /** @type {WorkspaceInvestigation[] | null} */ #cache = null;
  /** @type {Promise<void> | null} */ #loading = null;
  /** @type {Set<() => void>} */ #listeners = new Set();

  /**
   * @param {WorkspaceAdapter} [adapter] Injected storage (IndexedDB / memory).
   */
  constructor(adapter = createDefaultWorkspaceAdapter()) {
    this.#adapter = adapter;
  }

  #load() {
    if (!this.#loading) {
      this.#loading = (async () => {
        try {
          const records = await this.#adapter.getAll();
          /** @type {WorkspaceInvestigation[]} */
          const clean = [];
          for (const value of Array.isArray(records) ? records : []) {
            const investigation = sanitizeInvestigation(value);
            if (investigation) {
              clean.push(investigation);
            }
          }
          this.#cache = clean;
        } catch {
          // Unreadable storage (private mode / revoked permission): start
          // empty so the UI stays usable for the session.
          this.#cache = [];
        }
      })();
    }
    return this.#loading;
  }

  /** @returns {Promise<WorkspaceInvestigation[]>} Most recently updated first. */
  async list() {
    await this.#load();
    return [...(this.#cache ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * @param {string} id
   * @returns {Promise<WorkspaceInvestigation | null>}
   */
  async get(id) {
    await this.#load();
    return (this.#cache ?? []).find((investigation) => investigation.id === id) ?? null;
  }

  /**
   * Validates at the boundary (sanitizer), updates the cache, notifies the
   * subscribers, then persists best-effort.
   *
   * @param {WorkspaceInvestigation} investigation
   * @returns {Promise<WorkspaceInvestigation>} The sanitized stored copy.
   */
  async save(investigation) {
    const clean = sanitizeInvestigation(investigation);
    if (!clean) {
      throw new TypeError('InvestigationRepository.save: not a valid investigation.');
    }
    await this.#load();
    const cache = this.#cache ?? [];
    const index = cache.findIndex((candidate) => candidate.id === clean.id);
    if (index === -1) {
      cache.push(clean);
    } else {
      cache[index] = clean;
    }
    this.#emit();
    try {
      await this.#adapter.put(clean);
    } catch {
      // Quota / denied: the in-memory copy keeps the session usable (V2 AC16
      // holds as long as the storage backend accepts the write).
    }
    return clean;
  }

  /**
   * Removes an investigation from the workspace. By design this never touches
   * the V1.3 global history (V2 AC19): the two stores are independent.
   *
   * @param {string} id
   * @returns {Promise<boolean>} True when an investigation was removed.
   */
  async remove(id) {
    await this.#load();
    const cache = this.#cache ?? [];
    const next = cache.filter((candidate) => candidate.id !== id);
    if (next.length === cache.length) {
      return false;
    }
    this.#cache = next;
    this.#emit();
    try {
      await this.#adapter.delete(id);
    } catch {
      // Same best-effort policy as save(): the session copy is already gone.
    }
    return true;
  }

  /**
   * Follows every successful save/remove (same pattern as the V1.3 history).
   *
   * @param {() => void} listener
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

