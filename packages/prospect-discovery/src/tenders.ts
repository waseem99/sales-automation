import type {
  TenderMetadata,
  TenderOpportunityType,
  TenderSector,
  TenderTriState,
} from '@sales-automation/shared';
import { collectBingRssCandidates, fetchWithTimeout } from './sources.js';
import type { DiscoveryCandidate, ProspectFetch, ProspectSourceResult, TenderCandidateMetadata } from './types.js';

const PPRA_ACTIVE_URL = 'https://epms.ppra.gov.pk/public/tenders/active-tenders';
const CANADABUYS_URL = 'https://canadabuys.canada.ca/en/tender-opportunities';

const softwareTerms = [
  'software development', 'application development', 'web application', 'mobile application', 'mobile app',
  'website development', 'website redesign', 'web portal', 'digital platform', 'management information system',
  'mis', 'enterprise resource planning', 'erp', 'customer relationship management', 'crm',
  'learning management system', 'lms', 'data platform', 'dashboard', 'business intelligence',
  'artificial intelligence', 'machine learning', 'generative ai', 'rag', 'chatbot', 'automation',
  'system integration', 'api development', 'cloud migration', 'cybersecurity', 'information security',
  'penetration testing', 'ui/ux', 'application maintenance', 'managed it services', 'digital transformation',
  'it services', 'information technology services', 'computer software', 'software solution',
];

const formalTenderTerms = [
  'request for proposal', 'rfp', 'request for quotation', 'rfq', 'expression of interest', 'eoi',
  'invitation to bid', 'invitation to tender', 'itt', 'tender', 'prequalification', 'pre-qualification',
  'request for information', 'rfi', 'call for proposal', 'implementing partner', 'framework agreement',
  'vendor empanelment', 'supply arrangement',
];

const hardwareTerms = [
  'desktop computer', 'laptop', 'printer', 'server hardware', 'network equipment', 'router', 'switches',
  'cctv', 'camera', 'ups', 'toner', 'cartridge', 'computer accessories', 'it equipment', 'hardware material',
];

const directDeliveryTerms = [
  'development', 'implementation', 'integration', 'maintenance', 'consulting', 'consultancy', 'services',
  'platform', 'portal', 'application', 'software', 'system', 'solution', 'automation', 'cybersecurity',
];

export const DEFAULT_UNGM_TENDER_QUERIES = [
  'site:ungm.org/Public/Notice "request for proposal" software',
  'site:ungm.org/Public/Notice "request for quotation" "IT services"',
  'site:ungm.org/Public/Notice "web portal" OR "digital platform"',
  'site:ungm.org/Public/Notice "software development" OR "application development"',
  'site:ungm.org/Public/Notice "artificial intelligence" OR automation',
  'site:ungm.org/Public/Notice cybersecurity OR "information security"',
];

export const DEFAULT_PRIVATE_NONPROFIT_TENDER_QUERIES = [
  '(Pakistan OR Canada) (RFP OR "request for proposal") ("software development" OR "web portal")',
  '(Pakistan OR Canada) (RFQ OR tender) ("digital platform" OR "mobile application")',
  '(Pakistan OR Canada) nonprofit NGO foundation (RFP OR EOI) software',
  '(Pakistan OR Canada) university hospital bank (RFP OR tender) "IT services"',
  'Pakistan private sector "request for proposal" software development',
  'Canada nonprofit "request for proposal" digital platform',
];

