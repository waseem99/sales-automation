import { samplePortfolioItems } from '@sales-automation/fixtures';
import {
  loadNeonDiscoveryRuns,
  loadNeonScopedRecords,
  persistLeadRecords,
  requireDatabaseUrl,
  type ProspectPageQuery,
  type ProspectVisibility,
} from '@sales-automation/neon-state';
import { InMemoryProspectDiscoveryRunStore } from '@sales-automation/prospect-discovery';
import { InMemoryLeadRepository, type StoredLeadRecord } from '@sales-automation/storage';
import {
  handleProspectDashboardRequest,
  resolveDashboardAccess,
} from '@sales-automation/web/prospect-handler';
import {
  applyWorkspacePageChrome,
  buildWorkspacePage,
  resolveWorkspacePage,
} from '../vercel/workspace-pages.js';
import { approvedStarterPortfolioItems } from '../vercel/approved-portfolio.js';
import {
  asPortfolioItems,
  ensurePortfolioCatalogSeeded,
  loadApprovedPortfolioCatalog,
  replacePortfolioArray,
} from '@sales-automation/neon-state/portfolio-catalog';

export const maxDuration = 300;
const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      const actor = await authorizedDashboardActor(request, sessionSecret);
      if (!actor) return redirect('/login');

      const incoming = new URL(request.url);
      const requestedPath = incoming.searchParams.get('__path') ?? incoming.pathname;
      const pathname = normalizePath(requestedPath);
      const workspace = resolveWorkspacePage(pathname);
      if (!workspace) return Response.json({ error: 'Workspace page not found.' }, { status: 404 });

      const databaseUrl = requireDatabaseUrl(process.env.DATABASE_URL);
      await ensurePortfolioCatalogSeeded(databaseUrl, approvedStarterPortfolioItems);
      const approvedPortfolio = await loadApprovedPortfolioCatalog(databaseUrl);
      replacePortfolioArray(samplePortfolioItems, asPortfolioItems(approvedPortfolio));

      const access = resolveDashboardAccess(actor, displayName(actor));
      const visibility: ProspectVisibility = {
        canViewAll: access.scopeKind === 'all',
        ownerTokens: access.visibleOwnerTokens,
      };
      const scopedRecords = await loadNeonScopedRecords(databaseUrl, visibility);
      const queryUrl = new URL(request.url);
      queryUrl.searchParams.delete('__path');
      const query = pageQuery(queryUrl);
      const selectedId = queryUrl.searchParams.get('leadId') ?? undefined;
      const generatedAt = new Date().toISOString();
      const built = buildWorkspacePage(scopedRecords, query, workspace, selectedId, generatedAt);
      const repository = new InMemoryLeadRepository(built.repositoryRecords);
      const before = snapshots(repository.listLeads());
      const runs = await loadNeonDiscoveryRuns(databaseUrl, 30);
      const runStore = new InMemoryProspectDiscoveryRunStore(runs);
      const internalUrl = new URL('/prospects', 'https://local.invalid');
      for (const [key, value] of queryUrl.searchParams.entries()) internalUrl.searchParams.set(key, value);

      const result = await handleProspectDashboardRequest({
        method: 'GET',
        url: `${internalUrl.pathname}${internalUrl.search}`,
        headers: Object.fromEntries(request.headers.entries()),
        clientKey: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'vercel-workspaces',
      }, {
        repository,
        runStore,
        portfolioItems: samplePortfolioItems,
        adminPassword: requireEnvironment('ADMIN_PASSWORD'),
        sessionSecret,
        secureCookies: true,
        actor: access.identifier,
        access,
        pagination: built.page,
      });

      if (result.status < 400) await persistChangedRecords(databaseUrl, repository.listLeads(), before);
      const contentType = result.headers['content-type'] ?? '';
      const body = contentType.includes('text/html')
        ? applyWorkspacePageChrome(result.body, workspace, built.page.summary)
        : result.body;
      return new Response(body, { status: result.status, headers: result.headers });
    } catch (error) {
      console.error('WORKSPACE_PAGES_RUNTIME_ERROR', error);
      return Response.json({
        error: 'Workspace page failed.',
        detail: error instanceof Error ? error.message : String(error),
      }, { status: 500 });
    }
  },
};

function pageQuery(url: URL): ProspectPageQuery {
  return {
    page: positiveInteger(url.searchParams.get('page'), 1),
    pageSize: positiveInteger(url.searchParams.get('pageSize'), 25),
    search: url.searchParams.get('search') ?? '',
    status: url.searchParams.get('status') ?? '',
    signal: url.searchParams.get('signal') ?? '',
    service: url.searchParams.get('service') ?? '',
    owner: url.searchParams.get('owner') ?? '',
    feedback: url.searchParams.get('feedback') ?? '',
    followUp: url.searchParams.get('followUp') ?? '',
  };
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

function displayName(identifier: string): string {
  const names: Record<string, string> = {
    admin: 'Administrator',
    'waseem@codistan.org': 'Waseem Khan',
    'talha.bashir@codistan.org': 'Talha Bashir',
    'jawad.jutt@codistan.org': 'Jawad Jutt',
    'moiz.khalid@codistan.org': 'Moiz Khalid',
    'subainaaamir@codistan.org': 'Subaina Aamir',
    'danishkhalid@codistan.org': 'Danish Khalid',
    'hibasohail@codistan.org': 'Hiba Sohail',
    'bilalahmed@codistan.org': 'Bilal Ahmed',
  };
  return names[identifier] ?? identifier;
}

function snapshots(records: StoredLeadRecord[]): Map<string, string> {
  return new Map(records.map((record) => [record.lead.id, JSON.stringify(record)]));
}

async function persistChangedRecords(
  databaseUrl: string,
  records: StoredLeadRecord[],
  before: Map<string, string>,
): Promise<void> {
  const changed = records.filter((record) => before.get(record.lead.id) !== JSON.stringify(record));
  if (changed.length > 0) await persistLeadRecords(databaseUrl, changed);
}

function normalizePath(value: string): string {
  const pathname = value.startsWith('/') ? value : `/${value}`;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function redirect(location: string): Response {
  return new Response('', {
    status: 302,
    headers: { location, 'cache-control': 'no-store' },
  });
}
