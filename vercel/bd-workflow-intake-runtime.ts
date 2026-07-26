import {
  attachBdWorkflow,
  bdWorkflowStateEqual,
  readBdWorkflow,
  refreshBdWorkflow,
} from '@sales-automation/bd-workflow';
import { loadNeonAppState, persistLeadRecords } from '@sales-automation/neon-state';
import type { StoredLeadRecord } from '@sales-automation/storage';

const ACTOR = 'bd-workflow-intake@codistan.local';
const MAX_PROCESSED_IDS = 100;

interface IntakeResponseBody {
  processedLeadIds?: unknown;
  linkedAccountLeadIds?: unknown;
  [key: string]: unknown;
}

export async function applyBdWorkflowAfterIntake(input: {
  response: Response;
  databaseUrl: string;
}): Promise<Response> {
  if (!input.response.ok) return input.response;
  const parsed = await parseResponse(input.response);
  if (!parsed) return input.response;
  const leadIds = unique([
    ...normalizeIds(parsed.body.processedLeadIds),
    ...normalizeIds(parsed.body.linkedAccountLeadIds),
  ]).slice(0, MAX_PROCESSED_IDS);
  if (leadIds.length === 0) {
    return responseJson({
      ...parsed.body,
      bdWorkflow: {status: 'not_applicable', processed: 0, updated: 0},
    }, input.response.status, parsed.headers);
  }

  try {
    const state = await loadNeonAppState(input.databaseUrl);
    const generatedAt = new Date().toISOString();
    const touched: StoredLeadRecord[] = [];
    let skipped = 0;

    for (const leadId of leadIds) {
      const record = state.repository.getLead(leadId);
      if (!record) continue;
      const previous = readBdWorkflow(record.lead);
      const snapshot = refreshBdWorkflow(record.lead, generatedAt, ACTOR);
      if (bdWorkflowStateEqual(previous, snapshot)) {
        skipped += 1;
        continue;
      }
      state.repository.upsertLead(attachBdWorkflow(record.lead, snapshot), ACTOR);
      const note = `bd_workflow_initialized::${snapshot.nextBestAction.code}::${snapshot.openTaskCount}`;
      const updated = state.repository.getLead(leadId)!;
      if (!updated.notes.includes(note)) state.repository.addNote(leadId, note, ACTOR);
      touched.push(state.repository.getLead(leadId)!);
    }

    if (touched.length > 0) await persistLeadRecords(input.databaseUrl, touched);
    return responseJson({
      ...parsed.body,
      bdWorkflow: {
        status: 'applied',
        processed: leadIds.length,
        updated: touched.length,
        skipped,
        humanReviewRequired: true,
        externalActionAutomated: false,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  } catch (error) {
    console.error('BD_WORKFLOW_POST_INTAKE_ERROR', {
      message: safeErrorMessage(error),
      processedLeadCount: leadIds.length,
    });
    return responseJson({
      ...parsed.body,
      bdWorkflow: {
        status: 'deferred',
        processed: 0,
        updated: 0,
        reason: 'Lead ingestion succeeded, but BD workflow initialization was deferred for a later retry.',
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  }
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
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
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
