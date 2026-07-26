import { readBdWorkflow, refreshBdWorkflow, workflowQueueFacts, type BdTask, type BdWorkflowSnapshot } from '@sales-automation/bd-workflow';
import type { StoredLeadRecord } from '@sales-automation/storage';

export interface BdWorkspaceUiOptions {
  activeRoute: string;
  records: StoredLeadRecord[];
  selected?: StoredLeadRecord;
  generatedAt: string;
  actorIdentifier?: string;
  actorDisplayName?: string;
}

const BD_STYLE_ID = 'bd-workspace-v1-style';
const BD_SCRIPT_ID = 'bd-workspace-v1-script';

export function enhanceBdWorkspaceUi(html: string, options: BdWorkspaceUiOptions): string {
  let output = html;
  output = injectQueueSummary(output, options);
  if (options.selected) output = injectSelectedWorkflow(output, options.selected, options.generatedAt);
  if (!output.includes(BD_STYLE_ID)) output = output.replace('</head>', `${styles()}</head>`);
  if (!output.includes(BD_SCRIPT_ID)) output = output.replace('</body>', `${script()}</body>`);
  return output;
}

function injectQueueSummary(html: string, options: BdWorkspaceUiOptions): string {
  const facts = options.records.map((record) => ({record, facts: workflowQueueFacts(record.lead, options.generatedAt)}));
  const openTasks = facts.reduce((sum, item) => sum + item.facts.openTasks, 0);
  const overdue = facts.reduce((sum, item) => sum + item.facts.overdueTasks, 0);
  const blocked = facts.filter((item) => item.facts.blocked).length;
  const unassigned = options.records.filter((record) => !record.lead.owner).length;
  const myOwner = options.actorDisplayName ?? options.actorIdentifier;
  const myQueue = myOwner ? options.records.filter((record) => ownerMatches(record.lead.owner, myOwner)).length : 0;
  const myQueueUrl = myOwner ? `${options.activeRoute}?owner=${encodeURIComponent(myOwner)}&page=1&pageSize=25` : options.activeRoute;
  const managerUrl = `${options.activeRoute}?status=needs_human_review&page=1&pageSize=25`;
  const panel = `<section class="bd-queue-summary" data-bd-queue-summary><div class="bd-queue-heading"><div><p class="eyebrow">Operational BD queue</p><h2>Every active prospect needs an owner, task and due date</h2><p>Guidance is generated from stored evidence and pipeline events. It never sends, submits or contacts anyone automatically.</p></div><div class="bd-queue-actions"><a class="button-link" href="${escapeAttribute(myQueueUrl)}">My queue${myOwner ? ` · ${myQueue}` : ''}</a><a class="button-link secondary" href="${escapeAttribute(managerUrl)}">Manager review</a><button type="button" data-bd-backfill>Refresh workflow guidance</button></div></div><div class="bd-metrics"><article><strong>${options.records.length}</strong><span>visible prospects</span></article><article><strong>${openTasks}</strong><span>open tasks</span></article><article class="${overdue ? 'danger' : ''}"><strong>${overdue}</strong><span>overdue tasks</span></article><article><strong>${unassigned}</strong><span>unassigned</span></article><article class="${blocked ? 'danger' : ''}"><strong>${blocked}</strong><span>contact blocked</span></article></div><p class="bd-scope-note">Queue metrics reflect the currently loaded workspace page and filters.</p></section>`;
  const marker = '<div class="workflow-controls"';
  return html.includes(marker) ? html.replace(marker, `${panel}<div class="workflow-controls"`) : html;
}

