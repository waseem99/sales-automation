import { evaluateLead } from '@sales-automation/evaluator';
import type { OpportunitySignalStatus } from '@sales-automation/shared';
import {
  buildCampaignSearchQueries,
  campaignIdsFromEnvironment,
  resolveDiscoveryCampaigns,
} from './campaigns.js';
import {
  candidateToLead,
  classifyServiceCategory,
  rejectStoredEmploymentVacancies,
  runProspectDiscovery as runProspectDiscoveryBase,
} from './runner.js';
import {
  hasResultLevelProjectOpportunityIntent,
  validateAutomaticProspectCandidate,
} from './prospect-validation.js';
import type {
  DiscoveryCandidate,
  ProspectDiscoveryOptions,
  ProspectDiscoveryResult,
  ProspectFetch,
} from './types.js';

export { candidateToLead, classifyServiceCategory, rejectStoredEmploymentVacancies };

export async function runProspectDiscovery(options: ProspectDiscoveryOptions): Promise<ProspectDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('Global fetch is unavailable. Supply fetchImpl.');

  const configuredCampaignIds = options.campaignIds?.length
    ? options.campaignIds
    : campaignIdsFromEnvironment(process.env.PROSPECT_CAMPAIGN_IDS);
  const campaigns = resolveDiscoveryCampaigns(configuredCampaignIds);
  const campaignQueries = buildCampaignSearchQueries(campaigns);
  const searchQueries = options.searchQueries?.length ? options.searchQueries : campaignQueries;

  const result = await runProspectDiscoveryBase({
    ...options,
    searchQueries,
    fetchImpl: createProspectQualityFetch(fetchImpl),
  });
  result.run.activeCampaignIds = campaigns.map((campaign) => campaign.id);
  result.run.searchQueryCount = searchQueries.length;

  const generatedAt = options.now?.() ?? result.run.completedAt ?? new Date().toISOString();
  let closeabilityRescoredCount = 0;
  for (const record of options.repository.listLeads()) {
    const evaluation = evaluateLead({
      lead: record.lead,
      portfolioItems: options.portfolioItems,
      generatedAt,
    });
    options.repository.saveEvaluation(evaluation, 'closeability-rescore');
    closeabilityRescoredCount += 1;
  }
  result.run.closeabilityRescoredCount = closeabilityRescoredCount;
  options.runStore?.saveRun(result.run);
  return result;
}

export function createProspectQualityFetch(fetchImpl: ProspectFetch): ProspectFetch {
  const guardedFetch: ProspectFetch = async (...args: Parameters<ProspectFetch>): Promise<Response> => {
    const [input] = args;
    const response = await fetchImpl(...args);
    const requestUrl = requestUrlString(input);
    if (!shouldInspectResponse(requestUrl, response)) return response;

    const body = await response.text();
    if (!/<item\b/i.test(body)) return recreateResponse(response, body);

    const filtered = filterRssItems(body, requestUrl);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('x-codistan-prospect-items-rejected', String(filtered.rejected));
    return new Response(filtered.xml, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
  return guardedFetch;
}

export function filterRssItems(xml: string, requestUrl: string): { xml: string; checked: number; rejected: number } {
  const query = searchQuery(requestUrl);
  const opportunityQuery = isExplicitOpportunityQuery(query);
  let checked = 0;
  let rejected = 0;

  const filteredXml = xml.replace(/<item\b[^>]*>[\s\S]*?<\/item>/gi, (itemXml) => {
    checked += 1;
    const title = decodeEntities(extractXmlTag(itemXml, 'title'));
    const sourceUrl = decodeEntities(extractXmlTag(itemXml, 'link'));
    const summary = stripHtml(decodeEntities(extractXmlTag(itemXml, 'description'))) || title;
    const resultIntent = hasResultLevelProjectOpportunityIntent(`${title} ${summary}`);
    const opportunityStatus: OpportunitySignalStatus = opportunityQuery || resultIntent
      ? 'live_opportunity'
      : 'partnership_target';
    const candidate: DiscoveryCandidate = {
      sourceName: query ? `Public search result: ${query}` : 'Public RSS result',
      sourceType: opportunityStatus === 'live_opportunity' ? 'search' : 'directory',
      sourceUrl,
      title,
      summary,
      opportunityStatus,
      evidenceSummary: 'Automatic public-search result pending source and buyer-intent validation.',
    };
    const validation = validateAutomaticProspectCandidate(candidate);
    if (validation.qualified) return itemXml;
    rejected += 1;
    return '';
  });

  return { xml: filteredXml, checked, rejected };
}

function shouldInspectResponse(requestUrl: string, response: Response): boolean {
  if (!response.ok) return false;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return /bing\.com\/search/i.test(requestUrl)
    || contentType.includes('application/rss+xml')
    || contentType.includes('application/xml')
    || contentType.includes('text/xml');
}

function isExplicitOpportunityQuery(query: string): boolean {
  return hasResultLevelProjectOpportunityIntent(query)
    || /\b(?:looking|seeking|searching)\s+for\b/i.test(query)
    || /\b(?:development|implementation|technology|outsourcing)\s+partner\b/i.test(query)
    || /\b(?:rfp|rfq|eoi|tender|procurement)\b/i.test(query);
}

function searchQuery(requestUrl: string): string {
  try { return new URL(requestUrl).searchParams.get('q') ?? ''; } catch { return ''; }
}

function requestUrlString(input: Parameters<ProspectFetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function recreateResponse(response: Response, body: string): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function extractXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return (match?.[1] ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
}

function stripHtml(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
