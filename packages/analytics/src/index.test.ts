import assert from 'node:assert/strict';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { buildAnalyticsReport, buildCalibrationReport, buildFunnelMetrics, recordOutcomeReason } from './index.js';

const generatedAt = '2026-07-08T21:00:00.000Z';
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

const wonLead = cloneLead('lead-upwork-rag-001', {
  id: 'analytics-won-rag',
  owner: 'bd-owner',
  pipelineStatus: 'new',
});
const lostLead = cloneLead('lead-linkedin-ai-001', {
  id: 'analytics-lost-linkedin',
  owner: 'bd-owner',
  pipelineStatus: 'new',
});
const rejectedLead = cloneLead('lead-upwork-lowbudget-001', {
  id: 'analytics-rejected-lowbudget',
  owner: 'junior-bd',
  pipelineStatus: 'new',
});
const researchLead = cloneLead('lead-linkedin-ai-001', {
  id: 'analytics-needs-research',
  owner: 'research-bd',
  leadType: 'linkedin_cold_prospect',
  prospectStage: 'cold_prospect',
  pipelineStatus: 'new',
});

for (const lead of [wonLead, lostLead, rejectedLead, researchLead]) {
  repository.saveEvaluation(
    evaluateLead({
      lead,
      portfolioItems: samplePortfolioItems,
      generatedAt,
    }),
    'analytics-test',
  );
}

repository.updateStatus(wonLead.id, 'approved_to_contact', 'analytics-test');
repository.updateStatus(wonLead.id, 'sent_manually', 'analytics-test');
repository.updateStatus(wonLead.id, 'replied', 'analytics-test');
repository.updateStatus(wonLead.id, 'meeting_booked', 'analytics-test');
repository.updateStatus(wonLead.id, 'proposal_sent', 'analytics-test');
repository.updateStatus(wonLead.id, 'won', 'analytics-test');
repository.recordOutcome(wonLead.id, {
  outcomeStatus: 'won',
  outcomeReason: 'Strong proof match',
  outcomeRecordedAt: generatedAt,
}, 'analytics-test');
repository.updateStatus(wonLead.id, 'archived', 'analytics-test');

repository.updateStatus(lostLead.id, 'approved_to_contact', 'analytics-test');
repository.updateStatus(lostLead.id, 'sent_manually', 'analytics-test');
repository.updateStatus(lostLead.id, 'replied', 'analytics-test');
repository.updateStatus(lostLead.id, 'meeting_booked', 'analytics-test');
repository.updateStatus(lostLead.id, 'proposal_sent', 'analytics-test');
repository.updateStatus(lostLead.id, 'lost', 'analytics-test');
repository.recordOutcome(lostLead.id, {
  outcomeStatus: 'no_response',
  outcomeReason: 'Client stopped responding',
  outcomeRecordedAt: generatedAt,
}, 'analytics-test');

repository.updateStatus(rejectedLead.id, 'rejected', 'analytics-test');
repository.recordOutcome(rejectedLead.id, {
  outcomeStatus: 'not_fit',
  outcomeReason: 'Low budget red flag',
  outcomeRecordedAt: generatedAt,
}, 'analytics-test');

repository.updateStatus(researchLead.id, 'needs_research', 'analytics-test');

const records = repository.listLeads();
const funnel = buildFunnelMetrics(records);
assert.equal(funnel.captured, 4);
assert.equal(funnel.scored, 4);
assert.equal(funnel.humanApproved, 2);
assert.equal(funnel.outreachSent, 2);
assert.equal(funnel.replies, 2);
assert.equal(funnel.meetings, 2);
assert.equal(funnel.proposals, 2);
assert.equal(funnel.won, 1);
assert.equal(funnel.lost, 1);
assert.equal(funnel.rejected, 1);
assert.equal(funnel.archived, 1);

const report = buildAnalyticsReport(records, {}, generatedAt);
assert.equal(report.generatedAt, generatedAt);
assert.equal(report.totalLeads, 4);
assert.equal(report.funnel.won, 1);
assert.equal(report.outcomes.winRate, 0.5);
assert.equal(report.bySource.upwork?.captured, 2);
assert.equal(report.bySource.linkedin?.captured, 2);
assert.equal(report.byOwner['bd-owner'].captured, 2);
assert.equal(report.winReasons['Strong proof match'], 1);
assert.equal(report.lossReasons['Client stopped responding'], 1);
assert.equal(report.rejectionReasons['Low budget red flag'], 1);
assert.ok(report.calibration.averageScore > 0);
assert.equal(report.calibration.scoreBands.reduce((total, band) => total + band.count, 0), 4);
assert.ok(report.calibration.falsePositiveLeadIds.includes(lostLead.id));

const ownerFiltered = buildAnalyticsReport(records, { owners: ['junior-bd'] }, generatedAt);
assert.equal(ownerFiltered.totalLeads, 1);
assert.equal(ownerFiltered.funnel.rejected, 1);
assert.equal(ownerFiltered.funnel.outreachSent, 0);

const sourceFiltered = buildAnalyticsReport(records, { sources: ['linkedin'] }, generatedAt);
assert.equal(sourceFiltered.totalLeads, 2);
assert.equal(sourceFiltered.funnel.lost, 1);
assert.equal(sourceFiltered.funnel.humanApproved, 1);

const calibration = buildCalibrationReport(records);
assert.equal(calibration.averageWonScore, repository.getLead(wonLead.id)?.latestEvaluation?.score.total);

const legacyRecord = structuredClone(repository.getLead(researchLead.id)!);
recordOutcomeReason(legacyRecord, 'loss', 'Legacy reason', 'analytics-test');
assert.equal(legacyRecord.lead.outcomeStatus, 'lost');
assert.equal(legacyRecord.lead.outcomeReason, 'Legacy reason');
assert.equal(legacyRecord.auditLog.at(-1)?.action, 'outcome_recorded');
assert.throws(() => recordOutcomeReason(legacyRecord, 'win', ' ', 'analytics-test'), /Outcome reason is required/);

console.log('Analytics report tests passed.');
