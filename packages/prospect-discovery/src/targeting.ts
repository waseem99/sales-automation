import type { ServiceCategory } from '@sales-automation/shared';
import { DEFAULT_SEARCH_QUERIES } from './sources.js';

export type DeliveryModel = 'remote_first' | 'hybrid' | 'local_weighted';

export type TargetServiceKey =
  | 'ai_solutions'
  | 'cybersecurity_compliance'
  | 'web_software_development'
  | 'mobile_app_development'
  | 'digital_marketing_growth'
  | 'branding_content'
  | 'animation_video_vfx'
  | 'game_ar_vr'
  | 'general_digital_delivery';

export type PortfolioIdentity = 'Hilarious AI' | 'Cytas' | 'Codistan' | 'Motionly';

export interface TargetingDecision {
  serviceKey: TargetServiceKey;
  serviceCategory: ServiceCategory;
  serviceOffer: string;
  portfolioIdentity: PortfolioIdentity;
  deliveryModel: DeliveryModel;
  reachMethod: string;
  materialsToShare: string;
  reason: string;
}

const expandedQueries = [
  '"looking for a development partner" software',
  '"request for proposal" software development',
  '"request for proposal" mobile app development',
  '"implementation partner" generative AI',
  'cybersecurity consultancy United States',
  'digital marketing agency United States',
  'SEO branding agency United Kingdom',
  'mobile app development agency Canada',
  'animation VFX studio United States',
  'game development studio United States',
  'AR VR immersive agency UAE',
  '"white label development partner" agency',
  'performance marketing agency Canada',
  'content production studio United Kingdom',
  'creative technology agency Saudi Arabia',
  'managed security consultancy Australia',
  'Flutter React Native agency United States',
  '2D 3D animation studio Canada',
  'video production studio United States',
  'software outsourcing partner Europe',
];

export const EXPANDED_TARGET_SEARCH_QUERIES = [...new Set([
  ...expandedQueries,
  ...DEFAULT_SEARCH_QUERIES,
])];

const localWeightedTerms = [
  'on-site', 'onsite', 'in person', 'local team', 'local agency', 'photo shoot', 'photoshoot',
  'video shoot', 'location shoot', 'drone shoot', 'event activation', 'event coverage',
  'influencer activation', 'out of home', 'ooh', 'billboard', 'production crew',
  'restaurant shoot', 'campus shoot', 'field marketing', 'physical activation',
];

const hybridTerms = [
  'branding', 'brand identity', 'creative direction', 'content production', 'social media management',
  'influencer marketing', 'campaign production', 'product photography', 'commercial production',
  'digital video commercial', 'dvc', 'launch campaign',
];

export function classifyTargeting(text: string, country?: string): TargetingDecision {
  const normalized = normalize(text);
  const service = classifyService(normalized);
  const deliveryModel = classifyDeliveryModel(normalized, service.serviceKey);
  const localMarket = isPakistan(country);

  return {
    ...service,
    deliveryModel,
    reachMethod: buildReachMethod(deliveryModel, localMarket),
    materialsToShare: buildMaterialsToShare(service.portfolioIdentity, service.serviceOffer),
    reason: buildReason(service.serviceOffer, deliveryModel, localMarket),
  };
}

