import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ProspectDiscoveryResult, ProspectDiscoveryRunStore } from '@sales-automation/prospect-discovery';
import type { PortfolioItem, PipelineStatus } from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';
import { renderLoginPage, renderProspectDashboardPage } from './prospects-page.js';
import { handleSalesAutomationRequest } from './server.js';

const SESSION_COOKIE = 'codistan_admin_session';
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;

export interface ProspectDashboardServerContext {
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  runStore: ProspectDiscoveryRunStore;
  runDiscovery?: () => Promise<ProspectDiscoveryResult>;
  adminPassword: string;
  sessionSecret: string;
  secureCookies?: boolean;
  now?: () => string;
}

interface DashboardResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface LoginAttemptState {
  count: number;
  firstAttemptAt: number;
}

export function createProspectDashboardHttpServer(context: ProspectDashboardServerContext) {
  if (!context.adminPassword) throw new Error('ADMIN_PASSWORD is required.');
  if (!context.sessionSecret || context.sessionSecret.length < 24) throw new Error('SESSION_SECRET must contain at least 24 characters.');

  const loginAttempts = new Map<string, LoginAttemptState>();
  let activeDiscoveryRun: Promise<ProspectDiscoveryResult> | undefined;

  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const method = (request.method ?? 'GET').toUpperCase();
      const pathname = trimTrailingSlash(url.pathname) || '/';
      const body = await readRequestBody(request);

      if (method === 'GET' && pathname === '/health') {
        return send(response, json({ ok: true, service: 'codistan-prospect-desk', now: context.now?.() ?? new Date().toISOString() }));
      }

      if (method === 'GET' && pathname === '/login') {
        return send(response, html(renderLoginPage()));
      }

      if (method === 'POST' && pathname === '/api/login') {
        const clientKey = request.socket.remoteAddress ?? 'unknown';
        if (isRateLimited(loginAttempts, clientKey)) {
          return send(response, json({ error: 'Too many failed attempts. Try again later.' }, 429));
        }
        const password = requireString(asObject(body).password, 'password');
        if (!safeEqual(password, context.adminPassword)) {
          registerFailedAttempt(loginAttempts, clientKey);
          return send(response, json({ error: 'Incorrect password.' }, 401));
        }
        loginAttempts.delete(clientKey);
        const expiresAt = Math.floor(Date.now() / 1_000) + SESSION_LIFETIME_SECONDS;
        const token = createSessionToken(expiresAt, context.sessionSecret);
        return send(response, {
          status: 200,
          headers: {
            ...securityHeaders(),
            'content-type': 'application/json; charset=utf-8',
            'set-cookie': buildSessionCookie(token, context.secureCookies ?? false),
            'cache-control': 'no-store',
          },
          body: JSON.stringify({ ok: true }),
        });
      }

      if (method === 'POST' && pathname === '/api/logout') {
        return send(response, {
          status: 200,
          headers: {
            ...securityHeaders(),
            'content-type': 'application/json; charset=utf-8',
            'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${context.secureCookies ? '; Secure' : ''}`,
            'cache-control': 'no-store',
          },
          body: JSON.stringify({ ok: true }),
        });
      }

      if (!isAuthenticated(request.headers.cookie, context.sessionSecret)) {
        if (method === 'GET' && !pathname.startsWith('/api/')) {
          return send(response, redirect('/login'));
        }
        return send(response, json({ error: 'Authentication required.' }, 401));
      }

      if (method === 'GET' && (pathname === '/' || pathname === '/prospects')) {
        const records = context.repository.listLeads();
        const selectedId = url.searchParams.get('leadId') ?? undefined;
        const selected = selectedId ? context.repository.getLead(selectedId) : records[0];
        return send(response, html(renderProspectDashboardPage({
          records,
          selected,
          runs: context.runStore.listRuns(20),
          generatedAt: context.now?.() ?? new Date().toISOString(),
        })));
      }

      if (method === 'GET' && pathname === '/api/prospects') {
        return send(response, json(context.repository.listLeads().map(serializeProspect)));
      }

      if (method === 'GET' && pathname === '/api/prospect-runs') {
        return send(response, json(context.runStore.listRuns(30)));
      }

      if (method === 'POST' && pathname === '/api/prospects/run') {
        if (!context.runDiscovery) return send(response, json({ error: 'Prospect discovery is not configured.' }, 503));
        if (!activeDiscoveryRun) {
          activeDiscoveryRun = context.runDiscovery().finally(() => {
            activeDiscoveryRun = undefined;
          });
        }
        const result = await activeDiscoveryRun;
        return send(response, json({ run: result.run, newLeads: result.newLeads.map((lead) => lead.id) }, 201));
      }

      const actionMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/(status|owner|activity)$/);
      if (method === 'POST' && actionMatch) {
        const leadId = decodeURIComponent(actionMatch[1] ?? '');
        const action = actionMatch[2];
        const payload = asObject(body);
        const actor = 'admin@codistan.org';
        if (!context.repository.getLead(leadId)) return send(response, json({ error: 'Prospect not found.' }, 404));

        if (action === 'status') {
          const status = requireString(payload.status, 'status') as PipelineStatus;
          const updated = context.repository.updateStatus(leadId, status, actor);
          return send(response, json(serializeProspect(updated)));
        }

        if (action === 'owner') {
          const owner = requireString(payload.owner, 'owner');
          const updated = context.repository.assignOwner(leadId, owner, actor);
          return send(response, json(serializeProspect(updated)));
        }

        const type = requireActivityType(payload.type);
        const channel = requireString(payload.channel ?? 'internal', 'channel');
        const activityBody = requireString(payload.body, 'body');
        const occurredAt = context.now?.() ?? new Date().toISOString();
        let record = context.repository.getLead(leadId) as StoredLeadRecord;
        const leadUpdate = { ...record.lead, updatedAt: occurredAt };
        if (type === 'outreach') leadUpdate.lastContactedAt = occurredAt;
        if (type === 'response') leadUpdate.lastResponseAt = occurredAt;
        context.repository.upsertLead(leadUpdate, actor);
        record = context.repository.addNote(leadId, `activity::${type}::${channel}::${activityBody}`, actor);
        const nextStatus = activityStatus(type);
        if (nextStatus && record.lead.pipelineStatus !== nextStatus) {
          record = context.repository.updateStatus(leadId, nextStatus, actor);
        }
        return send(response, json(serializeProspect(record)));
      }

      if (pathname === '/lead-desk' || pathname.startsWith('/api/')) {
        const delegatedPath = pathname === '/lead-desk' ? `/${url.search}` : request.url ?? pathname;
        const delegated = handleSalesAutomationRequest(
          {
            method,
            path: delegatedPath,
            body,
            headers: normalizeHeaders(request.headers),
          },
          {
            repository: context.repository,
            portfolioItems: context.portfolioItems,
            actor: 'admin@codistan.org',
            role: 'admin',
            now: context.now,
          },
        );
        return send(response, delegated);
      }

      return send(response, json({ error: 'Not found.' }, 404));
    } catch (error) {
      return send(response, json({ error: (error as Error).message }, errorStatus(error)));
    }
  });
}

