import type { Lead, PipelineStatus, PortfolioItem, ServiceCategory } from '@sales-automation/shared';

export type QualificationDecision = 'priority' | 'qualified' | 'human_review' | 'nurture' | 'reject';
export type GuidanceConfidence = 'high' | 'medium' | 'low';

export type ReplyClassification =
  | 'positive_interest'
  | 'meeting_request'
  | 'request_for_information'
  | 'pricing_or_budget_question'
  | 'technical_or_capability_question'
  | 'referral_to_another_person'
  | 'not_now'
  | 'existing_vendor_or_internal_team'
  | 'budget_objection'
  | 'not_relevant'
  | 'unsubscribe_or_stop'
  | 'automatic_reply_or_out_of_office'
  | 'bounce_or_delivery_failure'
  | 'ambiguous';

export interface QualificationDimensionScores {
  strategicServiceFit: number;
  verifiedDemandOrTrigger: number;
  buyerQualityAndAuthority: number;
  commercialCapacity: number;
  timingAndUrgency: number;
  portfolioAndProofMatch: number;
  contactQuality: number;
  personalisationDepth: number;
  partnershipPotential: number;
  riskAndCompliance: number;
}

export interface FirstOutreachGuidance {
  generatedAt: string;
  qualificationScore: number;
  decision: QualificationDecision;
  confidence: GuidanceConfidence;
  dimensionScores: QualificationDimensionScores;
  hardStops: string[];
  complianceWarnings: string[];
  researchGaps: string[];
  evidenceSummary: string;
  sourceLinks: string[];
  buyerHypothesis: string;
  likelyNeedHypothesis: string;
  recommendedService: ServiceCategory;
  recommendedProof: string;
  messageAngle: string;
  subjectOptions: string[];
  draft: string;
  followUpAngle: string;
  nextAction: string;
  requiresHumanReview: boolean;
}

export interface ReplyGuidance {
  generatedAt: string;
  classification: ReplyClassification;
  confidence: GuidanceConfidence;
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  urgency: 'high' | 'normal' | 'low';
  buyingSignalStrength: 'strong' | 'moderate' | 'weak' | 'none';
  positiveSignals: string[];
  negativeSignals: string[];
  explicitQuestions: string[];
  objections: string[];
  inferredIntent: string;
  recommendedPipelineStatus: PipelineStatus;
  recommendedNextAction: string;
  suggestedOwner: string;
  suggestedResponse: string;
  materialsToShare: string[];
  meetingAgenda: string[];
  followUpInstruction: string;
  requiresHumanApproval: boolean;
  riskNotes: string[];
}

export interface GuidanceOptions {
  excludedCountries?: string[];
  excludedIndustries?: string[];
  generatedAt?: string;
}

const DEFAULT_EXCLUDED_COUNTRIES = ['israel', 'india'];
const DEFAULT_EXCLUDED_INDUSTRIES = ['gambling', 'adult', 'cryptocurrency', 'crypto'];

const HIGH_AUTHORITY_ROLES = [
  'founder', 'co-founder', 'owner', 'chief', 'ceo', 'cto', 'cio', 'cmo', 'coo', 'vp', 'vice president',
  'head of', 'director', 'partner', 'procurement', 'product lead', 'engineering lead', 'marketing lead',
];

const COMMERCIAL_SIGNAL_TERMS = [
  'funding', 'funded', 'investment', 'revenue', 'enterprise client', 'government client', 'contract',
  'procurement', 'hiring', 'expansion', 'launch', 'partner program', 'partnership', 'paid product',
  'subscription', 'series a', 'series b', 'seed round', 'acquisition', 'growth', 'award',
];

const URGENCY_TERMS = [
  'urgent', 'immediate', 'asap', 'deadline', 'launch', 'this month', 'this quarter', 'hiring now',
  'seeking', 'looking for', 'request for proposal', 'rfp', 'tender', 'procurement', 'open role',
];

const PARTNERSHIP_TERMS = [
  'partner', 'white-label', 'white label', 'outsourcing', 'delivery partner', 'overflow', 'agency',
  'studio', 'consultancy', 'implementation partner', 'reseller', 'channel',
];

