import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ProspectDiscoveryResult, ProspectDiscoveryRunStore } from '@sales-automation/prospect-discovery';
import type {
  ContactAccuracy,
  PipelineStatus,
  PortfolioItem,
  RepeatRecommendation,
  ServiceCategory,
  SourceQuality,
} from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';
import { renderLoginPage, renderProspectDashboardPage } from './prospects-page.js';
import { handleSalesAutomationRequest } from './server.js';

const SESSION_COOKIE = 'codistan_admin_session';
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const loginAttempts = new Map<string, { count: number; firstAttemptAt: number }>();
let activeDiscoveryRun: Promise<ProspectDiscoveryResult> | undefined;

export interface ProspectDashboardContext {
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  runStore: ProspectDiscoveryRunStore;
  runDiscovery?: () => Promise<ProspectDiscoveryResult>;
  adminPassword: string;
  sessionSecret: string;
  secureCookies?: boolean;
  actor?: string;
  now?: () => string;
}

export interface ProspectDashboardRequest {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  clientKey?: string;
}

export interface ProspectDashboardResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function handleProspectDashboardRequest(
  request: ProspectDashboardRequest,
  context: ProspectDashboardContext,
): Promise<ProspectDashboardResponse> {
  validateContext(context);
  try {
    const url = new URL(request.url, 'http://localhost');
    const method = request.method.toUpperCase();
    const pathname = trimTrailingSlash(url.pathname) || '/';
    const actor = context.actor ?? 'admin@codistan.org';

    if (method === 'GET' && pathname === '/health') {
      return json({ ok: true, service: 'codistan-prospect-desk', now: now(context) });
    }

    if (method === 'GET' && pathname === '/login') return html(renderLoginPage());

    if (method === 'POST' && pathname === '/api/login') {
      const clientKey = request.clientKey ?? header(request.headers, 'x-forwarded-for') ?? 'unknown';
      if (isRateLimited(clientKey)) return json({ error: 'Too many failed attempts. Try again later.' }, 429);
      const password = requireString(asObject(request.body).password, 'password');
      if (!safeEqual(password, context.adminPassword)) {
        registerFailedAttempt(clientKey);
        return json({ error: 'Incorrect password.' }, 401);
      }
      loginAttempts.delete(clientKey);
      const expiresAt = Math.floor(Date.now() / 1_000) + SESSION_LIFETIME_SECONDS;
      return {
        status: 200,
        headers: {
          ...securityHeaders(),
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': buildSessionCookie(createSessionToken(expiresAt, context.sessionSecret), context.secureCookies ?? false),
          'cache-control': 'no-store',
        },
        body: JSON.stringify({ ok: true }),
      };
    }

    if (method === 'POST' && pathname === '/api/logout') {
      return {
        status: 200,
        headers: {
          ...securityHeaders(),
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${context.secureCookies ? '; Secure' : ''}`,
          'cache-control': 'no-store',
        },
        body: JSON.stringify({ ok: true }),
      };
    }

    if (!isAuthenticated(header(request.headers, 'cookie'), context.sessionSecret)) {
      return method === 'GET' && !pathname.startsWith('/api/')
        ? redirect('/login')
        : json({ error: 'Authentication required.' }, 401);
    }

    if (method === 'GET' && (pathname === '/' || pathname === '/prospects')) {
      const records = context.repository.listLeads();
      const selectedId = url.searchParams.get('leadId') ?? undefined;
      return html(renderProspectDashboardPage({
        records,
        selected: selectedId ? context.repository.getLead(selectedId) : records[0],
        runs: context.runStore.listRuns(20),
        generatedAt: now(context),
      }));
    }

    if (method === 'GET' && pathname === '/api/prospects') {
      return json(context.repository.listLeads().map(serializeProspect));
    }

    if (method === 'GET' && pathname === '/api/prospect-runs') {
      return json(context.runStore.listRuns(30));
    }

    if (method === 'POST' && pathname === '/api/prospects/run') {
      if (!context.runDiscovery) return json({ error: 'Prospect discovery is not configured.' }, 503);
      if (!activeDiscoveryRun) activeDiscoveryRun = context.runDiscovery().finally(() => { activeDiscoveryRun = undefined; });
      const result = await activeDiscoveryRun;
      return json({ run: result.run, newLeads: result.newLeads.map((lead) => lead.id) }, 201);
    }

    const actionMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/(status|owner|activity|feedback)$/);
    if (method === 'POST' && actionMatch) {
      const leadId = decodeURIComponent(actionMatch[1] ?? '');
      const action = actionMatch[2];
      const payload = asObject(request.body);
      const existing = context.repository.getLead(leadId);
      if (!existing) return json({ error: 'Prospect not found.' }, 404);

      if (action === 'status') {
        const status = requirePipelineStatus(payload.status);
        if (['won', 'lost', 'rejected'].includes(status) && existing.lead.feedback?.status !== 'complete') {
          return json({ error: 'Complete the required BD feedback before marking this prospect won, lost, or rejected.' }, 400);
        }
        return json(serializeProspect(context.repository.updateStatus(leadId, status, actor)));
      }

      if (action === 'owner') {
        return json(serializeProspect(context.repository.assignOwner(leadId, requireString(payload.owner, 'owner'), actor)));
      }

      if (action === 'feedback') {
        const relevanceRating = requireRating(payload.relevanceRating);
        const contactAccuracy = requireEnum<ContactAccuracy>(payload.contactAccuracy, 'contactAccuracy', ['accurate', 'partially_accurate', 'wrong', 'missing']);
        const sourceQuality = requireEnum<SourceQuality>(payload.sourceQuality, 'sourceQuality', ['high', 'medium', 'low']);
        const repeatRecommendation = requireEnum<RepeatRecommendation>(payload.repeatRecommendation, 'repeatRecommendation', ['increase', 'keep', 'reduce', 'stop']);
        const correctedServiceCategory = optionalEnum<ServiceCategory>(payload.correctedServiceCategory, [
          'ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'fullstack_web_app',
          'nextjs_python_app', 'voice_ai_agent', 'ar_3d_unity_unreal', 'cybersecurity_compliance',
          'website_portal', 'enterprise_systems', 'unknown',
        ]);
        const reason = requireString(payload.reason, 'reason');
        if (reason.length < 10) return json({ error: 'Feedback reason must contain at least 10 characters.' }, 400);
        const recordedAt = now(context);
        const updatedLead = {
          ...existing.lead,
          serviceCategory: correctedServiceCategory ?? existing.lead.serviceCategory,
          feedback: {
            status: 'complete' as const,
            relevanceRating,
            contactAccuracy,
            sourceQuality,
            repeatRecommendation,
            correctedServiceCategory,
            reason,
            recordedBy: actor,
            recordedAt,
          },
          updatedAt: recordedAt,
        };
        context.repository.upsertLead(updatedLead, actor);
        const record = context.repository.addNote(
          leadId,
          `feedback::${relevanceRating}::${sourceQuality}::${repeatRecommendation}::${reason}`,
          actor,
        );
        return json(serializeProspect(record));
      }

      const type = requireActivityType(payload.type);
      const channel = requireString(payload.channel ?? 'internal', 'channel');
      const activityBody = requireString(payload.body, 'body');
      if (activityBody.length < 5) return json({ error: 'Activity details must contain at least 5 characters.' }, 400);
      const occurredAt = now(context);
      const leadUpdate = { ...existing.lead, updatedAt: occurredAt };
      if (type === 'outreach') leadUpdate.lastContactedAt = occurredAt;
      if (type === 'response') leadUpdate.lastResponseAt = occurredAt;
      context.repository.upsertLead(leadUpdate, actor);
      let record = context.repository.addNote(leadId, `activity::${type}::${channel}::${activityBody}`, actor);
      const nextStatus = activityStatus(type);
      if (nextStatus && record.lead.pipelineStatus !== nextStatus) record = context.repository.updateStatus(leadId, nextStatus, actor);
      return json(serializeProspect(record));
    }

    if (pathname === '/lead-desk' || pathname.startsWith('/api/')) {
      const delegated = handleSalesAutomationRequest({
        method,
        path: pathname === '/lead-desk' ? `/${url.search}` : request.url,
        body: request.body,
        headers: request.headers,
      }, {
        repository: context.repository,
        portfolioItems: context.portfolioItems,
        actor,
        role: 'admin',
        now: context.now,
      });
      return delegated;
    }

    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    return json({ error: (error as Error).message }, errorStatus(error));
  }
}

function serializeProspect(record: StoredLeadRecord) {
  return { ...record.lead, notes: record.notes, auditLog: record.auditLog, evaluation: record.latestEvaluation };
}

function activityStatus(type: ActivityType): PipelineStatus | undefined {
  if (type === 'outreach') return 'sent_manually';
  if (type === 'response') return 'replied';
  if (type === 'meeting') return 'meeting_booked';
  if (type === 'proposal') return 'proposal_sent';
  return undefined;
}

type ActivityType = 'comment' | 'outreach' | 'response' | 'meeting' | 'proposal';

function requireActivityType(value: unknown): ActivityType {
  return requireEnum<ActivityType>(value, 'type', ['comment', 'outreach', 'response', 'meeting', 'proposal']);
}

function requirePipelineStatus(value: unknown): PipelineStatus {
  return requireEnum<PipelineStatus>(value, 'status', [
    'new', 'scored', 'needs_research', 'hot_alert_sent', 'needs_human_review', 'approved_to_contact',
    'draft_ready', 'sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost',
    'rejected', 'archived',
  ]);
}

function requireRating(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const rating = Number(value);
  if (![1, 2, 3, 4, 5].includes(rating)) throw new Error('relevanceRating must be between 1 and 5.');
  return rating as 1 | 2 | 3 | 4 | 5;
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const result = requireString(value, field) as T;
  if (!allowed.includes(result)) throw new Error(`${field} is invalid.`);
  return result;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const result = String(value) as T;
  if (!allowed.includes(result)) throw new Error('correctedServiceCategory is invalid.');
  return result;
}

function validateContext(context: ProspectDashboardContext): void {
  if (!context.adminPassword) throw new Error('ADMIN_PASSWORD is required.');
  if (!context.sessionSecret || context.sessionSecret.length < 24) throw new Error('SESSION_SECRET must contain at least 24 characters.');
}

function now(context: ProspectDashboardContext): string {
  return context.now?.() ?? new Date().toISOString();
}

function createSessionToken(expiresAt: number, secret: string): string {
  const payload = `admin:${expiresAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${expiresAt}.${signature}`;
}

function isAuthenticated(cookieHeader: string | undefined, secret: string): boolean {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return false;
  const match = token.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) return false;
  return safeEqual(token, createSessionToken(expiresAt, secret));
}

function buildSessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_SECONDS}${secure ? '; Secure' : ''}`;
}

function parseCookies(value: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of value?.split(';') ?? []) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  }
  return cookies;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isRateLimited(key: string): boolean {
  const state = loginAttempts.get(key);
  if (!state) return false;
  if (Date.now() - state.firstAttemptAt > 15 * 60 * 1_000) {
    loginAttempts.delete(key);
    return false;
  }
  return state.count >= 5;
}

function registerFailedAttempt(key: string): void {
  const existing = loginAttempts.get(key);
  if (!existing || Date.now() - existing.firstAttemptAt > 15 * 60 * 1_000) {
    loginAttempts.set(key, { count: 1, firstAttemptAt: Date.now() });
  } else {
    existing.count += 1;
  }
}

function header(headers: ProspectDashboardRequest['headers'], name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function securityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
}

function html(body: string, status = 200): ProspectDashboardResponse {
  return { status, headers: { ...securityHeaders(), 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body };
}

function json(value: unknown, status = 200): ProspectDashboardResponse {
  return { status, headers: { ...securityHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(value) };
}

function redirect(location: string): ProspectDashboardResponse {
  return { status: 302, headers: { ...securityHeaders(), location, 'cache-control': 'no-store' }, body: '' };
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function errorStatus(error: unknown): number {
  const message = (error as Error).message.toLowerCase();
  if (message.includes('required') || message.includes('invalid') || message.includes('must contain') || message.includes('between')) return 400;
  if (message.includes('not found')) return 404;
  return 500;
}
