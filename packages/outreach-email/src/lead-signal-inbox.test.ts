import assert from 'node:assert/strict';
import {
  loadLeadSignalInboxConfig,
  parsePotentialLeadSignalMessage,
} from './lead-signal-inbox.js';

const config = loadLeadSignalInboxConfig({
  LEAD_SIGNAL_MAILBOX_EMAIL: 'leads@codistan.org',
  LEAD_SIGNAL_MAILBOX_PASSWORD: 'test-password',
  LEAD_SIGNAL_IMAP_HOST: 'sales.codistan.org',
  LEAD_SIGNAL_APPROVED_FORWARDERS: 'waseem@codistan.org,talha.bashir@codistan.org',
  LEAD_SIGNAL_UPWORK_SENDERS: 'donotreply@upwork.com',
});
assert.equal(config.configured, true);
assert.equal(config.mailboxEmail, 'leads@codistan.org');
assert.equal(config.host, 'sales.codistan.org');
assert.deepEqual(config.approvedForwarders, ['waseem@codistan.org', 'talha.bashir@codistan.org']);

const nativeUpwork = parsePotentialLeadSignalMessage({
  uid: 1,
  sender: 'donotreply@upwork.com',
  subject: 'New jobs for your saved search',
  text: 'Build a React SaaS MVP. https://www.upwork.com/jobs/~012345?source=job_alert',
}, config);
assert.equal(nativeUpwork?.source, 'upwork_saved_search');
assert.equal(nativeUpwork?.sourceUrl, 'https://www.upwork.com/jobs/~012345');

const linkedIn = parsePotentialLeadSignalMessage({
  uid: 2,
  sender: 'alerts@e.linkedin.com',
  subject: 'Sales Navigator saved search alert',
  text: 'A buyer is looking for a software partner. https://www.linkedin.com/posts/acme_build-activity-123?trk=email',
}, config);
assert.equal(linkedIn?.source, 'sales_navigator_email');
assert.equal(linkedIn?.sourceUrl, 'https://www.linkedin.com/posts/acme_build-activity-123');

const approvedForward = parsePotentialLeadSignalMessage({
  uid: 3,
  sender: 'waseem@codistan.org',
  subject: 'Fwd: LinkedIn buyer request',
  text: 'Need a website agency. https://www.linkedin.com/feed/update/urn:li:activity:999',
}, config);
assert.equal(approvedForward?.source, 'linkedin_notification_email');

const unapprovedForward = parsePotentialLeadSignalMessage({
  uid: 4,
  sender: 'someone@example.com',
  subject: 'Fwd: LinkedIn buyer request',
  text: 'Need a website agency. https://www.linkedin.com/feed/update/urn:li:activity:999',
}, config);
assert.equal(unapprovedForward, undefined);

const unrelated = parsePotentialLeadSignalMessage({
  uid: 5,
  sender: 'newsletter@example.com',
  subject: 'Weekly roundup',
  text: 'No approved source evidence.',
}, config);
assert.equal(unrelated, undefined);

const backwardCompatible = loadLeadSignalInboxConfig({
  LINKEDIN_SIGNAL_MAILBOX_EMAIL: 'leads@codistan.org',
  LINKEDIN_SIGNAL_MAILBOX_PASSWORD: 'legacy-password',
  OUTREACH_IMAP_HOST: 'sales.codistan.org',
});
assert.equal(backwardCompatible.configured, true);
assert.equal(backwardCompatible.host, 'sales.codistan.org');

console.log('Unified lead signal inbox configuration, classification and approved-forwarder tests passed');
