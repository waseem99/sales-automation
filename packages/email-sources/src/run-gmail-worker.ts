import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  runGmailLeadIngestion,
  type GmailLeadIngestionSummary,
  type GmailRunnerEnvironment,
} from './run-gmail.js';

export interface GmailWorkerEnvironment extends GmailRunnerEnvironment {
  GMAIL_WORKER_MODE?: string;
  GMAIL_WORKER_INTERVAL_MINUTES?: string;
  GMAIL_WORKER_MAX_ATTEMPTS?: string;
  GMAIL_WORKER_RETRY_DELAY_MS?: string;
  GMAIL_WORKER_LOCK_STALE_MINUTES?: string;
  WORKER_RUN_LOG_FILE?: string;
  WORKER_STATE_FILE?: string;
  WORKER_LOCK_FILE?: string;
}

export type GmailIngestionRunner = (
  environment: GmailRunnerEnvironment,
) => Promise<GmailLeadIngestionSummary>;

export interface GmailWorkerDependencies {
  runIngestion?: GmailIngestionRunner;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => string;
  pid?: number;
}

export interface GmailWorkerState {
  version: 1;
  source: 'gmail';
  lastAttemptAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  consecutiveFailures: number;
  lastError?: string;
  lastRun?: GmailWorkerRunMetrics;
}

export interface GmailWorkerRunMetrics {
  totalMessages: number;
  capturedLeads: number;
  duplicateLeads: number;
  qualifiedLeadCount: number;
  alertedLeadCount: number;
  alertFailureCount: number;
}

export interface GmailWorkerRunLog {
  source: 'gmail';
  startedAt: string;
  finishedAt: string;
  success: boolean;
  attempts: number;
  durationMs: number;
  metrics?: GmailWorkerRunMetrics;
  error?: string;
}

export interface RetryResult<T> {
  ok: boolean;
  attempts: number;
  value?: T;
  error?: Error;
}

export async function runWithRetry<T>(input: {
  operation: () => Promise<T>;
  maxAttempts: number;
  retryDelayMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<RetryResult<T>> {
  const maxAttempts = requirePositiveInteger(input.maxAttempts, 'maxAttempts');
  const retryDelayMs = requireNonNegativeInteger(input.retryDelayMs, 'retryDelayMs');
  const sleep = input.sleep ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { ok: true, attempts: attempt, value: await input.operation() };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs * attempt);
      }
    }
  }

  return {
    ok: false,
    attempts: maxAttempts,
    error: lastError ?? new Error('Gmail worker failed without an error message.'),
  };
}

export async function executeGmailWorkerCycle(
  environment: GmailWorkerEnvironment = process.env,
  dependencies: GmailWorkerDependencies = {},
): Promise<GmailWorkerRunLog> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const runIngestion = dependencies.runIngestion ?? runGmailLeadIngestion;
  const startedAt = now();
  const startedMs = Date.parse(startedAt);
  const stateFile = resolve(environment.WORKER_STATE_FILE?.trim() || '.data/gmail-worker-state.json');
  const runLogFile = resolve(environment.WORKER_RUN_LOG_FILE?.trim() || '.data/gmail-worker-runs.jsonl');
  const previousState = readWorkerState(stateFile);

  const retryResult = await runWithRetry({
    operation: () => runIngestion(environment),
    maxAttempts: parsePositiveInteger(environment.GMAIL_WORKER_MAX_ATTEMPTS, 3),
    retryDelayMs: parseNonNegativeInteger(environment.GMAIL_WORKER_RETRY_DELAY_MS, 5_000),
    sleep,
  });
  const finishedAt = now();
  const finishedMs = Date.parse(finishedAt);
  const durationMs = Number.isNaN(startedMs) || Number.isNaN(finishedMs)
    ? 0
    : Math.max(0, finishedMs - startedMs);

  if (retryResult.ok && retryResult.value) {
    const metrics = summarizeRun(retryResult.value);
    const log: GmailWorkerRunLog = {
      source: 'gmail',
      startedAt,
      finishedAt,
      success: true,
      attempts: retryResult.attempts,
      durationMs,
      metrics,
    };
    writeWorkerState(stateFile, {
      version: 1,
      source: 'gmail',
      lastAttemptAt: finishedAt,
      lastSuccessAt: finishedAt,
      lastFailureAt: previousState?.lastFailureAt,
      consecutiveFailures: 0,
      lastRun: metrics,
    });
    appendWorkerLog(runLogFile, log);
    return log;
  }

  const errorMessage = retryResult.error?.message ?? 'Unknown Gmail worker failure.';
  const log: GmailWorkerRunLog = {
    source: 'gmail',
    startedAt,
    finishedAt,
    success: false,
    attempts: retryResult.attempts,
    durationMs,
    error: errorMessage,
  };
  writeWorkerState(stateFile, {
    version: 1,
    source: 'gmail',
    lastAttemptAt: finishedAt,
    lastSuccessAt: previousState?.lastSuccessAt,
    lastFailureAt: finishedAt,
    consecutiveFailures: (previousState?.consecutiveFailures ?? 0) + 1,
    lastError: errorMessage,
    lastRun: previousState?.lastRun,
  });
  appendWorkerLog(runLogFile, log);
  return log;
}

