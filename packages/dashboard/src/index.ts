import type {
  CodistanProfile,
  LeadSource,
  LeadType,
  PipelineStatus,
  QualificationStatus,
  ScoreBreakdown,
  ServiceCategory,
  UrgencyStatus,
} from '@sales-automation/shared';
import type { AuditEntry, StoredLeadRecord } from '@sales-automation/storage';

export type DashboardSavedViewKey =
  | 'hot_upwork_now'
  | 'hot_linkedin_warm_posts'
  | 'ai_automation_leads'
  | 'ar_3d_leads'
  | 'partner_prospects'
  | 'solution_led_prospects'
  | 'needs_human_review'
  | 'overdue_hot_leads';

export type DashboardSortKey =
  | 'priority'
  | 'capturedAt'
  | 'updatedAt'
  | 'score'
  | 'freshnessMinutes'
  | 'source'
  | 'status';

export interface DashboardFilters {
  sources?: LeadSource[];
  leadTypes?: LeadType[];
  serviceCategories?: ServiceCategory[];
  pipelineStatuses?: PipelineStatus[];
  qualificationStatuses?: QualificationStatus[];
  urgencyStatuses?: UrgencyStatus[];
  recommendedProfiles?: CodistanProfile[];
  owners?: string[];
  scoreMin?: number;
  scoreMax?: number;
  capturedFrom?: string;
  capturedTo?: string;
  query?: string;
  hasRedFlags?: boolean;
  alertEligible?: boolean;
  overdueOnly?: boolean;
}

export interface DashboardListOptions {
  filters?: DashboardFilters;
  savedView?: DashboardSavedViewKey;
  sortBy?: DashboardSortKey;
  sortDirection?: 'asc' | 'desc';
  now?: string;
}

export interface OpportunityListItem {
  id: string;
  title: string;
  source: LeadSource;
  leadType: LeadType;
  serviceCategory: ServiceCategory;
  companyName?: string;
  contactName?: string;
  country?: string;
  score?: number;
  qualificationStatus?: QualificationStatus;
  urgency?: UrgencyStatus;
  pipelineStatus: PipelineStatus;
  recommendedProfile?: CodistanProfile;
  matchedPortfolioCount: number;
  draftCount: number;
  redFlagCount: number;
  alertEligible: boolean;
  overdue: boolean;
  owner?: string;
  freshnessMinutes?: number;
  capturedAt: string;
  updatedAt: string;
  sourceUrl?: string;
  recommendedNextAction?: string;
}

export interface LeadDetailView extends OpportunityListItem {
  description: string;
  budgetSignal?: string;
  timelineSignal?: string;
  rawPayload?: unknown;
  scoreBreakdown?: ScoreBreakdown;
  redFlags: string[];
  profileReasons: string[];
  profileRisks: string[];
  portfolioMatches: Array<{
    id: string;
    projectName: string;
    score: number;
    matchedTags: string[];
    reasons: string[];
  }>;
  drafts: Array<{
    id: string;
    type: string;
    status: string;
    subject?: string;
    body: string;
    requiresHumanApproval: boolean;
  }>;
  notes: string[];
  auditLog: AuditEntry[];
  allowedStatusActions: PipelineStatus[];
}

export interface DashboardSummary {
  total: number;
  hot: number;
  qualified: number;
  nurture: number;
  rejected: number;
  urgent: number;
  alertEligible: number;
  overdue: number;
  needsHumanReview: number;
  bySource: Partial<Record<LeadSource, number>>;
  byServiceCategory: Partial<Record<ServiceCategory, number>>;
  byRecommendedProfile: Partial<Record<CodistanProfile, number>>;
}

export const savedViewLabels: Record<DashboardSavedViewKey, string> = {
  hot_upwork_now: 'Hot Upwork Now',
  hot_linkedin_warm_posts: 'Hot LinkedIn Warm Posts',
  ai_automation_leads: 'AI Automation Leads',
  ar_3d_leads: 'AR/3D Leads',
  partner_prospects: 'Partner Prospects',
  solution_led_prospects: 'Solution-Led Prospects',
  needs_human_review: 'Needs Human Review',
  overdue_hot_leads: 'Overdue Hot Leads',
};

