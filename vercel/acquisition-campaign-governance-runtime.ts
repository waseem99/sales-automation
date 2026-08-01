import {
  campaignRunDecision,
  DEFAULT_CAMPAIGN_GOVERNANCE,
  findCampaignGovernance,
  recordCampaignCapture,
  type CampaignGovernanceRecord,
  type CampaignSearchSource,
} from '@sales-automation/campaign-governance';
import {loadNeonAppState, persistLeadRecords} from '@sales-automation/neon-state';
import type {Lead} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const CAMPAIGN_GOVERNANCE_RUNTIME_VERSION = 'campaign-governance-runtime.v1';
const ACTOR = 'campaign-governance@codistan.local';
const MAX_PROCESSED_IDS = 50;

interface IntakeResponseBody {
  processedLeadIds?: unknown;
  [key: string]: unknown;
}

export async function applyCampaignGovernanceAfterIntake(input: {
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
    let allowedMatches = 0;
    let blockedMatches = 0;
    let driftWarnings = 0;
    let overlapWarnings = 0;

    for (const leadId of processedLeadIds) {
      const record = state.repository.getLead(leadId);
      if (!record) continue;
      const applied = applyGovernanceToLead(record.lead, generatedAt);
      allowedMatches += applied.allowedMatches;
      blockedMatches += applied.blockedMatches;
      driftWarnings += applied.driftWarnings;
      overlapWarnings += applied.overlapWarnings;
      if (!applied.changed) continue;
      state.repository.upsertLead(applied.lead, ACTOR);
      state.repository.addNote(
        leadId,
        `campaign_governance::allowed=${applied.allowedMatches}::blocked=${applied.blockedMatches}::drift=${applied.driftWarnings}::overlap=${applied.overlapWarnings}`,
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
      campaignGovernance: {
        status: 'applied',
        version: CAMPAIGN_GOVERNANCE_RUNTIME_VERSION,
        processed: processedLeadIds.length,
        touchedLeadIds: unique(touchedLeadIds),
        allowedMatches,
        blockedMatches,
        driftWarnings,
        overlapWarnings,
        lifecycleEnforcedServerSide: true,
        pausedAndRetiredRunDisabled: true,
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  } catch (error) {
    console.error('CAMPAIGN_GOVERNANCE_POST_INTAKE_ERROR', {
      message: safeErrorMessage(error),
      processedLeadCount: processedLeadIds.length,
    });
    return responseJson({
      ...parsed.body,
      campaignGovernance: {
        status: 'deferred',
        version: CAMPAIGN_GOVERNANCE_RUNTIME_VERSION,
        reason: 'Campaign matching succeeded, but lifecycle governance refresh was deferred. Recommendations remain human-review only.',
        lifecycleEnforcedServerSide: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  }
}

function applyGovernanceToLead(lead: Lead, generatedAt: string): {
  lead: Lead;
  changed: boolean;
  allowedMatches: number;
  blockedMatches: number;
  driftWarnings: number;
  overlapWarnings: number;
} {
  const raw = asRecord(lead.rawPayload);
  const rawMatches = Array.isArray(raw.campaignMatches) ? raw.campaignMatches : [];
  const governed = rawMatches.map((value) => governRecommendation(lead, asRecord(value), generatedAt));
  const recommendations = governed.map((item) => item.recommendation);
  const primaryCampaignId = text(asRecord(raw.primaryCampaignMatch).campaignId);
  const primary = governed.find((item) => text(item.recommendation.campaignId) === primaryCampaignId) ?? governed[0];
  const anyActionable = governed.some((item) => item.allowed && ['priority_a', 'priority_b'].includes(text(item.recommendation.disposition) ?? ''));
  const pipelineStatus = !anyActionable && lead.pipelineStatus === 'draft_ready' ? 'needs_human_review' : lead.pipelineStatus;
  const next: Lead = {
    ...lead,
    pipelineStatus,
    rawPayload: {
      ...raw,
      campaignMatches: recommendations,
      primaryCampaignMatch: primary?.recommendation ?? raw.primaryCampaignMatch ?? null,
      campaignGovernanceVersion: CAMPAIGN_GOVERNANCE_RUNTIME_VERSION,
      campaignGovernanceDecision: primary?.decision ?? null,
      campaignGovernanceRecord: primary?.governance ?? null,
      campaignGovernanceEvaluatedAt: generatedAt,
      campaignScheduleEnabled: primary?.decision.scheduleEnabled ?? false,
      externalActionPerformed: false,
    },
  };
  return {
    lead: next,
    changed: JSON.stringify(stableState(lead)) !== JSON.stringify(stableState(next)),
    allowedMatches: governed.filter((item) => item.allowed).length,
    blockedMatches: governed.filter((item) => !item.allowed).length,
    driftWarnings: governed.filter((item) => Boolean(item.decision.searchDriftWarning)).length,
    overlapWarnings: governed.reduce((total, item) => total + item.decision.overlapWarnings.length, 0),
  };
}

function governRecommendation(
  lead: Lead,
  recommendation: Record<string, unknown>,
  generatedAt: string,
): {
  recommendation: Record<string, unknown>;
  governance: CampaignGovernanceRecord | null;
  decision: ReturnType<typeof campaignRunDecision>;
  allowed: boolean;
} {
  const campaignId = text(recommendation.campaignId) ?? 'unresolved_campaign';
  const base = findCampaignGovernance(DEFAULT_CAMPAIGN_GOVERNANCE, campaignId);
  if (!base) {
    const decision = missingDecision(campaignId);
    return {
      governance: null,
      decision,
      allowed: false,
      recommendation: blockedRecommendation(recommendation, decision.blockers, null, decision),
    };
  }

  const baseDecision = campaignRunDecision(base);
  const observed = baseDecision.allowed
    ? recordCampaignCapture(base, {
        actor: ACTOR,
        source: sourceForLead(lead),
        capturedRecords: 1,
        occurredAt: generatedAt,
      })
    : base;
  const decision = campaignRunDecision(observed);
  const allowed = decision.allowed;
  return {
    governance: observed,
    decision,
    allowed,
    recommendation: allowed
      ? {
          ...recommendation,
          campaignGovernanceVersion: CAMPAIGN_GOVERNANCE_RUNTIME_VERSION,
          campaignOwner: observed.owner,
          campaignState: observed.state,
          campaignVersion: observed.campaignVersion,
          searchFingerprint: observed.searchFingerprint,
          searchDriftWarning: observed.searchDriftWarning ?? null,
          overlapWarnings: observed.overlapWarnings,
          lastSuccessfulCaptureAt: observed.lastSuccessfulCaptureAt,
          lastManualReviewAt: observed.lastManualReviewAt,
          campaignScheduleEnabled: true,
          governanceBlockers: [],
          humanReviewRequired: true,
          externalActionAutomated: false,
        }
      : blockedRecommendation(recommendation, decision.blockers, observed, decision),
  };
}

function blockedRecommendation(
  recommendation: Record<string, unknown>,
  blockers: string[],
  governance: CampaignGovernanceRecord | null,
  decision: ReturnType<typeof campaignRunDecision>,
): Record<string, unknown> {
  const currentDisposition = text(recommendation.disposition);
  return {
    ...recommendation,
    disposition: ['priority_a', 'priority_b'].includes(currentDisposition ?? '') ? 'research' : recommendation.disposition,
    campaignGovernanceVersion: CAMPAIGN_GOVERNANCE_RUNTIME_VERSION,
    campaignOwner: governance?.owner ?? null,
    campaignState: governance?.state ?? 'unregistered',
    campaignVersion: governance?.campaignVersion ?? null,
    searchFingerprint: governance?.searchFingerprint ?? null,
    searchDriftWarning: decision.searchDriftWarning ?? null,
    overlapWarnings: decision.overlapWarnings,
    lastSuccessfulCaptureAt: governance?.lastSuccessfulCaptureAt ?? null,
    lastManualReviewAt: governance?.lastManualReviewAt ?? null,
    campaignScheduleEnabled: false,
    governanceBlockers: blockers,
    risks: unique([...stringArray(recommendation.risks), ...blockers]),
    nextResearchAction: blockers[0] ?? 'Complete campaign governance before actionable qualification.',
    humanReviewRequired: true,
    externalActionAutomated: false,
  };
}

function missingDecision(campaignId: string): ReturnType<typeof campaignRunDecision> {
  return {
    campaignId,
    state: 'draft',
    allowed: false,
    scheduleEnabled: false,
    blockers: ['Campaign is not registered in the versioned governance portfolio.'],
    searchFingerprint: '',
    overlapWarnings: [],
    humanReviewRequired: true,
    externalActionAutomated: false,
  };
}

function sourceForLead(lead: Lead): CampaignSearchSource {
  if (lead.source === 'upwork') return 'upwork';
  if (lead.source === 'sales_navigator') return 'sales_navigator';
  return 'linkedin';
}

function stableState(lead: Lead): unknown {
  const raw = asRecord(lead.rawPayload);
  return {
    pipelineStatus: lead.pipelineStatus,
    campaignMatches: raw.campaignMatches ?? [],
    primaryCampaignMatch: raw.primaryCampaignMatch ?? null,
    governanceDecision: raw.campaignGovernanceDecision ?? null,
    governanceRecord: raw.campaignGovernanceRecord ?? null,
    scheduleEnabled: raw.campaignScheduleEnabled ?? false,
  };
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
