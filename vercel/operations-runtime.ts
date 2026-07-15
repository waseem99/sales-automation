import { loadNeonAppState } from '@sales-automation/neon-state';
import {
  isDiscoverySourceKey,
  loadDiscoverySourceControls,
  updateDiscoverySourceControl,
  type DiscoverySourceControl,
  type DiscoverySourceKey,
} from '@sales-automation/neon-state/source-controls';
import type { ProspectDiscoveryRun } from '@sales-automation/prospect-discovery';
import type { Lead, RepeatRecommendation } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

export interface OperationsRuntimeInput {
  request: Request;
  databaseUrl: string;
  pathname: string;
  actor: string;
  canManage: boolean;
}

interface SourcePerformance {
  sourceKey: string;
  label: string;
  total: number;
  active: number;
  activeShare: number;
  contactReady: number;
  replied: number;
  meetings: number;
  proposals: number;
  won: number;
  lost: number;
  rejected: number;
  priorityA: number;
  priorityB: number;
  averageRelevance?: number;
  accurateContacts: number;
  feedbackCount: number;
  repeatRecommendations: Record<RepeatRecommendation, number>;
  recommendation: 'increase' | 'keep' | 'reduce' | 'stop';
  warning?: string;
}

const finalStatuses = new Set(['won', 'lost', 'rejected', 'archived']);
const contactReadyStatuses = new Set(['approved_to_contact', 'draft_ready', 'sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won']);

export async function handleOperationsRuntime(input: OperationsRuntimeInput): Promise<Response> {
  if (input.request.method === 'POST' && input.pathname === '/api/source-controls') {
    if (!input.canManage) return json({ error: 'Forbidden: source controls are restricted to Admin and Waseem.' }, 403);
    const payload = asObject(await parseBody(input.request));
    const sourceKey = requiredString(payload.sourceKey, 'sourceKey');
    if (!isDiscoverySourceKey(sourceKey)) return json({ error: 'sourceKey is invalid.' }, 400);
    const enabled = booleanValue(payload.enabled, 'enabled');
    const reason = requiredString(payload.reason, 'reason');
    const control = await updateDiscoverySourceControl(input.databaseUrl, {
      sourceKey,
      enabled,
      reason,
      actor: input.actor,
    });
    return json({ ok: true, control });
  }

  if (input.request.method !== 'GET' || input.pathname !== '/operations') return json({ error: 'Method not allowed.' }, 405);

  const [state, controls] = await Promise.all([
    loadNeonAppState(input.databaseUrl),
    loadDiscoverySourceControls(input.databaseUrl),
  ]);
  const records = state.repository.listLeads();
  const runs = state.runStore.listRuns(30);
  const performance = buildSourcePerformance(records);
  const alerts = buildAlerts(performance, runs, controls);

  return html(renderOperationsPage({
    performance,
    runs,
    controls,
    alerts,
    actor: input.actor,
    canManage: input.canManage,
    deployment: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unavailable',
      region: process.env.VERCEL_REGION ?? 'unavailable',
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
      actionsSignal: 'Unreliable: recent GitHub Actions jobs have failed before checkout. Production Vercel build remains the enforced release gate.',
    },
    outreach: {
      sendingEnabled: process.env.OUTREACH_SENDING_ENABLED === 'true',
      dnsReady: process.env.OUTREACH_DNS_READY === 'true',
      dryRun: process.env.OUTREACH_DRY_RUN !== 'false',
      replyPollingEnabled: process.env.OUTREACH_REPLY_POLLING_ENABLED === 'true',
      smtpConfigured: Boolean((process.env.OUTREACH_SMTP_HOST ?? process.env.SMTP_HOST)?.trim()),
      imapConfigured: Boolean(process.env.OUTREACH_IMAP_HOST?.trim()),
      salesMailboxConfigured: Boolean((process.env.SALES_MAILBOX_PASSWORD ?? process.env.SMTP_PASSWORD)?.trim()),
    },
  }));
}

