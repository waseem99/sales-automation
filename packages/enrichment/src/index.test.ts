import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import {
  attachEnrichmentSnapshot,
  buildEvidenceBasedEnrichment,
  ENRICHMENT_VERSION,
  enrichmentStateEqual,
  readEnrichmentSnapshot,
  type EnrichmentSnapshot,
} from './index.js';

const now = '2026-07-24T16:00:00.000Z';

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'linkedin',
    sourceUrl: `https://www.linkedin.com/posts/${id}`,
    leadType: 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    title: `Opportunity ${id}`,
    description: `Visible commercial evidence for ${id} requiring a technology delivery partner.`,
    serviceCategory: 'fullstack_web_app',
    capturedAt: now,
    pipelineStatus: 'needs_human_review',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

{
  const input = lead('candidate-email', {
    contactName: 'Ayesha Khan',
    contactRole: 'Chief Technology Officer',
    contactEmail: 'ayesha@example.com',
    companyName: 'Example Technologies',
    companyWebsite: 'https://example.com',
    linkedinUrl: 'https://www.linkedin.com/in/ayesha-khan/',
  });
  const snapshot = buildEvidenceBasedEnrichment(input, undefined, now);
  assert.equal(snapshot.person.email?.value, 'ayesha@example.com');
  assert.equal(snapshot.person.email?.verificationStatus, 'candidate');
  assert.equal(snapshot.person.email?.provenance, 'source_visible');
  assert(snapshot.tasks.some((task) => task.code === 'verify_business_email'));
  assert(!snapshot.tasks.some((task) => task.code === 'find_company_domain'));
  assert.equal(snapshot.contactability, 'contactable_after_review');
  assert.equal(snapshot.externalActionPerformed, false);
}

{
  const input = lead('verified-email', {
    contactEmail: 'verified@example.com',
    rawPayload: { enrichment: { emailStatus: 'verified' } },
  });
  const snapshot = buildEvidenceBasedEnrichment(input, undefined, now);
  assert.equal(snapshot.person.email?.verificationStatus, 'verified');
  assert.equal(snapshot.person.email?.provenance, 'verified');
  assert(!snapshot.tasks.some((task) => task.code === 'verify_business_email'));
}

{
  const input = lead('no-email', {
    companyName: 'Research Needed Ltd',
    contactName: 'Decision Maker',
    contactRole: 'COO',
  });
  const snapshot = buildEvidenceBasedEnrichment(input, undefined, now);
  assert(snapshot.tasks.some((task) => task.code === 'find_company_domain'));
  assert(snapshot.tasks.some((task) => task.code === 'find_business_email'));
  assert(snapshot.tasks.some((task) => task.code === 'verify_relationship_path'));
  assert.equal(snapshot.providerMode.mode, 'source_visible_only');
  assert.deepEqual(snapshot.providerMode.activeProviders, []);
  assert.equal(snapshot.providerMode.credentialsExposed, false);
}

{
  const input = lead('upwork-route', {
    source: 'upwork',
    sourceUrl: 'https://www.upwork.com/jobs/~0123456789abcdef',
    leadType: 'upwork_job',
    linkedinUrl: undefined,
  });
  const snapshot = buildEvidenceBasedEnrichment(input, undefined, now);
  const route = snapshot.contactRoutes.find((item) => item.channel === 'upwork');
  assert.equal(route?.status, 'platform_restricted');
  assert.match(route?.restriction ?? '', /Do not infer or use an off-platform route/);
}

{
  const input = lead('suppressed', {
    contactEmail: 'blocked@example.com',
    rawPayload: { doNotContact: true, suppressionReason: 'Requested no further contact' },
  });
  const snapshot = buildEvidenceBasedEnrichment(input, undefined, now);
  assert.equal(snapshot.suppression.suppressed, true);
  assert.equal(snapshot.contactability, 'suppressed');
  assert.equal(snapshot.tasks.length, 0);
  assert(snapshot.contactRoutes.every((route) => route.status === 'suppressed'));
}

{
  const input = lead('signals', {
    companyName: 'LaunchCo',
    rawPayload: {
      rawEvidence: {
        fundingSignal: 'Series A announced',
        productLaunch: 'New payments platform',
      },
      salesNavigatorEvidence: {
        mutualConnections: ['Ali Raza', 'Sara Khan'],
        teamLink: true,
      },
    },
  });
  const snapshot = buildEvidenceBasedEnrichment(input, undefined, now);
  assert(snapshot.signals.some((signal) => signal.code === 'funding'));
  assert(snapshot.signals.some((signal) => signal.code === 'product_launch'));
  assert.deepEqual(snapshot.person.mutualConnections?.value, ['Ali Raza', 'Sara Khan']);
  assert.equal(snapshot.person.teamLink?.value, true);
}

{
  const input = lead('human-precedence', {
    contactEmail: 'candidate@example.com',
  });
  const initial = buildEvidenceBasedEnrichment(input, undefined, now);
  const previous: EnrichmentSnapshot = {
    ...initial,
    person: {
      ...initial.person,
      email: {
        value: 'confirmed@example.com',
        provenance: 'human_confirmed',
        confidence: 'high',
        verificationStatus: 'verified',
        observedAt: '2026-07-20T00:00:00.000Z',
        expiresAt: '2027-01-16T00:00:00.000Z',
        notes: 'Confirmed by BD manager',
      },
    },
  };
  const merged = buildEvidenceBasedEnrichment(input, previous, '2026-07-25T00:00:00.000Z');
  assert.equal(merged.person.email?.value, 'confirmed@example.com');
  assert.equal(merged.person.email?.provenance, 'human_confirmed');
}

{
  const input = lead('attachment', {
    rawPayload: { parserVersion: 'fixture-v1' },
    companyWebsite: 'https://attachment.example',
  });
  const snapshot = buildEvidenceBasedEnrichment(input, undefined, now);
  const attached = attachEnrichmentSnapshot(input, snapshot);
  const raw = attached.rawPayload as Record<string, unknown>;
  assert.equal(raw.parserVersion, 'fixture-v1');
  assert.equal(raw.enrichmentVersion, ENRICHMENT_VERSION);
  assert.equal(readEnrichmentSnapshot(attached)?.company.domain?.value, 'attachment.example');
  assert(enrichmentStateEqual(snapshot, buildEvidenceBasedEnrichment(input, snapshot, '2026-07-25T00:00:00.000Z')));
}

{
  const input = lead('no-fabrication');
  const snapshot = buildEvidenceBasedEnrichment(input, undefined, now);
  assert.equal(snapshot.person.email, undefined);
  assert(!snapshot.contactRoutes.some((route) => route.channel === 'email'));
}

console.log('Evidence enrichment tests passed.');
