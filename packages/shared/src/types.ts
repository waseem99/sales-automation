export type LeadSource =
  | 'upwork'
  | 'linkedin'
  | 'sales_navigator'
  | 'partner_research'
  | 'solution_campaign'
  | 'manual'
  | 'future_source';

export type LeadType =
  | 'upwork_job'
  | 'linkedin_warm_post'
  | 'linkedin_sales_nav_alert'
  | 'partner_prospect'
  | 'solution_led_prospect'
  | 'manual_lead'
  | 'future_source';

export type ServiceCategory =
  | 'ai_automation'
  | 'rag_document_intelligence'
  | 'ai_saas_mvp'
  | 'fullstack_web_app'
  | 'nextjs_python_app'
  | 'voice_ai_agent'
  | 'ar_3d_unity_unreal'
  | 'cybersecurity_compliance'
  | 'website_portal'
  | 'enterprise_systems'
  | 'unknown';

export type QualificationStatus = 'hot' | 'qualified' | 'nurture' | 'rejected';

export type UrgencyStatus = 'urgent' | 'normal' | 'low';

export type PipelineStatus =
  | 'new'
  | 'scored'
  | 'hot_alert_sent'
  | 'needs_human_review'
  | 'approved_to_contact'
  | 'draft_ready'
  | 'sent_manually'
  | 'replied'
  | 'meeting_booked'
  | 'proposal_sent'
  | 'won'
  | 'lost'
  | 'rejected'
  | 'archived';

export type CodistanProfile =
  | 'us_ai_fullstack_profile'
  | 'waseem_ai_founder_profile'
  | 'ar_3d_animation_profile'
  | 'cybersecurity_compliance_profile'
  | 'codistan_partner_identity'
  | 'solution_campaign_identity'
  | 'needs_human_review';

export type RedFlagSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RedFlag {
  code: string;
  severity: RedFlagSeverity;
  reason: string;
}

export interface ScoreBreakdown {
  serviceFit: number;
  buyerQuality: number;
  budgetRoi: number;
  timingUrgency: number;
  portfolioProofMatch: number;
  competitionAccessRisk: number;
  complianceSafety: number;
}

export interface LeadScore {
  total: number;
  breakdown: ScoreBreakdown;
  status: QualificationStatus;
  urgency: UrgencyStatus;
  explanation: string;
  redFlags: RedFlag[];
}

export interface Lead {
  id: string;
  source: LeadSource;
  sourceUrl?: string;
  leadType: LeadType;
  title: string;
  description: string;
  companyName?: string;
  contactName?: string;
  contactRole?: string;
  country?: string;
  region?: string;
  industry?: string;
  serviceCategory: ServiceCategory;
  budgetSignal?: string;
  timelineSignal?: string;
  postedAt?: string;
  capturedAt: string;
  freshnessMinutes?: number;
  rawPayload?: unknown;
  score?: LeadScore;
  recommendedProfile?: CodistanProfile;
  recommendedPortfolioItemIds?: string[];
  recommendedNextAction?: string;
  draftMessage?: string;
  owner?: string;
  pipelineStatus: PipelineStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioItem {
  id: string;
  projectName: string;
  industry?: string;
  confidentiality: 'public' | 'private' | 'anonymized';
  serviceCategories: ServiceCategory[];
  techStack: string[];
  problemSolved: string;
  businessOutcome?: string;
  assetUrls: string[];
  tags: string[];
  bestProfiles: CodistanProfile[];
  bestPitchAngle?: string;
}

export interface ProfileCapability {
  profile: CodistanProfile;
  label: string;
  serviceCategories: ServiceCategory[];
  proofTags: string[];
  geographyNotes?: string;
  complianceNotes?: string;
  bestUseCases: string[];
}
