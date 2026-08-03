import {createHash} from 'node:crypto';

export const ACQUISITION_RECONCILIATION_VERSION = 'acquisition-reconciliation.v1';

export type AcquisitionSyncSource = 'linkedin' | 'upwork' | 'sales_navigator';
export type ReconciliationStatus = 'pending' | 'applied' | 'duplicate' | 'merged' | 'conflicted' | 'failed';

export interface ReconciliationEntry {
  index: number;
  source: AcquisitionSyncSource;
  idempotencyKey: string;
  dedupeKey: string;
  canonicalUrl?: string;
  expectedLeadId: string;
  status: ReconciliationStatus;
  outcome?: 'created' | 'updated' | 'unchanged' | 'rejected' | 'batch_duplicate' | 'seller_field_conflict';
  reason: string;
  sellerFieldsPreserved: true;
  sourceEvidenceRetained: true;
  externalActionAutomated: false;
}

export interface PreparedAcquisitionSync {
  source?: AcquisitionSyncSource;
  body: unknown;
  records: Array<{
    index: number;
    source: AcquisitionSyncSource;
    idempotencyKey: string;
    dedupeKey: string;
    canonicalUrl?: string;
    expectedLeadId: string;
  }>;
  preflight: ReconciliationEntry[];
  originalInputCount: number;
}

const SELLER_OWNED_FIELDS = new Set([
  'owner',
  'stage',
  'pipeline_status',
  'pipelineStatus',
  'notes',
  'next_action',
  'nextAction',
  'next_follow_up_at',
  'nextFollowUpAt',
  'due_date',
  'dueDate',
  'commercial_decision',
  'commercialDecision',
  'outcome_status',
  'outcomeStatus',
  'outcome_reason',
  'outcomeReason',
  'follow_up_note',
  'followUpNote',
]);

export function deterministicSyncIdempotencyKey(input: {
  source: AcquisitionSyncSource;
  dedupeKey: string;
  canonicalUrl?: string;
}): string {
  const material = [
    input.source,
    input.dedupeKey.trim().toLowerCase(),
    normalizeUrl(input.canonicalUrl),
  ].join('\n');
  return `sync-${input.source}-${createHash('sha256').update(material).digest('hex')}`;
}

export function prepareAcquisitionSyncPayload(value: unknown): PreparedAcquisitionSync {
  const payload = asRecord(value);
  const source = syncSource(payload.source);
  const rawRecords = Array.isArray(payload.records) ? payload.records : [];
  if (!source || rawRecords.length === 0) {
    return {source, body: value, records: [], preflight: [], originalInputCount: rawRecords.length};
  }

  const accepted: Record<string, unknown>[] = [];
  const records: PreparedAcquisitionSync['records'] = [];
  const preflight: ReconciliationEntry[] = [];
  const seen = new Set<string>();

  rawRecords.forEach((raw, index) => {
    const record = asRecord(raw);
    const dedupeKey = text(record.dedupe_key);
    const canonicalUrl = text(record.canonical_url);
    const idempotencyKey = dedupeKey
      ? deterministicSyncIdempotencyKey({source, dedupeKey, canonicalUrl})
      : `sync-${source}-invalid-${index}`;
    const expectedLeadId = expectedLeadIdFor(source, dedupeKey, canonicalUrl);
    const directSellerFields = Object.keys(record).filter((key) => SELLER_OWNED_FIELDS.has(key));

    if (directSellerFields.length > 0) {
      preflight.push(entry({
        index,
        source,
        idempotencyKey,
        dedupeKey: dedupeKey ?? '',
        canonicalUrl,
        expectedLeadId,
        status: 'conflicted',
        outcome: 'seller_field_conflict',
        reason: `Incoming source record attempted to set seller-owned fields: ${directSellerFields.sort().join(', ')}. The record was not applied.`,
      }));
      return;
    }

    if (!dedupeKey) {
      preflight.push(entry({
        index,
        source,
        idempotencyKey,
        dedupeKey: '',
        canonicalUrl,
        expectedLeadId,
        status: 'failed',
        outcome: 'rejected',
        reason: 'dedupe_key is required before synchronization.',
      }));
      return;
    }

    const supplied = text(record.idempotency_key);
    if (supplied && supplied !== idempotencyKey) {
      preflight.push(entry({
        index,
        source,
        idempotencyKey,
        dedupeKey,
        canonicalUrl,
        expectedLeadId,
        status: 'conflicted',
        outcome: 'seller_field_conflict',
        reason: 'The supplied idempotency_key does not match the deterministic source-aware key.',
      }));
      return;
    }

    if (seen.has(idempotencyKey)) {
      preflight.push(entry({
        index,
        source,
        idempotencyKey,
        dedupeKey,
        canonicalUrl,
        expectedLeadId,
        status: 'duplicate',
        outcome: 'batch_duplicate',
        reason: 'An identical source-aware idempotency key already exists in this batch.',
      }));
      return;
    }
    seen.add(idempotencyKey);

    accepted.push({...record, idempotency_key: idempotencyKey});
    records.push({index, source, idempotencyKey, dedupeKey, canonicalUrl, expectedLeadId});
  });

  return {
    source,
    body: {...payload, records: accepted},
    records,
    preflight,
    originalInputCount: rawRecords.length,
  };
}

