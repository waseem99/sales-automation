import {createHash} from 'node:crypto';
import type {Lead, ServiceCategory} from '@sales-automation/shared';

export const COMMERCIAL_CATALOGUE_VERSION = 'commercial-catalogue.v1';

export type CommercialRoute = 'direct_buyer' | 'channel_partner' | 'delivery_partner' | 'referral_partner';
export type PublicationState = 'published' | 'retired';
export type ProofProvenanceType = 'case_study' | 'contract' | 'client_reference' | 'delivery_artifact' | 'capability_evidence';
export type CompensationModel = 'paid' | 'unpaid' | 'commission_only' | 'unknown';
export type EngagementType = 'outsourced_delivery' | 'project' | 'retainer' | 'managed_service' | 'full_time_employment' | 'unknown';

export type CommercialDisqualifierCode =
  | 'below_minimum_value'
  | 'unsupported_geography'
  | 'unrealistic_timeline'
  | 'unsupported_stack'
  | 'unpaid_or_commission_only'
  | 'unmet_registration_requirement'
  | 'prohibited_industry'
  | 'full_time_hiring'
  | 'unavailable_capacity';

export interface CommercialDisqualifier {
  code: CommercialDisqualifierCode;
  explanation: string;
  evidence: string[];
  blocking: true;
}

export interface OfferVersionInput {
  offerId: string;
  version: number;
  name: string;
  owner: string;
  approvedRoutes: CommercialRoute[];
  serviceCategories: ServiceCategory[];
  minimumValueUsd?: number;
  supportedGeographies?: string[];
  minimumTimelineDays?: number;
  supportedStacks?: string[];
  prohibitedIndustries?: string[];
  capacityAvailable?: boolean;
  positioning: string[];
  limitations: string[];
  publishedAt: string;
  publishedBy: string;
  state?: PublicationState;
}

export interface OfferVersion extends Readonly<Omit<OfferVersionInput, 'state'>> {
  readonly state: PublicationState;
  readonly contentHash: string;
}

export interface ProofProvenance {
  type: ProofProvenanceType;
  reference: string;
  owner: string;
  capturedAt: string;
  notes?: string;
}

export interface ProofItemVersionInput {
  proofId: string;
  version: number;
  title: string;
  approved: boolean;
  approvedBy: string;
  approvedAt: string;
  validFrom: string;
  expiresAt?: string;
  serviceCategories: ServiceCategory[];
  provenance: ProofProvenance[];
  limitations: string[];
}

export interface ProofItemVersion extends Readonly<ProofItemVersionInput> {
  readonly contentHash: string;
}

export interface ProofPackVersionInput {
  proofPackId: string;
  version: number;
  offerId: string;
  offerVersion: number;
  state?: PublicationState;
  approvedBy: string;
  approvedAt: string;
  expiresAt?: string;
  routeProofIds: Partial<Record<CommercialRoute, string[]>>;
  proofs: ProofItemVersionInput[];
}

export interface ProofPackVersion extends Readonly<Omit<ProofPackVersionInput, 'state' | 'proofs'>> {
  readonly state: PublicationState;
  readonly proofs: readonly ProofItemVersion[];
  readonly contentHash: string;
}

export interface CommercialCatalogue {
  readonly version: typeof COMMERCIAL_CATALOGUE_VERSION;
  readonly offers: readonly OfferVersion[];
  readonly proofPacks: readonly ProofPackVersion[];
}

export interface CommercialSignals {
  estimatedValueUsd?: number;
  geography?: string;
  timelineDays?: number;
  requiredStacks?: string[];
  compensationModel?: CompensationModel;
  registrationRequirementMet?: boolean;
  industry?: string;
  engagementType?: EngagementType;
  capacityAvailable?: boolean;
}

export interface OfferVersionPin {
  offerId: string;
  offerVersion: number;
  offerContentHash: string;
}

export interface ProofPackVersionPin {
  proofPackId: string;
  proofPackVersion: number;
  proofPackContentHash: string;
}

