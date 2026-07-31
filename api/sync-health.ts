import {createHash, timingSafeEqual} from 'node:crypto';
import {
  aggregateSyncHealth,
  createSafeReplayPlan,
  createSyncHealthSnapshot,
  verifySyncHealthSnapshot,
  type CreateSyncHealthSnapshotInput,
  type SyncHealthSnapshot,
} from '@sales-automation/sync-health';
import {loadSyncHealthSnapshots, persistSyncHealthSnapshot} from '../packages/neon-state/src/sync-health-store.js';
import {renderSyncHealthDashboard} from '../apps/web/src/sync-health-view.js';

export const maxDuration = 60;
const MAX_REQUEST_BYTES = 250_000;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      authenticate(request);
      const databaseUrl = requireEnvironment('DATABASE_URL');
      if (request.method === 'GET') {
        const snapshots = (await loadSyncHealthSnapshots<SyncHealthSnapshot>(databaseUrl)).filter(verifySyncHealthSnapshot);
        const aggregate = aggregateSyncHealth(snapshots);
        const url = new URL(request.url);
        if (url.searchParams.get('format') === 'html' || request.headers.get('accept')?.includes('text/html')) {
          return new Response(renderSyncHealthDashboard(aggregate), {status: 200, headers: securityHeaders('text/html; charset=utf-8')});
        }
        return responseJson(aggregate);
      }
      if (request.method !== 'POST') return responseJson({error: 'Method not allowed.'}, 405, {allow: 'GET, POST'});
      const body = await readBody(request);
      const action = requiredText(body.action, 'action');
      if (action === 'publish_snapshot') {
        const snapshotInput = asRecord(body.snapshot) as unknown as CreateSyncHealthSnapshotInput;
        const snapshot = createSyncHealthSnapshot(snapshotInput);
        await persistSyncHealthSnapshot(databaseUrl, snapshot);
        return responseJson({
          ok: true,
          action,
          source: snapshot.source,
          snapshotHash: snapshot.snapshotHash,
          diagnosticsRedacted: true,
          stateRootPreserved: true,
          humanReviewRequired: true,
          externalActionAutomated: false,
        }, 201);
      }
      if (action === 'plan_replay') {
        const source = requiredText(body.source, 'source');
        const snapshots = (await loadSyncHealthSnapshots<SyncHealthSnapshot>(databaseUrl)).filter(verifySyncHealthSnapshot);
        const snapshot = snapshots.find((item) => item.source === source);
        if (!snapshot) return responseJson({error: 'No current health snapshot exists for this source.'}, 404);
        const plan = createSafeReplayPlan({
          snapshot,
          idempotencyKeys: Array.isArray(body.idempotencyKeys) ? body.idempotencyKeys.map(String) : [],
          actor: requiredText(body.actor, 'actor'),
          permissionConfirmed: body.permissionConfirmed === true,
          requestedAt: optionalIso(body.requestedAt),
        });
        return responseJson({
          ok: true,
          action,
          plan,
          executionRequiredOnAuthorizedLocalCollector: true,
          humanReviewRequired: true,
          externalActionAutomated: false,
        }, 201);
      }
      return responseJson({error: 'Unsupported sync health action.'}, 400);
    } catch (error) {
      const message = safeErrorMessage(error);
      const status = message === 'Unauthorized.' ? 401 : message.includes('required') || message.includes('Unsupported') || message.includes('Permission') || message.includes('valid') ? 400 : 500;
      return responseJson({error: message, humanReviewRequired: true, externalActionAutomated: false}, status, status === 401 ? {'www-authenticate': 'Bearer'} : {});
    }
  },
};

function authenticate(request: Request): void {
  const configuredToken = requireEnvironment('ACQUISITION_INGEST_TOKEN');
  const suppliedToken = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization')?.trim() ?? '')?.[1]?.trim();
  if (!suppliedToken || !safeTokenEqual(suppliedToken, configuredToken)) throw new Error('Unauthorized.');
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  const text = await request.text();
  if (!text || text.length > MAX_REQUEST_BYTES) throw new Error('A valid JSON body is required.');
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request body must be a JSON object.');
  return parsed as Record<string, unknown>;
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalIso(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = requiredText(value, 'requestedAt');
  if (Number.isNaN(Date.parse(text))) throw new Error('requestedAt must be a valid date.');
  return new Date(text).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  };
}

function responseJson(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {status, headers: {...securityHeaders('application/json; charset=utf-8'), ...extraHeaders}});
}
