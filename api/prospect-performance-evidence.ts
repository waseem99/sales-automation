export const maxDuration = 300;

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';
const ALLOWED_ACTORS = new Set(['admin', 'waseem@codistan.org']);

export default {
  async fetch(request: Request): Promise<Response> {
    const startedAt = performance.now();
    try {
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, { allow: 'GET' });
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      if (sessionSecret.length < 24) throw new Error('SESSION_SECRET must contain at least 24 characters.');
      const cookies = parseCookies(request.headers.get('cookie') ?? undefined);
      if (!(await isAuthenticated(cookies[SESSION_COOKIE], sessionSecret))) return json({ error: 'Authentication required.' }, 401);
      const actor = await verifyActorToken(cookies[ACTOR_COOKIE], sessionSecret);
      if (!actor) return json({ error: 'Authentication required.' }, 401);
      if (!ALLOWED_ACTORS.has(actor)) return json({ error: 'Forbidden: performance evidence is restricted to Admin and Waseem.' }, 403);

      const databaseUrl = requireEnvironment('DATABASE_URL');
      const evidenceModule = await import('@sales-automation/neon-state/prospect-performance-evidence');
      const evidence = await evidenceModule.loadProspectPerformanceEvidence(databaseUrl);
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      console.info('PROSPECT_PERFORMANCE_EVIDENCE', {
        actor,
        migrationApplied: evidence.migration.applied,
        expectedIndexCount: evidence.indexes.expected.length,
        installedExpectedIndexCount: evidence.indexes.expected.length - evidence.indexes.missing.length,
        plannerCheckCount: evidence.planner.length,
        queryCount: evidence.metrics.queryCount,
        durationMs,
      });
      return json({
        ok: true,
        evidence,
        deployment: {
          commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
          region: process.env.VERCEL_REGION ?? null,
          environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
        },
        durationMs,
      }, 200, {
        'x-performance-evidence-version': evidence.migration.version,
        'x-performance-evidence-query-count': String(evidence.metrics.queryCount),
      });
    } catch (error) {
      const referenceId = `pe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      console.error('PROSPECT_PERFORMANCE_EVIDENCE_ERROR', {
        referenceId,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return json({ error: 'Performance evidence could not be generated.', referenceId }, 500);
    }
  },
};

async function isAuthenticated(token: string | undefined, secret: string): Promise<boolean> {
  const match = token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) return false;
  return safeEqual(token ?? '', await createSessionToken(expiresAt, secret));
}

async function verifyActorToken(token: string | undefined, secret: string): Promise<string | undefined> {
  const match = token?.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const identifier = Buffer.from(match[1], 'base64url').toString('utf8').trim().toLowerCase();
  return await safeEqual(token ?? '', await createActorToken(identifier, secret)) ? identifier : undefined;
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

async function safeEqual(left: string, right: string): Promise<boolean> {
  const { timingSafeEqual } = await import('node:crypto');
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(value: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of value?.split(';') ?? []) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  }
  return cookies;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function securityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'cache-control': 'no-store',
  };
}

function json(value: unknown, status = 200, additionalHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...securityHeaders(),
      ...additionalHeaders,
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
