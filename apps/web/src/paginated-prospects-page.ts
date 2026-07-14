import type { StoredLeadRecord } from '@sales-automation/storage';
import { renderProspectDashboardPage, type ProspectDashboardPageInput } from './prospects-page.js';

export interface ProspectDashboardSummary {
  total: number;
  live: number;
  contacted: number;
  replied: number;
  followUpsDue: number;
  unassigned: number;
  won: number;
  feedbackPending: number;
}

export interface ProspectDashboardPagination {
  records: StoredLeadRecord[];
  page: number;
  pageSize: 25 | 50 | 100;
  totalPages: number;
  filteredTotal: number;
  visibleTotal: number;
  start: number;
  end: number;
  owners: string[];
  summary: ProspectDashboardSummary;
  query: {
    search: string;
    status: string;
    signal: string;
    service: string;
    owner: string;
    feedback: string;
  };
}

export interface ProspectDashboardAccessView {
  identifier: string;
  displayName: string;
  scopeKind: 'all' | 'team' | 'own';
  scopeLabel: string;
  canRunGlobalOperations: boolean;
  canAssignOwners: boolean;
}

export interface PaginatedProspectDashboardInput extends ProspectDashboardPageInput {
  pagination: ProspectDashboardPagination;
  access: ProspectDashboardAccessView;
}

export function renderPaginatedProspectDashboardPage(input: PaginatedProspectDashboardInput): string {
  let html = renderProspectDashboardPage(input);
  html = repairEmbeddedClientScript(html);
  const { pagination, access } = input;
  html = applyDashboardSummary(html, pagination.summary);

  const topActions = access.canRunGlobalOperations
    ? `<div class="top-actions"><button id="pseb-sync" class="ghost">Sync PSEB collection</button><button id="import-starter" class="ghost">Load verified prospects</button><button id="run-discovery" class="primary">Run discovery now</button></div>`
    : '<div class="top-actions"><span class="restricted-note">Global discovery and imports are restricted to Admin and Waseem.</span></div>';

  html = html.replace(/<div class="top-actions">[\s\S]*?<\/div><\/header>/, `${topActions}</header>`);
  html = html.replace(
    '<header class="topbar"><div>',
    `<header class="topbar"><div><div class="access-line"><span class="scope-badge scope-${access.scopeKind}">${escapeHtml(access.scopeLabel)}</span><span>Signed in as ${escapeHtml(access.displayName)}</span></div>`,
  );

  html = html.replace(
    /<section class="toolbar">[\s\S]*?<\/section>/,
    renderFilterForm(pagination),
  );

  html = html.replace(
    `${input.records.length} stored records · click a row to manage it`,
    `Showing ${pagination.start}–${pagination.end} of ${pagination.filteredTotal} matching leads · ${pagination.visibleTotal} visible in your scope`,
  );

  html = html.replace(
    '</tbody></table></div></div>\n    <div class="detail-panel">',
    `</tbody></table></div>${renderPagination(pagination)}</div>\n    <div class="detail-panel">`,
  );

  html = html.replace(
    '<body>',
    `<body class="${access.canAssignOwners ? '' : 'access-no-assign'}">`,
  );

  html = html.replace('</style>', `${paginationStyles()}</style>`);
  html = html.replace('</script></body>', `</script><script>${paginationScript()}</script></body>`);
  return html;
}

export function repairEmbeddedClientScript(html: string): string {
  return html.replace("performedBy+'\n'+String", "performedBy+'\\n'+String");
}

export function applyDashboardSummary(html: string, summary: ProspectDashboardSummary): string {
  const metrics: Array<[string, number]> = [
    ['Total prospects', summary.total],
    ['Live opportunities', summary.live],
    ['Contacted', summary.contacted],
    ['Replies', summary.replied],
    ['Follow-ups due', summary.followUpsDue],
    ['Unassigned', summary.unassigned],
    ['Won', summary.won],
    ['Feedback pending', summary.feedbackPending],
  ];

  for (const [labelText, value] of metrics) {
    const pattern = new RegExp(`(<span>${escapeRegExp(labelText)}<\\/span><strong>)[^<]*(<\\/strong>)`);
    html = html.replace(pattern, `$1${value}$2`);
  }

  return html.replace(
    /(<div class="sidebar-card"><span>BD work queue<\/span><strong>)[^<]*(<\/strong><small>)[^<]*(<\/small>)/,
    `$1${summary.unassigned} unassigned$2${summary.followUpsDue} follow-ups due · ${summary.feedbackPending} feedback pending$3`,
  );
}

