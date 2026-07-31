import assert from 'node:assert/strict';
import {
  aggregateSyncHealth,
  createSafeReplayPlan,
  createSyncHealthSnapshot,
  EXPECTED_RECONCILIATION_VERSION,
  redactDiagnostic,
  SYNC_HEALTH_VERSION,
  verifySyncHealthSnapshot,
} from './index.js';

const linkedin = createSyncHealthSnapshot({
  source: 'linkedin',
  collectedAt: '2026-07-31T14:00:00.000Z',
  capture: 'healthy',
  localProcessing: 'healthy',
  outbox: 'degraded',
  prospectDeskIngestion: 'healthy',
  endpointHost: 'sales.example.com',
  endpointPath: '/api/acquisition-ingest?token=should-not-survive',
  endpointVersion: EXPECTED_RECONCILIATION_VERSION,
  pending: 1,
  retrying: 1,
  deadLetter: 1,
  conflicted: 1,
  applied: 10,
  duplicates: 2,
  merged: 3,
  failed: 1,
  lastAttemptAt: '2026-07-31T13:59:00.000Z',
  lastSuccessfulSyncAt: '2026-07-31T13:58:00.000Z',
  averageLatencyMs: 1200,
  records: [
    {idempotencyKey: 'sync-linkedin-a', status: 'pending', attempts: 0, nextRetryAt: '2026-07-31T14:01:00.000Z'},
    {idempotencyKey: 'sync-linkedin-b', status: 'dead_letter', attempts: 5, lastError: 'Authorization: Bearer super-secret'},
    {idempotencyKey: 'sync-linkedin-c', status: 'conflicted', attempts: 1, lastError: 'seller field conflict'},
  ],
  diagnostics: [{authorization: 'Bearer abc', cookie: 'sid=private', layout: 'outbox'}, 'https://x.test?a=1&token=secret'],
});
assert.equal(linkedin.version, SYNC_HEALTH_VERSION);
assert.equal(verifySyncHealthSnapshot(linkedin), true);
assert.equal(linkedin.endpointPath, '/api/acquisition-ingest');
assert.equal(JSON.stringify(linkedin).includes('super-secret'), false);
assert.equal(JSON.stringify(linkedin).includes('sid=private'), false);
assert.equal(linkedin.endpointVersionMismatch, false);

const mismatch = createSyncHealthSnapshot({
  source: 'upwork',
  collectedAt: '2026-07-31T14:01:00.000Z',
  endpointVersion: 'legacy-reconciliation.v0',
  deadLetter: 0,
});
assert.equal(mismatch.endpointVersionMismatch, true);

const salesNav = createSyncHealthSnapshot({
  source: 'sales_navigator',
  collectedAt: '2026-07-31T14:02:00.000Z',
  capture: 'healthy',
  localProcessing: 'healthy',
  outbox: 'healthy',
  prospectDeskIngestion: 'healthy',
  endpointVersion: EXPECTED_RECONCILIATION_VERSION,
  applied: 4,
  averageLatencyMs: 800,
});
const aggregate = aggregateSyncHealth([linkedin, mismatch, salesNav], '2026-07-31T14:03:00.000Z');
assert.equal(aggregate.sources.length, 3);
assert.equal(aggregate.totals.deadLetter, 1);
assert.deepEqual(aggregate.endpointVersionMismatches, ['upwork']);
assert.equal(aggregate.averageLatencyMs, 1000);
assert.equal(aggregate.healthy, false);
assert.equal(aggregate.reconciled, true);

assert.throws(() => createSafeReplayPlan({
  snapshot: linkedin,
  idempotencyKeys: ['sync-linkedin-a'],
  actor: 'operator@codistan.org',
  permissionConfirmed: false,
}), /Permission confirmation/);
const replay = createSafeReplayPlan({
  snapshot: linkedin,
  idempotencyKeys: ['sync-linkedin-a', 'sync-linkedin-b', 'sync-linkedin-c', 'missing'],
  actor: 'operator@codistan.org',
  permissionConfirmed: true,
  requestedAt: '2026-07-31T14:04:00.000Z',
});
assert.equal(replay.records.length, 2);
assert.equal(replay.records.every((record) => record.preserveIdempotencyKey), true);
assert.equal(replay.skipped.length, 2);
assert.equal(replay.externalActionAutomated, false);

const redacted = redactDiagnostic({
  token: 'secret',
  cookie: 'private',
  authorization: 'Bearer abc',
  endpoint: 'https://x.test/path?token=secret',
  error: 'safe error',
});
assert.equal(redacted.includes('secret'), false);
assert.equal(redacted.includes('private'), false);
assert.equal(redacted.includes('Bearer abc'), false);
assert.equal(redacted.includes('safe error'), true);
console.log('Sync health aggregation, diagnostics redaction and permission-controlled replay planning passed.');
