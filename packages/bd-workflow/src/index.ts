import { createHash } from 'node:crypto';
import type { Lead, PipelineStatus } from '@sales-automation/shared';

export const BD_WORKFLOW_VERSION = 'bd-workflow.v1';

export type BdTaskStatus = 'open' | 'in_progress' | 'completed' | 'dismissed' | 'on_hold';
export type BdTaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type BdTaskCode =
  | 'assign_owner'
  | 'confirm_company_identity'
  | 'confirm_decision_maker'
  | 'verify_contact_route'
  | 'review_duplicate_contact'
  | 'review_suppression'
  | 'review_qualification'
  | 'prepare_outreach'
  | 'schedule_follow_up'
  | 'classify_reply'
  | 'prepare_meeting'
  | 'follow_up_proposal'
  | 'capture_learning'
  | 'custom';
export type BdChannel = 'internal' | 'upwork' | 'linkedin' | 'sales_navigator' | 'email' | 'referral' | 'meeting';
export type BdWorkflowEventType =
  | 'workflow_created'
  | 'workflow_refreshed'
  | 'task_created'
  | 'task_status_changed'
  | 'next_action_changed'
  | 'pipeline_event_recorded';

export interface BdTask {
  id: string;
  leadId: string;
  code: BdTaskCode;
  title: string;
  reason: string;
  priority: BdTaskPriority;
  status: BdTaskStatus;
  channel: BdChannel;
  owner?: string;
  dueAt?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  completedAt?: string;
  completedBy?: string;
  note?: string;
  generated: boolean;
  humanReviewRequired: true;
  externalActionPerformed: false;
}

export interface BdWorkflowEvent {
  id: string;
  leadId: string;
  type: BdWorkflowEventType;
  summary: string;
  actor: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
  externalActionPerformed: false;
}

export interface NextBestAction {
  code: BdTaskCode | 'no_action';
  title: string;
  reason: string;
  priority: BdTaskPriority;
  channel: BdChannel;
  dueAt?: string;
  taskId?: string;
  evidence: string[];
  missingEvidence: string[];
  risks: string[];
  prohibitedClaims: string[];
  generatedAt: string;
  humanReviewRequired: true;
  externalActionPerformed: false;
}

export interface BdWorkflowSnapshot {
  version: typeof BD_WORKFLOW_VERSION;
  leadId: string;
  generatedAt: string;
  updatedAt: string;
  tasks: BdTask[];
  events: BdWorkflowEvent[];
  nextBestAction: NextBestAction;
  openTaskCount: number;
  overdueTaskCount: number;
  blocked: boolean;
  blockedReason?: string;
  humanReviewRequired: true;
  externalActionPerformed: false;
}

export interface CreateBdTaskInput {
  title: string;
  reason: string;
  priority?: BdTaskPriority;
  channel?: BdChannel;
  dueAt?: string;
  owner?: string;
  note?: string;
}

export interface UpdateBdTaskInput {
  status: BdTaskStatus;
  note?: string;
  dueAt?: string;
  owner?: string;
}

const TERMINAL_STATUSES = new Set<PipelineStatus>(['won', 'lost', 'rejected', 'archived']);
const CONTACTED_STATUSES = new Set<PipelineStatus>(['sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']);
const ACTIVE_TASK_STATUSES = new Set<BdTaskStatus>(['open', 'in_progress']);

export function readBdWorkflow(lead: Lead): BdWorkflowSnapshot | undefined {
  const raw = asRecord(lead.rawPayload);
  const value = raw.bdWorkflow;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const snapshot = value as Partial<BdWorkflowSnapshot>;
  if (snapshot.version !== BD_WORKFLOW_VERSION || snapshot.leadId !== lead.id || !Array.isArray(snapshot.tasks)) return undefined;
  return snapshot as BdWorkflowSnapshot;
}

export function attachBdWorkflow(lead: Lead, snapshot: BdWorkflowSnapshot): Lead {
  return {
    ...lead,
    recommendedNextAction: snapshot.nextBestAction.title,
    rawPayload: {
      ...asRecord(lead.rawPayload),
      bdWorkflowVersion: BD_WORKFLOW_VERSION,
      bdWorkflow: snapshot,
    },
    updatedAt: laterIso(lead.updatedAt, snapshot.updatedAt),
  };
}

