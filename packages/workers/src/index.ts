import type { IngestionResult } from '@sales-automation/ingestion';

export interface IngestionWorkerSource {
  id: string;
  label?: string;
  cadenceMinutes: number;
  enabled?: boolean;
  run: () => IngestionResult;
}

export interface IngestionWorkerState {
  lastRunAtBySourceId: Record<string, string>;
}

export interface IngestionWorkerRunItem {
  sourceId: string;
  label?: string;
  startedAt: string;
  finishedAt: string;
  result: IngestionResult;
}

export interface IngestionWorkerSkipItem {
  sourceId: string;
  label?: string;
  reason: 'disabled' | 'not_due';
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface IngestionWorkerRunResult {
  ran: IngestionWorkerRunItem[];
  skipped: IngestionWorkerSkipItem[];
  state: IngestionWorkerState;
}

export function createEmptyWorkerState(): IngestionWorkerState {
  return { lastRunAtBySourceId: {} };
}

export function runDueIngestionSources(input: {
  sources: IngestionWorkerSource[];
  state?: IngestionWorkerState;
  now?: string;
}): IngestionWorkerRunResult {
  const now = input.now ?? new Date().toISOString();
  const state = cloneState(input.state ?? createEmptyWorkerState());
  const ran: IngestionWorkerRunItem[] = [];
  const skipped: IngestionWorkerSkipItem[] = [];

  for (const source of input.sources) {
    if (source.enabled === false) {
      skipped.push({
        sourceId: source.id,
        label: source.label,
        reason: 'disabled',
      });
      continue;
    }

    const lastRunAt = state.lastRunAtBySourceId[source.id];
    if (!isSourceDue({ lastRunAt, cadenceMinutes: source.cadenceMinutes, now })) {
      skipped.push({
        sourceId: source.id,
        label: source.label,
        reason: 'not_due',
        lastRunAt,
        nextRunAt: lastRunAt ? addMinutes(lastRunAt, source.cadenceMinutes) : now,
      });
      continue;
    }

    const startedAt = now;
    const result = source.run();
    const finishedAt = new Date().toISOString();
    state.lastRunAtBySourceId[source.id] = now;
    ran.push({
      sourceId: source.id,
      label: source.label,
      startedAt,
      finishedAt,
      result,
    });
  }

  return { ran, skipped, state };
}

export function isSourceDue(input: { lastRunAt?: string; cadenceMinutes: number; now?: string }): boolean {
  if (input.cadenceMinutes <= 0) return true;
  if (!input.lastRunAt) return true;

  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const lastRunMs = Date.parse(input.lastRunAt);
  if (Number.isNaN(nowMs) || Number.isNaN(lastRunMs)) return true;

  return nowMs - lastRunMs >= input.cadenceMinutes * 60_000;
}

function addMinutes(value: string, minutes: number): string | undefined {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return new Date(timestamp + minutes * 60_000).toISOString();
}

function cloneState(state: IngestionWorkerState): IngestionWorkerState {
  return {
    lastRunAtBySourceId: { ...state.lastRunAtBySourceId },
  };
}
