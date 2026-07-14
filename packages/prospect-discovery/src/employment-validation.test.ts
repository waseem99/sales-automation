import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { rejectStoredEmploymentVacancies } from './runner.js';

const now = '2026-07-14T12:00:00.000Z';

function lead(input: Partial<Lead> & Pick<Lead, 'id' | 'title' | 'description'>): Lead {
  return {
    id: input.id,
    source: input.source ?? 'public_job_board',
    sourceUrl: input.sourceUrl ?? `https://remoteok.com/remote-jobs/${input.id}`,
    leadType: input.leadType ?? 'public_opportunity',
    title: input.title,
    description: input.description,
    companyName: input.companyName ?? 'Example Company',
    serviceCategory: input.serviceCategory ?? 'ai_automation',
    opportunityStatus: input.opportunityStatus ?? 'live_opportunity',
    discoverySource: input.discoverySource ?? 'RemoteOK',
    capturedAt: input.capturedAt ?? now,
    pipelineStatus: input.pipelineStatus ?? 'needs_human_review',
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    feedback: input.feedback ?? { status: 'pending' },
    ...input,
  };
}

const repository = new InMemoryLeadRepository();
repository.upsertLead(lead({
  id: 'employee-role',
  title: 'Senior AI Engineer',
  description: 'Full-time permanent role. Apply now with your resume. Salary, benefits and work authorization required.',
}), 'test');
repository.scheduleFollowUp('employee-role', {
  nextFollowUpAt: '2026-07-15T09:00:00.000Z',
  followUpNote: 'Send candidate application.',
}, 'test');

repository.upsertLead(lead({
  id: 'fixed-scope-project',
  title: 'AI RAG Fixed-Scope Implementation Project',
  description: 'Contract project seeking an implementation partner for defined deliverables and a statement of work.',
}), 'test');

assert.equal(rejectStoredEmploymentVacancies(repository, now), 1);
const employee = repository.getLead('employee-role')?.lead;
assert.equal(employee?.pipelineStatus, 'rejected');
assert.equal(employee?.outcomeStatus, 'not_fit');
assert.equal(employee?.outcomeReason, 'employment_role_not_project_opportunity');
assert.equal(employee?.opportunityStatus, 'recent_demand_signal');
assert.equal(employee?.nextFollowUpAt, undefined);
assert.ok(employee?.recommendedNextAction?.includes('Do not apply'));
assert.ok(repository.getLead('employee-role')?.notes.some((note) => note.includes('employment_role_not_project_opportunity')));

const project = repository.getLead('fixed-scope-project')?.lead;
assert.equal(project?.pipelineStatus, 'needs_human_review');
assert.equal(project?.outcomeStatus, undefined);
assert.equal(rejectStoredEmploymentVacancies(repository, now), 0);

console.log('stored employment vacancy cleanup tests passed');
