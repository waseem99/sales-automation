import type { ProspectPageResult } from '@sales-automation/neon-state';
import type { Lead, PipelineStatus } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

const WORKFLOW_CSS = '/assets/prospect-workflow.v1.css';
const WORKFLOW_JS = '/assets/prospect-workflow.v1.js';
const CLOSED_STATUSES = new Set<PipelineStatus>(['won', 'lost', 'rejected', 'archived']);

export interface ProspectWorkflowUiOptions {
  activeRoute: string;
  records: StoredLeadRecord[];
  selected?: StoredLeadRecord;
  generatedAt: string;
  page: number;
  pageSize: number;
  query: ProspectPageResult['query'];
}

export function enhanceProspectWorkflowUi(html: string, options: ProspectWorkflowUiOptions): string {
  let output = html;
  const tablePattern = /<thead>[\s\S]*?<\/thead><tbody id="prospect-rows">[\s\S]*?<\/tbody>/;
  if (!tablePattern.test(output)) throw new Error('Prospect workflow table boundary is missing.');
  output = output.replace(tablePattern, renderWorkflowTable(options));
  output = output.replace(
    '<div class="section-heading"><div><h2>',
    `${renderWorkflowControls(options)}<div class="section-heading workflow-section-heading"><div><h2>`,
  );
  if (options.selected) output = enhanceSelectedDetail(output, options.selected, options.generatedAt);
  if (!output.includes('data-prospect-workflow-table')) throw new Error('Prospect workflow table did not attach.');
  if (!output.includes(WORKFLOW_CSS)) output = output.replace('</head>', `<link rel="stylesheet" href="${WORKFLOW_CSS}" /></head>`);
  if (!output.includes(WORKFLOW_JS)) output = output.replace('</body>', `<script src="${WORKFLOW_JS}" defer></script></body>`);
  return output;
}

function renderWorkflowControls(options: ProspectWorkflowUiOptions): string {
  const views = [
    ['all', 'All', {}],
    ['due', 'Due now', { followUp: 'due' }],
    ['unassigned', 'Unassigned', { owner: 'unassigned' }],
    ['research', 'Needs research', { status: 'needs_research' }],
    ['contact-ready', 'Contact ready', { status: 'approved_to_contact' }],
  ] as const;
  return `<div class="workflow-controls" aria-label="Prospect review controls"><div class="workflow-saved-views"><span>Saved views</span>${views.map(([id, labelText, filters]) => `<a class="workflow-view metric-link ${isActiveView(id, options.query) ? 'active' : ''}" href="${escapeAttribute(viewUrl(options, filters))}" ${isActiveView(id, options.query) ? 'aria-current="page"' : ''}>${escapeHtml(labelText)}</a>`).join('')}</div><div class="workflow-display-controls"><span>Density</span><button type="button" data-workflow-density="comfortable" aria-pressed="true">Comfortable</button><button type="button" data-workflow-density="compact" aria-pressed="false">Compact</button></div></div>`;
}

function renderWorkflowTable(options: ProspectWorkflowUiOptions): string {
  const rows = options.records.length > 0
    ? options.records.map((record) => renderWorkflowRow(record, options)).join('')
    : '<tr><td colspan="6" class="empty">No prospects match this workspace and filter set.</td></tr>';
  return `<thead data-prospect-workflow-table><tr><th>Opportunity</th><th>Source</th><th><button type="button" class="workflow-sort" data-workflow-sort="score" aria-label="Sort by score">Service & score</button></th><th>Owner & status</th><th>Next action</th><th><button type="button" class="workflow-sort" data-workflow-sort="followup" aria-label="Sort by follow-up">Follow-up & updated</button></th></tr></thead><tbody id="prospect-rows">${rows}</tbody>`;
}

