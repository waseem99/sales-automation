import assert from 'node:assert/strict';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { renderProspectCsv } from './digest.js';
import { parseRssItems } from './sources.js';
import { runProspectDiscovery } from './runner.js';
import { InMemoryProspectDiscoveryRunStore } from './run-store.js';

const rss = `<?xml version="1.0"?><rss><channel><item>
<title>Looking for an AI development partner</title>
<link>https://example.com/opportunity</link>
<description><![CDATA[Need a RAG and workflow automation implementation partner.]]></description>
<pubDate>Sat, 11 Jul 2026 09:00:00 GMT</pubDate>
</item></channel></rss>`;
const parsed = parseRssItems(rss);
assert.equal(parsed.length, 1);
assert.equal(parsed[0]?.title, 'Looking for an AI development partner');
assert.equal(parsed[0]?.link, 'https://example.com/opportunity');

const now = '2026-07-11T10:00:00.000Z';
const remoteOkPayload = [
  { legal: 'metadata' },
  {
    id: 'job-1',
    position: 'AI RAG Implementation Partner',
    company: 'Example AI',
    location: 'United States',
    description: '<p>We are hiring a partner for a funded RAG and workflow automation product.</p>',
    tags: ['ai', 'rag', 'python'],
    url: 'https://remoteok.com/remote-jobs/123-example-ai',
    date: now,
  },
];

const officialWebsiteRss = `<?xml version="1.0"?><rss><channel><item>
<title>Example AI — Official Website</title>
<link>https://example-ai.com/</link>
<description>Example AI builds enterprise automation products.</description>
</item></channel></rss>`;

const homepage = `<!doctype html><html><head><title>Example AI | Enterprise Automation</title></head><body>
<a href="/about">About</a><a href="/contact">Contact</a>
<a href="https://www.linkedin.com/company/example-ai">LinkedIn</a>
</body></html>`;
const about = `<!doctype html><html><body><p>Sarah Jones — Founder</p><p>We build AI and RAG products.</p></body></html>`;
const contact = `<!doctype html><html><body><form action="/contact"></form><a href="mailto:partnerships@example-ai.com">Email</a><p>+1 212 555 0199</p></body></html>`;

const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  if (url === 'https://remoteok.com/api') {
    return new Response(JSON.stringify(remoteOkPayload), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.startsWith('https://www.bing.com/search?format=rss')) {
    return new Response(officialWebsiteRss, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  }
  if (url === 'https://example-ai.com' || url === 'https://example-ai.com/') {
    return new Response(homepage, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url === 'https://example-ai.com/about') {
    return new Response(about, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url === 'https://example-ai.com/contact') {
    return new Response(contact, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
};

const repository = new InMemoryLeadRepository();
const runStore = new InMemoryProspectDiscoveryRunStore();
const first = await runProspectDiscovery({
  repository,
  runStore,
  portfolioItems: samplePortfolioItems,
  fetchImpl,
  now: () => now,
  bingRssEnabled: false,
  remoteOkEnabled: true,
  maxCandidates: 10,
});

assert.equal(first.run.newLeadCount, 1);
assert.equal(first.run.emailStatus, 'skipped');
assert.equal(first.newLeads[0]?.companyName, 'Example AI');
assert.equal(first.newLeads[0]?.companyWebsite, 'https://example-ai.com');
assert.equal(first.newLeads[0]?.contactName, 'Sarah Jones');
assert.equal(first.newLeads[0]?.contactRole, 'Founder');
assert.equal(first.newLeads[0]?.contactEmail, 'partnerships@example-ai.com');
assert.equal(first.newLeads[0]?.opportunityStatus, 'live_opportunity');
assert.ok(first.newLeads[0]?.recommendedNextAction);
assert.ok(first.newLeads[0]?.draftMessage);
assert.equal(runStore.listRuns().length, 1);

const csv = renderProspectCsv(first.newLeads, samplePortfolioItems);
assert.ok(csv.includes('partnerships@example-ai.com'));
assert.ok(csv.includes('Example AI'));

const second = await runProspectDiscovery({
  repository,
  runStore,
  portfolioItems: samplePortfolioItems,
  fetchImpl,
  now: () => now,
  bingRssEnabled: false,
  remoteOkEnabled: true,
  maxCandidates: 10,
});
assert.equal(second.run.newLeadCount, 0);
assert.equal(second.run.duplicateCount, 1);

console.log('prospect-discovery tests passed');