function classifyService(normalized: string): Omit<TargetingDecision, 'deliveryModel' | 'reachMethod' | 'materialsToShare' | 'reason'> {
  if (matches(normalized, [
    'cybersecurity', 'cyber security', 'soc 2', 'soc2', 'iso 27001', 'iso27001', 'hipaa',
    'penetration testing', 'vulnerability assessment', 'cloud security', 'security compliance',
  ])) {
    return {
      serviceKey: 'cybersecurity_compliance',
      serviceCategory: 'cybersecurity_compliance',
      serviceOffer: 'Cybersecurity, cloud security and compliance services',
      portfolioIdentity: 'Cytas',
    };
  }

  if (matches(normalized, [
    'artificial intelligence', 'generative ai', 'llm', 'rag', 'retrieval augmented', 'ai agent',
    'voice ai', 'computer vision', 'n8n', 'workflow automation', 'ai automation',
  ])) {
    return {
      serviceKey: 'ai_solutions',
      serviceCategory: normalized.includes('rag') || normalized.includes('document intelligence')
        ? 'rag_document_intelligence'
        : normalized.includes('voice ai')
          ? 'voice_ai_agent'
          : 'ai_automation',
      serviceOffer: 'AI solutions, RAG, agents and workflow automation',
      portfolioIdentity: 'Hilarious AI',
    };
  }

  if (matches(normalized, [
    'game development', 'unity', 'unreal', 'augmented reality', 'virtual reality', 'webar',
    'webxr', 'immersive experience', 'immersive application', 'ar vr',
  ])) {
    return {
      serviceKey: 'game_ar_vr',
      serviceCategory: 'ar_3d_unity_unreal',
      serviceOffer: 'Game development, AR/VR and immersive experiences',
      portfolioIdentity: 'Motionly',
    };
  }

  if (matches(normalized, [
    '2d animation', '3d animation', 'character animation', 'motion graphics', 'video editing',
    'vfx', 'cgi', 'product visualization', 'architectural visualization', 'animation studio',
  ])) {
    return {
      serviceKey: 'animation_video_vfx',
      serviceCategory: 'ar_3d_unity_unreal',
      serviceOffer: '2D/3D animation, video, VFX/CGI and motion design',
      portfolioIdentity: 'Motionly',
    };
  }

  if (matches(normalized, [
    'mobile app', 'ios app', 'android app', 'react native', 'flutter', 'cross platform app',
  ])) {
    return {
      serviceKey: 'mobile_app_development',
      serviceCategory: 'fullstack_web_app',
      serviceOffer: 'Mobile application design and development',
      portfolioIdentity: 'Codistan',
    };
  }

  if (matches(normalized, [
    'digital marketing', 'performance marketing', 'paid media', 'google ads', 'meta ads',
    'search engine optimization', 'seo', 'social media marketing', 'growth marketing',
    'lead generation campaign',
  ])) {
    return {
      serviceKey: 'digital_marketing_growth',
      serviceCategory: 'website_portal',
      serviceOffer: 'Digital marketing, SEO and performance growth services',
      portfolioIdentity: 'Codistan',
    };
  }

  if (matches(normalized, [
    'branding', 'brand identity', 'content strategy', 'content creation', 'creative campaign',
    'social media management', 'copywriting', 'graphic design',
  ])) {
    return {
      serviceKey: 'branding_content',
      serviceCategory: 'website_portal',
      serviceOffer: 'Branding, content and creative campaign services',
      portfolioIdentity: 'Codistan',
    };
  }

  if (matches(normalized, [
    'website', 'web application', 'web app', 'software development', 'full stack', 'full-stack',
    'next.js', 'nextjs', 'react', 'node.js', 'nodejs', 'python backend', 'portal', 'dashboard',
    'saas', 'mvp', 'ecommerce', 'e-commerce',
  ])) {
    return {
      serviceKey: 'web_software_development',
      serviceCategory: /website|portal|dashboard|e-?commerce/.test(normalized)
        ? 'website_portal'
        : 'fullstack_web_app',
      serviceOffer: 'Website, software, SaaS and portal development',
      portfolioIdentity: 'Codistan',
    };
  }

  return {
    serviceKey: 'general_digital_delivery',
    serviceCategory: 'enterprise_systems',
    serviceOffer: 'Integrated digital delivery and technology partnership',
    portfolioIdentity: 'Codistan',
  };
}

function classifyDeliveryModel(normalized: string, serviceKey: TargetServiceKey): DeliveryModel {
  if (localWeightedTerms.some((term) => normalized.includes(term))) return 'local_weighted';
  if (hybridTerms.some((term) => normalized.includes(term))) return 'hybrid';

  if (serviceKey === 'branding_content' || serviceKey === 'digital_marketing_growth') {
    return 'hybrid';
  }

  return 'remote_first';
}

function buildReachMethod(deliveryModel: DeliveryModel, localMarket: boolean): string {
  if (deliveryModel === 'remote_first') {
    return 'Remote-first outreach: position the specialist team, relevant proof and time-zone overlap; local presence is not required.';
  }

  if (deliveryModel === 'hybrid') {
    return localMarket
      ? 'Hybrid Pakistan outreach: lead with Codistan strategy and the Islamabad delivery team, including local execution where needed.'
      : 'Hybrid international outreach: offer remote strategy and production management, with an approved local execution partner for physical work.';
  }

  return localMarket
    ? 'Local-first Pakistan outreach: prioritize direct relationship building and Codistan-led on-ground execution.'
    : 'Local-partner outreach: approach through a local production, activation or channel partner; do not position physical execution as fully remote.';
}

function buildMaterialsToShare(identity: PortfolioIdentity, serviceOffer: string): string {
  return `${identity} capability profile and the most relevant ${serviceOffer.toLowerCase()} case studies.`;
}

function buildReason(serviceOffer: string, deliveryModel: DeliveryModel, localMarket: boolean): string {
  const marketNote = localMarket ? 'Pakistan is a directly serviceable local market.' : 'The opportunity is outside Pakistan.';
  const modelNote = deliveryModel === 'remote_first'
    ? 'The work can normally be delivered remotely.'
    : deliveryModel === 'hybrid'
      ? 'Strategy and specialist delivery can be remote, but some execution may benefit from local support.'
      : 'The work depends materially on physical presence or local market execution.';
  return `${serviceOffer} matched. ${marketNote} ${modelNote}`;
}

function isPakistan(country: string | undefined): boolean {
  const normalized = normalize(country ?? '');
  return normalized.includes('pakistan') || normalized.includes('islamabad') || normalized.includes('lahore')
    || normalized.includes('karachi') || normalized.includes('rawalpindi') || normalized.includes('peshawar');
}

function matches(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+./-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
