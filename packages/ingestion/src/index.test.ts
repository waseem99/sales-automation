import assert from 'node:assert/strict';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import {
  getLeadDedupeKey,
  ingestLinkedInSignal,
  ingestLeads,
  ingestSourceBatch,
  ingestUpworkEmail,
  parseSourceBatch,
  splitSourceBlocks,
} from './index.js';
import type { Lead } from '@sales-automation/shared';

const generatedAt = '2026-07-08T20:15:00.000Z';
const repository = new InMemoryLeadRepository();

const upworkEmailBody = `
Job: Need AI RAG chatbot for internal documentation
https://www.upwork.com/jobs/example-rag-001
We need an expert AI developer to build a RAG chatbot over internal docs using OpenAI and vector search.
Budget: $5,000 - $10,000
Posted 20 minutes ago

---
Job: Need AI RAG chatbot for internal documentation duplicate
https://www.upwork.com/jobs/example-rag-001/
We need a similar RAG chatbot and dashboard.
Budget: $5,000 - $10,000
Posted 20 minutes ago
`;

const upworkResult = ingestUpworkEmail({
  email: {
    emailBody: upworkEmailBody,
    receivedAt: generatedAt,
  },
  repository,
  portfolioItems: samplePortfolioItems,
  generatedAt,
  actor: 'ingestion-test',
});

assert.equal(upworkResult.sourceKind, 'upwork_email');
assert.equal(upworkResult.totalInput, 2);
assert.equal(upworkResult.totalCaptured, 1);
assert.equal(upworkResult.totalSkipped, 1);
assert.equal(upworkResult.captured[0].evaluation.score.status, 'hot');
assert.equal(upworkResult.captured[0].alertEligible, true);
assert.equal(repository.listLeads().length, 1);
assert.equal(repository.listHotLeads().length, 1);
assert.equal(upworkResult.skippedDuplicates[0].reason, 'duplicate_source_url');

const secondUpworkResult = ingestUpworkEmail({
  email: {
    emailBody: upworkEmailBody,
    receivedAt: generatedAt,
  },
  repository,
  portfolioItems: samplePortfolioItems,
  generatedAt,
});
assert.equal(secondUpworkResult.totalCaptured, 0);
assert.equal(secondUpworkResult.totalSkipped, 2);

const linkedinResult = ingestLinkedInSignal({
  signal: {
    text: 'Posted 35 minutes ago. Looking for AI automation expert to help us automate customer support workflows with n8n and LLM agents. Need recommendations this week.',
    sourceUrl: 'https://www.linkedin.com/feed/update/example-ai-001',
    capturedAt: generatedAt,
    contactName: 'Example Founder',
    contactRole: 'Founder',
    companyName: 'Example Ops Co',
    country: 'United Kingdom',
  },
  repository,
  portfolioItems: samplePortfolioItems,
  generatedAt,
});

assert.equal(linkedinResult.sourceKind, 'linkedin_signal');
assert.equal(linkedinResult.totalCaptured, 1);
assert.equal(linkedinResult.captured[0].evaluation.lead.leadType, 'linkedin_warm_post');
assert.equal(linkedinResult.captured[0].evaluation.score.urgency, 'urgent');
assert.ok(repository.getLead(linkedinResult.captured[0].leadId)?.latestEvaluation);

const batchText = `Job: Need AI automation dashboard
https://www.upwork.com/jobs/batch-ai-dashboard-001
We need an AI automation expert for n8n and RAG. Budget $5,000. Posted 15 minutes ago.

---
Sales Navigator saved search alert
New lead alert: Jane Founder — COO at Example SaaS
Company: Example SaaS
Role: COO
Posted 35 minutes ago
Looking for AI automation partner to reduce support backlog.
https://www.linkedin.com/in/batch-jane-founder

---
Manual research note
Target account: Example Growth SaaS
Target prospect: Example COO — COO at Example Growth SaaS
Company: Example Growth SaaS
Role: COO
Need: funded B2B SaaS hiring support operations and discussing AI automation internally.
No direct buying post yet. Needs manual research and verification before outreach.
https://www.linkedin.com/in/batch-example-coo`;

const batchBlocks = splitSourceBlocks(batchText);
assert.equal(batchBlocks.length, 3);

const parsedBatchLeads = parseSourceBatch(batchText, generatedAt);
assert.equal(parsedBatchLeads.length, 3);
assert.equal(parsedBatchLeads[0].source, 'upwork');
assert.equal(parsedBatchLeads[1].source, 'sales_navigator');
assert.equal(parsedBatchLeads[1].prospectStage, 'warm_lead');
assert.equal(parsedBatchLeads[2].leadType, 'linkedin_cold_prospect');
assert.equal(parsedBatchLeads[2].pipelineStatus, 'needs_research');

const batchResult = ingestSourceBatch({
  batchText,
  capturedAt: generatedAt,
  repository,
  portfolioItems: samplePortfolioItems,
  generatedAt,
  actor: 'batch-test',
});
assert.equal(batchResult.sourceKind, 'source_batch');
assert.equal(batchResult.totalInput, 3);
assert.equal(batchResult.totalCaptured, 3);
assert.equal(batchResult.captured.some((item) => item.evaluation.lead.pipelineStatus === 'needs_research'), true);

const duplicateBatchResult = ingestSourceBatch({
  batchText,
  capturedAt: generatedAt,
  repository,
  portfolioItems: samplePortfolioItems,
  generatedAt,
});
assert.equal(duplicateBatchResult.totalCaptured, 0);
assert.equal(duplicateBatchResult.totalSkipped, 3);

const manualLead: Lead = {
  id: 'manual-enterprise-ai-001',
  source: 'manual',
  leadType: 'manual_lead',
  title: 'Enterprise AI automation review',
  description: 'A qualified enterprise team needs AI workflow automation and internal tools.',
  serviceCategory: 'ai_automation',
  budgetSignal: 'Potential $10k+ pilot',
  timelineSignal: 'Start this month',
  capturedAt: generatedAt,
  freshnessMinutes: 0,
  pipelineStatus: 'new',
  createdAt: generatedAt,
  updatedAt: generatedAt,
};

const manualResult = ingestLeads({
  sourceKind: 'manual_leads',
  leads: [manualLead, manualLead],
  repository,
  portfolioItems: samplePortfolioItems,
  generatedAt,
});

assert.equal(manualResult.totalCaptured, 1);
assert.equal(manualResult.totalSkipped, 1);
assert.equal(manualResult.skippedDuplicates[0].reason, 'duplicate_lead_id');
assert.equal(getLeadDedupeKey(manualLead), 'lead_id:manual-enterprise-ai-001');

console.log('Ingestion orchestrator and bulk source intake tests passed.');
