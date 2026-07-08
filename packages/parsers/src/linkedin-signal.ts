import type { Lead, ServiceCategory } from '@sales-automation/shared';

export type LinkedInSignalType =
  | 'looking_for_developer'
  | 'looking_for_ai_partner'
  | 'looking_for_website_team'
  | 'looking_for_automation_help'
  | 'looking_for_ar_3d_team'
  | 'agency_needs_delivery_partner'
  | 'hiring_engineering_team'
  | 'funding_or_growth_signal'
  | 'solution_relevant_pain'
  | 'other';

export interface ParseLinkedInSignalInput {
  text: string;
  capturedAt: string;
  sourceUrl?: string;
  contactName?: string;
  contactRole?: string;
  companyName?: string;
  country?: string;
  region?: string;
}

export interface ParsedLinkedInLead extends Lead {
  rawPayload: {
    signalType: LinkedInSignalType;
    originalText: string;
  };
}

export function parseLinkedInSignal(input: ParseLinkedInSignalInput): ParsedLinkedInLead {
  const signalType = inferSignalType(input.text);
  const serviceCategory = inferServiceCategory(input.text, signalType);

  return {
    id: createLeadId(input),
    source: 'linkedin',
    sourceUrl: input.sourceUrl,
    leadType: 'linkedin_warm_post',
    title: inferTitle(input.text, signalType),
    description: input.text.trim(),
    companyName: input.companyName,
    contactName: input.contactName,
    contactRole: input.contactRole,
    country: input.country,
    region: input.region,
    serviceCategory,
    timelineSignal: inferTimelineSignal(input.text),
    capturedAt: input.capturedAt,
    freshnessMinutes: inferFreshnessMinutes(input.text),
    rawPayload: {
      signalType,
      originalText: input.text,
    },
    pipelineStatus: 'new',
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt,
  };
}

function inferSignalType(text: string): LinkedInSignalType {
  const value = text.toLowerCase();

  if (containsAny(value, ['automation expert', 'workflow automation', 'ai automation', 'zapier', 'make.com', 'n8n'])) return 'looking_for_automation_help';
  if (containsAny(value, ['looking for ai', 'ai partner', 'ai developer', 'llm', 'rag'])) return 'looking_for_ai_partner';
  if (containsAny(value, ['website developer', 'web developer', 'website team', 'webflow', 'wordpress'])) return 'looking_for_website_team';
  if (containsAny(value, ['ar developer', 'vr developer', '3d team', 'unity developer', 'unreal developer'])) return 'looking_for_ar_3d_team';
  if (containsAny(value, ['outsourcing partner', 'white-label', 'white label', 'delivery partner', 'overflow work'])) return 'agency_needs_delivery_partner';
  if (containsAny(value, ['hiring full-stack', 'hiring full stack', 'hiring developer', 'hiring engineer', 'hiring ai'])) return 'hiring_engineering_team';
  if (containsAny(value, ['raised funding', 'seed round', 'series a', 'scaling team', 'launching soon'])) return 'funding_or_growth_signal';
  if (containsAny(value, ['refund', 'fraud', 'risk intelligence', 'banking intelligence', 'manual process'])) return 'solution_relevant_pain';
  if (containsAny(value, ['looking for developer', 'need developer', 'recommend a developer', 'software agency'])) return 'looking_for_developer';

  return 'other';
}

function inferServiceCategory(text: string, signalType: LinkedInSignalType): ServiceCategory {
  const value = text.toLowerCase();

  if (signalType === 'looking_for_ar_3d_team') return 'ar_3d_unity_unreal';
  if (signalType === 'looking_for_automation_help') return 'ai_automation';
  if (signalType === 'looking_for_website_team') return 'website_portal';
  if (signalType === 'solution_relevant_pain') return 'enterprise_systems';
  if (containsAny(value, ['rag', 'document intelligence', 'knowledge base'])) return 'rag_document_intelligence';
  if (containsAny(value, ['ai', 'llm', 'agent', 'automation'])) return 'ai_automation';
  if (containsAny(value, ['saas', 'mvp'])) return 'ai_saas_mvp';
  if (containsAny(value, ['next.js', 'nextjs', 'react', 'python', 'full-stack', 'full stack'])) return 'fullstack_web_app';
  if (containsAny(value, ['security', 'compliance', 'soc2', 'hipaa', 'iso27001'])) return 'cybersecurity_compliance';

  return 'unknown';
}

function inferTitle(text: string, signalType: LinkedInSignalType): string {
  const firstSentence = text.trim().split(/[.!?\n]/)[0]?.trim();
  if (firstSentence && firstSentence.length <= 90) return firstSentence;
  return signalType.replace(/_/g, ' ');
}

function inferTimelineSignal(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (containsAny(lower, ['asap', 'urgent', 'immediately', 'this week'])) return 'Urgent warm LinkedIn signal';
  if (containsAny(lower, ['recommend', 'looking for', 'need help'])) return 'Active warm LinkedIn demand signal';
  return undefined;
}

function inferFreshnessMinutes(text: string): number | undefined {
  const match = text.match(/(\d+)\s+(minute|minutes|hour|hours|day|days)\s+ago/i);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('minute')) return amount;
  if (unit.startsWith('hour')) return amount * 60;
  if (unit.startsWith('day')) return amount * 1440;
  return undefined;
}

function createLeadId(input: ParseLinkedInSignalInput): string {
  const source = input.sourceUrl ?? `${input.contactName ?? 'unknown'}-${input.text.slice(0, 60)}-${input.capturedAt}`;
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
  return `linkedin-${slug || 'manual-signal'}`;
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}
