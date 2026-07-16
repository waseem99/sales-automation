import { neon } from '@neondatabase/serverless';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { ensureNeonSchemaWithMetrics, requireDatabaseUrl } from './index.js';
import { ensureProspectQueryIndexesWithMetrics } from './prospect-query-indexes.js';
import { PROSPECT_PAGE_QUERY_SQL_1 } from './prospect-page-query-sql-1.js';
import { PROSPECT_PAGE_QUERY_SQL_2 } from './prospect-page-query-sql-2.js';
import { PROSPECT_PAGE_QUERY_SQL_3 } from './prospect-page-query-sql-3.js';
import { PROSPECT_PAGE_QUERY_SQL_4 } from './prospect-page-query-sql-4.js';
import {
  normalizeProspectPageQuery,
  type ProspectPageLoadResult,
  type ProspectPageQuery,
  type ProspectPageResult,
  type ProspectVisibility,
  type ProspectWorkspaceScope,
} from './prospect-query.js';
import {
  bindNamedQuery,
  isStoredRecord,
  normalizeTokens,
  numberValue,
  parseJsonArray,
  summaryFromAggregateRow,
  workspaceSqlParameters,
  type AggregatePageRow,
} from './prospect-page-query-model.js';

export async function loadNeonProspectPage(
  databaseUrl: string,
  query: ProspectPageQuery,
  visibility: ProspectVisibility,
  workspaceScope: ProspectWorkspaceScope = {},
): Promise<ProspectPageResult> {
  return (await loadNeonProspectPageWithMetrics(databaseUrl, query, visibility, workspaceScope)).page;
}

export async function loadNeonProspectPageWithMetrics(
  databaseUrl: string,
  query: ProspectPageQuery,
  visibility: ProspectVisibility,
  workspaceScope: ProspectWorkspaceScope = {},
): Promise<ProspectPageLoadResult> {
  const schema = await ensureNeonSchemaWithMetrics(databaseUrl);
  const indexes = await ensureProspectQueryIndexesWithMetrics(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const normalized = normalizeProspectPageQuery(query);
  const ownerTokensJson = JSON.stringify(normalizeTokens(visibility.ownerTokens));
  const canViewAll = visibility.canViewAll;
  const filters = normalized.filters;
  const workspace = workspaceSqlParameters(workspaceScope);

  const boundQuery = bindNamedQuery([
    PROSPECT_PAGE_QUERY_SQL_1,
    PROSPECT_PAGE_QUERY_SQL_2,
    PROSPECT_PAGE_QUERY_SQL_3,
    PROSPECT_PAGE_QUERY_SQL_4,
  ].join(''), {
    canViewAll,
    ownerTokensJson,
    workspaceAll: workspace.all,
    workspaceSourcesJson: workspace.sourcesJson,
    workspaceLeadTypesJson: workspace.leadTypesJson,
    workspaceTenderTypesJson: workspace.tenderTypesJson,
    workspaceProspectStagesJson: workspace.prospectStagesJson,
    workspaceOpportunityStatusesJson: workspace.opportunityStatusesJson,
    workspaceServiceCategoriesJson: workspace.serviceCategoriesJson,
    workspacePipelineStatusesJson: workspace.pipelineStatusesJson,
    workspaceHasTender: workspace.hasTender,
    workspaceRequireKnownService: workspace.requireKnownService,
    filterSearch: filters.search,
    filterStatus: filters.status,
    filterSignal: filters.signal,
    filterService: filters.service,
    filterOwner: filters.owner,
    filterFeedback: filters.feedback,
    filterFollowUp: filters.followUp,
    pageSize: normalized.pageSize,
    requestedPage: normalized.page,
  });
  const rows = await sql.query(boundQuery.text, boundQuery.params) as AggregatePageRow[];

  const row = rows[0];
  const summary = summaryFromAggregateRow(row);
  const visibleTotal = summary.total;
  const filteredTotal = numberValue(row?.filtered_total);
  const totalPages = Math.max(1, numberValue(row?.total_pages));
  const page = Math.max(1, numberValue(row?.page));
  const records = parseJsonArray<StoredLeadRecord>(row?.records).filter(isStoredRecord);
  const owners = parseJsonArray<unknown>(row?.owners)
    .filter((owner): owner is string => typeof owner === 'string')
    .map((owner) => owner.trim())
    .filter(Boolean);
  const offset = (page - 1) * normalized.pageSize;
  const start = filteredTotal === 0 ? 0 : offset + 1;
  const end = filteredTotal === 0 ? 0 : Math.min(offset + records.length, filteredTotal);
  const schemaQueryCount = schema.queryCount + indexes.queryCount;

  return {
    page: {
      records,
      page,
      pageSize: normalized.pageSize,
      totalPages,
      filteredTotal,
      visibleTotal,
      start,
      end,
      owners,
      summary,
      query: filters,
    },
    metrics: {
      queryCount: schemaQueryCount + 1,
      schemaQueryCount,
      dataQueryCount: 1,
      schemaCacheState: schema.cacheState === 'cold' || indexes.cacheState === 'cold' ? 'cold' : 'warm',
    },
  };
}
