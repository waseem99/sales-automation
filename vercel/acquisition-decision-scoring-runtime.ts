import {
  attachDecisionScore,
  calculateDecisionScore,
  DECISION_SCORE_VERSION,
  readDecisionScore,
  type DecisionPriority,
  type DecisionScoreResult,
} from '@sales-automation/decision-scoring';
import type {LeadEvaluation} from '@sales-automation/evaluator';
import {loadNeonAppState, persistLeadRecords} from '@sales-automation/neon-state';
import type {Lead} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const DECISION_SCORING_RUNTIME_VERSION = 'decision-scoring-runtime.v1';
const ACTOR = 'decision-scoring@codistan.local';
const MAX_PROCESSED_IDS = 50;

interface IntakeResponseBody {
  processedLeadIds?: unknown;
  [key: string]: unknown;
}

export async function applyDecisionScoringAfterIntake(input: {
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
    const priorities: Record<DecisionPriority, number> = {
      priority_a: 0,
      priority_b: 0,
      research: 0,
      reject: 0,
    };
    let overrideProtected = 0;

    for (const leadId of processedLeadIds) {
      const record = state.repository.getLead(leadId);
      if (!record) continue;
      const applied = applyDecisionScoreToRecord(record, generatedAt);
      priorities[applied.score.priority] += 1;
      if (applied.overrideProtected) overrideProtected += 1;
      if (!applied.changed) continue;

      if (applied.evaluation) state.repository.saveEvaluation(applied.evaluation, ACTOR);
      else state.repository.upsertLead(applied.lead, ACTOR);
      state.repository.addNote(leadId, decisionScoreAuditNote(applied.score, applied.overrideProtected), ACTOR);
      touchedLeadIds.push(leadId);
    }

    const touchedRecords = unique(touchedLeadIds)
      .map((leadId) => state.repository.getLead(leadId))
      .filter((record): record is StoredLeadRecord => Boolean(record));
    await persistLeadRecords(input.databaseUrl, touchedRecords);

    return responseJson({
      ...parsed.body,
      decisionScoring: {
        status: 'applied',
        version: DECISION_SCORING_RUNTIME_VERSION,
        scoreModelVersion: DECISION_SCORE_VERSION,
        processed: processedLeadIds.length,
        touchedLeadIds: unique(touchedLeadIds),
        priorities,
        overrideProtected,
        aggregateReproducible: true,
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  } catch (error) {
    console.error('DECISION_SCORING_POST_INTAKE_ERROR', {
      message: safeErrorMessage(error),
      processedLeadCount: processedLeadIds.length,
    });
    return responseJson({
      ...parsed.body,
      decisionScoring: {
        status: 'deferred',
        version: DECISION_SCORING_RUNTIME_VERSION,
        scoreModelVersion: DECISION_SCORE_VERSION,
        reason: 'Upstream ingestion succeeded, but component decision scoring was deferred for a later retry.',
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  }
}

export function applyDecisionScoreToRecord(record: StoredLeadRecord, generatedAt: string): {
  lead: Lead;
  evaluation?: LeadEvaluation;
  score: DecisionScoreResult;
  overrideProtected: boolean;
  changed: boolean;
} {
  const freshScore = calculateDecisionScore(record.lead, generatedAt);
  const existingScore = readDecisionScore(record.lead);
  const overrideProtected = Boolean(existingScore && existingScore.overrideHistory.length > 0);
  const score = overrideProtected && existingScore ? existingScore : freshScore;
  const raw = asRecord(record.lead.rawPayload);
  const lead = attachDecisionScore({
    ...record.lead,
    rawPayload: {
      ...raw,
      decisionScoreLatestModelCandidate: overrideProtected ? freshScore : null,
      decisionScoreOverrideProtected: overrideProtected,
      decisionScoreNeedsSellerReview: overrideProtected && freshScore.resultHash !== existingScore?.resultHash,
      decisionScoringRuntimeVersion: DECISION_SCORING_RUNTIME_VERSION,
    },
  }, score);
  const evaluation = record.latestEvaluation ? {...record.latestEvaluation, lead} : undefined;
  return {
    lead,
    evaluation,
    score,
    overrideProtected,
    changed: JSON.stringify(stableDecisionState(record.lead)) !== JSON.stringify(stableDecisionState(lead)),
  };
}

function stableDecisionState(lead: Lead): unknown {
  const raw = asRecord(lead.rawPayload);
  return {
    score: raw.decisionScore ?? null,
    candidate: raw.decisionScoreLatestModelCandidate ?? null,
    overrideProtected: raw.decisionScoreOverrideProtected ?? false,
    needsReview: raw.decisionScoreNeedsSellerReview ?? false,
    runtimeVersion: raw.decisionScoringRuntimeVersion ?? null,
  };
}

function decisionScoreAuditNote(score: DecisionScoreResult, overrideProtected: boolean): string {
  return [
    `decision_score::${score.version}`,
    `total=${score.total}`,
    `priority=${score.priority}`,
    `intent_confirmed=${score.buyerIntentConfirmed}`,
    `cold_source_preserved=${score.coldSourcePreserved}`,
    `risk_penalty=${score.riskPenalty}`,
    `override_protected=${overrideProtected}`,
    `hash=${score.resultHash}`,
  ].join('::');
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