export function refreshBdWorkflow(
  lead: Lead,
  generatedAt = new Date().toISOString(),
  actor = 'bd-workflow',
  eventSummary?: string,
): BdWorkflowSnapshot {
  const previous = readBdWorkflow(lead);
  const evidence = inspectLead(lead, generatedAt);
  const generatedTasks = generatedTasksFor(lead, evidence, generatedAt, actor);
  const tasks = mergeTasks(previous?.tasks ?? [], generatedTasks);
  const nextBestAction = recommendNextBestAction(lead, tasks, evidence, generatedAt);
  const events = [...(previous?.events ?? [])];
  if (!previous) {
    events.push(event(lead.id, 'workflow_created', 'BD workflow created from current prospect evidence.', actor, generatedAt));
  } else if (!sameNextAction(previous.nextBestAction, nextBestAction)) {
    events.push(event(lead.id, 'next_action_changed', `Next best action changed to: ${nextBestAction.title}`, actor, generatedAt, {
      previousCode: previous.nextBestAction.code,
      nextCode: nextBestAction.code,
    }));
  } else if (eventSummary) {
    events.push(event(lead.id, 'pipeline_event_recorded', eventSummary, actor, generatedAt, {pipelineStatus: lead.pipelineStatus}));
  }
  const active = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  const overdue = active.filter((task) => task.dueAt && Date.parse(task.dueAt) <= Date.parse(generatedAt));
  return {
    version: BD_WORKFLOW_VERSION,
    leadId: lead.id,
    generatedAt: previous?.generatedAt ?? generatedAt,
    updatedAt: generatedAt,
    tasks,
    events: trimEvents(events),
    nextBestAction,
    openTaskCount: active.length,
    overdueTaskCount: overdue.length,
    blocked: evidence.suppressed,
    blockedReason: evidence.suppressionReason,
    humanReviewRequired: true,
    externalActionPerformed: false,
  };
}

export function createBdTask(
  lead: Lead,
  input: CreateBdTaskInput,
  actor: string,
  generatedAt = new Date().toISOString(),
): BdWorkflowSnapshot {
  const base = refreshBdWorkflow(lead, generatedAt, actor);
  const title = requiredText(input.title, 'title', 160);
  const reason = requiredText(input.reason, 'reason', 600);
  const dueAt = validOptionalDate(input.dueAt, 'dueAt');
  const task: BdTask = {
    id: `bd-task-${shortHash(`${lead.id}:${title}:${generatedAt}:${actor}`)}`,
    leadId: lead.id,
    code: 'custom',
    title,
    reason,
    priority: input.priority ?? 'normal',
    status: 'open',
    channel: input.channel ?? 'internal',
    owner: optionalText(input.owner, 160) ?? lead.owner,
    dueAt,
    createdAt: generatedAt,
    createdBy: actor,
    updatedAt: generatedAt,
    updatedBy: actor,
    note: optionalText(input.note, 1000),
    generated: false,
    humanReviewRequired: true,
    externalActionPerformed: false,
  };
  const tasks = [...base.tasks, task];
  const evidence = inspectLead(lead, generatedAt);
  const nextBestAction = recommendNextBestAction(lead, tasks, evidence, generatedAt);
  return finalizeSnapshot(base, tasks, nextBestAction, [
    event(lead.id, 'task_created', `Task created: ${task.title}`, actor, generatedAt, {taskId: task.id, priority: task.priority, dueAt: task.dueAt}),
  ], generatedAt);
}

export function updateBdTask(
  lead: Lead,
  taskId: string,
  input: UpdateBdTaskInput,
  actor: string,
  generatedAt = new Date().toISOString(),
): BdWorkflowSnapshot {
  const base = refreshBdWorkflow(lead, generatedAt, actor);
  const index = base.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error(`BD task not found: ${taskId}`);
  const previous = base.tasks[index]!;
  const dueAt = input.dueAt === undefined ? previous.dueAt : validOptionalDate(input.dueAt, 'dueAt');
  const task: BdTask = {
    ...previous,
    status: input.status,
    dueAt,
    owner: input.owner === undefined ? previous.owner : optionalText(input.owner, 160),
    note: input.note === undefined ? previous.note : optionalText(input.note, 1000),
    updatedAt: generatedAt,
    updatedBy: actor,
    completedAt: input.status === 'completed' ? generatedAt : undefined,
    completedBy: input.status === 'completed' ? actor : undefined,
  };
  const tasks = [...base.tasks];
  tasks[index] = task;
  const evidence = inspectLead(lead, generatedAt);
  const nextBestAction = recommendNextBestAction(lead, tasks, evidence, generatedAt);
  return finalizeSnapshot(base, tasks, nextBestAction, [
    event(lead.id, 'task_status_changed', `Task “${task.title}” changed from ${previous.status} to ${task.status}.`, actor, generatedAt, {
      taskId: task.id,
      previousStatus: previous.status,
      status: task.status,
    }),
  ], generatedAt);
}

