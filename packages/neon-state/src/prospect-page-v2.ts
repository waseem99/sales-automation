import { neon } from '@neondatabase/serverless';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { ensureNeonSchemaWithMetrics, requireDatabaseUrl } from './index.js';
import {
  normalizeProspectPageQuery,
  type ProspectDashboardSummary,
  type ProspectPageLoadResult,
  type ProspectPageQuery,
  type ProspectVisibility,
  type ProspectWorkspaceScope,
} from './prospect-query.js';
import { ensureProspectQueryIndexesWithMetrics } from './prospect-query-indexes.js';

interface AggregateRow {
  total: number | string;
  live: number | string;
  contacted: number | string;
  replied: number | string;
  follow_ups_due: number | string;
  unassigned: number | string;
  won: number | string;
  feedback_pending: number | string;
  filtered_total: number | string;
  owners: unknown;
}

interface RecordRow { record: unknown }

export async function loadNeonProspectPageV2WithMetrics(
  databaseUrl: string,
  query: ProspectPageQuery,
  visibility: ProspectVisibility,
  workspaceScope: ProspectWorkspaceScope = {},
): Promise<ProspectPageLoadResult> {
  const schema = await ensureNeonSchemaWithMetrics(databaseUrl);
  const indexes = await ensureProspectQueryIndexesWithMetrics(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const normalized = normalizeProspectPageQuery(query);
  const filters = normalized.filters;
  const ownerTokensJson = JSON.stringify(normalizeTokens(visibility.ownerTokens));
  const workspace = workspaceSqlParameters(workspaceScope);

  const aggregateRows = await sql`
    WITH visible AS MATERIALIZED (
      SELECT record
      FROM prospect_records
      WHERE (${visibility.canViewAll}::boolean OR EXISTS (
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
    ),
    filtered AS MATERIALIZED (
      SELECT record
      FROM visible
      WHERE (${filters.search} = '' OR LOWER(record::text) LIKE '%' || LOWER(${filters.search}) || '%')
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
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'opportunityStatus', '') = 'live_opportunity')::int AS live,
      COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'pipelineStatus', '') IN ('sent_manually','replied','meeting_booked','proposal_sent','won','lost'))::int AS contacted,
      COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'pipelineStatus', '') IN ('replied','meeting_booked','proposal_sent','won','lost'))::int AS replied,
      COUNT(*) FILTER (WHERE follow_up_at(record) <= NOW() AND actionable_follow_up(record))::int AS follow_ups_due,
      COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'owner', '') = '')::int AS unassigned,
      COUNT(*) FILTER (WHERE COALESCE(record->'lead'->>'pipelineStatus', '') = 'won')::int AS won,
      COUNT(*) FILTER (WHERE COALESCE(record->'lead'->'feedback'->>'status', 'pending') <> 'complete')::int AS feedback_pending,
      (SELECT COUNT(*)::int FROM filtered) AS filtered_total,
      COALESCE((
        SELECT JSONB_AGG(owner ORDER BY owner)
        FROM (
          SELECT DISTINCT NULLIF(record->'lead'->>'owner', '') AS owner
          FROM visible
          WHERE NULLIF(record->'lead'->>'owner', '') IS NOT NULL
        ) owners_in_scope
      ), '[]'::jsonb) AS owners
    FROM visible
  ` as AggregateRow[];

  const aggregate = aggregateRows[0];
  const summary = summaryFromRow(aggregate);
  const filteredTotal = numberValue(aggregate?.filtered_total);
  const totalPages = Math.max(1, Math.ceil(filteredTotal / normalized.pageSize));
  const page = Math.min(normalized.page, totalPages);
  const offset = (page - 1) * normalized.pageSize;

  const rows = await sql`
    SELECT record
    FROM prospect_records
    WHERE (${visibility.canViewAll}::boolean OR EXISTS (
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
      visibleTotal: summary.total,
      start,
      end,
      owners: ownersFromValue(aggregate?.owners),
      summary,
      query: filters,
    },
    metrics: {
      queryCount: schema.queryCount + indexes.queryCount + 2,
      schemaQueryCount: schema.queryCount + indexes.queryCount,
      dataQueryCount: 2,
      schemaCacheState: schema.cacheState === 'cold' || indexes.cacheState === 'cold' ? 'cold' : 'warm',
    },
  };
}

function workspaceSqlParameters(scope: ProspectWorkspaceScope) {
  const normalized = {
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
  const all = normalized.sources.length === 0
    && normalized.leadTypes.length === 0
    && normalized.tenderOpportunityTypes.length === 0
    && normalized.prospectStages.length === 0
    && normalized.opportunityStatuses.length === 0
    && normalized.serviceCategories.length === 0
    && normalized.pipelineStatuses.length === 0
    && !normalized.hasTender
    && !normalized.requireKnownService;
  return {
    all,
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

function summaryFromRow(row: AggregateRow | undefined): ProspectDashboardSummary {
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

function ownersFromValue(value: unknown): string[] {
  const parsed = typeof value === 'string' ? safeParse(value) : value;
  return Array.isArray(parsed)
    ? parsed.map((owner) => typeof owner === 'string' ? owner.trim() : '').filter(Boolean)
    : [];
}

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return []; }
}

function normalizeTokens(tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => token.trim().toLowerCase()).filter(Boolean))];
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
