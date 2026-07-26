import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve('../..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const webPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/web/package.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/bd-workflow/package.json'), 'utf8'));
const source = fs.readFileSync(path.join(repoRoot, 'packages/bd-workflow/src/index.ts'), 'utf8');
const tests = fs.readFileSync(path.join(repoRoot, 'packages/bd-workflow/src/index.test.ts'), 'utf8');
const handler = fs.readFileSync(path.join(repoRoot, 'apps/web/src/prospect-handler.ts'), 'utf8');
const handlerTests = fs.readFileSync(path.join(repoRoot, 'apps/web/src/bd-workflow-handler.test.ts'), 'utf8');
const intake = fs.readFileSync(path.join(repoRoot, 'vercel/bd-workflow-intake-runtime.ts'), 'utf8');
const ui = fs.readFileSync(path.join(repoRoot, 'vercel/bd-workspace-ui.ts'), 'utf8');
const workspaceRuntime = fs.readFileSync(path.join(repoRoot, 'vercel/workspace-dashboard-runtime.js'), 'utf8');
const dashboardRuntime = fs.readFileSync(path.join(repoRoot, 'api/dashboard-runtime.ts'), 'utf8');
const acquisitionEndpoint = fs.readFileSync(path.join(repoRoot, 'api/acquisition-ingest.ts'), 'utf8');

assert.equal(rootPackage.dependencies['@sales-automation/bd-workflow'], 'workspace:*');
assert.equal(webPackage.dependencies['@sales-automation/bd-workflow'], 'workspace:*');
assert(webPackage.scripts.test.includes('bd-workflow-handler.test.ts'));
assert.equal(packageJson.name, '@sales-automation/bd-workflow');
assert.equal(packageJson.scripts.test, 'tsx src/index.test.ts');

for (const marker of [
  "BD_WORKFLOW_VERSION = 'bd-workflow.v1'",
  "BdTaskStatus = 'open' | 'in_progress' | 'completed' | 'dismissed' | 'on_hold'",
  'NextBestAction',
  'refreshBdWorkflow',
  'createBdTask',
  'updateBdTask',
  'recordBdPipelineEvent',
  'workflowQueueFacts',
  "code: 'assign_owner'",
  "code: 'review_duplicate_contact'",
  "code: 'review_suppression'",
  "code: 'prepare_outreach'",
  "code: 'schedule_follow_up'",
  "code: 'classify_reply'",
  "code: 'prepare_meeting'",
  "code: 'follow_up_proposal'",
  "code: 'capture_learning'",
  'humanReviewRequired: true',
  'externalActionPerformed: false',
  'Do not send or submit anything automatically',
]) assert(source.includes(marker), `missing BD workflow marker: ${marker}`);

for (const marker of [
  "nextBestAction.code, 'assign_owner'",
  "nextBestAction.code, 'review_duplicate_contact'",
  "nextBestAction.code, 'review_suppression'",
  "nextBestAction.code, 'prepare_outreach'",
  "nextBestAction.code, 'schedule_follow_up'",
  "nextBestAction.code, 'classify_reply'",
  "nextBestAction.code, 'prepare_meeting'",
  "nextBestAction.code, 'follow_up_proposal'",
  "nextBestAction.code, 'capture_learning'",
  "nextBestAction.code, 'no_action'",
  "status, 'completed'",
]) assert(tests.includes(marker), `missing BD workflow behavior test: ${marker}`);

for (const marker of [
  '/tasks$',
  '/tasks\\/([^/]+)\\/(start|complete|hold|reopen|dismiss)',
  '/next-action$',
  '/bd-workflow/backfill',
  'createBdTask',
  'updateBdTask',
  'refreshWorkflowRecord',
  'Pipeline stage changed to',
  'Prospect ownership changed to',
  'Buyer response recorded through',
  'Manual outreach',
]) assert(handler.includes(marker), `missing authenticated BD handler behavior: ${marker}`);

for (const marker of [
  "pipelineStatus, 'sent_manually'",
  "nextBestAction as Record<string, unknown>).code, 'schedule_follow_up'",
  'Authentication is required',
  'bd_task_created::',
]) assert(handlerTests.includes(marker), `missing BD handler test marker: ${marker}`);

for (const marker of [
  'applyBdWorkflowAfterIntake',
  'refreshBdWorkflow',
  'attachBdWorkflow',
  'persistLeadRecords',
  "status: 'deferred'",
  'humanReviewRequired: true',
  'externalActionAutomated: false',
]) assert(intake.includes(marker), `missing BD intake marker: ${marker}`);

for (const marker of [
  'Operational BD queue',
  'My queue',
  'Manager review',
  'Every active prospect needs an owner, task and due date',
  'BD operating workspace',
  'Claims and actions prohibited',
  'Create a task',
  'Recalculate next action',
  'data-bd-form',
  'Human only',
  'It never sends, submits or contacts anyone automatically',
]) assert(ui.includes(marker), `missing BD workspace UI marker: ${marker}`);

assert(workspaceRuntime.includes("import('./bd-workspace-ui.js')"));
assert(workspaceRuntime.includes('enhanceBdWorkspaceUi(body'));
assert(workspaceRuntime.includes('actorDisplayName: input.session.displayName'));
assert(dashboardRuntime.includes("'/api/prospects/bd-workflow/backfill'"));
assert(dashboardRuntime.includes('recordBdPipelineEvent'));
assert(dashboardRuntime.includes('Next follow-up scheduled for'));

const accountInvocation = acquisitionEndpoint.indexOf('const accountResponse = await applyUpworkAccountIntelligenceAfterIntake');
const workflowInvocation = acquisitionEndpoint.indexOf('return applyBdWorkflowAfterIntake');
assert(accountInvocation >= 0 && workflowInvocation > accountInvocation, 'BD workflow must initialize after account intelligence.');

const prohibited = [
  'externalActionPerformed: true',
  'externalActionAutomated: true',
  'submitProposal(',
  'sendEmail(',
  'sendMessage(',
  'connectRequest(',
  'sendInMail(',
  'navigator.webdriver',
  'captcha bypass',
];
for (const marker of prohibited) {
  assert(!source.toLowerCase().includes(marker.toLowerCase()), `BD workflow source contains prohibited marker: ${marker}`);
  assert(!intake.toLowerCase().includes(marker.toLowerCase()), `BD workflow intake contains prohibited marker: ${marker}`);
  assert(!ui.toLowerCase().includes(marker.toLowerCase()), `BD workspace UI contains prohibited marker: ${marker}`);
}

console.log('BD workspace bridge contract passed.');
