import type {
  Lead,
  LeadSource,
  LeadType,
  OpportunitySignalStatus,
  ProspectStage,
  ServiceCategory,
} from '@sales-automation/shared';
import { parseLinkedInSignal } from './linkedin-signal.js';

export type ManualOpportunityKind =
  | 'copied_alert'
  | 'public_url'
  | 'public_post'
  | 'sales_navigator_alert'
  | 'referral_note';

export interface ParseManualOpportunityInput {
  kind: ManualOpportunityKind;
  content: string;
  capturedAt: string;
  sourceUrl?: string;
  title?: string;
  companyName?: string;
  contactName?: string;
  contactRole?: string;
  country?: string;
  region?: string;
}

export function parseManualOpportunity(input: ParseManualOpportunityInput): Lead {
  const content = normalizeContent(input.content);
  if (content.length < 20) {
    throw new Error('Opportunity content must contain at least 20 characters describing the requirement or signal.');
  }

  const sourceUrl = normalizeHttpUrl(input.sourceUrl ?? extractFirstUrl(content));
  if (input.kind === 'public_url' && !sourceUrl) {
    throw new Error('A valid public http/https URL is required for public URL intake.');
  }

  if (input.kind === 'sales_navigator_alert' || shouldUseLinkedInParser(input.kind, sourceUrl, content)) {
    const linkedIn = parseLinkedInSignal({
      text: input.kind === 'sales_navigator_alert' ? `Sales Navigator alert\n${content}` : content,
      capturedAt: input.capturedAt,
      sourceUrl,
      companyName: clean(input.companyName),
      contactName: clean(input.contactName),
      contactRole: clean(input.contactRole),
      country: clean(input.country),
      region: clean(input.region),
    });
    return {
      ...linkedIn,
      rawPayload: {
        manualIntake: manualEvidence(input, content, sourceUrl),
        parser: linkedIn.rawPayload,
      },
    };
  }

  const opportunityStatus = inferOpportunityStatus(content);
  const source = inferSource(input.kind);
  const leadType = inferLeadType(input.kind, opportunityStatus);
  const prospectStage = inferProspectStage(input.kind, opportunityStatus);
  const title = clean(input.title) ?? inferTitle(content, input.kind);
  const employmentOnly = isEmploymentOnly(content);
  const pipelineStatus = employmentOnly
    ? 'needs_research'
    : opportunityStatus === 'live_opportunity'
      ? 'new'
      : 'needs_human_review';

  return {
    id: stableManualLeadId(input.kind, sourceUrl, title, content),
    source,
    sourceUrl,
    leadType,
    prospectStage,
    title,
    description: content,
    companyName: clean(input.companyName),
    contactName: clean(input.contactName),
    contactRole: clean(input.contactRole),
    country: clean(input.country),
    region: clean(input.region),
    serviceCategory: inferServiceCategory(`${title} ${content}`),
    opportunityStatus,
    discoverySource: manualSourceLabel(input.kind),
    evidenceUrl: sourceUrl,
    evidenceSummary: evidenceSummary(input.kind, employmentOnly),
    discoveredAt: input.capturedAt,
    capturedAt: input.capturedAt,
    freshnessMinutes: 0,
    confidence: opportunityStatus === 'live_opportunity' && !employmentOnly ? 'medium' : 'low',
    feedback: { status: 'pending' },
    rawPayload: {
      manualIntake: manualEvidence(input, content, sourceUrl),
      employmentOnly,
      humanReviewRequired: true,
      externalActionAutomated: false,
    },
    pipelineStatus,
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt,
  };
}

