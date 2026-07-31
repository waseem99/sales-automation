import {createHash} from 'node:crypto';
import type {Lead, PipelineStatus, ProspectFeedback} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const SELLER_FUNNEL_VERSION = 'seller-funnel.v1';

export const FUNNEL_STAGES = [
  'captured',
  'technically_valid',
  'qualified',
  'human_reviewed',
  'accepted',
  'contacted_manually',
  'replied',
  'meeting',
  'proposal',
  'won',
  'lost',
] as const;

export const FUNNEL_REASON_CODES = [
  'accept',
  'reject',
  'research',
  'duplicate',
  'stale',
  'employee_hiring',
  'no_commercial_fit',
  'unsupported_geography',
  'insufficient_proof',
  'too_small',
  'too_large',
  'timing_not_viable',
  'wrong_contact',
  'wrong_company',
  'already_known',
  'unclear_need',
] as const;

export type FunnelStage = typeof FUNNEL_STAGES[number];
export type FunnelReasonCode = typeof FUNNEL_REASON_CODES[number];
export type FunnelTransitionKind =
  | 'system_recommendation'
  | 'human_review'
  | 'manual_external_action'
  | 'confirmed_integration'
  | 'outcome';

export interface FunnelDimensions {
  source: string;
  campaignId?: string;
  offerVersion?: string;
  modelVersion?: string;
  owner?: string;
}

export interface SellerFeedbackSnapshot {
  relevanceRating?: 1 | 2 | 3 | 4 | 5;
  contactAccuracy?: 'accurate' | 'partially_accurate' | 'wrong' | 'missing';
  sourceQuality?: 'high' | 'medium' | 'low';
  repeatRecommendation?: 'increase' | 'keep' | 'reduce' | 'stop';
  correctedServiceCategory?: string;
  comment?: string;
}

export interface FunnelEvent {
  id: string;
  version: typeof SELLER_FUNNEL_VERSION;
  leadId: string;
  stage: FunnelStage;
  previousStage?: FunnelStage;
  reasonCode: FunnelReasonCode;
  actor: string;
  occurredAt: string;
  transitionKind: FunnelTransitionKind;
  dimensions: FunnelDimensions;
  evidence?: string;
  backfilled: boolean;
  feedback?: SellerFeedbackSnapshot;
  eventHash: string;
}

export interface SellerFunnelTimeline {
  version: typeof SELLER_FUNNEL_VERSION;
  events: FunnelEvent[];
  currentStage?: FunnelStage;
  updatedAt?: string;
  humanReviewRequired: true;
  externalActionAutomated: false;
}

export interface RecordFunnelTransitionInput {
  stage: FunnelStage;
  reasonCode: FunnelReasonCode;
  actor: string;
  transitionKind: FunnelTransitionKind;
  occurredAt?: string;
  evidence?: string;
  backfill?: boolean;
  feedback?: SellerFeedbackSnapshot;
}

export interface FunnelDimensionSummary {
  key: string;
  captured: number;
  qualified: number;
  accepted: number;
  contactedManually: number;
  replied: number;
  meetings: number;
  proposals: number;
  won: number;
  lost: number;
}

export interface FunnelAnalyticsSummary {
  version: typeof SELLER_FUNNEL_VERSION;
  generatedAt: string;
  totalRecords: number;
  totalEvents: number;
  stageCounts: Record<FunnelStage, number>;
  reasonCounts: Record<FunnelReasonCode, number>;
  conversionPercent: Partial<Record<FunnelStage, number>>;
  bySource: FunnelDimensionSummary[];
  byCampaign: FunnelDimensionSummary[];
  byOffer: FunnelDimensionSummary[];
  byOwner: FunnelDimensionSummary[];
  manualContactCount: number;
  confirmedIntegrationContactCount: number;
  reconciled: boolean;
  humanReviewRequired: true;
  externalActionAutomated: false;
}

