import { auditMissingFirstOutreachGuidance } from './engagement-automation.js';
import {
  handleProspectDashboardRequest as handleBaseProspectDashboardRequest,
  type ProspectDashboardContext,
  type ProspectDashboardRequest,
  type ProspectDashboardResponse,
} from './prospect-handler.js';

export type {
  ProspectDashboardContext,
  ProspectDashboardRequest,
  ProspectDashboardResponse,
} from './prospect-handler.js';

const NON_AUDIT_PATHS = new Set([
  '/health',
  '/login',
  '/api/login',
  '/api/logout',
  '/api/session',
]);

/**
 * Production wrapper around the Prospect Desk handler.
 *
 * It silently backfills engagement intelligence for existing prospects and
 * immediately audits leads added by any successful discovery or ingestion
 * request. The audit is idempotent, so already-processed leads are skipped.
 */
export async function handleProspectDashboardRequest(
  request: ProspectDashboardRequest,
  context: ProspectDashboardContext,
): Promise<ProspectDashboardResponse> {
  const response = await handleBaseProspectDashboardRequest(request, context);
  const method = request.method.toUpperCase();
  const pathname = trimTrailingSlash(new URL(request.url, 'http://localhost').pathname) || '/';

  if (response.status >= 400 || NON_AUDIT_PATHS.has(pathname)) return response;

  const audit = auditMissingFirstOutreachGuidance({
    repository: context.repository,
    portfolioItems: context.portfolioItems,
    actor: 'engagement-intelligence',
    generatedAt: context.now?.() ?? new Date().toISOString(),
  });

  // Re-render read responses after a first-time backfill so the user sees the
  // prepared audit and outreach guidance immediately without a second refresh.
  if (audit.audited > 0 && method === 'GET') {
    return handleBaseProspectDashboardRequest(request, context);
  }

  return response;
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}
