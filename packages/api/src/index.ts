import {
  buildDashboardSummary,
  buildLeadDetail,
  buildOpportunityList,
  getAllowedStatusActions,
  type DashboardListOptions,
  type DashboardSummary,
  type LeadDetailView,
  type OpportunityListItem,
} from '@sales-automation/dashboard';
import type { LeadOutcomeStatus, PipelineStatus } from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';

export interface ApiActorContext {
  actor: string;
}

export interface UpdateLeadStatusInput extends ApiActorContext {
  leadId: string;
  status: PipelineStatus;
  allowUnsafeTransition?: boolean;
}

export interface AssignLeadOwnerInput extends ApiActorContext {
  leadId: string;
  owner: string;
}

export interface AddLeadNoteInput extends ApiActorContext {
  leadId: string;
  note: string;
}

export interface ScheduleLeadFollowUpInput extends ApiActorContext {
  leadId: string;
  nextFollowUpAt: string;
  followUpNote?: string;
}

export interface RecordLeadOutcomeInput extends ApiActorContext {
  leadId: string;
  outcomeStatus: LeadOutcomeStatus;
  outcomeReason: string;
  outcomeRecordedAt?: string;
}

export interface MarkAlertSentInput extends ApiActorContext {
  leadId: string;
  dedupeKey?: string;
}

export interface SalesAutomationDashboardApi {
  listOpportunities(options?: DashboardListOptions): OpportunityListItem[];
  getDashboardSummary(now?: string): DashboardSummary;
  getLeadDetail(leadId: string, now?: string): LeadDetailView;
  updateLeadStatus(input: UpdateLeadStatusInput): LeadDetailView;
  assignLeadOwner(input: AssignLeadOwnerInput): LeadDetailView;
  addLeadNote(input: AddLeadNoteInput): LeadDetailView;
  scheduleLeadFollowUp(input: ScheduleLeadFollowUpInput): LeadDetailView;
  recordLeadOutcome(input: RecordLeadOutcomeInput): LeadDetailView;
  markAlertSent(input: MarkAlertSentInput): LeadDetailView;
}

export class SalesAutomationDashboardController implements SalesAutomationDashboardApi {
  constructor(private readonly repository: LeadRepository) {}

  listOpportunities(options: DashboardListOptions = {}): OpportunityListItem[] {
    return buildOpportunityList(this.repository.listLeads(), options);
  }

  getDashboardSummary(now = new Date().toISOString()): DashboardSummary {
    return buildDashboardSummary(this.repository.listLeads(), now);
  }

  getLeadDetail(leadId: string, now = new Date().toISOString()): LeadDetailView {
    return buildLeadDetail(this.requireLead(leadId), now);
  }

  updateLeadStatus(input: UpdateLeadStatusInput): LeadDetailView {
    const record = this.requireLead(input.leadId);
    if (!input.allowUnsafeTransition) {
      const allowedActions = getAllowedStatusActions(record.lead.pipelineStatus);
      if (!allowedActions.includes(input.status)) {
        throw new Error(
          `Invalid status transition from ${record.lead.pipelineStatus} to ${input.status}. Allowed: ${allowedActions.join(', ') || 'none'}.`,
        );
      }
    }

    const updated = this.repository.updateStatus(input.leadId, input.status, input.actor);
    return buildLeadDetail(updated);
  }

  assignLeadOwner(input: AssignLeadOwnerInput): LeadDetailView {
    const owner = input.owner.trim();
    if (!owner) {
      throw new Error('Owner is required.');
    }

    const updated = this.repository.assignOwner(input.leadId, owner, input.actor);
    return buildLeadDetail(updated);
  }

  addLeadNote(input: AddLeadNoteInput): LeadDetailView {
    const note = input.note.trim();
    if (!note) {
      throw new Error('Note is required.');
    }

    const updated = this.repository.addNote(input.leadId, note, input.actor);
    return buildLeadDetail(updated);
  }

  scheduleLeadFollowUp(input: ScheduleLeadFollowUpInput): LeadDetailView {
    const nextFollowUpAt = input.nextFollowUpAt.trim();
    if (!nextFollowUpAt || Number.isNaN(Date.parse(nextFollowUpAt))) {
      throw new Error('Valid nextFollowUpAt is required.');
    }

    const updated = this.repository.scheduleFollowUp(
      input.leadId,
      {
        nextFollowUpAt,
        followUpNote: input.followUpNote?.trim() || undefined,
      },
      input.actor,
    );
    return buildLeadDetail(updated);
  }

  recordLeadOutcome(input: RecordLeadOutcomeInput): LeadDetailView {
    const outcomeReason = input.outcomeReason.trim();
    if (!outcomeReason) {
      throw new Error('Outcome reason is required.');
    }

    const updated = this.repository.recordOutcome(
      input.leadId,
      {
        outcomeStatus: input.outcomeStatus,
        outcomeReason,
        outcomeRecordedAt: input.outcomeRecordedAt,
      },
      input.actor,
    );
    return buildLeadDetail(updated);
  }

  markAlertSent(input: MarkAlertSentInput): LeadDetailView {
    const record = this.requireLead(input.leadId);
    const dedupeKey = input.dedupeKey ?? record.latestEvaluation?.alertPlan.dedupeKey;
    if (!dedupeKey) {
      throw new Error('Alert dedupe key is required when a lead has no latest alert plan.');
    }

    const updated = this.repository.markAlertSent(input.leadId, dedupeKey, input.actor);
    return buildLeadDetail(updated);
  }

  private requireLead(leadId: string): StoredLeadRecord {
    const record = this.repository.getLead(leadId);
    if (!record) {
      throw new Error(`Lead not found: ${leadId}`);
    }
    return record;
  }
}

export function createSalesAutomationDashboardApi(repository: LeadRepository): SalesAutomationDashboardApi {
  return new SalesAutomationDashboardController(repository);
}
