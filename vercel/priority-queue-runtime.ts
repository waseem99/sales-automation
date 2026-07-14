import { evaluateLead, type CloseabilityScore, type LeadEvaluation } from '@sales-automation/evaluator';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import {
  loadNeonScopedRecords,
  persistLeadRecords,
  type ProspectVisibility,
} from '@sales-automation/neon-state';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { resolveDashboardAccess } from '@sales-automation/web';

export interface PriorityQueueRuntimeInput {
  request: Request;
  databaseUrl: string;
  pathname: string;
  session: {
    identifier: string;
    displayName: string;
  };
}

const finalStatuses = new Set(['won', 'lost', 'rejected', 'archived']);
const contactedStatuses = new Set(['sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']);

export async function handlePriorityQueueRuntime(input: PriorityQueueRuntimeInput): Promise<Response> {
  const access = resolveDashboardAccess(input.session.identifier, input.session.displayName);
  const visibility: ProspectVisibility = {
    canViewAll: access.scopeKind === 'all',
    ownerTokens: access.visibleOwnerTokens,
  };

  if (input.request.method === 'POST' && input.pathname === '/api/closeability-rescore') {
    if (!access.canRunGlobalOperations) {
      return json({ error: 'Forbidden: rescoring is restricted to Admin and Waseem.' }, 403);
    }
    const records = await loadNeonScopedRecords(input.databaseUrl, { canViewAll: true, ownerTokens: [] });
    const rescored = records.map((record) => evaluateRecord(record, true));
    await persistLeadRecords(input.databaseUrl, rescored);
    return json({
      ok: true,
      rescored: rescored.length,
      priorityA: rescored.filter((record) => closeability(record)?.band === 'priority_a').length,
      priorityB: rescored.filter((record) => closeability(record)?.band === 'priority_b').length,
      research: rescored.filter((record) => closeability(record)?.band === 'research').length,
      rejected: rescored.filter((record) => closeability(record)?.band === 'reject').length,
      duplicatesCreated: 0,
    });
  }

  if (input.request.method !== 'GET' || input.pathname !== '/priorities') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const url = new URL(input.request.url);
  const threshold = thresholdValue(url.searchParams.get('threshold'));
  const records = await loadNeonScopedRecords(input.databaseUrl, visibility);
  const evaluated = records.map((record) => evaluateRecord(record, false));
  const active = evaluated
    .filter((record) => !finalStatuses.has(record.lead.pipelineStatus))
    .filter((record) => (closeability(record)?.total ?? 0) >= threshold)
    .sort(prioritySort);
  const uncontacted = active.filter((record) => !contactedStatuses.has(record.lead.pipelineStatus));
  const topFive = uncontacted.slice(0, 5);

  return html(renderPriorityPage({
    access,
    threshold,
    topFive,
    active,
    generatedAt: new Date().toISOString(),
  }));
}

function evaluateRecord(record: StoredLeadRecord, force: boolean): StoredLeadRecord {
  const existing = closeability(record);
  if (existing && !force) return record;
  const evaluation = evaluateLead({
    lead: record.lead,
    portfolioItems: samplePortfolioItems,
    generatedAt: new Date().toISOString(),
  });
  return { ...record, latestEvaluation: evaluation };
}

function closeability(record: StoredLeadRecord): CloseabilityScore | undefined {
  return (record.latestEvaluation as (LeadEvaluation & { closeability?: CloseabilityScore }) | undefined)?.closeability;
}

function prioritySort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  const leftScore = closeability(left)?.total ?? 0;
  const rightScore = closeability(right)?.total ?? 0;
  if (rightScore !== leftScore) return rightScore - leftScore;
  const leftUrgency = closeability(left)?.reasonToActNow ? 1 : 0;
  const rightUrgency = closeability(right)?.reasonToActNow ? 1 : 0;
  if (rightUrgency !== leftUrgency) return rightUrgency - leftUrgency;
  return Date.parse(right.lead.updatedAt) - Date.parse(left.lead.updatedAt);
}

