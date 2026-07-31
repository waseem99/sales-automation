import { createHash, timingSafeEqual } from 'node:crypto';
import { applyCampaignEngineAfterIntake } from '../vercel/acquisition-campaign-runtime.js';
import { applyEnrichmentAfterIntake } from '../vercel/acquisition-enrichment-runtime.js';
import { applyIdentityGraphAfterIntake } from '../vercel/acquisition-identity-runtime.js';
import { handleAcquisitionIntake } from '../vercel/acquisition-intake-runtime.js';
import { applyIntentProvenanceAfterIntake } from '../vercel/acquisition-intent-provenance-runtime.js';
import { applyBdWorkflowAfterIntake } from '../vercel/bd-workflow-intake-runtime.js';
import { handleSalesNavigatorIntake } from '../vercel/sales-navigator-intake-runtime.js';
import { applyUpworkAccountIntelligenceAfterIntake } from '../vercel/upwork-account-intelligence-runtime.js';

export const maxDuration = 300;
const MAX_REQUEST_BYTES = 1_000_000;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') {
        return responseJson({ error: 'Method not allowed.' }, 405, { allow: 'POST' });
      }

      const configuredToken = requireEnvironment('ACQUISITION_INGEST_TOKEN');
      if (configuredToken.length < 32) throw new Error('ACQUISITION_INGEST_TOKEN must contain at least 32 characters.');
      const suppliedToken = bearerToken(request.headers.get('authorization'));
      if (!suppliedToken || !safeTokenEqual(suppliedToken, configuredToken)) {
        return responseJson({ error: 'Unauthorized.' }, 401, { 'www-authenticate': 'Bearer' });
      }

      const contentLength = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
        return responseJson({ error: 'Request body is too large.' }, 413);
      }
      const raw = await request.text();
      if (!raw || raw.length > MAX_REQUEST_BYTES) return responseJson({ error: 'A valid JSON body is required.' }, 400);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return responseJson({ error: 'Request body must be valid JSON.' }, 400);
      }

      const source = body && typeof body === 'object' && !Array.isArray(body)
        ? String((body as Record<string, unknown>).source ?? '')
        : '';
      const handler = source === 'sales_navigator' ? handleSalesNavigatorIntake : handleAcquisitionIntake;
      const databaseUrl = requireEnvironment('DATABASE_URL');
      const intakeResponse = await handler({ body, databaseUrl });
      const identityResponse = await applyIdentityGraphAfterIntake({ response: intakeResponse, databaseUrl });
      const intentResponse = await applyIntentProvenanceAfterIntake({ response: identityResponse, databaseUrl });
      const enrichmentResponse = await applyEnrichmentAfterIntake({ response: intentResponse, databaseUrl });
      const campaignResponse = await applyCampaignEngineAfterIntake({ response: enrichmentResponse, databaseUrl });
      const accountResponse = await applyUpworkAccountIntelligenceAfterIntake({ response: campaignResponse, databaseUrl });
      return applyBdWorkflowAfterIntake({ response: accountResponse, databaseUrl });
    } catch (error) {
      console.error('ACQUISITION_INGEST_ERROR', {
        message: error instanceof Error ? error.message : String(error),
      });
      return responseJson({
        error: error instanceof Error ? error.message : String(error),
        humanReviewRequired: true,
        externalActionAutomated: false,
      }, 500);
    }
  },
};

function bearerToken(value: string | null): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(value?.trim() ?? '');
  return match?.[1]?.trim() || undefined;
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value.trim();
}

function responseJson(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
