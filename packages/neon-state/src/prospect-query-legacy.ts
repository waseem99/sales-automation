import { neon } from '@neondatabase/serverless';
import type { ProspectDiscoveryRun } from '@sales-automation/prospect-discovery';
import type { Lead } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { ensureNeonSchema, ensureNeonSchemaWithMetrics, requireDatabaseUrl } from './index.js';

export const PROSPECT_PAGE_SIZES = [25, 50, 100] as const;
export type ProspectPageSize = typeof PROSPECT_PAGE_SIZES[number];

export interface ProspectVisibility {
  canViewAll: boolean;
  ownerTokens: string[];
}

export interface ProspectWorkspaceScope {
  sources?: string[];
  leadTypes?: string[];
  tenderOpportunityTypes?: string[];
  prospectStages?: string[];
  opportunityStatuses?: string[];
  serviceCategories?: string[];
  pipelineStatuses?: string[];
  hasTender?: boolean;
  requireKnownService?: boolean;
}

export interface ProspectPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  signal?: string;
  service?: string;
  owner?: string;
  feedback?: string;
  followUp?: string;
}

export interface ProspectDashboardSummary {
  total: number;
  live: number;
  contacted: number;
  replied: number;
  followUpsDue: number;
  unassigned: number;
  won: number;
  feedbackPending: number;
}

export interface ProspectPageResult {
  records: StoredLeadRecord[];
  page: number;
  pageSize: ProspectPageSize;
  totalPages: number;
  filteredTotal: number;
  visibleTotal: number;
  start: number;
  end: number;
  owners: string[];
  summary: ProspectDashboardSummary;
  query: Required<Omit<ProspectPageQuery, 'page' | 'pageSize'>>;
}

export interface ProspectQueryMetrics {
  queryCount: number;
  schemaQueryCount: number;
  dataQueryCount: number;
  schemaCacheState: 'cold' | 'warm';
}

export interface ProspectPageLoadResult {
  page: ProspectPageResult;
  metrics: ProspectQueryMetrics;
}

export interface ProspectRecordLoadResult {
  record?: StoredLeadRecord;
  metrics: ProspectQueryMetrics;
}

interface RecordRow { record: unknown }
interface CountRow { count: number | string }
interface OwnerRow { owner: string | null }
interface RunRow { run: unknown }
interface SummaryRow {
  total: number | string;
  live: number | string;
  contacted: number | string;
  replied: number | string;
  follow_ups_due: number | string;
  unassigned: number | string;
  won: number | string;
  feedback_pending: number | string;
}

export function normalizeProspectPageQuery(query: ProspectPageQuery): {
  page: number;
  pageSize: ProspectPageSize;
  filters: ProspectPageResult['query'];
} {
  const page = positiveInteger(query.page, 1);
  const requestedPageSize = positiveInteger(query.pageSize, 25);
  const pageSize = (PROSPECT_PAGE_SIZES as readonly number[]).includes(requestedPageSize)
    ? requestedPageSize as ProspectPageSize
    : 25;
  return {
    page,
    pageSize,
    filters: {
      search: clean(query.search),
      status: clean(query.status),
      signal: clean(query.signal),
      service: clean(query.service),
      owner: clean(query.owner),
      feedback: clean(query.feedback),
      followUp: normalizeFollowUpFilter(query.followUp),
    },
  };
}

