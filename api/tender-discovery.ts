export const maxDuration = 300;

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';
const LOCK_NAME = 'tender-rfp-discovery';

export default {
  async fetch(request: Request): Promise<Response> {
    let databaseUrl: string | undefined;
    let lockToken: string | undefined;
    let neonModule: Awaited<ReturnType<typeof loadNeonModule>> | undefined;
    try {
      if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      const cronAuthorized = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET?.trim() ?? ''}`
        && Boolean(process.env.CRON_SECRET?.trim());
      const actor = cronAuthorized ? 'vercel-cron' : await authorizedDashboardActor(request, sessionSecret);
      if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401 });
      if (!cronAuthorized && !['admin', 'waseem@codistan.org'].includes(actor)) {
        return Response.json({ error: 'Forbidden: tender discovery is restricted to Admin and Waseem.' }, { status: 403 });
      }

      const [{ randomUUID }, loadedNeon, discovery, fixtures] = await Promise.all([
        import('node:crypto'),
        loadNeonModule(),
        import('@sales-automation/prospect-discovery'),
        import('@sales-automation/fixtures'),
      ]);
      neonModule = loadedNeon;
      databaseUrl = neonModule.requireDatabaseUrl(process.env.DATABASE_URL);
      lockToken = randomUUID();
      const locked = await neonModule.acquireNamedRunLock(databaseUrl, LOCK_NAME, lockToken, 20);
      if (!locked) return Response.json({ ok: true, skipped: true, reason: 'Another tender discovery run is active.' });

      const state = await neonModule.loadNeonAppState(databaseUrl);
      const result = await discovery.runTenderDiscovery({
        repository: state.repository,
        runStore: state.runStore,
        portfolioItems: fixtures.samplePortfolioItems,
        maxCandidates: positiveInteger(process.env.TENDER_MAX_CANDIDATES, 80),
        ppraEnabled: process.env.TENDER_PPRA_ENABLED !== 'false',
        canadaBuysEnabled: process.env.TENDER_CANADABUYS_ENABLED !== 'false',
        ungmEnabled: process.env.TENDER_UNGM_ENABLED !== 'false',
        privateNonprofitTendersEnabled: process.env.TENDER_PRIVATE_NONPROFIT_ENABLED !== 'false',
        expandedPublicTendersEnabled: process.env.TENDER_EXPANDED_PUBLIC_SOURCES_ENABLED !== 'false',
        tenderDocumentIntelligenceEnabled: process.env.TENDER_DOCUMENT_INTELLIGENCE_ENABLED !== 'false',
        tenderDocumentMaxBytes: positiveInteger(process.env.TENDER_DOCUMENT_MAX_BYTES, 4_000_000),
        digest: {
          to: process.env.PROSPECT_DIGEST_TO,
          from: process.env.PROSPECT_DIGEST_FROM ?? process.env.SMTP_FROM,
          smtpHost: process.env.SMTP_HOST,
          smtpPort: positiveInteger(process.env.SMTP_PORT, 587),
          smtpSecure: process.env.SMTP_SECURE === 'true',
          smtpUser: process.env.SMTP_USER,
          smtpPassword: process.env.SMTP_PASSWORD,
          subjectPrefix: process.env.TENDER_DIGEST_SUBJECT_PREFIX ?? 'Codistan Tender & RFP Pipeline',
        },
      });

      const falsePositiveIds = state.repository.listLeads()
        .filter((record) => discovery.shouldRemoveStoredTenderLead(record.lead))
        .map((record) => record.lead.id);

      await neonModule.persistNeonAppState(databaseUrl, state);
      const removedFalsePositiveCount = await neonModule.deleteLeadRecords(databaseUrl, falsePositiveIds);

      const payload = {
        ok: true,
        actor,
        run: result.run,
        newTenderIds: result.newLeads.map((lead) => lead.id),
        removedFalsePositiveCount,
        rejectedCandidateCount: result.run.rejectedCandidateCount ?? 0,
        documentIntelligenceCount: result.run.tenderDocumentIntelligenceCount ?? 0,
        amendmentCount: result.run.tenderAmendmentCount ?? 0,
        existingTenderEnrichedCount: result.run.tenderExistingEnrichedCount ?? 0,
        sourceSummary: result.sourceResults.map((source) => ({
          source: source.sourceName,
          checked: source.checked,
          candidates: source.candidates.length,
          error: source.error ?? null,
        })),
        tenderPipelineUrl: '/tenders',
      };
      if (request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html')) {
        return new Response('', { status: 302, headers: { location: '/tenders', 'cache-control': 'no-store' } });
      }
      return Response.json(payload, { status: result.newLeads.length > 0 ? 201 : 200 });
    } catch (error) {
      console.error('TENDER_DISCOVERY_ERROR', error);
      return Response.json({ error: 'Tender discovery failed.', detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
    } finally {
      if (neonModule && databaseUrl && lockToken) {
        await neonModule.releaseNamedRunLock(databaseUrl, LOCK_NAME, lockToken).catch((error: unknown) => {
          console.error('TENDER_DISCOVERY_LOCK_RELEASE_ERROR', error);
        });
      }
    }
  },
};

async function loadNeonModule() {
  return import('@sales-automation/neon-state');
}

async function authorizedDashboardActor(request: Request, secret: string): Promise<string | undefined> {
  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  if (!(await validSession(cookies[SESSION_COOKIE], secret))) return undefined;
  const actorToken = cookies[ACTOR_COOKIE];
  if (!actorToken) return 'admin';
  const match = actorToken.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const identifier = Buffer.from(match[1], 'base64url').toString('utf8').trim().toLowerCase();
  const expected = await actorTokenFor(identifier, secret);
  return await safeEqual(actorToken, expected) ? identifier : undefined;
}

async function validSession(token: string | undefined, secret: string): Promise<boolean> {
  const match = token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) return false;
  const expected = await sessionTokenFor(expiresAt, secret);
  return safeEqual(token ?? '', expected);
}

async function sessionTokenFor(expiresAt: number, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha256', secret).update(`admin:${expiresAt}`).digest('base64url');
  return `${expiresAt}.${signature}`;
}

async function actorTokenFor(identifier: string, secret: string): Promise<string> {
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

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