export async function attachAcquisitionReconciliation(
  response: Response,
  prepared: PreparedAcquisitionSync,
): Promise<Response> {
  if (!prepared.source || (prepared.records.length === 0 && prepared.preflight.length === 0)) return response;
  const parsed = await responseBody(response);
  if (!parsed) return response;

  const created = stringSet(parsed.body.createdLeadIds);
  const updated = stringSet(parsed.body.updatedLeadIds);
  const unchanged = stringSet(parsed.body.unchangedLeadIds);
  const processed = stringSet(parsed.body.processedLeadIds);
  const rejected = rejectedByUrl(parsed.body.rejectedRecords);
  const entries = [...prepared.preflight];

  for (const record of prepared.records) {
    if (created.has(record.expectedLeadId)) {
      entries.push(entry({...record, status: 'applied', outcome: 'created', reason: 'A new Prospect Desk record was created.'}));
      continue;
    }
    if (updated.has(record.expectedLeadId)) {
      entries.push(entry({...record, status: 'merged', outcome: 'updated', reason: 'New source evidence was merged while seller-owned fields remained authoritative.'}));
      continue;
    }
    if (unchanged.has(record.expectedLeadId)) {
      entries.push(entry({...record, status: 'duplicate', outcome: 'unchanged', reason: 'The replay matched the existing active record and created no duplicate.'}));
      continue;
    }
    const rejection = record.canonicalUrl ? rejected.get(normalizeUrl(record.canonicalUrl)) : undefined;
    if (rejection) {
      entries.push(entry({...record, status: 'failed', outcome: 'rejected', reason: rejection}));
      continue;
    }
    if (processed.has(record.expectedLeadId)) {
      entries.push(entry({...record, status: 'applied', reason: 'The record was applied and retained by Prospect Desk.'}));
      continue;
    }
    entries.push(entry({
      ...record,
      status: response.ok ? 'pending' : 'failed',
      reason: response.ok
        ? 'The endpoint accepted the batch but did not return a terminal per-record outcome; safe replay remains permitted.'
        : `The endpoint returned HTTP ${response.status}; the durable outbox must retry this record.`,
    }));
  }

  const counts = countStatuses(entries);
  return jsonResponse({
    ...parsed.body,
    originalInput: prepared.originalInputCount,
    reconciliation: {
      version: ACQUISITION_RECONCILIATION_VERSION,
      source: prepared.source,
      counts,
      records: entries.sort((left, right) => left.index - right.index),
      sellerOwnedFields: [...SELLER_OWNED_FIELDS].sort(),
      sellerFieldsPreserved: true,
      sourceEvidenceRetained: true,
      safeReplay: true,
      externalActionAutomated: false,
    },
  }, response.status, parsed.headers);
}

function expectedLeadIdFor(source: AcquisitionSyncSource, dedupeKey: string | undefined, canonicalUrl: string | undefined): string {
  const suffix = (dedupeKey ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 48)
    || createHash('sha256').update(normalizeUrl(canonicalUrl)).digest('hex').slice(0, 12);
  return source === 'sales_navigator' ? `acq-salesnav-${suffix}` : `acq-${source}-${suffix}`;
}

function entry(input: Omit<ReconciliationEntry, 'sellerFieldsPreserved' | 'sourceEvidenceRetained' | 'externalActionAutomated'>): ReconciliationEntry {
  return {
    ...input,
    sellerFieldsPreserved: true,
    sourceEvidenceRetained: true,
    externalActionAutomated: false,
  };
}

function countStatuses(entries: ReconciliationEntry[]): Record<ReconciliationStatus, number> {
  const counts: Record<ReconciliationStatus, number> = {
    pending: 0,
    applied: 0,
    duplicate: 0,
    merged: 0,
    conflicted: 0,
    failed: 0,
  };
  for (const item of entries) counts[item.status] += 1;
  return counts;
}

function stringSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []);
}

function rejectedByUrl(value: unknown): Map<string, string> {
  const output = new Map<string, string>();
  if (!Array.isArray(value)) return output;
  for (const item of value) {
    const record = asRecord(item);
    const url = text(record.sourceUrl);
    if (url) output.set(normalizeUrl(url), text(record.reason) ?? 'The record was rejected by Prospect Desk.');
  }
  return output;
}

async function responseBody(response: Response): Promise<{body: Record<string, unknown>; headers: Record<string, string>} | undefined> {
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

function jsonResponse(value: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
  });
}

function syncSource(value: unknown): AcquisitionSyncSource | undefined {
  return value === 'linkedin' || value === 'upwork' || value === 'sales_navigator' ? value : undefined;
}

function normalizeUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || ['trk', 'rcm'].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.replace(/\/$/, '').toLowerCase();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
