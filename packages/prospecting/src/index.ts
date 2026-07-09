import type { Lead, ServiceCategory } from '@sales-automation/shared';

export type PartnerTargetType =
  | 'software_agency'
  | 'digital_agency'
  | 'ai_consultant'
  | 'web_design_agency'
  | 'marketing_agency'
  | 'product_studio'
  | 'cybersecurity_consultant'
  | 'erp_crm_consultant'
  | 'other';

export type BuyingTrigger =
  | 'hiring_engineers'
  | 'client_delivery_overload'
  | 'ai_service_gap'
  | 'website_rebuild_need'
  | 'automation_need'
  | 'new_funding_or_growth'
  | 'agency_partnership_signal'
  | 'solution_specific_pain'
  | 'none';

export type SolutionCampaignId =
  | 'airline_refund_automation'
  | 'banking_private_intelligence'
  | 'enterprise_ai_automation'
  | 'b2b_website_intelligence';

export interface PartnerProspectInput {
  companyName: string;
  targetType: PartnerTargetType;
  country?: string;
  region?: string;
  companySize?: string;
  servicesOffered: string[];
  observedSignals: string[];
  buyingTriggers: BuyingTrigger[];
  contactName?: string;
  contactRole?: string;
  sourceUrl?: string;
  capturedAt: string;
}

export interface SolutionCampaign {
  id: SolutionCampaignId;
  name: string;
  serviceCategory: ServiceCategory;
  targetIndustries: string[];
  buyerRoles: string[];
  painSignals: string[];
  proofTags: string[];
  pitchAngle: string;
}

export interface SolutionProspectInput {
  campaignId: SolutionCampaignId;
  companyName: string;
  industry?: string;
  buyerRole?: string;
  country?: string;
  observedPainSignals: string[];
  sourceUrl?: string;
  capturedAt: string;
}

export interface ProspectScore {
  total: number;
  status: 'priority' | 'qualified' | 'nurture' | 'reject';
  urgency: 'urgent' | 'normal' | 'low';
  breakdown: {
    icpFit: number;
    triggerStrength: number;
    serviceGap: number;
    commercialPotential: number;
    proofFit: number;
  };
  reasons: string[];
  redFlags: string[];
  recommendedAngle: string;
  recommendedNextAction: string;
}

export const solutionCampaigns: SolutionCampaign[] = [
  {
    id: 'airline_refund_automation',
    name: 'Airline Refund Automation',
    serviceCategory: 'ai_automation',
    targetIndustries: ['airline', 'aviation', 'travel', 'ota', 'customer support'],
    buyerRoles: ['head of customer experience', 'operations director', 'digital transformation', 'cto', 'customer support head'],
    painSignals: ['refund backlog', 'claims delay', 'support overload', 'manual refund handling', 'chargeback volume'],
    proofTags: ['automation', 'workflow', 'customer support', 'ai', 'dashboard'],
    pitchAngle: 'Reduce manual refund workload and improve customer response time through AI-assisted workflow automation.',
  },
  {
    id: 'banking_private_intelligence',
    name: 'Banking Private Intelligence',
    serviceCategory: 'enterprise_systems',
    targetIndustries: ['banking', 'fintech', 'nbfc', 'risk', 'compliance', 'fraud'],
    buyerRoles: ['risk head', 'compliance head', 'fraud head', 'security head', 'cto', 'digital banking head'],
    painSignals: ['fraud investigation', 'risk intelligence', 'aml review', 'manual investigation', 'private intelligence'],
    proofTags: ['enterprise', 'compliance', 'security', 'ai', 'intelligence'],
    pitchAngle: 'Create a secure private intelligence layer for risk, fraud, compliance, and investigation workflows.',
  },
  {
    id: 'enterprise_ai_automation',
    name: 'Enterprise AI Automation',
    serviceCategory: 'ai_automation',
    targetIndustries: ['enterprise', 'saas', 'operations', 'support', 'finance', 'hr'],
    buyerRoles: ['founder', 'coo', 'cto', 'head of operations', 'digital transformation'],
    painSignals: ['manual workflows', 'document processing', 'internal support load', 'reporting delays', 'team bottleneck'],
    proofTags: ['ai', 'automation', 'rag', 'agent', 'workflow'],
    pitchAngle: 'Turn repeated internal work into human-approved AI workflows that reduce operational load.',
  },
  {
    id: 'b2b_website_intelligence',
    name: 'B2B Website Intelligence Layer',
    serviceCategory: 'website_portal',
    targetIndustries: ['b2b services', 'telecom', 'industrial', 'saas', 'consulting', 'agency'],
    buyerRoles: ['founder', 'head of sales', 'marketing director', 'growth lead', 'revenue operations'],
    painSignals: ['anonymous website traffic', 'low lead conversion', 'sales follow-up delay', 'crm gaps'],
    proofTags: ['website', 'crm', 'analytics', 'enrichment', 'automation'],
    pitchAngle: 'Add a compliant website intelligence layer that identifies high-intent accounts and routes human-approved follow-up.',
  },
];

