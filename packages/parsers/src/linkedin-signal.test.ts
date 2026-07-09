import assert from 'node:assert/strict';
import { analyzeLinkedInSignal, parseLinkedInSignal, shouldSkipLinkedInSignal } from './linkedin-signal.js';

const capturedAt = '2026-07-08T18:30:00.000Z';

const aiLead = parseLinkedInSignal({
  text: 'Posted 45 minutes ago. Looking for AI automation expert to help us route support tickets and build internal workflow automation. Any recommendations?',
  capturedAt,
  contactName: 'Example Founder',
  contactRole: 'Founder',
  country: 'United States',
});

assert.equal(aiLead.leadType, 'linkedin_warm_post');
assert.equal(aiLead.rawPayload.signalType, 'looking_for_automation_help');
assert.equal(aiLead.serviceCategory, 'ai_automation');
assert.equal(aiLead.freshnessMinutes, 45);
assert.equal(aiLead.timelineSignal, 'Active warm LinkedIn demand signal');
assert.equal(aiLead.pipelineStatus, 'new');
assert.ok(aiLead.rawPayload.confidence >= 0.5);

const partnerLead = parseLinkedInSignal({
  text: 'We are a US agency looking for a white-label delivery partner for overflow development work.',
  capturedAt,
  companyName: 'Example Agency',
});

assert.equal(partnerLead.rawPayload.signalType, 'agency_needs_delivery_partner');
assert.equal(partnerLead.serviceCategory, 'unknown');

const arLead = parseLinkedInSignal({
  text: 'Need a Unity developer / 3D team for an interactive product visualization project.',
  capturedAt,
});

assert.equal(arLead.rawPayload.signalType, 'looking_for_ar_3d_team');
assert.equal(arLead.serviceCategory, 'ar_3d_unity_unreal');

const salesNavigatorText = `Sales Navigator saved search alert\nNew lead alert: Jane Ahmed — Head of Customer Experience at Example Air\nCompany: Example Air\nRole: Head of Customer Experience\nPosted 35 minutes ago\nPain: refund backlog and customer support overload. Looking for AI automation help this week.\nhttps://www.linkedin.com/in/jane-ahmed`;

const salesNavAnalysis = analyzeLinkedInSignal({
  text: salesNavigatorText,
  capturedAt,
});
assert.equal(salesNavAnalysis.extraction.alertSourceType, 'sales_navigator_alert');
assert.equal(salesNavAnalysis.extraction.sourceUrl, 'https://www.linkedin.com/in/jane-ahmed');
assert.equal(salesNavAnalysis.extraction.contactName, 'Jane Ahmed');
assert.equal(salesNavAnalysis.extraction.companyName, 'Example Air');
assert.equal(salesNavAnalysis.extraction.contactRole, 'Head of Customer Experience');
assert.equal(salesNavAnalysis.extraction.freshnessMinutes, 35);
assert.ok(salesNavAnalysis.confidence >= 0.8);
assert.deepEqual(salesNavAnalysis.skipReasons, []);

const salesNavLead = parseLinkedInSignal({
  text: salesNavigatorText,
  capturedAt,
});
assert.equal(salesNavLead.source, 'sales_navigator');
assert.equal(salesNavLead.leadType, 'linkedin_sales_nav_alert');
assert.equal(salesNavLead.contactName, 'Jane Ahmed');
assert.equal(salesNavLead.companyName, 'Example Air');
assert.equal(salesNavLead.contactRole, 'Head of Customer Experience');
assert.equal(salesNavLead.sourceUrl, 'https://www.linkedin.com/in/jane-ahmed');
assert.equal(salesNavLead.pipelineStatus, 'new');
assert.ok(salesNavLead.rawPayload.reasons.includes('Sales Navigator alert marker detected.'));

const unsupported = shouldSkipLinkedInSignal({
  text: 'LinkedIn newsletter digest. Unsubscribe here. No buying signal in this email.',
  capturedAt,
});
assert.equal(unsupported.skip, true);
assert.ok(unsupported.reasons.some((reason) => reason.includes('No actionable')));
assert.ok(unsupported.reasons.some((reason) => reason.includes('newsletter')));

const lowConfidenceManual = analyzeLinkedInSignal({
  text: 'Random profile viewed your post.',
  capturedAt,
});
assert.equal(lowConfidenceManual.signalType, 'other');
assert.ok(lowConfidenceManual.confidence < 0.5);
assert.ok(lowConfidenceManual.skipReasons.length > 0);

console.log('LinkedIn signal parser tests passed.');
