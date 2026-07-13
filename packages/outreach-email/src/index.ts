import { analyzeInboundReply, type ReplyGuidance } from '@sales-automation/engagement-guidance';
import type { Lead, PipelineStatus } from '@sales-automation/shared';
import type { LeadRepository, StoredLeadRecord } from '@sales-automation/storage';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

const SENT_NOTE_PREFIX = 'outreach::sent::';
const INBOUND_NOTE_PREFIX = 'outreach::inbound::';
const SUPPRESSION_NOTE_PREFIX = 'outreach::suppressed::';
const ALERT_NOTE_PREFIX = 'outreach::alert::';
const FIRST_GUIDANCE_PREFIX = 'guidance::first_outreach::';
const CLOSED_STATUSES = new Set<PipelineStatus>(['won', 'lost', 'rejected', 'archived']);
const FOLLOW_UP_DAYS = [0, 3, 7, 14] as const;
const DEFAULT_ALERT_EMAILS = ['waseem@codistan.org', 'sales@codistan.org'];
const DEFAULT_ACTIVE_SENDERS = ['talha.bashir@codistan.org', 'jawad.jutt@codistan.org'];
const BUSINESS_ADDRESS = 'Codistan Ventures Building, Plot No. 15, I-11/3, Islamabad 44000, Pakistan';

interface MailboxDefinition {
  email: string;
  displayName: string;
  passwordEnvironmentName: string;
  signatureEnvironmentName: string;
}

const MAILBOX_DEFINITIONS: MailboxDefinition[] = [
  {
    email: 'talha.bashir@codistan.org',
    displayName: 'Talha Bashir',
    passwordEnvironmentName: 'TALHA_MAILBOX_PASSWORD',
    signatureEnvironmentName: 'TALHA_OUTREACH_SIGNATURE',
  },
  {
    email: 'jawad.jutt@codistan.org',
    displayName: 'Jawad Jutt',
    passwordEnvironmentName: 'JAWAD_MAILBOX_PASSWORD',
    signatureEnvironmentName: 'JAWAD_OUTREACH_SIGNATURE',
  },
  {
    email: 'moiz.khalid@codistan.org',
    displayName: 'Moiz Khalid',
    passwordEnvironmentName: 'MOIZ_MAILBOX_PASSWORD',
    signatureEnvironmentName: 'MOIZ_OUTREACH_SIGNATURE',
  },
  {
    email: 'subainaaamir@codistan.org',
    displayName: 'Subaina Aamir',
    passwordEnvironmentName: 'SUBAINA_MAILBOX_PASSWORD',
    signatureEnvironmentName: 'SUBAINA_OUTREACH_SIGNATURE',
  },
  {
    email: 'danishkhalid@codistan.org',
    displayName: 'Danish Khalid',
    passwordEnvironmentName: 'DANISH_MAILBOX_PASSWORD',
    signatureEnvironmentName: 'DANISH_OUTREACH_SIGNATURE',
  },
];

export interface OutreachMailbox {
  email: string;
  displayName: string;
  password: string;
  signature: string;
}

export interface OutreachEmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  mailboxes: OutreachMailbox[];
  activeSenderEmails: string[];
  alertEmails: string[];
  unsubscribeEmail: string;
  sendingEnabled: boolean;
  dnsReady: boolean;
  dryRun: boolean;
  replyPollingEnabled: boolean;
  alertsEnabled: boolean;
  rampStartedAt?: string;
  requestedDailyLimit: number;
  maxPerCycle: number;
  maxPerMailboxPerCycle: number;
  maxPerRecipientDomainPerCycle: number;
  localStartHour: number;
  localEndHour: number;
}

export interface SentOutreachEvent {
  leadId: string;
  sequence: number;
  sender: string;
  recipient: string;
  subject: string;
  messageId: string;
  sentAt: string;
}

export interface SuppressionEvent {
  email: string;
  reason: string;
  recordedAt: string;
}

export interface PlannedOutreachMessage {
  leadId: string;
  sequence: number;
  sender: OutreachMailbox;
  recipient: string;
  replyTo: string;
  subject: string;
  text: string;
  messageId: string;
  dueAt: string;
  recipientTimeZone: string;
}

