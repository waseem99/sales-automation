import { evaluateLead } from '@sales-automation/evaluator';
import type { Lead, PortfolioItem, ServiceCategory } from '@sales-automation/shared';
import type { LeadRepository } from '@sales-automation/storage';
import { findCompanyWebsite } from './enrichment.js';
import type {
  CapturedLinkedInWarmSignal,
  LinkedInWarmSignalDecision,
  LinkedInWarmSignalInput,
} from './linkedin-warm-signals.js';
import type { ProspectFetch } from './types.js';

export interface SalesNavigatorResearchIngestionResult {
  totalInput: number;
  extractedCandidates: number;
  created: number;
  duplicates: number;
  skippedWithoutTarget: number;
  captured: CapturedLinkedInWarmSignal[];
  duplicateLeadIds: string[];
  errors: Array<{ messageId?: string; message: string }>;
}

interface SalesNavigatorTarget {
  sourceUrl: string;
  kind: 'person' | 'company';
  context: string;
  contactName?: string;
  contactRole?: string;
  companyName?: string;
  country?: string;
  region?: string;
}

const savedSearchPattern = /\b(?:saved (?:lead|account)? search|lead alert|account alert|new leads?|new accounts?|recommended leads?|recommended accounts?|view lead|view account)\b/i;
const postUrlPattern = /linkedin\.com\/(?:comm\/)?(?:posts\/|feed\/update\/)/i;
const targetUrlPattern = /https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(?:comm\/)?(?:in|company|sales\/lead|sales\/company)\/[^\s<>()"']+/gi;

export function partitionSalesNavigatorSignals(signals: LinkedInWarmSignalInput[]): {
  researchSignals: LinkedInWarmSignalInput[];
  warmSignals: LinkedInWarmSignalInput[];
} {
  const researchSignals: LinkedInWarmSignalInput[] = [];
  const warmSignals: LinkedInWarmSignalInput[] = [];
  for (const signal of signals) {
    if (isSalesNavigatorResearchSignal(signal)) researchSignals.push(signal);
    else warmSignals.push(signal);
  }
  return { researchSignals, warmSignals };
}

export function isSalesNavigatorResearchSignal(signal: LinkedInWarmSignalInput): boolean {
  if (signal.origin !== 'sales_navigator_email') return false;
  const combined = `${signal.subject ?? ''}\n${signal.text}\n${signal.sourceUrl ?? ''}`;
  if (postUrlPattern.test(combined)) return false;
  return savedSearchPattern.test(combined) || containsTargetUrl(combined);
}

export async function ingestSalesNavigatorResearchSignals(input: {
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  signals: LinkedInWarmSignalInput[];
  actor: string;
  generatedAt?: string;
  fetchImpl?: ProspectFetch;
}): Promise<SalesNavigatorResearchIngestionResult> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const captured: CapturedLinkedInWarmSignal[] = [];
  const duplicateLeadIds: string[] = [];
  const errors: Array<{ messageId?: string; message: string }> = [];
  const existingByUrl = new Map<string, string>();
  const companyWebsiteCache = new Map<string, string | undefined>();
  let extractedCandidates = 0;
  let skippedWithoutTarget = 0;

  for (const record of input.repository.listLeads()) {
    const comparable = comparableTargetUrl(record.lead.sourceUrl ?? record.lead.linkedinUrl);
    if (comparable) existingByUrl.set(comparable, record.lead.id);
  }

  for (const signal of input.signals) {
    try {
      const targets = extractSalesNavigatorTargets(signal);
      if (targets.length === 0) {
        skippedWithoutTarget += 1;
        continue;
      }
      extractedCandidates += targets.length;
      for (const target of targets) {
        const comparable = comparableTargetUrl(target.sourceUrl);
        const duplicateLeadId = comparable ? existingByUrl.get(comparable) : undefined;
        if (duplicateLeadId) {
          duplicateLeadIds.push(duplicateLeadId);
          continue;
        }

        const leadId = leadIdFor(target.sourceUrl);
        const existing = input.repository.getLead(leadId);
        if (existing) {
          duplicateLeadIds.push(existing.lead.id);
          if (comparable) existingByUrl.set(comparable, existing.lead.id);
          continue;
        }

        const serviceCategory = inferServiceCategory(`${signal.subject ?? ''}\n${signal.text}`);
        const companyWebsite = target.companyName
          ? await cachedCompanyWebsite(fetchImpl, target.companyName, companyWebsiteCache)
          : undefined;
        const decision = researchDecision(serviceCategory, target, Boolean(companyWebsite));
        const lead = buildResearchLead({ signal, target, decision, companyWebsite, generatedAt, leadId });
        const evaluation = evaluateLead({ lead, portfolioItems: input.portfolioItems, generatedAt });
        input.repository.saveEvaluation(evaluation, input.actor);
        input.repository.addNote(
          lead.id,
          `sales-navigator-research::${target.kind}::${signal.messageId ?? 'native-alert'}::No LinkedIn action automated.`,
          input.actor,
        );
        input.repository.addNote(
          lead.id,
          `linkedin-evidence::${target.sourceUrl}::Automatically discovered from a native Sales Navigator saved-search alert.`,
          input.actor,
        );
        if (comparable) existingByUrl.set(comparable, lead.id);
        captured.push({ leadId: lead.id, decision, evaluation, origin: 'sales_navigator_email' });
      }
    } catch (error) {
      errors.push({ messageId: signal.messageId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    totalInput: input.signals.length,
    extractedCandidates,
    created: captured.length,
    duplicates: duplicateLeadIds.length,
    skippedWithoutTarget,
    captured,
    duplicateLeadIds: unique(duplicateLeadIds),
    errors,
  };
}

export function extractSalesNavigatorTargets(signal: LinkedInWarmSignalInput): SalesNavigatorTarget[] {
  const combined = `${signal.subject ?? ''}\n${signal.text}\n${signal.sourceUrl ?? ''}`;
  const results: SalesNavigatorTarget[] = [];
  const seen = new Set<string>();
  targetUrlPattern.lastIndex = 0;
  for (const match of combined.matchAll(targetUrlPattern)) {
    const sourceUrl = normalizeTargetUrl(match[0]);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const index = match.index ?? 0;
    const context = combined.slice(Math.max(0, index - 320), Math.min(combined.length, index + match[0].length + 320));
    const kind = /\/(?:company|sales\/company)\//i.test(new URL(sourceUrl).pathname) ? 'company' : 'person';
    results.push({
      sourceUrl,
      kind,
      context: context.trim().slice(0, 1_800),
      contactName: kind === 'person'
        ? signal.authorName ?? extractLabel(context, ['lead', 'name', 'contact', 'person']) ?? slugLabel(sourceUrl)
        : undefined,
      contactRole: kind === 'person' ? signal.authorRole ?? extractLabel(context, ['role', 'title']) : undefined,
      companyName: signal.companyName
        ?? extractLabel(context, ['company', 'account', 'organization'])
        ?? (kind === 'company' ? slugLabel(sourceUrl) : undefined),
      country: signal.country ?? extractLabel(context, ['country']),
      region: signal.region ?? extractLabel(context, ['region', 'location']),
    });
  }
  targetUrlPattern.lastIndex = 0;
  return results.slice(0, 30);
}

function buildResearchLead(input: {
  signal: LinkedInWarmSignalInput;
  target: SalesNavigatorTarget;
  decision: LinkedInWarmSignalDecision;
  companyWebsite?: string;
  generatedAt: string;
  leadId: string;
}): Lead {
  const title = input.target.companyName
    ? `${input.target.companyName} — Sales Navigator target account`
    : input.target.contactName
      ? `${input.target.contactName} — Sales Navigator target prospect`
      : input.signal.subject?.trim() || 'Sales Navigator target prospect';
  return {
    id: input.leadId,
    source: 'sales_navigator',
    sourceUrl: input.target.sourceUrl,
    leadType: 'sales_navigator_cold_prospect',
    prospectStage: 'cold_prospect',
    title,
    description: [
      'Automatically discovered from a native Sales Navigator saved lead/account search alert.',
      'No direct buying post is confirmed. Research and human review are required before outreach.',
      input.target.context,
    ].filter(Boolean).join('\n').slice(0, 12_000),
    companyName: input.target.companyName,
    companyWebsite: input.companyWebsite,
    contactName: input.target.contactName,
    contactRole: input.target.contactRole,
    linkedinUrl: input.target.sourceUrl,
    country: input.target.country,
    region: input.target.region,
    serviceCategory: input.decision.serviceCategory,
    discoverySource: 'Native Sales Navigator saved lead/account search alert',
    evidenceUrl: input.target.sourceUrl,
    evidenceSummary: 'Sales Navigator surfaced this person or account automatically. Verify current role, company fit and a legitimate outreach basis before contact.',
    capturedAt: input.generatedAt,
    confidence: input.target.companyName || input.companyWebsite ? 'medium' : 'low',
    rank: Math.max(1, 101 - input.decision.score),
    recommendedNextAction: 'Verify the person, company, current role, relevant initiative and service fit before preparing human-reviewed outreach.',
    pipelineStatus: 'needs_research',
    rawPayload: {
      linkedinWarmSignal: {
        version: 1,
        origin: input.signal.origin,
        subject: input.signal.subject,
        messageId: input.signal.messageId,
        sourceUrl: input.target.sourceUrl,
        score: input.decision.score,
        band: input.decision.band,
        scoreBreakdown: input.decision.scoreBreakdown,
        reasonCodes: input.decision.reasonCodes,
        publicIndexVerificationRequired: false,
        receivedAt: input.signal.receivedAt,
      },
      salesNavigatorResearch: {
        version: 1,
        targetKind: input.target.kind,
        alertContext: input.target.context,
        automaticDiscovery: true,
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      originalSignalText: input.signal.text.trim().slice(0, 12_000),
    },
    createdAt: input.generatedAt,
    updatedAt: input.generatedAt,
  };
}

function researchDecision(
  serviceCategory: ServiceCategory,
  target: SalesNavigatorTarget,
  companyWebsiteKnown: boolean,
): LinkedInWarmSignalDecision {
  const scoreBreakdown = {
    explicitRequirement: 0,
    freshness: 8,
    serviceFit: serviceCategory === 'unknown' ? 0 : 9,
    companyCredibility: target.companyName || companyWebsiteKnown ? 10 : 0,
    buyerInfluence: target.contactRole ? 5 : 0,
    evidenceRoute: 10,
    geographyCompatibility: target.country || target.region ? 5 : 0,
    portfolioProof: 0,
    sourceReliability: 5,
  };
  return {
    outcome: 'research',
    band: 'research',
    score: Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0),
    scoreBreakdown,
    reasonCodes: [
      'sales_navigator_saved_search_research',
      'no_active_buyer_requirement',
      'human_verification_required',
    ],
    serviceCategory,
    normalizedSourceUrl: target.sourceUrl,
    inferredCompanyWebsite: undefined,
    publicIndexVerificationRequired: false,
  };
}

function inferServiceCategory(text: string): ServiceCategory {
  const value = text.toLowerCase();
  if (/\b(?:rag|retrieval augmented|document intelligence|knowledge base|vector search)\b/.test(value)) return 'rag_document_intelligence';
  if (/\b(?:voice ai|voice agent|conversational voice|call agent)\b/.test(value)) return 'voice_ai_agent';
  if (/\b(?:ai automation|workflow automation|ai agent|llm|genai|generative ai|n8n|zapier|make\.com|chatbot)\b/.test(value)) return 'ai_automation';
  if (/\b(?:cybersecurity|vapt|penetration test|soc\s*2|iso\s*27001|hipaa|cmmc|pci dss|cloud security|iam)\b/.test(value)) return 'cybersecurity_compliance';
  if (/\b(?:augmented reality|virtual reality|\bar\b|\bvr\b|unity|unreal|3d animation|immersive|webar|webxr|cgi|vfx)\b/.test(value)) return 'ar_3d_unity_unreal';
  if (/\b(?:website|wordpress|webflow|shopify|seo|branding|digital marketing)\b/.test(value)) return 'website_portal';
  if (/\b(?:saas|mvp|startup product|ai product)\b/.test(value)) return 'ai_saas_mvp';
  if (/\b(?:software development|web app|mobile app|full[- ]?stack|react|next\.js|node\.js|python)\b/.test(value)) return 'fullstack_web_app';
  if (/\b(?:enterprise system|erp|crm|legacy modernization|system integration|digital transformation|internal platform)\b/.test(value)) return 'enterprise_systems';
  return 'unknown';
}

async function cachedCompanyWebsite(
  fetchImpl: ProspectFetch,
  companyName: string,
  cache: Map<string, string | undefined>,
): Promise<string | undefined> {
  const key = companyName.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const website = await findCompanyWebsite(fetchImpl, companyName).catch(() => undefined);
  cache.set(key, website);
  return website;
}

function containsTargetUrl(value: string): boolean {
  targetUrlPattern.lastIndex = 0;
  const found = targetUrlPattern.test(value);
  targetUrlPattern.lastIndex = 0;
  return found;
}

function normalizeTargetUrl(value: string): string | undefined {
  try {
    const url = new URL(value.replace(/[.,;:]+$/, ''));
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return undefined;
    url.pathname = url.pathname.replace(/^\/comm\/(?=(?:in|company|sales\/lead|sales\/company)\/)/i, '/');
    if (!/^\/(?:in|company|sales\/lead|sales\/company)\//i.test(url.pathname)) return undefined;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|trk|tracking|lipi|midToken|midSig|source|ref|sessionId)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function comparableTargetUrl(value: string | undefined): string | undefined {
  const normalized = value ? normalizeTargetUrl(value) : undefined;
  return normalized?.toLowerCase();
}

function leadIdFor(sourceUrl: string): string {
  const slug = sourceUrl.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 82);
  return `sales-nav-research-${slug || stableHash(sourceUrl)}`;
}

function extractLabel(value: string, labels: string[]): string | undefined {
  const labelPattern = labels.map(escapeRegex).join('|');
  const patterns = [
    new RegExp(`(?:${labelPattern})\\s*[:|-]\\s*([^\\n|•]{2,100})`, 'i'),
    new RegExp(`(?:${labelPattern})\\s+([^\\n|•]{2,100})`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[1]?.trim();
    if (match) return cleanupLabel(match);
  }
  return undefined;
}

function slugLabel(value: string): string | undefined {
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean);
    const slug = parts[parts.length - 1]?.replace(/-[a-z0-9]{6,}$/i, '').replace(/[-_]+/g, ' ').trim();
    if (!slug || /^ACwA/i.test(slug) || /^\d+$/.test(slug)) return undefined;
    return slug.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 100);
  } catch {
    return undefined;
  }
}

function cleanupLabel(value: string): string | undefined {
  const cleaned = value.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/[.,;:|-]+$/, '').trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 120) : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
