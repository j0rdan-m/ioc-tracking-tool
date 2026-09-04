/**
 * Persists the user's favorite tool ids.
 *
 * The storage is injected (browser localStorage by default, in-memory fallback
 * when unavailable) so the service stays testable and degrades gracefully.
 */

const DEFAULT_STORAGE_KEY = 'ioc-toolkit:favorites';

/**
 * Minimal Storage-like fallback used when localStorage is unavailable (SSR,
 * tests, privacy settings): favorites then last for the session only.
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

export class FavoritesService {
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

  /** @returns {string[]} Favorite tool ids, in the order they were starred. */
  getFavorites() {
    try {
      const raw = this.#storage.getItem(this.#key);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  /** @param {string[]} ids */
  setFavorites(ids) {
    this.#storage.setItem(this.#key, JSON.stringify(ids));
  }

  /**
   * Adds or removes a tool from the favorites and persists the list.
   *
   * @param {string} toolId
   * @returns {string[]} The updated favorites list.
   */
  toggle(toolId) {
    const favorites = this.getFavorites();
    const next = favorites.includes(toolId)
      ? favorites.filter((id) => id !== toolId)
      : [...favorites, toolId];
    this.setFavorites(next);
    return next;
  }

  /** @param {string} toolId @returns {boolean} */
  isFavorite(toolId) {
    return this.getFavorites().includes(toolId);
  }
}
