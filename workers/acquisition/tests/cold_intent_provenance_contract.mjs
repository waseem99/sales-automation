import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(process.cwd(), '..', '..');
const shared = readFileSync(resolve(root, 'packages/shared/src/intent-provenance.ts'), 'utf8');
const drafting = readFileSync(resolve(root, 'packages/drafting/src/index.ts'), 'utf8');
const intakeApi = readFileSync(resolve(root, 'api/acquisition-ingest.ts'), 'utf8');
const intentRuntime = readFileSync(resolve(root, 'vercel/acquisition-intent-provenance-runtime.ts'), 'utf8');
const salesNavigator = readFileSync(resolve(root, 'vercel/sales-navigator-intake-runtime.ts'), 'utf8');
const prospectHandler = readFileSync(resolve(root, 'apps/web/src/prospect-handler.ts'), 'utf8');
const prospectPage = readFileSync(resolve(root, 'apps/web/src/prospects-page.ts'), 'utf8');

for (const marker of [
  "INTENT_PROVENANCE_VERSION = 'intent-provenance.v1'",
  'COLD_NO_CONFIRMED_INTENT_WARNING',
  'sourceBuyerIntentConfirmed',
  'linkedWarmIntentConfirmed',
  'coldSourceHistory',
  'warmEvidence',
  'invalidOrStaleWarmEvidence',
  "effectiveInterpretation: 'linked_warm_evidence'",
  'originalSourceClassificationPreserved: true',
  'buyerIntentConfirmed: provenance.sourceBuyerIntentConfirmed',
  'safeColdDraft',
]) {
  assert(shared.includes(marker), `Shared intent-provenance contract is missing ${marker}`);
}

assert(intakeApi.indexOf('applyIdentityGraphAfterIntake') < intakeApi.indexOf('applyIntentProvenanceAfterIntake'));
assert(intakeApi.indexOf('applyIntentProvenanceAfterIntake') < intakeApi.indexOf('applyEnrichmentAfterIntake'));
assert(intentRuntime.includes('resolveIntentGroup'));
assert(intentRuntime.includes('readIdentityResolution'));
assert(intentRuntime.includes('linked_warm_evidence'));
assert(intentRuntime.includes('cold_source_preserved'));
assert(intentRuntime.includes('externalActionAutomated: false'));

for (const marker of [
  "source: 'sales_navigator'",
  "leadType: 'sales_navigator_cold_prospect'",
  "prospectStage: 'cold_prospect'",
  'buyer_intent_confirmed: false',
  'buyerIntentConfirmed: false',
  'externalActionAutomated: false',
]) {
  assert(salesNavigator.includes(marker), `Sales Navigator intake contract is missing ${marker}`);
}

for (const marker of [
  'if (cold)',
  'safeColdDraft(input.lead, provenance)',
  "status: isSalesNavigatorCold(input.lead) ? 'needs_review' : 'draft_ready'",
  'COLD_NO_CONFIRMED_INTENT_WARNING',
  'Do not rewrite account fit, role fit, enrichment or campaign matching as confirmed buyer intent.',
]) {
  assert(drafting.includes(marker), `Drafting contract is missing ${marker}`);
}

assert(prospectHandler.includes('return { ...record.lead, notes: record.notes, auditLog: record.auditLog, evaluation: record.latestEvaluation }'));
assert(prospectPage.includes('lead.evidenceSummary ?? lead.description'));
assert(prospectPage.includes('lead.recommendedNextAction'));
assert(prospectPage.includes('lead.draftMessage ?? fallbackMessage(lead)'));

const combined = `${shared}\n${drafting}\n${intakeApi}\n${intentRuntime}\n${salesNavigator}`.toLowerCase();
for (const prohibited of [
  'externalactionautomated: true',
  'external_action_performed: true',
  'automatic sending enabled',
]) {
  assert(!combined.includes(prohibited), `Automatic external-action boundary violated: ${prohibited}`);
}

console.log('Cold intent provenance contract passed.');
