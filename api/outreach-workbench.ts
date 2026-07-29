import { createHmac, timingSafeEqual } from 'node:crypto';
import { attachBdWorkflow, recordBdPipelineEvent } from '@sales-automation/bd-workflow';
import {
  assertCommerciallyReadyForApproval,
  evaluateCommercialReadiness,
} from '@sales-automation/commercial-readiness';
import { loadNeonProspectRecord, persistLeadRecords, requireDatabaseUrl, type ProspectVisibility } from '@sales-automation/neon-state';
import {
  approveOutreachDraft,
  attachOutreachWorkbench,
  createManualDraft,
  editOutreachDraft,
  initializeOutreachWorkbench,
  markDraftSentManually,
  readOutreachWorkbench,
  recordDraftCopied,
  rejectOutreachDraft,
  requestDraftChanges,
  submitDraftForReview,
  type OutreachChannel,
  type OutreachWorkbenchSnapshot,
} from '@sales-automation/outreach-workbench';
import { InMemoryLeadRepository } from '@sales-automation/storage';

export const maxDuration = 300;
const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';
const MAX_REQUEST_BYTES = 1_000_000;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const secret = requireEnvironment('SESSION_SECRET');
      if (!(await isAuthenticated(request.headers.get('cookie'), secret))) return json({error: 'Authentication required.'}, 401);
      const actor = await verifyActorToken(parseCookies(request.headers.get('cookie') ?? undefined)[ACTOR_COOKIE], secret) ?? 'admin';
      const url = originalUrl(request);
      const pathname = trimTrailingSlash(url.pathname);
      const match = pathname.match(/^\/api\/outreach-workbench\/([^/]+)(?:\/drafts(?:\/([^/]+)\/(edit|submit|changes|approve|copy|sent|reject))?)?$/);
      if (!match?.[1]) return json({error: 'Not found.'}, 404);
      const leadId = decodeURIComponent(match[1]);
      const draftId = match[2] ? decodeURIComponent(match[2]) : undefined;
      const action = match[3];
      const databaseUrl = requireDatabaseUrl(process.env.DATABASE_URL);
      const record = await loadNeonProspectRecord(databaseUrl, leadId, visibility(actor));
      if (!record) return json({error: 'Prospect not found or not visible to this account.'}, 404);
      const commercialReadiness = evaluateCommercialReadiness(record.lead);

      if (request.method === 'GET') {
        return json({
          leadId,
          workflow: readOutreachWorkbench(record.lead),
          generatedDraftCount: record.latestEvaluation?.drafts.length ?? 0,
          commercialReadiness,
          humanReviewRequired: true,
          automaticSendingEnabled: false,
        });
      }
      if (request.method !== 'POST') return json({error: 'Method not allowed.'}, 405, {allow: 'GET, POST'});
      const payload = asObject(await parseBody(request));
      const generatedAt = new Date().toISOString();
      let snapshot: OutreachWorkbenchSnapshot;
      const existing = readOutreachWorkbench(record.lead);

      if (!draftId && pathname.endsWith('/drafts')) {
        snapshot = createManualDraft(record.lead, {
          channel: requireChannel(payload.channel),
          subject: optionalString(payload.subject),
          body: requireString(payload.body, 'body'),
          assumptions: stringArray(payload.assumptions),
          safeguards: stringArray(payload.safeguards),
        }, actor, generatedAt);
      } else if (!draftId) {
        snapshot = existing ?? initializeOutreachWorkbench(record.lead, record.latestEvaluation?.drafts ?? [], actor, generatedAt);
      } else {
        if (!existing) return json({error: 'Initialize the outreach workbench before editing a draft.'}, 409);
        if (action === 'edit') {
          snapshot = editOutreachDraft(record.lead, draftId, {
            subject: optionalString(payload.subject),
            body: requireString(payload.body, 'body'),
            changeNote: optionalString(payload.changeNote),
          }, actor, generatedAt);
        } else if (action === 'submit') {
          snapshot = submitDraftForReview(record.lead, draftId, actor, generatedAt);
        } else if (action === 'changes') {
          snapshot = requestDraftChanges(record.lead, draftId, requireString(payload.note, 'note'), actor, generatedAt);
        } else if (action === 'approve') {
          assertCommerciallyReadyForApproval(record.lead);
          snapshot = approveOutreachDraft(record.lead, draftId, optionalString(payload.note), actor, generatedAt);
        } else if (action === 'copy') {
          snapshot = recordDraftCopied(record.lead, draftId, actor, generatedAt);
        } else if (action === 'sent') {
          snapshot = markDraftSentManually(record.lead, draftId, {
            revisionId: requireString(payload.revisionId, 'revisionId'),
            sentAt: optionalString(payload.sentAt),
            destinationLabel: optionalString(payload.destinationLabel),
            externalReference: optionalString(payload.externalReference),
          }, actor, generatedAt);
        } else if (action === 'reject') {
          snapshot = rejectOutreachDraft(record.lead, draftId, requireString(payload.note, 'note'), actor, generatedAt);
        } else {
          return json({error: 'Draft action is invalid.'}, 400);
        }
      }

      const repository = new InMemoryLeadRepository([record]);
      let updatedLead = attachOutreachWorkbench(record.lead, snapshot);
      if (action === 'sent') {
        updatedLead = {
          ...updatedLead,
          pipelineStatus: 'sent_manually',
          lastContactedAt: generatedAt,
          updatedAt: generatedAt,
        };
        const bd = recordBdPipelineEvent(updatedLead, 'Approved outreach revision was manually marked as sent.', actor, generatedAt);
        updatedLead = attachBdWorkflow(updatedLead, bd);
      }
      repository.upsertLead(updatedLead, actor);
      repository.addNote(leadId, `outreach_workbench::${action ?? (existing ? 'read' : 'initialized')}::${snapshot.drafts.length}`, actor);
      const updated = repository.getLead(leadId)!;
      await persistLeadRecords(databaseUrl, [updated]);
      return json({
        ok: true,
        leadId,
        pipelineStatus: updated.lead.pipelineStatus,
        workflow: snapshot,
        commercialReadiness: evaluateCommercialReadiness(updated.lead),
        humanReviewRequired: true,
        automaticSendingEnabled: false,
        externalActionPerformedBySystem: false,
      }, existing ? 200 : 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({error: message, humanReviewRequired: true, automaticSendingEnabled: false}, errorStatus(message));
    }
  },
};

