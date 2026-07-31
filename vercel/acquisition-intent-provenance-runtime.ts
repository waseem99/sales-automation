import {readIdentityResolution} from '@sales-automation/identity-graph';
import {loadNeonAppState, persistLeadRecords} from '@sales-automation/neon-state';
import {
  attachIntentProvenance,
  buildIntentProvenance,
  COLD_NO_CONFIRMED_INTENT_WARNING,
  isSalesNavigatorCold,
  readIntentProvenance,
  type Lead,
  type LeadIntentProvenance,
} from '@sales-automation/shared';
import type {StoredLeadRecord} from '@sales-automation/storage';

export const INTENT_PROVENANCE_RUNTIME_VERSION = 'intent-provenance-runtime.v1';
const ACTOR = 'intent-provenance@codistan.local';
const MAX_PROCESSED_IDS = 50;

interface IntakeResponseBody {
  processedLeadIds?: unknown;
  [key: string]: unknown;
}

export async function applyIntentProvenanceAfterIntake(input: {
  response: Response;
  databaseUrl: string;
  generatedAt?: string;
}): Promise<Response> {
  if (!input.response.ok) return input.response;
  const parsed = await parseResponse(input.response);
  if (!parsed) return input.response;
  const processedLeadIds = normalizeIds(parsed.body.processedLeadIds).slice(0, MAX_PROCESSED_IDS);
  if (processedLeadIds.length === 0) return input.response;

  try {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const state = await loadNeonAppState(input.databaseUrl);
    const touchedIds = new Set<string>();
    const evaluatedIds = new Set<string>();
    const allRecords = state.repository.listLeads();

    for (const seedId of processedLeadIds) {
      const group = resolveIntentGroup(seedId, allRecords);
      for (const record of group) {
        if (evaluatedIds.has(record.lead.id)) continue;
        const related = group.filter((candidate) => candidate.lead.id !== record.lead.id).map((candidate) => candidate.lead);
        const provenance = buildIntentProvenance(record.lead, related, generatedAt);
        const attached = attachIntentProvenance(record.lead, provenance);
        evaluatedIds.add(record.lead.id);
        if (!sameIntentState(record.lead, attached)) {
          state.repository.upsertLead(attached, ACTOR);
          touchedIds.add(attached.id);
        }
        if (isSalesNavigatorCold(record.lead)) {
          addNoteOnce(
            state.repository,
            record.lead.id,
            state.repository.getLead(record.lead.id)?.notes ?? record.notes,
            `intent_provenance::cold_no_confirmed_intent::${COLD_NO_CONFIRMED_INTENT_WARNING}`,
            touchedIds,
          );
          if (provenance.linkedWarmIntentConfirmed) {
            addNoteOnce(
              state.repository,
              record.lead.id,
              state.repository.getLead(record.lead.id)?.notes ?? record.notes,
              `intent_provenance::linked_warm_evidence::${provenance.warmEvidence.map((item) => item.leadId).join(',')}::cold_source_preserved`,
              touchedIds,
            );
          }
        }
      }
    }

    const touchedRecords = [...touchedIds]
      .map((leadId) => state.repository.getLead(leadId))
      .filter((record): record is StoredLeadRecord => Boolean(record));
    await persistLeadRecords(input.databaseUrl, touchedRecords);

    const evaluatedRecords = [...evaluatedIds]
      .map((leadId) => state.repository.getLead(leadId))
      .filter((record): record is StoredLeadRecord => Boolean(record));
    const provenances = evaluatedRecords
      .map((record) => readIntentProvenance(record.lead))
      .filter((value): value is LeadIntentProvenance => Boolean(value));
    return responseJson({
      ...parsed.body,
      intentProvenance: {
        status: 'applied',
        version: 'intent-provenance.v1',
        evaluated: evaluatedRecords.length,
        touchedLeadIds: [...touchedIds],
        coldOnly: provenances.filter((item) => item.effectiveInterpretation === 'cold_only').length,
        linkedWarmEvidence: provenances.filter((item) => item.effectiveInterpretation === 'linked_warm_evidence').length,
        warmBuyerAuthored: provenances.filter((item) => item.effectiveInterpretation === 'warm_buyer_authored').length,
        invalidOrStaleWarmEvidence: provenances.reduce((total, item) => total + item.invalidOrStaleWarmEvidence.length, 0),
        originalSourceClassificationPreserved: true,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  } catch (error) {
    console.error('INTENT_PROVENANCE_POST_INTAKE_ERROR', {
      message: safeErrorMessage(error),
      processedLeadCount: processedLeadIds.length,
    });
    return responseJson({
      ...parsed.body,
      intentProvenance: {
        status: 'deferred',
        reason: 'Source ingestion succeeded, but intent provenance refresh was deferred for a later retry.',
        originalSourceClassificationPreserved: true,
      },
      humanReviewRequired: true,
      externalActionAutomated: false,
    }, input.response.status, parsed.headers);
  }
}

function resolveIntentGroup(seedId: string, records: StoredLeadRecord[]): StoredLeadRecord[] {
  const index = new Map(records.map((record) => [record.lead.id, record]));
  const seed = index.get(seedId);
  if (!seed) return [];
  const ids = new Set<string>([seedId]);
  const seedResolution = readIdentityResolution(seed.lead);
  if (seedResolution) {
    for (const id of [
      ...seedResolution.person.matchedLeadIds,
      ...seedResolution.company.matchedLeadIds,
      ...seedResolution.duplicateContactLeadIds,
    ]) ids.add(id);
    for (const record of records) {
      const resolution = readIdentityResolution(record.lead);
      if (!resolution) continue;
      if (resolution.person.id === seedResolution.person.id || resolution.company.id === seedResolution.company.id) {
        ids.add(record.lead.id);
      }
    }
  }
  return [...ids].map((id) => index.get(id)).filter((record): record is StoredLeadRecord => Boolean(record));
}

function sameIntentState(existing: Lead, incoming: Lead): boolean {
  return JSON.stringify({
    provenance: readIntentProvenance(existing),
    evidenceSummary: existing.evidenceSummary,
    recommendedNextAction: existing.recommendedNextAction,
    draftMessage: existing.draftMessage,
  }) === JSON.stringify({
    provenance: readIntentProvenance(incoming),
    evidenceSummary: incoming.evidenceSummary,
    recommendedNextAction: incoming.recommendedNextAction,
    draftMessage: incoming.draftMessage,
  });
}

function addNoteOnce(
  repository: {addNote(leadId: string, note: string, actor?: string): StoredLeadRecord},
  leadId: string,
  existingNotes: string[],
  note: string,
  touchedIds: Set<string>,
): void {
  if (existingNotes.includes(note)) return;
  repository.addNote(leadId, note, ACTOR);
  touchedIds.add(leadId);
}

async function parseResponse(response: Response): Promise<{
  body: IntakeResponseBody;
  headers: Record<string, string>;
} | undefined> {
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
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
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
