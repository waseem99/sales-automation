import type {
  ProspectPageQuery,
  ProspectPageResult,
} from '@sales-automation/neon-state';
import type { Lead, PipelineStatus, ServiceCategory } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

export type WorkspacePageId =
  | 'all'
  | 'linkedin'
  | 'upwork'
  | 'rfq'
  | 'rfp'
  | 'eoi'
  | 'rfi'
  | 'tenders'
  | 'research'
  | 'partnerships'
  | 'services'
  | 'ai'
  | 'software'
  | 'cybersecurity'
  | 'immersive'
  | 'marketing';

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

const aiServices: ServiceCategory[] = [
  'ai_automation',
  'rag_document_intelligence',
  'ai_saas_mvp',
  'voice_ai_agent',
];
const softwareServices: ServiceCategory[] = [
  'fullstack_web_app',
  'nextjs_python_app',
  'enterprise_systems',
];

export const WORKSPACE_PAGES: WorkspacePageDefinition[] = [
  workspace('all', '/prospects', 'All prospects', 'Complete opportunity workspace', 'All Prospects',
    'Review every visible opportunity, assign ownership, manage outreach and record outcomes.',
    'All prospects', 'The complete lead and opportunity pipeline within your authorized scope.',
    'No prospects are available in this scope.', () => true),
  workspace('linkedin', '/leads/linkedin', 'LinkedIn warm leads', 'Warm social demand signals', 'LinkedIn Warm Leads',
    'Buyer-authored LinkedIn and Sales Navigator requests that passed the warm-signal quality gate.',
    'LinkedIn and Sales Navigator leads', 'Prioritize fresh requests, verify the original post and prepare human-reviewed outreach.',
    'No LinkedIn warm leads currently match this scope.',
    (lead) => lead.source === 'linkedin' || lead.source === 'sales_navigator'
      || lead.leadType === 'linkedin_warm_post' || lead.leadType === 'linkedin_sales_nav_alert'),
  workspace('upwork', '/leads/upwork', 'Upwork saved searches', 'Qualified marketplace alerts', 'Upwork Saved-Search Leads',
    'Saved-search opportunities filtered by budget, freshness, client credibility and delivery fit.',
    'Qualified Upwork opportunities', 'Open the original job, confirm live details and prepare proposals manually.',
    'No qualified Upwork saved-search leads currently match this scope.',
    (lead) => lead.source === 'upwork' || lead.leadType === 'upwork_job'),
  workspace('rfq', '/leads/rfq', 'RFQs', 'Procurement opportunities', 'Request for Quotation Leads',
    'Formal RFQs identified through procurement sources and classified by opportunity type.',
    'RFQ opportunities', 'Review deadlines, eligibility, pricing requirements and submission routes.',
    'No RFQ opportunities currently match this scope.', (lead) => lead.tender?.opportunityType === 'rfq'),
  workspace('rfp', '/leads/rfp', 'RFPs', 'Procurement opportunities', 'Request for Proposal Leads',
    'Formal RFPs requiring technical, commercial and eligibility review before a bid decision.',
    'RFP opportunities', 'Use the tender intelligence brief and keep submission human-controlled.',
    'No RFP opportunities currently match this scope.', (lead) => lead.tender?.opportunityType === 'rfp'),
  workspace('eoi', '/leads/eoi', 'EOIs', 'Early procurement opportunities', 'Expression of Interest Leads',
    'EOIs and early-stage procurement notices that may open a later proposal or consortium route.',
    'EOI opportunities', 'Confirm eligibility, local-presence and consortium conditions before responding.',
    'No EOI opportunities currently match this scope.', (lead) => lead.tender?.opportunityType === 'eoi'),
  workspace('rfi', '/leads/rfi', 'RFIs', 'Market and capability requests', 'Request for Information Leads',
    'RFIs and market-sounding requests where capability positioning may influence later procurement.',
    'RFI opportunities', 'Respond only after confirming the requested capability, evidence and submission route.',
    'No RFI opportunities currently match this scope.', (lead) => lead.tender?.opportunityType === 'rfi'),
  workspace('tenders', '/leads/tenders', 'All tenders', 'Complete procurement pipeline', 'All RFP, RFQ and Tender Leads',
    'Every structured procurement opportunity, including RFPs, RFQs, EOIs, RFIs and other tender types.',
    'Tender and procurement opportunities', 'Review bid/no-bid guidance, deadlines, eligibility and document intelligence.',
    'No tender opportunities currently match this scope.',
    (lead) => Boolean(lead.tender) || lead.source === 'public_procurement'),
  workspace('research', '/leads/research', 'Research queue', 'Missing evidence and verification', 'Lead Research Queue',
    'Potentially relevant records that still need company, buyer, budget, source or contact verification.',
    'Research-required leads', 'Resolve missing evidence before moving a record into the contact-ready pipeline.',
    'No leads currently require research in this scope.', (lead) => lead.pipelineStatus === 'needs_research'),
  workspace('partnerships', '/leads/partnerships', 'Partnership leads', 'Agency and delivery partnerships', 'Partnership and White-Label Leads',
    'Agency, referral, implementation and overflow-delivery opportunities suited to a partner-led approach.',
    'Partnership opportunities', 'Position the relevant delivery capability without treating a relationship signal as confirmed buyer intent.',
    'No partnership opportunities currently match this scope.',
    (lead) => lead.prospectStage === 'partner_prospect' || lead.opportunityStatus === 'partnership_target'
      || lead.leadType === 'partner_prospect' || lead.source === 'partner_research'),
  workspace('services', '/services', 'Services overview', 'Commercial service pipeline', 'Leads by Service Line',
    'Review all opportunities currently mapped to a defined Codistan, Hilarious AI, Cytas or Motionly service.',
    'Service-mapped opportunities', 'Use the service filter or the dedicated service pages to focus the pipeline.',
    'No service-mapped leads currently match this scope.', (lead) => lead.serviceCategory !== 'unknown'),
  workspace('ai', '/services/ai', 'AI and automation', 'Hilarious AI and Codistan capabilities', 'AI, RAG and Automation Leads',
    'AI agents, automation, RAG, document intelligence, voice AI and AI-enabled SaaS opportunities.',
    'AI and automation pipeline', 'Match each opportunity with approved AI proof and the correct technical entry offer.',
    'No AI or automation leads currently match this scope.', (lead) => aiServices.includes(lead.serviceCategory)),
  workspace('software', '/services/software', 'Software and SaaS', 'Custom product delivery', 'Software, SaaS and Enterprise Leads',
    'Custom software, SaaS, web application, enterprise system and digital-transformation opportunities.',
    'Software delivery pipeline', 'Prioritize funded, urgent and implementation-ready opportunities.',
    'No software or SaaS leads currently match this scope.', (lead) => softwareServices.includes(lead.serviceCategory)),
  workspace('cybersecurity', '/services/cybersecurity', 'Cybersecurity', 'Cytas security capabilities', 'Cybersecurity and Compliance Leads',
    'VAPT, cloud security, IAM, SOC 2, ISO 27001, HIPAA, CMMC and managed-security opportunities.',
    'Security and compliance pipeline', 'Verify the regulatory driver, deadline, authority and required assurance evidence.',
    'No cybersecurity or compliance leads currently match this scope.',
    (lead) => lead.serviceCategory === 'cybersecurity_compliance'),
  workspace('immersive', '/services/immersive', '3D, AR and VR', 'Motionly immersive capabilities', '3D, AR, VR and Real-Time Leads',
    'Product animation, immersive training, AR, VR, Unity and Unreal opportunities.',
    'Immersive and 3D pipeline', 'Confirm the target device, production quality, interactivity and delivery timeline.',
    'No immersive, AR, VR or 3D leads currently match this scope.',
    (lead) => lead.serviceCategory === 'ar_3d_unity_unreal'),
  workspace('marketing', '/services/marketing', 'Web and marketing', 'Digital presence and growth', 'Website, SEO and Digital Marketing Leads',
    'Website, portal, SEO, digital marketing, branding and growth-management opportunities.',
    'Web and digital-growth pipeline', 'Separate strategic growth opportunities from low-value one-off production requests.',
    'No website or digital-marketing leads currently match this scope.',
    (lead) => lead.serviceCategory === 'website_portal'),
];

