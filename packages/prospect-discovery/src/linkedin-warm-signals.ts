import { evaluateLead, type LeadEvaluation } from '@sales-automation/evaluator';
import type { Lead, PortfolioItem, ServiceCategory } from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';
import type { ProspectFetch } from './types.js';

export type LinkedInWarmSignalOrigin =
  | 'sales_navigator_email'
  | 'linkedin_notification_email'
  | 'manual_post'
  | 'public_index';

export type LinkedInWarmSignalOutcome = 'keep' | 'research' | 'reject';
export type LinkedInWarmSignalBand = 'priority_a' | 'priority_b' | 'research' | 'reject';

export interface LinkedInWarmSignalInput {
  origin: LinkedInWarmSignalOrigin;
  text: string;
  receivedAt: string;
  subject?: string;
  messageId?: string;
  sourceUrl?: string;
  postedAt?: string;
  authorName?: string;
  authorRole?: string;
  companyName?: string;
  companyWebsite?: string;
  country?: string;
  region?: string;
}

export interface LinkedInWarmSignalScoreBreakdown {
  explicitRequirement: number;
  freshness: number;
  serviceFit: number;
  companyCredibility: number;
  buyerInfluence: number;
  evidenceRoute: number;
  geographyCompatibility: number;
  portfolioProof: number;
  sourceReliability: number;
}

export interface LinkedInWarmSignalDecision {
  outcome: LinkedInWarmSignalOutcome;
  band: LinkedInWarmSignalBand;
  score: number;
  scoreBreakdown: LinkedInWarmSignalScoreBreakdown;
  reasonCodes: string[];
  buyerIntentEvidence?: string;
  serviceCategory: ServiceCategory;
  freshnessMinutes?: number;
  normalizedSourceUrl?: string;
  inferredCompanyWebsite?: string;
  publicIndexVerificationRequired: boolean;
}

export interface CapturedLinkedInWarmSignal {
  leadId: string;
  decision: LinkedInWarmSignalDecision;
  evaluation: LeadEvaluation;
  origin: LinkedInWarmSignalOrigin;
}

export interface RejectedLinkedInWarmSignal {
  origin: LinkedInWarmSignalOrigin;
  sourceUrl?: string;
  messageId?: string;
  score: number;
  reasonCodes: string[];
}

export interface LinkedInWarmSignalIngestionResult {
  totalInput: number;
  created: number;
  duplicates: number;
  rejected: number;
  research: number;
  priorityA: number;
  priorityB: number;
  captured: CapturedLinkedInWarmSignal[];
  rejectedSignals: RejectedLinkedInWarmSignal[];
  duplicateLeadIds: string[];
  rejectionReasonCounts: Record<string, number>;
}

export interface PublicLinkedInIndexCollection {
  checked: number;
  inputs: LinkedInWarmSignalInput[];
  error?: string;
}

export const LINKEDIN_PUBLIC_INDEX_QUERIES = [
  'site:linkedin.com/posts ("looking for" OR "need") ("website developer" OR "web development agency") -jobs -hiring -course -tutorial',
  'site:linkedin.com/posts ("looking for" OR "seeking") ("software development partner" OR "app development company") -jobs -hiring -resume',
  'site:linkedin.com/posts ("looking for" OR "need help with") ("AI automation" OR "RAG" OR "AI agent") -jobs -hiring -course',
  'site:linkedin.com/posts ("looking for" OR "recommend") ("cybersecurity consultant" OR "SOC 2 partner" OR "ISO 27001 consultant") -jobs -hiring',
  'site:linkedin.com/posts ("looking for" OR "seeking") ("AR VR development" OR "Unity developer" OR "3D animation studio") -jobs -hiring',
  'site:linkedin.com/posts ("looking for" OR "recommend") ("digital marketing agency" OR "SEO agency" OR "branding agency") -jobs -hiring -course',
];

