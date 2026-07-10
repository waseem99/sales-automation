import type {
  CodistanProfile,
  LeadOutcomeStatus,
  LeadSource,
  PipelineStatus,
  ServiceCategory,
} from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

export interface AnalyticsDateRange {
  from?: string;
  to?: string;
}

export interface AnalyticsFilters extends AnalyticsDateRange {
  sources?: LeadSource[];
  serviceCategories?: ServiceCategory[];
  recommendedProfiles?: CodistanProfile[];
  owners?: string[];
}

export interface FunnelMetrics {
  captured: number;
  scored: number;
  hot: number;
  qualified: number;
  humanApproved: number;
  outreachSent: number;
  replies: number;
  meetings: number;
  proposals: number;
  won: number;
  lost: number;
  rejected: number;
  archived: number;
}

export interface OutcomeMetrics {
  winRate: number;
  replyRate: number;
  meetingRate: number;
  proposalRate: number;
  lossRate: number;
  rejectionRate: number;
}

export interface ScoreBandMetrics {
  band: string;
  count: number;
  won: number;
  lost: number;
  rejected: number;
  winRate: number;
}

export interface CalibrationReport {
  averageScore: number;
  averageWonScore: number;
  averageLostScore: number;
  averageRejectedScore: number;
  falsePositiveLeadIds: string[];
  falseNegativeLeadIds: string[];
  scoreBands: ScoreBandMetrics[];
}

export interface AnalyticsReport {
  generatedAt: string;
  totalLeads: number;
  funnel: FunnelMetrics;
  outcomes: OutcomeMetrics;
  bySource: Partial<Record<LeadSource, FunnelMetrics>>;
  byServiceCategory: Partial<Record<ServiceCategory, FunnelMetrics>>;
  byRecommendedProfile: Partial<Record<CodistanProfile, FunnelMetrics>>;
  byOwner: Record<string, FunnelMetrics>;
  winReasons: Record<string, number>;
  lossReasons: Record<string, number>;
  rejectionReasons: Record<string, number>;
  calibration: CalibrationReport;
}

type OutcomeReasonType = 'win' | 'loss' | 'rejection';
type TrackedFunnelStage = 'approved_to_contact' | 'sent_manually' | 'replied' | 'meeting_booked' | 'proposal_sent';

const knownPipelineStatuses = new Set<PipelineStatus>([
  'new',
  'scored',
  'needs_research',
  'hot_alert_sent',
  'needs_human_review',
  'approved_to_contact',
  'draft_ready',
  'sent_manually',
  'replied',
  'meeting_booked',
  'proposal_sent',
  'won',
  'lost',
  'rejected',
  'archived',
]);

export function buildAnalyticsReport(
  records: StoredLeadRecord[],
  options: AnalyticsFilters = {},
  generatedAt = new Date().toISOString(),
): AnalyticsReport {
  const filtered = records.filter((record) => matchesAnalyticsFilters(record, options));
  const funnel = buildFunnelMetrics(filtered);

  return {
    generatedAt,
    totalLeads: filtered.length,
    funnel,
    outcomes: buildOutcomeMetrics(funnel),
    bySource: groupFunnelMetrics(filtered, (record) => record.lead.source) as Partial<Record<LeadSource, FunnelMetrics>>,
    byServiceCategory: groupFunnelMetrics(filtered, (record) => record.lead.serviceCategory) as Partial<Record<ServiceCategory, FunnelMetrics>>,
    byRecommendedProfile: groupFunnelMetrics(filtered, (record) => getRecommendedProfile(record)) as Partial<Record<CodistanProfile, FunnelMetrics>>,
    byOwner: groupFunnelMetrics(filtered, (record) => record.lead.owner ?? 'unassigned'),
    winReasons: collectReasonCounts(filtered, 'win'),
    lossReasons: collectReasonCounts(filtered, 'loss'),
    rejectionReasons: collectReasonCounts(filtered, 'rejection'),
    calibration: buildCalibrationReport(filtered),
  };
}

export function buildFunnelMetrics(records: StoredLeadRecord[]): FunnelMetrics {
  return {
    captured: records.length,
    scored: records.filter((record) => Boolean(record.latestEvaluation)).length,
    hot: records.filter((record) => record.latestEvaluation?.score.status === 'hot').length,
    qualified: records.filter((record) => record.latestEvaluation?.score.status === 'qualified').length,
    humanApproved: records.filter((record) => hasReachedStage(record, 'approved_to_contact')).length,
    outreachSent: records.filter((record) => hasReachedStage(record, 'sent_manually')).length,
    replies: records.filter((record) => hasReachedStage(record, 'replied')).length,
    meetings: records.filter((record) => hasReachedStage(record, 'meeting_booked')).length,
    proposals: records.filter((record) => hasReachedStage(record, 'proposal_sent')).length,
    won: records.filter(isWonRecord).length,
    lost: records.filter(isLostRecord).length,
    rejected: records.filter(isRejectedRecord).length,
    archived: records.filter((record) => record.lead.pipelineStatus === 'archived').length,
  };
}

