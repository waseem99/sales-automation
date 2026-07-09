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

export type LinkedInAlertSourceType = 'sales_navigator_alert' | 'linkedin_notification' | 'manual_post' | 'unknown';

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

export interface LinkedInSignalExtraction {
  alertSourceType: LinkedInAlertSourceType;
  sourceUrl?: string;
  contactName?: string;
  contactRole?: string;
  companyName?: string;
  freshnessMinutes?: number;
  timelineSignal?: string;
}

export interface LinkedInSignalAnalysis {
  signalType: LinkedInSignalType;
  serviceCategory: ServiceCategory;
  confidence: number;
  extraction: LinkedInSignalExtraction;
  skipReasons: string[];
  reasons: string[];
}

export interface ParsedLinkedInLead extends Lead {
  rawPayload: {
    signalType: LinkedInSignalType;
    originalText: string;
    alertSourceType: LinkedInAlertSourceType;
    confidence: number;
    extractedSourceUrl?: string;
    extractedContactName?: string;
    extractedContactRole?: string;
    extractedCompanyName?: string;
    skipReasons: string[];
    reasons: string[];
  };
}

export function parseLinkedInSignal(input: ParseLinkedInSignalInput): ParsedLinkedInLead {
  const analysis = analyzeLinkedInSignal(input);

  return {
    id: createLeadId(input, analysis),
    source: analysis.extraction.alertSourceType === 'sales_navigator_alert' ? 'sales_navigator' : 'linkedin',
    sourceUrl: input.sourceUrl ?? analysis.extraction.sourceUrl,
    leadType: analysis.extraction.alertSourceType === 'sales_navigator_alert' ? 'linkedin_sales_nav_alert' : 'linkedin_warm_post',
    title: inferTitle(input.text, analysis.signalType, analysis.extraction),
    description: input.text.trim(),
    companyName: input.companyName ?? analysis.extraction.companyName,
    contactName: input.contactName ?? analysis.extraction.contactName,
    contactRole: input.contactRole ?? analysis.extraction.contactRole,
    country: input.country,
    region: input.region,
    serviceCategory: analysis.serviceCategory,
    timelineSignal: analysis.extraction.timelineSignal,
    capturedAt: input.capturedAt,
    freshnessMinutes: analysis.extraction.freshnessMinutes,
    rawPayload: {
      signalType: analysis.signalType,
      originalText: input.text,
      alertSourceType: analysis.extraction.alertSourceType,
      confidence: analysis.confidence,
      extractedSourceUrl: analysis.extraction.sourceUrl,
      extractedContactName: analysis.extraction.contactName,
      extractedContactRole: analysis.extraction.contactRole,
      extractedCompanyName: analysis.extraction.companyName,
      skipReasons: analysis.skipReasons,
      reasons: analysis.reasons,
    },
    pipelineStatus: analysis.skipReasons.length > 0 ? 'needs_human_review' : 'new',
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt,
  };
}

export function analyzeLinkedInSignal(input: ParseLinkedInSignalInput): LinkedInSignalAnalysis {
  const text = input.text.trim();
  const lower = text.toLowerCase();
  const alertSourceType = inferAlertSourceType(text);
  const signalType = inferSignalType(text);
  const serviceCategory = inferServiceCategory(text, signalType);
  const extraction: LinkedInSignalExtraction = {
    alertSourceType,
    sourceUrl: input.sourceUrl ?? extractLinkedInUrl(text) ?? extractFirstUrl(text),
    contactName: input.contactName ?? extractContactName(text),
    contactRole: input.contactRole ?? extractContactRole(text),
    companyName: input.companyName ?? extractCompanyName(text),
    freshnessMinutes: inferFreshnessMinutes(text),
    timelineSignal: inferTimelineSignal(text),
  };
  const reasons = buildReasons({ signalType, extraction, text });
  const confidence = calculateConfidence({ signalType, extraction, text });
  const skipReasons = buildSkipReasons({ signalType, extraction, confidence, text });

  return {
    signalType,
    serviceCategory,
    confidence,
    extraction,
    skipReasons,
    reasons,
  };
}

export function shouldSkipLinkedInSignal(input: ParseLinkedInSignalInput, minConfidence = 0.5): { skip: boolean; reasons: string[]; analysis: LinkedInSignalAnalysis } {
  const analysis = analyzeLinkedInSignal(input);
  const reasons = [...analysis.skipReasons];
  if (analysis.confidence < minConfidence) {
    reasons.push(`Confidence ${analysis.confidence} is below minimum ${minConfidence}.`);
  }
  return {
    skip: reasons.length > 0,
    reasons,
    analysis,
  };
}

