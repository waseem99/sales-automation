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
assert.deepEqual(ragEvaluation.profileRecommendation.upworkProfile?.targetHourlyRateRangeUsd, { min: 35, max: 50 });
assert.match(ragEvaluation.recommendedNextAction, /~016e9a7bda2340dcd9/);
assert.match(ragEvaluation.recommendedNextAction, /\$35–\$50\/hour/);
assert.ok(ragEvaluation.portfolioMatches.length > 0);
assert.equal(ragEvaluation.drafts.length, 1);
assert.equal(ragEvaluation.drafts[0].metadata.requiresHumanApproval, true);
assert.equal(ragEvaluation.alertPlan.shouldAlert, true);
assert.ok(ragEvaluation.alertPlan.channels.includes('dashboard'));
assert.ok(ragEvaluation.closeability.total >= 60);
assert.ok(['priority_a', 'priority_b', 'research'].includes(ragEvaluation.closeability.band));
assert.equal(ragEvaluation.closeability.breakdown.activeRequirement, 17);
assert.equal(ragEvaluation.closeability.estimatedValueBand, '5k_15k');
assert.ok(ragEvaluation.closeability.missingData.some((gap) => /buyer|decision-maker/i.test(gap)));

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
assert.equal(lowBudgetEvaluation.closeability.band, 'reject');
assert.equal(lowBudgetEvaluation.closeability.estimatedValueBand, 'under_5k');

const founderLead = sampleLeads.find((lead) => lead.id === 'lead-linkedin-ai-001');
assert.ok(founderLead, 'Founder sample lead should exist');
const founderEvaluation = evaluateLead({
  lead: {
    ...founderLead,
    companyName: 'Example Operations Company',
    companyWebsite: 'https://examplecompany.co',
    contactEmail: 'founder@examplecompany.co',
    description: 'The founder is seeking an external implementation partner to automate customer support and internal operations with AI agents. The company wants to start immediately.',
    opportunityStatus: 'live_opportunity',
  },
  portfolioItems: samplePortfolioItems,
  generatedAt: '2026-07-08T18:30:00.000Z',
});
assert.equal(founderEvaluation.closeability.breakdown.activeRequirement, 20);
assert.equal(founderEvaluation.closeability.breakdown.buyerIdentified, 10);
assert.equal(founderEvaluation.closeability.breakdown.verifiedContactRoute, 10);
assert.ok(founderEvaluation.closeability.total >= 85);
assert.equal(founderEvaluation.closeability.band, 'priority_a');

console.log('Evaluator relevance and closeability integration tests passed.');
