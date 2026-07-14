import { evaluateLead } from '@sales-automation/evaluator';
import { samplePortfolioItems, verifiedStarterProspects } from '@sales-automation/fixtures';
import {
  loadNeonAppState,
  loadNeonDiscoveryRuns,
  loadNeonProspectPage,
  loadNeonProspectRecord,
  loadNeonScopedRecords,
  persistDiscoveryRuns,
  persistLeadRecords,
  persistNeonAppState,
  requireDatabaseUrl,
  type ProspectPageQuery,
  type ProspectVisibility,
} from '@sales-automation/neon-state';
import {
  assignUnassignedProspects,
  collectPsebTechHubLeads,
  InMemoryProspectDiscoveryRunStore,
  runProspectDiscovery,
} from '@sales-automation/prospect-discovery';
import { InMemoryLeadRepository, type StoredLeadRecord } from '@sales-automation/storage';
import {
  handleProspectDashboardRequest,
  resolveDashboardAccess,
  type DashboardAccessScope,
} from '@sales-automation/web/prospect-handler';

interface RuntimeSession {
  identifier: string;
  displayName: string;
}

export interface AuthenticatedDashboardRuntimeInput {
  request: Request;
  originalUrl: string;
  session: RuntimeSession;
  adminPassword: string;
  sessionSecret: string;
}

const GLOBAL_ROUTES = new Set([
  '/api/prospects/import-starter',
  '/api/prospects/run',
  '/api/prospects/auto-assign',
  '/api/prospects/guidance/backfill',
  '/api/prospects/pseb-sync',
]);

export async function handleAuthenticatedDashboardRequest(input: AuthenticatedDashboardRuntimeInput): Promise<Response> {
  const databaseUrl = requireDatabaseUrl(process.env.DATABASE_URL);
  const url = new URL(input.originalUrl, 'https://local.invalid');
  const pathname = trimTrailingSlash(url.pathname) || '/';
  const method = input.request.method.toUpperCase();
  const access = resolveDashboardAccess(input.session.identifier, input.session.displayName);
  const visibility = toVisibility(access);
  const body = await parseRequestBody(input.request);

  if (method !== 'GET' && (GLOBAL_ROUTES.has(pathname) || pathname.startsWith('/api/ingest/') || pathname === '/api/dev/reset-local-data')) {
    if (!access.canRunGlobalOperations) return responseJson({ error: 'Forbidden: this operation is restricted to Admin and Waseem.' }, 403);
    return handleGlobalRequest({ ...input, body, pathname, databaseUrl, access });
  }

  const serviceMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/service$/);
  const followUpMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/followup$/);
  if (method === 'POST' && (serviceMatch || followUpMatch)) {
    const leadId = decodeURIComponent((serviceMatch ?? followUpMatch)?.[1] ?? '');
    const record = await loadNeonProspectRecord(databaseUrl, leadId, visibility);
    if (!record) return responseJson({ error: 'Prospect not found.' }, 404);
    const repository = new InMemoryLeadRepository([record]);
    const payload = asObject(body);
    if (serviceMatch) {
      const serviceCategory = requiredString(payload.serviceCategory, 'serviceCategory');
      const serviceOffer = requiredString(payload.serviceOffer, 'serviceOffer');
      const materialsToShare = requiredString(payload.materialsToShare, 'materialsToShare');
      repository.upsertLead({ ...record.lead, serviceCategory: serviceCategory as never, serviceOffer, materialsToShare, updatedAt: new Date().toISOString() }, access.identifier);
      repository.addNote(leadId, `service::${serviceCategory}::${serviceOffer}::${materialsToShare}`, access.identifier);
    } else {
      const nextFollowUpAt = requiredString(payload.nextFollowUpAt, 'nextFollowUpAt');
      const date = new Date(nextFollowUpAt);
      if (Number.isNaN(date.getTime())) return responseJson({ error: 'nextFollowUpAt must be a valid date and time.' }, 400);
      repository.scheduleFollowUp(leadId, { nextFollowUpAt: date.toISOString(), followUpNote: optionalString(payload.followUpNote) }, access.identifier);
    }
    await persistLeadRecords(databaseUrl, repository.listLeads());
    return responseJson({ ok: true, prospect: serializeRecord(repository.getLead(leadId)!) });
  }

  if (method === 'GET' && (pathname === '/' || pathname === '/prospects' || pathname === '/api/prospects')) {
    return handlePaginatedRead({ ...input, body, pathname, databaseUrl, access, visibility, url });
  }

  const leadId = extractLeadId(pathname);
  if (leadId) {
    const record = await loadNeonProspectRecord(databaseUrl, leadId, visibility);
    if (!record) return responseJson({ error: 'Prospect not found.' }, 404);
    return handleWithRecords({ ...input, body, databaseUrl, access, records: [record], runs: [], persistChanges: method !== 'GET' });
  }

  const scopedRecords = await loadNeonScopedRecords(databaseUrl, visibility);
  const runs = await loadNeonDiscoveryRuns(databaseUrl, 30);
  return handleWithRecords({ ...input, body, databaseUrl, access, records: scopedRecords, runs, persistChanges: method !== 'GET' });
}

