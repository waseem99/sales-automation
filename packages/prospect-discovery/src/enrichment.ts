import type { DiscoveryCandidate, ProspectFetch } from './types.js';
import { fetchWithTimeout, parseRssItems } from './sources.js';

const blockedHosts = new Set([
  'www.bing.com', 'bing.com', 'www.google.com', 'google.com', 'remoteok.com', 'www.remoteok.com',
  'linkedin.com', 'www.linkedin.com', 'facebook.com', 'www.facebook.com', 'instagram.com', 'www.instagram.com',
  'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'youtube.com', 'www.youtube.com',
  'boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'api.lever.co',
  'indeed.com', 'www.indeed.com', 'glassdoor.com', 'www.glassdoor.com',
]);

const targetRoles = [
  'Founder', 'Co-Founder', 'CEO', 'Chief Executive Officer', 'Managing Director', 'Partner',
  'Head of Delivery', 'Delivery Director', 'Technical Director', 'Technology Director', 'CTO',
  'Chief Technology Officer', 'Head of Product', 'Product Director', 'Head of Production',
  'Production Director', 'Executive Producer', 'Creative Director', 'Innovation Director',
  'Head of AI', 'AI Director', 'Partnerships Director', 'Head of Partnerships', 'Commercial Director',
];

export async function enrichCandidate(
  fetchImpl: ProspectFetch,
  candidate: DiscoveryCandidate,
): Promise<DiscoveryCandidate> {
  const companyWebsite = candidate.companyWebsite
    ?? deriveCompanyWebsite(candidate.sourceUrl)
    ?? (candidate.companyName ? await findCompanyWebsite(fetchImpl, candidate.companyName) : undefined);

  if (!companyWebsite) return candidate;

  const pages = await crawlCompanyPages(fetchImpl, companyWebsite);
  if (pages.length === 0) return { ...candidate, companyWebsite };

  const combinedHtml = pages.map((page) => page.html).join('\n');
  const combinedText = pages.map((page) => stripHtml(page.html)).join(' ');
  const emails = extractEmails(combinedHtml);
  const phones = extractPhones(combinedText);
  const contactFormUrl = findContactFormUrl(pages, companyWebsite);
  const linkedinUrl = extractLinkedInUrl(combinedHtml);
  const leader = extractDecisionMaker(combinedText);
  const companyName = candidate.companyName ?? extractCompanyName(pages[0]?.html ?? '', companyWebsite);

  return {
    ...candidate,
    companyName,
    companyWebsite,
    contactName: candidate.contactName ?? leader?.name,
    contactRole: candidate.contactRole ?? leader?.role,
    contactEmail: candidate.contactEmail ?? chooseBestEmail(emails),
    contactPhone: candidate.contactPhone ?? phones[0],
    contactFormUrl: candidate.contactFormUrl ?? contactFormUrl,
    linkedinUrl: candidate.linkedinUrl ?? linkedinUrl,
    evidenceSummary: candidate.evidenceSummary
      ? `${candidate.evidenceSummary} Official company website and public contact pages checked.`
      : 'Official company website and public contact pages checked.',
  };
}

export async function findCompanyWebsite(fetchImpl: ProspectFetch, companyName: string): Promise<string | undefined> {
  const query = `"${companyName.replace(/"/g, '')}" official website`;
  try {
    const response = await fetchWithTimeout(fetchImpl, `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`);
    if (!response.ok) return undefined;
    const items = parseRssItems(await response.text());
    const companyTokens = companyName.toLowerCase().split(/\W+/).filter((token) => token.length > 2);
    for (const item of items) {
      const website = deriveCompanyWebsite(item.link);
      if (!website) continue;
      const text = `${item.title} ${item.description} ${website}`.toLowerCase();
      if (companyTokens.length === 0 || companyTokens.some((token) => text.includes(token))) return website;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function deriveCompanyWebsite(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase();
    if (blockedHosts.has(host) || host.endsWith('.greenhouse.io') || host.endsWith('.lever.co')) return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

interface CrawledPage {
  url: string;
  html: string;
}

async function crawlCompanyPages(fetchImpl: ProspectFetch, companyWebsite: string): Promise<CrawledPage[]> {
  const root = normalizeRootUrl(companyWebsite);
  if (!root) return [];
  const pages: CrawledPage[] = [];
  const rootPage = await fetchHtml(fetchImpl, root);
  if (!rootPage) return [];
  pages.push({ url: root, html: rootPage });

  const candidateLinks = extractLinks(rootPage, root)
    .filter((url) => sameHost(url, root))
    .filter((url) => /\/(about|team|leadership|company|contact|services|work|portfolio|careers)(\/|$|\?)/i.test(new URL(url).pathname + new URL(url).search))
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 5);

  const fallbackPaths = ['/about', '/team', '/leadership', '/contact'];
  for (const path of fallbackPaths) {
    const url = new URL(path, root).toString().replace(/\/$/, '');
    if (!candidateLinks.includes(url)) candidateLinks.push(url);
  }

  for (const url of candidateLinks.slice(0, 6)) {
    const html = await fetchHtml(fetchImpl, url);
    if (html) pages.push({ url, html });
  }

  return pages;
}

async function fetchHtml(fetchImpl: ProspectFetch, url: string): Promise<string | undefined> {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, {}, 12_000);
    if (!response.ok) return undefined;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) return undefined;
    const html = await response.text();
    return html.length > 1_500_000 ? html.slice(0, 1_500_000) : html;
  } catch {
    return undefined;
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = decodeEntities(match[1] ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      url.hash = '';
      links.push(url.toString().replace(/\/$/, ''));
    } catch {
      // Ignore malformed public links.
    }
  }
  return links;
}

