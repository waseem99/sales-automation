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

const manualLead = buildLead('manual-lead');
const ingestion = await handleProspectDashboardRequest({
  method: 'POST',
  url: '/api/ingest/manual-leads',
  headers: { cookie },
  body: { leads: [manualLead] },
}, context);
assert.equal(ingestion.status, 201);
assert.ok(repository.getLead(manualLead.id));
assert.ok(
  repository.getLead(manualLead.id)?.notes.some((note) => note.startsWith('guidance::first_outreach::')),
  'A manually ingested lead must be audited in the same request.',
);

console.log('Automatic existing-lead and manual-ingestion engagement audits passed');

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
