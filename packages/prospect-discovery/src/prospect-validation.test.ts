import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import {
  findStoredAutomaticProspectFalsePositives,
  hasResultLevelProjectOpportunityIntent,
  validateAutomaticProspectCandidate,
  validateStoredAutomaticProspectLead,
} from './prospect-validation.js';
import type { DiscoveryCandidate } from './types.js';

const imdb = candidate({
  sourceUrl: 'https://www.imdb.com/title/tt4552118/',
  title: 'Looking (TV Movie 2016) - IMDb',
  summary: 'Looking is a TV movie with cast, plot summary and release information.',
  opportunityStatus: 'live_opportunity',
});
const wikipedia = candidate({
  sourceUrl: 'https://en.wikipedia.org/wiki/Looking_(TV_series)',
  title: 'Looking (TV series) - Wikipedia',
  summary: 'Looking is an American comedy-drama television series.',
  opportunityStatus: 'live_opportunity',
});
const mozGuide = candidate({
  sourceUrl: 'https://moz.com/beginners-guide-to-seo',
  title: "Beginner's Guide to SEO (Search Engine Optimization) - Moz",
  summary: 'Learn the fundamentals of search engine optimization in this complete guide.',
  opportunityStatus: 'live_opportunity',
});

for (const item of [imdb, wikipedia, mozGuide]) {
  const validation = validateAutomaticProspectCandidate(item);
  assert.equal(validation.qualified, false, `${item.sourceUrl} must be rejected`);
  assert.equal(validation.hardReject, true);
}

const genuineRfp = candidate({
  sourceUrl: 'https://example.gov/procurement/rfp-digital-platform',
  title: 'Request for Proposal for digital platform development',
  summary: 'The organization invites qualified software vendors to submit technical and financial proposals for design and implementation of a web portal.',
  opportunityStatus: 'live_opportunity',
});
assert.equal(validateAutomaticProspectCandidate(genuineRfp).qualified, true);

const explicitBuyerRequest = candidate({
  sourceUrl: 'https://buyer.example.com/partner-request',
  title: 'We are looking for a development partner',
  summary: 'Our company is seeking an external software agency to build and maintain a mobile application.',
  opportunityStatus: 'live_opportunity',
});
assert.equal(validateAutomaticProspectCandidate(explicitBuyerRequest).qualified, true);

const companyHomepage = candidate({
  sourceUrl: 'https://credibleagency.example/',
  title: 'Credible Agency - AI and software consultancy',
  summary: 'Product design, software engineering and AI implementation services.',
  opportunityStatus: 'partnership_target',
  sourceType: 'directory',
});
assert.equal(validateAutomaticProspectCandidate(companyHomepage).qualified, true);

assert.equal(hasResultLevelProjectOpportunityIntent('Looking (TV series) - Wikipedia'), false);
assert.equal(hasResultLevelProjectOpportunityIntent('How to choose a development partner: complete guide'), false);
assert.equal(hasResultLevelProjectOpportunityIntent('We are looking for a development partner to build our platform'), true);
assert.equal(hasResultLevelProjectOpportunityIntent('Request for Proposal for implementation of a CRM platform'), true);

const storedLeads = [
  storedLead('imdb-lead', imdb),
  storedLead('wikipedia-lead', wikipedia),
  storedLead('moz-guide-lead', mozGuide),
  storedLead('valid-rfp', genuineRfp),
  {
    ...storedLead('manual-wikipedia-note', wikipedia),
    source: 'manual' as const,
    discoverySource: 'Approved manual intake',
    rawPayload: { manualIntake: { suppliedBy: 'admin' } },
  },
];

assert.equal(validateStoredAutomaticProspectLead(storedLeads[0]!).qualified, false);
const cleanup = findStoredAutomaticProspectFalsePositives(storedLeads);
assert.deepEqual(cleanup.map((item) => item.leadId).sort(), ['imdb-lead', 'moz-guide-lead', 'wikipedia-lead']);

console.log('Automatic prospect intent, editorial/reference rejection and stored cleanup tests passed');

function candidate(input: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, 'sourceUrl' | 'title' | 'summary' | 'opportunityStatus'>): DiscoveryCandidate {
  return {
    sourceName: 'Bing RSS: "looking for a development partner" software',
    sourceType: input.sourceType ?? 'search',
    sourceUrl: input.sourceUrl,
    title: input.title,
    summary: input.summary,
    opportunityStatus: input.opportunityStatus,
    publishedAt: '2026-07-14T10:00:00.000Z',
  };
}

function storedLead(id: string, item: DiscoveryCandidate): Lead {
  return {
    id,
    source: 'public_web',
    sourceUrl: item.sourceUrl,
    leadType: item.opportunityStatus === 'live_opportunity' ? 'public_opportunity' : 'partnership_target',
    prospectStage: 'warm_lead',
    title: item.title,
    description: item.summary,
    companyName: item.title.split(' - ')[0],
    companyWebsite: new URL(item.sourceUrl).origin,
    serviceCategory: 'unknown',
    opportunityStatus: item.opportunityStatus,
    discoverySource: item.sourceName,
    evidenceUrl: item.sourceUrl,
    evidenceSummary: item.evidenceSummary ?? `Discovered through a public search feed for: ${item.sourceName}`,
    capturedAt: '2026-07-14T12:00:00.000Z',
    pipelineStatus: 'needs_human_review',
    rawPayload: {
      prospectDiscovery: {
        sourceName: item.sourceName,
        sourceType: item.sourceType,
        sourceUrl: item.sourceUrl,
        opportunityStatus: item.opportunityStatus,
      },
    },
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
  };
}
