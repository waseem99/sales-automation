import assert from 'node:assert/strict';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import {
  recommendProspectApproach,
  recommendProspectAssignment,
} from './assignment.js';
import { renderProspectCsv } from './digest.js';
import {
  classifyOpportunityStatus,
  hasProjectOpportunityIntent,
  isEmploymentVacancy,
  parseRssItems,
} from './sources.js';
import { candidateToLead, runProspectDiscovery } from './runner.js';
import { classifyTargeting, EXPANDED_TARGET_SEARCH_QUERIES } from './targeting.js';
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

assert.equal(
  classifyOpportunityStatus('Full-time Senior AI Engineer. Apply now with your resume and salary expectations.'),
  'recent_demand_signal',
);
assert.equal(isEmploymentVacancy('Join our team in a full-time permanent role with benefits.'), true);
assert.equal(hasProjectOpportunityIntent('Join our team in a full-time permanent role with benefits.'), false);
assert.equal(
  classifyOpportunityStatus('Request for proposal: fixed-scope RAG implementation project with defined deliverables.'),
  'live_opportunity',
);

assert.ok(EXPANDED_TARGET_SEARCH_QUERIES.some((query) => query.includes('digital marketing agency')));
assert.ok(EXPANDED_TARGET_SEARCH_QUERIES.some((query) => query.includes('cybersecurity consultancy')));
assert.ok(EXPANDED_TARGET_SEARCH_QUERIES.some((query) => query.includes('animation VFX studio')));

const remoteAiTarget = classifyTargeting(
  'Need a RAG and AI workflow automation implementation partner',
  'United States',
);
assert.equal(remoteAiTarget.portfolioIdentity, 'Hilarious AI');
assert.equal(remoteAiTarget.serviceCategory, 'rag_document_intelligence');
assert.equal(remoteAiTarget.deliveryModel, 'remote_first');

const cyberTarget = classifyTargeting(
  'Seeking SOC 2, ISO 27001 and cloud security consulting',
  'United Kingdom',
);
assert.equal(cyberTarget.portfolioIdentity, 'Cytas');
assert.equal(cyberTarget.serviceCategory, 'cybersecurity_compliance');
assert.equal(cyberTarget.deliveryModel, 'remote_first');

const localCampaignTarget = classifyTargeting(
  'Social media management, influencer activation and an on-site video shoot',
  'Islamabad, Pakistan',
);
assert.equal(localCampaignTarget.portfolioIdentity, 'Codistan');
assert.equal(localCampaignTarget.deliveryModel, 'local_weighted');
assert.ok(localCampaignTarget.reachMethod.includes('Local-first Pakistan'));

const motionlyTarget = classifyTargeting(
  'Unity game development with AR/VR and immersive production',
  'UAE',
);
assert.equal(motionlyTarget.portfolioIdentity, 'Motionly');
assert.equal(motionlyTarget.serviceCategory, 'ar_3d_unity_unreal');
assert.equal(motionlyTarget.deliveryModel, 'remote_first');

const now = '2026-07-11T10:00:00.000Z';
const classifiedLead = candidateToLead({
  sourceName: 'Public search',
  sourceType: 'search',
  sourceUrl: 'https://example-security.com/rfp',
  title: 'Cybersecurity compliance partner required',
  summary: 'Need ISO 27001, SOC 2 and cloud security support.',
  companyName: 'Example Security Buyer',
  companyWebsite: 'https://example-security.com',
  country: 'Canada',
  opportunityStatus: 'live_opportunity',
  evidenceSummary: 'Current public RFP.',
}, now);
assert.equal(classifiedLead.serviceCategory, 'cybersecurity_compliance');
assert.equal(classifiedLead.serviceOffer, 'Cybersecurity, cloud security and compliance services');
assert.ok(classifiedLead.materialsToShare?.includes('Cytas'));
assert.ok(classifiedLead.reachMethod?.includes('Remote-first'));
assert.equal(recommendProspectAssignment(classifiedLead).owner, 'jawad.jutt@codistan.org');
assert.equal(recommendProspectApproach(classifiedLead).channel, 'procurement_portal');

const remoteOkPayload = [
  { legal: 'metadata' },
  {
    id: 'project-1',
    position: 'AI RAG Fixed-Scope Implementation Project',
    company: 'Example AI',
    location: 'United States',
    description: '<p>Contract project seeking an implementation partner for defined RAG and workflow automation deliverables.</p>',
    tags: ['ai', 'rag', 'python'],
    url: 'https://remoteok.com/remote-jobs/123-example-ai',
    date: now,
  },
  {
    id: 'employee-role',
    position: 'Senior AI Engineer',
    company: 'Employee Only Inc',
    location: 'United States only',
    description: '<p>Full-time permanent role. Apply now with your resume. Salary, benefits and work authorization required.</p>',
    tags: ['ai', 'python'],
    url: 'https://remoteok.com/remote-jobs/employee-only',
    date: now,
  },
  {
    id: 'job-stale',
    position: 'Old AI Automation Contract Project',
    company: 'Old Example',
    location: 'United States',
    description: '<p>Fixed-scope automation project with defined deliverables.</p>',
    tags: ['ai', 'automation'],
    url: 'https://remoteok.com/remote-jobs/old-example',
    date: '2026-01-06T10:00:00.000Z',
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
  lookbackHours: 78,
});

assert.equal(first.run.newLeadCount, 1);
assert.equal(first.run.lookbackHours, 78);
assert.equal(first.run.emailStatus, 'skipped');
assert.equal(first.newLeads[0]?.companyName, 'Example AI');
assert.equal(first.newLeads[0]?.companyWebsite, 'https://example-ai.com');
assert.equal(first.newLeads[0]?.contactName, 'Sarah Jones');
assert.equal(first.newLeads[0]?.contactRole, 'Founder');
assert.equal(first.newLeads[0]?.contactEmail, 'partnerships@example-ai.com');
assert.equal(first.newLeads[0]?.opportunityStatus, 'live_opportunity');
assert.equal(first.newLeads[0]?.serviceCategory, 'rag_document_intelligence');
assert.equal(first.newLeads[0]?.serviceOffer, 'AI solutions, RAG, agents and workflow automation');
assert.ok(first.newLeads[0]?.owner?.endsWith('@codistan.org'));
assert.equal(first.newLeads[0]?.reachMethod, 'Email');
assert.ok(first.newLeads[0]?.recommendedNextAction?.includes('sales@codistan.org'));
assert.ok(first.newLeads[0]?.draftMessage);
assert.equal(runStore.listRuns().length, 1);
assert.equal(first.sourceResults.find((result) => result.sourceName === 'remoteok')?.candidates.length, 1);

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
  lookbackHours: 78,
});
assert.equal(second.run.newLeadCount, 0);
assert.equal(second.run.duplicateCount, 1);

console.log('prospect-discovery project-intent, vacancy rejection, recent-window, assignment and approach tests passed');