export function recordBdPipelineEvent(
  lead: Lead,
  summary: string,
  actor: string,
  generatedAt = new Date().toISOString(),
): BdWorkflowSnapshot {
  const base = refreshBdWorkflow(lead, generatedAt, actor, requiredText(summary, 'summary', 600));
  return base;
}

export function bdWorkflowStateEqual(left: BdWorkflowSnapshot | undefined, right: BdWorkflowSnapshot): boolean {
  if (!left) return false;
  return JSON.stringify(stableSnapshot(left)) === JSON.stringify(stableSnapshot(right));
}

export function workflowQueueFacts(lead: Lead, generatedAt = new Date().toISOString()): {
  openTasks: number;
  overdueTasks: number;
  nextAction: NextBestAction;
  blocked: boolean;
} {
  const snapshot = refreshBdWorkflow(lead, generatedAt, 'bd-workflow-read');
  return {
    openTasks: snapshot.openTaskCount,
    overdueTasks: snapshot.overdueTaskCount,
    nextAction: snapshot.nextBestAction,
    blocked: snapshot.blocked,
  };
}

interface LeadEvidence {
  suppressed: boolean;
  suppressionReason?: string;
  duplicateContactLeadIds: string[];
  companyKnown: boolean;
  personKnown: boolean;
  roleKnown: boolean;
  contactRouteKnown: boolean;
  verifiedContactRoute: boolean;
  evidenceLinkKnown: boolean;
  campaignKnown: boolean;
  warmIntent: boolean;
  missing: string[];
  evidence: string[];
  risks: string[];
  prohibitedClaims: string[];
}

function inspectLead(lead: Lead, generatedAt: string): LeadEvidence {
  const raw = asRecord(lead.rawPayload);
  const enrichment = asRecord(raw.enrichment);
  const suppression = asRecord(enrichment.suppression);
  const identity = asRecord(raw.identityGraph);
  const routes = objectArray(enrichment.contactRoutes);
  const campaignMatches = objectArray(raw.campaignMatches);
  const primaryCampaign = asRecord(raw.primaryCampaignMatch);
  const duplicateContactLeadIds = stringArray(identity.duplicateContactLeadIds);
  const companyKnown = Boolean(lead.companyName?.trim() || lead.companyWebsite?.trim() || asRecord(asRecord(enrichment.company).domain).value);
  const personKnown = Boolean(lead.contactName?.trim() || lead.linkedinUrl?.trim());
  const roleKnown = Boolean(lead.contactRole?.trim());
  const contactRouteKnown = Boolean(
    lead.source === 'upwork'
      ? lead.sourceUrl
      : lead.contactEmail || lead.contactPhone || lead.contactFormUrl || lead.linkedinUrl || routes.some((route) => ['available', 'candidate', 'verified', 'platform_restricted'].includes(String(route.status ?? ''))),
  );
  const verifiedContactRoute = Boolean(
    routes.some((route) => route.status === 'verified')
      || asRecord(asRecord(enrichment.person).email).verificationStatus === 'verified',
  );
  const suppressed = raw.doNotContact === true || suppression.suppressed === true;
  const warmIntent = lead.prospectStage === 'warm_lead' || lead.opportunityStatus === 'live_opportunity' || lead.leadType === 'upwork_job' || lead.leadType === 'linkedin_warm_post';
  const missing: string[] = [];
  if (!companyKnown && lead.prospectStage !== 'warm_lead') missing.push('confirmed company identity');
  if (!personKnown && lead.source !== 'upwork') missing.push('decision-maker identity');
  if (!roleKnown && lead.prospectStage !== 'warm_lead') missing.push('decision-maker role');
  if (!contactRouteKnown) missing.push('permitted contact route');
  if (!lead.evidenceUrl && !lead.sourceUrl) missing.push('source evidence link');
  if (!lead.owner) missing.push('assigned owner');

  const evidence = [
    lead.sourceUrl ? `Source URL is available from ${lead.source}.` : '',
    lead.companyName ? `Company visible: ${lead.companyName}.` : '',
    lead.contactName ? `Contact visible: ${lead.contactName}${lead.contactRole ? `, ${lead.contactRole}` : ''}.` : '',
    verifiedContactRoute ? 'At least one contact route is marked verified.' : contactRouteKnown ? 'At least one candidate or platform route is available.' : '',
    lead.score ? `Qualification score: ${lead.score.total} (${lead.score.status}).` : '',
    campaignMatches.length > 0 || Object.keys(primaryCampaign).length > 0 ? 'An offer/campaign hypothesis is attached.' : '',
    warmIntent ? 'A warm-demand signal is present.' : 'This is a cold account or product-fit hypothesis.',
    generatedAt ? '' : '',
  ].filter(Boolean);
  const risks = [
    suppressed ? String(suppression.reason ?? raw.suppressionReason ?? 'Do-not-contact evidence is present.') : '',
    duplicateContactLeadIds.length > 0 ? `${duplicateContactLeadIds.length} possible duplicate-contact record(s) require coordination.` : '',
    lead.source === 'upwork' ? 'The live Upwork job must follow Upwork communication rules; no off-platform route may be inferred.' : '',
    !warmIntent ? 'No explicit buyer request is confirmed for this cold prospect.' : '',
    ...stringArray(asRecord(primaryCampaign).risks),
  ].filter(Boolean);
  const prohibitedClaims = unique([
    'Do not claim unverified client results, deployments, regulatory approval, savings or capacity.',
    'Do not describe a cold ICP match as confirmed buyer demand.',
    'Do not send or submit anything automatically.',
    ...(lead.source === 'upwork' ? ['Do not infer or use an off-platform route for the live Upwork job.'] : []),
    ...stringArray(asRecord(primaryCampaign).limitations),
  ]);
  return {
    suppressed,
    suppressionReason: optionalText(suppression.reason ?? raw.suppressionReason, 600),
    duplicateContactLeadIds,
    companyKnown,
    personKnown,
    roleKnown,
    contactRouteKnown,
    verifiedContactRoute,
    evidenceLinkKnown: Boolean(lead.evidenceUrl || lead.sourceUrl),
    campaignKnown: campaignMatches.length > 0 || Object.keys(primaryCampaign).length > 0,
    warmIntent,
    missing,
    evidence,
    risks,
    prohibitedClaims,
  };
}

