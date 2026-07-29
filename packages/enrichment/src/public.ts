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
export type CompanyClassification = 'agency' | 'consultancy' | 'system_integrator' | 'product_company' | 'direct_buyer' | 'unknown';

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
  code: 'confirm_company_identity' | 'find_company_domain' | 'confirm_decision_maker' | 'find_business_email' | 'verify_business_email' | 'find_alternate_decision_maker' | 'verify_relationship_path' | 'review_conflicting_evidence';
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
  suppression: { suppressed: boolean; reason?: string; provenance?: EnrichmentProvenance };
  providerMode: { mode: 'source_visible_only'; activeProviders: string[]; credentialsExposed: false };
  externalActionPerformed: false;
}

export interface EnrichmentProviderInput { lead: Lead; current?: EnrichmentSnapshot }
export interface EnrichmentProviderResult { provider: string; fields: Partial<EnrichmentSnapshot>; observedAt: string; sourceUrls: string[] }
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
  const raw = record(lead.rawPayload);
  const sourceUrl = cleanUrl(lead.evidenceUrl ?? lead.sourceUrl);
  const website = firstWebsite([
    lead.companyWebsite,
    nested(raw, 'enrichment', 'companyWebsite'),
    nested(raw, 'enrichment', 'companyDomain'),
    nested(raw, 'company', 'website'),
    nested(raw, 'company', 'domain'),
  ]);
  const domain = website ? cleanDomain(website) : undefined;
  const linkedin = firstLinkedIn([lead.linkedinUrl]);
  const email = cleanEmail(lead.contactEmail);
  const emailStatus = readEmailStatus(raw);
  const suppression = readSuppression(lead, raw, emailStatus);
  const relationship = readRelationship(raw);
  const classification = classifyCompany(lead);

  const current: EnrichmentSnapshot = {
    version: ENRICHMENT_VERSION,
    generatedAt,
    sourceLeadId: lead.id,
    company: removeUndefined<CompanyEnrichment>({
      name: lead.companyName ? field(lead.companyName, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 90) : undefined,
      website: website ? field(website, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90) : undefined,
      domain: domain ? field(domain, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90) : undefined,
      linkedinUrl: firstLinkedIn([nested(raw, 'company', 'linkedinUrl'), nested(raw, 'enrichment', 'companyLinkedInUrl')])
        ? field(firstLinkedIn([nested(raw, 'company', 'linkedinUrl'), nested(raw, 'enrichment', 'companyLinkedInUrl')])!, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90)
        : undefined,
      industry: lead.industry ? field(lead.industry, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 90) : undefined,
      employeeSize: textValue(raw, ['employeeSize', 'companySize', 'employee_size'])
        ? field(textValue(raw, ['employeeSize', 'companySize', 'employee_size'])!, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 90)
        : undefined,
      headquarters: textValue(raw, ['headquarters', 'companyHeadquarters'])
        ? field(textValue(raw, ['headquarters', 'companyHeadquarters'])!, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 90)
        : undefined,
      geographies: geographyField(lead, raw, sourceUrl, generatedAt),
      classification: field(classification.value, 'system_inference', classification.confidence, 'candidate', sourceUrl, generatedAt, 30, classification.reason),
    }),
    person: removeUndefined<PersonEnrichment>({
      name: lead.contactName ? field(lead.contactName, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90) : undefined,
      role: lead.contactRole ? field(lead.contactRole, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 60) : undefined,
      linkedinUrl: linkedin ? field(linkedin, 'source_visible', 'high', 'candidate', sourceUrl, generatedAt, 90) : undefined,
      email: email ? emailField(email, emailStatus, sourceUrl, generatedAt) : undefined,
      phone: cleanPhone(lead.contactPhone) ? field(cleanPhone(lead.contactPhone)!, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 60) : undefined,
      mutualConnections: relationship.mutuals.length ? field(relationship.mutuals, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 30) : undefined,
      teamLink: relationship.teamLink === undefined ? undefined : field(relationship.teamLink, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 30),
      relationshipOwner: relationship.owner ? field(relationship.owner, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 30) : undefined,
      priorInteraction: relationship.prior ? field(relationship.prior, 'source_visible', 'medium', 'candidate', sourceUrl, generatedAt, 60) : undefined,
    }),
    contactRoutes: [],
    signals: readSignals(raw, sourceUrl, generatedAt),
    tasks: [],
    contactability: 'research_required',
    suppression,
    providerMode: { mode: 'source_visible_only', activeProviders: [], credentialsExposed: false },
    externalActionPerformed: false,
  };

  current.contactRoutes = buildRoutes(lead, current, sourceUrl);
  current.contactability = contactability(current);
  current.tasks = buildTasks(lead, current, generatedAt);

  const merged = previous ? mergeSnapshots(previous, current) : current;
  if (!merged.suppression.suppressed) return merged;
  return {
    ...merged,
    contactRoutes: merged.contactRoutes.map((route) => ({
      ...route,
      status: 'suppressed',
      restriction: merged.suppression.reason ?? route.restriction ?? 'Do-not-contact evidence is present.',
    })),
    tasks: [],
    contactability: 'suppressed',
  };
}

