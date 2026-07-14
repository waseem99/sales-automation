import type { Lead } from '@sales-automation/shared';
import type { LeadRepository } from '@sales-automation/storage';

export type ProspectApproachChannel =
  | 'email'
  | 'linkedin'
  | 'whatsapp'
  | 'contact_form'
  | 'upwork'
  | 'procurement_portal'
  | 'research';

export interface ProspectApproachRecommendation {
  channel: ProspectApproachChannel;
  channelLabel: string;
  nextAction: string;
  reason: string;
}

export interface ProspectAssignmentRecommendation {
  owner: string;
  role: string;
  reason: string;
}

export interface AutoAssignmentResult {
  assigned: number;
  alreadyAssigned: number;
  assignments: Array<{ leadId: string; owner: string; reason: string }>;
}

export const PROSPECT_TEAM = [
  { email: 'talha.bashir@codistan.org', displayName: 'Talha Bashir', role: 'Freelance and outreach lead' },
  { email: 'jawad.jutt@codistan.org', displayName: 'Jawad Jutt', role: 'Tenders, RFPs and contracts' },
  { email: 'moiz.khalid@codistan.org', displayName: 'Moiz Khalid', role: 'Business operations and partnerships' },
  { email: 'subainaaamir@codistan.org', displayName: 'Subaina Aamir', role: 'Direct and private clients' },
  { email: 'danishkhalid@codistan.org', displayName: 'Danish Khalid', role: 'Talha outreach team' },
  { email: 'hibasohail@codistan.org', displayName: 'Hiba Sohail', role: 'Talha outreach team' },
  { email: 'bilalahmed@codistan.org', displayName: 'Bilal Ahmed', role: 'Talha outreach team' },
] as const;

const TALHA_OUTREACH_TEAM = [
  'talha.bashir@codistan.org',
  'danishkhalid@codistan.org',
  'hibasohail@codistan.org',
  'bilalahmed@codistan.org',
] as const;

export function buildOwnerWorkload(leads: Array<Pick<Lead, 'owner'>>): Map<string, number> {
  const workload = new Map<string, number>();
  for (const member of PROSPECT_TEAM) workload.set(member.email, 0);
  for (const lead of leads) {
    const owner = normalizeEmail(lead.owner);
    if (owner) workload.set(owner, (workload.get(owner) ?? 0) + 1);
  }
  return workload;
}

export function recommendProspectAssignment(
  lead: Lead,
  workload: ReadonlyMap<string, number> = new Map(),
): ProspectAssignmentRecommendation {
  const existingOwner = normalizeEmail(lead.owner);
  if (existingOwner) {
    return {
      owner: existingOwner,
      role: roleForOwner(existingOwner),
      reason: 'Existing manual assignment retained.',
    };
  }

  const text = normalizeText([
    lead.title,
    lead.description,
    lead.evidenceSummary,
    lead.serviceOffer,
    lead.discoverySource,
  ].filter(Boolean).join(' '));

  if (
    lead.source === 'public_procurement'
    || lead.leadType === 'solution_led_prospect'
    || containsAny(text, ['request for proposal', 'rfp', 'tender', 'invitation to bid', 'procurement', 'expression of interest', 'eoi'])
  ) {
    return fixedAssignment(
      'jawad.jutt@codistan.org',
      'Tenders, RFPs and contracts',
      'The opportunity is procurement, tender, RFP or contract-led.',
    );
  }

  if (
    lead.leadType === 'partner_prospect'
    || lead.leadType === 'partnership_target'
    || lead.opportunityStatus === 'partnership_target'
    || containsAny(text, ['delivery partner', 'implementation partner', 'white label', 'outsourcing partner', 'agency partner', 'team extension'])
  ) {
    return fixedAssignment(
      'moiz.khalid@codistan.org',
      'Business operations and partnerships',
      'The lead is primarily a partnership, outsourcing or operational collaboration target.',
    );
  }

  if (
    (lead.score?.total ?? 0) >= 85
    || containsAny(text, ['founder-led', 'fractional cto', 'ai strategy', 'technical discovery', 'solution architecture'])
  ) {
    return fixedAssignment(
      'talha.bashir@codistan.org',
      'Freelance and outreach lead',
      'The opportunity is high-value or requires senior consultative outreach.',
    );
  }

  if (
    lead.source === 'upwork'
    || lead.source === 'public_job_board'
    || lead.leadType === 'upwork_job'
    || containsAny(text, ['freelance', 'contractor', 'apply now', 'job opening', 'hiring'])
  ) {
    const owner = leastLoadedOwner(TALHA_OUTREACH_TEAM, workload, lead.id);
    return fixedAssignment(
      owner,
      owner === 'talha.bashir@codistan.org' ? 'Freelance and outreach lead' : 'Talha outreach team',
      'The lead is a freelance, job-board or active outreach opportunity and is balanced within Talha’s team.',
    );
  }

  if (lead.contactEmail || lead.contactFormUrl || lead.linkedinUrl || lead.contactName) {
    return fixedAssignment(
      'subainaaamir@codistan.org',
      'Direct and private clients',
      'The prospect has a direct business contact route suitable for private-client outreach.',
    );
  }

  const owner = leastLoadedOwner(TALHA_OUTREACH_TEAM, workload, lead.id);
  return fixedAssignment(
    owner,
    owner === 'talha.bashir@codistan.org' ? 'Freelance and outreach lead' : 'Talha outreach team',
    'No specialist route was conclusive, so the opportunity is balanced within the outreach team for research and activation.',
  );
}

