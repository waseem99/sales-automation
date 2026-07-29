import type { Lead } from '@sales-automation/shared';

export const ENRICHMENT_VERSION = 'evidence-enrichment.v1';

export type EnrichmentProvenance =
  | 'source_visible'
  | 'public_web'
  | 'provider_discovered'
  | 'verified'
  | 'human_confirmed'
  | 'system_inference';
export type EnrichmentConfidence = 'high' | 'medium' | 'low';
export type VerificationStatus = 'candidate' | 'verified' | 'invalid' | 'suppressed' | 'not_applicable';
export type ContactabilityStatus = 'contactable_after_review' | 'partial' | 'research_required' | 'suppressed';
export type ResearchTaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type ResearchTaskStatus = 'open' | 'completed' | 'dismissed' | 'on_hold';
export type CompanyClassification =
  | 'agency'
  | 'consultancy'
  | 'system_integrator'
  | 'product_company'
  | 'direct_buyer'
  | 'unknown';

export interface EnrichmentField<T = string> {
  value: T;
  provenance: EnrichmentProvenance;
  confidence: EnrichmentConfidence;
  verificationStatus: VerificationStatus;
  sourceUrl?: string;
  observedAt: string;
  expiresAt?: string;
  provider?: string;
  notes?: string;
}

export interface ContactRoute {
  id: string;
  channel: 'upwork' | 'linkedin' | 'sales_navigator' | 'email' | 'phone' | 'contact_form' | 'referral';
  value: string;
  status: 'available' | 'candidate' | 'verified' | 'invalid' | 'suppressed' | 'platform_restricted';
  provenance: EnrichmentProvenance;
  sourceUrl?: string;
  restriction?: string;
  lastVerifiedAt?: string;
  requiresHumanReview: true;
}

export interface PublicSignal {
  code: string;
  label: string;
  value: string;
  provenance: EnrichmentProvenance;
  confidence: EnrichmentConfidence;
  sourceUrl?: string;
  observedAt: string;
  expiresAt?: string;
}

export interface EnrichmentTask {
  id: string;
  code:
    | 'confirm_company_identity'
    | 'find_company_domain'
    | 'confirm_decision_maker'
    | 'find_business_email'
    | 'verify_business_email'
    | 'find_alternate_decision_maker'
    | 'verify_relationship_path'
    | 'review_conflicting_evidence';
  title: string;
  reason: string;
  priority: ResearchTaskPriority;
  status: ResearchTaskStatus;
  createdAt: string;
  requiredHumanReview: true;
}

export interface CompanyEnrichment {
  name?: EnrichmentField;
  website?: EnrichmentField;
  domain?: EnrichmentField;
  linkedinUrl?: EnrichmentField;
  industry?: EnrichmentField;
  employeeSize?: EnrichmentField;
  headquarters?: EnrichmentField;
  geographies?: EnrichmentField<string[]>;
  classification?: EnrichmentField<CompanyClassification>;
}

export interface PersonEnrichment {
  name?: EnrichmentField;
  role?: EnrichmentField;
  linkedinUrl?: EnrichmentField;
  email?: EnrichmentField;
  phone?: EnrichmentField;
  mutualConnections?: EnrichmentField<string[]>;
  teamLink?: EnrichmentField<boolean>;
  relationshipOwner?: EnrichmentField;
  priorInteraction?: EnrichmentField;
}

export interface EnrichmentSnapshot {
  version: typeof ENRICHMENT_VERSION;
  generatedAt: string;
  sourceLeadId: string;
  company: CompanyEnrichment;
  person: PersonEnrichment;
  contactRoutes: ContactRoute[];
  signals: PublicSignal[];
  tasks: EnrichmentTask[];
  contactability: ContactabilityStatus;
  suppression: {
    suppressed: boolean;
    reason?: string;
    provenance?: EnrichmentProvenance;
  };
  providerMode: {
    mode: 'source_visible_only';
    activeProviders: string[];
    credentialsExposed: false;
  };
  externalActionPerformed: false;
}