export async function collectPpraTenderCandidates(fetchImpl: ProspectFetch): Promise<ProspectSourceResult> {
  try {
    const response = await fetchWithTimeout(fetchImpl, PPRA_ACTIVE_URL, {}, 25_000);
    if (!response.ok) return fallbackPortalSearch(fetchImpl, 'pakistan_ppra', [
      'site:epms.ppra.gov.pk/public/tenders software development',
      'site:epms.ppra.gov.pk/public/tenders web portal OR digital platform',
      'site:epms.ppra.gov.pk/public/tenders cybersecurity OR IT services',
    ], 'Pakistan PPRA/EPADS', 'Pakistan', 'public', `HTTP ${response.status}`);
    const html = await response.text();
    const candidates = parsePpraRows(html);
    if (candidates.length > 0) return { sourceName: 'pakistan_ppra', checked: candidates.length, candidates };
    return fallbackPortalSearch(fetchImpl, 'pakistan_ppra', [
      'site:epms.ppra.gov.pk/public/tenders software development',
      'site:epms.ppra.gov.pk/public/tenders web portal OR digital platform',
      'site:epms.ppra.gov.pk/public/tenders cybersecurity OR IT services',
    ], 'Pakistan PPRA/EPADS', 'Pakistan', 'public', 'Direct page returned no software tender rows; public-search fallback used.');
  } catch (error) {
    return fallbackPortalSearch(fetchImpl, 'pakistan_ppra', [
      'site:epms.ppra.gov.pk/public/tenders software development',
      'site:epms.ppra.gov.pk/public/tenders web portal OR digital platform',
      'site:epms.ppra.gov.pk/public/tenders cybersecurity OR IT services',
    ], 'Pakistan PPRA/EPADS', 'Pakistan', 'public', (error as Error).message);
  }
}

export async function collectCanadaBuysTenderCandidates(fetchImpl: ProspectFetch): Promise<ProspectSourceResult> {
  try {
    const response = await fetchWithTimeout(fetchImpl, CANADABUYS_URL, {}, 25_000);
    if (!response.ok) return fallbackPortalSearch(fetchImpl, 'canadabuys', [
      'site:canadabuys.canada.ca/en/tender-opportunities "application development"',
      'site:canadabuys.canada.ca/en/tender-opportunities "software development"',
      'site:canadabuys.canada.ca/en/tender-opportunities "digital platform" OR "web portal"',
      'site:canadabuys.canada.ca/en/tender-opportunities "IT professional services"',
    ], 'CanadaBuys', 'Canada', 'public', `HTTP ${response.status}`);
    const html = await response.text();
    const candidates = parseCanadaBuysRows(html);
    if (candidates.length > 0) return { sourceName: 'canadabuys', checked: candidates.length, candidates };
    return fallbackPortalSearch(fetchImpl, 'canadabuys', [
      'site:canadabuys.canada.ca/en/tender-opportunities "application development"',
      'site:canadabuys.canada.ca/en/tender-opportunities "software development"',
      'site:canadabuys.canada.ca/en/tender-opportunities "digital platform" OR "web portal"',
      'site:canadabuys.canada.ca/en/tender-opportunities "IT professional services"',
    ], 'CanadaBuys', 'Canada', 'public', 'Direct page returned no software tender rows; public-search fallback used.');
  } catch (error) {
    return fallbackPortalSearch(fetchImpl, 'canadabuys', [
      'site:canadabuys.canada.ca/en/tender-opportunities "application development"',
      'site:canadabuys.canada.ca/en/tender-opportunities "software development"',
      'site:canadabuys.canada.ca/en/tender-opportunities "digital platform" OR "web portal"',
      'site:canadabuys.canada.ca/en/tender-opportunities "IT professional services"',
    ], 'CanadaBuys', 'Canada', 'public', (error as Error).message);
  }
}

export async function collectUngmTenderCandidates(fetchImpl: ProspectFetch): Promise<ProspectSourceResult> {
  return fallbackPortalSearch(
    fetchImpl,
    'ungm',
    DEFAULT_UNGM_TENDER_QUERIES,
    'UNGM',
    undefined,
    'development',
  );
}

export async function collectPrivateNonprofitTenderCandidates(fetchImpl: ProspectFetch): Promise<ProspectSourceResult> {
  const search = await collectBingRssCandidates(fetchImpl, DEFAULT_PRIVATE_NONPROFIT_TENDER_QUERIES, DEFAULT_PRIVATE_NONPROFIT_TENDER_QUERIES.length);
  const candidates = search.candidates
    .filter((candidate) => isSoftwareTender(`${candidate.title} ${candidate.summary}`))
    .map((candidate) => {
      const text = `${candidate.title} ${candidate.summary}`;
      const country = /\bcanada|canadian\b/i.test(text) ? 'Canada' : /\bpakistan|pakistani\b/i.test(text) ? 'Pakistan' : candidate.country;
      const sector: TenderSector = /nonprofit|non-profit|ngo|foundation|charity|humanitarian|development programme/i.test(text)
        ? 'nonprofit'
        : 'private';
      return normalizeTenderCandidate(candidate, {
        portal: 'Private and nonprofit public notices',
        sector,
        opportunityType: classifyTenderOpportunityType(text),
        publishedAt: candidate.publishedAt,
      }, country);
    });
  return {
    sourceName: 'private_nonprofit_tenders',
    checked: search.checked,
    candidates,
    error: search.error,
  };
}

