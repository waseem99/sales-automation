import {
  buildSellerQueueView,
  createSellerQueuePreferences,
  decodeSellerQueuePreferenceCookie,
  encodeSellerQueuePreferenceCookie,
  readCookieValue,
  SELLER_QUEUE_PREFERENCE_COOKIE,
} from '@sales-automation/seller-queues';
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
import {
  renderPaginatedProspectDashboardPage,
  type ProspectDashboardPagination,
} from './paginated-prospects-page.js';

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
  const access = context.access ?? trustedLocalAccess(context.actor);

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
      const generatedAt = context.now?.() ?? new Date().toISOString();
      const visibleRecords = accessibleRecords(context.repository.listLeads(), access);
      const savedCookie = readCookieValue(requestHeader(request.headers, 'cookie'), SELLER_QUEUE_PREFERENCE_COOKIE);
      const saved = decodeSellerQueuePreferenceCookie(savedCookie, context.sessionSecret, access.identifier);
      const preferences = createSellerQueuePreferences({
        userId: access.identifier,
        activeQueue: url.searchParams.get('queue') ?? saved?.activeQueue ?? 'follow_up_pending',
        sort: url.searchParams.get('sort') ?? saved?.sort ?? 'priority_desc',
        filters: {
          serviceCategory: url.searchParams.has('service') ? url.searchParams.get('service') : saved?.filters.serviceCategory,
          pipelineStatus: url.searchParams.has('status') ? url.searchParams.get('status') : saved?.filters.pipelineStatus,
          owner: url.searchParams.has('owner') ? url.searchParams.get('owner') : saved?.filters.owner,
          query: url.searchParams.has('q') ? url.searchParams.get('q') : saved?.filters.query,
        },
        savedAt: generatedAt,
      });
      const sellerQueue = buildSellerQueueView(visibleRecords, {
        activeQueue: preferences.activeQueue,
        sort: preferences.sort,
        filters: preferences.filters,
        generatedAt,
      });
      const pageSize = context.pagination.pageSize;
      const totalPages = Math.max(1, Math.ceil(sellerQueue.records.length / pageSize));
      const page = Math.min(Math.max(1, context.pagination.page), totalPages);
      const startIndex = (page - 1) * pageSize;
      const pageRecords = sellerQueue.records.slice(startIndex, startIndex + pageSize);
      const pagination: ProspectDashboardPagination = {
        ...context.pagination,
        records: pageRecords,
        page,
        totalPages,
        filteredTotal: sellerQueue.records.length,
        visibleTotal: visibleRecords.length,
        start: pageRecords.length > 0 ? startIndex + 1 : 0,
        end: startIndex + pageRecords.length,
      };
      const selectedId = url.searchParams.get('leadId') ?? undefined;
      const selected = selectedId
        ? sellerQueue.records.find((record) => record.lead.id === selectedId)
        : pageRecords[0];
      const rendered = html(renderPaginatedProspectDashboardPage({
        records: pageRecords,
        selected,
        runs: context.runStore.listRuns(20),
        generatedAt,
        sellerQueue,
        sellerUserId: access.identifier,
        pagination,
        access: accessScopePayload(access),
      }));
      rendered.headers['set-cookie'] = `${SELLER_QUEUE_PREFERENCE_COOKIE}=${encodeURIComponent(encodeSellerQueuePreferenceCookie(preferences, context.sessionSecret))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${context.secureCookies ? '; Secure' : ''}`;
      return rendered;
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
    return json({ error: message }, message.startsWith('Forbidden:') ? 403 : message.toLowerCase().includes('not found') ? 404 : 400);
  }
}

function accessibleRecords(records: StoredLeadRecord[], access: DashboardAccessScope): StoredLeadRecord[] {
  return records.filter((record) => {
    try {
      assertCanAccessLead(access, record.lead);
      return true;
    } catch {
      return false;
    }
  });
}

function requestHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== expected) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function trustedLocalAccess(actor: string | undefined): DashboardAccessScope {
  const admin = resolveDashboardAccess('admin', 'Administrator');
  return {
    ...admin,
    identifier: actor?.trim() || admin.identifier,
    displayName: actor?.trim() || admin.displayName,
  };
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
