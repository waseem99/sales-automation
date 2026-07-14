import type { Lead } from '@sales-automation/shared';
import type { DiscoveryCandidate } from './types.js';

export interface TenderValidationResult {
  qualified: boolean;
  hardReject: boolean;
  reasons: string[];
  host?: string;
}

const BLOCKED_HOSTS = [
  'merriam-webster.com',
  'remoteok.com',
  'runoob.com',
  'csdn.net',
  'indeed.com',
  'glassdoor.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'wikipedia.org',
  'stackoverflow.com',
  'stackexchange.com',
  'github.com',
  'gitlab.com',
  'medium.com',
  'quora.com',
  'tutorialspoint.com',
  'w3schools.com',
  'geeksforgeeks.org',
  'programiz.com',
  'python.org',
  'npmjs.com',
  'pypi.org',
  'baidu.com',
  'zhihu.com',
];

const OFFICIAL_PORTAL_HOSTS: Array<{ portal: RegExp; hosts: string[] }> = [
  { portal: /Pakistan PPRA|EPADS/i, hosts: ['ppra.gov.pk', 'epms.ppra.gov.pk'] },
  { portal: /CanadaBuys/i, hosts: ['canadabuys.canada.ca'] },
  { portal: /UNGM/i, hosts: ['ungm.org'] },
];

const FORMAL_PATTERNS = [
  /\brequest for proposals?\b/i,
  /\brequest for quotations?\b/i,
  /\bexpression of interest\b/i,
  /\binvitation to (?:bid|tender)\b/i,
  /\bpre[- ]?qualification\b/i,
  /\brequest for information\b/i,
  /\bcall for proposals?\b/i,
  /\bimplementing partner\b/i,
  /\bframework agreement\b/i,
  /\bvendor empanelment\b/i,
  /\bsupply arrangement\b/i,
  /(?:^|[^a-z0-9])(rfp|rfq|eoi|itt|rfi)(?:[^a-z0-9]|$)/i,
  /\bprocurement notice\b/i,
  /\btender notice\b/i,
];

const STRONG_SERVICE_PATTERNS = [
  /\bsoftware development\b/i,
  /\bapplication development\b/i,
  /\bweb application\b/i,
  /\bmobile (?:application|app)\b/i,
  /\bwebsite (?:development|redesign|revamp)\b/i,
  /\bweb portal\b/i,
  /\bdigital platform\b/i,
  /\bmanagement information system\b/i,
  /\benterprise resource planning\b/i,
  /\bcustomer relationship management\b/i,
  /\blearning management system\b/i,
  /\bsystem integration\b/i,
  /\bapi development\b/i,
  /\bcloud migration\b/i,
  /\bpenetration testing\b/i,
  /\binformation security\b/i,
  /\bcybersecurity services?\b/i,
  /\bartificial intelligence\b/i,
  /\bmachine learning\b/i,
  /\bgenerative ai\b/i,
  /\bbusiness process automation\b/i,
  /\bdigital transformation\b/i,
  /\bit professional services\b/i,
  /\binformation technology services\b/i,
  /\bmanaged it services\b/i,
  /(?:^|[^a-z0-9])(mis|erp|crm|lms|rag)(?:[^a-z0-9]|$)/i,
];

const SUPPORTING_SERVICE_PATTERNS = [
  /\bsoftware\b/i,
  /\bapplication\b/i,
  /\bplatform\b/i,
  /\bportal\b/i,
  /\bwebsite\b/i,
  /\bdashboard\b/i,
  /\bautomation\b/i,
  /\bcybersecurity\b/i,
  /\bcloud\b/i,
  /\bdata (?:platform|analytics|warehouse|system)\b/i,
  /\bui\/?ux\b/i,
  /\bit services\b/i,
];

const CONTENT_OR_LEARNING_PATTERNS = [
  /\bdictionary\b/i,
  /\bthesaurus\b/i,
  /\bsynonyms?\b/i,
  /\bdefinition\b/i,
  /\btutorial\b/i,
  /\blearn (?:python|java|javascript|programming)\b/i,
  /\bhow to\b/i,
  /\bcode example\b/i,
  /\bdocumentation\b/i,
  /\bprogramming guide\b/i,
  /\bblog post\b/i,
  /\bremote job\b/i,
  /\bjob opening\b/i,
  /\bapply now\b/i,
  /\bcareer opportunity\b/i,
];

