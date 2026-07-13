import { createHash } from 'node:crypto';
import type { Lead, ServiceCategory } from '@sales-automation/shared';
import { classifyTargeting } from './targeting.js';

export const PSEB_TECH_HUB_URL = 'https://techdestination.com/tech-hub-portal/';

export interface PsebCollectionResult {
  checkedAt: string;
  sourceUrl: string;
  leads: Lead[];
  skippedLinks: number;
}

export async function collectPsebTechHubLeads(
  fetchImpl: typeof fetch = globalThis.fetch,
  now = new Date().toISOString(),
  limit = 100,
): Promise<PsebCollectionResult> {
  if (!fetchImpl) throw new Error('Global fetch is unavailable.');
  const response = await fetchImpl(PSEB_TECH_HUB_URL, {
    headers: {
      'user-agent': 'CodistanProspectDiscovery/1.0 (+https://codistan.org)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`PSEB Tech Hub returned HTTP ${response.status}.`);
  return parsePsebTechHubHtml(await response.text(), now, limit);
}

export function parsePsebTechHubHtml(html: string, now: string, limit = 100): PsebCollectionResult {
  const leads: Lead[] = [];
  const seenDomains = new Set<string>();
  let skippedLinks = 0;
  const profilePattern = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>[\s\S]{0,600}?View\s*Profile[\s\S]{0,100}?<\/a>/gi;

  for (const match of html.matchAll(profilePattern)) {
    if (leads.length >= Math.max(1, Math.min(limit, 500))) break;
    const website = normalizeWebsite(match[1] ?? '');
    if (!website || isNonCompanyProfile(website)) {
      skippedLinks += 1;
      continue;
    }
    const domain = new URL(website).hostname.replace(/^www\./, '').toLowerCase();
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    const index = match.index ?? 0;
    const context = stripHtml(html.slice(Math.max(0, index - 2_800), index));
    const companyName = inferCompanyName(context, domain);
    const location = inferLocation(context);
    const expertise = inferExpertise(context);
    const targeting = classifyTargeting(expertise || context, 'Pakistan');

    leads.push(buildPsebLead({
      companyName,
      companyWebsite: website,
      location,
      expertise,
      serviceCategory: targeting.serviceCategory,
      serviceOffer: targeting.serviceOffer,
      materialsToShare: targeting.materialsToShare,
      reachMethod: targeting.reachMethod,
      capturedAt: now,
    }));
  }

  return { checkedAt: now, sourceUrl: PSEB_TECH_HUB_URL, leads, skippedLinks };
}

function buildPsebLead(input: {
  companyName: string;
  companyWebsite: string;
  location?: string;
  expertise: string;
  serviceCategory: ServiceCategory;
  serviceOffer: string;
  materialsToShare: string;
  reachMethod: string;
  capturedAt: string;
}): Lead {
  const domain = new URL(input.companyWebsite).hostname.replace(/^www\./, '').toLowerCase();
  const id = `pseb-${createHash('sha256').update(domain).digest('hex').slice(0, 18)}`;
  return {
    id,
    source: 'public_directory',
    sourceUrl: PSEB_TECH_HUB_URL,
    leadType: 'partnership_target',
    prospectStage: 'partner_prospect',
    title: `${input.companyName} — PSEB Tech Hub company`,
    description: input.expertise
      ? `Official PSEB Tech Hub listing. Expertise: ${input.expertise}.`
      : 'Official PSEB Tech Hub company listing.',
    companyName: input.companyName,
    companyWebsite: input.companyWebsite,
    contactFormUrl: input.companyWebsite,
    contactRole: 'Founder / Managing Director / Partnerships',
    country: 'Pakistan',
    region: input.location,
    serviceCategory: input.serviceCategory,
    serviceOffer: input.serviceOffer,
    materialsToShare: input.materialsToShare,
    reachMethod: input.reachMethod,
    opportunityStatus: 'partnership_target',
    discoverySource: 'PSEB Tech Hub collection',
    evidenceUrl: PSEB_TECH_HUB_URL,
    evidenceSummary: `Listed in the official Pakistan Software Export Board Tech Hub directory${input.expertise ? ` with expertise in ${input.expertise}` : ''}.`,
    discoveredAt: input.capturedAt,
    confidence: 'medium',
    capturedAt: input.capturedAt,
    feedback: { status: 'pending' },
    pipelineStatus: 'needs_research',
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt,
  };
}

function inferCompanyName(context: string, domain: string): string {
  const lines = context.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const expertiseIndex = findLastIndex(lines, (line) => /^expertise$/i.test(line));
  const searchEnd = expertiseIndex >= 0 ? expertiseIndex : lines.length;
  for (let index = searchEnd - 1; index >= Math.max(0, searchEnd - 12); index -= 1) {
    const line = lines[index] ?? '';
    if (isCompanyNameCandidate(line)) return titleCase(line);
  }
  return titleCase(domain.split('.')[0]?.replace(/[-_]+/g, ' ') || domain);
}

function inferLocation(context: string): string | undefined {
  const cities = ['Islamabad', 'Rawalpindi', 'Lahore', 'Karachi', 'Peshawar', 'Faisalabad', 'Multan', 'Sialkot', 'Gujranwala', 'Quetta', 'Hyderabad', 'Abbottabad'];
  return cities.find((city) => new RegExp(`\\b${city}\\b`, 'i').test(context));
}

function inferExpertise(context: string): string {
  const known = [
    'Artificial Intelligence', 'Software Development', 'Web Development', 'Mobile App Development',
    'Digital Marketing', 'Cybersecurity', 'Network Security', 'Cloud Services', 'IT Consulting',
    'E-commerce', 'Graphic Design', 'SEO', 'Game Development', 'Data Analytics', 'Blockchain Development',
  ];
  return known.filter((item) => context.toLowerCase().includes(item.toLowerCase())).slice(-5).join(', ');
}

function isCompanyNameCandidate(value: string): boolean {
  if (value.length < 2 || value.length > 100) return false;
  if (/^(staff|experience|years?|yrs?|array|expertise|platforms?|view profile|load more|companies|freelancers|callcenters|seats|csr agents)$/i.test(value)) return false;
  if (/^\d+\s*(years?|yrs?|months?|staff|seats?)?$/i.test(value)) return false;
  if (/https?:|www\.|@/.test(value)) return false;
  return /[a-z]/i.test(value);
}

function normalizeWebsite(value: string): string | undefined {
  try {
    const url = new URL(decodeEntities(value));
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function isNonCompanyProfile(url: string): boolean {
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  return ['linkedin.com', 'upwork.com', 'fiverr.com', 'freelancer.com', 'youtube.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com'].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function stripHtml(value: string): string {
  return decodeEntities(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
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

function titleCase(value: string): string {
  if (value === value.toUpperCase()) return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  return value.replace(/\s+/g, ' ').trim();
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index]!)) return index;
  return -1;
}
