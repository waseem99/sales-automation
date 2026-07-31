import {createHash} from 'node:crypto';
import type {Lead, RedFlag} from '@sales-automation/shared';

export const DECISION_SCORE_VERSION = 'decision-score.v1';

export type DecisionScoreComponentName =
  | 'account_fit'
  | 'contact_fit'
  | 'buyer_intent'
  | 'service_fit'
  | 'evidence_quality'
  | 'freshness'
  | 'commercial_readiness';

export type DecisionPriority = 'priority_a' | 'priority_b' | 'research' | 'reject';

export interface DecisionScoreComponents {
  account_fit: number;
  contact_fit: number;
  buyer_intent: number;
  service_fit: number;
  evidence_quality: number;
  freshness: number;
  commercial_readiness: number;
}

export interface DecisionScoreOriginalSnapshot {
  total: number;
  subtotal: number;
  riskPenalty: number;
  priority: DecisionPriority;
  components: DecisionScoreComponents;
  generatedAt: string;
  resultHash: string;
}

export interface SellerDecisionOverrideEvent {
  id: string;
  actor: string;
  reason: string;
  outcome: string;
  occurredAt: string;
  component?: DecisionScoreComponentName | 'risk_penalty';
  priorValue?: number;
  newValue?: number;
  priorPriority: DecisionPriority;
  newPriority: DecisionPriority;
  priorTotal: number;
  newTotal: number;
  forcedPriority?: DecisionPriority;
}

export interface DecisionScoreResult {
  version: typeof DECISION_SCORE_VERSION;
  weights: typeof DECISION_SCORE_WEIGHTS;
  components: DecisionScoreComponents;
  riskPenalty: number;
  subtotal: number;
  total: number;
  priority: DecisionPriority;
  reasons: string[];
  missingEvidence: string[];
  risks: string[];
  buyerIntentConfirmed: boolean;
  linkedWarmEvidence: boolean;
  coldSourcePreserved: boolean;
  generatedAt: string;
  resultHash: string;
  originalScore?: DecisionScoreOriginalSnapshot;
  overrideHistory: SellerDecisionOverrideEvent[];
  humanReviewRequired: true;
  externalActionAutomated: false;
}

export interface SellerDecisionOverrideInput {
  actor: string;
  reason: string;
  outcome: string;
  occurredAt?: string;
  component?: DecisionScoreComponentName | 'risk_penalty';
  newValue?: number;
  forcedPriority?: DecisionPriority;
}

export const DECISION_SCORE_WEIGHTS = deepFreeze({
  account_fit: 0.15,
  contact_fit: 0.10,
  buyer_intent: 0.20,
  service_fit: 0.15,
  evidence_quality: 0.15,
  freshness: 0.10,
  commercial_readiness: 0.15,
} as const);

const COMPONENT_NAMES = Object.keys(DECISION_SCORE_WEIGHTS) as DecisionScoreComponentName[];
const COLD_LEAD_TYPES = new Set([
  'linkedin_cold_prospect',
  'sales_navigator_cold_prospect',
  'partner_prospect',
  'solution_led_prospect',
]);

