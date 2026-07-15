import type { Lead } from '@sales-automation/shared';
import type { LeadRepository } from '@sales-automation/storage';
import type { ProspectFetch } from './types.js';

export type ContactReadiness = 'ready' | 'partial' | 'research_required';
export type EnrichmentConfidence = 'high' | 'medium' | 'low';

export interface PublicContactEnrichment {
  version: 1;
  status: ContactReadiness;
  confidence: EnrichmentConfidence;
  officialWebsite?: string;
  verifiedBusinessEmail?: string;
  contactFormUrl?: string;
  publicProfessionalProfileUrl?: string;
  buyerName?: string;
  buyerRole?: string;
  evidenceUrls: string[];
  checkedAt: string;
  missingData: string[];
  rejectedPersonalEmails: string[];
}

export interface EnrichRepositoryContactsInput {
  repository: LeadRepository;
  fetchImpl: ProspectFetch;
  now?: () => string;
  maxRecords?: number;
  leadIds?: string[];
  actor?: string;
}

export interface EnrichRepositoryContactsResult {
  checked: number;
  updated: number;
  ready: number;
  partial: number;
  researchRequired: number;
  errors: Array<{ leadId: string; message: string }>;
}

const finalStatuses = new Set(['won', 'lost', 'rejected', 'archived']);
const personalEmailDomains = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'outlook.com',
  'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'mail.com', 'zoho.com', 'yandex.com',
]);
const blockedEvidenceHosts = [
  'bing.com', 'google.com', 'linkedin.com', 'upwork.com', 'facebook.com', 'instagram.com',
  'twitter.com', 'x.com', 'youtube.com', 'medium.com', 'wikipedia.org', 'wikimedia.org',
  'imdb.com', 'github.com', 'gitlab.com', 'stackoverflow.com', 'remoteok.com',
];
const contactPathPattern = /(?:^|\/)(?:contact(?:-us)?|get-in-touch|request-demo|book-demo|talk-to-us|sales|enquir(?:y|ies)|connect)(?:\/|$|[?#])/i;
const professionalProfilePattern = /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i;
const buyerRolePattern = /(?:Founder|Co-Founder|Chief Executive Officer|CEO|Chief Technology Officer|CTO|Chief Information Officer|CIO|Chief Information Security Officer|CISO|Chief Operating Officer|COO|Managing Director|Technical Director|Director of Engineering|Head of Product|Head of Engineering|Head of Technology|Head of IT|Head of Marketing|Marketing Director|Procurement Director|Procurement Manager|Operations Director|VP of Engineering|VP Engineering|VP Product)/i;
const publicSuffixes = new Set([
  'co.uk', 'org.uk', 'com.au', 'com.pk', 'com.sa', 'com.ae', 'co.za', 'co.in', 'co.nz',
  'com.sg', 'com.my', 'co.jp', 'com.cn', 'com.mx', 'com.tr', 'com.br',
]);

export async function enrichRepositoryContacts(input: EnrichRepositoryContactsInput): Promise<EnrichRepositoryContactsResult> {
  const actor = input.actor ?? 'public-contact-enrichment';
  const selectedIds = new Set(input.leadIds ?? []);
  const records = input.repository.listLeads()
    .filter((record) => !record.lead.tender)
    .filter((record) => !finalStatuses.has(record.lead.pipelineStatus))
    .filter((record) => selectedIds.size === 0 || selectedIds.has(record.lead.id))
    .sort(enrichmentPriority)
    .slice(0, Math.max(1, input.maxRecords ?? 20));

  const result: EnrichRepositoryContactsResult = {
    checked: 0,
    updated: 0,
    ready: 0,
    partial: 0,
    researchRequired: 0,
    errors: [],
  };

  for (const record of records) {
    result.checked += 1;
    try {
      const enrichment = await verifyPublicContactEnrichment({
        lead: record.lead,
        fetchImpl: input.fetchImpl,
        checkedAt: input.now?.() ?? new Date().toISOString(),
      });
      result[statusCounter(enrichment.status)] += 1;
      const updated = applyEnrichment(record.lead, enrichment);
      if (JSON.stringify(updated) === JSON.stringify(record.lead)) continue;
      input.repository.upsertLead(updated, actor);
      input.repository.addNote(
        record.lead.id,
        `contact-enrichment::${enrichment.status}::${enrichment.confidence}::${enrichment.missingData.join(' | ') || 'ready'}`,
        actor,
      );
      result.updated += 1;
    } catch (error) {
      result.errors.push({ leadId: record.lead.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export async function verifyPublicContactEnrichment(input: {
  lead: Lead;
  fetchImpl: ProspectFetch;
  checkedAt?: string;
}): Promise<PublicContactEnrichment> {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const evidenceUrls = candidateEvidenceUrls(input.lead);
  const pages: Array<{ url: string; html: string }> = [];

  for (const url of evidenceUrls.slice(0, 2)) {
    try {
      const response = await fetchWithTimeout(input.fetchImpl, url, 12_000);
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!response.ok || (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml'))) continue;
      const html = (await response.text()).slice(0, 1_500_000);
      pages.push({ url: response.url || url, html });
    } catch {
      // A failed public page remains a research gap; it is never treated as verified evidence.
    }
  }

  const officialWebsite = resolveOfficialWebsite(input.lead, pages);
  const officialDomain = officialWebsite ? registrableDomain(new URL(officialWebsite).hostname) : undefined;
  const rejectedPersonalEmails: string[] = [];
  const businessEmails: string[] = [];
  let contactFormUrl: string | undefined;
  let publicProfessionalProfileUrl: string | undefined;
  let buyerName: string | undefined;
  let buyerRole: string | undefined;
  let companyName: string | undefined;

  for (const page of pages) {
    const pageUrl = new URL(page.url);
    const emails = extractEmails(page.html);
    for (const email of emails) {
      const domain = email.split('@')[1]?.toLowerCase();
      if (!domain || personalEmailDomains.has(domain)) {
        rejectedPersonalEmails.push(email);
        continue;
      }
      if (officialDomain && registrableDomain(domain) === officialDomain) businessEmails.push(email);
    }
    contactFormUrl ??= extractContactFormUrl(page.html, pageUrl, officialDomain);
    publicProfessionalProfileUrl ??= extractProfessionalProfile(page.html);
    const buyer = extractBuyer(page.html);
    buyerName ??= buyer?.name;
    buyerRole ??= buyer?.role;
    companyName ??= extractOrganizationName(page.html);
  }

  const verifiedBusinessEmail = chooseBusinessEmail(businessEmails, input.lead.contactEmail, officialDomain, rejectedPersonalEmails);
  const existingContactForm = sameOrganizationUrl(input.lead.contactFormUrl, officialDomain) ? normalizePublicUrl(input.lead.contactFormUrl) : undefined;
  const existingProfessionalProfile = professionalProfilePattern.test(input.lead.linkedinUrl ?? '') ? normalizePublicUrl(input.lead.linkedinUrl) : undefined;
  const resolvedContactForm = contactFormUrl ?? existingContactForm;
  const resolvedProfile = publicProfessionalProfileUrl ?? existingProfessionalProfile;
  const resolvedBuyerName = buyerName ?? input.lead.contactName;
  const resolvedBuyerRole = buyerRole ?? (buyerRolePattern.test(input.lead.contactRole ?? '') ? input.lead.contactRole : undefined);

  const missingData: string[] = [];
  if (!officialWebsite) missingData.push('Verify the official company website.');
  if (!resolvedBuyerRole) missingData.push('Identify and verify the relevant buyer role.');
  if (!verifiedBusinessEmail && !resolvedContactForm) missingData.push('Find a verified public business email or official contact form.');
  if (!resolvedBuyerName) missingData.push('Verify the buyer or decision-maker name.');

  const status: ContactReadiness = officialWebsite && (verifiedBusinessEmail || resolvedContactForm)
    ? 'ready'
    : officialWebsite || resolvedContactForm || resolvedProfile || resolvedBuyerRole
      ? 'partial'
      : 'research_required';
  const confidence: EnrichmentConfidence = verifiedBusinessEmail && officialWebsite
    ? 'high'
    : officialWebsite && (resolvedContactForm || resolvedBuyerRole)
      ? 'medium'
      : 'low';

  return {
    version: 1,
    status,
    confidence,
    officialWebsite,
    verifiedBusinessEmail,
    contactFormUrl: resolvedContactForm,
    publicProfessionalProfileUrl: resolvedProfile,
    buyerName: resolvedBuyerName,
    buyerRole: resolvedBuyerRole,
    evidenceUrls: unique(pages.map((page) => page.url)),
    checkedAt,
    missingData: unique(missingData),
    rejectedPersonalEmails: unique(rejectedPersonalEmails),
    ...(companyName ? { companyName } : {}),
  } as PublicContactEnrichment & { companyName?: string };
}

export function getStoredContactEnrichment(lead: Lead): PublicContactEnrichment | undefined {
  const raw = asRecord(lead.rawPayload);
  const value = asRecord(raw?.contactEnrichment);
  if (!value || value.version !== 1 || typeof value.status !== 'string' || typeof value.checkedAt !== 'string') return undefined;
  return value as unknown as PublicContactEnrichment;
}

function applyEnrichment(lead: Lead, enrichment: PublicContactEnrichment & { companyName?: string }): Lead {
  const existingRaw = asRecord(lead.rawPayload) ?? {};
  const businessEmail = enrichment.verifiedBusinessEmail ?? verifiedExistingBusinessEmail(lead.contactEmail, enrichment.officialWebsite);
  const updatedAt = enrichment.checkedAt;
  return {
    ...lead,
    companyName: lead.companyName ?? enrichment.companyName,
    companyWebsite: enrichment.officialWebsite ?? lead.companyWebsite,
    contactName: lead.contactName ?? enrichment.buyerName,
    contactRole: lead.contactRole ?? enrichment.buyerRole,
    contactEmail: businessEmail,
    contactFormUrl: enrichment.contactFormUrl ?? lead.contactFormUrl,
    linkedinUrl: enrichment.publicProfessionalProfileUrl ?? lead.linkedinUrl,
    reachMethod: enrichment.status === 'ready'
      ? businessEmail
        ? 'Verified public business email; prepare human-reviewed outreach.'
        : 'Verified official contact form; prepare human-reviewed outreach.'
      : lead.reachMethod,
    rawPayload: { ...existingRaw, contactEnrichment: enrichment },
    updatedAt,
  };
}

function candidateEvidenceUrls(lead: Lead): string[] {
  const urls = [lead.companyWebsite, lead.evidenceUrl, lead.sourceUrl]
    .map(normalizePublicUrl)
    .filter((value): value is string => Boolean(value))
    .filter((value) => !isBlockedEvidenceHost(new URL(value).hostname));
  if (lead.companyWebsite) return unique(urls).sort((left) => left === normalizePublicUrl(lead.companyWebsite) ? -1 : 1);
  return unique(urls);
}

function resolveOfficialWebsite(lead: Lead, pages: Array<{ url: string; html: string }>): string | undefined {
  const existing = normalizePublicUrl(lead.companyWebsite);
  if (existing && !isBlockedEvidenceHost(new URL(existing).hostname)) return origin(existing);
  for (const page of pages) {
    const url = new URL(page.url);
    if (isBlockedEvidenceHost(url.hostname)) continue;
    if (!['public_web', 'partner_research', 'solution_campaign', 'manual', 'linkedin', 'sales_navigator'].includes(lead.source)) continue;
    if (!hasOrganizationEvidence(page.html, lead.companyName)) continue;
    return url.origin;
  }
  return undefined;
}

function hasOrganizationEvidence(html: string, expectedName: string | undefined): boolean {
  const text = stripHtml(html).slice(0, 100_000);
  if (expectedName && text.toLowerCase().includes(expectedName.toLowerCase())) return true;
  return /\b(?:about us|our company|our team|our services|contact us|request a demo|book a demo|solutions|customers|clients)\b/i.test(text);
}

function extractEmails(html: string): string[] {
  const decoded = decodeEntities(html);
  const mailto = [...decoded.matchAll(/mailto:([^?"'<>\s]+)/gi)].map((match) => decodeURIComponent(match[1] ?? ''));
  const plain = [...decoded.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map((match) => match[0]);
  return unique([...mailto, ...plain].map(normalizeEmail).filter((value): value is string => Boolean(value)))
    .filter((email) => !/^(?:no-?reply|donotreply|privacy|legal|abuse|webmaster)@/i.test(email));
}

function chooseBusinessEmail(
  emails: string[],
  existingEmail: string | undefined,
  officialDomain: string | undefined,
  rejectedPersonalEmails: string[],
): string | undefined {
  const existing = normalizeEmail(existingEmail);
  if (existing) {
    const domain = existing.split('@')[1] ?? '';
    if (personalEmailDomains.has(domain)) rejectedPersonalEmails.push(existing);
    else if (officialDomain && registrableDomain(domain) === officialDomain) emails.unshift(existing);
  }
  return unique(emails).sort(emailPriority)[0];
}

function emailPriority(left: string, right: string): number {
  const priorities = ['sales@', 'business@', 'partnerships@', 'hello@', 'contact@', 'info@'];
  const leftScore = priorities.findIndex((prefix) => left.startsWith(prefix));
  const rightScore = priorities.findIndex((prefix) => right.startsWith(prefix));
  return (leftScore < 0 ? 99 : leftScore) - (rightScore < 0 ? 99 : rightScore);
}

function extractContactFormUrl(html: string, pageUrl: URL, officialDomain: string | undefined): string | undefined {
  const candidates = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => absoluteUrl(match[1] ?? '', pageUrl))
    .filter((value): value is string => Boolean(value))
    .filter((value) => contactPathPattern.test(new URL(value).pathname))
    .filter((value) => !officialDomain || registrableDomain(new URL(value).hostname) === officialDomain);
  return unique(candidates)[0];
}

function extractProfessionalProfile(html: string): string | undefined {
  const match = [...html.matchAll(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/gi)][0];
  return match?.[0] ? normalizePublicUrl(match[0]) : undefined;
}

function extractBuyer(html: string): { name: string; role: string } | undefined {
  const decoded = decodeEntities(html);
  const jsonLd = decoded.match(/"name"\s*:\s*"([A-Z][^"<>]{2,80})"[\s\S]{0,250}?"jobTitle"\s*:\s*"([^"]{2,80})"/i)
    ?? decoded.match(/"jobTitle"\s*:\s*"([^"]{2,80})"[\s\S]{0,250}?"name"\s*:\s*"([A-Z][^"<>]{2,80})"/i);
  if (jsonLd) {
    const first = cleanText(jsonLd[1] ?? '');
    const second = cleanText(jsonLd[2] ?? '');
    const role = buyerRolePattern.test(second) ? second : buyerRolePattern.test(first) ? first : undefined;
    const name = role === second ? first : second;
    if (role && validPersonName(name)) return { name, role };
  }

  const text = stripHtml(decoded).replace(/\s+/g, ' ');
  const roleFirst = text.match(new RegExp(`(${buyerRolePattern.source})\\s*(?:[-–—|,:]|is)\\s*([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,3})`, 'i'));
  if (roleFirst?.[1] && roleFirst[2] && validPersonName(roleFirst[2])) return { name: cleanText(roleFirst[2]), role: cleanText(roleFirst[1]) };
  const nameFirst = text.match(new RegExp(`([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,3})\\s*(?:[-–—|,:]|is)\\s*(${buyerRolePattern.source})`, 'i'));
  if (nameFirst?.[1] && nameFirst[2] && validPersonName(nameFirst[1])) return { name: cleanText(nameFirst[1]), role: cleanText(nameFirst[2]) };
  return undefined;
}

function extractOrganizationName(html: string): string | undefined {
  const decoded = decodeEntities(html);
  const jsonLd = decoded.match(/"@type"\s*:\s*"(?:Organization|Corporation|LocalBusiness)"[\s\S]{0,400}?"name"\s*:\s*"([^"]{2,120})"/i);
  if (jsonLd?.[1]) return cleanText(jsonLd[1]);
  const siteName = decoded.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
    ?? decoded.match(/content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
  return siteName?.[1] ? cleanText(siteName[1]) : undefined;
}

function verifiedExistingBusinessEmail(email: string | undefined, website: string | undefined): string | undefined {
  const normalized = normalizeEmail(email);
  if (!normalized || !website) return undefined;
  const domain = normalized.split('@')[1] ?? '';
  return !personalEmailDomains.has(domain) && registrableDomain(domain) === registrableDomain(new URL(website).hostname) ? normalized : undefined;
}

function sameOrganizationUrl(value: string | undefined, officialDomain: string | undefined): boolean {
  const normalized = normalizePublicUrl(value);
  if (!normalized || !officialDomain) return false;
  return registrableDomain(new URL(normalized).hostname) === officialDomain;
}

async function fetchWithTimeout(fetchImpl: ProspectFetch, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'CodistanPublicContactVerifier/1.0 (+https://codistan.org)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function enrichmentPriority(left: { lead: Lead }, right: { lead: Lead }): number {
  const leftExisting = getStoredContactEnrichment(left.lead)?.status === 'ready' ? 1 : 0;
  const rightExisting = getStoredContactEnrichment(right.lead)?.status === 'ready' ? 1 : 0;
  if (leftExisting !== rightExisting) return leftExisting - rightExisting;
  const leftPriority = left.lead.pipelineStatus === 'approved_to_contact' || left.lead.pipelineStatus === 'draft_ready' ? 1 : 0;
  const rightPriority = right.lead.pipelineStatus === 'approved_to_contact' || right.lead.pipelineStatus === 'draft_ready' ? 1 : 0;
  return rightPriority - leftPriority;
}

function statusCounter(status: ContactReadiness): 'ready' | 'partial' | 'researchRequired' {
  return status === 'research_required' ? 'researchRequired' : status;
}

function normalizePublicUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function absoluteUrl(value: string, base: URL): string | undefined {
  if (!value || /^(?:mailto:|tel:|javascript:|#)/i.test(value)) return undefined;
  try { return new URL(decodeEntities(value), base).toString(); } catch { return undefined; }
}

function origin(value: string): string { return new URL(value).origin; }
function normalizeEmail(value: string | undefined): string | undefined { const normalized = value?.trim().toLowerCase(); return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined; }
function isBlockedEvidenceHost(hostname: string): boolean { const host = hostname.toLowerCase().replace(/^www\./, ''); return blockedEvidenceHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`)); }
function registrableDomain(hostname: string): string { const parts = hostname.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean); if (parts.length <= 2) return parts.join('.'); const suffix = parts.slice(-2).join('.'); return publicSuffixes.has(suffix) ? parts.slice(-3).join('.') : suffix; }
function validPersonName(value: string): boolean { return value.split(/\s+/).length >= 2 && value.length <= 80 && !/company|team|solutions|services|group|agency|technology/i.test(value); }
function cleanText(value: string): string { return decodeEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function stripHtml(value: string): string { return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); }
function decodeEntities(value: string): string { return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ').replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code))); }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
