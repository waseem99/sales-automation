import type { IncomingHttpHeaders } from 'node:http';
import { StaticSessionAdapter } from '@sales-automation/auth';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import { LocalJsonLeadRepository } from '@sales-automation/storage';
import { handleSalesAutomationRequest } from '../apps/web/dist/server.js';

type VercelRequestLike = {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body?: unknown;
  [key: string]: unknown;
};

type VercelResponseLike = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

const generatedAt = new Date().toISOString();
const storagePath = process.env.LOCAL_LEAD_STORE_PATH ?? '/tmp/codistan-lead-desk-preview.json';
const repository = new LocalJsonLeadRepository({ filePath: storagePath });
const devSessionAdapter = new StaticSessionAdapter({
  'dev-founder-token': {
    id: 'dev-founder',
    email: 'dev@codistan.org',
    name: 'Codistan Dev Founder',
    role: 'founder',
    isActive: true,
  },
});

seedPreviewData();

export default async function handler(request: VercelRequestLike, response: VercelResponseLike): Promise<void> {
  const result = handleSalesAutomationRequest(
    {
      method: request.method ?? 'GET',
      path: normalizePreviewPath(request.url ?? '/'),
      body: await getBody(request),
      headers: normalizeHeaders(request.headers),
    },
    {
      repository,
      portfolioItems: samplePortfolioItems,
      sessionAdapter: devSessionAdapter,
      now: () => new Date().toISOString(),
    },
  );

  response.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers)) {
    response.setHeader(key, value);
  }
  response.end(result.body);
}

function seedPreviewData(): void {
  if (repository.listLeads().length > 0) return;

  for (const lead of sampleLeads) {
    repository.saveEvaluation(
      evaluateLead({
        lead,
        portfolioItems: samplePortfolioItems,
        generatedAt,
      }),
      'vercel-preview-seed',
    );
  }
}

async function getBody(request: VercelRequestLike): Promise<unknown> {
  if (request.body !== undefined) return request.body;

  const chunks: Buffer[] = [];
  const stream = request as unknown as AsyncIterable<Buffer | string>;
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return undefined;

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string | string[] | undefined> {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = Array.isArray(value) ? value : value?.toString();
  }
  return normalized;
}

function normalizePreviewPath(url: string): string {
  if (url === '/api' || url.startsWith('/api?')) {
    return url.replace(/^\/api/, '/') || '/';
  }
  if (url === '/api/') return '/';
  return url;
}
