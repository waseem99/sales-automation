import {
  attachOutreachWorkbench,
  initializeOutreachWorkbench,
  readOutreachWorkbench,
  type OutreachChannel,
  type OutreachProof,
  type OutreachSeedDraft,
  type OutreachWorkbenchSnapshot,
} from '@sales-automation/outreach-workbench';
import type { PortfolioItem } from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';

export interface PrepareOutreachWorkbenchInput {
  repository: LeadRepository;
  record: StoredLeadRecord;
  portfolioItems?: PortfolioItem[];
  actor: string;
  generatedAt: string;
  auditNote?: string;
}

export interface PreparedOutreachWorkbench {
  snapshot: OutreachWorkbenchSnapshot;
  record: StoredLeadRecord;
}

export function prepareOutreachWorkbench(input: PrepareOutreachWorkbenchInput): PreparedOutreachWorkbench {
  const seedDrafts = evaluatorSeedDrafts(input.record);
  const approvedProof = evaluatorApprovedProof(input.record, input.portfolioItems ?? []);
  const snapshot = initializeOutreachWorkbench({
    lead: input.record.lead,
    seedDrafts,
    approvedProof,
    actor: input.actor,
    generatedAt: input.generatedAt,
  });
  return saveOutreachWorkbench({
    repository: input.repository,
    leadId: input.record.lead.id,
    snapshot,
    actor: input.actor,
    auditNote: input.auditNote ?? `outreach_workbench_prepared::${snapshot.recommendedChannel}`,
  });
}

export function saveOutreachWorkbench(input: {
  repository: LeadRepository;
  leadId: string;
  snapshot: OutreachWorkbenchSnapshot;
  actor: string;
  auditNote: string;
}): PreparedOutreachWorkbench {
  const current = input.repository.getLead(input.leadId);
  if (!current) throw new Error(`Prospect not found: ${input.leadId}`);
  input.repository.upsertLead(attachOutreachWorkbench(current.lead, input.snapshot), input.actor);
  const updated = input.repository.getLead(input.leadId)!;
  if (!updated.notes.includes(input.auditNote)) input.repository.addNote(input.leadId, input.auditNote, input.actor);
  return {snapshot: input.snapshot, record: input.repository.getLead(input.leadId)!};
}

export function requireOutreachWorkbench(record: StoredLeadRecord): OutreachWorkbenchSnapshot {
  const snapshot = readOutreachWorkbench(record.lead);
  if (!snapshot) throw new Error('Prepare the outreach workbench before using this action.');
  return snapshot;
}

function evaluatorSeedDrafts(record: StoredLeadRecord): OutreachSeedDraft[] {
  const values: OutreachSeedDraft[] = [];
  for (const draft of record.latestEvaluation?.drafts ?? []) {
    const channel = mapDraftChannel(draft.type, record);
    if (!channel || !draft.body?.trim()) continue;
    values.push({
      channel,
      subject: draft.subject,
      body: draft.body,
      proofIds: draft.metadata.portfolioItemIds,
      assumptions: draft.metadata.assumptions,
      safeguards: draft.metadata.safeguards,
    });
  }
  if (values.length === 0 && record.lead.draftMessage?.trim()) {
    values.push({
      channel: preferredFallbackChannel(record),
      body: record.lead.draftMessage,
      assumptions: ['This existing draft predates the workbench and must be rechecked against current evidence.'],
      safeguards: ['Human review is required. No external action is performed by the workbench.'],
    });
  }
  return dedupeSeeds(values);
}

function evaluatorApprovedProof(record: StoredLeadRecord, portfolioItems: PortfolioItem[]): OutreachProof[] {
  const catalog = new Map(portfolioItems.map((item) => [item.id, item]));
  const proof: OutreachProof[] = [];
  for (const match of record.latestEvaluation?.portfolioMatches ?? []) {
    const item = match.portfolioItem;
    if (!item || item.confidentiality === 'private') continue;
    proof.push({
      id: item.id,
      label: item.projectName,
      approved: true,
      sourceUrl: item.assetUrls[0],
    });
    catalog.delete(item.id);
  }
  for (const id of record.lead.recommendedPortfolioItemIds ?? []) {
    const item = catalog.get(id);
    if (!item || item.confidentiality === 'private') continue;
    proof.push({id: item.id, label: item.projectName, approved: true, sourceUrl: item.assetUrls[0]});
  }
  const seen = new Set<string>();
  return proof.filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

function mapDraftChannel(type: string, record: StoredLeadRecord): OutreachChannel | undefined {
  if (type === 'upwork_proposal') return 'upwork_proposal';
  if (type === 'linkedin_comment') return 'linkedin_comment';
  if (type === 'linkedin_dm') return 'linkedin_dm';
  if (type === 'partner_outreach' || type === 'solution_led_outreach') return preferredFallbackChannel(record);
  return undefined;
}

function preferredFallbackChannel(record: StoredLeadRecord): OutreachChannel {
  if (record.lead.source === 'upwork' || record.lead.leadType === 'upwork_job') return 'upwork_proposal';
  if (record.lead.source === 'sales_navigator') return 'sales_navigator_inmail';
  if (record.lead.contactEmail) return 'email';
  if (/referral|introduction|introduc/i.test(record.lead.reachMethod ?? '')) return 'referral';
  return 'linkedin_dm';
}

function dedupeSeeds(values: OutreachSeedDraft[]): OutreachSeedDraft[] {
  const map = new Map<OutreachChannel, OutreachSeedDraft>();
  for (const value of values) if (!map.has(value.channel)) map.set(value.channel, value);
  return [...map.values()];
}