function injectSelectedWorkflow(html: string, record: StoredLeadRecord, generatedAt: string): string {
  const snapshot = refreshBdWorkflow(record.lead, generatedAt, 'bd-workflow-read');
  const next = snapshot.nextBestAction;
  const activeTasks = snapshot.tasks.filter((task) => task.status === 'open' || task.status === 'in_progress');
  const inactiveTasks = snapshot.tasks.filter((task) => task.status !== 'open' && task.status !== 'in_progress').slice(0, 8);
  const leadId = encodeURIComponent(record.lead.id);
  const panel = `<section class="detail-section bd-operating-panel" id="bd-operating-workspace" data-detail-section="bd-operating-workspace"><div class="section-heading"><div><p class="eyebrow">BD operating workspace</p><h3>${escapeHtml(next.title)}</h3><p>${escapeHtml(next.reason)}</p></div><span class="pill workflow-status ${escapeAttribute(next.priority)}">${escapeHtml(label(next.priority))} · ${escapeHtml(label(next.channel))}</span></div><div class="bd-next-grid"><div><span>Owner</span><strong>${escapeHtml(record.lead.owner ?? 'Unassigned')}</strong></div><div><span>Pipeline stage</span><strong>${escapeHtml(label(record.lead.pipelineStatus))}</strong></div><div><span>Open tasks</span><strong>${snapshot.openTaskCount}</strong></div><div><span>Overdue tasks</span><strong>${snapshot.overdueTaskCount}</strong></div><div><span>Next due</span><strong>${next.dueAt ? escapeHtml(formatDateTime(next.dueAt)) : 'No due date'}</strong></div><div><span>External action</span><strong>Human only</strong></div></div>${snapshot.blocked ? `<div class="bd-blocked"><strong>Contact blocked</strong><p>${escapeHtml(snapshot.blockedReason ?? 'Suppression evidence is present. Resolve internally; do not contact.')}</p></div>` : ''}<div class="bd-evidence-columns">${renderEvidenceList('Evidence supporting this action', next.evidence, 'positive')}${renderEvidenceList('Missing evidence', next.missingEvidence, 'missing')}${renderEvidenceList('Risks', next.risks, 'risk')}${renderEvidenceList('Claims and actions prohibited', next.prohibitedClaims, 'prohibited')}</div><div class="bd-task-toolbar"><button type="button" data-bd-refresh-next data-lead-id="${escapeAttribute(record.lead.id)}">Recalculate next action</button><span>Recalculation updates guidance only. It performs no external action.</span></div><div class="bd-task-layout"><div><h4>Active tasks</h4>${activeTasks.length ? activeTasks.map((task) => renderTask(task, leadId)).join('') : '<p class="muted">No active tasks. Create one or recalculate guidance.</p>'}${inactiveTasks.length ? `<details class="bd-closed-tasks"><summary>Completed, held or dismissed tasks (${inactiveTasks.length})</summary>${inactiveTasks.map((task) => renderTask(task, leadId, true)).join('')}</details>` : ''}</div><div><h4>Create a task</h4>${renderCreateTaskForm(record.lead.id, record.lead.owner)}</div></div><details class="bd-workflow-events"><summary>Structured workflow activity (${snapshot.events.length})</summary>${renderEvents(snapshot)}</details></section>`;
  const marker = '<section class="detail-section" id="activity-history" data-detail-section="activity-history"><h3>Activity history</h3>';
  if (html.includes(marker)) return html.replace(marker, `${panel}${marker}`);
  const fallback = '<section class="detail-section"><h3>Activity timeline</h3>';
  return html.includes(fallback) ? html.replace(fallback, `${panel}${fallback}`) : html;
}

function renderTask(task: BdTask, encodedLeadId: string, inactive = false): string {
  const actions = inactive
    ? task.status === 'on_hold' || task.status === 'dismissed'
      ? `<form data-bd-form action="/api/prospects/${encodedLeadId}/tasks/${encodeURIComponent(task.id)}/reopen" method="post"><button type="submit">Reopen</button></form>`
      : ''
    : [
      task.status === 'open' ? `<form data-bd-form action="/api/prospects/${encodedLeadId}/tasks/${encodeURIComponent(task.id)}/start" method="post"><button type="submit">Start</button></form>` : '',
      `<form data-bd-form action="/api/prospects/${encodedLeadId}/tasks/${encodeURIComponent(task.id)}/complete" method="post"><button type="submit" class="primary">Complete</button></form>`,
      `<form data-bd-form action="/api/prospects/${encodedLeadId}/tasks/${encodeURIComponent(task.id)}/hold" method="post"><button type="submit">Hold</button></form>`,
      `<form data-bd-form action="/api/prospects/${encodedLeadId}/tasks/${encodeURIComponent(task.id)}/dismiss" method="post"><button type="submit">Dismiss</button></form>`,
    ].filter(Boolean).join('');
  const overdue = task.dueAt && Date.parse(task.dueAt) <= Date.now() && (task.status === 'open' || task.status === 'in_progress');
  return `<article class="bd-task ${escapeAttribute(task.status)} ${overdue ? 'overdue' : ''}" data-task-id="${escapeAttribute(task.id)}"><div class="bd-task-main"><div><span class="bd-task-code">${escapeHtml(label(task.code))}</span><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.reason)}</p></div><div class="bd-task-meta"><span class="pill workflow-status">${escapeHtml(label(task.priority))}</span><span>${escapeHtml(label(task.status))}</span><span>${task.dueAt ? `${overdue ? 'Overdue · ' : ''}${escapeHtml(formatDateTime(task.dueAt))}` : 'No due date'}</span><span>${escapeHtml(task.owner ?? 'Unassigned')}</span></div></div>${task.note ? `<p class="bd-task-note">${escapeHtml(task.note)}</p>` : ''}${actions ? `<div class="bd-task-actions">${actions}</div>` : ''}</article>`;
}