function renderWorkflowRow(record: StoredLeadRecord, options: ProspectWorkflowUiOptions): string {
  const lead = record.lead;
  const score = evaluationScore(record);
  const band = scoreBand(score);
  const owner = lead.owner ?? 'unassigned';
  const feedback = lead.feedback?.status ?? 'pending';
  const nextAction = lead.recommendedNextAction ?? defaultNextAction(lead);
  const verified = Boolean((lead.evidenceUrl ?? lead.sourceUrl) && lead.evidenceSummary?.trim());
  const overdue = isOverdue(lead, options.generatedAt);
  const duplicate = isDuplicate(record);
  const link = recordUrl(options, lead.id);
  const searchText = [lead.companyName, lead.title, lead.contactName, lead.contactRole, lead.contactEmail, lead.serviceCategory, lead.serviceOffer, lead.materialsToShare, lead.owner, lead.discoverySource, lead.source, lead.leadType, lead.evidenceSummary, nextAction, ...record.notes].filter(Boolean).join(' ').toLowerCase();
  const indicators = [
    `<span class="workflow-indicator new" data-new-indicator hidden>New</span>`,
    verified ? '<span class="workflow-indicator verified">Evidence verified</span>' : '<span class="workflow-indicator missing">Evidence incomplete</span>',
    overdue ? '<span class="workflow-indicator overdue">Overdue</span>' : '',
    duplicate ? '<span class="workflow-indicator duplicate">Possible duplicate</span>' : '',
  ].filter(Boolean).join('');
  return `<tr class="prospect-row ${lead.id === options.selected?.lead.id ? 'selected' : ''}" data-search="${escapeAttribute(searchText)}" data-status="${escapeAttribute(lead.pipelineStatus)}" data-signal="${escapeAttribute(lead.opportunityStatus ?? '')}" data-service="${escapeAttribute(lead.serviceCategory)}" data-owner="${escapeAttribute(owner)}" data-feedback="${escapeAttribute(feedback)}" data-score="${score ?? -1}" data-score-band="${band}" data-follow-up="${lead.nextFollowUpAt ? Date.parse(lead.nextFollowUpAt) : Number.MAX_SAFE_INTEGER}" data-updated="${Date.parse(lead.updatedAt)}" data-created-at="${escapeAttribute(lead.createdAt)}"><td class="workflow-opportunity"><a href="${escapeAttribute(link)}"><strong>${escapeHtml(lead.companyName ?? lead.title)}</strong><span>${escapeHtml(shorten(lead.title, 86))}</span></a><div class="workflow-indicators">${indicators}</div></td><td><strong>${escapeHtml(label(lead.discoverySource ?? lead.source))}</strong><span>${escapeHtml(label(lead.leadType))}</span></td><td><span class="pill service">${escapeHtml(label(lead.serviceCategory))}</span><div class="workflow-score"><strong>${score ?? '—'}</strong><span>${band}</span></div></td><td><strong>${escapeHtml(lead.owner ?? 'Unassigned')}</strong><span class="pill workflow-status">${escapeHtml(label(lead.pipelineStatus))}</span></td><td class="workflow-next-action"><strong>${escapeHtml(shorten(nextAction, 110))}</strong><span>${escapeHtml(lead.followUpNote ?? lead.reachMethod ?? 'Human review required before external action.')}</span></td><td class="workflow-dates">${lead.nextFollowUpAt ? `<strong class="${overdue ? 'overdue-text' : ''}">${escapeHtml(formatDateTime(lead.nextFollowUpAt))}</strong>` : '<strong class="muted">Not scheduled</strong>'}<span>Updated ${escapeHtml(formatDateTime(lead.updatedAt))}</span></td></tr>`;
}

function enhanceSelectedDetail(html: string, record: StoredLeadRecord, generatedAt: string): string {
  const actionPattern = /<section class="detail-section action-forms"><h3>Assign and manage<\/h3>([\s\S]*?)<\/section>/;
  const actionMatch = html.match(actionPattern);
  const actionForms = actionMatch?.[1] ?? '';
  let output = html.replace(actionPattern, '');
  const lead = record.lead;
  const score = evaluationScore(record);
  const band = scoreBand(score);
  const nextAction = lead.recommendedNextAction ?? defaultNextAction(lead);
  const missing = missingData(lead);
  const indicators = [
    isOverdue(lead, generatedAt) ? '<span class="workflow-indicator overdue">Follow-up overdue</span>' : '',
    (lead.evidenceUrl ?? lead.sourceUrl) && lead.evidenceSummary ? '<span class="workflow-indicator verified">Evidence verified</span>' : '<span class="workflow-indicator missing">Evidence incomplete</span>',
    isDuplicate(record) ? '<span class="workflow-indicator duplicate">Possible duplicate</span>' : '',
  ].filter(Boolean).join('');
  const decision = `<section class="decision-workspace" id="next-action" aria-label="Top next action"><div class="decision-summary"><div><p class="eyebrow">Top next action</p><h3>${escapeHtml(nextAction)}</h3><p>${escapeHtml(lead.followUpNote ?? lead.reachMethod ?? 'Confirm evidence, owner and timing before taking any external action.')}</p><div class="workflow-indicators">${indicators}</div></div><div class="decision-score"><strong>${score ?? '—'}</strong><span>Priority ${band}</span></div></div>${actionForms ? `<div class="decision-actions">${actionForms}</div>` : ''}</section><nav class="detail-jump-links" aria-label="Lead detail sections"><a href="#buyer-contact">Buyer</a><a href="#source-evidence">Evidence</a><a href="#commercial-fit">Commercial fit</a><a href="#outreach-plan">Outreach</a><a href="#activity-history">Activity</a></nav>`;
  output = output.replace('<div class="detail-header">', `${decision}<div class="detail-header">`);
  output = output.replace('<div class="detail-grid">', '<section class="detail-overview" id="buyer-contact" data-detail-section="buyer-contact"><h3>Buyer and contact</h3><div class="detail-grid">');
  output = output.replace(/<\/div>\s*<section class="detail-section evidence">/, '</div></section><section class="detail-section evidence" id="source-evidence" data-detail-section="source-evidence">');
  output = output.replace('<h3>Why this prospect is here</h3>', '<h3>Source evidence</h3>');
  output = output.replace('<section class="detail-section service-box"><h3>Service and sales package</h3>', '<section class="detail-section service-box" id="commercial-fit" data-detail-section="commercial-fit"><h3>Commercial fit and proof plan</h3>');
  output = output.replace('<section class="detail-section"><h3>Recommended outreach</h3>', '<section class="detail-section" id="outreach-plan" data-detail-section="outreach-plan"><h3>Outreach draft and proof</h3>');
  output = output.replace('<section class="detail-section guidance-box"><h3>Engagement intelligence</h3>', '<section class="detail-section guidance-box" id="engagement-intelligence" data-detail-section="engagement-intelligence"><h3>Engagement intelligence</h3>');
  output = output.replace('<section class="detail-section routing-box"><h3>Reply routing</h3>', '<section class="detail-section routing-box" id="reply-routing" data-detail-section="reply-routing"><h3>Buyer contact and reply routing</h3>');
  output = output.replace('<section class="detail-section"><h3>Log team activity</h3>', '<section class="detail-section" id="log-activity" data-detail-section="log-activity"><h3>Log team activity</h3>');
  output = output.replace('<section class="detail-section feedback-box">', `<section class="detail-section feedback-box" id="missing-data" data-detail-section="missing-data"><div class="missing-data-summary"><strong>Missing data</strong><span>${escapeHtml(missing.length ? missing.join(' · ') : 'No critical buyer or evidence fields missing')}</span></div>`);
  output = output.replace('<section class="detail-section"><h3>Activity timeline</h3>', '<section class="detail-section" id="activity-history" data-detail-section="activity-history"><h3>Activity history</h3>');
  return output;
}

