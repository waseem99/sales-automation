import { neon } from '@neondatabase/serverless';
import {
  InMemoryProspectDiscoveryRunStore,
  type ProspectDiscoveryRun,
} from '@sales-automation/prospect-discovery';
import {
  InMemoryLeadRepository,
  type StoredLeadRecord,
} from '@sales-automation/storage';

export interface NeonAppState {
  repository: InMemoryLeadRepository;
  runStore: InMemoryProspectDiscoveryRunStore;
}

interface LeadRow {
  record: unknown;
}

interface RunRow {
  run: unknown;
}

interface LockRow {
  token: string;
}

export async function ensureNeonSchema(databaseUrl: string): Promise<void> {
  const sql = neon(requireDatabaseUrl(databaseUrl));
  await sql`
    CREATE TABLE IF NOT EXISTS prospect_records (
      lead_id TEXT PRIMARY KEY,
      record JSONB NOT NULL,
      discovered_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS prospect_discovery_runs (
      run_id TEXT PRIMARY KEY,
      run JSONB NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS prospect_run_locks (
      lock_name TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      locked_until TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function loadNeonAppState(databaseUrl: string): Promise<NeonAppState> {
  await ensureNeonSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const [leadRows, runRows] = await sql.transaction([
    sql`SELECT record FROM prospect_records ORDER BY discovered_at DESC NULLS LAST, updated_at DESC`,
    sql`SELECT run FROM prospect_discovery_runs ORDER BY completed_at DESC LIMIT 180`,
  ], { readOnly: true, isolationLevel: 'RepeatableRead' });

  const records = (leadRows as LeadRow[])
    .map((row) => parseJson<StoredLeadRecord>(row.record))
    .filter((record): record is StoredLeadRecord => Boolean(record?.lead?.id));
  const runs = (runRows as RunRow[])
    .map((row) => parseJson<ProspectDiscoveryRun>(row.run))
    .filter((run): run is ProspectDiscoveryRun => Boolean(run?.id));

  return {
    repository: new InMemoryLeadRepository(records),
    runStore: new InMemoryProspectDiscoveryRunStore(runs),
  };
}

export async function persistLeadRecords(
  databaseUrl: string,
  records: StoredLeadRecord[],
): Promise<void> {
  if (records.length === 0) return;
  await ensureNeonSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  for (const batch of chunk(records, 40)) {
    await sql.transaction(batch.map((record) => sql`
      INSERT INTO prospect_records (lead_id, record, discovered_at, updated_at)
      VALUES (
        ${record.lead.id},
        ${JSON.stringify(record)}::jsonb,
        ${record.lead.discoveredAt ?? record.lead.capturedAt ?? record.lead.createdAt}::timestamptz,
        NOW()
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        record = EXCLUDED.record,
        discovered_at = EXCLUDED.discovered_at,
        updated_at = NOW()
    `));
  }
}

export async function persistDiscoveryRuns(
  databaseUrl: string,
  runs: ProspectDiscoveryRun[],
): Promise<void> {
  if (runs.length === 0) return;
  await ensureNeonSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  for (const batch of chunk(runs.slice(0, 180), 40)) {
    await sql.transaction(batch.map((run) => sql`
      INSERT INTO prospect_discovery_runs (run_id, run, completed_at, updated_at)
      VALUES (${run.id}, ${JSON.stringify(run)}::jsonb, ${run.completedAt}::timestamptz, NOW())
      ON CONFLICT (run_id) DO UPDATE SET
        run = EXCLUDED.run,
        completed_at = EXCLUDED.completed_at,
        updated_at = NOW()
    `));
  }
}

export async function persistNeonAppState(databaseUrl: string, state: NeonAppState): Promise<void> {
  await Promise.all([
    persistLeadRecords(databaseUrl, state.repository.listLeads()),
    persistDiscoveryRuns(databaseUrl, state.runStore.listRuns(180)),
  ]);
}

export async function acquireNamedRunLock(
  databaseUrl: string,
  lockName: string,
  token: string,
  durationMinutes = 10,
): Promise<boolean> {
  if (!lockName.trim()) throw new Error('lockName is required.');
  await ensureNeonSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const rows = await sql`
    INSERT INTO prospect_run_locks (lock_name, token, locked_until, updated_at)
    VALUES (${lockName}, ${token}, NOW() + make_interval(mins => ${durationMinutes}), NOW())
    ON CONFLICT (lock_name) DO UPDATE SET
      token = EXCLUDED.token,
      locked_until = EXCLUDED.locked_until,
      updated_at = NOW()
    WHERE prospect_run_locks.locked_until <= NOW()
    RETURNING token
  ` as LockRow[];
  return rows[0]?.token === token;
}

export async function releaseNamedRunLock(
  databaseUrl: string,
  lockName: string,
  token: string,
): Promise<void> {
  const sql = neon(requireDatabaseUrl(databaseUrl));
  await sql`
    UPDATE prospect_run_locks
    SET locked_until = NOW(), updated_at = NOW()
    WHERE lock_name = ${lockName} AND token = ${token}
  `;
}

export async function acquireProspectRunLock(
  databaseUrl: string,
  token: string,
  durationMinutes = 10,
): Promise<boolean> {
  return acquireNamedRunLock(databaseUrl, 'daily-prospect-discovery', token, durationMinutes);
}

export async function releaseProspectRunLock(databaseUrl: string, token: string): Promise<void> {
  return releaseNamedRunLock(databaseUrl, 'daily-prospect-discovery', token);
}

export function requireDatabaseUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error('DATABASE_URL is required. Connect a Neon Postgres database to the Vercel project.');
  return value.trim();
}

function parseJson<T>(value: unknown): T | undefined {
  if (value && typeof value === 'object') return value as T;
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

export * from './prospect-query.js';
