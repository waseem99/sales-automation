import assert from 'node:assert/strict';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import {
  appendEnrichmentAuditMetadata,
  createEnrichmentEvidence,
  planEnrichment,
  rejectEnrichmentEvidence,
  summarizeEnrichment,
  verifyEnrichmentEvidence,
} from './index.js';

const generatedAt = '2026-07-09T05:00:00.000Z';
const repository = new InMemoryLeadRepository();
const hotLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-rag-001');
assert.ok(hotLead, 'Expected hot sample lead.');
const lowBudgetLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-lowbudget-001');
assert.ok(lowBudgetLead, 'Expected low-budget sample lead.');

const hotRecord = repository.saveEvaluation(
  evaluateLead({ lead: hotLead, portfolioItems: samplePortfolioItems, generatedAt }),
  'enrichment-test',
);

const manualPlan = planEnrichment({ record: hotRecord });
assert.equal(manualPlan.allowed, true);
assert.equal(manualPlan.paidAllowed, false);
assert.equal(manualPlan.requiresHumanVerification, true);
assert.ok(manualPlan.requestedFields.includes('business_email'));

const paidBlockedPlan = planEnrichment({
  record: hotRecord,
  provider: 'paid_data_provider',
  estimatedCostCents: 100,
});
assert.equal(paidBlockedPlan.allowed, false);
assert.ok(paidBlockedPlan.blockedReasons.includes('Paid enrichment is disabled by policy.'));

const paidAllowedPlan = planEnrichment({
  record: hotRecord,
  provider: 'paid_data_provider',
  estimatedCostCents: 100,
  policy: {
    paidEnrichmentEnabled: true,
    monthlyBudgetCents: 1000,
    spentThisMonthCents: 200,
    minLeadScoreForPaidEnrichment: 70,
  },
});
assert.equal(paidAllowedPlan.allowed, true);
assert.equal(paidAllowedPlan.paidAllowed, true);

const rejectedRecord = repository.saveEvaluation(
  evaluateLead({ lead: lowBudgetLead, portfolioItems: samplePortfolioItems, generatedAt }),
  'enrichment-test',
);
repository.updateStatus(rejectedRecord.lead.id, 'rejected', 'enrichment-test');
const rejectedPlan = planEnrichment({ record: repository.getLead(rejectedRecord.lead.id)! });
assert.equal(rejectedPlan.allowed, false);
assert.ok(rejectedPlan.blockedReasons.includes('Rejected leads must not be enriched.'));

const overBudgetPlan = planEnrichment({
  record: hotRecord,
  provider: 'paid_data_provider',
  estimatedCostCents: 900,
  policy: {
    paidEnrichmentEnabled: true,
    monthlyBudgetCents: 1000,
    spentThisMonthCents: 200,
  },
});
assert.equal(overBudgetPlan.allowed, false);
assert.ok(overBudgetPlan.blockedReasons.includes('Paid enrichment would exceed the monthly budget.'));

const emailEvidence = createEnrichmentEvidence({
  field: 'business_email',
  value: ' founder@example.com ',
  provider: 'manual_research',
  sourceUrl: 'https://example.com/team',
  confidence: 0.82,
  costCents: 0,
});
assert.equal(emailEvidence.value, 'founder@example.com');
assert.equal(emailEvidence.verificationStatus, 'needs_human_review');

const verifiedEmail = verifyEnrichmentEvidence(emailEvidence, 'waseem', generatedAt);
assert.equal(verifiedEmail.verificationStatus, 'verified');
assert.equal(verifiedEmail.verifiedBy, 'waseem');

const profileEvidence = createEnrichmentEvidence({
  field: 'linkedin_profile_url',
  value: 'https://linkedin.com/in/example',
  provider: 'linkedin_manual_review',
  confidence: 0.6,
  costCents: 0,
});
const rejectedProfile = rejectEnrichmentEvidence(profileEvidence, 'reviewer', 'Wrong person');
assert.equal(rejectedProfile.verificationStatus, 'rejected');
assert.equal(rejectedProfile.notes, 'Wrong person');

const summary = summarizeEnrichment([verifiedEmail, rejectedProfile]);
assert.equal(summary.totalFields, 2);
assert.equal(summary.verifiedFields, 1);
assert.equal(summary.rejectedFields, 1);
assert.equal(summary.hasVerifiedBusinessEmail, true);
assert.equal(summary.outreachReady, true);

appendEnrichmentAuditMetadata(hotRecord, [verifiedEmail, rejectedProfile], 'enrichment-test');
const enrichmentAudit = hotRecord.auditLog.find((entry) => entry.metadata?.enrichmentSummary);
assert.ok(enrichmentAudit, 'Expected enrichment audit metadata.');

assert.throws(
  () => createEnrichmentEvidence({ field: 'business_email', value: '', provider: 'manual_research', confidence: 0.5, costCents: 0 }),
  /Enrichment value is required/,
);
assert.throws(
  () => createEnrichmentEvidence({ field: 'business_email', value: 'x@example.com', provider: 'manual_research', confidence: 2, costCents: 0 }),
  /Confidence must be between 0 and 1/,
);

console.log('Enrichment policy tests passed.');
