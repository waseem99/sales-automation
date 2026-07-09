import type { LeadType } from './types.js';

export interface QualificationThresholds {
  hot: number;
  qualified: number;
  nurture: number;
}

export interface FreshnessRule {
  scoreAtLeast: number;
  freshnessMinutesAtMost: number;
}

export interface LeadTypeConfig {
  thresholds: QualificationThresholds;
  urgentFreshnessRule?: FreshnessRule;
  defaultCadenceMinutes: number;
}

export const leadTypeConfig: Record<LeadType, LeadTypeConfig> = {
  upwork_job: {
    thresholds: { hot: 80, qualified: 65, nurture: 50 },
    urgentFreshnessRule: { scoreAtLeast: 75, freshnessMinutesAtMost: 60 },
    defaultCadenceMinutes: 30,
  },
  linkedin_warm_post: {
    thresholds: { hot: 75, qualified: 60, nurture: 45 },
    urgentFreshnessRule: { scoreAtLeast: 70, freshnessMinutesAtMost: 120 },
    defaultCadenceMinutes: 30,
  },
  linkedin_sales_nav_alert: {
    thresholds: { hot: 75, qualified: 60, nurture: 45 },
    urgentFreshnessRule: { scoreAtLeast: 70, freshnessMinutesAtMost: 120 },
    defaultCadenceMinutes: 30,
  },
  linkedin_cold_prospect: {
    thresholds: { hot: 82, qualified: 64, nurture: 45 },
    defaultCadenceMinutes: 1440,
  },
  sales_navigator_cold_prospect: {
    thresholds: { hot: 82, qualified: 64, nurture: 45 },
    defaultCadenceMinutes: 1440,
  },
  partner_prospect: {
    thresholds: { hot: 80, qualified: 65, nurture: 50 },
    urgentFreshnessRule: { scoreAtLeast: 90, freshnessMinutesAtMost: 1440 },
    defaultCadenceMinutes: 1440,
  },
  solution_led_prospect: {
    thresholds: { hot: 80, qualified: 65, nurture: 50 },
    urgentFreshnessRule: { scoreAtLeast: 85, freshnessMinutesAtMost: 1440 },
    defaultCadenceMinutes: 1440,
  },
  manual_lead: {
    thresholds: { hot: 75, qualified: 60, nurture: 45 },
    defaultCadenceMinutes: 0,
  },
  future_source: {
    thresholds: { hot: 80, qualified: 65, nurture: 50 },
    defaultCadenceMinutes: 1440,
  },
};

export const scoreWeights = {
  serviceFit: 25,
  buyerQuality: 20,
  budgetRoi: 15,
  timingUrgency: 15,
  portfolioProofMatch: 15,
  competitionAccessRisk: 5,
  complianceSafety: 5,
} as const;
