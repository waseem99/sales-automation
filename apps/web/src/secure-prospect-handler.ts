import type { ProspectDiscoveryResult } from '@sales-automation/prospect-discovery';
import type { StoredLeadRecord } from '@sales-automation/storage';
import {
  handleProspectDashboardRequest as handleBaseProspectDashboardRequest,
  type ProspectDashboardContext as BaseProspectDashboardContext,
  type ProspectDashboardRequest,
  type ProspectDashboardResponse,
} from './prospect-handler.js';
import {
  accessScopePayload,
  assertCanAccessLead,
  assertGlobalOperation,
  resolveDashboardAccess,
  type DashboardAccessScope,
} from './dashboard-access.js';
import { renderProspectDashboardPage, type ProspectDashboardPagination } from './prospects-page.js';

export interface ProspectDashboardContext extends BaseProspectDashboardContext {
  access?: DashboardAccessScope;
  pagination?: ProspectDashboardPagination;
  syncPseb?: () => Promise<{ imported: number; existing: number; checked: number; skippedLinks: number }>;
}

export type { ProspectDashboardRequest, ProspectDashboardResponse } from './prospect-handler.js';

const GLOBAL_PATHS = new Set([
  '/api/prospects/run',
  '/api/prospects/import-starter',
  '/api/prospects/guidance/backfill',
  '/api/prospects/pseb-sync',
  '/api/dev/reset-local-data',
]);

export async function handleProspectDashboardRequest(
  request: ProspectDashboardRequest,
  context: ProspectDashboardContext,
): Promise<ProspectDashboardResponse> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url, 'http://localhost');
  const pathname = trimTrailingSlash(url.pathname) || '/';
  const access = context.access ?? resolveDashboardAccess(context.actor ?? 'admin', 'Administrator');

  try {
    if (method !== 'GET' && (GLOBAL_PATHS.has(pathname) || pathname.startsWith('/api/ingest/'))) {
      assertGlobalOperation(access);
    }

    if (method === 'POST' && pathname === '/api/prospects/pseb-sync') {
      if (!context.syncPseb) return json({ error: 'PSEB synchronization is not configured.' }, 503);
      return json({ ok: true, ...(await context.syncPseb()) }, 201);
    }

    const leadAction = pathname.match(/^\/api\/(?:prospects|opportunities)\/([^/]+)\/(?:service|followup|guidance\/first-outreach|guidance\/reply|status|owner|activity|feedback|notes|follow-up|outcome|alert-sent)$/);
    if (leadAction) {
      const leadId = decodeURIComponent(leadAction[1] ?? '');
      const record = context.repository.getLead(leadId);
      if (!record) return json({ error: 'Prospect not found.' }, 404);
      assertCanAccessLead(access, record.lead);
      if (pathname.endsWith('/owner') && !access.canAssignOwners) {
        return json({ error: 'Forbidden: owner assignment is restricted for this account.' }, 403);
      }
    }

    const response = await handleBaseProspectDashboardRequest(request, {
      ...context,
      actor: access.identifier,
    });

    if (response.status >= 400) return response;

    if (method === 'GET' && (pathname === '/' || pathname === '/prospects') && context.pagination) {
      const selectedId = url.searchParams.get('leadId') ?? undefined;
      const selected = selectedId ? context.repository.getLead(selectedId) : context.pagination.records[0];
      return html(renderProspectDashboardPage({
        records: context.pagination.records,
        selected,
        runs: context.runStore.listRuns(20),
        generatedAt: context.now?.() ?? new Date().toISOString(),
        pagination: context.pagination,
        access: accessScopePayload(access),
      }));
    }

    if (method === 'GET' && pathname === '/api/prospects' && context.pagination) {
      return json({
        access: accessScopePayload(access),
        pagination: {
          page: context.pagination.page,
          pageSize: context.pagination.pageSize,
          totalPages: context.pagination.totalPages,
          filteredTotal: context.pagination.filteredTotal,
          visibleTotal: context.pagination.visibleTotal,
          start: context.pagination.start,
          end: context.pagination.end,
        },
        prospects: context.pagination.records.map(serializeProspect),
      });
    }

    return response;
  } catch (error) {
    const message = (error as Error).message;
    return json({ error: message }, message.startsWith('Forbidden:') ? 403 : message.includes('not found') ? 404 : 400);
  }
}

function serializeProspect(record: StoredLeadRecord) {
  return { ...record.lead, notes: record.notes, auditLog: record.auditLog, evaluation: record.latestEvaluation };
}

function html(body: string, status = 200): ProspectDashboardResponse {
  return {
    status,
    headers: {
      ...securityHeaders(),
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
    body,
  };
}

function json(value: unknown, status = 200): ProspectDashboardResponse {
  return {
    status,
    headers: {
      ...securityHeaders(),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(value),
  };
}

function securityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}
