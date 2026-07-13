import { auditMissingFirstOutreachGuidance } from './engagement-automation.js';
import {
  handleProspectDashboardRequest as handleSecureProspectDashboardRequest,
  type ProspectDashboardContext,
  type ProspectDashboardRequest,
  type ProspectDashboardResponse,
} from './secure-prospect-handler.js';

export type {
  ProspectDashboardContext,
  ProspectDashboardRequest,
  ProspectDashboardResponse,
} from './secure-prospect-handler.js';

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
 * It silently backfills engagement intelligence for records already loaded in
 * the caller's authorized scope. The caller is responsible for persisting any
 * resulting record changes.
 */
export async function handleProspectDashboardRequest(
  request: ProspectDashboardRequest,
  context: ProspectDashboardContext,
): Promise<ProspectDashboardResponse> {
  const response = await handleSecureProspectDashboardRequest(request, context);
  const method = request.method.toUpperCase();
  const pathname = trimTrailingSlash(new URL(request.url, 'http://localhost').pathname) || '/';

  if (response.status >= 400 || NON_AUDIT_PATHS.has(pathname)) return response;

  const audit = auditMissingFirstOutreachGuidance({
    repository: context.repository,
    portfolioItems: context.portfolioItems,
    actor: 'engagement-intelligence',
    generatedAt: context.now?.() ?? new Date().toISOString(),
  });

  if (audit.audited > 0 && method === 'GET') {
    return handleSecureProspectDashboardRequest(request, context);
  }

  return response;
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}
