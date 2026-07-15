import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { extractOutreachOperationalTelemetry } from '../vercel/outreach-telemetry.js';

const startedAt = '2026-07-15T04:00:00.000Z';
const completedAt = '2026-07-15T04:01:00.000Z';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const record = {
  lead: { id: 'lead-1' },
  notes: [
    `outreach::sent::${encode({ leadId: 'lead-1', sequence: 0, sender: 'sales@codistan.org', recipient: 'buyer@example.com', sentAt: completedAt })}`,
    `outreach::inbound::${encode({ messageId: 'm1', from: 'buyer@example.com', mailboxEmail: 'sales@codistan.org', receivedAt: completedAt, classification: 'positive_reply', replyBody: 'private reply content' })}`,
    `outreach::suppressed::${encode({ email: 'buyer@example.com', reason: 'unsubscribe_or_stop', recordedAt: completedAt })}`,
  ],
} as unknown as StoredLeadRecord;
const events = extractOutreachOperationalTelemetry([record], {
  startedAt, completedAt, liveSendingAllowed: true, dryRun: false,
  configuredMailboxCount: 1, activeSenderCount: 1, repliesChecked: 1, repliesMatched: 1,
  repliesProcessed: 1, bouncesOrSuppressions: 1, alertsSent: 0, planned: 1, sent: 1,
  failed: 0, skippedByDailyLimit: 0, errors: [], sentLeadIds: ['lead-1'],
});
assert.ok(events.some((event) => event.eventType === 'smtp_delivery'));
assert.ok(events.some((event) => event.eventType === 'reply'));
assert.ok(events.some((event) => event.eventType === 'suppression'));
assert.equal(JSON.stringify(events).includes('private reply content'), false, 'Message bodies must never enter telemetry.');
assert.equal(events.find((event) => event.eventType === 'smtp_delivery')?.recipientDomain, 'example.com');

const wrapper = await readFile(new URL('../api/cron/outreach-observed.ts', import.meta.url), 'utf8');
assert.match(wrapper, /persistOperationalTelemetryEvents/);
assert.match(wrapper, /pruneOperationalTelemetry/);
const deliveryPage = await readFile(new URL('../api/delivery-health.ts', import.meta.url), 'utf8');
assert.match(deliveryPage, /recipientEmailsStored:\s*false/);
assert.match(deliveryPage, /restricted to Admin and Waseem/);

console.log('Delivery telemetry extraction, privacy and deployment contract passed');
