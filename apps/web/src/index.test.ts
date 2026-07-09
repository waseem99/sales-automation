import assert from 'node:assert/strict';
import { createSalesAutomationDashboardApi } from '@sales-automation/api';
import { StaticSessionAdapter } from '@sales-automation/auth';
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
  activeSavedView: 'hot_upwork_now',
  activeQuery: 'RAG',
  activePipelineStatus: 'new',
});

assert.ok(html.startsWith('<!doctype html>'));
assert.ok(html.includes('Codistan Lead Desk'));
assert.ok(html.includes('Try the MVP flow'));
assert.ok(html.includes('Evaluate lead'));
assert.ok(html.includes('Use Upwork sample'));
assert.ok(html.includes('Use LinkedIn sample'));
assert.ok(html.includes('Refresh dashboard'));
assert.ok(html.includes('Reset local data'));
assert.ok(html.includes('Saved views'));
assert.ok(html.includes('Search and filters'));
assert.ok(html.includes('Hot Upwork Now'));
assert.ok(html.includes('data-lead-id="lead-upwork-rag-001"'));
assert.ok(html.includes('?savedView=hot_upwork_now&amp;query=RAG&amp;status=new&amp;leadId=lead-upwork-rag-001'));
assert.ok(html.includes('data-status-form'));
assert.ok(html.includes('data-owner-form'));
assert.ok(html.includes('data-note-form'));
assert.ok(html.includes('Safe Review Actions'));
assert.ok(html.includes('Source Evidence'));
assert.ok(html.includes('Copy draft for manual review'));
assert.ok(html.includes('approved to contact'));
assert.ok(html.includes('Draft Preview'));
assert.ok(html.includes('Portfolio Proof'));
assert.ok(html.includes('Red Flags'));
assert.ok(html.includes('Review with Waseem before sending.'));
assert.ok(html.includes('Need &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; AI RAG chatbot'));
assert.ok(!html.includes('<script>alert'));

const context = {
  repository,
  portfolioItems: samplePortfolioItems,
  actor: 'web-route-test',
  role: 'admin' as const,
  now: () => generatedAt,
};

const sessionAdapter = new StaticSessionAdapter({
  'founder-token': {
    id: 'user-founder',
    email: 'founder@codistan.org',
    role: 'founder',
    isActive: true,
  },
  'readonly-token': {
    id: 'user-readonly',
    email: 'readonly@codistan.org',
    role: 'read_only',
    isActive: true,
  },
  'inactive-token': {
    id: 'user-inactive',
    email: 'inactive@codistan.org',
    role: 'admin',
    isActive: false,
  },
});

const health = handleSalesAutomationRequest({ method: 'GET', path: '/health' }, context);
assert.equal(health.status, 200);
assert.ok(health.body.includes('sales-automation-web'));

const dashboardResponse = handleSalesAutomationRequest({ method: 'GET', path: '/' }, context);
assert.equal(dashboardResponse.status, 200);
assert.equal(dashboardResponse.headers['content-type'], 'text/html; charset=utf-8');
assert.ok(dashboardResponse.body.includes('Codistan Lead Desk'));
assert.ok(dashboardResponse.body.includes('Try the MVP flow'));
assert.ok(dashboardResponse.body.includes('Saved views'));
assert.ok(dashboardResponse.body.includes('Search and filters'));
assert.ok(dashboardResponse.body.includes('Safe Review Actions'));
assert.ok(dashboardResponse.body.includes('Source Evidence'));

const savedViewDashboardResponse = handleSalesAutomationRequest(
  { method: 'GET', path: `/?savedView=hot_upwork_now&query=RAG&status=new&leadId=${escapedTitleLead.id}` },
  context,
);
assert.equal(savedViewDashboardResponse.status, 200);
assert.ok(savedViewDashboardResponse.body.includes('?savedView=hot_upwork_now&amp;query=RAG&amp;status=new&amp;leadId=lead-upwork-rag-001'));

const filteredDashboardResponse = handleSalesAutomationRequest(
  { method: 'GET', path: '/?query=RAG&status=new' },
  context,
);
assert.equal(filteredDashboardResponse.status, 200);
assert.ok(filteredDashboardResponse.body.includes('value="RAG"'));
assert.ok(filteredDashboardResponse.body.includes('value="new" selected'));

const staleLeadDashboardResponse = handleSalesAutomationRequest(
  { method: 'GET', path: '/?leadId=missing-lead' },
  context,
);
assert.equal(staleLeadDashboardResponse.status, 200);
assert.ok(staleLeadDashboardResponse.body.includes('Lead Detail'));

const anonymousSession = handleSalesAutomationRequest(
  { method: 'GET', path: '/api/session' },
  { repository, portfolioItems: samplePortfolioItems, now: () => generatedAt },
);
assert.equal(anonymousSession.status, 200);
assert.equal(JSON.parse(anonymousSession.body).authenticated, false);
assert.equal(JSON.parse(anonymousSession.body).role, 'read_only');

const founderSession = handleSalesAutomationRequest(
  { method: 'GET', path: '/api/session', headers: { authorization: 'Bearer founder-token' } },
  { repository, portfolioItems: samplePortfolioItems, sessionAdapter, now: () => generatedAt },
);
assert.equal(founderSession.status, 200);
assert.equal(JSON.parse(founderSession.body).authenticated, true);
assert.equal(JSON.parse(founderSession.body).role, 'founder');
assert.equal(JSON.parse(founderSession.body).actor, 'founder@codistan.org');