export function recommendProspectApproach(lead: Lead): ProspectApproachRecommendation {
  const text = normalizeText(`${lead.title} ${lead.description} ${lead.evidenceSummary ?? ''}`);
  const urgency = freshnessInstruction(lead);
  const proof = lead.materialsToShare
    ? `Use ${lead.materialsToShare}`
    : 'Use one or two closely matched, approved Codistan case studies';

  if (lead.source === 'upwork' || lead.leadType === 'upwork_job') {
    return {
      channel: 'upwork',
      channelLabel: 'Upwork proposal',
      nextAction: `${urgency} Submit a concise, manually reviewed proposal focused on the stated requirement. ${proof}, confirm availability, and ask one precise scoping question.`,
      reason: 'The opportunity originated on Upwork, so the compliant platform response is the strongest first route.',
    };
  }

  if (
    lead.source === 'public_procurement'
    || containsAny(text, ['request for proposal', 'rfp', 'tender', 'invitation to bid', 'procurement', 'expression of interest'])
  ) {
    return {
      channel: 'procurement_portal',
      channelLabel: 'Tender portal / email',
      nextAction: `${urgency} Review eligibility, deadline and submission instructions first. Prepare a bid/no-bid note, then use the official portal or procurement email only.`,
      reason: 'Formal procurement opportunities must follow their published submission route and compliance requirements.',
    };
  }

  if (lead.contactEmail) {
    const partnershipAngle = lead.opportunityStatus === 'partnership_target'
      ? 'Propose a short partnership or overflow-delivery discussion.'
      : 'Reference the exact demand signal and propose a short discovery call.';
    return {
      channel: 'email',
      channelLabel: 'Email',
      nextAction: `${urgency} Send a short, human-approved email from sales@codistan.org. ${proof}. ${partnershipAngle}`,
      reason: 'A verified business email is available and provides the clearest auditable first-contact route.',
    };
  }

  if (lead.contactPhone) {
    return {
      channel: 'whatsapp',
      channelLabel: 'WhatsApp (business number)',
      nextAction: `${urgency} Verify that the number is publicly listed for business contact, then send a brief manual WhatsApp introduction and ask permission to share relevant examples.`,
      reason: 'A phone number is available but no verified business email was found.',
    };
  }

  if (lead.linkedinUrl || lead.contactName) {
    return {
      channel: 'linkedin',
      channelLabel: 'LinkedIn',
      nextAction: `${urgency} Use a manual LinkedIn connection or message referencing the public signal. Keep it conversational, avoid a long pitch, and move to email only after interest.`,
      reason: 'A decision-maker or LinkedIn route is available while direct email is missing.',
    };
  }

  if (lead.contactFormUrl) {
    return {
      channel: 'contact_form',
      channelLabel: 'Company contact form',
      nextAction: `${urgency} Submit a short capability note through the official company form and request the correct decision-maker for this requirement.`,
      reason: 'The company’s public contact form is the only verified direct route currently available.',
    };
  }

  return {
    channel: 'research',
    channelLabel: 'Research first',
    nextAction: 'Identify a relevant business decision-maker and verify a public business contact route before any outreach. Do not guess personal contact details.',
    reason: 'No verified email, business number, LinkedIn profile or official contact form is currently available.',
  };
}

