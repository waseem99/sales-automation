import type { Lead, ServiceCategory } from '@sales-automation/shared';

export interface ParseUpworkEmailInput {
  emailBody: string;
  receivedAt: string;
}

export interface ParsedUpworkJobMetadata {
  title: string;
  url?: string;
  description: string;
  budgetSignal?: string;
  postedSignal?: string;
  jobType?: 'fixed_price' | 'hourly' | 'unknown';
  experienceLevel?: 'entry' | 'intermediate' | 'expert';
  clientPaymentVerified?: boolean;
  clientSpendUsd?: number;
  clientHireRate?: number;
  clientCountry?: string;
  proposalCount?: string;
}

export function parseUpworkEmail(input: ParseUpworkEmailInput): Lead[] {
  const blocks = splitIntoJobBlocks(input.emailBody);
  return blocks.map((block, index) => toLead(block, input.receivedAt, index));
}

function splitIntoJobBlocks(emailBody: string): ParsedUpworkJobMetadata[] {
  const normalized = emailBody.replace(/\r\n/g, '\n');
  const sections = normalized
    .split(/\n-{3,}\n|\nJob:\s*/i)
    .map((section) => section.trim())
    .filter(Boolean);

  const parsed = sections
    .map(parseJobBlock)
    .filter((block): block is ParsedUpworkJobMetadata => Boolean(block?.title && block.description));

  if (parsed.length > 0) return dedupeBlocks(parsed);
  const links = [...normalized.matchAll(/https?:\/\/(?:www\.)?upwork\.com\/(?:jobs\/[^\s<>()"']+|freelance-jobs\/apply\/[^\s<>()"']+)/gi)];
  return links.map((match, index) => {
    const start = Math.max(0, (match.index ?? 0) - 1200);
    const end = Math.min(normalized.length, (match.index ?? 0) + match[0].length + 2200);
    return parseJobBlock(normalized.slice(start, end)) ?? {
      title: `Upwork saved-search opportunity ${index + 1}`,
      url: canonicalUrl(match[0]),
      description: normalized.slice(start, end).replace(/\s+/g, ' ').trim(),
      jobType: 'unknown' as const,
    };
  });
}

function parseJobBlock(section: string): ParsedUpworkJobMetadata | null {
  const lines = section.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const url = findUrl(section);
  const titleLine = lines.find((line) => !/^https?:/i.test(line) && !isMetadataLine(line));
  const title = cleanLabel(titleLine ?? lines[0]);
  const budgetSignal = findBudgetSignal(section);
  const postedSignal = findPostedSignal(section);
  const description = lines
    .filter((line) => !/^https?:/i.test(line) && line !== titleLine)
    .filter((line) => !isMetadataLine(line))
    .join(' ')
    .trim();

  return {
    title,
    url,
    description: description || title,
    budgetSignal,
    postedSignal,
    jobType: inferJobType(section, budgetSignal),
    experienceLevel: inferExperienceLevel(section),
    clientPaymentVerified: inferPaymentVerification(section),
    clientSpendUsd: inferClientSpend(section),
    clientHireRate: inferHireRate(section),
    clientCountry: inferClientCountry(section),
    proposalCount: inferProposalCount(section),
  };
}

function toLead(block: ParsedUpworkJobMetadata, receivedAt: string, index: number): Lead {
  const freshnessMinutes = inferFreshnessMinutes(block.postedSignal);
  return {
    id: createStableLeadId(block, receivedAt, index),
    source: 'upwork',
    sourceUrl: block.url,
    leadType: 'upwork_job',
    prospectStage: 'warm_lead',
    title: block.title,
    description: block.description,
    country: block.clientCountry,
    serviceCategory: inferServiceCategory(`${block.title} ${block.description}`),
    opportunityStatus: 'live_opportunity',
    discoverySource: 'Upwork saved-search alert',
    evidenceUrl: block.url,
    evidenceSummary: block.description.slice(0, 500),
    budgetSignal: block.budgetSignal,
    timelineSignal: block.postedSignal,
    postedAt: inferPostedAt(receivedAt, freshnessMinutes),
    capturedAt: receivedAt,
    freshnessMinutes,
    rawPayload: {
      ...block,
      sourceKind: 'upwork_saved_search_alert',
    },
    pipelineStatus: 'new',
    createdAt: receivedAt,
    updatedAt: receivedAt,
  };
}

function inferServiceCategory(text: string): ServiceCategory {
  const value = text.toLowerCase();
  if (containsAny(value, ['rag', 'document intelligence', 'knowledge base', 'vector search', 'ocr'])) return 'rag_document_intelligence';
  if (containsAny(value, ['voice ai', 'voice agent', 'call agent', 'conversational ai'])) return 'voice_ai_agent';
  if (containsAny(value, ['ai agent', 'automation', 'workflow', 'n8n', 'make.com', 'zapier', 'chatbot', 'llm'])) return 'ai_automation';
  if (containsAny(value, ['saas', 'mvp', 'startup product'])) return 'ai_saas_mvp';
  if (containsAny(value, ['next.js', 'nextjs', 'react', 'node.js', 'python backend', 'full-stack', 'full stack', 'mobile app', 'software development'])) return 'fullstack_web_app';
  if (containsAny(value, ['unity', 'unreal', '3d', 'webar', 'ar app', 'vr', 'animation'])) return 'ar_3d_unity_unreal';
  if (containsAny(value, ['soc 2', 'soc2', 'hipaa', 'iso 27001', 'security', 'cybersecurity', 'compliance', 'penetration test'])) return 'cybersecurity_compliance';
  if (containsAny(value, ['erp', 'crm', 'enterprise system', 'digital transformation'])) return 'enterprise_systems';
  if (containsAny(value, ['website', 'wordpress', 'shopify', 'webflow', 'portal', 'web app', 'seo', 'digital marketing', 'branding'])) return 'website_portal';
  return 'unknown';
}

function findUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/(?:www\.)?upwork\.com\/(?:jobs\/[^\s<>()"']+|freelance-jobs\/apply\/[^\s<>()"']+)/i)?.[0];
  return match ? canonicalUrl(match) : undefined;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value.replace(/[).,;]+$/, ''));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|source|ref|frkscc|mp_source)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/[).,;]+$/, '');
  }
}

