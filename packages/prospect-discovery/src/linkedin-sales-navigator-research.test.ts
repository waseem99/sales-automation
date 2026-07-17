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

const savedLeadSearchSignal = {
  origin: 'sales_navigator_email' as const,
  subject: 'Looking for software leaders — saved lead search alert',
  text: [
    'New lead from your saved search',
    'Lead: Ayesha Khan',
    'Role: Chief Technology Officer',
    'Company: Northstar Health',
    'Location: United Kingdom',
    'https://www.linkedin.com/comm/in/ayesha-khan-987654?trk=email',
  ].join('\n'),
  receivedAt: '2026-07-17T08:00:00.000Z',
  messageId: 'sales-nav-alert-1',
};

const savedAccountSearchSignal = {
  origin: 'sales_navigator_email' as const,
  subject: 'New accounts from your saved account search',
  text: [
    'Account: Northstar Health',
    'Location: United Kingdom',
    'Software and digital transformation company',
    'https://www.linkedin.com/sales/company/123456?trk=email',
  ].join('\n'),
  receivedAt: '2026-07-17T08:05:00.000Z',
  messageId: 'sales-nav-alert-2',
};

assert.equal(isSalesNavigatorResearchSignal(savedLeadSearchSignal), true);
assert.equal(isSalesNavigatorResearchSignal(savedAccountSearchSignal), true);
const partition = partitionSalesNavigatorSignals([savedLeadSearchSignal, savedAccountSearchSignal]);
assert.equal(partition.researchSignals.length, 2);
assert.equal(partition.warmSignals.length, 0);

const leadTargets = extractSalesNavigatorTargets(savedLeadSearchSignal);
assert.equal(leadTargets.length, 1);
assert.equal(leadTargets[0]?.sourceUrl, 'https://www.linkedin.com/in/ayesha-khan-987654');
assert.equal(leadTargets[0]?.contactName, 'Ayesha Khan');
assert.equal(leadTargets[0]?.contactRole, 'Chief Technology Officer');
assert.equal(leadTargets[0]?.companyName, 'Northstar Health');
assert.equal(leadTargets[0]?.region, 'United Kingdom');

const accountTargets = extractSalesNavigatorTargets(savedAccountSearchSignal);
assert.equal(accountTargets.length, 1);
assert.equal(accountTargets[0]?.sourceUrl, 'https://www.linkedin.com/sales/company/123456');
assert.equal(accountTargets[0]?.kind, 'company');
assert.equal(accountTargets[0]?.companyName, 'Northstar Health');

const repository = new InMemoryLeadRepository();
let websiteLookupCount = 0;
const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  assert.match(url, /bing\.com\/search/);
  websiteLookupCount += 1;
  return new Response(`<?xml version="1.0"?><rss><channel><item><title>Northstar Health official website</title><link>https://northstar-health.example</link><description>Northstar Health software and healthcare platform.</description></item></channel></rss>`, {
    status: 200,
    headers: { 'content-type': 'application/rss+xml' },
  });
};

const first = await ingestSalesNavigatorResearchSignals({
  repository,
  portfolioItems: portfolio,
  signals: [savedLeadSearchSignal, savedAccountSearchSignal],
  actor: 'sales-nav-test',
  generatedAt: '2026-07-17T08:10:00.000Z',
  fetchImpl: fakeFetch,
});
assert.equal(first.created, 2);
assert.equal(first.duplicates, 0);
assert.equal(first.extractedCandidates, 2);
assert.equal(first.captured.every((item) => item.decision.band === 'research'), true);
assert.equal(first.captured.every((item) => item.decision.outcome === 'research'), true);
assert.equal(websiteLookupCount, 1, 'The same company website should be researched only once per batch.');

const records = repository.listLeads();
assert.equal(records.length, 2);
const personRecord = records.find((item) => item.lead.contactName === 'Ayesha Khan');
assert.equal(personRecord?.lead.pipelineStatus, 'needs_research');
assert.equal(personRecord?.lead.prospectStage, 'cold_prospect');
assert.equal(personRecord?.lead.leadType, 'sales_navigator_cold_prospect');
assert.equal(personRecord?.lead.contactRole, 'Chief Technology Officer');
assert.equal(personRecord?.lead.companyName, 'Northstar Health');
assert.equal(personRecord?.lead.companyWebsite, 'https://northstar-health.example');
assert.equal(personRecord?.lead.sourceUrl, 'https://www.linkedin.com/in/ayesha-khan-987654');
assert.ok(personRecord?.notes.some((note) => note.includes('sales-navigator-research')));
assert.equal((personRecord?.lead.rawPayload as { salesNavigatorResearch?: { automaticDiscovery?: boolean } })?.salesNavigatorResearch?.automaticDiscovery, true);

const accountRecord = records.find((item) => item.lead.sourceUrl === 'https://www.linkedin.com/sales/company/123456');
assert.equal(accountRecord?.lead.leadType, 'sales_navigator_cold_prospect');
assert.equal(accountRecord?.lead.companyName, 'Northstar Health');
assert.equal(accountRecord?.lead.companyWebsite, 'https://northstar-health.example');

const duplicate = await ingestSalesNavigatorResearchSignals({
  repository,
  portfolioItems: portfolio,
  signals: [savedLeadSearchSignal, savedAccountSearchSignal],
  actor: 'sales-nav-test',
  generatedAt: '2026-07-17T08:30:00.000Z',
  fetchImpl: fakeFetch,
});
assert.equal(duplicate.created, 0);
assert.equal(duplicate.duplicates, 2);
assert.equal(repository.listLeads().length, 2);
assert.equal(websiteLookupCount, 1, 'Duplicates must be rejected before enrichment calls.');

const warmPost = {
  origin: 'sales_navigator_email' as const,
  subject: 'A lead posted a buying request',
  text: 'We are looking for an AI automation partner to build an internal workflow this month. https://www.linkedin.com/posts/northstar_ai-activity-123',
  sourceUrl: 'https://www.linkedin.com/posts/northstar_ai-activity-123',
  receivedAt: '2026-07-17T08:00:00.000Z',
};
assert.equal(isSalesNavigatorResearchSignal(warmPost), false);
assert.equal(partitionSalesNavigatorSignals([warmPost]).warmSignals.length, 1);

console.log('Automatic Sales Navigator lead/account discovery, enrichment, deduplication and warm-signal separation passed');
