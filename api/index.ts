import { samplePortfolioItems } from '../packages/fixtures/src/index.js';
import {
  InMemoryProspectDiscoveryRunStore,
} from '../packages/prospect-discovery/src/index.js';
import {
  InMemoryLeadRepository,
} from '../packages/storage/src/index.js';
import {
  loadNeonAppState,
  persistNeonAppState,
  requireDatabaseUrl,
  type NeonAppState,
} from '../packages/neon-state/src/index.js';
import {
  handleProspectDashboardRequest,
} from '../apps/web/src/prospect-handler.js';
import {
  getOriginalRequestUrl,
  parseRequestBody,
  requestHeaders,
  requireEnvironment,
  runVercelProspectDiscovery,
} from '../vercel/runtime.js';

export const maxDuration = 300;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const originalUrl = getOriginalRequestUrl(request);
      const pathname = new URL(originalUrl, 'https://local.invalid').pathname;
      const authOnly = pathname === '/login'
        || pathname === '/api/login'
        || pathname === '/api/logout'
        || pathname === '/health';
      const databaseUrl = process.env.DATABASE_URL;
      const state: NeonAppState = authOnly
        ? {
          repository: new InMemoryLeadRepository(),
          runStore: new InMemoryProspectDiscoveryRunStore(),
        }
        : await loadNeonAppState(requireDatabaseUrl(databaseUrl));

      const result = await handleProspectDashboardRequest({
        method: request.method,
        url: originalUrl,
        headers: requestHeaders(request),
        body: await parseRequestBody(request),
        clientKey: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'vercel',
      }, {
        repository: state.repository,
        runStore: state.runStore,
        portfolioItems: samplePortfolioItems,
        runDiscovery: authOnly ? undefined : () => runVercelProspectDiscovery(state.repository, state.runStore),
        adminPassword: requireEnvironment('ADMIN_PASSWORD'),
        sessionSecret: requireEnvironment('SESSION_SECRET'),
        secureCookies: true,
        actor: process.env.DASHBOARD_ACTOR ?? 'bd-team@codistan.org',
      });

      if (!authOnly && request.method !== 'GET' && request.method !== 'HEAD' && result.status < 400) {
        await persistNeonAppState(requireDatabaseUrl(databaseUrl), state);
      }

      return new Response(result.body, {
        status: result.status,
        headers: result.headers,
      });
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 500 });
    }
  },
};
