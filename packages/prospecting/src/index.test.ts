import assert from 'node:assert/strict';
import {
  getSolutionCampaign,
  partnerProspectToLead,
  scorePartnerProspect,
  scoreSolutionProspect,
  solutionCampaigns,
  solutionProspectToLead,
} from './index.js';

const capturedAt = '2026-07-08T21:30:00.000Z';

const partnerScore = scorePartnerProspect({
  companyName: 'Example AI Studio',
  targetType: 'software_agency',
  country: 'United States',
  companySize: '11-50',
  servicesOffered: ['software development', 'web apps', 'SaaS delivery'],
  observedSignals: ['Hiring AI automation engineers', 'Client delivery overload mentioned by founder'],
  buyingTriggers: ['client_delivery_overload', 'ai_service_gap'],
  contactName: 'Jane Founder',
  contactRole: 'Founder',
  sourceUrl: 'https://example.com/partner',
  capturedAt,
});

assert.equal(partnerScore.status, 'priority');
assert.equal(partnerScore.urgency, 'urgent');
assert.ok(partnerScore.total >= 80);
assert.ok(partnerScore.recommendedAngle.includes('white-label') || partnerScore.recommendedAngle.includes('AI/RAG'));

const partnerLead = partnerProspectToLead({
  companyName: 'Example AI Studio',
  targetType: 'software_agency',
  country: 'United States',
  companySize: '11-50',
  servicesOffered: ['software development', 'web apps', 'SaaS delivery'],
  observedSignals: ['Hiring AI automation engineers', 'Client delivery overload mentioned by founder'],
  buyingTriggers: ['client_delivery_overload', 'ai_service_gap'],
  contactName: 'Jane Founder',
  contactRole: 'Founder',
  sourceUrl: 'https://example.com/partner',
  capturedAt,
}, partnerScore);

assert.equal(partnerLead.source, 'partner_research');
assert.equal(partnerLead.leadType, 'partner_prospect');
assert.equal(partnerLead.pipelineStatus, 'new');
assert.equal(partnerLead.companyName, 'Example AI Studio');

const weakPartnerScore = scorePartnerProspect({
  companyName: 'Random Local Shop',
  targetType: 'other',
  country: 'Unknown',
  servicesOffered: ['retail'],
  observedSignals: [],
  buyingTriggers: ['none'],
  capturedAt,
});
assert.equal(weakPartnerScore.status, 'reject');
assert.ok(weakPartnerScore.redFlags.length > 0);

const campaign = getSolutionCampaign('airline_refund_automation');
assert.equal(campaign.name, 'Airline Refund Automation');
assert.ok(solutionCampaigns.length >= 4);

const solutionScore = scoreSolutionProspect({
  campaignId: 'airline_refund_automation',
  companyName: 'Example Air',
  industry: 'airline customer support',
  buyerRole: 'Head of Customer Experience',
  country: 'UAE',
  observedPainSignals: ['refund backlog', 'support overload', 'manual refund handling'],
  sourceUrl: 'https://example.com/airline',
  capturedAt,
});
assert.equal(solutionScore.status, 'priority');
assert.equal(solutionScore.urgency, 'urgent');
assert.ok(solutionScore.recommendedAngle.includes('refund'));

const solutionLead = solutionProspectToLead({
  campaignId: 'airline_refund_automation',
  companyName: 'Example Air',
  industry: 'airline customer support',
  buyerRole: 'Head of Customer Experience',
  country: 'UAE',
  observedPainSignals: ['refund backlog', 'support overload', 'manual refund handling'],
  sourceUrl: 'https://example.com/airline',
  capturedAt,
}, solutionScore);
assert.equal(solutionLead.source, 'solution_campaign');
assert.equal(solutionLead.leadType, 'solution_led_prospect');
assert.equal(solutionLead.serviceCategory, 'ai_automation');
assert.equal(solutionLead.pipelineStatus, 'new');

assert.throws(() => getSolutionCampaign('missing' as never), /Unknown solution campaign/);

console.log('Prospecting model tests passed.');
