import type { Lead, PortfolioItem } from '@sales-automation/shared';
import type { PortfolioMatch } from '@sales-automation/portfolio-matching';

export type CloseabilityBand = 'priority_a' | 'priority_b' | 'research' | 'reject';

export interface CloseabilityBreakdown {
  activeRequirement: number;
  freshnessUrgency: number;
  serviceFit: number;
  companyCredibility: number;
  buyerIdentified: number;
  verifiedContactRoute: number;
  geographyDeliveryFit: number;
  matchingProof: number;
  sourceReliability: number;
}

export interface CloseabilityScore {
  total: number;
  band: CloseabilityBand;
  breakdown: CloseabilityBreakdown;
  explanation: string;
  evidence: string[];
  missingData: string[];
  estimatedValueBand?: 'under_5k' | '5k_15k' | '15k_50k' | '50k_plus';
  reasonToActNow?: string;
  generatedAt: string;
}

export interface ScoreCloseabilityInput {
  lead: Lead;
  portfolioMatches: PortfolioMatch[];
  portfolioItems: PortfolioItem[];
  generatedAt?: string;
}

const finalStatuses = new Set(['won', 'lost', 'rejected', 'archived']);
const activeRequirementPatterns = [
  /request for (?:proposal|quotation)/i,
  /\b(?:rfp|rfq|eoi|tender|procurement)\b/i,
  /(?:looking|seeking|searching) for (?:an? )?(?:external )?(?:agency|vendor|consultant|development partner|implementation partner|technology partner)/i,
  /(?:need|needs|require|requires|required) (?:an? )?(?:external )?(?:agency|vendor|consultant|team|developer|partner)/i,
  /(?:build|develop|implement|migrate|integrate|redesign|automate) (?:our|a|an|the) /i,
  /scope of work|statement of work|project deliverables|fixed[- ]scope|fixed[- ]price/i,
];
const urgencyPatterns = [
  /start immediately|urgent|as soon as possible|asap|this month|within \d+ (?:day|week|month)s?/i,
  /deadline|closing date|submission date/i,
];
const buyerRolePatterns = /\b(?:founder|co-founder|ceo|cto|cio|ciso|coo|owner|director|head of|vice president|vp|procurement|purchasing|product lead|engineering lead|marketing lead|operations lead)\b/i;
const credibleCompanyPatterns = /\b(?:company|organization|organisation|agency|enterprise|university|hospital|government|ministry|authority|foundation|nonprofit|ngo|bank|saas|platform|studio|retail|clinic|restaurant|manufacturer)\b/i;
const incompatibleLocationPatterns = /\b(?:onsite only|on-site only|must be located in|local residents only|citizens only|security clearance required|w-?2 only)\b/i;

export function scoreCloseability(input: ScoreCloseabilityInput): CloseabilityScore {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const lead = input.lead;
  const text = normalizedLeadText(lead);
  const evidence: string[] = [];
  const missingData: string[] = [];

  const activeRequirement = scoreActiveRequirement(lead, text, evidence, missingData);
  const freshnessUrgency = scoreFreshness(lead, text, generatedAt, evidence, missingData);
  const serviceFit = scoreServiceFit(lead, input.portfolioMatches, evidence, missingData);
  const companyCredibility = scoreCompanyCredibility(lead, text, evidence, missingData);
  const buyerIdentified = scoreBuyer(lead, evidence, missingData);
  const verifiedContactRoute = scoreContactRoute(lead, evidence, missingData);
  const geographyDeliveryFit = scoreGeography(lead, text, evidence, missingData);
  const matchingProof = scoreProof(input.portfolioMatches, input.portfolioItems, evidence, missingData);
  const sourceReliability = scoreSource(lead, evidence);

  const breakdown: CloseabilityBreakdown = {
    activeRequirement,
    freshnessUrgency,
    serviceFit,
    companyCredibility,
    buyerIdentified,
    verifiedContactRoute,
    geographyDeliveryFit,
    matchingProof,
    sourceReliability,
  };

  const rawTotal = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const closedPenalty = finalStatuses.has(lead.pipelineStatus) ? 100 : 0;
  const total = Math.max(0, Math.min(100, rawTotal - closedPenalty));
  const band = classifyBand(total, lead.pipelineStatus);
  const estimatedValueBand = valueBand(lead);
  const reasonToActNow = actNowReason(lead, text, freshnessUrgency);

  return {
    total,
    band,
    breakdown,
    explanation: explainScore(total, band, breakdown, missingData),
    evidence: unique(evidence),
    missingData: unique(missingData),
    estimatedValueBand,
    reasonToActNow,
    generatedAt,
  };
}

