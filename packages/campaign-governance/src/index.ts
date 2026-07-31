import {createHash} from 'node:crypto';

export const CAMPAIGN_GOVERNANCE_VERSION = 'campaign-governance.v1';

export type CampaignLifecycleState = 'draft' | 'on_hold' | 'pilot' | 'active' | 'paused' | 'retired';
export type CampaignSearchSource = 'linkedin' | 'upwork' | 'sales_navigator';
export type CampaignRoute = 'direct_buyer' | 'channel_partner' | 'delivery_partner' | 'referral_partner';
export type GovernedReadinessStatus = 'draft' | 'research_only' | 'pilot_ready' | 'outreach_ready_limited' | 'outreach_ready' | 'retired';

export interface CampaignSearchInput {
  searchId: string;
  source: CampaignSearchSource;
  label: string;
  url: string;
  criteria?: Record<string, string | number | boolean | string[]>;
}

export interface GovernedCampaignSearch {
  searchId: string;
  source: CampaignSearchSource;
  label: string;
  url: string;
  normalizedUrl: string;
  normalizedCriteria: Record<string, string | number | boolean | string[]>;
  fingerprint: string;
  scopeTokens: string[];
}

export interface CampaignActivationEvidence {
  cataloguePinned: boolean;
  offerReadinessStatus: GovernedReadinessStatus;
  lastManualReviewAt?: string;
  reviewReason?: string;
}

export interface CampaignTransitionEvent {
  id: string;
  priorState: CampaignLifecycleState;
  newState: CampaignLifecycleState;
  actor: string;
  reason: string;
  occurredAt: string;
}

export interface CampaignSearchRevision {
  id: string;
  priorFingerprint: string;
  newFingerprint: string;
  actor: string;
  reason: string;
  occurredAt: string;
  searches: GovernedCampaignSearch[];
  driftDetected: boolean;
}

export interface CampaignCaptureEvent {
  id: string;
  actor: string;
  occurredAt: string;
  capturedRecords: number;
  source: CampaignSearchSource;
  externalActionAutomated: false;
}

export interface CampaignGovernanceInput {
  campaignId: string;
  version: number;
  name: string;
  owner: string;
  state: CampaignLifecycleState;
  offerId: string;
  offerVersion: number;
  route: CampaignRoute;
  searches: CampaignSearchInput[];
  activationEvidence: CampaignActivationEvidence;
  createdAt: string;
  createdBy: string;
}

