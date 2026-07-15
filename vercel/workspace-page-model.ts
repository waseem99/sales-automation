import type { ProspectPageQuery, ProspectPageResult } from '@sales-automation/neon-state';
import type { Lead, PipelineStatus, ServiceCategory } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

export type WorkspacePageId =
  | 'all' | 'linkedin' | 'upwork' | 'rfq' | 'rfp' | 'eoi' | 'rfi' | 'tenders'
  | 'research' | 'partnerships' | 'services' | 'ai' | 'software' | 'cybersecurity'
  | 'immersive' | 'marketing';

export interface WorkspacePageDefinition {
  id: WorkspacePageId;
  route: string;
  navigationLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  listTitle: string;
  listDescription: string;
  emptyMessage: string;
  match: (lead: Lead) => boolean;
}

export interface WorkspacePageBuildResult {
  page: ProspectPageResult;
  repositoryRecords: StoredLeadRecord[];
  selected?: StoredLeadRecord;
}

const aiServices: ServiceCategory[] = ['ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'voice_ai_agent'];
const softwareServices: ServiceCategory[] = ['fullstack_web_app', 'nextjs_python_app', 'enterprise_systems'];

export const WORKSPACE_PAGES: WorkspacePageDefinition[] = [
  workspace('all', '/prospects', 'All prospects', 'Complete opportunity workspace', 'All Prospects', 'Review every visible opportunity, assign ownership, manage outreach and record outcomes.', 'All prospects', 'The complete lead and opportunity pipeline within your authorized scope.', 'No prospects are available in this scope.', () => true),
  workspace('linkedin', '/leads/linkedin', 'LinkedIn warm leads', 'Warm social demand signals', 'LinkedIn Warm Leads', 'Buyer-authored LinkedIn and Sales Navigator requests that passed the warm-signal quality gate.', 'LinkedIn and Sales Navigator leads', 'Prioritize fresh requests, verify the original post and prepare human-reviewed outreach.', 'No LinkedIn warm leads currently match this scope.', (lead) => lead.source === 'linkedin' || lead.source === 'sales_navigator' || lead.leadType === 'linkedin_warm_post' || lead.leadType === 'linkedin_sales_nav_alert'),
  workspace('upwork', '/leads/upwork', 'Upwork saved searches', 'Qualified marketplace alerts', 'Upwork Saved-Search Leads', 'Saved-search opportunities filtered by budget, freshness, client credibility and delivery fit.', 'Qualified Upwork opportunities', 'Open the original job, confirm live details and prepare proposals manually.', 'No qualified Upwork saved-search leads currently match this scope.', (lead) => lead.source === 'upwork' || lead.leadType === 'upwork_job'),
  workspace('rfq', '/leads/rfq', 'RFQs', 'Procurement opportunities', 'Request for Quotation Leads', 'Formal RFQs identified through procurement sources and classified by opportunity type.', 'RFQ opportunities', 'Review deadlines, eligibility, pricing requirements and submission routes.', 'No RFQ opportunities currently match this scope.', (lead) => lead.tender?.opportunityType === 'rfq'),
  workspace('rfp', '/leads/rfp', 'RFPs', 'Procurement opportunities', 'Request for Proposal Leads', 'Formal RFPs requiring technical, commercial and eligibility review before a bid decision.', 'RFP opportunities', 'Use the tender intelligence brief and keep submission human-controlled.', 'No RFP opportunities currently match this scope.', (lead) => lead.tender?.opportunityType === 'rfp'),
  workspace('eoi', '/leads/eoi', 'EOIs', 'Early procurement opportunities', 'Expression of Interest Leads', 'EOIs and early-stage procurement notices that may open a later proposal or consortium route.', 'EOI opportunities', 'Confirm eligibility, local-presence and consortium conditions before responding.', 'No EOI opportunities currently match this scope.', (lead) => lead.tender?.opportunityType === 'eoi'),
  workspace('rfi', '/leads/rfi', 'RFIs', 'Market and capability requests', 'Request for Information Leads', 'RFIs and market-sounding requests where capability positioning may influence later procurement.', 'RFI opportunities', 'Respond only after confirming the requested capability, evidence and submission route.', 'No RFI opportunities currently match this scope.', (lead) => lead.tender?.opportunityType === 'rfi'),
  workspace('tenders', '/leads/tenders', 'All tenders', 'Complete procurement pipeline', 'All RFP, RFQ and Tender Leads', 'Every structured procurement opportunity, including RFPs, RFQs, EOIs, RFIs and other tender types.', 'Tender and procurement opportunities', 'Review bid/no-bid guidance, deadlines, eligibility and document intelligence.', 'No tender opportunities currently match this scope.', (lead) => Boolean(lead.tender) || lead.source === 'public_procurement'),
  workspace('research', '/leads/research', 'Research queue', 'Missing evidence and verification', 'Lead Research Queue', 'Potentially relevant records that still need company, buyer, budget, source or contact verification.', 'Research-required leads', 'Resolve missing evidence before moving a record into the contact-ready pipeline.', 'No leads currently require research in this scope.', (lead) => lead.pipelineStatus === 'needs_research'),
  workspace('partnerships', '/leads/partnerships', 'Partnership leads', 'Agency and delivery partnerships', 'Partnership and White-Label Leads', 'Agency, referral, implementation and overflow-delivery opportunities suited to a partner-led approach.', 'Partnership opportunities', 'Position the relevant delivery capability without treating a relationship signal as confirmed buyer intent.', 'No partnership opportunities currently match this scope.', (lead) => lead.prospectStage === 'partner_prospect' || lead.opportunityStatus === 'partnership_target' || lead.leadType === 'partner_prospect' || lead.source === 'partner_research'),
  workspace('services', '/services', 'Services overview', 'Commercial service pipeline', 'Leads by Service Line', 'Review all opportunities currently mapped to a defined Codistan, Hilarious AI, Cytas or Motionly service.', 'Service-mapped opportunities', 'Use the service filter or the dedicated service pages to focus the pipeline.', 'No service-mapped leads currently match this scope.', (lead) => lead.serviceCategory !== 'unknown'),
  workspace('ai', '/services/ai', 'AI and automation', 'Hilarious AI and Codistan capabilities', 'AI, RAG and Automation Leads', 'AI agents, automation, RAG, document intelligence, voice AI and AI-enabled SaaS opportunities.', 'AI and automation pipeline', 'Match each opportunity with approved AI proof and the correct technical entry offer.', 'No AI or automation leads currently match this scope.', (lead) => aiServices.includes(lead.serviceCategory)),
  workspace('software', '/services/software', 'Software and SaaS', 'Custom product delivery', 'Software, SaaS and Enterprise Leads', 'Custom software, SaaS, web application, enterprise system and digital-transformation opportunities.', 'Software delivery pipeline', 'Prioritize funded, urgent and implementation-ready opportunities.', 'No software or SaaS leads currently match this scope.', (lead) => softwareServices.includes(lead.serviceCategory)),
  workspace('cybersecurity', '/services/cybersecurity', 'Cybersecurity', 'Cytas security capabilities', 'Cybersecurity and Compliance Leads', 'VAPT, cloud security, IAM, SOC 2, ISO 27001, HIPAA, CMMC and managed-security opportunities.', 'Security and compliance pipeline', 'Verify the regulatory driver, deadline, authority and required assurance evidence.', 'No cybersecurity or compliance leads currently match this scope.', (lead) => lead.serviceCategory === 'cybersecurity_compliance'),
  workspace('immersive', '/services/immersive', '3D, AR and VR', 'Motionly immersive capabilities', '3D, AR, VR and Real-Time Leads', 'Product animation, immersive training, AR, VR, Unity and Unreal opportunities.', 'Immersive and 3D pipeline', 'Confirm the target device, production quality, interactivity and delivery timeline.', 'No immersive, AR, VR or 3D leads currently match this scope.', (lead) => lead.serviceCategory === 'ar_3d_unity_unreal'),
  workspace('marketing', '/services/marketing', 'Web and marketing', 'Digital presence and growth', 'Website, SEO and Digital Marketing Leads', 'Website, portal, SEO, digital marketing, branding and growth-management opportunities.', 'Web and digital-growth pipeline', 'Separate strategic growth opportunities from low-value one-off production requests.', 'No website or digital-marketing leads currently match this scope.', (lead) => lead.serviceCategory === 'website_portal'),
];

export function resolveWorkspacePage(pathname: string): WorkspacePageDefinition | undefined {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return WORKSPACE_PAGES.find((page) => page.route === normalized);
}

export function buildWorkspacePage(records: StoredLeadRecord[], query: ProspectPageQuery, pageDefinition: WorkspacePageDefinition, selectedId?: string, now = new Date().toISOString()): WorkspacePageBuildResult {
  const normalized = normalizeWorkspacePageQuery(query);
  const workspaceRecords = records.filter((record) => pageDefinition.match(record.lead));
  const filtered = workspaceRecords.filter((record) => matchesFilters(record, normalized.filters, now));
  const ordered = [...filtered].sort((left, right) => compareRecords(left, right, normalized.filters.followUp));
  const totalPages = Math.max(1, Math.ceil(ordered.length / normalized.pageSize));
  const pageNumber = Math.min(normalized.page, totalPages);
  const offset = (pageNumber - 1) * normalized.pageSize;
  const pageRecords = ordered.slice(offset, offset + normalized.pageSize);
  const selected = selectedId ? workspaceRecords.find((record) => record.lead.id === selectedId) : pageRecords[0];
  const repositoryRecords = selected && !pageRecords.some((record) => record.lead.id === selected.lead.id) ? [...pageRecords, selected] : pageRecords;
  const start = ordered.length === 0 ? 0 : offset + 1;
  const end = ordered.length === 0 ? 0 : Math.min(offset + pageRecords.length, ordered.length);
  return { page: { records: pageRecords, page: pageNumber, pageSize: normalized.pageSize, totalPages, filteredTotal: ordered.length, visibleTotal: workspaceRecords.length, start, end, owners: [...new Set(workspaceRecords.map((record) => record.lead.owner?.trim()).filter((owner): owner is string => Boolean(owner)))].sort(), summary: buildSummary(workspaceRecords, now), query: normalized.filters }, repositoryRecords, selected };
}

function workspace(id: WorkspacePageId, route: string, navigationLabel: string, eyebrow: string, title: string, description: string, listTitle: string, listDescription: string, emptyMessage: string, match: (lead: Lead) => boolean): WorkspacePageDefinition {
  return { id, route, navigationLabel, eyebrow, title, description, listTitle, listDescription, emptyMessage, match };
}

function normalizeWorkspacePageQuery(query: ProspectPageQuery): { page: number; pageSize: ProspectPageResult['pageSize']; filters: ProspectPageResult['query'] } {
  const page = positiveInteger(query.page, 1);
  const requestedPageSize = positiveInteger(query.pageSize, 25);
  const pageSize = [25, 50, 100].includes(requestedPageSize) ? requestedPageSize as ProspectPageResult['pageSize'] : 25;
  return { page, pageSize, filters: { search: clean(query.search), status: clean(query.status), signal: clean(query.signal), service: clean(query.service), owner: clean(query.owner), feedback: clean(query.feedback), followUp: normalizeFollowUpFilter(query.followUp) } };
}

function matchesFilters(record: StoredLeadRecord, filters: ProspectPageResult['query'], now: string): boolean {
  const lead = record.lead;
  if (filters.search && !JSON.stringify(record).toLowerCase().includes(filters.search.toLowerCase())) return false;
  if (filters.status && lead.pipelineStatus !== filters.status) return false;
  if (filters.signal && lead.opportunityStatus !== filters.signal) return false;
  if (filters.service && lead.serviceCategory !== filters.service) return false;
  if (filters.owner) {
    if (filters.owner === 'unassigned' && lead.owner) return false;
    if (filters.owner !== 'unassigned' && lead.owner?.toLowerCase() !== filters.owner.toLowerCase()) return false;
  }
  if (filters.feedback && (lead.feedback?.status ?? 'pending') !== filters.feedback) return false;
  if (filters.followUp && !matchesFollowUp(lead, filters.followUp, now)) return false;
  return true;
}

function matchesFollowUp(lead: Lead, filter: string, now: string): boolean {
  const actionable = !['won', 'lost', 'rejected', 'archived'].includes(lead.pipelineStatus);
  if (!actionable) return false;
  const value = lead.nextFollowUpAt ? Date.parse(lead.nextFollowUpAt) : Number.NaN;
  const nowTime = Date.parse(now);
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const nextDay = dayStart.getTime() + 86_400_000;
  if (filter === 'not_scheduled') return !Number.isFinite(value);
  if (!Number.isFinite(value)) return false;
  if (filter === 'due') return value <= nowTime;
  if (filter === 'overdue') return value < dayStart.getTime();
  if (filter === 'today') return value >= dayStart.getTime() && value < nextDay;
  if (filter === 'next_7_days') return value > nowTime && value <= nowTime + 7 * 86_400_000;
  return true;
}

function compareRecords(left: StoredLeadRecord, right: StoredLeadRecord, followUpFilter: string): number {
  if (followUpFilter) {
    const leftFollowUp = left.lead.nextFollowUpAt ? Date.parse(left.lead.nextFollowUpAt) : Number.POSITIVE_INFINITY;
    const rightFollowUp = right.lead.nextFollowUpAt ? Date.parse(right.lead.nextFollowUpAt) : Number.POSITIVE_INFINITY;
    if (leftFollowUp !== rightFollowUp) return leftFollowUp - rightFollowUp;
  }
  const rankDifference = (left.lead.rank ?? 999_999) - (right.lead.rank ?? 999_999);
  return rankDifference !== 0 ? rankDifference : Date.parse(right.lead.updatedAt) - Date.parse(left.lead.updatedAt);
}

function buildSummary(records: StoredLeadRecord[], now: string): ProspectPageResult['summary'] {
  const statuses = (values: PipelineStatus[]) => records.filter((record) => values.includes(record.lead.pipelineStatus)).length;
  const nowTime = Date.parse(now);
  return { total: records.length, live: records.filter((record) => record.lead.opportunityStatus === 'live_opportunity').length, contacted: statuses(['sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']), replied: statuses(['replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']), followUpsDue: records.filter((record) => record.lead.nextFollowUpAt && Date.parse(record.lead.nextFollowUpAt) <= nowTime && !['won', 'lost', 'rejected', 'archived'].includes(record.lead.pipelineStatus)).length, unassigned: records.filter((record) => !record.lead.owner).length, won: statuses(['won']), feedbackPending: records.filter((record) => record.lead.feedback?.status !== 'complete').length };
}

function normalizeFollowUpFilter(value: unknown): string { const normalized = clean(value); return ['due', 'overdue', 'today', 'next_7_days', 'scheduled', 'not_scheduled'].includes(normalized) ? normalized : ''; }
function clean(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function positiveInteger(value: unknown, fallback: number): number { const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