export function attachEnrichmentSnapshot(lead: Lead, snapshot: EnrichmentSnapshot): Lead {
  return { ...lead, rawPayload: { ...record(lead.rawPayload), enrichment: snapshot, enrichmentVersion: ENRICHMENT_VERSION } };
}

export function readEnrichmentSnapshot(lead: Lead): EnrichmentSnapshot | undefined {
  const value = record(lead.rawPayload).enrichment;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const snapshot = value as Partial<EnrichmentSnapshot>;
  return snapshot.version === ENRICHMENT_VERSION && snapshot.sourceLeadId === lead.id ? snapshot as EnrichmentSnapshot : undefined;
}

export function enrichmentStateEqual(left: EnrichmentSnapshot | undefined, right: EnrichmentSnapshot): boolean {
  return Boolean(left) && JSON.stringify(stable(left!)) === JSON.stringify(stable(right));
}

function mergeSnapshots(previous: EnrichmentSnapshot, current: EnrichmentSnapshot): EnrichmentSnapshot {
  const merged: EnrichmentSnapshot = {
    ...current,
    company: mergeCompany(previous.company, current.company),
    person: mergePerson(previous.person, current.person),
    contactRoutes: mergeRoutes(previous.contactRoutes, current.contactRoutes),
    signals: mergeSignals(previous.signals, current.signals),
    suppression: previous.suppression.suppressed ? previous.suppression : current.suppression,
    providerMode: { mode: 'source_visible_only', activeProviders: unique([...previous.providerMode.activeProviders, ...current.providerMode.activeProviders]), credentialsExposed: false },
  };
  merged.contactability = contactability(merged);
  merged.tasks = mergeTasks(previous.tasks, current.tasks);
  return merged;
}

function mergeCompany(previous: CompanyEnrichment, current: CompanyEnrichment): CompanyEnrichment {
  return {
    name: pick(previous.name, current.name),
    website: pick(previous.website, current.website),
    domain: pick(previous.domain, current.domain),
    linkedinUrl: pick(previous.linkedinUrl, current.linkedinUrl),
    industry: pick(previous.industry, current.industry),
    employeeSize: pick(previous.employeeSize, current.employeeSize),
    headquarters: pick(previous.headquarters, current.headquarters),
    geographies: pick(previous.geographies, current.geographies),
    classification: pick(previous.classification, current.classification),
  };
}

function mergePerson(previous: PersonEnrichment, current: PersonEnrichment): PersonEnrichment {
  return {
    name: pick(previous.name, current.name),
    role: pick(previous.role, current.role),
    linkedinUrl: pick(previous.linkedinUrl, current.linkedinUrl),
    email: pick(previous.email, current.email),
    phone: pick(previous.phone, current.phone),
    mutualConnections: pick(previous.mutualConnections, current.mutualConnections),
    teamLink: pick(previous.teamLink, current.teamLink),
    relationshipOwner: pick(previous.relationshipOwner, current.relationshipOwner),
    priorInteraction: pick(previous.priorInteraction, current.priorInteraction),
  };
}

function pick<T>(a: EnrichmentField<T> | undefined, b: EnrichmentField<T> | undefined): EnrichmentField<T> | undefined {
  if (!a) return b;
  if (!b) return a;
  const score = (x: EnrichmentField<T>) => provenanceRank[x.provenance] + verificationRank[x.verificationStatus] + confidenceRank[x.confidence];
  if (score(a) !== score(b)) return score(a) > score(b) ? a : b;
  return Date.parse(a.observedAt) > Date.parse(b.observedAt) ? a : b;
}

