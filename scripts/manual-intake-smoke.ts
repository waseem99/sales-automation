import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import {
  ingestManualOpportunity,
  ingestSourceBatch,
} from '@sales-automation/ingestion';
import {
  applyAutomaticAssignment,
  buildOwnerWorkload,
} from '@sales-automation/prospect-discovery';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { auditMissingFirstOutreachGuidance } from '@sales-automation/web';

const generatedAt = '2026-07-14T18:30:00.000Z';
const repository = new InMemoryLeadRepository();

const referral = ingestManualOpportunity({
  opportunity: {
    kind: 'referral_note',
    content: 'Referral from a current client. A Canadian nonprofit has an approved fixed-scope digital platform and CRM integration project for this quarter.',
    capturedAt: generatedAt,
    companyName: 'Example Foundation',
    contactName: 'Sarah Example',
    contactRole: 'Operations Director',
    country: 'Canada',
  },
  repository,
  portfolioItems: samplePortfolioItems,
  actor: 'waseem@codistan.org',
  generatedAt,
});
assert.equal(referral.totalCaptured, 1);
assert.equal(referral.totalSkipped, 0);

const batch = ingestSourceBatch({
  batchText: `Job: Need an AI automation dashboard\nhttps://www.upwork.com/jobs/manual-smoke-001\nWe need an n8n and RAG implementation. Budget $6,000. Posted 15 minutes ago.\n\n---\nSales Navigator saved search alert\nNew lead alert: Jane Founder — COO at Example SaaS\nCompany: Example SaaS\nLooking for an AI automation partner to reduce support backlog.\nhttps://www.linkedin.com/in/manual-smoke-jane`,
  capturedAt: generatedAt,
  repository,
  portfolioItems: samplePortfolioItems,
  actor: 'waseem@codistan.org',
  generatedAt,
});
assert.equal(batch.totalCaptured, 2);

const duplicate = ingestManualOpportunity({
  opportunity: {
    kind: 'referral_note',
    content: 'Referral from a current client. A Canadian nonprofit has an approved fixed-scope digital platform and CRM integration project for this quarter.',
    capturedAt: generatedAt,
    companyName: 'Example Foundation',
    contactName: 'Sarah Example',
    contactRole: 'Operations Director',
    country: 'Canada',
  },
  repository,
  portfolioItems: samplePortfolioItems,
  actor: 'waseem@codistan.org',
  generatedAt,
});
assert.equal(duplicate.totalCaptured, 0);
assert.equal(duplicate.totalSkipped, 1);

const workload = buildOwnerWorkload(repository.listLeads().map((record) => record.lead));
for (const record of repository.listLeads()) {
  const applied = applyAutomaticAssignment(record.lead, workload, generatedAt);
  repository.upsertLead(applied.lead, 'manual-intake-smoke');
  repository.addNote(
    record.lead.id,
    `routing::automatic::${applied.assignment.owner}::${applied.approach.channel}::${applied.assignment.reason}`,
    'manual-intake-smoke',
  );
}
const guidance = auditMissingFirstOutreachGuidance({
  repository,
  portfolioItems: samplePortfolioItems,
  actor: 'manual-intake-smoke',
  generatedAt,
});
assert.equal(guidance.audited, 3);
assert.ok(repository.listLeads().every((record) => Boolean(record.lead.owner)));
assert.ok(repository.listLeads().every((record) => Boolean(record.lead.draftMessage)));
assert.ok(repository.listLeads().every((record) => record.notes.some((note) => note.startsWith('ingestion::'))));
assert.ok(repository.listLeads().every((record) => record.notes.some((note) => note.startsWith('guidance::first_outreach::'))));

const runtimeSource = readFileSync(new URL('../api/dashboard-runtime.ts', import.meta.url), 'utf8');
const manualRuntimeSource = readFileSync(new URL('../vercel/manual-intake-runtime.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../apps/web/src/paginated-prospects-page.ts', import.meta.url), 'utf8');
assert.match(runtimeSource, /\/api\/prospects\/manual-intake/);
assert.match(runtimeSource, /manual-intake-runtime/);
assert.match(manualRuntimeSource, /externalActionAutomated: false/);
assert.match(manualRuntimeSource, /auditMissingFirstOutreachGuidance/);
assert.match(pageSource, /manual-intake-dialog/);
assert.match(pageSource, /manual-intake-form/);
assert.match(pageSource, /\/api\/prospects\/manual-intake/);

console.log('Approved manual source intake, deduplication, assignment and guidance smoke tests passed');