export interface OutreachCycleReport {
  startedAt: string;
  completedAt: string;
  liveSendingAllowed: boolean;
  dryRun: boolean;
  configuredMailboxCount: number;
  activeSenderCount: number;
  repliesChecked: number;
  repliesMatched: number;
  repliesProcessed: number;
  bouncesOrSuppressions: number;
  alertsSent: number;
  planned: number;
  sent: number;
  failed: number;
  skippedByDailyLimit: number;
  errors: string[];
  sentLeadIds: string[];
}

export interface RunOutreachCycleInput {
  repository: LeadRepository;
  config: OutreachEmailConfig;
  now?: string;
}

export function loadOutreachEmailConfig(environment: NodeJS.ProcessEnv = process.env): OutreachEmailConfig {
  const smtpHost = environment.OUTREACH_SMTP_HOST?.trim() || 'sgp200.greengeeks.net';
  const imapHost = environment.OUTREACH_IMAP_HOST?.trim() || 'sgp200.greengeeks.net';
  const mailboxes = MAILBOX_DEFINITIONS.flatMap((definition) => {
    const password = environment[definition.passwordEnvironmentName]?.trim();
    if (!password) return [];
    return [{
      email: definition.email,
      displayName: definition.displayName,
      password,
      signature: environment[definition.signatureEnvironmentName]?.trim()
        || `${definition.displayName}\nCodistan Ventures\nhttps://codistan.org`,
    }];
  });
  const configuredEmails = new Set(mailboxes.map((mailbox) => mailbox.email));
  const configuredActiveSenders = splitEmails(environment.OUTREACH_SENDER_EMAILS);
  const requestedActiveSenders = configuredActiveSenders.length ? configuredActiveSenders : DEFAULT_ACTIVE_SENDERS;

  return {
    smtpHost,
    smtpPort: positiveInteger(environment.OUTREACH_SMTP_PORT, 465),
    smtpSecure: environment.OUTREACH_SMTP_SECURE !== 'false',
    imapHost,
    imapPort: positiveInteger(environment.OUTREACH_IMAP_PORT, 993),
    imapSecure: environment.OUTREACH_IMAP_SECURE !== 'false',
    mailboxes,
    activeSenderEmails: requestedActiveSenders.filter((email) => configuredEmails.has(email)),
    alertEmails: uniqueEmails([...DEFAULT_ALERT_EMAILS, ...splitEmails(environment.OUTREACH_ALERT_EMAILS)]),
    unsubscribeEmail: normalizeEmail(environment.OUTREACH_UNSUBSCRIBE_EMAIL) ?? 'sales@codistan.org',
    sendingEnabled: environment.OUTREACH_SENDING_ENABLED === 'true',
    dnsReady: environment.OUTREACH_DNS_READY === 'true',
    dryRun: environment.OUTREACH_DRY_RUN !== 'false',
    replyPollingEnabled: environment.OUTREACH_REPLY_POLLING_ENABLED !== 'false',
    alertsEnabled: environment.OUTREACH_ALERTS_ENABLED !== 'false',
    rampStartedAt: validIsoDate(environment.OUTREACH_RAMP_STARTED_AT),
    requestedDailyLimit: boundedInteger(environment.OUTREACH_DAILY_LIMIT, 50, 1, 100),
    maxPerCycle: boundedInteger(environment.OUTREACH_MAX_PER_CYCLE, 10, 1, 25),
    maxPerMailboxPerCycle: boundedInteger(environment.OUTREACH_MAX_PER_MAILBOX_PER_CYCLE, 5, 1, 10),
    maxPerRecipientDomainPerCycle: boundedInteger(environment.OUTREACH_MAX_PER_RECIPIENT_DOMAIN_PER_CYCLE, 2, 1, 5),
    localStartHour: boundedInteger(environment.OUTREACH_LOCAL_START_HOUR, 9, 0, 23),
    localEndHour: boundedInteger(environment.OUTREACH_LOCAL_END_HOUR, 16, 1, 24),
  };
}

export function isLiveSendingAllowed(config: OutreachEmailConfig): boolean {
  return config.sendingEnabled
    && config.dnsReady
    && !config.dryRun
    && Boolean(config.rampStartedAt)
    && config.activeSenderEmails.length > 0;
}