export interface CampaignGovernanceRecord {
  version: typeof CAMPAIGN_GOVERNANCE_VERSION;
  campaignId: string;
  campaignVersion: number;
  name: string;
  owner: string;
  state: CampaignLifecycleState;
  offerId: string;
  offerVersion: number;
  route: CampaignRoute;
  searches: GovernedCampaignSearch[];
  searchFingerprint: string;
  activationEvidence: CampaignActivationEvidence;
  activationBlockers: string[];
  scheduleEnabled: boolean;
  searchDriftWarning?: string;
  overlapWarnings: string[];
  lastSuccessfulCaptureAt?: string;
  lastManualReviewAt?: string;
  transitionHistory: CampaignTransitionEvent[];
  searchHistory: CampaignSearchRevision[];
  captureHistory: CampaignCaptureEvent[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  humanReviewRequired: true;
  externalActionAutomated: false;
}

export interface CampaignRunDecision {
  campaignId: string;
  state: CampaignLifecycleState;
  allowed: boolean;
  scheduleEnabled: boolean;
  blockers: string[];
  searchFingerprint: string;
  searchDriftWarning?: string;
  overlapWarnings: string[];
  lastSuccessfulCaptureAt?: string;
  lastManualReviewAt?: string;
  humanReviewRequired: true;
  externalActionAutomated: false;
}

export interface EquivalentSearchFinding {
  source: CampaignSearchSource;
  fingerprint: string;
  campaigns: Array<{campaignId: string; searchId: string; label: string}>;
}

export interface CampaignOverlapFinding {
  leftCampaignId: string;
  rightCampaignId: string;
  source: CampaignSearchSource;
  overlapScore: number;
  sharedTokens: string[];
  warning: string;
}

const ALLOWED_TRANSITIONS: Record<CampaignLifecycleState, CampaignLifecycleState[]> = {
  draft: ['on_hold', 'pilot', 'retired'],
  on_hold: ['draft', 'pilot', 'retired'],
  pilot: ['active', 'paused', 'on_hold', 'retired'],
  active: ['paused', 'on_hold', 'retired'],
  paused: ['pilot', 'active', 'on_hold', 'retired'],
  retired: ['draft'],
};

export function createCampaignGovernance(input: CampaignGovernanceInput): CampaignGovernanceRecord {
  const createdAt = validIso(input.createdAt, 'createdAt');
  const searches = normalizeSearches(input.searches);
  const base = {
    version: CAMPAIGN_GOVERNANCE_VERSION,
    campaignId: requiredText(input.campaignId, 'campaignId'),
    campaignVersion: positiveInteger(input.version, 'version'),
    name: requiredText(input.name, 'name'),
    owner: requiredText(input.owner, 'owner'),
    state: input.state,
    offerId: requiredText(input.offerId, 'offerId'),
    offerVersion: positiveInteger(input.offerVersion, 'offerVersion'),
    route: input.route,
    searches,
    searchFingerprint: campaignSearchFingerprint(searches),
    activationEvidence: normalizeActivationEvidence(input.activationEvidence),
    overlapWarnings: [],
    transitionHistory: [],
    searchHistory: [],
    captureHistory: [],
    createdAt,
    createdBy: requiredText(input.createdBy, 'createdBy'),
    updatedAt: createdAt,
    humanReviewRequired: true as const,
    externalActionAutomated: false as const,
  };
  const activationBlockers = activationPrerequisites(base);
  return deepFreeze({
    ...base,
    activationBlockers,
    scheduleEnabled: runState(input.state) && activationBlockers.length === 0,
    lastManualReviewAt: base.activationEvidence.lastManualReviewAt,
  });
}

export function transitionCampaignState(
  record: CampaignGovernanceRecord,
  nextState: CampaignLifecycleState,
  input: {actor: string; reason: string; occurredAt?: string},
): CampaignGovernanceRecord {
  if (record.state === nextState) throw new Error('Campaign transition must change the lifecycle state.');
  if (!ALLOWED_TRANSITIONS[record.state].includes(nextState)) {
    throw new Error(`Invalid campaign transition: ${record.state} -> ${nextState}.`);
  }
  const occurredAt = validIso(input.occurredAt ?? new Date().toISOString(), 'occurredAt');
  const candidate = {
    ...record,
    state: nextState,
    updatedAt: occurredAt,
    transitionHistory: [
      ...record.transitionHistory,
      {
        id: `campaign-transition-${record.campaignId}-${record.transitionHistory.length + 1}`,
        priorState: record.state,
        newState: nextState,
        actor: requiredText(input.actor, 'actor'),
        reason: requiredText(input.reason, 'reason'),
        occurredAt,
      },
    ],
  };
  const blockers = activationPrerequisites(candidate);
  if (runState(nextState) && blockers.length > 0) {
    throw new Error(`Campaign cannot enter ${nextState}: ${blockers.join(' ')}`);
  }
  return deepFreeze({...candidate, activationBlockers: blockers, scheduleEnabled: runState(nextState)});
}

export function reviewCampaign(
  record: CampaignGovernanceRecord,
  input: {actor: string; reason: string; occurredAt?: string; cataloguePinned?: boolean; offerReadinessStatus?: GovernedReadinessStatus},
): CampaignGovernanceRecord {
  const occurredAt = validIso(input.occurredAt ?? new Date().toISOString(), 'occurredAt');
  const activationEvidence: CampaignActivationEvidence = {
    ...record.activationEvidence,
    cataloguePinned: input.cataloguePinned ?? record.activationEvidence.cataloguePinned,
    offerReadinessStatus: input.offerReadinessStatus ?? record.activationEvidence.offerReadinessStatus,
    lastManualReviewAt: occurredAt,
    reviewReason: requiredText(input.reason, 'reason'),
  };
  const candidate = {...record, activationEvidence, lastManualReviewAt: occurredAt, updatedAt: occurredAt};
  const blockers = activationPrerequisites(candidate);
  return deepFreeze({...candidate, activationBlockers: blockers, scheduleEnabled: runState(candidate.state) && blockers.length === 0});
}

export function updateCampaignSearches(
  record: CampaignGovernanceRecord,
  searchesInput: CampaignSearchInput[],
  input: {actor: string; reason: string; occurredAt?: string},
): CampaignGovernanceRecord {
  const searches = normalizeSearches(searchesInput);
  const nextFingerprint = campaignSearchFingerprint(searches);
  const occurredAt = validIso(input.occurredAt ?? new Date().toISOString(), 'occurredAt');
  const changed = nextFingerprint !== record.searchFingerprint;
  const revision: CampaignSearchRevision = {
    id: `campaign-search-revision-${record.campaignId}-${record.searchHistory.length + 1}`,
    priorFingerprint: record.searchFingerprint,
    newFingerprint: nextFingerprint,
    actor: requiredText(input.actor, 'actor'),
    reason: requiredText(input.reason, 'reason'),
    occurredAt,
    searches,
    driftDetected: changed,
  };
  const candidate = {
    ...record,
    searches,
    searchFingerprint: nextFingerprint,
    searchDriftWarning: changed
      ? `Search scope changed from ${record.searchFingerprint.slice(0, 12)} to ${nextFingerprint.slice(0, 12)}; manual review is required before active scheduling.`
      : undefined,
    searchHistory: [...record.searchHistory, revision],
    activationEvidence: changed
      ? {...record.activationEvidence, lastManualReviewAt: undefined, reviewReason: undefined}
      : record.activationEvidence,
    lastManualReviewAt: changed ? undefined : record.lastManualReviewAt,
    updatedAt: occurredAt,
  };
  const blockers = activationPrerequisites(candidate);
  return deepFreeze({...candidate, activationBlockers: blockers, scheduleEnabled: runState(candidate.state) && blockers.length === 0});
}

export function recordCampaignCapture(
  record: CampaignGovernanceRecord,
  input: {actor: string; source: CampaignSearchSource; capturedRecords: number; occurredAt?: string},
): CampaignGovernanceRecord {
  const decision = campaignRunDecision(record);
  if (!decision.allowed) throw new Error(`Campaign capture is blocked: ${decision.blockers.join(' ')}`);
  if (!Number.isInteger(input.capturedRecords) || input.capturedRecords < 0) throw new Error('capturedRecords must be a non-negative integer.');
  const occurredAt = validIso(input.occurredAt ?? new Date().toISOString(), 'occurredAt');
  const event: CampaignCaptureEvent = {
    id: `campaign-capture-${record.campaignId}-${record.captureHistory.length + 1}`,
    actor: requiredText(input.actor, 'actor'),
    occurredAt,
    capturedRecords: input.capturedRecords,
    source: input.source,
    externalActionAutomated: false,
  };
  return deepFreeze({
    ...record,
    lastSuccessfulCaptureAt: occurredAt,
    captureHistory: [...record.captureHistory, event],
    updatedAt: occurredAt,
  });
}

export function campaignRunDecision(record: CampaignGovernanceRecord): CampaignRunDecision {
  const blockers = activationPrerequisites(record);
  if (!runState(record.state)) blockers.unshift(`Campaign state ${record.state} is not runnable.`);
  if (record.searchDriftWarning) blockers.push(record.searchDriftWarning);
  return deepFreeze({
    campaignId: record.campaignId,
    state: record.state,
    allowed: runState(record.state) && blockers.length === 0,
    scheduleEnabled: runState(record.state) && blockers.length === 0,
    blockers: unique(blockers),
    searchFingerprint: record.searchFingerprint,
    searchDriftWarning: record.searchDriftWarning,
    overlapWarnings: record.overlapWarnings,
    lastSuccessfulCaptureAt: record.lastSuccessfulCaptureAt,
    lastManualReviewAt: record.lastManualReviewAt,
    humanReviewRequired: true,
    externalActionAutomated: false,
  });
}

export function detectEquivalentSearches(records: readonly CampaignGovernanceRecord[]): EquivalentSearchFinding[] {
  const index = new Map<string, EquivalentSearchFinding>();
  for (const record of records) {
    for (const search of record.searches) {
      const key = `${search.source}:${search.fingerprint}`;
      const finding = index.get(key) ?? {source: search.source, fingerprint: search.fingerprint, campaigns: []};
      finding.campaigns.push({campaignId: record.campaignId, searchId: search.searchId, label: search.label});
      index.set(key, finding);
    }
  }
  return [...index.values()].filter((item) => new Set(item.campaigns.map((campaign) => campaign.campaignId)).size > 1);
}

export function detectCampaignOverlaps(records: readonly CampaignGovernanceRecord[], threshold = 0.55): CampaignOverlapFinding[] {
  const findings: CampaignOverlapFinding[] = [];
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const left = records[leftIndex]!;
      const right = records[rightIndex]!;
      for (const source of ['linkedin', 'upwork', 'sales_navigator'] as CampaignSearchSource[]) {
        const leftTokens = new Set(left.searches.filter((item) => item.source === source).flatMap((item) => item.scopeTokens));
        const rightTokens = new Set(right.searches.filter((item) => item.source === source).flatMap((item) => item.scopeTokens));
        if (leftTokens.size === 0 || rightTokens.size === 0) continue;
        const shared = [...leftTokens].filter((token) => rightTokens.has(token));
        const union = new Set([...leftTokens, ...rightTokens]);
        const score = union.size === 0 ? 0 : shared.length / union.size;
        if (score >= threshold) {
          findings.push({
            leftCampaignId: left.campaignId,
            rightCampaignId: right.campaignId,
            source,
            overlapScore: Number(score.toFixed(4)),
            sharedTokens: shared.sort(),
            warning: `Campaign search scopes overlap by ${(score * 100).toFixed(0)}% for ${source}; review ownership and deduplication before activation.`,
          });
        }
      }
    }
  }
  return findings;
}