const STAGE_INDEX = new Map<FunnelStage, number>(FUNNEL_STAGES.map((stage, index) => [stage, index]));
const SYSTEM_STAGES = new Set<FunnelStage>(['captured', 'technically_valid', 'qualified']);
const HUMAN_REVIEW_STAGES = new Set<FunnelStage>(['human_reviewed', 'accepted']);
const EXTERNAL_STAGES = new Set<FunnelStage>(['contacted_manually', 'replied', 'meeting', 'proposal']);
const TERMINAL_STAGES = new Set<FunnelStage>(['won', 'lost']);

export function readSellerFunnel(lead: Lead): SellerFunnelTimeline {
  const raw = asRecord(lead.rawPayload);
  const candidate = asRecord(raw.sellerFunnel);
  const events = Array.isArray(candidate.events)
    ? candidate.events.filter(isFunnelEvent).map((event) => ({...event, dimensions: {...event.dimensions}}))
    : [];
  return {
    version: SELLER_FUNNEL_VERSION,
    events,
    currentStage: events.at(-1)?.stage,
    updatedAt: events.at(-1)?.occurredAt,
    humanReviewRequired: true,
    externalActionAutomated: false,
  };
}

export function recordFunnelTransition(lead: Lead, input: RecordFunnelTransitionInput): Lead {
  validateStage(input.stage);
  validateReason(input.reasonCode);
  validateTransitionKind(input.stage, input.transitionKind);
  const actor = requiredText(input.actor, 'actor');
  const occurredAt = validIso(input.occurredAt ?? new Date().toISOString(), 'occurredAt');
  const evidence = optionalText(input.evidence, 1_000);
  if (EXTERNAL_STAGES.has(input.stage) && !evidence) {
    throw new Error(`${input.stage} requires explicit human or approved-integration evidence.`);
  }
  const timeline = readSellerFunnel(lead);
  const previousStage = timeline.currentStage;
  if (previousStage && TERMINAL_STAGES.has(previousStage)) {
    throw new Error(`Cannot transition from terminal funnel stage ${previousStage}.`);
  }
  if (!input.backfill) validateSequence(previousStage, input.stage);

  const dimensions = dimensionsForLead(lead);
  const eventBase = {
    version: SELLER_FUNNEL_VERSION,
    leadId: lead.id,
    stage: input.stage,
    previousStage,
    reasonCode: input.reasonCode,
    actor,
    occurredAt,
    transitionKind: input.transitionKind,
    dimensions,
    evidence,
    backfilled: input.backfill === true,
    feedback: normalizeFeedback(input.feedback),
  } satisfies Omit<FunnelEvent, 'id' | 'eventHash'>;
  const eventHash = hashEvent(eventBase);
  if (timeline.events.some((event) => event.eventHash === eventHash)) return lead;
  const event: FunnelEvent = {
    ...eventBase,
    id: `${lead.id}-${occurredAt}-${eventHash.slice(0, 12)}`,
    eventHash,
  };
  const raw = asRecord(lead.rawPayload);
  const nextTimeline: SellerFunnelTimeline = {
    version: SELLER_FUNNEL_VERSION,
    events: [...timeline.events, event],
    currentStage: event.stage,
    updatedAt: event.occurredAt,
    humanReviewRequired: true,
    externalActionAutomated: false,
  };
  return {
    ...lead,
    pipelineStatus: pipelineStatusForStage(event.stage, lead.pipelineStatus),
    feedback: mergeFeedback(lead.feedback, event),
    outcomeStatus: event.stage === 'won' ? 'won' : event.stage === 'lost' ? 'lost' : lead.outcomeStatus,
    outcomeReason: event.stage === 'won' || event.stage === 'lost' ? event.reasonCode : lead.outcomeReason,
    outcomeRecordedAt: event.stage === 'won' || event.stage === 'lost' ? event.occurredAt : lead.outcomeRecordedAt,
    updatedAt: event.occurredAt,
    rawPayload: {
      ...raw,
      sellerFunnel: nextTimeline,
    },
  };
}

