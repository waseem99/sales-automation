import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import {
  assertCommerciallyReadyForApproval,
  evaluateCommercialReadiness,
  OFFER_READINESS,
} from './index.js';

const now = '2026-07-27T00:00:00.000Z';

function prospect(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'sales_navigator',
    sourceUrl: `https://www.linkedin.com/sales/lead/${id}`,
    leadType: 'sales_navigator_cold_prospect',
    prospectStage: 'cold_prospect',
    title: id,
    description: 'Public professional evidence only.',
    serviceCategory: 'fullstack_web_app',
    capturedAt: now,
    pipelineStatus: 'needs_human_review',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

{
  const coldFintech = prospect('fintech', {
    rawPayload: {
      primaryCampaignMatch: {
        offerId: 'fintech_operations_platform',
        route: 'direct_buyer',
      },
    },
  });
  const decision = evaluateCommercialReadiness(coldFintech);
  assert.equal(decision.approvalAllowed, false);
  assert.equal(decision.mode, 'research_only');
  assert.equal(decision.status, 'research_only');
  assert(decision.blockers.some((item) => /pilot scope and pricing/i.test(item)));
  assert.throws(() => assertCommerciallyReadyForApproval(coldFintech), /commercial approval blocked/i);
}

{
  const coldPartner = prospect('delivery-partner', {
    rawPayload: {
      primaryCampaignMatch: {
        offerId: 'managed_software_ai_delivery',
        route: 'delivery_partner',
      },
    },
  });
  const decision = assertCommerciallyReadyForApproval(coldPartner);
  assert.equal(decision.approvalAllowed, true);
  assert.equal(decision.mode, 'cold_campaign');
  assert.equal(decision.status, 'outreach_ready_limited');
  assert(decision.prohibitedClaims.some((item) => /unlimited capacity/i.test(item)));
}

{
  const warmFintech = prospect('warm-fintech', {
    source: 'linkedin',
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    opportunityStatus: 'live_opportunity',
    rawPayload: {
      primaryCampaignMatch: {
        offerId: 'fintech_operations_platform',
        route: 'direct_buyer',
      },
    },
  });
  const decision = assertCommerciallyReadyForApproval(warmFintech);
  assert.equal(decision.approvalAllowed, true);
  assert.equal(decision.mode, 'warm_response');
  assert(decision.reasons.some((item) => /must not present the product as ready/i.test(item)));
}

{
  const unknownCold = prospect('unknown-offer', {
    rawPayload: {primaryCampaignMatch: {offerId: 'unknown_offer', route: 'direct_buyer'}},
  });
  const decision = evaluateCommercialReadiness(unknownCold);
  assert.equal(decision.approvalAllowed, false);
  assert.match(decision.blockers[0] ?? '', /no approved commercial-readiness profile/i);
}

{
  const unmappedCold = prospect('unmapped');
  const decision = evaluateCommercialReadiness(unmappedCold);
  assert.equal(decision.approvalAllowed, false);
  assert.match(decision.blockers[0] ?? '', /no resolved offer ID/i);
}

assert.equal(OFFER_READINESS.fintech_operations_platform?.status, 'research_only');
assert.equal(OFFER_READINESS.managed_software_ai_delivery?.status, 'outreach_ready_limited');

console.log('Commercial offer readiness tests passed.');
