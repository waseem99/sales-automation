import { createHash } from 'node:crypto';
import { evaluateLead, type EvaluatedLead } from '@sales-automation/evaluator';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { loadNeonAppState, persistLeadRecords } from '@sales-automation/neon-state';
import { applyAutomaticAssignment, buildOwnerWorkload } from '@sales-automation/prospect-discovery';
import type { Lead, PipelineStatus, ProspectConfidence, ServiceCategory } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { applyFirstOutreachGuidance } from '@sales-automation/web';

export const SALES_NAVIGATOR_SYNC_SCHEMA = 'codistan-acquisition-sync.v1';
const MAX_RECORDS = 50;
const ACTOR = 'acquisition-v5-sales-navigator@codistan.local';
const PRE_CONTACT_STATUSES = new Set<PipelineStatus>([
  'new', 'scored', 'needs_research', 'needs_human_review', 'approved_to_contact', 'draft_ready',
]);

type Disposition = 'priority_a' | 'priority_b' | 'research' | 'reject';

interface SalesNavigatorSyncRecord {
  schema_version?: string;
  parser_version?: string;
  source: 'sales_navigator';
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
  page_url?: string;
  page_identity?: string;
  captured_at?: string;
  commercial_evidence?: Record<string, unknown>;
  raw_evidence?: Record<string, unknown>;
  qualification?: {
    disposition?: Disposition;
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
    campaign_id?: string;
    campaign_name?: string;
    offer_name?: string;
  };
  external_action_performed?: boolean;
  last_enriched_at?: string;
}

interface SalesNavigatorPayload {
  schema_version?: string;
  source?: 'sales_navigator';
  external_action_performed?: boolean;
  records?: SalesNavigatorSyncRecord[];
}

export async function handleSalesNavigatorIntake(input: { body: unknown; databaseUrl: string }): Promise<Response> {
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
        validateRecord(raw);
        if (raw.qualification?.disposition === 'reject') {
          rejected.push({ sourceUrl: raw.canonical_url, reason: 'Local cold-campaign qualification rejected this prospect.' });
          continue;
        }

        const incoming = mapRecord(raw, generatedAt);
        const sourceKey = normalizedSourceKey(incoming.sourceUrl ?? raw.canonical_url);
        const existing = state.repository.getLead(incoming.id) ?? sourceIndex.get(sourceKey);
        const previousSnapshot = existing ? JSON.stringify(existing) : '';
        let lead = existing ? mergeIncomingLead(existing.lead, incoming, generatedAt) : incoming;
        let evaluated = enrichEvaluation(evaluateLead({ lead, portfolioItems: samplePortfolioItems, generatedAt }));
        lead = evaluated.lead;
        state.repository.saveEvaluation(evaluated, ACTOR);

        if (!lead.owner) {
          const workload = buildOwnerWorkload(state.repository.listLeads().map((record) => record.lead));
          const assigned = applyAutomaticAssignment(lead, workload, generatedAt);
          evaluated = enrichEvaluation(evaluateLead({ lead: assigned.lead, portfolioItems: samplePortfolioItems, generatedAt }));
          state.repository.saveEvaluation(evaluated, ACTOR);
          state.repository.addNote(
            evaluated.lead.id,
            `routing::automatic::${assigned.assignment.owner}::${assigned.approach.channel}::${assigned.assignment.reason} | ${assigned.approach.nextAction}`,
            ACTOR,
          );
        }

        let current = state.repository.getLead(lead.id);
        if (!current) throw new Error('Prospect Desk did not retain the Sales Navigator prospect.');
        const campaign = campaignIdentity(raw);
        state.repository.addNote(
          current.lead.id,
          `sales_navigator_campaign::${campaign.id}::${campaign.name}::${raw.qualification?.disposition ?? 'unclassified'}::cold_prospect::${raw.canonical_url}`,
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
      schemaVersion: SALES_NAVIGATOR_SYNC_SCHEMA,
      source: 'sales_navigator',
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
      buyerIntentConfirmed: false,
      prospectUrl: touchedIds[0] ? `/leads/sales-navigator?leadId=${encodeURIComponent(touchedIds[0])}` : '/leads/sales-navigator',
    }, createdIds.length > 0 ? 201 : 200);
  } catch (error) {
    return responseJson({
      error: error instanceof Error ? error.message : String(error),
      humanReviewRequired: true,
      externalActionAutomated: false,
      buyerIntentConfirmed: false,
    }, 400);
  }
}

