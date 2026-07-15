import type { ProspectPageQuery, ProspectVisibility } from '@sales-automation/neon-state';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { applyWorkspacePageChrome, buildWorkspacePage, resolveWorkspacePage } from './workspace-pages.js';

interface WorkspaceSession { identifier: string; displayName: string }

export interface WorkspaceDashboardRuntimeInput {
  request: Request;
  originalUrl: string;
  databaseUrl: string;
  session: WorkspaceSession;
  adminPassword: string;
  sessionSecret: string;
}

export function isWorkspaceDashboardPath(pathname: string): boolean {
  return Boolean(resolveWorkspacePage(normalizePath(pathname)));
}

export async function handleWorkspaceDashboardRuntime(input: WorkspaceDashboardRuntimeInput): Promise<Response> {
  const neonState = await import('@sales-automation/neon-state');
  const prospectDiscovery = await import('@sales-automation/prospect-discovery');
  const storage = await import('@sales-automation/storage');
  const prospectHandler = await import('@sales-automation/web/prospect-handler');
  const portfolioCatalog = await import('@sales-automation/neon-state/portfolio-catalog');

  const url = new URL(input.originalUrl, 'https://local.invalid');
  const workspace = resolveWorkspacePage(normalizePath(url.pathname));
  if (!workspace) return Response.json({ error: 'Workspace page not found.' }, { status: 404 });

  const access = prospectHandler.resolveDashboardAccess(input.session.identifier, input.session.displayName);
  const visibility: ProspectVisibility = { canViewAll: access.scopeKind === 'all', ownerTokens: access.visibleOwnerTokens };
  const scopedRecords = await neonState.loadNeonScopedRecords(input.databaseUrl, visibility);
  const built = buildWorkspacePage(scopedRecords, pageQuery(url), workspace, url.searchParams.get('leadId') ?? undefined, new Date().toISOString());
  const repository = new storage.InMemoryLeadRepository(built.repositoryRecords);
  const before = snapshots(repository.listLeads());
  const runStore = new prospectDiscovery.InMemoryProspectDiscoveryRunStore(await neonState.loadNeonDiscoveryRuns(input.databaseUrl, 30));
  const approvedPortfolio = await portfolioCatalog.loadApprovedPortfolioCatalog(input.databaseUrl);
  const internalUrl = new URL('/prospects', 'https://local.invalid');
  for (const [key, value] of url.searchParams.entries()) internalUrl.searchParams.set(key, value);

  const result = await prospectHandler.handleProspectDashboardRequest({
    method: 'GET',
    url: `${internalUrl.pathname}${internalUrl.search}`,
    headers: Object.fromEntries(input.request.headers.entries()),
    clientKey: input.request.headers.get('x-forwarded-for') ?? input.request.headers.get('x-real-ip') ?? 'vercel-workspaces',
  }, {
    repository,
    runStore,
    portfolioItems: portfolioCatalog.asPortfolioItems(approvedPortfolio),
    adminPassword: input.adminPassword,
    sessionSecret: input.sessionSecret,
    secureCookies: true,
    actor: access.identifier,
    access,
    pagination: built.page,
  });

  if (result.status < 400) {
    const changed = repository.listLeads().filter((record) => before.get(record.lead.id) !== JSON.stringify(record));
    if (changed.length) await neonState.persistLeadRecords(input.databaseUrl, changed);
  }
  const body = (result.headers['content-type'] ?? '').includes('text/html')
    ? applyWorkspacePageChrome(result.body, workspace, built.page.summary)
    : result.body;
  return new Response(body, { status: result.status, headers: result.headers });
}

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

function snapshots(records: StoredLeadRecord[]): Map<string, string> {
  return new Map(records.map((record) => [record.lead.id, JSON.stringify(record)]));
}

function normalizePath(value: string): string {
  const pathname = value.startsWith('/') ? value : `/${value}`;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
