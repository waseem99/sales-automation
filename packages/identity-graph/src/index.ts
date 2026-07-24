import { createHash } from 'node:crypto';
import type { Lead } from '@sales-automation/shared';

export const IDENTITY_GRAPH_VERSION = 'identity-graph.v1';

export type IdentityResolutionStatus = 'resolved' | 'candidate' | 'unresolved' | 'conflict';
export type IdentityConfidence = 'high' | 'medium' | 'low';
export type IdentityEvidenceKind =
  | 'linkedin_profile'
  | 'sales_navigator_profile'
  | 'business_email'
  | 'company_domain'
  | 'company_name'
  | 'name_company_role'
  | 'source_fallback';

export interface IdentityEvidence {
  kind: IdentityEvidenceKind;
  value: string;
  confidence: IdentityConfidence;
  sourceLeadId: string;
}

export interface EntityIdentityResolution {
  id: string;
  status: IdentityResolutionStatus;
  confidence: IdentityConfidence;
  matchedLeadIds: string[];
  candidateLeadIds: string[];
  evidence: IdentityEvidence[];
  reason: string;
}

export interface LeadIdentityResolution {
  version: typeof IDENTITY_GRAPH_VERSION;
  resolvedAt: string;
  person: EntityIdentityResolution;
  company: EntityIdentityResolution;
  duplicateContactLeadIds: string[];
  conflicts: string[];
  automaticMergePerformed: false;
}

interface ExistingIdentity {
  lead: Lead;
  resolution?: LeadIdentityResolution;
  personKeys: string[];
  companyDomain?: string;
  companyName?: string;
  compositePersonKey?: string;
}

export function resolveLeadIdentity(
  incoming: Lead,
  existingLeads: Lead[],
  resolvedAt = new Date().toISOString(),
): LeadIdentityResolution {
  const existing = existingLeads
    .filter((lead) => lead.id !== incoming.id)
    .map((lead) => existingIdentity(lead));

  const person = resolvePerson(incoming, existing);
  const company = resolveCompany(incoming, existing, person);
  const duplicateContactLeadIds = unique([
    ...person.matchedLeadIds,
    ...existing
      .filter((entry) => entry.resolution?.person.id === person.id && entry.lead.id !== incoming.id)
      .map((entry) => entry.lead.id),
  ]);
  const conflicts = [
    ...(person.status === 'conflict' ? [person.reason] : []),
    ...(company.status === 'conflict' ? [company.reason] : []),
  ];

  return {
    version: IDENTITY_GRAPH_VERSION,
    resolvedAt,
    person,
    company,
    duplicateContactLeadIds,
    conflicts,
    automaticMergePerformed: false,
  };
}

export function attachIdentityResolution(lead: Lead, resolution: LeadIdentityResolution): Lead {
  const rawPayload = asRecord(lead.rawPayload);
  return {
    ...lead,
    rawPayload: {
      ...rawPayload,
      identityGraph: resolution,
      identityGraphVersion: IDENTITY_GRAPH_VERSION,
      duplicateContactLeadIds: resolution.duplicateContactLeadIds,
    },
  };
}

export function readIdentityResolution(lead: Lead): LeadIdentityResolution | undefined {
  const raw = asRecord(lead.rawPayload);
  const value = raw.identityGraph;
  if (!value || typeof value !== 'object') return undefined;
  const resolution = value as Partial<LeadIdentityResolution>;
  if (resolution.version !== IDENTITY_GRAPH_VERSION) return undefined;
  if (!resolution.person?.id || !resolution.company?.id) return undefined;
  return resolution as LeadIdentityResolution;
}

export function duplicateContactWarning(resolution: LeadIdentityResolution): string | undefined {
  if (resolution.duplicateContactLeadIds.length === 0) return undefined;
  return `Potential duplicate contact across existing records: ${resolution.duplicateContactLeadIds.join(', ')}. Review the unified person/account history before outreach.`;
}