function validatePayload(value: unknown): { records: SalesNavigatorSyncRecord[] } {
  const payload = asObject(value) as Partial<SalesNavigatorPayload>;
  if (payload.schema_version !== SALES_NAVIGATOR_SYNC_SCHEMA) {
    throw new Error(`schema_version must be ${SALES_NAVIGATOR_SYNC_SCHEMA}.`);
  }
  if (payload.external_action_performed !== false) {
    throw new Error('The ingestion endpoint accepts evidence-only records with no external action.');
  }
  if (payload.source !== 'sales_navigator') throw new Error('source must be sales_navigator.');
  if (!Array.isArray(payload.records) || payload.records.length === 0) throw new Error('records must contain at least one item.');
  if (payload.records.length > MAX_RECORDS) throw new Error(`A maximum of ${MAX_RECORDS} records may be ingested per request.`);
  return { records: payload.records as SalesNavigatorSyncRecord[] };
}

function validateRecord(record: SalesNavigatorSyncRecord): void {
  if (!record || typeof record !== 'object') throw new Error('Each record must be an object.');
  if (record.external_action_performed === true) throw new Error('Records that performed an external action are not accepted.');
  if (record.source !== 'sales_navigator') throw new Error('Record source must be sales_navigator.');
  if (!record.dedupe_key?.trim()) throw new Error('dedupe_key is required.');
  if (!record.title?.trim()) throw new Error('title is required.');
  if (!record.body?.trim() || record.body.trim().length < 20) throw new Error('body must contain visible prospect evidence.');
  const sourceUrl = new URL(record.canonical_url);
  const host = sourceUrl.hostname.toLowerCase();
  if (sourceUrl.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com', 'sales.linkedin.com'].includes(host)) {
    throw new Error('Sales Navigator records require an approved LinkedIn HTTPS canonical_url.');
  }
  if (!sourceUrl.pathname.startsWith('/sales/lead/') && !sourceUrl.pathname.startsWith('/in/')) {
    throw new Error('Sales Navigator records require a canonical person profile or lead URL.');
  }
  const campaign = campaignIdentity(record);
  if (!campaign.id || !campaign.name || !campaign.offerName) throw new Error('Campaign ID, name and offer are required.');
}

