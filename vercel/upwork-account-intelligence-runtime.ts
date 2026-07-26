import { evaluateLead, type EvaluatedLead } from '@sales-automation/evaluator';
import { attachEnrichmentSnapshot, buildEvidenceBasedEnrichment } from '@sales-automation/enrichment';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { attachIdentityResolution, resolveLeadIdentity } from '@sales-automation/identity-graph';
import { loadNeonAppState, persistLeadRecords } from '@sales-automation/neon-state';
import { applyAutomaticAssignment, buildOwnerWorkload } from '@sales-automation/prospect-discovery';
import type { Lead, PipelineStatus } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';
import {
  attachUpworkAccountIntelligence,
  deriveUpworkAccountIntelligence,
  type UpworkAccountIntelligenceResult,
} from '@sales-automation/upwork-account-intelligence';
import { applyFirstOutreachGuidance } from '@sales-automation/web';

const ACTOR = 'upwork-account-intelligence@codistan.local';
const MAX_PROCESSED_IDS = 50;
const PRE_CONTACT_STATUSES = new Set<PipelineStatus>([
  'new',
  'scored',
  'needs_research',
  'needs_human_review',
  'approved_to_contact',
  'draft_ready',
]);

interface IntakeResponseBody {
  source?: unknown;
  processedLeadIds?: unknown;
  [key: string]: unknown;
}

