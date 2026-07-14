import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type {
  TenderAmendmentStatus,
  TenderDocumentFormat,
  TenderDocumentIntelligence,
  TenderSourceCitation,
} from '@sales-automation/shared';
import type { DiscoveryCandidate, ProspectFetch } from './types.js';

const DEFAULT_MAX_BYTES = 4_000_000;
const MAX_DOCUMENTS = 2;
const MAX_EXTRACTED_TEXT = 160_000;

const rolePatterns: Array<[RegExp, string]> = [
  [/\bproject manager\b/i, 'Project Manager'],
  [/\bteam lead\b/i, 'Team Lead'],
  [/\bsoftware architect\b|\bsolution architect\b/i, 'Software/Solution Architect'],
  [/\bbusiness analyst\b/i, 'Business Analyst'],
  [/\bui\/?ux\b|\buser experience designer\b/i, 'UI/UX Specialist'],
  [/\bquality assurance\b|\bqa engineer\b|\btest engineer\b/i, 'QA/Test Engineer'],
  [/\bdevops\b|\bcloud engineer\b/i, 'DevOps/Cloud Engineer'],
  [/\bcybersecurity\b|\binformation security specialist\b/i, 'Cybersecurity Specialist'],
  [/\bdata scientist\b|\bmachine learning engineer\b|\bai engineer\b/i, 'AI/ML Specialist'],
  [/\bfull[- ]?stack developer\b|\bsoftware developer\b|\bsoftware engineer\b/i, 'Software Developer'],
  [/\btrainer\b|\btraining specialist\b/i, 'Trainer'],
];

