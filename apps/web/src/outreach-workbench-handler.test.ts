import assert from 'node:assert/strict';
import { InMemoryProspectDiscoveryRunStore } from '@sales-automation/prospect-discovery';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { resolveDashboardAccess } from './dashboard-access.js';
import { handleProspectDashboardRequest } from './auto-prospect-handler.js';

const now = '2026-07-27T07:00:00.000Z';

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'linkedin',
    sourceUrl: `https://www.linkedin.com/posts/${id}`,
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    title: 'Need a delivery partner',
    description: 'The buyer is seeking a software delivery partner.',
    companyName: 'Example Company',
    companyWebsite: 'https://example.com',
    contactName: 'Ayesha Khan',
    contactRole: 'CTO',
    linkedinUrl: 'https://www.linkedin.com/in/ayesha-khan/',
    serviceCategory: 'fullstack_web_app',
    opportunityStatus: 'live_opportunity',
    evidenceSummary: 'Buyer-authored requirement retained from the original post.',
    capturedAt: now,
    owner: 'Talha Bashir',
    pipelineStatus: 'approved_to_contact',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function contextFor(input: Lead, identifier = 'talha.bashir@codistan.org', displayName = 'Talha Bashir') {
  const repository = new InMemoryLeadRepository();
  repository.upsertLead(input, 'fixture');
  return {
    repository,
    runStore: new InMemoryProspectDiscoveryRunStore(),
    portfolioItems: [],
    adminPassword: 'correct-password',
    sessionSecret: 'a-test-session-secret-with-more-than-24-characters',
    actor: identifier,
    access: resolveDashboardAccess(identifier, displayName),
    now: () => now,
  };
}

async function login(context: ReturnType<typeof contextFor>, key: string) {
  const response = await handleProspectDashboardRequest({
    method: 'POST',
    url: '/api/login',
    body: {password: 'correct-password'},
    clientKey: key,
  }, context);
  assert.equal(response.status, 200);
  const cookie = response.headers['set-cookie']?.split(';')[0];
  assert(cookie);
  return cookie;
}

