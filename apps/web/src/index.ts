import {
  savedViewLabels,
  type DashboardSavedViewKey,
  type DashboardSummary,
  type LeadDetailView,
  type OpportunityListItem,
} from '@sales-automation/dashboard';
import type { PipelineStatus } from '@sales-automation/shared';

export interface RenderDashboardPageInput {
  title?: string;
  summary: DashboardSummary;
  opportunities: OpportunityListItem[];
  selectedLead?: LeadDetailView;
  activeSavedView?: DashboardSavedViewKey;
  activeQuery?: string;
  activePipelineStatus?: PipelineStatus;
}

const pipelineStatusOptions: PipelineStatus[] = [
  'new',
  'scored',
  'needs_human_review',
  'approved_to_contact',
  'draft_ready',
  'hot_alert_sent',
  'sent_manually',
  'replied',
  'meeting_booked',
  'proposal_sent',
  'won',
  'lost',
  'rejected',
  'archived',
];

export function renderDashboardPage(input: RenderDashboardPageInput): string {
  const title = input.title ?? 'Codistan Lead Desk';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${baseStyles()}</style>
  </head>
  <body>
    <main class="shell">
      <header class="hero">
        <p class="eyebrow">Codistan Sales Automation</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="subcopy">Paste an Upwork job alert, LinkedIn/Sales Navigator signal, or manual lead. The system scores it, routes the right Codistan profile, matches portfolio proof, and creates a human-approved next action.</p>
      </header>
      ${renderSummary(input.summary)}
      ${renderManualLeadForm()}
      ${renderSavedViewBar(input.activeSavedView, input.activeQuery, input.activePipelineStatus)}
      ${renderFilterBar(input.activeSavedView, input.activeQuery, input.activePipelineStatus)}
      <section class="grid">
        ${renderOpportunityList(input.opportunities, input.selectedLead?.id, input.activeSavedView, input.activeQuery, input.activePipelineStatus)}
        ${input.selectedLead ? renderLeadDetail(input.selectedLead) : renderEmptyDetail()}
      </section>
    </main>
    <script>${clientScript()}</script>
  </body>
</html>`;
}

function renderSummary(summary: DashboardSummary): string {
  const metrics = [
    ['Total', summary.total],
    ['Hot', summary.hot],
    ['Urgent', summary.urgent],
    ['Alert Eligible', summary.alertEligible],
    ['Overdue', summary.overdue],
    ['Needs Review', summary.needsHumanReview],
  ];

  return `<section class="metrics" aria-label="Dashboard summary">
    ${metrics.map(([label, value]) => `<article class="metric"><span>${escapeHtml(String(label))}</span><strong>${value}</strong></article>`).join('')}
  </section>`;
}

function renderManualLeadForm(): string {
  const sampleUpwork = `Job: Need AI automation support
https://www.upwork.com/jobs/sample-mvp-ai-automation
We need an AI automation expert for n8n, OpenAI, RAG, and workflow automation. Budget $5,000. Posted 20 minutes ago.`;
  const sampleLinkedIn = `Sales Navigator saved search alert
New lead alert: Jane Founder — COO at Example SaaS
Posted 35 minutes ago
Looking for AI automation partner to reduce support backlog. https://www.linkedin.com/in/jane-founder`;

  return `<section class="panel intake" aria-label="Manual lead intake">
    <div class="panel-header">
      <div>
        <h2>Try the MVP flow</h2>
        <p class="muted">This uses local/mock data only. No Gmail, LinkedIn, Upwork, email sending, scraping, or auto-bidding.</p>
      </div>
      <span>Local MVP</span>
    </div>
    <form id="lead-form" class="lead-form">
      <label>
        Lead source
        <select id="lead-source" name="lead-source">
          <option value="upwork">Upwork job/email text</option>
          <option value="linkedin">LinkedIn / Sales Navigator signal</option>
        </select>
      </label>
      <label>
        Paste lead text
        <textarea id="lead-text" name="lead-text" rows="7">${escapeHtml(sampleUpwork)}</textarea>
      </label>
      <div class="form-actions">
        <button type="submit">Evaluate lead</button>
        <button type="button" id="sample-upwork">Use Upwork sample</button>
        <button type="button" id="sample-linkedin">Use LinkedIn sample</button>
        <button type="button" id="refresh-dashboard">Refresh dashboard</button>
        <button type="button" id="reset-local-data" class="danger-button">Reset local data</button>
      </div>
    </form>
    <pre id="lead-result" class="result" hidden></pre>
    <template id="sample-upwork-text">${escapeHtml(sampleUpwork)}</template>
    <template id="sample-linkedin-text">${escapeHtml(sampleLinkedIn)}</template>
  </section>`;
}

