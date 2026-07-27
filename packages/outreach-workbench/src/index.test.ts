import assert from 'node:assert/strict';
import type { GeneratedDraft } from '@sales-automation/drafting';
import type { Lead } from '@sales-automation/shared';
import {
  approveOutreachDraft,
  attachOutreachWorkbench,
  createManualDraft,
  editOutreachDraft,
  initializeOutreachWorkbench,
  markDraftSentManually,
  readOutreachWorkbench,
  recordDraftCopied,
  requestDraftChanges,
  submitDraftForReview,
} from './index.js';

const now = '2026-07-27T06:00:00.000Z';
const lead: Lead = {
  id: 'outreach-lead-1',
  source: 'linkedin',
  sourceUrl: 'https://www.linkedin.com/posts/outreach-lead-1',
  leadType: 'linkedin_warm_post',
  prospectStage: 'warm_lead',
  title: 'Need a software delivery partner',
  description: 'Buyer-authored request for a software delivery partner.',
  companyName: 'Example Labs',
  contactName: 'Ayesha Khan',
  contactRole: 'CTO',
  linkedinUrl: 'https://www.linkedin.com/in/ayesha-khan/',
  serviceCategory: 'fullstack_web_app',
  opportunityStatus: 'live_opportunity',
  evidenceSummary: 'Visible buyer-authored request.',
  capturedAt: now,
  pipelineStatus: 'draft_ready',
  createdAt: now,
  updatedAt: now,
};

const generated: GeneratedDraft = {
  id: 'generated-linkedin-dm',
  type: 'linkedin_dm',
  status: 'draft_ready',
  subject: 'Regarding your software delivery requirement',
  body: 'Hi Ayesha, I saw your requirement and drafted this for human review.',
  metadata: {
    leadId: lead.id,
    source: lead.source,
    leadType: lead.leadType,
    recommendedProfile: 'Codistan',
    portfolioItemIds: [],
    requiresHumanApproval: true,
    generatedAt: now,
    assumptions: ['The visible requirement should be rechecked before sending.'],
    safeguards: ['Draft is internal only and must be approved by a human before sending.'],
  },
};

const initial = initializeOutreachWorkbench(lead, [generated], 'system', now);
assert.equal(initial.drafts.length, 1);
assert.equal(initial.drafts[0]?.status, 'working');
assert.equal(initial.automaticSendingEnabled, false);
assert(initial.drafts[0]?.safeguards.some((item) => /does not send/i.test(item)));

const attachedInitial = attachOutreachWorkbench(lead, initial);
assert.equal(readOutreachWorkbench(attachedInitial)?.drafts.length, 1);
const draftId = initial.drafts[0]!.id;

const edited = editOutreachDraft(attachedInitial, draftId, {
  subject: 'A practical approach for your delivery requirement',
  body: 'Hi Ayesha, I reviewed your requirement. A practical first step would be a short discovery followed by a defined pilot.',
  changeNote: 'Removed unverified capability claims and made the next step specific.',
}, 'talha.bashir@codistan.org', '2026-07-27T06:10:00.000Z');
assert.equal(edited.drafts[0]?.revisions.length, 2);
assert.equal(edited.drafts[0]?.approval, undefined);

const attachedEdited = attachOutreachWorkbench(attachedInitial, edited);
const submitted = submitDraftForReview(attachedEdited, draftId, 'talha.bashir@codistan.org', '2026-07-27T06:15:00.000Z');
assert.equal(submitted.drafts[0]?.status, 'in_review');

const changes = requestDraftChanges(
  attachOutreachWorkbench(attachedEdited, submitted),
  draftId,
  'Please make the proof statement more conservative.',
  'waseem@codistan.org',
  '2026-07-27T06:20:00.000Z',
);
assert.equal(changes.drafts[0]?.status, 'changes_requested');

const approved = approveOutreachDraft(
  attachOutreachWorkbench(attachedEdited, changes),
  draftId,
  'Approved for manual LinkedIn use after final source check.',
  'waseem@codistan.org',
  '2026-07-27T06:25:00.000Z',
);
assert.equal(approved.drafts[0]?.status, 'approved');
const approvedRevision = approved.drafts[0]!.revisions.find((item) => item.id === approved.drafts[0]!.currentRevisionId)!;
assert.equal(approved.drafts[0]?.approval?.revisionId, approvedRevision.id);
assert.equal(approved.drafts[0]?.approval?.contentHash, approvedRevision.contentHash);

const copied = recordDraftCopied(
  attachOutreachWorkbench(attachedEdited, approved),
  draftId,
  'talha.bashir@codistan.org',
  '2026-07-27T06:27:00.000Z',
);
assert(copied.drafts[0]?.events.some((event) => event.type === 'copied'));

const sent = markDraftSentManually(
  attachOutreachWorkbench(attachedEdited, copied),
  draftId,
  {
    revisionId: approvedRevision.id,
    sentAt: '2026-07-27T06:30:00.000Z',
    destinationLabel: 'LinkedIn DM to Ayesha Khan',
    externalReference: 'Human confirmation only; no API send.',
  },
  'talha.bashir@codistan.org',
  '2026-07-27T06:31:00.000Z',
);
assert.equal(sent.drafts[0]?.status, 'sent_manually');
assert.equal(sent.drafts[0]?.sentVersions.length, 1);
assert.equal(sent.drafts[0]?.sentVersions[0]?.body, approvedRevision.body);
assert.equal(sent.drafts[0]?.sentVersions[0]?.contentHash, approvedRevision.contentHash);
assert.equal(sent.drafts[0]?.sentVersions[0]?.manuallyConfirmed, true);
assert.equal(sent.drafts[0]?.sentVersions[0]?.externalActionPerformedBySystem, false);

assert.throws(() => editOutreachDraft(
  attachOutreachWorkbench(attachedEdited, sent),
  draftId,
  {body: 'This must not mutate the sent version.'},
  'talha.bashir@codistan.org',
  '2026-07-27T06:35:00.000Z',
), /immutable/i);

const manual = createManualDraft(lead, {
  channel: 'email',
  subject: 'Potential delivery collaboration',
  body: 'Hello, this is a manually authored draft that still requires review and approval.',
}, 'subainaaamir@codistan.org', now);
assert.equal(manual.drafts[0]?.status, 'working');
assert.equal(manual.drafts[0]?.revisions[0]?.source, 'human_edit');

const unapprovedRevision = manual.drafts[0]!.currentRevisionId;
assert.throws(() => markDraftSentManually(
  attachOutreachWorkbench(lead, manual),
  manual.drafts[0]!.id,
  {revisionId: unapprovedRevision},
  'subainaaamir@codistan.org',
  now,
), /approved/i);

console.log('Outreach workbench tests passed.');
