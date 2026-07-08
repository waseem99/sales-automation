import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createSalesAutomationDashboardApi } from '@sales-automation/api';
import type { DashboardSavedViewKey } from '@sales-automation/dashboard';
import {
  ingestLeads,
  ingestLinkedInSignal,
  ingestUpworkEmail,
  type IngestionResult,
} from '@sales-automation/ingestion';
import type {
  Lead,
  LeadSource,
  LeadType,
  PipelineStatus,
  PortfolioItem,
  QualificationStatus,
  ServiceCategory,
  UrgencyStatus,
} from '@sales-automation/shared';
import type { LeadRepository } from '@sales-automation/storage';
import { renderDashboardPage } from './index.js';

export interface SalesAutomationHttpContext {
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  actor?: string;
  now?: () => string;
}

export interface SalesAutomationHttpRequest {
  method: string;
  path: string;
  body?: unknown;
}

export interface SalesAutomationHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

type JsonRecord = Record<string, unknown>;

export function handleSalesAutomationRequest(
  request: SalesAutomationHttpRequest,
  context: SalesAutomationHttpContext,
): SalesAutomationHttpResponse {
  const method = request.method.toUpperCase();
  const url = new URL(request.path, 'http://localhost');
  const pathname = trimTrailingSlash(url.pathname) || '/';
  const api = createSalesAutomationDashboardApi(context.repository);
  const now = context.now?.() ?? new Date().toISOString();
  const actor = context.actor ?? 'web-api';

  try {
    if (method === 'GET' && pathname === '/health') {
      return jsonResponse({ ok: true, service: 'sales-automation-web', now });
    }

    if (method === 'GET' && pathname === '/') {
      const opportunities = api.listOpportunities({ now });
      const selectedLead = opportunities[0] ? api.getLeadDetail(opportunities[0].id, now) : undefined;
      return htmlResponse(
        renderDashboardPage({
          title: 'Codistan Lead Desk',
          summary: api.getDashboardSummary(now),
          opportunities,
          selectedLead,
        }),
      );
    }

    if (method === 'GET' && pathname === '/api/summary') {
      return jsonResponse(api.getDashboardSummary(now));
    }

    if (method === 'GET' && pathname === '/api/opportunities') {
      return jsonResponse(api.listOpportunities(buildListOptions(url, now)));
    }

    if (method === 'GET' && pathname.startsWith('/api/opportunities/')) {
      const leadId = decodeURIComponent(pathname.replace('/api/opportunities/', ''));
      return jsonResponse(api.getLeadDetail(leadId, now));
    }

    if (method === 'POST' && pathname === '/api/ingest/upwork-email') {
      const body = requireObjectBody(request.body);
      const result = ingestUpworkEmail({
        email: {
          emailBody: requireString(body.emailBody, 'emailBody'),
          receivedAt: optionalString(body.receivedAt) ?? now,
        },
        repository: context.repository,
        portfolioItems: context.portfolioItems,
        actor,
        generatedAt: now,
      });
      return jsonResponse(summarizeIngestionResult(result), 201);
    }

    if (method === 'POST' && pathname === '/api/ingest/linkedin-signal') {
      const body = requireObjectBody(request.body);
      const result = ingestLinkedInSignal({
        signal: {
          text: requireString(body.text, 'text'),
          capturedAt: optionalString(body.capturedAt) ?? now,
          sourceUrl: optionalString(body.sourceUrl),
          contactName: optionalString(body.contactName),
          contactRole: optionalString(body.contactRole),
          companyName: optionalString(body.companyName),
          country: optionalString(body.country),
          region: optionalString(body.region),
        },
        repository: context.repository,
        portfolioItems: context.portfolioItems,
        actor,
        generatedAt: now,
      });
      return jsonResponse(summarizeIngestionResult(result), 201);
    }

    if (method === 'POST' && pathname === '/api/ingest/manual-leads') {
      const body = requireObjectBody(request.body);
      const leads = requireLeadArray(body.leads);
      const result = ingestLeads({
        sourceKind: 'manual_leads',
        leads,
        repository: context.repository,
        portfolioItems: context.portfolioItems,
        actor,
        generatedAt: now,
      });
      return jsonResponse(summarizeIngestionResult(result), 201);
    }

    const statusActionMatch = pathname.match(/^\/api\/opportunities\/([^/]+)\/(status|owner|notes|alert-sent)$/);
    if (method === 'POST' && statusActionMatch) {
      const leadId = decodeURIComponent(statusActionMatch[1]);
      const action = statusActionMatch[2];
      const body = requireObjectBody(request.body);

      if (action === 'status') {
        const status = requireString(body.status, 'status') as PipelineStatus;
        return jsonResponse(api.updateLeadStatus({ leadId, status, actor }));
      }

      if (action === 'owner') {
        return jsonResponse(api.assignLeadOwner({ leadId, owner: requireString(body.owner, 'owner'), actor }));
      }

      if (action === 'notes') {
        return jsonResponse(api.addLeadNote({ leadId, note: requireString(body.note, 'note'), actor }));
      }

      if (action === 'alert-sent') {
        return jsonResponse(api.markAlertSent({ leadId, dedupeKey: optionalString(body.dedupeKey), actor }));
      }
    }

    return jsonResponse({ error: 'Not found', path: pathname }, 404);
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, getErrorStatus(error));
  }
}

