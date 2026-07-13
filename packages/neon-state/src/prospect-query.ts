import { neon } from '@neondatabase/serverless';
import type { ProspectDiscoveryRun } from '@sales-automation/prospect-discovery';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { ensureNeonSchema, requireDatabaseUrl } from './index.js';

export const PROSPECT_PAGE_SIZES = [25, 50, 100] as const;
export type ProspectPageSize = typeof PROSPECT_PAGE_SIZES[number];

export interface ProspectVisibility {
  canViewAll: boolean;
  ownerTokens: string[];
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
  query: Required<Omit<ProspectPageQuery, 'page' | 'pageSize'>>;
}

interface RecordRow { record: unknown }
interface CountRow { count: number | string }
interface OwnerRow { owner: string | null }
interface RunRow { run: unknown }

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
    },
  };
}

export async function loadNeonProspectPage(
  databaseUrl: string,
  query: ProspectPageQuery,
  visibility: ProspectVisibility,
): Promise<ProspectPageResult> {
  await ensureNeonSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const normalized = normalizeProspectPageQuery(query);
  const ownerTokensJson = JSON.stringify(normalizeTokens(visibility.ownerTokens));
  const canViewAll = visibility.canViewAll;
  const filters = normalized.filters;

  const [visibleRows, filteredRows, ownerRows] = await sql.transaction([
    sql`
      SELECT COUNT(*)::int AS count
      FROM prospect_records
      WHERE ${canViewAll}::boolean OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${ownerTokensJson}::jsonb) AS visible_token(value)
        WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
           OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
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
        AND (${filters.search} = '' OR LOWER(record::text) LIKE '%' || LOWER(${filters.search}) || '%')
        AND (${filters.status} = '' OR COALESCE(record->'lead'->>'pipelineStatus', '') = ${filters.status})
        AND (${filters.signal} = '' OR COALESCE(record->'lead'->>'opportunityStatus', '') = ${filters.signal})
        AND (${filters.service} = '' OR COALESCE(record->'lead'->>'serviceCategory', '') = ${filters.service})
        AND (${filters.owner} = '' OR (${filters.owner} = 'unassigned' AND COALESCE(record->'lead'->>'owner', '') = '') OR LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(${filters.owner}))
        AND (${filters.feedback} = '' OR COALESCE(record->'lead'->'feedback'->>'status', 'pending') = ${filters.feedback})
    `,
    sql`
      SELECT DISTINCT NULLIF(record->'lead'->>'owner', '') AS owner
      FROM prospect_records
      WHERE (${canViewAll}::boolean OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${ownerTokensJson}::jsonb) AS visible_token(value)
        WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
           OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
      ))
        AND NULLIF(record->'lead'->>'owner', '') IS NOT NULL
      ORDER BY owner
    `,
  ], { readOnly: true, isolationLevel: 'ReadCommitted' });

  const visibleTotal = numberValue((visibleRows as CountRow[])[0]?.count);
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
      AND (${filters.search} = '' OR LOWER(record::text) LIKE '%' || LOWER(${filters.search}) || '%')
      AND (${filters.status} = '' OR COALESCE(record->'lead'->>'pipelineStatus', '') = ${filters.status})
      AND (${filters.signal} = '' OR COALESCE(record->'lead'->>'opportunityStatus', '') = ${filters.signal})
      AND (${filters.service} = '' OR COALESCE(record->'lead'->>'serviceCategory', '') = ${filters.service})
      AND (${filters.owner} = '' OR (${filters.owner} = 'unassigned' AND COALESCE(record->'lead'->>'owner', '') = '') OR LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(${filters.owner}))
      AND (${filters.feedback} = '' OR COALESCE(record->'lead'->'feedback'->>'status', 'pending') = ${filters.feedback})
    ORDER BY
      CASE WHEN COALESCE(record->'lead'->>'rank', '') ~ '^\\d+$' THEN (record->'lead'->>'rank')::int ELSE 999999 END ASC,
      COALESCE(record->'lead'->>'updatedAt', record->'lead'->>'createdAt', '') DESC
    LIMIT ${normalized.pageSize}
    OFFSET ${offset}
  ` as RecordRow[];

  const records = rows.map((row) => parseJson<StoredLeadRecord>(row.record)).filter(isStoredRecord);
  const start = filteredTotal === 0 ? 0 : offset + 1;
  const end = filteredTotal === 0 ? 0 : Math.min(offset + records.length, filteredTotal);

  return {
    records,
    page,
    pageSize: normalized.pageSize,
    totalPages,
    filteredTotal,
    visibleTotal,
    start,
    end,
    owners: (ownerRows as OwnerRow[]).map((row) => row.owner?.trim()).filter((owner): owner is string => Boolean(owner)),
    query: filters,
  };
}

export async function loadNeonProspectRecord(
  databaseUrl: string,
  leadId: string,
  visibility: ProspectVisibility,
): Promise<StoredLeadRecord | undefined> {
  await ensureNeonSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const ownerTokensJson = JSON.stringify(normalizeTokens(visibility.ownerTokens));
  const rows = await sql`
    SELECT record
    FROM prospect_records
    WHERE lead_id = ${leadId}
      AND (${visibility.canViewAll}::boolean OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${ownerTokensJson}::jsonb) AS visible_token(value)
        WHERE LOWER(COALESCE(record->'lead'->>'owner', '')) = LOWER(visible_token.value)
           OR LOWER(COALESCE(record->'lead'->>'owner', '')) LIKE '%' || LOWER(visible_token.value) || '%'
      ))
    LIMIT 1
  ` as RecordRow[];
  return parseJson<StoredLeadRecord>(rows[0]?.record);
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

function normalizeTokens(tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => token.trim().toLowerCase()).filter(Boolean))];
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
