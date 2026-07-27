import { createHash } from 'node:crypto';
import { readBdWorkflow } from '@sales-automation/bd-workflow';
import { readOutreachWorkbench } from '@sales-automation/outreach-workbench';
import type { Lead, PipelineStatus } from '@sales-automation/shared';
import type { AuditEntry, StoredLeadRecord } from '@sales-automation/storage';

export const COMMERCIAL_ANALYTICS_VERSION = 'commercial-analytics.v1';

export type CommercialDimension = 'source' | 'campaign' | 'channel' | 'service' | 'owner';
export type CalibrationDecisionValue = 'keep' | 'change' | 'stop';
export type SuggestedDecision = CalibrationDecisionValue | 'insufficient_data';
export type AiRecommendationDisposition = 'accepted' | 'edited' | 'rejected' | 'pending';
export type CommercialValueKind = 'pipeline' | 'proposal' | 'won_revenue';

export interface CommercialPeriod {
  from: string;
  to: string;
  days: number;
}

export interface FunnelCounts {
  captured: number;
  unique: number;
  enriched: number;
  evidenceComplete: number;
  duplicates: number;
  identityConflicts: number;
  bdAccepted: number;
  contacted: number;
  replies: number;
  meetings: number;
  proposals: number;
  wins: number;
  losses: number;
  rejected: number;
  suppressed: number;
  dueFollowUps: number;
  onTimeFollowUps: number;
}

export interface FunnelRates {
  enrichmentRate: number;
  evidenceCompletenessRate: number;
  duplicateRate: number;
  bdAcceptanceRate: number;
  contactRate: number;
  replyRate: number;
  meetingRate: number;
  proposalRate: number;
  winRate: number;
  followUpComplianceRate: number;
}

export interface TimeMetrics {
  averageHoursToAssign?: number;
  averageHoursToReview?: number;
  averageHoursToFirstContact?: number;
}

export interface AiDispositionCounts {
  accepted: number;
  edited: number;
  rejected: number;
  pending: number;
}

export interface CurrencyTotals {
  currency: string;
  pipeline: number;
  proposal: number;
  wonRevenue: number;
  entryCount: number;
}

export interface CommercialLaneScorecard {
  dimension: CommercialDimension;
  key: string;
  label: string;
  counts: FunnelCounts;
  rates: FunnelRates;
  timings: TimeMetrics;
  aiDisposition: AiDispositionCounts;
  values: CurrencyTotals[];
  reviewedSampleSize: number;
  suggestedDecision: SuggestedDecision;
  suggestedReason: string;
  officialDecision?: CalibrationDecision;
  warnings: string[];
}

export interface CommercialAnalyticsSummary {
  counts: FunnelCounts;
  rates: FunnelRates;
  timings: TimeMetrics;
  aiDisposition: AiDispositionCounts;
  values: CurrencyTotals[];
  reviewedSampleSize: number;
}

export interface CommercialAnalyticsReport {
  version: typeof COMMERCIAL_ANALYTICS_VERSION;
  generatedAt: string;
  period: CommercialPeriod;
  summary: CommercialAnalyticsSummary;
  lanes: Record<CommercialDimension, CommercialLaneScorecard[]>;
  dataWarnings: string[];
  externalActionPerformed: false;
  fabricatedOutcomeCount: 0;
}

export interface CommercialValueEntry {
  id: string;
  leadId: string;
  kind: CommercialValueKind;
  amount: number;
  currency: string;
  note: string;
  enteredAt: string;
  enteredBy: string;
  source: 'manual_entry';
  explicitValue: true;
}

export interface RecordCommercialValueInput {
  kind: CommercialValueKind;
  amount: number;
  currency: string;
  note: string;
  actor: string;
  enteredAt?: string;
}

export interface CalibrationDecision {
  id: string;
  dimension: CommercialDimension;
  laneKey: string;
  laneLabel: string;
  decision: CalibrationDecisionValue;
  rationale: string;
  evidence: string[];
  reviewedSampleSize: number;
  plannedChange?: string;
  reactivationCriteria?: string;
  effectiveFrom: string;
  reviewedAt: string;
  reviewedBy: string;
  status: 'active';
}

