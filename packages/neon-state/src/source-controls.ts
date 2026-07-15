import { neon } from '@neondatabase/serverless';

export type DiscoverySourceKey =
  | 'bing_rss'
  | 'remoteok'
  | 'greenhouse'
  | 'lever'
  | 'generic_rss'
  | 'upwork_saved_search_inbox'
  | 'linkedin_signal_inbox'
  | 'linkedin_public_index'
  | 'ppra'
  | 'canadabuys'
  | 'ungm'
  | 'private_nonprofit_tenders'
  | 'expanded_public_tenders';

export interface DiscoverySourceControl {
  sourceKey: DiscoverySourceKey;
  enabled: boolean;
  reason?: string;
  updatedBy: string;
  updatedAt: string;
}

const sourceKeys: DiscoverySourceKey[] = [
  'bing_rss',
  'remoteok',
  'greenhouse',
  'lever',
  'generic_rss',
  'upwork_saved_search_inbox',
  'linkedin_signal_inbox',
  'linkedin_public_index',
  'ppra',
  'canadabuys',
  'ungm',
  'private_nonprofit_tenders',
  'expanded_public_tenders',
];

const safeDefaults: Record<DiscoverySourceKey, boolean> = {
  bing_rss: true,
  remoteok: false,
  greenhouse: false,
  lever: false,
  generic_rss: false,
  upwork_saved_search_inbox: true,
  linkedin_signal_inbox: true,
  linkedin_public_index: true,
  ppra: true,
  canadabuys: true,
  ungm: true,
  private_nonprofit_tenders: true,
  expanded_public_tenders: true,
};

interface SourceControlRow {
  source_key: string;
  enabled: boolean;
  reason: string | null;
  updated_by: string;
  updated_at: string | Date;
}

export async function ensureDiscoverySourceControlSchema(databaseUrl: string): Promise<void> {
  const sql = neon(requireDatabaseUrl(databaseUrl));
  await sql`
    CREATE TABLE IF NOT EXISTS discovery_source_controls (
      source_key TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL,
      reason TEXT,
      updated_by TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function ensureDiscoverySourceControlsSeeded(databaseUrl: string): Promise<void> {
  await ensureDiscoverySourceControlSchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  for (const sourceKey of sourceKeys) {
    await sql`
      INSERT INTO discovery_source_controls (source_key, enabled, reason, updated_by)
      VALUES (${sourceKey}, ${safeDefaults[sourceKey]}, ${defaultReason(sourceKey)}, 'system-default')
      ON CONFLICT (source_key) DO NOTHING
    `;
  }
}

export async function loadDiscoverySourceControls(databaseUrl: string): Promise<DiscoverySourceControl[]> {
  await ensureDiscoverySourceControlsSeeded(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const rows = await sql`
    SELECT source_key, enabled, reason, updated_by, updated_at
    FROM discovery_source_controls
    ORDER BY source_key
  ` as SourceControlRow[];
  return rows.flatMap((row) => {
    if (!isSourceKey(row.source_key)) return [];
    return [{
      sourceKey: row.source_key,
      enabled: row.enabled,
      reason: row.reason ?? undefined,
      updatedBy: row.updated_by,
      updatedAt: new Date(row.updated_at).toISOString(),
    }];
  });
}

export async function updateDiscoverySourceControl(
  databaseUrl: string,
  input: {
    sourceKey: DiscoverySourceKey;
    enabled: boolean;
    reason: string;
    actor: string;
    updatedAt?: string;
  },
): Promise<DiscoverySourceControl> {
  if (!isSourceKey(input.sourceKey)) throw new Error('Source key is invalid.');
  if (input.reason.trim().length < 8) throw new Error('A source-control reason of at least 8 characters is required.');
  await ensureDiscoverySourceControlsSeeded(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  await sql`
    INSERT INTO discovery_source_controls (source_key, enabled, reason, updated_by, updated_at)
    VALUES (${input.sourceKey}, ${input.enabled}, ${input.reason.trim()}, ${input.actor}, ${updatedAt})
    ON CONFLICT (source_key) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      reason = EXCLUDED.reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at
  `;
  return {
    sourceKey: input.sourceKey,
    enabled: input.enabled,
    reason: input.reason.trim(),
    updatedBy: input.actor,
    updatedAt,
  };
}

export function sourceControlMap(controls: DiscoverySourceControl[]): Partial<Record<DiscoverySourceKey, boolean>> {
  return Object.fromEntries(controls.map((control) => [control.sourceKey, control.enabled])) as Partial<Record<DiscoverySourceKey, boolean>>;
}

export function isDiscoverySourceKey(value: string): value is DiscoverySourceKey {
  return isSourceKey(value);
}

function isSourceKey(value: string): value is DiscoverySourceKey {
  return sourceKeys.includes(value as DiscoverySourceKey);
}

function defaultReason(sourceKey: DiscoverySourceKey): string {
  if (sourceKey === 'remoteok') return 'Disabled because employee vacancies are not direct sales opportunities.';
  if (['greenhouse', 'lever'].includes(sourceKey)) return 'Disabled by default; job feeds are research signals only when explicitly required.';
  if (sourceKey === 'generic_rss') return 'Disabled until each feed is approved with valid and invalid regression examples.';
  if (sourceKey === 'upwork_saved_search_inbox') return 'Enabled for approved Upwork saved-search alert emails only; proposals and applications remain human-controlled.';
  if (sourceKey === 'linkedin_signal_inbox') return 'Enabled for LinkedIn and Sales Navigator alert emails in the controlled lead-signal mailbox; no outreach reply mailbox fallback.';
  if (sourceKey === 'linkedin_public_index') return 'Enabled for public search snippets pointing to LinkedIn posts; every result remains research-only until human verification.';
  return 'Enabled as an approved production discovery source.';
}

function requireDatabaseUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error('DATABASE_URL is required.');
  return value.trim();
}