export interface EnrichmentProviderInput {
  lead: Lead;
  current?: EnrichmentSnapshot;
}

export interface EnrichmentProviderResult {
  provider: string;
  fields: Partial<EnrichmentSnapshot>;
  observedAt: string;
  sourceUrls: string[];
}

export interface EnrichmentProviderAdapter {
  id: string;
  enabled: boolean;
  permittedUseDocumented: boolean;
  enrich(input: EnrichmentProviderInput): Promise<EnrichmentProviderResult>;
}

export function buildEvidenceBasedEnrichment(
  lead: Lead,
  previous?: EnrichmentSnapshot,
  generatedAt = new Date().toISOString(),
): EnrichmentSnapshot {
  const raw = asRecord(lead.rawPayload);
  const sourceUrl = normalizeUrl(lead.evidenceUrl ?? lead.sourceUrl);
  const companyWebsite = firstValidUrl([
    lead.companyWebsite,
    nestedString(raw, ['enrichment', 'companyWebsite']),
    nestedString(raw, ['enrichment', 'companyDomain']),
    nestedString(raw, ['company', 'website']),
    nestedString(raw, ['company', 'domain']),
    nestedString(raw, ['commercialEvidence', 'company_website']),
  ]);
  const domain = normalizeDomain(companyWebsite);
  const companyLinkedIn = firstLinkedInUrl([
    nestedString(raw, ['enrichment', 'companyLinkedInUrl']),
    nestedString(raw, ['company', 'linkedinUrl']),
    nestedString(raw, ['rawEvidence', 'company_linkedin_url']),
  ]);
  const email = normalizeEmail(lead.contactEmail);
  const explicitEmailStatus = emailStatusFromRaw(raw);
  const suppression = suppressionFrom(lead, raw, explicitEmailStatus);
  const relationship = relationshipEvidence(raw);
  const classification = classifyCompany(lead);

  const current: EnrichmentSnapshot = {
    version: ENRICHMENT_VERSION,
    generatedAt,
    sourceLeadId: lead.id,
    company: compactObject<CompanyEnrichment>({
      name: lead.companyName
        ? evidenceField(lead.companyName, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 90)
        : undefined,
      website: companyWebsite
        ? evidenceField(companyWebsite, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90)
        : undefined,
      domain: domain
        ? evidenceField(domain, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90)
        : undefined,
      linkedinUrl: companyLinkedIn
        ? evidenceField(companyLinkedIn, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90)
        : undefined,
      industry: lead.industry
        ? evidenceField(lead.industry, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 90)
        : optionalField(rawString(raw, ['industry', 'companyIndustry', 'company_industry']), sourceUrl, generatedAt),
      employeeSize: optionalField(rawString(raw, ['employeeSize', 'companySize', 'employee_size']), sourceUrl, generatedAt),
      headquarters: optionalField(rawString(raw, ['headquarters', 'companyHeadquarters']), sourceUrl, generatedAt),
      geographies: geographyField(lead, raw, sourceUrl, generatedAt),
      classification: evidenceField(
        classification.value,
        'system_inference',
        classification.confidence,
        'candidate',
        sourceUrl,
        generatedAt,
        30,
        undefined,
        classification.reason,
      ),
    }),
    person: compactObject<PersonEnrichment>({
      name: lead.contactName
        ? evidenceField(lead.contactName, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90)
        : undefined,
      role: lead.contactRole
        ? evidenceField(lead.contactRole, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 60)
        : undefined,
      linkedinUrl: firstLinkedInUrl([lead.linkedinUrl])
        ? evidenceField(firstLinkedInUrl([lead.linkedinUrl])!, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90)
        : undefined,
      email: email
        ? emailField(email, explicitEmailStatus, sourceUrl, generatedAt)
        : undefined,
      phone: normalizePhone(lead.contactPhone)
        ? evidenceField(normalizePhone(lead.contactPhone)!, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 60)
        : undefined,
      mutualConnections: relationship.mutualConnections.length > 0
        ? evidenceField(relationship.mutualConnections, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 30)
        : undefined,
      teamLink: relationship.teamLink !== undefined
        ? evidenceField(relationship.teamLink, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 30)
        : undefined,
      relationshipOwner: relationship.owner
        ? evidenceField(relationship.owner, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 30)
        : undefined,
      priorInteraction: relationship.priorInteraction
        ? evidenceField(relationship.priorInteraction, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 60)
        : undefined,
    }),
    contactRoutes: [],
    signals: publicSignals(raw, sourceUrl, generatedAt),
    tasks: [],
    contactability: 'research_required',
    suppression,
    providerMode: {
      mode: 'source_visible_only',
      activeProviders: [],
      credentialsExposed: false,
    },
    externalActionPerformed: false,
  };

  current.contactRoutes = buildContactRoutes(lead, current, sourceUrl);
  current.contactability = contactabilityFor(current);
  current.tasks = buildTasks(lead, current, generatedAt);

  return previous ? mergeSnapshots(previous, current) : current;
}

