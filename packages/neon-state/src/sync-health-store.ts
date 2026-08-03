import {neon} from '@neondatabase/serverless';

interface SyncHealthRow {
  snapshot: unknown;
}

interface PersistableSyncHealthSnapshot {
  source: string;
  collectedAt: string;
}

export async function ensureSyncHealthSchema(databaseUrl: string): Promise<void> {
  const sql = neon(requireUrl(databaseUrl));
  await sql`
    CREATE TABLE IF NOT EXISTS sync_health_snapshots (
      source TEXT PRIMARY KEY,
      snapshot JSONB NOT NULL,
      collected_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function persistSyncHealthSnapshot<T extends PersistableSyncHealthSnapshot>(
  databaseUrl: string,
  snapshot: T,
): Promise<void> {
  if (!snapshot.source.trim()) throw new Error('Sync health source is required.');
  if (Number.isNaN(Date.parse(snapshot.collectedAt))) throw new Error('Sync health collectedAt must be a valid date.');
  await ensureSyncHealthSchema(databaseUrl);
  const sql = neon(requireUrl(databaseUrl));
  await sql`
    INSERT INTO sync_health_snapshots (source, snapshot, collected_at, updated_at)
    VALUES (${snapshot.source}, ${JSON.stringify(snapshot)}::jsonb, ${snapshot.collectedAt}::timestamptz, NOW())
    ON CONFLICT (source) DO UPDATE SET
      snapshot = EXCLUDED.snapshot,
      collected_at = EXCLUDED.collected_at,
      updated_at = NOW()
    WHERE sync_health_snapshots.collected_at <= EXCLUDED.collected_at
  `;
}

export async function loadSyncHealthSnapshots<T>(databaseUrl: string): Promise<T[]> {
  await ensureSyncHealthSchema(databaseUrl);
  const sql = neon(requireUrl(databaseUrl));
  const rows = await sql`
    SELECT snapshot
    FROM sync_health_snapshots
    ORDER BY collected_at DESC
  ` as SyncHealthRow[];
  return rows.map((row) => parse<T>(row.snapshot)).filter((item): item is T => item !== undefined);
}

function requireUrl(value: string): string {
  if (!value?.trim()) throw new Error('DATABASE_URL is required.');
  return value.trim();
}

function parse<T>(value: unknown): T | undefined {
  if (value && typeof value === 'object') return value as T;
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
