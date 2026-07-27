import { createHash } from 'node:crypto';
import type { GeneratedDraft } from '@sales-automation/drafting';
import type { Lead } from '@sales-automation/shared';

export const OUTREACH_WORKBENCH_VERSION = 'outreach-workbench.v1';

export type OutreachChannel = 'upwork' | 'linkedin_comment' | 'linkedin_dm' | 'email' | 'partner' | 'other';
export type OutreachDraftStatus = 'working' | 'in_review' | 'changes_requested' | 'approved' | 'sent_manually' | 'rejected';
export type OutreachEventType = 'draft_created' | 'draft_edited' | 'submitted_for_review' | 'changes_requested' | 'approved' | 'copied' | 'marked_sent' | 'rejected';

export interface OutreachRevision {
  id: string;
  draftId: string;
  number: number;
  subject?: string;
  body: string;
  createdAt: string;
  createdBy: string;
  changeNote?: string;
  source: 'generated' | 'human_edit';
  contentHash: string;
}

export interface OutreachApproval {
  revisionId: string;
  approvedAt: string;
  approvedBy: string;
  note?: string;
  contentHash: string;
}

export interface OutreachSentVersion {
  id: string;
  revisionId: string;
  subject?: string;
  body: string;
  channel: OutreachChannel;
  sentAt: string;
  sentBy: string;
  destinationLabel?: string;
  externalReference?: string;
  contentHash: string;
  manuallyConfirmed: true;
  externalActionPerformedBySystem: false;
}

export interface OutreachEvent {
  id: string;
  type: OutreachEventType;
  summary: string;
  actor: string;
  occurredAt: string;
  revisionId?: string;
  metadata?: Record<string, unknown>;
  externalActionPerformedBySystem: false;
}

export interface OutreachDraftRecord {
  id: string;
  leadId: string;
  channel: OutreachChannel;
  status: OutreachDraftStatus;
  currentRevisionId: string;
  revisions: OutreachRevision[];
  approval?: OutreachApproval;
  sentVersions: OutreachSentVersion[];
  events: OutreachEvent[];
  assumptions: string[];
  safeguards: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  humanReviewRequired: true;
  automaticSendingEnabled: false;
}

export interface OutreachWorkbenchSnapshot {
  version: typeof OUTREACH_WORKBENCH_VERSION;
  leadId: string;
  drafts: OutreachDraftRecord[];
  updatedAt: string;
  humanReviewRequired: true;
  automaticSendingEnabled: false;
}

export interface EditDraftInput {
  subject?: string;
  body: string;
  changeNote?: string;
}

export interface MarkSentInput {
  revisionId: string;
  sentAt?: string;
  destinationLabel?: string;
  externalReference?: string;
}

export function readOutreachWorkbench(lead: Lead): OutreachWorkbenchSnapshot | undefined {
  const raw = asRecord(lead.rawPayload);
  const candidate = raw.outreachWorkbench;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const snapshot = candidate as Partial<OutreachWorkbenchSnapshot>;
  if (snapshot.version !== OUTREACH_WORKBENCH_VERSION || snapshot.leadId !== lead.id || !Array.isArray(snapshot.drafts)) return undefined;
  return snapshot as OutreachWorkbenchSnapshot;
}

export function attachOutreachWorkbench(lead: Lead, snapshot: OutreachWorkbenchSnapshot): Lead {
  return {
    ...lead,
    rawPayload: {
      ...asRecord(lead.rawPayload),
      outreachWorkbenchVersion: OUTREACH_WORKBENCH_VERSION,
      outreachWorkbench: snapshot,
    },
    updatedAt: laterIso(lead.updatedAt, snapshot.updatedAt),
  };
}

export function initializeOutreachWorkbench(
  lead: Lead,
  generatedDrafts: GeneratedDraft[],
  actor: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  const existing = readOutreachWorkbench(lead);
  if (existing) return existing;
  return updateSnapshot(
    emptySnapshot(lead.id, generatedAt),
    generatedDrafts.map((draft) => fromGeneratedDraft(lead, draft, actor, generatedAt)),
    generatedAt,
  );
}

