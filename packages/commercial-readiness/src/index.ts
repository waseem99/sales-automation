import type { Lead } from '@sales-automation/shared';

export const COMMERCIAL_READINESS_VERSION = 'commercial-readiness.v2';

export type OfferReadinessStatus =
  | 'draft'
  | 'research_only'
  | 'pilot_ready'
  | 'outreach_ready_limited'
  | 'outreach_ready'
  | 'retired';
export type CommercialApprovalMode = 'warm_response' | 'cold_campaign' | 'pilot_only' | 'research_only';
export type CommercialReadinessAction = 'qualification' | 'draft' | 'approval';
export type QualificationDisposition = 'blocked' | 'research_only' | 'pilot_only' | 'actionable';
export type ApprovedRoute = 'direct_buyer' | 'channel_partner' | 'delivery_partner' | 'referral_partner';

export interface OfferReadinessProfile {
  offerId: string;
  offerVersion: number;
  readinessVersion: number;
  offerName: string;
  owner: string;
  status: OfferReadinessStatus;
  statusReason: string;
  approvedRoutes: ApprovedRoute[];
  requiredBeforeOutreach: string[];
  approvedClaims: string[];
  prohibitedClaims: string[];
  proofLimitations: string[];
  pricingPosition: string;
  lastReviewedAt: string;
}

export interface OfferReadinessPin {
  commercialReadinessVersion: typeof COMMERCIAL_READINESS_VERSION;
  offerId: string;
  offerVersion: number;
  readinessVersion: number;
  readinessStatus: OfferReadinessStatus;
  pinnedAt: string;
}

export interface CommercialReadinessDecision {
  version: typeof COMMERCIAL_READINESS_VERSION;
  qualificationAllowed: boolean;
  actionableQualificationAllowed: boolean;
  draftAllowed: boolean;
  approvalAllowed: boolean;
  allowedActions: CommercialReadinessAction[];
  qualificationDisposition: QualificationDisposition;
  mode: CommercialApprovalMode;
  offerId?: string;
  offerVersion?: number;
  readinessVersion?: number;
  offerName?: string;
  canonicalOfferName?: string;
  status: OfferReadinessStatus | 'missing_offer' | 'invalid_offer_version';
  reasons: string[];
  blockers: string[];
  approvedClaims: string[];
  prohibitedClaims: string[];
  proofLimitations: string[];
  humanReviewRequired: true;
}

export interface OfferReadinessAuditEvent {
  id: string;
  offerId: string;
  offerVersion: number;
  priorStatus: OfferReadinessStatus;
  newStatus: OfferReadinessStatus;
  priorReadinessVersion: number;
  newReadinessVersion: number;
  actor: string;
  reason: string;
  occurredAt: string;
}

const REVIEWED_AT = '2026-07-27T00:00:00.000Z';

const STATUS_POLICY: Record<OfferReadinessStatus, {
  qualificationAllowed: boolean;
  actionableQualificationAllowed: boolean;
  draftAllowed: boolean;
  approvalAllowed: boolean;
  disposition: QualificationDisposition;
}> = {
  draft: {
    qualificationAllowed: true,
    actionableQualificationAllowed: false,
    draftAllowed: false,
    approvalAllowed: false,
    disposition: 'research_only',
  },
  research_only: {
    qualificationAllowed: true,
    actionableQualificationAllowed: false,
    draftAllowed: false,
    approvalAllowed: false,
    disposition: 'research_only',
  },
  pilot_ready: {
    qualificationAllowed: true,
    actionableQualificationAllowed: false,
    draftAllowed: true,
    approvalAllowed: false,
    disposition: 'pilot_only',
  },
  outreach_ready_limited: {
    qualificationAllowed: true,
    actionableQualificationAllowed: true,
    draftAllowed: true,
    approvalAllowed: true,
    disposition: 'actionable',
  },
  outreach_ready: {
    qualificationAllowed: true,
    actionableQualificationAllowed: true,
    draftAllowed: true,
    approvalAllowed: true,
    disposition: 'actionable',
  },
  retired: {
    qualificationAllowed: false,
    actionableQualificationAllowed: false,
    draftAllowed: false,
    approvalAllowed: false,
    disposition: 'blocked',
  },
};

const ALLOWED_TRANSITIONS: Record<OfferReadinessStatus, OfferReadinessStatus[]> = {
  draft: ['research_only', 'pilot_ready', 'retired'],
  research_only: ['draft', 'pilot_ready', 'retired'],
  pilot_ready: ['research_only', 'outreach_ready_limited', 'outreach_ready', 'retired'],
  outreach_ready_limited: ['research_only', 'pilot_ready', 'outreach_ready', 'retired'],
  outreach_ready: ['research_only', 'pilot_ready', 'outreach_ready_limited', 'retired'],
  retired: ['draft'],
};

