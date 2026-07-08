import { evaluateLead, type LeadEvaluation } from '@sales-automation/evaluator';
import {
  parseLinkedInSignal,
  type ParseLinkedInSignalInput,
  parseUpworkEmail,
  type ParseUpworkEmailInput,
} from '@sales-automation/parsers';
import type { Lead, PortfolioItem } from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';

export type IngestionSourceKind = 'upwork_email' | 'linkedin_signal' | 'manual_leads';

export interface IngestLeadsInput {
  sourceKind: IngestionSourceKind;
  leads: Lead[];
  repository: LeadRepository;
  portfolioItems: PortfolioItem[];
  actor?: string;
  generatedAt?: string;
  includePrivatePortfolio?: boolean;
}

export interface IngestUpworkEmailInput extends Omit<IngestLeadsInput, 'sourceKind' | 'leads'> {
  email: ParseUpworkEmailInput;
}

export interface IngestLinkedInSignalInput extends Omit<IngestLeadsInput, 'sourceKind' | 'leads'> {
  signal: ParseLinkedInSignalInput;
}

export interface IngestedLeadResult {
  leadId: string;
  sourceUrl?: string;
  evaluation: LeadEvaluation;
  record: StoredLeadRecord;
  alertEligible: boolean;
  dedupeKey: string;
}

export interface SkippedDuplicateLead {
  leadId: string;
  sourceUrl?: string;
  dedupeKey: string;
  existingLeadId: string;
  reason: 'duplicate_source_url' | 'duplicate_lead_id';
}

export interface IngestionResult {
  sourceKind: IngestionSourceKind;
  captured: IngestedLeadResult[];
  skippedDuplicates: SkippedDuplicateLead[];
  totalInput: number;
  totalCaptured: number;
  totalSkipped: number;
}

export function ingestLeads(input: IngestLeadsInput): IngestionResult {
  const actor = input.actor ?? `${input.sourceKind}-ingestion`;
  const existingIndex = buildExistingLeadIndex(input.repository.listLeads());
  const captured: IngestedLeadResult[] = [];
  const skippedDuplicates: SkippedDuplicateLead[] = [];

  for (const lead of input.leads) {
    const dedupeKey = getLeadDedupeKey(lead);
    const duplicate = existingIndex.get(dedupeKey);
    if (duplicate) {
      skippedDuplicates.push({
        leadId: lead.id,
        sourceUrl: lead.sourceUrl,
        dedupeKey,
        existingLeadId: duplicate.lead.id,
        reason: lead.sourceUrl ? 'duplicate_source_url' : 'duplicate_lead_id',
      });
      continue;
    }

    const evaluation = evaluateLead({
      lead,
      portfolioItems: input.portfolioItems,
      includePrivatePortfolio: input.includePrivatePortfolio,
      generatedAt: input.generatedAt,
    });
    const record = input.repository.saveEvaluation(evaluation, actor);
    existingIndex.set(dedupeKey, record);
    existingIndex.set(getLeadDedupeKey(record.lead), record);

    captured.push({
      leadId: lead.id,
      sourceUrl: lead.sourceUrl,
      evaluation,
      record,
      alertEligible: evaluation.alertPlan.shouldAlert,
      dedupeKey,
    });
  }

  return {
    sourceKind: input.sourceKind,
    captured,
    skippedDuplicates,
    totalInput: input.leads.length,
    totalCaptured: captured.length,
    totalSkipped: skippedDuplicates.length,
  };
}

export function ingestUpworkEmail(input: IngestUpworkEmailInput): IngestionResult {
  const leads = parseUpworkEmail(input.email);
  return ingestLeads({
    sourceKind: 'upwork_email',
    leads,
    repository: input.repository,
    portfolioItems: input.portfolioItems,
    actor: input.actor,
    generatedAt: input.generatedAt,
    includePrivatePortfolio: input.includePrivatePortfolio,
  });
}

export function ingestLinkedInSignal(input: IngestLinkedInSignalInput): IngestionResult {
  const lead = parseLinkedInSignal(input.signal);
  return ingestLeads({
    sourceKind: 'linkedin_signal',
    leads: [lead],
    repository: input.repository,
    portfolioItems: input.portfolioItems,
    actor: input.actor,
    generatedAt: input.generatedAt,
    includePrivatePortfolio: input.includePrivatePortfolio,
  });
}

export function getLeadDedupeKey(lead: Lead): string {
  if (lead.sourceUrl) return `source_url:${normalizeUrl(lead.sourceUrl)}`;
  return `lead_id:${lead.id}`;
}

function buildExistingLeadIndex(records: StoredLeadRecord[]): Map<string, StoredLeadRecord> {
  const index = new Map<string, StoredLeadRecord>();
  for (const record of records) {
    index.set(`lead_id:${record.lead.id}`, record);
    if (record.lead.sourceUrl) {
      index.set(`source_url:${normalizeUrl(record.lead.sourceUrl)}`, record);
    }
  }
  return index;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, '').toLowerCase();
}
