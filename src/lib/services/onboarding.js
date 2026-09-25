/**
 * Remembers whether the analyst already went through the interactive onboarding
 * tour, so it opens automatically on a first visit and stays quiet afterwards.
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
   * True when the tour must open by itself: no completed tour stored, or one
   * stored for an older step list. A corrupted value is treated as "not seen"
   * rather than swallowed, so a broken storage never hides the tour forever.
   *
   * @param {number} version
   * @returns {boolean}
   */
  shouldAutoOpen(version) {
    const raw = this.#read();
    if (raw === null) return true;
    const stored = raw.version;
    if (typeof stored !== 'number' || !Number.isInteger(stored)) return true;
    return stored < version;
  }

  /** @returns {boolean} Whether a tour was completed (any version). */
  hasSeenTour() {
    return this.#read() !== null;
  }

  /**
   * Records the tour as completed for the given step-list version.
   *
   * @param {number} version
   */
  markSeen(version) {
    this.#storage.setItem(this.#key, JSON.stringify({ seen: true, version }));
  }

  /** Forgets the tour: the next visit opens it again. */
  reset() {
    this.#storage.setItem(this.#key, JSON.stringify({ seen: false, version: 0 }));
  }

  /** @returns {{ seen?: boolean, version?: number } | null} */
  #read() {
    try {
      const raw = this.#storage.getItem(this.#key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.seen !== true) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}