export function createManualDraft(
  lead: Lead,
  input: {channel: OutreachChannel; subject?: string; body: string; assumptions?: string[]; safeguards?: string[]},
  actor: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  const snapshot = readOutreachWorkbench(lead) ?? emptySnapshot(lead.id, generatedAt);
  const body = requiredText(input.body, 'body', 12000);
  const draftId = `outreach-${shortHash(`${lead.id}:${input.channel}:${generatedAt}:${actor}`)}`;
  const firstRevision = createRevision(draftId, 1, input.subject, body, actor, generatedAt, 'human_edit');
  const record: OutreachDraftRecord = {
    id: draftId,
    leadId: lead.id,
    channel: input.channel,
    status: 'working',
    currentRevisionId: firstRevision.id,
    revisions: [firstRevision],
    sentVersions: [],
    events: [createEvent('draft_created', 'Manual outreach draft created.', actor, generatedAt, firstRevision.id)],
    assumptions: unique(input.assumptions ?? []),
    safeguards: unique([
      'Human approval is required before any external action.',
      'The system does not send, submit, comment, connect or message automatically.',
      ...(input.safeguards ?? []),
    ]),
    createdAt: generatedAt,
    createdBy: actor,
    updatedAt: generatedAt,
    updatedBy: actor,
    humanReviewRequired: true,
    automaticSendingEnabled: false,
  };
  return updateSnapshot(snapshot, [...snapshot.drafts, record], generatedAt);
}

export function editOutreachDraft(
  lead: Lead,
  draftId: string,
  input: EditDraftInput,
  actor: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  const snapshot = requireSnapshot(lead);
  const draft = requireDraft(snapshot, draftId);
  assertMutable(draft);
  const nextNumber = Math.max(0, ...draft.revisions.map((item) => item.number)) + 1;
  const nextRevision = createRevision(
    draft.id,
    nextNumber,
    input.subject,
    requiredText(input.body, 'body', 12000),
    actor,
    generatedAt,
    'human_edit',
    input.changeNote,
  );
  return replaceDraft(snapshot, {
    ...draft,
    status: 'working',
    currentRevisionId: nextRevision.id,
    revisions: [...draft.revisions, nextRevision],
    approval: undefined,
    events: [...draft.events, createEvent('draft_edited', `Draft edited as revision ${nextNumber}.`, actor, generatedAt, nextRevision.id, {changeNote: input.changeNote})],
    updatedAt: generatedAt,
    updatedBy: actor,
  }, generatedAt);
}

export function submitDraftForReview(lead: Lead, draftId: string, actor: string, generatedAt = new Date().toISOString()): OutreachWorkbenchSnapshot {
  return transition(lead, draftId, 'in_review', 'submitted_for_review', 'Draft submitted for human review.', actor, generatedAt);
}

export function requestDraftChanges(lead: Lead, draftId: string, note: string, actor: string, generatedAt = new Date().toISOString()): OutreachWorkbenchSnapshot {
  const normalized = requiredText(note, 'note', 1000);
  return transition(lead, draftId, 'changes_requested', 'changes_requested', normalized, actor, generatedAt, {note: normalized});
}

export function approveOutreachDraft(lead: Lead, draftId: string, note: string | undefined, actor: string, generatedAt = new Date().toISOString()): OutreachWorkbenchSnapshot {
  const snapshot = requireSnapshot(lead);
  const draft = requireDraft(snapshot, draftId);
  assertMutable(draft);
  if (!['working', 'in_review', 'changes_requested'].includes(draft.status)) throw new Error('Draft cannot be approved from its current status.');
  const current = currentRevision(draft);
  const approval: OutreachApproval = {
    revisionId: current.id,
    approvedAt: generatedAt,
    approvedBy: actor,
    note: optionalText(note, 1000),
    contentHash: current.contentHash,
  };
  return replaceDraft(snapshot, {
    ...draft,
    status: 'approved',
    approval,
    events: [...draft.events, createEvent('approved', `Revision ${current.number} approved for manual use.`, actor, generatedAt, current.id, {note})],
    updatedAt: generatedAt,
    updatedBy: actor,
  }, generatedAt);
}

