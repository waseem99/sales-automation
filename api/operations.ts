export const maxDuration = 300;
const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';

export default {
  async fetch(request: Request): Promise<Response> {
    let referenceId = 'unassigned';
    try {
      const pathname = originalPath(request);
      if (!((request.method === 'GET' && pathname === '/operations') || (request.method === 'POST' && pathname === '/api/source-controls'))) {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      referenceId = await errorReference();
      const actor = await authorizedDashboardActor(request, sessionSecret);
      if (!actor) {
        if (request.method === 'GET') return new Response('', { status: 302, headers: { location: '/login', 'cache-control': 'no-store' } });
        return Response.json({ error: 'Authentication required.' }, { status: 401 });
      }
      const runtime = await import('../vercel/operations-runtime.js');
      return runtime.handleOperationsRuntime({
        request,
        databaseUrl: requireEnvironment('DATABASE_URL'),
        pathname,
        actor,
        canManage: actor === 'admin' || actor === 'waseem@codistan.org',
      });
    } catch (error) {
      console.error('OPERATIONS_API_ERROR', { referenceId, error });
      if ((request.headers.get('accept') ?? '').includes('text/html')) {
        return htmlError(referenceId);
      }
      return Response.json({ error: 'Operations could not start.', referenceId }, { status: 500 });
    }
  },
};

function originalPath(request: Request): string {
  const url = new URL(request.url);
  const rewritten = url.searchParams.get('__path');
  return rewritten ? (rewritten.startsWith('/') ? rewritten : `/${rewritten}`) : url.pathname;
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
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function errorReference(): Promise<string> {
  const { randomUUID } = await import('node:crypto');
  return randomUUID();
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

function htmlError(referenceId: string): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Operations unavailable</title><style>:root{font-family:Inter,system-ui;color:#172033;background:#f4f6fb}main{max-width:720px;margin:80px auto;background:#fff;border:1px solid #e4e7ec;border-radius:18px;padding:28px}a{color:#3157d5;margin-right:14px}code{display:block;background:#f8fafc;padding:12px;border-radius:8px}</style></head><body><main><h1>Operations could not start</h1><p>The failure was recorded. Retry the page or return to Prospects.</p><code>Reference: ${escapeHtml(referenceId)}</code><p><a href="/operations">Retry</a><a href="/prospects">Prospects</a></p></main></body></html>`, {
    status: 500,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' },
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character] ?? character));
}
