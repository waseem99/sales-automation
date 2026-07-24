import { createHash } from 'node:crypto';
import { evaluateLead, type EvaluatedLead } from '@sales-automation/evaluator';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { loadNeonAppState, persistLeadRecords } from '@sales-automation/neon-state';
import {
  applyAutomaticAssignment,
  buildOwnerWorkload,
} from '@sales-automation/prospect-discovery';
import type {
  Lead,
  LeadType,
  PipelineStatus,
  ProspectConfidence,
  ProspectStage,
  ServiceCategory,
} from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { applyFirstOutreachGuidance } from '@sales-automation/web';

export const ACQUISITION_SYNC_SCHEMA = 'codistan-acquisition-sync.v1';
const MAX_RECORDS = 50;
const ACTOR = 'acquisition-v4@codistan.local';
const PRE_CONTACT_STATUSES = new Set<PipelineStatus>([
  'new',
  'scored',
  'needs_research',
  'needs_human_review',
  'approved_to_contact',
  'draft_ready',
]);

type AcquisitionSource = 'linkedin' | 'upwork';
type AcquisitionDisposition = 'priority_a' | 'priority_b' | 'research' | 'reject';

export interface AcquisitionSyncRecord {
  schema_version?: string;
  parser_version?: string;
  source: AcquisitionSource;
  source_subtype?: string;
  canonical_url: string;
  source_native_id?: string;
  dedupe_key: string;
  title: string;
  body: string;
  author_name?: string;
  author_profile_url?: string;
  author_headline?: string;
  company_name?: string;
  published_at?: string;
  posted_age?: string;
  page_url?: string;
  page_identity?: string;
  captured_at?: string;
  commercial_evidence?: Record<string, unknown>;
  raw_evidence?: Record<string, unknown>;
  qualification?: {
    disposition?: AcquisitionDisposition;
    total_score?: number;
    confidence?: ProspectConfidence;
    service_route?: string;
    service_lanes?: string[];
    positive_reasons?: string[];
    missing_evidence?: string[];
    risk_reasons?: string[];
    recommended_next_action?: string;
    dimensions?: Record<string, number>;
    configuration_version?: string;
  };
  external_action_performed?: boolean;
  last_enriched_at?: string;
}

export interface AcquisitionIntakePayload {
  schema_version?: string;
  source?: AcquisitionSource;
  external_action_performed?: boolean;
  records?: AcquisitionSyncRecord[];
}

