import catalog from '../data/tools.json';
import healthCatalog from '../data/health.json';
import { createContainer } from './di/container.js';
import { DI_TOKENS } from './di/tokens.js';
import { ClipboardService } from './services/clipboard.js';
import { FavoritesService } from './services/favorites.js';
import { FastAnalyzerService } from './services/fast-analyze.js';
import { StaticToolDataSource } from './services/static-tool-data-source.js';
import { ToolRepository } from './services/tool-repository.js';

/**
 * Composition root: the single place where concrete implementations are wired
 * to the DI tokens. Components never import these implementations themselves.
 *
 * To serve the catalog from an API instead of the bundled JSON (editable
 * without rebuilding), swap the data-source registration for:
 *
 *   new HttpToolDataSource('/api/tools.json')
 *
 * @returns {import('./di/container.js').Container}
 */
export function createAppContainer() {
  const container = createContainer();

  container.register(DI_TOKENS.toolCatalogSource, () => new StaticToolDataSource(catalog));

  container.register(
    DI_TOKENS.toolRepository,
    /**
     * @param {import('./di/container.js').Container} container
     */
    (container) => new ToolRepository(container.resolve(DI_TOKENS.toolCatalogSource)),
  );

  container.register(DI_TOKENS.clipboard, () => new ClipboardService());

  container.register(DI_TOKENS.favorites, () => new FavoritesService());

  container.register(DI_TOKENS.healthCatalog, () => healthCatalog);

  // Fast-analyze lookups run directly from the browser against free keyless
  // APIs; the global fetch is used by default and stays injectable for tests.
  container.register(DI_TOKENS.fastAnalyzer, () => new FastAnalyzerService());

  return container;
}
