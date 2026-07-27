import { createHash } from 'node:crypto';
import type { Lead } from '@sales-automation/shared';

export const OUTREACH_WORKBENCH_VERSION = 'outreach-workbench.v1';

export type OutreachChannel =
  | 'upwork_proposal'
  | 'linkedin_comment'
  | 'linkedin_dm'
  | 'sales_navigator_inmail'
  | 'email'
  | 'referral';

export type OutreachPlaybook = 'warm_response' | 'cold_direct_buyer' | 'channel_partner' | 'overflow_partner';
export type OutreachDraftStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'sent_manually';
export type OutreachVersionOrigin = 'generated' | 'human_edit';
export type OutreachOutcome = 'reply' | 'bounce' | 'no_response' | 'meeting' | 'proposal' | 'opt_out';
export type OutreachSequenceStatus = 'planned' | 'active' | 'paused' | 'completed' | 'stopped';

export interface OutreachSeedDraft {
  channel: OutreachChannel;
  subject?: string;
  body: string;
  proofIds?: string[];
  assumptions?: string[];
  safeguards?: string[];
}

export interface OutreachProof {
  id: string;
  label: string;
  approved: boolean;
  sourceUrl?: string;
}

export interface OutreachVersion {
  id: string;
  number: number;
  origin: OutreachVersionOrigin;
  parentVersionId?: string;
  subject?: string;
  body: string;
  proofIds: string[];
  assumptions: string[];
  safeguards: string[];
  createdAt: string;
  createdBy: string;
  humanReviewRequired: true;
  systemExternalActionPerformed: false;
}

export interface OutreachApproval {
  versionId: string;
  approvedAt: string;
  approvedBy: string;
  managerApproval: boolean;
  note?: string;
}

export interface OutreachCopyRecord {
  id: string;
  versionId: string;
  copiedAt: string;
  copiedBy: string;
  systemExternalActionPerformed: false;
}

export interface OutreachSentRecord {
  id: string;
  approvedVersionId: string;
  channel: OutreachChannel;
  subject?: string;
  body: string;
  sender: string;
  sentAt: string;
  recordedAt: string;
  recordedBy: string;
  followUpAt?: string;
  differedFromApproved: boolean;
  manualExternalActionConfirmed: true;
  systemExternalActionPerformed: false;
}

export interface OutreachOutcomeRecord {
  id: string;
  outcome: OutreachOutcome;
  note: string;
  occurredAt: string;
  recordedAt: string;
  recordedBy: string;
}