const provenanceRank: Record<EnrichmentProvenance, number> = { human_confirmed: 100, verified: 90, source_visible: 70, public_web: 65, provider_discovered: 55, system_inference: 25 };
const verificationRank: Record<VerificationStatus, number> = { verified: 30, suppressed: 25, invalid: 20, candidate: 10, not_applicable: 0 };
const confidenceRank: Record<EnrichmentConfidence, number> = { high: 15, medium: 8, low: 2 };

function field<T>(value: T, provenance: EnrichmentProvenance, confidence: EnrichmentConfidence, verificationStatus: VerificationStatus, sourceUrl: string | undefined, observedAt: string, ttlDays: number, notes?: string): EnrichmentField<T> {
  return { value, provenance, confidence, verificationStatus, sourceUrl, observedAt, expiresAt: addDays(observedAt, ttlDays), notes };
}

function emailField(value: string, status: VerificationStatus | undefined, sourceUrl: string | undefined, observedAt: string): EnrichmentField {
  const actual = status ?? 'candidate';
  return field(value, actual === 'verified' ? 'verified' : 'source_visible', actual === 'verified' || actual === 'invalid' || actual === 'suppressed' ? 'high' : 'medium', actual, sourceUrl, observedAt, actual === 'verified' ? 60 : 30);
}

function buildRoutes(lead: Lead, snapshot: EnrichmentSnapshot, sourceUrl?: string): ContactRoute[] {
  const routes: ContactRoute[] = [];
  if (lead.source === 'upwork' && lead.sourceUrl) routes.push({ id: `${lead.id}:upwork`, channel: 'upwork', value: lead.sourceUrl, status: 'platform_restricted', provenance: 'source_visible', sourceUrl, restriction: 'Use Upwork for the active job. Do not infer or use an off-platform route without separate permitted public evidence.', requiresHumanReview: true });
  if (snapshot.person.linkedinUrl) routes.push({ id: `${lead.id}:linkedin`, channel: lead.source === 'sales_navigator' ? 'sales_navigator' : 'linkedin', value: snapshot.person.linkedinUrl.value, status: 'available', provenance: snapshot.person.linkedinUrl.provenance, sourceUrl: snapshot.person.linkedinUrl.sourceUrl, requiresHumanReview: true });
  if (snapshot.person.email) routes.push({ id: `${lead.id}:email`, channel: 'email', value: snapshot.person.email.value, status: snapshot.person.email.verificationStatus === 'verified' ? 'verified' : snapshot.person.email.verificationStatus === 'invalid' ? 'invalid' : snapshot.person.email.verificationStatus === 'suppressed' ? 'suppressed' : 'candidate', provenance: snapshot.person.email.provenance, sourceUrl: snapshot.person.email.sourceUrl, lastVerifiedAt: snapshot.person.email.verificationStatus === 'verified' ? snapshot.person.email.observedAt : undefined, restriction: snapshot.person.email.verificationStatus === 'candidate' ? 'Verify the business email before outreach.' : undefined, requiresHumanReview: true });
  if (snapshot.person.phone) routes.push({ id: `${lead.id}:phone`, channel: 'phone', value: snapshot.person.phone.value, status: 'candidate', provenance: snapshot.person.phone.provenance, sourceUrl: snapshot.person.phone.sourceUrl, restriction: 'Use only when explicitly business-facing and approved.', requiresHumanReview: true });
  if (lead.contactFormUrl && cleanUrl(lead.contactFormUrl)) routes.push({ id: `${lead.id}:contact-form`, channel: 'contact_form', value: cleanUrl(lead.contactFormUrl)!, status: 'available', provenance: 'source_visible', sourceUrl, requiresHumanReview: true });
  if (snapshot.person.relationshipOwner) routes.push({ id: `${lead.id}:referral`, channel: 'referral', value: snapshot.person.relationshipOwner.value, status: 'candidate', provenance: snapshot.person.relationshipOwner.provenance, sourceUrl: snapshot.person.relationshipOwner.sourceUrl, restriction: 'Confirm the relationship owner is willing and authorized to introduce Codistan.', requiresHumanReview: true });
  return mergeRoutes([], routes);
}

