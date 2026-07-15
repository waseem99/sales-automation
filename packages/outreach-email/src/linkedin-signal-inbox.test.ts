import assert from 'node:assert/strict';
import {
  loadLinkedInSignalInboxConfig,
  parsePotentialLinkedInSignalMessage,
} from './linkedin-signal-inbox.js';

const salesNavigator = parsePotentialLinkedInSignalMessage({
  messageId: '<sales-nav-1>',
  sender: 'alerts@e.linkedin.com',
  subject: 'Sales Navigator saved search alert',
  text: 'A lead posted: We are looking for a website development agency for a redesign. https://www.linkedin.com/posts/acme_redesign-activity-123?trk=email',
  receivedAt: '2026-07-15T10:00:00.000Z',
});
assert.ok(salesNavigator);
assert.equal(salesNavigator?.origin, 'sales_navigator_email');
assert.equal(salesNavigator?.sourceUrl, 'https://www.linkedin.com/posts/acme_redesign-activity-123');

const forwarded = parsePotentialLinkedInSignalMessage({
  sender: 'waseem@codistan.org',
  subject: 'Fwd: LinkedIn post — looking for a developer',
  text: 'We need a software development partner. https://www.linkedin.com/feed/update/urn:li:activity:12345',
});
assert.ok(forwarded);
assert.equal(forwarded?.origin, 'linkedin_notification_email');

const unrelated = parsePotentialLinkedInSignalMessage({
  sender: 'newsletter@example.com',
  subject: 'Weekly roundup',
  text: 'Here are some LinkedIn trends.',
});
assert.equal(unrelated, undefined);

const unsafeForward = parsePotentialLinkedInSignalMessage({
  sender: 'waseem@codistan.org',
  subject: 'Fwd: Random article',
  text: 'No LinkedIn post URL is included.',
});
assert.equal(unsafeForward, undefined);

const missingConfig = loadLinkedInSignalInboxConfig({});
assert.equal(missingConfig.configured, false);
assert.equal(missingConfig.folder, 'INBOX');

const configured = loadLinkedInSignalInboxConfig({
  LINKEDIN_SIGNAL_MAILBOX_EMAIL: 'linkedin-signals@codistan.org',
  LINKEDIN_SIGNAL_MAILBOX_PASSWORD: 'test-password',
  LINKEDIN_SIGNAL_IMAP_FOLDER: 'Signals',
  LINKEDIN_SIGNAL_MAX_MESSAGES: '45',
});
assert.equal(configured.configured, true);
assert.equal(configured.mailboxEmail, 'linkedin-signals@codistan.org');
assert.equal(configured.folder, 'Signals');
assert.equal(configured.maxMessages, 45);

console.log('LinkedIn signal inbox sender, forwarding, URL and configuration tests passed');
