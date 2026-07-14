import assert from 'node:assert/strict';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { filterRssItems, runProspectDiscovery } from './quality-runner.js';

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Looking (TV Movie 2016) - IMDb</title><link>https://www.imdb.com/title/tt4552118/</link><description>Cast, plot and release information.</description></item>
<item><title>Looking (TV series) - Wikipedia</title><link>https://en.wikipedia.org/wiki/Looking_(TV_series)</link><description>American television series.</description></item>
<item><title>Beginner's Guide to SEO - Moz</title><link>https://moz.com/beginners-guide-to-seo</link><description>Learn search engine optimization in this complete guide.</description></item>
<item><title>Request for Proposal for software platform implementation</title><link>https://buyer.example.com/rfp/software-platform</link><description>The organization invites qualified software vendors to submit proposals.</description></item>
</channel></rss>`;

const guarded = filterRssItems(
  rss,
  'https://www.bing.com/search?format=rss&q=%22looking%20for%20a%20development%20partner%22%20software',
);
assert.equal(guarded.checked, 4);
assert.equal(guarded.rejected, 3);
assert.doesNotMatch(guarded.xml, /imdb\.com/i);
assert.doesNotMatch(guarded.xml, /wikipedia\.org/i);
assert.doesNotMatch(guarded.xml, /beginners-guide-to-seo/i);
assert.match(guarded.xml, /buyer\.example\.com\/rfp\/software-platform/i);

const partnershipRss = `<?xml version="1.0"?><rss><channel>
<item><title>Credible Agency - AI and software consultancy</title><link>https://credibleagency.example/</link><description>Product design, AI implementation and software engineering services.</description></item>
<item><title>How to select a software development partner</title><link>https://credibleagency.example/blog/how-to-select-a-partner</link><description>A complete guide for product teams.</description></item>
</channel></rss>`;
const partnership = filterRssItems(
  partnershipRss,
  'https://www.bing.com/search?format=rss&q=AI%20consultancy%20agency%20United%20States',
);
assert.equal(partnership.checked, 2);
assert.equal(partnership.rejected, 1);
assert.match(partnership.xml, /credibleagency\.example\/<\/link>/i);
assert.doesNotMatch(partnership.xml, /how-to-select-a-partner/i);

const existingLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-rag-001');
assert.ok(existingLead);
const repository = new InMemoryLeadRepository();
repository.upsertLead(existingLead, 'test');
const beforeCount = repository.listLeads().length;
const result = await runProspectDiscovery({
  repository,
  portfolioItems: samplePortfolioItems,
  bingRssEnabled: false,
  remoteOkEnabled: false,
  now: () => '2026-07-08T18:30:00.000Z',
  fetchImpl: globalThis.fetch,
});
assert.equal(result.run.closeabilityRescoredCount, 1);
assert.equal(repository.listLeads().length, beforeCount, 'Rescoring must not create duplicates');
assert.ok(repository.getLead(existingLead.id)?.latestEvaluation?.closeability);

console.log('RSS quality guard and duplicate-free closeability rescoring tests passed');
