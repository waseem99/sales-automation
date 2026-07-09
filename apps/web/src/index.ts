import type { DashboardSummary, LeadDetailView, OpportunityListItem } from '@sales-automation/dashboard';

export interface RenderDashboardPageInput {
  title?: string;
  summary: DashboardSummary;
  opportunities: OpportunityListItem[];
  selectedLead?: LeadDetailView;
}

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
      <section class="grid">
        ${renderOpportunityList(input.opportunities)}
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
  const sampleUpwork = `Job: Need AI automation support\nhttps://www.upwork.com/jobs/sample-mvp-ai-automation\nWe need an AI automation expert for n8n, OpenAI, RAG, and workflow automation. Budget $5,000. Posted 20 minutes ago.`;
  const sampleLinkedIn = `Sales Navigator saved search alert\nNew lead alert: Jane Founder — COO at Example SaaS\nPosted 35 minutes ago\nLooking for AI automation partner to reduce support backlog. https://www.linkedin.com/in/jane-founder`;

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
      </div>
    </form>
    <pre id="lead-result" class="result" hidden></pre>
    <template id="sample-upwork-text">${escapeHtml(sampleUpwork)}</template>
    <template id="sample-linkedin-text">${escapeHtml(sampleLinkedIn)}</template>
  </section>`;
}

function renderOpportunityList(opportunities: OpportunityListItem[]): string {
  if (opportunities.length === 0) {
    return `<section class="panel"><h2>Opportunities</h2><p class="muted">No opportunities match this view.</p></section>`;
  }

  return `<section class="panel"><div class="panel-header"><h2>Opportunities</h2><span>${opportunities.length} shown</span></div>
    <div class="list">
      ${opportunities.map(renderOpportunityCard).join('')}
    </div>
  </section>`;
}

function renderOpportunityCard(item: OpportunityListItem): string {
  const badges = [
    item.qualificationStatus,
    item.urgency,
    item.alertEligible ? 'alert' : undefined,
    item.overdue ? 'overdue' : undefined,
  ].filter(Boolean);

  return `<article class="lead-card" data-lead-id="${escapeHtml(item.id)}">
    <div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml([item.source, item.leadType, item.serviceCategory].join(' · '))}</p>
      <p class="muted">${escapeHtml(item.companyName ?? item.contactName ?? item.country ?? 'No company/contact yet')}</p>
    </div>
    <div class="score">${item.score ?? '—'}</div>
    <div class="badges">${badges.map((badge) => `<span>${escapeHtml(String(badge))}</span>`).join('')}</div>
  </article>`;
}

function renderLeadDetail(lead: LeadDetailView): string {
  return `<aside class="panel detail">
    <div class="panel-header"><h2>Lead Detail</h2><span>${escapeHtml(lead.pipelineStatus)}</span></div>
    <h3>${escapeHtml(lead.title)}</h3>
    <p>${escapeHtml(lead.description)}</p>
    <dl class="facts">
      <div><dt>Score</dt><dd>${lead.score ?? '—'}</dd></div>
      <div><dt>Profile</dt><dd>${escapeHtml(lead.recommendedProfile ?? '—')}</dd></div>
      <div><dt>Portfolio Matches</dt><dd>${lead.portfolioMatches.length}</dd></div>
      <div><dt>Drafts</dt><dd>${lead.drafts.length}</dd></div>
      <div><dt>Owner</dt><dd>${escapeHtml(lead.owner ?? 'Unassigned')}</dd></div>
    </dl>
    <h4>Recommended Action</h4>
    <p>${escapeHtml(lead.recommendedNextAction ?? 'No action generated yet.')}</p>
    <h4>Draft Preview</h4>
    ${renderDraftPreview(lead)}
    <h4>Portfolio Proof</h4>
    ${renderPortfolioPreview(lead)}
    <h4>Allowed Next Statuses</h4>
    <div class="badges">${lead.allowedStatusActions.map((status) => `<span>${escapeHtml(status)}</span>`).join('') || '<span>none</span>'}</div>
    <h4>Notes</h4>
    <ul>${lead.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('') || '<li>No notes yet.</li>'}</ul>
  </aside>`;
}

function renderDraftPreview(lead: LeadDetailView): string {
  const draft = lead.drafts[0];
  if (!draft) return '<p class="muted">No draft generated yet.</p>';
  return `<div class="preview-block"><strong>${escapeHtml(draft.channel)}</strong><p>${escapeHtml(draft.body)}</p></div>`;
}

function renderPortfolioPreview(lead: LeadDetailView): string {
  if (lead.portfolioMatches.length === 0) return '<p class="muted">No portfolio proof matched yet.</p>';
  return `<ul>${lead.portfolioMatches.slice(0, 3).map((match) => `<li><strong>${escapeHtml(match.projectName)}</strong> — ${escapeHtml(String(match.matchScore))}</li>`).join('')}</ul>`;
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
    .intake { margin-bottom: 20px; }
    .panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .panel-header h2 { margin: 0 0 6px; }
    .panel-header span { color: #6b7280; font-size: 13px; }
    .lead-form { display: grid; gap: 12px; }
    label { display: grid; gap: 6px; color: #374151; font-weight: 700; }
    select, textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 14px; padding: 12px; font: inherit; background: white; color: #111827; }
    textarea { resize: vertical; }
    .form-actions { display: flex; flex-wrap: wrap; gap: 10px; }
    button { border: 0; border-radius: 999px; padding: 10px 16px; background: #111827; color: white; font-weight: 800; cursor: pointer; }
    button[type="button"] { background: #eef2ff; color: #3730a3; }
    .result { margin: 14px 0 0; padding: 14px; border-radius: 14px; background: #0f172a; color: #e5e7eb; white-space: pre-wrap; overflow: auto; }
    .list { display: grid; gap: 12px; }
    .lead-card { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 14px; border: 1px solid #e5e7eb; border-radius: 16px; }
    .lead-card h3 { margin-bottom: 6px; font-size: 16px; }
    .lead-card p { margin-bottom: 5px; color: #374151; }
    .score { font-size: 26px; font-weight: 800; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; grid-column: 1 / -1; }
    .badges span { background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 5px 9px; font-size: 12px; font-weight: 700; }
    .muted { color: #6b7280; }
    .detail { position: sticky; top: 20px; }
    .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 18px 0; }
    .facts div, .preview-block { background: #f9fafb; border-radius: 12px; padding: 12px; }
    .preview-block p { white-space: pre-wrap; margin: 8px 0 0; }
    dt { color: #6b7280; font-size: 12px; }
    dd { margin: 4px 0 0; font-weight: 800; }
    ul { padding-left: 20px; }
    @media (max-width: 900px) { .metrics, .grid { grid-template-columns: 1fr; } .detail { position: static; } }
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

    document.getElementById('lead-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      result.hidden = false;
      result.textContent = 'Evaluating lead...';
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
        result.textContent = JSON.stringify(json, null, 2);
        if (response.ok) setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        result.textContent = String(error);
      }
    });

    function decodeHtml(value) {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = value;
      return textarea.value;
    }
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
