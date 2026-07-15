import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../packages/prospect-discovery/src/linkedin-warm-signals.ts', import.meta.url), 'utf8');
const inbox = await readFile(new URL('../packages/outreach-email/src/linkedin-signal-inbox.ts', import.meta.url), 'utf8');
const api = await readFile(new URL('../api/linkedin-signals.ts', import.meta.url), 'utf8');
const cron = await readFile(new URL('../api/cron/linkedin-signals.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../vercel/linkedin-warm-signals-runtime.ts', import.meta.url), 'utf8');
const controls = await readFile(new URL('../packages/neon-state/src/source-controls.ts', import.meta.url), 'utf8');
const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  functions?: Record<string, unknown>;
  crons?: Array<{ path?: string; schedule?: string }>;
  rewrites?: Array<{ source?: string; destination?: string }>;
};

assert.match(core, /linkedin_job_vacancy/);
assert.match(core, /service_provider_self_promotion/);
assert.match(core, /public_index_requires_human_verification/);
assert.match(core, /input\.origin === 'public_index'/);
assert.match(core, /signalDedupeKeys/);
assert.match(core, /messageId/);
assert.match(core, /fingerprint/);
assert.match(core, /isLinkedInPostUrl/);
assert.doesNotMatch(core, /playwright|puppeteer|selenium|linkedin\.com\/voyager|li_at/i);

assert.match(inbox, /LINKEDIN_SIGNAL_MAILBOX_EMAIL/);
assert.match(inbox, /LINKEDIN_SIGNAL_MAILBOX_PASSWORD/);
assert.match(inbox, /configured:\s*Boolean\(mailboxEmail && mailboxPassword\)/);
assert.match(inbox, /@codistan\\\.org/);
assert.match(inbox, /messageFlagsAdd/);

assert.match(api, /restricted to Admin and Waseem/);
assert.match(runtime, /externalActionAutomated:\s*false/);
assert.match(runtime, /No logged-in LinkedIn crawling/);
assert.match(cron, /collectPublicLinkedInIndexSignals/);
assert.match(cron, /pollLinkedInSignalInbox/);
assert.match(cron, /automatedExternalMessaging:\s*false/);
assert.match(cron, /dedicatedMailboxOnly:\s*true/);
assert.match(cron, /processLinkedInWarmSignalBatch/);

assert.match(controls, /linkedin_signal_inbox/);
assert.match(controls, /linkedin_public_index/);
assert.ok(vercel.functions?.['api/linkedin-signals.ts']);
assert.ok(vercel.functions?.['api/cron/linkedin-signals.ts']);
assert.ok(vercel.crons?.some((item) => item.path === '/api/cron/linkedin-signals' && item.schedule === '*/30 * * * *'));
assert.ok(vercel.rewrites?.some((item) => item.source === '/linkedin-signals' && item.destination === '/api/linkedin-signals'));

console.log('LinkedIn warm signal quality, compliance, source-control and deployment contract passed');
