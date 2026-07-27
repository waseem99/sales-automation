import {
  approveOutreachDraft,
  attachOutreachWorkbench,
  changeSequenceStatus,
  editOutreachDraft,
  readOutreachWorkbench,
  recordManualOutreachSend,
  recordOutreachCopy,
  recordOutreachOutcome,
  rejectOutreachDraft,
  submitOutreachForReview,
  type OutreachOutcome,
  type OutreachSequenceStatus,
  type OutreachWorkbenchSnapshot,
} from '@sales-automation/outreach-workbench';
import {
  attachBdWorkflow,
  recordBdPipelineEvent,
} from '@sales-automation/bd-workflow';
import type { PortfolioItem, PipelineStatus } from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';
import {
  prepareOutreachWorkbench,
  requireOutreachWorkbench,
  saveOutreachWorkbench,
} from './outreach-workbench-automation.js';

export interface OutreachWorkbenchRequest {
  method: string;
  url: string;
  body?: unknown;
}

export interface OutreachWorkbenchContext {
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  actor: string;
  canManagerApprove: boolean;
  now?: () => string;
}

export interface OutreachWorkbenchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function isOutreachWorkbenchPath(pathname: string): boolean {
  return /^\/api\/(?:prospects|opportunities)\/[^/]+\/outreach(?:\/|$)/.test(pathname);
}

