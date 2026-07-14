export const maxDuration = 300;

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';
const LOCK_NAME = 'prospect-quality-cleanup';

export default {
  async fetch(request: Request): Promise<Response> {
    let databaseUrl: string | undefined;
    let lockToken: string | undefined;
    let neonModule: Awaited<ReturnType<typeof loadNeonModule>> | undefined;

    try {
      if (!['GET', 'POST'].includes(request.method)) {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }

      const sessionSecret = requireEnvironment('SESSION_SECRET');
      const cronSecret = process.env.CRON_SECRET?.trim() ?? '';
      const cronAuthorized = Boolean(cronSecret)
        && request.headers.get('authorization') === `Bearer ${cronSecret}`;
      const actor = cronAuthorized ? 'vercel-cron' : await authorizedDashboardActor(request, sessionSecret);
      if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401 });
      if (!cronAuthorized && !['admin', 'waseem@codistan.org'].includes(actor)) {
        return Response.json({ error: 'Forbidden: cleanup is restricted to Admin and Waseem.' }, { status: 403 });
      }

      const [{ randomUUID }, loadedNeon, discovery] = await Promise.all([
        import('node:crypto'),
        loadNeonModule(),
        import('@sales-automation/prospect-discovery'),
      ]);
      neonModule = loadedNeon;
      databaseUrl = neonModule.requireDatabaseUrl(process.env.DATABASE_URL);
      lockToken = randomUUID();
      const locked = await neonModule.acquireNamedRunLock(databaseUrl, LOCK_NAME, lockToken, 10);
      if (!locked) {
        return Response.json({ ok: true, skipped: true, reason: 'Another prospect cleanup is active.' });
      }

      const state = await neonModule.loadNeonAppState(databaseUrl);
      const falsePositives = discovery.findStoredAutomaticProspectFalsePositives(
        state.repository.listLeads().map((record) => record.lead),
      );
      const removed = await neonModule.deleteLeadRecords(
        databaseUrl,
        falsePositives.map((item) => item.leadId),
      );

      return Response.json({
        ok: true,
        actor,
        checked: state.repository.listLeads().length,
        matched: falsePositives.length,
        removed,
        reasons: summarizeReasons(falsePositives),
        removedRecords: falsePositives.slice(0, 100).map((item) => ({
          leadId: item.leadId,
          title: item.title,
          sourceUrl: item.sourceUrl ?? null,
          reasonCodes: item.reasonCodes,
        })),
        safety: {
          automaticDiscoveryOnly: true,
          manualIntakeExcluded: true,
          tendersExcluded: true,
        },
      });
    } catch (error) {
      console.error('PROSPECT_QUALITY_CLEANUP_ERROR', error);
      return Response.json({
        error: 'Prospect quality cleanup failed.',
        detail: error instanceof Error ? error.message : String(error),
      }, { status: 500 });
    } finally {
      if (neonModule && databaseUrl && lockToken) {
        await neonModule.releaseNamedRunLock(databaseUrl, LOCK_NAME, lockToken).catch((error: unknown) => {
          console.error('PROSPECT_QUALITY_CLEANUP_LOCK_RELEASE_ERROR', error);
        });
      }
    }
  },
};

async function loadNeonModule() {
  return import('@sales-automation/neon-state');
}

function summarizeReasons(items: Array<{ reasonCodes: string[] }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const code of item.reasonCodes) counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
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
    && expiresAt > Math.floor(Date.now() / 1_000)
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
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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
