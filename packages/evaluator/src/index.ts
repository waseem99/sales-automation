import { buildAlertPlan, type AlertPlan } from '@sales-automation/alerts';
import { generateDrafts, type GeneratedDraft } from '@sales-automation/drafting';
import { matchPortfolio, type PortfolioMatch } from '@sales-automation/portfolio-matching';
import { recommendProfile, type ProfileRecommendation } from '@sales-automation/routing';
import { scoreLead } from '@sales-automation/scoring';
import type { Lead, LeadScore, PortfolioItem, RedFlag } from '@sales-automation/shared';
import { scoreCloseability, type CloseabilityScore } from './closeability.js';

export * from './closeability.js';

export interface LeadEvaluation {
  lead: Lead;
  score: LeadScore;
  closeability: CloseabilityScore;
  profileRecommendation: ProfileRecommendation;
  portfolioMatches: PortfolioMatch[];
  recommendedNextAction: string;
  drafts: GeneratedDraft[];
  alertPlan: AlertPlan;
}

export interface EvaluateLeadInput {
  lead: Lead;
  portfolioItems: PortfolioItem[];
  includePrivatePortfolio?: boolean;
  generatedAt?: string;
}

export function evaluateLead(input: EvaluateLeadInput): LeadEvaluation {
  const redFlags = detectRedFlags(input.lead);
  const portfolioMatches = matchPortfolio({
    lead: input.lead,
    portfolioItems: input.portfolioItems,
    includePrivate: input.includePrivatePortfolio ?? false,
    limit: 3,
  });

  const score = scoreLead({
    lead: input.lead,
    matchingPortfolioCount: portfolioMatches.length,
    hasStrongBuyerSignal: hasStrongBuyerSignal(input.lead),
    hasStrongBudgetSignal: hasStrongBudgetSignal(input.lead),
    hasHighCompetition: hasHighCompetitionSignal(input.lead),
    hasComplianceRisk: hasComplianceRisk(input.lead),
    redFlags,
  });
  const scoredCloseability = scoreCloseability({
    lead: input.lead,
    portfolioMatches,
    portfolioItems: input.portfolioItems,
    generatedAt: input.generatedAt,
  });
  const closeability: CloseabilityScore = score.status === 'rejected'
    ? {
        ...scoredCloseability,
        total: Math.min(scoredCloseability.total, 45),
        band: 'reject',
        explanation: `Rejected by the existing qualification and safety gate. ${scoredCloseability.explanation}`,
        evidence: [...scoredCloseability.evidence, ...score.redFlags.map((flag) => `${flag.severity}: ${flag.reason}`)],
      }
    : scoredCloseability;

  const profileRecommendation = recommendProfile(input.lead, score);
  const recommendedNextAction = getRecommendedNextAction(input.lead, score, closeability, profileRecommendation, portfolioMatches);
  const drafts = generateDrafts({
    lead: input.lead,
    score,
    profileRecommendation,
    portfolioMatches,
    generatedAt: input.generatedAt,
  });
  const alertPlan = buildAlertPlan({
    lead: input.lead,
    score,
    profileRecommendation,
    portfolioMatches,
    drafts,
    recommendedNextAction,
  });

  return {
    lead: input.lead,
    score,
    closeability,
    profileRecommendation,
    portfolioMatches,
    recommendedNextAction,
    drafts,
    alertPlan,
  };
}

export function detectRedFlags(lead: Lead): RedFlag[] {
  const text = `${lead.title} ${lead.description} ${lead.budgetSignal ?? ''} ${lead.timelineSignal ?? ''}`.toLowerCase();
  const redFlags: RedFlag[] = [];

  if (text.includes('free sample') || text.includes('unpaid sample')) {
    redFlags.push({ code: 'free_work_request', severity: 'high', reason: 'Lead appears to request free or unpaid sample work.' });
  }

  if (text.includes('$100') || text.includes('$200') || text.includes('cheap') || text.includes('low budget')) {
    redFlags.push({ code: 'low_budget_signal', severity: 'high', reason: 'Budget signal appears too low for Codistan target opportunities.' });
  }

  if (text.includes('clone') && (text.includes('2 days') || text.includes('24 hours') || text.includes('48 hours'))) {
    redFlags.push({ code: 'unrealistic_scope_timeline', severity: 'high', reason: 'Scope and timeline appear unrealistic.' });
  }

  if (hasProfileEligibilityLanguage(text)) {
    redFlags.push({ code: 'profile_compliance_review_required', severity: 'medium', reason: 'Location, citizenship, clearance, onsite, or employment language requires human verification before selecting a profile.' });
  }

  if (text.includes('scrape linkedin') || text.includes('linkedin scraper') || text.includes('auto dm') || text.includes('automated dm')) {
    redFlags.push({ code: 'unsafe_outreach_or_scraping_request', severity: 'critical', reason: 'Lead appears to request unsafe scraping or automated LinkedIn outreach.' });
  }

  if (text.includes('adult') || text.includes('gambling') || text.includes('crypto scam')) {
    redFlags.push({ code: 'restricted_or_sensitive_industry', severity: 'critical', reason: 'Lead may involve a restricted or high-risk industry for outbound pursuit.' });
  }

  return redFlags;
}

