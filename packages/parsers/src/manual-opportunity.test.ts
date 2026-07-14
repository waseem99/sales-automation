import assert from 'node:assert/strict';
import { parseManualOpportunity } from './manual-opportunity.js';

const capturedAt = '2026-07-14T18:00:00.000Z';

const referral = parseManualOpportunity({
  kind: 'referral_note',
  content: 'Referral from an existing client. A Canadian nonprofit needs a fixed-scope web portal and CRM integration project this quarter.',
  capturedAt,
  companyName: 'Example Foundation',
  contactName: 'Sarah Example',
  contactRole: 'Director of Operations',
  country: 'Canada',
});
assert.equal(referral.source, 'manual');
assert.equal(referral.leadType, 'manual_lead');
assert.equal(referral.opportunityStatus, 'live_opportunity');
assert.equal(referral.serviceCategory, 'enterprise_systems');
assert.equal(referral.companyName, 'Example Foundation');
assert.equal(referral.pipelineStatus, 'new');
assert.equal((referral.rawPayload as { externalActionAutomated?: boolean }).externalActionAutomated, false);

const salesNavigator = parseManualOpportunity({
  kind: 'sales_navigator_alert',
  content: 'New lead alert: Jane Founder — COO at Example SaaS\nCompany: Example SaaS\nLooking for an AI automation partner to reduce support backlog.\nhttps://www.linkedin.com/in/jane-example',
  capturedAt,
});
assert.equal(salesNavigator.source, 'sales_navigator');
assert.equal(salesNavigator.leadType, 'linkedin_sales_nav_alert');
assert.equal(salesNavigator.companyName, 'Example SaaS');
assert.equal(salesNavigator.serviceCategory, 'ai_automation');

const publicUrl = parseManualOpportunity({
  kind: 'public_url',
  content: 'Request for proposal for software development and implementation of a digital platform with defined deliverables.',
  sourceUrl: 'https://buyer.example.org/rfp/platform?utm_source=team',
  capturedAt,
});
assert.equal(publicUrl.sourceUrl, 'https://buyer.example.org/rfp/platform');
assert.equal(publicUrl.source, 'public_web');
assert.equal(publicUrl.opportunityStatus, 'live_opportunity');

const employee = parseManualOpportunity({
  kind: 'copied_alert',
  content: 'We are hiring a full-time AI engineer. Apply now with your resume. Annual salary and work authorization are required.',
  capturedAt,
});
assert.equal(employee.opportunityStatus, 'recent_demand_signal');
assert.equal(employee.pipelineStatus, 'needs_research');
assert.match(employee.evidenceSummary ?? '', /candidate application is outside/i);

assert.throws(() => parseManualOpportunity({
  kind: 'public_url',
  content: 'Public software opportunity with sufficient descriptive text.',
  capturedAt,
}), /valid public http\/https URL/i);

assert.throws(() => parseManualOpportunity({
  kind: 'referral_note',
  content: 'Too short',
  capturedAt,
}), /at least 20 characters/i);

console.log('Approved manual opportunity parser tests passed');
