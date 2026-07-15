import { evaluateLead } from '@sales-automation/evaluator';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { ingestLeads } from '@sales-automation/ingestion';
import type { NeonAppState } from '@sales-automation/neon-state';
import { parseUpworkEmail } from '@sales-automation/parsers';
import {
  applyAutomaticAssignment,
  applyUpworkSavedSearchDecision,
  buildOwnerWorkload,
  enrichRepositoryContacts,
  evaluateUpworkSavedSearchLead,
  type UpworkSavedSearchDecision,
} from '@sales-automation/prospect-discovery';
import type { Lead } from '@sales-automation/shared';
import { auditMissingFirstOutreachGuidance } from '@sales-automation/web';

export interface UpworkSavedSearchEmailInput {
  messageId: string;
  subject?: string;
  text: string;
  receivedAt: string;
  sourceUrl?: string;
}

export interface RejectedUpworkSavedSearchLead {
  title: string;
  sourceUrl?: string;
  score: number;
  reasonCodes: string[];
}

export interface ProcessUpworkSavedSearchBatchResult {
  totalEmails: number;
  totalParsed: number;
  created: number;
  duplicates: number;
  rejected: number;
  research: number;
  priorityA: number;
  priorityB: number;
  rejectedLeads: RejectedUpworkSavedSearchLead[];
  rejectionReasonCounts: Record<string, number>;
  createdLeadIds: string[];
  priorityALeadIds: string[];
  priorityBLeadIds: string[];
  researchLeadIds: string[];
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
  humanReviewRequired: true;
  externalApplicationAutomated: false;
}

export async function processUpworkSavedSearchBatch(input: {
  state: NeonAppState;
  emails: UpworkSavedSearchEmailInput[];
  actor: string;
  generatedAt?: string;
  fetchImpl?: typeof fetch;
  enrichContacts?: boolean;
  minimumFixedBudgetUsd?: number;
  minimumHourlyRateUsd?: number;
  maximumAgeHours?: number;
}): Promise<ProcessUpworkSavedSearchBatchResult> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const decisions = new Map<string, UpworkSavedSearchDecision>();
  const accepted: Lead[] = [];
  const rejectedLeads: RejectedUpworkSavedSearchLead[] = [];
  let totalParsed = 0;

  for (const email of input.emails) {
    const parsed = parseUpworkEmail({
      emailBody: `${email.subject ?? ''}\n${email.text}`,
      receivedAt: email.receivedAt,
    });
    totalParsed += parsed.length;
    for (const lead of parsed) {
      const withEvidence = lead.sourceUrl || !email.sourceUrl ? lead : { ...lead, sourceUrl: email.sourceUrl, evidenceUrl: email.sourceUrl };
      const decision = evaluateUpworkSavedSearchLead(withEvidence, samplePortfolioItems, {
        minimumFixedBudgetUsd: input.minimumFixedBudgetUsd,
        minimumHourlyRateUsd: input.minimumHourlyRateUsd,
        maximumAgeHours: input.maximumAgeHours,
      });
      if (decision.outcome === 'reject') {
        rejectedLeads.push({
          title: withEvidence.title,
          sourceUrl: withEvidence.sourceUrl,
          score: decision.score,
          reasonCodes: decision.reasonCodes,
        });
        continue;
      }
      const prepared = applyUpworkSavedSearchDecision(withEvidence, decision, generatedAt);
      const raw = prepared.rawPayload && typeof prepared.rawPayload === 'object' && !Array.isArray(prepared.rawPayload)
        ? prepared.rawPayload as Record<string, unknown>
        : {};
      const finalLead: Lead = {
        ...prepared,
        rawPayload: {
          ...raw,
          inboxMessageId: email.messageId,
          inboxReceivedAt: email.receivedAt,
        },
      };
      decisions.set(finalLead.id, decision);
      accepted.push(finalLead);
    }
  }

  const ingestion = ingestLeads({
    sourceKind: 'upwork_email',
    leads: accepted,
    repository: input.state.repository,
    portfolioItems: samplePortfolioItems,
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
    const decision = decisions.get(captured.leadId);
    if (decision) {
      input.state.repository.addNote(
        captured.leadId,
        `upwork-saved-search::${decision.band}::${decision.score}::${decision.reasonCodes.join('|') || 'accepted'}`,
        input.actor,
      );
    }
    assigned += 1;
  }

  const contactReadyLeadIds = ingestion.captured
    .map((item) => item.leadId)
    .filter((leadId) => decisions.get(leadId)?.outcome === 'keep');
  const guidance = contactReadyLeadIds.length
    ? auditMissingFirstOutreachGuidance({
      repository: input.state.repository,
      portfolioItems: samplePortfolioItems,
      actor: input.actor,
      generatedAt,
      leadIds: contactReadyLeadIds,
    })
    : emptyGuidance();

  const enrichableLeadIds = ingestion.captured
    .map((item) => input.state.repository.getLead(item.leadId))
    .filter((record): record is NonNullable<typeof record> => Boolean(record?.lead.companyWebsite))
    .map((record) => record.lead.id);
  const contactEnrichment = input.enrichContacts === false || !enrichableLeadIds.length
    ? emptyEnrichment()
    : await enrichRepositoryContacts({
      repository: input.state.repository,
      fetchImpl: input.fetchImpl ?? globalThis.fetch,
      maxRecords: Math.min(50, enrichableLeadIds.length),
      leadIds: enrichableLeadIds,
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

  const createdLeadIds = ingestion.captured.map((item) => item.leadId);
  const priorityALeadIds = createdLeadIds.filter((leadId) => decisions.get(leadId)?.band === 'priority_a');
  const priorityBLeadIds = createdLeadIds.filter((leadId) => decisions.get(leadId)?.band === 'priority_b');
  const researchLeadIds = createdLeadIds.filter((leadId) => decisions.get(leadId)?.band === 'research');
  return {
    totalEmails: input.emails.length,
    totalParsed,
    created: ingestion.totalCaptured,
    duplicates: ingestion.totalSkipped,
    rejected: rejectedLeads.length,
    research: researchLeadIds.length,
    priorityA: priorityALeadIds.length,
    priorityB: priorityBLeadIds.length,
    rejectedLeads,
    rejectionReasonCounts: countReasons(rejectedLeads.flatMap((item) => item.reasonCodes)),
    createdLeadIds,
    priorityALeadIds,
    priorityBLeadIds,
    researchLeadIds,
    assigned,
    guidance,
    contactEnrichment,
    rescored,
    humanReviewRequired: true,
    externalApplicationAutomated: false,
  };
}

function countReasons(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
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
