import { createHash } from 'node:crypto';
import type { Lead, OpportunitySignalStatus, ServiceCategory } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { hasResultLevelProjectOpportunityIntent } from './prospect-validation.js';
import { classifyTargeting } from './targeting.js';

export type ReengagementRelationshipType =
  | 'previous_client'
  | 'dormant_proposal'
  | 'existing_account_cross_sell'
  | 'referral_partner'
  | 'agency_partner';

export type RelationshipStrength = 'high' | 'medium' | 'developing';

export interface ReengagementInput {
  relationshipType: ReengagementRelationshipType;
  organizationName: string;
  officialWebsite?: string;
  priorEngagementSummary: string;
  lastInteractionAt?: string;
  approvedServicesDelivered?: string[];
  currentOpportunitySignal?: string;
  crossSellHypothesis?: string;
  evidenceSourceUrl?: string;
  contactName?: string;
  contactRole?: string;
  contactEmail?: string;
  contactFormUrl?: string;
  owner?: string;
  followUpAt?: string;
  internalNotes?: string;
}

export interface NormalizedReengagementInput extends ReengagementInput {
  officialWebsite?: string;
  evidenceSourceUrl?: string;
  contactFormUrl?: string;
  contactEmail?: string;
  lastInteractionAt?: string;
  followUpAt?: string;
  approvedServicesDelivered: string[];
  relationshipStrength: RelationshipStrength;
  opportunityStatus: OpportunitySignalStatus;
  serviceCategory: ServiceCategory;
  serviceOffer: string;
  portfolioIdentity: string;
  deliveryModel: string;
  canonicalDomain?: string;
  normalizedOrganization: string;
}

export interface ReengagementMatch {
  record: StoredLeadRecord;
  reason: 'official_domain' | 'organization_name' | 'evidence_url';
}

export interface ReengagementBrief {
  relationshipType: ReengagementRelationshipType;
  relationshipStrength: RelationshipStrength;
  currentIntentConfirmed: boolean;
  serviceCategory: ServiceCategory;
  serviceOffer: string;
  portfolioIdentity: string;
  deliveryModel: string;
  recommendedNextAction: string;
  missingData: string[];
  humanApprovalRequired: true;
  automaticSendingAllowed: false;
}

const personalEmailDomains = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com',
]);
const validRelationshipTypes: ReengagementRelationshipType[] = [
  'previous_client', 'dormant_proposal', 'existing_account_cross_sell', 'referral_partner', 'agency_partner',
];
const finalStatuses = new Set(['won', 'lost', 'rejected', 'archived']);

export function normalizeReengagementInput(input: ReengagementInput): NormalizedReengagementInput {
  if (!validRelationshipTypes.includes(input.relationshipType)) throw new Error('relationshipType is invalid.');
  const organizationName = requiredText(input.organizationName, 'organizationName', 2, 180);
  const priorEngagementSummary = requiredText(input.priorEngagementSummary, 'priorEngagementSummary', 10, 4_000);
  const currentOpportunitySignal = optionalText(input.currentOpportunitySignal, 4_000);
  const crossSellHypothesis = optionalText(input.crossSellHypothesis, 2_000);
  const officialWebsite = normalizePublicUrl(input.officialWebsite);
  const evidenceSourceUrl = normalizePublicUrl(input.evidenceSourceUrl);
  const contactFormUrl = normalizePublicUrl(input.contactFormUrl);
  const contactEmail = normalizeBusinessEmail(input.contactEmail, officialWebsite);
  const approvedServicesDelivered = unique((input.approvedServicesDelivered ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20));
  const targetingText = [currentOpportunitySignal, crossSellHypothesis, ...approvedServicesDelivered].filter(Boolean).join(' ');
  const targeting = classifyTargeting(targetingText || organizationName);
  const currentIntentConfirmed = Boolean(currentOpportunitySignal && hasResultLevelProjectOpportunityIntent(currentOpportunitySignal));

  return {
    ...input,
    organizationName,
    priorEngagementSummary,
    currentOpportunitySignal,
    crossSellHypothesis,
    officialWebsite,
    evidenceSourceUrl,
    contactFormUrl,
    contactEmail,
    lastInteractionAt: normalizeDate(input.lastInteractionAt),
    followUpAt: normalizeDate(input.followUpAt),
    approvedServicesDelivered,
    relationshipStrength: relationshipStrength(input.relationshipType),
    opportunityStatus: currentIntentConfirmed ? 'live_opportunity' : 'partnership_target',
    serviceCategory: targeting.serviceCategory,
    serviceOffer: targeting.serviceOffer,
    portfolioIdentity: targeting.portfolioIdentity,
    deliveryModel: targeting.deliveryModel,
    canonicalDomain: officialWebsite ? registrableDomain(new URL(officialWebsite).hostname) : undefined,
    normalizedOrganization: normalizeOrganization(organizationName),
    owner: optionalText(input.owner, 320),
    internalNotes: optionalText(input.internalNotes, 4_000),
    contactName: optionalText(input.contactName, 180),
    contactRole: optionalText(input.contactRole, 180),
  };
}

