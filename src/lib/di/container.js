const UNINITIALIZED = Symbol('di.uninitialized');

/**
 * Minimal dependency-injection container with lazy singletons.
 *
 * Dependencies are registered as factories and instantiated on first
 * resolution, which keeps the composition root declarative and startup cheap.
 * No external library is involved, and consumers never import concrete
 * implementations — they only resolve tokens.
 *
 * @typedef {{ register: (token: symbol, factory: (container: Container) => unknown) => void,
 *            resolve: (token: symbol) => any,
 *            has: (token: symbol) => boolean }} Container
 */

/**
 * @returns {Container}
 */
export function createContainer() {
  /** @type {Map<symbol, { factory: (container: Container) => unknown, instance: unknown }>} */
  const registrations = new Map();

  /**
   * Registers a lazily-created singleton for the given token.
   *
   * @param {symbol} token
   * @param {(container: Container) => unknown} factory
   */
  function register(token, factory) {
    registrations.set(token, { factory, instance: UNINITIALIZED });
  }

  /**
   * Resolves (and memoizes) the dependency registered for the token.
   *
   * @param {symbol} token
   * @returns {any} The resolved instance — any because symbol tokens carry no
   *   compile-time type information; callers annotate the result where useful.
   */
  function resolve(token) {
    const registration = registrations.get(token);
    if (!registration) {
      throw new Error(`DI: no dependency registered for token "${String(token.description)}".`);
    }
    if (registration.instance === UNINITIALIZED) {
      registration.instance = registration.factory(container);
    }
    return registration.instance;
  }

  const container = Object.freeze({
    register,
    resolve,
    has: (/** @type {symbol} */ token) => registrations.has(token),
  });

  return container;
}