function scoreActiveRequirement(lead: Lead, text: string, evidence: string[], missing: string[]): number {
  if (lead.tender) {
    evidence.push('Formal tender or procurement record provides an explicit active requirement.');
    return 20;
  }
  if (lead.opportunityStatus === 'live_opportunity' && activeRequirementPatterns.some((pattern) => pattern.test(text))) {
    evidence.push('The source contains an explicit project, procurement, vendor or implementation requirement.');
    return 20;
  }
  if (activeRequirementPatterns.some((pattern) => pattern.test(text))) {
    evidence.push('The available description contains a direct project or partner request.');
    return 17;
  }
  if (lead.opportunityStatus === 'recent_demand_signal') {
    evidence.push('A recent demand signal exists, but an external buying requirement is not yet confirmed.');
    missing.push('Confirm an active external project or purchasing requirement.');
    return 8;
  }
  if (lead.opportunityStatus === 'partnership_target' || lead.leadType === 'partner_prospect') {
    evidence.push('The record is a partnership target rather than a confirmed active requirement.');
    missing.push('Confirm current outsourcing, overflow or white-label delivery demand.');
    return 6;
  }
  missing.push('No explicit active requirement is evidenced.');
  return 0;
}

function scoreFreshness(lead: Lead, text: string, generatedAt: string, evidence: string[], missing: string[]): number {
  const referenceTime = parseDate(lead.postedAt ?? lead.discoveredAt ?? lead.capturedAt ?? lead.createdAt);
  const now = parseDate(generatedAt) ?? Date.now();
  let score = 0;
  if (referenceTime !== undefined) {
    const ageHours = Math.max(0, (now - referenceTime) / 3_600_000);
    if (ageHours <= 24) score = 8;
    else if (ageHours <= 72) score = 7;
    else if (ageHours <= 168) score = 5;
    else if (ageHours <= 720) score = 3;
    else score = 1;
    evidence.push(`The opportunity evidence is approximately ${humanAge(ageHours)} old.`);
  } else {
    missing.push('Freshness date is not verified.');
  }
  if (urgencyPatterns.some((pattern) => pattern.test(text))) {
    score = Math.min(10, score + 2);
    evidence.push('The source contains a deadline or urgency signal.');
  }
  return score;
}

function scoreServiceFit(lead: Lead, matches: PortfolioMatch[], evidence: string[], missing: string[]): number {
  if (lead.serviceCategory === 'unknown') {
    missing.push('Service category requires confirmation.');
    return matches.length > 0 ? 7 : 2;
  }
  if (matches.length >= 2) {
    evidence.push(`The requirement maps to ${lead.serviceCategory} with multiple relevant approved proof matches.`);
    return 15;
  }
  if (matches.length === 1) {
    evidence.push(`The requirement maps to ${lead.serviceCategory} with one relevant approved proof match.`);
    return 13;
  }
  evidence.push(`The requirement maps to ${lead.serviceCategory}, but approved proof is not yet matched.`);
  missing.push('Attach relevant approved portfolio proof.');
  return 10;
}