export function applySystemFunnelStages(lead: Lead, generatedAt = new Date().toISOString()): Lead {
  let next = lead;
  const timeline = readSellerFunnel(next);
  if (!timeline.events.some((event) => event.stage === 'captured')) {
    next = recordFunnelTransition(next, {
      stage: 'captured',
      reasonCode: 'accept',
      actor: 'funnel-runtime@codistan.local',
      transitionKind: 'system_recommendation',
      occurredAt: lead.capturedAt || generatedAt,
      evidence: 'Lead record was persisted by an approved acquisition source.',
      backfill: timeline.events.length > 0,
    });
  }
  if (isTechnicallyValid(next) && !readSellerFunnel(next).events.some((event) => event.stage === 'technically_valid')) {
    next = recordFunnelTransition(next, {
      stage: 'technically_valid',
      reasonCode: 'accept',
      actor: 'funnel-runtime@codistan.local',
      transitionKind: 'system_recommendation',
      occurredAt: generatedAt,
      evidence: 'Required source, title, description, service category and capture timestamp are present.',
    });
  }
  if (isQualified(next) && !readSellerFunnel(next).events.some((event) => event.stage === 'qualified')) {
    next = recordFunnelTransition(next, {
      stage: 'qualified',
      reasonCode: 'accept',
      actor: 'funnel-runtime@codistan.local',
      transitionKind: 'system_recommendation',
      occurredAt: generatedAt,
      evidence: 'Current decision model classified the record as Priority A or Priority B for human review.',
    });
  }
  return next;
}

export function summarizeFunnel(records: StoredLeadRecord[], generatedAt = new Date().toISOString()): FunnelAnalyticsSummary {
  const stageLeadIds = Object.fromEntries(FUNNEL_STAGES.map((stage) => [stage, new Set<string>()])) as Record<FunnelStage, Set<string>>;
  const reasonCounts = Object.fromEntries(FUNNEL_REASON_CODES.map((reason) => [reason, 0])) as Record<FunnelReasonCode, number>;
  const events: FunnelEvent[] = [];
  let reconciled = true;

  for (const record of records) {
    const timeline = readSellerFunnel(record.lead);
    for (const event of timeline.events) {
      events.push(event);
      stageLeadIds[event.stage].add(record.lead.id);
      reasonCounts[event.reasonCode] += 1;
      if (!verifyFunnelEventHash(event) || event.leadId !== record.lead.id) reconciled = false;
    }
    if (timeline.currentStage !== timeline.events.at(-1)?.stage) reconciled = false;
  }

  const stageCounts = Object.fromEntries(FUNNEL_STAGES.map((stage) => [stage, stageLeadIds[stage].size])) as Record<FunnelStage, number>;
  const conversionPercent: Partial<Record<FunnelStage, number>> = {};
  const ordered = FUNNEL_STAGES.filter((stage) => stage !== 'lost');
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const previous = ordered[index - 1]!;
    conversionPercent[current] = percentage(stageCounts[current], stageCounts[previous]);
  }

  return {
    version: SELLER_FUNNEL_VERSION,
    generatedAt: validIso(generatedAt, 'generatedAt'),
    totalRecords: records.length,
    totalEvents: events.length,
    stageCounts,
    reasonCounts,
    conversionPercent,
    bySource: summarizeBy(events, (event) => event.dimensions.source || 'unknown'),
    byCampaign: summarizeBy(events, (event) => event.dimensions.campaignId || 'unassigned'),
    byOffer: summarizeBy(events, (event) => event.dimensions.offerVersion || 'unversioned'),
    byOwner: summarizeBy(events, (event) => event.dimensions.owner || 'unassigned'),
    manualContactCount: events.filter((event) => event.stage === 'contacted_manually' && event.transitionKind === 'manual_external_action').length,
    confirmedIntegrationContactCount: events.filter((event) => event.stage === 'contacted_manually' && event.transitionKind === 'confirmed_integration').length,
    reconciled,
    humanReviewRequired: true,
    externalActionAutomated: false,
  };
}

