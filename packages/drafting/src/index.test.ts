import assert from 'node:assert/strict';
import { matchPortfolio } from '@sales-automation/portfolio-matching';
import { recommendProfile } from '@sales-automation/routing';
import { scoreLead } from '@sales-automation/scoring';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import {
  attachIntentProvenance,
  buildIntentProvenance,
  COLD_NO_CONFIRMED_INTENT_WARNING,
  type Lead,
} from '@sales-automation/shared';
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

const coldLead: Lead = {
  id: 'sales-nav-cold-draft',
  source: 'sales_navigator',
  sourceUrl: 'https://www.linkedin.com/sales/lead/ACwAA-test,NAME_SEARCH',
  evidenceUrl: 'https://www.linkedin.com/sales/lead/ACwAA-test,NAME_SEARCH',
  leadType: 'sales_navigator_cold_prospect',
  prospectStage: 'cold_prospect',
  title: 'Delivery director at an agency',
  description: 'Public account, role and fit evidence only.',
  companyName: 'Example Agency',
  contactName: 'Alex Example',
  serviceCategory: 'fullstack_web_app',
  capturedAt: '2026-07-30T10:00:00.000Z',
  pipelineStatus: 'needs_human_review',
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:00:00.000Z',
};
const coldWithProvenance = attachIntentProvenance(
  coldLead,
  buildIntentProvenance(coldLead, [], '2026-07-31T10:00:00.000Z'),
);
const coldMatches = matchPortfolio({lead: coldWithProvenance, portfolioItems: samplePortfolioItems});
const coldScore = scoreLead({
  lead: coldWithProvenance,
  matchingPortfolioCount: coldMatches.length,
  hasStrongBuyerSignal: false,
  hasStrongBudgetSignal: false,
});
const coldProfile = recommendProfile(coldWithProvenance, coldScore);
const coldDrafts = generateDrafts({
  lead: coldWithProvenance,
  score: coldScore,
  profileRecommendation: coldProfile,
  portfolioMatches: coldMatches,
  generatedAt: '2026-07-31T10:00:00.000Z',
});

assert.equal(coldDrafts.length, 1);
assert.equal(coldDrafts[0]?.type, 'linkedin_dm');
assert.equal(coldDrafts[0]?.status, 'needs_review');
assert.match(coldDrafts[0]?.body ?? '', /fit hypothesis rather than a response to a confirmed request/i);
assert.match(coldDrafts[0]?.body ?? '', /have not seen confirmed buying intent/i);
assert.doesNotMatch(coldDrafts[0]?.body ?? '', /I saw your (?:post|request|need)/i);
assert.ok(coldDrafts[0]?.metadata.safeguards.includes(COLD_NO_CONFIRMED_INTENT_WARNING));
assert.ok(coldDrafts[0]?.metadata.assumptions.some((item) => /not confirmed buyer-authored demand/i.test(item)));
assert.equal(coldDrafts[0]?.metadata.requiresHumanApproval, true);

const linkedWarm: Lead = {
  ...coldLead,
  id: 'linked-warm-post',
  source: 'linkedin',
  sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
  evidenceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
  leadType: 'linkedin_warm_post',
  prospectStage: 'warm_lead',
  opportunityStatus: 'live_opportunity',
  title: 'Looking for a managed delivery partner',
};
const coldLinked = attachIntentProvenance(
  coldLead,
  buildIntentProvenance(coldLead, [linkedWarm], '2026-07-31T10:00:00.000Z'),
);
const linkedScore = scoreLead({
  lead: coldLinked,
  matchingPortfolioCount: coldMatches.length,
  hasStrongBuyerSignal: false,
  hasStrongBudgetSignal: false,
});
const linkedDrafts = generateDrafts({
  lead: coldLinked,
  score: linkedScore,
  profileRecommendation: recommendProfile(coldLinked, linkedScore),
  portfolioMatches: coldMatches,
  generatedAt: '2026-07-31T10:00:00.000Z',
});
assert.match(linkedDrafts[0]?.body ?? '', /separate buyer-authored demand evidence/i);
assert.match(linkedDrafts[0]?.body ?? '', /verify that evidence is current/i);
assert.ok(linkedDrafts[0]?.metadata.assumptions.some((item) => /rechecked for validity/i.test(item)));

console.log('Draft generator tests passed.');
