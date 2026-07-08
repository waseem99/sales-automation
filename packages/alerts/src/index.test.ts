import assert from 'node:assert/strict';
import { generateDrafts } from '@sales-automation/drafting';
import { matchPortfolio } from '@sales-automation/portfolio-matching';
import { recommendProfile } from '@sales-automation/routing';
import { scoreLead } from '@sales-automation/scoring';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { buildAlertPlan, isDuplicateAlert } from './index.js';

const ragLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-rag-001');
assert.ok(ragLead, 'RAG sample lead should exist');

const ragPortfolioMatches = matchPortfolio({ lead: ragLead, portfolioItems: samplePortfolioItems });
const ragScore = scoreLead({
  lead: ragLead,
  matchingPortfolioCount: ragPortfolioMatches.length,
  hasStrongBuyerSignal: true,
  hasStrongBudgetSignal: true,
});
const ragProfile = recommendProfile(ragLead, ragScore);
const ragDrafts = generateDrafts({
  lead: ragLead,
  score: ragScore,
  profileRecommendation: ragProfile,
  portfolioMatches: ragPortfolioMatches,
  generatedAt: '2026-07-08T18:30:00.000Z',
});

const ragAlert = buildAlertPlan({
  lead: ragLead,
  score: ragScore,
  profileRecommendation: ragProfile,
  portfolioMatches: ragPortfolioMatches,
  drafts: ragDrafts,
  recommendedNextAction: 'Review immediately and prepare a tailored response.',
});

assert.equal(ragAlert.shouldAlert, true);
assert.equal(ragAlert.priority, 'urgent');
assert.ok(ragAlert.channels.includes('dashboard'));
assert.ok(ragAlert.channels.includes('log'));
assert.equal(isDuplicateAlert(ragAlert.dedupeKey, new Set([ragAlert.dedupeKey])), true);

const lowBudgetLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-lowbudget-001');
assert.ok(lowBudgetLead, 'Low budget sample lead should exist');

const lowBudgetScore = scoreLead({
  lead: lowBudgetLead,
  matchingPortfolioCount: 0,
  hasStrongBuyerSignal: false,
  hasStrongBudgetSignal: false,
  redFlags: [
    { code: 'low_budget_signal', severity: 'high', reason: 'Budget signal appears too low for Codistan target opportunities.' },
    { code: 'free_work_request', severity: 'high', reason: 'Lead appears to request free or unpaid sample work.' },
  ],
});
const lowBudgetProfile = recommendProfile(lowBudgetLead, lowBudgetScore);
const lowBudgetAlert = buildAlertPlan({
  lead: lowBudgetLead,
  score: lowBudgetScore,
  profileRecommendation: lowBudgetProfile,
  portfolioMatches: [],
  drafts: [],
  recommendedNextAction: 'Reject or archive.',
});

assert.equal(lowBudgetAlert.shouldAlert, false);
assert.deepEqual(lowBudgetAlert.channels, []);

console.log('Alert planner tests passed.');
