import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const outreachCron = await readFile(new URL('../api/cron/outreach.ts', import.meta.url), 'utf8');
const storage = await readFile(new URL('../packages/neon-state/src/operational-telemetry.ts', import.meta.url), 'utf8');
const deliveryPage = await readFile(new URL('../api/delivery-health.ts', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  crons?: Array<{ path?: string }>;
  rewrites?: Array<{ source?: string; destination?: string }>;
  functions?: Record<string, { maxDuration?: number }>;
};

assert.ok(outreachCron.includes('extractOutreachOperationalTelemetry'));
assert.ok(outreachCron.includes('persistOperationalTelemetryEvents'));
assert.ok(outreachCron.includes('pruneOperationalTelemetry'));
assert.ok(outreachCron.includes('persistTelemetryWithoutBreakingResponse'));

assert.ok(storage.includes('operational_telemetry_events'));
assert.ok(storage.includes('recipient_domain'));
assert.ok(storage.includes('occurrence_count = operational_telemetry_events.occurrence_count + 1'));
assert.ok(storage.includes('forbiddenDetailKey'));
assert.ok(storage.includes('[redacted-email]'));

assert.ok(deliveryPage.includes('recipientEmailsStored: false'));
assert.ok(deliveryPage.includes('messageBodiesStored: false'));
assert.ok(deliveryPage.includes('restricted to Admin and Waseem'));
assert.ok(deliveryPage.includes('loadOperationalTelemetryEvents'));

assert.ok(vercelConfig.crons?.some((cron) => cron.path === '/api/cron/outreach'));
assert.ok(vercelConfig.rewrites?.some((rewrite) => rewrite.source === '/delivery-health' && rewrite.destination === '/api/delivery-health'));
assert.equal(vercelConfig.functions?.['api/delivery-health.ts']?.maxDuration, 300);

console.log('Delivery telemetry persistence, privacy and production routing contract passed');