export function buildOpportunityList(
  records: StoredLeadRecord[],
  options: DashboardListOptions = {},
): OpportunityListItem[] {
  const now = options.now ?? new Date().toISOString();
  const filters = mergeSavedViewFilters(options.savedView, options.filters);

  return records
    .map((record) => toOpportunityListItem(record, now))
    .filter((item) => matchesFilters(item, recordById(records, item.id), filters))
    .sort((a, b) => compareListItems(a, b, options.sortBy ?? 'priority', options.sortDirection ?? 'desc'));
}

export function buildLeadDetail(record: StoredLeadRecord, now = new Date().toISOString()): LeadDetailView {
  const item = toOpportunityListItem(record, now);
  const evaluation = record.latestEvaluation;

  return {
    ...item,
    description: record.lead.description,
    budgetSignal: record.lead.budgetSignal,
    timelineSignal: record.lead.timelineSignal,
    rawPayload: record.lead.rawPayload,
    scoreBreakdown: evaluation?.score.breakdown,
    redFlags: evaluation?.score.redFlags.map((flag) => `${flag.severity}: ${flag.reason}`) ?? [],
    profileReasons: evaluation?.profileRecommendation.reasons ?? [],
    profileRisks: evaluation?.profileRecommendation.risks ?? [],
    portfolioMatches: evaluation?.portfolioMatches.map((match) => ({
      id: match.portfolioItem.id,
      projectName: match.portfolioItem.projectName,
      score: match.score,
      matchedTags: match.matchedTags,
      reasons: match.reasons,
    })) ?? [],
    drafts: evaluation?.drafts.map((draft) => ({
      id: draft.id,
      type: draft.type,
      status: draft.status,
      subject: draft.subject,
      body: draft.body,
      requiresHumanApproval: draft.metadata.requiresHumanApproval,
    })) ?? [],
    notes: record.notes,
    auditLog: record.auditLog,
    allowedStatusActions: getAllowedStatusActions(record.lead.pipelineStatus),
  };
}

export function buildDashboardSummary(records: StoredLeadRecord[], now = new Date().toISOString()): DashboardSummary {
  const items = records.map((record) => toOpportunityListItem(record, now));

  return {
    total: items.length,
    hot: items.filter((item) => item.qualificationStatus === 'hot').length,
    qualified: items.filter((item) => item.qualificationStatus === 'qualified').length,
    nurture: items.filter((item) => item.qualificationStatus === 'nurture').length,
    rejected: items.filter((item) => item.qualificationStatus === 'rejected').length,
    urgent: items.filter((item) => item.urgency === 'urgent').length,
    alertEligible: items.filter((item) => item.alertEligible).length,
    overdue: items.filter((item) => item.overdue).length,
    needsHumanReview: items.filter((item) => item.pipelineStatus === 'needs_human_review' || item.recommendedProfile === 'needs_human_review').length,
    bySource: countBy(items, (item) => item.source),
    byServiceCategory: countBy(items, (item) => item.serviceCategory),
    byRecommendedProfile: countBy(items, (item) => item.recommendedProfile),
  };
}

export function getAllowedStatusActions(currentStatus: PipelineStatus): PipelineStatus[] {
  switch (currentStatus) {
    case 'new':
    case 'scored':
      return ['needs_human_review', 'approved_to_contact', 'rejected', 'archived'];
    case 'needs_human_review':
      return ['approved_to_contact', 'rejected', 'archived'];
    case 'approved_to_contact':
    case 'draft_ready':
      return ['sent_manually', 'rejected', 'archived'];
    case 'hot_alert_sent':
      return ['needs_human_review', 'approved_to_contact', 'rejected', 'archived'];
    case 'sent_manually':
      return ['replied', 'meeting_booked', 'proposal_sent', 'lost', 'archived'];
    case 'replied':
      return ['meeting_booked', 'proposal_sent', 'lost', 'archived'];
    case 'meeting_booked':
      return ['proposal_sent', 'won', 'lost', 'archived'];
    case 'proposal_sent':
      return ['won', 'lost', 'archived'];
    case 'won':
    case 'lost':
    case 'rejected':
      return ['archived'];
    case 'archived':
      return [];
  }
}

