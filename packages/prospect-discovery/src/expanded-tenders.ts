import type { TenderSector } from '@sales-automation/shared';
import { collectBingRssCandidates } from './sources.js';
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
    query: 'site:seao.ca (appel offres OR RFP) (logiciel OR plateforme numérique OR services informatiques)',
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
    const result = await collectBingRssCandidates(fetchImpl, [source.query], 1);
    checked += result.checked;
    if (result.error) errors.push(`${source.key}: ${result.error}`);
    for (const candidate of result.candidates) {
      const text = `${candidate.title} ${candidate.summary}`;
      if (!isSoftwareTender(`${text} tender`)) continue;
      if (!isTrustedSourceUrl(candidate.sourceUrl, source.trustedHosts)) continue;
      candidates.push({
        ...candidate,
        sourceName: source.portal,
        sourceType: 'procurement',
        country: source.country,
        companyName: candidate.companyName ?? `${source.portal} buyer`,
        companyWebsite: candidate.companyWebsite ?? origin(candidate.sourceUrl),
        opportunityStatus: 'live_opportunity',
        evidenceSummary: `Formal software or digital-services procurement notice discovered from trusted ${source.portal} source.`,
        tender: {
          portal: source.portal,
          sector: source.sector,
          opportunityType: classifyTenderOpportunityType(text),
          publishedAt: candidate.publishedAt,
          submissionMethod: 'Confirm the official submission method in the retained buyer notice and documents.',
        },
      });
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
