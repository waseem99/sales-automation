import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Lead} from '../../../packages/shared/src/types.js';
import type {StoredLeadRecord} from '../../../packages/storage/src/index.js';
import {
  applySystemFunnelStages,
  FUNNEL_REASON_CODES,
  FUNNEL_STAGES,
  readSellerFunnel,
  recordFunnelTransition,
  SELLER_FUNNEL_VERSION,
  summarizeFunnel,
} from '../../../packages/funnel-analytics/src/index.js';
import {renderFunnelAnalyticsDashboard} from '../../../apps/web/src/funnel-analytics-view.js';

const root = resolve(process.cwd());
const packageSource = readFileSync(resolve(root, 'packages/funnel-analytics/src/index.ts'), 'utf8');
const feedbackApi = readFileSync(resolve(root, 'api/funnel-feedback.ts'), 'utf8');
const analyticsApi = readFileSync(resolve(root, 'api/funnel-analytics.ts'), 'utf8');
const runtime = readFileSync(resolve(root, 'vercel/acquisition-funnel-runtime.ts'), 'utf8');
const ingestion = readFileSync(resolve(root, 'api/acquisition-ingest.ts'), 'utf8');
const dashboard = readFileSync(resolve(root, 'apps/web/src/funnel-analytics-view.ts'), 'utf8');

assert.equal(SELLER_FUNNEL_VERSION, 'seller-funnel.v1');
assert.deepEqual(FUNNEL_STAGES, [
  'captured', 'technically_valid', 'qualified', 'human_reviewed', 'accepted',
  'contacted_manually', 'replied', 'meeting', 'proposal', 'won', 'lost',
]);
assert.deepEqual(FUNNEL_REASON_CODES, [
  'accept', 'reject', 'research', 'duplicate', 'stale', 'employee_hiring',
  'no_commercial_fit', 'unsupported_geography', 'insufficient_proof', 'too_small',
  'too_large', 'timing_not_viable', 'wrong_contact', 'wrong_company', 'already_known', 'unclear_need',
]);

for (const marker of [
  'eventHash', 'transitionKind', 'dimensions', 'campaignId', 'offerVersion', 'modelVersion',
  'manual_external_action', 'confirmed_integration', 'humanReviewRequired: true', 'externalActionAutomated: false',
]) assert(packageSource.includes(marker), `Funnel package missing ${marker}`);
for (const marker of ['loadNeonAppState', 'persistLeadRecords', 'recordFunnelTransition', 'actor', 'reasonCode', 'transitionKind']) {
  assert(feedbackApi.includes(marker), `Feedback API missing ${marker}`);
}
for (const marker of ['summarizeFunnel', 'renderFunnelAnalyticsDashboard', "format') === 'html", 'cache-control']) {
  assert(analyticsApi.includes(marker), `Analytics API missing ${marker}`);
}
assert(runtime.includes('applySystemFunnelStages'));
assert(ingestion.indexOf('applyDecisionScoringAfterIntake') < ingestion.indexOf('applyFunnelAnalyticsAfterIntake'));
assert(ingestion.indexOf('applyFunnelAnalyticsAfterIntake') < ingestion.indexOf('applyUpworkAccountIntelligenceAfterIntake'));

function fixture(): Lead {
  return {
    id: 'funnel-contract-1',
    source: 'upwork',
    sourceUrl: 'https://www.upwork.com/jobs/~funnel-contract-1',
    leadType: 'upwork_job',
    prospectStage: 'warm_lead',
    title: 'Build a secure SaaS application',
    description: 'A current buyer-authored implementation requirement.',
    companyName: 'Contract Buyer',
    contactName: 'Buyer',
    serviceCategory: 'ai_saas_mvp',
    capturedAt: '2026-07-31T10:00:00.000Z',
    pipelineStatus: 'needs_human_review',
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
    owner: 'seller@codistan.org',
    rawPayload: {
      decisionScore: {version: 'decision-score.v1', priority: 'priority_b'},
      campaignGovernance: {campaignId: 'upwork-ai-saas'},
      commercialCatalogueSelection: {offerVersion: 'ai-saas.2'},
    },
  };
}

let lead = applySystemFunnelStages(fixture(), '2026-07-31T10:01:00.000Z');
lead = recordFunnelTransition(lead, {
  stage: 'human_reviewed', reasonCode: 'accept', actor: 'seller@codistan.org', transitionKind: 'human_review',
  occurredAt: '2026-07-31T10:02:00.000Z', evidence: 'Seller reviewed the original source and versions.',
});
lead = recordFunnelTransition(lead, {
  stage: 'accepted', reasonCode: 'accept', actor: 'seller@codistan.org', transitionKind: 'human_review',
  occurredAt: '2026-07-31T10:03:00.000Z', evidence: 'Seller accepted for manual outreach.',
});
assert.throws(() => recordFunnelTransition(lead, {
  stage: 'contacted_manually', reasonCode: 'accept', actor: 'system', transitionKind: 'system_recommendation',
}), /human record or separately approved integration/);
lead = recordFunnelTransition(lead, {
  stage: 'contacted_manually', reasonCode: 'accept', actor: 'seller@codistan.org', transitionKind: 'manual_external_action',
  occurredAt: '2026-07-31T10:04:00.000Z', evidence: 'Manual Upwork activity reference UP-1.',
});
const record: StoredLeadRecord = {lead, notes: [], auditLog: [], alertDedupeKeysSent: []};
const summary = summarizeFunnel([record], '2026-07-31T10:05:00.000Z');
assert.equal(summary.reconciled, true);
assert.equal(summary.stageCounts.captured, 1);
assert.equal(summary.stageCounts.contacted_manually, 1);
assert.equal(summary.manualContactCount, 1);
assert.equal(summary.externalActionAutomated, false);
assert.equal(readSellerFunnel(lead).events.at(-1)?.dimensions.offerVersion, 'ai-saas.2');
const html = renderFunnelAnalyticsDashboard(summary);
for (const marker of ['Seller funnel analytics', 'Events reconciled', 'Manual contact events: 1', 'Automatic external actions: No', 'upwork-ai-saas', 'ai-saas.2']) {
  assert(html.includes(marker), `Funnel dashboard missing ${marker}`);
}

const combined = `${packageSource}\n${feedbackApi}\n${analyticsApi}\n${runtime}\n${dashboard}`.toLowerCase();
for (const prohibited of [
  'externalactionautomated: true',
  'external_action_performed: true',
  'sendlinkedinmessage(',
  'submitupworkproposal(',
  'sendemailautomatically(',
]) assert(!combined.includes(prohibited), `Funnel boundary violated: ${prohibited}`);

console.log('Versioned funnel events, seller feedback, dashboard reconciliation and manual-action separation passed.');