export function isOverdue(record: StoredLeadRecord, now = new Date().toISOString()): boolean {
  const evaluation = record.latestEvaluation;
  if (!evaluation || evaluation.score.status !== 'hot') return false;
  if (['sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost', 'rejected', 'archived'].includes(record.lead.pipelineStatus)) {
    return false;
  }

  const capturedAtMs = Date.parse(record.lead.capturedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(capturedAtMs) || Number.isNaN(nowMs)) return false;

  const slaMinutes = getSlaMinutes(record);
  return nowMs - capturedAtMs > slaMinutes * 60_000;
}

function toOpportunityListItem(record: StoredLeadRecord, now: string): OpportunityListItem {
  const evaluation = record.latestEvaluation;
  return {
    id: record.lead.id,
    title: record.lead.title,
    source: record.lead.source,
    leadType: record.lead.leadType,
    serviceCategory: record.lead.serviceCategory,
    companyName: record.lead.companyName,
    contactName: record.lead.contactName,
    country: record.lead.country,
    score: evaluation?.score.total,
    qualificationStatus: evaluation?.score.status,
    urgency: evaluation?.score.urgency,
    pipelineStatus: record.lead.pipelineStatus,
    recommendedProfile: evaluation?.profileRecommendation.primaryProfile ?? record.lead.recommendedProfile,
    matchedPortfolioCount: evaluation?.portfolioMatches.length ?? 0,
    draftCount: evaluation?.drafts.length ?? 0,
    redFlagCount: evaluation?.score.redFlags.length ?? 0,
    alertEligible: evaluation?.alertPlan.shouldAlert ?? false,
    overdue: isOverdue(record, now),
    owner: record.lead.owner,
    freshnessMinutes: record.lead.freshnessMinutes,
    capturedAt: record.lead.capturedAt,
    updatedAt: record.lead.updatedAt,
    sourceUrl: record.lead.sourceUrl,
    recommendedNextAction: evaluation?.recommendedNextAction ?? record.lead.recommendedNextAction,
  };
}