export async function handleAcquisitionIntake(input: {
  body: unknown;
  databaseUrl: string;
}): Promise<Response> {
  try {
    const payload = validatePayload(input.body);
    const generatedAt = new Date().toISOString();
    const state = await loadNeonAppState(input.databaseUrl);
    const sourceIndex = buildSourceIndex(state.repository.listLeads());
    const touchedIds: string[] = [];
    const createdIds: string[] = [];
    const updatedIds: string[] = [];
    const unchangedIds: string[] = [];
    const rejected: Array<{ sourceUrl?: string; reason: string }> = [];

    for (const raw of payload.records) {
      try {
        validateRecord(raw, payload.source);
        if (raw.qualification?.disposition === 'reject') {
          rejected.push({ sourceUrl: raw.canonical_url, reason: 'Local Acquisition V4 qualification rejected this record.' });
          continue;
        }

        const incoming = mapAcquisitionRecord(raw, generatedAt);
        const sourceKey = normalizedSourceKey(incoming.sourceUrl ?? raw.canonical_url);
        const existing = state.repository.getLead(incoming.id) ?? sourceIndex.get(sourceKey);
        const previousSnapshot = existing ? JSON.stringify(existing) : '';
        let lead = existing ? mergeIncomingLead(existing.lead, incoming, generatedAt) : incoming;
        let evaluated = enrichEvaluation(evaluateLead({
          lead,
          portfolioItems: samplePortfolioItems,
          generatedAt,
        }));
        lead = evaluated.lead;
        state.repository.saveEvaluation(evaluated, ACTOR);

        if (!lead.owner) {
          const workload = buildOwnerWorkload(state.repository.listLeads().map((record) => record.lead));
          const assigned = applyAutomaticAssignment(lead, workload, generatedAt);
          evaluated = enrichEvaluation(evaluateLead({
            lead: assigned.lead,
            portfolioItems: samplePortfolioItems,
            generatedAt,
          }));
          state.repository.saveEvaluation(evaluated, ACTOR);
          state.repository.addNote(
            evaluated.lead.id,
            `routing::automatic::${assigned.assignment.owner}::${assigned.approach.channel}::${assigned.assignment.reason} | ${assigned.approach.nextAction}`,
            ACTOR,
          );
        }

        let current = state.repository.getLead(lead.id);
        if (!current) throw new Error('Prospect Desk did not retain the ingested record.');
        state.repository.addNote(
          current.lead.id,
          `acquisition_v4_sync::${raw.source}::${raw.qualification?.disposition ?? 'unclassified'}::${raw.canonical_url}`,
          ACTOR,
        );
        current = state.repository.getLead(current.lead.id)!;

        if (PRE_CONTACT_STATUSES.has(current.lead.pipelineStatus)) {
          applyFirstOutreachGuidance({
            repository: state.repository,
            record: current,
            portfolioItems: samplePortfolioItems,
            actor: ACTOR,
            generatedAt,
          });
        }

        const finalRecord = state.repository.getLead(current.lead.id)!;
        touchedIds.push(finalRecord.lead.id);
        sourceIndex.set(sourceKey, finalRecord);
        if (!existing) createdIds.push(finalRecord.lead.id);
        else if (JSON.stringify(finalRecord) !== previousSnapshot) updatedIds.push(finalRecord.lead.id);
        else unchangedIds.push(finalRecord.lead.id);
      } catch (error) {
        rejected.push({
          sourceUrl: optionalString(raw?.canonical_url),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const touched = unique(touchedIds)
      .map((leadId) => state.repository.getLead(leadId))
      .filter((record): record is StoredLeadRecord => Boolean(record));
    await persistLeadRecords(input.databaseUrl, touched);

    return responseJson({
      ok: true,
      schemaVersion: ACQUISITION_SYNC_SCHEMA,
      source: payload.source,
      input: payload.records.length,
      created: unique(createdIds).length,
      updated: unique(updatedIds).length,
      unchanged: unique(unchangedIds).length,
      rejected: rejected.length,
      createdLeadIds: unique(createdIds),
      updatedLeadIds: unique(updatedIds),
      unchangedLeadIds: unique(unchangedIds),
      rejectedRecords: rejected,
      processedLeadIds: unique(touchedIds),
      humanReviewRequired: true,
      externalActionAutomated: false,
      prospectUrl: touchedIds[0] ? `/prospects?leadId=${encodeURIComponent(touchedIds[0])}` : '/prospects',
    }, createdIds.length > 0 ? 201 : 200);
  } catch (error) {
    return responseJson({
      error: error instanceof Error ? error.message : String(error),
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, 400);
  }
}

function validatePayload(value: unknown): { source: AcquisitionSource; records: AcquisitionSyncRecord[] } {
  const payload = asObject(value) as Partial<AcquisitionIntakePayload>;
  if (payload.schema_version !== ACQUISITION_SYNC_SCHEMA) {
    throw new Error(`schema_version must be ${ACQUISITION_SYNC_SCHEMA}.`);
  }
  if (payload.external_action_performed !== false) {
    throw new Error('The ingestion endpoint accepts evidence-only records with no external action.');
  }
  if (payload.source !== 'linkedin' && payload.source !== 'upwork') throw new Error('source must be linkedin or upwork.');
  if (!Array.isArray(payload.records) || payload.records.length === 0) throw new Error('records must contain at least one item.');
  if (payload.records.length > MAX_RECORDS) throw new Error(`A maximum of ${MAX_RECORDS} records may be ingested per request.`);
  return { source: payload.source, records: payload.records as AcquisitionSyncRecord[] };
}

function validateRecord(record: AcquisitionSyncRecord, batchSource: AcquisitionSource): void {
  if (!record || typeof record !== 'object') throw new Error('Each record must be an object.');
  if (record.external_action_performed === true) throw new Error('Records that performed an external action are not accepted.');
  if (record.source !== batchSource) throw new Error('Record source does not match the batch source.');
  if (!record.dedupe_key?.trim()) throw new Error('dedupe_key is required.');
  if (!record.title?.trim()) throw new Error('title is required.');
  if (!record.body?.trim() || record.body.trim().length < 20) throw new Error('body must contain visible opportunity evidence.');
  const sourceUrl = new URL(record.canonical_url);
  if (sourceUrl.protocol !== 'https:') throw new Error('canonical_url must use HTTPS.');
  const host = sourceUrl.hostname.toLowerCase();
  if (record.source === 'linkedin') {
    if (!['linkedin.com', 'www.linkedin.com'].includes(host)) throw new Error('LinkedIn records require a linkedin.com canonical_url.');
    if (!sourceUrl.pathname.startsWith('/posts/') && !sourceUrl.pathname.startsWith('/feed/update/') && !sourceUrl.pathname.startsWith('/pulse/')) {
      throw new Error('LinkedIn records require an original post URL.');
    }
  } else if (!['upwork.com', 'www.upwork.com'].includes(host)) {
    throw new Error('Upwork records require an upwork.com canonical_url.');
  }
}

function mapAcquisitionRecord(record: AcquisitionSyncRecord, generatedAt: string): Lead {
  const qualification = record.qualification ?? {};
  const route = String(qualification.service_route ?? '').trim();
  const lanes = Array.isArray(qualification.service_lanes) ? qualification.service_lanes.map(String) : [];
  const serviceCategory = serviceCategoryFor(route, lanes);
  const isPartner = route === 'delivery_partner' || lanes.includes('delivery_partner');
  const sourceUrl = normalizePublicUrl(record.canonical_url);
  const authorHeadline = clean(record.author_headline, 500);
  const companyName = clean(record.company_name, 300) || companyFromHeadline(authorHeadline);
  const contactEmail = extractPublicEmail(record.body);
  const disposition = qualification.disposition ?? 'research';
  const totalScore = clampScore(qualification.total_score);
  const capturedAt = validIso(record.captured_at) ?? generatedAt;
  const postedAt = validIso(record.published_at) ?? postedAtFromAge(record.posted_age, capturedAt);
  const leadType: LeadType = record.source === 'upwork'
    ? 'upwork_job'
    : isPartner
      ? 'partner_prospect'
      : 'linkedin_warm_post';
  const prospectStage: ProspectStage = record.source === 'upwork'
    ? 'warm_lead'
    : isPartner
      ? 'partner_prospect'
      : 'warm_lead';
  const confidence = normalizeConfidence(qualification.confidence);
  const id = `acq-${record.source}-${record.dedupe_key.replace(/[^a-z0-9]/gi, '').slice(0, 48) || shortHash(sourceUrl)}`;
  const commercial = asObject(record.commercial_evidence);
  const contactRoutes = Array.isArray(commercial.contact_routes) ? commercial.contact_routes.map(String) : [];
  const positiveReasons = Array.isArray(qualification.positive_reasons) ? qualification.positive_reasons.map(String) : [];
  const missingEvidence = Array.isArray(qualification.missing_evidence) ? qualification.missing_evidence.map(String) : [];
  const riskReasons = Array.isArray(qualification.risk_reasons) ? qualification.risk_reasons.map(String) : [];
  const evidenceSummary = [
    positiveReasons.slice(0, 3).join('; '),
    clean(record.body, 420),
  ].filter(Boolean).join(' — ');
  const pipelineStatus: PipelineStatus = disposition === 'research' ? 'needs_research' : 'needs_human_review';
  const service = servicePresentation(serviceCategory, isPartner);

  return {
    id,
    source: record.source,
    sourceUrl,
    leadType,
    prospectStage,
    title: clean(record.title, 500) || 'LinkedIn buyer requirement',
    description: clean(record.body, 20_000),
    companyName: companyName || undefined,
    contactName: clean(record.author_name, 300) || undefined,
    contactRole: roleFromHeadline(authorHeadline) || undefined,
    contactEmail,
    linkedinUrl: normalizeOptionalLinkedInUrl(record.author_profile_url),
    serviceCategory,
    serviceOffer: service.offer,
    materialsToShare: service.materials,
    reachMethod: reachMethod(contactRoutes, contactEmail, record.source),
    opportunityStatus: 'live_opportunity',
    discoverySource: `Acquisition V4 ${record.source} capture${record.page_identity ? ` — ${clean(record.page_identity, 300)}` : ''}`,
    evidenceUrl: sourceUrl,
    evidenceSummary,
    discoveredAt: capturedAt,
    rank: Math.max(1, 101 - totalScore),
    confidence,
    budgetSignal: commercialValueSignal(commercial),
    timelineSignal: clean(record.posted_age, 100) || undefined,
    postedAt,
    capturedAt,
    freshnessMinutes: postedAt ? Math.max(0, Math.round((Date.parse(capturedAt) - Date.parse(postedAt)) / 60_000)) : undefined,
    rawPayload: {
      acquisitionSchema: record.schema_version,
      parserVersion: record.parser_version,
      sourceNativeId: record.source_native_id,
      dedupeKey: record.dedupe_key,
      sourceSubtype: record.source_subtype,
      authorHeadline,
      pageUrl: record.page_url,
      pageIdentity: record.page_identity,
      commercialEvidence: record.commercial_evidence ?? {},
      rawEvidence: record.raw_evidence ?? {},
      qualification: {
        ...qualification,
        positive_reasons: positiveReasons,
        missing_evidence: missingEvidence,
        risk_reasons: riskReasons,
      },
      lastEnrichedAt: record.last_enriched_at,
      externalActionPerformed: false,
    },
    recommendedNextAction: clean(qualification.recommended_next_action, 1_000) || 'Review the original evidence and prepare human-approved outreach.',
    pipelineStatus,
    createdAt: capturedAt,
    updatedAt: generatedAt,
  };
}

function enrichEvaluation(evaluation: EvaluatedLead): EvaluatedLead {
  const preferredDraft = evaluation.drafts.find((draft) => draft.type === 'linkedin_dm' || draft.type === 'partner_outreach' || draft.type === 'upwork_proposal')
    ?? evaluation.drafts[0];
  const lead: Lead = {
    ...evaluation.lead,
    score: evaluation.score,
    recommendedProfile: evaluation.profileRecommendation.primaryProfile,
    recommendedPortfolioItemIds: evaluation.portfolioMatches.map((match) => match.portfolioItem.id),
    recommendedNextAction: evaluation.recommendedNextAction,
    draftMessage: preferredDraft?.body ?? evaluation.lead.draftMessage,
    updatedAt: new Date().toISOString(),
  };
  return { ...evaluation, lead };
}

function mergeIncomingLead(existing: Lead, incoming: Lead, generatedAt: string): Lead {
  const operationalStatus = existing.pipelineStatus;
  const preserveStatus = !PRE_CONTACT_STATUSES.has(operationalStatus);
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    title: longer(existing.title, incoming.title),
    description: longer(existing.description, incoming.description),
    companyName: incoming.companyName ?? existing.companyName,
    companyWebsite: existing.companyWebsite,
    contactName: incoming.contactName ?? existing.contactName,
    contactRole: incoming.contactRole ?? existing.contactRole,
    contactEmail: incoming.contactEmail ?? existing.contactEmail,
    contactPhone: existing.contactPhone,
    contactFormUrl: existing.contactFormUrl,
    linkedinUrl: incoming.linkedinUrl ?? existing.linkedinUrl,
    country: existing.country,
    region: existing.region,
    industry: existing.industry,
    sourceUrl: incoming.sourceUrl ?? existing.sourceUrl,
    evidenceUrl: incoming.evidenceUrl ?? existing.evidenceUrl,
    evidenceSummary: longer(existing.evidenceSummary ?? '', incoming.evidenceSummary ?? '') || undefined,
    owner: existing.owner,
    nextFollowUpAt: existing.nextFollowUpAt,
    followUpNote: existing.followUpNote,
    lastContactedAt: existing.lastContactedAt,
    lastResponseAt: existing.lastResponseAt,
    outcomeStatus: existing.outcomeStatus,
    outcomeReason: existing.outcomeReason,
    outcomeRecordedAt: existing.outcomeRecordedAt,
    feedback: existing.feedback,
    pipelineStatus: preserveStatus ? operationalStatus : incoming.pipelineStatus,
    createdAt: existing.createdAt,
    updatedAt: generatedAt,
    rawPayload: mergeObjects(asObject(existing.rawPayload), asObject(incoming.rawPayload)),
  };
}

function buildSourceIndex(records: StoredLeadRecord[]): Map<string, StoredLeadRecord> {
  const index = new Map<string, StoredLeadRecord>();
  for (const record of records) {
    if (record.lead.sourceUrl) index.set(normalizedSourceKey(record.lead.sourceUrl), record);
    if (record.lead.evidenceUrl) index.set(normalizedSourceKey(record.lead.evidenceUrl), record);
  }
  return index;
}

function normalizedSourceKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || ['trk', 'rcm'].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, '').toLowerCase();
  }
}

function serviceCategoryFor(route: string, lanes: string[]): ServiceCategory {
  const available = new Set([route, ...lanes]);
  if (available.has('cybersecurity')) return 'cybersecurity_compliance';
  if (available.has('creative_animation') || available.has('immersive_game')) return 'ar_3d_unity_unreal';
  if (available.has('digital_growth')) return 'website_portal';
  if (available.has('ai_automation')) return 'ai_automation';
  if (available.has('software_product')) return 'fullstack_web_app';
  if (available.has('delivery_partner')) return 'enterprise_systems';
  return 'unknown';
}

function servicePresentation(category: ServiceCategory, partner: boolean): { offer: string; materials: string } {
  if (partner) return {
    offer: 'Managed delivery partnership / white-label or overflow team',
    materials: 'Codistan company profile, delivery model, NDA readiness, team structure and the closest approved service proof.',
  };
  const values: Partial<Record<ServiceCategory, { offer: string; materials: string }>> = {
    ai_automation: {
      offer: 'AI automation, agents, RAG and workflow implementation',
      materials: 'Approved AI automation case study, architecture approach and a focused pilot plan.',
    },
    fullstack_web_app: {
      offer: 'Managed full-stack software, SaaS and product delivery',
      materials: 'Relevant software case studies, delivery pod structure and phased implementation approach.',
    },
    cybersecurity_compliance: {
      offer: 'Cybersecurity assessment, VAPT, cloud/IAM and compliance delivery',
      materials: 'Relevant security credentials, sanitized evidence, delivery methodology and scope checklist.',
    },
    website_portal: {
      offer: 'Website, digital marketing, SEO and growth management',
      materials: 'Relevant digital-growth portfolio, audit sample, proposed channel plan and measurable first-month priorities.',
    },
    ar_3d_unity_unreal: {
      offer: 'Video, animation, 3D, AR/VR and real-time creative production',
      materials: 'Relevant showreel, visual case studies, production workflow and realistic schedule.',
    },
    enterprise_systems: {
      offer: 'Managed enterprise implementation and delivery partnership',
      materials: 'Company profile, enterprise delivery proof, team structure and governance model.',
    },
  };
  return values[category] ?? {
    offer: 'Human review required to confirm the exact Codistan service route',
    materials: 'Only share proof after the service requirement and buyer authority are verified.',
  };
}

function reachMethod(routes: string[], email: string | undefined, source: AcquisitionSource): string {
  if (email) return 'Public business email — send manually after human approval';
  if (routes.includes('proposal')) return source === 'upwork' ? 'Manual Upwork proposal' : 'Manual proposal response from the original LinkedIn post';
  if (routes.includes('direct_message')) return 'Manual LinkedIn DM after verifying the original author';
  if (routes.includes('comment')) return 'Review the post and use a public comment only if strategically appropriate';
  return source === 'upwork' ? 'Open the original Upwork job and bid manually' : 'Verify the buyer and choose a manual LinkedIn or business-email route';
}

function commercialValueSignal(commercial: Record<string, unknown>): string | undefined {
  if (commercial.fixed_budget_usd !== undefined) return `Fixed budget: $${commercial.fixed_budget_usd}`;
  if (commercial.hourly_min_usd !== undefined || commercial.hourly_max_usd !== undefined) {
    return `Hourly range: $${commercial.hourly_min_usd ?? '?'}–$${commercial.hourly_max_usd ?? '?'}`;
  }
  return undefined;
}

function companyFromHeadline(value: string): string {
  const match = /(?:\bat\b|@)\s+([^|·]+)$/i.exec(value);
  return clean(match?.[1], 300);
}

function roleFromHeadline(value: string): string {
  if (!value) return '';
  return clean(value.split(/\s+(?:at|@)\s+/i)[0]?.split(/[|·]/)[0], 300);
}

function extractPublicEmail(value: string): string | undefined {
  const match = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.exec(value);
  return match?.[0]?.toLowerCase();
}

function postedAtFromAge(value: string | undefined, capturedAt: string): string | undefined {
  const text = String(value ?? '').trim().toLowerCase();
  const match = /^(\d+)\s*(m|h|d|w|mo|yr|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)s?\b/.exec(text);
  if (!match) return undefined;
  const count = Number(match[1]);
  if (!Number.isFinite(count)) return undefined;
  const unit = match[2];
  const milliseconds = unit.startsWith('m') && unit !== 'mo' && !unit.startsWith('month')
    ? count * 60_000
    : unit.startsWith('h')
      ? count * 3_600_000
      : unit.startsWith('d')
        ? count * 86_400_000
        : unit.startsWith('w')
          ? count * 7 * 86_400_000
          : unit === 'mo' || unit.startsWith('month')
            ? count * 30 * 86_400_000
            : count * 365 * 86_400_000;
  const base = Date.parse(capturedAt);
  return Number.isFinite(base) ? new Date(base - milliseconds).toISOString() : undefined;
}

function normalizeConfidence(value: unknown): ProspectConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function clampScore(value: unknown): number {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50;
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function normalizePublicUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || ['trk', 'rcm'].includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.toString().replace(/\/$/, '');
}

function normalizeOptionalLinkedInUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())) return undefined;
    return `https://www.linkedin.com${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return undefined;
  }
}

function mergeObjects(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (value === undefined || value === null || value === '') continue;
    const current = merged[key];
    if (isPlainObject(current) && isPlainObject(value)) merged[key] = mergeObjects(current, value);
    else if (Array.isArray(current) && Array.isArray(value)) merged[key] = [...new Set([...current, ...value].map((item) => JSON.stringify(item)))].map((item) => JSON.parse(item));
    else if (typeof current === 'string' && typeof value === 'string') merged[key] = longer(current, value);
    else merged[key] = value;
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function clean(value: unknown, limit: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function longer(left: string, right: string): string {
  return right.length > left.length ? right : left;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
