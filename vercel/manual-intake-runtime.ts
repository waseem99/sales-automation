import { samplePortfolioItems } from '@sales-automation/fixtures';
import {
  ingestLinkedInSignal,
  ingestManualOpportunity,
  ingestSourceBatch,
  ingestUpworkEmail,
  type IngestionResult,
} from '@sales-automation/ingestion';
import { persistLeadRecords, type NeonAppState } from '@sales-automation/neon-state';
import {
  applyAutomaticAssignment,
  buildOwnerWorkload,
} from '@sales-automation/prospect-discovery';
import type { ManualOpportunityKind } from '@sales-automation/parsers';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { auditMissingFirstOutreachGuidance } from '@sales-automation/web';

export interface ManualIntakeRuntimeInput {
  body: unknown;
  databaseUrl: string;
  actor: string;
  state: NeonAppState;
}

type IntakeMode =
  | 'auto_batch'
  | 'upwork_email'
  | 'linkedin_signal'
  | ManualOpportunityKind;

export async function handleManualIntakeRuntime(input: ManualIntakeRuntimeInput): Promise<Response> {
  try {
    const payload = asObject(input.body);
    const mode = requireIntakeMode(payload.sourceKind);
    const content = requiredString(payload.content, 'content');
    const generatedAt = new Date().toISOString();
    const result = ingestForMode(mode, content, payload, generatedAt, input);
    const capturedIds = result.captured.map((item) => item.leadId);

    const workload = buildOwnerWorkload(input.state.repository.listLeads().map((record) => record.lead));
    for (const captured of result.captured) {
      const current = input.state.repository.getLead(captured.leadId);
      if (!current) continue;
      const applied = applyAutomaticAssignment(current.lead, workload, generatedAt);
      input.state.repository.saveEvaluation({ ...captured.evaluation, lead: applied.lead }, input.actor);
      input.state.repository.addNote(
        captured.leadId,
        `routing::automatic::${applied.assignment.owner}::${applied.approach.channel}::${applied.assignment.reason} | ${applied.approach.nextAction}`,
        input.actor,
      );
    }

    const guidance = capturedIds.length > 0
      ? auditMissingFirstOutreachGuidance({
        repository: input.state.repository,
        portfolioItems: samplePortfolioItems,
        actor: input.actor,
        generatedAt,
        leadIds: capturedIds,
      })
      : { audited: 0, skipped: 0, priority: 0, qualified: 0, humanReview: 0, nurture: 0, rejected: 0, leadIds: [] };

    const changed = capturedIds
      .map((leadId) => input.state.repository.getLead(leadId))
      .filter((record): record is StoredLeadRecord => Boolean(record));
    await persistLeadRecords(input.databaseUrl, changed);

    return responseJson({
      ok: true,
      mode,
      totalInput: result.totalInput,
      created: result.totalCaptured,
      duplicates: result.totalSkipped,
      createdLeadIds: capturedIds,
      duplicateLeadIds: result.skippedDuplicates.map((item) => item.existingLeadId),
      guidance,
      humanReviewRequired: true,
      externalActionAutomated: false,
      prospectUrl: capturedIds[0] ? `/prospects?leadId=${encodeURIComponent(capturedIds[0])}` : undefined,
    }, result.totalCaptured > 0 ? 201 : 200);
  } catch (error) {
    return responseJson({
      error: error instanceof Error ? error.message : String(error),
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, 400);
  }
}

function ingestForMode(
  mode: IntakeMode,
  content: string,
  payload: Record<string, unknown>,
  generatedAt: string,
  input: ManualIntakeRuntimeInput,
): IngestionResult {
  const common = {
    repository: input.state.repository,
    portfolioItems: samplePortfolioItems,
    generatedAt,
    actor: input.actor,
  };

  if (mode === 'auto_batch') {
    return ingestSourceBatch({
      ...common,
      batchText: content,
      capturedAt: generatedAt,
    });
  }

  if (mode === 'upwork_email') {
    return ingestUpworkEmail({
      ...common,
      email: { emailBody: content, receivedAt: generatedAt },
    });
  }

  if (mode === 'linkedin_signal') {
    return ingestLinkedInSignal({
      ...common,
      signal: {
        text: content,
        capturedAt: generatedAt,
        sourceUrl: optionalString(payload.sourceUrl),
        companyName: optionalString(payload.companyName),
        contactName: optionalString(payload.contactName),
        contactRole: optionalString(payload.contactRole),
        country: optionalString(payload.country),
        region: optionalString(payload.region),
      },
    });
  }

  return ingestManualOpportunity({
    ...common,
    opportunity: {
      kind: mode,
      content,
      capturedAt: generatedAt,
      sourceUrl: optionalString(payload.sourceUrl),
      title: optionalString(payload.title),
      companyName: optionalString(payload.companyName),
      contactName: optionalString(payload.contactName),
      contactRole: optionalString(payload.contactRole),
      country: optionalString(payload.country),
      region: optionalString(payload.region),
    },
  });
}

function requireIntakeMode(value: unknown): IntakeMode {
  const mode = requiredString(value, 'sourceKind') as IntakeMode;
  const allowed: IntakeMode[] = [
    'auto_batch',
    'upwork_email',
    'linkedin_signal',
    'copied_alert',
    'public_url',
    'public_post',
    'sales_navigator_alert',
    'referral_note',
  ];
  if (!allowed.includes(mode)) throw new Error('sourceKind is invalid.');
  return mode;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
