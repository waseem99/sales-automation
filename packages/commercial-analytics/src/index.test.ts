import assert from 'node:assert/strict';
import { attachBdWorkflow, refreshBdWorkflow, updateBdTask } from '@sales-automation/bd-workflow';
import {
  approveOutreachDraft,
  attachOutreachWorkbench,
  createManualDraft,
  editOutreachDraft,
  markDraftSentManually,
  submitDraftForReview,
} from '@sales-automation/outreach-workbench';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository, type StoredLeadRecord } from '@sales-automation/storage';
import {
  buildCommercialAnalytics,
  commercialValueHistory,
  createCalibrationDecision,
  recordCommercialValue,
  suggestedCalibrationDecision,
} from './index.js';

const generatedAt = '2026-07-27T12:00:00.000Z';

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'linkedin',
    sourceUrl: `https://www.linkedin.com/posts/${id}`,
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    title: `Opportunity ${id}`,
    description: 'Buyer requests a software delivery partner.',
    companyName: 'Example Company',
    companyWebsite: 'https://example.com',
    contactName: 'Ayesha Khan',
    contactRole: 'CTO',
    linkedinUrl: 'https://www.linkedin.com/in/ayesha-khan/',
    serviceCategory: 'fullstack_web_app',
    opportunityStatus: 'live_opportunity',
    evidenceSummary: 'Buyer-authored requirement retained from the original post.',
    capturedAt: '2026-07-10T09:00:00.000Z',
    owner: 'Talha Bashir',
    pipelineStatus: 'new',
    createdAt: '2026-07-10T09:00:00.000Z',
    updatedAt: '2026-07-10T09:00:00.000Z',
    ...patch,
  };
}

function recordWithEvents(input: Lead, events: Array<{status: Lead['pipelineStatus']; at: string}>): StoredLeadRecord {
  const repository = new InMemoryLeadRepository();
  repository.upsertLead(input, 'fixture');
  for (const event of events) {
    const current = repository.getLead(input.id)!;
    current.lead.updatedAt = event.at;
    repository.updateStatus(input.id, event.status, 'bd-user');
    const audit = repository.getLead(input.id)!.auditLog.at(-1)!;
    audit.createdAt = event.at;
  }
  return repository.getLead(input.id)!;
}

{
  const base = lead('converted', {pipelineStatus: 'approved_to_contact'});
  let workbench = createManualDraft(base, {
    channel: 'linkedin_dm',
    subject: 'Regarding your software delivery requirement',
    body: 'Hi Ayesha, I reviewed your requirement and prepared this draft for human approval.',
  }, 'talha', '2026-07-12T09:00:00.000Z');
  const draft = workbench.drafts[0]!;
  workbench = editOutreachDraft(attachOutreachWorkbench(base, workbench), draft.id, {
    subject: 'A practical approach for your delivery requirement',
    body: 'Hi Ayesha, I reviewed your requirement. A practical first step would be a short discovery followed by a defined pilot.',
    changeNote: 'Made the next step specific and kept claims conservative.',
  }, 'talha', '2026-07-12T10:00:00.000Z');
  workbench = submitDraftForReview(attachOutreachWorkbench(base, workbench), draft.id, 'talha', '2026-07-12T10:10:00.000Z');
  workbench = approveOutreachDraft(attachOutreachWorkbench(base, workbench), draft.id, 'Approved after source review.', 'waseem', '2026-07-12T10:20:00.000Z');
  const approvedRevision = workbench.drafts[0]!.revisions.find((item) => item.id === workbench.drafts[0]!.currentRevisionId)!;
  workbench = markDraftSentManually(attachOutreachWorkbench(base, workbench), draft.id, {
    revisionId: approvedRevision.id,
    sentAt: '2026-07-13T09:00:00.000Z',
    destinationLabel: 'LinkedIn DM to Ayesha Khan',
  }, 'talha', '2026-07-13T09:01:00.000Z');

  let enrichedLead = attachOutreachWorkbench({
    ...base,
    pipelineStatus: 'sent_manually',
    lastContactedAt: '2026-07-13T09:00:00.000Z',
    lastResponseAt: '2026-07-14T09:00:00.000Z',
    rawPayload: {primaryCampaignMatch: {campaignId: 'software-partner', campaignName: 'Software Partner'}},
  }, workbench);
  let workflow = refreshBdWorkflow(enrichedLead, '2026-07-13T09:01:00.000Z', 'bd-workflow');
  const followUp = workflow.tasks.find((task) => task.code === 'schedule_follow_up')!;
  assert(followUp?.dueAt);
  workflow = updateBdTask(attachBdWorkflow(enrichedLead, workflow), followUp.id, {status: 'completed'}, 'talha', '2026-07-13T12:00:00.000Z');
  enrichedLead = attachBdWorkflow(enrichedLead, workflow);
  enrichedLead = {...enrichedLead, pipelineStatus: 'replied'};

  const valued = recordCommercialValue(enrichedLead, {kind: 'pipeline', amount: 25000, currency: 'USD', note: 'Value entered from the opportunity review.', actor: 'waseem', enteredAt: '2026-07-15T09:00:00.000Z'});
  const record = recordWithEvents(valued, [
    {status: 'approved_to_contact', at: '2026-07-12T09:00:00.000Z'},
    {status: 'sent_manually', at: '2026-07-13T09:00:00.000Z'},
    {status: 'replied', at: '2026-07-14T09:00:00.000Z'},
  ]);
  record.auditLog.push({id: 'assign', leadId: base.id, action: 'owner_assigned', actor: 'manager', message: 'Owner assigned.', createdAt: '2026-07-10T10:00:00.000Z'});

  const rejected = recordWithEvents(lead('rejected', {source: 'sales_navigator', leadType: 'sales_navigator_cold_prospect', prospectStage: 'cold_prospect', owner: 'Jawad Jutt', rawPayload: {identityGraph: {duplicateContactLeadIds: ['old-record']}}}), [{status: 'rejected', at: '2026-07-11T09:00:00.000Z'}]);
  rejected.lead.feedback = {status: 'complete', relevanceRating: 1, contactAccuracy: 'wrong', sourceQuality: 'low', repeatRecommendation: 'stop', reason: 'Wrong target and duplicate person.', recordedBy: 'jawad', recordedAt: '2026-07-11T10:00:00.000Z'};

  const decision = createCalibrationDecision({dimension: 'source', laneKey: 'linkedin_warm', laneLabel: 'LinkedIn Warm', decision: 'keep', rationale: 'The lane produced a recorded reply from a reviewed opportunity.', evidence: ['1 manually recorded reply from the selected period.'], reviewedSampleSize: 10, reviewedBy: 'waseem', reviewedAt: '2026-07-27T10:00:00.000Z'});
  const report = buildCommercialAnalytics({records: [record, rejected], from: '2026-07-01T00:00:00.000Z', to: generatedAt, generatedAt, decisions: [decision]});
  assert.equal(report.summary.counts.captured, 2);
  assert.equal(report.summary.counts.contacted, 1);
  assert.equal(report.summary.counts.replies, 1);
  assert.equal(report.summary.counts.rejected, 1);
  assert.equal(report.summary.counts.duplicates, 1);
  assert.equal(report.summary.counts.dueFollowUps, 1);
  assert.equal(report.summary.counts.onTimeFollowUps, 1);
  assert.equal(report.summary.aiDisposition.edited, 1);
  assert.equal(report.summary.values[0]?.pipeline, 25000);
  const source = report.lanes.source.find((lane) => lane.key === 'linkedin_warm')!;
  assert.equal(source.officialDecision?.decision, 'keep');
  assert.equal(source.counts.replies, 1);
  assert(report.lanes.campaign.some((lane) => lane.key === 'software_partner'));
  assert(report.lanes.channel.some((lane) => lane.key === 'linkedin_dm'));
  assert.equal(report.fabricatedOutcomeCount, 0);
  assert.equal(report.externalActionPerformed, false);
}