export function applyPortfolioWarnings(records: readonly CampaignGovernanceRecord[]): CampaignGovernanceRecord[] {
  const equivalents = detectEquivalentSearches(records);
  const overlaps = detectCampaignOverlaps(records);
  return records.map((record) => {
    const warnings = [
      ...equivalents
        .filter((finding) => finding.campaigns.some((item) => item.campaignId === record.campaignId))
        .map((finding) => `Equivalent ${finding.source} search is used by campaigns: ${finding.campaigns.map((item) => item.campaignId).join(', ')}.`),
      ...overlaps
        .filter((finding) => finding.leftCampaignId === record.campaignId || finding.rightCampaignId === record.campaignId)
        .map((finding) => finding.warning),
    ];
    return deepFreeze({...record, overlapWarnings: unique(warnings)});
  });
}

export function findCampaignGovernance(records: readonly CampaignGovernanceRecord[], campaignId: string): CampaignGovernanceRecord | undefined {
  return records.find((record) => record.campaignId === campaignId);
}

export function stableSearchFingerprint(search: CampaignSearchInput): string {
  return normalizeSearch(search).fingerprint;
}

function activationPrerequisites(record: {
  owner: string;
  offerId: string;
  offerVersion: number;
  searches: GovernedCampaignSearch[];
  activationEvidence: CampaignActivationEvidence;
  searchDriftWarning?: string;
}): string[] {
  const blockers: string[] = [];
  if (!record.owner.trim()) blockers.push('A named campaign owner is required.');
  if (!record.offerId.trim() || record.offerVersion < 1) blockers.push('A versioned offer is required.');
  if (record.searches.length === 0) blockers.push('At least one approved source search is required.');
  if (!record.activationEvidence.cataloguePinned) blockers.push('The versioned commercial catalogue must be pinned.');
  if (!record.activationEvidence.lastManualReviewAt) blockers.push('A current manual campaign review is required.');
  if (!['pilot_ready', 'outreach_ready_limited', 'outreach_ready'].includes(record.activationEvidence.offerReadinessStatus)) {
    blockers.push(`Offer readiness state ${record.activationEvidence.offerReadinessStatus} is not runnable.`);
  }
  if (record.searchDriftWarning) blockers.push('Search drift requires a new manual review.');
  return unique(blockers);
}