function generatedTasksFor(lead: Lead, evidence: LeadEvidence, generatedAt: string, actor: string): BdTask[] {
  const tasks: BdTask[] = [];
  const add = (code: BdTaskCode, title: string, reason: string, priority: BdTaskPriority, channel: BdChannel, dueHours: number): void => {
    tasks.push(generatedTask(lead, code, title, reason, priority, channel, dueHours, generatedAt, actor));
  };
  if (TERMINAL_STATUSES.has(lead.pipelineStatus)) {
    if (lead.feedback?.status !== 'complete') add('capture_learning', 'Record outcome learning', 'Closed prospects require complete commercial feedback for source and campaign calibration.', 'normal', 'internal', 48);
    return tasks;
  }
  if (evidence.suppressed) {
    add('review_suppression', 'Confirm suppression and stop contact work', evidence.suppressionReason ?? 'Do-not-contact evidence blocks prospecting work.', 'critical', 'internal', 1);
    return tasks;
  }
  if (!lead.owner) add('assign_owner', 'Assign a BD owner', 'Every active prospect requires one accountable owner.', 'critical', 'internal', 4);
  if (evidence.duplicateContactLeadIds.length > 0) add('review_duplicate_contact', 'Coordinate duplicate-contact records', 'Review linked person/company records and select one coordinated owner and channel.', 'high', 'internal', 8);
  if (!evidence.companyKnown && lead.prospectStage !== 'warm_lead') add('confirm_company_identity', 'Confirm the company identity', 'A cold account cannot progress safely without a defensible company identity.', 'high', 'internal', 24);
  if ((!evidence.personKnown || !evidence.roleKnown) && lead.source !== 'upwork') add('confirm_decision_maker', 'Confirm the decision-maker and role', 'The intended buyer persona and authority must be verified before outreach.', 'high', 'internal', 24);
  if (!evidence.contactRouteKnown) add('verify_contact_route', 'Find a permitted contact route', 'No safe contact route is currently available.', 'high', 'internal', 24);
  if (['new', 'scored', 'needs_human_review'].includes(lead.pipelineStatus)) add('review_qualification', 'Review qualification and approve the next stage', 'A human must confirm evidence, fit, risk and route before contact preparation.', 'high', 'internal', 12);
  if (lead.pipelineStatus === 'approved_to_contact') add('prepare_outreach', 'Prepare human-reviewed outreach', 'The prospect is approved for contact but no manually approved send action is recorded.', 'high', preferredChannel(lead), 12);
  if (lead.pipelineStatus === 'draft_ready') add('prepare_outreach', 'Review, edit and manually send the draft', 'A draft is ready, but only a human may approve, copy and send it.', 'high', preferredChannel(lead), 8);
  if (lead.pipelineStatus === 'sent_manually' && !lead.nextFollowUpAt) add('schedule_follow_up', 'Schedule the next follow-up', 'Manually contacted prospects must have an explicit next follow-up or an on-hold decision.', 'high', preferredChannel(lead), 8);
  if (lead.pipelineStatus === 'replied') add('classify_reply', 'Classify the reply and prepare a response', 'The latest buyer response requires human interpretation and a reviewed next step.', 'critical', preferredChannel(lead), 4);
  if (lead.pipelineStatus === 'meeting_booked') add('prepare_meeting', 'Prepare the meeting brief', 'Confirm attendees, goals, discovery questions, proof and desired commitment before the meeting.', 'high', 'meeting', 12);
  if (lead.pipelineStatus === 'proposal_sent') add('follow_up_proposal', 'Track and follow up the proposal', 'A proposal is active and requires an explicit decision date, follow-up plan and risk review.', 'high', preferredChannel(lead), 24);
  return tasks;
}

