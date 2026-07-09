import assert from 'node:assert/strict';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import type { Lead } from '@sales-automation/shared';
import {
  buildDashboardSummary,
  buildLeadDetail,
  buildOpportunityList,
  getAllowedStatusActions,
  isFollowUpOverdue,
  isOverdue,
} from './index.js';

const now = '2026-07-08T19:15:00.000Z';
const repository = new InMemoryLeadRepository();

function cloneLead(leadId: string, overrides: Partial<Lead> = {}): Lead {
  const lead = sampleLeads.find((item) => item.id === leadId);
  assert.ok(lead, `Sample lead should exist: ${leadId}`);
  return {
    ...lead,
    ...overrides,
    id: overrides.id ?? lead.id,
    createdAt: overrides.createdAt ?? lead.createdAt,
    updatedAt: overrides.updatedAt ?? lead.updatedAt,
  };
}

const overdueUpworkLead = cloneLead('lead-upwork-rag-001', {
  capturedAt: '2026-07-08T18:30:00.000Z',
  createdAt: '2026-07-08T18:30:00.000Z',
  updatedAt: '2026-07-08T18:30:00.000Z',
  freshnessMinutes: 25,
});
const linkedinLead = cloneLead('lead-linkedin-ai-001', {
  capturedAt: '2026-07-08T18:45:00.000Z',
  createdAt: '2026-07-08T18:45:00.000Z',
  updatedAt: '2026-07-08T18:45:00.000Z',
  freshnessMinutes: 30,
});
const coldProspect = cloneLead('lead-salesnav-cold-ai-001', {
  capturedAt: '2026-07-08T18:50:00.000Z',
  createdAt: '2026-07-08T18:50:00.000Z',
  updatedAt: '2026-07-08T18:50:00.000Z',
});
const lowBudgetLead = cloneLead('lead-upwork-lowbudget-001', {
  capturedAt: '2026-07-08T19:00:00.000Z',
  createdAt: '2026-07-08T19:00:00.000Z',
  updatedAt: '2026-07-08T19:00:00.000Z',
});

for (const lead of [overdueUpworkLead, linkedinLead, coldProspect, lowBudgetLead]) {
  repository.saveEvaluation(
    evaluateLead({
      lead,
      portfolioItems: samplePortfolioItems,
      generatedAt: now,
    }),
    'dashboard-test',
  );
}

repository.assignOwner(overdueUpworkLead.id, 'bd-owner', 'dashboard-test');
repository.addNote(overdueUpworkLead.id, 'Needs immediate review.', 'dashboard-test');
repository.scheduleFollowUp(overdueUpworkLead.id, {
  nextFollowUpAt: '2026-07-08T19:00:00.000Z',
  followUpNote: 'Follow up before end of day.',
}, 'dashboard-test');
repository.recordOutcome(lowBudgetLead.id, {
  outcomeStatus: 'rejected',
  outcomeReason: 'Budget and timeline are not a fit.',
  outcomeRecordedAt: now,
}, 'dashboard-test');

const records = repository.listLeads();
const list = buildOpportunityList(records, { now });

assert.equal(list.length, 4);
assert.equal(list[0].id, overdueUpworkLead.id, 'Overdue hot Upwork lead should sort first by default priority.');
assert.equal(list[0].overdue, true);
assert.equal(list[0].followUpOverdue, true);
assert.equal(list[0].owner, 'bd-owner');

const hotUpworkNow = buildOpportunityList(records, { savedView: 'hot_upwork_now', now });
assert.equal(hotUpworkNow.length, 1);
assert.equal(hotUpworkNow[0].source, 'upwork');
assert.equal(hotUpworkNow[0].alertEligible, true);

const dueFollowUps = buildOpportunityList(records, { savedView: 'due_follow_ups', now });
assert.equal(dueFollowUps.length, 1);
assert.equal(dueFollowUps[0].id, overdueUpworkLead.id);
assert.equal(dueFollowUps[0].nextFollowUpAt, '2026-07-08T19:00:00.000Z');

const warmLeads = buildOpportunityList(records, { savedView: 'warm_leads', now });
assert.ok(warmLeads.some((item) => item.id === overdueUpworkLead.id));
assert.ok(warmLeads.some((item) => item.id === linkedinLead.id));
assert.ok(!warmLeads.some((item) => item.id === coldProspect.id));

const coldProspects = buildOpportunityList(records, { savedView: 'cold_prospects', now });
assert.equal(coldProspects.length, 1);
assert.equal(coldProspects[0].prospectStage, 'cold_prospect');
assert.equal(coldProspects[0].urgency, 'normal');

const needsResearch = buildOpportunityList(records, { savedView: 'needs_research', now });
assert.equal(needsResearch.length, 1);
assert.equal(needsResearch[0].pipelineStatus, 'needs_research');

const aiAutomation = buildOpportunityList(records, { savedView: 'ai_automation_leads', now });
assert.ok(aiAutomation.some((item) => item.id === linkedinLead.id));
assert.ok(aiAutomation.some((item) => item.id === coldProspect.id));
assert.ok(!aiAutomation.some((item) => item.id === lowBudgetLead.id));

const rejected = buildOpportunityList(records, {
  filters: {
    qualificationStatuses: ['rejected'],
    hasRedFlags: true,
  },
  now,
});
assert.equal(rejected.length, 1);
assert.equal(rejected[0].id, lowBudgetLead.id);
assert.equal(rejected[0].outcomeStatus, 'rejected');
assert.equal(rejected[0].outcomeReason, 'Budget and timeline are not a fit.');

const ragRecord = repository.getLead(overdueUpworkLead.id);
assert.ok(ragRecord, 'RAG lead should be saved.');
const detail = buildLeadDetail(ragRecord, now);

assert.equal(detail.id, overdueUpworkLead.id);
assert.equal(detail.prospectStage, 'warm_lead');
assert.ok(detail.portfolioMatches.length > 0);
assert.ok(detail.drafts.length > 0);
assert.equal(detail.notes.length, 1);
assert.equal(detail.followUpNote, 'Follow up before end of day.');
assert.ok(detail.allowedStatusActions.includes('approved_to_contact'));
assert.ok(detail.allowedStatusActions.includes('needs_research'));
assert.equal(isOverdue(ragRecord, now), true);
assert.equal(isFollowUpOverdue(ragRecord, now), true);

const summary = buildDashboardSummary(records, now);
assert.equal(summary.total, 4);
assert.equal(summary.hot, 2);
assert.equal(summary.qualified, 1);
assert.equal(summary.rejected, 1);
assert.equal(summary.overdue, 1);
assert.equal(summary.dueFollowUps, 1);
assert.equal(summary.outcomesRecorded, 1);
assert.equal(summary.bySource.upwork, 2);
assert.equal(summary.bySource.linkedin, 1);
assert.equal(summary.bySource.sales_navigator, 1);
assert.equal(summary.byProspectStage.warm_lead, 3);
assert.equal(summary.byProspectStage.cold_prospect, 1);

assert.deepEqual(getAllowedStatusActions('archived'), []);
assert.ok(getAllowedStatusActions('proposal_sent').includes('won'));
assert.ok(getAllowedStatusActions('needs_research').includes('approved_to_contact'));

console.log('Dashboard model tests passed.');
