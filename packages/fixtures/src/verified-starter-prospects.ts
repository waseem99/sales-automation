import type { Lead, OpportunitySignalStatus, ServiceCategory } from '@sales-automation/shared';
import { starterProspectRows1 } from './starter-prospect-rows-1.js';
import { starterProspectRows2 } from './starter-prospect-rows-2.js';
import { starterProspectRows3 } from './starter-prospect-rows-3.js';
import { starterProspectRows4 } from './starter-prospect-rows-4.js';
import { starterProspectRows5 } from './starter-prospect-rows-5.js';

const rows = [
  ...starterProspectRows1,
  ...starterProspectRows2,
  ...starterProspectRows3,
  ...starterProspectRows4,
  ...starterProspectRows5,
];

export const verifiedStarterProspects: Lead[] = rows.map((row) => {
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
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const timestamp = '2026-07-11T00:00:00.000Z';
  const publicEmail = publicContact.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const publicPhone = publicContact.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0];

  return {
    id: `starter-2026-07-11-${String(rank).padStart(2, '0')}-${slug}`,
    source: rank <= 6 ? 'public_web' : 'public_directory',
    sourceUrl: evidenceUrl,
    leadType: opportunityStatus === 'live_opportunity'
      ? 'public_opportunity'
      : opportunityStatus === 'recent_demand_signal'
        ? 'hiring_signal'
        : 'partnership_target',
    prospectStage: rank <= 6 ? 'warm_lead' : 'partner_prospect',
    title,
    description: evidenceSummary,
    companyName,
    companyWebsite: companyWebsite || undefined,
    contactRole,
    contactEmail: publicEmail?.toLowerCase(),
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
