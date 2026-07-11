import type { DiscoveryCandidate, ProspectFetch } from './types.js';
import { fetchWithTimeout, parseRssItems } from './sources.js';

const blockedHosts = new Set([
  'bing.com', 'www.bing.com', 'google.com', 'www.google.com', 'remoteok.com', 'www.remoteok.com',
  'linkedin.com', 'www.linkedin.com', 'facebook.com', 'www.facebook.com', 'instagram.com', 'www.instagram.com',
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'youtube.com', 'www.youtube.com',
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

const nameNoise = new Set([
  'about', 'blog', 'careers', 'company', 'contact', 'home', 'in', 'leadership', 'linkedin', 'menu',
  'news', 'portfolio', 'services', 'team', 'website', 'work',
]);

interface CrawledPage {
  url: string;
  html: string;
}

interface DecisionMaker {
  name: string;
  role: string;
}

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

  const html = pages.map((page) => page.html).join('\n');
  const text = pages.map((page) => stripHtml(page.html)).join(' ');
  const leader = extractDecisionMaker(text);
  const companyName = candidate.companyName ?? extractCompanyName(pages[0]?.html ?? '', companyWebsite);

  return {
    ...candidate,
    companyName,
    companyWebsite,
    contactName: candidate.contactName ?? leader?.name,
    contactRole: candidate.contactRole ?? leader?.role,
    contactEmail: candidate.contactEmail ?? chooseBestEmail(extractEmails(html)),
    contactPhone: candidate.contactPhone ?? extractPhones(text)[0],
    contactFormUrl: candidate.contactFormUrl ?? findContactFormUrl(pages, companyWebsite),
    linkedinUrl: candidate.linkedinUrl ?? extractLinkedInUrl(html),
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
    const tokens = companyName.toLowerCase().split(/\W+/).filter((token) => token.length > 2);
    for (const item of parseRssItems(await response.text())) {
      const website = deriveCompanyWebsite(item.link);
      if (!website) continue;
      const haystack = `${item.title} ${item.description} ${website}`.toLowerCase();
      if (tokens.length === 0 || tokens.some((token) => haystack.includes(token))) return website;
    }
  } catch {
    return undefined;
  }
  return undefined;
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

async function crawlCompanyPages(fetchImpl: ProspectFetch, companyWebsite: string): Promise<CrawledPage[]> {
  const root = normalizeRootUrl(companyWebsite);
  if (!root) return [];
  const rootHtml = await fetchHtml(fetchImpl, root);
  if (!rootHtml) return [];

  const pages: CrawledPage[] = [{ url: root, html: rootHtml }];
  const discovered = extractLinks(rootHtml, root)
    .filter((url) => sameHost(url, root))
    .filter((url) => /\/(about|team|leadership|company|contact|services|work|portfolio|careers)(\/|$|\?)/i.test(new URL(url).pathname + new URL(url).search));
  const fallbacks = ['/about', '/team', '/leadership', '/contact'].map((path) => new URL(path, root).toString().replace(/\/$/, ''));
  const urls = [...new Set([...discovered, ...fallbacks])].slice(0, 6);

  for (const url of urls) {
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
    return html.slice(0, 1_500_000);
  } catch {
    return undefined;
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = decodeEntities(match[1] ?? '').trim();
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      url.hash = '';
      links.push(url.toString().replace(/\/$/, ''));
    } catch {
      // Ignore malformed public links.
    }
  }
  return links;
}

function extractEmails(html: string): string[] {
  const emails = new Set<string>();
  for (const match of decodeEntities(html).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
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
    const match = extractLinks(page.html, page.url).find((url) => sameHost(url, companyWebsite)
      && /contact|new-business|get-in-touch|lets-talk|book-a-call/i.test(url));
    if (match) return match;
  }
  return contactPage?.url;
}

function extractLinkedInUrl(html: string): string | undefined {
  return html.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[^"'\s<>]+/i)?.[0]?.replace(/[),.;]+$/, '');
}

function extractDecisionMaker(text: string): DecisionMaker | undefined {
  const normalized = text.replace(/\s+/g, ' ');
  const rolePattern = targetRoles.map(escapeRegex).sort((a, b) => b.length - a.length).join('|');
  const namePattern = '[A-Z][a-z]+(?:[ \\u2019\'-][A-Z][a-z]+){1,3}';
  const patterns = [
    { regex: new RegExp(`(${namePattern})\\s*(?:[-–|,]|is|—)\\s*(${rolePattern})`, 'g'), nameIndex: 1, roleIndex: 2 },
    { regex: new RegExp(`(${rolePattern})\\s*(?:[-–|,:]|is|—)\\s*(${namePattern})`, 'gi'), nameIndex: 2, roleIndex: 1 },
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern.regex)) {
      const name = cleanPersonName(match[pattern.nameIndex] ?? '');
      const role = match[pattern.roleIndex];
      if (name && role) return { name, role: normalizeRole(role) };
    }
  }
  return undefined;
}

function cleanPersonName(value: string): string | undefined {
  const words = value.trim().split(/\s+/).filter(Boolean);
  while (words.length > 2 && nameNoise.has((words[0] ?? '').toLowerCase())) words.shift();
  if (words.length < 2 || words.length > 4) return undefined;
  if (words.some((word) => nameNoise.has(word.toLowerCase()))) return undefined;
  return words.join(' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    const label = new URL(value).hostname.replace(/^www\./, '').split('.')[0] ?? value;
    return label.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return value;
  }
}

function sameHost(value: string, other: string): boolean {
  try {
    return new URL(value).hostname.replace(/^www\./, '') === new URL(other).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
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
