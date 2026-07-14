export const maxDuration = 300;

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (!['GET', 'POST'].includes(request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const sessionSecret = requireEnvironment('SESSION_SECRET');
      const actor = await authorizedDashboardActor(request, sessionSecret);
      if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401 });
      if (!['admin', 'waseem@codistan.org'].includes(actor)) {
        return Response.json({ error: 'Forbidden: re-engagement intake is restricted to Admin and Waseem.' }, { status: 403 });
      }

      const [neonModule, evaluator, fixtures, catalog, starters, reengagement] = await Promise.all([
        import('@sales-automation/neon-state'),
        import('@sales-automation/evaluator'),
        import('@sales-automation/fixtures'),
        import('@sales-automation/neon-state/portfolio-catalog'),
        import('../vercel/approved-portfolio.js'),
        import('../packages/prospect-discovery/src/reengagement.js'),
      ]);
      const databaseUrl = neonModule.requireDatabaseUrl(process.env.DATABASE_URL);
      await catalog.ensurePortfolioCatalogSeeded(databaseUrl, starters.approvedStarterPortfolioItems);
      const approvedPortfolio = await catalog.loadApprovedPortfolioCatalog(databaseUrl);
      catalog.replacePortfolioArray(fixtures.samplePortfolioItems, catalog.asPortfolioItems(approvedPortfolio));
      const state = await neonModule.loadNeonAppState(databaseUrl);

      if (request.method === 'GET') {
        const records = state.repository.listLeads().filter((record) => {
          const raw = asObject(record.lead.rawPayload);
          return Boolean(asObject(raw.reengagement));
        });
        return html(renderPage(records));
      }

      const payload = normalizePayload(await parseBody(request));
      const normalized = reengagement.normalizeReengagementInput(payload);
      const match = reengagement.findReengagementMatch(state.repository.listLeads(), normalized);
      const now = new Date().toISOString();
      const lead = match
        ? reengagement.mergeReengagementIntoLead(match.record.lead, normalized, actor, now)
        : reengagement.buildReengagementLead(normalized, actor, now);

      state.repository.upsertLead(lead, actor);
      const evaluation = evaluator.evaluateLead({
        lead,
        portfolioItems: fixtures.samplePortfolioItems,
        generatedAt: now,
      });
      const bestProof = evaluation.portfolioMatches[0]?.portfolioItem;
      const proofSafeLead = {
        ...lead,
        materialsToShare: bestProof
          ? `${bestProof.projectName}: use only its approved public/anonymized wording and healthy asset links.`
          : `${normalized.portfolioIdentity} approved proof is not yet matched; treat this as a research gap.`,
        recommendedNextAction: evaluation.recommendedNextAction,
        updatedAt: now,
      };
      state.repository.saveEvaluation({ ...evaluation, lead: proofSafeLead }, actor);
      state.repository.addNote(
        proofSafeLead.id,
        `reengagement::${normalized.relationshipType}::${normalized.relationshipStrength}::${normalized.opportunityStatus}::${match ? `updated-${match.reason}` : 'created'}`,
        actor,
      );
      await neonModule.persistNeonAppState(databaseUrl, state);

      const response = {
        ok: true,
        created: !match,
        updatedExisting: Boolean(match),
        dedupeReason: match?.reason ?? null,
        leadId: proofSafeLead.id,
        relationshipType: normalized.relationshipType,
        relationshipStrength: normalized.relationshipStrength,
        currentIntentConfirmed: normalized.opportunityStatus === 'live_opportunity',
        serviceCategory: normalized.serviceCategory,
        serviceOffer: normalized.serviceOffer,
        owner: proofSafeLead.owner ?? null,
        nextFollowUpAt: proofSafeLead.nextFollowUpAt ?? null,
        matchedProof: bestProof?.projectName ?? null,
        missingData: (asObject(asObject(proofSafeLead.rawPayload).reengagement).brief as { missingData?: string[] } | undefined)?.missingData ?? [],
        automaticSendingAllowed: false,
        prospectUrl: `/prospects?leadId=${encodeURIComponent(proofSafeLead.id)}`,
      };
      if ((request.headers.get('accept') ?? '').includes('text/html')) return html(renderResult(response));
      return Response.json(response, { status: match ? 200 : 201 });
    } catch (error) {
      console.error('REENGAGEMENT_INTAKE_ERROR', error);
      const detail = error instanceof Error ? error.message : String(error);
      if ((request.headers.get('accept') ?? '').includes('text/html')) return html(renderError(detail), 400);
      return Response.json({ error: 'Re-engagement intake failed.', detail }, { status: 400 });
    }
  },
};

