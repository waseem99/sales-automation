import {
  attachIdentityResolution,
  duplicateContactWarning,
  resolveLeadIdentity,
  type LeadIdentityResolution,
} from '@sales-automation/identity-graph';
import { loadNeonAppState, persistLeadRecords } from '@sales-automation/neon-state';
import type { Lead } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

const ACTOR = 'identity-graph@codistan.local';
const MAX_PROCESSED_IDS = 50;

interface IntakeResponseBody {
  processedLeadIds?: unknown;
  createdLeadIds?: unknown;
  updatedLeadIds?: unknown;
  unchangedLeadIds?: unknown;
  [key: string]: unknown;
}

export interface IdentityGraphIntakeSummary {
  processed: number;
  resolvedPeople: number;
  candidatePeople: number;
  unresolvedPeople: number;
  conflictPeople: number;
  resolvedCompanies: number;
  candidateCompanies: number;
  unresolvedCompanies: number;
  conflictCompanies: number;
  duplicateContactWarnings: number;
  touchedLeadIds: string[];
}

export async function applyIdentityGraphAfterIntake(input: {
  response: Response;
  databaseUrl: string;
  generatedAt?: string;
}): Promise<Response> {
  if (!input.response.ok) return input.response;

  const parsed = await parseResponse(input.response);
  if (!parsed) return input.response;
  const processedLeadIds = normalizeIds(parsed.body.processedLeadIds).slice(0, MAX_PROCESSED_IDS);
  if (processedLeadIds.length === 0) return input.response;

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const state = await loadNeonAppState(input.databaseUrl);
  const touchedIds = new Set<string>();
  const primaryResolutions = new Map<string, LeadIdentityResolution>();

  for (const leadId of processedLeadIds) {
    const record = state.repository.getLead(leadId);
    if (!record) continue;
    const resolution = resolveLeadIdentity(
      record.lead,
      state.repository.listLeads().map((item) => item.lead),
      generatedAt,
    );
    saveResolution(state.repository.listLeads(), state.repository, record, resolution, touchedIds);
    primaryResolutions.set(leadId, resolution);
  }

  const linkedIds = new Set<string>();
  for (const resolution of primaryResolutions.values()) {
    for (const leadId of [
      ...resolution.person.matchedLeadIds,
      ...resolution.company.matchedLeadIds,
    ]) {
      if (!processedLeadIds.includes(leadId)) linkedIds.add(leadId);
    }
  }

  for (const leadId of linkedIds) {
    const record = state.repository.getLead(leadId);
    if (!record) continue;
    const resolution = resolveLeadIdentity(
      record.lead,
      state.repository.listLeads().map((item) => item.lead),
      generatedAt,
    );
    saveResolution(state.repository.listLeads(), state.repository, record, resolution, touchedIds);
  }

  const touchedRecords = [...touchedIds]
    .map((leadId) => state.repository.getLead(leadId))
    .filter((record): record is StoredLeadRecord => Boolean(record));
  await persistLeadRecords(input.databaseUrl, touchedRecords);

  const summary = buildSummary([...primaryResolutions.values()], [...touchedIds]);
  return responseJson({
    ...parsed.body,
    identityGraph: summary,
    humanReviewRequired: true,
    externalActionAutomated: false,
  }, input.response.status, parsed.headers);
}

function saveResolution(
  allRecords: StoredLeadRecord[],
  repository: {
    upsertLead(lead: Lead, actor?: string): StoredLeadRecord;
    addNote(leadId: string, note: string, actor?: string): StoredLeadRecord;
  },
  record: StoredLeadRecord,
  resolution: LeadIdentityResolution,
  touchedIds: Set<string>,
): void {
  const attached = attachIdentityResolution(record.lead, resolution);
  repository.upsertLead(attached, ACTOR);
  touchedIds.add(attached.id);

  const notes = allRecords.find((item) => item.lead.id === attached.id)?.notes ?? record.notes;
  const warning = duplicateContactWarning(resolution);
  if (warning) {
    addNoteOnce(repository, attached.id, notes, `identity_graph::duplicate_contact::${warning}`);
  }
  if (resolution.person.status === 'candidate' && resolution.person.candidateLeadIds.length > 0) {
    addNoteOnce(
      repository,
      attached.id,
      notes,
      `identity_graph::candidate_person::${resolution.person.candidateLeadIds.join(',')}::human_review_required`,
    );
  }
  if (resolution.company.status === 'candidate' && resolution.company.candidateLeadIds.length > 0) {
    addNoteOnce(
      repository,
      attached.id,
      notes,
      `identity_graph::candidate_company::${resolution.company.candidateLeadIds.join(',')}::human_review_required`,
    );
  }
  for (const conflict of resolution.conflicts) {
    addNoteOnce(repository, attached.id, notes, `identity_graph::conflict::${conflict}`);
  }
}

function addNoteOnce(
  repository: { addNote(leadId: string, note: string, actor?: string): StoredLeadRecord },
  leadId: string,
  existingNotes: string[],
  note: string,
): void {
  if (existingNotes.includes(note)) return;
  repository.addNote(leadId, note, ACTOR);
  existingNotes.push(note);
}

function buildSummary(
  resolutions: LeadIdentityResolution[],
  touchedLeadIds: string[],
): IdentityGraphIntakeSummary {
  return {
    processed: resolutions.length,
    resolvedPeople: countStatus(resolutions, 'person', 'resolved'),
    candidatePeople: countStatus(resolutions, 'person', 'candidate'),
    unresolvedPeople: countStatus(resolutions, 'person', 'unresolved'),
    conflictPeople: countStatus(resolutions, 'person', 'conflict'),
    resolvedCompanies: countStatus(resolutions, 'company', 'resolved'),
    candidateCompanies: countStatus(resolutions, 'company', 'candidate'),
    unresolvedCompanies: countStatus(resolutions, 'company', 'unresolved'),
    conflictCompanies: countStatus(resolutions, 'company', 'conflict'),
    duplicateContactWarnings: resolutions.filter((resolution) => resolution.duplicateContactLeadIds.length > 0).length,
    touchedLeadIds,
  };
}

function countStatus(
  resolutions: LeadIdentityResolution[],
  entity: 'person' | 'company',
  status: LeadIdentityResolution['person']['status'],
): number {
  return resolutions.filter((resolution) => resolution[entity].status === status).length;
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
    return { body, headers };
  } catch {
    return undefined;
  }
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

function responseJson(
  value: unknown,
  status: number,
  existingHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...existingHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
