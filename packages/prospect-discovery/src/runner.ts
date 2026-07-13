import { createHash } from 'node:crypto';
import { evaluateLead, type LeadEvaluation } from '@sales-automation/evaluator';
import type {
  Lead,
  LeadSource,
  LeadType,
  OpportunitySignalStatus,
  ServiceCategory,
} from '@sales-automation/shared';
import { enrichCandidate } from './enrichment.js';
import { sendProspectDigest } from './digest.js';
import {
  collectBingRssCandidates,
  collectGenericRssCandidates,
  collectGreenhouseCandidates,
  collectLeverCandidates,
  collectRemoteOkCandidates,
} from './sources.js';
import { classifyTargeting, EXPANDED_TARGET_SEARCH_QUERIES } from './targeting.js';
import type {
  DiscoveryCandidate,
  ProspectDiscoveryOptions,
  ProspectDiscoveryResult,
  ProspectDiscoveryRun,
  ProspectSourceResult,
} from './types.js';

export async function runProspectDiscovery(options: ProspectDiscoveryOptions): Promise<ProspectDiscoveryResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('Global fetch is unavailable. Supply fetchImpl.');

  const sourceResults: ProspectSourceResult[] = [];
  if (options.bingRssEnabled !== false) {
    sourceResults.push(await collectBingRssCandidates(
      fetchImpl,
      options.searchQueries?.length ? options.searchQueries : EXPANDED_TARGET_SEARCH_QUERIES,
      options.maxSearchQueries ?? 12,
    ));
  }
  if (options.remoteOkEnabled !== false) sourceResults.push(await collectRemoteOkCandidates(fetchImpl));
  if (options.greenhouseBoards?.length) sourceResults.push(await collectGreenhouseCandidates(fetchImpl, options.greenhouseBoards));
  if (options.leverSites?.length) sourceResults.push(await collectLeverCandidates(fetchImpl, options.leverSites));
  if (options.rssFeeds?.length) sourceResults.push(await collectGenericRssCandidates(fetchImpl, options.rssFeeds));

  const existingRecords = options.repository.listLeads();
  const existingLeads = existingRecords.map((record) => record.lead);
  const collected = dedupeCandidates(sourceResults.flatMap((result) => result.candidates), existingLeads);
  const maxCandidates = normalizePositiveInteger(options.maxCandidates, 50);
  const existingKeys = buildExistingKeys(existingLeads);
  const newLeads: Lead[] = [];
  let duplicateCount = 0;
  let enrichedCount = 0;
  const errors = sourceResults.flatMap((result) => result.error ? [`${result.sourceName}: ${result.error}`] : []);

  for (const candidate of collected.slice(0, maxCandidates)) {
    try {
      const enriched = await enrichCandidate(fetchImpl, candidate);
      if (hasUsefulEnrichment(enriched)) enrichedCount += 1;
      if (!passesMinimumQuality(enriched)) continue;
      const lead = candidateToLead(enriched, now());
      const keys = leadKeys(lead);
      if (keys.some((key) => existingKeys.has(key))) {
        duplicateCount += 1;
        continue;
      }
      const evaluation = enrichEvaluation(evaluateLead({
        lead,
        portfolioItems: options.portfolioItems,
        generatedAt: now(),
      }));
      options.repository.saveEvaluation(evaluation, 'prospect-discovery');
      newLeads.push(evaluation.lead);
      for (const key of keys) existingKeys.add(key);
    } catch (error) {
      errors.push(`${candidate.sourceUrl}: ${(error as Error).message}`);
    }
  }

  const completedAt = now();
  const run: ProspectDiscoveryRun = {
    id: `prospect-run-${createHash('sha256').update(`${startedAt}:${completedAt}`).digest('hex').slice(0, 16)}`,
    startedAt,
    completedAt,
    sourceCount: sourceResults.length,
    candidateCount: collected.length,
    enrichedCount,
    newLeadCount: newLeads.length,
    duplicateCount,
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

export function candidateToLead(candidate: DiscoveryCandidate, capturedAt: string): Lead {
  const source = mapSource(candidate);
  const leadType = mapLeadType(candidate.opportunityStatus);
  const company = candidate.companyName ?? hostnameLabel(candidate.companyWebsite ?? candidate.sourceUrl);
  const targetingText = `${candidate.title} ${candidate.summary} ${(candidate.tags ?? []).join(' ')}`;
  const targeting = classifyTargeting(targetingText, candidate.country);
  const serviceCategory = targeting.serviceCategory;
  const postedAt = candidate.publishedAt;
  const freshnessMinutes = postedAt ? Math.max(0, Math.round((Date.parse(capturedAt) - Date.parse(postedAt)) / 60_000)) : undefined;
  const evidenceSummary = candidate.evidenceSummary ?? candidate.summary;
  const idSeed = `${canonicalDomain(candidate.companyWebsite ?? '')}|${normalizeUrl(candidate.sourceUrl)}|${candidate.title.toLowerCase()}`;

  return {
    id: `prospect-${createHash('sha256').update(idSeed).digest('hex').slice(0, 18)}`,
    source,
    sourceUrl: candidate.sourceUrl,
    leadType,
    prospectStage: candidate.opportunityStatus === 'partnership_target' ? 'partner_prospect' : 'warm_lead',
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
    serviceCategory,
    serviceOffer: targeting.serviceOffer,
    materialsToShare: targeting.materialsToShare,
    reachMethod: targeting.reachMethod,
    opportunityStatus: candidate.opportunityStatus,
    discoverySource: candidate.sourceName,
    evidenceUrl: candidate.sourceUrl,
    evidenceSummary,
    discoveredAt: capturedAt,
    timelineSignal: postedAt ? `Published ${postedAt}` : 'Current public source checked during daily discovery.',
    postedAt,
    capturedAt,
    freshnessMinutes,
    feedback: { status: 'pending' },
    rawPayload: {
      prospectDiscovery: {
        sourceName: candidate.sourceName,
        sourceType: candidate.sourceType,
        sourceUrl: candidate.sourceUrl,
        opportunityStatus: candidate.opportunityStatus,
        tags: candidate.tags ?? [],
        evidenceSummary,
        targeting: {
          serviceKey: targeting.serviceKey,
          portfolioIdentity: targeting.portfolioIdentity,
          deliveryModel: targeting.deliveryModel,
          reason: targeting.reason,
        },
      },
    },
    pipelineStatus: candidate.opportunityStatus === 'live_opportunity' ? 'needs_human_review' : 'needs_research',
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

export function classifyServiceCategory(text: string): ServiceCategory {
  return classifyTargeting(text).serviceCategory;
}

function enrichEvaluation(evaluation: LeadEvaluation): LeadEvaluation {
  const lead: Lead = {
    ...evaluation.lead,
    score: evaluation.score,
    recommendedProfile: evaluation.profileRecommendation.primaryProfile,
    recommendedPortfolioItemIds: evaluation.portfolioMatches.map((match) => match.portfolioItem.id),
    recommendedNextAction: evaluation.recommendedNextAction,
    draftMessage: evaluation.drafts[0]?.body,
    updatedAt: new Date().toISOString(),
  };
  return { ...evaluation, lead };
}

function mapSource(candidate: DiscoveryCandidate): LeadSource {
  if (candidate.sourceType === 'job_board') return 'public_job_board';
  if (candidate.sourceType === 'directory') return 'public_directory';
  if (candidate.sourceType === 'procurement') return 'public_procurement';
  return 'public_web';
}

function mapLeadType(status: OpportunitySignalStatus): LeadType {
  if (status === 'live_opportunity') return 'public_opportunity';
  if (status === 'recent_demand_signal') return 'hiring_signal';
  return 'partnership_target';
}

function passesMinimumQuality(candidate: DiscoveryCandidate): boolean {
  if (!candidate.sourceUrl || !candidate.title || !candidate.summary) return false;
  if (candidate.opportunityStatus === 'live_opportunity') {
    return Boolean(candidate.companyName || candidate.companyWebsite || candidate.contactEmail || candidate.contactFormUrl);
  }
  if (candidate.opportunityStatus === 'recent_demand_signal') {
    return Boolean(candidate.companyName && (candidate.companyWebsite || candidate.contactEmail || candidate.contactFormUrl));
  }
  return Boolean(candidate.companyWebsite && (candidate.contactEmail || candidate.contactFormUrl || candidate.contactName));
}

function hasUsefulEnrichment(candidate: DiscoveryCandidate): boolean {
  return Boolean(candidate.companyWebsite || candidate.contactEmail || candidate.contactName || candidate.contactFormUrl);
}

function buildExistingKeys(leads: Lead[]): Set<string> {
  return new Set(leads.flatMap(leadKeys));
}

function leadKeys(lead: Lead): string[] {
  const keys = [`url:${normalizeUrl(lead.sourceUrl ?? lead.evidenceUrl ?? '')}`];
  const domain = canonicalDomain(lead.companyWebsite ?? '');
  if (domain) keys.push(`domain-title:${domain}:${lead.title.toLowerCase().replace(/\s+/g, ' ').trim()}`);
  if (lead.contactEmail) keys.push(`email:${lead.contactEmail.toLowerCase()}`);
  return keys.filter((key) => !key.endsWith(':'));
}

function dedupeCandidates(candidates: DiscoveryCandidate[], historicalLeads: Lead[]): DiscoveryCandidate[] {
  const seen = new Set<string>();
  const ordered = [...candidates].sort((a, b) => priority(b, historicalLeads) - priority(a, historicalLeads));
  return ordered.filter((candidate) => {
    const key = normalizeUrl(candidate.sourceUrl);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function priority(candidate: DiscoveryCandidate, historicalLeads: Lead[]): number {
  const status = candidate.opportunityStatus === 'live_opportunity' ? 300
    : candidate.opportunityStatus === 'recent_demand_signal' ? 200 : 100;
  const recency = candidate.publishedAt ? Math.max(0, 60 - Math.floor((Date.now() - Date.parse(candidate.publishedAt)) / 86_400_000)) : 0;
  return status + recency + historicalSourceAdjustment(candidate.sourceName, historicalLeads);
}

function historicalSourceAdjustment(sourceName: string, leads: Lead[]): number {
  const relevant = leads.filter((lead) => lead.discoverySource === sourceName && lead.feedback?.status === 'complete');
  if (relevant.length === 0) return 0;
  const averageRating = relevant.reduce((sum, lead) => sum + (lead.feedback?.relevanceRating ?? 3), 0) / relevant.length;
  const outcomeScore = relevant.reduce((sum, lead) => {
    if (lead.pipelineStatus === 'won') return sum + 40;
    if (lead.pipelineStatus === 'meeting_booked' || lead.pipelineStatus === 'proposal_sent') return sum + 20;
    if (lead.pipelineStatus === 'replied') return sum + 10;
    if (lead.pipelineStatus === 'rejected' || lead.outcomeStatus === 'not_fit') return sum - 20;
    return sum;
  }, 0) / relevant.length;
  const repeatScore = relevant.reduce((sum, lead) => {
    const recommendation = lead.feedback?.repeatRecommendation;
    return sum + (recommendation === 'increase' ? 25 : recommendation === 'keep' ? 5 : recommendation === 'reduce' ? -20 : recommendation === 'stop' ? -50 : 0);
  }, 0) / relevant.length;
  return Math.round((averageRating - 3) * 15 + outcomeScore + repeatScore);
}

function canonicalDomain(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

function hostnameLabel(value: string): string {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '');
    return (host.split('.')[0] ?? host).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return 'Unknown company';
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}
