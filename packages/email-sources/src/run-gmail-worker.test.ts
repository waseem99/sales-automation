import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireWorkerLock,
  executeGmailWorkerCycle,
  readWorkerState,
  runWithRetry,
  type GmailWorkerEnvironment,
} from './run-gmail-worker.js';
import type { GmailLeadIngestionSummary } from './run-gmail.js';

function createSummary(overrides: Partial<GmailLeadIngestionSummary> = {}): GmailLeadIngestionSummary {
  return {
    generatedAt: '2026-07-11T06:00:00.000Z',
    mode: 'read_only_gmail_ingestion',
    query: { query: 'upwork', maxResults: 50 },
    leadStoreFile: '.data/leads.json',
    portfolioFile: null,
    portfolioItemsLoaded: 0,
    totalMessages: 4,
    processedMessages: 4,
    skippedMessages: 0,
    capturedLeads: 2,
    duplicateLeads: 2,
    qualifiedLeadCount: 1,
    alertedLeadCount: 1,
    alertFailureCount: 0,
    qualifiedLeads: [],
    safetyNotes: [],
    warnings: [],
    ...overrides,
  };
}

const retryDelays: number[] = [];
let retryCalls = 0;
const retryResult = await runWithRetry({
  operation: async () => {
    retryCalls += 1;
    if (retryCalls < 3) throw new Error(`temporary-${retryCalls}`);
    return 'success';
  },
  maxAttempts: 3,
  retryDelayMs: 10,
  sleep: async (milliseconds) => { retryDelays.push(milliseconds); },
});
assert.equal(retryResult.ok, true);
assert.equal(retryResult.value, 'success');
assert.equal(retryResult.attempts, 3);
assert.deepEqual(retryDelays, [10, 20]);

const directory = mkdtempSync(join(tmpdir(), 'sales-automation-worker-'));
const stateFile = join(directory, 'state.json');
const logFile = join(directory, 'runs.jsonl');
const lockFile = join(directory, 'worker.lock');
const environment: GmailWorkerEnvironment = {
  WORKER_STATE_FILE: stateFile,
  WORKER_RUN_LOG_FILE: logFile,
  WORKER_LOCK_FILE: lockFile,
  GMAIL_WORKER_MAX_ATTEMPTS: '3',
  GMAIL_WORKER_RETRY_DELAY_MS: '0',
};

let successfulRunCalls = 0;
const successTimes = [
  '2026-07-11T06:00:00.000Z',
  '2026-07-11T06:00:01.000Z',
];
const successLog = await executeGmailWorkerCycle(environment, {
  runIngestion: async () => {
    successfulRunCalls += 1;
    if (successfulRunCalls < 3) throw new Error('Gmail temporarily unavailable');
    return createSummary();
  },
  sleep: async () => undefined,
  now: () => successTimes.shift() ?? '2026-07-11T06:00:01.000Z',
});
assert.equal(successLog.success, true);
assert.equal(successLog.attempts, 3);
assert.equal(successLog.metrics?.qualifiedLeadCount, 1);
assert.equal(successLog.metrics?.alertedLeadCount, 1);
assert.equal(successLog.durationMs, 1_000);

const successState = readWorkerState(stateFile);
assert.equal(successState?.lastSuccessAt, '2026-07-11T06:00:01.000Z');
assert.equal(successState?.consecutiveFailures, 0);
assert.equal(successState?.lastRun?.capturedLeads, 2);
let logLines = readFileSync(logFile, 'utf8').trim().split('\n');
assert.equal(logLines.length, 1);
assert.equal((JSON.parse(logLines[0]!) as { success: boolean }).success, true);

const failureTimes = [
  '2026-07-11T06:30:00.000Z',
  '2026-07-11T06:30:02.000Z',
];
const failureLog = await executeGmailWorkerCycle({
  ...environment,
  GMAIL_WORKER_MAX_ATTEMPTS: '2',
}, {
  runIngestion: async () => { throw new Error('OAuth refresh failed'); },
  sleep: async () => undefined,
  now: () => failureTimes.shift() ?? '2026-07-11T06:30:02.000Z',
});
assert.equal(failureLog.success, false);
assert.equal(failureLog.attempts, 2);
assert.match(failureLog.error ?? '', /OAuth refresh failed/);

const failureState = readWorkerState(stateFile);
assert.equal(failureState?.lastSuccessAt, '2026-07-11T06:00:01.000Z');
assert.equal(failureState?.lastFailureAt, '2026-07-11T06:30:02.000Z');
assert.equal(failureState?.consecutiveFailures, 1);
assert.match(failureState?.lastError ?? '', /OAuth refresh failed/);
logLines = readFileSync(logFile, 'utf8').trim().split('\n');
assert.equal(logLines.length, 2);
assert.equal((JSON.parse(logLines[1]!) as { success: boolean }).success, false);

const releaseLock = acquireWorkerLock({
  filePath: lockFile,
  staleMinutes: 60,
  now: () => '2026-07-11T07:00:00.000Z',
  pid: 100,
});
assert.throws(
  () => acquireWorkerLock({
    filePath: lockFile,
    staleMinutes: 60,
    now: () => '2026-07-11T07:01:00.000Z',
    pid: 101,
  }),
  /already running/,
);
releaseLock();

writeFileSync(lockFile, JSON.stringify({ pid: 50, acquiredAt: '2026-07-11T05:00:00.000Z' }), 'utf8');
const releaseStaleLock = acquireWorkerLock({
  filePath: lockFile,
  staleMinutes: 60,
  now: () => '2026-07-11T07:00:00.000Z',
  pid: 102,
});
assert.match(readFileSync(lockFile, 'utf8'), /"pid":102/);
releaseStaleLock();

rmSync(directory, { recursive: true, force: true });
console.log('Gmail worker retry, state, log, and lock tests passed.');
