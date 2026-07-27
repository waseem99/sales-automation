import type { Lead } from '@sales-automation/shared';

export const COMMERCIAL_READINESS_VERSION = 'commercial-readiness.v1';

export type OfferReadinessStatus = 'research_only' | 'outreach_ready_limited' | 'outreach_ready' | 'on_hold';
export type CommercialApprovalMode = 'warm_response' | 'cold_campaign' | 'research_only';

export interface OfferReadinessProfile {
  offerId: string;
  offerName: string;
  owner: string;
  status: OfferReadinessStatus;
  approvedRoutes: Array<'direct_buyer' | 'channel_partner' | 'delivery_partner' | 'referral_partner'>;
  requiredBeforeOutreach: string[];
  approvedClaims: string[];
  prohibitedClaims: string[];
  proofLimitations: string[];
  pricingPosition: string;
  lastReviewedAt: string;
}

export interface CommercialReadinessDecision {
  version: typeof COMMERCIAL_READINESS_VERSION;
  approvalAllowed: boolean;
  mode: CommercialApprovalMode;
  offerId?: string;
  offerName?: string;
  status: OfferReadinessStatus | 'warm_opportunity' | 'missing_offer';
  reasons: string[];
  blockers: string[];
  approvedClaims: string[];
  prohibitedClaims: string[];
  proofLimitations: string[];
  humanReviewRequired: true;
}

const REVIEWED_AT = '2026-07-27T00:00:00.000Z';

export const OFFER_READINESS: Record<string, OfferReadinessProfile> = {
  fintech_operations_platform: {
    offerId: 'fintech_operations_platform',
    offerName: 'FinTech Backend Operations Platform',
    owner: 'Waseem',
    status: 'research_only',
    approvedRoutes: ['direct_buyer', 'channel_partner', 'referral_partner'],
    requiredBeforeOutreach: [
      'Define the exact operational workflows, user roles and measurable pilot outcome.',
      'Approve a demo, screenshots or architecture that can be shown externally.',
      'Define supported integrations, deployment boundaries and implementation assumptions.',
      'Approve a pilot scope and pricing hypothesis.',
      'Approve financial-services proof or conservative proxy proof with explicit limitations.',
      'Approve security, privacy and compliance statements that may be used externally.',
    ],
    approvedClaims: [
      'Codistan can explore a modular backend-operations and managed implementation approach.',
      'AI-assisted workflow support can be designed with auditable human controls.',
      'Exact workflows, integrations, pricing and deployment require discovery.',
    ],
    prohibitedClaims: [
      'Do not claim an existing bank deployment unless verified.',
      'Do not claim regulatory approval, guaranteed savings or autonomous financial decisions.',
      'Do not claim a production-ready banking product until the approved demo and scope exist.',
    ],
    proofLimitations: [
      'Telecom and workflow-automation delivery may be used only as adjacent product-delivery evidence.',
      'Private RAG capability is not proof of banking certification or regulated production use.',
    ],
    pricingPosition: 'Research and discovery only until a pilot scope and commercial range are approved.',
    lastReviewedAt: REVIEWED_AT,
  },
  managed_software_ai_delivery: {
    offerId: 'managed_software_ai_delivery',
    offerName: 'Managed Software and AI Delivery Partnership',
    owner: 'Waseem',
    status: 'outreach_ready_limited',
    approvedRoutes: ['direct_buyer', 'channel_partner', 'delivery_partner', 'referral_partner'],
    requiredBeforeOutreach: [
      'Confirm that the proposed delivery lane matches currently available Codistan capability.',
      'Select proof relevant to the prospect rather than presenting the full agency portfolio.',
      'Confirm mobilisation timing and team availability before making a commitment.',
      'Keep white-label, NDA, ownership and client-contact boundaries subject to human approval.',
    ],
    approvedClaims: [
      'Codistan can explore accountable managed delivery, white-label or overflow support.',
      'Engagement may use a managed pod, project, retainer or dedicated-team model after discovery.',
      'Codistan can combine Pakistan-based delivery efficiency with project and quality management.',
    ],
    prohibitedClaims: [
      'Do not promise unlimited capacity or immediate mobilisation without resource confirmation.',
      'Do not present inferred overflow pressure as a confirmed client problem.',
      'Do not promise a technology, certification, geography or delivery model without verified capability.',
    ],
    proofLimitations: [
      'Use only proof relevant to the requested delivery lane.',
      'Do not present one client engagement as evidence for an unrelated regulated or specialist domain.',
    ],
    pricingPosition: 'Commercial structure is approved for discussion, but scope, team, timeline and price require human confirmation.',
    lastReviewedAt: REVIEWED_AT,
  },
};

