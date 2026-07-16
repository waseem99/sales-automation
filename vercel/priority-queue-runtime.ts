import type { CloseabilityScore, LeadEvaluation } from '@sales-automation/evaluator';
import type { ProspectVisibility } from '@sales-automation/neon-state';
import type { Lead } from '@sales-automation/shared';
import type { StoredLeadRecord } from '@sales-automation/storage';

export interface PriorityQueueRuntimeInput {
  request: Request;
  databaseUrl: string;
  pathname: string;
  session: { identifier: string; displayName: string };
}

interface PriorityAccess {
  identifier: string;
  displayName: string;
  scopeKind: string;
  scopeLabel: string;
  visibleOwnerTokens: string[];
  canRunGlobalOperations: boolean;
}

type PriorityQueueId =
  | 'overdue'
  | 'priority-a'
  | 'priority-b'
  | 'warm-signals'
  | 'awaiting-response'
  | 'proposal-follow-up';

interface PriorityQueueDefinition {
  id: PriorityQueueId;
  label: string;
  group: 'due' | 'strength';
  description: string;
  emptyMessage: string;
  records: StoredLeadRecord[];
}

const finalStatuses = new Set(['won', 'lost', 'rejected', 'archived']);
const contactedStatuses = new Set(['sent_manually', 'replied', 'meeting_booked', 'proposal_sent', 'won', 'lost']);
const warmLeadTypes = new Set(['linkedin_warm_post', 'linkedin_sales_nav_alert', 'upwork_job', 'public_opportunity']);

export async function handlePriorityQueueRuntime(input: PriorityQueueRuntimeInput): Promise<Response> {
  const [evaluator, fixtures, neonState, web] = await Promise.all([
    import('@sales-automation/evaluator'),
    import('@sales-automation/fixtures'),
    import('@sales-automation/neon-state'),
    import('@sales-automation/web'),
  ]);
  const access = web.resolveDashboardAccess(input.session.identifier, input.session.displayName) as PriorityAccess;
  const visibility: ProspectVisibility = { canViewAll: access.scopeKind === 'all', ownerTokens: access.visibleOwnerTokens };
  const generatedAt = new Date().toISOString();
  const evaluateRecord = (record: StoredLeadRecord, force: boolean): StoredLeadRecord => {
    if (closeability(record) && !force) return record;
    return {
      ...record,
      latestEvaluation: evaluator.evaluateLead({
        lead: record.lead,
        portfolioItems: fixtures.samplePortfolioItems,
        generatedAt,
      }),
    };
  };

  if (input.request.method === 'POST' && input.pathname === '/api/closeability-rescore') {
    if (!access.canRunGlobalOperations) return json({ error: 'Forbidden: rescoring is restricted to Admin and Waseem.' }, 403);
    const records = await neonState.loadNeonScopedRecords(input.databaseUrl, { canViewAll: true, ownerTokens: [] });
    const rescored = records.map((record) => evaluateRecord(record, true));
    await neonState.persistLeadRecords(input.databaseUrl, rescored);
    return json({
      ok: true,
      rescored: rescored.length,
      priorityA: countBand(rescored, 'priority_a'),
      priorityB: countBand(rescored, 'priority_b'),
      research: countBand(rescored, 'research'),
      rejected: countBand(rescored, 'reject'),
      duplicatesCreated: 0,
    });
  }

  if (input.request.method !== 'GET' || input.pathname !== '/priorities') return json({ error: 'Method not allowed.' }, 405);

  const url = new URL(input.request.url);
  const threshold = thresholdValue(url.searchParams.get('threshold'));
  const records = await neonState.loadNeonScopedRecords(input.databaseUrl, visibility);
  const evaluated = records.map((record) => evaluateRecord(record, false));
  const active = evaluated.filter((record) => !finalStatuses.has(record.lead.pipelineStatus));
  const queues = buildPriorityQueues(active, threshold, generatedAt);
  const queueId = priorityQueueValue(url.searchParams.get('queue'));
  const selectedQueue = queues.find((queue) => queue.id === queueId) ?? queues[0]!;

  return html(renderPriorityPage({ access, threshold, queues, selectedQueue, generatedAt }));
}