export function attachEnrichmentSnapshot(lead: Lead, snapshot: EnrichmentSnapshot): Lead {
  const raw = asRecord(lead.rawPayload);
  return {
    ...lead,
    rawPayload: {
      ...raw,
      enrichment: snapshot,
      enrichmentVersion: ENRICHMENT_VERSION,
    },
  };
}

export function readEnrichmentSnapshot(lead: Lead): EnrichmentSnapshot | undefined {
  const raw = asRecord(lead.rawPayload);
  const value = raw.enrichment;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const snapshot = value as Partial<EnrichmentSnapshot>;
  if (snapshot.version !== ENRICHMENT_VERSION || snapshot.sourceLeadId !== lead.id) return undefined;
  return snapshot as EnrichmentSnapshot;
}

export function enrichmentStateEqual(
  left: EnrichmentSnapshot | undefined,
  right: EnrichmentSnapshot,
): boolean {
  if (!left) return false;
  return JSON.stringify(stableSnapshot(left)) === JSON.stringify(stableSnapshot(right));
}

function mergeSnapshots(previous: EnrichmentSnapshot, current: EnrichmentSnapshot): EnrichmentSnapshot {
  const company = mergeFieldGroup(previous.company, current.company);
  const person = mergeFieldGroup(previous.person, current.person);
  const suppression = previous.suppression.suppressed
    ? previous.suppression
    : current.suppression;
  const routes = mergeRoutes(previous.contactRoutes, current.contactRoutes, suppression.suppressed);
  const signals = mergeSignals(previous.signals, current.signals);
  const merged: EnrichmentSnapshot = {
    ...current,
    company,
    person,
    contactRoutes: routes,
    signals,
    suppression,
    providerMode: {
      mode: 'source_visible_only',
      activeProviders: unique([...previous.providerMode.activeProviders, ...current.providerMode.activeProviders]),
      credentialsExposed: false,
    },
  };
  merged.contactability = contactabilityFor(merged);
  merged.tasks = mergeTasks(previous.tasks, buildTasksFromSnapshot(merged, current.tasks));
  return merged;
}

function mergeFieldGroup<T extends object>(previous: T, current: T): T {
  const output: Record<string, unknown> = {...previous};
  for (const [key, value] of Object.entries(current)) {
    if (!value) continue;
    const previousValue = output[key];
    output[key] = isEnrichmentField(previousValue) && isEnrichmentField(value)
      ? strongerField(previousValue, value)
      : value;
  }
  return output as T;
}

function strongerField<T>(previous: EnrichmentField<T>, current: EnrichmentField<T>): EnrichmentField<T> {
  const previousScore = fieldStrength(previous);
  const currentScore = fieldStrength(current);
  if (previousScore > currentScore) return previous;
  if (currentScore > previousScore) return current;
  return Date.parse(previous.observedAt) > Date.parse(current.observedAt) ? previous : current;
}

