import type { OperationalTelemetryEventInput } from '@sales-automation/neon-state/operational-telemetry';
import type { StoredLeadRecord } from '@sales-automation/storage';

const prefixes = {
  sent: 'outreach::sent::',
  inbound: 'outreach::inbound::',
  suppression: 'outreach::suppressed::',
  sendFailed: 'outreach::send_failed::',
  alert: 'outreach::alert::',
} as const;

export interface OutreachCycleReportLike {
  startedAt: string;
  completedAt: string;
  liveSendingAllowed: boolean;
  dryRun: boolean;
  configuredMailboxCount: number;
  activeSenderCount: number;
  repliesChecked: number;
  repliesMatched: number;
  repliesProcessed: number;
  bouncesOrSuppressions: number;
  alertsSent: number;
  planned: number;
  sent: number;
  failed: number;
  skippedByDailyLimit: number;
  errors: string[];
  sentLeadIds: string[];
}

export function extractOutreachOperationalTelemetry(
  records: StoredLeadRecord[],
  report: OutreachCycleReportLike,
): OperationalTelemetryEventInput[] {
  const events: OperationalTelemetryEventInput[] = [];
  const startedAt = validIso(report.startedAt) ?? new Date().toISOString();
  const completedAt = validIso(report.completedAt) ?? startedAt;
  const rangeStart = Date.parse(startedAt) - 5 * 60_000;
  const rangeEnd = Date.parse(completedAt) + 5 * 60_000;

  events.push({
    eventType: 'outreach_cycle',
    status: report.failed > 0 || report.errors.length > 0 ? 'warning' : 'success',
    provider: 'outreach',
    worker: 'hourly-outreach-cron',
    occurredAt: completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    details: {
      liveSendingAllowed: report.liveSendingAllowed,
      dryRun: report.dryRun,
      configuredMailboxCount: report.configuredMailboxCount,
      activeSenderCount: report.activeSenderCount,
      planned: report.planned,
      sent: report.sent,
      failed: report.failed,
      skippedByDailyLimit: report.skippedByDailyLimit,
    },
  });

  events.push({
    eventType: 'imap_poll',
    status: report.errors.some((error) => /^IMAP\b/i.test(error)) ? 'warning' : 'success',
    provider: 'imap',
    worker: 'hourly-outreach-cron',
    occurredAt: completedAt,
    details: {
      configuredMailboxCount: report.configuredMailboxCount,
      checked: report.repliesChecked,
      matched: report.repliesMatched,
      processed: report.repliesProcessed,
    },
  });

  for (const record of records) {
    for (const note of record.notes) {
      const event = eventFromNote(record.lead.id, note, rangeStart, rangeEnd);
      if (event) events.push(event);
    }
  }

  for (const error of report.errors) {
    if (/^IMAP\b/i.test(error)) {
      events.push({
        eventType: 'imap_failure', status: 'failure', provider: 'imap', worker: 'hourly-outreach-cron',
        mailbox: internalMailboxFromText(error), occurredAt: completedAt,
        details: { errorSummary: safeErrorSummary(error) },
      });
    } else if (/^SMTP\b/i.test(error)) {
      const deferred = isTemporaryDeliveryFailure(error);
      events.push({
        eventType: deferred ? 'smtp_deferral' : 'smtp_failure',
        status: deferred ? 'warning' : 'failure',
        provider: 'smtp',
        worker: 'hourly-outreach-cron',
        mailbox: internalMailboxFromText(error),
        recipientDomain: externalDomainFromText(error),
        occurredAt: completedAt,
        details: { errorSummary: safeErrorSummary(error) },
      });
    }
  }

  if (report.bouncesOrSuppressions > 0 && !events.some((event) => event.eventType === 'bounce' || event.eventType === 'suppression')) {
    events.push({
      eventType: 'suppression', status: 'warning', provider: 'imap', worker: 'hourly-outreach-cron',
      occurredAt: completedAt, details: { aggregateCount: report.bouncesOrSuppressions },
    });
  }
  return deduplicateEvents(events);
}

