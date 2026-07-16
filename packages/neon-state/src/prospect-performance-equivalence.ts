import type { StoredLeadRecord } from '@sales-automation/storage';
import type { ProspectPerformanceEvidence } from './prospect-performance-types.js';

export function compareDefaultProspectPage(
  optimized: {
    records: StoredLeadRecord[];
    visibleTotal: number;
    summary: {
      total: number; live: number; contacted: number; replied: number;
      followUpsDue: number; unassigned: number; won: number; feedbackPending: number;
    };
  },
  records: StoredLeadRecord[],
  now: string,
): ProspectPerformanceEvidence['equivalence'] {
  const complete = optimized.visibleTotal === records.length;
  const ordered = [...records].sort(defaultRecordSort);
  const orderMatches = optimized.records.every((record, index) => record.lead.id === ordered[index]?.lead.id)
    && optimized.records.length === Math.min(25, ordered.length);
  const summary = legacySummary(records, now);
  const stableCounts = optimized.summary.total === summary.total
    && optimized.summary.live === summary.live
    && optimized.summary.contacted === summary.contacted
    && optimized.summary.replied === summary.replied
    && optimized.summary.unassigned === summary.unassigned
    && optimized.summary.won === summary.won
    && optimized.summary.feedbackPending === summary.feedbackPending;
  return {
    checked: complete,
    visibleTotalMatches: complete,
    stableCountMatches: complete && stableCounts,
    followUpsDueMatches: complete && optimized.summary.followUpsDue === summary.followUpsDue,
    firstPageOrderMatches: complete && orderMatches,
    comparedRecordCount: records.length,
    pageSize: 25,
    reason: complete ? undefined : 'Scoped comparison reached the 10,000-record diagnostic limit before matching the database visible total.',
  };
}

function defaultRecordSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  const rankDifference = rankValue(left) - rankValue(right);
  return rankDifference || dateValue(right.lead.updatedAt ?? right.lead.createdAt) - dateValue(left.lead.updatedAt ?? left.lead.createdAt);
}
function rankValue(record: StoredLeadRecord): number {
  const rank = Number(record.lead.rank);
  return Number.isInteger(rank) && rank >= 0 ? rank : 999_999;
}
function legacySummary(records: StoredLeadRecord[], now: string) {
  const statuses = (values: string[]) => records.filter((record) => values.includes(record.lead.pipelineStatus)).length;
  const nowTime = Date.parse(now);
  return {
    total: records.length,
    live: records.filter((record) => record.lead.opportunityStatus === 'live_opportunity').length,
    contacted: statuses(['sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']),
    replied: statuses(['replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']),
    followUpsDue: records.filter((record) => record.lead.nextFollowUpAt
      && Date.parse(record.lead.nextFollowUpAt) <= nowTime
      && !['won', 'lost', 'rejected', 'archived'].includes(record.lead.pipelineStatus)).length,
    unassigned: records.filter((record) => !record.lead.owner).length,
    won: statuses(['won']),
    feedbackPending: records.filter((record) => record.lead.feedback?.status !== 'complete').length,
  };
}
function dateValue(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