function fieldStrength(field: EnrichmentField<unknown>): number {
  const provenance: Record<EnrichmentProvenance, number> = {
    human_confirmed: 100,
    verified: 90,
    source_visible: 70,
    public_web: 65,
    provider_discovered: 55,
    system_inference: 25,
  };
  const verification: Record<VerificationStatus, number> = {
    verified: 30,
    suppressed: 25,
    invalid: 20,
    candidate: 10,
    not_applicable: 0,
  };
  const confidence: Record<EnrichmentConfidence, number> = {high: 15, medium: 8, low: 2};
  return provenance[field.provenance] + verification[field.verificationStatus] + confidence[field.confidence];
}

function emailField(
  email: string,
  explicitStatus: VerificationStatus | undefined,
  sourceUrl: string | undefined,
  observedAt: string,
): EnrichmentField {
  const status = explicitStatus ?? 'candidate';
  const provenance: EnrichmentProvenance = status === 'verified' ? 'verified' : 'source_visible';
  const confidence: EnrichmentConfidence = status === 'verified' ? 'high' : status === 'invalid' || status === 'suppressed' ? 'high' : 'medium';
  return evidenceField(email, provenance, confidence, status, sourceUrl, observedAt, status === 'verified' ? 60 : 30);
}

function buildContactRoutes(
  lead: Lead,
  snapshot: EnrichmentSnapshot,
  sourceUrl: string | undefined,
): ContactRoute[] {
  const routes: ContactRoute[] = [];
  if (lead.source === 'upwork' && lead.sourceUrl) {
    routes.push({
      id: `${lead.id}:upwork`,
      channel: 'upwork',
      value: lead.sourceUrl,
      status: 'platform_restricted',
      provenance: 'source_visible',
      sourceUrl,
      restriction: 'Use Upwork for the active job. Do not infer or use an off-platform route without separate permitted public evidence.',
      requiresHumanReview: true,
    });
  }
  if (snapshot.person.linkedinUrl) {
    routes.push({
      id: `${lead.id}:linkedin`,
      channel: lead.source === 'sales_navigator' ? 'sales_navigator' : 'linkedin',
      value: snapshot.person.linkedinUrl.value,
      status: 'available',
      provenance: snapshot.person.linkedinUrl.provenance,
      sourceUrl: snapshot.person.linkedinUrl.sourceUrl,
      requiresHumanReview: true,
    });
  }
  if (snapshot.person.email) {
    routes.push({
      id: `${lead.id}:email`,
      channel: 'email',
      value: snapshot.person.email.value,
      status: snapshot.person.email.verificationStatus === 'verified'
        ? 'verified'
        : snapshot.person.email.verificationStatus === 'invalid'
          ? 'invalid'
          : snapshot.person.email.verificationStatus === 'suppressed'
            ? 'suppressed'
            : 'candidate',
      provenance: snapshot.person.email.provenance,
      sourceUrl: snapshot.person.email.sourceUrl,
      lastVerifiedAt: snapshot.person.email.verificationStatus === 'verified' ? snapshot.person.email.observedAt : undefined,
      restriction: snapshot.person.email.verificationStatus === 'candidate'
        ? 'Verify the business email before outreach.'
        : undefined,
      requiresHumanReview: true,
    });
  }
  if (snapshot.person.phone) {
    routes.push({
      id: `${lead.id}:phone`,
      channel: 'phone',
      value: snapshot.person.phone.value,
      status: 'candidate',
      provenance: snapshot.person.phone.provenance,
      sourceUrl: snapshot.person.phone.sourceUrl,
      restriction: 'Use only when the number is explicitly business-facing and outreach is approved.',
      requiresHumanReview: true,
    });
  }
  if (lead.contactFormUrl) {
    const contactForm = normalizeUrl(lead.contactFormUrl);
    if (contactForm) routes.push({
      id: `${lead.id}:contact-form`,
      channel: 'contact_form',
      value: contactForm,
      status: 'available',
      provenance: 'source_visible',
      sourceUrl,
      requiresHumanReview: true,
    });
  }
  if (snapshot.person.relationshipOwner) {
    routes.push({
      id: `${lead.id}:referral`,
      channel: 'referral',
      value: snapshot.person.relationshipOwner.value,
      status: 'candidate',
      provenance: snapshot.person.relationshipOwner.provenance,
      sourceUrl: snapshot.person.relationshipOwner.sourceUrl,
      restriction: 'Confirm the relationship owner is willing and authorized to introduce Codistan.',
      requiresHumanReview: true,
    });
  }
  return dedupeRoutes(routes);
}

