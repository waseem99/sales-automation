import {
  commercialSignalsFromLead,
  DEFAULT_COMMERCIAL_CATALOGUE,
  latestOfferVersion,
  pinCommercialSelection,
  selectCommercialEvidence,
  type CommercialRoute,
  type CommercialSelection,
  type CommercialSelectionPin,
} from '@sales-automation/commercial-catalogue';
import type {LeadEvaluation} from '@sales-automation/evaluator';
import {loadNeonAppState, persistLeadRecords} from '@sales-automation/neon-state';
import type {Lead} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const COMMERCIAL_CATALOGUE_RUNTIME_VERSION = 'commercial-catalogue-runtime.v1';
const ACTOR = 'commercial-catalogue@codistan.local';
const MAX_PROCESSED_IDS = 50;

interface IntakeResponseBody {
  processedLeadIds?: unknown;
  [key: string]: unknown;
}

interface RecommendationCatalogueResult {
  recommendation: Record<string, unknown>;
  selection?: CommercialSelection;
  error?: string;
}

export async function applyCommercialCatalogueAfterIntake(input: {
  response: Response;
  databaseUrl: string;
  generatedAt?: string;
}): Promise<Response> {
  if (!input.response.ok) return input.response;
  const parsed = await parseResponse(input.response);
  if (!parsed) return input.response;
  const processedLeadIds = normalizeIds(parsed.body.processedLeadIds).slice(0, MAX_PROCESSED_IDS);
  if (processedLeadIds.length === 0) return input.response;

  try {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const state = await loadNeonAppState(input.databaseUrl);
    const touchedLeadIds: string[] = [];
    let pinnedDrafts = 0;
    let blocked = 0;
    let selectedProof = 0;

    for (const leadId of processedLeadIds) {
      const record = state.repository.getLead(leadId);
      if (!record) continue;
      const applied = applyCatalogueToRecord(record, generatedAt);
      if (!applied.changed) continue;
      if (applied.primarySelection && !applied.primarySelection.commerciallyActionable) blocked += 1;
      selectedProof += applied.primarySelection?.proof.length ?? 0;
      pinnedDrafts += applied.pinnedDrafts;

      if (applied.evaluation) {
        state.repository.saveEvaluation(applied.evaluation, ACTOR);
      } else {
        state.repository.upsertLead(applied.lead, ACTOR);
      }
      state.repository.addNote(
        leadId,
        catalogueAuditNote(applied.primarySelection, applied.catalogueErrors),
        ACTOR,
      );
      touchedLeadIds.push(leadId);
    }

    const touchedRecords = unique(touchedLeadIds)
      .map((leadId) => state.repository.getLead(leadId))
      .filter((record): record is StoredLeadRecord => Boolean(record));
    await persistLeadRecords(input.databaseUrl, touchedRecords);

    return responseJson({
      ...parsed.body,
      commercialCatalogue: {
        status: 'applied',
        version: COMMERCIAL_CATALOGUE_RUNTIME_VERSION,
        catalogueVersion: DEFAULT_COMMERCIAL_CATALOGUE.version,
        processed: processedLeadIds.length,
        touchedLeadIds: unique(touchedLeadIds),
        blocked,
        selectedProof,
        pinnedDrafts,
        immutableVersionPins: true,
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  } catch (error) {
    console.error('COMMERCIAL_CATALOGUE_POST_INTAKE_ERROR', {
      message: safeErrorMessage(error),
      processedLeadCount: processedLeadIds.length,
    });
    return responseJson({
      ...parsed.body,
      commercialCatalogue: {
        status: 'deferred',
        version: COMMERCIAL_CATALOGUE_RUNTIME_VERSION,
        reason: 'Source ingestion and campaign matching succeeded, but versioned commercial-catalogue selection was deferred for a later retry.',
        immutableVersionPins: true,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  }
}

function applyCatalogueToRecord(record: StoredLeadRecord, generatedAt: string): {
  lead: Lead;
  evaluation?: LeadEvaluation;
  primarySelection?: CommercialSelection;
  catalogueErrors: string[];
  pinnedDrafts: number;
  changed: boolean;
} {
  const raw = asRecord(record.lead.rawPayload);
  const rawMatches = Array.isArray(raw.campaignMatches) ? raw.campaignMatches : [];
  const results = rawMatches.map((value) => enrichRecommendation(record.lead, asRecord(value), generatedAt));
  const enrichedMatches = results.map((item) => item.recommendation);
  const primaryId = text(asRecord(raw.primaryCampaignMatch).campaignId);
  const primaryResult = results.find((item) => text(item.recommendation.campaignId) === primaryId) ?? results[0];
  const primarySelection = primaryResult?.selection;
  const catalogueErrors = results.map((item) => item.error).filter((item): item is string => Boolean(item));
  const pipelineStatus = primarySelection && !primarySelection.commerciallyActionable && record.lead.pipelineStatus === 'draft_ready'
    ? 'needs_human_review'
    : record.lead.pipelineStatus;
  const lead: Lead = {
    ...record.lead,
    pipelineStatus,
    rawPayload: {
      ...raw,
      campaignMatches: enrichedMatches,
      primaryCampaignMatch: primaryResult?.recommendation ?? raw.primaryCampaignMatch ?? null,
      commercialCatalogueRuntimeVersion: COMMERCIAL_CATALOGUE_RUNTIME_VERSION,
      commercialCatalogueVersion: DEFAULT_COMMERCIAL_CATALOGUE.version,
      commercialCatalogueSelection: primarySelection ?? null,
      commercialCataloguePin: primarySelection ? pinCommercialSelection(primarySelection, generatedAt) : null,
      commercialCatalogueErrors: catalogueErrors,
      commercialCatalogueEvaluatedAt: generatedAt,
    },
  };

  let pinnedDrafts = 0;
  let evaluation: LeadEvaluation | undefined;
  if (record.latestEvaluation) {
    const primaryPin = primarySelection ? pinCommercialSelection(primarySelection, generatedAt) : undefined;
    const drafts = record.latestEvaluation.drafts.map((draft) => {
      if (!primaryPin) return draft;
      pinnedDrafts += 1;
      const safeguard = catalogueSafeguard(primaryPin);
      return {
        ...draft,
        status: primarySelection?.commerciallyActionable ? draft.status : 'needs_review',
        metadata: {
          ...draft.metadata,
          safeguards: unique([...draft.metadata.safeguards, safeguard]),
          commercialCatalogueVersion: primaryPin.catalogueVersion,
          commercialSelectionPin: primaryPin,
          offerVersion: primaryPin.offer.offerVersion,
          offerContentHash: primaryPin.offer.offerContentHash,
          proofPackVersion: primaryPin.proofPack?.proofPackVersion,
          proofPackContentHash: primaryPin.proofPack?.proofPackContentHash,
          proofVersions: primaryPin.proof.map((proof) => ({
            proofId: proof.proofId,
            proofVersion: proof.proofVersion,
            proofContentHash: proof.proofContentHash,
            expiresAt: proof.expiresAt,
            limitations: proof.limitations,
            provenance: proof.provenance,
          })),
          commercialDisqualifierCodes: primaryPin.disqualifierCodes,
        },
      };
    }) as LeadEvaluation['drafts'];
    evaluation = {
      ...record.latestEvaluation,
      lead,
      drafts,
      recommendedNextAction: primarySelection && !primarySelection.commerciallyActionable
        ? `Commercial catalogue blocked actionable outreach: ${primarySelection.disqualifiers.map((item) => `${item.code}: ${item.explanation}`).join(' ')}`
        : record.latestEvaluation.recommendedNextAction,
    };
  }

  const previousStable = stableCatalogueState(record.lead, record.latestEvaluation);
  const nextStable = stableCatalogueState(lead, evaluation ?? record.latestEvaluation);
  return {
    lead,
    evaluation,
    primarySelection,
    catalogueErrors,
    pinnedDrafts,
    changed: JSON.stringify(previousStable) !== JSON.stringify(nextStable),
  };
}

function enrichRecommendation(
  lead: Lead,
  recommendation: Record<string, unknown>,
  generatedAt: string,
): RecommendationCatalogueResult {
  const offerId = text(recommendation.offerId);
  const route = commercialRoute(recommendation.route);
  if (!offerId || !route) {
    return {
      recommendation: {
        ...recommendation,
        commercialCatalogueVersion: DEFAULT_COMMERCIAL_CATALOGUE.version,
        commerciallyActionable: false,
        commercialCatalogueError: 'A versioned offer ID and approved commercial route are required.',
      },
      error: 'A versioned offer ID and approved commercial route are required.',
    };
  }
  const latest = latestOfferVersion(DEFAULT_COMMERCIAL_CATALOGUE, offerId);
  const offerVersion = positiveInteger(recommendation.offerVersion) ?? latest?.version;
  if (!offerVersion) {
    const error = `No published offer version exists for ${offerId}.`;
    return {
      recommendation: {
        ...recommendation,
        commercialCatalogueVersion: DEFAULT_COMMERCIAL_CATALOGUE.version,
        commerciallyActionable: false,
        commercialCatalogueError: error,
      },
      error,
    };
  }

  try {
    const selection = selectCommercialEvidence(DEFAULT_COMMERCIAL_CATALOGUE, {
      offerId,
      offerVersion,
      route,
      signals: commercialSignalsFromLead(lead),
      serviceCategories: [lead.serviceCategory],
      evaluatedAt: generatedAt,
    });
    const pin = pinCommercialSelection(selection, generatedAt);
    const originallyActionable = ['priority_a', 'priority_b'].includes(text(recommendation.disposition) ?? '');
    const downgraded = originallyActionable && !selection.commerciallyActionable;
    const risks = unique([
      ...stringArray(recommendation.risks),
      ...selection.disqualifiers.map((item) => `${item.code}: ${item.explanation}`),
      ...selection.excludedProof.map((item) => `${item.proofId}: ${item.reason}`),
    ]);
    return {
      selection,
      recommendation: {
        ...recommendation,
        offerVersion: selection.offer.offerVersion,
        offerContentHash: selection.offer.offerContentHash,
        commercialCatalogueVersion: selection.catalogueVersion,
        proofPackPin: selection.proofPack ?? null,
        proofPins: selection.proof,
        recommendedProof: selection.proof.map((proof) => ({
          id: proof.proofId,
          version: proof.proofVersion,
          contentHash: proof.proofContentHash,
          title: proof.title,
          expiresAt: proof.expiresAt,
          limitations: proof.limitations,
          provenance: proof.provenance,
          approved: true,
        })),
        commercialSelectionPin: pin,
        commercialDisqualifiers: selection.disqualifiers,
        commerciallyActionable: selection.commerciallyActionable,
        disposition: downgraded ? 'research' : recommendation.disposition,
        risks,
        nextResearchAction: downgraded
          ? `Resolve commercial disqualifiers before outreach: ${selection.disqualifiers.map((item) => item.code).join(', ')}.`
          : recommendation.nextResearchAction,
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    return {
      recommendation: {
        ...recommendation,
        offerVersion,
        commercialCatalogueVersion: DEFAULT_COMMERCIAL_CATALOGUE.version,
        commerciallyActionable: false,
        disposition: ['priority_a', 'priority_b'].includes(text(recommendation.disposition) ?? '') ? 'research' : recommendation.disposition,
        risks: unique([...stringArray(recommendation.risks), message]),
        commercialCatalogueError: message,
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      error: message,
    };
  }
}

function stableCatalogueState(lead: Lead, evaluation: LeadEvaluation | undefined): unknown {
  const raw = asRecord(lead.rawPayload);
  return {
    pipelineStatus: lead.pipelineStatus,
    campaignMatches: raw.campaignMatches ?? [],
    primaryCampaignMatch: raw.primaryCampaignMatch ?? null,
    selection: raw.commercialCatalogueSelection ?? null,
    pin: raw.commercialCataloguePin ?? null,
    errors: raw.commercialCatalogueErrors ?? [],
    drafts: (evaluation?.drafts ?? []).map((draft) => ({
      id: draft.id,
      status: draft.status,
      metadata: draft.metadata,
    })),
    recommendedNextAction: evaluation?.recommendedNextAction,
  };
}

function catalogueSafeguard(pin: CommercialSelectionPin): string {
  const proof = pin.proof.map((item) => `${item.proofId}@${item.proofVersion}`).join(', ') || 'no current proof';
  return `Pinned commercial catalogue: ${pin.offer.offerId}@${pin.offer.offerVersion}; proof pack ${pin.proofPack ? `${pin.proofPack.proofPackId}@${pin.proofPack.proofPackVersion}` : 'none'}; proof ${proof}.`;
}

function catalogueAuditNote(selection: CommercialSelection | undefined, errors: string[]): string {
  if (!selection) return `commercial_catalogue::selection_failed::${errors.join(' | ') || 'no campaign offer/route available'}`;
  const proof = selection.proof.map((item) => `${item.proofId}@${item.proofVersion}`).join(',') || 'none';
  const disqualifiers = selection.disqualifiers.map((item) => item.code).join(',') || 'none';
  return `commercial_catalogue::${selection.offer.offerId}@${selection.offer.offerVersion}::route=${selection.route}::proof=${proof}::disqualifiers=${disqualifiers}`;
}

async function parseResponse(response: Response): Promise<{body: IntakeResponseBody; headers: Record<string, string>} | undefined> {
  try {
    const body = await response.clone().json() as IntakeResponseBody;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-length') headers[key] = value;
    });
    return {body, headers};
  } catch {
    return undefined;
  }
}

function normalizeIds(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.map(String).map((item) => item.trim()).filter(Boolean)) : [];
}

function commercialRoute(value: unknown): CommercialRoute | undefined {
  return ['direct_buyer', 'channel_partner', 'delivery_partner', 'referral_partner'].includes(String(value))
    ? String(value) as CommercialRoute
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]').slice(0, 500);
}

function responseJson(value: unknown, status: number, existingHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...existingHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