export interface OutreachDraft {
  id: string;
  leadId: string;
  channel: OutreachChannel;
  playbook: OutreachPlaybook;
  status: OutreachDraftStatus;
  versions: OutreachVersion[];
  currentVersionId: string;
  approvedVersionId?: string;
  approval?: OutreachApproval;
  copyHistory: OutreachCopyRecord[];
  sentHistory: OutreachSentRecord[];
  outcomes: OutreachOutcomeRecord[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  managerApprovalRequired: boolean;
  humanReviewRequired: true;
  systemExternalActionPerformed: false;
}

export interface OutreachSequenceStep {
  id: string;
  order: number;
  offsetDays: number;
  channel: OutreachChannel;
  instruction: string;
  internalTaskOnly: true;
}

export interface OutreachSequencePlan {
  status: OutreachSequenceStatus;
  stopOnReply: true;
  maxTouches: number;
  steps: OutreachSequenceStep[];
}

export interface OutreachEvent {
  id: string;
  type:
    | 'workbench_created'
    | 'workbench_refreshed'
    | 'draft_created'
    | 'draft_edited'
    | 'submitted_for_review'
    | 'approved'
    | 'rejected'
    | 'copied'
    | 'manual_send_recorded'
    | 'outcome_recorded'
    | 'sequence_status_changed';
  summary: string;
  actor: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
  systemExternalActionPerformed: false;
}

export interface OutreachWorkbenchSnapshot {
  version: typeof OUTREACH_WORKBENCH_VERSION;
  leadId: string;
  generatedAt: string;
  updatedAt: string;
  playbook: OutreachPlaybook;
  allowedChannels: OutreachChannel[];
  recommendedChannel: OutreachChannel;
  channelReason: string;
  blocked: boolean;
  blockingReasons: string[];
  warnings: string[];
  duplicateContactLeadIds: string[];
  managerApprovalRequired: boolean;
  approvedProof: OutreachProof[];
  drafts: OutreachDraft[];
  sequencePlan: OutreachSequencePlan;
  events: OutreachEvent[];
  humanReviewRequired: true;
  systemExternalActionPerformed: false;
}

export interface InitializeOutreachWorkbenchInput {
  lead: Lead;
  seedDrafts?: OutreachSeedDraft[];
  approvedProof?: OutreachProof[];
  actor: string;
  generatedAt?: string;
}

export interface EditOutreachDraftInput {
  subject?: string;
  body: string;
  proofIds?: string[];
  note?: string;
}

export interface OutreachApprovalContext {
  actor: string;
  canManagerApprove: boolean;
  note?: string;
  generatedAt?: string;
}

export interface RecordManualSendInput {
  actor: string;
  sender: string;
  subject?: string;
  body: string;
  sentAt: string;
  followUpAt?: string;
  manualConfirmation: boolean;
  generatedAt?: string;
}

export function readOutreachWorkbench(lead: Lead): OutreachWorkbenchSnapshot | undefined {
  const raw = asRecord(lead.rawPayload);
  const value = raw.outreachWorkbench;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const snapshot = value as Partial<OutreachWorkbenchSnapshot>;
  if (snapshot.version !== OUTREACH_WORKBENCH_VERSION || snapshot.leadId !== lead.id || !Array.isArray(snapshot.drafts)) return undefined;
  return snapshot as OutreachWorkbenchSnapshot;
}

export function attachOutreachWorkbench(lead: Lead, snapshot: OutreachWorkbenchSnapshot): Lead {
  const currentDraft = snapshot.drafts.find((draft) => draft.channel === snapshot.recommendedChannel) ?? snapshot.drafts[0];
  const currentVersion = currentDraft ? versionById(currentDraft, currentDraft.currentVersionId) : undefined;
  return {
    ...lead,
    draftMessage: currentVersion?.body ?? lead.draftMessage,
    rawPayload: {
      ...asRecord(lead.rawPayload),
      outreachWorkbenchVersion: OUTREACH_WORKBENCH_VERSION,
      outreachWorkbench: snapshot,
    },
    updatedAt: laterIso(lead.updatedAt, snapshot.updatedAt),
  };
}

export function initializeOutreachWorkbench(input: InitializeOutreachWorkbenchInput): OutreachWorkbenchSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const previous = readOutreachWorkbench(input.lead);
  const safety = inspectSafety(input.lead);
  const playbook = choosePlaybook(input.lead);
  const allowedChannels = allowedChannelsFor(input.lead);
  const recommendedChannel = recommendChannel(input.lead, allowedChannels);
  const channelReason = channelReasonFor(input.lead, recommendedChannel);
  const managerApprovalRequired = managerApprovalRequiredFor(input.lead);
  const approvedProof = uniqueProof(input.approvedProof ?? previous?.approvedProof ?? []);
  const seedDrafts = mergeSeedDrafts(
    input.lead,
    allowedChannels,
    input.seedDrafts ?? [],
    approvedProof,
  );
  const drafts = mergeDrafts(previous?.drafts ?? [], seedDrafts, input.lead, playbook, managerApprovalRequired, input.actor, generatedAt);
  const events = [...(previous?.events ?? [])];
  events.push(event(
    previous ? 'workbench_refreshed' : 'workbench_created',
    previous ? 'Outreach workbench refreshed from current evidence and route restrictions.' : 'Outreach workbench created for human-controlled preparation.',
    input.actor,
    generatedAt,
    {recommendedChannel, allowedChannels},
  ));
  return {
    version: OUTREACH_WORKBENCH_VERSION,
    leadId: input.lead.id,
    generatedAt: previous?.generatedAt ?? generatedAt,
    updatedAt: generatedAt,
    playbook,
    allowedChannels,
    recommendedChannel,
    channelReason,
    blocked: safety.blockingReasons.length > 0,
    blockingReasons: safety.blockingReasons,
    warnings: safety.warnings,
    duplicateContactLeadIds: safety.duplicateContactLeadIds,
    managerApprovalRequired,
    approvedProof,
    drafts,
    sequencePlan: previous?.sequencePlan ?? sequencePlanFor(playbook, recommendedChannel),
    events: trimEvents(events),
    humanReviewRequired: true,
    systemExternalActionPerformed: false,
  };
}

