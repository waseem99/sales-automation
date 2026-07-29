import { createHash } from 'node:crypto';
import {
  DEFAULT_PORTFOLIO,
  matchLeadToCampaigns,
  type CampaignMatch,
  type CampaignPortfolio,
} from '@sales-automation/campaign-engine';
import { readIdentityResolution } from '@sales-automation/identity-graph';
import type { Lead, PipelineStatus, ServiceCategory } from '@sales-automation/shared';

export const UPWORK_ACCOUNT_INTELLIGENCE_VERSION = 'upwork-account-intelligence.v1';

export type AccountPromotionStatus = 'eligible' | 'research' | 'job_only' | 'suppressed';
export type AccountIdentityStrength = 'high' | 'medium' | 'none';

export interface UpworkBuyerEvidence {
  stableBuyerId?: string;
  identityKey?: string;
  identityStrength: AccountIdentityStrength;
  companyDomain?: string;
  companyName?: string;
  contactName?: string;
  paymentVerified?: boolean;
  clientSpendUsd?: number;
  hireRatePercent?: number;
  engagementType?: string;
  proposals?: string;
  linkedJobIds: string[];
  linkedJobUrls: string[];
  serviceThemes: string[];
  sourceVisibleOnly: true;
}

export interface UpworkAccountIntelligenceResult {
  version: typeof UPWORK_ACCOUNT_INTELLIGENCE_VERSION;
  jobLeadId: string;
  status: AccountPromotionStatus;
  accountLeadId?: string;
  accountLead?: Lead;
  identityStrength: AccountIdentityStrength;
  reasons: string[];
  missingEvidence: string[];
  risks: string[];
  campaignMatches: CampaignMatch[];
  buyerEvidence: UpworkBuyerEvidence;
  humanReviewRequired: true;
  externalActionPerformed: false;
}

export function deriveUpworkAccountIntelligence(
  jobLead: Lead,
  allLeads: Lead[],
  generatedAt = new Date().toISOString(),
): UpworkAccountIntelligenceResult {
  if (jobLead.source !== 'upwork' || jobLead.leadType !== 'upwork_job') {
    throw new Error('Upwork account intelligence requires an Upwork job lead.');
  }

  const suppression = suppressionEvidence(jobLead);
  const identity = accountIdentity(jobLead);
  const linkedJobs = identity.key
    ? allLeads.filter((lead) => lead.source === 'upwork' && lead.leadType === 'upwork_job' && accountIdentity(lead).key === identity.key)
    : [jobLead];
  if (!linkedJobs.some((lead) => lead.id === jobLead.id)) linkedJobs.push(jobLead);

  const buyerEvidence = buildBuyerEvidence(jobLead, linkedJobs, identity);
  const reasons: string[] = [];
  const missingEvidence: string[] = [];
  const risks: string[] = [];

  if (suppression.suppressed) {
    risks.push(suppression.reason ?? 'Do-not-contact or suppression evidence is present.');
    return result(jobLead, 'suppressed', identity.strength, reasons, missingEvidence, risks, [], buyerEvidence);
  }

  if (!identity.key || identity.strength === 'none') {
    missingEvidence.push('No stable visible buyer, person or company identity is available.');
    risks.push('Anonymous or weakly identified Upwork buyers must remain job-only records.');
    return result(jobLead, 'job_only', 'none', reasons, missingEvidence, risks, [], buyerEvidence);
  }

  reasons.push(identity.reason);
  if (linkedJobs.length > 1) reasons.push(`${linkedJobs.length} Upwork jobs are linked through the same strong identity.`);
  if (buyerEvidence.paymentVerified === true) reasons.push('Upwork displays payment verification for the linked job evidence.');
  if ((buyerEvidence.clientSpendUsd ?? 0) > 0) reasons.push(`Visible Upwork client spend is ${buyerEvidence.clientSpendUsd}.`);
  if ((buyerEvidence.hireRatePercent ?? 0) > 0) reasons.push(`Visible Upwork hire rate is ${buyerEvidence.hireRatePercent}%.`);

  const accountPrototype = buildAccountLead(jobLead, linkedJobs, buyerEvidence, [], generatedAt, 'needs_research');
  const matches = coldAccountCampaignMatches(accountPrototype);
  const viableMatches = matches.filter((match) => match.disposition === 'priority_a' || match.disposition === 'priority_b' || match.disposition === 'research');

  if (viableMatches.length === 0) {
    missingEvidence.push('No active product or service campaign has a defensible account-level fit.');
    return result(jobLead, 'job_only', identity.strength, reasons, missingEvidence, risks, [], buyerEvidence);
  }

  const top = viableMatches[0];
  const status: AccountPromotionStatus = top.disposition === 'priority_a' || top.disposition === 'priority_b'
    ? 'eligible'
    : 'research';
  const pipelineStatus: PipelineStatus = status === 'eligible' ? 'needs_human_review' : 'needs_research';
  const accountLead = buildAccountLead(jobLead, linkedJobs, buyerEvidence, viableMatches, generatedAt, pipelineStatus);

  reasons.push(...top.positiveReasons);
  missingEvidence.push(...top.missingEvidence);
  risks.push(
    'The linked Upwork job is a warm opportunity; the account-level partnership or product hypothesis is separate and unconfirmed.',
    'Coordinate one human-reviewed contact strategy to avoid duplicate outreach across the job and account records.',
    ...top.risks,
  );

  return {
    ...result(jobLead, status, identity.strength, unique(reasons), unique(missingEvidence), unique(risks), viableMatches, buyerEvidence),
    accountLeadId: accountLead.id,
    accountLead,
  };
}