export function buildTenderMetadata(candidate: DiscoveryCandidate, capturedAt: string): TenderMetadata | undefined {
  if (!candidate.tender) return undefined;
  const text = `${candidate.title} ${candidate.summary} ${candidate.evidenceSummary ?? ''}`;
  const deadline = normalizeIsoDate(candidate.tender.deadline);
  const publishedAt = normalizeIsoDate(candidate.tender.publishedAt ?? candidate.publishedAt);
  const daysRemaining = deadline ? Math.ceil((Date.parse(deadline) - Date.parse(capturedAt)) / 86_400_000) : undefined;
  const localPresenceRequired = candidate.tender.localPresenceRequired ?? inferLocalPresence(text);
  const consortiumAllowed = candidate.tender.consortiumAllowed ?? inferConsortium(text);
  const riskFlags = unique([
    ...(candidate.tender.riskFlags ?? []),
    ...inferRiskFlags(text, daysRemaining, localPresenceRequired, consortiumAllowed),
  ]);
  const eligibilitySignals = unique([
    ...(candidate.tender.eligibilitySignals ?? []),
    ...inferEligibilitySignals(text),
  ]);

  let score = 0;
  const matchingTerms = softwareTerms.filter((term) => normalize(text).includes(term));
  score += matchingTerms.length >= 3 ? 25 : matchingTerms.length >= 1 ? 20 : 10;
  score += riskFlags.some((flag) => /mandatory local|security clearance|citizenship/i.test(flag)) ? 8 : 16;
  score += matchingTerms.some((term) => /software|application|portal|platform|ai|cybersecurity|system integration/i.test(term)) ? 15 : 10;
  score += candidate.tender.estimatedValue || /budget|estimated cost|funded|contract value/i.test(text) ? 12 : 7;
  score += daysRemaining === undefined ? 5 : daysRemaining >= 7 ? 10 : daysRemaining >= 3 ? 6 : daysRemaining >= 1 ? 2 : 0;
  score += localPresenceRequired === 'no' ? 10 : localPresenceRequired === 'unclear' ? 6 : consortiumAllowed === 'yes' ? 5 : 0;
  score += candidate.tender.reference && deadline ? 5 : candidate.tender.reference || deadline ? 3 : 1;
  score = Math.max(0, Math.min(100, score));

  let recommendation: TenderMetadata['recommendation'];
  if ((daysRemaining !== undefined && daysRemaining < 0) || (localPresenceRequired === 'yes' && consortiumAllowed === 'no')) {
    recommendation = 'reject';
  } else if (score >= 80) {
    recommendation = 'priority_bid';
  } else if (score >= 65) {
    recommendation = 'review_now';
  } else if (score >= 50) {
    recommendation = 'partner_or_consortium';
  } else {
    recommendation = 'reject';
  }

  return {
    portal: candidate.tender.portal,
    reference: candidate.tender.reference,
    sector: candidate.tender.sector,
    opportunityType: candidate.tender.opportunityType,
    publishedAt,
    deadline,
    daysRemaining,
    estimatedValue: candidate.tender.estimatedValue,
    submissionMethod: candidate.tender.submissionMethod,
    localPresenceRequired,
    consortiumAllowed,
    closeabilityScore: score,
    recommendation,
    recommendationReason: recommendationReason(recommendation, score, daysRemaining, riskFlags),
    eligibilitySignals,
    riskFlags,
  };
}

export function isSoftwareTender(text: string): boolean {
  const normalized = normalize(text);
  const softwareMatch = softwareTerms.some((term) => normalized.includes(term));
  const formalMatch = formalTenderTerms.some((term) => normalized.includes(term));
  if (!softwareMatch || !formalMatch) return false;
  const hardwareOnly = hardwareTerms.some((term) => normalized.includes(term))
    && !directDeliveryTerms.some((term) => normalized.includes(term));
  return !hardwareOnly;
}

