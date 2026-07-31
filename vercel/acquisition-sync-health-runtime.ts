import {createSyncHealthSnapshot, redactDiagnostic, type SyncHealthRecord, type SyncSource} from '@sales-automation/sync-health';
import {loadNeonAppState, persistLeadRecords} from '@sales-automation/neon-state';
import {persistSyncHealthSnapshot} from '../packages/neon-state/src/sync-health-store.js';
import type {LeadEvaluation} from '@sales-automation/evaluator';
import type {Lead} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const SYNC_HEALTH_RUNTIME_VERSION = 'sync-health-runtime.v1';
const ACTOR = 'sync-health-runtime@codistan.local';
const MAX_HISTORY = 100;

interface ReconciliationRecord {
  source?: unknown;
  idempotencyKey?: unknown;
  expectedLeadId?: unknown;
  status?: unknown;
  outcome?: unknown;
  reason?: unknown;
  [key: string]: unknown;
}

interface ReconciliationBody {
  version?: unknown;
  source?: unknown;
  counts?: unknown;
  records?: unknown;
  [key: string]: unknown;
}

export async function applySyncHealthAfterReconciliation(input: {
  response: Response;
  databaseUrl: string;
  generatedAt?: string;
}): Promise<Response> {
  const parsed = await parseResponse(input.response);
  if (!parsed) return input.response;
  const reconciliation = asRecord(parsed.body.reconciliation) as ReconciliationBody;
  const source = syncSource(reconciliation.source);
  const rawRecords = Array.isArray(reconciliation.records) ? reconciliation.records : [];
  const records = rawRecords.map((item) => asRecord(item) as ReconciliationRecord);
  if (!source || records.length === 0) return input.response;

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  try {
    const state = await loadNeonAppState(input.databaseUrl);
    const touchedLeadIds: string[] = [];
    for (const item of records) {
      const leadId = text(item.expectedLeadId);
      if (!leadId) continue;
      const existing = state.repository.getLead(leadId);
      if (!existing) continue;
      const applied = attachReconciliationHealth(existing, item, generatedAt);
      if (applied.evaluation) state.repository.saveEvaluation(applied.evaluation, ACTOR);
      else state.repository.upsertLead(applied.lead, ACTOR);
      touchedLeadIds.push(leadId);
    }
    const touchedRecords = unique(touchedLeadIds)
      .map((leadId) => state.repository.getLead(leadId))
      .filter((record): record is StoredLeadRecord => Boolean(record));
    await persistLeadRecords(input.databaseUrl, touchedRecords);

    const counts = asRecord(reconciliation.counts);
    const healthRecords = records.map(toHealthRecord).filter((item): item is SyncHealthRecord => Boolean(item));
    const snapshot = createSyncHealthSnapshot({
      source,
      collectedAt: generatedAt,
      capture: 'unknown',
      localProcessing: 'unknown',
      outbox: healthRecords.length ? 'degraded' : 'unknown',
      prospectDeskIngestion: count(counts.failed) > 0 || count(counts.conflicted) > 0 ? 'degraded' : 'healthy',
      endpointVersion: text(reconciliation.version),
      pending: count(counts.pending),
      conflicted: count(counts.conflicted),
      applied: count(counts.applied),
      duplicates: count(counts.duplicate),
      merged: count(counts.merged),
      failed: count(counts.failed),
      records: healthRecords,
      diagnostics: records
        .filter((item) => ['failed', 'conflicted', 'pending'].includes(text(item.status) ?? ''))
        .map((item) => ({status: item.status, reason: item.reason, idempotencyKey: item.idempotencyKey})),
      lastAttemptAt: generatedAt,
      lastSuccessfulSyncAt: count(counts.applied) + count(counts.duplicate) + count(counts.merged) > 0 ? generatedAt : undefined,
    });
    await persistSyncHealthSnapshot(input.databaseUrl, snapshot);

    return responseJson({
      ...parsed.body,
      syncHealthPersistence: {
        status: 'applied',
        version: SYNC_HEALTH_RUNTIME_VERSION,
        source,
        touchedLeadIds: unique(touchedLeadIds),
        snapshotHash: snapshot.snapshotHash,
        diagnosticsRedacted: true,
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  } catch (error) {
    console.error('SYNC_HEALTH_PERSISTENCE_ERROR', {message: safeErrorMessage(error), source});
    return responseJson({
      ...parsed.body,
      syncHealthPersistence: {
        status: 'deferred',
        version: SYNC_HEALTH_RUNTIME_VERSION,
        source,
        reason: 'Reconciliation succeeded, but redacted health persistence was deferred.',
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  }
}

export function attachReconciliationHealth(record: StoredLeadRecord, item: ReconciliationRecord, occurredAt: string): {
  lead: Lead;
  evaluation?: LeadEvaluation;
} {
  const raw = asRecord(record.lead.rawPayload);
  const history = Array.isArray(raw.syncReconciliationHistory)
    ? raw.syncReconciliationHistory.filter((entry) => entry && typeof entry === 'object').slice(-(MAX_HISTORY - 1))
    : [];
  const event = {
    version: 'sync-record-health.v1',
    occurredAt,
    source: text(item.source) ?? record.lead.source,
    idempotencyKey: text(item.idempotencyKey),
    expectedLeadId: text(item.expectedLeadId),
    status: text(item.status) ?? 'pending',
    outcome: text(item.outcome),
    reason: safeText(item.reason),
    sellerFieldsPreserved: true,
    sourceEvidenceRetained: true,
    diagnosticsRedacted: true,
    externalActionAutomated: false,
  };
  const lead: Lead = {
    ...record.lead,
    updatedAt: occurredAt,
    rawPayload: {
      ...raw,
      syncHealthLatest: event,
      syncReconciliationHistory: [...history, event],
    },
  };
  return {lead, evaluation: record.latestEvaluation ? {...record.latestEvaluation, lead} : undefined};
}

function toHealthRecord(item: ReconciliationRecord): SyncHealthRecord | undefined {
  const idempotencyKey = text(item.idempotencyKey);
  const status = text(item.status);
  if (!idempotencyKey || !status) return undefined;
  if (status === 'conflicted') return {idempotencyKey, status: 'conflicted', attempts: 0, lastError: safeText(item.reason)};
  if (status === 'failed') return {idempotencyKey, status: 'retrying', attempts: 1, lastError: safeText(item.reason)};
  if (status === 'pending') return {idempotencyKey, status: 'pending', attempts: 0, lastError: safeText(item.reason)};
  return undefined;
}

async function parseResponse(response: Response): Promise<{body: Record<string, unknown>; headers: Record<string, string>} | undefined> {
  try {
    const body = await response.clone().json() as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-length') headers[key] = value;
    });
    return {body: body as Record<string, unknown>, headers};
  } catch {
    return undefined;
  }
}

function syncSource(value: unknown): SyncSource | undefined {
  return value === 'linkedin' || value === 'upwork' || value === 'sales_navigator' ? value : undefined;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : undefined;
}

function safeText(value: unknown): string | undefined {
  const normalized = text(value);
  return normalized ? redactDiagnostic(normalized) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactDiagnostic(message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]')).slice(0, 500);
}

function responseJson(value: unknown, status: number, existingHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {...existingHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
  });
}