export interface CalibrationDecisionInput {
  dimension: CommercialDimension;
  laneKey: string;
  laneLabel: string;
  decision: CalibrationDecisionValue;
  rationale: string;
  evidence: string[];
  reviewedSampleSize: number;
  plannedChange?: string;
  reactivationCriteria?: string;
  effectiveFrom?: string;
  reviewedAt?: string;
  reviewedBy: string;
}

export interface BuildCommercialAnalyticsInput {
  records: StoredLeadRecord[];
  generatedAt?: string;
  from?: string;
  to?: string;
  days?: number;
  decisions?: CalibrationDecision[];
}

interface RecordFacts {
  record: StoredLeadRecord;
  captureAt: string;
  cohort: boolean;
  enriched: boolean;
  evidenceComplete: boolean;
  duplicate: boolean;
  identityConflict: boolean;
  suppressed: boolean;
  bdAcceptedAt?: string;
  assignedAt?: string;
  reviewedAt?: string;
  contactedAt?: string;
  replyAt?: string;
  meetingAt?: string;
  proposalAt?: string;
  winAt?: string;
  lossAt?: string;
  rejectedAt?: string;
  dueFollowUps: Array<{dueAt: string; completedAt?: string}>;
  aiDisposition: AiRecommendationDisposition;
  values: CommercialValueEntry[];
  dimensions: Record<CommercialDimension, Array<{key: string; label: string}>>;
}

const ACCEPTED_STATUSES = new Set<PipelineStatus>([
  'approved_to_contact', 'draft_ready', 'sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won',
]);
const TERMINAL_STATUSES = new Set<PipelineStatus>(['won', 'lost', 'rejected', 'archived']);
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildCommercialAnalytics(input: BuildCommercialAnalyticsInput): CommercialAnalyticsReport {
  const generatedAt = validIso(input.generatedAt) ?? new Date().toISOString();
  const period = resolvePeriod(input, generatedAt);
  const decisions = new Map((input.decisions ?? []).filter((item) => item.status === 'active').map((item) => [decisionKey(item.dimension, item.laneKey), item]));
  const facts = input.records.map((record) => inspectRecord(record, period));
  const summary = aggregateFacts(facts, period);
  const dimensions: CommercialDimension[] = ['source', 'campaign', 'channel', 'service', 'owner'];
  const lanes = Object.fromEntries(dimensions.map((dimension) => [dimension, buildDimensionLanes(dimension, facts, period, decisions)])) as Record<CommercialDimension, CommercialLaneScorecard[]>;
  const dataWarnings = buildDataWarnings(input.records, facts, summary);
  return {
    version: COMMERCIAL_ANALYTICS_VERSION,
    generatedAt,
    period,
    summary,
    lanes,
    dataWarnings,
    externalActionPerformed: false,
    fabricatedOutcomeCount: 0,
  };
}

export function recordCommercialValue(lead: Lead, input: RecordCommercialValueInput): Lead {
  const enteredAt = validIso(input.enteredAt) ?? new Date().toISOString();
  const kind = requireValueKind(input.kind);
  const amount = finiteNonNegative(input.amount, 'amount');
  const currency = normalizeCurrency(input.currency);
  if (kind === 'won_revenue' && lead.pipelineStatus !== 'won' && lead.outcomeStatus !== 'won') {
    throw new Error('Won revenue may be recorded only after the prospect is marked won.');
  }
  const entry: CommercialValueEntry = {
    id: `commercial-value-${shortHash(`${lead.id}:${kind}:${amount}:${currency}:${enteredAt}:${input.actor}`)}`,
    leadId: lead.id,
    kind,
    amount,
    currency,
    note: requiredText(input.note, 'note', 1200),
    enteredAt,
    enteredBy: requiredText(input.actor, 'actor', 200),
    source: 'manual_entry',
    explicitValue: true,
  };
  const raw = asRecord(lead.rawPayload);
  const history = commercialValueHistory(lead);
  if (!history.some((item) => item.id === entry.id)) history.push(entry);
  return {
    ...lead,
    rawPayload: {
      ...raw,
      commercialAnalyticsVersion: COMMERCIAL_ANALYTICS_VERSION,
      commercialValues: history,
    },
    updatedAt: laterIso(lead.updatedAt, enteredAt),
  };
}

