import assert from 'node:assert/strict';
import { parseLinkedInSignal } from './linkedin-signal.js';

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

console.log('LinkedIn signal parser tests passed.');