function buildTasks(lead: Lead, snapshot: EnrichmentSnapshot, createdAt: string): EnrichmentTask[] {
  const tasks: EnrichmentTask[] = [];
  const priority = researchPriority(lead);
  if (snapshot.suppression.suppressed) return tasks;
  if (!snapshot.company.name) tasks.push(task(lead, 'confirm_company_identity', 'Confirm company identity', 'The source record does not contain a reliable company identity.', priority, createdAt));
  if (!snapshot.company.domain) tasks.push(task(lead, 'find_company_domain', 'Find and verify company domain', 'A canonical company domain is required for account-level identity and enrichment.', priority, createdAt));
  if (!snapshot.person.name || !snapshot.person.role) tasks.push(task(lead, 'confirm_decision_maker', 'Confirm decision-maker identity and role', 'Person name or current decision-making role is incomplete.', priority, createdAt));
  if (!snapshot.person.email) tasks.push(task(lead, 'find_business_email', 'Find a permitted business email', 'No business email is currently supported by evidence.', priority, createdAt));
  else if (snapshot.person.email.verificationStatus === 'candidate') tasks.push(task(lead, 'verify_business_email', 'Verify candidate business email', 'The email is visible or discovered but is not verified.', priority, createdAt));
  if (snapshot.company.name && snapshot.person.name) tasks.push(task(lead, 'find_alternate_decision_maker', 'Research alternate relevant decision-makers', 'Identify another relevant person so outreach does not depend on one contact.', lowerPriority(priority), createdAt));
  if (!snapshot.person.mutualConnections && !snapshot.person.relationshipOwner && !snapshot.person.priorInteraction) {
    tasks.push(task(lead, 'verify_relationship_path', 'Check mutual, TeamLink or prior relationship path', 'No credible relationship or introduction path is currently recorded.', lowerPriority(priority), createdAt));
  }
  return tasks;
}

function buildTasksFromSnapshot(snapshot: EnrichmentSnapshot, fallback: EnrichmentTask[]): EnrichmentTask[] {
  if (snapshot.suppression.suppressed) return [];
  const openCodes = new Set(fallback.map((item) => item.code));
  return fallback.filter((item) => openCodes.has(item.code));
}

function task(
  lead: Lead,
  code: EnrichmentTask['code'],
  title: string,
  reason: string,
  priority: ResearchTaskPriority,
  createdAt: string,
): EnrichmentTask {
  return {
    id: `${lead.id}:${code}`,
    code,
    title,
    reason,
    priority,
    status: 'open',
    createdAt,
    requiredHumanReview: true,
  };
}

function contactabilityFor(snapshot: EnrichmentSnapshot): ContactabilityStatus {
  if (snapshot.suppression.suppressed) return 'suppressed';
  if (snapshot.contactRoutes.some((route) => route.status === 'verified' || route.status === 'available' || route.status === 'platform_restricted')) {
    return 'contactable_after_review';
  }
  if (snapshot.contactRoutes.some((route) => route.status === 'candidate')) return 'partial';
  return 'research_required';
}

function suppressionFrom(
  lead: Lead,
  raw: Record<string, unknown>,
  emailStatus: VerificationStatus | undefined,
): EnrichmentSnapshot['suppression'] {
  const explicitlySuppressed = emailStatus === 'suppressed'
    || truthy(rawValue(raw, ['doNotContact', 'do_not_contact', 'suppressed', 'contactSuppressed']))
    || lead.outcomeReason?.toLowerCase().includes('do not contact') === true;
  if (!explicitlySuppressed) return {suppressed: false};
  return {
    suppressed: true,
    reason: rawString(raw, ['suppressionReason', 'doNotContactReason']) ?? 'Do-not-contact or suppression evidence is present.',
    provenance: 'source_visible',
  };
}

