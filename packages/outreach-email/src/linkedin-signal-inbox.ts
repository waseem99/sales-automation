import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export type LinkedInInboxSignalOrigin = 'sales_navigator_email' | 'linkedin_notification_email';

export interface LinkedInSignalInboxConfig {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  mailboxEmail?: string;
  mailboxPassword?: string;
  folder: string;
  maxMessages: number;
}

export interface LinkedInSignalInboxMessage {
  uid: number;
  origin: LinkedInInboxSignalOrigin;
  messageId: string;
  sender: string;
  subject?: string;
  text: string;
  sourceUrl?: string;
  receivedAt: string;
}

export interface LinkedInSignalInboxPollResult {
  configured: boolean;
  checked: number;
  accepted: number;
  messages: LinkedInSignalInboxMessage[];
  errors: string[];
}

export interface PotentialSignalMessageInput {
  uid?: number;
  messageId?: string;
  sender?: string;
  subject?: string;
  text?: string;
  receivedAt?: string;
}

const linkedinSenderPattern = /(?:^|@|\.)linkedin\.com$/i;
const salesNavigatorPattern = /\b(?:sales navigator|saved search alert|lead alert|account alert)\b/i;
const linkedinUrlPattern = /https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(?:posts\/[^\s<>()"']+|feed\/update\/urn:li:activity:[^\s<>()"']+)/i;
const forwardedPattern = /^\s*(?:fw|fwd):/i;
const internalSenderPattern = /@codistan\.org$/i;

export function loadLinkedInSignalInboxConfig(environment: NodeJS.ProcessEnv = process.env): LinkedInSignalInboxConfig {
  const mailboxEmail = normalizeEmail(environment.LINKEDIN_SIGNAL_MAILBOX_EMAIL);
  const mailboxPassword = environment.LINKEDIN_SIGNAL_MAILBOX_PASSWORD?.trim();
  return {
    configured: Boolean(mailboxEmail && mailboxPassword),
    host: environment.LINKEDIN_SIGNAL_IMAP_HOST?.trim() || environment.OUTREACH_IMAP_HOST?.trim() || 'sgp200.greengeeks.net',
    port: positiveInteger(environment.LINKEDIN_SIGNAL_IMAP_PORT, positiveInteger(environment.OUTREACH_IMAP_PORT, 993)),
    secure: environment.LINKEDIN_SIGNAL_IMAP_SECURE !== 'false' && environment.OUTREACH_IMAP_SECURE !== 'false',
    mailboxEmail,
    mailboxPassword,
    folder: environment.LINKEDIN_SIGNAL_IMAP_FOLDER?.trim() || 'INBOX',
    maxMessages: boundedInteger(environment.LINKEDIN_SIGNAL_MAX_MESSAGES, 30, 1, 100),
  };
}

export async function pollLinkedInSignalInbox(config: LinkedInSignalInboxConfig): Promise<LinkedInSignalInboxPollResult> {
  const result: LinkedInSignalInboxPollResult = {
    configured: config.configured,
    checked: 0,
    accepted: 0,
    messages: [],
    errors: [],
  };
  if (!config.configured || !config.mailboxEmail || !config.mailboxPassword) return result;

  const client = createClient(config);
  await client.connect();
  const lock = await client.getMailboxLock(config.folder);
  try {
    for await (const message of client.fetch({ seen: false }, { uid: true, source: true, envelope: true })) {
      if (result.checked >= config.maxMessages) break;
      result.checked += 1;
      try {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const candidate = parsePotentialLinkedInSignalMessage({
          uid: message.uid,
          messageId: parsed.messageId?.trim() || `linkedin-signal-${config.mailboxEmail}-${message.uid}`,
          sender: normalizeEmail(parsed.from?.value?.[0]?.address) ?? parsed.from?.text,
          subject: parsed.subject,
          text: (parsed.text || stripHtml(parsed.html?.toString() ?? '') || parsed.subject || '').trim(),
          receivedAt: parsed.date?.toISOString() ?? new Date().toISOString(),
        });
        if (!candidate) continue;
        result.messages.push(candidate);
        result.accepted += 1;
      } catch (error) {
        result.errors.push(`UID ${message.uid}: ${errorMessage(error)}`);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  return result;
}

export async function acknowledgeLinkedInSignalInbox(
  config: LinkedInSignalInboxConfig,
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

export function parsePotentialLinkedInSignalMessage(input: PotentialSignalMessageInput): LinkedInSignalInboxMessage | undefined {
  const sender = normalizeEmail(input.sender) ?? input.sender?.trim().toLowerCase();
  const subject = input.subject?.trim();
  const text = (input.text ?? '').trim();
  if (!sender || !text) return undefined;

  const sourceUrl = extractLinkedInPostUrl(`${subject ?? ''}\n${text}`);
  const senderDomain = sender.split('@')[1] ?? sender;
  const nativeLinkedIn = linkedinSenderPattern.test(senderDomain);
  const forwardedLinkedIn = internalSenderPattern.test(sender) && forwardedPattern.test(subject ?? '') && Boolean(sourceUrl);
  if (!nativeLinkedIn && !forwardedLinkedIn) return undefined;

  const salesNavigator = salesNavigatorPattern.test(`${subject ?? ''}\n${text}`);
  return {
    uid: input.uid ?? 0,
    origin: salesNavigator ? 'sales_navigator_email' : 'linkedin_notification_email',
    messageId: input.messageId?.trim() || `linkedin-email-${stableHash(`${sender}|${subject ?? ''}|${text.slice(0, 500)}`)}`,
    sender,
    subject,
    text: text.slice(0, 20_000),
    sourceUrl,
    receivedAt: normalizeIso(input.receivedAt) ?? new Date().toISOString(),
  };
}

function createClient(config: LinkedInSignalInboxConfig): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.mailboxEmail!, pass: config.mailboxPassword! },
    logger: false,
  });
}

function extractLinkedInPostUrl(value: string): string | undefined {
  const match = value.match(linkedinUrlPattern)?.[0];
  if (!match) return undefined;
  try {
    const url = new URL(match.replace(/[.,;]+$/, ''));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|trk|tracking|lipi|midToken|midSig)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function normalizeEmail(value: string | undefined | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function stripHtml(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
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
