import {createHash} from 'node:crypto';

export const SYNC_HEALTH_VERSION = 'sync-health.v1';
export const EXPECTED_RECONCILIATION_VERSION = 'acquisition-reconciliation.v1';
export const SYNC_SOURCES = ['linkedin', 'upwork', 'sales_navigator'] as const;

export type SyncSource = typeof SYNC_SOURCES[number];
export type SyncLayerStatus = 'healthy' | 'degraded' | 'blocked' | 'unknown';
export type SyncRecordStatus = 'pending' | 'retrying' | 'dead_letter' | 'conflicted';

export interface SyncHealthRecord {
  idempotencyKey: string;
  dedupeKeyHash?: string;
  status: SyncRecordStatus;
  attempts: number;
  nextRetryAt?: string;
  createdAt?: string;
  updatedAt?: string;
  lastError?: string;
}

export interface SyncHealthSnapshot {
  version: typeof SYNC_HEALTH_VERSION;
  source: SyncSource;
  collectedAt: string;
  capture: SyncLayerStatus;
  localProcessing: SyncLayerStatus;
  outbox: SyncLayerStatus;
  prospectDeskIngestion: SyncLayerStatus;
  endpointHost?: string;
  endpointPath?: string;
  endpointVersion?: string;
  expectedEndpointVersion: typeof EXPECTED_RECONCILIATION_VERSION;
  endpointVersionMismatch: boolean;
  pending: number;
  retrying: number;
  deadLetter: number;
  conflicted: number;
  applied: number;
  duplicates: number;
  merged: number;
  failed: number;
  lastAttemptAt?: string;
  lastSuccessfulSyncAt?: string;
  averageLatencyMs?: number;
  records: SyncHealthRecord[];
  diagnostics: string[];
  stateRootPreserved: true;
  humanReviewRequired: true;
  externalActionAutomated: false;
  snapshotHash: string;
}

export interface CreateSyncHealthSnapshotInput {
  source: SyncSource;
  collectedAt?: string;
  capture?: SyncLayerStatus;
  localProcessing?: SyncLayerStatus;
  outbox?: SyncLayerStatus;
  prospectDeskIngestion?: SyncLayerStatus;
  endpointHost?: string;
  endpointPath?: string;
  endpointVersion?: string;
  pending?: number;
  retrying?: number;
  deadLetter?: number;
  conflicted?: number;
  applied?: number;
  duplicates?: number;
  merged?: number;
  failed?: number;
  lastAttemptAt?: string;
  lastSuccessfulSyncAt?: string;
  averageLatencyMs?: number;
  records?: Array<Partial<SyncHealthRecord> & {idempotencyKey: string; status: SyncRecordStatus}>;
  diagnostics?: unknown[];
}

export interface SyncHealthAggregate {
  version: typeof SYNC_HEALTH_VERSION;
  generatedAt: string;
  sources: SyncHealthSnapshot[];
  totals: {
    pending: number;
    retrying: number;
    deadLetter: number;
    conflicted: number;
    applied: number;
    duplicates: number;
    merged: number;
    failed: number;
  };
  endpointVersionMismatches: SyncSource[];
  lastSuccessfulSyncAt?: string;
  averageLatencyMs?: number;
  healthy: boolean;
  reconciled: boolean;
  stateRootPreserved: true;
  humanReviewRequired: true;
  externalActionAutomated: false;
}

export interface SafeReplayPlan {
  version: 'sync-replay-plan.v1';
  source: SyncSource;
  actor: string;
  requestedAt: string;
  records: Array<{
    idempotencyKey: string;
    priorStatus: 'pending' | 'retrying' | 'dead_letter';
    action: 'reset_to_pending';
    preserveIdempotencyKey: true;
    preserveSourceEvidence: true;
  }>;
  skipped: Array<{idempotencyKey: string; reason: string}>;
  permissionConfirmed: true;
  idempotent: true;
  humanReviewRequired: true;
  externalActionAutomated: false;
  planHash: string;
}

const LAYER_STATUSES = new Set<SyncLayerStatus>(['healthy', 'degraded', 'blocked', 'unknown']);
const RECORD_STATUSES = new Set<SyncRecordStatus>(['pending', 'retrying', 'dead_letter', 'conflicted']);
const SECRET_KEYS = /token|cookie|authorization|password|secret|credential|csrf|session|private.?message|message.?body/i;
const URL_CREDENTIALS = /([?&](?:token|key|secret|auth|signature)=)[^&\s]+/gi;

