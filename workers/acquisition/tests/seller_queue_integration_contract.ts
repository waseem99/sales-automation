import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Lead} from '../../../packages/shared/src/types.js';
import type {StoredLeadRecord} from '../../../packages/storage/src/index.js';
import {
  buildSellerQueueView,
  createSellerQueuePreferences,
  decodeSellerQueuePreferenceCookie,
  encodeSellerQueuePreferenceCookie,
  SELLER_QUEUE_PREFERENCE_COOKIE,
} from '../../../packages/seller-queues/src/index.js';

const root = resolve(process.cwd());
const queueSource = readFileSync(resolve(root, 'packages/seller-queues/src/index.ts'), 'utf8');
const handler = readFileSync(resolve(root, 'apps/web/src/prospect-handler.ts'), 'utf8');
const page = readFileSync(resolve(root, 'apps/web/src/prospects-page.ts'), 'utf8');
const view = readFileSync(resolve(root, 'apps/web/src/seller-queue-view.ts'), 'utf8');

for (const marker of [
  "SELLER_QUEUE_VERSION = 'seller-queues.v1'",
  "'follow_up_pending'",
  "'overdue'",
  "'unassigned'",
  "'priority_without_next_action'",
  "'sync_failures'",
  "'duplicates_review'",
  "'stale_records'",
  "'campaign_offer_risk'",
  'countsReconciled: true',
  'encodeSellerQueuePreferenceCookie',
  'decodeSellerQueuePreferenceCookie',
  'expectedUserId',
  'externalActionAutomated: false',
]) assert(queueSource.includes(marker), `Seller queue package missing ${marker}`);

for (const marker of [
  "pathname === '/api/seller-queues'",
  "pathname === '/api/seller-queue-preferences'",
  'buildSellerQueueView',
  'decodeSellerQueuePreferenceCookie',
  'encodeSellerQueuePreferenceCookie',
  'SELLER_QUEUE_PREFERENCE_COOKIE',
  "activeQueue: url.searchParams.get('queue')",
  "sort: url.searchParams.get('sort')",
  "response.headers['set-cookie']",
  'countsReconciled',
  'externalActionAutomated: false',
]) assert(handler.includes(marker), `Prospect handler missing ${marker}`);

for (const marker of [
  "import type { SellerQueueView } from '@sales-automation/seller-queues';",
  "import { renderSellerQueueNavigation } from './seller-queue-view.js';",
  'sellerQueue: SellerQueueView',
  'sellerUserId: string',
  '${renderSellerQueueNavigation(input.sellerQueue, input.sellerUserId)}',
]) assert(page.includes(marker), `Prospect page missing ${marker}`);

for (const marker of [
  'Follow-up Pending',
  'Priority A/B without next action',
  'Synchronization failures',
  'Duplicates needing review',
  'Campaign/offer risk',
  'Queue counts reconciled: Yes',
  'Refresh-safe signed preferences',
]) assert(view.includes(marker), `Seller queue view missing ${marker}`);

function record(id: string, patch: Partial<Lead> = {}): StoredLeadRecord {
  const lead: Lead = {
    id,
    source: 'linkedin',
    sourceUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    title: id,
    description: 'Current buyer-authored software requirement.',
    companyName: `Company ${id}`,
    contactName: `Buyer ${id}`,
    serviceCategory: 'fullstack_web_app',
    capturedAt: '2026-07-31T12:00:00.000Z',
    pipelineStatus: 'needs_human_review',
    createdAt: '2026-07-31T12:00:00.000Z',
    updatedAt: '2026-07-31T12:00:00.000Z',
    rawPayload: {
      decisionScore: {version: 'decision-score.v1', priority: 'priority_b', components: {freshness: 80}},
      bdWorkflow: {tasks: []},
      commercialReadinessDecision: {approvalAllowed: true, status: 'outreach_ready', blockers: []},
      commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
    },
    ...patch,
  };
  return {lead, notes: [], alertDedupeKeysSent: [], auditLog: []};
}

const records = [
  record('future', {owner: 'Seller A', nextFollowUpAt: '2026-08-01T09:00:00.000Z'}),
  record('overdue', {owner: 'Seller A', nextFollowUpAt: '2026-07-30T09:00:00.000Z'}),
  record('unassigned', {owner: undefined, rawPayload: {
    decisionScore: {version: 'decision-score.v1', priority: 'priority_a', components: {freshness: 80}},
    bdWorkflow: {tasks: []},
    commercialReadinessDecision: {approvalAllowed: true, status: 'outreach_ready', blockers: []},
    commercialCatalogueSelection: {commerciallyActionable: true, disqualifiers: []},
  }}),
];
const queueView = buildSellerQueueView(records, {activeQueue: 'all', generatedAt: '2026-07-31T15:00:00.000Z'});
assert.equal(queueView.queues.find((item) => item.id === 'all')?.count, 3);
assert.equal(queueView.queues.find((item) => item.id === 'follow_up_pending')?.count, 1);
assert.equal(queueView.queues.find((item) => item.id === 'overdue')?.count, 1);
assert.equal(queueView.queues.find((item) => item.id === 'unassigned')?.count, 1);
assert.equal(queueView.queues.find((item) => item.id === 'priority_without_next_action')?.count, 1);
assert.equal(queueView.countsReconciled, true);

const sellerA = createSellerQueuePreferences({userId: 'seller-a@codistan.org', activeQueue: 'overdue', sort: 'follow_up_asc', savedAt: '2026-07-31T15:00:00.000Z'});
const token = encodeSellerQueuePreferenceCookie(sellerA, 'contract-secret-value');
assert.equal(decodeSellerQueuePreferenceCookie(token, 'contract-secret-value', 'seller-a@codistan.org')?.activeQueue, 'overdue');
assert.equal(decodeSellerQueuePreferenceCookie(token, 'contract-secret-value', 'seller-b@codistan.org'), undefined);
assert.equal(SELLER_QUEUE_PREFERENCE_COOKIE, 'codistan_seller_queue_preferences');

const combined = `${queueSource}\n${handler}\n${page}\n${view}`.toLowerCase();
for (const prohibited of [
  'localstorage',
  'sessionstorage',
  'externalactionautomated: true',
  'external_action_performed: true',
  'sendlinkedinmessage(',
  'connectrequest(',
]) assert(!combined.includes(prohibited), `Seller queue boundary violated: ${prohibited}`);

console.log('Seller queue API, preference isolation and Prospect Desk contract passed.');