export async function enrichTenderDocumentIntelligence(
  fetchImpl: ProspectFetch,
  candidate: DiscoveryCandidate,
  checkedAt: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<DiscoveryCandidate> {
  if (!candidate.tender) return candidate;

  const sourceTexts: ExtractedSource[] = [];
  const documentUrls = new Set<string>();
  let format: TenderDocumentFormat = 'notice_summary';

  const source = await fetchTenderSource(fetchImpl, candidate.sourceUrl, maxBytes);
  if (source) {
    sourceTexts.push(source);
    format = source.format;
    for (const url of source.documentUrls) documentUrls.add(url);
  }

  for (const url of [...documentUrls].slice(0, MAX_DOCUMENTS)) {
    if (normalizeUrl(url) === normalizeUrl(candidate.sourceUrl)) continue;
    const document = await fetchTenderSource(fetchImpl, url, maxBytes);
    if (!document) continue;
    sourceTexts.push(document);
    if (document.format === 'pdf_text') format = 'pdf_text';
    for (const nested of document.documentUrls) documentUrls.add(nested);
  }

  const fallback = `${candidate.title}\n${candidate.summary}\n${candidate.evidenceSummary ?? ''}`;
  const combined = normalizeText([fallback, ...sourceTexts.map((item) => item.text)].filter(Boolean).join('\n'))
    .slice(0, MAX_EXTRACTED_TEXT);
  const usableDocumentText = sourceTexts.some((item) => item.text.length >= 80);
  if (!usableDocumentText && combined.length < 80) format = 'unavailable';

  const intelligence = analyzeTenderText({
    candidate,
    checkedAt,
    format,
    text: combined,
    sourceTexts,
    documentUrls: [...documentUrls],
  });

  return {
    ...candidate,
    summary: intelligence.scopeSummary
      ? `${candidate.summary}\n\nDocument scope: ${intelligence.scopeSummary}`.slice(0, 2_500)
      : candidate.summary,
    evidenceSummary: intelligence.contentHash
      ? `${candidate.evidenceSummary ?? `Formal procurement opportunity from ${candidate.tender.portal}.`} Document intelligence checked ${checkedAt}.`
      : candidate.evidenceSummary,
    tender: {
      ...candidate.tender,
      deadline: candidate.tender.deadline ?? inferSubmissionDeadline(combined),
      estimatedValue: candidate.tender.estimatedValue ?? extractEstimatedValue(combined),
      submissionMethod: intelligence.submissionMethod ?? candidate.tender.submissionMethod,
      eligibilitySignals: unique([
        ...(candidate.tender.eligibilitySignals ?? []),
        ...intelligence.eligibilityRequirements,
      ]).slice(0, 12),
      documentIntelligence: intelligence,
    },
  };
}

export function analyzeTenderText(input: {
  candidate: DiscoveryCandidate;
  checkedAt: string;
  format: TenderDocumentFormat;
  text: string;
  sourceTexts?: ExtractedSource[];
  documentUrls?: string[];
  amendmentStatus?: TenderAmendmentStatus;
}): TenderDocumentIntelligence {
  const text = normalizeText(input.text).slice(0, MAX_EXTRACTED_TEXT);
  const lines = meaningfulLines(text);
  const scopeSummary = extractScopeSummary(text);
  const deliverables = extractList(lines, /\bdeliverables?\b|\bscope of work\b|\bservices required\b/i, [
    /\bdevelop\b/i, /\bdesign\b/i, /\bimplement\b/i, /\bconfigure\b/i, /\bintegrat(?:e|ion)\b/i,
    /\bdeploy\b/i, /\bmigrat(?:e|ion)\b/i, /\btrain(?:ing)?\b/i, /\bmaintenance\b/i, /\bsupport\b/i,
  ], 10);
  const eligibilityRequirements = extractList(lines, /\beligibility\b|\bqualification requirements?\b|\bminimum requirements?\b/i, [
    /\bmust (?:have|be|provide)\b/i, /\bminimum\b/i, /\byears? of experience\b/i, /\bsimilar (?:projects?|assignments?)\b/i,
    /\bregistered\b/i, /\bcertification\b/i, /\bfinancial capacity\b/i, /\baudited accounts?\b/i,
  ], 10);
  const evaluationCriteria = extractList(lines, /\bevaluation criteria\b|\bproposal evaluation\b|\bscoring criteria\b/i, [
    /\btechnical proposal\b/i, /\bfinancial proposal\b/i, /\bmarks?\b/i, /\bpoints?\b/i, /\bweight(?:ing|age)?\b/i,
    /\bmethodology\b/i, /\bexperience\b/i, /\bteam composition\b/i,
  ], 10);
  const requiredTeamRoles = unique(rolePatterns.flatMap(([pattern, label]) => pattern.test(text) ? [label] : []));
  const requiredCvCount = extractCvCount(text);
  const bidSecurity = extractFirst(text, [
    /(?:bid security|earnest money|bid bond)\s*(?:of|:|-)?\s*([^\n.;]{3,100})/i,
    /([^\n.;]{3,80}\s+(?:bid security|earnest money|bid bond))/i,
  ]);
  const clarificationDeadline = extractClarificationDeadline(text);
  const submissionMethod = extractSubmissionMethod(lines);
  const localPresenceEvidence = extractLine(lines, /local office|required to be registered|registered in (?:pakistan|canada)|resident supplier|local presence|national firm/i);
  const consortiumEvidence = extractLine(lines, /consortium|joint venture|association of firms|subcontract(?:ing|or)|local partner/i);
  const contentHash = text.length >= 80 ? createHash('sha256').update(text).digest('hex') : undefined;
  const citations = buildCitations(input.candidate, input.sourceTexts ?? [], scopeSummary, eligibilityRequirements, evaluationCriteria);
  const missingInformation = buildMissingInformation({
    scopeSummary,
    deliverables,
    eligibilityRequirements,
    evaluationCriteria,
    submissionMethod,
    deadline: input.candidate.tender?.deadline ?? inferSubmissionDeadline(text),
    bidSecurity,
  });

  const base: Omit<TenderDocumentIntelligence, 'bidNoBidBrief'> = {
    checkedAt: input.checkedAt,
    format: input.format,
    contentHash,
    documentUrls: unique([input.candidate.sourceUrl, ...(input.documentUrls ?? [])].filter(Boolean)),
    citations,
    scopeSummary,
    deliverables,
    eligibilityRequirements,
    evaluationCriteria,
    requiredTeamRoles,
    requiredCvCount,
    bidSecurity,
    clarificationDeadline,
    submissionMethod,
    localPresenceEvidence,
    consortiumEvidence,
    amendmentStatus: input.amendmentStatus ?? (contentHash ? 'new' : 'unavailable'),
    missingInformation,
  };

  return {
    ...base,
    bidNoBidBrief: buildBidNoBidBrief(input.candidate, base),
  };
}

export function withAmendmentStatus(
  intelligence: TenderDocumentIntelligence,
  status: TenderAmendmentStatus,
  summary?: string,
): TenderDocumentIntelligence {
  const updated = { ...intelligence, amendmentStatus: status, amendmentSummary: summary };
  return { ...updated, bidNoBidBrief: replaceBriefAmendment(updated.bidNoBidBrief, status, summary) };
}

export function extractTextFromPdfBytes(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  if (!buffer.subarray(0, 8).toString('latin1').includes('%PDF-')) return '';
  const raw = buffer.toString('latin1');
  const segments = [raw];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(streamPattern)) {
    const dictionary = match[1] ?? '';
    const stream = Buffer.from(match[2] ?? '', 'latin1');
    if (!/FlateDecode/i.test(dictionary)) {
      segments.push(stream.toString('latin1'));
      continue;
    }
    try {
      segments.push(inflateSync(stream).toString('latin1'));
    } catch {
      // Some PDFs use predictors or object streams that this safe text-only extractor cannot decode.
    }
  }

  const output: string[] = [];
  for (const segment of segments) {
    for (const block of segment.matchAll(/BT([\s\S]*?)ET/g)) {
      const content = block[1] ?? '';
      for (const match of content.matchAll(/(\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>)\s*Tj/g)) {
        output.push(decodePdfToken(match[1] ?? ''));
      }
      for (const match of content.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
        const array = match[1] ?? '';
        for (const token of array.matchAll(/\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>/g)) {
          output.push(decodePdfToken(token[0]));
        }
      }
      if (/\bT\*\b|\bTd\b|\bTD\b/.test(content)) output.push('\n');
    }
  }
  return normalizeText(output.join(' ')).slice(0, MAX_EXTRACTED_TEXT);
}