function mapRecord(record: SalesNavigatorSyncRecord, generatedAt: string): Lead {
  const qualification = record.qualification ?? {};
  const commercial = asObject(record.commercial_evidence);
  const raw = asObject(record.raw_evidence);
  const campaign = campaignIdentity(record);
  const route = String(qualification.service_route ?? commercial.service_route ?? '').trim();
  const lanes = arrayOfStrings(qualification.service_lanes ?? commercial.service_lanes);
  const serviceCategory = serviceCategoryFor(route, lanes);
  const disposition = qualification.disposition ?? 'research';
  const totalScore = clampScore(qualification.total_score);
  const capturedAt = validIso(record.captured_at) ?? generatedAt;
  const sourceUrl = normalizePublicUrl(record.canonical_url);
  const headline = clean(record.author_headline, 500);
  const companyName = clean(record.company_name, 300) || companyFromHeadline(headline);
  const positiveReasons = arrayOfStrings(qualification.positive_reasons);
  const missingEvidence = arrayOfStrings(qualification.missing_evidence);
  const riskReasons = unique([
    ...arrayOfStrings(qualification.risk_reasons),
    'Cold prospect discovered through campaign criteria; no explicit buying intent is confirmed.',
  ]);
  const service = servicePresentation(serviceCategory, lanes.includes('delivery_partner'), campaign.offerName, clean(commercial.offer_summary, 3_000));
  const location = clean(raw.location, 300);
  const industry = clean(raw.industry, 300);
  const relationship = clean(raw.relationship, 100);
  const evidenceSummary = [
    `Cold campaign: ${campaign.name}`,
    positiveReasons.slice(0, 3).join('; '),
    companyName ? `Company: ${companyName}` : '',
    headline ? `Role: ${headline}` : '',
    relationship ? `Relationship: ${relationship}` : '',
  ].filter(Boolean).join(' — ');
  const pipelineStatus: PipelineStatus = disposition === 'research' ? 'needs_research' : 'needs_human_review';
  const id = `acq-salesnav-${record.dedupe_key.replace(/[^a-z0-9]/gi, '').slice(0, 48) || shortHash(sourceUrl)}`;

  return {
    id,
    source: 'sales_navigator',
    sourceUrl,
    leadType: 'sales_navigator_cold_prospect',
    prospectStage: 'cold_prospect',
    title: clean(record.title, 500) || `${clean(record.author_name, 300) || 'Sales Navigator prospect'} — ${campaign.name}`,
    description: clean(record.body, 20_000),
    companyName: companyName || undefined,
    contactName: clean(record.author_name, 300) || undefined,
    contactRole: roleFromHeadline(headline) || undefined,
    linkedinUrl: normalizeOptionalLinkedInUrl(record.author_profile_url) ?? sourceUrl,
    country: location || undefined,
    industry: industry || undefined,
    serviceCategory,
    serviceOffer: service.offer,
    materialsToShare: service.materials,
    reachMethod: 'Manual LinkedIn or business-channel outreach only after human research and approval',
    opportunityStatus: undefined,
    discoverySource: `Sales Navigator cold campaign — ${campaign.name}`,
    evidenceUrl: sourceUrl,
    evidenceSummary,
    discoveredAt: capturedAt,
    rank: Math.max(1, 101 - totalScore),
    confidence: normalizeConfidence(qualification.confidence),
    capturedAt,
    rawPayload: {
      acquisitionSchema: record.schema_version,
      parserVersion: record.parser_version,
      sourceNativeId: record.source_native_id,
      dedupeKey: record.dedupe_key,
      sourceSubtype: record.source_subtype,
      pageUrl: record.page_url,
      pageIdentity: record.page_identity,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        offerName: campaign.offerName,
        offerType: commercial.offer_type,
        offerSummary: commercial.offer_summary,
        targetIndustryTerms: commercial.target_industry_terms,
        targetPersonas: commercial.target_personas,
        targetGeographies: commercial.target_geographies,
      },
      salesNavigatorEvidence: raw,
      commercialEvidence: commercial,
      qualification: {
        ...qualification,
        positive_reasons: positiveReasons,
        missing_evidence: missingEvidence,
        risk_reasons: riskReasons,
        buyer_intent_confirmed: false,
      },
      lastEnrichedAt: record.last_enriched_at,
      externalActionPerformed: false,
    },
    recommendedNextAction: clean(qualification.recommended_next_action, 1_000)
      || `Research the prospect and company, validate the ${campaign.offerName} angle, and prepare human-approved outreach.`,
    pipelineStatus,
    createdAt: capturedAt,
    updatedAt: generatedAt,
  };
}

