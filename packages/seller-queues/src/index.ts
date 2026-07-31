import {createHmac, timingSafeEqual} from 'node:crypto';
import type {Lead} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const SELLER_QUEUE_VERSION = 'seller-queues.v1';
export const SELLER_QUEUE_PREFERENCE_COOKIE = 'codistan_seller_queue_preferences';

export type SellerQueueId =
  | 'all'
  | 'follow_up_pending'
  | 'overdue'
  | 'unassigned'
  | 'priority_without_next_action'
  | 'sync_failures'
  | 'duplicates_review'
  | 'stale_records'
  | 'campaign_offer_risk';

export type SellerQueueSort = 'priority_desc' | 'follow_up_asc' | 'updated_desc' | 'oldest_first';

export interface SellerQueueFilterState {
  serviceCategory?: string;
  pipelineStatus?: string;
  owner?: string;
  query?: string;
}

export interface SellerQueuePreferences {
  version: typeof SELLER_QUEUE_VERSION;
  userId: string;
  activeQueue: SellerQueueId;
  sort: SellerQueueSort;
  filters: SellerQueueFilterState;
  savedAt: string;
}

export interface SellerQueueMembership {
  leadId: string;
  queues: SellerQueueId[];
  diagnostics: Record<SellerQueueId, string[]>;
}

export interface SellerQueueDefinition {
  id: SellerQueueId;
  label: string;
  description: string;
  count: number;
}

export interface SellerQueueView {
  version: typeof SELLER_QUEUE_VERSION;
  activeQueue: SellerQueueId;
  sort: SellerQueueSort;
  filters: SellerQueueFilterState;
  records: StoredLeadRecord[];
  memberships: SellerQueueMembership[];
  queues: SellerQueueDefinition[];
  countsReconciled: true;
  generatedAt: string;
  humanReviewRequired: true;
  externalActionAutomated: false;
}

const QUEUE_META: Record<SellerQueueId, Pick<SellerQueueDefinition, 'label' | 'description'>> = {
  all: {label: 'All prospects', description: 'Every prospect visible to the authenticated seller.'},
  follow_up_pending: {label: 'Follow-up Pending', description: 'Active prospects with a scheduled future follow-up.'},
  overdue: {label: 'Overdue', description: 'Active prospects whose scheduled follow-up is past due.'},
  unassigned: {label: 'Unassigned', description: 'Active prospects without a seller owner.'},
  priority_without_next_action: {label: 'Priority A/B without next action', description: 'Priority prospects without a durable follow-up or open BD task.'},
  sync_failures: {label: 'Synchronization failures', description: 'Records with failed, deferred, dead-lettered or conflicting synchronization evidence.'},
  duplicates_review: {label: 'Duplicates needing review', description: 'Records with unresolved identity or duplicate-contact evidence.'},
  stale_records: {label: 'Stale records', description: 'Active prospects with no recent source or seller-state update.'},
  campaign_offer_risk: {label: 'Campaign/offer risk', description: 'Records blocked or downgraded by campaign governance, offer readiness or commercial disqualifiers.'},
};

const TERMINAL_STATUSES = new Set(['won', 'lost', 'rejected', 'archived']);
const QUEUE_IDS = Object.keys(QUEUE_META) as SellerQueueId[];
const SORTS = new Set<SellerQueueSort>(['priority_desc', 'follow_up_asc', 'updated_desc', 'oldest_first']);

export function buildSellerQueueView(
  records: StoredLeadRecord[],
  input: {
    activeQueue?: SellerQueueId;
    sort?: SellerQueueSort;
    filters?: SellerQueueFilterState;
    generatedAt?: string;
  } = {},
): SellerQueueView {
  const generatedAt = validIso(input.generatedAt ?? new Date().toISOString(), 'generatedAt');
  const activeQueue = normalizeQueue(input.activeQueue);
  const sort = normalizeSort(input.sort);
  const filters = normalizeFilters(input.filters ?? {});
  const memberships = records.map((record) => deriveSellerQueueMembership(record, generatedAt));
  const membershipIndex = new Map(memberships.map((membership) => [membership.leadId, membership]));
  const filtered = records.filter((record) => {
    const membership = membershipIndex.get(record.lead.id);
    return Boolean(membership?.queues.includes(activeQueue)) && matchesFilters(record, filters);
  });
  const sorted = sortSellerQueue(filtered, sort);
  const counts = Object.fromEntries(QUEUE_IDS.map((id) => [id, memberships.filter((item) => item.queues.includes(id)).length])) as Record<SellerQueueId, number>;
  const queues = QUEUE_IDS.map((id) => ({id, ...QUEUE_META[id], count: counts[id]}));
  assertCountsReconcile(records, memberships, counts);
  return deepFreeze({
    version: SELLER_QUEUE_VERSION,
    activeQueue,
    sort,
    filters,
    records: sorted,
    memberships,
    queues,
    countsReconciled: true,
    generatedAt,
    humanReviewRequired: true,
    externalActionAutomated: false,
  });
}

