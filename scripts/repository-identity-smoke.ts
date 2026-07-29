import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trackedFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .map((item) => item.trim())
  .filter(Boolean);

const legacyProspectingOsPaths = new Set([
  'docs/prospecting-os/README.md',
  'docs/prospecting-os/RELEASE-1.0-RC1.md',
  'docs/prospecting-os/PILOT-USABILITY-RUNBOOK.md',
  'workers/acquisition/START-HERE-PROSPECTING-OS.cmd',
  'workers/acquisition/CHECK-PROSPECTING-OS-RELEASE.cmd',
  'workers/acquisition/CHECK-PROSPECTING-OS-PILOT.cmd',
  'workers/acquisition/scripts/windows/check-prospecting-os-release.ps1',
  'workers/acquisition/scripts/windows/check-prospecting-os-pilot.ps1',
  'workers/acquisition/acquisition_v4/prospecting_os_acceptance.py',
  'workers/acquisition/tests/test_prospecting_os_acceptance.py',
  'workers/acquisition/tests/prospecting_os_release_contract.mjs',
]);

const violations: string[] = [];
for (const relativePath of trackedFiles) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (/talenttrack|content-automation/i.test(normalized)) {
    violations.push(`${normalized}: forbidden repository identity in path`);
  }

  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath) || statSync(absolutePath).size > 2_000_000) continue;
  const buffer = readFileSync(absolutePath);
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');

  if (/talenttrack/i.test(text)) violations.push(`${normalized}: contains TalentTrack`);
  if (/content-automation/i.test(text)) violations.push(`${normalized}: contains content-automation`);
  if (/codistan\s+prospecting\s+os/i.test(text)) violations.push(`${normalized}: declares the retired product identity`);
  if (/prospecting\s+os/i.test(text) && !legacyProspectingOsPaths.has(normalized)) {
    violations.push(`${normalized}: uses Prospecting OS outside an approved compatibility alias`);
  }
  if (legacyProspectingOsPaths.has(normalized) && /prospecting\s+os/i.test(text) && !/legacy compatibility alias/i.test(text)) {
    violations.push(`${normalized}: legacy alias is not explicitly labelled`);
  }
}

const manifestPath = path.join(root, 'workers/acquisition/release-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  schema_version?: string;
  product?: string;
  application?: string;
  components?: { combined_pilot_acceptance?: string };
};
assert.equal(manifest.schema_version, 'codistan-sales-automation-release.v1');
assert.equal(manifest.product, 'Codistan Sales Automation');
assert.equal(manifest.application, 'Prospect Desk');
assert.equal(manifest.components?.combined_pilot_acceptance, 'codistan-sales-automation-acceptance.v1');

for (const requiredPath of [
  'docs/sales-automation/RELEASE-1.0-RC1.md',
  'docs/sales-automation/PILOT-USABILITY-RUNBOOK.md',
  'workers/acquisition/START-HERE-SALES-AUTOMATION.cmd',
  'workers/acquisition/START-SALES-AUTOMATION.cmd',
  'workers/acquisition/CHECK-SALES-AUTOMATION-RELEASE.cmd',
  'workers/acquisition/CHECK-SALES-AUTOMATION-PILOT.cmd',
  'workers/acquisition/DIAGNOSE-SALES-AUTOMATION.cmd',
  'workers/acquisition/ROLLBACK-SALES-AUTOMATION.cmd',
  'workers/acquisition/scripts/windows/check-sales-automation-release.ps1',
  'workers/acquisition/scripts/windows/check-sales-automation-pilot.ps1',
  'workers/acquisition/acquisition_v4/sales_automation_acceptance.py',
  'workers/acquisition/tests/sales_automation_release_contract.mjs',
]) {
  if (!existsSync(path.join(root, requiredPath))) violations.push(`${requiredPath}: canonical Sales Automation release file is missing`);
}

assert.deepEqual(violations, [], `Repository identity violations:\n${violations.join('\n')}`);
console.log('Sales Automation repository identity and compatibility-alias contract passed');