export function classifyTenderOpportunityType(text: string): TenderOpportunityType {
  const normalized = normalize(text);
  if (/request for proposal|\brfp\b/.test(normalized)) return 'rfp';
  if (/request for quotation|\brfq\b/.test(normalized)) return 'rfq';
  if (/expression of interest|\beoi\b/.test(normalized)) return 'eoi';
  if (/invitation to tender|invitation to bid|\bitt\b/.test(normalized)) return 'itt';
  if (/prequalification|pre-qualification/.test(normalized)) return 'prequalification';
  if (/request for information|\brfi\b/.test(normalized)) return 'rfi';
  if (/grant support|call for proposal/.test(normalized)) return 'grant_call';
  if (/implementing partner/.test(normalized)) return 'implementing_partner';
  return 'other';
}

function parsePpraRows(html: string): DiscoveryCandidate[] {
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const candidates: DiscoveryCandidate[] = [];
  for (const row of rows) {
    const text = stripHtml(row);
    const reference = text.match(/\bTS\d{6,}E\b/i)?.[0];
    if (!reference || !isSoftwareTender(text)) continue;
    const dates = extractMonthDates(text);
    const links = extractLinks(row, PPRA_ACTIVE_URL);
    const sourceUrl = links.find((link) => /tender|notice|detail|view/i.test(link.href))?.href ?? `${PPRA_ACTIVE_URL}#${reference}`;
    const title = extractPpraTitle(text, reference);
    candidates.push({
      sourceName: 'Pakistan PPRA/EPADS',
      sourceType: 'procurement',
      sourceUrl,
      title,
      summary: shorten(text, 1_500),
      publishedAt: dates[0],
      companyName: inferPpraOrganization(text) ?? 'Pakistan public-sector procuring agency',
      companyWebsite: 'https://ppra.gov.pk/',
      country: 'Pakistan',
      opportunityStatus: 'live_opportunity',
      tags: matchingSoftwareTerms(text),
      evidenceSummary: `Active Pakistan federal procurement notice ${reference} found on PPRA/EPADS.`,
      tender: {
        portal: 'Pakistan PPRA/EPADS',
        reference,
        sector: 'public',
        opportunityType: classifyTenderOpportunityType(text),
        publishedAt: dates[0],
        deadline: dates.at(-1),
        submissionMethod: /e-bid|epads|online/i.test(text) ? 'EPADS electronic submission' : 'Review official PPRA notice',
        estimatedValue: extractEstimatedValue(text),
      },
    });
  }
  return dedupe(candidates);
}

function parseCanadaBuysRows(html: string): DiscoveryCandidate[] {
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const candidates: DiscoveryCandidate[] = [];
  for (const row of rows) {
    const text = stripHtml(row);
    if (!isSoftwareTender(text)) continue;
    const links = extractLinks(row, CANADABUYS_URL);
    const notice = links.find((link) => /tender-opportunities|tender-notice/i.test(link.href) && isSoftwareTender(`${link.text} tender`));
    const title = notice?.text || extractCanadaTitle(text);
    if (!title || title.length < 8) continue;
    const dates = extractSlashDates(text);
    const organization = inferCanadaOrganization(text, dates) ?? 'Canadian public-sector buyer';
    const reference = notice?.href.match(/(?:notice|tender)[-/]([A-Za-z0-9_-]+)/i)?.[1];
    candidates.push({
      sourceName: 'CanadaBuys',
      sourceType: 'procurement',
      sourceUrl: notice?.href ?? CANADABUYS_URL,
      title,
      summary: shorten(text, 1_500),
      publishedAt: dates[0],
      companyName: organization,
      companyWebsite: 'https://canadabuys.canada.ca/',
      country: 'Canada',
      opportunityStatus: 'live_opportunity',
      tags: matchingSoftwareTerms(text),
      evidenceSummary: 'Active Canadian public procurement notice found on CanadaBuys.',
      tender: {
        portal: 'CanadaBuys',
        reference,
        sector: 'public',
        opportunityType: classifyTenderOpportunityType(text),
        publishedAt: dates[0],
        deadline: dates[1],
        submissionMethod: 'Follow the submission method stated in the CanadaBuys notice',
        estimatedValue: extractEstimatedValue(text),
      },
    });
  }
  return dedupe(candidates);
}