export function buildSourcePerformance(records: StoredLeadRecord[]): SourcePerformance[] {
  const groups = new Map<string, StoredLeadRecord[]>();
  for (const record of records) {
    const key = sourceKey(record.lead);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const totalActive = records.filter((record) => !finalStatuses.has(record.lead.pipelineStatus)).length;
  return [...groups.entries()].map(([key, sourceRecords]) => {
    const active = sourceRecords.filter((record) => !finalStatuses.has(record.lead.pipelineStatus)).length;
    const feedback = sourceRecords.map((record) => record.lead.feedback).filter(Boolean);
    const relevance = feedback.map((item) => item?.relevanceRating).filter((value): value is number => typeof value === 'number');
    const repeatRecommendations: Record<RepeatRecommendation, number> = { increase: 0, keep: 0, reduce: 0, stop: 0 };
    for (const item of feedback) {
      if (item?.repeatRecommendation) repeatRecommendations[item.repeatRecommendation] += 1;
    }
    const performance: SourcePerformance = {
      sourceKey: key,
      label: sourceLabel(key),
      total: sourceRecords.length,
      active,
      activeShare: totalActive > 0 ? active / totalActive : 0,
      contactReady: countStatus(sourceRecords, contactReadyStatuses),
      replied: countStatuses(sourceRecords, ['replied', 'meeting_booked', 'proposal_sent', 'won']),
      meetings: countStatuses(sourceRecords, ['meeting_booked', 'proposal_sent', 'won']),
      proposals: countStatuses(sourceRecords, ['proposal_sent', 'won']),
      won: countStatuses(sourceRecords, ['won']),
      lost: countStatuses(sourceRecords, ['lost']),
      rejected: countStatuses(sourceRecords, ['rejected']),
      priorityA: sourceRecords.filter((record) => record.latestEvaluation?.closeability?.band === 'priority_a').length,
      priorityB: sourceRecords.filter((record) => record.latestEvaluation?.closeability?.band === 'priority_b').length,
      averageRelevance: relevance.length ? relevance.reduce((sum, value) => sum + value, 0) / relevance.length : undefined,
      accurateContacts: feedback.filter((item) => item?.contactAccuracy === 'accurate').length,
      feedbackCount: feedback.length,
      repeatRecommendations,
      recommendation: 'keep',
    };
    performance.recommendation = sourceRecommendation(performance);
    performance.warning = sourceWarning(performance);
    return performance;
  }).sort((left, right) => right.active - left.active || right.total - left.total);
}

function buildAlerts(performance: SourcePerformance[], runs: ProspectDiscoveryRun[], controls: DiscoverySourceControl[]): string[] {
  const alerts = performance.flatMap((source) => source.warning ? [`${source.label}: ${source.warning}`] : []);
  const latest = runs[0];
  if (!latest) alerts.push('No discovery run history is available.');
  else {
    if (latest.errors.length > 0) alerts.push(`Latest discovery run reported ${latest.errors.length} error(s).`);
    if (latest.sourceStats?.some((source) => source.error)) alerts.push('At least one source failed in the latest run; this is distinct from a valid zero-opportunity result.');
  }
  if (controls.find((control) => control.sourceKey === 'remoteok')?.enabled) alerts.push('RemoteOK is enabled even though employee vacancies are not direct sales opportunities.');
  if (process.env.OUTREACH_SENDING_ENABLED === 'true' && process.env.OUTREACH_DNS_READY !== 'true') alerts.push('Outbound sending is enabled while DNS readiness is not confirmed.');
  return [...new Set(alerts)];
}

function sourceRecommendation(source: SourcePerformance): SourcePerformance['recommendation'] {
  if (source.won > 0 || (source.meetings >= 2 && (source.averageRelevance ?? 0) >= 4)) return 'increase';
  if (source.total >= 8 && source.replied === 0 && (source.averageRelevance ?? 3) <= 2.5) return 'stop';
  if ((source.active >= 10 && source.replied === 0) || source.activeShare > 0.5 || source.repeatRecommendations.reduce > source.repeatRecommendations.keep) return 'reduce';
  return 'keep';
}

function sourceWarning(source: SourcePerformance): string | undefined {
  if (source.activeShare > 0.5 && source.active >= 5) return `${percent(source.activeShare)} of active records come from this source.`;
  if (source.active >= 10 && source.replied === 0) return `${source.active} active records have produced no recorded replies.`;
  if (source.total >= 8 && source.feedbackCount >= 3 && (source.averageRelevance ?? 0) < 2.5) return 'BD relevance feedback is consistently weak.';
  return undefined;
}

function sourceKey(lead: Lead): string {
  const source = `${lead.discoverySource ?? ''} ${lead.tender?.portal ?? ''} ${lead.source}`.toLowerCase();
  if (source.includes('bing') || source.includes('public search result')) return 'bing_rss';
  if (source.includes('remoteok')) return 'remoteok';
  if (source.includes('greenhouse')) return 'greenhouse';
  if (source.includes('lever')) return 'lever';
  if (source.includes('ppra') || source.includes('epads')) return 'ppra';
  if (source.includes('canadabuys') || source.includes('canada buys')) return 'canadabuys';
  if (source.includes('ungm')) return 'ungm';
  if (source.includes('manual') || lead.source === 'manual') return 'manual_intake';
  if (lead.source === 'upwork') return 'upwork_manual';
  if (lead.source === 'linkedin' || lead.source === 'sales_navigator') return 'linkedin_manual';
  if (lead.source === 'public_procurement') return 'other_procurement';
  if (lead.source === 'partner_research' || lead.source === 'solution_campaign') return 'partnership_research';
  if (source.includes('rss')) return 'generic_rss';
  return lead.source || 'unknown';
}

function sourceLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countStatus(records: StoredLeadRecord[], statuses: Set<string>): number {
  return records.filter((record) => statuses.has(record.lead.pipelineStatus)).length;
}

function countStatuses(records: StoredLeadRecord[], statuses: string[]): number {
  const statusSet = new Set(statuses);
  return records.filter((record) => statusSet.has(record.lead.pipelineStatus)).length;
}

function renderOperationsPage(input: {
  performance: SourcePerformance[];
  runs: ProspectDiscoveryRun[];
  controls: DiscoverySourceControl[];
  alerts: string[];
  actor: string;
  canManage: boolean;
  deployment: { commit: string; region: string; environment: string; actionsSignal: string };
  outreach: Record<string, boolean>;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sales Operations Health</title><style>${styles()}</style></head><body><main class="shell">
  <header><div><p class="eyebrow">Production observability</p><h1>Sales Operations Health</h1><p>Source quality, concentration, campaigns, deployment and outreach configuration. Signed in as ${escapeHtml(input.actor)}.</p></div><div class="actions"><a class="button ghost" href="/prospects">Prospects</a><a class="button ghost" href="/priorities">Priorities</a><a class="button ghost" href="/portfolio">Proof catalog</a></div></header>
  ${input.alerts.length ? `<section class="alerts"><h2>Needs attention</h2>${input.alerts.map((alert) => `<div>${escapeHtml(alert)}</div>`).join('')}</section>` : '<section class="ok">No current source concentration or configuration warnings.</section>'}
  <section class="metrics"><article><strong>${input.performance.reduce((sum, source) => sum + source.active, 0)}</strong><span>Active prospects</span></article><article><strong>${input.performance.reduce((sum, source) => sum + source.replied, 0)}</strong><span>Replies recorded</span></article><article><strong>${input.performance.reduce((sum, source) => sum + source.meetings, 0)}</strong><span>Meetings</span></article><article><strong>${input.performance.reduce((sum, source) => sum + source.won, 0)}</strong><span>Wins</span></article></section>
  <section class="panel"><div class="panel-title"><div><p class="eyebrow">Commercial quality</p><h2>Performance by source</h2></div><span>Increase only sources producing useful outcomes</span></div><div class="table-wrap"><table><thead><tr><th>Source</th><th>Active / share</th><th>Contact ready</th><th>Replies</th><th>Meetings</th><th>Proposals</th><th>Wins</th><th>Avg. relevance</th><th>Accurate contacts</th><th>Priority A/B</th><th>Recommendation</th></tr></thead><tbody>${input.performance.map(renderPerformanceRow).join('')}</tbody></table></div></section>
  <section class="grid"><article class="panel"><div class="panel-title"><div><p class="eyebrow">Audited controls</p><h2>Discovery sources</h2></div><span>${input.canManage ? 'Admin controls enabled' : 'Read-only'}</span></div>${input.controls.map((control) => renderControl(control, input.canManage)).join('')}</article><article class="panel"><div class="panel-title"><div><p class="eyebrow">Release health</p><h2>Deployment and outreach</h2></div></div><dl><dt>Commit</dt><dd><code>${escapeHtml(input.deployment.commit)}</code></dd><dt>Region</dt><dd>${escapeHtml(input.deployment.region)}</dd><dt>Environment</dt><dd>${escapeHtml(input.deployment.environment)}</dd><dt>GitHub Actions</dt><dd>${escapeHtml(input.deployment.actionsSignal)}</dd>${Object.entries(input.outreach).map(([key,value]) => `<dt>${escapeHtml(label(key))}</dt><dd><span class="state ${value?'on':'off'}">${value?'Yes':'No'}</span></dd>`).join('')}</dl></article></section>
  <section class="panel"><div class="panel-title"><div><p class="eyebrow">Latest automation</p><h2>Discovery runs and source checks</h2></div><span>${input.runs.length} runs</span></div>${input.runs.length ? input.runs.slice(0,10).map(renderRun).join('') : '<div class="empty">No discovery runs recorded.</div>'}</section>
  </main><script>document.querySelectorAll('[data-source-control]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));data.enabled=data.enabled==='true';const status=form.querySelector('[data-status]');status.textContent='Saving…';const response=await fetch('/api/source-controls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await response.json();if(!response.ok){status.textContent=body.error||'Update failed';return;}status.textContent='Saved';setTimeout(()=>location.reload(),500);}));</script></body></html>`;
}

function renderPerformanceRow(source: SourcePerformance): string {
  return `<tr><td><strong>${escapeHtml(source.label)}</strong>${source.warning ? `<small class="warning">${escapeHtml(source.warning)}</small>` : ''}</td><td>${source.active} / ${percent(source.activeShare)}</td><td>${source.contactReady}</td><td>${source.replied}</td><td>${source.meetings}</td><td>${source.proposals}</td><td>${source.won}</td><td>${source.averageRelevance ? source.averageRelevance.toFixed(1) : '—'}</td><td>${source.accurateContacts}/${source.feedbackCount}</td><td>${source.priorityA}/${source.priorityB}</td><td><span class="recommend ${source.recommendation}">${source.recommendation}</span></td></tr>`;
}

function renderControl(control: DiscoverySourceControl, canManage: boolean): string {
  return `<form class="control" data-source-control><div><strong>${escapeHtml(sourceLabel(control.sourceKey))}</strong><span class="state ${control.enabled?'on':'off'}">${control.enabled?'Enabled':'Disabled'}</span><small>${escapeHtml(control.reason ?? '')}<br>Updated by ${escapeHtml(control.updatedBy)} · ${escapeHtml(formatDate(control.updatedAt))}</small></div>${canManage ? `<input type="hidden" name="sourceKey" value="${escapeAttribute(control.sourceKey)}"><select name="enabled"><option value="true" ${control.enabled?'selected':''}>Enable</option><option value="false" ${!control.enabled?'selected':''}>Disable</option></select><input name="reason" required minlength="8" value="${escapeAttribute(control.reason ?? '')}" aria-label="Reason"><button>Save</button><span data-status></span>` : ''}</form>`;
}

function renderRun(run: ProspectDiscoveryRun): string {
  const duration = Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt));
  return `<details class="run"><summary><strong>${escapeHtml(formatDate(run.completedAt))}</strong><span>${run.newLeadCount} new · ${run.duplicateCount} duplicate · ${run.candidateCount} candidates · ${Math.round(duration/1000)}s</span><span class="${run.errors.length?'bad':'good'}">${run.errors.length ? `${run.errors.length} errors` : 'Completed'}</span></summary><div class="run-body"><p><b>Campaigns:</b> ${escapeHtml(run.activeCampaignIds?.join(', ') || 'Not recorded')}</p><p><b>Queries:</b> ${run.searchQueryCount ?? '—'} · <b>Closeability rescored:</b> ${run.closeabilityRescoredCount ?? '—'} · <b>Employment rejected:</b> ${run.employmentRejectedCount ?? 0}</p>${run.sourceStats?.length ? `<table><thead><tr><th>Source</th><th>Checked</th><th>Accepted candidates</th><th>Status</th></tr></thead><tbody>${run.sourceStats.map((source) => `<tr><td>${escapeHtml(source.sourceName)}</td><td>${source.checked}</td><td>${source.acceptedCandidates}</td><td>${source.error ? `<span class="bad">${escapeHtml(source.error)}</span>` : '<span class="good">Success</span>'}</td></tr>`).join('')}</tbody></table>` : '<p>Per-source statistics were not recorded for this historical run.</p>'}</div></details>`;
}

function percent(value: number): string { return `${Math.round(value * 100)}%`; }
function formatDate(value: string): string { return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function label(value: string): string { return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

async function parseBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw) return {};
  if (raw.length > 50_000) throw new Error('Source-control payload is too large.');
  try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
}
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function requiredString(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`); return value.trim(); }
function booleanValue(value: unknown, field: string): boolean { if (value === true || value === 'true') return true; if (value === false || value === 'false') return false; throw new Error(`${field} must be true or false.`); }
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
function html(value: string): Response { return new Response(value, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' } }); }
function escapeHtml(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character] ?? character)); }
function escapeAttribute(value: unknown): string { return escapeHtml(value); }

