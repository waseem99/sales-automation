export const maxDuration = 300;

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      const cronAuthorized = Boolean(process.env.CRON_SECRET?.trim())
        && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET?.trim()}`;
      const actor = cronAuthorized ? 'authorized-linkedin-signal-intake' : await authorizedDashboardActor(request, sessionSecret);
      if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401 });
      if (!cronAuthorized && !['admin', 'waseem@codistan.org'].includes(actor)) {
        return Response.json({ error: 'Forbidden: LinkedIn signal intake is restricted to Admin and Waseem.' }, { status: 403 });
      }

      const databaseUrl = requireEnvironment('DATABASE_URL');
      await loadApprovedPortfolioIntoRuntime(databaseUrl);
      const runtime = await import('../vercel/linkedin-warm-signals-runtime.js');
      return runtime.handleLinkedInWarmSignalsRuntime({
        request,
        databaseUrl,
        actor,
        canManage: true,
        pathname: new URL(request.url).pathname,
      });
    } catch (error) {
      console.error('LINKEDIN_SIGNALS_API_ERROR', error);
      return Response.json({ error: 'LinkedIn signal workspace failed.', detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
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

async function authorizedDashboardActor(request: Request, secret: string): Promise<string | undefined> {
  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  if (!(await validSession(cookies[SESSION_COOKIE], secret))) return undefined;
  const actorToken = cookies[ACTOR_COOKIE];
  if (!actorToken) return 'admin';
  const match = actorToken.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const identifier = Buffer.from(match[1], 'base64url').toString('utf8').trim().toLowerCase();
  return await safeEqual(actorToken, await actorTokenFor(identifier, secret)) ? identifier : undefined;
}

async function validSession(token: string | undefined, secret: string): Promise<boolean> {
  const match = token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  return Number.isFinite(expiresAt)
    && expiresAt > Math.floor(Date.now() / 1000)
    && await safeEqual(token ?? '', await sessionTokenFor(expiresAt, secret));
}

async function sessionTokenFor(expiresAt: number, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  return `${expiresAt}.${createHmac('sha256', secret).update(`admin:${expiresAt}`).digest('base64url')}`;
}

async function actorTokenFor(identifier: string, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const encoded = Buffer.from(identifier, 'utf8').toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(`actor:${encoded}`).digest('base64url')}`;
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const { timingSafeEqual } = await import('node:crypto');
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) result[name] = rest.join('=');
  }
  return result;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}
