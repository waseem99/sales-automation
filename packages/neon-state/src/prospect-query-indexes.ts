import { neon } from '@neondatabase/serverless';
import { requireDatabaseUrl } from './index.js';

export interface ProspectQueryIndexMetrics {
  queryCount: number;
  cacheState: 'cold' | 'warm';
}

export const PROSPECT_QUERY_INDEX_NAMES = [
  'prospect_records_owner_lower_idx',
  'prospect_records_pipeline_status_idx',
  'prospect_records_opportunity_status_idx',
  'prospect_records_source_idx',
  'prospect_records_lead_type_idx',
  'prospect_records_service_category_idx',
  'prospect_records_prospect_stage_idx',
  'prospect_records_feedback_status_idx',
  'prospect_records_tender_type_idx',
  'prospect_records_updated_order_idx',
  'prospect_records_rank_updated_order_idx',
  'prospect_records_closeability_band_idx',
] as const;

const indexReadiness = new Map<string, Promise<void>>();

export async function ensureProspectQueryIndexesWithMetrics(databaseUrl: string): Promise<ProspectQueryIndexMetrics> {
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
    return { queryCount: 1, cacheState: 'cold' };
  } catch (error) {
    if (indexReadiness.get(normalizedUrl) === initialization) indexReadiness.delete(normalizedUrl);
    throw error;
  }
}

async function initializeProspectQueryIndexes(databaseUrl: string): Promise<void> {
  const sql = neon(databaseUrl);
  await sql`
    DO $$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('prospect-query-indexes-v1'));
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_owner_lower_idx ON prospect_records ((LOWER(COALESCE(record->''lead''->>''owner'', ''''))))';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_pipeline_status_idx ON prospect_records ((COALESCE(record->''lead''->>''pipelineStatus'', '''')))';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_opportunity_status_idx ON prospect_records ((COALESCE(record->''lead''->>''opportunityStatus'', '''')))';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_source_idx ON prospect_records ((COALESCE(record->''lead''->>''source'', '''')))';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_lead_type_idx ON prospect_records ((COALESCE(record->''lead''->>''leadType'', '''')))';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_service_category_idx ON prospect_records ((COALESCE(record->''lead''->>''serviceCategory'', '''')))';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_prospect_stage_idx ON prospect_records ((COALESCE(record->''lead''->>''prospectStage'', '''')))';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_feedback_status_idx ON prospect_records ((COALESCE(record->''lead''->''feedback''->>''status'', ''pending'')))';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_tender_type_idx ON prospect_records ((COALESCE(record->''lead''->''tender''->>''opportunityType'', '''')))';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_updated_order_idx ON prospect_records ((COALESCE(record->''lead''->>''updatedAt'', record->''lead''->>''createdAt'', '''')) DESC)';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_rank_updated_order_idx ON prospect_records ((CASE WHEN COALESCE(record->''lead''->>''rank'', '''') ~ ''^[0-9]+$'' THEN (record->''lead''->>''rank'')::int ELSE 999999 END), (COALESCE(record->''lead''->>''updatedAt'', record->''lead''->>''createdAt'', '''')) DESC)';
      EXECUTE 'CREATE INDEX IF NOT EXISTS prospect_records_closeability_band_idx ON prospect_records ((COALESCE(record->''latestEvaluation''->''closeability''->>''band'', '''')))';
    END
    $$
  `;
}