function buildTasks(lead: Lead, snapshot: EnrichmentSnapshot, createdAt: string): EnrichmentTask[] {
  if (snapshot.suppression.suppressed) return [];
  const priority = taskPriority(lead);
  const tasks: EnrichmentTask[] = [];
  const add = (code: EnrichmentTask['code'], title: string, reason: string, p = priority) => tasks.push({ id: `${lead.id}:${code}`, code, title, reason, priority: p, status: 'open', createdAt, requiredHumanReview: true });
  if (!snapshot.company.name) add('confirm_company_identity', 'Confirm company identity', 'The source record does not contain a reliable company identity.');
  if (!snapshot.company.domain) add('find_company_domain', 'Find and verify company domain', 'A canonical company domain is required for account-level identity and enrichment.');
  if (!snapshot.person.name || !snapshot.person.role) add('confirm_decision_maker', 'Confirm decision-maker identity and role', 'Person name or role is incomplete.');
  if (!snapshot.person.email) add('find_business_email', 'Find a permitted business email', 'No business email is supported by evidence.');
  else if (snapshot.person.email.verificationStatus === 'candidate') add('verify_business_email', 'Verify candidate business email', 'The email is not verified.');
  if (snapshot.company.name && snapshot.person.name) add('find_alternate_decision_maker', 'Research alternate relevant decision-makers', 'Avoid dependence on one contact.', lower(priority));
  if (!snapshot.person.mutualConnections && !snapshot.person.relationshipOwner && !snapshot.person.priorInteraction) add('verify_relationship_path', 'Check mutual, TeamLink or prior relationship path', 'No credible introduction path is recorded.', lower(priority));
  return tasks;
}

function contactability(snapshot: EnrichmentSnapshot): ContactabilityStatus {
  if (snapshot.suppression.suppressed) return 'suppressed';
  if (snapshot.contactRoutes.some((r) => ['verified', 'available', 'platform_restricted'].includes(r.status))) return 'contactable_after_review';
  return snapshot.contactRoutes.some((r) => r.status === 'candidate') ? 'partial' : 'research_required';
}