export interface ProofVersionPin {
  proofId: string;
  proofVersion: number;
  proofContentHash: string;
  title: string;
  limitations: string[];
  provenance: ProofProvenance[];
  expiresAt?: string;
}

export interface CommercialSelection {
  catalogueVersion: typeof COMMERCIAL_CATALOGUE_VERSION;
  offer: OfferVersionPin;
  route: CommercialRoute;
  proofPack?: ProofPackVersionPin;
  proof: ProofVersionPin[];
  excludedProof: Array<{proofId: string; reason: string}>;
  disqualifiers: CommercialDisqualifier[];
  commerciallyActionable: boolean;
  evaluatedAt: string;
  humanReviewRequired: true;
  externalActionAutomated: false;
}

export interface CommercialSelectionPin {
  catalogueVersion: typeof COMMERCIAL_CATALOGUE_VERSION;
  offer: OfferVersionPin;
  route: CommercialRoute;
  proofPack?: ProofPackVersionPin;
  proof: ProofVersionPin[];
  disqualifierCodes: CommercialDisqualifierCode[];
  pinnedAt: string;
}

const DISQUALIFIER_EXPLANATIONS: Record<CommercialDisqualifierCode, string> = {
  below_minimum_value: 'The available commercial value is below the published minimum for this offer version.',
  unsupported_geography: 'The opportunity is in a geography not supported by this offer version.',
  unrealistic_timeline: 'The requested delivery timeline is shorter than the published minimum viable timeline.',
  unsupported_stack: 'The opportunity requires a stack outside the published supported-stack boundary.',
  unpaid_or_commission_only: 'The opportunity is unpaid or commission-only and is not commercially eligible.',
  unmet_registration_requirement: 'A mandatory registration or eligibility requirement is not met.',
  prohibited_industry: 'The opportunity belongs to an industry prohibited by this offer version.',
  full_time_hiring: 'The request is for full-time employment rather than outsourced or managed delivery.',
  unavailable_capacity: 'Current delivery capacity is not available for this opportunity.',
};

export function publishOfferVersion(
  catalogue: CommercialCatalogue,
  input: OfferVersionInput,
): CommercialCatalogue {
  validateCatalogueVersion(catalogue);
  const sameOffer = catalogue.offers.filter((item) => item.offerId === input.offerId);
  const latest = sameOffer.reduce((highest, item) => Math.max(highest, item.version), 0);
  if (sameOffer.some((item) => item.version === input.version)) {
    throw new Error(`Offer ${input.offerId} version ${input.version} is already published and cannot be mutated in place.`);
  }
  if (input.version !== latest + 1) {
    throw new Error(`Offer ${input.offerId} must publish version ${latest + 1}; received ${input.version}.`);
  }
  const offer = createOfferVersion(input);
  return freezeCatalogue({
    version: COMMERCIAL_CATALOGUE_VERSION,
    offers: [...catalogue.offers, offer],
    proofPacks: catalogue.proofPacks,
  });
}

export function publishProofPackVersion(
  catalogue: CommercialCatalogue,
  input: ProofPackVersionInput,
): CommercialCatalogue {
  validateCatalogueVersion(catalogue);
  requirePublishedOffer(catalogue, input.offerId, input.offerVersion);
  const samePack = catalogue.proofPacks.filter((item) => item.proofPackId === input.proofPackId);
  const latest = samePack.reduce((highest, item) => Math.max(highest, item.version), 0);
  if (samePack.some((item) => item.version === input.version)) {
    throw new Error(`Proof pack ${input.proofPackId} version ${input.version} is already published and cannot be mutated in place.`);
  }
  if (input.version !== latest + 1) {
    throw new Error(`Proof pack ${input.proofPackId} must publish version ${latest + 1}; received ${input.version}.`);
  }
  const pack = createProofPackVersion(input);
  return freezeCatalogue({
    version: COMMERCIAL_CATALOGUE_VERSION,
    offers: catalogue.offers,
    proofPacks: [...catalogue.proofPacks, pack],
  });
}

