import assert from 'node:assert/strict';
import type { Lead, PortfolioItem } from '@sales-automation/shared';
import { applyUpworkSavedSearchDecision, evaluateUpworkSavedSearchLead } from './upwork-saved-search.js';

const proof: PortfolioItem[] = [{
  id: 'proof-1',
  projectName: 'Approved SaaS proof',
  confidentiality: 'public',
  serviceCategories: ['fullstack_web_app'],
  techStack: ['React', 'Node.js'],
  problemSolved: 'Built a production SaaS platform.',
  assetUrls: ['https://codistan.org'],
  tags: ['saas'],
  bestProfiles: ['codistan_partner_identity'],
}];

const base: Lead = {
  id: 'upwork-test',
  source: 'upwork',
  sourceUrl: 'https://www.upwork.com/jobs/~012345',
  leadType: 'upwork_job',
  prospectStage: 'warm_lead',
  title: 'Build a React SaaS customer portal',
  description: 'We need an experienced external development team to build and integrate a customer portal with clear milestones and production deployment.',
  country: 'United States',
  serviceCategory: 'fullstack_web_app',
  opportunityStatus: 'live_opportunity',
  budgetSignal: '$5,000',
  timelineSignal: 'Posted 2 hours ago',
  capturedAt: '2026-07-15T10:00:00.000Z',
  freshnessMinutes: 120,
  rawPayload: {
    jobType: 'fixed_price',
    clientPaymentVerified: true,
    clientSpendUsd: 50000,
    clientHireRate: 80,
  },
  pipelineStatus: 'new',
  createdAt: '2026-07-15T10:00:00.000Z',
  updatedAt: '2026-07-15T10:00:00.000Z',
};

const strong = evaluateUpworkSavedSearchLead(base, proof);
assert.equal(strong.outcome, 'keep');
assert.equal(strong.band, 'priority_a');
assert.ok(strong.score >= 85);
const applied = applyUpworkSavedSearchDecision(base, strong, '2026-07-15T10:05:00.000Z');
assert.equal(applied.pipelineStatus, 'needs_human_review');
assert.equal(applied.confidence, 'high');

const cheap = evaluateUpworkSavedSearchLead({ ...base, budgetSignal: '$200' }, proof);
assert.equal(cheap.outcome, 'reject');
assert.ok(cheap.reasonCodes.includes('upwork_fixed_budget_below_minimum'));

const employment = evaluateUpworkSavedSearchLead({
  ...base,
  description: 'Permanent position with salary, benefits package and payroll. Submit your resume.',
}, proof);
assert.equal(employment.outcome, 'reject');
assert.ok(employment.reasonCodes.includes('upwork_employee_role'));

const stale = evaluateUpworkSavedSearchLead({ ...base, freshnessMinutes: 15 * 24 * 60 }, proof);
assert.equal(stale.outcome, 'reject');
assert.ok(stale.reasonCodes.includes('stale_upwork_alert'));

const unclear = evaluateUpworkSavedSearchLead({
  ...base,
  budgetSignal: undefined,
  country: undefined,
  rawPayload: { jobType: 'unknown' },
}, proof);
assert.equal(unclear.outcome, 'research');
assert.ok(unclear.reasonCodes.includes('upwork_budget_unverified'));

console.log('Upwork saved-search scoring, rejection and research-band tests passed');
