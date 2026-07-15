import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

export type OperationalEventType =
  | 'outreach_cycle'
  | 'smtp_delivery'
  | 'smtp_failure'
  | 'smtp_deferral'
  | 'imap_poll'
  | 'imap_failure'
  | 'reply'
  | 'bounce'
  | 'suppression'
  | 'alert'
  | 'lock_skipped'
  | 'worker_failure';

export type OperationalEventStatus = 'success' | 'warning' | 'failure' | 'skipped' | 'info';

export interface OperationalTelemetryEventInput {
  eventType: OperationalEventType;
  status: OperationalEventStatus;
  provider: 'smtp' | 'imap' | 'outreach' | 'runtime';
  worker: string;
  mailbox?: string;
  leadId?: string;
  recipientDomain?: string;
  occurredAt?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
  dedupeKey?: string;
}

export interface OperationalTelemetryEvent extends OperationalTelemetryEventInput {
  eventId: string;
  bucketKey: string;
  occurredAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  details: Record<string, string | number | boolean | null>;
}

export interface OperationalTelemetrySummary {
  totalOccurrences: number;
  smtpDeliveries: number;
  smtpFailures: number;
  smtpDeferrals: number;
  imapPolls: number;
  imapFailures: number;
  replies: number;
  bounces: number;
  suppressions: number;
  alerts: number;
  lockSkips: number;
  workerFailures: number;
  latestSuccessAt?: string;
  latestFailureAt?: string;
  latestEventAt?: string;
  health: 'healthy' | 'warning' | 'failure' | 'no_data';
}

interface TelemetryRow {
  event_id: string;
  bucket_key: string;
  event_type: string;
  status: string;
  provider: string;
  worker: string;
  mailbox: string | null;
  lead_id: string | null;
  recipient_domain: string | null;
  occurred_at: string | Date;
  first_seen_at: string | Date;
  last_seen_at: string | Date;
  occurrence_count: number;
  duration_ms: number | null;
  details_json: unknown;
}

const forbiddenDetailKey = /(?:body|content|subject|recipient|email|password|secret|token|credential|authorization|cookie|raw|message)/i;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export async function ensureOperationalTelemetrySchema(databaseUrl: string): Promise<void> {
  const sql = neon(requireDatabaseUrl(databaseUrl));
  await sql`
    CREATE TABLE IF NOT EXISTS operational_telemetry_events (
      event_id TEXT PRIMARY KEY,
      bucket_key TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      worker TEXT NOT NULL,
      mailbox TEXT,
      lead_id TEXT,
      recipient_domain TEXT,
      occurred_at TIMESTAMPTZ NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER,
      details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS operational_telemetry_last_seen_idx ON operational_telemetry_events (last_seen_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS operational_telemetry_type_idx ON operational_telemetry_events (event_type, last_seen_at DESC)`;
}

export async function persistOperationalTelemetryEvents(
  databaseUrl: string,
  events: OperationalTelemetryEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;
  await ensureOperationalTelemetrySchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const normalized = events.map(normalizeOperationalTelemetryEvent);
  for (const event of normalized) {
    await sql`
      INSERT INTO operational_telemetry_events (
        event_id, bucket_key, event_type, status, provider, worker, mailbox, lead_id,
        recipient_domain, occurred_at, first_seen_at, last_seen_at, occurrence_count,
        duration_ms, details_json
      ) VALUES (
        ${event.eventId}, ${event.bucketKey}, ${event.eventType}, ${event.status}, ${event.provider},
        ${event.worker}, ${event.mailbox ?? null}, ${event.leadId ?? null}, ${event.recipientDomain ?? null},
        ${event.occurredAt}::timestamptz, ${event.firstSeenAt}::timestamptz,
        ${event.lastSeenAt}::timestamptz, ${event.occurrenceCount}, ${event.durationMs ?? null},
        ${JSON.stringify(event.details)}::jsonb
      )
      ON CONFLICT (bucket_key) DO UPDATE SET
        status = EXCLUDED.status,
        last_seen_at = GREATEST(operational_telemetry_events.last_seen_at, EXCLUDED.last_seen_at),
        occurrence_count = operational_telemetry_events.occurrence_count + 1,
        duration_ms = COALESCE(EXCLUDED.duration_ms, operational_telemetry_events.duration_ms),
        details_json = EXCLUDED.details_json
    `;
  }
  return normalized.length;
}