export function calculateDecisionScore(
  lead: Lead,
  generatedAt = new Date().toISOString(),
): DecisionScoreResult {
  const evaluatedAt = validIso(generatedAt, 'generatedAt');
  const raw = asRecord(lead.rawPayload);
  const primaryCampaign = asRecord(raw.primaryCampaignMatch);
  const intent = intentEvidence(raw, lead);
  const commercial = commercialEvidence(raw);
  const parser = parserEvidence(raw);

  const reasons: string[] = [];
  const missingEvidence: string[] = [];
  const risks: string[] = [];

  const accountFit = scoreAccountFit(lead, primaryCampaign, reasons, missingEvidence);
  const contactFit = scoreContactFit(lead, raw, reasons, missingEvidence);
  const buyerIntent = scoreBuyerIntent(intent, reasons, missingEvidence, risks);
  const serviceFit = scoreServiceFit(lead, primaryCampaign, reasons, missingEvidence);
  const evidenceQuality = scoreEvidenceQuality(lead, raw, parser, reasons, missingEvidence, risks);
  const freshness = scoreFreshness(lead, intent, reasons, missingEvidence, risks);
  const commercialReadiness = scoreCommercialReadiness(commercial, reasons, missingEvidence, risks);

  const components: DecisionScoreComponents = {
    account_fit: accountFit,
    contact_fit: contactFit,
    buyer_intent: buyerIntent,
    service_fit: serviceFit,
    evidence_quality: evidenceQuality,
    freshness,
    commercial_readiness: commercialReadiness,
  };
  const riskPenalty = calculateRiskPenalty(lead, raw, intent, commercial, parser, risks);
  const subtotal = reproduceDecisionSubtotal(components);
  const total = clamp(subtotal - riskPenalty);
  const priority = priorityFrom(total, riskPenalty, commercial.blocked, intent.strongNegative);
  const base = {
    version: DECISION_SCORE_VERSION,
    weights: DECISION_SCORE_WEIGHTS,
    components,
    riskPenalty,
    subtotal,
    total,
    priority,
    reasons: unique(reasons),
    missingEvidence: unique(missingEvidence),
    risks: unique(risks),
    buyerIntentConfirmed: intent.confirmed,
    linkedWarmEvidence: intent.linkedWarmEvidence,
    coldSourcePreserved: intent.coldSource,
    generatedAt: evaluatedAt,
    overrideHistory: [] as SellerDecisionOverrideEvent[],
    humanReviewRequired: true as const,
    externalActionAutomated: false as const,
  };
  return deepFreeze({...base, resultHash: resultHash(base)});
}

export function applySellerDecisionOverride(
  score: DecisionScoreResult,
  input: SellerDecisionOverrideInput,
): DecisionScoreResult {
  assertDecisionScore(score);
  const actor = requiredText(input.actor, 'actor');
  const reason = requiredText(input.reason, 'reason');
  const outcome = requiredText(input.outcome, 'outcome');
  const occurredAt = validIso(input.occurredAt ?? new Date().toISOString(), 'occurredAt');
  if (!input.component && !input.forcedPriority) {
    throw new Error('A component override or forced priority is required.');
  }
  if (input.component && input.newValue === undefined) {
    throw new Error('newValue is required when overriding a score component.');
  }

  const components = {...score.components};
  let riskPenalty = score.riskPenalty;
  let priorValue: number | undefined;
  let newValue: number | undefined;
  if (input.component) {
    newValue = boundedScore(input.newValue, 'newValue');
    if (input.component === 'risk_penalty') {
      priorValue = riskPenalty;
      riskPenalty = newValue;
    } else {
      priorValue = components[input.component];
      components[input.component] = newValue;
    }
  }

  const subtotal = reproduceDecisionSubtotal(components);
  const total = clamp(subtotal - riskPenalty);
  const derivedPriority = priorityFrom(total, riskPenalty, false, false);
  const priority = input.forcedPriority ?? derivedPriority;
  const originalScore = score.originalScore ?? originalSnapshot(score);
  const event: SellerDecisionOverrideEvent = {
    id: `decision-override-${score.overrideHistory.length + 1}-${shortHash(`${actor}|${occurredAt}|${reason}`)}`,
    actor,
    reason,
    outcome,
    occurredAt,
    component: input.component,
    priorValue,
    newValue,
    priorPriority: score.priority,
    newPriority: priority,
    priorTotal: score.total,
    newTotal: total,
    forcedPriority: input.forcedPriority,
  };
  const nextBase = {
    ...score,
    components,
    riskPenalty,
    subtotal,
    total,
    priority,
    originalScore,
    overrideHistory: [...score.overrideHistory, event],
    generatedAt: occurredAt,
    reasons: unique([...score.reasons, `Seller override by ${actor}: ${reason}`]),
    humanReviewRequired: true as const,
    externalActionAutomated: false as const,
  };
  const {resultHash: _priorHash, ...hashable} = nextBase;
  return deepFreeze({...nextBase, resultHash: resultHash(hashable)});
}

export function reproduceDecisionSubtotal(components: DecisionScoreComponents): number {
  return clamp(COMPONENT_NAMES.reduce((total, name) => total + components[name] * DECISION_SCORE_WEIGHTS[name], 0));
}

export function reproduceDecisionTotal(score: Pick<DecisionScoreResult, 'components' | 'riskPenalty'>): number {
  return clamp(reproduceDecisionSubtotal(score.components) - score.riskPenalty);
}

