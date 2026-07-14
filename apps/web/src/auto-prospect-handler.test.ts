import assert from 'node:assert/strict';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryProspectDiscoveryRunStore } from '@sales-automation/prospect-discovery';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { handleProspectDashboardRequest } from './auto-prospect-handler.js';

const now = '2026-07-13T12:00:00.000Z';
const repository = new InMemoryLeadRepository();
const runStore = new InMemoryProspectDiscoveryRunStore();
const context = {
  repository,
  portfolioItems: samplePortfolioItems,
  runStore,
  adminPassword: 'strong-test-password',
  sessionSecret: 'strong-test-session-secret-123456789',
  secureCookies: false,
  actor: 'test@codistan.org',
  now: () => now,
};

const existingLead = buildLead('existing-lead');
repository.upsertLead(existingLead, 'test');

const login = await handleProspectDashboardRequest({
  method: 'POST',
  url: '/api/login',
  body: { password: 'strong-test-password' },
}, context);
assert.equal(login.status, 200);
const cookie = login.headers['set-cookie']?.split(';')[0];
assert.ok(cookie);

const dashboard = await handleProspectDashboardRequest({
  method: 'GET',
  url: '/prospects',
  headers: { cookie },
}, context);
assert.equal(dashboard.status, 200);
assert.ok(repository.getLead(existingLead.id)?.notes.some((note) => note.startsWith('guidance::first_outreach::')));
assert.match(dashboard.body, /First outreach intelligence/);

const guidanceCount = repository.getLead(existingLead.id)?.notes.filter((note) => note.startsWith('guidance::first_outreach::')).length;
await handleProspectDashboardRequest({
  method: 'GET',
  url: '/prospects',
  headers: { cookie },
}, context);
assert.equal(
  repository.getLead(existingLead.id)?.notes.filter((note) => note.startsWith('guidance::first_outreach::')).length,
  guidanceCount,
  'Already-audited prospects must not receive duplicate guidance.',
);

const forcedAudit = await handleProspectDashboardRequest({
  method: 'POST',
  url: '/api/prospects/guidance/backfill',
  headers: { cookie },
  body: { force: true },
}, context);
assert.equal(forcedAudit.status, 201);
const forcedPayload = JSON.parse(forcedAudit.body) as { audited: number };
assert.equal(forcedPayload.audited, 1);

const reply = await handleProspectDashboardRequest({
  method: 'POST',
  url: `/api/prospects/${existingLead.id}/guidance/reply`,
  headers: { cookie },
  body: { replyBody: 'Can you share pricing and a six-week implementation plan?', channel: 'email' },
}, context);
assert.equal(reply.status, 201);
assert.equal(repository.getLead(existingLead.id)?.lead.pipelineStatus, 'replied');
assert.ok(repository.getLead(existingLead.id)?.notes.some((note) => note.startsWith('guidance::reply::')));

console.log('Automatic Prospect Desk engagement audits passed');

function buildLead(id: string): Lead {
  return {
    id,
    source: 'manual',
    sourceUrl: `https://example.com/${id}`,
    leadType: 'manual_lead',
    prospectStage: 'manual_lead',
    title: 'Qualified AI implementation prospect',
    description: 'The company is expanding an enterprise AI product and may need implementation support.',
    companyName: `Example ${id}`,
    companyWebsite: `https://example.com/${id}`,
    contactName: 'Alex Morgan',
    contactRole: 'Founder',
    contactEmail: `alex+${id}@example.com`,
    country: 'United States',
    industry: 'Software',
    serviceCategory: 'ai_automation',
    serviceOffer: 'AI automation implementation and integration support.',
    materialsToShare: 'Approved AI automation case study.',
    reachMethod: 'Business email',
    opportunityStatus: 'recent_demand_signal',
    discoverySource: 'Manual qualified prospect',
    evidenceUrl: `https://example.com/${id}`,
    evidenceSummary: 'Official company material indicates current enterprise AI expansion.',
    discoveredAt: now,
    confidence: 'high',
    budgetSignal: 'Enterprise product and active expansion.',
    timelineSignal: 'Current expansion activity.',
    capturedAt: now,
    pipelineStatus: 'new',
    createdAt: now,
    updatedAt: now,
  };
}
