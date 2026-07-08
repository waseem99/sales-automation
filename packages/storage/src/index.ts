import type { LeadEvaluation } from '@sales-automation/evaluator';
import type { Lead, PipelineStatus } from '@sales-automation/shared';

export type AuditAction =
  | 'lead_upserted'
  | 'evaluation_saved'
  | 'status_changed'
  | 'owner_assigned'
  | 'note_added'
  | 'alert_marked_sent';

export interface AuditEntry {
  id: string;
  leadId: string;
  action: AuditAction;
  actor: string;
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface StoredLeadRecord {
  lead: Lead;
  latestEvaluation?: LeadEvaluation;
  notes: string[];
  alertDedupeKeysSent: string[];
  auditLog: AuditEntry[];
}

export interface LeadRepository {
  upsertLead(lead: Lead, actor?: string): StoredLeadRecord;
  saveEvaluation(evaluation: LeadEvaluation, actor?: string): StoredLeadRecord;
  updateStatus(leadId: string, status: PipelineStatus, actor?: string): StoredLeadRecord;
  assignOwner(leadId: string, owner: string, actor?: string): StoredLeadRecord;
  addNote(leadId: string, note: string, actor?: string): StoredLeadRecord;
  markAlertSent(leadId: string, dedupeKey: string, actor?: string): StoredLeadRecord;
  getLead(leadId: string): StoredLeadRecord | undefined;
  listLeads(): StoredLeadRecord[];
  listHotLeads(): StoredLeadRecord[];
  listAuditLog(leadId: string): AuditEntry[];
}

export class InMemoryLeadRepository implements LeadRepository {
  private readonly records = new Map<string, StoredLeadRecord>();

  upsertLead(lead: Lead, actor = 'system'): StoredLeadRecord {
    const existing = this.records.get(lead.id);
    const record: StoredLeadRecord = existing ?? {
      lead,
      notes: [],
      alertDedupeKeysSent: [],
      auditLog: [],
    };

    record.lead = {
      ...record.lead,
      ...lead,
      updatedAt: lead.updatedAt ?? new Date().toISOString(),
    };

    this.addAudit(record, 'lead_upserted', actor, 'Lead was created or updated.');
    this.records.set(lead.id, record);
    return record;
  }

  saveEvaluation(evaluation: LeadEvaluation, actor = 'system'): StoredLeadRecord {
    const record = this.upsertLead(evaluation.lead, actor);
    record.latestEvaluation = evaluation;
    this.addAudit(record, 'evaluation_saved', actor, `Evaluation saved with score ${evaluation.score.total}.`, {
      status: evaluation.score.status,
      urgency: evaluation.score.urgency,
      recommendedProfile: evaluation.profileRecommendation.primaryProfile,
      alertShouldSend: evaluation.alertPlan.shouldAlert,
    });
    return record;
  }

  updateStatus(leadId: string, status: PipelineStatus, actor = 'system'): StoredLeadRecord {
    const record = this.requireRecord(leadId);
    const previousStatus = record.lead.pipelineStatus;
    record.lead = {
      ...record.lead,
      pipelineStatus: status,
      updatedAt: new Date().toISOString(),
    };
    this.addAudit(record, 'status_changed', actor, `Status changed from ${previousStatus} to ${status}.`, {
      previousStatus,
      status,
    });
    return record;
  }

  assignOwner(leadId: string, owner: string, actor = 'system'): StoredLeadRecord {
    const record = this.requireRecord(leadId);
    record.lead = {
      ...record.lead,
      owner,
      updatedAt: new Date().toISOString(),
    };
    this.addAudit(record, 'owner_assigned', actor, `Owner assigned to ${owner}.`, { owner });
    return record;
  }

  addNote(leadId: string, note: string, actor = 'system'): StoredLeadRecord {
    const record = this.requireRecord(leadId);
    record.notes.push(note);
    this.addAudit(record, 'note_added', actor, 'Note added.', { note });
    return record;
  }

  markAlertSent(leadId: string, dedupeKey: string, actor = 'system'): StoredLeadRecord {
    const record = this.requireRecord(leadId);
    if (!record.alertDedupeKeysSent.includes(dedupeKey)) {
      record.alertDedupeKeysSent.push(dedupeKey);
      this.addAudit(record, 'alert_marked_sent', actor, 'Alert was marked as sent.', { dedupeKey });
    }
    return record;
  }

  getLead(leadId: string): StoredLeadRecord | undefined {
    return this.records.get(leadId);
  }

  listLeads(): StoredLeadRecord[] {
    return [...this.records.values()];
  }

  listHotLeads(): StoredLeadRecord[] {
    return this.listLeads().filter((record) => record.latestEvaluation?.score.status === 'hot');
  }

  listAuditLog(leadId: string): AuditEntry[] {
    return this.records.get(leadId)?.auditLog ?? [];
  }

  private requireRecord(leadId: string): StoredLeadRecord {
    const record = this.records.get(leadId);
    if (!record) {
      throw new Error(`Lead not found: ${leadId}`);
    }
    return record;
  }

  private addAudit(
    record: StoredLeadRecord,
    action: AuditAction,
    actor: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    record.auditLog.push({
      id: `${record.lead.id}-${record.auditLog.length + 1}`,
      leadId: record.lead.id,
      action,
      actor,
      message,
      createdAt: new Date().toISOString(),
      metadata,
    });
  }
}