function renderPriorityPage(input: {
  access: ReturnType<typeof resolveDashboardAccess>;
  threshold: number;
  topFive: StoredLeadRecord[];
  active: StoredLeadRecord[];
  generatedAt: string;
}): string {
  const counts = {
    priorityA: input.active.filter((record) => closeability(record)?.band === 'priority_a').length,
    priorityB: input.active.filter((record) => closeability(record)?.band === 'priority_b').length,
    research: input.active.filter((record) => closeability(record)?.band === 'research').length,
    verifiedContact: input.active.filter((record) => (closeability(record)?.breakdown.verifiedContactRoute ?? 0) >= 8).length,
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Priority Opportunities</title><style>${styles()}</style></head><body><main class="shell">
  <header><div><p class="eyebrow">${escapeHtml(input.access.scopeLabel)}</p><h1>Priority Opportunities</h1><p>Closeability ranks realistic conversion readiness separately from general relevance. Signed in as ${escapeHtml(input.access.displayName)}.</p></div><div class="actions"><a class="button ghost" href="/prospects">Prospect Desk</a><a class="button ghost" href="/portfolio">Proof catalog</a>${input.access.canRunGlobalOperations ? '<button id="rescore" class="button primary">Rescore all leads</button>' : ''}</div></header>
  <section class="metrics"><article><strong>${counts.priorityA}</strong><span>Priority A</span></article><article><strong>${counts.priorityB}</strong><span>Priority B</span></article><article><strong>${counts.research}</strong><span>Research</span></article><article><strong>${counts.verifiedContact}</strong><span>Verified contact route</span></article></section>
  <section class="toolbar"><strong>Minimum score</strong>${[60,75,85].map((value) => `<a class="${input.threshold===value?'active':''}" href="/priorities?threshold=${value}">${value}+ ${value===85?'Priority A':value===75?'Priority A + B':'Include research'}</a>`).join('')}<span id="status">Generated ${escapeHtml(formatDate(input.generatedAt))}</span></section>
  <section class="top-five"><div class="section-title"><div><p class="eyebrow">Owner action queue</p><h2>Your top five immediate actions</h2></div><span>${input.topFive.length} actionable</span></div>${input.topFive.length ? input.topFive.map((record, index) => renderPriorityCard(record, index + 1, true)).join('') : '<div class="empty">No uncontacted opportunities currently meet this threshold. Lower the threshold or improve missing evidence.</div>'}</section>
  <section class="all"><div class="section-title"><div><p class="eyebrow">Qualified pipeline</p><h2>All opportunities in scope</h2></div><span>${input.active.length} records</span></div>${input.active.length ? input.active.map((record, index) => renderPriorityCard(record, index + 1, false)).join('') : '<div class="empty">No opportunities currently meet this threshold.</div>'}</section>
  </main><script>document.getElementById('rescore')?.addEventListener('click',async()=>{const button=document.getElementById('rescore'),status=document.getElementById('status');button.disabled=true;button.textContent='Rescoring…';const response=await fetch('/api/closeability-rescore',{method:'POST'});const data=await response.json();if(!response.ok){status.textContent=data.error||'Rescore failed';button.disabled=false;button.textContent='Rescore all leads';return;}status.textContent=data.rescored+' leads rescored; '+data.priorityA+' Priority A; '+data.priorityB+' Priority B';setTimeout(()=>location.reload(),700);});</script></body></html>`;
}

function renderPriorityCard(record: StoredLeadRecord, position: number, compact: boolean): string {
  const score = closeability(record);
  if (!score) return '';
  const lead = record.lead;
  const bestProof = record.latestEvaluation?.portfolioMatches[0]?.portfolioItem;
  const contact = lead.contactName && lead.contactRole ? `${lead.contactName} — ${lead.contactRole}` : lead.contactRole ?? lead.contactName ?? 'Buyer not identified';
  const route = lead.contactEmail ?? lead.contactFormUrl ?? lead.linkedinUrl ?? lead.tender?.submissionMethod ?? 'Contact route requires research';
  const gaps = score.missingData.slice(0, compact ? 2 : 4);
  return `<article class="card band-${score.band}"><div class="rank">${position}</div><div class="body"><div class="heading"><div><span class="band">${escapeHtml(label(score.band))}</span><h3><a href="/prospects?leadId=${encodeURIComponent(lead.id)}">${escapeHtml(lead.companyName ?? lead.title)}</a></h3><p>${escapeHtml(lead.title)}</p></div><div class="score">${score.total}<small>/100</small></div></div><div class="facts"><span><b>Service</b>${escapeHtml(label(lead.serviceCategory))}</span><span><b>Buyer</b>${escapeHtml(contact)}</span><span><b>Contact route</b>${linkOrText(route)}</span><span><b>Location</b>${escapeHtml([lead.country, lead.region].filter(Boolean).join(' · ') || 'Not confirmed')}</span><span><b>Proof</b>${bestProof ? escapeHtml(bestProof.projectName) : 'Approved proof missing'}</span><span><b>Status</b>${escapeHtml(label(lead.pipelineStatus))}</span></div>${score.reasonToActNow ? `<div class="act"><strong>Why now:</strong> ${escapeHtml(score.reasonToActNow)}</div>` : ''}<div class="next"><strong>Recommended action:</strong> ${escapeHtml(lead.recommendedNextAction ?? record.latestEvaluation?.recommendedNextAction ?? 'Resolve the evidence gaps before outreach.')}</div>${gaps.length ? `<div class="gaps"><strong>Missing evidence:</strong><ul>${gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul></div>` : '<div class="ready">Core closeability evidence is present.</div>'}${compact ? '' : `<details><summary>Score breakdown</summary><div class="breakdown">${Object.entries(score.breakdown).map(([name,value]) => `<span><b>${escapeHtml(label(name))}</b>${value}</span>`).join('')}</div><p>${escapeHtml(score.explanation)}</p></details>`}</div></article>`;
}

function thresholdValue(value: string | null): number {
  const parsed = Number(value);
  return [60, 75, 85].includes(parsed) ? parsed : 75;
}

function linkOrText(value: string): string {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `<a href="mailto:${escapeAttribute(value)}">${escapeHtml(value)}</a>`;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol)) return `<a href="${escapeAttribute(url.toString())}" target="_blank" rel="noopener noreferrer">Open route</a>`;
  } catch { /* text fallback */ }
  return escapeHtml(value);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function html(value: string): Response {
  return new Response(value, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' } });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character] ?? character));
}
function escapeAttribute(value: unknown): string { return escapeHtml(value); }

function styles(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb;line-height:1.45}*{box-sizing:border-box}body{margin:0}.shell{max-width:1320px;margin:auto;padding:28px}header{display:flex;justify-content:space-between;gap:22px;align-items:flex-start}header h1{margin:3px 0 8px;font-size:32px}header p{color:#667085;margin:0}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}.actions{display:flex;gap:9px;flex-wrap:wrap}.button{border:0;border-radius:10px;padding:10px 13px;font:inherit;font-weight:750;text-decoration:none;cursor:pointer}.primary{background:#3157d5;color:#fff}.ghost{background:#fff;color:#344054;border:1px solid #d0d5dd}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.metrics article,.toolbar,.top-five,.all{background:#fff;border:1px solid #e4e7ec;border-radius:16px}.metrics article{padding:17px}.metrics strong{display:block;font-size:29px}.metrics span{color:#667085;font-size:12px}.toolbar{padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.toolbar a{padding:7px 10px;border-radius:8px;color:#344054;text-decoration:none;background:#f2f4f7;font-size:12px}.toolbar a.active{background:#3157d5;color:#fff}.toolbar span{margin-left:auto;color:#667085;font-size:12px}.top-five,.all{padding:20px;margin-bottom:16px}.section-title{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px}.section-title h2{margin:2px 0}.section-title>span{color:#667085}.card{display:grid;grid-template-columns:42px 1fr;gap:12px;padding:16px 0;border-top:1px solid #eaecf0}.card:first-of-type{border-top:0}.rank{width:34px;height:34px;border-radius:10px;background:#111827;color:#fff;display:grid;place-items:center;font-weight:850}.heading{display:flex;justify-content:space-between;gap:12px}.heading h3{margin:4px 0 2px}.heading h3 a{color:#172033}.heading p{margin:0;color:#667085;font-size:13px}.band{font-size:10px;font-weight:850;padding:4px 8px;border-radius:999px;background:#eef2ff;color:#3448a5}.band-priority_a .band{background:#ecfdf3;color:#027a48}.band-priority_b .band{background:#eff8ff;color:#175cd3}.band-research .band{background:#fff6ed;color:#b54708}.score{min-width:64px;height:58px;border-radius:15px;background:#111827;color:#fff;display:grid;place-items:center;font-size:22px;font-weight:850}.score small{font-size:9px;margin-top:-13px}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:13px 0}.facts span{background:#f8fafc;border-radius:9px;padding:9px;font-size:12px;overflow-wrap:anywhere}.facts b{display:block;color:#667085;font-size:9px;text-transform:uppercase;margin-bottom:3px}.next,.act,.gaps,.ready{font-size:13px;padding:10px 12px;border-radius:9px;margin-top:8px}.next{background:#eef2ff}.act{background:#fff6ed}.gaps{background:#fff4e5;color:#7a2e0e}.gaps ul{margin:5px 0 0;padding-left:18px}.ready{background:#ecfdf3;color:#027a48}.breakdown{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:9px}.breakdown span{background:#f2f4f7;padding:7px;border-radius:7px;font-size:11px}.breakdown b{display:block}.empty{text-align:center;padding:32px;color:#667085}@media(max-width:850px){header{display:grid}.metrics{grid-template-columns:1fr 1fr}.facts,.breakdown{grid-template-columns:1fr}.card{grid-template-columns:1fr}.rank{display:none}}`;
}
