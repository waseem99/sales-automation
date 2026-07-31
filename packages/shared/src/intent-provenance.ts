import type {Lead} from './types.js';

export const INTENT_PROVENANCE_VERSION = 'intent-provenance.v1';
export const COLD_NO_CONFIRMED_INTENT_WARNING = 'Cold prospect from Sales Navigator — no confirmed buying intent. Fit, role and account evidence must not be presented as a buyer-authored need.';

export type IntentEvidenceClassification = 'cold_no_confirmed_intent' | 'warm_buyer_authored_demand' | 'non_intent_evidence';
export type IntentEvidenceStatus = 'valid' | 'stale' | 'invalid';
export type EffectiveIntentInterpretation = 'cold_only' | 'linked_warm_evidence' | 'warm_buyer_authored' | 'no_confirmed_intent';

export interface IntentEvidenceReference {
  leadId: string;
  source: Lead['source'];
  sourceUrl?: string;
  classification: IntentEvidenceClassification;
  status: IntentEvidenceStatus;
  observedAt: string;
  reason: string;
  buyerIntentConfirmedByThisEvidence: boolean;
}

export interface LeadIntentProvenance {
  version: typeof INTENT_PROVENANCE_VERSION;
  evaluatedAt: string;
  baseClassification: IntentEvidenceClassification;
  sourceBuyerIntentConfirmed: boolean;
  linkedWarmIntentConfirmed: boolean;
  effectiveInterpretation: EffectiveIntentInterpretation;
  warning?: string;
  coldSourceHistory: IntentEvidenceReference[];
  warmEvidence: IntentEvidenceReference[];
  invalidOrStaleWarmEvidence: IntentEvidenceReference[];
  originalSourceClassificationPreserved: true;
  humanReviewRequired: true;
  externalActionAutomated: false;
}

export function isSalesNavigatorCold(lead: Lead): boolean {
  return lead.source === 'sales_navigator'
    || lead.leadType === 'sales_navigator_cold_prospect'
    || lead.leadType === 'linkedin_cold_prospect';
}

export function classifyIntentEvidence(
  lead: Lead,
  evaluatedAt = new Date().toISOString(),
): IntentEvidenceReference {
  const observedAt = validIso(lead.discoveredAt ?? lead.capturedAt) ?? validIso(evaluatedAt) ?? new Date().toISOString();
  const sourceUrl = lead.evidenceUrl ?? lead.sourceUrl;
  if (isSalesNavigatorCold(lead)) {
    return {
      leadId: lead.id,
      source: lead.source,
      sourceUrl,
      classification: 'cold_no_confirmed_intent',
      status: 'valid',
      observedAt,
      reason: COLD_NO_CONFIRMED_INTENT_WARNING,
      buyerIntentConfirmedByThisEvidence: false,
    };
  }

  if (isPotentialWarmDemand(lead)) {
    const raw = asRecord(lead.rawPayload);
    const explicitStatus = text(raw.intentEvidenceStatus);
    const explicitlyInvalid = raw.intentEvidenceValid === false || explicitStatus === 'invalid';
    const explicitlyStale = explicitStatus === 'stale';
    const expiresAt = validIso(raw.intentEvidenceExpiresAt);
    const now = Date.parse(validIso(evaluatedAt) ?? evaluatedAt);
    const expired = Boolean(expiresAt && Number.isFinite(now) && Date.parse(expiresAt) <= now);
    const traceable = isTraceableWarmSource(lead);
    const status: IntentEvidenceStatus = explicitlyInvalid || !traceable
      ? 'invalid'
      : explicitlyStale || expired
        ? 'stale'
        : 'valid';
    return {
      leadId: lead.id,
      source: lead.source,
      sourceUrl,
      classification: 'warm_buyer_authored_demand',
      status,
      observedAt,
      reason: status === 'valid'
        ? 'Separate traceable buyer-authored demand evidence is available.'
        : status === 'stale'
          ? 'The linked buyer-authored evidence is stale and cannot currently confirm intent.'
          : 'The record lacks valid traceable buyer-authored demand evidence.',
      buyerIntentConfirmedByThisEvidence: status === 'valid',
    };
  }

  return {
    leadId: lead.id,
    source: lead.source,
    sourceUrl,
    classification: 'non_intent_evidence',
    status: 'valid',
    observedAt,
    reason: 'The record may support fit or research, but it is not buyer-authored demand evidence.',
    buyerIntentConfirmedByThisEvidence: false,
  };
}

export function buildIntentProvenance(
  subject: Lead,
  relatedLeads: Lead[] = [],
  evaluatedAt = new Date().toISOString(),
): LeadIntentProvenance {
  const evaluated = validIso(evaluatedAt) ?? new Date().toISOString();
  const uniqueLeads = uniqueById([subject, ...relatedLeads]);
  const evidence = uniqueLeads.map((lead) => classifyIntentEvidence(lead, evaluated));
  const subjectEvidence = evidence.find((item) => item.leadId === subject.id)!;
  const coldSourceHistory = evidence.filter((item) => item.classification === 'cold_no_confirmed_intent');
  const warmEvidence = evidence.filter((item) => item.classification === 'warm_buyer_authored_demand' && item.status === 'valid');
  const invalidOrStaleWarmEvidence = evidence.filter((item) => item.classification === 'warm_buyer_authored_demand' && item.status !== 'valid');
  const sourceBuyerIntentConfirmed = subjectEvidence.classification === 'warm_buyer_authored_demand'
    && subjectEvidence.status === 'valid';
  const linkedWarmIntentConfirmed = warmEvidence.some((item) => item.leadId !== subject.id);
  const coldSubject = subjectEvidence.classification === 'cold_no_confirmed_intent';
  const effectiveInterpretation: EffectiveIntentInterpretation = sourceBuyerIntentConfirmed
    ? 'warm_buyer_authored'
    : coldSubject && linkedWarmIntentConfirmed
      ? 'linked_warm_evidence'
      : coldSubject
        ? 'cold_only'
        : 'no_confirmed_intent';

  return {
    version: INTENT_PROVENANCE_VERSION,
    evaluatedAt: evaluated,
    baseClassification: subjectEvidence.classification,
    sourceBuyerIntentConfirmed,
    linkedWarmIntentConfirmed,
    effectiveInterpretation,
    warning: coldSubject ? COLD_NO_CONFIRMED_INTENT_WARNING : undefined,
    coldSourceHistory,
    warmEvidence,
    invalidOrStaleWarmEvidence,
    originalSourceClassificationPreserved: true,
    humanReviewRequired: true,
    externalActionAutomated: false,
  };
}