export function readDecisionScore(lead: Lead): DecisionScoreResult | undefined {
  const raw = asRecord(lead.rawPayload);
  const candidate = asRecord(raw.decisionScore);
  return candidate.version === DECISION_SCORE_VERSION ? candidate as unknown as DecisionScoreResult : undefined;
}

export function attachDecisionScore(lead: Lead, score: DecisionScoreResult): Lead {
  assertDecisionScore(score);
  const raw = asRecord(lead.rawPayload);
  return {
    ...lead,
    rawPayload: {
      ...raw,
      decisionScoreVersion: DECISION_SCORE_VERSION,
      decisionScore: score,
      decisionScorePriority: score.priority,
      decisionScoreTotal: score.total,
      decisionScoreBuyerIntentConfirmed: score.buyerIntentConfirmed,
      humanReviewRequired: true,
      externalActionAutomated: false,
    },
  };
}

function scoreAccountFit(
  lead: Lead,
  campaign: Record<string, unknown>,
  reasons: string[],
  missing: string[],
): number {
  const campaignScore = numberValue(campaign.score);
  let score = campaignScore !== undefined ? clamp(campaignScore) : 0;
  if (campaignScore !== undefined) reasons.push(`Account/campaign fit contributes ${score}/100 from the versioned campaign match.`);
  if (lead.companyName) score = Math.max(score, 45);
  else missing.push('Company/account identity is missing.');
  if (lead.industry) score += 10;
  else missing.push('Industry evidence is missing.');
  if (lead.companyWebsite) score += 10;
  return clamp(score);
}

function scoreContactFit(
  lead: Lead,
  raw: Record<string, unknown>,
  reasons: string[],
  missing: string[],
): number {
  let score = 0;
  if (lead.contactName) score += 25;
  else missing.push('Contact name is missing.');
  if (lead.contactRole) score += 35;
  else missing.push('Contact role or decision authority is missing.');
  if (lead.linkedinUrl || lead.contactEmail || lead.contactFormUrl || lead.source === 'upwork') score += 25;
  else missing.push('A permitted contact route is missing.');
  const identity = asRecord(raw.identityResolution);
  if (identity.status === 'resolved' || identity.personId || identity.companyId) score += 15;
  if (score >= 60) reasons.push('Contact identity, authority or permitted route evidence is available.');
  return clamp(score);
}

function scoreBuyerIntent(
  intent: IntentEvidence,
  reasons: string[],
  missing: string[],
  risks: string[],
): number {
  if (intent.coldSource && !intent.linkedWarmEvidence) {
    risks.push('Cold account/contact fit is not buyer-authored intent.');
    missing.push('Separate current buyer-authored demand evidence is missing.');
    return 0;
  }
  if (intent.confirmed) {
    reasons.push('Current, traceable buyer-authored demand evidence confirms intent.');
    return 100;
  }
  if (intent.linkedWarmEvidence) {
    reasons.push('Separate warm evidence is linked, but it does not rewrite the original cold source.');
    return 55;
  }
  if (intent.stale) {
    risks.push('Buyer-intent evidence is stale or closed.');
    return 10;
  }
  if (intent.strongNegative) {
    risks.push('The source is classified as a strong negative rather than buyer demand.');
    return 0;
  }
  missing.push('Buyer intent is unclear or unsupported.');
  return 15;
}

function scoreServiceFit(
  lead: Lead,
  campaign: Record<string, unknown>,
  reasons: string[],
  missing: string[],
): number {
  const service = String(lead.serviceCategory || '').trim();
  const campaignDisposition = text(campaign.disposition);
  let score = service && service !== 'unknown' ? 55 : 10;
  if (service && service !== 'unknown') reasons.push(`Service fit is resolved to ${service}.`);
  else missing.push('Service category is unresolved.');
  if (['priority_a', 'priority_b'].includes(campaignDisposition ?? '')) score += 30;
  else if (campaignDisposition === 'research') score += 15;
  const proof = arrayValue(campaign.recommendedProof);
  if (proof.length > 0) score += 15;
  else missing.push('No current route-specific proof is selected.');
  return clamp(score);
}

