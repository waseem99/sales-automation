import type { Lead, OpportunitySignalStatus } from '@sales-automation/shared';
import type { DiscoveryCandidate } from './types.js';

export interface ProspectValidationResult {
  qualified: boolean;
  hardReject: boolean;
  reasonCodes: string[];
  reasons: string[];
  host?: string;
}

export interface StoredProspectFalsePositive {
  leadId: string;
  sourceUrl?: string;
  title: string;
  reasonCodes: string[];
  reasons: string[];
}

const BLOCKED_AUTOMATIC_HOSTS = [
  'wikipedia.org',
  'wikimedia.org',
  'imdb.com',
  'fandom.com',
  'rottentomatoes.com',
  'themoviedb.org',
  'thetvdb.com',
  'tvguide.com',
  'britannica.com',
  'merriam-webster.com',
  'dictionary.com',
  'thesaurus.com',
  'wiktionary.org',
  'youtube.com',
  'pinterest.com',
  'stackoverflow.com',
  'stackexchange.com',
  'github.com',
  'gitlab.com',
  'medium.com',
  'quora.com',
];

const FORMAL_OPPORTUNITY_PATTERNS = [
  /\brequest for proposals?\b/i,
  /\brequest for quotations?\b/i,
  /(?:^|[^a-z0-9])(?:rfp|rfq|eoi|itt|rfi)(?:[^a-z0-9]|$)/i,
  /\bexpression of interest\b/i,
  /\binvitation to (?:bid|tender)\b/i,
  /\bcall for proposals?\b/i,
  /\bprocurement notice\b/i,
  /\btender notice\b/i,
  /\bstatement of work\b/i,
  /\bscope of work\b/i,
  /\bsealed bids?\b/i,
  /\btechnical and financial proposals?\b/i,
];

const BUYER_REQUEST_PATTERNS = [
  /\b(?:we|our company|our organization|the organization|the company|the client)\s+(?:is|are)\s+(?:looking|seeking|searching)\s+for\s+(?:an?\s+)?(?:external\s+)?(?:software\s+|technology\s+|development\s+|implementation\s+|digital\s+|ai\s+)?(?:agency|vendor|partner|consultant|provider|team|firm)\b/i,
  /\b(?:looking|seeking|searching)\s+for\s+(?:an?\s+)?(?:external\s+)?(?:software\s+|technology\s+|development\s+|implementation\s+|digital\s+|ai\s+)?(?:agency|vendor|partner|consultant|provider|team|firm)\s+(?:to|for)\b/i,
  /\b(?:need|needs|require|requires|required)\s+(?:an?\s+)?(?:external\s+)?(?:software\s+|technology\s+|development\s+|implementation\s+|digital\s+|ai\s+)?(?:agency|vendor|partner|consultant|provider|team|firm)\b/i,
  /\b(?:invite|invites|inviting|solicit|solicits|soliciting)\s+(?:qualified\s+)?(?:firms|vendors|agencies|consultants|providers|partners|proposals|bids)\b/i,
  /\b(?:engage|engaging|hire|hiring|select|selecting)\s+(?:an?\s+)?(?:external\s+)?(?:agency|vendor|partner|consultant|provider|development team|software firm)\b/i,
  /\b(?:vendor|agency|implementation partner|development partner|technology partner|consultant|service provider)\s+(?:required|needed|wanted)\b/i,
  /\b(?:outsourcing|outsource)\s+(?:the\s+)?(?:development|implementation|maintenance|software|project)\b/i,
  /\b(?:contract|fixed[- ]price|fixed[- ]scope)\s+(?:software|development|implementation|consulting|project|engagement)\b/i,
];

const REFERENCE_OR_ENTERTAINMENT_PATTERNS = [
  /\b(?:free )?encyclopedia\b/i,
  /\bwiki(?:pedia|media|tionary)?\b/i,
  /\bimdb\b/i,
  /\b(?:tv series|tv movie|television series|feature film|short film|movie|episode|season|cast and crew|plot summary|soundtrack)\b/i,
  /\b(?:dictionary|thesaurus|definition|synonyms?|glossary)\b/i,
];

