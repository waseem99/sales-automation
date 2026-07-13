import type { Lead, OpportunitySignalStatus, ServiceCategory } from '@sales-automation/shared';
import { qualifiedProspectSeeds, type QualifiedProspectSeed } from './qualified-prospect-seeds.js';
import { starterProspectRows1 } from './starter-prospect-rows-1.js';
import { starterProspectRows2 } from './starter-prospect-rows-2.js';
import { starterProspectRows3 } from './starter-prospect-rows-3.js';
import { starterProspectRows4 } from './starter-prospect-rows-4.js';
import { starterProspectRows5 } from './starter-prospect-rows-5.js';

const legacyRows = [
  ...starterProspectRows1,
  ...starterProspectRows2,
  ...starterProspectRows3,
  ...starterProspectRows4,
  ...starterProspectRows5,
];

const legacyProspects: Lead[] = legacyRows.map((row) => {
  const [
    rankValue,
    companyName,
    companyWebsite,
    title,
    currentStatusLabel,
    evidenceSummary,
    checkedOn,
    evidenceUrl,
    contactRole,
    reachMethod,
    publicContact,
    serviceOffer,
    materialsToShare,
    draftMessage,
    recommendedNextAction,
    confidenceValue,
  ] = row;
  const rank = Number(rankValue);
  const opportunityStatus = opportunityStatusFor(rank);
  const serviceCategory = serviceCategoryFor(rank);
  const slug = slugify(companyName);
  const timestamp = '2026-07-11T00:00:00.000Z';
  const publicEmail = extractEmail(publicContact);
  const publicPhone = extractPhone(publicContact);

  return {
    id: `starter-2026-07-11-${String(rank).padStart(2, '0')}-${slug}`,
    source: rank <= 6 ? 'public_web' : 'public_directory',
    sourceUrl: evidenceUrl,
    leadType: leadTypeFor(opportunityStatus),
    prospectStage: rank <= 6 ? 'warm_lead' : 'partner_prospect',
    title,
    description: evidenceSummary,
    companyName,
    companyWebsite: companyWebsite || undefined,
    contactRole,
    contactEmail: publicEmail,
    contactPhone: publicPhone,
    contactFormUrl: publicContact.startsWith('http') ? publicContact : undefined,
    serviceCategory,
    serviceOffer,
    materialsToShare,
    reachMethod,
    opportunityStatus,
    discoverySource: 'Verified starter prospect research — 2026-07-11',
    evidenceUrl,
    evidenceSummary,
    discoveredAt: timestamp,
    capturedAt: timestamp,
    rank,
    confidence: confidenceFor(confidenceValue),
    recommendedNextAction,
    draftMessage,
    feedback: { status: 'pending' },
    pipelineStatus: rank <= 3 ? 'approved_to_contact' : 'needs_research',
    createdAt: timestamp,
    updatedAt: timestamp,
    rawPayload: {
      starterResearch: {
        rank,
        leadTypeLabel: title,
        currentOpportunityStatusLabel: currentStatusLabel,
        evidenceCheckedOn: checkedOn,
        publicContact,
        confidence: confidenceValue,
      },
    },
  };
});

const qualifiedProspects: Lead[] = qualifiedProspectSeeds.map(toQualifiedLead);

export const verifiedStarterProspects: Lead[] = [
  ...legacyProspects,
  ...qualifiedProspects,
];

function toQualifiedLead(seed: QualifiedProspectSeed): Lead {
  const timestamp = `${seed.checkedOn}T00:00:00.000Z`;
  const publicEmail = extractEmail(seed.publicContact);
  const publicPhone = extractPhone(seed.publicContact);
  const statusLabel = seed.opportunityStatus === 'recent_demand_signal'
    ? 'CURRENT DELIVERY OR EXPANSION SIGNAL — NO EXPLICIT VENDOR REQUEST VERIFIED'
    : 'QUALIFIED PARTNERSHIP TARGET — ACTIVE OFFICIAL SITE AND CONTACT ROUTE VERIFIED';

  return {
    id: `qualified-${seed.checkedOn}-${String(seed.rank).padStart(2, '0')}-${slugify(seed.companyName)}`,
    source: seed.opportunityStatus === 'recent_demand_signal' ? 'public_web' : 'public_directory',
    sourceUrl: seed.evidenceUrl,
    leadType: leadTypeFor(seed.opportunityStatus),
    prospectStage: seed.opportunityStatus === 'recent_demand_signal' ? 'warm_lead' : 'partner_prospect',
    title: seed.title,
    description: seed.evidenceSummary,
    companyName: seed.companyName,
    companyWebsite: seed.companyWebsite,
    contactRole: seed.contactRole,
    contactEmail: publicEmail,
    contactPhone: publicPhone,
    contactFormUrl: seed.publicContact.startsWith('http') ? seed.publicContact : seed.companyWebsite,
    serviceCategory: seed.serviceCategory,
    serviceOffer: serviceOfferFor(seed.serviceCategory),
    materialsToShare: materialsFor(seed.serviceCategory),
    reachMethod: reachMethodFor(seed),
    opportunityStatus: seed.opportunityStatus,
    discoverySource: `Qualified prospect research — ${seed.checkedOn}`,
    evidenceUrl: seed.evidenceUrl,
    evidenceSummary: seed.evidenceSummary,
    discoveredAt: timestamp,
    capturedAt: timestamp,
    rank: seed.rank,
    confidence: seed.confidence,
    recommendedNextAction: nextActionFor(seed),
    draftMessage: draftMessageFor(seed),
    feedback: { status: 'pending' },
    pipelineStatus: seed.confidence === 'high' ? 'approved_to_contact' : 'needs_human_review',
    createdAt: timestamp,
    updatedAt: timestamp,
    rawPayload: {
      qualifiedResearch: {
        rank: seed.rank,
        currentOpportunityStatusLabel: statusLabel,
        evidenceCheckedOn: seed.checkedOn,
        publicContact: seed.publicContact,
        confidence: seed.confidence,
        qualificationBasis: [
          'Active official company website',
          'Relevant complementary service capability',
          'Public contact route',
          'Relevant decision-maker role identified',
          'Evidence URL retained for BD review',
        ],
      },
    },
  };
}

