import assert from 'node:assert/strict';
import { createSalesAutomationDashboardApi } from '@sales-automation/api';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { renderDashboardPage } from './index.js';

const repository = new InMemoryLeadRepository();
const generatedAt = '2026-07-08T20:00:00.000Z';
const lead = sampleLeads.find((item) => item.id === 'lead-upwork-rag-001');
assert.ok(lead, 'RAG sample lead should exist.');

const escapedTitleLead: Lead = {
  ...lead,
  title: 'Need <script>alert("x")</script> AI RAG chatbot',
  updatedAt: generatedAt,
};

repository.saveEvaluation(
  evaluateLead({
    lead: escapedTitleLead,
    portfolioItems: samplePortfolioItems,
    generatedAt,
  }),
  'web-test',
);
repository.assignOwner(escapedTitleLead.id, 'bd-owner', 'web-test');
repository.addNote(escapedTitleLead.id, 'Review with Waseem before sending.', 'web-test');

const api = createSalesAutomationDashboardApi(repository);
const opportunities = api.listOpportunities({ now: generatedAt });
const selectedLead = api.getLeadDetail(escapedTitleLead.id, generatedAt);
const html = renderDashboardPage({
  title: 'Codistan Lead Desk',
  summary: api.getDashboardSummary(generatedAt),
  opportunities,
  selectedLead,
});

assert.ok(html.startsWith('<!doctype html>'));
assert.ok(html.includes('Codistan Lead Desk'));
assert.ok(html.includes('No fixed daily lead limits'));
assert.ok(html.includes('data-lead-id="lead-upwork-rag-001"'));
assert.ok(html.includes('Allowed Next Statuses'));
assert.ok(html.includes('Review with Waseem before sending.'));
assert.ok(html.includes('Need &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; AI RAG chatbot'));
assert.ok(!html.includes('<script>alert'));

console.log('Web dashboard renderer tests passed.');
