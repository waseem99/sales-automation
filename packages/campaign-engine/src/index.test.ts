import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import {
  attachCampaignMatches,
  CAMPAIGN_ENGINE_VERSION,
  DEFAULT_PORTFOLIO,
  matchLeadToCampaigns,
  migrateLegacySalesNavigatorCampaign,
  validatePortfolio,
  type CampaignPortfolio,
} from './index.js';

const now = '2026-07-24T16:30:00.000Z';

function lead(id: string, patch: Partial<Lead>): Lead {
  return {
    id,
    source: 'sales_navigator',
    sourceUrl: `https://www.linkedin.com/sales/lead/${id}`,
    leadType: 'sales_navigator_cold_prospect',
    prospectStage: 'cold_prospect',
    title: id,
    description: 'Public professional evidence only.',
    serviceCategory: 'fullstack_web_app',
    capturedAt: now,
    pipelineStatus: 'needs_human_review',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

{
  assert.deepEqual(validatePortfolio(DEFAULT_PORTFOLIO), []);
  assert.equal(DEFAULT_PORTFOLIO.offers.length, 2);
  assert.equal(DEFAULT_PORTFOLIO.campaigns.length, 3);
  assert(DEFAULT_PORTFOLIO.campaigns.some((campaign) => campaign.route === 'direct_buyer'));
  assert(DEFAULT_PORTFOLIO.campaigns.some((campaign) => campaign.route === 'channel_partner'));
  assert(DEFAULT_PORTFOLIO.campaigns.some((campaign) => campaign.route === 'delivery_partner'));
}

{
  const prospect = lead('fintech-direct', {
    companyName: 'PayFlow FinTech',
    industry: 'payments and digital banking',
    contactName: 'Ayesha Khan',
    contactRole: 'Chief Technology Officer',
    description: 'Scaling a payments platform with workflow automation, integrations and reconciliation operations.',
    linkedinUrl: 'https://www.linkedin.com/in/ayesha-khan/',
  });
  const matches = matchLeadToCampaigns(prospect);
  const direct = matches.find((match) => match.campaignId === 'fintech_direct_buyers');
  assert(direct);
  assert(['priority_a', 'priority_b'].includes(direct.disposition));
  assert.equal(direct.explicitBuyerIntentConfirmed, false);
  assert.match(direct.inferredOpportunityHypothesis, /no buying intent is confirmed/i);
  assert.equal(direct.humanReviewRequired, true);
}

{
  const prospect = lead('fintech-channel', {
    companyName: 'FS Advisory and Systems Integrator',
    industry: 'financial services consultancy',
    contactName: 'Omar Ali',
    contactRole: 'Head of Partnerships',
    description: 'Implementation partner serving banks with integration and digital transformation programmes.',
    linkedinUrl: 'https://www.linkedin.com/in/omar-ali/',
  });
  const matches = matchLeadToCampaigns(prospect);
  const channel = matches.find((match) => match.campaignId === 'fintech_channel_partners');
  assert(channel);
  assert.equal(channel.route, 'channel_partner');
  assert(channel.positiveReasons.some((reason) => reason.includes('Account-type')));
}

{
  const prospect = lead('agency-overflow', {
    companyName: 'Northstar AI Agency',
    industry: 'software and AI agency',
    contactName: 'Sara Malik',
    contactRole: 'Founder and Head of Delivery',
    description: 'Client delivery, engineering capacity, AI implementation and white label projects.',
    linkedinUrl: 'https://www.linkedin.com/in/sara-malik/',
  });
  const matches = matchLeadToCampaigns(prospect);
  const delivery = matches.find((match) => match.campaignId === 'software_ai_overflow_partners');
  assert(delivery);
  assert.equal(delivery.route, 'delivery_partner');
  assert.match(delivery.inferredOpportunityHypothesis, /ICP-based hypothesis/);
}

{
  const warm = lead('warm-linked', {
    source: 'linkedin',
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    opportunityStatus: 'live_opportunity',
    companyName: 'PayFlow',
    contactRole: 'CTO',
    description: 'Looking for a fintech development and automation partner for integrations and operations.',
  });
  const portfolio: CampaignPortfolio = {
    ...DEFAULT_PORTFOLIO,
    campaigns: DEFAULT_PORTFOLIO.campaigns.map((campaign) => ({...campaign, source: 'linkedin'})),
  };
  const match = matchLeadToCampaigns(warm, portfolio)[0];
  assert(match);
  assert.equal(match.explicitBuyerIntentConfirmed, true);
  assert(match.positiveReasons.some((reason) => reason.includes('separate warm-demand')));
}

{
  const jobSeeker = lead('reject-job-seeker', {
    companyName: 'Independent',
    contactRole: 'Developer',
    description: 'Open to work job seeker looking for unpaid test projects.',
  });
  assert.equal(matchLeadToCampaigns(jobSeeker).length, 0);
}

{
  const pausedPortfolio: CampaignPortfolio = {
    ...DEFAULT_PORTFOLIO,
    campaigns: DEFAULT_PORTFOLIO.campaigns.map((campaign) => ({...campaign, state: 'on_hold'})),
  };
  assert.equal(matchLeadToCampaigns(lead('paused', {companyName: 'PayCo', contactRole: 'CTO'}), pausedPortfolio).length, 0);
}

{
  const legacy = migrateLegacySalesNavigatorCampaign({
    id: 'fintech_backend_operations',
    name: 'Legacy FinTech Campaign',
    enabled: false,
    target_industry_terms: ['fintech', 'payments'],
    target_personas: ['CTO', 'COO'],
    search_urls: ['https://www.linkedin.com/sales/search/people?query=test'],
    offer_summary: 'Legacy offer summary',
  });
  assert.equal(legacy.id, 'fintech_direct_buyers');
  assert.equal(legacy.state, 'on_hold');
  assert.equal(legacy.searchUrls[0]?.state, 'on_hold');
  assert.equal(legacy.searchUrls[0]?.lastAcceptanceStatus, 'needs_review');
}

{
  const invalid: CampaignPortfolio = {
    ...DEFAULT_PORTFOLIO,
    campaigns: [{...DEFAULT_PORTFOLIO.campaigns[0]!, offerId: 'missing_offer'}],
  };
  assert(validatePortfolio(invalid).some((error) => error.includes('missing offer')));
}

{
  const prospect = lead('attach', {
    companyName: 'AI Delivery Agency',
    contactRole: 'Delivery Director',
    description: 'White label implementation and overflow engineering capacity.',
    rawPayload: {parserVersion: 'fixture-v1'},
  });
  const matches = matchLeadToCampaigns(prospect);
  const attached = attachCampaignMatches(prospect, matches);
  const raw = attached.rawPayload as Record<string, unknown>;
  assert.equal(raw.parserVersion, 'fixture-v1');
  assert.equal(raw.campaignEngineVersion, CAMPAIGN_ENGINE_VERSION);
  assert(Array.isArray(raw.campaignMatches));
}

console.log('Offer and campaign engine tests passed.');
