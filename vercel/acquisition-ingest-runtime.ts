import { timingSafeEqual } from 'node:crypto';
import { loadNeonAppState, persistLeadRecords, requireDatabaseUrl } from '@sales-automation/neon-state';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { handleManualIntakeRuntime } from './manual-intake-runtime.js';

const MAX_BODY_BYTES = 1_000_000;
const ACTOR = 'acquisition-worker';

interface WorkerQualification {
  priority: 'A' | 'B';
  score: number;
  disposition?: string;
  business_unit?: string;
  service_id?: string;
  confidence?: string;
  recommended_action?: string;
  configuration_version?: string;
}

interface WorkerEvidence {
  source: 'upwork';
  source_id: string;
  source_url: string;
  captured_at?: string;
  title: string;
  body: string;
  segment?: string;
  attributes: Record<string, unknown>;
}

interface WorkerPayload {
  schema_version: 'prospect-desk-opportunity.v1';
  idempotency_key: string;
  source: 'upwork_scheduled_chrome';
  external_action_performed: false;
  source_record: {
    dedupe_key?: string;
    evidence: WorkerEvidence;
  };
  qualification: WorkerQualification;
}

export async function handleAcquisitionIngest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return responseJson({ error: 'Method not allowed.' }, 405, { allow: 'POST' });
  }

  const configuredToken = process.env.ACQUISITION_INGEST_TOKEN?.trim() ?? '';
  if (!configuredToken) {
    return responseJson({ error: 'Acquisition ingestion is not configured.' }, 503);
  }
  const suppliedToken = bearerToken(request.headers.get('authorization'));
  if (!suppliedToken || !safeTokenEqual(suppliedToken, configuredToken)) {
    return responseJson({ error: 'Authentication required.' }, 401, {
      'www-authenticate': 'Bearer realm="prospect-desk-acquisition"',
    });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return responseJson({ error: 'Request body is too large.' }, 413);
  }

  try {
    const payload = validatePayload(await request.json());
    const databaseUrl = requireDatabaseUrl(process.env.DATABASE_URL);
    const state = await loadNeonAppState(databaseUrl);
    const manualResponse = await handleManualIntakeRuntime({
      body: toManualIntake(payload),
      databaseUrl,
      actor: ACTOR,
      state,
    });
    const manualResult = await readResponseObject(manualResponse);

    if (!manualResponse.ok) {
      return responseJson({
        error: 'Prospect Desk rejected the acquisition record.',
        intakeStatus: manualResponse.status,
        humanReviewRequired: true,
        externalActionAutomated: false,
      }, manualResponse.status >= 500 ? 502 : 400);
    }

    const createdLeadIds = stringArray(manualResult.createdLeadIds);
    const duplicateLeadIds = stringArray(manualResult.duplicateLeadIds);
    if (createdLeadIds.length > 0) {
      const note = qualificationNote(payload);
      for (const leadId of createdLeadIds) {
        state.repository.addNote(leadId, note, ACTOR);
      }
      const changed = createdLeadIds
        .map((leadId) => state.repository.getLead(leadId))
        .filter((record): record is StoredLeadRecord => Boolean(record));
      await persistLeadRecords(databaseUrl, changed);
    }

    return responseJson({
      ok: true,
      accepted: true,
      idempotencyKey: payload.idempotency_key,
      priority: payload.qualification.priority,
      score: payload.qualification.score,
      created: createdLeadIds.length,
      duplicates: duplicateLeadIds.length,
      createdLeadIds,
      duplicateLeadIds,
      prospectUrl: typeof manualResult.prospectUrl === 'string' ? manualResult.prospectUrl : undefined,
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, createdLeadIds.length > 0 ? 201 : 200);
  } catch (error) {
    return responseJson({
      error: error instanceof IntakeValidationError ? error.message : 'Acquisition ingestion failed.',
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, error instanceof IntakeValidationError ? 400 : 500);
  }
}

class IntakeValidationError extends Error {}

function validatePayload(value: unknown): WorkerPayload {
  const payload = asObject(value, 'request body');
  if (payload.schema_version !== 'prospect-desk-opportunity.v1') {
    throw new IntakeValidationError('schema_version is invalid.');
  }
  if (payload.source !== 'upwork_scheduled_chrome') {
    throw new IntakeValidationError('source is invalid.');
  }
  if (payload.external_action_performed !== false) {
    throw new IntakeValidationError('external_action_performed must be false.');
  }

  const idempotencyKey = requiredText(payload.idempotency_key, 'idempotency_key', 256);
  const headerKey = idempotencyKey;
  const sourceRecord = asObject(payload.source_record, 'source_record');
  const evidenceValue = asObject(sourceRecord.evidence, 'source_record.evidence');
  const attributes = optionalObject(evidenceValue.attributes);
  const sourceUrl = requiredText(evidenceValue.source_url, 'source_record.evidence.source_url', 2_000);
  validateUpworkUrl(sourceUrl);
  if (evidenceValue.source !== 'upwork') {
    throw new IntakeValidationError('source_record.evidence.source must be upwork.');
  }

  const qualificationValue = asObject(payload.qualification, 'qualification');
  const priority = qualificationValue.priority;
  if (priority !== 'A' && priority !== 'B') {
    throw new IntakeValidationError('Only Priority A and B opportunities may be ingested.');
  }
  const score = numericScore(qualificationValue.score);

  return {
    schema_version: 'prospect-desk-opportunity.v1',
    idempotency_key: headerKey,
    source: 'upwork_scheduled_chrome',
    external_action_performed: false,
    source_record: {
      dedupe_key: optionalText(sourceRecord.dedupe_key, 256),
      evidence: {
        source: 'upwork',
        source_id: requiredText(evidenceValue.source_id, 'source_record.evidence.source_id', 256),
        source_url: sourceUrl,
        captured_at: optionalText(evidenceValue.captured_at, 128),
        title: requiredText(evidenceValue.title, 'source_record.evidence.title', 500),
        body: requiredText(evidenceValue.body, 'source_record.evidence.body', 20_000),
        segment: optionalText(evidenceValue.segment, 128),
        attributes,
      },
    },
    qualification: {
      priority,
      score,
      disposition: optionalText(qualificationValue.disposition, 128),
      business_unit: optionalText(qualificationValue.business_unit, 128),
      service_id: optionalText(qualificationValue.service_id, 128),
      confidence: optionalText(qualificationValue.confidence, 64),
      recommended_action: optionalText(qualificationValue.recommended_action, 1_000),
      configuration_version: optionalText(qualificationValue.configuration_version, 128),
    },
  };
}

function toManualIntake(payload: WorkerPayload): Record<string, unknown> {
  const evidence = payload.source_record.evidence;
  const attributes = evidence.attributes;
  const skills = Array.isArray(attributes.skills)
    ? attributes.skills.map((item) => String(item).trim()).filter(Boolean).slice(0, 30)
    : [];
  const content = [
    evidence.title,
    evidence.body,
    `Upwork job ID: ${evidence.source_id}`,
    `Acquisition priority: ${payload.qualification.priority}`,
    `Acquisition score: ${payload.qualification.score}`,
    payload.qualification.business_unit ? `Business unit: ${payload.qualification.business_unit}` : '',
    payload.qualification.service_id ? `Service route: ${payload.qualification.service_id}` : '',
    valueLine('Budget USD', attributes.budget_usd),
    valueLine('Hourly minimum USD', attributes.hourly_min_usd),
    valueLine('Hourly maximum USD', attributes.hourly_max_usd),
    valueLine('Client spend USD', attributes.client_spend_usd),
    valueLine('Client hire rate', attributes.client_hire_rate),
    valueLine('Payment status', attributes.payment_status),
    valueLine('Proposal activity', attributes.proposal_activity),
    valueLine('Client country', attributes.client_country),
    skills.length > 0 ? `Skills: ${skills.join(', ')}` : '',
  ].filter(Boolean).join('\n\n');

  return {
    sourceKind: 'public_url',
    content,
    sourceUrl: evidence.source_url,
    title: evidence.title,
    companyName: 'Upwork Client',
    country: typeof attributes.client_country === 'string' ? attributes.client_country : undefined,
  };
}

function qualificationNote(payload: WorkerPayload): string {
  const qualification = payload.qualification;
  return [
    'acquisition::upwork_scheduled',
    `idempotency=${payload.idempotency_key}`,
    `priority=${qualification.priority}`,
    `score=${qualification.score}`,
    `business_unit=${qualification.business_unit ?? 'unrouted'}`,
    `service=${qualification.service_id ?? 'unrouted'}`,
    `disposition=${qualification.disposition ?? 'unknown'}`,
    `confidence=${qualification.confidence ?? 'unknown'}`,
    'external_action=false',
  ].join('::');
}

function validateUpworkUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new IntakeValidationError('source_record.evidence.source_url is invalid.');
  }
  if (url.protocol !== 'https:' || !['upwork.com', 'www.upwork.com'].includes(url.hostname)) {
    throw new IntakeValidationError('source_record.evidence.source_url must be an HTTPS Upwork URL.');
  }
  if (!url.pathname.includes('/jobs/') && !url.pathname.includes('/freelance-jobs/apply/')) {
    throw new IntakeValidationError('source_record.evidence.source_url must identify an Upwork job.');
  }
}

function bearerToken(value: string | null): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function numericScore(value: unknown): number {
  const score = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new IntakeValidationError('qualification.score must be between 0 and 100.');
  }
  return Math.round(score);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IntakeValidationError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IntakeValidationError(`${field} is required.`);
  }
  const text = value.trim();
  if (text.length > maximum) throw new IntakeValidationError(`${field} is too long.`);
  return text;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().slice(0, maximum);
}

function valueLine(label: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return `${label}: ${String(value).slice(0, 200)}`;
}

async function readResponseObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 100)
    : [];
}

function responseJson(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}