async function handlePaginatedRead(input: AuthenticatedDashboardRuntimeInput & {
  body: unknown;
  pathname: string;
  databaseUrl: string;
  access: DashboardAccessScope;
  visibility: ProspectVisibility;
  url: URL;
}): Promise<Response> {
  const query = pageQuery(input.url);
  const page = await loadNeonProspectPage(input.databaseUrl, query, input.visibility);
  const selectedId = input.url.searchParams.get('leadId') ?? undefined;
  const selected = selectedId
    ? page.records.find((record) => record.lead.id === selectedId)
      ?? await loadNeonProspectRecord(input.databaseUrl, selectedId, input.visibility)
    : page.records[0];
  const repositoryRecords = selected && !page.records.some((record) => record.lead.id === selected.lead.id)
    ? [...page.records, selected]
    : page.records;
  const runs = await loadNeonDiscoveryRuns(input.databaseUrl, 30);
  const repository = new InMemoryLeadRepository(repositoryRecords);
  const before = snapshots(repository.listLeads());
  const runStore = new InMemoryProspectDiscoveryRunStore(runs);
  const result = await handleProspectDashboardRequest({
    method: input.request.method,
    url: input.originalUrl,
    headers: requestHeaders(input.request),
    body: input.body,
    clientKey: clientKey(input.request),
  }, {
    repository,
    runStore,
    portfolioItems: samplePortfolioItems,
    adminPassword: input.adminPassword,
    sessionSecret: input.sessionSecret,
    secureCookies: true,
    actor: input.access.identifier,
    access: input.access,
    pagination: { ...page, records: page.records },
  });
  await persistChangedRecords(input.databaseUrl, repository.listLeads(), before);
  return toResponse(result);
}

async function handleGlobalRequest(input: AuthenticatedDashboardRuntimeInput & {
  body: unknown;
  pathname: string;
  databaseUrl: string;
  access: DashboardAccessScope;
}): Promise<Response> {
  const state = await loadNeonAppState(input.databaseUrl);
  const beforeRuns = state.runStore.listRuns(180).map((run) => JSON.stringify(run));

  if (input.pathname === '/api/prospects/import-starter') {
    let imported = 0;
    let existing = 0;
    const generatedAt = new Date().toISOString();
    for (const lead of verifiedStarterProspects) {
      if (state.repository.getLead(lead.id)) { existing += 1; continue; }
      state.repository.saveEvaluation(evaluateLead({ lead, portfolioItems: samplePortfolioItems, generatedAt }), input.access.identifier);
      imported += 1;
    }
    await persistNeonAppState(input.databaseUrl, state);
    return responseJson({ ok: true, imported, existing, total: state.repository.listLeads().length }, imported > 0 ? 201 : 200);
  }

  if (input.pathname === '/api/prospects/auto-assign') {
    const assignment = assignUnassignedProspects(
      state.repository,
      new Date().toISOString(),
      input.access.identifier,
    );
    await persistAssignmentRecords(input.databaseUrl, state.repository, assignment.assignments.map((item) => item.leadId));
    return responseJson({
      ok: true,
      assigned: assignment.assigned,
      alreadyAssigned: assignment.alreadyAssigned,
      total: state.repository.listLeads().length,
      distribution: assignmentDistribution(assignment.assignments),
    }, assignment.assigned > 0 ? 201 : 200);
  }

  if (input.pathname === '/api/prospects/run') {
    const assignment = assignUnassignedProspects(
      state.repository,
      new Date().toISOString(),
      input.access.identifier,
    );
    await persistAssignmentRecords(input.databaseUrl, state.repository, assignment.assignments.map((item) => item.leadId));
  }

  const syncPseb = async () => {
    const collection = await collectPsebTechHubLeads(globalThis.fetch, new Date().toISOString(), 100);
    let imported = 0;
    let existing = 0;
    for (const lead of collection.leads) {
      if (state.repository.getLead(lead.id)) { existing += 1; continue; }
      state.repository.saveEvaluation(evaluateLead({ lead, portfolioItems: samplePortfolioItems, generatedAt: collection.checkedAt }), input.access.identifier);
      imported += 1;
    }
    return { imported, existing, checked: collection.leads.length, skippedLinks: collection.skippedLinks };
  };

  const result = await handleProspectDashboardRequest({
    method: input.request.method,
    url: input.originalUrl,
    headers: requestHeaders(input.request),
    body: input.body,
    clientKey: clientKey(input.request),
  }, {
    repository: state.repository,
    runStore: state.runStore,
    portfolioItems: samplePortfolioItems,
    runDiscovery: () => runProspectDiscovery(buildDiscoveryOptions(state.repository, state.runStore)),
    syncPseb,
    adminPassword: input.adminPassword,
    sessionSecret: input.sessionSecret,
    secureCookies: true,
    actor: input.access.identifier,
    access: input.access,
  });

  if (result.status < 400) {
    await persistLeadRecords(input.databaseUrl, state.repository.listLeads());
    const afterRuns = state.runStore.listRuns(180);
    if (afterRuns.some((run, index) => JSON.stringify(run) !== beforeRuns[index])) await persistDiscoveryRuns(input.databaseUrl, afterRuns);
  }
  return toResponse(result);
}