function generatedTask(
  lead: Lead,
  code: BdTaskCode,
  title: string,
  reason: string,
  priority: BdTaskPriority,
  channel: BdChannel,
  dueHours: number,
  generatedAt: string,
  actor: string,
): BdTask {
  const id = `bd-generated-${shortHash(`${lead.id}:${code}`)}`;
  return {
    id,
    leadId: lead.id,
    code,
    title,
    reason,
    priority,
    status: 'open',
    channel,
    owner: lead.owner,
    dueAt: addHours(generatedAt, dueHours),
    createdAt: generatedAt,
    createdBy: actor,
    updatedAt: generatedAt,
    updatedBy: actor,
    generated: true,
    humanReviewRequired: true,
    externalActionPerformed: false,
  };
}

function mergeTasks(previous: BdTask[], generated: BdTask[]): BdTask[] {
  const map = new Map(previous.map((task) => [task.id, task]));
  for (const candidate of generated) {
    const existing = map.get(candidate.id);
    if (!existing) {
      map.set(candidate.id, candidate);
      continue;
    }
    if (!existing.generated) continue;
    const terminal = ['completed', 'dismissed', 'on_hold'].includes(existing.status);
    map.set(candidate.id, {
      ...candidate,
      status: terminal ? existing.status : existing.status,
      owner: existing.owner ?? candidate.owner,
      dueAt: existing.dueAt ?? candidate.dueAt,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: existing.updatedAt,
      updatedBy: existing.updatedBy,
      completedAt: existing.completedAt,
      completedBy: existing.completedBy,
      note: existing.note,
    });
  }
  return [...map.values()].sort(taskSort);
}

function recommendNextBestAction(
  lead: Lead,
  tasks: BdTask[],
  evidence: LeadEvidence,
  generatedAt: string,
): NextBestAction {
  const active = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).sort(taskSort);
  const selected = active.find((task) => task.dueAt && Date.parse(task.dueAt) <= Date.parse(generatedAt)) ?? active[0];
  if (selected) return actionFromTask(selected, evidence, generatedAt);
  if (TERMINAL_STATUSES.has(lead.pipelineStatus)) {
    return action('no_action', 'No active sales action', 'This prospect is closed. Retain the record and use complete feedback for calibration.', 'low', 'internal', generatedAt, evidence);
  }
  if (lead.nextFollowUpAt && CONTACTED_STATUSES.has(lead.pipelineStatus)) {
    const due = Date.parse(lead.nextFollowUpAt) <= Date.parse(generatedAt);
    return action(
      'schedule_follow_up',
      due ? 'Complete the scheduled follow-up' : 'Wait for the scheduled follow-up',
      due ? `The follow-up became due at ${lead.nextFollowUpAt}.` : `The next follow-up is scheduled for ${lead.nextFollowUpAt}.`,
      due ? 'high' : 'normal',
      preferredChannel(lead),
      generatedAt,
      evidence,
      lead.nextFollowUpAt,
    );
  }
  return action('review_qualification', 'Review evidence and choose the next stage', 'No open task exists, so a human should confirm whether to advance, hold, reject or create a specific task.', 'normal', 'internal', generatedAt, evidence);
}

