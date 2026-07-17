import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export type LeadSignalInboxSource =
  | 'upwork_saved_search'
  | 'sales_navigator_email'
  | 'linkedin_notification_email';

export interface LeadSignalInboxConfig {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  mailboxEmail?: string;
  mailboxPassword?: string;
  folder: string;
  maxMessagesPerSource: number;
  approvedForwarders: string[];
  upworkSenders: string[];
}

export interface LeadSignalInboxMessage {
  uid: number;
  source: LeadSignalInboxSource;
  messageId: string;
  sender: string;
  subject?: string;
  text: string;
  sourceUrl?: string;
  receivedAt: string;
}

export interface LeadSignalInboxPollResult {
  configured: boolean;
  checked: number;
  accepted: number;
  messages: LeadSignalInboxMessage[];
  checkedBySource: Record<LeadSignalInboxSource, number>;
  acceptedBySource: Record<LeadSignalInboxSource, number>;
  errors: string[];
}

export interface LeadSignalInboxPollOptions {
  upworkEnabled?: boolean;
  linkedinEnabled?: boolean;
}

export interface PotentialLeadSignalMessageInput {
  uid?: number;
  messageId?: string;
  sender?: string;
  subject?: string;
  text?: string;
  receivedAt?: string;
}

const DEFAULT_FORWARDERS = [
  'waseem@codistan.org',
  'sales@codistan.org',
  'talha.bashir@codistan.org',
];
const DEFAULT_UPWORK_SENDERS = ['donotreply@upwork.com'];
const linkedinSenderPattern = /(?:^|\.)linkedin\.com$/i;
const salesNavigatorPattern = /\b(?:sales navigator|saved (?:lead|account)? search|saved search alert|lead alert|account alert|new leads?|new accounts?)\b/i;
const forwardedPattern = /^\s*(?:fw|fwd):/i;
const linkedinUrlPattern = /https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(?:comm\/)?(?:posts\/[^\s<>()"']+|feed\/update\/urn:li:activity:[^\s<>()"']+|in\/[^\s<>()"']+|company\/[^\s<>()"']+|sales\/lead\/[^\s<>()"']+|sales\/company\/[^\s<>()"']+)/i;
const upworkUrlPattern = /https?:\/\/(?:www\.)?upwork\.com\/(?:jobs\/[^\s<>()"']+|freelance-jobs\/apply\/[^\s<>()"']+)/i;

export function loadLeadSignalInboxConfig(environment: NodeJS.ProcessEnv = process.env): LeadSignalInboxConfig {
  const mailboxEmail = normalizeEmail(environment.LEAD_SIGNAL_MAILBOX_EMAIL)
    ?? normalizeEmail(environment.LINKEDIN_SIGNAL_MAILBOX_EMAIL);
  const mailboxPassword = environment.LEAD_SIGNAL_MAILBOX_PASSWORD?.trim()
    || environment.LINKEDIN_SIGNAL_MAILBOX_PASSWORD?.trim();
  return {
    configured: Boolean(mailboxEmail && mailboxPassword),
    host: environment.LEAD_SIGNAL_IMAP_HOST?.trim()
      || environment.LINKEDIN_SIGNAL_IMAP_HOST?.trim()
      || environment.OUTREACH_IMAP_HOST?.trim()
      || 'sgp200.greengeeks.net',
    port: positiveInteger(
      environment.LEAD_SIGNAL_IMAP_PORT,
      positiveInteger(environment.LINKEDIN_SIGNAL_IMAP_PORT, positiveInteger(environment.OUTREACH_IMAP_PORT, 993)),
    ),
    secure: environment.LEAD_SIGNAL_IMAP_SECURE !== 'false'
      && environment.LINKEDIN_SIGNAL_IMAP_SECURE !== 'false'
      && environment.OUTREACH_IMAP_SECURE !== 'false',
    mailboxEmail,
    mailboxPassword,
    folder: environment.LEAD_SIGNAL_IMAP_FOLDER?.trim()
      || environment.LINKEDIN_SIGNAL_IMAP_FOLDER?.trim()
      || 'INBOX',
    maxMessagesPerSource: boundedInteger(
      environment.LEAD_SIGNAL_MAX_MESSAGES_PER_SOURCE
        ?? environment.LINKEDIN_SIGNAL_MAX_MESSAGES,
      40,
      1,
      100,
    ),
    approvedForwarders: parseEmailList(environment.LEAD_SIGNAL_APPROVED_FORWARDERS, DEFAULT_FORWARDERS),
    upworkSenders: parseEmailList(environment.LEAD_SIGNAL_UPWORK_SENDERS, DEFAULT_UPWORK_SENDERS),
  };
}

export async function pollLeadSignalInbox(
  config: LeadSignalInboxConfig,
  options: LeadSignalInboxPollOptions = {},
): Promise<LeadSignalInboxPollResult> {
  const result: LeadSignalInboxPollResult = {
    configured: config.configured,
    checked: 0,
    accepted: 0,
    messages: [],
    checkedBySource: emptyCounts(),
    acceptedBySource: emptyCounts(),
    errors: [],
  };
  if (!config.configured || !config.mailboxEmail || !config.mailboxPassword) return result;

  const client = createClient(config);
  await client.connect();
  const lock = await client.getMailboxLock(config.folder);
  try {
    const candidateUids = new Set<number>();
    if (options.upworkEnabled !== false) {
      for (const sender of config.upworkSenders) {
        await addSearchMatches(client, candidateUids, { seen: false, from: sender }, config.maxMessagesPerSource, result.errors, `upwork:${sender}`);
      }
    }
    if (options.linkedinEnabled !== false) {
      await addSearchMatches(client, candidateUids, { seen: false, from: 'linkedin.com' }, config.maxMessagesPerSource, result.errors, 'linkedin');
    }
    for (const sender of config.approvedForwarders) {
      await addSearchMatches(client, candidateUids, { seen: false, from: sender }, config.maxMessagesPerSource, result.errors, `forwarder:${sender}`);
    }

    for (const uid of [...candidateUids].sort((left, right) => right - left)) {
      try {
        for await (const message of client.fetch([uid], { uid: true, source: true }, { uid: true })) {
          if (!message.source) continue;
          const parsed = await simpleParser(message.source);
          const candidate = parsePotentialLeadSignalMessage({
            uid: message.uid,
            messageId: parsed.messageId?.trim() || `lead-signal-${config.mailboxEmail}-${message.uid}`,
            sender: normalizeEmail(parsed.from?.value?.[0]?.address) ?? parsed.from?.text,
            subject: parsed.subject,
            text: buildSignalText(parsed.text, parsed.html?.toString() ?? '', parsed.subject),
            receivedAt: parsed.date?.toISOString() ?? new Date().toISOString(),
          }, config);
          if (!candidate) continue;
          if (candidate.source === 'upwork_saved_search' && options.upworkEnabled === false) continue;
          if (candidate.source !== 'upwork_saved_search' && options.linkedinEnabled === false) continue;
          result.checked += 1;
          result.checkedBySource[candidate.source] += 1;
          result.messages.push(candidate);
          result.accepted += 1;
          result.acceptedBySource[candidate.source] += 1;
        }
      } catch (error) {
        result.errors.push(`UID ${uid}: ${errorMessage(error)}`);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  return result;
}

export async function acknowledgeLeadSignalInbox(
  config: LeadSignalInboxConfig,
  uids: number[],
): Promise<number> {
  const uniqueUids = [...new Set(uids.filter((uid) => Number.isInteger(uid) && uid > 0))];
  if (!config.configured || !config.mailboxEmail || !config.mailboxPassword || uniqueUids.length === 0) return 0;
  const client = createClient(config);
  await client.connect();
  const lock = await client.getMailboxLock(config.folder);
  try {
    for (const uid of uniqueUids) await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  return uniqueUids.length;
}

export function parsePotentialLeadSignalMessage(
  input: PotentialLeadSignalMessageInput,
  config: Pick<LeadSignalInboxConfig, 'approvedForwarders' | 'upworkSenders'>,
): LeadSignalInboxMessage | undefined {
  const sender = normalizeEmail(input.sender) ?? input.sender?.trim().toLowerCase();
  const subject = input.subject?.trim();
  const text = (input.text ?? '').trim();
  if (!sender || !text) return undefined;

  const combined = `${subject ?? ''}\n${text}`;
  const linkedinUrl = extractCanonicalUrl(combined, linkedinUrlPattern);
  const upworkUrl = extractCanonicalUrl(combined, upworkUrlPattern);
  const senderDomain = sender.split('@')[1] ?? sender;
  const nativeLinkedIn = linkedinSenderPattern.test(senderDomain);
  const nativeUpwork = config.upworkSenders.includes(sender);
  const approvedForward = config.approvedForwarders.includes(sender) && forwardedPattern.test(subject ?? '');

  let source: LeadSignalInboxSource | undefined;
  let sourceUrl: string | undefined;
  if (nativeUpwork || (approvedForward && upworkUrl)) {
    source = 'upwork_saved_search';
    sourceUrl = upworkUrl;
  } else if (nativeLinkedIn || (approvedForward && linkedinUrl)) {
    source = salesNavigatorPattern.test(combined) ? 'sales_navigator_email' : 'linkedin_notification_email';
    sourceUrl = linkedinUrl;
  }
  if (!source) return undefined;

  return {
    uid: input.uid ?? 0,
    source,
    messageId: input.messageId?.trim() || `lead-signal-${stableHash(`${sender}|${subject ?? ''}|${text.slice(0, 500)}`)}`,
    sender,
    subject,
    text: text.slice(0, 30_000),
    sourceUrl,
    receivedAt: normalizeIso(input.receivedAt) ?? new Date().toISOString(),
  };
}

async function addSearchMatches(
  client: ImapFlow,
  target: Set<number>,
  query: { seen: false; from: string },
  maximum: number,
  errors: string[],
  label: string,
): Promise<void> {
  try {
    const matches = await client.search(query, { uid: true });
    if (!Array.isArray(matches)) return;
    for (const uid of matches.slice(-maximum)) target.add(uid);
  } catch (error) {
    errors.push(`${label} search failed: ${errorMessage(error)}`);
  }
}

function createClient(config: LeadSignalInboxConfig): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.mailboxEmail!, pass: config.mailboxPassword! },
    logger: false,
  });
}

function buildSignalText(plainText: string | undefined, html: string, subject: string | undefined): string {
  const links = extractHtmlLinks(html);
  return [
    plainText?.trim(),
    stripHtml(html),
    links.length ? `Embedded links:\n${links.join('\n')}` : undefined,
    subject?.trim(),
  ].filter((value): value is string => Boolean(value)).join('\n').trim().slice(0, 60_000);
}

function extractHtmlLinks(value: string): string[] {
  const links: string[] = [];
  for (const match of value.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const decoded = decodeHtml(match[1] ?? '').trim();
    if (!/^https?:\/\//i.test(decoded)) continue;
    try {
      const url = new URL(decoded);
      url.hash = '';
      links.push(url.toString());
    } catch {
      continue;
    }
  }
  return [...new Set(links)].slice(0, 100);
}

function extractCanonicalUrl(value: string, pattern: RegExp): string | undefined {
  const match = value.match(pattern)?.[0];
  if (!match) return undefined;
  try {
    const url = new URL(decodeHtml(match.replace(/[.,;]+$/, '')));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|trk|tracking|lipi|midToken|midSig|source|ref)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function parseEmailList(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value ?? '').split(/[;,\n]+/).map((item) => normalizeEmail(item)).filter((item): item is string => Boolean(item));
  return [...new Set(parsed.length ? parsed : fallback)];
}

function emptyCounts(): Record<LeadSignalInboxSource, number> {
  return {
    upwork_saved_search: 0,
    sales_navigator_email: 0,
    linkedin_notification_email: 0,
  };
}

function normalizeEmail(value: string | undefined | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function stripHtml(value: string): string {
  return decodeHtml(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function normalizeIso(value: string | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
