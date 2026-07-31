import assert from 'node:assert/strict';
import type {Lead} from '@sales-automation/shared';
import {
  applySellerDecisionOverride,
  attachDecisionScore,
  calculateDecisionScore,
  DECISION_SCORE_VERSION,
  readDecisionScore,
  reproduceDecisionSubtotal,
  reproduceDecisionTotal,
} from './index.js';

const now = '2026-07-31T13:00:00.000Z';

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'linkedin',
    sourceUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
    evidenceUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    opportunityStatus: 'live_opportunity',
    title: 'Looking for a software delivery partner',
    description: 'Buyer-authored request for a managed software team and implementation support.',
    companyName: 'Example Co',
    companyWebsite: 'https://example.com',
    contactName: 'Alex Buyer',
    contactRole: 'Chief Technology Officer',
    linkedinUrl: 'https://www.linkedin.com/in/alex-buyer',
    industry: 'software',
    serviceCategory: 'fullstack_web_app',
    capturedAt: '2026-07-31T12:30:00.000Z',
    freshnessMinutes: 30,
    pipelineStatus: 'needs_human_review',
    createdAt: '2026-07-31T12:30:00.000Z',
    updatedAt: '2026-07-31T12:30:00.000Z',
    evidenceSummary: 'Current buyer-authored post requests a delivery partner.',
    rawPayload: {
      parserStatus: 'complete',
      linkedinIntent: {
        buyer_intent_confirmed: true,
        freshness_status: 'current',
        strong_negative: false,
        cold_source_preserved: false,
      },
      primaryCampaignMatch: {
        campaignId: 'software_ai_overflow_partners',
        score: 86,
        disposition: 'priority_a',
        recommendedProof: [{id: 'acmetel-product'}],
      },
      commercialReadinessDecision: {
        qualificationAllowed: true,
        draftAllowed: true,
        approvalAllowed: true,
        status: 'outreach_ready_limited',
        blockers: [],
      },
      commercialCatalogueSelection: {
        commerciallyActionable: true,
        disqualifiers: [],
      },
    },
    ...patch,
  };
}

{
  const result = calculateDecisionScore(lead('1001'), now);
  assert.equal(result.version, DECISION_SCORE_VERSION);
  assert.equal(result.buyerIntentConfirmed, true);
  assert.equal(result.coldSourcePreserved, false);
  assert(result.components.account_fit >= 80);
  assert.equal(result.components.buyer_intent, 100);
  assert(result.components.commercial_readiness >= 90);
  assert.equal(result.subtotal, reproduceDecisionSubtotal(result.components));
  assert.equal(result.total, reproduceDecisionTotal(result));
  assert.equal(result.resultHash.length, 64);
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.externalActionAutomated, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.components), true);
  const repeated = calculateDecisionScore(lead('1001'), now);
  assert.equal(repeated.resultHash, result.resultHash);
  assert.deepEqual(repeated.components, result.components);
}

{
  const missing = lead('1002', {
    companyName: undefined,
    companyWebsite: undefined,
    contactName: undefined,
    contactRole: undefined,
    linkedinUrl: undefined,
    evidenceUrl: undefined,
    sourceUrl: undefined,
    evidenceSummary: undefined,
    freshnessMinutes: undefined,
    serviceCategory: 'unknown',
    rawPayload: {
      primaryCampaignMatch: {score: 15, disposition: 'research', recommendedProof: []},
      commercialReadinessDecision: {
        qualificationAllowed: true,
        draftAllowed: false,
        approvalAllowed: false,
        status: 'research_only',
        blockers: ['Offer remains research-only.'],
      },
      commercialCatalogueSelection: {commerciallyActionable: false, disqualifiers: []},
    },
  });
  const result = calculateDecisionScore(missing, now);
  assert(result.missingEvidence.some((item) => /company\/account/i.test(item)));
  assert(result.missingEvidence.some((item) => /contact name/i.test(item)));
  assert(result.missingEvidence.some((item) => /buyer intent/i.test(item)));
  assert(result.missingEvidence.some((item) => /service category/i.test(item)));
  assert(result.components.evidence_quality < 50);
  assert(['research', 'reject'].includes(result.priority));
}

{
  const stale = lead('1003', {
    freshnessMinutes: 40_000,
    rawPayload: {
      parserStatus: 'complete',
      linkedinIntent: {
        buyer_intent_confirmed: false,
        freshness_status: 'stale',
        strong_negative: false,
        cold_source_preserved: false,
      },
      primaryCampaignMatch: {score: 82, disposition: 'priority_a', recommendedProof: [{id: 'proof'}]},
      commercialReadinessDecision: {
        qualificationAllowed: true,
        draftAllowed: true,
        approvalAllowed: true,
        status: 'outreach_ready',
        blockers: [],
      },
      commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
    },
  });
  const result = calculateDecisionScore(stale, now);
  assert.equal(result.buyerIntentConfirmed, false);
  assert.equal(result.components.buyer_intent, 10);
  assert.equal(result.components.freshness, 10);
  assert(result.riskPenalty >= 25);
  assert(result.risks.some((item) => /stale/i.test(item)));
}

