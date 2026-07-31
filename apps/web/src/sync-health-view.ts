import type {SyncHealthAggregate, SyncHealthSnapshot} from '@sales-automation/sync-health';

export function renderSyncHealthDashboard(aggregate: SyncHealthAggregate): string {
  const sourceCards = aggregate.sources.map((source) => sourceCard(source)).join('');
  const recordRows = aggregate.sources.flatMap((source) => source.records.map((record) => `<tr><td>${escapeHtml(source.source)}</td><td><code>${escapeHtml(record.idempotencyKey)}</code></td><td>${escapeHtml(record.status)}</td><td>${record.attempts}</td><td>${escapeHtml(record.nextRetryAt ?? '—')}</td><td>${escapeHtml(record.lastError ?? '—')}</td></tr>`)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synchronization Health</title><style>${styles()}</style></head><body><main>
  <header><div><p>Codistan Sales Automation</p><h1>Synchronization health</h1><span>${escapeHtml(aggregate.generatedAt)} · ${escapeHtml(aggregate.version)}</span></div><strong class="${aggregate.healthy ? 'healthy' : 'attention'}">${aggregate.healthy ? 'Healthy' : 'Attention required'}</strong></header>
  <section class="totals">${metric('Pending', aggregate.totals.pending)}${metric('Retrying', aggregate.totals.retrying)}${metric('Dead letter', aggregate.totals.deadLetter)}${metric('Conflicted', aggregate.totals.conflicted)}${metric('Applied', aggregate.totals.applied)}${metric('Duplicates', aggregate.totals.duplicates)}${metric('Merged', aggregate.totals.merged)}${metric('Failed', aggregate.totals.failed)}</section>
  <section class="sources">${sourceCards || '<p>No source snapshots have been published.</p>'}</section>
  <section><h2>Pending, retry and dead-letter records</h2><div class="table"><table><thead><tr><th>Source</th><th>Idempotency key</th><th>Status</th><th>Attempts</th><th>Next retry</th><th>Redacted diagnostic</th></tr></thead><tbody>${recordRows || '<tr><td colspan="6">No unresolved records.</td></tr>'}</tbody></table></div></section>
  <section class="guard"><strong>Safety boundary</strong><span>State root preserved: Yes</span><span>Diagnostics redacted: Yes</span><span>Replay requires explicit permission: Yes</span><span>Automatic external actions: No</span></section>
  </main></body></html>`;
}

function sourceCard(source: SyncHealthSnapshot): string {
  return `<article><header><h2>${escapeHtml(source.source)}</h2><span>${escapeHtml(source.collectedAt)}</span></header><dl><div><dt>Capture</dt><dd>${escapeHtml(source.capture)}</dd></div><div><dt>Local processing</dt><dd>${escapeHtml(source.localProcessing)}</dd></div><div><dt>Outbox</dt><dd>${escapeHtml(source.outbox)}</dd></div><div><dt>Prospect Desk</dt><dd>${escapeHtml(source.prospectDeskIngestion)}</dd></div><div><dt>Last success</dt><dd>${escapeHtml(source.lastSuccessfulSyncAt ?? 'Never')}</dd></div><div><dt>Average latency</dt><dd>${source.averageLatencyMs ?? 0} ms</dd></div><div><dt>Endpoint version</dt><dd>${escapeHtml(source.endpointVersion ?? 'Unknown')}</dd></div><div><dt>Version mismatch</dt><dd>${source.endpointVersionMismatch ? 'Yes' : 'No'}</dd></div></dl></article>`;
}

function metric(label: string, value: number): string {
  return `<article><span>${escapeHtml(label)}</span><strong>${value}</strong></article>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[character] ?? character));
}

function styles(): string {
  return `:root{font-family:Inter,system-ui,sans-serif;color:#172033;background:#f4f6f9}*{box-sizing:border-box}body{margin:0}main{max-width:1500px;margin:auto;padding:28px}main>header{display:flex;justify-content:space-between;gap:20px;background:#fff;border:1px solid #dfe4ec;border-radius:16px;padding:20px}header p{margin:0;color:#667287;font-size:12px;text-transform:uppercase;letter-spacing:.08em}h1{margin:4px 0}.healthy,.attention{padding:9px 12px;border-radius:999px;height:max-content}.healthy{background:#e7f7ed;color:#176337}.attention{background:#fff1df;color:#8a4b08}.totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:18px 0}.totals article,.sources article,main>section:not(.totals):not(.sources){background:#fff;border:1px solid #dfe4ec;border-radius:12px;padding:14px}.totals article{display:grid;gap:5px}.totals strong{font-size:28px}.sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:18px}.sources article header{display:flex;justify-content:space-between;gap:10px}.sources h2{margin:0}.sources dl{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sources dl div{border-top:1px solid #edf0f4;padding-top:7px}.sources dt{font-size:11px;color:#6b7586}.sources dd{margin:2px 0 0;font-weight:700}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #e6eaf0;max-width:330px}.guard{display:flex;flex-wrap:wrap;gap:10px 24px;margin-top:18px;background:#fff8e5!important;border-color:#ebd59a!important}`;
}