export function scorePartnerProspect(input: PartnerProspectInput): ProspectScore {
  const reasons: string[] = [];
  const redFlags: string[] = [];

  const icpFit = scorePartnerIcpFit(input, reasons, redFlags);
  const triggerStrength = scoreTriggerStrength(input.buyingTriggers, input.observedSignals, reasons);
  const serviceGap = scoreServiceGap(input.servicesOffered, reasons);
  const commercialPotential = scoreCommercialPotential(input.companySize, input.country, reasons);
  const proofFit = scorePartnerProofFit(input.servicesOffered, input.observedSignals, reasons);
  const total = clampScore(icpFit + triggerStrength + serviceGap + commercialPotential + proofFit - redFlags.length * 10);

  return {
    total,
    status: getProspectStatus(total),
    urgency: getPartnerUrgency(total, input.buyingTriggers),
    breakdown: { icpFit, triggerStrength, serviceGap, commercialPotential, proofFit },
    reasons,
    redFlags,
    recommendedAngle: buildPartnerAngle(input),
    recommendedNextAction: total >= 80
      ? 'Prepare founder/BD-approved partner outreach with white-label delivery positioning.'
      : total >= 65
        ? 'Add to qualified partner nurture queue and collect stronger buying evidence.'
        : 'Do not interrupt sales team yet; keep as research/nurture only.',
  };
}

export function scoreSolutionProspect(input: SolutionProspectInput): ProspectScore {
  const campaign = getSolutionCampaign(input.campaignId);
  const reasons: string[] = [];
  const redFlags: string[] = [];

  const icpFit = scoreSolutionIcpFit(input, campaign, reasons, redFlags);
  const triggerStrength = scoreTriggerStrength(['solution_specific_pain'], input.observedPainSignals, reasons);
  const serviceGap = input.observedPainSignals.length > 0 ? 15 : 5;
  const commercialPotential = scoreSolutionCommercialPotential(input.buyerRole, reasons);
  const proofFit = scoreSolutionProofFit(input.observedPainSignals, campaign, reasons);
  const total = clampScore(icpFit + triggerStrength + serviceGap + commercialPotential + proofFit - redFlags.length * 10);

  return {
    total,
    status: getProspectStatus(total),
    urgency: total >= 85 && input.observedPainSignals.length > 0 ? 'urgent' : total >= 80 ? 'normal' : 'low',
    breakdown: { icpFit, triggerStrength, serviceGap, commercialPotential, proofFit },
    reasons,
    redFlags,
    recommendedAngle: campaign.pitchAngle,
    recommendedNextAction: total >= 80
      ? `Prepare human-approved solution-led outreach for ${campaign.name}.`
      : total >= 65
        ? 'Nurture until a stronger pain signal or buyer role is confirmed.'
        : 'Reject for active campaign outreach; keep only as low-priority research.',
  };
}

export function partnerProspectToLead(input: PartnerProspectInput, score = scorePartnerProspect(input)): Lead {
  return {
    id: stableId('partner', input.companyName, input.sourceUrl),
    source: 'partner_research',
    sourceUrl: input.sourceUrl,
    leadType: 'partner_prospect',
    title: `${input.companyName} — partner prospect`,
    description: [
      `Target type: ${input.targetType}.`,
      `Services: ${input.servicesOffered.join(', ') || 'unknown'}.`,
      `Signals: ${input.observedSignals.join('; ') || 'none'}.`,
      `Recommended angle: ${score.recommendedAngle}`,
    ].join('\n'),
    companyName: input.companyName,
    contactName: input.contactName,
    contactRole: input.contactRole,
    country: input.country,
    region: input.region,
    serviceCategory: inferPartnerServiceCategory(input),
    budgetSignal: score.total >= 80 ? 'High recurring partner potential' : undefined,
    timelineSignal: score.urgency === 'urgent' ? 'Direct buying/partner trigger detected' : undefined,
    capturedAt: input.capturedAt,
    rawPayload: input,
    pipelineStatus: score.status === 'reject' ? 'rejected' : 'new',
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt,
  };
}