function closeability(record: StoredLeadRecord): CloseabilityScore | undefined {
  return (record.latestEvaluation as (LeadEvaluation & { closeability?: CloseabilityScore }) | undefined)?.closeability;
}

function countBand(records: StoredLeadRecord[], band: CloseabilityScore['band']): number {
  return records.filter((record) => closeability(record)?.band === band).length;
}

function buildPriorityQueues(records: StoredLeadRecord[], threshold: number, generatedAt: string): PriorityQueueDefinition[] {
  const scoreQualified = records.filter((record) => (closeability(record)?.total ?? 0) >= threshold);
  return [
    {
      id: 'overdue',
      label: 'Overdue actions',
      group: 'due',
      description: 'Follow-ups that are already due and still need a human-owned next step.',
      emptyMessage: 'No overdue follow-ups are currently in scope.',
      records: records.filter((record) => isOverdue(record.lead, generatedAt)).sort(overdueSort),
    },
    {
      id: 'awaiting-response',
      label: 'Awaiting response',
      group: 'due',
      description: 'Manual outreach has been sent and the buyer has not replied yet.',
      emptyMessage: 'No sent outreach is currently awaiting a response.',
      records: records.filter((record) => record.lead.pipelineStatus === 'sent_manually').sort(waitingSort),
    },
    {
      id: 'proposal-follow-up',
      label: 'Proposal follow-ups',
      group: 'due',
      description: 'Proposals already sent that require an explicit follow-up or decision check.',
      emptyMessage: 'No proposal follow-ups are currently in scope.',
      records: records.filter((record) => record.lead.pipelineStatus === 'proposal_sent').sort(followUpSort),
    },
    {
      id: 'priority-a',
      label: 'Priority A',
      group: 'strength',
      description: 'Highest-closeability opportunities with the strongest buyer, evidence, route and proof readiness.',
      emptyMessage: 'No Priority A opportunities meet the selected score floor.',
      records: scoreQualified.filter((record) => closeability(record)?.band === 'priority_a').sort(prioritySort),
    },
    {
      id: 'priority-b',
      label: 'Priority B',
      group: 'strength',
      description: 'Strong opportunities that are close to contact-ready but still carry one or more material gaps.',
      emptyMessage: 'No Priority B opportunities meet the selected score floor.',
      records: scoreQualified.filter((record) => closeability(record)?.band === 'priority_b').sort(prioritySort),
    },
    {
      id: 'warm-signals',
      label: 'New warm signals',
      group: 'strength',
      description: 'Recent live buyer or procurement signals that have not yet moved into contacted stages.',
      emptyMessage: 'No recent uncontacted warm signals are currently in scope.',
      records: records.filter((record) => isWarmSignal(record.lead, generatedAt)).sort(recentSort),
    },
  ];
}

function prioritySort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  const scoreDifference = (closeability(right)?.total ?? 0) - (closeability(left)?.total ?? 0);
  if (scoreDifference !== 0) return scoreDifference;
  const urgencyDifference = Number(Boolean(closeability(right)?.reasonToActNow)) - Number(Boolean(closeability(left)?.reasonToActNow));
  if (urgencyDifference !== 0) return urgencyDifference;
  return Date.parse(right.lead.updatedAt) - Date.parse(left.lead.updatedAt);
}

function overdueSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return dateValue(left.lead.nextFollowUpAt, Number.MAX_SAFE_INTEGER) - dateValue(right.lead.nextFollowUpAt, Number.MAX_SAFE_INTEGER)
    || prioritySort(left, right);
}

function waitingSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return dateValue(left.lead.lastContactedAt, dateValue(left.lead.updatedAt, 0))
    - dateValue(right.lead.lastContactedAt, dateValue(right.lead.updatedAt, 0))
    || prioritySort(left, right);
}

function followUpSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return dateValue(left.lead.nextFollowUpAt, Number.MAX_SAFE_INTEGER)
    - dateValue(right.lead.nextFollowUpAt, Number.MAX_SAFE_INTEGER)
    || Date.parse(right.lead.updatedAt) - Date.parse(left.lead.updatedAt);
}

function recentSort(left: StoredLeadRecord, right: StoredLeadRecord): number {
  return signalDate(right.lead) - signalDate(left.lead) || prioritySort(left, right);
}

