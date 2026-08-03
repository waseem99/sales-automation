import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  attachBdWorkflow,
  bdWorkflowStateEqual,
  createBdTask,
  readBdWorkflow,
  recordBdPipelineEvent,
  refreshBdWorkflow,
  updateBdTask,
  type BdChannel,
  type BdTaskPriority,
  type BdTaskStatus,
} from '@sales-automation/bd-workflow';
import type { ProspectDiscoveryResult, ProspectDiscoveryRunStore } from '@sales-automation/prospect-discovery';
import {
  buildSellerQueueView,
  createSellerQueuePreferences,
  decodeSellerQueuePreferenceCookie,
  encodeSellerQueuePreferenceCookie,
  readCookieValue,
  SELLER_QUEUE_PREFERENCE_COOKIE,
} from '@sales-automation/seller-queues';
import type {
  ContactAccuracy,
  PipelineStatus,
  PortfolioItem,
  RepeatRecommendation,
  ServiceCategory,
  SourceQuality,
} from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';
import {
  applyFirstOutreachGuidance,
  applyReplyGuidance,
  auditMissingFirstOutreachGuidance,
} from './engagement-automation.js';
import { renderLoginPage, renderProspectDashboardPage } from './prospects-page.js';

const SESSION_COOKIE = 'codistan_admin_session';
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const loginAttempts = new Map<string, { count: number; firstAttemptAt: number }>();
let activeDiscoveryRun: Promise<ProspectDiscoveryResult> | undefined;

export interface ProspectDashboardContext {
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  runStore: ProspectDiscoveryRunStore;
  runDiscovery?: () => Promise<ProspectDiscoveryResult>;
  adminPassword: string;
  sessionSecret: string;
  secureCookies?: boolean;
  actor?: string;
  now?: () => string;
}

export interface ProspectDashboardRequest {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  clientKey?: string;
}

