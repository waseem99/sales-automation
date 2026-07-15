import type { Lead, PortfolioItem, ServiceCategory } from '@sales-automation/shared';

export type UpworkSavedSearchBand = 'priority_a' | 'priority_b' | 'research' | 'reject';
export type UpworkSavedSearchOutcome = 'keep' | 'research' | 'reject';

export interface UpworkSavedSearchScoreBreakdown {
  serviceFit: number;
  budgetFit: number;
  freshness: number;
  clientCredibility: number;
  projectClarity: number;
  sourceEvidence: number;
  portfolioProof: number;
}

export interface UpworkSavedSearchDecision {
  outcome: UpworkSavedSearchOutcome;
  band: UpworkSavedSearchBand;
  score: number;
  scoreBreakdown: UpworkSavedSearchScoreBreakdown;
  reasonCodes: string[];
  minimumFixedBudgetUsd: number;
  minimumHourlyRateUsd: number;
  maximumAgeHours: number;
}

export interface UpworkSavedSearchQualityOptions {
  minimumFixedBudgetUsd?: number;
  minimumHourlyRateUsd?: number;
  maximumAgeHours?: number;
}

interface UpworkPayload {
  jobType?: 'fixed_price' | 'hourly' | 'unknown';
  experienceLevel?: 'entry' | 'intermediate' | 'expert';
  clientPaymentVerified?: boolean;
  clientSpendUsd?: number;
  clientHireRate?: number;
  clientCountry?: string;
  proposalCount?: string;
}

const permanentEmploymentPattern = /\b(?:permanent position|employee role|salary|benefits package|payroll|join our team|send your resume|submit your resume|work authorization|visa sponsorship)\b/i;
const lowValuePattern = /\b(?:unpaid|free work|free sample|no budget|volunteer only|student project|school project)\b/i;
const projectClarityPattern = /\b(?:build|develop|implement|integrate|migrate|redesign|rebuild|audit|assessment|automation|platform|application|website|portal|system|campaign|deliverable|milestone)\b/i;

export function evaluateUpworkSavedSearchLead(
  lead: Lead,
  portfolioItems: PortfolioItem[] = [],
  options: UpworkSavedSearchQualityOptions = {},
): UpworkSavedSearchDecision {
  const minimumFixedBudgetUsd = positiveNumber(options.minimumFixedBudgetUsd, 500);
  const minimumHourlyRateUsd = positiveNumber(options.minimumHourlyRateUsd, 15);
  const maximumAgeHours = positiveNumber(options.maximumAgeHours, 168);
  const payload = asPayload(lead.rawPayload);
  const combined = `${lead.title}\n${lead.description}\n${lead.budgetSignal ?? ''}`;
  const reasonCodes: string[] = [];

  if (lead.source !== 'upwork' || lead.leadType !== 'upwork_job') reasonCodes.push('untrusted_source');
  if (!lead.sourceUrl || !isUpworkJobUrl(lead.sourceUrl)) reasonCodes.push('missing_original_evidence');
  if (lead.serviceCategory === 'unknown') reasonCodes.push('weak_service_fit');
  if (permanentEmploymentPattern.test(combined)) reasonCodes.push('upwork_employee_role');
  if (lowValuePattern.test(combined)) reasonCodes.push('individual_low_value_request');
  if (lead.freshnessMinutes !== undefined && lead.freshnessMinutes > maximumAgeHours * 60) reasonCodes.push('stale_upwork_alert');

  const budget = parseBudget(lead.budgetSignal, payload.jobType);
  if (budget.kind === 'fixed' && budget.maximum !== undefined && budget.maximum < minimumFixedBudgetUsd) reasonCodes.push('upwork_fixed_budget_below_minimum');
  if (budget.kind === 'hourly' && budget.maximum !== undefined && budget.maximum < minimumHourlyRateUsd) reasonCodes.push('upwork_hourly_rate_below_minimum');

  const breakdown: UpworkSavedSearchScoreBreakdown = {
    serviceFit: serviceFitScore(lead.serviceCategory),
    budgetFit: budgetFitScore(budget, minimumFixedBudgetUsd, minimumHourlyRateUsd),
    freshness: freshnessScore(lead.freshnessMinutes, maximumAgeHours),
    clientCredibility: clientCredibilityScore(payload),
    projectClarity: projectClarityPattern.test(combined) && lead.description.trim().length >= 80 ? 10 : projectClarityPattern.test(combined) ? 6 : 0,
    sourceEvidence: lead.sourceUrl && isUpworkJobUrl(lead.sourceUrl) ? 5 : 0,
    portfolioProof: portfolioItems.some((item) => item.confidentiality !== 'private' && item.serviceCategories.includes(lead.serviceCategory)) ? 5 : 0,
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const hardReject = reasonCodes.some((reason) => [
    'untrusted_source',
    'missing_original_evidence',
    'weak_service_fit',
    'upwork_employee_role',
    'individual_low_value_request',
    'stale_upwork_alert',
    'upwork_fixed_budget_below_minimum',
    'upwork_hourly_rate_below_minimum',
  ].includes(reason));

  let outcome: UpworkSavedSearchOutcome;
  let band: UpworkSavedSearchBand;
  if (hardReject || score < 60) {
    outcome = 'reject';
    band = 'reject';
  } else if (score >= 85) {
    outcome = 'keep';
    band = 'priority_a';
  } else if (score >= 75) {
    outcome = 'keep';
    band = 'priority_b';
  } else {
    outcome = 'research';
    band = 'research';
  }

  if (budget.kind === 'unknown') reasonCodes.push('upwork_budget_unverified');
  if (payload.clientPaymentVerified === undefined) reasonCodes.push('upwork_payment_status_unverified');
  if (payload.clientSpendUsd === undefined && payload.clientHireRate === undefined) reasonCodes.push('upwork_client_history_unverified');
  if (!lead.country) reasonCodes.push('upwork_client_country_unverified');

  return {
    outcome,
    band,
    score,
    scoreBreakdown: breakdown,
    reasonCodes: [...new Set(reasonCodes)],
    minimumFixedBudgetUsd,
    minimumHourlyRateUsd,
    maximumAgeHours,
  };
}

export function applyUpworkSavedSearchDecision(lead: Lead, decision: UpworkSavedSearchDecision, generatedAt: string): Lead {
  const raw = lead.rawPayload && typeof lead.rawPayload === 'object' && !Array.isArray(lead.rawPayload)
    ? lead.rawPayload as Record<string, unknown>
    : {};
  return {
    ...lead,
    prospectStage: 'warm_lead',
    opportunityStatus: 'live_opportunity',
    confidence: decision.band === 'priority_a' ? 'high' : decision.band === 'priority_b' ? 'medium' : 'low',
    rank: Math.max(1, 101 - decision.score),
    pipelineStatus: decision.band === 'research' ? 'needs_research' : 'needs_human_review',
    recommendedNextAction: decision.band === 'priority_a'
      ? 'Open the original Upwork job immediately, confirm client history and competition, then prepare a human-reviewed proposal within two hours.'
      : decision.band === 'priority_b'
        ? 'Verify missing budget or client details, select approved proof and prepare a human-reviewed proposal within one business day.'
        : 'Research budget, client credibility and project fit before deciding whether to pursue.',
    rawPayload: {
      ...raw,
      upworkSavedSearchQuality: {
        version: 1,
        score: decision.score,
        band: decision.band,
        scoreBreakdown: decision.scoreBreakdown,
        reasonCodes: decision.reasonCodes,
        thresholds: {
          minimumFixedBudgetUsd: decision.minimumFixedBudgetUsd,
          minimumHourlyRateUsd: decision.minimumHourlyRateUsd,
          maximumAgeHours: decision.maximumAgeHours,
        },
      },
    },
    updatedAt: generatedAt,
  };
}

export function isUpworkJobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'upwork.com' && (/\/jobs\//i.test(url.pathname) || /\/freelance-jobs\/apply\//i.test(url.pathname));
  } catch {
    return false;
  }
}

