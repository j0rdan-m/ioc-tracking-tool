import { getContext, setContext } from 'svelte';
import { DI_CONTAINER } from './tokens.js';

/**
 * Publishes the DI container to the whole component tree.
 * Must be called once, during the root component initialisation.
 *
 * @param {import('./container.js').Container} container
 */
export function provideContainer(container) {
  setContext(DI_CONTAINER, container);
}

/**
 * Resolves a dependency from the nearest provided container.
 * Must be called during component initialisation (not in event handlers).
 *
 * @param {symbol} token
 * @returns {any} The resolved dependency — any because symbol tokens carry no
 *   compile-time type information; callers annotate the result where useful.
 */
export function inject(token) {
  const container = getContext(DI_CONTAINER);
  if (!container) {
    throw new Error(
      `DI: no container provided while injecting "${String(token.description)}". ` +
        'Call provideContainer() in a parent component first.',
    );
  }
  return container.resolve(token);
}