export function selectCommercialEvidence(
  catalogue: CommercialCatalogue,
  input: {
    offerId: string;
    offerVersion: number;
    route: CommercialRoute;
    signals?: CommercialSignals;
    serviceCategories?: ServiceCategory[];
    evaluatedAt?: string;
  },
): CommercialSelection {
  validateCatalogueVersion(catalogue);
  const evaluatedAt = validIso(input.evaluatedAt ?? new Date().toISOString(), 'evaluatedAt');
  const offer = requirePublishedOffer(catalogue, input.offerId, input.offerVersion);
  if (!offer.approvedRoutes.includes(input.route)) {
    throw new Error(`Route ${input.route} is not approved for offer ${offer.offerId} version ${offer.version}.`);
  }
  const pack = latestPublishedProofPack(catalogue, offer.offerId, offer.version, evaluatedAt);
  const routeProofIds = pack?.routeProofIds[input.route] ?? [];
  const requestedCategories = new Set(input.serviceCategories ?? []);
  const proof: ProofVersionPin[] = [];
  const excludedProof: Array<{proofId: string; reason: string}> = [];

  if (pack) {
    for (const proofId of routeProofIds) {
      const candidates = pack.proofs.filter((item) => item.proofId === proofId).sort((a, b) => b.version - a.version);
      const item = candidates[0];
      if (!item) {
        excludedProof.push({proofId, reason: 'The route mapping references a proof that is absent from this exact proof-pack version.'});
        continue;
      }
      const reason = proofExclusionReason(item, evaluatedAt, requestedCategories);
      if (reason) {
        excludedProof.push({proofId, reason});
        continue;
      }
      proof.push(proofPin(item));
    }
  }

  const disqualifiers = evaluateCommercialDisqualifiers(offer, input.signals ?? {});
  return deepFreeze({
    catalogueVersion: COMMERCIAL_CATALOGUE_VERSION,
    offer: offerPin(offer),
    route: input.route,
    proofPack: pack ? proofPackPin(pack) : undefined,
    proof,
    excludedProof,
    disqualifiers,
    commerciallyActionable: disqualifiers.length === 0,
    evaluatedAt,
    humanReviewRequired: true,
    externalActionAutomated: false,
  });
}

export function pinCommercialSelection(
  selection: CommercialSelection,
  pinnedAt = new Date().toISOString(),
): CommercialSelectionPin {
  return deepFreeze({
    catalogueVersion: selection.catalogueVersion,
    offer: selection.offer,
    route: selection.route,
    proofPack: selection.proofPack,
    proof: selection.proof,
    disqualifierCodes: selection.disqualifiers.map((item) => item.code),
    pinnedAt: validIso(pinnedAt, 'pinnedAt'),
  });
}

export function assertCommercialSelectionPinExists(
  catalogue: CommercialCatalogue,
  pin: CommercialSelectionPin,
): CommercialSelectionPin {
  validateCatalogueVersion(catalogue);
  if (pin.catalogueVersion !== COMMERCIAL_CATALOGUE_VERSION) throw new Error('Unsupported commercial catalogue pin version.');
  const offer = catalogue.offers.find((item) =>
    item.offerId === pin.offer.offerId
    && item.version === pin.offer.offerVersion
    && item.contentHash === pin.offer.offerContentHash,
  );
  if (!offer) throw new Error('Pinned offer version is missing or its content hash changed.');
  if (pin.proofPack) {
    const pack = catalogue.proofPacks.find((item) =>
      item.proofPackId === pin.proofPack?.proofPackId
      && item.version === pin.proofPack?.proofPackVersion
      && item.contentHash === pin.proofPack?.proofPackContentHash,
    );
    if (!pack) throw new Error('Pinned proof-pack version is missing or its content hash changed.');
    for (const proofPinValue of pin.proof) {
      const item = pack.proofs.find((candidate) =>
        candidate.proofId === proofPinValue.proofId
        && candidate.version === proofPinValue.proofVersion
        && candidate.contentHash === proofPinValue.proofContentHash,
      );
      if (!item) throw new Error(`Pinned proof ${proofPinValue.proofId} version ${proofPinValue.proofVersion} is missing or changed.`);
    }
  }
  return pin;
}

