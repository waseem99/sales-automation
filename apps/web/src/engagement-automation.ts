import {
  analyzeInboundReply,
  formatFirstOutreachGuidance,
  formatReplyGuidance,
  generateFirstOutreachGuidance,
  type FirstOutreachGuidance,
  type ReplyGuidance,
} from '@sales-automation/engagement-guidance';
import type { Lead, PortfolioItem } from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';

const FIRST_OUTREACH_PREFIX = 'guidance::first_outreach::';
const REPLY_GUIDANCE_PREFIX = 'guidance::reply::';
const CLOSED_STATUSES = new Set(['won', 'lost', 'rejected', 'archived']);

export interface AutomaticAuditResult {
  audited: number;
  skipped: number;
  priority: number;
  qualified: number;
  humanReview: number;
  nurture: number;
  rejected: number;
  leadIds: string[];
}

export interface AppliedFirstOutreachGuidance {
  guidance: FirstOutreachGuidance;
  record: StoredLeadRecord;
}

export interface AppliedReplyGuidance {
  guidance: ReplyGuidance;
  record: StoredLeadRecord;
}

export function hasFirstOutreachGuidance(record: StoredLeadRecord): boolean {
  return record.notes.some((note) => note.startsWith(FIRST_OUTREACH_PREFIX));
}

export function applyFirstOutreachGuidance(input: {
  repository: LeadRepository;
  record: StoredLeadRecord;
  portfolioItems: PortfolioItem[];
  actor: string;
  generatedAt: string;
}): AppliedFirstOutreachGuidance {
  const guidance = generateFirstOutreachGuidance(input.record.lead, input.portfolioItems, {
    generatedAt: input.generatedAt,
  });
  const updatedLead: Lead = {
    ...input.record.lead,
    draftMessage: guidance.draft,
    recommendedNextAction: guidance.nextAction,
    pipelineStatus: guidance.requiresHumanReview ? 'needs_human_review' : 'draft_ready',
    updatedAt: input.generatedAt,
  };
  input.repository.upsertLead(updatedLead, input.actor);
  const record = input.repository.addNote(
    input.record.lead.id,
    `${FIRST_OUTREACH_PREFIX}${formatFirstOutreachGuidance(guidance)}`,
    input.actor,
  );
  return { guidance, record };
}

export function auditMissingFirstOutreachGuidance(input: {
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  actor: string;
  generatedAt: string;
  force?: boolean;
  leadIds?: string[];
}): AutomaticAuditResult {
  const selectedIds = input.leadIds?.length ? new Set(input.leadIds) : undefined;
  const result: AutomaticAuditResult = {
    audited: 0,
    skipped: 0,
    priority: 0,
    qualified: 0,
    humanReview: 0,
    nurture: 0,
    rejected: 0,
    leadIds: [],
  };

  for (const record of input.repository.listLeads()) {
    if (selectedIds && !selectedIds.has(record.lead.id)) continue;
    if (CLOSED_STATUSES.has(record.lead.pipelineStatus)) {
      result.skipped += 1;
      continue;
    }
    if (!input.force && hasFirstOutreachGuidance(record)) {
      result.skipped += 1;
      continue;
    }
    const applied = applyFirstOutreachGuidance({
      repository: input.repository,
      record,
      portfolioItems: input.portfolioItems,
      actor: input.actor,
      generatedAt: input.generatedAt,
    });
    result.audited += 1;
    result.leadIds.push(record.lead.id);
    if (applied.guidance.decision === 'priority') result.priority += 1;
    if (applied.guidance.decision === 'qualified') result.qualified += 1;
    if (applied.guidance.decision === 'human_review') result.humanReview += 1;
    if (applied.guidance.decision === 'nurture') result.nurture += 1;
    if (applied.guidance.decision === 'reject') result.rejected += 1;
  }

  return result;
}

export function applyReplyGuidance(input: {
  repository: LeadRepository;
  record: StoredLeadRecord;
  replyBody: string;
  channel: string;
  actor: string;
  generatedAt: string;
  addActivityNote?: boolean;
}): AppliedReplyGuidance {
  const guidance = analyzeInboundReply(input.record.lead, input.replyBody, {
    generatedAt: input.generatedAt,
  });
  const stopFollowUps = guidance.classification === 'unsubscribe_or_stop'
    || guidance.classification === 'bounce_or_delivery_failure'
    || guidance.classification === 'not_relevant';
  const updatedLead: Lead = {
    ...input.record.lead,
    lastResponseAt: input.generatedAt,
    pipelineStatus: guidance.recommendedPipelineStatus,
    recommendedNextAction: guidance.recommendedNextAction,
    nextFollowUpAt: stopFollowUps ? undefined : input.record.lead.nextFollowUpAt,
    followUpNote: stopFollowUps ? undefined : input.record.lead.followUpNote,
    updatedAt: input.generatedAt,
  };
  input.repository.upsertLead(updatedLead, input.actor);
  if (input.addActivityNote !== false) {
    input.repository.addNote(
      input.record.lead.id,
      `activity::response::${input.channel}::${input.replyBody}`,
      input.actor,
    );
  }
  const record = input.repository.addNote(
    input.record.lead.id,
    `${REPLY_GUIDANCE_PREFIX}${formatReplyGuidance(guidance)}`,
    input.actor,
  );
  return { guidance, record };
}
