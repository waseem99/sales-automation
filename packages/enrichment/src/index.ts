import type { Lead, QualificationStatus } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

export type EnrichmentProvider =
  | 'manual_research'
  | 'company_website'
  | 'google_search'
  | 'linkedin_manual_review'
  | 'sales_navigator_manual_review'
  | 'paid_data_provider'
  | 'crm_import';

export type EnrichmentField =
  | 'company_domain'
  | 'company_size'
  | 'industry'
  | 'country'
  | 'contact_name'
  | 'contact_role'
  | 'business_email'
  | 'linkedin_profile_url'
  | 'company_linkedin_url'
  | 'phone'
  | 'crm_account_id';

export type EnrichmentVerificationStatus = 'unverified' | 'needs_human_review' | 'verified' | 'rejected';

export interface EnrichmentEvidence {
  field: EnrichmentField;
  value: string;
  provider: EnrichmentProvider;
  sourceUrl?: string;
  confidence: number;
  costCents: number;
  verifiedBy?: string;
  verifiedAt?: string;
  verificationStatus: EnrichmentVerificationStatus;
  notes?: string;
}

export interface EnrichmentPolicy {
  enabled: boolean;
  paidEnrichmentEnabled: boolean;
  monthlyBudgetCents: number;
  spentThisMonthCents: number;
  minLeadScoreForPaidEnrichment: number;
  allowPaidForStatuses: QualificationStatus[];
  requireHumanVerificationBeforeOutreach: boolean;
}

export interface EnrichmentPlanInput {
  record: StoredLeadRecord;
  policy?: Partial<EnrichmentPolicy>;
  requestedFields?: EnrichmentField[];
  provider?: EnrichmentProvider;
  estimatedCostCents?: number;
}

export interface EnrichmentPlan {
  allowed: boolean;
  paidAllowed: boolean;
  provider: EnrichmentProvider;
  requestedFields: EnrichmentField[];
  estimatedCostCents: number;
  reasons: string[];
  blockedReasons: string[];
  requiresHumanVerification: boolean;
  recommendedNextAction: string;
}

export interface EnrichmentSummary {
  totalFields: number;
  verifiedFields: number;
  rejectedFields: number;
  needsHumanReviewFields: number;
  paidCostCents: number;
  hasVerifiedBusinessEmail: boolean;
  outreachReady: boolean;
}

export const defaultEnrichmentPolicy: EnrichmentPolicy = {
  enabled: true,
  paidEnrichmentEnabled: false,
  monthlyBudgetCents: 0,
  spentThisMonthCents: 0,
  minLeadScoreForPaidEnrichment: 70,
  allowPaidForStatuses: ['hot', 'qualified'],
  requireHumanVerificationBeforeOutreach: true,
};

export const defaultRequestedFields: EnrichmentField[] = [
  'company_domain',
  'industry',
  'country',
  'contact_name',
  'contact_role',
  'business_email',
  'linkedin_profile_url',
];

export function planEnrichment(input: EnrichmentPlanInput): EnrichmentPlan {
  const policy = { ...defaultEnrichmentPolicy, ...input.policy };
  const requestedFields = input.requestedFields?.length ? input.requestedFields : defaultRequestedFields;
  const provider = input.provider ?? 'manual_research';
  const estimatedCostCents = input.estimatedCostCents ?? 0;
  const reasons: string[] = [];
  const blockedReasons: string[] = [];
  const leadScore = input.record.latestEvaluation?.score.total ?? input.record.lead.score?.total ?? 0;
  const qualificationStatus = getQualificationStatus(input.record.lead, input.record.latestEvaluation?.score.status);
  const isPaidProvider = provider === 'paid_data_provider' || estimatedCostCents > 0;

  if (!policy.enabled) {
    blockedReasons.push('Enrichment is disabled by policy.');
  }

  if (input.record.lead.pipelineStatus === 'rejected') {
    blockedReasons.push('Rejected leads must not be enriched.');
  }

  if (isPaidProvider && !policy.paidEnrichmentEnabled) {
    blockedReasons.push('Paid enrichment is disabled by policy.');
  }

  if (isPaidProvider && leadScore < policy.minLeadScoreForPaidEnrichment) {
    blockedReasons.push(`Lead score ${leadScore} is below paid enrichment minimum ${policy.minLeadScoreForPaidEnrichment}.`);
  }

  if (isPaidProvider && !policy.allowPaidForStatuses.includes(qualificationStatus)) {
    blockedReasons.push(`Paid enrichment is not allowed for ${qualificationStatus} leads.`);
  }

  if (isPaidProvider && policy.spentThisMonthCents + estimatedCostCents > policy.monthlyBudgetCents) {
    blockedReasons.push('Paid enrichment would exceed the monthly budget.');
  }

  if (!isPaidProvider) {
    reasons.push('Manual/free enrichment is allowed when source evidence is retained.');
  }

  if (requestedFields.includes('business_email')) {
    reasons.push('Business contact enrichment requires human verification before outreach.');
  }

  const allowed = blockedReasons.length === 0;
  return {
    allowed,
    paidAllowed: allowed && isPaidProvider,
    provider,
    requestedFields,
    estimatedCostCents,
    reasons,
    blockedReasons,
    requiresHumanVerification: policy.requireHumanVerificationBeforeOutreach,
    recommendedNextAction: allowed
      ? 'Collect enrichment evidence with source URL, confidence, cost, and human verification status.'
      : 'Do not enrich this lead until policy blockers are resolved.',
  };
}