export function createSyncHealthSnapshot(input: CreateSyncHealthSnapshotInput): SyncHealthSnapshot {
  if (!SYNC_SOURCES.includes(input.source)) throw new Error('Unsupported sync source.');
  const collectedAt = validIso(input.collectedAt ?? new Date().toISOString(), 'collectedAt');
  const endpointVersion = optionalText(input.endpointVersion, 120);
  const records = (input.records ?? []).slice(0, 500).map(normalizeRecord);
  const diagnostics = (input.diagnostics ?? []).slice(0, 100).map((item) => redactDiagnostic(item)).filter(Boolean);
  const base = {
    version: SYNC_HEALTH_VERSION,
    source: input.source,
    collectedAt,
    capture: layerStatus(input.capture),
    localProcessing: layerStatus(input.localProcessing),
    outbox: layerStatus(input.outbox),
    prospectDeskIngestion: layerStatus(input.prospectDeskIngestion),
    endpointHost: optionalHost(input.endpointHost),
    endpointPath: optionalPath(input.endpointPath),
    endpointVersion,
    expectedEndpointVersion: EXPECTED_RECONCILIATION_VERSION,
    endpointVersionMismatch: Boolean(endpointVersion && endpointVersion !== EXPECTED_RECONCILIATION_VERSION),
    pending: count(input.pending),
    retrying: count(input.retrying),
    deadLetter: count(input.deadLetter),
    conflicted: count(input.conflicted),
    applied: count(input.applied),
    duplicates: count(input.duplicates),
    merged: count(input.merged),
    failed: count(input.failed),
    lastAttemptAt: optionalIso(input.lastAttemptAt),
    lastSuccessfulSyncAt: optionalIso(input.lastSuccessfulSyncAt),
    averageLatencyMs: optionalNonNegative(input.averageLatencyMs),
    records,
    diagnostics,
    stateRootPreserved: true,
    humanReviewRequired: true,
    externalActionAutomated: false,
  } satisfies Omit<SyncHealthSnapshot, 'snapshotHash'>;
  return {...base, snapshotHash: sha256(stableStringify(base))};
}

export function aggregateSyncHealth(snapshots: SyncHealthSnapshot[], generatedAt = new Date().toISOString()): SyncHealthAggregate {
  const latestBySource = new Map<SyncSource, SyncHealthSnapshot>();
  for (const snapshot of snapshots) {
    if (!verifySyncHealthSnapshot(snapshot)) continue;
    const existing = latestBySource.get(snapshot.source);
    if (!existing || Date.parse(snapshot.collectedAt) > Date.parse(existing.collectedAt)) latestBySource.set(snapshot.source, snapshot);
  }
  const sources = SYNC_SOURCES.map((source) => latestBySource.get(source)).filter((item): item is SyncHealthSnapshot => Boolean(item));
  const totals = {
    pending: sum(sources, 'pending'),
    retrying: sum(sources, 'retrying'),
    deadLetter: sum(sources, 'deadLetter'),
    conflicted: sum(sources, 'conflicted'),
    applied: sum(sources, 'applied'),
    duplicates: sum(sources, 'duplicates'),
    merged: sum(sources, 'merged'),
    failed: sum(sources, 'failed'),
  };
  const latencies = sources.map((item) => item.averageLatencyMs).filter((value): value is number => value !== undefined);
  const successes = sources.map((item) => item.lastSuccessfulSyncAt).filter((value): value is string => Boolean(value)).sort();
  const endpointVersionMismatches = sources.filter((item) => item.endpointVersionMismatch).map((item) => item.source);
  const healthy = sources.length === SYNC_SOURCES.length
    && endpointVersionMismatches.length === 0
    && totals.deadLetter === 0
    && totals.conflicted === 0
    && sources.every((item) => ![item.capture, item.localProcessing, item.outbox, item.prospectDeskIngestion].includes('blocked'));
  return {
    version: SYNC_HEALTH_VERSION,
    generatedAt: validIso(generatedAt, 'generatedAt'),
    sources,
    totals,
    endpointVersionMismatches,
    lastSuccessfulSyncAt: successes.at(-1),
    averageLatencyMs: latencies.length ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length) : undefined,
    healthy,
    reconciled: sources.every(verifySyncHealthSnapshot),
    stateRootPreserved: true,
    humanReviewRequired: true,
    externalActionAutomated: false,
  };
}

