import assert from 'node:assert/strict';
import { createSalesAutomationDashboardApi } from '@sales-automation/api';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { renderDashboardPage } from './index.js';
import { handleSalesAutomationRequest } from './server.js';

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

const context = {
  repository,
  portfolioItems: samplePortfolioItems,
  actor: 'web-route-test',
  now: () => generatedAt,
};

const health = handleSalesAutomationRequest({ method: 'GET', path: '/health' }, context);
assert.equal(health.status, 200);
assert.ok(health.body.includes('sales-automation-web'));

const dashboardResponse = handleSalesAutomationRequest({ method: 'GET', path: '/' }, context);
assert.equal(dashboardResponse.status, 200);
assert.equal(dashboardResponse.headers['content-type'], 'text/html; charset=utf-8');
assert.ok(dashboardResponse.body.includes('Codistan Lead Desk'));

const summaryResponse = handleSalesAutomationRequest({ method: 'GET', path: '/api/summary' }, context);
assert.equal(summaryResponse.status, 200);
assert.equal(JSON.parse(summaryResponse.body).total, 1);

const listResponse = handleSalesAutomationRequest({ method: 'GET', path: '/api/opportunities?savedView=hot_upwork_now' }, context);
assert.equal(listResponse.status, 200);
assert.equal(JSON.parse(listResponse.body).length, 1);

const detailResponse = handleSalesAutomationRequest({ method: 'GET', path: `/api/opportunities/${escapedTitleLead.id}` }, context);
assert.equal(detailResponse.status, 200);
assert.equal(JSON.parse(detailResponse.body).id, escapedTitleLead.id);

const ownerResponse = handleSalesAutomationRequest(
  { method: 'POST', path: `/api/opportunities/${escapedTitleLead.id}/owner`, body: { owner: 'new-owner' } },
  context,
);
assert.equal(ownerResponse.status, 200);
assert.equal(JSON.parse(ownerResponse.body).owner, 'new-owner');

const noteResponse = handleSalesAutomationRequest(
  { method: 'POST', path: `/api/opportunities/${escapedTitleLead.id}/notes`, body: { note: 'API note added.' } },
  context,
);
assert.equal(noteResponse.status, 200);
assert.equal(JSON.parse(noteResponse.body).notes.length, 2);

const statusResponse = handleSalesAutomationRequest(
  { method: 'POST', path: `/api/opportunities/${escapedTitleLead.id}/status`, body: { status: 'approved_to_contact' } },
  context,
);
assert.equal(statusResponse.status, 200);
assert.equal(JSON.parse(statusResponse.body).pipelineStatus, 'approved_to_contact');

const upworkIngestResponse = handleSalesAutomationRequest(
  {
    method: 'POST',
    path: '/api/ingest/upwork-email',
    body: {
      receivedAt: generatedAt,
      emailBody: `Job: Need AI automation support\nhttps://www.upwork.com/jobs/web-route-test-001\nWe need an AI automation expert for n8n and LLM workflows. Budget $5,000. Posted 15 minutes ago`,
    },
  },
  context,
);
assert.equal(upworkIngestResponse.status, 201);
assert.equal(JSON.parse(upworkIngestResponse.body).totalCaptured, 1);

const linkedinIngestResponse = handleSalesAutomationRequest(
  {
    method: 'POST',
    path: '/api/ingest/linkedin-signal',
    body: {
      text: 'Posted 20 minutes ago. Looking for AI partner to help with RAG and workflow automation.',
      sourceUrl: 'https://www.linkedin.com/feed/update/web-route-test-001',
      capturedAt: generatedAt,
      contactName: 'Example Founder',
    },
  },
  context,
);
assert.equal(linkedinIngestResponse.status, 201);
assert.equal(JSON.parse(linkedinIngestResponse.body).totalCaptured, 1);

const manualLead: Lead = {
  id: 'manual-web-route-001',
  source: 'manual',
  leadType: 'manual_lead',
  title: 'Manual AI opportunity',
  description: 'Qualified internal manual lead for AI automation.',
  serviceCategory: 'ai_automation',
  budgetSignal: '$10,000 pilot',
  timelineSignal: 'This month',
  capturedAt: generatedAt,
  pipelineStatus: 'new',
  createdAt: generatedAt,
  updatedAt: generatedAt,
};
const manualIngestResponse = handleSalesAutomationRequest(
  { method: 'POST', path: '/api/ingest/manual-leads', body: { leads: [manualLead] } },
  context,
);
assert.equal(manualIngestResponse.status, 201);
assert.equal(JSON.parse(manualIngestResponse.body).totalCaptured, 1);

const badRequest = handleSalesAutomationRequest(
  { method: 'POST', path: '/api/ingest/upwork-email', body: { emailBody: '' } },
  context,
);
assert.equal(badRequest.status, 400);

const notFound = handleSalesAutomationRequest({ method: 'GET', path: '/api/missing' }, context);
assert.equal(notFound.status, 404);

console.log('Web dashboard renderer and route binding tests passed.');
