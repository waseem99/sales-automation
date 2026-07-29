import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import {
  attachIdentityResolution,
  duplicateContactWarning,
  IDENTITY_GRAPH_VERSION,
  readIdentityResolution,
  resolveLeadIdentity,
  type LeadIdentityResolution,
} from './index.js';

const now = '2026-07-24T15:00:00.000Z';

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'manual',
    leadType: 'manual_lead',
    title: id,
    description: `Visible evidence for ${id}`,
    serviceCategory: 'fullstack_web_app',
    capturedAt: now,
    pipelineStatus: 'new',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

{
  const existing = lead('linkedin-1', {
    source: 'linkedin',
    linkedinUrl: 'https://www.linkedin.com/in/muskan-vig/?trk=abc',
    contactName: 'Muskan Vig',
    companyName: 'Fincart',
    contactRole: 'Technology Partnerships',
  });
  const existingResolution = resolveLeadIdentity(existing, [], now);
  const storedExisting = attachIdentityResolution(existing, existingResolution);
  const incoming = lead('salesnav-1', {
    source: 'sales_navigator',
    sourceUrl: 'https://www.linkedin.com/in/muskan-vig/',
    linkedinUrl: 'https://www.linkedin.com/in/muskan-vig/',
    contactName: 'Muskan Vig',
    companyName: 'Fincart',
    contactRole: 'Technology Partnerships',
  });
  const resolution = resolveLeadIdentity(incoming, [storedExisting], now);
  assert.equal(resolution.person.status, 'resolved');
  assert.equal(resolution.person.id, existingResolution.person.id);
  assert.deepEqual(resolution.duplicateContactLeadIds, ['linkedin-1']);
  assert.match(duplicateContactWarning(resolution) ?? '', /linkedin-1/);
}

{
  const existing = lead('email-1', {
    source: 'linkedin',
    contactEmail: 'Partner@Example.com',
    contactName: 'Ayesha Khan',
    companyName: 'Example Labs',
  });
  const storedExisting = attachIdentityResolution(existing, resolveLeadIdentity(existing, [], now));
  const incoming = lead('email-2', {
    source: 'upwork',
    contactEmail: 'partner@example.com',
    contactName: 'A. Khan',
  });
  const resolution = resolveLeadIdentity(incoming, [storedExisting], now);
  assert.equal(resolution.person.status, 'resolved');
  assert.deepEqual(resolution.person.matchedLeadIds, ['email-1']);
}

{
  const first = lead('weak-1', {
    contactName: 'Ali Raza',
    companyName: 'Orbit Systems Pvt Ltd',
    contactRole: 'Chief Technology Officer',
  });
  const incoming = lead('weak-2', {
    contactName: 'Ali Raza',
    companyName: 'Orbit Systems',
    contactRole: 'Chief Technology Officer',
  });
  const firstResolution = resolveLeadIdentity(first, [], now);
  const resolution = resolveLeadIdentity(incoming, [attachIdentityResolution(first, firstResolution)], now);
  assert.equal(resolution.person.status, 'candidate');
  assert.deepEqual(resolution.person.candidateLeadIds, ['weak-1']);
  assert.notEqual(resolution.person.id, firstResolution.person.id);
  assert.equal(resolution.automaticMergePerformed, false);
}

{
  const first = lead('company-1', {
    companyName: 'Acme Financial Technologies',
    companyWebsite: 'https://www.acmefintech.example/products',
  });
  const firstResolution = resolveLeadIdentity(first, [], now);
  const incoming = lead('company-2', {
    companyName: 'Acme FinTech',
    companyWebsite: 'acmefintech.example',
  });
  const resolution = resolveLeadIdentity(incoming, [attachIdentityResolution(first, firstResolution)], now);
  assert.equal(resolution.company.status, 'resolved');
  assert.equal(resolution.company.id, firstResolution.company.id);
  assert.deepEqual(resolution.company.matchedLeadIds, ['company-1']);
}

{
  const baseA = lead('conflict-a', { contactEmail: 'shared@example.com' });
  const baseB = lead('conflict-b', { contactEmail: 'shared@example.com' });
  const resolutionA = attachIdentityResolution(baseA, fakeResolution('person-a', 'company-a'));
  const resolutionB = attachIdentityResolution(baseB, fakeResolution('person-b', 'company-b'));
  const incoming = lead('conflict-incoming', { contactEmail: 'shared@example.com' });
  const resolution = resolveLeadIdentity(incoming, [resolutionA, resolutionB], now);
  assert.equal(resolution.person.status, 'conflict');
  assert.equal(resolution.conflicts.length, 1);
  assert.equal(resolution.automaticMergePerformed, false);
}

{
  const original = lead('attach-1', {
    rawPayload: { parserVersion: 'fixture-v1' },
    linkedinUrl: 'https://www.linkedin.com/in/example-person/',
  });
  const resolution = resolveLeadIdentity(original, [], now);
  const attached = attachIdentityResolution(original, resolution);
  assert.equal((attached.rawPayload as Record<string, unknown>).parserVersion, 'fixture-v1');
  assert.equal(readIdentityResolution(attached)?.version, IDENTITY_GRAPH_VERSION);
}

function fakeResolution(personId: string, companyId: string): LeadIdentityResolution {
  return {
    version: IDENTITY_GRAPH_VERSION,
    resolvedAt: now,
    person: {
      id: personId,
      status: 'resolved',
      confidence: 'high',
      matchedLeadIds: [],
      candidateLeadIds: [],
      evidence: [],
      reason: 'fixture',
    },
    company: {
      id: companyId,
      status: 'resolved',
      confidence: 'high',
      matchedLeadIds: [],
      candidateLeadIds: [],
      evidence: [],
      reason: 'fixture',
    },
    duplicateContactLeadIds: [],
    conflicts: [],
    automaticMergePerformed: false,
  };
}

console.log('Identity graph tests passed.');
