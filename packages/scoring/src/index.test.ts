import assert from 'node:assert/strict';
import { scoreLead } from './index.js';
import type { Lead } from '@sales-automation/shared';

const capturedAt = '2026-07-08T18:30:00.000Z';

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: overrides.id ?? 'lead-test',
    source: overrides.source ?? 'upwork',
    leadType: overrides.leadType ?? 'upwork_job',
    prospectStage: overrides.prospectStage,
    title: overrides.title ?? 'AI automation lead',
    description: overrides.description ?? 'Founder needs an expert AI automation partner for a paid pilot.',
    serviceCategory: overrides.serviceCategory ?? 'ai_automation',
    budgetSignal: overrides.budgetSignal ?? '$10k paid pilot',
    timelineSignal: overrides.timelineSignal,
    capturedAt,
    freshnessMinutes: overrides.freshnessMinutes ?? 20,
    pipelineStatus: overrides.pipelineStatus ?? 'new',
    createdAt: capturedAt,
    updatedAt: capturedAt,
    ...overrides,
  };
}

const hotUpwork = scoreLead({
  lead: makeLead({ leadType: 'upwork_job', freshnessMinutes: 20 }),
  matchingPortfolioCount: 3,
  hasStrongBuyerSignal: true,
  hasStrongBudgetSignal: true,
});
assert.equal(hotUpwork.status, 'hot');
assert.equal(hotUpwork.urgency, 'urgent');

const coldSalesNavigator = scoreLead({
  lead: makeLead({
    source: 'sales_navigator',
    leadType: 'sales_navigator_cold_prospect',
    prospectStage: 'cold_prospect',
    title: 'COO at funded SaaS showing support automation intent',
    description: 'Sales Navigator research shows hiring and AI operations intent at a funded B2B SaaS company.',
    freshnessMinutes: 1440,
    pipelineStatus: 'needs_research',
  }),
  matchingPortfolioCount: 3,
  hasStrongBuyerSignal: true,
  hasStrongBudgetSignal: true,
});
assert.equal(coldSalesNavigator.status, 'qualified');
assert.equal(coldSalesNavigator.urgency, 'normal');
assert.ok(coldSalesNavigator.explanation.includes('cold prospect'));

const unsafeLinkedInAutomation = scoreLead({
  lead: makeLead({
    source: 'linkedin',
    leadType: 'linkedin_warm_post',
    title: 'Need scrape LinkedIn and auto DM tool',
    description: 'Need scrape LinkedIn profiles and auto DM everyone.',
  }),
  matchingPortfolioCount: 3,
  hasStrongBuyerSignal: true,
  hasStrongBudgetSignal: true,
  hasComplianceRisk: true,
  redFlags: [
    {
      code: 'unsafe_outreach_or_scraping_request',
      severity: 'critical',
      reason: 'Unsafe scraping or automated outreach request.',
    },
  ],
});
assert.equal(unsafeLinkedInAutomation.status, 'rejected');
assert.equal(unsafeLinkedInAutomation.total, 0);

console.log('Scoring expectations for warm leads, cold prospects, and unsafe LinkedIn automation passed.');