export function editOutreachDraft(
  snapshot: OutreachWorkbenchSnapshot,
  draftId: string,
  input: EditOutreachDraftInput,
  actor: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  const draft = requireDraft(snapshot, draftId);
  const parent = versionById(draft, draft.currentVersionId);
  const body = requiredText(input.body, 'body', 12000);
  const subject = optionalText(input.subject, 300);
  const proofIds = uniqueStrings(input.proofIds ?? parent.proofIds).filter((id) => snapshot.approvedProof.some((proof) => proof.id === id && proof.approved));
  const version = createVersion(draft, {
    origin: 'human_edit',
    parentVersionId: parent.id,
    subject,
    body,
    proofIds,
    assumptions: parent.assumptions,
    safeguards: uniqueStrings([...parent.safeguards, input.note ? `Editor note: ${input.note}` : '']),
    actor,
    generatedAt,
  });
  const updated = {
    ...draft,
    status: 'draft' as const,
    versions: [...draft.versions, version],
    currentVersionId: version.id,
    updatedAt: generatedAt,
    updatedBy: actor,
  };
  return replaceDraft(snapshot, updated, event('draft_edited', `Draft edited for ${labelChannel(draft.channel)}.`, actor, generatedAt, {draftId, versionId: version.id}));
}

export function submitOutreachForReview(
  snapshot: OutreachWorkbenchSnapshot,
  draftId: string,
  actor: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  const draft = requireDraft(snapshot, draftId);
  ensureDraftBody(draft);
  const updated = {...draft, status: 'in_review' as const, updatedAt: generatedAt, updatedBy: actor};
  return replaceDraft(snapshot, updated, event('submitted_for_review', `Draft submitted for review: ${labelChannel(draft.channel)}.`, actor, generatedAt, {draftId, versionId: draft.currentVersionId}));
}

export function approveOutreachDraft(
  snapshot: OutreachWorkbenchSnapshot,
  draftId: string,
  context: OutreachApprovalContext,
): OutreachWorkbenchSnapshot {
  const generatedAt = context.generatedAt ?? new Date().toISOString();
  enforceSafeAction(snapshot, 'approve');
  const draft = requireDraft(snapshot, draftId);
  ensureDraftBody(draft);
  if (draft.managerApprovalRequired && !context.canManagerApprove) throw new Error('Manager approval is required for this outreach.');
  const current = versionById(draft, draft.currentVersionId);
  const approval: OutreachApproval = {
    versionId: current.id,
    approvedAt: generatedAt,
    approvedBy: context.actor,
    managerApproval: context.canManagerApprove,
    note: optionalText(context.note, 1000),
  };
  const updated = {
    ...draft,
    status: 'approved' as const,
    approvedVersionId: current.id,
    approval,
    updatedAt: generatedAt,
    updatedBy: context.actor,
  };
  return replaceDraft(snapshot, updated, event('approved', `Approved exact ${labelChannel(draft.channel)} version ${current.number}.`, context.actor, generatedAt, {draftId, versionId: current.id, managerApproval: approval.managerApproval}));
}

export function rejectOutreachDraft(
  snapshot: OutreachWorkbenchSnapshot,
  draftId: string,
  reason: string,
  actor: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  const draft = requireDraft(snapshot, draftId);
  const updated = {...draft, status: 'rejected' as const, updatedAt: generatedAt, updatedBy: actor};
  return replaceDraft(snapshot, updated, event('rejected', `Draft rejected: ${requiredText(reason, 'reason', 1000)}`, actor, generatedAt, {draftId, versionId: draft.currentVersionId}));
}