export function findReengagementMatch(records: StoredLeadRecord[], input: NormalizedReengagementInput): ReengagementMatch | undefined {
  for (const record of records) {
    const lead = record.lead;
    if (input.canonicalDomain) {
      const domains = [lead.companyWebsite, lead.sourceUrl, lead.evidenceUrl]
        .map(domainFromUrl)
        .filter((value): value is string => Boolean(value));
      if (domains.includes(input.canonicalDomain)) return { record, reason: 'official_domain' };
    }
    if (normalizeOrganization(lead.companyName ?? '') === input.normalizedOrganization) {
      return { record, reason: 'organization_name' };
    }
    if (input.evidenceSourceUrl && canonicalUrl(lead.evidenceUrl ?? lead.sourceUrl) === canonicalUrl(input.evidenceSourceUrl)) {
      return { record, reason: 'evidence_url' };
    }
  }
  return undefined;
}

export function buildReengagementLead(input: NormalizedReengagementInput, actor: string, now = new Date().toISOString()): Lead {
  const id = `reengagement-${createHash('sha256').update(`${input.normalizedOrganization}|${input.canonicalDomain ?? ''}`).digest('hex').slice(0, 20)}`;
  const brief = buildReengagementBrief(input);
  const publicDescription = input.currentOpportunitySignal
    ? `Current relationship signal supplied for review: ${input.currentOpportunitySignal}`
    : `Existing relationship identified for a structured re-engagement review. No current buying requirement is yet confirmed.`;

  return {
    id,
    source: 'manual',
    sourceUrl: input.evidenceSourceUrl ?? input.officialWebsite,
    leadType: input.opportunityStatus === 'live_opportunity' ? 'public_opportunity' : 'partner_prospect',
    prospectStage: 'warm_lead',
    title: `Re-engagement: ${input.organizationName}`,
    description: publicDescription,
    companyName: input.organizationName,
    companyWebsite: input.officialWebsite,
    contactName: input.contactName,
    contactRole: input.contactRole,
    contactEmail: input.contactEmail,
    contactFormUrl: input.contactFormUrl,
    serviceCategory: input.serviceCategory,
    serviceOffer: input.serviceOffer,
    materialsToShare: `${input.portfolioIdentity} approved proof only; do not expose internal prior-engagement notes.`,
    country: undefined,
    opportunityStatus: input.opportunityStatus,
    discoverySource: 'Approved re-engagement intake',
    evidenceUrl: input.evidenceSourceUrl ?? input.officialWebsite,
    evidenceSummary: input.opportunityStatus === 'live_opportunity'
      ? 'Internal relationship record with a supplied current opportunity signal. Verify buyer intent before outreach.'
      : 'Internal relationship record. Current buyer intent is not yet confirmed.',
    capturedAt: now,
    recommendedNextAction: brief.recommendedNextAction,
    owner: input.owner,
    nextFollowUpAt: input.followUpAt,
    pipelineStatus: 'needs_human_review',
    rawPayload: {
      reengagement: {
        relationshipType: input.relationshipType,
        relationshipStrength: input.relationshipStrength,
        priorEngagementSummary: input.priorEngagementSummary,
        lastInteractionAt: input.lastInteractionAt,
        approvedServicesDelivered: input.approvedServicesDelivered,
        currentOpportunitySignal: input.currentOpportunitySignal,
        crossSellHypothesis: input.crossSellHypothesis,
        internalNotes: input.internalNotes,
        evidenceSourceUrl: input.evidenceSourceUrl,
        suppliedBy: actor,
        suppliedAt: now,
        internalOnly: true,
        brief,
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function mergeReengagementIntoLead(existing: Lead, input: NormalizedReengagementInput, actor: string, now = new Date().toISOString()): Lead {
  const priorRaw = asRecord(existing.rawPayload) ?? {};
  const previous = asRecord(priorRaw.reengagement);
  const brief = buildReengagementBrief(input);
  return {
    ...existing,
    companyName: existing.companyName ?? input.organizationName,
    companyWebsite: existing.companyWebsite ?? input.officialWebsite,
    contactName: existing.contactName ?? input.contactName,
    contactRole: existing.contactRole ?? input.contactRole,
    contactEmail: existing.contactEmail ?? input.contactEmail,
    contactFormUrl: existing.contactFormUrl ?? input.contactFormUrl,
    serviceCategory: input.serviceCategory === 'enterprise_systems' && existing.serviceCategory !== 'unknown'
      ? existing.serviceCategory
      : input.serviceCategory,
    serviceOffer: input.serviceOffer,
    materialsToShare: `${input.portfolioIdentity} approved proof only; do not expose internal prior-engagement notes.`,
    opportunityStatus: input.opportunityStatus === 'live_opportunity' ? 'live_opportunity' : existing.opportunityStatus,
    discoverySource: existing.discoverySource?.includes('Re-engagement') ? existing.discoverySource : `${existing.discoverySource ?? 'Existing prospect'} + Re-engagement`,
    evidenceUrl: input.evidenceSourceUrl ?? existing.evidenceUrl,
    evidenceSummary: input.opportunityStatus === 'live_opportunity'
      ? 'A current opportunity signal was supplied through approved re-engagement intake and requires human verification.'
      : existing.evidenceSummary,
    owner: existing.owner ?? input.owner,
    nextFollowUpAt: input.followUpAt ?? existing.nextFollowUpAt,
    pipelineStatus: finalStatuses.has(existing.pipelineStatus) ? 'needs_human_review' : existing.pipelineStatus,
    recommendedNextAction: brief.recommendedNextAction,
    rawPayload: {
      ...priorRaw,
      reengagement: {
        ...previous,
        relationshipType: input.relationshipType,
        relationshipStrength: input.relationshipStrength,
        priorEngagementSummary: input.priorEngagementSummary,
        lastInteractionAt: input.lastInteractionAt,
        approvedServicesDelivered: input.approvedServicesDelivered,
        currentOpportunitySignal: input.currentOpportunitySignal,
        crossSellHypothesis: input.crossSellHypothesis,
        internalNotes: input.internalNotes,
        evidenceSourceUrl: input.evidenceSourceUrl,
        suppliedBy: actor,
        suppliedAt: now,
        internalOnly: true,
        brief,
      },
    },
    updatedAt: now,
  };
}

export function buildReengagementBrief(input: NormalizedReengagementInput): ReengagementBrief {
  const currentIntentConfirmed = input.opportunityStatus === 'live_opportunity';
  const missingData: string[] = [];
  if (!currentIntentConfirmed) missingData.push('Confirm a current buyer requirement before outreach.');
  if (!input.contactRole) missingData.push('Verify the relevant buyer role.');
  if (!input.contactEmail && !input.contactFormUrl) missingData.push('Verify a public business contact route.');
  if (!input.officialWebsite) missingData.push('Verify the official organization website.');
  if (!input.crossSellHypothesis) missingData.push('Define a specific evidence-based cross-sell hypothesis.');

  const relationshipInstruction = input.relationshipStrength === 'high'
    ? 'Ask the previous account owner to validate relationship context and request an introduction or discovery conversation.'
    : input.relationshipStrength === 'medium'
      ? 'Review the previous proposal or partner history, confirm what changed, then prepare a personalized re-opening message.'
      : 'Validate the referral or agency relationship before treating it as a warm opportunity.';
  const intentInstruction = currentIntentConfirmed
    ? 'A current opportunity signal is present; verify scope, authority, timing and contact route before human-approved outreach.'
    : 'No current buying requirement is confirmed; keep this in research/nurture and do not send a sales message yet.';

  return {
    relationshipType: input.relationshipType,
    relationshipStrength: input.relationshipStrength,
    currentIntentConfirmed,
    serviceCategory: input.serviceCategory,
    serviceOffer: input.serviceOffer,
    portfolioIdentity: input.portfolioIdentity,
    deliveryModel: input.deliveryModel,
    recommendedNextAction: `${relationshipInstruction} ${intentInstruction}`,
    missingData,
    humanApprovalRequired: true,
    automaticSendingAllowed: false,
  };
}

function relationshipStrength(type: ReengagementRelationshipType): RelationshipStrength {
  if (type === 'previous_client' || type === 'existing_account_cross_sell') return 'high';
  if (type === 'dormant_proposal' || type === 'agency_partner') return 'medium';
  return 'developing';
}

function normalizeBusinessEmail(value: string | undefined, officialWebsite: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('contactEmail is invalid.');
  const emailDomain = email.split('@')[1] ?? '';
  if (personalEmailDomains.has(emailDomain)) throw new Error('Personal email addresses cannot be stored as verified re-engagement business routes.');
  if (officialWebsite && registrableDomain(emailDomain) !== registrableDomain(new URL(officialWebsite).hostname)) {
    throw new Error('contactEmail must match the verified organization domain.');
  }
  return email;
}

function normalizePublicUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
    url.hash = '';
    return url.toString();
  } catch {
    throw new Error('A supplied URL is invalid or is not public HTTP(S).');
  }
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error('A supplied date is invalid.');
  return new Date(parsed).toISOString();
}

function requiredText(value: string | undefined, field: string, minimum: number, maximum: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length < minimum) throw new Error(`${field} must contain at least ${minimum} characters.`);
  if (normalized.length > maximum) throw new Error(`${field} must contain no more than ${maximum} characters.`);
  return normalized;
}
function optionalText(value: string | undefined, maximum: number): string | undefined { const normalized=value?.trim(); if(!normalized)return undefined; if(normalized.length>maximum)throw new Error(`A supplied text field must contain no more than ${maximum} characters.`); return normalized; }
function normalizeOrganization(value: string): string { return value.toLowerCase().replace(/\b(?:pvt\.? ltd\.?|private limited|limited|ltd\.?|inc\.?|llc|corp\.?|corporation|company|co\.?)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim(); }
function domainFromUrl(value: string | undefined): string | undefined { if(!value)return undefined; try{return registrableDomain(new URL(value).hostname);}catch{return undefined;} }
function canonicalUrl(value: string | undefined): string | undefined { if(!value)return undefined; try{const url=new URL(value);url.hash='';for(const key of [...url.searchParams.keys()])if(key.toLowerCase().startsWith('utm_'))url.searchParams.delete(key);return url.toString().replace(/\/$/,'');}catch{return undefined;} }
function registrableDomain(hostname: string): string { const parts=hostname.toLowerCase().replace(/^www\./,'').split('.').filter(Boolean); return parts.length<=2?parts.join('.'):parts.slice(-2).join('.'); }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined; }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
