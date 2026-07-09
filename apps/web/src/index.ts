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
  'needs_research',
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
    item.prospectStage,
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
      <div><dt>Stage</dt><dd>${escapeHtml(lead.prospectStage)}</dd></div>
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
      <div><dt>Stage</dt><dd>${escapeHtml(lead.prospectStage)}</dd></div>
      <div><dt>Captured</dt><dd>${escapeHtml(formatDate(lead.capturedAt))}</dd></div>
      <div><dt>Budget</dt><dd>${escapeHtml(lead.budgetSignal ?? '—')}</dd></div>
      <div><dt>Timeline</dt><dd>${escapeHtml(lead.timelineSignal ?? '—')}</dd></div>
    </dl>
    ${lead.sourceUrl ? `<p><a class="text-link" href="${escapeAttribute(lead.sourceUrl)}" target="_blank" rel="noreferrer">Open source reference</a></p>` : ''}
    <details>
      <summary>Raw source payload</summary>
      <pre>${escapeHtml(JSON.stringify(lead.rawPayload ?? {}, null, 2))}</pre>
    </details>
  </div>`;
}