export function generateFirstOutreachGuidance(
  lead: Lead,
  portfolioItems: PortfolioItem[] = [],
  options: GuidanceOptions = {},
): FirstOutreachGuidance {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const text = leadText(lead);
  const hardStops: string[] = [];
  const warnings: string[] = [];
  const researchGaps: string[] = [];
  const excludedCountries = (options.excludedCountries ?? DEFAULT_EXCLUDED_COUNTRIES).map(normalize);
  const excludedIndustries = (options.excludedIndustries ?? DEFAULT_EXCLUDED_INDUSTRIES).map(normalize);
  const country = normalize(lead.country ?? lead.region ?? '');
  const industry = normalize(lead.industry ?? '');

  if (country && excludedCountries.some((item) => country.includes(item))) hardStops.push('Company geography is excluded from outreach.');
  if (industry && excludedIndustries.some((item) => industry.includes(item))) hardStops.push('Company industry is excluded from outreach.');
  if (!lead.companyWebsite) hardStops.push('Official company website is not verified.');
  if (!lead.contactEmail && !lead.contactFormUrl && !lead.linkedinUrl) hardStops.push('No legitimate business contact route is available.');
  if (!lead.evidenceSummary && !lead.evidenceUrl && !lead.sourceUrl) hardStops.push('Reason for outreach is not supported by retained evidence.');
  if (lead.serviceCategory === 'unknown') hardStops.push('No credible Codistan service match is confirmed.');

  if (!lead.country && !lead.region) researchGaps.push('Company country or primary operating market.');
  if (!lead.industry) researchGaps.push('Company industry.');
  if (!lead.contactName) researchGaps.push('Named decision-maker.');
  if (!lead.contactRole) researchGaps.push('Decision-maker role and authority.');
  if (!lead.contactEmail) researchGaps.push('Verified business email.');
  if (!lead.budgetSignal) researchGaps.push('Commercial capacity or budget signal.');
  if (!lead.timelineSignal && !lead.postedAt) researchGaps.push('Timing or urgency signal.');

  if (!country) warnings.push('Geography could not be fully validated.');
  if (!industry) warnings.push('Industry exclusion check is incomplete.');
  if (!lead.contactEmail) warnings.push('Use the official contact route; do not guess a personal email.');
  if (lead.confidence === 'low') warnings.push('Source confidence is low and requires manual validation.');

  const proofMatch = chooseProof(lead, portfolioItems);
  const dimensionScores: QualificationDimensionScores = {
    strategicServiceFit: scoreStrategicFit(lead),
    verifiedDemandOrTrigger: scoreDemand(lead),
    buyerQualityAndAuthority: scoreBuyer(lead),
    commercialCapacity: scoreCommercialCapacity(lead),
    timingAndUrgency: scoreTiming(lead),
    portfolioAndProofMatch: proofMatch.score,
    contactQuality: scoreContact(lead),
    personalisationDepth: scorePersonalisation(lead),
    partnershipPotential: scorePartnership(lead),
    riskAndCompliance: hardStops.length === 0 ? (warnings.length === 0 ? 5 : 3) : 0,
  };

  const qualificationScore = Object.values(dimensionScores).reduce((sum, value) => sum + value, 0);
  const decision = decideQualification(qualificationScore, hardStops);
  const confidence = decideConfidence(qualificationScore, hardStops, researchGaps);
  const observation = buildObservation(lead);
  const buyerHypothesis = buildBuyerHypothesis(lead);
  const likelyNeedHypothesis = buildNeedHypothesis(lead);
  const messageAngle = buildMessageAngle(lead);
  const subjectOptions = buildSubjectOptions(lead);
  const draft = buildFirstDraft(lead, observation, likelyNeedHypothesis, proofMatch.label);
  const requiresHumanReview = hardStops.length > 0 || decision === 'human_review' || decision === 'nurture' || decision === 'reject';

  return {
    generatedAt,
    qualificationScore,
    decision,
    confidence,
    dimensionScores,
    hardStops,
    complianceWarnings: warnings,
    researchGaps,
    evidenceSummary: lead.evidenceSummary ?? lead.description,
    sourceLinks: unique([lead.evidenceUrl, lead.sourceUrl, lead.companyWebsite].filter((value): value is string => Boolean(value))),
    buyerHypothesis,
    likelyNeedHypothesis,
    recommendedService: lead.serviceCategory,
    recommendedProof: proofMatch.label,
    messageAngle,
    subjectOptions,
    draft,
    followUpAngle: buildFollowUpAngle(lead, proofMatch.label),
    nextAction: buildQualificationNextAction(decision, hardStops, researchGaps),
    requiresHumanReview,
  };
}

export function analyzeInboundReply(
  lead: Lead,
  replyBody: string,
  options: GuidanceOptions = {},
): ReplyGuidance {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const reply = replyBody.trim();
  if (!reply) throw new Error('replyBody is required.');
  const normalized = normalize(reply);
  const flags = detectReplyFlags(normalized);
  const classification = classifyReply(flags);
  const explicitQuestions = extractQuestions(reply);
  const objections = detectObjections(normalized);
  const sentiment = classifySentiment(classification);
  const urgency = classifyUrgency(normalized, classification);
  const buyingSignalStrength = classifyBuyingSignal(classification, normalized);
  const positiveSignals = buildPositiveSignals(classification, normalized);
  const negativeSignals = buildNegativeSignals(classification, normalized);
  const riskNotes = buildRiskNotes(classification, normalized, flags);
  const requiresHumanApproval = requiresReplyApproval(classification, normalized, flags);
  const recommendedPipelineStatus = replyPipelineStatus(classification, lead.pipelineStatus);
  const suggestedOwner = lead.owner ?? 'Assign a lead owner before responding.';
  const materialsToShare = replyMaterials(classification, lead);
  const meetingAgenda = replyMeetingAgenda(classification, lead);

  return {
    generatedAt,
    classification,
    confidence: replyConfidence(classification, flags),
    summary: shorten(reply.replace(/\s+/g, ' '), 240),
    sentiment,
    urgency,
    buyingSignalStrength,
    positiveSignals,
    negativeSignals,
    explicitQuestions,
    objections,
    inferredIntent: inferReplyIntent(classification),
    recommendedPipelineStatus,
    recommendedNextAction: replyNextAction(classification),
    suggestedOwner,
    suggestedResponse: buildSuggestedReply(classification, lead, reply),
    materialsToShare,
    meetingAgenda,
    followUpInstruction: replyFollowUpInstruction(classification),
    requiresHumanApproval,
    riskNotes,
  };
}