interface ExtractedSource {
  url: string;
  format: TenderDocumentFormat;
  text: string;
  documentUrls: string[];
}

async function fetchTenderSource(fetchImpl: ProspectFetch, url: string, maxBytes: number): Promise<ExtractedSource | undefined> {
  if (!isPublicHttpUrl(url)) return undefined;
  try {
    const response = await fetchWithTimeout(fetchImpl, url);
    if (!response.ok) return undefined;
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > maxBytes) return undefined;
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) return undefined;

    const pdf = contentType.includes('application/pdf') || /\.pdf(?:$|[?#])/i.test(url) || Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
    if (pdf) {
      const text = extractTextFromPdfBytes(bytes);
      return { url, format: text ? 'pdf_text' : 'unavailable', text, documentUrls: [] };
    }

    const html = Buffer.from(bytes).toString('utf8');
    const text = stripHtml(html).slice(0, MAX_EXTRACTED_TEXT);
    return {
      url,
      format: /<html|<body|<main|<article/i.test(html) ? 'html' : 'notice_summary',
      text,
      documentUrls: extractDocumentUrls(html, url),
    };
  } catch {
    return undefined;
  }
}

function extractDocumentUrls(html: string, baseUrl: string): string[] {
  const candidates = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      try {
        const url = new URL(match[1] ?? '', baseUrl).toString();
        const label = stripHtml(match[2] ?? '');
        return { url, label };
      } catch {
        return undefined;
      }
    })
    .filter((item): item is { url: string; label: string } => Boolean(item))
    .filter((item) => /\.pdf(?:$|[?#])|tender document|terms of reference|request for proposal|download|solicitation|rfp/i.test(`${item.url} ${item.label}`))
    .filter((item) => isPublicHttpUrl(item.url));
  return unique(candidates.map((item) => normalizeUrl(item.url))).slice(0, 8);
}

function buildCitations(
  candidate: DiscoveryCandidate,
  sources: ExtractedSource[],
  scopeSummary: string | undefined,
  eligibility: string[],
  evaluation: string[],
): TenderSourceCitation[] {
  const citations: TenderSourceCitation[] = [{
    label: `${candidate.tender?.portal ?? candidate.sourceName} notice`,
    url: candidate.sourceUrl,
    excerpt: shorten(candidate.summary, 220),
  }];
  for (const source of sources) {
    const excerpt = scopeSummary ?? eligibility[0] ?? evaluation[0] ?? firstSentence(source.text);
    citations.push({
      label: source.format === 'pdf_text' ? 'Tender document (text-extracted PDF)' : 'Tender source page',
      url: source.url,
      excerpt: excerpt ? shorten(excerpt, 220) : undefined,
    });
  }
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = normalizeUrl(citation.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function buildMissingInformation(input: {
  scopeSummary?: string;
  deliverables: string[];
  eligibilityRequirements: string[];
  evaluationCriteria: string[];
  submissionMethod?: string;
  deadline?: string;
  bidSecurity?: string;
}): string[] {
  const missing: string[] = [];
  if (!input.scopeSummary) missing.push('Detailed scope of work requires confirmation.');
  if (input.deliverables.length === 0) missing.push('Deliverables were not clearly extracted.');
  if (input.eligibilityRequirements.length === 0) missing.push('Mandatory eligibility requirements require confirmation.');
  if (input.evaluationCriteria.length === 0) missing.push('Evaluation criteria and weighting require confirmation.');
  if (!input.deadline) missing.push('Submission deadline requires confirmation.');
  if (!input.submissionMethod) missing.push('Submission method requires confirmation.');
  if (!input.bidSecurity) missing.push('Bid security requirement is unclear.');
  return missing;
}

function buildBidNoBidBrief(
  candidate: DiscoveryCandidate,
  intelligence: Omit<TenderDocumentIntelligence, 'bidNoBidBrief'>,
): string {
  const tender = candidate.tender;
  const recommendation = tender?.portal ? 'Run Codistan bid/no-bid review' : 'Confirm procurement source';
  return [
    `BID / NO-BID BRIEF — ${candidate.title}`,
    `Buyer: ${candidate.companyName ?? 'Confirm buyer'}`,
    `Portal / reference: ${tender?.portal ?? candidate.sourceName}${tender?.reference ? ` / ${tender.reference}` : ''}`,
    `Deadline: ${tender?.deadline ?? inferSubmissionDeadline(candidate.summary) ?? 'Confirm deadline'}`,
    `Initial action: ${recommendation}`,
    '',
    `Scope: ${intelligence.scopeSummary ?? 'Detailed scope requires confirmation from the retained source documents.'}`,
    '',
    `Deliverables:\n${formatBullets(intelligence.deliverables, 'Confirm complete deliverable list.')}`,
    '',
    `Eligibility:\n${formatBullets(intelligence.eligibilityRequirements, 'Confirm mandatory eligibility and experience requirements.')}`,
    '',
    `Evaluation:\n${formatBullets(intelligence.evaluationCriteria, 'Confirm technical/financial evaluation criteria and weighting.')}`,
    '',
    `Required team / CVs:\n${formatBullets(intelligence.requiredTeamRoles, 'Confirm key personnel and CV requirements.')}${intelligence.requiredCvCount ? `\n- Extracted CV count: ${intelligence.requiredCvCount}` : ''}`,
    '',
    `Bid security: ${intelligence.bidSecurity ?? 'Unclear — confirm before bid decision.'}`,
    `Submission: ${intelligence.submissionMethod ?? 'Unclear — confirm official submission route.'}`,
    `Clarification deadline: ${intelligence.clarificationDeadline ?? 'Not extracted.'}`,
    `Local presence: ${intelligence.localPresenceEvidence ?? tender?.localPresenceRequired ?? 'Unclear.'}`,
    `Consortium / partner route: ${intelligence.consortiumEvidence ?? tender?.consortiumAllowed ?? 'Unclear.'}`,
    `Amendment status: ${intelligence.amendmentStatus}${intelligence.amendmentSummary ? ` — ${intelligence.amendmentSummary}` : ''}`,
    '',
    `Open questions:\n${formatBullets(intelligence.missingInformation, 'No major information gap was detected automatically; human verification remains mandatory.')}`,
    '',
    `Sources:\n${formatBullets(intelligence.citations.map((citation) => `${citation.label}: ${citation.url}`), candidate.sourceUrl)}`,
    '',
    'Human decision required: Do not submit, contact, price or commit resources without Jawad reviewing the official notice and retained documents.',
  ].join('\n');
}

function replaceBriefAmendment(brief: string, status: TenderAmendmentStatus, summary?: string): string {
  const replacement = `Amendment status: ${status}${summary ? ` — ${summary}` : ''}`;
  return /Amendment status:[^\n]*/.test(brief)
    ? brief.replace(/Amendment status:[^\n]*/, replacement)
    : `${brief}\n${replacement}`;
}

function extractScopeSummary(text: string): string | undefined {
  const sections = [
    /(?:scope of work|terms of reference|objective(?:s)?|assignment purpose|project overview)\s*[:\-]?\s*([^\n]{40,700})/i,
    /(?:the (?:selected )?(?:firm|vendor|consultant|supplier) (?:shall|will|is expected to))\s+([^\n]{40,700})/i,
  ];
  for (const pattern of sections) {
    const match = text.match(pattern)?.[1];
    if (match) return shorten(cleanSentence(match), 650);
  }
  const sentence = text.split(/(?<=[.!?])\s+/).find((value) => /develop|implement|design|provide|platform|software|system|website|application/i.test(value) && value.length >= 50);
  return sentence ? shorten(cleanSentence(sentence), 650) : undefined;
}

function extractList(lines: string[], heading: RegExp, signals: RegExp[], limit: number): string[] {
  const items: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (heading.test(line)) {
      for (const nearby of lines.slice(index + 1, index + 14)) {
        if (isSectionHeading(nearby) && items.length > 0) break;
        if (nearby.length >= 15 && nearby.length <= 420) items.push(cleanListItem(nearby));
      }
    }
    if (signals.some((signal) => signal.test(line)) && line.length >= 18 && line.length <= 420) items.push(cleanListItem(line));
  }
  return unique(items.filter((item) => item.length >= 12)).slice(0, limit);
}

function meaningfulLines(text: string): string[] {
  return text
    .replace(/([.;])\s+(?=[A-Z][A-Za-z ]{2,40}:)/g, '$1\n')
    .split(/\n+|(?<=;)\s+(?=(?:\d+[.)]|[-•]))/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 4);
}

function isSectionHeading(line: string): boolean {
  return /^(?:\d+(?:\.\d+)*[.)]?\s*)?(?:eligibility|evaluation|submission|payment|terms|conditions|timeline|background|scope|deliverables|requirements)\b/i.test(line) && line.length < 90;
}

function cleanListItem(value: string): string {
  return cleanSentence(value.replace(/^(?:[-•*]|\d+(?:\.\d+)*[.)])\s*/, ''));
}