function renderSavedViewBar(
  activeSavedView?: DashboardSavedViewKey,
  activeQuery?: string,
  activePipelineStatus?: PipelineStatus,
): string {
  const viewEntries = Object.entries(savedViewLabels) as Array<[DashboardSavedViewKey, string]>;

  return `<section class="panel saved-views" aria-label="Saved views">
    <div class="panel-header compact">
      <div>
        <h2>Saved views</h2>
        <p class="muted">Quick filters for the BD team. These only change what is shown locally.</p>
      </div>
      <a class="text-link" href="${escapeHtml(createListHref({ query: activeQuery, status: activePipelineStatus }))}">Clear view</a>
    </div>
    <div class="view-chips">
      <a class="chip ${activeSavedView ? '' : 'active'}" href="${escapeHtml(createListHref({ query: activeQuery, status: activePipelineStatus }))}">All opportunities</a>
      ${viewEntries.map(([key, label]) => `<a class="chip ${activeSavedView === key ? 'active' : ''}" href="${escapeHtml(createListHref({ savedView: key, query: activeQuery, status: activePipelineStatus }))}">${escapeHtml(label)}</a>`).join('')}
    </div>
  </section>`;
}

function renderFilterBar(
  activeSavedView?: DashboardSavedViewKey,
  activeQuery?: string,
  activePipelineStatus?: PipelineStatus,
): string {
  return `<section class="panel filters" aria-label="Opportunity filters">
    <div class="panel-header compact">
      <div>
        <h2>Search and filters</h2>
        <p class="muted">Narrow the local pipeline without changing source data.</p>
      </div>
      <a class="text-link" href="${escapeHtml(createListHref({ savedView: activeSavedView }))}">Clear filters</a>
    </div>
    <form class="filter-form" method="get" action="/">
      ${activeSavedView ? `<input type="hidden" name="savedView" value="${escapeHtml(activeSavedView)}" />` : ''}
      <label>
        Search
        <input name="query" value="${escapeHtml(activeQuery ?? '')}" placeholder="Search title, company, contact, service..." />
      </label>
      <label>
        Pipeline status
        <select name="status">
          <option value="">Any status</option>
          ${pipelineStatusOptions.map((status) => `<option value="${escapeHtml(status)}" ${activePipelineStatus === status ? 'selected' : ''}>${escapeHtml(formatStatusLabel(status))}</option>`).join('')}
        </select>
      </label>
      <button type="submit">Apply filters</button>
    </form>
  </section>`;
}

function renderOpportunityList(
  opportunities: OpportunityListItem[],
  selectedLeadId?: string,
  activeSavedView?: DashboardSavedViewKey,
  activeQuery?: string,
  activePipelineStatus?: PipelineStatus,
): string {
  if (opportunities.length === 0) {
    return `<section class="panel"><h2>Opportunities</h2><p class="muted">No opportunities match this view. Evaluate a sample lead, clear filters, or reset local demo data if needed.</p></section>`;
  }

  return `<section class="panel"><div class="panel-header"><h2>Opportunities</h2><span>${opportunities.length} shown</span></div>
    <div class="list">
      ${opportunities.map((item) => renderOpportunityCard(item, selectedLeadId === item.id, activeSavedView, activeQuery, activePipelineStatus)).join('')}
    </div>
  </section>`;
}