function recordUrl(options: ProspectWorkflowUiOptions, leadId: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query)) if (value) params.set(key, String(value));
  params.set('page', String(options.page));
  params.set('pageSize', String(options.pageSize));
  params.set('leadId', leadId);
  return `${options.activeRoute}?${params.toString()}`;
}

function viewUrl(options: ProspectWorkflowUiOptions, filters: Record<string, string>): string {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('pageSize', String(options.pageSize));
  for (const [key, value] of Object.entries(filters)) params.set(key, value);
  return `${options.activeRoute}?${params.toString()}`;
}

function isActiveView(id: string, query: ProspectPageResult['query']): boolean {
  if (id === 'due') return query.followUp === 'due';
  if (id === 'unassigned') return query.owner === 'unassigned';
  if (id === 'research') return query.status === 'needs_research';
  if (id === 'contact-ready') return query.status === 'approved_to_contact';
  return !query.search && !query.status && !query.signal && !query.service && !query.owner && !query.feedback && !query.followUp;
}

function evaluationScore(record: StoredLeadRecord): number | undefined {
  const value = record.latestEvaluation?.score.total ?? record.lead.score?.total;
  return Number.isFinite(value) ? Number(value) : undefined;
}

function scoreBand(score: number | undefined): string {
  if (score === undefined) return 'Review';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'Research';
}

function isOverdue(lead: Lead, generatedAt: string): boolean {
  if (!lead.nextFollowUpAt || CLOSED_STATUSES.has(lead.pipelineStatus)) return false;
  return Date.parse(lead.nextFollowUpAt) <= Date.parse(generatedAt);
}

function isDuplicate(record: StoredLeadRecord): boolean {
  if (record.lead.outcomeStatus === 'duplicate') return true;
  return [...record.notes, ...record.auditLog.map((entry) => `${entry.action} ${entry.message} ${String(entry.metadata?.note ?? '')}`)]
    .some((value) => /duplicate/i.test(value));
}

function missingData(lead: Lead): string[] {
  const values: string[] = [];
  if (!lead.companyWebsite) values.push('website');
  if (!lead.contactName && !lead.contactRole) values.push('buyer/contact');
  if (!lead.contactEmail && !lead.contactFormUrl && !lead.linkedinUrl) values.push('contact route');
  if (!lead.evidenceUrl && !lead.sourceUrl) values.push('source link');
  if (!lead.evidenceSummary) values.push('evidence summary');
  if (!lead.budgetSignal) values.push('budget');
  if (!lead.timelineSignal && !lead.tender?.deadline) values.push('timeline');
  return values;
}

function defaultNextAction(lead: Lead): string {
  if (!lead.owner) return 'Assign an owner and verify the buyer evidence.';
  if (lead.pipelineStatus === 'needs_research') return 'Complete buyer, source and commercial research.';
  if (!lead.nextFollowUpAt && ['sent_manually', 'replied', 'meeting_booked', 'proposal_sent'].includes(lead.pipelineStatus)) return 'Schedule the next follow-up.';
  return 'Review the evidence and prepare the next human-approved action.';
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shorten(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
