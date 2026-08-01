import assert from 'node:assert/strict';
import {
  assertCommercialSelectionPinExists,
  DEFAULT_COMMERCIAL_CATALOGUE,
  evaluateCommercialDisqualifiers,
  latestOfferVersion,
  pinCommercialSelection,
  publishOfferVersion,
  publishProofPackVersion,
  selectCommercialEvidence,
  type CommercialCatalogue,
  type OfferVersionInput,
  type ProofPackVersionInput,
} from './index.js';

const asOf = '2026-07-31T12:00:00.000Z';

{
  const direct = selectCommercialEvidence(DEFAULT_COMMERCIAL_CATALOGUE, {
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'direct_buyer',
    serviceCategories: ['fullstack_web_app'],
    evaluatedAt: asOf,
  });
  const delivery = selectCommercialEvidence(DEFAULT_COMMERCIAL_CATALOGUE, {
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'delivery_partner',
    serviceCategories: ['cybersecurity'],
    evaluatedAt: asOf,
  });
  assert.deepEqual(direct.proof.map((item) => item.proofId), ['acmetel-product', 'secp-ux']);
  assert.deepEqual(delivery.proof.map((item) => item.proofId), ['iso-security']);
  assert.equal(direct.offer.offerVersion, 1);
  assert.equal(direct.proofPack?.proofPackVersion, 1);
  assert.ok(direct.proof.every((item) => item.proofVersion === 1 && item.proofContentHash.length === 64));
  assert.equal(direct.externalActionAutomated, false);
  assert.equal(direct.humanReviewRequired, true);
}

{
  const offer = latestOfferVersion(DEFAULT_COMMERCIAL_CATALOGUE, 'managed_software_ai_delivery');
  assert.ok(offer);
  assert.equal(Object.isFrozen(offer), true);
  assert.equal(Object.isFrozen(offer.approvedRoutes), true);
  assert.throws(() => {
    (offer as {name: string}).name = 'Mutated in place';
  }, TypeError);
  assert.throws(() => publishOfferVersion(DEFAULT_COMMERCIAL_CATALOGUE, {
    ...offer,
    version: 1,
    publishedAt: asOf,
    publishedBy: 'reviewer@codistan.org',
  }), /already published and cannot be mutated in place/i);
}

{
  const v1Selection = selectCommercialEvidence(DEFAULT_COMMERCIAL_CATALOGUE, {
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'delivery_partner',
    evaluatedAt: asOf,
  });
  const historicalPin = pinCommercialSelection(v1Selection, asOf);
  const v2Input: OfferVersionInput = {
    offerId: 'managed_software_ai_delivery',
    version: 2,
    name: 'Managed Software and AI Delivery Partnership — Focused Pods',
    owner: 'Waseem',
    approvedRoutes: ['direct_buyer', 'delivery_partner'],
    serviceCategories: ['ai_automation', 'fullstack_web_app', 'cybersecurity'],
    minimumValueUsd: 5000,
    supportedGeographies: [],
    minimumTimelineDays: 21,
    supportedStacks: [],
    prohibitedIndustries: ['illegal gambling', 'sanctions evasion'],
    capacityAvailable: true,
    positioning: ['Focused managed pods with accountable delivery ownership.'],
    limitations: ['Scope, capacity and mobilisation require human confirmation.'],
    publishedAt: '2026-08-01T00:00:00.000Z',
    publishedBy: 'reviewer@codistan.org',
  };
  const catalogueV2 = publishOfferVersion(DEFAULT_COMMERCIAL_CATALOGUE, v2Input);
  assert.equal(latestOfferVersion(catalogueV2, v2Input.offerId)?.version, 2);
  assert.equal(catalogueV2.offers.filter((item) => item.offerId === v2Input.offerId).length, 2);
  assert.equal(assertCommercialSelectionPinExists(catalogueV2, historicalPin), historicalPin);
  assert.equal(historicalPin.offer.offerVersion, 1, 'new version must not rewrite historical selection');
}