function resolvePerson(incoming: Lead, existing: ExistingIdentity[]): EntityIdentityResolution {
  const evidence = personEvidence(incoming);
  const strongKeys = evidence
    .filter((item) => item.kind === 'linkedin_profile' || item.kind === 'sales_navigator_profile' || item.kind === 'business_email')
    .map((item) => `${item.kind}:${item.value}`);
  const matchesByKey = strongKeys.map((key) => ({
    key,
    matches: existing.filter((entry) => entry.personKeys.includes(key)),
  }));
  const strongMatches = unique(matchesByKey.flatMap((item) => item.matches.map((entry) => entry.lead.id)));
  const matchedPersonIds = unique(matchesByKey.flatMap((item) => item.matches.map((entry) => entry.resolution?.person.id).filter(isString)));

  if (matchedPersonIds.length > 1) {
    return {
      id: localPersonId(incoming),
      status: 'conflict',
      confidence: 'low',
      matchedLeadIds: strongMatches,
      candidateLeadIds: [],
      evidence,
      reason: 'Strong person identifiers point to different existing person identities; human resolution is required.',
    };
  }

  if (strongKeys.length > 0) {
    const id = matchedPersonIds[0] ?? deterministicId('person', strongKeys.sort()[0]);
    return {
      id,
      status: 'resolved',
      confidence: evidence.some((item) => item.confidence === 'high') ? 'high' : 'medium',
      matchedLeadIds: strongMatches,
      candidateLeadIds: [],
      evidence,
      reason: strongMatches.length > 0
        ? 'Resolved from an exact canonical profile or business-email match.'
        : 'Created from a deterministic canonical profile or business-email identity.',
    };
  }

  const composite = compositePersonKey(incoming);
  const candidates = composite
    ? existing.filter((entry) => entry.compositePersonKey === composite).map((entry) => entry.lead.id)
    : [];
  if (candidates.length > 0) {
    return {
      id: localPersonId(incoming),
      status: 'candidate',
      confidence: 'low',
      matchedLeadIds: [],
      candidateLeadIds: unique(candidates),
      evidence,
      reason: 'Name, company and role resemble an existing person, but no strong canonical identifier is available. Do not merge automatically.',
    };
  }

  return {
    id: localPersonId(incoming),
    status: 'unresolved',
    confidence: 'low',
    matchedLeadIds: [],
    candidateLeadIds: [],
    evidence,
    reason: 'No canonical profile or exact business-email identity is available.',
  };
}

function resolveCompany(
  incoming: Lead,
  existing: ExistingIdentity[],
  person: EntityIdentityResolution,
): EntityIdentityResolution {
  const evidence = companyEvidence(incoming);
  const domain = companyDomain(incoming);
  const name = normalizeCompanyName(incoming.companyName);

  if (domain) {
    const matches = existing.filter((entry) => entry.companyDomain === domain);
    const companyIds = unique(matches.map((entry) => entry.resolution?.company.id).filter(isString));
    if (companyIds.length > 1) {
      return {
        id: localCompanyId(incoming),
        status: 'conflict',
        confidence: 'low',
        matchedLeadIds: matches.map((entry) => entry.lead.id),
        candidateLeadIds: [],
        evidence,
        reason: 'The same company domain is attached to conflicting existing company identities; human resolution is required.',
      };
    }
    return {
      id: companyIds[0] ?? deterministicId('company', `domain:${domain}`),
      status: 'resolved',
      confidence: 'high',
      matchedLeadIds: matches.map((entry) => entry.lead.id),
      candidateLeadIds: [],
      evidence,
      reason: matches.length > 0
        ? 'Resolved from an exact canonical company-domain match.'
        : 'Created from a deterministic canonical company domain.',
    };
  }

  if (name) {
    const sameName = existing.filter((entry) => entry.companyName === name);
    const personMatchedCompany = sameName.find((entry) => person.matchedLeadIds.includes(entry.lead.id));
    if (personMatchedCompany?.resolution?.company.id) {
      return {
        id: personMatchedCompany.resolution.company.id,
        status: 'resolved',
        confidence: 'medium',
        matchedLeadIds: [personMatchedCompany.lead.id],
        candidateLeadIds: sameName.filter((entry) => entry.lead.id !== personMatchedCompany.lead.id).map((entry) => entry.lead.id),
        evidence,
        reason: 'Resolved from an already matched person whose existing record carries the same company name.',
      };
    }
    if (sameName.length > 0) {
      return {
        id: localCompanyId(incoming),
        status: 'candidate',
        confidence: 'low',
        matchedLeadIds: [],
        candidateLeadIds: sameName.map((entry) => entry.lead.id),
        evidence,
        reason: 'Exact company-name matches exist, but no domain or matched-person evidence confirms the account. Do not merge automatically.',
      };
    }
  }

  return {
    id: localCompanyId(incoming),
    status: 'unresolved',
    confidence: 'low',
    matchedLeadIds: [],
    candidateLeadIds: [],
    evidence,
    reason: name
      ? 'A company name is available, but no canonical company domain confirms identity.'
      : 'No company identity evidence is available.',
  };
}

function existingIdentity(lead: Lead): ExistingIdentity {
  return {
    lead,
    resolution: readIdentityResolution(lead),
    personKeys: personEvidence(lead)
      .filter((item) => item.kind === 'linkedin_profile' || item.kind === 'sales_navigator_profile' || item.kind === 'business_email')
      .map((item) => `${item.kind}:${item.value}`),
    companyDomain: companyDomain(lead),
    companyName: normalizeCompanyName(lead.companyName),
    compositePersonKey: compositePersonKey(lead),
  };
}

