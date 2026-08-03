import {createHash, timingSafeEqual} from 'node:crypto';
import {
  isFunnelReasonCode,
  isFunnelStage,
  isFunnelTransitionKind,
  readSellerFunnel,
  recordFunnelTransition,
  type SellerFeedbackSnapshot,
} from '@sales-automation/funnel-analytics';
import {loadNeonAppState, persistLeadRecords} from '@sales-automation/neon-state';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const maxDuration = 60;
const MAX_REQUEST_BYTES = 50_000;
const API_ACTOR = 'funnel-feedback-api@codistan.local';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') return responseJson({error: 'Method not allowed.'}, 405, {allow: 'POST'});
      authenticate(request);
      const body = await readBody(request);
      const leadId = requiredText(body.leadId, 'leadId');
      const actor = requiredText(body.actor, 'actor');
      const stage = body.stage;
      const reasonCode = body.reasonCode;
      const transitionKind = body.transitionKind;
      if (!isFunnelStage(stage)) return responseJson({error: 'Unsupported funnel stage.'}, 400);
      if (!isFunnelReasonCode(reasonCode)) return responseJson({error: 'Unsupported funnel reason code.'}, 400);
      if (!isFunnelTransitionKind(transitionKind)) return responseJson({error: 'Unsupported transition kind.'}, 400);

      const databaseUrl = requireEnvironment('DATABASE_URL');
      const state = await loadNeonAppState(databaseUrl);
      const existing = state.repository.getLead(leadId);
      if (!existing) return responseJson({error: 'Prospect not found.'}, 404);

      const lead = recordFunnelTransition(existing.lead, {
        stage,
        reasonCode,
        actor,
        transitionKind,
        occurredAt: optionalIso(body.occurredAt),
        evidence: optionalText(body.evidence, 1_000),
        backfill: body.backfill === true,
        feedback: feedbackSnapshot(body.feedback),
      });
      let record: StoredLeadRecord;
      if (existing.latestEvaluation) record = state.repository.saveEvaluation({...existing.latestEvaluation, lead}, API_ACTOR);
      else record = state.repository.upsertLead(lead, API_ACTOR);
      state.repository.addNote(
        leadId,
        `seller_funnel_transition::stage=${stage}::kind=${transitionKind}::reason=${reasonCode}::actor=${actor}::external_action_automated=false`,
        API_ACTOR,
      );
      const persisted = state.repository.getLead(leadId) ?? record;
      await persistLeadRecords(databaseUrl, [persisted]);
      const timeline = readSellerFunnel(persisted.lead);

      return responseJson({
        ok: true,
        leadId,
        currentStage: timeline.currentStage,
        eventCount: timeline.events.length,
        latestEvent: timeline.events.at(-1),
        pipelineStatus: persisted.lead.pipelineStatus,
        humanReviewRequired: true,
        externalActionAutomated: false,
      }, 201);
    } catch (error) {
      const message = safeErrorMessage(error);
      const status = message === 'Unauthorized.' ? 401 : message.includes('required') || message.includes('Unsupported') || message.includes('Invalid funnel') || message.includes('requires') ? 400 : 500;
      return responseJson({error: message, humanReviewRequired: true, externalActionAutomated: false}, status, status === 401 ? {'www-authenticate': 'Bearer'} : {});
    }
  },
};

function authenticate(request: Request): void {
  const configuredToken = requireEnvironment('ACQUISITION_INGEST_TOKEN');
  const suppliedToken = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization')?.trim() ?? '')?.[1]?.trim();
  if (!suppliedToken || !safeTokenEqual(suppliedToken, configuredToken)) throw new Error('Unauthorized.');
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  const text = await request.text();
  if (!text || text.length > MAX_REQUEST_BYTES) throw new Error('A valid JSON body is required.');
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request body must be a JSON object.');
  return parsed as Record<string, unknown>;
}

function feedbackSnapshot(value: unknown): SellerFeedbackSnapshot | undefined {
  if (value === undefined || value === null) return undefined;
  const feedback = asRecord(value);
  const rating = feedback.relevanceRating;
  return {
    relevanceRating: rating === undefined ? undefined : numericRating(rating),
    contactAccuracy: optionalEnum(feedback.contactAccuracy, ['accurate', 'partially_accurate', 'wrong', 'missing']),
    sourceQuality: optionalEnum(feedback.sourceQuality, ['high', 'medium', 'low']),
    repeatRecommendation: optionalEnum(feedback.repeatRecommendation, ['increase', 'keep', 'reduce', 'stop']),
    correctedServiceCategory: optionalText(feedback.correctedServiceCategory, 160),
    comment: optionalText(feedback.comment, 1_000),
  };
}

function numericRating(value: unknown): 1 | 2 | 3 | 4 | 5 {
  if (typeof value !== 'number' || ![1, 2, 3, 4, 5].includes(value)) throw new Error('relevanceRating must be between 1 and 5.');
  return value as 1 | 2 | 3 | 4 | 5;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('Unsupported feedback value.');
  return value as T;
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().slice(0, maxLength);
}

function optionalIso(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = requiredText(value, 'occurredAt');
  if (Number.isNaN(Date.parse(normalized))) throw new Error('occurredAt must be a valid date.');
  return new Date(normalized).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
}

function responseJson(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