export function createSalesAutomationHttpServer(context: SalesAutomationHttpContext) {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readJsonBody(request);
    const result = handleSalesAutomationRequest(
      {
        method: request.method ?? 'GET',
        path: request.url ?? '/',
        body,
      },
      context,
    );
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  });
}

function buildListOptions(url: URL, now: string) {
  const savedView = optionalQuery(url, 'savedView') as DashboardSavedViewKey | undefined;
  return {
    savedView,
    now,
    filters: {
      sources: optionalCsv(url, 'source') as LeadSource[] | undefined,
      leadTypes: optionalCsv(url, 'leadType') as LeadType[] | undefined,
      serviceCategories: optionalCsv(url, 'serviceCategory') as ServiceCategory[] | undefined,
      pipelineStatuses: optionalCsv(url, 'status') as PipelineStatus[] | undefined,
      qualificationStatuses: optionalCsv(url, 'qualification') as QualificationStatus[] | undefined,
      urgencyStatuses: optionalCsv(url, 'urgency') as UrgencyStatus[] | undefined,
      query: optionalQuery(url, 'query'),
      scoreMin: optionalNumber(url, 'scoreMin'),
      scoreMax: optionalNumber(url, 'scoreMax'),
      capturedFrom: optionalQuery(url, 'capturedFrom'),
      capturedTo: optionalQuery(url, 'capturedTo'),
      alertEligible: optionalBoolean(url, 'alertEligible'),
      overdueOnly: optionalBoolean(url, 'overdueOnly'),
    },
  };
}

function summarizeIngestionResult(result: IngestionResult) {
  return {
    sourceKind: result.sourceKind,
    totalInput: result.totalInput,
    totalCaptured: result.totalCaptured,
    totalSkipped: result.totalSkipped,
    captured: result.captured.map((item) => ({
      leadId: item.leadId,
      sourceUrl: item.sourceUrl,
      score: item.evaluation.score.total,
      status: item.evaluation.score.status,
      urgency: item.evaluation.score.urgency,
      recommendedProfile: item.evaluation.profileRecommendation.primaryProfile,
      alertEligible: item.alertEligible,
      dedupeKey: item.dedupeKey,
      nextAction: item.evaluation.recommendedNextAction,
    })),
    skippedDuplicates: result.skippedDuplicates,
  };
}

function htmlResponse(body: string, status = 200): SalesAutomationHttpResponse {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
  };
}

function jsonResponse(value: unknown, status = 200): SalesAutomationHttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: `${JSON.stringify(value, null, 2)}\n`,
  };
}

function requireObjectBody(body: unknown): JsonRecord {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('JSON object body is required.');
  }
  return body as JsonRecord;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireLeadArray(value: unknown): Lead[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('leads must be a non-empty array.');
  }
  return value as Lead[];
}

function optionalQuery(url: URL, key: string): string | undefined {
  return url.searchParams.get(key)?.trim() || undefined;
}

function optionalCsv(url: URL, key: string): string[] | undefined {
  const value = optionalQuery(url, key);
  if (!value) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function optionalNumber(url: URL, key: string): number | undefined {
  const value = optionalQuery(url, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalBoolean(url: URL, key: string): boolean | undefined {
  const value = optionalQuery(url, key);
  if (!value) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON request body: ${(error as Error).message}`);
  }
}

function getErrorStatus(error: unknown): number {
  const message = (error as Error).message;
  if (message.includes('not found') || message.includes('Lead not found')) return 404;
  if (message.includes('required') || message.includes('Invalid status transition')) return 400;
  return 500;
}

function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}