{
  const expiredPackInput: ProofPackVersionInput = {
    proofPackId: 'managed_delivery_proof',
    version: 2,
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    approvedBy: 'reviewer@codistan.org',
    approvedAt: '2026-07-31T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
    routeProofIds: {delivery_partner: ['expired-proof']},
    proofs: [{
      proofId: 'expired-proof',
      version: 1,
      title: 'Expired delivery evidence',
      approved: true,
      approvedBy: 'reviewer@codistan.org',
      approvedAt: '2026-07-31T00:00:00.000Z',
      validFrom: '2026-07-01T00:00:00.000Z',
      expiresAt: '2026-08-01T00:00:00.000Z',
      serviceCategories: ['fullstack_web_app'],
      provenance: [{type: 'case_study', reference: 'test:expired-proof', owner: 'Codistan', capturedAt: '2026-07-31T00:00:00.000Z'}],
      limitations: [],
    }],
  };
  const catalogue = publishProofPackVersion(DEFAULT_COMMERCIAL_CATALOGUE, expiredPackInput);
  const beforeExpiry = selectCommercialEvidence(catalogue, {
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'delivery_partner',
    serviceCategories: ['fullstack_web_app'],
    evaluatedAt: '2026-07-31T12:00:00.000Z',
  });
  assert.deepEqual(beforeExpiry.proof.map((item) => item.proofId), ['expired-proof']);
  const afterExpiry = selectCommercialEvidence(catalogue, {
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'delivery_partner',
    serviceCategories: ['fullstack_web_app'],
    evaluatedAt: '2026-08-02T00:00:00.000Z',
  });
  assert.ok(!afterExpiry.proof.some((item) => item.proofId === 'expired-proof'));
  assert.ok(afterExpiry.proof.every((item) => item.expiresAt === undefined || Date.parse(item.expiresAt) > Date.parse('2026-08-02T00:00:00.000Z')));
}

{
  const offer = latestOfferVersion(DEFAULT_COMMERCIAL_CATALOGUE, 'managed_software_ai_delivery')!;
  const findings = evaluateCommercialDisqualifiers(offer, {
    estimatedValueUsd: 500,
    geography: 'Global',
    timelineDays: 2,
    requiredStacks: [],
    compensationModel: 'commission_only',
    registrationRequirementMet: false,
    industry: 'illegal gambling',
    engagementType: 'full_time_employment',
    capacityAvailable: false,
  });
  assert.deepEqual(findings.map((item) => item.code), [
    'below_minimum_value',
    'unrealistic_timeline',
    'unpaid_or_commission_only',
    'unmet_registration_requirement',
    'prohibited_industry',
    'full_time_hiring',
    'unavailable_capacity',
  ]);
  assert.ok(findings.every((item) => item.blocking && item.explanation.length > 20 && item.evidence.length > 0));
  const selection = selectCommercialEvidence(DEFAULT_COMMERCIAL_CATALOGUE, {
    offerId: offer.offerId,
    offerVersion: offer.version,
    route: 'delivery_partner',
    signals: {estimatedValueUsd: 500},
    evaluatedAt: asOf,
  });
  assert.equal(selection.commerciallyActionable, false);
  assert.equal(selection.disqualifiers[0]?.code, 'below_minimum_value');
}

{
  const unsupported: CommercialCatalogue = {
    ...DEFAULT_COMMERCIAL_CATALOGUE,
    version: 'commercial-catalogue.v0' as typeof DEFAULT_COMMERCIAL_CATALOGUE.version,
  };
  assert.throws(() => selectCommercialEvidence(unsupported, {
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'delivery_partner',
  }), /unsupported commercial catalogue version/i);
  assert.throws(() => selectCommercialEvidence(DEFAULT_COMMERCIAL_CATALOGUE, {
    offerId: 'fintech_operations_platform',
    offerVersion: 1,
    route: 'delivery_partner',
  }), /route delivery_partner is not approved/i);
}

console.log('Commercial catalogue tests passed.');
