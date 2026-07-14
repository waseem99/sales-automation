export const maxDuration = 300;

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const loginAttempts = new Map<string, { count: number; firstAttemptAt: number }>();

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

interface DashboardAccountSpec {
  identifier: string;
  displayName: string;
  passwordEnvironmentName: string;
}

const dashboardAccountSpecs: DashboardAccountSpec[] = [
  { identifier: 'waseem@codistan.org', displayName: 'Waseem Khan', passwordEnvironmentName: 'WASEEM_DASHBOARD_PASSWORD' },
  { identifier: 'talha.bashir@codistan.org', displayName: 'Talha Bashir', passwordEnvironmentName: 'TALHA_DASHBOARD_PASSWORD' },
  { identifier: 'jawad.jutt@codistan.org', displayName: 'Jawad Jutt', passwordEnvironmentName: 'JAWAD_DASHBOARD_PASSWORD' },
  { identifier: 'moiz.khalid@codistan.org', displayName: 'Moiz Khalid', passwordEnvironmentName: 'MOIZ_DASHBOARD_PASSWORD' },
  { identifier: 'subainaaamir@codistan.org', displayName: 'Subaina Aamir', passwordEnvironmentName: 'SUBAINA_DASHBOARD_PASSWORD' },
  { identifier: 'danishkhalid@codistan.org', displayName: 'Danish Khalid', passwordEnvironmentName: 'DANISH_DASHBOARD_PASSWORD' },
  { identifier: 'hibasohail@codistan.org', displayName: 'Hiba Sohail', passwordEnvironmentName: 'HIBA_DASHBOARD_PASSWORD' },
  { identifier: 'bilalahmed@codistan.org', displayName: 'Bilal Ahmed', passwordEnvironmentName: 'BILAL_DASHBOARD_PASSWORD' },
];

