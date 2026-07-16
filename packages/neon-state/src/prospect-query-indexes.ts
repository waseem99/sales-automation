import { neon } from '@neondatabase/serverless';

export const PROSPECT_QUERY_INDEX_MIGRATION_VERSION = '20260716_01';

export const PROSPECT_QUERY_INDEX_NAMES = [
  'prospect_records_owner_lower_idx',
  'prospect_records_pipeline_status_idx',
  'prospect_records_source_idx',
  'prospect_records_service_category_idx',
  'prospect_records_lead_type_idx',
  'prospect_records_opportunity_status_idx',
  'prospect_records_prospect_stage_idx',
  'prospect_records_tender_type_idx',
  'prospect_records_rank_updated_idx',
] as const;

export interface ProspectQueryIndexEnsureMetrics {
  queryCount: number;
  cacheState: 'cold' | 'warm';
}

const indexReadiness = new Map<string, Promise<void>>();
const INDEX_MIGRATION_QUERY_COUNT = 1;

export async function ensureProspectQueryIndexesWithMetrics(
  databaseUrl: string,
): Promise<ProspectQueryIndexEnsureMetrics> {
  const normalizedUrl = requireDatabaseUrl(databaseUrl);
  const existing = indexReadiness.get(normalizedUrl);
  if (existing) {
    await existing;
    return { queryCount: 0, cacheState: 'warm' };
  }

  const initialization = initializeProspectQueryIndexes(normalizedUrl);
  indexReadiness.set(normalizedUrl, initialization);
  try {
    await initialization;
    return { queryCount: INDEX_MIGRATION_QUERY_COUNT, cacheState: 'cold' };
  } catch (error) {
    if (indexReadiness.get(normalizedUrl) === initialization) indexReadiness.delete(normalizedUrl);
    throw error;
  }
}

async function initializeProspectQueryIndexes(databaseUrl: string): Promise<void> {
  const sql = neon(databaseUrl);
  await sql`
    DO $prospect_query_indexes$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('prospect-query-indexes-20260716-01'));

      CREATE TABLE IF NOT EXISTS prospect_schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes TEXT NOT NULL
      );

      IF NOT EXISTS (
        SELECT 1
        FROM prospect_schema_migrations
        WHERE version = '20260716_01'
      ) THEN
        CREATE INDEX IF NOT EXISTS prospect_records_owner_lower_idx
          ON prospect_records ((LOWER(COALESCE(record->'lead'->>'owner', ''))));

        CREATE INDEX IF NOT EXISTS prospect_records_pipeline_status_idx
          ON prospect_records ((COALESCE(record->'lead'->>'pipelineStatus', '')));

        CREATE INDEX IF NOT EXISTS prospect_records_source_idx
          ON prospect_records ((COALESCE(record->'lead'->>'source', '')));

        CREATE INDEX IF NOT EXISTS prospect_records_service_category_idx
          ON prospect_records ((COALESCE(record->'lead'->>'serviceCategory', '')));

        CREATE INDEX IF NOT EXISTS prospect_records_lead_type_idx
          ON prospect_records ((COALESCE(record->'lead'->>'leadType', '')));

        CREATE INDEX IF NOT EXISTS prospect_records_opportunity_status_idx
          ON prospect_records ((COALESCE(record->'lead'->>'opportunityStatus', '')));

        CREATE INDEX IF NOT EXISTS prospect_records_prospect_stage_idx
          ON prospect_records ((COALESCE(record->'lead'->>'prospectStage', '')));

        CREATE INDEX IF NOT EXISTS prospect_records_tender_type_idx
          ON prospect_records ((COALESCE(record->'lead'->'tender'->>'opportunityType', '')));

        CREATE INDEX IF NOT EXISTS prospect_records_rank_updated_idx
          ON prospect_records (
            (CASE
              WHEN COALESCE(record->'lead'->>'rank', '') ~ '^[0-9]+$'
                THEN (record->'lead'->>'rank')::int
              ELSE 999999
            END),
            (COALESCE(record->'lead'->>'updatedAt', record->'lead'->>'createdAt', '')) DESC
          );

        ANALYZE prospect_records;

        INSERT INTO prospect_schema_migrations (version, notes)
        VALUES (
          '20260716_01',
          'Indexes for current owner, workspace, filter and rank/update list query predicates.'
        )
        ON CONFLICT (version) DO NOTHING;
      END IF;
    END
    $prospect_query_indexes$
  `;
}

function requireDatabaseUrl(value: string): string {
  if (!value?.trim()) throw new Error('DATABASE_URL is required.');
  return value.trim();
}
