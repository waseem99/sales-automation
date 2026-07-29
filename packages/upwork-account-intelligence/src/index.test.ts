import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import {
  attachUpworkAccountIntelligence,
  deriveUpworkAccountIntelligence,
  UPWORK_ACCOUNT_INTELLIGENCE_VERSION,
} from './index.js';

const now = '2026-07-26T12:00:00.000Z';

function job(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    source: 'upwork',
    sourceUrl: `https://www.upwork.com/jobs/~${id.padEnd(16, '0')}`,
    leadType: 'upwork_job',
    prospectStage: 'warm_lead',
    title: 'AI software delivery project',
    description: 'A software agency needs overflow engineering and white-label AI implementation capacity for recurring client work.',
    companyName: undefined,
    contactName: undefined,
    contactRole: undefined,
    serviceCategory: 'fullstack_web_app',
    opportunityStatus: 'live_opportunity',
    capturedAt: now,
    pipelineStatus: 'needs_human_review',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

{
  const input = job('anonymous');
  const intelligence = deriveUpworkAccountIntelligence(input, [input], now);
  assert.equal(intelligence.status, 'job_only');
  assert.equal(intelligence.identityStrength, 'none');
  assert.equal(intelligence.accountLead, undefined);
  assert(intelligence.risks.some((risk) => /anonymous/i.test(risk)));
}

{
  const first = job('stablebuyer1', {
    companyName: 'Northstar AI Agency',
    contactName: 'Ayesha Khan',
    contactRole: 'Founder',
    country: 'United States',
    rawPayload: {
      commercialEvidence: {
        buyer_id: 'buyer-visible-42',
        payment_verified: true,
        client_spend_usd: 85000,
        hire_rate_percent: 72,
        engagement_type: 'hourly',
      },
    },
  });
  const second = job('stablebuyer2', {
    title: 'Full-stack implementation team for client projects',
    description: 'The same AI agency requires managed delivery, engineering capacity and implementation support for recurring client work.',
    companyName: 'Northstar AI Agency',
    contactName: 'Ayesha Khan',
    contactRole: 'Founder',
    rawPayload: {commercialEvidence: {buyer_id: 'buyer-visible-42'}},
  });
  const intelligence = deriveUpworkAccountIntelligence(first, [first, second], now);
  assert.equal(intelligence.status, 'eligible');
  assert.equal(intelligence.identityStrength, 'high');
  assert.equal(intelligence.buyerEvidence.linkedJobIds.length, 2);
  assert.equal(intelligence.buyerEvidence.paymentVerified, true);
  assert.equal(intelligence.accountLead?.source, 'partner_research');
  assert.equal(intelligence.accountLead?.leadType, 'partner_prospect');
  assert.equal(intelligence.accountLead?.prospectStage, 'partner_prospect');
  assert.equal(intelligence.accountLead?.opportunityStatus, 'partnership_target');
  assert.equal((intelligence.accountLead?.rawPayload as Record<string, unknown>).explicitBuyerIntentConfirmed, false);
  assert(intelligence.campaignMatches.some((match) => match.route === 'delivery_partner'));
  assert(intelligence.campaignMatches.every((match) => match.explicitBuyerIntentConfirmed === false));
}

{
  const input = job('domainbuyer', {
    companyName: 'FinOps Platform Ltd',
    companyWebsite: 'https://finops.example.com',
    contactName: 'Omar Shah',
    contactRole: 'COO',
    country: 'United Arab Emirates',
    title: 'Banking operations workflow automation platform',
    description: 'Fintech operations, onboarding, reconciliation, integrations and AI workflow automation are required for a financial platform.',
  });
  const intelligence = deriveUpworkAccountIntelligence(input, [input], now);
  assert.notEqual(intelligence.status, 'job_only');
  assert.equal(intelligence.identityStrength, 'high');
  assert.equal(intelligence.buyerEvidence.companyDomain, 'finops.example.com');
  assert(intelligence.campaignMatches.some((match) => match.route === 'direct_buyer'));
}

{
  const input = job('suppressedbuyer', {
    companyName: 'Blocked Agency',
    rawPayload: {
      commercialEvidence: {buyer_id: 'blocked-buyer'},
      enrichment: {suppression: {suppressed: true, reason: 'Requested no further contact'}},
    },
  });
  const intelligence = deriveUpworkAccountIntelligence(input, [input], now);
  assert.equal(intelligence.status, 'suppressed');
  assert.equal(intelligence.accountLead, undefined);
  assert(intelligence.risks.some((risk) => /no further contact/i.test(risk)));
}

{
  const input = job('attached', {
    companyName: 'Attached Agency',
    contactRole: 'Founder',
    rawPayload: {parserVersion: 'upwork-extension-test', commercialEvidence: {buyer_id: 'attached-buyer'}},
  });
  const intelligence = deriveUpworkAccountIntelligence(input, [input], now);
  const attached = attachUpworkAccountIntelligence(input, intelligence);
  const raw = attached.rawPayload as Record<string, unknown>;
  assert.equal(raw.parserVersion, 'upwork-extension-test');
  assert.equal(raw.upworkAccountIntelligenceVersion, UPWORK_ACCOUNT_INTELLIGENCE_VERSION);
  assert.equal((raw.upworkAccountIntelligence as Record<string, unknown>).externalActionPerformed, false);
}

console.log('Upwork account intelligence tests passed.');