function extractEmails(html: string): string[] {
  const normalized = decodeEntities(html);
  const emails = new Set<string>();
  for (const match of normalized.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = (match[0] ?? '').toLowerCase().replace(/[),.;:]+$/, '');
    if (!email || /example\.|sentry\.|wixpress|cloudflare|domain\.com/.test(email)) continue;
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) continue;
    emails.add(email);
  }
  return [...emails];
}

function chooseBestEmail(emails: string[]): string | undefined {
  const priorities = ['partnership', 'partners', 'business', 'newbusiness', 'hello', 'contact', 'info', 'sales'];
  return [...emails].sort((a, b) => emailPriority(a, priorities) - emailPriority(b, priorities))[0];
}

function emailPriority(email: string, priorities: string[]): number {
  const local = email.split('@')[0] ?? '';
  const index = priorities.findIndex((term) => local.includes(term));
  if (index >= 0) return index;
  if (/noreply|no-reply|support|privacy|legal|careers|jobs/.test(local)) return 100;
  return 20;
}

function extractPhones(text: string): string[] {
  const phones = new Set<string>();
  for (const match of text.matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)) {
    const phone = (match[0] ?? '').replace(/\s+/g, ' ').trim();
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 16) phones.add(phone);
  }
  return [...phones].slice(0, 5);
}

function findContactFormUrl(pages: CrawledPage[], companyWebsite: string): string | undefined {
  const contactPage = pages.find((page) => /\/contact(\/|$|\?)/i.test(new URL(page.url).pathname + new URL(page.url).search));
  if (contactPage && /<form\b/i.test(contactPage.html)) return contactPage.url;

  for (const page of pages) {
    for (const link of extractLinks(page.html, page.url)) {
      if (sameHost(link, companyWebsite) && /contact|new-business|get-in-touch|lets-talk|book-a-call/i.test(link)) return link;
    }
  }
  return contactPage?.url;
}

function extractLinkedInUrl(html: string): string | undefined {
  const match = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[^"'\s<>]+/i);
  return match?.[0]?.replace(/[),.;]+$/, '');
}

interface DecisionMaker {
  name: string;
  role: string;
}

function extractDecisionMaker(text: string): DecisionMaker | undefined {
  const normalized = text.replace(/\s+/g, ' ');
  const rolePattern = targetRoles.map(escapeRegex).sort((a, b) => b.length - a.length).join('|');
  const namePattern = '[A-Z][a-z]+(?:[ \\u2019\'-][A-Z][a-z]+){1,3}';
  const forward = new RegExp(`(${namePattern})\\s*(?:[-–|,]|is|—)\\s*(${rolePattern})`, 'i');
  const reverse = new RegExp(`(${rolePattern})\\s*(?:[-–|,:]|is|—)\\s*(${namePattern})`, 'i');
  const forwardMatch = normalized.match(forward);
  if (forwardMatch?.[1] && forwardMatch[2]) return { name: titleCaseName(forwardMatch[1]), role: normalizeRole(forwardMatch[2]) };
  const reverseMatch = normalized.match(reverse);
  if (reverseMatch?.[1] && reverseMatch[2]) return { name: titleCaseName(reverseMatch[2]), role: normalizeRole(reverseMatch[1]) };
  return undefined;
}

function extractCompanyName(html: string, companyWebsite: string): string {
  const og = html.match(/<meta\b[^>]*(?:property|name)=["']og:site_name["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:site_name["'][^>]*>/i);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) return decodeEntities(stripHtml(title)).split(/[|–—-]/)[0]?.trim() || hostnameLabel(companyWebsite);
  return hostnameLabel(companyWebsite);
}

function normalizeRootUrl(value: string): string | undefined {
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    if (blockedHosts.has(url.hostname.toLowerCase())) return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function hostnameLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '').split('.')[0]?.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? value;
  } catch {
    return value;
  }
}

function sameHost(value: string, other: string): boolean {
  try {
    const left = new URL(value).hostname.replace(/^www\./, '');
    const right = new URL(other).hostname.replace(/^www\./, '');
    return left === right;
  } catch {
    return false;
  }
}

function titleCaseName(value: string): string {
  return value.trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeRole(value: string): string {
  const lower = value.toLowerCase();
  return targetRoles.find((role) => role.toLowerCase() === lower) ?? value.trim();
}

function stripHtml(value: string): string {
  return decodeEntities(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