export async function applyUpworkAccountIntelligenceAfterIntake(input: {
  response: Response;
  databaseUrl: string;
}): Promise<Response> {
  if (!input.response.ok) return input.response;
  const parsed = await parseResponse(input.response);
  if (!parsed) return input.response;
  if (String(parsed.body.source ?? '') !== 'upwork') {
    return responseJson({
      ...parsed.body,
      upworkAccountIntelligence: {
        status: 'not_applicable',
        processed: 0,
        reason: 'This ingestion batch is not from Upwork.',
      },
    }, input.response.status, parsed.headers);
  }

  const processedLeadIds = normalizeIds(parsed.body.processedLeadIds).slice(0, MAX_PROCESSED_IDS);
  if (processedLeadIds.length === 0) return input.response;

  try {
    const state = await loadNeonAppState(input.databaseUrl);
    const generatedAt = new Date().toISOString();
    const allLeads = state.repository.listLeads().map((record) => record.lead);
    const touchedIds: string[] = [];
    const accountLeadIds: string[] = [];
    const statuses: Record<string, number> = {eligible: 0, research: 0, job_only: 0, suppressed: 0};
    const summaries: Array<{jobLeadId: string; status: string; accountLeadId?: string}> = [];

    for (const leadId of processedLeadIds) {
      const jobRecord = state.repository.getLead(leadId);
      if (!jobRecord || jobRecord.lead.source !== 'upwork' || jobRecord.lead.leadType !== 'upwork_job') continue;

      const intelligence = deriveUpworkAccountIntelligence(jobRecord.lead, allLeads, generatedAt);
      statuses[intelligence.status] = (statuses[intelligence.status] ?? 0) + 1;
      summaries.push({jobLeadId: leadId, status: intelligence.status, accountLeadId: intelligence.accountLeadId});

      const attachedJob = attachUpworkAccountIntelligence(jobRecord.lead, intelligence);
      if (stableJobAccountState(jobRecord.lead) !== stableJobAccountState(attachedJob)) {
        state.repository.upsertLead(attachedJob, ACTOR);
        addNoteOnce(
          state.repository.getLead(leadId)!,
          `upwork_account_intelligence::${intelligence.status}::${intelligence.accountLeadId ?? 'job_only'}`,
          () => state.repository.addNote(leadId, `upwork_account_intelligence::${intelligence.status}::${intelligence.accountLeadId ?? 'job_only'}`, ACTOR),
        );
        touchedIds.push(leadId);
      }

      if (!intelligence.accountLead) continue;
      const existingAccount = state.repository.getLead(intelligence.accountLead.id);
      const preparedAccount = prepareAccountLead(
        mergePreservingBdHistory(existingAccount?.lead, intelligence.accountLead),
        state.repository.listLeads().map((record) => record.lead),
        generatedAt,
      );
      const previousState = existingAccount ? stableAccountState(existingAccount.lead) : '';
      const nextState = stableAccountState(preparedAccount);

      if (!existingAccount || previousState !== nextState) {
        let evaluated = enrichEvaluation(evaluateLead({
          lead: preparedAccount,
          portfolioItems: samplePortfolioItems,
          generatedAt,
        }));
        state.repository.saveEvaluation(evaluated, ACTOR);

        if (!evaluated.lead.owner) {
          const workload = buildOwnerWorkload(state.repository.listLeads().map((record) => record.lead));
          const assigned = applyAutomaticAssignment(evaluated.lead, workload, generatedAt);
          evaluated = enrichEvaluation(evaluateLead({
            lead: assigned.lead,
            portfolioItems: samplePortfolioItems,
            generatedAt,
          }));
          state.repository.saveEvaluation(evaluated, ACTOR);
          addNoteOnce(
            state.repository.getLead(evaluated.lead.id)!,
            `routing::automatic::${assigned.assignment.owner}`,
            () => state.repository.addNote(
              evaluated.lead.id,
              `routing::automatic::${assigned.assignment.owner}::${assigned.approach.channel}::${assigned.assignment.reason} | ${assigned.approach.nextAction}`,
              ACTOR,
            ),
          );
        }

        const currentAccount = state.repository.getLead(preparedAccount.id)!;
        if (PRE_CONTACT_STATUSES.has(currentAccount.lead.pipelineStatus)) {
          applyFirstOutreachGuidance({
            repository: state.repository,
            record: currentAccount,
            portfolioItems: samplePortfolioItems,
            actor: ACTOR,
            generatedAt,
          });
        }

        addLinkedAccountNotes(state.repository.getLead(leadId), state.repository.getLead(preparedAccount.id), intelligence);
        touchedIds.push(preparedAccount.id, leadId);
      }

      accountLeadIds.push(preparedAccount.id);
    }

    const touchedRecords = unique(touchedIds)
      .map((leadId) => state.repository.getLead(leadId))
      .filter((record): record is StoredLeadRecord => Boolean(record));
    await persistLeadRecords(input.databaseUrl, touchedRecords);

    return responseJson({
      ...parsed.body,
      upworkAccountIntelligence: {
        status: 'applied',
        processed: summaries.length,
        eligible: statuses.eligible ?? 0,
        research: statuses.research ?? 0,
        jobOnly: statuses.job_only ?? 0,
        suppressed: statuses.suppressed ?? 0,
        accountLeadIds: unique(accountLeadIds),
        summaries,
        sourceVisibleOnly: true,
        platformRestrictionsPreserved: true,
      },
      linkedAccountLeadIds: unique(accountLeadIds),
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  } catch (error) {
    console.error('UPWORK_ACCOUNT_INTELLIGENCE_POST_INTAKE_ERROR', {
      message: safeErrorMessage(error),
      processedLeadCount: processedLeadIds.length,
    });
    return responseJson({
      ...parsed.body,
      upworkAccountIntelligence: {
        status: 'deferred',
        processed: 0,
        reason: 'The Upwork jobs were ingested successfully, but account intelligence was deferred for a later retry.',
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  }
}

function prepareAccountLead(accountLead: Lead, existingLeads: Lead[], generatedAt: string): Lead {
  const resolution = resolveLeadIdentity(accountLead, existingLeads, generatedAt);
  const withIdentity = attachIdentityResolution(accountLead, resolution);
  const snapshot = buildEvidenceBasedEnrichment(withIdentity, undefined, generatedAt);
  return attachEnrichmentSnapshot(withIdentity, snapshot);
}

function mergePreservingBdHistory(existing: Lead | undefined, incoming: Lead): Lead {
  if (!existing) return incoming;
  const progressed = !PRE_CONTACT_STATUSES.has(existing.pipelineStatus);
  return {
    ...existing,
    ...incoming,
    owner: existing.owner ?? incoming.owner,
    pipelineStatus: progressed ? existing.pipelineStatus : incoming.pipelineStatus,
    nextFollowUpAt: existing.nextFollowUpAt,
    followUpNote: existing.followUpNote,
    lastContactedAt: existing.lastContactedAt,
    lastResponseAt: existing.lastResponseAt,
    outcomeStatus: existing.outcomeStatus,
    outcomeReason: existing.outcomeReason,
    outcomeRecordedAt: existing.outcomeRecordedAt,
    feedback: existing.feedback,
    createdAt: existing.createdAt,
    updatedAt: incoming.updatedAt,
  };
}

function addLinkedAccountNotes(
  jobRecord: StoredLeadRecord | undefined,
  accountRecord: StoredLeadRecord | undefined,
  intelligence: UpworkAccountIntelligenceResult,
): void {
  if (!jobRecord || !accountRecord) return;
  const jobNote = `linked_upwork_account::${accountRecord.lead.id}::${intelligence.status}`;
  addNoteOnce(jobRecord, jobNote, () => jobRecord.notes.push(jobNote));
  const accountNote = `linked_upwork_job::${jobRecord.lead.id}::${jobRecord.lead.sourceUrl ?? ''}`;
  addNoteOnce(accountRecord, accountNote, () => accountRecord.notes.push(accountNote));
}

function addNoteOnce(record: StoredLeadRecord, prefix: string, add: () => void): void {
  if (record.notes.some((note) => note.startsWith(prefix))) return;
  add();
}

function stableJobAccountState(lead: Lead): string {
  const raw = asRecord(lead.rawPayload);
  return JSON.stringify({
    version: raw.upworkAccountIntelligenceVersion ?? null,
    intelligence: raw.upworkAccountIntelligence ?? null,
    accountLeadId: raw.linkedAccountLeadId ?? null,
  });
}

function stableAccountState(lead: Lead): string {
  const raw = asRecord(lead.rawPayload);
  return JSON.stringify({
    companyName: lead.companyName ?? null,
    companyWebsite: lead.companyWebsite ?? null,
    contactName: lead.contactName ?? null,
    contactRole: lead.contactRole ?? null,
    contactEmail: lead.contactEmail ?? null,
    linkedinUrl: lead.linkedinUrl ?? null,
    serviceCategory: lead.serviceCategory,
    serviceOffer: lead.serviceOffer ?? null,
    description: lead.description,
    recommendedNextAction: lead.recommendedNextAction ?? null,
    accountIdentityKey: raw.accountIdentityKey ?? null,
    linkedJobs: raw.linkedUpworkJobIds ?? [],
    campaignMatches: raw.campaignMatches ?? [],
    enrichment: raw.enrichment ?? null,
    identityGraph: raw.identityGraph ?? null,
  });
}

function enrichEvaluation(evaluation: EvaluatedLead): EvaluatedLead {
  return {
    ...evaluation,
    lead: {
      ...evaluation.lead,
      recommendedProfile: evaluation.profileRecommendation.primaryProfile,
      recommendedPortfolioItemIds: evaluation.portfolioRecommendation.selectedItems.map((item) => item.id),
      recommendedNextAction: evaluation.approachRecommendation.nextAction,
      draftMessage: evaluation.approachRecommendation.messageDraft,
    },
  };
}

async function parseResponse(response: Response): Promise<{body: IntakeResponseBody; headers: Record<string, string>} | undefined> {
  try {
    const body = await response.clone().json() as IntakeResponseBody;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-length') headers[key] = value;
    });
    return {body, headers};
  } catch {
    return undefined;
  }
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.map(String).map((item) => item.trim()).filter(Boolean));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]').slice(0, 500);
}

function responseJson(value: unknown, status: number, existingHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...existingHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
