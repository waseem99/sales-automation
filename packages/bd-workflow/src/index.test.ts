import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import {
  attachBdWorkflow,
  bdWorkflowStateEqual,
  createBdTask,
  readBdWorkflow,
  refreshBdWorkflow,
  updateBdTask,
  workflowQueueFacts,
} from './index.js';

const now = '2026-07-26T14:00:00.000Z';

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'linkedin',
    sourceUrl: `https://www.linkedin.com/posts/${id}`,
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    title: `Opportunity ${id}`,
    description: 'Visible request for a software and AI delivery partner.',
    companyName: 'Example Company',
    contactName: 'Ayesha Khan',
    contactRole: 'CTO',
    linkedinUrl: 'https://www.linkedin.com/in/ayesha-khan/',
    serviceCategory: 'fullstack_web_app',
    opportunityStatus: 'live_opportunity',
    evidenceSummary: 'The original post explicitly requests a delivery partner.',
    capturedAt: now,
    pipelineStatus: 'needs_human_review',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

{
  const input = lead('unassigned', {owner: undefined});
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert.equal(snapshot.nextBestAction.code, 'assign_owner');
  assert(snapshot.tasks.some((task) => task.code === 'assign_owner' && task.status === 'open'));
  assert.equal(snapshot.externalActionPerformed, false);
  assert(snapshot.nextBestAction.prohibitedClaims.some((item) => /automatically/i.test(item)));
}

{
  const input = lead('research', {
    source: 'sales_navigator',
    leadType: 'sales_navigator_cold_prospect',
    prospectStage: 'cold_prospect',
    opportunityStatus: 'partnership_target',
    companyName: undefined,
    contactName: undefined,
    contactRole: undefined,
    linkedinUrl: undefined,
    owner: 'Talha Bashir',
    pipelineStatus: 'needs_research',
  });
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert(snapshot.tasks.some((task) => task.code === 'confirm_company_identity'));
  assert(snapshot.tasks.some((task) => task.code === 'confirm_decision_maker'));
  assert(snapshot.tasks.some((task) => task.code === 'verify_contact_route'));
  assert(snapshot.nextBestAction.risks.some((risk) => /no explicit buyer request/i.test(risk)));
}

{
  const input = lead('duplicate', {
    owner: 'Jawad Jutt',
    rawPayload: {identityGraph: {duplicateContactLeadIds: ['lead-a', 'lead-b']}},
  });
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert.equal(snapshot.nextBestAction.code, 'review_duplicate_contact');
  assert(snapshot.tasks.some((task) => task.code === 'review_duplicate_contact'));
}

{
  const input = lead('suppressed', {
    owner: 'Talha Bashir',
    rawPayload: {enrichment: {suppression: {suppressed: true, reason: 'Requested no further contact'}}},
  });
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert.equal(snapshot.blocked, true);
  assert.equal(snapshot.nextBestAction.code, 'review_suppression');
  assert(snapshot.tasks.every((task) => task.code === 'review_suppression'));
}

{
  const input = lead('approved', {owner: 'Talha Bashir', pipelineStatus: 'approved_to_contact'});
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert.equal(snapshot.nextBestAction.code, 'prepare_outreach');
  assert.equal(snapshot.nextBestAction.channel, 'linkedin');
  assert.equal(snapshot.nextBestAction.externalActionPerformed, false);
}

{
  const input = lead('sent', {owner: 'Talha Bashir', pipelineStatus: 'sent_manually', lastContactedAt: now});
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert.equal(snapshot.nextBestAction.code, 'schedule_follow_up');
  assert(snapshot.tasks.some((task) => task.code === 'schedule_follow_up'));
}

{
  const input = lead('replied', {owner: 'Talha Bashir', pipelineStatus: 'replied', lastResponseAt: now});
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert.equal(snapshot.nextBestAction.code, 'classify_reply');
  assert.equal(snapshot.nextBestAction.priority, 'critical');
}

{
  const input = lead('meeting', {owner: 'Talha Bashir', pipelineStatus: 'meeting_booked'});
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert.equal(snapshot.nextBestAction.code, 'prepare_meeting');
  assert.equal(snapshot.nextBestAction.channel, 'meeting');
}

{
  const input = lead('proposal', {owner: 'Talha Bashir', pipelineStatus: 'proposal_sent'});
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert.equal(snapshot.nextBestAction.code, 'follow_up_proposal');
}

{
  const input = lead('won', {owner: 'Talha Bashir', pipelineStatus: 'won', outcomeStatus: 'won'});
  const snapshot = refreshBdWorkflow(input, now, 'test');
  assert.equal(snapshot.nextBestAction.code, 'capture_learning');
  assert(snapshot.tasks.some((task) => task.code === 'capture_learning'));
  const completeFeedback = lead('won-feedback', {
    owner: 'Talha Bashir',
    pipelineStatus: 'won',
    outcomeStatus: 'won',
    feedback: {
      status: 'complete',
      relevanceRating: 5,
      contactAccuracy: 'accurate',
      sourceQuality: 'high',
      repeatRecommendation: 'increase',
      reason: 'Strong buyer evidence and commercially relevant opportunity.',
      recordedBy: 'manager',
      recordedAt: now,
    },
  });
  assert.equal(refreshBdWorkflow(completeFeedback, now, 'test').nextBestAction.code, 'no_action');
}

{
  const input = lead('manual-task', {owner: 'Talha Bashir'});
  const created = createBdTask(input, {
    title: 'Verify procurement authority',
    reason: 'The visible contact may influence but not approve the purchase.',
    priority: 'high',
    channel: 'internal',
    dueAt: '2026-07-27T12:00:00.000Z',
  }, 'waseem@codistan.org', now);
  const task = created.tasks.find((item) => !item.generated)!;
  assert(task);
  assert.equal(task.status, 'open');
  const attachedLead = attachBdWorkflow(input, created);
  const completed = updateBdTask(attachedLead, task.id, {status: 'completed', note: 'Authority confirmed.'}, 'talha.bashir@codistan.org', '2026-07-26T15:00:00.000Z');
  assert.equal(completed.tasks.find((item) => item.id === task.id)?.status, 'completed');
  assert(completed.events.some((event) => event.type === 'task_status_changed'));
}

{
  const input = lead('attachment', {owner: 'Talha Bashir', rawPayload: {parserVersion: 'fixture-v1'}});
  const snapshot = refreshBdWorkflow(input, now, 'test');
  const attached = attachBdWorkflow(input, snapshot);
  const raw = attached.rawPayload as Record<string, unknown>;
  assert.equal(raw.parserVersion, 'fixture-v1');
  assert.equal(readBdWorkflow(attached)?.leadId, input.id);
  assert.equal(attached.recommendedNextAction, snapshot.nextBestAction.title);
  assert(bdWorkflowStateEqual(snapshot, refreshBdWorkflow(attached, '2026-07-26T16:00:00.000Z', 'test')));
  const facts = workflowQueueFacts(attached, now);
  assert.equal(facts.openTasks, snapshot.openTaskCount);
}

console.log('BD workflow tests passed.');