export function recordOutreachCopy(
  snapshot: OutreachWorkbenchSnapshot,
  draftId: string,
  actor: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  enforceSafeAction(snapshot, 'copy');
  const draft = requireDraft(snapshot, draftId);
  if (!draft.approvedVersionId || draft.status !== 'approved') throw new Error('Only an approved outreach version may be copied.');
  const copy: OutreachCopyRecord = {
    id: `outreach-copy-${shortHash(`${draft.id}:${draft.approvedVersionId}:${actor}:${generatedAt}`)}`,
    versionId: draft.approvedVersionId,
    copiedAt: generatedAt,
    copiedBy: actor,
    systemExternalActionPerformed: false,
  };
  const updated = {...draft, copyHistory: [...draft.copyHistory, copy], updatedAt: generatedAt, updatedBy: actor};
  return replaceDraft(snapshot, updated, event('copied', `Approved ${labelChannel(draft.channel)} version copied for manual use.`, actor, generatedAt, {draftId, versionId: copy.versionId}));
}

export function recordManualOutreachSend(
  snapshot: OutreachWorkbenchSnapshot,
  draftId: string,
  input: RecordManualSendInput,
): OutreachWorkbenchSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  enforceSafeAction(snapshot, 'mark sent');
  if (!input.manualConfirmation) throw new Error('Manual send confirmation is required.');
  const draft = requireDraft(snapshot, draftId);
  if (!draft.approvedVersionId || !draft.approval) throw new Error('Approve an exact outreach version before recording a manual send.');
  const approved = versionById(draft, draft.approvedVersionId);
  const body = requiredText(input.body, 'body', 12000);
  const sentAt = validDate(input.sentAt, 'sentAt');
  const followUpAt = input.followUpAt ? validDate(input.followUpAt, 'followUpAt') : undefined;
  const sent: OutreachSentRecord = {
    id: `outreach-sent-${shortHash(`${draft.id}:${approved.id}:${input.sender}:${sentAt}:${generatedAt}`)}`,
    approvedVersionId: approved.id,
    channel: draft.channel,
    subject: optionalText(input.subject, 300),
    body,
    sender: requiredText(input.sender, 'sender', 200),
    sentAt,
    recordedAt: generatedAt,
    recordedBy: input.actor,
    followUpAt,
    differedFromApproved: normalizeText(body) !== normalizeText(approved.body) || normalizeText(input.subject ?? '') !== normalizeText(approved.subject ?? ''),
    manualExternalActionConfirmed: true,
    systemExternalActionPerformed: false,
  };
  const updated = {
    ...draft,
    status: 'sent_manually' as const,
    sentHistory: [...draft.sentHistory, sent],
    updatedAt: generatedAt,
    updatedBy: input.actor,
  };
  const plan = {...snapshot.sequencePlan, status: 'active' as const};
  return replaceDraft(snapshot, updated, event('manual_send_recorded', `Manual ${labelChannel(draft.channel)} send recorded. The system did not send it.`, input.actor, generatedAt, {draftId, approvedVersionId: approved.id, sentRecordId: sent.id, differedFromApproved: sent.differedFromApproved}), plan);
}

export function recordOutreachOutcome(
  snapshot: OutreachWorkbenchSnapshot,
  draftId: string,
  outcome: OutreachOutcome,
  note: string,
  actor: string,
  occurredAt: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  const draft = requireDraft(snapshot, draftId);
  const record: OutreachOutcomeRecord = {
    id: `outreach-outcome-${shortHash(`${draft.id}:${outcome}:${occurredAt}:${actor}`)}`,
    outcome,
    note: requiredText(note, 'note', 2000),
    occurredAt: validDate(occurredAt, 'occurredAt'),
    recordedAt: generatedAt,
    recordedBy: actor,
  };
  const updated = {...draft, outcomes: [...draft.outcomes, record], updatedAt: generatedAt, updatedBy: actor};
  const stop = outcome === 'reply' || outcome === 'opt_out' || outcome === 'meeting' || outcome === 'proposal';
  const sequencePlan = stop ? {...snapshot.sequencePlan, status: 'stopped' as const} : snapshot.sequencePlan;
  return replaceDraft(snapshot, updated, event('outcome_recorded', `Outreach outcome recorded: ${outcome}.`, actor, generatedAt, {draftId, outcome, outcomeRecordId: record.id}), sequencePlan);
}

