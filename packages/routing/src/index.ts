import type {
  CodistanProfile,
  Lead,
  LeadScore,
  ProfileCapability,
  ServiceCategory,
} from '@sales-automation/shared';
import { selectSuppliedUpworkProfile } from './profile-selection.js';
import type { SelectedUpworkProfile } from './upwork-profiles.js';

export * from './upwork-profiles.js';

export interface ProfileRecommendation {
  primaryProfile: CodistanProfile;
  secondaryProfiles: CodistanProfile[];
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  risks: string[];
  upworkProfile?: SelectedUpworkProfile;
}

export const profileCapabilities: ProfileCapability[] = [
  {
    profile: 'us_ai_fullstack_profile',
    label: 'US AI / Full-stack Profile',
    serviceCategories: ['ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'fullstack_web_app', 'nextjs_python_app', 'voice_ai_agent'],
    proofTags: ['ai', 'rag', 'llm', 'automation', 'nextjs', 'python', 'saas', 'mvp', 'agent'],
    geographyNotes: 'Use only where profile usage and geography requirements are compliant.',
    complianceNotes: 'Keep behind human verification until the live public profile and Upwork verification are confirmed.',
    bestUseCases: ['Full-stack AI apps', 'SaaS MVPs', 'Next.js/Python applications', 'AI-enabled web products'],
  },
  {
    profile: 'waseem_ai_founder_profile',
    label: 'Waseem AI / Founder-led Profile',
    serviceCategories: ['ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'enterprise_systems', 'nextjs_python_app', 'voice_ai_agent'],
    proofTags: ['ai strategy', 'automation', 'rag', 'founder-led', 'consulting', 'enterprise', 'machine learning', 'computer vision'],
    bestUseCases: ['AI/ML implementation', 'RAG/document intelligence', 'Founder-led discovery', 'AI strategy conversations', 'Complex scoping'],
  },
  {
    profile: 'ar_3d_animation_profile',
    label: 'AR / 3D / Animation Profiles',
    serviceCategories: ['ar_3d_unity_unreal'],
    proofTags: ['ar', '3d', 'unity', 'unreal', 'webar', 'animation', 'product visualization'],
    bestUseCases: ['AR apps', '3D product visualization', 'Unity/Unreal work', 'Motion/animation opportunities'],
  },
  {
    profile: 'cybersecurity_compliance_profile',
    label: 'Cybersecurity / Compliance Profile',
    serviceCategories: ['cybersecurity_compliance', 'enterprise_systems'],
    proofTags: ['cybersecurity', 'compliance', 'soc2', 'hipaa', 'iso27001', 'security review', 'secure architecture'],
    bestUseCases: ['Security reviews', 'Compliance-heavy apps', 'Secure AI systems', 'Regulated-industry software'],
  },
  {
    profile: 'codistan_partner_identity',
    label: 'Codistan Partner Identity',
    serviceCategories: ['ai_automation', 'fullstack_web_app', 'website_portal', 'enterprise_systems', 'ar_3d_unity_unreal', 'cybersecurity_compliance'],
    proofTags: ['white-label', 'outsourcing', 'delivery partner', 'agency partner', 'team extension'],
    bestUseCases: ['Agency partnerships', 'White-label delivery', 'Outsourced development partner conversations'],
  },
  {
    profile: 'solution_campaign_identity',
    label: 'Solution Campaign Identity',
    serviceCategories: ['ai_automation', 'enterprise_systems', 'rag_document_intelligence'],
    proofTags: ['airline refund automation', 'private intelligence', 'banking intelligence', 'enterprise automation'],
    bestUseCases: ['Airline refund automation outreach', 'Banking/private intelligence outreach', 'Specific solution-led campaigns'],
  },
];

export function recommendProfile(lead: Lead, score?: LeadScore): ProfileRecommendation {
  const reasons: string[] = [];
  const risks: string[] = [];

  if (score?.redFlags.some((flag) => flag.severity === 'critical')) {
    return {
      primaryProfile: 'needs_human_review',
      secondaryProfiles: [],
      confidence: 'low',
      reasons: ['Critical red flag detected; profile should not be selected automatically.'],
      risks: score.redFlags.map((flag) => flag.reason),
    };
  }

  if (lead.leadType === 'partner_prospect') {
    reasons.push('Lead is a partner/outsourcing prospect, so the Codistan partner identity is the safest primary route.');
    return withSecondaryProfiles('codistan_partner_identity', lead, reasons, risks);
  }

  if (lead.leadType === 'solution_led_prospect') {
    reasons.push('Lead is attached to a specific solution-led campaign.');
    return withSecondaryProfiles('solution_campaign_identity', lead, reasons, risks);
  }

  const suppliedProfile = selectSuppliedUpworkProfile(lead, score);
  if (suppliedProfile) {
    const primaryProfile = suppliedProfile.forceHumanReview
      ? 'needs_human_review'
      : suppliedProfile.primaryProfile;
    return {
      primaryProfile,
      secondaryProfiles: getSecondaryProfiles(lead, primaryProfile),
      confidence: suppliedProfile.confidence,
      reasons: suppliedProfile.reasons,
      risks: suppliedProfile.risks,
      upworkProfile: suppliedProfile.upworkProfile,
    };
  }

  if (lead.serviceCategory === 'ar_3d_unity_unreal') {
    reasons.push('Opportunity is AR/3D/Unity/Unreal related, but the supplied profile subtype is unclear.');
    risks.push('Confirm whether the job is immersive development or visual production before spending Connects.');
    return withSecondaryProfiles('needs_human_review', lead, reasons, risks);
  }

  if (lead.serviceCategory === 'cybersecurity_compliance') {
    reasons.push('Opportunity is cybersecurity or compliance-heavy.');
    return withSecondaryProfiles('cybersecurity_compliance_profile', lead, reasons, risks);
  }

  if (isFounderLedBetter(lead)) {
    reasons.push('Lead likely needs consultative/founder-led positioning rather than a pure developer pitch.');
    return withSecondaryProfiles('waseem_ai_founder_profile', lead, reasons, risks);
  }

  if (isAiFullstack(lead.serviceCategory)) {
    reasons.push('Lead matches AI/full-stack delivery categories.');
    if (hasUsOnlyAmbiguity(lead)) {
      risks.push('US-only or US-preferred wording requires human compliance review before selecting a profile.');
      return withSecondaryProfiles('needs_human_review', lead, reasons, risks);
    }
    return withSecondaryProfiles('us_ai_fullstack_profile', lead, reasons, risks);
  }

  if (lead.serviceCategory === 'website_portal') {
    reasons.push('Lead is website/portal related; Codistan partner/company identity may be safer than a specialized AI profile.');
    return withSecondaryProfiles('codistan_partner_identity', lead, reasons, risks);
  }

  reasons.push('No strong automatic match found; human review is recommended.');
  return {
    primaryProfile: 'needs_human_review',
    secondaryProfiles: getSecondaryProfiles(lead, 'needs_human_review'),
    confidence: 'low',
    reasons,
    risks,
  };
}

function withSecondaryProfiles(
  primaryProfile: CodistanProfile,
  lead: Lead,
  reasons: string[],
  risks: string[],
): ProfileRecommendation {
  return {
    primaryProfile,
    secondaryProfiles: getSecondaryProfiles(lead, primaryProfile),
    confidence: risks.length > 0 ? 'medium' : 'high',
    reasons,
    risks,
  };
}

function getSecondaryProfiles(lead: Lead, primaryProfile: CodistanProfile): CodistanProfile[] {
  return profileCapabilities
    .filter((capability) => capability.profile !== primaryProfile)
    .filter((capability) => capability.serviceCategories.includes(lead.serviceCategory))
    .map((capability) => capability.profile)
    .slice(0, 2);
}

function isAiFullstack(serviceCategory: ServiceCategory): boolean {
  return [
    'ai_automation',
    'rag_document_intelligence',
    'ai_saas_mvp',
    'fullstack_web_app',
    'nextjs_python_app',
    'voice_ai_agent',
  ].includes(serviceCategory);
}

function isFounderLedBetter(lead: Lead): boolean {
  const text = normalizeText(`${lead.title} ${lead.description}`);
  const phraseKeywords = [
    'ai strategy',
    'technical partner',
    'ai transformation',
    'fractional cto',
    'solution architecture',
    'technical discovery',
  ];
  const wordKeywords = ['strategy', 'consultant', 'architecture', 'discovery', 'cto', 'roadmap', 'scope'];

  return phraseKeywords.some((keyword) => text.includes(keyword)) || wordKeywords.some((keyword) => hasWholeWord(text, keyword));
}

function hasUsOnlyAmbiguity(lead: Lead): boolean {
  const text = `${lead.title} ${lead.description} ${lead.country ?? ''} ${lead.region ?? ''}`.toLowerCase();
  return text.includes('us only') || text.includes('u.s. only') || text.includes('united states only');
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasWholeWord(text: string, word: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(word)}($|\\s)`).test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