export function getRampDailyLimit(config: OutreachEmailConfig, now: string): number {
  if (!config.rampStartedAt) return 0;
  const start = Date.parse(config.rampStartedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(current) || current < start) return 0;
  const day = Math.floor((current - start) / 86_400_000) + 1;
  const rampLimit = day <= 3 ? 10 : day <= 6 ? 20 : day <= 10 ? 40 : 50;
  return Math.min(config.requestedDailyLimit, rampLimit);
}

export function planOutreachMessages(input: {
  repository: LeadRepository;
  config: OutreachEmailConfig;
  now: string;
}): { messages: PlannedOutreachMessage[]; skippedByDailyLimit: number } {
  const { repository, config, now } = input;
  const liveDailyLimit = getRampDailyLimit(config, now);
  const effectiveDailyLimit = liveDailyLimit || config.requestedDailyLimit;
  const sentToday = repository.listLeads().flatMap(parseSentEvents).filter((event) => sameUtcDay(event.sentAt, now)).length;
  const remainingToday = Math.max(0, effectiveDailyLimit - sentToday);
  if (remainingToday === 0) return { messages: [], skippedByDailyLimit: 1 };

  const activeMailboxes = config.mailboxes.filter((mailbox) => config.activeSenderEmails.includes(mailbox.email));
  if (activeMailboxes.length === 0) return { messages: [], skippedByDailyLimit: 0 };

  const candidates = repository.listLeads()
    .map((record) => buildCandidate(record, activeMailboxes, config, now))
    .filter((candidate): candidate is PlannedOutreachMessage => Boolean(candidate))
    .sort((left, right) => compareCandidates(repository, left, right));

  const selected: PlannedOutreachMessage[] = [];
  const mailboxCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  const cycleLimit = Math.min(config.maxPerCycle, remainingToday);

  for (const candidate of candidates) {
    if (selected.length >= cycleLimit) break;
    const mailboxCount = mailboxCounts.get(candidate.sender.email) ?? 0;
    if (mailboxCount >= config.maxPerMailboxPerCycle) continue;
    const domain = emailDomain(candidate.recipient);
    const domainCount = domainCounts.get(domain) ?? 0;
    if (domainCount >= config.maxPerRecipientDomainPerCycle) continue;
    selected.push(candidate);
    mailboxCounts.set(candidate.sender.email, mailboxCount + 1);
    domainCounts.set(domain, domainCount + 1);
  }

  return {
    messages: selected,
    skippedByDailyLimit: Math.max(0, candidates.length - selected.length),
  };
}

export async function runOutreachCycle(input: RunOutreachCycleInput): Promise<OutreachCycleReport> {
  const startedAt = input.now ?? new Date().toISOString();
  const report: OutreachCycleReport = {
    startedAt,
    completedAt: startedAt,
    liveSendingAllowed: isLiveSendingAllowed(input.config),
    dryRun: input.config.dryRun,
    configuredMailboxCount: input.config.mailboxes.length,
    activeSenderCount: input.config.activeSenderEmails.length,
    repliesChecked: 0,
    repliesMatched: 0,
    repliesProcessed: 0,
    bouncesOrSuppressions: 0,
    alertsSent: 0,
    planned: 0,
    sent: 0,
    failed: 0,
    skippedByDailyLimit: 0,
    errors: [],
    sentLeadIds: [],
  };
  const transporters = new Map<string, ReturnType<typeof nodemailer.createTransport>>();

  if (input.config.replyPollingEnabled) {
    for (const mailbox of input.config.mailboxes) {
      try {
        const replyResult = await pollMailboxReplies({
          repository: input.repository,
          config: input.config,
          mailbox,
          generatedAt: startedAt,
          transporters,
        });
        report.repliesChecked += replyResult.checked;
        report.repliesMatched += replyResult.matched;
        report.repliesProcessed += replyResult.processed;
        report.bouncesOrSuppressions += replyResult.suppressed;
        report.alertsSent += replyResult.alertsSent;
        report.errors.push(...replyResult.errors);
      } catch (error) {
        report.errors.push(`IMAP ${mailbox.email}: ${errorMessage(error)}`);
      }
    }
  }

  const plan = planOutreachMessages({ repository: input.repository, config: input.config, now: startedAt });
  report.planned = plan.messages.length;
  report.skippedByDailyLimit = plan.skippedByDailyLimit;

  if (report.liveSendingAllowed) {
    for (const message of plan.messages) {
      try {
        const transporter = await getVerifiedTransporter(message.sender, input.config, transporters);
        await transporter.sendMail({
          from: { name: message.sender.displayName, address: message.sender.email },
          to: message.recipient,
          replyTo: message.replyTo,
          subject: message.subject,
          text: message.text,
          messageId: message.messageId,
          envelope: { from: message.sender.email, to: [message.recipient] },
          headers: {
            'X-Codistan-Lead-ID': message.leadId,
            'X-Codistan-Sequence': String(message.sequence),
            'List-Unsubscribe': `<mailto:${input.config.unsubscribeEmail}?subject=unsubscribe>`,
          },
        });
        recordSentMessage(input.repository, message, startedAt);
        report.sent += 1;
        report.sentLeadIds.push(message.leadId);
      } catch (error) {
        report.failed += 1;
        report.errors.push(`SMTP ${message.sender.email} → ${message.recipient}: ${errorMessage(error)}`);
        input.repository.addNote(
          message.leadId,
          `outreach::send_failed::${encodeNote({ sequence: message.sequence, sender: message.sender.email, recipient: message.recipient, failedAt: startedAt, error: errorMessage(error) })}`,
          'outreach-email-engine',
        );
      }
    }
  }

  report.completedAt = new Date().toISOString();
  return report;
}

