import { evaluateCommercialReadiness, type CommercialReadinessDecision } from '@sales-automation/commercial-readiness';
import type { StoredLeadRecord } from '@sales-automation/storage';
import { readOutreachWorkbench, type OutreachDraftRecord, type OutreachRevision } from '@sales-automation/outreach-workbench';

export function enhanceOutreachWorkbenchUi(html: string, selected?: StoredLeadRecord): string {
  if (!selected) return html;
  const workflow = readOutreachWorkbench(selected.lead);
  const readiness = evaluateCommercialReadiness(selected.lead);
  const panel = renderPanel(selected, workflow, readiness);
  let output = html.includes('id="activity-history"')
    ? html.replace('<section class="detail-section" id="activity-history"', `${panel}<section class="detail-section" id="activity-history"`)
    : html.replace('</body>', `${panel}</body>`);
  if (!output.includes('data-outreach-workbench-script')) output = output.replace('</body>', `${clientScript()}</body>`);
  if (!output.includes('data-outreach-workbench-style')) output = output.replace('</head>', `${styles()}</head>`);
  return output;
}

function renderPanel(record: StoredLeadRecord, workflow: ReturnType<typeof readOutreachWorkbench>, readiness: CommercialReadinessDecision): string {
  const generatedCount = record.latestEvaluation?.drafts.length ?? 0;
  const drafts = workflow?.drafts ?? [];
  const cards = drafts.length
    ? drafts.map((draft) => renderDraft(draft, readiness.approvalAllowed)).join('')
    : `<div class="outreach-empty"><strong>No managed outreach drafts yet.</strong><p>${generatedCount > 0 ? `${generatedCount} evaluator draft(s) are available to import.` : 'Create a manual draft or run evaluation before initializing.'}</p></div>`;
  return `<section class="detail-section outreach-workbench" id="outreach-workbench" data-outreach-workbench data-lead-id="${escapeAttribute(record.lead.id)}"><div class="outreach-heading"><div><p class="eyebrow">Human-controlled outreach</p><h3>Outreach review workbench</h3><p>Review, edit and approve the exact revision before a human copies or sends it. It never sends, submits, comments, connects or messages automatically.</p></div><div class="outreach-safety"><strong>Manual only</strong><span>${drafts.length} draft(s) · ${drafts.filter((draft) => draft.status === 'approved').length} approved</span></div></div>${renderReadiness(readiness)}<div class="outreach-toolbar"><button type="button" data-outreach-initialize>${workflow ? 'Refresh draft view' : 'Import generated drafts'}</button><button type="button" data-outreach-new>New manual draft</button><span data-outreach-result aria-live="polite"></span></div><div class="outreach-new-form" data-outreach-new-form hidden><label>Channel<select data-new-channel><option value="linkedin_dm">LinkedIn DM</option><option value="linkedin_comment">LinkedIn comment</option><option value="upwork">Upwork proposal</option><option value="email">Email</option><option value="partner">Partner outreach</option><option value="other">Other</option></select></label><label>Subject<input data-new-subject maxlength="500" /></label><label>Draft<textarea data-new-body rows="8" maxlength="12000" required></textarea></label><div class="outreach-actions"><button type="button" data-create-draft>Create internal draft</button><button type="button" data-cancel-new>Cancel</button></div></div><div class="outreach-drafts">${cards}</div></section>`;
}

function renderReadiness(readiness: CommercialReadinessDecision): string {
  const stateClass = readiness.approvalAllowed ? 'ready' : 'blocked';
  const blockers = readiness.blockers.length
    ? `<div><strong>Approval blockers</strong><ul>${readiness.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`
    : '<div><strong>Approval status</strong><p>Approval is available within the documented human-review limits.</p></div>';
  const prohibited = readiness.prohibitedClaims.length
    ? `<details><summary>Prohibited or unsupported claims</summary><ul>${readiness.prohibitedClaims.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`
    : '';
  const proof = readiness.proofLimitations.length
    ? `<details><summary>Proof limitations</summary><ul>${readiness.proofLimitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`
    : '';
  return `<div class="commercial-readiness ${stateClass}"><div><p class="eyebrow">Commercial readiness</p><h4>${escapeHtml(readiness.offerName ?? 'Unmapped offer')} · ${escapeHtml(label(readiness.status))}</h4><p>${escapeHtml(readiness.reasons.join(' '))}</p></div>${blockers}${prohibited}${proof}</div>`;
}

