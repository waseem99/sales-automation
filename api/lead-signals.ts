import type { LinkedInWarmSignalInput } from '@sales-automation/prospect-discovery';

export const maxDuration = 300;
const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      const cronAuthorized = Boolean(process.env.CRON_SECRET?.trim())
        && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET?.trim()}`;
      const actor = cronAuthorized ? 'authorized-lead-signal-intake' : await authorizedDashboardActor(request, sessionSecret);
      if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401 });
      if (!cronAuthorized && !['admin', 'waseem@codistan.org'].includes(actor)) {
        return Response.json({ error: 'Forbidden: lead-signal intake is restricted to Admin and Waseem.' }, { status: 403 });
      }

      const [neonState, linkedinEngine, upworkEngine] = await Promise.all([
        import('@sales-automation/neon-state'),
        import('../vercel/linkedin-warm-signal-engine.js'),
        import('../vercel/upwork-saved-search-engine.js'),
      ]);
      const databaseUrl = requireEnvironment('DATABASE_URL');
      await loadApprovedPortfolioIntoRuntime(databaseUrl);
      const state = await neonState.loadNeonAppState(databaseUrl);
      const pathname = new URL(request.url).pathname;
      const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html') || pathname === '/lead-signals';

      if (request.method === 'GET') {
        const recent = listRecentSignals(state.repository.listLeads());
        const payload = { ok: true, actor, recent, safeguards: safeguards() };
        return wantsHtml ? html(renderWorkspace(payload)) : Response.json(payload, { headers: { 'cache-control': 'no-store' } });
      }

      const payload = asObject(await parseBody(request));
      const sourceKind = optionalString(payload.sourceKind) ?? 'linkedin_manual';
      const now = new Date().toISOString();
      let result: unknown;
      if (sourceKind === 'upwork_email') {
        result = await upworkEngine.processUpworkSavedSearchBatch({
          state,
          emails: [{
            messageId: `manual-upwork-${Date.now()}`,
            subject: optionalString(payload.subject),
            text: requiredString(payload.text, 'text'),
            receivedAt: now,
            sourceUrl: optionalString(payload.sourceUrl),
          }],
          actor,
          generatedAt: now,
          enrichContacts: true,
          minimumFixedBudgetUsd: positiveNumber(process.env.UPWORK_MIN_FIXED_BUDGET_USD, 500),
          minimumHourlyRateUsd: positiveNumber(process.env.UPWORK_MIN_HOURLY_RATE_USD, 15),
          maximumAgeHours: positiveNumber(process.env.UPWORK_MAX_AGE_HOURS, 168),
        });
      } else {
        const signal: LinkedInWarmSignalInput = {
          origin: sourceKind === 'sales_navigator_email'
            ? 'sales_navigator_email'
            : sourceKind === 'linkedin_notification_email'
              ? 'linkedin_notification_email'
              : 'manual_post',
          text: requiredString(payload.text, 'text'),
          receivedAt: now,
          subject: optionalString(payload.subject),
          sourceUrl: optionalString(payload.sourceUrl),
          postedAt: validIso(payload.postedAt),
          authorName: optionalString(payload.authorName),
          authorRole: optionalString(payload.authorRole),
          companyName: optionalString(payload.companyName),
          companyWebsite: optionalString(payload.companyWebsite),
          country: optionalString(payload.country),
          region: optionalString(payload.region),
        };
        result = await linkedinEngine.processLinkedInWarmSignalBatch({ state, signals: [signal], actor, generatedAt: now, enrichContacts: true });
      }
      await neonState.persistNeonAppState(databaseUrl, state);
      const response = { ok: true, sourceKind, result, safeguards: safeguards() };
      return wantsHtml ? html(renderResult(response)) : Response.json(response, { status: 201 });
    } catch (error) {
      console.error('LEAD_SIGNALS_API_ERROR', error);
      const message = error instanceof Error ? error.message : String(error);
      const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
      return wantsHtml ? html(renderError(message), 500) : Response.json({ error: message }, { status: 500 });
    }
  },
};

function listRecentSignals(records: Array<{ lead: { id: string; title: string; source: string; discoverySource?: string; companyName?: string; owner?: string; pipelineStatus: string; sourceUrl?: string; updatedAt: string; rawPayload?: unknown } }>) {
  return records
    .filter((record) => ['upwork', 'linkedin', 'sales_navigator'].includes(record.lead.source))
    .map((record) => {
      const raw = asObject(record.lead.rawPayload);
      const linkedin = asObject(raw.linkedinWarmSignal);
      const upwork = asObject(raw.upworkSavedSearchQuality);
      return {
        leadId: record.lead.id,
        title: record.lead.title,
        companyName: record.lead.companyName,
        source: record.lead.discoverySource ?? record.lead.source,
        owner: record.lead.owner,
        pipelineStatus: record.lead.pipelineStatus,
        sourceUrl: record.lead.sourceUrl,
        score: numberValue(linkedin.score) ?? numberValue(upwork.score),
        band: optionalString(linkedin.band) ?? optionalString(upwork.band),
        updatedAt: record.lead.updatedAt,
      };
    })
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 50);
}

function renderWorkspace(input: { actor: string; recent: ReturnType<typeof listRecentSignals> }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lead Signals</title><style>${styles()}</style></head><body><main>
  <header><div><p class="eyebrow">Unified controlled intake</p><h1>Lead Signals</h1><p>Review Upwork saved-search alerts, LinkedIn posts and Sales Navigator signals in one place. Every external action remains human-reviewed.</p></div><nav><a href="/priorities">Priorities</a><a href="/operations">Operations</a><a href="/prospects">Prospects</a></nav></header>
  <section class="notice"><strong>Shared mailbox, isolated processing.</strong> Upwork and LinkedIn use separate IMAP searches and quality rules, so one source cannot block the other. No application, proposal, connection request or message is sent automatically.</section>
  <section class="panel"><h2>Add a signal manually</h2><form method="post" action="/api/lead-signals">
  <label>Source<select name="sourceKind"><option value="upwork_email">Upwork saved-search alert</option><option value="linkedin_manual">LinkedIn post</option><option value="sales_navigator_email">Sales Navigator alert</option><option value="linkedin_notification_email">LinkedIn notification</option></select></label>
  <label>Subject<input name="subject"></label><label class="wide">Alert or post text<textarea name="text" rows="9" required></textarea></label>
  <label class="wide">Original source URL<input name="sourceUrl" type="url"></label><label>Author name<input name="authorName"></label><label>Author role<input name="authorRole"></label><label>Company<input name="companyName"></label><label>Company website<input name="companyWebsite" type="url"></label><label>Country<input name="country"></label><label>Posted at<input name="postedAt" type="datetime-local"></label>
  <button class="wide">Qualify and add</button></form></section>
  <section class="panel"><div class="title"><h2>Recent signals</h2><span>${input.recent.length}</span></div>${renderRecent(input.recent)}</section>
  <footer>Signed in as ${escapeHtml(input.actor)}.</footer></main></body></html>`;
}