const PROCUREMENT_CONTEXT_PATTERNS = [
  /\bsubmission deadline\b/i,
  /\bclosing date\b/i,
  /\bbid security\b/i,
  /\btechnical proposal\b/i,
  /\bfinancial proposal\b/i,
  /\bterms of reference\b/i,
  /\bevaluation criteria\b/i,
  /\bprocuring (?:entity|agency|organization)\b/i,
  /\bprocurement department\b/i,
  /\bsealed bids?\b/i,
  /\bproposal submission\b/i,
  /\btender reference\b/i,
];

export function validateTenderCandidate(candidate: DiscoveryCandidate): TenderValidationResult {
  return validateTenderLike({
    sourceUrl: candidate.sourceUrl,
    title: candidate.title,
    description: candidate.summary,
    evidenceSummary: candidate.evidenceSummary,
    portal: candidate.tender?.portal,
    reference: candidate.tender?.reference,
    deadline: candidate.tender?.deadline,
    sourceType: candidate.sourceType,
  });
}

export function validateStoredTenderLead(lead: Lead): TenderValidationResult {
  return validateTenderLike({
    sourceUrl: lead.evidenceUrl ?? lead.sourceUrl ?? '',
    title: lead.title,
    description: lead.description,
    evidenceSummary: lead.evidenceSummary,
    portal: lead.tender?.portal ?? lead.discoverySource,
    reference: lead.tender?.reference,
    deadline: lead.tender?.deadline,
    sourceType: lead.source === 'public_procurement' ? 'procurement' : undefined,
  });
}

export function shouldRemoveStoredTenderLead(lead: Lead): boolean {
  const validation = validateStoredTenderLead(lead);
  const generatedByTenderPipeline = Boolean(lead.tender)
    || Boolean(asRecord(lead.rawPayload)?.tenderDiscovery);
  return validation.hardReject || (generatedByTenderPipeline && !validation.qualified);
}

function validateTenderLike(input: {
  sourceUrl: string;
  title: string;
  description: string;
  evidenceSummary?: string;
  portal?: string;
  reference?: string;
  deadline?: string;
  sourceType?: string;
}): TenderValidationResult {
  const reasons: string[] = [];
  const text = `${input.title} ${input.description} ${input.evidenceSummary ?? ''}`.replace(/\s+/g, ' ').trim();
  const host = hostname(input.sourceUrl);

  if (!host) return { qualified: false, hardReject: true, reasons: ['Source URL is missing or invalid.'] };
  if (isBlockedHost(host)) {
    return { qualified: false, hardReject: true, host, reasons: [`${host} is not an approved procurement or buyer source.`] };
  }
  if (input.sourceType === 'job_board') {
    return { qualified: false, hardReject: true, host, reasons: ['Job-board listings are not formal tenders.'] };
  }

  const portalRule = OFFICIAL_PORTAL_HOSTS.find((rule) => rule.portal.test(input.portal ?? ''));
  if (portalRule && !portalRule.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    return {
      qualified: false,
      hardReject: true,
      host,
      reasons: [`Result claimed to be from ${input.portal}, but its source host is ${host}.`],
    };
  }

  if (containsCjk(text)) {
    return { qualified: false, hardReject: true, host, reasons: ['Non-English/Non-French content is outside the current tender review workflow.'] };
  }
  if (CONTENT_OR_LEARNING_PATTERNS.some((pattern) => pattern.test(text))) {
    return { qualified: false, hardReject: true, host, reasons: ['The result is educational, editorial, dictionary, documentation or job content rather than procurement.'] };
  }

  const formal = FORMAL_PATTERNS.some((pattern) => pattern.test(text));
  const strongService = STRONG_SERVICE_PATTERNS.some((pattern) => pattern.test(text));
  const supportingServiceCount = SUPPORTING_SERVICE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const procurementContext = PROCUREMENT_CONTEXT_PATTERNS.some((pattern) => pattern.test(text));
  const officialPortal = Boolean(portalRule);
  const structuredNotice = Boolean(input.reference || input.deadline);

  if (!formal) reasons.push('No explicit RFP, RFQ, EOI, tender, procurement or equivalent formal notice language was found.');
  if (!strongService && supportingServiceCount < 2) reasons.push('No strong software, digital, AI, cybersecurity or IT-services requirement was found.');
  if (!officialPortal && !procurementContext && !structuredNotice) reasons.push('The result lacks a trusted portal, deadline/reference or procurement submission context.');

  return {
    qualified: reasons.length === 0,
    hardReject: false,
    host,
    reasons,
  };
}

function isBlockedHost(host: string): boolean {
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function hostname(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function containsCjk(value: string): boolean {
  const cjk = (value.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const letters = (value.match(/[A-Za-z\u00c0-\u024f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  return cjk >= 4 && cjk / Math.max(letters, 1) > 0.08;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
