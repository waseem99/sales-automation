import type { ServiceCategory } from '@sales-automation/shared';

export type DiscoveryCampaignId =
  | 'ai_rag_automation'
  | 'custom_software_saas'
  | 'white_label_agency'
  | 'cybersecurity_compliance'
  | 'immersive_3d_ar_vr'
  | 'digital_marketing_web';

export interface DiscoveryCampaign {
  id: DiscoveryCampaignId;
  label: string;
  serviceCategories: ServiceCategory[];
  targetMarkets: string[];
  buyerTypes: string[];
  deliveryModel: 'remote_first' | 'hybrid' | 'local_partner';
  queryPatterns: string[];
  negativeTerms: string[];
  enabledByDefault: boolean;
  notes: string;
}

const commonNegativeTerms = [
  'jobs', 'job', 'careers', 'salary', 'resume', 'cv', 'internship',
  'guide', 'tutorial', 'course', 'definition', 'wikipedia', 'imdb',
  'template', 'examples', 'news', 'review', 'top 10', 'directory',
];

export const DISCOVERY_CAMPAIGNS: DiscoveryCampaign[] = [
  {
    id: 'ai_rag_automation',
    label: 'AI, RAG and Workflow Automation',
    serviceCategories: ['ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'voice_ai_agent'],
    targetMarkets: ['United States', 'United Kingdom', 'Canada', 'UAE', 'Saudi Arabia', 'Global remote'],
    buyerTypes: ['Funded startups', 'SaaS companies', 'Professional services', 'Healthcare', 'Logistics', 'Enterprise operations teams'],
    deliveryModel: 'remote_first',
    queryPatterns: [
      '"request for proposal" (AI automation OR RAG OR document intelligence)',
      '"seeking an implementation partner" (generative AI OR AI agent OR workflow automation)',
      '"looking for an AI development partner" (platform OR product OR automation)',
      '"software vendor required" (AI assistant OR document automation OR voice AI)',
      '"statement of work" (AI implementation OR RAG platform OR intelligent agent)',
    ],
    negativeTerms: [...commonNegativeTerms, 'research paper', 'prompt engineering course'],
    enabledByDefault: true,
    notes: 'Require an explicit external implementation, procurement or vendor requirement. Hiring signals remain research-only.',
  },
  {
    id: 'custom_software_saas',
    label: 'Custom Software, SaaS and Enterprise Platforms',
    serviceCategories: ['fullstack_web_app', 'nextjs_python_app', 'ai_saas_mvp', 'website_portal', 'enterprise_systems'],
    targetMarkets: ['United States', 'United Kingdom', 'Canada', 'Europe', 'UAE', 'Saudi Arabia', 'Global remote'],
    buyerTypes: ['Funded startups', 'SMEs replacing manual systems', 'Enterprises modernizing portals', 'Healthcare and education organizations'],
    deliveryModel: 'remote_first',
    queryPatterns: [
      '"request for proposal" (software development OR web portal OR mobile application)',
      '"seeking a software development partner" (SaaS OR platform OR portal)',
      '"looking for an external development team" (web application OR mobile app OR enterprise system)',
      '"technology vendor required" (platform development OR system integration OR migration)',
      '"invitation to tender" (software OR digital platform OR application development)',
    ],
    negativeTerms: [...commonNegativeTerms, 'open source project', 'coding challenge'],
    enabledByDefault: true,
    notes: 'Prioritize fixed-scope builds, modernization, integration and ongoing product delivery requirements.',
  },
  {
    id: 'white_label_agency',
    label: 'White-label and Agency Delivery Partnerships',
    serviceCategories: ['fullstack_web_app', 'nextjs_python_app', 'website_portal', 'ai_automation', 'ar_3d_unity_unreal'],
    targetMarkets: ['United States', 'United Kingdom', 'Canada', 'Europe', 'UAE', 'Australia'],
    buyerTypes: ['Brand agencies', 'Marketing agencies', 'Product studios', 'Consultancies', 'Creative technology firms'],
    deliveryModel: 'remote_first',
    queryPatterns: [
      '"seeking a white-label development partner" agency',
      '"looking for a technical delivery partner" agency',
      '"outsourcing partner required" (software OR mobile OR AI)',
      '"agency partner" "development capacity"',
      '"overflow development partner" (web OR mobile OR AI)',
    ],
    negativeTerms: [...commonNegativeTerms, 'agency list', 'best agency', 'agency ranking'],
    enabledByDefault: true,
    notes: 'Keep only explicit partnership or overflow-capacity signals. Generic agency homepages remain research targets, not active opportunities.',
  },
  {
    id: 'cybersecurity_compliance',
    label: 'Cybersecurity and Compliance',
    serviceCategories: ['cybersecurity_compliance'],
    targetMarkets: ['United States', 'United Kingdom', 'Canada', 'Europe', 'UAE', 'Saudi Arabia', 'Global remote'],
    buyerTypes: ['SaaS companies', 'Healthcare', 'Fintech', 'MSPs', 'Regulated SMEs', 'Public organizations'],
    deliveryModel: 'remote_first',
    queryPatterns: [
      '"request for proposal" (cybersecurity OR penetration testing OR information security)',
      '"seeking a cybersecurity consultant" (SOC 2 OR ISO 27001 OR cloud security)',
      '"security vendor required" (VAPT OR IAM OR Microsoft 365)',
      '"invitation to bid" (security assessment OR vulnerability assessment OR compliance)',
      '"implementation partner" (ISO 27001 OR SOC 2 OR identity security)',
    ],
    negativeTerms: [...commonNegativeTerms, 'certification training', 'exam questions', 'ethical hacking course'],
    enabledByDefault: true,
    notes: 'Do not promise certification or audit success. Require a real assessment, implementation or compliance-readiness need.',
  },
  {
    id: 'immersive_3d_ar_vr',
    label: '3D, Animation, AR/VR and Immersive Experiences',
    serviceCategories: ['ar_3d_unity_unreal'],
    targetMarkets: ['United States', 'United Kingdom', 'Canada', 'UAE', 'Saudi Arabia', 'Europe'],
    buyerTypes: ['Training companies', 'Event agencies', 'Product brands', 'Healthcare', 'Real estate', 'Gaming and media companies'],
    deliveryModel: 'hybrid',
    queryPatterns: [
      '"request for proposal" (3D animation OR immersive experience OR virtual reality)',
      '"seeking an AR VR development partner"',
      '"looking for a 3D production partner" (product OR training OR visualization)',
      '"Unity development partner" (simulation OR training OR interactive experience)',
      '"creative technology partner required" (AR OR VR OR realtime 3D)',
    ],
    negativeTerms: [...commonNegativeTerms, '3d model download', 'asset store', 'game developer job'],
    enabledByDefault: true,
    notes: 'Remote production is suitable; physical event activation or shoots require a verified local execution route.',
  },
  {
    id: 'digital_marketing_web',
    label: 'Digital Marketing, Brand Growth and Websites',
    serviceCategories: ['website_portal'],
    targetMarkets: ['Pakistan', 'UAE', 'Saudi Arabia', 'United Kingdom', 'Canada'],
    buyerTypes: ['Restaurants', 'Clinics', 'Hospitality', 'Retail', 'Education', 'Professional services', 'New consumer brands'],
    deliveryModel: 'hybrid',
    queryPatterns: [
      '"request for proposal" (digital marketing OR SEO OR social media management)',
      '"seeking a digital marketing agency" (launch OR growth OR lead generation)',
      '"looking for a branding and website partner"',
      '"marketing agency required" (performance marketing OR SEO OR content production)',
      '"invitation to tender" (website redesign OR digital campaign OR social media)',
    ],
    negativeTerms: [...commonNegativeTerms, 'marketing job', 'seo guide', 'social media course'],
    enabledByDefault: true,
    notes: 'International physical production requires an approved local partner. Remote strategy, web, SEO and campaign management remain eligible.',
  },
];

export const DEFAULT_DISCOVERY_CAMPAIGN_IDS: DiscoveryCampaignId[] = DISCOVERY_CAMPAIGNS
  .filter((campaign) => campaign.enabledByDefault)
  .map((campaign) => campaign.id);

export function resolveDiscoveryCampaigns(ids?: string[]): DiscoveryCampaign[] {
  const requested = new Set((ids?.length ? ids : DEFAULT_DISCOVERY_CAMPAIGN_IDS).map((id) => id.trim().toLowerCase()));
  const selected = DISCOVERY_CAMPAIGNS.filter((campaign) => requested.has(campaign.id));
  return selected.length > 0 ? selected : DISCOVERY_CAMPAIGNS.filter((campaign) => campaign.enabledByDefault);
}

export function buildCampaignSearchQueries(campaigns: DiscoveryCampaign[]): string[] {
  const maximumDepth = Math.max(0, ...campaigns.map((campaign) => campaign.queryPatterns.length));
  const queries: string[] = [];
  for (let index = 0; index < maximumDepth; index += 1) {
    for (const campaign of campaigns) {
      const pattern = campaign.queryPatterns[index];
      if (pattern) queries.push(appendNegativeTerms(pattern, campaign.negativeTerms));
    }
  }
  return [...new Set(queries)];
}

export function campaignIdsFromEnvironment(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(/[\n,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function appendNegativeTerms(query: string, terms: string[]): string {
  const modifiers = [...new Set(terms)].map((term) => term.includes(' ') ? `-\"${term}\"` : `-${term}`).join(' ');
  return `${query} ${modifiers} -site:wikipedia.org -site:imdb.com -site:youtube.com -site:medium.com`.trim();
}
