export const maxDuration = 300;

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';

interface TenderViewRow {
  id: string;
  buyer: string;
  title: string;
  country: string;
  sector: string;
  portal: string;
  reference: string;
  type: string;
  deadline?: string;
  daysRemaining?: number;
  score: number;
  recommendation: string;
  recommendationReason: string;
  risks: string[];
  owner: string;
  status: string;
  sourceUrl?: string;
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      const actor = await authorizedDashboardActor(request, sessionSecret);
      if (!actor) return new Response('', { status: 302, headers: { location: '/login', 'cache-control': 'no-store' } });

      const [neonModule, discovery] = await Promise.all([
        import('@sales-automation/neon-state'),
        import('@sales-automation/prospect-discovery'),
      ]);
      const databaseUrl = neonModule.requireDatabaseUrl(process.env.DATABASE_URL);
      const state = await neonModule.loadNeonAppState(databaseUrl);
      const canViewAll = actor === 'admin' || actor === 'waseem@codistan.org';
      const visibleOwners = actor === 'talha.bashir@codistan.org'
        ? ['talha.bashir@codistan.org', 'danishkhalid@codistan.org', 'hibasohail@codistan.org', 'bilalahmed@codistan.org']
        : [actor];
      const rows: TenderViewRow[] = state.repository.listLeads()
        .filter((record) => Boolean(record.lead.tender) || record.lead.source === 'public_procurement')
        .filter((record) => discovery.validateStoredTenderLead(record.lead).qualified)
        .filter((record) => canViewAll || visibleOwners.includes(record.lead.owner?.trim().toLowerCase() ?? ''))
        .map((record) => ({
          id: record.lead.id,
          buyer: record.lead.companyName ?? 'Procurement buyer',
          title: record.lead.title,
          country: record.lead.country ?? 'Unconfirmed',
          sector: record.lead.tender?.sector ?? 'public',
          portal: record.lead.tender?.portal ?? record.lead.discoverySource ?? 'Public procurement',
          reference: record.lead.tender?.reference ?? '—',
          type: record.lead.tender?.opportunityType ?? 'other',
          deadline: record.lead.tender?.deadline,
          daysRemaining: record.lead.tender?.daysRemaining,
          score: record.lead.tender?.closeabilityScore ?? record.lead.score?.total ?? 0,
          recommendation: record.lead.tender?.recommendation ?? 'review_now',
          recommendationReason: record.lead.tender?.recommendationReason ?? 'Review the source notice and mandatory eligibility before bidding.',
          risks: record.lead.tender?.riskFlags ?? [],
          owner: record.lead.owner ?? 'Unassigned',
          status: record.lead.pipelineStatus,
          sourceUrl: record.lead.evidenceUrl ?? record.lead.sourceUrl,
        }))
        .sort(compareRows);

      return request.headers.get('accept')?.includes('application/json')
        ? Response.json({ ok: true, actor, total: rows.length, rows })
        : html(renderTenderPipeline(rows, actor, canViewAll));
    } catch (error) {
      console.error('TENDER_PIPELINE_ERROR', error);
      return html(renderError(error instanceof Error ? error.message : String(error)), 500);
    }
  },
};

