import { samplePortfolioItems } from '@sales-automation/fixtures';
import {
  loadNeonDiscoveryRuns,
  loadNeonScopedRecords,
  persistLeadRecords,
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
} from './workspace-pages.js';

interface WorkspaceSession {
  identifier: string;
  displayName: string;
}

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

export async function handleWorkspaceDashboardRuntime(
  input: WorkspaceDashboardRuntimeInput,
): Promise<Response> {
  const url = new URL(input.originalUrl, 'https://local.invalid');
  const pathname = normalizePath(url.pathname);
  const workspace = resolveWorkspacePage(pathname);
  if (!workspace) return Response.json({ error: 'Workspace page not found.' }, { status: 404 });

  const access = resolveDashboardAccess(input.session.identifier, input.session.displayName);
  const visibility: ProspectVisibility = {
    canViewAll: access.scopeKind === 'all',
    ownerTokens: access.visibleOwnerTokens,
  };
  const scopedRecords = await loadNeonScopedRecords(input.databaseUrl, visibility);
  const query = pageQuery(url);
  const selectedId = url.searchParams.get('leadId') ?? undefined;
  const generatedAt = new Date().toISOString();
  const built = buildWorkspacePage(scopedRecords, query, workspace, selectedId, generatedAt);
  const repository = new InMemoryLeadRepository(built.repositoryRecords);
  const before = snapshots(repository.listLeads());
  const runs = await loadNeonDiscoveryRuns(input.databaseUrl, 30);
  const runStore = new InMemoryProspectDiscoveryRunStore(runs);
  const internalUrl = new URL('/prospects', 'https://local.invalid');
  for (const [key, value] of url.searchParams.entries()) internalUrl.searchParams.set(key, value);

  const result = await handleProspectDashboardRequest({
    method: 'GET',
    url: `${internalUrl.pathname}${internalUrl.search}`,
    headers: Object.fromEntries(input.request.headers.entries()),
    clientKey: input.request.headers.get('x-forwarded-for')
      ?? input.request.headers.get('x-real-ip')
      ?? 'vercel-workspaces',
  }, {
    repository,
    runStore,
    portfolioItems: samplePortfolioItems,
    adminPassword: input.adminPassword,
    sessionSecret: input.sessionSecret,
    secureCookies: true,
    actor: access.identifier,
    access,
    pagination: built.page,
  });

  if (result.status < 400) {
    await persistChangedRecords(input.databaseUrl, repository.listLeads(), before);
  }
  const contentType = result.headers['content-type'] ?? '';
  const body = contentType.includes('text/html')
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