export function resolveWorkspacePage(pathname: string): WorkspacePageDefinition | undefined {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return WORKSPACE_PAGES.find((page) => page.route === normalized);
}

export function buildWorkspacePage(
  records: StoredLeadRecord[],
  query: ProspectPageQuery,
  pageDefinition: WorkspacePageDefinition,
  selectedId?: string,
  now = new Date().toISOString(),
): WorkspacePageBuildResult {
  const normalized = normalizeWorkspacePageQuery(query);
  const workspaceRecords = records.filter((record) => pageDefinition.match(record.lead));
  const filtered = workspaceRecords.filter((record) => matchesFilters(record, normalized.filters, now));
  const ordered = [...filtered].sort((left, right) => compareRecords(left, right, normalized.filters.followUp));
  const totalPages = Math.max(1, Math.ceil(ordered.length / normalized.pageSize));
  const pageNumber = Math.min(normalized.page, totalPages);
  const offset = (pageNumber - 1) * normalized.pageSize;
  const pageRecords = ordered.slice(offset, offset + normalized.pageSize);
  const selected = selectedId ? workspaceRecords.find((record) => record.lead.id === selectedId) : pageRecords[0];
  const repositoryRecords = selected && !pageRecords.some((record) => record.lead.id === selected.lead.id)
    ? [...pageRecords, selected]
    : pageRecords;
  const start = ordered.length === 0 ? 0 : offset + 1;
  const end = ordered.length === 0 ? 0 : Math.min(offset + pageRecords.length, ordered.length);

  return {
    page: {
      records: pageRecords,
      page: pageNumber,
      pageSize: normalized.pageSize,
      totalPages,
      filteredTotal: ordered.length,
      visibleTotal: workspaceRecords.length,
      start,
      end,
      owners: [...new Set(workspaceRecords.map((record) => record.lead.owner?.trim()).filter((owner): owner is string => Boolean(owner)))].sort(),
      summary: buildSummary(workspaceRecords, now),
      query: normalized.filters,
    },
    repositoryRecords,
    selected,
  };
}