export function deriveSellerQueueMembership(record: StoredLeadRecord, generatedAt = new Date().toISOString()): SellerQueueMembership {
  const now = Date.parse(validIso(generatedAt, 'generatedAt'));
  const lead = record.lead;
  const raw = asRecord(lead.rawPayload);
  const diagnostics = {} as Record<SellerQueueId, string[]>;
  for (const queueId of QUEUE_IDS) diagnostics[queueId] = [];
  const queues: SellerQueueId[] = ['all'];
  diagnostics.all.push('Record is visible within the authenticated seller scope.');

  const terminal = TERMINAL_STATUSES.has(lead.pipelineStatus);
  const followUpAt = parseDate(lead.nextFollowUpAt);
  if (!terminal && followUpAt !== undefined && followUpAt >= now) {
    queues.push('follow_up_pending');
    diagnostics.follow_up_pending.push(`Next follow-up is scheduled for ${lead.nextFollowUpAt}.`);
  }
  if (!terminal && followUpAt !== undefined && followUpAt < now) {
    queues.push('overdue');
    diagnostics.overdue.push(`Next follow-up was due at ${lead.nextFollowUpAt}.`);
  }
  if (!terminal && !lead.owner?.trim()) {
    queues.push('unassigned');
    diagnostics.unassigned.push('No seller owner is assigned.');
  }

  const decision = asRecord(raw.decisionScore);
  const priority = text(decision.priority) ?? decisionPriorityFromLegacy(record);
  const workflow = asRecord(raw.bdWorkflow);
  const openTasks = arrayValue(workflow.tasks).filter((task) => !['completed', 'dismissed'].includes(text(asRecord(task).status) ?? ''));
  const noNextAction = followUpAt === undefined && openTasks.length === 0;
  if (!terminal && ['priority_a', 'priority_b'].includes(priority ?? '') && noNextAction) {
    queues.push('priority_without_next_action');
    diagnostics.priority_without_next_action.push(`${priority} has no scheduled follow-up or open BD task.`);
  }

  const syncReasons = synchronizationReasons(raw);
  if (syncReasons.length > 0) {
    queues.push('sync_failures');
    diagnostics.sync_failures.push(...syncReasons);
  }

  const duplicateReasons = duplicateReviewReasons(raw);
  if (duplicateReasons.length > 0) {
    queues.push('duplicates_review');
    diagnostics.duplicates_review.push(...duplicateReasons);
  }

  const staleReasons = staleRecordReasons(lead, raw, now);
  if (!terminal && staleReasons.length > 0) {
    queues.push('stale_records');
    diagnostics.stale_records.push(...staleReasons);
  }

  const riskReasons = campaignOfferRiskReasons(raw);
  if (riskReasons.length > 0) {
    queues.push('campaign_offer_risk');
    diagnostics.campaign_offer_risk.push(...riskReasons);
  }

  return deepFreeze({leadId: lead.id, queues: unique(queues), diagnostics});
}

export function sortSellerQueue(records: StoredLeadRecord[], sort: SellerQueueSort): StoredLeadRecord[] {
  const copied = [...records];
  if (sort === 'follow_up_asc') {
    return copied.sort((left, right) => (parseDate(left.lead.nextFollowUpAt) ?? Number.MAX_SAFE_INTEGER) - (parseDate(right.lead.nextFollowUpAt) ?? Number.MAX_SAFE_INTEGER));
  }
  if (sort === 'oldest_first') {
    return copied.sort((left, right) => recordTimestamp(left.lead) - recordTimestamp(right.lead));
  }
  if (sort === 'updated_desc') {
    return copied.sort((left, right) => recordTimestamp(right.lead) - recordTimestamp(left.lead));
  }
  return copied.sort((left, right) => {
    const priorityDifference = priorityRank(right) - priorityRank(left);
    return priorityDifference || recordTimestamp(right.lead) - recordTimestamp(left.lead);
  });
}

