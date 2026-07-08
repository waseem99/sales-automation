import type {
  CodistanProfile,
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
    humanApproved: records.filter((record) => hasReached(record.lead.pipelineStatus, 'approved_to_contact')).length,
    outreachSent: records.filter((record) => hasReached(record.lead.pipelineStatus, 'sent_manually')).length,
    replies: records.filter((record) => hasReached(record.lead.pipelineStatus, 'replied')).length,
    meetings: records.filter((record) => hasReached(record.lead.pipelineStatus, 'meeting_booked')).length,
    proposals: records.filter((record) => hasReached(record.lead.pipelineStatus, 'proposal_sent')).length,
    won: records.filter((record) => record.lead.pipelineStatus === 'won').length,
    lost: records.filter((record) => record.lead.pipelineStatus === 'lost').length,
    rejected: records.filter((record) => record.lead.pipelineStatus === 'rejected').length,
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
  const wonRecords = scoredRecords.filter((record) => record.lead.pipelineStatus === 'won');
  const lostRecords = scoredRecords.filter((record) => record.lead.pipelineStatus === 'lost');
  const rejectedRecords = scoredRecords.filter((record) => record.lead.pipelineStatus === 'rejected');

  return {
    averageScore: averageScore(scoredRecords),
    averageWonScore: averageScore(wonRecords),
    averageLostScore: averageScore(lostRecords),
    averageRejectedScore: averageScore(rejectedRecords),
    falsePositiveLeadIds: scoredRecords
      .filter((record) => (record.latestEvaluation?.score.total ?? 0) >= 80)
      .filter((record) => record.lead.pipelineStatus === 'lost' || record.lead.pipelineStatus === 'rejected')
      .map((record) => record.lead.id),
    falseNegativeLeadIds: scoredRecords
      .filter((record) => (record.latestEvaluation?.score.total ?? 0) < 65)
      .filter((record) => record.lead.pipelineStatus === 'won')
      .map((record) => record.lead.id),
    scoreBands: buildScoreBands(scoredRecords),
  };
}

export function recordOutcomeReason(
  record: StoredLeadRecord,
  type: 'win' | 'loss' | 'rejection',
  reason: string,
  actor = 'analytics',
): StoredLeadRecord {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error('Outcome reason is required.');
  }

  record.auditLog.push({
    id: `${record.lead.id}-${record.auditLog.length + 1}`,
    leadId: record.lead.id,
    action: 'note_added',
    actor,
    message: `${type} reason recorded: ${normalizedReason}`,
    createdAt: new Date().toISOString(),
    metadata: {
      outcomeReasonType: type,
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

function collectReasonCounts(records: StoredLeadRecord[], type: 'win' | 'loss' | 'rejection'): Record<string, number> {
  return records.reduce<Record<string, number>>((accumulator, record) => {
    for (const entry of record.auditLog) {
      if (entry.metadata?.outcomeReasonType !== type) continue;
      const reason = typeof entry.metadata.reason === 'string' ? entry.metadata.reason : undefined;
      if (!reason) continue;
      accumulator[reason] = (accumulator[reason] ?? 0) + 1;
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
    const won = bandRecords.filter((record) => record.lead.pipelineStatus === 'won').length;
    const lost = bandRecords.filter((record) => record.lead.pipelineStatus === 'lost').length;
    const rejected = bandRecords.filter((record) => record.lead.pipelineStatus === 'rejected').length;
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

function hasReached(currentStatus: PipelineStatus, targetStatus: PipelineStatus): boolean {
  return pipelineOrder.indexOf(currentStatus) >= pipelineOrder.indexOf(targetStatus);
}

const pipelineOrder: PipelineStatus[] = [
  'new',
  'scored',
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
];

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