export function changeSequenceStatus(
  snapshot: OutreachWorkbenchSnapshot,
  status: OutreachSequenceStatus,
  actor: string,
  generatedAt = new Date().toISOString(),
): OutreachWorkbenchSnapshot {
  return {
    ...snapshot,
    updatedAt: generatedAt,
    sequencePlan: {...snapshot.sequencePlan, status},
    events: trimEvents([...snapshot.events, event('sequence_status_changed', `Outreach sequence changed to ${status}.`, actor, generatedAt)]),
  };
}

export function currentOutreachVersion(draft: OutreachDraft): OutreachVersion {
  return versionById(draft, draft.currentVersionId);
}

export function approvedOutreachVersion(draft: OutreachDraft): OutreachVersion | undefined {
  return draft.approvedVersionId ? versionById(draft, draft.approvedVersionId) : undefined;
}

function mergeDrafts(
  previous: OutreachDraft[],
  seeds: OutreachSeedDraft[],
  lead: Lead,
  playbook: OutreachPlaybook,
  managerApprovalRequired: boolean,
  actor: string,
  generatedAt: string,
): OutreachDraft[] {
  const map = new Map(previous.map((draft) => [draft.channel, draft]));
  for (const seed of seeds) {
    if (map.has(seed.channel)) continue;
    const id = `outreach-draft-${shortHash(`${lead.id}:${seed.channel}`)}`;
    const draftBase = {
      id,
      leadId: lead.id,
      channel: seed.channel,
      playbook,
      managerApprovalRequired,
      createdAt: generatedAt,
      createdBy: actor,
    };
    const version = createVersion(draftBase, {
      origin: 'generated',
      subject: optionalText(seed.subject, 300),
      body: requiredText(seed.body, 'body', 12000),
      proofIds: uniqueStrings(seed.proofIds ?? []),
      assumptions: uniqueStrings(seed.assumptions ?? []),
      safeguards: uniqueStrings([
        ...(seed.safeguards ?? []),
        'Human review is required before any external use.',
        'No message, proposal, connection request, InMail or email is sent by this workbench.',
      ]),
      actor,
      generatedAt,
    });
    map.set(seed.channel, {
      ...draftBase,
      status: 'draft',
      versions: [version],
      currentVersionId: version.id,
      copyHistory: [],
      sentHistory: [],
      outcomes: [],
      updatedAt: generatedAt,
      updatedBy: actor,
      humanReviewRequired: true,
      systemExternalActionPerformed: false,
    });
  }
  return [...map.values()].sort((a, b) => channelOrder(a.channel) - channelOrder(b.channel));
}

function mergeSeedDrafts(lead: Lead, channels: OutreachChannel[], supplied: OutreachSeedDraft[], proof: OutreachProof[]): OutreachSeedDraft[] {
  const map = new Map<OutreachChannel, OutreachSeedDraft>();
  for (const seed of supplied) if (channels.includes(seed.channel) && seed.body.trim()) map.set(seed.channel, seed);
  for (const channel of channels) if (!map.has(channel)) map.set(channel, generatedSeed(lead, channel, proof));
  return [...map.values()];
}