export function commercialValueHistory(lead: Lead): CommercialValueEntry[] {
  const raw = asRecord(lead.rawPayload);
  if (!Array.isArray(raw.commercialValues)) return [];
  return raw.commercialValues.flatMap((value) => isCommercialValueEntry(value) ? [value] : []);
}

export function createCalibrationDecision(input: CalibrationDecisionInput): CalibrationDecision {
  const reviewedAt = validIso(input.reviewedAt) ?? new Date().toISOString();
  const effectiveFrom = validIso(input.effectiveFrom) ?? reviewedAt;
  const dimension = requireDimension(input.dimension);
  const laneKey = normalizeLaneKey(input.laneKey);
  const decision = requireDecision(input.decision);
  const evidence = uniqueStrings(input.evidence).map((item) => requiredText(item, 'evidence item', 800));
  if (evidence.length === 0) throw new Error('At least one evidence item is required.');
  const reviewedSampleSize = positiveInteger(input.reviewedSampleSize, 'reviewedSampleSize');
  const plannedChange = optionalText(input.plannedChange, 1500);
  const reactivationCriteria = optionalText(input.reactivationCriteria, 1500);
  if (decision === 'change' && !plannedChange) throw new Error('plannedChange is required for a change decision.');
  if (decision === 'stop' && !reactivationCriteria) throw new Error('reactivationCriteria is required for a stop decision.');
  const rationale = requiredText(input.rationale, 'rationale', 2000);
  const reviewedBy = requiredText(input.reviewedBy, 'reviewedBy', 200);
  return {
    id: `calibration-${shortHash(`${dimension}:${laneKey}:${decision}:${reviewedAt}:${reviewedBy}`)}`,
    dimension,
    laneKey,
    laneLabel: requiredText(input.laneLabel, 'laneLabel', 300),
    decision,
    rationale,
    evidence,
    reviewedSampleSize,
    plannedChange,
    reactivationCriteria,
    effectiveFrom,
    reviewedAt,
    reviewedBy,
    status: 'active',
  };
}

export function suggestedCalibrationDecision(counts: FunnelCounts, rates: FunnelRates, reviewedSampleSize: number): {decision: SuggestedDecision; reason: string} {
  if (reviewedSampleSize < 10 || counts.contacted < 5) {
    return {decision: 'insufficient_data', reason: 'A representative reviewed sample and at least five manual contact attempts are required before material calibration.'};
  }
  if (counts.wins > 0 || counts.meetings >= 2 || rates.replyRate >= 0.15) {
    return {decision: 'keep', reason: 'The lane has recorded downstream commercial evidence; continue while monitoring precision and owner capacity.'};
  }
  if (reviewedSampleSize >= 20 && rates.bdAcceptanceRate < 0.2 && counts.replies === 0) {
    return {decision: 'stop', reason: 'A sufficiently reviewed sample has weak BD acceptance and no recorded replies. Pause rather than optimize for volume.'};
  }
  if (counts.contacted >= 10 && counts.replies === 0) {
    return {decision: 'change', reason: 'Ten or more recorded manual contacts produced no reply; change one major targeting or playbook rule and compare the next sample.'};
  }
  return {decision: 'change', reason: 'The lane has enough reviewed activity for a controlled change, but not enough downstream evidence to keep it unchanged.'};
}

