import assert from 'node:assert/strict';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { evaluateLead } from './index.js';

const ragLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-rag-001');
assert.ok(ragLead, 'RAG sample lead should exist');

const ragEvaluation = evaluateLead({
  lead: ragLead,
  portfolioItems: samplePortfolioItems,
  generatedAt: '2026-07-08T18:30:00.000Z',
});

assert.equal(ragEvaluation.score.status, 'hot');
assert.equal(ragEvaluation.score.urgency, 'urgent');
assert.equal(ragEvaluation.profileRecommendation.primaryProfile, 'waseem_ai_founder_profile');
assert.equal(ragEvaluation.profileRecommendation.upworkProfile?.key, 'waseem_ai_ml');
assert.match(ragEvaluation.recommendedNextAction, /~016e9a7bda2340dcd9/);
assert.ok(ragEvaluation.portfolioMatches.length > 0);
assert.equal(ragEvaluation.drafts.length, 1);
assert.equal(ragEvaluation.drafts[0].metadata.requiresHumanApproval, true);
assert.equal(ragEvaluation.alertPlan.shouldAlert, true);
assert.ok(ragEvaluation.alertPlan.channels.includes('dashboard'));

const lowBudgetLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-lowbudget-001');
assert.ok(lowBudgetLead, 'Low budget sample lead should exist');

const lowBudgetEvaluation = evaluateLead({
  lead: lowBudgetLead,
  portfolioItems: samplePortfolioItems,
  generatedAt: '2026-07-08T18:30:00.000Z',
});

assert.equal(lowBudgetEvaluation.score.status, 'rejected');
assert.equal(lowBudgetEvaluation.drafts.length, 0);
assert.equal(lowBudgetEvaluation.alertPlan.shouldAlert, false);

console.log('Evaluator integration tests passed.');
