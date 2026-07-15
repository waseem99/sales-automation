import { evaluateLead } from '@sales-automation/evaluator';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import type { NeonAppState } from '@sales-automation/neon-state';
import {
  applyAutomaticAssignment,
  buildOwnerWorkload,
  enrichRepositoryContacts,
  ingestLinkedInWarmSignals,
  type LinkedInWarmSignalInput,
  type LinkedInWarmSignalIngestionResult,
} from '@sales-automation/prospect-discovery';
import { auditMissingFirstOutreachGuidance } from '@sales-automation/web';

export interface ProcessLinkedInWarmSignalBatchInput {
  state: NeonAppState;
  signals: LinkedInWarmSignalInput[];
  actor: string;
  generatedAt?: string;
  fetchImpl?: typeof fetch;
  enrichContacts?: boolean;
}

export interface ProcessLinkedInWarmSignalBatchResult {
  ingestion: LinkedInWarmSignalIngestionResult;
  assigned: number;
  guidance: ReturnType<typeof auditMissingFirstOutreachGuidance>;
  contactEnrichment: {
    checked: number;
    updated: number;
    ready: number;
    partial: number;
    researchRequired: number;
    errors: Array<{ leadId: string; message: string }>;
  };
  rescored: number;
  priorityALeadIds: string[];
  priorityBLeadIds: string[];
  researchLeadIds: string[];
  humanReviewRequired: true;
  externalActionAutomated: false;
}

export async function processLinkedInWarmSignalBatch(
  input: ProcessLinkedInWarmSignalBatchInput,
): Promise<ProcessLinkedInWarmSignalBatchResult> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const ingestion = ingestLinkedInWarmSignals({
    repository: input.state.repository,
    portfolioItems: samplePortfolioItems,
    signals: input.signals,
    actor: input.actor,
    generatedAt,
  });
  const workload = buildOwnerWorkload(input.state.repository.listLeads().map((record) => record.lead));
  let assigned = 0;

  for (const captured of ingestion.captured) {
    const record = input.state.repository.getLead(captured.leadId);
    if (!record) continue;
    const applied = applyAutomaticAssignment(record.lead, workload, generatedAt);
    input.state.repository.saveEvaluation({ ...captured.evaluation, lead: applied.lead }, input.actor);
    input.state.repository.addNote(
      captured.leadId,
      `routing::automatic::${applied.assignment.owner}::${applied.approach.channel}::${applied.assignment.reason} | ${applied.approach.nextAction}`,
      input.actor,
    );
    assigned += 1;
  }

  const contactReadyCandidates = ingestion.captured
    .filter((item) => item.decision.outcome === 'keep')
    .map((item) => item.leadId);
  const guidance = contactReadyCandidates.length > 0
    ? auditMissingFirstOutreachGuidance({
      repository: input.state.repository,
      portfolioItems: samplePortfolioItems,
      actor: input.actor,
      generatedAt,
      leadIds: contactReadyCandidates,
    })
    : emptyGuidance();

  const contactEnrichment = input.enrichContacts === false || ingestion.captured.length === 0
    ? emptyEnrichment()
    : await enrichRepositoryContacts({
      repository: input.state.repository,
      fetchImpl: input.fetchImpl ?? globalThis.fetch,
      maxRecords: Math.min(50, ingestion.captured.length),
      leadIds: ingestion.captured.map((item) => item.leadId),
      actor: input.actor,
      now: () => generatedAt,
    });

  let rescored = 0;
  for (const captured of ingestion.captured) {
    const record = input.state.repository.getLead(captured.leadId);
    if (!record) continue;
    input.state.repository.saveEvaluation(evaluateLead({
      lead: record.lead,
      portfolioItems: samplePortfolioItems,
      generatedAt,
    }), input.actor);
    rescored += 1;
  }

  return {
    ingestion,
    assigned,
    guidance,
    contactEnrichment,
    rescored,
    priorityALeadIds: ingestion.captured.filter((item) => item.decision.band === 'priority_a').map((item) => item.leadId),
    priorityBLeadIds: ingestion.captured.filter((item) => item.decision.band === 'priority_b').map((item) => item.leadId),
    researchLeadIds: ingestion.captured.filter((item) => item.decision.band === 'research').map((item) => item.leadId),
    humanReviewRequired: true,
    externalActionAutomated: false,
  };
}

function emptyEnrichment() {
  return {
    checked: 0,
    updated: 0,
    ready: 0,
    partial: 0,
    researchRequired: 0,
    errors: [] as Array<{ leadId: string; message: string }>,
  };
}

function emptyGuidance(): ReturnType<typeof auditMissingFirstOutreachGuidance> {
  return {
    audited: 0,
    skipped: 0,
    priority: 0,
    qualified: 0,
    humanReview: 0,
    nurture: 0,
    rejected: 0,
    leadIds: [],
  };
}
