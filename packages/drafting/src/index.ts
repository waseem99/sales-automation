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

  if (input.lead.leadType === 'partner_prospect') {
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
    '- Should the first version be a lightweight MVP or production-ready from day one?',
    '',
    'If this direction fits, we can review the details and suggest a clean milestone plan.',
  ].join('\n');
}

function buildLinkedInComment(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  const proofPhrase = proof[0] ? `we have worked on similar ${proof[0].portfolioItem.serviceCategories[0].replace(/_/g, ' ')} workflows` : 'we have handled similar delivery work';
  return `This is exactly the kind of problem where a focused technical partner helps. ${proofPhrase}. Happy to share a relevant example if useful.`;
}

function buildLinkedInDm(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  const topProof = proof[0]?.portfolioItem;
  return [
    `Hi${input.lead.contactName ? ` ${input.lead.contactName}` : ''}, saw your post around ${input.lead.title.toLowerCase()}.`,
    '',
    `Codistan supports teams with AI, automation, and software delivery. ${topProof ? `One relevant example is ${topProof.projectName}, focused on ${topProof.problemSolved.toLowerCase()}` : 'We can share a relevant example after confirming the closest fit.'}`,
    '',
    'Worth a quick conversation to see if we can help?',
  ].join('\n');
}

function buildPartnerOutreach(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  const proofLine = proof[0]
    ? `For context, one relevant proof area is ${proof[0].portfolioItem.projectName}.`
    : 'We can share relevant proof across AI, web, automation, AR/3D, and secure software delivery.';

  return [
    `Hi${input.lead.contactName ? ` ${input.lead.contactName}` : ''},`,
    '',
    'I wanted to explore whether Codistan could support your team as a white-label or offshore delivery partner.',
    '',
    'You keep the client relationship. We support execution quietly in the background across AI automation, full-stack web apps, portals, AR/3D, and cybersecurity/compliance-heavy builds.',
    '',
    proofLine,
    '',
    'Open to a short call to see where delivery support would be useful?',
  ].join('\n');
}

function buildSolutionOutreach(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  return [
    `Hi${input.lead.contactName ? ` ${input.lead.contactName}` : ''},`,
    '',
    `I am reaching out because ${summarizeNeed(input.lead)} appears relevant to a solution area we are shaping at Codistan.`,
    '',
    'The idea is to reduce manual handling, improve visibility, and create a controlled workflow with clear human review points rather than risky black-box automation.',
    '',
    proof[0] ? `A related proof area is ${proof[0].portfolioItem.projectName}.` : 'We can share relevant proof once we confirm the exact use case.',
    '',
    'Would it be useful to compare notes for 15 minutes?',
  ].join('\n');
}

function buildGenericWarmDraft(input: GenerateDraftInput, proof: PortfolioMatch[]): string {
  return [
    `Hi${input.lead.contactName ? ` ${input.lead.contactName}` : ''},`,
    '',
    `Saw the requirement around ${input.lead.title.toLowerCase()}. Codistan may be able to support this with the recommended ${input.profileRecommendation.primaryProfile} route.`,
    '',
    proof[0] ? `Closest relevant proof: ${proof[0].portfolioItem.projectName}.` : 'We can share the closest proof after a quick fit check.',
    '',
    'Open to discussing the scope?',
  ].join('\n');
}

function getApprovedProof(matches: PortfolioMatch[]): PortfolioMatch[] {
  return matches.filter((match) => match.portfolioItem.confidentiality !== 'private');
}

function summarizeNeed(lead: Lead): string {
  if (lead.serviceCategory !== 'unknown') return lead.serviceCategory.replace(/_/g, ' ');
  return lead.description.split(/[.!?]/)[0]?.toLowerCase() || 'the stated business requirement';
}

function getSubject(input: GenerateDraftInput, type: DraftType): string | undefined {
  if (type === 'linkedin_comment' || type === 'linkedin_dm') return undefined;
  if (type === 'partner_outreach') return 'Possible white-label delivery partnership';
  if (type === 'solution_led_outreach') return `Relevant solution idea for ${input.lead.companyName ?? 'your team'}`;
  return `Re: ${input.lead.title}`;
}

function buildAssumptions(input: GenerateDraftInput, proof: PortfolioMatch[]): string[] {
  const assumptions = [
    `Recommended profile is ${input.profileRecommendation.primaryProfile}.`,
    `Lead score is ${input.score.total}/100 with ${input.score.urgency} urgency.`,
  ];

  if (proof.length === 0) {
    assumptions.push('No public/anonymized portfolio proof was available, so draft avoids naming private proof.');
  }

  return assumptions;
}