function buildDimensionLanes(
  dimension: CommercialDimension,
  facts: RecordFacts[],
  period: CommercialPeriod,
  decisions: Map<string, CalibrationDecision>,
): CommercialLaneScorecard[] {
  const groups = new Map<string, {label: string; facts: RecordFacts[]}>();
  for (const fact of facts) {
    for (const laneValue of fact.dimensions[dimension]) {
      const existing = groups.get(laneValue.key) ?? {label: laneValue.label, facts: []};
      existing.facts.push(fact);
      groups.set(laneValue.key, existing);
    }
  }
  return [...groups.entries()].map(([key, group]) => {
    const summary = aggregateFacts(group.facts, period);
    const suggestion = suggestedCalibrationDecision(summary.counts, summary.rates, summary.reviewedSampleSize);
    const warnings: string[] = [];
    if (summary.counts.captured >= 5 && summary.counts.evidenceComplete === 0) warnings.push('No record in this lane has complete retained evidence.');
    if (summary.counts.duplicates > 0) warnings.push(`${summary.counts.duplicates} duplicate or duplicate-contact record(s) require review.`);
    if (summary.counts.contacted > 0 && summary.counts.replies === 0) warnings.push('Manual contact attempts have no recorded replies in the selected period.');
    if (dimension === 'channel' && key === 'unrecorded') warnings.push('The contact channel is missing; channel performance cannot be calibrated accurately.');
    return {
      dimension,
      key,
      label: group.label,
      ...summary,
      suggestedDecision: suggestion.decision,
      suggestedReason: suggestion.reason,
      officialDecision: decisions.get(decisionKey(dimension, key)),
      warnings,
    };
  }).sort((left, right) => right.counts.contacted - left.counts.contacted || right.counts.captured - left.counts.captured || left.label.localeCompare(right.label));
}

function aggregateFacts(facts: RecordFacts[], period: CommercialPeriod): CommercialAnalyticsSummary {
  const counts = emptyCounts();
  const assignHours: number[] = [];
  const reviewHours: number[] = [];
  const contactHours: number[] = [];
  const aiDisposition: AiDispositionCounts = {accepted: 0, edited: 0, rejected: 0, pending: 0};
  const values: CommercialValueEntry[] = [];
  let reviewedSampleSize = 0;
  for (const fact of facts) {
    if (fact.cohort) {
      counts.captured += 1;
      counts.unique += 1;
      if (fact.enriched) counts.enriched += 1;
      if (fact.evidenceComplete) counts.evidenceComplete += 1;
      if (fact.duplicate) counts.duplicates += 1;
      if (fact.identityConflict) counts.identityConflicts += 1;
      if (fact.suppressed) counts.suppressed += 1;
      if (fact.bdAcceptedAt) counts.bdAccepted += 1;
      if (fact.record.lead.feedback?.status === 'complete') reviewedSampleSize += 1;
      aiDisposition[fact.aiDisposition] += 1;
      const created = Date.parse(fact.captureAt);
      if (fact.assignedAt) pushHours(assignHours, created, Date.parse(fact.assignedAt));
      if (fact.reviewedAt) pushHours(reviewHours, created, Date.parse(fact.reviewedAt));
      if (fact.contactedAt) pushHours(contactHours, created, Date.parse(fact.contactedAt));
    }
    if (inPeriod(fact.contactedAt, period)) counts.contacted += 1;
    if (inPeriod(fact.replyAt, period)) counts.replies += 1;
    if (inPeriod(fact.meetingAt, period)) counts.meetings += 1;
    if (inPeriod(fact.proposalAt, period)) counts.proposals += 1;
    if (inPeriod(fact.winAt, period)) counts.wins += 1;
    if (inPeriod(fact.lossAt, period)) counts.losses += 1;
    if (inPeriod(fact.rejectedAt, period)) counts.rejected += 1;
    for (const followUp of fact.dueFollowUps) {
      if (!inPeriod(followUp.dueAt, period)) continue;
      counts.dueFollowUps += 1;
      if (followUp.completedAt && Date.parse(followUp.completedAt) <= Date.parse(followUp.dueAt) + DAY_MS) counts.onTimeFollowUps += 1;
    }
    values.push(...fact.values.filter((entry) => inPeriod(entry.enteredAt, period)));
  }
  return {
    counts,
    rates: ratesFrom(counts),
    timings: {
      averageHoursToAssign: average(assignHours),
      averageHoursToReview: average(reviewHours),
      averageHoursToFirstContact: average(contactHours),
    },
    aiDisposition,
    values: summarizeValues(values),
    reviewedSampleSize,
  };
}

