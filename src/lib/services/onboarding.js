/**
 * Remembers which interactive onboarding tours the analyst already went through
 * (page toolbar, Extract IoCs modal, investigation workspace), so each one opens
 * automatically on its first visit and stays quiet afterwards.
 *
 * The storage is injected (browser localStorage by default, in-memory fallback
 * when unavailable) so the service stays testable and degrades gracefully — same
 * approach as the favorites. The tour content itself lives in
 * `src/lib/utils/onboarding-tour.js`.
 */

const DEFAULT_STORAGE_KEY = 'ioc-toolkit:onboarding';

/**
 * Minimal Storage-like fallback used when localStorage is unavailable (SSR,
 * tests, privacy settings): the tour then shows on every visit of the session.
 *
 * @returns {{ getItem(key: string): string | null, setItem(key: string, value: string): void }}
 */
function createMemoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
  };
}

/** @returns {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} */
function detectPersistentStorage() {
  try {
    const localStorage = globalThis.localStorage;
    if (!localStorage) {
      return createMemoryStorage();
    }
    const probe = '__ioc-toolkit-probe__';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return createMemoryStorage();
  }
}

export class OnboardingService {
  /** @type {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} */
  #storage;

  /** @type {string} */
  #key;

  /**
   * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} [storage]
   * @param {string} [key]
   */
  constructor(storage = detectPersistentStorage(), key = DEFAULT_STORAGE_KEY) {
    this.#storage = storage;
    this.#key = key;
  }

  /**
   * True when a tour must open by itself: no completed tour stored for that
   * scope, or one stored for an older step list. A corrupted value is treated as
   * "not seen" rather than swallowed, so a broken storage never hides a tour.
   *
   * @param {string} scope
   * @param {number} version
   * @returns {boolean}
   */
  shouldAutoOpen(scope, version) {
    const entry = this.#read()[scope];
    if (!entry) return true;
    return entry.version < version;
  }

  /**
   * @param {string} scope
   * @returns {boolean} Whether that tour was completed (any version).
   */
  hasSeenTour(scope) {
    return this.#read()[scope] !== undefined;
  }

  /**
   * Records a tour as completed for the given step-list version, leaving the
   * other scopes untouched.
   *
   * @param {string} scope
   * @param {number} version
   */
  markSeen(scope, version) {
    const all = this.#read();
    all[scope] = { seen: true, version };
    this.#storage.setItem(this.#key, JSON.stringify(all));
  }

  /**
   * Forgets one tour (the next visit opens it again), or every tour when no
   * scope is given.
   *
   * @param {string} [scope]
   */
  reset(scope) {
    if (scope === undefined) {
      this.#storage.setItem(this.#key, '{}');
      return;
    }
    const all = this.#read();
    delete all[scope];
    this.#storage.setItem(this.#key, JSON.stringify(all));
  }

  /**
   * Per-scope completion state, always normalized:
   * - a corrupted or missing value yields `{}` (every tour re-opens);
   * - the V2.2 single-tour format `{ seen, version }` is migrated to the `page`
   *   scope, so an analyst who finished it is not asked to do it again.
   *
   * @returns {Record<string, { seen: true, version: number }>}
   */
  #read() {
    /** @type {Record<string, unknown>} */
    let parsed;
    try {
      const raw = this.#storage.getItem(this.#key);
      if (!raw) return {};
      const value = JSON.parse(raw);
      parsed = value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }

    // V2.2 format: one flat record, which can only be the page tour.
    if (parsed.seen === true) {
      const version = Number.isInteger(parsed.version) ? /** @type {number} */ (parsed.version) : 0;
      return { page: { seen: true, version } };
    }

    /** @type {Record<string, { seen: true, version: number }>} */
    const scopes = {};
    for (const [scope, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== 'object') continue;
      const candidate = /** @type {{ seen?: unknown, version?: unknown }} */ (entry);
      if (candidate.seen === true) {
        scopes[scope] = {
          seen: true,
          version: Number.isInteger(candidate.version) ? /** @type {number} */ (candidate.version) : 0,
        };
      }
    }
    return scopes;
  }
}