function publicSignals(raw: Record<string, unknown>, sourceUrl: string | undefined, observedAt: string): PublicSignal[] {
  const definitions: Array<{code: string; label: string; keys: string[]}> = [
    {code: 'recent_activity', label: 'Recent public activity', keys: ['recentActivity', 'recent_activity', 'postedOnLinkedIn']},
    {code: 'recent_job_change', label: 'Recent role change', keys: ['recentJobChange', 'recent_job_change']},
    {code: 'funding', label: 'Funding signal', keys: ['funding', 'fundingSignal', 'funding_signal']},
    {code: 'hiring', label: 'Hiring signal', keys: ['hiring', 'hiringSignal', 'hiring_signal']},
    {code: 'product_launch', label: 'Product-launch signal', keys: ['productLaunch', 'product_launch']},
    {code: 'market_expansion', label: 'Market-expansion signal', keys: ['marketExpansion', 'market_expansion']},
    {code: 'leadership_change', label: 'Leadership-change signal', keys: ['leadershipChange', 'leadership_change']},
  ];
  const output: PublicSignal[] = [];
  for (const definition of definitions) {
    const value = rawValue(raw, definition.keys);
    if (value === undefined || value === null || value === false || value === '') continue;
    output.push({
      code: definition.code,
      label: definition.label,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      provenance: 'source_visible',
      confidence: 'medium',
      sourceUrl,
      observedAt,
      expiresAt: addDays(observedAt, 30),
    });
  }
  return output;
}

function relationshipEvidence(raw: Record<string, unknown>): {
  mutualConnections: string[];
  teamLink?: boolean;
  owner?: string;
  priorInteraction?: string;
} {
  const sales = asRecord(raw.salesNavigatorEvidence);
  const relationship = asRecord(raw.relationship);
  const mutualConnections = unique([
    ...arrayOfStrings(sales.mutual_connections),
    ...arrayOfStrings(sales.mutualConnections),
    ...arrayOfStrings(relationship.mutualConnections),
    ...arrayOfStrings(raw.mutualConnections),
  ]);
  return {
    mutualConnections,
    teamLink: optionalBoolean(sales.teamlink ?? sales.teamLink ?? relationship.teamLink ?? raw.teamLink),
    owner: firstString([
      relationship.owner,
      raw.relationshipOwner,
      raw.internalRelationshipOwner,
    ]),
    priorInteraction: firstString([
      relationship.priorInteraction,
      raw.priorCodistanInteraction,
      raw.priorInteraction,
    ]),
  };
}

function classifyCompany(lead: Lead): {value: CompanyClassification; confidence: EnrichmentConfidence; reason: string} {
  const text = `${lead.companyName ?? ''} ${lead.industry ?? ''} ${lead.title} ${lead.description}`.toLowerCase();
  if (/\b(?:agency|studio|digital marketing|creative agency|software house)\b/.test(text)) {
    return {value: 'agency', confidence: 'medium', reason: 'Agency/studio terminology is present in the source evidence.'};
  }
  if (/\b(?:consulting|consultancy|advisory)\b/.test(text)) {
    return {value: 'consultancy', confidence: 'medium', reason: 'Consulting/advisory terminology is present in the source evidence.'};
  }
  if (/\b(?:system integrator|systems integrator|implementation partner|managed service provider)\b/.test(text)) {
    return {value: 'system_integrator', confidence: 'medium', reason: 'Integration or implementation-partner terminology is present in the source evidence.'};
  }
  if (/\b(?:saas|platform|product company|software product|fintech|payments|wallet|banking)\b/.test(text)) {
    return {value: 'product_company', confidence: 'low', reason: 'Product/platform terminology is present; confirm the business model before using this classification.'};
  }
  if (lead.opportunityStatus === 'live_opportunity' || lead.prospectStage === 'warm_lead') {
    return {value: 'direct_buyer', confidence: 'low', reason: 'The record contains warm demand, but the account type still requires confirmation.'};
  }
  return {value: 'unknown', confidence: 'low', reason: 'Source evidence is insufficient to classify the company.'};
}