export function buildOutcomeMetrics(funnel: FunnelMetrics): OutcomeMetrics {
  return {
    winRate: ratio(funnel.won, funnel.proposals || funnel.captured),
    replyRate: ratio(funnel.replies, funnel.outreachSent),
    meetingRate: ratio(funnel.meetings, funnel.replies || funnel.outreachSent),
    proposalRate: ratio(funnel.proposals, funnel.meetings || funnel.replies || funnel.outreachSent),
    lossRate: ratio(funnel.lost, funnel.proposals || funnel.captured),
    rejectionRate: ratio(funnel.rejected, funnel.captured),
  };
}

export function buildCalibrationReport(records: StoredLeadRecord[]): CalibrationReport {
  const scoredRecords = records.filter((record) => typeof record.latestEvaluation?.score.total === 'number');
  const wonRecords = scoredRecords.filter(isWonRecord);
  const lostRecords = scoredRecords.filter(isLostRecord);
  const rejectedRecords = scoredRecords.filter(isRejectedRecord);

  return {
    averageScore: averageScore(scoredRecords),
    averageWonScore: averageScore(wonRecords),
    averageLostScore: averageScore(lostRecords),
    averageRejectedScore: averageScore(rejectedRecords),
    falsePositiveLeadIds: scoredRecords
      .filter((record) => (record.latestEvaluation?.score.total ?? 0) >= 80)
      .filter((record) => isLostRecord(record) || isRejectedRecord(record))
      .map((record) => record.lead.id),
    falseNegativeLeadIds: scoredRecords
      .filter((record) => (record.latestEvaluation?.score.total ?? 0) < 65)
      .filter(isWonRecord)
      .map((record) => record.lead.id),
    scoreBands: buildScoreBands(scoredRecords),
  };
}

/**
 * Backward-compatible helper for older callers. New code should prefer
 * LeadRepository.recordOutcome so persistence hooks are executed.
 */
export function recordOutcomeReason(
  record: StoredLeadRecord,
  type: OutcomeReasonType,
  reason: string,
  actor = 'analytics',
): StoredLeadRecord {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error('Outcome reason is required.');
  }

  const outcomeStatus = legacyOutcomeStatus(type);
  const recordedAt = new Date().toISOString();
  record.lead = {
    ...record.lead,
    outcomeStatus,
    outcomeReason: normalizedReason,
    outcomeRecordedAt: recordedAt,
    updatedAt: recordedAt,
  };
  record.auditLog.push({
    id: `${record.lead.id}-${record.auditLog.length + 1}`,
    leadId: record.lead.id,
    action: 'outcome_recorded',
    actor,
    message: `${type} reason recorded: ${normalizedReason}`,
    createdAt: recordedAt,
    metadata: {
      outcomeReasonType: type,
      outcomeStatus,
      reason: normalizedReason,
    },
  });
  return record;
}

function matchesAnalyticsFilters(record: StoredLeadRecord, filters: AnalyticsFilters): boolean {
  if (filters.from && record.lead.capturedAt < filters.from) return false;
  if (filters.to && record.lead.capturedAt > filters.to) return false;
  if (filters.sources && !filters.sources.includes(record.lead.source)) return false;
  if (filters.serviceCategories && !filters.serviceCategories.includes(record.lead.serviceCategory)) return false;
  if (filters.owners && (!record.lead.owner || !filters.owners.includes(record.lead.owner))) return false;
  if (filters.recommendedProfiles) {
    const profile = getRecommendedProfile(record);
    if (!profile || !filters.recommendedProfiles.includes(profile)) return false;
  }
  return true;
}

