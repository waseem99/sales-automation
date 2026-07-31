import assert from 'node:assert/strict';
import {
  attachIntentProvenance,
  buildIntentProvenance,
  COLD_NO_CONFIRMED_INTENT_WARNING,
  classifyIntentEvidence,
  safeColdDraft,
} from './intent-provenance.js';
import type {Lead} from './types.js';

const now = '2026-07-31T10:00:00.000Z';

function lead(id: string, patch: Partial<Lead>): Lead {
  return {
    id,
    source: 'sales_navigator',
    sourceUrl: `https://www.linkedin.com/sales/lead/${id}`,
    leadType: 'sales_navigator_cold_prospect',
    prospectStage: 'cold_prospect',
    title: 'Delivery leader at an agency',
    description: 'Public role and account evidence only.',
    companyName: 'Example Agency',
    contactName: 'Alex Buyer',
    serviceCategory: 'fullstack_web_app',
    capturedAt: '2026-07-30T10:00:00.000Z',
    pipelineStatus: 'needs_human_review',
    createdAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:00:00.000Z',
    ...patch,
  };
}

const cold = lead('cold-1', {});
const coldOnly = buildIntentProvenance(cold, [], now);
assert.equal(coldOnly.baseClassification, 'cold_no_confirmed_intent');
assert.equal(coldOnly.sourceBuyerIntentConfirmed, false);
assert.equal(coldOnly.linkedWarmIntentConfirmed, false);
assert.equal(coldOnly.effectiveInterpretation, 'cold_only');
assert.equal(coldOnly.warning, COLD_NO_CONFIRMED_INTENT_WARNING);
const attachedCold = attachIntentProvenance(cold, coldOnly);
assert.match(attachedCold.evidenceSummary ?? '', /no confirmed buying intent/i);
assert.match(attachedCold.recommendedNextAction ?? '', /cold prospect/i);
assert.match(attachedCold.draftMessage ?? '', /fit hypothesis rather than a response to a confirmed request/i);
assert.doesNotMatch(attachedCold.draftMessage ?? '', /I saw your (?:post|request|need)/i);
const coldRaw = attachedCold.rawPayload as Record<string, unknown>;
assert.equal(coldRaw.sourceBuyerIntentConfirmed, false);
assert.equal(coldRaw.buyerIntentConfirmed, false);
assert.equal(coldRaw.originalSourceClassificationPreserved, true);

const warm = lead('warm-1', {
  source: 'linkedin',
  sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
  evidenceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
  leadType: 'linkedin_warm_post',
  prospectStage: 'warm_lead',
  opportunityStatus: 'live_opportunity',
  title: 'Looking for a delivery partner',
});
const linked = buildIntentProvenance(cold, [warm], now);
assert.equal(linked.sourceBuyerIntentConfirmed, false, 'cold source itself never becomes buyer-authored intent');
assert.equal(linked.linkedWarmIntentConfirmed, true);
assert.equal(linked.effectiveInterpretation, 'linked_warm_evidence');
assert.equal(linked.coldSourceHistory.length, 1);
assert.equal(linked.warmEvidence.length, 1);
const linkedDraft = safeColdDraft(cold, linked);
assert.match(linkedDraft, /separate buyer-authored demand evidence/i);
assert.match(linkedDraft, /verify that evidence is current/i);

const warmDirect = buildIntentProvenance(warm, [cold], now);
assert.equal(warmDirect.sourceBuyerIntentConfirmed, true);
assert.equal(warmDirect.effectiveInterpretation, 'warm_buyer_authored');
assert.equal(warmDirect.coldSourceHistory.length, 1, 'linked cold history is additive and retained');

const staleWarm = lead('warm-stale', {
  source: 'linkedin',
  sourceUrl: 'https://www.linkedin.com/posts/example_old-request-activity-123',
  evidenceUrl: 'https://www.linkedin.com/posts/example_old-request-activity-123',
  leadType: 'linkedin_warm_post',
  prospectStage: 'warm_lead',
  opportunityStatus: 'live_opportunity',
  rawPayload: {intentEvidenceStatus: 'stale'},
});
const stale = buildIntentProvenance(cold, [staleWarm], now);
assert.equal(stale.linkedWarmIntentConfirmed, false);
assert.equal(stale.effectiveInterpretation, 'cold_only');
assert.equal(stale.invalidOrStaleWarmEvidence[0]?.status, 'stale');

const invalidWarm = lead('warm-invalid', {
  source: 'upwork',
  sourceUrl: 'https://www.upwork.com/jobs/~01',
  evidenceUrl: 'https://www.upwork.com/jobs/~01',
  leadType: 'upwork_job',
  prospectStage: 'warm_lead',
  opportunityStatus: 'live_opportunity',
  rawPayload: {intentEvidenceValid: false},
});
const invalid = buildIntentProvenance(cold, [invalidWarm], now);
assert.equal(invalid.linkedWarmIntentConfirmed, false);
assert.equal(invalid.effectiveInterpretation, 'cold_only');
assert.equal(invalid.invalidOrStaleWarmEvidence[0]?.status, 'invalid');

const untraceableWarm = lead('warm-untraceable', {
  source: 'linkedin',
  sourceUrl: 'https://www.linkedin.com/in/person',
  evidenceUrl: 'https://www.linkedin.com/in/person',
  leadType: 'linkedin_warm_post',
  prospectStage: 'warm_lead',
  opportunityStatus: 'live_opportunity',
});
assert.equal(classifyIntentEvidence(untraceableWarm, now).status, 'invalid');

console.log('Intent provenance tests passed.');
