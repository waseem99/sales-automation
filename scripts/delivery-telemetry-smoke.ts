import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const outreachCron = await readFile(new URL('../api/cron/outreach.ts', import.meta.url), 'utf8');
const extractor = await readFile(new URL('../vercel/outreach-telemetry.ts', import.meta.url), 'utf8');
const storage = await readFile(new URL('../packages/neon-state/src/operational-telemetry.ts', import.meta.url), 'utf8');
const deliveryPage = await readFile(new URL('../api/delivery-health.ts', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  crons?: Array<{ path?: string }>;
  rewrites?: Array<{ source?: string; destination?: string }>;
  functions?: Record<string, { maxDuration?: number }>;
};

assert.match(outreachCron, /extractOutreachOperationalTelemetry/);
assert.match(outreachCron, /persistOperationalTelemetryEvents/);
assert.match(outreachCron, /pruneOperationalTelemetry/);
assert.match(outreachCron, /persistTelemetryWithoutBreakingResponse/);
assert.match(outreachCron, /OUTREACH_TELEMETRY_PERSISTENCE_ERROR/);

assert.match(extractor, /eventType:\s*'smtp_delivery'/);
assert.match(extractor, /eventType:\s*'imap_poll'/);
assert.match(extractor, /'bounce'\s*:\s*'reply'|classification === 'bounce_or_delivery_failure'/);
assert.match(extractor, /domainOf\(/);
assert.doesNotMatch(extractor, /details:\s*\{[^}]*replyBody/s);

assert.match(storage, /operational_telemetry_events/);
assert.match(storage, /recipient_domain/);
assert.doesNotMatch(storage, /recipient_email/);
assert.match(storage, /occurrence_count\s*=\s*operational_telemetry_events\.occurrence_count\s*\+\s*1/);
assert.match(storage, /forbiddenDetailKey/);
assert.match(storage, /body\|content\|subject\|recipient\|email\|password\|secret\|token/);
assert.match(storage, /\[redacted-email\]/);

assert.match(deliveryPage, /recipientEmailsStored:\s*false/);
assert.match(deliveryPage, /messageBodiesStored:\s*false/);
assert.match(deliveryPage, /restricted to Admin and Waseem/);
assert.match(deliveryPage, /loadOperationalTelemetryEvents/);

assert.ok(vercelConfig.crons?.some((cron) => cron.path === '/api/cron/outreach'));
assert.ok(vercelConfig.rewrites?.some((rewrite) => rewrite.source === '/delivery-health' && rewrite.destination === '/api/delivery-health'));
assert.equal(vercelConfig.functions?.['api/delivery-health.ts']?.maxDuration, 300);

console.log('Delivery telemetry privacy, persistence and production wiring contract passed');