function inspectRecord(record: StoredLeadRecord, period: CommercialPeriod): RecordFacts {
  const lead = record.lead;
  const raw = asRecord(lead.rawPayload);
  const enrichment = asRecord(raw.enrichment);
  const identity = asRecord(raw.identityGraph);
  const workbench = readOutreachWorkbench(lead);
  const workflow = readBdWorkflow(lead);
  const captureAt = validIso(lead.discoveredAt) ?? validIso(lead.capturedAt) ?? validIso(lead.createdAt) ?? period.from;
  const sentRecords = workbench?.drafts.flatMap((draft) => draft.sentVersions.map((sent) => ({...sent, draftChannel: draft.channel}))) ?? [];
  const statusEvents = record.auditLog.flatMap(statusEvent);
  const contactedAt = earliestIso([...sentRecords.map((item) => item.sentAt), lead.lastContactedAt]);
  const replyAt = earliestIso([lead.lastResponseAt, statusAt(statusEvents, 'replied')]);
  const meetingAt = earliestIso([statusAt(statusEvents, 'meeting_booked')]);
  const proposalAt = earliestIso([statusAt(statusEvents, 'proposal_sent')]);
  const winAt = earliestIso([statusAt(statusEvents, 'won'), lead.outcomeStatus === 'won' ? lead.outcomeRecordedAt : undefined]);
  const lossAt = earliestIso([statusAt(statusEvents, 'lost'), lead.outcomeStatus === 'lost' ? lead.outcomeRecordedAt : undefined]);
  const rejectedAt = earliestIso([statusAt(statusEvents, 'rejected'), lead.outcomeStatus === 'rejected' ? lead.outcomeRecordedAt : undefined]);
  const bdAcceptedAt = earliestIso([
    ...statusEvents.filter((item) => ACCEPTED_STATUSES.has(item.status)).map((item) => item.at),
    ACCEPTED_STATUSES.has(lead.pipelineStatus) ? lead.updatedAt : undefined,
  ]);
  const assignedAt = earliestAudit(record.auditLog, 'owner_assigned');
  const reviewedAt = earliestIso([
    ...statusEvents.filter((item) => !['new', 'scored'].includes(item.status)).map((item) => item.at),
    record.latestEvaluation ? record.latestEvaluation.generatedAt : undefined,
  ]);
  const dueFollowUps = workflow?.tasks.flatMap((task) => {
    if (!task.dueAt || !['schedule_follow_up', 'follow_up_proposal'].includes(task.code)) return [];
    return [{dueAt: task.dueAt, completedAt: task.status === 'completed' ? task.completedAt : undefined}];
  }) ?? [];
  const duplicateContactIds = stringArray(identity.duplicateContactLeadIds);
  const identityConflicts = stringArray(identity.conflicts).length + stringArray(identity.conflictingEvidence).length;
  const suppressed = raw.doNotContact === true || asRecord(enrichment.suppression).suppressed === true;
  const draftChannels = workbench?.drafts.map((draft) => draft.channel) ?? [];
  return {
    record,
    captureAt,
    cohort: inPeriod(captureAt, period),
    enriched: Boolean(lead.companyWebsite && (lead.contactEmail || lead.linkedinUrl || lead.contactFormUrl || lead.source === 'upwork')),
    evidenceComplete: Boolean((lead.evidenceUrl || lead.sourceUrl) && lead.evidenceSummary?.trim() && (lead.companyName || lead.prospectStage === 'warm_lead')),
    duplicate: lead.outcomeStatus === 'duplicate' || duplicateContactIds.length > 0,
    identityConflict: identityConflicts > 0,
    suppressed,
    bdAcceptedAt,
    assignedAt,
    reviewedAt,
    contactedAt,
    replyAt,
    meetingAt,
    proposalAt,
    winAt,
    lossAt,
    rejectedAt,
    dueFollowUps,
    aiDisposition: aiDispositionFor(workbench),
    values: commercialValueHistory(lead),
    dimensions: dimensionsFor(record, sentRecords.map((item) => item.draftChannel), draftChannels),
  };
}