function scoreEvidenceQuality(
  lead: Lead,
  raw: Record<string, unknown>,
  parser: ParserEvidence,
  reasons: string[],
  missing: string[],
  risks: string[],
): number {
  let score = 0;
  if (lead.evidenceUrl || lead.sourceUrl) score += 25;
  else missing.push('Canonical source evidence URL is missing.');
  if (lead.evidenceSummary || lead.description.length >= 80) score += 20;
  else missing.push('Evidence summary is incomplete.');
  if (lead.contactName || lead.companyName) score += 15;
  if (parser.complete) {
    score += 25;
    reasons.push('Parser critical-field validation is complete.');
  } else if (parser.rejected) {
    risks.push('Parser rejected missing critical evidence.');
  } else {
    missing.push('Parser completeness evidence is unavailable.');
  }
  const identity = asRecord(raw.identityResolution);
  if (Object.keys(identity).length > 0) score += 15;
  return clamp(score);
}

function scoreFreshness(
  lead: Lead,
  intent: IntentEvidence,
  reasons: string[],
  missing: string[],
  risks: string[],
): number {
  if (intent.stale) {
    risks.push('The demand signal is outside the current review window.');
    return 10;
  }
  const minutes = lead.freshnessMinutes;
  if (minutes !== undefined) {
    if (minutes <= 60) {
      reasons.push('Evidence is less than one hour old.');
      return 100;
    }
    if (minutes <= 1440) return 85;
    if (minutes <= 10_080) return 60;
    return 25;
  }
  const rawAgeStatus = intent.freshnessStatus;
  if (rawAgeStatus === 'current') return 85;
  if (rawAgeStatus === 'stale' || rawAgeStatus === 'closed') return 10;
  missing.push('Freshness could not be resolved.');
  return 40;
}

function scoreCommercialReadiness(
  commercial: CommercialEvidence,
  reasons: string[],
  missing: string[],
  risks: string[],
): number {
  if (commercial.blocked) {
    risks.push(...commercial.blockers);
    return 0;
  }
  if (commercial.approvalAllowed) {
    reasons.push('The pinned offer and route permit human-approved outreach.');
    return 100;
  }
  if (commercial.draftAllowed) return 65;
  if (commercial.qualificationAllowed) {
    missing.push('Offer is research/pilot-only and not approved for outreach.');
    return 35;
  }
  missing.push('Commercial-readiness evidence is missing.');
  return 20;
}

function calculateRiskPenalty(
  lead: Lead,
  raw: Record<string, unknown>,
  intent: IntentEvidence,
  commercial: CommercialEvidence,
  parser: ParserEvidence,
  risks: string[],
): number {
  let penalty = 0;
  const redFlags = [...(lead.score?.redFlags ?? []), ...redFlagsFromRaw(raw)];
  for (const flag of redFlags) {
    const points = flag.severity === 'critical' ? 60 : flag.severity === 'high' ? 25 : flag.severity === 'medium' ? 12 : 5;
    penalty += points;
    risks.push(`${flag.code}: ${flag.reason}`);
  }
  if (intent.strongNegative) penalty += 60;
  if (intent.stale) penalty += 25;
  if (parser.rejected) penalty += 45;
  if (commercial.blocked) penalty += Math.min(50, 15 + commercial.blockers.length * 8);
  const disqualifiers = commercial.disqualifierCodes;
  if (disqualifiers.length > 0) {
    penalty += Math.min(50, disqualifiers.length * 15);
    risks.push(`Commercial disqualifiers: ${disqualifiers.join(', ')}.`);
  }
  return clamp(penalty);
}

interface IntentEvidence {
  confirmed: boolean;
  linkedWarmEvidence: boolean;
  coldSource: boolean;
  stale: boolean;
  strongNegative: boolean;
  freshnessStatus?: string;
}

function intentEvidence(raw: Record<string, unknown>, lead: Lead): IntentEvidence {
  const provenance = asRecord(raw.intentProvenance);
  const qualification = asRecord(raw.qualification);
  const linkedinIntent = asRecord(raw.linkedinIntent ?? raw.linkedin_intent ?? qualification.linkedin_intent);
  const sourceConfirmed = booleanValue(provenance.sourceBuyerIntentConfirmed)
    ?? booleanValue(linkedinIntent.buyer_intent_confirmed)
    ?? booleanValue(raw.buyerIntentConfirmed)
    ?? false;
  const linkedWarmEvidence = booleanValue(provenance.linkedWarmIntentConfirmed) ?? false;
  const coldSource = COLD_LEAD_TYPES.has(lead.leadType)
    || lead.source === 'sales_navigator'
    || text(provenance.baseClassification) === 'cold_no_confirmed_intent'
    || booleanValue(linkedinIntent.cold_source_preserved) === true;
  const freshnessStatus = text(linkedinIntent.freshness_status);
  const stale = ['stale', 'closed'].includes(freshnessStatus ?? '')
    || arrayValue(provenance.invalidOrStaleWarmEvidence).length > 0;
  const strongNegative = booleanValue(linkedinIntent.strong_negative) ?? false;
  return {
    confirmed: sourceConfirmed && !coldSource,
    linkedWarmEvidence,
    coldSource,
    stale,
    strongNegative,
    freshnessStatus,
  };
}

