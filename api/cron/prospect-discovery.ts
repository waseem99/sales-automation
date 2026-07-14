export const maxDuration = 300;

export default {
  async fetch(request: Request): Promise<Response> {
    let phase = 'request_received';
    let databaseUrl: string | undefined;
    let lockToken: string | undefined;
    let neonModule: Awaited<ReturnType<typeof loadNeonModule>> | undefined;

    try {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }

      phase = 'validate_cron_secret';
      const cronSecret = requireEnvironment('CRON_SECRET');
      if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return Response.json({ error: 'Unauthorized.' }, { status: 401 });
      }

      phase = 'load_runtime_modules';
      const [{ randomUUID }, loadedNeonModule, prospectModule, fixturesModule, catalogModule, starterModule] = await Promise.all([
        import('node:crypto'),
        loadNeonModule(),
        import('@sales-automation/prospect-discovery'),
        import('@sales-automation/fixtures'),
        import('@sales-automation/neon-state/portfolio-catalog'),
        import('../../vercel/approved-portfolio.js'),
      ]);
      neonModule = loadedNeonModule;

      phase = 'connect_database';
      databaseUrl = neonModule.requireDatabaseUrl(process.env.DATABASE_URL);
      lockToken = randomUUID();
      const locked = await neonModule.acquireProspectRunLock(databaseUrl, lockToken, 10);
      if (!locked) {
        return Response.json({ ok: true, skipped: true, reason: 'Another discovery run is active.' });
      }

      phase = 'load_portfolio_catalog';
      await catalogModule.ensurePortfolioCatalogSeeded(databaseUrl, starterModule.approvedStarterPortfolioItems);
      const approvedPortfolio = await catalogModule.loadApprovedPortfolioCatalog(databaseUrl);
      catalogModule.replacePortfolioArray(fixturesModule.samplePortfolioItems, catalogModule.asPortfolioItems(approvedPortfolio));

      phase = 'load_application_state';
      const state = await neonModule.loadNeonAppState(databaseUrl);

      phase = 'run_prospect_discovery';
      const result = await prospectModule.runProspectDiscovery(buildDiscoveryOptions(
        state.repository,
        state.runStore,
        fixturesModule.samplePortfolioItems,
      ));

      phase = 'persist_application_state';
      await neonModule.persistNeonAppState(databaseUrl, state);

      return Response.json({
        ok: true,
        run: result.run,
        approvedPortfolioCount: approvedPortfolio.length,
        newLeadIds: result.newLeads.map((lead) => lead.id),
      });
    } catch (error) {
      const details = normalizeError(error);
      console.error('VERCEL_CRON_RUNTIME_ERROR', {
        phase,
        message: details.message,
        stack: details.stack,
      });
      return Response.json({
        error: 'Prospect discovery cron failed.',
        phase,
        detail: details.message,
      }, { status: 500 });
    } finally {
      if (neonModule && databaseUrl && lockToken) {
        await neonModule.releaseProspectRunLock(databaseUrl, lockToken).catch((error: unknown) => {
          console.error('VERCEL_CRON_LOCK_RELEASE_ERROR', normalizeError(error));
        });
      }
    }
  },
};

async function loadNeonModule() {
  return import('@sales-automation/neon-state');
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

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}
