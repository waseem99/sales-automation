import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import {
  applyCommercialReadinessToQualification,
  assertCommerciallyReadyForApproval,
  assertCommerciallyReadyForDraft,
  assertOfferReadinessPinCurrent,
  createOfferReadinessPin,
  evaluateCommercialReadiness,
  evaluateOfferReadinessProfile,
  OFFER_READINESS,
  transitionOfferReadiness,
  type OfferReadinessProfile,
  type OfferReadinessStatus,
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
    pipelineStatus: 'draft_ready',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function withOffer(id: string, offerId: string, offerVersion = 1, route = 'direct_buyer'): Lead {
  return prospect(id, {
    rawPayload: {
      primaryCampaignMatch: {
        campaignId: `${offerId}-campaign`,
        offerId,
        offerVersion,
        route,
        disposition: 'priority_a',
        risks: [],
      },
      campaignMatches: [{
        campaignId: `${offerId}-campaign`,
        offerId,
        offerVersion,
        route,
        disposition: 'priority_a',
        risks: [],
      }],
    },
  });
}

{
  const coldFintech = withOffer('fintech', 'fintech_operations_platform');
  const decision = evaluateCommercialReadiness(coldFintech);
  assert.equal(decision.actionableQualificationAllowed, false);
  assert.equal(decision.draftAllowed, false);
  assert.equal(decision.approvalAllowed, false);
  assert.equal(decision.mode, 'research_only');
  assert.equal(decision.status, 'research_only');
  assert.equal(decision.offerVersion, 1);
  assert(decision.blockers.some((item) => /pilot scope and pricing/i.test(item)));
  assert.throws(() => assertCommerciallyReadyForDraft(coldFintech), /commercial draft blocked/i);
  assert.throws(() => assertCommerciallyReadyForApproval(coldFintech), /commercial approval blocked/i);

  const enforced = applyCommercialReadinessToQualification(coldFintech);
  const raw = enforced.rawPayload as Record<string, unknown>;
  const primary = raw.primaryCampaignMatch as Record<string, unknown>;
  assert.equal(primary.disposition, 'research');
  assert.equal(primary.offerVersion, 1);
  assert.equal(primary.qualificationActionable, false);
  assert.equal(enforced.pipelineStatus, 'needs_human_review');
}

{
  const coldPartner = withOffer('delivery-partner', 'managed_software_ai_delivery', 1, 'delivery_partner');
  const decision = assertCommerciallyReadyForApproval(coldPartner);
  assert.equal(decision.actionableQualificationAllowed, true);
  assert.equal(decision.draftAllowed, true);
  assert.equal(decision.approvalAllowed, true);
  assert.equal(decision.mode, 'cold_campaign');
  assert.equal(decision.status, 'outreach_ready_limited');
  assert(decision.prohibitedClaims.some((item) => /unlimited capacity/i.test(item)));
  assert.match(decision.offerName ?? '', /v1/);

  const pin = createOfferReadinessPin(decision, now);
  assert.equal(pin.offerVersion, 1);
  assert.equal(assertOfferReadinessPinCurrent(pin, decision, 'approval'), pin);
}

{
  const warmFintech = withOffer('warm-fintech', 'fintech_operations_platform');
  warmFintech.source = 'linkedin';
  warmFintech.leadType = 'linkedin_warm_post';
  warmFintech.prospectStage = 'warm_lead';
  warmFintech.opportunityStatus = 'live_opportunity';
  const decision = evaluateCommercialReadiness(warmFintech);
  assert.equal(decision.mode, 'research_only');
  assert.equal(decision.draftAllowed, false);
  assert.equal(decision.approvalAllowed, false);
  assert(decision.reasons.some((item) => /research-only/i.test(item)));
}

{
  const stale = withOffer('stale-offer', 'managed_software_ai_delivery', 2, 'delivery_partner');
  const decision = evaluateCommercialReadiness(stale);
  assert.equal(decision.status, 'invalid_offer_version');
  assert.equal(decision.draftAllowed, false);
  assert.equal(decision.approvalAllowed, false);
  assert.match(decision.blockers[0] ?? '', /pinned to offer version 2/i);
}

{
  const unknownCold = withOffer('unknown-offer', 'unknown_offer');
  const decision = evaluateCommercialReadiness(unknownCold);
  assert.equal(decision.approvalAllowed, false);
  assert.equal(decision.status, 'missing_offer');
  assert.match(decision.blockers[0] ?? '', /no approved commercial-readiness profile/i);
}

{
  const unmappedCold = prospect('unmapped');
  const decision = evaluateCommercialReadiness(unmappedCold);
  assert.equal(decision.approvalAllowed, false);
  assert.equal(decision.status, 'missing_offer');
  assert.match(decision.blockers[0] ?? '', /no resolved offer ID/i);
}

{
  const base = OFFER_READINESS.managed_software_ai_delivery!;
  const expected: Record<OfferReadinessStatus, {actionable: boolean; draft: boolean; approval: boolean}> = {
    draft: {actionable: false, draft: false, approval: false},
    research_only: {actionable: false, draft: false, approval: false},
    pilot_ready: {actionable: false, draft: true, approval: false},
    outreach_ready_limited: {actionable: true, draft: true, approval: true},
    outreach_ready: {actionable: true, draft: true, approval: true},
    retired: {actionable: false, draft: false, approval: false},
  };
  for (const [status, policy] of Object.entries(expected) as Array<[OfferReadinessStatus, typeof expected[OfferReadinessStatus]]>) {
    const profile: OfferReadinessProfile = {
      ...base,
      status,
      statusReason: `${status} test state`,
      requiredBeforeOutreach: [`Complete ${status} readiness work.`],
    };
    const decision = evaluateOfferReadinessProfile(profile, {route: 'delivery_partner'});
    assert.equal(decision.actionableQualificationAllowed, policy.actionable, `${status} actionable qualification`);
    assert.equal(decision.draftAllowed, policy.draft, `${status} draft`);
    assert.equal(decision.approvalAllowed, policy.approval, `${status} approval`);
  }
}

{
  const base = OFFER_READINESS.managed_software_ai_delivery!;
  const transitioned = transitionOfferReadiness(base, 'outreach_ready', {
    actor: 'waseem@codistan.org',
    reason: 'Proof, capacity and commercial boundaries were reviewed and approved.',
    occurredAt: '2026-07-31T10:30:00.000Z',
  });
  assert.equal(transitioned.profile.status, 'outreach_ready');
  assert.equal(transitioned.profile.readinessVersion, base.readinessVersion + 1);
  assert.equal(transitioned.auditEvent.priorStatus, 'outreach_ready_limited');
  assert.equal(transitioned.auditEvent.newStatus, 'outreach_ready');
  assert.equal(transitioned.auditEvent.actor, 'waseem@codistan.org');
  assert.throws(() => transitionOfferReadiness(base, 'outreach_ready_limited', {
    actor: 'waseem@codistan.org',
    reason: 'No change.',
  }), /must change the status/i);
  assert.throws(() => transitionOfferReadiness({...base, status: 'retired'}, 'outreach_ready', {
    actor: 'waseem@codistan.org',
    reason: 'Invalid direct reactivation.',
  }), /invalid offer readiness transition/i);
}

{
  const currentDecision = evaluateCommercialReadiness(withOffer('pin-current', 'managed_software_ai_delivery', 1, 'delivery_partner'));
  const pin = createOfferReadinessPin(currentDecision, now);
  const changedDecision = {...currentDecision, readinessVersion: (currentDecision.readinessVersion ?? 0) + 1};
  assert.throws(() => assertOfferReadinessPinCurrent(pin, changedDecision, 'approval'), /changed after the draft was created/i);
  assert.throws(() => assertOfferReadinessPinCurrent(undefined, currentDecision, 'approval'), /pin is missing/i);
}

assert.equal(OFFER_READINESS.fintech_operations_platform?.status, 'research_only');
assert.equal(OFFER_READINESS.managed_software_ai_delivery?.status, 'outreach_ready_limited');

console.log('Commercial offer readiness tests passed.');
