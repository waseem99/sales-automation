import {FUNNEL_STAGES, type FunnelAnalyticsSummary, type FunnelDimensionSummary} from '@sales-automation/funnel-analytics';

export function renderFunnelAnalyticsDashboard(summary: FunnelAnalyticsSummary): string {
  const stageCards = FUNNEL_STAGES.map((stage) => `<article><span>${escapeHtml(label(stage))}</span><strong>${summary.stageCounts[stage]}</strong><small>${stage === 'captured' ? 'Baseline' : `${summary.conversionPercent[stage] ?? 0}% from prior stage`}</small></article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seller Funnel Analytics</title><style>${styles()}</style></head><body>
  <main><header><div><p>Codistan Sales Automation</p><h1>Seller funnel analytics</h1><span>Version ${escapeHtml(summary.version)} · generated ${escapeHtml(summary.generatedAt)}</span></div><div class="status ${summary.reconciled ? 'ok' : 'bad'}">${summary.reconciled ? 'Events reconciled' : 'Reconciliation required'}</div></header>
  <section class="cards">${stageCards}</section>
  <section class="guard"><strong>Human-action boundary</strong><span>Manual contact events: ${summary.manualContactCount}</span><span>Approved-integration contact confirmations: ${summary.confirmedIntegrationContactCount}</span><span>Automatic external actions: No</span></section>
  ${dimensionTable('By source', summary.bySource)}
  ${dimensionTable('By campaign', summary.byCampaign)}
  ${dimensionTable('By offer version', summary.byOffer)}
  ${dimensionTable('By owner', summary.byOwner)}
  <section><h2>Reason codes</h2><div class="reasons">${Object.entries(summary.reasonCounts).map(([reason, count]) => `<div><span>${escapeHtml(label(reason))}</span><strong>${count}</strong></div>`).join('')}</div></section>
  </main></body></html>`;
}

function dimensionTable(title: string, rows: FunnelDimensionSummary[]): string {
  const body = rows.map((row) => `<tr><th>${escapeHtml(row.key)}</th><td>${row.captured}</td><td>${row.qualified}</td><td>${row.accepted}</td><td>${row.contactedManually}</td><td>${row.replied}</td><td>${row.meetings}</td><td>${row.proposals}</td><td>${row.won}</td><td>${row.lost}</td></tr>`).join('');
  return `<section><h2>${escapeHtml(title)}</h2><div class="table"><table><thead><tr><th>Segment</th><th>Captured</th><th>Qualified</th><th>Accepted</th><th>Contacted</th><th>Replied</th><th>Meeting</th><th>Proposal</th><th>Won</th><th>Lost</th></tr></thead><tbody>${body || '<tr><td colspan="10">No funnel events recorded.</td></tr>'}</tbody></table></div></section>`;
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[character] ?? character));
}

function styles(): string {
  return `:root{font-family:Inter,system-ui,sans-serif;color:#172033;background:#f4f6f9}*{box-sizing:border-box}body{margin:0}main{max-width:1500px;margin:auto;padding:28px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;background:#fff;border:1px solid #dfe4ec;border-radius:16px;padding:20px}header p{margin:0;color:#647084;font-size:12px;text-transform:uppercase;letter-spacing:.08em}h1{margin:4px 0 6px}h2{margin:0 0 12px}.status{padding:9px 12px;border-radius:999px;font-weight:700}.status.ok{background:#e8f7ee;color:#176537}.status.bad{background:#fdecec;color:#982a2a}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}.cards article{display:grid;gap:6px;background:#fff;border:1px solid #dfe4ec;border-radius:12px;padding:14px}.cards strong{font-size:28px}.cards span,.cards small{color:#627086}.guard{display:flex;flex-wrap:wrap;gap:10px 24px;background:#fff8e5;border:1px solid #ebd59a;border-radius:12px;padding:14px;margin-bottom:18px}section:not(.cards):not(.guard){background:#fff;border:1px solid #dfe4ec;border-radius:14px;padding:16px;margin:0 0 18px}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px;border-bottom:1px solid #e7ebf1;text-align:right}th:first-child,td:first-child{text-align:left}.reasons{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}.reasons div{display:flex;justify-content:space-between;padding:9px;border:1px solid #e4e8ef;border-radius:8px}`;
}