function serializeProspect(record: StoredLeadRecord) {
  return {
    ...record.lead,
    notes: record.notes,
    auditLog: record.auditLog,
    evaluation: record.latestEvaluation,
  };
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
  const type = requireString(value, 'type') as ActivityType;
  if (!['comment', 'outreach', 'response', 'meeting', 'proposal'].includes(type)) {
    throw new Error('Invalid activity type.');
  }
  return type;
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
  const expected = createSessionToken(expiresAt, secret);
  return safeEqual(token, expected);
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
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isRateLimited(attempts: Map<string, LoginAttemptState>, key: string): boolean {
  const state = attempts.get(key);
  if (!state) return false;
  const windowMs = 15 * 60 * 1_000;
  if (Date.now() - state.firstAttemptAt > windowMs) {
    attempts.delete(key);
    return false;
  }
  return state.count >= 5;
}

function registerFailedAttempt(attempts: Map<string, LoginAttemptState>, key: string): void {
  const existing = attempts.get(key);
  if (!existing || Date.now() - existing.firstAttemptAt > 15 * 60 * 1_000) {
    attempts.set(key, { count: 1, firstAttemptAt: Date.now() });
    return;
  }
  existing.count += 1;
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/json')) return JSON.parse(raw);
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try {
    return JSON.parse(raw);
  } catch {
    return { value: raw };
  }
}

function normalizeHeaders(headers: IncomingMessage['headers']): Record<string, string | string[] | undefined> {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) normalized[key] = value;
  return normalized;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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

function html(body: string, status = 200): DashboardResponse {
  return {
    status,
    headers: { ...securityHeaders(), 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    body,
  };
}

function json(value: unknown, status = 200): DashboardResponse {
  return {
    status,
    headers: { ...securityHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(value),
  };
}

function redirect(location: string): DashboardResponse {
  return {
    status: 302,
    headers: { ...securityHeaders(), location, 'cache-control': 'no-store' },
    body: '',
  };
}

function send(response: ServerResponse, result: DashboardResponse): void {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function errorStatus(error: unknown): number {
  const message = (error as Error).message.toLowerCase();
  if (message.includes('required') || message.includes('invalid') || message.includes('too large')) return 400;
  if (message.includes('not found')) return 404;
  return 500;
}
