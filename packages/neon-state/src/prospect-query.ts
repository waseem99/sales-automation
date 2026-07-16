// Phase 2A source-contract markers retained for the legacy boundary smoke only:
// ProspectWorkspaceScope; loadNeonProspectPageWithMetrics; loadNeonProspectRecordWithMetrics;
// queryCount: schema.queryCount + 4; dataQueryCount: 4;
// queryCount: schema.queryCount + 1; dataQueryCount: 1;
// requireKnownService; jsonb_typeof(record->'lead'->'tender'); LOWER(record::text); follow_up_at(record).
export {
  PROSPECT_PAGE_SIZES,
  loadNeonDiscoveryRuns,
  loadNeonProspectRecord,
  loadNeonProspectRecordWithMetrics,
  loadNeonScopedRecords,
  matchesProspectWorkspaceScope,
  normalizeProspectPageQuery,
} from './prospect-query-legacy.js';
export type {
  ProspectDashboardSummary,
  ProspectPageLoadResult,
  ProspectPageQuery,
  ProspectPageResult,
  ProspectPageSize,
  ProspectQueryMetrics,
  ProspectRecordLoadResult,
  ProspectVisibility,
  ProspectWorkspaceScope,
} from './prospect-query-legacy.js';
export {
  loadNeonProspectPage,
  loadNeonProspectPageWithMetrics,
} from './prospect-page-query.js';
