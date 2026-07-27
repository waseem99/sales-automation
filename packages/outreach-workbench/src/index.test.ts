import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import {
  approveOutreachDraft,
  attachOutreachWorkbench,
  changeSequenceStatus,
  currentOutreachVersion,
  editOutreachDraft,
  initializeOutreachWorkbench,
  readOutreachWorkbench,
  recordManualOutreachSend,
  recordOutreachCopy,
  recordOutreachOutcome,
  rejectOutreachDraft,
  submitOutreachForReview,
} from './index.js';

const now = '2026-07-27T06:00:00.000Z';

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'linkedin',
    sourceUrl: `https://www.linkedin.com/posts/${id}`,
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    title: 'Need a software delivery partner',
    description: 'The buyer is looking for a software and AI delivery partner.',
    companyName: 'Example Company',
    companyWebsite: 'https://example.com',
    contactName: 'Ayesha Khan',
    contactRole: 'CTO',
    linkedinUrl: 'https://www.linkedin.com/in/ayesha-khan/',
    serviceCategory: 'fullstack_web_app',
    opportunityStatus: 'live_opportunity',
    evidenceSummary: 'The original buyer-authored post requests a delivery partner.',
    capturedAt: now,
    owner: 'Talha Bashir',
    pipelineStatus: 'approved_to_contact',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

{
  const snapshot = initializeOutreachWorkbench({
    lead: lead('linkedin-warm'),
    actor: 'talha.bashir@codistan.org',
    generatedAt: now,
    approvedProof: [{id: 'proof-1', label: 'Approved delivery portal case study', approved: true}],
  });
  assert.equal(snapshot.recommendedChannel, 'linkedin_comment');
  assert(snapshot.allowedChannels.includes('linkedin_dm'));
  assert(snapshot.drafts.some((draft) => draft.channel === 'linkedin_comment'));
  assert(snapshot.drafts.every((draft) => draft.systemExternalActionPerformed === false));
  assert.equal(snapshot.sequencePlan.maxTouches, 3);
}

{
  const snapshot = initializeOutreachWorkbench({
    lead: lead('upwork', {
      source: 'upwork',
      leadType: 'upwork_job',
      prospectStage: 'warm_lead',
      linkedinUrl: undefined,
      contactName: undefined,
      companyWebsite: undefined,
    }),
    actor: 'waseem@codistan.org',
    generatedAt: now,
  });
  assert.deepEqual(snapshot.allowedChannels, ['upwork_proposal']);
  assert.equal(snapshot.recommendedChannel, 'upwork_proposal');
  assert(snapshot.warnings.some((warning) => /remain on Upwork/i.test(warning)));
}

{
  const snapshot = initializeOutreachWorkbench({
    lead: lead('email', {source: 'public_web', leadType: 'solution_led_prospect', prospectStage: 'cold_prospect', contactEmail: 'ayesha@example.com'}),
    actor: 'talha.bashir@codistan.org',
    generatedAt: now,
  });
  assert(snapshot.allowedChannels.includes('email'));
  assert.equal(snapshot.recommendedChannel, 'email');
  assert(snapshot.warnings.some((warning) => /cold hypothesis/i.test(warning)));
}