function geographyField(
  lead: Lead,
  raw: Record<string, unknown>,
  sourceUrl: string | undefined,
  observedAt: string,
): EnrichmentField<string[]> | undefined {
  const values = unique([
    lead.country ?? '',
    lead.region ?? '',
    ...arrayOfStrings(raw.geographies),
    ...arrayOfStrings(raw.targetGeographies),
  ]);
  return values.length > 0
    ? evidenceField(values, 'source_visible', 'medium', 'candidate', sourceUrl, observedAt, 90)
    : undefined;
}

function optionalField(value: string | undefined, sourceUrl: string | undefined, observedAt: string): EnrichmentField | undefined {
  return value ? evidenceField(value, 'source_visible', 'medium', 'candidate', sourceUrl, observedAt, 90) : undefined;
}

function evidenceField<T>(
  value: T,
  provenance: EnrichmentProvenance,
  confidence: EnrichmentConfidence,
  verificationStatus: VerificationStatus,
  sourceUrl: string | undefined,
  observedAt: string,
  ttlDays: number,
  provider?: string,
  notes?: string,
): EnrichmentField<T> {
  return {
    value,
    provenance,
    confidence,
    verificationStatus,
    sourceUrl,
    observedAt,
    expiresAt: ttlDays > 0 ? addDays(observedAt, ttlDays) : undefined,
    provider,
    notes,
  };
}

function emailStatusFromRaw(raw: Record<string, unknown>): VerificationStatus | undefined {
  const value = String(
    nestedString(raw, ['enrichment', 'emailStatus'])
      ?? nestedString(raw, ['contact', 'emailStatus'])
      ?? nestedString(raw, ['commercialEvidence', 'email_verification_status'])
      ?? rawString(raw, ['emailStatus', 'email_status'])
      ?? '',
  ).toLowerCase();
  if (['verified', 'valid'].includes(value)) return 'verified';
  if (['invalid', 'bounced'].includes(value)) return 'invalid';
  if (['suppressed', 'do_not_contact', 'do-not-contact'].includes(value)) return 'suppressed';
  if (['candidate', 'unverified', 'discovered'].includes(value)) return 'candidate';
  return undefined;
}

function mergeRoutes(previous: ContactRoute[], current: ContactRoute[], suppressed: boolean): ContactRoute[] {
  const map = new Map<string, ContactRoute>();
  for (const route of [...previous, ...current]) {
    const key = `${route.channel}:${route.value.toLowerCase()}`;
    const existing = map.get(key);
    map.set(key, existing ? strongerRoute(existing, route) : route);
  }
  return [...map.values()].map((route) => suppressed ? {...route, status: 'suppressed'} : route);
}

function strongerRoute(left: ContactRoute, right: ContactRoute): ContactRoute {
  const ranks: Record<ContactRoute['status'], number> = {
    verified: 100,
    platform_restricted: 80,
    available: 70,
    candidate: 40,
    invalid: 20,
    suppressed: 110,
  };
  return ranks[left.status] >= ranks[right.status] ? left : right;
}

function mergeSignals(previous: PublicSignal[], current: PublicSignal[]): PublicSignal[] {
  const map = new Map<string, PublicSignal>();
  for (const signal of [...previous, ...current]) {
    const key = `${signal.code}:${signal.value}`;
    const existing = map.get(key);
    if (!existing || Date.parse(signal.observedAt) >= Date.parse(existing.observedAt)) map.set(key, signal);
  }
  return [...map.values()];
}

function mergeTasks(previous: EnrichmentTask[], current: EnrichmentTask[]): EnrichmentTask[] {
  const currentById = new Map(current.map((taskItem) => [taskItem.id, taskItem]));
  const output: EnrichmentTask[] = [];
  for (const previousTask of previous) {
    const replacement = currentById.get(previousTask.id);
    if (previousTask.status === 'completed' || previousTask.status === 'dismissed' || previousTask.status === 'on_hold') {
      output.push(previousTask);
      currentById.delete(previousTask.id);
    } else if (replacement) {
      output.push({...replacement, createdAt: previousTask.createdAt});
      currentById.delete(previousTask.id);
    }
  }
  output.push(...currentById.values());
  return output;
}

