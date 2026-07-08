import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository, LocalJsonLeadRepository } from './index.js';

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

const tempDirectory = mkdtempSync(join(tmpdir(), 'sales-automation-storage-'));
try {
  const filePath = join(tempDirectory, 'leads.json');
  const localRepository = new LocalJsonLeadRepository({ filePath });
  assert.equal(localRepository.listLeads().length, 0);
  assert.equal(existsSync(filePath), true, 'Local repository should create the file when missing.');

  localRepository.saveEvaluation(evaluation, 'local-test');
  localRepository.updateStatus(lead.id, 'needs_human_review', 'local-test');
  localRepository.assignOwner(lead.id, 'persistent-owner', 'local-test');
  localRepository.addNote(lead.id, 'Persist this note.', 'local-test');
  localRepository.markAlertSent(lead.id, evaluation.alertPlan.dedupeKey, 'local-test');

  const reloadedRepository = new LocalJsonLeadRepository({ filePath });
  const reloadedLead = reloadedRepository.getLead(lead.id);
  assert.ok(reloadedLead, 'Lead should reload from the local JSON repository.');
  assert.equal(reloadedLead.latestEvaluation?.score.status, 'hot');
  assert.equal(reloadedLead.lead.pipelineStatus, 'needs_human_review');
  assert.equal(reloadedLead.lead.owner, 'persistent-owner');
  assert.deepEqual(reloadedLead.notes, ['Persist this note.']);
  assert.deepEqual(reloadedLead.alertDedupeKeysSent, [evaluation.alertPlan.dedupeKey]);
  assert.ok(reloadedRepository.listAuditLog(lead.id).some((entry) => entry.action === 'alert_marked_sent'));

  const invalidFilePath = join(tempDirectory, 'invalid.json');
  writeFileSync(invalidFilePath, '{not valid json', 'utf8');
  assert.throws(
    () => new LocalJsonLeadRepository({ filePath: invalidFilePath }),
    /Invalid local lead repository JSON/,
  );
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

console.log('Storage repository tests passed.');