function hasStrongBuyerSignal(lead: Lead): boolean {
  const text = `${lead.title} ${lead.description} ${lead.contactRole ?? ''} ${lead.industry ?? ''} ${lead.rawPayload ? JSON.stringify(lead.rawPayload) : ''}`.toLowerCase();
  return ['founder','ceo','cto','coo','director','head of','vp','owner','verified','enterprise','funded','recently funded','sales navigator','intent signal','agency'].some((keyword) => text.includes(keyword));
}

function hasStrongBudgetSignal(lead: Lead): boolean {
  const text = `${lead.description} ${lead.budgetSignal ?? ''} ${lead.timelineSignal ?? ''}`.toLowerCase();
  return ['$5k','$10k','$15k','$20k','expert','long-term','ongoing','enterprise','recurring','retainer','funded','budget approved','paid pilot','implementation partner'].some((keyword) => text.includes(keyword));
}

function hasHighCompetitionSignal(lead: Lead): boolean {
  const text = `${lead.description} ${lead.rawPayload ? JSON.stringify(lead.rawPayload).toLowerCase() : ''}`;
  return text.includes('50+ proposals') || text.includes('too many proposals') || text.includes('hired already');
}

function hasComplianceRisk(lead: Lead): boolean {
  const text = `${lead.title} ${lead.description} ${lead.country ?? ''} ${lead.region ?? ''}`.toLowerCase();
  return hasProfileEligibilityLanguage(text) || text.includes('account sharing') || text.includes('scrape linkedin') || text.includes('auto dm');
}

function hasProfileEligibilityLanguage(text: string): boolean {
  return ['us only','u.s. only','united states only','us-based only','us based only','must be in the us','us citizen','u.s. citizen','security clearance','onsite only','on-site only','w2 only','w-2 only'].some((phrase) => text.includes(phrase));
}

function getRecommendedNextAction(
  lead: Lead,
  score: LeadScore,
  closeability: CloseabilityScore,
  profileRecommendation: ProfileRecommendation,
  portfolioMatches: PortfolioMatch[],
): string {
  if (score.status === 'rejected' || closeability.band === 'reject') {
    return 'Reject or archive. Do not spend BD time unless a founder manually overrides with verified missing evidence.';
  }

  const routedProfile = profileRecommendation.upworkProfile;
  const profileInstruction = routedProfile ? `${routedProfile.label} (${routedProfile.url})` : profileRecommendation.primaryProfile;
  const rateRange = routedProfile?.targetHourlyRateRangeUsd;
  const rateInstruction = rateRange ? ` Target hourly rate: $${rateRange.min}–$${rateRange.max}/hour; do not revert to the obsolete lower profile rate.` : '';
  const gapInstruction = closeability.missingData.length > 0 ? ` First resolve: ${closeability.missingData.slice(0, 2).join(' ')}` : '';

  if (profileRecommendation.primaryProfile === 'needs_human_review') {
    if (routedProfile) {
      return `Human review required before bidding. Candidate profile: ${profileInstruction}. ${routedProfile.selectionReason} Verify profile ownership, eligibility, current public positioning, and the job restrictions first.${rateInstruction}${gapInstruction}`;
    }
    return `Send to human review before outreach or bidding because profile, scope, or compliance risk is unclear.${gapInstruction}`;
  }

  if (lead.leadType === 'linkedin_cold_prospect' || lead.leadType === 'sales_navigator_cold_prospect') {
    return `Research account/contact manually, verify business email/LinkedIn context, then prepare human-approved outreach using ${portfolioMatches[0]?.portfolioItem.projectName ?? 'the strongest matched proof'}. Do not auto-DM.${gapInstruction}`;
  }

  if (closeability.band === 'priority_a') {
    return `Priority A: review within one business day and prepare human-approved outreach through ${profileInstruction}.${rateInstruction} Use ${portfolioMatches[0]?.portfolioItem.projectName ?? 'the strongest approved proof'}.${closeability.reasonToActNow ? ` ${closeability.reasonToActNow}` : ''}`;
  }

  if (closeability.band === 'priority_b') {
    return `Priority B: keep in the owner action queue, resolve the identified evidence gaps, then prepare tailored outreach through ${profileInstruction}.${rateInstruction}${gapInstruction}`;
  }

  if (score.urgency === 'urgent') {
    return `Review immediately and bid manually through ${profileInstruction}.${rateInstruction} Include ${portfolioMatches[0]?.portfolioItem.projectName ?? 'the strongest available proof'} if approved.${gapInstruction}`;
  }

  if (score.status === 'qualified') {
    return `Keep in research until closeability reaches Priority B. Use ${profileInstruction}.${rateInstruction}${gapInstruction}`;
  }

  return `Add to nurture/watch queue. Do not prioritize unless a stronger buying signal appears.${gapInstruction}`;
}
