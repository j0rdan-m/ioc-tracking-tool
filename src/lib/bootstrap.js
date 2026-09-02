import catalog from '../data/tools.json';
import { createContainer } from './di/container.js';
import { DI_TOKENS } from './di/tokens.js';
import { ClipboardService } from './services/clipboard.js';
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

  return container;
}