function cleanSentence(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[\s:;,.\-]+|[\s:;,\-]+$/g, '').trim();
}

function extractCvCount(text: string): number | undefined {
  const match = text.match(/(?:submit|provide|include|requiring?)\s+(\d{1,2})\s+(?:curriculum vitae|cvs?|resumes?)/i)
    ?? text.match(/(\d{1,2})\s+(?:key personnel|experts?|team members?)\b/i);
  const count = Number(match?.[1]);
  return Number.isInteger(count) && count > 0 && count <= 50 ? count : undefined;
}

function extractClarificationDeadline(text: string): string | undefined {
  const match = text.match(/(?:clarification|questions?|queries)\s+(?:deadline|due|must be received by|until)\s*[:\-]?\s*([^\n.;]{5,80})/i);
  return match?.[1] ? normalizeDatePhrase(match[1]) ?? cleanSentence(match[1]) : undefined;
}

function inferSubmissionDeadline(text: string): string | undefined {
  const match = text.match(/(?:submission deadline|closing date|proposal due|bid due|deadline)\s*[:\-]?\s*([^\n.;]{5,90})/i);
  return match?.[1] ? normalizeDatePhrase(match[1]) : undefined;
}

function normalizeDatePhrase(value: string): string | undefined {
  const cleaned = value.replace(/\bat\b.*$/i, '').trim();
  const timestamp = Date.parse(cleaned);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function extractSubmissionMethod(lines: string[]): string | undefined {
  return extractLine(lines, /submit(?:ted)? (?:through|via|to)|electronic submission|online portal|sealed (?:bid|envelope)|hard cop(?:y|ies)|email proposals?|procurement portal/i);
}

function extractLine(lines: string[], pattern: RegExp): string | undefined {
  const line = lines.find((value) => pattern.test(value) && value.length <= 500);
  return line ? cleanSentence(line) : undefined;
}

function extractEstimatedValue(text: string): string | undefined {
  return extractFirst(text, [
    /(?:estimated cost|contract value|budget|maximum value)\s*[:\-]?\s*((?:PKR|CAD|USD|Rs\.?|\$)\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?)/i,
    /((?:PKR|CAD|USD|Rs\.?|\$)\s*[\d,.]+(?:\s*(?:million|billion|m|bn))?)/i,
  ]);
}

function extractFirst(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1];
    if (match) return cleanSentence(match);
  }
  return undefined;
}

