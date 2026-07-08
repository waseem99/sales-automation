import assert from 'node:assert/strict';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { generateDrafts } from './index.js';

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

assert.equal(ragDrafts.length, 1);
assert.equal(ragDrafts[0].type, 'upwork_proposal');
assert.equal(ragDrafts[0].metadata.requiresHumanApproval, true);
assert.ok(!ragDrafts[0].body.toLowerCase().includes('private'));

const linkedinLead = sampleLeads.find((lead) => lead.id === 'lead-linkedin-ai-001');
assert.ok(linkedinLead, 'LinkedIn sample lead should exist');

const linkedinEvaluation = evaluateLead({ lead: linkedinLead, portfolioItems: samplePortfolioItems });
const linkedinDrafts = generateDrafts({
  lead: linkedinEvaluation.lead,
  score: linkedinEvaluation.score,
  profileRecommendation: linkedinEvaluation.profileRecommendation,
  portfolioMatches: linkedinEvaluation.portfolioMatches,
  generatedAt: '2026-07-08T18:30:00.000Z',
});

assert.equal(linkedinDrafts.length, 2);
assert.ok(linkedinDrafts.some((draft) => draft.type === 'linkedin_comment'));
assert.ok(linkedinDrafts.some((draft) => draft.type === 'linkedin_dm'));

const lowBudgetLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-lowbudget-001');
assert.ok(lowBudgetLead, 'Low budget sample lead should exist');

const lowBudgetEvaluation = evaluateLead({ lead: lowBudgetLead, portfolioItems: samplePortfolioItems });
const rejectedDrafts = generateDrafts({
  lead: lowBudgetEvaluation.lead,
  score: lowBudgetEvaluation.score,
  profileRecommendation: lowBudgetEvaluation.profileRecommendation,
  portfolioMatches: lowBudgetEvaluation.portfolioMatches,
  generatedAt: '2026-07-08T18:30:00.000Z',
});

assert.equal(rejectedDrafts.length, 0);

console.log('Draft generator tests passed.');
