import assert from 'node:assert/strict';
import {
  buildCampaignSearchQueries,
  campaignIdsFromEnvironment,
  DISCOVERY_CAMPAIGNS,
  resolveDiscoveryCampaigns,
} from './campaigns.js';

assert.equal(DISCOVERY_CAMPAIGNS.length, 6);
assert.deepEqual(
  resolveDiscoveryCampaigns(['cybersecurity_compliance']).map((campaign) => campaign.id),
  ['cybersecurity_compliance'],
);
assert.deepEqual(campaignIdsFromEnvironment('ai_rag_automation, custom_software_saas'), ['ai_rag_automation', 'custom_software_saas']);

const defaultCampaigns = resolveDiscoveryCampaigns();
const queries = buildCampaignSearchQueries(defaultCampaigns);
assert.ok(queries.length >= defaultCampaigns.length * 3);
assert.ok(queries.slice(0, defaultCampaigns.length).some((query) => /AI automation|RAG/i.test(query)));
assert.ok(queries.slice(0, defaultCampaigns.length).some((query) => /software development|web portal/i.test(query)));
assert.ok(queries.slice(0, defaultCampaigns.length).some((query) => /white-label/i.test(query)));
assert.ok(queries.slice(0, defaultCampaigns.length).some((query) => /cybersecurity/i.test(query)));
assert.ok(queries.slice(0, defaultCampaigns.length).some((query) => /3D animation|virtual reality/i.test(query)));
assert.ok(queries.slice(0, defaultCampaigns.length).some((query) => /digital marketing|SEO/i.test(query)));
assert.ok(queries.every((query) => /request for proposal|seeking|looking for|vendor required|partner|tender|statement of work/i.test(query)));
assert.ok(queries.every((query) => query.includes('-jobs') && query.includes('-guide')));
assert.ok(queries.every((query) => query.includes('-site:wikipedia.org') && query.includes('-site:imdb.com')));
assert.ok(!queries.some((query) => /^AI consultancy agency/i.test(query)));
assert.ok(!queries.some((query) => /^digital marketing agency/i.test(query)));

for (const campaign of defaultCampaigns) {
  assert.ok(campaign.serviceCategories.length > 0);
  assert.ok(campaign.buyerTypes.length > 0);
  assert.ok(campaign.targetMarkets.length > 0);
}

console.log('High-intent campaign selection, round-robin coverage and exclusion rules passed');