function generatedSeed(lead: Lead, channel: OutreachChannel, proof: OutreachProof[]): OutreachSeedDraft {
  const name = lead.contactName?.trim() || 'there';
  const company = lead.companyName?.trim() || 'your team';
  const need = shorten(lead.evidenceSummary || lead.description || lead.title, 280);
  const proofItem = proof.find((item) => item.approved);
  const proofLine = proofItem ? `A relevant approved example is ${proofItem.label}.` : 'We can share the closest approved proof after confirming the requirement.';
  const assumptions = ['The source evidence and contact route must be rechecked before external use.'];
  const safeguards = ['Do not add unsupported results, savings, deployments, certifications or client names.'];
  if (channel === 'upwork_proposal') return {channel, body: `Hi, I reviewed your requirement around ${lead.title.toLowerCase()}. The visible need appears to be ${need}\n\n${proofLine}\n\nA practical first step would be to confirm scope, dependencies, success criteria and the smallest useful milestone. I can then outline a delivery plan and realistic timeline.`, proofIds: proofItem ? [proofItem.id] : [], assumptions, safeguards};
  if (channel === 'linkedin_comment') return {channel, body: `This looks like a practical ${friendlyService(lead)} requirement. A strong first step is to define one measurable outcome, validate the inputs and then expand from a focused pilot.`, proofIds: [], assumptions, safeguards};
  if (channel === 'linkedin_dm') return {channel, body: `Hi ${name}, I saw the requirement around ${lead.title.toLowerCase()}. ${proofLine}\n\nA focused discovery around scope, success criteria and the smallest useful milestone may be helpful. Happy to share a practical approach if relevant.`, proofIds: proofItem ? [proofItem.id] : [], assumptions, safeguards};
  if (channel === 'sales_navigator_inmail') return {channel, subject: `Potential fit for ${company}`, body: `Hi ${name}, I noticed ${company} may have a need around ${need}\n\n${proofLine}\n\nWould a short comparison of the requirement, delivery model and first milestone be useful?`, proofIds: proofItem ? [proofItem.id] : [], assumptions, safeguards};
  if (channel === 'email') return {channel, subject: `Regarding ${lead.title}`, body: `Hi ${name},\n\nI am reaching out from Codistan regarding ${need}\n\n${proofLine}\n\nA practical first step could be a short discovery to confirm scope, success criteria and a defined pilot. Would that be useful?`, proofIds: proofItem ? [proofItem.id] : [], assumptions, safeguards};
  return {channel, subject: `Possible introduction to ${company}`, body: `Hi, would you be comfortable introducing us to the relevant person at ${company}? The reason is the visible need around ${need}. We would keep the first conversation focused and avoid making assumptions about scope or budget.`, proofIds: [], assumptions, safeguards};
}

function inspectSafety(lead: Lead): {blockingReasons: string[]; warnings: string[]; duplicateContactLeadIds: string[]} {
  const raw = asRecord(lead.rawPayload);
  const enrichment = asRecord(raw.enrichment);
  const suppression = asRecord(enrichment.suppression);
  const identity = asRecord(raw.identityGraph);
  const duplicateContactLeadIds = stringArray(identity.duplicateContactLeadIds);
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  if (raw.doNotContact === true || suppression.suppressed === true) blockingReasons.push(String(suppression.reason ?? raw.suppressionReason ?? 'Do-not-contact or suppression evidence is present.'));
  if (duplicateContactLeadIds.length > 0 && raw.outreachContactClearance !== 'cleared') blockingReasons.push('Possible duplicate contact history must be resolved before approval, copy or send recording.');
  if (!lead.owner) blockingReasons.push('Assign an owner before approving outreach.');
  if (!lead.evidenceUrl && !lead.sourceUrl) blockingReasons.push('Source evidence is missing.');
  if (lead.source !== 'upwork' && !lead.contactEmail && !lead.linkedinUrl && !lead.contactFormUrl && !/referral|introduction/i.test(lead.reachMethod ?? '')) blockingReasons.push('No permitted contact route is recorded.');
  if (lead.source === 'upwork') warnings.push('The live job must remain on Upwork. Do not infer or use an off-platform route.');
  if (lead.prospectStage === 'cold_prospect' || lead.prospectStage === 'partner_prospect') warnings.push('This is a cold hypothesis, not confirmed buyer demand.');
  if (!lead.contactName && lead.source !== 'upwork') warnings.push('Contact name is missing; personalize before external use.');
  return {blockingReasons: uniqueStrings(blockingReasons), warnings: uniqueStrings(warnings), duplicateContactLeadIds};
}

