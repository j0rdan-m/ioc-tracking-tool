/**
 * Local investigation history: the trace of the analyses the analyst ran, plus
 * their verdict, tags and notes.
 *
 * Everything stays in the browser — the same approach as the favorites — and
 * the storage is injected (localStorage by default, in-memory fallback) so the
 * service is testable. A simple listener list lets the UI follow updates coming
 * from analyses started elsewhere (Fast analyze, batch analysis).
 *
 * The identity of an entry is its normalized value (AC14): refanged and
 * defanged spellings of the same indicator map to a single entry, which is
 * updated — never duplicated — when it is analysed again.
 */

/**
 * Local aliases keep the file body readable while still letting svelte-check
 * resolve the contracts from the shared types module (the typedefs there are
 * module-scoped and not re-exported as values).
 *
 * @typedef {import('../types.js').InvestigationEntry} InvestigationEntry
 * @typedef {import('../types.js').InvestigationAnalysisSnapshot} InvestigationAnalysisSnapshot
 * @typedef {import('../types.js').InvestigationVerdict} InvestigationVerdict
 * @typedef {import('../types.js').InvestigationSource} InvestigationSource
 */

const DEFAULT_STORAGE_KEY = 'ioc-toolkit:investigations';

/** Analyst qualifications, in display order. */
export const INVESTIGATION_VERDICTS = /** @type {const} */ ([
  'unknown',
  'benign',
  'suspicious',
  'malicious',
]);

/** Known provenances, in display order (US V1.5). */
export const INVESTIGATION_SOURCES = /** @type {const} */ ([
  'manual',
  'extracted-text',
  'email-headers',
]);

/**
 * Minimal Storage-like fallback used when localStorage is unavailable (SSR,
 * tests, privacy settings): the history then lasts for the session only.
 *
 * @returns {{ getItem(key: string): string | null, setItem(key: string, value: string): void,
 *             removeItem(key: string): void }}
 */
function createMemoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

/** @returns {{ getItem(key: string): string | null, setItem(key: string, value: string): void,
 *               removeItem(key: string): void }} */