export function defaultSellerQueuePreferences(userId: string, savedAt = new Date().toISOString()): SellerQueuePreferences {
  return deepFreeze({
    version: SELLER_QUEUE_VERSION,
    userId: requiredText(userId, 'userId'),
    activeQueue: 'follow_up_pending',
    sort: 'priority_desc',
    filters: {},
    savedAt: validIso(savedAt, 'savedAt'),
  });
}

export function createSellerQueuePreferences(input: {
  userId: string;
  activeQueue?: unknown;
  sort?: unknown;
  filters?: unknown;
  savedAt?: string;
}): SellerQueuePreferences {
  return deepFreeze({
    version: SELLER_QUEUE_VERSION,
    userId: requiredText(input.userId, 'userId'),
    activeQueue: normalizeQueue(input.activeQueue),
    sort: normalizeSort(input.sort),
    filters: normalizeFilters(asRecord(input.filters)),
    savedAt: validIso(input.savedAt ?? new Date().toISOString(), 'savedAt'),
  });
}

export function encodeSellerQueuePreferenceCookie(preferences: SellerQueuePreferences, secret: string): string {
  if (preferences.version !== SELLER_QUEUE_VERSION) throw new Error('Unsupported seller queue preference version.');
  const payload = base64Url(JSON.stringify(preferences));
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export function decodeSellerQueuePreferenceCookie(
  value: string | undefined,
  secret: string,
  expectedUserId: string,
): SellerQueuePreferences | undefined {
  if (!value) return undefined;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return undefined;
  const expected = sign(payload, secret);
  if (!safeEqual(signature, expected)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    const record = asRecord(parsed);
    if (record.version !== SELLER_QUEUE_VERSION || record.userId !== expectedUserId) return undefined;
    return createSellerQueuePreferences({
      userId: expectedUserId,
      activeQueue: record.activeQueue,
      sort: record.sort,
      filters: record.filters,
      savedAt: requiredText(record.savedAt, 'savedAt'),
    });
  } catch {
    return undefined;
  }
}

export function sellerQueueDeepLink(input: {
  queue: SellerQueueId;
  sort: SellerQueueSort;
  filters?: SellerQueueFilterState;
  leadId?: string;
}): string {
  const params = new URLSearchParams();
  params.set('queue', normalizeQueue(input.queue));
  params.set('sort', normalizeSort(input.sort));
  const filters = normalizeFilters(input.filters ?? {});
  if (filters.serviceCategory) params.set('service', filters.serviceCategory);
  if (filters.pipelineStatus) params.set('status', filters.pipelineStatus);
  if (filters.owner) params.set('owner', filters.owner);
  if (filters.query) params.set('q', filters.query);
  if (input.leadId) params.set('leadId', input.leadId);
  return `/prospects?${params.toString()}`;
}

export function readCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function synchronizationReasons(raw: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const reconciliation = asRecord(raw.syncReconciliation ?? raw.synchronizationReconciliation);
  const status = text(reconciliation.status ?? raw.syncStatus ?? raw.synchronizationStatus);
  if (status && ['failed', 'partial', 'deferred', 'dead_letter', 'conflict'].includes(status)) reasons.push(`Synchronization status is ${status}.`);
  if (arrayValue(raw.syncConflicts ?? reconciliation.conflicts).length > 0) reasons.push('Synchronization conflicts require review.');
  if (raw.deadLettered === true || asRecord(raw.outbox).deadLettered === true) reasons.push('A durable outbox record is dead-lettered.');
  return unique(reasons);
}

function duplicateReviewReasons(raw: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const identity = asRecord(raw.identityResolution);
  const duplicateIds = arrayValue(identity.duplicateContactLeadIds ?? raw.duplicateContactLeadIds);
  if (duplicateIds.length > 0) reasons.push(`${duplicateIds.length} duplicate contact record(s) require review.`);
  if (text(identity.status) === 'needs_review' || raw.duplicateReviewRequired === true) reasons.push('Identity resolution is marked needs review.');
  return unique(reasons);
}

function staleRecordReasons(lead: Lead, raw: Record<string, unknown>, now: number): string[] {
  const reasons: string[] = [];
  const updatedAt = parseDate(lead.updatedAt ?? lead.discoveredAt ?? lead.capturedAt ?? lead.createdAt);
  if (updatedAt !== undefined && now - updatedAt > 30 * 24 * 60 * 60 * 1000) reasons.push('No record update has occurred within 30 days.');
  const score = asRecord(raw.decisionScore);
  const freshness = numberValue(asRecord(score.components).freshness);
  if (freshness !== undefined && freshness <= 25) reasons.push(`Decision-score freshness is ${freshness}/100.`);
  const intent = asRecord(raw.linkedinIntent ?? raw.linkedin_intent);
  if (['stale', 'closed'].includes(text(intent.freshness_status) ?? '')) reasons.push(`Intent evidence is ${text(intent.freshness_status)}.`);
  return unique(reasons);
}

function campaignOfferRiskReasons(raw: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const governance = asRecord(raw.campaignGovernanceDecision ?? raw.campaignGovernance);
  if (governance.allowed === false || governance.scheduleEnabled === false) reasons.push('Campaign governance blocks or pauses execution.');
  reasons.push(...stringArray(governance.blockers));
  const readiness = asRecord(raw.commercialReadinessDecision);
  if (readiness.approvalAllowed === false) reasons.push(`Offer readiness is ${text(readiness.status) ?? 'not approved'}.`);
  reasons.push(...stringArray(readiness.blockers));
  const catalogue = asRecord(raw.commercialCatalogueSelection);
  const disqualifiers = arrayValue(catalogue.disqualifiers).map((item) => text(asRecord(item).code)).filter((item): item is string => Boolean(item));
  if (disqualifiers.length > 0) reasons.push(`Commercial disqualifiers: ${disqualifiers.join(', ')}.`);
  return unique(reasons);
}

function matchesFilters(record: StoredLeadRecord, filters: SellerQueueFilterState): boolean {
  const lead = record.lead;
  if (filters.serviceCategory && lead.serviceCategory !== filters.serviceCategory) return false;
  if (filters.pipelineStatus && lead.pipelineStatus !== filters.pipelineStatus) return false;
  if (filters.owner && normalize(lead.owner ?? '') !== normalize(filters.owner)) return false;
  if (filters.query) {
    const haystack = normalize(`${lead.title} ${lead.companyName ?? ''} ${lead.contactName ?? ''} ${lead.description}`);
    if (!haystack.includes(normalize(filters.query))) return false;
  }
  return true;
}

function decisionPriorityFromLegacy(record: StoredLeadRecord): string | undefined {
  const closeability = asRecord(record.latestEvaluation?.closeability);
  const band = text(closeability.band);
  if (['priority_a', 'priority_b', 'research', 'reject'].includes(band ?? '')) return band;
  return record.latestEvaluation?.score.status === 'hot' ? 'priority_a' : record.latestEvaluation?.score.status === 'qualified' ? 'priority_b' : undefined;
}

function priorityRank(record: StoredLeadRecord): number {
  const raw = asRecord(record.lead.rawPayload);
  const priority = text(asRecord(raw.decisionScore).priority) ?? decisionPriorityFromLegacy(record);
  return priority === 'priority_a' ? 4 : priority === 'priority_b' ? 3 : priority === 'research' ? 2 : 1;
}

function recordTimestamp(lead: Lead): number {
  return parseDate(lead.updatedAt ?? lead.discoveredAt ?? lead.capturedAt ?? lead.createdAt) ?? 0;
}

function assertCountsReconcile(records: StoredLeadRecord[], memberships: SellerQueueMembership[], counts: Record<SellerQueueId, number>): void {
  if (counts.all !== records.length) throw new Error('All-prospect queue count does not reconcile with visible records.');
  for (const queue of QUEUE_IDS) {
    const derived = memberships.filter((item) => item.queues.includes(queue)).length;
    if (counts[queue] !== derived) throw new Error(`Queue count mismatch for ${queue}.`);
  }
}

function normalizeQueue(value: unknown): SellerQueueId {
  return QUEUE_IDS.includes(String(value) as SellerQueueId) ? String(value) as SellerQueueId : 'all';
}

function normalizeSort(value: unknown): SellerQueueSort {
  return SORTS.has(String(value) as SellerQueueSort) ? String(value) as SellerQueueSort : 'priority_desc';
}

function normalizeFilters(value: Record<string, unknown> | SellerQueueFilterState): SellerQueueFilterState {
  return {
    serviceCategory: optionalText(value.serviceCategory),
    pipelineStatus: optionalText(value.pipelineStatus),
    owner: optionalText(value.owner),
    query: optionalText(value.query)?.slice(0, 120),
  };
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', requiredText(secret, 'secret')).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function validIso(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date.`);
  return parsed.toISOString();
}

function parseDate(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function text(value: unknown): string | undefined {
  return optionalText(value);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
