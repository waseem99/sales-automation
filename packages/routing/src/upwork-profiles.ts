import type { ServiceCategory } from '@sales-automation/shared';

export type UpworkProfileKey =
  | 'waseem_ai_ml'
  | 'us_fullstack_ai'
  | 'roshana_3d_animation'
  | 'nadir_unity_ar';

export type UpworkProfileStatus = 'active' | 'selective' | 'verification_required';

export interface UpworkProfileRoute {
  key: UpworkProfileKey;
  label: string;
  url: string;
  status: UpworkProfileStatus;
  location?: string;
  publicJobSuccessScore?: number;
  publicRateUsd?: number;
  currentPositioning: string;
  serviceCategories: ServiceCategory[];
  preferredKeywords: string[];
  avoidKeywords: string[];
  minimumLeadScore: number;
  routingNotes: string[];
  complianceNotes?: string;
}

export interface SelectedUpworkProfile {
  key: UpworkProfileKey;
  label: string;
  url: string;
  status: UpworkProfileStatus;
  requiresHumanVerification: boolean;
  selectionReason: string;
  minimumLeadScore: number;
  routingNotes: string[];
}

export const upworkProfiles: UpworkProfileRoute[] = [
  {
    key: 'waseem_ai_ml',
    label: 'Waseem — AI / ML / RAG',
    url: 'https://www.upwork.com/freelancers/~016e9a7bda2340dcd9',
    status: 'active',
    location: 'Islamabad, Pakistan',
    publicJobSuccessScore: 100,
    publicRateUsd: 15,
    currentPositioning: 'AI/ML, LLMs, Generative AI, Custom GPTs, RAG, voice AI, computer vision, and production AI systems.',
    serviceCategories: ['ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'nextjs_python_app', 'voice_ai_agent', 'enterprise_systems'],
    preferredKeywords: ['rag', 'llm', 'generative ai', 'custom gpt', 'chatbot', 'machine learning', 'deep learning', 'computer vision', 'fine tuning', 'voice ai', 'langchain', 'llamaindex', 'document intelligence', 'knowledge base', 'ai automation', 'ai strategy', 'technical partner', 'fractional cto', 'solution architecture', 'technical discovery'],
    avoidKeywords: ['wordpress only', 'shopify only', 'basic landing page', 'data entry'],
    minimumLeadScore: 70,
    routingNotes: [
      'Default first choice for genuine AI/ML/RAG/LLM opportunities.',
      'Use exact AI proof rather than a generic development-team pitch.',
      'Avoid basic websites or loosely related jobs that merely mention AI.',
    ],
  },
  {
    key: 'us_fullstack_ai',
    label: 'US Profile — Full-stack AI / Development',
    url: 'https://www.upwork.com/freelancers/~01e0510c19c730eb3d',
    status: 'verification_required',
    currentPositioning: 'Planned React/Next.js, Python/Node.js, SaaS MVP, integrations, and AI-enabled web application profile.',
    serviceCategories: ['ai_automation', 'ai_saas_mvp', 'fullstack_web_app', 'nextjs_python_app', 'website_portal'],
    preferredKeywords: ['full stack', 'fullstack', 'nextjs', 'react', 'nodejs', 'python', 'fastapi', 'saas', 'mvp', 'api integration', 'admin dashboard', 'web application', 'ai app'],
    avoidKeywords: ['us citizens only', 'security clearance', 'onsite only', 'w2 only'],
    minimumLeadScore: 75,
    routingNotes: [
      'Use for full-stack SaaS/MVP and AI-enabled application delivery after verification.',
      'Never use to override a client eligibility or location requirement.',
      'Citizenship, clearance, onsite, or employment requirements always need human review.',
    ],
    complianceNotes: 'Verify the profile owner, true location, public positioning, work history, and Upwork verification before enabling automatic routing.',
  },
  {
    key: 'roshana_3d_animation',
    label: 'Roshana — 3D / Animation / Visualization',
    url: 'https://www.upwork.com/freelancers/~01323536ddaffbbd34',
    status: 'selective',
    location: 'Surrey, Canada',
    publicJobSuccessScore: 88,
    publicRateUsd: 25,
    currentPositioning: '2D/3D modeling and animation, character design, architectural/product visualization, VFX, CGI, and supporting AR/VR work.',
    serviceCategories: ['ar_3d_unity_unreal'],
    preferredKeywords: ['3d modeling', '3d modelling', '3d animation', '2d animation', 'character design', 'architectural visualization', 'architectural rendering', 'interior rendering', 'product visualization', 'photorealistic render', 'vfx', 'cgi', 'maya', 'blender', '3ds max', 'lumion', 'after effects'],
    avoidKeywords: ['multiplayer game', 'multiplayer web game', 'full stack game', 'web game developer'],
    minimumLeadScore: 78,
    routingNotes: [
      'Best for modeling, rendering, character work, product visualization, animation, VFX, and architectural visualization.',
      'Avoid coding-heavy multiplayer or browser-game work without manual approval.',
      'Define references, quality level, revisions, and approval checkpoints before bidding.',
    ],
  },
  {
    key: 'nadir_unity_ar',
    label: 'Nadir — Unity / Unreal / AR / VR / WebAR',
    url: 'https://www.upwork.com/freelancers/~0116e2d98cb771724e',
    status: 'selective',
    location: 'Lahore, Pakistan',
    publicJobSuccessScore: 80,
    publicRateUsd: 20,
    currentPositioning: 'Unity/Unreal, AR/VR, WebAR, mobile immersive applications, filters, and interactive 3D experiences.',
    serviceCategories: ['ar_3d_unity_unreal'],
    preferredKeywords: ['unity', 'unreal engine', 'augmented reality', 'virtual reality', 'webar', 'web ar', 'arkit', 'arcore', 'meta quest', 'oculus', 'vision pro', 'effect house', 'tiktok filter', 'gps ar', 'interactive 3d'],
    avoidKeywords: ['long term animator', 'kids series', 'multiplayer game', 'multiplayer web game', 'multiplayer arena game', 'generic game development'],
    minimumLeadScore: 82,
    routingNotes: [
      'Use only for strong exact-match Unity/Unreal/AR/VR/WebAR opportunities.',
      'Avoid generic animation retainers and broad multiplayer-game builds.',
      'Require clear scope, realistic budget, and an exact portfolio match.',
    ],
  },
];

export function getUpworkProfile(key: UpworkProfileKey): UpworkProfileRoute {
  const profile = upworkProfiles.find((candidate) => candidate.key === key);
  if (!profile) throw new Error(`Unknown Upwork profile: ${key}`);
  return profile;
}

export function selectUpworkProfile(profile: UpworkProfileRoute, selectionReason: string): SelectedUpworkProfile {
  return {
    key: profile.key,
    label: profile.label,
    url: profile.url,
    status: profile.status,
    requiresHumanVerification: profile.status === 'verification_required',
    selectionReason,
    minimumLeadScore: profile.minimumLeadScore,
    routingNotes: [...profile.routingNotes],
  };
}
