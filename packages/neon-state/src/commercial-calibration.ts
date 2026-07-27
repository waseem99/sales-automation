import { neon } from '@neondatabase/serverless';
import type { CalibrationDecision, CommercialDimension } from '@sales-automation/commercial-analytics';

interface CalibrationRow {
  dimension: string;
  lane_key: string;
  decision: unknown;
  updated_at: string | Date;
}

const readiness = new Map<string, Promise<void>>();

export async function ensureCommercialCalibrationSchema(databaseUrl: string): Promise<void> {
  const normalized = requireDatabaseUrl(databaseUrl);
  const existing = readiness.get(normalized);
  if (existing) return existing;
  const initialization = initialize(normalized);
  readiness.set(normalized, initialization);
  try {
    await initialization;
  } catch (error) {
    if (readiness.get(normalized) === initialization) readiness.delete(normalized);
    throw error;
  }
}

export async function upsertCommercialCalibrationDecision(databaseUrl: string, decision: CalibrationDecision): Promise<void> {
  await ensureCommercialCalibrationSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  await sql`
    INSERT INTO commercial_calibration_decisions (
      dimension, lane_key, decision_json, reviewed_at, reviewed_by, updated_at
    ) VALUES (
      ${decision.dimension}, ${decision.laneKey}, ${JSON.stringify(decision)}::jsonb,
      ${decision.reviewedAt}::timestamptz, ${decision.reviewedBy}, NOW()
    )
    ON CONFLICT (dimension, lane_key) DO UPDATE SET
      decision_json = EXCLUDED.decision_json,
      reviewed_at = EXCLUDED.reviewed_at,
      reviewed_by = EXCLUDED.reviewed_by,
      updated_at = NOW()
  `;
}

export async function loadCommercialCalibrationDecisions(
  databaseUrl: string,
  dimension?: CommercialDimension,
): Promise<CalibrationDecision[]> {
  await ensureCommercialCalibrationSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const rows = dimension
    ? await sql`
      SELECT dimension, lane_key, decision_json AS decision, updated_at
      FROM commercial_calibration_decisions
      WHERE dimension = ${dimension}
      ORDER BY reviewed_at DESC, lane_key ASC
    ` as CalibrationRow[]
    : await sql`
      SELECT dimension, lane_key, decision_json AS decision, updated_at
      FROM commercial_calibration_decisions
      ORDER BY reviewed_at DESC, dimension ASC, lane_key ASC
    ` as CalibrationRow[];
  return rows.flatMap((row) => isCalibrationDecision(row.decision) ? [row.decision] : []);
}

export async function deleteCommercialCalibrationDecision(
  databaseUrl: string,
  dimension: CommercialDimension,
  laneKey: string,
): Promise<boolean> {
  await ensureCommercialCalibrationSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const rows = await sql`
    DELETE FROM commercial_calibration_decisions
    WHERE dimension = ${dimension} AND lane_key = ${laneKey}
    RETURNING lane_key
  ` as Array<{lane_key: string}>;
  return rows.length > 0;
}

async function initialize(databaseUrl: string): Promise<void> {
  const sql = neon(databaseUrl);
  await sql`
    CREATE TABLE IF NOT EXISTS commercial_calibration_decisions (
      dimension TEXT NOT NULL,
      lane_key TEXT NOT NULL,
      decision_json JSONB NOT NULL,
      reviewed_at TIMESTAMPTZ NOT NULL,
      reviewed_by TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (dimension, lane_key)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS commercial_calibration_reviewed_idx ON commercial_calibration_decisions (reviewed_at DESC)`;
}

function isCalibrationDecision(value: unknown): value is CalibrationDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CalibrationDecision>;
  return typeof item.id === 'string'
    && ['source','campaign','channel','service','owner'].includes(String(item.dimension))
    && typeof item.laneKey === 'string'
    && ['keep','change','stop'].includes(String(item.decision))
    && Array.isArray(item.evidence)
    && item.status === 'active';
}

function requireDatabaseUrl(value: string): string {
  if (!value?.trim()) throw new Error('DATABASE_URL is required.');
  return value.trim();
}