function renderFilterForm(pagination: ProspectDashboardPagination): string {
  const query = pagination.query;
  return `<form class="toolbar server-toolbar" id="prospect-filter-form" method="get" action="/prospects">
    <input id="prospect-search" name="search" type="search" value="${escapeAttribute(query.search)}" placeholder="Search company, person, owner, service, evidence or activity" />
    ${select('status-filter', 'status', 'All statuses', query.status, ['new','scored','needs_research','needs_human_review','approved_to_contact','draft_ready','hot_alert_sent','sent_manually','replied','meeting_booked','proposal_sent','won','lost','rejected','archived'])}
    ${select('signal-filter', 'signal', 'All signal types', query.signal, ['live_opportunity','recent_demand_signal','partnership_target'])}
    ${select('service-filter', 'service', 'All services', query.service, ['ai_automation','rag_document_intelligence','ai_saas_mvp','fullstack_web_app','nextjs_python_app','voice_ai_agent','ar_3d_unity_unreal','cybersecurity_compliance','website_portal','enterprise_systems','unknown'])}
    ${select('owner-filter', 'owner', 'All owners', query.owner, ['unassigned', ...pagination.owners])}
    ${select('feedback-filter', 'feedback', 'All feedback', query.feedback, ['pending','complete'])}
    <label class="page-size-control">Per page<select id="page-size" name="pageSize">${[25,50,100].map((size) => `<option value="${size}" ${size === pagination.pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></label>
    <button type="submit" class="ghost filter-submit">Apply</button>
    <a class="clear-filters" href="/prospects?pageSize=${pagination.pageSize}">Clear</a>
  </form>`;
}

function select(id: string, name: string, placeholder: string, selected: string, values: string[]): string {
  return `<select id="${id}" name="${name}"><option value="">${escapeHtml(placeholder)}</option>${values.map((value) => `<option value="${escapeAttribute(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label(value))}</option>`).join('')}</select>`;
}

function renderPagination(pagination: ProspectDashboardPagination): string {
  if (pagination.filteredTotal === 0) return '<div class="pagination-bar"><span>No matching leads in this scope.</span></div>';
  const previous = Math.max(1, pagination.page - 1);
  const next = Math.min(pagination.totalPages, pagination.page + 1);
  const pages = pageWindow(pagination.page, pagination.totalPages);
  return `<nav class="pagination-bar" aria-label="Prospect pages"><span>Results ${pagination.start}–${pagination.end} of ${pagination.filteredTotal}</span><div>
    <a class="page-link ${pagination.page === 1 ? 'disabled' : ''}" href="${pageUrl(pagination, previous)}">Previous</a>
    ${pages.map((page) => `<a class="page-link ${page === pagination.page ? 'active' : ''}" href="${pageUrl(pagination, page)}">${page}</a>`).join('')}
    <a class="page-link ${pagination.page === pagination.totalPages ? 'disabled' : ''}" href="${pageUrl(pagination, next)}">Next</a>
  </div></nav>`;
}

function pageUrl(pagination: ProspectDashboardPagination, page: number): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pagination.pageSize));
  for (const [key, value] of Object.entries(pagination.query)) if (value) params.set(key, value);
  return `/prospects?${params.toString()}`;
}

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  const values: number[] = [];
  for (let value = start; value <= end; value += 1) values.push(value);
  return values;
}

function paginationScript(): string {
  return `
const serverFilterForm=document.getElementById('prospect-filter-form');
const serverFilterSelects=serverFilterForm?.querySelectorAll('select')||[];
serverFilterSelects.forEach(element=>element.addEventListener('change',()=>{document.body.classList.add('is-loading');serverFilterForm.requestSubmit();}));
serverFilterForm?.addEventListener('submit',()=>document.body.classList.add('is-loading'));
document.querySelectorAll('.page-link:not(.disabled)').forEach(link=>link.addEventListener('click',()=>document.body.classList.add('is-loading')));
async function runPsebSync(){const button=document.getElementById('pseb-sync'),status=document.getElementById('run-status');if(!button)return;button.disabled=true;const original=button.textContent;button.textContent='Syncing PSEB…';try{const response=await fetch('/api/prospects/pseb-sync',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const data=await response.json();if(!response.ok)throw new Error(data.error||'PSEB synchronization failed');status.textContent=(data.imported+' imported; '+data.existing+' already present; '+data.checked+' checked.');setTimeout(()=>location.reload(),700);}catch(error){status.textContent=error.message;button.disabled=false;button.textContent=original;}}
document.getElementById('pseb-sync')?.addEventListener('click',runPsebSync);
document.querySelectorAll('.disabled').forEach(link=>link.addEventListener('click',event=>event.preventDefault()));
`;
}

function paginationStyles(): string {
  return `
.access-line{display:flex;align-items:center;gap:9px;margin-bottom:8px;color:#667085;font-size:12px}.scope-badge{display:inline-flex;border-radius:999px;padding:5px 9px;font-weight:800;background:#ecfdf3;color:#027a48}.scope-team{background:#fff7ed;color:#c2410c}.scope-own{background:#eef2ff;color:#4338ca}.restricted-note{max-width:310px;color:#667085;font-size:12px;text-align:right}.server-toolbar{grid-template-columns:minmax(220px,1.5fr) repeat(5,minmax(125px,.55fr)) minmax(100px,.35fr) auto auto;align-items:end}.page-size-control{display:grid;gap:4px;color:#667085;font-size:10px}.page-size-control select{width:100%}.filter-submit{height:42px}.clear-filters{align-self:center;font-size:12px}.pagination-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-top:1px solid #eaecf0;color:#667085;font-size:12px}.pagination-bar>div{display:flex;gap:5px;flex-wrap:wrap}.page-link{border:1px solid #d0d5dd;border-radius:8px;padding:6px 9px;color:#344054;background:#fff}.page-link.active{background:#3157d5;border-color:#3157d5;color:#fff}.page-link.disabled{opacity:.45;pointer-events:none}.access-no-assign form[data-endpoint$="/owner"]{display:none}.is-loading .main{opacity:.62;pointer-events:none}.is-loading:after{content:'Loading…';position:fixed;inset:auto 20px 20px auto;background:#111827;color:#fff;padding:10px 14px;border-radius:10px;z-index:9999}
@media(max-width:1550px){.server-toolbar{grid-template-columns:repeat(4,minmax(150px,1fr))}.restricted-note{text-align:left}}
@media(max-width:800px){.server-toolbar{grid-template-columns:1fr}.pagination-bar{align-items:flex-start;flex-direction:column}.table-wrap{overflow:visible;max-height:none}table,thead,tbody,tr,th,td{display:block}thead{display:none}.prospect-row{margin:10px;border:1px solid #e4e7ec;border-radius:12px;padding:8px}.prospect-row td{display:grid;grid-template-columns:92px 1fr;gap:10px;border-top:1px solid #f0f1f3;padding:9px}.prospect-row td:first-child{border-top:0}.prospect-row td:before{font-size:10px;font-weight:800;color:#667085;text-transform:uppercase}.prospect-row td:nth-child(1):before{content:'Rank'}.prospect-row td:nth-child(2):before{content:'Company'}.prospect-row td:nth-child(3):before{content:'Service'}.prospect-row td:nth-child(4):before{content:'Owner'}.prospect-row td:nth-child(5):before{content:'Status'}.prospect-row td:nth-child(6):before{content:'Follow-up'}}`;
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
