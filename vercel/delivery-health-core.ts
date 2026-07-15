import {
  loadOperationalTelemetryEvents,
  summarizeOperationalTelemetry,
  type OperationalTelemetryEvent,
} from '@sales-automation/neon-state/operational-telemetry';

export const maxDuration = 300;
const SESSION_COOKIE = 'codistan_admin_session';
const ACTOR_COOKIE = 'codistan_admin_actor';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const secret = requireEnvironment('SESSION_SECRET');
      const actor = await authorizedDashboardActor(request, secret);
      if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401 });
      if (!['admin', 'waseem@codistan.org'].includes(actor)) {
        return Response.json({ error: 'Forbidden: delivery health is restricted to Admin and Waseem.' }, { status: 403 });
      }
      const databaseUrl = requireEnvironment('DATABASE_URL');
      const url = new URL(request.url);
      const lookbackHours = boundedInteger(url.searchParams.get('hours'), 168, 1, 24 * 90);
      const events = await loadOperationalTelemetryEvents(databaseUrl, { lookbackHours, limit: 500 });
      const summary = summarizeOperationalTelemetry(events);
      const payload = {
        ok: true,
        actor,
        lookbackHours,
        summary,
        mailboxes: mailboxHealth(events),
        alerts: telemetryAlerts(events, summary, lookbackHours),
        events: events.slice(0, 100),
        privacy: {
          messageBodiesStored: false,
          subjectsStored: false,
          recipientEmailsStored: false,
          recipientDomainsStored: true,
          repeatedAlertsBucketedHourly: true,
        },
      };
      if ((request.headers.get('accept') ?? '').includes('text/html')) return html(renderPage(payload));
      return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      console.error('DELIVERY_HEALTH_ERROR', error instanceof Error ? error.message : String(error));
      return Response.json({ error: 'Delivery health could not be loaded.' }, { status: 500 });
    }
  },
};

function mailboxHealth(events: OperationalTelemetryEvent[]) {
  const groups = new Map<string, OperationalTelemetryEvent[]>();
  for (const event of events) {
    const key = event.mailbox ?? 'worker aggregate';
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()].map(([mailbox, items]) => ({
    mailbox,
    imapPolls: count(items, 'imap_poll'),
    imapFailures: count(items, 'imap_failure'),
    deliveries: count(items, 'smtp_delivery'),
    failures: count(items, 'smtp_failure'),
    deferrals: count(items, 'smtp_deferral'),
    replies: count(items, 'reply'),
    bounces: count(items, 'bounce'),
    suppressions: count(items, 'suppression'),
    latestEventAt: items.map((event) => event.lastSeenAt).sort().reverse()[0],
  })).sort((left, right) => Date.parse(right.latestEventAt ?? '1970-01-01') - Date.parse(left.latestEventAt ?? '1970-01-01'));
}

function telemetryAlerts(
  events: OperationalTelemetryEvent[],
  summary: ReturnType<typeof summarizeOperationalTelemetry>,
  lookbackHours: number,
): string[] {
  const alerts: string[] = [];
  if (summary.health === 'no_data') alerts.push('No persisted outreach telemetry is available for this window.');
  if (summary.workerFailures > 0) alerts.push(`${summary.workerFailures} outreach worker failure occurrence(s) were recorded.`);
  if (summary.imapFailures > 0) alerts.push(`${summary.imapFailures} IMAP polling failure occurrence(s) were recorded.`);
  if (summary.smtpFailures > 0) alerts.push(`${summary.smtpFailures} permanent or unclassified SMTP failure occurrence(s) were recorded.`);
  if (summary.smtpDeferrals > 0) alerts.push(`${summary.smtpDeferrals} temporary SMTP deferral occurrence(s) were recorded.`);
  if (summary.bounces > 0) alerts.push(`${summary.bounces} bounce occurrence(s) were recorded.`);
  if (summary.lockSkips >= 3) alerts.push(`${summary.lockSkips} cycles were skipped because another outreach run held the lock.`);
  const latestImapSuccess = events
    .filter((event) => event.eventType === 'imap_poll' && event.status === 'success')
    .map((event) => event.lastSeenAt)
    .sort().reverse()[0];
  if (process.env.OUTREACH_REPLY_POLLING_ENABLED === 'true' && (!latestImapSuccess || Date.now() - Date.parse(latestImapSuccess) > 24 * 60 * 60 * 1000)) {
    alerts.push('Reply polling is enabled but no successful IMAP poll has been recorded in the last 24 hours.');
  }
  if (lookbackHours >= 24 && summary.smtpDeliveries > 0) {
    const bad = summary.smtpFailures + summary.smtpDeferrals + summary.bounces;
    const rate = bad / Math.max(1, summary.smtpDeliveries + bad);
    if (rate >= 0.1) alerts.push(`Delivery failure/deferral/bounce rate is ${Math.round(rate * 100)}% in this window.`);
  }
  return [...new Set(alerts)];
}

