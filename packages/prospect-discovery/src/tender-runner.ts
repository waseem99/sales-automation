import { createHash } from 'node:crypto';
import { evaluateLead, type LeadEvaluation } from '@sales-automation/evaluator';
import type {
  Lead,
  LeadSource,
  LeadType,
  ServiceCategory,
  TenderDocumentIntelligence,
} from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { applyAutomaticAssignment, buildOwnerWorkload } from './assignment.js';
import { sendProspectDigest } from './digest.js';
import { enrichCandidate } from './enrichment.js';
import { collectExpandedPublicTenderCandidates } from './expanded-tenders.js';
import {
  enrichTenderDocumentIntelligence,
  withAmendmentStatus,
} from './tender-documents.js';
import {
  buildTenderMetadata,
  collectCanadaBuysTenderCandidates,
  collectPpraTenderCandidates,
  collectPrivateNonprofitTenderCandidates,
  collectUngmTenderCandidates,
} from './tenders.js';
import { validateTenderCandidate } from './tender-validation.js';
import { classifyTargeting } from './targeting.js';
import type {
  DiscoveryCandidate,
  ProspectDiscoveryOptions,
  ProspectDiscoveryResult,
  ProspectDiscoveryRun,
  ProspectSourceResult,
} from './types.js';

export async function runTenderDiscovery(options: ProspectDiscoveryOptions): Promise<ProspectDiscoveryResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('Global fetch is unavailable. Supply fetchImpl.');

  const sourceResults: ProspectSourceResult[] = [];
  if (options.ppraEnabled !== false) sourceResults.push(await collectPpraTenderCandidates(fetchImpl));
  if (options.canadaBuysEnabled !== false) sourceResults.push(await collectCanadaBuysTenderCandidates(fetchImpl));
  if (options.ungmEnabled !== false) sourceResults.push(await collectUngmTenderCandidates(fetchImpl));
  if (options.privateNonprofitTendersEnabled !== false) sourceResults.push(await collectPrivateNonprofitTenderCandidates(fetchImpl));
  if (options.expandedPublicTendersEnabled !== false) sourceResults.push(await collectExpandedPublicTenderCandidates(fetchImpl));

  const existingRecords = options.repository.listLeads();
  const existingLeads = existingRecords.map((record) => record.lead);
  const existingIndex = buildExistingTenderIndex(existingRecords);
  const existingKeys = new Set(existingIndex.keys());
  const workload = buildOwnerWorkload(existingLeads);
  const errors = sourceResults.flatMap((result) => result.error ? [`${result.sourceName}: ${result.error}`] : []);
  let rejectedCandidateCount = 0;
  const collected = dedupeTenderCandidates(sourceResults.flatMap((result) => result.candidates))
    .filter((candidate) => isActiveTender(candidate, startedAt))
    .filter((candidate) => {
      const validation = validateTenderCandidate(candidate);
      if (validation.qualified) return true;
      rejectedCandidateCount += 1;
      return false;
    });
  const maxCandidates = positiveInteger(options.maxCandidates, 80);
  const newLeads: Lead[] = [];
  let duplicateCount = 0;
  let enrichedCount = 0;
  let tenderDocumentIntelligenceCount = 0;
  let tenderAmendmentCount = 0;
  let tenderExistingEnrichedCount = 0;

  for (const candidate of collected.slice(0, maxCandidates)) {
    try {
      let enriched = await enrichCandidate(fetchImpl, candidate);
      if (options.tenderDocumentIntelligenceEnabled !== false) {
        enriched = await enrichTenderDocumentIntelligence(
          fetchImpl,
          enriched,
          now(),
          positiveInteger(options.tenderDocumentMaxBytes, 4_000_000),
        );
        if (enriched.tender?.documentIntelligence?.contentHash) tenderDocumentIntelligenceCount += 1;
      }

      const validation = validateTenderCandidate(enriched);
      if (!validation.qualified) {
        rejectedCandidateCount += 1;
        continue;
      }
      if (enriched.companyWebsite || enriched.contactEmail || enriched.contactName || enriched.contactFormUrl) enrichedCount += 1;
      const lead = tenderCandidateToLead(enriched, now());
      const keys = tenderLeadKeys(lead);
      const existing = keys.map((key) => existingIndex.get(key)).find(Boolean);
      if (existing) {
        const update = updateExistingTenderIntelligence({
          existing,
          discovered: lead,
          portfolioItems: options.portfolioItems,
          generatedAt: now(),
          repository: options.repository,
        });
        if (update === 'amendment') tenderAmendmentCount += 1;
        else if (update === 'enriched') tenderExistingEnrichedCount += 1;
        else duplicateCount += 1;
        continue;
      }
      if (keys.some((key) => existingKeys.has(key))) {
        duplicateCount += 1;
        continue;
      }

      const evaluated = enrichEvaluation(evaluateLead({
        lead,
        portfolioItems: options.portfolioItems,
        generatedAt: now(),
      }));
      const assigned = applyAutomaticAssignment(evaluated.lead, workload, now());
      const evaluation: LeadEvaluation = { ...evaluated, lead: assigned.lead };
      options.repository.saveEvaluation(evaluation, 'tender-discovery');
      options.repository.addNote(
        evaluation.lead.id,
        `routing::automatic::${assigned.assignment.owner}::${assigned.approach.channel}::${assigned.assignment.reason} | ${assigned.approach.nextAction}`,
        'tender-discovery',
      );
      if (evaluation.lead.tender) {
        options.repository.addNote(
          evaluation.lead.id,
          `tender::${evaluation.lead.tender.recommendation}::${evaluation.lead.tender.closeabilityScore}::${evaluation.lead.tender.recommendationReason}`,
          'tender-discovery',
        );
        const intelligence = evaluation.lead.tender.documentIntelligence;
        if (intelligence) {
          options.repository.addNote(
            evaluation.lead.id,
            `tender_intelligence::${intelligence.amendmentStatus}::${intelligence.contentHash ?? 'unavailable'}::${intelligence.missingInformation.length} information gaps`,
            'tender-discovery',
          );
        }
      }
      newLeads.push(evaluation.lead);
      const stored = options.repository.getLead(evaluation.lead.id);
      if (stored) for (const key of keys) existingIndex.set(key, stored);
      for (const key of keys) existingKeys.add(key);
    } catch (error) {
      errors.push(`${candidate.sourceUrl}: ${(error as Error).message}`);
    }
  }

  const completedAt = now();
  const run: ProspectDiscoveryRun = {
    id: `tender-run-${createHash('sha256').update(`${startedAt}:${completedAt}`).digest('hex').slice(0, 16)}`,
    startedAt,
    completedAt,
    sourceCount: sourceResults.length,
    candidateCount: collected.length,
    enrichedCount,
    newLeadCount: newLeads.length,
    duplicateCount,
    autoAssignedCount: newLeads.length,
    tenderCandidateCount: collected.length,
    newTenderCount: newLeads.length,
    rejectedCandidateCount,
    tenderDocumentIntelligenceCount,
    tenderAmendmentCount,
    tenderExistingEnrichedCount,
    emailStatus: 'skipped',
    errors,
    newLeadIds: newLeads.map((lead) => lead.id),
  };

  const delivery = await sendProspectDigest(newLeads, run, options.digest, options.portfolioItems);
  run.emailStatus = delivery.status;
  run.emailMessage = delivery.message;
  options.runStore?.saveRun(run);
  return { run, newLeads, sourceResults };
}