export function createEnrichmentEvidence(input: Omit<EnrichmentEvidence, 'verificationStatus'> & { verificationStatus?: EnrichmentVerificationStatus }): EnrichmentEvidence {
  if (!input.value.trim()) {
    throw new Error('Enrichment value is required.');
  }
  if (input.confidence < 0 || input.confidence > 1) {
    throw new Error('Confidence must be between 0 and 1.');
  }
  if (input.costCents < 0) {
    throw new Error('Cost cannot be negative.');
  }
  return {
    ...input,
    value: input.value.trim(),
    verificationStatus: input.verificationStatus ?? 'needs_human_review',
  };
}

export function verifyEnrichmentEvidence(
  evidence: EnrichmentEvidence,
  verifier: string,
  verifiedAt = new Date().toISOString(),
): EnrichmentEvidence {
  if (!verifier.trim()) {
    throw new Error('Verifier is required.');
  }
  return {
    ...evidence,
    verifiedBy: verifier.trim(),
    verifiedAt,
    verificationStatus: 'verified',
  };
}

export function rejectEnrichmentEvidence(evidence: EnrichmentEvidence, reviewer: string, notes: string): EnrichmentEvidence {
  if (!reviewer.trim()) {
    throw new Error('Reviewer is required.');
  }
  return {
    ...evidence,
    verifiedBy: reviewer.trim(),
    verifiedAt: new Date().toISOString(),
    verificationStatus: 'rejected',
    notes: notes.trim() || evidence.notes,
  };
}

export function summarizeEnrichment(evidence: EnrichmentEvidence[], requireHumanVerification = true): EnrichmentSummary {
  const verifiedFields = evidence.filter((item) => item.verificationStatus === 'verified').length;
  const rejectedFields = evidence.filter((item) => item.verificationStatus === 'rejected').length;
  const needsHumanReviewFields = evidence.filter((item) => item.verificationStatus === 'needs_human_review' || item.verificationStatus === 'unverified').length;
  const hasVerifiedBusinessEmail = evidence.some((item) => item.field === 'business_email' && item.verificationStatus === 'verified');
  return {
    totalFields: evidence.length,
    verifiedFields,
    rejectedFields,
    needsHumanReviewFields,
    paidCostCents: evidence.reduce((total, item) => total + item.costCents, 0),
    hasVerifiedBusinessEmail,
    outreachReady: requireHumanVerification ? hasVerifiedBusinessEmail && needsHumanReviewFields === 0 : hasVerifiedBusinessEmail,
  };
}

export function appendEnrichmentAuditMetadata(
  record: StoredLeadRecord,
  evidence: EnrichmentEvidence[],
  actor = 'enrichment',
): StoredLeadRecord {
  const summary = summarizeEnrichment(evidence);
  record.auditLog.push({
    id: `${record.lead.id}-${record.auditLog.length + 1}`,
    leadId: record.lead.id,
    action: 'note_added',
    actor,
    message: 'Enrichment evidence captured.',
    createdAt: new Date().toISOString(),
    metadata: {
      enrichmentEvidence: evidence,
      enrichmentSummary: summary,
    },
  });
  return record;
}

function getQualificationStatus(lead: Lead, evaluationStatus?: QualificationStatus): QualificationStatus {
  return evaluationStatus ?? lead.score?.status ?? 'nurture';
}