export async function loadOperationalTelemetryEvents(
  databaseUrl: string,
  input: { limit?: number; lookbackHours?: number } = {},
): Promise<OperationalTelemetryEvent[]> {
  await ensureOperationalTelemetrySchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const limit = boundedInteger(input.limit, 200, 1, 1000);
  const lookbackHours = boundedInteger(input.lookbackHours, 168, 1, 24 * 365);
  const rows = await sql`
    SELECT event_id, bucket_key, event_type, status, provider, worker, mailbox, lead_id,
      recipient_domain, occurred_at, first_seen_at, last_seen_at, occurrence_count,
      duration_ms, details_json
    FROM operational_telemetry_events
    WHERE last_seen_at >= NOW() - make_interval(hours => ${lookbackHours})
    ORDER BY last_seen_at DESC
    LIMIT ${limit}
  ` as TelemetryRow[];
  return rows.flatMap(rowToEvent);
}

export async function pruneOperationalTelemetry(databaseUrl: string, retentionDays = 90): Promise<void> {
  await ensureOperationalTelemetrySchema(databaseUrl);
  const sql = neon(requireDatabaseUrl(databaseUrl));
  const days = boundedInteger(retentionDays, 90, 7, 365);
  await sql`DELETE FROM operational_telemetry_events WHERE last_seen_at < NOW() - make_interval(days => ${days})`;
}

export function normalizeOperationalTelemetryEvent(input: OperationalTelemetryEventInput): OperationalTelemetryEvent {
  const occurredAt = validIso(input.occurredAt) ?? new Date().toISOString();
  const mailbox = normalizeMailbox(input.mailbox);
  const recipientDomain = normalizeDomain(input.recipientDomain);
  const worker = cleanIdentifier(input.worker, 'unknown-worker');
  const provider = input.provider;
  const bucketKey = input.dedupeKey?.trim() || buildOperationalBucketKey({
    ...input,
    occurredAt,
    mailbox,
    recipientDomain,
    worker,
  });
  return {
    eventId: randomUUID(),
    bucketKey: bucketKey.slice(0, 500),
    eventType: input.eventType,
    status: input.status,
    provider,
    worker,
    mailbox,
    leadId: cleanOptional(input.leadId, 160),
    recipientDomain,
    occurredAt,
    firstSeenAt: occurredAt,
    lastSeenAt: occurredAt,
    occurrenceCount: 1,
    durationMs: finiteInteger(input.durationMs),
    details: sanitizeOperationalDetails(input.details),
  };
}

export function buildOperationalBucketKey(input: OperationalTelemetryEventInput): string {
  const occurredAt = validIso(input.occurredAt) ?? new Date().toISOString();
  const hourBucket = occurredAt.slice(0, 13);
  return [
    input.eventType,
    input.status,
    input.provider,
    cleanIdentifier(input.worker, 'unknown-worker'),
    normalizeMailbox(input.mailbox) ?? '-',
    cleanOptional(input.leadId, 160) ?? '-',
    normalizeDomain(input.recipientDomain) ?? '-',
    hourBucket,
  ].join(':');
}

export function sanitizeOperationalDetails(value: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  if (!value) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (forbiddenDetailKey.test(key)) continue;
    if (raw === null || typeof raw === 'boolean') result[key] = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = raw;
    else if (typeof raw === 'string') result[key] = raw.replace(emailPattern, '[redacted-email]').slice(0, 500);
  }
  return result;
}