export function formatFirstOutreachGuidance(guidance: FirstOutreachGuidance): string {
  return [
    `Decision: ${label(guidance.decision)} (${guidance.qualificationScore}/100, ${guidance.confidence} confidence)`,
    `Buyer hypothesis: ${guidance.buyerHypothesis}`,
    `Need hypothesis: ${guidance.likelyNeedHypothesis}`,
    `Angle: ${guidance.messageAngle}`,
    `Subjects: ${guidance.subjectOptions.join(' | ')}`,
    `Proof: ${guidance.recommendedProof}`,
    `Draft:\n${guidance.draft}`,
    `Next action: ${guidance.nextAction}`,
    guidance.hardStops.length ? `Hard stops: ${guidance.hardStops.join(' | ')}` : '',
    guidance.complianceWarnings.length ? `Warnings: ${guidance.complianceWarnings.join(' | ')}` : '',
    guidance.researchGaps.length ? `Research gaps: ${guidance.researchGaps.join(' | ')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function formatReplyGuidance(guidance: ReplyGuidance): string {
  return [
    `Classification: ${label(guidance.classification)} (${guidance.confidence} confidence)`,
    `Summary: ${guidance.summary}`,
    `Inferred intent: ${guidance.inferredIntent}`,
    `Next action: ${guidance.recommendedNextAction}`,
    `Pipeline: ${label(guidance.recommendedPipelineStatus)}`,
    `Human approval: ${guidance.requiresHumanApproval ? 'Required' : 'Recommended before sending'}`,
    guidance.explicitQuestions.length ? `Questions: ${guidance.explicitQuestions.join(' | ')}` : '',
    guidance.objections.length ? `Objections: ${guidance.objections.join(' | ')}` : '',
    guidance.materialsToShare.length ? `Share: ${guidance.materialsToShare.join(' | ')}` : '',
    guidance.meetingAgenda.length ? `Meeting agenda: ${guidance.meetingAgenda.join(' | ')}` : '',
    `Suggested response:\n${guidance.suggestedResponse}`,
    `Follow-up: ${guidance.followUpInstruction}`,
    guidance.riskNotes.length ? `Risk notes: ${guidance.riskNotes.join(' | ')}` : '',
  ].filter(Boolean).join('\n\n');
}

function scoreStrategicFit(lead: Lead): number {
  if (lead.serviceCategory === 'unknown') return 0;
  let score = 10;
  if (lead.serviceOffer) score += 5;
  if (lead.recommendedProfile && lead.recommendedProfile !== 'needs_human_review') score += 3;
  if (lead.recommendedPortfolioItemIds?.length) score += 2;
  return Math.min(score, 20);
}

function scoreDemand(lead: Lead): number {
  if (lead.opportunityStatus === 'live_opportunity') return 15;
  if (lead.opportunityStatus === 'recent_demand_signal') return 12;
  if (lead.opportunityStatus === 'partnership_target') return 8;
  return lead.evidenceSummary ? 5 : 0;
}

function scoreBuyer(lead: Lead): number {
  const role = normalize(lead.contactRole ?? '');
  if (!role) return lead.contactName ? 3 : 0;
  if (HIGH_AUTHORITY_ROLES.some((term) => role.includes(term))) return 10;
  if (/(manager|lead|senior|business development|partnerships|sales|product|engineering|marketing)/.test(role)) return 7;
  return 4;
}

function scoreCommercialCapacity(lead: Lead): number {
  const text = leadText(lead);
  let score = 0;
  if (lead.budgetSignal) score += 7;
  score += Math.min(8, COMMERCIAL_SIGNAL_TERMS.filter((term) => text.includes(term)).length * 2);
  return Math.min(score, 15);
}

function scoreTiming(lead: Lead): number {
  const text = leadText(lead);
  let score = lead.timelineSignal ? 5 : 0;
  if (lead.postedAt || lead.discoveredAt) score += 2;
  score += Math.min(3, URGENCY_TERMS.filter((term) => text.includes(term)).length);
  return Math.min(score, 10);
}

function scoreContact(lead: Lead): number {
  if (lead.contactEmail) return 5;
  if (lead.contactFormUrl) return 4;
  if (lead.linkedinUrl) return 3;
  return 0;
}

function scorePersonalisation(lead: Lead): number {
  if (lead.evidenceSummary && lead.companyName && lead.contactRole) return 5;
  if (lead.evidenceSummary && lead.companyName) return 4;
  if (lead.companyName) return 2;
  return 0;
}

function scorePartnership(lead: Lead): number {
  if (lead.opportunityStatus === 'partnership_target') return 5;
  const text = leadText(lead);
  return Math.min(5, PARTNERSHIP_TERMS.filter((term) => text.includes(term)).length * 2);
}

function chooseProof(lead: Lead, portfolioItems: PortfolioItem[]): { label: string; score: number } {
  const recommended = portfolioItems.find((item) => lead.recommendedPortfolioItemIds?.includes(item.id));
  const categoryMatch = portfolioItems.find((item) => item.serviceCategories.includes(lead.serviceCategory));
  const match = recommended ?? categoryMatch;
  if (match) return { label: `${match.projectName}: ${match.businessOutcome ?? match.problemSolved}`, score: 10 };
  if (lead.materialsToShare) return { label: lead.materialsToShare, score: 7 };
  if (lead.recommendedPortfolioItemIds?.length) return { label: 'Use the recommended approved portfolio item.', score: 6 };
  return { label: 'Select one approved case study directly relevant to the matched service.', score: 3 };
}

function decideQualification(score: number, hardStops: string[]): QualificationDecision {
  if (hardStops.length >= 2) return 'reject';
  if (hardStops.length === 1) return 'human_review';
  if (score >= 80) return 'priority';
  if (score >= 68) return 'qualified';
  if (score >= 55) return 'human_review';
  return 'nurture';
}

function decideConfidence(score: number, hardStops: string[], gaps: string[]): GuidanceConfidence {
  if (hardStops.length === 0 && score >= 80 && gaps.length <= 2) return 'high';
  if (hardStops.length <= 1 && score >= 55) return 'medium';
  return 'low';
}

function buildObservation(lead: Lead): string {
  const evidence = lead.evidenceSummary ?? lead.title ?? lead.description;
  return shorten(evidence.replace(/\s+/g, ' '), 180);
}

function buildBuyerHypothesis(lead: Lead): string {
  if (lead.contactName && lead.contactRole) return `${lead.contactName}, ${lead.contactRole}, is the likely initial owner or internal sponsor.`;
  if (lead.contactRole) return `A ${lead.contactRole} is the likely initial owner or internal sponsor.`;
  return 'The most relevant founder, department head, product, technology, marketing, or procurement owner should be identified.';
}

function buildNeedHypothesis(lead: Lead): string {
  const needs: Record<ServiceCategory, string> = {
    ai_automation: 'additional AI automation capacity, workflow integration, or production implementation support',
    rag_document_intelligence: 'secure document intelligence, knowledge retrieval, or RAG implementation support',
    ai_saas_mvp: 'a focused team to validate and build an AI-enabled SaaS product',
    fullstack_web_app: 'reliable full-stack product delivery or overflow engineering capacity',
    nextjs_python_app: 'specialist Next.js and Python product engineering capacity',
    voice_ai_agent: 'voice-AI design, integration, and production delivery support',
    ar_3d_unity_unreal: 'specialist Unity, Unreal, 3D, XR, or immersive-production capacity',
    cybersecurity_compliance: 'cybersecurity engineering, assurance, or compliance readiness support',
    website_portal: 'a stronger website, portal, content platform, or conversion-focused digital experience',
    enterprise_systems: 'enterprise application, integration, workflow, or platform-modernisation support',
    unknown: 'a clearly defined delivery requirement before outreach',
  };
  return `Based on the available signal, the company may benefit from ${needs[lead.serviceCategory]}. This is a hypothesis, not a confirmed requirement.`;
}

function buildMessageAngle(lead: Lead): string {
  if (lead.opportunityStatus === 'live_opportunity') return 'Direct response to the verified current requirement, using one precise capability and a low-risk next step.';
  if (lead.opportunityStatus === 'recent_demand_signal') return 'Connect the recent company signal to a plausible delivery need without claiming that the company is actively buying.';
  return 'Position Codistan as complementary, specialist, white-label, or overflow delivery capacity while protecting the prospect’s client relationship.';
}

function buildSubjectOptions(lead: Lead): string[] {
  const company = lead.companyName ?? 'your team';
  const service = shortServiceLabel(lead.serviceCategory);
  if (lead.opportunityStatus === 'partnership_target') {
    return [`${service} delivery support`, `Delivery capacity for ${company}`, `A potential delivery partnership`];
  }
  return [`${service} support for ${company}`, `A focused ${service} idea`, `${company} delivery support`];
}

function buildFirstDraft(lead: Lead, observation: string, needHypothesis: string, proof: string): string {
  const greeting = lead.contactName ? `Hi ${firstName(lead.contactName)},` : 'Hi there,';
  const company = lead.companyName ?? 'your team';
  const offer = serviceOfferSentence(lead.serviceCategory);
  const need = needHypothesis.replace(/^Based on the available signal, the company may benefit from /, '').replace(/\. This is a hypothesis, not a confirmed requirement\.$/, '');
  return [
    greeting,
    '',
    `I noticed ${lowercaseFirst(observation)}. That can create a need for ${need}.`,
    '',
    `${offer} For context, ${lowercaseFirst(shorten(proof, 150))}`,
    '',
    `Would it be useful if I sent two relevant examples and a short delivery approach for ${company}?`,
  ].join('\n');
}

function serviceOfferSentence(category: ServiceCategory): string {
  const offers: Record<ServiceCategory, string> = {
    ai_automation: 'Codistan can provide a focused AI automation and integration team without adding management overhead.',
    rag_document_intelligence: 'Codistan can provide a secure RAG and document-intelligence delivery team for a defined pilot or production rollout.',
    ai_saas_mvp: 'Codistan can provide a product pod to take an AI SaaS concept from validation through a production-ready MVP.',
    fullstack_web_app: 'Codistan can provide a dedicated full-stack delivery pod or targeted overflow capacity.',
    nextjs_python_app: 'Codistan can provide a focused Next.js and Python engineering pod for product delivery or overflow work.',
    voice_ai_agent: 'Codistan can provide a focused voice-AI product and integration team for a pilot or production workflow.',
    ar_3d_unity_unreal: 'Codistan can provide specialist Unity, Unreal, 3D, and immersive-production capacity under a defined or white-label engagement.',
    cybersecurity_compliance: 'Codistan can provide focused security engineering and compliance-readiness support around a defined control or assurance scope.',
    website_portal: 'Codistan can provide a focused design and engineering team for the website, portal, or conversion journey.',
    enterprise_systems: 'Codistan can provide an enterprise delivery team for the required application, integration, or workflow scope.',
    unknown: 'Codistan can explore a focused delivery approach once the requirement is clarified.',
  };
  return offers[category];
}

function buildFollowUpAngle(lead: Lead, proof: string): string {
  if (lead.opportunityStatus === 'partnership_target') return `Share one relevant proof point — ${shorten(proof, 120)} — and ask whether specialist or overflow capacity is occasionally useful.`;
  return `Share one relevant proof point — ${shorten(proof, 120)} — and ask one concrete question about scope, timing, or internal ownership.`;
}

function buildQualificationNextAction(decision: QualificationDecision, hardStops: string[], gaps: string[]): string {
  if (hardStops.length) return `Resolve the hard stop before outreach: ${hardStops[0]}`;
  if (decision === 'priority') return 'Prepare the message for the assigned sender and schedule it in the prospect’s local business hours.';
  if (decision === 'qualified') return gaps.length ? `Validate the remaining research gap before sending: ${gaps[0]}` : 'Prepare and schedule the first outreach.';
  if (decision === 'human_review') return 'Complete manual research and approve or reject the lead before sending.';
  return 'Keep the lead in nurture until a stronger trigger, buyer, or commercial signal appears.';
}

interface ReplyFlags {
  bounce: boolean;
  autoReply: boolean;
  unsubscribe: boolean;
  notRelevant: boolean;
  notNow: boolean;
  vendor: boolean;
  budgetObjection: boolean;
  meeting: boolean;
  pricing: boolean;
  technical: boolean;
  referral: boolean;
  information: boolean;
  positive: boolean;
  complaint: boolean;
}

function detectReplyFlags(text: string): ReplyFlags {
  return {
    bounce: includesAny(text, ['undeliverable', 'delivery has failed', 'delivery status notification', 'mailbox unavailable', 'user unknown', 'recipient rejected', '550 5.1.1']),
    autoReply: includesAny(text, ['out of office', 'automatic reply', 'auto reply', 'auto-reply', 'away from the office', 'on leave', 'vacation reply']),
    unsubscribe: includesAny(text, ['unsubscribe', 'remove me', 'stop emailing', 'do not contact', "don't contact", 'take me off your list']),
    notRelevant: includesAny(text, ['not interested', 'not relevant', 'no thanks', 'not a fit', 'we are not looking', 'please close this']),
    notNow: includesAny(text, ['not now', 'not at the moment', 'later this year', 'next quarter', 'circle back', 'revisit', 'reach out later', 'too early']),
    vendor: includesAny(text, ['already have a vendor', 'existing vendor', 'internal team', 'in-house team', 'in house team', 'current agency', 'already covered']),
    budgetObjection: includesAny(text, ['no budget', 'budget is tight', 'too expensive', "can't afford", 'cannot afford', 'outside our budget']),
    meeting: includesAny(text, ['book a call', 'schedule a call', 'set up a call', 'arrange a call', 'meeting', 'calendar link', "let's talk", 'lets talk', 'available to speak']),
    pricing: includesAny(text, ['pricing', 'price', 'cost', 'hourly rate', 'day rate', 'budget', 'quote', 'estimate']),
    technical: includesAny(text, ['tech stack', 'architecture', 'api', 'integration', 'security', 'compliance', 'data protection', 'hosting', 'deployment', 'experience with', 'can you build', 'can you integrate']),
    referral: includesAny(text, ['reach out to', 'speak with', 'speak to', 'best person is', 'contact my', "i've cc'd", 'i have cc’d', 'forwarded this to']),
    information: includesAny(text, ['send more', 'share more', 'more information', 'more details', 'portfolio', 'case study', 'case studies', 'capability deck', 'company profile', 'examples']),
    positive: includesAny(text, ['interested', 'sounds good', 'sounds useful', 'open to', 'tell me more', 'yes,', 'yes ', 'please send', 'worth discussing', 'happy to']),
    complaint: includesAny(text, ['spam', 'report', 'complaint', 'harassment', 'legal action', 'unacceptable']),
  };
}

function classifyReply(flags: ReplyFlags): ReplyClassification {
  if (flags.bounce) return 'bounce_or_delivery_failure';
  if (flags.autoReply) return 'automatic_reply_or_out_of_office';
  if (flags.unsubscribe) return 'unsubscribe_or_stop';
  if (flags.notRelevant) return 'not_relevant';
  if (flags.budgetObjection) return 'budget_objection';
  if (flags.vendor) return 'existing_vendor_or_internal_team';
  if (flags.notNow) return 'not_now';
  if (flags.referral) return 'referral_to_another_person';
  if (flags.meeting) return 'meeting_request';
  if (flags.pricing) return 'pricing_or_budget_question';
  if (flags.technical) return 'technical_or_capability_question';
  if (flags.information) return 'request_for_information';
  if (flags.positive) return 'positive_interest';
  return 'ambiguous';
}

function extractQuestions(reply: string): string[] {
  return unique(reply.split(/(?<=[?.!])\s+/).map((part) => part.trim()).filter((part) => part.endsWith('?'))).slice(0, 6);
}

function detectObjections(text: string): string[] {
  const objections: string[] = [];
  if (includesAny(text, ['no budget', 'budget is tight', 'too expensive', "can't afford", 'cannot afford'])) objections.push('Budget constraint.');
  if (includesAny(text, ['existing vendor', 'internal team', 'in-house', 'in house'])) objections.push('Existing delivery arrangement.');
  if (includesAny(text, ['not now', 'later', 'next quarter', 'revisit'])) objections.push('Timing constraint.');
  if (includesAny(text, ['not interested', 'not relevant', 'not a fit'])) objections.push('Fit or relevance objection.');
  return objections;
}

function classifySentiment(classification: ReplyClassification): 'positive' | 'neutral' | 'negative' {
  if (['positive_interest', 'meeting_request', 'request_for_information', 'pricing_or_budget_question', 'technical_or_capability_question', 'referral_to_another_person'].includes(classification)) return 'positive';
  if (['unsubscribe_or_stop', 'not_relevant', 'budget_objection'].includes(classification)) return 'negative';
  return 'neutral';
}

function classifyUrgency(text: string, classification: ReplyClassification): 'high' | 'normal' | 'low' {
  if (classification === 'meeting_request' || includesAny(text, ['urgent', 'today', 'tomorrow', 'this week', 'asap', 'immediately'])) return 'high';
  if (['not_now', 'automatic_reply_or_out_of_office', 'bounce_or_delivery_failure'].includes(classification)) return 'low';
  return 'normal';
}

function classifyBuyingSignal(classification: ReplyClassification, text: string): 'strong' | 'moderate' | 'weak' | 'none' {
  if (classification === 'meeting_request' || includesAny(text, ['proposal', 'scope', 'timeline', 'start date', 'budget approved'])) return 'strong';
  if (['positive_interest', 'pricing_or_budget_question', 'technical_or_capability_question', 'request_for_information'].includes(classification)) return 'moderate';
  if (['referral_to_another_person', 'not_now', 'existing_vendor_or_internal_team', 'ambiguous'].includes(classification)) return 'weak';
  return 'none';
}

function buildPositiveSignals(classification: ReplyClassification, text: string): string[] {
  const signals: string[] = [];
  if (['positive_interest', 'meeting_request', 'request_for_information', 'pricing_or_budget_question', 'technical_or_capability_question'].includes(classification)) signals.push('Prospect engaged with the outreach.');
  if (classification === 'meeting_request') signals.push('Prospect proposed or accepted a conversation.');
  if (includesAny(text, ['scope', 'timeline', 'budget', 'proposal', 'examples', 'case study'])) signals.push('Prospect requested buying-relevant information.');
  if (classification === 'referral_to_another_person') signals.push('Prospect provided a route to a potentially better contact.');
  return signals;
}

function buildNegativeSignals(classification: ReplyClassification, text: string): string[] {
  const signals: string[] = [];
  if (['not_relevant', 'unsubscribe_or_stop'].includes(classification)) signals.push('Prospect asked to close or stop the conversation.');
  if (classification === 'budget_objection') signals.push('Commercial constraint is explicit.');
  if (classification === 'existing_vendor_or_internal_team') signals.push('Current delivery arrangement reduces immediate need.');
  if (classification === 'bounce_or_delivery_failure') signals.push('The contact route is invalid or unavailable.');
  if (text.includes('spam')) signals.push('Complaint or sender-reputation risk is present.');
  return signals;
}

function buildRiskNotes(classification: ReplyClassification, text: string, flags: ReplyFlags): string[] {
  const risks: string[] = [];
  if (flags.pricing) risks.push('Do not invent pricing or commercial terms.');
  if (flags.technical) risks.push('Verify technical, security, compliance, and delivery claims before sending.');
  if (flags.complaint) risks.push('Escalate complaint or reputational risk immediately.');
  if (classification === 'unsubscribe_or_stop') risks.push('Suppress the recipient immediately and stop all follow-ups.');
  if (classification === 'bounce_or_delivery_failure') risks.push('Do not retry the same address until it is revalidated.');
  if (classification === 'ambiguous') risks.push('Intent is unclear; do not assume interest.');
  if (includesAny(text, ['contract', 'nda', 'legal', 'data processing agreement', 'dpa', 'sla'])) risks.push('Legal or contractual review is required.');
  return risks;
}

function requiresReplyApproval(classification: ReplyClassification, text: string, flags: ReplyFlags): boolean {
  if (['pricing_or_budget_question', 'technical_or_capability_question', 'budget_objection', 'ambiguous'].includes(classification)) return true;
  if (flags.complaint) return true;
  return includesAny(text, ['contract', 'nda', 'legal', 'compliance', 'security', 'discount', 'refund', 'guarantee', 'sla', 'data protection']);
}

function replyPipelineStatus(classification: ReplyClassification, existing: PipelineStatus): PipelineStatus {
  if (classification === 'meeting_request') return 'meeting_booked';
  if (classification === 'unsubscribe_or_stop' || classification === 'not_relevant') return 'archived';
  if (classification === 'bounce_or_delivery_failure' || classification === 'automatic_reply_or_out_of_office') return existing;
  return 'replied';
}

function replyNextAction(classification: ReplyClassification): string {
  const actions: Record<ReplyClassification, string> = {
    positive_interest: 'Answer the prospect’s immediate point and move toward a short discovery call or clearly defined next step.',
    meeting_request: 'Assigned owner should confirm a time and send a concise meeting agenda.',
    request_for_information: 'Send only the most relevant proof and ask one useful discovery question.',
    pricing_or_budget_question: 'Clarify scope before giving any estimate and obtain commercial approval.',
    technical_or_capability_question: 'Prepare a verified technical answer and involve the appropriate specialist.',
    referral_to_another_person: 'Thank the sender, request or use the introduction, and reassign the lead once confirmed.',
    not_now: 'Acknowledge the timing and ask permission to reconnect at a specific future period.',
    existing_vendor_or_internal_team: 'Respect the current setup and offer overflow or specialist support only when relevant.',
    budget_objection: 'Explore a smaller pilot or phased scope without automatically discounting.',
    not_relevant: 'Close politely and stop the sequence.',
    unsubscribe_or_stop: 'Suppress immediately and stop all outreach.',
    automatic_reply_or_out_of_office: 'Do not treat as engagement; reschedule using the return date when available.',
    bounce_or_delivery_failure: 'Mark the contact route invalid and research another legitimate route.',
    ambiguous: 'Ask one concise clarifying question and require human review.',
  };
  return actions[classification];
}

function buildSuggestedReply(classification: ReplyClassification, lead: Lead, reply: string): string {
  const greeting = lead.contactName ? `Hi ${firstName(lead.contactName)},` : 'Hi,';
  const proof = lead.materialsToShare ?? 'the most relevant approved examples';
  const service = shortServiceLabel(lead.serviceCategory);
  const replies: Record<ReplyClassification, string> = {
    positive_interest: `${greeting}\n\nThank you for getting back to me. Based on your note, the most useful next step would be to understand the immediate scope, timeline, and internal owner so we can keep the discussion focused. I can also share ${proof}.\n\nWould a brief 20-minute call work, or would you prefer to send the initial requirements by email?`,
    meeting_request: `${greeting}\n\nThank you — happy to arrange a brief call. We can keep it focused on your current objective, expected scope, timeline, and the most suitable delivery model.\n\nPlease share two suitable time options and your time zone, or send your calendar link, and I’ll coordinate accordingly.`,
    request_for_information: `${greeting}\n\nThank you. I’ll share ${proof} rather than a broad portfolio so the material stays relevant. To make sure I send the right examples, is your priority currently delivery capacity, a defined project, or a longer-term technology partner?`,
    pricing_or_budget_question: `${greeting}\n\nThank you for asking. Pricing depends mainly on the required scope, timeline, team composition, and whether this is a defined project or ongoing delivery support. Could you share the main deliverables, expected start window, and any budget range already approved? We can then respond with a focused commercial option.`,
    technical_or_capability_question: `${greeting}\n\nThank you for the specific question. We can address this properly, but I’d prefer to confirm the exact environment, integration points, scale, and security requirements before making a firm technical claim. Please share those details, and I’ll involve the most relevant technical lead in the response.`,
    referral_to_another_person: `${greeting}\n\nThank you for pointing me in the right direction. An introduction would be appreciated, or please share the person’s name and preferred contact route and I’ll keep the message concise and relevant.`,
    not_now: `${greeting}\n\nUnderstood, and thank you for the clarity. Would it be appropriate for me to reconnect in a later period? I’ll only follow up at the timing you confirm.`,
    existing_vendor_or_internal_team: `${greeting}\n\nUnderstood, and I appreciate the context. We would not look to disrupt an existing arrangement. Where useful, Codistan can support as specialist, overflow, or white-label delivery capacity for defined requirements. I’m happy to share one relevant example and leave it with you for future reference.`,
    budget_objection: `${greeting}\n\nThank you for being direct about the budget. Rather than forcing the original approach, we could consider a smaller pilot, a phased delivery plan, or a tightly defined specialist scope. Could you share the budget range and the one outcome that matters most?`,
    not_relevant: `${greeting}\n\nThank you for letting me know. I’ll close this out and won’t continue the sequence.\n\nBest regards,`,
    unsubscribe_or_stop: `${greeting}\n\nUnderstood. You have been removed from further outreach.`,
    automatic_reply_or_out_of_office: 'No reply should be sent automatically. Schedule the next action after the stated return date.',
    bounce_or_delivery_failure: 'Do not reply. Mark this address invalid and research another official contact route.',
    ambiguous: `${greeting}\n\nThank you for your reply. To make sure I respond appropriately, could you clarify whether you would like relevant examples, a brief call, or no further follow-up?`,
  };
  const response = replies[classification];
  return reply.length > 0 ? response : response;
}

function replyMaterials(classification: ReplyClassification, lead: Lead): string[] {
  if (!['positive_interest', 'request_for_information', 'technical_or_capability_question', 'meeting_request'].includes(classification)) return [];
  return [lead.materialsToShare ?? `One approved ${shortServiceLabel(lead.serviceCategory)} case study.`];
}

function replyMeetingAgenda(classification: ReplyClassification, lead: Lead): string[] {
  if (!['meeting_request', 'positive_interest'].includes(classification)) return [];
  return [
    'Current business objective and success criteria.',
    'Required scope, users, integrations, and constraints.',
    'Expected timeline and internal decision process.',
    `Best-fit ${shortServiceLabel(lead.serviceCategory)} delivery model.`,
    'Agreed next step and owner.',
  ];
}

function replyFollowUpInstruction(classification: ReplyClassification): string {
  const instructions: Record<ReplyClassification, string> = {
    positive_interest: 'Respond promptly during the prospect’s local business hours; follow up only against the agreed next step.',
    meeting_request: 'Confirm the meeting and stop the automated follow-up sequence.',
    request_for_information: 'Send the requested material and follow up in 3–4 business days if no next step was agreed.',
    pricing_or_budget_question: 'Do not follow up until the approved commercial response has been sent.',
    technical_or_capability_question: 'Do not follow up until the verified technical response has been sent.',
    referral_to_another_person: 'Contact the referred person only after the introduction or contact route is confirmed.',
    not_now: 'Schedule only the timing explicitly permitted by the prospect.',
    existing_vendor_or_internal_team: 'Move to low-frequency nurture unless the prospect requests more information.',
    budget_objection: 'Follow up only after an approved reduced or phased option is available.',
    not_relevant: 'Stop all follow-ups.',
    unsubscribe_or_stop: 'Stop all follow-ups and suppress immediately.',
    automatic_reply_or_out_of_office: 'Resume after the stated return date; do not count this as a reply.',
    bounce_or_delivery_failure: 'Stop sending to this address until a valid route is found.',
    ambiguous: 'Wait for human review and clarification before any further sequence step.',
  };
  return instructions[classification];
}

function inferReplyIntent(classification: ReplyClassification): string {
  const intent: Record<ReplyClassification, string> = {
    positive_interest: 'The prospect appears open to continuing the conversation.',
    meeting_request: 'The prospect appears ready to discuss the requirement live.',
    request_for_information: 'The prospect wants evidence or context before deciding on a conversation.',
    pricing_or_budget_question: 'The prospect is testing commercial fit, but scope may still be undefined.',
    technical_or_capability_question: 'The prospect is validating whether Codistan can meet a specific requirement.',
    referral_to_another_person: 'The current contact may not own the decision but is providing a route forward.',
    not_now: 'The issue is timing rather than necessarily fit.',
    existing_vendor_or_internal_team: 'Immediate need is reduced because delivery is already covered.',
    budget_objection: 'The current commercial shape may not fit available budget.',
    not_relevant: 'The prospect does not see a relevant need.',
    unsubscribe_or_stop: 'The prospect explicitly wants all outreach to stop.',
    automatic_reply_or_out_of_office: 'This is an automated operational response, not buyer intent.',
    bounce_or_delivery_failure: 'The email address is not currently deliverable.',
    ambiguous: 'The prospect’s intent cannot be determined confidently from the reply.',
  };
  return intent[classification];
}

function replyConfidence(classification: ReplyClassification, flags: ReplyFlags): GuidanceConfidence {
  const activeFlags = Object.values(flags).filter(Boolean).length;
  if (classification !== 'ambiguous' && activeFlags === 1) return 'high';
  if (classification !== 'ambiguous') return 'medium';
  return 'low';
}

function leadText(lead: Lead): string {
  return normalize([
    lead.title,
    lead.description,
    lead.companyName,
    lead.contactRole,
    lead.industry,
    lead.serviceOffer,
    lead.evidenceSummary,
    lead.budgetSignal,
    lead.timelineSignal,
    lead.materialsToShare,
  ].filter(Boolean).join(' '));
}

function shortServiceLabel(category: ServiceCategory): string {
  const labels: Record<ServiceCategory, string> = {
    ai_automation: 'AI automation',
    rag_document_intelligence: 'RAG and document intelligence',
    ai_saas_mvp: 'AI SaaS',
    fullstack_web_app: 'full-stack product',
    nextjs_python_app: 'Next.js and Python',
    voice_ai_agent: 'voice AI',
    ar_3d_unity_unreal: 'Unity, Unreal and 3D',
    cybersecurity_compliance: 'cybersecurity and compliance',
    website_portal: 'website and portal',
    enterprise_systems: 'enterprise systems',
    unknown: 'technology delivery',
  };
  return labels[category];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function shorten(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`;
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? value;
}

function lowercaseFirst(value: string): string {
  if (!value) return value;
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
