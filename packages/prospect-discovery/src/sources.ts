import type { OpportunitySignalStatus } from '@sales-automation/shared';
import type { DiscoveryCandidate, ProspectFetch, ProspectSourceResult } from './types.js';

export const DEFAULT_SEARCH_QUERIES = [
  '"looking for a development partner" software',
  '"seeking a development partner" AI OR software',
  '"request for proposal" software development',
  '"request for proposal" mobile app development',
  '"implementation partner" generative AI',
  '"white label development partner" agency',
  'AI consultancy agency United States',
  'Webflow agency United Kingdom',
  'Shopify agency Canada',
  'experiential agency Dubai',
  'AR VR agency Saudi Arabia',
  '3D animation studio United States',
];

const relevantTerms = [
  'ai', 'artificial intelligence', 'llm', 'rag', 'openai', 'automation', 'python', 'fastapi',
  'react', 'next.js', 'nextjs', 'node.js', 'nodejs', 'full stack', 'full-stack', 'saas', 'mobile app',
  'unity', 'unreal', 'augmented reality', 'virtual reality', 'webar', 'webxr', '3d', 'animation',
  'cgi', 'vfx', 'software development', 'development partner', 'implementation partner',
];

const directOpportunityTerms = [
  'looking for', 'seeking', 'request for proposal', 'rfp', 'invitation to bid', 'tender',
  'need a', 'needs a', 'hiring', 'job opening', 'apply now', 'contractor', 'freelance',
];

const demandSignalTerms = [
  'hiring', 'job opening', 'funding', 'funded', 'launch', 'expansion', 'new product', 'growing team',
];

export async function collectBingRssCandidates(
  fetchImpl: ProspectFetch,
  queries: string[],
  maxQueries = 12,
): Promise<ProspectSourceResult> {
  const candidates: DiscoveryCandidate[] = [];
  let checked = 0;

  try {
    for (const query of queries.slice(0, Math.max(1, maxQueries))) {
      const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
      const response = await fetchWithTimeout(fetchImpl, url);
      checked += 1;
      if (!response.ok) continue;
      const xml = await response.text();
      for (const item of parseRssItems(xml).slice(0, 10)) {
        const combined = `${item.title} ${item.description}`;
        if (!isRelevant(combined) && !isPartnershipQuery(query)) continue;
        const opportunityStatus = classifyOpportunityStatus(`${query} ${combined}`);
        if (isClearlyStale(item.publishedAt, opportunityStatus)) continue;
        candidates.push({
          sourceName: `Bing RSS: ${query}`,
          sourceType: opportunityStatus === 'partnership_target' ? 'directory' : 'search',
          sourceUrl: item.link,
          title: item.title,
          summary: item.description || item.title,
          publishedAt: item.publishedAt,
          opportunityStatus,
          tags: extractMatchingTerms(combined),
          evidenceSummary: `Discovered through a public search feed for: ${query}`,
        });
      }
    }

    return {
      sourceName: 'bing_rss',
      checked,
      candidates: dedupeCandidates(candidates),
    };
  } catch (error) {
    return {
      sourceName: 'bing_rss',
      checked,
      candidates: dedupeCandidates(candidates),
      error: (error as Error).message,
    };
  }
}

export async function collectRemoteOkCandidates(fetchImpl: ProspectFetch): Promise<ProspectSourceResult> {
  const sourceUrl = 'https://remoteok.com/api';
  try {
    const response = await fetchWithTimeout(fetchImpl, sourceUrl, {
      headers: { 'user-agent': 'CodistanProspectDiscovery/1.0 (+https://hilariousai.io)' },
    });
    if (!response.ok) {
      return { sourceName: 'remoteok', checked: 1, candidates: [], error: `HTTP ${response.status}` };
    }

    const payload = await response.json() as unknown;
    const rows = Array.isArray(payload) ? payload : [];
    const candidates: DiscoveryCandidate[] = [];
    for (const row of rows) {
      if (!isRecord(row) || typeof row.position !== 'string' || typeof row.url !== 'string') continue;
      const summary = stripHtml(String(row.description ?? ''));
      const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
      const combined = `${row.position} ${summary} ${tags.join(' ')}`;
      if (!isRelevant(combined)) continue;
      const publishedAt = normalizeRemoteDate(row.date, row.epoch);
      if (isClearlyStale(publishedAt, 'live_opportunity')) continue;
      candidates.push({
        sourceName: 'RemoteOK',
        sourceType: 'job_board',
        sourceUrl: row.url,
        title: row.position,
        summary: shorten(summary, 1_200),
        publishedAt,
        companyName: typeof row.company === 'string' ? row.company : undefined,
        country: typeof row.location === 'string' ? row.location : undefined,
        opportunityStatus: 'live_opportunity',
        tags,
        evidenceSummary: 'Current public remote-job posting matching Codistan capabilities.',
      });
    }

    return { sourceName: 'remoteok', checked: rows.length, candidates: dedupeCandidates(candidates) };
  } catch (error) {
    return { sourceName: 'remoteok', checked: 1, candidates: [], error: (error as Error).message };
  }
}