function mergeSavedViewFilters(savedView?: DashboardSavedViewKey, filters: DashboardFilters = {}): DashboardFilters {
  if (!savedView) return filters;

  const savedViewFilters: Record<DashboardSavedViewKey, DashboardFilters> = {
    hot_upwork_now: {
      sources: ['upwork'],
      qualificationStatuses: ['hot'],
      alertEligible: true,
    },
    hot_linkedin_warm_posts: {
      sources: ['linkedin', 'sales_navigator'],
      leadTypes: ['linkedin_warm_post', 'linkedin_sales_nav_alert'],
      qualificationStatuses: ['hot'],
    },
    ai_automation_leads: {
      serviceCategories: ['ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'voice_ai_agent'],
    },
    ar_3d_leads: {
      serviceCategories: ['ar_3d_unity_unreal'],
    },
    partner_prospects: {
      leadTypes: ['partner_prospect'],
    },
    solution_led_prospects: {
      leadTypes: ['solution_led_prospect'],
    },
    needs_human_review: {
      pipelineStatuses: ['needs_human_review'],
    },
    overdue_hot_leads: {
      qualificationStatuses: ['hot'],
      overdueOnly: true,
    },
  };

  return {
    ...savedViewFilters[savedView],
    ...filters,
  };
}

function matchesFilters(item: OpportunityListItem, record: StoredLeadRecord, filters: DashboardFilters): boolean {
  if (filters.sources && !filters.sources.includes(item.source)) return false;
  if (filters.leadTypes && !filters.leadTypes.includes(item.leadType)) return false;
  if (filters.serviceCategories && !filters.serviceCategories.includes(item.serviceCategory)) return false;
  if (filters.pipelineStatuses && !filters.pipelineStatuses.includes(item.pipelineStatus)) return false;
  if (filters.qualificationStatuses && (!item.qualificationStatus || !filters.qualificationStatuses.includes(item.qualificationStatus))) return false;
  if (filters.urgencyStatuses && (!item.urgency || !filters.urgencyStatuses.includes(item.urgency))) return false;
  if (filters.recommendedProfiles && (!item.recommendedProfile || !filters.recommendedProfiles.includes(item.recommendedProfile))) return false;
  if (filters.owners && (!item.owner || !filters.owners.includes(item.owner))) return false;
  if (typeof filters.scoreMin === 'number' && (typeof item.score !== 'number' || item.score < filters.scoreMin)) return false;
  if (typeof filters.scoreMax === 'number' && (typeof item.score !== 'number' || item.score > filters.scoreMax)) return false;
  if (filters.capturedFrom && item.capturedAt < filters.capturedFrom) return false;
  if (filters.capturedTo && item.capturedAt > filters.capturedTo) return false;
  if (typeof filters.hasRedFlags === 'boolean' && (item.redFlagCount > 0) !== filters.hasRedFlags) return false;
  if (typeof filters.alertEligible === 'boolean' && item.alertEligible !== filters.alertEligible) return false;
  if (filters.overdueOnly && !item.overdue) return false;
  if (filters.query && !matchesQuery(record, filters.query)) return false;
  return true;
}

function matchesQuery(record: StoredLeadRecord, query: string): boolean {
  const value = query.toLowerCase().trim();
  if (!value) return true;
  const haystack = [
    record.lead.title,
    record.lead.description,
    record.lead.companyName,
    record.lead.contactName,
    record.lead.contactRole,
    record.lead.country,
    record.lead.budgetSignal,
    record.latestEvaluation?.recommendedNextAction,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(value);
}

function compareListItems(
  a: OpportunityListItem,
  b: OpportunityListItem,
  sortBy: DashboardSortKey,
  direction: 'asc' | 'desc',
): number {
  const modifier = direction === 'asc' ? 1 : -1;
  const diff = getSortValue(a, sortBy) - getSortValue(b, sortBy);
  if (diff !== 0) return diff * modifier;
  return Date.parse(b.capturedAt) - Date.parse(a.capturedAt);
}

function getSortValue(item: OpportunityListItem, sortBy: DashboardSortKey): number {
  switch (sortBy) {
    case 'priority':
      return getPriorityScore(item);
    case 'score':
      return item.score ?? -1;
    case 'freshnessMinutes':
      return item.freshnessMinutes ?? Number.MAX_SAFE_INTEGER;
    case 'capturedAt':
      return Date.parse(item.capturedAt) || 0;
    case 'updatedAt':
      return Date.parse(item.updatedAt) || 0;
    case 'source':
      return item.source.charCodeAt(0);
    case 'status':
      return item.pipelineStatus.charCodeAt(0);
  }
}

function getPriorityScore(item: OpportunityListItem): number {
  let score = item.score ?? 0;
  if (item.qualificationStatus === 'hot') score += 50;
  if (item.urgency === 'urgent') score += 40;
  if (item.alertEligible) score += 30;
  if (item.overdue) score += 20;
  if (item.pipelineStatus === 'needs_human_review') score += 10;
  return score;
}

function getSlaMinutes(record: StoredLeadRecord): number {
  if (record.lead.source === 'upwork') return 30;
  if (record.lead.source === 'linkedin' || record.lead.source === 'sales_navigator') return 60;
  if (record.lead.leadType === 'partner_prospect') return 3 * 24 * 60;
  return 24 * 60;
}

function countBy<T extends string>(
  items: OpportunityListItem[],
  getKey: (item: OpportunityListItem) => T | undefined,
): Partial<Record<T, number>> {
  return items.reduce<Partial<Record<T, number>>>((accumulator, item) => {
    const key = getKey(item);
    if (!key) return accumulator;
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function recordById(records: StoredLeadRecord[], leadId: string): StoredLeadRecord {
  const record = records.find((item) => item.lead.id === leadId);
  if (!record) {
    throw new Error(`Dashboard record not found: ${leadId}`);
  }
  return record;
}