function shouldUseLinkedInParser(kind: ManualOpportunityKind, sourceUrl: string | undefined, content: string): boolean {
  return kind === 'public_post'
    && (sourceUrl?.toLowerCase().includes('linkedin.com/') === true || /linkedin notification|linkedin\.com\//i.test(content));
}

function inferSource(kind: ManualOpportunityKind): LeadSource {
  if (kind === 'public_url' || kind === 'public_post' || kind === 'copied_alert') return 'public_web';
  return 'manual';
}

function inferLeadType(kind: ManualOpportunityKind, status: OpportunitySignalStatus): LeadType {
  if (kind === 'referral_note') return 'manual_lead';
  return status === 'partnership_target' ? 'partnership_target' : 'public_opportunity';
}

function inferProspectStage(kind: ManualOpportunityKind, status: OpportunitySignalStatus): ProspectStage {
  if (kind === 'referral_note') return 'manual_lead';
  return status === 'partnership_target' ? 'partner_prospect' : 'warm_lead';
}

function inferOpportunityStatus(text: string): OpportunitySignalStatus {
  const value = text.toLowerCase();
  if (containsAny(value, [
    'request for proposal', 'request for quotation', 'rfp', 'rfq', 'tender', 'expression of interest',
    'seeking a development partner', 'looking for a development partner', 'implementation partner',
    'technology partner', 'software vendor', 'agency required', 'fixed-scope project', 'fixed scope project',
    'contract project', 'statement of work', 'scope of work', 'build a platform', 'build an app',
    'develop a platform', 'develop an app', 'website redesign', 'website development',
  ])) return 'live_opportunity';
  if (containsAny(value, [
    'white label', 'white-label', 'delivery partner', 'outsourcing partner', 'overflow work',
    'agency partner', 'subcontracting partner', 'consortium partner',
  ])) return 'partnership_target';
  return 'recent_demand_signal';
}

function isEmploymentOnly(text: string): boolean {
  const value = text.toLowerCase();
  const employment = containsAny(value, [
    'full-time', 'full time', 'permanent role', 'permanent position', 'annual salary', 'salary range',
    'employee benefits', 'submit your resume', 'upload your resume', 'apply now', 'job opening',
    'work authorization', 'visa sponsorship', 'ideal candidate', 'join our team', 'we are hiring',
  ]);
  const project = containsAny(value, [
    'request for proposal', 'rfp', 'rfq', 'tender', 'fixed-scope', 'fixed scope', 'contract project',
    'statement of work', 'scope of work', 'development partner', 'implementation partner',
    'software vendor', 'agency required', 'project deliverables',
  ]);
  return employment && !project;
}

function inferServiceCategory(text: string): ServiceCategory {
  const value = text.toLowerCase();
  if (containsAny(value, ['rag', 'document intelligence', 'knowledge base', 'vector search'])) return 'rag_document_intelligence';
  if (containsAny(value, ['voice ai', 'voice agent', 'call agent', 'conversational voice'])) return 'voice_ai_agent';
  if (containsAny(value, ['ai agent', 'automation', 'workflow', 'n8n', 'make.com', 'zapier', 'artificial intelligence', 'llm'])) return 'ai_automation';
  if (containsAny(value, ['saas', 'mvp', 'minimum viable product'])) return 'ai_saas_mvp';
  if (containsAny(value, ['next.js', 'nextjs', 'react', 'node.js', 'python backend', 'full-stack', 'full stack'])) return 'fullstack_web_app';
  if (containsAny(value, ['unity', 'unreal', '3d', 'webar', 'webxr', 'augmented reality', 'virtual reality'])) return 'ar_3d_unity_unreal';
  if (containsAny(value, ['soc 2', 'soc2', 'hipaa', 'iso 27001', 'penetration testing', 'cybersecurity', 'compliance'])) return 'cybersecurity_compliance';
  if (containsAny(value, ['erp', 'crm', 'enterprise system', 'system integration', 'digital transformation'])) return 'enterprise_systems';
  if (containsAny(value, ['website', 'wordpress', 'webflow', 'portal', 'web application', 'web app'])) return 'website_portal';
  return 'unknown';
}

function inferTitle(content: string, kind: ManualOpportunityKind): string {
  const labelled = content.match(/^(?:title|opportunity|requirement|subject)\s*:\s*(.+)$/im)?.[1]?.trim();
  if (labelled) return shorten(labelled, 140);
  const firstLine = content.split('\n').map((line) => line.trim()).find(Boolean);
  if (firstLine && firstLine.length >= 8) return shorten(firstLine, 140);
  return `${manualSourceLabel(kind)} opportunity`;
}

function evidenceSummary(kind: ManualOpportunityKind, employmentOnly: boolean): string {
  if (employmentOnly) return 'Team-supplied employment signal retained for company research only; candidate application is outside the sales workflow.';
  if (kind === 'referral_note') return 'Referral or internal opportunity note supplied by an authenticated team member for human review.';
  if (kind === 'public_url') return 'Public opportunity URL supplied by an authenticated team member for qualification and human review.';
  if (kind === 'public_post') return 'Public post text supplied by an authenticated team member for qualification and human review.';
  return 'Copied opportunity alert supplied by an authenticated team member for qualification and human review.';
}

function manualEvidence(input: ParseManualOpportunityInput, content: string, sourceUrl: string | undefined) {
  return {
    kind: input.kind,
    originalContent: content,
    suppliedSourceUrl: sourceUrl,
    suppliedTitle: clean(input.title),
    suppliedCompanyName: clean(input.companyName),
    suppliedContactName: clean(input.contactName),
    suppliedContactRole: clean(input.contactRole),
    suppliedCountry: clean(input.country),
    suppliedRegion: clean(input.region),
    capturedAt: input.capturedAt,
  };
}

function manualSourceLabel(kind: ManualOpportunityKind): string {
  const labels: Record<ManualOpportunityKind, string> = {
    copied_alert: 'Approved copied opportunity alert',
    public_url: 'Approved public URL intake',
    public_post: 'Approved public post intake',
    sales_navigator_alert: 'Approved Sales Navigator alert',
    referral_note: 'Approved referral note',
  };
  return labels[kind];
}

function stableManualLeadId(kind: ManualOpportunityKind, sourceUrl: string | undefined, title: string, content: string): string {
  const seed = `${kind}|${sourceUrl ?? ''}|${title}|${content}`.toLowerCase().replace(/\s+/g, ' ').trim();
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `manual-${kind}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeContent(value: string): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function normalizeHttpUrl(value: string | undefined): string | undefined {
  const cleaned = clean(value);
  if (!cleaned) return undefined;
  try {
    const url = new URL(cleaned);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol.');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('sourceUrl must be a valid public http/https URL.');
  }
}

function extractFirstUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s)\]}>,]+/i)?.[0]?.replace(/[.,;:!?]+$/, '');
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function shorten(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}…`;
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}
