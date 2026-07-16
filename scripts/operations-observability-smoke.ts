import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: Array<{ source: string; destination: string }>;
};
const dashboard = readFileSync(new URL('../api/dashboard.ts', import.meta.url), 'utf8');
const operations = readFileSync(new URL('../vercel/operations-runtime.ts', import.meta.url), 'utf8');
const dashboardRuntime = readFileSync(new URL('../api/dashboard-runtime.ts', import.meta.url), 'utf8');
const discoveryCron = readFileSync(new URL('../api/cron/prospect-discovery.ts', import.meta.url), 'utf8');
const tenderDiscovery = readFileSync(new URL('../api/tender-discovery.ts', import.meta.url), 'utf8');
const sourceControls = readFileSync(new URL('../packages/neon-state/src/source-controls.ts', import.meta.url), 'utf8');
const qualityRunner = readFileSync(new URL('../packages/prospect-discovery/src/quality-runner.ts', import.meta.url), 'utf8');
const qualityTest = readFileSync(new URL('../packages/prospect-discovery/src/quality-runner.test.ts', import.meta.url), 'utf8');

assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/operations')?.destination, '/api/dashboard?__path=/operations');
assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/api/source-controls')?.destination, '/api/dashboard?__path=/api/source-controls');
assert.match(dashboard, /apply_operations_shell/);
assert.match(dashboard, /activeRoute: '\/operations'/);
assert.match(dashboard, /load_specialized_shell_renderer/);

assert.match(operations, /Sales Operations Dashboard/);
assert.match(operations, /buildOperationalMetrics/);
assert.match(operations, /loadNeonScopedRecords/);
assert.match(operations, /resolveDashboardAccess/);
assert.match(operations, /visibleOwnerTokens/);
assert.match(operations, /scopeKind === 'all'/);
assert.match(operations, /loadNeonDiscoveryRuns/);
assert.doesNotMatch(operations, /loadNeonAppState/);
assert.match(operations, /Exact owner-scoped record set/);
assert.match(operations, /data-operational-metric/);
assert.match(operations, /\/operations\?metric=/);
assert.match(operations, /Qualified active leads/);
assert.match(operations, /Due next 24h/);
assert.match(operations, /Overdue follow-ups/);
assert.match(operations, /LinkedIn opportunities/);
assert.match(operations, /Upwork opportunities/);
assert.match(operations, /Procurement deadlines/);
assert.match(operations, /Unassigned leads/);
assert.match(operations, /Weekly outcomes/);
assert.match(operations, /dateBetween\(record\.lead\.nextFollowUpAt, now, now \+ DAY_MS\)/);
assert.match(operations, /dateBefore\(record\.lead\.nextFollowUpAt, now\)/);
assert.match(operations, /dateBetween\(record\.lead\.tender\?\.deadline, now, now \+ 14 \* DAY_MS\)/);
assert.match(operations, /isLinkedInRecord/);
assert.match(operations, /isUpworkRecord/);
assert.match(operations, /!record\.lead\.owner\?\.trim\(\)/);
assert.match(operations, /weeklyOutcomeEvents/);
assert.match(operations, /entry\.action !== 'status_changed'/);
assert.match(operations, /meeting_booked/);
assert.match(operations, /proposal_sent/);
assert.match(operations, /won/);
assert.match(operations, /lost/);
assert.match(operations, /min-height:44px/);

assert.match(operations, /Performance by source/);
assert.match(operations, /Scoped to the signed-in account/);
assert.match(operations, /sourceRecommendation/);
assert.match(operations, /activeShare > 0\.5/);
assert.match(operations, /OUTREACH_DNS_READY/);
assert.match(operations, /OUTREACH_SENDING_ENABLED/);
assert.match(operations, /VERCEL_GIT_COMMIT_SHA/);
assert.match(operations, /Release gate/);
assert.match(operations, /source controls are restricted to Admin and Waseem/);
assert.match(operations, /repeatRecommendations/);
assert.match(operations, /priorityA/);
assert.match(operations, /meetings/);
assert.match(operations, /proposals/);

assert.match(sourceControls, /CREATE TABLE IF NOT EXISTS discovery_source_controls/);
assert.match(sourceControls, /reason of at least 8 characters/);
assert.match(sourceControls, /RemoteOK|remoteok/);
assert.match(sourceControls, /Disabled because employee vacancies are not direct sales opportunities/);

assert.match(dashboardRuntime, /handleOperationsRuntime/);
assert.match(dashboardRuntime, /loadDiscoverySourceControls/);
assert.match(dashboardRuntime, /sourceControlMap/);
assert.match(discoveryCron, /loadDiscoverySourceControls/);
assert.match(discoveryCron, /sourceControls/);
assert.match(tenderDiscovery, /loadDiscoverySourceControls/);
assert.match(tenderDiscovery, /sourceControls\.ppra/);
assert.match(tenderDiscovery, /sourceControls\.canadabuys/);

assert.match(qualityRunner, /applySourceControls/);
assert.match(qualityRunner, /sourceStats/);
assert.match(qualityRunner, /acceptedCandidates/);
assert.match(qualityTest, /source controls, campaign selection and final run persistence tests passed/);
assert.match(qualityTest, /controlled\.bingRssEnabled, false/);
assert.match(qualityTest, /sourceStats, \[\]/);

console.log('Owner-scoped operational metrics, weekly outcomes, source quality, audited controls and release observability contracts passed');