function personEvidence(lead: Lead): IdentityEvidence[] {
  const evidence: IdentityEvidence[] = [];
  const profile = canonicalLinkedInIdentity(lead.linkedinUrl ?? lead.sourceUrl);
  if (profile) {
    evidence.push({
      kind: profile.startsWith('/sales/lead/') ? 'sales_navigator_profile' : 'linkedin_profile',
      value: profile,
      confidence: 'high',
      sourceLeadId: lead.id,
    });
  }
  const email = normalizeEmail(lead.contactEmail);
  if (email) {
    evidence.push({
      kind: 'business_email',
      value: email,
      confidence: emailVerificationStatus(lead) === 'verified' ? 'high' : 'medium',
      sourceLeadId: lead.id,
    });
  }
  const composite = compositePersonKey(lead);
  if (composite) {
    evidence.push({
      kind: 'name_company_role',
      value: composite,
      confidence: 'low',
      sourceLeadId: lead.id,
    });
  }
  if (evidence.length === 0) {
    evidence.push({
      kind: 'source_fallback',
      value: lead.sourceUrl ?? lead.id,
      confidence: 'low',
      sourceLeadId: lead.id,
    });
  }
  return evidence;
}

function companyEvidence(lead: Lead): IdentityEvidence[] {
  const evidence: IdentityEvidence[] = [];
  const domain = companyDomain(lead);
  if (domain) {
    evidence.push({kind: 'company_domain', value: domain, confidence: 'high', sourceLeadId: lead.id});
  }
  const name = normalizeCompanyName(lead.companyName);
  if (name) {
    evidence.push({kind: 'company_name', value: name, confidence: 'low', sourceLeadId: lead.id});
  }
  if (evidence.length === 0) {
    evidence.push({kind: 'source_fallback', value: lead.sourceUrl ?? lead.id, confidence: 'low', sourceLeadId: lead.id});
  }
  return evidence;
}

function canonicalLinkedInIdentity(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!['linkedin.com', 'www.linkedin.com', 'sales.linkedin.com'].includes(url.hostname.toLowerCase())) return undefined;
    const path = url.pathname.replace(/\/$/, '');
    if (path.startsWith('/in/')) return path.toLowerCase();
    if (path.startsWith('/sales/lead/')) {
      const parts = path.split('/').filter(Boolean);
      return parts.length >= 3 ? `/${parts.slice(0, 3).join('/')}`.toLowerCase() : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function companyDomain(lead: Lead): string | undefined {
  const candidates = [lead.companyWebsite, companyWebsiteFromRawPayload(lead.rawPayload)];
  for (const value of candidates) {
    const domain = normalizeDomain(value);
    if (domain) return domain;
  }
  return undefined;
}

function companyWebsiteFromRawPayload(value: unknown): string | undefined {
  const raw = asRecord(value);
  const enrichment = asRecord(raw.enrichment);
  const company = asRecord(raw.company);
  const candidates = [
    enrichment.companyWebsite,
    enrichment.companyDomain,
    company.website,
    company.domain,
  ];
  return candidates.find(isString);
}

function emailVerificationStatus(lead: Lead): string {
  const raw = asRecord(lead.rawPayload);
  const enrichment = asRecord(raw.enrichment);
  const contact = asRecord(raw.contact);
  return String(enrichment.emailStatus ?? contact.emailStatus ?? '').toLowerCase();
}

function compositePersonKey(lead: Lead): string | undefined {
  const name = normalizeName(lead.contactName);
  const company = normalizeCompanyName(lead.companyName);
  const role = normalizeRole(lead.contactRole);
  if (!name || !company || !role) return undefined;
  return `${name}|${company}|${role}`;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

function normalizeDomain(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!host || ['linkedin.com', 'upwork.com'].includes(host) || host.endsWith('.linkedin.com') || host.endsWith('.upwork.com')) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

function normalizeName(value: string | undefined): string | undefined {
  const normalized = normalizeWords(value);
  return normalized && normalized.length >= 3 ? normalized : undefined;
}

function normalizeCompanyName(value: string | undefined): string | undefined {
  const normalized = normalizeWords(value)
    ?.replace(/\b(?:private limited|pvt ltd|pvt limited|limited|ltd|incorporated|inc|llc|plc|company|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized && normalized.length >= 2 ? normalized : undefined;
}

function normalizeRole(value: string | undefined): string | undefined {
  const normalized = normalizeWords(value);
  return normalized && normalized.length >= 2 ? normalized : undefined;
}

function normalizeWords(value: string | undefined): string | undefined {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

function localPersonId(lead: Lead): string {
  return deterministicId('person-local', `${lead.source}:${lead.sourceUrl ?? lead.id}`);
}

function localCompanyId(lead: Lead): string {
  return deterministicId('company-local', `${lead.source}:${lead.companyName ?? ''}:${lead.sourceUrl ?? lead.id}`);
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