interface CommercialEvidence {
  qualificationAllowed: boolean;
  draftAllowed: boolean;
  approvalAllowed: boolean;
  blocked: boolean;
  blockers: string[];
  disqualifierCodes: string[];
}

function commercialEvidence(raw: Record<string, unknown>): CommercialEvidence {
  const decision = asRecord(raw.commercialReadinessDecision);
  const selection = asRecord(raw.commercialCatalogueSelection);
  const pin = asRecord(raw.commercialCataloguePin);
  const blockers = unique([
    ...stringArray(decision.blockers),
    ...stringArray(raw.commercialCatalogueErrors),
  ]);
  const disqualifierCodes = stringArray(
    selection.disqualifiers
      ? arrayValue(selection.disqualifiers).map((item) => text(asRecord(item).code)).filter(Boolean)
      : pin.disqualifierCodes,
  );
  const qualificationAllowed = booleanValue(decision.qualificationAllowed) ?? false;
  const draftAllowed = booleanValue(decision.draftAllowed) ?? false;
  const approvalAllowed = booleanValue(decision.approvalAllowed) ?? false;
  const catalogueActionable = booleanValue(selection.commerciallyActionable);
  const blocked = catalogueActionable === false
    || text(decision.status) === 'retired'
    || disqualifierCodes.length > 0;
  return {qualificationAllowed, draftAllowed, approvalAllowed, blocked, blockers, disqualifierCodes};
}

interface ParserEvidence {
  complete: boolean;
  rejected: boolean;
}

function parserEvidence(raw: Record<string, unknown>): ParserEvidence {
  const parser = asRecord(raw.parserDiagnostics ?? raw.parser_diagnostics);
  const status = text(raw.parserStatus ?? raw.parser_status ?? parser.status);
  return {complete: status === 'complete', rejected: status === 'reject' || status === 'incomplete'};
}

function redFlagsFromRaw(raw: Record<string, unknown>): RedFlag[] {
  const values = arrayValue(raw.redFlags ?? raw.riskFlags);
  return values.map((value) => {
    const item = asRecord(value);
    return {
      code: text(item.code) ?? 'raw_risk',
      severity: ['low', 'medium', 'high', 'critical'].includes(text(item.severity) ?? '')
        ? text(item.severity) as RedFlag['severity']
        : 'medium',
      reason: text(item.reason) ?? text(item.explanation) ?? String(value),
    };
  });
}

function originalSnapshot(score: DecisionScoreResult): DecisionScoreOriginalSnapshot {
  return deepFreeze({
    total: score.total,
    subtotal: score.subtotal,
    riskPenalty: score.riskPenalty,
    priority: score.priority,
    components: {...score.components},
    generatedAt: score.generatedAt,
    resultHash: score.resultHash,
  });
}

function priorityFrom(total: number, riskPenalty: number, commercialBlocked: boolean, strongNegative: boolean): DecisionPriority {
  if (strongNegative || commercialBlocked || riskPenalty >= 60 || total < 25) return 'reject';
  if (total >= 75) return 'priority_a';
  if (total >= 55) return 'priority_b';
  return 'research';
}

function assertDecisionScore(score: DecisionScoreResult): void {
  if (score.version !== DECISION_SCORE_VERSION) throw new Error('Unsupported decision score version.');
  if (reproduceDecisionTotal(score) !== score.total) throw new Error('Decision score total is not reproducible from components.');
}

function resultHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
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
  return JSON.stringify(value) ?? 'null';
}

function boundedScore(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a finite number.`);
  return clamp(value);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function validIso(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid date.`);
  return parsed.toISOString();
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