function isOverdue(lead: Lead, generatedAt: string): boolean {
  if (!lead.nextFollowUpAt || finalStatuses.has(lead.pipelineStatus)) return false;
  const followUp = Date.parse(lead.nextFollowUpAt);
  return Number.isFinite(followUp) && followUp <= Date.parse(generatedAt);
}

function isWarmSignal(lead: Lead, generatedAt: string): boolean {
  if (contactedStatuses.has(lead.pipelineStatus)) return false;
  const warm = lead.opportunityStatus === 'live_opportunity' || warmLeadTypes.has(lead.leadType) || Boolean(lead.tender);
  if (!warm) return false;
  const age = Date.parse(generatedAt) - signalDate(lead);
  return Number.isFinite(age) && age >= 0 && age <= 14 * 24 * 60 * 60 * 1000;
}

function signalDate(lead: Lead): number {
  return dateValue(lead.postedAt ?? lead.discoveredAt ?? lead.capturedAt ?? lead.createdAt, 0);
}

function renderPriorityPage(input: {
  access: PriorityAccess;
  threshold: number;
  queues: PriorityQueueDefinition[];
  selectedQueue: PriorityQueueDefinition;
  generatedAt: string;
}): string {
  const dueQueues = input.queues.filter((queue) => queue.group === 'due');
  const strengthQueues = input.queues.filter((queue) => queue.group === 'strength');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Priority Opportunities</title><style>${styles()}</style></head><body><main class="shell">
  <header><div><p class="eyebrow">${escapeHtml(input.access.scopeLabel)}</p><h1>Priority Opportunities</h1><p>Daily queues separate work that is due from opportunities that are strong. Signed in as ${escapeHtml(input.access.displayName)}.</p></div><div class="actions"><a class="button ghost" href="/prospects">Prospect Desk</a><a class="button ghost" href="/portfolio">Proof catalog</a>${input.access.canRunGlobalOperations ? '<button id="rescore" class="button primary">Rescore all leads</button>' : ''}</div></header>
  <section class="queue-groups" aria-label="Priority queue overview">
    ${renderQueueGroup('Due work', 'Actions created by timing or pipeline commitments.', dueQueues, input.selectedQueue.id, input.threshold)}
    ${renderQueueGroup('Opportunity strength', 'Closeability bands and recent warm buyer signals.', strengthQueues, input.selectedQueue.id, input.threshold)}
  </section>
  <section class="toolbar"><div><strong>Priority score floor</strong><span>Applies only to Priority A and Priority B queues.</span></div>${[60,75,85].map((value) => `<a class="${input.threshold===value?'active':''}" href="${escapeAttribute(priorityUrl(input.selectedQueue.id, value))}">${value}+</a>`).join('')}<span id="status">Generated ${escapeHtml(formatDate(input.generatedAt))}</span></section>
  <section class="panel selected-queue" data-priority-queue="${escapeAttribute(input.selectedQueue.id)}"><div class="section-title"><div><p class="eyebrow">Exact owner-scoped queue</p><h2>${escapeHtml(input.selectedQueue.label)}</h2><p>${escapeHtml(input.selectedQueue.description)}</p></div><span>${input.selectedQueue.records.length} record${input.selectedQueue.records.length === 1 ? '' : 's'}</span></div>${input.selectedQueue.records.length ? input.selectedQueue.records.map((record, index) => renderPriorityCard(record, index + 1, input.selectedQueue.id, input.generatedAt)).join('') : `<div class="empty">${escapeHtml(input.selectedQueue.emptyMessage)}</div>`}</section>
  </main><script>document.getElementById('rescore')?.addEventListener('click',async()=>{const button=document.getElementById('rescore'),status=document.getElementById('status');button.disabled=true;button.textContent='Rescoring…';const response=await fetch('/api/closeability-rescore',{method:'POST'});const data=await response.json();if(!response.ok){status.textContent=data.error||'Rescore failed';button.disabled=false;button.textContent='Rescore all leads';return;}status.textContent=data.rescored+' leads rescored; '+data.priorityA+' Priority A; '+data.priorityB+' Priority B';setTimeout(()=>location.reload(),700);});</script></body></html>`;
}

function renderQueueGroup(
  title: string,
  description: string,
  queues: PriorityQueueDefinition[],
  selected: PriorityQueueId,
  threshold: number,
): string {
  return `<section class="queue-group"><div class="queue-group-heading"><div><p class="eyebrow">${escapeHtml(title)}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><strong>${queues.reduce((total, queue) => total + queue.records.length, 0)}</strong></div><div class="queue-grid">${queues.map((queue) => `<a class="queue-tile ${queue.id === selected ? 'active' : ''}" href="${escapeAttribute(priorityUrl(queue.id, threshold))}" ${queue.id === selected ? 'aria-current="page"' : ''} data-priority-queue-link="${escapeAttribute(queue.id)}"><span>${escapeHtml(queue.label)}</span><strong>${queue.records.length}</strong><small>${escapeHtml(queue.description)}</small></a>`).join('')}</div></section>`;
}

function renderPriorityCard(record: StoredLeadRecord, position: number, queueId: PriorityQueueId, generatedAt: string): string {
  const score = closeability(record);
  if (!score) return '';
  const lead = record.lead;
  const bestProof = record.latestEvaluation?.portfolioMatches[0]?.portfolioItem;
  const contact = lead.contactName && lead.contactRole ? `${lead.contactName} — ${lead.contactRole}` : lead.contactRole ?? lead.contactName ?? 'Buyer not identified';
  const route = lead.contactEmail ?? lead.contactFormUrl ?? lead.linkedinUrl ?? lead.tender?.submissionMethod ?? 'Contact route requires research';
  const action = lead.recommendedNextAction ?? record.latestEvaluation?.recommendedNextAction ?? queueAction(queueId, lead);
  const gaps = score.missingData.slice(0, 3);
  const followUp = lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : 'Not scheduled';
  const overdue = isOverdue(lead, generatedAt);
  return `<article class="card band-${score.band}"><div class="rank">${position}</div><div class="body"><div class="heading"><div><span class="band">${escapeHtml(label(score.band))}</span><h3><a href="/prospects?leadId=${encodeURIComponent(lead.id)}">${escapeHtml(lead.companyName ?? lead.title)}</a></h3><p>${escapeHtml(lead.title)}</p></div><div class="score">${score.total}<small>/100</small></div></div><div class="action-callout"><span>Top recommended action</span><strong>${escapeHtml(action)}</strong>${queueReason(queueId, record, generatedAt) ? `<p>${escapeHtml(queueReason(queueId, record, generatedAt))}</p>` : ''}</div><div class="facts"><span><b>Owner</b>${escapeHtml(lead.owner ?? 'Unassigned')}</span><span><b>Status</b>${escapeHtml(label(lead.pipelineStatus))}</span><span><b>Follow-up</b><em class="${overdue ? 'overdue' : ''}">${escapeHtml(followUp)}</em></span><span><b>Service</b>${escapeHtml(label(lead.serviceCategory))}</span><span><b>Source</b>${escapeHtml(label(lead.discoverySource ?? lead.source))}</span><span><b>Buyer</b>${escapeHtml(contact)}</span><span><b>Contact route</b>${linkOrText(route)}</span><span><b>Proof</b>${bestProof ? escapeHtml(bestProof.projectName) : 'Approved proof missing'}</span></div>${score.reasonToActNow ? `<div class="act"><strong>Why now:</strong> ${escapeHtml(score.reasonToActNow)}</div>` : ''}${gaps.length ? `<div class="gaps"><strong>Missing evidence:</strong><ul>${gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul></div>` : '<div class="ready">Core closeability evidence is present.</div>'}<div class="card-actions"><a class="button primary" href="/prospects?leadId=${encodeURIComponent(lead.id)}">Open lead and update</a>${lead.evidenceUrl ?? lead.sourceUrl ? `<a class="button ghost" href="${escapeAttribute(publicUrl(lead.evidenceUrl ?? lead.sourceUrl))}" target="_blank" rel="noopener noreferrer">Open evidence</a>` : ''}</div><details><summary>Score breakdown</summary><div class="breakdown">${Object.entries(score.breakdown).map(([name,value]) => `<span><b>${escapeHtml(label(name))}</b>${value}</span>`).join('')}</div><p>${escapeHtml(score.explanation)}</p></details></div></article>`;
}

function queueReason(queueId: PriorityQueueId, record: StoredLeadRecord, generatedAt: string): string {
  const lead = record.lead;
  if (queueId === 'overdue' && lead.nextFollowUpAt) return `Follow-up became due ${formatRelative(lead.nextFollowUpAt, generatedAt)}.`;
  if (queueId === 'awaiting-response') return `Outreach was last recorded ${formatRelative(lead.lastContactedAt ?? lead.updatedAt, generatedAt)}.`;
  if (queueId === 'proposal-follow-up') return lead.nextFollowUpAt ? `Proposal follow-up is scheduled for ${formatDate(lead.nextFollowUpAt)}.` : 'A proposal is recorded, but the next follow-up is not scheduled.';
  if (queueId === 'warm-signals') return `Buyer signal captured ${formatRelative(lead.postedAt ?? lead.discoveredAt ?? lead.capturedAt, generatedAt)}.`;
  return closeability(record)?.explanation ?? '';
}

function queueAction(queueId: PriorityQueueId, lead: Lead): string {
  if (queueId === 'overdue') return 'Complete the overdue follow-up and record the outcome.';
  if (queueId === 'awaiting-response') return 'Review the waiting period and schedule a human-approved follow-up.';
  if (queueId === 'proposal-follow-up') return 'Confirm proposal receipt, decision timing and the next follow-up date.';
  if (queueId === 'warm-signals') return 'Verify the source and prepare a focused first-contact plan.';
  if (!lead.owner) return 'Assign an owner and resolve the highest-impact evidence gap.';
  return 'Review the closeability evidence and take the next human-approved action.';
}

function priorityQueueValue(value: string | null): PriorityQueueId {
  const allowed: PriorityQueueId[] = ['overdue', 'priority-a', 'priority-b', 'warm-signals', 'awaiting-response', 'proposal-follow-up'];
  return allowed.includes(value as PriorityQueueId) ? value as PriorityQueueId : 'overdue';
}

function priorityUrl(queue: PriorityQueueId, threshold: number): string {
  return `/priorities?queue=${encodeURIComponent(queue)}&threshold=${threshold}`;
}

function thresholdValue(value: string | null): number {
  const parsed = Number(value);
  return [60, 75, 85].includes(parsed) ? parsed : 75;
}

function dateValue(value: string | undefined, fallback: number): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatRelative(value: string | undefined, generatedAt: string): string {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) return 'at an unknown time';
  const hours = Math.round((Date.parse(generatedAt) - timestamp) / 3_600_000);
  if (hours < 1) return 'less than one hour ago';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function publicUrl(value: string | undefined): string {
  if (!value) return '#';
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '#';
  } catch {
    return '#';
  }
}

function linkOrText(value: string): string {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `<a href="mailto:${escapeAttribute(value)}">${escapeHtml(value)}</a>`;
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol)) return `<a href="${escapeAttribute(url.toString())}" target="_blank" rel="noopener noreferrer">Open route</a>`; } catch { /* text fallback */ }
  return escapeHtml(value);
}

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
function html(value: string): Response { return new Response(value, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' } }); }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function label(value: string): string { return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function escapeHtml(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character] ?? character)); }
function escapeAttribute(value: unknown): string { return escapeHtml(value); }

function styles(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb;line-height:1.45}*{box-sizing:border-box}body{margin:0}.shell{max-width:1380px;margin:auto;padding:28px}header{display:flex;justify-content:space-between;gap:22px;align-items:flex-start}header h1{margin:3px 0 8px;font-size:32px}header p{color:#667085;margin:0}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}.actions{display:flex;gap:9px;flex-wrap:wrap}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;border:0;border-radius:10px;padding:10px 13px;font:inherit;font-weight:750;text-decoration:none;cursor:pointer}.primary{background:#3157d5;color:#fff}.ghost{background:#fff;color:#344054;border:1px solid #d0d5dd}.queue-groups{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:24px 0 16px}.queue-group,.toolbar,.panel{background:#fff;border:1px solid #e4e7ec;border-radius:16px}.queue-group{padding:18px}.queue-group-heading{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.queue-group-heading h2{margin:2px 0 4px;font-size:19px}.queue-group-heading p{margin:0;color:#667085;font-size:12px}.queue-group-heading>strong{font-size:30px}.queue-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.queue-tile{display:grid;gap:4px;min-height:132px;padding:13px;border:1px solid #e4e7ec;border-radius:13px;color:#344054;text-decoration:none;background:#fcfcfd}.queue-tile:hover,.queue-tile.active{border-color:#3157d5;background:#f5f7ff}.queue-tile.active{box-shadow:inset 0 0 0 1px #3157d5}.queue-tile>span{font-size:12px;font-weight:800}.queue-tile>strong{font-size:28px;color:#172033}.queue-tile>small{font-size:10px;color:#667085}.toolbar{padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.toolbar>div{display:grid;margin-right:4px}.toolbar>div span{font-size:10px;color:#667085}.toolbar a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:7px 10px;border-radius:8px;color:#344054;text-decoration:none;background:#f2f4f7;font-size:12px}.toolbar a.active{background:#3157d5;color:#fff}.toolbar>span{margin-left:auto;color:#667085;font-size:12px}.panel{padding:20px;margin-bottom:16px}.section-title{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px}.section-title h2{margin:2px 0}.section-title p{margin:4px 0 0;color:#667085;font-size:12px;max-width:720px}.section-title>span{color:#667085}.card{display:grid;grid-template-columns:42px 1fr;gap:12px;padding:18px 0;border-top:1px solid #eaecf0}.card:first-of-type{border-top:0}.rank{width:36px;height:36px;border-radius:10px;background:#111827;color:#fff;display:grid;place-items:center;font-weight:850}.heading{display:flex;justify-content:space-between;gap:12px}.heading h3{margin:4px 0 2px}.heading h3 a{color:#172033}.heading p{margin:0;color:#667085;font-size:13px}.band{font-size:10px;font-weight:850;padding:4px 8px;border-radius:999px;background:#eef2ff;color:#3448a5}.band-priority_a .band{background:#ecfdf3;color:#027a48}.band-priority_b .band{background:#eff8ff;color:#175cd3}.band-research .band{background:#fff6ed;color:#b54708}.score{width:68px;height:68px;border-radius:18px;background:#111827;color:#fff;display:grid;place-items:center;font-size:23px;font-weight:850}.score small{font-size:9px;margin-top:-20px}.action-callout{margin:14px 0;padding:13px 14px;border:1px solid #c7d2fe;background:#f5f7ff;border-radius:12px}.action-callout span{display:block;text-transform:uppercase;letter-spacing:.06em;font-size:9px;font-weight:850;color:#667085}.action-callout strong{display:block;margin-top:4px;font-size:14px}.action-callout p{margin:5px 0 0;color:#475467;font-size:11px}.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.facts span{padding:10px;border:1px solid #eaecf0;border-radius:10px;font-size:11px;overflow-wrap:anywhere}.facts b{display:block;text-transform:uppercase;color:#667085;font-size:9px;margin-bottom:4px}.facts em{font-style:normal}.facts em.overdue{color:#b42318;font-weight:800}.act,.next,.gaps,.ready{margin-top:10px;border-radius:10px;padding:11px 13px;font-size:12px}.act{background:#fff7ed;color:#9a3412}.gaps{background:#fffaeb;color:#7a2e0e}.gaps ul{margin:5px 0 0;padding-left:18px}.ready{background:#ecfdf3;color:#027a48}.card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}details{margin-top:12px;border-top:1px solid #eaecf0;padding-top:10px}summary{cursor:pointer;font-weight:750;font-size:12px}.breakdown{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-top:10px}.breakdown span{background:#f8fafc;border-radius:8px;padding:8px;font-size:11px}.breakdown b{display:block;color:#667085;font-size:9px}.empty{text-align:center;padding:42px;color:#667085}@media(max-width:1100px){.queue-groups{grid-template-columns:1fr}.facts{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){.shell{padding:16px}header,.section-title{display:grid}.queue-grid{grid-template-columns:1fr}.facts,.breakdown{grid-template-columns:1fr}.card{grid-template-columns:1fr}.rank{display:none}.heading{align-items:flex-start}.queue-tile{min-height:112px}.toolbar>span{margin-left:0;width:100%}.card-actions .button{width:100%}}`;
}