function inferSignalType(text: string): LinkedInSignalType {
  const value = text.toLowerCase();

  if (containsAny(value, ['automation expert', 'workflow automation', 'ai automation', 'zapier', 'make.com', 'n8n'])) return 'looking_for_automation_help';
  if (containsAny(value, ['looking for ai', 'ai partner', 'ai developer', 'llm', 'rag', 'genai', 'generative ai'])) return 'looking_for_ai_partner';
  if (containsAny(value, ['website developer', 'web developer', 'website team', 'webflow', 'wordpress', 'website rebuild'])) return 'looking_for_website_team';
  if (containsAny(value, ['ar developer', 'vr developer', '3d team', 'unity developer', 'unreal developer'])) return 'looking_for_ar_3d_team';
  if (containsAny(value, ['outsourcing partner', 'white-label', 'white label', 'delivery partner', 'overflow work', 'implementation partner'])) return 'agency_needs_delivery_partner';
  if (containsAny(value, ['hiring full-stack', 'hiring full stack', 'hiring developer', 'hiring engineer', 'hiring ai', 'open role', 'job opening'])) return 'hiring_engineering_team';
  if (containsAny(value, ['raised funding', 'seed round', 'series a', 'scaling team', 'launching soon', 'expanding team'])) return 'funding_or_growth_signal';
  if (containsAny(value, ['refund', 'fraud', 'risk intelligence', 'banking intelligence', 'manual process', 'support backlog', 'customer support overload'])) return 'solution_relevant_pain';
  if (containsAny(value, ['looking for developer', 'need developer', 'recommend a developer', 'software agency', 'looking for a dev shop', 'need a dev team'])) return 'looking_for_developer';

  return 'other';
}

function inferAlertSourceType(text: string): LinkedInAlertSourceType {
  const value = text.toLowerCase();
  if (containsAny(value, ['sales navigator', 'saved search alert', 'lead alert', 'account alert'])) return 'sales_navigator_alert';
  if (containsAny(value, ['linkedin notification', 'linkedin.com/feed', 'linkedin.com/in/', 'linkedin.com/company/'])) return 'linkedin_notification';
  if (containsAny(value, ['posted', 'looking for', 'need', 'recommend'])) return 'manual_post';
  return 'unknown';
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

function inferTitle(text: string, signalType: LinkedInSignalType, extraction: LinkedInSignalExtraction): string {
  if (extraction.companyName && signalType !== 'other') {
    return `${extraction.companyName} — ${signalType.replace(/_/g, ' ')}`;
  }
  const firstSentence = text.trim().split(/[.!?\n]/)[0]?.trim();
  if (firstSentence && firstSentence.length <= 90) return firstSentence;
  return signalType.replace(/_/g, ' ');
}

function inferTimelineSignal(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (containsAny(lower, ['asap', 'urgent', 'immediately', 'this week'])) return 'Urgent warm LinkedIn signal';
  if (containsAny(lower, ['recommend', 'looking for', 'need help', 'need a', 'looking to hire'])) return 'Active warm LinkedIn demand signal';
  if (containsAny(lower, ['sales navigator', 'saved search alert', 'lead alert'])) return 'Sales Navigator alert signal';
  return undefined;
}

function inferFreshnessMinutes(text: string): number | undefined {
  const match = text.match(/(posted|shared|updated)?\s*(\d+)\s+(minute|minutes|hour|hours|day|days)\s+ago/i);
  if (!match) return undefined;

  const amount = Number(match[2]);
  const unit = match[3].toLowerCase();
  if (unit.startsWith('minute')) return amount;
  if (unit.startsWith('hour')) return amount * 60;
  if (unit.startsWith('day')) return amount * 1440;
  return undefined;
}

function extractContactName(text: string): string | undefined {
  const patterns = [
    /(?:lead|prospect|person|contact)\s*:\s*([^\n,|]+?)(?:\s+[-–—|•]\s+|,|\n|$)/i,
    /(?:new lead|lead alert)\s*:\s*([^\n,|]+?)(?:\s+[-–—|•]\s+|,|\n|$)/i,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:[-–—|•]|at)\s+/m,
  ];
  return firstPatternMatch(text, patterns);
}

