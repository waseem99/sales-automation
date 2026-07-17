import assert from 'node:assert/strict';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import {
  extractSalesNavigatorTargets,
  ingestSalesNavigatorResearchSignals,
  isSalesNavigatorResearchSignal,
  partitionSalesNavigatorSignals,
} from './linkedin-sales-navigator-research.js';

const portfolio = [{
  id: 'software-proof',
  projectName: 'Approved software proof',
  confidentiality: 'public' as const,
  serviceCategories: ['fullstack_web_app' as const],
  techStack: ['React', 'Node.js'],
  problemSolved: 'Built a business software platform.',
  assetUrls: ['https://codistan.org'],
  tags: ['software'],
  bestProfiles: ['codistan_partner_identity' as const],
}];

const savedSearchSignal = {
  origin: 'sales_navigator_email' as const,
  subject: 'Sales Navigator saved lead search alert',
  text: [
    'New lead from your saved search for software leaders',
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
const partition = partitionSalesNavigatorSignals([savedSearchSignal]);
assert.equal(partition.researchSignals.length, 1);
assert.equal(partition.warmSignals.length, 0);

const targets = extractSalesNavigatorTargets(savedSearchSignal);
assert.equal(targets.length, 1);
assert.equal(targets[0]?.sourceUrl, 'https://www.linkedin.com/in/ayesha-khan-987654');
assert.equal(targets[0]?.contactName, 'Ayesha Khan');
assert.equal(targets[0]?.contactRole, 'Chief Technology Officer');
assert.equal(targets[0]?.companyName, 'Northstar Health');
assert.equal(targets[0]?.region, 'United Kingdom');

const repository = new InMemoryLeadRepository();
const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  assert.match(url, /bing\.com\/search/);
  return new Response(`<?xml version="1.0"?><rss><channel><item><title>Northstar Health official website</title><link>https://northstar-health.example</link><description>Northstar Health software and healthcare platform.</description></item></channel></rss>`, {
    status: 200,
    headers: { 'content-type': 'application/rss+xml' },
  });
};

const first = await ingestSalesNavigatorResearchSignals({
  repository,
  portfolioItems: portfolio,
  signals: [savedSearchSignal],
  actor: 'sales-nav-test',
  generatedAt: '2026-07-17T08:00:00.000Z',
  fetchImpl: fakeFetch,
});
assert.equal(first.created, 1);
assert.equal(first.duplicates, 0);
assert.equal(first.extractedCandidates, 1);
assert.equal(first.captured[0]?.decision.band, 'research');
assert.equal(first.captured[0]?.decision.outcome, 'research');

const record = repository.listLeads()[0];
assert.equal(record?.lead.pipelineStatus, 'needs_research');
assert.equal(record?.lead.prospectStage, 'cold_prospect');
assert.equal(record?.lead.leadType, 'sales_navigator_cold_prospect');
assert.equal(record?.lead.contactName, 'Ayesha Khan');
assert.equal(record?.lead.contactRole, 'Chief Technology Officer');
assert.equal(record?.lead.companyName, 'Northstar Health');
assert.equal(record?.lead.companyWebsite, 'https://northstar-health.example');
assert.equal(record?.lead.sourceUrl, 'https://www.linkedin.com/in/ayesha-khan-987654');
assert.ok(record?.notes.some((note) => note.includes('sales-navigator-research')));
assert.equal((record?.lead.rawPayload as { salesNavigatorResearch?: { automaticDiscovery?: boolean } })?.salesNavigatorResearch?.automaticDiscovery, true);

const duplicate = await ingestSalesNavigatorResearchSignals({
  repository,
  portfolioItems: portfolio,
  signals: [savedSearchSignal],
  actor: 'sales-nav-test',
  generatedAt: '2026-07-17T08:30:00.000Z',
  fetchImpl: fakeFetch,
});
assert.equal(duplicate.created, 0);
assert.equal(duplicate.duplicates, 1);
assert.equal(repository.listLeads().length, 1);

const warmPost = {
  origin: 'sales_navigator_email' as const,
  subject: 'A lead posted a buying request',
  text: 'We are looking for an AI automation partner to build an internal workflow this month.',
  sourceUrl: 'https://www.linkedin.com/posts/northstar_ai-activity-123',
  receivedAt: '2026-07-17T08:00:00.000Z',
};
assert.equal(isSalesNavigatorResearchSignal(warmPost), false);
assert.equal(partitionSalesNavigatorSignals([warmPost]).warmSignals.length, 1);

console.log('Automatic Sales Navigator target discovery, enrichment, deduplication and warm-signal separation passed');