function renderTenderPipeline(rows: TenderViewRow[], actor: string, canRefresh: boolean): string {
  const priority = rows.filter((row) => row.recommendation === 'priority_bid').length;
  const review = rows.filter((row) => row.recommendation === 'review_now').length;
  const partner = rows.filter((row) => row.recommendation === 'partner_or_consortium').length;
  const dueSevenDays = rows.filter((row) => row.daysRemaining !== undefined && row.daysRemaining >= 0 && row.daysRemaining <= 7).length;
  const cards = [
    metric('Total tenders', rows.length),
    metric('Priority bids', priority),
    metric('Review now', review),
    metric('Partner route', partner),
    metric('Due within 7 days', dueSevenDays),
  ].join('');
  const tableRows = rows.map((row) => `<tr>
    <td><a href="/prospects?leadId=${encodeURIComponent(row.id)}"><strong>${escapeHtml(row.buyer)}</strong><span>${escapeHtml(shorten(row.title, 105))}</span></a></td>
    <td><strong>${escapeHtml(row.country)}</strong><span>${escapeHtml(label(row.sector))}</span></td>
    <td><strong>${escapeHtml(row.portal)}</strong><span>${escapeHtml(row.reference)} · ${escapeHtml(label(row.type))}</span></td>
    <td><strong>${row.deadline ? escapeHtml(formatDate(row.deadline)) : 'Confirm deadline'}</strong><span>${daysLabel(row.daysRemaining)}</span></td>
    <td><span class="score score-${scoreBand(row.score)}">${row.score}</span></td>
    <td><span class="recommendation recommendation-${row.recommendation}">${escapeHtml(label(row.recommendation))}</span><small>${escapeHtml(shorten(row.recommendationReason, 150))}</small></td>
    <td><strong>${escapeHtml(row.owner)}</strong><span>${escapeHtml(label(row.status))}</span></td>
    <td>${row.risks.length ? `<ul>${row.risks.slice(0, 3).map((risk) => `<li>${escapeHtml(risk)}</li>`).join('')}</ul>` : '<span class="muted">No major risk extracted</span>'}</td>
    <td><a class="open" href="/prospects?leadId=${encodeURIComponent(row.id)}">Manage</a>${row.sourceUrl ? `<a class="open secondary" href="${escapeAttribute(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}</td>
  </tr>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Codistan Tender & RFP Pipeline</title><style>${styles()}</style></head><body>
  <main class="shell">
    <header><div><p class="eyebrow">Formal procurement intelligence</p><h1>Tender & RFP Pipeline</h1><p>Pakistan, Canada, international development, private-sector and nonprofit software opportunities. Formal opportunities are routed to Jawad for bid/no-bid review.</p><div class="identity">Signed in as ${escapeHtml(actor)}</div></div><div class="actions"><a class="button ghost" href="/prospects">All prospects</a><a class="button ghost" href="/prospects?owner=jawad.jutt%40codistan.org">Jawad’s queue</a>${canRefresh ? '<button id="refresh-tenders" class="button primary">Refresh tenders & RFPs</button>' : ''}</div></header>
    <section class="metrics">${cards}</section>
    <section class="status"><strong id="refresh-status">${rows.length ? `${rows.length} validated formal opportunities loaded.` : 'No validated formal opportunities stored yet.'}</strong><span>Scheduled refresh runs every six hours. Untrusted, tutorial, dictionary, job-board and non-procurement results are rejected.</span></section>
    <section class="table-card"><div class="table-heading"><div><h2>Qualified procurement opportunities</h2><p>Sorted by bid recommendation, closeability and deadline.</p></div><input id="tender-search" type="search" placeholder="Search buyer, title, portal, country or owner"/></div><div class="table-wrap"><table><thead><tr><th>Buyer / requirement</th><th>Market</th><th>Portal / reference</th><th>Deadline</th><th>Score</th><th>Bid recommendation</th><th>Owner / status</th><th>Risks</th><th>Actions</th></tr></thead><tbody id="tender-rows">${tableRows || '<tr><td colspan="9" class="empty">Run the tender refresh to collect qualified opportunities.</td></tr>'}</tbody></table></div></section>
  </main><script>${script(canRefresh)}</script></body></html>`;
}

function script(canRefresh: boolean): string {
  return `
const search=document.getElementById('tender-search');
search?.addEventListener('input',()=>{const term=search.value.trim().toLowerCase();document.querySelectorAll('#tender-rows tr').forEach(row=>{row.hidden=Boolean(term)&&!row.textContent.toLowerCase().includes(term);});});
${canRefresh ? `document.getElementById('refresh-tenders')?.addEventListener('click',async()=>{const button=document.getElementById('refresh-tenders'),status=document.getElementById('refresh-status');button.disabled=true;button.textContent='Checking verified sources…';try{const response=await fetch('/api/tender-discovery',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const data=await response.json();if(!response.ok)throw new Error(data.error||data.detail||'Tender discovery failed');status.textContent=(data.run.newTenderCount+' new tenders; '+data.run.tenderCandidateCount+' qualified; '+data.rejectedCandidateCount+' rejected; '+data.removedFalsePositiveCount+' false positives removed.');button.textContent='Reloading pipeline…';setTimeout(()=>location.reload(),900);}catch(error){status.textContent=error.message;button.disabled=false;button.textContent='Refresh tenders & RFPs';}});` : ''}
`;
}

function styles(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fa}*{box-sizing:border-box}body{margin:0}.shell{max-width:1800px;margin:auto;padding:28px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;background:#fff;border:1px solid #e4e7ec;border-radius:18px;padding:24px;box-shadow:0 10px 28px rgba(16,24,40,.05)}h1{margin:2px 0 8px;font-size:30px}h2{margin:0 0 4px}p{margin:0;color:#667085;line-height:1.5}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#3157d5}.identity{margin-top:12px;font-size:12px;color:#475467}.actions{display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end}.button{border:0;border-radius:10px;padding:11px 14px;font-weight:800;text-decoration:none;cursor:pointer;font:inherit}.primary{background:#3157d5;color:#fff}.ghost{background:#fff;color:#344054;border:1px solid #d0d5dd}.metrics{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:12px;margin:18px 0}.metric{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:16px}.metric span{display:block;color:#667085;font-size:12px}.metric strong{display:block;font-size:26px;margin-top:5px}.status{display:flex;justify-content:space-between;gap:20px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:13px 16px;margin-bottom:18px}.status span{color:#667085;font-size:12px}.table-card{background:#fff;border:1px solid #e4e7ec;border-radius:18px;overflow:hidden}.table-heading{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:18px 20px;border-bottom:1px solid #e4e7ec}.table-heading input{width:min(420px,100%);border:1px solid #d0d5dd;border-radius:10px;padding:11px;font:inherit}.table-wrap{overflow:auto;max-height:72vh}table{border-collapse:collapse;width:100%;min-width:1500px}th,td{text-align:left;vertical-align:top;padding:13px 14px;border-bottom:1px solid #eef0f3;font-size:12px}th{position:sticky;top:0;background:#f9fafb;color:#667085;text-transform:uppercase;letter-spacing:.04em;font-size:10px;z-index:2}td strong,td span,td small{display:block}td span,td small{margin-top:4px;color:#667085;line-height:1.4}td a{color:#1d4ed8;text-decoration:none}.score{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;font-size:16px;font-weight:900}.score-high{background:#ecfdf3;color:#027a48}.score-medium{background:#fff7ed;color:#c2410c}.score-low{background:#fef2f2;color:#b42318}.recommendation{display:inline-flex!important;width:max-content;border-radius:999px;padding:5px 8px;font-weight:800}.recommendation-priority_bid{background:#ecfdf3;color:#027a48}.recommendation-review_now{background:#eff6ff;color:#1d4ed8}.recommendation-partner_or_consortium{background:#fff7ed;color:#c2410c}.recommendation-reject{background:#fef2f2;color:#b42318}ul{margin:0;padding-left:16px;color:#667085}.open{display:inline-block;padding:7px 9px;border-radius:8px;background:#3157d5;color:#fff!important;font-weight:800;margin:0 4px 5px 0}.open.secondary{background:#fff;color:#344054!important;border:1px solid #d0d5dd}.muted,.empty{color:#98a2b3}.empty{text-align:center;padding:40px}@media(max-width:1100px){header,.table-heading,.status{flex-direction:column}.actions{justify-content:flex-start}.metrics{grid-template-columns:repeat(2,1fr)}}@media(max-width:640px){.shell{padding:12px}.metrics{grid-template-columns:1fr}}`;
}

function metric(labelText: string, value: number): string {
  return `<article class="metric"><span>${escapeHtml(labelText)}</span><strong>${value}</strong></article>`;
}

function compareRows(left: TenderViewRow, right: TenderViewRow): number {
  const order: Record<string, number> = { priority_bid: 0, review_now: 1, partner_or_consortium: 2, reject: 3 };
  const recommendation = (order[left.recommendation] ?? 9) - (order[right.recommendation] ?? 9);
  if (recommendation !== 0) return recommendation;
  if (right.score !== left.score) return right.score - left.score;
  return (left.deadline ?? '9999').localeCompare(right.deadline ?? '9999');
}

function daysLabel(value: number | undefined): string {
  if (value === undefined) return 'Deadline not extracted';
  if (value < 0) return 'Expired';
  if (value === 0) return 'Due today';
  return `${value} day${value === 1 ? '' : 's'} remaining`;
}

function scoreBand(value: number): 'high' | 'medium' | 'low' {
  return value >= 80 ? 'high' : value >= 65 ? 'medium' : 'low';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' }).format(date);
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shorten(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}…`;
}

function renderError(message: string): string {
  return `<!doctype html><html><body style="font-family:system-ui;background:#f4f6fa;padding:40px"><main style="max-width:760px;margin:auto;background:#fff;padding:28px;border-radius:16px"><h1>Tender pipeline could not load</h1><p>${escapeHtml(message)}</p><p><a href="/prospects">Return to Prospect Desk</a></p></main></body></html>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' } });
}

async function authorizedDashboardActor(request: Request, secret: string): Promise<string | undefined> {
  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  if (!(await validSession(cookies[SESSION_COOKIE], secret))) return undefined;
  const actorToken = cookies[ACTOR_COOKIE];
  if (!actorToken) return 'admin';
  const match = actorToken.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const identifier = Buffer.from(match[1], 'base64url').toString('utf8').trim().toLowerCase();
  return await safeEqual(actorToken, await actorTokenFor(identifier, secret)) ? identifier : undefined;
}

async function validSession(token: string | undefined, secret: string): Promise<boolean> {
  const match = token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  return Number.isFinite(expiresAt) && expiresAt > Math.floor(Date.now() / 1_000) && await safeEqual(token ?? '', await sessionTokenFor(expiresAt, secret));
}

async function sessionTokenFor(expiresAt: number, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  return `${expiresAt}.${createHmac('sha256', secret).update(`admin:${expiresAt}`).digest('base64url')}`;
}

async function actorTokenFor(identifier: string, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const encoded = Buffer.from(identifier, 'utf8').toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(`actor:${encoded}`).digest('base64url')}`;
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const { timingSafeEqual } = await import('node:crypto');
  const leftBuffer = Buffer.from(left); const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.split(';')) { const [name, ...rest] = part.trim().split('='); if (name) result[name] = rest.join('='); }
  return result;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