function allowedChannelsFor(lead: Lead): OutreachChannel[] {
  if (lead.leadType === 'upwork_job' || lead.source === 'upwork') return ['upwork_proposal'];
  const channels: OutreachChannel[] = [];
  if (lead.leadType === 'linkedin_warm_post') channels.push('linkedin_comment');
  if (lead.source === 'sales_navigator' || lead.leadType === 'sales_navigator_cold_prospect' || lead.leadType === 'linkedin_sales_nav_alert') channels.push('sales_navigator_inmail');
  if (lead.linkedinUrl || lead.source === 'linkedin') channels.push('linkedin_dm');
  if (lead.contactEmail) channels.push('email');
  if (/referral|introduction|introduc/i.test(lead.reachMethod ?? '') || lead.source === 'partner_research') channels.push('referral');
  return uniqueStrings(channels) as OutreachChannel[] || ['linkedin_dm'];
}

function recommendChannel(lead: Lead, channels: OutreachChannel[]): OutreachChannel {
  if (channels.includes('upwork_proposal')) return 'upwork_proposal';
  if (lead.leadType === 'linkedin_warm_post' && channels.includes('linkedin_comment')) return 'linkedin_comment';
  if (lead.source === 'sales_navigator' && channels.includes('sales_navigator_inmail')) return 'sales_navigator_inmail';
  if (lead.contactEmail && channels.includes('email')) return 'email';
  if (channels.includes('linkedin_dm')) return 'linkedin_dm';
  return channels[0] ?? 'linkedin_dm';
}

function channelReasonFor(lead: Lead, channel: OutreachChannel): string {
  if (channel === 'upwork_proposal') return 'The opportunity originated on Upwork, so the permitted first-touch route remains the Upwork proposal interface.';
  if (channel === 'linkedin_comment') return 'A public buyer-authored LinkedIn requirement supports a concise, relevant public response before any private follow-up.';
  if (channel === 'sales_navigator_inmail') return 'The prospect was sourced through Sales Navigator and the InMail route is visible for human use.';
  if (channel === 'email') return 'A business email is recorded and should be manually re-verified before use.';
  if (channel === 'referral') return 'The retained route is an introduction rather than direct unsolicited contact.';
  return 'LinkedIn is the strongest retained route for this prospect, subject to manual verification.';
}

function choosePlaybook(lead: Lead): OutreachPlaybook {
  if (lead.leadType === 'upwork_job' || lead.leadType === 'linkedin_warm_post' || lead.opportunityStatus === 'live_opportunity') return 'warm_response';
  const text = `${lead.leadType} ${lead.serviceOffer ?? ''} ${lead.description}`.toLowerCase();
  if (/overflow|white[- ]label|subcontract/.test(text)) return 'overflow_partner';
  if (/partner|agency|studio|consultancy|channel/.test(text) || lead.prospectStage === 'partner_prospect') return 'channel_partner';
  return 'cold_direct_buyer';
}

function managerApprovalRequiredFor(lead: Lead): boolean {
  const raw = asRecord(lead.rawPayload);
  return raw.outreachManagerApprovalRequired === true || raw.outreachApprovalPolicy === 'manager_required';
}

function sequencePlanFor(playbook: OutreachPlaybook, channel: OutreachChannel): OutreachSequencePlan {
  const offsets = playbook === 'warm_response' ? [0, 3, 7] : [0, 5, 12];
  const instructions = playbook === 'warm_response'
    ? ['Prepare and manually send the approved first response.', 'Create an internal follow-up task only if no reply is recorded.', 'Close or move to nurture after a final human-reviewed follow-up.']
    : ['Prepare and manually send the approved first touch.', 'Review new evidence before a second touch.', 'Stop after the final bounded follow-up unless a reply or stronger signal appears.'];
  return {
    status: 'planned',
    stopOnReply: true,
    maxTouches: 3,
    steps: offsets.map((offsetDays, index) => ({
      id: `outreach-sequence-${index + 1}`,
      order: index + 1,
      offsetDays,
      channel,
      instruction: instructions[index]!,
      internalTaskOnly: true,
    })),
  };
}

function enforceSafeAction(snapshot: OutreachWorkbenchSnapshot, actionName: string): void {
  if (snapshot.blocked) throw new Error(`Cannot ${actionName}: ${snapshot.blockingReasons.join(' ')}`);
}

