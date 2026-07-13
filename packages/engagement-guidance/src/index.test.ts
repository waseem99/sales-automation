import assert from 'node:assert/strict';
import type { Lead, PortfolioItem } from '@sales-automation/shared';
import {
  analyzeInboundReply,
  formatFirstOutreachGuidance,
  formatReplyGuidance,
  generateFirstOutreachGuidance,
} from './index.js';

const lead: Lead = {
  id: 'lead-1',
  source: 'public_web',
  sourceUrl: 'https://example.com/news',
  leadType: 'partnership_target',
  prospectStage: 'partner_prospect',
  title: 'Example Studio expands immersive production capability',
  description: 'The studio is expanding its immersive and real-time production work.',
  companyName: 'Example Studio',
  companyWebsite: 'https://example.com',
  contactName: 'Alex Morgan',
  contactRole: 'Head of Production',
  contactEmail: 'alex@example.com',
  country: 'United States',
  industry: 'Immersive technology',
  serviceCategory: 'ar_3d_unity_unreal',
  serviceOffer: 'White-label Unity, Unreal and 3D delivery capacity.',
  materialsToShare: 'Approved immersive-production case study and delivery-pod overview.',
  reachMethod: 'Email the Head of Production.',
  opportunityStatus: 'recent_demand_signal',
  discoverySource: 'Qualified prospect research',
  evidenceUrl: 'https://example.com/news',
  evidenceSummary: 'Example Studio announced an expansion into real-time immersive production and is hiring delivery roles.',
  discoveredAt: '2026-07-13T00:00:00.000Z',
  confidence: 'high',
  budgetSignal: 'The company serves enterprise clients and is expanding production capacity.',
  timelineSignal: 'Expansion and hiring are current.',
  capturedAt: '2026-07-13T00:00:00.000Z',
  recommendedProfile: 'ar_3d_animation_profile',
  recommendedPortfolioItemIds: ['portfolio-1'],
  pipelineStatus: 'approved_to_contact',
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
};

const portfolio: PortfolioItem = {
  id: 'portfolio-1',
  projectName: 'Immersive Product Launch',
  confidentiality: 'anonymized',
  serviceCategories: ['ar_3d_unity_unreal'],
  techStack: ['Unity', 'Unreal Engine'],
  problemSolved: 'Added specialist immersive-production capacity for a launch.',
  businessOutcome: 'Delivered the experience within the launch window.',
  assetUrls: ['https://drive.example.com/item'],
  tags: ['immersive', 'unity', 'unreal'],
  bestProfiles: ['ar_3d_animation_profile'],
};

const guidance = generateFirstOutreachGuidance(lead, [portfolio], {
  generatedAt: '2026-07-13T01:00:00.000Z',
});
assert.ok(guidance.qualificationScore >= 68);
assert.ok(['priority', 'qualified'].includes(guidance.decision));
assert.equal(guidance.recommendedService, 'ar_3d_unity_unreal');
assert.equal(guidance.hardStops.length, 0);
assert.match(guidance.draft, /Hi Alex/);
assert.match(guidance.draft, /Would it be useful/);
assert.equal(guidance.subjectOptions.length, 3);
assert.match(formatFirstOutreachGuidance(guidance), /Decision:/);

const pricingReply = analyzeInboundReply(lead, 'This sounds useful. Can you share pricing and an estimate for a six-week pilot?', {
  generatedAt: '2026-07-13T02:00:00.000Z',
});
assert.equal(pricingReply.classification, 'pricing_or_budget_question');
assert.equal(pricingReply.requiresHumanApproval, true);
assert.equal(pricingReply.recommendedPipelineStatus, 'replied');
assert.match(pricingReply.suggestedResponse, /scope/);
assert.match(formatReplyGuidance(pricingReply), /Human approval: Required/);

const meetingReply = analyzeInboundReply(lead, "Yes, let's talk. Are you available for a meeting on Thursday?", {
  generatedAt: '2026-07-13T03:00:00.000Z',
});
assert.equal(meetingReply.classification, 'meeting_request');
assert.equal(meetingReply.recommendedPipelineStatus, 'meeting_booked');
assert.ok(meetingReply.meetingAgenda.length > 0);

const unsubscribeReply = analyzeInboundReply(lead, 'Please remove me from your list and do not contact me again.');
assert.equal(unsubscribeReply.classification, 'unsubscribe_or_stop');
assert.equal(unsubscribeReply.recommendedPipelineStatus, 'archived');
assert.match(unsubscribeReply.followUpInstruction, /Stop all follow-ups/);

const excludedLead: Lead = {
  ...lead,
  id: 'lead-2',
  country: 'India',
};
const excludedGuidance = generateFirstOutreachGuidance(excludedLead, [portfolio]);
assert.ok(excludedGuidance.hardStops.length > 0);
assert.equal(excludedGuidance.requiresHumanReview, true);

console.log('Engagement guidance qualification and reply-processing tests passed');