function renderOpportunityCard(
  item: OpportunityListItem,
  isSelected: boolean,
  activeSavedView?: DashboardSavedViewKey,
  activeQuery?: string,
  activePipelineStatus?: PipelineStatus,
): string {
  const badges = [
    item.qualificationStatus,
    item.urgency,
    item.alertEligible ? 'alert' : undefined,
    item.overdue ? 'overdue' : undefined,
  ].filter(Boolean);

  return `<a class="lead-card ${isSelected ? 'selected' : ''}" href="${escapeHtml(createLeadHref(item.id, activeSavedView, activeQuery, activePipelineStatus))}" data-lead-id="${escapeHtml(item.id)}">
    <div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml([item.source, item.leadType, item.serviceCategory].join(' · '))}</p>
      <p class="muted">${escapeHtml(item.companyName ?? item.contactName ?? item.country ?? 'No company/contact yet')}</p>
      <p class="muted small">Owner: ${escapeHtml(item.owner ?? 'Unassigned')} · Status: ${escapeHtml(item.pipelineStatus)}</p>
    </div>
    <div class="score">${item.score ?? '—'}</div>
    <div class="badges">${badges.map((badge) => `<span>${escapeHtml(String(badge))}</span>`).join('')}</div>
  </a>`;
}

function renderLeadDetail(lead: LeadDetailView): string {
  return `<aside class="panel detail" data-detail-lead-id="${escapeHtml(lead.id)}">
    <div class="panel-header"><h2>Lead Detail</h2><span>${escapeHtml(lead.pipelineStatus)}</span></div>
    <h3>${escapeHtml(lead.title)}</h3>
    <p>${escapeHtml(lead.description)}</p>
    <dl class="facts">
      <div><dt>Score</dt><dd>${lead.score ?? '—'}</dd></div>
      <div><dt>Profile</dt><dd>${escapeHtml(lead.recommendedProfile ?? '—')}</dd></div>
      <div><dt>Portfolio Matches</dt><dd>${lead.portfolioMatches.length}</dd></div>
      <div><dt>Drafts</dt><dd>${lead.drafts.length}</dd></div>
      <div><dt>Owner</dt><dd>${escapeHtml(lead.owner ?? 'Unassigned')}</dd></div>
      <div><dt>Freshness</dt><dd>${typeof lead.freshnessMinutes === 'number' ? `${lead.freshnessMinutes}m` : '—'}</dd></div>
    </dl>
    <h4>Recommended Action</h4>
    <p>${escapeHtml(lead.recommendedNextAction ?? 'No action generated yet.')}</p>
    <h4>Source Evidence</h4>
    ${renderSourceEvidence(lead)}
    <h4>Safe Review Actions</h4>
    <p class="muted small">These actions only update the internal local pipeline. They do not send emails, submit Upwork proposals, or message LinkedIn contacts.</p>
    ${renderStatusActionForm(lead)}
    ${renderOwnerForm(lead)}
    ${renderNoteForm(lead)}
    <h4>Draft Preview</h4>
    ${renderDraftPreview(lead)}
    <h4>Portfolio Proof</h4>
    ${renderPortfolioPreview(lead)}
    <h4>Red Flags</h4>
    ${renderRedFlags(lead)}
    <h4>Notes</h4>
    <ul>${lead.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('') || '<li>No notes yet.</li>'}</ul>
  </aside>`;
}

function renderSourceEvidence(lead: LeadDetailView): string {
  return `<div class="source-evidence">
    <dl class="facts compact-facts">
      <div><dt>Source</dt><dd>${escapeHtml(lead.source)}</dd></div>
      <div><dt>Lead Type</dt><dd>${escapeHtml(lead.leadType)}</dd></div>
      <div><dt>Captured</dt><dd>${escapeHtml(lead.capturedAt)}</dd></div>
      <div><dt>Budget</dt><dd>${escapeHtml(lead.budgetSignal ?? '—')}</dd></div>
      <div><dt>Timeline</dt><dd>${escapeHtml(lead.timelineSignal ?? '—')}</dd></div>
      <div><dt>URL</dt><dd>${lead.sourceUrl ? `<a href="${escapeHtml(lead.sourceUrl)}" target="_blank" rel="noreferrer">Open source</a>` : '—'}</dd></div>
    </dl>
    ${lead.rawPayload ? `<details><summary>Raw evidence preview</summary><pre class="evidence-json">${escapeHtml(formatRawPayload(lead.rawPayload))}</pre></details>` : '<p class="muted small">No raw payload attached to this lead.</p>'}
  </div>`;
}