function styles(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb;line-height:1.4}*{box-sizing:border-box}body{margin:0}.shell{max-width:1440px;margin:auto;padding:28px}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}header h1{margin:3px 0 8px}header p{margin:0;color:#667085}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}.actions{display:flex;gap:9px;flex-wrap:wrap}.button,button{font:inherit;border:0;border-radius:9px;padding:9px 12px;font-weight:750;cursor:pointer}.ghost{background:#fff;border:1px solid #d0d5dd;color:#344054;text-decoration:none}.alerts,.ok,.panel,.metrics article{background:#fff;border:1px solid #e4e7ec;border-radius:16px}.alerts{padding:18px;margin:20px 0;border-color:#fecdca}.alerts h2{margin-top:0}.alerts div{padding:8px 10px;background:#fef3f2;color:#b42318;border-radius:8px;margin-top:7px}.ok{padding:14px;margin:20px 0;color:#027a48;background:#ecfdf3}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.metrics article{padding:16px}.metrics strong{display:block;font-size:28px}.metrics span{color:#667085}.panel{padding:18px;margin-bottom:16px}.panel-title{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:13px}.panel-title h2{margin:2px 0}.panel-title>span{color:#667085;font-size:12px}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:9px;border-bottom:1px solid #eaecf0;vertical-align:top}th{color:#667085;font-size:10px;text-transform:uppercase}.warning{display:block;color:#b54708;margin-top:4px}.recommend,.state{display:inline-block;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:850;text-transform:uppercase}.increase,.on,.good{background:#ecfdf3;color:#027a48}.keep{background:#eff8ff;color:#175cd3}.reduce{background:#fff6ed;color:#b54708}.stop,.off,.bad{background:#fef3f2;color:#b42318}.control{display:grid;grid-template-columns:minmax(220px,1fr) 110px minmax(180px,1fr) auto;gap:8px;align-items:center;padding:11px 0;border-bottom:1px solid #eaecf0}.control small{display:block;color:#667085;margin-top:4px}.control select,.control input{border:1px solid #d0d5dd;border-radius:8px;padding:8px;font:inherit}.control button{background:#3157d5;color:#fff}.control [data-status]{font-size:11px;color:#667085}dl{display:grid;grid-template-columns:160px 1fr;gap:9px;margin:0}dt{font-weight:750;color:#667085}dd{margin:0;overflow-wrap:anywhere}.run{border-top:1px solid #eaecf0;padding:10px 0}.run summary{display:grid;grid-template-columns:200px 1fr auto;gap:12px;cursor:pointer}.run-body{padding:10px 0 0}.empty{text-align:center;padding:26px;color:#667085}@media(max-width:900px){header{display:grid}.metrics,.grid{grid-template-columns:1fr 1fr}.control{grid-template-columns:1fr}.run summary{grid-template-columns:1fr}}@media(max-width:600px){.metrics,.grid{grid-template-columns:1fr}}`;
}
