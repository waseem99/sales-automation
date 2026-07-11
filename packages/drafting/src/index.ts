import type { PortfolioMatch } from '@sales-automation/portfolio-matching';
import type { ProfileRecommendation } from '@sales-automation/routing';
import type { Lead, LeadScore } from '@sales-automation/shared';

export type DraftType =
  | 'upwork_proposal'
  | 'linkedin_comment'
  | 'linkedin_dm'
  | 'partner_outreach'
  | 'solution_led_outreach';

export type DraftStatus = 'draft_ready' | 'needs_review' | 'approved' | 'rejected';

export interface GeneratedDraft {
  id: string;
  type: DraftType;
  status: DraftStatus;
  subject?: string;
  body: string;
  metadata: {
    leadId: string;
    source: Lead['source'];
    leadType: Lead['leadType'];
    recommendedProfile: string;
    portfolioItemIds: string[];
    requiresHumanApproval: true;
    generatedAt: string;
    assumptions: string[];
    safeguards: string[];
  };
}

export interface GenerateDraftInput {
  lead: Lead;
  score: LeadScore;
  profileRecommendation: ProfileRecommendation;
  portfolioMatches: PortfolioMatch[];
  generatedAt?: string;
}

export function generateDrafts(input: GenerateDraftInput): GeneratedDraft[] {
  if (input.score.status === 'rejected') return [];

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const proof = getApprovedProof(input.portfolioMatches);
  const assumptions = buildAssumptions(input, proof);
  const safeguards = [
    'Draft is internal only and must be approved by a human before sending.',
    'Draft references only public or anonymized portfolio proof.',
    'No external outreach is performed by this package.',
  ];

  if (input.lead.leadType === 'upwork_job') {
    return [createDraft(input, 'upwork_proposal', buildUpworkProposal(input, proof), generatedAt, assumptions, safeguards)];
  }

  if (input.lead.leadType === 'linkedin_warm_post' || input.lead.leadType === 'linkedin_sales_nav_alert') {
    return [
      createDraft(input, 'linkedin_comment', buildLinkedInComment(input, proof), generatedAt, assumptions, safeguards),
      createDraft(input, 'linkedin_dm', buildLinkedInDm(input, proof), generatedAt, assumptions, safeguards),
    ];
  }

  if (input.lead.leadType === 'partner_prospect' || input.lead.leadType === 'partnership_target') {
    return [createDraft(input, 'partner_outreach', buildPartnerOutreach(input, proof), generatedAt, assumptions, safeguards)];
  }

  if (input.lead.leadType === 'solution_led_prospect') {
    return [createDraft(input, 'solution_led_outreach', buildSolutionOutreach(input, proof), generatedAt, assumptions, safeguards)];
  }

  return [createDraft(input, 'linkedin_dm', buildGenericWarmDraft(input, proof), generatedAt, assumptions, safeguards)];
}

function createDraft(
  input: GenerateDraftInput,
  type: DraftType,
  body: string,
  generatedAt: string,
  assumptions: string[],
  safeguards: string[],
): GeneratedDraft {
  const portfolioItemIds = getApprovedProof(input.portfolioMatches).map((match) => match.portfolioItem.id);

  return {
    id: `${input.lead.id}-${type}`,
    type,
    status: 'draft_ready',
    subject: getSubject(input, type),
    body,
    metadata: {
      leadId: input.lead.id,
      source: input.lead.source,
      leadType: input.lead.leadType,
      recommendedProfile: input.profileRecommendation.primaryProfile,
      portfolioItemIds,
      requiresHumanApproval: true,
      generatedAt,
      assumptions,
      safeguards,
    },
  };
}

function buildUpworkProposal(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  const topProof = proof[0]?.portfolioItem;
  const proofLine = topProof
    ? `A relevant example from our side is ${topProof.projectName}, where we handled ${topProof.problemSolved.toLowerCase()}`
    : 'We have handled similar AI/software delivery work and can share the closest approved proof after a quick review.';

  return [
    `Hi, I read your requirement for ${input.lead.title.toLowerCase()} and the core need seems to be ${summarizeNeed(input.lead)}.`,
    '',
    `${proofLine}.`,
    '',
    `Suggested approach: first confirm the workflow/data sources, then build the core implementation in milestones, keep human review points where needed, and avoid over-automation until the outputs are reliable.`,
    '',
    'A few useful questions:',
    '- What systems or data sources should this connect with?',
    '- Do you already have examples of the expected output or workflow?',
    '- What would make the first milestone successful for you?',
  ].join('\n');
}

