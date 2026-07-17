import assert from 'node:assert/strict';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { InMemoryProspectDiscoveryRunStore } from '@sales-automation/prospect-discovery';
import { processLinkedInWarmSignalBatch } from '../vercel/linkedin-warm-signal-engine.js';
import {
  extractSalesNavigatorCandidates,
  isSalesNavigatorResearchSignal,
  splitLinkedInSignals,
} from '../vercel/linkedin-sales-navigator-research-engine.js';

const savedSearchSignal = {
  origin: 'sales_navigator_email' as const,
  subject: 'Sales Navigator saved lead search alert',
  text: [
    'New lead from your saved search',
    'Lead: Ayesha Khan',
    'Role: Chief Technology Officer',
    'Company: Northstar Health',
    'Location: United Kingdom',
    'https://www.linkedin.com/in/ayesha-khan-987654?trk=email',
  ].join('\n'),
  receivedAt: '2026-07-17T08:00:00.000Z',
  messageId: 'sales-nav-alert-1',
};

assert.equal(isSalesNavigatorResearchSignal(savedSearchSignal), true);
assert.equal(splitLinkedInSignals([savedSearchSignal]).researchSignals.length, 1);
const extracted = extractSalesNavigatorCandidates(savedSearchSignal);
assert.equal(extracted.length, 1);
assert.equal(extracted[0]?.sourceUrl, 'https://www.linkedin.com/in/ayesha-khan-987654');
assert.equal(extracted[0]?.contactName, 'Ayesha Khan');
assert.equal(extracted[0]?.contactRole, 'Chief Technology Officer');
assert.equal(extracted[0]?.companyName, 'Northstar Health');

const state = {
  repository: new InMemoryLeadRepository(),
  runStore: new InMemoryProspectDiscoveryRunStore(),
};
const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('bing.com/search')) {
    return new Response(`<?xml version="1.0"?><rss><channel><item><title>Northstar Health</title><link>https://northstar-health.example</link><description>Official Northstar Health website</description></item></channel></rss>`, {
      status: 200,
      headers: { 'content-type': 'application/rss+xml' },
    });
  }
  return new Response('<html><head><title>Northstar Health</title></head><body><h1>Northstar Health</h1><a href="/contact">Contact us</a></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
};

const result = await processLinkedInWarmSignalBatch({
  state,
  signals: [savedSearchSignal],
  actor: 'sales-nav-smoke',
  generatedAt: '2026-07-17T08:00:00.000Z',
  fetchImpl: fakeFetch,
  enrichContacts: true,
});
assert.equal(result.salesNavigatorResearch.totalInput, 1);
assert.equal(result.salesNavigatorResearch.created, 1);
assert.equal(result.ingestion.created, 1);
assert.equal(result.ingestion.research, 1);
assert.equal(result.ingestion.rejected, 0);
assert.equal(result.researchLeadIds.length, 1);
assert.equal(state.repository.listLeads().length, 1);
const record = state.repository.listLeads()[0];
assert.equal(record?.lead.pipelineStatus, 'needs_research');
assert.equal(record?.lead.contactName, 'Ayesha Khan');
assert.equal(record?.lead.contactRole, 'Chief Technology Officer');
assert.equal(record?.lead.companyName, 'Northstar Health');
assert.equal(record?.lead.companyWebsite, 'https://northstar-health.example');
assert.equal(record?.lead.sourceUrl, 'https://www.linkedin.com/in/ayesha-khan-987654');
assert.ok(record?.notes.some((note) => note.includes('sales_navigator_research')));
assert.ok(record?.lead.owner);

const warmPost = {
  origin: 'sales_navigator_email' as const,
  subject: 'A lead posted a buying request',
  text: 'We are looking for an AI automation partner to build an internal workflow this month.',
  sourceUrl: 'https://www.linkedin.com/posts/northstar_ai-activity-123',
  receivedAt: '2026-07-17T08:00:00.000Z',
};
assert.equal(isSalesNavigatorResearchSignal(warmPost), false);
assert.equal(splitLinkedInSignals([warmPost]).warmSignals.length, 1);

console.log('Automatic Sales Navigator lead/account research, enrichment, routing and warm-signal separation passed');