export function evaluateCommercialDisqualifiers(
  offer: OfferVersion,
  signals: CommercialSignals,
): CommercialDisqualifier[] {
  const findings: CommercialDisqualifier[] = [];
  if (offer.minimumValueUsd !== undefined && signals.estimatedValueUsd !== undefined && signals.estimatedValueUsd < offer.minimumValueUsd) {
    findings.push(disqualifier('below_minimum_value', [`value_usd=${signals.estimatedValueUsd}`, `minimum_usd=${offer.minimumValueUsd}`]));
  }
  if (signals.geography && offer.supportedGeographies.length > 0 && !includesNormalized(offer.supportedGeographies, signals.geography)) {
    findings.push(disqualifier('unsupported_geography', [`geography=${signals.geography}`]));
  }
  if (offer.minimumTimelineDays !== undefined && signals.timelineDays !== undefined && signals.timelineDays < offer.minimumTimelineDays) {
    findings.push(disqualifier('unrealistic_timeline', [`timeline_days=${signals.timelineDays}`, `minimum_days=${offer.minimumTimelineDays}`]));
  }
  const unsupportedStacks = (signals.requiredStacks ?? []).filter((stack) =>
    offer.supportedStacks.length > 0 && !includesNormalized(offer.supportedStacks, stack),
  );
  if (unsupportedStacks.length > 0) findings.push(disqualifier('unsupported_stack', unsupportedStacks.map((item) => `stack=${item}`)));
  if (signals.compensationModel === 'unpaid' || signals.compensationModel === 'commission_only') {
    findings.push(disqualifier('unpaid_or_commission_only', [`compensation=${signals.compensationModel}`]));
  }
  if (signals.registrationRequirementMet === false) {
    findings.push(disqualifier('unmet_registration_requirement', ['registration_requirement_met=false']));
  }
  if (signals.industry && includesNormalized(offer.prohibitedIndustries, signals.industry)) {
    findings.push(disqualifier('prohibited_industry', [`industry=${signals.industry}`]));
  }
  if (signals.engagementType === 'full_time_employment') {
    findings.push(disqualifier('full_time_hiring', ['engagement_type=full_time_employment']));
  }
  if (offer.capacityAvailable === false || signals.capacityAvailable === false) {
    findings.push(disqualifier('unavailable_capacity', ['capacity_available=false']));
  }
  return deepFreeze(findings);
}

export function commercialSignalsFromLead(lead: Lead): CommercialSignals {
  const raw = asRecord(lead.rawPayload);
  const commercial = asRecord(raw.commercial_evidence);
  const text = `${lead.title} ${lead.description}`.toLowerCase();
  const estimatedValueUsd = firstNumber(
    commercial.fixed_budget_usd,
    commercial.estimated_value_usd,
    raw.fixed_budget_usd,
    raw.estimated_value_usd,
    lead.budgetMax,
    lead.budgetMin,
  );
  const timelineDays = firstNumber(raw.timeline_days, commercial.timeline_days)
    ?? multiplyNumber(raw.timeline_weeks, 7)
    ?? multiplyNumber(commercial.timeline_weeks, 7);
  const requiredStacks = unique([
    ...stringList(raw.skills),
    ...stringList(commercial.skills),
    ...lead.technologySignals,
  ]);
  const compensationModel: CompensationModel = /commission[- ]only/.test(text)
    ? 'commission_only'
    : /\bunpaid\b|free work|free sample/.test(text)
      ? 'unpaid'
      : estimatedValueUsd !== undefined
        ? 'paid'
        : 'unknown';
  const engagementType: EngagementType = /full[- ]time|permanent (?:role|position|employee)|join our team/.test(text)
    ? 'full_time_employment'
    : /retainer/.test(text)
      ? 'retainer'
      : /managed service/.test(text)
        ? 'managed_service'
        : lead.source === 'upwork' || lead.opportunityType === 'project'
          ? 'project'
          : 'unknown';
  return {
    estimatedValueUsd,
    geography: lead.country ?? lead.region,
    timelineDays,
    requiredStacks,
    compensationModel,
    registrationRequirementMet: booleanValue(raw.registrationRequirementMet ?? raw.registration_requirement_met),
    industry: lead.industry,
    engagementType,
    capacityAvailable: booleanValue(raw.capacityAvailable ?? raw.capacity_available),
  };
}