export function processInboundReply(input: {
  repository: LeadRepository;
  record: StoredLeadRecord;
  replyBody: string;
  messageId: string;
  from: string;
  receivedAt: string;
  mailboxEmail: string;
}): { record: StoredLeadRecord; guidance: ReplyGuidance; suppressed: boolean } {
  if (hasProcessedInbound(input.record, input.messageId)) {
    const guidance = analyzeInboundReply(input.record.lead, input.replyBody, { generatedAt: input.receivedAt });
    return { record: input.record, guidance, suppressed: false };
  }

  const guidance = analyzeInboundReply(input.record.lead, input.replyBody, { generatedAt: input.receivedAt });
  const shouldSuppress = ['unsubscribe_or_stop', 'bounce_or_delivery_failure', 'not_relevant'].includes(guidance.classification);
  const updatedLead: Lead = {
    ...input.record.lead,
    lastResponseAt: guidance.classification === 'automatic_reply_or_out_of_office'
      || guidance.classification === 'bounce_or_delivery_failure'
      ? input.record.lead.lastResponseAt
      : input.receivedAt,
    pipelineStatus: guidance.recommendedPipelineStatus,
    recommendedNextAction: guidance.recommendedNextAction,
    nextFollowUpAt: shouldSuppress ? undefined : input.record.lead.nextFollowUpAt,
    followUpNote: shouldSuppress ? undefined : input.record.lead.followUpNote,
    updatedAt: input.receivedAt,
  };
  input.repository.upsertLead(updatedLead, 'outreach-reply-engine');
  input.repository.addNote(
    input.record.lead.id,
    `${INBOUND_NOTE_PREFIX}${encodeNote({
      messageId: input.messageId,
      from: input.from,
      mailboxEmail: input.mailboxEmail,
      receivedAt: input.receivedAt,
      classification: guidance.classification,
      replyBody: input.replyBody,
    })}`,
    'outreach-reply-engine',
  );
  input.repository.addNote(
    input.record.lead.id,
    `guidance::reply::${formatReplyGuidanceForTimeline(guidance)}`,
    'outreach-reply-engine',
  );
  if (shouldSuppress) {
    input.repository.addNote(
      input.record.lead.id,
      `${SUPPRESSION_NOTE_PREFIX}${encodeNote({ email: input.record.lead.contactEmail ?? input.from, reason: guidance.classification, recordedAt: input.receivedAt })}`,
      'outreach-reply-engine',
    );
  }
  return {
    record: input.repository.getLead(input.record.lead.id)!,
    guidance,
    suppressed: shouldSuppress,
  };
}

export function parseSentEvents(record: StoredLeadRecord): SentOutreachEvent[] {
  return record.notes.flatMap((note) => {
    if (!note.startsWith(SENT_NOTE_PREFIX)) return [];
    const parsed = decodeNote<SentOutreachEvent>(note.slice(SENT_NOTE_PREFIX.length));
    return parsed?.leadId && Number.isInteger(parsed.sequence) ? [parsed] : [];
  }).sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt));
}

