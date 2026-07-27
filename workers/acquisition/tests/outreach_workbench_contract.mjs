import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('../..');
const model = fs.readFileSync(path.join(root, 'packages/outreach-workbench/src/index.ts'), 'utf8');
const tests = fs.readFileSync(path.join(root, 'packages/outreach-workbench/src/index.test.ts'), 'utf8');
const readiness = fs.readFileSync(path.join(root, 'packages/commercial-readiness/src/index.ts'), 'utf8');
const readinessTests = fs.readFileSync(path.join(root, 'packages/commercial-readiness/src/index.test.ts'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/outreach-workbench.ts'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'vercel/outreach-workbench-ui.ts'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'vercel/workspace-dashboard-runtime.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');

for (const marker of [
  "OUTREACH_WORKBENCH_VERSION = 'outreach-workbench.v1'",
  'editOutreachDraft', 'submitDraftForReview', 'approveOutreachDraft', 'recordDraftCopied',
  'markDraftSentManually', 'exact approved revision', 'sent draft is immutable',
  'manuallyConfirmed: true', 'externalActionPerformedBySystem: false', 'automaticSendingEnabled: false',
]) assert(model.toLowerCase().includes(marker.toLowerCase()), `missing model marker: ${marker}`);

for (const marker of ['approval, undefined', "status, 'sent_manually'", 'contentHash, approvedRevision.contentHash', '/immutable/i', '/approved/i']) {
  assert(tests.includes(marker), `missing behavior assertion: ${marker}`);
}

for (const marker of [
  "COMMERCIAL_READINESS_VERSION = 'commercial-readiness.v1'",
  "status: 'research_only'",
  "status: 'outreach_ready_limited'",
  'assertCommerciallyReadyForApproval',
  'Commercial approval blocked',
  'Do not claim an existing bank deployment unless verified',
  'Do not promise unlimited capacity',
]) assert(readiness.includes(marker), `missing commercial readiness marker: ${marker}`);

for (const marker of [
  "decision.approvalAllowed, false",
  "decision.approvalAllowed, true",
  "decision.mode, 'warm_response'",
  '/commercial approval blocked/i',
]) assert(readinessTests.includes(marker), `missing commercial readiness assertion: ${marker}`);

for (const marker of [
  'Authentication required', 'visibility(actor)', 'persistLeadRecords', 'recordBdPipelineEvent',
  'assertCommerciallyReadyForApproval(record.lead)', 'commercialReadiness',
  'externalActionPerformedBySystem: false',
]) assert(api.includes(marker), `missing authenticated API marker: ${marker}`);

for (const marker of [
  'Outreach review workbench', 'Import generated drafts', 'Approve exact revision',
  'Confirm manually sent', 'It never sends, submits', 'data-outreach-workbench-script',
  'Commercial readiness',
]) assert(ui.includes(marker), `missing UI marker: ${marker}`);

assert(runtime.includes("import('./outreach-workbench-ui.js')"));
assert(runtime.includes('enhanceOutreachWorkbenchUi(body, selected)'));
assert(vercel.includes('api/outreach-workbench.ts'));
assert(vercel.includes('/api/outreach-workbench/:path*'));

const combined = `${model}\n${readiness}\n${api}\n${ui}`.toLowerCase();
for (const prohibited of ['sendemail(', 'sendmessage(', 'submitproposal(', 'sendinmail(', 'connectrequest(', 'externalactionperformedbysystem: true', 'automaticsendingenabled: true']) {
  assert(!combined.includes(prohibited.toLowerCase()), `prohibited outreach capability: ${prohibited}`);
}

console.log('Outreach workbench and commercial readiness contract passed.');