function scoreCompanyCredibility(lead: Lead, text: string, evidence: string[], missing: string[]): number {
  let score = 0;
  if (lead.companyName?.trim()) score += 4;
  else missing.push('Company or organization name is not verified.');
  if (isPublicHttpUrl(lead.companyWebsite)) {
    score += 4;
    evidence.push('An official public company website is available.');
  } else if (isPublicHttpUrl(lead.evidenceUrl ?? lead.sourceUrl)) {
    score += 2;
    evidence.push('A public source URL is available, but the official company website needs confirmation.');
    missing.push('Verify the official company website.');
  } else {
    missing.push('No credible public company or source URL is available.');
  }
  if (credibleCompanyPatterns.test(text) || lead.tender) score = Math.min(10, score + 2);
  return score;
}

function scoreBuyer(lead: Lead, evidence: string[], missing: string[]): number {
  if (lead.contactName && lead.contactRole && buyerRolePatterns.test(lead.contactRole)) {
    evidence.push(`A likely decision-maker is identified: ${lead.contactRole}.`);
    return 10;
  }
  if (lead.contactRole && buyerRolePatterns.test(lead.contactRole)) {
    evidence.push(`A relevant buyer role is identified: ${lead.contactRole}.`);
    missing.push('Verify the buyer’s name.');
    return 7;
  }
  if (lead.tender) {
    evidence.push('The procurement authority is the formal buyer, but the responsible contact may require confirmation.');
    missing.push('Confirm the procurement contact or clarification route.');
    return 6;
  }
  if (lead.contactName || lead.contactRole) {
    evidence.push('A contact is identified, but decision authority is not established.');
    missing.push('Verify that the contact influences or owns the purchase.');
    return 4;
  }
  missing.push('No buyer or decision-maker is identified.');
  return 0;
}

function scoreContactRoute(lead: Lead, evidence: string[], missing: string[]): number {
  if (validBusinessEmail(lead.contactEmail)) {
    evidence.push('A public business email is available.');
    return 10;
  }
  if (isPublicHttpUrl(lead.contactFormUrl)) {
    evidence.push('An official public contact form is available.');
    return 8;
  }
  if (lead.tender?.submissionMethod || lead.tender?.documentIntelligence?.submissionMethod) {
    evidence.push('A formal tender submission or procurement contact route is documented.');
    return 8;
  }
  if (isPublicHttpUrl(lead.linkedinUrl)) {
    evidence.push('A public professional profile is available for manual outreach research.');
    missing.push('Verify a business email or official contact route before outreach.');
    return 5;
  }
  if (isPublicHttpUrl(lead.companyWebsite)) {
    evidence.push('The company website provides a starting point for contact research.');
    missing.push('Find a verified buyer contact route.');
    return 3;
  }
  missing.push('No verified contact route is available.');
  return 0;
}

function scoreGeography(lead: Lead, text: string, evidence: string[], missing: string[]): number {
  if (incompatibleLocationPatterns.test(text)) {
    evidence.push('The source contains a local-only, employment-only or eligibility restriction.');
    missing.push('Confirm that remote or partner-based delivery is allowed.');
    return 0;
  }
  if (lead.tender?.localPresenceRequired === 'yes') {
    if (lead.tender.consortiumAllowed === 'yes') {
      evidence.push('Local presence is required, but consortium participation is allowed.');
      missing.push('Identify and validate a local consortium partner.');
      return 5;
    }
    evidence.push('Local presence is required and no consortium route is confirmed.');
    missing.push('Resolve the local-presence requirement before proceeding.');
    return 2;
  }
  if (lead.country || lead.region) {
    evidence.push('The opportunity geography is identified and no incompatible delivery restriction is evidenced.');
    return 10;
  }
  missing.push('Country and delivery constraints are not confirmed.');
  return 6;
}

function scoreProof(matches: PortfolioMatch[], portfolioItems: PortfolioItem[], evidence: string[], missing: string[]): number {
  const approvedIds = new Set(portfolioItems.map((item) => item.id));
  const validMatches = matches.filter((match) => approvedIds.has(match.portfolioItem.id));
  const withAsset = validMatches.filter((match) => match.portfolioItem.assetUrls.some(isPublicHttpUrl));
  if (withAsset.length > 0) {
    evidence.push(`Approved shareable proof is available: ${withAsset[0]?.portfolioItem.projectName}.`);
    return 10;
  }
  if (validMatches.length > 0) {
    evidence.push(`Approved proof wording is matched, but a shareable asset is not attached.`);
    missing.push('Attach a healthy public or anonymized proof asset.');
    return 7;
  }
  missing.push('No matching approved proof is available.');
  return 0;
}

