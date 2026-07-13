import type { EvaluateLeadInput, LeadEvaluation } from '@sales-automation/evaluator';
import type { Lead, PortfolioItem } from '@sales-automation/shared';

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const loginAttempts = new Map<string, { count: number; firstAttemptAt: number }>();

const serviceCategories = [
  'ai_automation',
  'rag_document_intelligence',
  'ai_saas_mvp',
  'fullstack_web_app',
  'nextjs_python_app',
  'voice_ai_agent',
  'ar_3d_unity_unreal',
  'cybersecurity_compliance',
  'website_portal',
  'enterprise_systems',
  'unknown',
] as const;

type ServiceCategory = typeof serviceCategories[number];

interface DashboardAccount {
  identifier: string;
  displayName: string;
  password: string;
  aliases: string[];
}

interface DashboardSession {
  identifier: string;
  displayName: string;
}

export const maxDuration = 300;

export default {
  async fetch(request: Request): Promise<Response> {
    let phase = 'request_received';
    try {
      const originalUrl = getOriginalRequestUrl(request);
      const pathname = new URL(originalUrl, 'https://local.invalid').pathname;

      if (request.method === 'GET' && pathname === '/health') {
        return Response.json({
          ok: true,
          service: 'codistan-prospect-desk',
          runtime: 'vercel-node',
          nodeVersion: process.version,
          databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
          adminPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD?.trim()),
          talhaAccountConfigured: Boolean(process.env.TALHA_DASHBOARD_PASSWORD?.trim()),
          jawadAccountConfigured: Boolean(process.env.JAWAD_DASHBOARD_PASSWORD?.trim()),
          sessionSecretConfigured: Boolean(process.env.SESSION_SECRET?.trim()),
          deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
          region: process.env.VERCEL_REGION ?? null,
          now: new Date().toISOString(),
        });
      }

      phase = 'load_auth_configuration';
      const adminPassword = requireEnvironment('ADMIN_PASSWORD');
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      if (sessionSecret.length < 24) throw new Error('SESSION_SECRET must contain at least 24 characters.');
      const accounts = loadDashboardAccounts(adminPassword);

      if (request.method === 'GET' && pathname === '/login') {
        return html(renderLoginPage());
      }

      if (request.method === 'POST' && pathname === '/api/login') {
        phase = 'authenticate_login';
        const payload = asObject(await parseRequestBody(request));
        const identifier = normalizeIdentifier(optionalString(payload.identifier) ?? optionalString(payload.email) ?? 'admin');
        const password = requireString(payload.password, 'password');
        const clientAddress = request.headers.get('x-forwarded-for')
          ?? request.headers.get('x-real-ip')
          ?? 'vercel';
        const clientKey = `${clientAddress}:${identifier}`;
        if (isRateLimited(clientKey)) {
          return json({ error: 'Too many failed attempts. Try again later.' }, 429);
        }
        const account = await authenticateAccount(identifier, password, accounts);
        if (!account) {
          registerFailedAttempt(clientKey);
          return json({ error: 'Incorrect email or password.' }, 401);
        }
        loginAttempts.delete(clientKey);
        const expiresAt = Math.floor(Date.now() / 1_000) + SESSION_LIFETIME_SECONDS;
        const token = await createSessionToken(expiresAt, sessionSecret);
        const actorToken = await createActorToken(account.identifier, sessionSecret);
        const headers = new Headers({
          ...securityHeaders(),
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        headers.append('set-cookie', buildSessionCookie(token));
        headers.append('set-cookie', buildActorCookie(actorToken));
        return new Response(JSON.stringify({
          ok: true,
          identifier: account.identifier,
          displayName: account.displayName,
          access: 'admin',
        }), { status: 200, headers });
      }

      if (request.method === 'POST' && pathname === '/api/logout') {
        const headers = new Headers({
          ...securityHeaders(),
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        headers.append('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`);
        headers.append('set-cookie', `${ACTOR_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
      }

      phase = 'validate_session';
      const session = await readDashboardSession(request.headers.get('cookie'), sessionSecret, accounts);
      if (!session) {
        if (request.method === 'GET' && !pathname.startsWith('/api/')) {
          return new Response('', {
            status: 302,
            headers: { ...securityHeaders(), location: '/login', 'cache-control': 'no-store' },
          });
        }
        return json({ error: 'Authentication required.' }, 401);
      }

      if (request.method === 'GET' && pathname === '/api/session') {
        return json({
          authenticated: true,
          identifier: session.identifier,
          displayName: session.displayName,
          access: 'admin',
        });
      }

      phase = 'load_application_modules';
      const [evaluatorModule, fixturesModule, neonModule, prospectModule, handlerModule] = await Promise.all([
        import('@sales-automation/evaluator'),
        import('@sales-automation/fixtures'),
        import('@sales-automation/neon-state'),
        import('@sales-automation/prospect-discovery'),
        import('@sales-automation/web/prospect-handler'),
      ]);

      phase = 'connect_database';
      const databaseUrl = neonModule.requireDatabaseUrl(process.env.DATABASE_URL);
      const state = await neonModule.loadNeonAppState(databaseUrl);
      const actor = session.identifier;
      let stateChanged = false;

      phase = 'seed_verified_starter_prospects';
      const starterImport = importStarterProspects({
        repository: state.repository,
        portfolioItems: fixturesModule.samplePortfolioItems,
        starterLeads: fixturesModule.verifiedStarterProspects,
        evaluateLead: evaluatorModule.evaluateLead,
        actor,
      });
      stateChanged = starterImport.imported > 0;

      const requestBody = await parseRequestBody(request);

      if (request.method === 'POST' && pathname === '/api/prospects/import-starter') {
        phase = 'import_verified_starter_prospects';
        if (stateChanged) await neonModule.persistNeonAppState(databaseUrl, state);
        return json({
          ok: true,
          imported: starterImport.imported,
          existing: starterImport.existing,
          total: state.repository.listLeads().length,
        }, starterImport.imported > 0 ? 201 : 200);
      }

      const serviceMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/service$/);
      if (request.method === 'POST' && serviceMatch) {
        phase = 'update_prospect_service';
        const leadId = decodeURIComponent(serviceMatch[1] ?? '');
        const existing = state.repository.getLead(leadId);
        if (!existing) return json({ error: 'Prospect not found.' }, 404);
        const payload = asObject(requestBody);
        const serviceCategory = requireServiceCategory(payload.serviceCategory);
        const serviceOffer = requireString(payload.serviceOffer, 'serviceOffer');
        const materialsToShare = requireString(payload.materialsToShare, 'materialsToShare');
        const updatedAt = new Date().toISOString();
        state.repository.upsertLead({
          ...existing.lead,
          serviceCategory,
          serviceOffer,
          materialsToShare,
          updatedAt,
        }, actor);
        state.repository.addNote(
          leadId,
          `service::${serviceCategory}::${serviceOffer}::${materialsToShare}`,
          actor,
        );
        await neonModule.persistNeonAppState(databaseUrl, state);
        return json({ ok: true, leadId, serviceCategory, serviceOffer, materialsToShare });
      }

      const followUpMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/followup$/);
      if (request.method === 'POST' && followUpMatch) {
        phase = 'schedule_prospect_followup';
        const leadId = decodeURIComponent(followUpMatch[1] ?? '');
        if (!state.repository.getLead(leadId)) return json({ error: 'Prospect not found.' }, 404);
        const payload = asObject(requestBody);
        const nextFollowUpAt = requireString(payload.nextFollowUpAt, 'nextFollowUpAt');
        const followUpDate = new Date(nextFollowUpAt);
        if (Number.isNaN(followUpDate.getTime())) return json({ error: 'nextFollowUpAt must be a valid date and time.' }, 400);
        const followUpNote = optionalString(payload.followUpNote);
        state.repository.scheduleFollowUp(leadId, {
          nextFollowUpAt: followUpDate.toISOString(),
          followUpNote,
        }, actor);
        await neonModule.persistNeonAppState(databaseUrl, state);
        return json({ ok: true, leadId, nextFollowUpAt: followUpDate.toISOString(), followUpNote });
      }

      phase = 'handle_dashboard_request';
      const result = await handlerModule.handleProspectDashboardRequest({
        method: request.method,
        url: originalUrl,
        headers: requestHeaders(request),
        body: requestBody,
        clientKey: request.headers.get('x-forwarded-for')
          ?? request.headers.get('x-real-ip')
          ?? 'vercel',
      }, {
        repository: state.repository,
        runStore: state.runStore,
        portfolioItems: fixturesModule.samplePortfolioItems,
        runDiscovery: () => prospectModule.runProspectDiscovery(buildDiscoveryOptions(
          state.repository,
          state.runStore,
          fixturesModule.samplePortfolioItems,
        )),
        adminPassword,
        sessionSecret,
        secureCookies: true,
        actor,
      });

      if (stateChanged || (request.method !== 'GET' && request.method !== 'HEAD' && result.status < 400)) {
        phase = 'persist_application_state';
        await neonModule.persistNeonAppState(databaseUrl, state);
      }

      return new Response(result.body, {
        status: result.status,
        headers: result.headers,
      });
    } catch (error) {
      const details = normalizeError(error);
      console.error('VERCEL_DASHBOARD_RUNTIME_ERROR', {
        phase,
        message: details.message,
        stack: details.stack,
      });
      return runtimeErrorResponse(request, phase, details.message);
    }
  },
};

interface StarterImportInput {
  repository: {
    getLead(leadId: string): unknown;
    saveEvaluation(evaluation: LeadEvaluation, actor?: string): unknown;
  };
  portfolioItems: PortfolioItem[];
  starterLeads: Lead[];
  evaluateLead(input: EvaluateLeadInput): LeadEvaluation;
  actor: string;
}

function importStarterProspects(input: StarterImportInput): { imported: number; existing: number } {
  let imported = 0;
  let existing = 0;
  const generatedAt = new Date().toISOString();
  for (const lead of input.starterLeads) {
    if (input.repository.getLead(lead.id)) {
      existing += 1;
      continue;
    }
    input.repository.saveEvaluation(input.evaluateLead({
      lead,
      portfolioItems: input.portfolioItems,
      generatedAt,
    }), input.actor);
    imported += 1;
  }
  return { imported, existing };
}

function buildDiscoveryOptions(repository: unknown, runStore: unknown, portfolioItems: unknown[]) {
  return {
    repository,
    runStore,
    portfolioItems,
    maxCandidates: positiveInteger(process.env.PROSPECT_MAX_CANDIDATES, 15),
    maxSearchQueries: positiveInteger(process.env.PROSPECT_MAX_SEARCH_QUERIES, 10),
    searchQueries: splitList(process.env.PROSPECT_SEARCH_QUERIES),
    remoteOkEnabled: process.env.PROSPECT_REMOTEOK_ENABLED !== 'false',
    bingRssEnabled: process.env.PROSPECT_BING_RSS_ENABLED !== 'false',
    greenhouseBoards: splitList(process.env.PROSPECT_GREENHOUSE_BOARDS),
    leverSites: splitList(process.env.PROSPECT_LEVER_SITES),
    rssFeeds: splitList(process.env.PROSPECT_RSS_FEEDS),
    digest: {
      to: process.env.PROSPECT_DIGEST_TO,
      from: process.env.PROSPECT_DIGEST_FROM ?? process.env.SMTP_FROM,
      smtpHost: process.env.SMTP_HOST,
      smtpPort: positiveInteger(process.env.SMTP_PORT, 587),
      smtpSecure: process.env.SMTP_SECURE === 'true',
      smtpUser: process.env.SMTP_USER,
      smtpPassword: process.env.SMTP_PASSWORD,
      subjectPrefix: process.env.PROSPECT_DIGEST_SUBJECT_PREFIX ?? 'Codistan Daily Prospects',
    },
  } as never;
}

function loadDashboardAccounts(adminPassword: string): DashboardAccount[] {
  const adminIdentifier = normalizeIdentifier(process.env.ADMIN_EMAIL ?? 'admin');
  const accounts: DashboardAccount[] = [{
    identifier: adminIdentifier,
    displayName: 'Administrator',
    password: adminPassword,
    aliases: uniqueIdentifiers([adminIdentifier, 'admin']),
  }];
  const talhaPassword = process.env.TALHA_DASHBOARD_PASSWORD?.trim();
  if (talhaPassword) accounts.push({
    identifier: 'talha.bashir@codistan.org',
    displayName: 'Talha Bashir',
    password: talhaPassword,
    aliases: ['talha.bashir@codistan.org'],
  });
  const jawadPassword = process.env.JAWAD_DASHBOARD_PASSWORD?.trim();
  if (jawadPassword) accounts.push({
    identifier: 'jawad.jutt@codistan.org',
    displayName: 'Jawad Jutt',
    password: jawadPassword,
    aliases: ['jawad.jutt@codistan.org'],
  });
  return accounts;
}

async function authenticateAccount(
  identifier: string,
  password: string,
  accounts: DashboardAccount[],
): Promise<DashboardAccount | undefined> {
  const account = accounts.find((candidate) => candidate.aliases.includes(identifier));
  const comparisonPassword = account?.password ?? accounts[0]?.password ?? 'not-a-valid-password';
  const passwordMatches = await safeEqual(password, comparisonPassword);
  return account && passwordMatches ? account : undefined;
}

async function readDashboardSession(
  cookieHeader: string | null,
  secret: string,
  accounts: DashboardAccount[],
): Promise<DashboardSession | undefined> {
  if (!(await isAuthenticated(cookieHeader, secret))) return undefined;
  const cookies = parseCookies(cookieHeader ?? undefined);
  const actorIdentifier = await verifyActorToken(cookies[ACTOR_COOKIE], secret);
  const account = actorIdentifier
    ? accounts.find((candidate) => candidate.identifier === actorIdentifier)
    : accounts[0];
  if (!account) return undefined;
  return { identifier: account.identifier, displayName: account.displayName };
}

function getOriginalRequestUrl(request: Request): string {
  const incoming = new URL(request.url);
  const rewrittenPath = incoming.searchParams.get('__path');
  if (rewrittenPath !== null) {
    incoming.pathname = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
    incoming.searchParams.delete('__path');
  }
  return `${incoming.pathname}${incoming.search}`;
}

async function parseRequestBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const raw = await request.text();
  if (!raw) return undefined;
  if (raw.length > 1_000_000) throw new Error('Request body is too large.');
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) return JSON.parse(raw);
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { value: raw };
  }
}

function requestHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(request.headers.entries());
}

function renderLoginPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codistan Prospect Desk Login</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#0f172a}
    *{box-sizing:border-box}body{margin:0}.shell{min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(430px,100%);background:#fff;border-radius:22px;padding:34px;box-shadow:0 30px 80px rgba(0,0,0,.35)}
    .mark{width:52px;height:52px;border-radius:15px;background:#f8c838;display:grid;place-items:center;font-weight:900;font-size:24px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:#667085;margin:20px 0 5px}
    h1{margin:0 0 8px}p{color:#667085}label{display:grid;gap:7px;font-size:12px;font-weight:700;margin-top:18px}input{border:1px solid #d0d5dd;border-radius:10px;padding:12px;font:inherit}button{width:100%;margin-top:14px;border:0;border-radius:10px;background:#3157d5;color:#fff;padding:12px;font-weight:800;cursor:pointer}pre{background:#fef3f2;color:#b42318;border-radius:9px;padding:10px;font:12px inherit;white-space:pre-wrap}.note{font-size:12px;margin-top:16px}
  </style>
</head>
<body><main class="shell"><section class="card"><div class="mark">C</div><p class="eyebrow">Internal system</p><h1>Codistan Prospect Desk</h1><p>Sign in with your Codistan dashboard account. Every activity is recorded against the signed-in account.</p><form id="login-form"><label>Email or admin username<input name="identifier" type="text" autocomplete="username" required autofocus /></label><label>Password<input name="password" type="password" autocomplete="current-password" required /></label><button type="submit">Sign in</button></form><pre id="login-result" hidden></pre><p class="note">All configured accounts currently have the same administrator access.</p></section></main>
<script>
const form=document.getElementById('login-form');const result=document.getElementById('login-result');
form.addEventListener('submit',async(event)=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;result.hidden=true;try{const formData=new FormData(form);const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:formData.get('identifier'),password:formData.get('password')})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Login failed');location.href='/';}catch(error){result.textContent=error.message;result.hidden=false;button.disabled=false;}});
</script></body></html>`;
}

async function createSessionToken(expiresAt: number, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const payload = `admin:${expiresAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${expiresAt}.${signature}`;
}

async function createActorToken(identifier: string, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const encodedIdentifier = Buffer.from(identifier, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(`actor:${encodedIdentifier}`).digest('base64url');
  return `${encodedIdentifier}.${signature}`;
}

async function verifyActorToken(token: string | undefined, secret: string): Promise<string | undefined> {
  const match = token?.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const expected = await createActorToken(Buffer.from(match[1], 'base64url').toString('utf8'), secret);
  if (!(await safeEqual(token ?? '', expected))) return undefined;
  return normalizeIdentifier(Buffer.from(match[1], 'base64url').toString('utf8'));
}

async function isAuthenticated(cookieHeader: string | null, secret: string): Promise<boolean> {
  const token = parseCookies(cookieHeader ?? undefined)[SESSION_COOKIE];
  if (!token) return false;
  const match = token.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) return false;
  return safeEqual(token, await createSessionToken(expiresAt, secret));
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const { timingSafeEqual } = await import('node:crypto');
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_SECONDS}; Secure`;
}

function buildActorCookie(token: string): string {
  return `${ACTOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_SECONDS}; Secure`;
}

function parseCookies(value: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of value?.split(';') ?? []) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  }
  return cookies;
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueIdentifiers(values: string[]): string[] {
  return [...new Set(values.map(normalizeIdentifier).filter(Boolean))];
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
    return;
  }
  existing.count += 1;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireServiceCategory(value: unknown): ServiceCategory {
  const category = requireString(value, 'serviceCategory') as ServiceCategory;
  if (!serviceCategories.includes(category)) throw new Error('serviceCategory is invalid.');
  return category;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function securityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...securityHeaders(), 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...securityHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function runtimeErrorResponse(request: Request, phase: string, message: string): Response {
  const acceptsHtml = request.headers.get('accept')?.includes('text/html') ?? false;
  if (!acceptsHtml) return json({ error: 'Application runtime failed.', phase, detail: message }, 500);
  return html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prospect Desk startup error</title><style>body{font-family:system-ui;background:#f8fafc;color:#172033;margin:0;padding:40px}.card{max-width:760px;margin:8vh auto;background:white;border:1px solid #e2e8f0;border-radius:16px;padding:28px}code{display:block;background:#0f172a;color:#e2e8f0;padding:14px;border-radius:10px;overflow-wrap:anywhere}p{color:#475569}</style></head><body><main class="card"><h1>Prospect Desk could not start</h1><p>The Vercel function is running, but the application failed during <strong>${escapeHtml(phase)}</strong>.</p><code>${escapeHtml(message)}</code><p>Open the Vercel Runtime Logs and search for <strong>VERCEL_DASHBOARD_RUNTIME_ERROR</strong>.</p></main></body></html>`, 500);
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}