function dimensionsFor(record: StoredLeadRecord, sentChannels: string[], draftChannels: string[]): Record<CommercialDimension, Array<{key: string; label: string}>> {
  const lead = record.lead;
  const campaign = campaignLane(lead);
  const channelCandidates = sentChannels.length ? sentChannels : draftChannels.length ? draftChannels : [channelFallback(lead)];
  const channels = uniqueStrings(channelCandidates);
  return {
    source: [lane(sourceKey(lead), sourceLabel(sourceKey(lead)))],
    campaign: [campaign],
    channel: channels.map((channel) => lane(normalizeLaneKey(channel || 'unrecorded'), label(channel || 'unrecorded'))),
    service: [lane(normalizeLaneKey(lead.serviceCategory || 'unknown'), label(lead.serviceCategory || 'unknown'))],
    owner: [lane(normalizeLaneKey(lead.owner || 'unassigned'), lead.owner || 'Unassigned')],
  };
}

function campaignLane(lead: Lead): {key: string; label: string} {
  const raw = asRecord(lead.rawPayload);
  const primary = asRecord(raw.primaryCampaignMatch);
  const id = String(primary.campaignId ?? primary.id ?? raw.campaignId ?? '').trim();
  const name = String(primary.campaignName ?? primary.name ?? raw.campaignName ?? '').trim();
  if (id || name) return lane(normalizeLaneKey(id || name), name || id);
  if (lead.prospectStage === 'partner_prospect') return lane('partner_prospect', 'Partner prospect');
  if (lead.prospectStage === 'cold_prospect') return lane('cold_direct_buyer', 'Cold direct buyer');
  if (lead.prospectStage === 'warm_lead') return lane('warm_demand', 'Warm demand');
  return lane('unassigned_campaign', 'Unassigned campaign');
}

function aiDispositionFor(workbench: ReturnType<typeof readOutreachWorkbench>): AiRecommendationDisposition {
  if (!workbench) return 'pending';
  if (workbench.drafts.some((draft) => draft.status === 'rejected')) return 'rejected';
  const approved = workbench.drafts.find((draft) => draft.approval);
  if (!approved?.approval) return 'pending';
  const revision = approved.revisions.find((item) => item.id === approved.approval?.revisionId);
  if (!revision) return 'pending';
  return revision.source === 'human_edit' ? 'edited' : 'accepted';
}

function buildDataWarnings(records: StoredLeadRecord[], facts: RecordFacts[], summary: CommercialAnalyticsSummary): string[] {
  const warnings: string[] = [];
  if (records.length === 0) warnings.push('No prospect records are available for this scope.');
  if (summary.reviewedSampleSize < 10) warnings.push('Fewer than 10 records have complete BD feedback; material threshold changes should wait for a representative reviewed sample.');
  if (summary.counts.contacted < 5) warnings.push('Fewer than five manual contact attempts are recorded in the selected period.');
  if (facts.some((fact) => fact.record.lead.pipelineStatus === 'won' && !fact.values.some((entry) => entry.kind === 'won_revenue'))) warnings.push('At least one won record has no explicitly entered revenue value. Revenue totals remain incomplete.');
  if (facts.some((fact) => TERMINAL_STATUSES.has(fact.record.lead.pipelineStatus) && fact.record.lead.feedback?.status !== 'complete')) warnings.push('Some closed records still lack required commercial feedback.');
  return warnings;
}

