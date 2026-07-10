import assert from 'node:assert/strict';
import type { Lead, LeadScore } from '@sales-automation/shared';
import { recommendProfile, upworkProfiles } from './index.js';

const now = '2026-07-11T00:00:00.000Z';

function lead(input: Pick<Lead, 'id' | 'title' | 'description' | 'serviceCategory'>): Lead {
  return {
    id: input.id,
    source: 'upwork',
    leadType: 'upwork_job',
    title: input.title,
    description: input.description,
    serviceCategory: input.serviceCategory,
    capturedAt: now,
    pipelineStatus: 'scored',
    createdAt: now,
    updatedAt: now,
  };
}

function score(total: number): LeadScore {
  return {
    total,
    breakdown: {
      serviceFit: 20,
      buyerQuality: 15,
      budgetRoi: 12,
      timingUrgency: 12,
      portfolioProofMatch: 12,
      competitionAccessRisk: 4,
      complianceSafety: 5,
    },
    status: total >= 80 ? 'hot' : total >= 70 ? 'qualified' : 'nurture',
    urgency: total >= 80 ? 'urgent' : 'normal',
    explanation: 'Routing test score.',
    redFlags: [],
  };
}

assert.equal(upworkProfiles.length, 4);
assert.ok(upworkProfiles.every((profile) => profile.url.startsWith('https://www.upwork.com/freelancers/')));

const rag = recommendProfile(lead({
  id: 'rag',
  title: 'Build a secure RAG knowledge assistant',
  description: 'Need an LLM, LangChain, vector search, document intelligence, and a private chatbot.',
  serviceCategory: 'rag_document_intelligence',
}), score(88));
assert.equal(rag.primaryProfile, 'waseem_ai_founder_profile');
assert.equal(rag.upworkProfile?.key, 'waseem_ai_ml');
assert.equal(rag.confidence, 'high');

const founderAi = recommendProfile(lead({
  id: 'founder-ai',
  title: 'AI strategy and technical discovery partner',
  description: 'Founder needs solution architecture, roadmap, and fractional CTO support before implementation.',
  serviceCategory: 'ai_automation',
}), score(85));
assert.equal(founderAi.primaryProfile, 'waseem_ai_founder_profile');
assert.equal(founderAi.upworkProfile?.key, 'waseem_ai_ml');

const fullstack = recommendProfile(lead({
  id: 'fullstack',
  title: 'Full-stack Next.js SaaS MVP',
  description: 'Build React, Node.js, PostgreSQL, API integrations, subscriptions, and an admin dashboard.',
  serviceCategory: 'fullstack_web_app',
}), score(86));
assert.equal(fullstack.primaryProfile, 'needs_human_review');
assert.equal(fullstack.upworkProfile?.key, 'us_fullstack_ai');
assert.equal(fullstack.upworkProfile?.requiresHumanVerification, true);
assert.ok(fullstack.risks.some((risk) => risk.toLowerCase().includes('verification')));

const restricted = recommendProfile(lead({
  id: 'restricted',
  title: 'US citizens only AI engineer',
  description: 'Onsite role requiring security clearance and W2 eligibility.',
  serviceCategory: 'ai_saas_mvp',
}), score(90));
assert.equal(restricted.primaryProfile, 'needs_human_review');
assert.ok(restricted.risks.some((risk) => risk.toLowerCase().includes('eligibility')));

const render = recommendProfile(lead({
  id: 'render',
  title: 'Architectural interior rendering and product visualization',
  description: 'Need photorealistic Blender and 3ds Max renders with two revision rounds.',
  serviceCategory: 'ar_3d_unity_unreal',
}), score(84));
assert.equal(render.primaryProfile, 'ar_3d_animation_profile');
assert.equal(render.upworkProfile?.key, 'roshana_3d_animation');

const ar = recommendProfile(lead({
  id: 'ar',
  title: 'Unity ARKit mobile application',
  description: 'Build an augmented reality app with GPS AR, ARCore, and interactive 3D content.',
  serviceCategory: 'ar_3d_unity_unreal',
}), score(90));
assert.equal(ar.primaryProfile, 'ar_3d_animation_profile');
assert.equal(ar.upworkProfile?.key, 'nadir_unity_ar');

const weakAr = recommendProfile(lead({
  id: 'weak-ar',
  title: 'Unity prototype',
  description: 'Small experimental Unity and virtual reality prototype with unclear scope.',
  serviceCategory: 'ar_3d_unity_unreal',
}), score(75));
assert.equal(weakAr.primaryProfile, 'needs_human_review');
assert.equal(weakAr.upworkProfile?.key, 'nadir_unity_ar');
assert.ok(weakAr.risks.some((risk) => risk.includes('82')));

const multiplayer = recommendProfile(lead({
  id: 'multiplayer',
  title: 'Unity multiplayer web game developer',
  description: 'Build a broad multiplayer game with networking, backend, animation, and live operations.',
  serviceCategory: 'ar_3d_unity_unreal',
}), score(91));
assert.equal(multiplayer.primaryProfile, 'needs_human_review');
assert.equal(multiplayer.upworkProfile, undefined);

const ambiguousAnimation = recommendProfile(lead({
  id: 'ambiguous-animation',
  title: 'Long-term animator for kids series',
  description: 'Generic ongoing animation work without a defined production style or exact deliverables.',
  serviceCategory: 'ar_3d_unity_unreal',
}), score(85));
assert.equal(ambiguousAnimation.primaryProfile, 'needs_human_review');
assert.equal(ambiguousAnimation.upworkProfile, undefined);

console.log('Profile-aware routing tests passed.');
