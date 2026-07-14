import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import {
  enrichRepositoryContacts,
  getStoredContactEnrichment,
  verifyPublicContactEnrichment,
} from './verified-enrichment.js';
import type { ProspectFetch } from './types.js';

const companyHtml = `<!doctype html><html><head>
<meta property="og:site_name" content="Example Operations Company">
<script type="application/ld+json">{"@type":"Person","name":"Amelia Carter","jobTitle":"Chief Technology Officer"}</script>
</head><body>
<h1>Example Operations Company</h1><p>Our company builds logistics software.</p>
<a href="mailto:sales@example.co">Sales</a>
<a href="mailto:founder@gmail.com">Founder personal email</a>
<a href="/contact-us">Contact us</a>
<a href="https://www.linkedin.com/in/amelia-carter">LinkedIn</a>
</body></html>`;

const fetchImpl: ProspectFetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('https://example.co')) {
    return new Response(companyHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
};

const lead = baseLead({
  id: 'verified-contact-lead',
  companyName: 'Example Operations Company',
  companyWebsite: 'https://example.co',
});
const enrichment = await verifyPublicContactEnrichment({
  lead,
  fetchImpl,
  checkedAt: '2026-07-15T10:00:00.000Z',
});
assert.equal(enrichment.status, 'ready');
assert.equal(enrichment.confidence, 'high');
assert.equal(enrichment.officialWebsite, 'https://example.co');
assert.equal(enrichment.verifiedBusinessEmail, 'sales@example.co');
assert.equal(enrichment.contactFormUrl, 'https://example.co/contact-us');
assert.equal(enrichment.publicProfessionalProfileUrl, 'https://www.linkedin.com/in/amelia-carter');
assert.equal(enrichment.buyerName, 'Amelia Carter');
assert.equal(enrichment.buyerRole, 'Chief Technology Officer');
assert.ok(enrichment.rejectedPersonalEmails.includes('founder@gmail.com'));
assert.ok(!enrichment.missingData.some((item) => /business email|contact form/i.test(item)));

const repository = new InMemoryLeadRepository();
repository.upsertLead(lead, 'test');
const result = await enrichRepositoryContacts({
  repository,
  fetchImpl,
  now: () => '2026-07-15T10:00:00.000Z',
  maxRecords: 5,
});
assert.equal(result.checked, 1);
assert.equal(result.updated, 1);
assert.equal(result.ready, 1);
const updated = repository.getLead(lead.id)?.lead;
assert.equal(updated?.contactEmail, 'sales@example.co');
assert.equal(updated?.contactName, 'Amelia Carter');
assert.equal(updated?.contactRole, 'Chief Technology Officer');
assert.equal(updated?.contactFormUrl, 'https://example.co/contact-us');
assert.equal(getStoredContactEnrichment(updated!).status, 'ready');
assert.ok(repository.getLead(lead.id)?.notes.some((note) => note.body.includes('contact-enrichment::ready::high')));

const personalOnly = await verifyPublicContactEnrichment({
  lead: baseLead({ id: 'personal-only', companyWebsite: 'https://personal.example' }),
  checkedAt: '2026-07-15T10:00:00.000Z',
  fetchImpl: async () => new Response('<html><body><h1>Our company</h1><a href="mailto:owner@gmail.com">Email</a></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  }),
});
assert.equal(personalOnly.verifiedBusinessEmail, undefined);
assert.ok(personalOnly.rejectedPersonalEmails.includes('owner@gmail.com'));
assert.ok(personalOnly.missingData.some((item) => /business email|contact form/i.test(item)));

const noEvidence = await verifyPublicContactEnrichment({
  lead: baseLead({ id: 'no-evidence', sourceUrl: 'https://www.linkedin.com/posts/example' }),
  checkedAt: '2026-07-15T10:00:00.000Z',
  fetchImpl: async () => { throw new Error('Blocked source must not be requested'); },
});
assert.equal(noEvidence.status, 'research_required');
assert.equal(noEvidence.evidenceUrls.length, 0);
assert.ok(noEvidence.missingData.some((item) => /official company website/i.test(item)));

console.log('Verified public company, buyer and contact-route enrichment tests passed');

function baseLead(overrides: Partial<Lead>): Lead {
  return {
    id: 'lead',
    source: 'public_web',
    sourceUrl: 'https://example.co/opportunity',
    leadType: 'public_opportunity',
    prospectStage: 'warm_lead',
    title: 'External software implementation partner required',
    description: 'The company is seeking an external implementation partner for a logistics platform.',
    serviceCategory: 'fullstack_web_app',
    opportunityStatus: 'live_opportunity',
    discoverySource: 'Public search result',
    evidenceUrl: 'https://example.co/opportunity',
    evidenceSummary: 'Public buyer requirement.',
    capturedAt: '2026-07-15T09:00:00.000Z',
    pipelineStatus: 'needs_human_review',
    createdAt: '2026-07-15T09:00:00.000Z',
    updatedAt: '2026-07-15T09:00:00.000Z',
    ...overrides,
  };
}
