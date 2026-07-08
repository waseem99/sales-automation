import { matchPortfolio, type PortfolioMatch } from '@sales-automation/portfolio-matching';
import { recommendProfile, type ProfileRecommendation } from '@sales-automation/routing';
import { scoreLead } from '@sales-automation/scoring';
import type { Lead, LeadScore, PortfolioItem, RedFlag } from '@sales-automation/shared';

export interface LeadEvaluation {
  lead: Lead;
  score: LeadScore;
  profileRecommendation: ProfileRecommendation;
  portfolioMatches: PortfolioMatch[];
  recommendedNextAction: string;
}

export interface EvaluateLeadInput {
  lead: Lead;
  portfolioItems: PortfolioItem[];
  includePrivatePortfolio?: boolean;
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

  const profileRecommendation = recommendProfile(input.lead, score);
  const recommendedNextAction = getRecommendedNextAction(score, profileRecommendation, portfolioMatches);

  return {
    lead: input.lead,
    score,
    profileRecommendation,
    portfolioMatches,
    recommendedNextAction,
  };
}

export function detectRedFlags(lead: Lead): RedFlag[] {
  const text = `${lead.title} ${lead.description} ${lead.budgetSignal ?? ''} ${lead.timelineSignal ?? ''}`.toLowerCase();
  const redFlags: RedFlag[] = [];

  if (text.includes('free sample') || text.includes('unpaid sample')) {
    redFlags.push({
      code: 'free_work_request',
      severity: 'high',
      reason: 'Lead appears to request free or unpaid sample work.',
    });
  }

  if (text.includes('$100') || text.includes('$200') || text.includes('cheap') || text.includes('low budget')) {
    redFlags.push({
      code: 'low_budget_signal',
      severity: 'high',
      reason: 'Budget signal appears too low for Codistan target opportunities.',
    });
  }

  if (text.includes('clone') && (text.includes('2 days') || text.includes('24 hours') || text.includes('48 hours'))) {
    redFlags.push({
      code: 'unrealistic_scope_timeline',
      severity: 'high',
      reason: 'Scope and timeline appear unrealistic.',
    });
  }

  if (text.includes('us only') || text.includes('u.s. only') || text.includes('united states only')) {
    redFlags.push({
      code: 'profile_compliance_review_required',
      severity: 'medium',
      reason: 'US-only language requires human review before selecting or using a profile.',
    });
  }

  if (text.includes('adult') || text.includes('gambling') || text.includes('crypto scam')) {
    redFlags.push({
      code: 'restricted_or_sensitive_industry',
      severity: 'critical',
      reason: 'Lead may involve a restricted or high-risk industry for outbound pursuit.',
    });
  }

  return redFlags;
}

function hasStrongBuyerSignal(lead: Lead): boolean {
  const text = `${lead.title} ${lead.description} ${lead.contactRole ?? ''}`.toLowerCase();
  return [
    'founder',
    'ceo',
    'cto',
    'director',
    'head of',
    'vp',
    'owner',
    'verified',
    'enterprise',
    'funded',
    'agency',
  ].some((keyword) => text.includes(keyword));
}

function hasStrongBudgetSignal(lead: Lead): boolean {
  const text = `${lead.description} ${lead.budgetSignal ?? ''}`.toLowerCase();
  return [
    '$5k',
    '$10k',
    '$15k',
    '$20k',
    'expert',
    'long-term',
    'ongoing',
    'enterprise',
    'recurring',
    'retainer',
  ].some((keyword) => text.includes(keyword));
}

function hasHighCompetitionSignal(lead: Lead): boolean {
  const text = `${lead.description} ${lead.rawPayload ? JSON.stringify(lead.rawPayload).toLowerCase() : ''}`;
  return text.includes('50+ proposals') || text.includes('too many proposals') || text.includes('hired already');
}

function hasComplianceRisk(lead: Lead): boolean {
  const text = `${lead.title} ${lead.description} ${lead.country ?? ''} ${lead.region ?? ''}`.toLowerCase();
  return text.includes('us only') || text.includes('u.s. only') || text.includes('account sharing') || text.includes('scrape linkedin');
}

function getRecommendedNextAction(
  score: LeadScore,
  profileRecommendation: ProfileRecommendation,
  portfolioMatches: PortfolioMatch[],
): string {
  if (score.status === 'rejected') {
    return 'Reject or archive. Do not spend BD time unless a founder manually overrides.';
  }

  if (profileRecommendation.primaryProfile === 'needs_human_review') {
    return 'Send to human review before outreach/bidding because profile or compliance risk is unclear.';
  }

  if (score.urgency === 'urgent') {
    return `Review immediately, use ${profileRecommendation.primaryProfile}, and include ${portfolioMatches[0]?.portfolioItem.projectName ?? 'the strongest available proof'} if approved.`;
  }

  if (score.status === 'qualified') {
    return `Add to qualified queue, use ${profileRecommendation.primaryProfile}, and prepare a tailored draft with matched proof.`;
  }

  return 'Add to nurture/watch queue. Do not prioritize unless new buying signal appears.';
}
