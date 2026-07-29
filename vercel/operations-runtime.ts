import type { ProspectVisibility } from '@sales-automation/neon-state';
import type { DiscoverySourceControl } from '@sales-automation/neon-state/source-controls';
import type { ProspectDiscoveryRun } from '@sales-automation/prospect-discovery';
import type { Lead, PipelineStatus, RepeatRecommendation } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

export interface OperationsRuntimeInput {
  request: Request;
  databaseUrl: string;
  pathname: string;
  actor: string;
  canManage: boolean;
}

interface OperationsAccess {
  identifier: string;
  displayName: string;
  scopeKind: string;
  scopeLabel: string;
  visibleOwnerTokens: string[];
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

type OperationalMetricId =
  | 'qualified'
  | 'due-next-24h'
  | 'overdue'
  | 'linkedin'
  | 'upwork'
  | 'procurement-deadlines'
  | 'unassigned'
  | 'weekly-outcomes';

interface OperationalMetricDefinition {
  id: OperationalMetricId;
  label: string;
  description: string;
  records: StoredLeadRecord[];
  summary?: string;
}

interface WeeklyOutcomeCounts {
  replied: number;
  meetings: number;
  proposals: number;
  won: number;
  lost: number;
}

const finalStatuses = new Set<PipelineStatus>(['won', 'lost', 'rejected', 'archived']);
const contactReadyStatuses = new Set<PipelineStatus>(['approved_to_contact', 'draft_ready', 'sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won']);
const weeklyOutcomeStatuses = new Set<PipelineStatus>(['replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']);
const DAY_MS = 24 * 60 * 60 * 1000;

export async function handleOperationsRuntime(input: OperationsRuntimeInput): Promise<Response> {
  const [neonState, sourceControls, web] = await Promise.all([
    import('@sales-automation/neon-state'),
    import('@sales-automation/neon-state/source-controls'),
    import('@sales-automation/web'),
  ]);

  if (input.request.method === 'POST' && input.pathname === '/api/source-controls') {
    if (!input.canManage) return json({ error: 'Forbidden: source controls are restricted to Admin and Waseem.' }, 403);
    const payload = asObject(await parseBody(input.request));
    const sourceKey = requiredString(payload.sourceKey, 'sourceKey');
    if (!sourceControls.isDiscoverySourceKey(sourceKey)) return json({ error: 'sourceKey is invalid.' }, 400);
    const enabled = booleanValue(payload.enabled, 'enabled');
    const reason = requiredString(payload.reason, 'reason');
    const control = await sourceControls.updateDiscoverySourceControl(input.databaseUrl, {
      sourceKey,
      enabled,
      reason,
      actor: input.actor,
    });
    return json({ ok: true, control });
  }

  if (input.request.method !== 'GET' || input.pathname !== '/operations') return json({ error: 'Method not allowed.' }, 405);

  const access = web.resolveDashboardAccess(input.actor, input.actor) as OperationsAccess;
  const visibility: ProspectVisibility = {
    canViewAll: access.scopeKind === 'all',
    ownerTokens: access.visibleOwnerTokens,
  };
  const generatedAt = new Date().toISOString();
  const [records, runs, controls] = await Promise.all([
    neonState.loadNeonScopedRecords(input.databaseUrl, visibility),
    neonState.loadNeonDiscoveryRuns(input.databaseUrl, 30),
    sourceControls.loadDiscoverySourceControls(input.databaseUrl),
  ]);
  const performance = buildSourcePerformance(records);
  const alerts = buildAlerts(performance, runs, controls);
  const metrics = buildOperationalMetrics(records, generatedAt);
  const requestedMetric = operationalMetricValue(new URL(input.request.url).searchParams.get('metric'));
  const selectedMetric = metrics.find((metric) => metric.id === requestedMetric) ?? metrics[0]!;

  return html(renderOperationsPage({
    performance,
    records,
    metrics,
    selectedMetric,
    runs,
    controls,
    alerts,
    actor: input.actor,
    scopeLabel: access.scopeLabel,
    canManage: input.canManage,
    generatedAt,
    deployment: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unavailable',
      region: process.env.VERCEL_REGION ?? 'unavailable',
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
      actionsSignal: 'Best effort. Production Vercel deployment and protected route checks remain the release gate.',
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

export function buildOperationalMetrics(records: StoredLeadRecord[], generatedAt: string): OperationalMetricDefinition[] {
  const now = Date.parse(generatedAt);
  const active = records.filter((record) => !finalStatuses.has(record.lead.pipelineStatus));
  const weekStart = now - 7 * DAY_MS;
  const weeklyRecords = records.filter((record) => weeklyOutcomeEvents(record, weekStart).length > 0);
  const weeklyCounts = weeklyOutcomeCounts(records, weekStart);
  return [
    {
      id: 'qualified',
      label: 'Qualified active leads',
      description: 'Active records already approved, drafted, contacted or progressing commercially.',
      records: active.filter((record) => contactReadyStatuses.has(record.lead.pipelineStatus)).sort(updatedSort),
    },
    {
      id: 'due-next-24h',
      label: 'Due next 24h',
      description: 'Scheduled follow-ups due after now and within the next 24 hours.',
      records: active.filter((record) => dateBetween(record.lead.nextFollowUpAt, now, now + DAY_MS)).sort(followUpSort),
    },
    {
      id: 'overdue',
      label: 'Overdue follow-ups',
      description: 'Active records whose scheduled follow-up time has already passed.',
      records: active.filter((record) => dateBefore(record.lead.nextFollowUpAt, now)).sort(followUpSort),
    },
    {
      id: 'linkedin',
      label: 'LinkedIn opportunities',
      description: 'Active records sourced through LinkedIn, Sales Navigator or LinkedIn signal intake.',
      records: active.filter((record) => isLinkedInRecord(record.lead)).sort(updatedSort),
    },
    {
      id: 'upwork',
      label: 'Upwork opportunities',
      description: 'Active records sourced through Upwork manual or saved-search intake.',
      records: active.filter((record) => isUpworkRecord(record.lead)).sort(updatedSort),
    },
    {
      id: 'procurement-deadlines',
      label: 'Procurement deadlines',
      description: 'Active tenders with a confirmed deadline within the next 14 days.',
      records: active.filter((record) => dateBetween(record.lead.tender?.deadline, now, now + 14 * DAY_MS)).sort(deadlineSort),
    },
    {
      id: 'unassigned',
      label: 'Unassigned leads',
      description: 'Active records that still require a named owner.',
      records: active.filter((record) => !record.lead.owner?.trim()).sort(updatedSort),
    },
    {
      id: 'weekly-outcomes',
      label: 'Weekly outcomes',
      description: 'Records with a reply, meeting, proposal, win or loss status event in the last seven days.',
      records: weeklyRecords.sort(updatedSort),
      summary: `${weeklyCounts.replied} replies · ${weeklyCounts.meetings} meetings · ${weeklyCounts.proposals} proposals · ${weeklyCounts.won} wins · ${weeklyCounts.lost} losses`,
    },
  ];
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
    const feedback = sourceRecords.flatMap((record) => record.lead.feedback ? [record.lead.feedback] : []);
    const relevance = feedback.flatMap((item) => typeof item.relevanceRating === 'number' ? [item.relevanceRating] : []);
    const repeatRecommendations: Record<RepeatRecommendation, number> = { increase: 0, keep: 0, reduce: 0, stop: 0 };
    for (const item of feedback) if (item.repeatRecommendation) repeatRecommendations[item.repeatRecommendation] += 1;
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
      accurateContacts: feedback.filter((item) => item.contactAccuracy === 'accurate').length,
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
  if (source.includes('upwork saved-search') || source.includes('upwork saved search')) return 'upwork_saved_search_inbox';
  if (source.includes('linkedin signal') || source.includes('sales navigator')) return 'linkedin_signal_inbox';
  if (source.includes('linkedin public index')) return 'linkedin_public_index';
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

function renderOperationsPage(input: {
  performance: SourcePerformance[];
  records: StoredLeadRecord[];
  metrics: OperationalMetricDefinition[];
  selectedMetric: OperationalMetricDefinition;
  runs: ProspectDiscoveryRun[];
  controls: DiscoverySourceControl[];
  alerts: string[];
  actor: string;
  scopeLabel: string;
  canManage: boolean;
  generatedAt: string;
  deployment: { commit: string; region: string; environment: string; actionsSignal: string };
  outreach: Record<string, boolean>;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sales Operations Dashboard</title><style>${styles()}</style></head><body><main class="shell">
  <header><div><p class="eyebrow">${escapeHtml(input.scopeLabel)}</p><h1>Sales Operations Dashboard</h1><p>Owner-scoped action metrics, weekly outcomes, source quality and release health. Signed in as ${escapeHtml(input.actor)}.</p></div><div class="actions"><a class="button ghost" href="/prospects">Prospects</a><a class="button ghost" href="/priorities">Priorities</a><a class="button ghost" href="/portfolio">Proof catalog</a></div></header>
  <section class="operational-metrics" aria-label="Exact operational metrics">${input.metrics.map((metric) => renderOperationalMetric(metric, input.selectedMetric.id)).join('')}</section>
  <section class="panel exact-records" data-operational-metric="${escapeAttribute(input.selectedMetric.id)}"><div class="panel-title"><div><p class="eyebrow">Exact owner-scoped record set</p><h2>${escapeHtml(input.selectedMetric.label)}</h2><p>${escapeHtml(input.selectedMetric.description)}</p>${input.selectedMetric.summary ? `<p class="metric-summary">${escapeHtml(input.selectedMetric.summary)}</p>` : ''}</div><span>${input.selectedMetric.records.length} record${input.selectedMetric.records.length === 1 ? '' : 's'}</span></div>${input.selectedMetric.records.length ? `<div class="table-wrap"><table><thead><tr><th>Opportunity</th><th>Source</th><th>Owner</th><th>Status</th><th>Next action</th><th>Follow-up / deadline</th><th>Updated</th></tr></thead><tbody>${input.selectedMetric.records.map((record) => renderOperationalRecord(record, input.selectedMetric.id, input.generatedAt)).join('')}</tbody></table></div>` : `<div class="empty">No records currently match this exact metric.</div>`}</section>
  ${input.alerts.length ? `<section class="alerts"><h2>Needs attention</h2>${input.alerts.map((alert) => `<div>${escapeHtml(alert)}</div>`).join('')}</section>` : '<section class="ok">No current source concentration or configuration warnings.</section>'}
  <section class="panel"><div class="panel-title"><div><p class="eyebrow">Commercial quality</p><h2>Performance by source</h2></div><span>Scoped to the signed-in account</span></div><div class="table-wrap"><table><thead><tr><th>Source</th><th>Active / share</th><th>Contact ready</th><th>Replies</th><th>Meetings</th><th>Proposals</th><th>Wins</th><th>Avg. relevance</th><th>Accurate contacts</th><th>Priority A/B</th><th>Recommendation</th></tr></thead><tbody>${input.performance.map(renderPerformanceRow).join('')}</tbody></table></div></section>
  <section class="grid"><article class="panel"><div class="panel-title"><div><p class="eyebrow">Audited controls</p><h2>Discovery sources</h2></div><span>${input.canManage ? 'Admin controls enabled' : 'Read-only'}</span></div>${input.controls.map((control) => renderControl(control, input.canManage)).join('')}</article><article class="panel"><div class="panel-title"><div><p class="eyebrow">Release health</p><h2>Deployment and outreach</h2></div></div><dl><dt>Commit</dt><dd><code>${escapeHtml(input.deployment.commit)}</code></dd><dt>Region</dt><dd>${escapeHtml(input.deployment.region)}</dd><dt>Environment</dt><dd>${escapeHtml(input.deployment.environment)}</dd><dt>Release gate</dt><dd>${escapeHtml(input.deployment.actionsSignal)}</dd>${Object.entries(input.outreach).map(([key,value]) => `<dt>${escapeHtml(label(key))}</dt><dd><span class="state ${value?'on':'off'}">${value?'Yes':'No'}</span></dd>`).join('')}</dl></article></section>
  <section class="panel"><div class="panel-title"><div><p class="eyebrow">Latest automation</p><h2>Discovery runs and source checks</h2></div><span>${input.runs.length} runs</span></div>${input.runs.length ? input.runs.slice(0,10).map(renderRun).join('') : '<div class="empty">No run history yet.</div>'}</section>
  </main>${input.canManage ? `<script>document.querySelectorAll('[data-source-control]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const status=form.querySelector('[data-status]');status.textContent='Saving…';const response=await fetch('/api/source-controls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const body=await response.json();status.textContent=response.ok?'Saved':body.error||'Failed';if(response.ok)setTimeout(()=>location.reload(),350);}));</script>` : ''}</body></html>`;
}

function renderOperationalMetric(metric: OperationalMetricDefinition, selected: OperationalMetricId): string {
  return `<a class="operational-metric ${metric.id === selected ? 'active' : ''}" href="${escapeAttribute(operationalMetricUrl(metric.id))}" ${metric.id === selected ? 'aria-current="page"' : ''} data-operational-metric-link="${escapeAttribute(metric.id)}"><span>${escapeHtml(metric.label)}</span><strong>${metric.records.length}</strong><small>${escapeHtml(metric.summary ?? metric.description)}</small></a>`;
}

function renderOperationalRecord(record: StoredLeadRecord, metricId: OperationalMetricId, generatedAt: string): string {
  const lead = record.lead;
  const followUpOrDeadline = lead.tender?.deadline
    ? `Deadline ${formatDate(lead.tender.deadline)}`
    : lead.nextFollowUpAt
      ? `${dateBefore(lead.nextFollowUpAt, Date.parse(generatedAt)) ? 'Overdue ' : ''}${formatDate(lead.nextFollowUpAt)}`
      : 'Not scheduled';
  const outcomeEvents = metricId === 'weekly-outcomes'
    ? weeklyOutcomeEvents(record, Date.parse(generatedAt) - 7 * DAY_MS).map(label).join(' · ')
    : '';
  const nextAction = outcomeEvents || lead.recommendedNextAction || record.latestEvaluation?.recommendedNextAction || 'Review evidence and define the next human-owned action.';
  return `<tr><td><strong><a href="/prospects?leadId=${encodeURIComponent(lead.id)}">${escapeHtml(lead.companyName ?? lead.title)}</a></strong><small>${escapeHtml(lead.title)}</small></td><td>${escapeHtml(sourceLabel(sourceKey(lead)))}</td><td>${escapeHtml(lead.owner ?? 'Unassigned')}</td><td><span class="pipeline-status">${escapeHtml(label(lead.pipelineStatus))}</span></td><td>${escapeHtml(nextAction)}</td><td>${escapeHtml(followUpOrDeadline)}</td><td>${escapeHtml(formatDate(lead.updatedAt))}</td></tr>`;
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

function weeklyOutcomeCounts(records: StoredLeadRecord[], weekStart: number): WeeklyOutcomeCounts {
  const counts: WeeklyOutcomeCounts = { replied: 0, meetings: 0, proposals: 0, won: 0, lost: 0 };
  for (const record of records) {
    for (const status of weeklyOutcomeEvents(record, weekStart)) {
      if (status === 'replied') counts.replied += 1;
      if (status === 'meeting_booked') counts.meetings += 1;
      if (status === 'proposal_sent') counts.proposals += 1;
      if (status === 'won') counts.won += 1;
      if (status === 'lost') counts.lost += 1;
    }
  }
  return counts;
}

function weeklyOutcomeEvents(record: StoredLeadRecord, weekStart: number): PipelineStatus[] {
  return record.auditLog.flatMap((entry) => {
    if (entry.action !== 'status_changed' || Date.parse(entry.createdAt) < weekStart) return [];
    const metadataStatus = typeof entry.metadata?.status === 'string' ? entry.metadata.status : undefined;
    const messageStatus = entry.message.match(/\bto ([a-z_]+)\b/i)?.[1];
    const status = metadataStatus ?? messageStatus;
    return status && isPipelineStatus(status) && weeklyOutcomeStatuses.has(status) ? [status] : [];
  });
}

function isPipelineStatus(value: string): value is PipelineStatus {
  return ['new', 'needs_research', 'approved_to_contact', 'draft_ready', 'sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost', 'rejected', 'archived'].includes(value);
}

function operationalMetricValue(value: string | null): OperationalMetricId {
  return ['qualified', 'due-next-24h', 'overdue', 'linkedin', 'upwork', 'procurement-deadlines', 'unassigned', 'weekly-outcomes'].includes(value ?? '')
    ? value as OperationalMetricId
    : 'qualified';
}

function operationalMetricUrl(metric: OperationalMetricId): string {
  return `/operations?metric=${encodeURIComponent(metric)}`;
}

function isLinkedInRecord(lead: Lead): boolean {
  return lead.source === 'linkedin' || lead.source === 'sales_navigator' || sourceKey(lead).startsWith('linkedin_');
}

function isUpworkRecord(lead: Lead): boolean {
  return lead.source === 'upwork' || sourceKey(lead).startsWith('upwork_');
}

function dateBetween(value: string | undefined, start: number, end: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= start && parsed <= end;
}

function dateBefore(value: string | undefined, before: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed < before;
}

function updatedSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return Date.parse(right.lead.updatedAt) - Date.parse(left.lead.updatedAt);
}

function followUpSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return Date.parse(left.lead.nextFollowUpAt ?? left.lead.updatedAt) - Date.parse(right.lead.nextFollowUpAt ?? right.lead.updatedAt);
}

function deadlineSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return Date.parse(left.lead.tender?.deadline ?? left.lead.updatedAt) - Date.parse(right.lead.tender?.deadline ?? right.lead.updatedAt);
}

function countStatus(records: StoredLeadRecord[], statuses: Set<PipelineStatus>): number {
  return records.filter((record) => statuses.has(record.lead.pipelineStatus)).length;
}

function countStatuses(records: StoredLeadRecord[], statuses: PipelineStatus[]): number {
  const accepted = new Set(statuses);
  return records.filter((record) => accepted.has(record.lead.pipelineStatus)).length;
}

function sourceLabel(value: string): string {
  return value.split('_').map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : '').join(' ');
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().replace('T', ' ').slice(0, 16);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function booleanValue(value: unknown, field: string): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${field} must be true or false.`);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A JSON object is required.');
  return value as Record<string, unknown>;
}

async function parseBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new Error('Request body must be valid JSON.'); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function styles(): string {
  return `:root{color-scheme:dark;--bg:#08111f;--panel:#111d2e;--border:#2a3d57;--text:#e5eef9;--muted:#91a6be;--accent:#62d3ae;--warn:#ffcc7a;--bad:#ff8f8f}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,#152a44 0,#08111f 42%);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}.shell{max-width:1500px;margin:auto;padding:30px}header,.panel-title,.run summary,.control{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}header{margin-bottom:22px}.eyebrow{margin:0;color:var(--accent);text-transform:uppercase;letter-spacing:.13em;font-weight:800;font-size:11px}h1,h2{margin:.3rem 0}.actions,.operational-metrics{display:flex;gap:10px;flex-wrap:wrap}.button,.operational-metric{border:1px solid var(--border);background:var(--panel);color:var(--text);text-decoration:none;border-radius:12px;padding:10px 13px}.operational-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));margin-bottom:16px}.operational-metric{display:grid;gap:3px}.operational-metric strong{font-size:24px}.operational-metric small,.panel-title p,small{color:var(--muted)}.operational-metric.active{border-color:var(--accent);box-shadow:0 0 0 1px rgba(98,211,174,.35)}.panel{background:rgba(17,29,46,.92);border:1px solid var(--border);border-radius:16px;padding:18px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;padding:10px;border-bottom:1px solid rgba(145,166,190,.18);vertical-align:top}th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}td small{display:block;max-width:360px}.exact-records td:nth-child(5){min-width:260px}.alerts,.ok{border:1px solid var(--border);border-radius:12px;padding:13px;margin-bottom:16px}.alerts{border-color:#865f2f;background:#2c2114}.ok{border-color:#276650;background:#102a23}.control{padding:12px 0;border-bottom:1px solid rgba(145,166,190,.18)}.control select,.control input,.control button{background:#091321;color:var(--text);border:1px solid var(--border);padding:8px;border-radius:8px}.state,.pipeline-status,.recommend{display:inline-block;border-radius:999px;padding:3px 8px;margin-left:7px;background:#24354a}.state.on,.good,.recommend.increase{color:var(--accent)}.state.off,.bad,.warning,.recommend.stop{color:var(--bad)}.recommend.reduce{color:var(--warn)}.run{border-top:1px solid rgba(145,166,190,.18);padding:10px 0}.run summary{cursor:pointer}.run-body{padding:8px 0 0}.empty{padding:18px;color:var(--muted);text-align:center}.metric-summary{font-weight:700;color:var(--text)!important}@media(max-width:850px){.grid{grid-template-columns:1fr}.shell{padding:18px}header{display:block}.actions{margin-top:12px}}`;
}
