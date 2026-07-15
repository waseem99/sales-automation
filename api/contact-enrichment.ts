export const maxDuration = 300;

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';
const LOCK_NAME = 'verified-contact-enrichment';

export default {
  async fetch(request: Request): Promise<Response> {
    let databaseUrl: string | undefined;
    let lockToken: string | undefined;
    let neonModule: Awaited<ReturnType<typeof loadNeonModule>> | undefined;
    try {
      if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      const cronAuthorized = Boolean(process.env.CRON_SECRET?.trim())
        && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET?.trim()}`;
      const actor = cronAuthorized ? 'authorized-contact-enrichment' : await authorizedDashboardActor(request, sessionSecret);
      if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401 });
      if (!cronAuthorized && !['admin', 'waseem@codistan.org'].includes(actor)) {
        return Response.json({ error: 'Forbidden: contact enrichment is restricted to Admin and Waseem.' }, { status: 403 });
      }

      const url = new URL(request.url);
      if (request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html') && !url.searchParams.has('run')) {
        return html(renderPage());
      }

      const payload = request.method === 'POST' ? asObject(await parseBody(request)) : {};
      const requestedLeadId = optionalString(payload.leadId) ?? optionalString(url.searchParams.get('leadId'));
      const requestedMaximum = positiveInteger(payload.maxRecords ?? url.searchParams.get('maxRecords'), 20, 50);

      const [{ randomUUID }, loadedNeon, discovery, evaluator, fixtures, catalog, starters] = await Promise.all([
        import('node:crypto'),
        loadNeonModule(),
        import('@sales-automation/prospect-discovery'),
        import('@sales-automation/evaluator'),
        import('@sales-automation/fixtures'),
        import('@sales-automation/neon-state/portfolio-catalog'),
        import('../vercel/approved-portfolio.js'),
      ]);
      neonModule = loadedNeon;
      databaseUrl = neonModule.requireDatabaseUrl(process.env.DATABASE_URL);
      lockToken = randomUUID();
      const locked = await neonModule.acquireNamedRunLock(databaseUrl, LOCK_NAME, lockToken, 15);
      if (!locked) return Response.json({ ok: true, skipped: true, reason: 'Another contact-enrichment run is active.' });

      await catalog.ensurePortfolioCatalogSeeded(databaseUrl, starters.approvedStarterPortfolioItems);
      const approvedPortfolio = await catalog.loadApprovedPortfolioCatalog(databaseUrl);
      catalog.replacePortfolioArray(fixtures.samplePortfolioItems, catalog.asPortfolioItems(approvedPortfolio));

      const state = await neonModule.loadNeonAppState(databaseUrl);
      const before = new Map(state.repository.listLeads().map((record) => [record.lead.id, JSON.stringify(record.lead)]));
      const enrichment = await discovery.enrichRepositoryContacts({
        repository: state.repository,
        fetchImpl: globalThis.fetch,
        maxRecords: requestedMaximum,
        leadIds: requestedLeadId ? [requestedLeadId] : undefined,
        actor,
      });

      const changedIds = state.repository.listLeads()
        .filter((record) => before.get(record.lead.id) !== JSON.stringify(record.lead))
        .map((record) => record.lead.id);
      for (const leadId of changedIds) {
        const record = state.repository.getLead(leadId);
        if (!record) continue;
        state.repository.saveEvaluation(evaluator.evaluateLead({
          lead: record.lead,
          portfolioItems: fixtures.samplePortfolioItems,
          generatedAt: new Date().toISOString(),
        }), actor);
      }
      await neonModule.persistNeonAppState(databaseUrl, state);

      const response = {
        ok: true,
        actor,
        requestedLeadId: requestedLeadId ?? null,
        maxRecords: requestedMaximum,
        approvedPortfolioCount: approvedPortfolio.length,
        enrichment,
        changedLeadIds: changedIds,
        rescored: changedIds.length,
        duplicatesCreated: 0,
      };
      if ((request.headers.get('accept') ?? '').includes('text/html')) return html(renderResult(response));
      return Response.json(response);
    } catch (error) {
      console.error('CONTACT_ENRICHMENT_ERROR', error);
      return Response.json({ error: 'Contact enrichment failed.', detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
    } finally {
      if (neonModule && databaseUrl && lockToken) {
        await neonModule.releaseNamedRunLock(databaseUrl, LOCK_NAME, lockToken).catch((error: unknown) => {
          console.error('CONTACT_ENRICHMENT_LOCK_RELEASE_ERROR', error);
        });
      }
    }
  },
};

async function loadNeonModule() { return import('@sales-automation/neon-state'); }

function renderPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verified Contact Enrichment</title><style>${styles()}</style></head><body><main><p class="eyebrow">Admin/Waseem operation</p><h1>Verified Contact Enrichment</h1><p>Check public company pages, verify same-domain business routes, reject personal emails and rescore updated records. No authenticated platform scraping is used.</p><form method="post"><label>Lead ID <span>Optional—leave blank for a bounded backfill</span><input name="leadId"></label><label>Maximum records <input name="maxRecords" type="number" min="1" max="50" value="20"></label><button>Run enrichment</button></form><nav><a href="/priorities">Priority queue</a><a href="/operations">Operations health</a><a href="/prospects">Prospect Desk</a></nav></main></body></html>`;
}

function renderResult(result: { enrichment: { checked: number; updated: number; ready: number; partial: number; researchRequired: number; errors: unknown[] }; changedLeadIds: string[]; rescored: number }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enrichment Result</title><style>${styles()}</style></head><body><main><p class="eyebrow">Completed</p><h1>Contact enrichment result</h1><section class="metrics"><article><strong>${result.enrichment.checked}</strong><span>Checked</span></article><article><strong>${result.enrichment.updated}</strong><span>Updated</span></article><article><strong>${result.enrichment.ready}</strong><span>Ready</span></article><article><strong>${result.enrichment.partial}</strong><span>Partial</span></article></section><p>${result.enrichment.researchRequired} require further research; ${result.enrichment.errors.length} errors; ${result.rescored} records rescored.</p><details><summary>Changed lead IDs</summary><pre>${escapeHtml(result.changedLeadIds.join('\n') || 'None')}</pre></details><nav><a href="/api/contact-enrichment">Run again</a><a href="/priorities">Priority queue</a><a href="/operations">Operations health</a></nav></main></body></html>`;
}

async function authorizedDashboardActor(request: Request, secret: string): Promise<string | undefined> {
  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  if (!(await validSession(cookies[SESSION_COOKIE], secret))) return undefined;
  const actorToken = cookies[ACTOR_COOKIE];
  if (!actorToken) return 'admin';
  const match = actorToken.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  const identifier = Buffer.from(match[1], 'base64url').toString('utf8').trim().toLowerCase();
  const expected = await actorTokenFor(identifier, secret);
  return await safeEqual(actorToken, expected) ? identifier : undefined;
}

async function validSession(token: string | undefined, secret: string): Promise<boolean> {
  const match = token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) return false;
  return safeEqual(token ?? '', await sessionTokenFor(expiresAt, secret));
}

async function sessionTokenFor(expiresAt: number, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha256', secret).update(`admin:${expiresAt}`).digest('base64url');
  return `${expiresAt}.${signature}`;
}

async function actorTokenFor(identifier: string, secret: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const encoded = Buffer.from(identifier, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(`actor:${encoded}`).digest('base64url');
  return `${encoded}.${signature}`;
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const { timingSafeEqual } = await import('node:crypto');
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function parseBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw) return {};
  if (raw.length > 50_000) throw new Error('Request payload is too large.');
  const type = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
}

function parseCookies(value: string): Record<string, string> { const result: Record<string,string> = {}; for (const part of value.split(';')) { const [name,...rest]=part.trim().split('='); if(name) result[name]=rest.join('='); } return result; }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function positiveInteger(value: unknown, fallback: number, maximum: number): number { const parsed=Number.parseInt(String(value??''),10); return Number.isInteger(parsed)&&parsed>0?Math.min(parsed,maximum):fallback; }
function requireEnvironment(name: string): string { const value=process.env[name]; if(!value?.trim()) throw new Error(`${name} is required.`); return value.trim(); }
function html(value: string): Response { return new Response(value,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY'}}); }
function escapeHtml(value: unknown): string { return String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character)); }
function styles(): string { return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:50px auto;background:#fff;border:1px solid #e4e7ec;border-radius:18px;padding:28px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}p{color:#667085}form{display:grid;gap:14px;margin:24px 0}label{display:grid;gap:6px;font-weight:750}label span{font-size:11px;color:#667085;font-weight:400}input{border:1px solid #d0d5dd;border-radius:9px;padding:10px;font:inherit}button{border:0;border-radius:9px;background:#3157d5;color:#fff;padding:11px;font:inherit;font-weight:800;cursor:pointer}nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}a{color:#3157d5}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metrics article{background:#f8fafc;border-radius:10px;padding:14px}.metrics strong{display:block;font-size:24px}.metrics span{font-size:11px;color:#667085}pre{white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:8px}@media(max-width:650px){main{margin:15px}.metrics{grid-template-columns:1fr 1fr}}`; }