export function latestOfferVersion(catalogue: CommercialCatalogue, offerId: string): OfferVersion | undefined {
  return catalogue.offers
    .filter((item) => item.offerId === offerId && item.state === 'published')
    .sort((left, right) => right.version - left.version)[0];
}

function createOfferVersion(input: OfferVersionInput): OfferVersion {
  requiredText(input.offerId, 'offerId');
  requiredText(input.name, 'name');
  requiredText(input.owner, 'owner');
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error('Offer version must be a positive integer.');
  if (input.approvedRoutes.length === 0) throw new Error('Published offer must approve at least one route.');
  if (input.serviceCategories.length === 0) throw new Error('Published offer must include at least one service category.');
  const normalized: Omit<OfferVersion, 'contentHash'> = {
    ...input,
    state: input.state ?? 'published',
    approvedRoutes: unique(input.approvedRoutes),
    serviceCategories: unique(input.serviceCategories),
    supportedGeographies: unique(input.supportedGeographies ?? []),
    supportedStacks: unique(input.supportedStacks ?? []),
    prohibitedIndustries: unique(input.prohibitedIndustries ?? []),
    positioning: unique(input.positioning),
    limitations: unique(input.limitations),
    publishedAt: validIso(input.publishedAt, 'publishedAt'),
    publishedBy: requiredText(input.publishedBy, 'publishedBy'),
    capacityAvailable: input.capacityAvailable ?? true,
  };
  return deepFreeze({...normalized, contentHash: hashValue(normalized)});
}

function createProofPackVersion(input: ProofPackVersionInput): ProofPackVersion {
  requiredText(input.proofPackId, 'proofPackId');
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error('Proof-pack version must be a positive integer.');
  const proofKeys = new Set<string>();
  const proofs = input.proofs.map((proofInput) => {
    const key = `${proofInput.proofId}@${proofInput.version}`;
    if (proofKeys.has(key)) throw new Error(`Duplicate proof version in pack: ${key}.`);
    proofKeys.add(key);
    return createProofItemVersion(proofInput);
  });
  const proofIds = new Set(proofs.map((item) => item.proofId));
  for (const [route, ids] of Object.entries(input.routeProofIds)) {
    for (const proofId of ids ?? []) {
      if (!proofIds.has(proofId)) throw new Error(`Route ${route} references missing proof ${proofId}.`);
    }
  }
  const normalized: Omit<ProofPackVersion, 'contentHash'> = {
    ...input,
    state: input.state ?? 'published',
    approvedAt: validIso(input.approvedAt, 'approvedAt'),
    approvedBy: requiredText(input.approvedBy, 'approvedBy'),
    expiresAt: input.expiresAt ? validIso(input.expiresAt, 'expiresAt') : undefined,
    routeProofIds: deepFreeze(Object.fromEntries(
      Object.entries(input.routeProofIds).map(([route, ids]) => [route, unique(ids ?? [])]),
    )) as Partial<Record<CommercialRoute, string[]>>,
    proofs,
  };
  return deepFreeze({...normalized, contentHash: hashValue(normalized)});
}

