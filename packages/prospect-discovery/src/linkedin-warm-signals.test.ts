import assert from 'node:assert/strict';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import {
  collectPublicLinkedInIndexSignals,
  evaluateLinkedInWarmSignal,
  ingestLinkedInWarmSignals,
  isLinkedInPostUrl,
} from './linkedin-warm-signals.js';

const portfolio = [{
  id: 'website-proof',
  projectName: 'Approved website proof',
  confidentiality: 'public' as const,
  serviceCategories: ['website_portal' as const],
  techStack: ['WordPress'],
  problemSolved: 'Built a conversion-focused business website.',
  assetUrls: ['https://codistan.org'],
  tags: ['website'],
  bestProfiles: ['codistan_partner_identity' as const],
}];

const warm = evaluateLinkedInWarmSignal({
  origin: 'manual_post',
  text: 'We are looking for a website development agency to rebuild our customer portal this month.',
  receivedAt: '2026-07-15T10:00:00.000Z',
  postedAt: '2026-07-15T08:00:00.000Z',
  sourceUrl: 'https://www.linkedin.com/posts/acme_rebuild-activity-123',
  companyName: 'Acme Health',
  authorName: 'Sara Malik',
  authorRole: 'Head of Marketing',
  country: 'United Kingdom',
}, portfolio);
assert.equal(warm.outcome, 'keep');
assert.equal(warm.band, 'priority_a');
assert.ok(warm.score >= 85);
assert.equal(warm.serviceCategory, 'website_portal');

const vacancy = evaluateLinkedInWarmSignal({
  origin: 'linkedin_notification_email',
  text: 'We are hiring a full-time web developer. Salary and benefits included. Apply now with your resume.',
  receivedAt: '2026-07-15T10:00:00.000Z',
  sourceUrl: 'https://www.linkedin.com/posts/acme_hiring-activity-456',
}, portfolio);
assert.equal(vacancy.outcome, 'reject');
assert.ok(vacancy.reasonCodes.includes('linkedin_job_vacancy'));

const selfPromotion = evaluateLinkedInWarmSignal({
  origin: 'manual_post',
  text: 'I am a website developer available for freelance projects. DM me for services.',
  receivedAt: '2026-07-15T10:00:00.000Z',
  sourceUrl: 'https://www.linkedin.com/posts/person_services-activity-789',
}, portfolio);
assert.equal(selfPromotion.outcome, 'reject');
assert.ok(selfPromotion.reasonCodes.includes('service_provider_self_promotion'));

const stale = evaluateLinkedInWarmSignal({
  origin: 'manual_post',
  text: 'Looking for a website agency for a redesign project.',
  receivedAt: '2026-07-15T10:00:00.000Z',
  postedAt: '2026-05-01T10:00:00.000Z',
  sourceUrl: 'https://www.linkedin.com/posts/acme_old-activity-999',
}, portfolio);
assert.equal(stale.outcome, 'reject');
assert.ok(stale.reasonCodes.includes('stale_linkedin_post'));

const publicSignal = evaluateLinkedInWarmSignal({
  origin: 'public_index',
  text: 'Can anyone recommend a software development partner to build a mobile app?',
  receivedAt: '2026-07-15T10:00:00.000Z',
  postedAt: '2026-07-15T08:00:00.000Z',
  sourceUrl: 'https://www.linkedin.com/posts/acme_mobile-app-activity-333',
  companyName: 'Acme Logistics',
}, portfolio);
assert.equal(publicSignal.outcome, 'research');
assert.equal(publicSignal.publicIndexVerificationRequired, true);
assert.ok(publicSignal.reasonCodes.includes('public_index_requires_human_verification'));

assert.equal(isLinkedInPostUrl('https://www.linkedin.com/posts/acme_test-activity-1'), true);
assert.equal(isLinkedInPostUrl('https://www.linkedin.com/jobs/view/123'), false);
assert.equal(isLinkedInPostUrl('https://en.wikipedia.org/wiki/LinkedIn'), false);

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Looking for a website development agency</title><link>https://www.linkedin.com/posts/acme_need-agency-activity-1</link><description>We need a website development agency to rebuild our customer portal in the United Kingdom.</description><pubDate>Wed, 15 Jul 2026 08:00:00 GMT</pubDate></item>
<item><title>LinkedIn job</title><link>https://www.linkedin.com/jobs/view/123</link><description>We are hiring a developer.</description></item>
<item><title>Wikipedia</title><link>https://en.wikipedia.org/wiki/Website</link><description>Website article.</description></item>
</channel></rss>`;
const publicIndexQueries = [
  'site:linkedin.com/posts "looking for" "website development agency" -jobs -hiring',
];
const collection = await collectPublicLinkedInIndexSignals(async () => new Response(rss, {
  status: 200,
  headers: { 'content-type': 'application/rss+xml' },
}), publicIndexQueries, 1, '2026-07-15T10:00:00.000Z');
assert.equal(collection.checked, 1);
assert.equal(collection.inputs.length, 1);
assert.equal(collection.inputs[0]?.origin, 'public_index');

const repository = new InMemoryLeadRepository();
const result = ingestLinkedInWarmSignals({
  repository,
  portfolioItems: portfolio,
  actor: 'test',
  generatedAt: '2026-07-15T10:00:00.000Z',
  signals: [
    {
      origin: 'manual_post',
      text: 'We are looking for a website development agency to rebuild our portal.',
      receivedAt: '2026-07-15T10:00:00.000Z',
      sourceUrl: 'https://www.linkedin.com/posts/acme_portal-activity-222',
      companyName: 'Acme Health',
      authorName: 'Sara Malik',
      authorRole: 'Director of Marketing',
      country: 'United Kingdom',
    },
    {
      origin: 'manual_post',
      text: 'We are looking for a website development agency to rebuild our portal.',
      receivedAt: '2026-07-15T10:00:00.000Z',
      sourceUrl: 'https://www.linkedin.com/posts/acme_portal-activity-222',
      companyName: 'Acme Health',
    },
  ],
});
assert.equal(result.created, 1);
assert.equal(result.duplicates, 1);
assert.equal(repository.listLeads().length, 1);
assert.equal(repository.listLeads()[0]?.lead.pipelineStatus, 'needs_human_review');

console.log('LinkedIn warm signal qualification, rejection, public-index and deduplication tests passed');
