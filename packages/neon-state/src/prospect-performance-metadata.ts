interface EvidenceSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  query(text: string, params?: unknown[]): Promise<unknown[]>;
}

import type { ProspectEvidenceMetadata, ProspectEvidenceRepresentatives } from './prospect-performance-types.js';

interface MetadataRow {
  applied_at?: string | null;
  notes?: string | null;
  estimated_rows?: number | string | null;
  indexes?: unknown;
}

interface RepresentativeRow {
  owner?: string | null;
  pipeline_status?: string | null;
  source?: string | null;
  service_category?: string | null;
  lead_type?: string | null;
  opportunity_status?: string | null;
  prospect_stage?: string | null;
  tender_type?: string | null;
}

export async function loadProspectEvidenceMetadata(
  sql: EvidenceSql,
  migrationVersion: string,
): Promise<ProspectEvidenceMetadata> {
  const rows = await sql`
    SELECT
      (SELECT applied_at::text FROM prospect_schema_migrations WHERE version = ${migrationVersion} LIMIT 1) AS applied_at,
      (SELECT notes FROM prospect_schema_migrations WHERE version = ${migrationVersion} LIMIT 1) AS notes,
      COALESCE((SELECT reltuples::bigint FROM pg_class WHERE oid = to_regclass('public.prospect_records')), 0) AS estimated_rows,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', index_class.relname, 'scanCount', COALESCE(index_stats.idx_scan, 0)) ORDER BY index_class.relname)
        FROM pg_class table_class
        JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
        JOIN pg_index index_entry ON index_entry.indrelid = table_class.oid
        JOIN pg_class index_class ON index_class.oid = index_entry.indexrelid
        LEFT JOIN pg_stat_user_indexes index_stats ON index_stats.indexrelid = index_class.oid
        WHERE namespace.nspname = current_schema() AND table_class.relname = 'prospect_records'
      ), '[]'::jsonb) AS indexes
  ` as MetadataRow[];
  const row = rows[0] ?? {};
  return {
    appliedAt: optionalText(row.applied_at),
    notes: optionalText(row.notes),
    estimatedRows: numberValue(row.estimated_rows),
    installedIndexes: parseInstalledIndexes(row.indexes),
  };
}

export async function loadProspectEvidenceRepresentatives(sql: EvidenceSql): Promise<ProspectEvidenceRepresentatives> {
  const rows = await sql`
    SELECT
      (SELECT LOWER(COALESCE(record->'lead'->>'owner', '')) FROM prospect_records WHERE COALESCE(record->'lead'->>'owner', '') <> '' LIMIT 1) AS owner,
      (SELECT COALESCE(record->'lead'->>'pipelineStatus', '') FROM prospect_records WHERE COALESCE(record->'lead'->>'pipelineStatus', '') <> '' LIMIT 1) AS pipeline_status,
      (SELECT COALESCE(record->'lead'->>'source', '') FROM prospect_records WHERE COALESCE(record->'lead'->>'source', '') <> '' LIMIT 1) AS source,
      (SELECT COALESCE(record->'lead'->>'serviceCategory', '') FROM prospect_records WHERE COALESCE(record->'lead'->>'serviceCategory', '') <> '' LIMIT 1) AS service_category,
      (SELECT COALESCE(record->'lead'->>'leadType', '') FROM prospect_records WHERE COALESCE(record->'lead'->>'leadType', '') <> '' LIMIT 1) AS lead_type,
      (SELECT COALESCE(record->'lead'->>'opportunityStatus', '') FROM prospect_records WHERE COALESCE(record->'lead'->>'opportunityStatus', '') <> '' LIMIT 1) AS opportunity_status,
      (SELECT COALESCE(record->'lead'->>'prospectStage', '') FROM prospect_records WHERE COALESCE(record->'lead'->>'prospectStage', '') <> '' LIMIT 1) AS prospect_stage,
      (SELECT COALESCE(record->'lead'->'tender'->>'opportunityType', '') FROM prospect_records WHERE COALESCE(record->'lead'->'tender'->>'opportunityType', '') <> '' LIMIT 1) AS tender_type
  ` as RepresentativeRow[];
  const row = rows[0] ?? {};
  return {
    owner: optionalText(row.owner),
    pipelineStatus: optionalText(row.pipeline_status),
    source: optionalText(row.source),
    serviceCategory: optionalText(row.service_category),
    leadType: optionalText(row.lead_type),
    opportunityStatus: optionalText(row.opportunity_status),
    prospectStage: optionalText(row.prospect_stage),
    tenderType: optionalText(row.tender_type),
  };
}

function parseInstalledIndexes(value: unknown): Array<{ name: string; scanCount: number }> {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const object = asObject(item);
    const name = optionalText(object?.name);
    return name ? [{ name, scanCount: numberValue(object?.scanCount) }] : [];
  });
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
}
function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
