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

const forbiddenDetailKey = /(?:body|content|subject|recipient|email|password|secret|token|credential|authorization|cookie|raw|message)/i;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

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

export function buildOperationalBucketKey(input: OperationalTelemetryEventInput): string {
  const occurredAt = validIso(input.occurredAt) ?? new Date().toISOString();
  return [input.eventType, input.status, input.provider, clean(input.worker), input.mailbox ?? '-', input.leadId ?? '-', input.recipientDomain ?? '-', occurredAt.slice(0, 13)].join(':');
}

export function normalizeOperationalTelemetryEvent(input: OperationalTelemetryEventInput): OperationalTelemetryEvent {
  const occurredAt = validIso(input.occurredAt) ?? new Date().toISOString();
  const bucketKey = input.dedupeKey?.trim() || buildOperationalBucketKey(input);
  return {
    ...input,
    eventId: `${bucketKey}:${occurredAt}`.slice(0, 500),
    bucketKey: bucketKey.slice(0, 500),
    occurredAt,
    firstSeenAt: occurredAt,
    lastSeenAt: occurredAt,
    occurrenceCount: 1,
    details: sanitizeOperationalDetails(input.details),
  };
}

export function summarizeOperationalTelemetry(events: OperationalTelemetryEvent[]): OperationalTelemetrySummary {
  const count = (type: OperationalEventType) => events.filter((event) => event.eventType === type).reduce((sum, event) => sum + event.occurrenceCount, 0);
  const latestEventAt = events.map((event) => event.lastSeenAt).sort().reverse()[0];
  return {
    totalOccurrences: events.reduce((sum, event) => sum + event.occurrenceCount, 0),
    smtpDeliveries: count('smtp_delivery'), smtpFailures: count('smtp_failure'), smtpDeferrals: count('smtp_deferral'),
    imapPolls: count('imap_poll'), imapFailures: count('imap_failure'), replies: count('reply'), bounces: count('bounce'),
    suppressions: count('suppression'), alerts: count('alert'), lockSkips: count('lock_skipped'), workerFailures: count('worker_failure'),
    latestEventAt,
    health: latestEventAt ? 'healthy' : 'no_data',
  };
}

export async function ensureOperationalTelemetrySchema(_databaseUrl: string): Promise<void> {}
export async function persistOperationalTelemetryEvents(_databaseUrl: string, events: OperationalTelemetryEventInput[]): Promise<number> { return events.length; }
export async function loadOperationalTelemetryEvents(_databaseUrl: string): Promise<OperationalTelemetryEvent[]> { return []; }
export async function pruneOperationalTelemetry(_databaseUrl: string): Promise<void> {}

function clean(value: string): string { return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').slice(0, 160); }
function validIso(value: string | undefined): string | undefined { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }
