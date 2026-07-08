import {
  leadTypeConfig,
  scoreWeights,
  type Lead,
  type LeadScore,
  type QualificationStatus,
  type RedFlag,
  type ServiceCategory,
  type UrgencyStatus,
} from '@sales-automation/shared';

const highFitServices = new Set<ServiceCategory>([
  'ai_automation',
  'rag_document_intelligence',
  'ai_saas_mvp',
  'fullstack_web_app',
  'nextjs_python_app',
  'voice_ai_agent',
  'ar_3d_unity_unreal',
  'cybersecurity_compliance',
]);

export interface ScoreLeadInput {
  lead: Lead;
  matchingPortfolioCount?: number;
  hasStrongBuyerSignal?: boolean;
  hasStrongBudgetSignal?: boolean;
  hasHighCompetition?: boolean;
  hasComplianceRisk?: boolean;
  redFlags?: RedFlag[];
}

export function scoreLead(input: ScoreLeadInput): LeadScore {
  const redFlags = input.redFlags ?? [];
  const serviceFit = scoreServiceFit(input.lead.serviceCategory);
  const buyerQuality = input.hasStrongBuyerSignal ? scoreWeights.buyerQuality : Math.round(scoreWeights.buyerQuality * 0.55);
  const budgetRoi = input.hasStrongBudgetSignal ? scoreWeights.budgetRoi : Math.round(scoreWeights.budgetRoi * 0.5);
  const timingUrgency = scoreTiming(input.lead);
  const portfolioProofMatch = scorePortfolioMatch(input.matchingPortfolioCount ?? 0);
  const competitionAccessRisk = input.hasHighCompetition ? 1 : scoreWeights.competitionAccessRisk;
  const complianceSafety = input.hasComplianceRisk ? 0 : scoreWeights.complianceSafety;

  const redFlagPenalty = calculateRedFlagPenalty(redFlags);
  const rawTotal =
    serviceFit +
    buyerQuality +
    budgetRoi +
    timingUrgency +
    portfolioProofMatch +
    competitionAccessRisk +
    complianceSafety -
    redFlagPenalty;

  const total = clampScore(rawTotal);
  const status = getQualificationStatus(input.lead, total, redFlags);
  const urgency = getUrgencyStatus(input.lead, total, status);

  return {
    total,
    breakdown: {
      serviceFit,
      buyerQuality,
      budgetRoi,
      timingUrgency,
      portfolioProofMatch,
      competitionAccessRisk,
      complianceSafety,
    },
    status,
    urgency,
    explanation: buildExplanation(input.lead, total, status, urgency, redFlags),
    redFlags,
  };
}

function scoreServiceFit(serviceCategory: ServiceCategory): number {
  if (highFitServices.has(serviceCategory)) return scoreWeights.serviceFit;
  if (serviceCategory === 'website_portal' || serviceCategory === 'enterprise_systems') return 16;
  return 8;
}

function scoreTiming(lead: Lead): number {
  const freshness = lead.freshnessMinutes;
  if (freshness === undefined) return Math.round(scoreWeights.timingUrgency * 0.45);

  if (lead.leadType === 'upwork_job') {
    if (freshness <= 30) return scoreWeights.timingUrgency;
    if (freshness <= 60) return 13;
    if (freshness <= 180) return 9;
    return 4;
  }

  if (lead.leadType === 'linkedin_warm_post' || lead.leadType === 'linkedin_sales_nav_alert') {
    if (freshness <= 60) return scoreWeights.timingUrgency;
    if (freshness <= 120) return 12;
    if (freshness <= 360) return 8;
    return 4;
  }

  return Math.round(scoreWeights.timingUrgency * 0.5);
}

function scorePortfolioMatch(matchingPortfolioCount: number): number {
  if (matchingPortfolioCount >= 3) return scoreWeights.portfolioProofMatch;
  if (matchingPortfolioCount === 2) return 12;
  if (matchingPortfolioCount === 1) return 9;
  return 3;
}

function calculateRedFlagPenalty(redFlags: RedFlag[]): number {
  return redFlags.reduce((penalty, flag) => {
    if (flag.severity === 'critical') return penalty + 100;
    if (flag.severity === 'high') return penalty + 20;
    if (flag.severity === 'medium') return penalty + 10;
    return penalty + 4;
  }, 0);
}

function getQualificationStatus(lead: Lead, total: number, redFlags: RedFlag[]): QualificationStatus {
  if (redFlags.some((flag) => flag.severity === 'critical')) return 'rejected';

  const thresholds = leadTypeConfig[lead.leadType].thresholds;
  if (total >= thresholds.hot) return 'hot';
  if (total >= thresholds.qualified) return 'qualified';
  if (total >= thresholds.nurture) return 'nurture';
  return 'rejected';
}

function getUrgencyStatus(lead: Lead, total: number, status: QualificationStatus): UrgencyStatus {
  if (status === 'rejected' || status === 'nurture') return 'low';

  const config = leadTypeConfig[lead.leadType];
  const freshRule = config.urgentFreshnessRule;

  if (total >= config.thresholds.hot) return 'urgent';

  if (
    freshRule &&
    lead.freshnessMinutes !== undefined &&
    total >= freshRule.scoreAtLeast &&
    lead.freshnessMinutes <= freshRule.freshnessMinutesAtMost
  ) {
    return 'urgent';
  }

  return 'normal';
}

function buildExplanation(
  lead: Lead,
  total: number,
  status: QualificationStatus,
  urgency: UrgencyStatus,
  redFlags: RedFlag[],
): string {
  const parts = [
    `Lead scored ${total}/100 and is marked as ${status}.`,
    `Urgency is ${urgency}.`,
    `Lead type is ${lead.leadType} and service category is ${lead.serviceCategory}.`,
  ];

  if (redFlags.length > 0) {
    parts.push(`Red flags: ${redFlags.map((flag) => `${flag.code}: ${flag.reason}`).join('; ')}.`);
  }

  return parts.join(' ');
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
