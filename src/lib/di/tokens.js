/**
 * Injection tokens shared by the DI container and the Svelte context bridge.
 * Symbols guarantee uniqueness even if two modules register similar names.
 */
export const DI_CONTAINER = Symbol('di.container');

export const DI_TOKENS = Object.freeze({
  toolCatalogSource: Symbol('di.toolCatalogSource'),
  toolRepository: Symbol('di.toolRepository'),
  clipboard: Symbol('di.clipboard'),
  download: Symbol('di.download'),
  favorites: Symbol('di.favorites'),
  healthCatalog: Symbol('di.healthCatalog'),
  fastAnalyzer: Symbol('di.fastAnalyzer'),
  investigations: Symbol('di.investigations'),
  investigationWorkspace: Symbol('di.investigationWorkspace'),
  workspacePivot: Symbol('di.workspacePivot'),
  investigationImport: Symbol('di.investigationImport'),
});