const anonymousDashboard = handleSalesAutomationRequest(
  { method: 'GET', path: '/' },
  { repository, portfolioItems: samplePortfolioItems, now: () => generatedAt },
);
assert.equal(anonymousDashboard.status, 200);

const anonymousIngestDenied = handleSalesAutomationRequest(
  {
    method: 'POST',
    path: '/api/ingest/upwork-email',
    body: {
      receivedAt: generatedAt,
      emailBody: `Job: Anonymous should not ingest
https://www.upwork.com/jobs/anonymous-denied
AI automation work. Budget $5,000. Posted 15 minutes ago`,
    },
  },
  { repository, portfolioItems: samplePortfolioItems, now: () => generatedAt },
);
assert.equal(anonymousIngestDenied.status, 403);

const summaryResponse = handleSalesAutomationRequest({ method: 'GET', path: '/api/summary' }, context);
assert.equal(summaryResponse.status, 200);
assert.equal(JSON.parse(summaryResponse.body).total, 1);

const listResponse = handleSalesAutomationRequest({ method: 'GET', path: '/api/opportunities?savedView=hot_upwork_now' }, context);
assert.equal(listResponse.status, 200);
assert.equal(JSON.parse(listResponse.body).length, 1);

const readOnlyListResponse = handleSalesAutomationRequest(
  { method: 'GET', path: '/api/opportunities' },
  { ...context, role: 'read_only' },
);
assert.equal(readOnlyListResponse.status, 200);

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
      emailBody: `Job: Need AI automation support
https://www.upwork.com/jobs/web-route-test-001
We need an AI automation expert for n8n and LLM workflows. Budget $5,000. Posted 15 minutes ago`,
    },
  },
  context,
);
assert.equal(upworkIngestResponse.status, 201);
assert.equal(JSON.parse(upworkIngestResponse.body).totalCaptured, 1);

const sessionIngestResponse = handleSalesAutomationRequest(
  {
    method: 'POST',
    path: '/api/ingest/upwork-email',
    headers: { authorization: 'Bearer founder-token' },
    body: {
      receivedAt: generatedAt,
      emailBody: `Job: Founder session can ingest
https://www.upwork.com/jobs/founder-session-ingest
AI automation work. Budget $5,000. Posted 15 minutes ago`,
    },
  },
  { repository, portfolioItems: samplePortfolioItems, sessionAdapter, now: () => generatedAt },
);
assert.equal(sessionIngestResponse.status, 201);
assert.equal(JSON.parse(sessionIngestResponse.body).totalCaptured, 1);

const readOnlySessionIngestResponse = handleSalesAutomationRequest(
  {
    method: 'POST',
    path: '/api/ingest/upwork-email',
    headers: { authorization: 'Bearer readonly-token' },
    body: {
      receivedAt: generatedAt,
      emailBody: `Job: Read-only session should not ingest
https://www.upwork.com/jobs/readonly-session-denied
AI automation work. Budget $5,000. Posted 15 minutes ago`,
    },
  },
  { repository, portfolioItems: samplePortfolioItems, sessionAdapter, now: () => generatedAt },
);
assert.equal(readOnlySessionIngestResponse.status, 403);

const inactiveSessionIngestResponse = handleSalesAutomationRequest(
  {
    method: 'POST',
    path: '/api/ingest/upwork-email',
    headers: { authorization: 'Bearer inactive-token' },
    body: {
      receivedAt: generatedAt,
      emailBody: `Job: Inactive session should not ingest
https://www.upwork.com/jobs/inactive-session-denied
AI automation work. Budget $5,000. Posted 15 minutes ago`,
    },
  },
  { repository, portfolioItems: samplePortfolioItems, sessionAdapter, now: () => generatedAt },
);
assert.equal(inactiveSessionIngestResponse.status, 403);

const readOnlyIngestResponse = handleSalesAutomationRequest(
  {
    method: 'POST',
    path: '/api/ingest/upwork-email',
    body: {
      receivedAt: generatedAt,
      emailBody: `Job: Read-only should not ingest
https://www.upwork.com/jobs/web-route-test-readonly
AI automation work. Budget $5,000. Posted 15 minutes ago`,
    },
  },
  { ...context, role: 'read_only' },
);
assert.equal(readOnlyIngestResponse.status, 403);
assert.ok(JSON.parse(readOnlyIngestResponse.body).error.includes('Forbidden'));

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

const readOnlyStatusResponse = handleSalesAutomationRequest(
  { method: 'POST', path: `/api/opportunities/${escapedTitleLead.id}/status`, body: { status: 'sent_manually' } },
  { ...context, role: 'read_only' },
);
assert.equal(readOnlyStatusResponse.status, 403);

const readOnlyResetResponse = handleSalesAutomationRequest(
  { method: 'POST', path: '/api/dev/reset-local-data', body: { confirmed: true } },
  { ...context, role: 'read_only' },
);
assert.equal(readOnlyResetResponse.status, 403);

const badRequest = handleSalesAutomationRequest(
  { method: 'POST', path: '/api/ingest/upwork-email', body: { emailBody: '' } },
  context,
);
assert.equal(badRequest.status, 400);

const notFound = handleSalesAutomationRequest({ method: 'GET', path: '/api/missing' }, context);
assert.equal(notFound.status, 404);

const resetResponse = handleSalesAutomationRequest(
  { method: 'POST', path: '/api/dev/reset-local-data', body: { confirmed: true } },
  context,
);
assert.equal(resetResponse.status, 200);
assert.equal(JSON.parse(resetResponse.body).ok, true);
assert.equal(repository.listLeads().length, 0);

console.log('Web dashboard renderer, visible MVP intake, demo readiness controls, route binding, and session resolution tests passed.');
