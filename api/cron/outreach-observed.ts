import { loadNeonAppState, requireDatabaseUrl } from '@sales-automation/neon-state';
import {
  persistOperationalTelemetryEvents,
  pruneOperationalTelemetry,
  type OperationalTelemetryEventInput,
} from '@sales-automation/neon-state/operational-telemetry';
import outreachCron from './outreach.js';
import {
  extractOutreachOperationalTelemetry,
  safeErrorSummary,
  type OutreachCycleReportLike,
} from '../../vercel/outreach-telemetry.js';

export const maxDuration = 300;

export default {
  async fetch(request: Request): Promise<Response> {
    const wrapperStartedAt = new Date().toISOString();
    const response = await outreachCron.fetch(request);
    const payload = await parseJsonResponse(response.clone());
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) return response;

    try {
      const events: OperationalTelemetryEventInput[] = [];
      if (isOutreachReport(payload.report)) {
        const state = await loadNeonAppState(requireDatabaseUrl(databaseUrl));
        events.push(...extractOutreachOperationalTelemetry(state.repository.listLeads(), payload.report));
      } else if (payload.skipped === true) {
        events.push({
          eventType: 'lock_skipped', status: 'skipped', provider: 'outreach', worker: 'hourly-outreach-cron',
          occurredAt: new Date().toISOString(), details: { reasonCode: 'active_cycle_lock' },
        });
      } else if (response.status >= 400) {
        events.push({
          eventType: 'worker_failure', status: 'failure', provider: 'runtime', worker: 'hourly-outreach-cron',
          occurredAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - Date.parse(wrapperStartedAt)),
          details: {
            phase: stringValue(payload.phase) ?? 'unknown',
            statusCode: response.status,
            errorSummary: safeErrorSummary(stringValue(payload.detail) ?? stringValue(payload.error) ?? 'Outreach worker failed.'),
          },
        });
      }
      await persistOperationalTelemetryEvents(databaseUrl, events);
      await pruneOperationalTelemetry(databaseUrl, 90);
    } catch (error) {
      console.error('OUTREACH_TELEMETRY_PERSISTENCE_ERROR', safeErrorSummary(error instanceof Error ? error.message : String(error)));
    }
    return response;
  },
};

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isOutreachReport(value: unknown): value is OutreachCycleReportLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return typeof report.startedAt === 'string'
    && typeof report.completedAt === 'string'
    && typeof report.sent === 'number'
    && typeof report.failed === 'number'
    && Array.isArray(report.errors);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
