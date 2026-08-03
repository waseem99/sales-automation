import {applySystemFunnelStages, readSellerFunnel, SELLER_FUNNEL_VERSION} from '@sales-automation/funnel-analytics';
import type {LeadEvaluation} from '@sales-automation/evaluator';
import {loadNeonAppState, persistLeadRecords} from '@sales-automation/neon-state';
import type {Lead} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const FUNNEL_RUNTIME_VERSION = 'seller-funnel-runtime.v1';
const ACTOR = 'funnel-runtime@codistan.local';
const MAX_PROCESSED_IDS = 50;

interface IntakeResponseBody {
  processedLeadIds?: unknown;
  [key: string]: unknown;
}

export async function applyFunnelAnalyticsAfterIntake(input: {
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
    let captured = 0;
    let technicallyValid = 0;
    let qualified = 0;

    for (const leadId of processedLeadIds) {
      const record = state.repository.getLead(leadId);
      if (!record) continue;
      const before = readSellerFunnel(record.lead);
      const lead = applySystemFunnelStages(record.lead, generatedAt);
      const after = readSellerFunnel(lead);
      captured += Number(after.events.some((event) => event.stage === 'captured'));
      technicallyValid += Number(after.events.some((event) => event.stage === 'technically_valid'));
      qualified += Number(after.events.some((event) => event.stage === 'qualified'));
      if (before.events.length === after.events.length) continue;

      const evaluation: LeadEvaluation | undefined = record.latestEvaluation
        ? {...record.latestEvaluation, lead}
        : undefined;
      if (evaluation) state.repository.saveEvaluation(evaluation, ACTOR);
      else state.repository.upsertLead(lead, ACTOR);
      state.repository.addNote(
        leadId,
        `seller_funnel::${SELLER_FUNNEL_VERSION}::events=${after.events.length}::current=${after.currentStage ?? 'none'}::external_action_automated=false`,
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
      sellerFunnel: {
        status: 'applied',
        version: FUNNEL_RUNTIME_VERSION,
        contractVersion: SELLER_FUNNEL_VERSION,
        processed: processedLeadIds.length,
        touchedLeadIds: unique(touchedLeadIds),
        captured,
        technicallyValid,
        qualified,
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  } catch (error) {
    console.error('SELLER_FUNNEL_POST_INTAKE_ERROR', {
      message: safeErrorMessage(error),
      processedLeadCount: processedLeadIds.length,
    });
    return responseJson({
      ...parsed.body,
      sellerFunnel: {
        status: 'deferred',
        version: FUNNEL_RUNTIME_VERSION,
        contractVersion: SELLER_FUNNEL_VERSION,
        reason: 'Upstream ingestion succeeded, but funnel event persistence was deferred for a later retry.',
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  }
}

export function applyFunnelToRecord(record: StoredLeadRecord, generatedAt: string): {
  lead: Lead;
  evaluation?: LeadEvaluation;
  changed: boolean;
} {
  const lead = applySystemFunnelStages(record.lead, generatedAt);
  return {
    lead,
    evaluation: record.latestEvaluation ? {...record.latestEvaluation, lead} : undefined,
    changed: readSellerFunnel(lead).events.length !== readSellerFunnel(record.lead).events.length,
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
