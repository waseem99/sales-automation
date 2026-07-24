import type { Lead, ServiceCategory } from '@sales-automation/shared';

export const CAMPAIGN_ENGINE_VERSION = 'offer-campaign-engine.v1';

export type PortfolioState = 'active' | 'on_hold' | 'retired';
export type OfferType = 'product' | 'service' | 'hybrid';
export type DeliveryModel = 'saas' | 'white_label' | 'implementation' | 'managed_service' | 'team_overflow' | 'hybrid';
export type CampaignRoute = 'direct_buyer' | 'channel_partner' | 'delivery_partner' | 'referral_partner' | 'research_only';
export type CampaignSource = 'sales_navigator' | 'linkedin' | 'upwork' | 'manual' | 'public_web';
export type MatchDisposition = 'priority_a' | 'priority_b' | 'research' | 'reject';

export interface ProofReference {
  id: string;
  title: string;
  url?: string;
  serviceCategory?: ServiceCategory;
  approved: boolean;
  limitations?: string[];
}

export interface OfferDefinition {
  id: string;
  version: number;
  state: PortfolioState;
  name: string;
  owner: string;
  type: OfferType;
  problem: string;
  supportedOutcomes: string[];
  targetIndustries: string[];
  targetBusinessModels: string[];
  targetCompanySizes: string[];
  targetGeographies: string[];
  directBuyerPersonas: string[];
  channelPartnerPersonas: string[];
  deliveryModels: DeliveryModel[];
  serviceCategories: ServiceCategory[];
  qualificationRules: string[];
  disqualificationRules: string[];
  positioning: string[];
  proof: ProofReference[];
  limitations: string[];
  commercialModel?: string;
  approvedChannels: Array<'upwork' | 'linkedin' | 'sales_navigator' | 'email' | 'referral'>;
  humanReviewRequired: true;
  createdAt: string;
  updatedAt: string;
}

export interface RegisteredSearch {
  id: string;
  source: CampaignSource;
  url: string;
  label: string;
  state: 'active' | 'on_hold' | 'retired';
  cadenceMinutes?: number;
  maxRecords?: number;
  lastRunAt?: string;
  lastAcceptanceStatus?: 'not_run' | 'passed' | 'failed' | 'needs_review';
}

