import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  buildCommercialAnalytics,
  createCalibrationDecision,
  recordCommercialValue,
  type CalibrationDecisionInput,
  type CommercialDimension,
  type CommercialLaneScorecard,
} from '@sales-automation/commercial-analytics';
import {
  loadNeonProspectRecord,
  loadNeonScopedRecords,
  persistLeadRecords,
  requireDatabaseUrl,
} from '@sales-automation/neon-state';
import {
  loadCommercialCalibrationDecisions,
  upsertCommercialCalibrationDecision,
} from '@sales-automation/neon-state/commercial-calibration';
import { resolveDashboardAccess } from '@sales-automation/web/prospect-handler';

export const maxDuration = 300;

const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';
const knownAccounts = new Map([
  ['admin', 'Administrator'],
  ['waseem@codistan.org', 'Waseem Khan'],
  ['talha.bashir@codistan.org', 'Talha Bashir'],
  ['jawad.jutt@codistan.org', 'Jawad Jutt'],
  ['moiz.khalid@codistan.org', 'Moiz Khalid'],
  ['subainaaamir@codistan.org', 'Subaina Aamir'],
  ['danishkhalid@codistan.org', 'Danish Khalid'],
  ['hibasohail@codistan.org', 'Hiba Sohail'],
  ['bilalahmed@codistan.org', 'Bilal Ahmed'],
]);

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const secret = requireEnvironment('SESSION_SECRET');
      const session = await readSession(request.headers.get('cookie'), secret);
      const originalUrl = originalRequestUrl(request);
      const url = new URL(originalUrl, 'https://local.invalid');
      const pathname = trimTrailingSlash(url.pathname) || '/commercial-analytics';
      if (!session) {
        return request.method === 'GET' && !pathname.startsWith('/api/')
          ? redirect('/login')
          : json({error: 'Authentication required.'}, 401);
      }
      const databaseUrl = requireDatabaseUrl(process.env.DATABASE_URL);
      const access = resolveDashboardAccess(session.identifier, session.displayName);
      const visibility = {canViewAll: access.scopeKind === 'all', ownerTokens: access.visibleOwnerTokens};

      if (request.method === 'POST' && pathname === '/api/commercial-analytics/decision') {
        if (!access.canRunGlobalOperations && !access.canAssignOwners) {
          return json({error: 'Forbidden: commercial calibration decisions are restricted to management.'}, 403);
        }
        const payload = asObject(await parseBody(request));
        const decision = createCalibrationDecision({
          dimension: requiredString(payload.dimension, 'dimension') as CommercialDimension,
          laneKey: requiredString(payload.laneKey, 'laneKey'),
          laneLabel: requiredString(payload.laneLabel, 'laneLabel'),
          decision: requiredString(payload.decision, 'decision') as CalibrationDecisionInput['decision'],
          rationale: requiredString(payload.rationale, 'rationale'),
          evidence: listValue(payload.evidence),
          reviewedSampleSize: positiveInteger(payload.reviewedSampleSize, 'reviewedSampleSize'),
          plannedChange: optionalString(payload.plannedChange),
          reactivationCriteria: optionalString(payload.reactivationCriteria),
          effectiveFrom: optionalString(payload.effectiveFrom),
          reviewedBy: session.identifier,
          reviewedAt: new Date().toISOString(),
        });
        await upsertCommercialCalibrationDecision(databaseUrl, decision);
        return json({ok: true, decision}, 201);
      }

      if (request.method === 'POST' && pathname === '/api/commercial-analytics/value') {
        const payload = asObject(await parseBody(request));
        const leadId = requiredString(payload.leadId, 'leadId');
        const record = await loadNeonProspectRecord(databaseUrl, leadId, visibility);
        if (!record) return json({error: 'Prospect not found.'}, 404);
        const updatedLead = recordCommercialValue(record.lead, {
          kind: requiredString(payload.kind, 'kind') as 'pipeline' | 'proposal' | 'won_revenue',
          amount: finiteNumber(payload.amount, 'amount'),
          currency: requiredString(payload.currency, 'currency'),
          note: requiredString(payload.note, 'note'),
          actor: session.identifier,
          enteredAt: new Date().toISOString(),
        });
        const updatedRecord = {
          ...record,
          lead: updatedLead,
          notes: [...record.notes, `commercial_value::${requiredString(payload.kind, 'kind')}::${updatedLead.id}::manual_entry`],
          auditLog: [...record.auditLog, {
            id: `${leadId}-commercial-value-${record.auditLog.length + 1}`,
            leadId,
            action: 'note_added' as const,
            actor: session.identifier,
            message: 'Explicit commercial value recorded.',
            createdAt: new Date().toISOString(),
            metadata: {kind: payload.kind, currency: String(payload.currency).toUpperCase(), source: 'manual_entry'},
          }],
        };
        await persistLeadRecords(databaseUrl, [updatedRecord]);
        return json({ok: true, leadId, values: (updatedLead.rawPayload as Record<string, unknown>)?.commercialValues ?? []}, 201);
      }

      if (request.method !== 'GET' || !['/commercial-analytics','/api/commercial-analytics'].includes(pathname)) {
        return json({error: 'Not found.'}, 404);
      }
      const days = boundedInteger(url.searchParams.get('days'), 30, 1, 366);
      const dimension = dimensionValue(url.searchParams.get('dimension'));
      const [records, decisions] = await Promise.all([
        loadNeonScopedRecords(databaseUrl, visibility),
        loadCommercialCalibrationDecisions(databaseUrl),
      ]);
      const report = buildCommercialAnalytics({records, days, decisions, generatedAt: new Date().toISOString()});
      if (pathname === '/api/commercial-analytics') return json({access: {scopeLabel: access.scopeLabel, canManage: access.canAssignOwners || access.canRunGlobalOperations}, report});
      return html(renderDashboard({report, dimension, actor: session.displayName, scopeLabel: access.scopeLabel, canManage: access.canAssignOwners || access.canRunGlobalOperations}));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('COMMERCIAL_ANALYTICS_RUNTIME_ERROR', {message});
      return json({error: message}, errorStatus(message));
    }
  },
};