export function recordDraftCopied(lead: Lead, draftId: string, actor: string, generatedAt = new Date().toISOString()): OutreachWorkbenchSnapshot {
  const snapshot = requireSnapshot(lead);
  const draft = requireDraft(snapshot, draftId);
  const current = currentRevision(draft);
  return replaceDraft(snapshot, {
    ...draft,
    events: [...draft.events, createEvent('copied', `Revision ${current.number} copied by a human for manual use.`, actor, generatedAt, current.id)],
    updatedAt: generatedAt,
    updatedBy: actor,
  }, generatedAt);
}

export function markDraftSentManually(
  lead: Lead,
  draftId: string,
  input: MarkSentInput,
  actor: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  const snapshot = requireSnapshot(lead);
  const draft = requireDraft(snapshot, draftId);
  if (draft.status !== 'approved' || !draft.approval) throw new Error('Only an approved draft can be marked as sent.');
  const approvedRevision = draft.revisions.find((item) => item.id === input.revisionId);
  if (!approvedRevision) throw new Error('Revision not found.');
  if (draft.approval.revisionId !== approvedRevision.id || draft.approval.contentHash !== approvedRevision.contentHash) {
    throw new Error('The exact approved revision must be marked as sent.');
  }
  const sentAt = validDate(input.sentAt ?? generatedAt, 'sentAt');
  const sent: OutreachSentVersion = {
    id: `sent-${shortHash(`${draft.id}:${approvedRevision.id}:${sentAt}:${actor}`)}`,
    revisionId: approvedRevision.id,
    subject: approvedRevision.subject,
    body: approvedRevision.body,
    channel: draft.channel,
    sentAt,
    sentBy: actor,
    destinationLabel: optionalText(input.destinationLabel, 300),
    externalReference: optionalText(input.externalReference, 1000),
    contentHash: approvedRevision.contentHash,
    manuallyConfirmed: true,
    externalActionPerformedBySystem: false,
  };
  return replaceDraft(snapshot, {
    ...draft,
    status: 'sent_manually',
    sentVersions: [...draft.sentVersions, sent],
    events: [...draft.events, createEvent('marked_sent', `Approved revision ${approvedRevision.number} marked as manually sent.`, actor, generatedAt, approvedRevision.id, {sentId: sent.id, sentAt})],
    updatedAt: generatedAt,
    updatedBy: actor,
  }, generatedAt);
}

export function rejectOutreachDraft(lead: Lead, draftId: string, note: string, actor: string, generatedAt = new Date().toISOString()): OutreachWorkbenchSnapshot {
  const normalized = requiredText(note, 'note', 1000);
  return transition(lead, draftId, 'rejected', 'rejected', normalized, actor, generatedAt, {note: normalized});
}

function fromGeneratedDraft(lead: Lead, generated: GeneratedDraft, actor: string, generatedAt: string): OutreachDraftRecord {
  const draftId = `outreach-${shortHash(`${lead.id}:${generated.id}`)}`;
  const firstRevision = createRevision(draftId, 1, generated.subject, generated.body, actor, generatedAt, 'generated');
  return {
    id: draftId,
    leadId: lead.id,
    channel: channelFromGenerated(generated),
    status: 'working',
    currentRevisionId: firstRevision.id,
    revisions: [firstRevision],
    sentVersions: [],
    events: [createEvent('draft_created', `Generated ${generated.type} imported for human review.`, actor, generatedAt, firstRevision.id, {sourceDraftId: generated.id})],
    assumptions: [...generated.metadata.assumptions],
    safeguards: unique([...generated.metadata.safeguards, 'The system does not send, submit, comment, connect or message automatically.']),
    createdAt: generatedAt,
    createdBy: actor,
    updatedAt: generatedAt,
    updatedBy: actor,
    humanReviewRequired: true,
    automaticSendingEnabled: false,
  };
}

