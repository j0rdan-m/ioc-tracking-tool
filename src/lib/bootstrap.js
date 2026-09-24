import catalog from '../data/tools.json';
import healthCatalog from '../data/health.json';
import { createContainer } from './di/container.js';
import { DI_TOKENS } from './di/tokens.js';
import { ClipboardService } from './services/clipboard.js';
import { DownloadService } from './services/download.js';
import { FavoritesService } from './services/favorites.js';
import { FastAnalyzerService } from './services/fast-analyze.js';
import { InvestigationHistoryService } from './services/investigation-history.js';
import { InvestigationRepository } from './services/workspace/investigation-repository.js';
import { WorkspacePivotService } from './services/workspace/pivot-service.js';
import { parseWorkspaceImport } from './services/workspace/import.js';
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

  // Local file generation for investigation exports: pure `Blob` download,
  // no network and no backend involved (US V1.5).
  container.register(DI_TOKENS.download, () => new DownloadService());

  container.register(DI_TOKENS.favorites, () => new FavoritesService());

  container.register(DI_TOKENS.healthCatalog, () => healthCatalog);

  // Fast-analyze lookups run directly from the browser against free keyless
  // APIs; the global fetch is used by default and stays injectable for tests.
  container.register(DI_TOKENS.fastAnalyzer, () => new FastAnalyzerService());

  // Local investigation history (analyst verdicts, tags, notes): browser
  // storage only, no account and no backend — same approach as the favorites.
  container.register(DI_TOKENS.investigations, () => new InvestigationHistoryService());

  // V2 investigation workspace: whole investigations (nodes, relationships,
  // timeline) persisted in IndexedDB with an in-memory fallback — still 100%
  // local, no backend (US V2).
  container.register(DI_TOKENS.investigationWorkspace, () => new InvestigationRepository());

  // Explicit, bounded pivots: the service is pure orchestration and receives
  // the existing analyzer through DI; components do not import it directly.
  container.register(
    DI_TOKENS.workspacePivot,
    (container) => new WorkspacePivotService(container.resolve(DI_TOKENS.fastAnalyzer)),
  );

  container.register(DI_TOKENS.investigationImport, () => ({ parse: parseWorkspaceImport }));

  return container;
}
