import {
  attachCampaignMatches,
  DEFAULT_PORTFOLIO,
  matchLeadToCampaigns,
  validatePortfolio,
  type CampaignMatch,
} from '@sales-automation/campaign-engine';
import { loadNeonAppState, persistLeadRecords } from '@sales-automation/neon-state';
import type { StoredLeadRecord } from '@sales-automation/storage';

const ACTOR = 'campaign-engine@codistan.local';
const MAX_PROCESSED_IDS = 50;

interface IntakeResponseBody {
  processedLeadIds?: unknown;
  [key: string]: unknown;
}

export async function applyCampaignEngineAfterIntake(input: {
  response: Response;
  databaseUrl: string;
}): Promise<Response> {
  if (!input.response.ok) return input.response;
  const parsed = await parseResponse(input.response);
  if (!parsed) return input.response;
  const processedLeadIds = normalizeIds(parsed.body.processedLeadIds).slice(0, MAX_PROCESSED_IDS);
  if (processedLeadIds.length === 0) return input.response;

  try {
    const validationErrors = validatePortfolio(DEFAULT_PORTFOLIO);
    if (validationErrors.length > 0) throw new Error(`Campaign portfolio is invalid: ${validationErrors.join(' ')}`);
    const state = await loadNeonAppState(input.databaseUrl);
    const touchedLeadIds: string[] = [];
    const matchesByLead: Array<{leadId: string; matches: CampaignMatch[]}> = [];

    for (const leadId of processedLeadIds) {
      const record = state.repository.getLead(leadId);
      if (!record) continue;
      const matches = matchLeadToCampaigns(record.lead, DEFAULT_PORTFOLIO);
      matchesByLead.push({leadId, matches});
      const previous = stableCampaignState(record.lead.rawPayload);
      const enrichedLead = attachCampaignMatches(record.lead, matches);
      const next = stableCampaignState(enrichedLead.rawPayload);
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;
      state.repository.upsertLead(enrichedLead, ACTOR);
      touchedLeadIds.push(leadId);
    }

    const touchedRecords = unique(touchedLeadIds)
      .map((leadId) => state.repository.getLead(leadId))
      .filter((record): record is StoredLeadRecord => Boolean(record));
    await persistLeadRecords(input.databaseUrl, touchedRecords);

    const allMatches = matchesByLead.flatMap((entry) => entry.matches);
    return responseJson({
      ...parsed.body,
      campaignEngine: {
        status: 'applied',
        processed: matchesByLead.length,
        touchedLeadIds: unique(touchedLeadIds),
        matchedLeads: matchesByLead.filter((entry) => entry.matches.length > 0).length,
        priorityA: allMatches.filter((match) => match.disposition === 'priority_a').length,
        priorityB: allMatches.filter((match) => match.disposition === 'priority_b').length,
        research: allMatches.filter((match) => match.disposition === 'research').length,
        directBuyer: allMatches.filter((match) => match.route === 'direct_buyer').length,
        channelPartner: allMatches.filter((match) => match.route === 'channel_partner').length,
        deliveryPartner: allMatches.filter((match) => match.route === 'delivery_partner').length,
        explicitBuyerIntentConfirmed: allMatches.filter((match) => match.explicitBuyerIntentConfirmed).length,
        coldHypotheses: allMatches.filter((match) => !match.explicitBuyerIntentConfirmed).length,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  } catch (error) {
    console.error('ACQUISITION_CAMPAIGN_POST_INTAKE_ERROR', {
      message: safeErrorMessage(error),
      processedLeadCount: processedLeadIds.length,
    });
    return responseJson({
      ...parsed.body,
      campaignEngine: {
        status: 'deferred',
        processed: 0,
        reason: 'Source ingestion, identity and enrichment succeeded, but campaign matching was deferred for a later retry.',
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  }
}

function stableCampaignState(value: unknown): unknown {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    campaignEngineVersion: raw.campaignEngineVersion ?? null,
    campaignMatches: raw.campaignMatches ?? [],
    primaryCampaignMatch: raw.primaryCampaignMatch ?? null,
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
  if (!Array.isArray(value)) return [];
  return unique(value.map(String).map((item) => item.trim()).filter(Boolean));
}

function unique(values: string[]): string[] {
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
