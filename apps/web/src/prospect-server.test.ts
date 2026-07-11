import assert from 'node:assert/strict';
import { once } from 'node:events';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryProspectDiscoveryRunStore, type ProspectDiscoveryResult } from '@sales-automation/prospect-discovery';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { createProspectDashboardHttpServer } from './prospect-server.js';

const now = '2026-07-11T12:00:00.000Z';
const repository = new InMemoryLeadRepository();
const runStore = new InMemoryProspectDiscoveryRunStore();
const lead: Lead = {
  id: 'prospect-test-001',
  source: 'public_web',
  sourceUrl: 'https://example.com/opportunity',
  leadType: 'public_opportunity',
  prospectStage: 'warm_lead',
  title: 'Seeking an AI implementation partner',
  description: 'Current public requirement for RAG and workflow automation.',
  companyName: 'Example Company',
  companyWebsite: 'https://example.com',
  contactName: 'Sarah Jones',
  contactRole: 'Founder',
  contactEmail: 'sarah@example.com',
  serviceCategory: 'rag_document_intelligence',
  opportunityStatus: 'live_opportunity',
  discoverySource: 'Test public source',
  evidenceUrl: 'https://example.com/opportunity',
  evidenceSummary: 'Official public requirement checked today.',
  discoveredAt: now,
  capturedAt: now,
  pipelineStatus: 'needs_human_review',
  createdAt: now,
  updatedAt: now,
};
repository.upsertLead(lead, 'test');

const fakeResult: ProspectDiscoveryResult = {
  run: {
    id: 'run-test',
    startedAt: now,
    completedAt: now,
    sourceCount: 2,
    candidateCount: 10,
    enrichedCount: 5,
    newLeadCount: 1,
    duplicateCount: 2,
    emailStatus: 'skipped',
    errors: [],
    newLeadIds: ['prospect-test-001'],
  },
  newLeads: [lead],
  sourceResults: [],
};

const server = createProspectDashboardHttpServer({
  repository,
  portfolioItems: samplePortfolioItems,
  runStore,
  runDiscovery: async () => fakeResult,
  adminPassword: 'strong-test-password',
  sessionSecret: 'strong-test-session-secret-123456789',
  secureCookies: false,
  now: () => now,
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;

const anonymous = await fetch(`${base}/`, { redirect: 'manual' });
assert.equal(anonymous.status, 302);
assert.equal(anonymous.headers.get('location'), '/login');

const wrongLogin = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'wrong' }),
});
assert.equal(wrongLogin.status, 401);

const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'strong-test-password' }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie?.startsWith('codistan_admin_session='));

const dashboard = await fetch(`${base}/`, { headers: { cookie } });
assert.equal(dashboard.status, 200);
const dashboardHtml = await dashboard.text();
assert.ok(dashboardHtml.includes('Prospect Discovery &amp; Management') || dashboardHtml.includes('Prospect Discovery & Management'));
assert.ok(dashboardHtml.includes('Example Company'));
assert.ok(dashboardHtml.includes('Run discovery now'));

const activity = await fetch(`${base}/api/prospects/${lead.id}/activity`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'response', channel: 'email', body: 'Interested; requested a meeting next week.' }),
});
assert.equal(activity.status, 200);
assert.equal((await activity.json()).pipelineStatus, 'replied');
assert.equal(repository.getLead(lead.id)?.lead.lastResponseAt, now);
assert.ok(repository.getLead(lead.id)?.notes.some((note) => note.includes('Interested; requested a meeting')));

const discovery = await fetch(`${base}/api/prospects/run`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: '{}',
});
assert.equal(discovery.status, 201);
assert.equal((await discovery.json()).run.newLeadCount, 1);

const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie } });
assert.equal(logout.status, 200);
assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));

server.close();
await once(server, 'close');
console.log('prospect dashboard tests passed');
