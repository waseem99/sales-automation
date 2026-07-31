import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  applySellerDecisionOverride,
  attachDecisionScore,
  calculateDecisionScore,
  DECISION_SCORE_VERSION,
  reproduceDecisionTotal,
  type DecisionScoreResult,
} from '../../../packages/decision-scoring/src/index.js';
import type {Lead} from '../../../packages/shared/src/types.js';
import type {StoredLeadRecord} from '../../../packages/storage/src/index.js';
import {applyDecisionScoreToRecord} from '../../../vercel/acquisition-decision-scoring-runtime.js';

const root = resolve(process.cwd());
const api = readFileSync(resolve(root, 'api/acquisition-ingest.ts'), 'utf8');
const overrideApi = readFileSync(resolve(root, 'api/decision-score-override.ts'), 'utf8');
const runtime = readFileSync(resolve(root, 'vercel/acquisition-decision-scoring-runtime.ts'), 'utf8');
const packageSource = readFileSync(resolve(root, 'packages/decision-scoring/src/index.ts'), 'utf8');
const scoreView = readFileSync(resolve(root, 'apps/web/src/decision-score-view.ts'), 'utf8');
const prospectPage = readFileSync(resolve(root, 'apps/web/src/prospects-page.ts'), 'utf8');

const catalogueCall = 'const catalogueResponse = await applyCommercialCatalogueAfterIntake';
const decisionCall = 'const decisionScoreResponse = await applyDecisionScoringAfterIntake';
const accountCall = 'const accountResponse = await applyUpworkAccountIntelligenceAfterIntake';
assert(api.indexOf(catalogueCall) >= 0);
assert(api.indexOf(decisionCall) > api.indexOf(catalogueCall));
assert(api.indexOf(accountCall) > api.indexOf(decisionCall));

for (const marker of [
  "DECISION_SCORE_VERSION = 'decision-score.v1'",
  'account_fit',
  'contact_fit',
  'buyer_intent',
  'service_fit',
  'evidence_quality',
  'freshness',
  'commercial_readiness',
  'riskPenalty',
  'reproduceDecisionTotal',
  'originalScore',
  'overrideHistory',
  'coldSourcePreserved',
  'externalActionAutomated: false',
]) assert(packageSource.includes(marker), `Decision scoring package missing ${marker}`);

for (const marker of [
  'decisionScoreLatestModelCandidate',
  'decisionScoreOverrideProtected',
  'decisionScoreNeedsSellerReview',
  'overrideHistory.length > 0',
  'aggregateReproducible: true',
  'externalActionAutomated: false',
]) assert(runtime.includes(marker), `Decision scoring runtime missing ${marker}`);

for (const marker of [
  'applySellerDecisionOverride',
  'originalScoreRetained',
  'overrideHistoryCount',
  'prior_total=',
  'reason=',
  'outcome=',
  "requireEnvironment('ACQUISITION_INGEST_TOKEN')",
  'externalActionAutomated: false',
]) assert(overrideApi.includes(marker), `Decision score override API missing ${marker}`);

for (const marker of [
  'Decision score',
  'Account fit',
  'Contact fit',
  'Buyer intent',
  'Evidence quality',
  'Commercial readiness',
  'Seller override history',
  'Original model result retained',
]) assert(scoreView.includes(marker), `Prospect Desk score renderer missing ${marker}`);
assert(prospectPage.includes("import { renderDecisionScorePanel } from './decision-score-view.js';"));
assert(prospectPage.includes('${renderDecisionScorePanel(lead)}'));

function lead(id: string): Lead {
  return {
    id,
    source: 'sales_navigator',
    sourceUrl: 'https://www.linkedin.com/sales/lead/ACwAAContract',
    evidenceUrl: 'https://www.linkedin.com/sales/lead/ACwAAContract',
    leadType: 'sales_navigator_cold_prospect',
    prospectStage: 'cold_prospect',
    title: 'CTO at a software agency',
    description: 'Public account and role fit evidence only.',
    companyName: 'Agency Co',
    contactName: 'Alex CTO',
    contactRole: 'Chief Technology Officer',
    serviceCategory: 'fullstack_web_app',
    capturedAt: '2026-07-31T12:00:00.000Z',
    freshnessMinutes: 30,
    pipelineStatus: 'needs_human_review',
    createdAt: '2026-07-31T12:00:00.000Z',
    updatedAt: '2026-07-31T12:00:00.000Z',
    rawPayload: {
      parserStatus: 'complete',
      intentProvenance: {
        baseClassification: 'cold_no_confirmed_intent',
        sourceBuyerIntentConfirmed: false,
        linkedWarmIntentConfirmed: true,
        effectiveInterpretation: 'linked_warm_evidence',
        invalidOrStaleWarmEvidence: [],
      },
      primaryCampaignMatch: {
        score: 90,
        disposition: 'priority_a',
        recommendedProof: [{id: 'proof'}],
      },
      commercialReadinessDecision: {
        qualificationAllowed: true,
        draftAllowed: true,
        approvalAllowed: true,
        status: 'outreach_ready_limited',
        blockers: [],
      },
      commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
    },
  };
}

const generatedAt = '2026-07-31T13:00:00.000Z';
const base = calculateDecisionScore(lead('score-contract'), generatedAt);
assert.equal(base.version, DECISION_SCORE_VERSION);
assert.equal(base.buyerIntentConfirmed, false);
assert.equal(base.coldSourcePreserved, true);
assert.equal(base.linkedWarmEvidence, true);
assert.equal(base.total, reproduceDecisionTotal(base));

const overridden = applySellerDecisionOverride(base, {
  actor: 'seller@codistan.org',
  reason: 'Verified the contact authority from the retained source evidence.',
  outcome: 'Increase contact fit while retaining cold intent semantics.',
  occurredAt: '2026-07-31T13:30:00.000Z',
  component: 'contact_fit',
  newValue: 100,
});
assert.equal(overridden.originalScore?.resultHash, base.resultHash);
assert.equal(overridden.overrideHistory[0]?.priorValue, base.components.contact_fit);
assert.equal(overridden.overrideHistory[0]?.actor, 'seller@codistan.org');
assert.equal(overridden.buyerIntentConfirmed, false);
assert.equal(overridden.coldSourcePreserved, true);

const attached = attachDecisionScore(lead('score-contract'), overridden);
const record: StoredLeadRecord = {lead: attached, notes: [], alertDedupeKeysSent: [], auditLog: []};
const recalculated = applyDecisionScoreToRecord(record, '2026-07-31T14:00:00.000Z');
assert.equal(recalculated.overrideProtected, true);
assert.equal(recalculated.score.resultHash, overridden.resultHash, 'ingestion cannot erase a seller override');
const recalculatedRaw = recalculated.lead.rawPayload as Record<string, unknown>;
assert.equal(recalculatedRaw.decisionScoreOverrideProtected, true);
assert.equal(recalculatedRaw.decisionScoreNeedsSellerReview, true);
assert(recalculatedRaw.decisionScoreLatestModelCandidate);

const combined = `${api}\n${overrideApi}\n${runtime}\n${packageSource}\n${scoreView}\n${prospectPage}`.toLowerCase();
for (const prohibited of [
  'externalactionautomated: true',
  'external_action_performed: true',
  'automatic sending enabled',
  'sendlinkedinmessage(',
  'connectrequest(',
]) assert(!combined.includes(prohibited), `Automatic external-action boundary violated: ${prohibited}`);

console.log('Decision scoring persistence, override and Prospect Desk contract passed.');
