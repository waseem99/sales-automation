import assert from 'node:assert/strict';
import { generateDrafts } from '@sales-automation/drafting';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { buildAlertPlan, isDuplicateAlert } from './index.js';

const ragLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-rag-001');
assert.ok(ragLead, 'RAG sample lead should exist');

const ragEvaluation = evaluateLead({ lead: ragLead, portfolioItems: samplePortfolioItems });
const ragDrafts = generateDrafts({
  lead: ragEvaluation.lead,
  score: ragEvaluation.score,
  profileRecommendation: ragEvaluation.profileRecommendation,
  portfolioMatches: ragEvaluation.portfolioMatches,
  generatedAt: '2026-07-08T18:30:00.000Z',
});

const ragAlert = buildAlertPlan({
  lead: ragEvaluation.lead,
  score: ragEvaluation.score,
  profileRecommendation: ragEvaluation.profileRecommendation,
  portfolioMatches: ragEvaluation.portfolioMatches,
  drafts: ragDrafts,
  recommendedNextAction: ragEvaluation.recommendedNextAction,
});

assert.equal(ragAlert.shouldAlert, true);
assert.equal(ragAlert.priority, 'urgent');
assert.ok(ragAlert.channels.includes('dashboard'));
assert.ok(ragAlert.channels.includes('log'));
assert.equal(isDuplicateAlert(ragAlert.dedupeKey, new Set([ragAlert.dedupeKey])), true);

const lowBudgetLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-lowbudget-001');
assert.ok(lowBudgetLead, 'Low budget sample lead should exist');

const lowBudgetEvaluation = evaluateLead({ lead: lowBudgetLead, portfolioItems: samplePortfolioItems });
const lowBudgetAlert = buildAlertPlan({
  lead: lowBudgetEvaluation.lead,
  score: lowBudgetEvaluation.score,
  profileRecommendation: lowBudgetEvaluation.profileRecommendation,
  portfolioMatches: lowBudgetEvaluation.portfolioMatches,
  drafts: [],
  recommendedNextAction: lowBudgetEvaluation.recommendedNextAction,
});

assert.equal(lowBudgetAlert.shouldAlert, false);
assert.deepEqual(lowBudgetAlert.channels, []);

console.log('Alert planner tests passed.');
