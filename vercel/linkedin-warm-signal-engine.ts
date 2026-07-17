import type { NeonAppState } from '@sales-automation/neon-state';
import type {
  LinkedInWarmSignalInput,
  LinkedInWarmSignalIngestionResult,
} from '@sales-automation/prospect-discovery';

interface GuidanceAuditResult {
  audited: number;
  skipped: number;
  priority: number;
  qualified: number;
  humanReview: number;
  nurture: number;
  rejected: number;
  leadIds: string[];
}

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
  guidance: GuidanceAuditResult;
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
  const [evaluator, fixtures, discovery, web] = await Promise.all([
    import('@sales-automation/evaluator'),
    import('@sales-automation/fixtures'),
    import('@sales-automation/prospect-discovery'),
    import('@sales-automation/web'),
  ]);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const ingestion = discovery.ingestLinkedInWarmSignals({
    repository: input.state.repository,
    portfolioItems: fixtures.samplePortfolioItems,
    signals: input.signals,
    actor: input.actor,
    generatedAt,
  });
  const workload = discovery.buildOwnerWorkload(input.state.repository.listLeads().map((record) => record.lead));
  let assigned = 0;

  for (const captured of ingestion.captured) {
    const record = input.state.repository.getLead(captured.leadId);
    if (!record) continue;
    const applied = discovery.applyAutomaticAssignment(record.lead, workload, generatedAt);
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
  const guidance: GuidanceAuditResult = contactReadyCandidates.length > 0
    ? web.auditMissingFirstOutreachGuidance({
      repository: input.state.repository,
      portfolioItems: fixtures.samplePortfolioItems,
      actor: input.actor,
      generatedAt,
      leadIds: contactReadyCandidates,
    })
    : emptyGuidance();

  const contactEnrichment = input.enrichContacts === false || ingestion.captured.length === 0
    ? emptyEnrichment()
    : await discovery.enrichRepositoryContacts({
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
    input.state.repository.saveEvaluation(evaluator.evaluateLead({
      lead: record.lead,
      portfolioItems: fixtures.samplePortfolioItems,
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

function emptyGuidance(): GuidanceAuditResult {
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