export async function handleOutreachWorkbenchRequest(
  request: OutreachWorkbenchRequest,
  context: OutreachWorkbenchContext,
): Promise<OutreachWorkbenchResponse> {
  try {
    const method = request.method.toUpperCase();
    if (method !== 'POST') return json({error: 'Method not allowed.'}, 405, {allow: 'POST'});
    const pathname = trimTrailingSlash(new URL(request.url, 'http://localhost').pathname);
    const match = pathname.match(/^\/api\/(?:prospects|opportunities)\/([^/]+)\/outreach(?:\/(.*))?$/);
    if (!match) return json({error: 'Not found.'}, 404);
    const leadId = decodeURIComponent(match[1] ?? '');
    const tail = match[2] ?? '';
    const existing = context.repository.getLead(leadId);
    if (!existing) return json({error: 'Prospect not found.'}, 404);
    const payload = asObject(request.body);
    const generatedAt = now(context);

    if (tail === 'initialize' || tail === 'refresh') {
      const prepared = prepareOutreachWorkbench({
        repository: context.repository,
        record: existing,
        portfolioItems: context.portfolioItems,
        actor: context.actor,
        generatedAt,
        auditNote: `outreach_workbench_${tail}::human_controlled`,
      });
      return json({ok: true, workbench: prepared.snapshot, prospect: serialize(prepared.record)}, tail === 'initialize' ? 201 : 200);
    }

    const actionMatch = tail.match(/^([^/]+)\/(edit|submit-review|approve|reject|copy|mark-sent|outcome)$/);
    if (actionMatch) {
      const draftId = decodeURIComponent(actionMatch[1] ?? '');
      const action = actionMatch[2] ?? '';
      const snapshot = requireOutreachWorkbench(existing);

      if (action === 'edit') {
        const updated = editOutreachDraft(snapshot, draftId, {
          subject: optionalString(payload.subject),
          body: requiredString(payload.body, 'body'),
          proofIds: stringList(payload.proofIds),
          note: optionalString(payload.note),
        }, context.actor, generatedAt);
        return saveResponse(context, leadId, updated, `outreach_draft_edited::${draftId}`);
      }

      if (action === 'submit-review') {
        const updated = submitOutreachForReview(snapshot, draftId, context.actor, generatedAt);
        return saveResponse(context, leadId, updated, `outreach_submitted_for_review::${draftId}`);
      }

      if (action === 'approve') {
        const updated = approveOutreachDraft(snapshot, draftId, {
          actor: context.actor,
          canManagerApprove: context.canManagerApprove,
          note: optionalString(payload.note),
          generatedAt,
        });
        return saveResponse(context, leadId, updated, `outreach_approved::${draftId}::${context.canManagerApprove ? 'manager_capable' : 'owner_approval'}`);
      }

      if (action === 'reject') {
        const updated = rejectOutreachDraft(snapshot, draftId, requiredString(payload.reason, 'reason'), context.actor, generatedAt);
        return saveResponse(context, leadId, updated, `outreach_rejected::${draftId}`);
      }

      if (action === 'copy') {
        const updated = recordOutreachCopy(snapshot, draftId, context.actor, generatedAt);
        return saveResponse(context, leadId, updated, `outreach_approved_version_copied::${draftId}`);
      }

      if (action === 'mark-sent') {
        const sentAt = requiredString(payload.sentAt, 'sentAt');
        const followUpAt = optionalString(payload.followUpAt);
        const updated = recordManualOutreachSend(snapshot, draftId, {
          actor: context.actor,
          sender: requiredString(payload.sender, 'sender'),
          subject: optionalString(payload.subject),
          body: requiredString(payload.body, 'body'),
          sentAt,
          followUpAt,
          manualConfirmation: booleanValue(payload.manualConfirmation),
          generatedAt,
        });
        let record = saveOutreachWorkbench({
          repository: context.repository,
          leadId,
          snapshot: updated,
          actor: context.actor,
          auditNote: `outreach_manual_send_recorded::${draftId}::system_did_not_send`,
        }).record;
        const normalizedSentAt = new Date(sentAt).toISOString();
        const normalizedFollowUp = followUpAt ? new Date(followUpAt).toISOString() : undefined;
        context.repository.upsertLead({
          ...record.lead,
          lastContactedAt: normalizedSentAt,
          nextFollowUpAt: normalizedFollowUp,
          followUpNote: normalizedFollowUp ? 'Follow up on the manually recorded outreach if no reply is received.' : record.lead.followUpNote,
          pipelineStatus: 'sent_manually',
          updatedAt: generatedAt,
        }, context.actor);
        record = refreshBdWorkflowAfterOutreach(context.repository, leadId, context.actor, generatedAt, 'Manual outreach was recorded. The system did not send it.');
        return json({ok: true, workbench: readOutreachWorkbench(record.lead), prospect: serialize(record)});
      }

      const outcome = requireOutcome(payload.outcome);
      const occurredAt = requiredString(payload.occurredAt, 'occurredAt');
      const note = requiredString(payload.note, 'note');
      const updated = recordOutreachOutcome(snapshot, draftId, outcome, note, context.actor, occurredAt, generatedAt);
      let record = saveOutreachWorkbench({
        repository: context.repository,
        leadId,
        snapshot: updated,
        actor: context.actor,
        auditNote: `outreach_outcome::${draftId}::${outcome}`,
      }).record;
      record = applyOutcomeToLead(context.repository, record, outcome, note, occurredAt, context.actor, generatedAt);
      record = refreshBdWorkflowAfterOutreach(context.repository, leadId, context.actor, generatedAt, `Outreach outcome recorded as ${outcome}.`);
      return json({ok: true, workbench: readOutreachWorkbench(record.lead), prospect: serialize(record)});
    }

    if (tail === 'sequence') {
      const snapshot = requireOutreachWorkbench(existing);
      const status = requireSequenceStatus(payload.status);
      const updated = changeSequenceStatus(snapshot, status, context.actor, generatedAt);
      return saveResponse(context, leadId, updated, `outreach_sequence_status::${status}`);
    }

    return json({error: 'Not found.'}, 404);
  } catch (error) {
    const message = (error as Error).message;
    return json({error: message, systemExternalActionPerformed: false}, errorStatus(message));
  }
}

function saveResponse(context: OutreachWorkbenchContext, leadId: string, snapshot: OutreachWorkbenchSnapshot, note: string, status = 200): OutreachWorkbenchResponse {
  const saved = saveOutreachWorkbench({repository: context.repository, leadId, snapshot, actor: context.actor, auditNote: note});
  return json({ok: true, workbench: saved.snapshot, prospect: serialize(saved.record)}, status);
}