export interface CampaignDefinition {
  id: string;
  version: number;
  offerId: string;
  state: PortfolioState;
  name: string;
  route: CampaignRoute;
  owner: string;
  source: CampaignSource;
  targetIndustries: string[];
  targetCompanyTypes: string[];
  targetCompanySizes: string[];
  targetPersonas: string[];
  targetSeniority: string[];
  targetGeographies: string[];
  positiveTerms: string[];
  disqualifyingTerms: string[];
  serviceRoutes: string[];
  searchUrls: RegisteredSearch[];
  scheduleEnabled: boolean;
  defaultCadenceMinutes: number;
  perSearchMaxRecords: number;
  scorecard: {
    minimumPriorityAScore: number;
    minimumPriorityBScore: number;
    humanCommercialPassPercent: number;
    humanCommercialSampleSize: number;
  };
  firstTouchAngle: string;
  noBuyerIntentWarning: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignPortfolio {
  version: typeof CAMPAIGN_ENGINE_VERSION;
  offers: OfferDefinition[];
  campaigns: CampaignDefinition[];
}

export interface CampaignMatch {
  campaignId: string;
  campaignName: string;
  offerId: string;
  offerName: string;
  route: CampaignRoute;
  source: CampaignSource;
  score: number;
  disposition: MatchDisposition;
  positiveReasons: string[];
  missingEvidence: string[];
  risks: string[];
  inferredOpportunityHypothesis: string;
  explicitBuyerIntentConfirmed: boolean;
  recommendedPositioning: string[];
  recommendedProof: ProofReference[];
  nextResearchAction: string;
  humanReviewRequired: true;
  engineVersion: typeof CAMPAIGN_ENGINE_VERSION;
}

const CREATED_AT = '2026-07-24T00:00:00.000Z';

export const DEFAULT_OFFER_PORTFOLIO: OfferDefinition[] = [
  {
    id: 'fintech_operations_platform',
    version: 1,
    state: 'active',
    name: 'FinTech Backend Operations Platform',
    owner: 'Waseem',
    type: 'hybrid',
    problem: 'FinTech and financial-services teams often operate fragmented onboarding, servicing, reconciliation, case-management, integration and reporting workflows across disconnected systems.',
    supportedOutcomes: [
      'centralize backend operational workflows',
      'automate repetitive financial-operations processes',
      'integrate internal and third-party systems',
      'add AI-assisted operations with human controls',
      'provide managed implementation and ongoing delivery capacity',
    ],
    targetIndustries: ['fintech', 'payments', 'digital banking', 'wallet', 'lending', 'NBFC', 'microfinance', 'remittance', 'cross-border payments', 'financial infrastructure', 'regtech'],
    targetBusinessModels: ['B2B SaaS', 'B2C financial app', 'financial institution', 'payment processor', 'platform provider', 'system integrator'],
    targetCompanySizes: ['11-50', '51-200', '201-500', '501-1000', '1001-5000'],
    targetGeographies: [],
    directBuyerPersonas: ['Founder', 'Co-Founder', 'CEO', 'COO', 'CTO', 'CIO', 'CPO', 'VP Engineering', 'VP Product', 'Head of Operations', 'Head of Product', 'Head of Technology', 'Head of Platform', 'Head of Integrations', 'Head of Digital Transformation'],
    channelPartnerPersonas: ['Founder', 'Managing Director', 'Practice Head', 'Head of Partnerships', 'Strategic Partnerships', 'Solutions Director', 'Delivery Director', 'FinTech Practice Lead'],
    deliveryModels: ['saas', 'white_label', 'implementation', 'managed_service', 'hybrid'],
    serviceCategories: ['ai_automation', 'fullstack_web_app', 'outsourcing_partnership'],
    qualificationRules: [
      'account operates in a supported financial-services segment',
      'persona influences product, technology, operations, integration or partnerships',
      'evidence suggests fragmented operations, product scaling, implementation demand or partner distribution potential',
    ],
    disqualificationRules: [
      'consumer with no organizational buying role',
      'unsupported investment, lending or regulatory claim',
      'no identifiable company or permitted professional contact route',
    ],
    positioning: [
      'modular backend operations platform plus managed implementation',
      'AI-native operational assistance with auditable human controls',
      'white-label and partner-ready delivery where commercially appropriate',
    ],
    proof: [
      { id: 'acmetel-esim', title: 'Telecom/eSIM product and operations delivery', approved: true, serviceCategory: 'fullstack_web_app', limitations: ['Use only as product-delivery evidence; do not present it as a banking deployment.'] },
      { id: 'private-rag', title: 'Private RAG and workflow automation capability', approved: true, serviceCategory: 'ai_automation', limitations: ['Do not claim production financial-regulatory certification without evidence.'] },
    ],
    limitations: [
      'Do not claim the product is already deployed at a bank unless verified.',
      'Do not claim regulatory approval, guaranteed savings or autonomous financial decisions.',
      'Exact workflows, integrations, pricing and implementation scope require discovery.',
    ],
    commercialModel: 'SaaS, white-label, implementation, managed service or hybrid engagement subject to discovery.',
    approvedChannels: ['linkedin', 'sales_navigator', 'email', 'referral'],
    humanReviewRequired: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'managed_software_ai_delivery',
    version: 1,
    state: 'active',
    name: 'Managed Software and AI Delivery Partnership',
    owner: 'Waseem',
    type: 'service',
    problem: 'Agencies, consultancies and product companies often need dependable overflow engineering, AI, product, QA, DevOps and implementation capacity without building a permanent team for every workload peak.',
    supportedOutcomes: [
      'provide accountable white-label delivery capacity',
      'absorb overflow software and AI work',
      'extend product and implementation teams',
      'deliver managed pods rather than unowned individual resources',
      'support recurring agency or consultancy client work',
    ],
    targetIndustries: ['software agency', 'AI agency', 'digital agency', 'consultancy', 'system integrator', 'SaaS', 'product company', 'technology services'],
    targetBusinessModels: ['agency', 'consultancy', 'system integrator', 'product company', 'managed service provider'],
    targetCompanySizes: ['2-10', '11-50', '51-200', '201-500', '501-1000'],
    targetGeographies: [],
    directBuyerPersonas: ['Founder', 'Co-Founder', 'CEO', 'CTO', 'COO', 'VP Engineering', 'Head of Delivery', 'Delivery Director', 'Engineering Director', 'Operations Director'],
    channelPartnerPersonas: ['Founder', 'Managing Partner', 'Agency Owner', 'Head of Partnerships', 'Practice Lead', 'Client Services Director', 'Delivery Director'],
    deliveryModels: ['white_label', 'managed_service', 'team_overflow', 'hybrid'],
    serviceCategories: ['ai_automation', 'fullstack_web_app', 'outsourcing_partnership', 'cybersecurity', 'digital_marketing', 'creative_production'],
    qualificationRules: [
      'account delivers services or products requiring repeatable technical capacity',
      'persona influences delivery, engineering, operations, partnerships or resourcing',
      'evidence supports overflow, white-label, implementation or recurring project potential',
    ],
    disqualificationRules: [
      'individual job seeker or freelancer profile without an account-level opportunity',
      'anonymous Upwork buyer without defensible company identity',
      'request requires prohibited circumvention or deceptive representation',
    ],
    positioning: [
      'managed delivery partner that owns outcomes, not merely CV supply',
      'Pakistan-based cost advantage with accountable project and quality management',
      'flexible software, AI, cybersecurity, creative and growth delivery lanes',
    ],
    proof: [
      { id: 'acmetel-product', title: 'Complex telecom product delivery', approved: true, serviceCategory: 'fullstack_web_app' },
      { id: 'secp-ux', title: 'Enterprise discovery, UX and prototype delivery', approved: true, serviceCategory: 'fullstack_web_app' },
      { id: 'iso-security', title: 'Security and compliance delivery capability', approved: true, serviceCategory: 'cybersecurity', limitations: ['Use only when the campaign and prospect need security delivery.'] },
    ],
    limitations: [
      'Do not promise unlimited capacity or immediate start without resource confirmation.',
      'Do not present an inferred agency pain as a confirmed problem.',
      'Commercial terms and white-label boundaries require human approval.',
    ],
    commercialModel: 'Managed pod, project, retainer, white-label or dedicated-team engagement.',
    approvedChannels: ['upwork', 'linkedin', 'sales_navigator', 'email', 'referral'],
    humanReviewRequired: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
];

export const DEFAULT_CAMPAIGN_PORTFOLIO: CampaignDefinition[] = [
  campaign({
    id: 'fintech_direct_buyers',
    offerId: 'fintech_operations_platform',
    name: 'FinTech Platform — Direct Buyers',
    route: 'direct_buyer',
    targetCompanyTypes: ['fintech', 'payments', 'bank', 'wallet', 'lender', 'NBFC', 'remittance', 'financial infrastructure'],
    targetPersonas: ['Founder', 'CEO', 'COO', 'CTO', 'CIO', 'CPO', 'VP Engineering', 'VP Product', 'Head of Operations', 'Head of Product', 'Head of Technology', 'Head of Platform', 'Head of Integrations', 'Head of Digital Transformation'],
    positiveTerms: ['operations', 'workflow', 'automation', 'integration', 'platform', 'scaling', 'digital transformation', 'AI', 'reconciliation', 'onboarding'],
    firstTouchAngle: 'Explore whether a modular backend-operations and managed implementation layer can reduce fragmentation or accelerate the account’s current product and operations roadmap.',
  }),
  campaign({
    id: 'fintech_channel_partners',
    offerId: 'fintech_operations_platform',
    name: 'FinTech Platform — Channel and Implementation Partners',
    route: 'channel_partner',
    targetCompanyTypes: ['consultancy', 'system integrator', 'software agency', 'fintech consultancy', 'implementation partner'],
    targetPersonas: ['Founder', 'Managing Director', 'Practice Head', 'Head of Partnerships', 'Strategic Partnerships', 'Solutions Director', 'Delivery Director', 'FinTech Practice Lead'],
    positiveTerms: ['client delivery', 'implementation', 'advisory', 'integration', 'financial services practice', 'partner ecosystem', 'white label'],
    firstTouchAngle: 'Explore a channel, implementation or white-label relationship in which the partner can bring a backend-operations and AI-native financial-services solution to its own clients.',
  }),
  campaign({
    id: 'software_ai_overflow_partners',
    offerId: 'managed_software_ai_delivery',
    name: 'Software and AI Agencies — Overflow Delivery Partners',
    route: 'delivery_partner',
    targetCompanyTypes: ['software agency', 'AI agency', 'digital agency', 'consultancy', 'system integrator', 'SaaS company'],
    targetPersonas: ['Founder', 'Agency Owner', 'CEO', 'CTO', 'COO', 'Head of Delivery', 'Delivery Director', 'Engineering Director', 'Practice Lead', 'Head of Partnerships'],
    positiveTerms: ['client work', 'delivery', 'overflow', 'white label', 'implementation', 'engineering capacity', 'AI projects', 'managed team', 'subcontracting'],
    firstTouchAngle: 'Explore whether Codistan can become an accountable backend delivery team for overflow software, AI or implementation work while the partner retains its client relationship.',
  }),
];

export const DEFAULT_PORTFOLIO: CampaignPortfolio = {
  version: CAMPAIGN_ENGINE_VERSION,
  offers: DEFAULT_OFFER_PORTFOLIO,
  campaigns: DEFAULT_CAMPAIGN_PORTFOLIO,
};

export function validatePortfolio(portfolio: CampaignPortfolio): string[] {
  const errors: string[] = [];
  if (portfolio.version !== CAMPAIGN_ENGINE_VERSION) errors.push('Unsupported campaign-engine version.');
  const offerIds = new Set<string>();
  for (const offer of portfolio.offers) {
    if (!offer.id || offerIds.has(offer.id)) errors.push(`Duplicate or missing offer ID: ${offer.id || '(blank)'}`);
    offerIds.add(offer.id);
    if (!offer.name || !offer.owner || !offer.problem) errors.push(`Offer ${offer.id} is missing required commercial fields.`);
    if (offer.state === 'active' && offer.serviceCategories.length === 0) errors.push(`Active offer ${offer.id} has no service categories.`);
    if (!offer.humanReviewRequired) errors.push(`Offer ${offer.id} must require human review.`);
    if (offer.proof.some((proof) => !proof.approved)) errors.push(`Offer ${offer.id} contains unapproved proof.`);
  }
  const campaignIds = new Set<string>();
  for (const item of portfolio.campaigns) {
    if (!item.id || campaignIds.has(item.id)) errors.push(`Duplicate or missing campaign ID: ${item.id || '(blank)'}`);
    campaignIds.add(item.id);
    if (!offerIds.has(item.offerId)) errors.push(`Campaign ${item.id} references missing offer ${item.offerId}.`);
    const offer = portfolio.offers.find((candidate) => candidate.id === item.offerId);
    if (item.state === 'active' && offer?.state !== 'active') errors.push(`Active campaign ${item.id} cannot use non-active offer ${item.offerId}.`);
    if (item.route !== 'research_only' && item.targetPersonas.length === 0) errors.push(`Campaign ${item.id} has no target personas.`);
    if (!item.noBuyerIntentWarning) errors.push(`Campaign ${item.id} must retain the no-buyer-intent warning.`);
    if (item.searchUrls.some((search) => search.state === 'active' && search.source !== item.source)) errors.push(`Campaign ${item.id} contains a search for a different source.`);
  }
  return errors;
}

export function matchLeadToCampaigns(
  lead: Lead,
  portfolio: CampaignPortfolio = DEFAULT_PORTFOLIO,
): CampaignMatch[] {
  const validation = validatePortfolio(portfolio);
  if (validation.length > 0) throw new Error(`Invalid campaign portfolio: ${validation.join(' ')}`);
  return portfolio.campaigns
    .filter((item) => item.state === 'active' && sourceCompatible(lead.source, item.source))
    .map((item) => matchCampaign(lead, item, portfolio.offers.find((offer) => offer.id === item.offerId)!))
    .filter((item) => item.disposition !== 'reject')
    .sort((left, right) => right.score - left.score);
}

export function attachCampaignMatches(lead: Lead, matches: CampaignMatch[]): Lead {
  const raw = asRecord(lead.rawPayload);
  return {
    ...lead,
    rawPayload: {
      ...raw,
      campaignEngineVersion: CAMPAIGN_ENGINE_VERSION,
      campaignMatches: matches,
      primaryCampaignMatch: matches[0] ?? null,
    },
  };
}

export function migrateLegacySalesNavigatorCampaign(input: Record<string, unknown>): CampaignDefinition {
  const legacyId = stringValue(input.id) || 'fintech_backend_operations';
  const mappedId = legacyId === 'fintech_backend_operations' ? 'fintech_direct_buyers' : normalizeId(legacyId);
  return campaign({
    id: mappedId,
    offerId: stringValue(input.offer_id) || 'fintech_operations_platform',
    name: stringValue(input.name) || 'Imported Sales Navigator Campaign',
    route: routeValue(input.route) || (mappedId.includes('partner') ? 'channel_partner' : 'direct_buyer'),
    targetIndustries: stringList(input.target_industry_terms),
    targetCompanyTypes: stringList(input.target_company_types).length ? stringList(input.target_company_types) : stringList(input.target_industry_terms),
    targetPersonas: stringList(input.target_personas),
    targetGeographies: stringList(input.target_geographies),
    serviceRoutes: stringList(input.service_lanes),
    searchUrls: stringList(input.search_urls).map((url, index) => ({
      id: `${mappedId}:legacy:${index + 1}`,
      source: 'sales_navigator',
      url,
      label: `Migrated search ${index + 1}`,
      state: input.enabled === false ? 'on_hold' : 'active',
      lastAcceptanceStatus: 'needs_review',
    })),
    state: input.enabled === false ? 'on_hold' : 'active',
    firstTouchAngle: stringValue(input.offer_summary) || 'Review the imported campaign and define a route-specific first-touch angle.',
  });
}

function matchCampaign(lead: Lead, campaignDefinition: CampaignDefinition, offer: OfferDefinition): CampaignMatch {
  const text = normalize(`${lead.companyName ?? ''} ${lead.industry ?? ''} ${lead.contactRole ?? ''} ${lead.title} ${lead.description}`);
  const positiveReasons: string[] = [];
  const missingEvidence: string[] = [];
  const risks: string[] = [];
  let score = 0;

  const industryMatches = matchingTerms(text, campaignDefinition.targetIndustries.length ? campaignDefinition.targetIndustries : offer.targetIndustries);
  if (industryMatches.length) {
    score += Math.min(20, industryMatches.length * 5);
    positiveReasons.push(`Industry/account terms matched: ${industryMatches.join(', ')}.`);
  } else missingEvidence.push('No target-industry evidence is confirmed.');

  const companyMatches = matchingTerms(text, campaignDefinition.targetCompanyTypes);
  if (companyMatches.length) {
    score += Math.min(20, companyMatches.length * 7);
    positiveReasons.push(`Account-type terms matched: ${companyMatches.join(', ')}.`);
  } else missingEvidence.push('Target account type requires confirmation.');

  const personaMatches = matchingTerms(normalize(lead.contactRole ?? ''), campaignDefinition.targetPersonas);
  if (personaMatches.length) {
    score += 25;
    positiveReasons.push(`Target persona matched: ${personaMatches.join(', ')}.`);
  } else missingEvidence.push('Decision-maker persona or current role is incomplete.');

  const positiveTerms = matchingTerms(text, campaignDefinition.positiveTerms);
  if (positiveTerms.length) {
    score += Math.min(20, positiveTerms.length * 4);
    positiveReasons.push(`Relevant operational/delivery signals: ${positiveTerms.join(', ')}.`);
  }

  if (lead.country || lead.region) score += 5;
  else missingEvidence.push('Geography is not confirmed.');

  if (lead.linkedinUrl || lead.contactEmail || lead.contactFormUrl || lead.source === 'upwork') score += 10;
  else missingEvidence.push('No permitted contact route is confirmed.');

  const disqualifiers = matchingTerms(text, campaignDefinition.disqualifyingTerms);
  if (disqualifiers.length) {
    score -= 60;
    risks.push(`Disqualifying terms matched: ${disqualifiers.join(', ')}.`);
  }

  const explicitBuyerIntentConfirmed = lead.opportunityStatus === 'live_opportunity'
    || lead.prospectStage === 'warm_lead'
    || lead.source === 'upwork';
  if (explicitBuyerIntentConfirmed) positiveReasons.push('A separate warm-demand record exists; campaign fit remains distinct from the live opportunity.');
  else risks.push(campaignDefinition.noBuyerIntentWarning);

  const disposition: MatchDisposition = score >= campaignDefinition.scorecard.minimumPriorityAScore
    ? 'priority_a'
    : score >= campaignDefinition.scorecard.minimumPriorityBScore
      ? 'priority_b'
      : score >= 20
        ? 'research'
        : 'reject';

  return {
    campaignId: campaignDefinition.id,
    campaignName: campaignDefinition.name,
    offerId: offer.id,
    offerName: offer.name,
    route: campaignDefinition.route,
    source: campaignDefinition.source,
    score: Math.max(0, Math.min(100, score)),
    disposition,
    positiveReasons,
    missingEvidence,
    risks,
    inferredOpportunityHypothesis: explicitBuyerIntentConfirmed
      ? `The account has separate warm evidence and may also fit the ${campaignDefinition.route.replaceAll('_', ' ')} route for ${offer.name}. Validate the relationship before combining outreach.`
      : `This is an ICP-based hypothesis that the account may fit the ${campaignDefinition.route.replaceAll('_', ' ')} route for ${offer.name}; no buying intent is confirmed.`,
    explicitBuyerIntentConfirmed,
    recommendedPositioning: offer.positioning,
    recommendedProof: offer.proof.filter((proof) => proof.approved && (!proof.serviceCategory || offer.serviceCategories.includes(proof.serviceCategory))),
    nextResearchAction: missingEvidence[0] ?? (explicitBuyerIntentConfirmed ? 'Review the warm opportunity and account history before choosing one coordinated action.' : 'Confirm a current trigger, decision-maker authority and permitted contact path.'),
    humanReviewRequired: true,
    engineVersion: CAMPAIGN_ENGINE_VERSION,
  };
}

function campaign(input: Partial<CampaignDefinition> & Pick<CampaignDefinition, 'id' | 'offerId' | 'name' | 'route'>): CampaignDefinition {
  return {
    id: normalizeId(input.id),
    version: input.version ?? 1,
    offerId: normalizeId(input.offerId),
    state: input.state ?? 'active',
    name: input.name,
    route: input.route,
    owner: input.owner ?? 'Waseem',
    source: input.source ?? 'sales_navigator',
    targetIndustries: input.targetIndustries ?? [],
    targetCompanyTypes: input.targetCompanyTypes ?? [],
    targetCompanySizes: input.targetCompanySizes ?? [],
    targetPersonas: input.targetPersonas ?? [],
    targetSeniority: input.targetSeniority ?? ['Owner', 'CXO', 'VP', 'Director', 'Head'],
    targetGeographies: input.targetGeographies ?? [],
    positiveTerms: input.positiveTerms ?? [],
    disqualifyingTerms: input.disqualifyingTerms ?? ['job seeker', 'open to work', 'student project', 'unpaid test'],
    serviceRoutes: input.serviceRoutes ?? [],
    searchUrls: input.searchUrls ?? [],
    scheduleEnabled: input.scheduleEnabled ?? false,
    defaultCadenceMinutes: input.defaultCadenceMinutes ?? 12 * 60,
    perSearchMaxRecords: input.perSearchMaxRecords ?? 30,
    scorecard: input.scorecard ?? {
      minimumPriorityAScore: 65,
      minimumPriorityBScore: 45,
      humanCommercialPassPercent: 60,
      humanCommercialSampleSize: 15,
    },
    firstTouchAngle: input.firstTouchAngle ?? '',
    noBuyerIntentWarning: input.noBuyerIntentWarning ?? 'This is a cold ICP match. No explicit buying intent has been established.',
    createdAt: input.createdAt ?? CREATED_AT,
    updatedAt: input.updatedAt ?? CREATED_AT,
  };
}

function sourceCompatible(leadSource: Lead['source'], campaignSource: CampaignSource): boolean {
  if (campaignSource === 'sales_navigator') return leadSource === 'sales_navigator';
  if (campaignSource === 'linkedin') return leadSource === 'linkedin';
  if (campaignSource === 'upwork') return leadSource === 'upwork';
  return campaignSource === 'manual' || campaignSource === 'public_web';
}

function matchingTerms(text: string, terms: string[]): string[] {
  return terms.filter((term) => text.includes(normalize(term))).slice(0, 8);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  if (typeof value === 'string') return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
  return [];
}

function routeValue(value: unknown): CampaignRoute | undefined {
  return ['direct_buyer', 'channel_partner', 'delivery_partner', 'referral_partner', 'research_only'].includes(String(value))
    ? String(value) as CampaignRoute
    : undefined;
}
