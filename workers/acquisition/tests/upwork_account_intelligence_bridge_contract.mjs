import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve('../..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/upwork-account-intelligence/package.json'), 'utf8'));
const source = fs.readFileSync(path.join(repoRoot, 'packages/upwork-account-intelligence/src/index.ts'), 'utf8');
const tests = fs.readFileSync(path.join(repoRoot, 'packages/upwork-account-intelligence/src/index.test.ts'), 'utf8');
const runtime = fs.readFileSync(path.join(repoRoot, 'vercel/upwork-account-intelligence-runtime.ts'), 'utf8');
const endpoint = fs.readFileSync(path.join(repoRoot, 'api/acquisition-ingest.ts'), 'utf8');
const workspace = fs.readFileSync(path.join(repoRoot, 'vercel/workspace-page-model.ts'), 'utf8');
const workspaceRuntime = fs.readFileSync(path.join(repoRoot, 'vercel/workspace-dashboard-runtime.js'), 'utf8');
const accountUi = fs.readFileSync(path.join(repoRoot, 'vercel/upwork-account-workspace-ui.ts'), 'utf8');

assert.equal(rootPackage.dependencies['@sales-automation/upwork-account-intelligence'], 'workspace:*');
assert.equal(packageJson.name, '@sales-automation/upwork-account-intelligence');
assert.equal(packageJson.scripts.test, 'tsx src/index.test.ts');

for (const marker of [
  "UPWORK_ACCOUNT_INTELLIGENCE_VERSION = 'upwork-account-intelligence.v1'",
  "AccountPromotionStatus = 'eligible' | 'research' | 'job_only' | 'suppressed'",
  'deriveUpworkAccountIntelligence',
  'attachUpworkAccountIntelligence',
  "source: 'partner_research'",
  "leadType: 'partner_prospect'",
  "prospectStage: 'partner_prospect'",
  "opportunityStatus: 'partnership_target'",
  'explicitBuyerIntentConfirmed: false',
  'sourceVisibleOnly: true',
  'platformRestriction',
  'No stable visible buyer, person or company identity is available',
  'Anonymous or weakly identified Upwork buyers must remain job-only records',
  'Do not move the live Upwork job off-platform automatically',
  'externalActionPerformed: false',
]) assert(source.includes(marker), `missing Upwork account-intelligence marker: ${marker}`);

for (const marker of [
  "intelligence.status, 'job_only'",
  "intelligence.status, 'eligible'",
  "intelligence.status, 'suppressed'",
  "accountLead?.source, 'partner_research'",
  "explicitBuyerIntentConfirmed, false",
  "route === 'delivery_partner'",
  "route === 'direct_buyer'",
]) assert(tests.includes(marker), `missing Upwork account-intelligence scenario: ${marker}`);

for (const marker of [
  'applyUpworkAccountIntelligenceAfterIntake',
  'deriveUpworkAccountIntelligence',
  'mergePreservingBdHistory',
  'readEnrichmentSnapshot',
  'resolveLeadIdentity',
  'persistLeadRecords',
  'platformRestrictionsPreserved: true',
  'externalActionAutomated: false',
]) assert(runtime.includes(marker), `missing Upwork account-intelligence runtime marker: ${marker}`);

const campaignInvocation = endpoint.indexOf('const campaignResponse = await applyCampaignEngineAfterIntake');
const accountInvocation = endpoint.indexOf('return applyUpworkAccountIntelligenceAfterIntake');
assert(campaignInvocation >= 0 && accountInvocation > campaignInvocation, 'Upwork account intelligence must run after campaign matching.');
assert(endpoint.includes("import { applyUpworkAccountIntelligenceAfterIntake }"));
assert(workspace.includes("lead.source === 'partner_research'"));
assert(workspace.includes("lead.leadType === 'partner_prospect'"));

for (const marker of [
  'enhanceUpworkAccountWorkspaceUi',
  'Open linked account prospect',
  'Cold account hypothesis linked to warm jobs',
  'Linked Upwork jobs',
  'Account-level campaign hypotheses',
  'Platform restriction',
  '/leads/partnerships?leadId=',
  '/leads/upwork?leadId=',
]) assert(accountUi.includes(marker), `missing linked-account workspace marker: ${marker}`);

assert(workspaceRuntime.includes("import('./upwork-account-workspace-ui.js')"));
assert(workspaceRuntime.includes('enhanceUpworkAccountWorkspaceUi(body, selected)'));

const prohibited = [
  'externalActionPerformed: true',
  'externalActionAutomated: true',
  'submitProposal',
  'sendMessage',
  'sendEmail',
  'connectRequest',
  'hidden client identity',
];
for (const marker of prohibited) {
  assert(!source.toLowerCase().includes(marker.toLowerCase()), `account package contains prohibited marker: ${marker}`);
  assert(!runtime.toLowerCase().includes(marker.toLowerCase()), `account runtime contains prohibited marker: ${marker}`);
  assert(!accountUi.toLowerCase().includes(marker.toLowerCase()), `account UI contains prohibited marker: ${marker}`);
}

console.log('Upwork account intelligence bridge contract passed.');