export function solutionProspectToLead(input: SolutionProspectInput, score = scoreSolutionProspect(input)): Lead {
  const campaign = getSolutionCampaign(input.campaignId);
  return {
    id: stableId('solution', input.companyName, input.sourceUrl, input.campaignId),
    source: 'solution_campaign',
    sourceUrl: input.sourceUrl,
    leadType: 'solution_led_prospect',
    title: `${input.companyName} — ${campaign.name}`,
    description: [
      `Campaign: ${campaign.name}.`,
      `Industry: ${input.industry ?? 'unknown'}.`,
      `Buyer role: ${input.buyerRole ?? 'unknown'}.`,
      `Pain signals: ${input.observedPainSignals.join('; ') || 'none'}.`,
      `Recommended angle: ${score.recommendedAngle}`,
    ].join('\n'),
    companyName: input.companyName,
    contactRole: input.buyerRole,
    country: input.country,
    industry: input.industry,
    serviceCategory: campaign.serviceCategory,
    budgetSignal: score.total >= 80 ? 'Campaign-priority account' : undefined,
    timelineSignal: score.urgency === 'urgent' ? 'Strong buyer-fit pain signal detected' : undefined,
    capturedAt: input.capturedAt,
    rawPayload: input,
    pipelineStatus: score.status === 'reject' ? 'rejected' : 'new',
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt,
  };
}

export function getSolutionCampaign(id: SolutionCampaignId): SolutionCampaign {
  const campaign = solutionCampaigns.find((item) => item.id === id);
  if (!campaign) {
    throw new Error(`Unknown solution campaign: ${id}`);
  }
  return campaign;
}

function scorePartnerIcpFit(input: PartnerProspectInput, reasons: string[], redFlags: string[]): number {
  const highFitTypes: PartnerTargetType[] = ['software_agency', 'digital_agency', 'ai_consultant', 'product_studio', 'erp_crm_consultant'];
  if (highFitTypes.includes(input.targetType)) {
    reasons.push('Target type is a strong fit for white-label/offshore delivery partnership.');
    return 25;
  }
  if (input.targetType === 'marketing_agency' || input.targetType === 'web_design_agency') {
    reasons.push('Agency type may need technical delivery support.');
    return 18;
  }
  redFlags.push('Target type is not a clear Codistan partner ICP.');
  return 8;
}

function scoreTriggerStrength(triggers: BuyingTrigger[], observedSignals: string[], reasons: string[]): number {
  const strongTriggers = triggers.filter((trigger) => trigger !== 'none');
  if (strongTriggers.length >= 2) {
    reasons.push('Multiple buying/partnership triggers detected.');
    return 25;
  }
  if (strongTriggers.length === 1) {
    reasons.push(`Buying trigger detected: ${strongTriggers[0]}.`);
    return 18;
  }
  if (observedSignals.length >= 2) {
    reasons.push('Several soft signals detected but no direct trigger yet.');
    return 12;
  }
  return 5;
}

function scoreServiceGap(servicesOffered: string[], reasons: string[]): number {
  const text = servicesOffered.join(' ').toLowerCase();
  const hasAi = text.includes('ai') || text.includes('automation') || text.includes('rag');
  const hasDevelopment = text.includes('development') || text.includes('software') || text.includes('web') || text.includes('app');
  if (!hasAi && hasDevelopment) {
    reasons.push('Prospect offers development but may have an AI/automation delivery gap.');
    return 20;
  }
  if (!hasDevelopment) {
    reasons.push('Prospect may need a technical delivery partner.');
    return 16;
  }
  return 10;
}

function scoreCommercialPotential(companySize: string | undefined, country: string | undefined, reasons: string[]): number {
  const countryText = (country ?? '').toLowerCase();
  const preferredMarkets = ['united states', 'usa', 'uk', 'united kingdom', 'canada', 'australia', 'uae', 'saudi', 'qatar', 'europe'];
  let score = preferredMarkets.some((market) => countryText.includes(market)) ? 15 : 8;
  if (companySize && !companySize.includes('1-')) {
    score += 5;
    reasons.push('Company size suggests recurring work potential.');
  }
  if (score >= 15) reasons.push('Market/location suggests stronger commercial potential.');
  return Math.min(score, 20);
}