export function matchesProspectWorkspaceScope(lead: Lead, scope: ProspectWorkspaceScope = {}): boolean {
  const normalized = normalizeWorkspaceScope(scope);
  if (!workspaceScopeHasCriteria(normalized)) return true;
  return normalized.sources.includes(lead.source)
    || normalized.leadTypes.includes(lead.leadType)
    || normalized.tenderOpportunityTypes.includes(lead.tender?.opportunityType ?? '')
    || normalized.prospectStages.includes(lead.prospectStage ?? '')
    || normalized.opportunityStatuses.includes(lead.opportunityStatus ?? '')
    || normalized.serviceCategories.includes(lead.serviceCategory)
    || normalized.pipelineStatuses.includes(lead.pipelineStatus)
    || (normalized.hasTender && Boolean(lead.tender))
    || (normalized.requireKnownService && lead.serviceCategory !== 'unknown');
}

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
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const normalized = normalizeProspectPageQuery(query);
  const ownerTokensJson = JSON.stringify(normalizeTokens(visibility.ownerTokens));
  const canViewAll = visibility.canViewAll;
  const filters = normalized.filters;
  const workspace = workspaceSqlParameters(workspaceScope);

  const [summaryRows, filteredRows, ownerRows] = await sql.transaction([
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE COALESCE(record->'lead'->>'opportunityStatus', '') = 'live_opportunity'
        )::int AS live,
        COUNT(*) FILTER (
          WHERE COALESCE(record->'lead'->>'pipelineStatus', '') IN ('sent_manually','replied','meeting_booked','proposal_sent','won','lost')
        )::int AS contacted,
        COUNT(*) FILTER (
          WHERE COALESCE(record->'lead'->>'pipelineStatus', '') IN ('replied','meeting_booked','proposal_sent','won','lost')
        )::int AS replied,
        COUNT(*) FILTER (
          WHERE follow_up_at(record) <= NOW()
            AND actionable_follow_up(record)
        )::int AS follow_ups_due,
        COUNT(*) FILTER (
          WHERE COALESCE(record->'lead'->>'owner', '') = ''
        )::int AS unassigned,
        COUNT(*) FILTER (
          WHERE COALESCE(record->'lead'->>'pipelineStatus', '') = 'won'
        )::int AS won,
        COUNT(*) FILTER (
          WHERE COALESCE(record->'lead'->'feedback'->>'status', 'pending') <> 'complete'
        )::int AS feedback_pending
      FROM prospect_records
      WHERE (${canViewAll}::boolean OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${ownerTokensJson}::jsonb) AS visible_token(value)
        WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
           OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
      ))
        AND (
          ${workspace.all}::boolean
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.sourcesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'source', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.leadTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'leadType', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.tenderTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->'tender'->>'opportunityType', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.prospectStagesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'prospectStage', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.opportunityStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'opportunityStatus', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.serviceCategoriesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'serviceCategory', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.pipelineStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'pipelineStatus', '') = item.value)
          OR (${workspace.hasTender}::boolean AND COALESCE(jsonb_typeof(record->'lead'->'tender') = 'object', false))
          OR (${workspace.requireKnownService}::boolean AND COALESCE(record->'lead'->>'serviceCategory', '') <> 'unknown')
        )
    `,
    sql`
      SELECT COUNT(*)::int AS count
      FROM prospect_records
      WHERE (${canViewAll}::boolean OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${ownerTokensJson}::jsonb) AS visible_token(value)
        WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
           OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
      ))
        AND (
          ${workspace.all}::boolean
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.sourcesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'source', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.leadTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'leadType', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.tenderTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->'tender'->>'opportunityType', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.prospectStagesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'prospectStage', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.opportunityStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'opportunityStatus', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.serviceCategoriesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'serviceCategory', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.pipelineStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'pipelineStatus', '') = item.value)
          OR (${workspace.hasTender}::boolean AND COALESCE(jsonb_typeof(record->'lead'->'tender') = 'object', false))
          OR (${workspace.requireKnownService}::boolean AND COALESCE(record->'lead'->>'serviceCategory', '') <> 'unknown')
        )
        AND (${filters.search} = '' OR LOWER(record::text) LIKE '%' || LOWER(${filters.search}) || '%')
        AND (${filters.status} = '' OR COALESCE(record->'lead'->>'pipelineStatus', '') = ${filters.status})
        AND (${filters.signal} = '' OR COALESCE(record->'lead'->>'opportunityStatus', '') = ${filters.signal})
        AND (${filters.service} = '' OR COALESCE(record->'lead'->>'serviceCategory', '') = ${filters.service})
        AND (${filters.owner} = '' OR (${filters.owner} = 'unassigned' AND COALESCE(record->'lead'->>'owner', '') = '') OR LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(${filters.owner}))
        AND (${filters.feedback} = '' OR COALESCE(record->'lead'->'feedback'->>'status', 'pending') = ${filters.feedback})
        AND (
          ${filters.followUp} = ''
          OR (${filters.followUp} = 'due' AND follow_up_at(record) <= NOW() AND actionable_follow_up(record))
          OR (${filters.followUp} = 'overdue' AND follow_up_at(record) < DATE_TRUNC('day', NOW()) AND actionable_follow_up(record))
          OR (${filters.followUp} = 'today' AND follow_up_at(record) >= DATE_TRUNC('day', NOW()) AND follow_up_at(record) < DATE_TRUNC('day', NOW()) + INTERVAL '1 day' AND actionable_follow_up(record))
          OR (${filters.followUp} = 'next_7_days' AND follow_up_at(record) > NOW() AND follow_up_at(record) <= NOW() + INTERVAL '7 days' AND actionable_follow_up(record))
          OR (${filters.followUp} = 'scheduled' AND follow_up_at(record) IS NOT NULL AND actionable_follow_up(record))
          OR (${filters.followUp} = 'not_scheduled' AND follow_up_at(record) IS NULL AND actionable_follow_up(record))
        )
    `,
    sql`
      SELECT DISTINCT NULLIF(record->'lead'->>'owner', '') AS owner
      FROM prospect_records
      WHERE (${canViewAll}::boolean OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${ownerTokensJson}::jsonb) AS visible_token(value)
        WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
           OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
      ))
        AND (
          ${workspace.all}::boolean
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.sourcesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'source', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.leadTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'leadType', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.tenderTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->'tender'->>'opportunityType', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.prospectStagesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'prospectStage', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.opportunityStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'opportunityStatus', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.serviceCategoriesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'serviceCategory', '') = item.value)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.pipelineStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'pipelineStatus', '') = item.value)
          OR (${workspace.hasTender}::boolean AND COALESCE(jsonb_typeof(record->'lead'->'tender') = 'object', false))
          OR (${workspace.requireKnownService}::boolean AND COALESCE(record->'lead'->>'serviceCategory', '') <> 'unknown')
        )
        AND NULLIF(record->'lead'->>'owner', '') IS NOT NULL
      ORDER BY owner
    `,
  ], { readOnly: true, isolationLevel: 'ReadCommitted' });

  const summary = summaryFromRow((summaryRows as SummaryRow[])[0]);
  const visibleTotal = summary.total;
  const filteredTotal = numberValue((filteredRows as CountRow[])[0]?.count);
  const totalPages = Math.max(1, Math.ceil(filteredTotal / normalized.pageSize));
  const page = Math.min(normalized.page, totalPages);
  const offset = (page - 1) * normalized.pageSize;

  const rows = await sql`
    SELECT record
    FROM prospect_records
    WHERE (${canViewAll}::boolean OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${ownerTokensJson}::jsonb) AS visible_token(value)
      WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
         OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
    ))
      AND (
        ${workspace.all}::boolean
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.sourcesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'source', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.leadTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'leadType', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.tenderTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->'tender'->>'opportunityType', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.prospectStagesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'prospectStage', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.opportunityStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'opportunityStatus', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.serviceCategoriesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'serviceCategory', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.pipelineStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'pipelineStatus', '') = item.value)
        OR (${workspace.hasTender}::boolean AND COALESCE(jsonb_typeof(record->'lead'->'tender') = 'object', false))
        OR (${workspace.requireKnownService}::boolean AND COALESCE(record->'lead'->>'serviceCategory', '') <> 'unknown')
      )
      AND (${filters.search} = '' OR LOWER(record::text) LIKE '%' || LOWER(${filters.search}) || '%')
      AND (${filters.status} = '' OR COALESCE(record->'lead'->>'pipelineStatus', '') = ${filters.status})
      AND (${filters.signal} = '' OR COALESCE(record->'lead'->>'opportunityStatus', '') = ${filters.signal})
      AND (${filters.service} = '' OR COALESCE(record->'lead'->>'serviceCategory', '') = ${filters.service})
      AND (${filters.owner} = '' OR (${filters.owner} = 'unassigned' AND COALESCE(record->'lead'->>'owner', '') = '') OR LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(${filters.owner}))
      AND (${filters.feedback} = '' OR COALESCE(record->'lead'->'feedback'->>'status', 'pending') = ${filters.feedback})
      AND (
        ${filters.followUp} = ''
        OR (${filters.followUp} = 'due' AND follow_up_at(record) <= NOW() AND actionable_follow_up(record))
        OR (${filters.followUp} = 'overdue' AND follow_up_at(record) < DATE_TRUNC('day', NOW()) AND actionable_follow_up(record))
        OR (${filters.followUp} = 'today' AND follow_up_at(record) >= DATE_TRUNC('day', NOW()) AND follow_up_at(record) < DATE_TRUNC('day', NOW()) + INTERVAL '1 day' AND actionable_follow_up(record))
        OR (${filters.followUp} = 'next_7_days' AND follow_up_at(record) > NOW() AND follow_up_at(record) <= NOW() + INTERVAL '7 days' AND actionable_follow_up(record))
        OR (${filters.followUp} = 'scheduled' AND follow_up_at(record) IS NOT NULL AND actionable_follow_up(record))
        OR (${filters.followUp} = 'not_scheduled' AND follow_up_at(record) IS NULL AND actionable_follow_up(record))
      )
    ORDER BY
      CASE WHEN ${filters.followUp} IN ('due','overdue','today','next_7_days','scheduled') THEN follow_up_at(record) END ASC NULLS LAST,
      CASE WHEN COALESCE(record->'lead'->>'rank', '') ~ '^\\d+$' THEN (record->'lead'->>'rank')::int ELSE 999999 END ASC,
      COALESCE(record->'lead'->>'updatedAt', record->'lead'->>'createdAt', '') DESC
    LIMIT ${normalized.pageSize}
    OFFSET ${offset}
  ` as RecordRow[];

  const records = rows.map((row) => parseJson<StoredLeadRecord>(row.record)).filter(isStoredRecord);
  const start = filteredTotal === 0 ? 0 : offset + 1;
  const end = filteredTotal === 0 ? 0 : Math.min(offset + records.length, filteredTotal);
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
      owners: (ownerRows as OwnerRow[]).map((row) => row.owner?.trim()).filter((owner): owner is string => Boolean(owner)),
      summary,
      query: filters,
    },
    metrics: {
      queryCount: schema.queryCount + 4,
      schemaQueryCount: schema.queryCount,
      dataQueryCount: 4,
      schemaCacheState: schema.cacheState,
    },
  };
}

export async function loadNeonProspectRecord(
  databaseUrl: string,
  leadId: string,
  visibility: ProspectVisibility,
  workspaceScope: ProspectWorkspaceScope = {},
): Promise<StoredLeadRecord | undefined> {
  return (await loadNeonProspectRecordWithMetrics(databaseUrl, leadId, visibility, workspaceScope)).record;
}

export async function loadNeonProspectRecordWithMetrics(
  databaseUrl: string,
  leadId: string,
  visibility: ProspectVisibility,
  workspaceScope: ProspectWorkspaceScope = {},
): Promise<ProspectRecordLoadResult> {
  const schema = await ensureNeonSchemaWithMetrics(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const ownerTokensJson = JSON.stringify(normalizeTokens(visibility.ownerTokens));
  const workspace = workspaceSqlParameters(workspaceScope);
  const rows = await sql`
    SELECT record
    FROM prospect_records
    WHERE lead_id = ${leadId}
      AND (${visibility.canViewAll}::boolean OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${ownerTokensJson}::jsonb) AS visible_token(value)
        WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
           OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
      ))
      AND (
        ${workspace.all}::boolean
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.sourcesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'source', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.leadTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'leadType', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.tenderTypesJson}::jsonb) item WHERE COALESCE(record->'lead'->'tender'->>'opportunityType', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.prospectStagesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'prospectStage', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.opportunityStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'opportunityStatus', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.serviceCategoriesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'serviceCategory', '') = item.value)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${workspace.pipelineStatusesJson}::jsonb) item WHERE COALESCE(record->'lead'->>'pipelineStatus', '') = item.value)
        OR (${workspace.hasTender}::boolean AND COALESCE(jsonb_typeof(record->'lead'->'tender') = 'object', false))
        OR (${workspace.requireKnownService}::boolean AND COALESCE(record->'lead'->>'serviceCategory', '') <> 'unknown')
      )
    LIMIT 1
  ` as RecordRow[];
  return {
    record: parseJson<StoredLeadRecord>(rows[0]?.record),
    metrics: {
      queryCount: schema.queryCount + 1,
      schemaQueryCount: schema.queryCount,
      dataQueryCount: 1,
      schemaCacheState: schema.cacheState,
    },
  };
}

export async function loadNeonScopedRecords(
  databaseUrl: string,
  visibility: ProspectVisibility,
  limit = 5_000,
): Promise<StoredLeadRecord[]> {
  await ensureNeonSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const ownerTokensJson = JSON.stringify(normalizeTokens(visibility.ownerTokens));
  const rows = await sql`
    SELECT record
    FROM prospect_records
    WHERE ${visibility.canViewAll}::boolean OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${ownerTokensJson}::jsonb) AS visible_token(value)
      WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
         OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
    )
    ORDER BY COALESCE(record->'lead'->>'updatedAt', record->'lead'->>'createdAt', '') DESC
    LIMIT ${Math.max(1, Math.min(limit, 10_000))}
  ` as RecordRow[];
  return rows.map((row) => parseJson<StoredLeadRecord>(row.record)).filter(isStoredRecord);
}

export async function loadNeonDiscoveryRuns(databaseUrl: string, limit = 30): Promise<ProspectDiscoveryRun[]> {
  await ensureNeonSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const rows = await sql`
    SELECT run
    FROM prospect_discovery_runs
    ORDER BY completed_at DESC
    LIMIT ${Math.max(1, Math.min(limit, 180))}
  ` as RunRow[];
  return rows.map((row) => parseJson<ProspectDiscoveryRun>(row.run)).filter((run): run is ProspectDiscoveryRun => Boolean(run?.id));
}

function workspaceSqlParameters(scope: ProspectWorkspaceScope) {
  const normalized = normalizeWorkspaceScope(scope);
  return {
    all: !workspaceScopeHasCriteria(normalized),
    sourcesJson: JSON.stringify(normalized.sources),
    leadTypesJson: JSON.stringify(normalized.leadTypes),
    tenderTypesJson: JSON.stringify(normalized.tenderOpportunityTypes),
    prospectStagesJson: JSON.stringify(normalized.prospectStages),
    opportunityStatusesJson: JSON.stringify(normalized.opportunityStatuses),
    serviceCategoriesJson: JSON.stringify(normalized.serviceCategories),
    pipelineStatusesJson: JSON.stringify(normalized.pipelineStatuses),
    hasTender: normalized.hasTender,
    requireKnownService: normalized.requireKnownService,
  };
}

function normalizeWorkspaceScope(scope: ProspectWorkspaceScope) {
  return {
    sources: normalizeTokens(scope.sources ?? []),
    leadTypes: normalizeTokens(scope.leadTypes ?? []),
    tenderOpportunityTypes: normalizeTokens(scope.tenderOpportunityTypes ?? []),
    prospectStages: normalizeTokens(scope.prospectStages ?? []),
    opportunityStatuses: normalizeTokens(scope.opportunityStatuses ?? []),
    serviceCategories: normalizeTokens(scope.serviceCategories ?? []),
    pipelineStatuses: normalizeTokens(scope.pipelineStatuses ?? []),
    hasTender: scope.hasTender === true,
    requireKnownService: scope.requireKnownService === true,
  };
}

function workspaceScopeHasCriteria(scope: ReturnType<typeof normalizeWorkspaceScope>): boolean {
  return scope.sources.length > 0
    || scope.leadTypes.length > 0
    || scope.tenderOpportunityTypes.length > 0
    || scope.prospectStages.length > 0
    || scope.opportunityStatuses.length > 0
    || scope.serviceCategories.length > 0
    || scope.pipelineStatuses.length > 0
    || scope.hasTender
    || scope.requireKnownService;
}

function summaryFromRow(row: SummaryRow | undefined): ProspectDashboardSummary {
  return {
    total: numberValue(row?.total),
    live: numberValue(row?.live),
    contacted: numberValue(row?.contacted),
    replied: numberValue(row?.replied),
    followUpsDue: numberValue(row?.follow_ups_due),
    unassigned: numberValue(row?.unassigned),
    won: numberValue(row?.won),
    feedbackPending: numberValue(row?.feedback_pending),
  };
}

function normalizeTokens(tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => token.trim().toLowerCase()).filter(Boolean))];
}

function normalizeFollowUpFilter(value: unknown): string {
  const normalized = clean(value);
  return ['due', 'overdue', 'today', 'next_7_days', 'scheduled', 'not_scheduled'].includes(normalized)
    ? normalized
    : '';
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function numberValue(value: number | string | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function parseJson<T>(value: unknown): T | undefined {
  if (value && typeof value === 'object') return value as T;
  if (typeof value !== 'string') return undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

function isStoredRecord(value: StoredLeadRecord | undefined): value is StoredLeadRecord {
  return Boolean(value?.lead?.id);
}