function reachMethodFor(seed: QualifiedProspectSeed): string {
  if (extractEmail(seed.publicContact)) {
    return `Send a concise partnership email to ${seed.publicContact}, then follow with a manual LinkedIn introduction to the ${seed.contactRole}.`;
  }
  return `Use the official website contact route, then manually identify and approach the ${seed.contactRole} on LinkedIn. Do not send until the evidence and contact are reviewed.`;
}

function serviceOfferFor(category: ServiceCategory): string {
  if (category === 'ar_3d_unity_unreal') {
    return 'White-label Unity, Unreal, WebAR, AR/VR, real-time 3D, animation and interactive-experience production capacity.';
  }
  if (category === 'ai_automation') {
    return 'White-label AI implementation covering agents, workflow automation, integrations, private AI, RAG and production applications.';
  }
  if (category === 'rag_document_intelligence') {
    return 'Secure RAG, document intelligence, OCR, enterprise search, AI agents and workflow integration delivery.';
  }
  if (category === 'ai_saas_mvp') {
    return 'AI SaaS product engineering from discovery and prototype through secure production deployment and ongoing delivery pods.';
  }
  if (category === 'nextjs_python_app') {
    return 'Python, FastAPI, Next.js, data engineering and AI application delivery through a dedicated white-label team.';
  }
  if (category === 'website_portal') {
    return 'Custom commerce applications, Shopify apps, integrations, customer portals, mobile experiences and AI-enabled workflows.';
  }
  return 'White-label backend, SaaS, mobile, API, portal and AI product engineering for requirements beyond standard agency delivery.';
}

function materialsFor(category: ServiceCategory): string {
  if (category === 'ar_3d_unity_unreal') {
    return 'Immersive-production capability deck, two relevant Unity/Unreal/AR/3D cases, team availability, QA/device-testing process and NDA/no-client-poaching commitment.';
  }
  if (category === 'ai_automation' || category === 'rag_document_intelligence' || category === 'ai_saas_mvp') {
    return 'AI implementation capability deck, two closest approved AI/RAG/product cases, security approach, delivery-pod structure and a focused pilot proposal.';
  }
  if (category === 'website_portal') {
    return 'Commerce engineering deck, two app/integration/portal cases, architecture approach, delivery capacity and white-label terms.';
  }
  return 'Agency partnership one-pager, two relevant SaaS/application cases, delivery governance, team availability and NDA/no-client-poaching commitment.';
}

function draftMessageFor(seed: QualifiedProspectSeed): string {
  const service = shortServiceLabel(seed.serviceCategory);
  return `Hi, I reviewed ${seed.companyName}'s work around ${seed.title.toLowerCase()}. Codistan is a 150+ person delivery company and can support your team with ${service} through an NDA-bound, white-label delivery pod while you retain the client relationship. May I share two relevant case studies and our current capacity?`;
}

function nextActionFor(seed: QualifiedProspectSeed): string {
  const prefix = seed.opportunityStatus === 'recent_demand_signal'
    ? 'Review the current activity signal and contact within two business days.'
    : 'Validate the best decision-maker and contact route before outreach.';
  return `${prefix} Personalize the partnership message around ${seed.title.toLowerCase()} and share only approved relevant proof.`;
}

function shortServiceLabel(category: ServiceCategory): string {
  if (category === 'ar_3d_unity_unreal') return 'Unity, Unreal, WebAR, AR/VR and real-time 3D production';
  if (category === 'ai_automation') return 'AI agents, automation, integrations and production AI applications';
  if (category === 'rag_document_intelligence') return 'secure RAG, document intelligence and workflow automation';
  if (category === 'ai_saas_mvp') return 'AI SaaS product engineering and dedicated delivery teams';
  if (category === 'nextjs_python_app') return 'Python, FastAPI, Next.js and AI application development';
  if (category === 'website_portal') return 'commerce apps, integrations, portals and AI-enabled customer experiences';
  return 'backend, SaaS, mobile, API and AI product engineering';
}

function leadTypeFor(status: OpportunitySignalStatus): Lead['leadType'] {
  if (status === 'live_opportunity') return 'public_opportunity';
  if (status === 'recent_demand_signal') return 'hiring_signal';
  return 'partnership_target';
}

function opportunityStatusFor(rank: number): OpportunitySignalStatus {
  if (rank <= 3) return 'live_opportunity';
  if (rank <= 6) return 'recent_demand_signal';
  return 'partnership_target';
}

function serviceCategoryFor(rank: number): ServiceCategory {
  if ([1, 2, 4, 6, 7, 8, 9, 16, 17].includes(rank)) return 'ar_3d_unity_unreal';
  if (rank === 3) return 'rag_document_intelligence';
  if (rank === 5) return 'ai_saas_mvp';
  if (rank === 19) return 'ai_automation';
  if ([21, 24, 25].includes(rank)) return 'website_portal';
  return 'fullstack_web_app';
}

function confidenceFor(value: string): 'high' | 'medium' | 'low' {
  const normalized = value.toLowerCase();
  if (normalized.startsWith('high')) return 'high';
  if (normalized.startsWith('low')) return 'low';
  return 'medium';
}

function extractEmail(value: string): string | undefined {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
}

function extractPhone(value: string): string | undefined {
  return value.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0];
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
