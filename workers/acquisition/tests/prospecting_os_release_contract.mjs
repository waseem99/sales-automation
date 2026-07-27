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
const canonicalStart = fs.readFileSync(path.join(acquisition, 'START-HERE-PROSPECTING-OS.cmd'), 'utf8');
const canonicalCheck = fs.readFileSync(path.join(acquisition, 'CHECK-PROSPECTING-OS-RELEASE.cmd'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'docs/prospecting-os/RELEASE-1.0-RC1.md'), 'utf8');

assert.equal(manifest.schema_version, 'codistan-prospecting-os-release.v1');
assert.equal(manifest.product, 'Codistan Prospecting OS');
assert.equal(manifest.release_version, '1.0.0-rc.1');
assert.equal(manifest.release_status, 'live_validation');
assert.equal(manifest.components.upwork_extension, upwork.version);
assert.equal(manifest.components.linkedin_sales_navigator_extension, linkedin.version);
assert(runtimeInit.includes(`__version__ = "${manifest.components.local_runtime}"`));
assert.deepEqual(manifest.collectors.map((item) => item.source), ['upwork', 'linkedin', 'sales_navigator']);
assert.deepEqual(manifest.collectors.map((item) => item.port), [8765, 8775, 8785]);
assert.equal(manifest.state_contract.external_actions_enabled, false);
assert(manifest.on_hold.some((item) => item.capability === 'automatic external outreach'));
assert(manifest.on_hold.some((item) => item.capability === 'paid enrichment providers'));
assert(manifest.on_hold.some((item) => item.capability === 'additional acquisition sources'));

for (const marker of [
  'app-current', 'app-previous', 'prospect-desk-sync.json',
  'Start Prospecting OS.lnk', 'Check Prospecting OS Release.lnk',
  'Start Acquisition V5.lnk', 'Check Acquisition V5.lnk',
  'external_actions_enabled -eq $false',
  'The previous application folder was restored',
]) assert(installer.includes(marker), `missing installer marker: ${marker}`);

for (const marker of [
  'codistan-prospecting-os-readiness.v1',
  'ready_for_local_capture', 'ready_for_commercial_pilot',
  'prospecting-os-release-readiness.json',
  'external_actions_enabled = $false',
  'upwork', 'linkedin', 'sales_navigator',
]) assert(readiness.includes(marker), `missing readiness marker: ${marker}`);

assert(canonicalStart.includes('install-acquisition-v4.ps1'));
assert(canonicalCheck.includes('check-prospecting-os-release.ps1'));
assert(docs.includes('At least 60% of reviewed Priority A/B records'));
assert(docs.includes('automatic external outreach'));
assert(docs.includes('No captured record, deduplication fingerprint'));

const prohibited = [
  'external_actions_enabled = $true',
  'externalActionPerformedBySystem: true',
  'sendEmail(', 'sendMessage(', 'submitProposal(', 'sendInMail(', 'connectRequest(',
];
const combined = `${installer}\n${readiness}\n${canonicalStart}\n${canonicalCheck}`.toLowerCase();
for (const marker of prohibited) {
  assert(!combined.includes(marker.toLowerCase()), `release package contains prohibited marker: ${marker}`);
}

console.log('Prospecting OS release contract passed.');
