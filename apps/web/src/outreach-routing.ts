import type { Lead } from '@sales-automation/shared';

export interface TeamMemberOption {
  email: string;
  displayName: string;
  canSendAtLaunch: boolean;
}

export interface LeadRouting {
  owner?: string;
  sendFrom: string;
  replyTo: string;
  alertEmails: string[];
}

const defaultTeamMembers: TeamMemberOption[] = [
  { email: 'talha.bashir@codistan.org', displayName: 'Talha Bashir', canSendAtLaunch: true },
  { email: 'jawad.jutt@codistan.org', displayName: 'Jawad Jutt', canSendAtLaunch: true },
  { email: 'moiz.khalid@codistan.org', displayName: 'Moiz Khalid', canSendAtLaunch: false },
  { email: 'subainaaamir@codistan.org', displayName: 'Subaina Aamir', canSendAtLaunch: false },
  { email: 'danishkhalid@codistan.org', displayName: 'Danish Khalid', canSendAtLaunch: false },
];

const defaultAlertEmails = ['waseem@codistan.org', 'sales@codistan.org'];
const defaultSenders = defaultTeamMembers.filter((member) => member.canSendAtLaunch).map((member) => member.email);

export function getTeamMembers(existingOwners: string[] = []): TeamMemberOption[] {
  const extraOwners = splitEmails(process.env.ADDITIONAL_LEAD_OWNERS);
  const allEmails = unique([
    ...defaultTeamMembers.map((member) => member.email),
    ...existingOwners,
    ...extraOwners,
  ]);

  return allEmails.map((email) => {
    const fixed = defaultTeamMembers.find((member) => member.email === email);
    return fixed ?? {
      email,
      displayName: displayNameFromEmail(email),
      canSendAtLaunch: false,
    };
  });
}

export function getPortfolioLibraryUrl(): string | undefined {
  const value = process.env.PORTFOLIO_LIBRARY_URL?.trim();
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function getAlertEmails(): string[] {
  return unique([
    ...defaultAlertEmails,
    ...splitEmails(process.env.OUTREACH_ALERT_EMAILS),
  ]);
}

export function getSendingMailboxes(): string[] {
  const configured = splitEmails(process.env.OUTREACH_SENDER_EMAILS);
  return configured.length ? configured : defaultSenders;
}

export function resolveLeadRouting(lead: Pick<Lead, 'id' | 'owner'>): LeadRouting {
  const senders = getSendingMailboxes();
  const owner = normalizeEmail(lead.owner);
  const sendFrom = owner && senders.includes(owner)
    ? owner
    : senders[stableIndex(lead.id, senders.length)] ?? defaultSenders[0]!;
  const replyTo = owner ?? sendFrom;
  return {
    owner,
    sendFrom,
    replyTo,
    alertEmails: unique([...getAlertEmails(), replyTo]),
  };
}

function splitEmails(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(/[\n,;]+/)
    .map((item) => normalizeEmail(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function stableIndex(value: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