function asPayload(value: unknown): UpworkPayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UpworkPayload : {};
}

function serviceFitScore(category: ServiceCategory): number {
  return category === 'unknown' ? 0 : 25;
}

function freshnessScore(minutes: number | undefined, maximumAgeHours: number): number {
  if (minutes === undefined) return 5;
  if (minutes <= 6 * 60) return 15;
  if (minutes <= 24 * 60) return 12;
  if (minutes <= 72 * 60) return 9;
  if (minutes <= maximumAgeHours * 60) return 5;
  return 0;
}

function clientCredibilityScore(payload: UpworkPayload): number {
  let score = 0;
  if (payload.clientPaymentVerified === true) score += 7;
  if (payload.clientSpendUsd !== undefined) {
    if (payload.clientSpendUsd >= 50_000) score += 7;
    else if (payload.clientSpendUsd >= 10_000) score += 6;
    else if (payload.clientSpendUsd >= 1_000) score += 4;
    else if (payload.clientSpendUsd > 0) score += 2;
  }
  if (payload.clientHireRate !== undefined) {
    if (payload.clientHireRate >= 70) score += 6;
    else if (payload.clientHireRate >= 40) score += 4;
    else if (payload.clientHireRate > 0) score += 2;
  }
  return Math.min(20, score);
}

interface ParsedBudget {
  kind: 'fixed' | 'hourly' | 'unknown';
  minimum?: number;
  maximum?: number;
}

function parseBudget(value: string | undefined, jobType: UpworkPayload['jobType']): ParsedBudget {
  if (!value?.trim()) return { kind: jobType === 'fixed_price' ? 'fixed' : jobType === 'hourly' ? 'hourly' : 'unknown' };
  const numbers = [...value.matchAll(/[0-9]+(?:\.[0-9]+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite);
  if (!numbers.length) return { kind: 'unknown' };
  const kind = jobType === 'hourly' || /\/\s*(?:hr|hour)|hourly/i.test(value) ? 'hourly' : 'fixed';
  return { kind, minimum: Math.min(...numbers), maximum: Math.max(...numbers) };
}

function budgetFitScore(budget: ParsedBudget, minimumFixed: number, minimumHourly: number): number {
  if (budget.kind === 'unknown' || budget.maximum === undefined) return 6;
  const threshold = budget.kind === 'hourly' ? minimumHourly : minimumFixed;
  if (budget.maximum < threshold) return 0;
  if (budget.maximum >= threshold * 5) return 20;
  if (budget.maximum >= threshold * 2) return 16;
  return 12;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
