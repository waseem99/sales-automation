import assert from 'node:assert/strict';
import {
  attachAcquisitionReconciliation,
  deterministicSyncIdempotencyKey,
  prepareAcquisitionSyncPayload,
} from '../../../vercel/acquisition-sync-reconciliation.js';

const linkedinUrl = 'https://www.linkedin.com/feed/update/urn:li:activity:123?utm_source=test';
const normalizedKey = deterministicSyncIdempotencyKey({
  source: 'linkedin',
  dedupeKey: 'linkedin-1',
  canonicalUrl: linkedinUrl,
});
assert.equal(normalizedKey, deterministicSyncIdempotencyKey({
  source: 'linkedin',
  dedupeKey: 'LINKEDIN-1',
  canonicalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
}));
assert.notEqual(normalizedKey, deterministicSyncIdempotencyKey({
  source: 'upwork',
  dedupeKey: 'linkedin-1',
  canonicalUrl: linkedinUrl,
}));

const prepared = prepareAcquisitionSyncPayload({
  schema_version: 'codistan-acquisition-sync.v1',
  source: 'linkedin',
  external_action_performed: false,
  records: [
    {
      source: 'linkedin',
      dedupe_key: 'linkedin-1',
      canonical_url: linkedinUrl,
      title: 'Buyer requirement',
      body: 'Visible buyer-authored evidence for an active software delivery requirement.',
    },
    {
      source: 'linkedin',
      dedupe_key: 'linkedin-1',
      canonical_url: linkedinUrl,
      title: 'Repeated card',
      body: 'The same record appeared again after an infinite-scroll rerender.',
    },
    {
      source: 'linkedin',
      dedupe_key: 'linkedin-conflict',
      canonical_url: 'https://www.linkedin.com/feed/update/urn:li:activity:456',
      title: 'Attempted seller overwrite',
      body: 'Source evidence must never overwrite the seller-owned pipeline state.',
      owner: 'source-controlled-owner',
      pipelineStatus: 'won',
      notes: ['overwrite'],
    },
  ],
});

assert.equal(prepared.originalInputCount, 3);
assert.equal(prepared.records.length, 1);
assert.equal(prepared.preflight.length, 2);
assert.equal(prepared.preflight[0]?.status, 'duplicate');
assert.equal(prepared.preflight[1]?.status, 'conflicted');
assert.match(prepared.preflight[1]?.reason ?? '', /owner.*notes.*pipelineStatus|notes.*owner.*pipelineStatus/i);
const acceptedBody = prepared.body as {records: Array<Record<string, unknown>>};
assert.equal(acceptedBody.records.length, 1);
assert.equal(acceptedBody.records[0]?.idempotency_key, normalizedKey);
assert.equal(acceptedBody.records[0]?.owner, undefined);

const createdId = prepared.records[0]!.expectedLeadId;
const applied = await attachAcquisitionReconciliation(new Response(JSON.stringify({
  ok: true,
  created: 1,
  updated: 0,
  unchanged: 0,
  rejected: 0,
  createdLeadIds: [createdId],
  updatedLeadIds: [],
  unchangedLeadIds: [],
  rejectedRecords: [],
  processedLeadIds: [createdId],
  externalActionAutomated: false,
}), {status: 201, headers: {'content-type': 'application/json'}}), prepared);
const appliedBody = await applied.json() as any;
assert.equal(appliedBody.reconciliation.version, 'acquisition-reconciliation.v1');
assert.equal(appliedBody.reconciliation.counts.applied, 1);
assert.equal(appliedBody.reconciliation.counts.duplicate, 1);
assert.equal(appliedBody.reconciliation.counts.conflicted, 1);
assert.equal(appliedBody.reconciliation.sellerFieldsPreserved, true);
assert.equal(appliedBody.reconciliation.sourceEvidenceRetained, true);
assert.equal(appliedBody.reconciliation.safeReplay, true);
assert.equal(appliedBody.reconciliation.externalActionAutomated, false);

const mergedPrepared = prepareAcquisitionSyncPayload({
  source: 'upwork',
  records: [{
    source: 'upwork',
    dedupe_key: 'upwork-1',
    canonical_url: 'https://www.upwork.com/jobs/~01',
    title: 'Enriched opportunity',
    body: 'Updated public evidence for an existing opportunity without seller field changes.',
  }],
});
const mergedId = mergedPrepared.records[0]!.expectedLeadId;
const merged = await attachAcquisitionReconciliation(new Response(JSON.stringify({
  ok: true,
  createdLeadIds: [],
  updatedLeadIds: [mergedId],
  unchangedLeadIds: [],
  rejectedRecords: [],
  processedLeadIds: [mergedId],
}), {status: 200}), mergedPrepared);
const mergedBody = await merged.json() as any;
assert.equal(mergedBody.reconciliation.records[0].status, 'merged');
assert.equal(mergedBody.reconciliation.records[0].outcome, 'updated');
assert.match(mergedBody.reconciliation.records[0].reason, /seller-owned fields remained authoritative/i);

const duplicate = await attachAcquisitionReconciliation(new Response(JSON.stringify({
  ok: true,
  createdLeadIds: [],
  updatedLeadIds: [],
  unchangedLeadIds: [mergedId],
  rejectedRecords: [],
  processedLeadIds: [mergedId],
}), {status: 200}), mergedPrepared);
const duplicateBody = await duplicate.json() as any;
assert.equal(duplicateBody.reconciliation.records[0].status, 'duplicate');
assert.match(duplicateBody.reconciliation.records[0].reason, /created no duplicate/i);

const pending = await attachAcquisitionReconciliation(new Response(JSON.stringify({ok: true}), {status: 200}), mergedPrepared);
const pendingBody = await pending.json() as any;
assert.equal(pendingBody.reconciliation.records[0].status, 'pending');
assert.equal(pendingBody.reconciliation.safeReplay, true);

console.log('Three-source sync reconciliation contract passed.');