function renderStatusActionForm(lead: LeadDetailView): string {
  if (lead.allowedStatusActions.length === 0) {
    return '<p class="muted">No next status actions are available for this lead.</p>';
  }

  return `<form class="action-strip" data-status-form data-lead-id="${escapeHtml(lead.id)}">
    ${lead.allowedStatusActions.map((status) => `<button type="submit" name="status" value="${escapeHtml(status)}">${escapeHtml(formatStatusLabel(status))}</button>`).join('')}
  </form>`;
}

function renderOwnerForm(lead: LeadDetailView): string {
  return `<form class="inline-form" data-owner-form data-lead-id="${escapeHtml(lead.id)}">
    <label>
      Owner
      <input name="owner" value="${escapeHtml(lead.owner ?? '')}" placeholder="e.g. Waseem / BD lead" />
    </label>
    <button type="submit">Assign</button>
  </form>`;
}

function renderNoteForm(lead: LeadDetailView): string {
  return `<form class="inline-form note-form" data-note-form data-lead-id="${escapeHtml(lead.id)}">
    <label>
      Add note
      <textarea name="note" rows="3" placeholder="Add review note, blocker, or next step"></textarea>
    </label>
    <button type="submit">Save note</button>
  </form>`;
}

function renderDraftPreview(lead: LeadDetailView): string {
  const draft = lead.drafts[0];
  if (!draft) return '<p class="muted">No draft generated yet.</p>';
  return `<div class="preview-block"><strong>${escapeHtml(draft.type)}</strong><p>${escapeHtml(draft.body)}</p><button type="button" data-copy-draft>Copy draft for manual review</button><template>${escapeHtml(draft.body)}</template></div>`;
}

function renderPortfolioPreview(lead: LeadDetailView): string {
  if (lead.portfolioMatches.length === 0) return '<p class="muted">No portfolio proof matched yet.</p>';
  return `<ul>${lead.portfolioMatches.slice(0, 3).map((match) => `<li><strong>${escapeHtml(match.projectName)}</strong> — ${escapeHtml(String(match.score))}</li>`).join('')}</ul>`;
}

function renderRedFlags(lead: LeadDetailView): string {
  if (lead.redFlags.length === 0) return '<p class="muted">No red flags detected.</p>';
  return `<ul>${lead.redFlags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join('')}</ul>`;
}

function renderEmptyDetail(): string {
  return `<aside class="panel detail"><h2>Lead Detail</h2><p class="muted">Select a lead to review score, profile, proof, draft, notes, and next actions.</p></aside>`;
}

