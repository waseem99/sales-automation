import assert from 'node:assert/strict';
import type { IngestionResult } from '@sales-automation/ingestion';
import { createEmptyWorkerState, isSourceDue, runDueIngestionSources } from './index.js';

function fakeResult(sourceKind: IngestionResult['sourceKind']): IngestionResult {
  return {
    sourceKind,
    captured: [],
    skippedDuplicates: [],
    totalInput: 0,
    totalCaptured: 0,
    totalSkipped: 0,
  };
}

assert.equal(isSourceDue({ cadenceMinutes: 30, now: '2026-07-08T20:00:00.000Z' }), true);
assert.equal(
  isSourceDue({
    cadenceMinutes: 30,
    lastRunAt: '2026-07-08T19:31:00.000Z',
    now: '2026-07-08T20:00:00.000Z',
  }),
  false,
);
assert.equal(
  isSourceDue({
    cadenceMinutes: 30,
    lastRunAt: '2026-07-08T19:30:00.000Z',
    now: '2026-07-08T20:00:00.000Z',
  }),
  true,
);

let upworkRuns = 0;
let linkedinRuns = 0;
const firstRun = runDueIngestionSources({
  now: '2026-07-08T20:00:00.000Z',
  state: createEmptyWorkerState(),
  sources: [
    {
      id: 'upwork-email-alerts',
      label: 'Upwork Email Alerts',
      cadenceMinutes: 30,
      run: () => {
        upworkRuns += 1;
        return fakeResult('upwork_email');
      },
    },
    {
      id: 'linkedin-warm-signals',
      label: 'LinkedIn Warm Signals',
      cadenceMinutes: 30,
      run: () => {
        linkedinRuns += 1;
        return fakeResult('linkedin_signal');
      },
    },
    {
      id: 'disabled-source',
      cadenceMinutes: 30,
      enabled: false,
      run: () => fakeResult('manual_leads'),
    },
  ],
});

assert.equal(firstRun.ran.length, 2);
assert.equal(firstRun.skipped.length, 1);
assert.equal(firstRun.skipped[0].reason, 'disabled');
assert.equal(upworkRuns, 1);
assert.equal(linkedinRuns, 1);
assert.equal(firstRun.state.lastRunAtBySourceId['upwork-email-alerts'], '2026-07-08T20:00:00.000Z');

const secondRun = runDueIngestionSources({
  now: '2026-07-08T20:20:00.000Z',
  state: firstRun.state,
  sources: [
    {
      id: 'upwork-email-alerts',
      cadenceMinutes: 30,
      run: () => {
        upworkRuns += 1;
        return fakeResult('upwork_email');
      },
    },
  ],
});
assert.equal(secondRun.ran.length, 0);
assert.equal(secondRun.skipped[0].reason, 'not_due');
assert.equal(secondRun.skipped[0].nextRunAt, '2026-07-08T20:30:00.000Z');
assert.equal(upworkRuns, 1);

const thirdRun = runDueIngestionSources({
  now: '2026-07-08T20:30:00.000Z',
  state: firstRun.state,
  sources: [
    {
      id: 'upwork-email-alerts',
      cadenceMinutes: 30,
      run: () => {
        upworkRuns += 1;
        return fakeResult('upwork_email');
      },
    },
  ],
});
assert.equal(thirdRun.ran.length, 1);
assert.equal(upworkRuns, 2);

console.log('Ingestion worker cadence tests passed.');
