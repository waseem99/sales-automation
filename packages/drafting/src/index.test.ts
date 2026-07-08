import assert from 'node:assert/strict';
import { matchPortfolio } from '@sales-automation/portfolio-matching';
import { recommendProfile } from '@sales-automation/routing';
import { scoreLead } from '@sales-automation/scoring';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { generateDrafts } from './index.js';

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

assert.equal(ragDrafts.length, 1);
assert.equal(ragDrafts[0].type, 'upwork_proposal');
assert.equal(ragDrafts[0].metadata.requiresHumanApproval, true);
assert.ok(!ragDrafts[0].body.toLowerCase().includes('private'));

const linkedinLead = sampleLeads.find((lead) => lead.id === 'lead-linkedin-ai-001');
assert.ok(linkedinLead, 'LinkedIn sample lead should exist');

const linkedinPortfolioMatches = matchPortfolio({ lead: linkedinLead, portfolioItems: samplePortfolioItems });
const linkedinScore = scoreLead({
  lead: linkedinLead,
  matchingPortfolioCount: linkedinPortfolioMatches.length,
  hasStrongBuyerSignal: true,
  hasStrongBudgetSignal: true,
});
const linkedinProfile = recommendProfile(linkedinLead, linkedinScore);
const linkedinDrafts = generateDrafts({
  lead: linkedinLead,
  score: linkedinScore,
  profileRecommendation: linkedinProfile,
  portfolioMatches: linkedinPortfolioMatches,
  generatedAt: '2026-07-08T18:30:00.000Z',
});

assert.equal(linkedinDrafts.length, 2);
assert.ok(linkedinDrafts.some((draft) => draft.type === 'linkedin_comment'));
assert.ok(linkedinDrafts.some((draft) => draft.type === 'linkedin_dm'));

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
const rejectedDrafts = generateDrafts({
  lead: lowBudgetLead,
  score: lowBudgetScore,
  profileRecommendation: lowBudgetProfile,
  portfolioMatches: [],
  generatedAt: '2026-07-08T18:30:00.000Z',
});

assert.equal(rejectedDrafts.length, 0);

console.log('Draft generator tests passed.');