function baseStyles(): string {
  return `
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f6f7fb; color: #111827; }
    .shell { width: min(1200px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0; }
    .hero { background: #111827; color: white; border-radius: 24px; padding: 32px; margin-bottom: 20px; }
    .eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 12px; opacity: .75; margin: 0 0 8px; }
    h1, h2, h3, h4, p { margin-top: 0; }
    h1 { font-size: clamp(32px, 5vw, 56px); margin-bottom: 10px; }
    .subcopy { color: #d1d5db; max-width: 820px; margin-bottom: 0; }
    .metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
    .metric { background: white; border: 1px solid #e5e7eb; border-radius: 18px; padding: 16px; }
    .metric span { color: #6b7280; font-size: 13px; display: block; }
    .metric strong { font-size: 28px; display: block; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(360px, .8fr); gap: 20px; align-items: start; }
    .panel { background: white; border: 1px solid #e5e7eb; border-radius: 22px; padding: 20px; box-shadow: 0 10px 30px rgba(17, 24, 39, .04); }
    .intake, .saved-views, .filters { margin-bottom: 20px; }
    .panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .panel-header.compact { margin-bottom: 10px; }
    .panel-header h2 { margin: 0 0 6px; }
    .panel-header span { color: #6b7280; font-size: 13px; }
    .lead-form { display: grid; gap: 12px; }
    label { display: grid; gap: 6px; color: #374151; font-weight: 700; }
    select, textarea, input { width: 100%; border: 1px solid #d1d5db; border-radius: 14px; padding: 12px; font: inherit; background: white; color: #111827; }
    textarea { resize: vertical; }
    .form-actions, .action-strip, .view-chips { display: flex; flex-wrap: wrap; gap: 10px; }
    .filter-form { display: grid; grid-template-columns: minmax(0, 1fr) 220px auto; gap: 10px; align-items: end; }
    button, .chip { border: 0; border-radius: 999px; padding: 10px 16px; background: #111827; color: white; font-weight: 800; cursor: pointer; text-decoration: none; font-size: 14px; }
    button[type="button"], .chip { background: #eef2ff; color: #3730a3; }
    .danger-button { background: #fee2e2 !important; color: #991b1b !important; }
    .chip.active { background: #111827; color: white; }
    .text-link { color: #3730a3; font-weight: 800; text-decoration: none; }
    .result { margin: 14px 0 0; padding: 14px; border-radius: 14px; background: #0f172a; color: #e5e7eb; white-space: pre-wrap; overflow: auto; }
    .list { display: grid; gap: 12px; }
    .lead-card { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 14px; border: 1px solid #e5e7eb; border-radius: 16px; color: inherit; text-decoration: none; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
    .lead-card:hover, .lead-card.selected { border-color: #6366f1; box-shadow: 0 12px 28px rgba(79, 70, 229, .12); transform: translateY(-1px); }
    .lead-card h3 { margin-bottom: 6px; font-size: 16px; }
    .lead-card p { margin-bottom: 5px; color: #374151; }
    .score { font-size: 26px; font-weight: 800; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; grid-column: 1 / -1; }
    .badges span { background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 5px 9px; font-size: 12px; font-weight: 700; }
    .muted { color: #6b7280; }
    .small { font-size: 13px; }
    .detail { position: sticky; top: 20px; }
    .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 18px 0; }
    .compact-facts { margin: 0; }
    .facts div, .preview-block, .source-evidence { background: #f9fafb; border-radius: 12px; padding: 12px; }
    .source-evidence a { color: #3730a3; font-weight: 800; }
    .evidence-json { max-height: 220px; overflow: auto; white-space: pre-wrap; background: #111827; color: #e5e7eb; border-radius: 12px; padding: 12px; }
    .preview-block p { white-space: pre-wrap; margin: 8px 0 12px; }
    .inline-form { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: end; margin: 12px 0; }
    .note-form { grid-template-columns: 1fr; }
    .note-form button { justify-self: start; }
    dt { color: #6b7280; font-size: 12px; }
    dd { margin: 4px 0 0; font-weight: 800; overflow-wrap: anywhere; }
    ul { padding-left: 20px; }
    @media (max-width: 900px) { .metrics, .grid, .inline-form, .filter-form { grid-template-columns: 1fr; } .detail { position: static; } }
  `;
}