export async function runGmailWorker(
  environment: GmailWorkerEnvironment = process.env,
  dependencies: GmailWorkerDependencies = {},
): Promise<number> {
  const mode = parseWorkerMode(environment.GMAIL_WORKER_MODE);
  const intervalMinutes = parsePositiveInteger(environment.GMAIL_WORKER_INTERVAL_MINUTES, 30);
  const lockFile = resolve(environment.WORKER_LOCK_FILE?.trim() || '.data/gmail-worker.lock');
  const staleMinutes = parsePositiveInteger(
    environment.GMAIL_WORKER_LOCK_STALE_MINUTES,
    Math.max(60, intervalMinutes * 3),
  );
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const releaseLock = acquireWorkerLock({
    filePath: lockFile,
    staleMinutes,
    now: dependencies.now,
    pid: dependencies.pid,
  });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    do {
      const log = await executeGmailWorkerCycle(environment, dependencies);
      process.stdout.write(`${JSON.stringify(log)}\n`);
      if (mode === 'once') return log.success ? 0 : 1;
      if (stopping) break;
      await sleep(intervalMinutes * 60_000);
    } while (!stopping);
    return 0;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    releaseLock();
  }
}

export function acquireWorkerLock(input: {
  filePath: string;
  staleMinutes: number;
  now?: () => string;
  pid?: number;
}): () => void {
  const filePath = resolve(input.filePath);
  const staleMinutes = requirePositiveInteger(input.staleMinutes, 'staleMinutes');
  const now = input.now ?? (() => new Date().toISOString());
  ensureParentDirectory(filePath);

  const tryCreate = (): void => {
    const descriptor = openSync(filePath, 'wx');
    try {
      writeFileSync(descriptor, JSON.stringify({
        pid: input.pid ?? process.pid,
        acquiredAt: now(),
      }), 'utf8');
    } finally {
      closeSync(descriptor);
    }
  };

  try {
    tryCreate();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw error;
    if (!isLockStale(filePath, staleMinutes, now())) {
      throw new Error(`Gmail worker is already running. Lock file: ${filePath}`);
    }
    rmSync(filePath, { force: true });
    tryCreate();
  }

  return () => rmSync(filePath, { force: true });
}

export function readWorkerState(filePath: string): GmailWorkerState | undefined {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as GmailWorkerState;
    return parsed?.version === 1 && parsed.source === 'gmail' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeWorkerState(filePath: string, state: GmailWorkerState): void {
  const resolved = resolve(filePath);
  ensureParentDirectory(resolved);
  const temporary = `${resolved}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(temporary, resolved);
}

function appendWorkerLog(filePath: string, log: GmailWorkerRunLog): void {
  const resolved = resolve(filePath);
  ensureParentDirectory(resolved);
  appendFileSync(resolved, `${JSON.stringify(log)}\n`, 'utf8');
}

function summarizeRun(summary: GmailLeadIngestionSummary): GmailWorkerRunMetrics {
  return {
    totalMessages: summary.totalMessages,
    capturedLeads: summary.capturedLeads,
    duplicateLeads: summary.duplicateLeads,
    qualifiedLeadCount: summary.qualifiedLeadCount,
    alertedLeadCount: summary.alertedLeadCount,
    alertFailureCount: summary.alertFailureCount,
  };
}

function isLockStale(filePath: string, staleMinutes: number, nowValue: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { acquiredAt?: string };
    const acquiredAt = Date.parse(parsed.acquiredAt ?? '');
    const current = Date.parse(nowValue);
    if (Number.isNaN(acquiredAt) || Number.isNaN(current)) return true;
    return current - acquiredAt >= staleMinutes * 60_000;
  } catch {
    return true;
  }
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function parseWorkerMode(value?: string): 'once' | 'continuous' {
  const normalized = value?.trim().toLowerCase() || 'continuous';
  if (normalized === 'once' || normalized === 'continuous') return normalized;
  throw new Error(`GMAIL_WORKER_MODE must be "once" or "continuous", received: ${value}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  return requirePositiveInteger(Number.parseInt(value, 10), 'worker setting');
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  return requireNonNegativeInteger(Number.parseInt(value, 10), 'worker setting');
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runGmailWorker(process.env);
  } catch (error) {
    process.stderr.write(`Gmail worker failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  await main();
}
