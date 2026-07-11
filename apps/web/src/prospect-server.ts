import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  handleProspectDashboardRequest,
  type ProspectDashboardContext,
  type ProspectDashboardResponse,
} from './prospect-handler.js';

export type ProspectDashboardServerContext = ProspectDashboardContext;

export function createProspectDashboardHttpServer(context: ProspectDashboardServerContext) {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const result = await handleProspectDashboardRequest({
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: normalizeHeaders(request.headers),
        body: await readRequestBody(request),
        clientKey: request.socket.remoteAddress ?? 'unknown',
      }, context);
      send(response, result);
    } catch (error) {
      send(response, {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: (error as Error).message }),
      });
    }
  });
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/json')) return JSON.parse(raw);
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try {
    return JSON.parse(raw);
  } catch {
    return { value: raw };
  }
}

function normalizeHeaders(headers: IncomingMessage['headers']): Record<string, string | string[] | undefined> {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) normalized[key] = value;
  return normalized;
}

function send(response: ServerResponse, result: ProspectDashboardResponse): void {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}
