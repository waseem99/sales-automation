import assert from 'node:assert/strict';
import type {Lead} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';
import {
  applySystemFunnelStages,
  FUNNEL_REASON_CODES,
  FUNNEL_STAGES,
  readSellerFunnel,
  recordFunnelTransition,
  SELLER_FUNNEL_VERSION,
  summarizeFunnel,
  verifyFunnelEventHash,
} from './index.js';

function lead(id = 'lead-1'): Lead {
  return {
    id,
    source: 'linkedin',
    sourceUrl: `https://www.linkedin.com/feed/update/${id}`,
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    title: 'Buyer needs an implementation partner',
    description: 'We need a delivery team for a current web application implementation.',
    companyName: 'Example Buyer',
    contactName: 'Buyer One',
    serviceCategory: 'fullstack_web_app',
    capturedAt: '2026-07-31T12:00:00.000Z',
    pipelineStatus: 'needs_human_review',
    createdAt: '2026-07-31T12:00:00.000Z',
    updatedAt: '2026-07-31T12:00:00.000Z',
    owner: 'seller-a@codistan.org',
    rawPayload: {
      decisionScore: {version: 'decision-score.v1', priority: 'priority_a'},
      campaignGovernance: {campaignId: 'delivery-partners'},
      commercialCatalogueSelection: {offerVersion: 'delivery-partner.1'},
    },
  };
}

let current = applySystemFunnelStages(lead(), '2026-07-31T12:05:00.000Z');
assert.deepEqual(readSellerFunnel(current).events.map((event) => event.stage), [
  'captured', 'technically_valid', 'qualified',
]);
assert.equal(readSellerFunnel(current).version, SELLER_FUNNEL_VERSION);
assert.equal(readSellerFunnel(current).events.every(verifyFunnelEventHash), true);

current = recordFunnelTransition(current, {
  stage: 'human_reviewed',
  reasonCode: 'accept',
  actor: 'seller-a@codistan.org',
  transitionKind: 'human_review',
  occurredAt: '2026-07-31T12:10:00.000Z',
  evidence: 'Seller reviewed source evidence and commercial fit.',
  feedback: {
    relevanceRating: 5,
    contactAccuracy: 'accurate',
    sourceQuality: 'high',
    repeatRecommendation: 'increase',
    comment: 'Current and commercially relevant.',
  },
});
current = recordFunnelTransition(current, {
  stage: 'accepted',
  reasonCode: 'accept',
  actor: 'seller-a@codistan.org',
  transitionKind: 'human_review',
  occurredAt: '2026-07-31T12:11:00.000Z',
  evidence: 'Seller accepted the record for manual contact.',
});
assert.equal(current.pipelineStatus, 'approved_to_contact');
assert.equal(current.feedback?.relevanceRating, 5);

assert.throws(() => recordFunnelTransition(current, {
  stage: 'contacted_manually',
  reasonCode: 'accept',
  actor: 'system@codistan.local',
  transitionKind: 'system_recommendation',
  occurredAt: '2026-07-31T12:12:00.000Z',
}), /human record or separately approved integration/);

current = recordFunnelTransition(current, {
  stage: 'contacted_manually',
  reasonCode: 'accept',
  actor: 'seller-a@codistan.org',
  transitionKind: 'manual_external_action',
  occurredAt: '2026-07-31T12:12:00.000Z',
  evidence: 'Seller recorded manual LinkedIn outreach reference LI-1001.',
});
current = recordFunnelTransition(current, {
  stage: 'replied',
  reasonCode: 'accept',
  actor: 'seller-a@codistan.org',
  transitionKind: 'manual_external_action',
  occurredAt: '2026-07-31T12:20:00.000Z',
  evidence: 'Seller recorded buyer reply reference LI-1002.',
});
current = recordFunnelTransition(current, {
  stage: 'meeting',
  reasonCode: 'accept',
  actor: 'seller-a@codistan.org',
  transitionKind: 'manual_external_action',
  occurredAt: '2026-07-31T12:30:00.000Z',
  evidence: 'Seller recorded calendar meeting reference CAL-1003.',
});
current = recordFunnelTransition(current, {
  stage: 'proposal',
  reasonCode: 'accept',
  actor: 'seller-a@codistan.org',
  transitionKind: 'manual_external_action',
  occurredAt: '2026-07-31T12:40:00.000Z',
  evidence: 'Seller recorded manually sent proposal reference PROP-1004.',
});
current = recordFunnelTransition(current, {
  stage: 'won',
  reasonCode: 'accept',
  actor: 'seller-a@codistan.org',
  transitionKind: 'outcome',
  occurredAt: '2026-07-31T13:00:00.000Z',
  evidence: 'Seller recorded signed engagement reference DEAL-1005.',
});
assert.equal(current.pipelineStatus, 'won');
assert.equal(current.outcomeStatus, 'won');

const record: StoredLeadRecord = {lead: current, notes: [], auditLog: [], alertDedupeKeysSent: []};
const summary = summarizeFunnel([record], '2026-07-31T13:05:00.000Z');
assert.equal(summary.totalRecords, 1);
assert.equal(summary.stageCounts.captured, 1);
assert.equal(summary.stageCounts.won, 1);
assert.equal(summary.manualContactCount, 1);
assert.equal(summary.confirmedIntegrationContactCount, 0);
assert.equal(summary.bySource[0]?.key, 'linkedin');
assert.equal(summary.byCampaign[0]?.key, 'delivery-partners');
assert.equal(summary.byOffer[0]?.key, 'delivery-partner.1');
assert.equal(summary.byOwner[0]?.key, 'seller-a@codistan.org');
assert.equal(summary.reconciled, true);

const lost = recordFunnelTransition(applySystemFunnelStages(lead('lead-lost'), '2026-07-31T12:05:00.000Z'), {
  stage: 'lost',
  reasonCode: 'no_commercial_fit',
  actor: 'seller-b@codistan.org',
  transitionKind: 'outcome',
  occurredAt: '2026-07-31T12:10:00.000Z',
  evidence: 'Seller rejected the opportunity after commercial review.',
});
const mixed = summarizeFunnel([
  record,
  {lead: lost, notes: [], auditLog: [], alertDedupeKeysSent: []},
]);
assert.equal(mixed.stageCounts.lost, 1);
assert.equal(mixed.reasonCounts.no_commercial_fit, 1);

assert.equal(FUNNEL_STAGES.length, 11);
assert.equal(FUNNEL_REASON_CODES.length, 16);
console.log('Seller funnel transitions, feedback, manual-action separation and analytics reconciliation passed.');