function normalizePayload(value: unknown) {
  const payload = asObject(value);
  return {
    relationshipType: requiredString(payload.relationshipType, 'relationshipType'),
    organizationName: requiredString(payload.organizationName, 'organizationName'),
    officialWebsite: optionalString(payload.officialWebsite),
    priorEngagementSummary: requiredString(payload.priorEngagementSummary, 'priorEngagementSummary'),
    lastInteractionAt: optionalString(payload.lastInteractionAt),
    approvedServicesDelivered: listValue(payload.approvedServicesDelivered),
    currentOpportunitySignal: optionalString(payload.currentOpportunitySignal),
    crossSellHypothesis: optionalString(payload.crossSellHypothesis),
    evidenceSourceUrl: optionalString(payload.evidenceSourceUrl),
    contactName: optionalString(payload.contactName),
    contactRole: optionalString(payload.contactRole),
    contactEmail: optionalString(payload.contactEmail),
    contactFormUrl: optionalString(payload.contactFormUrl),
    owner: optionalString(payload.owner),
    followUpAt: optionalString(payload.followUpAt),
    internalNotes: optionalString(payload.internalNotes),
  } as never;
}

function renderPage(records: Array<{ lead: { id: string; companyName?: string; title: string; pipelineStatus: string; owner?: string; nextFollowUpAt?: string; rawPayload?: unknown } }>): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Re-engagement Campaigns</title><style>${styles()}</style></head><body><main><header><div><p class="eyebrow">Admin/Waseem workflow</p><h1>Re-engagement Campaigns</h1><p>Previous clients, dormant proposals, existing-account cross-sell and trusted partners. Current buyer intent must still be verified.</p></div><nav><a href="/priorities">Priorities</a><a href="/operations">Operations</a><a href="/prospects">Prospects</a></nav></header><section class="panel"><h2>Add or update a relationship</h2><form method="post">
  <label>Relationship type<select name="relationshipType" required><option value="previous_client">Previous client</option><option value="existing_account_cross_sell">Existing account cross-sell</option><option value="dormant_proposal">Dormant proposal</option><option value="agency_partner">Agency partner</option><option value="referral_partner">Referral partner</option></select></label>
  <label>Organization name<input name="organizationName" required></label><label>Official website<input name="officialWebsite" type="url"></label>
  <label class="wide">Prior engagement summary <span>Internal only; never copied into outbound drafts.</span><textarea name="priorEngagementSummary" required minlength="10"></textarea></label>
  <label>Last interaction<input name="lastInteractionAt" type="date"></label><label>Approved services delivered<input name="approvedServicesDelivered" placeholder="Portal development, security review"></label>
  <label class="wide">Current opportunity signal <span>Use only current evidence. A hypothesis alone is not buyer intent.</span><textarea name="currentOpportunitySignal"></textarea></label>
  <label class="wide">Cross-sell hypothesis<textarea name="crossSellHypothesis"></textarea></label>
  <label>Evidence URL<input name="evidenceSourceUrl" type="url"></label><label>Contact name<input name="contactName"></label><label>Contact role<input name="contactRole"></label><label>Business email<input name="contactEmail" type="email"></label><label>Official contact form<input name="contactFormUrl" type="url"></label><label>Owner<input name="owner" type="email" placeholder="name@codistan.org"></label><label>Follow-up<input name="followUpAt" type="datetime-local"></label>
  <label class="wide">Internal notes<textarea name="internalNotes"></textarea></label><button class="wide">Save re-engagement record</button></form></section>
  <section class="panel"><div class="title"><h2>Existing re-engagement records</h2><span>${records.length}</span></div>${records.length ? `<div class="table"><table><thead><tr><th>Organization</th><th>Relationship</th><th>Status</th><th>Owner</th><th>Follow-up</th></tr></thead><tbody>${records.map(renderRecord).join('')}</tbody></table></div>` : '<p>No re-engagement records have been added yet.</p>'}</section></main></body></html>`;
}

function renderRecord(record: { lead: { id: string; companyName?: string; title: string; pipelineStatus: string; owner?: string; nextFollowUpAt?: string; rawPayload?: unknown } }): string {
  const reengagement = asObject(asObject(record.lead.rawPayload).reengagement);
  return `<tr><td><a href="/prospects?leadId=${encodeURIComponent(record.lead.id)}">${escapeHtml(record.lead.companyName ?? record.lead.title)}</a></td><td>${escapeHtml(label(String(reengagement.relationshipType ?? 'unknown')))}<small>${escapeHtml(String(reengagement.relationshipStrength ?? ''))}</small></td><td>${escapeHtml(label(record.lead.pipelineStatus))}</td><td>${escapeHtml(record.lead.owner ?? 'Unassigned')}</td><td>${escapeHtml(record.lead.nextFollowUpAt ? formatDate(record.lead.nextFollowUpAt) : 'Not scheduled')}</td></tr>`;
}

function renderResult(result: Record<string, unknown>): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Re-engagement Saved</title><style>${styles()}</style></head><body><main><section class="panel"><p class="eyebrow">Saved</p><h1>${result.created ? 'Re-engagement record created' : 'Existing prospect updated'}</h1><dl>${Object.entries(result).filter(([key])=>!['ok','prospectUrl'].includes(key)).map(([key,value])=>`<dt>${escapeHtml(label(key))}</dt><dd>${escapeHtml(Array.isArray(value)?value.join('; '):String(value??'—'))}</dd>`).join('')}</dl><nav><a href="${escapeAttribute(String(result.prospectUrl))}">Open prospect</a><a href="/api/re-engagement">Campaign workspace</a><a href="/priorities">Priorities</a></nav></section></main></body></html>`;
}
function renderError(detail: string): string { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Re-engagement Error</title><style>${styles()}</style></head><body><main><section class="panel error"><h1>Could not save re-engagement record</h1><p>${escapeHtml(detail)}</p><a href="/api/re-engagement">Return to form</a></section></main></body></html>`; }

async function authorizedDashboardActor(request: Request, secret: string): Promise<string | undefined> {
  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  if (!(await validSession(cookies[SESSION_COOKIE], secret))) return undefined;
  const actorToken = cookies[ACTOR_COOKIE]; if (!actorToken) return 'admin';
  const match=actorToken.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/); if(!match?.[1]||!match[2])return undefined;
  const identifier=Buffer.from(match[1],'base64url').toString('utf8').trim().toLowerCase();
  return await safeEqual(actorToken,await actorTokenFor(identifier,secret))?identifier:undefined;
}
async function validSession(token:string|undefined,secret:string):Promise<boolean>{const match=token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/);if(!match?.[1]||!match[2])return false;const expiresAt=Number(match[1]);return Number.isFinite(expiresAt)&&expiresAt>Math.floor(Date.now()/1_000)&&await safeEqual(token??'',await sessionTokenFor(expiresAt,secret));}
async function sessionTokenFor(expiresAt:number,secret:string):Promise<string>{const{createHmac}=await import('node:crypto');return`${expiresAt}.${createHmac('sha256',secret).update(`admin:${expiresAt}`).digest('base64url')}`;}
async function actorTokenFor(identifier:string,secret:string):Promise<string>{const{createHmac}=await import('node:crypto');const encoded=Buffer.from(identifier,'utf8').toString('base64url');return`${encoded}.${createHmac('sha256',secret).update(`actor:${encoded}`).digest('base64url')}`;}
async function safeEqual(left:string,right:string):Promise<boolean>{const{timingSafeEqual}=await import('node:crypto');const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}
async function parseBody(request:Request):Promise<unknown>{const raw=await request.text();if(!raw)return{};if(raw.length>100_000)throw new Error('Request payload is too large.');const type=request.headers.get('content-type')?.toLowerCase()??'';if(type.includes('application/x-www-form-urlencoded'))return Object.fromEntries(new URLSearchParams(raw));try{return JSON.parse(raw);}catch{return Object.fromEntries(new URLSearchParams(raw));}}
function parseCookies(value:string):Record<string,string>{const result:Record<string,string>={};for(const part of value.split(';')){const[name,...rest]=part.trim().split('=');if(name)result[name]=rest.join('=');}return result;}
function asObject(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function requiredString(value:unknown,field:string):string{if(typeof value!=='string'||!value.trim())throw new Error(`${field} is required.`);return value.trim();}
function optionalString(value:unknown):string|undefined{return typeof value==='string'&&value.trim()?value.trim():undefined;}
function listValue(value:unknown):string[]{if(Array.isArray(value))return value.map(String).map(item=>item.trim()).filter(Boolean);if(typeof value!=='string')return[];return value.split(/[\n,;]+/).map(item=>item.trim()).filter(Boolean);}
function requireEnvironment(name:string):string{const value=process.env[name];if(!value?.trim())throw new Error(`${name} is required.`);return value.trim();}
function html(value:string,status=200):Response{return new Response(value,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY'}});}
function label(value:string):string{return value.replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/\b\w/g,letter=>letter.toUpperCase());}
function formatDate(value:string):string{return new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
function escapeHtml(value:unknown):string{return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));}
function escapeAttribute(value:unknown):string{return escapeHtml(value);}
function styles():string{return`:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb}*{box-sizing:border-box}body{margin:0}main{max-width:1150px;margin:35px auto;padding:0 18px}header{display:flex;justify-content:space-between;gap:20px;align-items:start}header p{color:#667085;max-width:720px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#3157d5}.panel{background:#fff;border:1px solid #e4e7ec;border-radius:16px;padding:22px;margin:18px 0}.panel h2{margin-top:0}form{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px;font-weight:750;font-size:13px}label span{color:#667085;font-weight:400;font-size:11px}.wide{grid-column:1/-1}input,select,textarea{border:1px solid #d0d5dd;border-radius:9px;padding:10px;font:inherit}textarea{min-height:85px}button{border:0;border-radius:9px;background:#3157d5;color:#fff;padding:12px;font:inherit;font-weight:800;cursor:pointer}.title{display:flex;justify-content:space-between;align-items:center}.table{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #eaecf0;font-size:12px}td small{display:block;color:#667085}dl{display:grid;grid-template-columns:230px 1fr;gap:9px}dt{font-weight:800;color:#667085}dd{margin:0;overflow-wrap:anywhere}.error{border-color:#fecdca}@media(max-width:700px){header{display:grid}form{grid-template-columns:1fr}.wide{grid-column:auto}dl{grid-template-columns:1fr}}`;}