function renderCreateTaskForm(leadId: string, owner?: string): string {
  return `<form class="bd-create-task" data-bd-form action="/api/prospects/${encodeURIComponent(leadId)}/tasks" method="post"><label>Task title<input name="title" required maxlength="160" placeholder="Verify procurement authority"></label><label>Reason<textarea name="reason" required rows="3" maxlength="600" placeholder="What evidence or action is needed and why?"></textarea></label><div class="bd-form-grid"><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select></label><label>Channel<select name="channel"><option value="internal">Internal research</option><option value="upwork">Upwork</option><option value="linkedin">LinkedIn</option><option value="sales_navigator">Sales Navigator</option><option value="email">Email</option><option value="referral">Referral</option><option value="meeting">Meeting</option></select></label></div><label>Owner<input name="owner" value="${escapeAttribute(owner ?? '')}" placeholder="BD owner"></label><label>Due date and time<input type="datetime-local" name="dueAt"></label><label>Internal note<textarea name="note" rows="2" maxlength="1000"></textarea></label><button type="submit" class="primary">Create task</button><p class="form-help">Creating a task records an internal workflow event only.</p></form>`;
}

function renderEvents(snapshot: BdWorkflowSnapshot): string {
  if (!snapshot.events.length) return '<p class="muted">No structured workflow events yet.</p>';
  return `<ol class="bd-event-list">${[...snapshot.events].reverse().slice(0, 30).map((event) => `<li><strong>${escapeHtml(event.summary)}</strong><span>${escapeHtml(event.actor)} · ${escapeHtml(formatDateTime(event.occurredAt))}</span></li>`).join('')}</ol>`;
}

