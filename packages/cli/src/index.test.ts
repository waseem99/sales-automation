import assert from 'node:assert/strict';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';

const ragLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-rag-001');
assert.ok(ragLead, 'RAG sample lead should exist');

const ragEvaluation = evaluateLead({ lead: ragLead, portfolioItems: samplePortfolioItems });
assert.equal(ragEvaluation.score.status, 'hot');
assert.equal(ragEvaluation.score.urgency, 'urgent');
assert.equal(ragEvaluation.profileRecommendation.primaryProfile, 'waseem_ai_founder_profile');
assert.equal(ragEvaluation.profileRecommendation.upworkProfile?.key, 'waseem_ai_ml');
assert.ok(ragEvaluation.portfolioMatches.length > 0);

const lowBudgetLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-lowbudget-001');
assert.ok(lowBudgetLead, 'Low budget sample lead should exist');

const lowBudgetEvaluation = evaluateLead({ lead: lowBudgetLead, portfolioItems: samplePortfolioItems });
assert.equal(lowBudgetEvaluation.score.status, 'rejected');
assert.ok(lowBudgetEvaluation.score.redFlags.length >= 2);

console.log('CLI/evaluator smoke tests passed.');
