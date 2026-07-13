import type { Lead } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

export type DashboardScopeKind = 'all' | 'team' | 'own';

export interface DashboardAccessScope {
  identifier: string;
  displayName: string;
  scopeKind: DashboardScopeKind;
  scopeLabel: string;
  visibleOwnerTokens: string[];
  canRunGlobalOperations: boolean;
  canAssignOwners: boolean;
}

const ADMIN_IDENTIFIERS = new Set(['admin', 'administrator']);

const identityDirectory: Record<string, Omit<DashboardAccessScope, 'identifier'>> = {
  'waseem@codistan.org': {
    displayName: 'Waseem Khan',
    scopeKind: 'all',
    scopeLabel: 'All company leads',
    visibleOwnerTokens: [],
    canRunGlobalOperations: true,
    canAssignOwners: true,
  },
  'talha.bashir@codistan.org': {
    displayName: 'Talha Bashir',
    scopeKind: 'team',
    scopeLabel: 'Talha team leads',
    visibleOwnerTokens: ['talha.bashir@codistan.org', 'talha bashir', 'talha', 'danishkhalid@codistan.org', 'danish khalid', 'danish', 'hiba', 'bilal'],
    canRunGlobalOperations: false,
    canAssignOwners: true,
  },
  'jawad.jutt@codistan.org': ownScope('Jawad Jutt', ['jawad.jutt@codistan.org', 'jawad jutt', 'jawad']),
  'moiz.khalid@codistan.org': ownScope('Moiz Khalid', ['moiz.khalid@codistan.org', 'moiz khalid', 'moiz']),
  'subainaaamir@codistan.org': ownScope('Subaina Aamir', ['subainaaamir@codistan.org', 'subaina aamir', 'subaina']),
  'danishkhalid@codistan.org': ownScope('Danish Khalid', ['danishkhalid@codistan.org', 'danish khalid', 'danish']),
};

export function resolveDashboardAccess(identifier: string, displayName?: string): DashboardAccessScope {
  const normalized = normalizeIdentifier(identifier);
  if (ADMIN_IDENTIFIERS.has(normalized)) {
    return {
      identifier: normalized,
      displayName: displayName?.trim() || 'Administrator',
      scopeKind: 'all',
      scopeLabel: 'All company leads',
      visibleOwnerTokens: [],
      canRunGlobalOperations: true,
      canAssignOwners: true,
    };
  }

  const configured = identityDirectory[normalized];
  if (configured) return { identifier: normalized, ...configured };

  return {
    identifier: normalized,
    displayName: displayName?.trim() || displayNameFromIdentifier(normalized),
    scopeKind: 'own',
    scopeLabel: 'My assigned leads',
    visibleOwnerTokens: [normalized, localPart(normalized), displayNameFromIdentifier(normalized)].filter(Boolean),
    canRunGlobalOperations: false,
    canAssignOwners: false,
  };
}

export function canAccessLead(access: DashboardAccessScope, lead: Pick<Lead, 'owner'>): boolean {
  if (access.scopeKind === 'all') return true;
  const owner = normalizeOwner(lead.owner);
  if (!owner) return false;
  return access.visibleOwnerTokens.some((token) => ownerMatchesToken(owner, token));
}

export function scopeRecords(access: DashboardAccessScope, records: StoredLeadRecord[]): StoredLeadRecord[] {
  return access.scopeKind === 'all'
    ? records
    : records.filter((record) => canAccessLead(access, record.lead));
}

export function assertCanAccessLead(access: DashboardAccessScope, lead: Pick<Lead, 'owner'>): void {
  if (!canAccessLead(access, lead)) throw new Error('Prospect not found.');
}

export function assertGlobalOperation(access: DashboardAccessScope): void {
  if (!access.canRunGlobalOperations) throw new Error('Forbidden: this operation is restricted to Admin and Waseem.');
}

export function accessScopePayload(access: DashboardAccessScope) {
  return {
    identifier: access.identifier,
    displayName: access.displayName,
    scopeKind: access.scopeKind,
    scopeLabel: access.scopeLabel,
    canRunGlobalOperations: access.canRunGlobalOperations,
    canAssignOwners: access.canAssignOwners,
  };
}

function ownScope(displayName: string, tokens: string[]): Omit<DashboardAccessScope, 'identifier'> {
  return {
    displayName,
    scopeKind: 'own',
    scopeLabel: 'My assigned leads',
    visibleOwnerTokens: tokens,
    canRunGlobalOperations: false,
    canAssignOwners: false,
  };
}

function ownerMatchesToken(owner: string, token: string): boolean {
  const normalizedToken = normalizeOwner(token);
  if (!normalizedToken) return false;
  if (owner === normalizedToken) return true;
  const ownerWords = ` ${owner.replace(/[^a-z0-9@.]+/g, ' ')} `;
  const tokenWords = ` ${normalizedToken.replace(/[^a-z0-9@.]+/g, ' ')} `;
  return ownerWords.includes(tokenWords.trim() === normalizedToken ? ` ${normalizedToken} ` : tokenWords)
    || owner.includes(normalizedToken);
}

function normalizeOwner(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function localPart(identifier: string): string {
  return identifier.split('@')[0]?.replace(/[._-]+/g, ' ') ?? identifier;
}

function displayNameFromIdentifier(identifier: string): string {
  return localPart(identifier)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Dashboard User';
}