function enrichEvaluation(evaluation: EvaluatedLead): EvaluatedLead {
  const preferredDraft = evaluation.drafts.find((draft) => draft.type === 'linkedin_dm' || draft.type === 'partner_outreach')
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
  const preserveStatus = !PRE_CONTACT_STATUSES.has(existing.pipelineStatus);
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
    contactEmail: existing.contactEmail,
    contactPhone: existing.contactPhone,
    contactFormUrl: existing.contactFormUrl,
    linkedinUrl: incoming.linkedinUrl ?? existing.linkedinUrl,
    country: incoming.country ?? existing.country,
    region: existing.region,
    industry: incoming.industry ?? existing.industry,
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
    pipelineStatus: preserveStatus ? existing.pipelineStatus : incoming.pipelineStatus,
    createdAt: existing.createdAt,
    updatedAt: generatedAt,
    rawPayload: mergeObjects(asObject(existing.rawPayload), asObject(incoming.rawPayload)),
  };
}

function campaignIdentity(record: SalesNavigatorSyncRecord): { id: string; name: string; offerName: string } {
  const commercial = asObject(record.commercial_evidence);
  const qualification = record.qualification ?? {};
  return {
    id: clean(qualification.campaign_id ?? commercial.campaign_id, 200),
    name: clean(qualification.campaign_name ?? commercial.campaign_name, 500),
    offerName: clean(qualification.offer_name ?? commercial.offer_name, 500),
  };
}

function buildSourceIndex(records: StoredLeadRecord[]): Map<string, StoredLeadRecord> {
  const index = new Map<string, StoredLeadRecord>();
  for (const record of records) {
    if (record.lead.sourceUrl) index.set(normalizedSourceKey(record.lead.sourceUrl), record);
    if (record.lead.linkedinUrl) index.set(normalizedSourceKey(record.lead.linkedinUrl), record);
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

function servicePresentation(category: ServiceCategory, partner: boolean, offerName: string, offerSummary: string): { offer: string; materials: string } {
  const offer = offerName || (partner ? 'Managed delivery partnership' : category === 'ai_automation' ? 'AI automation implementation' : 'Managed product delivery');
  const materials = partner
    ? 'Campaign-specific company profile, delivery model, relevant proof, team structure and a focused discovery hypothesis.'
    : 'Campaign-specific one-pager, relevant approved proof and a concise discovery hypothesis; do not send a generic portfolio.';
  return { offer: offerSummary ? `${offer} — ${offerSummary}`.slice(0, 2_000) : offer, materials };
}

function roleFromHeadline(value: string): string {
  if (!value) return '';
  return clean(value.split(/\s+(?:at|@)\s+/i)[0]?.split(/[|·]/)[0], 300);
}

function companyFromHeadline(value: string): string {
  const match = /(?:\bat\b|@)\s+([^|·]+)$/i.exec(value);
  return clean(match?.[1], 300);
}

function normalizeOptionalLinkedInUrl(value: unknown): string | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!['linkedin.com', 'www.linkedin.com', 'sales.linkedin.com'].includes(url.hostname.toLowerCase())) return undefined;
    url.protocol = 'https:';
    url.hostname = 'www.linkedin.com';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function normalizePublicUrl(value: string): string {
  const url = new URL(value);
  url.protocol = 'https:';
  url.hostname = 'www.linkedin.com';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeConfidence(value: unknown): ProspectConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function clampScore(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function validIso(value: unknown): string | undefined {
  const raw = optionalString(value);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.map((item) => String(item).trim()).filter(Boolean)) : [];
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function clean(value: unknown, limit: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function optionalString(value: unknown): string | undefined {
  const result = String(value ?? '').trim();
  return result || undefined;
}

function longer(left: string, right: string): string {
  return right.length > left.length ? right : left;
}

function mergeObjects(left: Record<string, any>, right: Record<string, any>): Record<string, any> {
  const merged: Record<string, any> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (value === undefined || value === null || value === '') continue;
    const current = merged[key];
    if (current && typeof current === 'object' && !Array.isArray(current) && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = mergeObjects(current, value as Record<string, any>);
    } else if (Array.isArray(current) && Array.isArray(value)) {
      merged[key] = unique([...current, ...value]);
    } else if (current === undefined || current === null || current === '' || (typeof value === 'string' && value.length > String(current).length)) {
      merged[key] = value;
    }
  }
  return merged;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