function originalUrl(request: Request): URL {
  const url = new URL(request.url);
  const rewritten = url.searchParams.get('__path');
  if (rewritten) {
    url.pathname = rewritten.startsWith('/') ? rewritten : `/${rewritten}`;
    url.searchParams.delete('__path');
  }
  return url;
}

function visibility(actor: string): ProspectVisibility {
  const normalized = actor.trim().toLowerCase();
  if (normalized === 'admin' || normalized === 'waseem@codistan.org') return {canViewAll: true, ownerTokens: []};
  const localPart = normalized.split('@')[0] ?? normalized;
  return {canViewAll: false, ownerTokens: [normalized, localPart, localPart.replace(/[._-]+/g, ' ')]};
}

async function parseBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  const raw = await request.text();
  if (!raw) return {};
  if (raw.length > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { throw new Error('Request body must be valid JSON.'); }
}

function requireChannel(value: unknown): OutreachChannel {
  const channel = requireString(value, 'channel') as OutreachChannel;
  const allowed: OutreachChannel[] = ['upwork', 'linkedin_comment', 'linkedin_dm', 'email', 'partner', 'other'];
  if (!allowed.includes(channel)) throw new Error('channel is invalid.');
  return channel;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}
function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function stringArray(value: unknown): string[] | undefined { return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : undefined; }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function trimTrailingSlash(value: string): string { return value.length > 1 ? value.replace(/\/+$/, '') : value; }
function requireEnvironment(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required.`); return value; }
function parseCookies(value: string | undefined): Record<string, string> { const cookies: Record<string, string> = {}; for (const part of value?.split(';') ?? []) { const [name, ...rest] = part.trim().split('='); if (name) cookies[name] = rest.join('='); } return cookies; }
function createSessionToken(expiresAt: number, secret: string): string { return `${expiresAt}.${createHmac('sha256', secret).update(`admin:${expiresAt}`).digest('base64url')}`; }
function createActorToken(identifier: string, secret: string): string { const encoded = Buffer.from(identifier, 'utf8').toString('base64url'); return `${encoded}.${createHmac('sha256', secret).update(`actor:${encoded}`).digest('base64url')}`; }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function isAuthenticated(cookieHeader: string | null, secret: string): boolean { const token = parseCookies(cookieHeader ?? undefined)[SESSION_COOKIE]; const match = token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/); if (!match?.[1]) return false; const expiresAt = Number(match[1]); return Number.isFinite(expiresAt) && expiresAt > Math.floor(Date.now() / 1000) && safeEqual(token ?? '', createSessionToken(expiresAt, secret)); }
function verifyActorToken(token: string | undefined, secret: string): string | undefined { const match = token?.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/); if (!match?.[1]) return undefined; const identifier = Buffer.from(match[1], 'base64url').toString('utf8').trim().toLowerCase(); return safeEqual(token ?? '', createActorToken(identifier, secret)) ? identifier : undefined; }
function errorStatus(message: string): number { const value = message.toLowerCase(); if (value.includes('not found')) return 404; if (value.includes('immutable') || value.includes('approved') || value.includes('initialize') || value.includes('commercial approval blocked')) return 409; if (value.includes('required') || value.includes('invalid') || value.includes('at most') || value.includes('valid date')) return 400; return 500; }
function securityHeaders(): Record<string, string> { return {'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"}; }
function json(value: unknown, status = 200, extra: Record<string, string> = {}): Response { return new Response(JSON.stringify(value), {status, headers: {...securityHeaders(), ...extra, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}}); }