export function evaluateCommercialReadiness(lead: Lead): CommercialReadinessDecision {
  const warm = lead.opportunityStatus === 'live_opportunity' || lead.prospectStage === 'warm_lead';
  const offerId = offerIdFromLead(lead);
  const profile = offerId ? OFFER_READINESS[offerId] : undefined;

  if (warm) {
    return {
      version: COMMERCIAL_READINESS_VERSION,
      approvalAllowed: true,
      mode: 'warm_response',
      offerId,
      offerName: profile?.offerName,
      status: 'warm_opportunity',
      reasons: [
        'A separate warm-demand record exists, so a human may respond to the verified requirement.',
        profile?.status === 'research_only'
          ? 'The associated product offer is research-only; the response must stay within verified service capability and must not present the product as ready.'
          : 'Any offer-specific commitments still require human verification.',
      ],
      blockers: [],
      approvedClaims: profile?.approvedClaims ?? [],
      prohibitedClaims: profile?.prohibitedClaims ?? ['Do not make unsupported capability, proof, pricing or delivery claims.'],
      proofLimitations: profile?.proofLimitations ?? [],
      humanReviewRequired: true,
    };
  }

  if (!offerId) {
    return blocked('missing_offer', undefined, undefined, [
      'The cold prospect has no resolved offer ID. Complete campaign and offer mapping before approving outreach.',
    ]);
  }

  if (!profile) {
    return blocked('missing_offer', offerId, undefined, [
      `Offer ${offerId} has no approved commercial-readiness profile.`,
    ]);
  }

  if (profile.status === 'research_only' || profile.status === 'on_hold') {
    return blocked(profile.status, profile.offerId, profile.offerName, profile.requiredBeforeOutreach, profile);
  }

  const route = routeFromLead(lead);
  if (route && !profile.approvedRoutes.includes(route)) {
    return blocked(profile.status, profile.offerId, profile.offerName, [
      `The ${route.replaceAll('_', ' ')} route is not approved for this offer.`,
    ], profile);
  }

  return {
    version: COMMERCIAL_READINESS_VERSION,
    approvalAllowed: true,
    mode: 'cold_campaign',
    offerId: profile.offerId,
    offerName: profile.offerName,
    status: profile.status,
    reasons: [
      profile.status === 'outreach_ready_limited'
        ? 'Cold outreach may be approved only within the documented claims, proof and capacity limits.'
        : 'The offer is approved for human-reviewed cold outreach.',
    ],
    blockers: [],
    approvedClaims: profile.approvedClaims,
    prohibitedClaims: profile.prohibitedClaims,
    proofLimitations: profile.proofLimitations,
    humanReviewRequired: true,
  };
}

export function assertCommerciallyReadyForApproval(lead: Lead): CommercialReadinessDecision {
  const decision = evaluateCommercialReadiness(lead);
  if (!decision.approvalAllowed) {
    throw new Error(`Commercial approval blocked: ${decision.blockers.join(' ')}`);
  }
  return decision;
}

function blocked(
  status: CommercialReadinessDecision['status'],
  offerId: string | undefined,
  offerName: string | undefined,
  blockers: string[],
  profile?: OfferReadinessProfile,
): CommercialReadinessDecision {
  return {
    version: COMMERCIAL_READINESS_VERSION,
    approvalAllowed: false,
    mode: 'research_only',
    offerId,
    offerName,
    status,
    reasons: ['Research and offer completion may continue, but external outreach approval is blocked.'],
    blockers,
    approvedClaims: profile?.approvedClaims ?? [],
    prohibitedClaims: profile?.prohibitedClaims ?? ['Do not approve cold outreach without an approved offer.'],
    proofLimitations: profile?.proofLimitations ?? [],
    humanReviewRequired: true,
  };
}

function offerIdFromLead(lead: Lead): string | undefined {
  const raw = asRecord(lead.rawPayload);
  const primary = asRecord(raw.primaryCampaignMatch);
  const direct = text(primary.offerId);
  if (direct) return direct;
  const matches = Array.isArray(raw.campaignMatches) ? raw.campaignMatches : [];
  for (const match of matches) {
    const offerId = text(asRecord(match).offerId);
    if (offerId) return offerId;
  }
  return undefined;
}

function routeFromLead(lead: Lead): OfferReadinessProfile['approvedRoutes'][number] | undefined {
  const raw = asRecord(lead.rawPayload);
  const primary = asRecord(raw.primaryCampaignMatch);
  const value = text(primary.route);
  return ['direct_buyer', 'channel_partner', 'delivery_partner', 'referral_partner'].includes(value ?? '')
    ? value as OfferReadinessProfile['approvedRoutes'][number]
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