{
  const input = lead('workbench-route');
  const context = contextFor(input);
  const cookie = await login(context, 'outreach-route-test');
  const post = (path: string, body: Record<string, unknown> = {}) => handleProspectDashboardRequest({
    method: 'POST',
    url: path,
    headers: {cookie},
    body,
  }, context);

  const initialized = await post(`/api/prospects/${input.id}/outreach/initialize`);
  assert.equal(initialized.status, 201);
  let payload = JSON.parse(initialized.body) as Record<string, unknown>;
  let workbench = payload.workbench as Record<string, unknown>;
  const drafts = workbench.drafts as Array<Record<string, unknown>>;
  const draft = drafts.find((item) => item.channel === workbench.recommendedChannel) ?? drafts[0];
  assert(draft);
  const draftId = String(draft.id);
  const currentVersionId = String(draft.currentVersionId);
  assert.equal(workbench.systemExternalActionPerformed, false);

  const edited = await post(`/api/prospects/${input.id}/outreach/${draftId}/edit`, {
    body: 'Hi Ayesha, I saw the delivery-partner requirement. Would a short scope call on Tuesday be useful?',
    note: 'Human personalized the CTA.',
  });
  assert.equal(edited.status, 200);
  payload = JSON.parse(edited.body) as Record<string, unknown>;
  workbench = payload.workbench as Record<string, unknown>;
  const editedDraft = (workbench.drafts as Array<Record<string, unknown>>).find((item) => item.id === draftId)!;
  assert.equal((editedDraft.versions as unknown[]).length, 2);
  assert.notEqual(editedDraft.currentVersionId, currentVersionId);

  assert.equal((await post(`/api/prospects/${input.id}/outreach/${draftId}/submit-review`)).status, 200);
  const approved = await post(`/api/prospects/${input.id}/outreach/${draftId}/approve`, {note: 'Manager-capable review completed.'});
  assert.equal(approved.status, 200);
  payload = JSON.parse(approved.body) as Record<string, unknown>;
  workbench = payload.workbench as Record<string, unknown>;
  const approvedDraft = (workbench.drafts as Array<Record<string, unknown>>).find((item) => item.id === draftId)!;
  assert.equal(approvedDraft.status, 'approved');
  assert.equal(approvedDraft.approvedVersionId, approvedDraft.currentVersionId);

  assert.equal((await post(`/api/prospects/${input.id}/outreach/${draftId}/copy`)).status, 200);

  const sent = await post(`/api/prospects/${input.id}/outreach/${draftId}/mark-sent`, {
    sender: 'Talha Bashir',
    body: 'Hi Ayesha, I saw the delivery-partner requirement. Would a short scope call on Tuesday be useful?',
    sentAt: '2026-07-27T07:20:00.000Z',
    followUpAt: '2026-07-30T07:20:00.000Z',
    manualConfirmation: true,
  });
  assert.equal(sent.status, 200);
  payload = JSON.parse(sent.body) as Record<string, unknown>;
  assert.equal(payload.pipelineStatus, undefined);
  const prospect = payload.prospect as Record<string, unknown>;
  assert.equal(prospect.pipelineStatus, 'sent_manually');
  assert.equal(prospect.lastContactedAt, '2026-07-27T07:20:00.000Z');
  workbench = payload.workbench as Record<string, unknown>;
  const sentDraft = (workbench.drafts as Array<Record<string, unknown>>).find((item) => item.id === draftId)!;
  assert.equal((sentDraft.sentHistory as Array<Record<string, unknown>>)[0]?.systemExternalActionPerformed, false);
  assert.equal((sentDraft.sentHistory as Array<Record<string, unknown>>)[0]?.manualExternalActionConfirmed, true);

  const outcome = await post(`/api/prospects/${input.id}/outreach/${draftId}/outcome`, {
    outcome: 'reply',
    note: 'Buyer asked for a short introductory call.',
    occurredAt: '2026-07-27T08:00:00.000Z',
  });
  assert.equal(outcome.status, 200);
  payload = JSON.parse(outcome.body) as Record<string, unknown>;
  assert.equal((payload.prospect as Record<string, unknown>).pipelineStatus, 'replied');
  assert.equal(((payload.workbench as Record<string, unknown>).sequencePlan as Record<string, unknown>).status, 'stopped');
  assert(context.repository.getLead(input.id)?.notes.some((note) => note.includes('system_did_not_send')));

  const unauthenticated = await handleProspectDashboardRequest({
    method: 'POST',
    url: `/api/prospects/${input.id}/outreach/refresh`,
    body: {},
  }, context);
  assert.equal(unauthenticated.status, 401);
}

{
  const input = lead('manager-policy', {
    owner: 'Jawad Jutt',
    rawPayload: {outreachManagerApprovalRequired: true},
  });
  const context = contextFor(input, 'jawad.jutt@codistan.org', 'Jawad Jutt');
  const cookie = await login(context, 'manager-policy-test');
  const post = (path: string, body: Record<string, unknown> = {}) => handleProspectDashboardRequest({method: 'POST', url: path, headers: {cookie}, body}, context);
  const initialized = await post(`/api/prospects/${input.id}/outreach/initialize`);
  const workbench = (JSON.parse(initialized.body) as Record<string, unknown>).workbench as Record<string, unknown>;
  const draft = (workbench.drafts as Array<Record<string, unknown>>)[0]!;
  await post(`/api/prospects/${input.id}/outreach/${String(draft.id)}/submit-review`);
  const denied = await post(`/api/prospects/${input.id}/outreach/${String(draft.id)}/approve`);
  assert.equal(denied.status, 409);
  assert.match(String((JSON.parse(denied.body) as Record<string, unknown>).error), /Manager approval is required/);
}

{
  const input = lead('scope-denied', {owner: 'Jawad Jutt'});
  const context = contextFor(input, 'subainaaamir@codistan.org', 'Subaina Aamir');
  const cookie = await login(context, 'scope-denied-test');
  const denied = await handleProspectDashboardRequest({
    method: 'POST',
    url: `/api/prospects/${input.id}/outreach/initialize`,
    headers: {cookie},
    body: {},
  }, context);
  assert.equal(denied.status, 404);
}

console.log('Outreach workbench secured handler tests passed.');