async function fallbackPortalSearch(
  fetchImpl: ProspectFetch,
  sourceName: string,
  queries: string[],
  portal: string,
  country: string | undefined,
  sector: TenderSector,
  directError?: string,
): Promise<ProspectSourceResult> {
  const search = await collectBingRssCandidates(fetchImpl, queries, queries.length);
  const candidates = search.candidates
    .filter((candidate) => isSoftwareTender(`${candidate.title} ${candidate.summary} tender`))
    .map((candidate) => normalizeTenderCandidate(candidate, {
      portal,
      sector,
      opportunityType: classifyTenderOpportunityType(`${candidate.title} ${candidate.summary}`),
      publishedAt: candidate.publishedAt,
    }, country));
  return {
    sourceName,
    checked: search.checked,
    candidates,
    error: [directError, search.error].filter(Boolean).join('; ') || undefined,
  };
}

function normalizeTenderCandidate(
  candidate: DiscoveryCandidate,
  tender: TenderCandidateMetadata,
  country?: string,
): DiscoveryCandidate {
  return {
    ...candidate,
    sourceName: tender.portal,
    sourceType: 'procurement',
    country: country ?? candidate.country,
    companyName: candidate.companyName ?? `${tender.portal} buyer`,
    companyWebsite: candidate.companyWebsite ?? portalWebsite(tender.portal),
    opportunityStatus: 'live_opportunity',
    evidenceSummary: `Formal procurement opportunity discovered from ${tender.portal}.`,
    tender,
  };
}

function inferLocalPresence(text: string): TenderTriState {
  const normalized = normalize(text);
  if (/must be (?:a )?(?:canadian|pakistani)|registered in (?:canada|pakistan)|local office required|resident supplier|security clearance|citizenship required/.test(normalized)) return 'yes';
  if (/international firms|international suppliers|global suppliers|remote delivery|virtual delivery|overseas bidders|open to all eligible/.test(normalized)) return 'no';
  return 'unclear';
}

function inferConsortium(text: string): TenderTriState {
  const normalized = normalize(text);
  if (/consortium|joint venture|jv partner|subcontractor|local partner allowed|association of firms/.test(normalized)) return 'yes';
  if (/consortium not allowed|joint ventures? not allowed|no subcontracting/.test(normalized)) return 'no';
  return 'unclear';
}

function inferRiskFlags(text: string, daysRemaining: number | undefined, local: TenderTriState, consortium: TenderTriState): string[] {
  const flags: string[] = [];
  const normalized = normalize(text);
  if (daysRemaining !== undefined && daysRemaining < 0) flags.push('Submission deadline has passed.');
  else if (daysRemaining !== undefined && daysRemaining < 2) flags.push('Less than 48 hours remain before the submission deadline.');
  if (/security clearance|secret clearance|reliability status/.test(normalized)) flags.push('Security clearance may be mandatory.');
  if (/must be canadian|canadian supplier only|registered in canada/.test(normalized)) flags.push('Mandatory Canadian supplier or local-incorporation requirement may apply.');
  if (/must be pakistani|registered in pakistan|local firm only/.test(normalized)) flags.push('Mandatory Pakistani supplier or local-incorporation requirement may apply.');
  if (/physical submission|hard copy submission|sealed envelope/.test(normalized)) flags.push('Physical submission may be required.');
  if (/bid security|earnest money|performance guarantee|bid bond/.test(normalized)) flags.push('Bid security or financial guarantee may be required.');
  if (local === 'yes' && consortium === 'unclear') flags.push('Local presence appears required; consortium eligibility must be confirmed.');
  return flags;
}

function inferEligibilitySignals(text: string): string[] {
  const normalized = normalize(text);
  const signals: string[] = [];
  if (/years? of experience|similar assignments|similar projects|past performance/.test(normalized)) signals.push('Relevant prior-project experience is required.');
  if (/certification|iso 27001|iso 9001|cmmc|soc 2|pci dss/.test(normalized)) signals.push('Professional or compliance certifications may be evaluated.');
  if (/team lead|project manager|software architect|key personnel|curriculum vitae|\bcv\b/.test(normalized)) signals.push('Named key personnel or CVs may be required.');
  if (/technical proposal/.test(normalized)) signals.push('Technical proposal submission is required.');
  if (/financial proposal|price proposal/.test(normalized)) signals.push('Separate financial proposal may be required.');
  return signals;
}

