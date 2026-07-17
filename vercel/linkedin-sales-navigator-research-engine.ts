import type { NeonAppState } from '@sales-automation/neon-state';
import type { LeadSignalInboxMessage } from '@sales-automation/outreach-email/lead-signal-inbox';

export interface SalesNavigatorResearchResult {
  checkedAlerts: number;
  extractedCandidates: number;
  created: number;
  duplicates: number;
  skippedWithoutTarget: number;
  assigned: number;
  enriched: number;
  rescored: number;
  createdLeadIds: string[];
  duplicateLeadIds: string[];
  errors: Array<{ messageId: string; message: string }>;
  humanReviewRequired: true;
  externalActionAutomated: false;
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

export function splitLinkedInInboxMessages(messages: LeadSignalInboxMessage[]): {
  researchAlerts: LeadSignalInboxMessage[];
  warmMessages: LeadSignalInboxMessage[];
} {
  const researchAlerts: LeadSignalInboxMessage[] = [];
  const warmMessages: LeadSignalInboxMessage[] = [];
  for (const message of messages) {
    if (isSalesNavigatorResearchAlert(message)) researchAlerts.push(message);
    else warmMessages.push(message);
  }
  return { researchAlerts, warmMessages };
}

export function isSalesNavigatorResearchAlert(message: LeadSignalInboxMessage): boolean {
  if (message.source !== 'sales_navigator_email') return false;
  const combined = `${message.subject ?? ''}\n${message.text}`;
  if (buyerIntentPattern.test(combined) || linkedInPostPattern.test(message.sourceUrl ?? '')) return false;
  return researchAlertPattern.test(combined) || linkedInTargetPattern.test(combined);
}

export async function processSalesNavigatorResearchAlerts(input: {
  state: NeonAppState;
  messages: LeadSignalInboxMessage[];
  actor: string;
  generatedAt?: string;
  fetchImpl?: typeof fetch;
}): Promise<SalesNavigatorResearchResult> {
  const [evaluator, fixtures, parsers, discovery] = await Promise.all([
    import('@sales-automation/evaluator'),
    import('@sales-automation/fixtures'),
    import('@sales-automation/parsers'),
    import('@sales-automation/prospect-discovery'),
  ]);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const result: SalesNavigatorResearchResult = {
    checkedAlerts: input.messages.length,
    extractedCandidates: 0,
    created: 0,
    duplicates: 0,
    skippedWithoutTarget: 0,
    assigned: 0,
    enriched: 0,
    rescored: 0,
    createdLeadIds: [],
    duplicateLeadIds: [],
    errors: [],
    humanReviewRequired: true,
    externalActionAutomated: false,
  };

  for (const message of input.messages) {
    try {
      const candidates = extractSalesNavigatorCandidates(message);
      if (!candidates.length) {
        result.skippedWithoutTarget += 1;
        continue;
      }
      result.extractedCandidates += candidates.length;
      for (const candidate of candidates) {
        const researchText = buildResearchText(message, candidate);
        const lead = parsers.parseLinkedInSignal({
          text: researchText,
          capturedAt: message.receivedAt || generatedAt,
          sourceUrl: candidate.sourceUrl,
          contactName: candidate.contactName,
          contactRole: candidate.contactRole,
          companyName: candidate.companyName,
          country: candidate.country,
          region: candidate.region,
        });
        const existing = input.state.repository.getLead(lead.id);
        if (existing) {
          result.duplicates += 1;
          result.duplicateLeadIds.push(existing.lead.id);
          continue;
        }

        let companyWebsite: string | undefined;
        if (lead.companyName) {
          companyWebsite = await discovery.findCompanyWebsite(fetchImpl, lead.companyName).catch(() => undefined);
        }
        const preparedLead = {
          ...lead,
          companyWebsite,
          discoverySource: 'Sales Navigator saved lead/account search alert',
          evidenceUrl: candidate.sourceUrl,
          evidenceSummary: 'Automatically discovered from a native Sales Navigator saved-search alert. Research and human review are required before outreach.',
          pipelineStatus: 'needs_research' as const,
          recommendedNextAction: 'Verify the person, company, current role and a legitimate service-fit or warm-signal basis before preparing outreach.',
          updatedAt: generatedAt,
        };
        input.state.repository.saveEvaluation(evaluator.evaluateLead({
          lead: preparedLead,
          portfolioItems: fixtures.samplePortfolioItems,
          generatedAt,
        }), input.actor);
        input.state.repository.addNote(
          preparedLead.id,
          `sales_navigator_research::${candidate.kind}::${message.messageId}::No LinkedIn action automated.`,
          input.actor,
        );
        result.created += 1;
        result.createdLeadIds.push(preparedLead.id);
      }
    } catch (error) {
      result.errors.push({ messageId: message.messageId, message: errorMessage(error) });
    }
  }

  if (result.createdLeadIds.length > 0) {
    const workload = discovery.buildOwnerWorkload(input.state.repository.listLeads().map((record) => record.lead));
    for (const leadId of result.createdLeadIds) {
      const record = input.state.repository.getLead(leadId);
      if (!record) continue;
      const applied = discovery.applyAutomaticAssignment(record.lead, workload, generatedAt);
      input.state.repository.upsertLead(applied.lead, input.actor);
      input.state.repository.addNote(
        leadId,
        `routing::automatic::${applied.assignment.owner}::research::${applied.assignment.reason}`,
        input.actor,
      );
      result.assigned += 1;
    }

    const enrichment = await discovery.enrichRepositoryContacts({
      repository: input.state.repository,
      fetchImpl,
      maxRecords: Math.min(50, result.createdLeadIds.length),
      leadIds: result.createdLeadIds,
      actor: input.actor,
      now: () => generatedAt,
    });
    result.enriched = enrichment.updated;

    for (const leadId of result.createdLeadIds) {
      const record = input.state.repository.getLead(leadId);
      if (!record) continue;
      input.state.repository.saveEvaluation(evaluator.evaluateLead({
        lead: record.lead,
        portfolioItems: fixtures.samplePortfolioItems,
        generatedAt,
      }), input.actor);
      result.rescored += 1;
    }
  }

  result.createdLeadIds = unique(result.createdLeadIds);
  result.duplicateLeadIds = unique(result.duplicateLeadIds);
  return result;
}

export function extractSalesNavigatorCandidates(message: LeadSignalInboxMessage): SalesNavigatorCandidate[] {
  const combined = `${message.subject ?? ''}\n${message.text}`;
  const candidates: SalesNavigatorCandidate[] = [];
  const seen = new Set<string>();
  for (const match of combined.matchAll(linkedInTargetPattern)) {
    const raw = match[0];
    const sourceUrl = normalizeLinkedInTargetUrl(raw);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const index = match.index ?? 0;
    const context = combined.slice(Math.max(0, index - 280), Math.min(combined.length, index + raw.length + 280));
    const kind = /\/(?:company|sales\/company)\//i.test(new URL(sourceUrl).pathname) ? 'company' : 'person';
    const candidate: SalesNavigatorCandidate = {
      sourceUrl,
      kind,
      context: context.trim().slice(0, 1_500),
      contactName: kind === 'person' ? extractLabel(context, ['lead', 'name', 'contact', 'person']) ?? slugLabel(sourceUrl) : undefined,
      contactRole: kind === 'person' ? extractLabel(context, ['role', 'title']) : undefined,
      companyName: extractLabel(context, ['company', 'account', 'organization']) ?? (kind === 'company' ? slugLabel(sourceUrl) : undefined),
      country: extractLabel(context, ['country']),
      region: extractLabel(context, ['region', 'location']),
    };
    candidates.push(candidate);
  }
  return candidates.slice(0, 30);
}

function buildResearchText(message: LeadSignalInboxMessage, candidate: SalesNavigatorCandidate): string {
  return [
    'Manual research note for a LinkedIn target prospect. This is a cold prospect and needs research before outreach.',
    'No direct buying post is confirmed. The target was discovered automatically from a native Sales Navigator saved lead/account search alert.',
    candidate.companyName ? `Company: ${candidate.companyName}.` : '',
    candidate.contactName ? `Contact: ${candidate.contactName}.` : '',
    candidate.contactRole ? `Role: ${candidate.contactRole}.` : '',
    `LinkedIn evidence: ${candidate.sourceUrl}`,
    `Saved-search alert: ${message.subject ?? 'Sales Navigator alert'}.`,
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