export function createSafeReplayPlan(input: {
  snapshot: SyncHealthSnapshot;
  idempotencyKeys: string[];
  actor: string;
  permissionConfirmed: boolean;
  requestedAt?: string;
}): SafeReplayPlan {
  if (!input.permissionConfirmed) throw new Error('Permission confirmation is required for replay planning.');
  if (!verifySyncHealthSnapshot(input.snapshot)) throw new Error('A valid sync health snapshot is required.');
  const actor = requiredText(input.actor, 'actor');
  const requestedAt = validIso(input.requestedAt ?? new Date().toISOString(), 'requestedAt');
  const requested = [...new Set(input.idempotencyKeys.map((key) => key.trim()).filter(Boolean))].slice(0, 25);
  if (requested.length === 0) throw new Error('At least one idempotency key is required.');
  const index = new Map(input.snapshot.records.map((record) => [record.idempotencyKey, record]));
  const records: SafeReplayPlan['records'] = [];
  const skipped: SafeReplayPlan['skipped'] = [];
  for (const idempotencyKey of requested) {
    const record = index.get(idempotencyKey);
    if (!record) {
      skipped.push({idempotencyKey, reason: 'Record is not present in the current redacted snapshot.'});
      continue;
    }
    if (record.status === 'conflicted') {
      skipped.push({idempotencyKey, reason: 'Conflicted records require seller-field resolution before replay.'});
      continue;
    }
    records.push({
      idempotencyKey,
      priorStatus: record.status,
      action: 'reset_to_pending',
      preserveIdempotencyKey: true,
      preserveSourceEvidence: true,
    });
  }
  const base = {
    version: 'sync-replay-plan.v1' as const,
    source: input.snapshot.source,
    actor,
    requestedAt,
    records,
    skipped,
    permissionConfirmed: true as const,
    idempotent: true as const,
    humanReviewRequired: true as const,
    externalActionAutomated: false as const,
  };
  return {...base, planHash: sha256(stableStringify(base))};
}

export function verifySyncHealthSnapshot(snapshot: SyncHealthSnapshot): boolean {
  const {snapshotHash, ...base} = snapshot;
  return snapshot.version === SYNC_HEALTH_VERSION
    && SYNC_SOURCES.includes(snapshot.source)
    && snapshot.externalActionAutomated === false
    && snapshot.stateRootPreserved === true
    && sha256(stableStringify(base)) === snapshotHash;
}

export function redactDiagnostic(value: unknown): string {
  return redactValue(value, 0).slice(0, 500);
}

function normalizeRecord(input: Partial<SyncHealthRecord> & {idempotencyKey: string; status: SyncRecordStatus}): SyncHealthRecord {
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey').slice(0, 180);
  if (!RECORD_STATUSES.has(input.status)) throw new Error('Unsupported sync record status.');
  return {
    idempotencyKey,
    dedupeKeyHash: input.dedupeKeyHash ? sha256(String(input.dedupeKeyHash)).slice(0, 24) : undefined,
    status: input.status,
    attempts: count(input.attempts),
    nextRetryAt: optionalIso(input.nextRetryAt),
    createdAt: optionalIso(input.createdAt),
    updatedAt: optionalIso(input.updatedAt),
    lastError: optionalText(redactDiagnostic(input.lastError), 500),
  };
}

function redactValue(value: unknown, depth: number): string {
  if (depth > 3) return '[depth-limited]';
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(URL_CREDENTIALS, '$1[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactValue(item, depth + 1)).join('; ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, item]) => {
      if (SECRET_KEYS.test(key)) return `${key}=[redacted]`;
      return `${key}=${redactValue(item, depth + 1)}`;
    }).join('; ');
  }
  return String(value);
}

function layerStatus(value: SyncLayerStatus | undefined): SyncLayerStatus {
  return value && LAYER_STATUSES.has(value) ? value : 'unknown';
}

function optionalHost(value: unknown): string | undefined {
  const text = optionalText(value, 200);
  if (!text) return undefined;
  return text.replace(/[^a-z0-9.:-]/gi, '');
}

function optionalPath(value: unknown): string | undefined {
  const text = optionalText(value, 300);
  if (!text) return undefined;
  return text.split('?')[0]?.split('#')[0]?.replace(/[^a-z0-9_./-]/gi, '');
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().slice(0, maxLength);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function optionalNonNegative(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Latency must be a non-negative number.');
  return Math.round(value);
}

function optionalIso(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error('Invalid ISO timestamp.');
  return new Date(value).toISOString();
}

function validIso(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be a valid ISO timestamp.`);
  return new Date(value).toISOString();
}

function sum(snapshots: SyncHealthSnapshot[], key: keyof Pick<SyncHealthSnapshot, 'pending' | 'retrying' | 'deadLetter' | 'conflicted' | 'applied' | 'duplicates' | 'merged' | 'failed'>): number {
  return snapshots.reduce((total, snapshot) => total + snapshot[key], 0);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