{
  const input = lead('lifecycle', {contactEmail: 'ayesha@example.com'});
  let snapshot = initializeOutreachWorkbench({lead: input, actor: 'talha.bashir@codistan.org', generatedAt: now});
  const draft = snapshot.drafts.find((item) => item.channel === snapshot.recommendedChannel)!;
  const original = currentOutreachVersion(draft);
  snapshot = editOutreachDraft(snapshot, draft.id, {
    body: `${original.body}\n\nWould Tuesday or Wednesday work for a brief call?`,
    subject: original.subject,
    note: 'Added a specific human-reviewed CTA.',
  }, 'talha.bashir@codistan.org', '2026-07-27T06:10:00.000Z');
  const edited = snapshot.drafts.find((item) => item.id === draft.id)!;
  assert.equal(edited.versions.length, 2);
  assert.equal(currentOutreachVersion(edited).origin, 'human_edit');
  assert.equal(edited.versions[0]?.body, original.body);

  snapshot = submitOutreachForReview(snapshot, draft.id, 'talha.bashir@codistan.org', '2026-07-27T06:15:00.000Z');
  assert.equal(snapshot.drafts.find((item) => item.id === draft.id)?.status, 'in_review');
  snapshot = approveOutreachDraft(snapshot, draft.id, {
    actor: 'talha.bashir@codistan.org',
    canManagerApprove: true,
    generatedAt: '2026-07-27T06:20:00.000Z',
  });
  const approved = snapshot.drafts.find((item) => item.id === draft.id)!;
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedVersionId, approved.currentVersionId);

  snapshot = recordOutreachCopy(snapshot, draft.id, 'talha.bashir@codistan.org', '2026-07-27T06:21:00.000Z');
  assert.equal(snapshot.drafts.find((item) => item.id === draft.id)?.copyHistory.length, 1);

  snapshot = recordManualOutreachSend(snapshot, draft.id, {
    actor: 'talha.bashir@codistan.org',
    sender: 'Talha Bashir',
    body: `${currentOutreachVersion(approved).body}\nThanks, Talha`,
    sentAt: '2026-07-27T06:25:00.000Z',
    followUpAt: '2026-07-30T06:25:00.000Z',
    manualConfirmation: true,
    generatedAt: '2026-07-27T06:26:00.000Z',
  });
  const sentDraft = snapshot.drafts.find((item) => item.id === draft.id)!;
  assert.equal(sentDraft.status, 'sent_manually');
  assert.equal(sentDraft.sentHistory[0]?.differedFromApproved, true);
  assert.equal(sentDraft.sentHistory[0]?.manualExternalActionConfirmed, true);
  assert.equal(sentDraft.sentHistory[0]?.systemExternalActionPerformed, false);
  assert.equal(snapshot.sequencePlan.status, 'active');

  snapshot = recordOutreachOutcome(snapshot, draft.id, 'reply', 'Buyer requested a short call.', 'talha.bashir@codistan.org', '2026-07-27T08:00:00.000Z', '2026-07-27T08:01:00.000Z');
  assert.equal(snapshot.sequencePlan.status, 'stopped');
  assert.equal(snapshot.drafts.find((item) => item.id === draft.id)?.outcomes[0]?.outcome, 'reply');

  const attached = attachOutreachWorkbench(input, snapshot);
  assert.equal(readOutreachWorkbench(attached)?.leadId, input.id);
  assert(attached.draftMessage?.includes('Would Tuesday or Wednesday'));
}

{
  const managerRequiredLead = lead('manager-required', {rawPayload: {outreachManagerApprovalRequired: true}});
  let snapshot = initializeOutreachWorkbench({lead: managerRequiredLead, actor: 'jawad.jutt@codistan.org', generatedAt: now});
  const draft = snapshot.drafts[0]!;
  snapshot = submitOutreachForReview(snapshot, draft.id, 'jawad.jutt@codistan.org', now);
  assert.throws(() => approveOutreachDraft(snapshot, draft.id, {actor: 'jawad.jutt@codistan.org', canManagerApprove: false, generatedAt: now}), /Manager approval is required/);
  const approved = approveOutreachDraft(snapshot, draft.id, {actor: 'talha.bashir@codistan.org', canManagerApprove: true, generatedAt: now});
  assert.equal(approved.drafts[0]?.approval?.managerApproval, true);
}

{
  const suppressed = lead('suppressed', {rawPayload: {enrichment: {suppression: {suppressed: true, reason: 'Requested no further contact'}}}});
  const snapshot = initializeOutreachWorkbench({lead: suppressed, actor: 'talha.bashir@codistan.org', generatedAt: now});
  const draft = snapshot.drafts[0]!;
  assert.equal(snapshot.blocked, true);
  assert.throws(() => approveOutreachDraft(snapshot, draft.id, {actor: 'talha.bashir@codistan.org', canManagerApprove: true, generatedAt: now}), /Cannot approve/);
}

{
  const duplicate = lead('duplicate', {rawPayload: {identityGraph: {duplicateContactLeadIds: ['prior-1']}}});
  const snapshot = initializeOutreachWorkbench({lead: duplicate, actor: 'talha.bashir@codistan.org', generatedAt: now});
  const draft = snapshot.drafts[0]!;
  assert.equal(snapshot.blocked, true);
  assert.throws(() => recordOutreachCopy(snapshot, draft.id, 'talha.bashir@codistan.org', now), /duplicate contact history/i);
}

{
  const input = lead('reject-and-pause');
  let snapshot = initializeOutreachWorkbench({lead: input, actor: 'talha.bashir@codistan.org', generatedAt: now});
  const draft = snapshot.drafts[0]!;
  snapshot = rejectOutreachDraft(snapshot, draft.id, 'The message is too generic and needs stronger evidence.', 'talha.bashir@codistan.org', now);
  assert.equal(snapshot.drafts[0]?.status, 'rejected');
  snapshot = changeSequenceStatus(snapshot, 'paused', 'talha.bashir@codistan.org', now);
  assert.equal(snapshot.sequencePlan.status, 'paused');
}

console.log('Outreach workbench lifecycle tests passed.');