export function applyAutomaticAssignment(
  lead: Lead,
  workload: Map<string, number>,
  generatedAt = new Date().toISOString(),
): { lead: Lead; assignment: ProspectAssignmentRecommendation; approach: ProspectApproachRecommendation } {
  const assignment = recommendProspectAssignment(lead, workload);
  const approach = recommendProspectApproach(lead);
  workload.set(assignment.owner, (workload.get(assignment.owner) ?? 0) + (lead.owner ? 0 : 1));
  return {
    assignment,
    approach,
    lead: {
      ...lead,
      owner: lead.owner ?? assignment.owner,
      reachMethod: approach.channelLabel,
      recommendedNextAction: approach.nextAction,
      updatedAt: generatedAt,
    },
  };
}

export function assignUnassignedProspects(
  repository: LeadRepository,
  generatedAt = new Date().toISOString(),
  actor = 'automatic-lead-routing',
): AutoAssignmentResult {
  const records = repository.listLeads();
  const workload = buildOwnerWorkload(records.map((record) => record.lead));
  const assignments: AutoAssignmentResult['assignments'] = [];
  let alreadyAssigned = 0;

  const ordered = [...records].sort((left, right) => {
    const leftPriority = left.lead.rank ?? (101 - (left.lead.score?.total ?? 0));
    const rightPriority = right.lead.rank ?? (101 - (right.lead.score?.total ?? 0));
    return leftPriority - rightPriority;
  });

  for (const record of ordered) {
    if (normalizeEmail(record.lead.owner)) {
      alreadyAssigned += 1;
      continue;
    }
    const applied = applyAutomaticAssignment(record.lead, workload, generatedAt);
    repository.upsertLead(applied.lead, actor);
    repository.addNote(
      record.lead.id,
      `routing::automatic::${applied.assignment.owner}::${applied.approach.channel}::${applied.assignment.reason} | ${applied.approach.nextAction}`,
      actor,
    );
    assignments.push({
      leadId: record.lead.id,
      owner: applied.assignment.owner,
      reason: applied.assignment.reason,
    });
  }

  return { assigned: assignments.length, alreadyAssigned, assignments };
}

function fixedAssignment(owner: string, role: string, reason: string): ProspectAssignmentRecommendation {
  return { owner, role, reason };
}

function leastLoadedOwner(
  owners: readonly string[],
  workload: ReadonlyMap<string, number>,
  seed: string,
): string {
  const minimum = Math.min(...owners.map((owner) => workload.get(owner) ?? 0));
  const available = owners.filter((owner) => (workload.get(owner) ?? 0) === minimum);
  return available[stableIndex(seed, available.length)] ?? owners[0]!;
}

function roleForOwner(owner: string): string {
  return PROSPECT_TEAM.find((member) => member.email === owner)?.role ?? 'Lead owner';
}

function freshnessInstruction(lead: Lead): string {
  const minutes = lead.freshnessMinutes;
  if (minutes === undefined || !Number.isFinite(minutes)) return 'Review the source date before outreach.';
  if (minutes <= 48 * 60) return 'Act today while the signal is within 48 hours.';
  if (minutes <= 78 * 60) return 'Act within the same business day while the signal is within the 78-hour review window.';
  return 'Confirm the opportunity is still active before contacting the prospect.';
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@.+]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function stableIndex(value: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash % length;
}