function scoreSource(lead: Lead, evidence: string[]): number {
  if (lead.source === 'public_procurement' || lead.tender) {
    evidence.push('The source is an official procurement channel.');
    return 5;
  }
  if (lead.source === 'manual') {
    evidence.push('The opportunity was supplied through approved manual intake and still requires evidence review.');
    return isPublicHttpUrl(lead.evidenceUrl ?? lead.sourceUrl) ? 5 : 4;
  }
  if (lead.source === 'upwork') return 4;
  if (lead.source === 'linkedin' || lead.source === 'sales_navigator') return 3;
  if (lead.source === 'partner_research' || lead.source === 'solution_campaign') return 3;
  if (lead.source === 'public_web') return 2;
  if (lead.source === 'public_directory' || lead.source === 'public_job_board') return 1;
  return 2;
}

function classifyBand(total: number, pipelineStatus: string): CloseabilityBand {
  if (pipelineStatus === 'rejected' || pipelineStatus === 'archived') return 'reject';
  if (total >= 85) return 'priority_a';
  if (total >= 75) return 'priority_b';
  if (total >= 60) return 'research';
  return 'reject';
}

function valueBand(lead: Lead): CloseabilityScore['estimatedValueBand'] {
  const text = `${lead.budgetSignal ?? ''} ${lead.tender?.estimatedValue ?? ''}`.toLowerCase().replace(/,/g, '');
  const amounts = [...text.matchAll(/(?:usd|\$|£|gbp|cad|aed|pkr)?\s*(\d+(?:\.\d+)?)\s*(k|m)?/gi)]
    .map((match) => Number(match[1]) * (match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1))
    .filter((value) => Number.isFinite(value) && value >= 100);
  if (amounts.length === 0) return undefined;
  const maximum = Math.max(...amounts);
  if (maximum < 5_000) return 'under_5k';
  if (maximum < 15_000) return '5k_15k';
  if (maximum < 50_000) return '15k_50k';
  return '50k_plus';
}

function actNowReason(lead: Lead, text: string, freshness: number): string | undefined {
  if (lead.tender?.deadline) return `Formal deadline: ${lead.tender.deadline}. Review eligibility and documents before committing bid effort.`;
  if (urgencyPatterns.some((pattern) => pattern.test(text))) return 'The source contains an urgency or deadline signal; review within one business day.';
  if (freshness >= 7 && lead.opportunityStatus === 'live_opportunity') return 'The active requirement is recent; early manual review may improve access before competition increases.';
  return undefined;
}

function explainScore(total: number, band: CloseabilityBand, breakdown: CloseabilityBreakdown, missing: string[]): string {
  const strongest = Object.entries(breakdown).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, value]) => `${label(key)} ${value}`).join(', ');
  const gaps = missing.slice(0, 3).join(' ');
  return `${label(band)} at ${total}/100. Strongest evidence: ${strongest}.${gaps ? ` Key gaps: ${gaps}` : ''}`;
}

function normalizedLeadText(lead: Lead): string {
  return [
    lead.title, lead.description, lead.companyName, lead.contactRole, lead.country, lead.region,
    lead.industry, lead.budgetSignal, lead.timelineSignal, lead.evidenceSummary, lead.reachMethod,
    lead.tender?.recommendationReason, ...(lead.tender?.eligibilitySignals ?? []), ...(lead.tender?.riskFlags ?? []),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function validBusinessEmail(value: string | undefined): boolean {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/@(?:gmail|yahoo|hotmail|outlook)\./i.test(value));
}

function isPublicHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function humanAge(hours: number): string {
  if (hours < 1) return 'less than one hour';
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