function createProofItemVersion(input: ProofItemVersionInput): ProofItemVersion {
  requiredText(input.proofId, 'proofId');
  requiredText(input.title, 'title');
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error('Proof version must be a positive integer.');
  if (input.provenance.length === 0) throw new Error(`Proof ${input.proofId} must retain provenance.`);
  const normalized: Omit<ProofItemVersion, 'contentHash'> = {
    ...input,
    approvedAt: validIso(input.approvedAt, 'approvedAt'),
    validFrom: validIso(input.validFrom, 'validFrom'),
    expiresAt: input.expiresAt ? validIso(input.expiresAt, 'expiresAt') : undefined,
    serviceCategories: unique(input.serviceCategories),
    provenance: input.provenance.map((item) => ({
      ...item,
      reference: requiredText(item.reference, 'provenance.reference'),
      owner: requiredText(item.owner, 'provenance.owner'),
      capturedAt: validIso(item.capturedAt, 'provenance.capturedAt'),
    })),
    limitations: unique(input.limitations),
  };
  return deepFreeze({...normalized, contentHash: hashValue(normalized)});
}

function latestPublishedProofPack(
  catalogue: CommercialCatalogue,
  offerId: string,
  offerVersion: number,
  evaluatedAt: string,
): ProofPackVersion | undefined {
  return catalogue.proofPacks
    .filter((item) =>
      item.offerId === offerId
      && item.offerVersion === offerVersion
      && item.state === 'published'
      && !expired(item.expiresAt, evaluatedAt),
    )
    .sort((left, right) => right.version - left.version)[0];
}

function proofExclusionReason(item: ProofItemVersion, evaluatedAt: string, categories: Set<ServiceCategory>): string | undefined {
  if (!item.approved) return 'Proof is not approved.';
  if (Date.parse(item.validFrom) > Date.parse(evaluatedAt)) return 'Proof is not valid yet.';
  if (expired(item.expiresAt, evaluatedAt)) return 'Proof is expired and cannot be recommended as current.';
  if (categories.size > 0 && item.serviceCategories.length > 0 && !item.serviceCategories.some((value) => categories.has(value))) {
    return 'Proof is not mapped to the requested service category.';
  }
  return undefined;
}

function requirePublishedOffer(catalogue: CommercialCatalogue, offerId: string, version: number): OfferVersion {
  const offer = catalogue.offers.find((item) => item.offerId === offerId && item.version === version);
  if (!offer) throw new Error(`Offer ${offerId} version ${version} is not published.`);
  if (offer.state !== 'published') throw new Error(`Offer ${offerId} version ${version} is retired.`);
  return offer;
}

function offerPin(offer: OfferVersion): OfferVersionPin {
  return deepFreeze({offerId: offer.offerId, offerVersion: offer.version, offerContentHash: offer.contentHash});
}

function proofPackPin(pack: ProofPackVersion): ProofPackVersionPin {
  return deepFreeze({proofPackId: pack.proofPackId, proofPackVersion: pack.version, proofPackContentHash: pack.contentHash});
}

function proofPin(item: ProofItemVersion): ProofVersionPin {
  return deepFreeze({
    proofId: item.proofId,
    proofVersion: item.version,
    proofContentHash: item.contentHash,
    title: item.title,
    limitations: [...item.limitations],
    provenance: item.provenance.map((value) => ({...value})),
    expiresAt: item.expiresAt,
  });
}

function disqualifier(code: CommercialDisqualifierCode, evidence: string[]): CommercialDisqualifier {
  return deepFreeze({code, explanation: DISQUALIFIER_EXPLANATIONS[code], evidence: unique(evidence), blocking: true});
}

function validateCatalogueVersion(catalogue: CommercialCatalogue): void {
  if (catalogue.version !== COMMERCIAL_CATALOGUE_VERSION) throw new Error('Unsupported commercial catalogue version.');
}