function renderRecent(items: ReturnType<typeof listRecentSignals>): string {
  if (!items.length) return '<p>No Upwork or LinkedIn signals have been stored yet.</p>';
  return `<div class="table"><table><thead><tr><th>Signal</th><th>Source</th><th>Band</th><th>Score</th><th>Owner</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${items.map((item) => `<tr><td><a href="/prospects?leadId=${encodeURIComponent(item.leadId)}">${escapeHtml(item.companyName ?? item.title)}</a></td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(label(item.band ?? 'research'))}</td><td>${item.score ?? '—'}</td><td>${escapeHtml(item.owner ?? 'Unassigned')}</td><td>${escapeHtml(label(item.pipelineStatus))}</td><td>${item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a>` : 'Email evidence'}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderResult(input: { sourceKind: string; result: unknown }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lead Signal Result</title><style>${styles()}</style></head><body><main><p class="eyebrow">Completed</p><h1>Lead signal processed</h1><p>Source: ${escapeHtml(label(input.sourceKind))}</p><pre>${escapeHtml(JSON.stringify(input.result, null, 2))}</pre><nav><a href="/lead-signals">Return to signals</a><a href="/priorities">Priority queue</a></nav></main></body></html>`;
}
function renderError(message: string): string { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lead Signal Error</title><style>${styles()}</style></head><body><main><h1>Signal intake could not start</h1><pre>${escapeHtml(message)}</pre><nav><a href="/lead-signals">Retry</a><a href="/prospects">Return to prospects</a></nav></main></body></html>`; }
function safeguards() { return { authenticatedLinkedInScraping: false, automatedLinkedInMessaging: false, automatedUpworkApplication: false, humanReviewRequired: true }; }

async function loadApprovedPortfolioIntoRuntime(databaseUrl: string): Promise<void> {
  const [catalog, starters, fixtures] = await Promise.all([
    import('@sales-automation/neon-state/portfolio-catalog'),
    import('../vercel/approved-portfolio.js'),
    import('@sales-automation/fixtures'),
  ]);
  await catalog.ensurePortfolioCatalogSeeded(databaseUrl, starters.approvedStarterPortfolioItems);
  const approved = await catalog.loadApprovedPortfolioCatalog(databaseUrl);
  catalog.replacePortfolioArray(fixtures.samplePortfolioItems, catalog.asPortfolioItems(approved));
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
async function validSession(token: string | undefined, secret: string): Promise<boolean> { const match=token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/); if(!match?.[1]||!match[2]) return false; const expiresAt=Number(match[1]); return Number.isFinite(expiresAt)&&expiresAt>Math.floor(Date.now()/1000)&&await safeEqual(token??'',await sessionTokenFor(expiresAt,secret)); }
async function sessionTokenFor(expiresAt: number, secret: string): Promise<string> { const {createHmac}=await import('node:crypto'); return `${expiresAt}.${createHmac('sha256',secret).update(`admin:${expiresAt}`).digest('base64url')}`; }
async function actorTokenFor(identifier: string, secret: string): Promise<string> { const {createHmac}=await import('node:crypto'); const encoded=Buffer.from(identifier,'utf8').toString('base64url'); return `${encoded}.${createHmac('sha256',secret).update(`actor:${encoded}`).digest('base64url')}`; }
async function safeEqual(left: string, right: string): Promise<boolean> { const {timingSafeEqual}=await import('node:crypto'); const a=Buffer.from(left); const b=Buffer.from(right); return a.length===b.length&&timingSafeEqual(a,b); }
function parseCookies(value: string): Record<string,string> { const result:Record<string,string>={}; for(const part of value.split(';')){const [name,...rest]=part.trim().split('='); if(name) result[name]=rest.join('=');} return result; }
async function parseBody(request: Request): Promise<unknown> { const raw=await request.text(); if(!raw) return {}; if(raw.length>120000) throw new Error('Signal payload is too large.'); const type=request.headers.get('content-type')?.toLowerCase()??''; if(type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw)); try{return JSON.parse(raw);}catch{return Object.fromEntries(new URLSearchParams(raw));} }
function asObject(value: unknown): Record<string,unknown> { return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}; }
function requiredString(value: unknown, field: string): string { const item=optionalString(value); if(!item) throw new Error(`${field} is required.`); return item; }
function optionalString(value: unknown): string|undefined { return typeof value==='string'&&value.trim()?value.trim():undefined; }
function validIso(value: unknown): string|undefined { const item=optionalString(value); return item&&Number.isFinite(Date.parse(item))?new Date(item).toISOString():undefined; }
function numberValue(value: unknown): number|undefined { return typeof value==='number'&&Number.isFinite(value)?value:undefined; }
function positiveNumber(value: string|undefined, fallback: number): number { const parsed=Number(value); return Number.isFinite(parsed)&&parsed>0?parsed:fallback; }
function html(value: string,status=200): Response { return new Response(value,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','x-content-type-options':'nosniff'}}); }
function label(value: string): string { return value.replace(/_/g,' ').replace(/\b\w/g,(letter)=>letter.toUpperCase()); }
function escapeHtml(value: unknown): string { return String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character)); }
function requireEnvironment(name: string): string { const value=process.env[name]; if(!value?.trim()) throw new Error(`${name} is required.`); return value.trim(); }
function styles(): string { return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb}*{box-sizing:border-box}body{margin:0}main{max-width:1200px;margin:32px auto;padding:0 20px}header{display:flex;justify-content:space-between;gap:20px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}h1,h2{margin:.2rem 0}p,footer{color:#667085}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#3157d5}.notice,.panel{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:18px;margin:16px 0}.notice{border-color:#b9c8f5;background:#f5f7ff}form{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:grid;gap:6px;font-size:12px;font-weight:750}.wide{grid-column:1/-1}input,textarea,select{border:1px solid #d0d5dd;border-radius:9px;padding:10px;font:inherit}button{border:0;border-radius:9px;background:#3157d5;color:#fff;padding:12px;font-weight:800}.table{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #eef0f3;font-size:12px}.title{display:flex;justify-content:space-between}pre{white-space:pre-wrap;background:#fff;border:1px solid #e4e7ec;border-radius:10px;padding:12px}@media(max-width:760px){header{display:block}form{grid-template-columns:1fr}.wide{grid-column:auto}}`; }