function mergeRoutes(previous: ContactRoute[], current: ContactRoute[]): ContactRoute[] {
  const rank: Record<ContactRoute['status'], number> = { suppressed: 110, verified: 100, platform_restricted: 80, available: 70, candidate: 40, invalid: 20 };
  const map = new Map<string, ContactRoute>();
  for (const route of [...previous, ...current]) {
    const key = `${route.channel}:${route.value.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing || rank[route.status] > rank[existing.status]) map.set(key, route);
  }
  return [...map.values()];
}

function mergeSignals(previous: PublicSignal[], current: PublicSignal[]): PublicSignal[] {
  const map = new Map<string, PublicSignal>();
  for (const signal of [...previous, ...current]) map.set(`${signal.code}:${signal.value}`, signal);
  return [...map.values()];
}

function mergeTasks(previous: EnrichmentTask[], current: EnrichmentTask[]): EnrichmentTask[] {
  const map = new Map(current.map((task) => [task.id, task]));
  for (const task of previous) if (task.status !== 'open') map.set(task.id, task);
  return [...map.values()];
}

function taskPriority(lead: Lead): ResearchTaskPriority { return lead.score?.status === 'hot' || lead.score?.urgency === 'urgent' ? 'critical' : lead.score?.status === 'qualified' || lead.pipelineStatus === 'approved_to_contact' ? 'high' : lead.pipelineStatus === 'needs_human_review' || lead.pipelineStatus === 'needs_research' ? 'normal' : 'low'; }
function lower(p: ResearchTaskPriority): ResearchTaskPriority { return p === 'critical' ? 'high' : p === 'high' ? 'normal' : 'low'; }

function readSignals(raw: Record<string, unknown>, sourceUrl: string | undefined, observedAt: string): PublicSignal[] {
  const defs: Array<[string, string, string[]]> = [
    ['recent_activity', 'Recent public activity', ['recentActivity', 'recent_activity', 'postedOnLinkedIn']],
    ['recent_job_change', 'Recent role change', ['recentJobChange', 'recent_job_change']],
    ['funding', 'Funding signal', ['funding', 'fundingSignal', 'funding_signal']],
    ['hiring', 'Hiring signal', ['hiring', 'hiringSignal', 'hiring_signal']],
    ['product_launch', 'Product-launch signal', ['productLaunch', 'product_launch']],
    ['market_expansion', 'Market-expansion signal', ['marketExpansion', 'market_expansion']],
    ['leadership_change', 'Leadership-change signal', ['leadershipChange', 'leadership_change']],
  ];
  return defs.flatMap(([code, label, keys]) => {
    const value = findRaw(raw, keys);
    return value === undefined || value === null || value === false || value === '' ? [] : [{ code, label, value: typeof value === 'string' ? value : JSON.stringify(value), provenance: 'source_visible' as const, confidence: 'medium' as const, sourceUrl, observedAt, expiresAt: addDays(observedAt, 30) }];
  });
}

function readRelationship(raw: Record<string, unknown>): { mutuals: string[]; teamLink?: boolean; owner?: string; prior?: string } {
  const sales = record(raw.salesNavigatorEvidence);
  const rel = record(raw.relationship);
  return {
    mutuals: unique([...strings(sales.mutual_connections), ...strings(sales.mutualConnections), ...strings(rel.mutualConnections), ...strings(raw.mutualConnections)]),
    teamLink: bool(sales.teamlink ?? sales.teamLink ?? rel.teamLink ?? raw.teamLink),
    owner: firstText([rel.owner, raw.relationshipOwner, raw.internalRelationshipOwner]),
    prior: firstText([rel.priorInteraction, raw.priorCodistanInteraction, raw.priorInteraction]),
  };
}

function readEmailStatus(raw: Record<string, unknown>): VerificationStatus | undefined {
  const value = String(nested(raw, 'enrichment', 'emailStatus') ?? nested(raw, 'contact', 'emailStatus') ?? textValue(raw, ['emailStatus', 'email_status']) ?? '').toLowerCase();
  if (['verified', 'valid'].includes(value)) return 'verified';
  if (['invalid', 'bounced'].includes(value)) return 'invalid';
  if (['suppressed', 'do_not_contact', 'do-not-contact'].includes(value)) return 'suppressed';
  if (['candidate', 'unverified', 'discovered'].includes(value)) return 'candidate';
  return undefined;
}

function readSuppression(lead: Lead, raw: Record<string, unknown>, status?: VerificationStatus): EnrichmentSnapshot['suppression'] {
  const suppressed = status === 'suppressed' || truthy(findRaw(raw, ['doNotContact', 'do_not_contact', 'suppressed', 'contactSuppressed'])) || Boolean(lead.outcomeReason?.toLowerCase().includes('do not contact'));
  return suppressed ? { suppressed: true, reason: textValue(raw, ['suppressionReason', 'doNotContactReason']) ?? 'Do-not-contact or suppression evidence is present.', provenance: 'source_visible' } : { suppressed: false };
}

function classifyCompany(lead: Lead): { value: CompanyClassification; confidence: EnrichmentConfidence; reason: string } {
  const text = `${lead.companyName ?? ''} ${lead.industry ?? ''} ${lead.title} ${lead.description}`.toLowerCase();
  if (/\b(?:agency|studio|digital marketing|creative agency|software house)\b/.test(text)) return { value: 'agency', confidence: 'medium', reason: 'Agency/studio terminology is present.' };
  if (/\b(?:consulting|consultancy|advisory)\b/.test(text)) return { value: 'consultancy', confidence: 'medium', reason: 'Consulting terminology is present.' };
  if (/\b(?:system integrator|systems integrator|implementation partner|managed service provider)\b/.test(text)) return { value: 'system_integrator', confidence: 'medium', reason: 'Integration-partner terminology is present.' };
  if (/\b(?:saas|platform|product company|software product|fintech|payments|wallet|banking)\b/.test(text)) return { value: 'product_company', confidence: 'low', reason: 'Product/platform terminology is present; confirm manually.' };
  if (lead.opportunityStatus === 'live_opportunity' || lead.prospectStage === 'warm_lead') return { value: 'direct_buyer', confidence: 'low', reason: 'Warm demand exists, but account type still needs confirmation.' };
  return { value: 'unknown', confidence: 'low', reason: 'Insufficient source evidence.' };
}

function geographyField(lead: Lead, raw: Record<string, unknown>, sourceUrl: string | undefined, observedAt: string): EnrichmentField<string[]> | undefined {
  const values = unique([lead.country ?? '', lead.region ?? '', ...strings(raw.geographies), ...strings(raw.targetGeographies)]);
  return values.length ? field(values, 'source_visible', 'medium', 'candidate', sourceUrl, observedAt, 90) : undefined;
}

function stable(snapshot: EnrichmentSnapshot): unknown {
  const strip = (group: CompanyEnrichment | PersonEnrichment) => Object.fromEntries(Object.entries(group).map(([k, v]) => {
    if (!isField(v)) return [k, v];
    const { observedAt: _o, expiresAt: _e, ...rest } = v;
    return [k, rest];
  }));
  return {
    version: snapshot.version,
    sourceLeadId: snapshot.sourceLeadId,
    company: strip(snapshot.company),
    person: strip(snapshot.person),
    contactRoutes: snapshot.contactRoutes.map(({ lastVerifiedAt: _l, ...r }) => r),
    signals: snapshot.signals.map(({ observedAt: _o, expiresAt: _e, ...s }) => s),
    tasks: snapshot.tasks.map(({ createdAt: _c, ...t }) => t),
    contactability: snapshot.contactability,
    suppression: snapshot.suppression,
    providerMode: snapshot.providerMode,
    externalActionPerformed: snapshot.externalActionPerformed,
  };
}

function isField(value: unknown): value is EnrichmentField<unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'provenance' in value && 'verificationStatus' in value && 'observedAt' in value); }
function removeUndefined<T extends object>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function nested(raw: Record<string, unknown>, container: string, key: string): string | undefined { const value = record(raw[container])[key]; return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function textValue(raw: Record<string, unknown>, keys: string[]): string | undefined { return firstText(keys.map((k) => findRaw(raw, [k]))); }
function firstText(values: unknown[]): string | undefined { return values.find((v) => typeof v === 'string' && v.trim())?.toString().trim(); }
function findRaw(raw: Record<string, unknown>, keys: string[]): unknown { for (const key of keys) if (raw[key] !== undefined) return raw[key]; for (const c of ['rawEvidence', 'commercialEvidence', 'salesNavigatorEvidence', 'enrichment']) { const n = record(raw[c]); for (const key of keys) if (n[key] !== undefined) return n[key]; } return undefined; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(String).map((x) => x.trim()).filter(Boolean) : typeof value === 'string' ? value.split(/[,;|]/).map((x) => x.trim()).filter(Boolean) : []; }
function unique(values: string[]): string[] { return [...new Set(values.map((x) => x.trim()).filter(Boolean))]; }
function bool(value: unknown): boolean | undefined { if (typeof value === 'boolean') return value; if (typeof value === 'string' && /^(true|yes|1)$/i.test(value.trim())) return true; if (typeof value === 'string' && /^(false|no|0)$/i.test(value.trim())) return false; return undefined; }
function truthy(value: unknown): boolean { return value === true || (typeof value === 'string' && /^(true|yes|1|suppressed|do[_ -]?not[_ -]?contact)$/i.test(value.trim())); }
function cleanEmail(value?: string): string | undefined { const email = String(value ?? '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined; }
function cleanPhone(value?: string): string | undefined { const phone = String(value ?? '').trim(); return phone.replace(/[^0-9]/g, '').length >= 7 ? phone : undefined; }
function cleanUrl(value?: string): string | undefined { if (!value?.trim()) return undefined; try { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol)) return undefined; u.hash = ''; return u.toString(); } catch { return undefined; } }
function firstWebsite(values: Array<string | undefined>): string | undefined { for (const value of values) { const url = cleanUrl(value?.includes('.') && !value.includes('://') ? `https://${value}` : value); if (url) return url; } return undefined; }
function firstLinkedIn(values: Array<string | undefined>): string | undefined { return values.map(cleanUrl).find((value) => value && ['linkedin.com', 'www.linkedin.com', 'sales.linkedin.com'].includes(new URL(value).hostname.toLowerCase())); }
function cleanDomain(value: string): string | undefined { try { const host = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''); return !host || host.endsWith('linkedin.com') || host.endsWith('upwork.com') ? undefined : host; } catch { return undefined; } }
function addDays(value: string, days: number): string { const date = new Date(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString(); }
