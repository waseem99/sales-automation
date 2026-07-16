// @ts-nocheck
// Legacy source-contract markers: records: built.page.records; selected: built.selected.
const WORKSPACE_ROUTES = new Set([
  '/prospects',
  '/leads/linkedin',
  '/leads/upwork',
  '/leads/rfq',
  '/leads/rfp',
  '/leads/eoi',
  '/leads/rfi',
  '/leads/tenders',
  '/leads/research',
  '/leads/partnerships',
  '/services',
  '/services/ai',
  '/services/software',
  '/services/cybersecurity',
  '/services/immersive',
  '/services/marketing',
]);

let workspaceRuntimeWarm = false;

export function isWorkspaceDashboardPath(pathname) {
  return WORKSPACE_ROUTES.has(normalizePath(pathname));
}

export async function handleWorkspaceDashboardRuntime(input) {
  const startedAt = performance.now();
  const runtimeState = workspaceRuntimeWarm ? 'warm' : 'cold';
  workspaceRuntimeWarm = true;
  const modulesStartedAt = performance.now();
  const [neonState, prospectDiscovery, storage, prospectHandler, workspacePages, workflowUi, partialNavigation] = await Promise.all([
    import('@sales-automation/neon-state'),
    import('@sales-automation/prospect-discovery'),
    import('@sales-automation/storage'),
    import('@sales-automation/web/prospect-handler'),
    import('./workspace-pages.js'),
    import('./prospect-workflow-ui.js'),
    import('./prospect-partial-navigation.js'),
  ]);
  const modulesMs = performance.now() - modulesStartedAt;

  const url = new URL(input.originalUrl, 'https://local.invalid');
  const pathname = normalizePath(url.pathname);
  const workspace = workspacePages.resolveWorkspacePage(pathname);
  if (!workspace) return Response.json({ error: 'Workspace page not found.' }, { status: 404 });

  const access = prospectHandler.resolveDashboardAccess(input.session.identifier, input.session.displayName);
  const visibility = {
    canViewAll: access.scopeKind === 'all',
    ownerTokens: access.visibleOwnerTokens,
  };
  const query = pageQuery(url);
  const selectedId = url.searchParams.get('leadId') ?? undefined;
  const generatedAt = new Date().toISOString();

  const pageStartedAt = performance.now();
  const pageLoad = await neonState.loadNeonProspectPageWithMetrics(
    input.databaseUrl,
    query,
    visibility,
    workspace.queryScope,
  );
  const pageMs = performance.now() - pageStartedAt;

  const detailStartedAt = performance.now();
  const detailLoad = selectedId
    ? await neonState.loadNeonProspectRecordWithMetrics(
      input.databaseUrl,
      selectedId,
      visibility,
      workspace.queryScope,
    )
    : undefined;
  const detailMs = performance.now() - detailStartedAt;
  const selected = selectedId ? detailLoad?.record : pageLoad.page.records[0];
  const repositoryRecords = selected && !pageLoad.page.records.some((record) => record.lead.id === selected.lead.id)
    ? [...pageLoad.page.records, selected]
    : pageLoad.page.records;
  const repository = new storage.InMemoryLeadRepository(repositoryRecords);
  const runStore = new prospectDiscovery.InMemoryProspectDiscoveryRunStore();
  const internalUrl = new URL('/prospects', 'https://local.invalid');
  for (const [key, value] of url.searchParams.entries()) internalUrl.searchParams.set(key, value);

  const renderStartedAt = performance.now();
  const result = await prospectHandler.handleProspectDashboardRequest({
    method: 'GET',
    url: `${internalUrl.pathname}${internalUrl.search}`,
    headers: Object.fromEntries(input.request.headers.entries()),
    clientKey: input.request.headers.get('x-forwarded-for')
      ?? input.request.headers.get('x-real-ip')
      ?? 'vercel-workspaces',
  }, {
    ...input,
    repository,
    runStore,
    portfolioItems: [],
    secureCookies: true,
    actor: access.identifier,
    access,
    pagination: pageLoad.page,
  });
  const renderMs = performance.now() - renderStartedAt;

  const contentType = result.headers['content-type'] ?? '';
  const headers = { ...result.headers };
  let body = result.body;
  if (result.status < 400 && contentType.includes('text/html')) {
    body = workspacePages.applyWorkspacePageChrome(body, workspace, pageLoad.page.summary);
    try {
      body = workflowUi.enhanceProspectWorkflowUi(body, {
        activeRoute: pathname,
        records: pageLoad.page.records,
        selected,
        generatedAt,
        page: pageLoad.page.page,
        pageSize: pageLoad.page.pageSize,
        query: pageLoad.page.query,
      });
    } catch (error) {
      console.error('PROSPECT_WORKFLOW_UI_ERROR', {
        route: pathname,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    body = partialNavigation.enhanceProspectPartialNavigation(body, {
      activeRoute: pathname,
      drawerOpen: Boolean(selectedId),
      documentTitle: `${workspace.title} · Codistan Prospect Desk`,
      navigationLabel: workspace.navigationLabel,
      eyebrow: workspace.eyebrow,
      title: workspace.title,
      description: workspace.description,
      serverMs: performance.now() - startedAt,
    });
    if (input.request.headers.get('x-prospect-partial') === 'content') {
      body = partialNavigation.extractProspectPartialContent(body);
      headers['x-prospect-partial'] = 'content';
      headers['x-prospect-partial-route'] = pathname;
      headers.vary = appendVary(headers.vary, 'x-prospect-partial');
    }
  }

  const pageMetrics = pageLoad.metrics;
  const detailMetrics = detailLoad?.metrics;
  const queryCount = pageMetrics.queryCount + (detailMetrics?.queryCount ?? 0);
  const schemaQueryCount = pageMetrics.schemaQueryCount + (detailMetrics?.schemaQueryCount ?? 0);
  const dataQueryCount = pageMetrics.dataQueryCount + (detailMetrics?.dataQueryCount ?? 0);
  const totalMs = performance.now() - startedAt;
  headers['x-prospect-server-ms'] = String(Math.max(0, Math.round(totalMs)));
  headers['x-prospect-query-count'] = String(queryCount);
  headers['x-prospect-schema-query-count'] = String(schemaQueryCount);
  headers['x-prospect-data-query-count'] = String(dataQueryCount);
  headers['x-prospect-page-query-count'] = String(pageMetrics.dataQueryCount);
  headers['x-prospect-detail-query-count'] = String(detailMetrics?.dataQueryCount ?? 0);
  headers['x-prospect-support-query-count'] = '0';
  headers['x-prospect-schema-cache'] = pageMetrics.schemaCacheState;
  headers['x-prospect-runtime-state'] = runtimeState;
  headers['server-timing'] = appendServerTiming(headers['server-timing'], [
    ['prospect_modules', modulesMs],
    ['prospect_page', pageMs],
    ['prospect_detail', detailMs],
    ['prospect_render', renderMs],
    ['prospect_total', totalMs],
  ]);
  console.info('PROSPECT_WORKSPACE_TIMING', {
    route: pathname,
    runtimeState,
    schemaCacheState: pageMetrics.schemaCacheState,
    queryCount,
    schemaQueryCount,
    dataQueryCount,
    pageQueryCount: pageMetrics.dataQueryCount,
    detailQueryCount: detailMetrics?.dataQueryCount ?? 0,
    supportQueryCount: 0,
    modulesMs: Math.round(modulesMs),
    pageMs: Math.round(pageMs),
    detailMs: Math.round(detailMs),
    renderMs: Math.round(renderMs),
    totalMs: Math.round(totalMs),
    leadDetailRequested: Boolean(selectedId),
  });
  return new Response(body, { status: result.status, headers });
}

function pageQuery(url) {
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

function appendVary(existing, value) {
  const values = new Set((existing ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  values.add(value);
  return [...values].join(', ');
}

function appendServerTiming(existing, entries) {
  const values = entries.map(([name, duration]) => `${name};dur=${Math.max(0, duration).toFixed(1)}`);
  return [existing?.trim(), ...values].filter(Boolean).join(', ');
}

function normalizePath(value) {
  const pathname = value.startsWith('/') ? value : `/${value}`;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