function applyOutcomeToLead(
  repository: LeadRepository,
  record: StoredLeadRecord,
  outcome: OutreachOutcome,
  note: string,
  occurredAt: string,
  actor: string,
  generatedAt: string,
): StoredLeadRecord {
  const occurred = new Date(occurredAt).toISOString();
  const status = outcomePipelineStatus(outcome, record.lead.pipelineStatus);
  const raw = asObject(record.lead.rawPayload);
  const nextRaw = outcome === 'opt_out'
    ? {...raw, doNotContact: true, suppressionReason: note, outreachSuppressionRecordedAt: occurred}
    : outcome === 'bounce'
      ? {...raw, outreachDeliveryStatus: 'bounced', outreachBounceRecordedAt: occurred}
      : raw;
  repository.upsertLead({
    ...record.lead,
    rawPayload: nextRaw,
    pipelineStatus: status,
    lastResponseAt: outcome === 'reply' || outcome === 'meeting' || outcome === 'proposal' || outcome === 'opt_out' ? occurred : record.lead.lastResponseAt,
    nextFollowUpAt: outcome === 'reply' || outcome === 'meeting' || outcome === 'proposal' || outcome === 'opt_out' || outcome === 'bounce' ? undefined : record.lead.nextFollowUpAt,
    followUpNote: outcome === 'reply' || outcome === 'meeting' || outcome === 'proposal' || outcome === 'opt_out' || outcome === 'bounce' ? undefined : record.lead.followUpNote,
    updatedAt: generatedAt,
  }, actor);
  repository.addNote(record.lead.id, `activity::outreach_outcome::${outcome}::${note}`, actor);
  return repository.getLead(record.lead.id)!;
}

function refreshBdWorkflowAfterOutreach(repository: LeadRepository, leadId: string, actor: string, generatedAt: string, summary: string): StoredLeadRecord {
  const record = repository.getLead(leadId);
  if (!record) throw new Error(`Prospect not found: ${leadId}`);
  const snapshot = recordBdPipelineEvent(record.lead, summary, actor, generatedAt);
  repository.upsertLead(attachBdWorkflow(record.lead, snapshot), actor);
  const note = `bd_workflow_event::${snapshot.nextBestAction.code}::${summary}`;
  const updated = repository.getLead(leadId)!;
  if (!updated.notes.includes(note)) repository.addNote(leadId, note, actor);
  return repository.getLead(leadId)!;
}

function outcomePipelineStatus(outcome: OutreachOutcome, current: PipelineStatus): PipelineStatus {
  if (outcome === 'reply') return 'replied';
  if (outcome === 'meeting') return 'meeting_booked';
  if (outcome === 'proposal') return 'proposal_sent';
  if (outcome === 'bounce') return 'needs_research';
  if (outcome === 'opt_out') return 'archived';
  return current;
}

function serialize(record: StoredLeadRecord) {
  return {...record.lead, notes: record.notes, auditLog: record.auditLog, evaluation: record.latestEvaluation};
}

function requireOutcome(value: unknown): OutreachOutcome {
  return requireEnum(value, 'outcome', ['reply', 'bounce', 'no_response', 'meeting', 'proposal', 'opt_out']);
}

function requireSequenceStatus(value: unknown): OutreachSequenceStatus {
  return requireEnum(value, 'status', ['planned', 'active', 'paused', 'completed', 'stopped']);
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const text = requiredString(value, field) as T;
  if (!allowed.includes(text)) throw new Error(`${field} is invalid.`);
  return text;
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function trimTrailingSlash(value: string): string { return value.length > 1 ? value.replace(/\/+$/, '') : value; }
function now(context: OutreachWorkbenchContext): string { return context.now?.() ?? new Date().toISOString(); }
function errorStatus(message: string): number {
  const normalized = message.toLowerCase();
  if (normalized.includes('not found')) return 404;
  if (normalized.includes('manager approval') || normalized.startsWith('cannot ')) return 409;
  return 400;
}
function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): OutreachWorkbenchResponse {
  return {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders}, body: JSON.stringify(value)};
}
