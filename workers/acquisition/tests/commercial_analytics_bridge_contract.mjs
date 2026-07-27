import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve('../..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/commercial-analytics/package.json'), 'utf8'));
const neonPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/neon-state/package.json'), 'utf8'));
const vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
const source = fs.readFileSync(path.join(repoRoot, 'packages/commercial-analytics/src/index.ts'), 'utf8');
const tests = fs.readFileSync(path.join(repoRoot, 'packages/commercial-analytics/src/index.test.ts'), 'utf8');
const persistence = fs.readFileSync(path.join(repoRoot, 'packages/neon-state/src/commercial-calibration.ts'), 'utf8');
const api = fs.readFileSync(path.join(repoRoot, 'api/commercial-analytics.ts'), 'utf8');

assert.equal(rootPackage.dependencies['@sales-automation/commercial-analytics'], 'workspace:*');
assert.equal(packageJson.name, '@sales-automation/commercial-analytics');
assert.equal(packageJson.dependencies['@sales-automation/bd-workflow'], 'workspace:*');
assert.equal(packageJson.dependencies['@sales-automation/outreach-workbench'], 'workspace:*');
assert.equal(packageJson.scripts.test, 'tsx src/index.test.ts');
assert.equal(neonPackage.dependencies['@sales-automation/commercial-analytics'], 'workspace:*');
assert(neonPackage.exports['./commercial-calibration']);
assert(vercel.functions['api/commercial-analytics.ts']);
assert(vercel.rewrites.some((item) => item.source === '/commercial-analytics'));
assert(vercel.rewrites.some((item) => item.source === '/api/commercial-analytics/decision'));
assert(vercel.rewrites.some((item) => item.source === '/api/commercial-analytics/value'));

for (const marker of [
  "COMMERCIAL_ANALYTICS_VERSION = 'commercial-analytics.v1'",
  "CommercialDimension = 'source' | 'campaign' | 'channel' | 'service' | 'owner'",
  "CalibrationDecisionValue = 'keep' | 'change' | 'stop'",
  "CommercialValueKind = 'pipeline' | 'proposal' | 'won_revenue'",
  'buildCommercialAnalytics',
  'recordCommercialValue',
  'commercialValueHistory',
  'createCalibrationDecision',
  'suggestedCalibrationDecision',
  'readOutreachWorkbench',
  'readBdWorkflow',
  'draft.sentVersions',
  'approved.approval?.revisionId',
  "revision.source === 'human_edit'",
  "task.code === 'schedule_follow_up'",
  "source: 'manual_entry'",
  'explicitValue: true',
  'fabricatedOutcomeCount: 0',
  'externalActionPerformed: false',
  'representative reviewed sample',
  'change one major targeting or playbook rule',
  'plannedChange is required',
  'reactivationCriteria is required',
  'Won revenue may be recorded only after the prospect is marked won',
]) assert(source.includes(marker), `missing commercial analytics marker: ${marker}`);

for (const marker of [
  'summary.counts.contacted, 1',
  'summary.counts.replies, 1',
  'summary.counts.dueFollowUps, 1',
  'summary.counts.onTimeFollowUps, 1',
  'summary.counts.duplicates, 1',
  'summary.aiDisposition.edited, 1',
  'summary.values[0]?.pipeline, 25000',
  "officialDecision?.decision, 'keep'",
  'fabricatedOutcomeCount, 0',
  'explicitValue, true',
  'only after the prospect is marked won',
  'plannedChange',
  'reactivationCriteria',
  "decision, 'stop'",
  "decision, 'insufficient_data'",
]) assert(tests.includes(marker), `missing commercial analytics behavior test: ${marker}`);

for (const marker of [
  'commercial_calibration_decisions',
  'PRIMARY KEY (dimension, lane_key)',
  'upsertCommercialCalibrationDecision',
  'loadCommercialCalibrationDecisions',
  'deleteCommercialCalibrationDecision',
  'decision_json JSONB',
]) assert(persistence.includes(marker), `missing calibration persistence marker: ${marker}`);

for (const marker of [
  "SESSION_COOKIE = 'codistan_admin_session'",
  "ACTOR_COOKIE = 'codistan_admin_actor'",
  "'/commercial-analytics'",
  "'/api/commercial-analytics'",
  "'/api/commercial-analytics/decision'",
  "'/api/commercial-analytics/value'",
  'resolveDashboardAccess',
  'loadNeonScopedRecords',
  'loadNeonProspectRecord',
  'access.canRunGlobalOperations && !access.canAssignOwners',
  'Forbidden: commercial calibration decisions are restricted to management',
  'recordCommercialValue',
  'upsertCommercialCalibrationDecision',
  'Explicit values only',
  'No amounts are inferred',
  'Currency totals are never converted or combined',
  'Do not optimize for volume',
  'An algorithm suggestion is not an official decision',
  '7,30,90,180',
]) assert(api.includes(marker), `missing commercial analytics API/UI marker: ${marker}`);

for (const dimension of ['source','campaign','channel','service','owner']) {
  assert(source.includes(`'${dimension}'`), `analytics engine is missing dimension: ${dimension}`);
  assert(api.includes(`'${dimension}'`), `analytics dashboard is missing dimension: ${dimension}`);
}

const combined = `${source}\n${persistence}\n${api}`.toLowerCase();
for (const marker of [
  'sendemail(',
  'sendmessage(',
  'sendinmail(',
  'submitproposal(',
  'connectrequest(',
  'externalactionperformed: true',
  'fabricatedoutcomecount: 1',
  'navigator.webdriver',
  'captcha bypass',
]) assert(!combined.includes(marker.toLowerCase()), `commercial analytics contains prohibited marker: ${marker}`);

assert(!api.includes('currencyConversion'));
assert(!api.includes('exchangeRate'));
assert(!source.includes('inferred_revenue'));

console.log('Commercial analytics safety and integration contract passed.');
