import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../api/acquisition-ingest.ts', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('../vercel/acquisition-ingest-runtime.ts', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  functions?: Record<string, unknown>;
};

assert.match(apiSource, /handleAcquisitionIngest/);
assert.ok(vercelConfig.functions?.['api/acquisition-ingest.ts']);

assert.match(runtimeSource, /ACQUISITION_INGEST_TOKEN/);
assert.match(runtimeSource, /timingSafeEqual/);
assert.match(runtimeSource, /Only Priority A and B opportunities may be ingested/);
assert.match(runtimeSource, /external_action_performed must be false/);
assert.match(runtimeSource, /source_record\.evidence\.source must be upwork/);
assert.match(runtimeSource, /must be an HTTPS Upwork URL/);
assert.match(runtimeSource, /handleManualIntakeRuntime/);
assert.match(runtimeSource, /loadNeonAppState/);
assert.match(runtimeSource, /persistLeadRecords/);
assert.match(runtimeSource, /applyAutomaticAssignment|manual-intake-runtime/);
assert.match(runtimeSource, /humanReviewRequired: true/);
assert.match(runtimeSource, /externalActionAutomated: false/);
assert.match(runtimeSource, /idempotencyKey/);
assert.match(runtimeSource, /acquisition::upwork_scheduled/);
assert.match(runtimeSource, /cache-control/);
assert.match(runtimeSource, /content-security-policy/);

assert.doesNotMatch(runtimeSource, /submitProposal|sendMessage|applyToJob|connectToLead/);
assert.doesNotMatch(runtimeSource, /console\.log\([^)]*(body|payload|token)/i);

console.log('Machine-token acquisition intake safety contract passed');