function detectPersistentStorage() {
  try {
    const localStorage = globalThis.localStorage;
    if (!localStorage) {
      return createMemoryStorage();
    }
    const probe = '__ioc-toolkit-history-probe__';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return createMemoryStorage();
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @typedef {Object} InvestigationHistoryOptions
 * @property {() => string} [now] Clock used for the timestamps (injectable for tests).
 */

export class InvestigationHistoryService {
  /** @type {{ getItem(key: string): string | null, setItem(key: string, value: string): void,
   *           removeItem(key: string): void }} */
  #storage;

  /** @type {string} */
  #key;

  /** @type {() => string} */
  #now;

  /** @type {Set<() => void>} */
  #listeners = new Set();

  /**
   * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void,
   *           removeItem(key: string): void }} [storage]
   * @param {string} [key]
   * @param {InvestigationHistoryOptions} [options]
   */
  constructor(storage = detectPersistentStorage(), key = DEFAULT_STORAGE_KEY, options = {}) {
    this.#storage = storage;
    this.#key = key;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * Follows every change (an analysis can be recorded from anywhere in the UI).
   *
   * @param {() => void} listener
   * @returns {() => void} Unsubscribe function.
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** @returns {InvestigationEntry[]} Most recently analyzed first. */
  list() {
    return this.#read().sort((a, b) => b.lastAnalyzedAt.localeCompare(a.lastAnalyzedAt));
  }

  /** @param {string} id @returns {InvestigationEntry | null} */
  get(id) {
    return this.#read().find((entry) => entry.id === id) ?? null;
  }

  /**
   * Creates the entry of an indicator, or updates the existing one when the
   * normalized value is already known (AC03/AC14). The first analysis date, the
   * notes, the tags and the analyst verdict are always preserved — analysing
   * again never overwrites them, and never sets a verdict (AC04, AC05, AC07,
   * AC12). Only the latest technical results are replaced. The provenance is
   * recorded on creation and never changed afterwards: an investigation keeps
   * the origin it first entered the app with (US V1.5).
   *
   * @param {{ id: string, typeId: string, normalized: string, defanged: string }} ioc
   * @param {InvestigationAnalysisSnapshot | null} [latestAnalysis] New results, if any.
   * @param {InvestigationSource | null} [source] Provenance of the investigation.
   * @returns {InvestigationEntry}
   */
  upsert(ioc, latestAnalysis = null, source = null) {
    const entries = this.#read();
    const now = this.#now();
    const existing = entries.find((entry) => entry.id === ioc.id);
    /** @type {InvestigationEntry} */
    const entry = existing
      ? {
          ...existing,
          typeId: ioc.typeId,
          normalized: ioc.normalized,
          defanged: ioc.defanged,
          lastAnalyzedAt: now,
          latestAnalysis: latestAnalysis ?? existing.latestAnalysis,
          // Fill a missing provenance on legacy entries; never replace a known one.
          source: existing.source ?? source,
        }
      : {
          id: ioc.id,
          typeId: ioc.typeId,
          normalized: ioc.normalized,
          defanged: ioc.defanged,
          firstAnalyzedAt: now,
          lastAnalyzedAt: now,
          verdict: 'unknown',
          tags: [],
          notes: '',
          latestAnalysis,
          source,
        };
    this.#write(
      existing
        ? entries.map((candidate) => (candidate.id === entry.id ? entry : candidate))
        : [...entries, entry],
    );
    this.#emit();
    return entry;
  }

  /**
   * @param {string} id
   * @param {InvestigationVerdict} verdict
   * @returns {InvestigationEntry | null}
   */
  setVerdict(id, verdict) {
    return this.#patch(id, { verdict });
  }

  /** @param {string} id @param {string} notes @returns {InvestigationEntry | null} */
  setNotes(id, notes) {
    return this.#patch(id, { notes });
  }

  /** @param {string} id @param {string[]} tags @returns {InvestigationEntry | null} */
  setTags(id, tags) {
    return this.#patch(id, { tags });
  }

  /**
   * @param {string} id
   * @param {InvestigationAnalysisSnapshot} latestAnalysis
   * @returns {InvestigationEntry | null}
   */
  setLatestAnalysis(id, latestAnalysis) {
    return this.#patch(id, { latestAnalysis });
  }

  /** @param {string} id @returns {boolean} True when an entry was removed (AC10). */
  remove(id) {
    const entries = this.#read();
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) {
      return false;
    }
    this.#write(next);
    this.#emit();
    return true;
  }

  /** Removes every investigation; favorites live under another key (AC11). */
  clear() {
    this.#storage.removeItem(this.#key);
    this.#emit();
  }

  /**
   * @param {string} id
   * @param {Partial<InvestigationEntry>} patch
   * @returns {InvestigationEntry | null}
   */
  #patch(id, patch) {
    const entries = this.#read();
    const existing = entries.find((entry) => entry.id === id);
    if (!existing) {
      return null;
    }
    const entry = { ...existing, ...patch };
    this.#write(entries.map((candidate) => (candidate.id === id ? entry : candidate)));
    this.#emit();
    return entry;
  }

  /**
   * Reads and sanitizes the stored entries: a corrupted or partial payload must
   * never break the UI.
   *
   * @returns {InvestigationEntry[]}
   */
  #read() {
    try {
      const raw = this.#storage.getItem(this.#key);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((value) => this.#sanitize(value))
        .filter((/** @type {InvestigationEntry | null} */ entry) => entry !== null);
    } catch {
      return [];
    }
  }

  /**
   * @param {unknown} value
   * @returns {InvestigationEntry | null}
   */
  #sanitize(value) {
    if (
      !isObject(value) ||
      typeof value.id !== 'string' ||
      typeof value.normalized !== 'string' ||
      typeof value.typeId !== 'string'
    ) {
      return null;
    }
    return {
      id: value.id,
      typeId: value.typeId,
      normalized: value.normalized,
      defanged:
        typeof value.defanged === 'string' && value.defanged !== ''
          ? value.defanged
          : value.normalized,
      firstAnalyzedAt: typeof value.firstAnalyzedAt === 'string' ? value.firstAnalyzedAt : '',
      lastAnalyzedAt: typeof value.lastAnalyzedAt === 'string' ? value.lastAnalyzedAt : '',
      verdict: INVESTIGATION_VERDICTS.includes(value.verdict) ? value.verdict : 'unknown',
      tags: Array.isArray(value.tags)
        ? value.tags.filter((/** @type {unknown} */ tag) => typeof tag === 'string' && tag !== '')
        : [],
      notes: typeof value.notes === 'string' ? value.notes : '',
      latestAnalysis:
        isObject(value.latestAnalysis) &&
        typeof value.latestAnalysis.checkedAt === 'string' &&
        Array.isArray(value.latestAnalysis.checks)
          ? { checkedAt: value.latestAnalysis.checkedAt, checks: value.latestAnalysis.checks }
          : null,
      source: INVESTIGATION_SOURCES.includes(value.source) ? value.source : null,
    };
  }

  /** @param {InvestigationEntry[]} entries */
  #write(entries) {
    try {
      this.#storage.setItem(this.#key, JSON.stringify(entries));
    } catch {
      // Storage full or denied: the memory fallback keeps the session usable.
    }
  }

  #emit() {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