export async function collectGreenhouseCandidates(
  fetchImpl: ProspectFetch,
  boards: string[],
): Promise<ProspectSourceResult> {
  const candidates: DiscoveryCandidate[] = [];
  let checked = 0;
  const errors: string[] = [];

  for (const board of boards) {
    const normalized = board.trim();
    if (!normalized) continue;
    try {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(normalized)}/jobs?content=true`;
      const response = await fetchWithTimeout(fetchImpl, url);
      checked += 1;
      if (!response.ok) {
        errors.push(`${normalized}: HTTP ${response.status}`);
        continue;
      }
      const payload = await response.json() as { jobs?: unknown[] };
      for (const row of payload.jobs ?? []) {
        if (!isRecord(row) || typeof row.title !== 'string' || typeof row.absolute_url !== 'string') continue;
        const summary = stripHtml(String(row.content ?? ''));
        const combined = `${row.title} ${summary}`;
        if (!isRelevant(combined)) continue;
        candidates.push({
          sourceName: `Greenhouse: ${normalized}`,
          sourceType: 'job_board',
          sourceUrl: row.absolute_url,
          title: row.title,
          summary: shorten(summary, 1_200),
          publishedAt: normalizeDate(row.updated_at),
          companyName: humanizeSlug(normalized),
          country: isRecord(row.location) && typeof row.location.name === 'string' ? row.location.name : undefined,
          opportunityStatus: 'recent_demand_signal',
          tags: extractMatchingTerms(combined),
          evidenceSummary: 'Current public Greenhouse vacancy showing active delivery demand.',
        });
      }
    } catch (error) {
      errors.push(`${normalized}: ${(error as Error).message}`);
    }
  }

  return {
    sourceName: 'greenhouse',
    checked,
    candidates: dedupeCandidates(candidates),
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

export async function collectLeverCandidates(
  fetchImpl: ProspectFetch,
  sites: string[],
): Promise<ProspectSourceResult> {
  const candidates: DiscoveryCandidate[] = [];
  let checked = 0;
  const errors: string[] = [];

  for (const site of sites) {
    const normalized = site.trim();
    if (!normalized) continue;
    try {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(normalized)}?mode=json`;
      const response = await fetchWithTimeout(fetchImpl, url);
      checked += 1;
      if (!response.ok) {
        errors.push(`${normalized}: HTTP ${response.status}`);
        continue;
      }
      const rows = await response.json() as unknown;
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!isRecord(row) || typeof row.text !== 'string' || typeof row.hostedUrl !== 'string') continue;
        const summary = stripHtml(String(row.descriptionPlain ?? row.description ?? ''));
        const combined = `${row.text} ${summary}`;
        if (!isRelevant(combined)) continue;
        candidates.push({
          sourceName: `Lever: ${normalized}`,
          sourceType: 'job_board',
          sourceUrl: row.hostedUrl,
          title: row.text,
          summary: shorten(summary, 1_200),
          publishedAt: typeof row.createdAt === 'number' ? new Date(row.createdAt).toISOString() : undefined,
          companyName: humanizeSlug(normalized),
          country: isRecord(row.categories) && typeof row.categories.location === 'string' ? row.categories.location : undefined,
          opportunityStatus: 'recent_demand_signal',
          tags: extractMatchingTerms(combined),
          evidenceSummary: 'Current public Lever vacancy showing active delivery demand.',
        });
      }
    } catch (error) {
      errors.push(`${normalized}: ${(error as Error).message}`);
    }
  }

  return {
    sourceName: 'lever',
    checked,
    candidates: dedupeCandidates(candidates),
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

export async function collectGenericRssCandidates(
  fetchImpl: ProspectFetch,
  feedUrls: string[],
): Promise<ProspectSourceResult> {
  const candidates: DiscoveryCandidate[] = [];
  let checked = 0;
  const errors: string[] = [];

  for (const feedUrl of feedUrls) {
    try {
      const response = await fetchWithTimeout(fetchImpl, feedUrl);
      checked += 1;
      if (!response.ok) {
        errors.push(`${feedUrl}: HTTP ${response.status}`);
        continue;
      }
      const xml = await response.text();
      for (const item of parseRssItems(xml).slice(0, 30)) {
        const combined = `${item.title} ${item.description}`;
        if (!isRelevant(combined)) continue;
        const opportunityStatus = classifyOpportunityStatus(combined);
        if (isClearlyStale(item.publishedAt, opportunityStatus)) continue;
        candidates.push({
          sourceName: `RSS: ${feedUrl}`,
          sourceType: 'rss',
          sourceUrl: item.link,
          title: item.title,
          summary: item.description || item.title,
          publishedAt: item.publishedAt,
          opportunityStatus,
          tags: extractMatchingTerms(combined),
          evidenceSummary: `Discovered through public RSS feed ${feedUrl}.`,
        });
      }
    } catch (error) {
      errors.push(`${feedUrl}: ${(error as Error).message}`);
    }
  }

  return {
    sourceName: 'generic_rss',
    checked,
    candidates: dedupeCandidates(candidates),
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

export function classifyOpportunityStatus(text: string): OpportunitySignalStatus {
  const normalized = text.toLowerCase();
  if (directOpportunityTerms.some((term) => normalized.includes(term))) return 'live_opportunity';
  if (demandSignalTerms.some((term) => normalized.includes(term))) return 'recent_demand_signal';
  return 'partnership_target';
}

export function isRelevant(text: string): boolean {
  const normalized = text.toLowerCase();
  return relevantTerms.some((term) => normalized.includes(term));
}

export async function fetchWithTimeout(
  fetchImpl: ProspectFetch,
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'CodistanProspectDiscovery/1.0 (+https://hilariousai.io)',
        accept: 'text/html,application/rss+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface RssItem {
  title: string;
  link: string;
  description: string;
  publishedAt?: string;
}

export function parseRssItems(xml: string): RssItem[] {
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  return items.map((match) => {
    const item = match[1] ?? '';
    const title = decodeEntities(extractXmlTag(item, 'title'));
    const link = decodeEntities(extractXmlTag(item, 'link'));
    const description = stripHtml(decodeEntities(extractXmlTag(item, 'description')));
    const publishedAt = normalizeDate(extractXmlTag(item, 'pubDate') || extractXmlTag(item, 'date'));
    return { title, link, description, publishedAt };
  }).filter((item) => Boolean(item.title && item.link));
}

function extractXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return (match?.[1] ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
}

function normalizeRemoteDate(dateValue: unknown, epochValue: unknown): string | undefined {
  if (typeof dateValue === 'string') return normalizeDate(dateValue);
  if (typeof epochValue === 'number') return new Date(epochValue * 1_000).toISOString();
  return undefined;
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function isClearlyStale(publishedAt: string | undefined, status: OpportunitySignalStatus): boolean {
  if (!publishedAt || status === 'partnership_target') return false;
  const ageMs = Date.now() - Date.parse(publishedAt);
  const maxAgeDays = status === 'live_opportunity' ? 45 : 120;
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1_000;
}

function isPartnershipQuery(query: string): boolean {
  return /agency|consultancy|studio|partner/i.test(query) && !/looking for|seeking|request for proposal|rfp/i.test(query);
}

function extractMatchingTerms(text: string): string[] {
  const normalized = text.toLowerCase();
  return relevantTerms.filter((term) => normalized.includes(term)).slice(0, 12);
}

function dedupeCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalizeUrl(candidate.sourceUrl);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

function humanizeSlug(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function shorten(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
