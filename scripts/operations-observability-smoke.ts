import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: Array<{ source: string; destination: string }>;
};
const operations = readFileSync(new URL('../vercel/operations-runtime.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../api/dashboard.ts', import.meta.url), 'utf8');
const dashboardRuntime = readFileSync(new URL('../api/dashboard-runtime.ts', import.meta.url), 'utf8');
const discoveryCron = readFileSync(new URL('../api/cron/prospect-discovery.ts', import.meta.url), 'utf8');
const tenderDiscovery = readFileSync(new URL('../api/tender-discovery.ts', import.meta.url), 'utf8');
const sourceControls = readFileSync(new URL('../packages/neon-state/src/source-controls.ts', import.meta.url), 'utf8');
const qualityRunner = readFileSync(new URL('../packages/prospect-discovery/src/quality-runner.ts', import.meta.url), 'utf8');
const qualityTest = readFileSync(new URL('../packages/prospect-discovery/src/quality-runner.test.ts', import.meta.url), 'utf8');

assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/operations')?.destination, '/api/dashboard?__path=/operations');
assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/api/source-controls')?.destination, '/api/dashboard?__path=/api/source-controls');

assert.match(operations, /Performance by source/);
assert.match(operations, /sourceRecommendation/);
assert.match(operations, /activeShare > 0\.5/);
assert.match(operations, /OUTREACH_DNS_READY/);
assert.match(operations, /OUTREACH_SENDING_ENABLED/);
assert.match(operations, /VERCEL_GIT_COMMIT_SHA/);
assert.match(operations, /Release gate/);
assert.match(operations, /Production Vercel deployment/);
assert.match(operations, /source controls are restricted to Admin and Waseem/);
assert.match(operations, /repeatRecommendations/);
assert.match(operations, /priorityA/);
assert.match(operations, /meetings/);
assert.match(operations, /proposals/);
assert.match(operations, /won/);

assert.match(dashboard, /pathname === '\/operations'/);
assert.ok(dashboard.indexOf("pathname === '/operations'") < dashboard.indexOf("import('./dashboard-runtime.js')"));

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

console.log('Source quality, direct operations routing, deployment and outreach observability contracts passed');