export function parseSuppressions(record: StoredLeadRecord): SuppressionEvent[] {
  return record.notes.flatMap((note) => {
    if (!note.startsWith(SUPPRESSION_NOTE_PREFIX)) return [];
    const parsed = decodeNote<SuppressionEvent>(note.slice(SUPPRESSION_NOTE_PREFIX.length));
    return parsed?.email ? [parsed] : [];
  });
}

export function resolveRecipientTimeZone(lead: Pick<Lead, 'country' | 'region'>): string {
  const region = normalizeText(lead.region ?? '');
  const country = normalizeText(lead.country ?? '');
  if (/(california|washington|oregon|nevada|british columbia)/.test(region)) return 'America/Los_Angeles';
  if (/(colorado|utah|arizona|alberta)/.test(region)) return 'America/Denver';
  if (/(texas|illinois|minnesota|wisconsin|manitoba)/.test(region)) return 'America/Chicago';
  if (country.includes('united states') || country === 'usa' || country.includes('canada')) return 'America/New_York';
  if (country.includes('pakistan')) return 'Asia/Karachi';
  if (country.includes('united kingdom') || country === 'uk' || country.includes('ireland')) return 'Europe/London';
  if (country.includes('united arab emirates') || country.includes('uae')) return 'Asia/Dubai';
  if (country.includes('saudi')) return 'Asia/Riyadh';
  if (country.includes('australia')) return 'Australia/Sydney';
  if (country.includes('singapore')) return 'Asia/Singapore';
  if (country.includes('japan')) return 'Asia/Tokyo';
  if (country.includes('germany') || country.includes('france') || country.includes('netherlands') || country.includes('spain') || country.includes('italy')) return 'Europe/Berlin';
  return 'UTC';
}

export function isRecipientBusinessTime(lead: Pick<Lead, 'country' | 'region'>, now: string, startHour = 9, endHour = 16): boolean {
  const timeZone = resolveRecipientTimeZone(lead);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return weekday !== 'Sat' && weekday !== 'Sun' && Number.isFinite(hour) && hour >= startHour && hour < endHour;
}

function buildCandidate(
  record: StoredLeadRecord,
  activeMailboxes: OutreachMailbox[],
  config: OutreachEmailConfig,
  now: string,
): PlannedOutreachMessage | undefined {
  const lead = record.lead;
  if (!lead.contactEmail || !normalizeEmail(lead.contactEmail)) return undefined;
  if (CLOSED_STATUSES.has(lead.pipelineStatus)) return undefined;
  if (lead.pipelineStatus === 'needs_human_review' || lead.pipelineStatus === 'needs_research') return undefined;
  if (!record.notes.some((note) => note.startsWith(FIRST_GUIDANCE_PREFIX))) return undefined;
  if (parseSuppressions(record).length > 0) return undefined;
  if (lead.lastResponseAt) return undefined;
  if (!isRecipientBusinessTime(lead, now, config.localStartHour, config.localEndHour)) return undefined;

  const sentEvents = parseSentEvents(record);
  const sequence = nextDueSequence(sentEvents, now);
  if (sequence === undefined) return undefined;
  if (sequence === 0 && lead.pipelineStatus !== 'draft_ready' && lead.pipelineStatus !== 'approved_to_contact') return undefined;
  if (sequence > 0 && sentEvents.length === 0) return undefined;

  const sender = chooseSender(lead, activeMailboxes);
  const recipient = normalizeEmail(lead.contactEmail)!;
  const replyTo = normalizeEmail(lead.owner) ?? sender.email;
  const recipientTimeZone = resolveRecipientTimeZone(lead);
  const dueAt = sequence === 0
    ? now
    : new Date(Date.parse(sentEvents[0]!.sentAt) + FOLLOW_UP_DAYS[sequence]! * 86_400_000).toISOString();
  const messageId = `<codistan.${safeId(lead.id)}.${sequence}.${Date.parse(now)}@codistan.org>`;
  const subject = buildSubject(record, sequence);
  const body = buildMessageBody(record, sequence, sender, config.unsubscribeEmail);

  return {
    leadId: lead.id,
    sequence,
    sender,
    recipient,
    replyTo,
    subject,
    text: body,
    messageId,
    dueAt,
    recipientTimeZone,
  };
}