function freezeCatalogue(value: CommercialCatalogue): CommercialCatalogue {
  return deepFreeze({
    version: COMMERCIAL_CATALOGUE_VERSION,
    offers: [...value.offers],
    proofPacks: [...value.proofPacks],
  });
}

function expired(expiresAt: string | undefined, at: string): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.parse(at));
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function includesNormalized(values: readonly string[], target: string): boolean {
  const normalized = normalize(target);
  return values.some((item) => normalize(item) === normalized);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function validIso(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date.`);
  return parsed.toISOString();
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/[^0-9.-]+/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function multiplyNumber(value: unknown, multiplier: number): number | undefined {
  const parsed = firstNumber(value);
  return parsed === undefined ? undefined : parsed * multiplier;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map(String).map((item) => item.trim()).filter(Boolean));
  if (typeof value === 'string') return unique(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean));
  return [];
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

const BASE_CATALOGUE: CommercialCatalogue = freezeCatalogue({
  version: COMMERCIAL_CATALOGUE_VERSION,
  offers: [],
  proofPacks: [],
});

const WITH_FINTECH = publishOfferVersion(BASE_CATALOGUE, {
  offerId: 'fintech_operations_platform',
  version: 1,
  name: 'FinTech Backend Operations Platform',
  owner: 'Waseem',
  approvedRoutes: ['direct_buyer', 'channel_partner', 'referral_partner'],
  serviceCategories: ['ai_automation', 'fullstack_web_app', 'outsourcing_partnership'],
  minimumValueUsd: 5000,
  supportedGeographies: [],
  minimumTimelineDays: 21,
  supportedStacks: [],
  prohibitedIndustries: ['illegal gambling', 'sanctions evasion'],
  capacityAvailable: true,
  positioning: ['Modular backend operations platform plus managed implementation.'],
  limitations: ['No banking deployment, regulatory approval or guaranteed savings claim without verified evidence.'],
  publishedAt: '2026-07-27T00:00:00.000Z',
  publishedBy: 'waseem@codistan.org',
});

const WITH_DELIVERY = publishOfferVersion(WITH_FINTECH, {
  offerId: 'managed_software_ai_delivery',
  version: 1,
  name: 'Managed Software and AI Delivery Partnership',
  owner: 'Waseem',
  approvedRoutes: ['direct_buyer', 'channel_partner', 'delivery_partner', 'referral_partner'],
  serviceCategories: ['ai_automation', 'fullstack_web_app', 'outsourcing_partnership', 'cybersecurity', 'digital_marketing', 'creative_production'],
  minimumValueUsd: 3000,
  supportedGeographies: [],
  minimumTimelineDays: 14,
  supportedStacks: [],
  prohibitedIndustries: ['illegal gambling', 'sanctions evasion'],
  capacityAvailable: true,
  positioning: ['Managed delivery partner that owns outcomes rather than supplying unowned CVs.'],
  limitations: ['Capacity, mobilisation, commercial terms and white-label boundaries require human confirmation.'],
  publishedAt: '2026-07-27T00:00:00.000Z',
  publishedBy: 'waseem@codistan.org',
});

const WITH_FINTECH_PROOF = publishProofPackVersion(WITH_DELIVERY, {
  proofPackId: 'fintech_operations_proof',
  version: 1,
  offerId: 'fintech_operations_platform',
  offerVersion: 1,
  approvedBy: 'waseem@codistan.org',
  approvedAt: '2026-07-27T00:00:00.000Z',
  expiresAt: '2027-07-31T00:00:00.000Z',
  routeProofIds: {
    direct_buyer: ['acmetel-esim', 'private-rag'],
    channel_partner: ['acmetel-esim', 'private-rag'],
    referral_partner: ['acmetel-esim'],
  },
  proofs: [
    {
      proofId: 'acmetel-esim',
      version: 1,
      title: 'Telecom/eSIM product and operations delivery',
      approved: true,
      approvedBy: 'waseem@codistan.org',
      approvedAt: '2026-07-27T00:00:00.000Z',
      validFrom: '2026-07-27T00:00:00.000Z',
      expiresAt: '2027-07-31T00:00:00.000Z',
      serviceCategories: ['fullstack_web_app'],
      provenance: [{type: 'case_study', reference: 'portfolio:acmetel-esim', owner: 'Codistan', capturedAt: '2026-07-27T00:00:00.000Z'}],
      limitations: ['Use only as product-delivery evidence; do not present it as a banking deployment.'],
    },
    {
      proofId: 'private-rag',
      version: 1,
      title: 'Private RAG and workflow automation capability',
      approved: true,
      approvedBy: 'waseem@codistan.org',
      approvedAt: '2026-07-27T00:00:00.000Z',
      validFrom: '2026-07-27T00:00:00.000Z',
      expiresAt: '2027-07-31T00:00:00.000Z',
      serviceCategories: ['ai_automation'],
      provenance: [{type: 'capability_evidence', reference: 'portfolio:private-rag', owner: 'Codistan', capturedAt: '2026-07-27T00:00:00.000Z'}],
      limitations: ['Do not claim production financial-regulatory certification without evidence.'],
    },
  ],
});

export const DEFAULT_COMMERCIAL_CATALOGUE: CommercialCatalogue = publishProofPackVersion(WITH_FINTECH_PROOF, {
  proofPackId: 'managed_delivery_proof',
  version: 1,
  offerId: 'managed_software_ai_delivery',
  offerVersion: 1,
  approvedBy: 'waseem@codistan.org',
  approvedAt: '2026-07-27T00:00:00.000Z',
  expiresAt: '2027-07-31T00:00:00.000Z',
  routeProofIds: {
    direct_buyer: ['acmetel-product', 'secp-ux'],
    channel_partner: ['acmetel-product', 'secp-ux'],
    delivery_partner: ['acmetel-product', 'secp-ux', 'iso-security'],
    referral_partner: ['acmetel-product'],
  },
  proofs: [
    {
      proofId: 'acmetel-product',
      version: 1,
      title: 'Complex telecom product delivery',
      approved: true,
      approvedBy: 'waseem@codistan.org',
      approvedAt: '2026-07-27T00:00:00.000Z',
      validFrom: '2026-07-27T00:00:00.000Z',
      expiresAt: '2027-07-31T00:00:00.000Z',
      serviceCategories: ['fullstack_web_app'],
      provenance: [{type: 'case_study', reference: 'portfolio:acmetel-product', owner: 'Codistan', capturedAt: '2026-07-27T00:00:00.000Z'}],
      limitations: [],
    },
    {
      proofId: 'secp-ux',
      version: 1,
      title: 'Enterprise discovery, UX and prototype delivery',
      approved: true,
      approvedBy: 'waseem@codistan.org',
      approvedAt: '2026-07-27T00:00:00.000Z',
      validFrom: '2026-07-27T00:00:00.000Z',
      expiresAt: '2027-07-31T00:00:00.000Z',
      serviceCategories: ['fullstack_web_app'],
      provenance: [{type: 'delivery_artifact', reference: 'portfolio:secp-ux', owner: 'Codistan', capturedAt: '2026-07-27T00:00:00.000Z'}],
      limitations: ['Use as discovery and product-design evidence only.'],
    },
    {
      proofId: 'iso-security',
      version: 1,
      title: 'Security and compliance delivery capability',
      approved: true,
      approvedBy: 'waseem@codistan.org',
      approvedAt: '2026-07-27T00:00:00.000Z',
      validFrom: '2026-07-27T00:00:00.000Z',
      expiresAt: '2027-07-31T00:00:00.000Z',
      serviceCategories: ['cybersecurity'],
      provenance: [{type: 'capability_evidence', reference: 'portfolio:iso-security', owner: 'Codistan', capturedAt: '2026-07-27T00:00:00.000Z'}],
      limitations: ['Use only when the route and prospect require security or compliance delivery.'],
    },
  ],
});
