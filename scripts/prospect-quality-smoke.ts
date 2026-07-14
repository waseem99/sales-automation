import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  filterRssItems,
  findStoredAutomaticProspectFalsePositives,
  type DiscoveryCandidate,
} from '@sales-automation/prospect-discovery';
import type { Lead } from '@sales-automation/shared';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  functions?: Record<string, { maxDuration?: number }>;
  crons?: Array<{ path: string; schedule: string }>;
};
assert.equal(config.functions?.['api/prospect-cleanup.ts']?.maxDuration, 300);
assert.equal(config.crons?.find((cron) => cron.path === '/api/prospect-cleanup')?.schedule, '5 * * * *');

const cleanupApi = readFileSync(new URL('../api/prospect-cleanup.ts', import.meta.url), 'utf8');
const packageIndex = readFileSync(new URL('../packages/prospect-discovery/src/index.ts', import.meta.url), 'utf8');
assert.match(cleanupApi, /findStoredAutomaticProspectFalsePositives/);
assert.match(cleanupApi, /deleteLeadRecords/);
assert.match(cleanupApi, /manualIntakeExcluded: true/);
assert.match(cleanupApi, /tendersExcluded: true/);
assert.match(packageIndex, /quality-runner/);
assert.match(packageIndex, /prospect-validation/);

const rss = `<rss><channel>
<item><title>Looking (TV Movie 2016) - IMDb</title><link>https://www.imdb.com/title/tt4552118/</link><description>Cast and plot.</description></item>
<item><title>Request for Proposal for a mobile app</title><link>https://buyer.example/rfp/mobile-app</link><description>The organization invites qualified software vendors to submit proposals.</description></item>
</channel></rss>`;
const filtered = filterRssItems(rss, 'https://www.bing.com/search?format=rss&q=%22looking%20for%20a%20development%20partner%22');
assert.equal(filtered.rejected, 1);
assert.doesNotMatch(filtered.xml, /imdb\.com/);
assert.match(filtered.xml, /buyer\.example/);

const wikipediaCandidate: DiscoveryCandidate = {
  sourceName: 'Bing RSS: software partner',
  sourceType: 'search',
  sourceUrl: 'https://en.wikipedia.org/wiki/Software',
  title: 'Software - Wikipedia, the free encyclopedia',
  summary: 'Reference article about software.',
  opportunityStatus: 'live_opportunity',
};
const stored: Lead = {
  id: 'stored-wikipedia',
  source: 'public_web',
  sourceUrl: wikipediaCandidate.sourceUrl,
  leadType: 'public_opportunity',
  title: wikipediaCandidate.title,
  description: wikipediaCandidate.summary,
  companyWebsite: 'https://en.wikipedia.org',
  serviceCategory: 'unknown',
  opportunityStatus: 'live_opportunity',
  discoverySource: wikipediaCandidate.sourceName,
  evidenceUrl: wikipediaCandidate.sourceUrl,
  evidenceSummary: 'Automatic Bing result.',
  capturedAt: '2026-07-14T12:00:00.000Z',
  rawPayload: { prospectDiscovery: { sourceType: 'search' } },
  pipelineStatus: 'needs_human_review',
  createdAt: '2026-07-14T12:00:00.000Z',
  updatedAt: '2026-07-14T12:00:00.000Z',
};
assert.equal(findStoredAutomaticProspectFalsePositives([stored]).length, 1);

console.log('Prospect quality gate, stored cleanup and Vercel schedule smoke tests passed');
