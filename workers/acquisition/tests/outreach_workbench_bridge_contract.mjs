import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve('../..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const webPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/web/package.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/outreach-workbench/package.json'), 'utf8'));
const source = fs.readFileSync(path.join(repoRoot, 'packages/outreach-workbench/src/index.ts'), 'utf8');
const tests = fs.readFileSync(path.join(repoRoot, 'packages/outreach-workbench/src/index.test.ts'), 'utf8');
const automation = fs.readFileSync(path.join(repoRoot, 'apps/web/src/outreach-workbench-automation.ts'), 'utf8');
const handler = fs.readFileSync(path.join(repoRoot, 'apps/web/src/outreach-workbench-handler.ts'), 'utf8');
const handlerTests = fs.readFileSync(path.join(repoRoot, 'apps/web/src/outreach-workbench-handler.test.ts'), 'utf8');
const autoHandler = fs.readFileSync(path.join(repoRoot, 'apps/web/src/auto-prospect-handler.ts'), 'utf8');
const secureHandler = fs.readFileSync(path.join(repoRoot, 'apps/web/src/secure-prospect-handler.ts'), 'utf8');
const ui = fs.readFileSync(path.join(repoRoot, 'vercel/outreach-workbench-ui.ts'), 'utf8');
const runtime = fs.readFileSync(path.join(repoRoot, 'vercel/workspace-dashboard-runtime.js'), 'utf8');

assert.equal(rootPackage.dependencies['@sales-automation/outreach-workbench'], 'workspace:*');
assert.equal(webPackage.dependencies['@sales-automation/outreach-workbench'], 'workspace:*');
assert(webPackage.scripts.test.includes('outreach-workbench-handler.test.ts'));
assert.equal(packageJson.name, '@sales-automation/outreach-workbench');
assert.equal(packageJson.scripts.test, 'tsx src/index.test.ts');

for (const marker of [
  "OUTREACH_WORKBENCH_VERSION = 'outreach-workbench.v1'",
  "'upwork_proposal'",
  "'linkedin_comment'",
  "'linkedin_dm'",
  "'sales_navigator_inmail'",
  "'email'",
  "'referral'",
  'OutreachVersion',
  'approvedVersionId',
  'differedFromApproved',
  'manualExternalActionConfirmed: true',
  'systemExternalActionPerformed: false',
  'initializeOutreachWorkbench',
  'editOutreachDraft',
  'submitOutreachForReview',
  'approveOutreachDraft',
  'recordOutreachCopy',
  'recordManualOutreachSend',
  'recordOutreachOutcome',
  'changeSequenceStatus',
  'Manager approval is required',
  'Possible duplicate contact history must be resolved',
  'The live job must remain on Upwork',
  'This is a cold hypothesis, not confirmed buyer demand',
  'internalTaskOnly: true',
  'stopOnReply: true',
]) assert(source.includes(marker), `missing outreach workbench marker: ${marker}`);

for (const marker of [
  "allowedChannels, ['upwork_proposal']",
  "recommendedChannel, 'email'",
  'versions.length, 2',
  "status, 'approved'",
  "status, 'sent_manually'",
  'differedFromApproved, true',
  "sequencePlan.status, 'stopped'",
  'Manager approval is required',
  'Cannot approve',
  'duplicate contact history',
]) assert(tests.includes(marker), `missing outreach lifecycle test: ${marker}`);

for (const marker of [
  'evaluatorSeedDrafts',
  'evaluatorApprovedProof',
  'portfolioItemIds',
  'metadata.assumptions',
  'metadata.safeguards',
  'attachOutreachWorkbench',
]) assert(automation.includes(marker), `missing evaluator/workbench bridge marker: ${marker}`);

for (const marker of [
  '/outreach',
  'initialize',
  'submit-review',
  'mark-sent',
  'manualConfirmation',
  'system_did_not_send',
  'recordManualOutreachSend',
  'recordOutreachOutcome',
  "pipelineStatus: 'sent_manually'",
  "outcome === 'opt_out'",
  'doNotContact: true',
]) assert(handler.includes(marker), `missing secured workbench handler marker: ${marker}`);

assert(autoHandler.includes('response.status === 404'));
assert(autoHandler.includes('isOutreachWorkbenchPath(pathname)'));
assert(autoHandler.includes('access.canAssignOwners || access.canRunGlobalOperations'));
assert(secureHandler.includes('outreach(?:\\/.*)?'));
assert(handlerTests.includes('unauthenticated.status, 401'));
assert(handlerTests.includes('denied.status, 409'));
assert(handlerTests.includes('scope-denied'));

for (const marker of [
  'Human-controlled outreach',
  'No automatic sending',
  'Save as new version',
  'Approve exact version',
  'Copy approved version',
  'Record a message I already sent manually',
  'I confirm that I sent this manually outside the system',
  'This button does not send anything',
  'Immutable version history',
  'Exact manually sent records',
  'data-outreach-form',
  'data-outreach-copy',
  'navigator.clipboard.writeText',
]) assert(ui.includes(marker), `missing workbench UI marker: ${marker}`);

assert(runtime.includes("import('./outreach-workbench-ui.js')"));
assert(runtime.includes('enhanceOutreachWorkbenchUi'));
assert(runtime.includes('canManagerApprove: access.canAssignOwners || access.canRunGlobalOperations'));

const combined = `${source}\n${automation}\n${handler}\n${autoHandler}\n${secureHandler}\n${ui}\n${runtime}`.toLowerCase();
for (const marker of [
  'sendemail(',
  'sendmessage(',
  'sendinmail(',
  'submitproposal(',
  'connectrequest(',
  'followlead(',
  'externalactionperformed: true',
  'systemexternalactionperformed: true',
  'navigator.webdriver',
  'captcha bypass',
]) assert(!combined.includes(marker.toLowerCase()), `outreach workbench contains prohibited action marker: ${marker}`);

console.log('Outreach workbench safety and integration contract passed.');