function findBudgetSignal(text: string): string | undefined {
  const fixed = text.match(/(?:budget|fixed[- ]?price)?\s*(?:\$|USD\s*)[0-9][0-9,]*(?:\s*-\s*(?:\$|USD\s*)?[0-9][0-9,]*)?/i);
  if (fixed) return fixed[0].trim();
  const hourly = text.match(/(?:\$|USD\s*)?[0-9]+(?:\.[0-9]+)?\s*-\s*(?:\$|USD\s*)?[0-9]+(?:\.[0-9]+)?\s*\/\s*(?:hr|hour)/i)
    ?? text.match(/(?:\$|USD\s*)[0-9]+(?:\.[0-9]+)?\s*\/\s*(?:hr|hour)/i);
  return hourly?.[0];
}

function findPostedSignal(text: string): string | undefined {
  return text.match(/posted\s+(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)\s+ago/i)?.[0]
    ?? text.match(/(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)\s+ago/i)?.[0];
}

function inferFreshnessMinutes(postedSignal?: string): number | undefined {
  if (!postedSignal) return undefined;
  const match = postedSignal.match(/(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)/i);
  if (!match?.[1] || !match[2]) return undefined;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('minute')) return amount;
  if (unit.startsWith('hour')) return amount * 60;
  if (unit.startsWith('day')) return amount * 1440;
  if (unit.startsWith('week')) return amount * 10080;
  return undefined;
}

function inferPostedAt(receivedAt: string, freshnessMinutes?: number): string | undefined {
  if (freshnessMinutes === undefined || !Number.isFinite(Date.parse(receivedAt))) return undefined;
  return new Date(Date.parse(receivedAt) - freshnessMinutes * 60_000).toISOString();
}

function inferJobType(text: string, budgetSignal?: string): 'fixed_price' | 'hourly' | 'unknown' {
  if (/fixed[- ]?price/i.test(text)) return 'fixed_price';
  if (/hourly|\/\s*(?:hr|hour)/i.test(`${text} ${budgetSignal ?? ''}`)) return 'hourly';
  return 'unknown';
}

function inferExperienceLevel(text: string): 'entry' | 'intermediate' | 'expert' | undefined {
  if (/\bexpert\b/i.test(text)) return 'expert';
  if (/\bintermediate\b/i.test(text)) return 'intermediate';
  if (/\bentry[- ]?level\b/i.test(text)) return 'entry';
  return undefined;
}

function inferPaymentVerification(text: string): boolean | undefined {
  if (/payment\s+(?:method\s+)?verified/i.test(text)) return true;
  if (/payment\s+(?:method\s+)?unverified/i.test(text)) return false;
  return undefined;
}

function inferClientSpend(text: string): number | undefined {
  const match = text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)\s*([km])?\+?\s+spent/i);
  if (!match?.[1]) return undefined;
  const amount = Number(match[1]);
  const multiplier = match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1;
  return Math.round(amount * multiplier);
}

function inferHireRate(text: string): number | undefined {
  const match = text.match(/([0-9]{1,3})%\s+hire\s+rate/i);
  if (!match?.[1]) return undefined;
  return Math.min(100, Number(match[1]));
}

function inferClientCountry(text: string): string | undefined {
  const labelled = text.match(/(?:client\s+location|location|country)\s*:\s*([^\n|•]{2,60})/i)?.[1]?.trim();
  if (labelled) return labelled;
  const countries = ['United States', 'United Kingdom', 'Canada', 'Australia', 'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Germany', 'France', 'Netherlands', 'Ireland', 'Singapore', 'Pakistan'];
  return countries.find((country) => new RegExp(`\\b${country.replace(/ /g, '\\s+')}\\b`, 'i').test(text));
}

function inferProposalCount(text: string): string | undefined {
  return text.match(/proposals?\s*:\s*([^\n|•]{1,40})/i)?.[1]?.trim()
    ?? text.match(/(?:less than|fewer than)\s+\d+\s+proposals?/i)?.[0]
    ?? text.match(/\d+\s*(?:to|-)\s*\d+\s+proposals?/i)?.[0];
}

function isMetadataLine(line: string): boolean {
  return /^(?:posted|budget|fixed[- ]?price|hourly|experience level|payment|client location|location|country|proposals?|hire rate|\$.*spent)/i.test(line);
}

function cleanLabel(value: string): string {
  return value.replace(/^title:\s*/i, '').replace(/^new job:?\s*/i, '').trim();
}

function createStableLeadId(block: ParsedUpworkJobMetadata, receivedAt: string, index: number): string {
  const source = block.url ?? `${block.title}-${receivedAt}-${index}`;
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `upwork-${slug || index}`;
}

function dedupeBlocks(blocks: ParsedUpworkJobMetadata[]): ParsedUpworkJobMetadata[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = block.url?.toLowerCase() ?? `${block.title.toLowerCase()}|${block.description.slice(0, 120).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}