export default {
  async fetch(request: Request): Promise<Response> {
    let phase = 'request_received';
    try {
      const originalUrl = getOriginalRequestUrl(request);
      const pathname = new URL(originalUrl, 'https://local.invalid').pathname;

      if (request.method === 'GET' && pathname === '/health') {
        const configuredAccounts = dashboardAccountSpecs.filter((spec) => Boolean(process.env[spec.passwordEnvironmentName]?.trim()));
        return Response.json({
          ok: true,
          service: 'codistan-prospect-desk',
          runtime: 'vercel-node',
          nodeVersion: process.version,
          databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
          adminPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD?.trim()),
          waseemAccountConfigured: Boolean(process.env.WASEEM_DASHBOARD_PASSWORD?.trim()),
          talhaAccountConfigured: Boolean(process.env.TALHA_DASHBOARD_PASSWORD?.trim()),
          jawadAccountConfigured: Boolean(process.env.JAWAD_DASHBOARD_PASSWORD?.trim()),
          moizAccountConfigured: Boolean(process.env.MOIZ_DASHBOARD_PASSWORD?.trim()),
          subainaAccountConfigured: Boolean(process.env.SUBAINA_DASHBOARD_PASSWORD?.trim()),
          danishAccountConfigured: Boolean(process.env.DANISH_DASHBOARD_PASSWORD?.trim()),
          hibaAccountConfigured: Boolean(process.env.HIBA_DASHBOARD_PASSWORD?.trim()),
          bilalAccountConfigured: Boolean(process.env.BILAL_DASHBOARD_PASSWORD?.trim()),
          configuredTeamAccountCount: configuredAccounts.length,
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

      if (request.method === 'GET' && pathname === '/login') return html(renderLoginPage());

      if (request.method === 'POST' && pathname === '/api/login') {
        phase = 'authenticate_login';
        const payload = asObject(await parseRequestBody(request));
        const identifier = normalizeIdentifier(optionalString(payload.identifier) ?? optionalString(payload.email) ?? 'admin');
        const password = requireString(payload.password, 'password');
        const address = clientAddress(request);
        const clientKey = `${address}:${identifier}`;
        const account = await authenticateAccount(identifier, password, accounts);

        if (!account) {
          if (isRateLimited(clientKey)) {
            return json({ error: 'Too many failed attempts. Try again later.' }, 429, { 'retry-after': String(rateLimitRetryAfterSeconds(clientKey)) });
          }
          registerFailedAttempt(clientKey);
          return json({ error: 'Incorrect email or password.' }, 401);
        }

        loginAttempts.delete(clientKey);
        const expiresAt = Math.floor(Date.now() / 1_000) + SESSION_LIFETIME_SECONDS;
        const headers = new Headers({ ...securityHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        headers.append('set-cookie', buildSessionCookie(await createSessionToken(expiresAt, sessionSecret)));
        headers.append('set-cookie', buildActorCookie(await createActorToken(account.identifier, sessionSecret)));
        return new Response(JSON.stringify({
          ok: true,
          identifier: account.identifier,
          displayName: account.displayName,
          access: accountAccess(account.identifier),
        }), { status: 200, headers });
      }

      if (request.method === 'POST' && pathname === '/api/logout') {
        const headers = new Headers({ ...securityHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        headers.append('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`);
        headers.append('set-cookie', `${ACTOR_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
      }

      phase = 'validate_session';
      const session = await readDashboardSession(request.headers.get('cookie'), sessionSecret, accounts);
      if (!session) {
        if (request.method === 'GET' && !pathname.startsWith('/api/')) {
          return new Response('', { status: 302, headers: { ...securityHeaders(), location: '/login', 'cache-control': 'no-store' } });
        }
        return json({ error: 'Authentication required.' }, 401);
      }

      if (request.method === 'GET' && pathname === '/api/session') {
        return json({
          authenticated: true,
          identifier: session.identifier,
          displayName: session.displayName,
          access: accountAccess(session.identifier),
        });
      }

      const databaseUrl = requireEnvironment('DATABASE_URL');
      const access = accountAccess(session.identifier);

      if (pathname === '/portfolio' || pathname === '/api/portfolio-catalog') {
        phase = 'load_portfolio_catalog_runtime';
        const portfolioRuntime = await import('../vercel/portfolio-catalog-runtime.js');
        return portfolioRuntime.handlePortfolioCatalogRuntime({
          request,
          databaseUrl,
          actor: session.identifier,
          canManage: access.role === 'admin',
          pathname,
        });
      }

      phase = 'load_managed_portfolio_catalog';
      await loadApprovedPortfolioIntoRuntime(databaseUrl);

      if (pathname === '/priorities' || pathname === '/api/closeability-rescore') {
        phase = 'load_priority_queue_runtime';
        const priorityRuntime = await import('../vercel/priority-queue-runtime.js');
        return priorityRuntime.handlePriorityQueueRuntime({ request, databaseUrl, pathname, session });
      }

      phase = 'load_scoped_dashboard_runtime';
      const runtime = await import('./dashboard-runtime.js');
      return runtime.handleAuthenticatedDashboardRequest({ request, originalUrl, session, adminPassword, sessionSecret });
    } catch (error) {
      const details = normalizeError(error);
      console.error('VERCEL_DASHBOARD_RUNTIME_ERROR', { phase, message: details.message, stack: details.stack });
      return runtimeErrorResponse(request, phase, details.message);
    }
  },
};

async function loadApprovedPortfolioIntoRuntime(databaseUrl: string): Promise<void> {
  const [catalog, starters, fixtures] = await Promise.all([
    import('@sales-automation/neon-state/portfolio-catalog'),
    import('../vercel/approved-portfolio.js'),
    import('@sales-automation/fixtures'),
  ]);
  await catalog.ensurePortfolioCatalogSeeded(databaseUrl, starters.approvedStarterPortfolioItems);
  const approved = await catalog.loadApprovedPortfolioCatalog(databaseUrl);
  catalog.replacePortfolioArray(fixtures.samplePortfolioItems, catalog.asPortfolioItems(approved));
}

function loadDashboardAccounts(adminPassword: string): DashboardAccount[] {
  const fixed = dashboardAccountSpecs.flatMap((spec) => {
    const password = process.env[spec.passwordEnvironmentName]?.trim();
    return password ? [{ identifier: spec.identifier, displayName: spec.displayName, password, aliases: [spec.identifier] }] : [];
  });
  const adminEmail = normalizeIdentifier(process.env.ADMIN_EMAIL ?? '');
  fixed.push({
    identifier: 'admin',
    displayName: 'Administrator',
    password: adminPassword,
    aliases: uniqueIdentifiers(['admin', adminEmail].filter((alias) => alias && !dashboardAccountSpecs.some((spec) => spec.identifier === alias))),
  });
  return fixed;
}

async function authenticateAccount(identifier: string, password: string, accounts: DashboardAccount[]): Promise<DashboardAccount | undefined> {
  const account = accounts.find((candidate) => candidate.aliases.includes(identifier));
  const comparisonPassword = account?.password ?? accounts[0]?.password ?? 'not-a-valid-password';
  return account && await safeEqual(password, comparisonPassword) ? account : undefined;
}

async function readDashboardSession(cookieHeader: string | null, secret: string, accounts: DashboardAccount[]): Promise<DashboardSession | undefined> {
  if (!(await isAuthenticated(cookieHeader, secret))) return undefined;
  const actorIdentifier = await verifyActorToken(parseCookies(cookieHeader ?? undefined)[ACTOR_COOKIE], secret);
  const account = actorIdentifier ? accounts.find((candidate) => candidate.identifier === actorIdentifier) : accounts.find((candidate) => candidate.identifier === 'admin');
  return account ? { identifier: account.identifier, displayName: account.displayName } : undefined;
}

function accountAccess(identifier: string) {
  const normalized = normalizeIdentifier(identifier);
  if (normalized === 'admin' || normalized === 'waseem@codistan.org') return { role: 'admin', scope: 'all', scopeLabel: 'All company leads' };
  if (normalized === 'talha.bashir@codistan.org') return { role: 'team_lead', scope: 'team', scopeLabel: 'Talha team leads' };
  return { role: 'bd_user', scope: 'own', scopeLabel: 'My assigned leads' };
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
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { return { value: raw }; }
}

function renderLoginPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Codistan Prospect Desk Login</title><style>:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#0f172a}*{box-sizing:border-box}body{margin:0}.shell{min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(430px,100%);background:#fff;border-radius:22px;padding:34px;box-shadow:0 30px 80px rgba(0,0,0,.35)}.mark{width:52px;height:52px;border-radius:15px;background:#f8c838;display:grid;place-items:center;font-weight:900;font-size:24px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:#667085;margin:20px 0 5px}h1{margin:0 0 8px}p{color:#667085}label{display:grid;gap:7px;font-size:12px;font-weight:700;margin-top:18px}input{border:1px solid #d0d5dd;border-radius:10px;padding:12px;font:inherit}button{width:100%;margin-top:14px;border:0;border-radius:10px;background:#3157d5;color:#fff;padding:12px;font-weight:800}pre{background:#fef3f2;color:#b42318;border-radius:9px;padding:10px;font:12px inherit;white-space:pre-wrap}.note{font-size:12px;margin-top:16px}</style></head><body><main class="shell"><section class="card"><div class="mark">C</div><p class="eyebrow">Internal system</p><h1>Codistan Prospect Desk</h1><p>Sign in with your Codistan dashboard account. Lead visibility and actions are scoped to the signed-in account.</p><form id="login-form"><label>Email or admin username<input name="identifier" type="text" autocomplete="username" required autofocus /></label><label>Password<input name="password" type="password" autocomplete="current-password" required /></label><button type="submit">Sign in</button></form><pre id="login-result" hidden></pre><p class="note">Admin and Waseem see all leads. Other accounts see their assigned scope.</p></section></main><script>const form=document.getElementById('login-form'),result=document.getElementById('login-result');form.addEventListener('submit',async(event)=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;result.hidden=true;try{const dataForm=new FormData(form);const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:dataForm.get('identifier'),password:dataForm.get('password')})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Login failed');location.href='/';}catch(error){result.textContent=error.message;result.hidden=false;button.disabled=false;}});</script></body></html>`;
}

async function createSessionToken(expiresAt: number, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha256', secret).update(`admin:${expiresAt}`).digest('base64url');
  return `${expiresAt}.${signature}`;
}

async function createActorToken(identifier: string, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const encoded = Buffer.from(identifier, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(`actor:${encoded}`).digest('base64url');
  return `${encoded}.${signature}`;
}

async function verifyActorToken(token: string | undefined, secret: string): Promise<string | undefined> {
  const match = token?.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const identifier = Buffer.from(match[1], 'base64url').toString('utf8');
  return await safeEqual(token ?? '', await createActorToken(identifier, secret)) ? normalizeIdentifier(identifier) : undefined;
}

async function isAuthenticated(cookieHeader: string | null, secret: string): Promise<boolean> {
  const token = parseCookies(cookieHeader ?? undefined)[SESSION_COOKIE];
  const match = token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  return Number.isFinite(expiresAt) && expiresAt > Math.floor(Date.now() / 1_000) && await safeEqual(token ?? '', await createSessionToken(expiresAt, secret));
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const { timingSafeEqual } = await import('node:crypto');
  const leftBuffer = Buffer.from(left); const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function buildSessionCookie(token: string): string { return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_SECONDS}; Secure`; }
function buildActorCookie(token: string): string { return `${ACTOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_SECONDS}; Secure`; }
function parseCookies(value: string | undefined): Record<string, string> { const cookies: Record<string,string> = {}; for (const part of value?.split(';') ?? []) { const [name,...rest]=part.trim().split('='); if(name) cookies[name]=rest.join('='); } return cookies; }
function normalizeIdentifier(value: string): string { return value.trim().toLowerCase(); }
function uniqueIdentifiers(values: string[]): string[] { return [...new Set(values.map(normalizeIdentifier).filter(Boolean))]; }
function clientAddress(request: Request): string { return (request.headers.get('x-forwarded-for')?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'vercel').trim(); }
function isRateLimited(key: string): boolean { const state=loginAttempts.get(key); if(!state)return false; if(Date.now()-state.firstAttemptAt>15*60*1_000){loginAttempts.delete(key);return false;} return state.count>=5; }
function rateLimitRetryAfterSeconds(key: string): number { const state=loginAttempts.get(key); if(!state)return 0; return Math.max(1,Math.ceil((15*60*1_000-(Date.now()-state.firstAttemptAt))/1_000)); }
function registerFailedAttempt(key: string): void { const current=loginAttempts.get(key); if(!current||Date.now()-current.firstAttemptAt>15*60*1_000)loginAttempts.set(key,{count:1,firstAttemptAt:Date.now()}); else current.count+=1; }
function requireEnvironment(name: string): string { const value=process.env[name]; if(!value?.trim())throw new Error(`${name} is required.`); return value.trim(); }
function requireString(value: unknown, field: string): string { if(typeof value!=='string'||!value.trim())throw new Error(`${field} is required.`); return value.trim(); }
function optionalString(value: unknown): string | undefined { return typeof value==='string'&&value.trim()?value.trim():undefined; }
function asObject(value: unknown): Record<string, unknown> { return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}; }
function securityHeaders(): Record<string,string> { return {'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'same-origin','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}; }
function html(body: string,status=200): Response { return new Response(body,{status,headers:{...securityHeaders(),'content-type':'text/html; charset=utf-8','cache-control':'no-store'}}); }
function json(value: unknown,status=200,additionalHeaders: Record<string,string> = {}): Response { return new Response(JSON.stringify(value),{status,headers:{...securityHeaders(),...additionalHeaders,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}}); }
function runtimeErrorResponse(request: Request,phase:string,message:string): Response { const acceptsHtml=request.headers.get('accept')?.includes('text/html')??false; if(!acceptsHtml)return json({error:'Application runtime failed.',phase,detail:message},500); return html(`<!doctype html><html><body style="font-family:system-ui;background:#f8fafc;padding:40px"><main style="max-width:760px;margin:auto;background:#fff;padding:28px;border-radius:16px"><h1>Prospect Desk could not start</h1><p>Failure during <strong>${escapeHtml(phase)}</strong>.</p><code>${escapeHtml(message)}</code></main></body></html>`,500); }
function normalizeError(error: unknown): {message:string;stack?:string} { return error instanceof Error?{message:error.message,stack:error.stack}:{message:String(error)}; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]??character); }