export function attachUpworkAccountIntelligence(jobLead: Lead, intelligence: UpworkAccountIntelligenceResult): Lead {
  const raw = asRecord(jobLead.rawPayload);
  return {
    ...jobLead,
    rawPayload: {
      ...raw,
      upworkAccountIntelligenceVersion: UPWORK_ACCOUNT_INTELLIGENCE_VERSION,
      upworkAccountIntelligence: stableResult(intelligence),
      linkedAccountLeadId: intelligence.accountLeadId ?? null,
    },
  };
}

function buildAccountLead(
  jobLead: Lead,
  linkedJobs: Lead[],
  buyerEvidence: UpworkBuyerEvidence,
  campaignMatches: CampaignMatch[],
  generatedAt: string,
  pipelineStatus: PipelineStatus,
): Lead {
  const identityKey = buyerEvidence.identityKey!;
  const accountId = `upwork-account-${shortHash(identityKey)}`;
  const primaryMatch = campaignMatches[0];
  const companyName = jobLead.companyName?.trim() || undefined;
  const contactName = jobLead.contactName?.trim() || undefined;
  const label = companyName || contactName || `Identified Upwork buyer ${shortHash(identityKey).slice(0, 8)}`;
  const serviceThemes = buyerEvidence.serviceThemes.length > 0 ? buyerEvidence.serviceThemes : [jobLead.serviceCategory];
  const linkedSummary = linkedJobs
    .slice(0, 8)
    .map((lead) => `${lead.title}${lead.budgetSignal ? ` (${lead.budgetSignal})` : ''}`)
    .join('; ');
  const accountDescription = [
    `Cold account intelligence derived only from visible evidence attached to ${linkedJobs.length} linked Upwork job${linkedJobs.length === 1 ? '' : 's'}.`,
    `Observed job themes: ${serviceThemes.join(', ')}.`,
    linkedSummary ? `Linked jobs: ${linkedSummary}.` : '',
    primaryMatch ? primaryMatch.inferredOpportunityHypothesis : 'A product or delivery-partnership hypothesis requires further research.',
    'This account record is separate from the live Upwork job and does not confirm account-level buying intent.',
  ].filter(Boolean).join(' ');

  return {
    id: accountId,
    source: 'partner_research',
    sourceUrl: jobLead.sourceUrl,
    leadType: 'partner_prospect',
    prospectStage: 'partner_prospect',
    title: `${label} — Upwork account intelligence`,
    description: accountDescription,
    companyName,
    companyWebsite: jobLead.companyWebsite,
    contactName,
    contactRole: jobLead.contactRole,
    contactEmail: jobLead.contactEmail,
    contactPhone: jobLead.contactPhone,
    contactFormUrl: jobLead.contactFormUrl,
    linkedinUrl: jobLead.linkedinUrl,
    country: jobLead.country,
    region: jobLead.region,
    industry: jobLead.industry,
    serviceCategory: preferredServiceCategory(linkedJobs),
    serviceOffer: primaryMatch?.offerName ?? 'Account-level product or managed-delivery partnership research',
    materialsToShare: primaryMatch?.recommendedProof.map((proof) => proof.title).join('; ') || undefined,
    reachMethod: 'Coordinate through the existing Upwork job or another separately verified permitted route. Do not move the live Upwork job off-platform automatically.',
    opportunityStatus: 'partnership_target',
    discoverySource: 'Upwork buyer/account intelligence from visible evidence',
    evidenceUrl: jobLead.sourceUrl,
    evidenceSummary: `Stable identity: ${buyerEvidence.identityStrength}. Linked jobs: ${linkedJobs.length}. Campaign matches: ${campaignMatches.length}.`,
    discoveredAt: generatedAt,
    confidence: buyerEvidence.identityStrength === 'high' ? 'high' : 'medium',
    budgetSignal: aggregateBudgetSignal(linkedJobs),
    timelineSignal: 'Account-level relationship research; the linked job retains its own live timing.',
    capturedAt: generatedAt,
    rawPayload: {
      upworkAccountIntelligenceVersion: UPWORK_ACCOUNT_INTELLIGENCE_VERSION,
      accountIdentityKey: identityKey,
      accountIdentityStrength: buyerEvidence.identityStrength,
      linkedUpworkJobIds: buyerEvidence.linkedJobIds,
      linkedUpworkJobUrls: buyerEvidence.linkedJobUrls,
      sourceWarmJobId: jobLead.id,
      buyerEvidence,
      campaignMatches,
      primaryCampaignMatch: primaryMatch ?? null,
      explicitBuyerIntentConfirmed: false,
      coldAccountHypothesis: true,
      platformRestriction: 'The live job must follow Upwork communication rules. Off-platform contact requires separately verified, permitted evidence and human approval.',
      externalActionPerformed: false,
    },
    recommendedNextAction: primaryMatch?.nextResearchAction ?? 'Confirm the company, decision-maker and one permitted account-level route before any outreach.',
    pipelineStatus,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

function coldAccountCampaignMatches(accountLead: Lead): CampaignMatch[] {
  const portfolio: CampaignPortfolio = {
    ...DEFAULT_PORTFOLIO,
    campaigns: DEFAULT_PORTFOLIO.campaigns
      .filter((campaign) => campaign.route === 'direct_buyer' || campaign.route === 'channel_partner' || campaign.route === 'delivery_partner')
      .map((campaign) => ({...campaign, source: 'upwork' as const, scheduleEnabled: false, searchUrls: []})),
  };
  const sourceCompatibleLead: Lead = {
    ...accountLead,
    source: 'upwork',
    prospectStage: 'partner_prospect',
    opportunityStatus: 'partnership_target',
  };
  return matchLeadToCampaigns(sourceCompatibleLead, portfolio).map((match) => ({
    ...match,
    explicitBuyerIntentConfirmed: false,
    inferredOpportunityHypothesis: `This is an account-level ICP hypothesis for ${match.offerName} through the ${match.route.replaceAll('_', ' ')} route. The linked Upwork job is warm demand, but no separate account-level buying intent is confirmed.`,
    risks: unique([
      ...match.risks.filter((risk) => !/separate warm-demand record/i.test(risk)),
      'Do not treat the linked Upwork job as permission for duplicate or off-platform account outreach.',
    ]),
  }));
}

function accountIdentity(lead: Lead): {key?: string; strength: AccountIdentityStrength; reason: string; stableBuyerId?: string; companyDomain?: string} {
  const raw = asRecord(lead.rawPayload);
  const commercial = asRecord(raw.commercialEvidence);
  const rawEvidence = asRecord(raw.rawEvidence);
  const stableBuyerId = firstString([
    commercial.buyer_id,
    commercial.client_id,
    commercial.client_uid,
    rawEvidence.buyer_id,
    rawEvidence.client_id,
    rawEvidence.client_uid,
  ]);
  if (stableBuyerId) {
    return {key: `upwork-buyer:${normalizeKey(stableBuyerId)}`, strength: 'high', reason: 'A stable buyer identifier is present in visible Upwork evidence.', stableBuyerId};
  }

  const identity = readIdentityResolution(lead);
  const domain = companyDomain(lead);
  if (identity?.company.status === 'resolved' && (identity.company.confidence === 'high' || identity.company.confidence === 'medium')) {
    return {
      key: `company:${identity.company.id}`,
      strength: identity.company.confidence === 'high' ? 'high' : 'medium',
      reason: identity.company.reason,
      companyDomain: domain,
    };
  }
  if (domain) return {key: `domain:${domain}`, strength: 'high', reason: 'A canonical company domain is available.', companyDomain: domain};

  if (identity?.person.status === 'resolved' && lead.companyName?.trim()) {
    return {key: `person-company:${identity.person.id}:${normalizeKey(lead.companyName)}`, strength: 'medium', reason: 'A resolved person identity is attached to a visible company name.'};
  }

  const email = normalizeEmail(lead.contactEmail);
  if (email && !isFreeEmail(email) && lead.companyName?.trim()) {
    return {key: `business-email-company:${email}:${normalizeKey(lead.companyName)}`, strength: 'medium', reason: 'A business email and visible company name provide a stable account candidate.'};
  }
  if (canonicalLinkedIn(lead.linkedinUrl) && lead.companyName?.trim()) {
    return {key: `linkedin-company:${canonicalLinkedIn(lead.linkedinUrl)}:${normalizeKey(lead.companyName)}`, strength: 'medium', reason: 'A canonical LinkedIn identity and visible company name provide a stable account candidate.'};
  }
  return {strength: 'none', reason: 'No stable account identity is available.'};
}

function buildBuyerEvidence(jobLead: Lead, linkedJobs: Lead[], identity: ReturnType<typeof accountIdentity>): UpworkBuyerEvidence {
  const commercial = asRecord(asRecord(jobLead.rawPayload).commercialEvidence);
  return {
    stableBuyerId: identity.stableBuyerId,
    identityKey: identity.key,
    identityStrength: identity.strength,
    companyDomain: identity.companyDomain ?? companyDomain(jobLead),
    companyName: jobLead.companyName,
    contactName: jobLead.contactName,
    paymentVerified: optionalBoolean(commercial.payment_verified),
    clientSpendUsd: optionalNumber(commercial.client_spend_usd),
    hireRatePercent: optionalNumber(commercial.hire_rate_percent),
    engagementType: optionalString(commercial.engagement_type),
    proposals: optionalString(commercial.proposals),
    linkedJobIds: unique(linkedJobs.map((lead) => lead.id)),
    linkedJobUrls: unique(linkedJobs.map((lead) => lead.sourceUrl).filter(isString)),
    serviceThemes: unique(linkedJobs.flatMap((lead) => [lead.serviceCategory, ...rawServiceThemes(lead)])),
    sourceVisibleOnly: true,
  };
}

function preferredServiceCategory(linkedJobs: Lead[]): ServiceCategory {
  const categories = linkedJobs.map((lead) => lead.serviceCategory).filter((value) => value !== 'unknown');
  return categories[0] ?? 'fullstack_web_app';
}

function rawServiceThemes(lead: Lead): string[] {
  const raw = asRecord(lead.rawPayload);
  const commercial = asRecord(raw.commercialEvidence);
  const qualification = asRecord(raw.qualification);
  return unique([
    ...stringArray(commercial.service_lanes),
    ...stringArray(qualification.service_lanes),
  ]);
}

function aggregateBudgetSignal(linkedJobs: Lead[]): string | undefined {
  const values = unique(linkedJobs.map((lead) => lead.budgetSignal).filter(isString));
  return values.length > 0 ? values.slice(0, 4).join(' | ') : undefined;
}

function suppressionEvidence(lead: Lead): {suppressed: boolean; reason?: string} {
  const raw = asRecord(lead.rawPayload);
  const enrichment = asRecord(raw.enrichment);
  const suppression = asRecord(enrichment.suppression);
  const suppressed = raw.doNotContact === true || suppression.suppressed === true;
  return {suppressed, reason: optionalString(suppression.reason) ?? optionalString(raw.suppressionReason)};
}

function stableResult(value: UpworkAccountIntelligenceResult): Record<string, unknown> {
  return {
    version: value.version,
    jobLeadId: value.jobLeadId,
    status: value.status,
    accountLeadId: value.accountLeadId ?? null,
    identityStrength: value.identityStrength,
    reasons: value.reasons,
    missingEvidence: value.missingEvidence,
    risks: value.risks,
    campaignMatches: value.campaignMatches,
    buyerEvidence: value.buyerEvidence,
    humanReviewRequired: true,
    externalActionPerformed: false,
  };
}

function result(
  jobLead: Lead,
  status: AccountPromotionStatus,
  identityStrength: AccountIdentityStrength,
  reasons: string[],
  missingEvidence: string[],
  risks: string[],
  campaignMatches: CampaignMatch[],
  buyerEvidence: UpworkBuyerEvidence,
): UpworkAccountIntelligenceResult {
  return {
    version: UPWORK_ACCOUNT_INTELLIGENCE_VERSION,
    jobLeadId: jobLead.id,
    status,
    identityStrength,
    reasons: unique(reasons),
    missingEvidence: unique(missingEvidence),
    risks: unique(risks),
    campaignMatches,
    buyerEvidence,
    humanReviewRequired: true,
    externalActionPerformed: false,
  };
}

function companyDomain(lead: Lead): string | undefined {
  const raw = asRecord(lead.rawPayload);
  const enrichment = asRecord(raw.enrichment);
  const company = asRecord(enrichment.company);
  const domainField = asRecord(company.domain);
  const websiteField = asRecord(company.website);
  return normalizeDomain(
    lead.companyWebsite
      ?? optionalString(domainField.value)
      ?? optionalString(websiteField.value)
      ?? optionalString(asRecord(raw.company).domain)
      ?? optionalString(asRecord(raw.company).website),
  );
}

function normalizeDomain(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const candidate = value.includes('://') ? value : `https://${value}`;
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

function canonicalLinkedIn(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!['linkedin.com', 'www.linkedin.com', 'sales.linkedin.com'].includes(url.hostname.toLowerCase())) return undefined;
    return url.pathname.replace(/\/$/, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizeEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function isFreeEmail(email: string): boolean {
  const domain = email.split('@')[1] ?? '';
  return new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'proton.me', 'protonmail.com']).has(domain);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    const text = optionalString(value);
    if (text) return text;
  }
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
