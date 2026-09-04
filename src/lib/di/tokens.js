/**
 * Injection tokens shared by the DI container and the Svelte context bridge.
 * Symbols guarantee uniqueness even if two modules register similar names.
 */
export const DI_CONTAINER = Symbol('di.container');

export const DI_TOKENS = Object.freeze({
  toolCatalogSource: Symbol('di.toolCatalogSource'),
  toolRepository: Symbol('di.toolRepository'),
  clipboard: Symbol('di.clipboard'),
  favorites: Symbol('di.favorites'),
});
