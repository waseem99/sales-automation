import {createHash, timingSafeEqual} from 'node:crypto';
import {
  applySellerDecisionOverride,
  attachDecisionScore,
  calculateDecisionScore,
  readDecisionScore,
  type DecisionPriority,
  type DecisionScoreComponentName,
} from '@sales-automation/decision-scoring';
import {loadNeonAppState, persistLeadRecords} from '@sales-automation/neon-state';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const maxDuration = 60;
const MAX_REQUEST_BYTES = 50_000;
const ACTOR = 'decision-score-override-api@codistan.local';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') return responseJson({error: 'Method not allowed.'}, 405, {allow: 'POST'});
      const configuredToken = requireEnvironment('ACQUISITION_INGEST_TOKEN');
      const suppliedToken = bearerToken(request.headers.get('authorization'));
      if (!suppliedToken || !safeTokenEqual(suppliedToken, configuredToken)) {
        return responseJson({error: 'Unauthorized.'}, 401, {'www-authenticate': 'Bearer'});
      }
      const contentLength = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
        return responseJson({error: 'Request body is too large.'}, 413);
      }
      const text = await request.text();
      if (!text || text.length > MAX_REQUEST_BYTES) return responseJson({error: 'A valid JSON body is required.'}, 400);
      const body = parseBody(text);
      const leadId = requiredText(body.leadId, 'leadId');
      const actor = requiredText(body.actor, 'actor');
      const reason = requiredText(body.reason, 'reason');
      const outcome = requiredText(body.outcome, 'outcome');
      if (reason.length < 10) return responseJson({error: 'reason must contain at least 10 characters.'}, 400);
      if (outcome.length < 5) return responseJson({error: 'outcome must contain at least 5 characters.'}, 400);

      const databaseUrl = requireEnvironment('DATABASE_URL');
      const state = await loadNeonAppState(databaseUrl);
      const existing = state.repository.getLead(leadId);
      if (!existing) return responseJson({error: 'Prospect not found.'}, 404);
      const current = readDecisionScore(existing.lead) ?? calculateDecisionScore(existing.lead);
      const overridden = applySellerDecisionOverride(current, {
        actor,
        reason,
        outcome,
        occurredAt: optionalIso(body.occurredAt),
        component: optionalComponent(body.component),
        newValue: optionalNumber(body.newValue),
        forcedPriority: optionalPriority(body.forcedPriority),
      });
      const raw = asRecord(existing.lead.rawPayload);
      const lead = attachDecisionScore({
        ...existing.lead,
        updatedAt: overridden.generatedAt,
        rawPayload: {
          ...raw,
          decisionScoreOverrideProtected: true,
          decisionScoreNeedsSellerReview: false,
          decisionScoreLastOverrideAt: overridden.generatedAt,
          decisionScoreLastOverrideActor: actor,
        },
      }, overridden);
      let record: StoredLeadRecord;
      if (existing.latestEvaluation) {
        record = state.repository.saveEvaluation({...existing.latestEvaluation, lead}, ACTOR);
      } else {
        record = state.repository.upsertLead(lead, ACTOR);
      }
      state.repository.addNote(
        leadId,
        `decision_score_override::actor=${actor}::component=${body.component ?? 'priority'}::prior_total=${current.total}::new_total=${overridden.total}::reason=${reason}::outcome=${outcome}`,
        ACTOR,
      );
      const persisted = state.repository.getLead(leadId) ?? record;
      await persistLeadRecords(databaseUrl, [persisted]);

      return responseJson({
        ok: true,
        leadId,
        decisionScore: overridden,
        originalScoreRetained: Boolean(overridden.originalScore),
        overrideHistoryCount: overridden.overrideHistory.length,
        humanReviewRequired: true,
        externalActionAutomated: false,
      }, 201);
    } catch (error) {
      return responseJson({
        error: safeErrorMessage(error),
        humanReviewRequired: true,
        externalActionAutomated: false,
      }, error instanceof SyntaxError ? 400 : 500);
    }
  },
};

function parseBody(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('Request body must be a JSON object.');
  return parsed as Record<string, unknown>;
}

function bearerToken(value: string | null): string | undefined {
  return /^Bearer\s+(.+)$/i.exec(value?.trim() ?? '')?.[1]?.trim() || undefined;
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

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('newValue must be a finite number.');
  return value;
}

function optionalIso(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = requiredText(value, 'occurredAt');
  if (Number.isNaN(new Date(normalized).getTime())) throw new Error('occurredAt must be a valid date.');
  return normalized;
}

function optionalComponent(value: unknown): DecisionScoreComponentName | 'risk_penalty' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = requiredText(value, 'component');
  const allowed = [
    'account_fit', 'contact_fit', 'buyer_intent', 'service_fit',
    'evidence_quality', 'freshness', 'commercial_readiness', 'risk_penalty',
  ];
  if (!allowed.includes(normalized)) throw new Error('Unsupported decision score component.');
  return normalized as DecisionScoreComponentName | 'risk_penalty';
}

function optionalPriority(value: unknown): DecisionPriority | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = requiredText(value, 'forcedPriority');
  if (!['priority_a', 'priority_b', 'research', 'reject'].includes(normalized)) throw new Error('Unsupported decision priority.');
  return normalized as DecisionPriority;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]').slice(0, 500);
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