function eventFromNote(leadId: string, note: string, rangeStart: number, rangeEnd: number): OperationalTelemetryEventInput | undefined {
  if (note.startsWith(prefixes.sent)) {
    const data = decodeBase64Note(note.slice(prefixes.sent.length));
    const occurredAt = isoField(data, 'sentAt');
    if (!withinRange(occurredAt, rangeStart, rangeEnd)) return undefined;
    return {
      eventType: 'smtp_delivery', status: 'success', provider: 'smtp', worker: 'hourly-outreach-cron',
      mailbox: stringField(data, 'sender'), leadId, recipientDomain: domainOf(stringField(data, 'recipient')),
      occurredAt, details: { sequence: numberField(data, 'sequence') ?? 0 },
    };
  }
  if (note.startsWith(prefixes.sendFailed)) {
    const data = decodeBase64Note(note.slice(prefixes.sendFailed.length));
    const occurredAt = isoField(data, 'failedAt');
    if (!withinRange(occurredAt, rangeStart, rangeEnd)) return undefined;
    const error = stringField(data, 'error') ?? 'SMTP delivery failed';
    const deferred = isTemporaryDeliveryFailure(error);
    return {
      eventType: deferred ? 'smtp_deferral' : 'smtp_failure',
      status: deferred ? 'warning' : 'failure', provider: 'smtp', worker: 'hourly-outreach-cron',
      mailbox: stringField(data, 'sender'), leadId, recipientDomain: domainOf(stringField(data, 'recipient')),
      occurredAt, details: { sequence: numberField(data, 'sequence') ?? 0, errorSummary: safeErrorSummary(error) },
    };
  }
  if (note.startsWith(prefixes.inbound)) {
    const data = decodeBase64Note(note.slice(prefixes.inbound.length));
    const occurredAt = isoField(data, 'receivedAt');
    if (!withinRange(occurredAt, rangeStart, rangeEnd)) return undefined;
    const classification = stringField(data, 'classification') ?? 'unknown';
    return {
      eventType: classification === 'bounce_or_delivery_failure' ? 'bounce' : 'reply',
      status: classification === 'bounce_or_delivery_failure' ? 'warning' : 'success',
      provider: 'imap', worker: 'hourly-outreach-cron', mailbox: stringField(data, 'mailboxEmail'),
      leadId, recipientDomain: domainOf(stringField(data, 'from')), occurredAt,
      details: { classification },
    };
  }
  if (note.startsWith(prefixes.suppression)) {
    const data = decodeBase64Note(note.slice(prefixes.suppression.length));
    const occurredAt = isoField(data, 'recordedAt');
    if (!withinRange(occurredAt, rangeStart, rangeEnd)) return undefined;
    return {
      eventType: stringField(data, 'reason') === 'bounce_or_delivery_failure' ? 'bounce' : 'suppression',
      status: 'warning', provider: 'imap', worker: 'hourly-outreach-cron', leadId,
      recipientDomain: domainOf(stringField(data, 'email')), occurredAt,
      details: { reason: stringField(data, 'reason') ?? 'suppressed' },
    };
  }
  if (note.startsWith(prefixes.alert)) {
    const occurredAt = validIso(note.split('::').at(-1));
    if (!withinRange(occurredAt, rangeStart, rangeEnd)) return undefined;
    return { eventType: 'alert', status: 'success', provider: 'smtp', worker: 'hourly-outreach-cron', leadId, occurredAt };
  }
  return undefined;
}

export function isTemporaryDeliveryFailure(value: string): boolean {
  return /\b4\d\d\b|temporar|defer|greylist|rate.?limit|try again|timeout|timed out|connection reset|too many/i.test(value);
}

export function safeErrorSummary(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/(?:password|secret|token|authorization|cookie)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 400);
}

function decodeBase64Note(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
function stringField(value: Record<string, unknown>, key: string): string | undefined { const item = value[key]; return typeof item === 'string' && item.trim() ? item.trim() : undefined; }
function numberField(value: Record<string, unknown>, key: string): number | undefined { const item = value[key]; return typeof item === 'number' && Number.isFinite(item) ? item : undefined; }
function isoField(value: Record<string, unknown>, key: string): string | undefined { return validIso(stringField(value, key)); }
function validIso(value: string | undefined): string | undefined { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }
function withinRange(value: string | undefined, start: number, end: number): value is string { if (!value) return false; const time = Date.parse(value); return time >= start && time <= end; }
function domainOf(value: string | undefined): string | undefined { const match = value?.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/); return match?.[1]; }
function internalMailboxFromText(value: string): string | undefined { return value.toLowerCase().match(/[a-z0-9._%+-]+@codistan\.org/)?.[0]; }
function externalDomainFromText(value: string): string | undefined { const emails = [...value.toLowerCase().matchAll(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/g)]; return emails.map((match) => match[1]).find((domain) => domain !== 'codistan.org'); }
function deduplicateEvents(events: OperationalTelemetryEventInput[]): OperationalTelemetryEventInput[] { const seen = new Set<string>(); return events.filter((event) => { const key = JSON.stringify([event.eventType,event.status,event.provider,event.worker,event.mailbox,event.leadId,event.recipientDomain,event.occurredAt,event.details]); if (seen.has(key)) return false; seen.add(key); return true; }); }
