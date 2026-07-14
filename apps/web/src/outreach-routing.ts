import type { Lead } from '@sales-automation/shared';

export interface TeamMemberOption {
  email: string;
  displayName: string;
  canSendAtLaunch: boolean;
  canLogin?: boolean;
}

export interface LeadRouting {
  owner?: string;
  sendFrom: string;
  replyTo: string;
  alertEmails: string[];
}

const defaultTeamMembers: TeamMemberOption[] = [
  { email: 'talha.bashir@codistan.org', displayName: 'Talha Bashir', canSendAtLaunch: true, canLogin: true },
  { email: 'jawad.jutt@codistan.org', displayName: 'Jawad Jutt', canSendAtLaunch: true, canLogin: true },
  { email: 'moiz.khalid@codistan.org', displayName: 'Moiz Khalid', canSendAtLaunch: false, canLogin: true },
  { email: 'subainaaamir@codistan.org', displayName: 'Subaina Aamir', canSendAtLaunch: false, canLogin: true },
  { email: 'danishkhalid@codistan.org', displayName: 'Danish Khalid', canSendAtLaunch: false, canLogin: true },
  { email: 'hibasohail@codistan.org', displayName: 'Hiba Sohail', canSendAtLaunch: false, canLogin: true },
  { email: 'bilalahmed@codistan.org', displayName: 'Bilal Ahmed', canSendAtLaunch: false, canLogin: true },
];

const defaultAlertEmails = ['waseem@codistan.org', 'sales@codistan.org'];
const defaultSenders = defaultTeamMembers.filter((member) => member.canSendAtLaunch).map((member) => member.email);

export function getTeamMembers(existingOwners: string[] = []): TeamMemberOption[] {
  const extraOwners = splitOwnerValues(process.env.ADDITIONAL_LEAD_OWNERS);
  const allOwners = unique([
    ...defaultTeamMembers.map((member) => member.email),
    ...existingOwners.map(canonicalOwnerValue),
    ...extraOwners.map(canonicalOwnerValue),
  ]);

  return allOwners.map((owner) => {
    const fixed = defaultTeamMembers.find((member) => member.email === owner);
    return fixed ?? {
      email: owner,
      displayName: displayNameFromOwner(owner),
      canSendAtLaunch: false,
      canLogin: false,
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
  const owner = normalizeEmail(canonicalOwnerValue(lead.owner));
  const sendFrom = owner && senders.includes(owner)
    ? owner
    : senders[stableIndex(lead.id, senders.length)] ?? defaultSenders[0]!;
  const replyTo = owner ?? sendFrom;
  return {
    owner: lead.owner?.trim() || undefined,
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

function splitOwnerValues(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(/[\n,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function canonicalOwnerValue(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (['hiba', 'hiba sohail', 'hiba (talha team)'].includes(normalized)) return 'hibasohail@codistan.org';
  if (['bilal', 'bilal ahmed', 'bilal (talha team)'].includes(normalized)) return 'bilalahmed@codistan.org';
  return normalized;
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

function displayNameFromOwner(owner: string): string {
  const local = owner.split('@')[0] ?? owner;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