function nextDueSequence(sentEvents: SentOutreachEvent[], now: string): number | undefined {
  if (sentEvents.length === 0) return 0;
  const completed = new Set(sentEvents.map((event) => event.sequence));
  const firstSentAt = Date.parse(sentEvents[0]!.sentAt);
  const nowTime = Date.parse(now);
  for (let sequence = 1; sequence < FOLLOW_UP_DAYS.length; sequence += 1) {
    if (completed.has(sequence)) continue;
    const dueTime = firstSentAt + FOLLOW_UP_DAYS[sequence]! * 86_400_000;
    return nowTime >= dueTime ? sequence : undefined;
  }
  return undefined;
}

function chooseSender(lead: Pick<Lead, 'id' | 'owner'>, mailboxes: OutreachMailbox[]): OutreachMailbox {
  const owner = normalizeEmail(lead.owner);
  const ownerMailbox = owner ? mailboxes.find((mailbox) => mailbox.email === owner) : undefined;
  if (ownerMailbox) return ownerMailbox;
  return mailboxes[stableIndex(lead.id, mailboxes.length)]!;
}

function buildSubject(record: StoredLeadRecord, sequence: number): string {
  const company = record.lead.companyName ?? 'your team';
  const service = serviceLabel(record.lead.serviceCategory);
  if (sequence > 0) return `Re: ${service} support for ${company}`;
  const guidance = record.notes.find((note) => note.startsWith(FIRST_GUIDANCE_PREFIX));
  const subjectLine = guidance?.match(/Subjects:\s*([^|\n]+)/)?.[1]?.trim();
  return subjectLine || `${service} support for ${company}`;
}

function buildMessageBody(record: StoredLeadRecord, sequence: number, sender: OutreachMailbox, unsubscribeEmail: string): string {
  const lead = record.lead;
  const firstName = lead.contactName?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  let content: string;
  if (sequence === 0) {
    content = lead.draftMessage?.trim() || `${greeting}\n\nI noticed ${lead.companyName ?? 'your team'}'s recent activity around ${lead.title}. Codistan can support this through ${serviceLabel(lead.serviceCategory)} delivery. Would it be useful if I sent two relevant examples and a short delivery approach?`;
  } else if (sequence === 1) {
    content = `${greeting}\n\nFollowing up with one relevant angle: ${lead.materialsToShare ?? `an approved ${serviceLabel(lead.serviceCategory)} case study`}. We can support either a defined project or focused overflow capacity without adding management overhead.\n\nWould it be useful for me to send the most relevant example?`;
  } else if (sequence === 2) {
    content = `${greeting}\n\nA practical way to test the fit could be a small, clearly scoped pilot or a specialist delivery pod around ${serviceLabel(lead.serviceCategory)}. That would let both teams validate delivery before considering anything larger.\n\nIs there a current or upcoming requirement where this model could be useful?`;
  } else {
    content = `${greeting}\n\nI wanted to close the loop. Should I send the relevant examples, reconnect at a later time, or close this out? Any of those is completely fine.`;
  }
  return `${content}\n\nBest regards,\n${sender.signature}\n\n${BUSINESS_ADDRESS}\nTo stop receiving these messages, reply with “unsubscribe” or email ${unsubscribeEmail}.`;
}

function recordSentMessage(repository: LeadRepository, message: PlannedOutreachMessage, sentAt: string): void {
  const record = repository.getLead(message.leadId);
  if (!record) return;
  const event: SentOutreachEvent = {
    leadId: message.leadId,
    sequence: message.sequence,
    sender: message.sender.email,
    recipient: message.recipient,
    subject: message.subject,
    messageId: message.messageId,
    sentAt,
  };
  repository.addNote(message.leadId, `${SENT_NOTE_PREFIX}${encodeNote(event)}`, 'outreach-email-engine');
  const nextSequence = message.sequence + 1;
  const nextFollowUpAt = nextSequence < FOLLOW_UP_DAYS.length
    ? new Date(Date.parse(sentAt) + FOLLOW_UP_DAYS[nextSequence]! * 86_400_000).toISOString()
    : undefined;
  repository.upsertLead({
    ...record.lead,
    pipelineStatus: 'sent_manually',
    lastContactedAt: sentAt,
    nextFollowUpAt,
    followUpNote: nextFollowUpAt ? `Automated outreach sequence ${nextSequence + 1} of ${FOLLOW_UP_DAYS.length}` : undefined,
    updatedAt: sentAt,
  }, 'outreach-email-engine');
}