export function tenderCandidateToLead(candidate: DiscoveryCandidate, capturedAt: string): Lead {
  const validation = validateTenderCandidate(candidate);
  if (!validation.qualified) throw new Error(`Tender candidate failed validation: ${validation.reasons.join(' ')}`);
  const targetingText = `${candidate.title} ${candidate.summary} ${(candidate.tags ?? []).join(' ')}`;
  const targeting = classifyTargeting(targetingText, candidate.country);
  const baseTender = buildTenderMetadata(candidate, capturedAt);
  if (!baseTender) throw new Error('Tender metadata is required for tender discovery.');
  const tender = {
    ...baseTender,
    documentIntelligence: candidate.tender?.documentIntelligence,
  };
  const company = candidate.companyName ?? portalHostLabel(candidate.companyWebsite ?? candidate.sourceUrl);
  const postedAt = tender.publishedAt ?? candidate.publishedAt;
  const freshnessMinutes = postedAt ? Math.max(0, Math.round((Date.parse(capturedAt) - Date.parse(postedAt)) / 60_000)) : undefined;
  const idSeed = `${tender.portal}|${tender.reference ?? ''}|${normalizeUrl(candidate.sourceUrl)}|${candidate.title.toLowerCase()}`;

  return {
    id: `tender-${createHash('sha256').update(idSeed).digest('hex').slice(0, 18)}`,
    source: 'public_procurement' as LeadSource,
    sourceUrl: candidate.sourceUrl,
    leadType: 'public_opportunity' as LeadType,
    prospectStage: 'warm_lead',
    title: candidate.title,
    description: candidate.summary,
    companyName: company,
    companyWebsite: candidate.companyWebsite,
    contactName: candidate.contactName,
    contactRole: candidate.contactRole,
    contactEmail: candidate.contactEmail,
    contactPhone: candidate.contactPhone,
    contactFormUrl: candidate.contactFormUrl,
    linkedinUrl: candidate.linkedinUrl,
    country: candidate.country,
    industry: tender.sector === 'nonprofit' || tender.sector === 'development' ? 'Nonprofit and development' : `${tender.sector} sector`,
    serviceCategory: targeting.serviceCategory as ServiceCategory,
    serviceOffer: targeting.serviceOffer,
    materialsToShare: targeting.materialsToShare,
    reachMethod: 'Official procurement portal or published procurement email',
    opportunityStatus: 'live_opportunity',
    discoverySource: candidate.sourceName,
    evidenceUrl: candidate.sourceUrl,
    evidenceSummary: candidate.evidenceSummary ?? `Formal procurement opportunity from ${tender.portal}.`,
    discoveredAt: capturedAt,
    confidence: tender.closeabilityScore >= 80 ? 'high' : tender.closeabilityScore >= 65 ? 'medium' : 'low',
    budgetSignal: tender.estimatedValue,
    timelineSignal: tender.deadline
      ? `Tender deadline ${tender.deadline}${tender.daysRemaining !== undefined ? ` (${tender.daysRemaining} days remaining)` : ''}`
      : 'Submission deadline requires confirmation.',
    postedAt,
    capturedAt,
    freshnessMinutes,
    tender,
    feedback: { status: 'pending' },
    rawPayload: {
      tenderDiscovery: {
        portal: tender.portal,
        reference: tender.reference,
        sector: tender.sector,
        opportunityType: tender.opportunityType,
        deadline: tender.deadline,
        closeabilityScore: tender.closeabilityScore,
        recommendation: tender.recommendation,
        risks: tender.riskFlags,
        documentIntelligence: tender.documentIntelligence ? {
          format: tender.documentIntelligence.format,
          contentHash: tender.documentIntelligence.contentHash,
          documentUrls: tender.documentIntelligence.documentUrls,
          amendmentStatus: tender.documentIntelligence.amendmentStatus,
          missingInformation: tender.documentIntelligence.missingInformation,
        } : undefined,
      },
      targeting: {
        serviceKey: targeting.serviceKey,
        portfolioIdentity: targeting.portfolioIdentity,
        deliveryModel: targeting.deliveryModel,
        reason: targeting.reason,
      },
    },
    pipelineStatus: tender.recommendation === 'reject' ? 'needs_research' : 'needs_human_review',
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

type ExistingTenderUpdate = 'duplicate' | 'enriched' | 'amendment';

function updateExistingTenderIntelligence(input: {
  existing: StoredLeadRecord;
  discovered: Lead;
  portfolioItems: ProspectDiscoveryOptions['portfolioItems'];
  generatedAt: string;
  repository: ProspectDiscoveryOptions['repository'];
}): ExistingTenderUpdate {
  const previous = input.existing.lead.tender?.documentIntelligence;
  const incoming = input.discovered.tender?.documentIntelligence;
  if (!incoming?.contentHash) return 'duplicate';
  if (previous?.contentHash === incoming.contentHash) return 'duplicate';

  const amendment = Boolean(previous?.contentHash && previous.contentHash !== incoming.contentHash);
  const summary = amendment
    ? 'The retained source or tender document content changed since the previous discovery run. Recheck deadline, eligibility, scope and forms before proceeding.'
    : 'Structured document intelligence was added to an existing tender record.';
  const documentIntelligence = withAmendmentStatus(incoming, amendment ? 'changed' : 'unchanged', summary);
  const existingLead = input.existing.lead;
  const refreshed: Lead = {
    ...existingLead,
    title: input.discovered.title,
    description: input.discovered.description,
    companyName: input.discovered.companyName ?? existingLead.companyName,
    companyWebsite: input.discovered.companyWebsite ?? existingLead.companyWebsite,
    evidenceUrl: input.discovered.evidenceUrl ?? existingLead.evidenceUrl,
    evidenceSummary: input.discovered.evidenceSummary ?? existingLead.evidenceSummary,
    budgetSignal: input.discovered.budgetSignal ?? existingLead.budgetSignal,
    timelineSignal: input.discovered.timelineSignal ?? existingLead.timelineSignal,
    tender: {
      ...(existingLead.tender ?? input.discovered.tender!),
      ...input.discovered.tender!,
      documentIntelligence,
    },
    updatedAt: input.generatedAt,
  };
  const evaluated = enrichEvaluation(evaluateLead({
    lead: refreshed,
    portfolioItems: input.portfolioItems,
    generatedAt: input.generatedAt,
  }));
  const evaluation: LeadEvaluation = {
    ...evaluated,
    lead: {
      ...evaluated.lead,
      owner: existingLead.owner ?? evaluated.lead.owner,
      pipelineStatus: existingLead.pipelineStatus,
      feedback: existingLead.feedback,
      nextFollowUpAt: existingLead.nextFollowUpAt,
      followUpNote: existingLead.followUpNote,
      lastContactedAt: existingLead.lastContactedAt,
      lastResponseAt: existingLead.lastResponseAt,
      outcomeStatus: existingLead.outcomeStatus,
      outcomeReason: existingLead.outcomeReason,
      outcomeRecordedAt: existingLead.outcomeRecordedAt,
      createdAt: existingLead.createdAt,
      updatedAt: input.generatedAt,
    },
  };
  input.repository.saveEvaluation(evaluation, 'tender-document-intelligence');
  input.repository.addNote(
    existingLead.id,
    amendment
      ? `tender_amendment::changed::${previous?.contentHash ?? 'unknown'}::${incoming.contentHash}::${summary}`
      : `tender_intelligence::enriched::${incoming.contentHash}::${summary}`,
    'tender-document-intelligence',
  );
  return amendment ? 'amendment' : 'enriched';
}

function enrichEvaluation(evaluation: LeadEvaluation): LeadEvaluation {
  const lead: Lead = {
    ...evaluation.lead,
    score: evaluation.score,
    recommendedProfile: evaluation.profileRecommendation.primaryProfile,
    recommendedPortfolioItemIds: evaluation.portfolioMatches.map((match) => match.portfolioItem.id),
    draftMessage: evaluation.drafts[0]?.body,
    updatedAt: new Date().toISOString(),
  };
  return { ...evaluation, lead };
}

function isActiveTender(candidate: DiscoveryCandidate, capturedAt: string): boolean {
  const deadline = Date.parse(candidate.tender?.deadline ?? '');
  if (!Number.isFinite(deadline)) return true;
  return deadline >= Date.parse(capturedAt) - 6 * 60 * 60 * 1_000;
}

function buildExistingTenderIndex(records: StoredLeadRecord[]): Map<string, StoredLeadRecord> {
  const index = new Map<string, StoredLeadRecord>();
  for (const record of records) for (const key of tenderLeadKeys(record.lead)) index.set(key, record);
  return index;
}

function tenderLeadKeys(lead: Lead): string[] {
  const keys = [`url:${normalizeUrl(lead.sourceUrl ?? lead.evidenceUrl ?? '')}`];
  if (lead.tender?.reference) keys.push(`tender:${lead.tender.portal.toLowerCase()}:${lead.tender.reference.toLowerCase()}`);
  keys.push(`title:${lead.title.toLowerCase().replace(/\s+/g, ' ').trim()}`);
  return keys.filter((key) => !key.endsWith(':'));
}

function dedupeTenderCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const seen = new Set<string>();
  return candidates
    .sort((left, right) => tenderCandidatePriority(right) - tenderCandidatePriority(left))
    .filter((candidate) => {
      const key = candidate.tender?.reference
        ? `${candidate.tender.portal.toLowerCase()}:${candidate.tender.reference.toLowerCase()}`
        : normalizeUrl(candidate.sourceUrl);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function tenderCandidatePriority(candidate: DiscoveryCandidate): number {
  const deadline = Date.parse(candidate.tender?.deadline ?? '');
  const days = Number.isFinite(deadline) ? Math.ceil((deadline - Date.now()) / 86_400_000) : 30;
  const urgency = days >= 7 ? 40 : days >= 3 ? 60 : days >= 1 ? 80 : 0;
  const trusted = candidate.sourceType === 'procurement' ? 40 : 20;
  const document = candidate.tender?.documentIntelligence?.contentHash ? 20 : 0;
  return 100 + urgency + trusted + document;
}

function normalizeUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

function portalHostLabel(value: string): string {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '');
    return (host.split('.')[0] ?? host).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return 'Procurement buyer';
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}