function renderDashboard(input: {
  report: ReturnType<typeof buildCommercialAnalytics>;
  dimension: CommercialDimension;
  actor: string;
  scopeLabel: string;
  canManage: boolean;
}): string {
  const summary = input.report.summary;
  const lanes = input.report.lanes[input.dimension];
  const dimensions: CommercialDimension[] = ['source','campaign','channel','service','owner'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Commercial Analytics · Codistan</title><style>${styles()}</style></head><body><main class="shell"><header><div><p class="eyebrow">${escapeHtml(input.scopeLabel)}</p><h1>Commercial Analytics & Calibration</h1><p>Real stored funnel events, explicit value entries and reviewed keep/change/stop decisions. Signed in as ${escapeHtml(input.actor)}.</p></div><nav><a href="/prospects">Prospects</a><a href="/operations">Operations</a><a href="/priorities">Priorities</a></nav></header><section class="period"><span>Period</span>${[7,30,90,180].map((days)=>`<a class="${input.report.period.days===days?'active':''}" href="/commercial-analytics?days=${days}&dimension=${input.dimension}">${days} days</a>`).join('')}<small>${formatDate(input.report.period.from)} – ${formatDate(input.report.period.to)}</small></section>${input.report.dataWarnings.length?`<section class="warnings"><h2>Data limitations</h2>${input.report.dataWarnings.map((warning)=>`<p>${escapeHtml(warning)}</p>`).join('')}</section>`:''}<section class="cards">${metric('Captured',summary.counts.captured,'Unique cohort records')}${metric('BD accepted',summary.counts.bdAccepted,percent(summary.rates.bdAcceptanceRate))}${metric('Contacted',summary.counts.contacted,percent(summary.rates.contactRate))}${metric('Replies',summary.counts.replies,percent(summary.rates.replyRate))}${metric('Meetings',summary.counts.meetings,percent(summary.rates.meetingRate))}${metric('Proposals',summary.counts.proposals,percent(summary.rates.proposalRate))}${metric('Wins',summary.counts.wins,percent(summary.rates.winRate))}${metric('Follow-up SLA',summary.counts.onTimeFollowUps,`${summary.counts.onTimeFollowUps}/${summary.counts.dueFollowUps} · ${percent(summary.rates.followUpComplianceRate)}`)}</section><section class="grid"><article class="panel"><p class="eyebrow">Quality</p><h2>Evidence and enrichment</h2><dl><dt>Enriched</dt><dd>${summary.counts.enriched}/${summary.counts.captured} · ${percent(summary.rates.enrichmentRate)}</dd><dt>Evidence complete</dt><dd>${summary.counts.evidenceComplete}/${summary.counts.captured} · ${percent(summary.rates.evidenceCompletenessRate)}</dd><dt>Duplicates</dt><dd>${summary.counts.duplicates} · ${percent(summary.rates.duplicateRate)}</dd><dt>Identity conflicts</dt><dd>${summary.counts.identityConflicts}</dd><dt>Suppressed</dt><dd>${summary.counts.suppressed}</dd><dt>Reviewed feedback sample</dt><dd>${summary.reviewedSampleSize}</dd></dl></article><article class="panel"><p class="eyebrow">AI recommendation use</p><h2>Accepted, edited or rejected</h2><dl><dt>Accepted without edit</dt><dd>${summary.aiDisposition.accepted}</dd><dt>Human-edited</dt><dd>${summary.aiDisposition.edited}</dd><dt>Rejected</dt><dd>${summary.aiDisposition.rejected}</dd><dt>Pending</dt><dd>${summary.aiDisposition.pending}</dd></dl></article><article class="panel"><p class="eyebrow">Explicit values only</p><h2>Pipeline and revenue</h2>${summary.values.length?summary.values.map((value)=>`<dl class="currency"><dt>${escapeHtml(value.currency)} pipeline</dt><dd>${money(value.pipeline,value.currency)}</dd><dt>Proposal</dt><dd>${money(value.proposal,value.currency)}</dd><dt>Won revenue</dt><dd>${money(value.wonRevenue,value.currency)}</dd><dt>Entries</dt><dd>${value.entryCount}</dd></dl>`).join(''):'<p class="empty">No explicit value entries in this period. No amounts are inferred.</p>'}</article></section><section class="panel"><div class="panel-title"><div><p class="eyebrow">Commercial lanes</p><h2>Compare by ${escapeHtml(input.dimension)}</h2></div><div class="tabs">${dimensions.map((dimension)=>`<a class="${dimension===input.dimension?'active':''}" href="/commercial-analytics?days=${input.report.period.days}&dimension=${dimension}">${escapeHtml(label(dimension))}</a>`).join('')}</div></div><div class="table-wrap"><table><thead><tr><th>Lane</th><th>Captured / accepted</th><th>Contacted</th><th>Reply / meeting / proposal / win</th><th>Evidence / duplicate</th><th>AI accepted / edited / rejected</th><th>Values</th><th>Decision</th></tr></thead><tbody>${lanes.map((lane)=>renderLane(lane,input.canManage)).join('')||'<tr><td colspan="8" class="empty">No lanes in this scope and period.</td></tr>'}</tbody></table></div></section><section class="grid"><article class="panel"><p class="eyebrow">Manual value entry</p><h2>Record pipeline or revenue</h2><p>Amounts must come from an explicit commercial review. Currency totals are never converted or combined.</p><form data-analytics-form action="/api/commercial-analytics/value"><label>Prospect ID<input name="leadId" required></label><label>Value type<select name="kind"><option value="pipeline">Pipeline</option><option value="proposal">Proposal</option><option value="won_revenue">Won revenue</option></select></label><div class="two"><label>Amount<input name="amount" type="number" min="0" step="0.01" required></label><label>Currency<input name="currency" value="USD" minlength="3" maxlength="3" required></label></div><label>Evidence/note<textarea name="note" required minlength="10" rows="3"></textarea></label><button>Record explicit value</button><output></output></form></article><article class="panel"><p class="eyebrow">Calibration rule</p><h2>Do not optimize for volume</h2><ul><li>Require a representative reviewed sample.</li><li>Change one major targeting or playbook rule at a time.</li><li>Compare the next sample before adopting the change.</li><li>Cold fit is not confirmed buyer intent.</li><li>An algorithm suggestion is not an official decision.</li></ul></article></section></main><script>${clientScript()}</script></body></html>`;
}

function renderLane(lane: CommercialLaneScorecard, canManage: boolean): string {
  const values = lane.values.length ? lane.values.map((value)=>`${value.currency}: ${money(value.pipeline,value.currency)} pipeline · ${money(value.wonRevenue,value.currency)} won`).join('<br>') : '—';
  const official = lane.officialDecision ? `<strong class="decision ${lane.officialDecision.decision}">${lane.officialDecision.decision}</strong><small>${escapeHtml(lane.officialDecision.rationale)}</small>` : `<strong class="suggestion">Suggested: ${escapeHtml(label(lane.suggestedDecision))}</strong><small>${escapeHtml(lane.suggestedReason)}</small>`;
  const form = canManage ? `<details><summary>Record decision</summary><form data-analytics-form action="/api/commercial-analytics/decision"><input type="hidden" name="dimension" value="${escapeAttribute(lane.dimension)}"><input type="hidden" name="laneKey" value="${escapeAttribute(lane.key)}"><input type="hidden" name="laneLabel" value="${escapeAttribute(lane.label)}"><label>Decision<select name="decision"><option value="keep">Keep</option><option value="change">Change</option><option value="stop">Stop</option></select></label><label>Reviewed sample<input type="number" name="reviewedSampleSize" min="1" value="${Math.max(1,lane.reviewedSampleSize)}" required></label><label>Rationale<textarea name="rationale" required minlength="20"></textarea></label><label>Evidence, one item per line<textarea name="evidence" required></textarea></label><label>Planned change (required for change)<textarea name="plannedChange"></textarea></label><label>Reactivation criteria (required for stop)<textarea name="reactivationCriteria"></textarea></label><button>Save official decision</button><output></output></form></details>` : '';
  return `<tr><td><strong>${escapeHtml(lane.label)}</strong><small>${escapeHtml(lane.key)}</small>${lane.warnings.map((warning)=>`<small class="warning">${escapeHtml(warning)}</small>`).join('')}</td><td>${lane.counts.captured} / ${lane.counts.bdAccepted}<small>${percent(lane.rates.bdAcceptanceRate)} accepted</small></td><td>${lane.counts.contacted}<small>${percent(lane.rates.contactRate)}</small></td><td>${lane.counts.replies} / ${lane.counts.meetings} / ${lane.counts.proposals} / ${lane.counts.wins}<small>${percent(lane.rates.replyRate)} reply</small></td><td>${lane.counts.evidenceComplete} / ${lane.counts.duplicates}<small>${percent(lane.rates.evidenceCompletenessRate)} complete</small></td><td>${lane.aiDisposition.accepted} / ${lane.aiDisposition.edited} / ${lane.aiDisposition.rejected}</td><td>${values}</td><td>${official}${form}</td></tr>`;
}

function clientScript(): string {
  return `document.querySelectorAll('[data-analytics-form]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const output=form.querySelector('output');const button=form.querySelector('button');button.disabled=true;output.textContent='Saving…';try{const body=Object.fromEntries(new FormData(form));const response=await fetch(form.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');output.textContent='Saved';setTimeout(()=>location.reload(),350);}catch(error){output.textContent=error.message;button.disabled=false;}}));`;
}

function metric(labelText: string, value: number, detail: string): string { return `<article><span>${escapeHtml(labelText)}</span><strong>${value}</strong><small>${escapeHtml(detail)}</small></article>`; }
function money(value: number, currency: string): string { return new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2}).format(value); }
function percent(value: number): string { return `${(value*100).toFixed(value>0&&value<0.1?1:0)}%`; }
function label(value: string): string { return value.replace(/_/g,' ').replace(/\b\w/g,(letter)=>letter.toUpperCase()); }
function formatDate(value: string): string { return new Date(value).toLocaleDateString('en-US',{dateStyle:'medium'}); }
function styles(): string { return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f7fb}*{box-sizing:border-box}body{margin:0}.shell{max-width:1500px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:18px}h1,h2{margin:.2rem 0}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}header p,.panel p{color:#667085}nav,.tabs,.period{display:flex;gap:8px;flex-wrap:wrap}a{color:#3157d5;text-decoration:none;font-weight:700}.period{align-items:center;background:#fff;border:1px solid #e2e8f0;padding:10px 12px;border-radius:12px;margin-bottom:14px}.period a,.tabs a{padding:7px 10px;border-radius:8px}.period a.active,.tabs a.active{background:#3157d5;color:#fff}.period small{margin-left:auto;color:#667085}.warnings{background:#fff8e8;border:1px solid #e8c97f;padding:12px;border-radius:12px;margin-bottom:14px}.warnings p{margin:5px 0}.cards{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:10px}.cards article,.panel{background:#fff;border:1px solid #e1e7ef;border-radius:14px;padding:14px}.cards span,.cards small,td small{display:block;color:#667085;font-size:11px}.cards strong{font-size:25px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}.panel-title{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.panel dl{display:grid;grid-template-columns:1fr auto;gap:8px;margin:10px 0}.panel dt{color:#667085}.panel dd{margin:0;font-weight:750}.currency{border-top:1px solid #eef1f5;padding-top:8px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #e8edf2}th{background:#f8fafc;position:sticky;top:0}.warning{color:#9a4d00!important}.decision,.suggestion{display:inline-block;padding:5px 8px;border-radius:999px;text-transform:capitalize}.decision.keep{background:#e9f7ee;color:#23653a}.decision.change{background:#fff4d6;color:#805b00}.decision.stop{background:#fdecec;color:#9b2525}.suggestion{background:#eef2ff;color:#3349a3}details{margin-top:7px}form{display:grid;gap:8px;margin-top:8px}label{display:grid;gap:4px;font-size:11px;font-weight:700}input,select,textarea,button{font:inherit;padding:9px;border:1px solid #ccd5df;border-radius:8px}button{background:#3157d5;color:#fff;border:0;font-weight:800}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}output{font-size:12px}.empty{color:#667085}@media(max-width:1100px){.cards{grid-template-columns:repeat(4,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:650px){.cards{grid-template-columns:repeat(2,1fr)}header{display:block}.period small{width:100%;margin:0}}`; }

