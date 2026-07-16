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
    const feedback = sourceRecords.map((record) => record.lead.feedback).filter(Boolean);
    const relevance = feedback.map((item) => item?.relevanceRating).filter((value): value is number => typeof value === 'number');
    const repeatRecommendations: Record<RepeatRecommendation, number> = { increase: 0, keep: 0, reduce: 0, stop: 0 };
    for (const item of feedback) if (item?.repeatRecommendation) repeatRecommendations[item.repeatRecommendation] += 1;
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
  return sourceKey(lead).startsWith('linkedin') || lead.source === 'linkedin' || lead.source === 'sales_navigator';
}

function isUpworkRecord(lead: Lead): boolean {
  return sourceKey(lead).startsWith('upwork') || lead.source === 'upwork';
}

function dateBetween(value: string | undefined, afterExclusive: number, beforeInclusive: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > afterExclusive && parsed <= beforeInclusive;
}

function dateBefore(value: string | undefined, before: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= before;
}

function updatedSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return Date.parse(right.lead.updatedAt) - Date.parse(left.lead.updatedAt);
}

function followUpSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return dateValue(left.lead.nextFollowUpAt, Number.MAX_SAFE_INTEGER) - dateValue(right.lead.nextFollowUpAt, Number.MAX_SAFE_INTEGER) || updatedSort(left, right);
}

function deadlineSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return dateValue(left.lead.tender?.deadline, Number.MAX_SAFE_INTEGER) - dateValue(right.lead.tender?.deadline, Number.MAX_SAFE_INTEGER) || updatedSort(left, right);
}

function dateValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceLabel(key: string): string { return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function countStatus(records: StoredLeadRecord[], statuses: Set<PipelineStatus>): number { return records.filter((record) => statuses.has(record.lead.pipelineStatus)).length; }
function countStatuses(records: StoredLeadRecord[], statuses: PipelineStatus[]): number { const statusSet = new Set(statuses); return records.filter((record) => statusSet.has(record.lead.pipelineStatus)).length; }
function percent(value: number): string { return `${Math.round(value * 100)}%`; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function label(value: string): string { return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
async function parseBody(request: Request): Promise<unknown> { const raw = await request.text(); if (!raw) return {}; if (raw.length > 50_000) throw new Error('Source-control payload is too large.'); try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); } }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function requiredString(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`); return value.trim(); }
function booleanValue(value: unknown, field: string): boolean { if (value === true || value === 'true') return true; if (value === false || value === 'false') return false; throw new Error(`${field} must be true or false.`); }
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
function html(value: string): Response { return new Response(value, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' } }); }
function escapeHtml(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character] ?? character)); }
function escapeAttribute(value: unknown): string { return escapeHtml(value); }

function styles(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb;line-height:1.4}*{box-sizing:border-box}body{margin:0}.shell{max-width:1440px;margin:auto;padding:28px}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}header h1{margin:3px 0 8px}header p{margin:0;color:#667085}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}.actions{display:flex;gap:9px;flex-wrap:wrap}.button,button{font:inherit;border:0;border-radius:9px;padding:9px 12px;min-height:44px;font-weight:750;cursor:pointer}.ghost{background:#fff;border:1px solid #d0d5dd;color:#344054;text-decoration:none}.operational-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.operational-metric{display:grid;grid-template-columns:1fr auto;gap:7px 12px;min-height:126px;padding:16px;border:1px solid #e4e7ec;border-radius:16px;background:#fff;color:#172033;text-decoration:none}.operational-metric:hover{border-color:#98a2b3}.operational-metric.active{border-color:#3157d5;box-shadow:0 0 0 2px rgba(49,87,213,.12)}.operational-metric span{font-size:12px;font-weight:800}.operational-metric strong{font-size:29px}.operational-metric small{grid-column:1/-1;color:#667085;line-height:1.45}.alerts,.ok,.panel{background:#fff;border:1px solid #e4e7ec;border-radius:16px}.alerts{padding:18px;margin:16px 0;border-color:#fecdca}.alerts h2{margin-top:0}.alerts div{padding:8px 10px;background:#fef3f2;color:#b42318;border-radius:8px;margin-top:7px}.ok{padding:14px;margin:16px 0;color:#027a48;background:#ecfdf3}.panel{padding:18px;margin-bottom:16px}.panel-title{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:13px}.panel-title h2{margin:2px 0}.panel-title p{margin:4px 0 0;color:#667085}.panel-title>span{color:#667085;font-size:12px}.metric-summary{font-weight:750;color:#344054!important}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:9px;border-bottom:1px solid #eaecf0;vertical-align:top}th{color:#667085;font-size:10px;text-transform:uppercase;white-space:nowrap}td small{display:block;color:#667085;margin-top:4px}.exact-records td:nth-child(1){min-width:230px}.exact-records td:nth-child(5){min-width:250px}.pipeline-status,.recommend,.state{display:inline-block;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:850;text-transform:uppercase;background:#f2f4f7;color:#344054}.warning{display:block;color:#b54708;margin-top:4px}.increase,.on,.good{background:#ecfdf3;color:#027a48}.keep{background:#eff8ff;color:#175cd3}.reduce{background:#fff6ed;color:#b54708}.stop,.off,.bad{background:#fef3f2;color:#b42318}.control{display:grid;grid-template-columns:minmax(220px,1fr) 110px minmax(180px,1fr) auto;gap:8px;align-items:center;padding:11px 0;border-bottom:1px solid #eaecf0}.control small{display:block;color:#667085;margin-top:4px}.control select,.control input{border:1px solid #d0d5dd;border-radius:8px;padding:8px;min-height:44px;font:inherit}.control button{background:#3157d5;color:#fff}.control [data-status]{font-size:11px;color:#667085}dl{display:grid;grid-template-columns:160px 1fr;gap:9px;margin:0}dt{font-weight:750;color:#667085}dd{margin:0;overflow-wrap:anywhere}.run{border-top:1px solid #eaecf0;padding:10px 0}.run summary{display:grid;grid-template-columns:200px 1fr auto;gap:12px;min-height:44px;align-items:center;cursor:pointer}.run-body{padding:10px 0 0}.empty{text-align:center;padding:26px;color:#667085}@media(max-width:1100px){.operational-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}.control{grid-template-columns:1fr}}@media(max-width:700px){.shell{padding:16px}header{display:grid}.operational-metrics{grid-template-columns:1fr}.panel-title{align-items:flex-start;flex-direction:column}.run summary{grid-template-columns:1fr}}`;
}
