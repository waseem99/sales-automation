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
        <p class="subcopy">Review every threshold-qualified opportunity quickly. No fixed daily lead limits.</p>
      </header>
      ${renderSummary(input.summary)}
      <section class="grid">
        ${renderOpportunityList(input.opportunities)}
        ${input.selectedLead ? renderLeadDetail(input.selectedLead) : renderEmptyDetail()}
      </section>
    </main>
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
    <h4>Allowed Next Statuses</h4>
    <div class="badges">${lead.allowedStatusActions.map((status) => `<span>${escapeHtml(status)}</span>`).join('') || '<span>none</span>'}</div>
    <h4>Notes</h4>
    <ul>${lead.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('') || '<li>No notes yet.</li>'}</ul>
  </aside>`;
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
    .subcopy { color: #d1d5db; max-width: 720px; margin-bottom: 0; }
    .metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
    .metric { background: white; border: 1px solid #e5e7eb; border-radius: 18px; padding: 16px; }
    .metric span { color: #6b7280; font-size: 13px; display: block; }
    .metric strong { font-size: 28px; display: block; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(360px, .8fr); gap: 20px; align-items: start; }
    .panel { background: white; border: 1px solid #e5e7eb; border-radius: 22px; padding: 20px; box-shadow: 0 10px 30px rgba(17, 24, 39, .04); }
    .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .panel-header h2 { margin: 0; }
    .panel-header span { color: #6b7280; font-size: 13px; }
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
    .facts div { background: #f9fafb; border-radius: 12px; padding: 12px; }
    dt { color: #6b7280; font-size: 12px; }
    dd { margin: 4px 0 0; font-weight: 800; }
    ul { padding-left: 20px; }
    @media (max-width: 900px) { .metrics, .grid { grid-template-columns: 1fr; } .detail { position: static; } }
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