function ratesFrom(counts: FunnelCounts): FunnelRates {
  return {
    enrichmentRate: ratio(counts.enriched, counts.captured),
    evidenceCompletenessRate: ratio(counts.evidenceComplete, counts.captured),
    duplicateRate: ratio(counts.duplicates, counts.captured),
    bdAcceptanceRate: ratio(counts.bdAccepted, counts.captured),
    contactRate: ratio(counts.contacted, counts.bdAccepted || counts.captured),
    replyRate: ratio(counts.replies, counts.contacted),
    meetingRate: ratio(counts.meetings, counts.contacted),
    proposalRate: ratio(counts.proposals, counts.contacted),
    winRate: ratio(counts.wins, counts.proposals || counts.contacted),
    followUpComplianceRate: ratio(counts.onTimeFollowUps, counts.dueFollowUps),
  };
}

function emptyCounts(): FunnelCounts {
  return {captured: 0, unique: 0, enriched: 0, evidenceComplete: 0, duplicates: 0, identityConflicts: 0, bdAccepted: 0, contacted: 0, replies: 0, meetings: 0, proposals: 0, wins: 0, losses: 0, rejected: 0, suppressed: 0, dueFollowUps: 0, onTimeFollowUps: 0};
}

function summarizeValues(entries: CommercialValueEntry[]): CurrencyTotals[] {
  const groups = new Map<string, CurrencyTotals>();
  for (const entry of entries) {
    const row = groups.get(entry.currency) ?? {currency: entry.currency, pipeline: 0, proposal: 0, wonRevenue: 0, entryCount: 0};
    if (entry.kind === 'pipeline') row.pipeline += entry.amount;
    if (entry.kind === 'proposal') row.proposal += entry.amount;
    if (entry.kind === 'won_revenue') row.wonRevenue += entry.amount;
    row.entryCount += 1;
    groups.set(entry.currency, row);
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

function resolvePeriod(input: BuildCommercialAnalyticsInput, generatedAt: string): CommercialPeriod {
  const to = validIso(input.to) ?? generatedAt;
  const days = boundedInteger(input.days, 30, 1, 366);
  const from = validIso(input.from) ?? new Date(Date.parse(to) - days * DAY_MS).toISOString();
  if (Date.parse(from) > Date.parse(to)) throw new Error('Commercial analytics period start must be before its end.');
  return {from, to, days: Math.max(1, Math.ceil((Date.parse(to) - Date.parse(from)) / DAY_MS))};
}

function statusEvent(entry: AuditEntry): Array<{status: PipelineStatus; at: string}> {
  if (entry.action !== 'status_changed') return [];
  const raw = typeof entry.metadata?.status === 'string' ? entry.metadata.status : entry.message.match(/\bto ([a-z_]+)\b/i)?.[1];
  return raw && isPipelineStatus(raw) ? [{status: raw, at: entry.createdAt}] : [];
}

function statusAt(events: Array<{status: PipelineStatus; at: string}>, status: PipelineStatus): string | undefined {
  return earliestIso(events.filter((item) => item.status === status).map((item) => item.at));
}

function earliestAudit(entries: AuditEntry[], action: AuditEntry['action']): string | undefined {
  return earliestIso(entries.filter((entry) => entry.action === action).map((entry) => entry.createdAt));
}

function isPipelineStatus(value: string): value is PipelineStatus {
  return ['new','scored','needs_research','hot_alert_sent','needs_human_review','approved_to_contact','draft_ready','sent_manually','replied','meeting_booked','proposal_sent','won','lost','rejected','archived'].includes(value);
}

function sourceKey(lead: Lead): string {
  const text = `${lead.discoverySource ?? ''} ${lead.source}`.toLowerCase();
  if (text.includes('upwork saved')) return 'upwork_saved_search';
  if (lead.source === 'upwork') return 'upwork';
  if (lead.source === 'sales_navigator') return 'sales_navigator';
  if (lead.source === 'linkedin') return lead.leadType === 'linkedin_warm_post' ? 'linkedin_warm' : 'linkedin';
  if (lead.source === 'public_procurement') return 'public_procurement';
  if (lead.source === 'partner_research') return 'partner_research';
  if (lead.source === 'solution_campaign') return 'solution_campaign';
  return normalizeLaneKey(lead.source || 'unknown');
}

function sourceLabel(key: string): string { return label(key); }
function channelFallback(lead: Lead): string {
  if (lead.source === 'upwork') return 'upwork';
  if (lead.source === 'sales_navigator') return 'sales_navigator';
  if (lead.contactEmail) return 'email';
  if (lead.linkedinUrl || lead.source === 'linkedin') return lead.leadType === 'linkedin_warm_post' ? 'linkedin_comment' : 'linkedin_dm';
  if (/referral|introduction/i.test(lead.reachMethod ?? '')) return 'partner';
  return 'unrecorded';
}

function inPeriod(value: string | undefined, period: CommercialPeriod): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= Date.parse(period.from) && time <= Date.parse(period.to);
}

function earliestIso(values: Array<string | undefined>): string | undefined {
  const valid = values.flatMap((value) => validIso(value) ? [validIso(value)!] : []).sort();
  return valid[0];
}

function pushHours(values: number[], from: number, to: number): void {
  if (Number.isFinite(from) && Number.isFinite(to) && to >= from) values.push((to - from) / (60 * 60 * 1000));
}

function average(values: number[]): number | undefined { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined; }
function ratio(numerator: number, denominator: number): number { return denominator > 0 ? numerator / denominator : 0; }
function lane(key: string, labelValue: string): {key: string; label: string} { return {key, label: labelValue}; }
function decisionKey(dimension: CommercialDimension, laneKey: string): string { return `${dimension}:${normalizeLaneKey(laneKey)}`; }
function normalizeLaneKey(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 160) || 'unknown'; }
function label(value: string): string { return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []; }
function uniqueStrings(values: Array<string | undefined>): string[] { return [...new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))]; }
function validIso(value: string | undefined): string | undefined { if (!value || !Number.isFinite(Date.parse(value))) return undefined; return new Date(value).toISOString(); }
function laterIso(left: string, right: string): string { return Date.parse(right) >= Date.parse(left) ? right : left; }
function finiteNonNegative(value: number, field: string): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number.`); return Math.round(value * 100) / 100; }
function normalizeCurrency(value: string): string { const currency = value.trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be a three-letter code.'); return currency; }
function requiredText(value: unknown, field: string, maximum: number): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`); const text = value.trim(); if (text.length > maximum) throw new Error(`${field} must contain at most ${maximum} characters.`); return text; }
function optionalText(value: unknown, maximum: number): string | undefined { if (value === undefined || value === null || value === '') return undefined; return requiredText(String(value), 'value', maximum); }
function positiveInteger(value: number, field: string): number { if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer.`); return value; }
function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number { return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, Number(value))) : fallback; }
function requireDimension(value: string): CommercialDimension { if (!['source','campaign','channel','service','owner'].includes(value)) throw new Error('dimension is invalid.'); return value as CommercialDimension; }
function requireDecision(value: string): CalibrationDecisionValue { if (!['keep','change','stop'].includes(value)) throw new Error('decision is invalid.'); return value as CalibrationDecisionValue; }
function requireValueKind(value: string): CommercialValueKind { if (!['pipeline','proposal','won_revenue'].includes(value)) throw new Error('kind is invalid.'); return value as CommercialValueKind; }
function isCommercialValueEntry(value: unknown): value is CommercialValueEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<CommercialValueEntry>;
  return typeof entry.id === 'string' && typeof entry.leadId === 'string' && ['pipeline','proposal','won_revenue'].includes(String(entry.kind)) && typeof entry.amount === 'number' && typeof entry.currency === 'string' && entry.source === 'manual_entry' && entry.explicitValue === true;
}
function shortHash(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 20); }