function renderEvidenceList(title: string, values: string[], kind: string): string {
  return `<div class="bd-evidence ${escapeAttribute(kind)}"><strong>${escapeHtml(title)}</strong>${values.length ? `<ul>${values.slice(0, 8).map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '<p>None recorded.</p>'}</div>`;
}

function ownerMatches(owner: string | undefined, actor: string): boolean {
  if (!owner) return false;
  const left = owner.toLowerCase().replace(/[^a-z0-9]/g, '');
  const right = actor.toLowerCase().replace(/[^a-z0-9]/g, '');
  return left === right || left.includes(right) || right.includes(left);
}

function styles(): string {
  return `<style id="${BD_STYLE_ID}">.bd-queue-summary{margin:0 0 18px;padding:20px;border:1px solid #dbe4ec;border-radius:16px;background:linear-gradient(135deg,#f8fbfd,#fff)}.bd-queue-heading,.bd-task-main,.bd-task-toolbar,.bd-task-actions,.bd-queue-actions{display:flex;gap:14px;align-items:center;justify-content:space-between}.bd-queue-heading h2{margin:2px 0 5px}.bd-queue-actions{flex-wrap:wrap;justify-content:flex-end}.bd-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:16px}.bd-metrics article{padding:14px;border:1px solid #e0e7ed;border-radius:12px;background:#fff}.bd-metrics strong{display:block;font-size:24px}.bd-metrics span{font-size:12px;color:#65717c}.bd-metrics .danger{border-color:#efb2b2;background:#fff7f7}.bd-scope-note{margin:10px 0 0;font-size:12px;color:#71808d}.bd-operating-panel{border-color:#b9cee0;background:#fbfdff}.bd-next-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}.bd-next-grid>div{padding:11px;border:1px solid #e2e9ef;border-radius:10px;background:#fff}.bd-next-grid span,.bd-task-meta span{display:block;font-size:11px;color:#6a7782}.bd-blocked{padding:13px;border:1px solid #e8a6a6;border-radius:10px;background:#fff5f5;color:#8a1f1f}.bd-evidence-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0}.bd-evidence{padding:12px;border-radius:10px;border:1px solid #e0e7ed;background:#fff}.bd-evidence ul{margin:8px 0 0;padding-left:18px}.bd-evidence.missing,.bd-evidence.risk,.bd-evidence.prohibited{background:#fffaf3}.bd-task-toolbar{padding:12px 0;border-top:1px solid #e4ebf0;border-bottom:1px solid #e4ebf0}.bd-task-toolbar span{font-size:12px;color:#66737e}.bd-task-layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:16px;margin-top:16px}.bd-task{padding:13px;margin:0 0 10px;border:1px solid #dfe7ed;border-radius:12px;background:#fff}.bd-task.overdue{border-color:#dc8d8d}.bd-task-main{align-items:flex-start}.bd-task-main strong{display:block;margin:3px 0}.bd-task-main p{margin:0;color:#5f6b75}.bd-task-code{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#0a66c2}.bd-task-meta{text-align:right;min-width:140px}.bd-task-actions{justify-content:flex-end;margin-top:10px}.bd-task-actions form{margin:0}.bd-task-note{padding:8px;border-radius:8px;background:#f4f7f9}.bd-create-task{display:grid;gap:10px;padding:14px;border:1px solid #dfe7ed;border-radius:12px;background:#fff}.bd-create-task label{display:grid;gap:5px}.bd-create-task input,.bd-create-task textarea,.bd-create-task select{width:100%}.bd-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.form-help{font-size:11px;color:#6f7a84}.bd-closed-tasks,.bd-workflow-events{margin-top:12px}.bd-event-list{display:grid;gap:8px;padding-left:22px}.bd-event-list span{display:block;font-size:11px;color:#6c7882}.bd-queue-actions button,.bd-task-toolbar button,.bd-task-actions button,.bd-create-task button{border:0;border-radius:8px;padding:9px 12px;cursor:pointer}.bd-task-actions .primary,.bd-create-task .primary{background:#0a66c2;color:#fff}.bd-status{position:fixed;right:20px;bottom:20px;z-index:9999;max-width:360px;padding:12px 15px;border-radius:10px;background:#14212b;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.2)}@media(max-width:900px){.bd-metrics{grid-template-columns:repeat(2,1fr)}.bd-next-grid,.bd-evidence-columns,.bd-task-layout{grid-template-columns:1fr}.bd-queue-heading,.bd-task-main,.bd-task-toolbar{align-items:stretch;flex-direction:column}.bd-task-meta{text-align:left}}</style>`;
}

function script(): string {
  return `<script id="${BD_SCRIPT_ID}">(()=>{'use strict';const show=(message,error=false)=>{let node=document.querySelector('.bd-status');if(!node){node=document.createElement('div');node.className='bd-status';document.body.appendChild(node)}node.textContent=message;node.style.background=error?'#8b1d1d':'#14212b';setTimeout(()=>node.remove(),5000)};const submit=async(form)=>{const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;try{const data=Object.fromEntries(new FormData(form).entries());for(const key of Object.keys(data))if(data[key]==='')delete data[key];const response=await fetch(form.action,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(data)});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Workflow action failed.');show('Workflow updated.');window.location.reload()}catch(error){show(error instanceof Error?error.message:String(error),true);if(button)button.disabled=false}};document.addEventListener('submit',event=>{const form=event.target.closest('form[data-bd-form]');if(!form)return;event.preventDefault();submit(form)});document.addEventListener('click',async event=>{const refresh=event.target.closest('[data-bd-refresh-next]');if(refresh){refresh.disabled=true;try{const response=await fetch('/api/prospects/'+encodeURIComponent(refresh.dataset.leadId)+'/next-action',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Refresh failed.');show('Next action recalculated.');window.location.reload()}catch(error){show(error instanceof Error?error.message:String(error),true);refresh.disabled=false}return}const backfill=event.target.closest('[data-bd-backfill]');if(backfill){backfill.disabled=true;try{const response=await fetch('/api/prospects/bd-workflow/backfill',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Workflow refresh failed.');show('Workflow guidance refreshed for '+(body.updated||0)+' prospects.');window.location.reload()}catch(error){show(error instanceof Error?error.message:String(error),true);backfill.disabled=false}}})})();</script>`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', {dateStyle: 'medium', timeStyle: 'short'}).format(date);
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character] ?? character));
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
