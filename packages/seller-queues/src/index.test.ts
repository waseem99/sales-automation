import assert from 'node:assert/strict';
import type {Lead} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';
import {
  buildSellerQueueView,
  createSellerQueuePreferences,
  decodeSellerQueuePreferenceCookie,
  defaultSellerQueuePreferences,
  deriveSellerQueueMembership,
  encodeSellerQueuePreferenceCookie,
  readCookieValue,
  sellerQueueDeepLink,
  SELLER_QUEUE_PREFERENCE_COOKIE,
  SELLER_QUEUE_VERSION,
} from './index.js';

const now = '2026-07-31T15:00:00.000Z';

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'linkedin',
    sourceUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    title: `Prospect ${id}`,
    description: 'Buyer-authored software delivery requirement.',
    companyName: `Company ${id}`,
    contactName: `Buyer ${id}`,
    serviceCategory: 'fullstack_web_app',
    capturedAt: '2026-07-31T12:00:00.000Z',
    pipelineStatus: 'needs_human_review',
    createdAt: '2026-07-31T12:00:00.000Z',
    updatedAt: '2026-07-31T12:00:00.000Z',
    rawPayload: {
      decisionScore: {
        version: 'decision-score.v1',
        priority: 'priority_b',
        components: {freshness: 80},
      },
      bdWorkflow: {tasks: []},
      commercialReadinessDecision: {approvalAllowed: true, status: 'outreach_ready', blockers: []},
      commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
    },
    ...patch,
  };
}

function record(id: string, patch: Partial<Lead> = {}): StoredLeadRecord {
  return {lead: lead(id, patch), notes: [], alertDedupeKeysSent: [], auditLog: []};
}

const followUp = record('follow-up', {
  owner: 'Seller A',
  nextFollowUpAt: '2026-08-01T09:00:00.000Z',
});
const overdue = record('overdue', {
  owner: 'Seller A',
  nextFollowUpAt: '2026-07-30T09:00:00.000Z',
});
const unassignedPriority = record('unassigned-priority', {
  owner: undefined,
  rawPayload: {
    decisionScore: {version: 'decision-score.v1', priority: 'priority_a', components: {freshness: 90}},
    bdWorkflow: {tasks: []},
    commercialReadinessDecision: {approvalAllowed: true, status: 'outreach_ready', blockers: []},
    commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
  },
});
const syncFailure = record('sync-failure', {
  owner: 'Seller B',
  rawPayload: {
    decisionScore: {version: 'decision-score.v1', priority: 'research', components: {freshness: 70}},
    syncReconciliation: {status: 'failed', conflicts: [{field: 'owner'}]},
    deadLettered: true,
    commercialReadinessDecision: {approvalAllowed: true, status: 'outreach_ready', blockers: []},
    commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
  },
});
const duplicate = record('duplicate', {
  owner: 'Seller B',
  rawPayload: {
    decisionScore: {version: 'decision-score.v1', priority: 'research', components: {freshness: 70}},
    identityResolution: {status: 'needs_review', duplicateContactLeadIds: ['other-id']},
    commercialReadinessDecision: {approvalAllowed: true, status: 'outreach_ready', blockers: []},
    commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
  },
});
const stale = record('stale', {
  owner: 'Seller C',
  capturedAt: '2026-05-01T12:00:00.000Z',
  createdAt: '2026-05-01T12:00:00.000Z',
  updatedAt: '2026-05-15T12:00:00.000Z',
  rawPayload: {
    decisionScore: {version: 'decision-score.v1', priority: 'research', components: {freshness: 10}},
    linkedinIntent: {freshness_status: 'stale'},
    commercialReadinessDecision: {approvalAllowed: true, status: 'outreach_ready', blockers: []},
    commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
  },
});
const risk = record('risk', {
  owner: 'Seller C',
  rawPayload: {
    decisionScore: {version: 'decision-score.v1', priority: 'reject', components: {freshness: 80}},
    campaignGovernanceDecision: {allowed: false, scheduleEnabled: false, blockers: ['Campaign is paused.']},
    commercialReadinessDecision: {approvalAllowed: false, status: 'research_only', blockers: ['Offer is research-only.']},
    commercialCatalogueSelection: {commerciallyActionable: false, disqualifiers: [{code: 'unsupported_geography'}]},
  },
});
const terminal = record('terminal', {
  pipelineStatus: 'won',
  owner: undefined,
  nextFollowUpAt: '2026-07-29T09:00:00.000Z',
});