function clientScript(): string {
  return `
    const source = document.getElementById('lead-source');
    const text = document.getElementById('lead-text');
    const result = document.getElementById('lead-result');
    const sampleUpwork = document.getElementById('sample-upwork-text').innerHTML;
    const sampleLinkedIn = document.getElementById('sample-linkedin-text').innerHTML;

    document.getElementById('sample-upwork').addEventListener('click', () => {
      source.value = 'upwork';
      text.value = decodeHtml(sampleUpwork);
    });

    document.getElementById('sample-linkedin').addEventListener('click', () => {
      source.value = 'linkedin';
      text.value = decodeHtml(sampleLinkedIn);
    });

    document.getElementById('refresh-dashboard').addEventListener('click', () => {
      window.location.reload();
    });

    document.getElementById('reset-local-data').addEventListener('click', async () => {
      const confirmed = window.confirm('Reset local demo lead data? This only clears the local JSON store and does not touch any external system.');
      if (!confirmed) return;
      showResult('Resetting local demo data...');
      try {
        const response = await fetch('/api/dev/reset-local-data', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sales-automation-session': 'dev-founder-token' },
          body: JSON.stringify({ confirmed: true }),
        });
        const json = await response.json();
        showResult(JSON.stringify(json, null, 2) + (response.ok ? '\n\nReset complete. Reloading dashboard...' : ''));
        if (response.ok) setTimeout(() => window.location.href = '/', 700);
      } catch (error) {
        showResult(String(error));
      }
    });

    document.querySelectorAll('[data-copy-draft]').forEach((button) => {
      button.addEventListener('click', async () => {
        const template = button.parentElement?.querySelector('template');
        const draftText = template ? decodeHtml(template.innerHTML) : '';
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(draftText);
          } else {
            fallbackCopy(draftText);
          }
          showResult('Draft copied for manual review. Nothing was sent automatically.');
        } catch (error) {
          fallbackCopy(draftText);
          showResult('Draft copied with fallback copy method. Nothing was sent automatically.');
        }
      });
    });

    document.getElementById('lead-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      showResult('Evaluating lead...');
      const endpoint = source.value === 'upwork' ? '/api/ingest/upwork-email' : '/api/ingest/linkedin-signal';
      const payload = source.value === 'upwork'
        ? { emailBody: text.value, receivedAt: new Date().toISOString() }
        : { text: text.value, capturedAt: new Date().toISOString() };

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sales-automation-session': 'dev-founder-token' },
          body: JSON.stringify(payload),
        });
        const json = await response.json();
        showResult(JSON.stringify(json, null, 2) + (response.ok ? '\n\nSaved locally. Reloading dashboard...' : ''));
        if (response.ok) setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        showResult(String(error));
      }
    });

    document.querySelectorAll('[data-status-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const status = event.submitter?.value;
        if (!status) return;
        await postLeadAction(form.dataset.leadId, 'status', { status });
      });
    });

    document.querySelectorAll('[data-owner-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const owner = new FormData(form).get('owner');
        await postLeadAction(form.dataset.leadId, 'owner', { owner });
      });
    });

    document.querySelectorAll('[data-note-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const note = new FormData(form).get('note');
        await postLeadAction(form.dataset.leadId, 'notes', { note });
      });
    });

    async function postLeadAction(leadId, action, payload) {
      if (!leadId) return;
      showResult('Updating internal pipeline...');
      try {
        const response = await fetch('/api/opportunities/' + encodeURIComponent(leadId) + '/' + action, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sales-automation-session': 'dev-founder-token' },
          body: JSON.stringify(payload),
        });
        const json = await response.json();
        showResult(JSON.stringify(json, null, 2) + (response.ok ? '\n\nUpdated locally. Reloading dashboard...' : ''));
        if (response.ok) setTimeout(() => window.location.reload(), 700);
      } catch (error) {
        showResult(String(error));
      }
    }

    function showResult(value) {
      result.hidden = false;
      result.textContent = value;
      result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function fallbackCopy(value) {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }

    function decodeHtml(value) {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = value;
      return textarea.value;
    }
  `;
}

function createLeadHref(
  leadId: string,
  activeSavedView?: DashboardSavedViewKey,
  activeQuery?: string,
  activePipelineStatus?: PipelineStatus,
): string {
  return createListHref({ savedView: activeSavedView, query: activeQuery, status: activePipelineStatus, leadId });
}

function createListHref(input: {
  savedView?: DashboardSavedViewKey;
  query?: string;
  status?: PipelineStatus;
  leadId?: string;
}): string {
  const params = new URLSearchParams();
  if (input.savedView) params.set('savedView', input.savedView);
  if (input.query) params.set('query', input.query);
  if (input.status) params.set('status', input.status);
  if (input.leadId) params.set('leadId', input.leadId);
  const query = params.toString();
  return query ? `?${query}` : '/';
}

function formatStatusLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function formatRawPayload(value: unknown): string {
  const formatted = JSON.stringify(value, null, 2) ?? String(value);
  return formatted.length > 1200 ? `${formatted.slice(0, 1200)}\n...truncated for local review` : formatted;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