function buildLinkedInComment(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  const proofPhrase = proof[0]
    ? ` We have seen a similar pattern while delivering ${proof[0].portfolioItem.projectName}.`
    : '';
  return `This is a practical use case for ${friendlyService(input.lead)}.${proofPhrase} The safest path is to start with one measurable workflow, validate the data and output quality, and then expand.`;
}

function buildLinkedInDm(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  const proofPhrase = proof[0]
    ? `A relevant example is ${proof[0].portfolioItem.projectName}, where we handled ${proof[0].portfolioItem.problemSolved.toLowerCase()}.`
    : 'We have delivered related AI/software systems and can share the closest approved example.';
  return [
    `Hi ${input.lead.contactName ?? 'there'}, I saw your post/update about ${input.lead.title.toLowerCase()}.`,
    '',
    proofPhrase,
    '',
    `A focused first step could be a short discovery around the workflow, data, success criteria, and the smallest useful pilot. Happy to share a practical approach if relevant.`,
  ].join('\n');
}

function buildPartnerOutreach(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  const proofPhrase = proof[0]
    ? `One relevant delivery example is ${proof[0].portfolioItem.projectName}.`
    : 'We can share relevant approved delivery examples after understanding your partner model.';
  return [
    `Hi ${input.lead.contactName ?? 'there'},`,
    '',
    `I am reaching out from Codistan, a 150+ person software, AI, creative technology, and digital delivery company. ${proofPhrase}`,
    '',
    `Your work around ${input.lead.title.toLowerCase()} looks complementary to our delivery capacity. We can support defined projects or overflow work under NDA and a white-label arrangement while your team retains the client relationship.`,
    '',
    'Would it be useful to compare capabilities and see whether there is a practical partnership fit?',
  ].join('\n');
}

function buildSolutionOutreach(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  const proofPhrase = proof[0]
    ? `We have already delivered ${proof[0].portfolioItem.projectName}, which is relevant because ${proof[0].portfolioItem.problemSolved.toLowerCase()}.`
    : 'We have delivered related software and AI systems and can share the most relevant approved proof.';
  return [
    `Hi ${input.lead.contactName ?? 'there'},`,
    '',
    `I noticed ${input.lead.companyName ?? 'your company'} may be working through ${summarizeNeed(input.lead)}.`,
    '',
    proofPhrase,
    '',
    'A practical starting point could be a short technical discovery followed by a defined pilot. Would a brief discussion be useful?',
  ].join('\n');
}

function buildGenericWarmDraft(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  const proofPhrase = proof[0]
    ? `A relevant example is ${proof[0].portfolioItem.projectName}.`
    : 'We can share an approved example after confirming the exact requirement.';
  return `Hi ${input.lead.contactName ?? 'there'}, I noticed the need around ${input.lead.title.toLowerCase()}. ${proofPhrase} We could first confirm the scope, success criteria, and smallest useful milestone before proposing the full build.`;
}

function getSubject(input: GenerateDraftInput, type: DraftType): string | undefined {
  if (type === 'upwork_proposal' || type === 'linkedin_comment') return undefined;
  if (type === 'partner_outreach') return `Potential delivery partnership with Codistan`;
  if (type === 'solution_led_outreach') return `Idea for ${input.lead.companyName ?? input.lead.title}`;
  return `Regarding ${input.lead.title}`;
}

function getApprovedProof(matches: PortfolioMatch[]): PortfolioMatch[] {
  return matches.filter((match) => match.portfolioItem.confidentiality !== 'private').slice(0, 2);
}

function buildAssumptions(input: GenerateDraftInput, proof: PortfolioMatch[]): string[] {
  const assumptions = [
    'The lead text may be incomplete and should be checked against the original source.',
    'The recommended profile and outreach channel require human verification.',
  ];
  if (proof.length === 0) assumptions.push('No approved public/anonymized portfolio proof was matched automatically.');
  if (!input.lead.contactName) assumptions.push('Contact name is unknown; personalize before sending.');
  return assumptions;
}

function summarizeNeed(lead: Lead): string {
  const description = lead.description.replace(/\s+/g, ' ').trim();
  if (!description) return friendlyService(lead);
  return description.length > 180 ? `${description.slice(0, 177)}...` : description;
}

function friendlyService(lead: Lead): string {
  return lead.serviceCategory.replaceAll('_', ' ');
}