export function summarizeOperationalTelemetry(events: OperationalTelemetryEvent[]): OperationalTelemetrySummary {
  const count = (type: OperationalEventType) => events
    .filter((event) => event.eventType === type)
    .reduce((sum, event) => sum + event.occurrenceCount, 0);
  const successTimes = events.filter((event) => event.status === 'success').map((event) => event.lastSeenAt).sort().reverse();
  const failureTimes = events.filter((event) => event.status === 'failure').map((event) => event.lastSeenAt).sort().reverse();
  const latestEventAt = events.map((event) => event.lastSeenAt).sort().reverse()[0];
  const summary: OperationalTelemetrySummary = {
    totalOccurrences: events.reduce((sum, event) => sum + event.occurrenceCount, 0),
    smtpDeliveries: count('smtp_delivery'),
    smtpFailures: count('smtp_failure'),
    smtpDeferrals: count('smtp_deferral'),
    imapPolls: count('imap_poll'),
    imapFailures: count('imap_failure'),
    replies: count('reply'),
    bounces: count('bounce'),
    suppressions: count('suppression'),
    alerts: count('alert'),
    lockSkips: count('lock_skipped'),
    workerFailures: count('worker_failure'),
    latestSuccessAt: successTimes[0],
    latestFailureAt: failureTimes[0],
    latestEventAt,
    health: 'no_data',
  };
  if (!latestEventAt) summary.health = 'no_data';
  else if (summary.workerFailures > 0 || summary.imapFailures > 0 || summary.smtpFailures > 0) summary.health = 'failure';
  else if (summary.smtpDeferrals > 0 || summary.bounces > 0 || summary.suppressions > 0 || summary.lockSkips > 2) summary.health = 'warning';
  else summary.health = 'healthy';
  return summary;
}

function rowToEvent(row: TelemetryRow): OperationalTelemetryEvent[] {
  if (!isEventType(row.event_type) || !isEventStatus(row.status) || !isProvider(row.provider)) return [];
  return [{
    eventId: row.event_id,
    bucketKey: row.bucket_key,
    eventType: row.event_type,
    status: row.status,
    provider: row.provider,
    worker: row.worker,
    mailbox: row.mailbox ?? undefined,
    leadId: row.lead_id ?? undefined,
    recipientDomain: row.recipient_domain ?? undefined,
    occurredAt: new Date(row.occurred_at).toISOString(),
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    occurrenceCount: row.occurrence_count,
    durationMs: row.duration_ms ?? undefined,
    details: asPrimitiveRecord(row.details_json),
  }];
}

function asPrimitiveRecord(value: unknown): Record<string, string | number | boolean | null> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? sanitizeOperationalDetails(value as Record<string, unknown>)
    : {};
}

function isEventType(value: string): value is OperationalEventType {
  return ['outreach_cycle','smtp_delivery','smtp_failure','smtp_deferral','imap_poll','imap_failure','reply','bounce','suppression','alert','lock_skipped','worker_failure'].includes(value);
}
function isEventStatus(value: string): value is OperationalEventStatus { return ['success','warning','failure','skipped','info'].includes(value); }
function isProvider(value: string): value is OperationalTelemetryEventInput['provider'] { return ['smtp','imap','outreach','runtime'].includes(value); }
function normalizeMailbox(value: string | undefined): string | undefined { const normalized = value?.trim().toLowerCase(); return normalized && /^[^\s@]+@codistan\.org$/.test(normalized) ? normalized : undefined; }
function normalizeDomain(value: string | undefined): string | undefined { const normalized = value?.trim().toLowerCase().replace(/^@/, ''); return normalized && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized) ? normalized.slice(0, 255) : undefined; }
function cleanIdentifier(value: string | undefined, fallback: string): string { return (value?.trim() || fallback).replace(/[^a-zA-Z0-9._:-]+/g, '-').slice(0, 160); }
function cleanOptional(value: string | undefined, maximum: number): string | undefined { const cleaned = value?.trim(); return cleaned ? cleaned.slice(0, maximum) : undefined; }
function validIso(value: string | undefined): string | undefined { if (!value || !Number.isFinite(Date.parse(value))) return undefined; return new Date(value).toISOString(); }
function finiteInteger(value: number | undefined): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined; }
function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number { return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value!)) : fallback; }
function requireDatabaseUrl(value: string | undefined): string { if (!value?.trim()) throw new Error('DATABASE_URL is required.'); return value.trim(); }