async function pollMailboxReplies(input: {
  repository: LeadRepository;
  config: OutreachEmailConfig;
  mailbox: OutreachMailbox;
  generatedAt: string;
  transporters: Map<string, ReturnType<typeof nodemailer.createTransport>>;
}): Promise<{ checked: number; matched: number; processed: number; suppressed: number; alertsSent: number; errors: string[] }> {
  const result = { checked: 0, matched: 0, processed: 0, suppressed: 0, alertsSent: 0, errors: [] as string[] };
  const client = new ImapFlow({
    host: input.config.imapHost,
    port: input.config.imapPort,
    secure: input.config.imapSecure,
    auth: { user: input.mailbox.email, pass: input.mailbox.password },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    for await (const message of client.fetch({ seen: false }, { uid: true, source: true, envelope: true })) {
      result.checked += 1;
      try {
        if (!message.source) {
          await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
          continue;
        }
        const parsed = await simpleParser(message.source);
        const messageId = parsed.messageId?.trim() || `imap-${input.mailbox.email}-${message.uid}`;
        const from = normalizeEmail(parsed.from?.value?.[0]?.address) ?? parsed.from?.text ?? 'unknown';
        const replyBody = (parsed.text || parsed.html?.toString() || parsed.subject || '').trim();
        const record = matchInboundToLead(input.repository, {
          from,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          body: replyBody,
        });
        if (!record) {
          await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
          continue;
        }
        result.matched += 1;
        if (hasProcessedInbound(record, messageId)) {
          await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
          continue;
        }
        const processed = processInboundReply({
          repository: input.repository,
          record,
          replyBody,
          messageId,
          from,
          receivedAt: parsed.date?.toISOString() ?? input.generatedAt,
          mailboxEmail: input.mailbox.email,
        });
        result.processed += 1;
        if (processed.suppressed) result.suppressed += 1;
        if (input.config.alertsEnabled) {
          const alertsSent = await sendReplyAlert({
            config: input.config,
            mailbox: input.mailbox,
            record: processed.record,
            guidance: processed.guidance,
            messageId,
            transporters: input.transporters,
          });
          result.alertsSent += alertsSent;
        }
        await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
      } catch (error) {
        result.errors.push(`${input.mailbox.email} UID ${message.uid}: ${errorMessage(error)}`);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  return result;
}

function matchInboundToLead(repository: LeadRepository, input: {
  from: string;
  inReplyTo?: string | null;
  references?: string | string[] | null;
  body: string;
}): StoredLeadRecord | undefined {
  const referenceValues = uniqueStrings([
    input.inReplyTo ?? '',
    ...(Array.isArray(input.references) ? input.references : [input.references ?? '']),
  ].flatMap((value) => String(value).split(/\s+/)).filter(Boolean));
  const records = repository.listLeads();
  for (const record of records) {
    if (parseSentEvents(record).some((event) => referenceValues.includes(event.messageId))) return record;
  }
  const sender = normalizeEmail(input.from);
  if (sender) {
    const matching = records
      .filter((record) => normalizeEmail(record.lead.contactEmail) === sender && parseSentEvents(record).length > 0)
      .sort((left, right) => latestSentTime(right) - latestSentTime(left));
    if (matching[0]) return matching[0];
  }
  const normalizedBody = normalizeText(input.body);
  return records
    .filter((record) => record.lead.contactEmail && normalizedBody.includes(normalizeText(record.lead.contactEmail)) && parseSentEvents(record).length > 0)
    .sort((left, right) => latestSentTime(right) - latestSentTime(left))[0];
}

async function sendReplyAlert(input: {
  config: OutreachEmailConfig;
  mailbox: OutreachMailbox;
  record: StoredLeadRecord;
  guidance: ReplyGuidance;
  messageId: string;
  transporters: Map<string, ReturnType<typeof nodemailer.createTransport>>;
}): Promise<number> {
  if (input.record.notes.some((note) => note.startsWith(ALERT_NOTE_PREFIX) && note.includes(encodeURIComponent(input.messageId)))) return 0;
  const recipients = uniqueEmails([
    ...input.config.alertEmails,
    ...(normalizeEmail(input.record.lead.owner) ? [normalizeEmail(input.record.lead.owner)!] : []),
  ]);
  if (recipients.length === 0) return 0;
  const transporter = await getVerifiedTransporter(input.mailbox, input.config, input.transporters);
  await transporter.sendMail({
    from: { name: 'Codistan Prospect Desk', address: input.mailbox.email },
    to: recipients,
    subject: `[Prospect reply] ${input.record.lead.companyName ?? input.record.lead.title} — ${label(input.guidance.classification)}`,
    text: [
      `Prospect: ${input.record.lead.companyName ?? input.record.lead.title}`,
      `Contact: ${input.record.lead.contactName ?? input.record.lead.contactEmail ?? 'Unknown'}`,
      `Owner: ${input.record.lead.owner ?? 'Unassigned'}`,
      `Classification: ${label(input.guidance.classification)} (${input.guidance.confidence} confidence)`,
      `Summary: ${input.guidance.summary}`,
      `Next action: ${input.guidance.recommendedNextAction}`,
      `Human approval: ${input.guidance.requiresHumanApproval ? 'Required' : 'Review before sending'}`,
      '',
      'Suggested response:',
      input.guidance.suggestedResponse,
      '',
      `Follow-up instruction: ${input.guidance.followUpInstruction}`,
    ].join('\n'),
  });
  input.record = input.record;
  input.record.notes.push(`${ALERT_NOTE_PREFIX}${encodeURIComponent(input.messageId)}::${new Date().toISOString()}`);
  return 1;
}

async function getVerifiedTransporter(
  mailbox: OutreachMailbox,
  config: OutreachEmailConfig,
  transporters: Map<string, ReturnType<typeof nodemailer.createTransport>>,
): Promise<ReturnType<typeof nodemailer.createTransport>> {
  const existing = transporters.get(mailbox.email);
  if (existing) return existing;
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: mailbox.email, pass: mailbox.password },
    tls: { minVersion: 'TLSv1.2' },
    pool: true,
    maxConnections: 1,
    maxMessages: 20,
  });
  await transporter.verify();
  transporters.set(mailbox.email, transporter);
  return transporter;
}

function hasProcessedInbound(record: StoredLeadRecord, messageId: string): boolean {
  return record.notes.some((note) => {
    if (!note.startsWith(INBOUND_NOTE_PREFIX)) return false;
    const parsed = decodeNote<{ messageId?: string }>(note.slice(INBOUND_NOTE_PREFIX.length));
    return parsed?.messageId === messageId;
  });
}

function formatReplyGuidanceForTimeline(guidance: ReplyGuidance): string {
  return [
    `Classification: ${label(guidance.classification)} (${guidance.confidence} confidence)`,
    `Summary: ${guidance.summary}`,
    `Next action: ${guidance.recommendedNextAction}`,
    `Pipeline: ${label(guidance.recommendedPipelineStatus)}`,
    `Human approval: ${guidance.requiresHumanApproval ? 'Required' : 'Review before sending'}`,
    `Suggested response:\n${guidance.suggestedResponse}`,
    `Follow-up: ${guidance.followUpInstruction}`,
    guidance.riskNotes.length ? `Risk notes: ${guidance.riskNotes.join(' | ')}` : '',
  ].filter(Boolean).join('\n\n');
}

function compareCandidates(repository: LeadRepository, left: PlannedOutreachMessage, right: PlannedOutreachMessage): number {
  const leftRecord = repository.getLead(left.leadId);
  const rightRecord = repository.getLead(right.leadId);
  const sequenceDifference = right.sequence - left.sequence;
  if (sequenceDifference !== 0) return sequenceDifference;
  const leftRank = leftRecord?.lead.rank ?? 9999;
  const rightRank = rightRecord?.lead.rank ?? 9999;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return Date.parse(left.dueAt) - Date.parse(right.dueAt);
}

function latestSentTime(record: StoredLeadRecord): number {
  return Math.max(0, ...parseSentEvents(record).map((event) => Date.parse(event.sentAt)));
}

function serviceLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stableIndex(value: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

function encodeNote(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeNote<T>(value: string): T | undefined {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(0, 80);
}

function sameUtcDay(left: string, right: string): boolean {
  return left.slice(0, 10) === right.slice(0, 10);
}

function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? email.toLowerCase();
}

function splitEmails(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return uniqueEmails(value.split(/[\n,;]+/));
}

function uniqueEmails(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeEmail(value)).filter((value): value is string => Boolean(value)))];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeEmail(value: string | undefined | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function validIsoDate(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