function transition(
  lead: Lead,
  draftId: string,
  status: OutreachDraftStatus,
  type: OutreachEventType,
  summary: string,
  actor: string,
  generatedAt: string,
  metadata?: Record<string, unknown>,
): OutreachWorkbenchSnapshot {
  const snapshot = requireSnapshot(lead);
  const draft = requireDraft(snapshot, draftId);
  assertMutable(draft);
  const current = currentRevision(draft);
  return replaceDraft(snapshot, {
    ...draft,
    status,
    approval: status === 'approved' ? draft.approval : undefined,
    events: [...draft.events, createEvent(type, summary, actor, generatedAt, current.id, metadata)],
    updatedAt: generatedAt,
    updatedBy: actor,
  }, generatedAt);
}

function createRevision(
  draftId: string,
  number: number,
  subject: string | undefined,
  body: string,
  actor: string,
  createdAt: string,
  source: OutreachRevision['source'],
  changeNote?: string,
): OutreachRevision {
  const normalizedSubject = optionalText(subject, 500);
  const contentHash = hash(`${normalizedSubject ?? ''}\n${body}`);
  return {
    id: `${draftId}-r${number}-${contentHash.slice(0, 8)}`,
    draftId,
    number,
    subject: normalizedSubject,
    body,
    createdAt,
    createdBy: actor,
    changeNote: optionalText(changeNote, 1000),
    source,
    contentHash,
  };
}

function createEvent(
  type: OutreachEventType,
  summary: string,
  actor: string,
  occurredAt: string,
  revisionId?: string,
  metadata?: Record<string, unknown>,
): OutreachEvent {
  return {
    id: `outreach-event-${shortHash(`${type}:${summary}:${actor}:${occurredAt}:${revisionId ?? ''}`)}`,
    type,
    summary,
    actor,
    occurredAt,
    revisionId,
    metadata,
    externalActionPerformedBySystem: false,
  };
}

function currentRevision(draft: OutreachDraftRecord): OutreachRevision {
  const current = draft.revisions.find((item) => item.id === draft.currentRevisionId);
  if (!current) throw new Error('Current outreach revision is missing.');
  return current;
}

function requireSnapshot(lead: Lead): OutreachWorkbenchSnapshot {
  const snapshot = readOutreachWorkbench(lead);
  if (!snapshot) throw new Error('Outreach workbench is not initialized for this prospect.');
  return snapshot;
}

function requireDraft(snapshot: OutreachWorkbenchSnapshot, draftId: string): OutreachDraftRecord {
  const draft = snapshot.drafts.find((item) => item.id === draftId);
  if (!draft) throw new Error(`Outreach draft not found: ${draftId}`);
  return draft;
}

function assertMutable(draft: OutreachDraftRecord): void {
  if (draft.status === 'sent_manually') throw new Error('A sent draft is immutable. Create a new draft for further outreach.');
}

function replaceDraft(snapshot: OutreachWorkbenchSnapshot, updated: OutreachDraftRecord, generatedAt: string): OutreachWorkbenchSnapshot {
  return updateSnapshot(snapshot, snapshot.drafts.map((item) => item.id === updated.id ? updated : item), generatedAt);
}

function updateSnapshot(snapshot: OutreachWorkbenchSnapshot, drafts: OutreachDraftRecord[], updatedAt: string): OutreachWorkbenchSnapshot {
  return {...snapshot, drafts, updatedAt, humanReviewRequired: true, automaticSendingEnabled: false};
}

function emptySnapshot(leadId: string, updatedAt: string): OutreachWorkbenchSnapshot {
  return {version: OUTREACH_WORKBENCH_VERSION, leadId, drafts: [], updatedAt, humanReviewRequired: true, automaticSendingEnabled: false};
}

function channelFromGenerated(draft: GeneratedDraft): OutreachChannel {
  if (draft.type === 'upwork_proposal') return 'upwork';
  if (draft.type === 'linkedin_comment') return 'linkedin_comment';
  if (draft.type === 'linkedin_dm') return 'linkedin_dm';
  if (draft.type === 'partner_outreach') return 'partner';
  return 'email';
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${field} must contain at most ${max} characters.`);
  return normalized;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`Text must contain at most ${max} characters.`);
  return normalized;
}

function validDate(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date.`);
  return date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function shortHash(value: string): string {
  return hash(value).slice(0, 16);
}

function laterIso(left: string, right: string): string {
  return Date.parse(right) >= Date.parse(left) ? right : left;
}