async function handleWithRecords(input: AuthenticatedDashboardRuntimeInput & {
  body: unknown;
  databaseUrl: string;
  access: DashboardAccessScope;
  records: StoredLeadRecord[];
  runs: ReturnType<InMemoryProspectDiscoveryRunStore['listRuns']>;
  persistChanges: boolean;
}): Promise<Response> {
  const repository = new InMemoryLeadRepository(input.records);
  const before = snapshots(repository.listLeads());
  const runStore = new InMemoryProspectDiscoveryRunStore(input.runs);
  const result = await handleProspectDashboardRequest({
    method: input.request.method,
    url: input.originalUrl,
    headers: requestHeaders(input.request),
    body: input.body,
    clientKey: clientKey(input.request),
  }, {
    repository,
    runStore,
    portfolioItems: samplePortfolioItems,
    adminPassword: input.adminPassword,
    sessionSecret: input.sessionSecret,
    secureCookies: true,
    actor: input.access.identifier,
    access: input.access,
  });
  if (result.status < 400 && input.persistChanges) await persistChangedRecords(input.databaseUrl, repository.listLeads(), before);
  return toResponse(result);
}

function buildDiscoveryOptions(repository: InMemoryLeadRepository, runStore: InMemoryProspectDiscoveryRunStore) {
  return {
    repository,
    runStore,
    portfolioItems: samplePortfolioItems,
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
  };
}

function toVisibility(access: DashboardAccessScope): ProspectVisibility {
  return { canViewAll: access.scopeKind === 'all', ownerTokens: access.visibleOwnerTokens };
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
  };
}

function extractLeadId(pathname: string): string | undefined {
  const match = pathname.match(/^\/api\/(?:prospects|opportunities)\/([^/]+)(?:\/|$)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function snapshots(records: StoredLeadRecord[]): Map<string, string> {
  return new Map(records.map((record) => [record.lead.id, JSON.stringify(record)]));
}

async function persistChangedRecords(databaseUrl: string, records: StoredLeadRecord[], before: Map<string, string>): Promise<void> {
  const changed = records.filter((record) => before.get(record.lead.id) !== JSON.stringify(record));
  if (changed.length > 0) await persistLeadRecords(databaseUrl, changed);
}

async function persistAssignmentRecords(
  databaseUrl: string,
  repository: InMemoryLeadRepository,
  leadIds: string[],
): Promise<void> {
  if (leadIds.length === 0) return;
  const records = leadIds
    .map((leadId) => repository.getLead(leadId))
    .filter((record): record is StoredLeadRecord => Boolean(record));
  await persistLeadRecords(databaseUrl, records);
}

function assignmentDistribution(assignments: Array<{ owner: string }>): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const assignment of assignments) {
    distribution[assignment.owner] = (distribution[assignment.owner] ?? 0) + 1;
  }
  return distribution;
}

function serializeRecord(record: StoredLeadRecord) {
  return { ...record.lead, notes: record.notes, auditLog: record.auditLog, evaluation: record.latestEvaluation };
}

function toResponse(result: { status: number; headers: Record<string, string>; body: string }): Response {
  return new Response(result.body, { status: result.status, headers: result.headers });
}

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function parseRequestBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const raw = await request.text();
  if (!raw) return undefined;
  if (raw.length > 1_000_000) throw new Error('Request body is too large.');
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { return { value: raw }; }
}

function requestHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(request.headers.entries());
}

function clientKey(request: Request): string {
  return request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'vercel';
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}
