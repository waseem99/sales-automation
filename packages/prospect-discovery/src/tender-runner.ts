import { createHash } from 'node:crypto';
import { evaluateLead, type LeadEvaluation } from '@sales-automation/evaluator';
import type { Lead, LeadSource, LeadType, ServiceCategory } from '@sales-automation/shared';
import { applyAutomaticAssignment, buildOwnerWorkload } from './assignment.js';
import { sendProspectDigest } from './digest.js';
import { enrichCandidate } from './enrichment.js';
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

  const existingLeads = options.repository.listLeads().map((record) => record.lead);
  const existingKeys = new Set(existingLeads.flatMap(tenderLeadKeys));
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

  for (const candidate of collected.slice(0, maxCandidates)) {
    try {
      const enriched = await enrichCandidate(fetchImpl, candidate);
      const validation = validateTenderCandidate(enriched);
      if (!validation.qualified) {
        rejectedCandidateCount += 1;
        continue;
      }
      if (enriched.companyWebsite || enriched.contactEmail || enriched.contactName || enriched.contactFormUrl) enrichedCount += 1;
      const lead = tenderCandidateToLead(enriched, now());
      const keys = tenderLeadKeys(lead);
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
      }
      newLeads.push(evaluation.lead);
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
  const tender = buildTenderMetadata(candidate, capturedAt);
  if (!tender) throw new Error('Tender metadata is required for tender discovery.');
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

function tenderLeadKeys(lead: Lead): string[] {
  const keys = [`url:${normalizeUrl(lead.sourceUrl ?? lead.evidenceUrl ?? '')}`];
  if (lead.tender?.reference) keys.push(`tender:${lead.tender.portal.toLowerCase()}:${lead.tender.reference.toLowerCase()}`);
  keys.push(`title:${lead.title.toLowerCase().replace(/\s+/g, ' ').trim()}`);
  return keys;
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
  const source = candidate.tender?.portal.includes('PPRA') || candidate.tender?.portal.includes('CanadaBuys') || candidate.tender?.portal.includes('UNGM') ? 40 : 20;
  return 100 + urgency + source;
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