{
  const input = lead('won', {pipelineStatus: 'won', outcomeStatus: 'won'});
  const updated = recordCommercialValue(input, {kind: 'won_revenue', amount: 5000, currency: 'usd', note: 'Confirmed received project value.', actor: 'waseem', enteredAt: generatedAt});
  assert.equal(commercialValueHistory(updated)[0]?.currency, 'USD');
  assert.equal(commercialValueHistory(updated)[0]?.explicitValue, true);
  assert.throws(() => recordCommercialValue(lead('not-won'), {kind: 'won_revenue', amount: 5000, currency: 'USD', note: 'Should not be accepted.', actor: 'waseem'}), /only after the prospect is marked won/);
  assert.throws(() => recordCommercialValue(input, {kind: 'pipeline', amount: -1, currency: 'USD', note: 'Invalid amount.', actor: 'waseem'}), /non-negative/);
}

{
  assert.throws(() => createCalibrationDecision({dimension: 'source', laneKey: 'x', laneLabel: 'X', decision: 'change', rationale: 'Change targeting.', evidence: ['No replies.'], reviewedSampleSize: 10, reviewedBy: 'waseem'}), /plannedChange/);
  assert.throws(() => createCalibrationDecision({dimension: 'source', laneKey: 'x', laneLabel: 'X', decision: 'stop', rationale: 'Stop lane.', evidence: ['Weak sample.'], reviewedSampleSize: 10, reviewedBy: 'waseem'}), /reactivationCriteria/);
  const stop = createCalibrationDecision({dimension: 'campaign', laneKey: 'cold-x', laneLabel: 'Cold X', decision: 'stop', rationale: 'A representative reviewed sample produced no replies.', evidence: ['20 reviewed records', '10 manual contacts', '0 replies'], reviewedSampleSize: 20, reactivationCriteria: 'Reactivate only after a new buyer trigger and revised targeting fixture.', reviewedBy: 'waseem', reviewedAt: generatedAt});
  assert.equal(stop.decision, 'stop');
  assert.equal(stop.status, 'active');
}

{
  const counts = {captured: 20, unique: 20, enriched: 15, evidenceComplete: 15, duplicates: 1, identityConflicts: 0, bdAccepted: 3, contacted: 10, replies: 0, meetings: 0, proposals: 0, wins: 0, losses: 0, rejected: 10, suppressed: 0, dueFollowUps: 5, onTimeFollowUps: 4};
  const rates = {enrichmentRate: .75, evidenceCompletenessRate: .75, duplicateRate: .05, bdAcceptanceRate: .15, contactRate: .5, replyRate: 0, meetingRate: 0, proposalRate: 0, winRate: 0, followUpComplianceRate: .8};
  assert.equal(suggestedCalibrationDecision(counts, rates, 20).decision, 'stop');
  assert.equal(suggestedCalibrationDecision({...counts, contacted: 2}, rates, 5).decision, 'insufficient_data');
}

console.log('Commercial analytics and calibration tests passed.');