function groupFunnelMetrics(
  records: StoredLeadRecord[],
  getKey: (record: StoredLeadRecord) => string | undefined,
): Record<string, FunnelMetrics> {
  const groups = new Map<string, StoredLeadRecord[]>();
  for (const record of records) {
    const key = getKey(record);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  const result: Record<string, FunnelMetrics> = {};
  for (const [key, groupRecords] of groups.entries()) {
    result[key] = buildFunnelMetrics(groupRecords);
  }
  return result;
}

function collectReasonCounts(records: StoredLeadRecord[], type: OutcomeReasonType): Record<string, number> {
  return records.reduce<Record<string, number>>((accumulator, record) => {
    const structuredType = getOutcomeReasonType(record.lead.outcomeStatus);
    const structuredReason = record.lead.outcomeReason?.trim();

    if (structuredType) {
      if (structuredType === type && structuredReason) {
        incrementReason(accumulator, structuredReason);
      }
      return accumulator;
    }

    for (const entry of record.auditLog) {
      if (entry.metadata?.outcomeReasonType !== type) continue;
      const reason = typeof entry.metadata.reason === 'string' ? entry.metadata.reason.trim() : '';
      if (reason) incrementReason(accumulator, reason);
    }
    return accumulator;
  }, {});
}

function buildScoreBands(records: StoredLeadRecord[]): ScoreBandMetrics[] {
  const bands = [
    { label: '0-49', min: 0, max: 49 },
    { label: '50-64', min: 50, max: 64 },
    { label: '65-79', min: 65, max: 79 },
    { label: '80-100', min: 80, max: 100 },
  ];

  return bands.map((band) => {
    const bandRecords = records.filter((record) => {
      const score = record.latestEvaluation?.score.total ?? -1;
      return score >= band.min && score <= band.max;
    });
    const won = bandRecords.filter(isWonRecord).length;
    const lost = bandRecords.filter(isLostRecord).length;
    const rejected = bandRecords.filter(isRejectedRecord).length;
    return {
      band: band.label,
      count: bandRecords.length,
      won,
      lost,
      rejected,
      winRate: ratio(won, bandRecords.length),
    };
  });
}

function hasReachedStage(record: StoredLeadRecord, target: TrackedFunnelStage): boolean {
  const history = getPipelineStatusHistory(record);
  if (history.has(target)) return true;

  const current = record.lead.pipelineStatus;
  if (target === 'approved_to_contact') {
    return ['draft_ready', 'sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost'].includes(current);
  }
  if (target === 'sent_manually') {
    return ['replied', 'meeting_booked', 'proposal_sent', 'won', 'lost'].includes(current);
  }
  if (target === 'replied') {
    return current === 'meeting_booked';
  }
  return false;
}

function getPipelineStatusHistory(record: StoredLeadRecord): Set<PipelineStatus> {
  const statuses = new Set<PipelineStatus>([record.lead.pipelineStatus]);
  for (const entry of record.auditLog) {
    if (entry.action !== 'status_changed') continue;
    const status = entry.metadata?.status;
    if (isPipelineStatus(status)) statuses.add(status);
  }
  return statuses;
}

function isPipelineStatus(value: unknown): value is PipelineStatus {
  return typeof value === 'string' && knownPipelineStatuses.has(value as PipelineStatus);
}

function isWonRecord(record: StoredLeadRecord): boolean {
  return record.lead.outcomeStatus === 'won' || record.lead.pipelineStatus === 'won';
}

function isLostRecord(record: StoredLeadRecord): boolean {
  return record.lead.outcomeStatus === 'lost'
    || record.lead.outcomeStatus === 'no_response'
    || record.lead.pipelineStatus === 'lost';
}

function isRejectedRecord(record: StoredLeadRecord): boolean {
  return record.lead.outcomeStatus === 'rejected'
    || record.lead.outcomeStatus === 'not_fit'
    || record.lead.outcomeStatus === 'duplicate'
    || record.lead.pipelineStatus === 'rejected';
}

function getOutcomeReasonType(status?: LeadOutcomeStatus): OutcomeReasonType | undefined {
  if (status === 'won') return 'win';
  if (status === 'lost' || status === 'no_response') return 'loss';
  if (status === 'rejected' || status === 'not_fit' || status === 'duplicate') return 'rejection';
  return undefined;
}

function legacyOutcomeStatus(type: OutcomeReasonType): LeadOutcomeStatus {
  if (type === 'win') return 'won';
  if (type === 'loss') return 'lost';
  return 'rejected';
}

function incrementReason(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function getRecommendedProfile(record: StoredLeadRecord): CodistanProfile | undefined {
  return record.latestEvaluation?.profileRecommendation.primaryProfile ?? record.lead.recommendedProfile;
}

function averageScore(records: StoredLeadRecord[]): number {
  if (records.length === 0) return 0;
  return round(records.reduce((total, record) => total + (record.latestEvaluation?.score.total ?? 0), 0) / records.length);
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round(numerator / denominator);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