function actionFromTask(task: BdTask, evidence: LeadEvidence, generatedAt: string): NextBestAction {
  return {
    code: task.code,
    title: task.title,
    reason: task.reason,
    priority: task.priority,
    channel: task.channel,
    dueAt: task.dueAt,
    taskId: task.id,
    evidence: evidence.evidence,
    missingEvidence: evidence.missing,
    risks: evidence.risks,
    prohibitedClaims: evidence.prohibitedClaims,
    generatedAt,
    humanReviewRequired: true,
    externalActionPerformed: false,
  };
}

function action(
  code: NextBestAction['code'],
  title: string,
  reason: string,
  priority: BdTaskPriority,
  channel: BdChannel,
  generatedAt: string,
  evidence: LeadEvidence,
  dueAt?: string,
): NextBestAction {
  return {
    code,
    title,
    reason,
    priority,
    channel,
    dueAt,
    evidence: evidence.evidence,
    missingEvidence: evidence.missing,
    risks: evidence.risks,
    prohibitedClaims: evidence.prohibitedClaims,
    generatedAt,
    humanReviewRequired: true,
    externalActionPerformed: false,
  };
}

function finalizeSnapshot(
  base: BdWorkflowSnapshot,
  tasks: BdTask[],
  nextBestAction: NextBestAction,
  newEvents: BdWorkflowEvent[],
  generatedAt: string,
): BdWorkflowSnapshot {
  const active = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  return {
    ...base,
    updatedAt: generatedAt,
    tasks: tasks.sort(taskSort),
    events: trimEvents([...base.events, ...newEvents]),
    nextBestAction,
    openTaskCount: active.length,
    overdueTaskCount: active.filter((task) => task.dueAt && Date.parse(task.dueAt) <= Date.parse(generatedAt)).length,
  };
}

function event(
  leadId: string,
  type: BdWorkflowEventType,
  summary: string,
  actor: string,
  occurredAt: string,
  metadata?: Record<string, unknown>,
): BdWorkflowEvent {
  return {
    id: `bd-event-${shortHash(`${leadId}:${type}:${summary}:${occurredAt}:${actor}`)}`,
    leadId,
    type,
    summary,
    actor,
    occurredAt,
    metadata,
    externalActionPerformed: false,
  };
}

function stableSnapshot(snapshot: BdWorkflowSnapshot): Record<string, unknown> {
  return {
    version: snapshot.version,
    leadId: snapshot.leadId,
    tasks: snapshot.tasks,
    nextBestAction: {
      ...snapshot.nextBestAction,
      generatedAt: null,
    },
    blocked: snapshot.blocked,
    blockedReason: snapshot.blockedReason ?? null,
  };
}

function sameNextAction(left: NextBestAction, right: NextBestAction): boolean {
  return JSON.stringify({...left, generatedAt: null}) === JSON.stringify({...right, generatedAt: null});
}

function taskSort(left: BdTask, right: BdTask): number {
  const statusRank: Record<BdTaskStatus, number> = {in_progress: 0, open: 1, on_hold: 2, completed: 3, dismissed: 4};
  const priorityRank: Record<BdTaskPriority, number> = {critical: 0, high: 1, normal: 2, low: 3};
  return statusRank[left.status] - statusRank[right.status]
    || priorityRank[left.priority] - priorityRank[right.priority]
    || Date.parse(left.dueAt ?? '9999-12-31') - Date.parse(right.dueAt ?? '9999-12-31')
    || left.createdAt.localeCompare(right.createdAt);
}

function preferredChannel(lead: Lead): BdChannel {
  if (lead.source === 'upwork') return 'upwork';
  if (lead.source === 'sales_navigator') return 'sales_navigator';
  if (lead.source === 'linkedin') return 'linkedin';
  if (lead.contactEmail) return 'email';
  if (lead.linkedinUrl) return 'linkedin';
  return 'internal';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim().slice(0, max);
}

function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function validOptionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date and time.`);
  return date.toISOString();
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();
}

function laterIso(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function trimEvents(events: BdWorkflowEvent[]): BdWorkflowEvent[] {
  const seen = new Set<string>();
  return events.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(-100);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