{
  assert.deepEqual(deriveSellerQueueMembership(followUp, now).queues, ['all', 'follow_up_pending']);
  assert.deepEqual(deriveSellerQueueMembership(overdue, now).queues, ['all', 'overdue']);
  const unassignedMembership = deriveSellerQueueMembership(unassignedPriority, now);
  assert(unassignedMembership.queues.includes('unassigned'));
  assert(unassignedMembership.queues.includes('priority_without_next_action'));
  assert(deriveSellerQueueMembership(syncFailure, now).queues.includes('sync_failures'));
  assert(deriveSellerQueueMembership(duplicate, now).queues.includes('duplicates_review'));
  assert(deriveSellerQueueMembership(stale, now).queues.includes('stale_records'));
  assert(deriveSellerQueueMembership(risk, now).queues.includes('campaign_offer_risk'));
  assert.deepEqual(deriveSellerQueueMembership(terminal, now).queues, ['all'], 'terminal records do not enter actionable queues');
}

const records = [followUp, overdue, unassignedPriority, syncFailure, duplicate, stale, risk, terminal];

{
  const view = buildSellerQueueView(records, {activeQueue: 'all', sort: 'priority_desc', generatedAt: now});
  assert.equal(view.version, SELLER_QUEUE_VERSION);
  assert.equal(view.countsReconciled, true);
  assert.equal(view.records.length, records.length);
  assert.equal(view.queues.find((queue) => queue.id === 'all')?.count, records.length);
  assert.equal(view.queues.find((queue) => queue.id === 'follow_up_pending')?.count, 1);
  assert.equal(view.queues.find((queue) => queue.id === 'overdue')?.count, 1);
  assert.equal(view.queues.find((queue) => queue.id === 'unassigned')?.count, 1);
  assert.equal(view.queues.find((queue) => queue.id === 'priority_without_next_action')?.count, 1);
  assert.equal(view.queues.find((queue) => queue.id === 'sync_failures')?.count, 1);
  assert.equal(view.queues.find((queue) => queue.id === 'duplicates_review')?.count, 1);
  assert.equal(view.queues.find((queue) => queue.id === 'stale_records')?.count, 1);
  assert.equal(view.queues.find((queue) => queue.id === 'campaign_offer_risk')?.count, 1);
  assert.equal(view.externalActionAutomated, false);
  assert.equal(Object.isFrozen(view), true);
}

{
  const view = buildSellerQueueView(records, {
    activeQueue: 'follow_up_pending',
    filters: {owner: 'Seller A', serviceCategory: 'fullstack_web_app'},
    sort: 'follow_up_asc',
    generatedAt: now,
  });
  assert.deepEqual(view.records.map((item) => item.lead.id), ['follow-up']);
  assert.equal(view.filters.owner, 'Seller A');
}

{
  const sorted = buildSellerQueueView(records, {activeQueue: 'all', sort: 'priority_desc', generatedAt: now});
  assert.equal(sorted.records[0]?.lead.id, 'unassigned-priority');
  const oldest = buildSellerQueueView(records, {activeQueue: 'all', sort: 'oldest_first', generatedAt: now});
  assert.equal(oldest.records[0]?.lead.id, 'stale');
}

{
  const preferences = createSellerQueuePreferences({
    userId: 'seller-a@codistan.org',
    activeQueue: 'overdue',
    sort: 'follow_up_asc',
    filters: {owner: 'Seller A', query: 'portal'},
    savedAt: now,
  });
  const cookie = encodeSellerQueuePreferenceCookie(preferences, 'a-secure-test-secret');
  const decoded = decodeSellerQueuePreferenceCookie(cookie, 'a-secure-test-secret', 'seller-a@codistan.org');
  assert.deepEqual(decoded, preferences);
  assert.equal(decodeSellerQueuePreferenceCookie(cookie, 'a-secure-test-secret', 'seller-b@codistan.org'), undefined, 'another user cannot read preferences');
  assert.equal(decodeSellerQueuePreferenceCookie(`${cookie}tampered`, 'a-secure-test-secret', 'seller-a@codistan.org'), undefined);
  const header = `${SELLER_QUEUE_PREFERENCE_COOKIE}=${encodeURIComponent(cookie)}; other=value`;
  assert.equal(readCookieValue(header, SELLER_QUEUE_PREFERENCE_COOKIE), cookie);
}

{
  const defaults = defaultSellerQueuePreferences('seller@codistan.org', now);
  assert.equal(defaults.activeQueue, 'follow_up_pending');
  assert.equal(defaults.sort, 'priority_desc');
  const link = sellerQueueDeepLink({
    queue: 'campaign_offer_risk',
    sort: 'updated_desc',
    filters: {owner: 'Seller C', query: 'risk'},
    leadId: 'risk',
  });
  assert.match(link, /^\/prospects\?/);
  assert.match(link, /queue=campaign_offer_risk/);
  assert.match(link, /sort=updated_desc/);
  assert.match(link, /leadId=risk/);
}

console.log('Seller queue membership, reconciliation and preference isolation tests passed.');
