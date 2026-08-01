import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  DEFAULT_COMMERCIAL_CATALOGUE,
  pinCommercialSelection,
  selectCommercialEvidence,
} from '../../../packages/commercial-catalogue/src/index.js';

const cwd = process.cwd();
const root = existsSync(resolve(cwd, 'api/acquisition-ingest.ts')) ? cwd : resolve(cwd, '..', '..');
const api = readFileSync(resolve(root, 'api/acquisition-ingest.ts'), 'utf8');
const runtime = readFileSync(resolve(root, 'vercel/acquisition-commercial-catalogue-runtime.ts'), 'utf8');
const catalogue = readFileSync(resolve(root, 'packages/commercial-catalogue/src/index.ts'), 'utf8');

const campaignCall = 'const campaignResponse = await applyCampaignEngineAfterIntake';
const catalogueCall = 'const catalogueResponse = await applyCommercialCatalogueAfterIntake';
const accountCall = 'const accountResponse = await applyUpworkAccountIntelligenceAfterIntake';
const reconciliationCall = 'const reconciliationResponse = await attachAcquisitionReconciliation';
const syncHealthCall = 'return applySyncHealthAfterReconciliation';
assert(api.indexOf(campaignCall) >= 0);
assert(api.indexOf(catalogueCall) > api.indexOf(campaignCall));
assert(api.indexOf(accountCall) > api.indexOf(catalogueCall));
assert(api.indexOf(reconciliationCall) > api.indexOf(accountCall));
assert(api.indexOf(syncHealthCall) > api.indexOf(reconciliationCall));

for (const marker of [
  'commercialCatalogueSelection',
  'commercialCataloguePin',
  'offerContentHash',
  'proofPackContentHash',
  'proofVersions',
  'commercialDisqualifierCodes',
  "status: primarySelection?.commerciallyActionable ? draft.status : 'needs_review'",
  "disposition: downgraded ? 'research' : recommendation.disposition",
  'saveEvaluation(applied.evaluation, ACTOR)',
  'humanReviewRequired: true',
  'externalActionAutomated: false',
]) {
  assert(runtime.includes(marker), `Commercial catalogue runtime is missing ${marker}`);
}

for (const marker of [
  "COMMERCIAL_CATALOGUE_VERSION = 'commercial-catalogue.v1'",
  'publishOfferVersion',
  'publishProofPackVersion',
  'cannot be mutated in place',
  'contentHash',
  'routeProofIds',
  'expiresAt',
  'ProofProvenance',
  'below_minimum_value',
  'unsupported_geography',
  'unrealistic_timeline',
  'unsupported_stack',
  'unpaid_or_commission_only',
  'unmet_registration_requirement',
  'prohibited_industry',
  'full_time_hiring',
  'unavailable_capacity',
]) {
  assert(catalogue.includes(marker), `Commercial catalogue is missing ${marker}`);
}

const selection = selectCommercialEvidence(DEFAULT_COMMERCIAL_CATALOGUE, {
  offerId: 'managed_software_ai_delivery',
  offerVersion: 1,
  route: 'delivery_partner',
  serviceCategories: ['cybersecurity'],
  signals: {
    estimatedValueUsd: 12000,
    timelineDays: 45,
    compensationModel: 'paid',
    engagementType: 'outsourced_delivery',
    capacityAvailable: true,
  },
  evaluatedAt: '2026-07-31T12:00:00.000Z',
});
assert.equal(selection.commerciallyActionable, true);
assert.deepEqual(selection.proof.map((item) => item.proofId), ['iso-security']);
assert.ok(selection.proof.every((item) => item.provenance.length > 0));
assert.ok(selection.proof.every((item) => item.proofContentHash.length === 64));
const pin = pinCommercialSelection(selection, '2026-07-31T12:01:00.000Z');
assert.equal(pin.offer.offerVersion, 1);
assert.equal(pin.proofPack?.proofPackVersion, 1);
assert.deepEqual(pin.proof.map((item) => `${item.proofId}@${item.proofVersion}`), ['iso-security@1']);
assert.equal(Object.isFrozen(pin), true);

const blocked = selectCommercialEvidence(DEFAULT_COMMERCIAL_CATALOGUE, {
  offerId: 'managed_software_ai_delivery',
  offerVersion: 1,
  route: 'delivery_partner',
  signals: {
    estimatedValueUsd: 500,
    timelineDays: 2,
    compensationModel: 'unpaid',
    engagementType: 'full_time_employment',
    capacityAvailable: false,
  },
  evaluatedAt: '2026-07-31T12:00:00.000Z',
});
assert.equal(blocked.commerciallyActionable, false);
assert.deepEqual(blocked.disqualifiers.map((item) => item.code), [
  'below_minimum_value',
  'unrealistic_timeline',
  'unpaid_or_commission_only',
  'full_time_hiring',
  'unavailable_capacity',
]);
assert.ok(blocked.disqualifiers.every((item) => item.explanation && item.evidence.length > 0));

const combined = `${api}\n${runtime}\n${catalogue}`.toLowerCase();
for (const prohibited of [
  'externalactionautomated: true',
  'external_action_performed: true',
  'automaticsendingenabled: true',
]) {
  assert(!combined.includes(prohibited), `Automatic external-action boundary violated: ${prohibited}`);
}

console.log('Commercial catalogue integration contract passed.');