function normalizeSearches(searches: CampaignSearchInput[]): GovernedCampaignSearch[] {
  const normalized = searches.map(normalizeSearch);
  const ids = new Set<string>();
  for (const search of normalized) {
    if (ids.has(search.searchId)) throw new Error(`Duplicate campaign search ID: ${search.searchId}.`);
    ids.add(search.searchId);
  }
  return normalized.sort((a, b) => a.searchId.localeCompare(b.searchId));
}

function normalizeSearch(input: CampaignSearchInput): GovernedCampaignSearch {
  const normalizedUrl = normalizeUrl(input.url);
  const normalizedCriteria = normalizeCriteria(input.criteria ?? {});
  const material = stableJson({source: input.source, normalizedUrl, normalizedCriteria});
  return deepFreeze({
    searchId: requiredText(input.searchId, 'searchId'),
    source: input.source,
    label: requiredText(input.label, 'label'),
    url: requiredText(input.url, 'url'),
    normalizedUrl,
    normalizedCriteria,
    fingerprint: createHash('sha256').update(material).digest('hex'),
    scopeTokens: searchScopeTokens(input.source, normalizedUrl, normalizedCriteria),
  });
}

function campaignSearchFingerprint(searches: GovernedCampaignSearch[]): string {
  return createHash('sha256').update(searches.map((item) => item.fingerprint).sort().join('\n')).digest('hex');
}