export function verifyFunnelEventHash(event: FunnelEvent): boolean {
  const {id: _id, eventHash, ...base} = event;
  return hashEvent(base) === eventHash;
}

export function isFunnelStage(value: unknown): value is FunnelStage {
  return typeof value === 'string' && (FUNNEL_STAGES as readonly string[]).includes(value);
}

export function isFunnelReasonCode(value: unknown): value is FunnelReasonCode {
  return typeof value === 'string' && (FUNNEL_REASON_CODES as readonly string[]).includes(value);
}

export function isFunnelTransitionKind(value: unknown): value is FunnelTransitionKind {
  return typeof value === 'string' && [
    'system_recommendation',
    'human_review',
    'manual_external_action',
    'confirmed_integration',
    'outcome',
  ].includes(value);
}

function summarizeBy(events: FunnelEvent[], keyFor: (event: FunnelEvent) => string): FunnelDimensionSummary[] {
  const groups = new Map<string, Map<FunnelStage, Set<string>>>();
  for (const event of events) {
    const key = keyFor(event);
    const stageMap = groups.get(key) ?? new Map<FunnelStage, Set<string>>();
    const ids = stageMap.get(event.stage) ?? new Set<string>();
    ids.add(event.leadId);
    stageMap.set(event.stage, ids);
    groups.set(key, stageMap);
  }
  return [...groups.entries()].map(([key, stageMap]) => ({
    key,
    captured: stageMap.get('captured')?.size ?? 0,
    qualified: stageMap.get('qualified')?.size ?? 0,
    accepted: stageMap.get('accepted')?.size ?? 0,
    contactedManually: stageMap.get('contacted_manually')?.size ?? 0,
    replied: stageMap.get('replied')?.size ?? 0,
    meetings: stageMap.get('meeting')?.size ?? 0,
    proposals: stageMap.get('proposal')?.size ?? 0,
    won: stageMap.get('won')?.size ?? 0,
    lost: stageMap.get('lost')?.size ?? 0,
  })).sort((left, right) => right.captured - left.captured || left.key.localeCompare(right.key));
}

function validateTransitionKind(stage: FunnelStage, kind: FunnelTransitionKind): void {
  if (SYSTEM_STAGES.has(stage) && kind !== 'system_recommendation') {
    throw new Error(`${stage} must be recorded as a system recommendation.`);
  }
  if (HUMAN_REVIEW_STAGES.has(stage) && kind !== 'human_review') {
    throw new Error(`${stage} must be recorded by human review.`);
  }
  if (stage === 'contacted_manually' && !['manual_external_action', 'confirmed_integration'].includes(kind)) {
    throw new Error('contacted_manually requires a human record or separately approved integration confirmation.');
  }
  if (['replied', 'meeting', 'proposal'].includes(stage) && !['manual_external_action', 'confirmed_integration'].includes(kind)) {
    throw new Error(`${stage} requires a human record or separately approved integration confirmation.`);
  }
  if (TERMINAL_STAGES.has(stage) && kind !== 'outcome') {
    throw new Error(`${stage} must be recorded as an outcome.`);
  }
}

function validateSequence(previous: FunnelStage | undefined, next: FunnelStage): void {
  if (!previous) {
    if (next !== 'captured') throw new Error('The first funnel stage must be captured unless explicitly backfilled.');
    return;
  }
  if (next === 'lost') return;
  const previousIndex = STAGE_INDEX.get(previous) ?? -1;
  const nextIndex = STAGE_INDEX.get(next) ?? -1;
  if (nextIndex !== previousIndex + 1) {
    throw new Error(`Invalid funnel transition from ${previous} to ${next}.`);
  }
}