{
  const cold = lead('1004', {
    source: 'sales_navigator',
    sourceUrl: 'https://www.linkedin.com/sales/lead/ACwAAExample',
    evidenceUrl: 'https://www.linkedin.com/sales/lead/ACwAAExample',
    leadType: 'sales_navigator_cold_prospect',
    prospectStage: 'cold_prospect',
    opportunityStatus: undefined,
    rawPayload: {
      parserStatus: 'complete',
      intentProvenance: {
        baseClassification: 'cold_no_confirmed_intent',
        sourceBuyerIntentConfirmed: false,
        linkedWarmIntentConfirmed: true,
        effectiveInterpretation: 'linked_warm_evidence',
        invalidOrStaleWarmEvidence: [],
      },
      primaryCampaignMatch: {score: 95, disposition: 'priority_a', recommendedProof: [{id: 'proof'}]},
      commercialReadinessDecision: {
        qualificationAllowed: true,
        draftAllowed: true,
        approvalAllowed: true,
        status: 'outreach_ready_limited',
        blockers: [],
      },
      commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
    },
  });
  const result = calculateDecisionScore(cold, now);
  assert.equal(result.coldSourcePreserved, true);
  assert.equal(result.buyerIntentConfirmed, false);
  assert.equal(result.linkedWarmEvidence, true);
  assert.equal(result.components.buyer_intent, 55);
  assert(result.reasons.some((item) => /does not rewrite the original cold source/i.test(item)));
}

{
  const risky = lead('1005', {
    score: {
      total: 50,
      breakdown: {
        serviceFit: 15,
        buyerQuality: 10,
        budgetRoi: 8,
        timingUrgency: 5,
        portfolioProofMatch: 5,
        competitionAccessRisk: 4,
        complianceSafety: 3,
      },
      status: 'qualified',
      urgency: 'normal',
      explanation: 'Legacy score retained.',
      redFlags: [
        {code: 'unsafe_request', severity: 'critical', reason: 'Unsafe or prohibited request.'},
      ],
    },
    rawPayload: {
      parserStatus: 'reject',
      linkedinIntent: {
        buyer_intent_confirmed: false,
        freshness_status: 'current',
        strong_negative: true,
        cold_source_preserved: false,
      },
      primaryCampaignMatch: {score: 90, disposition: 'priority_a', recommendedProof: [{id: 'proof'}]},
      commercialReadinessDecision: {
        qualificationAllowed: false,
        draftAllowed: false,
        approvalAllowed: false,
        status: 'retired',
        blockers: ['Offer is retired.'],
      },
      commercialCatalogueSelection: {
        commerciallyActionable: false,
        disqualifiers: [{code: 'prohibited_industry'}],
      },
    },
  });
  const result = calculateDecisionScore(risky, now);
  assert.equal(result.priority, 'reject');
  assert(result.riskPenalty >= 60);
  assert(result.risks.some((item) => /unsafe_request/i.test(item)));
  assert(result.risks.some((item) => /prohibited_industry/i.test(item)));
}

{
  const original = calculateDecisionScore(lead('1006'), now);
  const overridden = applySellerDecisionOverride(original, {
    actor: 'seller@codistan.org',
    reason: 'Verified the decision-maker role manually.',
    outcome: 'Increase contact fit after source review.',
    occurredAt: '2026-07-31T14:00:00.000Z',
    component: 'contact_fit',
    newValue: 100,
  });
  assert.equal(overridden.originalScore?.resultHash, original.resultHash);
  assert.equal(overridden.originalScore?.total, original.total);
  assert.equal(overridden.overrideHistory.length, 1);
  assert.equal(overridden.overrideHistory[0]?.actor, 'seller@codistan.org');
  assert.equal(overridden.overrideHistory[0]?.priorValue, original.components.contact_fit);
  assert.equal(overridden.overrideHistory[0]?.newValue, 100);
  assert.match(overridden.overrideHistory[0]?.reason ?? '', /decision-maker/i);
  assert.match(overridden.overrideHistory[0]?.outcome ?? '', /increase contact fit/i);
  assert.equal(overridden.total, reproduceDecisionTotal(overridden));
  assert.equal(original.overrideHistory.length, 0, 'the original score is not mutated');

  const forced = applySellerDecisionOverride(overridden, {
    actor: 'founder@codistan.org',
    reason: 'Commercial exception approved for research only.',
    outcome: 'Keep the record in research despite the numeric score.',
    occurredAt: '2026-07-31T14:15:00.000Z',
    forcedPriority: 'research',
  });
  assert.equal(forced.priority, 'research');
  assert.equal(forced.overrideHistory.length, 2);
  assert.equal(forced.originalScore?.resultHash, original.resultHash);
  assert.equal(forced.overrideHistory[1]?.forcedPriority, 'research');
  assert.equal(forced.externalActionAutomated, false);
}

{
  const score = calculateDecisionScore(lead('1007'), now);
  const attached = attachDecisionScore(lead('1007'), score);
  assert.equal(readDecisionScore(attached)?.resultHash, score.resultHash);
  const raw = attached.rawPayload as Record<string, unknown>;
  assert.equal(raw.decisionScoreVersion, DECISION_SCORE_VERSION);
  assert.equal(raw.decisionScoreBuyerIntentConfirmed, true);
  assert.equal(raw.externalActionAutomated, false);
}

console.log('Decision scoring component and override tests passed.');
