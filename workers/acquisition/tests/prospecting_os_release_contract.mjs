import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('../..');
const acquisition = path.join(root, 'workers/acquisition');
const manifest = JSON.parse(fs.readFileSync(path.join(acquisition, 'release-manifest.json'), 'utf8'));
const upwork = JSON.parse(fs.readFileSync(path.join(acquisition, 'extensions/upwork/manifest.json'), 'utf8'));
const linkedin = JSON.parse(fs.readFileSync(path.join(acquisition, 'extensions/linkedin/manifest.json'), 'utf8'));
const runtimeInit = fs.readFileSync(path.join(acquisition, 'acquisition_v4/__init__.py'), 'utf8');
const installer = fs.readFileSync(path.join(acquisition, 'scripts/windows/install-acquisition-v4.ps1'), 'utf8');
const readiness = fs.readFileSync(path.join(acquisition, 'scripts/windows/check-prospecting-os-release.ps1'), 'utf8');
const pilot = fs.readFileSync(path.join(acquisition, 'scripts/windows/check-prospecting-os-pilot.ps1'), 'utf8');
const pilotModel = fs.readFileSync(path.join(acquisition, 'acquisition_v4/prospecting_os_acceptance.py'), 'utf8');
const commercial = fs.readFileSync(path.join(root, 'packages/commercial-readiness/src/index.ts'), 'utf8');
const canonicalStart = fs.readFileSync(path.join(acquisition, 'START-HERE-PROSPECTING-OS.cmd'), 'utf8');
const canonicalCheck = fs.readFileSync(path.join(acquisition, 'CHECK-PROSPECTING-OS-RELEASE.cmd'), 'utf8');
const canonicalPilot = fs.readFileSync(path.join(acquisition, 'CHECK-PROSPECTING-OS-PILOT.cmd'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'docs/prospecting-os/RELEASE-1.0-RC1.md'), 'utf8');
const docsLower = docs.toLowerCase();

assert.equal(manifest.schema_version, 'codistan-prospecting-os-release.v1');
assert.equal(manifest.product, 'Codistan Prospecting OS');
assert.equal(manifest.release_version, '1.0.0-rc.1');
assert.equal(manifest.release_status, 'live_validation');
assert.equal(manifest.components.upwork_extension, upwork.version);
assert.equal(manifest.components.linkedin_sales_navigator_extension, linkedin.version);
assert.equal(manifest.components.commercial_readiness, 'commercial-readiness.v1');
assert.equal(manifest.components.combined_pilot_acceptance, 'codistan-prospecting-os-acceptance.v1');
assert(runtimeInit.includes(`__version__ = "${manifest.components.local_runtime}"`));
assert.deepEqual(manifest.collectors.map((item) => item.source), ['upwork', 'linkedin', 'sales_navigator']);
assert.deepEqual(manifest.collectors.map((item) => item.port), [8765, 8775, 8785]);
assert.equal(manifest.state_contract.external_actions_enabled, false);
assert.equal(manifest.offer_release_policy.fintech_operations_platform, 'research_only');
assert.equal(manifest.offer_release_policy.managed_software_ai_delivery, 'outreach_ready_limited');
assert(manifest.on_hold.some((item) => item.capability === 'automatic external outreach'));
assert(manifest.on_hold.some((item) => item.capability === 'paid enrichment providers'));
assert(manifest.on_hold.some((item) => item.capability === 'additional acquisition sources'));
assert(manifest.on_hold.some((item) => item.capability.includes('FinTech Backend Operations Platform')));

for (const marker of [
  'app-current', 'app-previous', 'prospect-desk-sync.json',
  'Start Prospecting OS.lnk', 'Check Prospecting OS Release.lnk', 'Check Prospecting OS Pilot.lnk',
  'Start Acquisition V5.lnk', 'Check Acquisition V5.lnk',
  'external_actions_enabled -eq $false',
  'The previous application folder was restored',
  'Commercial readiness:',
]) assert(installer.includes(marker), `missing installer marker: ${marker}`);

for (const marker of [
  'codistan-prospecting-os-readiness.v1',
  'ready_for_local_capture', 'ready_for_commercial_pilot',
  'prospecting-os-release-readiness.json',
  'external_actions_enabled = $false',
  'upwork', 'linkedin', 'sales_navigator',
]) assert(readiness.includes(marker), `missing readiness marker: ${marker}`);

for (const marker of [
  'acquisition_v4.prospecting_os_acceptance',
  'commercial-review.json',
  'prospecting-os-pilot-acceptance.json',
  'Automatic external actions remain disabled',
]) assert(pilot.includes(marker), `missing combined pilot marker: ${marker}`);

for (const marker of [
  'MIN_ACCEPTANCE_RATIO = 0.60',
  'MIN_HUMAN_REVIEWS = 15',
  'MIN_REVIEWS_PER_SOURCE = 3',
  'blocked_external_action_evidence',
  'commercial_gate_passed',
  'automatic_external_actions_allowed": False',
]) assert(pilotModel.includes(marker), `missing pilot acceptance rule: ${marker}`);

for (const marker of [
  "COMMERCIAL_READINESS_VERSION = 'commercial-readiness.v1'",
  "status: 'research_only'",
  "status: 'outreach_ready_limited'",
  'assertCommerciallyReadyForApproval',
  'Do not claim an existing bank deployment unless verified',
  'Do not promise unlimited capacity',
]) assert(commercial.includes(marker), `missing commercial readiness rule: ${marker}`);

assert(canonicalStart.includes('install-acquisition-v4.ps1'));
assert(canonicalCheck.includes('check-prospecting-os-release.ps1'));
assert(canonicalPilot.includes('check-prospecting-os-pilot.ps1'));
assert(docsLower.includes('at least 60% accepted for pursuit'));
assert(docsLower.includes('automatic external outreach'));
assert(docs.includes('No captured record, deduplication fingerprint'));
assert(docsLower.includes('current status: research-only for cold outreach'));
assert(docsLower.includes('current status: outreach-ready with limitations'));
assert(docs.includes('CHECK-PROSPECTING-OS-PILOT.cmd'));

const prohibited = [
  'external_actions_enabled = $true',
  'externalActionPerformedBySystem: true',
  'sendEmail(', 'sendMessage(', 'submitProposal(', 'sendInMail(', 'connectRequest(',
];
const combined = `${installer}\n${readiness}\n${pilot}\n${commercial}\n${canonicalStart}\n${canonicalCheck}\n${canonicalPilot}`.toLowerCase();
for (const marker of prohibited) {
  assert(!combined.includes(marker.toLowerCase()), `release package contains prohibited marker: ${marker}`);
}

console.log('Prospecting OS release, commercial readiness and pilot acceptance contract passed.');
