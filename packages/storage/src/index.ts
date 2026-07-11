import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LeadEvaluation } from '@sales-automation/evaluator';
import type { Lead, LeadOutcomeStatus, PipelineStatus } from '@sales-automation/shared';

export type AuditAction =
  | 'lead_upserted'
  | 'evaluation_saved'
  | 'status_changed'
  | 'owner_assigned'
  | 'note_added'
  | 'follow_up_scheduled'
  | 'outcome_recorded'
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

export interface ScheduleFollowUpInput {
  nextFollowUpAt: string;
  followUpNote?: string;
}

export interface RecordOutcomeInput {
  outcomeStatus: LeadOutcomeStatus;
  outcomeReason: string;
  outcomeRecordedAt?: string;
}

export interface LeadRepository {
  upsertLead(lead: Lead, actor?: string): StoredLeadRecord;
  saveEvaluation(evaluation: LeadEvaluation, actor?: string): StoredLeadRecord;
  updateStatus(leadId: string, status: PipelineStatus, actor?: string): StoredLeadRecord;
  assignOwner(leadId: string, owner: string, actor?: string): StoredLeadRecord;
  addNote(leadId: string, note: string, actor?: string): StoredLeadRecord;
  scheduleFollowUp(leadId: string, input: ScheduleFollowUpInput, actor?: string): StoredLeadRecord;
  recordOutcome(leadId: string, input: RecordOutcomeInput, actor?: string): StoredLeadRecord;
  markAlertSent(leadId: string, dedupeKey: string, actor?: string): StoredLeadRecord;
  getLead(leadId: string): StoredLeadRecord | undefined;
  listLeads(): StoredLeadRecord[];
  listHotLeads(): StoredLeadRecord[];
  listAuditLog(leadId: string): AuditEntry[];
  clearAll(actor?: string): number;
}

export interface LocalJsonLeadRepositoryOptions {
  filePath: string;
}

interface PersistedLeadRepositoryFile {
  version: 1;
  updatedAt: string;
  records: StoredLeadRecord[];
}

export class InMemoryLeadRepository implements LeadRepository {
  protected readonly records = new Map<string, StoredLeadRecord>();

  constructor(initialRecords: StoredLeadRecord[] = []) {
    this.replaceRecords(initialRecords);
  }

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
    this.afterMutation();
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
    this.afterMutation();
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
    this.afterMutation();
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
    this.afterMutation();
    return record;
  }

  addNote(leadId: string, note: string, actor = 'system'): StoredLeadRecord {
    const record = this.requireRecord(leadId);
    record.notes.push(note);
    this.addAudit(record, 'note_added', actor, 'Note added.', { note });
    this.afterMutation();
    return record;
  }

  scheduleFollowUp(leadId: string, input: ScheduleFollowUpInput, actor = 'system'): StoredLeadRecord {
    const record = this.requireRecord(leadId);
    record.lead = {
      ...record.lead,
      nextFollowUpAt: input.nextFollowUpAt,
      followUpNote: input.followUpNote,
      updatedAt: new Date().toISOString(),
    };
    this.addAudit(record, 'follow_up_scheduled', actor, `Follow-up scheduled for ${input.nextFollowUpAt}.`, {
      nextFollowUpAt: input.nextFollowUpAt,
      followUpNote: input.followUpNote,
    });
    this.afterMutation();
    return record;
  }

  recordOutcome(leadId: string, input: RecordOutcomeInput, actor = 'system'): StoredLeadRecord {
    const record = this.requireRecord(leadId);
    record.lead = {
      ...record.lead,
      outcomeStatus: input.outcomeStatus,
      outcomeReason: input.outcomeReason,
      outcomeRecordedAt: input.outcomeRecordedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.addAudit(record, 'outcome_recorded', actor, `Outcome recorded as ${input.outcomeStatus}.`, {
      outcomeStatus: input.outcomeStatus,
      outcomeReason: input.outcomeReason,
      outcomeRecordedAt: input.outcomeRecordedAt,
    });
    this.afterMutation();
    return record;
  }

  markAlertSent(leadId: string, dedupeKey: string, actor = 'system'): StoredLeadRecord {
    const record = this.requireRecord(leadId);
    if (!record.alertDedupeKeysSent.includes(dedupeKey)) {
      record.alertDedupeKeysSent.push(dedupeKey);
      this.addAudit(record, 'alert_marked_sent', actor, 'Alert was marked as sent.', { dedupeKey });
      this.afterMutation();
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

  clearAll(_actor = 'system'): number {
    const cleared = this.records.size;
    this.records.clear();
    this.afterMutation();
    return cleared;
  }

  protected afterMutation(): void {
    // In-memory implementation has no persistence side effect.
  }

  protected replaceRecords(records: StoredLeadRecord[]): void {
    this.records.clear();
    for (const record of records) {
      this.records.set(record.lead.id, record);
    }
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

export class LocalJsonLeadRepository extends InMemoryLeadRepository {
  private readonly filePath: string;

  constructor(options: LocalJsonLeadRepositoryOptions) {
    super();
    this.filePath = options.filePath;
    this.loadFromDisk();
  }

  protected override afterMutation(): void {
    this.persistToDisk();
  }

  private loadFromDisk(): void {
    ensureParentDirectory(this.filePath);

    if (!existsSync(this.filePath)) {
      this.persistToDisk();
      return;
    }

    const raw = readFileSync(this.filePath, 'utf8').trim();
    if (!raw) {
      this.persistToDisk();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid local lead repository JSON at ${this.filePath}: ${(error as Error).message}`);
    }

    if (!isPersistedLeadRepositoryFile(parsed)) {
      throw new Error(`Invalid local lead repository schema at ${this.filePath}. Expected version 1 with records array.`);
    }

    this.replaceRecords(parsed.records);
  }

  private persistToDisk(): void {
    ensureParentDirectory(this.filePath);
    const payload: PersistedLeadRepositoryFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      records: this.listLeads(),
    };
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function isPersistedLeadRepositoryFile(value: unknown): value is PersistedLeadRepositoryFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedLeadRepositoryFile>;
  return candidate.version === 1 && Array.isArray(candidate.records);
}
