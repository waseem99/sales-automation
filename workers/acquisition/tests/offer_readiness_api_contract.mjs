import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(process.cwd(), '..', '..');
const readiness = readFileSync(resolve(root, 'packages/commercial-readiness/src/index.ts'), 'utf8');
const outreachApi = readFileSync(resolve(root, 'api/outreach-workbench.ts'), 'utf8');
const campaignRuntime = readFileSync(resolve(root, 'vercel/acquisition-campaign-runtime.ts'), 'utf8');
const outreachUi = readFileSync(resolve(root, 'vercel/outreach-workbench-ui.ts'), 'utf8');

for (const status of [
  'draft',
  'research_only',
  'pilot_ready',
  'outreach_ready_limited',
  'outreach_ready',
  'retired',
]) {
  assert(readiness.includes(`'${status}'`), `Missing readiness status: ${status}`);
}

for (const marker of [
  'actionableQualificationAllowed',
  'draftAllowed',
  'approvalAllowed',
  'offerVersion',
  'readinessVersion',
  'applyCommercialReadinessToQualification',
  'assertCommerciallyReadyForDraft',
  'assertCommerciallyReadyForApproval',
  'assertOfferReadinessPinCurrent',
  'transitionOfferReadiness',
  'OfferReadinessAuditEvent',
]) {
  assert(readiness.includes(marker), `Commercial readiness contract is missing ${marker}`);
}

assert(campaignRuntime.includes('applyCommercialReadinessToQualification(matchedLead)'));
assert(campaignRuntime.includes('commercialReadinessBlocked'));
assert(campaignRuntime.includes('commercialReadinessDecision'));

for (const marker of [
  'assertCommerciallyReadyForDraft(record.lead)',
  'assertCommerciallyReadyForApproval(record.lead)',
  "assertDraftPinCurrent(existing, draftId, commercialReadiness, 'draft')",
  "assertDraftPinCurrent(existing, draftId, commercialReadiness, 'approval')",
  'pinNewDrafts(snapshot, existingDraftIds, commercialReadiness, generatedAt)',
  'Only the exact approved revision can be copied or marked as manually sent.',
]) {
  assert(outreachApi.includes(marker), `Outreach API contract is missing ${marker}`);
}

assert(outreachUi.includes('Commercial readiness'));
assert(outreachUi.includes('Approval blockers'));
assert(outreachUi.includes('readiness.offerName'));

const combined = `${readiness}\n${outreachApi}\n${campaignRuntime}`.toLowerCase();
for (const prohibited of [
  'automaticsendingenabled: true',
  'externalactionperformedbysystem: true',
  'externalactionautomated: true',
]) {
  assert(!combined.includes(prohibited), `Automatic external-action boundary violated: ${prohibited}`);
}

console.log('Offer readiness API contract passed.');
