import { PROSPECT_TEAM } from '@sales-automation/prospect-discovery';
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
  ccEmails: string[];
  alertEmails: string[];
}

const SALES_EMAIL = 'sales@codistan.org';
const WASEEM_EMAIL = 'waseem@codistan.org';

const defaultTeamMembers: TeamMemberOption[] = PROSPECT_TEAM.map((member) => ({
  email: member.email,
  displayName: member.displayName,
  canSendAtLaunch: false,
  canLogin: true,
}));

const defaultAlertEmails = [WASEEM_EMAIL, SALES_EMAIL];
const defaultSenders = [SALES_EMAIL];

export function getTeamMembers(existingOwners: string[] = []): TeamMemberOption[] {
  const extraOwners = splitOwnerValues(process.env.ADDITIONAL_LEAD_OWNERS);
  const allOwners = unique([
    ...defaultTeamMembers.map((member) => member.email),
    ...existingOwners,
    ...extraOwners,
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
  if (!value) return '/portfolio';
  if (value.startsWith('/')) return value;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '/portfolio';
  } catch {
    return '/portfolio';
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
  return unique([SALES_EMAIL, ...configured]);
}

export function resolveLeadRouting(lead: Pick<Lead, 'id' | 'owner'>): LeadRouting {
  const senders = getSendingMailboxes();
  const owner = normalizeEmail(lead.owner);
  const sendFrom = senders.includes(SALES_EMAIL) ? SALES_EMAIL : senders[0] ?? SALES_EMAIL;
  const replyTo = owner ?? sendFrom;
  const ccEmails = unique([owner ?? '', WASEEM_EMAIL])
    .filter((email) => email !== sendFrom);
  return {
    owner: lead.owner?.trim() || undefined,
    sendFrom,
    replyTo,
    ccEmails,
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

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function displayNameFromOwner(owner: string): string {
  const local = owner.split('@')[0] ?? owner;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