const EDITORIAL_OR_LEARNING_PATTERNS = [
  /\bbeginner['’]?s guide\b/i,
  /\bcomplete guide\b/i,
  /\bguide to\b/i,
  /\bhow to\b/i,
  /\bwhat is\b/i,
  /\btutorial\b/i,
  /\bexplained\b/i,
  /\blearn(?:ing)?\s+(?:seo|software|programming|development|javascript|python|marketing)\b/i,
  /\bcase study\b/i,
  /\bpodcast\b/i,
  /\bwebinar\b/i,
  /\bnews(?:letter)?\b/i,
];

const CONTENT_PATH_PATTERNS = [
  /^\/wiki\//i,
  /^\/title\/tt\d+/i,
  /\/(?:movie|movies|film|films|tv|shows?|episodes?|cast)(?:\/|$)/i,
  /\/(?:blog|blogs|article|articles|learn|learning|academy|resources?|guides?|tutorials?|glossary|dictionary|thesaurus|docs|documentation|news)(?:\/|$)/i,
  /\/(?:beginner|beginners)-guide(?:\/|-|$)/i,
];

export function hasResultLevelProjectOpportunityIntent(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return FORMAL_OPPORTUNITY_PATTERNS.some((pattern) => pattern.test(normalized))
    || BUYER_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function validateAutomaticProspectCandidate(candidate: DiscoveryCandidate): ProspectValidationResult {
  return validateProspectLike({
    sourceUrl: candidate.sourceUrl,
    title: candidate.title,
    description: candidate.summary,
    evidenceSummary: candidate.evidenceSummary,
    opportunityStatus: candidate.opportunityStatus,
    sourceType: candidate.sourceType,
  });
}

export function validateStoredAutomaticProspectLead(lead: Lead): ProspectValidationResult {
  if (!isAutomaticDiscoveryLead(lead)) return accepted();
  return validateProspectLike({
    sourceUrl: lead.evidenceUrl ?? lead.sourceUrl ?? '',
    title: lead.title,
    description: lead.description,
    evidenceSummary: lead.evidenceSummary,
    opportunityStatus: lead.opportunityStatus,
    sourceType: automaticSourceType(lead),
  });
}

export function findStoredAutomaticProspectFalsePositives(leads: Lead[]): StoredProspectFalsePositive[] {
  return leads.flatMap((lead) => {
    if (lead.tender || !isAutomaticDiscoveryLead(lead)) return [];
    const validation = validateStoredAutomaticProspectLead(lead);
    if (validation.qualified || !validation.hardReject) return [];
    return [{
      leadId: lead.id,
      sourceUrl: lead.evidenceUrl ?? lead.sourceUrl,
      title: lead.title,
      reasonCodes: validation.reasonCodes,
      reasons: validation.reasons,
    }];
  });
}

export function isAutomaticDiscoveryLead(lead: Lead): boolean {
  const payload = asRecord(lead.rawPayload);
  if (asRecord(payload?.prospectDiscovery)) return true;
  return /^(Bing RSS:|RSS:|RemoteOK|Greenhouse:|Lever:)/i.test(lead.discoverySource ?? '');
}

function validateProspectLike(input: {
  sourceUrl: string;
  title: string;
  description: string;
  evidenceSummary?: string;
  opportunityStatus?: OpportunitySignalStatus;
  sourceType?: string;
}): ProspectValidationResult {
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const parsed = parsePublicUrl(input.sourceUrl);
  if (!parsed) return rejected('invalid_source_url', 'The source URL is missing, malformed or not public HTTP(S).');

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (isBlockedHost(host)) {
    return rejected('blocked_reference_or_content_host', `${host} is a reference, entertainment, social-content or developer-content host rather than a buyer source.`, host);
  }

  const text = `${input.title} ${input.description} ${input.evidenceSummary ?? ''}`.replace(/\s+/g, ' ').trim();
  const explicitProjectIntent = hasResultLevelProjectOpportunityIntent(text);
  const referenceContent = REFERENCE_OR_ENTERTAINMENT_PATTERNS.some((pattern) => pattern.test(text));
  const editorialContent = EDITORIAL_OR_LEARNING_PATTERNS.some((pattern) => pattern.test(text));
  const contentPath = CONTENT_PATH_PATTERNS.some((pattern) => pattern.test(parsed.pathname));

  if (referenceContent) {
    reasonCodes.push('reference_or_entertainment_content');
    reasons.push('The result is reference, entertainment, movie/TV, dictionary or encyclopedia content rather than a buyer opportunity.');
  }
  if ((editorialContent || contentPath) && !explicitProjectIntent) {
    reasonCodes.push('editorial_or_learning_content');
    reasons.push('The result is a guide, tutorial, article, news/resource page or other learning content without an explicit buyer-side project request.');
  }
  if (input.opportunityStatus === 'live_opportunity' && !explicitProjectIntent) {
    reasonCodes.push('missing_result_level_project_intent');
    reasons.push('A live opportunity must contain explicit project, procurement, vendor, agency or implementation intent in the result evidence itself.');
  }
  if (input.sourceType === 'job_board' && input.opportunityStatus === 'live_opportunity' && !explicitProjectIntent) {
    reasonCodes.push('employee_route_not_project_route');
    reasons.push('An employee vacancy cannot be treated as a live sales opportunity without explicit contract-project intent.');
  }

  return {
    qualified: reasonCodes.length === 0,
    hardReject: reasonCodes.length > 0,
    reasonCodes: unique(reasonCodes),
    reasons: unique(reasons),
    host,
  };
}

function accepted(): ProspectValidationResult {
  return { qualified: true, hardReject: false, reasonCodes: [], reasons: [] };
}

function rejected(code: string, reason: string, host?: string): ProspectValidationResult {
  return { qualified: false, hardReject: true, reasonCodes: [code], reasons: [reason], host };
}

function parsePublicUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.local') || host === '127.0.0.1' || host === '::1') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function isBlockedHost(host: string): boolean {
  return BLOCKED_AUTOMATIC_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function automaticSourceType(lead: Lead): string | undefined {
  const payload = asRecord(lead.rawPayload);
  const discovery = asRecord(payload?.prospectDiscovery);
  return typeof discovery?.sourceType === 'string' ? discovery.sourceType : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
