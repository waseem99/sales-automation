import assert from 'node:assert/strict';
import {
  buildOperationalBucketKey,
  normalizeOperationalTelemetryEvent,
  sanitizeOperationalDetails,
  summarizeOperationalTelemetry,
} from './operational-telemetry.js';

const event = normalizeOperationalTelemetryEvent({
  eventType: 'smtp_deferral',
  status: 'warning',
  provider: 'smtp',
  worker: 'outreach-cron',
  mailbox: 'sales@codistan.org',
  leadId: 'lead-123',
  recipientDomain: 'example.com',
  occurredAt: '2026-07-15T04:15:00.000Z',
  details: {
    responseCode: 451,
    phase: 'send',
    errorSummary: 'Temporary failure for buyer@example.com',
    recipientEmail: 'buyer@example.com',
    messageBody: 'private message',
    password: 'secret',
  },
});
assert.equal(event.mailbox, 'sales@codistan.org');
assert.equal(event.recipientDomain, 'example.com');
assert.equal(event.details.responseCode, 451);
assert.equal(event.details.errorSummary, 'Temporary failure for [redacted-email]');
assert.equal('recipientEmail' in event.details, false);
assert.equal('messageBody' in event.details, false);
assert.equal('password' in event.details, false);

const sameBucket = buildOperationalBucketKey({
  eventType: 'smtp_deferral', status: 'warning', provider: 'smtp', worker: 'outreach-cron',
  mailbox: 'sales@codistan.org', leadId: 'lead-123', recipientDomain: 'example.com',
  occurredAt: '2026-07-15T04:59:59.000Z',
});
assert.equal(event.bucketKey, sameBucket, 'Repeated events in the same hour must deduplicate into one bucket.');

const clean = sanitizeOperationalDetails({ replyBody: 'private', classification: 'positive_reply', count: 2 });
assert.deepEqual(clean, { classification: 'positive_reply', count: 2 });

const summary = summarizeOperationalTelemetry([
  event,
  { ...event, eventId: '2', bucketKey: 'reply', eventType: 'reply', status: 'success', occurrenceCount: 2, lastSeenAt: '2026-07-15T05:00:00.000Z' },
]);
assert.equal(summary.smtpDeferrals, 1);
assert.equal(summary.replies, 2);
assert.equal(summary.health, 'warning');

console.log('Operational telemetry privacy, hourly dedupe and health summary tests passed');