function replaceDraft(snapshot: OutreachWorkbenchSnapshot, draft: OutreachDraft, nextEvent: OutreachEvent, sequencePlan = snapshot.sequencePlan): OutreachWorkbenchSnapshot {
  return {
    ...snapshot,
    updatedAt: nextEvent.occurredAt,
    drafts: snapshot.drafts.map((item) => item.id === draft.id ? draft : item),
    sequencePlan,
    events: trimEvents([...snapshot.events, nextEvent]),
  };
}

function requireDraft(snapshot: OutreachWorkbenchSnapshot, draftId: string): OutreachDraft {
  const draft = snapshot.drafts.find((item) => item.id === draftId);
  if (!draft) throw new Error(`Outreach draft not found: ${draftId}`);
  return draft;
}

function versionById(draft: Pick<OutreachDraft, 'versions'>, versionId: string): OutreachVersion {
  const version = draft.versions.find((item) => item.id === versionId);
  if (!version) throw new Error(`Outreach version not found: ${versionId}`);
  return version;
}

function createVersion(
  draft: Pick<OutreachDraft, 'id'>,
  input: {
    origin: OutreachVersionOrigin;
    parentVersionId?: string;
    subject?: string;
    body: string;
    proofIds: string[];
    assumptions: string[];
    safeguards: string[];
    actor: string;
    generatedAt: string;
  },
): OutreachVersion {
  const number = 'versions' in draft && Array.isArray((draft as OutreachDraft).versions) ? (draft as OutreachDraft).versions.length + 1 : 1;
  return {
    id: `outreach-version-${shortHash(`${draft.id}:${number}:${input.actor}:${input.generatedAt}:${input.body}`)}`,
    number,
    origin: input.origin,
    parentVersionId: input.parentVersionId,
    subject: input.subject,
    body: input.body,
    proofIds: uniqueStrings(input.proofIds),
    assumptions: uniqueStrings(input.assumptions),
    safeguards: uniqueStrings(input.safeguards),
    createdAt: input.generatedAt,
    createdBy: input.actor,
    humanReviewRequired: true,
    systemExternalActionPerformed: false,
  };
}

function ensureDraftBody(draft: OutreachDraft): void {
  requiredText(versionById(draft, draft.currentVersionId).body, 'body', 12000);
}

function uniqueProof(items: OutreachProof[]): OutreachProof[] {
  const map = new Map<string, OutreachProof>();
  for (const item of items) if (item?.id && item.label && item.approved) map.set(item.id, {...item, approved: true});
  return [...map.values()];
}

function event(type: OutreachEvent['type'], summary: string, actor: string, occurredAt: string, metadata?: Record<string, unknown>): OutreachEvent {
  return {
    id: `outreach-event-${shortHash(`${type}:${summary}:${actor}:${occurredAt}`)}`,
    type,
    summary,
    actor,
    occurredAt,
    metadata,
    systemExternalActionPerformed: false,
  };
}

function trimEvents(events: OutreachEvent[]): OutreachEvent[] { return events.slice(-200); }
function channelOrder(channel: OutreachChannel): number { return ['upwork_proposal', 'linkedin_comment', 'linkedin_dm', 'sales_navigator_inmail', 'email', 'referral'].indexOf(channel); }
function labelChannel(channel: OutreachChannel): string { return channel.replaceAll('_', ' '); }
function friendlyService(lead: Lead): string { return lead.serviceCategory.replaceAll('_', ' '); }
function normalizeText(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function shorten(value: string, limit: number): string { const text = normalizeText(value); return text.length > limit ? `${text.slice(0, limit - 3)}...` : text; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []; }
function uniqueStrings(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function requiredText(value: unknown, field: string, max: number): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`); const text = value.trim(); if (text.length > max) throw new Error(`${field} must contain at most ${max} characters.`); return text; }
function optionalText(value: unknown, max: number): string | undefined { if (value === undefined || value === null || value === '') return undefined; const text = String(value).trim(); if (!text) return undefined; if (text.length > max) throw new Error(`Value must contain at most ${max} characters.`); return text; }
function validDate(value: unknown, field: string): string { const text = requiredText(value, field, 100); const date = new Date(text); if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date and time.`); return date.toISOString(); }
function laterIso(left: string, right: string): string { return Date.parse(right) >= Date.parse(left) ? right : left; }
function shortHash(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 20); }
