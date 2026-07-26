import assert from 'node:assert/strict';
import { InMemoryProspectDiscoveryRunStore } from '@sales-automation/prospect-discovery';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { handleProspectDashboardRequest } from './prospect-handler.js';

const now = '2026-07-26T15:00:00.000Z';
const lead: Lead = {
  id: 'bd-handler-lead',
  source: 'linkedin',
  sourceUrl: 'https://www.linkedin.com/posts/bd-handler-lead',
  leadType: 'linkedin_warm_post',
  prospectStage: 'warm_lead',
  title: 'Need an AI software delivery partner',
  description: 'The buyer requests a software and AI implementation partner.',
  companyName: 'Example FinTech',
  contactName: 'Ayesha Khan',
  contactRole: 'CTO',
  linkedinUrl: 'https://www.linkedin.com/in/ayesha-khan/',
  serviceCategory: 'fullstack_web_app',
  opportunityStatus: 'live_opportunity',
  evidenceSummary: 'Visible buyer-authored requirement.',
  capturedAt: now,
  pipelineStatus: 'needs_human_review',
  createdAt: now,
  updatedAt: now,
};

const repository = new InMemoryLeadRepository([lead]);
const runStore = new InMemoryProspectDiscoveryRunStore();
const context = {
  repository,
  runStore,
  portfolioItems: [],
  adminPassword: 'correct-password',
  sessionSecret: 'a-test-session-secret-with-more-than-24-characters',
  actor: 'talha.bashir@codistan.org',
  now: () => now,
};

const login = await handleProspectDashboardRequest({
  method: 'POST',
  url: '/api/login',
  body: {password: 'correct-password'},
  clientKey: 'bd-workflow-test',
}, context);
assert.equal(login.status, 200);
const cookie = login.headers['set-cookie']?.split(';')[0];
assert(cookie);

async function post(path: string, body: Record<string, unknown> = {}) {
  return handleProspectDashboardRequest({
    method: 'POST',
    url: path,
    headers: {cookie},
    body,
  }, context);
}

{
  const response = await post(`/api/prospects/${lead.id}/owner`, {owner: 'Talha Bashir'});
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body) as Record<string, unknown>;
  assert.equal(body.owner, 'Talha Bashir');
  const raw = body.rawPayload as Record<string, unknown>;
  assert.equal(raw.bdWorkflowVersion, 'bd-workflow.v1');
  const workflow = raw.bdWorkflow as Record<string, unknown>;
  assert.notEqual((workflow.nextBestAction as Record<string, unknown>).code, 'assign_owner');
}

let manualTaskId = '';
{
  const response = await post(`/api/prospects/${lead.id}/tasks`, {
    title: 'Verify procurement authority',
    reason: 'Confirm whether the visible CTO can approve the engagement.',
    priority: 'high',
    channel: 'internal',
    dueAt: '2026-07-27T12:00:00.000Z',
  });
  assert.equal(response.status, 201);
  const body = JSON.parse(response.body) as Record<string, unknown>;
  const workflow = body.workflow as Record<string, unknown>;
  const tasks = workflow.tasks as Array<Record<string, unknown>>;
  const task = tasks.find((item) => item.generated === false);
  assert(task);
  manualTaskId = String(task.id);
  assert.equal(task.status, 'open');
}

{
  const response = await post(`/api/prospects/${lead.id}/tasks/${manualTaskId}/complete`, {note: 'Authority confirmed in internal research.'});
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body) as Record<string, unknown>;
  const workflow = body.workflow as Record<string, unknown>;
  const tasks = workflow.tasks as Array<Record<string, unknown>>;
  assert.equal(tasks.find((item) => item.id === manualTaskId)?.status, 'completed');
}

{
  const response = await post(`/api/prospects/${lead.id}/status`, {status: 'approved_to_contact'});
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body) as Record<string, unknown>;
  const workflow = (body.rawPayload as Record<string, unknown>).bdWorkflow as Record<string, unknown>;
  assert.equal((workflow.nextBestAction as Record<string, unknown>).code, 'prepare_outreach');
}

{
  const response = await post(`/api/prospects/${lead.id}/activity`, {
    type: 'outreach',
    channel: 'linkedin',
    body: 'Human reviewed and manually sent the approved LinkedIn message.',
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body) as Record<string, unknown>;
  assert.equal(body.pipelineStatus, 'sent_manually');
  const workflow = (body.rawPayload as Record<string, unknown>).bdWorkflow as Record<string, unknown>;
  assert.equal((workflow.nextBestAction as Record<string, unknown>).code, 'schedule_follow_up');
}

{
  const response = await post(`/api/prospects/${lead.id}/next-action`);
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal((body.workflow as Record<string, unknown>).externalActionPerformed, false);
}

{
  const unauthenticated = await handleProspectDashboardRequest({
    method: 'POST',
    url: `/api/prospects/${lead.id}/tasks`,
    body: {title: 'Should fail', reason: 'Authentication is required.'},
  }, context);
  assert.equal(unauthenticated.status, 401);
}

assert(repository.getLead(lead.id)?.notes.some((note) => note.startsWith('bd_task_created::')));
assert(repository.getLead(lead.id)?.auditLog.some((entry) => entry.action === 'lead_upserted'));

console.log('BD workflow handler tests passed.');
