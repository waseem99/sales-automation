import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';
import {
  buildReengagementBrief,
  buildReengagementLead,
  findReengagementMatch,
  mergeReengagementIntoLead,
  normalizeReengagementInput,
} from './reengagement.js';

const previousClient = normalizeReengagementInput({
  relationshipType: 'previous_client',
  organizationName: 'Example Health Pvt. Ltd.',
  officialWebsite: 'https://examplehealth.com',
  priorEngagementSummary: 'Codistan previously delivered an internal patient portal. This summary is internal only.',
  lastInteractionAt: '2025-10-05',
  approvedServicesDelivered: ['Patient portal development'],
  currentOpportunitySignal: 'The client is seeking an external implementation partner to automate patient support with an AI agent.',
  crossSellHypothesis: 'Offer an AI support agent and knowledge-base integration after validating current scope.',
  evidenceSourceUrl: 'https://examplehealth.com/contact',
  contactName: 'Amina Saleem',
  contactRole: 'Chief Technology Officer',
  contactEmail: 'amina@examplehealth.com',
  owner: 'waseem@codistan.org',
  followUpAt: '2026-07-20T10:00:00Z',
});
assert.equal(previousClient.relationshipStrength, 'high');
assert.equal(previousClient.opportunityStatus, 'live_opportunity');
assert.equal(previousClient.serviceCategory, 'ai_automation');

const lead = buildReengagementLead(previousClient, 'admin', '2026-07-15T12:00:00.000Z');
assert.equal(lead.source, 'manual');
assert.equal(lead.pipelineStatus, 'needs_human_review');
assert.equal(lead.opportunityStatus, 'live_opportunity');
assert.equal(lead.owner, 'waseem@codistan.org');
assert.equal(lead.nextFollowUpAt, '2026-07-20T10:00:00.000Z');
assert.ok(!lead.description.includes('previously delivered'));
assert.ok(!lead.evidenceSummary?.includes('patient portal'));
const raw = lead.rawPayload as { reengagement: { priorEngagementSummary: string; internalOnly: boolean; brief: { automaticSendingAllowed: boolean } } };
assert.equal(raw.reengagement.internalOnly, true);
assert.equal(raw.reengagement.brief.automaticSendingAllowed, false);

const dormant = normalizeReengagementInput({
  relationshipType: 'dormant_proposal',
  organizationName: 'Dormant Retail Group',
  officialWebsite: 'https://dormantretail.com',
  priorEngagementSummary: 'A website proposal was shared last year but no current requirement has been reconfirmed.',
  crossSellHypothesis: 'Reconfirm whether the website and ecommerce roadmap is still active.',
});
const dormantBrief = buildReengagementBrief(dormant);
assert.equal(dormant.relationshipStrength, 'medium');
assert.equal(dormant.opportunityStatus, 'partnership_target');
assert.equal(dormantBrief.currentIntentConfirmed, false);
assert.equal(dormantBrief.automaticSendingAllowed, false);
assert.ok(dormantBrief.missingData.some((item) => /current buyer requirement/i.test(item)));

const existingLead: Lead = {
  id: 'existing-example-health',
  source: 'manual',
  sourceUrl: 'https://examplehealth.com',
  leadType: 'partner_prospect',
  prospectStage: 'warm_lead',
  title: 'Example Health account',
  description: 'Existing account record.',
  companyName: 'Example Health Limited',
  companyWebsite: 'https://www.examplehealth.com/about',
  serviceCategory: 'website_portal',
  opportunityStatus: 'partnership_target',
  discoverySource: 'Existing account import',
  capturedAt: '2026-06-01T00:00:00.000Z',
  pipelineStatus: 'archived',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};
const record: StoredLeadRecord = { lead: existingLead, notes: [], auditLog: [] };
const match = findReengagementMatch([record], previousClient);
assert.equal(match?.record.lead.id, existingLead.id);
assert.equal(match?.reason, 'official_domain');

const merged = mergeReengagementIntoLead(existingLead, previousClient, 'admin', '2026-07-15T12:00:00.000Z');
assert.equal(merged.id, existingLead.id);
assert.equal(merged.pipelineStatus, 'needs_human_review');
assert.equal(merged.opportunityStatus, 'live_opportunity');
assert.equal(merged.serviceCategory, 'ai_automation');
assert.ok(merged.discoverySource?.includes('Re-engagement'));
assert.equal((merged.rawPayload as { reengagement: { relationshipStrength: string } }).reengagement.relationshipStrength, 'high');

assert.throws(() => normalizeReengagementInput({
  relationshipType: 'previous_client',
  organizationName: 'Personal Email Example',
  officialWebsite: 'https://personal-example.com',
  priorEngagementSummary: 'A valid internal relationship summary for testing.',
  contactEmail: 'owner@gmail.com',
}), /Personal email addresses cannot be stored/);

assert.throws(() => normalizeReengagementInput({
  relationshipType: 'previous_client',
  organizationName: 'Wrong Domain Example',
  officialWebsite: 'https://correct-domain.com',
  priorEngagementSummary: 'A valid internal relationship summary for testing.',
  contactEmail: 'owner@different-domain.com',
}), /must match the verified organization domain/);

console.log('Re-engagement normalization, privacy, deduplication and no-auto-send tests passed');