function recommendationReason(
  recommendation: TenderMetadata['recommendation'],
  score: number,
  daysRemaining: number | undefined,
  risks: string[],
): string {
  const deadline = daysRemaining === undefined ? 'deadline requires confirmation' : `${daysRemaining} days remain`;
  const risk = risks[0] ? ` Main risk: ${risks[0]}` : '';
  if (recommendation === 'priority_bid') return `Strong service fit and workable eligibility profile; ${deadline}. Prepare an immediate bid/no-bid review.${risk}`;
  if (recommendation === 'review_now') return `Good potential fit with a closeability score of ${score}; ${deadline}. Confirm mandatory eligibility before committing proposal effort.${risk}`;
  if (recommendation === 'partner_or_consortium') return `Relevant opportunity, but local eligibility or evidence gaps reduce direct closeability. Assess a local partner or consortium route.${risk}`;
  return `Current score or eligibility risk does not justify full bidding effort without new information.${risk}`;
}

function extractPpraTitle(text: string, reference: string): string {
  const after = text.slice(text.toLowerCase().indexOf(reference.toLowerCase()) + reference.length).trim();
  const title = after.split(/\b(?:miscellaneous|services|civil works|equipments?|health\/medicines|electrical items|info and comm tech|published)\b/i)[0]?.trim();
  return shorten(title && title.length >= 8 ? title : after, 220);
}

function extractCanadaTitle(text: string): string {
  return shorten(text.split(/\b(?:services|goods|construction)\b/i)[0]?.trim() ?? text, 220);
}

function inferPpraOrganization(text: string): string | undefined {
  const matches = text.match(/(?:Ministry of [A-Za-z &()/-]+|Higher Education Commission(?: \(HEC\))?|[A-Z][A-Za-z &()/-]+ (?:Limited|Ltd\.|Corporation|University|Authority|Commission|Company))/g);
  return matches?.at(-1)?.trim();
}

function inferCanadaOrganization(text: string, dates: string[]): string | undefined {
  if (dates.length === 0) return undefined;
  const lastDateText = formatSlashDateForSearch(dates.at(-1)!);
  const index = text.lastIndexOf(lastDateText);
  const tail = index >= 0 ? text.slice(index + lastDateText.length).trim() : '';
  return tail ? shorten(tail, 180) : undefined;
}

function extractMonthDates(text: string): string[] {
  const matches = [...text.matchAll(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?/gi)];
  return matches.map((match) => normalizeIsoDate(match[0])).filter((value): value is string => Boolean(value));
}

function extractSlashDates(text: string): string[] {
  const matches = [...text.matchAll(/\b(20\d{2})\/(\d{2})\/(\d{2})\b/g)];
  return matches.map((match) => `${match[1]}-${match[2]}-${match[3]}T23:59:00.000Z`);
}

function formatSlashDateForSearch(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
}

function extractEstimatedValue(text: string): string | undefined {
  const match = text.match(/(?:estimated cost|contract value|budget)\s*[:\-]?\s*((?:PKR|CAD|USD|Rs\.?|\$)\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?)/i)
    ?? text.match(/((?:PKR|CAD|USD|Rs\.?|\$)\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?)/i);
  return match?.[1]?.trim();
}

function matchingSoftwareTerms(text: string): string[] {
  const normalized = normalize(text);
  return softwareTerms.filter((term) => normalized.includes(term)).slice(0, 12);
}

function extractLinks(html: string, baseUrl: string): Array<{ href: string; text: string }> {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
    href: resolveUrl(match[1] ?? '', baseUrl),
    text: stripHtml(match[2] ?? ''),
  })).filter((item) => Boolean(item.href));
}

function resolveUrl(value: string, baseUrl: string): string {
  try { return new URL(value, baseUrl).toString(); } catch { return baseUrl; }
}

function normalizeIsoDate(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function portalWebsite(portal: string): string | undefined {
  if (portal.includes('PPRA')) return 'https://ppra.gov.pk/';
  if (portal.includes('CanadaBuys')) return 'https://canadabuys.canada.ca/';
  if (portal.includes('UNGM')) return 'https://www.ungm.org/';
  return undefined;
}

function stripHtml(value: string): string {
  return decodeEntities(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9$./+-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function shorten(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}…`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function dedupe(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.sourceUrl.toLowerCase()}|${candidate.tender?.reference?.toLowerCase() ?? ''}|${candidate.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
