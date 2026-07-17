import type { NeonAppState } from '@sales-automation/neon-state';
import type {
  CapturedLinkedInWarmSignal,
  LinkedInWarmSignalDecision,
  LinkedInWarmSignalInput,
} from '@sales-automation/prospect-discovery';

export interface SalesNavigatorResearchIngestion {
  totalInput: number;
  extractedCandidates: number;
  created: number;
  duplicates: number;
  skippedWithoutTarget: number;
  captured: CapturedLinkedInWarmSignal[];
  duplicateLeadIds: string[];
  errors: Array<{ messageId?: string; message: string }>;
}

interface SalesNavigatorCandidate {
  sourceUrl: string;
  kind: 'person' | 'company';
  context: string;
  contactName?: string;
  contactRole?: string;
  companyName?: string;
  country?: string;
  region?: string;
}

const researchAlertPattern = /\b(?:saved (?:lead|account)? search|lead alert|account alert|new leads?|new accounts?|recommended leads?|recommended accounts?|view lead|view account)\b/i;
const buyerIntentPattern = /\b(?:looking for|seeking|need(?:ing)?|can anyone recommend|request(?:ing)? proposals?|vendor required|agency required|partner required|implementation partner|help us build|want to build|planning to build|we are evaluating)\b/i;
const linkedInPostPattern = /\/posts\/|\/feed\/update\//i;
const linkedInTargetPattern = /https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(?:in|company|sales\/lead|sales\/company)\/[^\s<>()"']+/gi;

export function splitLinkedInSignals(signals: LinkedInWarmSignalInput[]): {
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
  const combined = `${signal.subject ?? ''}\n${signal.text}`;
  if (buyerIntentPattern.test(combined) || linkedInPostPattern.test(signal.sourceUrl ?? '')) return false;
  return researchAlertPattern.test(combined) || linkedInTargetPattern.test(combined);
}

export async function ingestSalesNavigatorResearchSignals(input: {
  state: NeonAppState;
  signals: LinkedInWarmSignalInput[];
  actor: string;
  generatedAt: string;
  fetchImpl?: typeof fetch;
}): Promise<SalesNavigatorResearchIngestion> {
  const [evaluator, fixtures, parsers, discovery] = await Promise.all([
    import('@sales-automation/evaluator'),
    import('@sales-automation/fixtures'),
    import('@sales-automation/parsers'),
    import('@sales-automation/prospect-discovery'),
  ]);
  const result: SalesNavigatorResearchIngestion = {
    totalInput: input.signals.length,
    extractedCandidates: 0,
    created: 0,
    duplicates: 0,
    skippedWithoutTarget: 0,
    captured: [],
    duplicateLeadIds: [],
    errors: [],
  };

  for (const signal of input.signals) {
    try {
      const candidates = extractSalesNavigatorCandidates(signal);
      if (!candidates.length) {
        result.skippedWithoutTarget += 1;
        continue;
      }
      result.extractedCandidates += candidates.length;
      for (const candidate of candidates) {
        const researchText = buildResearchText(signal, candidate);
        const parsed = parsers.parseLinkedInSignal({
          text: researchText,
          capturedAt: signal.receivedAt || input.generatedAt,
          sourceUrl: candidate.sourceUrl,
          contactName: candidate.contactName,
          contactRole: candidate.contactRole,
          companyName: candidate.companyName,
          country: candidate.country,
          region: candidate.region,
        });
        const existing = input.state.repository.getLead(parsed.id);
        if (existing) {
          result.duplicates += 1;
          result.duplicateLeadIds.push(existing.lead.id);
          continue;
        }

        const companyWebsite = parsed.companyName
          ? await discovery.findCompanyWebsite(input.fetchImpl ?? globalThis.fetch, parsed.companyName).catch(() => undefined)
          : undefined;
        const lead = {
          ...parsed,
          companyWebsite,
          discoverySource: 'Sales Navigator saved lead/account search alert',
          evidenceUrl: candidate.sourceUrl,
          evidenceSummary: 'Automatically discovered from a native Sales Navigator saved-search alert. Research and human review are required before outreach.',
          pipelineStatus: 'needs_research' as const,
          recommendedNextAction: 'Verify the person, company, current role and a legitimate service-fit or warm-signal basis before preparing outreach.',
          updatedAt: input.generatedAt,
        };
        const evaluation = evaluator.evaluateLead({
          lead,
          portfolioItems: fixtures.samplePortfolioItems,
          generatedAt: input.generatedAt,
        });
        input.state.repository.saveEvaluation(evaluation, input.actor);
        input.state.repository.addNote(
          lead.id,
          `sales_navigator_research::${candidate.kind}::${signal.messageId ?? 'native-alert'}::No LinkedIn action automated.`,
          input.actor,
        );
        const decision = researchDecision(lead.serviceCategory, candidate.sourceUrl, Boolean(lead.companyName || companyWebsite), Boolean(lead.contactRole));
        result.captured.push({
          leadId: lead.id,
          decision,
          evaluation,
          origin: 'sales_navigator_email',
        });
        result.created += 1;
      }
    } catch (error) {
      result.errors.push({ messageId: signal.messageId, message: errorMessage(error) });
    }
  }

  result.duplicateLeadIds = unique(result.duplicateLeadIds);
  return result;
}

export function extractSalesNavigatorCandidates(signal: LinkedInWarmSignalInput): SalesNavigatorCandidate[] {
  const combined = `${signal.subject ?? ''}\n${signal.text}\n${signal.sourceUrl ?? ''}`;
  const candidates: SalesNavigatorCandidate[] = [];
  const seen = new Set<string>();
  for (const match of combined.matchAll(linkedInTargetPattern)) {
    const raw = match[0];
    const sourceUrl = normalizeLinkedInTargetUrl(raw);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const index = match.index ?? 0;
    const context = combined.slice(Math.max(0, index - 320), Math.min(combined.length, index + raw.length + 320));
    const kind = /\/(?:company|sales\/company)\//i.test(new URL(sourceUrl).pathname) ? 'company' : 'person';
    candidates.push({
      sourceUrl,
      kind,
      context: context.trim().slice(0, 1_800),
      contactName: kind === 'person' ? signal.authorName ?? extractLabel(context, ['lead', 'name', 'contact', 'person']) ?? slugLabel(sourceUrl) : undefined,
      contactRole: kind === 'person' ? signal.authorRole ?? extractLabel(context, ['role', 'title']) : undefined,
      companyName: signal.companyName ?? extractLabel(context, ['company', 'account', 'organization']) ?? (kind === 'company' ? slugLabel(sourceUrl) : undefined),
      country: signal.country ?? extractLabel(context, ['country']),
      region: signal.region ?? extractLabel(context, ['region', 'location']),
    });
  }
  return candidates.slice(0, 30);
}

function researchDecision(
  serviceCategory: CapturedLinkedInWarmSignal['decision']['serviceCategory'],
  sourceUrl: string,
  companyKnown: boolean,
  roleKnown: boolean,
): LinkedInWarmSignalDecision {
  const scoreBreakdown = {
    explicitRequirement: 0,
    freshness: 5,
    serviceFit: serviceCategory === 'unknown' ? 0 : 9,
    companyCredibility: companyKnown ? 10 : 0,
    buyerInfluence: roleKnown ? 5 : 0,
    evidenceRoute: 10,
    geographyCompatibility: 0,
    portfolioProof: 0,
    sourceReliability: 8,
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
    normalizedSourceUrl: sourceUrl,
    publicIndexVerificationRequired: false,
  };
}

function buildResearchText(signal: LinkedInWarmSignalInput, candidate: SalesNavigatorCandidate): string {
  return [
    'Manual research note for a LinkedIn target prospect. This is a cold prospect and needs research before outreach.',
    'No direct buying post is confirmed. The target was discovered automatically from a native Sales Navigator saved lead/account search alert.',
    candidate.companyName ? `Company: ${candidate.companyName}.` : '',
    candidate.contactName ? `Contact: ${candidate.contactName}.` : '',
    candidate.contactRole ? `Role: ${candidate.contactRole}.` : '',
    `LinkedIn evidence: ${candidate.sourceUrl}`,
    `Saved-search alert: ${signal.subject ?? 'Sales Navigator alert'}.`,
    candidate.context ? `Visible alert context: ${candidate.context}` : '',
  ].filter(Boolean).join('\n');
}

function normalizeLinkedInTargetUrl(value: string): string | undefined {
  try {
    const url = new URL(value.replace(/[.,;:]+$/, ''));
    const host = url.hostname.toLowerCase();
    if (!['linkedin.com', 'www.linkedin.com'].includes(host) && !host.endsWith('.linkedin.com')) return undefined;
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
    if (!slug || /^ACwA/i.test(slug)) return undefined;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