function decodePdfToken(token: string): string {
  if (token.startsWith('<')) {
    const hex = token.slice(1, -1).replace(/\s+/g, '');
    if (!hex || /[^\da-f]/i.test(hex)) return '';
    const padded = hex.length % 2 ? `${hex}0` : hex;
    const bytes = Buffer.from(padded, 'hex');
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      let output = '';
      for (let index = 2; index + 1 < bytes.length; index += 2) output += String.fromCharCode(bytes.readUInt16BE(index));
      return output;
    }
    return bytes.toString('utf8').replace(/\0/g, '');
  }
  const value = token.slice(1, -1);
  return value
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\\r?\n/g, '');
}

function stripHtml(value: string): string {
  return decodeEntities(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/tr>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function normalizeText(value: string): string {
  return value
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchWithTimeout(fetchImpl: ProspectFetch, url: string, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'CodistanTenderIntelligence/1.0 (+https://codistan.org)',
        accept: 'text/html,application/pdf,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return host !== 'localhost'
      && !host.endsWith('.local')
      && !/^127\./.test(host)
      && host !== '::1'
      && !/^10\./.test(host)
      && !/^192\.168\./.test(host)
      && !/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
      && !/^169\.254\./.test(host);
  } catch {
    return false;
  }
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

function firstSentence(value: string): string | undefined {
  return value.split(/(?<=[.!?])\s+/).map((item) => item.trim()).find((item) => item.length >= 30);
}

function formatBullets(items: string[], fallback: string): string {
  return (items.length ? items : [fallback]).map((item) => `- ${item}`).join('\n');
}

function shorten(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}…`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
