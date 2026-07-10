import type { CodistanProfile, Lead, LeadScore } from '@sales-automation/shared';
import {
  getUpworkProfile,
  selectUpworkProfile,
  type SelectedUpworkProfile,
  type UpworkProfileRoute,
} from './upwork-profiles.js';

export interface SuppliedProfileSelection {
  primaryProfile: CodistanProfile;
  upworkProfile: SelectedUpworkProfile;
  reasons: string[];
  risks: string[];
  confidence: 'high' | 'medium' | 'low';
  forceHumanReview: boolean;
}

export function selectSuppliedUpworkProfile(
  lead: Lead,
  score?: LeadScore,
): SuppliedProfileSelection | undefined {
  if (lead.serviceCategory === 'ar_3d_unity_unreal') {
    return selectCreativeProfile(lead, score);
  }

  if (isAiOrFullstackCategory(lead.serviceCategory)) {
    return selectAiOrFullstackProfile(lead, score);
  }

  if (lead.serviceCategory === 'website_portal' && isCustomApplicationLead(lead)) {
    const profile = getUpworkProfile('us_fullstack_ai');
    return finalizeSelection({
      lead,
      score,
      profile,
      primaryProfile: 'us_ai_fullstack_profile',
      reason: 'Custom portal/application work is closest to the planned full-stack AI/development profile.',
      risks: ['The live public profile and Upwork verification still need confirmation.'],
    });
  }

  return undefined;
}

function selectAiOrFullstackProfile(lead: Lead, score?: LeadScore): SuppliedProfileSelection {
  const text = leadText(lead);
  const waseem = getUpworkProfile('waseem_ai_ml');
  const usFullstack = getUpworkProfile('us_fullstack_ai');

  if (hasEligibilityConstraint(text)) {
    return finalizeSelection({
      lead,
      score,
      profile: usFullstack,
      primaryProfile: 'us_ai_fullstack_profile',
      reason: 'The job may match a full-stack profile, but it contains an eligibility or location constraint.',
      risks: ['Confirm the real profile owner, location, citizenship/clearance, onsite, and work-eligibility requirements before bidding.'],
      forceHumanReview: true,
    });
  }

  const deepAiMatch = lead.serviceCategory === 'rag_document_intelligence'
    || lead.serviceCategory === 'voice_ai_agent'
    || countMatches(text, waseem.preferredKeywords) > 0;

  if (deepAiMatch) {
    return finalizeSelection({
      lead,
      score,
      profile: waseem,
      primaryProfile: 'waseem_ai_founder_profile',
      reason: 'The job is primarily AI/ML/RAG/LLM/voice/computer-vision work, matching Waseem’s verified positioning.',
    });
  }

  return finalizeSelection({
    lead,
    score,
    profile: usFullstack,
    primaryProfile: 'us_ai_fullstack_profile',
    reason: 'The job is primarily full-stack/SaaS/application delivery with AI as a product feature.',
    risks: ['The live public profile and Upwork verification still need confirmation.'],
  });
}

function selectCreativeProfile(lead: Lead, score?: LeadScore): SuppliedProfileSelection | undefined {
  const text = leadText(lead);
  const roshana = getUpworkProfile('roshana_3d_animation');
  const nadir = getUpworkProfile('nadir_unity_ar');
  const roshanaMatches = countMatches(text, roshana.preferredKeywords);
  const nadirMatches = countMatches(text, nadir.preferredKeywords);
  const roshanaAvoid = hasAny(text, roshana.avoidKeywords);
  const nadirAvoid = hasAny(text, nadir.avoidKeywords);

  if (roshanaAvoid && nadirAvoid) return undefined;

  if (nadirMatches > roshanaMatches && !nadirAvoid) {
    return finalizeSelection({
      lead,
      score,
      profile: nadir,
      primaryProfile: 'ar_3d_animation_profile',
      reason: 'The job is primarily Unity/Unreal/AR/VR/WebAR or interactive immersive development.',
    });
  }

  if (roshanaMatches > 0 && !roshanaAvoid) {
    return finalizeSelection({
      lead,
      score,
      profile: roshana,
      primaryProfile: 'ar_3d_animation_profile',
      reason: 'The job is primarily modeling, animation, rendering, character, VFX, product, or architectural visualization.',
    });
  }

  return undefined;
}

function finalizeSelection(input: {
  lead: Lead;
  score?: LeadScore;
  profile: UpworkProfileRoute;
  primaryProfile: CodistanProfile;
  reason: string;
  risks?: string[];
  forceHumanReview?: boolean;
}): SuppliedProfileSelection {
  const risks = [...(input.risks ?? [])];
  const text = leadText(input.lead);
  const belowThreshold = input.score !== undefined && input.score.total < input.profile.minimumLeadScore;
  const avoidMatch = hasAny(text, input.profile.avoidKeywords);
  const verificationRequired = input.profile.status === 'verification_required';

  if (belowThreshold) {
    risks.push(`Lead score ${input.score!.total} is below the ${input.profile.minimumLeadScore} minimum for ${input.profile.label}.`);
  }
  if (avoidMatch) {
    risks.push('Job matches a profile-specific avoid category based on public positioning or recent work history.');
  }
  if (verificationRequired && !risks.some((risk) => risk.includes('verification'))) {
    risks.push('Profile verification must be confirmed before bidding.');
  }

  const forceHumanReview = input.forceHumanReview === true
    || belowThreshold
    || avoidMatch
    || verificationRequired;

  return {
    primaryProfile: input.primaryProfile,
    upworkProfile: selectUpworkProfile(input.profile, input.reason),
    reasons: [input.reason],
    risks,
    confidence: forceHumanReview ? 'low' : risks.length > 0 ? 'medium' : 'high',
    forceHumanReview,
  };
}

function isAiOrFullstackCategory(category: Lead['serviceCategory']): boolean {
  return [
    'ai_automation',
    'rag_document_intelligence',
    'ai_saas_mvp',
    'fullstack_web_app',
    'nextjs_python_app',
    'voice_ai_agent',
  ].includes(category);
}

function isCustomApplicationLead(lead: Lead): boolean {
  const text = leadText(lead);
  return hasAny(text, ['custom portal', 'web application', 'dashboard', 'react', 'nextjs', 'nodejs', 'python', 'api integration']);
}

function hasEligibilityConstraint(text: string): boolean {
  return hasAny(text, [
    'us only',
    'u s only',
    'united states only',
    'us based only',
    'must be in the us',
    'us citizen',
    'u s citizen',
    'security clearance',
    'onsite only',
    'w2 only',
  ]);
}

function leadText(lead: Lead): string {
  return normalize(`${lead.title} ${lead.description} ${lead.country ?? ''} ${lead.region ?? ''} ${lead.budgetSignal ?? ''}`);
}

function countMatches(text: string, phrases: string[]): number {
  return phrases.reduce((count, phrase) => count + (text.includes(normalize(phrase)) ? 1 : 0), 0);
}

function hasAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(normalize(phrase)));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