function renderDraft(draft: OutreachDraftRecord, approvalAllowed: boolean): string {
  const current = draft.revisions.find((revision) => revision.id === draft.currentRevisionId) ?? draft.revisions[draft.revisions.length - 1];
  if (!current) return '';
  const approval = draft.approval
    ? `<div class="outreach-approval"><strong>Approved revision ${revisionNumber(draft, draft.approval.revisionId)}</strong><span>${escapeHtml(draft.approval.approvedBy)} · ${formatDate(draft.approval.approvedAt)}</span>${draft.approval.note ? `<p>${escapeHtml(draft.approval.note)}</p>` : ''}</div>`
    : '<div class="outreach-approval pending"><strong>Human approval required</strong><span>Edits invalidate any earlier approval.</span></div>';
  const revisionHistory = [...draft.revisions].reverse().map((revision) => `<details><summary>Revision ${revision.number} · ${escapeHtml(revision.source)} · ${formatDate(revision.createdAt)}</summary><pre>${escapeHtml(formatRevision(revision))}</pre><p>Hash: <code>${escapeHtml(revision.contentHash.slice(0, 16))}</code></p></details>`).join('');
  const sentHistory = draft.sentVersions.length
    ? `<div class="outreach-sent-history"><h5>Exact sent versions</h5>${draft.sentVersions.map((sent) => `<details><summary>${formatDate(sent.sentAt)} · ${escapeHtml(sent.channel)} · ${escapeHtml(sent.sentBy)}</summary><pre>${escapeHtml(`${sent.subject ? `Subject: ${sent.subject}\n\n` : ''}${sent.body}`)}</pre><p>Revision ${revisionNumber(draft, sent.revisionId)} · hash <code>${escapeHtml(sent.contentHash.slice(0, 16))}</code> · manually confirmed</p></details>`).join('')}</div>`
    : '';
  const immutable = draft.status === 'sent_manually';
  const approveControl = approvalAllowed
    ? '<button type="button" data-draft-action="approve">Approve exact revision</button>'
    : '<button type="button" disabled title="Complete the commercial readiness blockers before approval.">Approval blocked</button>';
  return `<article class="outreach-card" data-draft-id="${escapeAttribute(draft.id)}" data-current-revision="${escapeAttribute(current.id)}"><div class="outreach-card-heading"><div><strong>${escapeHtml(label(draft.channel))}</strong><span class="outreach-status">${escapeHtml(label(draft.status))}</span></div><span>Revision ${current.number} · ${draft.revisions.length} total</span></div>${approval}<label>Subject<input data-draft-subject maxlength="500" value="${escapeAttribute(current.subject ?? '')}" ${immutable ? 'disabled' : ''} /></label><label>Message<textarea data-draft-body rows="10" maxlength="12000" ${immutable ? 'disabled' : ''}>${escapeHtml(current.body)}</textarea></label><label>Change/review note<input data-draft-note maxlength="1000" ${immutable ? 'disabled' : ''} /></label><div class="outreach-actions">${immutable ? '<strong class="outreach-locked">Sent record locked</strong>' : `<button type="button" data-draft-action="edit">Save revision</button><button type="button" data-draft-action="submit">Submit for review</button>${approveControl}<button type="button" data-draft-action="changes">Request changes</button><button type="button" data-draft-action="reject">Reject</button>`}<button type="button" data-draft-action="copy">Copy current text</button>${draft.status === 'approved' ? '<button type="button" data-draft-action="sent" class="danger">Confirm manually sent</button>' : ''}</div><div class="outreach-history"><h5>Revision history</h5>${revisionHistory}</div>${sentHistory}</article>`;
}