export function applyWorkspacePageChrome(
  html: string,
  page: WorkspacePageDefinition,
  summary: ProspectPageResult['summary'],
): string {
  let output = html;
  output = output.replace(/<title>Codistan Prospect Desk<\/title>/, `<title>${escapeHtml(page.title)} · Codistan Prospect Desk</title>`);
  output = output.replace(/href="\/prospects\?/g, `href="${page.route}?`);
  output = output.replace(/action="\/prospects"/g, `action="${page.route}"`);
  output = output.replace(/href="\/prospects\?pageSize=/g, `href="${page.route}?pageSize=`);
  output = output.replace(/<aside class="sidebar">[\s\S]*?<\/aside>/, renderWorkspaceSidebar(page.route, summary));
  output = output.replace(
    /<header class="topbar"><div>[\s\S]*?<\/div><div class="top-actions">/,
    `<header class="topbar"><div><button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="Toggle navigation">☰</button><p class="eyebrow">${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.description)}</p></div><div class="top-actions">`,
  );
  output = output.replace(
    /<div class="prospect-list"><div class="section-heading"><div><h2>Prospects<\/h2><p>[\s\S]*?<\/p><\/div><\/div>/,
    `<div class="prospect-list"><div class="section-heading"><div><h2>${escapeHtml(page.listTitle)}</h2><p>${escapeHtml(page.listDescription)}</p></div></div>`,
  );
  output = output.replace(
    /<tr><td colspan="7" class="empty">[\s\S]*?<\/td><\/tr>/,
    `<tr><td colspan="7" class="empty">${escapeHtml(page.emptyMessage)}</td></tr>`,
  );
  output = output.replace(/<section class="lower-grid"[\s\S]*?<\/section>\s*<section class="panel runs-panel">[\s\S]*?<\/section>/, '');
  output = output.replace('</style>', `${workspaceStyles()}</style>`);
  output = output.replace('</script></body>', `</script><script>${workspaceScript()}</script></body>`);
  return output;
}

export function renderWorkspaceSidebar(activeRoute: string, summary?: ProspectPageResult['summary']): string {
  const groups: Array<{ label: string; links: Array<{ href: string; text: string }> }> = [
    { label: 'Overview', links: [
      { href: '/prospects', text: 'All prospects' },
      { href: '/priorities', text: 'Priority queue' },
      { href: '/leads/research', text: 'Research queue' },
    ] },
    { label: 'Warm leads', links: [
      { href: '/leads/linkedin', text: 'LinkedIn warm leads' },
      { href: '/leads/upwork', text: 'Upwork saved searches' },
      { href: '/lead-signals', text: 'Signal intake' },
    ] },
    { label: 'Procurement', links: [
      { href: '/leads/rfq', text: 'RFQs' },
      { href: '/leads/rfp', text: 'RFPs' },
      { href: '/leads/eoi', text: 'EOIs' },
      { href: '/leads/rfi', text: 'RFIs' },
      { href: '/leads/tenders', text: 'All tenders' },
      { href: '/tenders', text: 'Tender intelligence' },
    ] },
    { label: 'Services', links: [
      { href: '/services', text: 'Services overview' },
      { href: '/services/ai', text: 'AI and automation' },
      { href: '/services/software', text: 'Software and SaaS' },
      { href: '/services/cybersecurity', text: 'Cybersecurity' },
      { href: '/services/immersive', text: '3D, AR and VR' },
      { href: '/services/marketing', text: 'Web and marketing' },
    ] },
    { label: 'Growth and system', links: [
      { href: '/leads/partnerships', text: 'Partnership leads' },
      { href: '/re-engagement', text: 'Re-engagement' },
      { href: '/portfolio', text: 'Portfolio proof' },
      { href: '/operations', text: 'Operations' },
      { href: '/delivery-health', text: 'Delivery health' },
    ] },
  ];
  const queue = summary
    ? `<div class="sidebar-card"><span>Current page</span><strong>${summary.total} visible</strong><small>${summary.followUpsDue} follow-ups due · ${summary.unassigned} unassigned</small></div>`
    : '';
  return `<aside class="sidebar" id="workspace-sidebar"><div class="brand"><div class="brand-mark">C</div><div><strong>Codistan</strong><span>Prospect Desk</span></div></div><div class="workspace-nav">${groups.map((group) => `<section class="nav-group"><span class="nav-label">${escapeHtml(group.label)}</span>${group.links.map((link) => `<a class="nav-item ${isActiveRoute(activeRoute, link.href) ? 'active' : ''}" href="${escapeAttribute(link.href)}">${escapeHtml(link.text)}</a>`).join('')}</section>`).join('')}</div>${queue}<button id="logout-button" class="ghost full">Log out</button></aside>`;
}

function workspace(
  id: WorkspacePageId,
  route: string,
  navigationLabel: string,
  eyebrow: string,
  title: string,
  description: string,
  listTitle: string,
  listDescription: string,
  emptyMessage: string,
  match: (lead: Lead) => boolean,
): WorkspacePageDefinition {
  return { id, route, navigationLabel, eyebrow, title, description, listTitle, listDescription, emptyMessage, match };
}

function normalizeWorkspacePageQuery(query: ProspectPageQuery): {
  page: number;
  pageSize: ProspectPageResult['pageSize'];
  filters: ProspectPageResult['query'];
} {
  const page = positiveInteger(query.page, 1);
  const requestedPageSize = positiveInteger(query.pageSize, 25);
  const pageSize = [25, 50, 100].includes(requestedPageSize)
    ? requestedPageSize as ProspectPageResult['pageSize']
    : 25;
  return {
    page,
    pageSize,
    filters: {
      search: clean(query.search),
      status: clean(query.status),
      signal: clean(query.signal),
      service: clean(query.service),
      owner: clean(query.owner),
      feedback: clean(query.feedback),
      followUp: normalizeFollowUpFilter(query.followUp),
    },
  };
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
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const nextDay = dayStart.getTime() + 86_400_000;
  if (filter === 'not_scheduled') return !Number.isFinite(value);
  if (!Number.isFinite(value)) return false;
  if (filter === 'due') return value <= nowTime;
  if (filter === 'overdue') return value < dayStart.getTime();
  if (filter === 'today') return value >= dayStart.getTime() && value < nextDay;
  if (filter === 'next_7_days') return value > nowTime && value <= nowTime + 7 * 86_400_000;
  if (filter === 'scheduled') return true;
  return true;
}

function compareRecords(left: StoredLeadRecord, right: StoredLeadRecord, followUpFilter: string): number {
  if (followUpFilter) {
    const leftFollowUp = left.lead.nextFollowUpAt ? Date.parse(left.lead.nextFollowUpAt) : Number.POSITIVE_INFINITY;
    const rightFollowUp = right.lead.nextFollowUpAt ? Date.parse(right.lead.nextFollowUpAt) : Number.POSITIVE_INFINITY;
    if (leftFollowUp !== rightFollowUp) return leftFollowUp - rightFollowUp;
  }
  const rankDifference = (left.lead.rank ?? 999_999) - (right.lead.rank ?? 999_999);
  if (rankDifference !== 0) return rankDifference;
  return Date.parse(right.lead.updatedAt) - Date.parse(left.lead.updatedAt);
}

function buildSummary(records: StoredLeadRecord[], now: string): ProspectPageResult['summary'] {
  const statuses = (values: PipelineStatus[]) => records.filter((record) => values.includes(record.lead.pipelineStatus)).length;
  const nowTime = Date.parse(now);
  return {
    total: records.length,
    live: records.filter((record) => record.lead.opportunityStatus === 'live_opportunity').length,
    contacted: statuses(['sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']),
    replied: statuses(['replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']),
    followUpsDue: records.filter((record) => record.lead.nextFollowUpAt
      && Date.parse(record.lead.nextFollowUpAt) <= nowTime
      && !['won', 'lost', 'rejected', 'archived'].includes(record.lead.pipelineStatus)).length,
    unassigned: records.filter((record) => !record.lead.owner).length,
    won: statuses(['won']),
    feedbackPending: records.filter((record) => record.lead.feedback?.status !== 'complete').length,
  };
}

function isActiveRoute(activeRoute: string, href: string): boolean {
  if (activeRoute === href) return true;
  if (href === '/leads/tenders' && activeRoute === '/tenders') return true;
  return false;
}

function normalizeFollowUpFilter(value: unknown): string {
  const normalized = clean(value);
  return ['due', 'overdue', 'today', 'next_7_days', 'scheduled', 'not_scheduled'].includes(normalized)
    ? normalized
    : '';
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function workspaceStyles(): string {
  return `
.workspace-nav{overflow:auto;flex:1;padding-right:3px}.nav-group{display:grid;gap:4px;margin:0 0 14px}.nav-label{padding:0 10px 5px;color:#98a2b3;font-size:9px;font-weight:900;letter-spacing:.11em;text-transform:uppercase}.nav-group .nav-item{padding:8px 10px;font-size:12px}.sidebar-toggle{display:none;border:1px solid #d0d5dd;background:#fff;border-radius:9px;padding:7px 10px;margin-bottom:10px;font-size:18px}.sidebar.is-open{transform:translateX(0)}
@media(max-width:980px){.app-shell{display:block}.sidebar{position:fixed;inset:0 auto 0 0;width:280px;z-index:1000;transform:translateX(-105%);transition:transform .2s ease;box-shadow:12px 0 40px rgba(15,23,42,.22)}.main{margin-left:0!important;width:100%}.sidebar-toggle{display:inline-flex}.workspace-sidebar-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:999}.topbar{align-items:flex-start}}
`;
}

function workspaceScript(): string {
  return `
const workspaceSidebar=document.getElementById('workspace-sidebar');
const sidebarToggle=document.getElementById('sidebar-toggle');
function closeWorkspaceSidebar(){workspaceSidebar?.classList.remove('is-open');document.querySelector('.workspace-sidebar-backdrop')?.remove();}
sidebarToggle?.addEventListener('click',()=>{if(!workspaceSidebar)return;workspaceSidebar.classList.add('is-open');const backdrop=document.createElement('div');backdrop.className='workspace-sidebar-backdrop';backdrop.addEventListener('click',closeWorkspaceSidebar);document.body.append(backdrop);});
window.addEventListener('resize',()=>{if(window.innerWidth>980)closeWorkspaceSidebar();});
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
