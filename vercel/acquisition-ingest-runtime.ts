const MAX_BODY_BYTES = 1_000_000;
const ACTOR = 'acquisition-worker';

type IntakePayload = {
  idempotencyKey: string;
  priority: 'A' | 'B';
  score: number;
  title: string;
  body: string;
  sourceId: string;
  sourceUrl: string;
  businessUnit?: string;
  serviceId?: string;
  disposition?: string;
  confidence?: string;
  recommendedAction?: string;
  configurationVersion?: string;
  attributes: Record<string, unknown>;
};

export async function handleAcquisitionIngest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, { allow: 'POST' });
  }

  const configuredToken = process.env.ACQUISITION_INGEST_TOKEN?.trim() ?? '';
  if (!configuredToken) {
    return json({ error: 'Acquisition ingestion is not configured.' }, 503);
  }
  const suppliedToken = bearerToken(request.headers.get('authorization'));
  if (!suppliedToken || !(await safeEqual(suppliedToken, configuredToken))) {
    return json({ error: 'Authentication required.' }, 401, {
      'www-authenticate': 'Bearer realm="prospect-desk-acquisition"',
    });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'Request body is too large.' }, 413);
  }

  try {
    const payload = validate(await request.json());
    const neon = await import('@sales-automation/neon-state');
    const databaseUrl = neon.requireDatabaseUrl(process.env.DATABASE_URL);
    const state = await neon.loadNeonAppState(databaseUrl);
    const runtime = await import('./manual-intake-runtime.js');
    const response = await runtime.handleManualIntakeRuntime({
      body: manualBody(payload),
      databaseUrl,
      actor: ACTOR,
      state,
    });
    const result = await responseObject(response);

    if (!response.ok) {
      return json({
        error: 'Prospect Desk rejected the acquisition record.',
        intakeStatus: response.status,
        humanReviewRequired: true,
        externalActionAutomated: false,
      }, response.status >= 500 ? 502 : 400);
    }

    return json({
      ...result,
      ok: true,
      accepted: true,
      idempotencyKey: payload.idempotencyKey,
      acquisitionPriority: payload.priority,
      acquisitionScore: payload.score,
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, response.status);
  } catch (error) {
    return json({
      error: error instanceof ValidationError ? error.message : 'Acquisition ingestion failed.',
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, error instanceof ValidationError ? 400 : 500);
  }
}

class ValidationError extends Error {}

function validate(value: unknown): IntakePayload {
  const root = objectValue(value, 'request body');
  if (root.schema_version !== 'prospect-desk-opportunity.v1') {
    throw new ValidationError('schema_version is invalid.');
  }
  if (root.source !== 'upwork_scheduled_chrome') {
    throw new ValidationError('source is invalid.');
  }
  if (root.external_action_performed !== false) {
    throw new ValidationError('external_action_performed must be false.');
  }

  const record = objectValue(root.source_record, 'source_record');
  const evidence = objectValue(record.evidence, 'source_record.evidence');
  if (evidence.source !== 'upwork') {
    throw new ValidationError('source_record.evidence.source must be upwork.');
  }
  const sourceUrl = textValue(evidence.source_url, 'source_record.evidence.source_url', 2_000);
  validateUpworkUrl(sourceUrl);

  const qualification = objectValue(root.qualification, 'qualification');
  if (qualification.priority !== 'A' && qualification.priority !== 'B') {
    throw new ValidationError('Only Priority A and B opportunities may be ingested.');
  }
  const score = Number(qualification.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new ValidationError('qualification.score must be between 0 and 100.');
  }

  return {
    idempotencyKey: textValue(root.idempotency_key, 'idempotency_key', 256),
    priority: qualification.priority,
    score: Math.round(score),
    title: textValue(evidence.title, 'source_record.evidence.title', 500),
    body: textValue(evidence.body, 'source_record.evidence.body', 20_000),
    sourceId: textValue(evidence.source_id, 'source_record.evidence.source_id', 256),
    sourceUrl,
    businessUnit: optionalText(qualification.business_unit, 128),
    serviceId: optionalText(qualification.service_id, 128),
    disposition: optionalText(qualification.disposition, 128),
    confidence: optionalText(qualification.confidence, 64),
    recommendedAction: optionalText(qualification.recommended_action, 1_000),
    configurationVersion: optionalText(qualification.configuration_version, 128),
    attributes: optionalObject(evidence.attributes),
  };
}

function manualBody(payload: IntakePayload): Record<string, unknown> {
  const attributes = payload.attributes;
  const skills = Array.isArray(attributes.skills)
    ? attributes.skills.map((value) => String(value).trim()).filter(Boolean).slice(0, 30)
    : [];
  const content = [
    payload.title,
    payload.body,
    `Upwork job ID: ${payload.sourceId}`,
    `Acquisition idempotency key: ${payload.idempotencyKey}`,
    `Acquisition priority: ${payload.priority}`,
    `Acquisition score: ${payload.score}`,
    line('Business unit', payload.businessUnit),
    line('Service route', payload.serviceId),
    line('Disposition', payload.disposition),
    line('Confidence', payload.confidence),
    line('Recommended human action', payload.recommendedAction),
    line('Qualification version', payload.configurationVersion),
    line('Budget USD', attributes.budget_usd),
    line('Hourly minimum USD', attributes.hourly_min_usd),
    line('Hourly maximum USD', attributes.hourly_max_usd),
    line('Client spend USD', attributes.client_spend_usd),
    line('Client hire rate', attributes.client_hire_rate),
    line('Payment status', attributes.payment_status),
    line('Proposal activity', attributes.proposal_activity),
    line('Client country', attributes.client_country),
    skills.length ? `Skills: ${skills.join(', ')}` : '',
    'External action performed: false',
  ].filter(Boolean).join('\n\n');

  return {
    sourceKind: 'public_url',
    content,
    sourceUrl: payload.sourceUrl,
    title: payload.title,
    companyName: 'Upwork Client',
    country: typeof attributes.client_country === 'string' ? attributes.client_country : undefined,
  };
}

function validateUpworkUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('source_record.evidence.source_url is invalid.');
  }
  if (url.protocol !== 'https:' || !['upwork.com', 'www.upwork.com'].includes(url.hostname)) {
    throw new ValidationError('source_record.evidence.source_url must be an HTTPS Upwork URL.');
  }
  if (!url.pathname.includes('/jobs/') && !url.pathname.includes('/freelance-jobs/apply/')) {
    throw new ValidationError('source_record.evidence.source_url must identify an Upwork job.');
  }
}

function bearerToken(value: string | null): string | undefined {
  return value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || undefined;
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const { timingSafeEqual } = await import('node:crypto');
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }
  const result = value.trim();
  if (result.length > maximum) throw new ValidationError(`${field} is too long.`);
  return result;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : undefined;
}

function line(label: string, value: unknown): string {
  return value === undefined || value === null || value === ''
    ? ''
    : `${label}: ${String(value).slice(0, 1_000)}`;
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function json(value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}
