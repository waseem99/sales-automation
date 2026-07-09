import assert from 'node:assert/strict';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { createSalesAutomationDashboardApi } from './index.js';

const repository = new InMemoryLeadRepository();
const now = '2026-07-08T19:30:00.000Z';

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

const ragLead = cloneLead('lead-upwork-rag-001', {
  capturedAt: '2026-07-08T19:00:00.000Z',
  createdAt: '2026-07-08T19:00:00.000Z',
  updatedAt: '2026-07-08T19:00:00.000Z',
});
const lowBudgetLead = cloneLead('lead-upwork-lowbudget-001', {
  capturedAt: '2026-07-08T19:10:00.000Z',
  createdAt: '2026-07-08T19:10:00.000Z',
  updatedAt: '2026-07-08T19:10:00.000Z',
});

for (const lead of [ragLead, lowBudgetLead]) {
  repository.saveEvaluation(
    evaluateLead({
      lead,
      portfolioItems: samplePortfolioItems,
      generatedAt: now,
    }),
    'api-test',
  );
}

const api = createSalesAutomationDashboardApi(repository);

const opportunities = api.listOpportunities({ now });
assert.equal(opportunities.length, 2);
assert.equal(opportunities[0].id, ragLead.id);

const summary = api.getDashboardSummary(now);
assert.equal(summary.total, 2);
assert.equal(summary.hot, 1);
assert.equal(summary.rejected, 1);

let detail = api.getLeadDetail(ragLead.id, now);
assert.equal(detail.id, ragLead.id);
assert.ok(detail.drafts.length > 0);
assert.ok(detail.allowedStatusActions.includes('approved_to_contact'));

detail = api.assignLeadOwner({
  leadId: ragLead.id,
  owner: ' bd-owner ',
  actor: 'api-test',
});
assert.equal(detail.owner, 'bd-owner');

detail = api.addLeadNote({
  leadId: ragLead.id,
  note: ' Ready for founder review. ',
  actor: 'api-test',
});
assert.equal(detail.notes.length, 1);
assert.equal(detail.notes[0], 'Ready for founder review.');

detail = api.updateLeadStatus({
  leadId: ragLead.id,
  status: 'approved_to_contact',
  actor: 'api-test',
});
assert.equal(detail.pipelineStatus, 'approved_to_contact');

assert.throws(
  () => api.updateLeadStatus({ leadId: ragLead.id, status: 'won', actor: 'api-test' }),
  /Invalid status transition/,
);

const alertDetail = api.markAlertSent({
  leadId: ragLead.id,
  actor: 'api-test',
});
const stored = repository.getLead(alertDetail.id);
assert.ok(stored, 'Lead should remain stored after alert dedupe update.');
assert.equal(stored.alertDedupeKeysSent.length, 1);

assert.throws(
  () => api.assignLeadOwner({ leadId: ragLead.id, owner: ' ', actor: 'api-test' }),
  /Owner is required/,
);

assert.throws(
  () => api.addLeadNote({ leadId: ragLead.id, note: ' ', actor: 'api-test' }),
  /Note is required/,
);

assert.throws(
  () => api.getLeadDetail('missing-lead'),
  /Lead not found/,
);

console.log('Dashboard controller API tests passed.');
