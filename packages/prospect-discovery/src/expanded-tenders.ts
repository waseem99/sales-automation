import type { TenderOpportunityType, TenderSector } from '@sales-automation/shared';
import { fetchWithTimeout, parseRssItems } from './sources.js';
import { classifyTenderOpportunityType, isSoftwareTender } from './tenders.js';
import type { DiscoveryCandidate, ProspectFetch, ProspectSourceResult } from './types.js';

interface ExpandedTenderSource {
  key: string;
  portal: string;
  country: 'Pakistan' | 'Canada';
  sector: TenderSector;
  query: string;
  trustedHosts: string[];
}

export const EXPANDED_PUBLIC_TENDER_SOURCES: ExpandedTenderSource[] = [
  {
    key: 'punjab_ppra',
    portal: 'Punjab PPRA',
    country: 'Pakistan',
    sector: 'public',
    query: 'site:ppra.punjab.gov.pk (RFP OR tender OR EOI) (software OR portal OR application OR cybersecurity)',
    trustedHosts: ['ppra.punjab.gov.pk'],
  },
  {
    key: 'kp_ppra',
    portal: 'Khyber Pakhtunkhwa PPRA',
    country: 'Pakistan',
    sector: 'public',
    query: 'site:kppra.gov.pk (RFP OR tender OR EOI) (software OR portal OR application OR IT services)',
    trustedHosts: ['kppra.gov.pk'],
  },
  {
    key: 'sindh_ppra',
    portal: 'Sindh PPRA',
    country: 'Pakistan',
    sector: 'public',
    query: 'site:pprasindh.gov.pk (RFP OR tender OR EOI) (software OR portal OR application OR information technology)',
    trustedHosts: ['pprasindh.gov.pk'],
  },
  {
    key: 'balochistan_ppra',
    portal: 'Balochistan PPRA',
    country: 'Pakistan',
    sector: 'public',
    query: 'site:bppra.gob.pk (RFP OR tender OR EOI) (software OR portal OR application OR IT services)',
    trustedHosts: ['bppra.gob.pk'],
  },
  {
    key: 'pakistan_education_health',
    portal: 'Pakistan education and health public buyers',
    country: 'Pakistan',
    sector: 'public',
    query: '(site:edu.pk OR site:gov.pk) (university OR hospital OR health) (RFP OR tender) (software OR digital platform OR web portal)',
    trustedHosts: ['.edu.pk', '.gov.pk'],
  },
  {
    key: 'bc_bid',
    portal: 'BC Bid',
    country: 'Canada',
    sector: 'public',
    query: 'site:bcbid.gov.bc.ca (RFP OR opportunity) (software development OR digital platform OR IT services)',
    trustedHosts: ['bcbid.gov.bc.ca'],
  },
  {
    key: 'alberta_purchasing',
    portal: 'Alberta Purchasing Connection',
    country: 'Canada',
    sector: 'public',
    query: 'site:purchasing.alberta.ca (RFP OR opportunity) (software OR application development OR digital services)',
    trustedHosts: ['purchasing.alberta.ca'],
  },
  {
    key: 'ontario_tenders',
    portal: 'Ontario Tenders Portal',
    country: 'Canada',
    sector: 'public',
    query: 'site:ontariotenders.app.jaggaer.com (RFP OR solicitation) (software OR digital platform OR IT professional services)',
    trustedHosts: ['ontariotenders.app.jaggaer.com'],
  },
  {
    key: 'quebec_seao',
    portal: 'SEAO Quebec',
    country: 'Canada',
    sector: 'public',
    query: 'site:seao.ca (appel offres OR demande propositions) (logiciel OR plateforme numérique OR services informatiques)',
    trustedHosts: ['seao.ca'],
  },
  {
    key: 'sasktenders',
    portal: 'SaskTenders',
    country: 'Canada',
    sector: 'public',
    query: 'site:sasktenders.ca (RFP OR competition) (software OR digital platform OR IT services)',
    trustedHosts: ['sasktenders.ca'],
  },
  {
    key: 'municipal_education_health',
    portal: 'Canadian municipal, education and healthcare buyers',
    country: 'Canada',
    sector: 'public',
    query: 'site:bidsandtenders.ca (municipality OR university OR college OR hospital) (RFP OR bid) (software OR digital platform OR website)',
    trustedHosts: ['bidsandtenders.ca'],
  },
];

export async function collectExpandedPublicTenderCandidates(fetchImpl: ProspectFetch): Promise<ProspectSourceResult> {
  const candidates: DiscoveryCandidate[] = [];
  const errors: string[] = [];
  let checked = 0;

  for (const source of EXPANDED_PUBLIC_TENDER_SOURCES) {
    try {
      const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(source.query)}`;
      const response = await fetchWithTimeout(fetchImpl, url, {}, 18_000);
      checked += 1;
      if (!response.ok) {
        errors.push(`${source.key}: HTTP ${response.status}`);
        continue;
      }
      for (const item of parseRssItems(await response.text()).slice(0, 12)) {
        const text = `${item.title} ${item.description}`;
        if (!isExpandedSoftwareTender(text)) continue;
        if (!isTrustedSourceUrl(item.link, source.trustedHosts)) continue;
        candidates.push({
          sourceName: source.portal,
          sourceType: 'procurement',
          sourceUrl: item.link,
          title: item.title,
          summary: item.description || item.title,
          publishedAt: item.publishedAt,
          country: source.country,
          companyName: `${source.portal} buyer`,
          companyWebsite: origin(item.link),
          opportunityStatus: 'live_opportunity',
          tags: expandedTags(text),
          evidenceSummary: `Formal software or digital-services procurement notice discovered from trusted ${source.portal} source.`,
          tender: {
            portal: source.portal,
            sector: source.sector,
            opportunityType: classifyExpandedOpportunityType(text),
            publishedAt: item.publishedAt,
            submissionMethod: 'Confirm the official submission method in the retained buyer notice and documents.',
          },
        });
      }
    } catch (error) {
      errors.push(`${source.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    sourceName: 'expanded_public_tenders',
    checked,
    candidates: dedupe(candidates),
    error: errors.length ? errors.join('; ') : undefined,
  };
}

export function isTrustedSourceUrl(value: string, trustedHosts: string[]): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return trustedHosts.some((trusted) => {
      const normalized = trusted.toLowerCase().replace(/^www\./, '');
      return normalized.startsWith('.')
        ? host.endsWith(normalized)
        : host === normalized || host.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

function isExpandedSoftwareTender(text: string): boolean {
  if (isSoftwareTender(text)) return true;
  const formalFrench = /appel d['’]offres?|demande de propositions?|avis d['’]appel|soumission/i.test(text);
  const serviceFrench = /logiciel|plateforme numérique|application web|application mobile|services informatiques|cybersécurité|intelligence artificielle|intégration de systèmes/i.test(text);
  return formalFrench && serviceFrench;
}

function classifyExpandedOpportunityType(text: string): TenderOpportunityType {
  const existing = classifyTenderOpportunityType(text);
  if (existing !== 'other') return existing;
  if (/appel d['’]offres?|demande de propositions?/i.test(text)) return 'rfp';
  return 'other';
}

function expandedTags(text: string): string[] {
  const value = text.toLowerCase();
  return [
    'software', 'digital platform', 'web portal', 'application', 'cybersecurity', 'artificial intelligence',
    'logiciel', 'plateforme numérique', 'services informatiques', 'cybersécurité',
  ].filter((term) => value.includes(term)).slice(0, 10);
}

function dedupe(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
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
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function origin(value: string): string | undefined {
  try { return new URL(value).origin; } catch { return undefined; }
}