function normalizeUrl(value: string): string {
  const raw = requiredText(value, 'url');
  try {
    const url = new URL(raw);
    url.hash = '';
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !['trk', 'trackingid', 'sessionid'].includes(key.toLowerCase()))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    url.search = '';
    for (const [key, item] of params) url.searchParams.append(key, item);
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.replace(/\/$/, '').toLowerCase();
  }
}

function normalizeCriteria(criteria: Record<string, string | number | boolean | string[]>): Record<string, string | number | boolean | string[]> {
  return Object.fromEntries(Object.entries(criteria)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [normalizeToken(key), Array.isArray(value) ? unique(value.map(normalizeToken)).sort() : typeof value === 'string' ? normalizeToken(value) : value]));
}

function searchScopeTokens(
  source: CampaignSearchSource,
  normalizedUrl: string,
  criteria: Record<string, string | number | boolean | string[]>,
): string[] {
  const tokens = new Set<string>([source]);
  try {
    const url = new URL(normalizedUrl);
    for (const segment of url.pathname.split('/')) addWords(tokens, segment);
    for (const [key, value] of url.searchParams.entries()) {
      addWords(tokens, key);
      addWords(tokens, value);
    }
  } catch {
    addWords(tokens, normalizedUrl);
  }
  for (const [key, value] of Object.entries(criteria)) {
    addWords(tokens, key);
    if (Array.isArray(value)) for (const item of value) addWords(tokens, item);
    else addWords(tokens, String(value));
  }
  return [...tokens].filter((token) => token.length > 2 && !STOP_TOKENS.has(token)).sort();
}

function addWords(target: Set<string>, value: string): void {
  for (const token of normalizeToken(value).split(' ')) if (token) target.add(token);
}

function normalizeActivationEvidence(value: CampaignActivationEvidence): CampaignActivationEvidence {
  return {
    cataloguePinned: value.cataloguePinned === true,
    offerReadinessStatus: value.offerReadinessStatus,
    lastManualReviewAt: value.lastManualReviewAt ? validIso(value.lastManualReviewAt, 'lastManualReviewAt') : undefined,
    reviewReason: value.reviewReason?.trim() || undefined,
  };
}