export const OFFER_READINESS: Record<string, OfferReadinessProfile> = {
  fintech_operations_platform: {
    offerId: 'fintech_operations_platform',
    offerVersion: 1,
    readinessVersion: 1,
    offerName: 'FinTech Backend Operations Platform',
    owner: 'Waseem',
    status: 'research_only',
    statusReason: 'The product scope, pilot proof, pricing and regulated-domain claims are not approved for outreach.',
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
    offerVersion: 1,
    readinessVersion: 1,
    offerName: 'Managed Software and AI Delivery Partnership',
    owner: 'Waseem',
    status: 'outreach_ready_limited',
    statusReason: 'Human-reviewed outreach is allowed within verified capability, proof, capacity and commercial limits.',
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
  const context = offerContextFromLead(lead);
  if (!context.offerId) {
    return missingOfferDecision('The record has no resolved offer ID and cannot create an actionable qualification, draft or approval.');
  }
  const profile = OFFER_READINESS[context.offerId];
  if (!profile) {
    return missingOfferDecision(`Offer ${context.offerId} has no approved commercial-readiness profile.`, context.offerId);
  }
  return evaluateOfferReadinessProfile(profile, {
    warm,
    route: context.route,
    observedOfferVersion: context.offerVersion,
  });
}

export function evaluateOfferReadinessProfile(
  profile: OfferReadinessProfile,
  input: {warm?: boolean; route?: ApprovedRoute; observedOfferVersion?: number} = {},
): CommercialReadinessDecision {
  if (input.observedOfferVersion !== undefined && input.observedOfferVersion !== profile.offerVersion) {
    return decisionFromProfile(profile, {
      qualificationAllowed: true,
      actionableQualificationAllowed: false,
      draftAllowed: false,
      approvalAllowed: false,
      disposition: 'research_only',
    }, input.warm === true, [
      `The record is pinned to offer version ${input.observedOfferVersion}, but the approved profile is version ${profile.offerVersion}. Create a fresh recommendation before drafting or approval.`,
    ], 'invalid_offer_version');
  }

  const policy = STATUS_POLICY[profile.status];
  const routeBlocked = Boolean(input.route && !profile.approvedRoutes.includes(input.route));
  const blockers = [
    ...(policy.approvalAllowed ? [] : [profile.statusReason, ...profile.requiredBeforeOutreach]),
    ...(routeBlocked && input.route ? [`The ${input.route.replaceAll('_', ' ')} route is not approved for this offer.`] : []),
  ];
  const effectivePolicy = routeBlocked
    ? {
        qualificationAllowed: true,
        actionableQualificationAllowed: false,
        draftAllowed: false,
        approvalAllowed: false,
        disposition: 'research_only' as const,
      }
    : policy;
  return decisionFromProfile(profile, effectivePolicy, input.warm === true, blockers, profile.status);
}

export function applyCommercialReadinessToQualification(lead: Lead): Lead {
  const decision = evaluateCommercialReadiness(lead);
  const raw = asRecord(lead.rawPayload);
  const campaignMatches = Array.isArray(raw.campaignMatches)
    ? raw.campaignMatches.map((value) => enrichRecommendation(asRecord(value), decision))
    : [];
  const primaryCampaignMatch = Object.keys(asRecord(raw.primaryCampaignMatch)).length > 0
    ? enrichRecommendation(asRecord(raw.primaryCampaignMatch), decision)
    : null;
  const pipelineStatus = !decision.actionableQualificationAllowed && lead.pipelineStatus === 'draft_ready'
    ? 'needs_human_review'
    : lead.pipelineStatus;
  return {
    ...lead,
    pipelineStatus,
    rawPayload: {
      ...raw,
      campaignMatches,
      primaryCampaignMatch,
      commercialReadinessVersion: COMMERCIAL_READINESS_VERSION,
      commercialReadinessDecision: decision,
    },
  };
}

export function assertCommerciallyReadyForDraft(lead: Lead): CommercialReadinessDecision {
  const decision = evaluateCommercialReadiness(lead);
  if (!decision.draftAllowed) {
    throw new Error(`Commercial draft blocked: ${decision.blockers.join(' ') || 'The offer is not approved for drafting.'}`);
  }
  return decision;
}

export function assertCommerciallyReadyForApproval(lead: Lead): CommercialReadinessDecision {
  const decision = evaluateCommercialReadiness(lead);
  if (!decision.approvalAllowed) {
    throw new Error(`Commercial approval blocked: ${decision.blockers.join(' ') || 'The offer is not approved for outreach.'}`);
  }
  return decision;
}

export function createOfferReadinessPin(
  decision: CommercialReadinessDecision,
  pinnedAt = new Date().toISOString(),
): OfferReadinessPin {
  if (!decision.offerId || !decision.offerVersion || !decision.readinessVersion || !isReadinessStatus(decision.status)) {
    throw new Error('Offer readiness pin cannot be created without a valid offer ID, offer version and readiness state.');
  }
  return {
    commercialReadinessVersion: COMMERCIAL_READINESS_VERSION,
    offerId: decision.offerId,
    offerVersion: decision.offerVersion,
    readinessVersion: decision.readinessVersion,
    readinessStatus: decision.status,
    pinnedAt: validIso(pinnedAt, 'pinnedAt'),
  };
}

export function assertOfferReadinessPinCurrent(
  pin: OfferReadinessPin | undefined,
  decision: CommercialReadinessDecision,
  action: 'draft' | 'approval',
): OfferReadinessPin {
  if (!pin) throw new Error('Offer readiness pin is missing. Create a fresh draft from the current approved offer version.');
  if (pin.commercialReadinessVersion !== COMMERCIAL_READINESS_VERSION) {
    throw new Error('Offer readiness pin uses an unsupported policy version. Create a fresh draft.');
  }
  if (!decision.offerId || !decision.offerVersion || !decision.readinessVersion || !isReadinessStatus(decision.status)) {
    throw new Error('Current offer readiness evidence is incomplete.');
  }
  if (
    pin.offerId !== decision.offerId
    || pin.offerVersion !== decision.offerVersion
    || pin.readinessVersion !== decision.readinessVersion
    || pin.readinessStatus !== decision.status
  ) {
    throw new Error('Offer readiness or offer version changed after the draft was created. Create a fresh draft before continuing.');
  }
  if (action === 'draft' && !decision.draftAllowed) throw new Error('Commercial draft blocked by the current offer readiness state.');
  if (action === 'approval' && !decision.approvalAllowed) throw new Error('Commercial approval blocked by the current offer readiness state.');
  return pin;
}

export function transitionOfferReadiness(
  profile: OfferReadinessProfile,
  nextStatus: OfferReadinessStatus,
  input: {actor: string; reason: string; occurredAt?: string},
): {profile: OfferReadinessProfile; auditEvent: OfferReadinessAuditEvent} {
  const actor = requiredText(input.actor, 'actor');
  const reason = requiredText(input.reason, 'reason');
  const occurredAt = validIso(input.occurredAt ?? new Date().toISOString(), 'occurredAt');
  if (profile.status === nextStatus) throw new Error('Offer readiness transition must change the status.');
  if (!ALLOWED_TRANSITIONS[profile.status].includes(nextStatus)) {
    throw new Error(`Invalid offer readiness transition: ${profile.status} -> ${nextStatus}.`);
  }
  const newReadinessVersion = profile.readinessVersion + 1;
  const auditEvent: OfferReadinessAuditEvent = {
    id: `offer-readiness-${profile.offerId}-v${profile.offerVersion}-r${newReadinessVersion}`,
    offerId: profile.offerId,
    offerVersion: profile.offerVersion,
    priorStatus: profile.status,
    newStatus: nextStatus,
    priorReadinessVersion: profile.readinessVersion,
    newReadinessVersion,
    actor,
    reason,
    occurredAt,
  };
  return {
    profile: {
      ...profile,
      status: nextStatus,
      statusReason: reason,
      readinessVersion: newReadinessVersion,
      lastReviewedAt: occurredAt,
    },
    auditEvent,
  };
}

function decisionFromProfile(
  profile: OfferReadinessProfile,
  policy: {
    qualificationAllowed: boolean;
    actionableQualificationAllowed: boolean;
    draftAllowed: boolean;
    approvalAllowed: boolean;
    disposition: QualificationDisposition;
  },
  warm: boolean,
  blockers: string[],
  status: CommercialReadinessDecision['status'],
): CommercialReadinessDecision {
  const allowedActions: CommercialReadinessAction[] = [];
  if (policy.qualificationAllowed) allowedActions.push('qualification');
  if (policy.draftAllowed) allowedActions.push('draft');
  if (policy.approvalAllowed) allowedActions.push('approval');
  const mode: CommercialApprovalMode = policy.approvalAllowed
    ? (warm ? 'warm_response' : 'cold_campaign')
    : profile.status === 'pilot_ready'
      ? 'pilot_only'
      : 'research_only';
  const reasons = [
    `Offer ${profile.offerId} is pinned to immutable version ${profile.offerVersion} and readiness revision ${profile.readinessVersion}.`,
    profile.statusReason,
    policy.actionableQualificationAllowed
      ? 'The record may be treated as commercially actionable after human review.'
      : policy.draftAllowed
        ? 'The record may support pilot preparation, but it is not approved for external outreach.'
        : 'The record remains research-only and cannot produce an outreach-ready draft or approval.',
  ];
  return {
    version: COMMERCIAL_READINESS_VERSION,
    qualificationAllowed: policy.qualificationAllowed,
    actionableQualificationAllowed: policy.actionableQualificationAllowed,
    draftAllowed: policy.draftAllowed,
    approvalAllowed: policy.approvalAllowed,
    allowedActions,
    qualificationDisposition: policy.disposition,
    mode,
    offerId: profile.offerId,
    offerVersion: profile.offerVersion,
    readinessVersion: profile.readinessVersion,
    offerName: `${profile.offerName} · v${profile.offerVersion}`,
    canonicalOfferName: profile.offerName,
    status,
    reasons,
    blockers: unique(blockers),
    approvedClaims: profile.approvedClaims,
    prohibitedClaims: profile.prohibitedClaims,
    proofLimitations: profile.proofLimitations,
    humanReviewRequired: true,
  };
}

function missingOfferDecision(message: string, offerId?: string): CommercialReadinessDecision {
  return {
    version: COMMERCIAL_READINESS_VERSION,
    qualificationAllowed: true,
    actionableQualificationAllowed: false,
    draftAllowed: false,
    approvalAllowed: false,
    allowedActions: ['qualification'],
    qualificationDisposition: 'research_only',
    mode: 'research_only',
    offerId,
    status: 'missing_offer',
    reasons: ['Research may continue, but actionable qualification, drafting and approval are blocked.'],
    blockers: [message],
    approvedClaims: [],
    prohibitedClaims: ['Do not approve outreach without a versioned, approved offer-readiness profile.'],
    proofLimitations: [],
    humanReviewRequired: true,
  };
}

function enrichRecommendation(
  recommendation: Record<string, unknown>,
  decision: CommercialReadinessDecision,
): Record<string, unknown> {
  const sameOffer = !decision.offerId || text(recommendation.offerId) === decision.offerId;
  if (!sameOffer) return recommendation;
  const originalDisposition = text(recommendation.disposition);
  const downgraded = !decision.actionableQualificationAllowed && ['priority_a', 'priority_b'].includes(originalDisposition ?? '');
  return {
    ...recommendation,
    offerVersion: decision.offerVersion ?? null,
    readinessVersion: decision.readinessVersion ?? null,
    commercialReadinessVersion: COMMERCIAL_READINESS_VERSION,
    commercialReadinessStatus: decision.status,
    qualificationActionable: decision.actionableQualificationAllowed,
    readinessBlockers: decision.blockers,
    disposition: downgraded ? 'research' : recommendation.disposition,
    risks: unique([
      ...stringArray(recommendation.risks),
      ...(!decision.actionableQualificationAllowed ? decision.blockers : []),
    ]),
    nextResearchAction: downgraded
      ? decision.blockers[0] ?? 'Complete offer readiness before treating this recommendation as actionable.'
      : recommendation.nextResearchAction,
  };
}

function offerContextFromLead(lead: Lead): {offerId?: string; offerVersion?: number; route?: ApprovedRoute} {
  const raw = asRecord(lead.rawPayload);
  const primary = asRecord(raw.primaryCampaignMatch);
  const direct = contextFromMatch(primary);
  if (direct.offerId) return direct;
  const matches = Array.isArray(raw.campaignMatches) ? raw.campaignMatches : [];
  for (const match of matches) {
    const candidate = contextFromMatch(asRecord(match));
    if (candidate.offerId) return candidate;
  }
  return {};
}

function contextFromMatch(value: Record<string, unknown>): {offerId?: string; offerVersion?: number; route?: ApprovedRoute} {
  const route = text(value.route);
  const version = positiveInteger(value.offerVersion);
  return {
    offerId: text(value.offerId),
    offerVersion: version,
    route: isApprovedRoute(route) ? route : undefined,
  };
}

function isApprovedRoute(value: string | undefined): value is ApprovedRoute {
  return ['direct_buyer', 'channel_partner', 'delivery_partner', 'referral_partner'].includes(value ?? '');
}

function isReadinessStatus(value: CommercialReadinessDecision['status']): value is OfferReadinessStatus {
  return ['draft', 'research_only', 'pilot_ready', 'outreach_ready_limited', 'outreach_ready', 'retired'].includes(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function validIso(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date.`);
  return parsed.toISOString();
}
