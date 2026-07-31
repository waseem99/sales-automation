import {createHash, timingSafeEqual} from 'node:crypto';
import {summarizeFunnel} from '@sales-automation/funnel-analytics';
import {loadNeonAppState} from '@sales-automation/neon-state';
import {renderFunnelAnalyticsDashboard} from '../apps/web/src/funnel-analytics-view.js';

export const maxDuration = 60;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET') return responseJson({error: 'Method not allowed.'}, 405, {allow: 'GET'});
      authenticate(request);
      const databaseUrl = requireEnvironment('DATABASE_URL');
      const state = await loadNeonAppState(databaseUrl);
      const url = new URL(request.url);
      const records = state.repository.listLeads().filter((record) => {
        const source = url.searchParams.get('source');
        const owner = url.searchParams.get('owner');
        return (!source || record.lead.source === source) && (!owner || record.lead.owner === owner);
      });
      const summary = summarizeFunnel(records);
      if (url.searchParams.get('format') === 'html' || request.headers.get('accept')?.includes('text/html')) {
        return new Response(renderFunnelAnalyticsDashboard(summary), {
          status: 200,
          headers: securityHeaders('text/html; charset=utf-8'),
        });
      }
      return responseJson(summary);
    } catch (error) {
      const message = safeErrorMessage(error);
      const status = message === 'Unauthorized.' ? 401 : 500;
      return responseJson({error: message, humanReviewRequired: true, externalActionAutomated: false}, status, status === 401 ? {'www-authenticate': 'Bearer'} : {});
    }
  },
};

function authenticate(request: Request): void {
  const configuredToken = requireEnvironment('ACQUISITION_INGEST_TOKEN');
  const suppliedToken = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization')?.trim() ?? '')?.[1]?.trim();
  if (!suppliedToken || !safeTokenEqual(suppliedToken, configuredToken)) throw new Error('Unauthorized.');
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
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...securityHeaders('application/json; charset=utf-8'),
      ...extraHeaders,
    },
  });
}
