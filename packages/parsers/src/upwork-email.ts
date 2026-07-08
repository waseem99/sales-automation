import type { Lead, ServiceCategory } from '@sales-automation/shared';

export interface ParseUpworkEmailInput {
  emailBody: string;
  receivedAt: string;
}

interface ParsedJobBlock {
  title: string;
  url?: string;
  description: string;
  budgetSignal?: string;
  postedSignal?: string;
}

export function parseUpworkEmail(input: ParseUpworkEmailInput): Lead[] {
  const blocks = splitIntoJobBlocks(input.emailBody);

  return blocks.map((block, index) => toLead(block, input.receivedAt, index));
}

function splitIntoJobBlocks(emailBody: string): ParsedJobBlock[] {
  const normalized = emailBody.replace(/\r\n/g, '\n');
  const sections = normalized
    .split(/\n-{3,}\n|\nJob:\s*/i)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections
    .map(parseJobBlock)
    .filter((block): block is ParsedJobBlock => Boolean(block?.title && block.description));
}

function parseJobBlock(section: string): ParsedJobBlock | null {
  const lines = section.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const title = cleanLabel(lines[0]);
  const url = findUrl(section);
  const budgetSignal = findBudgetSignal(section);
  const postedSignal = findPostedSignal(section);
  const description = lines.slice(1).filter((line) => !line.startsWith('http')).join(' ');

  return {
    title,
    url,
    description: description || title,
    budgetSignal,
    postedSignal,
  };
}

function toLead(block: ParsedJobBlock, receivedAt: string, index: number): Lead {
  return {
    id: createStableLeadId(block, receivedAt, index),
    source: 'upwork',
    sourceUrl: block.url,
    leadType: 'upwork_job',
    title: block.title,
    description: block.description,
    serviceCategory: inferServiceCategory(`${block.title} ${block.description}`),
    budgetSignal: block.budgetSignal,
    timelineSignal: block.postedSignal,
    capturedAt: receivedAt,
    freshnessMinutes: inferFreshnessMinutes(block.postedSignal),
    rawPayload: block,
    pipelineStatus: 'new',
    createdAt: receivedAt,
    updatedAt: receivedAt,
  };
}

function inferServiceCategory(text: string): ServiceCategory {
  const value = text.toLowerCase();

  if (containsAny(value, ['rag', 'document intelligence', 'knowledge base', 'vector search'])) return 'rag_document_intelligence';
  if (containsAny(value, ['ai agent', 'automation', 'workflow', 'n8n', 'make.com', 'zapier'])) return 'ai_automation';
  if (containsAny(value, ['saas', 'mvp'])) return 'ai_saas_mvp';
  if (containsAny(value, ['next.js', 'nextjs', 'react', 'node.js', 'python backend', 'full-stack', 'full stack'])) return 'fullstack_web_app';
  if (containsAny(value, ['voice ai', 'voice agent', 'call agent'])) return 'voice_ai_agent';
  if (containsAny(value, ['unity', 'unreal', '3d', 'webar', 'ar app', 'vr'])) return 'ar_3d_unity_unreal';
  if (containsAny(value, ['soc 2', 'soc2', 'hipaa', 'iso 27001', 'security', 'cybersecurity', 'compliance'])) return 'cybersecurity_compliance';
  if (containsAny(value, ['website', 'portal', 'web app'])) return 'website_portal';

  return 'unknown';
}

function findUrl(text: string): string | undefined {
  return text.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,]+$/, '');
}

function findBudgetSignal(text: string): string | undefined {
  const budgetMatch = text.match(/(\$|USD\s*)[0-9][0-9,]*(\s*-\s*(\$|USD\s*)?[0-9][0-9,]*)?/i);
  if (budgetMatch) return budgetMatch[0];

  const hourlyMatch = text.match(/[0-9]+\s*-\s*[0-9]+\s*\/\s*hr/i);
  if (hourlyMatch) return hourlyMatch[0];

  return undefined;
}

function findPostedSignal(text: string): string | undefined {
  return text.match(/posted\s+(\d+)\s+(minute|minutes|hour|hours|day|days)\s+ago/i)?.[0];
}

function inferFreshnessMinutes(postedSignal?: string): number | undefined {
  if (!postedSignal) return undefined;

  const match = postedSignal.match(/(\d+)\s+(minute|minutes|hour|hours|day|days)/i);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit.startsWith('minute')) return amount;
  if (unit.startsWith('hour')) return amount * 60;
  if (unit.startsWith('day')) return amount * 1440;
  return undefined;
}

function cleanLabel(value: string): string {
  return value.replace(/^title:\s*/i, '').trim();
}

function createStableLeadId(block: ParsedJobBlock, receivedAt: string, index: number): string {
  const source = block.url ?? `${block.title}-${receivedAt}-${index}`;
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `upwork-${slug || index}`;
}

function containsAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}