async function readSession(cookieHeader: string | null, secret: string): Promise<{identifier:string;displayName:string}|undefined> {
  if (!(await isAuthenticated(cookieHeader, secret))) return undefined;
  const actor = await verifyActorToken(parseCookies(cookieHeader ?? undefined)[ACTOR_COOKIE], secret) ?? 'admin';
  const displayName = knownAccounts.get(actor);
  return displayName ? {identifier: actor, displayName} : undefined;
}
async function isAuthenticated(cookieHeader: string | null, secret: string): Promise<boolean> { const token=parseCookies(cookieHeader??undefined)[SESSION_COOKIE]; const match=token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/); if(!match?.[1]||!match[2])return false; const expires=Number(match[1]); return Number.isFinite(expires)&&expires>Math.floor(Date.now()/1000)&&safeEqual(token!,sessionToken(expires,secret)); }
function sessionToken(expires:number,secret:string):string { return `${expires}.${createHmac('sha256',secret).update(`admin:${expires}`).digest('base64url')}`; }
async function verifyActorToken(token:string|undefined,secret:string):Promise<string|undefined>{const match=token?.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);if(!match?.[1]||!match[2])return undefined;const identifier=Buffer.from(match[1],'base64url').toString('utf8').trim().toLowerCase();const expected=`${match[1]}.${createHmac('sha256',secret).update(`actor:${match[1]}`).digest('base64url')}`;return safeEqual(token!,expected)?identifier:undefined;}
function safeEqual(left:string,right:string):boolean{const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}
function originalRequestUrl(request:Request):string{const url=new URL(request.url);const rewritten=url.searchParams.get('__path');if(rewritten!==null){url.pathname=rewritten.startsWith('/')?rewritten:`/${rewritten}`;url.searchParams.delete('__path');}return `${url.pathname}${url.search}`;}
async function parseBody(request:Request):Promise<unknown>{const raw=await request.text();if(!raw)return{};if(raw.length>1_000_000)throw new Error('Request body is too large.');if(request.headers.get('content-type')?.includes('application/x-www-form-urlencoded'))return Object.fromEntries(new URLSearchParams(raw));try{return JSON.parse(raw);}catch{throw new Error('Request body must be valid JSON.');}}
function dimensionValue(value:string|null):CommercialDimension{return ['source','campaign','channel','service','owner'].includes(value??'')?value as CommercialDimension:'source';}
function listValue(value:unknown):string[]{if(Array.isArray(value))return value.map(String).map(item=>item.trim()).filter(Boolean);return String(value??'').split(/\n+/).map(item=>item.trim()).filter(Boolean);}
function finiteNumber(value:unknown,field:string):number{const number=Number(value);if(!Number.isFinite(number))throw new Error(`${field} must be a number.`);return number;}
function positiveInteger(value:unknown,field:string):number{const number=Number.parseInt(String(value),10);if(!Number.isInteger(number)||number<1)throw new Error(`${field} must be a positive integer.`);return number;}
function boundedInteger(value:unknown,fallback:number,min:number,max:number):number{const number=Number.parseInt(String(value??''),10);return Number.isInteger(number)?Math.min(max,Math.max(min,number)):fallback;}
function asObject(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function requiredString(value:unknown,field:string):string{if(typeof value!=='string'||!value.trim())throw new Error(`${field} is required.`);return value.trim();}
function optionalString(value:unknown):string|undefined{return typeof value==='string'&&value.trim()?value.trim():undefined;}
function requireEnvironment(name:string):string{const value=process.env[name];if(!value?.trim())throw new Error(`${name} is required.`);return value.trim();}
function trimTrailingSlash(value:string):string{return value.length>1?value.replace(/\/+$/,''):value;}
function parseCookies(value:string|undefined):Record<string,string>{const result:Record<string,string>={};for(const part of value?.split(';')??[]){const[name,...rest]=part.trim().split('=');if(name)result[name]=rest.join('=');}return result;}
function errorStatus(message:string):number{const value=message.toLowerCase();if(value.includes('authentication'))return 401;if(value.includes('forbidden'))return 403;if(value.includes('not found'))return 404;return 400;}
function securityHeaders():Record<string,string>{return {'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'same-origin','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"};}
function json(value:unknown,status=200):Response{return new Response(JSON.stringify(value),{status,headers:{...securityHeaders(),'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function html(value:string,status=200):Response{return new Response(value,{status,headers:{...securityHeaders(),'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});}
function redirect(location:string):Response{return new Response('',{status:302,headers:{...securityHeaders(),location,'cache-control':'no-store'}});}
function escapeHtml(value:unknown):string{return String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));}
function escapeAttribute(value:unknown):string{return escapeHtml(value).replace(/`/g,'&#96;');}