function renderPage(input: {
  lookbackHours: number;
  summary: ReturnType<typeof summarizeOperationalTelemetry>;
  mailboxes: ReturnType<typeof mailboxHealth>;
  alerts: string[];
  events: OperationalTelemetryEvent[];
}): string {
  const s = input.summary;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delivery & Mailbox Health</title><style>${styles()}</style></head><body><main>
  <header><div><p class="eyebrow">Issue #87 operational telemetry</p><h1>Delivery & Mailbox Health</h1><p>Persisted SMTP, IMAP, reply, bounce, suppression and worker health. No message bodies, subjects or recipient email addresses are stored.</p></div><nav><a href="/operations">Operations</a><a href="/priorities">Priorities</a><a href="/prospects">Prospects</a></nav></header>
  ${input.alerts.length ? `<section class="alerts"><h2>Needs attention</h2>${input.alerts.map((alert) => `<div>${escapeHtml(alert)}</div>`).join('')}</section>` : '<section class="healthy">No delivery or mailbox warning is active in this window.</section>'}
  <section class="metrics"><article><strong>${s.smtpDeliveries}</strong><span>SMTP deliveries</span></article><article><strong>${s.replies}</strong><span>Replies</span></article><article><strong>${s.bounces}</strong><span>Bounces</span></article><article><strong>${s.suppressions}</strong><span>Suppressions</span></article><article><strong>${s.smtpDeferrals}</strong><span>Deferrals</span></article><article><strong>${s.smtpFailures}</strong><span>SMTP failures</span></article><article><strong>${s.imapPolls}</strong><span>IMAP polls</span></article><article><strong>${s.imapFailures}</strong><span>IMAP failures</span></article></section>
  <section class="panel"><div class="title"><h2>Mailbox and worker summary</h2><span>Last ${input.lookbackHours} hours</span></div><div class="table"><table><thead><tr><th>Mailbox / worker</th><th>Polls</th><th>Poll failures</th><th>Delivered</th><th>Deferred</th><th>Failed</th><th>Replies</th><th>Bounces</th><th>Suppressions</th><th>Latest</th></tr></thead><tbody>${input.mailboxes.map((item) => `<tr><td>${escapeHtml(item.mailbox)}</td><td>${item.imapPolls}</td><td>${item.imapFailures}</td><td>${item.deliveries}</td><td>${item.deferrals}</td><td>${item.failures}</td><td>${item.replies}</td><td>${item.bounces}</td><td>${item.suppressions}</td><td>${escapeHtml(formatDate(item.latestEventAt))}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="panel"><div class="title"><h2>Latest privacy-safe events</h2><span>${input.events.length}</span></div><div class="events">${input.events.map(renderEvent).join('') || '<p>No events in this window.</p>'}</div></section>
  </main></body></html>`;
}

function renderEvent(event: OperationalTelemetryEvent): string {
  return `<article class="event ${event.status}"><div><strong>${escapeHtml(label(event.eventType))}</strong><span>${escapeHtml(event.provider)} · ${escapeHtml(event.worker)}</span></div><div><span>${event.occurrenceCount} occurrence(s)</span><span>${escapeHtml(formatDate(event.lastSeenAt))}</span></div><small>${escapeHtml([event.mailbox, event.recipientDomain, event.leadId].filter(Boolean).join(' · ') || 'Aggregate worker event')}</small></article>`;
}
function count(events: OperationalTelemetryEvent[], type: OperationalTelemetryEvent['eventType']): number { return events.filter((event) => event.eventType === type).reduce((sum, event) => sum + event.occurrenceCount, 0); }
function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number { const parsed = Number.parseInt(value ?? '', 10); return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback; }
function requireEnvironment(name: string): string { const value = process.env[name]; if (!value?.trim()) throw new Error(`${name} is required.`); return value.trim(); }
function formatDate(value: string | undefined): string { return value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Unavailable'; }
function label(value: string): string { return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function html(value: string): Response { return new Response(value, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' } }); }
function escapeHtml(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character] ?? character)); }
function parseCookies(value: string): Record<string, string> { const result: Record<string,string> = {}; for (const part of value.split(';')) { const [name,...rest] = part.trim().split('='); if (name) result[name] = rest.join('='); } return result; }
async function authorizedDashboardActor(request: Request, secret: string): Promise<string | undefined> { const cookies = parseCookies(request.headers.get('cookie') ?? ''); if (!(await validSession(cookies[SESSION_COOKIE], secret))) return undefined; const actorToken = cookies[ACTOR_COOKIE]; if (!actorToken) return 'admin'; const match = actorToken.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/); if (!match?.[1] || !match[2]) return undefined; const identifier = Buffer.from(match[1], 'base64url').toString('utf8').trim().toLowerCase(); return await safeEqual(actorToken, await actorTokenFor(identifier, secret)) ? identifier : undefined; }
async function validSession(token: string | undefined, secret: string): Promise<boolean> { const match = token?.match(/^(\d+)\.([A-Za-z0-9_-]+)$/); if (!match?.[1] || !match[2]) return false; const expiresAt = Number(match[1]); return Number.isFinite(expiresAt) && expiresAt > Math.floor(Date.now()/1000) && await safeEqual(token ?? '', await sessionTokenFor(expiresAt, secret)); }
async function sessionTokenFor(expiresAt: number, secret: string): Promise<string> { const { createHmac } = await import('node:crypto'); return `${expiresAt}.${createHmac('sha256', secret).update(`admin:${expiresAt}`).digest('base64url')}`; }
async function actorTokenFor(identifier: string, secret: string): Promise<string> { const { createHmac } = await import('node:crypto'); const encoded = Buffer.from(identifier, 'utf8').toString('base64url'); return `${encoded}.${createHmac('sha256', secret).update(`actor:${encoded}`).digest('base64url')}`; }
async function safeEqual(left: string, right: string): Promise<boolean> { const { timingSafeEqual } = await import('node:crypto'); const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a,b); }
function styles(): string { return `:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f4f6fb}*{box-sizing:border-box}body{margin:0}main{max-width:1320px;margin:32px auto;padding:0 20px}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px}h1,h2{margin:.2rem 0}p{color:#667085}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#667085}nav{display:flex;gap:10px;flex-wrap:wrap}a{color:#3157d5}.alerts,.healthy,.panel{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:18px;margin:14px 0}.alerts{border-color:#f0c36b;background:#fffaf0}.alerts div{margin:7px 0}.healthy{border-color:#9ed0ad;background:#f4fbf6}.metrics{display:grid;grid-template-columns:repeat(8,1fr);gap:10px}.metrics article{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:14px}.metrics strong{display:block;font-size:24px}.metrics span,.title span,small{font-size:11px;color:#667085}.title{display:flex;justify-content:space-between;align-items:center}.table{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #eef0f3;padding:10px;font-size:12px;white-space:nowrap}.events{display:grid;gap:8px}.event{display:grid;grid-template-columns:1fr auto;gap:6px;border:1px solid #e4e7ec;border-left-width:5px;border-radius:10px;padding:12px}.event>div{display:flex;gap:8px;align-items:center;justify-content:space-between}.event small{grid-column:1/-1}.event.failure{border-left-color:#d92d20}.event.warning{border-left-color:#f79009}.event.success{border-left-color:#12b76a}@media(max-width:1000px){.metrics{grid-template-columns:repeat(4,1fr)}}@media(max-width:650px){header{display:block}.metrics{grid-template-columns:repeat(2,1fr)}main{padding:0 12px}}`; }