const buyerIntentPattern = /\b(?:looking for|seeking|need(?:ing)?|need help with|recommend(?:ation|ed)?|can anyone recommend|anyone know|request(?:ing)? proposals?|inviting proposals?|vendor required|agency required|partner required|implementation partner|outsourcing partner|help us build|want to build|planning to build|we are evaluating|we need an? agency|we need an? developer|we need an? partner)\b/i;
const externalProjectPattern = /\b(?:project|website|web app|mobile app|platform|portal|saas|mvp|automation|integration|migration|implementation|redesign|rebuild|campaign|branding|seo|compliance|assessment|penetration test|soc\s*2|iso\s*27001|ar|vr|3d|unity|unreal|rag|llm|ai agent|voice ai|chatbot|vendor|agency|partner|consultant|freelancer|contract)\b/i;
const strongEmploymentPattern = /\b(?:we are hiring|we're hiring|job opening|open role|full[- ]?time|part[- ]?time|permanent position|salary|compensation|benefits|apply now|submit your resume|send your resume|candidate|work authorization|visa sponsorship|join our team|years of experience|the position|this role)\b/i;
const selfPromotionPattern = /\b(?:i am|i'm|we are)\s+(?:an?\s+)?(?:website|web|software|mobile|wordpress|shopify|ai|automation|seo|marketing|cybersecurity|ar|vr|3d|full[- ]?stack)?\s*(?:developer|agency|consultant|expert|studio|company)\b|\b(?:available for projects|available for freelance|hire me|dm me for services|check out my services|we offer|our agency provides)\b/i;
const editorialPattern = /\b(?:beginner'?s guide|tutorial|how to|course|webinar|newsletter|podcast|whitepaper|case study article|top \d+|best practices|dictionary|wikipedia|movie|episode|trailer)\b/i;
const lowValuePattern = /\b(?:student project|school project|unpaid|volunteer only|free work|no budget|budget\s*(?:is|:)\s*\$?\s*(?:0|[1-4]\d{0,2})(?:\D|$)|sample for free)\b/i;
const influentialRolePattern = /\b(?:founder|co-founder|owner|ceo|cto|cio|ciso|coo|managing director|director|head of|vp\b|vice president|procurement|operations manager|product manager|marketing manager)\b/i;
const preferredGeographyPattern = /\b(?:united states|usa|canada|united kingdom|uk|ireland|uae|united arab emirates|saudi arabia|qatar|pakistan|australia|new zealand|singapore|germany|france|netherlands|sweden|norway|denmark)\b/i;
const blockedCompanyWebsiteHosts = ['linkedin.com','facebook.com','instagram.com','x.com','twitter.com','youtube.com','medium.com','github.com','gitlab.com','wikipedia.org','imdb.com'];

const servicePatterns: Array<{ category: ServiceCategory; pattern: RegExp }> = [
  { category: 'rag_document_intelligence', pattern: /\b(?:rag|retrieval augmented|document intelligence|knowledge base|document automation|ocr)\b/i },
  { category: 'voice_ai_agent', pattern: /\b(?:voice ai|voice agent|ai calling|conversational voice|speech agent)\b/i },
  { category: 'ai_automation', pattern: /\b(?:ai automation|workflow automation|ai agent|llm|genai|generative ai|n8n|zapier|make\.com|chatbot)\b/i },
  { category: 'cybersecurity_compliance', pattern: /\b(?:cybersecurity|vapt|penetration test|soc\s*2|iso\s*27001|hipaa|cmmc|pci dss|cloud security|iam|security assessment)\b/i },
  { category: 'ar_3d_unity_unreal', pattern: /\b(?:augmented reality|virtual reality|\bar\b|\bvr\b|unity|unreal|3d animation|immersive|webar|webxr|cgi|vfx)\b/i },
  { category: 'website_portal', pattern: /\b(?:website developer|website development|wordpress|webflow|shopify|website redesign|website rebuild|seo|branding agency|digital marketing agency)\b/i },
  { category: 'ai_saas_mvp', pattern: /\b(?:saas|mvp|startup product|ai product)\b/i },
  { category: 'fullstack_web_app', pattern: /\b(?:software developer|software development|web app|mobile app|app developer|development team|dev shop|full[- ]?stack|react|next\.js|node\.js|python)\b/i },
  { category: 'enterprise_systems', pattern: /\b(?:enterprise system|erp|crm|legacy modernization|system integration|digital transformation|internal platform)\b/i },
];

export function evaluateLinkedInWarmSignal(
  input: LinkedInWarmSignalInput,
  portfolioItems: PortfolioItem[] = [],
): LinkedInWarmSignalDecision {
  const combined = `${input.subject ?? ''}\n${input.text}`.trim();
  const sourceUrl = normalizeLinkedInUrl(input.sourceUrl ?? extractLinkedInPostUrl(combined));
  const serviceCategory = inferServiceCategory(combined);
  const freshnessMinutes = resolveFreshnessMinutes(input, combined);
  const companyWebsite = normalizeCompanyWebsite(input.companyWebsite ?? extractCompanyWebsite(combined));
  const buyerEvidence = extractBuyerIntentEvidence(combined);
  const reasonCodes: string[] = [];

  const hasBuyerIntent = buyerIntentPattern.test(combined);
  const hasProjectContext = externalProjectPattern.test(combined);
  const employmentOnly = strongEmploymentPattern.test(combined) && !hasExternalVendorLanguage(combined);
  const selfPromotion = selfPromotionPattern.test(combined) && !hasBuyerIntent;

  if (employmentOnly) reasonCodes.push('linkedin_job_vacancy');
  if (selfPromotion) reasonCodes.push('service_provider_self_promotion');
  if (editorialPattern.test(combined) && !hasBuyerIntent) reasonCodes.push('editorial_or_learning_content');
  if (!hasBuyerIntent || !hasProjectContext) reasonCodes.push('no_active_buyer_requirement');
  if (serviceCategory === 'unknown') reasonCodes.push('weak_service_fit');
  if (lowValuePattern.test(combined)) reasonCodes.push('individual_low_value_request');
  if (freshnessMinutes !== undefined && freshnessMinutes > 30 * 24 * 60) reasonCodes.push('stale_linkedin_post');
  if (input.origin === 'public_index' && !sourceUrl) reasonCodes.push('untrusted_source');

  const breakdown: LinkedInWarmSignalScoreBreakdown = {
    explicitRequirement: hasBuyerIntent && hasProjectContext ? 20 : hasBuyerIntent ? 10 : 0,
    freshness: freshnessScore(freshnessMinutes, input.origin),
    serviceFit: serviceCategory === 'unknown' ? 0 : strongServiceFit(combined) ? 15 : 9,
    companyCredibility: input.companyName || companyWebsite ? 10 : 0,
    buyerInfluence: influentialRolePattern.test(input.authorRole ?? combined) ? 10 : input.authorName ? 5 : 0,
    evidenceRoute: sourceUrl ? 10 : input.messageId ? 5 : 0,
    geographyCompatibility: preferredGeographyPattern.test(`${input.country ?? ''} ${input.region ?? ''} ${combined}`) ? 5 : 0,
    portfolioProof: portfolioItems.some((item) => item.serviceCategories.includes(serviceCategory) && item.confidentiality !== 'private') ? 10 : 0,
    sourceReliability: sourceReliabilityScore(input.origin),
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const hardReject = reasonCodes.some((code) => [
    'linkedin_job_vacancy',
    'service_provider_self_promotion',
    'editorial_or_learning_content',
    'no_active_buyer_requirement',
    'individual_low_value_request',
    'stale_linkedin_post',
    'untrusted_source',
  ].includes(code));

  let outcome: LinkedInWarmSignalOutcome;
  let band: LinkedInWarmSignalBand;
  if (hardReject || score < 60) {
    outcome = 'reject';
    band = 'reject';
  } else if (input.origin === 'public_index') {
    outcome = 'research';
    band = 'research';
    reasonCodes.push('public_index_requires_human_verification');
  } else if (score >= 85) {
    outcome = 'keep';
    band = 'priority_a';
  } else if (score >= 75) {
    outcome = 'keep';
    band = 'priority_b';
  } else {
    outcome = 'research';
    band = 'research';
  }

  if (!input.companyName && !companyWebsite) reasonCodes.push('unverified_buyer');
  if (!sourceUrl && !input.messageId) reasonCodes.push('missing_original_evidence');
  if (freshnessMinutes === undefined) reasonCodes.push('post_freshness_unverified');

  return {
    outcome,
    band,
    score,
    scoreBreakdown: breakdown,
    reasonCodes: unique(reasonCodes),
    buyerIntentEvidence: buyerEvidence,
    serviceCategory,
    freshnessMinutes,
    normalizedSourceUrl: sourceUrl,
    inferredCompanyWebsite: companyWebsite,
    publicIndexVerificationRequired: input.origin === 'public_index',
  };
}

export function ingestLinkedInWarmSignals(input: {
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  signals: LinkedInWarmSignalInput[];
  actor: string;
  generatedAt?: string;
}): LinkedInWarmSignalIngestionResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const existing = buildExistingSignalIndex(input.repository.listLeads());
  const captured: CapturedLinkedInWarmSignal[] = [];
  const rejectedSignals: RejectedLinkedInWarmSignal[] = [];
  const duplicateLeadIds: string[] = [];

  for (const signal of input.signals) {
    const decision = evaluateLinkedInWarmSignal(signal, input.portfolioItems);
    if (decision.outcome === 'reject') {
      rejectedSignals.push({
        origin: signal.origin,
        sourceUrl: decision.normalizedSourceUrl,
        messageId: signal.messageId,
        score: decision.score,
        reasonCodes: decision.reasonCodes,
      });
      continue;
    }

    const dedupeKeys = signalDedupeKeys(signal, decision);
    const duplicate = dedupeKeys.map((key) => existing.get(key)).find(Boolean);
    if (duplicate) {
      duplicateLeadIds.push(duplicate.lead.id);
      continue;
    }

    const lead = buildLinkedInWarmLead(signal, decision, generatedAt);
    const evaluation = evaluateLead({ lead, portfolioItems: input.portfolioItems, generatedAt });
    input.repository.saveEvaluation(evaluation, input.actor);
    input.repository.addNote(
      lead.id,
      `linkedin-warm-signal::${signal.origin}::${decision.band}::${decision.score}::${decision.reasonCodes.join('|') || 'accepted'}`,
      input.actor,
    );
    input.repository.addNote(
      lead.id,
      `linkedin-evidence::${decision.normalizedSourceUrl ?? signal.messageId ?? 'manual-text'}::${decision.buyerIntentEvidence ?? 'Buyer intent extracted from supplied signal text.'}`,
      input.actor,
    );
    const record = input.repository.getLead(lead.id)!;
    for (const key of dedupeKeys) existing.set(key, record);
    captured.push({ leadId: lead.id, decision, evaluation, origin: signal.origin });
  }

  return {
    totalInput: input.signals.length,
    created: captured.length,
    duplicates: duplicateLeadIds.length,
    rejected: rejectedSignals.length,
    research: captured.filter((item) => item.decision.band === 'research').length,
    priorityA: captured.filter((item) => item.decision.band === 'priority_a').length,
    priorityB: captured.filter((item) => item.decision.band === 'priority_b').length,
    captured,
    rejectedSignals,
    duplicateLeadIds: unique(duplicateLeadIds),
    rejectionReasonCounts: countReasons(rejectedSignals.flatMap((item) => item.reasonCodes)),
  };
}

export async function collectPublicLinkedInIndexSignals(
  fetchImpl: ProspectFetch,
  queries: string[] = LINKEDIN_PUBLIC_INDEX_QUERIES,
  maxQueries = 6,
  now = new Date().toISOString(),
): Promise<PublicLinkedInIndexCollection> {
  const inputs: LinkedInWarmSignalInput[] = [];
  let checked = 0;
  const errors: string[] = [];

  for (const query of queries.slice(0, Math.max(1, maxQueries))) {
    try {
      const response = await fetchWithTimeout(fetchImpl, `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`);
      checked += 1;
      if (!response.ok) {
        errors.push(`HTTP ${response.status} for ${query}`);
        continue;
      }
      const xml = await response.text();
      for (const item of parseRssItems(xml).slice(0, 10)) {
        const sourceUrl = normalizeLinkedInUrl(item.link);
        if (!sourceUrl || !isLinkedInPostUrl(sourceUrl)) continue;
        const text = stripHtml(`${item.title}\n${item.description}`).trim();
        const candidate: LinkedInWarmSignalInput = {
          origin: 'public_index',
          text,
          subject: item.title,
          sourceUrl,
          receivedAt: now,
          postedAt: normalizeIso(item.publishedAt),
        };
        const decision = evaluateLinkedInWarmSignal(candidate);
        if (decision.outcome === 'reject') continue;
        inputs.push(candidate);
      }
    } catch (error) {
      checked += 1;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    checked,
    inputs: dedupeInputs(inputs),
    error: errors.length ? errors.join('; ') : undefined,
  };
}

export function isLinkedInPostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return false;
    return url.pathname.includes('/posts/') || /\/feed\/update\/urn:li:activity:/i.test(url.pathname);
  } catch {
    return false;
  }
}

function buildLinkedInWarmLead(signal: LinkedInWarmSignalInput, decision: LinkedInWarmSignalDecision, generatedAt: string): Lead {
  const title = inferTitle(signal, decision);
  const companyWebsite = signal.companyWebsite ?? decision.inferredCompanyWebsite;
  const evidenceUrl = decision.normalizedSourceUrl;
  const isSalesNavigator = signal.origin === 'sales_navigator_email';
  const sourceLabel = signal.origin === 'public_index'
    ? 'Public search index snippet pointing to LinkedIn; original post must be opened and verified.'
    : signal.origin === 'manual_post'
      ? 'Manually supplied LinkedIn post text and URL.'
      : signal.origin === 'sales_navigator_email'
        ? 'Native Sales Navigator alert email.'
        : 'Native LinkedIn notification email.';
  return {
    id: createLeadId(signal, decision),
    source: isSalesNavigator ? 'sales_navigator' : 'linkedin',
    sourceUrl: evidenceUrl,
    leadType: isSalesNavigator ? 'linkedin_sales_nav_alert' : 'linkedin_warm_post',
    prospectStage: 'warm_lead',
    title,
    description: signal.text.trim().slice(0, 12_000),
    companyName: signal.companyName,
    companyWebsite,
    contactName: signal.authorName,
    contactRole: signal.authorRole,
    linkedinUrl: evidenceUrl,
    country: signal.country,
    region: signal.region,
    serviceCategory: decision.serviceCategory,
    opportunityStatus: 'live_opportunity',
    discoverySource: sourceLabel,
    evidenceUrl,
    evidenceSummary: decision.buyerIntentEvidence ?? 'Buyer-side requirement detected in supplied LinkedIn signal text.',
    postedAt: normalizeIso(signal.postedAt),
    capturedAt: generatedAt,
    freshnessMinutes: decision.freshnessMinutes,
    confidence: decision.score >= 85 ? 'high' : decision.score >= 75 ? 'medium' : 'low',
    rank: Math.max(1, 101 - decision.score),
    recommendedNextAction: decision.publicIndexVerificationRequired
      ? 'Open the original LinkedIn post, verify that the requirement is current and buyer-authored, then complete company/contact research.'
      : decision.band === 'priority_a'
        ? 'Verify the original post immediately, complete public contact enrichment and prepare a human-reviewed response within two hours.'
        : 'Verify the original post, complete public contact enrichment and prepare a human-reviewed response within one business day.',
    pipelineStatus: decision.band === 'research' ? 'needs_research' : 'needs_human_review',
    rawPayload: {
      linkedinWarmSignal: {
        version: 1,
        origin: signal.origin,
        subject: signal.subject,
        messageId: signal.messageId,
        sourceUrl: evidenceUrl,
        score: decision.score,
        band: decision.band,
        scoreBreakdown: decision.scoreBreakdown,
        reasonCodes: decision.reasonCodes,
        buyerIntentEvidence: decision.buyerIntentEvidence,
        publicIndexVerificationRequired: decision.publicIndexVerificationRequired,
        receivedAt: signal.receivedAt,
        postedAt: signal.postedAt,
      },
      originalSignalText: signal.text.trim().slice(0, 12_000),
    },
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

function buildExistingSignalIndex(records: StoredLeadRecord[]): Map<string, StoredLeadRecord> {
  const result = new Map<string, StoredLeadRecord>();
  for (const record of records) {
    if (record.lead.sourceUrl) result.set(`url:${normalizeComparableUrl(record.lead.sourceUrl)}`, record);
    const raw = asRecord(record.lead.rawPayload);
    const warm = asRecord(raw?.linkedinWarmSignal);
    const messageId = stringValue(warm?.messageId);
    if (messageId) result.set(`message:${messageId.toLowerCase()}`, record);
    const fingerprint = stringValue(warm?.fingerprint);
    if (fingerprint) result.set(`fingerprint:${fingerprint}`, record);
  }
  return result;
}

function signalDedupeKeys(signal: LinkedInWarmSignalInput, decision: LinkedInWarmSignalDecision): string[] {
  const keys: string[] = [];
  if (decision.normalizedSourceUrl) keys.push(`url:${normalizeComparableUrl(decision.normalizedSourceUrl)}`);
  if (signal.messageId) keys.push(`message:${signal.messageId.trim().toLowerCase()}`);
  keys.push(`fingerprint:${signalFingerprint(signal)}`);
  return unique(keys);
}

function signalFingerprint(signal: LinkedInWarmSignalInput): string {
  const material = [signal.companyName, signal.authorName, signal.subject, signal.text.slice(0, 500)]
    .map((item) => normalizeText(item ?? ''))
    .join('|');
  let hash = 2166136261;
  for (const character of material) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createLeadId(signal: LinkedInWarmSignalInput, decision: LinkedInWarmSignalDecision): string {
  const base = decision.normalizedSourceUrl ?? signal.messageId ?? `${signal.companyName ?? signal.authorName ?? 'linkedin'}-${signal.text.slice(0, 100)}`;
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 82);
  return `linkedin-warm-${slug || signalFingerprint(signal)}`;
}

function inferTitle(signal: LinkedInWarmSignalInput, decision: LinkedInWarmSignalDecision): string {
  if (signal.companyName) return `${signal.companyName} — ${serviceLabel(decision.serviceCategory)} requirement`;
  const subject = signal.subject?.replace(/^\s*(?:fw|fwd|re):\s*/i, '').trim();
  if (subject && subject.length <= 110) return subject;
  const first = signal.text.trim().split(/[.!?\n]/)[0]?.trim();
  return first && first.length <= 110 ? first : `LinkedIn ${serviceLabel(decision.serviceCategory)} opportunity`;
}

function inferServiceCategory(text: string): ServiceCategory {
  return servicePatterns.find((item) => item.pattern.test(text))?.category ?? 'unknown';
}

function strongServiceFit(text: string): boolean {
  return servicePatterns.some((item) => item.pattern.test(text)) && buyerIntentPattern.test(text);
}

function hasExternalVendorLanguage(text: string): boolean {
  return /\b(?:agency|vendor|partner|consultant|freelancer|contractor|outsourcing|external team|project-based|fixed[- ]?price|fixed[- ]?scope)\b/i.test(text);
}

function sourceReliabilityScore(origin: LinkedInWarmSignalOrigin): number {
  if (origin === 'sales_navigator_email' || origin === 'linkedin_notification_email') return 5;
  if (origin === 'manual_post') return 4;
  return 2;
}

function freshnessScore(minutes: number | undefined, origin: LinkedInWarmSignalOrigin): number {
  if (minutes === undefined) return origin === 'sales_navigator_email' || origin === 'linkedin_notification_email' ? 8 : 0;
  if (minutes <= 72 * 60) return 15;
  if (minutes <= 7 * 24 * 60) return 10;
  if (minutes <= 14 * 24 * 60) return 5;
  if (minutes <= 30 * 24 * 60) return 2;
  return 0;
}

function resolveFreshnessMinutes(input: LinkedInWarmSignalInput, text: string): number | undefined {
  const posted = normalizeIso(input.postedAt);
  const received = normalizeIso(input.receivedAt) ?? new Date().toISOString();
  if (posted) return Math.max(0, Math.round((Date.parse(received) - Date.parse(posted)) / 60_000));
  const relative = text.match(/\b(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)\s+ago\b/i);
  if (!relative?.[1] || !relative[2]) return undefined;
  const amount = Number(relative[1]);
  const unit = relative[2].toLowerCase();
  if (unit.startsWith('minute')) return amount;
  if (unit.startsWith('hour')) return amount * 60;
  if (unit.startsWith('day')) return amount * 1440;
  return amount * 10080;
}

function extractBuyerIntentEvidence(text: string): string | undefined {
  const sentences = stripHtml(text).split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
  return sentences.find((item) => buyerIntentPattern.test(item) && externalProjectPattern.test(item))?.slice(0, 500);
}

function extractLinkedInPostUrl(text: string): string | undefined {
  const urls = text.match(/https?:\/\/[^\s<>()"']+/gi) ?? [];
  return urls.map((item) => item.replace(/[.,;]+$/, '')).find(isLinkedInPostUrl);
}

function normalizeLinkedInUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim().replace(/[.,;]+$/, ''));
    if (!isLinkedInPostUrl(url.toString())) return undefined;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|trk|tracking|lipi|midToken|midSig)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function extractCompanyWebsite(text: string): string | undefined {
  const urls = text.match(/https?:\/\/[^\s<>()"']+/gi) ?? [];
  for (const candidate of urls) {
    try {
      const url = new URL(candidate.replace(/[.,;]+$/, ''));
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (blockedCompanyWebsiteHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) continue;
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      return url.origin;
    } catch {
      continue;
    }
  }
  return undefined;
}

function parseRssItems(xml: string): Array<{ title: string; link: string; description: string; publishedAt?: string }> {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const item = match[1] ?? '';
    const title = xmlValue(item, 'title');
    const link = xmlValue(item, 'link');
    if (!title || !link) return [];
    return [{ title, link, description: xmlValue(item, 'description') ?? '', publishedAt: xmlValue(item, 'pubDate') }];
  });
}

function xmlValue(value: string, tag: string): string | undefined {
  const match = value.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1] ? decodeEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim() : undefined;
}

async function fetchWithTimeout(fetchImpl: ProspectFetch, url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'CodistanLinkedInPublicSignalResearch/1.0 (+https://codistan.org)' },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function dedupeInputs(inputs: LinkedInWarmSignalInput[]): LinkedInWarmSignalInput[] {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = normalizeComparableUrl(input.sourceUrl ?? '') || signalFingerprint(input);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countReasons(reasons: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const reason of reasons) result[reason] = (result[reason] ?? 0) + 1;
  return result;
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, '').toLowerCase();
  }
}

function normalizeCompanyWebsite(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (blockedCompanyWebsiteHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function normalizeIso(value: string | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ').replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function serviceLabel(value: ServiceCategory): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