function researchPriority(lead: Lead): ResearchTaskPriority {
  if (lead.score?.status === 'hot' || lead.score?.urgency === 'urgent') return 'critical';
  if (lead.score?.status === 'qualified' || lead.pipelineStatus === 'approved_to_contact') return 'high';
  if (lead.pipelineStatus === 'needs_human_review' || lead.pipelineStatus === 'needs_research') return 'normal';
  return 'low';
}

function lowerPriority(priority: ResearchTaskPriority): ResearchTaskPriority {
  if (priority === 'critical') return 'high';
  if (priority === 'high') return 'normal';
  return 'low';
}

function stableSnapshot(snapshot: EnrichmentSnapshot): unknown {
  return {
    version: snapshot.version,
    sourceLeadId: snapshot.sourceLeadId,
    company: stripFieldTimestamps(snapshot.company),
    person: stripFieldTimestamps(snapshot.person),
    contactRoutes: snapshot.contactRoutes.map(({lastVerifiedAt: _lastVerifiedAt, ...route}) => route),
    signals: snapshot.signals.map(({observedAt: _observedAt, expiresAt: _expiresAt, ...signal}) => signal),
    tasks: snapshot.tasks.map(({createdAt: _createdAt, ...taskItem}) => taskItem),
    contactability: snapshot.contactability,
    suppression: snapshot.suppression,
    providerMode: snapshot.providerMode,
    externalActionPerformed: snapshot.externalActionPerformed,
  };
}

function stripFieldTimestamps(value: object): object {
  return Object.fromEntries(Object.entries(value).map(([key, field]) => {
    if (!isEnrichmentField(field)) return [key, field];
    const {observedAt: _observedAt, expiresAt: _expiresAt, ...stable} = field;
    return [key, stable];
  }));
}

function isEnrichmentField(value: unknown): value is EnrichmentField<unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'provenance' in value && 'verificationStatus' in value && 'observedAt' in value);
}

function dedupeRoutes(routes: ContactRoute[]): ContactRoute[] {
  const map = new Map<string, ContactRoute>();
  for (const route of routes) map.set(`${route.channel}:${route.value.toLowerCase()}`, route);
  return [...map.values()];
}

function normalizeEmail(value: string | undefined): string | undefined {
  const email = String(value ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function normalizePhone(value: string | undefined): string | undefined {
  const phone = String(value ?? '').trim();
  return phone.replace(/[^0-9]/g, '').length >= 7 ? phone : undefined;
}

function normalizeDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!domain || domain.endsWith('linkedin.com') || domain.endsWith('upwork.com')) return undefined;
    return domain;
  } catch {
    return undefined;
  }
}

function normalizeUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function firstValidUrl(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.includes('.') && !value.includes('://') ? normalizeUrl(`https://${value}`) : normalizeUrl(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function firstLinkedInUrl(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (!normalized) continue;
    const host = new URL(normalized).hostname.toLowerCase();
    if (host === 'linkedin.com' || host === 'www.linkedin.com' || host === 'sales.linkedin.com') return normalized;
  }
  return undefined;
}

function addDays(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function nestedString(value: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) current = asRecord(current)[key];
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

function rawString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  return firstString(keys.map((key) => raw[key]));
}

function rawValue(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined) return raw[key];
  for (const container of ['rawEvidence', 'commercialEvidence', 'salesNavigatorEvidence', 'enrichment']) {
    const nested = asRecord(raw[container]);
    for (const key of keys) if (nested[key] !== undefined) return nested[key];
  }
  return undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function arrayOfStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(true|yes|1)$/i.test(value.trim())) return true;
    if (/^(false|no|0)$/i.test(value.trim())) return false;
  }
  return undefined;
}

function truthy(value: unknown): boolean {
  return value === true || (typeof value === 'string' && /^(true|yes|1|suppressed|do[_ -]?not[_ -]?contact)$/i.test(value.trim()));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