function scorePartnerProofFit(servicesOffered: string[], observedSignals: string[], reasons: string[]): number {
  const text = `${servicesOffered.join(' ')} ${observedSignals.join(' ')}`.toLowerCase();
  const proofWords = ['ai', 'automation', 'rag', 'saas', 'web', 'portal', 'cyber', '3d', 'ar', 'mobile', 'crm'];
  const matches = proofWords.filter((word) => text.includes(word));
  if (matches.length >= 3) {
    reasons.push(`Strong portfolio proof overlap: ${matches.slice(0, 4).join(', ')}.`);
    return 20;
  }
  if (matches.length > 0) {
    reasons.push(`Some portfolio proof overlap: ${matches.join(', ')}.`);
    return 12;
  }
  return 5;
}

function scoreSolutionIcpFit(input: SolutionProspectInput, campaign: SolutionCampaign, reasons: string[], redFlags: string[]): number {
  const industryText = (input.industry ?? '').toLowerCase();
  const roleText = (input.buyerRole ?? '').toLowerCase();
  const industryFit = campaign.targetIndustries.some((industry) => industryText.includes(industry));
  const roleFit = campaign.buyerRoles.some((role) => roleText.includes(role));

  if (industryFit && roleFit) {
    reasons.push('Industry and buyer role match campaign ICP.');
    return 30;
  }
  if (industryFit || roleFit) {
    reasons.push('Partial campaign ICP match detected.');
    return 20;
  }
  redFlags.push('Prospect does not clearly match campaign ICP yet.');
  return 8;
}

function scoreSolutionCommercialPotential(buyerRole: string | undefined, reasons: string[]): number {
  const text = (buyerRole ?? '').toLowerCase();
  const seniorWords = ['founder', 'chief', 'head', 'director', 'vp', 'cto', 'coo', 'lead'];
  if (seniorWords.some((word) => text.includes(word))) {
    reasons.push('Buyer role appears senior enough to influence budget.');
    return 20;
  }
  return 10;
}

function scoreSolutionProofFit(observedPainSignals: string[], campaign: SolutionCampaign, reasons: string[]): number {
  const text = observedPainSignals.join(' ').toLowerCase();
  const matches = campaign.painSignals.filter((signal) => text.includes(signal));
  if (matches.length >= 2) {
    reasons.push(`Strong campaign pain match: ${matches.join(', ')}.`);
    return 20;
  }
  if (matches.length === 1) {
    reasons.push(`Campaign pain match: ${matches[0]}.`);
    return 12;
  }
  return 5;
}

function getProspectStatus(total: number): ProspectScore['status'] {
  if (total >= 80) return 'priority';
  if (total >= 65) return 'qualified';
  if (total >= 50) return 'nurture';
  return 'reject';
}

function getPartnerUrgency(total: number, triggers: BuyingTrigger[]): ProspectScore['urgency'] {
  if (total >= 90 || triggers.includes('agency_partnership_signal') || triggers.includes('client_delivery_overload')) {
    return 'urgent';
  }
  if (total >= 80) return 'normal';
  return 'low';
}

function buildPartnerAngle(input: PartnerProspectInput): string {
  if (input.buyingTriggers.includes('client_delivery_overload')) {
    return 'Position Codistan as a quiet white-label delivery team that helps them handle overflow without hiring delays.';
  }
  if (input.buyingTriggers.includes('ai_service_gap')) {
    return 'Position Codistan as their AI/RAG/automation implementation partner while they keep the client relationship.';
  }
  return 'Position Codistan as a reliable offshore delivery partner for AI, web, software, automation, AR/3D, and cybersecurity work.';
}

function inferPartnerServiceCategory(input: PartnerProspectInput): ServiceCategory {
  const text = `${input.servicesOffered.join(' ')} ${input.observedSignals.join(' ')}`.toLowerCase();
  if (text.includes('ai') || text.includes('automation') || text.includes('rag')) return 'ai_automation';
  if (text.includes('3d') || text.includes('ar') || text.includes('unity') || text.includes('unreal')) return 'ar_3d_unity_unreal';
  if (text.includes('cyber') || text.includes('security') || text.includes('compliance')) return 'cybersecurity_compliance';
  if (text.includes('web') || text.includes('website')) return 'website_portal';
  return 'enterprise_systems';
}

function stableId(...parts: Array<string | undefined>): string {
  return parts
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