function extractContactRole(text: string): string | undefined {
  const patterns = [
    /(?:role|title)\s*:\s*([^\n|]+?)(?:\n|\||$)/i,
    /(?:lead|prospect|person|contact)\s*:\s*[^\n,|]+?\s+[-–—|•]\s*([^\n@|]+?)(?:\s+at\s+|\||\n|$)/i,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+[-–—|•]\s*([^\n@|]+?)(?:\s+at\s+|\||\n|$)/m,
  ];
  const match = firstPatternMatch(text, patterns, 2) ?? firstPatternMatch(text, patterns, 1);
  return cleanupExtractedValue(match);
}

function extractCompanyName(text: string): string | undefined {
  const patterns = [
    /(?:company|account)\s*:\s*([^\n|]+?)(?:\n|\||$)/i,
    /\bat\s+([A-Z][A-Za-z0-9&.,' -]{2,80})(?:\n|\||\.|,|$)/,
    /(?:from|account alert for)\s+([A-Z][A-Za-z0-9&.,' -]{2,80})(?:\n|\||\.|,|$)/i,
  ];
  return firstPatternMatch(text, patterns);
}

function extractLinkedInUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i);
  return cleanupUrl(match?.[0]);
}

function extractFirstUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return cleanupUrl(match?.[0]);
}

function buildReasons(input: { signalType: LinkedInSignalType; extraction: LinkedInSignalExtraction; text: string }): string[] {
  const reasons: string[] = [];
  if (input.extraction.alertSourceType === 'sales_navigator_alert') reasons.push('Sales Navigator alert marker detected.');
  if (input.extraction.sourceUrl) reasons.push('Source URL extracted or supplied.');
  if (input.extraction.contactName) reasons.push('Contact name extracted or supplied.');
  if (input.extraction.companyName) reasons.push('Company name extracted or supplied.');
  if (input.extraction.freshnessMinutes !== undefined) reasons.push('Freshness signal extracted.');
  if (input.signalType !== 'other') reasons.push(`Actionable signal detected: ${input.signalType}.`);
  return reasons;
}

function calculateConfidence(input: { signalType: LinkedInSignalType; extraction: LinkedInSignalExtraction; text: string }): number {
  let score = 0;
  if (input.extraction.alertSourceType === 'sales_navigator_alert') score += 0.25;
  if (input.extraction.alertSourceType === 'linkedin_notification') score += 0.2;
  if (input.extraction.alertSourceType === 'manual_post') score += 0.1;
  if (input.signalType !== 'other') score += 0.3;
  if (input.extraction.sourceUrl) score += 0.15;
  if (input.extraction.contactName || input.extraction.companyName) score += 0.1;
  if (input.extraction.timelineSignal) score += 0.05;
  if (containsAny(input.text.toLowerCase(), ['unsubscribe', 'newsletter', 'digest only'])) score -= 0.25;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

function buildSkipReasons(input: { signalType: LinkedInSignalType; extraction: LinkedInSignalExtraction; confidence: number; text: string }): string[] {
  const reasons: string[] = [];
  const lower = input.text.toLowerCase();
  if (input.signalType === 'other') reasons.push('No actionable LinkedIn buying or partnership signal detected.');
  if (input.confidence < 0.5) reasons.push(`Low parser confidence: ${input.confidence}.`);
  if (containsAny(lower, ['newsletter', 'unsubscribe']) && !containsAny(lower, ['looking for', 'need', 'hiring', 'sales navigator'])) {
    reasons.push('Email/post appears to be a newsletter or generic digest, not a lead signal.');
  }
  return [...new Set(reasons)];
}

function firstPatternMatch(text: string, patterns: RegExp[], preferredGroup = 1): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[preferredGroup] ?? match?.[1];
    const cleaned = cleanupExtractedValue(value);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function cleanupExtractedValue(value?: string): string | undefined {
  const cleaned = value?.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/[.,;|•-]+$/g, '').trim();
  return cleaned || undefined;
}

function cleanupUrl(value?: string): string | undefined {
  return value?.replace(/[.,;]+$/, '').trim();
}

function createLeadId(input: ParseLinkedInSignalInput, analysis: LinkedInSignalAnalysis): string {
  const source = input.sourceUrl ?? analysis.extraction.sourceUrl ?? `${analysis.extraction.contactName ?? input.contactName ?? 'unknown'}-${input.text.slice(0, 60)}-${input.capturedAt}`;
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
  return `linkedin-${slug || 'manual-signal'}`;
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}
