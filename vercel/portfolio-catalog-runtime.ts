import type {
  ManagedPortfolioItem,
  PortfolioApprovalStatus,
  PortfolioAssetHealth,
} from '@sales-automation/neon-state/portfolio-catalog';
import type { CodistanProfile, ServiceCategory } from '@sales-automation/shared';

export interface PortfolioCatalogRuntimeInput {
  request: Request;
  databaseUrl: string;
  actor: string;
  canManage: boolean;
  pathname: string;
}

const serviceCategories: ServiceCategory[] = [
  'ai_automation', 'rag_document_intelligence', 'ai_saas_mvp', 'fullstack_web_app',
  'nextjs_python_app', 'voice_ai_agent', 'ar_3d_unity_unreal', 'cybersecurity_compliance',
  'website_portal', 'enterprise_systems', 'unknown',
];

const profiles: CodistanProfile[] = [
  'us_ai_fullstack_profile', 'waseem_ai_founder_profile', 'ar_3d_animation_profile',
  'cybersecurity_compliance_profile', 'codistan_partner_identity', 'solution_campaign_identity',
  'needs_human_review',
];

export async function handlePortfolioCatalogRuntime(input: PortfolioCatalogRuntimeInput): Promise<Response> {
  const [catalog, starters] = await Promise.all([
    import('@sales-automation/neon-state/portfolio-catalog'),
    import('./approved-portfolio.js'),
  ]);
  await catalog.ensurePortfolioCatalogSeeded(input.databaseUrl, starters.approvedStarterPortfolioItems);

  if (input.request.method === 'GET' && input.pathname === '/portfolio') {
    const items = await catalog.loadPortfolioCatalog(input.databaseUrl);
    return html(renderPortfolioCatalogPage(items, input.actor, input.canManage));
  }

  if (input.request.method === 'GET' && input.pathname === '/api/portfolio-catalog') {
    const items = await catalog.loadPortfolioCatalog(input.databaseUrl);
    return json({ items, canManage: input.canManage });
  }

  if (!input.canManage) return json({ error: 'Forbidden: portfolio changes are restricted to Admin and Waseem.' }, 403);

  if (input.request.method === 'POST' && input.pathname === '/api/portfolio-catalog') {
    const payload = asObject(await parseBody(input.request));
    const existing = (await catalog.loadPortfolioCatalog(input.databaseUrl)).find((item) => item.id === optionalString(payload.id));
    const now = new Date().toISOString();
    const approvalStatus = enumValue<PortfolioApprovalStatus>(payload.approvalStatus, 'approvalStatus', ['draft', 'approved', 'archived']);
    const confidentiality = enumValue<ManagedPortfolioItem['confidentiality']>(payload.confidentiality, 'confidentiality', ['public', 'anonymized', 'private']);
    const item: ManagedPortfolioItem = {
      id: slug(requiredString(payload.id ?? payload.projectName, 'id')),
      projectName: requiredString(payload.projectName, 'projectName'),
      industry: optionalString(payload.industry),
      confidentiality,
      serviceCategories: list(payload.serviceCategories).filter((value): value is ServiceCategory => serviceCategories.includes(value as ServiceCategory)),
      techStack: list(payload.techStack),
      problemSolved: requiredString(payload.problemSolved, 'problemSolved'),
      businessOutcome: optionalString(payload.businessOutcome),
      assetUrls: list(payload.assetUrls).filter(isPublicHttpUrl),
      tags: list(payload.tags),
      bestProfiles: list(payload.bestProfiles).filter((value): value is CodistanProfile => profiles.includes(value as CodistanProfile)),
      bestPitchAngle: optionalString(payload.bestPitchAngle),
      approvalStatus,
      approvedBy: approvalStatus === 'approved' ? input.actor : existing?.approvedBy,
      approvedAt: approvalStatus === 'approved' ? now : existing?.approvedAt,
      approvedProofStatement: optionalString(payload.approvedProofStatement),
      approvedOutreachParagraph: optionalString(payload.approvedOutreachParagraph),
      shareInstructions: optionalString(payload.shareInstructions),
      doNotDisclose: optionalString(payload.doNotDisclose),
      deliveryModel: optionalString(payload.deliveryModel),
      assetHealth: enumValue<PortfolioAssetHealth>(payload.assetHealth ?? 'unchecked', 'assetHealth', ['unchecked', 'available', 'broken']),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (item.serviceCategories.length === 0) throw new Error('At least one valid service category is required.');
    if (item.bestProfiles.length === 0) item.bestProfiles = ['needs_human_review'];
    await catalog.upsertPortfolioCatalogItem(input.databaseUrl, item);
    return json({ ok: true, item }, existing ? 200 : 201);
  }

  if (input.request.method === 'DELETE' && input.pathname === '/api/portfolio-catalog') {
    const payload = asObject(await parseBody(input.request));
    const id = requiredString(payload.id, 'id');
    const item = await catalog.archivePortfolioCatalogItem(input.databaseUrl, id, input.actor);
    return item ? json({ ok: true, item }) : json({ error: 'Portfolio item not found.' }, 404);
  }

  return json({ error: 'Method not allowed.' }, 405);
}

function renderPortfolioCatalogPage(items: ManagedPortfolioItem[], actor: string, canManage: boolean): string {
  const serialized = escapeScriptJson(JSON.stringify(items));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portfolio Proof Catalog</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb}*{box-sizing:border-box}body{margin:0}.shell{max-width:1280px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.top h1{margin:4px 0}.top p{color:#667085}.actions{display:flex;gap:10px}a,button{font:inherit}.button,button{border:0;border-radius:10px;padding:11px 14px;font-weight:750;cursor:pointer}.primary{background:#3157d5;color:#fff}.ghost{background:#fff;border:1px solid #d0d5dd;color:#344054;text-decoration:none}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.metric,.card,.form-card{background:#fff;border:1px solid #e4e7ec;border-radius:16px;padding:18px}.metric strong{display:block;font-size:28px}.metric span{color:#667085}.grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(360px,.7fr);gap:18px}.cards{display:grid;gap:12px}.card h3{margin:0 0 6px}.meta,.muted{color:#667085;font-size:13px}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#eef2ff;color:#3448a5;font-size:11px;font-weight:800;margin-right:6px}.badge.private{background:#fff1f3;color:#c01048}.badge.draft{background:#fff6ed;color:#b54708}.links{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.links a{color:#3157d5}.proof{background:#f8fafc;border-left:3px solid #3157d5;padding:10px 12px;margin:12px 0}.warning{background:#fff4e5;color:#93370d;padding:9px;border-radius:8px}.form-card{position:sticky;top:18px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.form-grid label{display:grid;gap:5px;font-size:12px;font-weight:700}.form-grid .wide{grid-column:1/-1}input,select,textarea{width:100%;border:1px solid #d0d5dd;border-radius:9px;padding:9px;font:inherit}.footer{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:12px}#status{font-size:13px;color:#667085}.empty{padding:30px;text-align:center;color:#667085}@media(max-width:900px){.grid{grid-template-columns:1fr}.summary{grid-template-columns:1fr 1fr}.form-card{position:static}} </style></head><body><main class="shell">
  <section class="top"><div><div class="muted">Approved proof governance</div><h1>Portfolio Proof Catalog</h1><p>Manage evidence that qualification, drafting and the BD workspace may use. Signed in as ${escapeHtml(actor)}.</p></div><div class="actions"><a class="button ghost" href="/prospects">Back to prospects</a></div></section>
  <section class="summary"><article class="metric"><strong>${items.length}</strong><span>Total records</span></article><article class="metric"><strong>${items.filter((item)=>item.approvalStatus==='approved').length}</strong><span>Approved</span></article><article class="metric"><strong>${items.filter((item)=>item.approvalStatus==='draft').length}</strong><span>Draft</span></article><article class="metric"><strong>${items.filter((item)=>item.assetHealth==='broken').length}</strong><span>Broken assets</span></article></section>
  <section class="grid"><div class="cards" id="cards">${items.map(renderCard).join('') || '<div class="card empty">No portfolio records yet.</div>'}</div>
  <aside class="form-card"><h2>${canManage ? 'Add or edit proof' : 'Catalog is read-only'}</h2><p class="muted">Approved public or anonymized wording may enter drafts. Private proof remains internal.</p>${canManage ? renderForm() : '<div class="warning">Only Admin and Waseem can change proof records.</div>'}</aside></section>
  </main><script>const items=${serialized};${canManage ? managerScript() : ''}</script></body></html>`;
}

function renderCard(item: ManagedPortfolioItem): string {
  const links = item.assetUrls.map((url) => `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">Open asset</a>`).join('');
  return `<article class="card" data-id="${escapeAttribute(item.id)}"><div><span class="badge ${item.confidentiality==='private'?'private':''}">${escapeHtml(item.confidentiality)}</span><span class="badge ${item.approvalStatus==='draft'?'draft':''}">${escapeHtml(item.approvalStatus)}</span><span class="badge">${escapeHtml(item.assetHealth ?? 'unchecked')}</span></div><h3>${escapeHtml(item.projectName)}</h3><p class="meta">${escapeHtml(item.serviceCategories.join(', '))}${item.industry ? ` · ${escapeHtml(item.industry)}` : ''}</p><p>${escapeHtml(item.problemSolved)}</p>${item.approvedProofStatement ? `<div class="proof"><strong>Approved proof statement</strong><br>${escapeHtml(item.approvedProofStatement)}</div>` : '<div class="warning">No approved proof statement. Do not use in outbound drafts.</div>'}${item.shareInstructions ? `<p><strong>BD should share:</strong> ${escapeHtml(item.shareInstructions)}</p>` : ''}${item.doNotDisclose ? `<p><strong>Do not disclose:</strong> ${escapeHtml(item.doNotDisclose)}</p>` : ''}<div class="links">${links || '<span class="muted">No approved asset attached</span>'}<button class="ghost edit" data-id="${escapeAttribute(item.id)}">Edit</button>${item.approvalStatus!=='archived'?`<button class="ghost archive" data-id="${escapeAttribute(item.id)}">Archive</button>`:''}</div></article>`;
}

function renderForm(): string {
  return `<form id="catalog-form"><div class="form-grid"><label>ID<input name="id" required placeholder="project-or-capability-id"></label><label>Project / proof name<input name="projectName" required></label><label>Approval<select name="approvalStatus"><option>draft</option><option>approved</option><option>archived</option></select></label><label>Confidentiality<select name="confidentiality"><option>public</option><option>anonymized</option><option>private</option></select></label><label>Asset health<select name="assetHealth"><option>unchecked</option><option>available</option><option>broken</option></select></label><label>Industry<input name="industry"></label><label class="wide">Service categories<textarea name="serviceCategories" rows="2" required placeholder="ai_automation, fullstack_web_app"></textarea></label><label class="wide">Technology / capabilities<textarea name="techStack" rows="2"></textarea></label><label class="wide">Problem solved<textarea name="problemSolved" rows="3" required></textarea></label><label class="wide">Business outcome<textarea name="businessOutcome" rows="2" placeholder="Only evidence-based outcomes"></textarea></label><label class="wide">Asset URLs<textarea name="assetUrls" rows="2" placeholder="One URL per line"></textarea></label><label class="wide">Tags<textarea name="tags" rows="2"></textarea></label><label class="wide">Best profiles<textarea name="bestProfiles" rows="2" placeholder="codistan_partner_identity"></textarea></label><label class="wide">Approved proof statement<textarea name="approvedProofStatement" rows="3"></textarea></label><label class="wide">Approved outreach paragraph<textarea name="approvedOutreachParagraph" rows="4"></textarea></label><label class="wide">What BD should share<textarea name="shareInstructions" rows="3"></textarea></label><label class="wide">What must not be disclosed<textarea name="doNotDisclose" rows="3"></textarea></label><label class="wide">Delivery model<input name="deliveryModel"></label><label class="wide">Pitch angle<textarea name="bestPitchAngle" rows="2"></textarea></label></div><div class="footer"><span id="status">Changes are audited by approver and timestamp.</span><div><button type="button" class="ghost" id="reset">New</button><button class="primary" type="submit">Save proof</button></div></div></form>`;
}

function managerScript(): string {
  return `const form=document.getElementById('catalog-form'),statusEl=document.getElementById('status');const split=v=>String(v||'').split(/[\\n,;]+/).map(x=>x.trim()).filter(Boolean);document.querySelectorAll('.edit').forEach(button=>button.addEventListener('click',()=>{const item=items.find(x=>x.id===button.dataset.id);if(!item)return;for(const [key,value] of Object.entries(item)){const field=form.elements.namedItem(key);if(!field)continue;field.value=Array.isArray(value)?value.join('\\n'):value??'';}scrollTo({top:0,behavior:'smooth'});}));document.querySelectorAll('.archive').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Archive this proof record?'))return;const response=await fetch('/api/portfolio-catalog',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({id:button.dataset.id})});const data=await response.json();if(!response.ok)return alert(data.error||'Archive failed');location.reload();}));document.getElementById('reset').addEventListener('click',()=>form.reset());form.addEventListener('submit',async event=>{event.preventDefault();statusEl.textContent='Saving…';const data=Object.fromEntries(new FormData(form));for(const key of ['serviceCategories','techStack','assetUrls','tags','bestProfiles'])data[key]=split(data[key]);const response=await fetch('/api/portfolio-catalog',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await response.json();if(!response.ok){statusEl.textContent=body.error||'Save failed';return;}statusEl.textContent='Saved';location.reload();});`;
}

async function parseBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw) return {};
  if (raw.length > 500_000) throw new Error('Portfolio payload is too large.');
  try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const result = requiredString(value, field) as T;
  if (!allowed.includes(result)) throw new Error(`${field} is invalid.`);
  return result;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

function isPublicHttpUrl(value: string): boolean {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname); } catch { return false; }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function html(value: string): Response {
  return new Response(value, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' } });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character] ?? character));
}

function escapeAttribute(value: unknown): string { return escapeHtml(value); }
function escapeScriptJson(value: string): string { return value.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); }