function dimensionsForLead(lead: Lead): FunnelDimensions {
  const raw = asRecord(lead.rawPayload);
  const campaign = asRecord(raw.campaignGovernance ?? raw.campaignRecommendation ?? raw.campaignMatch);
  const catalogue = asRecord(raw.commercialCatalogueSelection);
  const readiness = asRecord(raw.commercialReadinessDecision);
  const decision = asRecord(raw.decisionScore);
  return {
    source: lead.source,
    campaignId: optionalText(campaign.campaignId ?? campaign.id, 160),
    offerVersion: optionalText(catalogue.offerVersion ?? catalogue.version ?? readiness.offerVersion, 160),
    modelVersion: optionalText(decision.version, 160),
    owner: optionalText(lead.owner, 160),
  };
}

function pipelineStatusForStage(stage: FunnelStage, current: PipelineStatus): PipelineStatus {
  const mapping: Partial<Record<FunnelStage, PipelineStatus>> = {
    human_reviewed: 'needs_human_review',
    accepted: 'approved_to_contact',
    contacted_manually: 'sent_manually',
    replied: 'replied',
    meeting: 'meeting_booked',
    proposal: 'proposal_sent',
    won: 'won',
    lost: 'lost',
  };
  return mapping[stage] ?? current;
}

function mergeFeedback(current: ProspectFeedback | undefined, event: FunnelEvent): ProspectFeedback | undefined {
  if (!event.feedback) return current;
  return {
    status: 'complete',
    relevanceRating: event.feedback.relevanceRating,
    contactAccuracy: event.feedback.contactAccuracy,
    sourceQuality: event.feedback.sourceQuality,
    repeatRecommendation: event.feedback.repeatRecommendation,
    correctedServiceCategory: event.feedback.correctedServiceCategory,
    reason: event.feedback.comment ?? event.reasonCode,
    recordedBy: event.actor,
    recordedAt: event.occurredAt,
  };
}

function normalizeFeedback(value: SellerFeedbackSnapshot | undefined): SellerFeedbackSnapshot | undefined {
  if (!value) return undefined;
  const rating = value.relevanceRating;
  if (rating !== undefined && ![1, 2, 3, 4, 5].includes(rating)) throw new Error('relevanceRating must be between 1 and 5.');
  return {
    relevanceRating: rating,
    contactAccuracy: value.contactAccuracy,
    sourceQuality: value.sourceQuality,
    repeatRecommendation: value.repeatRecommendation,
    correctedServiceCategory: optionalText(value.correctedServiceCategory, 160),
    comment: optionalText(value.comment, 1_000),
  };
}

function isTechnicallyValid(lead: Lead): boolean {
  return Boolean(lead.id.trim() && lead.source && lead.title.trim() && lead.description.trim() && String(lead.serviceCategory).trim() && !Number.isNaN(Date.parse(lead.capturedAt)));
}

function isQualified(lead: Lead): boolean {
  const raw = asRecord(lead.rawPayload);
  const decision = asRecord(raw.decisionScore);
  return ['priority_a', 'priority_b'].includes(String(decision.priority ?? ''));
}

function isFunnelEvent(value: unknown): value is FunnelEvent {
  const event = asRecord(value);
  return event.version === SELLER_FUNNEL_VERSION
    && typeof event.id === 'string'
    && typeof event.leadId === 'string'
    && isFunnelStage(event.stage)
    && isFunnelReasonCode(event.reasonCode)
    && isFunnelTransitionKind(event.transitionKind)
    && typeof event.actor === 'string'
    && typeof event.occurredAt === 'string'
    && typeof event.eventHash === 'string'
    && event.externalActionAutomated !== true;
}

function hashEvent(value: Omit<FunnelEvent, 'id' | 'eventHash'>): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function validateStage(value: FunnelStage): void {
  if (!isFunnelStage(value)) throw new Error('Unsupported funnel stage.');
}

function validateReason(value: FunnelReasonCode): void {
  if (!isFunnelReasonCode(value)) throw new Error('Unsupported funnel reason code.');
}

function validIso(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be a valid ISO date.`);
  return new Date(value).toISOString();
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().slice(0, maxLength);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
