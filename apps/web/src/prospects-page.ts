import type { ProspectDiscoveryRun } from '@sales-automation/prospect-discovery';
import type { Lead, PipelineStatus } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

export interface ProspectDashboardPageInput {
  records: StoredLeadRecord[];
  selected?: StoredLeadRecord;
  runs: ProspectDiscoveryRun[];
  generatedAt: string;
}

const pipelineStatuses: PipelineStatus[] = [
  'new',
  'scored',
  'needs_research',
  'needs_human_review',
  'approved_to_contact',
  'draft_ready',
  'hot_alert_sent',
  'sent_manually',
  'replied',
  'meeting_booked',
  'proposal_sent',
  'won',
  'lost',
  'rejected',
  'archived',
];

export function renderProspectDashboardPage(input: ProspectDashboardPageInput): string {
  const records = [...input.records].sort((a, b) => prospectDate(b.lead).localeCompare(prospectDate(a.lead)));
  const selected = input.selected ?? records[0];
  const metrics = buildMetrics(records, input.generatedAt);
  const sourceStats = buildSourceStats(records);
  const lastRun = input.runs[0];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codistan Prospect Desk</title>
  <style>${styles()}</style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">C</div>
        <div><strong>Codistan</strong><span>Prospect Desk</span></div>
      </div>
      <nav>
        <a class="nav-item active" href="/">Prospects</a>
        <a class="nav-item" href="/lead-desk">Legacy Lead Desk</a>
      </nav>
      <div class="sidebar-card">
        <span>Discovery worker</span>
        <strong>${lastRun ? `${lastRun.newLeadCount} new in last run` : 'No run yet'}</strong>
        <small>${lastRun ? escapeHtml(formatDateTime(lastRun.completedAt)) : 'Run discovery to begin.'}</small>
      </div>
      <button id="logout-button" class="ghost full">Log out</button>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">Primary objective: continuously find new prospects</p>
          <h1>Prospect Discovery & Management</h1>
          <p>Public-source discovery, evidence, contacts, outreach history, responses and outcomes in one place.</p>
        </div>
        <button id="run-discovery" class="primary">Run discovery now</button>
      </header>

      <section class="metrics">
        ${metric('Total prospects', metrics.total)}
        ${metric('New today', metrics.newToday)}
        ${metric('Live opportunities', metrics.live)}
        ${metric('Partnership targets', metrics.partners)}
        ${metric('Contacted', metrics.contacted)}
        ${metric('Replies', metrics.replied)}
        ${metric('Meetings', metrics.meetings)}
        ${metric('Won', metrics.won)}
      </section>

      <section class="status-strip">
        <div>
          <strong>Latest discovery</strong>
          <span>${lastRun ? `${lastRun.candidateCount} candidates checked · ${lastRun.newLeadCount} saved · ${lastRun.duplicateCount} duplicates` : 'Not run yet'}</span>
        </div>
        <div id="run-status" class="run-status ${lastRun?.emailStatus ?? 'skipped'}">${lastRun ? escapeHtml(lastRun.emailMessage ?? lastRun.emailStatus) : 'Ready'}</div>
      </section>

      <section class="toolbar">
        <input id="prospect-search" type="search" placeholder="Search company, contact, service, source or evidence" />
        <select id="status-filter">
          <option value="">All pipeline statuses</option>
          ${pipelineStatuses.map((status) => `<option value="${status}">${escapeHtml(label(status))}</option>`).join('')}
        </select>
        <select id="signal-filter">
          <option value="">All signal types</option>
          <option value="live_opportunity">Live opportunity</option>
          <option value="recent_demand_signal">Recent demand signal</option>
          <option value="partnership_target">Partnership target</option>
        </select>
      </section>

      <section class="workspace">
        <div class="prospect-list">
          <div class="section-heading">
            <div><h2>Prospects</h2><p>${records.length} stored records</p></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Company / Signal</th><th>Contact</th><th>Type</th><th>Status</th><th>Discovered</th></tr></thead>
              <tbody id="prospect-rows">
                ${records.map((record) => renderProspectRow(record, selected?.lead.id)).join('') || '<tr><td colspan="5" class="empty">No prospects yet. Run discovery to create the first batch.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div class="detail-panel">
          ${selected ? renderProspectDetail(selected) : renderEmptyDetail()}
        </div>
      </section>

      <section class="lower-grid">
        <article class="panel">
          <div class="section-heading"><div><h2>Source performance</h2><p>Use replies and wins to refine discovery sources later.</p></div></div>
          ${renderSourceStats(sourceStats)}
        </article>
        <article class="panel">
          <div class="section-heading"><div><h2>Recent discovery runs</h2><p>Audit what the worker checked and added.</p></div></div>
          ${renderRuns(input.runs)}
        </article>
      </section>
    </main>
  </div>
  <script>${clientScript()}</script>
</body>
</html>`;
}

export function renderLoginPage(error?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Codistan Prospect Desk Login</title><style>${loginStyles()}</style></head>
<body><main class="login-shell"><section class="login-card">
  <div class="login-mark">C</div>
  <p class="eyebrow">Internal system</p>
  <h1>Codistan Prospect Desk</h1>
  <p>Enter the admin password to access prospect discovery and management.</p>
  ${error ? `<div class="login-error">${escapeHtml(error)}</div>` : ''}
  <form id="login-form">
    <label>Admin password<input name="password" type="password" autocomplete="current-password" required autofocus /></label>
    <button type="submit">Sign in</button>
  </form>
  <pre id="login-result" hidden></pre>
</section></main>
<script>
const form=document.getElementById('login-form');const result=document.getElementById('login-result');
form.addEventListener('submit',async(e)=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;result.hidden=true;
try{const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:new FormData(form).get('password')})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Login failed');location.href='/';}
catch(error){result.textContent=error.message;result.hidden=false;button.disabled=false;}});
</script></body></html>`;
}

function renderProspectRow(record: StoredLeadRecord, selectedId?: string): string {
  const lead = record.lead;
  const searchText = [lead.companyName, lead.title, lead.contactName, lead.contactRole, lead.contactEmail, lead.serviceCategory, lead.discoverySource, lead.evidenceSummary].filter(Boolean).join(' ').toLowerCase();
  return `<tr class="prospect-row ${lead.id === selectedId ? 'selected' : ''}" data-search="${escapeAttribute(searchText)}" data-status="${lead.pipelineStatus}" data-signal="${lead.opportunityStatus ?? ''}">
    <td><a href="/?leadId=${encodeURIComponent(lead.id)}"><strong>${escapeHtml(lead.companyName ?? lead.title)}</strong><span>${escapeHtml(shorten(lead.title, 90))}</span></a></td>
    <td><strong>${escapeHtml(lead.contactName ?? 'Not identified')}</strong><span>${escapeHtml(lead.contactRole ?? lead.contactEmail ?? 'Public contact route pending')}</span></td>
    <td><span class="pill signal-${lead.opportunityStatus ?? 'unknown'}">${escapeHtml(label(lead.opportunityStatus ?? lead.leadType))}</span></td>
    <td><span class="pill status">${escapeHtml(label(lead.pipelineStatus))}</span></td>
    <td>${escapeHtml(formatDate(prospectDate(lead)))}</td>
  </tr>`;
}

function renderProspectDetail(record: StoredLeadRecord): string {
  const lead = record.lead;
  const proofNames = record.latestEvaluation?.portfolioMatches.map((match) => match.portfolioItem.projectName).join(', ');
  return `<div class="detail-header">
    <div><p class="eyebrow">${escapeHtml(label(lead.opportunityStatus ?? lead.leadType))}</p><h2>${escapeHtml(lead.companyName ?? lead.title)}</h2><p>${escapeHtml(lead.title)}</p></div>
    <span class="score">${record.latestEvaluation?.score.total ?? lead.score?.total ?? '—'}<small>/100</small></span>
  </div>

  <div class="detail-grid">
    ${detailItem('Company website', link(lead.companyWebsite, lead.companyWebsite ?? 'Not resolved'))}
    ${detailItem('Decision-maker', escapeHtml(formatContact(lead)))}
    ${detailItem('Email', lead.contactEmail ? `<a href="mailto:${escapeAttribute(lead.contactEmail)}">${escapeHtml(lead.contactEmail)}</a>` : 'Not publicly found')}
    ${detailItem('Phone', escapeHtml(lead.contactPhone ?? 'Not publicly found'))}
    ${detailItem('Contact route', link(lead.contactFormUrl ?? lead.linkedinUrl, lead.contactFormUrl ? 'Contact form' : lead.linkedinUrl ? 'LinkedIn' : 'Not available'))}
    ${detailItem('Country', escapeHtml(lead.country ?? 'Not confirmed'))}
    ${detailItem('Service match', escapeHtml(label(lead.serviceCategory)))}
    ${detailItem('Recommended identity', escapeHtml(label(lead.recommendedProfile ?? 'needs_human_review')))}
  </div>

  <section class="detail-section evidence">
    <h3>Why this prospect is here</h3>
    <p>${escapeHtml(lead.evidenceSummary ?? lead.description)}</p>
    <div class="evidence-links">${link(lead.evidenceUrl ?? lead.sourceUrl, 'Open source evidence')} ${link(lead.companyWebsite, 'Open company website')}</div>
    <small>Source: ${escapeHtml(lead.discoverySource ?? lead.source)} · Discovered ${escapeHtml(formatDateTime(lead.discoveredAt ?? lead.capturedAt))}</small>
  </section>

  <section class="detail-section">
    <h3>Recommended approach</h3>
    <p><strong>Portfolio to share:</strong> ${escapeHtml(proofNames || 'No approved proof matched yet')}</p>
    <p><strong>Next action:</strong> ${escapeHtml(lead.recommendedNextAction ?? 'Research the company and prepare human-approved outreach.')}</p>
    <div class="draft-box"><pre id="selected-draft">${escapeHtml(lead.draftMessage ?? fallbackMessage(lead))}</pre><button type="button" id="copy-draft" class="ghost">Copy message</button></div>
  </section>

  <section class="detail-section action-forms">
    <h3>Manage prospect</h3>
    <form data-action-form data-endpoint="/api/prospects/${encodeURIComponent(lead.id)}/status">
      <label>Pipeline status<select name="status">${pipelineStatuses.map((status) => `<option value="${status}" ${status === lead.pipelineStatus ? 'selected' : ''}>${escapeHtml(label(status))}</option>`).join('')}</select></label>
      <button type="submit">Update status</button>
    </form>
    <form data-action-form data-endpoint="/api/prospects/${encodeURIComponent(lead.id)}/owner">
      <label>Owner<input name="owner" value="${escapeAttribute(lead.owner ?? '')}" placeholder="BD owner" required /></label>
      <button type="submit">Assign</button>
    </form>
    <form data-action-form data-endpoint="/api/prospects/${encodeURIComponent(lead.id)}/activity" class="activity-form">
      <label>Activity type<select name="type"><option value="comment">Comment</option><option value="outreach">Outreach sent</option><option value="response">Response received</option><option value="meeting">Meeting booked</option><option value="proposal">Proposal sent</option></select></label>
      <label>Channel<select name="channel"><option value="internal">Internal</option><option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="other">Other</option></select></label>
      <label class="wide">Comment / outcome<textarea name="body" rows="4" required placeholder="What was sent, what they replied, next step, objections or outcome"></textarea></label>
      <button type="submit">Add activity</button>
    </form>
  </section>

  <section class="detail-section">
    <h3>Activity timeline</h3>
    ${renderActivityTimeline(record)}
  </section>`;
}

function renderActivityTimeline(record: StoredLeadRecord): string {
  const items = record.auditLog.slice().reverse().slice(0, 30);
  if (items.length === 0) return '<p class="empty">No activity recorded yet.</p>';
  return `<div class="timeline">${items.map((entry) => {
    const note = typeof entry.metadata?.note === 'string' ? parseActivityNote(entry.metadata.note) : undefined;
    return `<article><span></span><div><strong>${escapeHtml(note?.type ? `${label(note.type)} · ${label(note.channel ?? 'internal')}` : label(entry.action))}</strong><p>${escapeHtml(note?.body ?? entry.message)}</p><small>${escapeHtml(entry.actor)} · ${escapeHtml(formatDateTime(entry.createdAt))}</small></div></article>`;
  }).join('')}</div>`;
}

function parseActivityNote(note: string): { type?: string; channel?: string; body: string } {
  const match = note.match(/^activity::([^:]+)::([^:]+)::([\s\S]*)$/);
  if (!match) return { body: note };
  return { type: match[1], channel: match[2], body: match[3] ?? '' };
}

function renderSourceStats(stats: SourceStat[]): string {
  if (stats.length === 0) return '<p class="empty">Source performance will appear after discovery runs.</p>';
  return `<div class="source-stats">${stats.map((stat) => `<div><strong>${escapeHtml(stat.source)}</strong><span>${stat.total} found</span><span>${stat.contacted} contacted</span><span>${stat.replied} replied</span><span>${stat.won} won</span></div>`).join('')}</div>`;
}

function renderRuns(runs: ProspectDiscoveryRun[]): string {
  if (runs.length === 0) return '<p class="empty">No discovery run has been recorded.</p>';
  return `<div class="runs">${runs.slice(0, 8).map((run) => `<article><div><strong>${escapeHtml(formatDateTime(run.completedAt))}</strong><span>${run.sourceCount} sources · ${run.candidateCount} candidates</span></div><div><b>${run.newLeadCount} new</b><span>${run.duplicateCount} duplicates · email ${escapeHtml(run.emailStatus)}</span></div></article>`).join('')}</div>`;
}

function renderEmptyDetail(): string {
  return '<div class="empty-detail"><h2>No prospects yet</h2><p>Run discovery to populate this dashboard from public sources.</p></div>';
}

interface DashboardMetrics {
  total: number;
  newToday: number;
  live: number;
  partners: number;
  contacted: number;
  replied: number;
  meetings: number;
  won: number;
}

function buildMetrics(records: StoredLeadRecord[], now: string): DashboardMetrics {
  const today = now.slice(0, 10);
  const statusCount = (statuses: PipelineStatus[]) => records.filter((record) => statuses.includes(record.lead.pipelineStatus)).length;
  return {
    total: records.length,
    newToday: records.filter((record) => prospectDate(record.lead).slice(0, 10) === today).length,
    live: records.filter((record) => record.lead.opportunityStatus === 'live_opportunity').length,
    partners: records.filter((record) => record.lead.opportunityStatus === 'partnership_target' || record.lead.prospectStage === 'partner_prospect').length,
    contacted: statusCount(['sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']),
    replied: statusCount(['replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']),
    meetings: statusCount(['meeting_booked', 'proposal_sent', 'won', 'lost']),
    won: statusCount(['won']),
  };
}

interface SourceStat {
  source: string;
  total: number;
  contacted: number;
  replied: number;
  won: number;
}

function buildSourceStats(records: StoredLeadRecord[]): SourceStat[] {
  const map = new Map<string, SourceStat>();
  for (const record of records) {
    const source = record.lead.discoverySource ?? record.lead.source;
    const stat = map.get(source) ?? { source, total: 0, contacted: 0, replied: 0, won: 0 };
    stat.total += 1;
    if (['sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost'].includes(record.lead.pipelineStatus)) stat.contacted += 1;
    if (['replied', 'meeting_booked', 'proposal_sent', 'won', 'lost'].includes(record.lead.pipelineStatus)) stat.replied += 1;
    if (record.lead.pipelineStatus === 'won') stat.won += 1;
    map.set(source, stat);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 12);
}

function metric(labelText: string, value: number): string {
  return `<article><span>${escapeHtml(labelText)}</span><strong>${value}</strong></article>`;
}

function detailItem(labelText: string, value: string): string {
  return `<div><span>${escapeHtml(labelText)}</span><strong>${value}</strong></div>`;
}

function formatContact(lead: Lead): string {
  if (lead.contactName && lead.contactRole) return `${lead.contactName} — ${lead.contactRole}`;
  return lead.contactName ?? lead.contactRole ?? 'Not identified';
}

function fallbackMessage(lead: Lead): string {
  return `Hi, I noticed ${lead.companyName ?? 'your team'}'s recent activity around ${lead.title}. Codistan can support this through ${label(lead.serviceCategory)} and a dedicated delivery team. May I share two relevant examples and a focused collaboration approach?`;
}

function prospectDate(lead: Lead): string {
  return lead.discoveredAt ?? lead.capturedAt ?? lead.createdAt;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shorten(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`;
}

function link(url: string | undefined, text: string): string {
  if (!url) return escapeHtml(text);
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return escapeHtml(text);
    return `<a href="${escapeAttribute(parsed.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function clientScript(): string {
  return `
const search=document.getElementById('prospect-search');const statusFilter=document.getElementById('status-filter');const signalFilter=document.getElementById('signal-filter');
function applyFilters(){const query=(search?.value||'').toLowerCase();const status=statusFilter?.value||'';const signal=signalFilter?.value||'';document.querySelectorAll('.prospect-row').forEach(row=>{const visible=(!query||row.dataset.search.includes(query))&&(!status||row.dataset.status===status)&&(!signal||row.dataset.signal===signal);row.hidden=!visible;});}
search?.addEventListener('input',applyFilters);statusFilter?.addEventListener('change',applyFilters);signalFilter?.addEventListener('change',applyFilters);

document.querySelectorAll('[data-action-form]').forEach(form=>form.addEventListener('submit',async(event)=>{event.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;const payload=Object.fromEntries(new FormData(form).entries());try{const response=await fetch(form.dataset.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Action failed');location.reload();}catch(error){alert(error.message);button.disabled=false;}}));

document.getElementById('run-discovery')?.addEventListener('click',async(event)=>{const button=event.currentTarget;const status=document.getElementById('run-status');button.disabled=true;button.textContent='Running discovery…';status.textContent='Checking public sources, company websites and contacts…';try{const response=await fetch('/api/prospects/run',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Discovery failed');status.textContent=data.run.newLeadCount+' new prospects added; '+data.run.duplicateCount+' duplicates removed.';setTimeout(()=>location.reload(),1000);}catch(error){status.textContent=error.message;button.disabled=false;button.textContent='Run discovery now';}});

document.getElementById('copy-draft')?.addEventListener('click',async()=>{const text=document.getElementById('selected-draft')?.textContent||'';await navigator.clipboard.writeText(text);document.getElementById('copy-draft').textContent='Copied';});

document.getElementById('logout-button')?.addEventListener('click',async()=>{await fetch('/api/logout',{method:'POST'});location.href='/login';});
`;
}

function styles(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f3f5f9;line-height:1.45}*{box-sizing:border-box}body{margin:0}a{color:#3157d5;text-decoration:none}button,input,select,textarea{font:inherit}.app-shell{min-height:100vh;display:grid;grid-template-columns:240px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;background:#111827;color:#fff;padding:24px 18px;display:flex;flex-direction:column;gap:24px}.brand{display:flex;align-items:center;gap:12px}.brand-mark{width:40px;height:40px;border-radius:12px;background:#f8c838;color:#111827;display:grid;place-items:center;font-weight:900}.brand strong,.brand span{display:block}.brand span{font-size:12px;color:#9ca3af}.sidebar nav{display:grid;gap:8px}.nav-item{color:#cbd5e1;padding:11px 12px;border-radius:10px}.nav-item.active,.nav-item:hover{background:#1f2937;color:#fff}.sidebar-card{margin-top:auto;background:#1f2937;border:1px solid #374151;border-radius:14px;padding:14px;display:grid;gap:5px}.sidebar-card span,.sidebar-card small{color:#9ca3af;font-size:12px}.main{padding:30px;min-width:0}.topbar{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.topbar h1{margin:4px 0 8px;font-size:30px}.topbar p{margin:0;color:#667085}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:#667085}.primary,.action-forms button{border:0;border-radius:10px;background:#3157d5;color:#fff;padding:11px 16px;font-weight:700;cursor:pointer}.primary:disabled,button:disabled{opacity:.55;cursor:wait}.ghost{border:1px solid #d0d5dd;background:#fff;color:#344054;padding:9px 13px;border-radius:9px;cursor:pointer}.ghost.full{width:100%;background:transparent;color:#e5e7eb;border-color:#4b5563}.metrics{display:grid;grid-template-columns:repeat(8,minmax(110px,1fr));gap:12px;margin:24px 0}.metrics article{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:15px}.metrics span{display:block;color:#667085;font-size:12px}.metrics strong{font-size:26px}.status-strip,.toolbar,.panel,.prospect-list,.detail-panel{background:#fff;border:1px solid #e4e7ec;border-radius:16px}.status-strip{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;margin-bottom:14px}.status-strip div:first-child{display:grid}.status-strip span{color:#667085;font-size:13px}.run-status{font-size:12px;padding:7px 10px;border-radius:999px;background:#eef2ff;color:#364fc7}.run-status.sent{background:#ecfdf3;color:#027a48}.run-status.failed{background:#fef3f2;color:#b42318}.toolbar{display:grid;grid-template-columns:1fr 220px 220px;gap:10px;padding:12px;margin-bottom:14px}.toolbar input,.toolbar select,.action-forms input,.action-forms select,.action-forms textarea{width:100%;border:1px solid #d0d5dd;border-radius:9px;padding:10px;background:#fff}.workspace{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(360px,.85fr);gap:14px;align-items:start}.prospect-list,.detail-panel{min-width:0;overflow:hidden}.section-heading{display:flex;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #eaecf0}.section-heading h2{font-size:17px;margin:0}.section-heading p{font-size:12px;color:#667085;margin:3px 0 0}.table-wrap{overflow:auto;max-height:720px}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:#667085;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:11px 14px;background:#f9fafb;position:sticky;top:0}td{padding:13px 14px;border-top:1px solid #f0f1f3;vertical-align:top}tr.selected{background:#f2f4ff}.prospect-row:hover{background:#f8f9fc}.prospect-row td:first-child a{display:grid;gap:3px;color:#172033}.prospect-row td strong,.prospect-row td span{display:block}.prospect-row td span{color:#667085;font-size:11px;margin-top:3px}.pill{display:inline-block!important;border-radius:999px;padding:5px 8px;font-size:10px!important;font-weight:700;background:#f2f4f7;color:#344054}.signal-live_opportunity{background:#ecfdf3;color:#027a48}.signal-recent_demand_signal{background:#fff7ed;color:#c2410c}.signal-partnership_target{background:#eef2ff;color:#4338ca}.detail-panel{padding:20px;position:sticky;top:18px;max-height:calc(100vh - 36px);overflow:auto}.detail-header{display:flex;justify-content:space-between;gap:12px}.detail-header h2{margin:3px 0;font-size:22px}.detail-header p{margin:0;color:#667085}.score{width:64px;height:64px;border-radius:18px;background:#111827;color:#fff;display:grid;place-items:center;font-size:22px;font-weight:800}.score small{font-size:10px;margin-top:-18px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}.detail-grid>div{border:1px solid #eaecf0;border-radius:11px;padding:11px}.detail-grid span{display:block;font-size:10px;text-transform:uppercase;color:#667085}.detail-grid strong{display:block;font-size:12px;margin-top:5px;overflow-wrap:anywhere}.detail-section{border-top:1px solid #eaecf0;padding-top:17px;margin-top:17px}.detail-section h3{font-size:14px;margin:0 0 9px}.detail-section p{font-size:13px;color:#475467}.evidence-links{display:flex;gap:12px;font-size:12px}.detail-section small{color:#667085}.draft-box{background:#f8fafc;border:1px solid #e4e7ec;border-radius:12px;padding:12px}.draft-box pre{white-space:pre-wrap;font:12px/1.5 inherit;margin:0 0 10px}.action-forms{display:grid;gap:10px}.action-forms form{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}.action-forms label{font-size:11px;color:#667085}.action-forms .activity-form{grid-template-columns:1fr 1fr}.action-forms .activity-form .wide,.action-forms .activity-form button{grid-column:1/-1}.timeline{display:grid;gap:12px}.timeline article{display:grid;grid-template-columns:10px 1fr;gap:10px}.timeline article>span{width:8px;height:8px;border-radius:50%;background:#3157d5;margin-top:6px}.timeline strong{font-size:12px}.timeline p{margin:3px 0;color:#475467}.timeline small{font-size:10px}.lower-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.panel{overflow:hidden}.source-stats,.runs{padding:10px 18px 18px}.source-stats>div,.runs article{display:grid;grid-template-columns:1.6fr repeat(4,.7fr);gap:8px;padding:10px 0;border-bottom:1px solid #f0f1f3;font-size:12px}.source-stats span,.runs span{color:#667085}.runs article{grid-template-columns:1fr 1fr}.runs article>div{display:grid}.empty,.empty-detail{padding:30px;color:#667085;text-align:center}@media(max-width:1200px){.metrics{grid-template-columns:repeat(4,1fr)}.workspace{grid-template-columns:1fr}.detail-panel{position:static;max-height:none}}@media(max-width:800px){.app-shell{grid-template-columns:1fr}.sidebar{position:static;height:auto}.main{padding:16px}.toolbar{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.topbar{display:grid}.lower-grid{grid-template-columns:1fr}.source-stats>div{grid-template-columns:1fr 1fr}.detail-grid{grid-template-columns:1fr}}`;
}

function loginStyles(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#0f172a}*{box-sizing:border-box}body{margin:0}.login-shell{min-height:100vh;display:grid;place-items:center;padding:20px}.login-card{width:min(430px,100%);background:#fff;border-radius:22px;padding:34px;box-shadow:0 30px 80px rgba(0,0,0,.35)}.login-mark{width:52px;height:52px;border-radius:15px;background:#f8c838;display:grid;place-items:center;font-weight:900;font-size:24px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:#667085;margin:20px 0 5px}.login-card h1{margin:0 0 8px}.login-card p{color:#667085}.login-card label{display:grid;gap:7px;font-size:12px;font-weight:700;margin-top:22px}.login-card input{border:1px solid #d0d5dd;border-radius:10px;padding:12px;font:inherit}.login-card button{width:100%;margin-top:14px;border:0;border-radius:10px;background:#3157d5;color:#fff;padding:12px;font-weight:800;cursor:pointer}.login-error,#login-result{background:#fef3f2;color:#b42318;border-radius:9px;padding:10px;font:12px inherit;white-space:pre-wrap}`;
}
