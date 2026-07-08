import assert from 'node:assert/strict';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from './index.js';

const repository = new InMemoryLeadRepository();
const lead = sampleLeads.find((item) => item.id === 'lead-upwork-rag-001');
assert.ok(lead, 'RAG sample lead should exist');

const evaluation = evaluateLead({
  lead,
  portfolioItems: samplePortfolioItems,
  generatedAt: '2026-07-08T18:30:00.000Z',
});

const record = repository.saveEvaluation(evaluation, 'test-runner');
assert.equal(record.lead.id, lead.id);
assert.equal(record.latestEvaluation?.score.status, 'hot');
assert.ok(record.auditLog.some((entry) => entry.action === 'evaluation_saved'));

repository.updateStatus(lead.id, 'needs_human_review', 'test-runner');
assert.equal(repository.getLead(lead.id)?.lead.pipelineStatus, 'needs_human_review');

repository.assignOwner(lead.id, 'ai-bd-owner', 'test-runner');
assert.equal(repository.getLead(lead.id)?.lead.owner, 'ai-bd-owner');

repository.addNote(lead.id, 'Needs quick review because this is fresh.', 'test-runner');
assert.equal(repository.getLead(lead.id)?.notes.length, 1);

repository.markAlertSent(lead.id, evaluation.alertPlan.dedupeKey, 'test-runner');
repository.markAlertSent(lead.id, evaluation.alertPlan.dedupeKey, 'test-runner');
assert.equal(repository.getLead(lead.id)?.alertDedupeKeysSent.length, 1);
assert.equal(repository.listHotLeads().length, 1);
assert.ok(repository.listAuditLog(lead.id).length >= 5);

console.log('Storage repository tests passed.');