function clientScript(): string {
  return `<script data-outreach-workbench-script>(()=>{const root=document.querySelector('[data-outreach-workbench]');if(!root)return;const leadId=root.dataset.leadId,result=root.querySelector('[data-outreach-result]'),newForm=root.querySelector('[data-outreach-new-form]');const endpoint=(suffix='')=>'/api/outreach-workbench/'+encodeURIComponent(leadId)+suffix;async function call(url,body={}){result.textContent='Saving…';const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');result.textContent='Saved. Reloading…';location.reload();}root.querySelector('[data-outreach-initialize]')?.addEventListener('click',()=>call(endpoint()));root.querySelector('[data-outreach-new]')?.addEventListener('click',()=>newForm.hidden=false);root.querySelector('[data-cancel-new]')?.addEventListener('click',()=>newForm.hidden=true);root.querySelector('[data-create-draft]')?.addEventListener('click',()=>call(endpoint('/drafts'),{channel:root.querySelector('[data-new-channel]').value,subject:root.querySelector('[data-new-subject]').value,body:root.querySelector('[data-new-body]').value}));root.addEventListener('click',async(event)=>{const button=event.target.closest('[data-draft-action]');if(!button)return;const card=button.closest('[data-draft-id]'),draftId=card.dataset.draftId,action=button.dataset.draftAction,subject=card.querySelector('[data-draft-subject]')?.value||'',body=card.querySelector('[data-draft-body]')?.value||'',note=card.querySelector('[data-draft-note]')?.value||'';try{if(action==='copy'){await navigator.clipboard.writeText((subject?'Subject: '+subject+'\n\n':'')+body);await call(endpoint('/drafts/'+encodeURIComponent(draftId)+'/copy'));return;}if(action==='sent'&&!confirm('Confirm that a human already sent this exact approved revision outside the system?'))return;const payload=action==='edit'?{subject,body,changeNote:note}:action==='approve'||action==='changes'||action==='reject'?{note}:action==='sent'?{revisionId:card.dataset.currentRevision,destinationLabel:'Human-confirmed manual outreach'}:{};await call(endpoint('/drafts/'+encodeURIComponent(draftId)+'/'+action),payload);}catch(error){result.textContent=error.message;}});window.addEventListener('unhandledrejection',event=>{result.textContent=event.reason?.message||'Request failed';});})();</script>`;
}

function styles(): string {
  return `<style data-outreach-workbench-style>.outreach-workbench{border:1px solid #d8dee9;background:#f8fafc}.outreach-heading{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.outreach-heading h3{margin:0}.outreach-heading p{max-width:760px}.outreach-safety{display:grid;gap:3px;background:#fff7ed;border:1px solid #fed7aa;padding:12px;border-radius:12px;min-width:190px}.outreach-safety strong{color:#9a3412}.commercial-readiness{display:grid;gap:10px;margin:14px 0;padding:14px;border-radius:12px;border:1px solid #a7f3d0;background:#ecfdf5}.commercial-readiness.blocked{border-color:#fecaca;background:#fef2f2}.commercial-readiness h4,.commercial-readiness p{margin:3px 0}.commercial-readiness ul{margin:7px 0;padding-left:20px}.commercial-readiness details{border-top:1px solid #d8dee9;padding-top:8px}.outreach-toolbar,.outreach-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0}.outreach-toolbar button,.outreach-actions button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 11px;font-weight:700}.outreach-actions button:disabled{cursor:not-allowed;background:#e5e7eb;color:#64748b}.outreach-actions .danger{background:#7c2d12;color:#fff;border-color:#7c2d12}.outreach-new-form,.outreach-card{display:grid;gap:11px;background:#fff;border:1px solid #d8dee9;border-radius:14px;padding:16px;margin-top:14px}.outreach-card label,.outreach-new-form label{display:grid;gap:5px;font-size:12px;font-weight:700}.outreach-card input,.outreach-card textarea,.outreach-new-form input,.outreach-new-form textarea,.outreach-new-form select{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:9px;font:inherit}.outreach-card-heading{display:flex;justify-content:space-between;gap:12px}.outreach-card-heading div{display:flex;gap:8px;align-items:center}.outreach-status{background:#eef2ff;color:#3730a3;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:800}.outreach-approval{border-left:4px solid #16a34a;background:#f0fdf4;padding:10px 12px;display:grid;gap:3px}.outreach-approval.pending{border-color:#f59e0b;background:#fffbeb}.outreach-history details,.outreach-sent-history details{border-top:1px solid #e2e8f0;padding:8px 0}.outreach-history pre,.outreach-sent-history pre{white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:8px}.outreach-locked{color:#9a3412}.outreach-empty{background:#fff;border:1px dashed #cbd5e1;border-radius:12px;padding:16px}@media(max-width:760px){.outreach-heading{display:grid}.outreach-safety{min-width:0}}</style>`;
}

function formatRevision(revision: OutreachRevision): string { return `${revision.subject ? `Subject: ${revision.subject}\n\n` : ''}${revision.body}`; }
function revisionNumber(draft: OutreachDraftRecord, id: string): number | string { return draft.revisions.find((item) => item.id === id)?.number ?? 'unknown'; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', {dateStyle: 'medium', timeStyle: 'short'}); }
function label(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase()); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character] ?? character)); }
function escapeAttribute(value: string): string { return escapeHtml(value); }
