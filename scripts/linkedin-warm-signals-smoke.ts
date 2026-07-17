import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../packages/prospect-discovery/src/linkedin-warm-signals.ts', import.meta.url), 'utf8');
const inbox = await readFile(new URL('../packages/outreach-email/src/linkedin-signal-inbox.ts', import.meta.url), 'utf8');
const api = await readFile(new URL('../api/linkedin-signals.ts', import.meta.url), 'utf8');
const cron = await readFile(new URL('../api/cron/linkedin-signals.ts', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../vercel/linkedin-warm-signals-runtime.ts', import.meta.url), 'utf8');
const intakeClient = await readFile(new URL('../public/assets/linkedin-intake.v1.js', import.meta.url), 'utf8');
const manualIntake = await readFile(new URL('../vercel/manual-intake-runtime.ts', import.meta.url), 'utf8');
const dashboardRuntime = await readFile(new URL('../api/dashboard-runtime.ts', import.meta.url), 'utf8');
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
assert.match(inbox, /internalSenderPattern/);
assert.match(inbox, /acknowledgeLinkedInSignalInbox/);
assert.match(inbox, /messageFlagsAdd/);
assert.doesNotMatch(inbox, /messageFlagsAdd\(message\.uid/);

assert.match(api, /restricted to Admin and Waseem/);
assert.match(api, /title:'LinkedIn Intake'/);
assert.match(runtime, /externalActionAutomated:\s*false/);
assert.match(runtime, /No logged-in LinkedIn crawling/);
assert.match(runtime, /id="linkedin-research-form"/);
assert.match(runtime, /action="\/api\/prospects\/manual-intake"/);
assert.match(runtime, /name="sourceKind" value="public_post"/);
assert.match(runtime, /Manual research note for a LinkedIn target prospect/);
assert.match(runtime, /needs research before outreach/);
assert.match(runtime, /linkedin-intake\.v1\.js/);
assert.doesNotMatch(runtime.toLowerCase(), /playwright|puppeteer|selenium/);

assert.match(intakeClient, /credentials:\s*'same-origin'/);
assert.match(intakeClient, /content-type': 'application\/json'/);
assert.match(intakeClient, /validLinkedInUrl/);
assert.match(intakeClient, /No duplicate was created|no duplicate was created/i);
assert.doesNotMatch(intakeClient.toLowerCase(), /connect|inmail|message linkedin|scroll|navigate linkedin/);

assert.match(dashboardRuntime, /'\/api\/prospects\/manual-intake'/);
assert.match(manualIntake, /applyAutomaticAssignment/);
assert.match(manualIntake, /auditMissingFirstOutreachGuidance/);
assert.match(manualIntake, /humanReviewRequired:\s*true/);
assert.match(manualIntake, /externalActionAutomated:\s*false/);

assert.match(cron, /collectPublicLinkedInIndexSignals/);
assert.match(cron, /pollLinkedInSignalInbox/);
assert.match(cron, /persistNeonAppState/);
assert.match(cron, /acknowledgeLinkedInSignalInbox/);
assert.match(cron, /acknowledgeOnlyAfterPersistence:\s*true/);
assert.match(cron, /automatedExternalMessaging:\s*false/);
assert.match(cron, /dedicatedMailboxOnly:\s*true/);
assert.match(cron, /processLinkedInWarmSignalBatch/);

assert.match(controls, /linkedin_signal_inbox/);
assert.match(controls, /linkedin_public_index/);
assert.ok(vercel.functions?.['api/linkedin-signals.ts']);
assert.ok(vercel.functions?.['api/cron/linkedin-signals.ts']);
assert.ok(vercel.crons?.some((item) => item.path === '/api/cron/linkedin-signals' && item.schedule === '*/30 * * * *'));
assert.ok(vercel.rewrites?.some((item) => item.source === '/linkedin-signals' && item.destination === '/api/linkedin-signals'));
assert.ok(vercel.rewrites?.some((item) => item.source === '/api/prospects/:path*' && item.destination?.includes('/api/dashboard')));

console.log('LinkedIn assisted intake, warm signal quality, compliance and persistence contract passed');