export interface ProspectDashboardResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function handleProspectDashboardRequest(
  request: ProspectDashboardRequest,
  context: ProspectDashboardContext,
): Promise<ProspectDashboardResponse> {
  validateContext(context);
  try {
    const url = new URL(request.url, 'http://localhost');
    const method = request.method.toUpperCase();
    const pathname = trimTrailingSlash(url.pathname) || '/';
    const actor = context.actor ?? 'admin@codistan.org';

    if (method === 'GET' && pathname === '/health') {
      return json({ ok: true, service: 'codistan-prospect-desk', now: now(context) });
    }

    if (method === 'GET' && pathname === '/login') return html(renderLoginPage());

    if (method === 'POST' && pathname === '/api/login') {
      const clientKey = request.clientKey ?? header(request.headers, 'x-forwarded-for') ?? 'unknown';
      if (isRateLimited(clientKey)) return json({ error: 'Too many failed attempts. Try again later.' }, 429);
      const password = requireString(asObject(request.body).password, 'password');
      if (!safeEqual(password, context.adminPassword)) {
        registerFailedAttempt(clientKey);
        return json({ error: 'Incorrect password.' }, 401);
      }
      loginAttempts.delete(clientKey);
      const expiresAt = Math.floor(Date.now() / 1_000) + SESSION_LIFETIME_SECONDS;
      return {
        status: 200,
        headers: {
          ...securityHeaders(),
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': buildSessionCookie(createSessionToken(expiresAt, context.sessionSecret), context.secureCookies ?? false),
          'cache-control': 'no-store',
        },
        body: JSON.stringify({ ok: true }),
      };
    }

    if (method === 'POST' && pathname === '/api/logout') {
      return {
        status: 200,
        headers: {
          ...securityHeaders(),
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${context.secureCookies ? '; Secure' : ''}`,
          'cache-control': 'no-store',
        },
        body: JSON.stringify({ ok: true }),
      };
    }

    if (!isAuthenticated(header(request.headers, 'cookie'), context.sessionSecret)) {
      return method === 'GET' && !pathname.startsWith('/api/')
        ? redirect('/login')
        : json({ error: 'Authentication required.' }, 401);
    }

    if (method === 'GET' && (pathname === '/' || pathname === '/prospects')) {
      const allRecords = context.repository.listLeads();
      const savedCookie = readCookieValue(header(request.headers, 'cookie'), SELLER_QUEUE_PREFERENCE_COOKIE);
      const saved = decodeSellerQueuePreferenceCookie(savedCookie, context.sessionSecret, actor);
      const generatedAt = now(context);
      const preferences = createSellerQueuePreferences({
        userId: actor,
        activeQueue: url.searchParams.get('queue') ?? saved?.activeQueue ?? 'follow_up_pending',
        sort: url.searchParams.get('sort') ?? saved?.sort ?? 'priority_desc',
        filters: {
          serviceCategory: url.searchParams.has('service') ? url.searchParams.get('service') : saved?.filters.serviceCategory,
          pipelineStatus: url.searchParams.has('status') ? url.searchParams.get('status') : saved?.filters.pipelineStatus,
          owner: url.searchParams.has('owner') ? url.searchParams.get('owner') : saved?.filters.owner,
          query: url.searchParams.has('q') ? url.searchParams.get('q') : saved?.filters.query,
        },
        savedAt: generatedAt,
      });
      const sellerQueue = buildSellerQueueView(allRecords, {
        activeQueue: preferences.activeQueue,
        sort: preferences.sort,
        filters: preferences.filters,
        generatedAt,
      });
      const selectedId = url.searchParams.get('leadId') ?? undefined;
      const selected = selectedId
        ? sellerQueue.records.find((record) => record.lead.id === selectedId)
        : sellerQueue.records[0];
      const response = html(renderProspectDashboardPage({
        records: sellerQueue.records,
        selected,
        runs: context.runStore.listRuns(20),
        generatedAt,
        sellerQueue,
        sellerUserId: actor,
      }));
      response.headers['set-cookie'] = `${SELLER_QUEUE_PREFERENCE_COOKIE}=${encodeURIComponent(encodeSellerQueuePreferenceCookie(preferences, context.sessionSecret))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${context.secureCookies ? "; Secure" : ""}`;
      return response;
    }

    if (method === 'GET' && pathname === '/api/seller-queues') {
      const generatedAt = now(context);
      const savedCookie = readCookieValue(header(request.headers, 'cookie'), SELLER_QUEUE_PREFERENCE_COOKIE);
      const saved = decodeSellerQueuePreferenceCookie(savedCookie, context.sessionSecret, actor)
        ?? createSellerQueuePreferences({userId: actor, activeQueue: 'follow_up_pending', sort: 'priority_desc', savedAt: generatedAt});
      const sellerQueue = buildSellerQueueView(context.repository.listLeads(), {
        activeQueue: saved.activeQueue,
        sort: saved.sort,
        filters: saved.filters,
        generatedAt,
      });
      return json({
        version: sellerQueue.version,
        activeQueue: sellerQueue.activeQueue,
        sort: sellerQueue.sort,
        filters: sellerQueue.filters,
        queues: sellerQueue.queues,
        leadIds: sellerQueue.records.map((record) => record.lead.id),
        countsReconciled: sellerQueue.countsReconciled,
        humanReviewRequired: true,
        externalActionAutomated: false,
      });
    }

    if (method === 'POST' && pathname === '/api/seller-queue-preferences') {
      const payload = asObject(request.body);
      const preferences = createSellerQueuePreferences({
        userId: actor,
        activeQueue: payload.activeQueue,
        sort: payload.sort,
        filters: payload.filters,
        savedAt: now(context),
      });
      const response = json({ok: true, preferences, externalActionAutomated: false}, 201);
      response.headers['set-cookie'] = `${SELLER_QUEUE_PREFERENCE_COOKIE}=${encodeURIComponent(encodeSellerQueuePreferenceCookie(preferences, context.sessionSecret))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${context.secureCookies ? "; Secure" : ""}`;
      return response;
    }

    if (method === 'GET' && pathname === '/api/prospects') {
      return json(context.repository.listLeads().map(serializeProspect));
    }

    if (method === 'GET' && pathname === '/api/prospect-runs') {
      return json(context.runStore.listRuns(30));
    }

    if (method === 'POST' && pathname === '/api/prospects/run') {
      if (!context.runDiscovery) return json({ error: 'Prospect discovery is not configured.' }, 503);
      if (!activeDiscoveryRun) activeDiscoveryRun = context.runDiscovery().finally(() => { activeDiscoveryRun = undefined; });
      const result = await activeDiscoveryRun;
      const engagementAudit = auditMissingFirstOutreachGuidance({
        repository: context.repository,
        portfolioItems: context.portfolioItems,
        actor: 'engagement-intelligence',
        generatedAt: now(context),
        leadIds: result.newLeads.map((lead) => lead.id),
      });
      const workflowAudit = backfillBdWorkflows(context.repository, actor, now(context), result.newLeads.map((lead) => lead.id));
      return json({
        run: result.run,
        newLeads: result.newLeads.map((lead) => lead.id),
        engagementAudit,
        workflowAudit,
      }, 201);
    }

    if (method === 'POST' && pathname === '/api/prospects/guidance/backfill') {
      const payload = asObject(request.body);
      const result = auditMissingFirstOutreachGuidance({
        repository: context.repository,
        portfolioItems: context.portfolioItems,
        actor: 'engagement-intelligence',
        generatedAt: now(context),
        force: payload.force === true || payload.force === 'true',
      });
      return json({ ok: true, ...result }, result.audited > 0 ? 201 : 200);
    }

    if (method === 'POST' && pathname === '/api/prospects/bd-workflow/backfill') {
      const result = backfillBdWorkflows(context.repository, actor, now(context));
      return json({ok: true, ...result}, result.updated > 0 ? 201 : 200);
    }

    const guidanceMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/guidance\/(first-outreach|reply)$/);
    if (method === 'POST' && guidanceMatch) {
      const leadId = decodeURIComponent(guidanceMatch[1] ?? '');
      const guidanceType = guidanceMatch[2];
      const existing = context.repository.getLead(leadId);
      if (!existing) return json({ error: 'Prospect not found.' }, 404);
      const generatedAt = now(context);

      if (guidanceType === 'first-outreach') {
        const applied = applyFirstOutreachGuidance({
          repository: context.repository,
          record: existing,
          portfolioItems: context.portfolioItems,
          actor,
          generatedAt,
        });
        const refreshed = refreshWorkflowRecord(context.repository, leadId, actor, generatedAt, 'First-outreach guidance was regenerated for human review.');
        return json({ guidance: applied.guidance, prospect: serializeProspect(refreshed) }, 201);
      }

      const payload = asObject(request.body);
      const replyBody = requireString(payload.replyBody, 'replyBody');
      const applied = applyReplyGuidance({
        repository: context.repository,
        record: existing,
        replyBody,
        channel: requireString(payload.channel ?? 'email', 'channel'),
        actor,
        generatedAt,
      });
      const refreshed = refreshWorkflowRecord(context.repository, leadId, actor, generatedAt, 'Buyer reply guidance was generated for human review.');
      return json({ guidance: applied.guidance, prospect: serializeProspect(refreshed) }, 201);
    }

    const taskCollectionMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/tasks$/);
    if (method === 'POST' && taskCollectionMatch) {
      const leadId = decodeURIComponent(taskCollectionMatch[1] ?? '');
      const existing = context.repository.getLead(leadId);
      if (!existing) return json({error: 'Prospect not found.'}, 404);
      const payload = asObject(request.body);
      const generatedAt = now(context);
      const snapshot = createBdTask(existing.lead, {
        title: requireString(payload.title, 'title'),
        reason: requireString(payload.reason, 'reason'),
        priority: optionalBdTaskPriority(payload.priority),
        channel: optionalBdChannel(payload.channel),
        dueAt: optionalString(payload.dueAt),
        owner: optionalString(payload.owner),
        note: optionalString(payload.note),
      }, actor, generatedAt);
      const record = saveWorkflowSnapshot(context.repository, leadId, snapshot, actor, `bd_task_created::${snapshot.tasks.at(-1)?.id ?? 'task'}::${payload.title}`);
      return json({ok: true, workflow: snapshot, prospect: serializeProspect(record)}, 201);
    }

    const taskActionMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/tasks\/([^/]+)\/(start|complete|hold|reopen|dismiss)$/);
    if (method === 'POST' && taskActionMatch) {
      const leadId = decodeURIComponent(taskActionMatch[1] ?? '');
      const taskId = decodeURIComponent(taskActionMatch[2] ?? '');
      const verb = taskActionMatch[3] ?? '';
      const existing = context.repository.getLead(leadId);
      if (!existing) return json({error: 'Prospect not found.'}, 404);
      const payload = asObject(request.body);
      const generatedAt = now(context);
      const snapshot = updateBdTask(existing.lead, taskId, {
        status: taskStatusForVerb(verb),
        note: optionalString(payload.note),
        dueAt: payload.dueAt === undefined ? undefined : optionalString(payload.dueAt),
        owner: payload.owner === undefined ? undefined : optionalString(payload.owner),
      }, actor, generatedAt);
      const record = saveWorkflowSnapshot(context.repository, leadId, snapshot, actor, `bd_task_${verb}::${taskId}`);
      return json({ok: true, workflow: snapshot, prospect: serializeProspect(record)});
    }

    const nextActionMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/next-action$/);
    if (method === 'POST' && nextActionMatch) {
      const leadId = decodeURIComponent(nextActionMatch[1] ?? '');
      const existing = context.repository.getLead(leadId);
      if (!existing) return json({error: 'Prospect not found.'}, 404);
      const generatedAt = now(context);
      const record = refreshWorkflowRecord(context.repository, leadId, actor, generatedAt, 'Next-best-action guidance was manually refreshed.');
      return json({ok: true, workflow: readBdWorkflow(record.lead), prospect: serializeProspect(record)});
    }

    const actionMatch = pathname.match(/^\/api\/prospects\/([^/]+)\/(status|owner|activity|feedback)$/);
    if (method === 'POST' && actionMatch) {
      const leadId = decodeURIComponent(actionMatch[1] ?? '');
      const action = actionMatch[2];
      const payload = asObject(request.body);
      const existing = context.repository.getLead(leadId);
      if (!existing) return json({ error: 'Prospect not found.' }, 404);
      const generatedAt = now(context);

      if (action === 'status') {
        const status = requirePipelineStatus(payload.status);
        if (['won', 'lost', 'rejected'].includes(status) && existing.lead.feedback?.status !== 'complete') {
          return json({ error: 'Complete the required BD feedback before marking this prospect won, lost, or rejected.' }, 400);
        }
        context.repository.updateStatus(leadId, status, actor);
        const record = refreshWorkflowRecord(context.repository, leadId, actor, generatedAt, `Pipeline stage changed to ${status}.`);
        return json(serializeProspect(record));
      }

      if (action === 'owner') {
        const owner = requireString(payload.owner, 'owner');
        context.repository.assignOwner(leadId, owner, actor);
        const record = refreshWorkflowRecord(context.repository, leadId, actor, generatedAt, `Prospect ownership changed to ${owner}.`);
        return json(serializeProspect(record));
      }

      if (action === 'feedback') {
        const relevanceRating = requireRating(payload.relevanceRating);
        const contactAccuracy = requireEnum<ContactAccuracy>(payload.contactAccuracy, 'contactAccuracy', ['accurate', 'partially_accurate', 'wrong', 'missing']);
        const sourceQuality = requireEnum<SourceQuality>(payload.sourceQuality, 'sourceQuality', ['high', 'medium', 'low']);
        const repeatRecommendation = requireEnum<RepeatRecommendation>(payload.repeatRecommendation, 'repeatRecommendation', ['increase', 'keep', 'reduce', 'stop']);
        const correctedServiceCategory = optionalEnum<ServiceCategory>(payload.correctedServiceCategory, [
          'ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'fullstack_web_app',
          'nextjs_python_app', 'voice_ai_agent', 'ar_3d_unity_unreal', 'cybersecurity_compliance',
          'website_portal', 'enterprise_systems', 'unknown',
        ]);
        const reason = requireString(payload.reason, 'reason');
        if (reason.length < 10) return json({ error: 'Feedback reason must contain at least 10 characters.' }, 400);
        const recordedAt = generatedAt;
        const updatedLead = {
          ...existing.lead,
          serviceCategory: correctedServiceCategory ?? existing.lead.serviceCategory,
          feedback: {
            status: 'complete' as const,
            relevanceRating,
            contactAccuracy,
            sourceQuality,
            repeatRecommendation,
            correctedServiceCategory,
            reason,
            recordedBy: actor,
            recordedAt,
          },
          updatedAt: recordedAt,
        };
        context.repository.upsertLead(updatedLead, actor);
        context.repository.addNote(leadId, `feedback::${relevanceRating}::${sourceQuality}::${repeatRecommendation}::${reason}`, actor);
        const record = refreshWorkflowRecord(context.repository, leadId, actor, generatedAt, 'Commercial feedback was completed.');
        return json(serializeProspect(record));
      }

      const type = requireActivityType(payload.type);
      const channel = requireString(payload.channel ?? 'internal', 'channel');
      const activityBody = requireString(payload.body, 'body');
      if (activityBody.length < 5) return json({ error: 'Activity details must contain at least 5 characters.' }, 400);
      const occurredAt = generatedAt;

      if (type === 'response') {
        const applied = applyReplyGuidance({
          repository: context.repository,
          record: existing,
          replyBody: activityBody,
          channel,
          actor,
          generatedAt: occurredAt,
        });
        const refreshed = refreshWorkflowRecord(context.repository, leadId, actor, occurredAt, `Buyer response recorded through ${channel}.`);
        return json({
          ...serializeProspect(refreshed),
          replyGuidance: applied.guidance,
        });
      }

      const leadUpdate = { ...existing.lead, updatedAt: occurredAt };
      if (type === 'outreach') leadUpdate.lastContactedAt = occurredAt;
      context.repository.upsertLead(leadUpdate, actor);
      let record = context.repository.addNote(leadId, `activity::${type}::${channel}::${activityBody}`, actor);
      const nextStatus = activityStatus(type);
      if (nextStatus && record.lead.pipelineStatus !== nextStatus) record = context.repository.updateStatus(leadId, nextStatus, actor);
      record = refreshWorkflowRecord(context.repository, leadId, actor, occurredAt, `${labelActivity(type)} recorded through ${channel}.`);
      return json(serializeProspect(record));
    }

    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    return json({ error: (error as Error).message }, errorStatus(error));
  }
}

function backfillBdWorkflows(repository: LeadRepository, actor: string, generatedAt: string, leadIds?: string[]): {checked: number; updated: number; skipped: number} {
  const records = leadIds?.length
    ? leadIds.map((leadId) => repository.getLead(leadId)).filter((record): record is StoredLeadRecord => Boolean(record))
    : repository.listLeads();
  let updated = 0;
  let skipped = 0;
  for (const record of records) {
    const previous = readBdWorkflow(record.lead);
    const snapshot = refreshBdWorkflow(record.lead, generatedAt, actor);
    if (bdWorkflowStateEqual(previous, snapshot)) {
      skipped += 1;
      continue;
    }
    saveWorkflowSnapshot(repository, record.lead.id, snapshot, actor, `bd_workflow_backfilled::${snapshot.nextBestAction.code}`);
    updated += 1;
  }
  return {checked: records.length, updated, skipped};
}

function refreshWorkflowRecord(repository: LeadRepository, leadId: string, actor: string, generatedAt: string, summary: string): StoredLeadRecord {
  const record = repository.getLead(leadId);
  if (!record) throw new Error(`Prospect not found: ${leadId}`);
  const previous = readBdWorkflow(record.lead);
  const snapshot = recordBdPipelineEvent(record.lead, summary, actor, generatedAt);
  if (bdWorkflowStateEqual(previous, snapshot)) return record;
  return saveWorkflowSnapshot(repository, leadId, snapshot, actor, `bd_workflow_event::${snapshot.nextBestAction.code}::${summary}`);
}

function saveWorkflowSnapshot(repository: LeadRepository, leadId: string, snapshot: ReturnType<typeof refreshBdWorkflow>, actor: string, auditNote: string): StoredLeadRecord {
  const record = repository.getLead(leadId);
  if (!record) throw new Error(`Prospect not found: ${leadId}`);
  repository.upsertLead(attachBdWorkflow(record.lead, snapshot), actor);
  const updated = repository.getLead(leadId)!;
  if (!updated.notes.includes(auditNote)) repository.addNote(leadId, auditNote, actor);
  return repository.getLead(leadId)!;
}

function serializeProspect(record: StoredLeadRecord) {
  return { ...record.lead, notes: record.notes, auditLog: record.auditLog, evaluation: record.latestEvaluation };
}

function activityStatus(type: ActivityType): PipelineStatus | undefined {
  if (type === 'outreach') return 'sent_manually';
  if (type === 'meeting') return 'meeting_booked';
  if (type === 'proposal') return 'proposal_sent';
  return undefined;
}

function labelActivity(type: ActivityType): string {
  if (type === 'outreach') return 'Manual outreach';
  if (type === 'meeting') return 'Meeting';
  if (type === 'proposal') return 'Proposal';
  return 'Internal activity';
}

type ActivityType = 'comment' | 'outreach' | 'response' | 'meeting' | 'proposal';

function requireActivityType(value: unknown): ActivityType {
  return requireEnum<ActivityType>(value, 'type', ['comment', 'outreach', 'response', 'meeting', 'proposal']);
}

function taskStatusForVerb(value: string): BdTaskStatus {
  const map: Record<string, BdTaskStatus> = {
    start: 'in_progress',
    complete: 'completed',
    hold: 'on_hold',
    reopen: 'open',
    dismiss: 'dismissed',
  };
  const status = map[value];
  if (!status) throw new Error('task action is invalid.');
  return status;
}

function optionalBdTaskPriority(value: unknown): BdTaskPriority | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireEnum<BdTaskPriority>(value, 'priority', ['critical', 'high', 'normal', 'low']);
}

function optionalBdChannel(value: unknown): BdChannel | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireEnum<BdChannel>(value, 'channel', ['internal', 'upwork', 'linkedin', 'sales_navigator', 'email', 'referral', 'meeting']);
}

function requirePipelineStatus(value: unknown): PipelineStatus {
  return requireEnum<PipelineStatus>(value, 'status', [
    'new', 'scored', 'needs_research', 'hot_alert_sent', 'needs_human_review', 'approved_to_contact',
    'draft_ready', 'sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost',
    'rejected', 'archived',
  ]);
}

function requireRating(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const rating = Number(value);
  if (![1, 2, 3, 4, 5].includes(rating)) throw new Error('relevanceRating must be between 1 and 5.');
  return rating as 1 | 2 | 3 | 4 | 5;
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const result = requireString(value, field) as T;
  if (!allowed.includes(result)) throw new Error(`${field} is invalid.`);
  return result;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const result = String(value) as T;
  if (!allowed.includes(result)) throw new Error('correctedServiceCategory is invalid.');
  return result;
}

function validateContext(context: ProspectDashboardContext): void {
  if (!context.adminPassword) throw new Error('ADMIN_PASSWORD is required.');
  if (!context.sessionSecret || context.sessionSecret.length < 24) throw new Error('SESSION_SECRET must contain at least 24 characters.');
}

function now(context: ProspectDashboardContext): string {
  return context.now?.() ?? new Date().toISOString();
}

function createSessionToken(expiresAt: number, secret: string): string {
  const payload = `admin:${expiresAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${expiresAt}.${signature}`;
}

function isAuthenticated(cookieHeader: string | undefined, secret: string): boolean {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return false;
  const match = token.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) return false;
  return safeEqual(token, createSessionToken(expiresAt, secret));
}

function buildSessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_SECONDS}${secure ? '; Secure' : ''}`;
}

function parseCookies(value: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of value?.split(';') ?? []) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  }
  return cookies;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isRateLimited(key: string): boolean {
  const state = loginAttempts.get(key);
  if (!state) return false;
  if (Date.now() - state.firstAttemptAt > 15 * 60 * 1_000) {
    loginAttempts.delete(key);
    return false;
  }
  return state.count >= 5;
}

function registerFailedAttempt(key: string): void {
  const existing = loginAttempts.get(key);
  if (!existing || Date.now() - existing.firstAttemptAt > 15 * 60 * 1_000) {
    loginAttempts.set(key, { count: 1, firstAttemptAt: Date.now() });
  } else {
    existing.count += 1;
  }
}

function header(headers: ProspectDashboardRequest['headers'], name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function securityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
}

function html(body: string, status = 200): ProspectDashboardResponse {
  return { status, headers: { ...securityHeaders(), 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body };
}

function json(value: unknown, status = 200): ProspectDashboardResponse {
  return { status, headers: { ...securityHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(value) };
}

function redirect(location: string): ProspectDashboardResponse {
  return { status: 302, headers: { ...securityHeaders(), location, 'cache-control': 'no-store' }, body: '' };
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function errorStatus(error: unknown): number {
  const message = (error as Error).message.toLowerCase();
  if (message.includes('required') || message.includes('invalid') || message.includes('must contain') || message.includes('between') || message.includes('valid date')) return 400;
  if (message.includes('not found')) return 404;
  return 500;
}
