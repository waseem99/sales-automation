import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import {
  getRampDailyLimit,
  isLiveSendingAllowed,
  isRecipientBusinessTime,
  loadOutreachEmailConfig,
  parseSuppressions,
  planOutreachMessages,
  processInboundReply,
  resolveRecipientTimeZone,
} from './index.js';

const now = '2026-07-13T14:00:00.000Z';
const environment = {
  OUTREACH_SMTP_HOST: 'sgp200.greengeeks.net',
  OUTREACH_SMTP_PORT: '465',
  OUTREACH_SMTP_SECURE: 'true',
  OUTREACH_IMAP_HOST: 'sgp200.greengeeks.net',
  OUTREACH_IMAP_PORT: '993',
  OUTREACH_IMAP_SECURE: 'true',
  TALHA_MAILBOX_PASSWORD: 'test-only-talha-password',
  JAWAD_MAILBOX_PASSWORD: 'test-only-jawad-password',
  OUTREACH_SENDER_EMAILS: 'talha.bashir@codistan.org,jawad.jutt@codistan.org',
  OUTREACH_ALERT_EMAILS: 'waseem@codistan.org,sales@codistan.org',
  OUTREACH_SENDING_ENABLED: 'true',
  OUTREACH_DNS_READY: 'true',
  OUTREACH_DRY_RUN: 'false',
  OUTREACH_RAMP_STARTED_AT: '2026-07-13T00:00:00.000Z',
} as NodeJS.ProcessEnv;

const config = loadOutreachEmailConfig(environment);
assert.equal(config.smtpHost, 'sgp200.greengeeks.net');
assert.equal(config.smtpPort, 465);
assert.equal(config.imapPort, 993);
assert.equal(config.mailboxes.length, 2);
assert.equal(config.activeSenderEmails.length, 2);
assert.equal(isLiveSendingAllowed(config), true);
assert.equal(getRampDailyLimit(config, now), 10);

const safeConfig = loadOutreachEmailConfig({
  ...environment,
  OUTREACH_DRY_RUN: 'true',
});
assert.equal(isLiveSendingAllowed(safeConfig), false, 'Dry-run must block live SMTP sends.');

assert.equal(resolveRecipientTimeZone({ country: 'Pakistan' }), 'Asia/Karachi');
assert.equal(resolveRecipientTimeZone({ country: 'United States', region: 'California' }), 'America/Los_Angeles');
assert.equal(isRecipientBusinessTime({ country: 'United States' }, now), true);

const repository = new InMemoryLeadRepository();
const lead = buildLead();
repository.upsertLead(lead, 'test');
repository.addNote(lead.id, 'guidance::first_outreach::Decision: Qualified\n\nSubjects: Focused AI delivery support | AI support for Example AI', 'test');

const plan = planOutreachMessages({ repository, config, now });
assert.equal(plan.messages.length, 1);
assert.equal(plan.messages[0]?.leadId, lead.id);
assert.equal(plan.messages[0]?.sequence, 0);
assert.match(plan.messages[0]?.text ?? '', /unsubscribe/i);
assert.match(plan.messages[0]?.text ?? '', /Codistan Ventures Building/);
assert.ok(['talha.bashir@codistan.org', 'jawad.jutt@codistan.org'].includes(plan.messages[0]?.sender.email ?? ''));

const reply = processInboundReply({
  repository,
  record: repository.getLead(lead.id)!,
  replyBody: 'Please remove me from your list and do not contact me again.',
  messageId: '<reply-1@example.com>',
  from: 'alex@example.com',
  receivedAt: '2026-07-13T15:00:00.000Z',
  mailboxEmail: 'talha.bashir@codistan.org',
});
assert.equal(reply.guidance.classification, 'unsubscribe_or_stop');
assert.equal(reply.suppressed, true);
assert.equal(repository.getLead(lead.id)?.lead.pipelineStatus, 'archived');
assert.equal(parseSuppressions(repository.getLead(lead.id)!).length, 1);
assert.equal(
  planOutreachMessages({ repository, config, now: '2026-07-14T14:00:00.000Z' }).messages.length,
  0,
  'Suppressed prospects must never be planned again.',
);

console.log('cPanel outreach configuration, planning and reply-suppression tests passed');

function buildLead(): Lead {
  return {
    id: 'outreach-test-lead',
    source: 'manual',
    sourceUrl: 'https://example.com/news',
    leadType: 'manual_lead',
    prospectStage: 'manual_lead',
    title: 'Example AI expands enterprise delivery',
    description: 'The company is expanding its enterprise AI delivery work.',
    companyName: 'Example AI',
    companyWebsite: 'https://example.com',
    contactName: 'Alex Morgan',
    contactRole: 'Founder',
    contactEmail: 'alex@example.com',
    country: 'United States',
    region: 'New York',
    industry: 'Software',
    serviceCategory: 'ai_automation',
    serviceOffer: 'AI automation and integration delivery support.',
    materialsToShare: 'Approved AI automation case study.',
    reachMethod: 'Business email',
    opportunityStatus: 'recent_demand_signal',
    discoverySource: 'Manual test prospect',
    evidenceUrl: 'https://example.com/news',
    evidenceSummary: 'Official material shows current enterprise AI expansion.',
    discoveredAt: now,
    confidence: 'high',
    budgetSignal: 'Enterprise customer base and current expansion.',
    timelineSignal: 'Current expansion.',
    capturedAt: now,
    draftMessage: 'Hi Alex,\n\nI noticed Example AI is expanding its enterprise delivery. Codistan can support this with a focused AI automation team. Would it be useful if I sent two relevant examples?',
    owner: 'talha.bashir@codistan.org',
    pipelineStatus: 'draft_ready',
    createdAt: now,
    updatedAt: now,
  };
}
