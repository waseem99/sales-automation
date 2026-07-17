import { loadNeonAppState, persistNeonAppState } from '@sales-automation/neon-state';
import type { LinkedInWarmSignalInput, LinkedInWarmSignalOrigin } from '@sales-automation/prospect-discovery';
import { processLinkedInWarmSignalBatch } from './linkedin-warm-signal-engine.js';

export interface LinkedInWarmSignalsRuntimeInput {
  request: Request;
  databaseUrl: string;
  actor: string;
  canManage: boolean;
  pathname: string;
}

export async function handleLinkedInWarmSignalsRuntime(input: LinkedInWarmSignalsRuntimeInput): Promise<Response> {
  if (!input.canManage) return Response.json({ error: 'Forbidden: LinkedIn signal intake is restricted to Admin and Waseem.' }, { status: 403 });
  if (!['GET', 'POST'].includes(input.request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405 });

  const state = await loadNeonAppState(input.databaseUrl);
  if (input.request.method === 'GET') {
    const recent = recentLinkedInSignals(state.repository.listLeads());
    const payload = {
      ok: true,
      actor: input.actor,
      recent,
      safeguards: {
        authenticatedLinkedInScraping: false,
        automatedExternalMessaging: false,
        publicIndexContactReadyWithoutVerification: false,
        humanReviewRequired: true,
      },
    };
    if ((input.request.headers.get('accept') ?? '').includes('text/html') || input.pathname === '/linkedin-signals') {
      return html(renderWorkspace(payload));
    }
    return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
  }

  try {
    const payload = asObject(await parseBody(input.request));
    const signal: LinkedInWarmSignalInput = {
      origin: requireManualOrigin(payload.origin),
      text: requiredString(payload.text, 'text'),
      receivedAt: new Date().toISOString(),
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
    const result = await processLinkedInWarmSignalBatch({
      state,
      signals: [signal],
      actor: input.actor,
      enrichContacts: true,
    });
    await persistNeonAppState(input.databaseUrl, state);
    const response = {
      ok: true,
      ...result,
      createdLeadIds: result.ingestion.captured.map((item) => item.leadId),
      firstProspectUrl: result.ingestion.captured[0]?.leadId
        ? `/prospects?leadId=${encodeURIComponent(result.ingestion.captured[0].leadId)}`
        : undefined,
    };
    if ((input.request.headers.get('accept') ?? '').includes('text/html') || input.pathname === '/linkedin-signals') {
      return html(renderResult(response));
    }
    return Response.json(response, { status: result.ingestion.created > 0 ? 201 : 200 });
  } catch (error) {
    const response = {
      error: error instanceof Error ? error.message : String(error),
      humanReviewRequired: true,
      externalActionAutomated: false,
    };
    if ((input.request.headers.get('accept') ?? '').includes('text/html') || input.pathname === '/linkedin-signals') {
      return html(renderError(response.error), 400);
    }
    return Response.json(response, { status: 400 });
  }
}

function recentLinkedInSignals(records: Array<{ lead: { id: string; title: string; companyName?: string; owner?: string; pipelineStatus: string; sourceUrl?: string; updatedAt: string; rawPayload?: unknown } }>) {
  return records.flatMap((record) => {
    const raw = asObject(record.lead.rawPayload);
    const signal = asObject(raw.linkedinWarmSignal);
    if (signal.version !== 1) return [];
    return [{
      leadId: record.lead.id,
      title: record.lead.title,
      companyName: record.lead.companyName,
      owner: record.lead.owner,
      pipelineStatus: record.lead.pipelineStatus,
      sourceUrl: record.lead.sourceUrl,
      score: numberValue(signal.score),
      band: optionalString(signal.band),
      origin: optionalString(signal.origin),
      publicIndexVerificationRequired: signal.publicIndexVerificationRequired === true,
      updatedAt: record.lead.updatedAt,
    }];
  }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, 30);
}

function renderWorkspace(input: { actor: string; recent: ReturnType<typeof recentLinkedInSignals> }): string {
  const researchMarker = 'Manual research note for a LinkedIn target prospect. This is a cold prospect and needs research before outreach. No direct buying post is confirmed.\n\nReason for review: ';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LinkedIn Intake</title><style>${styles()}</style></head><body><main>
  <header><div><p class="eyebrow">Human-controlled LinkedIn workflow</p><h1>LinkedIn Intake</h1><p>Add a relevant person, company or genuine buyer signal for internal qualification and outreach preparation.</p></div><nav><a href="/priorities">Priorities</a><a href="/operations">Operations</a><a href="/prospects">Prospects</a></nav></header>
  <section class="notice"><strong>No logged-in LinkedIn crawling.</strong> The system does not open profiles, scrape LinkedIn, send connection requests, InMails, comments or applications. Every external action remains human-reviewed.</section>
  <section class="panel primary-panel"><div class="title"><div><p class="eyebrow">Research first</p><h2>Add a profile or company</h2></div><span>LinkedIn URL</span></div><p>Use this when a person or company looks relevant but a buyer requirement is not yet confirmed. The existing Prospect Desk intake will deduplicate, classify, assign, score and prepare human-reviewed guidance.</p><form id="linkedin-research-form" method="post" action="/api/prospects/manual-intake">
  <input type="hidden" name="sourceKind" value="public_post">
  <label class="wide">LinkedIn profile or company URL<input name="sourceUrl" type="url" required placeholder="https://www.linkedin.com/in/... or https://www.linkedin.com/company/..."></label>
  <label class="wide">Prospect title<input name="title" required placeholder="Company · Contact role"></label>
  <label>Company<input name="companyName" placeholder="Company or organization"></label><label>Contact name<input name="contactName"></label>
  <label>Contact role<input name="contactRole"></label><label>Country<input name="country"></label>
  <label>Region<input name="region"></label>
  <label class="wide">Why this prospect may be relevant<textarea name="content" rows="7" required>${escapeHtml(researchMarker)}</textarea></label>
  <button class="wide" type="submit">Add for research and qualification</button>
  <div id="linkedin-research-result" class="form-result wide" role="status" aria-live="polite"></div>
  </form></section>
  <details class="panel secondary-panel"><summary><div><p class="eyebrow">Confirmed signal</p><h2>Add a LinkedIn post or Sales Navigator alert</h2></div><span>Expand</span></summary><form method="post" action="/api/linkedin-signals">
  <label>Source<select name="origin"><option value="manual_post">LinkedIn post copied manually</option><option value="sales_navigator_email">Sales Navigator alert copied manually</option><option value="linkedin_notification_email">LinkedIn notification copied manually</option></select></label>
  <label class="wide">Post or alert text<textarea name="text" rows="9" required placeholder="Paste the visible buyer request and any useful alert context"></textarea></label>
  <label class="wide">Original LinkedIn post URL<input name="sourceUrl" type="url" placeholder="https://www.linkedin.com/posts/..."></label>
  <label>Subject / alert title<input name="subject"></label><label>Posted at<input name="postedAt" type="datetime-local"></label>
  <label>Author name<input name="authorName"></label><label>Author role<input name="authorRole"></label>
  <label>Company<input name="companyName"></label><label>Official company website<input name="companyWebsite" type="url"></label>
  <label>Country<input name="country"></label><label>Region<input name="region"></label>
  <button class="wide">Qualify and add signal</button></form></details>
  <section class="panel"><div class="title"><h2>Recent confirmed LinkedIn signals</h2><span>${input.recent.length}</span></div>${renderRecent(input.recent)}</section>
  <footer>Signed in as ${escapeHtml(input.actor)}. External action always requires human review.</footer></main><script src="/assets/linkedin-intake.v1.js" defer></script></body></html>`;
}

function renderRecent(items: ReturnType<typeof recentLinkedInSignals>): string {
  if (!items.length) return '<p>No confirmed LinkedIn buyer signals have been stored yet.</p>';
  return `<div class="table"><table><thead><tr><th>Signal</th><th>Band</th><th>Score</th><th>Owner</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${items.map((item) => `<tr><td><a href="/prospects?leadId=${encodeURIComponent(item.leadId)}">${escapeHtml(item.companyName ?? item.title)}</a><small>${escapeHtml(item.origin ?? 'unknown')}${item.publicIndexVerificationRequired ? ' · verify original post' : ''}</small></td><td>${escapeHtml(label(item.band ?? 'research'))}</td><td>${item.score ?? '—'}</td><td>${escapeHtml(item.owner ?? 'Unassigned')}</td><td>${escapeHtml(label(item.pipelineStatus))}</td><td>${item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open post</a>` : 'Email/manual evidence'}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderResult(input: { ingestion: { created: number; duplicates: number; rejected: number; research: number; priorityA: number; priorityB: number; rejectionReasonCounts: Record<string, number> }; contactEnrichment: { checked: number; ready: number; partial: number; researchRequired: number }; assigned: number; rescored: number; firstProspectUrl?: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LinkedIn Signal Result</title><style>${styles()}</style></head><body><main><p class="eyebrow">Completed</p><h1>LinkedIn signal result</h1><section class="metrics"><article><strong>${input.ingestion.created}</strong><span>Created</span></article><article><strong>${input.ingestion.priorityA}</strong><span>Priority A</span></article><article><strong>${input.ingestion.priorityB}</strong><span>Priority B</span></article><article><strong>${input.ingestion.research}</strong><span>Research</span></article><article><strong>${input.ingestion.rejected}</strong><span>Rejected</span></article><article><strong>${input.ingestion.duplicates}</strong><span>Duplicates</span></article></section><p>${input.assigned} assigned, ${input.contactEnrichment.checked} checked for public contact evidence and ${input.rescored} rescored.</p>${Object.keys(input.ingestion.rejectionReasonCounts).length ? `<pre>${escapeHtml(JSON.stringify(input.ingestion.rejectionReasonCounts, null, 2))}</pre>` : ''}<nav>${input.firstProspectUrl ? `<a href="${escapeHtml(input.firstProspectUrl)}">Open prospect</a>` : ''}<a href="/linkedin-signals">Add another</a><a href="/priorities">Priority queue</a></nav></main></body></html>`;
}

function renderError(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LinkedIn Signal Error</title><style>${styles()}</style></head><body><main><p class="eyebrow">Not added</p><h1>LinkedIn signal could not be processed</h1><pre>${escapeHtml(message)}</pre><nav><a href="/linkedin-signals">Return to intake</a></nav></main></body></html>`;
}

async function parseBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw) return {};
  if (raw.length > 100_000) throw new Error('Signal payload is too large.');
  const type = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
}

function requireManualOrigin(value: unknown): LinkedInWarmSignalOrigin {
  const origin = optionalString(value) as LinkedInWarmSignalOrigin | undefined;
  if (!origin || !['manual_post','sales_navigator_email','linkedin_notification_email'].includes(origin)) throw new Error('origin is invalid.');
  return origin;
}
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function requiredString(value: unknown, field: string): string { const result=optionalString(value); if(!result) throw new Error(`${field} is required.`); return result; }
function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function validIso(value: unknown): string | undefined { const item=optionalString(value); return item && Number.isFinite(Date.parse(item)) ? new Date(item).toISOString() : undefined; }
function html(value: string, status=200): Response { return new Response(value,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','x-content-type-options':'nosniff'}}); }
function label(value: string): string { return value.replace(/_/g,' ').replace(/\b\w/g,(letter)=>letter.toUpperCase()); }
function escapeHtml(value: unknown): string { return String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character)); }
function styles(): string { return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb}*{box-sizing:border-box}body{margin:0}main{max-width:1200px;margin:32px auto;padding:0 20px}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}h1,h2{margin:.2rem 0}p,footer{color:#667085}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#3157d5}.notice,.panel{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:18px;margin:16px 0}.notice{border-color:#b9c8f5;background:#f5f7ff}.primary-panel{border-color:#b7c6f6}.secondary-panel>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none}.secondary-panel>summary::-webkit-details-marker{display:none}form{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}label{display:grid;gap:6px;font-size:12px;font-weight:750}.wide{grid-column:1/-1}input,textarea,select{border:1px solid #d0d5dd;border-radius:9px;padding:10px;font:inherit}button{border:0;border-radius:9px;background:#3157d5;color:#fff;padding:12px;font:inherit;font-weight:800;cursor:pointer}button:disabled{opacity:.65;cursor:wait}.form-result{min-height:24px;color:#344054;font-size:13px}.form-result.error{color:#b42318}.form-result.success{padding:11px 12px;border:1px solid #a6f4c5;border-radius:9px;background:#ecfdf3;color:#027a48}.title{display:flex;justify-content:space-between;gap:12px}.table{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #eef0f3;font-size:12px;vertical-align:top}td small{display:block;color:#667085;margin-top:4px}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.metrics article{background:#fff;border:1px solid #e4e7ec;border-radius:11px;padding:14px}.metrics strong{display:block;font-size:24px}.metrics span{font-size:11px;color:#667085}pre{white-space:pre-wrap;background:#fff;border:1px solid #e4e7ec;border-radius:10px;padding:12px}@media(max-width:760px){header{display:block}form{grid-template-columns:1fr}.wide{grid-column:auto}.metrics{grid-template-columns:repeat(2,1fr)}}`; }