export function attachIntentProvenance(lead: Lead, provenance: LeadIntentProvenance): Lead {
  const raw = asRecord(lead.rawPayload);
  const cold = provenance.baseClassification === 'cold_no_confirmed_intent';
  const warning = provenance.warning;
  return {
    ...lead,
    evidenceSummary: cold && warning
      ? appendUniqueSentence(lead.evidenceSummary, warning)
      : lead.evidenceSummary,
    recommendedNextAction: cold
      ? safeColdNextAction(provenance)
      : lead.recommendedNextAction,
    draftMessage: cold
      ? safeColdDraft(lead, provenance)
      : lead.draftMessage,
    rawPayload: {
      ...raw,
      intentProvenance: provenance,
      intentProvenanceVersion: INTENT_PROVENANCE_VERSION,
      sourceBuyerIntentConfirmed: provenance.sourceBuyerIntentConfirmed,
      linkedWarmIntentConfirmed: provenance.linkedWarmIntentConfirmed,
      buyerIntentConfirmed: provenance.sourceBuyerIntentConfirmed,
      coldNoConfirmedIntentWarning: warning,
      originalSourceClassificationPreserved: true,
      externalActionPerformed: false,
    },
  };
}

export function readIntentProvenance(lead: Lead): LeadIntentProvenance | undefined {
  const raw = asRecord(lead.rawPayload);
  const value = asRecord(raw.intentProvenance);
  if (value.version !== INTENT_PROVENANCE_VERSION) return undefined;
  if (!value.baseClassification || !value.effectiveInterpretation) return undefined;
  return value as unknown as LeadIntentProvenance;
}

export function safeColdDraft(lead: Lead, provenance?: LeadIntentProvenance): string {
  const linkedWarm = provenance?.linkedWarmIntentConfirmed === true;
  return [
    `Hi ${lead.contactName ?? 'there'},`,
    '',
    `I came across your profile while researching ${lead.companyName ?? 'companies'} relevant to ${friendlyService(lead)}. This is a fit hypothesis rather than a response to a confirmed request.`,
    '',
    linkedWarm
      ? 'I also found separate buyer-authored demand evidence linked to the account. I would verify that evidence is current and relevant before referring to it.'
      : 'I have not seen confirmed buying intent from your profile, so I would first validate whether this area is relevant before discussing any delivery approach.',
    '',
    'Codistan supports managed software, AI and delivery partnerships. Would a brief capability comparison be useful, or is there someone else who owns this area?',
  ].join('\n');
}

export function safeColdNextAction(provenance?: LeadIntentProvenance): string {
  return provenance?.linkedWarmIntentConfirmed
    ? 'Cold source remains no-confirmed-intent. Review the separate traceable warm evidence, verify it is current and relevant, then prepare human-approved outreach without attributing that need to the cold profile.'
    : 'Cold prospect — no confirmed buying intent. Research the person and account, validate relevance, and prepare only hypothesis-based human-approved outreach.';
}

function isPotentialWarmDemand(lead: Lead): boolean {
  if (lead.source === 'upwork' && lead.leadType === 'upwork_job') return true;
  return lead.source === 'linkedin'
    && (lead.leadType === 'linkedin_warm_post' || lead.leadType === 'linkedin_sales_nav_alert')
    && (lead.opportunityStatus === 'live_opportunity' || lead.opportunityStatus === 'recent_demand_signal' || lead.prospectStage === 'warm_lead');
}

function isTraceableWarmSource(lead: Lead): boolean {
  const value = lead.evidenceUrl ?? lead.sourceUrl;
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (lead.source === 'upwork') return ['upwork.com', 'www.upwork.com'].includes(host) && url.pathname.includes('/jobs/');
    if (lead.source === 'linkedin') {
      return ['linkedin.com', 'www.linkedin.com'].includes(host)
        && (url.pathname.startsWith('/posts/') || url.pathname.startsWith('/feed/update/') || url.pathname.startsWith('/pulse/'));
    }
    return false;
  } catch {
    return false;
  }
}

function appendUniqueSentence(existing: string | undefined, sentence: string): string {
  const current = String(existing ?? '').trim();
  if (!current) return sentence;
  if (current.toLowerCase().includes(sentence.toLowerCase())) return current;
  return `${current} — ${sentence}`;
}

function uniqueById(leads: Lead[]): Lead[] {
  const values = new Map<string, Lead>();
  for (const lead of leads) values.set(lead.id, lead);
  return [...values.values()];
}

function friendlyService(lead: Lead): string {
  return String(lead.serviceCategory).replaceAll('_', ' ');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
