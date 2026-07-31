import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Lead} from '../../../packages/shared/src/types.js';
import type {StoredLeadRecord} from '../../../packages/storage/src/index.js';
import {
  aggregateSyncHealth,
  createSafeReplayPlan,
  createSyncHealthSnapshot,
  EXPECTED_RECONCILIATION_VERSION,
  verifySyncHealthSnapshot,
} from '../../../packages/sync-health/src/index.js';
import {renderSyncHealthDashboard} from '../../../apps/web/src/sync-health-view.js';
import {attachReconciliationHealth} from '../../../vercel/acquisition-sync-health-runtime.js';

const root = resolve(process.cwd());
const packageSource = readFileSync(resolve(root, 'packages/sync-health/src/index.ts'), 'utf8');
const apiSource = readFileSync(resolve(root, 'api/sync-health.ts'), 'utf8');
const runtimeSource = readFileSync(resolve(root, 'vercel/acquisition-sync-health-runtime.ts'), 'utf8');
const localSource = readFileSync(resolve(root, 'workers/acquisition/acquisition_v4/sync_health.py'), 'utf8');
const cliSource = readFileSync(resolve(root, 'workers/acquisition/sync_health_report.py'), 'utf8');
const ingestion = readFileSync(resolve(root, 'api/acquisition-ingest.ts'), 'utf8');
const storeSource = readFileSync(resolve(root, 'packages/neon-state/src/sync-health-store.ts'), 'utf8');

for (const marker of [
  'pending', 'retrying', 'deadLetter', 'conflicted', 'averageLatencyMs', 'endpointVersionMismatch',
  'createSafeReplayPlan', 'permissionConfirmed', 'preserveIdempotencyKey', 'redactDiagnostic',
  'stateRootPreserved: true', 'externalActionAutomated: false',
]) assert(packageSource.includes(marker), `Sync health package missing ${marker}`);
for (const marker of ['publish_snapshot', 'plan_replay', 'loadSyncHealthSnapshots', 'persistSyncHealthSnapshot', 'renderSyncHealthDashboard']) {
  assert(apiSource.includes(marker), `Sync health API missing ${marker}`);
}
for (const marker of ['sync_health_snapshots', 'collected_at', 'ON CONFLICT']) assert(storeSource.includes(marker));
for (const marker of ['collect_sync_health', 'prepare_safe_replay', 'redact_diagnostic', 'replay_history', 'external_action_automated']) {
  assert(localSource.includes(marker), `Local sync health missing ${marker}`);
}
assert(cliSource.includes('--allow-replay'));
assert(cliSource.includes('--state-root'));
assert(ingestion.indexOf('attachAcquisitionReconciliation') < ingestion.indexOf('applySyncHealthAfterReconciliation'));

const linkedin = createSyncHealthSnapshot({
  source: 'linkedin',
  collectedAt: '2026-07-31T14:10:00.000Z',
  capture: 'healthy',
  localProcessing: 'healthy',
  outbox: 'degraded',
  prospectDeskIngestion: 'degraded',
  endpointVersion: EXPECTED_RECONCILIATION_VERSION,
  pending: 1,
  retrying: 1,
  deadLetter: 1,
  conflicted: 1,
  failed: 2,
  averageLatencyMs: 1500,
  records: [
    {idempotencyKey: 'sync-linkedin-pending', status: 'pending', attempts: 0},
    {idempotencyKey: 'sync-linkedin-dead', status: 'dead_letter', attempts: 5, lastError: 'Bearer secret'},
    {idempotencyKey: 'sync-linkedin-conflict', status: 'conflicted', attempts: 1},
  ],
  diagnostics: [{cookie: 'private', error: 'safe transport failure'}],
});
const upwork = createSyncHealthSnapshot({
  source: 'upwork',
  collectedAt: '2026-07-31T14:11:00.000Z',
  capture: 'healthy',
  localProcessing: 'healthy',
  outbox: 'healthy',
  prospectDeskIngestion: 'blocked',
  endpointVersion: 'legacy.v0',
});
const salesNav = createSyncHealthSnapshot({
  source: 'sales_navigator',
  collectedAt: '2026-07-31T14:12:00.000Z',
  capture: 'healthy',
  localProcessing: 'healthy',
  outbox: 'healthy',
  prospectDeskIngestion: 'healthy',
  endpointVersion: EXPECTED_RECONCILIATION_VERSION,
  applied: 7,
  averageLatencyMs: 500,
});
assert.equal(verifySyncHealthSnapshot(linkedin), true);
assert.equal(JSON.stringify(linkedin).includes('Bearer secret'), false);
assert.equal(JSON.stringify(linkedin).includes('private'), false);
const aggregate = aggregateSyncHealth([linkedin, upwork, salesNav], '2026-07-31T14:13:00.000Z');
assert.equal(aggregate.sources.length, 3);
assert.equal(aggregate.totals.deadLetter, 1);
assert.deepEqual(aggregate.endpointVersionMismatches, ['upwork']);
assert.equal(aggregate.healthy, false);
const plan = createSafeReplayPlan({
  snapshot: linkedin,
  idempotencyKeys: ['sync-linkedin-pending', 'sync-linkedin-dead', 'sync-linkedin-conflict'],
  actor: 'operator@codistan.org',
  permissionConfirmed: true,
  requestedAt: '2026-07-31T14:14:00.000Z',
});
assert.equal(plan.records.length, 2);
assert.equal(plan.skipped.length, 1);
assert.equal(plan.records.every((record) => record.preserveIdempotencyKey), true);
const html = renderSyncHealthDashboard(aggregate);
for (const marker of ['Synchronization health', 'Attention required', 'Dead letter', 'sync-linkedin-dead', 'Replay requires explicit permission: Yes', 'Automatic external actions: No']) {
  assert(html.includes(marker), `Sync health dashboard missing ${marker}`);
}

const lead: Lead = {
  id: 'acq-linkedin-health', source: 'linkedin', leadType: 'linkedin_warm_post', title: 'Requirement',
  description: 'Current implementation requirement.', serviceCategory: 'fullstack_web_app',
  capturedAt: '2026-07-31T14:00:00.000Z', pipelineStatus: 'needs_human_review',
  createdAt: '2026-07-31T14:00:00.000Z', updatedAt: '2026-07-31T14:00:00.000Z',
};
const record: StoredLeadRecord = {lead, notes: [], auditLog: [], alertDedupeKeysSent: []};
const attached = attachReconciliationHealth(record, {
  source: 'linkedin', idempotencyKey: 'sync-linkedin-health', expectedLeadId: lead.id,
  status: 'merged', outcome: 'updated', reason: 'Evidence merged; token=secret',
}, '2026-07-31T14:15:00.000Z');
const raw = attached.lead.rawPayload as Record<string, unknown>;
assert.equal(Array.isArray(raw.syncReconciliationHistory), true);
assert.equal(JSON.stringify(raw).includes('token=secret'), false);
assert.equal(JSON.stringify(raw).includes('[redacted]'), true);

const combined = `${packageSource}\n${apiSource}\n${runtimeSource}\n${localSource}\n${cliSource}`.toLowerCase();
for (const prohibited of ['externalactionautomated: true', 'external_action_automated": true', 'remove-item', 'rmdir', 'sendlinkedinmessage(', 'submitupworkproposal(']) {
  assert(!combined.includes(prohibited), `Sync health boundary violated: ${prohibited}`);
}
console.log('Sync health visibility, redaction, reconciliation history and permission-controlled replay passed.');
