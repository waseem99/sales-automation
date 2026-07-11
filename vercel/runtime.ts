import { samplePortfolioItems } from '../packages/fixtures/src/index.js';
import {
  runProspectDiscovery,
  type ProspectDiscoveryOptions,
  type ProspectDiscoveryResult,
  type ProspectDiscoveryRunStore,
} from '../packages/prospect-discovery/src/index.js';
import type { LeadRepository } from '../packages/storage/src/index.js';

export function buildVercelDiscoveryOptions(
  repository: LeadRepository,
  runStore: ProspectDiscoveryRunStore,
  environment: NodeJS.ProcessEnv = process.env,
): ProspectDiscoveryOptions {
  return {
    repository,
    runStore,
    portfolioItems: samplePortfolioItems,
    maxCandidates: positiveInteger(environment.PROSPECT_MAX_CANDIDATES, 15),
    maxSearchQueries: positiveInteger(environment.PROSPECT_MAX_SEARCH_QUERIES, 10),
    searchQueries: splitList(environment.PROSPECT_SEARCH_QUERIES),
    remoteOkEnabled: environment.PROSPECT_REMOTEOK_ENABLED !== 'false',
    bingRssEnabled: environment.PROSPECT_BING_RSS_ENABLED !== 'false',
    greenhouseBoards: splitList(environment.PROSPECT_GREENHOUSE_BOARDS),
    leverSites: splitList(environment.PROSPECT_LEVER_SITES),
    rssFeeds: splitList(environment.PROSPECT_RSS_FEEDS),
    digest: {
      to: environment.PROSPECT_DIGEST_TO,
      from: environment.PROSPECT_DIGEST_FROM ?? environment.SMTP_FROM,
      smtpHost: environment.SMTP_HOST,
      smtpPort: positiveInteger(environment.SMTP_PORT, 587),
      smtpSecure: environment.SMTP_SECURE === 'true',
      smtpUser: environment.SMTP_USER,
      smtpPassword: environment.SMTP_PASSWORD,
      subjectPrefix: environment.PROSPECT_DIGEST_SUBJECT_PREFIX ?? 'Codistan Daily Prospects',
    },
  };
}

export async function runVercelProspectDiscovery(
  repository: LeadRepository,
  runStore: ProspectDiscoveryRunStore,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProspectDiscoveryResult> {
  return runProspectDiscovery(buildVercelDiscoveryOptions(repository, runStore, environment));
}

export function getOriginalRequestUrl(request: Request): string {
  const incoming = new URL(request.url);
  const rewrittenPath = incoming.searchParams.get('__path');
  if (rewrittenPath !== null) {
    incoming.pathname = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
    incoming.searchParams.delete('__path');
  }
  return `${incoming.pathname}${incoming.search}`;
}

export async function parseRequestBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const raw = await request.text();
  if (!raw) return undefined;
  if (raw.length > 1_000_000) throw new Error('Request body is too large.');
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) return JSON.parse(raw);
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try {
    return JSON.parse(raw);
  } catch {
    return { value: raw };
  }
}

export function requestHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(request.headers.entries());
}

export function requireEnvironment(name: string, environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