function runState(state: CampaignLifecycleState): boolean {
  return state === 'pilot' || state === 'active';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer.`);
  return value;
}

function validIso(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date.`);
  return parsed.toISOString();
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

const STOP_TOKENS = new Set(['https', 'http', 'www', 'com', 'search', 'results', 'view', 'page', 'true', 'false']);

const REVIEWED_AT = '2026-07-31T12:00:00.000Z';

const BASE_GOVERNANCE = [
  createCampaignGovernance({
    campaignId: 'fintech_buyer_direct',
    version: 1,
    name: 'FinTech and B2B Operations Buyers',
    owner: 'Waseem',
    state: 'on_hold',
    offerId: 'fintech_operations_platform',
    offerVersion: 1,
    route: 'direct_buyer',
    searches: [
      {
        searchId: 'fintech-linkedin-warm',
        source: 'linkedin',
        label: 'FinTech buyer-authored operations demand',
        url: 'https://www.linkedin.com/search/results/content/?keywords=fintech%20operations%20implementation%20partner',
        criteria: {intent: ['implementation problem', 'vendor request'], geography: 'global'},
      },
    ],
    activationEvidence: {
      cataloguePinned: true,
      offerReadinessStatus: 'research_only',
      lastManualReviewAt: REVIEWED_AT,
      reviewReason: 'Offer remains research-only; campaign is retained on hold.',
    },
    createdAt: REVIEWED_AT,
    createdBy: 'waseem@codistan.org',
  }),
  createCampaignGovernance({
    campaignId: 'software_ai_overflow_partners',
    version: 1,
    name: 'Software and AI Agencies — Overflow Delivery Partners',
    owner: 'Waseem',
    state: 'pilot',
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'delivery_partner',
    searches: [
      {
        searchId: 'salesnav-agency-delivery-leaders',
        source: 'sales_navigator',
        label: 'Agency delivery and operations leaders',
        url: 'https://www.linkedin.com/sales/search/people?keywords=delivery%20director%20software%20agency',
        criteria: {relationship: ['2nd', '3rd'], companyType: 'software agency', geography: 'global'},
      },
      {
        searchId: 'linkedin-agency-overflow-warm',
        source: 'linkedin',
        label: 'Agency overflow buyer-authored demand',
        url: 'https://www.linkedin.com/search/results/content/?keywords=software%20agency%20overflow%20development%20partner',
        criteria: {intent: ['capacity need', 'delivery partner'], geography: 'global'},
      },
    ],
    activationEvidence: {
      cataloguePinned: true,
      offerReadinessStatus: 'outreach_ready_limited',
      lastManualReviewAt: REVIEWED_AT,
      reviewReason: 'Controlled pilot approved with human-only external actions.',
    },
    createdAt: REVIEWED_AT,
    createdBy: 'waseem@codistan.org',
  }),
  createCampaignGovernance({
    campaignId: 'ai_software_referral_partners',
    version: 1,
    name: 'AI and Software Referral Partners',
    owner: 'Waseem',
    state: 'pilot',
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'referral_partner',
    searches: [
      {
        searchId: 'salesnav-consulting-referral-leaders',
        source: 'sales_navigator',
        label: 'Consulting and technology referral leaders',
        url: 'https://www.linkedin.com/sales/search/people?keywords=technology%20consulting%20partner%20software',
        criteria: {relationship: ['2nd', '3rd'], role: ['partner', 'director'], geography: 'global'},
      },
    ],
    activationEvidence: {
      cataloguePinned: true,
      offerReadinessStatus: 'outreach_ready_limited',
      lastManualReviewAt: REVIEWED_AT,
      reviewReason: 'Controlled referral pilot approved with human-only external actions.',
    },
    createdAt: REVIEWED_AT,
    createdBy: 'waseem@codistan.org',
  }),
];

export const DEFAULT_CAMPAIGN_GOVERNANCE: readonly CampaignGovernanceRecord[] = deepFreeze(applyPortfolioWarnings(BASE_GOVERNANCE));
