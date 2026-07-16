import {
  loadNeonProspectPageWithMetrics,
  type ProspectPageLoadResult,
  type ProspectPageQuery,
  type ProspectVisibility,
  type ProspectWorkspaceScope,
} from './prospect-query.js';
import { loadNeonProspectPageV2WithMetrics as loadConsolidatedPage } from './prospect-page-v2.js';

const degradedDatabases = new Set<string>();

export async function loadNeonProspectPageV2WithMetrics(
  databaseUrl: string,
  query: ProspectPageQuery,
  visibility: ProspectVisibility,
  workspaceScope: ProspectWorkspaceScope = {},
): Promise<ProspectPageLoadResult> {
  if (degradedDatabases.has(databaseUrl)) {
    return loadNeonProspectPageWithMetrics(databaseUrl, query, visibility, workspaceScope);
  }
  try {
    return await loadConsolidatedPage(databaseUrl, query, visibility, workspaceScope);
  } catch (error) {
    degradedDatabases.add(databaseUrl);
    console.error('PROSPECT_PAGE_V2_FALLBACK', {
      message: error instanceof Error ? error.message : String(error),
    });
    return loadNeonProspectPageWithMetrics(databaseUrl, query, visibility, workspaceScope);
  }
}
